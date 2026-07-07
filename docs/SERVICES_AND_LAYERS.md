# Services and Layers

How dependency injection works in effect-atom-jsx: where services enter, how
requirements flow through the types, who shares which instance, and when to
use which provision tier.

One rule underlies everything: **a service requirement is an entry on the
`R`/`Req` type axis, and providing a layer subtracts from it.** Forgetting a
provider is a compile error, not a runtime "undefined context" surprise.

## The One-Composition-Root Doctrine

Build **one** `AppLayer` and feed it to both worlds — the atom runtime and
the component tree:

```ts
import { Layer } from "effect";
import { Atom, Component, Reactivity } from "effect-atom-jsx";

// The single composition root.
const AppLayer = Layer.mergeAll(ApiLive, ThemeLive, Reactivity.live);

// Atom world: module-level runtime-bound atoms/actions.
export const appRuntime = Atom.runtime(AppLayer);

// Component world: the mounted tree.
const dispose = Component.mount(App, {
  props: {},
  target: document.getElementById("app")!,
  layer: AppLayer,
});
```

Why this matters: `Atom.runtime(layer)` and `Component.mount(..., { layer })`
each build their own service world. If you construct them from *different*
layer values, a component can execute under one `Reactivity` (or `Api`)
instance while the atom it reads was built under another. Each side is
internally consistent, but they will not see each other's invalidations or
share connection state — the classic "works in the app, breaks in the test"
trap. Deriving both from one `AppLayer` value is the golden path.

> Open design question (tracked as S1 in
> `CURRENT_STATUS_IN_REDESIGN_PLAN.md`): whether `Component.mount` should
> accept the `AtomRuntime` directly so the two worlds are structurally one.

## The Four Provision Tiers

| Tier | API | Instance lifetime | Use for |
|---|---|---|---|
| **App root** | `Component.mount({ layer })`, `Atom.runtime(layer)` | Application lifetime (until dispose) | Expensive, stateful, shared: DB/RPC clients, `Reactivity.live`, `Theme`, analytics |
| **Subtree** | `Component.withLayer(layer)` | Per component **instance**; released when that instance unmounts | Feature-scoped services: a WebSocket for a live view, a scoped cache, per-route service overrides |
| **Per-operation** | `Effect.provide(layer)` inside setup/actions/loaders | One Effect execution | Cheap or variant implementations: an HTTP client with different options for one call |
| **Ambient framework tags** | `Reactivity.Tag`, `Theme`, `View.PlatformTag`, `Style.PlatformTag`, `Route.SingleFlightTransportTag` | Wherever provided (usually app root) | Swapping framework behavior: `Reactivity.test`, a fake single-flight transport, a platform vocabulary |

### Decision criteria

Adapted to our tiers (cf. Foldkit's Resources guidance):

1. **Construction cost.** Expensive to build (pools, RPC clients, WebSocket
   managers) → app root. Cheap (fetch wrapper) → per-operation is fine.
2. **Instance identity.** Must every consumer see the *same* instance
   (shared cache, connection, in-memory state)? → app root. Fresh instance
   per feature is correct? → subtree.
3. **Failure blast radius.** A layer that fails at the app root fails the
   mount; a layer that fails in `withLayer` fails that component's setup and
   is catchable with `Component.withErrorBoundary` / setup retry. Put risky
   construction at the tier whose failure you can afford.
4. **Implementation variety.** Need different implementations of the same
   tag in different places (mock in a story, variant per route)? → subtree
   or per-operation; the app root can only hold one.

## Sharing Semantics — The Sharp Questions

**Do two sibling components with `withLayer(ApiLive)` share one `Api`
instance?** **No.** `withLayer` wraps the component's setup in
`Effect.provide(layer)`, so the layer is built once **per component
instance**, when that instance's setup runs. Two siblings — or two instances
of the same component — each get their own service, each released with its
own scope. If you need one shared instance, provide it at the app root (or a
common ancestor) instead. This is the most common services mistake: a
connection pool in `withLayer` means one pool per component instance.

**When are `withLayer` services released?** With the component instance's
scope, on unmount. Layer finalizers run then — this is why a WebSocket
service provided to a modal closes when the modal closes.

**What does `withLayer` do to the types?** Subtracts: the component's `Req`
loses the services the layer provides (`Exclude<Req, ROut>`) and gains the
layer's own inputs (`RIn`) and error channel (`E2`). Providing everything
means `Req = never` and the component mounts anywhere.

**How do setup helpers see services provided later in the pipe?**
Capture-at-setup: `Component.query`, `Component.action`, and
`Component.optimistic(...).action(...)` capture the setup-time `ServiceMap`
when the handle is created and use it for every later run. An action invoked
long after setup returned still executes against the services the component
was built with — including ones supplied by `withLayer`. Corollary: layers
added *around an already-created handle* do not affect it; provision must be
in place by the time setup runs.

**Where do requirements come from?** Two places, unioned automatically:
explicit `Component.require(Api)` declarations, and inference from setup —
a `Component.query` whose Effect uses `Api` adds `Api` to the component's
`Req` without any annotation. The same bubbling carries route-loader
requirements up to the router. Extract with
`Component.Requirements<typeof C>` / `Component.Errors<typeof C>`.

**Runtime-bound atoms and requirement subsets.** `Atom.runtime(layer)`
accepts effects whose requirements are a *subset* of what the layer provides
(`RReq extends R`); requirements are eliminated at construction, so the
resulting atoms/actions carry `R = never`.

## Server: Request Scoping Is a Correctness Rule

On the server there are exactly two lifetimes, and conflating them is a
security bug:

- **App-lifetime services** — DB pools, RPC clients, config. Build the layer
  **once** at process start.
- **Request-scoped services** — auth context, request info, per-request
  caches. Build a fresh layer **per request** from the `Request`, and merge
  the app layer in.

```ts
const AppServicesLive = Layer.mergeAll(DbLive, ConfigLive); // built once

const handleRequest = (request: Request) =>
  ServerRoute.dispatch(routes, request, {
    // per-request layer: fresh AuthContext per dispatch, shared Db merged in
    layer: Layer.mergeAll(
      AppServicesLive,
      Layer.sync(AuthContext, () => authFromHeaders(request.headers)),
    ),
  });
```

`ServerRoute.dispatch({ layer })` builds the provided layer per execution
(for both document routes and data-route handlers), so request-scoped
services never leak one request's state into another —
`src/__tests__/server-route.test.ts` ("per-request isolation") locks this
behavior in. The rule: **anything derived from the `Request` goes in the
per-dispatch layer; anything expensive goes in the app layer merged into
it.** Never hoist an auth/request service into the once-built app layer.

## Services as Reactive Participants (the canonical pattern)

How does a service drive the UI without knowing about the UI? Reactivity
keys are the contract:

```ts
const Users = Reactivity.Key.make("users");

class UsersService extends Effect.Tag("UsersService")<UsersService, {
  readonly list: () => Effect.Effect<ReadonlyArray<User>>;
  readonly add: (name: string) => Effect.Effect<User>;
}>() {
  static live = Layer.succeed(UsersService, {
    // reads participate in dependency tracking
    list: () => Reactivity.tracked(fetchUsers(), { keys: [Users] }),
    // writes invalidate the same witness
    add: (name) => Reactivity.invalidating(createUser(name), [Users]),
  });
}
```

The service stays UI-agnostic; components and route loaders stay
service-shape-agnostic; the key witness is the only coupling. Loaders that
`yield*` tracked service reads get their reactivity keys captured
automatically — no explicit `reactivityKeys` option needed — and
single-flight mutations use the same captured keys to pick which loaders to
refresh. Prefer putting `tracked`/`invalidating` **inside service methods**
(one place) over sprinkling keys at call sites.

## Testing

Swapping implementations is layer substitution, nothing else:

- `Reactivity.test` instead of `Reactivity.live` → manual `flush()`,
  `lastInvalidated()` introspection.
- A `Layer.succeed(Api, fakeApi)` at whichever tier the real one occupied.
- Per-dispatch layers in server tests give you request isolation for free.

No component, atom, or route code changes between live and test composition.
