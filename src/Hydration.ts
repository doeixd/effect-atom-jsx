/**
 * Hydration.ts — SSR dehydrate/hydrate workflow for atoms.
 *
 * On the server, `dehydrate` snapshots atom values into a serializable array.
 * On the client, `hydrate` restores those values into a Registry, enabling
 * seamless server-to-client state transfer.
 */

import type * as Atom from "./Atom.js";
import type * as Registry from "./Registry.js";

/** Branded marker interface for dehydrated atom entries. */
export interface DehydratedAtom {
  readonly "~@effect-atom-jsx/DehydratedAtom": true;
}

/** A dehydrated atom entry containing the serialized key, value, and timestamp. */
export interface DehydratedAtomValue extends DehydratedAtom {
  /** Lookup key used to resolve the atom during hydration. */
  readonly key: string;
  /** The serialized atom value at dehydration time. */
  readonly value: unknown;
  /** Epoch millisecond timestamp when the atom was dehydrated. */
  readonly dehydratedAt: number;
}

export interface HydrateOptions {
  readonly validate?: boolean;
  readonly onUnknownKey?: (key: string) => void;
  readonly onMissingKey?: (key: string) => void;
}

/**
 * Snapshot atom values from a Registry into a serializable array.
 *
 * @param registry - The Registry to read current atom values from.
 * @param entries  - Key/atom pairs identifying which atoms to dehydrate.
 * @returns An array of `DehydratedAtomValue` entries suitable for JSON serialization.
 *
 * @example
 * const state = dehydrate(registry, [
 *   ["user", userAtom],
 *   ["prefs", prefsAtom],
 * ])
 * // Embed `state` in the SSR HTML payload
 */
export const dehydrate = (
  registry: Registry.Registry,
  entries: Iterable<readonly [key: string, atom: Atom.Atom<any>]>,
): Array<DehydratedAtomValue> => {
  const out: Array<DehydratedAtomValue> = [];
  const ts = Date.now();
  for (const [key, atom] of entries) {
    out.push({
      "~@effect-atom-jsx/DehydratedAtom": true,
      key,
      value: registry.get(atom),
      dehydratedAt: ts,
    });
  }
  return out;
};

/**
 * Filter a dehydrated state array to only entries that contain key/value data.
 *
 * @param state - Raw dehydrated atom entries (may include marker-only entries).
 * @returns Only the entries that have `key` and `value` properties.
 */
export const toValues = (state: ReadonlyArray<DehydratedAtom>): Array<DehydratedAtomValue> =>
  state.filter((item): item is DehydratedAtomValue =>
    typeof item === "object" && item !== null && "key" in item && "value" in item,
  );

/**
 * Restore dehydrated atom values into a Registry on the client.
 *
 * Each entry's `key` is looked up in `resolvers` to find the target atom.
 * Entries with no matching resolver are silently skipped.
 *
 * @param registry       - The client-side Registry to write values into.
 * @param dehydratedState - Serialized atom entries from `dehydrate`.
 * @param resolvers      - Map of key to writable atom for resolving entries.
 *
 * @example
 * hydrate(registry, serverState, {
 *   user: userAtom,
 *   prefs: prefsAtom,
 * })
 */
export const hydrate = (
  registry: Registry.Registry,
  dehydratedState: Iterable<DehydratedAtom>,
  resolvers: Readonly<Record<string, Atom.Writable<any, any>>>,
  options?: HydrateOptions,
): void => {
  const values = toValues(Array.from(dehydratedState));
  const matchedResolvers = new Set<string>();

  const reportUnknown = options?.onUnknownKey ?? (options?.validate
    ? (key: string) => {
      console.warn(`[effect-atom-jsx] Hydration: server key "${key}" has no matching resolver.`);
    }
    : undefined);

  const reportMissing = options?.onMissingKey ?? (options?.validate
    ? (key: string) => {
      console.warn(`[effect-atom-jsx] Hydration: resolver key "${key}" missing from dehydrated state.`);
    }
    : undefined);

  for (const value of values) {
    const atom = resolvers[value.key];
    if (!atom) {
      reportUnknown?.(value.key);
      continue;
    }
    matchedResolvers.add(value.key);
    registry.set(atom, value.value);
  }

  if (reportMissing !== undefined) {
    for (const key of Object.keys(resolvers)) {
      if (!matchedResolvers.has(key)) {
        reportMissing(key);
      }
    }
  }
};
