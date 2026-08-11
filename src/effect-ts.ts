/**
 * effect-ts.ts — Effect-TS integration layer.
 *
 * Bridges the synchronous reactive core with Effect-TS's structured
 * concurrency, typed errors, and dependency injection.
 *
 * ## Key primitives
 *
 * ### `atomEffect(fn, runtime?)`
 * Creates a `Signal<Result<A, E>>` driven by an Effect returned from `fn`.
 * `fn` is called synchronously inside a reactive Computation, so any signal
 * reads inside `fn()` are tracked as dependencies. When deps change, the
 * running fiber is interrupted and a new one starts.
 *
 * ```ts
 * const [userId] = createSignal(1);
 * const user = atomEffect(() => {
 *   const id = userId(); // ← tracked dep: re-runs when userId changes
 *   return fetchUser(id);
 * });
 * // user() → Result<User, FetchError>
 * ```
 *
 * ### `createAtom(value | getter)`
 * Jotai-style atom API built on the reactive core.
 *
 * ### `scopedRootEffect(scope, fn)`
 * Binds a reactive Owner to an Effect CloseableScope for bidirectional cleanup.
 *
 * ### `layerContext(layer, fn)`
 * Builds an Effect Layer async, renders children once services are ready.
 */

import {
  Effect,
  Exit,
  Fiber,
  ManagedRuntime,
  Context,
  Scope,
  Layer,
  Schedule,
  Stream as FxStream,
  Option,
  Cause,
  Schema,
  pipe,
} from "effect";
import { Signal } from "./signal.js";
import { Computation } from "./computation.js";
import { Owner, getOwner, runWithOwner } from "./owner.js";
import {
  contextMap,
  createSignal,
  createEffect,
  onCleanup,
  type Accessor,
  createContext,
  useContext,
  untrack,
  flush,
} from "./api.js";
import { createMemo } from "./api.js";
import { render } from "./dom.js";
import {
  closeComponentScope,
  currentComponentScope,
  withComponentScope,
} from "./component-scope.js";
import { ReactivityTag } from "./Reactivity.js";
import { installReactivityService } from "./reactivity-runtime.js";
import type * as AtomTypes from "./Atom.js";

// ─── Result ───────────────────────────────────────────────────────────────────

export type Loading = { readonly _tag: "Loading" };
export type Success<A> = {
  readonly _tag: "Success";
  readonly value: A;
  /** The canonical Effect Exit backing this result. */
  readonly exit: Exit.Exit<A, never>;
};
/** E is the typed failure from your Effect's error channel. */
export type Failure<E> = {
  readonly _tag: "Failure";
  readonly error: E;
  /** The canonical Effect Exit backing this result. */
  readonly exit: Exit.Exit<never, E>;
};
/**
 * A failed refresh that still has last-known-good data.
 *
 * `Stale` is the failed-refresh mirror of `Refreshing`: the request has
 * settled to a typed failure, but the previous success remains available for
 * UI continuity.
 */
export type Stale<A, E> = {
  readonly _tag: "Stale";
  readonly error: E;
  readonly data: A;
  /** The canonical Effect Exit backing the failed refresh. */
  readonly exit: Exit.Exit<never, E>;
};
/** Defect wraps unexpected errors (bugs, interrupts) that aren't typed E. */
export type Defect = {
  readonly _tag: "Defect";
  readonly cause: string;
  readonly rawCause: Cause.Cause<unknown>;
  /** The canonical Effect Exit backing this result. */
  readonly exit: Exit.Exit<never, never>;
};
export type Refreshing<A, E> = {
  readonly _tag: "Refreshing";
  readonly previous: Success<A> | Failure<E> | Defect;
};

export type Result<A, E> = Loading | Refreshing<A, E> | Success<A> | Failure<E> | Stale<A, E> | Defect;

export type ResultLoadingError = {
  readonly _tag: "ResultLoadingError";
  readonly message: string;
};

export type ResultDefectError = {
  readonly _tag: "ResultDefectError";
  readonly defect: string;
};

export type MutationSupersededError = {
  readonly _tag: "MutationSupersededError";
  readonly message: string;
};

export type BridgeError = ResultLoadingError | ResultDefectError;
export type MutationFailure<E> = E | ResultDefectError;

/**
 * Optional handlers collected by `Result.builder(...)`.
 *
 * Every handler is optional; `render()` returns `undefined` when the variant
 * that occurred has no handler. Two documented fallbacks keep short builders
 * total:
 *
 * - `Refreshing` falls back to the handler for the variant it wraps, so a
 *   builder with only `onSuccess` still renders during a refresh.
 * - `Stale` and `Defect` fall back to `onFailure` — `Stale` with its typed
 *   error, `Defect` with a `ResultDefectError` envelope.
 */
export interface ResultBuilderHandlers<A, E, R> {
  onLoading?: () => R;
  onRefreshing?: (previous: Success<A> | Failure<E> | Defect) => R;
  onSuccess?: (value: A) => R;
  onStale?: (error: E, data: A) => R;
  onFailure?: (error: E | ResultDefectError) => R;
  onDefect?: (cause: string, rawCause: Cause.Cause<unknown>) => R;
}

/** Fluent matcher returned by `Result.builder(...)`. */
export interface ResultBuilder<A, E, R> {
  onLoading<R2>(f: () => R2): ResultBuilder<A, E, R | R2>;
  onRefreshing<R2>(f: (previous: Success<A> | Failure<E> | Defect) => R2): ResultBuilder<A, E, R | R2>;
  onSuccess<R2>(f: (value: A) => R2): ResultBuilder<A, E, R | R2>;
  onStale<R2>(f: (error: E, data: A) => R2): ResultBuilder<A, E, R | R2>;
  onFailure<R2>(f: (error: E | ResultDefectError) => R2): ResultBuilder<A, E, R | R2>;
  onDefect<R2>(f: (cause: string, rawCause: Cause.Cause<unknown>) => R2): ResultBuilder<A, E, R | R2>;
  render(): R | undefined;
}

/** Success values of a tuple of results, as a tuple. */
export type ResultAllValues<T extends ReadonlyArray<Result<any, any>>> = {
  [K in keyof T]: T[K] extends Result<infer X, any> ? X : never;
};

/** Union of the error channels of a tuple of results. */
export type ResultAllError<T extends ReadonlyArray<Result<any, any>>> =
  T[number] extends Result<any, infer XE> ? XE : never;

export const Result = {
  /** Singleton Loading value. */
  loading: { _tag: "Loading" } as Loading,

  /** Wrap a previously settled result as Refreshing. */
  refreshing: <A, E>(previous: Success<A> | Failure<E> | Defect): Refreshing<A, E> => ({ _tag: "Refreshing", previous }),

  /** Create a Success result, backed by `Exit.succeed(value)`. */
  success: <A>(value: A): Success<A> => ({ _tag: "Success", value, exit: Exit.succeed(value) }),

  /** Create a Failure result from a typed error, backed by `Exit.fail(error)`. */
  failure: <E>(error: E): Failure<E> => ({ _tag: "Failure", error, exit: Exit.fail(error) }),

  /** Create a data-bearing failed refresh result, backed by `Exit.fail(error)`. */
  stale: <A, E>(error: E, data: A): Stale<A, E> => ({ _tag: "Stale", error, data, exit: Exit.fail(error) }),

  /**
   * Create a Defect result from an unexpected error, backed by `Exit.failCause(...)`.
   * @param cause    - Human-readable cause description.
   * @param rawCause - Structured Effect Cause. If omitted, `Cause.die(cause)` is used.
   */
  defect: (cause: string, rawCause?: Cause.Cause<unknown>): Defect => {
    const rc = rawCause ?? Cause.die(cause);
    return { _tag: "Defect", cause, rawCause: rc, exit: Exit.failCause(rc) as Exit.Exit<never, never> };
  },

  /** Extract the settled value (skipping Loading, unwrapping Refreshing). */
  settled: <A, E>(r: Result<A, E>): Option.Option<Success<A> | Failure<E> | Stale<A, E> | Defect> => {
    if (r._tag === "Loading") return Option.none();
    if (r._tag === "Refreshing") return Option.some(r.previous);
    return Option.some(r);
  },

  /**
   * Canonical constructor from an Effect Exit.
   * Maps `Exit.succeed(value)` to `Success`, typed failures to `Failure`,
   * and defects/interrupts to `Defect`.
   */
  fromExit: <A, E>(exit: Exit.Exit<A, E>): Result<A, E> =>
    Exit.match(exit, {
      onSuccess: (value) => Result.success(value),
      onFailure: (cause) => {
        const typed = Cause.findErrorOption(cause);
        if (Option.isSome(typed)) return Result.failure(typed.value);
        return Result.defect(Cause.pretty(cause), cause);
      },
    }),

  /**
   * Like `fromExit`, but preserves last-known-good data across a failed
   * refresh: a *typed* failure with previous data becomes `Stale(error, data)`
   * instead of blanking to `Failure`.
   *
   * This is the settle step every refreshing query wants. `fromExit` alone is
   * correct only for a query that has never succeeded — using it on a refresh
   * throws away data the user is currently looking at.
   *
   * Defects and interrupts are deliberately *not* preserved as `Stale`: they
   * are not "the query failed with a value", and the live query path
   * (`queryEffect`) publishes `Defect` for them regardless of prior data.
   *
   * @param exit     - The settled exit of the refresh attempt.
   * @param previous - The result being replaced, if any.
   */
  fromExitWithPrevious: <A, E>(
    exit: Exit.Exit<A, E>,
    previous: Result<A, E> | undefined,
  ): Result<A, E> => {
    const next = Result.fromExit(exit);
    if (next._tag !== "Failure" || previous === undefined) return next;
    const data = Result.getData(previous);
    return Option.isSome(data)
      ? Result.stale(next.error, data.value)
      : next;
  },

  /**
   * Convert to an Effect Exit. Returns `None` for `Loading`.
   * Uses the canonical `.exit` field for accurate round-trips.
   */
  toExit: <A, E>(r: Result<A, E>): Option.Option<Exit.Exit<A, E>> => {
    const settled = Result.settled(r);
    if (Option.isNone(settled)) return Option.none();
    return Option.some(settled.value.exit as unknown as Exit.Exit<A, E>);
  },

  /** Extract the success value as an Option. */
  toOption: <A, E>(r: Result<A, E>): Option.Option<A> => {
    const settled = Result.settled(r);
    if (Option.isNone(settled)) return Option.none();
    if (settled.value._tag === "Success") return Option.some(settled.value.value);
    if (settled.value._tag === "Stale") return Option.some(settled.value.data);
    return Option.none();
  },

  /** Extract the latest available data from Success, Refreshing(Success), or Stale. */
  getData: <A, E>(r: Result<A, E>): Option.Option<A> => {
    if (r._tag === "Success") return Option.some(r.value);
    if (r._tag === "Stale") return Option.some(r.data);
    if (r._tag === "Refreshing" && r.previous._tag === "Success") return Option.some(r.previous.value);
    return Option.none();
  },

  /** Extract the typed error from Failure, Refreshing(Failure), or Stale. */
  getError: <A, E>(r: Result<A, E>): Option.Option<E> => {
    if (r._tag === "Failure") return Option.some(r.error);
    if (r._tag === "Stale") return Option.some(r.error);
    if (r._tag === "Refreshing" && r.previous._tag === "Failure") return Option.some(r.previous.error);
    return Option.none();
  },

  /** Extract the raw Cause from a Defect result. */
  rawCause: <A, E>(r: Result<A, E>): Option.Option<Cause.Cause<unknown>> => {
    const settled = Result.settled(r);
    if (Option.isNone(settled)) return Option.none();
    const value = settled.value;
    if (value._tag !== "Defect") return Option.none();
    return Option.some(value.rawCause);
  },

  // ─── Type Guards ────────────────────────────────────────────────────────

  isLoading: <A, E>(r: Result<A, E>): r is Loading => r._tag === "Loading",
  isRefreshing: <A, E>(r: Result<A, E>): r is Refreshing<A, E> => r._tag === "Refreshing",
  isSuccess: <A, E>(r: Result<A, E>): r is Success<A> => r._tag === "Success",
  isFailure: <A, E>(r: Result<A, E>): r is Failure<E> => r._tag === "Failure",
  isStale: <A, E>(r: Result<A, E>): r is Stale<A, E> => r._tag === "Stale",
  isDefect: <A, E>(r: Result<A, E>): r is Defect => r._tag === "Defect",

  // ─── Combinators ────────────────────────────────────────────────────────

  /**
   * Exhaustive pattern match over all five Result variants.
   */
  match: <A, E, R>(
    r: Result<A, E>,
    handlers: {
      readonly onLoading: () => R;
      readonly onRefreshing: (previous: Success<A> | Failure<E> | Defect) => R;
      readonly onSuccess: (value: A) => R;
      readonly onFailure: (error: E) => R;
      readonly onStale: (error: E, data: A) => R;
      readonly onDefect: (cause: string, rawCause: Cause.Cause<unknown>) => R;
    },
  ): R => {
    switch (r._tag) {
      case "Loading": return handlers.onLoading();
      case "Refreshing": return handlers.onRefreshing(r.previous);
      case "Success": return handlers.onSuccess(r.value);
      case "Failure": return handlers.onFailure(r.error);
      case "Stale": return handlers.onStale(r.error, r.data);
      case "Defect": return handlers.onDefect(r.cause, r.rawCause);
    }
  },

  /**
   * Transform the success value. Non-success variants pass through unchanged.
   */
  map: <A, E, B>(r: Result<A, E>, f: (a: A) => B): Result<B, E> => {
    if (r._tag === "Success") return Result.success(f(r.value));
    if (r._tag === "Refreshing" && r.previous._tag === "Success") {
      return Result.refreshing(Result.success(f(r.previous.value)));
    }
    if (r._tag === "Stale") return Result.stale(r.error, f(r.data));
    return r as unknown as Result<B, E>;
  },

  /**
   * Chain a success value into another Result-producing function.
   * Non-success variants short-circuit and pass through unchanged.
   */
  flatMap: <A, E, B, E2>(r: Result<A, E>, f: (a: A) => Result<B, E2>): Result<B, E | E2> => {
    if (r._tag === "Success") return f(r.value);
    return r as unknown as Result<B, E | E2>;
  },

  /**
   * Get the success value, or compute a fallback for any non-success state.
   */
  getOrElse: <A, E>(r: Result<A, E>, fallback: () => A): A => {
    if (r._tag === "Success") return r.value;
    if (r._tag === "Stale") return r.data;
    if (r._tag === "Refreshing" && r.previous._tag === "Success") return r.previous.value;
    return fallback();
  },

  /**
   * Get the success value or throw.
   * @throws The typed error on Failure, or an Error on Loading/Defect.
   */
  getOrThrow: <A, E>(r: Result<A, E>): A => {
    if (r._tag === "Success") return r.value;
    if (r._tag === "Refreshing" && r.previous._tag === "Success") return r.previous.value;
    if (r._tag === "Stale") throw r.error;
    if (r._tag === "Failure") throw r.error;
    if (r._tag === "Defect") throw new Error(r.cause);
    if (r._tag === "Refreshing") {
      if (r.previous._tag === "Failure") throw r.previous.error;
      throw new Error((r.previous as Defect).cause);
    }
    throw new Error("Result is Loading");
  },

  /**
   * Fluent, partial matcher for rendering `Result` values.
   *
   * Prefer this over positional `match` when a call site only cares about some
   * variants: handlers are optional and `render()` returns `undefined` for an
   * unhandled variant, so adding a state later does not break existing code.
   *
   * Two fallbacks keep short builders total (see {@link ResultBuilderHandlers}):
   * `Refreshing` delegates to the handler of the variant it wraps, and
   * `Stale`/`Defect` delegate to `onFailure` when their own handler is absent.
   *
   * @example
   * const view = Result.builder(users())
   *   .onLoading(() => "loading…")
   *   .onFailure((e) => `error: ${String(e)}`)
   *   .onSuccess((list) => list.length)
   *   .render()
   */
  builder: <A, E, R = never>(r: Result<A, E>): ResultBuilder<A, E, R> => {
    const handlers: ResultBuilderHandlers<A, E, any> = {};

    const renderSettled = (
      settled: Success<A> | Failure<E> | Stale<A, E> | Defect,
    ): R | undefined => {
      switch (settled._tag) {
        case "Success":
          return handlers.onSuccess?.(settled.value);
        case "Failure":
          return handlers.onFailure?.(settled.error);
        case "Stale":
          return handlers.onStale !== undefined
            ? handlers.onStale(settled.error, settled.data)
            : handlers.onFailure?.(settled.error);
        case "Defect":
          return handlers.onDefect !== undefined
            ? handlers.onDefect(settled.cause, settled.rawCause)
            : handlers.onFailure?.({ _tag: "ResultDefectError", defect: settled.cause });
      }
    };

    const api: ResultBuilder<A, E, R> = {
      onLoading: (f) => {
        handlers.onLoading = f;
        return api as any;
      },
      onRefreshing: (f) => {
        handlers.onRefreshing = f;
        return api as any;
      },
      onSuccess: (f) => {
        handlers.onSuccess = f;
        return api as any;
      },
      onStale: (f) => {
        handlers.onStale = f;
        return api as any;
      },
      onFailure: (f) => {
        handlers.onFailure = f;
        return api as any;
      },
      onDefect: (f) => {
        handlers.onDefect = f;
        return api as any;
      },
      render: () => {
        if (r._tag === "Loading") return handlers.onLoading?.();
        if (r._tag === "Refreshing") {
          return handlers.onRefreshing !== undefined
            ? handlers.onRefreshing(r.previous)
            : renderSettled(r.previous);
        }
        return renderSettled(r);
      },
    };

    return api;
  },

  /**
   * Combine a tuple of results into one result of a tuple.
   *
   * Short-circuit priority is `Defect > Failure > Stale > Loading >
   * Refreshing > Success`: the most-informative bad news wins, and an
   * in-flight state only surfaces once nothing has failed.
   *
   * `Stale` and `Refreshing` keep their data when *every* input still has data
   * available (`getData`), so keep-stale-on-failure composes; otherwise they
   * degrade to `Failure` and `Loading` respectively.
   *
   * @example
   * const combined = Result.all([userResult, prefsResult])
   * // Result<[User, Prefs], UserError | PrefsError>
   */
  all: <const T extends ReadonlyArray<Result<any, any>>>(
    results: T,
  ): Result<ResultAllValues<T>, ResultAllError<T>> => {
    type Out = Result<ResultAllValues<T>, ResultAllError<T>>;

    let firstStale: Stale<any, any> | undefined;
    let firstRefreshing = false;
    let anyLoading = false;

    for (const r of results) {
      if (r._tag === "Defect") return r as Out;
    }
    for (const r of results) {
      if (r._tag === "Failure") return Result.failure(r.error) as Out;
      if (r._tag === "Stale") firstStale ??= r;
      if (r._tag === "Loading") anyLoading = true;
      if (r._tag === "Refreshing") firstRefreshing = true;
    }

    // `data` is present for Success, Stale, and Refreshing(Success) alike, so a
    // full tuple means every input can still contribute a value.
    const data: Array<unknown> = [];
    let complete = true;
    for (const r of results) {
      const d = Result.getData(r);
      if (Option.isNone(d)) {
        complete = false;
        break;
      }
      data.push(d.value);
    }

    if (firstStale !== undefined) {
      return (complete
        ? Result.stale(firstStale.error, data as unknown as ResultAllValues<T>)
        : Result.failure(firstStale.error)) as Out;
    }
    if (anyLoading) return Result.loading as Out;
    if (firstRefreshing) {
      return (complete
        ? Result.refreshing(Result.success(data as unknown as ResultAllValues<T>))
        : Result.loading) as Out;
    }
    return Result.success(data as unknown as ResultAllValues<T>) as Out;
  },
} as const;

function previousFromResult<A, E>(
  result: Result<A, E>,
): Success<A> | Failure<E> | Defect | null {
  if (result._tag === "Refreshing") return result.previous;
  if (result._tag === "Success" || result._tag === "Failure" || result._tag === "Defect") return result;
  if (result._tag === "Stale") return Result.success(result.data);
  return null;
}

function staleDataFromPrevious<A, E>(
  previous: Success<A> | Failure<E> | Defect | null,
): Option.Option<A> {
  return previous?._tag === "Success" ? Option.some(previous.value) : Option.none();
}

// ─── Ambient ManagedRuntime context ───────────────────────────────────────────

export const ManagedRuntimeContext = createContext<ManagedRuntime.ManagedRuntime<unknown, unknown> | null>(null);

function getAmbientManagedRuntime(): ManagedRuntime.ManagedRuntime<unknown, unknown> | null {
  return useContext(ManagedRuntimeContext);
}

function withManagedRuntimeContext<A>(
  managed: ManagedRuntime.ManagedRuntime<unknown, unknown>,
  fn: () => A,
): A {
  const owner = getOwner();
  if (owner === null) return fn();
  let map = contextMap.get(owner);
  if (map === undefined) {
    map = new Map();
    contextMap.set(owner, map);
  }
  const key = ManagedRuntimeContext.id;
  const hadPrevious = map.has(key);
  const previous = map.get(key);
  map.set(key, managed);
  try {
    return fn();
  } finally {
    if (hadPrevious) {
      map.set(key, previous);
    } else {
      map.delete(key);
    }
  }
}

type RuntimeLike<R, ER = never> =
  | Context.Context<R>
  | ManagedRuntime.ManagedRuntime<R, ER>;

export type { RuntimeLike };

function runForkWithRuntime<R, A, E>(
  runtime: RuntimeLike<R, unknown> | undefined,
  effect: Effect.Effect<A, E, R>,
): Fiber.Fiber<A, E | unknown> {
  const scope = currentComponentScope();
  const scopedEffect = scope === null
    ? effect
    : Scope.provide(scope)(effect as Effect.Effect<A, E, R | Scope.Scope>) as Effect.Effect<A, E, R>;

  if (ManagedRuntime.isManagedRuntime(runtime)) {
    return runtime.runFork(scopedEffect);
  }
  if (runtime !== undefined) {
    return Effect.runForkWith(runtime as Context.Context<R>)(scopedEffect);
  }
  return Effect.runFork(scopedEffect as Effect.Effect<A, E, never>) as Fiber.Fiber<A, E | unknown>;
}

/**
 * Synchronously resolve a service from the ambient ManagedRuntime.
 *
 * The runtime is provided by `mount(...)`.
 *
 * @example
 * const Api = Context.Service<{ readonly get: () => Effect.Effect<number> }>("Api")
 *
 * function Widget() {
 *   const api = useService(Api)
 *   const query = defineQuery(() => api.get(), { name: "widget" })
 *   return <Async result={query.result()} loading={() => "Loading..."} success={(n) => n} />
 * }
 */
export function useService<I, S>(tag: Context.Key<I, S>): S {
  const runtime = getAmbientManagedRuntime();
  if (runtime === null) {
    throw new Error(
      `[effect-atom-jsx] useService(${tag.key}) called outside of an ambient runtime. ` +
      "Wrap your app with createMount(layer) or mount(fn, container, layer).",
    );
  }
  try {
    return runtime.runSync(Effect.service(tag));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cached = (runtime as any).cachedServices as
      | { readonly services?: ReadonlyArray<{ readonly key?: unknown }> }
      | undefined;
    const available = cached?.services
      ?.map((entry) => String(entry.key ?? ""))
      .filter((key) => key.length > 0 && !key.startsWith("effect/"))
      .join(", ");
    throw new Error(
      `[effect-atom-jsx] useService(${tag.key}): service not found in ambient runtime. ` +
      (available && available.length > 0
        ? `Available services: [${available}]. `
        : "Available services: unavailable (runtime cache not initialized). ") +
      `Add ${tag.key} to the Layer passed to mount/createMount. ` +
      `Original error: ${message}`,
    );
  }
}

export interface QueryKey<A = unknown> {
  readonly id: symbol;
  readonly read: Accessor<number>;
  readonly invalidate: () => void;
  readonly _A?: (_: A) => A;
}

/**
 * Create a typed invalidation key for query/resource revalidation.
 */
export function createQueryKey<A = unknown>(name?: string): QueryKey<A> {
  const [version, setVersion] = createSignal(0);
  return {
    id: Symbol(name ?? "QueryKey"),
    read: version,
    invalidate: () => setVersion((n) => n + 1),
  };
}

function normalizeQueryKeys(
  keyOrKeys: QueryKey<any> | ReadonlyArray<QueryKey<any>> | undefined,
): ReadonlyArray<QueryKey<any>> {
  if (keyOrKeys === undefined) return [];
  return Array.isArray(keyOrKeys)
    ? keyOrKeys as ReadonlyArray<QueryKey<any>>
    : [keyOrKeys as QueryKey<any>];
}

function trackQueryKeys(keys: ReadonlyArray<QueryKey<any>>): void {
  for (const key of keys) {
    key.read();
  }
}

/**
 * Invalidate one or more query keys.
 */
export function invalidate(keyOrKeys: QueryKey<any> | ReadonlyArray<QueryKey<any>>): void {
  for (const key of normalizeQueryKeys(keyOrKeys)) {
    key.invalidate();
  }
}

/**
 * Resolve multiple services from the ambient runtime in one call.
 *
 * @example
 * const { api, clock } = useServices({ api: Api, clock: Clock })
 */
export function useServices<T extends Record<string, Context.Key<any, any>>>(
  tags: T,
): { [K in keyof T]: T[K] extends Context.Key<any, infer S> ? S : never } {
  const out = {} as { [K in keyof T]: T[K] extends Context.Key<any, infer S> ? S : never };
  for (const key in tags) {
    out[key] = useService(tags[key]) as { [K in keyof T]: T[K] extends Context.Key<any, infer S> ? S : never }[typeof key];
  }
  return out;
}

// ─── atomEffect ───────────────────────────────────────────────────────────────

/**
 * Create a reactive signal driven by an Effect computation.
 *
 * `fn` is called **synchronously** inside a Computation, so signal reads
 * inside `fn()` register as reactive dependencies. When any dep changes,
 * the running fiber is interrupted via structured concurrency and `fn` is
 * called again to build a fresh Effect.
 *
 * The signal value is `Result<A, E>` — starts as `Loading`, transitions
 * to `Success<A>` or `Failure<E>` when the fiber completes. Unexpected errors
 * (defects, fiber interrupts) surface as `Defect` rather than thrown exceptions.
 *
 * @param fn      - Called synchronously to produce the Effect. Signal reads
 *                  inside here are tracked as reactive dependencies.
 * @param runtime - Optional Effect Runtime to run fibers on. Defaults to the
 *                  default runtime (no services). Provide a custom runtime to
 *                  inject Layer services.
 *
 * @example
 * const [userId] = createSignal(1);
 * const user = atomEffect(() => {
 *   const id = userId(); // tracked dep
 *   return HttpClient.get(`/users/${id}`).pipe(Effect.map(r => r.json));
 * });
 */
/**
 * Testing seam: short-circuit an async result accessor without running the
 * underlying Effect. Used by `testing.resolveQuery` / `resolveAction`.
 */
const resultControllers = new WeakMap<
  Accessor<Result<any, any>>,
  {
    readonly set: (result: Result<any, any>) => void;
    readonly interrupt: () => void;
  }
>();

/** @internal Drive a query/action/mutation result for tests. */
export function setResultForTest<A, E>(
  result: Accessor<Result<A, E>>,
  next: Result<A, E>,
): void {
  const controller = resultControllers.get(result as Accessor<Result<any, any>>);
  if (controller === undefined) {
    throw new Error(
      "[effect-atom-jsx] setResultForTest: result is not a controllable query/action accessor.",
    );
  }
  controller.interrupt();
  controller.set(next);
  // Flush microtask-batched memo invalidations (e.g. action.pending) so
  // resolveQuery/resolveAction observations are immediately consistent.
  flush();
}

export function atomEffect<A, E, R>(
  fn: () => Effect.Effect<A, E, R>,
  ...runtime: [R] extends [never]
    ? [runtime?: RuntimeLike<R, unknown>]
    : [runtime: RuntimeLike<R, unknown>]
): Accessor<Result<A, E>> {
  const runtimeArg = runtime[0] as RuntimeLike<R, unknown> | undefined;
  const [result, setResult] = createSignal<Result<A, E>>(Result.loading);
  // Stored as unknown to avoid TS variance complaints when interrupting.
  let fiberRef: Fiber.Fiber<unknown, unknown> | null = null;

  const interruptFiber = (): void => {
    if (fiberRef !== null) {
      const f = fiberRef;
      fiberRef = null;
      // Best-effort interrupt: fire-and-forget is intentional here since we
      // only need cancellation, not the interrupt result.
      Effect.runFork(Fiber.interrupt(f));
    }
  };

  resultControllers.set(result as Accessor<Result<any, any>>, {
    set: (next) => setResult(next as Result<A, E>),
    interrupt: interruptFiber,
  });

  new Computation(() => {
    // Cancel any in-flight fiber from the previous run.
    interruptFiber();
    const previous = previousFromResult(untrack(result));
    const staleData = staleDataFromPrevious(previous);
    if (previous === null) {
      setResult(Result.loading);
    } else {
      setResult(Result.refreshing(previous));
    }

    // Call fn() synchronously — this is where reactive deps are tracked.
    const effect = fn();

    // Wrap into a void effect that writes to the signal on completion.
    const wrapped = pipe(
      effect,
      Effect.matchCause({
        onSuccess: (value: A): void => {
          fiberRef = null;
          setResult(Result.success(value));
        },
        onFailure: (cause: Cause.Cause<E>): void => {
          fiberRef = null;
          const typed = Cause.findErrorOption(cause);
          if (Option.isSome(typed)) {
            // Typed error from the Effect's error channel (E).
            setResult(Option.isSome(staleData) ? Result.stale(typed.value, staleData.value) : Result.failure(typed.value));
          } else {
            // Defect (unexpected exception) or fiber interrupt.
            setResult(Result.defect(Cause.pretty(cause), cause));
          }
        },
      }),
    );

    fiberRef = runForkWithRuntime(runtimeArg, wrapped as Effect.Effect<void, never, R>) as Fiber.Fiber<unknown, unknown>;
  });

  onCleanup(interruptFiber);

  return result;
}

export interface QueryEffectOptions<
  R,
  E = unknown,
  RetryError = never,
  RetryR = never,
  PollError = never,
  PollR = never,
> {
  runtime?: RuntimeLike<R | RetryR | PollR, unknown>;
  key?: QueryKey<any> | ReadonlyArray<QueryKey<any>>;
  name?: string;
  /** Optional retry policy for typed query failures. */
  retrySchedule?: Schedule.Schedule<unknown, NoInfer<E>, RetryError, RetryR>;
  /** Optional polling schedule that invalidates the query key on each tick. */
  pollSchedule?: Schedule.Schedule<unknown, unknown, PollError, PollR>;
  onTransition?: (event: {
    readonly name?: string;
    readonly phase: "start" | "success" | "failure" | "defect";
  }) => void;
  /** Optional metrics/tracing callback with timing information per execution. */
  observe?: (event: {
    readonly kind: "query";
    readonly name?: string;
    readonly phase: "start" | "success" | "failure" | "defect";
    readonly startedAt: number;
    readonly finishedAt?: number;
    readonly durationMs?: number;
  }) => void;
}

export interface QueryRef<A, E> {
  readonly key: QueryKey<A>;
  readonly result: Accessor<Result<A, E>>;
  readonly pending: Accessor<boolean>;
  readonly latest: Accessor<A | undefined>;
  /** Snapshot current query state as an `Effect` for typed composition. */
  effect(): Effect.Effect<A, E | BridgeError>;
  invalidate(): void;
  refresh(): void;
}

export interface QueryGet {
  <A>(atom: AtomTypes.ReadonlyAtom<A, any, any>): A;
  get<A>(atom: AtomTypes.ReadonlyAtom<A, any, any>): A;
  result<A, E>(atom: AtomTypes.ReadonlyAtom<Result<A, E>, any, any>): Effect.Effect<A, E | BridgeError>;
}

function resultAccessorToEffect<A, E>(
  readResult: Accessor<Result<A, E>>,
): Effect.Effect<A, E | BridgeError> {
  const state = readResult();
  if (state._tag === "Loading") {
      return Effect.fail<E | BridgeError>({ _tag: "ResultLoadingError", message: "Result is Loading" });
  }
  if (state._tag === "Refreshing") {
    const prev = state.previous;
    if (prev._tag === "Success") return Effect.succeed(prev.value);
      if (prev._tag === "Failure") return Effect.fail<E | BridgeError>(prev.error);
      return Effect.fail<E | BridgeError>({ _tag: "ResultDefectError", defect: prev.cause });
  }
  if (state._tag === "Success") return Effect.succeed(state.value);
    if (state._tag === "Stale") return Effect.fail<E | BridgeError>(state.error);
    if (state._tag === "Failure") return Effect.fail<E | BridgeError>(state.error);
    return Effect.fail<E | BridgeError>({ _tag: "ResultDefectError", defect: state.cause });
}

function resultValueToEffect<A, E>(
  state: Result<A, E>,
): Effect.Effect<A, E | BridgeError> {
  return resultAccessorToEffect(() => state);
}

const queryGet: QueryGet = Object.assign(
  (<A>(atom: AtomTypes.ReadonlyAtom<A, any, any>): A => atom()),
  {
    get<A>(atom: AtomTypes.ReadonlyAtom<A, any, any>): A {
      return atom();
    },
    result<A, E>(atom: AtomTypes.ReadonlyAtom<Result<A, E>, any, any>): Effect.Effect<A, E | BridgeError> {
      return resultValueToEffect(atom());
    },
  },
);

/**
 * Primary Effect-native query API with optional typed invalidation keys.
 *
 * Uses the ambient ManagedRuntime from `mount(...)` when available.
 * If no ambient runtime is present, returns a `Defect` result with guidance.
 */
function queryEffect<
  A,
  E,
  R,
  RetryError = never,
  RetryR = never,
  PollError = never,
  PollR = never,
>(
  fn: () => Effect.Effect<A, E, R>,
  options?: QueryEffectOptions<
    R,
    E,
    RetryError,
    RetryR,
    PollError,
    PollR
  >,
): Accessor<Result<A, E | RetryError>> {
  const keys = normalizeQueryKeys(options?.key);
  const emitTransition = (
    phase: "start" | "success" | "failure" | "defect",
    startedAt: number,
  ): void => {
    options?.onTransition?.({ name: options?.name, phase });
    const finishedAt = phase === "start" ? undefined : Date.now();
    options?.observe?.({
      kind: "query",
      name: options?.name,
      phase,
      startedAt,
      finishedAt,
      durationMs: finishedAt === undefined ? undefined : finishedAt - startedAt,
    });
  };
  const wrapped = () => {
    const startedAt = Date.now();
    trackQueryKeys(keys);
    emitTransition("start", startedAt);
    const effect: Effect.Effect<
      A,
      E | RetryError,
      R | RetryR
    > = options?.retrySchedule === undefined
      ? fn()
      : Effect.retry(fn(), options.retrySchedule);
    return effect.pipe(
      Effect.tap(() => Effect.sync(() => emitTransition("success", startedAt))),
      Effect.tapError((_) => Effect.sync(() => emitTransition("failure", startedAt))),
      Effect.tapDefect((_) => Effect.sync(() => emitTransition("defect", startedAt))),
    );
  };

  const startPolling = (
    runtimeArg: RuntimeLike<R | RetryR | PollR, unknown> | undefined,
  ): void => {
    if (options?.pollSchedule === undefined || keys.length === 0) return;
    const pollEffect = FxStream.runForEach(
      FxStream.fromSchedule(options.pollSchedule),
      () => Effect.sync(() => invalidate(keys)),
    ).pipe(Effect.ignoreCause);
    const pollFiber = runForkWithRuntime(
      runtimeArg,
      pollEffect as Effect.Effect<void, never, R | RetryR | PollR>,
    );
    onCleanup(() => {
      Effect.runFork(Fiber.interrupt(pollFiber));
    });
  };

  if (options?.runtime !== undefined) {
    startPolling(options.runtime);
    return atomEffect(
      () => wrapped(),
      options.runtime,
    );
  }
  const ambient = getAmbientManagedRuntime();
  if (ambient === null) {
    const [result] = createSignal<Result<A, E | RetryError>>(
      Result.defect(
        "[effect-atom-jsx] queryEffect(fn) requires an ambient ManagedRuntime. Use mount(..., layer) or pass { runtime }.",
      ),
    );
    return result;
  }
  startPolling(
    ambient as unknown as RuntimeLike<R | RetryR | PollR, unknown>,
  );
  return atomEffect(
    () => wrapped(),
    ambient as unknown as RuntimeLike<R | RetryR | PollR, unknown>,
  );
}

export type DefineQueryOptions<
  A,
  R,
  E = unknown,
  RetryError = never,
  RetryR = never,
  PollError = never,
  PollR = never,
> = Omit<
  QueryEffectOptions<R, E, RetryError, RetryR, PollError, PollR>,
  "key"
> & {
  key?: QueryKey<A>;
  name?: string;
  onTransition?: QueryEffectOptions<R, E>["onTransition"];
};

export function defineQuery<
  A,
  E,
  R,
  RetryError = never,
  RetryR = never,
  PollError = never,
  PollR = never,
>(
  fn: (get: QueryGet) => Effect.Effect<A, E, R>,
  options?: DefineQueryOptions<
    A,
    R,
    E,
    RetryError,
    RetryR,
    PollError,
    PollR
  >,
): QueryRef<A, E | RetryError>;
export function defineQuery<
  A,
  E,
  R,
  RetryError = never,
  RetryR = never,
  PollError = never,
  PollR = never,
>(
  fn: () => Effect.Effect<A, E, R>,
  options?: DefineQueryOptions<
    A,
    R,
    E,
    RetryError,
    RetryR,
    PollError,
    PollR
  >,
): QueryRef<A, E | RetryError>;
/**
 * Create a keyed query bundle for ergonomic query + invalidation wiring.
 *
 * @example
 * const todos = defineQuery(() => useService(TodoApi).list(), { name: "todos" })
 * mutationEffect(saveTodo, { invalidates: todos.key })
 *
 * @example
 * const profile = defineQuery((get) => {
 *   const userId = get(userIdAtom)
 *   return api.profile(userId)
 * })
 */
export function defineQuery<
  A,
  E,
  R,
  RetryError = never,
  RetryR = never,
  PollError = never,
  PollR = never,
>(
  fn: (() => Effect.Effect<A, E, R>) | ((get: QueryGet) => Effect.Effect<A, E, R>),
  options?: DefineQueryOptions<
    A,
    R,
    E,
    RetryError,
    RetryR,
    PollError,
    PollR
  >,
): QueryRef<A, E | RetryError> {
  const key = options?.key ?? createQueryKey<A>(options?.name);
  const run = (): Effect.Effect<A, E, R> =>
    (fn as (get: QueryGet) => Effect.Effect<A, E, R>)(queryGet);
  const result = queryEffect(run, {
    runtime: options?.runtime,
    key,
    name: options?.name,
    onTransition: options?.onTransition,
    retrySchedule: options?.retrySchedule,
    pollSchedule: options?.pollSchedule,
    observe: options?.observe,
  });
  return {
    key,
    result,
    pending: isPending(result),
    latest: latest(result),
    effect: () => resultAccessorToEffect(result),
    invalidate: () => invalidate(key),
    refresh: () => invalidate(key),
  };
}

/**
 * Returns `true` while a `Result` accessor is revalidating.
 *
 * This is `false` during first-load `Loading`, and `true` for `Refreshing`.
 *
 * @example
 * const pending = isPending(userResult)
 * // pending() is true only when stale data is being revalidated
 */
export function isPending<A, E>(result: Accessor<Result<A, E>>): Accessor<boolean> {
  return createMemo(() => Result.isRefreshing(result()));
}

/**
 * Returns the latest successful value from an async result accessor.
 *
 * - `Success(value)` => `value`
 * - `Refreshing(Success(previous))` => `previous.value`
 * - `Stale(error, data)` => `data`
 * - otherwise => `undefined`
 *
 * @example
 * const userLatest = latest(userResult)
 * <Show when={userLatest()}>{(u) => <UserCard user={u()} />}</Show>
 */
export function latest<A, E>(result: Accessor<Result<A, E>>): Accessor<A | undefined> {
  return createMemo(() => {
    const current = result();
    if (current._tag === "Success") return current.value;
    if (current._tag === "Stale") return current.data;
    if (current._tag === "Refreshing" && current.previous._tag === "Success") {
      return current.previous.value;
    }
    return undefined;
  });
}

// ─── Optimistic / actions ─────────────────────────────────────────────────────

export interface OptimisticRef<T> {
  (): T;
  get(): T;
  set(value: T | ((prev: T) => T)): void;
  clear(): void;
  isPending(): boolean;
}

/** Source can be any callable read accessor, including callable atoms. */
export function createOptimistic<T>(source: Accessor<T>): OptimisticRef<T>;
export function createOptimistic<T>(source: () => T): OptimisticRef<T>;
/**
 * Create an optimistic overlay over a source accessor.
 *
 * While pending, reads come from the optimistic value. `clear()` drops the
 * overlay and resumes reads from `source`.
 */
export function createOptimistic<T>(source: () => T): OptimisticRef<T> {
  type Override = { readonly hasValue: false } | { readonly hasValue: true; readonly value: T };
  const [override, setOverride] = createSignal<Override>({ hasValue: false });

  const getValue = (): T => {
    const current = override();
    return current.hasValue ? current.value : source();
  };

  const optimistic = (() => getValue()) as OptimisticRef<T>;

  optimistic.get = () => getValue();
  optimistic.set = (value) => {
      const prev = getValue();
      const next = typeof value === "function"
        ? (value as (x: T) => T)(prev)
        : value;
      setOverride({ hasValue: true, value: next });
    };
  optimistic.clear = () => {
      setOverride({ hasValue: false });
    };
  optimistic.isPending = () => {
      return override().hasValue;
    };
  return optimistic;
}

type TypedCatch<E> = Schema.Codec<E, unknown> | ((error: unknown) => error is E);

function matchesTypedCatch<E>(matcher: TypedCatch<E>, error: unknown): error is E {
  // Schemas can be functions at runtime; prefer Schema.isSchema over typeof.
  if (typeof matcher === "function" && !Schema.isSchema(matcher)) {
    return (matcher as (value: unknown) => value is E)(error);
  }
  const decode = Schema.decodeUnknownSync(matcher as any);
  try {
    decode(error);
    return true;
  } catch {
    return false;
  }
}

export interface MutationEffectHandle<A, E> {
  run(input: A): void;
  /** Run mutation and await settled state as an `Effect` for composition. */
  effect(input: A): Effect.Effect<void, E | BridgeError | MutationSupersededError>;
  result: Accessor<Result<void, E>>;
  pending: Accessor<boolean>;
}

export type MutationInputOf<T> = T extends MutationEffectHandle<infer A, any> ? A : never;
export type MutationErrorOf<T> = T extends MutationEffectHandle<any, infer E> ? E : never;
export type MutationEffectErrorOf<T> = T extends MutationEffectHandle<any, infer E>
  ? E | BridgeError | MutationSupersededError
  : never;
export type MutationSuccessOf<T> = T extends MutationEffectHandle<any, any> ? void : never;

export interface MutationEffectOptions<A, E, R> {
  runtime?: RuntimeLike<R, unknown>;
  /** Logical operation name included in observability events. */
  name?: string;
  invalidates?: QueryKey<any> | ReadonlyArray<QueryKey<any>>;
  optimistic?: (input: A) => void;
  rollback?: (input: A) => void;
  /**
   * Optional refresh hooks executed after successful mutation completion.
   * Accepts a single callback or an array of callbacks.
   */
  refresh?: (() => void) | ReadonlyArray<() => void>;
  onSuccess?: (input: A) => void;
  onFailure?: (error: MutationFailure<E>, input: A) => void;
  /** Lifecycle hook for start/success/failure/defect transitions. */
  onTransition?: (event: { readonly phase: "start" | "success" | "failure" | "defect" }) => void;
  /** Optional metrics/tracing callback with timing information per execution. */
  observe?: (event: {
    readonly kind: "mutation";
    readonly name?: string;
    readonly phase: "start" | "success" | "failure" | "defect";
    readonly startedAt: number;
    readonly finishedAt?: number;
    readonly durationMs?: number;
  }) => void;
}

function runRefreshHooks(refresh: MutationEffectOptions<any, any, any>["refresh"]): void {
  if (refresh === undefined) return;
  if (typeof refresh === "function") {
    refresh();
    return;
  }
  for (const hook of refresh) {
    hook();
  }
}

/**
 * Build an Effect-powered mutation action with optional optimistic updates.
 *
 * `run(input)` executes `fn(input)` in a fiber. If a new run starts, the
 * previous run is interrupted and ignored.
 *
 * Lifecycle:
 * - Before run: optional `optimistic(input)`
 * - On success: set `result=Success`, run `refresh`, then `onSuccess`
 * - On typed failure/defect: run `rollback`, then `onFailure`, then set error state
 *
 * @example
 * const save = mutationEffect(saveTodo, {
 *   optimistic: (todo) => optimisticTodos.set((xs) => [todo, ...xs]),
 *   rollback: () => optimisticTodos.clear(),
 *   refresh: () => refreshTodos(),
 * })
 */
function mutationEffect<A, E, R>(
  fn: (input: A) => Effect.Effect<unknown, E, R>,
  options?: MutationEffectOptions<A, E, R>,
): MutationEffectHandle<A, E> {
  const [result, setResult] = createSignal<Result<void, E>>(Result.success(undefined));
  let fiberRef: Fiber.Fiber<unknown, unknown> | null = null;
  let runVersion = 0;

  const interrupt = (): void => {
    if (fiberRef !== null) {
      const f = fiberRef;
      fiberRef = null;
      Effect.runFork(Fiber.interrupt(f));
    }
  };

  resultControllers.set(result as Accessor<Result<any, any>>, {
    set: (next) => setResult(next as Result<void, E>),
    interrupt,
  });

  const run = (input: A): void => {
    runVersion += 1;
    const version = runVersion;
    const startedAt = Date.now();

    const emitTransition = (phase: "start" | "success" | "failure" | "defect"): void => {
      options?.onTransition?.({ phase });
      const finishedAt = phase === "start" ? undefined : Date.now();
      options?.observe?.({
        kind: "mutation",
        name: options?.name,
        phase,
        startedAt,
        finishedAt,
        durationMs: finishedAt === undefined ? undefined : finishedAt - startedAt,
      });
    };

    interrupt();

    options?.optimistic?.(input);
    emitTransition("start");

    const prev = previousFromResult(untrack(result));
    if (prev === null) {
      setResult(Result.loading);
    } else {
      setResult(Result.refreshing(prev));
    }

    const wrapped = pipe(
      fn(input),
      Effect.matchCause({
        onSuccess: (): void => {
          if (version !== runVersion) return;
          fiberRef = null;
          setResult(Result.success(undefined));
          if (options?.invalidates !== undefined) {
            invalidate(options.invalidates);
          }
          runRefreshHooks(options?.refresh);
          options?.onSuccess?.(input);
          emitTransition("success");
        },
        onFailure: (cause: Cause.Cause<E>): void => {
          if (version !== runVersion) return;
          fiberRef = null;
          const typed = Cause.findErrorOption(cause);
          if (Option.isSome(typed)) {
            options?.rollback?.(input);
            options?.onFailure?.(typed.value, input);
            emitTransition("failure");
            setResult(Result.failure(typed.value));
          } else {
            const defect = Cause.pretty(cause);
            options?.rollback?.(input);
            options?.onFailure?.({ _tag: "ResultDefectError", defect }, input);
            emitTransition("defect");
            setResult(Result.defect(defect, cause));
          }
        },
      }),
    );

    fiberRef = runForkWithRuntime(options?.runtime, wrapped as Effect.Effect<void, never, R>) as
      Fiber.Fiber<unknown, unknown>;
  };

  const effect = (input: A): Effect.Effect<void, E | BridgeError | MutationSupersededError> =>
    Effect.tryPromise({
      try: async () => {
        run(input);
        const version = runVersion;
        await new Promise<void>((resolve, reject) => {
          const owner = new Owner(getOwner());
          runWithOwner(owner, () => {
            createEffect(() => {
              if (version !== runVersion) {
                owner.dispose();
                reject({ _tag: "MutationSupersededError", message: "Mutation superseded by a newer run" } as const);
                return;
              }
              const state = result();
              if (state._tag === "Loading" || state._tag === "Refreshing") return;
              owner.dispose();
              if (state._tag === "Success") {
                resolve();
                return;
              }
              if (state._tag === "Failure") {
                reject(state.error);
                return;
              }
              if (state._tag === "Stale") {
                reject(state.error);
                return;
              }
              reject({ _tag: "ResultDefectError", defect: state.cause } as const);
            });
          });
        });
      },
      catch: (error) => error as E | BridgeError | MutationSupersededError,
    });

  onCleanup(interrupt);

  return {
    run,
    effect,
    result,
    pending: createMemo(() => {
      const r = result();
      return r._tag === "Loading" || r._tag === "Refreshing";
    }),
  };
}

// ─── createAtom ───────────────────────────────────────────────────────────────

/**
 * Ergonomic atom API. Pass a plain value for a writable atom, or a getter
 * function `(get) => derived` for a derived (read-only) atom.
 *
 * Derived atoms use the reactive Computation system — `get(otherAtom)` reads
 * and tracks `otherAtom` so the derived value recomputes on change.
 *
 * @example
 * const count = createAtom(0);
 * const doubled = createAtom((get) => get(count) * 2);
 *
 * count.set(5);
 * doubled.get(); // 10
 */
export type AtomGetter<T> = (get: <U>(atom: ReadableAtom<U>) => U) => T;

export interface ReadableAtom<T> {
  get(): T;
}

export interface WritableAtom<T> extends ReadableAtom<T> {
  set(value: T | ((prev: T) => T)): void;
  update(fn: (prev: T) => T): void;
  /** Subscribe outside a reactive context; returns an unsubscribe function. */
  subscribe(listener: (value: T) => void): () => void;
}

export interface DerivedAtom<T> extends ReadableAtom<T> {
  subscribe(listener: (value: T) => void): () => void;
}

export type Atom<T> = WritableAtom<T> | DerivedAtom<T>;

export function createAtom<T>(getter: AtomGetter<T>): DerivedAtom<T>;
export function createAtom<T>(value: T): WritableAtom<T>;
export function createAtom<T>(
  valueOrGetter: T | AtomGetter<T>,
): WritableAtom<T> | DerivedAtom<T> {
  if (typeof valueOrGetter === "function") {
    return _createDerivedAtom(valueOrGetter as AtomGetter<T>);
  }
  return _createWritableAtom(valueOrGetter);
}

function _createWritableAtom<T>(initial: T): WritableAtom<T> {
  const signal = new Signal<T>(initial);
  return {
    get() { return signal.get(); },
    set(value) { signal.set(value); },
    update(fn) { signal.set(fn(signal.peek())); },
    subscribe(listener) {
      // Create a standalone root so the effect has an owner for cleanup.
      let dispose = () => {};
      const owner = new Owner();
      runWithOwner(owner, () => {
        createEffect(() => listener(signal.get()));
      });
      return () => owner.dispose();
    },
  };
}

function _createDerivedAtom<T>(getter: AtomGetter<T>): DerivedAtom<T> {
  const getAtom = <U>(atom: ReadableAtom<U>): U => atom.get();
  // createMemo sets up a Computation under the current owner.
  const memo = createMemo(() => getter(getAtom));
  return {
    get() { return memo(); },
    subscribe(listener) {
      const owner = new Owner();
      runWithOwner(owner, () => {
        createEffect(() => listener(memo()));
      });
      return () => owner.dispose();
    },
  };
}

// ─── scopedRoot ───────────────────────────────────────────────────────────────

/**
 * Create a reactive root whose lifetime is bound to an Effect CloseableScope.
 *
 * Bidirectional cleanup:
 * - When `scope` closes (via `Effect.scoped` / `Scope.close`), all reactive
 *   computations created inside `fn` are disposed.
 * - When the reactive root disposes, the scope is closed.
 *
 * @example
 * const program = Effect.gen(function* () {
 *   const scope = yield* Scope.make();
 *   scopedRoot(scope, () => {
 *     const [count, setCount] = createSignal(0);
 *     createEffect(() => console.log("count:", count()));
 *   });
 *   yield* Scope.close(scope, Exit.void);
 *   // ^ automatically disposes the createEffect above
 * });
 */
/**
 * Effect constructor variant of `scopedRoot`.
 *
 * Registers owner disposal as a scope finalizer and evaluates `fn` under that
 * owner. The scope is the single authority for lifetime.
 */
export function scopedRootEffect<T>(
  scope: Scope.Closeable,
  fn: () => T,
): Effect.Effect<T> {
  return Effect.gen(function* () {
    const owner = new Owner(getOwner());
    yield* Scope.addFinalizer(scope, Effect.sync(() => owner.dispose()));
    return runWithOwner(owner, () => withComponentScope(scope, fn));
  });
}

/**
 * Create a scope-bound query accessor whose root is tied to an Effect Scope.
 *
 * When the scope closes, the query is disposed (fiber interrupted, all
 * reactive computations cleaned up).
 *
 * @example
 * Effect.gen(function* () {
 *   const scope = yield* Scope.make();
 *   const result = yield* scopedQueryEffect(scope, () => useService(Api).list());
 *   // result() is Result<A, E>
 *   yield* Scope.close(scope, Exit.void); // cleans up query
 * })
 */
/**
 * Effect constructor for scope-bound queries.
 */
export function scopedQueryEffect<
  A,
  E,
  R,
  RetryError = never,
  RetryR = never,
  PollError = never,
  PollR = never,
>(
  scope: Scope.Closeable,
  fn: () => Effect.Effect<A, E, R>,
  options?: QueryEffectOptions<
    R,
    E,
    RetryError,
    RetryR,
    PollError,
    PollR
  >,
): Effect.Effect<Accessor<Result<A, E | RetryError>>> {
  return scopedRootEffect(scope, () => queryEffect(fn, options));
}

/**
 * Create a scope-bound mutation handle whose root is tied to an Effect Scope.
 *
 * When the scope closes, the mutation is disposed (in-flight fiber
 * interrupted, all reactive computations cleaned up).
 *
 * @example
 * Effect.gen(function* () {
 *   const scope = yield* Scope.make();
 *   const save = yield* scopedMutationEffect(scope, (n: number) => useService(Api).save(n));
 *   save.run(42);
 *   yield* Scope.close(scope, Exit.void); // cleans up mutation
 * })
 */
/**
 * Effect constructor for scope-bound mutations.
 */
export function scopedMutationEffect<A, E, R>(
  scope: Scope.Closeable,
  fn: (input: A) => Effect.Effect<unknown, E, R>,
  options?: MutationEffectOptions<A, E, R>,
): Effect.Effect<MutationEffectHandle<A, E>> {
  return scopedRootEffect(scope, () => mutationEffect(fn, options));
}

// ─── layerContext ─────────────────────────────────────────────────────────────

/**
 * Build an Effect Layer and expose its services once the layer is ready.
 * Children are rendered only after the layer has initialised.
 *
 * Returns an object with a reactive `children` getter — suitable for use
 * with `insert()` or as a component return value.
 *
 * @example
 * const AppLayer = Layer.mergeAll(DatabaseLive, HttpLive);
 * layerContext(AppLayer, () => <App />);
 */
export function layerContext<A, E, RIn>(
  layer: Layer.Layer<A, E, RIn>,
  fn: () => unknown,
  ...runtime: [RIn] extends [never]
    ? [runtime?: RuntimeLike<RIn, unknown>]
    : [runtime: RuntimeLike<RIn, unknown>]
): { readonly children: unknown } {
  const runtimeArg = runtime[0] as RuntimeLike<RIn, unknown> | undefined;
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal<E | null>(null);

  const fiber = pipe(
    Layer.launch(layer),
    Effect.matchCause({
      onSuccess: (): void => { setReady(true); },
      onFailure: (cause: Cause.Cause<E>): void => {
        const typed = Cause.findErrorOption(cause);
        if (Option.isSome(typed)) {
          setError(typed.value);
        } else {
          console.error("[effect-atom-jsx] layerContext: layer build failed:", Cause.pretty(cause));
        }
      },
    }),
    (eff) => runForkWithRuntime(runtimeArg, eff as Effect.Effect<void, never, RIn>),
  );

  const interrupt = (): void => {
    Effect.runFork(Fiber.interrupt(fiber));
  };

  const scope = currentComponentScope();
  if (scope !== null) {
    Effect.runSync(Scope.addFinalizer(scope, Effect.sync(interrupt)));
  }

  onCleanup(() => {
    interrupt();
  });

  return {
    get children() {
      if (error()) return null;
      return ready() ? fn() : null;
    },
  };
}

// ─── mount ────────────────────────────────────────────────────────────────────

/**
 * Mount a component tree with a ManagedRuntime created from `layer`.
 *
 * The runtime is injected into the owner tree, making `useService(tag)` and
 * `defineQuery(...)` available anywhere under this mount.
 */
export function mount<R, E>(
  fn: () => unknown,
  container: Element,
  layer: Layer.Layer<R, E, never>,
): () => void {
  return mountWithManagedRuntime(fn, container, ManagedRuntime.make(layer), { ownsRuntime: true });
}

/**
 * Mount using a caller-owned `ManagedRuntime` (e.g. `Atom.runtime(layer).managed`),
 * so the atom world and the component tree share one service world instead of
 * building two from separate layer values.
 *
 * The caller owns the runtime's lifecycle: disposing the returned function
 * tears down the render tree and component scope but does not dispose the
 * shared runtime.
 */
export function mountWithManagedRuntime(
  fn: () => unknown,
  container: Element,
  managed: ManagedRuntime.ManagedRuntime<any, any>,
  options?: {
    readonly ownsRuntime?: boolean;
    readonly scope?: Scope.Closeable;
    readonly ownsScope?: boolean;
  },
): () => void {
  const ownsRuntime = options?.ownsRuntime ?? false;
  const ownsScope = options?.ownsScope ?? true;
  const maybeReactivityOption = managed.runSync(
    Effect.serviceOption(ReactivityTag),
  );
  const maybeReactivity = Option.isSome(maybeReactivityOption)
    ? maybeReactivityOption.value
    : null;
  const restoreReactivity = installReactivityService(maybeReactivity);
  // DQ-033: no ambient single-flight transport. A transport lives in a
  // runtime's layer and reaches actions through Effect context only — a
  // module-level slot can never be per-request, which is how the
  // cross-request bleed happened.
  const rootScope = options?.scope ?? Scope.makeUnsafe();
  const disposeOwnedRuntime = (): void => {
    if (!ownsRuntime) return;
    void managed.dispose().catch((error) => {
      console.error(
        "[effect-atom-jsx] mount: failed to dispose ManagedRuntime:",
        error,
      );
    });
  };
  const cleanup = (disposeRender?: () => void): void => {
    let failed = false;
    let failure: unknown;
    const attempt = (finalizer: () => void): void => {
      try {
        finalizer();
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    };
    if (disposeRender !== undefined) attempt(disposeRender);
    if (ownsScope) attempt(() => closeComponentScope(rootScope));
    // Ambient services are stacks: release them in reverse installation order.
    attempt(restoreReactivity);
    disposeOwnedRuntime();
    if (failed) throw failure;
  };

  let disposeRender: () => void;
  try {
    disposeRender = render(
      () =>
        withManagedRuntimeContext(
          managed as ManagedRuntime.ManagedRuntime<unknown, unknown>,
          () => withComponentScope(rootScope, fn),
        ),
      container,
    );
  } catch (error) {
    try {
      cleanup();
    } catch {
      // Preserve the mount failure; cleanup is still attempted exhaustively.
    }
    throw error;
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    cleanup(disposeRender);
  };
}

// ─── Async ────────────────────────────────────────────────────────────────────

/**
 * Declarative pattern-match on a `Result` for async UI.
 *
 * @example
 * <Async
 *   result={user()}
 *   loading={() => <span>Loading…</span>}
 *   error={(e) => <span>Error: {String(e)}</span>}
 *   defect={(msg) => <span>Unexpected error: {msg}</span>}
 *   success={(u) => <span>Hello, {u.name}</span>}
 * />
 */
export function Async<A, E>(props: {
  result: Result<A, E>;
  loading?: () => unknown;
  refreshing?: (previous: Success<A> | Failure<E> | Defect) => unknown;
  stale?: (error: E, data: A) => unknown;
  error?: (err: E) => unknown;
  defect?: (cause: string) => unknown;
  success: (value: A) => unknown;
}): unknown {
  const renderSettled = (r: Success<A> | Failure<E> | Defect): unknown => {
    if (r._tag === "Failure") return props.error?.(r.error) ?? null;
    if (r._tag === "Defect") return props.defect?.(r.cause) ?? null;
    return props.success(r.value);
  };

  const r = props.result;
  if (r._tag === "Loading") return props.loading?.() ?? null;
  if (r._tag === "Refreshing") return props.refreshing?.(r.previous) ?? renderSettled(r.previous);
  if (r._tag === "Stale") return props.stale?.(r.error, r.data) ?? props.error?.(r.error) ?? props.success(r.data);
  return renderSettled(r);
}


export function defineMutation<A, E, R>(
  fn: (input: A) => Effect.Effect<unknown, E, R>,
  options?: MutationEffectOptions<A, E, R>,
): MutationEffectHandle<A, E> {
  return mutationEffect(fn, options);
}

function isAccessor<T>(u: unknown): u is Accessor<T> {
  return typeof u === "function";
}

function renderNode(node: unknown): unknown {
  return typeof node === "function" ? (node as () => unknown)() : node;
}

// ─── Loading / Errored ────────────────────────────────────────────────────────

function isLoadingInput(input: Result<unknown, unknown> | boolean): boolean {
  if (typeof input === "boolean") return input;
  return input._tag === "Loading";
}

/**
 * Declarative loading boundary.
 *
 * - With `Result`: shows `fallback` only during first `Loading`
 * - With `boolean`: shows `fallback` when `true`
 * - `Refreshing` does not show fallback; children continue rendering
 *
 * @example
 * <Loading when={todosResult} fallback={() => <Spinner />}>...</Loading>
 */
export function Loading(props: {
  when: Result<unknown, unknown> | boolean | Accessor<Result<unknown, unknown> | boolean>;
  fallback: () => unknown;
  children: unknown;
}): unknown {
  const whenValue = isAccessor<Result<unknown, unknown> | boolean>(props.when)
    ? props.when()
    : props.when;

  if (isLoadingInput(whenValue)) return props.fallback();
  return renderNode(props.children);
}

/**
 * Declarative error boundary for `Result`.
 *
 * Handles both typed failures and defects:
 * - `Failure<E>` -> `children(error)`
 * - `Defect` -> `children({ defect })`
 *
 * @example
 * <Errored result={todosResult}>
 *   {(e) => <ErrorBanner message={"defect" in e ? e.defect : String(e)} />}
 * </Errored>
 */
export function Errored<A, E>(props: {
  result: Result<A, E> | Accessor<Result<A, E>>;
  fallback?: () => unknown;
  children: (error: E | ResultDefectError) => unknown;
}): unknown {
  const result = isAccessor<Result<A, E>>(props.result)
    ? props.result()
    : props.result;

  if (result._tag === "Failure") return props.children(result.error);
  if (result._tag === "Stale") return props.children(result.error);
  if (result._tag === "Defect") return props.children({ _tag: "ResultDefectError", defect: result.cause });
  return props.fallback?.() ?? null;
}

/**
 * Typed boundary over `Result` failures/defects.
 *
 * Renders `children(error)` only when `catch` matches the current error.
 * Unmatched errors fall through to `fallback`.
 */
export function TypedBoundary<E>(props: {
  result: Result<unknown, unknown> | Accessor<Result<unknown, unknown>>;
  catch: TypedCatch<E>;
  children: (error: E) => unknown;
  fallback?: () => unknown;
}): unknown {
  const state = isAccessor<Result<unknown, unknown>>(props.result)
    ? props.result()
    : props.result;

  const candidate: unknown =
    state._tag === "Failure"
      ? state.error
      : state._tag === "Stale"
        ? state.error
      : state._tag === "Defect"
        ? { defect: state.cause }
        : undefined;

  if (candidate !== undefined && matchesTypedCatch(props.catch, candidate)) {
    return props.children(candidate);
  }
  return props.fallback?.() ?? null;
}

// ─── Switch / Match ───────────────────────────────────────────────────────────

const MatchTypeId = Symbol.for("effect-atom-jsx/Match");

type MatchCase<T> = {
  readonly [MatchTypeId]: true;
  readonly when: T | false | null | undefined | 0 | "";
  readonly children: ((value: NonNullable<T>) => unknown) | unknown;
};


/**
 * Creates a Switch case descriptor.
 *
 * @example
 * Switch({
 *   children: [
 *     Match({ when: isAdmin, children: "admin" }),
 *     Match({ when: isUser, children: "user" }),
 *   ],
 *   fallback: () => "guest",
 * })
 */
export function Match<T>(props: {
  when: T | false | null | undefined | 0 | "";
  children: ((value: NonNullable<T>) => unknown) | unknown;
}): MatchCase<T> {
  return {
    [MatchTypeId]: true,
    when: props.when,
    children: props.children,
  };
}

/**
 * Create a mount function pre-bound to a Layer.
 *
 * @example
 * const mountApp = createMount(AppLayer)
 * mountApp(() => <App />, root)
 */
export function createMount<R, E>(
  layer: Layer.Layer<R, E, never>,
): (fn: () => unknown, container: Element) => () => void {
  return (fn, container) => mount(fn, container, layer);
}


/**
 * Renders the first matching `Match` case.
 */
export function Switch(props: {
  fallback?: () => unknown;
  children: unknown;
}): unknown {
  const children = Array.isArray(props.children)
    ? props.children
    : [props.children];

  for (const child of children) {
    if (typeof child === "object" && child !== null && MatchTypeId in child) {
      const match = child as MatchCase<unknown>;
      if (!match.when) continue;
      if (typeof match.children === "function") {
        return (match.children as (value: unknown) => unknown)(match.when);
      }
      return match.children;
    }
  }

  return props.fallback?.() ?? null;
}

// ─── Optional / Option matching ───────────────────────────────────────────────

/**
 * Null-safe conditional rendering.
 *
 * Unlike `Show`, this only checks for `null | undefined`, so values like
 * `0`, `""`, and `false` are treated as present values.
 */
export function Optional<T>(props: {
  when: T | null | undefined | Accessor<T | null | undefined>;
  fallback?: () => unknown;
  children: ((value: NonNullable<T>) => unknown) | unknown;
}): unknown {
  const value = isAccessor<T | null | undefined>(props.when) ? props.when() : props.when;
  if (value === null || value === undefined) return props.fallback?.() ?? null;
  if (typeof props.children === "function") {
    return (props.children as (v: NonNullable<T>) => unknown)(value as NonNullable<T>);
  }
  return props.children;
}

/**
 * Pattern match `Option.Option<A>` values declaratively.
 */
export function MatchOption<A>(props: {
  value: Option.Option<A> | Accessor<Option.Option<A>>;
  some: (value: A) => unknown;
  none?: () => unknown;
}): unknown {
  const value = isAccessor<Option.Option<A>>(props.value) ? props.value() : props.value;
  return Option.match(value, {
    onNone: () => props.none?.() ?? null,
    onSome: props.some,
  });
}

// ─── Dynamic / lazy-like helpers ──────────────────────────────────────────────

/**
 * Runtime-selected component renderer.
 */
export function Dynamic<P extends Record<string, unknown>>(props: {
  component: ((props: P) => unknown) | null | undefined;
  fallback?: () => unknown;
} & P): unknown {
  const { component, fallback, ...rest } = props as {
    component: ((props: P) => unknown) | null | undefined;
    fallback?: () => unknown;
  } & P;

  if (component == null) return fallback?.() ?? null;
  return component(rest as unknown as P);
}

/**
 * Frame-timestamp signal driven by `requestAnimationFrame`.
 */
export function createFrame(initial = Date.now()): Accessor<number> {
  const [time, setTime] = createSignal(initial);
  if (typeof globalThis.requestAnimationFrame !== "function") {
    return time;
  }

  let id = 0;
  const loop = (t: number): void => {
    setTime(t);
    id = globalThis.requestAnimationFrame(loop);
  };
  id = globalThis.requestAnimationFrame(loop);

  onCleanup(() => {
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(id);
    }
  });

  return time;
}

/**
 * Convenience frame component that passes the RAF timestamp to children.
 */
export function Frame(props: { children: (time: number) => unknown }): Accessor<unknown> {
  const frame = createFrame();
  return createMemo(() => props.children(frame()));
}

// ─── Layer helpers ─────────────────────────────────────────────────────────────

/**
 * Component-style Layer boundary.
 *
 * Uses `layerContext` under the hood and renders `fallback` while unresolved.
 */
export function WithLayer<A, E, RIn>(props: {
  layer: Layer.Layer<A, E, RIn>;
  runtime?: RuntimeLike<RIn, unknown>;
  fallback?: () => unknown;
  children: () => unknown;
}): unknown {
  const ctx = layerContext(
    props.layer as Layer.Layer<A, E, RIn>,
    props.children as () => unknown,
    props.runtime as RuntimeLike<RIn, unknown>,
  );
  return ctx.children ?? props.fallback?.() ?? null;
}

// ─── MatchTag ─────────────────────────────────────────────────────────────────

type Tagged = { readonly _tag: string };

type MatchTagCases<T extends Tagged, R> = {
  [K in T["_tag"]]?: (value: Extract<T, { readonly _tag: K }>) => R;
};

/**
 * Type-safe pattern matching over discriminated unions by `_tag`.
 *
 * @example
 * const out = MatchTag({
 *   value: result(),
 *   cases: {
 *     Success: (v) => v.value,
 *     Failure: (v) => `error:${String(v.error)}`,
 *   },
 *   fallback: () => "pending",
 * })
 */
export function MatchTag<T extends Tagged, R>(props: {
  value: T | Accessor<T>;
  cases: MatchTagCases<T, R>;
  fallback?: (value: T) => R;
}): R | null {
  const value = isAccessor<T>(props.value) ? props.value() : props.value;
  const handler = props.cases[value._tag as T["_tag"]] as ((v: T) => R) | undefined;
  if (handler) return handler(value);
  return props.fallback ? props.fallback(value) : null;
}

// ─── For ──────────────────────────────────────────────────────────────────────

/**
 * Reactive list rendering. When `each` is a signal accessor, the list
 * re-renders whenever the signal changes.
 *
 * Returns a memo accessor so that `insert()` wraps it in a Computation —
 * only the list portion of the DOM updates on change.
 *
 * @example
 * const [items, setItems] = createSignal([1, 2, 3]);
 * <For each={items}>
 *   {(item, index) => <li>{index()}: {item}</li>}
 * </For>
 */
export function For<T>(props: {
  each: T[] | Accessor<T[]>;
  fallback?: () => unknown;
  children: (item: T, index: Accessor<number>) => unknown;
}): Accessor<unknown[]> {
  const eachAccessor: Accessor<T[]> =
    typeof props.each === "function"
      ? (props.each as Accessor<T[]>)
      : () => props.each as T[];

  // createMemo returns an accessor — insert() detects functions and wraps
  // them in a Computation, so the DOM updates reactively when items change.
  return createMemo(() => {
    const list = eachAccessor();
    if (list.length === 0 && props.fallback) return [props.fallback()];
    return list.map((item, i) => props.children(item, () => i));
  });
}

// ─── Show ─────────────────────────────────────────────────────────────────────

/**
 * Conditional rendering. `when` is evaluated reactively — if it's a signal
 * accessor, the branch switches automatically when the signal changes.
 *
 * @example
 * const [show, setShow] = createSignal(true);
 * <Show when={show()} fallback={() => <span>Hidden</span>}>
 *   {(v) => <span>Visible: {String(v)}</span>}
 * </Show>
 */
export function Show<T>(props: {
  when: T | false | null | undefined | 0 | "";
  fallback?: () => unknown;
  children: ((value: NonNullable<T>) => unknown) | unknown;
}): unknown {
  if (!props.when) return props.fallback?.() ?? null;
  if (typeof props.children === "function") {
    return (props.children as (v: NonNullable<T>) => unknown)(props.when as NonNullable<T>);
  }
  return props.children;
}
