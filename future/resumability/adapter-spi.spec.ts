/**
 * Milestone 9 — hardening, documentation, and adapter stability.
 *
 * Owning plan: `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` Milestone 9, plus the
 * "Manifest byte-ceiling attribution" item in the 2026-07-28 design review.
 *
 * Four claims:
 *  1. the adapter escape hatches behave as an SPI (encoded writes bypass the
 *     domain codec but not validation; inspection is inert and detached);
 *  2. `ResumePayloadTooLargeError` attributes bytes per component/binding as
 *     well as per expression, so the first real collision is debuggable;
 *  3. every frozen wire fixture from v1 to v4 still *installs*, not merely
 *     decodes;
 *  4. the embedded manifest is CSP-safe: inert JSON, no executable payload, no
 *     `</script>` break-out, and readable back off the DOM byte-identically.
 */

import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import { fromSrc, unbuilt } from "../harness.js";
import { FakeDocument } from "./fake-dom.js";

/**
 * The harness hands back `any`-shaped values on purpose, so `Effect.runSync`
 * cannot infer a success type from them. These thin wrappers keep the specs
 * readable without sprinkling casts through every assertion.
 */
const runSync = (effect: any): any => Effect.runSync(effect);
const runSyncExit = (effect: any): Exit.Exit<any, any> =>
  Effect.runSyncExit(effect) as Exit.Exit<any, any>;
const runPromise = (effect: any): Promise<any> => Effect.runPromise(effect);
const runFork = (effect: any): any => Effect.runFork(effect);
const decode = (schema: any) => (input: unknown): any =>
  Schema.decodeUnknownSync(schema)(input);


const BuildId = "future-resume-build";

/** Frozen v1 wire fixture: events only, one deferred portable handler. */
const MANIFEST_V1 =
  '{"version":1,"buildId":"future-resume-build","events":{"e0":{"type":"click","invocation":"deferred-no-args","code":{"version":1,"kind":"portable.code","id":"future.resume.spi.save","buildId":"future-resume-build","captures":{"label":"Save"}}}}}';

/** Frozen v2 wire fixture: a component region with a state binding. */
const MANIFEST_V2 =
  '{"version":2,"buildId":"future-resume-build","events":{},"components":{"c0":{"definitionName":"Counter","region":{"kind":"comment-pair"},"bindings":{"count":{"kind":"state","key":"count","value":3,"dehydratedAt":1700000000000}}}}}';

/** Frozen v3 wire fixture: region-keyed expression entry. */
const MANIFEST_V3 =
  '{"version":3,"buildId":"future-resume-build","events":{},"components":{"c0":{"region":{"kind":"comment-pair"},"bindings":{"count":{"kind":"state","key":"count","value":1,"dehydratedAt":1700000000000}}}},"expressions":{"x0":{"region":{"kind":"comment-pair"},"code":{"version":1,"kind":"portable.code","id":"future.resume.spi.expression","buildId":"future-resume-build","captures":{"label":"Count"}},"deps":["af:binding:c0/count"],"component":"c0"}}}';

/** Frozen v4 wire fixture: target-keyed expression entry. */
const MANIFEST_V4 =
  '{"version":4,"buildId":"future-resume-build","events":{},"components":{"c0":{"region":{"kind":"comment-pair"},"bindings":{"count":{"kind":"state","key":"count","value":1,"dehydratedAt":1700000000000}}}},"expressions":{"x0":{"target":{"kind":"text"},"code":{"version":1,"kind":"portable.code","id":"future.resume.spi.expression","buildId":"future-resume-build","captures":{"label":"Count"}},"deps":["af:binding:c0/count"],"component":"c0"}}}';

async function kit() {
  const Resume = await fromSrc(
    "Resume",
    "collect",
    "decodeManifest",
    "installClient",
    "snapshotState",
  );
  const Component = await fromSrc(
    "Component",
    "make",
    "props",
    "require",
    "setup",
    "state",
    "action",
    "renderEffect",
    "withDefinition",
  );
  const dom = await fromSrc("dom", "renderToString", "template", "insert");
  const Serialization = await fromSrc("Serialization", "layer");
  const Portable = await fromSrc("Portable", "code", "bind");
  const extract = await fromSrc("portable-extract", "expressionCode", "bindExpression");
  return { Resume, Component, dom, Serialization, Portable, extract };
}

describe("Resume adapter SPI and wire stability", () => {
  it("[M9] validates adapter-supplied encoded binding writes instead of trusting them", async () => {
    const { Resume, Component, dom, Serialization, extract } = await kit();
    const Expression = extract.expressionCode({
      id: "future.resume.spi.encoded",
      buildId: BuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (_captures: unknown, [count]: readonly [number]) => `v${count}`,
    });
    const Counter = Component.make(
      Component.props(),
      Component.require(),
      Component.setup().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props: unknown, bindings: any) => {
        const span = dom.template("<span>")();
        dom.insert(
          span,
          extract.bindExpression(Expression, {}, [bindings.count]),
        );
        return span;
      },
    ).pipe(Component.withDefinition({ name: "FutureSpiCounter" }));
    const scope = Scope.makeUnsafe();
    const collected = runSync(
      Resume.collect(
        () =>
          dom.renderToString(() =>
            runSync(
              Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
            ),
          ),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
    runSync(Scope.close(scope, Exit.void));

    const root = new FakeDocument([
      { kind: "component", id: "c0", edge: "start" },
      { kind: "expression", id: "x0", edge: "start" },
      { kind: "text", value: "v1" },
      { kind: "expression", id: "x0", edge: "end" },
      { kind: "component", id: "c0", edge: "end" },
    ]);
    const diagnostics: Array<any> = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest: collected.manifest,
        expectedBuildId: BuildId,
        resolverEntries: { [Expression.id]: Expression },
        runtime,
        onDiagnostic: (diagnostic: any) => diagnostics.push(diagnostic),
      }),
    );

    // The escape hatch applies an already-encoded value.
    runSync(installation.writeBindingEncoded("c0", "count", 5));
    await vi.waitFor(() => expect(root.regionText("x0")).toBe("v5"));

    // The escape hatch trusts the adapter's *encoding* (there is no retained
    // per-binding codec client-side — that is why `writeBinding` takes one),
    // but a value the dependent expression's dependency codec rejects must
    // still fail closed: a classified diagnostic, no defect, and the last good
    // value left standing in the DOM. Never a wrong patch.
    runSync(installation.writeBindingEncoded("c0", "count", "not-a-number"));
    await vi.waitFor(() => expect(installation.pending()).toBe(0));
    expect(root.regionText("x0")).toBe("v5");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "expression-execution-failure",
    ]);

    // …and a later valid write recovers.
    runSync(installation.writeBindingEncoded("c0", "count", 6));
    await vi.waitFor(() => expect(root.regionText("x0")).toBe("v6"));

    // An unknown binding name is an error, never a silently created binding.
    const unknown = runSyncExit(
      installation.writeBindingEncoded("c0", "nope", 1),
    );
    expect(Exit.isFailure(unknown)).toBe(true);
    if (Exit.isFailure(unknown)) {
      expect(Cause.hasDies(unknown.cause)).toBe(false);
      expect(
        Cause.findErrorOption(unknown.cause).pipe(
          Option.map((error) => (error as { readonly _tag?: string })._tag),
          Option.getOrElse(() => "none"),
        ),
      ).toBe("ResumeBindingSnapshotNotFoundError");
    }

    // `inspect()` is documented as inert and detached: observing must neither
    // start work nor hand out live references that could retain it.
    const before = installation.inspect();
    const after = installation.inspect();
    expect(after).toEqual(before);
    expect(after).not.toBe(before);
    expect(installation.pending()).toBe(0);

    await runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M9] attributes an oversized payload to its largest component binding", async () => {
    const { Resume, Component, dom, Serialization } = await kit();
    const Big = Component.make(
      Component.props(),
      Component.require(),
      Component.setup()
        .bind("small", () => Component.state("s"), {
          resume: Resume.snapshotState(Schema.String),
        })
        .bind("large", () => Component.state("x".repeat(4_000)), {
          resume: Resume.snapshotState(Schema.String),
        }),
      () => null,
    ).pipe(Component.withDefinition({ name: "FutureOversizedComponent" }));
    const scope = Scope.makeUnsafe();
    const exit = runSyncExit(
      Resume.collect(
        () =>
          dom.renderToString(() =>
            runSync(
              Component.renderEffect(Big, {}).pipe(Scope.provide(scope)),
            ),
          ),
        { buildId: BuildId, maxPayloadBytes: 512 },
      ).pipe(Effect.provide(Serialization.layer)),
    );
    runSync(Scope.close(scope, Exit.void));

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const error = Cause.findErrorOption(exit.cause).pipe(
      Option.getOrElse(() => undefined as any),
    );
    expect(error?._tag).toBe("ResumePayloadTooLargeError");
    // Per the design review: attribution must reach the *binding*, so the first
    // real collision is debuggable without bisecting the component tree.
    expect(error.largestEntryKind).toBe("component");
    expect(error.largestEntryId).toBe("c0");
    expect(error.largestEntryBytes).toBeGreaterThan(4_000);
    expect(error.largestBindingName).toBe("large");

    // NEGATIVE CONTROL. The same component under a ceiling it fits collects
    // successfully, and both bindings survive — without this, a collector that
    // failed every payload would satisfy the assertions above forever.
    const roomyScope = Scope.makeUnsafe();
    const collected = runSync(
      Resume.collect(
        () =>
          dom.renderToString(() =>
            runSync(
              Component.renderEffect(Big, {}).pipe(Scope.provide(roomyScope)),
            ),
          ),
        { buildId: BuildId, maxPayloadBytes: 64_000 },
      ).pipe(Effect.provide(Serialization.layer)),
    );
    runSync(Scope.close(roomyScope, Exit.void));
    expect(
      Object.keys(collected.manifest.components.c0.bindings).sort(),
    ).toEqual(["large", "small"]);
  });

  it("[M9] installs every frozen manifest fixture from v1 through v4", async () => {
    const { Resume, Serialization, Portable, extract } = await kit();
    const SaveCode = Portable.code({
      id: "future.resume.spi.save",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: () => Effect.void,
    });
    const Expression = extract.expressionCode({
      id: "future.resume.spi.expression",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (captures: any, [count]: readonly [number]) =>
        `${captures.label}: ${count}`,
    });
    const resolverEntries = {
      [SaveCode.id]: SaveCode,
      [Expression.id]: Expression,
    };

    const fixtures = [
      ["v1", MANIFEST_V1, 1],
      ["v2", MANIFEST_V2, 2],
      ["v3", MANIFEST_V3, 3],
      ["v4", MANIFEST_V4, 4],
    ] as const;

    for (const [label, serialized, version] of fixtures) {
      const manifest = runSync(
        Resume.decodeManifest(serialized, BuildId).pipe(
          Effect.provide(Serialization.layer),
        ),
      );
      expect(manifest.version, label).toBe(version);

      // The DOM an old build would have emitted for this payload.
      const root = version === 1
        ? new FakeDocument([
          { kind: "element", attributes: { "data-af-event-click": "e0" } },
        ])
        : version === 2
        ? new FakeDocument([
          { kind: "component", id: "c0", edge: "start" },
          { kind: "text", value: "3" },
          { kind: "component", id: "c0", edge: "end" },
        ])
        : new FakeDocument([
          { kind: "component", id: "c0", edge: "start" },
          { kind: "expression", id: "x0", edge: "start" },
          { kind: "text", value: "Count: 1" },
          { kind: "expression", id: "x0", edge: "end" },
          { kind: "component", id: "c0", edge: "end" },
        ]);

      const runtime = ManagedRuntime.make(Layer.empty);
      const installation = runSync(
        Resume.installClient({
          root: root.asDocument(),
          manifest,
          expectedBuildId: BuildId,
          resolverEntries,
          runtime,
        }),
      );
      // Decoding an old payload is not enough; it must still *work*. For both
      // expression versions the restored subscriber patches the SSR region.
      if (version >= 3) {
        runSync(
          installation.writeBinding("c0", "count", Schema.Number, 4),
        );
        await vi.waitFor(() => {
          expect(root.regionText("x0"), label).toBe("Count: 4");
        });
      }
      await runPromise(installation.dispose);
      expect(installation.inspect(), label).toMatchObject({
        disposed: true,
        pendingFibers: 0,
        eventListeners: 0,
        expressionControllers: 0,
      });
      await runtime.dispose();
    }
  });

  it("[M9] embeds the manifest as inert, CSP-safe JSON that reads back byte-identically", async () => {
    const { Resume, Portable, Component, dom, Serialization } = await kit();
    const { event } = await fromSrc("Resume", "event");
    const { addEventListener } = await fromSrc("dom", "addEventListener");
    // Every character class that can break out of, or corrupt, an inline block.
    const evil =
      "</script><script>alert(1)</script>" + "\u2028\u2029" + "<!-- &";
    const SaveCode = Portable.code({
      id: "future.resume.spi.csp",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: () => Effect.void,
    });
    const action = runSync(
      Component.action(Portable.bind(SaveCode, { label: evil })),
    );
    const collected = runSync(
      Resume.collect(
        () =>
          dom.renderToString(() => {
            const button = dom.template("<button>Save")();
            addEventListener(button, "click", event(action), true);
            return button;
          }),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );

    // Inert by construction: a JSON script block executes nothing, so the page
    // needs no `script-src 'unsafe-inline'` relaxation and no nonce.
    expect(collected.script).toContain('type="application/json"');
    expect(collected.script).not.toMatch(
      /<script(?![^>]*type="application\/json")/,
    );
    // No break-out, no comment-state confusion, no raw line separators.
    expect(collected.script.slice(0, -"</script>".length)).not.toContain(
      "</script>",
    );
    expect(collected.script).not.toContain("<!--");
    expect(collected.script).not.toContain("\u2028");
    expect(collected.script).not.toContain("\u2029");


    // …and the client reads the same bytes back off the DOM.
    const inner = collected.script.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    expect(inner).toBe(collected.serializedManifest);
    const decoded = runSync(
      Resume.decodeManifest(inner, BuildId).pipe(
        Effect.provide(Serialization.layer),
      ),
    );
    const entry = Object.values(decoded.events)[0] as any;
    expect(entry.code.captures.label).toBe(evil);
  });

  it("[M9] exposes a runtime-readable spiVersion an adapter can fail closed on", async () => {
    // Ratified 2026-07-30 (`RESUMABILITY_IMPLEMENTATION_PLAN.md` §Ratified
    // DQ-005–DQ-012, DQ-011): the SPI *member list* is blocked on M10 item 4
    // (publishing before an external consumer has exercised it freezes the
    // wrong surface), but one thing is committed to now — a runtime-readable
    // `spiVersion`, because that is what lets an adapter fail closed on
    // mismatch, exactly like the build-ID gate.
    const { spiVersion } = await fromSrc("Resume", "spiVersion");

    // Readable at runtime without constructing anything: an adapter must be
    // able to check compatibility before it calls a single SPI member.
    expect(typeof spiVersion).toBe("string");
    expect(spiVersion.length).toBeGreaterThan(0);

    // An adapter's fail-closed check is a plain comparison, and it must
    // actually discriminate. Both halves are here on purpose: a `spiVersion`
    // that compared equal to everything (or to nothing) would satisfy one of
    // these and fail the other.
    const compatible = (declared: string) => declared === spiVersion;
    expect(compatible(spiVersion)).toBe(true);
    expect(compatible(`${spiVersion}-not-this-one`)).toBe(false);

    // Stable across reads: a version derived per call (a timestamp, a random
    // id) would make every adapter fail closed against itself.
    const { spiVersion: again } = await fromSrc("Resume", "spiVersion");
    expect(again).toBe(spiVersion);
  });

  it("[M9] freezes the adapter SPI's member list behind a published surface", async () => {
    // Still genuinely open, and deliberately so: DQ-011 amends M9 item 2 to
    // read *blocked on* M10 item 4 (the permissive package) rather than merely
    // "deferred". Which subpath the SPI ships on and which members it contains
    // is answered by what the first external consumer actually needs.
    unbuilt(
      "the published adapter SPI surface: its subpath and its member list (the version marker is specified above)",
      "M9 item 2, blocked on M10 item 4",
    );
  });
});
