# ADR-002: Async Model Direction (Solid-style Suspension + Result Opt-in)

- Status: Accepted
- Date: 2026-03-10

## Context

The existing async surface mixes two models:

- `AsyncResult` (Loading/Refreshing/Success/Failure/Defect)
- `Result` (Initial/Success/Failure + waiting)

This has created conceptual overlap and migration friction.

## Decision

Adopt a Solid 2.0-style default async model:

1. **Default user model**: suspension + boundaries
   - Async atoms/queries suspend naturally.
   - `Loading` handles initial load.
   - `isPending` handles stale-while-revalidate UI.
2. **Explicit state model (opt-in)**: `Result`
   - Users can opt out of suspension (`suspend: false`) and receive `Result`.
   - `Result.builder(...)` is the fluent explicit rendering path.
3. **`AsyncResult` role**
   - Keep as internal/advanced compatibility type.
   - Remove it from the golden-path docs.

## Rationale

- Aligns with fine-grained UI ergonomics (boundaries + pending expressions).
- Preserves an explicit effect-atom-friendly path through `Result`.
- Reduces conceptual burden by making one default path obvious.

## API Implications

- Golden path docs use:
  - `Loading`
  - `isPending(() => expr)`
  - `Show` for refresh indicators
- Explicit path docs use:
  - `Result.builder(...)`
  - `suspend: false` where applicable
- `AsyncResult` is moved to advanced/internal docs.

## Migration Impact

- Existing `AsyncResult` users remain supported during transition.
- New docs/examples prioritize suspension + `Result.builder` opt-in path.
- `Async` component remains available as compatibility/advanced API.

## Rollback Plan

- If suspension-first defaults regress real apps, keep dual-model docs with stricter boundaries and retain `AsyncResult` as advanced documented model.
