/**
 * 8c.6 — race, security, and ownership hardening for element targets.
 * Promoted from `future/resumability/hardening.spec.ts` (all green
 * 2026-08-12), retyped.
 *
 * Owning plan: `docs/RESUMABILITY_M8C_PLAN.md` 8c.6.
 *
 * Exit criterion being specified: "every failure is either a typed install
 * error, a named diagnostic, or a documented activation fallback — never a
 * silent patch to the wrong element." So every spec here asserts a *classified*
 * outcome plus the negative half: the DOM was not touched, nothing else loaded,
 * disposal stayed terminal.
 */

import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as Component from "../Component.js";
import { insert, renderToString, template } from "../dom.js";
import { bindExpression, expressionCode } from "../portable-extract.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";
import { FakeDocument, nonTextFixture } from "./resume-fake-dom.js";

const BuildId = "future-resume-build";

const Expression = expressionCode({
  id: "future.resume.expr.hardening",
  buildId: BuildId,
  captures: Schema.Struct({ label: Schema.String }),
  dependencies: Schema.Tuple([Schema.Number]),
  render: (captures, [count]) => `${captures.label}-${count}`,
});

function collectCounter(componentName = "FutureHardeningCounter") {
  const Counter = Component.make(
    Component.props<{}>(),
    Component.require<never>(),
    Component.setup<{}>().bind("count", () => Component.state(1), {
      resume: Resume.snapshotState(Schema.Number),
    }),
    (_props, bindings) => {
      const span = template("<span>")();
      insert(
        span,
        bindExpression(Expression, { label: "state" }, [bindings.count]),
      );
      return span;
    },
  ).pipe(Component.withDefinition({ name: componentName }));
  const scope = Scope.makeUnsafe();
  const result = Effect.runSync(
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
  // Closing before returning is deliberate and is *not* the
  // "teardown before assertion" defect: the value under test is the
  // serialized collect snapshot (html + manifest), not a live handle map.
  // A real server closes the render scope before it serializes, so a spec
  // that asserted against an open scope would be modelling the wrong thing.
  Effect.runSync(Scope.close(scope, Exit.void));
  return result;
}

const expressionId = (raw: string): Resume.ExpressionId =>
  Schema.decodeUnknownSync(Resume.ExpressionId)(raw);

function retarget(
  manifest: Resume.Manifest,
  targets: Readonly<Record<string, unknown>>,
): Resume.Manifest {
  const base = (manifest as { readonly expressions: Record<string, unknown> })
    .expressions[expressionId("x0")];
  const expressions: Record<string, unknown> = {};
  for (const [id, target] of Object.entries(targets)) {
    expressions[expressionId(id)] = { ...(base as object), target };
  }
  // boundary: retargeting swaps in a synthetic expression map for a manifest
  // built for a different fixture, which the wire type cannot express.
  return { ...manifest, expressions } as unknown as Resume.Manifest;
}

/** A failure must be a classified error, never a defect. */
function classifiedTag(exit: Exit.Exit<unknown, unknown>): string {
  if (!Exit.isFailure(exit)) return "success";
  expect(Cause.hasDies(exit.cause)).toBe(false);
  return Cause.findErrorOption(exit.cause).pipe(
    Option.map((error) => (error as { readonly _tag?: string })._tag ?? "untagged"),
    Option.getOrElse(() => "none"),
  );
}

describe("Non-text target hardening", () => {
  it("[M8c.6] rejects malformed, unknown, duplicate, and missing element markers with four distinct errors, and accepts a well-formed one", async () => {
    const manifest = retarget(collectCounter().manifest, {
      x0: { kind: "attribute", name: "title" },
    });
    const marker = Resume.ExpressionElementMarkerAttribute;

    const cases: ReadonlyArray<readonly [string, FakeDocument, string]> = [
      [
        "malformed marker",
        new FakeDocument(
          [
            { kind: "component", id: "c0", edge: "start" },
            { kind: "element", attributes: { [marker]: "x0  x0" } },
            { kind: "component", id: "c0", edge: "end" },
          ],
          marker,
        ),
        "ResumeInvalidExpressionElementMarkerError",
      ],
      [
        "unknown instance id",
        new FakeDocument(
          [
            { kind: "component", id: "c0", edge: "start" },
            { kind: "element", expressions: ["x9"] },
            { kind: "component", id: "c0", edge: "end" },
          ],
          marker,
        ),
        "ResumeUnknownExpressionElementTargetError",
      ],
      [
        "same instance marked on two elements",
        new FakeDocument(
          [
            { kind: "component", id: "c0", edge: "start" },
            { kind: "element", expressions: ["x0"] },
            { kind: "element", expressions: ["x0"] },
            { kind: "component", id: "c0", edge: "end" },
          ],
          marker,
        ),
        "ResumeDuplicateExpressionElementTargetError",
      ],
      [
        "missing marker entirely",
        new FakeDocument(
          [
            { kind: "component", id: "c0", edge: "start" },
            { kind: "element" },
            { kind: "component", id: "c0", edge: "end" },
          ],
          marker,
        ),
        "ResumeMissingExpressionElementTargetError",
      ],
    ];

    for (const [label, root, expectedTag] of cases) {
      const runtime = ManagedRuntime.make(Layer.empty);
      const exit = Effect.runSyncExit(
        Resume.installClient({
          root: root.asDocument(),
          manifest,
          expectedBuildId: BuildId,
          resolverEntries: {},
          runtime,
        }),
      );
      expect(classifiedTag(exit), label).toBe(expectedTag);
      // Fail closed means fail *before* mutating: on a rejected install the
      // marker attribute must still be exactly as SSR left it, so a retry or a
      // debugger can still see which element was claimed. (An unconditional
      // assertion, not a guarded one — a guard on "did any attribute survive"
      // would pass even if the install had stripped everything.)
      const element = root.element(0);
      if (label === "missing marker entirely") {
        expect(element.getAttribute!(marker), label).toBeNull();
      } else {
        expect(element.getAttribute!(marker), label).not.toBeNull();
      }
      await runtime.dispose();
    }

    // Near neighbours must not collapse into one generic code: a single
    // "something is wrong with this marker" error would satisfy all four
    // assertions above at once.
    const tags = cases.map(([, , expectedTag]) => expectedTag);
    expect(new Set(tags).size).toBe(tags.length);

    // NEGATIVE CONTROL. The valid wiring — one element, one marker, one
    // matching manifest instance — installs cleanly. Without this, an
    // implementation that rejected *every* element marker unconditionally
    // would satisfy every assertion above forever.
    const validRoot = nonTextFixture({
      markerAttribute: marker,
      elementExpressions: ["x0"],
      attributes: { title: "state-1" },
    });
    const validRuntime = ManagedRuntime.make(Layer.empty);
    const validExit = Effect.runSyncExit(
      Resume.installClient({
        root: validRoot.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime: validRuntime,
      }),
    );
    expect(classifiedTag(validExit)).toBe("success");
    // …and a successful install consumes the installation-only marker, so the
    // published DOM carries no protocol residue.
    expect(validRoot.element().getAttribute!(marker)).toBeNull();
    if (!Exit.isFailure(validExit)) {
      await Effect.runPromise(validExit.value.dispose);
    }
    await validRuntime.dispose();
  });

  it("[M8c.6] rejects a manifest target naming an element its component does not own", async () => {
    const manifest = retarget(collectCounter().manifest, {
      x0: { kind: "attribute", name: "title" },
    });
    // The marked element sits *outside* the c0 region the manifest claims.
    const root = new FakeDocument(
      [
        { kind: "component", id: "c0", edge: "start" },
        { kind: "text", value: "owned" },
        { kind: "component", id: "c0", edge: "end" },
        { kind: "element", expressions: ["x0"], attributes: { title: "state-1" } },
      ],
      Resume.ExpressionElementMarkerAttribute,
    );
    const runtime = ManagedRuntime.make(Layer.empty);
    const exit = Effect.runSyncExit(
      Resume.installClient({
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime,
      }),
    );
    expect(classifiedTag(exit)).toBe("ResumeExpressionOwnershipError");
    // No subscriber may have been allocated against a foreign element.
    expect(root.element().getAttribute!("title")).toBe("state-1");
    // Fail closed leaves the marker in place on the foreign element too: the
    // install must not have started cleaning up before it validated ownership.
    expect(
      root.element().getAttribute!(Resume.ExpressionElementMarkerAttribute),
    ).toBe("x0");
    await runtime.dispose();

    // NEGATIVE CONTROL. The identical manifest and marker, with the element
    // moved *inside* the component region it belongs to, installs cleanly —
    // so this spec fails if ownership validation is simply "always reject".
    const ownedRoot = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      elementExpressions: ["x0"],
      attributes: { title: "state-1" },
    });
    const ownedRuntime = ManagedRuntime.make(Layer.empty);
    const ownedExit = Effect.runSyncExit(
      Resume.installClient({
        root: ownedRoot.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime: ownedRuntime,
      }),
    );
    expect(classifiedTag(ownedExit)).toBe("success");
    if (!Exit.isFailure(ownedExit)) {
      await Effect.runPromise(ownedExit.value.dispose);
    }
    await ownedRuntime.dispose();
  });

  it("[M8c.6] fails closed when target metadata is tampered to a kind the marker contradicts", async () => {
    // A tampered payload says "text" while the DOM *also* carries an element
    // marker for the same instance.
    const textManifest = retarget(collectCounter().manifest, {
      x0: { kind: "text" },
    });
    // The durable text region for x0 is present, so a missing-boundary error
    // cannot explain the rejection: the only thing wrong with this DOM is the
    // contradicting element marker. (Before this fixture carried the text
    // region, this spec passed on `ResumeMissingExpressionBoundaryError` —
    // which a perfectly untampered text manifest would have produced too, so
    // it was green without testing tamper detection at all.)
    const root = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      textExpressionId: "x0",
      textValue: "state-1",
      elementExpressions: ["x0"],
      attributes: { title: "state-1" },
    });
    const runtime = ManagedRuntime.make(Layer.empty);
    const exit = Effect.runSyncExit(
      Resume.installClient({
        root: root.asDocument(),
        manifest: textManifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime,
      }),
    );
    const tamperedTag = classifiedTag(exit);
    expect(tamperedTag).toBe("ResumeExpressionTargetKindMismatchError");
    // A silent install that left an unowned marker on a live element is the
    // outcome this whole spec exists to forbid.
    expect(
      root.element().getAttribute!(Resume.ExpressionElementMarkerAttribute),
    ).toBe("x0");
    await runtime.dispose();

    // NEGATIVE CONTROL, and the near-neighbour separation the old version of
    // this spec was missing. The same text manifest over an *untampered* DOM —
    // durable text region, no element marker — installs cleanly, and the
    // genuinely boundary-less DOM produces a *different* code.
    const cleanRoot = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      textExpressionId: "x0",
      textValue: "state-1",
      elementExpressions: [],
    });
    const cleanRuntime = ManagedRuntime.make(Layer.empty);
    const cleanExit = Effect.runSyncExit(
      Resume.installClient({
        root: cleanRoot.asDocument(),
        manifest: textManifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime: cleanRuntime,
      }),
    );
    expect(classifiedTag(cleanExit)).toBe("success");
    if (!Exit.isFailure(cleanExit)) {
      await Effect.runPromise(cleanExit.value.dispose);
    }
    await cleanRuntime.dispose();

    const boundarylessRoot = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      elementExpressions: [],
    });
    const boundarylessRuntime = ManagedRuntime.make(Layer.empty);
    const boundarylessTag = classifiedTag(
      Effect.runSyncExit(
        Resume.installClient({
          root: boundarylessRoot.asDocument(),
          manifest: textManifest,
          expectedBuildId: BuildId,
          resolverEntries: {},
          runtime: boundarylessRuntime,
        }),
      ),
    );
    expect(boundarylessTag).toBe("ResumeMissingExpressionBoundaryError");
    expect(boundarylessTag).not.toBe(tamperedTag);
    await boundarylessRuntime.dispose();
  });

  it("[M8c.6] coalesces concurrent invalidations into one patch carrying the latest value", async () => {
    const manifest = retarget(collectCounter().manifest, {
      x0: { kind: "attribute", name: "title" },
    });
    const root = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      elementExpressions: ["x0"],
      attributes: { title: "state-1" },
    });
    const element = root.element();
    let renders = 0;
    let loads = 0;
    // The client-side module for the same code identity, instrumented.
    const CountingExpression = expressionCode({
      id: Expression.id,
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (captures, [count]) => {
        renders += 1;
        return `${captures.label}-${count}`;
      },
    });
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {
          [Expression.id]: () =>
            Effect.sync(() => {
              loads += 1;
              return CountingExpression;
            }),
        },
        runtime,
      }),
    );

    for (const value of [2, 3, 4, 5]) {
      Effect.runSync(
        installation.writeBinding("c0", "count", Schema.Number, value),
      );
    }
    await vi.waitFor(() => {
      expect(element.getAttribute!("title")).toBe("state-5");
      expect(installation.pending()).toBe(0);
    });
    // Four synchronous writes coalesce: one load, and far fewer renders than
    // writes — never an intermediate value left latched on the element.
    // Counted, not merely bounded above: `renders === 0` would mean the
    // element was patched by something other than the expression, which is a
    // worse bug than not coalescing.
    expect(loads).toBe(1);
    expect(renders).toBeGreaterThanOrEqual(1);
    expect(renders).toBeLessThan(4);
    expect(element.getAttribute!("title")).toBe("state-5");

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M8c.6] makes disposal terminal and idempotent for element targets", async () => {
    const manifest = retarget(collectCounter().manifest, {
      x0: { kind: "attribute", name: "title" },
    });
    const root = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      elementExpressions: ["x0"],
      attributes: { title: "state-1" },
    });
    const element = root.element();
    let loads = 0;
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {
          [Expression.id]: () =>
            Effect.sync(() => {
              loads += 1;
              return Expression;
            }).pipe(Effect.delay("50 millis")),
        },
        runtime,
      }),
    );

    // Queue work, then dispose while the module resolve is still in flight.
    // The pre-disposal write is asserted to *succeed*: it is the negative
    // control for the post-disposal failure below, without which an
    // implementation that rejected every write would satisfy this spec.
    const beforeDisposal = Effect.runSyncExit(
      installation.writeBinding("c0", "count", Schema.Number, 2),
    );
    expect(classifiedTag(beforeDisposal)).toBe("success");
    await Effect.runPromise(installation.dispose);
    // Idempotent: a second dispose is a no-op, not a failure.
    await Effect.runPromise(installation.dispose);
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Terminal: queued work can never patch after disposal.
    expect(element.getAttribute!("title")).toBe("state-1");
    expect(installation.inspect()).toMatchObject({
      disposed: true,
      pendingFibers: 0,
      expressionControllers: 0,
      expressionSubscriptions: 0,
      runningExpressions: 0,
      queuedExpressions: 0,
    });
    // A write after disposal is a classified failure, not a silent patch.
    const exit = Effect.runSyncExit(
      installation.writeBinding("c0", "count", Schema.Number, 3),
    );
    expect(classifiedTag(exit)).toBe("ResumeBindingSnapshotWriteDisposedError");
    expect(element.getAttribute!("title")).toBe("state-1");
    expect(loads).toBeLessThanOrEqual(1);
    await runtime.dispose();
  });

  it("[M8c.6] does not patch an element that left the document while work was in flight", async () => {
    const manifest = retarget(collectCounter().manifest, {
      x0: { kind: "attribute", name: "title" },
    });
    const root = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      elementExpressions: ["x0"],
      attributes: { title: "state-1" },
    });
    const element = root.element();
    const diagnostics: Array<{ readonly code: string }> = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {
          [Expression.id]: () =>
            Effect.succeed(Expression).pipe(Effect.delay("30 millis")),
        },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 2));
    // Ownership is rechecked immediately before the DOM write, so removing the
    // element mid-resolution must abandon the patch — classified, not silent.
    root.removeChild(element);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(element.getAttribute!("title")).toBe("state-1");
    expect(installation.pending()).toBe(0);
    // An abandoned patch is *classified*, not silent — so the list must be
    // exactly one specific code. `diagnostics.every(...)` was vacuous here: it
    // is trivially true for the empty array a silently-dropped patch produces.
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "expression-patch-failure",
    ]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M8c.6] keeps two installations from observing each other's reserved binding keys", async () => {
    const manifest = retarget(collectCounter().manifest, {
      x0: { kind: "attribute", name: "title" },
    });
    const makeRoot = () =>
      nonTextFixture({
        markerAttribute: Resume.ExpressionElementMarkerAttribute,
        elementExpressions: ["x0"],
        attributes: { title: "state-1" },
      });
    const first = makeRoot();
    const second = makeRoot();
    const runtime = ManagedRuntime.make(Layer.empty);
    const install = (root: FakeDocument) =>
      Effect.runSync(
        Resume.installClient({
          root: root.asDocument(),
          manifest,
          expectedBuildId: BuildId,
          resolverEntries: { [Expression.id]: Expression },
          runtime,
        }),
      );
    const a = install(first);
    const b = install(second);

    Effect.runSync(a.writeBinding("c0", "count", Schema.Number, 7));
    await vi.waitFor(() => {
      expect(first.element().getAttribute!("title")).toBe("state-7");
    });
    // No cross-request bleed: both installations share the reserved
    // `af:binding:c0/count` key name, and must still be isolated.
    expect(second.element().getAttribute!("title")).toBe("state-1");

    Effect.runSync(b.writeBinding("c0", "count", Schema.Number, 9));
    await vi.waitFor(() => {
      expect(second.element().getAttribute!("title")).toBe("state-9");
    });
    expect(first.element().getAttribute!("title")).toBe("state-7");

    await Effect.runPromise(a.dispose);
    await Effect.runPromise(b.dispose);
    await runtime.dispose();
  });
});
