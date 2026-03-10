# effect-atom-jsx v1 Design Overhaul Plan

Date: 2026-03-10
Status: Proposed (breaking changes allowed)
Owner: Core library redesign

## Intent

Redesign the public API to be smaller, clearer, and more coherent even if it requires major/breaking changes.

Success means:

- one obvious "golden path" for typical apps
- advanced escape hatches are explicit and isolated
- runtime/service behavior is predictable and type-guided
- async story is unified and documented without semantic ambiguity

## What Changes About Strategy

- We are no longer constrained to additive-only API evolution.
- We will prefer correctness and ergonomics over backward compatibility.
- We will still provide migration tooling/docs, but v1 may remove or rename APIs aggressively.

## Design Principles (v1)

1. One concept, one primary API.
2. Top-level exports are for app authors only.
3. Advanced/runtime internals move to explicit subpaths.
4. Async semantics must be explicit and composable.
5. Component/runtime/scope lifecycles are structurally enforced.
6. Observability should be structural and zero-cost when disabled.

## Target v1 Surface (Draft)

### Core app APIs

- `Atom.make` / `Atom.family` / `Atom.map`
- `defineQuery` / `defineMutation`
- `createMount` / `mount`
- `Loading` / `Errored` / `Show` / `For` / `Switch` / `Match`
- `refresh` / `isPending` / `latest`

### Advanced APIs (subpaths)

- `effect-atom-jsx/advanced`:
  - scoped constructors
  - raw `atomEffect`
  - explicit registry creation
- `effect-atom-jsx/internals`:
  - reactive primitives (`createSignal`, `createEffect`, etc.)

### Planned removals / consolidations (draft)

- Consolidate duplicated async entrypoints into tiered aliases then remove legacy names.
- Move low-level reactive exports out of top-level.
- Reclassify `Registry` as advanced unless golden-path prototype proves it should be implicit.
- Keep `AtomRef` as a first-class supported module for effect-atom compatibility.
- Improve `AtomRef` docs and interop guidance instead of deprecating it.

## Major Architecture Decisions to Finalize

1. **Async model**
   - Keep dual `AsyncResult` + `Result` with strict boundaries, or converge to one user-facing model.
2. **Registry model**
   - Ambient/implicit by default vs explicit in userland.
3. **Runtime model**
   - Ambient `mount/useService` primary vs explicit runtime-bound APIs primary.
4. **Export model**
   - Top-level minimal set + subpaths for advanced/internals.
5. **Identity model**
   - `Atom.family` lifecycle/eviction and hydration key strategy must be explicit.
6. **AtomRef interoperability model**
   - Preserve effect-atom familiarity while clarifying how `AtomRef` composes with Atom/query/mutation flows.

## Breaking Changes Policy

- Allowed in v1 with migration notes.
- Prefer renaming/removal over keeping confusing duplicates.
- Each breaking change requires:
  - rationale
  - before/after examples
  - migration snippet
  - codemod feasibility note

## Execution Plan

### Phase A - API Audit and Freeze

- Inventory all exports and classify into: core, advanced, internals, legacy.
- Freeze new API additions until the classification is complete.
- Publish v1 API contract draft for review.

Deliverables:

- `docs/V1_API_CONTRACT_DRAFT.md`
- export inventory table with recommended disposition

### Phase B - Golden Path Prototype

- Implement a full TodoMVC path using only target core APIs.
- Measure ceremony and conceptual load vs current README flow.
- Identify missing primitives required for real app development.

Deliverables:

- `examples/todomvc-v1/`
- migration comparison doc (old vs v1)

### Phase C - Async and Mutation Consolidation

- Settle query/mutation naming and strict-mode strategy.
- Keep temporary aliases for migration only.
- Add explicit state mapping docs and precedence rules.

Deliverables:

- unified async API section in docs
- deprecation map for legacy async names

### Phase D - Export Tiering

- Move low-level primitives to `/internals`.
- Move advanced APIs to `/advanced`.
- Keep transitional re-exports behind compatibility flag for one cycle (optional).

Deliverables:

- new subpath exports
- updated README import guidance

### Phase E - Identity and Hydration Hardening

- Finalize family eviction strategy.
- Ship hydration validation mode (done baseline) and key guidance.
- Add memory lifecycle docs and tests.

Deliverables:

- family eviction APIs/docs
- hydration mismatch diagnostics docs/tests

### Phase F - Cutover and Migration

- Publish migration guide and changelog with breaking matrix.
- Optionally provide codemods for renamed imports/APIs.
- Cut v1 prerelease and collect feedback.

Deliverables:

- `docs/V1_MIGRATION_GUIDE.md`
- v1 beta release checklist

## Non-Negotiable Acceptance Criteria

- README quick start uses only core APIs.
- Top-level exports are reduced and intentional.
- Async and mutation APIs are symmetric and easily teachable.
- Service/runtime errors are explicit and actionable.
- Tests cover lifecycle, cancellation, and migration aliases.

## Risks

- Breaking too much too quickly without migration aids.
- Losing power-user workflows if advanced APIs are hidden poorly.
- Incomplete async model migration causing conceptual split to persist.

## Mitigations

- Ship v1 beta with migration docs before stable.
- Keep a temporary compatibility layer with warnings.
- Validate with real example apps, not only unit tests.

## Immediate Next Steps

1. Draft `docs/V1_API_CONTRACT_DRAFT.md` with explicit keep/remove/rename decisions.
2. Build TodoMVC v1 prototype constrained to core APIs.
3. Decide async model direction (single vs dual with strict boundary) and lock it.
