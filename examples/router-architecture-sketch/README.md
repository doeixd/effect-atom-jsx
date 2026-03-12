# Router Architecture Sketch

This folder is a **future API showcase**, not a buildable app.

It is meant to pressure-test the proposed routing direction and give a more concrete feel for the design before implementation.

The intended architecture is:

- `Route` = app/UI route tree
- `ServerRoute` = server/request route tree
- `RouterRuntime` = shared orchestration engine
- `Reactivity` = single source of truth for freshness/invalidation

Primitive rule:

- constructors for identity
- pipes for behavior
- layers/services for runtime capability

## Why this sketch exists

We want to validate that the future design can be:

- type-safe
- inference-friendly
- service/layer-oriented
- portable across browser/server/meta-framework environments
- explicit about app routes vs server routes
- ergonomic without dummy placeholder components as route anchors

## Files

- `domain-services.md`
  - service-first data layer with `Reactivity.tracked(...)` and `Reactivity.invalidating(...)`
- `app-routes.md`
  - first-class app route nodes with component attachment
- `server-routes.md`
  - first-class server routes with Schema-first request decoding and generated path conventions
- `runtime.md`
  - shared runtime sketch for navigation, submissions, fetchers, and snapshots
- `ssr.md`
  - structured SSR rendering and server-route bridging

## Key design takeaways from the sketch

- app route identity should live on route nodes, not on placeholder components
- components still matter, but as one facet of route nodes
- server routes should support both explicit and generated path conventions
- runtime snapshots are useful, but the internal runtime should stay decomposed
- Reactivity owns freshness; runtime consumes those signals for orchestration
- type inference should survive pipe composition instead of being erased by it
- explicit route metadata carriers make extraction helpers and handler inference simpler
- generic-heavy creation APIs should be avoided in normal usage

## Primitive rule in practice

- constructors create route identity:
  - `Route.page(...)`
  - `Route.layout(...)`
  - `ServerRoute.action(...)`
  - `ServerRoute.document(...)`
- pipes attach orthogonal behavior:
  - `Route.paramsSchema(...)`
  - `Route.loader(...)`
  - `Route.title(...)`
  - `ServerRoute.form(...)`
  - `ServerRoute.handle(...)`
  - `ServerRoute.response(...)`
- layers/services provide runtime capabilities:
  - request/response
  - history/navigation
  - auth/session
  - transports
  - uploads/files/websockets

This is the main composability rule the design is aiming for.

## Example flow

1. `domain-services.md`
   - define `UsersService`
   - reads are tracked with `Reactivity.tracked(...)`
   - writes invalidate with `Reactivity.invalidating(...)`

2. `app-routes.md`
   - define app route nodes with `Route.page(...)`, `Route.layout(...)`, `Route.index(...)`
   - components attach to those nodes

3. `server-routes.md`
   - define `ServerRoute.action(...)`, `ServerRoute.document(...)`, `ServerRoute.json(...)`
   - decode request inputs via Effect Schema

4. `runtime.md`
   - create a `RouterRuntime`
   - navigate, submit, and fetch without collapsing app/server concerns together

5. `ssr.md`
   - render app routes to a structured SSR result
   - bridge document handling through `ServerRoute.document(...)`

## Important constraints reflected here

- no separate router-owned freshness graph
- no requirement that route identity come from decorated components only
- no hard dependency on one transport or one host runtime
- no public API centered around giant generic parameter lists

## Status

This folder is intentionally documentation-only so it does not constrain implementation details too early or break the current codebase.

The concrete implementation sequencing for this sketch lives in `docs/ROUTER_ARCHITECTURE_IMPLEMENTATION_PLAN.md`.
