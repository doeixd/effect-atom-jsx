# ADR-002: Async Model Direction (`Result` Primary, `FetchResult` Compatibility)

- Status: Accepted
- Date: 2026-03-10

## Context

The async surface historically mixed two models:

- `Result` (Loading/Refreshing/Success/Failure/Defect)
- `FetchResult` (Initial/Success/Failure + waiting)

This has created conceptual overlap and migration friction.

## Decision

Adopt a single primary async model:

1. **Primary user model**: `Result`
   - `defineQuery`, `atomEffect`, runtime atoms, RPC, and HTTP wrappers expose `Result`.
   - `Loading` and `isPending` remain first-class UI primitives over this model.
2. **Compatibility model**: `FetchResult`
   - Keep as advanced compatibility for effect-atom-style waiting semantics.
   - Conversion helpers are `FetchResult.fromResult(...)` and `FetchResult.toResult(...)`.

## Rationale

- Keeps one obvious default async model (`Result`).
- Preserves effect-atom-style data-state ergonomics through explicit compatibility namespace (`FetchResult`).
- Reduces naming overlap and migration ambiguity.

## API Implications

- Golden path docs use `Result`, `Loading`, and `isPending`.
- `FetchResult` is documented as advanced compatibility, not primary flow.
- Legacy `AsyncResult` naming is removed from public API/docs.

## Migration Impact

- Existing users migrate by replacing old conversion names with `fromResult` / `toResult`.
- New docs/examples prioritize `Result` as the default async surface.
- `Async` component remains available and consumes `Result`.

## Rollback Plan

- If compatibility pressure increases, expand `FetchResult` adapters without reintroducing dual primary async models.
