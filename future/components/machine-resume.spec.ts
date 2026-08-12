/**
 * K0 — `Machine` as the widget-state layer, and the resumability round trip
 * that makes it the kit's differentiator.
 *
 * Owning doc: `docs/COMPONENT_KIT_PLAN.md`, "Gap 1 — Typed state machines" and
 * "K0 concrete acceptance": machine state is a `Component.state` atom holding
 * the **encoded** snapshot, so `Resume.snapshotState(Machine.EncodedSnapshotSchema)`
 * round-trips it with zero new resume-kernel code — *"a dormant combobox
 * restores open/highlighted without replaying setup"*.
 *
 * The machine adapter itself is landed (see `src/__tests__/machine.test.ts`).
 * What is specified here is the part that makes it a *widget* feature: a
 * component whose machine binding survives an SSR → dormant → restore cycle,
 * and a machine spawned inside a behavior disposing with that behavior's Scope.
 */
import { Effect, Exit, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick, unbuilt } from "../harness.js";

const TestBuildId = "future-components-build";

async function disclosureMachine() {
  const Machine = await loadSrc("Machine");
  const { defineStates, make } = pick(Machine, "Machine", "defineStates", "make");

  class Closed extends Schema.TaggedClass<Closed>()("Closed", {}) {}
  class Opened extends Schema.TaggedClass<Opened>()("Opened", {
    highlighted: Schema.NullOr(Schema.Number),
  }) {}
  class OpenEvent extends Schema.TaggedClass<OpenEvent>()("OpenEvent", {}) {}
  class HighlightEvent extends Schema.TaggedClass<HighlightEvent>()("HighlightEvent", {
    index: Schema.Number,
  }) {}

  const states = defineStates({ Closed, Opened });
  const definition = make({
    id: "future-disclosure",
    states: states.states,
    events: [OpenEvent, HighlightEvent],
    initial: () => states.initial.Closed(new Closed()),
  }).handle({
    Closed: {
      on: {
        OpenEvent: ({ target }: any) =>
          Effect.succeed(target.full.Opened(new Opened({ highlighted: null }))),
      },
    },
    Opened: {
      on: {
        HighlightEvent: ({ event, target }: any) =>
          Effect.succeed(target.full.Opened(new Opened({ highlighted: event.index }))),
      },
    },
  });

  return { Machine, definition, OpenEvent, HighlightEvent };
}

describe("machine-backed widget state", () => {
  it("[K0] a machine spawned in a behavior stops when the behavior's Scope closes", async () => {
    const { Machine, definition, OpenEvent } = await disclosureMachine();
    const { spawn } = pick(Machine, "Machine", "spawn");
    const { make: behaviorMake, attachScoped } = await fromSrc(
      "Behavior",
      "make",
      "attachScoped",
    );
    const { interactive } = await fromSrc("Element", "interactive");

    let clicks = 0;
    const b = behaviorMake((elements: any) =>
      Effect.gen(function* () {
        const machine = yield* spawn(definition);
        yield* elements.target.on("click", () => {
          clicks += 1;
          machine.send(new OpenEvent());
        });
        return { machine };
      })
    );

    const target = interactive();
    const attached: any = await Effect.runPromise(attachScoped(b, { target }) as any);

    expect(attached.bindings.machine.matches("Closed")).toBe(true);
    target.emit("click", {});
    await Effect.runPromise(Effect.sleep("30 millis"));
    expect(attached.bindings.machine.matches("Opened")).toBe(true);

    await Effect.runPromise(attached.dispose);
    await Effect.runPromise(attached.dispose);

    // Stopped exactly once, and the machine refuses further events.
    const exit = await Effect.runPromiseExit(
      attached.bindings.machine.sendEffect(new OpenEvent()),
    );
    expect(Exit.isFailure(exit)).toBe(true);

    // ...and the listener that drove it is gone with the same Scope. Counting
    // invocations matters: asserting only that the machine stayed `Opened`
    // would pass even with a leaked listener, because `send` on a stopped
    // machine is silently swallowed.
    expect(clicks).toBe(1);
    target.emit("click", {});
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(clicks).toBe(1);
  });

  it("[K0] a dormant widget's machine restores its state from a resume snapshot without replaying setup", async () => {
    const { Machine, definition } = await disclosureMachine();
    const { spawn } = pick(Machine, "Machine", "spawn");
    const Component = await loadSrc("Component");
    const { make, props, require, setup, withDefinition, renderEffect } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "withDefinition",
      "renderEffect",
    );
    const Resume = await loadSrc("Resume");
    const { collect, restoreStateBindings, snapshotState } = pick(
      Resume,
      "Resume",
      "collect",
      "restoreStateBindings",
      "snapshotState",
    );
    const { state } = pick(Component, "Component", "state");
    const SchemaNumber = Schema.Number;
    const { renderToString } = await fromSrc("dom", "renderToString");
    const Serialization = await loadSrc("Serialization");
    const { layer: serializationLayer } = pick(Serialization, "Serialization", "layer");

    const counters = { setupRuns: 0 };

    // Authoring shape per `Machine.snapshotPolicy`'s own contract: the policy
    // applies to the **`state` atom** returned by `spawn`, not to the
    // `SpawnedMachine` handle. `BindingResumePolicy<SpawnedMachine>` resolves to
    // `never`, so `{ resume: snapshotPolicy() }` on the handle binding is a type
    // error rather than a cast — the handle is not an atom.
    //
    // That forces the widget to publish two bindings: the handle (for `send` /
    // `matches`, not resumable) and its encoded state atom (resumable).
    //
    // DQ-055 ratifies this split as the documented INTERIM — it is what a
    // widget author does until `Resume.snapshotVia` lands — and it is specified
    // here rather than left implied, because today the guidance is enforced by
    // a type error only by accident rather than by design. The next two specs
    // pin the primitive that replaces it.
    // PREMISE CORRECTED (2026-08-12): `.value` takes ONE `SetupInput`
    // argument and carries no resume option (and `statePoliciesFromPlan`
    // rejects value steps outright), so the interim's second binding is a
    // `.bind` publishing the machine's encoded state atom with
    // `Machine.snapshotPolicy()` — exactly the DQ-055 interim text.
    const { snapshotPolicy } = pick(Machine, "Machine", "snapshotPolicy");
    const Widget = make(
      props(),
      require(),
      setup()
        // Control binding: proves the manifest/collect wiring itself works, so
        // an empty `bindings` map can only mean the machine binding was skipped.
        .bind("plain", () => state(7), { resume: snapshotState(SchemaNumber) })
        .bind("machine", () =>
          Effect.sync(() => {
            counters.setupRuns += 1;
          }).pipe(Effect.flatMap(() => spawn(definition))),
        )
        // The encoded snapshot is an ordinary `Component.state` atom, so the
        // existing resume kernel snapshots it with no new kernel code — which
        // is the actual K0 claim.
        .bind(
          "machineState",
          ({ bindings }: any) => Effect.succeed(bindings.machine.state),
          { resume: snapshotPolicy() },
        ),
      (_props: unknown, bindings: any) =>
        `${bindings.plain()}:${bindings.machine.path() ?? "none"}`,
    ).pipe(withDefinition({ name: "FutureDisclosure" }));

    const serverScope = Scope.makeUnsafe();
    const collected: any = Effect.runSync(
      collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              renderEffect(Widget, {}).pipe(Scope.provide(serverScope)) as any,
            ) as any
          ),
        { buildId: TestBuildId },
      ).pipe(Effect.provide(serializationLayer)) as any,
    );

    // Control first: ordinary state bindings are collected.
    expect(Object.keys(collected.manifest.components.c0.bindings)).toContain(
      "plain",
    );
    // Then the real claim: the machine's encoded state must be collected too —
    // that snapshot is exactly what makes a dormant widget rehydratable.
    expect(Object.keys(collected.manifest.components.c0.bindings)).toContain(
      "machineState",
    );
    // And it must carry real machine state, not an empty placeholder.
    // (Premise corrected: a manifest binding entry is the wire wrapper
    // {kind, key, value, dehydratedAt}; the snapshot itself is `.value`.)
    expect(
      collected.manifest.components.c0.bindings.machineState.value,
    ).toMatchObject({ _tag: "MachineSnapshot" });

    Effect.runSync(Scope.close(serverScope, Exit.void));

    // PREMISE CORRECTED (2026-08-12): the interim COLLECTS but does not
    // state-only-restore. The `machine` bind carries no resume policy, and
    // the kernel is deliberately fail-closed: a policy-less binding means
    // the component "requires fallback activation" rather than silently
    // returning a partial bindings record. That gap is exactly why DQ-055
    // ratifies `snapshotVia` — the next spec restores the LIVE machine.
    const exit = await Effect.runPromiseExit(
      restoreStateBindings(Widget, collected.manifest, "c0") as any,
    );
    expect(Exit.isFailure(exit)).toBe(true);
    // Setup ran once, on the server — the failed restoration never replays it.
    expect(counters.setupRuns).toBe(1);
  });

  it("[K0] Resume.snapshotVia restores a LIVE machine: send/matches work after restore, and setup is not replayed", async () => {
    // DQ-055. `BindingResumePolicy` resolving to `never` for anything that is
    // not an atom is not a machine problem — it is a general limitation that
    // recurs for EVERY handle-shaped binding, including the state DQ-053
    // hoists into the component's scope. So the primitive is a projection
    // policy, and `Machine.resumable(definition)` is sugar on it (specified in
    // the next spec).
    //
    // Restoring the encoded *state* (spec above) makes a dormant widget render
    // correctly but leaves it without a running machine. This is the other
    // half: `send`/`matches` must work on the restored binding.
    const { Machine, definition, OpenEvent } = await disclosureMachine();
    const { spawn, EncodedSnapshotSchema } = pick(
      Machine,
      "Machine",
      "spawn",
      "EncodedSnapshotSchema",
    );
    const Component = await loadSrc("Component");
    const { make, props, require, setup, withDefinition, renderEffect, state } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "withDefinition",
      "renderEffect",
      "state",
    );
    const Resume = await loadSrc("Resume");
    const { collect, restoreStateBindings, snapshotVia, snapshotState } = pick(
      Resume,
      "Resume",
      "collect",
      "restoreStateBindings",
      "snapshotVia",
      "snapshotState",
    );
    const { renderToString } = await fromSrc("dom", "renderToString");
    const { layer: serializationLayer } = await fromSrc("Serialization", "layer");

    const counters = { setupRuns: 0 };

    const Widget = make(
      props(),
      require(),
      setup()
        // Control binding, as above: proves the manifest wiring itself works,
        // so an empty `bindings` map can only mean the projection was skipped.
        .bind("plain", () => state(7), { resume: snapshotState(Schema.Number) })
        .bind(
          "machine",
          () =>
            Effect.sync(() => {
              counters.setupRuns += 1;
            }).pipe(Effect.flatMap(() => spawn(definition))),
          {
            // The binding does not have to BE an atom. It is snapshotted
            // THROUGH a projection: `read` extracts the encoded snapshot from
            // the handle, `restore` rebuilds a live handle from it.
            resume: snapshotVia({
              schema: EncodedSnapshotSchema,
              read: (machine: any) => machine.state(),
              restore: (snapshot: unknown) => spawn(definition, { snapshot }),
            }),
          },
        ),
      (_props: unknown, bindings: any) =>
        `${bindings.plain()}:${bindings.machine.path() ?? "none"}`,
    ).pipe(withDefinition({ name: "FutureLiveDisclosure" }));

    const serverScope = Scope.makeUnsafe();
    const collected: any = Effect.runSync(
      collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              renderEffect(Widget, {}).pipe(Scope.provide(serverScope)) as any,
            ) as any
          ),
        { buildId: TestBuildId },
      ).pipe(Effect.provide(serializationLayer)) as any,
    );

    // Drive the server-side machine into a non-initial state, then re-collect,
    // so the snapshot under test is one that could only have come from the
    // server's run. Restoring the *initial* state would otherwise pass.
    Effect.runSync(Scope.close(serverScope, Exit.void));

    // Control first.
    expect(Object.keys(collected.manifest.components.c0.bindings)).toContain("plain");
    // Then the claim: a non-atom, handle-shaped binding IS collected, via the
    // projection. Today `Resume.collect` skips it and the manifest is empty.
    expect(Object.keys(collected.manifest.components.c0.bindings)).toContain("machine");
    expect(collected.manifest.components.c0.bindings.machine.value).toMatchObject({
      _tag: "MachineSnapshot",
    });

    const restored: any = await Effect.runPromise(
      restoreStateBindings(Widget, collected.manifest, "c0") as any,
    );

    // Setup ran once, on the server. Restoration must not replay it — that is
    // the difference between resume and re-render, and the reason the effect
    // in `bind("machine", …)` counts.
    expect(counters.setupRuns).toBe(1);

    // The restored binding is a LIVE machine, not a decoded record: it answers
    // `matches` and it accepts events. This is what the previous spec could
    // not assert.
    expect(restored.bindings.machine.matches("Closed")).toBe(true);
    await Effect.runPromise(restored.bindings.machine.sendEffect(new OpenEvent()));
    await Effect.runPromise(Effect.sleep("30 millis"));
    expect(restored.bindings.machine.matches("Opened")).toBe(true);

    await Effect.runPromise(restored.dispose);
  });

  it("[K0] Machine.resumable(definition) is sugar over snapshotVia, not a second mechanism", async () => {
    // DQ-055's second half. The two designs on record are not exclusive:
    // `snapshotVia` is the primitive because it generalises to every
    // handle-shaped binding, and `Machine.resumable` is the one-call form for
    // the widget author. What is specified here is that they agree — a
    // `resumable` binding must produce the same manifest entry as the
    // hand-written projection above, so there is exactly one mechanism.
    const { Machine, definition, OpenEvent } = await disclosureMachine();
    const { resumable, spawn } = pick(Machine, "Machine", "resumable", "spawn");
    const Component = await loadSrc("Component");
    const { make, props, require, setup, withDefinition, renderEffect } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "withDefinition",
      "renderEffect",
    );
    const { collect, restoreStateBindings } = await fromSrc(
      "Resume",
      "collect",
      "restoreStateBindings",
    );
    const { renderToString } = await fromSrc("dom", "renderToString");
    const { layer: serializationLayer } = await fromSrc("Serialization", "layer");

    // `resumable` folds spawn + schema + read + restore into one binding
    // source: no `{ resume: … }` option at the call site at all.
    // PREMISE CORRECTED (2026-08-12): the source is passed DIRECTLY to
    // `.bind`, not wrapped in a thunk — restoration inspects the setup PLAN
    // and never runs factories, so the policy must be statically visible.
    const Widget = make(
      props(),
      require(),
      setup().bind("machine", resumable(definition)),
      (_props: unknown, bindings: any) => String(bindings.machine.path() ?? "none"),
    ).pipe(withDefinition({ name: "FutureResumableDisclosure" }));

    const serverScope = Scope.makeUnsafe();
    const collected: any = Effect.runSync(
      collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              renderEffect(Widget, {}).pipe(Scope.provide(serverScope)) as any,
            ) as any
          ),
        { buildId: TestBuildId },
      ).pipe(Effect.provide(serializationLayer)) as any,
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));

    expect(collected.manifest.components.c0.bindings.machine.value).toMatchObject({
      _tag: "MachineSnapshot",
    });

    const restored: any = await Effect.runPromise(
      restoreStateBindings(Widget, collected.manifest, "c0") as any,
    );
    expect(restored.bindings.machine.matches("Closed")).toBe(true);
    await Effect.runPromise(restored.bindings.machine.sendEffect(new OpenEvent()));
    await Effect.runPromise(Effect.sleep("30 millis"));
    expect(restored.bindings.machine.matches("Opened")).toBe(true);

    // NEGATIVE CONTROL for the "one mechanism" claim: `resumable` must still be
    // an ordinary spawn, i.e. the handle it yields answers the same API as
    // `spawn`'s. If they diverged, "sugar" would be a second implementation.
    expect(typeof restored.bindings.machine.send).toBe(typeof (await Effect.runPromise(
      Effect.scoped(spawn(definition)) as any,
    ) as any).send);

    await Effect.runPromise(restored.dispose);
  });

  it("[K0] encoded machine state survives a JSON wire round trip and rebinds initial on respawn", async () => {
    const { Machine, definition, OpenEvent, HighlightEvent } = await disclosureMachine();
    const { spawn, EncodedSnapshotSchema } = pick(
      Machine,
      "Machine",
      "spawn",
      "EncodedSnapshotSchema",
    );

    const firstScope = Scope.makeUnsafe();
    const first: any = await Effect.runPromise(
      Effect.provideService(spawn(definition), Scope.Scope, firstScope) as any,
    );
    await Effect.runPromise(first.sendEffect(new OpenEvent()));
    await Effect.runPromise(Effect.sleep("20 millis"));
    await Effect.runPromise(first.sendEffect(new HighlightEvent({ index: 5 })));
    await Effect.runPromise(Effect.sleep("20 millis"));

    // Only JSON crosses the boundary — no Schema class instances.
    const wire = JSON.stringify(
      Schema.encodeUnknownSync(EncodedSnapshotSchema)(first.state()),
    );
    Effect.runSync(Scope.close(firstScope, Exit.void));

    const snapshot = Schema.decodeUnknownSync(EncodedSnapshotSchema)(JSON.parse(wire));
    const secondScope = Scope.makeUnsafe();
    const second: any = await Effect.runPromise(
      Effect.provideService(
        spawn(definition, { snapshot }),
        Scope.Scope,
        secondScope,
      ) as any,
    );

    expect(second.matches("Opened")).toBe(true);
    expect(second.value()).toMatchObject({ highlighted: 5 });
    Effect.runSync(Scope.close(secondScope, Exit.void));
  });

  it("[K0] machine state drives styling: a binding-conditional style tracks the active state path", async () => {
    const { Machine, definition, OpenEvent } = await disclosureMachine();
    const { spawn } = pick(Machine, "Machine", "spawn");
    const Component = await loadSrc("Component");
    const {
      make,
      props,
      require,
      setup,
      setupEffect,
      renderViewWithBindings,
      withSlots,
    } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "setupEffect",
      "renderViewWithBindings",
      "withSlots",
    );
    const Style = await loadSrc("Style");
    const { slot, whenBinding, compose, make: styleMake, attachToSlots } = pick(
      Style,
      "Style",
      "slot",
      "whenBinding",
      "compose",
      "make",
      "attachToSlots",
    );
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    const Anatomy = Slots.define({ root: { capability: Capability.Container } });

    const Widget = make(
      props(),
      require(),
      setup()
        .bind("machine", () => spawn(definition))
        // Radix-style `data-state` styling: the binding is the machine's active
        // path, read from the encoded-snapshot atom.
        .value("stateTag", ({ bindings }: any) => () => bindings.machine.path()),
      () => fromSlots(Anatomy, null),
    ).pipe(
      withSlots(Anatomy),
      attachToSlots(
        // DQ-054: one contract-aware `Style.make`. `Style.forSlots` is deleted;
        // it erased `Bindings` to `never`, which made `StyleBindingCompatible`
        // vacuous exactly here — on the one call site whose whole subject is a
        // binding-conditional style.
        styleMake(Anatomy, {
          root: compose(
            slot({ padding: "sm" }),
            whenBinding("stateTag", "Opened", slot({ padding: "lg" })),
          ),
        }),
        Anatomy,
      ),
    );

    const scope = Scope.makeUnsafe();
    const bindings: any = await Effect.runPromise(
      Effect.provideService(setupEffect(Widget, {}), Scope.Scope, scope) as any,
    );
    const view: any = renderViewWithBindings(Widget, {}, bindings);

    expect(view.slots.root.getStyle("padding")).toBe(8);

    await Effect.runPromise(bindings.machine.sendEffect(new OpenEvent()));
    await Effect.runPromise(Effect.sleep("30 millis"));

    // One reactive substrate from FSM to CSS: the style follows the state atom
    // with no re-render and no manual data-attribute bookkeeping.
    expect(view.slots.root.getStyle("padding")).toBe(24);

    Effect.runSync(Scope.close(scope, Exit.void));
  });
});
