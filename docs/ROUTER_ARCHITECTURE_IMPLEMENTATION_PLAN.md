# Router Architecture Implementation Plan

This document turns the routing sketches and architecture docs into a concrete implementation plan.

It covers the proposed future design centered on:

- first-class app route nodes
- first-class server route nodes
- a shared `RouterRuntime`
- Reactivity-owned freshness/invalidation
- constructor/pipes/layers primitive split
- Effect Schema-first request decoding

Related references:

- `docs/ROUTE_SERVER_ROUTE_ROUTER_RUNTIME_PLAN.md`
- `examples/router-architecture-sketch/README.md`
- `examples/router-architecture-sketch/app-routes.md`
- `examples/router-architecture-sketch/server-routes.md`
- `examples/router-architecture-sketch/runtime.md`
- `examples/router-architecture-sketch/ssr.md`

## 1. Implementation goals

The implementation should achieve all of the following without regressing the current library ergonomics unnecessarily.

### 1.1 Structural goals

- app route identity becomes first-class and does not require dummy components
- server route identity becomes first-class and distinct from app routes
- runtime orchestration is centralized in a clearer `RouterRuntime`
- request/response/history/navigation are explicit service/layer concerns

### 1.2 Type goals

- route references remain strongly typed
- params/query/hash/body/form/header inference flows from Schema/codecs
- pipe composition preserves route metadata and inference
- low-level APIs may be generic-rich, but common APIs remain inference-first

### 1.3 Behavioral goals

- Reactivity remains the single freshness model
- router runtime consumes Reactivity invalidations, not a separate invalidation graph
- navigation, submissions, fetchers, revalidation, and SSR all live in one runtime model

### 1.4 Ergonomic goals

- constructors stay small and identity-focused
- pipes add orthogonal behavior
- layers/services add environment/runtime capability
- component-first authoring remains pleasant

## 2. Non-goals

- do not rewrite the whole library in one step
- do not break current route/component APIs without compatibility layering
- do not collapse app routes and server routes into one type
- do not make the public API builder-heavy or generic-heavy
- do not add a second freshness/invalidation model outside Reactivity

## 3. High-level migration strategy

This should be implemented incrementally.

The safest route is:

1. introduce new internal/runtime primitives first
2. add new route-node APIs alongside current APIs
3. bridge old APIs onto new internals where possible
4. add `ServerRoute`
5. add `Route.renderRequest(...)` and SSR bridging
6. later decide whether to de-emphasize older APIs in docs

This should feel like an architectural migration, not a flag day rewrite.

## 4. Target primitive model

The implementation should explicitly follow this split:

- constructors for identity
- pipes for behavior
- layers/services for runtime capability

### 4.1 Constructors

App route constructors:

- `Route.page(path, component)`
- `Route.layout(component)`
- `Route.index(component)`
- `Route.ref(route)`
- `Route.mount(route, children)`
- `Route.define(root)`

Server route constructors:

- `ServerRoute.action({ key? })`
- `ServerRoute.document(appRouteTree)`
- `ServerRoute.json({ key? })`
- `ServerRoute.resource({ key? })`
- `ServerRoute.define(...)`

### 4.2 Pipes

App route pipes:

- `Route.id(...)`
- `Route.paramsSchema(schema)`
- `Route.querySchema(schema)`
- `Route.hashSchema(schema)`
- `Route.loader(...)`
- `Route.action(...)`
- `Route.title(...)`
- `Route.meta(...)`
- `Route.guard(...)`
- `Route.children(...)`
- `Route.withLayer(...)`

Server route pipes:

- `ServerRoute.method(...)`
- `ServerRoute.path(...)`
- `ServerRoute.params(schema)`
- `ServerRoute.query(schema)`
- `ServerRoute.form(schema)`
- `ServerRoute.body(schemaOrCodec)`
- `ServerRoute.headers(schema)`
- `ServerRoute.cookies(schema)`
- `ServerRoute.response(schemaOrCodec)`
- `ServerRoute.handle(...)`
- `ServerRoute.documentRenderer(...)`
- `ServerRoute.withLayer(...)`

### 4.3 Services/layers

Likely capabilities:

- `HistoryTag`
- `NavigationTag`
- `ServerRequestTag`
- `ServerResponseTag`
- `RouterRuntimeTag`
- `DocumentRendererTag`
- `SingleFlightTransportTag`
- `UploadsTag`
- `BodyParserTag`

## 5. Main implementation tracks

The implementation work breaks into 8 tracks.

## Track A - App route node model

Goal:

- introduce first-class app route nodes without requiring placeholder components

Files likely involved:

- `src/Route.ts`
- maybe new `src/route-node.ts`
- `src/Component.ts`
- tests/type tests/docs

Work:

- define internal app route node representation
- make it carry explicit route definition/state metadata:
  - id
  - path
  - params/query/hash schemas
  - loader metadata
  - action metadata
  - title/meta hooks
  - parent/children links
- add route-node constructors and pipes
- add extraction helper types
- separate declarative node definition from materialized runtime/component cache so transformations stay simpler

Compatibility goal:

- existing component-based `Component.route(...)` can continue to work by compiling/bridging into the new route-node model

Acceptance:

- route identity can exist independently of dummy components
- current route ergonomics can be preserved or bridged

## Track B - Pipe-preserving type inference

Goal:

- ensure route pipes add information without erasing existing inference

Files likely involved:

- `src/Route.ts`
- type tests

Work:

- define route metadata carrier types carefully
- add helper extraction types:
  - `Route.ParamsOf<T>`
  - `Route.QueryOf<T>`
  - `Route.HashOf<T>`
  - `Route.LoaderDataOf<T>`
  - `Route.LoaderErrorOf<T>`
- make `.pipe(...)` composition preserve route identity and accumulated metadata
- derive route enhancer input/output from explicit route-node metadata instead of compatibility casts
- add type tests for common composition chains

Acceptance:

- route constructors + pipes remain pleasant and inference-heavy in practice

## Track C - Shared introspection + validation

Goal:

- make route graphs inspectable and invalid route graphs fail early

Files likely involved:

- `src/Route.ts`
- future `src/ServerRoute.ts`
- optional `src/RouteAnalysis.ts`

Work:

- add route introspection surfaces:
  - parent
  - children
  - depth
  - ancestors
  - route chain
  - param names
  - static prefix/path information
- add creation-time validation:
  - duplicate param names
  - duplicate IDs
  - conflicting siblings
  - invalid nesting

Acceptance:

- route graphs are first-class inspectable values
- invalid graphs fail early with useful diagnostics

## Track D - `ServerRoute`

Goal:

- create a separate first-class server routing model

Files likely involved:

- new `src/ServerRoute.ts`
- `src/index.ts`
- tests/type tests/docs

Work:

- define internal server route node representation
- support distinct route kinds:
  - document
  - action
  - json
  - resource
- support constructor + pipe style
- support schema-first decoding for:
  - params
  - query
  - form
  - body/codecs
  - headers
  - cookies
- support generated path conventions for higher-level adapters/frameworks

Acceptance:

- server routes are distinct, typed, composable, and introspectable

## Track E - `RouterRuntime`

Goal:

- formalize the shared orchestration runtime

Files likely involved:

- new `src/RouterRuntime.ts`
- refactor from `src/router-runtime.ts`
- tests/docs

Work:

- define decomposed internal runtime state
- define derived snapshot state for inspection
- model task domains:
  - navigation
  - submissions/actions
  - revalidation
  - fetchers
  - deferred work
- define subscription/snapshot surface
- define initialization lifecycle
- define history action semantics

Acceptance:

- runtime is a real orchestration engine, not a loose collection of helpers

## Track F - History/navigation services

Goal:

- make navigation and history host-agnostic runtime capabilities

Files likely involved:

- route/runtime modules
- new service tags/adapters

Work:

- define `HistoryTag`
- define `NavigationTag`
- add browser/hash/memory/server implementations
- define navigation APIs for:
  - push/replace/pop
  - relative navigation
  - route-reference navigation
  - form submission navigation

Acceptance:

- navigation logic is no longer tied conceptually to browser globals

## Track G - SSR bridge

Goal:

- support server rendering through `Route` and request dispatch through `ServerRoute`

Files likely involved:

- `src/Route.ts`
- `src/ServerRoute.ts`
- `src/RouterRuntime.ts`

Work:

- add `Route.renderRequest(...)`
- return structured render result
- add request/response services
- add document renderer service/option
- add `ServerRoute.document(...)` bridge
- support redirect/notFound semantics

Acceptance:

- SSR works portably across runtimes
- app-route rendering and server-route dispatch stay distinct but connected

## Track H - Reactivity/runtime boundary

Goal:

- formalize the boundary between Reactivity freshness and router orchestration

Files likely involved:

- `src/Reactivity.ts`
- `src/reactivity-runtime.ts`
- runtime integration files
- tests/docs

Work:

- make it explicit in code and docs that Reactivity owns freshness
- ensure loader dependency capture is stored in a way runtime can consume
- ensure mutations/fetchers/submissions emit invalidations through Reactivity only
- ensure runtime revalidation reads those signals instead of maintaining separate invalidation structures

Acceptance:

- one freshness model, no duplicated invalidation logic

## 6. Recommended implementation order

The best order is:

1. Track A - app route node model
2. Track B - pipe-preserving inference
3. Track C - introspection + validation
4. Track E - `RouterRuntime`
5. Track F - history/navigation services
6. Track D - `ServerRoute`
7. Track G - SSR bridge
8. Track H - Reactivity/runtime boundary hardening

Why this order:

- app route identity and inference must be solid before server/runtime build on them
- runtime should exist before server routing tries to orchestrate too much
- server routing and SSR should land on top of the clarified app/runtime foundations

## 7. Detailed phase plan

## Phase 1 - App route identity foundation

Deliverables:

- internal app route node model
- `Route.page`, `Route.layout`, `Route.index`, `Route.define`, `Route.mount`, `Route.ref`
- compatibility bridge from current route APIs
- helper extraction types for app route references

Validation:

- type tests for route params/data inference
- unit tests for route graph creation and introspection

## Phase 2 - Route pipes and validation

Deliverables:

- `Route.id`, `Route.params`, `Route.query`, `Route.hash`, `Route.loader`, `Route.title`, `Route.meta`, `Route.children`
- creation-time validation
- route introspection helpers

Validation:

- type tests for pipe chains
- unit tests for validation failures and introspection

## Phase 3 - Runtime core

Deliverables:

- `RouterRuntime.create(...)`
- decomposed runtime state
- `snapshot()` / subscribe support
- navigation/revalidation/fetch task primitives

Validation:

- runtime tests for navigation and task state
- tests for cancellation/interruption behavior

## Phase 4 - History/navigation services

Deliverables:

- `HistoryTag`
- `NavigationTag`
- browser/hash/memory/server adapters

Validation:

- tests for push/replace/pop
- tests for route-reference navigation
- tests for submission navigation entrypoints

## Phase 5 - `ServerRoute`

Deliverables:

- `ServerRoute` node model
- constructor + pipe APIs
- schema-first request decoding
- generated path hooks

Validation:

- type tests for params/form/body/response inference
- unit tests for method/path matching and decoding

## Phase 6 - SSR and request/response bridge

Deliverables:

- `Route.renderRequest(...)`
- structured render result
- request/response services
- `ServerRoute.document(...)`
- redirect/notFound semantics

Validation:

- SSR tests
- document route integration tests

## Phase 7 - Reactivity/runtime boundary hardening

Deliverables:

- formalized runtime use of Reactivity invalidation signals
- docs/tests proving runtime does not own a separate invalidation graph

Validation:

- revalidation tests
- fetcher/submission tests
- single-flight-related integration tests where relevant

## Phase 8 - Tooling/dev layer

Deliverables:

- optional route analysis utilities
- warning/dev helpers
- meta-framework/tooling hooks

Validation:

- tests for route analysis/diagnostics

## 8. Type testing plan

We should add dedicated type tests for:

- app route constructor inference
- app route pipe chains
- server route constructor inference
- server route decode helpers
- route-to-server bridging
- runtime-facing extraction helpers

Important type assertions to protect:

- pipes do not erase identity
- params/body/form inference works without manual generics
- generated path conventions do not erase handler typing
- server document routes retain app-route linkage typing

## 9. Runtime/service testing plan

Add test suites for:

- route graph creation/validation
- runtime snapshot behavior
- history adapters
- navigation transitions
- form submissions
- fetchers/non-navigation tasks
- SSR render outputs
- request decoding pipelines
- Reactivity-driven revalidation orchestration

Prefer tests that run without a full browser or full HTTP server wherever possible.

## 10. Documentation plan

As the implementation progresses, docs should be updated in parallel.

Docs to add or revise:

- route node authoring guide
- server route authoring guide
- router runtime guide
- SSR/render request guide
- request decoding / Effect Schema guide
- history/navigation adapters guide
- testing guide for route/server/runtime layers

The sketch folder should remain as the conceptual showcase until the real APIs stabilize.

## 11. Compatibility strategy

Current APIs should remain usable during the migration where possible.

Likely compatibility path:

- current `Component.route(...)` compiles into new route-node metadata internally
- current `Route.loader(...)` style can be reused as a pipe on route nodes
- existing router layers (`Browser`, `Hash`, `Memory`, `Server`) can inform future history/navigation services or wrap them temporarily

Only after the new architecture is stable should the docs shift the primary recommendation fully.

## 12. Success criteria

This implementation plan is successful when:

- route identity no longer depends on placeholder components
- app routes and server routes are both first-class and distinct
- route pipes remain strongly typed and inference-friendly
- runtime orchestration is explicit but internally decomposed
- request decoding is Schema/codecs-first
- Reactivity remains the only freshness graph
- SSR and server routing feel coherent and portable
- the resulting system is a viable foundation for a metaframework
