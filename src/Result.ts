import { AsyncResult, type Defect } from "./effect-ts.js";

export type Initial<A, E = never> = {
  readonly _tag: "Initial";
  readonly waiting: boolean;
};

export type Success<A, E = never> = {
  readonly _tag: "Success";
  readonly value: A;
  readonly waiting: boolean;
  readonly timestamp: number;
};

export type Failure<A, E = never> = {
  readonly _tag: "Failure";
  readonly error: E | { readonly defect: string };
  readonly waiting: boolean;
  readonly previousSuccess: Success<A, E> | null;
};

export type Result<A, E = never> = Initial<A, E> | Success<A, E> | Failure<A, E>;

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
  return failure({ defect: value.cause });
}

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

/** Convert a Defect to a structured failure payload. */
export function fromDefect<A>(defect: Defect): Failure<A, { readonly defect: string }> {
  return failure({ defect: defect.cause });
}
