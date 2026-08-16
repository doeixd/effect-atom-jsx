/**
 * DQ-055 (ratified) — `Resume.snapshotVia` is the projection primitive for
 * handle-shaped bindings, and `Machine.resumable(definition)` is sugar over
 * it (one mechanism). Authoritative scenarios live in
 * `future/components/machine-resume.spec.ts`; these keep the primitive
 * covered by `npm test`.
 */
import { describe, expect, it } from "vitest";
import { Effect, Exit, Schema, Scope } from "effect";
import * as Component from "../Component.js";
import { renderToString } from "../dom.js";
import * as Machine from "../Machine.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";

const BuildId = "machine-resumable-build";
const c0 = Schema.decodeUnknownSync(Resume.ComponentId)("c0");
const machineBinding = Schema.decodeUnknownSync(Resume.BindingName)("machine");

class Closed extends Schema.TaggedClass<Closed>()("Closed", {}) {}
class Opened extends Schema.TaggedClass<Opened>()("Opened", {
  highlighted: Schema.NullOr(Schema.Number),
}) {}
class OpenEvent extends Schema.TaggedClass<OpenEvent>()("OpenEvent", {}) {}

const states = Machine.defineStates({ Closed, Opened });
const definition = Machine.make({
  id: "resumable-disclosure",
  states: states.states,
  events: [OpenEvent],
  initial: () => states.initial.Closed(new Closed()),
}).handle({
  Closed: {
    on: {
      OpenEvent: ({ target }: { target: any }) =>
        Effect.succeed(target.full.Opened(new Opened({ highlighted: null }))),
    },
  },
  Opened: { on: {} },
});

const collectWidget = (
  widget: Component.Component<{}, Scope.Scope, any, any, any>,
) => {
  const scope = Scope.makeUnsafe();
  const collected = Effect.runSync(
    Resume.collect(
      () =>
        renderToString(() =>
          Effect.runSync(
            Component.renderEffect(widget, {}).pipe(Scope.provide(scope)),
          )
        ),
      { buildId: BuildId },
    ).pipe(Effect.provide(Serialization.layer)),
  );
  Effect.runSync(Scope.close(scope, Exit.void));
  return collected;
};

describe("Resume.snapshotVia", () => {
  it("collects a handle-shaped binding through its projection and restores a LIVE handle", async () => {
    const counters = { setupRuns: 0 };
    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "machine",
        () =>
          Effect.sync(() => {
            counters.setupRuns += 1;
          }).pipe(Effect.flatMap(() => Machine.spawn(definition))),
        {
          resume: Resume.snapshotVia({
            schema: Machine.EncodedSnapshotSchema,
            read: (machine: Machine.SpawnedMachine) => machine.state(),
            restore: (snapshot) => Machine.spawn(definition, { snapshot }),
          }),
        },
      ),
      (_props, bindings) => String(bindings.machine.path() ?? "none"),
    ).pipe(Component.withDefinition({ name: "ViaDisclosure" }));

    const collected = collectWidget(Widget);
    expect(collected.manifest.version).not.toBe(1);
    if (collected.manifest.version === 1) return;
    // The wire entry is an ordinary state wrapper — no manifest change.
    expect(collected.manifest.components[c0]?.bindings[machineBinding]).toMatchObject({
      kind: "state",
      value: { _tag: "MachineSnapshot" },
    });

    const restoreScope = Scope.makeUnsafe();
    const restored = await Effect.runPromise(
      Resume.restoreStateBindings(Widget, collected.manifest, "c0").pipe(
        Scope.provide(restoreScope),
      ),
    );
    // Setup ran once, on the server; restore rebuilt through the projection.
    expect(counters.setupRuns).toBe(1);
    // LIVE handle: matches answers and events transition.
    expect(restored.bindings.machine.matches("Closed")).toBe(true);
    await Effect.runPromise(restored.bindings.machine.sendEffect(new OpenEvent()));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(restored.bindings.machine.matches("Opened")).toBe(true);

    await Effect.runPromise(restored.dispose);
    await Effect.runPromise(Scope.close(restoreScope, Exit.void));
  });

  it("a failing via-restore fails closed as a typed snapshot error", async () => {
    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("machine", () => Machine.spawn(definition), {
        resume: Resume.snapshotVia({
          schema: Machine.EncodedSnapshotSchema,
          read: (machine: Machine.SpawnedMachine) => machine.state(),
          restore: () => Effect.fail(new Error("boom")),
        }),
      }),
      () => null,
    ).pipe(Component.withDefinition({ name: "ViaBroken" }));

    const collected = collectWidget(Widget);
    const exit = await Effect.runPromiseExit(
      Effect.scoped(Resume.restoreStateBindings(Widget, collected.manifest, "c0")),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("Machine.resumable", () => {
  it("is sugar over snapshotVia: same wire entry, same live restore, no resume option at the call site", async () => {
    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("machine", Machine.resumable(definition)),
      (_props, bindings) => String(bindings.machine.path() ?? "none"),
    ).pipe(Component.withDefinition({ name: "SugarDisclosure" }));

    const collected = collectWidget(Widget);
    expect(collected.manifest.version).not.toBe(1);
    if (collected.manifest.version === 1) return;
    expect(collected.manifest.components[c0]?.bindings[machineBinding]).toMatchObject({
      kind: "state",
      value: { _tag: "MachineSnapshot" },
    });

    const restoreScope = Scope.makeUnsafe();
    const restored = await Effect.runPromise(
      Resume.restoreStateBindings(Widget, collected.manifest, "c0").pipe(
        Scope.provide(restoreScope),
      ),
    );
    expect(restored.bindings.machine.matches("Closed")).toBe(true);
    await Effect.runPromise(restored.bindings.machine.sendEffect(new OpenEvent()));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(restored.bindings.machine.matches("Opened")).toBe(true);
    await Effect.runPromise(restored.dispose);
    await Effect.runPromise(Scope.close(restoreScope, Exit.void));
  });
});
