# Single-Flight Design Comparison

This document explains how `effect-atom-jsx` single-flight mutations compare to the designs used by SolidStart, TanStack Start, and SvelteKit.

## Short version

- SolidStart is the closest match in spirit: automatic, route-aware, and centered on re-running page data in the same response.
- TanStack Start is the most explicit: mutations carry query-key-driven refetch instructions via middleware.
- SvelteKit provides explicit `refresh()` / `set()` primitives around remote functions.
- `effect-atom-jsx` combines pieces of all three, but uses the library's Reactivity system as the coordination layer.

## The core difference here

The key architectural bet in this library is:

- loaders read reactive atoms/queries
- the Reactivity runtime captures those reads
- mutations invalidate Reactivity keys
- single-flight revalidates only the matched loaders whose captured keys intersect those invalidations

That means the framework does not need developers to manually provide refetch lists in the common case.

## Compared to SolidStart

SolidStart's model is highly automatic:

- a mutation/action runs on the server
- the framework knows which route loaders are active for the next page
- it re-runs relevant data and returns it in the same response

Where this library is similar:

- route-aware orchestration
- mutation + route data travel together in one response
- minimal client wiring in the common path

Where this library differs:

- refresh granularity is driven by Reactivity dependency capture, not only by "all active page data"
- direct dependencies can come from atoms/queries actually read inside loaders
- route loaders can also be seeded directly from mutation output via `Route.seedLoader(...)`

Tradeoff:

- this design can be more granular than SolidStart
- but it depends on dependency capture being correct and complete

## Compared to TanStack Start

TanStack Start is centered on explicit query keys and middleware.

Typical shape:

- mutation runs through a server function
- developer declares which query keys to refetch
- middleware gathers those queries, re-executes them, and hydrates query cache on the client

Where this library is better ergonomically:

- no query-key refetch list is required in the common case
- route loader dependencies can be inferred from reads
- existing mutation handles remain the public client API (`Atom.action(..., { singleFlight })`)

Where TanStack Start is stronger:

- operational behavior is more explicit
- query invalidation/refetch rules are easier to inspect statically
- it has a very mature cache-centric story because the whole system is designed around TanStack Query

Tradeoff:

- TanStack Start favors explicitness
- `effect-atom-jsx` favors inferred dependency graphs through Reactivity

## Compared to SvelteKit

SvelteKit's remote-function model exposes explicit primitives:

- `refresh()` to re-run a query on the server and include it in the response
- `set()` to directly seed a query value from mutation output

Where this library is similar:

- direct payload seeding is supported
- one response can include both mutation data and refreshed route data

Where this library differs:

- direct seeding is route-loader oriented via `Route.setLoaderData(...)`, `Route.setLoaderResult(...)`, and `Route.seedLoader(...)`
- automatic loader selection comes from Reactivity invalidation matching, not explicit query refresh calls alone

Tradeoff:

- SvelteKit gives developers very explicit tools for refresh/set
- `effect-atom-jsx` makes the common case more automatic, while still providing explicit seeding for optimization

## Public API comparison

### `effect-atom-jsx`

Client:

```ts
const saveUser = Atom.action(saveUserEffect, {
  singleFlight: {
    endpoint: "/_single-flight/users/save",
    url: (input) => `/users/${input.id}`,
  },
});
```

Server:

```ts
const saveUserHandler = Route.singleFlight(saveUserEffect, {
  target: (result) => `/users/${result.id}`,
  setLoaders: Route.seedLoader(UserRoute),
});
```

### SolidStart

- actions/server functions
- route-aware automatic refresh in same response

### TanStack Start

- server functions + middleware
- explicit query-key refetch lists

### SvelteKit

- remote functions
- explicit `refresh()` / `set()`

## Why this design fits this library

This library already has three core ingredients:

- route loaders
- atoms/queries
- a library-owned Reactivity runtime

Using Reactivity as the single-flight coordination layer means:

- the same invalidation model works for atoms and route loaders
- the same mutation handle API can power local and remote flows
- no separate cache system has to be introduced just for single-flight

That keeps the design coherent with the broader direction of the project.

## Current strengths

- route-aware like SolidStart
- more automatic than TanStack Start in the common case
- supports SvelteKit-style direct-set optimization
- strong component/loader type inference
- existing mutation APIs remain the main ergonomic surface

## Current limitation

If a target loader has never run before, the runtime may not yet have captured its dependency graph.

In that case the system falls back to:

- explicit loader keys, or
- matched-loader refresh

This is a correctness-first fallback, but it means the system is not yet perfectly automatic in every first-load scenario.

## Recommended positioning

- explain the feature as Reactivity-native single-flight
- present `Atom.action(..., { singleFlight })` as the normal client API
- present `Route.singleFlight(...)` as the normal server API
- present low-level `Route.*SingleFlight*` functions as advanced infrastructure
