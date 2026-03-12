# ADR-006: Unified Route Model — `Component().pipe(Route.path(...), ...)`

- Status: Proposed
- Date: 2026-03-12 (revised)

---

## Context

Two routing authoring styles currently coexist:

```ts
// Component-first
const UserPage = MyComponent.pipe(Component.route("/users/:id"))

// Node-first
const UserNode = Route.page("/users/:id").pipe(
  Route.paramsSchema(ParamsSchema),
  Route.loader(loadUser),
  Route.componentOf(MyComponent),
)
```

Both are awkward in the same way: the component and the route node are separate things that reference each other. They have unequal TypeScript inference, different helper names (`Route.titleFor` vs `Route.title`), and two parallel internal implementations that must stay in sync for every new routing feature.

---

## Proposed Model

A route is what you get when you pipe routing metadata onto a component. The component is always the starting point. `Route.path(string)` is the bridge pipe that converts a `Component<C, ...>` into a `Route<C, P, ...>`. All subsequent `Route.*` pipes accumulate types on the Route.

```ts
const UserRoute = Component.make(
  Component.props<{}>(),
  Component.require(Route.Context),
  () => Effect.gen(function* () {
    const { params, loaderData } = yield* Route.Context
    return { id: params.id, user: loaderData }
  }),
  (_, { user }) => <div>{user.name}</div>,
).pipe(
  Route.path("/users/:id"),
  Route.paramsSchema(Schema.Struct({ id: Schema.String })),
  Route.loader(({ id }) => api.getUser(id)),
  Route.title(({ loaderData }) => loaderData.name),
  Route.guard(requireAuth),
)
// → Route<C, { id: string }, {}, undefined, User, never>
```

---

## The `Route<C, P, Q, H, LD, LE>` Type

The Route type carries six type parameters:

```ts
interface Route<
  C extends AnyComponent,           // the wrapped component
  P extends Record<string, string>, // decoded URL params
  Q extends Record<string, unknown>,// decoded query string
  H extends string | undefined,     // decoded hash
  LD,                               // loader data (void = no loader)
  LE = never,                       // loader error
> {
  readonly component: C
  readonly meta: RouteMeta<P, Q, H, LD, LE>
  pipe<A>(f: (self: this) => A): A
  pipe<A, B>(f1: (self: this) => A, f2: (a: A) => B): B
  // ... standard pipe overloads
}
```

Adding a loader error type parameter (`LE`) is new relative to the current model. It makes `Route.loaderResult` return `Result<LD, LE>` fully typed, and makes `<Async result={loaderResult} error={cases} />` type-check the error handler against the actual loader error type. The current workaround — `Route.loaderErrorFor(component, cases)` — disappears because `LE` is in the Route type and flows naturally.

A layout route is a distinct type that enables `Route.children`:

```ts
interface LayoutRoute<C, P, Q, H, LD, LE>
  extends Route<C, P, Q, H, LD, LE> {
  readonly _tag: "Layout"
  readonly children: ReadonlyArray<AnyRoute>
}
```

`Route.children(routes)` only accepts `LayoutRoute<...>` as its input. Calling `Route.children` before `Route.layout()` in the pipe chain is a type error.

---

## Pipe Step Mechanics

### `Route.path` — the bridge

`Route.path` is the one pipe step that accepts a `Component` (not a Route). It is how you enter the Route type:

```ts
declare function path<Pattern extends string>(
  pattern: Pattern,
): <C extends AnyComponent>(
  component: C,
) => Route<C, ExtractParams<Pattern>, {}, undefined, void, never>
```

All other `Route.*` pipe steps accept `Route<C, ...>` and return `Route<C, ...>`. This means:

- You can only start a route chain with `Route.path`.
- You cannot accidentally apply `Route.loader` to a bare Component — it would be a type error.
- The Component's own `pipe` overloads are already generic in their return type (`pipe<A>(f: Component<...> => A): A`), so `Route.path` plugs in without changes to the Component type machinery.

### Subsequent pipes

Each step is a curried function from `Route<C, P, Q, H, LD, LE>` to a new Route with at most one type parameter changed:

```ts
// Route.paramsSchema — narrows P
declare function paramsSchema<POut>(
  schema: Schema.Schema<POut, Record<string, string>>,
): <C, Q, H, LD, LE>(
  route: Route<C, any, Q, H, LD, LE>,
) => Route<C, POut, Q, H, LD, LE>

// Route.querySchema — narrows Q
declare function querySchema<QOut>(
  schema: Schema.Schema<QOut, Record<string, string>>,
): <C, P, H, LD, LE>(
  route: Route<C, P, any, H, LD, LE>,
) => Route<C, P, QOut, H, LD, LE>

// Route.loader — sets LD and LE
declare function loader<P, Q, LD, LE = never, R = never>(
  fn: (params: P, query: Q) => Effect.Effect<LD, LE, R>,
): <C, H>(
  route: Route<C, P, Q, H, void, never>,
) => Route<C, P, Q, H, LD, LE>

// Route.layout — changes to LayoutRoute, enables Route.children
declare function layout(): <C, P, Q, H, LD, LE>(
  route: Route<C, P, Q, H, LD, LE>,
) => LayoutRoute<C, P, Q, H, LD, LE>

// Route.children — only available on LayoutRoute
declare function children(
  routes: ReadonlyArray<AnyRoute>,
): <C, P, Q, H, LD, LE>(
  route: LayoutRoute<C, P, Q, H, LD, LE>,
) => LayoutRoute<C, P, Q, H, LD, LE>

// Route.title / Route.meta — no type change, callbacks are typed
declare function title(
  fn: string | ((ctx: { params: P; loaderData: LD }) => string),
): <C, P, Q, H, LD, LE>(
  route: Route<C, P, Q, H, LD, LE>,
) => Route<C, P, Q, H, LD, LE>

// Route.guard — no type change
declare function guard(
  effect: Effect.Effect<void, Redirect | NotFound, any>,
): <C, P, Q, H, LD, LE>(
  route: Route<C, P, Q, H, LD, LE>,
) => Route<C, P, Q, H, LD, LE>
```

---

## Pattern String → Params Type Inference

`Route.path("/users/:id/posts/:postId")` should give `P = { readonly id: string; readonly postId: string }` without any schema declaration. This is pure TypeScript template literal inference:

```ts
type ExtractParams<S extends string> =
  S extends `${string}:${infer Param}/${infer Rest}`
    ? { readonly [K in Param]: string } & ExtractParams<`/${Rest}`>
    : S extends `${string}:${infer Param}`
      ? { readonly [K in Param]: string }
      : {}
```

Edge cases to handle:

- **Optional params** (`/:id?`): yields `{ readonly id?: string }`. TypeScript conditional types can detect the `?` suffix.
- **Wildcard** (`/*` or `/$`): yields `{ readonly "*": string }` or a marker type. Probably best to yield `{}` with a `Route.wildcard()` pipe that marks the route as a catch-all without trying to type the wildcard value.
- **No params** (`/users`): `ExtractParams<"/users">` = `{}`. Works as expected.
- **Nested schemas.** `Route.paramsSchema(schema)` always *replaces* the inferred P with the schema's output type. The inferred `{ id: string }` is the raw string form; after `Route.paramsSchema(Schema.Struct({ id: Schema.NumberFromString }))`, `P` becomes `{ id: number }`. The constraint is that the schema input must be compatible with `Record<string, string>` (what the URL parser produces).

**Watch out:** TypeScript's template literal type inference has depth limits. Very long patterns with many segments may hit the recursion cap. A fallback: if `ExtractParams<S>` returns `{}` (unresolved), the developer must supply `Route.paramsSchema` to get typed params. This is not a regression — it's the same as the current model for complex patterns.

---

## `Route.loader` Callback Inference

The hardest TypeScript problem in the chain. For `params` to be inferred as `P` inside the callback:

```ts
Component.make(...).pipe(
  Route.path("/users/:id"),
  Route.paramsSchema(ParamsSchema),
  Route.loader((params) => api.getUser(params.id)),  // params should be ParamsOut
)
```

TypeScript processes `pipe` arguments left-to-right with contextual typing. After the `paramsSchema` step, the route type is `Route<C, ParamsOut, {}, undefined, void, never>`. When `Route.loader(fn)` is evaluated, TypeScript must infer the callback's parameter type from the route's `P` type.

**Solution:** define `Route.loader` so its callback receives `P` from the *input* Route type, not as a free generic:

```ts
// This form binds P to the input Route's P at call time:
declare function loader<LD, LE = never, R = never>(
  fn: (params: NoInfer<P>, query: NoInfer<Q>) => Effect.Effect<LD, LE, R>,
): (route: Route<C, P, Q, H, void, never>) => Route<C, P, Q, H, LD, LE>
```

`NoInfer<P>` (available since TypeScript 5.4) prevents TypeScript from trying to infer `P` *from* the callback argument — it must already be resolved from the Route input type. Without `NoInfer`, TypeScript may infer `P = {}` from the callback if the callback doesn't constrain it.

**Alternative for pre-TS-5.4:** Use a two-call form internally — `Route.loader` takes the fn and returns a deferred function that, when applied to the Route, resolves P and Q from the Route type. This is already how curried generics work in Effect.

**Watch out:** if `Route.paramsSchema` is omitted and only `Route.path` is used, `P` is `{ param: string, ... }` (strings). The loader callback `(params) => ...` gets `params: { id: string }`. If the user writes `params.id.toFixed(2)`, TypeScript catches it. This is correct behavior.

---

## `Route.Context` — How Components Access Typed Route Data

`Route.Context` is a service tag for `RouteContext<P, Q, H, LD, LE>`. Components that need routing data declare:

```ts
Component.require(Route.Context)
```

The service is generic. Inside the component, `yield* Route.Context` gives back `RouteContext<any, any, any, any, any>` unless the type is narrowed. The narrowing happens via the Route wrapper — the Route provides a concretely-typed `RouteContext<P, Q, H, LD, LE>` as a Layer.

**Problem:** at component *definition* time, the Route hasn't been created yet. The component's `Route.Context` requirement is opaque. The types only become concrete when the Route's pipe chain completes and provides the context.

**Solutions:**

**Option A — Trust and verify at registration.** Components declare `Component.require(Route.Context)` without type parameters. Accessors like `Route.params`, `Route.query`, `Route.loaderData` return `any` inside the component. The Route verifies at construction that the accumulated types are correct, but inside the component body, the user is trusting the Route's pipe chain. This is the weakest typing but zero friction — no generics at the component level.

**Option B — Explicit generic declaration.** Components declare their expected context type:

```ts
Component.require(Route.Context.typed<typeof UserRoute>())
```

Where `Route.Context.typed<R>()` produces a tag typed to the Route's `P/Q/H/LD`. This requires a forward reference — the component must reference the Route, which references the component. Circular reference problem.

**Option C — Accessor typing via `Route.useParams<P>()`.** Instead of `yield* Route.Context`, provide typed accessor effects that take a type argument or infer from position:

```ts
const params = yield* Route.useParams<typeof ParamsSchema>()
// params: { id: string } — typed to the schema
```

This decouples the component's typing from the Route's existence. The type comes from the schema used in the pipe chain, not from the Route itself. Duplication (you declare the schema in both the component and the Route) but is self-contained.

**Option D — Inference via pipe chain check.** The most complete solution: `Route.path` (the bridge step) checks that the component's inferred `Route.Context` requirement is compatible with the accumulated Route type. The component writes `yield* Route.Context` and gets the context typed *by the Route*, because TypeScript's type inference resolves the component's `C` type at the time `Route.path` is called, and `Route.path` injects the typed context.

This requires `Route.path` to be implemented as:

```ts
declare function path<Pattern extends string, P = ExtractParams<Pattern>>(
  pattern: Pattern,
): <
  C extends ComponentRequiringContext<P, any, any, any>,
>(
  component: C,
) => Route<C, P, {}, undefined, void, never>
```

Where `ComponentRequiringContext<P, Q, H, LD>` is a constraint that says "C's Route.Context requirement accepts at least these types". The component's type carries its requirements, and `Route.path` constrains that the provided `P` is compatible.

**Recommended: Option A with accessor functions.** Inside components, use `Route.params`, `Route.query`, `Route.loaderData` — not raw `yield* Route.Context`. These accessors are typed as `Effect<RouteContextTag["params"]>` which resolves to the Route-provided type at runtime. This is the same pattern as Effect services — you declare the requirement, the provider gives you the typed value. Document that the typing of `Route.params` inside a component is `readonly Record<string, string>` at definition time and becomes `P` when the Route's layer is active. In practice, since you define the component and its Route in the same file, TypeScript can often infer the right type if you extract the schema/loader types explicitly.

---

## Loader Service Requirements (`R`)

The loader function is `Effect<LD, LE, R>`. `R` must be satisfied. Two mechanisms:

**`Route.withLayer(layer)` in the pipe chain:**

```ts
Component.make(...).pipe(
  Route.path("/users/:id"),
  Route.loader(({ id }) =>
    Effect.service(UserApi).pipe(Effect.flatMap(api => api.getUser(id)))
  ),
  Route.withLayer(UserApiLive),  // satisfies R = UserApi
)
```

This is the simplest and most explicit path. Each route can provide its own services.

**RouterRuntime layer (ambient):**

The RouterRuntime is created with a layer that satisfies all loaders' requirements:

```ts
const runtime = RouterRuntime.create(routes, AppLayer)
```

If a loader requires `UserApi` and `AppLayer` provides it, the requirement is satisfied without `Route.withLayer`. This is more ergonomic for large apps where all loaders share the same service layer.

**Watch out:** `R` constraints are checked at router creation time, not at route definition time. If you forget `Route.withLayer` and the runtime layer doesn't provide `UserApi`, you get a type error at `RouterRuntime.create(routes, layer)` that says `UserApi` is unresolved. This is good (caught at build time) but the error location is distant from the loader definition.

---

## `Route.guard` — Effect Requirements and Redirect Semantics

Guards are Effect programs that run before the component mounts. They fail by yielding a redirect or not-found:

```ts
// Guard effect type
Effect.Effect<void, Route.Redirect | Route.NotFound, R>

// Usage
Route.guard(
  Effect.gen(function* () {
    const auth = yield* AuthService
    if (!auth.isLoggedIn()) {
      yield* Route.serverRedirect("/login")
    }
  })
)
```

`Route.Redirect` and `Route.NotFound` are tagged error types, not exceptions. The guard's `R` requirements are satisfied the same way as loader requirements — via `Route.withLayer` or the RouterRuntime layer.

**Watch out:** Guards have access to `Route.params` (from the current URL) but *not* to `Route.loaderData` — the loader hasn't run yet. If a guard needs to check loaded data (e.g., permission on a specific resource), the permission check should be part of the loader itself, returning a `Failure` result or redirecting from within the loader's error handling.

---

## Lazy Loading

`Component.lazy` defers the component import. The Route exists immediately for matching and loader prefetch:

```ts
const UserRoute = Component.lazy(() =>
  import("./UserPage").then(m => m.UserPage)
).pipe(
  Route.path("/users/:id"),
  Route.loader(loadUser),
)
```

`Component.lazy(fn)` produces a `LazyComponent<C>` which extends `AnyComponent` and satisfies `Route.path`'s input constraint. The component is only resolved on first render; the Route (including its loader) is fully operational before that.

**Type inference with lazy:** `LazyComponent<C>` carries the component type `C`. `Route.path` receives it and produces `Route<LazyComponent<C>, P, ...>`. `Route.ParamsOf`, `Route.LoaderDataOf` etc. work normally. The lazy wrapper is transparent to the Route type.

**`Route.lazy` (existing) vs `Component.lazy`:** the existing `Route.lazy` pipe takes a loader function and applies it to a route. With the unified model, lazy loading is a Component concern (what to render lazily), not a Route concern (the Route is always eager). `Route.lazy` can be deprecated in favor of `Component.lazy`.

---

## Layouts and Nesting

```ts
const AppLayout = Component.make(...).pipe(   // renders <Route.Outlet />
  Route.path("/"),
  Route.layout(),
  Route.children([
    Component.make(...).pipe(Route.index()),
    UserRoute,
    Component.make(...).pipe(Route.path("*")),
  ]),
)
```

`Route.layout()` changes the Route type to `LayoutRoute<C, P, Q, H, LD, LE>`. `Route.children` is only callable on a `LayoutRoute`. Calling `Route.children` on a plain `Route` is a type error — the compiler tells you to add `Route.layout()` first.

**Relative paths:** child route paths are relative to the parent layout's path. `Component.make(...).pipe(Route.path("users"))` under a `/` layout becomes `/users`. Under a `/admin` layout it becomes `/admin/users`. The RouterRuntime resolves full paths from the tree structure; the developer writes only the segment.

**Index routes:** `Route.index()` marks a route as the index of its parent layout. It matches when the parent's path matches exactly. No path segment of its own.

**`Route.validateTree(root)`** validates the tree: checks for duplicate patterns among siblings, missing layouts, orphaned children. Works on `Route<C, ...>` and `LayoutRoute<C, ...>` identically.

---

## `Route.link` and Typed Navigation

```ts
const UserRoute = Component.make(...).pipe(
  Route.path("/users/:id"),
  Route.paramsSchema(Schema.Struct({ id: Schema.String })),
)

const link = Route.link(UserRoute)
link({ id: "123" })          // → "/users/123"
link({ id: "123" }, { tab: "posts" })  // → "/users/123?tab=posts" if Q allows

// In JSX:
<Route.Link to={UserRoute} params={{ id: "123" }}>View user</Route.Link>
```

`Route.link(route)` infers `Route.ParamsOf<typeof route>` and `Route.QueryOf<typeof route>`. The link helper is fully typed without explicit generics at the callsite. This already works similarly in the current node-first model; the change is that `route` is now a `Route<C, ...>` from a component pipe chain rather than an `AppRouteNodeDef`.

`Route.Link` component accepts `to: AnyRoute` and `params: ParamsOf<typeof to>` — same inference, JSX-friendly.

---

## Helpers That Disappear

These helpers exist only to work around the current dual-system inference gap. In the unified model, all inference flows through the pipe chain, so they are no longer needed:

| Removed helper | Why it existed | Replacement |
|----------------|----------------|-------------|
| `Route.titleFor(component, fn)` | Component-first had weak inference for title callbacks | `Route.title(fn)` in the pipe chain — P and LD are fully typed |
| `Route.metaFor(component, fn)` | Same | `Route.meta(fn)` in the pipe chain |
| `Route.loaderErrorFor(component, cases)` | Component-first didn't expose LE type | `LE` is now a Route type param; no helper needed |
| `Route.componentOf(component)` | Node-first needed to attach a component after-the-fact | Component is always the starting point |
| `Component.route(pattern)` | Component-first entry point | `Component.pipe(Route.path(pattern))` |
| `Component.guard(effect)` | Component-first guard | `Route.guard(effect)` in the pipe chain |
| `Route.page(pattern)` | Node-first page constructor | `Component.make(...).pipe(Route.path(pattern))` |
| `Route.layout(pattern)` | Node-first layout constructor | `Component.make(...).pipe(Route.path(pattern), Route.layout())` |
| `Route.index()` (as constructor) | Node-first index constructor | `Component.make(...).pipe(Route.index())` |
| `Route.define` | Node-first general constructor | Removed |

Extraction helpers are renamed for clarity but kept:

| Current | New |
|---------|-----|
| `Route.RouteNodeParamsOf<T>` | `Route.ParamsOf<T>` |
| `Route.RouteNodeQueryOf<T>` | `Route.QueryOf<T>` |
| `Route.RouteNodeHashOf<T>` | `Route.HashOf<T>` |
| `Route.RouteNodeLoaderDataOf<T>` | `Route.LoaderDataOf<T>` |
| `Route.RouteNodeLoaderErrorOf<T>` | `Route.LoaderErrorOf<T>` |

---

## Implementation Surface Area

### New / Changed

| File / Export | Change |
|---------------|--------|
| `src/Route.ts` | Add `Route<C, P, Q, H, LD, LE>` type. Add `LayoutRoute<C, ...>`. Add `Route.path` as Component→Route bridge. Update `Route.loader`, `Route.paramsSchema`, `Route.querySchema`, `Route.hashSchema`, `Route.title`, `Route.meta`, `Route.guard`, `Route.transition`, `Route.prefetch`, `Route.layout`, `Route.children`, `Route.index`, `Route.withLayer`, `Route.lazy` to accept `Route<C, ...>` input. |
| `src/Route.ts` (context) | Rename `RouteContextTag` → `Route.Context`. Make it generic `Route.Context<P, Q, H, LD, LE>`. |
| `src/Route.ts` (extraction helpers) | Add `Route.ParamsOf<T>`, `Route.QueryOf<T>`, `Route.HashOf<T>`, `Route.LoaderDataOf<T>`, `Route.LoaderErrorOf<T>`. |
| `src/Route.ts` (link) | Update `Route.link` to accept `Route<C, ...>`. |
| `src/Route.ts` (validate/introspect) | Update `Route.validateTree`, `Route.nodes`, `Route.fullPathOf`, `Route.paramNamesOf`, `Route.validateLinks` to accept `Route<C, ...>` and `LayoutRoute<C, ...>`. |
| `src/Component.ts` | Verify `component.pipe()` overloads are generic in return type (not constrained to `Component<...>`). Likely no change needed. |
| `src/Component.ts` | Add `Component.lazy(fn)`. |
| `src/RouterRuntime.ts` | Update `RouterRuntime.create(routes, layer)` to accept `ReadonlyArray<Route<any, ...>>` instead of the current route node types. |
| `src/RouterRuntime.ts` | Update snapshot/navigation internals to read from `Route<C, ...>` meta instead of `AppRouteNodeState`. |

### Deprecated / Removed

| Export | Status |
|--------|--------|
| `AppRouteNodeDef`, `AppRouteNodeState`, `MaterializedAppRoute` | Remove (internal types, not public) |
| `Route.page`, `Route.layout` (as constructors), `Route.index` (as constructor), `Route.define`, `Route.ref`, `Route.mount`, `Route.componentOf` | Deprecate with migration note; remove in next major |
| `Component.route`, `Component.guard` | Deprecate; `Route.path` and `Route.guard` in chain replace them |
| `Route.titleFor`, `Route.metaFor`, `Route.loaderErrorFor` | Remove (no longer needed) |
| `Route.RouteNodeParamsOf` etc. | Keep as aliases of `Route.ParamsOf` during migration |

### Unchanged

- `Route.params`, `Route.query`, `Route.loaderData`, `Route.loaderResult`, `Route.hash`, `Route.prefix` — accessor APIs
- `Route.queryAtom(key, schema)` — URL-synced atom
- `Route.link(route)` — typed navigation (input type changes, behavior unchanged)
- `Route.Link` component
- `Route.Switch`, `Route.collect`, `Route.collectAll`
- Single-flight: `Route.singleFlight`, `Route.actionSingleFlight`, `Route.FetchSingleFlightTransport`, etc.
- SSR: `Route.renderRequest`, `Route.renderRequestWithRuntime`, `Route.serializeLoaderData`, etc.
- `Route.Router.Browser`, `Route.Router.Hash`, `Route.Router.Server`, `Route.Router.Memory`
- `ServerRoute` API entirely
- `RouterRuntime` API (methods unchanged; input type for `create` changes)

---

## Things to Watch Out For

**1. `pipe` return type widening in Component.**
If `Component.pipe` is currently typed with overloads constrained to `Component<...> → Component<...>`, `Route.path` returning a `Route<C, ...>` will be a type error. Audit the pipe overloads. If they already follow the generic `pipe<A>(f: (self: this) => A): A` pattern (like Effect), no change is needed.

**2. Circular reference between component and route type.**
If a component tries to declare `Route.Context<typeof UserRoute>` as its requirement, it creates a circular reference (`UserRoute` references the component, the component references `UserRoute`). The solution is Option A from the context section: components don't explicitly parameterize `Route.Context`; they declare it opaquely and access context via typed accessor effects.

**3. `NoInfer` availability.**
`NoInfer<T>` is a TypeScript 5.4 built-in. If the project targets earlier TypeScript, use the standard workaround: `[T] extends [infer U] ? U : never` to defeat inference at specific positions. Check `tsconfig.json` for the minimum TypeScript version and either bump it or use the workaround in loader/title/meta pipe definitions.

**4. Pattern inference depth limit.**
`ExtractParams` is a recursive conditional type. TypeScript limits recursion depth. Patterns with more than ~8 segments may return `{}`. At that point, `Route.paramsSchema` is required to get typed params. Document the limit and provide a clear error message when it hits (return a branded `PatternTooDeep` type from `ExtractParams` that produces a useful type error when used).

**5. `LE` vs `never` in loader error.**
The `LE` type parameter defaults to `never`. A route with no loader has `LE = never`. A route with a loader that has no typed errors also has `LE = never`. These look the same in the type but mean different things. To distinguish "no loader" from "loader with no typed errors," consider a `void` vs `never` convention: `LD = void` means no loader; `LD = something` with `LE = never` means loader with no typed errors. This is already the convention for `LD` — extend it to `LE`.

**6. `Route.children` position in chain.**
If `Route.children` is typed to only accept `LayoutRoute`, it must come *after* `Route.layout()` in the chain. But what about `Route.guard` — should it be possible to guard a layout? Yes. What about `Route.loader` on a layout? Layouts can have loaders (shared data for all child routes). The constraint is only that `Route.layout()` must appear before `Route.children()`. All other pipes can come before or after `Route.layout()` in any order. TypeScript will only enforce the `LayoutRoute` constraint at the `Route.children` callsite.

**7. RouterRuntime and `AppRouteNodeDef` removal.**
The current RouterRuntime stores routes as `AppRouteNodeDef` with separate `component`, `meta`, and `state` fields. Migrating to `Route<C, ...>` requires updating the internal route registry, the matching algorithm, the loader execution path, and the snapshot structure. This is the largest implementation change. The public RouterRuntime API (navigate, submit, fetch, revalidate, snapshot) doesn't change. The internal representation does.

**8. Single-flight `setLoaderData(route, data)` types.**
`Route.setLoaderData(UserRoute, data)` currently infers `data`'s type from the route node's loader type. With `Route<C, P, Q, H, LD, LE>`, the loader data type is `LD`. `Route.setLoaderData(UserRoute, data)` should type-check `data: LD`. This is straightforward as long as the route passed to `setLoaderData` is typed — which it will be since all routes are now `Route<C, P, Q, H, LD, LE>`.

**9. Colocating routes in the same file as components.**
With the unified model, the natural pattern is:

```ts
// UserPage.tsx
const UserPageComponent = Component.make(...)

export const UserRoute = UserPageComponent.pipe(
  Route.path("/users/:id"),
  Route.loader(loadUser),
)
```

Route accessors inside `UserPageComponent` (`Route.params`, `Route.loaderData`) get their types from wherever `Route.Context` is provided — which is the RouterRuntime when the Route is matched. At definition time in the component, the types are opaque. This is fine for runtime correctness but means TypeScript can't catch mismatches between what the component reads and what the Route provides *unless* you use explicit type annotations on the accessor calls or adopt Option D from the context section.

**10. Migration codemod scope.**
The mechanical transformation is:

```
// Before
MyComponent.pipe(Component.route("/path"))
// After
MyComponent.pipe(Route.path("/path"))

// Before
Route.page("/path").pipe(Route.loader(fn), Route.componentOf(MyComp))
// After
MyComp.pipe(Route.path("/path"), Route.loader(fn))
```

The second transformation requires argument reordering (flipping component-last to component-first). A codemod is feasible but needs to understand the full pipe chain to reorder correctly. The most reliable approach: write a jscodeshift transform that detects `Route.page(...)` / `Route.layout(...)` / `Route.index(...)` chains, extracts the `componentOf` argument, and rewrites as a component-first pipe.

---

## Decision

Adopt `Component.make(...).pipe(Route.path(...), ...)` as the single routing authoring style. `Route.path` is the bridge step from Component to Route. All Route configuration accumulates through the pipe chain. The current node-first constructors and component-first helpers are deprecated aliases.

Priority: implement after `FetchResult` consolidation (ADR-002) and export tier split (ADR-004) since those affect the public surface this builds on.

This ADR is a fairly deep router refactor, not just an API rename. The main work is replacing the current dual model in src/Route.ts and src/Component.ts with a single Component -> Route pipeline, then teaching src/RouterRuntime.ts and the loader/SSR helpers to consume that new route object directly instead of AppRouteNode.
Implementation Plan
- Phase 0 - Lock the target shape first
  - Define the canonical public types in src/Route.ts: Route<C, P, Q, H, LD, LE> and LayoutRoute<C, P, Q, H, LD, LE>.
  - Decide one internal representation up front: a route should be a plain object carrying component, structural route metadata, loader/head/guard/layer config, and pipe.
  - Treat the ADR's "Recommended: Option A with accessor functions" as the implementation choice for Route.Context; do not try to solve circular component/route inference in v1.
  - Keep deprecated exports as thin compatibility wrappers during migration rather than removing them immediately.
- Phase 1 - Introduce the new core route type without breaking callers
  - In src/Route.ts, add the new route interfaces, AnyRoute, AnyLayoutRoute, extraction helpers (ParamsOf, QueryOf, HashOf, LoaderDataOf, LoaderErrorOf), and an isRoute runtime guard.
  - Implement Route.path(pattern) as the only Component-to-Route bridge; it should wrap a component plus initial meta and infer params from the pattern.
  - Rework existing route pipe helpers so their primary overload accepts Route<C, ...> and returns a new route object with updated type params.
  - Keep old node/component helpers (Route.page, Route.define, Component.route, Route.componentOf, etc.) but rewrite them internally in terms of the new route object so the runtime only has one real implementation.
- Phase 2 - Replace route metadata attachment with route-owned metadata
  - Today route config is split between component decorations and AppRouteNode state in src/Route.ts; collapse that into route-owned metadata/config.
  - Move loader fn, loader options, loader error cases, title/meta callbacks, guards, children, layout/index flags, and optional route layer onto the route object rather than mutating the component.
  - Keep component metadata preservation only for compatibility layers where old APIs still return routed components.
  - Update helpers like Route.link, Route.collect, Route.validateLinks, Route.nodes, Route.fullPathOf, Route.paramNamesOf to read from route objects first.
- Phase 3 - Type-level inference work
  - Add ExtractParams<Pattern> in src/Route.ts and wire it into Route.path.
  - Support the practical cases first: static paths, :param, optional :param?, and no-param paths.
  - Defer wildcard typing to the ADR's recommended simpler behavior: runtime supports *, type inference returns {} unless an explicit schema is provided.
  - Update Route.paramsSchema, Route.querySchema, Route.hashSchema so they replace inferred P/Q/H types rather than merge them.
  - Rewrite Route.loader, Route.title, and Route.meta typings to bind callback param types from the input route type; since package.json already targets TypeScript ^5.4.0, use NoInfer directly.
- Phase 4 - Context and accessors
  - Rename RouteContextTag to Route.Context in src/Route.ts, but keep RouteContextTag as a deprecated alias temporarily.
  - Expand RouteContext from P/Q/H to P/Q/H/LD/LE so loaderData and loaderResult are first-class in the service contract.
  - Keep component-side usage centered on Route.params, Route.query, Route.hash, Route.prefix, Route.loaderData, and Route.loaderResult.
  - Update those accessors to derive types from Route.Context, even if component definition-time typing remains partially opaque.
  - Document that Component.require(Route.Context) is the expected requirement shape going forward.
- Phase 5 - Layouts, children, and tree structure
  - Split route kinds structurally: plain route vs layout route, with Route.layout() returning LayoutRoute.
  - Make Route.children(routes) accept only LayoutRoute input at the type level and store children on the route object.
  - Represent index routes as route objects with an index flag rather than a separate constructor-only concept.
  - Update path resolution helpers so child Route.path("users") resolves relative to parent layouts, while absolute /users still works.
  - Reimplement Route.validateTree around the new tree shape: duplicate sibling patterns, duplicate ids, duplicate param names in a chain, orphan/misplaced children.
- Phase 6 - Runtime migration in src/RouterRuntime.ts
  - Change RouterRuntimeConfig.app and navigateApp to accept unified routes instead of AppRouteNode.
  - Replace collectAppNodes/matchedAppNodes logic so it walks unified route trees and matches against resolved full paths, not node-local path.
  - Remove the need for Route.componentOf(node) during runtime refresh; runtime should execute loaders and read route config directly from the route object.
  - Update snapshot generation so appMatches uses route ids/full paths from unified routes.
  - Preserve public runtime methods and snapshot shape so external consumers do not need a second migration at the same time.
- Phase 7 - Loader pipeline and dependency/layer resolution
  - Refactor runRouteLoader, runMatchedLoaders, runStreamingNavigation, single-flight helpers, and sitemap enumeration in src/Route.ts to operate on unified routes.
  - Ensure loader execution gets:
    - decoded params/query/hash from route schemas
    - LD/LE typed result flow
    - optional parent loader data for nested routes
    - route-level withLayer support plus ambient runtime layer support
  - Extend route metadata to carry the loader requirement type R internally, even if it is mostly enforced at RouterRuntime.create(...).
  - Update Route.setLoaderData, Route.setLoaderResult, and Route.seedLoader to infer from Route<C, ..., LD, LE> instead of decorated components.
- Phase 8 - SSR, prefetch, and head
  - Update renderRequest, renderRequestWithRuntime, prefetch, and head resolution paths in src/Route.ts to traverse unified routes.
  - Make sure title/meta callbacks are invoked from route-owned metadata and receive typed { params, loaderData, loaderResult }-equivalent inputs.
  - Preserve current merge semantics for route head resolution.
  - Verify deferred/critical loader streaming still works when routes are tree-based instead of registry/node-based.
- Phase 9 - Lazy loading
  - Add Component.lazy(fn) in src/Component.ts; it should return something satisfying Component/AnyComponent enough for Route.path.
  - Deprecate Route.lazy by reimplementing it as compatibility sugar or aliasing behavior where possible.
  - Ensure route matching, loader prefetch, and link generation work before the lazy component resolves.
- Phase 10 - Compatibility layer and migration path
  - Keep these as deprecated adapters for one release cycle:
    - Component.route
    - Component.guard
    - Route.page
    - constructor-style Route.layout
    - constructor-style Route.index
    - Route.define
    - Route.ref
    - Route.mount
    - Route.componentOf
    - Route.titleFor
    - Route.metaFor
    - Route.loaderErrorFor
    - Route.RouteNode*Of aliases
  - Implement each old helper by translating into unified route creation so there is only one runtime codepath.
  - Add deprecation notes in JSDoc and docs, but do not remove them until tests and examples are migrated.
Recommended File-by-File Breakdown
- src/Route.ts
  - Add new core route/layout types and helpers.
  - Move all route config to route-owned metadata.
  - Rewrite link, tree introspection, validation, loader execution, SSR helpers, and single-flight helpers around unified routes.
  - Add deprecated wrappers for old APIs.
- src/Component.ts
  - Keep pipe as-is; it already supports generic return types.
  - Add Component.lazy.
  - Deprecate Component.route and Component.guard, forwarding to route adapters.
- src/RouterRuntime.ts
  - Replace AppRouteNode usage with unified routes.
  - Update tree walking, matching, navigation by route ref, loader refresh, snapshot reporting.
- src/router-runtime.ts
  - Mostly unchanged cache machinery, but verify route ids/params keys still line up with unified route execution.
- src/type-tests/*
  - Rewrite existing route-node/component-route tests around Route.path.
  - Add new inference tests for params extraction, schema replacement, loader callback inference, layout children ordering, typed link generation, loader error typing.
- src/__tests__/*
  - Port route/runtime tests to the new authoring style.
  - Keep a smaller deprecated-API suite to ensure wrappers still behave during migration.
Suggested Execution Order
- 1. Add new types and Route.path
- 2. Port pipe helpers to unified routes
- 3. Port link/introspection/validation helpers
- 4. Port loader execution and SSR helpers
- 5. Port RouterRuntime
- 6. Add Component.lazy
- 7. Add compatibility wrappers
- 8. Migrate type tests
- 9. Migrate runtime tests
- 10. Update docs/examples and add migration guide
Key Design Decisions To Make Explicit Before Coding
- Route.layout() should be the pipe step; constructor-style Route.layout(component) becomes deprecated compatibility only.
- Route.index() should exist in two forms during migration: new pipe step, old constructor wrapper.
- Route.Context should use the ADR's low-friction model; do not block implementation on perfect component-local inference.
- Wildcards should work at runtime immediately, but typed wildcard capture can wait.
- RouterRuntime.create should become the main place where unresolved loader/guard service requirements are checked.
Biggest Risks
- src/RouterRuntime.ts is the largest migration hotspot because it currently assumes AppRouteNode everywhere.
- src/Route.ts currently mixes three concepts: routed component metadata, route nodes, and route registries; those need to collapse cleanly or the refactor will leave duplicate pathways.
- Backward compatibility can easily reintroduce dual implementations; wrappers must delegate into the new unified model, not preserve old internals.
- Type inference for Route.loader/Route.title/Route.meta is easy to regress; type tests need to be written before or alongside implementation.
Test Plan
- Type tests
  - Route.path("/users/:id") infers { id: string }
  - optional params inference
  - paramsSchema replaces raw string param types
  - loader callback sees updated P/Q
  - title/meta callbacks see LD
  - LoaderErrorOf<typeof route> tracks typed loader errors
  - Route.children fails unless preceded by Route.layout()
  - Route.link(route) infers params/query from unified route
- Runtime tests
  - matching, param extraction, and link generation
  - nested/layout/index path resolution
  - loader execution and caching
  - parent-dependent loaders
  - route guards and redirects/not-found behavior
  - SSR render and streaming payloads
  - runtime snapshot/appMatches/navigation by route ref
  - deprecated APIs still produce equivalent behavior
- Regression checks
  - npm run typecheck
  - npm test
  - npm run build
Definition of Done
- All public routing examples can be written as Component.make(...).pipe(Route.path(...), ...)
- RouterRuntime.create works with unified routes only internally
- Deprecated APIs are wrappers, not separate implementations
- Route.titleFor, Route.metaFor, and Route.loaderErrorFor are no longer needed for new code
- Type tests cover the inference claims in the ADR
- docs/examples/migration notes are updated