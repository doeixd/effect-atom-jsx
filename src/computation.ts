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
 *   - `_owner`    : lifetime = Computation lifetime. Registered on parent Owner.
 *   - `_runOwner` : lifetime = single execution. Replaced before every re-run.
 *     onCleanup() calls inside the fn attach to _runOwner so they fire before
 *     the next execution (not just on final disposal).
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
  /** Per-run owner — disposed before every re-execution for cleanup support. */
  private _runOwner: Owner | null = null;
  private _disposed = false;
  private _running = false;

  /**
   * @param fn          - The reactive function to execute.
   * @param parentOwner - Owner that governs this computation's lifetime.
   * @param defer       - If true, skip the initial run (used by Memo so it can
   *                      set fields before the first execution).
   */
  constructor(
    fn: () => unknown,
    parentOwner: Owner | null = getOwner(),
    defer = false,
  ) {
    this._owner = new Owner(parentOwner);
    this._fn = fn;
    this._owner.addCleanup(() => this._dispose());
    if (!defer) this._run();
  }

  addDependency(signal: ISignal<unknown>): void {
    this._deps.add(signal);
  }

  invalidate(): void {
    if (this._disposed || this._running) return;
    this._cleanup();
    if (this._disposed) return; // re-check: _cleanup() may have triggered dispose
    this._run();
  }

  private _cleanup(): void {
    // Unsubscribe from all current dependencies.
    for (const dep of this._deps) {
      dep.removeSubscriber(this);
    }
    this._deps.clear();

    // Dispose the per-run sub-owner to fire onCleanup callbacks registered
    // during the previous run, and tear down nested effects/computations.
    if (this._runOwner !== null) {
      this._runOwner.dispose();
      this._runOwner = null;
    }
  }

  protected _run(): void {
    if (this._disposed) return;
    this._running = true;

    // Fresh per-run owner as a child of the lifetime owner.
    // onCleanup() inside _execute() attaches here.
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
 *
 * Only notifies its own downstream subscribers when the computed value
 * actually changes (per `equals`). The first run initialises the value
 * without notifying (no subscribers exist yet at construction time).
 */
export class Memo<T> extends Computation implements ISignal<T> {
  private _value: T | undefined = undefined;
  private _subscribers: Set<IComputation> = new Set();
  private _equals: EqualityFn<T>;
  private _initialized = false;

  constructor(
    fn: () => T,
    equals: EqualityFn<T> = defaultEquals as EqualityFn<T>,
    parentOwner: Owner | null = getOwner(),
  ) {
    // Defer the initial _run() so we can set _equals before the first execution.
    super(fn as () => unknown, parentOwner, /* defer = */ true);
    this._equals = equals;
    // Now run with _equals in place.
    this._run();
  }

  protected override _execute(): void {
    const next = (this._fn as () => T)();

    if (!this._initialized) {
      // First run: store the initial value. No subscribers to notify yet.
      this._initialized = true;
      this._value = next;
      return;
    }

    // Subsequent runs: notify only when the value actually changes.
    if (!this._equals(this._value as T, next)) {
      this._value = next;
      if (this._subscribers.size > 0) {
        for (const sub of [...this._subscribers]) {
          sub.invalidate();
        }
      }
    }
  }

  /** Read the memoised value; registers this memo as a dep of the caller. */
  get(): T {
    if (!this._initialized) {
      throw new Error("[effect-atom-jsx] Memo read before initialization (circular dependency?)");
    }
    const observer = getObserver();
    if (observer !== null) {
      this._subscribers.add(observer);
      observer.addDependency(this as ISignal<unknown>);
    }
    return this._value as T;
  }

  removeSubscriber(computation: IComputation): void {
    this._subscribers.delete(computation);
  }
}
