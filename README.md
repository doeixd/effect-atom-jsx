# effect-atom-jsx

Effect-native reactive state and inside-out UI. One algebra from a counter
atom to a full-stack, schema-validated, single-flight application.

```ts
import { Atom } from "effect-atom-jsx";

const count = Atom.make(0);

count();          // read
count.set(1);     // write
count.update((n) => n + 1);
```

Built on [Effect](https://effect.website): services are layers, errors are
typed, lifecycles are scoped, and everything composes with `.pipe()`.

---

## What's in the box

| Layer | What you get |
|---|---|
| **Atoms** | Callable fine-grained state, derived atoms, families, schema-validated forms |
| **Async** | `Result`-based queries, actions, retry/polling schedules, optimistic updates |
| **Reactivity** | Semantic key-based invalidation as an Effect service |
| **AF-UI** | Components with published slot contracts; styles and behaviors attach from outside |
| **Router** | Schema-first routes, loaders with SWR caching, typed links, head metadata |
| **Single flight** | One round-trip for a mutation *and* all affected loader data |
| **Server** | Typed server routes, document rendering, SSR hydration |

You can stop at any row. The atoms work alone; the UI model works without the
router; the router works without the server runtime.

## Install

```sh
npm install effect-atom-jsx effect
```

**Effect compatibility:** this package peers on **Effect 4 beta**
(`effect ^4.0.0-beta.29`). Ship as **0.x prerelease / beta** until Effect 4
is stable; a `1.0.0` cut waits on a stable Effect core. See
`docs/RELEASE_CHECKLIST.md` and `docs/V1_SCOPE.md`.

**TypeScript:** library typecheck and `tsc` build use **TypeScript 7**
(`typescript` ^7.0.2). Consumer projects may use TS 5.x+ for app code; the
package ships `.d.ts` from the TS7 toolchain.

### Setup

JSX compiles to fine-grained DOM operations via
`babel-plugin-jsx-dom-expressions`. Point `moduleName` at the
`effect-atom-jsx/runtime` subpath (that is where the compiler-facing helpers
live):

```json
// babel config
{
  "plugins": [
    ["babel-plugin-jsx-dom-expressions", {
      "moduleName": "effect-atom-jsx/runtime",
      "generate": "dom",
      "contextToCustomElements": true
    }]
  ]
}
```

For `tsc` to type-check your JSX, set these in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "effect-atom-jsx"
  }
}
```

Mount an app with `render` (SSR uses `renderToString` / `hydrateRoot`):

```tsx
import { render } from "effect-atom-jsx";

render(() => <App />, document.getElementById("root")!);
```

---

## 1. State: atoms

Atoms are callable, writable, and fine-grained. No registry ceremony, no
provider wrapper.

```ts
import { Atom } from "effect-atom-jsx";

const count = Atom.make(0);
const doubled = Atom.map(count, (n) => n * 2);

count.update((n) => n + 1);
doubled(); // 2
```

Families give you keyed state with explicit lifecycle:

```ts
const todo = Atom.family((id: string) => Atom.make<Todo | null>(null));

todo("a1").set({ id: "a1", title: "ship v1" });
todo.evict("a1"); // explicit memory control
```

## 2. Async: queries, actions, and `Result`

Async state is one tagged union, `Result<A, E>`, everywhere — loaders,
queries, actions. Errors are typed; defects are separate; stale data stays
renderable while revalidating.

```ts
import { Atom, Result } from "effect-atom-jsx";
import { Layer } from "effect";

// Bind a runtime once; requirements (R) are eliminated at construction.
const runtime = Atom.runtime(Layer.mergeAll(ApiLive, Reactivity.live));

const users = runtime.atom(() => api.listUsers());   // ReadonlyAtom<Result<User[], ApiError>>

const addUser = runtime.action((name: string) => api.addUser(name));

addUser("Ada");        // fire-and-forget
addUser.pending();     // reactive pending state
addUser.runEffect("Ada"); // typed Effect path for composition
```

Render a `Result` exhaustively — no conditional-hook gymnastics:

```ts
Result.builder(users())
  .onInitial(() => <Spinner />)
  .onSuccess((list) => <UserList users={list} />)
  .onFailure((error) => <ErrorView error={error} />)
  .render();
```

Policies are pipeable data, not config soup:

```ts
const usersFresh = users.pipe(
  Atom.withStaleTime("30 seconds"),
  Atom.withRetry(Schedule.exponential("100 millis")),
  Atom.withPolling("1 minute"),
);
```

## 3. Reactivity: invalidate concepts, not references

Instead of "refresh this atom," you invalidate a semantic key. Anything that
tracked that key — atoms, loaders, components — refreshes automatically, with
microtask batching.

```ts
import { Reactivity } from "effect-atom-jsx";

// A key witness: the read side and the write side share one literal-typed
// value, so a typo'd key is a compile error instead of a silent non-refresh.
const Users = Reactivity.Key.make("users");

class Api extends Effect.Tag("Api")<Api, {
  readonly listUsers: () => Effect.Effect<User[]>
}>() {
  static live = Layer.succeed(Api, {
    listUsers: () => Reactivity.tracked(fetchUsers(), { keys: [Users] }),
  });
}

const addUser = (name: string) =>
  Reactivity.invalidating(api.addUser(name), [Users]);
```

Parameterized keys use families (`Reactivity.Key.family("user")`, then
`user(id)`); plain strings remain valid as the dynamic escape hatch.

Swap `Reactivity.live` for `Reactivity.test` in tests and drive invalidation
manually with `flush()` — no component changes.

## 4. UI: the inside-out component model (AF-UI)

Most frameworks bake structure, style, and behavior into one file. AF-UI
components declare a **slot contract** — a typed description of their
attachment points — and styles and behaviors attach from outside, checked
against that contract at compile time.

```ts
import { Behavior, Component, Element, Style, View } from "effect-atom-jsx";
import { Effect } from "effect";

// One contract: the view is built from it, styles and behaviors are checked
// against it. Rename a slot and every mismatched attachment fails to compile.
const FieldSlots = View.Slots.define({
  root:  { capability: Element.Capability.Container },
  label: { capability: Element.Capability.Container },
  input: {
    capability: Element.Capability.TextInput,
    allowedEvents: [View.Event.Input, View.Event.Focus],
  },
});

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
).pipe(Component.withSlots(FieldSlots));

// Appearance, from outside — token paths are type-checked against the theme.
const FieldStyle = Style.forSlots(FieldSlots)({
  root:  Style.slot({ display: "grid", gap: "sm" }),
  label: Style.slot({ fontWeight: 600 }),
  input: Style.slot({ padding: "sm" }),
});

// Interaction, from outside — scoped: listeners clean up on unmount.
const FieldBehavior = Behavior.forSlots(FieldSlots)((elements) =>
  Effect.succeed({ focus: () => elements.input.focus() }),
);

export const StyledField = Field.pipe(
  Style.attachToSlots(FieldStyle, FieldSlots),
  Behavior.attachToSlots(FieldBehavior, FieldSlots),
);
```

Why bother?

- **No fork rot.** Customizing a design-system component means attaching to
  its published contract, not copy-pasting its source (the shadcn problem).
- **No magic strings.** Invalid tokens, unknown slots, and events a slot
  doesn't allow are compile errors (the Tailwind problem).
- **No DOM lock-in.** Slots declare abstract capabilities
  (`TextInput → Focusable → Interactive → Base`); views and styles are
  validated against platform vocabularies as data
  (`View.validatePlatform`, `Style.validatePlatform`).

Setup is a scoped Effect from props to bindings, with standard ownership
primitives — `Component.state` (local reactive state), `Component.query`
(async reads), `Component.action` (mutations). Everything acquired in setup
is released on unmount. For larger components a pipeable builder
(`Component.setup<Props>().bind(...)`) is available.

The behavior pack ships composable headless primitives — `disclosure`,
`selection`, `keyboardNav`, `focusTrap`, `searchFilter`, `pagination`, and a
composed `combobox` — all matched by element capability, so a press behavior
attaches to anything `Interactive`. `focusTrap` can cycle Tab/Shift+Tab over a
focusable collection while remaining renderer-neutral.

**Honest scoping:** slot contracts, attachments, tokens, and
capability/platform checks are enforced at compile time today. Authored views
carry tree metadata through `View.fromSlots(...)` / `View.fromJsx(...)`;
compiler extraction of richer JSX tree metadata remains a tooling concern.
Platform-agnosticism means your components are *verified* against declared
platform vocabularies — alternate renderers (TUI, native) are deferred, not
shipped.

## 5. Routing: schema-first, loader-driven

Routes are components with metadata accumulated through pipes. Params, query,
and hash are Effect Schema-validated; loaders are Effects with declarative
caching bound to reactivity keys.

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
    reactivityKeys: [Users],  // invalidate the Users key → this loader re-runs
  }),
  Route.title((params, user) => `User: ${user.name}`),
);
```

Requirements bubble: if a nested loader needs `BillingService`, the top-level
router's `Req` includes it, and forgetting the layer is a compile error.
Links are typed (`Route.link`), head metadata merges down the matched chain,
and `priority: "critical" | "deferred"` splits loaders for streaming.

### Single flight

Navigations run all matched loaders as one batch. Mutations can return the
updated data for every affected loader in the same round-trip:

```ts
const save = Atom.action(saveUser, {
  singleFlight: { mode: "auto" },
});
```

The transport is a service — fetch by default, anything (WebSocket, IPC, test
stub) by layer.

### Optimistic updates

```ts
const countAtom = Atom.make(0).pipe(Atom.withOptimistic());

yield* countAtom.withEffect((prev) => prev + 1, api.incrementCount());
// UI updates instantly; clears on success, rolls back on failure or defect.
```

Richer flows use the builder — `Component.optimistic(source).action({
update, effect, reconcile, reactivityKeys, singleFlight })` — whose handle
exposes `value`, `committed`, `hasOptimistic`, and `rollback()`.

## 6. Server: typed routes, documents, hydration

```ts
const SaveApi = ServerRoute.json().pipe(
  ServerRoute.method("POST"),
  ServerRoute.path("/api/save"),
  ServerRoute.body(MyDataSchema),
  ServerRoute.handle(({ body }) => saveToDb(body)),
);

const Document = ServerRoute.document(appRoutes); // full HTML + loader payload

ServerRoute.dispatch([SaveApi, Document], request, { layer: AppLive });
```

Every request part — params, query, form, body, headers, cookies — decodes
through schemas into one typed handler input. `ServerRoute.redirect` and
`ServerRoute.notFound` are typed control flow.

Hydration is explicit: `dehydrate(registry, entries)` on the server,
`hydrate(registry, payload, resolvers, { strict: true })` on the client
*before* mount — zero-flicker first render, typed `HydrationError` on
client/server mismatch, and you choose exactly which atoms cross the boundary.

## 7. Context is layers

```ts
const dispose = Component.mount(App, {
  props: {},
  target: document.getElementById("app")!,
  layer: Layer.mergeAll(ApiLive, ThemeLive, Reactivity.live),
});
```

- Forget a provider → compile error (`Component.withLayer` subtracts from
  `Req`).
- Services close when their subtree unmounts (scoped finalizers).
- Testing = swap the layer (`Reactivity.test`, mock services).

## Type architecture

Every async value carries three axes — `A` (value), `E` (typed error), `R`
(requirements) — and they flow: a service used in a loader appears in the
route's `Req`; a query that can fail with `ApiError` renders as
`Result<User[], ApiError>`; providing a layer subtracts from `R`. Extraction
helpers (`Atom.ValueOf`, `Component.Requirements`, `RouteLoaderDataOf`, ...)
recover any of it anywhere.

## Using it inside an existing app

The runtime is self-contained — mount an AF-UI tree inside a React (or
anything) component the way you'd mount a D3 chart, and adopt incrementally:
atoms first, components where contracts pay off.

## When not to use this

- **Your team isn't investing in Effect.** The type system is the product;
  without fluency in `Effect.gen`, layers, and typed errors you pay the
  learning curve without collecting the payoff.
- **You need a mature component ecosystem today.** The behavior pack covers
  core headless primitives, not a shadcn-sized catalog.
- **It's a small static site or a throwaway prototype.** Contracts and typed
  services earn their cost in long-lived apps with real state, not landing
  pages.

What you don't give up: incremental adoption inside an existing app, and SSR
(hydration, streaming loaders, single flight are first-class).

## Learn more

- `docs/README.md` — docs map and current golden paths
- `docs/afui.md` — the full narrative: inside-out model, runtime, routing
- `docs/SLOT_CONTRACT_GOLDEN_PATH.md` — the authored component shape
- `docs/component.md`, `docs/view.md`, `docs/style.md`, `docs/router.md` —
  current focused guides for the main subsystems
- `docs/SERVICES_AND_LAYERS.md` — dependency injection, provision tiers, request scoping
- `docs/API.md` — API reference
- `docs/TESTING.md` — DOM-free test harness, layer swapping, `Reactivity.test`
- `docs/V1_SCOPE.md` — what v1 ships and what is deliberately deferred
- `examples/` — router golden path, single flight (custom + fetch transport),
  styled combobox, optimistic counter, SSR hydration

## Status

Pre-release, breaking-change-first redesign track. The API shown here is the
current shipped surface; names from older docs/posts (e.g.
`ServerRoute.make("json")`, `AsyncResult`, `Atom.fn`) are gone. See
`CHANGELOG.md` and `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md`.

## Events

`Event` is a thin typed contract over Effect `PubSub`, not a replacement event
system. Use it when a named in-process fact crosses module boundaries; use
direct `PubSub` for private service-local channels. Provide the channel through
the same application Layer used by components and atoms, publish with
`Event.publish`, and consume with `Event.stream` plus normal Effect `Stream`
operators or `Component.subscription`.
