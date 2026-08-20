import { describe, expect, it } from "vitest";
import { Effect, Exit, Schema, Scope } from "effect";
import * as Component from "../Component.js";
import * as Machine from "../Machine.js";
import * as Resume from "../Resume.js";

class Idle extends Schema.TaggedClass<Idle>()("Idle", {}) {}
class Open extends Schema.TaggedClass<Open>()("Open", {
  highlighted: Schema.NullOr(Schema.Number),
}) {}
class OpenEvent extends Schema.TaggedClass<OpenEvent>()("OpenEvent", {}) {}
class CloseEvent extends Schema.TaggedClass<CloseEvent>()("CloseEvent", {}) {}
class HighlightEvent extends Schema.TaggedClass<HighlightEvent>()("HighlightEvent", {
  index: Schema.Number,
}) {}

const states = Machine.defineStates({ Idle, Open });

const DisclosureMachine = Machine.make({
  id: "disclosure",
  states: states.states,
  events: [OpenEvent, CloseEvent, HighlightEvent],
  initial: () => states.initial.Idle(new Idle()),
}).handle({
  Idle: {
    on: {
      OpenEvent: ({ target }: { target: any }) =>
        Effect.succeed(target.full.Open(new Open({ highlighted: null }))),
    },
  },
  Open: {
    on: {
      CloseEvent: ({ target }: { target: any }) =>
        Effect.succeed(target.full.Idle(new Idle())),
      HighlightEvent: ({ event, target }: { event: HighlightEvent; target: any }) =>
        Effect.succeed(target.full.Open(new Open({ highlighted: event.index }))),
    },
  },
});

async function spawnInScope<A, E>(
  effect: Effect.Effect<A, E, Scope.Scope>,
): Promise<{ readonly value: A; readonly close: () => void }> {
  const scope = Scope.makeUnsafe();
  const value = await Effect.runPromise(
    Effect.provideService(effect, Scope.Scope, scope),
  );
  return {
    value,
    close: () => {
      Effect.runSync(Scope.close(scope, Exit.void));
    },
  };
}

describe("Machine adapter", () => {
  it("spawns with encoded Component.state and transitions on send", async () => {
    const { value: handle, close } = await spawnInScope(Machine.spawn(DisclosureMachine));

    expect(handle.matches("Idle")).toBe(true);
    expect(handle.path()).toBe("Idle");
    expect(handle.state()._tag).toBe("MachineSnapshot");
    expect(handle.state().active[0]?.path).toBe("Idle");

    handle.send(new OpenEvent());
    await Effect.runPromise(Effect.sleep("30 millis"));

    expect(handle.matches("Open")).toBe(true);
    expect(handle.path()).toBe("Open");
    expect(handle.value()).toMatchObject({ _tag: "Open", highlighted: null });

    handle.send(new HighlightEvent({ index: 2 }));
    await Effect.runPromise(Effect.sleep("30 millis"));
    expect(handle.value()).toMatchObject({ _tag: "Open", highlighted: 2 });

    close();
  });

  it("sendEffect awaits the accepted transition", async () => {
    const { value: handle, close } = await spawnInScope(Machine.spawn(DisclosureMachine));

    await Effect.runPromise(handle.sendEffect(new OpenEvent()));
    await Effect.runPromise(Effect.sleep("10 millis"));

    expect(handle.matches("Open")).toBe(true);
    close();
  });

  it("stops exactly once on Scope close and double-stop is a no-op", async () => {
    const { value: handle, close } = await spawnInScope(Machine.spawn(DisclosureMachine));

    await Effect.runPromise(handle.stop);
    await Effect.runPromise(handle.stop);
    close();

    await expect(
      Effect.runPromise(handle.sendEffect(new OpenEvent()) as Effect.Effect<void, unknown, never>),
    ).rejects.toBeTruthy();
  });

  it("restores from an encoded snapshot without replaying default initial", async () => {
    const first = await spawnInScope(Machine.spawn(DisclosureMachine));
    await Effect.runPromise(first.value.sendEffect(new OpenEvent()));
    await Effect.runPromise(Effect.sleep("20 millis"));
    first.value.send(new HighlightEvent({ index: 7 }));
    await Effect.runPromise(Effect.sleep("20 millis"));

    const snapshot = first.value.state();
    expect(snapshot.active[0]?.path).toBe("Open");
    first.close();

    const second = await spawnInScope(
      Machine.spawn(DisclosureMachine, { snapshot }),
    );

    expect(second.value.matches("Open")).toBe(true);
    expect(second.value.value()).toMatchObject({ _tag: "Open", highlighted: 7 });
    second.close();
  });

  it("round-trips encoded state through Resume.snapshotState schema", async () => {
    const { value: handle, close } = await spawnInScope(Machine.spawn(DisclosureMachine));
    handle.send(new OpenEvent());
    await Effect.runPromise(Effect.sleep("30 millis"));

    const policy = Machine.snapshotPolicy();
    expect(policy.kind).toBe("state");
    expect(policy).toEqual(Resume.snapshotState(Machine.EncodedSnapshotSchema));

    const encoded = Schema.encodeSync(Machine.EncodedSnapshotSchema)(handle.state());
    const decoded = Schema.decodeUnknownSync(Machine.EncodedSnapshotSchema)(encoded);
    expect(decoded.active[0]?.path).toBe("Open");

    close();
  });

  it("works inside Component.setup with Component.state-backed machine state", async () => {
    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () =>
        Effect.gen(function* () {
          const machine = yield* Machine.spawn(DisclosureMachine);
          return { machine };
        }),
      (_props, bindings) => bindings.machine.path() ?? "none",
    );

    const scope = Scope.makeUnsafe();
    const bindings = await Effect.runPromise(
      Effect.provideService(
        Component.setupEffect(Widget, {}),
        Scope.Scope,
        scope,
      ),
    );

    expect(bindings.machine.matches("Idle")).toBe(true);
    await Effect.runPromise(bindings.machine.sendEffect(new OpenEvent()));
    await Effect.runPromise(Effect.sleep("20 millis"));
    expect(bindings.machine.matches("Open")).toBe(true);

    Effect.runSync(Scope.close(scope, Exit.void));
  });
});
