/**
 * Result.ts — Synchronous result type with revalidation tracking.
 *
 * `Result<A, E>` is a three-state union (Initial | Success | Failure) designed
 * for atom-based data fetching. Unlike `AsyncResult`, Result carries `waiting`
 * and `previousSuccess` metadata so UI can show stale-while-revalidate patterns
 * without separate loading state.
 */

import { AsyncResult, type Defect } from "./effect-ts.js";
import { Cause, Exit, Option, pipe } from "effect";

export type Initial<A, E = never> = {
  readonly _tag: "Initial";
  /** Whether a fetch is currently in progress (first-load). */
  readonly waiting: boolean;
};

export type Success<A, E = never> = {
  readonly _tag: "Success";
  readonly value: A;
  /** Whether a revalidation fetch is in progress while this value is stale. */
  readonly waiting: boolean;
  /** Epoch millisecond timestamp of when this value was produced. */
  readonly timestamp: number;
};

export type Failure<A, E = never> = {
  readonly _tag: "Failure";
  readonly error: E | { readonly defect: string };
  /** Whether a retry/revalidation fetch is in progress. */
  readonly waiting: boolean;
  /** The last successful value before this failure, if any. Enables stale-while-revalidate. */
  readonly previousSuccess: Success<A, E> | null;
};

export type Result<A, E = never> = Initial<A, E> | Success<A, E> | Failure<A, E>;

export interface BuilderHandlers<A, E, R> {
  onInitial?: () => R;
  onSuccess?: (value: A, meta: { readonly waiting: boolean; readonly timestamp: number }) => R;
  onFailure?: (error: E | { readonly defect: string }, meta: { readonly waiting: boolean; readonly previousSuccess: Success<A, E> | null }) => R;
}

export interface Builder<A, E, R> {
  onInitial<R2>(f: () => R2): Builder<A, E, R | R2>;
  onSuccess<R2>(f: (value: A, meta: { readonly waiting: boolean; readonly timestamp: number }) => R2): Builder<A, E, R | R2>;
  onFailure<R2>(f: (error: E | { readonly defect: string }, meta: { readonly waiting: boolean; readonly previousSuccess: Success<A, E> | null }) => R2): Builder<A, E, R | R2>;
  render(): R | undefined;
}

/** Type guard that checks whether an unknown value is a `Result`. */
export const isResult = (u: unknown): u is Result<unknown, unknown> =>
  typeof u === "object" && u !== null && "_tag" in u && (
    (u as { _tag?: string })._tag === "Initial"
    || (u as { _tag?: string })._tag === "Success"
    || (u as { _tag?: string })._tag === "Failure"
  );

/**
 * Construct an initial result value.
 *
 * `waiting=true` indicates first-load in progress.
 */
export const initial = <A = never, E = never>(waiting = false): Initial<A, E> => ({ _tag: "Initial", waiting });

/**
 * Construct a success result value.
 *
 * @example
 * const r = Result.success({ id: 1 })
 */
export const success = <A, E = never>(
  value: A,
  options?: { readonly waiting?: boolean; readonly timestamp?: number },
): Success<A, E> => ({
  _tag: "Success",
  value,
  waiting: options?.waiting ?? false,
  timestamp: options?.timestamp ?? Date.now(),
});

/** Construct a failure result value. */
export const failure = <A, E = never>(
  error: E | { readonly defect: string },
  options?: { readonly waiting?: boolean; readonly previousSuccess?: Success<A, E> | null },
): Failure<A, E> => ({
  _tag: "Failure",
  error,
  waiting: options?.waiting ?? false,
  previousSuccess: options?.previousSuccess ?? null,
});

export const isInitial = <A, E>(r: Result<A, E>): r is Initial<A, E> => r._tag === "Initial";
export const isNotInitial = <A, E>(r: Result<A, E>): r is Success<A, E> | Failure<A, E> => r._tag !== "Initial";
export const isSuccess = <A, E>(r: Result<A, E>): r is Success<A, E> => r._tag === "Success";
export const isFailure = <A, E>(r: Result<A, E>): r is Failure<A, E> => r._tag === "Failure";
export const isWaiting = <A, E>(r: Result<A, E>): boolean => r.waiting;

/**
 * Mark a result as waiting/revalidating.
 *
 * @example
 * const stale = Result.waiting(Result.success(data))
 */
export const waiting = <A, E>(r: Result<A, E>): Result<A, E> => {
  if (r.waiting) return r;
  if (r._tag === "Initial") return initial(true);
  if (r._tag === "Success") return success(r.value, { waiting: true, timestamp: r.timestamp });
  return failure(r.error, { waiting: true, previousSuccess: r.previousSuccess });
};

/**
 * Convert an `AsyncResult` (from `atomEffect`) to a `Result`.
 *
 * Maps Loading to Initial(waiting), Refreshing to the previous value with
 * `waiting=true`, and settles Success/Failure directly.
 *
 * @example
 * const result = Result.fromAsyncResult(userAsync())
 */
export function fromAsyncResult<A, E>(
  value: AsyncResult<A, E>,
): Result<A, E> {
  if (value._tag === "Loading") return initial(true);
  if (value._tag === "Refreshing") {
    const prev = value.previous;
    if (prev._tag === "Success") {
      return success(prev.value, { waiting: true });
    }
    if (prev._tag === "Failure") {
      return failure(prev.error, { waiting: true });
    }
    return failure({ defect: prev.cause }, { waiting: true });
  }
  if (value._tag === "Success") return success(value.value);
  if (value._tag === "Failure") return failure(value.error, { previousSuccess: null });
  // Instead of creating defect from cause string, use the rawCause from the exit field
  // if available.
  const raw = AsyncResult.rawCause(value);
  return Option.isSome(raw)
    ? failure({ defect: Cause.pretty(raw.value) } as unknown as E)
    : failure({ defect: value.cause });
}

/**
 * Produce a waiting Result from an optional previous result.
 *
 * If `previous` is `None`, returns `Initial(waiting=true)`. Otherwise marks
 * the previous result as waiting.
 *
 * @param previous - The previous result, if any.
 * @returns A Result with `waiting=true`.
 */
export function waitingFrom<A, E>(previous: Option.Option<Result<A, E>>): Result<A, E> {
  return Option.match(previous, {
    onNone: () => initial(true),
    onSome: (value) => waiting(value),
  });
}

/**
 * Convert an Effect `Exit` to a settled Result (Success or Failure).
 *
 * Typed errors become `Failure`, defects become `Failure({ defect })`.
 *
 * @param exit - The Effect Exit value to convert.
 * @returns A Success or Failure result.
 */
export function fromExit<A, E>(exit: Exit.Exit<A, E>): Success<A, E> | Failure<A, E> {
  return Exit.match(exit, {
    onSuccess: (value) => success(value),
    onFailure: (cause) => {
      const err = Cause.findErrorOption(cause);
      return Option.match(err, {
        onNone: () => failure({ defect: Cause.pretty(cause) } as unknown as E),
        onSome: (e) => failure(e as E),
      });
    },
  });
}

/**
 * Convert an Effect `Exit` to a Result, preserving `previousSuccess` from a
 * prior result when the exit is a failure.
 *
 * @param exit     - The Effect Exit value to convert.
 * @param previous - The previous Result, used to populate `previousSuccess` on failure.
 * @returns A Success or Failure result.
 */
export function fromExitWithPrevious<A, E>(
  exit: Exit.Exit<A, E>,
  previous: Option.Option<Result<A, E>>,
): Success<A, E> | Failure<A, E> {
  const next = fromExit(exit);
  if (next._tag === "Success") return next;
  const prev = Option.getOrUndefined(previous);
  return next.previousSuccess === null && prev?._tag === "Success"
    ? failure(next.error, { previousSuccess: prev })
    : next;
}

/**
 * Convert a `Result` back to an `AsyncResult` for use with UI components
 * like `<Async>` or `<Loading>`.
 *
 * @example
 * const asyncResult = Result.toAsyncResult(result)
 */
export function toAsyncResult<A, E>(
  value: Result<A, E>,
): AsyncResult<A, E> {
  if (value._tag === "Initial") return AsyncResult.loading;
  if (value._tag === "Success") return value.waiting ? AsyncResult.refreshing(AsyncResult.success(value.value)) : AsyncResult.success(value.value);
  if (typeof value.error === "object" && value.error !== null && "defect" in value.error) {
    const defect = AsyncResult.defect((value.error as { readonly defect: string }).defect);
    return value.waiting && value.previousSuccess !== null
      ? AsyncResult.refreshing(AsyncResult.success(value.previousSuccess.value))
      : defect;
  }
  return value.waiting && value.previousSuccess !== null
    ? AsyncResult.refreshing(AsyncResult.success(value.previousSuccess.value))
    : AsyncResult.failure(value.error as E);
}

/**
 * Extract the success value as an `Option`.
 *
 * @returns `Some(value)` if Success, `None` otherwise.
 */
export function value<A, E>(self: Result<A, E>): Option.Option<A> {
  return self._tag === "Success" ? Option.some(self.value) : Option.none();
}

/**
 * Get the success value, or compute a fallback if not successful.
 *
 * @example
 * const name = Result.getOrElse(userResult, () => "anonymous")
 */
export function getOrElse<A, E>(
  self: Result<A, E>,
  orElse: () => A,
): A {
  return self._tag === "Success" ? self.value : orElse();
}

/**
 * Get the success value or throw the error/defect.
 *
 * @throws The error value on Failure, or an Error on Initial.
 */
export function getOrThrow<A, E>(self: Result<A, E>): A {
  if (self._tag === "Success") return self.value;
  if (self._tag === "Failure") {
    if (typeof self.error === "object" && self.error !== null && "defect" in self.error) {
      throw new Error((self.error as { readonly defect: string }).defect);
    }
    throw self.error;
  }
  throw new Error("Result is Initial");
}

/**
 * Transform the success value of a Result.
 *
 * Preserves waiting state, timestamp, and previousSuccess through the mapping.
 *
 * @example
 * const nameResult = Result.map(userResult, (u) => u.name)
 */
export function map<A, E, B>(self: Result<A, E>, f: (a: A) => B): Result<B, E> {
  if (self._tag === "Success") return success(f(self.value), { waiting: self.waiting, timestamp: self.timestamp });
  if (self._tag === "Failure") {
    return failure<B, E>(self.error as E | { readonly defect: string }, {
      waiting: self.waiting,
      previousSuccess: self.previousSuccess ? success(f(self.previousSuccess.value)) : null,
    });
  }
  return initial(self.waiting);
}

/**
 * Chain a Result into another Result-producing function.
 *
 * @example
 * const profile = Result.flatMap(userResult, (u) => fetchProfile(u.id))
 */
export function flatMap<A, E, B, E2>(
  self: Result<A, E>,
  f: (a: A) => Result<B, E2>,
): Result<B, E | E2> {
  if (self._tag === "Success") return f(self.value);
  if (self._tag === "Failure") return failure(self.error as E | E2 | { readonly defect: string }, {
    waiting: self.waiting,
    previousSuccess: null,
  });
  return initial(self.waiting);
}

/**
 * Exhaustive pattern match over all three Result states.
 *
 * @example
 * const label = Result.match(userResult, {
 *   onInitial: () => "loading...",
 *   onSuccess: (u) => u.name,
 *   onFailure: (e) => `error: ${e}`,
 * })
 */
export function match<A, E, R>(
  self: Result<A, E>,
  handlers: {
    onInitial: () => R;
    onSuccess: (a: A) => R;
    onFailure: (e: E | { readonly defect: string }) => R;
  },
): R {
  if (self._tag === "Initial") return handlers.onInitial();
  if (self._tag === "Success") return handlers.onSuccess(self.value);
  return handlers.onFailure(self.error);
}

/**
 * Fluent builder API for rendering / matching `Result` values.
 *
 * @example
 * const view = Result.builder(result)
 *   .onInitial(() => "loading")
 *   .onFailure((e) => `error: ${String(e)}`)
 *   .onSuccess((value, { waiting }) => waiting ? `${value}...` : `${value}`)
 *   .render()
 */
export function builder<A, E, R = never>(self: Result<A, E>): Builder<A, E, R> {
  const handlers: BuilderHandlers<A, E, R> = {};

  const api: Builder<A, E, R> = {
    onInitial: (f) => {
      (handlers as BuilderHandlers<A, E, R | ReturnType<typeof f>>).onInitial = f;
      return api as unknown as Builder<A, E, R | ReturnType<typeof f>>;
    },
    onSuccess: (f) => {
      (handlers as BuilderHandlers<A, E, R | ReturnType<typeof f>>).onSuccess = f;
      return api as unknown as Builder<A, E, R | ReturnType<typeof f>>;
    },
    onFailure: (f) => {
      (handlers as BuilderHandlers<A, E, R | ReturnType<typeof f>>).onFailure = f;
      return api as unknown as Builder<A, E, R | ReturnType<typeof f>>;
    },
    render: () => {
      if (self._tag === "Initial") {
        return handlers.onInitial?.();
      }
      if (self._tag === "Success") {
        return handlers.onSuccess?.(self.value, {
          waiting: self.waiting,
          timestamp: self.timestamp,
        });
      }
      return handlers.onFailure?.(self.error, {
        waiting: self.waiting,
        previousSuccess: self.previousSuccess,
      });
    },
  };

  return api;
}

/**
 * Combine multiple Results into a single Result of a tuple.
 *
 * Short-circuits on the first Initial or Failure encountered.
 *
 * @example
 * const combined = Result.all([userResult, prefsResult])
 * // Result<[User, Prefs], UserError | PrefsError>
 */
export function all<A extends ReadonlyArray<Result<any, any>>>(
  results: A,
): Result<{ [K in keyof A]: A[K] extends Result<infer X, any> ? X : never }, A[number] extends Result<any, infer XE> ? XE : never> {
  const values: unknown[] = [];
  for (const r of results) {
    if (r._tag === "Initial") return initial(r.waiting) as any;
    if (r._tag === "Failure") return failure(r.error, { waiting: r.waiting }) as any;
    values.push(r.value);
  }
  return success(values as any);
}

/** Convert a Defect to a structured failure payload. */
export function fromDefect<A>(defect: Defect): Failure<A, { readonly defect: string }> {
  return failure({ defect: defect.cause });
}
