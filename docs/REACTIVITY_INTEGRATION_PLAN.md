# Reactivity Integration Plan

This plan introduces a first-class `Reactivity` service for this library as the primary invalidation/notification substrate across atoms, queries, actions, routing loaders, and future framework bridges.

## 0) Alignment Check (project-specific)

- This repository is currently framework-agnostic with its own renderer/runtime, so React/Vue/Svelte/Angular bridge work is treated as **contract/docs only**, not required for core completion.
- Existing behavior must remain source-compatible for `Atom`, `defineQuery`, `defineMutation`, `Component.action`, and Router2 loader APIs.
- Effect service context remains the canonical context model (`Tag`/`Layer`), so Reactivity integration must be layer-driven and scope-safe.
- Subscriptions and listeners must be bound to scope/component lifecycle to avoid leaks.
- Any migration away from local atom subscriptions should be incremental and gated to avoid regressions.
- Primary implementation is owned in-repo (`Reactivity.live`, `Reactivity.test`) and provided via Layer.
- Optional backend adapters (including `@effect/experimental`) are secondary and must conform to the same in-repo service contract.

## 1) Direction and Non-Negotiables

- Adopt **Reactivity as the single source of truth** for invalidation fan-out.
- Preserve current `Atom` API ergonomics (no breaking usage changes for common cases).
- Keep existing semantic key invalidation (`reactivityKeys`) and make it first-class everywhere.
- Standardize scheduling behavior on **microtask-flush batching** (Solid 2 style), not immediate per-write synchronous notification.

## 2) Scheduling Model Decision

- Default invalidation flush: **microtask-batched**.
- Multiple synchronous writes queue invalidations and notify once per flush window.
- Provide explicit flush hooks for tests and deterministic assertions.
- Document this as canonical runtime behavior in API docs.

Why:
- Aligns with current batching goals and router loader orchestration.
- Reduces update storms and duplicate recomputations.
- Makes cross-framework bridge behavior deterministic.

Compatibility note:
- preserve a compatibility path for places that currently assume synchronous updates by providing explicit flush points in tests and internal boundaries.

Go/No-Go checkpoint:
- Before full migration, implement a narrow vertical spike (writable atom + one derived + one query + one route loader) and compare:
  - recomputation count
  - notification count
  - flush behavior under burst writes
  - code complexity
- If spike regresses core benchmarks or significantly increases complexity, pause and adjust adapter design before broad rollout.

## 3) Current State (what already exists)

- `Atom.withReactivity(...)` exists and can map semantic keys.
- action/mutation APIs already support `reactivityKeys` invalidation options.
- router loaders now have cache/refresh helpers and can consume reactivity keys.
- internal atom graph still has local subscription machinery in parallel with reactivity pathways.

## 4) Target Architecture

## 4.1 Core model

- Every atom has `reactivityKeys` (identity + optional semantic keys).
- Reads register dependency interest in current tracking scope.
- Writes invalidate keys through Reactivity.
- Derived atoms subscribe to source keys through Reactivity and invalidate their own key on recompute.
- Async/query atoms re-execute on watched key invalidation and publish results through their own key.

## 4.2 Service boundary

- Define library-owned `Reactivity` service contract (Tag) and require it in runtime-powered paths.
- Graceful fallback when no service is provided (best-effort local invalidation for standalone usage).
- Ship `Reactivity.live` (microtask-batched) and `Reactivity.test` (manual flush + inspection).

Service contract (target):

- `invalidate(keys)`
- `subscribe(keys, onInvalidate)`
- `flush()`
- optional debug hooks (`lastInvalidated`, `pendingCount`) in test/dev layers.

## 4.3 Framework bridge contract

- Keep renderer/framework integration thin:
  - subscribe to atom keys via Reactivity
  - trigger host update mechanism (`forceUpdate`, `ref.value`, signal set, etc.)
- No framework-specific atom graph logic.

## 5) API Additions / Clarifications

## 5.1 Public API additions (minimal)

- `Atom.reactivityKeys(atom)` helper (introspection)
- `Atom.invalidate(keys)` alias to unified reactivity invalidation entrypoint
- `Atom.flushReactivity()` testing/dev helper (no-op if unsupported)
- `Reactivity` namespace export with:
  - `Reactivity.Tag`
  - `Reactivity.live`
  - `Reactivity.test`
  - optional `Reactivity.fromExperimental(...)` adapter layer

## 5.2 Existing API behavior clarifications

- `Atom.withReactivity(...)` augments atom keys; does not replace identity key.
- `reactivityKeys` on action/mutation invalidates semantic keys and triggers dependent atom/query refresh.
- Router2 loaders using `reactivityKeys` participate in same invalidation bus.

## 5.3 Documentation contract

- Explicitly state microtask batching semantics and test-time flush guidance.
- Show semantic-key invalidation patterns (global key, hierarchical key, per-entity key).

## 6) Implementation Phases

## Phase A — Reactivity Runtime Abstraction

Files:
- `src/reactivity-runtime.ts` (new)
- `src/Reactivity.ts` (new)
- `src/Atom.ts`

Work:
- Introduce library-owned service + internal adapter with methods:
  - `invalidate(keys)`
  - `subscribe(keys, cb)`
  - `flush()`
  - `trackRead(keys)`
- Implement in-repo `Reactivity.live` with microtask batching.
- Implement in-repo `Reactivity.test` with explicit flush/introspection.
- Keep optional adapter acquisition strategy:
  - prefer provided library Reactivity service
  - fallback to local no-op/legacy adapter when absent
  - optional `fromExperimental` adapter layer for interoperability.

Acceptance:
- Adapter can power invalidate/subscribe/flush independently of atom internals.
- In-repo service contract is stable and independent from external experimental package shape.

## Phase B — Atom Write Path Migration

Files:
- `src/Atom.ts`
- `src/reactive.ts` (if needed)

Work:
- Route all writable atom mutations (`set/update/modify`) through adapter invalidation.
- Ensure single microtask flush per sync write burst.
- Remove duplicated notification where Reactivity already covers behavior.
- Keep legacy `.subscribe` behavior operational during migration (implemented atop adapter where possible).

Acceptance:
- Batched invalidation semantics verified by tests.

## Phase C — Derived/Dependency Tracking via Reactivity

Files:
- `src/Atom.ts`
- `src/tracking.ts`

Work:
- On derived compute, capture source keys.
- Subscribe derived key to source keys through adapter.
- Recompute + invalidate derived key on source invalidation.
- Add cycle/duplicate-subscription guards to avoid runaway recomputation in deep graphs.

Acceptance:
- Deep derived chains recompute predictably and only once per batch.

## Phase D — Async/Query Reactivity Unification

Files:
- `src/effect-ts.ts`
- `src/Atom.ts`
- `src/router-runtime.ts`

Work:
- Ensure query atoms and Route loaders share same invalidation paths.
- On key invalidation, refresh relevant queries/loaders and update their `Result` atoms.
- Preserve stale-while-revalidate behavior.
- Ensure `Result` contract remains the only async UI state model (no new route/query-specific state unions).

Acceptance:
- One invalidation key can refresh atom queries + route loaders together.

## Phase E — Mutation/Action Invalidation Consistency

Files:
- `src/effect-ts.ts`
- `src/Route.ts`

Work:
- Normalize post-success invalidation handling for:
  - `defineMutation`
  - `Component.action`
  - `Route.action`
- Ensure all use common invalidation function.

Acceptance:
- No divergent invalidation behavior across mutation APIs.

## Phase F — Test Reactivity Layer + Deterministic Flush

Files:
- `src/testing.ts`
- `src/__tests__/reactivity-*.test.ts` (new)

Work:
- Add test reactivity layer with manual `flush` and last-invalidated inspection.
- Add regression coverage for microtask batching and dependency fan-out.
- Add ordering tests for nested derived updates and cross-query/loader shared-key invalidation.

Acceptance:
- Tests can assert intermediate pre-flush state and post-flush state deterministically.

## Phase G — Router2 Reactivity Coupling (already partial)

Files:
- `src/router-runtime.ts`
- `src/Route.ts`
- `src/__tests__/route-loader-reactivity.test.ts` (new)

Work:
- Route loader cache entries subscribe to declared `reactivityKeys`.
- Invalidation marks stale and triggers active route revalidate.
- Prefetched entries revalidate consistently.

Acceptance:
- Mutation invalidation refreshes matching loaders without manual route refresh calls.

## Phase H — Bridge Contracts for Host Frameworks

Files:
- `src/framework-bridge.ts` (new internal contract)
- docs only for now (implementation per adapter later)

Work:
- Define minimal bridge interface around `subscribe(keys, cb)`.
- Document React/Vue/Svelte/Angular usage pattern.
- Do not ship host bridge implementations in this repo phase; keep as examples/contracts to avoid scope creep.

Acceptance:
- Host adapters can be implemented with minimal framework-specific code.

## Phase I — Documentation and Migration

Files:
- `README.md`
- `docs/API.md`
- `docs/ROUTER_IMPLEMENTATION_PLAN.md` (cross-reference)
- `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md`
- `CHANGELOG.md`

Work:
- Add canonical guide: "Reactivity model and batching semantics".
- Clarify legacy/internal subscription behavior deprecation path.
- Provide migration recipes from manual invalidate lists to semantic keys.

Acceptance:
- Docs reflect one unified invalidation model.

## 7) Test Matrix

- Unit tests:
  - write burst -> single batched invalidate flush
  - derived recompute once per batch
  - semantic key fan-out to multiple atoms
  - fallback behavior without Reactivity service
- Integration tests:
  - mutation invalidation refreshes query atoms
  - mutation invalidation refreshes route loaders
  - query and loader both refresh on shared key
- Type tests:
  - `withReactivity` key typing remains stable
  - action/mutation `reactivityKeys` typing unchanged

## 8) Risk Areas and Mitigations

- Duplicate notifications during transition period:
  - gate legacy local subscriptions behind adapter and remove once parity verified.
- Hidden sync assumptions in old tests:
  - update tests to explicit flush semantics.
- Service absence in standalone scripts:
  - keep fallback adapter and document reduced capabilities.
- Subscription lifecycle leaks:
  - require scope-bound subscriptions and add dedicated leak regression tests.
- Partial migration drift (some paths bypassing Reactivity):
  - add static grep checks/tests to ensure all mutation/query/loader invalidation paths use the shared adapter.
- Backend lock-in risk:
  - keep library-owned service contract as the only internal dependency boundary; adapters are replaceable.

## 9) Delivery Order (Practical)

1. Phase A-B-C (core adapter + atom write/read migration)
2. Phase D-E (query/mutation/router unification)
3. Phase F-G (test layer + loader coupling hardening)
4. Phase H-I (bridge contract + docs/migration)

## 10) Definition of Done

- `Reactivity` is the primary invalidation path for atom/query/loader updates.
- Microtask batching semantics are documented and enforced by tests.
- Full suite green: `npm run typecheck`, `npm test`, `npm run build`, `npm pack --dry-run`.
- Status/changelog/docs updated with the unified model.
- Legacy compatibility retained: existing public APIs/tests pass without required userland changes.
- Router2 + query + atom invalidation all verifiably flow through the same adapter path (no side-channel notification systems left active by default).
