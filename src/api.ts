/**
 * api.ts — Public reactive API.
 *
 * Mirrors the Solid.js reactive API surface so that the
 * babel-plugin-jsx-dom-expressions output works without modification.
 */

import { Signal, type EqualityFn } from "./signal.js";
import { Computation, Memo } from "./computation.js";
import { Owner, getOwner, runWithOwner } from "./owner.js";
import { runUntracked, runBatch, flush as flushComputations } from "./tracking.js";

// ─── Signals ──────────────────────────────────────────────────────────────────

export type Accessor<T> = () => T;
export type Setter<T> = (value: T | ((prev: T) => T)) => void;
export type SignalOptions<T> = { equals?: EqualityFn<T> | false; name?: string };

/**
 * Create a reactive signal (atom).
 *
 * @returns [read, write] — `read()` tracks, `write(v)` notifies.
 *
 * @example
 * const [count, setCount] = createSignal(0);
 * createEffect(() => console.log(count())); // logs on every change
 * setCount(1);
 */
export function createSignal<T>(
  value: T,
  options?: SignalOptions<T>,
): [Accessor<T>, Setter<T>] {
  const equals =
    options?.equals === false
      ? (() => false) as EqualityFn<T>
      : options?.equals;
  const signal = new Signal(value, equals);
  return [() => signal.get(), (next) => signal.set(next)];
}

// ─── Effects ──────────────────────────────────────────────────────────────────

/**
 * Create a reactive side-effect. `fn` runs immediately and re-runs whenever
 * any signal read inside it changes.
 *
 * Cleanup functions returned by `fn` (or registered via `onCleanup`) are
 * called before each re-run and on disposal.
 */
export function createEffect<T>(fn: (prev: T | undefined) => T, initialValue?: T): void {
  let prev: T | undefined = initialValue;
  new Computation(() => {
    prev = fn(prev);
  });
}

/**
 * Create a reactive side-effect that can also be disposed explicitly.
 *
 * Behaves exactly like {@link createEffect} with respect to ownership — the
 * reaction is created under a dedicated {@link Owner} parented to the ambient
 * owner, so a render owner still tears it down — but additionally returns a
 * dispose function for callers whose lifetime is governed by something other
 * than the reactive owner tree (e.g. an Effect `Scope`).
 *
 * Disposal is idempotent and safe to combine with owner-driven disposal:
 * whichever happens first wins, and the second is a no-op.
 *
 * @example
 * const dispose = createDisposableEffect(() => console.log(count()));
 * dispose(); // stops recomputing
 */
export function createDisposableEffect<T>(
  fn: (prev: T | undefined) => T,
  initialValue?: T,
): () => void {
  const owner = new Owner(getOwner());
  runWithOwner(owner, () => {
    createEffect(fn, initialValue);
  });
  // `Owner.dispose()` guards on its own `_disposed` flag and detaches itself
  // from its parent, so an explicit dispose after (or before) owner-driven
  // disposal runs the computation teardown exactly once.
  return () => owner.dispose();
}

/**
 * Register a cleanup callback that runs before the next effect execution
 * or when the current owner is disposed.
 */
export function onCleanup(fn: () => void): void {
  getOwner()?.addCleanup(fn);
}

/**
 * Register a callback that runs once, after the component has mounted.
 * (Schedules via microtask so the DOM is fully initialised.)
 */
export function onMount(fn: () => void): void {
  const owner = getOwner();
  queueMicrotask(() => {
    if (owner && !owner.disposed) {
      runWithOwner(owner, fn);
    }
  });
}

// ─── Memos ────────────────────────────────────────────────────────────────────

/**
 * Create a derived reactive value. Caches the result and only re-notifies
 * downstream when the value actually changes (per `equals`).
 *
 * @example
 * const doubled = createMemo(() => count() * 2);
 */
export function createMemo<T>(fn: () => T, options?: SignalOptions<T>): Accessor<T> {
  const equals =
    options?.equals === false
      ? (() => false) as EqualityFn<T>
      : options?.equals;
  const memo = new Memo(fn, equals);
  return () => memo.get();
}

// ─── Untracked / Batch ────────────────────────────────────────────────────────

/**
 * Run `fn` without tracking its signal reads as dependencies.
 * Alias: `sample`.
 */
export function untrack<T>(fn: () => T): T {
  return runUntracked(fn);
}

export const sample = untrack;

/**
 * Batch multiple signal writes into a single flush.
 * Useful to avoid intermediate renders when updating several signals at once.
 *
 * @example
 * batch(() => { setX(1); setY(2); }); // one update, not two
 */
export function batch<T>(fn: () => T): T {
  return runBatch(fn);
}

/**
 * Flush queued reactive invalidations immediately.
 *
 * Useful when microtask batching is enabled and imperative code needs
 * deterministic DOM/update ordering.
 */
export function flush(): void {
  flushComputations();
}

// ─── Owner / Root ─────────────────────────────────────────────────────────────

export { getOwner, runWithOwner } from "./owner.js";

/**
 * Create a reactive root — an ownership scope that disposes all child
 * computations when the returned `dispose` function is called.
 *
 * Components are wrapped in a root implicitly by `createComponent`.
 *
 * @example
 * const dispose = createRoot(d => {
 *   createEffect(() => console.log(count()));
 *   return d; // expose dispose
 * });
 * dispose(); // cleans up the effect
 */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const owner = new Owner(getOwner());
  return runWithOwner(owner, () => fn(() => owner.dispose()));
}

// ─── Context ──────────────────────────────────────────────────────────────────

export interface Context<T> {
  id: symbol;
  defaultValue: T;
  Provider: (props: { value: T; children: unknown }) => unknown;
}

export const contextMap = new WeakMap<Owner, Map<symbol, unknown>>();

function getContextMap(owner: Owner): Map<symbol, unknown> {
  let map = contextMap.get(owner);
  if (!map) {
    map = new Map();
    contextMap.set(owner, map);
  }
  return map;
}

export function createContext<T>(defaultValue: T): Context<T> {
  const id = Symbol("context");
  const ctx: Context<T> = {
    id,
    defaultValue,
    Provider(props: { value: T; children: unknown }) {
      const owner = getOwner();
      if (owner) {
        getContextMap(owner).set(id, props.value);
      }
      return props.children;
    },
  };
  return ctx;
}

export function useContext<T>(ctx: Context<T>): T {
  let owner = getOwner();
  while (owner !== null) {
    const map = contextMap.get(owner);
    if (map?.has(ctx.id)) {
      return map.get(ctx.id) as T;
    }
    // Walk up to the parent Owner (exposed via `owner.parent` accessor).
    owner = owner.parent;
  }
  return ctx.defaultValue;
}

// ─── Props helpers ────────────────────────────────────────────────────────────

export type PropsSource =
  | object
  | (() => object | null | undefined)
  | null
  | undefined;

type ResolvedPropsSource<Source> =
  Source extends () => infer Value
    ? NonNullable<Value>
    : NonNullable<Source>;

type PropsSourceValue<Source> =
  [ResolvedPropsSource<Source>] extends [never]
    ? {}
    : ResolvedPropsSource<Source> extends object
      ? ResolvedPropsSource<Source>
      : {};

type Simplify<Value> = { [Key in keyof Value]: Value[Key] } & {};

type MergePropSources<
  Sources extends ReadonlyArray<PropsSource>,
  Accumulator extends object = {},
> = Sources extends readonly [
  infer Source extends PropsSource,
  ...infer Rest extends ReadonlyArray<PropsSource>,
]
  ? MergePropSources<
    Rest,
    Simplify<
      Omit<Accumulator, keyof PropsSourceValue<Source>>
      & PropsSourceValue<Source>
    >
  >
  : Accumulator;

export type MergePropsResult<Sources extends ReadonlyArray<PropsSource>> =
  Simplify<MergePropSources<Sources>>;

/**
 * Merge prop sources into one live, last-source-wins view.
 *
 * The JSX compiler passes reactive spreads as function sources. Those sources
 * may change both values and keys, so eagerly copying them would silently drop
 * the spread and disconnect it from reactivity. Static sources retain the
 * cheaper descriptor-copy path; function sources use a memoized proxy whose
 * key set is resolved on demand.
 */
export function mergeProps<const Sources extends ReadonlyArray<PropsSource>>(
  ...sources: Sources
): MergePropsResult<Sources>;
export function mergeProps(
  ...sources: ReadonlyArray<PropsSource>
): object {
  const hasDynamicSource = sources.some((source) => typeof source === "function");
  if (!hasDynamicSource) {
    const result: Record<PropertyKey, unknown> = {};
    for (const source of sources) {
      if (source == null) continue;
      const staticSource = source as Record<PropertyKey, unknown>;
      for (const key of Object.keys(staticSource)) {
        if (key === "__proto__" || key === "constructor") continue;
        const descriptor = Object.getOwnPropertyDescriptor(staticSource, key);
        if (descriptor === undefined) continue;
        if (descriptor.get !== undefined) {
          Object.defineProperty(result, key, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: descriptor.get.bind(staticSource),
          });
        } else {
          Object.defineProperty(result, key, {
            ...descriptor,
            configurable: true,
          });
        }
      }
    }
    return result;
  }

  const liveSources = sources.map((source): (() => object) => {
    if (typeof source !== "function") {
      return () => source ?? {};
    }
    const resolved = createMemo(
      source as () => object | null | undefined,
    );
    return () => resolved() ?? {};
  });
  const resolveValue = (property: PropertyKey): unknown => {
    for (let index = liveSources.length - 1; index >= 0; index--) {
      const source = liveSources[index]!();
      if (Reflect.has(source, property)) return Reflect.get(source, property);
    }
    return undefined;
  };

  return new Proxy({}, {
    get: (_target, property) => resolveValue(property),
    has: (_target, property) =>
      liveSources.some((resolve) => Reflect.has(resolve(), property)),
    ownKeys: () => {
      const keys = new Set<string | symbol>();
      for (const resolve of liveSources) {
        for (const key of Reflect.ownKeys(resolve())) keys.add(key);
      }
      return [...keys];
    },
    getOwnPropertyDescriptor: (_target, property) => {
      for (let index = liveSources.length - 1; index >= 0; index--) {
        const source = liveSources[index]!();
        const descriptor = Reflect.getOwnPropertyDescriptor(source, property);
        if (descriptor !== undefined) {
          return {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: () => resolveValue(property),
          };
        }
      }
      return undefined;
    },
  });
}

export function splitProps<T extends object, K extends keyof T>(
  props: T,
  keys: K[],
): [Pick<T, K>, Omit<T, K>] {
  const keySet = new Set(keys as string[]);
  const left = {} as Pick<T, K>;
  const right = {} as Omit<T, K>;
  for (const key of Object.keys(props) as (keyof T)[]) {
    const descriptor = Object.getOwnPropertyDescriptor(props, key)!;
    const target = keySet.has(key as string) ? left : right;
    if (descriptor.get) {
      Object.defineProperty(target, key, { get: descriptor.get, enumerable: true });
    } else {
      (target as Record<keyof T, unknown>)[key] = props[key];
    }
  }
  return [left, right];
}
