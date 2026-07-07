# Route + ServerRoute + RouterRuntime Plan

This document proposes the next major routing architecture for `effect-atom-jsx`.

The design goal is to preserve the distinction between **app routes** and **server routes**, while introducing a stronger shared runtime underneath both.

For a concrete future-facing API sketch, see `examples/router-architecture-sketch/README.md`.
For a concrete build-out plan, see `docs/ROUTER_ARCHITECTURE_IMPLEMENTATION_PLAN.md`.

This refined version also makes four things explicit:

- app routes should not need placeholder/null components just to carry identity
- Reactivity, not the router runtime, owns freshness/invalidation truth
- runtime internals should be decomposed, with aggregate snapshots derived for tooling/adapters
- server-side path conventions should be derivable/generated or adapter-owned when possible, not only hand-authored strings

## 1. Core Thesis

App routes and server routes are not the same thing.

They overlap, but they serve different purposes:

- app routes describe UI navigation, route context, nested layouts, loaders, metadata, and client/server rendering of application screens
- server routes describe request dispatch, methods, mutations, document requests, endpoint handling, redirects, and response shaping

The library should model them as different first-class concepts.

However, they should **not** become two unrelated systems.

Instead, both should be built on top of a shared low-level runtime.

That leads to a 3-layer architecture:

- `Route` — app/UI routing
- `ServerRoute` — server/request routing
- `RouterRuntime` — low-level orchestration engine/state machine

Cross-cutting rule:

- `Reactivity` owns dependency tracking and invalidation; `RouterRuntime` consumes those signals for matched-route orchestration

## 2. Why This Is The Right Direction

This design fits the library's preferences:

- component-first application routing
- Effect-native composition via services/layers
- library-owned architecture instead of framework imitation
- portability across browser, SSR, Node, Bun, Deno, Workers, and meta-framework layers
- clear conceptual separation where it matters

It also takes the right lessons from router systems like Remix Router without copying their public API shape.

The key lesson is:

- routing is not just path matching
- it is a runtime that handles matching, loading, cancellation, interruptions, revalidation, errors, and transitions

## 3. Architectural Overview

## 3.1 `Route`

`Route` remains the app routing system.

Responsibilities:

- component-first route definitions
- nested application route matching
- params/query/hash typing
- route loaders
- route actions that are conceptually part of app flow
- route metadata/head
- transitions
- client-side navigation semantics
- app-branch SSR rendering inputs
- route-level request decoding for params/query/hash and app-form submissions where applicable

Identity direction:

- app routes should become first-class route nodes/objects
- components should attach to route nodes, not be the only place route identity can live
- component-first authoring should remain a primary ergonomic path built on that route-node model

Primitive shape:

- constructors establish route identity and structural placement
- pipeable enhancers attach orthogonal behavior such as params schemas, query schemas, loaders, metadata, guards, and policies

What `Route` is about:

- "what app screen am I on?"
- "what nested route branch is active?"
- "what data/head/layout belongs to that branch?"

## 3.2 `ServerRoute`

`ServerRoute` is the server request routing system.

Responsibilities:

- HTTP-style request matching
- method-based routing
- endpoint handling
- document request routing
- action/mutation endpoints
- custom server handlers (JSON, RPC, webhooks, etc.)
- redirects/status/headers/cookies/response shaping
- SSR entrypoints that render `Route` trees
- request decoding/parsing for params, query, headers, cookies, form data, multipart, JSON, and arbitrary Effect Schema codecs

What `ServerRoute` is about:

- "what should this request do?"
- "is this a document request, mutation request, resource request, or endpoint request?"

Primitive shape:

- constructors establish server route identity/kind
- pipeable enhancers attach method/path decoding, request parsing, response policies, and handlers

## 3.3 `RouterRuntime`

`RouterRuntime` is the shared low-level orchestration engine.

Responsibilities:

- route matching core
- navigation state machine
- request execution orchestration
- loader orchestration
- cancellation/interruption/race handling
- revalidation tracking
- hydration payload management
- deferred/streamed data orchestration
- fetcher/non-navigation task orchestration
- history integration and navigation event orchestration
- submission/form navigation orchestration
- scroll restoration state hooks

State direction:

- internal runtime state should be decomposed into focused refs/services/subscriptions
- aggregate state snapshots should be derived for adapters, tooling, and debugging

What `RouterRuntime` is about:

- "what work is currently in flight?"
- "what matched?"
- "what was interrupted/cancelled/revalidated?"
- "what payloads/errors/results are current?"

## 4. Key Design Principle

Keep **route declaration** and **runtime orchestration** separate.

App developers mostly interact with:

- `Route`
- `ServerRoute`

Meta-frameworks and advanced integrations may also interact with:

- `RouterRuntime`

This mirrors a good architecture boundary:

- public route declaration APIs stay ergonomic
- runtime stays powerful and inspectable
- framework authors get a stable low-level engine

## 4.0.1 Primitive design rule

The refined design should follow a clear primitive split:

- **constructors for identity**
- **pipes for behavior**
- **layers/services for runtime capability**

That means:

- use constructors to create first-class app route nodes and server route nodes
- use pipeable enhancers to attach loaders, metadata, guards, decoders, handlers, and policies
- use services/layers to provide host/runtime capabilities such as history, request, response, transport, auth, uploads, and document rendering

This gives the architecture a clean balance between:

- inspectable route structure
- composable behavior
- extensible runtime integration

## 4.1 Additional Design Pillars

The refined design should explicitly optimize for four more things:

- **Reference-based identity**: routes should be first-class exported values, not anonymous strings or names
- **Introspection**: routes and route trees should be inspectable for tooling, SSR, debugging, and meta-framework composition
- **Validation at creation time**: invalid route trees should fail early instead of surfacing as runtime surprises
- **Layered optionality**: core routing, SSR, transports, devtools, and performance features should remain separable
- **Schema-first decoding**: request/URL/body parsing should use Effect Schema/codecs as the primary typed decoding mechanism
- **Decomposed runtime state**: orchestration internals should be composed from focused state/services, not one giant mutable blob
- **Generated conventions where appropriate**: higher-level frameworks/adapters should be able to derive action/document/resource paths instead of hard-coding every one manually
- **Composable primitives**: orthogonal route behavior should be attachable through pipes instead of collapsing everything into giant config objects

These learnings come from exploring other router designs and are worth making first-class requirements here.

## 5. Conceptual Distinctions

## 5.1 App route vs server route

App routes:

- represent navigable UI state
- are nested by layout/view structure
- have params/query/hash semantics
- can have loaders/head/transition metadata

Server routes:

- represent request handlers
- are organized by method/path/handler behavior
- may or may not target app routes
- may return HTML, JSON, redirects, mutations, or arbitrary responses

Important: one can point at the other.

Examples:

- a server document route can render an app route tree
- a server mutation route can trigger single-flight updates for app routes
- a server endpoint route can be unrelated to app routing entirely

## 5.2 Runtime state vs declarative route tree

Declarative route trees define:

- what can match
- what data belongs to matches
- what UI/handlers attach to matches

Runtime state defines:

- what is currently matched
- what is loading
- what is revalidating
- what was cancelled/interrupted
- what loader/action/fetcher results exist

This distinction is crucial and should be explicit in the design.

## 5.5 Request decoding is a first-class concern

Routing is not only about matching paths. It is also about turning request data into typed values.

The refined design should treat these as first-class decode surfaces:

- path params
- query params
- hash state where relevant
- form data
- multipart payloads
- JSON bodies
- headers
- cookies
- arbitrary encoded payloads via Effect Schema codecs

The design should strongly prefer Effect Schema for these decoding/encoding surfaces.

That means routing APIs should be able to say things like:

- decode path params with a schema
- decode query with a schema
- decode submitted form data with a schema
- decode request body with a schema or codec

and produce typed values with Effect-native errors.

## 5.5.1 Reactivity owns freshness

The architecture should be explicit about freshness ownership:

- Reactivity owns dependency capture and invalidation
- loaders capture the Reactivity dependencies they read
- mutations emit Reactivity invalidations
- `RouterRuntime` uses those invalidations together with current matched work to decide what revalidates

The router runtime should not maintain a second independent invalidation graph.

This keeps one consistent freshness model across:

- atoms
- reactive services
- route loaders
- fetchers
- single-flight mutations

## 5.6 History/navigation is a service concern

Navigation and history should not be hard-coded as browser globals.

The architecture should model history/navigation as services/layers so the same routing model can work across:

- browser history
- hash history
- memory history
- server request routing
- tests
- custom host environments

This should eventually unify or refine the current router service story.

## 5.3 Reference-based route identity

App routes and server routes should both be first-class values that can be exported, composed, inspected, and referenced directly.

This enables:

- type-safe navigation and linking
- type-safe server mounting/composition
- safe refactoring
- route-aware tooling and codegen
- meta-framework transforms over route trees

The library should strongly prefer route references over string route names as the primary identity model.

That said, route references should not require a component placeholder just to exist. The preferred end-state is a first-class route node/object model that component-first helpers can target.

## 5.4 Declarative route trees, not ad-hoc lists

The design should treat route trees as real structured values.

That does not require abandoning the current component-first route style, but it does mean the library should move toward first-class route graph/tree representation for both:

- `Route`
- `ServerRoute`

These trees should be:

- composable
- introspectable
- transformable
- validatable

## 6. Proposed Module Responsibilities

## 6.1 `Route`

Should continue to expose:

- `Route.loader(...)`
- `Route.loaderData(...)`
- `Route.loaderResult(...)`
- `Route.loaderError(...)`
- `Route.title(...)`
- `Route.meta(...)`
- `Route.link(...)`
- `Route.prefetch(...)`
- route matching/path utilities
- route collection/introspection helpers

Should strengthen formally:

- route identity/IDs
- parent/child/ancestor relationships
- route chain introspection
- parameter-name introspection
- static path/static prefix introspection where meaningful
- creation-time validation

Should support schema-driven decode surfaces for app-routing concerns:

- params schema
- query schema
- hash schema
- optional form submission schema for route-level navigational submissions

Should eventually gain:

- a first-class route tree definition layer if needed
- stronger SSR render integration via app-route rendering primitives
- optional fetcher integration for non-navigation app-route interactions

The refined direction should explicitly avoid a preferred API that requires `Component.from(() => null)` purely as a route identity anchor.

Should avoid becoming:

- the full request router
- the place where arbitrary HTTP semantics live

## 6.2 `ServerRoute`

Should be introduced as a separate namespace/module.

Possible surface:

- `ServerRoute.get(path, handler)`
- `ServerRoute.post(path, handler)`
- `ServerRoute.any(path, handler)`
- `ServerRoute.mount(path, children)`
- `ServerRoute.document(path, appRouteTree, options)`
- `ServerRoute.action(path, handler)`
- `ServerRoute.json(path, handler)`
- `ServerRoute.redirect(...)`
- `ServerRoute.notFound(...)`
- `ServerRoute.withLayer(...)`
- `ServerRoute.define(...)`

Should also support:

- reference-based composition/mounting
- introspection (parent, children, ancestors, methods, static prefixes)
- creation-time validation
- document/action/endpoint conflict analysis

Should additionally support schema/codecs for:

- path params
- query params
- headers
- cookies
- JSON body
- form data
- multipart/file uploads
- custom codecs for arbitrary request payloads

Server path conventions should be flexible:

- explicit path strings remain supported
- generated/convention-based paths should be possible
- framework/adapters should be able to own URL shape for actions/documents/resources without losing typed route identity

Should allow:

- endpoint routes unrelated to app routes
- document routes that render app routes
- action routes tied into single-flight/runtime orchestration

## 6.3 `RouterRuntime`

Should likely be a lower-level module, possibly not emphasized in basic docs.

Possible responsibilities/API areas:

- create/initialize runtime
- subscribe to runtime state
- inspect state
- trigger navigation/revalidation/fetchers
- match route trees
- orchestrate cancellations and race resolution
- expose route graph inspection hooks useful to adapters/tooling

Should likely also model:

- initialization lifecycle (`initialized`)
- current location/request target
- history action
- current matches
- navigation state
- revalidation state
- loader data/results/errors
- action/submission data/results/errors
- active fetchers/non-navigation tasks
- scroll restoration intent/state
- hydration/deferred state

Possible state model inspiration:

- current location/request
- current app matches
- current server match
- navigation state
- revalidation state
- loader data/results/errors
- action data/results/errors
- fetcher/task states
- hydration/deferred state

Potential `RouterRuntimeState` direction:

```ts
interface RouterRuntimeState {
  readonly initialized: boolean;
  readonly historyAction: "push" | "replace" | "pop" | "none";
  readonly location: URL;
  readonly appMatches: ReadonlyArray<unknown>;
  readonly serverMatch: unknown | null;
  readonly navigation: unknown;
  readonly revalidation: unknown;
  readonly loaderData: ReadonlyMap<string, unknown>;
  readonly actionData: ReadonlyMap<string, unknown> | null;
  readonly errors: ReadonlyMap<string, unknown> | null;
  readonly fetchers: ReadonlyMap<string, unknown>;
  readonly restoreScrollPosition: number | false | null;
  readonly preventScrollReset: boolean;
}
```

The public types can evolve, but this level of explicitness should be a design target.

Important implementation note:

- this should be understood as a derived runtime snapshot model
- it is not a mandate to implement one monolithic state blob internally
- internal runtime state should stay decomposed and composable, with snapshots assembled for inspection, subscriptions, devtools, and adapters

This is heavily inspired by the valuable parts of Remix Router, but adapted to this library's architecture.

## 6.4 Shared introspection + validation layer

Both `Route` and `ServerRoute` should share common ideas around introspection and validation.

Potential capabilities:

- `parent`
- `children`
- `depth`
- `ancestors`
- `routeChain`
- `paramNames`
- `staticPath` or static prefix information
- route IDs

Potential validation areas:

- duplicate parameter names in a route chain
- conflicting sibling route patterns
- invalid nesting shapes
- duplicate route IDs
- unsupported document/action overlaps
- invalid method/path combinations

Potential decode-validation areas:

- schema/path mismatches
- unsupported form/body combinations for a route kind
- invalid codec wiring for a request handler

This is important not just for correctness, but for:

- devtools
- SSR planning
- route analysis
- meta-framework code generation

## 7. SSR / Server Routing Direction

This architecture gives a clear SSR story.

### App-route rendering

`Route` should be renderable on the server through runtime services.

Core target primitive:

```ts
const result = yield* Route.renderRequest(app, {
  request,
  layer,
});
```

Where `result` is a structured app render result, not immediately a `Response`.

### Server-route document handling

Then `ServerRoute.document(...)` can turn that into a request handler.

Example direction:

```ts
const server = ServerRoute.define(
  ServerRoute.document("*", app, {
    document: HtmlDocument,
  }),
);
```

This keeps:

- SSR render logic in `Route`
- request dispatch logic in `ServerRoute`

## 7.1 Structured request/response decode + encode pipeline

Server rendering and request handling should use a structured decode/encode pipeline.

Likely stages:

1. match route
2. decode params/query/body/form/etc. through Effect Schema/codecs
3. execute handler/loader/action
4. accumulate response metadata/status/headers/cookies
5. encode response/document payload

This pipeline should be explicit in the architecture so adapters and metaframeworks can hook into it.

## 8. Control Flow Model

The design should distinguish between:

- control flow signals
- response accumulation

### 8.1 Control flow signals

These should probably be Effect-native signals/failures:

- redirect
- not found
- forbidden/unauthorized
- early document short-circuit

Examples:

- `ServerRoute.redirect(...)`
- `ServerRoute.notFound(...)`

### 8.2 Response accumulation

These should probably be response services:

- status code
- headers
- cookies
- cache control

This matches Effect well:

- control flow uses Effects/signals
- mutable response shaping uses scoped services

## 8.3 Request parsing services

The design should likely introduce or plan for services around request parsing/encoding, such as:

- request body access
- parsed form data access
- parsed cookie access
- parsed header access
- file upload abstractions

These should compose with schemas/codecs instead of bypassing them.

## 9. Revalidation / Fetcher / Task Model

One major lesson from Remix Router is that these concerns deserve first-class treatment.

The new runtime should likely model:

- navigation tasks
- mutation/action tasks
- revalidation tasks
- fetcher/non-navigation tasks

This does **not** mean copying Remix Router's public API.

It means treating router orchestration as a real concurrent runtime.

Potential future concepts:

- `RouterRuntime.fetch(...)`
- `Route.fetcher(...)`
- `ServerRoute.fetcher(...)`

Potential fetcher/task shape requirements:

- key-based identity
- non-navigation loader requests
- non-navigation action/submission requests
- cancellation/interruption awareness
- typed submission payload decoding
- typed result/error channels

The point is to support:

- route-targeted non-navigation requests
- interruptible/restartable work
- revalidation beyond simple navigation

It should also prepare the runtime for future devtools/analysis features that inspect task state and route tree behavior.

## 10. Single-Flight's Place In This Architecture

Single-flight is not the center of the design, but it fits naturally here.

Within this architecture:

- `Route` owns loader data and hydration payload semantics
- `ServerRoute` owns mutation/document request handling
- `RouterRuntime` owns invalidation/revalidation/fetch task orchestration
- transport remains separate and pluggable

More precise responsibility split:

- transport does not decide what should reload
- Reactivity determines freshness dependencies/invalidations
- `RouterRuntime` combines those signals with current matched route/fetcher state
- route/server layers decide how to render/handle matched work
- transport only carries typed request/response payloads across boundaries

This is a cleaner long-term home for single-flight.

## 11. Type Safety Strategy

The design should remain strongly typed and inference-driven.

### App routes

Need typed:

- params/query/hash
- loader data/error
- route links
- route metadata access

### Server routes

Need typed:

- request shape/method/path params
- response data type
- app-route target if rendering an app route
- action input/output where relevant

### Runtime

Need typed enough to be powerful, but not so generic-heavy that the API becomes unreadable.

The library should strongly prefer:

- inference from route declarations
- schema-driven params/body typing
- service-based `R` typing

and avoid:

- requiring users to manually spell out 5-8 generic parameters for normal use

This applies equally to route declaration APIs: the design should prefer inference from schemas, components, handlers, and composition over generic-heavy builder signatures.

### 11.1 Type-safety goals by layer

#### `Route`

`Route` should preserve and improve:

- param inference from route path + schema declarations
- query/hash inference from route declarations
- loader data/error inference from `Route.loader(...)`
- typed link building from route references
- typed metadata/title callbacks derived from route + loader types

Desired property:

- once a route is declared, downstream APIs should derive from that declaration instead of requiring repeated generic annotations

Examples of desired inference direction:

- `Route.link(userRoute)` infers required params
- `Route.loaderData<typeof userRoute>()` or equivalent route-aware helper infers loader data
- `Route.seedLoader(userRoute)` infers the payload shape from the loader type

#### `ServerRoute`

`ServerRoute` should infer from:

- method
- path/schema
- request parsing schema/body schema
- handler return type
- target app route type for document routes or app-linked handlers

Desired property:

- a server route should carry enough type information that adapters, tests, and metaframework tooling can understand its input/output shape without additional manual typing

Examples of desired inference direction:

- `ServerRoute.post("/users/:id", { params, body }, handler)` infers typed params/body inside `handler`
- `ServerRoute.document("*", app)` carries the app render result type and document rendering contract
- `ServerRoute.post("/upload", { form: UploadSchema }, handler)` infers typed decoded form input
- `ServerRoute.post("/api", { body: MyCodec }, handler)` infers decoded request and encoded response contracts where codecs are used

#### `RouterRuntime`

`RouterRuntime` should be typed enough for advanced integrations, but should not force end users to work directly with large generic parameter lists.

Desired property:

- runtime internals may be generic-rich, but public-facing wrappers should collapse that complexity behind route references, schemas, and service tags

### 11.2 Inference rules

The design should follow these inference rules consistently:

- infer from route references before asking for generic arguments
- infer from schemas before asking for generic arguments
- infer from Effect handler return types before asking for generic arguments
- infer from component route metadata before asking for generic arguments
- infer from Effect Schema/codecs before asking for generic arguments

Only require explicit generics when:

- the user is intentionally widening/narrowing beyond what inference can know
- a low-level runtime/tooling API is being used directly

### 11.3 Generic design constraints

The routing APIs should avoid signatures like:

```ts
Route.create<I, O, M, Meta, Context, Child, ...>()
```

for ordinary usage.

Instead, prefer:

- route objects that accumulate type information structurally
- helper overloads that infer from provided route/component/schema arguments
- internal helper types that extract data from route references

The design should treat generic-heavy route creation APIs as an anti-goal unless there is overwhelming payoff.

### 11.3.1 Pipes should preserve inference

The pipeable design only works if type information survives composition.

That means route and server-route enhancers should be designed so they:

- preserve route identity
- add inferred metadata instead of erasing it
- avoid widening everything to `unknown`
- compose in a predictable left-to-right way

Examples of desired behavior:

- `Route.page("/users/:id", UserView).pipe(Route.paramsSchema(UserParams))` infers typed params for later pipes
- `ServerRoute.action({ key: "save-user" }).pipe(ServerRoute.form(SaveUserForm), ServerRoute.handle(...))` infers form input in the handler

This is a key design requirement: composability must not come at the expense of inference.

## 11.4 Route object type shape

App and server routes should both probably carry structured type metadata internally.

App route metadata should likely include concepts like:

- params type
- query type
- hash type
- loader data type
- loader error type
- route ID
- parent/ancestor chain identity

Server route metadata should likely include concepts like:

- method
- path params type
- request body/query/header typing where declared
- request decode schemas/codecs
- response type
- response encode schema/codec where declared
- route kind (`document`, `action`, `json`, `resource`, etc.)
- linked app route tree, if any

This metadata should be accessible through helper extraction types, not exposed as giant required generic parameters.

## 11.5 Validation as a type-safety companion

Type safety alone is not enough.

Some route errors are structural and should be caught by runtime validation at creation time, such as:

- duplicate parameter names in a route chain
- conflicting sibling routes
- duplicate IDs
- illegal document/action overlaps
- malformed route trees

So the design should explicitly combine:

- compile-time type inference
- creation-time structural validation

That combination is stronger than either one alone.

## 12. Extensibility / Meta-Framework Goals

This architecture should explicitly support a future meta-framework layer.

A meta-framework should be able to:

- generate/compose app route trees
- generate/compose server route trees
- call into `RouterRuntime`
- install request/response/document/transport adapters
- add conventions around files/modules/codegen

Therefore the runtime and route definitions should be:

- inspectable
- composable
- declarative enough to transform
- not overly tied to one UI or server runtime

And additionally:

- validatable before runtime
- reference-addressable in generated code
- analyzable by optional tooling/dev layers

## 12.1 Composability through layers and services

The router architecture should lean into Effect's service/layer model instead of inventing a parallel context/composition mechanism.

That means:

- request state should be injectable as a service
- response accumulation should be injectable as a service
- document rendering should be injectable as a service or option layer
- transport should remain a service
- auth/session/locale/config should compose naturally via existing layers

This is especially important for server routing, where route handlers should be able to `yield*` services naturally.

Examples of desired composition:

- `yield* RequestTag`
- `yield* ResponseTag`
- `yield* AuthService`
- `yield* SessionService`
- `yield* DocumentRenderer`
- `yield* HistoryTag`
- `yield* NavigationTag`
- `yield* WebSocketService`
- `yield* FileStorageService`
- `yield* UploadsService`

The design should avoid ad-hoc callback parameter bags when a service/layer model would compose better.

## 12.1.1 Non-HTTP capabilities should still compose cleanly

The architecture should leave room for routes and handlers that need adjacent platform concerns, such as:

- WebSocket/session push coordination
- file upload/storage services
- background jobs
- server-sent events or streaming channels

These should not be hard-coded into routing, but the service/layer model should make them easy to compose into route handlers.

## 12.2 Extensibility surfaces

The architecture should intentionally leave room for:

- custom route analysis tools
- metaframework-generated route trees
- file-system routers compiling into `Route` / `ServerRoute`
- custom SSR document strategies
- custom transport layers
- custom request parsing/body decoding layers
- custom runtime observers/devtools

This means the core route graph and runtime state should be stable, inspectable, and serializable enough for tooling.

## 12.3 Optional feature layering

The routing system should be layered so advanced concerns remain optional.

Likely optional layers/features:

- SSR/document rendering helpers
- deferred streaming helpers
- single-flight transport integration
- route analysis/dev warnings
- performance/prefetch features
- fetcher/task helpers
- history adapters
- schema/body parser helpers
- upload/file helpers

This helps:

- bundle control
- conceptual clarity
- library maintainability
- meta-framework adaptation

## 13. Recommended API Direction

## 13.1 App routes

Keep existing component-first style, possibly refined later with first-class tree helpers.

Refinement goals:

- preserve current component-first ergonomics
- make route tree structure more explicit and inspectable
- keep reference-based route identity central
- avoid shifting to matcher-heavy or generic-heavy public APIs

Possible direction:

```ts
const userPage = Route.page("/users/:userId", UserView).pipe(
  Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
  Route.loader((params) => ...),
  Route.title((params, user) => ...),
  Route.meta(...),
);
```

This gives:

- constructor for identity
- pipes for behavior
- inference preserved across the chain
- room for explicit internal metadata carriers so helper types (`ParamsOf`, `LoaderDataOf`, etc.) stay simple

## 13.2 Server routes

Introduce separate API.

Possible direction:

```ts
const server = ServerRoute.define(
  ServerRoute.document("*", app),
  ServerRoute.post("/_action/save-user", saveUserHandler),
  ServerRoute.get("/health", healthHandler),
);
```

Refinement goals:

- server route declarations should be explicit and composable
- they should feel distinct from app routes, but use shared path/schema/introspection primitives
- mounting/nesting by reference should be supported where it improves clarity

Possible direction:

```ts
const saveUser = ServerRoute.action({ key: "save-user" }).pipe(
  ServerRoute.method("POST"),
  ServerRoute.path(ServerRoute.generatedPath("save-user")),
  ServerRoute.form(SaveUserForm),
  ServerRoute.handle(({ form }) => ...),
);
```

This gives:

- constructor for route kind/identity
- pipes for request decode + handler behavior
- adapter/framework freedom over path conventions

## 13.3 Runtime

Possible direction:

```ts
const runtime = RouterRuntime.create({
  app,
  server,
});
```

Advanced integrations can subscribe/inspect runtime state.

Potential future optional layer:

- `RouterDev` / `RouteAnalysis` utilities built on route introspection + runtime state

## 13.4 Possible concrete type helpers

The plan should likely include explicit extraction helpers for route references.

Examples of the kind of helpers that may be useful:

- `Route.ParamsOf<T>`
- `Route.QueryOf<T>`
- `Route.LoaderDataOf<T>`
- `Route.LoaderErrorOf<T>`
- `ServerRoute.ParamsOf<T>`
- `ServerRoute.BodyOf<T>`
- `ServerRoute.FormOf<T>`
- `ServerRoute.QueryOf<T>`
- `ServerRoute.HeadersOf<T>`
- `ServerRoute.ResponseOf<T>`

These are valuable because they:

- improve test ergonomics
- help metaframework/tooling code
- reduce need for duplicate manual type declarations

## 13.5 Possible service set for server routing

The plan should assume a likely service set, even if names change later.

Candidate services:

- `ServerRequestTag`
- `ServerResponseTag`
- `DocumentRendererTag`
- `RouterRuntimeTag`
- `SingleFlightTransportTag`

Likely navigation/runtime services:

- `HistoryTag`
- `NavigationTag`
- `ScrollRestorationTag`

Potentially also:

- `CookiesTag`
- `HeadersTag`
- `RedirectTag` or redirect signal helper
- `BodyParserTag`
- `UploadsTag`

The exact names can evolve, but the design should plan around service-based composition from the start.

## 13.6 Testing model

Testing should be treated as a first-class design concern.

The architecture should make it easy to test at multiple levels:

### Route unit tests

- route matching
- route validation
- loader typing/inference
- link generation
- introspection

### Server route unit tests

- method/path matching
- request decoding
- response/status/header shaping
- redirect/notFound control flow
- form/body/schema decoding
- upload/file handling where supported

### Runtime tests

- cancellation/interruption
- revalidation behavior
- fetcher/task state
- SSR render result assembly
- history/navigation semantics
- initialization lifecycle
- scroll restoration state behavior

### Integration tests

- app route + server route bridging
- server document rendering
- transport-aware mutation flows
- hydration/bootstrap behavior

### Type tests

- route reference extraction helpers
- app route inference
- server route inference
- route-to-server bridging inference

The plan should strongly prefer APIs that are testable without needing a browser DOM or full HTTP server in every case.

## 13.7 API ergonomics constraints

The design should be judged against these ergonomic constraints:

- common route declarations should fit in readable local code
- most users should not need explicit generic arguments
- most advanced power should be unlocked by composition, not by using different APIs entirely
- services/layers should reduce ceremony rather than increase it
- route references should remain pleasant to pass around
- schema/codecs should be the default typed decode path, not an afterthought

And specifically for primitives/pipes:

- constructors should stay small and identity-focused
- pipes should remain orthogonal and reusable
- composition should be easier than giant config objects for non-trivial routes
- extending the system should feel like adding new pipes or new services, not forking the route model

## 13.8 Possible navigation/history API direction

The plan should likely account for history/navigation as a service-backed runtime capability.

Possible concepts:

- `HistoryTag` for browser/hash/memory/server histories
- `NavigationTag` for imperative navigation commands and current navigation state
- runtime initialization that wires listeners/effects explicitly

This is useful because it gives a cleaner home for things like:

- browser history listeners
- memory history in tests
- pop/replace/push semantics
- relative navigation from route references
- form submission navigations

The design should be inspired by Remix Router's explicit runtime model here, but expressed through Effect services and layers.

## 14. Implementation Phases

## Phase A - Formalize runtime concepts

Files:

- new `src/RouterRuntime.ts` or similar
- `src/router-runtime.ts` refactor/absorption

Work:

- define runtime state model
- define task/revalidation/loading states
- isolate route orchestration logic into a clearer runtime core
- define inspection/subscription surface for runtime state
- define the initial runtime type model so public APIs can build on extraction/inference rather than ad-hoc typing
- define history/navigation service boundaries
- define initialization lifecycle and hydration bootstrap inputs
- define the decomposed internal state model separately from the aggregate snapshot view
- define the runtime/Reactivity ownership boundary explicitly

Acceptance:

- route orchestration has a first-class internal runtime model

## Phase B - Introduce `ServerRoute`

Files:

- new `src/ServerRoute.ts`
- `src/index.ts`
- tests/docs

Work:

- define server route declarations
- support method/path matching
- support endpoint/document/action route kinds
- keep app routes separate
- build in first-class IDs/introspection hooks from the start
- build in creation-time validation from the start
- define extraction helper types for server route references from the start
- define schema/codecs decode surfaces for params/query/body/form/headers
- define convention/generation hooks for action/document/resource path derivation

Acceptance:

- server request routing exists as a first-class concept independent of app routes

## Phase C - Bridge `ServerRoute` to `Route`

Files:

- `src/ServerRoute.ts`
- `src/Route.ts`
- SSR docs/tests

Work:

- add document route handlers that render app routes
- add request/response services
- add redirect/notFound semantics
- ensure server routes can target app route trees by reference cleanly
- ensure bridge APIs preserve route inference rather than erasing into `unknown`
- define form submission / action bridging semantics across app and server routes
- ensure app route identity does not depend on placeholder components

Acceptance:

- a server route can render an app route tree cleanly

## Phase D - Structured SSR render result

Files:

- `src/Route.ts`
- `src/RouterRuntime.ts`

Work:

- add `Route.renderRequest(...)`
- return structured render result instead of raw `Response`
- include head/meta/hydration/deferred payloads/status/header data
- expose enough route-chain/head/match introspection for document adapters
- define the render result so it is adapter-friendly, testable, and not tied to one host runtime
- define request decode outputs that are available to loaders/rendering/document phases

Acceptance:

- SSR works portably across runtimes

## Phase E - Cancellation / interruption / revalidation hardening

Files:

- runtime internals
- tests

Work:

- formalize navigation cancellation
- formalize interrupted requests/races
- formalize revalidation state and behavior
- introduce or prepare fetcher/task abstractions
- add route-analysis/dev-warning foundations where runtime data helps
- ensure these runtime behaviors are observable in tests without requiring full browser integration
- formalize submission/form-navigation and non-navigation fetcher semantics
- formalize history action / scroll restoration state transitions

Acceptance:

- router behaves like a proper orchestration runtime, not a simple matcher

## Phase F - Convenience adapters

Files:

- `src/ServerRoute.ts`
- docs/examples

Work:

- optional `ServerRoute.serve(...)`
- optional document helpers
- optional Node/Bun/Workers examples
- optional dev/analyzer helpers built on introspection + validation

Acceptance:

- common setups are ergonomic without sacrificing portability

## Phase G - Introspection, validation, and tooling layer

Files:

- `src/Route.ts`
- `src/ServerRoute.ts`
- optional `src/RouteDev.ts` / `src/RouteAnalysis.ts`
- docs/tests

Work:

- add first-class route introspection surfaces
- add creation-time validation for route graphs
- add optional warning/analyzer utilities
- expose enough stable structure for meta-framework tooling/codegen
- add explicit tests and type tests for these capabilities

## Phase H - App route identity refinement

Files:

- `src/Route.ts`
- possible new app-route tree module
- docs/examples/tests

Work:

- move toward first-class app route node/tree identity
- preserve component-first authoring helpers on top of that model
- eliminate the need for placeholder/null components as the preferred route anchor pattern

Acceptance:

- app route identity is first-class without weakening component-first ergonomics

Acceptance:

- routes are inspectable, validatable, and tooling-friendly without polluting the core ergonomic path

## 15. What To Avoid

- do not collapse app routes and server routes into one undifferentiated route type
- do not create two completely disconnected routing systems
- do not tie SSR/server routing to a single platform/framework
- do not make public APIs generic-heavy and builder-noisy without strong payoff
- do not let transport concerns leak into route declaration models
- do not sacrifice component-first ergonomics just to make route trees more formal
- do not make introspection/validation require a separate DSL from the main route APIs
- do not let the router runtime become a competing source of freshness truth
- do not require placeholder/null components as the preferred route identity mechanism

## 16. Success Criteria

This architecture is successful when:

- app routes stay component-first and ergonomic
- server routes are a distinct first-class concept
- SSR and server request handling feel native
- runtime orchestration is stronger and more explicit
- cancellation/revalidation/fetch tasks are handled coherently
- route trees are inspectable and validatable
- route references remain the main identity model
- a meta-framework could reasonably build on top of the exposed pieces
- Reactivity remains the single freshness/invalidation model
- runtime internals remain decomposed and testable

## 17. Recommended Next Execution Order

1. formalize `RouterRuntime` state model and responsibilities
2. define Reactivity vs runtime ownership boundaries
3. design shared route identity/introspection/validation primitives
4. introduce `ServerRoute` as a separate first-class module
5. add request/response services and document rendering bridge
6. add structured `Route.renderRequest(...)`
7. refine app route identity so route nodes are first-class beyond placeholder components
8. harden runtime with cancellation/revalidation/fetch-task semantics
9. add optional analysis/devtools layer on top of route graphs + runtime state
