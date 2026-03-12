import { Effect } from "effect";
import { createSignal, type Accessor } from "./api.js";
import type { ReactivityService } from "./Reactivity.js";

export type ReactivityKeysInput =
  | ReadonlyArray<string>
  | Readonly<Record<string, ReadonlyArray<string | number>>>;

export type NormalizedReactivityKey = string;

let installedService: ReactivityService | null = null;
const installListeners = new Set<(service: ReactivityService | null) => void>();
const invalidationListeners = new Set<(keys: ReadonlyArray<NormalizedReactivityKey>) => void>();
const keyUnsubscribers = new Map<NormalizedReactivityKey, () => void>();
const readCaptureStack: Array<Set<NormalizedReactivityKey>> = [];
const invalidationCaptureStack: Array<Set<NormalizedReactivityKey>> = [];

export function installReactivityService(service: ReactivityService | null): () => void {
  const previous = installedService;
  teardownServiceSubscriptions();
  installedService = service;
  setupExistingKeySubscriptions();
  for (const listener of installListeners) {
    listener(installedService);
  }
  return () => {
    teardownServiceSubscriptions();
    installedService = previous;
    setupExistingKeySubscriptions();
    for (const listener of installListeners) {
      listener(installedService);
    }
  };
}

export function getInstalledReactivityService(): ReactivityService | null {
  return installedService;
}

export function onReactivityServiceChange(listener: (service: ReactivityService | null) => void): () => void {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}

export function onReactivityInvalidation(listener: (keys: ReadonlyArray<NormalizedReactivityKey>) => void): () => void {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

const reactivityVersionMap = new Map<NormalizedReactivityKey, Accessor<number>>();
const reactivityBumpMap = new Map<NormalizedReactivityKey, () => void>();

export function normalizeReactivityKeys(input: ReactivityKeysInput): ReadonlyArray<NormalizedReactivityKey> {
  if (Array.isArray(input)) return input;
  const dict = input as Readonly<Record<string, ReadonlyArray<string | number>>>;
  const out: NormalizedReactivityKey[] = [];
  for (const key of Object.keys(dict)) {
    out.push(key);
    for (const sub of dict[key] ?? []) {
      out.push(`${key}:${String(sub)}`);
    }
  }
  return out;
}

function ensureReactivityKey(key: NormalizedReactivityKey): Accessor<number> {
  const existing = reactivityVersionMap.get(key);
  if (existing) {
    ensureServiceSubscriptionForKey(key);
    return existing;
  }
  const [read, set] = createSignal(0);
  reactivityVersionMap.set(key, read);
  reactivityBumpMap.set(key, () => set((n) => n + 1));
  ensureServiceSubscriptionForKey(key);
  return read;
}

function ensureServiceSubscriptionForKey(key: NormalizedReactivityKey): void {
  if (installedService === null) return;
  if (keyUnsubscribers.has(key)) return;
  const unsubscribe = Effect.runSync(installedService.subscribe([key], () => {
    reactivityBumpMap.get(key)?.();
  }));
  keyUnsubscribers.set(key, unsubscribe);
}

function setupExistingKeySubscriptions(): void {
  for (const key of reactivityVersionMap.keys()) {
    ensureServiceSubscriptionForKey(key);
  }
}

function teardownServiceSubscriptions(): void {
  for (const unsubscribe of keyUnsubscribers.values()) {
    unsubscribe();
  }
  keyUnsubscribers.clear();
}

export function invalidateReactivityRuntime(input: ReactivityKeysInput): void {
  const keys = normalizeReactivityKeys(input);
  for (const listener of invalidationListeners) {
    listener(keys);
  }
  for (const capture of invalidationCaptureStack) {
    for (const key of keys) {
      capture.add(key);
    }
  }
  if (installedService !== null) {
    for (const key of keys) {
      ensureReactivityKey(key);
    }
    Effect.runFork(installedService.invalidate(keys));
    return;
  }

  for (const key of keys) {
    ensureReactivityKey(key);
    reactivityBumpMap.get(key)?.();
  }
}

export function trackReactivityRuntime(input: ReactivityKeysInput): void {
  for (const key of normalizeReactivityKeys(input)) {
    for (const capture of readCaptureStack) {
      capture.add(key);
    }
    ensureReactivityKey(key)();
  }
}

export function flushReactivityRuntime(): Effect.Effect<void> {
  if (installedService === null) return Effect.void;
  return installedService.flush();
}

export function captureReactivityReads<A>(evaluate: () => A): { readonly value: A; readonly keys: ReadonlyArray<NormalizedReactivityKey> } {
  const captured = new Set<NormalizedReactivityKey>();
  readCaptureStack.push(captured);
  try {
    return {
      value: evaluate(),
      keys: [...captured],
    };
  } finally {
    readCaptureStack.pop();
  }
}

export function captureReactivityInvalidations<A>(evaluate: () => A): { readonly value: A; readonly keys: ReadonlyArray<NormalizedReactivityKey> } {
  const captured = new Set<NormalizedReactivityKey>();
  invalidationCaptureStack.push(captured);
  try {
    return {
      value: evaluate(),
      keys: [...captured],
    };
  } finally {
    invalidationCaptureStack.pop();
  }
}

export function beginReactivityReadCapture(): { readonly keys: Set<NormalizedReactivityKey>; readonly end: () => ReadonlyArray<NormalizedReactivityKey> } {
  const captured = new Set<NormalizedReactivityKey>();
  readCaptureStack.push(captured);
  return {
    keys: captured,
    end: () => {
      const index = readCaptureStack.lastIndexOf(captured);
      if (index >= 0) {
        readCaptureStack.splice(index, 1);
      }
      return [...captured];
    },
  };
}

export function beginReactivityInvalidationCapture(): { readonly keys: Set<NormalizedReactivityKey>; readonly end: () => ReadonlyArray<NormalizedReactivityKey> } {
  const captured = new Set<NormalizedReactivityKey>();
  invalidationCaptureStack.push(captured);
  return {
    keys: captured,
    end: () => {
      const index = invalidationCaptureStack.lastIndexOf(captured);
      if (index >= 0) {
        invalidationCaptureStack.splice(index, 1);
      }
      return [...captured];
    },
  };
}
