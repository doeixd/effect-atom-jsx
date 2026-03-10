# Current Status In Redesign Plan

Last updated: 2026-03-10
Plan reference: `docs/DESIGN_OVERHAUL_V1_PLAN.md`, `docs/V1_API_CONTRACT_DRAFT.md`, `docs/EFFECT_NATIVE_ENHANCEMENT_PLAN.md`

## Overall

- Redesign is actively in progress.
- We are taking a breaking-change-first approach to reduce API overlap and legacy aliases.
- Core direction is now visible in code (not only docs): smaller top-level exports, stronger action/query primitives, and clearer internal boundaries.

## Completed So Far

- Scope/lifecycle foundation is in place (component scope context + supervision wiring).
- `useService(...)` diagnostics improved for missing runtime/service cases.
- ADR set created for major design decisions (`docs/adr/ADR-001`..`ADR-005`).
- Async direction locked (ADR-002): suspension-first default, `Result` as explicit opt-in path.
- `Result.builder(...)` added for explicit rendering flows.
- `AsyncResult` moved out of top-level golden-path exports (advanced/internal boundary).
- New v1 primitives introduced:
  - `Atom.runtime(...).action(...)`
  - `Atom.action(...)`
  - `Atom.effect(...)`
- Reactivity invalidation integrated across action + RPC/HTTP client paths (`reactivityKeys`).
- Batching redesign started and shipped:
  - `flush()` added
  - microtask batching is now always on (sync mode removed)
- Strict API variants removed:
  - `queryEffectStrict`
  - `defineQueryStrict`
  - `mutationEffectStrict`
  - `defineMutationStrict`
- Legacy aliases removed:
  - `use` (kept `useService` only)
  - `refresh` alias (use `invalidate`)
  - `mountWith` alias
- Legacy wrappers removed:
  - `Atom.fn(...)`
  - `runtime.fn(...)`
  - sync scoped wrappers (`scopedRoot`, `scopedQuery`, `scopedMutation`)
- OO facade removed:
  - `signal(...)`
  - `computed(...)`
- Export tiering advanced:
  - top-level no longer re-exports reactive core + DOM runtime helpers
  - new `effect-atom-jsx/internals` subpath added

## Recently Completed Commits (most recent first)

- `b4f0bf4` refactor: move reactive core exports to internals subpath
- `dd41a61` refactor: remove signal/computed OO facade
- `9d82b43` refactor: remove sync scoped wrapper APIs
- `aa48c37` refactor: remove Atom.fn and runtime.fn mutation wrappers
- `294a75b` refactor: remove remaining service and mount aliases
- `ba20529` refactor: remove legacy top-level query/mutation exports
- `ac003d9` refactor: remove strict query and mutation API variants
- `ac843e5` feat: default to microtask batching with flush escape hatch

## In Progress / Next

- Continue top-level surface cleanup toward pure golden-path app API.
- Align docs to current reality after removals (no legacy alternatives).
- Continue v1 export-tiering (`core` vs `advanced` vs `internals`) and remove remaining overlap.
- Keep pushing declarative invalidation + action model through all high-level APIs.

## Update Rule For This File

Whenever redesign work lands:

1. Add/remove items in **Completed So Far**.
2. Add the new commit hash in **Recently Completed Commits**.
3. Refresh **In Progress / Next** to reflect the next actionable step.
4. Update the `Last updated` date.
