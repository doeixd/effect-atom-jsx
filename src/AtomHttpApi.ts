import { Effect } from "effect";
import { createSignal, type Accessor } from "./api.js";
import { atomEffect, type RuntimeLike } from "./effect-ts.js";
import * as Result from "./Result.js";

type EndpointDef = {
  readonly request: unknown;
  readonly success: unknown;
  readonly error: unknown;
};

export type HttpApiDefinitions = Record<string, Record<string, EndpointDef>>;

export interface AtomHttpApiClient<Defs extends HttpApiDefinitions, R = never> {
  readonly id: string;
  readonly runtime?: RuntimeLike<R, unknown>;
  readonly mutation: <
    Group extends keyof Defs & string,
    Endpoint extends keyof Defs[Group] & string,
  >(
    group: Group,
    endpoint: Endpoint,
  ) => (
    request: Defs[Group][Endpoint]["request"],
  ) => Effect.Effect<Defs[Group][Endpoint]["success"], Defs[Group][Endpoint]["error"], R>;
  readonly query: <
    Group extends keyof Defs & string,
    Endpoint extends keyof Defs[Group] & string,
  >(
    group: Group,
    endpoint: Endpoint,
    request: Defs[Group][Endpoint]["request"],
  ) => Accessor<Result.Result<Defs[Group][Endpoint]["success"], Defs[Group][Endpoint]["error"]>>;
  readonly refresh: <
    Group extends keyof Defs & string,
    Endpoint extends keyof Defs[Group] & string,
  >(
    group: Group,
    endpoint: Endpoint,
    request: Defs[Group][Endpoint]["request"],
  ) => void;
}

/**
 * v4-native AtomHttpApi client factory.
 *
 * This mirrors effect-atom's AtomHttpApi shape while keeping dependencies
 * minimal and framework-agnostic.
 */
export const Tag = <Self extends object = {}>() =>
  <const Id extends string, Defs extends HttpApiDefinitions, R = never>(
    id: Id,
    options: {
      readonly call: <
        Group extends keyof Defs & string,
        Endpoint extends keyof Defs[Group] & string,
      >(
        group: Group,
        endpoint: Endpoint,
        request: Defs[Group][Endpoint]["request"],
      ) => Effect.Effect<Defs[Group][Endpoint]["success"], Defs[Group][Endpoint]["error"], R>;
      readonly runtime?: RuntimeLike<R, unknown>;
    },
  ): AtomHttpApiClient<Defs, R> & Self => {
    const cache = new Map<string, Accessor<Result.Result<any, any>>>();
    const refreshers = new Map<string, () => void>();
    const atomEffectAny = atomEffect as unknown as (
      fn: () => Effect.Effect<any, any, any>,
      runtime?: RuntimeLike<any, unknown>,
    ) => Accessor<any>;

    const keyOf = (group: string, endpoint: string, request: unknown): string =>
      `${group}:${endpoint}:${JSON.stringify(request)}`;

    const client: AtomHttpApiClient<Defs, R> = {
      id,
      runtime: options.runtime,
      mutation(group, endpoint) {
        return (request) => options.call(group, endpoint, request);
      },
      query(group, endpoint, request) {
        const key = keyOf(group, endpoint, request);
        const existing = cache.get(key);
        if (existing) {
          return existing as Accessor<Result.Result<Defs[typeof group][typeof endpoint]["success"], Defs[typeof group][typeof endpoint]["error"]>>;
        }

        const [tick, setTick] = createSignal(0);
        refreshers.set(key, () => setTick((n) => n + 1));

        const async = atomEffectAny(
          () => Effect.sync(tick).pipe(
            Effect.flatMap(() => options.call(group, endpoint, request)),
          ),
          options.runtime as RuntimeLike<any, unknown> | undefined,
        );

        const result = () => Result.fromAsyncResult(async()) as Result.Result<Defs[typeof group][typeof endpoint]["success"], Defs[typeof group][typeof endpoint]["error"]>;
        cache.set(key, result as Accessor<Result.Result<any, any>>);
        return result;
      },
      refresh(group, endpoint, request) {
        refreshers.get(keyOf(group, endpoint, request))?.();
      },
    };

    return client as AtomHttpApiClient<Defs, R> & Self;
  };
