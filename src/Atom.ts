import { Effect, Stream as FxStream, Queue, Fiber, Layer, ManagedRuntime, Cause, Option, Schedule } from "effect";
import {
  createSignal,
  flush as flushBatch,
  type Accessor,
  createEffect,
  onCleanup,
} from "./api.js";
import { Owner, runWithOwner } from "./owner.js";
import {
  atomEffect,
  defineQuery,
  defineMutation,
  createOptimistic,
  type Result,
  type Refreshing,
  type Success,
  type Failure,
  type Defect,
  type RuntimeLike,
  type BridgeError,
  type ResultDefectError,
  type MutationSupersededError,
  type OptimisticRef,
} from "./effect-ts.js";
import * as FetchResult from "./Result.js";
import {
  flushReactivityRuntime,
  invalidateReactivityRuntime,
  normalizeReactivityKeys,
  trackReactivityRuntime,
  type ReactivityKeysInput as RuntimeReactivityKeysInput,
} from "./reactivity-runtime.js";
import { getInstalledSingleFlightTransport } from "./single-flight-runtime.js";
import { SingleFlightTransportTag, type SingleFlightTransportService } from "./SingleFlightTransport.js";

const TypeId = "~effect-atom-jsx/Atom" as const;
const WritableTypeId = "~effect-atom-jsx/Atom/Writable" as const;

type RefreshRef = {
  readonly get: Accessor<number>;
  readonly bump: () => void;
};

type WidenLiteral<T> =
  T extends string ? string :
  T extends number ? number :
  T extends boolean ? boolean :
  T extends bigint ? bigint :
  T extends symbol ? symbol :
  T;

type DeepWiden<T> =
  T extends ReadonlyArray<infer U> ? Array<DeepWiden<U>> :
  T extends Array<infer U> ? Array<DeepWiden<U>> :
  T extends object ? { [K in keyof T]: DeepWiden<T[K]> } :
  WidenLiteral<T>;

const refreshMap = new WeakMap<Atom<any>, RefreshRef>();
const selfWriteMap = new WeakMap<Writable<any, any>, (value: any) => void>();

function ensureRefresh<A>(atom: Atom<A>): RefreshRef {
  const existing = refreshMap.get(atom);
  if (existing) return existing;
  const [get, set] = createSignal(0);
  const next = { get, bump: () => set((n) => n + 1) };
  refreshMap.set(atom, next);
  return next;
}

export interface Atom<A> {
  (): A;
  pipe(): Atom<A>;
  pipe<B>(ab: (self: this) => B): B;
  pipe<B, C>(ab: (self: this) => B, bc: (b: B) => C): C;
  pipe<B, C, D>(ab: (self: this) => B, bc: (b: B) => C, cd: (c: C) => D): D;
  pipe<B, C, D, E>(ab: (self: this) => B, bc: (b: B) => C, cd: (c: C) => D, de: (d: D) => E): E;
  /** Read this atom as a composable Effect value. */
  effect(): Effect.Effect<A>;
  readonly [TypeId]: typeof TypeId;
  readonly read: (get: Context) => A;
  readonly refresh?: (f: <A>(atom: Atom<A>) => void) => void;
}

export interface Writable<R, W = R> extends Atom<R> {
  readonly [WritableTypeId]: typeof WritableTypeId;
  readonly write: (ctx: WriteContext<R>, value: W) => void;
  set(value: W): void;
  update(f: (value: R) => W): void;
  modify<A>(f: (value: R) => [A, W]): A;
  /** Effect alias of set for pipeline composition. */
  setEffect(value: W): Effect.Effect<void>;
  /** Effect alias of update for pipeline composition. */
  updateEffect(f: (value: R) => W): Effect.Effect<void>;
  /** Effect alias of modify for pipeline composition. */
  modifyEffect<A>(f: (value: R) => [A, W]): Effect.Effect<A>;
}

/** Alias for read-only atoms in documentation and type signatures. */
export type ReadonlyAtom<A> = Atom<A>;
/** Alias for writable atoms in documentation and type signatures. */
export type WritableAtom<A, W = A> = Writable<A, W>;
/** Async atom shape carrying typed `Result<A, E>` states. */
export type AsyncAtom<A, E> = Atom<Result<A, E>>;

/** Read context passed to atom `read` functions. Callable as a shorthand for `get`. */
export interface Context {
  /** Read an atom's current value (shorthand call signature). */
  <A>(atom: Atom<A>): A;
  /** Read an atom's current value, tracking it as a dependency. */
  get<A>(atom: Atom<A>): A;
  /** Force-refresh an atom and invalidate its dependents. */
  refresh<A>(atom: Atom<A>): void;
  /** Write a value to a writable atom. */
  set<R, W>(atom: Writable<R, W>, value: W): void;
  /** Read an async/result atom as an Effect value. */
  result<A, E>(atom: Atom<Result<A, E> | FetchResult.Result<A, E>>): Effect.Effect<A, E | BridgeError>;
  /** Register cleanup for the current owner scope. */
  addFinalizer(finalizer: () => void): void;
}

/** Write context passed to atom `write` functions. */
export interface WriteContext<A> {
  /** Read an atom's current value. */
  get<T>(atom: Atom<T>): T;
  /** Write a value to another writable atom. */
  set<R, W>(atom: Writable<R, W>, value: W): void;
  /** Force-refresh the current atom, re-running its read function. */
  refreshSelf(): void;
  /** Directly set the current atom's underlying signal value. */
  setSelf(value: A): void;
  /** Read an async/result atom as an Effect value. */
  result<T, E>(atom: Atom<Result<T, E> | FetchResult.Result<T, E>>): Effect.Effect<T, E | BridgeError>;
  /** Register cleanup for the current owner scope. */
  addFinalizer(finalizer: () => void): void;
}

function toEffectResult<A, E>(
  value: Result<A, E> | FetchResult.Result<A, E>,
): Effect.Effect<A, E | BridgeError> {
  const tagged = value as { readonly _tag?: string };
  switch (tagged._tag) {
    case "Loading":
      return Effect.fail({ _tag: "ResultLoadingError", message: "Atom is Loading" } as const);
    case "Refreshing": {
      const previous = (value as Refreshing<A, E>).previous;
      return toEffectResult(previous as Result<A, E> | FetchResult.Result<A, E>);
    }
    case "Success":
      return Effect.succeed((value as Success<A>).value);
    case "Failure": {
      const failure = value as Failure<E>;
      if ("error" in failure) {
        return Effect.fail(failure.error);
      }
      return Effect.fail((value as FetchResult.Failure<A, E>).error as E | BridgeError);
    }
    case "Defect":
      return Effect.fail({ _tag: "ResultDefectError", defect: (value as Defect).cause } as const);
    case "Initial":
      return Effect.fail({ _tag: "ResultLoadingError", message: "Result is Initial" } as const);
    default:
      return Effect.fail({ _tag: "ResultDefectError", defect: "Unsupported atom result value" } as const);
  }
}

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

function deepCloneProjectionValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepCloneProjectionValue(item)) as unknown as T;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepCloneProjectionValue(v);
    }
    return out as T;
  }
  return value;
}

function shallowEqualRecord(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

function reconcileProjectionValue<T>(
  previous: T,
  next: T,
  key: string,
): T {
  if (Array.isArray(previous) && Array.isArray(next)) {
    const prevByKey = new Map<unknown, unknown>();
    for (const item of previous) {
      if (isRecord(item) && key in item) {
        prevByKey.set(item[key], item);
      }
    }

    const out = next.map((item) => {
      if (!isRecord(item) || !(key in item)) return item;
      const prevItem = prevByKey.get(item[key]);
      if (!isRecord(prevItem)) return item;
      if (shallowEqualRecord(prevItem, item)) return prevItem;

      const merged: Record<string, unknown> = { ...item };
      for (const field of Object.keys(merged)) {
        if (Object.is(prevItem[field], merged[field])) {
          merged[field] = prevItem[field];
        }
      }
      return merged;
    });

    return out as unknown as T;
  }

  if (isRecord(previous) && isRecord(next)) {
    const merged: Record<string, unknown> = { ...next };
    for (const field of Object.keys(merged)) {
      if (Object.is(previous[field], merged[field])) {
        merged[field] = previous[field];
      }
    }
    return merged as T;
  }

  return next;
}

/**
 * Type guard for unknown values.
 *
 * Useful at boundaries where atoms are passed dynamically (plugins, devtools,
 * generic helpers) and you need to narrow before calling `Atom.get`.
 */
export const isAtom = (u: unknown): u is Atom<any> =>
  (typeof u === "object" || typeof u === "function") && u !== null && TypeId in u;

/**
 * Type guard that narrows a read-only `Atom` to `Writable`.
 *
 * @example
 * if (Atom.isWritable(atom)) {
 *   Effect.runSync(Atom.set(atom, nextValue))
 * }
 */
export const isWritable = <R, W>(atom: Atom<R>): atom is Writable<R, W> =>
  (typeof atom === "object" || typeof atom === "function") && atom !== null && WritableTypeId in atom;

function pipeSelf<T>(self: T, fns: ReadonlyArray<(value: unknown) => unknown>): unknown {
  return fns.reduce<unknown>((acc, fn) => fn(acc), self as unknown);
}

function toCallableAtom<A>(base: {
  readonly [TypeId]: typeof TypeId;
  readonly read: (get: Context) => A;
  readonly refresh?: (f: <A>(atom: Atom<A>) => void) => void;
}): Atom<A> {
  const self = (() => defaultContext.get(self as Atom<A>)) as Atom<A>;
  const out = Object.assign(self, base);
  out.pipe = ((...fns: ReadonlyArray<(value: unknown) => unknown>) => pipeSelf(out, fns)) as Atom<A>["pipe"];
  out.effect = () => Effect.sync(() => defaultContext.get(out));
  return out;
}

function toCallableWritable<R, W = R>(base: {
  readonly [TypeId]: typeof TypeId;
  readonly [WritableTypeId]: typeof WritableTypeId;
  readonly read: (get: Context) => R;
  readonly write: (ctx: WriteContext<R>, value: W) => void;
  readonly refresh?: (f: <A>(atom: Atom<A>) => void) => void;
}): Writable<R, W> {
  const self = (() => defaultContext.get(self as Writable<R, W>)) as Writable<R, W>;
  const out = Object.assign(self, base);
  out.pipe = ((...fns: ReadonlyArray<(value: unknown) => unknown>) => pipeSelf(out, fns)) as Writable<R, W>["pipe"];
  out.effect = () => Effect.sync(() => defaultContext.get(out));
  out.set = (value: W) => {
    defaultContext.set(out, value);
  };
  out.update = (f: (value: R) => W) => {
    defaultContext.set(out, f(defaultContext.get(out)));
  };
  out.modify = <A>(f: (value: R) => [A, W]): A => {
    const [ret, next] = f(defaultContext.get(out));
    defaultContext.set(out, next);
    return ret;
  };
  out.setEffect = (value: W) => Effect.sync(() => defaultContext.set(out, value));
  out.updateEffect = (f: (value: R) => W) => Effect.sync(() => {
    defaultContext.set(out, f(defaultContext.get(out)));
  });
  out.modifyEffect = <A>(f: (value: R) => [A, W]) => Effect.sync(() => {
    const [ret, next] = f(defaultContext.get(out));
    defaultContext.set(out, next);
    return ret;
  });
  return out;
}

/**
 * Low-level constructor for a read-only atom.
 *
 * @param read    - Function that computes the atom's value given a read context.
 * @param refresh - Optional callback invoked when the atom is force-refreshed.
 */
export const readable = <A>(
  read: (get: Context) => A,
  refresh?: (f: <A>(atom: Atom<A>) => void) => void,
): Atom<A> => toCallableAtom({
    [TypeId]: TypeId,
    read,
    refresh,
  });

/**
 * Low-level constructor for a writable atom with custom read and write logic.
 *
 * @param read    - Function that computes the atom's value given a read context.
 * @param write   - Function that handles writes, receiving a write context and the new value.
 * @param refresh - Optional callback invoked when the atom is force-refreshed.
 */
export const writable = <R, W = R>(
  read: (get: Context) => R,
  write: (ctx: WriteContext<R>, value: W) => void,
  refresh?: (f: <A>(atom: Atom<A>) => void) => void,
): Writable<R, W> =>
  toCallableWritable({
    [TypeId]: TypeId,
    [WritableTypeId]: WritableTypeId,
    read,
    write,
    refresh,
  });

function evaluate<A>(atom: Atom<A>, ctx: Context): A {
  ensureRefresh(atom).get();
  return atom.read(ctx);
}

const defaultContext: Context = Object.assign(
  ((atom: Atom<any>) => evaluate(atom, defaultContext)) as Context,
  {
    get<A>(atom: Atom<A>): A {
      return evaluate(atom, defaultContext);
    },
    refresh<A>(atom: Atom<A>): void {
      const ref = ensureRefresh(atom);
      ref.bump();
      atom.refresh?.((a) => defaultContext.refresh(a));
    },
    set<R, W>(atom: Writable<R, W>, value: W): void {
      atom.write(makeWriteContext(atom), value);
    },
    result<A, E>(atom: Atom<Result<A, E> | FetchResult.Result<A, E>>) {
      return toEffectResult(defaultContext.get(atom));
    },
    addFinalizer(finalizer: () => void): void {
      onCleanup(finalizer);
    },
  },
);

function makeWriteContext<A>(self: Writable<A, any>): WriteContext<A> {
  return {
    get: (atom) => defaultContext.get(atom),
    set: (atom, value) => defaultContext.set(atom, value),
    refreshSelf: () => defaultContext.refresh(self),
    setSelf: (value) => {
      const direct = selfWriteMap.get(self);
      if (direct) {
        direct(value);
        return;
      }
      self.write(makeWriteContext(self), value);
    },
    result: (atom) => defaultContext.result(atom),
    addFinalizer: (finalizer) => defaultContext.addFinalizer(finalizer),
  };
}

type WritableValue<T> = T extends (...args: Array<any>) => any ? T : DeepWiden<T>;

function makeWritableValue<A>(initial: A): Writable<A> {
  const [getValue, setValue] = createSignal(initial);
  const atom = writable(
    () => getValue(),
    (_ctx, value) => setValue(() => value),
  );
  selfWriteMap.set(atom, (value: A) => setValue(() => value));
  return atom;
}

/**
 * Explicit constructor for writable atoms, including function values.
 *
 * Use this when you want to store a function as atom data:
 * `const fn = Atom.value((x: number) => x + 1)`.
 */
export function value<A>(initial: A): Writable<WritableValue<A>> {
  return makeWritableValue(initial as WritableValue<A>);
}

/**
 * Explicit constructor for derived read-only atoms.
 */
export function derived<A>(read: (get: Context) => A): Atom<A> {
  return readable(read);
}

export function make<A>(read: (get: Context) => A): Atom<A>;
export function make<const A>(
  initial: A & (A extends (...args: Array<any>) => any ? never : unknown),
): Writable<DeepWiden<A>>;
/**
 * Create an atom.
 *
 * Overloads:
 * - `make(value)` -> writable atom
 * - `make((get) => ...)` -> derived read-only atom
 *
 * Explicit variants:
 * - `value(value)` -> writable atom (including function values)
 * - `derived((get) => ...)` -> derived read-only atom
 *
 * Derived atoms track reads performed through `get(...)` and recompute when
 * dependencies change.
 *
 * Note: function values cannot be used as plain initial values with `make`.
 * Use `Atom.value(fn)` for function-valued atoms.
 *
 * @example
 * const count = Atom.make(1)
 * const doubled = Atom.make((get) => get(count) * 2)
 * const callback = Atom.value((n: number) => n + 1)
 */
export function make<A>(valueOrRead: A | ((get: Context) => A)): Atom<A> | Writable<DeepWiden<A>> {
  if (typeof valueOrRead === "function") {
    return derived(valueOrRead as (get: Context) => A);
  }
  return makeWritableValue(valueOrRead as DeepWiden<A>);
}

/**
 * Create memoized atom families keyed by argument identity.
 *
 * Useful for per-id state (todos, route params, entity caches).
 * Calling the family with the same argument returns the same atom instance.
 *
 * @example
 * const todoById = Atom.family((id: string) => Atom.make({ id, done: false }))
 */
export interface Family<Args extends ReadonlyArray<unknown>, T> {
  (...args: Args): T;
  evict(...args: Args): void;
  clear(): void;
}

export interface FamilyOptions<Args extends ReadonlyArray<unknown>, T> {
  /**
   * Custom argument-tuple equality. When provided, family cache lookup uses
   * this function instead of reference-equality trie lookup.
   */
  readonly equals?: (a: Args, b: Args) => boolean;
}

type FamilyNode<T> = {
  readonly children: Map<unknown, FamilyNode<T>>;
  hasValue: boolean;
  value: T | undefined;
};

const familyNode = <T>(): FamilyNode<T> => ({
  children: new Map(),
  hasValue: false,
  value: undefined,
});

const familyPath = <T>(root: FamilyNode<T>, args: ReadonlyArray<unknown>, create: boolean): FamilyNode<T> | null => {
  let node = root;
  for (const arg of args) {
    const next = node.children.get(arg);
    if (next) {
      node = next;
      continue;
    }
    if (!create) return null;
    const created = familyNode<T>();
    node.children.set(arg, created);
    node = created;
  }
  return node;
};

export function family<Args extends ReadonlyArray<unknown>, T>(
  f: (...args: Args) => T,
  options?: FamilyOptions<Args, T>,
): Family<Args, T> {
  if (options?.equals !== undefined) {
    const entries: Array<{ args: Args; value: T }> = [];
    const getOrCreate = ((...args: Args) => {
      const found = entries.find((entry) => options.equals!(entry.args, args));
      if (found) return found.value;
      const next = f(...args);
      entries.push({ args, value: next });
      return next;
    }) as Family<Args, T>;

    getOrCreate.evict = (...args: Args) => {
      const index = entries.findIndex((entry) => options.equals!(entry.args, args));
      if (index >= 0) entries.splice(index, 1);
    };
    getOrCreate.clear = () => {
      entries.length = 0;
    };

    return getOrCreate;
  }

  const root = familyNode<T>();
  const getOrCreate = ((...args: Args) => {
    const node = familyPath(root, args, true) as FamilyNode<T>;
    if (node.hasValue) return node.value as T;
    const next = f(...args);
    node.hasValue = true;
    node.value = next;
    return next;
  }) as Family<Args, T>;

  getOrCreate.evict = (...args: Args) => {
    const node = familyPath(root, args, false);
    if (node === null) return;
    node.hasValue = false;
    node.value = undefined;
    node.children.clear();
  };
  getOrCreate.clear = () => {
    root.children.clear();
    root.hasValue = false;
    root.value = undefined;
  };

  return getOrCreate;
}

/**
 * Compatibility helper with `@effect-atom/atom`.
 *
 * In this package atoms are already retained by the owning reactive graph, so
 * this is currently an identity function.
 */
export const keepAlive = <A>(self: Atom<A>): Atom<A> => self;

/** Pipeable wrapper that creates an optimistic overlay for any callable atom. */
export interface OptimisticAtom<A> extends Atom<A>, OptimisticRef<A> {
  setOptimistic(value: A | ((prev: A) => A)): void;
  clearOptimistic(): void;
  isOptimisticPending(): boolean;
  withEffect<B, E, R>(
    value: A | ((prev: A) => A),
    effect: Effect.Effect<B, E, R>,
  ): Effect.Effect<B, E, R>;
}

export function withOptimistic<A>(): (self: Atom<A>) => OptimisticAtom<A>;
export function withOptimistic<A>(self: Atom<A>): OptimisticAtom<A>;
export function withOptimistic<A>(self?: Atom<A>): OptimisticAtom<A> | ((self: Atom<A>) => OptimisticAtom<A>) {
  if (self === undefined) {
    return (nextSelf: Atom<A>) => withOptimistic(nextSelf);
  }
  const optimistic = createOptimistic(self);
  const wrapped = ((() => optimistic()) as unknown) as OptimisticAtom<A>;
  (wrapped as any)[TypeId] = TypeId;
  (wrapped as any).read = () => optimistic();
  wrapped.pipe = ((...fns: ReadonlyArray<(value: unknown) => unknown>) => pipeSelf(wrapped, fns)) as OptimisticAtom<A>["pipe"];
  wrapped.get = optimistic.get;
  wrapped.set = optimistic.set;
  wrapped.clear = optimistic.clear;
  wrapped.isPending = optimistic.isPending;
  wrapped.setOptimistic = optimistic.set;
  wrapped.clearOptimistic = optimistic.clear;
  wrapped.isOptimisticPending = optimistic.isPending;
  wrapped.withEffect = <B, E, R>(value: A | ((prev: A) => A), effect: Effect.Effect<B, E, R>) => {
    wrapped.setOptimistic(value);
    return effect.pipe(
      Effect.tap(() => Effect.sync(() => wrapped.clearOptimistic())),
      Effect.tapError(() => Effect.sync(() => wrapped.clearOptimistic())),
      Effect.tapDefect(() => Effect.sync(() => wrapped.clearOptimistic())),
    );
  };
  return wrapped;
}

/**
 * Pipeable retry policy for async result atoms.
 *
 * On typed `Failure`, schedules refreshes according to the provided schedule.
 */
export function withRetry<A, E>(schedule: Schedule.Schedule<unknown, any, any>): (self: AsyncAtom<A, E>) => AsyncAtom<A, E>;
export function withRetry<A, E>(self: AsyncAtom<A, E>, schedule: Schedule.Schedule<unknown, any, any>): AsyncAtom<A, E>;
export function withRetry<A, E>(
  arg1: AsyncAtom<A, E> | Schedule.Schedule<unknown, any, any>,
  arg2?: Schedule.Schedule<unknown, any, any>,
): AsyncAtom<A, E> | ((self: AsyncAtom<A, E>) => AsyncAtom<A, E>) {
  if (arg2 === undefined) {
    const schedule = arg1 as Schedule.Schedule<unknown, any, any>;
    return (self) => withRetry(self, schedule);
  }

  const self = arg1 as AsyncAtom<A, E>;
  const schedule = arg2;
  let retryFiber: Fiber.Fiber<void, never> | null = null;
  let retryFailure: unknown = undefined;

  const stop = (): void => {
    if (retryFiber !== null) {
      Effect.runFork(Fiber.interrupt(retryFiber));
      retryFiber = null;
      retryFailure = undefined;
    }
  };

  return readable((get) => {
    const result = get(self);
    if (result._tag === "Failure") {
      if (retryFiber === null || !Object.is(retryFailure, result.error)) {
        stop();
        retryFailure = result.error;
        retryFiber = Effect.runFork(
          FxStream.runForEach(
            FxStream.fromSchedule(schedule),
            () => Effect.sync(() => defaultContext.refresh(self)),
          ).pipe(Effect.catchCause(() => Effect.void)),
        );
      }
    } else {
      stop();
    }

    onCleanup(stop);
    return result;
  });
}

/**
 * Pipeable polling policy for async result atoms.
 *
 * Refreshes the atom whenever the schedule emits.
 */
export function withPolling<A, E>(schedule: Schedule.Schedule<unknown, any, any>): (self: AsyncAtom<A, E>) => AsyncAtom<A, E>;
export function withPolling<A, E>(self: AsyncAtom<A, E>, schedule: Schedule.Schedule<unknown, any, any>): AsyncAtom<A, E>;
export function withPolling<A, E>(
  arg1: AsyncAtom<A, E> | Schedule.Schedule<unknown, any, any>,
  arg2?: Schedule.Schedule<unknown, any, any>,
): AsyncAtom<A, E> | ((self: AsyncAtom<A, E>) => AsyncAtom<A, E>) {
  if (arg2 === undefined) {
    const schedule = arg1 as Schedule.Schedule<unknown, any, any>;
    return (self) => withPolling(self, schedule);
  }

  const self = arg1 as AsyncAtom<A, E>;
  const schedule = arg2;
  let pollFiber: Fiber.Fiber<void, never> | null = null;

  const ensure = (): void => {
    if (pollFiber !== null) return;
    pollFiber = Effect.runFork(
      FxStream.runForEach(
        FxStream.fromSchedule(schedule),
        () => Effect.sync(() => defaultContext.refresh(self)),
      ).pipe(Effect.catchCause(() => Effect.void)),
    );
  };

  const stop = (): void => {
    if (pollFiber !== null) {
      Effect.runFork(Fiber.interrupt(pollFiber));
      pollFiber = null;
    }
  };

  return readable((get) => {
    ensure();
    onCleanup(stop);
    return get(self);
  });
}

/**
 * Pipeable stale-time policy for async result atoms.
 *
 * Once data is settled, schedules a one-shot refresh after `duration`.
 */
export function withStaleTime<A, E>(duration: string | number): (self: AsyncAtom<A, E>) => AsyncAtom<A, E>;
export function withStaleTime<A, E>(self: AsyncAtom<A, E>, duration: string | number): AsyncAtom<A, E>;
export function withStaleTime<A, E>(
  arg1: AsyncAtom<A, E> | string | number,
  arg2?: string | number,
): AsyncAtom<A, E> | ((self: AsyncAtom<A, E>) => AsyncAtom<A, E>) {
  if (arg2 === undefined) {
    const duration = arg1 as string | number;
    return (self) => withStaleTime(self, duration);
  }

  const self = arg1 as AsyncAtom<A, E>;
  const duration = arg2;
  let staleFiber: Fiber.Fiber<unknown, never> | null = null;

  const stop = (): void => {
    if (staleFiber !== null) {
      Effect.runFork(Fiber.interrupt(staleFiber));
      staleFiber = null;
    }
  };

  return readable((get) => {
    const result = get(self);
    stop();
    if (result._tag === "Success" || result._tag === "Failure" || result._tag === "Defect") {
      const sleepFor = (typeof duration === "number"
        ? `${duration} millis`
        : duration) as any;
      staleFiber = Effect.runFork(
        Effect.sleep(sleepFor).pipe(
          Effect.flatMap(() => Effect.sync(() => defaultContext.refresh(self))),
          Effect.catchCause(() => Effect.void),
        ),
      );
    }
    onCleanup(stop);
    return result;
  });
}

export interface ActionHandle<Input, E, A = void> {
  (input: Input): void;
  run: (input: Input) => void;
  /** Run as a composable Effect that preserves the action success value. */
  runEffect: (input: Input) => Effect.Effect<A, E | BridgeError | MutationSupersededError>;
  effect: (input: Input) => Effect.Effect<void, E | BridgeError | MutationSupersededError>;
  result: Accessor<Result<void, E>>;
  pending: Accessor<boolean>;
}

/**
 * Client transport options for single-flight mutations.
 *
 * Attach this to `Atom.action(...)` or `runtime.action(...)` to reuse the
 * existing mutation handle API while delegating execution to a single-flight
 * endpoint that returns mutation data plus route-loader payloads.
 */
export interface SingleFlightClientOptions<Input> {
  /** `auto` uses transport when available, `force` errors if unavailable, `off` disables single-flight for this action. */
  readonly mode?: "auto" | "force" | "off";
  /** Optional endpoint override for the built-in fetch fallback / fetch transport adapter. */
  readonly endpoint?: string;
  /** Resolve the route URL whose matched loaders should participate in the request. */
  readonly url?: string | ((input: Input) => string);
  /** Disable automatic loader cache hydration for returned payloads. */
  readonly hydrate?: boolean;
  /** Optional fetch override for the built-in fetch fallback / fetch transport adapter. */
  readonly fetch?: (input: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string }) => Promise<{ readonly json: () => Promise<unknown> }>;
}

export interface AtomRuntime<R, E = unknown> {
  readonly managed: ManagedRuntime.ManagedRuntime<R, E>;
  atom<A, E2, RReq extends R = R>(effect: Effect.Effect<A, E2, RReq>): AsyncAtom<A, E2>;
  atom<A, E2, RReq extends R = R>(factory: (get: Context) => Effect.Effect<A, E2, RReq>): AsyncAtom<A, E2>;
  action<A, E2, RReq extends R = R, Input = void>(
    effect: (input: Input) => Effect.Effect<A, E2, RReq>,
    options?: {
      readonly name?: string;
      readonly reactivityKeys?: ReactivityKeysInput;
      readonly singleFlight?: false | SingleFlightClientOptions<Input>;
      readonly onError?: (error: E2) => void;
      readonly onSuccess?: (input: Input) => void;
      readonly onTransition?: (event: { readonly phase: "start" | "success" | "failure" | "defect" }) => void;
    },
    ): ActionHandle<Input, E2, A>;
  dispose(): Promise<void>;
}

function runPromiseWithRuntime<R, A, E>(
  runtime: RuntimeLike<R, unknown> | undefined,
  effect: Effect.Effect<A, E, R>,
): Promise<A> {
  if (ManagedRuntime.isManagedRuntime(runtime)) {
    return runtime.runPromise(effect);
  }
  if (runtime !== undefined) {
    return Effect.runPromiseWith(runtime as any)(effect);
  }
  return Effect.runPromise(effect as Effect.Effect<A, E, never>);
}

/** Resolve the URL whose route loaders should participate in the request. */
function resolveSingleFlightUrl<Input>(input: Input, url: SingleFlightClientOptions<Input>["url"]): string {
  if (typeof url === "function") {
    return url(input);
  }
  if (typeof url === "string") {
    return url;
  }
  if (typeof window !== "undefined") {
    return window.location.pathname + window.location.search + window.location.hash;
  }
  return "/";
}

/**
 * Run a client-side single-flight request through a transport and return only
 * the mutation value. Loader payload hydration is applied automatically.
 */
function runSingleFlightWithTransport<Input, A>(
  transport: { readonly execute: (request: { readonly name?: string; readonly args: [Input]; readonly url: string }, options?: { readonly endpoint?: string; readonly fetch?: (input: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string }) => Promise<{ readonly json: () => Promise<unknown> }> }) => Effect.Effect<any, { readonly _tag: string; readonly message: string; readonly cause?: unknown }> },
  input: Input,
  options: false | SingleFlightClientOptions<Input> | undefined,
  mutationName?: string,
): Effect.Effect<A, ResultDefectError, any> {
  return Effect.gen(function* () {
    const config = options === false ? undefined : options;
    const Route = yield* Effect.promise(() => import("./Route.js"));
    const response = yield* transport.execute(
      {
        name: mutationName,
        args: [input],
        url: resolveSingleFlightUrl(input, config?.url),
      },
      {
        endpoint: config?.endpoint,
        fetch: config?.fetch,
      },
    ).pipe(Effect.mapError((error) => ({
      _tag: "ResultDefectError",
      defect: error.message,
    } as const)));

    if (!response.ok) {
      return yield* Effect.fail({
        _tag: "ResultDefectError",
        defect: typeof response.error === "object" ? JSON.stringify(response.error) : String(response.error),
      } as const);
    }
    if (config?.hydrate !== false) {
      yield* Route.hydrateSingleFlightPayload(response.payload as import("./Route.js").SingleFlightPayload<unknown>);
    }
    return response.payload.mutation;
  });
}

function shouldUseSingleFlight<Input>(options: false | SingleFlightClientOptions<Input> | undefined): boolean {
  if (options === false) return false;
  return options === undefined || options.mode !== "off";
}

/**
 * Built-in fetch fallback used when no transport service is installed but a
 * mutation opts into fetch-backed single-flight explicitly.
 */
function runSingleFlightWithDirectFetch<Input, A>(
  input: Input,
  options: SingleFlightClientOptions<Input>,
  mutationName?: string,
): Effect.Effect<A, ResultDefectError> {
  return Effect.tryPromise({
    try: async () => {
      const Route = await import("./Route.js");
      const payload = await Effect.runPromise(Route.invokeSingleFlight<[Input], A>(
        options.endpoint ?? mutationName ?? "",
        {
          name: mutationName,
          args: [input],
          url: resolveSingleFlightUrl(input, options.url),
        },
        {
          fetch: options.fetch,
          hydrate: options.hydrate,
        },
      ));
      return payload.mutation;
    },
    catch: (error) => ({
      _tag: "ResultDefectError",
      defect: error instanceof Error ? error.message : String(error),
    } as const),
  });
}

let globalRuntimeLayers: ReadonlyArray<Layer.Layer<any, any, never>> = [];

function buildLayerWithGlobals<R, E>(layer: Layer.Layer<R, E, never>): Layer.Layer<any, any, never> {
  if (globalRuntimeLayers.length === 0) {
    return layer as unknown as Layer.Layer<any, any, never>;
  }
  return Layer.mergeAll(
    layer as unknown as Layer.Layer<any, any, never>,
    ...globalRuntimeLayers,
  );
}

const runtimeImpl = <R, E>(layer: Layer.Layer<R, E, never>): AtomRuntime<R, E> => {
  const managed = ManagedRuntime.make(buildLayerWithGlobals(layer)) as ManagedRuntime.ManagedRuntime<R, E>;
  return {
    managed,
    atom<A, E2, RReq extends R = R>(
      input: Effect.Effect<A, E2, RReq> | ((get: Context) => Effect.Effect<A, E2, RReq>),
    ): AsyncAtom<A, E2> {
      const run = (): Effect.Effect<A, E2, RReq> =>
        typeof input === "function"
          ? (input as (get: Context) => Effect.Effect<A, E2, RReq>)(defaultContext)
          : input;
      return query(managed as RuntimeLike<R, unknown>, run);
    },
    action<A, E2, RReq extends R = R, Input = void>(
      effect: (input: Input) => Effect.Effect<A, E2, RReq>,
      options?: {
        readonly name?: string;
        readonly reactivityKeys?: ReactivityKeysInput;
        readonly singleFlight?: false | SingleFlightClientOptions<Input>;
        readonly onError?: (error: E2) => void;
        readonly onSuccess?: (input: Input) => void;
        readonly onTransition?: (event: { readonly phase: "start" | "success" | "failure" | "defect" }) => void;
      },
    ): ActionHandle<Input, E2, A> {
      const singleFlight = options?.singleFlight === false ? undefined : options?.singleFlight;
      const execute = (input: Input): Effect.Effect<A, E2 | ResultDefectError, RReq> => {
        if (!shouldUseSingleFlight(options?.singleFlight)) {
          return effect(input) as Effect.Effect<A, E2 | ResultDefectError, RReq>;
        }
        return Effect.serviceOption(SingleFlightTransportTag).pipe(
          Effect.flatMap((maybeTransport) => {
            if (maybeTransport._tag === "Some") {
              return runSingleFlightWithTransport<Input, A>(maybeTransport.value as any, input, singleFlight, options?.name);
            }
            if (singleFlight?.endpoint) {
              const installed = getInstalledSingleFlightTransport();
              if (installed) {
                return runSingleFlightWithTransport<Input, A>(installed as any, input, singleFlight, options?.name);
              }
              return runSingleFlightWithDirectFetch<Input, A>(input, singleFlight, options?.name);
            }
            if (singleFlight?.mode === "force") {
              return Effect.fail({ _tag: "ResultDefectError", defect: "Single-flight transport required but unavailable" } as const);
            }
            return effect(input) as Effect.Effect<A, E2 | ResultDefectError, RReq>;
          }),
        ) as Effect.Effect<A, E2 | ResultDefectError, RReq>;
      };
      const handle = defineMutation(
        (input: Input) => execute(input),
        {
          runtime: managed as RuntimeLike<R, unknown>,
          name: options?.name,
          onTransition: options?.onTransition,
          onSuccess: (input) => {
            options?.onSuccess?.(input);
            if (options?.reactivityKeys !== undefined) {
              invalidateReactivity(options.reactivityKeys);
            }
          },
          onFailure: (error) => {
            if (typeof error === "object" && error !== null && "_tag" in error && (error as any)._tag === "ResultDefectError") return;
            options?.onError?.(error as E2);
          },
        },
      );

      const out = ((input: Input) => {
        handle.run(input);
      }) as ActionHandle<Input, E2, A>;
      out.run = (input: Input) => handle.run(input);
      out.runEffect = (input: Input) =>
        Effect.tryPromise({
          try: () => runPromiseWithRuntime(managed as RuntimeLike<R, unknown>, execute(input)),
          catch: (error) => error as E2 | BridgeError | MutationSupersededError,
        });
      out.effect = (input: Input) => handle.effect(input) as Effect.Effect<void, E2 | BridgeError | MutationSupersededError>;
      out.result = handle.result as Accessor<Result<void, E2>>;
      out.pending = handle.pending;
      return out;
    },
    dispose(): Promise<void> {
      return managed.dispose();
    },
  };
};

export const runtime: {
  /** Create a ManagedRuntime-backed Atom runtime. */
  <R, E>(layer: Layer.Layer<R, E, never>): AtomRuntime<R, E>;
  /** Add a global Layer merged into all future Atom runtimes. */
  addGlobalLayer<R, E>(layer: Layer.Layer<R, E, never>): void;
  /** Clear previously registered global runtime Layers. */
  clearGlobalLayers(): void;
} = Object.assign(runtimeImpl, {
  addGlobalLayer<R, E>(layer: Layer.Layer<R, E, never>): void {
    globalRuntimeLayers = [...globalRuntimeLayers, layer as unknown as Layer.Layer<any, any, never>];
  },
  clearGlobalLayers(): void {
    globalRuntimeLayers = [];
  },
});

/**
 * Effect constructor for runtime creation.
 *
 * Useful when app bootstrap is modeled as an Effect pipeline.
 */
export const runtimeEffect = <R, E>(layer: Layer.Layer<R, E, never>): Effect.Effect<AtomRuntime<R, E>> =>
  Effect.sync(() => runtime(layer));

/**
 * Logical keys used to wire query invalidation to mutation completion.
 *
 * - `string[]` invalidates exact keys
 * - `{ key: [id1, id2] }` invalidates `key`, `key:id1`, `key:id2`
 */
export type ReactivityKeysInput =
  RuntimeReactivityKeysInput;

const ReactivityKeysSymbol: unique symbol = Symbol.for("effect-atom-jsx/ReactivityKeys");

type ReactivityTagged = {
  [ReactivityKeysSymbol]?: ReadonlyArray<string>;
};

export function invalidateReactivity(input: ReactivityKeysInput): void {
  invalidateReactivityRuntime(input);
}

/** Read and track reactivity keys in the current reactive scope. */
export function trackReactivity(input: ReactivityKeysInput): void {
  trackReactivityRuntime(input);
}

/** Flush pending reactivity notifications (primarily for tests/dev). */
export function flushReactivity(): Effect.Effect<void> {
  return flushReactivityRuntime();
}

/**
 * Make an atom depend on logical reactivity keys.
 *
 * Calling `invalidateReactivity(keys)` will refresh atoms wrapped with the
 * same keys.
 */
export function withReactivity(
  input: ReactivityKeysInput,
): <A>(self: Atom<A>) => Atom<A>;
export function withReactivity<A>(
  self: Atom<A>,
  input: ReactivityKeysInput,
): Atom<A>;
export function withReactivity<A>(
  arg1: Atom<A> | ReactivityKeysInput,
  arg2?: ReactivityKeysInput,
): Atom<A> | ((self: Atom<A>) => Atom<A>) {
  if (arg2 === undefined) {
    const keys = normalizeReactivityKeys(arg1 as ReactivityKeysInput);
    return (self: Atom<A>) => {
      const wrapped = readable((get) => {
        trackReactivityRuntime(keys);
        return get(self);
      }) as Atom<A> & ReactivityTagged;
      wrapped[ReactivityKeysSymbol] = keys;
      return wrapped;
    };
  }

  const self = arg1 as Atom<A>;
  const keys = normalizeReactivityKeys(arg2);
  const wrapped = readable((get) => {
      trackReactivityRuntime(keys);
      return get(self);
  }) as Atom<A> & ReactivityTagged;
  wrapped[ReactivityKeysSymbol] = keys;
  return wrapped;
}

/** Introspect normalized reactivity keys attached by `withReactivity`. */
export function reactivityKeys<A>(self: Atom<A>): ReadonlyArray<string> {
  const tagged = self as Atom<A> & ReactivityTagged;
  return tagged[ReactivityKeysSymbol] ?? [];
}

export function action<A, E, Input = void>(
  effectFn: (input: Input) => Effect.Effect<A, E, never>,
  options?: {
    readonly name?: string;
    readonly reactivityKeys?: ReactivityKeysInput;
    readonly singleFlight?: false | SingleFlightClientOptions<Input>;
    readonly onError?: (error: E) => void;
    readonly onSuccess?: (input: Input) => void;
    readonly onTransition?: (event: { readonly phase: "start" | "success" | "failure" | "defect" }) => void;
  },
): ActionHandle<Input, E, A>;
export function action<A, E, R, RReq extends R = R, Input = void>(
  runtimeArg: RuntimeLike<R, unknown>,
  effectFn: (input: Input) => Effect.Effect<A, E, RReq>,
  options?: {
    readonly name?: string;
    readonly reactivityKeys?: ReactivityKeysInput;
    readonly singleFlight?: false | SingleFlightClientOptions<Input>;
    readonly onError?: (error: E) => void;
    readonly onSuccess?: (input: Input) => void;
    readonly onTransition?: (event: { readonly phase: "start" | "success" | "failure" | "defect" }) => void;
  },
): ActionHandle<Input, E, A>;
export function action<A, E, R, Input = void>(
  arg1: RuntimeLike<R, unknown> | ((input: Input) => Effect.Effect<A, E, R>),
  arg2?: ((input: Input) => Effect.Effect<A, E, R>) | {
    readonly name?: string;
    readonly reactivityKeys?: ReactivityKeysInput;
    readonly singleFlight?: false | SingleFlightClientOptions<Input>;
    readonly onError?: (error: E) => void;
    readonly onSuccess?: (input: Input) => void;
    readonly onTransition?: (event: { readonly phase: "start" | "success" | "failure" | "defect" }) => void;
  },
  arg3?: {
    readonly name?: string;
    readonly reactivityKeys?: ReactivityKeysInput;
    readonly singleFlight?: false | SingleFlightClientOptions<Input>;
    readonly onError?: (error: E) => void;
    readonly onSuccess?: (input: Input) => void;
    readonly onTransition?: (event: { readonly phase: "start" | "success" | "failure" | "defect" }) => void;
  },
): ActionHandle<Input, E, A> {
  const hasRuntime = typeof arg1 !== "function";
  const runtimeArg = hasRuntime ? arg1 as RuntimeLike<R, unknown> : undefined;
  const effectFn = (hasRuntime ? arg2 : arg1) as (input: Input) => Effect.Effect<A, E, R>;
  const options = (hasRuntime ? arg3 : arg2) as {
    readonly name?: string;
    readonly reactivityKeys?: ReactivityKeysInput;
    readonly singleFlight?: false | SingleFlightClientOptions<Input>;
    readonly onError?: (error: E) => void;
    readonly onSuccess?: (input: Input) => void;
    readonly onTransition?: (event: { readonly phase: "start" | "success" | "failure" | "defect" }) => void;
  } | undefined;
  const singleFlight = options?.singleFlight === false ? undefined : options?.singleFlight;

  const execute = (input: Input): Effect.Effect<A, E | ResultDefectError, R> => {
    if (!shouldUseSingleFlight(options?.singleFlight)) {
      return effectFn(input) as Effect.Effect<A, E | ResultDefectError, R>;
    }
    const installed = getInstalledSingleFlightTransport();
    if (installed) {
      return runSingleFlightWithTransport<Input, A>(installed as any, input, singleFlight, options?.name) as Effect.Effect<A, E | ResultDefectError, R>;
    }
    if (singleFlight?.endpoint) {
      return runSingleFlightWithDirectFetch<Input, A>(input, singleFlight, options?.name) as Effect.Effect<A, E | ResultDefectError, R>;
    }
    if (singleFlight?.mode === "force") {
      return Effect.fail({ _tag: "ResultDefectError", defect: "Single-flight transport required but unavailable" } as const) as Effect.Effect<A, E | ResultDefectError, R>;
    }
    return effectFn(input) as Effect.Effect<A, E | ResultDefectError, R>;
  };

  const handle = runtimeArg === undefined
    ? defineMutation((input: Input) => execute(input) as Effect.Effect<unknown, E | ResultDefectError, never>, {
      name: options?.name,
      onTransition: options?.onTransition,
      onSuccess: (input) => {
        options?.onSuccess?.(input);
        if (options?.reactivityKeys !== undefined) {
          invalidateReactivity(options.reactivityKeys);
        }
      },
      onFailure: (error) => {
        if (typeof error === "object" && error !== null && "_tag" in error && (error as any)._tag === "ResultDefectError") return;
        options?.onError?.(error as E);
      },
    })
    : defineMutation((input: Input) => execute(input), {
      runtime: runtimeArg as RuntimeLike<R, unknown>,
      name: options?.name,
      onTransition: options?.onTransition,
      onSuccess: (input) => {
        options?.onSuccess?.(input);
        if (options?.reactivityKeys !== undefined) {
          invalidateReactivity(options.reactivityKeys);
        }
      },
      onFailure: (error) => {
        if (typeof error === "object" && error !== null && "_tag" in error && (error as any)._tag === "ResultDefectError") return;
        options?.onError?.(error as E);
      },
    });

  const out = ((input: Input) => {
    handle.run(input);
  }) as ActionHandle<Input, E, A>;
  out.run = (input: Input) => handle.run(input);
  out.runEffect = (input: Input) =>
    Effect.tryPromise({
      try: () => runPromiseWithRuntime(runtimeArg, execute(input)),
      catch: (error) => error as E | BridgeError | MutationSupersededError,
    });
  out.effect = (input: Input) => handle.effect(input) as Effect.Effect<void, E | BridgeError | MutationSupersededError>;
  out.result = handle.result as Accessor<Result<void, E>>;
  out.pending = handle.pending;
  return out;
}

/** Pull atom payload for incremental stream loading. */
export interface PullChunk<A> {
  readonly items: ReadonlyArray<A>;
  readonly done: boolean;
}

export type PullResult<A, E = never> = FetchResult.Result<PullChunk<A>, E>;

/**
 * Out-of-order stream chunk payload.
 *
 * `sequence` is 0-based and monotonically increasing for each chunk at source.
 */
export interface StreamChunk<A> {
  readonly sequence: number;
  readonly items: ReadonlyArray<A>;
  readonly done?: boolean;
}

/** Serializable state for out-of-order stream assembly. */
export interface OOOStreamState<A> {
  readonly version: 1;
  readonly items: ReadonlyArray<A>;
  readonly nextSequence: number;
  readonly buffered: Readonly<Record<number, ReadonlyArray<A>>>;
  readonly finalSequence: number | null;
  readonly complete: boolean;
}

/**
 * Build an empty out-of-order stream state.
 * @deprecated Use `Atom.Stream.emptyState()` instead.
 */
export function emptyOOOStreamState<A>(): OOOStreamState<A> {
  return {
    version: 1,
    items: [],
    nextSequence: 0,
    buffered: {},
    finalSequence: null,
    complete: false,
  };
}

/**
 * Merge one out-of-order chunk into stream state.
 *
 * Duplicate or already-consumed chunks are ignored.
 * @deprecated Use `Atom.Stream.applyChunk()` instead.
 */
export function applyOOOStreamChunk<A>(
  state: OOOStreamState<A>,
  chunk: StreamChunk<A>,
): OOOStreamState<A> {
  if (chunk.sequence < state.nextSequence) {
    return state;
  }

  let nextSequence = state.nextSequence;
  let items = state.items;
  const buffered: Record<number, ReadonlyArray<A>> = { ...state.buffered };
  let finalSequence = state.finalSequence;

  if (chunk.done === true) {
    finalSequence = finalSequence === null ? chunk.sequence : Math.min(finalSequence, chunk.sequence);
  }

  if (chunk.sequence === nextSequence) {
    items = [...items, ...chunk.items];
    nextSequence += 1;
  } else if (buffered[chunk.sequence] === undefined) {
    buffered[chunk.sequence] = chunk.items;
  }

  while (buffered[nextSequence] !== undefined) {
    items = [...items, ...buffered[nextSequence]];
    delete buffered[nextSequence];
    nextSequence += 1;
  }

  const complete = finalSequence !== null && nextSequence > finalSequence;

  return {
    version: 1,
    items,
    nextSequence,
    buffered,
    finalSequence,
    complete,
  };
}

/**
 * Hydrate serialized out-of-order stream state.
 *
 * Invalid payloads fall back to an empty state.
 * @deprecated Use `Atom.Stream.hydrateState()` instead.
 */
export function hydrateOOOStreamState<A>(
  value: unknown,
): OOOStreamState<A> {
  if (typeof value !== "object" || value === null) {
    return emptyOOOStreamState<A>();
  }
  const v = value as Partial<OOOStreamState<A>>;
  if (v.version !== 1 || !Array.isArray(v.items) || typeof v.nextSequence !== "number") {
    return emptyOOOStreamState<A>();
  }

  return {
    version: 1,
    items: v.items,
    nextSequence: v.nextSequence,
    buffered: typeof v.buffered === "object" && v.buffered !== null ? v.buffered : {},
    finalSequence: typeof v.finalSequence === "number" ? v.finalSequence : null,
    complete: v.complete === true,
  };
}

/**
 * Advanced stream helpers grouped under `Atom.Stream` to reduce top-level API noise.
 */
export interface TextInputStreamOptions {
  /** Trim leading/trailing whitespace. Defaults to `true`. */
  readonly trim?: boolean;
  /** Drop values shorter than this length after normalization. Defaults to `1`. */
  readonly minLength?: number;
}

export interface SearchInputStreamOptions extends TextInputStreamOptions {
  /** Lowercase values after normalization. Defaults to `false`. */
  readonly lowercase?: boolean;
  /** Emit only when the value changes. Defaults to `true`. */
  readonly distinct?: boolean;
}

export function textInputStream<E, R>(
  stream: FxStream.Stream<string, E, R>,
  options?: TextInputStreamOptions,
): FxStream.Stream<string, E, R> {
  const trim = options?.trim ?? true;
  const minLength = Math.max(0, options?.minLength ?? 1);

  const normalized = trim
    ? stream.pipe(FxStream.map((value) => value.trim()))
    : stream;

  return minLength <= 0
    ? normalized
    : normalized.pipe(FxStream.filter((value) => value.length >= minLength));
}

export function searchInputStream<E, R>(
  stream: FxStream.Stream<string, E, R>,
  options?: SearchInputStreamOptions,
): FxStream.Stream<string, E, R> {
  const base = textInputStream(stream, options);
  const withCase = options?.lowercase === true
    ? base.pipe(FxStream.map((value) => value.toLowerCase()))
    : base;

  if (options?.distinct === false) {
    return withCase;
  }

  let hasPrevious = false;
  let previous = "";
  return withCase.pipe(FxStream.filter((value) => {
    if (!hasPrevious || !Object.is(previous, value)) {
      previous = value;
      hasPrevious = true;
      return true;
    }
    return false;
  }));
}

export const Stream = {
  emptyState: emptyOOOStreamState,
  applyChunk: applyOOOStreamChunk,
  hydrateState: hydrateOOOStreamState,
  textInput: textInputStream,
  searchInput: searchInputStream,
} as const;

/**
 * Build a pull-based stream atom.
 *
 * The writable input is `void`; each write pulls the next chunk into `items`.
 */
export function pull<A, E, R>(
  stream: FxStream.Stream<A, E, R>,
  options?: {
    readonly runtime?: RuntimeLike<R, unknown>;
    readonly chunkSize?: number;
  },
): Writable<PullResult<A, E>, void> {
  const chunkSize = Math.max(1, options?.chunkSize ?? 1);
  const [state, setState] = createSignal<PullResult<A, E>>(FetchResult.initial(false));

  let loaded: ReadonlyArray<A> | null = null;
  let cursor = 0;
  let running = false;

  const emitNext = (): void => {
    if (loaded === null) return;
    const nextItems = loaded.slice(cursor, cursor + chunkSize);
    cursor += nextItems.length;
    const previous = state();
    const previousItems = previous._tag === "Success" ? previous.value.items : [];
    const merged = [...previousItems, ...nextItems];
    setState(FetchResult.success({ items: merged, done: cursor >= loaded.length }));
  };

  const startLoad = (): void => {
    if (running) return;
    running = true;
    setState(FetchResult.waiting(state()));
    const collect = FxStream.runCollect(stream).pipe(
      Effect.map((chunk) => Array.from(chunk as Iterable<A>)),
    );
    void runPromiseWithRuntime(options?.runtime, collect)
      .then((items) => {
        loaded = items;
        cursor = 0;
        emitNext();
      })
      .catch((error) => {
        if (Cause.isCause(error)) {
          const typed = Cause.findErrorOption(error);
          if (Option.isSome(typed)) {
            setState(FetchResult.failure(typed.value as E));
          } else {
            setState(FetchResult.failure({ defect: Cause.pretty(error) } as unknown as E));
          }
          return;
        }
        setState(FetchResult.failure(error as E));
      })
      .finally(() => {
        running = false;
      });
  };

  return writable(
    () => state(),
    () => {
      if (loaded === null) {
        startLoad();
        return;
      }
      emitNext();
    },
  );
}

type SearchParamCodec<A> = {
  readonly parse?: (raw: string | null) => A;
  readonly serialize?: (value: A) => string | null;
};

/**
 * Create an atom backed by `window.location.search`.
 *
 * Reads track the current query param value, writes update it via
 * `history.replaceState`.
 */
export function searchParam(name: string): Writable<string | null, string | null>;
export function searchParam<A>(name: string, codec: SearchParamCodec<A>): Writable<A, A>;
export function searchParam<A>(
  name: string,
  codec?: SearchParamCodec<A>,
): Writable<A | string | null, A | string | null> {
  const readRaw = (): string | null => {
    if (typeof window === "undefined" || typeof window.location === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  };

  const parse = (raw: string | null): A | string | null => codec?.parse ? codec.parse(raw) : raw;
  const serialize = (value: A | string | null): string | null => {
    if (!codec?.serialize) return value as string | null;
    return codec.serialize(value as A);
  };

  const [value, setValue] = createSignal<A | string | null>(parse(readRaw()));
  let listening = false;

  const onPopState = (): void => {
    setValue(parse(readRaw()));
  };

  return writable(
    () => {
      if (!listening && typeof window !== "undefined" && typeof window.addEventListener === "function") {
        listening = true;
        window.addEventListener("popstate", onPopState);
        onCleanup(() => {
          window.removeEventListener("popstate", onPopState);
          listening = false;
        });
      }
      return value();
    },
    (_ctx, next) => {
      const raw = serialize(next);
      setValue(next);
      if (typeof window === "undefined" || typeof window.location === "undefined") return;
      const url = new URL(window.location.href);
      if (raw === null) {
        url.searchParams.delete(name);
      } else {
        url.searchParams.set(name, raw);
      }
      if (typeof window.history !== "undefined" && typeof window.history.replaceState === "function") {
        window.history.replaceState(window.history.state, "", url.toString());
      }
    },
  );
}

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type KvsCodec<A> = {
  readonly decode?: (raw: unknown) => A;
  readonly encode?: (value: A) => unknown;
};

const memoryKvs = new Map<string, string>();

function getDefaultStorage(): KeyValueStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return {
    getItem(key: string) {
      return memoryKvs.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memoryKvs.set(key, value);
    },
    removeItem(key: string) {
      memoryKvs.delete(key);
    },
  };
}

export function kvs<A>(options: {
  readonly key: string;
  readonly defaultValue: () => A;
  readonly storage?: KeyValueStorage;
  readonly codec?: KvsCodec<A>;
}): Writable<A, A> {
  const storage = options.storage ?? getDefaultStorage();
  const decode = options.codec?.decode ?? ((raw: unknown) => raw as A);
  const encode = options.codec?.encode ?? ((value: A) => value as unknown);

  const readInitial = (): A => {
    const raw = storage.getItem(options.key);
    if (raw === null) return options.defaultValue();
    try {
      return decode(JSON.parse(raw));
    } catch {
      return options.defaultValue();
    }
  };

  const [value, setValue] = createSignal<A>(readInitial());

  return writable(
    () => value(),
    (_ctx, next) => {
      setValue(next);
      storage.setItem(options.key, JSON.stringify(encode(next)));
    },
  );
}

export interface ProjectionOptions<T> {
  /**
   * Key used for array reconciliation when derive returns a new array value.
   *
   * Defaults to `"id"`.
   */
  readonly key?: string;
  /**
   * Optional equality function to keep previous identity when logically equal.
   */
  readonly equals?: (left: T, right: T) => boolean;
}

/**
 * Create a mutable derived atom (projection).
 *
 * On each read, `derive` runs against a deep-cloned draft of the previous
 * projection value. You can either mutate the draft in-place or return a new
 * value. Returned arrays/records are reconciled to preserve stable identities
 * for unchanged fields/items.
 */
export function projection<T>(
  derive: (draft: T, get: Context) => void | T,
  initial: T,
  options?: ProjectionOptions<T>,
): Atom<T> {
  let current = initial;
  const key = options?.key ?? "id";

  return readable((get) => {
    const draft = deepCloneProjectionValue(current);
    const returned = derive(draft, get);
    const candidate = returned === undefined ? draft : returned;
    const reconciled = reconcileProjectionValue(current, candidate, key);

    if (options?.equals ? options.equals(current, reconciled) : Object.is(current, reconciled)) {
      return current;
    }

    current = reconciled;
    return current;
  });
}

export interface ProjectionAsyncOptions<T, R>
  extends ProjectionOptions<T> {
  readonly runtime?: RuntimeLike<R, unknown>;
}

/**
 * Async projection that yields `Result<T, E>`.
 *
 * This composes projection semantics with `Atom.query(...)`. Reads made through
 * `get(...)` are tracked reactively; stale runs are interrupted by query
 * semantics when dependencies change.
 */
export function projectionAsync<T, E, R = never>(
  derive: (draft: T, get: Context) => Effect.Effect<void | T, E, R>,
  initial: T,
  options?: ProjectionAsyncOptions<T, R>,
): Atom<Result<T, E>> {
  let current = initial;
  const key = options?.key ?? "id";

  const run = () => Effect.suspend(() => {
    const draft = deepCloneProjectionValue(current);
    return derive(draft, defaultContext).pipe(
      Effect.map((returned) => {
        const candidate = (returned === undefined ? draft : returned) as T;
        const reconciled = reconcileProjectionValue(current, candidate, key);
        if (options?.equals ? options.equals(current, reconciled) : Object.is(current, reconciled)) {
          return current;
        }
        current = reconciled;
        return current;
      }),
    );
  });

  return options?.runtime === undefined
    ? query(run)
    : query(options.runtime, run);
}

export function map<A, B>(f: (a: A) => B): (self: Atom<A>) => Atom<B>;
export function map<A, B>(self: Atom<A>, f: (a: A) => B): Atom<B>;
/**
 * Map an atom value into a derived atom.
 *
 * Supports both data-first and data-last usage.
 *
 * @example
 * const doubled = Atom.map(count, (n) => n * 2)
 * const toLabel = Atom.map((n: number) => `#${n}`)
 * const labeledCount = toLabel(count)
 *
 * @example
 * const user = Atom.make({ first: "Ada", last: "Lovelace" })
 * const fullName = Atom.map(user, (u) => `${u.first} ${u.last}`)
 */
export function map<A, B>(
  arg1: Atom<A> | ((a: A) => B),
  arg2?: (a: A) => B,
): Atom<B> | ((self: Atom<A>) => Atom<B>) {
  if (typeof arg1 === "function" && arg2 === undefined) {
    const f = arg1 as (a: A) => B;
    return (self: Atom<A>) => readable((get) => f(get(self)));
  }
  const self = arg1 as Atom<A>;
  const f = arg2 as (a: A) => B;
  return readable((get) => f(get(self)));
}

export function withFallback<A>(fallback: A): <E>(self: Atom<A | E>) => Atom<A>;
export function withFallback<A, E>(self: Atom<A | E>, fallback: A): Atom<A>;
/**
 * Provide a fallback when an atom returns `null` or `undefined`.
 *
 * This is handy for optional server data when UI wants a stable value.
 *
 * @example
 * const safeName = Atom.withFallback(nameAtom, "anonymous")
 */
export function withFallback<A, E>(
  arg1: A | Atom<A | E>,
  arg2?: A,
): Atom<A> | ((self: Atom<A | E>) => Atom<A>) {
  if (arg2 === undefined) {
    const fallback = arg1 as A;
    return (self: Atom<A | E>) => readable((get) => {
      const value = get(self);
      return (value ?? fallback) as A;
    });
  }
  const self = arg1 as Atom<A | E>;
  const fallback = arg2;
  return readable((get) => {
    const value = get(self);
    return (value ?? fallback) as A;
  });
}

/** Flush pending reactive updates immediately. */
export const flush = (): void => {
  flushBatch();
};

/**
 * Read atom value as an `Effect`.
 *
 * The returned effect is synchronous and can be composed with other Effect
 * operations in pipelines.
 *
 * @example
 * const n = Effect.runSync(Atom.get(count))
 */
export const get = <A>(self: Atom<A>): Effect.Effect<A> =>
  Effect.sync(() => defaultContext.get(self));

export function result<A, E>(): (
  self: Atom<Result<A, E> | FetchResult.Result<A, E>>,
) => Effect.Effect<A, E | BridgeError>;
export function result<A, E>(
  self: Atom<Result<A, E> | FetchResult.Result<A, E>>,
): Effect.Effect<A, E | BridgeError>;
/**
 * Read a result-like atom as an `Effect` value.
 *
 * Supports both core `Result` and compatibility `FetchResult` atoms.
 */
export function result<A, E>(
  self?: Atom<Result<A, E> | FetchResult.Result<A, E>>,
): 
  | Effect.Effect<A, E | BridgeError>
  | ((self: Atom<Result<A, E> | FetchResult.Result<A, E>>) => Effect.Effect<A, E | BridgeError>) {
  if (self === undefined) {
    return (nextSelf: Atom<Result<A, E> | FetchResult.Result<A, E>>) =>
      Effect.suspend(() => toEffectResult(defaultContext.get(nextSelf)));
  }
  return Effect.suspend(() => toEffectResult(defaultContext.get(self)));
}

export function set<R, W>(value: W): (self: Writable<R, W>) => Effect.Effect<void>;
export function set<R, W>(self: Writable<R, W>, value: W): Effect.Effect<void>;
/**
 * Write atom value as an `Effect`.
 *
 * Supports data-first and data-last forms.
 *
 * @example
 * Effect.runSync(Atom.set(count, 2))
 * const setZero = Atom.set(0)
 * Effect.runSync(setZero(count))
 */
export function set<R, W>(
  arg1: Writable<R, W> | W,
  arg2?: W,
): Effect.Effect<void> | ((self: Writable<R, W>) => Effect.Effect<void>) {
  if (arg2 === undefined) {
    const value = arg1 as W;
    return (self: Writable<R, W>) => Effect.sync(() => defaultContext.set(self, value));
  }
  const self = arg1 as Writable<R, W>;
  const value = arg2;
  return Effect.sync(() => defaultContext.set(self, value));
}

export function update<R>(f: (value: R) => R): (self: Writable<R, R>) => Effect.Effect<void>;
export function update<R>(self: Writable<R, R>, f: (value: R) => R): Effect.Effect<void>;
/**
 * Update atom value from previous value.
 *
 * @example
 * Effect.runSync(Atom.update(count, (n) => n + 1))
 */
export function update<R>(
  arg1: Writable<R, R> | ((value: R) => R),
  arg2?: (value: R) => R,
): Effect.Effect<void> | ((self: Writable<R, R>) => Effect.Effect<void>) {
  if (arg2 === undefined) {
    const f = arg1 as (value: R) => R;
    return (self: Writable<R, R>) => Effect.sync(() => {
      const next = f(defaultContext.get(self));
      defaultContext.set(self, next);
    });
  }
  const self = arg1 as Writable<R, R>;
  const f = arg2;
  return Effect.sync(() => {
    const next = f(defaultContext.get(self));
    defaultContext.set(self, next);
  });
}

export function modify<R, W, A>(
  f: (value: R) => [A, W],
): (self: Writable<R, W>) => Effect.Effect<A>;
export function modify<R, W, A>(
  self: Writable<R, W>,
  f: (value: R) => [A, W],
): Effect.Effect<A>;
/**
 * Atom modification that also returns a computed value.
 *
 * This is useful when a single read/transform/write should produce a return
 * value (for logging, IDs, domain events, etc.).
 *
 * @example
 * const previous = Effect.runSync(Atom.modify(count, (n) => [n, n + 1]))
 */
export function modify<R, W, A>(
  arg1: Writable<R, W> | ((value: R) => [A, W]),
  arg2?: (value: R) => [A, W],
): Effect.Effect<A> | ((self: Writable<R, W>) => Effect.Effect<A>) {
  if (arg2 === undefined) {
    const f = arg1 as (value: R) => [A, W];
    return (self: Writable<R, W>) => Effect.sync(() => {
      const [ret, next] = f(defaultContext.get(self));
      defaultContext.set(self, next);
      return ret;
    });
  }
  const self = arg1 as Writable<R, W>;
  const f = arg2;
  return Effect.sync(() => {
    const [ret, next] = f(defaultContext.get(self));
    defaultContext.set(self, next);
    return ret;
  });
}

/** Alias for `Atom.get(...)` when emphasizing Effect composition. */
export const getEffect = get;
/** Alias for `Atom.result(...)` when emphasizing Effect composition. */
export const resultEffect = result;
/** Alias for `Atom.set(...)` when emphasizing Effect composition. */
export const setEffect = set;
/** Alias for `Atom.update(...)` when emphasizing Effect composition. */
export const updateEffect = update;
/** Alias for `Atom.modify(...)` when emphasizing Effect composition. */
export const modifyEffect = modify;

/**
 * Force-refresh an atom and invalidate dependents.
 *
 * Useful when the read logic depends on external state that is not captured
 * through atom dependencies.
 *
 * @example
 * const clock = Atom.readable(() => Date.now())
 * Effect.runSync(Atom.refresh(clock))
 */
export const refresh = <A>(self: Atom<A>): Effect.Effect<void> =>
  Effect.sync(() => defaultContext.refresh(self));

/**
 * Subscribe to atom value changes.
 *
 * By default, listener is called immediately with current value, then on each
 * subsequent change.
 *
 * @example
 * const unsub = Atom.subscribe(count, console.log)
 * // later: unsub()
 */
export const subscribe = <A>(
  self: Atom<A>,
  f: (_: A) => void,
  options?: { readonly immediate?: boolean },
): (() => void) => {
  const owner = new Owner();
  runWithOwner(owner, () => {
    let first = true;
    createEffect(() => {
      const next = defaultContext.get(self);
      if (first) {
        first = false;
        if (options?.immediate === false) return;
      }
      f(next);
    });
  });
  return () => owner.dispose();
};

/**
 * Creates an atom whose value is continuously updated from an Effect Stream.
 *
 * Uses the default Runtime to fork the stream subscription. When the atom
 * is first read (or explicitly mounted via a Registry), the stream starts.
 * The stream is interrupted when the registry/owner unmounts.
 *
 * This is ideal for websocket/event-stream style data where you always want
 * the latest value represented as an atom.
 *
 * @example
 * const prices = Atom.fromStream(stream, 0)
 * const stop = registry.mount(prices)
 * // later: stop()
 */
export function fromStream<A, E, R>(
  stream: FxStream.Stream<A, E, R>,
  initialValue: A,
  runtime?: any, // V4 runtime
): Atom<A> {
  const [get, set] = createSignal<A>(initialValue);
  let fiber: Fiber.Fiber<void, E> | null = null;
  let active = false;

  const start = () => {
    if (active) return;
    active = true;
    const eff = FxStream.runForEach(stream, (a) => Effect.sync(() => set(a))) as Effect.Effect<void, E, R>;
    fiber = (runtime ? Effect.runForkWith(runtime as any)(eff) : Effect.runFork(eff as unknown as Effect.Effect<void, E, never>)) as Fiber.Fiber<void, E>;
  };

  const stop = () => {
    if (!active) return;
    active = false;
    if (fiber) {
      Effect.runFork(Fiber.interrupt(fiber));
      fiber = null;
    }
  };

  return readable((ctx) => {
    // If not active, try to start it and schedule cleanup
    if (!active) {
      const owner = new Owner();
      runWithOwner(owner, () => {
        start();
        onCleanup(() => stop());
      });
    }
    return get();
  });
}

/**
 * Creates an atom that reads from an Effect Queue.
 *
 * Internally converts the queue to a Stream via `Stream.fromQueue` and
 * delegates to `fromStream`.
 *
 * @param queue        - The Effect Dequeue to consume values from.
 * @param initialValue - The atom's value before the first item arrives.
 *
 * @example
 * const queue = yield* Queue.unbounded<number>()
 * const latest = Atom.fromQueue(queue, 0)
 * // latest atom updates each time an item is offered to the queue
 */
export function fromQueue<A>(
  queue: Queue.Dequeue<A>,
  initialValue: A,
): Atom<A> {
  return fromStream(FxStream.fromQueue(queue), initialValue);
}

/**
 * Create an atom from an Effect `Schedule` by lifting it to a Stream.
 *
 * Useful for polling/clock-style atoms with Effect-native scheduling.
 */
export function fromSchedule<A>(
  schedule: Schedule.Schedule<A, any, any>,
  initialValue: A,
  runtime?: any,
): Atom<A> {
  return fromStream(FxStream.fromSchedule(schedule), initialValue, runtime);
}

export function query<A, E, R>(
  fn: () => Effect.Effect<A, E, R>,
): Atom<Result<A, E>>;
export function query<A, E, R>(
  runtime: RuntimeLike<R, unknown>,
  fn: () => Effect.Effect<A, E, R>,
): Atom<Result<A, E>>;
/**
 * Create an atom backed by `defineQuery(...).result` semantics.
 *
 * This is the atom-native equivalent of a runtime query accessor:
 * - tracks dependencies read inside `fn()`
 * - interrupts stale fibers on dependency changes
 * - exposes `Result<A, E>` through normal atom reads
 *
 * Without an explicit runtime, it uses ambient runtime behavior from `mount`.
 *
 * @example
 * const user = Atom.query(() => use(Api).getUser(ui.get(userIdAtom)))
 *
 * @example
 * const user = Atom.query(runtime, () => Effect.service(Api).pipe(Effect.flatMap((api) => api.getUser("1"))))
 */
export function query<A, E, R>(
  arg1: RuntimeLike<R, unknown> | (() => Effect.Effect<A, E, R>),
  arg2?: () => Effect.Effect<A, E, R>,
): Atom<Result<A, E>> {
  let accessor: Accessor<Result<A, E>> | null = null;

  const getAccessor = (): Accessor<Result<A, E>> => {
    if (accessor !== null) return accessor;
    if (arg2 === undefined) {
      accessor = defineQuery(arg1 as () => Effect.Effect<A, E, R>).result;
    } else {
      accessor = defineQuery(arg2, { runtime: arg1 as RuntimeLike<R, unknown> }).result;
    }
    return accessor as Accessor<Result<A, E>>;
  };

  return readable(() => getAccessor()());
}

/**
 * Standalone async effect atom (no runtime required).
 *
 * Alias for `query(fn)` to support a smaller v1 mental model:
 * `apiRuntime.atom` / `apiRuntime.action` / `Atom.effect`.
 */
export const effect = <A, E>(
  fn: () => Effect.Effect<A, E, never>,
): Atom<Result<A, E>> => {
  let accessor: Accessor<Result<A, E>> | null = null;
  const getAccessor = (): Accessor<Result<A, E>> => {
    if (accessor !== null) return accessor;
    accessor = atomEffect(fn);
    return accessor;
  };
  return readable(() => getAccessor()());
};
