# Reactivity-Native Single-Flight Refinement Plan

This plan describes the best long-term design for single-flight mutations, loader refresh, and service integration in `effect-atom-jsx`.

The goal is not just to improve one feature, but to make the library's async/data/mutation model feel like one coherent system.

## 1. Design Goal

The ideal design should make these statements true:

- route loaders are component-first and Effect-native
- loaders get service requirements through `yield*`
- data freshness is tracked through the Reactivity system, not manual refetch lists
- mutations invalidate data dependencies once
- single-flight automatically refreshes only affected matched loaders
- canonical mutation results can seed loader payloads directly without redundant reruns
- existing action/mutation handles stay the main ergonomic surface on the client

In short:

- `yield*` is for requirements and composition
- Reactivity is for data dependency capture
- single-flight is transport/runtime orchestration built on top of Reactivity

## 2. The Core Design Principle

Do **not** treat all `yield*` calls as reactive dependencies.

That would mix together very different concepts:

- services like logger/config/router/clock are runtime requirements
- data reads are freshness dependencies

The best design separates them cleanly:

- `yield* Service` means "this loader/mutation requires this service"
- `tracked(effect)` means "this read participates in Reactivity and single-flight refresh selection"
- `invalidating(effect, keys)` means "this mutation emits invalidation keys on success"

This becomes the conceptual model for the entire library.

## 3. End-State Public API

### Client mutations

Preferred API:

```ts
const saveUser = Atom.action(
  (input: SaveUserInput) => users.save(input),
  {
    singleFlight: {
      endpoint: "/_single-flight/users/save",
      url: (input) => `/users/${input.id}`,
    },
  },
);
```

### Server handlers

Preferred API:

```ts
const saveUserHandler = Route.singleFlight(
  (input: SaveUserInput) => users.save(input),
  {
    target: (result) => `/users/${result.id}`,
    setLoaders: Route.seedLoader(UserRoute),
  },
);
```

### Reactive service methods

Preferred service implementation style:

```ts
class UsersService extends Effect.Tag("UsersService")<
  UsersService,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<User>>;
    readonly byId: (id: string) => Effect.Effect<User, UserNotFound>;
    readonly save: (input: SaveUserInput) => Effect.Effect<User>;
  }
>() {}
```

With implementations built from `tracked(...)` and `invalidating(...)`.

## 4. New Primitive Layer

The library should introduce two first-class helpers.

### 4.1 `tracked(...)`

Purpose:

- mark Effectful reads as Reactivity-visible data dependencies
- allow single-flight and loader cache to capture read keys consistently
- support both automatic and fallback-explicit modes

Target shape:

```ts
declare function tracked<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: {
    readonly keys?: ReadonlyArray<string>;
  },
): Effect.Effect<A, E, R>;
```

Behavior:

- if the underlying effect reads Reactivity-aware atoms/queries, capture those keys automatically
- if `options.keys` is given, merge them as fallback/override keys
- captured keys should propagate into loader cache entry metadata when called inside loaders

### 4.2 `invalidating(...)`

Purpose:

- mark Effectful mutations as invalidating specific Reactivity keys
- provide a service-friendly mutation primitive rather than requiring direct calls to `Atom.invalidateReactivity(...)`

Target shape:

```ts
declare function invalidating<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  keys: ReadonlyArray<string> | ((value: A) => ReadonlyArray<string>),
): Effect.Effect<A, E, R>;
```

Behavior:

- on success, emit invalidation keys into the Reactivity runtime
- single-flight should capture those invalidations automatically
- callers should not need to manually thread route refresh information

## 5. Preferred Service Pattern

The best library design is service-first and Reactivity-aware.

### Reads

```ts
const UsersLive = Layer.succeed(UsersService, {
  list: () => tracked(Effect.sync(() => usersStore()), { keys: ["users"] }),
  byId: (id) => tracked(
    Effect.sync(() => usersStore().find((u) => u.id === id) ?? failNotFound(id)),
    { keys: ["users", `user:${id}`] },
  ),
  save: (input) => invalidating(
    Effect.sync(() => updateUser(input)),
    (user) => ["users", `user:${user.id}`],
  ),
});
```

### Loader usage

```ts
Route.loader((params) =>
  Effect.gen(function* () {
    const users = yield* UsersService;
    return yield* users.byId(params.userId);
  })
)
```

This is the ideal loader story:

- service requirement is inferred in `R`
- data dependency capture still works for single-flight
- routes stay small and declarative

## 6. Single-Flight Behavior in the End State

The desired runtime flow is:

1. loader executes
2. any `tracked(...)` read inside it records Reactivity keys
3. keys are stored with the loader cache entry
4. mutation executes through `invalidating(...)` or explicit invalidation
5. single-flight captures emitted invalidation keys
6. router matches the target route branch
7. only loaders with intersecting dependency keys are rerun
8. optional direct seeding is merged in
9. client hydrates returned payloads into loader cache

Fallback rules:

- if no invalidation keys are emitted, fall back to matched-loader refresh
- if a target loader has never executed and has no captured keys, use explicit loader keys or matched-loader refresh

## 7. Public API Positioning

### Recommended primary APIs

- `Atom.action(..., { singleFlight })`
- `Atom.runtime(...).action(..., { singleFlight })`
- `Route.singleFlight(...)`
- `Route.seedLoader(...)`
- `Route.seedLoaderResult(...)`
- `tracked(...)`
- `invalidating(...)`

### Advanced / infrastructure APIs

- `Route.actionSingleFlight(...)`
- `Route.mutationSingleFlight(...)`
- `Route.createSingleFlightHandler(...)`
- `Route.invokeSingleFlight(...)`
- `Route.setLoaderData(...)`
- `Route.setLoaderResult(...)`

These should stay public, but docs should clearly frame them as lower-level building blocks.

## 8. Implementation Phases

## Phase A - Introduce `tracked(...)` and `invalidating(...)`

Files:

- `src/Reactivity.ts`
- `src/reactivity-runtime.ts`
- `src/Atom.ts`
- `docs/reactivity.md`

Work:

- add Effect-level tracked read helper
- add Effect-level invalidation helper
- ensure captured keys integrate with current loader capture runtime
- ensure invalidations integrate with current single-flight mutation capture runtime

Acceptance:

- service methods can express reactive reads/mutations without touching route-specific APIs

## Phase B - Reactive service docs and examples

Files:

- `docs/SINGLE_FLIGHT.md`
- `docs/reactivity.md`
- `docs/context.md`
- `examples/router-single-flight/*`
- new `examples/reactive-service-single-flight/*`

Work:

- document recommended service pattern
- show `yield* Service` + `tracked(...)` reads + `invalidating(...)` writes
- add example where loaders only talk to services, not raw atoms

Acceptance:

- the docs' recommended style is service-first, not route-key-first

## Phase C - Tighten client mutation ergonomics

Files:

- `src/Atom.ts`
- `docs/API.md`

Work:

- keep `Atom.action(..., { singleFlight })` as primary client API
- consider better naming for transport options if needed
- ensure success value, pending state, and cache hydration are clear and consistent

Acceptance:

- client usage does not require any Route-specific API in common flows

## Phase D - Tighten server mutation ergonomics

Files:

- `src/Route.ts`
- `docs/API.md`

Work:

- keep `Route.singleFlight(...)` as primary server API
- ensure `Route.seedLoader(...)` is the shortest common direct-set path
- consider whether `setLoaders` should gain helper overloads for one-loader common cases

Acceptance:

- server-side direct-set optimization is concise and obvious

## Phase E - Loader dependency capture hardening

Files:

- `src/router-runtime.ts`
- `src/reactivity-runtime.ts`
- tests in `src/__tests__/route-loader.test.ts`

Work:

- ensure dependency capture works through nested service/helper calls
- ensure capture survives async boundaries correctly
- ensure first-load fallback semantics are deterministic and documented

Acceptance:

- dependency capture is reliable enough to be the default mental model

## Phase F - End-to-end transport story

Files:

- `src/Route.ts`
- `src/Atom.ts`
- docs/examples

Work:

- document request/response contracts clearly
- refine direct-seeding + rerun merge semantics
- optionally add redirect helpers if needed for real HTTP handlers

Acceptance:

- users can wire a real endpoint without understanding internal transport details

## 9. What Should Be Avoided

- do not make all `yield*` calls automatically tracked
- do not invent a second cache system separate from Reactivity + loader cache
- do not force developers to supply route-id refetch lists in the common path
- do not make single-flight a router-only concept; it should compose with the broader mutation system

## 10. Success Criteria

The design is successful when all of this is true:

- route loaders mainly read services via `yield*`
- services hide tracking/invalidation details internally
- client mutations use `Atom.action(..., { singleFlight })`
- server handlers use `Route.singleFlight(...)`
- matched loader refresh is mostly automatic and Reactivity-driven
- direct loader seeding is concise in common cases
- the docs tell one coherent story instead of several competing ones

## 11. Recommended Next Execution Order

1. implement `tracked(...)`
2. implement `invalidating(...)`
3. convert the comprehensive example to service-first style
4. add a dedicated reactive-service single-flight example
5. revise docs to present the service-first model as the ideal pattern
