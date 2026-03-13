# Runtime, Routing, and Reactivity in AF-UI

## Introduction: The "Brain" of the Inside-Out Model

While the [Design/Styling/Behavior system](./DESIGN_STYLING_BEHAVIOR_SYSTEM.md) defines how components look and interact, AF-UI's runtime services—Routing, Reactivity, and SingleFlight—provide the logical "brain" that powers them. Built entirely on Effect-TS, these systems move away from traditional identity-based updates toward semantic, key-based logic that works across any platform.

## 1. The Reactivity Service (Semantic Invalidation)

Most UI frameworks track reactivity via object identity or dependency graphs. AF-UI leverages `@effect/experimental/Reactivity` to provide **semantic, key-based invalidation**.

### Semantic vs. Identity Reactivity
Instead of saying "refresh this specific atom," you invalidate a semantic concept:
```ts
// 1. Atom subscribes to the "users" key
const userList = Atom.make(Effect.gen(function*() {
  const api = yield* Api;
  return yield* api.listUsers();
})).pipe(Atom.withReactivity(["users"]));

// 2. Action invalidates the "users" key upon success
const addUser = Action.make(function*(name: string) {
  const api = yield* Api;
  yield* api.addUser(name);
}, { reactivityKeys: ["users"] });
```
When `addUser` completes, `Reactivity.invalidate(["users"])` fires. Every atom, component, or behavior across the entire application (Web, TUI, or Native) watching the "users" key refreshes automatically.

### Key Benefits:
- **Granular Updates**: Mutating a specific user (`{ users: ["alice"] }`) only refreshes observers of that sub-key, not the whole list.
- **Zero Virtual DOM Overhead**: Reactive style/behavior updates directly mutate platform elements (via `el.setAttr`) without triggering a full component re-render.
- **Cross-Component Communication**: Use semantic keys as a type-safe pub/sub system for things like toasts or navigation events.

## 2. The Routing System (Schema-First & Unified)

AF-UI features a unified, route-first model where components and routing metadata are fused through type-safe pipes.

### Unified Route Definition
Routes are first-class values that accumulate metadata (params, loaders, guards) using `.pipe()`:
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

### Cache Seeding and Hydration
On the server, loader results are serialized into the HTML. On the client, the `SingleFlightTransport` seeds the local cache before hydration even begins. This ensures:
- **Zero-Flicker Hydration**: Components have their data synchronously available during the first mount.
- **Smart Reruns**: Loaders only rerun if their `reactivityKeys` are invalidated or if their parameters change.

### 4. The Result Type: Bridging Async and UI

AF-UI uses a standardized **Result** type (`loading`, `success`, `failure`) to handle asynchronous states consistently across the framework. 

- **Atoms & Loaders**: Both produce `ReadonlyAtom<Result<A, E>>`.
- **Match-Ready**: Because it is a tagged union, you can use `Match` or simple switch statements in your view to render loading spinners, error messages, or data without "conditional hook" errors.
- **SingleFlight Integration**: The hydration process seeds these `Result` values directly into the client cache, allowing components to transition from `loading` to `success` synchronously upon mount.

## 5. Server Routes & Document Rendering

Server Routes extend the routing model to the backend, providing typed request decoding and document rendering.

### Typed Handlers
Server routes use schemas to decode Headers, Cookies, Body, and Query strings before the handler even runs:
```ts
const MyApi = ServerRoute.make("json").pipe(
  ServerRoute.path("/api/save"),
  ServerRoute.bodySchema(MyDataSchema),
  ServerRoute.handler(({ body }) => yield* saveToDb(body))
);
```

### Document Rendering
The `ServerRoute.document` utility takes your unified route tree and a renderer service to produce full HTML responses, including automatic injection of `SingleFlight` seed data and script tags.

## 5. Effect Layers as the Context System

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
- **Trivial Mocking**: Testing a component means providing a `TestLayer` instead of a `LiveLayer`. No wrapper components or mock injection hacks required.

## 6. Pipeability: The Algebra of UI

Every major entity in AF-UI (Component, Route, Style, Behavior, ServerRoute) is **Pipeable**. This allows you to build complex logic by composing small, reusable functions:

```ts
const EnhancedComponent = BaseComponent.pipe(
  Component.withLayer(MyLocalLayer),
  Behavior.attach(disclosure),
  Style.attach(myStyle),
  Route.path("/details")
);
```

This functional approach ensures that:
1. **Inference Flows**: TypeScript correctly carries type information from the start of the pipe to the end.
2. **Logic is Decoupled**: You can define a style or a behavior once and "pipe" it into fifty different components.
3. **Feature Discovery**: Typing `.pipe(` allows IDEs to suggest every available transformation (Styles, Behaviors, Routes) in one place.

## Conclusion: A Unified Algebraic UI

AF-UI is not just a view library; it is a unified algebra for building applications. By leveraging Effect-TS, it brings the same level of rigor found in backend systems to the frontend. Whether it is the semantic invalidation of the Reactivity service, the bundled loaders of SingleFlight, or the requirement bubbling of the View system, AF-UI ensures that your application is **portable, type-safe, and performant by default.**
