/**
 * Trust boundary — everything crossing into the process from outside.
 *
 * The rule this file specifies, in one sentence: **a value that came from
 * outside the process is untrusted until a schema says otherwise, and a
 * rejection is a typed failure — never a defect, never a silent accept.**
 *
 * Four boundaries are covered, one `describe` each:
 *
 * 1. the single-flight response (`Route.invokeSingleFlight`),
 * 2. the resume manifest (`Resume.decodeManifest` / `Resume.installClient`),
 * 3. the loader hydration handoff (`window.__afuiLoaderHandoff`),
 * 4. agent dispatch args (unbuilt).
 *
 * Each gets the same five shapes — malformed, structurally-valid-but-wrong-type,
 * **tampered** (internally inconsistent), truncated, and version/build mismatch
 * — plus the negative control without which "reject everything" would pass:
 * the well-formed payload is accepted, cleanly.
 *
 * Owning plans: `RESULT_UNIFICATION_PLAN.md` Decision 6 / `DQ-091` (single
 * flight), `ROUTER_CONSOLIDATION_PLAN.md` R2 item 4 (handoff),
 * `RESUMABILITY_IMPLEMENTATION_PLAN.md` (manifest), `AGENT_NATIVE_NOTES.md`
 * AN-1 (dispatch).
 */

import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, unbuilt } from "../harness.js";
import {
  classifiedTag,
  distinctCodes,
  FakeDocument,
  runPromiseExit,
  runSyncExit,
  withGlobal,
} from "./support.js";

const BuildId = "future-security-build";

/** A structurally minimal but genuinely valid V4 manifest. */
const emptyManifest = (buildId = BuildId) => ({
  version: 4,
  buildId,
  events: {},
  components: {},
  expressions: {},
});

// ─── 1. The single-flight response ───────────────────────────────────────────

describe("[SEC/DQ-091] Single-flight response boundary", () => {
  /** Drive `invokeSingleFlight` with a fake fetch returning `body` verbatim. */
  async function invoke(body: unknown) {
    const Route = await fromSrc("Route", "invokeSingleFlight");
    return runPromiseExit(
      Route.invokeSingleFlight(
        "/__single-flight",
        { name: "mutate", args: [{ id: 1 }], url: "/items" },
        {
          // `hydrate: false` keeps this spec about *validation* only — a
          // rejected payload must never reach the hydration step at all, which
          // the loader-cache assertion below checks separately.
          hydrate: false,
          fetch: async () => ({ json: async () => body }),
        },
      ),
    );
  }

  it("rejects malformed, wrong-typed, tampered, truncated, and drifted responses with typed errors", async () => {
    // Each of these arrived over the network. None may be believed.
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      // Malformed: not the envelope at all. This one already fails today.
      ["malformed", { _tag: "Nonsense" }],
      // Structurally valid envelope, wrong types inside. `loaders` is read as
      // an array by `hydrateSingleFlightPayload`; a string there is a type
      // confusion that today's `"ok" in parsed` check waves through.
      [
        "wrong types",
        { ok: true, payload: { mutation: 1, url: 5, loaders: "not-an-array" } },
      ],
      // Tampered: internally inconsistent — both arms of the two-arm envelope
      // present at once (`DQ-080` decided exactly two arms). An implementation
      // that reads `ok` first and stops silently believes the success arm of a
      // response the server said was a failure.
      [
        "tampered: both arms",
        {
          ok: true,
          error: { _tag: "Forbidden" },
          payload: { mutation: { id: 1 }, url: "/items", loaders: [] },
        },
      ],
      // Truncated: the envelope tag survived, the body did not.
      ["truncated", { ok: true }],
      // Drift: a loader entry naming a route this build does not have. `DQ-081`
      // decided a drifted call fails closed rather than degrading.
      [
        "route drift",
        {
          ok: true,
          payload: {
            mutation: { id: 1 },
            url: "/items",
            loaders: [{ routeId: "route-from-another-build", result: null }],
          },
        },
      ],
    ];

    const tags: Array<string> = [];
    for (const [label, body] of cases) {
      const exit = await invoke(body);
      const tag = classifiedTag(exit);
      // Fail closed: never a success, never a defect (asserted inside
      // `classifiedTag`), always a value the caller can branch on.
      expect(tag, label).not.toBe("success");
      expect(tag, label).toBe("SingleFlightInvokeError");
      tags.push(tag);
    }
    expect(tags).toHaveLength(cases.length);

    // NEGATIVE CONTROL. The well-formed response is accepted cleanly and its
    // mutation value survives untouched. Without this, an implementation that
    // rejected every response would satisfy every assertion above forever.
    const good = await invoke({
      ok: true,
      payload: { mutation: { id: 1, name: "ok" }, url: "/items", loaders: [] },
    });
    expect(classifiedTag(good)).toBe("success");
    expect(Exit.isSuccess(good) ? good.value.mutation : undefined).toEqual({
      id: 1,
      name: "ok",
    });
  });

  it("never hydrates loader state out of an invalid response", async () => {
    const Route = await fromSrc("Route", "invokeSingleFlight");
    const router = await fromSrc(
      "router-runtime",
      "LoaderCacheTag",
      "makeLoaderCacheStore",
    );
    // The observable consequence of believing a bad payload is *state*, not an
    // error code: a hydrated loader cache entry. So assert the cache stayed
    // empty, which is the thing an attacker actually wants to change.
    const cache = router.makeLoaderCacheStore();
    const exit = await runPromiseExit(
      Route.invokeSingleFlight(
        "/__single-flight",
        { name: "mutate", args: [], url: "/items" },
        {
          fetch: async () => ({
            json: async () => ({
              ok: true,
              payload: {
                mutation: null,
                url: "/items",
                loaders: [{ routeId: "admin", result: { _tag: "Success", value: "secret" } }],
              },
            }),
          }),
        },
      ).pipe(Effect.provideService(router.LoaderCacheTag, cache)),
    );
    // The route source is absent, so nothing legitimate could have been
    // hydrated; the assertion is that nothing *illegitimate* was either.
    expect(classifiedTag(exit)).toBe("SingleFlightInvokeError");
    expect(cache.cache.size).toBe(0);
  });

  it("declares a version on the wire envelope", async () => {
    // The loader handoff carries `version: 1`; the single-flight envelope
    // carries nothing, so a client from build N cannot tell it is talking to a
    // server from build N+1. Shape is owned by `DQ-091`, so this is not pinned
    // here — but the semantics ("a mismatched envelope version fails closed")
    // are the thing this file exists to guarantee.
    unbuilt("versioned single-flight wire envelope", "DQ-091");
  });
});

// ─── 2. The resume manifest ──────────────────────────────────────────────────

describe("[SEC/M8c] Resume manifest boundary", () => {
  async function decode(serialized: string, expected = BuildId) {
    const Resume = await fromSrc("Resume", "decodeManifest");
    const Serialization = await fromSrc("Serialization", "layer");
    return runPromiseExit(
      Resume.decodeManifest(serialized, expected).pipe(
        Effect.provide(Serialization.layer),
      ),
    );
  }

  it("rejects malformed, wrong-typed, tampered, truncated and build-drifted manifests, and accepts the valid one", async () => {
    const valid = JSON.stringify(emptyManifest());
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ["malformed JSON", "{not json", BuildId],
      [
        "wrong types",
        JSON.stringify({ ...emptyManifest(), components: "not-a-record" }),
        BuildId,
      ],
      // Tampered: the envelope says v4 while carrying a v1-shaped body. Both
      // halves are individually plausible; only the combination is wrong.
      [
        "tampered version/body",
        JSON.stringify({ version: 4, buildId: BuildId, state: {} }),
        BuildId,
      ],
      ["truncated", valid.slice(0, Math.floor(valid.length / 2)), BuildId],
      ["build drift", valid, "a-different-build"],
    ];

    const tags: Array<string> = [];
    for (const [label, serialized, expected] of cases) {
      const tag = classifiedTag(await decode(serialized, expected));
      expect(tag, label).not.toBe("success");
      tags.push(tag);
    }
    // Build drift must not collapse into "malformed": a stale deploy and a
    // hostile payload need different operator responses.
    expect(tags[4]).toBe("ResumeClientBuildMismatchError");
    expect(tags[4]).not.toBe(tags[0]);

    // NEGATIVE CONTROL.
    const good = await decode(valid);
    expect(classifiedTag(good)).toBe("success");
    expect(Exit.isSuccess(good) ? good.value.buildId : undefined).toBe(BuildId);
  });

  it("re-validates a manifest object that was mutated after it passed validation", async () => {
    // GREEN, and as of 2026-07-30 green *by construction* rather than by
    // accident. Keep it: it pins the invariant that makes it so.
    //
    // `Resume.ts` memoizes validated manifests and short-circuits
    // `validateManifestValue` on identity before re-running the schema — a
    // time-of-check/time-of-use shape at the one boundary this whole family of
    // errors exists to defend. It used to be harmless *only* because
    // `Schema.decodeUnknownEffect` happens to return a copy, so the remembered
    // object was never the caller's (`DQ-099`).
    //
    // That dependence is gone. Memo membership is now granted **last**, only
    // after the graph is deeply frozen, so "validated" implies "immutable" and
    // validate-then-mutate-then-reuse is unrepresentable — including under an
    // identity-preserving decoder.
    //
    // Note what was rejected: making the brand an own `Symbol` property, the
    // literal reading of `DQ-099`'s recommendation, is **strictly weaker** than
    // the private `WeakSet` it would replace, because
    // `Object.getOwnPropertySymbols` makes such a brand forgeable onto any
    // object. The type is branded; the runtime witness stays unforgeable.
    const Resume = await fromSrc("Resume", "installClient");
    const { ManagedRuntime, Layer } = await import("effect");

    const manifest: any = emptyManifest();
    const firstRoot = new FakeDocument([]);
    const firstRuntime = ManagedRuntime.make(Layer.empty);
    const first = runSyncExit(
      Resume.installClient({
        root: firstRoot.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime: firstRuntime,
      }),
    );
    // NEGATIVE CONTROL, inline: the untampered object installs cleanly, so a
    // "reject the second install unconditionally" implementation cannot pass.
    expect(classifiedTag(first)).toBe("success");
    if (Exit.isSuccess(first)) await Effect.runPromise(first.value.dispose);
    await firstRuntime.dispose();

    // Now tamper with the very same object an attacker already got validated.
    manifest.expressions = "no longer a record";

    const secondRoot = new FakeDocument([]);
    const secondRuntime = ManagedRuntime.make(Layer.empty);
    const second = runSyncExit(
      Resume.installClient({
        root: secondRoot.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime: secondRuntime,
      }),
    );
    expect(classifiedTag(second)).toBe("ResumeManifestDecodeError");
    await secondRuntime.dispose();
  });
});

// ─── 3. The loader hydration handoff ─────────────────────────────────────────

describe("[SEC/R2] Loader handoff boundary", () => {
  async function read(value: unknown) {
    const Route = await fromSrc("Route", "readLoaderHandoff", "loaderHandoffGlobalKey");
    const Serialization = await fromSrc("Serialization", "layer");
    return withGlobal(Route.loaderHandoffGlobalKey, value, () =>
      runPromiseExit(
        Route.readLoaderHandoff().pipe(Effect.provide(Serialization.layer)),
      ));
  }

  it("rejects every malformed shape a page script could assign, and accepts the well-formed envelope", async () => {
    const Route = await fromSrc("Route", "loaderHandoffVersion");
    const entry = {
      routeId: "items",
      params: {},
      result: { _tag: "Success", value: 1, waiting: false, timestamp: 0 },
    };
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      // Malformed: anything at all can be assigned to a `window` key.
      ["malformed", "just a string"],
      // Structurally valid, wrong types: `entries` must be a list of entries.
      ["wrong types", { version: Route.loaderHandoffVersion, entries: { routeId: "x" } }],
      // Tampered: the envelope declares v1 while an entry omits the fields v1
      // requires — internally inconsistent rather than merely wrong.
      [
        "tampered entry",
        { version: Route.loaderHandoffVersion, entries: [{ routeId: "items" }] },
      ],
      // Truncated: the envelope arrived, the entries did not.
      ["truncated", { version: Route.loaderHandoffVersion }],
      // Version drift: the whole reason R2 versioned this envelope.
      ["version drift", { version: 99, entries: [entry] }],
    ];

    const tags: Array<string> = [];
    for (const [label, value] of cases) {
      const tag = classifiedTag(await read(value));
      expect(tag, label).not.toBe("success");
      tags.push(tag);
    }
    expect(tags).toHaveLength(cases.length);

    // NEGATIVE CONTROL: the envelope the library's own script tags emit.
    const good = await read({ version: Route.loaderHandoffVersion, entries: [entry] });
    expect(classifiedTag(good)).toBe("success");
    expect(Exit.isSuccess(good) ? good.value.entries.length : -1).toBe(1);
  });

});

// ─── 4. Agent dispatch args ──────────────────────────────────────────────────

describe("[SEC/AN-1] Agent dispatch boundary", () => {
  it("validates dispatch args against the declared tuple before any handler runs", async () => {
    // `DQ-088` decided the arg shape (`Schema.Tuple` plus authored `argNames`),
    // but the module and export names are still provisional under `DQ-096`, so
    // pinning a call shape here would be an unratified design decision. The
    // semantics owed: an arg list that does not decode never reaches the
    // handler, fails with a typed error, and is audited as a denial — the same
    // five shapes asserted above.
    unbuilt("Agent dispatch arg validation", "DQ-096");
  });
});
