import { Effect } from "effect";
import { createSignal, batch as runBatch, type Accessor } from "./api.js";
import { Owner, runWithOwner } from "./owner.js";
import { createEffect } from "./api.js";

const TypeId = "~effect-atom-jsx/Atom" as const;
const WritableTypeId = "~effect-atom-jsx/Atom/Writable" as const;

type RefreshRef = {
  readonly get: Accessor<number>;
  readonly bump: () => void;
};

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
  readonly [TypeId]: typeof TypeId;
  readonly read: (get: Context) => A;
  readonly refresh?: (f: <A>(atom: Atom<A>) => void) => void;
}

export interface Writable<R, W = R> extends Atom<R> {
  readonly [WritableTypeId]: typeof WritableTypeId;
  readonly write: (ctx: WriteContext<R>, value: W) => void;
}

export interface Context {
  <A>(atom: Atom<A>): A;
  get<A>(atom: Atom<A>): A;
  refresh<A>(atom: Atom<A>): void;
  set<R, W>(atom: Writable<R, W>, value: W): void;
}

export interface WriteContext<A> {
  get<T>(atom: Atom<T>): T;
  set<R, W>(atom: Writable<R, W>, value: W): void;
  refreshSelf(): void;
  setSelf(value: A): void;
}

export const isAtom = (u: unknown): u is Atom<any> =>
  typeof u === "object" && u !== null && TypeId in u;

export const isWritable = <R, W>(atom: Atom<R>): atom is Writable<R, W> =>
  typeof atom === "object" && atom !== null && WritableTypeId in atom;

export const readable = <A>(
  read: (get: Context) => A,
  refresh?: (f: <A>(atom: Atom<A>) => void) => void,
): Atom<A> => ({
  [TypeId]: TypeId,
  read,
  refresh,
});

export const writable = <R, W = R>(
  read: (get: Context) => R,
  write: (ctx: WriteContext<R>, value: W) => void,
  refresh?: (f: <A>(atom: Atom<A>) => void) => void,
): Writable<R, W> => ({
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
  };
}

export function make<A>(read: (get: Context) => A): Atom<A>;
export function make<A>(initial: A & (A extends (...args: Array<any>) => any ? never : unknown)): Writable<A>;
/**
 * Create an atom.
 *
 * Overloads:
 * - `make(value)` -> writable atom
 * - `make((get) => ...)` -> derived read-only atom
 *
 * Derived atoms track reads performed through `get(...)` and recompute when
 * dependencies change.
 *
 * @example
 * const count = Atom.make(1)
 * const doubled = Atom.make((get) => get(count) * 2)
 */
export function make<A>(valueOrRead: A | ((get: Context) => A)): Atom<A> | Writable<A> {
  if (typeof valueOrRead === "function") {
    return readable(valueOrRead as (get: Context) => A);
  }
  const [getValue, setValue] = createSignal(valueOrRead as A);
  const atom = writable(
    () => getValue(),
    (_ctx, value) => setValue(value),
  );
  selfWriteMap.set(atom, (value: A) => setValue(value));
  return atom;
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
export const family = <Arg, T>(f: (arg: Arg) => T): ((arg: Arg) => T) => {
  const cache = new Map<Arg, T>();
  return (arg) => {
    const existing = cache.get(arg);
    if (existing !== undefined) return existing;
    const next = f(arg);
    cache.set(arg, next);
    return next;
  };
};

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

export const batch = (f: () => void): void => {
  runBatch(f);
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

/**
 * Force-refresh an atom and invalidate dependents.
 *
 * Useful when the read logic depends on external state that is not captured
 * through atom dependencies.
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
