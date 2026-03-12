import { Effect, Layer, ServiceMap } from "effect";
import { invalidateReactivityRuntime, trackReactivityRuntime, type ReactivityKeysInput } from "./reactivity-runtime.js";

export type ReactivityKey = string;

export interface ReactivityService {
  readonly invalidate: (keys: ReadonlyArray<ReactivityKey>) => Effect.Effect<void>;
  readonly subscribe: (
    keys: ReadonlyArray<ReactivityKey>,
    onInvalidate: () => void,
  ) => Effect.Effect<() => void>;
  readonly flush: () => Effect.Effect<void>;
  readonly lastInvalidated?: () => Effect.Effect<ReadonlyArray<ReactivityKey>>;
}

export const ReactivityTag = ServiceMap.Service<ReactivityService>("Reactivity");

/**
 * Mark an Effectful read as participating in Reactivity-driven dependency capture.
 *
 * Use this in service read methods so route loaders can `yield*` those methods
 * and still have single-flight refresh selection track the underlying data keys.
 */
export function tracked<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: { readonly keys?: ReactivityKeysInput },
): Effect.Effect<A, E, R> {
  const keys = options?.keys;
  if (keys === undefined) {
    return effect;
  }
  return Effect.sync(() => {
    trackReactivityRuntime(keys);
  }).pipe(Effect.flatMap(() => effect));
}

/**
 * Invalidate Reactivity keys after a successful mutation Effect.
 *
 * Use this in service write methods so mutations can stay domain-focused while
 * still driving single-flight loader refresh through the Reactivity runtime.
 */
export function invalidating<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  keys: ReactivityKeysInput | ((value: A) => ReactivityKeysInput),
): Effect.Effect<A, E, R> {
  return effect.pipe(
    Effect.tap((value) => Effect.sync(() => {
      const resolved = typeof keys === "function" ? keys(value) : keys;
      invalidateReactivityRuntime(resolved);
    })),
  );
}

function makeLive(options?: { readonly autoFlush?: boolean; readonly captureLastInvalidated?: boolean }): ReactivityService {
  const subscribers = new Map<ReactivityKey, Set<() => void>>();
  const pending = new Set<ReactivityKey>();
  let scheduled = false;
  let last: ReadonlyArray<ReactivityKey> = [];

  const flushNow = () => {
    if (pending.size === 0) {
      scheduled = false;
      return;
    }

    const keys = [...pending];
    pending.clear();
    scheduled = false;
    if (options?.captureLastInvalidated) {
      last = keys;
    }

    const callbacks = new Set<() => void>();
    for (const key of keys) {
      for (const cb of subscribers.get(key) ?? []) {
        callbacks.add(cb);
      }
    }
    for (const cb of callbacks) cb();
  };

  const schedule = () => {
    if (!options?.autoFlush) return;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flushNow);
  };

  return {
    invalidate: (keys) => Effect.sync(() => {
      for (const key of keys) pending.add(key);
      schedule();
    }),
    subscribe: (keys, onInvalidate) => Effect.sync(() => {
      for (const key of keys) {
        const set = subscribers.get(key) ?? new Set<() => void>();
        set.add(onInvalidate);
        subscribers.set(key, set);
      }

      return () => {
        for (const key of keys) {
          const set = subscribers.get(key);
          if (!set) continue;
          set.delete(onInvalidate);
          if (set.size === 0) subscribers.delete(key);
        }
      };
    }),
    flush: () => Effect.sync(() => {
      flushNow();
    }),
    lastInvalidated: options?.captureLastInvalidated
      ? () => Effect.sync(() => last)
      : undefined,
  };
}

export const live: Layer.Layer<ReactivityService> = Layer.succeed(ReactivityTag, makeLive({ autoFlush: true }));

export const test: Layer.Layer<ReactivityService> = Layer.succeed(
  ReactivityTag,
  makeLive({ autoFlush: false, captureLastInvalidated: true }),
);

export const Reactivity = {
  Tag: ReactivityTag,
  live,
  test,
  tracked,
  invalidating,
} as const;
