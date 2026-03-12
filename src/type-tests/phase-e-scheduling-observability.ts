import { Effect, Layer, Schedule } from "effect";
import * as Atom from "../Atom.js";
import { defineMutation, defineQuery, type BridgeError, type MutationSupersededError } from "../effect-ts.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const runtime = Atom.runtime(Layer.empty);

const query = defineQuery(
  () => Effect.succeed(1),
  {
    runtime: runtime.managed,
    name: "typed-query",
    retrySchedule: Schedule.recurs(2),
    pollSchedule: Schedule.recurs(3),
    observe: (event) => {
      const _kind: "query" = event.kind;
      const _phase: "start" | "success" | "failure" | "defect" = event.phase;
      const _duration: number | undefined = event.durationMs;
      void _kind;
      void _phase;
      void _duration;
    },
  },
);

type QueryEffectType = ReturnType<typeof query.effect>;
declare const queryEffectValue: QueryEffectType;
const _queryEffectAssignable: Effect.Effect<number, BridgeError, never> = queryEffectValue;

const mutation = defineMutation(
  (n: number) => n > 0 ? Effect.void : Effect.fail("bad" as const),
  {
    name: "typed-mutation",
    observe: (event) => {
      const _kind: "mutation" = event.kind;
      const _phase: "start" | "success" | "failure" | "defect" = event.phase;
      const _duration: number | undefined = event.durationMs;
      void _kind;
      void _phase;
      void _duration;
    },
  },
);

type MutationEffectType = ReturnType<typeof mutation.effect>;
declare const mutationEffectValue: MutationEffectType;
const _mutationEffectAssignable: Effect.Effect<void, "bad" | BridgeError | MutationSupersededError, never> = mutationEffectValue;

const action = Atom.action(
  (n: number) => Effect.succeed(n),
  {
    name: "typed-action",
    onTransition: (event) => {
      const _phase: "start" | "success" | "failure" | "defect" = event.phase;
      void _phase;
    },
  },
);

type ActionRunEffectType = ReturnType<typeof action.runEffect>;
declare const actionRunEffectValue: ActionRunEffectType;
const _actionRunEffectAssignable: Effect.Effect<number, BridgeError | MutationSupersededError, never> = actionRunEffectValue;

type _RuntimeShape = Expect<Equal<typeof runtime extends Atom.AtomRuntime<never, never> ? true : false, true>>;
