# v1 API Contract Draft

Date: 2026-03-10
Status: Draft
Depends on: `docs/DESIGN_OVERHAUL_V1_PLAN.md`

## Goal

Define the v1 public API with explicit keep/move/deprecate/remove decisions.

This draft is intentionally opinionated and allows breaking changes.

## Tier Definitions

- `core`: default app-author API, documented in Quick Start.
- `advanced`: supported but not required for most apps.
- `internals`: low-level runtime/reactivity helpers; no stability guarantees for casual usage.
- `legacy`: temporary compatibility aliases targeted for removal after migration window.

## Top-Level Export Decisions (`effect-atom-jsx`)

### Namespace exports

| Export | v1 Decision | Tier | Notes |
|---|---|---|---|
| `Atom` | Keep | core | Primary state namespace |
| `AtomRef` | Keep | core | Kept for effect-atom compatibility |
| `AtomSchema` | Keep | core | Distinct value proposition |
| `AtomRpc` | Keep | advanced | Power-user/service integrations |
| `AtomHttpApi` | Keep | advanced | Power-user/service integrations |
| `AtomLogger` | Keep | advanced | Supplemental to structural observability |
| `Hydration` | Keep | advanced | SSR-focused API |
| `Result` | Keep | core (explicit opt-in path) | Fluent explicit rendering path for non-suspense flows |
| `Registry` | Keep | advanced | Explicit registry remains supported |

### Primary function exports

| Export | v1 Decision | Tier | Notes |
|---|---|---|---|
| `defineQuery` | Keep | core | Canonical read/query API |
| `defineMutation` | Keep | core | Canonical mutation API |
| `createMount` / `mount` | Keep | core | Canonical runtime entry |
| `useService` / `useServices` | Keep | core | Keep with strong diagnostics |
| `refresh` / `isPending` / `latest` | Keep | core | Core async UI controls |
| `Loading` / `Errored` / `Show` / `For` / `Switch` / `Match` | Keep | core | Core rendering controls |
| `createOptimistic` | Keep | core | Mutation UX primitive |
| `queryEffect` / `mutationEffect` | Removed | removed | Use `defineQuery` / `defineMutation` |
| `queryEffectStrict` / `mutationEffectStrict` | Removed | removed | Use `queryEffect(..., { runtime })` / `mutationEffect(..., { runtime })` |
| `defineQueryStrict` / `defineMutationStrict` | Removed | removed | Use `defineQuery(..., { runtime })` / `defineMutation(..., { runtime })` |
| `atomEffect` | Keep | advanced | Explicit low-level async primitive |
| `scoped*` constructors | Keep | advanced | Move off top-level docs |

### Reactive core exports currently top-level

| Export group | v1 Decision | Target | Notes |
|---|---|---|---|
| `createSignal`, `createEffect`, `createMemo`, `createRoot`, etc. | Move | `effect-atom-jsx/internals` | Not part of default app API |
| `batch`, `sample`, `untrack` | Move | `effect-atom-jsx/internals` | Keep compatibility alias temporarily |
| `getOwner`, `runWithOwner` | Move | `effect-atom-jsx/internals` | For advanced integrations only |

### DOM runtime helpers currently top-level

| Export group | v1 Decision | Target | Notes |
|---|---|---|---|
| `template`, `insert`, `createComponent`, etc. | Move | `effect-atom-jsx/runtime` only | Plugin/runtime concern, not app concern |
| SSR helpers (`renderToString`, `hydrateRoot`, etc.) | Keep | advanced | Retain explicit SSR API |

## Package Export Map Changes (draft)

### Keep

- `.`
- `./runtime`
- `./testing`
- `./Atom`, `./AtomRef`, `./AtomSchema`, `./Hydration`, `./Result`, `./Registry`, `./AtomRpc`, `./AtomHttpApi`, `./AtomLogger`

### Add

- `./advanced` (scoped constructors, explicit low-level effect helpers)
- `./internals` (reactive primitives + owner/runtime internals)

Status update: `./internals` export path has been added; top-level now omits reactive-core and dom runtime helper re-exports.

### Transitional

- Keep top-level compatibility re-exports for one beta cycle with warnings in docs.

## Breaking Change Matrix (initial)

| Change | Type | Migration path |
|---|---|---|
| Reactive core moved from top-level to `/internals` | breaking | replace imports to `effect-atom-jsx/internals` |
| `queryEffect` and `mutationEffect` become legacy aliases | soft-breaking/docs-first | rename to `defineQuery` / `defineMutation` |
| Strict variants consolidated | breaking (if removed) | use options-based strictness or `/advanced` |
| DOM runtime helper top-level exports removed | breaking | import from `effect-atom-jsx/runtime` |

## Open Decisions Before Lock

1. Async model: locked by ADR-002 -> suspension-first default + `Result` opt-in; finalize API signatures.
2. Registry ergonomics: default implicit in JSX vs explicit everywhere.
3. Final strictness API shape: option flags vs dedicated constructors.

## Pending Major Additions for v1 Redesign

- Runtime actions API (`apiRuntime.action`) with linear Effect-generator mutation flow. (Started)
- Runtime read API simplification (`apiRuntime.atom`) as the canonical query/read primitive.
- Standalone effect primitive rename/alignment (`Atom.effect`) for non-runtime async sources. (Started)
- Declarative invalidation path (`withReactivity` / `reactivityKeys`) alongside imperative `refresh`. (Started)
- Microtask batching model + `flush` escape hatch evaluation. (Started)

## Exit Criteria for This Draft

- `package.json` exports update plan drafted before implementation.
