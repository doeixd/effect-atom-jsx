import { Effect } from "effect";
import { createSignal, type Accessor } from "./api.js";
import { atomEffect, type RuntimeLike, type Result as ResultState } from "./effect-ts.js";
import {
  action as atomAction,
  invalidateReactivity,
  trackReactivity,
  type ActionHandle,
  type ReactivityKeysInput,
} from "./Atom.js";

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
    options?: { readonly reactivityKeys?: ReactivityKeysInput },
  ) => (
    request: Defs[Group][Endpoint]["request"],
  ) => Effect.Effect<Defs[Group][Endpoint]["success"], Defs[Group][Endpoint]["error"], R>;
  readonly action: <
    Group extends keyof Defs & string,
    Endpoint extends keyof Defs[Group] & string,
  >(
    group: Group,
    endpoint: Endpoint,
    options?: {
      readonly reactivityKeys?: ReactivityKeysInput;
      readonly onError?: (error: Defs[Group][Endpoint]["error"]) => void;
    },
  ) => ActionHandle<Defs[Group][Endpoint]["request"], Defs[Group][Endpoint]["error"], Defs[Group][Endpoint]["success"]>;
  readonly query: <
    Group extends keyof Defs & string,
    Endpoint extends keyof Defs[Group] & string,
  >(
    group: Group,
    endpoint: Endpoint,
    request: Defs[Group][Endpoint]["request"],
    options?: { readonly reactivityKeys?: ReactivityKeysInput },
  ) => Accessor<ResultState<Defs[Group][Endpoint]["success"], Defs[Group][Endpoint]["error"]>>;
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
    const cache = new Map<string, Accessor<ResultState<any, any>>>();
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
      mutation(group, endpoint, mutationOptions) {
        return (request) => {
          const base = options.call(group, endpoint, request);
          if (mutationOptions?.reactivityKeys === undefined) return base;
          return base.pipe(Effect.tap(() => Effect.sync(() => invalidateReactivity(mutationOptions.reactivityKeys!))));
        };
      },
      action(group, endpoint, actionOptions) {
        const effectFn = (request: Defs[typeof group][typeof endpoint]["request"]) =>
          options.call(group, endpoint, request);
        return options.runtime === undefined
          ? atomAction(effectFn as (input: Defs[typeof group][typeof endpoint]["request"]) => Effect.Effect<Defs[typeof group][typeof endpoint]["success"], Defs[typeof group][typeof endpoint]["error"], never>, {
            reactivityKeys: actionOptions?.reactivityKeys,
            onError: actionOptions?.onError,
          })
          : atomAction(options.runtime as RuntimeLike<R, unknown>, effectFn as any, {
            reactivityKeys: actionOptions?.reactivityKeys,
            onError: actionOptions?.onError,
          }) as ActionHandle<Defs[typeof group][typeof endpoint]["request"], Defs[typeof group][typeof endpoint]["error"], Defs[typeof group][typeof endpoint]["success"]>;
      },
      query(group, endpoint, request, queryOptions) {
        const key = keyOf(group, endpoint, request);
        const existing = cache.get(key);
        if (existing) {
          return existing as Accessor<ResultState<Defs[typeof group][typeof endpoint]["success"], Defs[typeof group][typeof endpoint]["error"]>>;
        }

        const [tick, setTick] = createSignal(0);
        refreshers.set(key, () => setTick((n) => n + 1));

        const async = atomEffectAny(
          () => {
            if (queryOptions?.reactivityKeys !== undefined) {
              trackReactivity(queryOptions.reactivityKeys);
            }
            return Effect.sync(tick).pipe(
            Effect.flatMap(() => options.call(group, endpoint, request)),
            );
          },
          options.runtime as RuntimeLike<any, unknown> | undefined,
        );

        const result = () => async() as ResultState<Defs[typeof group][typeof endpoint]["success"], Defs[typeof group][typeof endpoint]["error"]>;
        cache.set(key, result as Accessor<ResultState<any, any>>);
        return result;
      },
      refresh(group, endpoint, request) {
        refreshers.get(keyOf(group, endpoint, request))?.();
      },
    };

    return client as AtomHttpApiClient<Defs, R> & Self;
  };
