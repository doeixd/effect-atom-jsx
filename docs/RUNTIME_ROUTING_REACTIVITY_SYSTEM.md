# Runtime, Routing, and Reactivity in AF-UI

## Introduction: The "Brain" of the Inside-Out Model

While the [Design/Styling/Behavior system](./DESIGN_STYLING_BEHAVIOR_SYSTEM.md) defines how components look and interact, AF-UI's runtime services—Routing, Reactivity, and SingleFlight—provide the logical "brain" that powers them. Built entirely on Effect-TS, these systems move away from traditional identity-based updates toward semantic, key-based logic that works across any platform.

## 1. The Reactivity Service (Semantic Invalidation)

Most UI frameworks track reactivity via object identity or dependency graphs. AF-UI leverages a dedicated `Reactivity` service to provide **semantic, key-based invalidation**.

### Semantic vs. Identity Reactivity
Instead of saying "refresh this specific atom," you invalidate a semantic concept. This allows decoupled services to drive UI updates without direct references.

```ts
// 1. A service read method marked as participating in reactivity
class Api extends Effect.Tag("Api")<Api, {
  readonly listUsers: () => Effect.Effect<User[]>
}>() {
  static live = Layer.succeed(Api, {
    // track dependency on "users" key
    listUsers: () => Reactivity.tracked(fetchUsers(), { keys: ["users"] })
  })
}

// 2. A mutation marked as invalidating semantic keys
const addUser = Action.make(function*(name: string) {
  return yield* Reactivity.invalidating(api.addUser(name), ["users"]);
});
```

When `addUser` completes, `Reactivity.invalidate(["users"])` fires. Every atom, component, or behavior across the entire application (Web, TUI, or Native) that has tracked a dependency on the "users" key refreshes automatically.

### Key Benefits:
- **Granular Updates**: Mutating a specific user (`{ users: ["alice"] }`) only refreshes observers of that sub-key or the parent "users" key.
- **Zero Virtual DOM Overhead**: Reactive style/behavior updates directly mutate platform elements (via `el.setAttr`) without triggering full component re-renders.
- **Automatic Batching**: Multiple invalidations in a single synchronous block are batched into a single microtask flush.

## 2. How Auto-Tracking Works

AF-UI bridges the gap between high-level semantic keys and low-level fine-grained signals through an automatic tracking system. You don't have to manually manage subscriptions; the framework "sees" what you read within a **Reactivity Service** context.

### 1. The Tracking Scope
When a reactive computation (like a component render, a `memo`, or an `Effect`) runs, AF-UI establishes a **Tracking Scope**. This scope is managed by the active `Reactivity` service provided in your Effect layer.

### 2. Automatic Dependency Collection
When you read an Atom or call a service method wrapped in `Reactivity.tracked`, the operation interacts with the current `Reactivity` service to register its semantic keys.
```ts
// Within a Tracking Scope (e.g. Component render)
(props, { userList }) => {
  // Reading userList() automatically registers the "users" key with the Reactivity service
  const users = userList(); 
  // ...
}
```

### 3. The Version Signal Bridge
The `Reactivity` service internally maps every semantic key to a numeric **Version Signal**. 
- **Read**: Tracking a key subscribes the current scope to that key's Version Signal via the service.
- **Invalidate**: Invalidating a key via the service bumps its Version Signal.

This design ensures that tracking is always bound to the active **Effect Layer**. Swapping the `Reactivity.live` layer for `Reactivity.test` allows you to manually flush invalidations and inspect the tracking state during unit tests, without changing a single line of component code.

## 3. The Routing System (Schema-First & Unified)

AF-UI features a unified, route-first model where components and routing metadata are fused through type-safe pipes.

### Unified Route Definition
Routes are first-class values that accumulate metadata (params, loaders, guards) using `.pipe()`. This metadata flows through the type system, ensuring that loader data and params are always correctly typed in your components.

```ts
const UserRoute = Component.make(...)(...).pipe(
  Route.path("/users/:userId"),
  Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
  Route.loader((params) => Effect.gen(function*() {
    const api = yield* Api;
    return yield* api.getUser(params.userId);
  })),
  Route.title((params, data) => `User: ${data.name}`)
);
```

### Schema-Driven Safety
Every part of the URL (Path Params, Query, Hash) is validated via **Effect Schema**. If a user navigates to an invalid ID, the schema failure is caught at the boundary, allowing for graceful "Not Found" or "Error" state rendering.

### Requirement Bubbling in Routes
Because routes are components, their requirements bubble up. If a deeply nested route requires a `BillingService`, the top-level Router automatically inherits that requirement in its `Req` type parameter.

## 3. SingleFlight & Loader Infrastructure

AF-UI solves the "Waterfall Problem" and SSR/Hydration mismatch through its **SingleFlight** infrastructure.

### Bundled Data Fetching
When navigating, AF-UI calculates all matching routes and their loaders. It then executes them in a single flight (parallelized on the server, or bundled into one request from the client).

### SingleFlight Mutations
Using `Route.actionSingleFlight` allows a mutation to trigger a server-side action and return the updated data for all affected loaders in a single round-trip.

## 4. The Result Type: Bridging Async and UI

AF-UI uses a standardized **Result** type union to handle asynchronous states consistently across the framework:
- `Loading`: Initial state before data arrives.
- `Success<A>`: Data successfully fetched.
- `Failure<E>`: A typed error occurred in the Effect.
- `Defect`: An unexpected bug or interrupt occurred (Cause).
- `Refreshing<A, E>`: Stale data is available while a re-validation is in progress (SWR).

### Reactive Integration
Loaders produce `ReadonlyAtom<Result<A, E>>`. Because it is a tagged union, you can use the `<Loading>` and `<Error>` boundary components or simple switch statements to render UI states without "conditional hook" errors.

## 5. Hydration: The Hydration Service & Layer

AF-UI manages server-to-client state transfer through an explicit `Hydration` service, ensuring a seamless transition from static HTML to an interactive application.

### The Hydration Workflow
1. **Dehydration (Server-Side)**: During SSR, the `Hydration` service snapshots the state of all tracked Atoms into a JSON-serializable payload. This payload is injected into the HTML document as a `window.__AF_STATE__` script tag.
2. **Rehydration (Client-Side)**: Upon load, the client-side `Hydration` layer reads this payload and restores the `Atom` values directly into the `Registry` service. This occurs **before** the component tree mounts, ensuring components read the seeded state synchronously on first render.

### The Hydration Layer
By making hydration a formal `Layer`, AF-UI provides fine-grained control:
- **Validation**: Configure `HydrationOptions` to enforce strict schema validation on incoming server state, throwing a `HydrationError` if the client-side app definitions mismatch the server's serialized state.
- **Selective Hydration**: Easily define which atoms are dehydrated by passing specific registry entries, allowing you to exclude sensitive or large UI-only state from the SSR payload.

This ensures:
- **Zero-Flicker Bootstrapping**: Components have their `Success` data available immediately, so the UI doesn't "pop" from loading to success.
- **State Continuity**: Complex reactive state (like form inputs or scroll positions) is preserved across the boundary.

## 6. Server Routes & Document Rendering

Server Routes extend the routing model to the backend, providing typed request decoding and document rendering.

### Typed Handlers
Server routes use schemas to decode Headers, Cookies, Body, and Query strings:
```ts
const MyApi = ServerRoute.make("json").pipe(
  ServerRoute.path("/api/save"),
  ServerRoute.bodySchema(MyDataSchema),
  ServerRoute.handler(({ body }) => saveToDb(body))
);
```

### Document Rendering
The `ServerRoute.document` utility takes your unified route tree and produces full HTML responses, including automatic injection of `SingleFlight` seed data and script tags.

## 7. Effect Layers as the Context System

AF-UI replaces traditional React-style Context with **Effect Layers**.

### The Dependency Injection Model
Components declare their dependencies in the `Req` type. Providing these dependencies is done via `Layer`:
```ts
// Component says: "I need an Api service"
const MyComponent = Component.make(..., Component.require(Api))(...);

// App provides the live implementation
const AppLive = Layer.mergeAll(ApiLive, ThemeLive, Reactivity.live);

Component.mount(App, { layer: AppLive });
```

### Why this is superior to Context:
- **Compile-Time Enforcement**: Forget a Provider? The app won't compile.
- **Scoped Cleanup**: Layers use `Effect.addFinalizer`, so services (like WebSockets or DB connections) are automatically closed when a component subtree unmounts.
- **Trivial Mocking**: Testing a component means providing a `TestLayer` instead of a `LiveLayer`.

## 8. Pipeability: The Algebra of UI

Every major entity in AF-UI (Component, Route, Style, Behavior, ServerRoute) is **Pipeable**. This allows you to build complex logic by composing small, reusable functions:

```ts
const EnhancedComponent = BaseComponent.pipe(
  Component.withLayer(MyLocalLayer),
  Behavior.attach(disclosure),
  Style.attach(myStyle),
  Route.path("/details")
);
```

This functional approach ensures that **inference flows** correctly and **logic is decoupled** from the component implementation.

## Conclusion: A Unified Algebraic UI

AF-UI is not just a view library; it is a unified algebra for building applications. By leveraging Effect-TS, it brings the same level of rigor found in backend systems to the frontend. Whether it is the semantic invalidation of the Reactivity service, the bundled loaders of SingleFlight, or the requirement bubbling of the View system, AF-UI ensures that your application is **portable, type-safe, and performant by default.**
