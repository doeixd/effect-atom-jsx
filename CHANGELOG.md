# Changelog

## Unreleased (Redesign Track)

### Breaking API consolidation

- Removed legacy query/mutation constructors from public surface: `queryEffect`, `mutationEffect`, and strict variants.
- Canonicalized async app APIs around `defineQuery` and `defineMutation`.
- Removed service/mount aliases: `use` and `mountWith`.
- Removed sync scoped wrappers: `scopedRoot`, `scopedQuery`, `scopedMutation` (keep `*Effect` variants).
- Removed OO facade: `signal`, `computed`.
- Removed function wrappers: `Atom.fn`, `runtime.fn`; action-centric APIs are `Atom.action` / `runtime.action`.

### Runtime/export model

- Batching is microtask-only; sync batching mode removed.
- `flush()` remains as explicit deterministic escape hatch.
- Top-level no longer re-exports reactive core or DOM runtime helpers.
- Added `effect-atom-jsx/internals` subpath for low-level internals.

### Phase E/F release readiness

- Query scheduling + observability expanded:
  - `defineQuery(..., { retrySchedule, pollSchedule })`
  - `defineQuery(..., { observe })` timing metrics hook (`startedAt`/`finishedAt`/`durationMs`)
- Mutation observability expanded:
  - `defineMutation(..., { name, observe })`
- Action observability alignment:
  - `Atom.action(...)` and `Atom.runtime(...).action(...)` now support `name` + `onTransition`
- Scope-first cleanup hardened:
  - `layerContext(...)` now binds cleanup to component scope finalizers
- Stream ergonomics expanded:
  - `Atom.fromSchedule(...)`
  - `Atom.Stream.textInput(...)` and `Atom.Stream.searchInput(...)` first-party UI stream recipes
- Component system shipped (initial v1 envelope):
  - `Component.make`, `Component.headless`, `Component.from`
  - setup helpers (`state`, `derived`, `query`, `action`, `ref`, `fromDequeue`, `schedule`, `scheduleEffect`)
  - transforms (`withLayer`, `withErrorBoundary`, `withLoading`, `withSpan`, `memo`, `tapSetup`, `withPreSetup`, `withSetupRetry`, `withSetupTimeout`)
  - bridges/mounting (`setupEffect`, `renderEffect`, `Component.mount`)
- Composables foundation shipped:
  - new `Behavior` namespace (`make`, `compose`, `decorator`)
  - new `Element` capability handles and collections
  - `Component.withBehavior(...)` and slot-handle helpers for behavior attachment
  - first built-in composable behaviors: `disclosure`, `selection`
  - added `Behavior.attach(...)` and `Behavior.attachBySlots(...)` for pipe-level behavior wiring
  - expanded built-in composables: `searchFilter`, `keyboardNav`, `pagination`, `focusTrap`
  - added dynamic collection lifecycle support via `Element.collection(...).observeEach(...)` and updated selection behavior to rebind listeners as items churn
  - added first composed headless behavior: `Behaviors.combobox(...)`
  - added headless composables factory module with `Composables.createCombobox(...)`
  - added style system modules (`Style`, `Theme`, style runtime/types/utils) with slot-based `Style.attach(...)` composition
  - added style variants/recipes APIs and typed token helper functions
  - added styled composables helper (`StyledComposables.createStyledCombobox`)
  - tightened style slot-attach typing and added `Style.attachBySlotsFor<Bindings>()` for strict slot-map validation
  - added concrete styled combobox example under `examples/styled-combobox/`
  - added Style2 advanced APIs: nesting/selectors, CSS vars, media/supports/container descriptors, pseudo descriptors, grid descriptors, layers/global descriptors, and lifecycle/layout animation descriptors
  - added named keyframes support (`Style.keyframes(name, frames)`) and `Style.animate(...)`
  - added styled card example under `examples/styled-card/`
  - added router module (`Route`) with Router service layers (Browser/Hash/Server/Memory)
  - added component routing pipes (`Component.route`, `Component.guard`) and typed link/query helpers (`Route.link`, `Route.queryAtom`)
  - improved router integration: inferred typed links from routed metadata, runtime-aware `Route.Link` navigation, memory history back/forward support, and route metadata collection/validation helpers
  - added route head metadata merge/apply utilities with explicit precedence (deepest title wins; meta merged root->leaf)
  - added router examples: `router-basic` and `router-typed-links`
  - added Router2 loader foundation: route loader pipes/accessors, loader cache utilities, matched-loader orchestration, and loader-integrated component route setup
  - expanded Router2 with deeper dependency-aware loader batching plus SSR/streaming payload helpers and sitemap collection utilities
   - added streaming-priority orchestration helper (`Route.runStreamingNavigation`) and tests for critical/deferred loader batching
   - clarified Router2 async rendering contract: `Route.loaderResult` uses existing `Result` union and integrates with `Async` control flow
   - `Route.title` / `Route.meta` callback forms now receive loader snapshots (`params`, `loaderData`, `loaderResult`) for loader-driven document head derivation
   - added inference helpers `Route.titleFor(component, ...)` / `Route.metaFor(component, ...)` so params + loader types are inferred from the routed/loader-tagged component without explicit generic arguments
   - added `Route.loaderErrorFor(component, cases)` so tagged loader error handlers are inferred from route params and loader error union without explicit generic annotations
   - route head callbacks now stay reactive after initial setup: route/title metadata recomputes on route match + params + loader state changes
   - added first single-flight mutation primitives: `Route.actionSingleFlight(...)` (mutation + matched-loader payload in one Effect) and `Route.hydrateSingleFlightPayload(...)` (cache hydration from payload)
   - added single-flight transport helpers: `Route.createSingleFlightHandler(...)` for server binding and `Route.invokeSingleFlight(...)` for client POST + payload hydration
   - added `Route.mutationSingleFlight(...)` for mutation-handle ergonomics aligned with existing action APIs while preserving single-flight payload typing/inference
   - loaders now auto-capture Reactivity keys from atom/query reads during execution and persist them on loader cache entries for later invalidation matching
   - `Route.actionSingleFlight(...)` now defaults to Reactivity-driven loader selection and only falls back to full matched-loader refresh when no invalidation keys are emitted
   - `Atom.action(...)` and `Atom.runtime(...).action(...)` are now the preferred client single-flight entrypoints via `singleFlight` transport options, while `Route.*SingleFlight*` APIs remain lower-level infrastructure
   - added `Route.setLoaderData(...)` / `Route.setLoaderResult(...)` so single-flight payloads can be seeded directly from canonical mutation results and avoid redundant loader reruns
   - added `Route.singleFlight(...)` as the higher-level server helper for building typed single-flight handlers with optional direct loader seeding
   - added `Route.seedLoader(...)` / `Route.seedLoaderResult(...)` helpers for the common "mutation result already matches loader payload" path
   - added dedicated single-flight docs (`docs/SINGLE_FLIGHT.md`) and a comprehensive demo (`examples/router-single-flight/`)
   - added `Reactivity.tracked(...)` / `Reactivity.invalidating(...)` primitives for service-first tracked reads and invalidating writes that compose with loader capture and single-flight
   - updated the comprehensive single-flight example to demonstrate the recommended service-first design
   - added transport-aware single-flight runtime integration via `Route.SingleFlightTransportTag` and `Route.FetchSingleFlightTransport(...)`
   - `Atom.action(...)` / `Atom.runtime(...).action(...)` now auto-detect installed single-flight transport for transparent mutation+loader hydration, while explicit client transport options remain available for overrides/fallback
   - added transport-specific documentation in `docs/SINGLE_FLIGHT_TRANSPORT.md`
   - added a fetch-backed transport demo in `examples/router-single-flight-fetch/` alongside the custom transport demo
   - added a future architecture sketch for `Route` + `ServerRoute` + `RouterRuntime` in `examples/router-architecture-sketch/README.md`
   - started the app route-node implementation with first-class `Route.page(...)` / `Route.layout(...)` / `Route.index(...)` constructors plus pipeable helpers and route-node-aware linking/collection
   - extended route-node authoring so `Route.loader(...)`, `Route.title(...)`, and `Route.meta(...)` work directly on route nodes, with new route-node extraction helpers for params/query/hash/loader typing
   - added the first `ServerRoute` slice with constructor/pipe primitives for action/document/json/resource nodes plus Schema-first params/form/body/response typing helpers and generated path support
   - added the first `ServerRoute.execute(...)` slice for typed request execution with Schema-based params/form/body decoding and basic response encoding
   - added first server control-flow/response-shaping primitives via `ServerRoute.redirect(...)`, `ServerRoute.notFound()`, and `Route.ServerResponseTag` inside server handlers
   - added service-native server execution helpers (`ServerRoute.executeWithServices(...)`, `ServerRoute.executeFromServices(...)`) and updated `RouterRuntime` server task execution to use explicit request/response service objects
   - added the first `RouterRuntime` slice with runtime creation, memory history, snapshots, subscriptions, navigation, submission, fetcher, and revalidation foundations
   - extended `RouterRuntime` with app-route/document-route matching in snapshots and app-route-reference navigation via `navigateApp(...)`
   - `RouterRuntime` now runs matched app-route loaders during initialization/navigation/revalidation and surfaces loader results in runtime snapshots
   - `RouterRuntime.submit(...)` / `fetch(...)` now execute typed `ServerRoute` handlers when given server route nodes, storing action results and fetch task state in runtime snapshots
   - expanded `ServerRoute` request decoding with `query(...)`, `headers(...)`, and `cookies(...)`, threaded through execution and runtime task flows
   - added the first runtime service-layer bridge with `RouterRuntime.HistoryTag`, `RouterRuntime.NavigationTag`, `RouterRuntime.RouterRuntimeTag`, and `RouterRuntime.toLayer(...)`
   - added the first SSR bridge slice with `Route.renderRequest(...)`, `Route.ServerRequestTag`, `Route.ServerResponseTag`, and `ServerRoute.runDocument(...)`
   - enriched SSR/document handling with `ServerRoute.dispatch(...)` and real loader payload/deferred output from `Route.renderRequest(...)`
   - added runtime-backed SSR/document helpers via `Route.renderRequestWithRuntime(...)` and `ServerRoute.dispatchWithRuntime(...)`
   - `RouterRuntime` now orchestrates request URL state and matched loader refresh before runtime-backed render/dispatch flows
   - extended `RouterRuntime` snapshots with richer request/document outcome tracking (`lastActionOutcome`, `lastFetchOutcome`, `lastDocumentResult`, `lastDispatchResult`)
   - continued unifying `RouterRuntime` task state around shared phase-based task objects for navigation, revalidation, fetchers, and request/document flows
   - started normalizing `RouterRuntime` outcome tracking around shared `kind`-tagged outcome records for actions, fetches, documents, and dispatches
   - continued normalizing `RouterRuntime` action/fetch state onto shared task/outcome structures and added cancellation-ready task phases to the runtime state foundation
   - added the first explicit runtime cancellation API (`runtime.cancel(...)` / `NavigationTag.cancel(...)`) for interruption-aware task state
   - added shared supersession semantics for runtime task transitions so repeated navigation/fetch work can enter `cancelled` before the next task begins
   - added lightweight in-flight task id tracking to `RouterRuntime` snapshots as groundwork for deeper interruption semantics
   - runtime task completions now guard against stale superseded writes using in-flight task ids
   - extended tracked in-flight execution to submit and revalidate flows so more runtime work follows the same guarded execution model
   - added `ServerRoute.toResponse(...)` to convert document/data dispatch results into adapter-facing response structures
   - added `Route` server convenience helpers for request/response access and response shaping inside service-native server handlers
   - added first route/server graph introspection and validation helpers for route trees and server route graphs
   - expanded server-route observability/validation with `byKey(...)`, `identity(...)`, missing-handler checks, invalid document decode wiring checks, and `matchedServerRoute` in runtime snapshots
   - added conflicting sibling route validation for app route trees and overlapping document route validation for server route graphs
   - started reactivity service migration with new `Reactivity` module (`live`/`test` layers), runtime adapter, and atom invalidation/track integration hooks
  - hardened reactivity adapter with service change handling/resubscription and integrated loader cache staleness updates from reactivity invalidation keys

## 0.2.0 (2026-03-09)

Initial stable release.

### Core

- **Atom** — reactive state primitives with `make`, `readable`, `writable`, `family`, `map`, `withFallback`, `batch`, and `fromStream`/`fromQueue`/`fromResource`
- **Registry** — centralized read/write/subscribe context for atoms
- **AtomRef** — per-property reactive access to objects and arrays via `make` and `collection`
- **Result** — three-state data-fetching result type (`Initial` / `Success` / `Failure`) with waiting semantics

### Effect Integration

- **queryEffect / defineQuery** — reactive async queries with fiber cancellation, `AsyncResult` state, and key-based invalidation
- **atomEffect** — standalone reactive Effect computations (no ambient runtime required)
- **mutationEffect** — write actions with optimistic UI, rollback, and automatic refresh
- **createOptimistic** — optimistic overlay for immediate UI feedback
- **useService / useServices** — synchronous service lookup from ambient `ManagedRuntime`
- **createMount / mount** — bootstrap a `ManagedRuntime` from a `Layer` and render
- **scopedQuery / scopedMutation / scopedRoot** — Effect `Scope`-tied lifecycle primitives
- **signal / computed** — OO-style reactive refs

### AsyncResult

- Exit-first state model: `Loading` / `Refreshing` / `Success` / `Failure` / `Defect`
- Combinators: `match`, `map`, `flatMap`, `getOrElse`, `getOrThrow`
- Lossless round-trip via `.exit` field on settled states

### JSX Components

- `Async`, `Show`, `For`, `Switch`/`Match`, `MatchTag`, `Optional`, `MatchOption`, `Dynamic`, `Loading`, `Errored`, `WithLayer`, `Frame`

### Modules

- **AtomSchema** — Schema-driven reactive form validation with touched/dirty tracking
- **AtomLogger** — structured debug logging for atom reads/writes
- **AtomRpc** — RPC client factory for flat endpoint maps
- **AtomHttpApi** — HTTP API client factory for grouped endpoints
- **Hydration** — SSR state transfer (`dehydrate`/`hydrate`)

### Testing

- `renderWithLayer`, `withTestLayer`, `mockService` — DOM-free test harness via `effect-atom-jsx/testing`

### SSR

- `renderToString`, `hydrateRoot`, `isServer`, `getRequestEvent`/`setRequestEvent`

### Compatibility

- Peers on `effect@^4.0.0-beta.29`
- JSX via `babel-plugin-jsx-dom-expressions` pointing to `effect-atom-jsx/runtime`
