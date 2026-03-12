[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/doeixd/effect-atom-jsx)

# effect-atom-jsx

Fine-grained reactive JSX runtime powered by Effect v4. Combines **effect-atom style state management**, a **dom-expressions JSX runtime**, and **Effect v4 service integration** into a single, cohesive framework.

```bash
npm i effect-atom-jsx effect@^4.0.0-beta.29
```

> Targets `effect@^4.0.0-beta.29`

## Overview

```
effect-atom-jsx = Effect v4 services + Atom/Registry state + dom-expressions JSX
```

- **Local state** via `Atom` / `AtomRef` — reactive graph primitives (`Registry` available for advanced/manual control)
- **Async state** via `defineQuery` / `atomEffect` / `Atom.fromResource` — Effect fibers with automatic cancellation
- **Mutations** via `defineMutation` / `createOptimistic` — optimistic UI with rollback
- **Testing** via `renderWithLayer` / `withTestLayer` / `mockService` — DOM-free test harness
- **Form validation** via `AtomSchema` — Schema-driven reactive fields with touched/dirty tracking
- **SSR** via `renderToString` / `hydrateRoot` — server-side rendering with hydration
- **Debug** via `AtomLogger` — structured logging for atom reads/writes

## Quick Start

### 1. Configure Babel

```json
{
  "plugins": [
    ["babel-plugin-jsx-dom-expressions", {
      "moduleName": "effect-atom-jsx",
      "contextToCustomElements": true
    }]
  ]
}
```

### 2. Write a component

Components are plain functions that run once. Reactive expressions in JSX update only the specific DOM nodes that depend on them.

```tsx
import { Atom, render } from "effect-atom-jsx";

function Counter() {
  const count = Atom.make(0);
  const doubled = Atom.make((get) => get(count) * 2);

  return (
    <div>
      <p>Count: {count()} (doubled: {doubled()})</p>
      <button onClick={() => count.update((c) => c + 1)}>+</button>
    </div>
  );
}

render(() => <Counter />, document.getElementById("root")!);

// Vite HMR helper (optional):
// const hot = (import.meta as ImportMeta & { hot?: ViteHotContext }).hot;
// renderWithHMR(() => <Counter />, document.getElementById("root")!, hot);
```

### 3. Add Effect services

```tsx
import { Effect, Layer, ServiceMap } from "effect";
import { createMount, useService, defineQuery, Async } from "effect-atom-jsx";

const Api = ServiceMap.Service<{
  readonly load: () => Effect.Effect<number>;
}>("Api");

const ApiLive = Layer.succeed(Api, {
  load: () => Effect.succeed(42),
});

function App() {
  const data = defineQuery(() => useService(Api).load(), { name: "app-data" });

  return (
    <Async
      result={data.result()}
      loading={() => <p>Loading...</p>}
      success={(value) => <p>Loaded: {value}</p>}
    />
  );
}

const mountApp = createMount(ApiLive);
mountApp(() => <App />, document.getElementById("root")!);
```

## Core Concepts

### Term Map (In Context)

- `Atom`: core reactive unit; callable read (`count()`) plus write methods on writable atoms (`set`/`update`/`modify`).
- `derived atom`: read-only atom computed from other atoms (`Atom.make((get) => ...)` or `Atom.derived(...)`).
- `Query`: reactive async read (`defineQuery`), returns a `QueryRef` with `result`, `pending`, `latest`, `effect`, `invalidate`.
- `Mutation`: callback-style async write (`defineMutation`), returns handle with `run`, `effect`, `result`, `pending`.
- `Action`: linear runtime-bound write (`Atom.runtime(layer).action(...)`), preferred service mutation path.
- `Result`: primary async state model (`Loading` / `Refreshing` / `Success` / `Failure` / `Defect`).
- `Effect` (capital E): typed effect program from the `effect` package (`Effect<A, E, R>`).
- `effect(...)` methods (lowercase): bridge helpers that expose state handles as `Effect` programs (`query.effect()`, `mutation.effect(input)`, `action.effect(input)`).
- `Ref` (`AtomRef`): object/collection-focused reactive state with property-level access (`ref.prop("x")`) and callable reads (`ref()`).
- `Optimistic`: temporary overlay on top of a source value (`createOptimistic`) used for immediate UI before async confirmation.
- `Store`: not a separate top-level primitive in this package; use `AtomRef` or `Atom.projection(...)` for object/draft-style state.

### Type Architecture (A / E / R)

If you use Effect heavily, this is the key model:

- `A` = success value type
- `E` = typed error channel
- `R` = required services/context

`Effect` values always carry all three: `Effect<A, E, R>`.

```tsx
import { Effect, Schedule } from "effect";
import { Atom, Async } from "effect-atom-jsx";

// Effect<User[], HttpError, Api>
const usersEffect = Effect.gen(function* () {
  const api = yield* Api;
  return yield* api.listUsers();
});

const apiRuntime = Atom.runtime(ApiLive);

// Runtime binding satisfies R (Api), so resulting atom is runtime-bound.
const users = apiRuntime.atom(usersEffect);

// You can annotate with public aliases when you want explicitness:
// const users: Atom.AsyncAtom<User[], HttpError> = apiRuntime.atom(usersEffect);

// users() -> Result<User[], HttpError>
// users.effect() -> Effect<User[], HttpError | BridgeError>

// Dependency-aware runtime atom composition
const profile = apiRuntime.atom((get) =>
  Effect.gen(function* () {
    const xs = yield* get.result(users);
    return xs.length;
  }),
);
```

`Atom.runtime(layer)` accepts any effect whose requirements are a subset of the runtime layer output (`RReq extends R`).

How this appears in UI:

```tsx
<Async
  result={users()}
  error={(e) => <ErrorView error={e} />} // e includes your typed E (e.g. HttpError)
  success={(xs) => <UserList users={xs} />}
/>
```

Writable vs read-only state:

- Writable atoms (`Atom.make(value)`, `Atom.value(value)`) expose `set`/`update`/`modify`.
- Derived atoms (`Atom.make((get) => ...)`, `Atom.derived(...)`) are read-only.

### Golden Path (Current)

For most apps, start with this stack:

- Local state: `Atom.make` / `Atom.value` / `Atom.derived`
- Service/runtime wiring: `Atom.runtime(layer)` for service-bound atoms/actions (preferred)
- Ambient runtime alternative: `createMount(layer)` + `useService(Tag)`
- Async reads: `defineQuery(...)`
- Writes: `Atom.runtime(...).action(...)` (primary) or `defineMutation(...)` (callback alternative)
- Optimistic UX: `createOptimistic(...)`
- Async UI rendering: `Async`, `Loading`, `Errored`

For runtime-bound atom APIs, prefer:

- `Atom.runtime(layer).atom(...)` for reads
- `Atom.runtime(layer).action(...)` for writes (linear Effect flow)
- `Atom.effect(...)` for standalone async atoms

Batching uses microtask mode by default. Use `flush()` when you need immediate deterministic commit ordering.

Everything else (`scoped*` constructors, explicit registries outside components, deep runtime helpers) is advanced.

### Atom & Registry — Local State

Atoms are reactive values. Most component code uses callable atoms directly. `Registry` is for advanced/manual control.

```ts
import { Effect } from "effect";
import { Atom } from "effect-atom-jsx";
import * as Registry from "effect-atom-jsx/Registry";

const count = Atom.make(0);
const doubled = Atom.map(count, (n) => n * 2);
const callback = Atom.value((n: number) => n + 1);

// Callable atoms are the default read/write path in components
count.set(3);
console.log(doubled()); // 6

// Atom also exposes Effect-based helpers
Effect.runSync(Atom.update(count, (n) => n + 1));
```

All Effect helpers (`get`, `set`, `update`, `modify`) support both data-first and data-last (pipeable) forms.

`Registry` remains available for advanced/manual control. `Registry.useRegistry()` returns an ambient registry scoped to the current reactive owner (component/root) and auto-disposes it on cleanup. For explicit standalone usage (tests, scripts, server handlers), use `Registry.make()`.

`useService(...)` diagnostics include actionable mount/layer guidance and best-effort available-service hints when a service is missing.

`Atom.make(...)` disambiguation:

- `Atom.make(value)` -> writable atom
- `Atom.make((get) => ...)` -> derived read-only atom
- `Atom.value(value)` -> explicit writable atom (including function values)
- `Atom.derived((get) => ...)` -> explicit derived atom

### Runtime-Bound Atoms (Primary Service Pattern)

```tsx
import { Effect, Layer, ServiceMap } from "effect";
import { Atom, Async, For, isPending, latest, Show } from "effect-atom-jsx";

const Api = ServiceMap.Service<{
  readonly listUsers: () => Effect.Effect<ReadonlyArray<{ id: string; name: string }>>;
  readonly addUser: (name: string) => Effect.Effect<void>;
}>("Api");

const ApiLive = Layer.succeed(Api, {
  listUsers: () => Effect.succeed([{ id: "1", name: "Alice" }, { id: "2", name: "Bob" }]),
  addUser: (_name: string) => Effect.void,
});

const apiRuntime = Atom.runtime(ApiLive);

const users = Atom.withReactivity(
  apiRuntime.atom(
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.listUsers();
    }),
  ),
  ["users"],
);

const addUser = apiRuntime.action(
  Effect.fn(function* (name: string) {
    const api = yield* Api;
    yield* api.addUser(name);
  }),
  {
    name: "add-user",
    reactivityKeys: ["users"],
    onTransition: ({ phase }) => {
      if (phase === "failure" || phase === "defect") {
        console.warn("add-user failed");
      }
    },
  },
);

// Typed composition path
const addUserProgram = addUser.effect("Charlie");
const usersProgram = users.effect();

function UsersView() {
  const refreshing = isPending(users);
  const latestUsers = latest(users);
  return (
    <>
      <Show when={refreshing()}>
        <p>Refreshing...</p>
      </Show>
      <Show when={latestUsers()}>
        {(xs) => <p>Showing {xs().length} cached users while revalidating.</p>}
      </Show>
      <Async
        result={users()}
        loading={() => <p>Loading...</p>}
        success={(xs) => (
          <ul><For each={xs}>{(u) => <li>{u().name}</li>}</For></ul>
        )}
      />
      <button onClick={() => addUser("Charlie")}>Add</button>
    </>
  );
}
```

`isPending(resultAccessor)` returns `Accessor<boolean>` and is true only during `Refreshing`.
`latest(resultAccessor)` returns `Accessor<A | undefined>` with the last successful value.

How this flow maps to concepts:

- `users` is an async atom (query-like read) whose value is `Result<User[], E>`.
- `addUser` is an action (write) that runs an `Effect` and invalidates logical reactivity keys.
- `Async` handles first load; `isPending` + `latest` handle stale-while-revalidate updates.
- `users.effect()` / `addUser.effect(...)` are composition bridges when you need pure `Effect` programs.

### Atom.family with Eviction

Use `Atom.family` for keyed atom factories. Entries are cached by key until explicitly evicted.

```ts
const userAtom = Atom.family((id: string) =>
  apiRuntime.atom(
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.findUser(id);
    }),
  ),
);

const a = userAtom("user-1");
const b = userAtom("user-2");

userAtom.evict("user-1"); // remove one cached entry
userAtom.clear(); // remove all cached entries

// In components, evict key-scoped entries on unmount when appropriate
import { onCleanup } from "effect-atom-jsx/advanced";
function UserCard(props: { id: string }) {
  const user = userAtom(props.id);
  onCleanup(() => userAtom.evict(props.id));
  return (
    <Async
      result={user()}
      loading={() => <div>Loading user...</div>}
      success={(u) => <div>{u.name}</div>}
    />
  );
}
```

In long-running SPAs, use `evict`/`clear` to avoid unbounded family cache growth.
`Atom.family` also supports multiple key parts (`family((a, b) => ...)` with `evict(a, b)`).
For structural keys, pass custom equality: `Atom.family(factory, { equals: (a, b) => ... })`.

### AtomRef — Object State

`AtomRef` provides per-property reactive access to objects and arrays.

```ts
import { AtomRef } from "effect-atom-jsx";

const todo = AtomRef.make({ title: "Write docs", done: false });
const title = todo.prop("title");

console.log(todo()); // { title: "Write docs", done: false }
console.log(title()); // "Write docs"
title.set("Ship release notes");
console.log(title()); // "Ship release notes"

// Collections for arrays
const list = AtomRef.collection([
  { id: 1, text: "Buy milk" },
  { id: 2, text: "Write tests" },
]);
list.push({ id: 3, text: "Deploy" });
console.log(list.toArray().length); // 3
```

`todo.prop("title")` returns an `AtomRef<string>` (not an `Atom` directly). Primary read style is callable (`title()`).
For atom-graph interop (`Atom.map`, etc.), use `AtomRef.toAtom(title)`.

```ts
const titleAtom = AtomRef.toAtom(title);
const upper = Atom.map(titleAtom, (s) => s.toUpperCase());

const titleQuery = defineQuery(() => Effect.succeed(titleAtom()), { name: "title" });
```

`get.result(...)` expects an atom carrying `Result`/`FetchResult`; use `AtomRef.toAtom(...)` for value-level interop first.

### Advanced: defineQuery / atomEffect / Result

Both create reactive async computations backed by Effect fibers. When tracked dependencies change, the previous fiber is interrupted and a new one starts.

```tsx
import { Effect } from "effect";
import { atomEffect, defineQuery, useService } from "effect-atom-jsx";
import { Result, Async } from "effect-atom-jsx/advanced";

// atomEffect — standalone, no runtime needed
const time = atomEffect(() =>
  Effect.succeed(new Date().toISOString()).pipe(Effect.delay("1 second"))
);

// defineQuery — uses ambient Layer runtime from mount()
const data = defineQuery(() => useService(Api).load(), { name: "data" });

const users = defineQuery(() => useService(Api).listUsers(), {
  name: "users",
  retrySchedule: Schedule.exponential("1 second").pipe(Schedule.compose(Schedule.recurs(3))),
  pollSchedule: Schedule.spaced("30 seconds"),
});

// Pattern-match on the result in JSX
<Async
  result={data.result()}
  loading={() => <p>Loading...</p>}
  error={(e) => <p>Error: {e.message}</p>}
  success={(value) => <p>{value}</p>}
/>
```

**Key difference:** `defineQuery` uses the ambient runtime injected by `mount()`, while `atomEffect` runs Effects directly (or accepts an explicit runtime parameter).

`defineQuery` supports Phase E scheduling/observability options:

- `retrySchedule`: retry typed failures before settling
- `pollSchedule`: periodic invalidation/polling via Effect schedule
- `onTransition` and `observe`: lightweight execution hooks for tracing/metrics

For ergonomic key + invalidation wiring, pass `query.key` into `defineMutation({ invalidates })`.

#### `Result` state mapping defaults

`Async` supports all `Result` states:

- `Loading` -> `loading()`
- `Refreshing(previous)` -> `refreshing(previous)` if provided, otherwise reuses the settled previous renderer
- `Success(value)` -> `success(value)`
- `Failure(error)` -> `error(error)` if provided, otherwise `null`
- `Defect(cause)` -> `defect(cause)` if provided, otherwise `null`

If you want defects or typed failures to escalate globally, leave local handlers undefined and use boundaries at higher levels.



### Advanced Compatibility: FetchResult

Use `Result` as the default async model. `FetchResult` is an advanced compatibility model.

| Type | Module | Used by | Purpose |
|------|--------|---------|---------|
| `Result<A, E>` | `effect-ts.ts` | Default | Unified async state (Loading / Refreshing / Success / Failure / Defect) |
| `FetchResult<A, E>` | `Result.ts` | Advanced compat | Data-fetching state (Initial / Success / Failure) with waiting flag |

Convert between them with `FetchResult.fromResult()` and `FetchResult.toResult()`.

Important: conversion is useful but not semantically identical in every state. `Result` carries explicit fiber-lifecycle states (`Loading`, `Refreshing`, `Defect`) while `FetchResult` models data-centric waiting semantics. Treat conversion as an interop bridge, not a one-to-one state machine equivalence.

For explicit non-suspense rendering, use `FetchResult.builder(...)`:

```tsx
const view = FetchResult.builder(FetchResult.fromResult(users()))
  .onInitial(() => <Spinner />)
  .onFailure((cause) => <ErrorCard cause={cause} />)
  .onSuccess((data, { waiting }) => (
    <>
      {waiting && <RefreshIndicator />}
      <For each={data}>{(u) => <li>{u().name}</li>}</For>
    </>
  ))
  .render();
```

`Result` is **Exit-first internally** — each settled state (`Success`, `Failure`, `Defect`) carries a `.exit` field holding the canonical Effect `Exit`. This enables lossless round-trips and integration with Effect's error model. Combinators `Result.match`, `.map`, `.flatMap`, `.getOrElse`, and `.getOrThrow` are available for ergonomic pattern matching and transformation.

### Mutations: Linear First

Prefer linear write flows with `Atom.runtime(layer).action(...)` when working with services.

```ts
import { Effect } from "effect";
import { Atom, createOptimistic } from "effect-atom-jsx";

const optimisticUsers = createOptimistic(users);

const addUser = apiRuntime.action(
  Effect.fn(function* (name: string) {
    optimisticUsers.set((prev) => [...prev, { id: "optimistic", name }]);
    const api = yield* Api;
    yield* api.addUser(name);
  }),
  {
    reactivityKeys: ["users"],
    onError: () => optimisticUsers.clear(),
    onSuccess: () => optimisticUsers.clear(),
  },
);
```

Use `defineMutation(...)` when you want callback-style lifecycle hooks.

```ts
import { Effect } from "effect";
import { Atom, createOptimistic, defineMutation } from "effect-atom-jsx";

const savedCount = Atom.make(0);
const optimistic = createOptimistic(savedCount);

const save = defineMutation(
  (next: number) => Effect.succeed(next).pipe(Effect.delay("250 millis")),
  {
    optimistic: (next) => optimistic.set(next),
    rollback: () => optimistic.clear(),
    onSuccess: (next) => {
      optimistic.clear();
      savedCount.set(next);
    },
  },
);

// Typed composition path
const saveProgram = save.effect(10);

save.run(10);
console.log(optimistic()); // 10 immediately
```

### defineMutation — Callback Alternative

Composition summary:

- `defineQuery(...).effect()` returns `Effect<A, E | BridgeError>`
- `defineMutation(...).effect(input)` returns `Effect<void, E | BridgeError | MutationSupersededError>`
- `Atom.runtime(...).action(...).effect(input)` returns `Effect<void, E | BridgeError | MutationSupersededError>`
- `Atom.runtime(...).action(...).runEffect(input)` returns `Effect<A, E | BridgeError | MutationSupersededError>` (preserves action success value)
- `Atom.result(atom)` converts result-like atoms into typed `Effect` values for pipelines

`BridgeError` is tagged (`ResultLoadingError` | `ResultDefectError`) so composition errors stay explicit in the Effect error channel.

### AtomSchema — Form Validation

Wraps atoms with Effect Schema for reactive validation with form state tracking.

```ts
import { Schema, Effect, Option } from "effect";
import { Atom, AtomSchema } from "effect-atom-jsx";

const ageField = AtomSchema.makeInitial(Schema.Int, 25);

// Each field provides reactive accessors
ageField.value;   // Atom<Option<number>> — parsed value
ageField.error;   // Atom<Option<SchemaError>> — validation error
ageField.isValid; // Atom<boolean>
ageField.touched; // Atom<boolean> — modified since creation?
ageField.dirty;   // Atom<boolean> — differs from initial?

// Write invalid input
Effect.runSync(Atom.set(ageField.input, 1.5));
Effect.runSync(Atom.get(ageField.isValid)); // false

// Reset everything
ageField.reset(); // restores initial value, clears touched

const profile = AtomSchema.struct({
  age: AtomSchema.makeInitial(Schema.Int, 25),
  score: AtomSchema.makeInitial(Schema.Int, 10),
});
profile.isValid();
profile.touch();
profile.input.set({ age: 30, score: 11 });
profile.values(); // Accessor<Option<{ age: number; score: number }>>

const address = AtomSchema.struct({
  city: AtomSchema.makeInitial(Schema.String, ""),
  zip: AtomSchema.makeInitial(Schema.Int, 12345),
});
const userForm = AtomSchema.struct({
  profile,
  address,
});
userForm.reset();
```

### AtomLogger — Debug Tracking

Structured logging for atom reads and writes using Effect's Logger.

```ts
import { Effect } from "effect";
import { Atom, AtomLogger } from "effect-atom-jsx";

const count = Atom.make(0);

// Wrap to automatically log all reads/writes
const traced = AtomLogger.tracedWritable(count, "count");
// logs: atom:read { atom: "count", op: "read", value: "0" }
// logs: atom:write { atom: "count", op: "write", value: "5" }

// Effect-based logging
Effect.runSync(AtomLogger.logGet(count, "count"));

// Capture state snapshot
const snap = Effect.runSync(
  AtomLogger.snapshot([["count", count], ["other", otherAtom]])
);
// { count: 0, other: "hello" }
```

### fromStream / fromQueue / fromSchedule — Streaming Atoms

Create atoms whose values are continuously updated from Effect Streams or Queues.

```ts
import { Stream, Queue, Effect, Schedule } from "effect";
import { Atom } from "effect-atom-jsx";

// Atom fed by a Stream — starts a fiber on first read
const prices = Atom.fromStream(
  Stream.fromIterable([10, 20, 30]),
  0, // initial value
);

// Atom fed by a Queue
const queue = Effect.runSync(Queue.unbounded<string>());
const messages = Atom.fromQueue(queue, "");

// Atom fed by a Schedule (via Stream.fromSchedule)
const ticks = Atom.fromSchedule(Schedule.recurs(3), 0 as any);

// Stream recipe for UI text inputs (trim + length filtering)
const rawInput = Stream.make("  hello  ", " ", "x", " world ");
const queryInput = Atom.Stream.textInput(rawInput, { minLength: 2 });

// Search-box recipe (text normalization + optional dedupe)
const searchTerms = Atom.Stream.searchInput(rawInput, {
  minLength: 2,
  lowercase: true,
});

// Both helpers return Effect Streams, so compose them into atoms.
function SearchBox() {
  const [input, setInput] = createSignal("");
  const results = Atom.fromStream(
    Atom.Stream.searchInput(inputToStream(input), { minLength: 2, lowercase: true }),
    [] as ReadonlyArray<string>,
  );
  return <input onInput={(e) => setInput((e.currentTarget as HTMLInputElement).value)} />;
}
```

### Server-Side Rendering

Render components to HTML strings on the server and hydrate on the client.

```ts
import {
  renderToString, hydrateRoot, isServer,
  setRequestEvent, getRequestEvent,
} from "effect-atom-jsx";
import { Hydration, Atom } from "effect-atom-jsx";
import * as Registry from "effect-atom-jsx/Registry";

// ─── Server ─────────────────────────────────────────────────────
setRequestEvent({ url: req.url, headers: req.headers });

const html = renderToString(() => <App />);

// Serialize atom state for the client
const registry = Registry.make();
const state = Hydration.dehydrate(registry, [
  ["count", countAtom],
  ["user", userAtom],
]);

res.send(`
  <div id="root">${html}</div>
  <script>window.__STATE__ = ${JSON.stringify(state)}</script>
`);

// ─── Client ─────────────────────────────────────────────────────
// Restore atom state from server
Hydration.hydrate(registry, window.__STATE__, {
  count: countAtom,
  user: userAtom,
});

// Optional validation hooks for development diagnostics:
Hydration.hydrate(registry, window.__STATE__, { count: countAtom, user: userAtom }, {
  onUnknownKey: (key) => console.warn("Unknown hydration key:", key),
  onMissingKey: (key) => console.warn("Missing hydration key:", key),
});

// Attach reactivity to existing DOM
const dispose = hydrateRoot(() => <App />, document.getElementById("root")!);
```

## Control-Flow Components

JSX components for declarative conditional and list rendering:

| Component | Purpose | Example |
|-----------|---------|---------|
| `Show` | Conditional rendering | `<Show when={show()}><p>Visible</p></Show>` |
| `For` | List rendering with keying | `<For each={items()}>{(item) => <li>{item}</li>}</For>` |
| `Async` | Result pattern matching | `<Async result={r} loading={...} success={...} />` |
| `Loading` | Show content while loading | `<Loading when={result}><Spinner /></Loading>` |
| `Errored` | Show content on error | `<Errored result={r}>{(e) => <p>{e}</p>}</Errored>` |
| `Switch` / `Match` | Multi-case matching | `<Switch><Match when={a()}>A</Match>...</Switch>` |
| `MatchTag` | Type-safe `_tag` matching | `<MatchTag value={r} cases={{ Success: ... }} />` |
| `Optional` | Render when value is truthy | `<Optional when={val()}>{(v) => <p>{v}</p>}</Optional>` |
| `MatchOption` | Match Effect Option | `<MatchOption value={opt} some={(v) => ...} />` |
| `Dynamic` | Dynamic component selection | `<Dynamic component={Comp} ...props />` |
| `WithLayer` | Provide a Layer boundary | `<WithLayer layer={DbLive}>...</WithLayer>` |
| `Frame` | Animation frame loop | `<Frame>{() => <canvas />}</Frame>` |

## API Reference

### Namespace Modules

Primary modules are available as top-level namespace imports; advanced modules like `Registry` are deep-imported:

```ts
// Namespace import
import { Atom, AtomRef, Result, Hydration } from "effect-atom-jsx";
import { FetchResult } from "effect-atom-jsx"; // optional advanced compatibility
import { AtomSchema, AtomLogger, AtomRpc, AtomHttpApi } from "effect-atom-jsx";

// Deep imports
import * as Atom from "effect-atom-jsx/Atom";
import * as AtomSchema from "effect-atom-jsx/AtomSchema";
import * as Registry from "effect-atom-jsx/Registry";
```

| Module | Key Exports |
|--------|-------------|
| `Atom` | `make`, `readable`, `writable`, `family`, `map`, `withFallback`, `projection`, `projectionAsync`, `withReactivity`, `invalidateReactivity`, `keepAlive`, `runtime`, `action`, `effect`, `pull`, `Stream.*` (advanced OOO helpers), `searchParam`, `kvs`, `flush`, `get`, `set`, `update`, `modify`, `refresh`, `subscribe`, `fromStream`, `fromQueue`, `query` |
| `AtomRef` | `make`, `collection` |
| `Registry` | `make` (returns instance with `get`, `set`, `update`, `modify`, `mount`, `refresh`, `subscribe`, `reset`, `dispose`) |
| `Result` | `loading`, `refreshing`, `success`, `failure`, `defect`, `match`, `map`, `flatMap`, `getOrElse`, `getOrThrow` |
| `FetchResult` | `initial`, `success`, `failure`, `isInitial`, `isSuccess`, `isFailure`, `isWaiting`, `fromResult`, `toResult`, `map`, `flatMap`, `match`, `all` |
| `Hydration` | `dehydrate`, `hydrate`, `toValues` |
| `AtomSchema` | `make`, `makeInitial`, `path`, `HtmlInput` |
| `AtomLogger` | `traced`, `tracedWritable`, `logGet`, `logSet`, `snapshot` |
| `AtomRpc` | `Tag()` factory with `query`, `mutation`, `refresh` |
| `AtomHttpApi` | `Tag()` factory with grouped `query`, `mutation`, `refresh` |

### Effect Integration

```ts
import {
  defineQuery, createQueryKey, invalidate,
  isPending, latest,
  createOptimistic, defineMutation,
  useService, useServices, createMount, mount,
} from "effect-atom-jsx";

import {
  atomEffect,
  layerContext,
  scopedRootEffect,
  scopedQueryEffect,
  scopedMutationEffect,
  Result, Async,
} from "effect-atom-jsx/advanced";
```

### Reactive Core (Internals / Advanced)

```ts
import {
  createSignal, createEffect, createMemo, createRoot,
  createContext, useContext,
  onCleanup, onMount,
  untrack, sample, flush,
  mergeProps, splitProps,
  getOwner, runWithOwner,
} from "effect-atom-jsx/advanced";
```

`batch(...)` remains available for low-level runtime internals, but app code should rely on default microtask batching and use `flush()` only when deterministic sync ordering is required.

Full API reference: [`docs/API.md`](docs/API.md)

Dedicated Effect integration guide: [`docs/ACTION_EFFECT_USE_RESOURCE.md`](docs/ACTION_EFFECT_USE_RESOURCE.md)

Effect-atom migration/equivalents guide: [`docs/EFFECT_ATOM_EQUIVALENTS.md`](docs/EFFECT_ATOM_EQUIVALENTS.md)

Architecture decisions (in progress): `docs/adr/`

## Examples

| Example | Location | What it shows |
|---------|----------|---------------|
| Counter | `examples/counter/` | Signals, atoms, Registry, async data with `atomEffect` |
| Projection | `examples/projection/` | `Atom.projection` + `Atom.projectionAsync` with `Async` rendering |
| OOO Async | `examples/ooo-async/` | `Atom.pull` + OOO chunk merge, rendered via `Async`, `Loading`, and `Errored` |
| TodoMVC | `examples/todomvc/` | Full app with `defineQuery`, `defineMutation`, optimistic UI, service injection |
| RPC & HTTP API | `examples/rpc-httpapi/` | `AtomRpc.Tag()`, `AtomHttpApi.Tag()`, `MatchTag` component |
| Schema Form | `examples/schema-form/` | `AtomSchema` validation, touched/dirty/reset, `AtomLogger.snapshot` |
| SSR | `examples/ssr/` | `renderToString`, `hydrateRoot`, `Hydration.dehydrate/hydrate` |

## How It Works

1. **`Atom.runtime(layer)`** creates a runtime-bound API for reads (`runtime.atom`) and writes (`runtime.action`)
2. Effects inside runtime-bound atoms/actions resolve services via Effect context (`yield* Api`) with requirements satisfied by the bound layer
3. **`defineQuery()` / `atomEffect()`** run async effects reactively, exposing `Result` state
4. **`defineMutation()`** remains the callback-style mutation alternative (optimistic/rollback hooks)
5. Component lifetimes are scope-backed: mount/root and component boundaries map to Effect scopes so parent disposal interrupts descendant fibers transitively
6. **`createMount(layer)` + `useService(Tag)`** remain the ambient-runtime alternative for simpler trees
7. **`scopedRootEffect()` / `scopedQueryEffect()` / `scopedMutationEffect()`** are advanced Effect-first lifetime constructors
8. Babel compiles JSX to **dom-expressions** helpers — reactivity updates only the affected DOM nodes

## Testing

DOM-free test harness via `effect-atom-jsx/testing`:

```ts
import { Effect } from "effect";
import { Atom, defineQuery, defineMutation, useService } from "effect-atom-jsx";
import { withTestLayer, renderWithLayer, mockService } from "effect-atom-jsx/testing";

const ApiMock = mockService(Api, {
  load: () => Effect.succeed(42),
  save: (_n: number) => Effect.void,
});

// Option 1: runtime-first testing (primary)
const testRuntime = Atom.runtime(ApiMock);
const users = testRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.load();
  }),
);
await Effect.runPromise(Atom.result(users));
await testRuntime.dispose();

// Option 2: withTestLayer — manual ambient runtime execution
const harness = withTestLayer(ApiMock);
const result = harness.run(() => defineQuery(() => useService(Api).load(), { name: "load" }));
await harness.tick();
await harness.dispose();

// Option 3: renderWithLayer — runs UI immediately
const harness2 = renderWithLayer(ApiMock, () => {
  const save = defineMutation((n: number) => useService(Api).save(n));
  save.run(42);
});
await harness2.tick();
await harness2.dispose();
```

> See [`docs/TESTING.md`](docs/TESTING.md) for the full testing guide.

## `flush()` Escape Hatch

Microtask batching is the default. Use `flush()` only when imperative DOM work needs synchronous commit ordering.

```tsx
import { Atom } from "effect-atom-jsx";

function handleSubmit(button: HTMLButtonElement) {
  const submitted = Atom.make(false);
  submitted.set(true);
  Atom.flush();
  button.focus();
}
```

## Relationship to `@effect-atom/atom`

This project provides an effect-atom-like ergonomic surface, implemented natively for Effect v4.

- **Same:** namespace-style API (`Atom`, `Result`, `Registry`, `AtomRef`), atom graph patterns, waiting/revalidation async model
- **Different:** native implementation tuned for JSX + dom-expressions, targets Effect v4 beta (vs v3)
- **Guidance:** if you already think in effect-atom terms, this API should feel familiar. Prefer `defineQuery` / `defineMutation` / `createMount` for Effect service integration.



## Compatibility

- Runtime: Effect v4 beta (`effect@^4.0.0-beta.29`)
- JSX: `dom-expressions` via `effect-atom-jsx/runtime`
- Test: `npm test` / Typecheck: `npm run typecheck` / Build: `npm run build`
