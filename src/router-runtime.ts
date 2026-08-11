import { Context, Effect, Fiber, Layer, Schema } from "effect";
import { Result as CoreResult, type Result as CoreResultType } from "./effect-ts.js";
import { makeResourceCacheIdentity } from "./cache-identity.js";
import {
  beginReactivityReadCapture,
  getInstalledReactivityService,
  onReactivityInvalidation,
  onReactivityServiceChange,
  invalidateReactivityRuntime,
  normalizeReactivityKeys,
  type ReactivityKeysInput,
} from "./reactivity-runtime.js";

export type DurationInput = number | string | undefined;

export interface LoaderCacheEntry {
  readonly key: string;
  readonly routeId: string;
  readonly paramsKey: string;
  readonly result: CoreResultType<unknown, unknown>;
  readonly updatedAt: number;
  readonly staleAt: number;
  readonly expiresAt: number;
  readonly reactivityKeys: ReadonlyArray<string>;
}

export interface LoaderSelection {
  readonly component: unknown;
  readonly routeId: string;
  readonly reactivityKeys: ReadonlyArray<string>;
}

// ─── Loader cache store (injectable, no module-global cache) ─────────────────
//
// R2: the loader cache is a *value*. A process-wide default store preserves
// today's client behavior (one cache per browser document), while a server
// render creates one store per request so concurrent renders never observe each
// other's loader data. Effect call sites resolve the store from context
// (`LoaderCacheTag`); synchronous call sites resolve it from the ambient store
// installed by `runInLoaderCacheStore` (the same dynamic-scope mechanism the
// resume session uses), falling back to the default store.

/** A loader cache instance: entries plus its reactivity-key indexes. */
export interface LoaderCacheStore {
  readonly cache: Map<string, LoaderCacheEntry>;
  readonly reactivityToCache: Map<string, Set<string>>;
  readonly reactivitySubscriptions: Map<string, () => void>;
  /**
   * At most one in-flight SWR refresh per cache key (`DQ-032`): a second
   * stale read joins the running refresh instead of starting a duplicate,
   * which removes the last-write-wins race between two refreshes of one key.
   */
  readonly inFlightRefreshes: Map<string, Fiber.Fiber<unknown, unknown>>;
  /** Set once {@link LoaderCacheStore.dispose} has run; refuses late writes. */
  disposed: boolean;
  /**
   * Close the store (`DQ-032`, the cache-store-scope half): interrupts every
   * in-flight refresh and refuses any later write. On the server this is the
   * response being sent — a refresh that outlives it would write into a store
   * nobody will ever read, holding the request's data alive behind it.
   */
  dispose(): void;
}

// Live stores are tracked weakly: reactivity invalidation must reach every
// store that is still in use, without pinning per-request stores in memory.
const trackedStores = new Set<WeakRef<LoaderCacheStore>>();

function forEachLoaderCacheStore(f: (store: LoaderCacheStore) => void): void {
  for (const ref of [...trackedStores]) {
    const store = ref.deref();
    if (store === undefined) {
      trackedStores.delete(ref);
      continue;
    }
    f(store);
  }
}

/** Create an isolated loader cache store (one per server request, typically). */
export function makeLoaderCacheStore(): LoaderCacheStore {
  const store: LoaderCacheStore = {
    cache: new Map(),
    reactivityToCache: new Map(),
    reactivitySubscriptions: new Map(),
    inFlightRefreshes: new Map(),
    disposed: false,
    dispose: () => {
      if (store.disposed) return;
      store.disposed = true;
      for (const fiber of store.inFlightRefreshes.values()) {
        Effect.runFork(Fiber.interrupt(fiber));
      }
      store.inFlightRefreshes.clear();
      for (const unsubscribe of store.reactivitySubscriptions.values()) {
        unsubscribe();
      }
      store.reactivitySubscriptions.clear();
    },
  };
  trackedStores.add(new WeakRef(store));
  return store;
}

/** The process-wide default store; this is the client/document-level cache. */
export const defaultLoaderCacheStore: LoaderCacheStore = makeLoaderCacheStore();

/** Injectable loader cache service. */
export const LoaderCacheTag = Context.Service<LoaderCacheStore>("LoaderCache");

/**
 * Ambient supervisor for SWR refresh fibers (`DQ-032`, the navigation-scope
 * half): a router runtime provides this so refreshes started under one
 * navigation can be interrupted when a later navigation supersedes them. The
 * cache-store scope still bounds the write either way.
 */
export interface SwrRefreshSupervisor {
  readonly register: (fiber: Fiber.Fiber<unknown, unknown>) => void;
}

export const SwrRefreshSupervisorTag =
  Context.Service<SwrRefreshSupervisor>("SwrRefreshSupervisor");

/**
 * Default loader-cache layer: the process-wide store, i.e. exactly today's
 * client behavior. Pass a store to scope the cache (per request, per test).
 */
export function loaderCacheLayer(store: LoaderCacheStore = defaultLoaderCacheStore): Layer.Layer<LoaderCacheStore> {
  return Layer.succeed(LoaderCacheTag, store);
}

let ambientLoaderCacheStore: LoaderCacheStore | undefined;

/**
 * Install `store` as the ambient loader cache for the duration of a
 * synchronous evaluation (server render). Nested/synchronous call sites that
 * cannot read Effect context resolve through this.
 */
export function runInLoaderCacheStore<A>(store: LoaderCacheStore, evaluate: () => A): A {
  const previous = ambientLoaderCacheStore;
  ambientLoaderCacheStore = store;
  try {
    return evaluate();
  } finally {
    ambientLoaderCacheStore = previous;
  }
}

/** Resolve the loader cache for synchronous call sites. */
export function resolveLoaderCacheStore(store?: LoaderCacheStore): LoaderCacheStore {
  return store ?? ambientLoaderCacheStore ?? defaultLoaderCacheStore;
}

/**
 * Resolve the loader cache inside an Effect: the provided service wins, then
 * the ambient store, then the default store. Never adds a requirement, so
 * loader plumbing keeps its `R = never` signatures.
 */
export const currentLoaderCacheStore: Effect.Effect<LoaderCacheStore> = Effect.serviceOption(LoaderCacheTag).pipe(
  Effect.map((option) => (option._tag === "Some" ? option.value : resolveLoaderCacheStore())),
);

function markStaleByReactivityKey(store: LoaderCacheStore, key: string): void {
  const cacheKeys = store.reactivityToCache.get(key);
  if (!cacheKeys) return;
  for (const cacheKey of cacheKeys) {
    const existing = store.cache.get(cacheKey);
    if (!existing) continue;
    store.cache.set(cacheKey, { ...existing, staleAt: 0 });
  }
}

function ensureReactivitySubscription(store: LoaderCacheStore, key: string): void {
  if (store.reactivitySubscriptions.has(key)) return;
  const service = getInstalledReactivityService();
  if (service === null) return;
  const unsubscribe = Effect.runSync(service.subscribe([key], () => {
    markStaleByReactivityKey(store, key);
  }));
  store.reactivitySubscriptions.set(key, unsubscribe);
}

function resetReactivitySubscriptions(store: LoaderCacheStore): void {
  for (const unsubscribe of store.reactivitySubscriptions.values()) {
    unsubscribe();
  }
  store.reactivitySubscriptions.clear();
  for (const key of store.reactivityToCache.keys()) {
    ensureReactivitySubscription(store, key);
  }
}

onReactivityServiceChange(() => {
  forEachLoaderCacheStore(resetReactivitySubscriptions);
});

onReactivityInvalidation((keys) => {
  forEachLoaderCacheStore((store) => {
    for (const key of keys) {
      markStaleByReactivityKey(store, key);
    }
  });
});

export function durationToMillis(input: DurationInput, fallbackMs: number): number {
  if (typeof input === "number") return input;
  if (typeof input !== "string") return fallbackMs;
  const s = input.trim().toLowerCase();
  const m = s.match(/^(\d+)\s*(ms|millis|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/);
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit.startsWith("ms") || unit.startsWith("milli")) return n;
  if (unit === "s" || unit.startsWith("sec") || unit.startsWith("second")) return n * 1000;
  if (unit === "m" || unit.startsWith("min") || unit.startsWith("minute")) return n * 60_000;
  if (unit === "h" || unit.startsWith("hr") || unit.startsWith("hour")) return n * 3_600_000;
  return fallbackMs;
}

export function makeLoaderCacheKey(routeId: string, params: unknown): { readonly key: string; readonly paramsKey: string } {
  const identity = makeResourceCacheIdentity(routeId, params ?? {});
  return {
    key: identity.key,
    paramsKey: identity.parametersKey,
  };
}

export function getLoaderCacheEntry(routeId: string, params: unknown, store?: LoaderCacheStore): LoaderCacheEntry | undefined {
  const target = resolveLoaderCacheStore(store);
  const { key } = makeLoaderCacheKey(routeId, params);
  const found = target.cache.get(key);
  if (!found) return undefined;
  if (Date.now() > found.expiresAt) {
    target.cache.delete(key);
    return undefined;
  }
  return found;
}

export function isFresh(entry: LoaderCacheEntry): boolean {
  // Strict: `staleTime: 0` means immediately stale, including reads landing
  // in the same millisecond as the write.
  return Date.now() < entry.staleAt;
}

export function setLoaderCacheEntry(routeId: string, params: unknown, result: CoreResultType<unknown, unknown>, options?: {
  readonly staleTime?: DurationInput;
  readonly cacheTime?: DurationInput;
  readonly reactivityKeys?: ReactivityKeysInput;
}, store?: LoaderCacheStore): LoaderCacheEntry {
  const target = resolveLoaderCacheStore(store);
  const now = Date.now();
  const staleTime = durationToMillis(options?.staleTime, 0);
  const cacheTime = durationToMillis(options?.cacheTime, 30 * 60_000);
  const { key, paramsKey } = makeLoaderCacheKey(routeId, params);
  const entry: LoaderCacheEntry = {
    key,
    routeId,
    paramsKey,
    result,
    updatedAt: now,
    staleAt: now + staleTime,
    expiresAt: now + cacheTime,
    reactivityKeys: options?.reactivityKeys ? normalizeReactivityKeys(options.reactivityKeys) : [],
  };
  target.cache.set(key, entry);

  for (const rk of entry.reactivityKeys) {
    const set = target.reactivityToCache.get(rk) ?? new Set<string>();
    set.add(key);
    target.reactivityToCache.set(rk, set);
    ensureReactivitySubscription(target, rk);
  }
  return entry;
}

export function invalidateLoaderCacheByKeys(keys: ReadonlyArray<string>, store?: LoaderCacheStore): void {
  if (store === undefined) {
    forEachLoaderCacheStore((target) => {
      for (const key of keys) {
        markStaleByReactivityKey(target, key);
      }
    });
    return;
  }
  for (const key of keys) {
    markStaleByReactivityKey(store, key);
  }
}

export function invalidateLoaderReactivity(keys: ReactivityKeysInput, store?: LoaderCacheStore): void {
  const normalized = normalizeReactivityKeys(keys);
  invalidateLoaderCacheByKeys(normalized, store);
  invalidateReactivityRuntime(normalized);
}

export function collectLoaderReactivityKeys(
  routeId: string,
  params: unknown,
  options?: { readonly fallback?: ReactivityKeysInput },
  store?: LoaderCacheStore,
): ReadonlyArray<string> {
  const existing = getLoaderCacheEntry(routeId, params, store);
  if (existing?.reactivityKeys.length) {
    return existing.reactivityKeys;
  }
  return options?.fallback ? normalizeReactivityKeys(options.fallback) : [];
}

export function matchesLoaderReactivity(
  loaderKeys: ReadonlyArray<string>,
  invalidatedKeys: ReadonlyArray<string>,
): boolean {
  if (invalidatedKeys.length === 0) return false;
  const invalidated = new Set(invalidatedKeys);
  return loaderKeys.some((key) => invalidated.has(key));
}

export function clearLoaderCache(routeId?: string, store?: LoaderCacheStore): void {
  const target = resolveLoaderCacheStore(store);
  if (!routeId) {
    target.cache.clear();
    target.reactivityToCache.clear();
    return;
  }
  for (const [k, v] of target.cache.entries()) {
    if (v.routeId === routeId) target.cache.delete(k);
  }
}

/**
 * A route loader exceeded its declared timeout budget (`DQ-036`).
 *
 * Schema-tagged like the resumability layer's errors: a real `Error` with a
 * stack, carrying which route and against which budget.
 */
export class RouteLoaderTimeoutError extends Schema.TaggedErrorClass<RouteLoaderTimeoutError>(
  "@effect-atom-jsx/RouteLoaderTimeoutError",
)("RouteLoaderTimeoutError", {
  routeId: Schema.String,
  timeoutMs: Schema.Number,
}) {}

export function runCachedLoader<A, E>(
  routeId: string,
  params: unknown,
  run: Effect.Effect<A, E>,
  options?: {
    readonly staleTime?: DurationInput;
    readonly cacheTime?: DurationInput;
    readonly staleWhileRevalidate?: boolean;
    readonly reactivityKeys?: ReactivityKeysInput;
    readonly timeout?: DurationInput;
  },
): Effect.Effect<CoreResultType<A, E | RouteLoaderTimeoutError>, never> {
  return currentLoaderCacheStore.pipe(Effect.flatMap((store) => {
    const existing = getLoaderCacheEntry(routeId, params, store);
    if (existing && isFresh(existing)) {
      return Effect.succeed(existing.result as CoreResultType<A, E>);
    }

    if (existing && options?.staleWhileRevalidate && existing.result._tag === "Success") {
      const stale = CoreResult.refreshing(existing.result as CoreResultType<A, E> & { readonly _tag: "Success" });
      const { key } = makeLoaderCacheKey(routeId, params);
      // DQ-032: at most one in-flight refresh per cache key — a concurrent
      // stale read joins the running refresh rather than starting a second.
      if (store.inFlightRefreshes.has(key)) {
        return Effect.succeed(stale as CoreResultType<A, E>);
      }
      // Detached rather than a child of the requesting fiber (which completes
      // immediately with the stale value and would cancel every refresh), but
      // never unowned: the store tracks it (dispose interrupts and refuses
      // the write) and, when a router runtime is driving, the ambient
      // supervisor lets a superseding navigation interrupt it.
      return Effect.serviceOption(SwrRefreshSupervisorTag).pipe(
        Effect.flatMap((supervisor) =>
          Effect.forkDetach(
            executeAndCache(routeId, params, run, options, store).pipe(Effect.asVoid),
          ).pipe(
            Effect.map((fiber) => {
              store.inFlightRefreshes.set(key, fiber);
              fiber.addObserver(() => {
                if (store.inFlightRefreshes.get(key) === fiber) {
                  store.inFlightRefreshes.delete(key);
                }
              });
              if (supervisor._tag === "Some") {
                supervisor.value.register(fiber);
              }
              return stale as CoreResultType<A, E>;
            }),
          )
        ),
      );
    }

    return executeAndCache(routeId, params, run, options, store);
  }));
}

function executeAndCache<A, E>(
  routeId: string,
  params: unknown,
  run: Effect.Effect<A, E>,
  options: {
    readonly staleTime?: DurationInput;
    readonly cacheTime?: DurationInput;
    readonly reactivityKeys?: ReactivityKeysInput;
    readonly timeout?: DurationInput;
  } | undefined,
  store: LoaderCacheStore,
): Effect.Effect<CoreResultType<A, E>, never> {
  const optionKeys = options?.reactivityKeys ? normalizeReactivityKeys(options.reactivityKeys) : [];
  const timeoutMs = durationToMillis(options?.timeout, 0);
  // DQ-036: a loader timeout is attributable — it names the route and the
  // budget — rather than a bare `TimeoutError` that names neither. A timeout
  // is the single most likely loader failure an author wants distinct UI for.
  const timedRun = timeoutMs > 0
    ? run.pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () =>
            Effect.fail(
              new RouteLoaderTimeoutError({ routeId, timeoutMs }) as unknown as E,
            ),
        }),
      )
    : run;
  return Effect.sync(() => beginReactivityReadCapture()).pipe(
    Effect.flatMap((capture) => timedRun.pipe(
      Effect.exit,
      Effect.map((exit) => {
        const out = CoreResult.fromExit(exit) as CoreResultType<A, E>;
        const mergedKeys = [...new Set([...optionKeys, ...capture.end()])];
        // DQ-032: a disposed store refuses late writes — interruption stops
        // most of them, but a refresh completing in the same tick as dispose
        // must not resurrect the entry.
        if (!store.disposed) {
          setLoaderCacheEntry(routeId, params, out, { ...options, reactivityKeys: mergedKeys }, store);
        }
        return out;
      }),
      Effect.ensuring(Effect.sync(() => {
        capture.end();
      })),
    )),
  );
}
