/**
 * computation.ts — Reactive computations (effects and memos).
 *
 * A Computation wraps a function `fn` that may read Signals. It:
 *   1. Runs `fn` under a tracking context so reads register deps.
 *   2. Subscribes to every Signal read.
 *   3. Re-runs when any dependency changes (invalidation).
 *   4. Before each re-run, disposes the previous run's sub-owner so that
 *      `onCleanup` callbacks registered during that run fire correctly.
 *   5. Disposes itself when its parent Owner is disposed.
 *
 * Per-run Owner model:
 *   - `_owner`    : lifetime = Computation lifetime. Owns _runOwner.
 *   - `_runOwner` : lifetime = single execution. Replaced each re-run.
 *     onCleanup calls inside the fn attach to _runOwner.
 *
 * Memo<T> extends Computation to cache its return value and expose a
 * getter — the canonical "derived signal" primitive.
 */

import { type IComputation, type ISignal, getObserver, setObserver } from "./tracking.js";
import { Owner, getOwner, runWithOwner } from "./owner.js";
import { defaultEquals, type EqualityFn } from "./signal.js";

export class Computation implements IComputation {
  protected _fn: () => unknown;
  protected _deps: Set<ISignal<unknown>> = new Set();
  /** Lifetime owner — tied to parent, governs entire computation lifetime. */
  protected _owner: Owner;
  /** Per-run owner — replaced before every re-execution for cleanup support. */
  private _runOwner: Owner | null = null;
  private _disposed = false;
  private _running = false;

  constructor(fn: () => unknown, parentOwner: Owner | null = getOwner()) {
    this._owner = new Owner(parentOwner);
    this._fn = fn;
    // When our lifetime owner is disposed, clean up computation.
    this._owner.addCleanup(() => this._dispose());
    this._run();
  }

  addDependency(signal: ISignal<unknown>): void {
    this._deps.add(signal);
  }

  invalidate(): void {
    if (this._disposed || this._running) return;
    this._cleanup();
    this._run();
  }

  private _cleanup(): void {
    // Remove this computation from all its current dependencies.
    for (const dep of this._deps) {
      dep.removeSubscriber(this);
    }
    this._deps.clear();

    // Dispose the previous run's sub-owner: fires onCleanup callbacks registered
    // during that run, and disposes any nested effects/computations created in it.
    if (this._runOwner !== null) {
      this._runOwner.dispose();
      this._runOwner = null;
    }
  }

  protected _run(): void {
    if (this._disposed) return;
    this._running = true;

    // Create a fresh per-run owner as a child of the lifetime owner.
    // onCleanup() calls during _execute() attach their callbacks here.
    this._runOwner = new Owner(this._owner);

    const prevObserver = setObserver(this);
    try {
      runWithOwner(this._runOwner, () => {
        try {
          this._execute();
        } catch (e) {
          console.error("[effect-atom-jsx] Unhandled error in reactive computation:", e);
        }
      });
    } finally {
      setObserver(prevObserver);
      this._running = false;
    }
  }

  protected _execute(): void {
    this._fn();
  }

  private _dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._cleanup();
  }

  get disposed(): boolean {
    return this._disposed;
  }
}

/**
 * Memo — a Computation that caches its return value.
 * Only notifies its own subscribers when the computed value actually changes.
 */
export class Memo<T> extends Computation implements ISignal<T> {
  private _value: T = undefined as unknown as T;
  private _subscribers: Set<IComputation> = new Set();
  private _equals: EqualityFn<T>;
  private _initialized = false;

  constructor(
    fn: () => T,
    equals: EqualityFn<T> = defaultEquals as EqualityFn<T>,
    parentOwner: Owner | null = getOwner(),
  ) {
    // Set _equals BEFORE super() so it's available when super calls _run → _execute.
    // We use a trick: store on a shared closure variable captured by the override.
    // Actually we need _equals on `this` before _execute runs. The cleanest fix:
    // don't call _run in super for Memo — instead defer it.
    //
    // We achieve this by temporarily overriding _fn to a no-op, then replacing it.
    super((() => {}) as () => unknown, parentOwner);
    this._equals = equals;
    this._fn = fn as () => unknown;
    // Now run for real (the super constructor ran a no-op).
    this._run();
  }

  protected override _execute(): void {
    const next = (this._fn as () => T)();
    if (!this._initialized || !this._equals(this._value, next)) {
      this._value = next;
      this._initialized = true;
      // Notify memo's own downstream subscribers.
      if (this._subscribers.size > 0) {
        for (const sub of [...this._subscribers]) {
          sub.invalidate();
        }
      }
    }
  }

  /** Read the memoised value; registers this memo as a dep of the caller. */
  get(): T {
    const observer = getObserver();
    if (observer !== null) {
      this._subscribers.add(observer);
      observer.addDependency(this as ISignal<unknown>);
    }
    return this._value;
  }

  removeSubscriber(computation: IComputation): void {
    this._subscribers.delete(computation);
  }
}
