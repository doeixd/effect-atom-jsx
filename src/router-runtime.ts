import { Effect } from "effect";
import * as Result from "./Result.js";
import {
  beginReactivityReadCapture,
  getInstalledReactivityService,
  onReactivityInvalidation,
  onReactivityServiceChange,
  invalidateReactivityRuntime,
} from "./reactivity-runtime.js";

export type DurationInput = number | string | undefined;

export interface LoaderCacheEntry {
  readonly key: string;
  readonly routeId: string;
  readonly paramsKey: string;
  readonly result: Result.Result<unknown, unknown>;
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

const cache = new Map<string, LoaderCacheEntry>();
const reactivityToCache = new Map<string, Set<string>>();
const reactivitySubscriptions = new Map<string, () => void>();

function markStaleByReactivityKey(key: string): void {
  const cacheKeys = reactivityToCache.get(key);
  if (!cacheKeys) return;
  for (const cacheKey of cacheKeys) {
    const existing = cache.get(cacheKey);
    if (!existing) continue;
    cache.set(cacheKey, { ...existing, staleAt: 0 });
  }
}

function ensureReactivitySubscription(key: string): void {
  if (reactivitySubscriptions.has(key)) return;
  const service = getInstalledReactivityService();
  if (service === null) return;
  const unsubscribe = Effect.runSync(service.subscribe([key], () => {
    markStaleByReactivityKey(key);
  }));
  reactivitySubscriptions.set(key, unsubscribe);
}

function resetReactivitySubscriptions(): void {
  for (const unsubscribe of reactivitySubscriptions.values()) {
    unsubscribe();
  }
  reactivitySubscriptions.clear();
  for (const key of reactivityToCache.keys()) {
    ensureReactivitySubscription(key);
  }
}

onReactivityServiceChange(() => {
  resetReactivitySubscriptions();
});

onReactivityInvalidation((keys) => {
  for (const key of keys) {
    markStaleByReactivityKey(key);
  }
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function makeLoaderCacheKey(routeId: string, params: unknown): { readonly key: string; readonly paramsKey: string } {
  const paramsKey = stableStringify(params ?? {});
  return {
    key: `${routeId}::${paramsKey}`,
    paramsKey,
  };
}

export function getLoaderCacheEntry(routeId: string, params: unknown): LoaderCacheEntry | undefined {
  const { key } = makeLoaderCacheKey(routeId, params);
  const found = cache.get(key);
  if (!found) return undefined;
  if (Date.now() > found.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return found;
}

export function isFresh(entry: LoaderCacheEntry): boolean {
  return Date.now() <= entry.staleAt;
}

export function setLoaderCacheEntry(routeId: string, params: unknown, result: Result.Result<unknown, unknown>, options?: {
  readonly staleTime?: DurationInput;
  readonly cacheTime?: DurationInput;
  readonly reactivityKeys?: ReadonlyArray<string>;
}): LoaderCacheEntry {
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
    reactivityKeys: [...(options?.reactivityKeys ?? [])],
  };
  cache.set(key, entry);

  for (const rk of entry.reactivityKeys) {
    const set = reactivityToCache.get(rk) ?? new Set<string>();
    set.add(key);
    reactivityToCache.set(rk, set);
    ensureReactivitySubscription(rk);
  }
  return entry;
}

export function invalidateLoaderCacheByKeys(keys: ReadonlyArray<string>): void {
  for (const key of keys) {
    markStaleByReactivityKey(key);
  }
}

export function invalidateLoaderReactivity(keys: ReadonlyArray<string>): void {
  invalidateLoaderCacheByKeys(keys);
  invalidateReactivityRuntime(keys);
}

export function collectLoaderReactivityKeys(
  routeId: string,
  params: unknown,
  options?: { readonly fallback?: ReadonlyArray<string> },
): ReadonlyArray<string> {
  const existing = getLoaderCacheEntry(routeId, params);
  if (existing?.reactivityKeys.length) {
    return existing.reactivityKeys;
  }
  return [...(options?.fallback ?? [])];
}

export function matchesLoaderReactivity(
  loaderKeys: ReadonlyArray<string>,
  invalidatedKeys: ReadonlyArray<string>,
): boolean {
  if (invalidatedKeys.length === 0) return false;
  const invalidated = new Set(invalidatedKeys);
  return loaderKeys.some((key) => invalidated.has(key));
}

export function clearLoaderCache(routeId?: string): void {
  if (!routeId) {
    cache.clear();
    reactivityToCache.clear();
    return;
  }
  for (const [k, v] of cache.entries()) {
    if (v.routeId === routeId) cache.delete(k);
  }
}

export function runCachedLoader<A, E>(
  routeId: string,
  params: unknown,
  run: Effect.Effect<A, E>,
  options?: {
    readonly staleTime?: DurationInput;
    readonly cacheTime?: DurationInput;
    readonly staleWhileRevalidate?: boolean;
    readonly reactivityKeys?: ReadonlyArray<string>;
    readonly timeout?: DurationInput;
  },
): Effect.Effect<Result.Result<A, E>, never> {
  const existing = getLoaderCacheEntry(routeId, params);
  if (existing && isFresh(existing)) {
    return Effect.succeed(existing.result as Result.Result<A, E>);
  }

  if (existing && options?.staleWhileRevalidate && existing.result._tag === "Success") {
    const stale = Result.waiting(existing.result as Result.Result<A, E>);
    Effect.runFork(
      executeAndCache(routeId, params, run, options).pipe(Effect.asVoid),
    );
    return Effect.succeed(stale as Result.Result<A, E>);
  }

  return executeAndCache(routeId, params, run, options);
}

function executeAndCache<A, E>(
  routeId: string,
  params: unknown,
  run: Effect.Effect<A, E>,
  options?: {
    readonly staleTime?: DurationInput;
    readonly cacheTime?: DurationInput;
    readonly reactivityKeys?: ReadonlyArray<string>;
    readonly timeout?: DurationInput;
  },
): Effect.Effect<Result.Result<A, E>, never> {
  return Effect.sync(() => beginReactivityReadCapture()).pipe(
    Effect.flatMap((capture) => run.pipe(
      Effect.match({
        onSuccess: (data) => {
          const out = Result.success<A, E>(data);
          const mergedKeys = [...new Set([...(options?.reactivityKeys ?? []), ...capture.end()])];
          setLoaderCacheEntry(routeId, params, out, { ...options, reactivityKeys: mergedKeys });
          return out;
        },
        onFailure: (error) => {
          const out = Result.failure<A, E>(error as E);
          const mergedKeys = [...new Set([...(options?.reactivityKeys ?? []), ...capture.end()])];
          setLoaderCacheEntry(routeId, params, out, { ...options, reactivityKeys: mergedKeys });
          return out;
        },
      }),
      Effect.ensuring(Effect.sync(() => {
        capture.end();
      })),
    )),
  );
}
