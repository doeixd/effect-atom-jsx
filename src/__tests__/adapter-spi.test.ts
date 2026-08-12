/**
 * Milestone 9 — hardening, documentation, and adapter stability.
 * Promoted from `future/resumability/adapter-spi.spec.ts` (all green
 * 2026-08-12, permissive-package plan S0/S1), retyped to direct imports.
 *
 * Owning plan: `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` Milestone 9, plus
 * the "Manifest byte-ceiling attribution" item in the 2026-07-28 design
 * review and `docs/PERMISSIVE_PACKAGE_PLAN.md` S1 (the published SPI).
 *
 * Claims:
 *  1. the adapter escape hatches behave as an SPI (encoded writes bypass the
 *     domain codec but not validation; inspection is inert and detached);
 *  2. `ResumePayloadTooLargeError` attributes bytes down to the component
 *     *binding*, so the first real collision is debuggable;
 *  3. every frozen wire fixture from v1 to v5 still *installs*, not merely
 *     decodes;
 *  4. the embedded manifest is CSP-safe: inert JSON, no executable payload,
 *     no `</script>` break-out, and readable back off the DOM byte-identically;
 *  5. `Resume.spiVersion` is a stable, discriminating fail-closed gate;
 *  6. the `adapter-spi` subpath publishes a frozen member list.
 */

import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema, Scope } from "effect";
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as AdapterSpi from "../adapter-spi.js";
import * as Component from "../Component.js";
import { addEventListener, insert, renderToString, template } from "../dom.js";
import { bindExpression, expressionCode } from "../portable-extract.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";
import { FakeDocument } from "./resume-fake-dom.js";

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

/** Frozen v5 wire fixture: v4 shape under the current version literal. */
const MANIFEST_V5 =
  '{"version":5,"buildId":"future-resume-build","events":{},"components":{"c0":{"region":{"kind":"comment-pair"},"bindings":{"count":{"kind":"state","key":"count","value":1,"dehydratedAt":1700000000000}}}},"expressions":{"x0":{"target":{"kind":"text"},"code":{"version":1,"kind":"portable.code","id":"future.resume.spi.expression","buildId":"future-resume-build","captures":{"label":"Count"}},"deps":["af:binding:c0/count"],"component":"c0"}}}';

const Expression = expressionCode({
  id: "future.resume.spi.encoded",
  buildId: BuildId,
  captures: Schema.Struct({}),
  dependencies: Schema.Tuple([Schema.Number]),
  render: (_captures, [count]) => `v${count}`,
});

describe("Resume adapter SPI and wire stability", () => {
  it("[M9] validates adapter-supplied encoded binding writes instead of trusting them", async () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => {
        const span = template("<span>")();
        insert(span, bindExpression(Expression, {}, [bindings.count]));
        return span;
      },
    ).pipe(Component.withDefinition({ name: "FutureSpiCounter" }));
    const scope = Scope.makeUnsafe();
    const collected = Effect.runSync(
      Resume.collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
            ),
          ),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    const root = new FakeDocument([
      { kind: "component", id: "c0", edge: "start" },
      { kind: "expression", id: "x0", edge: "start" },
      { kind: "text", value: "v1" },
      { kind: "expression", id: "x0", edge: "end" },
      { kind: "component", id: "c0", edge: "end" },
    ]);
    const diagnostics: Array<Resume.ClientDiagnostic> = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest: collected.manifest,
        expectedBuildId: BuildId,
        resolverEntries: { [Expression.id]: Expression },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    // The escape hatch applies an already-encoded value.
    Effect.runSync(installation.writeBindingEncoded("c0", "count", 5));
    await vi.waitFor(() => expect(root.regionText("x0")).toBe("v5"));

    // The escape hatch trusts the adapter's *encoding* (there is no retained
    // per-binding codec client-side — that is why `writeBinding` takes one),
    // but a value the dependent expression's dependency codec rejects must
    // still fail closed: a classified diagnostic, no defect, and the last good
    // value left standing in the DOM. Never a wrong patch.
    Effect.runSync(installation.writeBindingEncoded("c0", "count", "not-a-number"));
    await vi.waitFor(() => expect(installation.pending()).toBe(0));
    expect(root.regionText("x0")).toBe("v5");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "expression-execution-failure",
    ]);

    // …and a later valid write recovers.
    Effect.runSync(installation.writeBindingEncoded("c0", "count", 6));
    await vi.waitFor(() => expect(root.regionText("x0")).toBe("v6"));

    // An unknown binding name is an error, never a silently created binding.
    const unknown = Effect.runSyncExit(
      installation.writeBindingEncoded("c0", "nope", 1),
    );
    expect(Exit.isFailure(unknown)).toBe(true);
    if (Exit.isFailure(unknown)) {
      expect(Cause.hasDies(unknown.cause)).toBe(false);
      expect(
        Cause.findErrorOption(unknown.cause).pipe(
          Option.map((error) => error._tag),
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

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M9] attributes an oversized payload to its largest component binding", async () => {
    const Big = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>()
        .bind("small", () => Component.state("s"), {
          resume: Resume.snapshotState(Schema.String),
        })
        .bind("large", () => Component.state("x".repeat(4_000)), {
          resume: Resume.snapshotState(Schema.String),
        }),
      () => null,
    ).pipe(Component.withDefinition({ name: "FutureOversizedComponent" }));
    const collectBig = (scope: Scope.Scope, maxPayloadBytes: number) =>
      Resume.collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              Component.renderEffect(Big, {}).pipe(Scope.provide(scope)),
            ),
          ),
        { buildId: BuildId, maxPayloadBytes },
      ).pipe(Effect.provide(Serialization.layer));

    const scope = Scope.makeUnsafe();
    const exit = Effect.runSyncExit(collectBig(scope, 512));
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const error = Cause.findErrorOption(exit.cause).pipe(
      Option.getOrElse(() => undefined),
    );
    expect(error?._tag).toBe("ResumePayloadTooLargeError");
    if (error?._tag !== "ResumePayloadTooLargeError") return;
    // Per the design review: attribution must reach the *binding*, so the first
    // real collision is debuggable without bisecting the component tree.
    expect(error.largestEntryKind).toBe("component");
    expect(error.largestEntryId).toBe("c0");
    expect(error.largestEntryBytes).toBeGreaterThan(4_000);
    expect(error.largestBindingName).toBe("large");
    // The message names the binding too: the error is often only ever *read*
    // in a server log, not destructured.
    expect(error.message).toContain('"large"');

    // NEGATIVE CONTROL. The same component under a ceiling it fits collects
    // successfully, and both bindings survive — without this, a collector that
    // failed every payload would satisfy the assertions above forever.
    const roomyScope = Scope.makeUnsafe();
    const collected = Effect.runSync(collectBig(roomyScope, 64_000));
    Effect.runSync(Scope.close(roomyScope, Exit.void));
    expect(collected.manifest.version).not.toBe(1);
    if (collected.manifest.version === 1) return;
    const [componentId, snapshot] =
      Object.entries(collected.manifest.components)[0] ?? [];
    expect(componentId).toBe("c0");
    expect(Object.keys(snapshot?.bindings ?? {}).sort()).toEqual([
      "large",
      "small",
    ]);
  });

  it("[M9] installs every frozen manifest fixture from v1 through v5", async () => {
    const SaveCode = Portable.code({
      id: "future.resume.spi.save",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: () => Effect.void,
    });
    const FixtureExpression = expressionCode({
      id: "future.resume.spi.expression",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (captures, [count]) => `${captures.label}: ${count}`,
    });
    const resolverEntries = {
      [SaveCode.id]: SaveCode,
      [FixtureExpression.id]: FixtureExpression,
    };

    const fixtures = [
      ["v1", MANIFEST_V1, 1],
      ["v2", MANIFEST_V2, 2],
      ["v3", MANIFEST_V3, 3],
      ["v4", MANIFEST_V4, 4],
      ["v5", MANIFEST_V5, 5],
    ] as const;

    for (const [label, serialized, version] of fixtures) {
      const manifest = Effect.runSync(
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
      const installation = Effect.runSync(
        Resume.installClient({
          root: root.asDocument(),
          manifest,
          expectedBuildId: BuildId,
          resolverEntries,
          runtime,
        }),
      );
      // Decoding an old payload is not enough; it must still *work*. For every
      // expression version the restored subscriber patches the SSR region.
      if (version >= 3) {
        Effect.runSync(
          installation.writeBinding("c0", "count", Schema.Number, 4),
        );
        await vi.waitFor(() => {
          expect(root.regionText("x0"), label).toBe("Count: 4");
        });
      }
      await Effect.runPromise(installation.dispose);
      expect(installation.inspect(), label).toMatchObject({
        disposed: true,
        pendingFibers: 0,
        eventListeners: 0,
        expressionControllers: 0,
      });
      await runtime.dispose();
    }
  });

  it("[M9] embeds the manifest as inert, CSP-safe JSON that reads back byte-identically", () => {
    // Every character class that can break out of, or corrupt, an inline block.
    const evil =
      "</script><script>alert(1)</script>" + "  " + "<!-- &";
    const SaveCode = Portable.code({
      id: "future.resume.spi.csp",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: () => Effect.void,
    });
    const action = Effect.runSync(
      Component.action(Portable.bind(SaveCode, { label: evil })),
    );
    const collected = Effect.runSync(
      Resume.collect(
        () =>
          renderToString(() => {
            const button = template("<button>Save")();
            addEventListener(button, "click", Resume.event(action), true);
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
    expect(collected.script).not.toContain(" ");
    expect(collected.script).not.toContain(" ");

    // …and the client reads the same bytes back off the DOM.
    const inner = collected.script
      .replace(/^<script[^>]*>/, "")
      .replace(/<\/script>$/, "");
    expect(inner).toBe(collected.serializedManifest);
    const decoded = Effect.runSync(
      Resume.decodeManifest(inner, BuildId).pipe(
        Effect.provide(Serialization.layer),
      ),
    );
    const entry = Object.values(decoded.events)[0];
    expect(entry !== undefined && "code" in entry && entry.code.captures).toEqual(
      { label: evil },
    );
  });

  it("[M9] exposes a runtime-readable spiVersion an adapter can fail closed on", () => {
    // Ratified DQ-011: a runtime-readable `spiVersion` lets an adapter fail
    // closed on mismatch, exactly like the build-ID gate.
    const { spiVersion } = Resume;

    // Readable at runtime without constructing anything: an adapter must be
    // able to check compatibility before it calls a single SPI member.
    expect(typeof spiVersion).toBe("string");
    expect(spiVersion.length).toBeGreaterThan(0);
    // The identifier lives in the reserved framework namespace (DQ-089).
    expect(spiVersion.startsWith("af.")).toBe(true);

    // An adapter's fail-closed check is a plain comparison, and it must
    // actually discriminate. Both halves are here on purpose: a `spiVersion`
    // that compared equal to everything (or to nothing) would satisfy one of
    // these and fail the other.
    const compatible = (declared: string) => declared === spiVersion;
    expect(compatible(spiVersion)).toBe(true);
    expect(compatible(`${spiVersion}-not-this-one`)).toBe(false);

    // Stable across reads, and identical on both published surfaces: a
    // version derived per call would make every adapter fail closed against
    // itself, and a drifting copy would gate against the wrong surface.
    expect(AdapterSpi.spiVersion).toBe(spiVersion);
  });

  it("[M9] freezes the adapter SPI's member list behind a published surface", () => {
    // DQ-011 resolved by the permissive-package milestone (S1): the SPI ships
    // on the `adapter-spi` subpath, and its member list is frozen around what
    // this test file itself exercises. The pin is exhaustive and sorted: an
    // accidental addition or removal fails here, not at a consumer.
    expect(Object.keys(AdapterSpi).sort()).toEqual([
      "ActivationEventEntrySchema",
      "BindingName",
      "BindingSnapshotSchema",
      "ComponentId",
      "ComponentRegionSchema",
      "ComponentSnapshotSchema",
      "EventEntrySchema",
      "EventId",
      "EventType",
      "ExpressionEntrySchema",
      "ExpressionEntryV3Schema",
      "ExpressionEntryV4Schema",
      "ExpressionEntryV5Schema",
      "ExpressionId",
      "ExpressionTargetV5Schema",
      "ManifestLoaderEntrySchema",
      "ManifestSchema",
      "ManifestV1Schema",
      "ManifestV2Schema",
      "ManifestV3Schema",
      "ManifestV4Schema",
      "ManifestV5Schema",
      "PortableEventEntrySchema",
      "QueryBindingSnapshotSchema",
      "ResumeBindingSnapshotNotFoundError",
      "ResumeBindingSnapshotNotWritableError",
      "ResumeBindingSnapshotWriteDisposedError",
      "ResumeBindingSnapshotWriteEncodeError",
      "ResumeClientBuildMismatchError",
      "ResumeConfigurationError",
      "ResumeManifestDecodeError",
      "ResumePayloadTooLargeError",
      "ResumeSerializerMismatchError",
      "StateBindingSnapshotSchema",
      "decodeManifest",
      "installClient",
      "spiVersion",
    ]);

    // The SPI members are the same objects `Resume` exports — a re-export,
    // not a parallel copy that could drift.
    expect(AdapterSpi.decodeManifest).toBe(Resume.decodeManifest);
    expect(AdapterSpi.installClient).toBe(Resume.installClient);
    expect(AdapterSpi.ManifestSchema).toBe(Resume.ManifestSchema);

    // The subpath is published: package.json must expose ./adapter-spi with
    // build artifacts, or an external consumer cannot reach the surface.
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      readonly exports: Record<string, unknown>;
    };
    expect(pkg.exports["./adapter-spi"]).toEqual({
      import: "./dist/adapter-spi.js",
      types: "./dist/adapter-spi.d.ts",
    });
  });
});
