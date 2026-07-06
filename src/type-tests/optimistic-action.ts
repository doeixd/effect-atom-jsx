import { Effect, Layer, ServiceMap } from "effect";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import type { BridgeError, MutationSupersededError } from "../effect-ts.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

type Api = {
  readonly save: (next: number) => Effect.Effect<{ readonly confirmed: number }, { readonly _tag: "SaveError" }>;
};
const Api = ServiceMap.Service<Api>("Api");

const count = Atom.make(0);

const save = Atom.optimistic(count).action({
  update: (current, delta: number) => current + delta,
  effect: (next, _delta) =>
    next > 0
      ? Effect.succeed({ confirmed: next })
      : Effect.fail({ _tag: "SaveError" } as const),
  reconcile: (_optimistic, success) => success.confirmed,
});

type _Input = Expect<Equal<Atom.OptimisticActionInputOf<typeof save>, number>>;
type _Value = Expect<Equal<Atom.OptimisticActionValueOf<typeof save>, number>>;
type _Success = Expect<Equal<Atom.OptimisticActionSuccessOf<typeof save>, { confirmed: number }>>;
type _Error = Expect<Equal<Atom.OptimisticActionErrorOf<typeof save>, { readonly _tag: "SaveError" }>>;
type _EffectError = Expect<Equal<Atom.OptimisticActionEffectErrorOf<typeof save>, { readonly _tag: "SaveError" } | BridgeError | MutationSupersededError>>;
type _RunError = Expect<Equal<Atom.OptimisticActionRunErrorOf<typeof save>, { readonly _tag: "SaveError" } | BridgeError | MutationSupersededError>>;
type _RunEffect = Expect<Equal<Atom.OptimisticActionRunEffectOf<typeof save>, (input: number) => Effect.Effect<{ confirmed: number }, { readonly _tag: "SaveError" } | BridgeError | MutationSupersededError>>>;
type _Effect = Expect<Equal<Atom.OptimisticActionEffectOf<typeof save>, (input: number) => Effect.Effect<void, { readonly _tag: "SaveError" } | BridgeError | MutationSupersededError>>>;

const _runEffect: Effect.Effect<{ confirmed: number }, { readonly _tag: "SaveError" } | BridgeError | MutationSupersededError> = save.runEffect(1);
const _effect: Effect.Effect<void, { readonly _tag: "SaveError" } | BridgeError | MutationSupersededError> = save.effect(1);
const _result: import("../api.js").Accessor<import("../effect-ts.js").Result<void, { readonly _tag: "SaveError" }>> = save.result;

const runtime = Atom.runtime(Layer.succeed(Api, {
  save: (next) => Effect.succeed({ confirmed: next }),
}));

const runtimeSave = runtime.optimistic(count).action({
  update: (current, delta: number) => current + delta,
  effect: (next) => Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.save(next);
  }),
  reconcile: (_optimistic, success) => success.confirmed,
});

const _runtimeRunEffect: Effect.Effect<{ readonly confirmed: number }, { readonly _tag: "SaveError" } | BridgeError | MutationSupersededError> = runtimeSave.runEffect(1);

const OptimisticComponent = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.gen(function* () {
    const local = yield* Component.state(0);
    const optimistic = yield* Component.optimistic(local).action({
      update: (current, delta: number) => current + delta,
      effect: (next) => Effect.gen(function* () {
        const api = yield* Api;
        return yield* api.save(next);
      }),
      reconcile: (_optimistic, success) => success.confirmed,
    });
    return { optimistic };
  }),
  () => null,
);

type _ComponentReq = Expect<Equal<Component.Requirements<typeof OptimisticComponent>, Api>>;
type _ComponentBindings = Component.BindingsOf<typeof OptimisticComponent>;
type _ComponentOptimistic = _ComponentBindings["optimistic"];
type _ComponentOptimisticInput = Expect<Equal<Atom.OptimisticActionInputOf<_ComponentOptimistic>, number>>;
type _ComponentOptimisticValue = Expect<Equal<Atom.OptimisticActionValueOf<_ComponentOptimistic>, number>>;
type _ComponentOptimisticSuccess = Expect<Equal<Atom.OptimisticActionSuccessOf<_ComponentOptimistic>, { readonly confirmed: number }>>;
type _ComponentOptimisticError = Expect<Equal<Atom.OptimisticActionErrorOf<_ComponentOptimistic>, { readonly _tag: "SaveError" }>>;
