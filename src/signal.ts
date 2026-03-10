/**
 * signal.ts — The reactive primitive that stores state.
 *
 * A Signal<T> is an observable box. Reading it inside a tracked context
 * (Computation.run) registers a dependency. Writing it notifies all
 * current subscribers so they can re-run.
 */

import {
  type IComputation,
  type ISignal,
  getObserver,
  enqueueComputation,
} from "./tracking.js";

export type EqualityFn<T> = (a: T, b: T) => boolean;

export const defaultEquals: EqualityFn<unknown> = (a, b) => a === b;

export class Signal<T> implements ISignal<T> {
  private _value: T;
  private _subscribers: Set<IComputation> = new Set();
  private _equals: EqualityFn<T>;

  constructor(value: T, equals: EqualityFn<T> = defaultEquals as EqualityFn<T>) {
    this._value = value;
    this._equals = equals;
  }

  /** Read the current value, registering as a dependency if inside a tracked context. */
  get(): T {
    const observer = getObserver();
    if (observer !== null) {
      this._subscribers.add(observer);
      observer.addDependency(this as unknown as ISignal<unknown>);
    }
    return this._value;
  }

  /** Write a new value; notify subscribers if the value changed. */
  set(next: T | ((prev: T) => T)): void {
    const value =
      typeof next === "function"
        ? (next as (prev: T) => T)(this._value)
        : next;

    if (this._equals(this._value, value)) return;
    this._value = value;
    this._notify();
  }

  /** Force-write without equality check (useful for objects/arrays). */
  forceSet(value: T): void {
    this._value = value;
    this._notify();
  }

  /** Read without tracking (never registers a dependency). */
  peek(): T {
    return this._value;
  }

  removeSubscriber(computation: IComputation): void {
    this._subscribers.delete(computation);
  }

  private _notify(): void {
    if (this._subscribers.size === 0) return;

    for (const sub of this._subscribers) {
      enqueueComputation(sub);
    }
  }
}
