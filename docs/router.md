# Router

The router is schema-first and loader-driven. Route nodes are the app-first
authoring path: a route value carries its path, schemas, loader, head metadata,
and children, and TypeScript can extract those types later.

Component-first routes still exist for lower-level composition and migration.
New application docs and examples should prefer route nodes.

## Golden Path

```ts
import { Component, Route } from "effect-atom-jsx";
import { Effect, Schema } from "effect";

const Home = Route.index(HomePage).pipe(
  Route.id("home"),
);

const User = Route.page("/users/:userId", UserPage).pipe(
  Route.id("users.detail"),
  Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
  Route.querySchema(Schema.Struct({
    tab: Schema.optional(
      Schema.Union(
        Schema.Literal("profile"),
        Schema.Literal("settings"),
      ),
    ),
  })),
  Route.loader((params) =>
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.getUser(params.userId);
    }), {
      staleTime: "30 seconds",
      staleWhileRevalidate: true,
      reactivityKeys: [UsersKey],
    }),
  Route.title((params, user) => user?.name ?? params.userId),
  Route.meta((_params, user) => ({
    description: user ? `Profile for ${user.name}` : "User profile",
  })),
);

export const AppRoutes = Route.define(
  Route.layout(AppShell).pipe(
    Route.id("app"),
    Route.children([
      Route.ref(Home),
      Route.mount(User, [
        Route.page("settings", SettingsPage).pipe(
          Route.id("users.settings"),
        ),
      ]),
    ]),
  ),
);

const userHref = Route.link(User);
userHref({ userId: "ada" }, { query: { tab: "profile" }, hash: "activity" });
```

## Route Node APIs

- `Route.page(path, component)` creates a page route.
- `Route.layout(component)` creates a layout route.
- `Route.index(component)` creates an index route for the parent path.
- `Route.define(root)` materializes a route tree.
- `Route.children(children)` attaches child routes.
- `Route.mount(route, children)` attaches children while preserving the parent
  route identity.
- `Route.ref(route)` references an existing node in a tree.
- `Route.componentOf(route)` extracts the routed component behind a node.

Route pipes are orthogonal:

- `Route.id(id)` assigns a stable id for loaders, payloads, links, and
  diagnostics.
- `Route.paramsSchema(schema)`, `Route.querySchema(schema)`, and
  `Route.hashSchema(schema)` decode URL parts through Effect Schema.
- `Route.loader(loader, options?)` attaches loader data.
- `Route.loaderError(handler)` attaches typed loader error handling.
- `Route.title(...)` and `Route.meta(...)` attach head metadata.
- `Route.guard(...)`, `Route.transition(...)`, and `Route.sitemapParams(...)`
  attach navigation, transition, and SSG metadata.

## Component-First Tier

Use component-first routes when adapting existing component code or when a route
helper needs to stay close to a component.

```ts
const UserPage = Component.from<{ readonly id: string }>(() => null).pipe(
  Component.route("/users/:userId", {
    params: Schema.Struct({ userId: Schema.String }),
  }),
  Route.loader((params) => Effect.succeed({ id: params.userId })),
);
```

This tier is supported, but route-node APIs are clearer for application route
trees.

## Reading Route State

Inside routed components, use route accessors:

- `Route.params` for decoded params.
- `Route.query` for decoded query values.
- `Route.hash` for decoded hash values.
- `Route.prefix` for the matched path prefix.
- `Route.loaderData<A>()` for successful loader data.
- `Route.loaderResult<A, E>()` for the full `Result` state.

Query strings can be edited through atoms:

```ts
const page = yield* Route.queryAtom("page", Schema.NumberFromString, {
  default: 1,
});

page.set(2); // updates the URL query string
```

## Links

`Route.link(route)` creates a typed link helper from a route node, unified route,
or routed component.

```ts
const toUser = Route.link(User);
const href = toUser({ userId: "ada" }, {
  query: { tab: "settings" },
  hash: "security",
});
```

Use `Route.Link` when you want the runtime link component.

## Loaders And Preload

Loaders are Effects. Their requirements bubble through the route tree, and
their results are cached as `Result`.

```ts
const User = Route.page("/users/:userId", UserPage).pipe(
  Route.id("users.detail"),
  Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
  Route.loader((params) =>
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.getUser(params.userId);
    }), {
      staleTime: "30 seconds",
      staleWhileRevalidate: true,
      priority: "critical",
      reactivityKeys: [UsersKey],
    }),
);
```

Preload warms matched route loaders without navigation:

```ts
const router = yield* Route.RouterTag;
yield* router.preload?.("/users/ada");
```

`Route.prefetch(...)` is available when you have an explicit route tree and a
typed link helper. `Route.runMatchedLoaders(url)` runs registry-backed loaders;
`Route.runMatchedLoaders(root, url)` runs loaders from an explicit tree.

## Lazy Components

`Route.lazy(importer, { loading? })` demand-loads a component and exposes
`preload()`.

```ts
const SettingsPage = Route.lazy(
  () => import("./SettingsPage.js"),
  { loading: () => <Spinner /> },
);

void SettingsPage.preload();
```

The component reads from signals, so a render that observes it can update after
the module resolves.

## Head Metadata

Title and metadata can be static values or callbacks:

```ts
Route.title((params, data, result) =>
  result?._tag === "Failure"
    ? "User unavailable"
    : data?.name ?? params.userId,
);

Route.meta((_params, data) => ({
  description: data ? `Profile for ${data.name}` : "User profile",
}));
```

Head resolution rules:

- title: deepest matched route wins.
- meta: root to leaf merge, deeper keys override parent keys.
- callbacks receive `(params, loaderData, loaderResult)`.
- route head callbacks recompute when match, params, or loader state changes.

Helpers:

- `Route.resolveRouteHead(...)`
- `Route.mergeRouteMetaChain(...)`
- `Route.applyRouteHeadToDocument(...)`

## Router Layers

`Route.RouterTag` provides:

- `url: Atom.ReadonlyAtom<URL>`
- `navigate(to, options?)`
- `back()`
- `forward()`
- `preload?(to)`

Built-in layers:

- `Route.Router.Browser` uses the History API and `popstate`.
- `Route.Router.Hash` uses URL hashes and `hashchange`.
- `Route.Router.Server(request)` provides a fixed request URL for SSR.
- `Route.Router.Memory(initial?)` provides in-memory history for tests and
  non-browser environments.

## Single Flight

Single flight combines mutation execution and loader refresh in one transport
round trip. The server executes the mutation, reruns affected loaders, and the
client seeds the loader cache directly from the response.

Client action:

```ts
const save = Atom.action(saveUser, {
  singleFlight: { mode: "auto" },
});
```

Transport layer:

```ts
const AppLayer = Layer.mergeAll(
  ApiLive,
  Reactivity.live,
  Route.Router.Browser,
  Route.FetchSingleFlightTransport({ endpoint: "/_sf" }),
);
```

Server helpers:

- `Route.singleFlightHandler(...)`
- `Route.seedLoader(...)`
- `Route.hydrateSingleFlightPayload(...)`
- `Route.serializeLoaderData(...)`
- `Route.deserializeLoaderData(...)`

## SSR, Streaming, And Sitemaps

- `Route.runStreamingNavigation(...)` splits critical and deferred loader data.
- `Route.streamDeferredLoaderScripts(...)` serializes deferred loader payloads.
- `Route.collectSitemapEntries(...)` collects routes for SSG or sitemap
  generation.
- `Route.sitemapParams(...)` enumerates dynamic params for sitemap generation.
- `Route.validateTree(...)` reports duplicate ids, conflicting sibling
  patterns, and duplicate params.

## Testing

Use `Route.Router.Memory(initial)` with `Effect.provide(...)`:

```ts
Effect.runSync(
  Effect.gen(function* () {
    const router = yield* Route.RouterTag;
    yield* router.navigate("/users/ada");
    expect(router.url().pathname).toBe("/users/ada");
  }).pipe(Effect.provide(Route.Router.Memory("/"))),
);
```

Use `Reactivity.test` for deterministic invalidation and
`Route.runMatchedLoaders(...)` for direct loader orchestration tests.

## Related Docs

- `docs/API.md`
- `docs/SERVICES_AND_LAYERS.md`
- `docs/reactivity.md`
- `docs/TESTING.md`
