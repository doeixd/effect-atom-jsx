/**
 * Invariants that are already fixed and must never regress.
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
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Schema,
  Scope,
} from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fromSrc } from "../harness.js";
import { FakeDocument, type FakeNode } from "./fake-dom.js";

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

interface SaveLog {
  readonly saves: Array<string>;
}

async function kit() {
  const Resume = await fromSrc(
    "Resume",
    "collect",
    "installClient",
    "restoreStateBindings",
    "snapshotState",
    "snapshotQuery",
    "addressable",
    "activationOf",
    "inspectHandle",
    "event",
  );
  const Component = await fromSrc(
    "Component",
    "make",
    "props",
    "require",
    "setup",
    "state",
    "query",
    "action",
    "renderEffect",
    "withDefinition",
  );
  const dom = await fromSrc("dom", "renderToString", "template", "insert");
  const Serialization = await fromSrc("Serialization", "layer");
  const Portable = await fromSrc(
    "Portable",
    "code",
    "bind",
    "describe",
    "makeResolver",
    "BuildId",
    "Resolver",
  );
  const extract = await fromSrc("portable-extract", "expressionCode", "bindExpression");
  const Context = await import("effect").then((m) => m.Context);
  const SaveService = Context.Service<{
    readonly save: (label: string) => Effect.Effect<void>;
  }>("future/resume/SaveService");
  const ClientSaveCode = Portable.code({
    id: "future.resume.invariants.save",
    buildId: BuildId,
    captures: Schema.Struct({ label: Schema.String }),
    run: (captures: any) =>
      Effect.gen(function* () {
        const saves = yield* SaveService;
        yield* saves.save(captures.label);
      }),
  });
  const saveRuntime = (log: SaveLog) =>
    ManagedRuntime.make(
      Layer.succeed(SaveService, {
        save: (label: string) =>
          Effect.sync(() => {
            log.saves.push(label);
          }),
      }),
    );
  const portableEventEntry = (label: string) => ({
    type: "click",
    invocation: "deferred-no-args",
    code: runSync(
      Portable.describe(Portable.bind(ClientSaveCode, { label })),
    ),
  });
  const activationEventEntry = {
    type: "click",
    invocation: "activation-projection",
    projection: "mouse-v1",
    targetKey: "save",
  };
  const makeActivationCode = (id: string) =>
    Portable.code({
      id,
      buildId: BuildId,
      captures: Schema.Struct({}),
      run: () => Effect.succeed({ dispose: Effect.void }),
    });
  const componentEntry = (executable: unknown) => ({
    region: { kind: "comment-pair" },
    activation: runSync(Portable.describe(executable)),
    bindings: {},
  });
  const buildId = decode(Portable.BuildId)(BuildId);

  return {
    Resume,
    Component,
    dom,
    Serialization,
    Portable,
    extract,
    ClientSaveCode,
    saveRuntime,
    portableEventEntry,
    activationEventEntry,
    makeActivationCode,
    componentEntry,
    buildId,
  };
}

describe("Resumability invariants (regression detectors)", () => {
  beforeAll(() => {
    vi.stubGlobal("Node", class {});
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("[M0-7.4] lets exactly one owner consume an interaction crossing two portable markers", async () => {
    const { Resume, ClientSaveCode, saveRuntime, portableEventEntry, buildId } =
      await kit();
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
    };
    const log: SaveLog = { saves: [] };
    const runtime = saveRuntime(log);
    const installation = runSync(
      Resume.installClient({
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

    await runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M0-7.4] claims exclusively at an activation marker below a portable ancestor marker", async () => {
    const {
      Resume,
      ClientSaveCode,
      saveRuntime,
      portableEventEntry,
      activationEventEntry,
      makeActivationCode,
      componentEntry,
      Portable,
      buildId,
    } = await kit();
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
    };
    const log: SaveLog = { saves: [] };
    const runtime = saveRuntime(log);
    const installation = runSync(
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

    await runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M0-7.4] does not start an ancestor activation when a closer portable marker consumed the event", async () => {
    const {
      Resume,
      ClientSaveCode,
      saveRuntime,
      portableEventEntry,
      activationEventEntry,
      makeActivationCode,
      componentEntry,
      Portable,
      buildId,
    } = await kit();
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
    };
    const log: SaveLog = { saves: [] };
    const runtime = saveRuntime(log);
    const installation = runSync(
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

    await runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M8.2] rolls a typed activation failure back to dormant ownership and permits one retry", async () => {
    const { Resume, Component, dom, Serialization, Portable, extract } = await kit();
    const Expression = extract.expressionCode({
      id: "future.resume.invariants.expression",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (captures: any, [count]: readonly [number]) =>
        `${captures.label}: ${count}`,
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
          extract.bindExpression(Expression, { label: "Count" }, [bindings.count]),
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
    const installation = runSync(
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

    const failure = await runPromise(
      installation.activate("c0").pipe(Effect.flip),
    );
    expect(failure._tag).toBe("ResumeComponentActivationResolutionError");
    // Rolled back, not failed terminally: the dormant expression is rearmed.
    expect(installation.boundaryState("c0")).toEqual({ status: "dormant" });
    expect(installation.inspect()).toMatchObject({
      expressionControllers: 1,
      expressionSubscriptions: 1,
    });
    runSync(installation.writeBinding("c0", "count", Schema.Number, 2));
    await vi.waitFor(() => expect(root.regionText("x0")).toBe("Count: 2"));

    // And the retry succeeds, taking ownership exactly once.
    await runPromise(installation.activate("c0"));
    expect({ loadAttempts, executions }).toEqual({
      loadAttempts: 2,
      executions: 1,
    });
    expect(installation.boundaryState("c0")).toEqual({ status: "active" });
    expect(installation.inspect()).toMatchObject({
      expressionControllers: 0,
      expressionSubscriptions: 0,
    });

    await runPromise(installation.dispose);
    expect(disposals).toBe(1);
    await runtime.dispose();
  });

  it("[M0-7.6] rolls a failed restored render back to SSR content before exactly one activation mount", async () => {
    const { Resume, Component, dom, Serialization } = await kit();
    let setupRuns = 0;
    let viewRuns = 0;
    const Exploding = Component.make(
      Component.props(),
      Component.require(),
      Component.setup().bind(
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
    const collected = runSync(
      Resume.collect(
        () =>
          dom.renderToString(() =>
            runSync(
              Component.renderEffect(Exploding, {}).pipe(Scope.provide(scope)),
            ),
          ),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
    runSync(Scope.close(scope, Exit.void));
    expect({ setupRuns, viewRuns }).toEqual({ setupRuns: 1, viewRuns: 1 });

    const activation = Resume.activationOf(Exploding);
    const diagnostics: Array<any> = [];
    const root = new FakeDocument([
      { kind: "component", id: "c0", edge: "start" },
      { kind: "component", id: "c0", edge: "end" },
    ]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest: collected.manifest,
        expectedBuildId: BuildId,
        resolverEntries: { [activation.id]: activation },
        runtime,
        onDiagnostic: (diagnostic: any) => diagnostics.push(diagnostic),
      }),
    );

    await runPromise(installation.resume("c0"));

    // One classified fallback, one mount, never a terminal failure and never a
    // second copy of the region.
    expect(installation.boundaryState("c0")).toEqual({ status: "active" });
    expect({ setupRuns, viewRuns }).toEqual({ setupRuns: 2, viewRuns: 3 });
    expect(diagnostics).toMatchObject([
      { code: "component-resumption-fallback", componentId: "c0" },
    ]);

    await runPromise(installation.dispose);
    await runtime.dispose();
  });

  // Owner tag corrected: this is the "Smaller:" item in the M0-7 audit
  // findings ("public `restoreStateBindings` silently allows double-restore of
  // one componentId"), not numbered finding 8 (deep-freeze bypass), which this
  // spec does not exercise at all.
  it("[M0-7.smaller] fails closed when one component boundary is restored twice", async () => {
    const { Resume, Component, dom, Serialization } = await kit();
    const Counter = Component.make(
      Component.props(),
      Component.require(),
      Component.setup().bind("count", () => Component.state(7), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      () => null,
    ).pipe(Component.withDefinition({ name: "FutureDoubleRestore" }));
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

    const first = runSync(
      Resume.restoreStateBindings(Counter, collected.manifest, "c0"),
    );
    const duplicate = runSync(
      Resume.restoreStateBindings(Counter, collected.manifest, "c0").pipe(
        Effect.flip,
      ),
    );
    expect(duplicate._tag).toBe("ResumeDuplicateComponentRestorationError");

    // Disposal releases the claim, so a legitimate later restore still works.
    runSync(first.dispose);
    const second = runSync(
      Resume.restoreStateBindings(Counter, collected.manifest, "c0"),
    );
    expect(second.registry.get(second.bindings.count)).toBe(7);
    runSync(second.dispose);
  });

  it("[M0-7.smaller] rolls a restored query back to its settled state when a refresh is interrupted", async () => {
    const { Resume, Component, dom, Serialization, Portable } = await kit();
    const ServerQueryCode = Portable.code({
      id: "future.resume.invariants.query",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures: any) => Effect.succeed(`server:${captures.label}`),
    });
    const QueryCard = Component.make(
      Component.props(),
      Component.require(),
      Component.setup().bind(
        "data",
        () =>
          Component.query(Portable.bind(ServerQueryCode, { label: "todos" }), {
            reactivityKeys: ["todos"],
          }),
        { resume: Resume.snapshotQuery(Schema.String) },
      ),
      (_props: unknown, bindings: any) => {
        const result = bindings.data();
        return result._tag === "Success" ? result.value : "pending";
      },
    ).pipe(Component.withDefinition({ name: "FutureInterruptQueryCard" }));
    const scope = Scope.makeUnsafe();
    const collected = runSync(
      Resume.collect(
        () =>
          dom.renderToString(() =>
            runSync(
              Component.renderEffect(QueryCard, {}).pipe(Scope.provide(scope)),
            ),
          ),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
    runSync(Scope.close(scope, Exit.void));

    let releaseRun!: () => void;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const GatedClientCode = Portable.code({
      id: ServerQueryCode.id,
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures: any) =>
        Effect.promise(async () => {
          await runGate;
          return `client:${captures.label}`;
        }),
    });
    const resolver = runSync(
      Portable.makeResolver({ [GatedClientCode.id]: GatedClientCode }),
    );
    const restored = runSync(
      Resume.restoreStateBindings(QueryCard, collected.manifest, "c0"),
    );
    const settled = Resume.inspectHandle(restored.bindings.data)!;
    expect(settled.read()).toMatchObject({
      _tag: "Success",
      value: "server:todos",
    });

    const fiber = runFork(
      restored.queries["data"]!.refresh.pipe(
        Effect.provideService(Portable.Resolver, resolver),
      ),
    );
    await vi.waitFor(() => expect(settled.read()._tag).toBe("Refreshing"));
    await runPromise(Fiber.interrupt(fiber));
    releaseRun();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Interruption is not a query failure: the pre-refresh settled value stands.
    expect(settled.read()).toMatchObject({
      _tag: "Success",
      value: "server:todos",
    });
    runSync(restored.dispose);
  });
});
