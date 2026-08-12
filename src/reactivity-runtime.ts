import { Effect } from "effect";
import { createSignal, type Accessor } from "./api.js";
import type { ReactivityService } from "./Reactivity.js";

export const ReactivityKeyTypeId: unique symbol = Symbol.for("effect-atom-jsx/Reactivity/Key");
export type ReactivityKeyTypeId = typeof ReactivityKeyTypeId;

/**
 * A branded reactivity key witness.
 *
 * Witnesses carry their literal key name at the type level and their full
 * normalized key expansion (ancestor chain plus self) at runtime, so tracked
 * reads and invalidating writes can share one value instead of drifting
 * string literals.
 *
 * Hierarchy semantics match the existing record-form convention
 * (`{ users: ["alice"] }` -> `["users", "users:alice"]`): a child key expands
 * to its ancestors plus itself for both tracking and invalidation. Invalidating
 * a child therefore notifies parent observers, and invalidating the parent
 * reaches child observers. The known trade-off (also present in the record
 * form) is sibling over-invalidation through the shared parent key; refresh is
 * safe, just occasionally broader than strictly necessary.
 */
export interface ReactivityKeyWitness<Name extends string = string> {
  readonly [ReactivityKeyTypeId]: true;
  /** The literal key name, e.g. `"users"` or `"users:42"`. */
  readonly name: Name;
  /** Normalized expansion used for tracking/invalidation: ancestors + self. */
  readonly keys: ReadonlyArray<NormalizedReactivityKey>;
  /** Derive a hierarchical child key, e.g. `Users.child(42)` -> `"users:42"`. */
  readonly child: <Sub extends string | number>(sub: Sub) => ReactivityKeyWitness<`${Name}:${Sub}`>;
  readonly toString: () => Name;
}

export function isReactivityKeyWitness(value: unknown): value is ReactivityKeyWitness {
  return typeof value === "object" && value !== null && ReactivityKeyTypeId in value;
}

/**
 * The reserved identity namespace (`DIN-2a`, `DQ-089`): every installation-
 * owned identity — binding hydration/reactivity keys (`af:binding:`),
 * expression ids (`af:expr:`), component ids (`af:component:`), and anything
 * the framework mints in the future — lives under this prefix. Authored keys
 * may never enter it; the vocabulary lives HERE, in exactly one place, so no
 * seam can invent its own subset.
 */
export const ReservedIdentityPrefix = "af:";

/** Is this key inside the reserved (installation-owned) identity namespace? */
export function isReservedIdentityKey(key: string): boolean {
  return key.startsWith(ReservedIdentityPrefix);
}

function assertAuthoredKey(key: string): void {
  // Loose runtime input (a record nested in the array form) is not a string
  // key; the reservation applies to keys, not to shapes normalization
  // tolerates.
  if (typeof key === "string" && isReservedIdentityKey(key)) {
    throw new Error(
      `Reactivity key ${JSON.stringify(key)} is reserved: the "${ReservedIdentityPrefix}" namespace is installation-owned (DQ-089). Authored keys may not name, invalidate, or masquerade as framework identities.`,
    );
  }
}

export function makeReactivityKeyWitness<Name extends string>(
  name: Name,
  ancestors: ReadonlyArray<NormalizedReactivityKey> = [],
): ReactivityKeyWitness<Name> {
  // DIN-2a: hierarchical derivation must not smuggle a reserved key in
  // (`Key.make("af").child("binding")` constructs "af:binding").
  assertAuthoredKey(name);
  const keys: ReadonlyArray<NormalizedReactivityKey> = [...ancestors, name];
  return {
    [ReactivityKeyTypeId]: true,
    name,
    keys,
    child: <Sub extends string | number>(sub: Sub) =>
      makeReactivityKeyWitness(`${name}:${String(sub)}` as `${Name}:${Sub}`, keys),
    toString: () => name,
  };
}

export type ReactivityKeyInput = string | ReactivityKeyWitness;

export type ReactivityKeysInput =
  | ReadonlyArray<ReactivityKeyInput>
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

/**
 * Normalize AUTHORED reactivity keys — the single choke point every
 * authoring seam (loader `reactivityKeys`, query keys, action keys,
 * expression deps, invalidation calls) shares. Rejects the reserved `af:`
 * namespace here, which is what makes the reservation hold by construction
 * instead of by per-seam audits (`DIN-2b`).
 *
 * Library-computed key sets (a restored query's implicit `af:binding:` key,
 * cache-identity derivation) are NOT authored input and go through
 * {@link normalizeReactivityKeysDerived} instead — reservation constrains
 * what an author may NAME, never what the library may COMPUTE (`DQ-089`).
 */
export function normalizeReactivityKeys(input: ReactivityKeysInput): ReadonlyArray<NormalizedReactivityKey> {
  const normalized = normalizeReactivityKeysDerived(input);
  for (const key of normalized) {
    assertAuthoredKey(key);
  }
  return normalized;
}

/** The derivation-exempt normalization (`DQ-089`); see above. */
export function normalizeReactivityKeysDerived(input: ReactivityKeysInput): ReadonlyArray<NormalizedReactivityKey> {
  if (Array.isArray(input)) {
    const out: NormalizedReactivityKey[] = [];
    for (const entry of input as ReadonlyArray<ReactivityKeyInput>) {
      if (isReactivityKeyWitness(entry)) {
        out.push(...entry.keys);
      } else {
        out.push(entry);
      }
    }
    // Witness expansion can repeat shared ancestors; dedupe preserving order.
    return [...new Set(out)];
  }
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
  // DQ-089: TRACKING a reserved key is observation, not authorship -- a
  // restored query legitimately subscribes to its implicit af:binding key,
  // and subscribing grants no power to fire or impersonate the identity.
  // Naming (Key.make) and invalidating stay guarded.
  for (const key of normalizeReactivityKeysDerived(input)) {
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
