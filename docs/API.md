# API Reference

`effect-atom-jsx` is a reactive UI library built on two complementary foundations: a signal-based reactive graph (Solid.js-compatible) and Effect's typed async/error model. The central thesis is that reactive state and typed effects are better together — atoms give you fine-grained reactivity with zero boilerplate, and Effect gives you a principled, composable way to handle everything async.

**Mental model:** atoms are the reactive layer; Effect is the async layer. When they meet — in async atoms, actions, and components — Effect's types flow through unmodified.

---

## Terminology Quick Map

- **`Atom`** — The reactive state unit. Callable for reads (`atom()`), writable variants expose `set`/`update`/`modify`. Atoms track their own dependencies; derived atoms recompute lazily when upstreams change.
- **`Derived atom`** — Read-only atom computed from other atoms. Created with `Atom.make((get) => ...)` or `Atom.derived(...)`. Results are cached until dependencies change.
- **`QueryRef`** — Async read handle from `defineQuery`. Bundles `result`, `pending`, `latest`, `effect`, and invalidation APIs into one ergonomic object.
- **`Mutation handle`** — Async write handle from `defineMutation`. Exposes `run`, `effect`, `result`, `pending`.
- **`Action handle`** — Runtime-bound mutation handle from `Atom.action` / `Atom.runtime(...).action`. The preferred way to express mutations when you have Effect-native code.
- **`Result`** — The five-state async type (`Loading`, `Refreshing`, `Success`, `Failure`, `Defect`). Distinguishing *initial load* from *revalidation* and *typed failures* from *defects* makes UI states explicit rather than derived.
- **`Effect`** (from the `effect` package) — A typed program `Effect<A, E, R>`. The `.effect(...)` methods on query/mutation handles convert reactive state into composable Effect values.
- **`BridgeError`** — Tagged errors emitted when you compose a reactive atom into an Effect pipeline and the atom is still `Loading` (`ResultLoadingError`) or has a `Defect` (`ResultDefectError`). Makes the gap between reactive state and Effect's error channel explicit.
- **`MutationSupersededError`** — Emitted when a newer mutation run interrupts an earlier one. Lets Effect pipelines react to cancellation rather than silently dropping results.
- **`AtomRef`** — Object/collection-centric reactive refs with property-level access. Use when you want per-property subscriptions on a shared object without splitting it into many atoms.
- **`OptimisticRef`** — Temporary overlay state from `createOptimistic`. Lets UI read an optimistic value while the real mutation is in flight.
- **`Store`** — There is no separate top-level store. Use `AtomRef` for object/draft-style state or `Atom.projection(...)` for computed mutable views.

---

## Type Architecture (A / E / R)

Effect programs carry three type parameters:

- **`A`** — success value
- **`E`** — typed error channel (only expected errors belong here)
- **`R`** — required services/context (dependency injection at the type level)

This library preserves all three axes as async state flows from Effect programs into atoms and back. Nothing is silently discarded.

```ts
// Effect<User[], HttpError, Api> — three type params preserved
const usersEffect = Effect.gen(function* () {
  const api = yield* Api;
  return yield* api.listUsers();
});

const rt = Atom.runtime(ApiLive);
const users = rt.atom(usersEffect);

// users() → Result<User[], HttpError>  — A and E preserved in Result
// users.effect() → Effect<User[], HttpError | BridgeError>  — composable in Effect pipelines
```

**Why `Atom.runtime(layer)`?** Requirements (`R`) must be satisfied before an atom can read. The runtime takes a `Layer` once, satisfies all `R`s at creation time, and all atoms/actions created from it share that bound context. This keeps atom definitions portable — you define the effect with `R`, and bind the layer at the callsite.

```ts
const rt = Atom.runtime(ApiLive);
rt.atom(effect)    // RReq extends R — type-checked at creation
rt.action(fn)      // same requirement safety
```

**Writable vs read-only:**

- Writable: `Atom.make(value)`, `Atom.value(value)`
- Read-only derived: `Atom.make((get) => ...)`, `Atom.derived((get) => ...)`

**Convenience type aliases:**

- `Atom.ReadonlyAtom<A>` (alias of `Atom.Atom<A>`)
- `Atom.WritableAtom<A, W = A>` (alias of `Atom.Writable<A, W>`)
- `Atom.AsyncAtom<A, E>` (alias of `Atom.Atom<Result<A, E>>`)

<br />

## Layers & Services

This library is built on Effect's dependency injection system. Services are typed capabilities; layers are how you build and provide them. Understanding how they fit together is the key to wiring up a real application.

### Core Concept

A **service** is a typed interface declared as a `Context.Tag` or `ServiceMap.Service`. An **Effect** that requires a service declares it in its `R` type parameter. A **layer** (`Layer<ROut, E, RIn>`) is a recipe that constructs services — it can itself require other services (`RIn`) and it produces one or more services (`ROut`).

```
Layer<ApiService, never, HttpClient>
     ──────────  ─────  ──────────
     provides    error  requires
```

`mount(fn, container, layer)` and `Atom.runtime(layer)` are the two places where you hand a composed layer to the framework and satisfy all requirements at once. Everything below that callsite can `yield* MyService` freely.

---

### First-Party Services

These are the services the library owns and provides built-in layers for.

#### `ReactivityService` (`Reactivity.Tag`)

Key-based invalidation and subscription. Used internally by single-flight to decide which loaders to revalidate after a mutation, and exposed via `Atom.withReactivity(...)` for application-level cache invalidation across module boundaries.

**What it provides:** `invalidate(keys)`, `subscribe(keys, onInvalidate)`, `flush()`, `lastInvalidated()` (test only)

**Available layers:**

| Layer | Description |
|-------|-------------|
| `Reactivity.live` | Auto-flushing via microtask scheduler. Use in production. |
| `Reactivity.test` | Manual flush with `lastInvalidated` capture. Use in tests. |

```ts
// Production
mount(App, document.body, Layer.merge(ApiLive, Reactivity.live));

// Test — flush and inspect what was invalidated
mount(App, document.body, Layer.merge(ApiLive, Reactivity.test));
```

When `ReactivityService` is present in the layer passed to `mount()`, it is automatically installed as the global reactivity backend. Single-flight and `Atom.withReactivity` will use it without any further wiring.

---

#### `RouterService` (`Route.Router.*`)

URL state and navigation. Provides a reactive `url` atom and imperative navigation methods. The router layer is environment-specific — you pick the right one for your deployment context.

**What it provides:** `url` atom (`ReadonlyAtom<URL>`), `navigate(to)`, `back()`, `forward()`, `preload?(to)`

**Available layers:**

| Layer | Description |
|-------|-------------|
| `Route.Router.Browser` | Wraps the browser History API. Listens to `popstate`. Use in client-rendered apps. |
| `Route.Router.Hash` | Hash-based routing (`#/path`). Listens to `hashchange`. Use when you can't control server routing. |
| `Route.Router.Server(request)` | Static URL from an incoming request. Use during SSR. |
| `Route.Router.Memory(initial?)` | In-memory history stack. Use in tests and Node environments. |

```ts
// Browser app
const AppLayer = Layer.mergeAll(ApiLive, Reactivity.live, Route.Router.Browser);

// SSR handler
const ssrLayer = (req: Request) =>
  Layer.mergeAll(ApiLive, Reactivity.live, Route.Router.Server(req));

// Tests
const testLayer = Layer.mergeAll(ApiLive, Reactivity.test, Route.Router.Memory("/users/1"));
```

---

#### `RouteContextService` (`Route.RouteContextTag`)

Per-route context: params, query string, hash, matched flag, and loader data atoms. This service is provided automatically by the router internals when a component mounts inside a matched route. You don't construct it directly — you read from it via `Route.params`, `Route.query`, `Route.hash`, `Route.loaderData`, and `Route.loaderResult`.

**What it provides:** `params`, `query`, `hash`, `prefix`, `matched`, `loaderData`, `loaderResult` — all as readonly atoms.

---

#### `SingleFlightTransportService` (`Route.SingleFlightTransportTag`)

Transport contract for mutation single-flight. When present, `Atom.action(...)` handles with `singleFlight` options will route mutation requests through this transport instead of executing the local Effect. This enables server-side mutation execution with client-side cache seeding.

**What it provides:** `execute(request, options)` — sends a mutation request envelope and receives a payload response.

**Available layers:**

| Layer | Description |
|-------|-------------|
| `Route.FetchSingleFlightTransport(options?)` | Default HTTP fetch-based transport. Sends requests to the configured endpoint. |

```ts
const AppLayer = Layer.mergeAll(
  ApiLive,
  Reactivity.live,
  Route.Router.Browser,
  Route.FetchSingleFlightTransport({ endpoint: "/_sf" }),
);
```

When `SingleFlightTransportService` is present in the layer passed to `mount()`, it is automatically wired into action handles that declare `singleFlight` options — no manual plumbing needed.

---

#### `RouterRuntime` services (`RouterRuntime.HistoryTag`, `NavigationTag`, `RouterRuntimeTag`)

These three services form a cohesive group and are always provided together via `RouterRuntime.toLayer(runtime, history)`. They exist as separate tags so individual pieces of the router can declare narrower requirements.

| Tag | Provides |
|-----|----------|
| `RouterRuntime.HistoryTag` | `location()`, `push(to)`, `replace(to)`, `go(delta)` |
| `RouterRuntime.NavigationTag` | `navigate(...)`, `submit(...)`, `fetch(...)`, `revalidate(...)`, `cancel(...)` |
| `RouterRuntime.RouterRuntimeTag` | Full runtime instance: `snapshot()`, `subscribe()`, `initialize()`, and all navigation/dispatch methods |

```ts
const runtime = RouterRuntime.create(routes);
const layer = RouterRuntime.toLayer(runtime, historyAdapter);
// layer provides all three tags
```

---

#### `ThemeService` (`Theme.Theme`)

Design tokens and theme mode. Optional — only required if you use `Style.tokenColor`, `Style.tokenSpacing`, or `Style.tokenFontSize`. Without it, token lookups fall back to CSS custom property names.

**What it provides:** `tokens`, `mode` atom (`"light" | "dark"`), `resolve(token)`.

**Available layers:**

| Layer | Description |
|-------|-------------|
| `Theme.ThemeLight` | Default light-mode tokens. |

```ts
const AppLayer = Layer.mergeAll(ApiLive, Reactivity.live, Theme.ThemeLight);
```

---

#### Server-side services (`Route.ServerRequestTag`, `Route.ServerResponseTag`)

Provided automatically by `Route.renderRequest(...)` and `ServerRoute.dispatch(...)` during SSR execution. You read from them inside server-side component setup and server route handlers via the convenience helpers:

```ts
// Inside server component setup or server route handler:
const url = yield* Route.serverUrl;           // from ServerRequestTag
const req = yield* Route.serverRequest;       // from ServerRequestTag
yield* Route.setStatus(404);                  // writes to ServerResponseTag
yield* Route.setHeader("Cache-Control", "no-store");
yield* Route.serverRedirect("/login");
```

These tags are never part of your app's `mount()` layer — they are scoped to a single request/response cycle.

---

### How `mount()` Wires Services

`mount(fn, container, layer)` does several things beyond just providing services to `useService()`:

1. Creates a `ManagedRuntime` from the layer — this is what `useService(tag)` reads from.
2. If `ReactivityService` is in the layer, installs it as the global reactivity backend.
3. If `SingleFlightTransportService` is in the layer, installs it for action handle dispatch.
4. Wraps the tree in a reactive ownership scope — when `mount` is disposed, all child effects and subscriptions clean up.
5. Returns a dispose function.

```ts
const dispose = mount(
  () => <App />,
  document.getElementById("root")!,
  Layer.mergeAll(ApiLive, Reactivity.live, Route.Router.Browser),
);

// Later:
dispose(); // shuts down runtime, cleans up event listeners, cancels fibers
```

`createMount(layer)` pre-binds the layer so you can call `mount(fn, container)` without repeating the layer:

```ts
const mount = createMount(AppLayer);
mount(() => <App />, document.getElementById("root")!);
```

---

### How `Atom.runtime()` Wires Services

`Atom.runtime(layer)` is the atom-side equivalent. Use it when async atoms or actions need services but the atoms are defined outside a component (e.g., at module level).

```ts
// Module-level: declare requirements, bind layer once
const rt = Atom.runtime(ApiLive);
export const currentUser = rt.atom(
  Effect.service(UserApi).pipe(Effect.flatMap(api => api.me()))
);
export const saveProfile = rt.action((input: ProfileInput) =>
  Effect.service(UserApi).pipe(Effect.flatMap(api => api.save(input)))
);
```

**Global layers** let you inject cross-cutting services (logging, tracing, feature flags) into every runtime without changing each callsite:

```ts
// In your app bootstrap — runs before any runtime is created
Atom.runtime.addGlobalLayer(LoggingLive);
Atom.runtime.addGlobalLayer(TracingLive);

// All subsequent Atom.runtime(layer) calls automatically merge these in
const rt = Atom.runtime(ApiLive);
// rt now has ApiLive + LoggingLive + TracingLive
```

This is the right place for observability infrastructure that spans multiple feature modules.

---

### How `Component.require` Wires Services

`Component.require(...tags)` declares which services the component's setup Effect needs. This propagates into the component's `Requirements<T>` type, which bubbles up to the parent that mounts or wraps the component.

```ts
const UserCard = Component.make(
  Component.props<{ id: string }>(),
  Component.require(UserApi, AnalyticsService),  // ← declares requirements
  ({ id }) => Effect.gen(function* () {
    const api = yield* UserApi;                  // ← resolved at runtime
    const analytics = yield* AnalyticsService;
    const user = yield* Component.query(api.getUser(id));
    yield* analytics.track("user:view", { id });
    return { user };
  }),
  (_, { user }) => <div>{user.result().pipe(...)}</div>,
);
```

`Component.withLayer(layer)` satisfies requirements at the component level — useful for isolating service implementations to a subtree:

```ts
// Provide a mock API to just this component tree
const TestableUserCard = UserCard.pipe(
  Component.withLayer(MockUserApiLive),
);
```

If the parent already provides the required services (via `mount()` or a parent `Component.withLayer`), no additional wiring is needed.

---

### Layer Dependency Graph

```
Standalone (no requirements):
  Reactivity.live / .test
  Theme.ThemeLight
  Route.Router.Browser / .Hash / .Server / .Memory
  Route.FetchSingleFlightTransport

Router runtime group (composed via RouterRuntime.toLayer):
  RouterRuntime.RouterRuntimeTag
  RouterRuntime.HistoryTag          ─┐
  RouterRuntime.NavigationTag        ├─ all from toLayer()
  RouterRuntime.RouterRuntimeTag    ─┘

Request-scoped (provided per-request by render/dispatch, not by mount):
  Route.ServerRequestTag
  Route.ServerResponseTag

Your services (you define requirements):
  ApiLive → may require HttpClient, Config, etc.
  HttpClient.live → standalone (or requires Config)
```

---

### Common Composition Patterns

**Minimal browser app:**
```ts
const AppLayer = Layer.mergeAll(
  ApiLive,
  Reactivity.live,
  Route.Router.Browser,
);
mount(() => <App />, document.getElementById("root")!, AppLayer);
```

**With single-flight mutations:**
```ts
const AppLayer = Layer.mergeAll(
  ApiLive,
  Reactivity.live,
  Route.Router.Browser,
  Route.FetchSingleFlightTransport({ endpoint: "/_sf" }),
);
```

**With theme:**
```ts
const AppLayer = Layer.mergeAll(
  ApiLive,
  Reactivity.live,
  Route.Router.Browser,
  Theme.ThemeLight,
);
```

**Test setup (no browser APIs, manual flush):**
```ts
const TestLayer = Layer.mergeAll(
  MockApiLive,
  Reactivity.test,
  Route.Router.Memory("/"),
);
const harness = new TestHarness(TestLayer);
```

**SSR per-request layer:**
```ts
function handleRequest(req: Request) {
  const layer = Layer.mergeAll(
    ApiLive,
    Reactivity.live,
    Route.Router.Server(req),
  );
  return Route.renderRequestWithRuntime(runtime, req, { layer });
}
```

**Global observability (applied to all atom runtimes):**
```ts
// app/bootstrap.ts — runs once at startup
Atom.runtime.addGlobalLayer(OtelTracingLive);
Atom.runtime.addGlobalLayer(StructuredLogLive);
```

<br />

## Component (`src/Component.ts`)

Effect-native component primitive with typed props, requirements, and errors. Components are Effect programs: their setup phase is an Effect generator that acquires resources, declares local state, runs queries, and wires actions — all in one composable unit.

The key insight is that `Component.make` separates *setup* (an Effect that runs once per mount and returns bindings) from *view* (a reactive function of props and bindings). Setup is where you acquire services, register cleanup, and express async intent. View is purely reactive.

- `Component.make(props, require, setup, view)`
- `Component.headless(props, require, setup)` — setup-only, no view (for logic reuse)
- `Component.from(fn)` — create from a plain function component
- `Component.props<P>()` / `Component.propsSchema(schema)` — declare prop shape
- `Component.require(...tags)` — declare required Effect services
- metadata extractors: `Component.Requirements<T>`, `Component.Errors<T>`, `Component.PropsOf<T>`, `Component.BindingsOf<T>`
- setup/render bridges: `Component.setupEffect(component, props)` and `Component.renderEffect(component, props)`
- **setup helpers** (yield inside setup Effect):
  - `Component.state(initial)` — local writable atom
  - `Component.derived(fn)` — local derived atom
  - `Component.query(effect, options?)` — local async query, auto-managed lifetime
  - `Component.action(fn, options?)` — local action, auto-managed lifetime
  - `Component.ref<T>()` — DOM or imperative ref
  - `Component.fromDequeue(dequeue, handler)` — wire an Effect Queue into component lifetime
  - `Component.schedule(schedule, run)` — run on an Effect Schedule
  - `Component.scheduleEffect(schedule, effect)` — Effect variant
- **transforms** (pipeable on a Component):
  - `Component.withLayer(layer)` — provide additional services to this component subtree
  - `Component.withErrorBoundary(handlers)` — catch typed setup/render errors
  - `Component.withLoading(fallback)` — show fallback while setup Effect is pending
  - `Component.withSpan(name)` — add Effect tracing span
  - `Component.memo(eq)` — memoize by prop equality
  - `Component.tapSetup(tap)` — observe setup bindings for debugging
  - `Component.withPreSetup(effect)` — run an Effect before setup (e.g. prefetch)
  - `Component.withSetupRetry(schedule)` — retry failed setup on a Schedule
  - `Component.withSetupTimeout(duration)` — fail setup if it takes too long
- `Component.mount(component, { props, layer, target })` — mount to DOM

```ts
const Counter = Component.make(
  Component.props<{ readonly start: number }>(),
  Component.require<never>(),
  ({ start }) => Effect.gen(function* () {
    // Setup runs once — acquire state, queries, actions here
    const count = yield* Component.state(start);
    const doubled = yield* Component.derived(() => count() * 2);
    return { count, doubled };
  }),
  // View is a reactive function — runs whenever its atom reads change
  (_props, { doubled }) => doubled(),
);
```

<br />

## Behavior / Element (`src/Behavior.ts`, `src/Element.ts`)

Composable behavior building blocks for headless UI logic. A `Behavior` is an Effect program that wires event handling, accessibility, and keyboard interaction onto abstract "slots" (Element handles) without knowing anything about rendering. This lets the same behavior — say, `Behaviors.disclosure` — work whether you render a `<button>` or a custom element.

The `Element.*` constructors define what capability a slot needs (is it interactive? focusable? a text input?). Behaviors are then attached by matching slots to those capabilities.

- `Behavior.make(run)` — define a behavior as an Effect program
- `Behavior.compose(a, b, ...)` — merge multiple behaviors into one
- `Behavior.decorator(behavior)` — behavior that wraps another
- `Behavior.attach(behavior, { select, merge? })` — attach behavior to elements by slot name
- `Behavior.attachBySlots(behavior, elementMap, merge?)` — explicit slot → element wiring

**Element capability constructors:**
- `Element.interactive()` / `Element.container()` / `Element.focusable()` / `Element.textInput()` / `Element.draggable()`
- `Element.collection(items)` — `forEach` and `observeEach` for dynamic collection lifecycle

**`Component` slot integration:**
- `Component.withBehavior(behavior, selectElements, merge?)`
- `Component.slotInteractive()` / `Component.slotContainer()` / `Component.slotFocusable()` / `Component.slotTextInput()` / `Component.slotDraggable()` / `Component.slotCollection(items?)`

**Built-in behaviors:**
- `Behaviors.disclosure` — open/close toggle with accessibility
- `Behaviors.selection(options?)` — single/multi select with keyboard navigation
- `Behaviors.searchFilter(options)` — live search/filter over a collection
- `Behaviors.keyboardNav(options?)` — arrow key navigation
- `Behaviors.pagination(options?)` — page-based navigation over a collection
- `Behaviors.focusTrap()` — constrain tab focus within a region
- `Behaviors.combobox(options)` — combined input + dropdown behavior

**Headless factory helpers:**
- `Composables.createCombobox(options)` — composable combobox without a Component

<br />

## Style / Theme (`src/Style.ts`, `src/Theme.ts`)

Typed style composition that treats CSS as data. Styles are assembled as structured slot objects, not string templates, so they can be composed, overridden, and attached to component slots safely.

**Style composition primitives:**
- `Style.slot`, `Style.compose`, `Style.when`, `Style.states`, `Style.responsive`
- animated: `Style.animation`, `Style.keyframes`, `Style.transition`
- advanced: `Style.nest`, `Style.vars`, `Style.pseudo`, `Style.extends(slot)`
- selectors: `Style.child`, `Style.descendant`, `Style.sibling`, `Style.attr`, `Style.not`, `Style.is`
- animation helpers: `Style.animate`, `Style.enter`, `Style.exit`, `Style.enterStagger`, `Style.layoutAnimation`
- at-rules: `Style.media`, `Style.supports`, `Style.container`, `Style.containerQuery`, `Style.containerType`
- grid/layers/global: `Style.grid`, `Style.layers`, `Style.inLayer`, `Style.global`, `Style.globalLayer`

**Style maps and attachment:**
- `Style.make` — create a style map (slot name → style)
- `Style.attach`, `Style.attachBySlots` — attach style maps to element slots
- `Style.attachBySlotsFor<Bindings>()` — type-safe attach that validates slot names against component bindings

**Variants and recipes** — type-safe prop-driven style variation:
- `Style.variants`, `Style.recipe`
- `Style.VariantProps<T>`, `Style.RecipeProps<T>` — infer prop types from a recipe

**Design tokens:**
- `Style.tokenColor`, `Style.tokenSpacing`, `Style.tokenFontSize`
- `Style.override`, `Style.Provider` — runtime token overrides at subtree boundaries

**Theme service:**
- `Theme.Theme` service key — inject into Effect layer for system theme access
- `Theme.ThemeLight` — default layer
- `Theme.lookupToken(tokens, path)` — resolve a token path to a value

**Utility helpers (`src/style-utils.ts`):**
- `StyleUtils.padded`, `StyleUtils.rounded`, `StyleUtils.elevated`, `StyleUtils.bordered`
- `StyleUtils.textStyle`, `StyleUtils.flexRow`, `StyleUtils.flexCol`
- `StyleUtils.interactive`, `StyleUtils.truncated`

**Styled composables (`src/styled-composables.ts`):**
- `StyledComposables.createStyledCombobox` — styled + behaviors wired together

Example: `examples/styled-combobox/App.tsx`

<br />

## Route / Router (`src/Route.ts`)

Routing uses a unified route-first model built around `Component.pipe(Route.path(...), ...)`. The intended authoring flow is:

```ts
const UserRoute = Component.from<{}>(() => null).pipe(
  Route.path("/users/:userId"),
  Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
  Route.loader((params) => Effect.succeed({ id: params.userId })),
  Route.title((params, data) => `${params.userId}:${data?.id ?? "none"}`),
)
```

The key design goal is that route metadata accumulates on a first-class route value, with strong inference flowing through the pipe chain.

Component wrappers like `Component.withLoading(...)`, `Component.withSpan(...)`, and `Component.withLayer(...)` preserve route metadata and extraction behavior, so helpers like `Route.link(...)` and `Route.ParamsOf<T>` survive more safe composition chains.

**Unified route pipe:**
- `Route.path(pattern)` — attach a URL pattern to a component and return a first-class route value
- `Route.paramsSchema`, `Route.querySchema`, `Route.hashSchema` — replace raw URL inference with decoded schema output
- `Route.id`, `Route.layout()`, `Route.index()`, `Route.children(...)` — refine the unified route value
- `Route.loader`, `Route.title`, `Route.meta`, `Route.guard`, `Route.transition` — accumulate route behavior and metadata on the same route value

**Route accessors (inside components):**
- `Route.params` — typed URL params atom
- `Route.query` — typed query string atom
- `Route.hash` — typed hash atom
- `Route.prefix` — matched prefix atom
- `Route.loaderData` — loader result atom (success value)
- `Route.loaderResult` — loader result atom (`Result` union, for explicit state handling)

**Pattern utilities:**
- `Route.matchPattern`, `Route.extractParams`, `Route.resolvePattern`, `Route.matches(pattern)`

**Links:**
- `Route.link(routedComponent)` — create a typed link helper for a routed component
- `Route.Link` — generic link component

**Query sync:**
- `Route.queryAtom(key, schema, { default })` — atom backed by a URL query parameter; writes update the URL, reads come from it

**Loader infrastructure:**
- `Route.loader` — declare loader data and loader effect on a route
- `Route.loaderError`, `Route.prefetch`, `Route.reload`, `Route.action`
- `Route.runMatchedLoaders` — run all matched loaders; accepts either a `URL` or `(root, url)`

**Extraction helpers:**
- `Route.RouteNodeParamsOf<T>`, `Route.RouteNodeQueryOf<T>`, `Route.RouteNodeHashOf<T>`, `Route.RouteNodeLoaderDataOf<T>`, `Route.RouteNodeLoaderErrorOf<T>`
- Aliases: `Route.ParamsOf<T>`, `Route.QueryOf<T>`, `Route.HashOf<T>`, `Route.LoaderDataOf<T>`, `Route.LoaderErrorOf<T>`

**Route tree introspection/validation:**
- `Route.nodes(...)`, `Route.parentOf(...)`, `Route.ancestorsOf(...)`, `Route.depthOf(...)`, `Route.routeChainOf(...)`, `Route.fullPathOf(...)`, `Route.paramNamesOf(...)`
- `Route.validateTree(...)` — validate the route tree; reports conflicting sibling patterns

**Metadata precedence:**
- Title: deepest matched route wins
- Meta: merged root → leaf (deeper keys override parent)
- Callback forms for `Route.title` / `Route.meta` receive `(params, loaderData, loaderResult)`
- Route head callbacks stay reactive after setup and recompute on match/params/loader changes

**Extra route pipes/utilities:**
- `Route.guard`, `Route.title`, `Route.meta`, `Route.transition`, `Route.lazy`
- `Route.Switch`, `Route.collect`, `Route.collectAll`, `Route.validateLinks`

**SSR/SSG loader helpers:**
- `Route.serializeLoaderData`, `Route.deserializeLoaderData`, `Route.streamDeferredLoaderScripts`
- `Route.collectSitemapEntries`, `Route.sitemapParams` — sitemap collection accepts either `baseUrl` alone or `(root, baseUrl)` for explicit trees

**Head/meta utilities:**
- `Route.mergeRouteMetaChain`, `Route.resolveRouteHead`, `Route.applyRouteHeadToDocument`

**Router layers:**
- `Route.Router.Browser`, `Route.Router.Hash`, `Route.Router.Server(request)`, `Route.Router.Memory(initial?)`

**Streaming:**
- `Route.runStreamingNavigation` — orchestrate streamed navigation responses

---

### Single-Flight

Single-flight solves the **double round-trip problem**. A normal mutation flow requires two network requests: one to execute the mutation, and a second to reload the route data that changed. With single-flight, a single request carries both the mutation execution *and* the refreshed loader payloads back to the client. The client seeds its loader cache directly from the response — no second fetch, no loading flash.

```
Without single-flight:
  Client → POST /api/save    → Server executes mutation
  Client ← { ok: true }
  Client → GET /users/123    → Server runs loader
  Client ← { user: {...} }   ← UI updates

With single-flight:
  Client → POST /_sf/save    → Server executes mutation + runs affected loaders
  Client ← { mutation: {...}, loaders: [{ routeId, result }] }
  Client seeds cache, UI updates  ← no second request
```

---

#### Full Lifecycle

**1. Client: action fires, transport intercepts**

When `Atom.action` has a `singleFlight` option, every `run(input)` call checks for a transport:

1. First checks for `SingleFlightTransportService` in the Effect runtime (installed via `mount()` layer).
2. Falls back to a globally-installed transport (set at bootstrap via `Atom.runtime.addGlobalLayer`).
3. Falls back to a direct `fetch` to `singleFlight.endpoint` if no transport service is present.
4. If `singleFlight.mode === "force"` and no transport exists, the Effect fails rather than silently running locally.

```ts
const saveUser = Atom.action(
  (input: { readonly id: string; readonly name: string }) => api.saveUser(input),
  {
    reactivityKeys: { users: ["list"], user: ["by-id", "profile"] },
    singleFlight: {
      endpoint: "/_single-flight/users/save",
      // Optional: compute the target URL from the input (for loader matching on the server)
      url: (input) => `/users/${input.id}`,
    },
  },
);
```

The transport sends a **request envelope**:
```ts
{
  name?: string;    // optional mutation name for server-side routing
  args: unknown[];  // the mutation arguments
  url: string;      // current or computed target URL
}
```

**2. Server: mutation runs, loaders are selected and run**

`Route.singleFlight(fn, options)` is the recommended server API. It handles the full server-side flow:

```ts
// server/routes/users.ts
const saveUserHandler = Route.singleFlight(
  (input: { readonly id: string; readonly name: string }) => api.saveUser(input),
  {
    target: (result) => `/users/${result.id}`,  // URL for loader matching
    setLoaders: Route.seedLoader(UserRoute),     // seed cache directly
  },
);
```

Internally, `Route.singleFlight` is composed from two lower-level pieces — understanding them explains what happens at each step:

**`Route.actionSingleFlight(fn, options)`** — the mutation runner:
1. Begins capturing reactivity invalidations (via `Reactivity.tracked`).
2. Executes the mutation function.
3. Collects any invalidation keys the mutation emitted.
4. Calls `Route.runMatchedLoaders(targetUrl, { reactivityKeys: capturedKeys })` to select and execute loaders.
5. Applies direct loader seeding from `options.setLoaders`.
6. Returns a `SingleFlightPayload`.

**`Route.createSingleFlightHandler(run, options)`** — the request/response adapter:
1. Receives the request envelope from the client.
2. Provides a `Route.Router.Server(url)` layer to the runner so loaders resolve against the right URL.
3. Wraps the result in a `SingleFlightResponse` envelope: `{ ok: true, payload }` or `{ ok: false, error }`.

**3. Server: which loaders run — reactivity key matching**

The most important decision `actionSingleFlight` makes is which matched loaders to actually re-run. It uses reactivity keys as the coordination signal:

- Each loader, when it runs, reads atoms/queries that are registered with reactivity keys. These reads are captured automatically.
- The mutation, when it runs (or via `reactivityKeys` options on `Atom.action`), emits invalidation keys.
- `runMatchedLoaders` filters candidates: a loader only runs if its captured keys *intersect* with the mutation's invalidated keys.

```
Mutation invalidates:  ["user:123", "users:list"]

UserRoute loader depends on:     ["user:123"]       ✓ runs (intersection)
UserListRoute loader depends on: ["users:list"]     ✓ runs (intersection)
StatsRoute loader depends on:    ["stats"]          ✗ skipped (no intersection)
```

**Fallback:** if the mutation emits *no* invalidation keys (nothing was captured), the system falls back to running *all* matched loaders for the target URL. This is the safe default — it's better to over-fetch than to silently serve stale data.

You can override loader selection with the `revalidate` option:
```ts
Route.singleFlight(fn, {
  revalidate: "none",      // skip all loaders (use only setLoaders seeding)
  revalidate: "all",       // always run all matched loaders
  revalidate: "reactivity" // default: reactivity-key-driven (with fallback to all)
})
```

**4. Response payload structure**

```ts
// Success
{
  ok: true,
  payload: {
    mutation: A,         // the mutation result
    url: string,         // the target URL used for loader matching
    loaders: Array<{
      routeId: string,   // route identifier
      result: Result<any, any>,  // Success | Failure | Loading
    }>
  }
}

// Failure
{ ok: false, error: E }
```

**5. Client: cache seeding, no second request**

`Route.hydrateSingleFlightPayload(payload)` runs on the client after the transport receives the response.

If you already have an explicit unified route tree available, prefer `Route.hydrateSingleFlightPayload(payload, root)` so hydration can resolve loaders from the route tree directly.

For each entry in `payload.loaders`:

1. Finds the registered route by `routeId`.
2. Extracts URL params from the target URL (using the route's pattern).
3. Writes the `Result` directly into the loader cache: `setLoaderCacheEntry(routeId, params, result)`.

Components that are already mounted read from this cache synchronously on next render — no loading state, no flash.

`hydrateSingleFlightPayload` is called automatically by `Route.invokeSingleFlight(...)`. You can call it manually if you're managing the transport yourself, or pass `{ hydrate: false }` to `invokeSingleFlight` to skip it.

When you already have an explicit route tree, `Route.actionSingleFlight(...)` and `Route.invokeSingleFlight(...)` can also be given that route tree through their `app` option so loader selection and hydration stay tree-first instead of relying on registry lookup.

---

#### Loader Seeding APIs

When a loader runs on the server, it's the default path — it re-fetches data fresh. But if the mutation result *already contains* the data the loader would return, you can short-circuit by seeding the cache directly and skipping the loader entirely. These are the three seeding APIs, ordered from most to least automatic:

**`Route.seedLoader(route, select?)`** — use when the mutation result *is* (or closely matches) the loader payload. No `setLoaders` boilerplate:

```ts
// mutation result IS the user object
setLoaders: Route.seedLoader(UserRoute)

// mutation result needs a projection
setLoaders: Route.seedLoader(UserRoute, (result) => result.user)
```

**`Route.setLoaderData(route, data)`** — explicitly wrap data in a `Success` result and seed it:

```ts
setLoaders: (result) => [
  Route.setLoaderData(UserRoute, result.user),
  Route.setLoaderData(PermissionsRoute, result.permissions),
]
```

**`Route.setLoaderResult(route, result)`** — provide the full `Result` value. Use when you want to seed a `Failure` or `Loading` state explicitly:

```ts
setLoaders: (result) =>
  result.deleted
    ? [Route.setLoaderResult(UserRoute, Result.failure(new NotFoundError()))]
    : [Route.setLoaderData(UserRoute, result.user)]
```

**`Route.seedLoaderResult(route, fn)`** — project the mutation result to a `Result` (convenience form of `setLoaderResult`):

```ts
setLoaders: Route.seedLoaderResult(UserRoute, (result) =>
  result.ok ? Result.success(result.data) : Result.failure(result.error)
)
```

---

#### Server-Side API Hierarchy

Three server APIs at increasing levels of abstraction:

| API | Combines | Use when |
|-----|----------|----------|
| `Route.singleFlight(fn, opts)` | `actionSingleFlight` + `createSingleFlightHandler` | Always — the recommended path |
| `Route.actionSingleFlight(fn, opts)` | mutation runner + reactivity capture + loader selection | You need the runner separate from the HTTP adapter |
| `Route.createSingleFlightHandler(run, opts)` | HTTP request/response wrapping | You have a custom runner and need to adapt it to the transport protocol |

`Route.mutationSingleFlight` is the variant for `defineMutation`-style mutations (same semantics, different input shape).

---

#### Transport Architecture

The transport is the piece that moves the request envelope from client to server and back. It's deliberately separated from the mutation logic — the same `Route.singleFlight` server handler works regardless of whether the client uses HTTP, an RPC channel, or a direct in-process call.

**`Route.SingleFlightTransportTag`** — the service tag. When present in the `mount()` layer, it's automatically wired into all `Atom.action` handles that have `singleFlight` options.

**`Route.FetchSingleFlightTransport(options?)`** — the built-in HTTP transport layer:

```ts
// Simple: all single-flight requests go to the same endpoint
Route.FetchSingleFlightTransport({ endpoint: "/_sf" })

// Per-action routing via the request name
Route.FetchSingleFlightTransport({
  endpoint: (request) => request.name ? `/_sf/${request.name}` : "/_sf",
})
```

**Custom transport** — implement the service interface to use any transport:

```ts
const MySingleFlightLayer = Layer.succeed(Route.SingleFlightTransportTag, {
  execute: (request, options) =>
    myRpcChannel.call(request.name ?? "mutation", request).pipe(
      Effect.map((response) => ({ ok: true, payload: response })),
      Effect.catchAll((err) => Effect.succeed({ ok: false, error: err })),
    ),
});
```

The transport interface only knows about request/response envelopes. It doesn't know about routes, loaders, or reactivity. That separation makes it easy to test, mock, or swap.

---

#### How It Connects to the RouterRuntime

The router runtime does *not* automatically revalidate loaders after a mutation. Single-flight is the mechanism — the payload from the server *is* the revalidation. After `hydrateSingleFlightPayload` seeds the loader cache, components that depend on those loaders re-render from the cache.

For mutations that *don't* use single-flight, you call `router.revalidate()` explicitly to re-run all matched loaders for the current URL.

```ts
// Single-flight: revalidation is implicit — payload seeds the cache
const saved = await saveUser.run(input);

// Regular mutation: must revalidate manually
await saveUserRegular.run(input);
router.revalidate();
```

---

#### Decision Guide

| Scenario | What to use |
|----------|-------------|
| Mutation result IS the loader data | `seedLoader(Route)` |
| Mutation returns partial data matching loader shape | `seedLoader(Route, select)` |
| Multiple loaders to seed from one result | `setLoaders: (r) => [setLoaderData(A, r.a), setLoaderData(B, r.b)]` |
| Mutation may produce a failure that should be shown as route error | `setLoaderResult(Route, Result.failure(...))` |
| Skip all loaders, seed only | `revalidate: "none"` + `setLoaders` |
| Always revalidate all matched loaders | `revalidate: "all"` |
| Let reactivity decide (default) | omit `revalidate` |
| Transport via HTTP fetch | `Route.FetchSingleFlightTransport(...)` in layer |
| Transport via custom RPC | Custom `Layer.succeed(Route.SingleFlightTransportTag, ...)` |
| Force single-flight (fail if no transport) | `singleFlight: { mode: "force", ... }` |

Full guides: `docs/SINGLE_FLIGHT.md`, `docs/SINGLE_FLIGHT_COMPARISON.md`, `docs/SINGLE_FLIGHT_TRANSPORT.md`

**Async rendering contract:**
- Prefer `Route.loaderResult` (returns `Result` union) with `Async`, `Loading`, `Errored`, `MatchTag` rather than route-specific loading components. This keeps the async control-flow consistent with the rest of the library.

Examples: `examples/router-basic/`, `examples/router-typed-links/`, `examples/router-single-flight/`, `examples/router-single-flight-fetch/`

---

### ServerRoute (`src/ServerRoute.ts`)

Server-side route handlers with typed request decoding, schema-based params/form/body, and structured response encoding.

**Route definition:**
- `ServerRoute.action`, `ServerRoute.document`, `ServerRoute.json`, `ServerRoute.resource`, `ServerRoute.method`
- `ServerRoute.path`, `ServerRoute.params`, `ServerRoute.query`, `ServerRoute.headers`, `ServerRoute.cookies`
- `ServerRoute.form`, `ServerRoute.body`, `ServerRoute.response`
- `ServerRoute.handle(...)` — handler input shape is inferred from accumulated route metadata (params/form/body/query/headers/cookies all flow into the handler type)
- `ServerRoute.define` — finalize a server route definition

**Document rendering:**
- `ServerRoute.documentRenderer`, `ServerRoute.generatedPath`
- `ServerRoute.runDocument(...)` — run a document route within a runtime
- `ServerRoute.document(app)` accepts unified route roots directly

**Graph helpers:**
- `ServerRoute.nodes(...)`, `ServerRoute.validate(...)` — validates overlapping document patterns and invalid decode wiring
- `ServerRoute.matches(...)`, `ServerRoute.find(...)`
- `ServerRoute.byKey(...)`, `ServerRoute.identity(...)` — observability helpers

**Execution:**
- `ServerRoute.execute(route, request)` — Schema-based params/form/body decoding + basic response encoding
- `ServerRoute.executeWithServices(...)`, `ServerRoute.executeFromServices(...)` — service-native variants
- `ServerRoute.dispatch(routes, request, { layer? })` — full route dispatch with loader payload output
- `ServerRoute.dispatchWithRuntime(runtime, request, ...)` — runtime-backed dispatch
- `ServerRoute.toResponse(...)` — convert dispatch results to a generic response shape (`status`, `headers`, `body`/`html`, redirect, notFound)

**Control flow:**
- `ServerRoute.redirect(...)`, `ServerRoute.notFound()`
- `Route.ServerResponseTag` — shape responses from inside handlers

**Structured metadata:**
- `ServerRouteMeta<...>` — carries typed metadata aligned with runtime fields; keeps helper typing consistent

---

### RouterRuntime (`src/RouterRuntime.ts`)

The runtime that ties history, navigation state, loaders, and server dispatch together.

- `RouterRuntime.create(...)`, `RouterRuntime.createMemoryHistory(...)`
- Runtime methods: `initialize()`, `snapshot()`, `subscribe()`, `navigate()`, `navigateApp()`, `submit()`, `fetch()`, `revalidate()`
- Cancellation: `runtime.cancel(...)`, `NavigationTag.cancel(...)`
- Service tags: `RouterRuntime.HistoryTag`, `RouterRuntime.NavigationTag`, `RouterRuntime.RouterRuntimeTag`, `RouterRuntime.toLayer(...)`

**Snapshot fields:**
- Matched loader results during init/navigation/revalidation
- `lastActionOutcome`, `lastFetchOutcome`, `lastDocumentResult`, `lastDispatchResult`
- Unified `phase`-based task objects: `navigation`, `revalidation`, `requestState`, `dispatchState`, fetcher `state`
- `RouterRuntimeOutcome`, `RouterTaskState` — normalized outcome shapes for actions/fetches/documents/dispatches
- `inFlight` — lightweight in-flight task ids for navigation/submit/request/dispatch/revalidate/fetch
- `matchedServerRoute` — server-route observability/debugging

**Execution model:**
- `submit(...)` / `fetch(...)` can execute typed `ServerRoute` handlers directly when passed a server route node
- Repeated navigation/fetch work enters `cancelled` state before the next task begins
- In-flight task registry guards against stale superseded writes
- SSR bridge: `Route.renderRequest(app, { request, layer? })`, `Route.ServerRequestTag`, `Route.ServerResponseTag`
- `Route.renderRequestWithRuntime(runtime, request, ...)` — runtime-backed render
- Server convenience: `Route.serverRequest`, `Route.serverUrl`, `Route.setStatus(...)`, `Route.setHeader(...)`, `Route.appendHeader(...)`, `Route.serverRedirect(...)`, `Route.serverNotFound()`

<br />

## Reactivity (`src/Reactivity.ts`)

Library-owned reactivity service for key-based invalidation and subscription. This sits above the signal graph — it's a semantic layer that lets async operations declare *what data they touch* so invalidation can be driven by intent rather than atom identity.

A query that reads `users:list` can be invalidated by any mutation that also declares `users:list` as a reactivity key — even if they share no atom reference. This makes cache invalidation composable across module boundaries.

- `Reactivity.Tag` — service tag for reactivity provider
- `Reactivity.live` — default provider with microtask batching and auto-flush
- `Reactivity.test` — testing provider with manual flush control and `lastInvalidated` tracking
- **`Reactivity.tracked(effect, options?)`** — execute an Effect while tracking which reactivity keys it reads; accumulates accessed keys internally. `options.initial` — initial set of tracked keys
- **`Reactivity.invalidating(effect, keys)`** — execute an Effect that invalidates specified keys on completion

**Atom helpers:**
- `Atom.invalidateReactivity(keys)` — invalidate reactivity keys
- `Atom.trackReactivity(keys)` — track which keys are accessed during a read
- `Atom.withReactivity(keys)` — register reactivity keys for an atom
- `Atom.reactivityKeys(atom)` — retrieve registered keys for an atom
- `Atom.flushReactivity()` — force-flush reactivity invalidations

<br />

## Atom (`src/Atom.ts`)

The core reactive state primitive. Atoms are plain objects with `read`/`write` methods backed by the signal graph. They are *callable* — `atom()` reads the current value and registers a reactive dependency in whatever computation is running. This makes JSX natural: `<div>{count()}</div>` is just a function call that the reactive runtime intercepts.

**Why callable reads?** Compared to property access (`atom.value`), a call is visually explicit — you can see at a glance where reactive tracking happens. Compared to hooks, there's no ordering constraint; atoms can be read conditionally or in loops.

### Constructors

- **`Atom.make(value)`** — create a writable atom with an initial value
- **`Atom.make((get) => ...)`** — create a derived (read-only) atom; `get(other)` reads and tracks dependencies
- **`Atom.value(value)`** — explicit writable constructor, including function-valued atoms. Use this when you want to *store* a function as data rather than treat it as a derived getter.
- **`Atom.derived((get) => ...)`** — explicit derived constructor (same as `Atom.make(fn)` but unambiguous)
- **`Atom.readable(read, refresh?)`** — low-level read-only atom constructor
- **`Atom.writable(read, write, refresh?)`** — low-level writable atom constructor
- **`Atom.family(fn)`** — memoized atom factory keyed by argument tuple. Same args return the same atom instance. Optional `{ equals }` for custom key equality. Exposes `evict(...args)` and `clear()` for cache cleanup.
- **`Atom.runtime(layer)`** — create an atom runtime bound to an Effect `Layer`:
  - `runtime.atom(effect)` — async atom from an Effect
  - `runtime.atom((get) => effect)` — dependency-aware async atom; `get(...)` / `get.result(...)` read other atoms inside the getter
- **`Atom.runtime.addGlobalLayer(layer)`** — add a global layer applied to all newly-created runtimes
- **`Atom.runtimeEffect(layer)`** — Effect constructor variant of runtime creation
- **`Atom.keepAlive(atom)`** — compatibility helper; identity in this package
- **`atom.pipe(...)`** — pipeable atom transformations (effect-style composition)

**Async policies** (pipeable):
- **`Atom.withOptimistic(atom)`** / **`Atom.withOptimistic()`** — optimistic overlays with `setOptimistic`, `clearOptimistic`, `isOptimisticPending`, `withEffect(...)`
- **`Atom.withRetry(atom, schedule)`** / **`Atom.withRetry(schedule)`** — retry policy for async result atoms
- **`Atom.withPolling(atom, schedule)`** / **`Atom.withPolling(schedule)`** — polling policy
- **`Atom.withStaleTime(atom, duration)`** / **`Atom.withStaleTime(duration)`** — auto-refresh after stale duration

**Actions:**
- **`Atom.action(effect, options?)`** / **`Atom.action(runtime, effect, options?)`** — create a linear action handle from an Effect function. Actions serialize concurrent calls (later calls supersede earlier ones). Options: `name`, `reactivityKeys`, `onSuccess`, `onError`, `onTransition`.
  - Handle shape: callable + `run(input)` + `runEffect(input)` + `effect(input)` + `result()` + `pending()`
  - `runEffect(input)` preserves success output type `A` for Effect composition
  - `reactivityKeys` invalidates the declared keys after a successful run

**Other constructors:**
- **`Atom.effect(fn)`** — standalone async Effect atom (no runtime required; for simple async without services)
- **`Atom.pull(stream, options?)`** — pull-based stream pagination; call `set(void 0)` to pull next chunk
- **`Atom.projection(derive, initial, options?)`** — mutable derived projection; mutate draft or return next value with keyed reconciliation
- **`Atom.projectionAsync(derive, initial, options?)`** — async projection returning `Result<T, E>`; uses `options.runtime` or ambient mount runtime
- **`Atom.searchParam(name, codec?)`** — atom bound to a URL search param (browser only)
- **`Atom.kvs({ key, defaultValue, ... })`** — atom backed by key-value storage (localStorage by default)
- **`Atom.Stream.*`** — advanced stream assembly helpers (see Stream Integration below)

```ts
const count = Atom.make(0);
const doubled = Atom.make((get) => get(count) * 2);

// Store a function as data — use Atom.value, not Atom.make
const callback = Atom.value((n: number) => n + 1);

// Family: same "alice" argument always returns the same atom
const todoById = Atom.family((id: string) => Atom.make({ id, done: false }));

// Runtime: bind Effect layer once, derive many atoms safely
const runtime = Atom.runtime(MyLayer);
const userAtom = runtime.atom(
  Effect.service(UserApi).pipe(Effect.flatMap((api) => api.me()))
);
const increment = runtime.action((n: number) => Effect.sync(() => console.log(n)));

// Projection: mutable computed view with draft mutation
const selectedMap = Atom.projection((draft: Record<string, boolean>) => {
  draft["a"] = true;
}, {});
```

### Derivations

- **`Atom.map(atom, fn)` / `Atom.map(fn)`** — derive a new atom by transforming the value; data-first and data-last forms
- **`Atom.withFallback(atom, fallback)` / `Atom.withFallback(fallback)`** — replace `null`/`undefined` with a fallback

```ts
const label = Atom.map(count, (n) => `Count: ${n}`);
const safe = Atom.withFallback(nameAtom, "anonymous");
```

### Reading and Writing

Writable atoms are callable and expose sync instance methods for component ergonomics:

- `atom()` — read current value reactively
- `atom.set(value)` — sync write
- `atom.update(fn)` — sync update from previous value
- `atom.modify(fn)` — sync read-modify-write, returns a computed value

Effect helpers (all support data-first `Atom.set(atom, value)` and data-last `Atom.set(value)` forms):

- **`Atom.get(atom)`** → `Effect<A>` — read atom value
- **`Atom.result(atom)`** → `Effect<A, E | BridgeError>` — unwrap `Result`/`FetchResult` atoms into typed Effects. Fails with `ResultLoadingError` if still loading, `ResultDefectError` if defected.
- **`Atom.set(atom, value)`** → `Effect<void>` — write atom value
- **`Atom.update(atom, fn)`** → `Effect<void>` — update from previous value
- **`Atom.modify(atom, fn)`** → `Effect<A>` — read-modify-write, returning a computed value
- **`Atom.refresh(atom)`** → `Effect<void>` — force-invalidate atom and its dependents
- Aliases for Effect-first naming: `Atom.getEffect`, `Atom.resultEffect`, `Atom.setEffect`, `Atom.updateEffect`, `Atom.modifyEffect`

```ts
count();                         // 0 — reactive read
count.update((n) => n + 1);      // sync write
const prev = count.modify((n) => [n, n + 1]);  // read-modify-write

// Effect helpers for pipelines
Effect.runSync(Atom.get(count));
```

### Subscriptions & Batching

- **`Atom.subscribe(atom, listener, options?)`** — subscribe to value changes; returns unsubscribe. Calls listener immediately by default (`{ immediate: false }` to skip).
- **`Atom.flush()`** — flush queued reactive invalidations immediately. Notification mode is always microtask.

### Stream Integration

- **`Atom.fromStream(stream, initialValue, runtime?)`** — atom whose value updates from an Effect Stream; starts a fiber on first read
- **`Atom.fromQueue(queue, initialValue)`** — shorthand: `fromStream(Stream.fromQueue(queue), initial)`
- **`Atom.fromSchedule(schedule, initialValue, runtime?)`** — atom from an Effect `Schedule` via `Stream.fromSchedule`
- **`Atom.Stream.textInput(stream, options?)`** — stream recipe for UI text input normalization (`trim`, `minLength`)
- **`Atom.Stream.searchInput(stream, options?)`** — search-box recipe (`trim`/`minLength` + optional `lowercase` + `distinct`)
- **`Atom.Stream.emptyState<T>()`** — empty stream state for out-of-order assembly
- **`Atom.Stream.applyChunk<T>(state, chunk)`** — apply a chunk to stream state, handling out-of-order updates
- **`Atom.Stream.hydrateState<T>(value)`** — stream state initialized with a hydrated server value

```ts
const prices = Atom.fromStream(priceStream, 0);
const events = Atom.fromQueue(eventQueue, null);

// Out-of-order stream assembly (SSR + client patches)
const initialState = Atom.Stream.hydrateState(serverInitialList);
const updatedState = Atom.Stream.applyChunk(initialState, newItem);
```

### Type Guards

- **`Atom.isAtom(u)`** — `true` if `u` is an `Atom<any>`
- **`Atom.isWritable(atom)`** — `true` if the atom is a `Writable<R, W>`

### Types

- `Atom.Atom<A>` — read-only atom
- `Atom.Writable<R, W>` — readable as `R`, writable as `W`
- `Atom.Context` — callable read context with `get`, `refresh`, `set`, `result`, `addFinalizer`
- `Atom.WriteContext<A>` — write context with `get`, `set`, `refreshSelf`, `setSelf`, `result`, `addFinalizer`
- `Atom.AtomRuntime<R, E>` — runtime wrapper with `managed`, `atom(...)`, `action(...)`, `dispose()`
- `Atom.ProjectionOptions<T>` / `Atom.ProjectionAsyncOptions<T, R>` — projection configuration

<br />

## AtomSchema (`src/AtomSchema.ts`)

Schema-validated form fields backed by atoms. The core idea is that a form field has two representations: the *raw input* (what the user typed, possibly invalid) and the *parsed value* (the typed output if validation passes). `ValidatedAtom` holds both as atoms, so you can bind the input to a UI element and read the parsed value only when you need it.

`AtomSchema.struct` lets you compose multiple fields into a typed form model with unified `isValid`, `touch`, and `reset` behavior — without writing per-field boilerplate.

- **`AtomSchema.make(schema, inputAtom, options?)`** — wrap an existing writable atom with validation. `options.initial` is the baseline for `dirty` comparison and `reset()`.
- **`AtomSchema.makeInitial(schema, initial)`** — create a standalone validated atom with an initial value
- **`AtomSchema.validated(schema, options?)`** — pipeable schema wrapper for writable atoms
- **`AtomSchema.parsed(schema, options?)`** — alias of `validated` for parse-oriented naming
- **`AtomSchema.struct(fields)`** — compose many validated fields (including nested structs) into one typed form model. Struct API: `input`, `value`, `error`, `touched`, `dirty`, `isValid`, `touch()`, `reset()`.
- **`AtomSchema.path(root, ...segments)`** — writable atom focused on a nested object path
- **`AtomSchema.validateEffect(fieldOrStruct)`** — validate and read typed form values as an Effect
- **`AtomSchema.HtmlInput`** — built-in form codecs:
  - `number` (`Schema.NumberFromString`)
  - `date` (`Schema.Date`)
  - `optionalString` — schema + `input(value)` for empty-string mapping
  - `optionalNumber` — schema + `input(value)` for empty-string mapping

```ts
const field = AtomSchema.makeInitial(Schema.Int, 25);
field.isValid(); // true
field.input.set(1.5);
field.isValid(); // false — 1.5 is not an Int
field.reset();   // back to 25
```

### ValidatedAtom\<A, I\>

| Property | Type | Description |
|----------|------|-------------|
| `input` | `Writable<I, I>` | Raw input atom (writes mark field as touched) |
| `result` | `Atom<Exit<A, SchemaError>>` | Parse result |
| `error` | `Atom<Option<SchemaError>>` | Validation error or `None` |
| `value` | `Atom<Option<A>>` | Parsed value or `None` |
| `isValid` | `Atom<boolean>` | `true` when input passes validation |
| `touched` | `Atom<boolean>` | `true` after first write |
| `dirty` | `Atom<boolean>` | `true` when input differs from initial |
| `reset()` | `() => void` | Restore initial value, clear touched |

### Types

- `AtomSchema.ValidatedAtom<A, I>`
- `AtomSchema.SchemaError`

<br />

## AtomLogger (`src/AtomLogger.ts`)

Structured debug logging for atom reads and writes using Effect's Logger. Wraps atoms transparently — the rest of your code doesn't know logging is in place.

- **`AtomLogger.traced(atom, label)`** — wrap a read-only atom to log reads via `Effect.logDebug` with `{ atom, op, value }` annotations
- **`AtomLogger.tracedWritable(atom, label)`** — wrap a writable atom to log both reads and writes
- **`AtomLogger.logGet(atom, label?)`** → `Effect<A>` — read atom as an Effect with debug logging
- **`AtomLogger.logSet(atom, value, label?)`** → `Effect<void>` — write atom as an Effect with debug logging
- **`AtomLogger.snapshot(atoms)`** → `Effect<Record<string, unknown>>` — read all labeled atoms and return a snapshot (useful in tests and bug reports)

```ts
const traced = AtomLogger.tracedWritable(count, "count");
const snap = Effect.runSync(AtomLogger.snapshot([["count", count], ["name", name]]));
```

<br />

## Registry (`src/Registry.ts`)

> **Import:** `effect-atom-jsx/Registry`

A centralized read/write/subscribe context for atoms. Useful when you need to manage atom state outside of a reactive computation — in tests, in server environments, or when mounting multiple isolated trees.

**In most cases, use `mount()` for automatic registry management.** The registry API is for advanced scenarios where you need explicit control over atom lifetimes.

- **`Registry.make()`** — create a new registry instance
- **`Registry.useRegistry()`** — get ambient owner-scoped registry (stable per owner, auto-disposed on cleanup). Outside any owner, returns a shared detached registry.

### Registry Instance Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `get(atom)` | `<A>(atom: Atom<A>) => A` | Read current value |
| `set(atom, value)` | `<R,W>(atom: Writable<R,W>, value: W) => void` | Write a value |
| `update(atom, fn)` | `<R>(atom: Writable<R,R>, fn: (v: R) => R) => void` | Update from previous |
| `modify(atom, fn)` | `<R,W,A>(atom: Writable<R,W>, fn: (v: R) => [A, W]) => A` | Read-modify-write |
| `subscribe(atom, fn)` | `<A>(atom: Atom<A>, fn: (v: A) => void) => () => void` | Subscribe to changes |
| `mount(atom)` | `<A>(atom: Atom<A>) => () => void` | Keep atom alive (run effects) |
| `refresh(atom)` | `<A>(atom: Atom<A>) => void` | Force-invalidate |
| `reset()` | `() => void` | Dispose mounted owners and clear registry |
| `dispose()` | `() => void` | Clean up all subscriptions |

### Types

- `Registry.Registry`

<br />

## FetchResult (`src/Result.ts`)

A three-state result type (`Initial`, `Success`, `Failure`) for advanced compatibility and explicit waiting semantics.

> **Note:** Core async APIs now use `Result` from `effect-ts`. `FetchResult` is an advanced compatibility model with conversion helpers. For new code, prefer `Result`.

### Constructors

- **`FetchResult.initial(waiting?)`** — create an initial result; `waiting: true` means a fetch is in progress
- **`FetchResult.success(value, options?)`** — create a success result; options: `{ waiting?, timestamp? }`
- **`FetchResult.failure(error, options?)`** — create a failure result; options: `{ previousSuccess? }`

### Guards

`FetchResult.isInitial`, `isSuccess`, `isFailure`, `isWaiting`, `isNotInitial`, `isResult`

### Transformations

- **`FetchResult.map(result, fn)`** — map over success value
- **`FetchResult.flatMap(result, fn)`** — chain results
- **`FetchResult.match(result, { initial, success, failure })`** — pattern match all states
- **`FetchResult.all(results)`** — combine multiple results (all must succeed)
- **`FetchResult.builder(result)`** — fluent builder with `.onInitial(...)`, `.onFailure(...)`, `.onSuccess(...)`, `.render()`

### Accessors

- **`FetchResult.value(result)`** — extract success value or `undefined`
- **`FetchResult.getOrElse(result, fallback)`** — success value or fallback
- **`FetchResult.getOrThrow(result)`** — success value or throw

### Conversions

- **`FetchResult.fromResult(result)`** — convert core `Result` to `FetchResult`
- **`FetchResult.toResult(result)`** — convert `FetchResult` to core `Result`
- **`FetchResult.fromExit(exit)`** — convert Effect `Exit` to `FetchResult`
- **`FetchResult.fromExitWithPrevious(exit, previous)`** — convert Exit, preserving previous success on failure
- **`FetchResult.waiting(result)`** — set `waiting: true` on an existing result
- **`FetchResult.waitingFrom(result)`** — create a waiting version, preserving success value

### Types

- `FetchResult.Result<A, E>` — `Initial | Success<A> | Failure<E>`

<br />

## AtomRef (`src/AtomRef.ts`)

Per-property reactive access to objects and arrays. Use `AtomRef` when you have a shared object where different parts of the UI need to subscribe to different properties — it avoids splitting the object into many independent atoms while still enabling fine-grained updates.

`AtomRef` is a ref abstraction, not an `Atom` type directly. Use `AtomRef.toAtom(ref)` to bridge into atom combinators (`Atom.map`, etc.).

- **`AtomRef.make(initial)`** — create a ref for an object; returns `AtomRef<A>`
- **`AtomRef.collection(items)`** — create a reactive array; returns `Collection<A>`
- **`AtomRef.toAtom(ref)`** — convert an `AtomRef<A>` to `Writable<A, A>` for atom-graph interop

### AtomRef Instance

| Method | Description |
|--------|-------------|
| `ref()` | Read current value (callable — reactive tracking) |
| `get()` | Read current value (method form) |
| `prop(key)` | Get a reactive ref for a single property |
| `set(value)` | Replace the entire object |
| `update(fn)` | Update via a function |
| `modify(fn)` | Read-modify-write and return a computed value |
| `subscribe(fn)` | Subscribe to changes |
| `value` | Current snapshot (non-reactive) |

### Collection Instance

| Method | Description |
|--------|-------------|
| `push(item)` | Append an item |
| `insertAt(index, item)` | Insert at position |
| `remove(ref)` | Remove by item ref identity |
| `toArray()` | Get current items array |

### Types

- `AtomRef.AtomRef<A>`, `AtomRef.ReadonlyRef<A>`, `AtomRef.Collection<A>`

<br />

## Hydration (`src/Hydration.ts`)

SSR state transfer — serialize atom values on the server and restore them on the client. The pattern prevents a flash of loading state: the server serializes atoms as part of the HTML response, and the client restores them before first render.

- **`Hydration.dehydrate(registry, entries)`** — snapshot atom values to a serializable array. `entries`: `Iterable<[key: string, atom: Atom<any>]>`. Returns `DehydratedAtomValue[]`.
- **`Hydration.hydrate(registry, state, resolvers, options?)`** — restore atom values from a dehydrated snapshot. `resolvers`: `Record<string, Writable<any, any>>` mapping keys to atoms. `options.validate` emits warnings for unknown server keys and missing resolver keys. `options.onUnknownKey` / `options.onMissingKey`: custom validation callbacks.
- **`Hydration.toValues(state)`** — filter dehydrated state to typed value entries
- **`Hydration.hydrateEffect(registry, state, resolvers, options?)`** — Effect constructor variant with optional strict typed failures

```ts
// Server
const state = Hydration.dehydrate(registry, [["count", countAtom]]);
// → embed `state` as JSON in HTML

// Client
Hydration.hydrate(registry, state, { count: countAtom });
// → countAtom is now pre-populated before first render
```

### Types

- `Hydration.DehydratedAtom`, `Hydration.DehydratedAtomValue`, `Hydration.HydrateOptions`, `Hydration.HydrationError`

<br />

## AtomRpc (`src/AtomRpc.ts`)

RPC client factory for flat endpoint maps. Wraps a transport function into a typed client with reactive query, mutation, and action handles.

- **`AtomRpc.Tag()(id, { call, runtime? })`** — create a typed RPC client:
  - `query(tag, payload, options?)` — reactive query; `options.reactivityKeys` supported
  - `mutation(tag, options?)` — Effect mutation; `options.reactivityKeys` invalidates declaratively
  - `action(tag, options?)` — linear action handle with `.run/.runEffect/.effect/.result/.pending`; supports `reactivityKeys`, `onError`
  - `refresh(tag, payload)` — force-refresh a query

### Types

- `AtomRpc.AtomRpcClient<Defs, R>`

<br />

## AtomHttpApi (`src/AtomHttpApi.ts`)

HTTP API client factory for grouped endpoints. Same ergonomics as `AtomRpc` but organized by group/endpoint rather than flat tags.

- **`AtomHttpApi.Tag()(id, { call, runtime? })`** — create a typed HTTP API client:
  - `query(group, endpoint, request, options?)` — reactive query; `options.reactivityKeys` supported
  - `mutation(group, endpoint, options?)` — Effect mutation; `options.reactivityKeys` invalidates declaratively
  - `action(group, endpoint, options?)` — linear action handle with `.run/.runEffect/.effect/.result/.pending`; supports `reactivityKeys`, `onError`
  - `refresh(group, endpoint, request)` — force-refresh a query

### Types

- `AtomHttpApi.AtomHttpApiClient<Defs, R>`

<br />

## Effect Integration (`src/effect-ts.ts`)

For practical usage patterns and edge cases, see [`docs/ACTION_EFFECT_USE_RESOURCE.md`](ACTION_EFFECT_USE_RESOURCE.md).

> `Result` and scoped constructors are also available from `effect-atom-jsx/advanced`.

### Async Data

- **`atomEffect(fn, runtime?)`** — low-level reactive async computation. Tracks signal dependencies, interrupts previous fiber on re-run. Useful when you need direct control over the reactive graph.
- **`defineQuery(fn, options?)`** — ergonomic keyed query bundle. Returns `{ key, result, pending, latest, effect, invalidate, refresh }`. The preferred API when you need caching, invalidation, or observability.
  - `options.onTransition` — emits `{ phase: start|success|failure|defect, name? }` for observability
  - `options.retrySchedule` — retries typed failures with an Effect `Schedule` before settling to `Failure`
  - `options.pollSchedule` — invalidates the query key on a schedule for polling-style refresh
  - `options.observe` — emits metrics events `{ kind, phase, name?, startedAt, finishedAt?, durationMs? }`
- **`scopedQueryEffect(scope, fn, options?)`** — Effect constructor variant for scope-bound query accessors
  > **Import from:** `effect-atom-jsx/advanced`
- **`createQueryKey<A>(name?)`** — create typed invalidation keys for queries
- **`invalidate(key)`** — invalidate one or many query keys
- **`isPending(result)`** — `Accessor<boolean>`; `true` only during `Refreshing` (not initial `Loading`). Useful for showing a subtle "revalidating" spinner without hiding existing data.
- **`latest(result)`** — `Accessor<A | undefined>` with the last successful value. Useful for keeping old data visible during a refresh.
- **`query.effect()`** — convert query state to `Effect<A, E | BridgeError>` for typed composition in generator flows

---

### Choosing the Right Async API

Three async APIs serve different use cases. The right choice depends on whether you need services, invalidation, or just a reactive async value:

| API | Returns | Runtime | Dependencies | Use Case |
|-----|---------|---------|--------------|----------|
| **`Atom.effect(fn)`** | `Atom<Result>` | No | None | Simple async without services |
| **`Atom.query(fn, runtime?)`** | `Atom<Result>` | Optional | Effect services | Service-based query with DI |
| **`atomEffect(fn, runtime?)`** | `Signal<Result>` | Optional | Signal reads | Low-level reactive effects in Computation contexts |
| **`defineQuery(fn, options?)`** | `QueryRef` | Optional | All of the above | Keyed queries with invalidation, observability, polling |

```ts
// No services needed → Atom.effect
const posts = Atom.effect(() => fetch('/posts').then(r => r.json()));
// posts() → Result<PostList, FetchError>

// Needs an injected service → Atom.query or defineQuery
const user = Atom.query(() =>
  Effect.service(UserApi).pipe(
    Effect.flatMap((api) => api.getUser("123"))
  )
);
// user() → Result<User, ApiError>

// Needs invalidation, polling, or observability → defineQuery
const data = defineQuery(() => fetch('/data'), {
  name: "fetchData",
  onTransition: ({ phase }) => console.log("Phase:", phase),
  pollSchedule: Schedule.spaced("30 seconds"),
});
// data.result() → Result
// data.invalidate() → trigger refresh
```

---

### Services

- **`useService(tag)`** — synchronously access a service from the ambient runtime. Throws if called outside a `mount(..., layer)` tree; includes the missing service key when runtime exists but service is not provided.
- **`useServices({ ...tags })`** — resolve multiple services at once with inferred return types
- **`mount(fn, container, layer)`** — bootstrap a `ManagedRuntime` from a `Layer` and render. All `useService` calls inside the tree resolve from this runtime.
- **`createMount(layer)`** — create a mount function pre-bound to a layer
- **`layerContext(layer, fn, runtime?)`** — run a function with a Layer-provided context
  > **Import from:** `effect-atom-jsx/advanced`
- Component and mount lifetimes are scope-backed: disposing a parent root interrupts descendant Effect fibers transitively
- **`scopedRootEffect(scope, fn)`** — Effect constructor variant for creating a reactive root tied to an Effect Scope
  > **Import from:** `effect-atom-jsx/advanced`

### Mutations

- **`createOptimistic(source)`** — create an optimistic overlay with `get`, `set`, `clear`, `isPending`. `source` can be any callable read (`Accessor<T>` or callable atom). The overlay is temporary state: UI reads from it while the real mutation is in-flight; clear it on success or rollback on failure.
- **`defineMutation(fn, options?)`** — create an Effect-powered mutation action with `optimistic`, `rollback`, `onSuccess`, `onFailure`, `refresh` hooks. Returns `{ run, effect, result, pending }`. Supports `invalidates` for query key invalidation.
  - `effect(input)` returns `Effect<void, E | BridgeError | MutationSupersededError>`
  - `options.onTransition` emits `{ phase: start|success|failure|defect }`
  - `options.observe` emits metrics events
- **`scopedMutationEffect(scope, fn, options?)`** — Effect constructor variant for scope-bound mutation handles
  > **Import from:** `effect-atom-jsx/advanced`

---

### Result (Async State)

`Result` has five states because UI needs to distinguish cases that are often collapsed together:

| Variant | Description | Why separate? |
|---------|-------------|---------------|
| `Loading` | Initial load, no value yet | First load needs a full skeleton/spinner, not just a subtle indicator |
| `Refreshing<A, E>` | Revalidating with previous settled value | Can show stale data + subtle indicator instead of hiding content |
| `Success<A>` | Settled with a value | Normal case |
| `Failure<E>` | Settled with a typed error | Expected error you can handle specifically |
| `Defect` | Unexpected defect or interrupt | Programming error or unhandled exception — usually a generic error boundary |

**`Failure` vs `Defect`:** `Failure` carries a typed `E` — you know what went wrong and can handle it specifically (e.g., show a "not found" message). `Defect` is the untyped escape hatch for things that shouldn't happen — bugs, unexpected exceptions, fiber interruptions. Separating them means your error UI can be typed and specific, not a generic catch-all.

**`Refreshing` vs `Loading`:** `Refreshing` carries the previous `A` and `E` values. This lets you show the last known data while a refresh is in progress, rather than replacing content with a spinner. `isPending(result)` is `true` only during `Refreshing`, not `Loading`.

Constructors/helpers: `Result.loading`, `refreshing`, `success`, `failure`, `defect`, `settled`, `fromExit`, `toExit`, `toOption`, `rawCause`

Guards: `Result.isLoading`, `isRefreshing`, `isSuccess`, `isFailure`, `isDefect`

### Control-Flow Components

These components pattern-match `Result` or conditional values and render the appropriate slot. They are the reactive equivalent of `switch` statements over async state.

- **`Async({ result, loading?, refreshing?, success, error?, defect? })`** — render slots based on `Result` state. `refreshing?` is optional; falls back to `success` slot if not provided (showing stale data during refresh).
- **`Loading({ when, fallback?, children })`** — show children while loading
- **`Errored({ result, children })`** — show children on error
- **`TypedBoundary({ result, catch, children })`** — show children only when error matches a type guard or `Schema`
- **`Show({ when, fallback?, children })`** — conditional rendering
- **`For({ each, children })`** — list rendering with keying
- **`Switch` / `Match({ when, children })`** — multi-case conditional
- **`MatchTag({ value, cases, fallback? })`** — type-safe `_tag` pattern matching. Works with any Effect-style tagged union.
- **`Optional({ when, fallback?, children })`** — render when truthy
- **`MatchOption({ value, some, none? })`** — match Effect `Option`
- **`Dynamic({ component, ...props })`** — dynamic component selection at runtime
- **`WithLayer({ layer, runtime?, fallback?, children })`** — provide a Layer boundary to a subtree
- **`Frame({ children })` / `createFrame(initial?)`** — animation frame loop

### Types

- `Result<A, E>`, `Loading`, `Refreshing<A, E>`, `Success<A>`, `Failure<E>`, `Defect`
- `BridgeError` (`ResultLoadingError | ResultDefectError`), `MutationSupersededError`
- `RuntimeLike<R, E>`, `OptimisticRef<T>`, `MutationEffectHandle<A, E>`, `MutationEffectOptions<A, E, R>`

<br />

## Reactive Core (`src/api.ts`)

> **Import from:** `effect-atom-jsx/internals`

Solid.js-compatible reactive primitives. These are the foundation that `Atom` is built on. You rarely need these directly — the `Atom` API is the intended surface. Use these only for advanced scenarios requiring direct signal graph access, or for interop with code written in Solid.js style.

- `createSignal<T>(initial, options?)` → `[Accessor<T>, Setter<T>]`
- `createEffect(fn)` — run side effect when dependencies change
- `createMemo(fn, options?)` → `Accessor<T>` — cached derived value
- `createRoot(fn)` — create a new reactive ownership scope
- `createContext(defaultValue)` / `useContext(ctx)` — dependency injection
- `onCleanup(fn)` — register cleanup when owner disposes
- `onMount(fn)` — run after component mounts
- `untrack(fn)` / `sample(fn)` — read without tracking dependencies
- `batch(fn)` — batch multiple writes into one notification pass
- `flush()` — flush queued updates immediately
- `mergeProps(...sources)` / `splitProps(props, keys)` — props utilities
- `getOwner()` / `runWithOwner(owner, fn)` — ownership utilities

**Why ownership matters:** Every reactive computation runs inside an owner. When an owner disposes, all effects and cleanups registered under it run automatically. This prevents memory leaks and dangling subscriptions. The `Atom` API manages ownership transparently through `mount()` and `Component.make`; the raw `createRoot` is for cases where you need explicit scope control.

### Types

- `Accessor<T>`, `Setter<T>`, `SignalOptions<T>`, `Context<T>`

<br />

## DOM Runtime (`src/dom.ts`)

Functions called by `babel-plugin-jsx-dom-expressions` compiled JSX output. You don't call these directly — the Babel plugin generates calls to them. They are documented here for framework authors and for understanding the compiled output.

- `template(html)` — create reusable DOM template from HTML string
- `insert(parent, accessor, marker?, current?)` — insert reactive children
- `createComponent(Comp, props)` — instantiate a component in a new reactive root
- `spread(node, accessor, isSVG?, skipChildren?)` — reactive prop spreading
- `attr(node, name, value)` / `prop(node, name, value)` — set attributes/properties
- `classList(node, value, prev?)` — reactive class toggling
- `style(node, value, prev?)` — reactive inline styles
- `delegateEvents(events)` — set up global event delegation
- `render(fn, container)` — mount a component tree; returns dispose function
- `renderWithHMR(fn, container, hot?, key?)` — mount with Vite HMR self-accept + previous dispose handling
- `withViteHMR(dispose, hot?, key?)` — attach any disposer to Vite HMR lifecycle

### SSR

- **`isServer`** — `true` when `window`/`document` are unavailable
- **`renderToString(fn)`** — render component tree to HTML string using virtual DOM
- **`hydrateRoot(fn, container)`** — attach reactivity to server-rendered DOM; returns dispose function
- **`isHydrating()`** — `true` during hydration pass
- **`getNextHydrateNode()`** — advance hydration walker (for custom component hydration)
- **`getRequestEvent()` / `setRequestEvent(event)`** — SSR request context

For JSX runtime transforms, use the package entry: `effect-atom-jsx/runtime`.

<br />

## Testing (`effect-atom-jsx/testing`)

Testing utilities for reactive code without requiring DOM or jsdom.

`TestHarness` combines an Effect runtime with a reactive ownership scope into one object. This lets you run atoms, actions, and queries inside tests as if they were mounted inside a real component tree — without any DOM setup.

- **`TestHarness<R>`** — test environment:
  - `runtime` — the underlying Effect `ManagedRuntime<R>`
  - `owner` — the reactive `Owner` scope
  - `cleanup()` — dispose runtime and reactive scope
  - `run<A>(fn: () => A)` — execute function in test context (atoms resolve, effects fire)

```ts
import { TestHarness } from "effect-atom-jsx/testing";

const harness = new TestHarness(MyLayer);
try {
  harness.run(() => {
    const count = Atom.make(0);
    count.set(5);
    expect(count()).toBe(5);
  });
} finally {
  harness.cleanup();
}
```

For full testing patterns, see `docs/TESTING.md`.

<br />

## JSX Runtime (`effect-atom-jsx/runtime`)

Babel JSX plugin integration. This module is imported by `babel-plugin-jsx-dom-expressions` during compilation. You configure it once and never import it directly.

**Configure Babel:**
```json
{
  "plugins": [
    ["babel-plugin-jsx-dom-expressions", {
      "moduleName": "effect-atom-jsx/runtime",
      "generate": "dom"
    }]
  ]
}
```

**For users:** Handled automatically by the Babel plugin.

**For framework authors:** See `babel-plugin-jsx-dom-expressions` documentation for custom runtime implementation requirements.

<br />

## Internal Reactive Primitives (`effect-atom-jsx/internals`)

Low-level Solid.js-compatible reactive primitives. Also re-exported from `effect-atom-jsx/advanced`.

**When to use:** Only in advanced scenarios where you need direct access to the reactive graph — custom integrations, Solid.js interop, or building your own abstractions on top of the signal system.

**For most applications:** Use the `Atom` API instead.

Exports: `createSignal`, `createEffect`, `createMemo`, `createRoot`, `createContext`, `useContext`, `onCleanup`, `onMount`, `untrack`, `sample`, `batch`, `flush`, `mergeProps`, `splitProps`, `getOwner`, `runWithOwner`.

These are 100% compatible with Solid.js signal/effect patterns.
