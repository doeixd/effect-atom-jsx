import { Effect } from "effect";
import { createSignal, type Accessor } from "./api.js";
import { atomEffect, type RuntimeLike } from "./effect-ts.js";
import * as Result from "./Result.js";

type RpcDef = {
  readonly payload: unknown;
  readonly success: unknown;
  readonly error: unknown;
};

export type RpcDefinitions = Record<string, RpcDef>;

export interface AtomRpcClient<Defs extends RpcDefinitions, R = never> {
  readonly id: string;
  readonly runtime?: RuntimeLike<R, unknown>;
  readonly mutation: <Tag extends keyof Defs & string>(
    tag: Tag,
  ) => (
    payload: Defs[Tag]["payload"],
    options?: { readonly headers?: Record<string, string> },
  ) => Effect.Effect<Defs[Tag]["success"], Defs[Tag]["error"], R>;
  readonly query: <Tag extends keyof Defs & string>(
    tag: Tag,
    payload: Defs[Tag]["payload"],
    options?: { readonly headers?: Record<string, string> },
  ) => Accessor<Result.Result<Defs[Tag]["success"], Defs[Tag]["error"]>>;
  readonly refresh: <Tag extends keyof Defs & string>(
    tag: Tag,
    payload: Defs[Tag]["payload"],
  ) => void;
}

/**
 * v4-native AtomRpc client factory.
 *
 * This mirrors effect-atom's AtomRpc shape while avoiding hard dependency on
 * @effect/rpc internals.
 */
export const Tag = <Self extends object = {}>() =>
  <const Id extends string, Defs extends RpcDefinitions, R = never>(
    id: Id,
    options: {
      readonly call: <Tag extends keyof Defs & string>(
        tag: Tag,
        payload: Defs[Tag]["payload"],
        options?: { readonly headers?: Record<string, string> },
      ) => Effect.Effect<Defs[Tag]["success"], Defs[Tag]["error"], R>;
      readonly runtime?: RuntimeLike<R, unknown>;
    },
  ): AtomRpcClient<Defs, R> & Self => {
    const cache = new Map<string, Accessor<Result.Result<any, any>>>();
    const refreshers = new Map<string, () => void>();
    const atomEffectAny = atomEffect as unknown as (
      fn: () => Effect.Effect<any, any, any>,
      runtime?: RuntimeLike<any, unknown>,
    ) => Accessor<any>;

    const keyOf = (tag: string, payload: unknown): string => `${tag}:${JSON.stringify(payload)}`;

    const client: AtomRpcClient<Defs, R> = {
      id,
      runtime: options.runtime,
      mutation(tag) {
        return (payload, callOptions) => options.call(tag, payload, callOptions);
      },
      query(tag, payload, queryOptions) {
        const key = keyOf(tag, payload);
        const existing = cache.get(key);
        if (existing) return existing as Accessor<Result.Result<Defs[typeof tag]["success"], Defs[typeof tag]["error"]>>;

        const [tick, setTick] = createSignal(0);
        refreshers.set(key, () => setTick((n) => n + 1));

        const async = atomEffectAny(
          () => Effect.sync(tick).pipe(
            Effect.flatMap(() => options.call(tag, payload, queryOptions)),
          ),
          options.runtime as RuntimeLike<any, unknown> | undefined,
        );

        const result = () => Result.fromAsyncResult(async()) as Result.Result<Defs[typeof tag]["success"], Defs[typeof tag]["error"]>;
        cache.set(key, result as Accessor<Result.Result<any, any>>);
        return result;
      },
      refresh(tag, payload) {
        refreshers.get(keyOf(tag, payload))?.();
      },
    };

    return client as AtomRpcClient<Defs, R> & Self;
  };
