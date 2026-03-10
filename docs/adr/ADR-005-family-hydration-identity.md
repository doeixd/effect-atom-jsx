# ADR-005: Family Cache and Hydration Identity Strategy

- Status: Proposed
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
