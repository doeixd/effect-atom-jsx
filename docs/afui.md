# AF-UI

## The Main Value Add: Why AF-UI?

If you are frustrated by maintaining forks of `shadcn/ui`, debugging typos in massive `Tailwind` strings, or paying the runtime performance cost of `CSS-in-JS`, AF-UI offers a fundamentally different approach.

AF-UI is built on an **"Inside-Out" Component Model** powered by Effect-TS. Instead of hardcoding behavior and styles into a single file, AF-UI separates UI into purely structural **Views** described by first-class **Slot Contracts**, and allows you to attach **Behaviors** and **Styles** from the outside, with 100% compile-time type safety.

This solves three major ecosystem pain points:

1. **The Tailwind Problem:** Styles in AF-UI are composable data structures backed by a typed token system. Invalid CSS properties or invalid theme tokens fail at compile time. No more typos or runtime layout bugs.
2. **The shadcn/ui Problem:** You no longer need to copy/paste and fork underlying components just to change a border radius or add an aria-attribute. Components publish their slot contract, and you override styles and behaviors against that contract — completely avoiding fork rot.
3. **The Platform Lock-in Problem:** Because Styles and Behaviors are data, they are completely decoupled from the Web DOM. Slot contracts declare exactly which capabilities, events, and attributes they need, so the same component can be validated and rendered against Web (CSS/HTML), Terminal (TUI), or native platforms just by swapping the platform layer.

## Architecture: From Slot Contract to Platform

AF-UI maintains type safety from the lowest-level element up to the platform rendering boundary:

```text
Slot Contracts ➔ Views ➔ Components ➔ Renderer ➔ Platform
```

1. **Slot Contracts (`View.Slot` / `View.Slots`):** The fundamental building blocks. A slot is a first-class witness that names an attachment point and declares its **Element Capability** (e.g. `Container`, `Interactive`, `TextInput`), plus the events, attributes, and platform requirements it supports.
2. **Views:** Structural skeletons built from slot contracts. Views don't perform logic; a `View<Slots>` exposes exactly the named slots external code may attach to, and nothing else.
3. **Components:** The logical units. A component declares its props, requirements (`Req`), and errors (`E`), computes its reactive state (**Bindings**) in a scoped **setup** Effect, and returns a `View<Slots>`. This is the boundary where external Behaviors and Styles attach.
4. **Renderer:** A service responsible for translating the abstract tree of styled/behavioral nodes into concrete host nodes.
5. **Platform:** The overarching layer that bundles the Renderer, the event system, and the supported element vocabulary. Platforms are described as data (`View.platform`, `Style.platform`) so views and styles can be **validated** against a platform before rendering.

## The Inside-Out Design Philosophy

```text
Traditional Model:
[Component]
  ├── Hardcoded Tailwind Strings
  ├── Hardcoded Interaction Hooks
  └── Structure (JSX)

AF-UI Inside-Out Model:
[Slot Contract]
       ↓
[Component: Setup (Bindings) + View<Slots>]
       ↙     ↘
[Behavior]  [Style]
       ↘     ↙
 [Final Rendered UI]
```

In this model:

1. **Slot contracts declare named element slots** — typed witnesses with defined capabilities.
2. **Behaviors attach interaction** to those slots (event handlers, ARIA, state).
3. **Styles attach appearance** to those slots (colors, spacing, layout, typography).
4. **Both compose from outside** the view through piped transformations, keyed by the same slot contract.
5. **The boundaries are type-safe** — attaching to a slot that doesn't exist, or requiring an event a slot doesn't allow, is a compile-time error (with runtime diagnostics as a second line of defense). Slot contracts, attachments, tokens, and capability/platform checks are enforced today; the view body between slots carries typed tree metadata where authored, with full typed-tree-by-default still in progress.

## The Effect Influence

AF-UI's design is fundamentally influenced by **Effect-TS**, inheriting its core patterns and guarantees:

1. **Services as Context:** Like Effect uses the environment (`R`) for dependency injection, AF-UI components declare services via `Component.require`. Providing a Theme or a Router is identical to `Effect.provide(layer)`.
2. **Pipeable Composition:** Components, behaviors, and styles are transformed and composed using `.pipe()`, matching Effect's standard composition model.
3. **Requirement Bubbling:** Setup steps are Effects. When a component's setup uses a service or its query can fail, that requirement and error automatically accumulate into the component's `Req` and `E` types — surfaced via the `Component.Requirements<C>` and `Component.Errors<C>` type helpers.
4. **Data as Values:** Slot contracts, styles, and behaviors are plain data structures interpreted at runtime, not side-effecting function calls. This makes them easily testable — and statically analyzable — as pure data.

## Quick Start: The Anatomy of a Component

Here is a complete example demonstrating the inside-out workflow, following the authored "golden path":

```ts
import { Behavior, Component, Element, Style, View } from "af-ui";
import { Effect } from "effect";

// 1. Define the Slot Contract (first-class slot witnesses).
//    Names come from the keys; default handles derive from capabilities.
const FieldSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  label: { capability: Element.Capability.Container },
  input: {
    capability: Element.Capability.TextInput,
    allowedEvents: [View.Event.Input, View.Event.Focus],
    allowedAttributes: [View.Attribute.AriaLabel],
  },
});

// 2. Define the Component (setup for logic, JSX for structure)
const Field = Component.make(
  Component.props<{ readonly label: string }>(),
  Component.require<never>(),
  () => Effect.succeed({}),
  (props) =>
    View.fromSlots(FieldSlots, (
      <label>
        <span>{props.label}</span>
        <input />
      </label>
    )),
).pipe(
  Component.withSlots(FieldSlots),
);

// 3. Define the Style (appearance), keyed by the same slot contract
const FieldStyle = Style.forSlots(FieldSlots)({
  root: Style.slot({ display: "grid", gap: "sm" }),
  label: Style.slot({ fontWeight: 600 }),
  input: Style.slot({ padding: "sm" }),
});

// 4. Define the Behavior (interaction), keyed by the same slot contract
const FieldBehavior = Behavior.forSlots(FieldSlots)((elements) =>
  Effect.succeed({
    focus: () => elements.input.focus(),
  }),
);

// 5. Compose Externally
export const StyledField = Field.pipe(
  Style.attachToSlots(FieldStyle, FieldSlots),
  Behavior.attachToSlots(FieldBehavior, FieldSlots),
);
```

One slot contract (`FieldSlots`) is the single source of truth: the view is built from it, the style is checked against it, and the behavior consumes it. Rename a slot or change its capability and every mismatched attachment becomes a compile error.

## How Components Enable This System

Components separate logical state (**Bindings**) from structural representation (**Slots**) by returning a `View<Slots>`:

```ts
Component.make(
  Component.props<Props>(),          // caller configuration
  Component.require<Req>(...tags),   // declared services
  setup,                             // (props) => Effect<Bindings, E, R>
  (props, bindings) => View<Slots>,  // structural view
)
```

**Important:** The component does not return a black-box `JSX.Element`. It returns a `View<Slots>`, which provides the exact structural interface that external Behaviors and Styles inspect for compile-time validation.

### 1. Setup: Where Bindings Come From

Setup is an Effect from props to the component's bindings. `Component.state`, `Component.query`, and `Component.action` are the standard state-ownership primitives: local reactive state, async reads, and mutations with lifecycle tracking. Everything acquired in setup is scoped — it is released automatically when the component unmounts.

For larger components, a pipeable setup builder (`Component.setup<Props>().bind(...)`) is also available as an option: it accumulates named bindings step by step and lets you splice in reusable setup fragments.

### 2. Explicit Requirements

Components declare exactly what services they need via `Component.require`. Missing requirements become compile errors, not runtime surprises. `Component.Requirements<typeof MyComponent>` and `Component.Errors<typeof MyComponent>` extract the accumulated `Req` and `E` for any component.

### 3. Typed Slot Witnesses

Every slot carries machine-checkable metadata:

- **Capability** — the abstract element interface (`Element.Capability.Container`, `Interactive`, `TextInput`, …). Capabilities form a hierarchy (`TextInput → Focusable → Interactive → Base`), so a behavior requiring `Interactive` accepts a `TextInput` slot.
- **Allowed events** — `View.Event.Click`, `Input`, `Focus`, `Blur`, `Hover`, `Press`.
- **Allowed attributes** — `View.Attribute.AriaLabel`, `Role`, `Disabled`, `Value`.
- **Platform requirements** — `View.Requirement.Keyboard`, `Pointer`, `Clipboard`.

Because these are branded witnesses rather than magic strings, an attachment that needs `View.Event.Input` on a slot that doesn't allow it fails at the type level (`View.IsPlatformCompatible`, `View.MissingPlatformSupport`) and produces structured diagnostics at runtime.

## The Styling System

AF-UI's styling system reimagines CSS as a type-safe, composable, platform-agnostic service.

### Composable Style Pieces

AF-UI provides atomic utilities that mirror Tailwind's granularity with full type safety. A style piece is just data, so you build your own vocabulary from `Style.slot` and `Style.compose`:

```ts
const padded = (amount: StyleSpacing) => Style.slot({ padding: amount });
const rounded = (amount: TokenPath<"radius">) => Style.slot({ borderRadius: amount });
const elevated = (level: "sm" | "md" | "lg" | "xl") => Style.slot({ shadow: level });

const cardStyle = Style.make({
  root: Style.compose(
    padded("md"),
    rounded("md"),
    elevated("md"),
    Style.slot({ backgroundColor: "surface" }),
  ),
  header: Style.compose(
    padded([0, 0, "sm", 0]),
    Style.slot({ borderBottom: { width: 1, color: "border" } }),
  ),
});
```

Token paths are type-checked against the theme: `"text.primary"` compiles, `"text.invalid"` does not. Tokens resolve through the `Theme` service at render time.

### Variants and Recipes

Typed, CVA-style variants and multi-slot recipes are built in:

```ts
const buttonVariants = Style.variants({
  base: Style.compose(
    padded(["sm", "md"]),
    rounded("md"),
    Style.slot({ transition: "fast", cursor: "pointer" }),
  ),
  variants: {
    intent: {
      primary: Style.compose(
        Style.slot({ backgroundColor: "accent.default", color: "text.inverse" }),
        Style.states({
          hover: { backgroundColor: "accent.hover" },
          active: { backgroundColor: "accent.active" },
        }),
      ),
      secondary: Style.compose(
        Style.slot({ backgroundColor: "surface", color: "text.primary" }),
      ),
    },
    size: {
      sm: padded(["xs", "sm"]),
      md: padded(["sm", "md"]),
      lg: padded(["md", "lg"]),
    },
  },
  defaults: { intent: "primary", size: "md" },
});
```

### Flexibility Without Losing Guarantees

The system supports the full expressiveness of modern CSS while adding structural guarantees:

1. **Pseudo-states (`Style.states`)**: `hover`, `focus`, `active`, and friends as typed data.
2. **Internal styling (`Style.nest`)**: Target un-slotted child elements with nested selectors without exposing them in the component's public slot contract.
3. **Responsive & conditional**: `Style.responsive({ base, md, lg })` for breakpoints, `Style.when(condition, piece)` for conditional composition.
4. **Animations**: `Style.animation` and `Style.keyframes` as data.
5. **Order of precedence**: Specificity is replaced by a predictable pipeline: Theme ➔ Recipe ➔ Variant ➔ Utility ➔ Attachment Overrides.

### Attachment: The Slot Contract Is the Override Surface

Because components publish their slot contract, external code customizes them **without forking**:

```ts
// Primary authored path: style keyed directly by the contract
Component.pipe(Style.attachToSlots(style, FieldSlots))

// Typed remapping when names differ
Component.pipe(Style.attachBySlotContract(style, { root: "container", title: "heading" }))

// Dynamic string map — for generated code and migration
Component.pipe(Style.attachBySlots(style, { root: "root", title: "title" }))
```

## The Behavior System

Behaviors in AF-UI are **active slot-consumers** that directly attach interaction logic to elements.

### Core Concepts

1. **Direct Attachment (The "No Props" Rule):**
   Behaviors receive the typed elements bound to the slot contract and attach listeners and ARIA attributes to them directly. Interaction logic is bound to the element itself — no fragile prop spreading, no unnecessary re-renders.

   ```ts
   const FieldBehavior = Behavior.forSlots(FieldSlots)((elements) =>
     Effect.succeed({
       focus: () => elements.input.focus(),
     }),
   );
   ```

2. **Declared Event Requirements:**
   A behavior states which events it needs on which slots via `Behavior.events`. Attaching it to a slot that doesn't allow those events is rejected — at compile time via the contract, and at runtime via `Behavior.validateAttachmentBySlots`.

   ```ts
   const NeedsInput = Behavior.events({
     input: [View.Event.Input, View.Event.Focus],
   })(
     Behavior.make<{ readonly input: Element.TextInput }, {}, never, never>(
       (elements) => Effect.succeed({}),
     ),
   );
   ```

3. **Lifecycle Management:**
   Behaviors run inside Effect's `Scope`. Any resources they acquire — event listeners, timers, subscriptions — are automatically cleaned up when the element or component is unmounted.

4. **Composable Behaviors:**
   Combine simple primitives into complex interaction layers with `Behavior.compose`:

   ```ts
   const modalBehavior = Behavior.compose(
     disclosure,   // open/close state
     selection(),  // item selection
   );
   ```

5. **Capability-Based Matching:**
   Behaviors are matched on **Element Capability**. Each behavior declares the abstract element interface it requires (e.g. `Element.Interactive` for a press behavior, `Element.TextInput` for an autocomplete behavior). The capability hierarchy means a more specific slot always satisfies a more general requirement:

   ```ts
   // 1. Behavior requires an Interactive element
   const NeedsTrigger = Behavior.make<
     { readonly trigger: Element.Interactive },
     {},
     never,
     never
   >(() => Effect.succeed({}));

   // 2. Component provides an Interactive slot via its contract
   // 3. SUCCESS: the contract's "root" (Interactive) satisfies "trigger"
   MyComponent.pipe(
     Behavior.attachBySlotContract(NeedsTrigger, { trigger: RootSlot }),
   );
   ```

### Attachment Forms

Mirroring the Style API:

```ts
Behavior.attachToSlots(behavior, slots)               // authored: keyed by contract
Behavior.attachBySlotContract(behavior, { a: SlotA }) // typed remapping
Behavior.attachBySlots(behavior, { a: "a" })          // dynamic string map (generated/migration)
```

## Renderer Agnosticism and Platform Validation

Styles, behaviors, and slot contracts are plain data structures completely decoupled from the browser DOM. A **Platform** is itself described as data, and views and styles are validated against it:

```ts
const web = View.platform({
  name: "web",
  capabilities: [Element.Capability.TextInput /* ... */],
  events: [View.Event.Input, View.Event.Focus /* ... */],
  attributes: [View.Attribute.AriaLabel /* ... */],
  requirements: [View.Requirement.Keyboard /* ... */],
});

View.validatePlatform(view, web);
// → diagnostics like "view:unsupported-slot-capability",
//   "view:unsupported-slot-event", "view:missing-platform-requirement"

Style.validatePlatform(style, Style.platform({
  name: "web",
  properties: [Style.Property.Color, Style.Property.BackgroundColor],
}));
// → "style:unsupported-property" diagnostics
```

The same checks exist at the type level: `View.IsPlatformCompatible<Slot, Platform>` and `View.MissingPlatformSupport<Slot, Platform>` let you assert compatibility in your types, so a component authored against abstract capabilities is *guaranteed* to compile cleanly against any platform that supports them.

## Advanced Examples

### 1. Slot Remapping (View Composition)

When a component wraps another, it can re-export the inner component's slots under its own public names:

```ts
const panelView = View.make(innerSlots, node, {
  slotRemaps: [
    { source: "content", target: "panelBody" },
    { source: "title", target: "panelTitle" },
  ],
});
```

The wrapping component publishes `panelBody` and `panelTitle` in its own contract; styles and behaviors attached to the panel flow through to the inner elements — no forking, no prop-drilling.

### 2. Hidden (Private) Slots

Not every structural element should be part of the public override surface. Slots can be marked hidden so they remain internal:

```ts
const view = View.make(
  {
    root: Element.container(),
    secret: Element.interactive(),
  },
  null,
  {
    name: "Panel",
    slotMetadata: {
      root: View.slot("root"),
      secret: View.hidden("secret"),
    },
  },
);
```

### 3. Collection Slots

Repeated structure is expressed as typed collections, so behaviors can safely operate over every item:

```ts
// A slot holding a collection of interactive elements
const items: Element.Collection<Element.Interactive> = Element.collection([
  Element.interactive(),
  Element.interactive(),
]);

// A selection behavior that consumes the whole collection
const selectionBehavior = Behavior.make<
  { readonly items: Element.Collection<Element.Interactive> },
  { readonly selected: Atom<ReadonlyArray<string>> },
  never,
  never
>(/* ... */);

const SelectableList = List.pipe(
  Behavior.attachBySlots(selectionBehavior, { items: "items" }),
);
```

## Runtime, Routing, and Reactivity: The "Brain" of the Inside-Out Model

Slot contracts, styles, and behaviors describe the *body* of an application. AF-UI's runtime services — Reactivity, Routing, SingleFlight, and Hydration — provide the logical "brain" that powers them. Built entirely on Effect-TS, these systems move away from traditional identity-based updates toward semantic, key-based logic that works across any platform.

### The Reactivity Service (Semantic Invalidation)

Most UI frameworks track reactivity via object identity or dependency graphs. AF-UI adds a dedicated `Reactivity` service that provides **semantic, key-based invalidation**. Instead of saying "refresh this specific atom," you invalidate a semantic concept. This allows decoupled services to drive UI updates without direct references.

```ts
// 1. A key witness: one shared value for the read side and the write side.
// (Plain strings also work as the dynamic escape hatch.)
const Users = Reactivity.Key.make("users");

// 2. A service read method marked as participating in reactivity
class Api extends Effect.Tag("Api")<Api, {
  readonly listUsers: () => Effect.Effect<User[]>
}>() {
  static live = Layer.succeed(Api, {
    // track dependency on the Users key
    listUsers: () => Reactivity.tracked(fetchUsers(), { keys: [Users] }),
  });
}

// 3. A mutation marked as invalidating semantic keys
const addUser = (name: string) =>
  Reactivity.invalidating(api.addUser(name), [Users]);
```

When `addUser` completes, the `Users` key is invalidated. Every atom, component, route loader, or behavior across the entire application that has tracked a dependency on that key refreshes automatically. Parameterized keys use families — `const user = Reactivity.Key.family("user")`, then `user(id)` — and a child key participates in its parent's invalidations.

Key properties:

- **Granular Updates**: Loaders and actions bind to keys via `reactivityKeys` options, so mutating one concept only refreshes its observers.
- **Zero Virtual DOM Overhead**: Reactive style/behavior updates directly mutate platform elements without triggering full component re-renders.
- **Automatic Batching**: The live service batches invalidations into a single microtask flush.

#### How Auto-Tracking Works

AF-UI bridges the gap between high-level semantic keys and low-level fine-grained signals through an automatic tracking system bound to the active Effect layer:

1. **The Tracking Scope**: When a reactive computation (a component render, a memo, an Effect) runs, the active `Reactivity` service establishes a tracking scope.
2. **Automatic Dependency Collection**: Reading an atom or calling a service method wrapped in `Reactivity.tracked` registers its semantic keys with the current scope. You never manage subscriptions manually.
3. **The Version Signal Bridge**: Internally, every semantic key maps to a version signal. Tracking a key subscribes the current scope to that signal; invalidating a key bumps it.

Because tracking is bound to the layer, swapping `Reactivity.live` for `Reactivity.test` gives you manual `flush()` control and invalidation introspection in unit tests — without changing a single line of component code.

### The Routing System (Schema-First & Unified)

AF-UI features a unified, route-first model where components and routing metadata are fused through type-safe pipes. Routes are first-class values that accumulate metadata (params, loaders, head metadata, children) using `.pipe()`. This metadata flows through the type system — path patterns like `"/users/:userId"` even infer their param names at the type level.

```ts
const UserRoute = UserPage.pipe(
  Route.path("/users/:userId"),
  Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
  Route.loader((params) => Effect.gen(function*() {
    const api = yield* Api;
    return yield* api.getUser(params.userId);
  }), {
    staleTime: "30 seconds",
    staleWhileRevalidate: true,
    reactivityKeys: [Users],   // key witness — semantic binding to the Reactivity service
  }),
  Route.title((params, data) => `User: ${data.name}`),
  Route.meta((params, data) => ({ description: data.bio })),
);
```

- **Schema-Driven Safety**: Every part of the URL — path params (`Route.paramsSchema`), query (`Route.querySchema`), hash (`Route.hashSchema`) — is validated via Effect Schema. Invalid URLs are caught at the boundary as typed failures, allowing graceful "Not Found" or error state rendering.
- **Loader Semantics as Data**: `Route.loader` accepts declarative options — `staleTime`/`cacheTime`, `staleWhileRevalidate`, `priority: "critical" | "deferred"` for streaming, `revalidateOnFocus`/`revalidateOnReconnect`, and `reactivityKeys` so semantic invalidation re-runs the right loaders automatically.
- **Trees and Layouts**: `Route.children([...])` nests routes under layouts; `Route.id` assigns stable identities; head metadata (`Route.title`, `Route.meta`) is deep-merged down the matched route chain and applied to the document.
- **Requirement Bubbling**: Because routes wrap components and loaders are Effects, their requirements bubble up. If a deeply nested route's loader requires a `BillingService`, the top-level router inherits that requirement in its `Req` type.
- **Typed Extraction**: `RouteParamsOf<T>`, `RouteLoaderDataOf<T>`, and `RouteLoaderErrorOf<T>` recover a route's types anywhere you need them.

### SingleFlight & Loader Infrastructure

AF-UI solves the "waterfall problem" and SSR/hydration mismatch through its **SingleFlight** infrastructure.

- **Bundled Data Fetching**: On navigation, AF-UI calculates all matching routes and their loaders and executes them in a single flight — parallelized on the server, or bundled into one request from the client (`Route.runMatchedLoaders`, with `Route.runStreamingNavigation` splitting critical from deferred loaders for streaming).
- **SingleFlight Mutations**: Actions opt into single flight declaratively. A mutation triggers the server-side action *and* returns the updated data for all affected loaders in a single round-trip:

  ```ts
  const save = Atom.action(saveUser, {
    singleFlight: { mode: "auto", url: () => window.location.pathname },
  });
  ```

- **Transport-Agnostic**: The `SingleFlightTransport` service only moves the request/response envelope across the boundary; loader selection, invalidation capture, and payload hydration stay in the route/runtime layer. The default transport is fetch-based, but any transport (WebSocket, IPC, test stub) can be provided as a layer.

### Optimistic Updates

AF-UI enables immediate UI feedback through **Optimistic Atoms**, letting the UI reflect state changes before a server-side action completes.

```ts
const countAtom = Atom.make(0).pipe(Atom.withOptimistic());

const increment = Effect.gen(function*() {
  // Optimistically apply the update, then run the server effect.
  // The optimistic value clears automatically on success, failure, or defect.
  yield* countAtom.withEffect(
    (prev) => prev + 1,
    api.incrementCount(),
  );
});
```

The UI reads from `countAtom` as usual; it doesn't need to know whether the value is "optimistic" or "confirmed" — the `OptimisticAtom` handles the transparent switch, reverting to the last known server state on failure.

For richer flows, components use the optimistic action builder, which packages the whole lifecycle as data:

```ts
Component.setup<Props>()
  .bind("todos", () => Component.state<ReadonlyArray<Todo>>([]))
  .bind("addTodo", ({ bindings }) =>
    Component.optimistic(bindings.todos).action({
      update: (current, input: NewTodo) => [...current, toPending(input)],
      effect: (next, input) => api.createTodo(input),
      reconcile: (next, created) => confirmPending(next, created),
      reactivityKeys: ["todos"],
      singleFlight: { mode: "auto" },
    }),
  )
```

The resulting handle exposes `value` (optimistic-or-committed), `committed`, `hasOptimistic`, and `rollback()` — so views can render pending states explicitly when they want to, and ignore them when they don't.

### The Result Type: Bridging Async and UI

AF-UI uses a standardized `Result<A, E>` union to handle asynchronous states consistently across the framework. It is deliberately shaped for stale-while-revalidate rendering:

- `Initial` — no data yet (`waiting: true` while the first load is in flight).
- `Success<A>` — data available, with a `timestamp`; `waiting: true` means a revalidation is in progress while stale data stays on screen.
- `Failure<E>` — a typed error (or a captured defect), carrying `previousSuccess` so the UI can keep showing the last good data alongside the error.

Loaders and queries produce reactive `Result` values. Because it is a tagged union, you render states with exhaustive matching — no "conditional hook" errors:

```ts
Result.builder(users)
  .onInitial(() => <Spinner />)
  .onSuccess((list) => <UserList users={list} />)
  .onFailure((error) => <ErrorView error={error} />)
  .render()
```

`Result.match`, `Result.map`, and `Result.getOrElse` cover the non-JSX cases.

### Hydration: Explicit State Transfer

AF-UI manages server-to-client state transfer through an explicit hydration API, ensuring a seamless transition from static HTML to an interactive application.

1. **Dehydration (server)**: During SSR, `dehydrate(registry, entries)` snapshots the chosen atoms into a JSON-serializable payload (each entry carries its key, value, and timestamp), which is injected into the HTML document.
2. **Rehydration (client)**: On load, `hydrate(registry, payload, resolvers)` restores the atom values directly into the registry **before** the component tree mounts, so components read the seeded state synchronously on first render.

Hydration is deliberately explicit and controllable:

- **Validation**: In strict mode, unknown or missing keys surface as a typed `HydrationError` instead of silently diverging — catching client/server definition mismatches at the boundary.
- **Selective Hydration**: You choose exactly which registry entries are dehydrated, so sensitive or large UI-only state never enters the SSR payload.

This gives **zero-flicker bootstrapping** (components have their `Success` data immediately — no loading "pop") and **state continuity** across the server/client boundary.

### Server Routes & Document Rendering

Server routes extend the routing model to the backend, providing typed request decoding and document rendering. A server route is constructed by kind — `ServerRoute.json()`, `ServerRoute.action()`, `ServerRoute.resource()`, or `ServerRoute.document(appRoutes)` — and enhanced through the same pipeable pattern:

```ts
const SaveApi = ServerRoute.json().pipe(
  ServerRoute.method("POST"),
  ServerRoute.path("/api/save"),
  ServerRoute.body(MyDataSchema),
  ServerRoute.handle(({ body }) => saveToDb(body)),
);
```

- **Typed Handlers**: Schemas decode every part of the request — `ServerRoute.params`, `.query`, `.form`, `.body`, `.headers`, `.cookies` — and `.response` types the output. The handler receives one fully-decoded, fully-typed input object.
- **Dispatch**: `ServerRoute.dispatch(routes, request, { layer })` matches an incoming `Request` against the route table and runs the handler inside your service layer. `ServerRoute.redirect(location)` and `ServerRoute.notFound()` are typed control-flow signals.
- **Document Rendering**: `ServerRoute.document(appRoutes)` renders your unified client route tree to a full HTML response — status, headers, merged head metadata, the rendered HTML, the SingleFlight loader payload for hydration, and any deferred streaming scripts.

### Effect Layers as the Context System

AF-UI replaces traditional React-style Context with **Effect Layers**. Components declare their dependencies via `Component.require`; providing them is done with layers:

```ts
// Component says: "I need an Api service"
const MyComponent = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  setup,
  view,
);

// Provide locally…
const WithApi = MyComponent.pipe(Component.withLayer(ApiLive));

// …or at the mount boundary
const dispose = Component.mount(App, {
  props: {},
  target: document.getElementById("app")!,
  layer: Layer.mergeAll(ApiLive, ThemeLive, Reactivity.live),
});
```

Why this is superior to Context:

- **Compile-Time Enforcement**: Forget a provider? The app won't compile — `Component.withLayer` subtracts the provided services from the component's `Req`.
- **Scoped Cleanup**: Layers use Effect finalizers, so services (WebSockets, DB connections) are automatically closed when a component subtree unmounts; `Component.mount` returns a dispose function that tears the whole tree down.
- **Trivial Mocking**: Testing a component means providing a test layer (e.g. `Reactivity.test`) instead of a live one.

### Pipeability: The Algebra of UI

Every major entity in AF-UI — Component, Route, ServerRoute, Style, Behavior — is pipeable. Complex applications are built by composing small, reusable functions:

```ts
const EnhancedComponent = BaseComponent.pipe(
  Component.withLayer(MyLocalLayer),
  Style.attachToSlots(myStyle, MySlots),
  Behavior.attachToSlots(myBehavior, MySlots),
  Route.path("/details"),
);
```

This functional approach ensures that inference flows correctly and logic stays decoupled from the component implementation. Whether it is the semantic invalidation of the Reactivity service, the bundled loaders of SingleFlight, or requirement bubbling through routes and views, AF-UI is one unified algebra: portable, type-safe, and performant by default.

## Comparison to Other Systems

| Aspect | Tailwind | shadcn/ui | CSS-in-JS | AF-UI |
|--------|----------|-----------|-----------|-------|
| **Granularity** | Utility classes | Copy-paste | Template literals | Composable typed style pieces |
| **Type Safety** | None (magic strings) | Limited (props only) | Limited | Full compile-time validation |
| **Customization** | Complex overrides | Requires forking | Context providers | Published slot contracts |
| **Platform** | Web-only | Web-only | Web-focused | Platform-agnostic, validated |
| **Encapsulation** | Global namespaces | Tailwind classes | CSS scoping hacks | Slot-scoped, zero collisions |

## Addressing Common Critiques

**1. Ergonomics at Scale: Does pipe-based composition become boilerplate with complex components?**
While the field example is simple, real-world components scale well in this architecture. Because logic (setup) and structure (the view) are completely isolated, complex state machines remain purely functional and don't clutter the view tree. Dozens of slots are managed in one flat slot contract, making the structure easy to read. The `.pipe()` composition happens *once* at the export boundary, acting as a clean summary of what is attached, rather than deeply nesting HOCs or scattering hooks throughout the render function. Reusable setup fragments play the role hooks play elsewhere, without hiding requirements.

**2. Learning Curve: Doesn't this require fluency in Effect-TS?**
Yes. This architecture targets teams already investing in robust, type-safe applications. However, UI engineers only need a small subset of Effect (`Effect.gen`, `yield*`, and basic Layer management). Because the type system is so strict, the compiler acts as an interactive tutor — missing requirements are caught instantly at compile time, eliminating the hours spent debugging "undefined context" runtime errors.

**3. The TUI/Mobile Claim: Is the cross-platform story real or just an aspiration?**
The platform agnosticism is a structural reality enforced by the compiler *and* by data. Slot contracts declare capabilities, events, attributes, and platform requirements as typed witnesses, and platforms declare what they support; `View.validatePlatform` and the `View.IsPlatformCompatible` type check them against each other. The framework mathematically prevents DOM-coupling in component logic. While writing a production-ready native or TUI renderer takes framework-level effort, the *component code* you write today is verified against the target platform's declared vocabulary.

**4. Runtime Cost: How does runtime styling compare to zero-runtime solutions like Panda CSS or Vanilla Extract?**
Unlike traditional CSS-in-JS that parses massive template literals at runtime, AF-UI styles are lightweight, pre-structured objects that map closely to platform primitives. More importantly, AF-UI's reactivity is granular — when a reactive style updates, it directly mutates the specific host node's style without triggering a full Virtual DOM diff. And because styles are pure data structures keyed by slot contracts, a build step can statically extract non-reactive styles exactly like Vanilla Extract.

**5. Ecosystem Interop: Can I use this in an existing React app?**
Yes, incrementally. Because AF-UI separates its lifecycle and rendering from React's VDOM, an AF-UI component tree can be mounted inside a standard React component using a `useEffect` hook (much like mounting a complex D3 chart or WebGL canvas). You can adopt AF-UI to build your core design system or complex state-heavy forms without rewriting your existing React application.

## When Not to Use AF-UI

Honest scoping, because the rest of this document argues the other side:

- **Teams not investing in Effect-TS.** The compile-time guarantees are the
  product; without Effect fluency you pay the ceremony without collecting
  the safety.
- **Projects that need a mature component ecosystem now.** The behavior pack
  covers core headless primitives; it is not yet a shadcn-scale catalog.
- **Small static sites and throwaway prototypes.** Slot contracts pay for
  themselves in long-lived, customized, state-heavy applications — not in a
  landing page.

Unlike most alternatives in this space, you do *not* give up incremental
adoption (AF-UI mounts inside an existing React app) or SSR (hydration,
streaming loaders, and single-flight mutations are first-class).

## Conclusion

AF-UI's Slot Contract / Style / Behavior system represents a paradigm shift in UI architecture. By applying Effect's service/layer model to UI development — and making the slot contract the single, typed source of truth shared by views, styles, behaviors, and platforms — it achieves true type safety, effortless composability, and genuine platform independence, finally solving the long-standing problems of Tailwind and `shadcn/ui`.
