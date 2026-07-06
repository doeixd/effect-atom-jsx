import { Effect, Layer, Schedule } from "effect";
import * as Atom from "../Atom.js";
import {
  defineMutation,
  defineQuery,
  type BridgeError,
  type MutationErrorOf,
  type MutationEffectErrorOf,
  type MutationInputOf,
  type MutationSuccessOf,
  type MutationSupersededError,
} from "../effect-ts.js";

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
type _MutationInput = Expect<Equal<MutationInputOf<typeof mutation>, number>>;
type _MutationError = Expect<Equal<MutationErrorOf<typeof mutation>, "bad">>;
type _MutationEffectError = Expect<Equal<MutationEffectErrorOf<typeof mutation>, "bad" | BridgeError | MutationSupersededError>>;
type _MutationSuccess = Expect<Equal<MutationSuccessOf<typeof mutation>, void>>;

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
type ActionEffectType = ReturnType<typeof action.effect>;
type ActionCallReturn = ReturnType<typeof action>;
type ActionRunReturn = ReturnType<typeof action.run>;
declare const actionRunEffectValue: ActionRunEffectType;
declare const actionEffectValue: ActionEffectType;
const _actionRunEffectAssignable: Effect.Effect<number, BridgeError | MutationSupersededError, never> = actionRunEffectValue;
const _actionEffectAssignable: Effect.Effect<void, BridgeError | MutationSupersededError, never> = actionEffectValue;
type _ActionInput = Expect<Equal<Atom.ActionInputOf<typeof action>, number>>;
type _ActionError = Expect<Equal<Atom.ActionErrorOf<typeof action>, never>>;
type _ActionEffectError = Expect<Equal<Atom.ActionEffectErrorOf<typeof action>, BridgeError | MutationSupersededError>>;
type _ActionRunError = Expect<Equal<Atom.ActionRunErrorOf<typeof action>, BridgeError | MutationSupersededError>>;
type _ActionSuccess = Expect<Equal<Atom.ActionSuccessOf<typeof action>, number>>;
type _ActionRunEffect = Expect<Equal<Atom.ActionRunEffectOf<typeof action>, (input: number) => Effect.Effect<number, BridgeError | MutationSupersededError>>>;
type _ActionEffect = Expect<Equal<Atom.ActionEffectOf<typeof action>, (input: number) => Effect.Effect<void, BridgeError | MutationSupersededError>>>;
type _ActionCallReturn = Expect<Equal<ActionCallReturn, void>>;
type _ActionRunReturn = Expect<Equal<ActionRunReturn, void>>;

type _RuntimeShape = Expect<Equal<typeof runtime extends Atom.AtomRuntime<never, never> ? true : false, true>>;
