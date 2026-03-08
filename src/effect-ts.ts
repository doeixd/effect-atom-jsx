/**
 * effect-ts.ts — Effect-TS integration layer.
 *
 * Bridges the synchronous reactive core with Effect-TS's structured
 * concurrency, typed errors, and dependency injection.
 *
 * Key primitives:
 *
 * 1. `atomEffect(effect)` — Signal backed by an Effect. Holds AsyncResult
 *    (Loading | Success | Failure) so consumers pattern-match instead of
 *    catching exceptions. Previous fiber is interrupted when deps change.
 *
 * 2. `createAtom(value | getter)` — Jotai-style atom API. Pure values give
 *    writable atoms; getter functions give derived atoms.
 *
 * 3. `scopedRoot(scope, fn)` — Binds a reactive root to an Effect Scope.
 *    Bidirectional: scope close → reactive dispose, reactive dispose → scope close.
 *
 * 4. `layerContext(layer, fn)` — Builds an Effect Layer asynchronously and
 *    renders children once services are available.
 *
 * 5. `Async`, `For`, `Show` — UI primitives for reactive rendering.
 */

import {
  Effect,
  Exit,
  Fiber,
  Runtime,
  Scope,
  Layer,
  Context as EffectContext,
  pipe,
  Either,
  Option,
  Cause,
} from "effect";
import { Signal } from "./signal.js";
import { Computation } from "./computation.js";
import { Owner, getOwner, runWithOwner } from "./owner.js";
import { createSignal, createEffect, onCleanup, createContext, type Accessor } from "./api.js";

// ─── Result type ──────────────────────────────────────────────────────────────

export type Loading = { _tag: "Loading" };
export type Success<A> = { _tag: "Success"; value: A };
export type Failure<E> = { _tag: "Failure"; error: E };
export type AsyncResult<A, E> = Loading | Success<A> | Failure<E>;

export const AsyncResult = {
  loading: { _tag: "Loading" } as Loading,
  success: <A>(value: A): Success<A> => ({ _tag: "Success", value }),
  failure: <E>(error: E): Failure<E> => ({ _tag: "Failure", error }),
  isLoading: <A, E>(r: AsyncResult<A, E>): r is Loading => r._tag === "Loading",
  isSuccess: <A, E>(r: AsyncResult<A, E>): r is Success<A> => r._tag === "Success",
  isFailure: <A, E>(r: AsyncResult<A, E>): r is Failure<E> => r._tag === "Failure",
};

// ─── atomEffect ───────────────────────────────────────────────────────────────

/**
 * Create a reactive signal driven by an Effect computation.
 *
 * The signal value is `AsyncResult<A, E>`, starting as `Loading`.
 * When deps change, the current fiber is interrupted and a new one starts.
 *
 * @example
 * const [userId] = createSignal(1);
 * const user = atomEffect(
 *   Effect.gen(function* () {
 *     const id = userId(); // tracked dependency
 *     return yield* fetchUser(id);
 *   })
 * );
 * // user() → AsyncResult<User, FetchError>
 */
export function atomEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtime: Runtime.Runtime<R> = Runtime.defaultRuntime as Runtime.Runtime<R>,
): Accessor<AsyncResult<A, E>> {
  const [result, setResult] = createSignal<AsyncResult<A, E>>(AsyncResult.loading);
  // We store the fiber as a generic RuntimeFiber to avoid the void/A mismatch.
  let fiberRef: Fiber.RuntimeFiber<unknown, unknown> | null = null;

  const interruptFiber = () => {
    if (fiberRef !== null) {
      const f = fiberRef;
      fiberRef = null;
      // Interrupt without awaiting the result.
      Runtime.runFork(Runtime.defaultRuntime)(Fiber.interrupt(f));
    }
  };

  new Computation(() => {
    interruptFiber();
    setResult(AsyncResult.loading);

    // Wrap in a void-returning effect so the forked fiber type is uniform.
    const wrapped: Effect.Effect<void, never, R> = pipe(
      effect,
      Effect.matchCause({
        onSuccess: (value: A) => {
          fiberRef = null;
          setResult(AsyncResult.success(value));
        },
        onFailure: (cause: Cause.Cause<E>) => {
          fiberRef = null;
          // Extract the typed error if available; otherwise stringify the cause.
          const maybeError = Cause.failureOption(cause);
          if (Option.isSome(maybeError)) {
            setResult(AsyncResult.failure(maybeError.value));
          } else {
            setResult(AsyncResult.failure(Cause.pretty(cause) as unknown as E));
          }
        },
      }),
      Effect.asVoid,
    );

    fiberRef = Runtime.runFork(runtime)(wrapped) as Fiber.RuntimeFiber<unknown, unknown>;
  });

  onCleanup(interruptFiber);

  return result;
}

// ─── createAtom ───────────────────────────────────────────────────────────────

/**
 * Ergonomic atom API. Pass a plain value for a writable atom, or a getter
 * function for a derived (read-only) atom.
 *
 * @example
 * const count = createAtom(0);
 * const doubled = createAtom((get) => get(count) * 2);
 *
 * count.get();           // 0
 * count.set(1);
 * count.update(n => n + 1);
 * doubled.get();         // 4
 */
export type AtomGetter<T> = (get: <U>(atom: Atom<U>) => U) => T;

export interface WritableAtom<T> {
  get(): T;
  set(value: T | ((prev: T) => T)): void;
  update(fn: (prev: T) => T): void;
  subscribe(listener: (value: T) => void): () => void;
}

export interface DerivedAtom<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

export type Atom<T> = WritableAtom<T> | DerivedAtom<T>;

export function createAtom<T>(value: T): WritableAtom<T>;
export function createAtom<T>(getter: AtomGetter<T>): DerivedAtom<T>;
export function createAtom<T>(
  valueOrGetter: T | AtomGetter<T>,
): WritableAtom<T> | DerivedAtom<T> {
  if (typeof valueOrGetter === "function") {
    return createDerivedAtom(valueOrGetter as AtomGetter<T>);
  }
  return createWritableAtom(valueOrGetter);
}

function createWritableAtom<T>(initial: T): WritableAtom<T> {
  const signal = new Signal<T>(initial);
  return {
    get() { return signal.get(); },
    set(value) { signal.set(value); },
    update(fn) { signal.set(fn(signal.peek())); },
    subscribe(listener) {
      createEffect(() => listener(signal.get()));
      return () => {};
    },
  };
}

function createDerivedAtom<T>(getter: AtomGetter<T>): DerivedAtom<T> {
  const getAtom = <U>(atom: Atom<U>): U => atom.get();
  const [value, setValue] = createSignal<T>(undefined as unknown as T);
  new Computation(() => { setValue(getter(getAtom)); });
  return {
    get() { return value(); },
    subscribe(listener) {
      createEffect(() => listener(value()));
      return () => {};
    },
  };
}

// ─── scopedRoot ───────────────────────────────────────────────────────────────

/**
 * Create a reactive root whose lifetime is bound to an Effect CloseableScope.
 *
 * When the scope closes, all reactive computations inside are disposed.
 * When the owner disposes, the scope is closed.
 *
 * @example
 * const program = Effect.gen(function* () {
 *   const scope = yield* Scope.make();
 *   scopedRoot(scope, () => {
 *     const [count, setCount] = createSignal(0);
 *     createEffect(() => console.log("count:", count()));
 *   });
 *   yield* Scope.close(scope, Exit.void);
 * });
 */
export function scopedRoot<T>(scope: Scope.CloseableScope, fn: () => T): T {
  const owner = new Owner(getOwner());

  // When the scope closes, dispose our reactive owner.
  Runtime.runFork(Runtime.defaultRuntime)(
    Scope.addFinalizer(scope, Effect.sync(() => owner.dispose())),
  );

  const result = runWithOwner(owner, fn);

  // When the owner is disposed (e.g. component unmount), close the scope.
  owner.addCleanup(() => {
    Runtime.runFork(Runtime.defaultRuntime)(
      Scope.close(scope, Exit.void),
    );
  });

  return result;
}

// ─── layerContext ─────────────────────────────────────────────────────────────

/**
 * Build an Effect Layer and expose its services to child components once ready.
 * Children render after the layer has initialised.
 *
 * @example
 * const AppLayer = Layer.mergeAll(DatabaseLive, HttpLive);
 * layerContext(AppLayer, () => <App />);
 */
export function layerContext<R, E, A>(
  layer: Layer.Layer<A, E, R>,
  fn: () => unknown,
  runtime: Runtime.Runtime<R> = Runtime.defaultRuntime as Runtime.Runtime<R>,
): unknown {
  const [ready, setReady] = createSignal(false);

  const buildProgram = pipe(
    Layer.launch(layer),
    Effect.catchAll((e: E) =>
      Effect.sync(() => {
        console.error("[effect-atom-jsx] Layer build failed:", e);
      }),
    ),
    Effect.map(() => { setReady(true); }),
    Effect.asVoid,
  );

  Runtime.runFork(runtime)(buildProgram);

  return {
    get children() {
      return ready() ? fn() : null;
    },
  };
}

// ─── Async ────────────────────────────────────────────────────────────────────

/**
 * Pattern-match on an AsyncResult for declarative async UI.
 *
 * @example
 * <Async
 *   result={user()}
 *   loading={() => <span>Loading…</span>}
 *   error={(e) => <span>Error: {String(e)}</span>}
 *   success={(u) => <span>Hello, {u.name}</span>}
 * />
 */
export function Async<A, E>(props: {
  result: AsyncResult<A, E>;
  loading?: () => unknown;
  error?: (err: E) => unknown;
  success: (value: A) => unknown;
}): unknown {
  const r = props.result;
  if (AsyncResult.isLoading(r)) return props.loading?.() ?? null;
  if (AsyncResult.isFailure(r)) return props.error?.(r.error) ?? null;
  return props.success(r.value);
}

// ─── For ──────────────────────────────────────────────────────────────────────

/** Reactive list rendering. */
export function For<T>(props: {
  each: T[] | (() => T[]);
  fallback?: () => unknown;
  children: (item: T, index: () => number) => unknown;
}): unknown {
  const list = typeof props.each === "function" ? props.each() : props.each;
  if (!list.length && props.fallback) return props.fallback();
  return list.map((item, i) => props.children(item, () => i));
}

// ─── Show ─────────────────────────────────────────────────────────────────────

/** Conditional rendering. */
export function Show<T>(props: {
  when: T | false | null | undefined | 0 | "";
  fallback?: () => unknown;
  children: ((value: T) => unknown) | unknown;
}): unknown {
  if (!props.when) return props.fallback?.() ?? null;
  if (typeof props.children === "function") {
    return (props.children as (v: T) => unknown)(props.when as T);
  }
  return props.children;
}
