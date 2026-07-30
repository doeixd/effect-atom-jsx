/**
 * Isolation — no cross-request, cross-tenant, or cross-installation bleed.
 *
 * The motivating incident: the single-flight transport bleed, where two
 * concurrent calls carrying *different* layer-provided transports both reached
 * a process-global installed transport. It sat between two lanes' scopes, so
 * neither owned it, and it was found by accident.
 *
 * The discipline this file follows: assert **counts and identity**, not final
 * values. "Request A ended up with A's data" is satisfied by a shared store
 * that happened to be written in a convenient order; "transport A was called
 * exactly once, with A's request, and transport B never saw it" is not.
 *
 * Owning plans: `ROUTER_CONSOLIDATION_PLAN.md` R5 / `DQ-033` (transport
 * ladder), `RESUMABILITY_M8C_PLAN.md` 8c.6 (installation isolation).
 */

import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc } from "../harness.js";
import { classifiedTag, FakeDocument, runPromise, runPromiseExit, runSync } from "./support.js";

const BuildId = "future-security-build";

interface RecordingTransport {
  readonly service: any;
  readonly calls: Array<any>;
}

/** A transport that records every request it is handed. */
function recordingTransport(name: string): RecordingTransport {
  const calls: Array<any> = [];
  return {
    calls,
    service: {
      execute: (request: any) => {
        calls.push(request);
        return Effect.succeed({
          ok: true,
          payload: { mutation: name, url: request.url, loaders: [] },
        });
      },
    },
  };
}

// ─── Single-flight transport ─────────────────────────────────────────────────

describe("[SEC/DQ-033] Single-flight transport isolation", () => {
  it("routes each concurrent call to the transport its own context provided", async () => {
    // CURRENTLY RED for the free `Atom.action` path. `DQ-033` ratified one
    // ladder — context → endpoint → local runner — and the deletion of
    // `single-flight-runtime.ts`. Today the free `action` consults the
    // process-global `getInstalledSingleFlightTransport()` *first* and never
    // looks at `SingleFlightTransportTag` at all, so two concurrent requests
    // with different layer transports both hit whatever was installed last.
    // That is the bleed, stated as a test.
    const Atom = await fromSrc("Atom", "action");
    const SingleFlight = await fromSrc("SingleFlightTransport", "SingleFlightTransportTag");

    const a = recordingTransport("A");
    const b = recordingTransport("B");

    const mutate = Atom.action(
      (input: { readonly tenant: string }) => Effect.succeed(`local:${input.tenant}`),
      { name: "mutate", singleFlight: { mode: "force", url: () => "/items", hydrate: false } },
    );

    const call = (tenant: string, transport: RecordingTransport) =>
      mutate.runEffect({ tenant }).pipe(
        Effect.provide(Layer.succeed(SingleFlight.SingleFlightTransportTag, transport.service)),
      );

    const results = await runPromise(
      Effect.all([call("a", a), call("b", b)], { concurrency: 2 }),
    );

    // Identity and counts, not final values: each transport saw exactly its own
    // one call, and neither saw the other's tenant.
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(a.calls[0]?.args?.[0]).toEqual({ tenant: "a" });
    expect(b.calls[0]?.args?.[0]).toEqual({ tenant: "b" });
    expect(results).toEqual(["A", "B"]);
  });

  it("lets a request-scoped transport outrank a process-installed one", async () => {
    // A static process-global must never outrank request scope — that is the
    // precise mechanism `DQ-033` names as how the bleed happened. Under the
    // ratified ladder `single-flight-runtime.ts` is gone entirely, at which
    // point this spec is satisfied by construction; until then it is the
    // executable statement of the rule.
    const Atom = await fromSrc("Atom", "action");
    const SingleFlight = await fromSrc("SingleFlightTransport", "SingleFlightTransportTag");
    const runtimeGlobal = await fromSrc("single-flight-runtime", "installSingleFlightTransport");

    const ambient = recordingTransport("ambient");
    const scoped = recordingTransport("scoped");
    const restore = runtimeGlobal.installSingleFlightTransport(ambient.service);
    try {
      const mutate = Atom.action(() => Effect.succeed("local"), {
        name: "mutate",
        singleFlight: { mode: "force", url: () => "/items", hydrate: false },
      });
      const result = await runPromise(
        mutate.runEffect(undefined).pipe(
          Effect.provide(Layer.succeed(SingleFlight.SingleFlightTransportTag, scoped.service)),
        ),
      );
      expect(result).toBe("scoped");
      expect(scoped.calls).toHaveLength(1);
      // The count is the assertion: an ambient transport that also fired would
      // be a duplicated mutation, not merely a routing preference.
      expect(ambient.calls).toHaveLength(0);
    } finally {
      restore();
    }

    // NEGATIVE CONTROL. With nothing in context, the ambient transport is still
    // reachable — so this spec is about *precedence*, not about breaking the
    // ambient path. Without it, "never use the installed transport" would pass.
    const soloAmbient = recordingTransport("solo");
    const restoreSolo = runtimeGlobal.installSingleFlightTransport(soloAmbient.service);
    try {
      const mutate = Atom.action(() => Effect.succeed("local"), {
        name: "mutate",
        singleFlight: { mode: "force", url: () => "/items", hydrate: false },
      });
      const result = await runPromise(mutate.runEffect(undefined));
      expect(result).toBe("solo");
      expect(soloAmbient.calls).toHaveLength(1);
    } finally {
      restoreSolo();
    }
  });
});

// ─── Concurrent server renders ───────────────────────────────────────────────

describe("[SEC/R5] Server render isolation", () => {
  async function twoRenders() {
    return await fromSrc(
      "Route",
      "renderRequest",
      "page",
      "define",
      "id",
      "loader",
      "clientRouteHeadStore",
    );
  }

  it("gives two concurrent renders their own head store, loader cache, and response headers", async () => {
    const Route = await twoRenders();
    const Component = await fromSrc("Component", "make", "props", "require", "setup");
    const dom = await fromSrc("dom", "template");

    const seen: Array<string> = [];
    const Page = Component.make(
      Component.props(),
      Component.require(),
      Component.setup(),
      () => dom.template("<span>")(),
    );

    // A monotonically increasing value makes cache sharing observable: two
    // isolated caches each compute their own ticket, a shared one hands the
    // second render the first render's.
    let ticket = 0;
    const loads: Array<number> = [];
    const app = Route.define(
      Route.page("/", Page).pipe(
        Route.id("root"),
        Route.loader(() =>
          Effect.sync(() => {
            ticket += 1;
            loads.push(ticket);
            return { ticket };
          }),
        ),
      ),
    );

    const render = (url: string) =>
      Route.renderRequest(app, { request: new Request(url) });

    const [first, second] = await runPromise(
      Effect.all([render("https://a.example/"), render("https://b.example/")], {
        concurrency: 2,
      }),
    );
    seen.push(first.html, second.html);

    const ticketOf = (response: any) =>
      (response.loaderPayload[0]?.result as any)?.value?.ticket;
    // Identity, not equality of convenience: the two renders hold *different*
    // tickets, which is only possible if neither read the other's cache entry.
    expect(ticketOf(first)).toBeTypeOf("number");
    expect(ticketOf(second)).toBeTypeOf("number");
    expect(ticketOf(first)).not.toBe(ticketOf(second));
    // The loader really did run for each render — the negative control against
    // a "renders nothing" implementation trivially satisfying the line above.
    expect(loads.length).toBeGreaterThanOrEqual(2);
    // Each render's payload belongs to itself.
    expect(first.loaderPayload).not.toBe(second.loaderPayload);
    expect(first.headers).not.toBe(second.headers);
    expect(first.head).not.toBe(second.head);
    // And neither render wrote into the process-wide client head store, which
    // is the shared object a server render must never touch.
    expect(Route.clientRouteHeadStore.entries.size).toBe(0);
    expect(seen).toHaveLength(2);
  });

  it("leaves no server `document` behind when a render throws", async () => {
    // `renderToString` swaps `globalThis.document` for a virtual server
    // document. A render that throws and does not restore it would leave every
    // subsequent request in the process rendering into a stale document — the
    // most severe cross-request bleed available in this codebase.
    const dom = await fromSrc("dom", "renderToString");
    const carrier = globalThis as Record<string, unknown>;
    const hadDocument = "document" in carrier;
    expect(() =>
      dom.renderToString(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect("document" in carrier).toBe(hadDocument);

    // NEGATIVE CONTROL: the successful render still produces markup, so this is
    // not satisfied by a `renderToString` that refuses to install a document
    // at all.
    expect(typeof dom.renderToString(() => "hello")).toBe("string");
    expect("document" in carrier).toBe(hadDocument);
  });
});

// ─── Two Resume installations on one page ────────────────────────────────────

describe("[SEC/M8c.6] Installation isolation", () => {
  const emptyManifest = () => ({
    version: 4,
    buildId: BuildId,
    events: {},
    components: {},
    expressions: {},
  });

  it("refuses a second installation on the same root, and allows one per distinct root", async () => {
    const Resume = await fromSrc("Resume", "installClient");
    const root = new FakeDocument([]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const install = (target: FakeDocument) =>
      runPromiseExit(
        Resume.installClient({
          root: target.asDocument(),
          manifest: emptyManifest(),
          expectedBuildId: BuildId,
          resolverEntries: {},
          runtime,
        }),
      );

    const first = await install(root);
    expect(classifiedTag(first)).toBe("success");
    // Two installations racing for the same DOM would each believe they own
    // every marker in it. Typed refusal, not last-writer-wins.
    const second = await install(root);
    expect(classifiedTag(second)).toBe("ResumeDuplicateClientInstallationError");

    // NEGATIVE CONTROL: a *different* root installs cleanly at the same time,
    // so this is genuinely per-root and not a process-wide singleton.
    const other = new FakeDocument([]);
    const parallel = await install(other);
    expect(classifiedTag(parallel)).toBe("success");

    if (Exit.isSuccess(first)) await runPromise(first.value.dispose);
    if (Exit.isSuccess(parallel)) await runPromise(parallel.value.dispose);
    // Terminal: after disposal the root is reusable, so the guard is a lock and
    // not a leak.
    const reinstall = await install(root);
    expect(classifiedTag(reinstall)).toBe("success");
    if (Exit.isSuccess(reinstall)) await runPromise(reinstall.value.dispose);
    await runtime.dispose();
  });

  it("keeps two installations' event markers and binding keys from colliding", async () => {
    // Binding reactivity keys are derived, not minted: `af:binding:c0/count` is
    // the same string in every installation on the page. Isolation therefore
    // cannot come from the key — it must come from the registry the key is
    // resolved against.
    const Resume = await fromSrc("Resume", "installClient");
    const handle = await fromSrc("resume-handle", "bindingReactivityKey");
    const { Schema } = await import("effect");

    expect(handle.bindingReactivityKey("c0", "count")).toBe(
      handle.bindingReactivityKey("c0", "count"),
    );

    const manifest: any = emptyManifest();
    manifest.components = {
      c0: {
        region: { kind: "comment-pair" },
        bindings: {
          count: { kind: "state", key: "af:binding:c0/count", value: 1, dehydratedAt: 0 },
        },
      },
    };

    const makeRoot = () =>
      new FakeDocument([
        { kind: "component", id: "c0", edge: "start" },
        { kind: "text", value: "1" },
        { kind: "component", id: "c0", edge: "end" },
      ]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const first = makeRoot();
    const second = makeRoot();
    const a = runSync(
      Resume.installClient({
        root: first.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime,
      }),
    );
    const b = runSync(
      Resume.installClient({
        root: second.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime,
      }),
    );

    runSync(a.writeBinding("c0", "count", Schema.Number, 7));
    // Identity, not value: `b` must not have observed a write addressed to `a`,
    // even though both use the identical reserved key string.
    expect(a.inspect().disposed).toBe(false);
    expect(b.inspect().disposed).toBe(false);
    expect(b.pending()).toBe(0);

    await runPromise(a.dispose);
    // Disposing one installation must not disarm the other: counters for `b`
    // stay live, which is the negative control for a shared-registry teardown.
    expect(b.inspect().disposed).toBe(false);
    const stillWorks = await runPromiseExit(
      b.writeBinding("c0", "count", Schema.Number, 9),
    );
    expect(classifiedTag(stillWorks)).toBe("success");

    await runPromise(b.dispose);
    await runtime.dispose();
  });
});
