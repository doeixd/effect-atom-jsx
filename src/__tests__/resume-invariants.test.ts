/**
 * Invariants that are already fixed and must never regress.
 *
 * Promoted from `future/resumability/invariants.spec.ts` (all green
 * 2026-08-12), retyped.
 *
 * Owning plans: the "M0-7 Test Audit Findings" and "M8 Test Audit Findings"
 * sections of `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` (findings 4, 5, 6, 8
 * and M8 findings 2, 5), plus `RESUMABILITY_M8C_PLAN.md`'s ownership
 * invariants.
 *
 * Unlike the rest of `future/`, these specs are expected to be GREEN today.
 * They are here because each one pins a behaviour that was broken once, is
 * subtle, and would fail silently and expensively if it broke again:
 *
 *  - exactly-once claim: the closest marker claims *and stops the walk*, for
 *    portable and activation markers alike, over two-marker chains;
 *  - activation staging: a typed failure rolls dormant ownership back and
 *    rearms pending expressions, and a later retry still works;
 *  - restoration failure rolls the region back to SSR content before exactly
 *    one activation mount — never a second copy;
 *  - duplicate component restoration fails closed;
 *  - an interrupted refresh rolls back to the settled state rather than
 *    publishing interruption as failure.
 *
 * A red result here is not a work item. It is a regression.
 */

import {
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Schema,
  Scope,
} from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Component from "../Component.js";
import { addEventListener, renderToString, template, insert } from "../dom.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";
import { bindExpression, expressionCode } from "../portable-extract.js";
import { FakeDocument, type FakeNode } from "./resume-fake-dom.js";

const BuildId = "future-resume-build";

interface SaveLog {
  readonly saves: Array<string>;
}

interface SaveServiceShape {
  readonly save: (label: string) => Effect.Effect<void>;
}

const SaveService = Context.Service<SaveServiceShape>(
  "future/resume/SaveService",
);

const ClientSaveCode = Portable.code<
  { readonly label: string },
  { readonly label: string },
  readonly [],
  void,
  never,
  SaveServiceShape
>({
  id: "future.resume.invariants.save",
  buildId: BuildId,
  captures: Schema.Struct({ label: Schema.String }),
  run: (captures) =>
    Effect.gen(function* () {
      const saves = yield* SaveService;
      yield* saves.save(captures.label);
    }),
});

function saveRuntime(log: SaveLog) {
  return ManagedRuntime.make(
    Layer.succeed(SaveService, {
      save: (label: string) =>
        Effect.sync(() => {
          log.saves.push(label);
        }),
    }),
  );
}

function portableEventEntry(label: string) {
  return {
    type: "click",
    invocation: "deferred-no-args",
    code: Effect.runSync(
      Portable.describe(Portable.bind(ClientSaveCode, { label })),
    ),
  } as const;
}

const activationEventEntry = {
  type: "click",
  invocation: "activation-projection",
  projection: "mouse-v1",
  targetKey: "save",
} as const;

function makeActivationCode(id: string) {
  return Portable.code({
    id,
    buildId: BuildId,
    captures: Schema.Struct({}),
    run: () => Effect.succeed({ dispose: Effect.void }),
  });
}

function componentEntry(executable: Portable.AnyBoundCode) {
  return {
    region: { kind: "comment-pair" },
    activation: Effect.runSync(Portable.describe(executable)),
    bindings: {},
  } as const;
}

const buildId = Schema.decodeUnknownSync(Portable.BuildId)(BuildId);

describe("Resumability invariants (regression detectors)", () => {
  beforeAll(() => {
    vi.stubGlobal("Node", class {});
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("[M0-7.4] lets exactly one owner consume an interaction crossing two portable markers", async () => {
    const root = new FakeDocument([
      { kind: "element", attributes: { "data-af-event-click": "e1" } },
      { kind: "element", attributes: { "data-af-event-click": "e0" } },
    ]);
    const [ancestor, child] = [root.element(0), root.element(1)] as [
      FakeNode,
      FakeNode,
    ];
    const manifest = {
      version: 1,
      buildId,
      events: { e0: portableEventEntry("child"), e1: portableEventEntry("parent") },
    } as Resume.Manifest;
    const log: SaveLog = { saves: [] };
    const runtime = saveRuntime(log);
    const installation = Effect.runSync(
      Resume.installClient({
        // boundary: fake DOM stands in for a real Document.
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: { [ClientSaveCode.id]: ClientSaveCode },
        runtime,
      }),
    );

    root.dispatchPath("click", [child, ancestor]);
    await vi.waitFor(() => {
      expect(installation.pending()).toBe(0);
      expect(log.saves.length).toBeGreaterThan(0);
    });
    // The closest marker claims and stops: the ancestor's same-type marker
    // must not also fire.
    expect(log.saves).toEqual(["child"]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M0-7.4] claims exclusively at an activation marker below a portable ancestor marker", async () => {
    const ActivationCode = makeActivationCode(
      "future.resume.invariants.claim-child-activation",
    );
    const root = new FakeDocument([
      { kind: "component", id: "c0", edge: "start" },
      {
        kind: "element",
        attributes: {
          "data-af-event-click": "e1",
          "data-af-replay-click": "save",
        },
      },
      { kind: "component", id: "c0", edge: "end" },
      { kind: "element", attributes: { "data-af-event-click": "e0" } },
    ]);
    const [child, ancestor] = [root.element(0), root.element(1)] as [
      FakeNode,
      FakeNode,
    ];
    const manifest = {
      version: 2,
      buildId,
      events: { e0: portableEventEntry("parent"), e1: activationEventEntry },
      components: { c0: componentEntry(Portable.bind(ActivationCode, {})) },
    } as Resume.Manifest;
    const log: SaveLog = { saves: [] };
    const runtime = saveRuntime(log);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {
          [ClientSaveCode.id]: ClientSaveCode,
          [ActivationCode.id]: ActivationCode,
        },
        runtime,
      }),
    );

    root.dispatchPath("click", [child, ancestor]);
    await vi.waitFor(() => {
      expect(installation.boundaryState("c0")).toEqual({ status: "active" });
      expect(installation.pending()).toBe(0);
    });
    // The activation marker consumed the interaction; the portable ancestor of
    // the same event type must not run a second owner.
    expect(log.saves).toEqual([]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M0-7.4] does not start an ancestor activation when a closer portable marker consumed the event", async () => {
    const ActivationCode = makeActivationCode(
      "future.resume.invariants.claim-ancestor-activation",
    );
    const root = new FakeDocument([
      { kind: "component", id: "c0", edge: "start" },
      {
        kind: "element",
        attributes: {
          "data-af-event-click": "e1",
          "data-af-replay-click": "save",
        },
      },
      { kind: "component", id: "c0", edge: "end" },
      { kind: "element", attributes: { "data-af-event-click": "e0" } },
    ]);
    const [ancestor, child] = [root.element(0), root.element(1)] as [
      FakeNode,
      FakeNode,
    ];
    const manifest = {
      version: 2,
      buildId,
      events: { e0: portableEventEntry("child"), e1: activationEventEntry },
      components: { c0: componentEntry(Portable.bind(ActivationCode, {})) },
    } as Resume.Manifest;
    const log: SaveLog = { saves: [] };
    const runtime = saveRuntime(log);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {
          [ClientSaveCode.id]: ClientSaveCode,
          [ActivationCode.id]: ActivationCode,
        },
        runtime,
      }),
    );

    // The portable marker is the closest on this path.
    root.dispatchPath("click", [child, ancestor]);
    await vi.waitFor(() => {
      expect(log.saves).toEqual(["child"]);
      expect(installation.pending()).toBe(0);
    });
    expect(installation.boundaryState("c0")).toEqual({ status: "dormant" });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M8.2] rolls a typed activation failure back to dormant ownership and permits one retry", async () => {
    const Expression = expressionCode({
      id: "future.resume.invariants.expression",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (captures, [count]) => `${captures.label}: ${count}`,
    });
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
          bindExpression(Expression, { label: "Count" }, [bindings.count]),
        );
        return span;
      },
    ).pipe(
      Component.withDefinition({ name: "FutureRetryableCounter" }),
      Resume.addressable({
        id: "future.resume.invariants.retryable-counter",
        buildId: BuildId,
        props: Schema.Struct({}),
      }),
    );
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

    const activation = Resume.activationOf(Counter);
    let loadAttempts = 0;
    let executions = 0;
    let disposals = 0;
    const RetryableActivation = Portable.code({
      id: activation.id,
      buildId: BuildId,
      captures: Schema.Struct({}),
      run: () =>
        Effect.sync(() => {
          executions += 1;
          return {
            dispose: Effect.sync(() => {
              disposals += 1;
            }),
          };
        }),
    });
    const root = new FakeDocument([
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
        manifest: collected.manifest,
        expectedBuildId: BuildId,
        resolverEntries: {
          [activation.id]: () =>
            Effect.suspend(() => {
              loadAttempts += 1;
              return loadAttempts === 1
                ? Effect.fail("transient-activation-load-failure")
                : Effect.succeed(RetryableActivation);
            }),
          [Expression.id]: Expression,
        },
        runtime,
      }),
    );

    const failure = await Effect.runPromise(
      installation.activate("c0").pipe(Effect.flip),
    );
    expect(failure._tag).toBe("ResumeComponentActivationResolutionError");
    // Rolled back, not failed terminally: the dormant expression is rearmed.
    expect(installation.boundaryState("c0")).toEqual({ status: "dormant" });
    expect(installation.inspect()).toMatchObject({
      expressionControllers: 1,
      expressionSubscriptions: 1,
    });
    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 2));
    await vi.waitFor(() => expect(root.regionText("x0")).toBe("Count: 2"));

    // And the retry succeeds, taking ownership exactly once.
    await Effect.runPromise(installation.activate("c0"));
    expect({ loadAttempts, executions }).toEqual({
      loadAttempts: 2,
      executions: 1,
    });
    expect(installation.boundaryState("c0")).toEqual({ status: "active" });
    expect(installation.inspect()).toMatchObject({
      expressionControllers: 0,
      expressionSubscriptions: 0,
    });

    await Effect.runPromise(installation.dispose);
    expect(disposals).toBe(1);
    await runtime.dispose();
  });

  it("[M0-7.6] rolls a failed restored render back to SSR content before exactly one activation mount", async () => {
    let setupRuns = 0;
    let viewRuns = 0;
    const Exploding = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "count",
        () =>
          Effect.sync(() => {
            setupRuns += 1;
          }).pipe(Effect.flatMap(() => Component.state(1))),
        { resume: Resume.snapshotState(Schema.Number) },
      ),
      () => {
        viewRuns += 1;
        if (viewRuns === 2) {
          throw new Error("render failed after restoration committed");
        }
        return null;
      },
    ).pipe(
      Component.withDefinition({ name: "FutureInRenderFallback" }),
      Resume.addressable({
        id: "future.resume.invariants.in-render-fallback",
        buildId: BuildId,
        props: Schema.Struct({}),
      }),
    );
    const scope = Scope.makeUnsafe();
    const collected = Effect.runSync(
      Resume.collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              Component.renderEffect(Exploding, {}).pipe(Scope.provide(scope)),
            ),
          ),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
    Effect.runSync(Scope.close(scope, Exit.void));
    expect({ setupRuns, viewRuns }).toEqual({ setupRuns: 1, viewRuns: 1 });

    const activation = Resume.activationOf(Exploding);
    const diagnostics: Array<Resume.ClientDiagnostic> = [];
    const root = new FakeDocument([
      { kind: "component", id: "c0", edge: "start" },
      { kind: "component", id: "c0", edge: "end" },
    ]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest: collected.manifest,
        expectedBuildId: BuildId,
        resolverEntries: { [activation.id]: activation },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    await Effect.runPromise(installation.resume("c0"));

    // One classified fallback, one mount, never a terminal failure and never a
    // second copy of the region.
    expect(installation.boundaryState("c0")).toEqual({ status: "active" });
    expect({ setupRuns, viewRuns }).toEqual({ setupRuns: 2, viewRuns: 3 });
    expect(diagnostics).toMatchObject([
      { code: "component-resumption-fallback", componentId: "c0" },
    ]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  // Owner tag corrected: this is the "Smaller:" item in the M0-7 audit
  // findings ("public `restoreStateBindings` silently allows double-restore of
  // one componentId"), not numbered finding 8 (deep-freeze bypass), which this
  // spec does not exercise at all.
  it("[M0-7.smaller] fails closed when one component boundary is restored twice", async () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(7), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      () => null,
    ).pipe(Component.withDefinition({ name: "FutureDoubleRestore" }));
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

    const first = Effect.runSync(
      Resume.restoreStateBindings(Counter, collected.manifest, "c0"),
    );
    const duplicate = Effect.runSync(
      Resume.restoreStateBindings(Counter, collected.manifest, "c0").pipe(
        Effect.flip,
      ),
    );
    expect(duplicate._tag).toBe("ResumeDuplicateComponentRestorationError");

    // Disposal releases the claim, so a legitimate later restore still works.
    Effect.runSync(first.dispose);
    const second = Effect.runSync(
      Resume.restoreStateBindings(Counter, collected.manifest, "c0"),
    );
    expect(second.registry.get(second.bindings.count)).toBe(7);
    Effect.runSync(second.dispose);
  });

  it("[M0-7.smaller] rolls a restored query back to its settled state when a refresh is interrupted", async () => {
    const ServerQueryCode = Portable.code({
      id: "future.resume.invariants.query",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures) => Effect.succeed(`server:${captures.label}`),
    });
    const QueryCard = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "data",
        () =>
          Component.query(Portable.bind(ServerQueryCode, { label: "todos" }), {
            reactivityKeys: ["todos"],
          }),
        { resume: Resume.snapshotQuery(Schema.String) },
      ),
      (_props, bindings) => {
        const result = bindings.data();
        return result._tag === "Success" ? result.value : "pending";
      },
    ).pipe(Component.withDefinition({ name: "FutureInterruptQueryCard" }));
    const scope = Scope.makeUnsafe();
    const collected = Effect.runSync(
      Resume.collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              Component.renderEffect(QueryCard, {}).pipe(Scope.provide(scope)),
            ),
          ),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    let releaseRun!: () => void;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const GatedClientCode = Portable.code({
      id: ServerQueryCode.id,
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures) =>
        Effect.promise(async () => {
          await runGate;
          return `client:${captures.label}`;
        }),
    });
    const resolver = Effect.runSync(
      Portable.makeResolver({ [GatedClientCode.id]: GatedClientCode }),
    );
    const restored = Effect.runSync(
      Resume.restoreStateBindings(QueryCard, collected.manifest, "c0"),
    );
    const settled = Resume.inspectHandle(restored.bindings.data)!;
    expect(settled.read()).toMatchObject({
      _tag: "Success",
      value: "server:todos",
    });

    const fiber = Effect.runFork(
      restored.queries["data"]!.refresh.pipe(
        Effect.provideService(Portable.Resolver, resolver),
      ),
    );
    await vi.waitFor(() => expect(settled.read()._tag).toBe("Refreshing"));
    await Effect.runPromise(Fiber.interrupt(fiber));
    releaseRun();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Interruption is not a query failure: the pre-refresh settled value stands.
    expect(settled.read()).toMatchObject({
      _tag: "Success",
      value: "server:todos",
    });
    Effect.runSync(restored.dispose);
  });
});

describe("Exactly-once claim over the MODERN collect path (DQ-009 qualified markers)", () => {
  beforeAll(() => {
    vi.stubGlobal("Node", class {});
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // Promotion-expansion (2026-08-12): every claim-walk pin above hand-builds
  // a LEGACY manifest with unqualified markers ("e0"). No test walked a
  // two-marker chain on the modern path — a real `collect` with DQ-009
  // scope-qualified markers and its real manifest — where the unscope step
  // sits between the marker and the claim. The markers here are extracted
  // from the actually served HTML, not hand-spelled, so a marker-spelling
  // drift between collect and install fails this test rather than both
  // sides agreeing with each other.
  it("lets exactly one owner consume an interaction across two qualified portable markers", async () => {
    const action = (label: string) =>
      Effect.runSync(
        Component.action(Portable.bind(ClientSaveCode, { label })).pipe(
          Effect.provideService(SaveService, {
            save: () => Effect.die("the server must never run the action"),
          }),
        ),
      );
    const collected = await Effect.runPromise(
      Resume.collect(
        () =>
          renderToString(() => {
            const child = template("<button>Child")();
            addEventListener(child, "click", Resume.event(action("child")), true);
            const parent = template("<button>Parent")();
            addEventListener(parent, "click", Resume.event(action("parent")), true);
            return [child, parent];
          }),
        { buildId: BuildId, installationId: "page0" },
      ).pipe(Effect.provide(Serialization.layer)),
    );

    // Markers come from the REAL html: qualified, one per button.
    const markers = [
      ...collected.html.matchAll(/data-af-event-click="([^"]+)"/g),
    ].map((match) => match[1]!);
    expect(markers).toHaveLength(2);
    for (const marker of markers) expect(marker).toMatch(/^page0:/);

    const root = new FakeDocument([
      { kind: "element", attributes: { "data-af-event-click": markers[1]! } },
      { kind: "element", attributes: { "data-af-event-click": markers[0]! } },
    ]);
    const ancestor = root.element(0);
    const child = root.element(1);

    const log: SaveLog = { saves: [] };
    const runtime = saveRuntime(log);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest: collected.manifest,
        expectedBuildId: BuildId,
        resolverEntries: { [ClientSaveCode.id]: ClientSaveCode },
        runtime,
      }),
    );

    root.dispatchPath("click", [child, ancestor]);
    await vi.waitFor(() => {
      expect(installation.pending()).toBe(0);
      expect(log.saves.length).toBeGreaterThan(0);
    });
    // The closest QUALIFIED marker claims and stops the walk: the ancestor's
    // same-type marker must not also fire.
    expect(log.saves).toEqual(["child"]);

    // Still live for a second interaction — exact-once is per interaction.
    root.dispatchPath("click", [child, ancestor]);
    await vi.waitFor(() => {
      expect(log.saves).toEqual(["child", "child"]);
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });
});
