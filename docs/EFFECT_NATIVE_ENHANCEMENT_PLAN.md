# Effect-Native Enhancement Plan

Date: 2026-03-10
Status: Proposed
Scope: Implement seven high-impact improvements to align `effect-atom-jsx` more deeply with Effect's structured concurrency, typed errors, and observability model.

## Goals

- Map component lifetimes to Effect scopes so cleanup is transitively safe.
- Move service requirements toward compile-time guarantees.
- Add first-class query concurrency policies and timing controls.
- Auto-bind `@effect/rpc` routers into query/mutation primitives.
- Add typed error boundaries that understand Effect error channels.
- Add structural tracing/metrics with minimal manual setup.
- Make PubSub and stream operators first-class reactive sources.

## Non-Goals (for this plan)

- Rewriting the reactive core (`Signal`, `Computation`, `Owner`).
- Breaking existing APIs (`queryEffect`, `defineQuery`, `mutationEffect`, `AtomRpc.Tag`, `AtomHttpApi.Tag`).
- Requiring tracing packages for all users by default.

## Current Baseline (Reference)

- Owner tree and cleanup: `src/owner.ts`, `src/api.ts`, `src/dom.ts`
- Effect integration + scoped helpers: `src/effect-ts.ts`
- Query/mutation APIs: `src/effect-ts.ts`
- Stream/queue adapters: `src/Atom.ts`
- RPC/HTTP wrappers: `src/AtomRpc.ts`, `src/AtomHttpApi.ts`
- Logging utility (opt-in): `src/AtomLogger.ts`

## Proposed Delivery Strategy

- Ship across multiple small PRs, each independently testable.
- Preserve old behavior as default unless user opts in.
- Introduce internal abstractions first, then public APIs.
- Prefer additive overloads and helpers over API replacement.

## Review-Driven Adjustments (2026-03-10)

- Keep Phase 1 as strict foundation work before feature-facing APIs.
- Validate detached-root behavior: `createRoot` outside a component tree should create a detached scope, not fail on missing parent scope.
- Treat Phase 2 as an ergonomics-risk phase and gate final API on real-app validation (TodoMVC or similar medium-sized example).
- Define explicit precedence between local async error handling and boundary catching before implementing typed boundaries.
- For observability, enforce "zero-cost by default": no tracer/metrics service means no emitted spans/metrics work.
- Add sampling/cardinality controls in the first observability release, not later.
- Revisit stream shaping API to support both atom-level and query-source-level composition patterns.

## Deep API Review Additions (2026-03-10)

The following track incorporates a deeper architecture/API review focused on reducing conceptual load and clarifying a single golden path.

### Golden path target (user-facing)

- Read/write atoms directly in UI code without explicit registry ceremony.
- Use one primary query API and one primary mutation API for most apps.
- Keep Effect-first and scope-first variants as explicit advanced escape hatches.
- Make service/runtime wiring obvious at the app boundary.

### Guiding principles

- Prefer one obvious pattern per use-case (read/write, query, mutation, hydration).
- Keep "advanced" APIs available but move them to clearly marked modules/docs.
- Reduce top-level API ambiguity through naming, tiering, and deprecations.
- Preserve backward compatibility with aliases/migration guides before removals.

## API Simplification Workstream (parallel to Phases 2-7)

This workstream runs in parallel with feature phases and feeds API decisions back into implementation.

### Track A - Registry ergonomics and atom read/write unification

#### Objective

Make JSX usage registry-implicit while keeping explicit registry APIs for non-JSX and advanced scenarios.

#### Plan

- Introduce a component-ambient registry access pattern (`useRegistry`) for advanced cases.
- Prototype callable/ergonomic atom reads in JSX (`atom()` style) and evaluate migration impact.
- Keep `Registry.make()` for tests/servers/standalone scripts, but move docs to advanced section.
- Clarify write path guidance:
  - primary UI path: direct atom writes (`set` / `update` pattern)
  - Effect composition path: Effect-returning helpers in explicit namespace/module

#### Edge cases

- Shared atoms observed from multiple component trees with different registry lifetimes.
- Mixed write paths (direct + Effect-based) with concurrent updates.
- Subscription consistency when a read occurs in JSX and in external registry listeners.

#### Docs/tests tasks

- Add explicit consistency guarantees for mixed write paths.
- Add race-condition tests (interleaved direct and Effect-based writes).
- Document registry as "implicit by default, explicit for advanced use".

### Track B - Runtime and service access model clarity

#### Objective

Reduce ambiguity between ambient runtime (`mount` / `useService`) and explicit runtime-bound APIs.

#### Plan

- Evaluate elevating `Atom.runtime(layer)` style as first-class documentation path (possibly alongside mount-based sugar).
- Keep `useService` but improve diagnostics now:
  - missing ambient runtime error must be actionable
  - missing service error should include available service keys when feasible
- Align typed requirements (Phase 2) with whichever runtime model is declared primary.

#### Edge cases

- Multiple runtimes in one app tree.
- `WithLayer` boundaries interacting with service requirement typing.
- Dynamic components crossing runtime boundaries.

#### Docs/tests tasks

- Add side-by-side examples: ambient mount vs explicit runtime-bound atoms.
- Add diagnostic snapshot tests for service lookup errors.

### Track C - Async primitive consolidation and naming

#### Objective

Reduce async API surface complexity and make capability boundaries obvious.

#### Plan

- Define three-tier async API documentation model:
  - Tier 1 (default): query + mutation high-level APIs
  - Tier 2: custom reactive async (`atomEffect`-style)
  - Tier 3: scope/Effect-constructor escape hatches
- Evaluate introducing naming symmetry (`defineMutation` counterpart to `defineQuery`).
- Evaluate strict-mode options vs separate `*Strict` functions (migration via aliases).
- Clarify distinction between raw reactive execution and cache/invalidation-enabled queries.

#### Edge cases

- Migration path from `queryEffect` to keyed/invalidation-aware queries.
- Keeping scoped constructors discoverable for advanced users without cluttering defaults.

#### Docs/tests tasks

- Add API matrix showing "recommended", "advanced", and "legacy alias" entries.
- Add deprecation warning strategy (soft docs deprecation first).

### Track D - Async state model coherence (`AsyncResult` vs `Result`)

#### Objective

Resolve semantic confusion between fiber-lifecycle state and data-fetch state.

#### Plan

- Write explicit comparison doc:
  - what each state machine models
  - where conversion is lossy
  - recommended usage boundaries
- Evaluate renaming `Result` to clearer domain name (e.g. `FetchState`) or reducing dual-surface exposure.
- Clarify `Async` state mapping defaults (Loading/Refreshing/Failure/Defect behavior).

#### Edge cases

- `Refreshing(previous success)` conversion semantics.
- Defect propagation across boundaries when mapped to data-level state.

#### Docs/tests tasks

- Add conversion round-trip tests documenting intentional loss.
- Add table in README/API docs for `Async` slot precedence and default collapse behavior.

### Track E - Atom families, hydration, and memory safety

#### Objective

Harden real-world state identity features (family caches and hydration keys).

#### Plan

- Expand `Atom.family` with explicit cache lifecycle strategy:
  - decide on eviction API (`evict`, `clear`, optional TTL)
  - document key stability requirements
- Add hydration validation mode:
  - unknown server keys
  - missing client registrations
- Evaluate optional keyed-atom registration helpers to reduce manual hydration wiring.

#### Edge cases

- Long-lived sessions with unbounded family key growth.
- Silent hydration drift when key names change.

#### Docs/tests tasks

- Add family docs section with memory warning + eviction patterns.
- Add hydration mismatch warnings in development mode and corresponding tests.

### Track F - Public export surface cleanup

#### Objective

Separate golden-path APIs from low-level internals to reduce accidental misuse.

#### Plan

- Audit top-level exports and classify each as:
  - core user API
  - advanced API
  - internal/runtime primitive
- Move low-level reactive core exports behind explicit subpath if feasible.
- Keep compatibility exports during migration window.

#### Edge cases

- Existing users importing core primitives from top-level.
- Tooling/docs links relying on current export locations.

#### Docs/tests tasks

- Add migration map for moved exports.
- Add compatibility tests for subpath exports.

### Track G - Batching semantics clarity

#### Objective

Clarify and simplify batching guarantees across atom layer and reactive core.

#### Plan

- Document exact semantics of current `batch`/`Atom.batch` interaction.
- Evaluate unifying into one recommended batch API.
- Evaluate optional `flush` escape hatch if microtask batching model is adopted.

#### Edge cases

- Nested batches across atom writes and signal writes.
- DOM update timing guarantees expected by users.

#### Docs/tests tasks

- Add timing tests for batched writes and DOM commit behavior.
- Add one canonical batching recommendation in README.

## Phase 0 - Architecture and API Design Notes

### Things to do

- Define internal RFC notes in this file before coding each phase.
- Lock naming and defaults for new options to avoid churn.
- Add compatibility table to docs for old vs new behavior.

### Considerations

- Existing tests are broad; new behavior should be validated with targeted tests first, then integration tests.
- Avoid hidden runtime costs in hot paths (especially query reactivity loops).

### Edge cases

- Components mounted outside Effect runtime must fail clearly, not silently.
- Concurrent invalidations while unmounting should not leak fibers or queue tasks.

## Phase 1 - Structured Fiber Supervision (Component Tree -> Scope Tree)

### Objective

Guarantee that parent unmount interrupts all descendant fibers transitively by binding each component owner to a child `Scope`.

### Implementation plan

- Add internal `ScopeContext` near `ManagedRuntimeContext` in `src/effect-ts.ts`.
- At root mount (`mount`) create a root closeable scope and provide it via context.
- In component creation path (`createComponent` / root boundaries), create child scope from current scope.
- Register scope close in owner cleanup and owner dispose as scope finalizer (bidirectional cleanup).
- Ensure `queryEffect`/`mutationEffect` launched fibers are associated with current scope.

### Notes/considerations

- `scopedRoot*` already exists; avoid duplicating semantics. Reuse these primitives internally where possible.
- Interrupt should remain best-effort, but scope closure should become the source of truth.
- Keep behavior stable for existing code that only uses owner cleanup.

### Edge cases

- Rapid mount/unmount in the same tick.
- Nested roots (`createRoot` inside component) with partial disposal.
- Detached root usage (`createRoot` in utility modules) with no parent component scope.
- HMR disposal and remount while async query is in-flight.
- Scope finalizer throwing; cleanup must continue.

### Tests

- Add in `src/__tests__/effect.test.ts`:
  - parent dispose interrupts descendant query fibers
  - nested component unmount interrupts all grandchildren
  - no double-finalization when both owner and scope close
  - scope close order remains deterministic

### Docs/examples/comments

- Update `README.md` lifecycle language: component unmount is now scope-backed.
- Update `docs/API.md` for lifecycle guarantees.
- Add short inline comments in new scope bridge code (only non-obvious logic).

## Phase 2 - Typed Service Requirements on Components

### Objective

Expose a typed component contract that declares required services and enables compile-time mount validation.

### Proposed API shape

```ts
const App = Component.require(Api, Db)(() => {
  const api = useService(Api);
  return <div />;
});
```

### Implementation plan

- Add `Component` namespace helper in `src/effect-ts.ts` (or a focused module re-exported from `src/index.ts`).
- Brand component type with `RequiredServices` phantom type.
- Add typed overloads to `mount`/`createMount` so provided layer output satisfies required services.
- Keep untyped function components working exactly as today.

### Notes/considerations

- Type-level constraints should not reduce inference quality for props.
- Avoid requiring users to wrap every component; make it opt-in and composable.
- Prototype against a realistic app graph (>=30 components, multiple HOCs/dynamic components) before freezing API.
- Validate that service requirement propagation is understandable at mount sites.

### Open design questions

- Requirement composition model:
  - If `App` requires `Api` and renders `Panel` requiring `Db`, should mount require `Api | Db` (union of full tree requirements)?
  - Should composition be explicit (`Component.compose`) or inferred via typed wrappers?
- Dynamic component rendering:
  - How should `Dynamic` enforce/relax requirements for runtime-selected components?

### Edge cases

- Higher-order components forwarding props and preserving requirements.
- Components with zero requirements.
- Required service unions/intersections across composed components.

### Tests

- Add compile-time type fixtures (tsc-based) for:
  - success when layer satisfies requirements
  - error when service is missing
  - inference preserved for props and service tags
  - HOC wrapping preserves and/or widens requirement types correctly
  - dynamic component selection has predictable typing behavior
- Add runtime tests confirming no behavior regression for existing components.
- Add prototype validation checklist against TodoMVC-sized example before API lock.

### Docs/examples/comments

- Add a new README section: "Typed service requirements".
- Add examples under `examples/` (small app using `Component.require`).
- Add migration notes: optional feature, no breaking changes.

## Phase 3 - First-Class Query Concurrency Controls

### Objective

Support declarative query concurrency (`switch`, `queue`, `drop`), optional `max`, deduplication, and `staleTime`.

### Proposed API shape

```ts
const users = defineQuery(() => useService(Api).listUsers(), {
  name: "users",
  concurrency: { strategy: "switch", max: 3 },
  deduplication: true,
  staleTime: "30 seconds",
});
```

### Implementation plan

- Extend query options in `src/effect-ts.ts` with new `concurrency`, `deduplication`, `staleTime`.
- Add internal query scheduler:
  - `switch`: current behavior (interrupt previous)
  - `queue`: enqueue reruns (`Queue`)
  - `drop`: ignore triggers while busy
  - `max`: semaphore cap for concurrent work (`Semaphore`)
- Add dedupe registry by query key + dependency fingerprint.
- Add stale cache timestamp tracking.

### Notes/considerations

- Preserve existing default semantics: `switch`, no dedupe, no stale cache.
- `staleTime` should avoid unnecessary first-read requests when fresh cache exists.
- Be explicit about whether dedupe is per-query-instance or global by key.

### Edge cases

- Invalidations arriving during pending queue drain.
- `drop` strategy starving updates if stream is noisy.
- `staleTime` clock skew in SSR/client hydration scenarios.
- Defect vs typed error handling during queued runs.

### Tests

- New tests in `src/__tests__/effect.test.ts` and/or dedicated query policy suite:
  - each strategy behavior under burst invalidation
  - `max` parallel cap respected
  - dedupe suppresses duplicate in-flight run
  - stale cache serves value and revalidates correctly

### Docs/examples/comments

- Update README query section with policy table.
- Add TodoMVC-style example showing queue/drop/switch tradeoffs.
- Document defaults and anti-patterns (over-queuing).

## Phase 4 - Deeper RPC Auto-Binding from Router

### Objective

Given an `@effect/rpc` router, generate query/mutation bindings with auto-invalidation wiring.

### Proposed API shape

```ts
const api = AtomRpc.fromRouter(MyRouter, { runtime });
// api.user.get -> query ref/accessor
// api.user.save -> mutation handle
```

### Implementation plan

- Add `fromRouter` to `src/AtomRpc.ts` (and optionally parallel helper in `AtomHttpApi.ts`).
- Build route metadata mapper to:
  - derive query vs mutation helpers
  - derive key namespaces
  - derive invalidation graph from schema annotations/options
- Keep existing `Tag()` API unchanged.

### Notes/considerations

- Router metadata availability may vary; provide explicit override hooks.
- Avoid hard coupling to unstable internals in `@effect/rpc`.

### Edge cases

- Dynamic route params and stable key serialization.
- Endpoints that are semantically mutations but named like reads.
- Cyclical or broad invalidation rules causing cascade refresh storms.

### Tests

- Extend `src/__tests__/atom-rpc-httpapi.test.ts`:
  - generated query binding returns typed results
  - mutation auto-invalidates relevant queries
  - manual override beats inferred invalidation rule

### Docs/examples/comments

- Add new RPC auto-binding section to README and API docs.
- Add an example app showing router-derived client usage.

## Phase 5 - Effect-Native Typed Error Boundaries

### Objective

Allow typed `Failure<E>` to bubble through component tree and be caught by typed boundaries, distinct from defects.

### Proposed API shape

```ts
<TypedBoundary
  catch={UserNotFound}
  fallback={(err) => <p>{err.message}</p>}
>
  <UserPanel />
</TypedBoundary>
```

### Implementation plan

- Add boundary context and bubbling mechanism in `src/effect-ts.ts`.
- Extend `AsyncResult` handling utilities with boundary-aware propagation helpers.
- Differentiate typed failures (`Failure<E>`) and defects (`Defect`) in boundary resolution.

### Notes/considerations

- Existing `Async` and `Errored` should remain valid local render utilities.
- Boundary behavior should be explicit for `Loading`/`Refreshing` states.

### Precedence rule (must be explicit)

- Local-first by default:
  - If `Async` handles failure locally (e.g., `Errored` branch / local matcher), typed boundary is not invoked.
  - If failure is unhandled locally, it bubbles to nearest matching typed boundary.
- Provide an opt-in boundary-first mode only if a clear use-case appears; do not default to it.

### Edge cases

- Nested boundaries with overlapping catch predicates.
- Refresh cycles where previous failure exists in `Refreshing(previous)`.
- Boundaries in SSR output and hydration consistency.

### Tests

- Add boundary tests:
  - nearest matching boundary catches failure
  - defect path routes to defect handler
  - uncaught typed error surfaces with clear diagnostics

### Docs/examples/comments

- Add typed boundary recipes and failure taxonomy in docs.
- Include guidance for domain error modeling patterns.

## Phase 6 - Observability by Default (Structural Spans/Metrics)

### Objective

Emit traces/metrics for query, mutation, invalidation, and reactive updates automatically.

### Implementation plan

- Add internal instrumentation hooks around:
  - query start/finish/fail/interrupt
  - mutation start/finish/fail
  - invalidation triggers and fan-out
  - optional render/update checkpoints
- Integrate with Effect tracing/metrics APIs.
- Add global config to enable/disable and set verbosity.

### Notes/considerations

- Default should be low-overhead and production-safe.
- Ensure instrumentation failures never break app logic.
- Keep `AtomLogger` as local debugging utility, not primary telemetry path.
- Sampling/cardinality controls are required in v1 of this feature.

### Required defaults

- Zero-cost default: if no tracer/metrics services are provided, instrumentation path should short-circuit immediately.
- Conservative cardinality: avoid embedding high-cardinality dynamic identifiers in metric labels by default.
- Config knobs: global sampling rate, redaction/normalization strategy for query keys, and per-feature toggles.

### Edge cases

- High-frequency queries causing metric cardinality explosion.
- Recursive invalidation loops creating noisy spans.
- Runtime absence in tests/SSR fallback paths.

### Tests

- Add instrumentation tests with mock span sink:
  - emits expected span names and attributes
  - can be disabled globally
  - no crashes if sink unavailable

### Docs/examples/comments

- Add observability section with example trace flow.
- Document attribute naming conventions and recommended dashboards.

## Phase 7 - PubSub and Stream Operators as First-Class Sources

### Objective

Provide `fromPubSub` plus built-in Effect-native `debounce`/`throttle` alternatives for reactive input flows.

### Proposed API shape

```ts
const events = Atom.fromPubSub(pubsub, initial);
const search = Atom.Stream.debounce(queryStream, "250 millis");
```

### Implementation plan

- Add `Atom.fromPubSub` in `src/Atom.ts` using `PubSub.subscribe` -> `Dequeue` -> `fromQueue`.
- Add stream shaping helpers under `Atom.Stream` namespace for debounce/throttle.
- Ensure helpers retain structured cleanup and owner scope behavior.

### Notes/considerations

- API should compose with existing `fromStream`/`fromQueue` semantics.
- Keep operator naming consistent with Effect stream terminology.
- Decide early whether shaping helpers are:
  - Atom-returning utilities (`Atom.Stream.debounce(atomLike, duration)`),
  - source combinators used in query definitions,
  - or both via overloads.
- Favor composability with `defineQuery` reactive sources.

### Edge cases

- PubSub backpressure strategy mismatch with UI expectations.
- Dropped messages on fast producer + slow consumer.
- Debounce/throttle behavior during unmount and remount.

### Tests

- Extend `src/__tests__/atom-stream.test.ts`:
  - `fromPubSub` receives offered values
  - cleanup unsubscribes consumers on dispose
  - debounce coalesces rapid emissions
  - throttle limits emission frequency
  - query-source composition pattern works with debounce/throttle helpers

### Docs/examples/comments

- Add search input example using stream debounce.
- Add cross-component event bus example with PubSub.

## Cross-Cutting Work Items (All Phases)

### Documentation

- Update `README.md` feature list and quick-start snippets when APIs land.
- Update `docs/API.md` for each new export/options shape.
- Add a "Behavior Changes" section in changelog entries.
- Add migration notes where defaults or semantics may surprise existing users.
- Restructure README to learning path format:
  - Quick Start (golden path)
  - Advanced patterns
  - Internals / library-author APIs

### Examples

- Add or update examples for:
  - golden-path app (minimal API surface)
  - typed service requirements
  - query concurrency strategies
  - router auto-binding
  - typed boundaries
  - observability flow
  - PubSub/debounce usage
  - family eviction and hydration validation

### Tests

- Unit tests: new low-level scheduling/scope logic.
- Integration tests: real component trees and mount/unmount paths.
- Type tests: compile-time requirement enforcement.
- Regression tests: ensure current APIs still behave identically by default.
- Add API-ergonomics snapshot tests for docs-driven recommended patterns.

### Comments and code quality

- Add comments only where behavior is non-obvious (scope ownership, scheduler policy transitions, dedupe cache semantics).
- Keep public types and JSDoc examples up-to-date with final signatures.
- Avoid introducing broad `any` in new public APIs.

## Rollout and Risk Management

### PR sequence (recommended)

1. Internal scope tree plumbing + tests
2. API simplification RFC + golden-path doc skeleton (no breaking changes)
3. Typed component requirements + type tests
4. Query concurrency and stale/dedupe options
5. Async API tiering + naming alignment (`defineMutation`, strict-mode options)
6. Typed boundaries + explicit Async precedence docs
7. Router auto-binding
8. Observability hooks + zero-cost defaults + sampling
9. PubSub/operators + family/hydration hardening + docs polish

### Release strategy

- Ship in incremental minor releases with clear feature flags/defaults.
- Keep each release reversible by avoiding hard dependency on unfinished phases.

### Risks

- Over-coupling lifecycle internals to Effect scope semantics.
- Query scheduler complexity causing subtle race conditions.
- Instrumentation overhead in high-frequency apps.
- Type-level API complexity reducing usability.
- API churn causing user confusion during migration.

### Mitigations

- Add deterministic tests for cancellation and ordering.
- Keep strategy defaults conservative.
- Add instrumentation sampling/disable toggles.
- Document type helper patterns with practical examples.
- Use phased deprecations and compatibility aliases before removals.

## Definition of Done (Per Feature)

- Public API documented in `README.md` and `docs/API.md`.
- Unit + integration tests added and passing.
- Type tests added for all new generic/constraint-heavy APIs.
- At least one example demonstrating intended usage.
- Changelog updated with feature summary and migration notes.

## Final Checklist

- [ ] New APIs exported from `src/index.ts` and deep modules where appropriate
- [ ] Tests updated/added in `src/__tests__`
- [ ] README and docs updated
- [ ] Example coverage added
- [ ] Changelog updated
- [ ] Backward compatibility validated against current test suite
