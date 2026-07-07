# Single-Flight Mutations

Single-flight mutations let a mutation response carry both:

- the mutation result
- refreshed route-loader payloads for the current/target page

That removes the usual second round trip where the client mutates first and then refetches route data.

## Recommended public API

Client:

```ts
const saveUser = Atom.action(
  (input: SaveUserInput) => api.saveUser(input),
  { name: "save-user" },
);
```

When a `SingleFlightTransport` is installed, this can work transparently without per-mutation transport wiring.

Server:

```ts
const saveUserHandler = Route.singleFlight(
  (input: SaveUserInput) => api.saveUser(input),
  {
    target: (result) => `/users/${result.id}`,
    setLoaders: Route.seedLoader(UserRoute),
  },
);
```

## How it works

1. A route loader reads atoms/queries.
2. The Reactivity runtime captures those reads and stores the keys on the loader cache entry.
3. A mutation invalidates Reactivity keys.
4. Single-flight matches the current/target route branch.
5. Only loaders whose captured keys intersect the invalidated keys are rerun.
6. The response returns both mutation data and loader payloads.
7. The client hydrates those payloads into route-loader cache automatically.

## Loader dependency capture

Loaders usually do not need explicit `reactivityKeys` anymore.

The ideal style is service-first:

```ts
const UsersLive = Layer.succeed(UsersService, {
  byId: (id: string) => Reactivity.tracked(
    Effect.sync(() => usersStore().find((user) => user.id === id)!),
    { keys: ["users", `user:${id}`] },
  ),
});
```

Then loaders stay focused on composition:

```ts
const UserRoute = Component.from<{}>(() => null).pipe(
  Component.route("/users/:userId"),
  Route.loader((params: { readonly userId: string }) =>
    Effect.gen(function* () {
      const users = yield* UsersService;
      return yield* users.byId(params.userId);
    }),
  ),
);
```

```ts
const usersAtom = Atom.value(initialUsers).pipe(Atom.withReactivity(["users"]));

const UsersRoute = Component.from<{}>(() => null).pipe(
  Component.route("/users"),
  Route.loader(() => Effect.sync(() => usersAtom())),
);
```

Because `usersAtom()` is read inside the loader, the loader automatically records `"users"` as a dependency.

## Mutation invalidation

Service-first writes should prefer `Reactivity.invalidating(...)`:

```ts
const UsersLive = Layer.succeed(UsersService, {
  save: (input: SaveUserInput) => Reactivity.invalidating(
    Effect.sync(() => updateUser(input)),
    (user) => ["users", `user:${user.id}`],
  ),
});
```

Mutations can invalidate keys directly:

```ts
const saveUser = Atom.action(
  (input: SaveUserInput) =>
    Effect.sync(() => {
      Atom.invalidateReactivity({ user: [input.id], users: ["list"] });
      return input;
    }),
  {
    singleFlight: {
      endpoint: "/_single-flight/users/save",
      url: (input) => `/users/${input.id}`,
    },
  },
);
```

If no invalidation keys are emitted, single-flight falls back to matched-loader refresh for correctness.

## Direct loader seeding

If the mutation result already contains the canonical next data, skip rerunning the loader and seed its payload directly.

### Short form

```ts
const saveUserHandler = Route.singleFlight(
  (input: SaveUserInput) => api.saveUser(input),
  {
    target: (result) => `/users/${result.id}`,
    revalidate: "none",
    setLoaders: Route.seedLoader(UserRoute),
  },
);
```

### Projected form

```ts
const saveUserHandler = Route.singleFlight(
  (input: SaveUserInput) => api.saveUser(input),
  {
    target: (result) => `/users/${result.id}`,
    revalidate: "none",
    setLoaders: Route.seedLoader(UserRoute, (result) => ({
      id: result.id,
      name: result.profile.name,
    })),
  },
);
```

### Full control

```ts
const saveUserHandler = Route.singleFlight(
  (input: SaveUserInput) => api.saveUser(input),
  {
    setLoaders: (result) => [
      Route.setLoaderData(UserRoute, result),
      Route.setLoaderResult(StatsRoute, Result.success({ total: result.totalUsers })),
    ],
  },
);
```

## API layering

- use `Atom.action(..., { singleFlight })` on the client
- use `Route.singleFlight(...)` on the server
- use `Route.actionSingleFlight(...)`, `Route.createSingleFlightHandler(...)`, and `Route.invokeSingleFlight(...)` only when you need lower-level control

## Comparison to other systems

- SolidStart: similarly automatic, but this library uses Reactivity-key capture for more granular loader refresh selection.
- TanStack Start: less manual than query-key middleware because loader dependencies can be inferred from reads.
- SvelteKit: now has a comparable direct-set optimization via `Route.seedLoader(...)`, `Route.setLoaderData(...)`, and `Route.setLoaderResult(...)`.

## Example

See `examples/router-single-flight/` for a complete in-memory demo covering:

- route loaders reading reactive atoms
- client mutation via `Atom.action(..., { singleFlight })`
- server handler via `Route.singleFlight(...)`
- direct payload seeding with `Route.seedLoader(...)`

For a framework-by-framework comparison, see `docs/SINGLE_FLIGHT_COMPARISON.md`.

For transport/runtime setup, see `docs/SINGLE_FLIGHT_TRANSPORT.md`.
