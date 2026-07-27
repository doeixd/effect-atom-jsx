/**
 * Hydration.ts — SSR dehydrate/hydrate workflow for atoms.
 *
 * On the server, `dehydrate` snapshots atom values into a serializable array.
 * On the client, `hydrate` restores those values into a Registry, enabling
 * seamless server-to-client state transfer.
 */

import type * as Atom from "./Atom.js";
import type * as Registry from "./Registry.js";
import { Effect } from "effect";

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

/**
 * Hydration validation strictness (ADR-005).
 *
 * - `"off"`   — no diagnostics; unknown/missing keys are silently skipped.
 * - `"loose"` — unknown/missing keys are reported via callbacks (and a
 *   `console.warn` fallback), but hydration still completes. Preserves the
 *   zero-flicker first render even when the server/client key sets drift.
 * - `"strict"` — a key mismatch is a typed `HydrationError` (Effect variants)
 *   or a thrown error (sync variants).
 */
export type ValidationMode = "off" | "loose" | "strict";

export interface HydrateOptions {
  /** Legacy toggle: `true` is equivalent to `mode: "loose"`. */
  readonly validate?: boolean;
  /** Preferred validation control (ADR-005). Overrides `validate` when set. */
  readonly mode?: ValidationMode;
  readonly onUnknownKey?: (key: string) => void;
  readonly onMissingKey?: (key: string) => void;
}

/** Resolve the effective {@link ValidationMode} from mixed legacy options. */
export const resolveMode = (options?: {
  readonly mode?: ValidationMode;
  readonly validate?: boolean;
  readonly strict?: boolean;
}): ValidationMode => {
  if (options?.mode !== undefined) return options.mode;
  if (options?.strict === true) return "strict";
  if (options?.validate === true) return "loose";
  return "off";
};

export type HydrationError =
  | { readonly _tag: "HydrationUnknownKeys"; readonly keys: ReadonlyArray<string> }
  | { readonly _tag: "HydrationMissingKeys"; readonly keys: ReadonlyArray<string> };

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
  const warn = resolveMode(options) !== "off";

  const reportUnknown = options?.onUnknownKey ?? (warn
    ? (key: string) => {
      console.warn(`[effect-atom-jsx] Hydration: server key "${key}" has no matching resolver.`);
    }
    : undefined);

  const reportMissing = options?.onMissingKey ?? (warn
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

/**
 * Effect constructor variant of `hydrate`.
 *
 * When `strict` is enabled, unknown/missing resolver keys fail with typed
 * `HydrationError` values.
 */
export const hydrateEffect = (
  registry: Registry.Registry,
  dehydratedState: Iterable<DehydratedAtom>,
  resolvers: Readonly<Record<string, Atom.Writable<any, any>>>,
  options?: HydrateOptions & { readonly strict?: boolean },
): Effect.Effect<void, HydrationError> =>
  Effect.sync(() => {
    const values = toValues(Array.from(dehydratedState));
    const matched = new Set<string>();
    const unknown: Array<string> = [];

    for (const value of values) {
      const atom = resolvers[value.key];
      if (!atom) {
        unknown.push(value.key);
        options?.onUnknownKey?.(value.key);
        continue;
      }
      matched.add(value.key);
      registry.set(atom, value.value);
    }

    const missing = Object.keys(resolvers).filter((key) => !matched.has(key));
    for (const key of missing) {
      options?.onMissingKey?.(key);
    }

    if (resolveMode(options) === "strict") {
      if (unknown.length > 0) {
        throw { _tag: "HydrationUnknownKeys", keys: unknown } as const;
      }
      if (missing.length > 0) {
        throw { _tag: "HydrationMissingKeys", keys: missing } as const;
      }
    }
  }).pipe(
    Effect.mapError((error) => error as HydrationError),
  );

// ─── Family hydration identity (ADR-005) ────────────────────────────────────
//
// A `Atom.family` member is identified by its argument tuple, not a single
// key. To carry a family across the SSR boundary member-for-member, each live
// member is dehydrated with its owning family key plus its identifying `args`;
// on the client the same family is called with those `args` to obtain (or
// re-create) the identical member atom before its value is restored.

/** A dehydrated family-member entry: family key + identifying args + value. */
export interface DehydratedFamilyValue extends DehydratedAtom {
  /** Lookup key for the owning family in the hydrate resolver map. */
  readonly family: string;
  /** The member's identifying argument tuple. */
  readonly args: ReadonlyArray<unknown>;
  /** The serialized member value at dehydration time. */
  readonly value: unknown;
  /** Epoch millisecond timestamp when the member was dehydrated. */
  readonly dehydratedAt: number;
}

/** A family resolver: the client-side family whose members accept `args`. */
export type FamilyResolver = Atom.Family<any, Atom.Writable<any, any>>;

/** Human-readable composite key for a family member, used in diagnostics. */
const familyMemberKey = (family: string, args: ReadonlyArray<unknown>): string =>
  `${family}(${JSON.stringify(args)})`;

/**
 * Snapshot every live member of an `Atom.family` into serializable entries.
 *
 * @param registry - Registry to read current member values from.
 * @param family   - Lookup key for the family (matched during hydration).
 * @param source   - The family to enumerate via `family.entries()`.
 * @param options  - Optional `filter` to select which members to dehydrate.
 *
 * @example
 * const state = dehydrateFamily(registry, "todoById", todoById)
 */
export const dehydrateFamily = (
  registry: Registry.Registry,
  family: string,
  source: Atom.Family<any, Atom.Atom<any>>,
  options?: { readonly filter?: (args: ReadonlyArray<unknown>, atom: Atom.Atom<any>) => boolean },
): Array<DehydratedFamilyValue> => {
  const out: Array<DehydratedFamilyValue> = [];
  const ts = Date.now();
  for (const [args, atom] of source.entries()) {
    if (options?.filter !== undefined && !options.filter(args, atom)) continue;
    out.push({
      "~@effect-atom-jsx/DehydratedAtom": true,
      family,
      args,
      value: registry.get(atom),
      dehydratedAt: ts,
    });
  }
  return out;
};

/** Filter a mixed dehydrated array down to family-member entries. */
export const toFamilyValues = (
  state: ReadonlyArray<DehydratedAtom>,
): Array<DehydratedFamilyValue> =>
  state.filter((item): item is DehydratedFamilyValue =>
    typeof item === "object" && item !== null && "family" in item && "args" in item && "value" in item,
  );

/**
 * Restore dehydrated family members into a Registry on the client.
 *
 * Each entry's `family` key selects a family resolver; the family is called
 * with the entry's `args` to obtain the identical member atom, whose value is
 * then written. Validation follows {@link ValidationMode}: `"loose"` reports
 * drift via callbacks, `"strict"` throws a {@link HydrationError}, `"off"`
 * skips silently (preserving zero-flicker first render).
 *
 * @returns The set of family member keys that were successfully hydrated.
 */
export const hydrateFamilies = (
  registry: Registry.Registry,
  dehydratedState: Iterable<DehydratedAtom>,
  resolvers: Readonly<Record<string, FamilyResolver>>,
  options?: HydrateOptions,
): void => {
  const values = toFamilyValues(Array.from(dehydratedState));
  const mode = resolveMode(options);
  const seenFamilies = new Set<string>();

  for (const entry of values) {
    const family = resolvers[entry.family];
    if (family === undefined) {
      const key = familyMemberKey(entry.family, entry.args);
      options?.onUnknownKey?.(key);
      if (mode === "loose") {
        console.warn(`[effect-atom-jsx] Hydration: family "${entry.family}" has no matching resolver.`);
      }
      if (mode === "strict") {
        throw { _tag: "HydrationUnknownKeys", keys: [key] } as const;
      }
      continue;
    }
    seenFamilies.add(entry.family);
    const member = family(...entry.args);
    registry.set(member, entry.value);
  }

  if (mode !== "off") {
    for (const key of Object.keys(resolvers)) {
      if (!seenFamilies.has(key)) {
        options?.onMissingKey?.(key);
        if (mode === "loose") {
          console.warn(`[effect-atom-jsx] Hydration: family resolver "${key}" received no dehydrated members.`);
        }
      }
    }
  }
};

/**
 * Effect variant of {@link hydrateFamilies}. In `"strict"` mode unknown/missing
 * families fail with a typed {@link HydrationError}.
 */
export const hydrateFamiliesEffect = (
  registry: Registry.Registry,
  dehydratedState: Iterable<DehydratedAtom>,
  resolvers: Readonly<Record<string, FamilyResolver>>,
  options?: HydrateOptions,
): Effect.Effect<void, HydrationError> =>
  Effect.sync(() => {
    const values = toFamilyValues(Array.from(dehydratedState));
    const mode = resolveMode(options);
    const seenFamilies = new Set<string>();
    const unknown: Array<string> = [];

    for (const entry of values) {
      const family = resolvers[entry.family];
      if (family === undefined) {
        const key = familyMemberKey(entry.family, entry.args);
        unknown.push(key);
        options?.onUnknownKey?.(key);
        continue;
      }
      seenFamilies.add(entry.family);
      const member = family(...entry.args);
      registry.set(member, entry.value);
    }

    const missing = Object.keys(resolvers).filter((key) => !seenFamilies.has(key));
    for (const key of missing) {
      options?.onMissingKey?.(key);
    }

    if (mode === "strict") {
      if (unknown.length > 0) {
        throw { _tag: "HydrationUnknownKeys", keys: unknown } as const;
      }
      if (missing.length > 0) {
        throw { _tag: "HydrationMissingKeys", keys: missing } as const;
      }
    }
  }).pipe(
    Effect.mapError((error) => error as HydrationError),
  );
