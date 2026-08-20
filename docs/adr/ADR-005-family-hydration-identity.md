# ADR-005: Family Cache and Hydration Identity Strategy

- Status: Implemented (2026-07-27)
- Date: 2026-03-10

## Context

`Atom.family` and hydration key mapping both rely on stable identity. Feedback flags memory-growth and silent hydration mismatch risks if identity/lifecycle rules are under-specified.

## Options Considered

1. Keep current behavior and improve docs only.
2. Add explicit family eviction APIs and hydration validation mode.
3. Fully automatic identity derivation without manual keys.

## Decision

Choose option 2:

- Add/standardize family lifecycle controls (`evict`, `clear`, optional policy follow-up).
- Add hydration validation diagnostics for unknown and missing keys.

## Rationale

- Addresses production reliability risks without over-automation assumptions.
- Keeps identity stable and explicit.

## Migration Impact

- Backward compatible; adds optional controls and diagnostics.
- Documentation must include memory lifecycle guidance.

## Rollback Plan

- If validation is too noisy, keep diagnostics dev-only and configurable.

## Implementation (2026-07-27)

Delivered in `src/Atom.ts` (family internals) and `src/Hydration.ts`:

- **Family lifecycle / eviction controls.** `Atom.Family` now exposes
  `keys()`, `entries()`, and `size` for member enumeration (both the default
  reference-equality trie branch and the custom-`equals` branch share a single
  ordered `members` list). `FamilyOptions.capacity` bounds live members with
  insertion-order (FIFO) eviction, capping unbounded growth for open-ended key
  spaces. `evict(...args)` / `clear()` stay as before and now also prune the
  enumeration list.
- **Family hydration identity.** `Hydration.dehydrateFamily(registry, key,
  family, { filter? })` snapshots each live member with its identifying `args`
  as `DehydratedFamilyValue`. `hydrateFamilies` / `hydrateFamiliesEffect` call
  the client family with those `args` to obtain the *identical* member atom
  before restoring its value — member-for-member identity across SSR.
- **Validation modes.** `ValidationMode = "off" | "loose" | "strict"` (with
  `resolveMode` mapping the legacy `validate`/`strict` flags). `"off"` skips
  silently (zero-flicker first render preserved), `"loose"` reports drift via
  callbacks + `console.warn`, `"strict"` raises a typed `HydrationError`
  (`HydrationUnknownKeys` / `HydrationMissingKeys`). Applied uniformly to the
  scalar `hydrate`/`hydrateEffect` and the family variants.

Tests: `src/__tests__/effect-atom-api.test.ts` (enumeration, capacity/FIFO,
capacity-with-equals, family dehydrate/hydrate JSON round-trip, mode-based
drift reporting, strict Effect error). Gates green: `typecheck:all`, `npm test`
(583 passing).

Deferred: an eviction *policy* beyond FIFO (LRU/TTL) remains a v1.x follow-up;
router loader-cache integration is described in the implementation report, not
wired here (router files owned by another track).
