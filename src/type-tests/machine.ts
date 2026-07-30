import { Effect, Schema, Scope } from "effect";
import * as Machine from "../Machine.js";
import * as Resume from "../Resume.js";
import type * as Component from "../Component.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

class Idle extends Schema.TaggedClass<Idle>()("Idle", {}) {}
class Open extends Schema.TaggedClass<Open>()("Open", {
  highlighted: Schema.NullOr(Schema.Number),
}) {}
class OpenEvent extends Schema.TaggedClass<OpenEvent>()("OpenEvent", {}) {}
class CloseEvent extends Schema.TaggedClass<CloseEvent>()("CloseEvent", {}) {}

const states = Machine.defineStates({ Idle, Open });

const Disclosure = Machine.make({
  id: "disclosure",
  states: states.states,
  events: [OpenEvent, CloseEvent],
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
    },
  },
});

const spawnEffect: Effect.Effect<
  Machine.SpawnedMachine<OpenEvent | CloseEvent>,
  unknown,
  Scope.Scope
> = Machine.spawn(Disclosure);

void spawnEffect;

type Handle = Machine.SpawnedMachine<OpenEvent | CloseEvent>;

type _StateIsStateAtom = Expect<
  Equal<Handle["state"], Component.StateAtom<Machine.EncodedSnapshotValue>>
>;

type _SendAcceptsEvents = Expect<
  Equal<Parameters<Handle["send"]>[0], OpenEvent | CloseEvent>
>;

const policy: Resume.StateSnapshotPolicy<
  Machine.EncodedSnapshotValue,
  Machine.EncodedSnapshotValue
> = Machine.snapshotPolicy();

void policy;

const decoded: Machine.EncodedSnapshotValue =
  Schema.decodeUnknownSync(Machine.EncodedSnapshotSchema)({
    _tag: "MachineSnapshot",
    active: [{ path: "Idle", value: { _tag: "Idle" } }],
  });

void decoded;

const machineCheck: boolean = Machine.isMachine(Disclosure);
void machineCheck;
