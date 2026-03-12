# Transport-Agnostic Transparent Single-Flight Plan

This plan describes the next refinement of the library's single-flight design.

The target outcome is:

- single-flight is mostly transparent to end users
- transport details are fully configurable and pluggable
- normal loaders/mutations/services do not depend on one specific network model
- Reactivity remains the source of truth for data dependency capture and refresh selection

## 1. Design Goal

The ideal experience is:

- users write normal route loaders
- users write normal service methods and mutations
- users write normal `Atom.action(...)` handles
- if a single-flight transport is installed, route data refresh is folded into the same mutation round trip automatically
- if no transport is installed, the same app still works with normal mutation + invalidation + refetch behavior

Single-flight should feel like a runtime capability, not a separate programming model.

## 2. Core Principle

Separate the system into three layers.

### 2.1 Domain layer

Contains:

- services
- route loaders
- mutation Effects
- Reactivity tracking/invalidation

This layer should know nothing about HTTP, endpoint URLs, or request envelopes.

### 2.2 Orchestration layer

Contains:

- route matching
- loader dependency capture
- invalidation capture
- loader rerun selection
- payload hydration
- direct loader seeding

This is the current `Route`/router-runtime single-flight engine.

### 2.3 Transport layer

Contains:

- HTTP handlers
- custom fetch bridges
- RPC transports
- in-memory/test transports
- worker/message-channel transports

This layer is replaceable.

## 3. Public API End State

### End-user code

Users should mostly write:

```ts
const saveUser = Atom.action(
  (input: SaveUserInput) =>
    Effect.gen(function* () {
      const users = yield* UsersService;
      return yield* users.save(input);
    }),
);
```

No single-flight-specific option should be required in the common case.

### Application/runtime configuration

Single-flight should become active by installing a transport service.

Example shape:

```ts
class SingleFlightTransport extends Effect.Tag("SingleFlightTransport")<
  SingleFlightTransport,
  {
    readonly execute: <A>(
      request: SingleFlightRequest<ReadonlyArray<unknown>>,
    ) => Effect.Effect<SingleFlightResponse<A>>;
  }
>() {}
```

Then `Atom.action(...)` can opportunistically use it.

## 4. New Architectural Direction

### 4.1 Normal mutation handles first

Preferred API:

- `Atom.action(...)`
- `Atom.runtime(...).action(...)`

These should detect whether single-flight transport is available.

If available:

- package the mutation invocation into a transport request
- receive mutation result + loader payloads
- hydrate route loader cache automatically

If unavailable:

- run the mutation locally as a normal Effect
- invalidation still happens via Reactivity

### 4.2 Route APIs become orchestration APIs

`Route.singleFlight(...)`, `Route.actionSingleFlight(...)`, `Route.createSingleFlightHandler(...)`, and `Route.invokeSingleFlight(...)` should remain, but be positioned as:

- server/runtime integration tools
- advanced customization hooks
- not the normal user-facing client entrypoint

### 4.3 Transport adapters become first-class

The library should support multiple adapters built on one internal contract:

- HTTP/fetch adapter
- in-memory adapter for local demos/tests
- custom RPC adapter
- framework adapter (if host app wants one)

## 5. Required New Primitive

Introduce a transport service contract.

### Proposed service

```ts
export interface SingleFlightTransportService {
  readonly execute: <Args extends ReadonlyArray<unknown>, A, E>(
    request: SingleFlightRequest<Args>,
  ) => Effect.Effect<SingleFlightResponse<A, E>>;
}
```

And a tag:

```ts
export const SingleFlightTransportTag = ServiceMap.Service<SingleFlightTransportService>("SingleFlightTransport");
```

### Why this matters

This moves single-flight from:

- endpoint URL as the primary abstraction

to:

- transport capability as the primary abstraction

That is the correct architectural boundary.

## 6. Desired Mutation Behavior

When `Atom.action(...)` runs:

1. check if a single-flight transport service is present
2. if not present:
   - run mutation locally
3. if present:
   - build a request envelope from the action input + current URL/target resolution
   - send it through the transport service
   - hydrate loader payloads automatically
   - return the mutation result to the handle

This should be invisible in common usage.

## 7. Configurability Goals

The system should remain highly configurable at the integration boundary.

Configurable concerns:

- how requests are encoded
- where they are sent
- how responses are decoded
- whether hydration is automatic
- redirect/target URL behavior
- direct-set vs rerun merge semantics
- whether single-flight is enabled for all mutations or selectively

This configuration should live in transport adapters and runtime setup, not in domain code.

## 8. Recommended Public Surface

### Primary user-facing APIs

- `Atom.action(...)`
- `Atom.runtime(...).action(...)`
- `Reactivity.tracked(...)`
- `Reactivity.invalidating(...)`
- `Route.loader(...)`

### Runtime/integration APIs

- `Route.singleFlight(...)`
- `Route.seedLoader(...)`
- `Route.seedLoaderResult(...)`
- `SingleFlightTransportTag`
- `SingleFlightRequest`
- `SingleFlightResponse`

### Advanced/infrastructure APIs

- `Route.actionSingleFlight(...)`
- `Route.mutationSingleFlight(...)`
- `Route.createSingleFlightHandler(...)`
- `Route.invokeSingleFlight(...)`
- `Route.setLoaderData(...)`
- `Route.setLoaderResult(...)`

## 9. Implementation Phases

## Phase A - Introduce transport service contract

Files:

- `src/Route.ts`
- possibly `src/SingleFlight.ts` if extraction is cleaner
- `src/index.ts`

Work:

- define `SingleFlightTransportService`
- define service tag
- define common request/response execution interface

Acceptance:

- transport is no longer modeled primarily as endpoint strings

## Phase B - Build fetch adapter on top of transport service

Files:

- `src/Route.ts` or new `src/single-flight-transport.ts`
- docs/examples

Work:

- move current `endpoint/url/fetch` client options behind a fetch adapter
- preserve existing behavior for compatibility
- expose a helper for building a fetch-backed transport layer

Acceptance:

- current endpoint-based approach becomes one adapter, not the core design

## Phase C - Make `Atom.action(...)` transport-aware by default

Files:

- `src/Atom.ts`

Work:

- make action handles consult installed transport service automatically
- if present, use single-flight transport
- if absent, run local mutation Effect normally
- keep opt-in overrides for selective transport usage if needed

Acceptance:

- common mutations do not require `singleFlight` options at callsite

## Phase D - Keep selective control

Files:

- `src/Atom.ts`
- `docs/API.md`

Work:

- allow per-action override such as:
  - force transport
  - disable transport
  - custom target resolution
- keep backward compatibility with existing `singleFlight` client option shape while re-framing it as adapter config/override

Acceptance:

- transparent by default, configurable when needed

## Phase E - Harden orchestration boundaries

Files:

- `src/Route.ts`
- `src/router-runtime.ts`
- tests

Work:

- ensure transport layer never owns refresh logic directly
- ensure orchestration remains in router/single-flight engine
- ensure direct-seeding merge behavior is deterministic across transports

Acceptance:

- same mutation/orchestration semantics regardless of transport implementation

## Phase F - Documentation and examples

Files:

- `docs/SINGLE_FLIGHT.md`
- `docs/SINGLE_FLIGHT_COMPARISON.md`
- `docs/API.md`
- new doc: `docs/SINGLE_FLIGHT_TRANSPORT.md`
- examples

Work:

- explain transparent transport-aware single-flight
- show default runtime-installed transport model
- show custom transport adapter example
- show fallback behavior when no transport is installed

Acceptance:

- docs tell one story: single-flight is automatic when the runtime supports it

## 10. Compatibility Strategy

The transition should be incremental, not a rewrite.

Keep current APIs working:

- `Atom.action(..., { singleFlight })`
- `Route.singleFlight(...)`
- `Route.invokeSingleFlight(...)`

But reposition them:

- endpoint-based options become one transport adapter path
- automatic transport detection becomes the preferred mode

## 11. What Should Be Avoided

- do not force users to always specify endpoint config per mutation
- do not tie single-flight to fetch/HTTP only
- do not move orchestration logic into transport adapters
- do not require route-specific APIs for normal client mutation code

## 12. Success Criteria

This design is successful when:

- normal app code looks like normal loaders/services/mutations
- single-flight happens automatically when a transport is installed
- transport can be swapped without changing domain code
- Reactivity still determines what refreshes
- direct-set optimization still works
- low-level APIs exist but are not required in common usage

## 13. Recommended Execution Order

1. introduce `SingleFlightTransportService`
2. wrap current fetch-based path as an adapter
3. make `Atom.action(...)` auto-detect and use installed transport
4. keep per-action overrides for control
5. update docs/examples to present single-flight as a transparent runtime capability
