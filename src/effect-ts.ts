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
  ManagedRuntime,
  ServiceMap,
  Scope,
  Layer,
  Option,
  Cause,
  pipe,
} from "effect";
import { Signal } from "./signal.js";
import { Computation } from "./computation.js";
import { Owner, getOwner, runWithOwner } from "./owner.js";
import { createSignal, createEffect, onCleanup, type Accessor, createContext, useContext, untrack } from "./api.js";
import { createMemo } from "./api.js";
import { render } from "./dom.js";

// ─── AsyncResult ──────────────────────────────────────────────────────────────

export type Loading = { readonly _tag: "Loading" };
export type Success<A> = { readonly _tag: "Success"; readonly value: A };
/** E is the typed failure from your Effect's error channel. */
export type Failure<E> = { readonly _tag: "Failure"; readonly error: E };
/** Defect wraps unexpected errors (bugs, interrupts) that aren't typed E. */
export type Defect = { readonly _tag: "Defect"; readonly cause: string };
export type Refreshing<A, E> = {
  readonly _tag: "Refreshing";
  readonly previous: Success<A> | Failure<E> | Defect;
};

export type AsyncResult<A, E> = Loading | Refreshing<A, E> | Success<A> | Failure<E> | Defect;

export const AsyncResult = {
  loading: { _tag: "Loading" } as Loading,
  refreshing: <A, E>(previous: Success<A> | Failure<E> | Defect): Refreshing<A, E> => ({ _tag: "Refreshing", previous }),
  success: <A>(value: A): Success<A> => ({ _tag: "Success", value }),
  failure: <E>(error: E): Failure<E> => ({ _tag: "Failure", error }),
  defect: (cause: string): Defect => ({ _tag: "Defect", cause }),
  isLoading: <A, E>(r: AsyncResult<A, E>): r is Loading => r._tag === "Loading",
  isRefreshing: <A, E>(r: AsyncResult<A, E>): r is Refreshing<A, E> => r._tag === "Refreshing",
  isSuccess: <A, E>(r: AsyncResult<A, E>): r is Success<A> => r._tag === "Success",
  isFailure: <A, E>(r: AsyncResult<A, E>): r is Failure<E> => r._tag === "Failure",
  isDefect: <A, E>(r: AsyncResult<A, E>): r is Defect => r._tag === "Defect",
} as const;

function previousFromResult<A, E>(
  result: AsyncResult<A, E>,
): Success<A> | Failure<E> | Defect | null {
  if (result._tag === "Refreshing") return result.previous;
  if (result._tag === "Success" || result._tag === "Failure" || result._tag === "Defect") return result;
  return null;
}

// ─── Ambient ManagedRuntime context ───────────────────────────────────────────

const ManagedRuntimeContext = createContext<ManagedRuntime.ManagedRuntime<unknown, unknown> | null>(null);

function getAmbientManagedRuntime(): ManagedRuntime.ManagedRuntime<unknown, unknown> | null {
  return useContext(ManagedRuntimeContext);
}

type RuntimeLike<R, ER = never> =
  | ServiceMap.ServiceMap<R>
  | ManagedRuntime.ManagedRuntime<R, ER>;

export type { RuntimeLike };

function runForkWithRuntime<R, A, E>(
  runtime: RuntimeLike<R, unknown> | undefined,
  effect: Effect.Effect<A, E, R>,
): Fiber.Fiber<A, E | unknown> {
  if (ManagedRuntime.isManagedRuntime(runtime)) {
    return runtime.runFork(effect);
  }
  if (runtime !== undefined) {
    return Effect.runForkWith(runtime as ServiceMap.ServiceMap<R>)(effect);
  }
  return Effect.runFork(effect as Effect.Effect<A, E, never>) as Fiber.Fiber<A, E | unknown>;
}

/**
 * Synchronously resolve a service from the ambient ManagedRuntime.
 *
 * The runtime is provided by `mount(...)`.
 */
export function use<I, S>(tag: ServiceMap.Key<I, S>): S {
  const runtime = getAmbientManagedRuntime();
  if (runtime === null) {
    throw new Error("[effect-atom-jsx] use(tag): no ambient ManagedRuntime found. Mount with mount(..., layer).");
  }
  return runtime.runSync(Effect.service(tag));
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
export function atomEffect<A, E, R>(
  fn: () => Effect.Effect<A, E, R>,
  ...runtime: [R] extends [never]
    ? [runtime?: RuntimeLike<R, unknown>]
    : [runtime: RuntimeLike<R, unknown>]
): Accessor<AsyncResult<A, E>> {
  const runtimeArg = runtime[0] as RuntimeLike<R, unknown> | undefined;
  const [result, setResult] = createSignal<AsyncResult<A, E>>(AsyncResult.loading);
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

  new Computation(() => {
    // Cancel any in-flight fiber from the previous run.
    interruptFiber();
    const previous = previousFromResult(untrack(result));
    if (previous === null) {
      setResult(AsyncResult.loading);
    } else {
      setResult(AsyncResult.refreshing(previous));
    }

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
          const typed = Cause.findErrorOption(cause);
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

    fiberRef = runForkWithRuntime(runtimeArg, wrapped as Effect.Effect<void, never, R>) as Fiber.Fiber<unknown, unknown>;
  });

  onCleanup(interruptFiber);

  return result;
}

/**
 * Like `atomEffect`, but uses the ambient ManagedRuntime from `mount(...)`
 * when available.
 *
 * If no ambient runtime is present, returns a `Defect` result with guidance
 * to use `mount(..., layer)` or `resourceWith(...)`.
 */
export function resource<A, E, R>(fn: () => Effect.Effect<A, E, R>): Accessor<AsyncResult<A, E>> {
  const ambient = getAmbientManagedRuntime();
  if (ambient === null) {
    const [result] = createSignal<AsyncResult<A, E>>(
      AsyncResult.defect(
        "[effect-atom-jsx] resource(fn) requires an ambient ManagedRuntime. Use mount(..., layer) or atomEffect(fn, runtime).",
      ),
    );
    return result;
  }
  return atomEffect(fn, ambient as unknown as RuntimeLike<R, unknown>);
}

/**
 * Explicit-runtime variant of `resource(...)` for non-mounted usage.
 */
export function resourceWith<A, E, R>(
  runtime: RuntimeLike<R, unknown>,
  fn: () => Effect.Effect<A, E, R>,
): Accessor<AsyncResult<A, E>> {
  return atomEffect(fn, runtime);
}

/**
 * Returns `true` while an `AsyncResult` accessor is revalidating.
 *
 * This is `false` during first-load `Loading`, and `true` for `Refreshing`.
 *
 * @example
 * const pending = isPending(userResult)
 * // pending() is true only when stale data is being revalidated
 */
export function isPending<A, E>(result: Accessor<AsyncResult<A, E>>): Accessor<boolean> {
  return createMemo(() => AsyncResult.isRefreshing(result()));
}

/**
 * Returns the latest successful value from an async result accessor.
 *
 * - `Success(value)` => `value`
 * - `Refreshing(Success(previous))` => `previous.value`
 * - otherwise => `undefined`
 *
 * @example
 * const userLatest = latest(userResult)
 * <Show when={userLatest()}>{(u) => <UserCard user={u()} />}</Show>
 */
export function latest<A, E>(result: Accessor<AsyncResult<A, E>>): Accessor<A | undefined> {
  return createMemo(() => {
    const current = result();
    if (current._tag === "Success") return current.value;
    if (current._tag === "Refreshing" && current.previous._tag === "Success") {
      return current.previous.value;
    }
    return undefined;
  });
}

// ─── Optimistic / actions ─────────────────────────────────────────────────────

export interface OptimisticRef<T> {
  get(): T;
  set(value: T | ((prev: T) => T)): void;
  clear(): void;
  isPending(): boolean;
}

/**
 * Create an optimistic overlay over a source accessor.
 *
 * While pending, reads come from the optimistic value. `clear()` drops the
 * overlay and resumes reads from `source`.
 */
export function createOptimistic<T>(source: Accessor<T>): OptimisticRef<T> {
  type Override = { readonly hasValue: false } | { readonly hasValue: true; readonly value: T };
  const [override, setOverride] = createSignal<Override>({ hasValue: false });

  return {
    get() {
      const current = override();
      return current.hasValue ? current.value : source();
    },
    set(value) {
      const prev = this.get();
      const next = typeof value === "function"
        ? (value as (x: T) => T)(prev)
        : value;
      setOverride({ hasValue: true, value: next });
    },
    clear() {
      setOverride({ hasValue: false });
    },
    isPending() {
      return override().hasValue;
    },
  };
}

export interface ActionEffectHandle<A, E> {
  run(input: A): void;
  result: Accessor<AsyncResult<void, E>>;
  pending: Accessor<boolean>;
}

export interface ActionEffectOptions<A, E, R> {
  runtime?: RuntimeLike<R, unknown>;
  optimistic?: (input: A) => void;
  rollback?: (input: A) => void;
  /**
   * Optional refresh hooks executed after successful mutation completion.
   * Accepts a single callback or an array of callbacks.
   */
  refresh?: (() => void) | ReadonlyArray<() => void>;
  onSuccess?: (input: A) => void;
  onFailure?: (error: E | { readonly defect: string }, input: A) => void;
}

function runRefreshHooks(refresh: ActionEffectOptions<any, any, any>["refresh"]): void {
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
 * @example
 * const save = actionEffect(saveTodo, {
 *   optimistic: (todo) => optimisticTodos.set((xs) => [todo, ...xs]),
 *   rollback: () => optimisticTodos.clear(),
 *   refresh: () => refreshTodos(),
 * })
 */
export function actionEffect<A, E, R>(
  fn: (input: A) => Effect.Effect<unknown, E, R>,
  options?: ActionEffectOptions<A, E, R>,
): ActionEffectHandle<A, E> {
  const [result, setResult] = createSignal<AsyncResult<void, E>>(AsyncResult.success(undefined));
  let fiberRef: Fiber.Fiber<unknown, unknown> | null = null;
  let runVersion = 0;

  const interrupt = (): void => {
    if (fiberRef !== null) {
      const f = fiberRef;
      fiberRef = null;
      Effect.runFork(Fiber.interrupt(f));
    }
  };

  const run = (input: A): void => {
    runVersion += 1;
    const version = runVersion;

    interrupt();

    options?.optimistic?.(input);

    const prev = previousFromResult(untrack(result));
    if (prev === null) {
      setResult(AsyncResult.loading);
    } else {
      setResult(AsyncResult.refreshing(prev));
    }

    const wrapped = pipe(
      fn(input),
      Effect.matchCause({
        onSuccess: (): void => {
          if (version !== runVersion) return;
          fiberRef = null;
          setResult(AsyncResult.success(undefined));
          runRefreshHooks(options?.refresh);
          options?.onSuccess?.(input);
        },
        onFailure: (cause: Cause.Cause<E>): void => {
          if (version !== runVersion) return;
          fiberRef = null;
          const typed = Cause.findErrorOption(cause);
          if (Option.isSome(typed)) {
            options?.rollback?.(input);
            options?.onFailure?.(typed.value, input);
            setResult(AsyncResult.failure(typed.value));
          } else {
            const defect = Cause.pretty(cause);
            options?.rollback?.(input);
            options?.onFailure?.({ defect }, input);
            setResult(AsyncResult.defect(defect));
          }
        },
      }),
    );

    fiberRef = runForkWithRuntime(options?.runtime, wrapped as Effect.Effect<void, never, R>) as
      Fiber.Fiber<unknown, unknown>;
  };

  onCleanup(interrupt);

  return {
    run,
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
export function scopedRoot<T>(scope: Scope.Closeable, fn: () => T): T {
  const owner = new Owner(getOwner());

  // Scope → reactive: when scope closes, dispose the owner.
  // addFinalizer is itself an Effect; run it as a fork so we can call
  // scopedRoot synchronously. The fork resolves immediately since
  // addFinalizer only registers and returns void.
  pipe(
    Scope.addFinalizer(scope, Effect.sync(() => owner.dispose())),
    Effect.catchCause((cause) =>
      Effect.sync(() =>
        console.error(
          "[effect-atom-jsx] scopedRoot: failed to register scope finalizer:",
          Cause.pretty(cause),
        ),
      ),
    ),
    (eff) => Effect.runFork(eff),
  );

  const result = runWithOwner(owner, fn);

  // Reactive → scope: when owner disposes, close the scope.
  owner.addCleanup(() => {
    pipe(
      Scope.close(scope, Exit.void),
      Effect.catchCause((cause) =>
        Effect.sync(() =>
          console.error(
            "[effect-atom-jsx] scopedRoot: failed to close scope:",
            Cause.pretty(cause),
          ),
        ),
      ),
      (eff) => Effect.runFork(eff),
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
  ...runtime: [RIn] extends [never]
    ? [runtime?: RuntimeLike<RIn, unknown>]
    : [runtime: RuntimeLike<RIn, unknown>]
): { readonly children: unknown } {
  const runtimeArg = runtime[0] as RuntimeLike<RIn, unknown> | undefined;
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal<E | null>(null);

  pipe(
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
 * The runtime is injected into the owner tree, making `use(tag)` and
 * `resource(...)` available anywhere under this mount.
 */
export function mount<R, E>(
  fn: () => unknown,
  container: Element,
  layer: Layer.Layer<R, E, never>,
): () => void {
  const managed = ManagedRuntime.make(layer);
  const disposeRender = render(
    () => ManagedRuntimeContext.Provider({
      value: managed as ManagedRuntime.ManagedRuntime<unknown, unknown>,
      children: fn(),
    }),
    container,
  );

  return () => {
    disposeRender();
    void managed.dispose().catch((err) => {
      console.error("[effect-atom-jsx] mount: failed to dispose ManagedRuntime:", err);
    });
  };
}

// ─── OO signal/computed API ───────────────────────────────────────────────────

export interface SignalRef<T> {
  get(): T;
  set(value: T | ((prev: T) => T)): void;
  update(fn: (prev: T) => T): void;
  subscribe(listener: (value: T) => void): () => void;
}

export interface ComputedRef<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

/**
 * Object-oriented signal API, analogous to Ref/SubscriptionRef ergonomics.
 */
export function signal<T>(initial: T): SignalRef<T> {
  const atom = createAtom(initial);
  return atom;
}

/**
 * Object-oriented derived value API, analogous to read-only computed refs.
 */
export function computed<T>(fn: () => T): ComputedRef<T> {
  const memo = createMemo(fn);
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
  refreshing?: (previous: Success<A> | Failure<E> | Defect) => unknown;
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
  return renderSettled(r);
}

function isAccessor<T>(u: unknown): u is Accessor<T> {
  return typeof u === "function";
}

function renderNode(node: unknown): unknown {
  return typeof node === "function" ? (node as () => unknown)() : node;
}

// ─── Loading / Errored ────────────────────────────────────────────────────────

function isLoadingInput(input: AsyncResult<unknown, unknown> | boolean): boolean {
  if (typeof input === "boolean") return input;
  return input._tag === "Loading";
}

/**
 * Declarative loading boundary.
 *
 * - With `AsyncResult`: shows `fallback` only during first `Loading`
 * - With `boolean`: shows `fallback` when `true`
 *
 * @example
 * <Loading when={todosResult} fallback={() => <Spinner />}>...</Loading>
 */
export function Loading(props: {
  when: AsyncResult<unknown, unknown> | boolean | Accessor<AsyncResult<unknown, unknown> | boolean>;
  fallback: () => unknown;
  children: unknown;
}): unknown {
  const whenValue = isAccessor<AsyncResult<unknown, unknown> | boolean>(props.when)
    ? props.when()
    : props.when;

  if (isLoadingInput(whenValue)) return props.fallback();
  return renderNode(props.children);
}

/**
 * Declarative error boundary for `AsyncResult`.
 *
 * @example
 * <Errored result={todosResult}>
 *   {(e) => <ErrorBanner message={"defect" in e ? e.defect : String(e)} />}
 * </Errored>
 */
export function Errored<A, E>(props: {
  result: AsyncResult<A, E> | Accessor<AsyncResult<A, E>>;
  fallback?: () => unknown;
  children: (error: E | { readonly defect: string }) => unknown;
}): unknown {
  const result = isAccessor<AsyncResult<A, E>>(props.result)
    ? props.result()
    : props.result;

  if (result._tag === "Failure") return props.children(result.error);
  if (result._tag === "Defect") return props.children({ defect: result.cause });
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
