/**
 * effect-ts.ts — Effect-TS integration layer.
 *
 * Bridges the synchronous reactive core with Effect-TS's structured
 * concurrency, typed errors, and dependency injection.
 *
 * ## Key primitives
 *
 * ### `atomEffect(fn, runtime?)`
 * Creates a `Signal<AsyncResult<A, E>>` driven by an Effect returned from `fn`.
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
 * // user() → AsyncResult<User, FetchError>
 * ```
 *
 * ### `createAtom(value | getter)`
 * Jotai-style atom API built on the reactive core.
 *
 * ### `scopedRoot(scope, fn)`
 * Binds a reactive Owner to an Effect CloseableScope for bidirectional cleanup.
 *
 * ### `layerContext(layer, fn)`
 * Builds an Effect Layer async, renders children once services are ready.
 */

import {
  Effect,
  Exit,
  Fiber,
  Runtime,
  Scope,
  Layer,
  Option,
  Cause,
  pipe,
} from "effect";
import { Signal } from "./signal.js";
import { Computation } from "./computation.js";
import { Owner, getOwner, runWithOwner } from "./owner.js";
import { createSignal, createEffect, onCleanup, type Accessor } from "./api.js";
import { createMemo } from "./api.js";

// ─── AsyncResult ──────────────────────────────────────────────────────────────

export type Loading = { readonly _tag: "Loading" };
export type Success<A> = { readonly _tag: "Success"; readonly value: A };
/** E is the typed failure from your Effect's error channel. */
export type Failure<E> = { readonly _tag: "Failure"; readonly error: E };
/** Defect wraps unexpected errors (bugs, interrupts) that aren't typed E. */
export type Defect = { readonly _tag: "Defect"; readonly cause: string };

export type AsyncResult<A, E> = Loading | Success<A> | Failure<E> | Defect;

export const AsyncResult = {
  loading: { _tag: "Loading" } as Loading,
  success: <A>(value: A): Success<A> => ({ _tag: "Success", value }),
  failure: <E>(error: E): Failure<E> => ({ _tag: "Failure", error }),
  defect: (cause: string): Defect => ({ _tag: "Defect", cause }),
  isLoading: <A, E>(r: AsyncResult<A, E>): r is Loading => r._tag === "Loading",
  isSuccess: <A, E>(r: AsyncResult<A, E>): r is Success<A> => r._tag === "Success",
  isFailure: <A, E>(r: AsyncResult<A, E>): r is Failure<E> => r._tag === "Failure",
  isDefect: <A, E>(r: AsyncResult<A, E>): r is Defect => r._tag === "Defect",
} as const;

// ─── atomEffect ───────────────────────────────────────────────────────────────

/**
 * Create a reactive signal driven by an Effect computation.
 *
 * `fn` is called **synchronously** inside a Computation, so signal reads
 * inside `fn()` register as reactive dependencies. When any dep changes,
 * the running fiber is interrupted via structured concurrency and `fn` is
 * called again to build a fresh Effect.
 *
 * The signal value is `AsyncResult<A, E>` — starts as `Loading`, transitions
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
export function atomEffect<A, E, R = never>(
  fn: () => Effect.Effect<A, E, R>,
  runtime: Runtime.Runtime<R> = Runtime.defaultRuntime as unknown as Runtime.Runtime<R>,
): Accessor<AsyncResult<A, E>> {
  const [result, setResult] = createSignal<AsyncResult<A, E>>(AsyncResult.loading);
  // Stored as unknown to avoid TS variance complaints when interrupting.
  let fiberRef: Fiber.RuntimeFiber<unknown, unknown> | null = null;

  const interruptFiber = (): void => {
    if (fiberRef !== null) {
      const f = fiberRef;
      fiberRef = null;
      // Best-effort interrupt: fire-and-forget is intentional here since we
      // only need cancellation, not the interrupt result.
      Runtime.runFork(Runtime.defaultRuntime)(Fiber.interrupt(f));
    }
  };

  new Computation(() => {
    // Cancel any in-flight fiber from the previous run.
    interruptFiber();
    setResult(AsyncResult.loading);

    // Call fn() synchronously — this is where reactive deps are tracked.
    const effect = fn();

    // Wrap into a void effect that writes to the signal on completion.
    const wrapped = pipe(
      effect,
      Effect.matchCause({
        onSuccess: (value: A): void => {
          fiberRef = null;
          setResult(AsyncResult.success(value));
        },
        onFailure: (cause: Cause.Cause<E>): void => {
          fiberRef = null;
          const typed = Cause.failureOption(cause);
          if (Option.isSome(typed)) {
            // Typed error from the Effect's error channel (E).
            setResult(AsyncResult.failure(typed.value));
          } else {
            // Defect (unexpected exception) or fiber interrupt.
            setResult(AsyncResult.defect(Cause.pretty(cause)));
          }
        },
      }),
    );

    fiberRef = Runtime.runFork(runtime)(wrapped as Effect.Effect<void, never, R>) as
      Fiber.RuntimeFiber<unknown, unknown>;
  });

  onCleanup(interruptFiber);

  return result;
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

export function createAtom<T>(value: T): WritableAtom<T>;
export function createAtom<T>(getter: AtomGetter<T>): DerivedAtom<T>;
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
export function scopedRoot<T>(scope: Scope.CloseableScope, fn: () => T): T {
  const owner = new Owner(getOwner());

  // Scope → reactive: when scope closes, dispose the owner.
  // addFinalizer is itself an Effect; run it as a fork so we can call
  // scopedRoot synchronously. The fork resolves immediately since
  // addFinalizer only registers and returns void.
  pipe(
    Scope.addFinalizer(scope, Effect.sync(() => owner.dispose())),
    Effect.catchAllCause((cause) =>
      Effect.sync(() =>
        console.error(
          "[effect-atom-jsx] scopedRoot: failed to register scope finalizer:",
          Cause.pretty(cause),
        ),
      ),
    ),
    (eff) => Runtime.runFork(Runtime.defaultRuntime)(eff),
  );

  const result = runWithOwner(owner, fn);

  // Reactive → scope: when owner disposes, close the scope.
  owner.addCleanup(() => {
    pipe(
      Scope.close(scope, Exit.void),
      Effect.catchAllCause((cause) =>
        Effect.sync(() =>
          console.error(
            "[effect-atom-jsx] scopedRoot: failed to close scope:",
            Cause.pretty(cause),
          ),
        ),
      ),
      (eff) => Runtime.runFork(Runtime.defaultRuntime)(eff),
    );
  });

  return result;
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
  runtime: Runtime.Runtime<RIn> = Runtime.defaultRuntime as unknown as Runtime.Runtime<RIn>,
): { readonly children: unknown } {
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal<E | null>(null);

  pipe(
    Layer.launch(layer),
    Effect.matchCause({
      onSuccess: (): void => { setReady(true); },
      onFailure: (cause: Cause.Cause<E>): void => {
        const typed = Cause.failureOption(cause);
        if (Option.isSome(typed)) {
          setError(typed.value);
        } else {
          console.error("[effect-atom-jsx] layerContext: layer build failed:", Cause.pretty(cause));
        }
      },
    }),
    (eff) => Runtime.runFork(runtime)(eff as Effect.Effect<void, never, RIn>),
  );

  return {
    get children() {
      if (error()) return null;
      return ready() ? fn() : null;
    },
  };
}

// ─── Async ────────────────────────────────────────────────────────────────────

/**
 * Declarative pattern-match on an `AsyncResult` for async UI.
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
  result: AsyncResult<A, E>;
  loading?: () => unknown;
  error?: (err: E) => unknown;
  defect?: (cause: string) => unknown;
  success: (value: A) => unknown;
}): unknown {
  const r = props.result;
  if (r._tag === "Loading") return props.loading?.() ?? null;
  if (r._tag === "Failure") return props.error?.(r.error) ?? null;
  if (r._tag === "Defect") return props.defect?.(r.cause) ?? null;
  return props.success(r.value);
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
