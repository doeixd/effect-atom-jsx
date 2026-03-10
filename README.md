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

- **Local state** via `Atom` / `Registry` / `AtomRef` — reactive graph primitives
- **Async state** via `queryEffect` / `atomEffect` / `Atom.fromResource` — Effect fibers with automatic cancellation
- **Mutations** via `mutationEffect` / `createOptimistic` — optimistic UI with rollback
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
import { Atom, Registry, render } from "effect-atom-jsx";

function Counter() {
  const count = Atom.make(0);
  const registry = Registry.useRegistry();
  const doubled = Atom.map(count, (n) => n * 2);

  return (
    <div>
      <p>Count: {registry.get(count)} (doubled: {registry.get(doubled)})</p>
      <button onClick={() => registry.update(count, (c) => c + 1)}>+</button>
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
import { createMount, useService, queryEffect, Async } from "effect-atom-jsx";

const Api = ServiceMap.Service<{
  readonly load: () => Effect.Effect<number>;
}>("Api");

const ApiLive = Layer.succeed(Api, {
  load: () => Effect.succeed(42),
});

function App() {
  const data = queryEffect(() => useService(Api).load());

  return (
    <Async
      result={data()}
      loading={() => <p>Loading...</p>}
      success={(value) => <p>Loaded: {value}</p>}
    />
  );
}

const mountApp = createMount(ApiLive);
mountApp(() => <App />, document.getElementById("root")!);
```

## Core Concepts

### Golden Path (Current)

For most apps, start with this stack:

- Local state: `Atom.make` + component-local `Registry.make()`
- Service/runtime wiring: `createMount(layer)` + `useService(Tag)`
- Async reads: `defineQuery(...)` (or `queryEffect(...)` for lower-level control)
- Writes: `defineMutation(...)` (alias: `mutationEffect(...)`) + `createOptimistic(...)`
- Async UI rendering: `Async`, `Loading`, `Errored`

Everything else (`scoped*` constructors, explicit registries outside components, deep runtime helpers) is advanced.

### Atom & Registry — Local State

Atoms are reactive values. A `Registry` reads, writes, and subscribes to atoms.

```ts
import { Effect } from "effect";
import { Atom, Registry } from "effect-atom-jsx";

const count = Atom.make(0);
const doubled = Atom.map(count, (n) => n * 2);

// Registry provides the read/write context
const registry = Registry.useRegistry();
registry.set(count, 3);
console.log(registry.get(doubled)); // 6

// Atom also exposes Effect-based helpers
Effect.runSync(Atom.update(count, (n) => n + 1));
```

All Effect helpers (`get`, `set`, `update`, `modify`) support both data-first and data-last (pipeable) forms.

`Registry.useRegistry()` returns an ambient registry scoped to the current reactive owner (component/root) and auto-disposes it on cleanup. For explicit standalone usage (tests, scripts, server handlers), use `Registry.make()`.

### AtomRef — Object State

`AtomRef` provides per-property reactive access to objects and arrays.

```ts
import { AtomRef } from "effect-atom-jsx";

const todo = AtomRef.make({ title: "Write docs", done: false });
const title = todo.prop("title");

title.set("Ship release notes");
console.log(todo.value.title); // "Ship release notes"

// Collections for arrays
const list = AtomRef.collection([
  { id: 1, text: "Buy milk" },
  { id: 2, text: "Write tests" },
]);
list.push({ id: 3, text: "Deploy" });
console.log(list.toArray().length); // 3
```

### queryEffect & atomEffect — Async State

Both create reactive async computations backed by Effect fibers. When tracked dependencies change, the previous fiber is interrupted and a new one starts.

```tsx
import { Effect } from "effect";
import { atomEffect, queryEffect, useService, AsyncResult, Async } from "effect-atom-jsx";

// atomEffect — standalone, no runtime needed
const time = atomEffect(() =>
  Effect.succeed(new Date().toISOString()).pipe(Effect.delay("1 second"))
);

// queryEffect — uses ambient Layer runtime from mount()
const data = queryEffect(() => useService(Api).load());

// Pattern-match on the result in JSX
<Async
  result={data()}
  loading={() => <p>Loading...</p>}
  error={(e) => <p>Error: {e.message}</p>}
  success={(value) => <p>{value}</p>}
/>
```

**Key difference:** `queryEffect` / `defineQuery` uses the ambient runtime injected by `mount()`, while `atomEffect` runs Effects directly (or accepts an explicit runtime parameter).

For ergonomic key + invalidation wiring, prefer `defineQuery(...)` and pass `query.key` into `defineMutation({ invalidates })` (or `mutationEffect`).

#### `Async` state mapping defaults

`Async` supports all `AsyncResult` states:

- `Loading` -> `loading()`
- `Refreshing(previous)` -> `refreshing(previous)` if provided, otherwise reuses the settled previous renderer
- `Success(value)` -> `success(value)`
- `Failure(error)` -> `error(error)` if provided, otherwise `null`
- `Defect(cause)` -> `defect(cause)` if provided, otherwise `null`

If you want defects or typed failures to escalate globally, leave local handlers undefined and use boundaries at higher levels.



### AsyncResult vs Result

The library has two result types for different use cases:

| Type | Module | Used by | Purpose |
|------|--------|---------|---------|
| `AsyncResult<A, E>` | `effect-ts.ts` | `atomEffect`, `queryEffect` | UI async state (Loading / Refreshing / Success / Failure / Defect) |
| `Result<A, E>` | `Result.ts` | `AtomRpc`, `AtomHttpApi` | Data fetching state (Initial / Success / Failure) with waiting flag |

Convert between them with `Result.fromAsyncResult()` and `Result.toAsyncResult()`.

Important: conversion is useful but not semantically identical in every state. In particular, `AsyncResult` carries explicit fiber-lifecycle states (`Loading`, `Refreshing`, `Defect`) while `Result` models data-centric waiting semantics. Treat conversion as an interop bridge, not a one-to-one state machine equivalence.

`AsyncResult` is **Exit-first internally** — each settled state (`Success`, `Failure`, `Defect`) carries a `.exit` field holding the canonical Effect `Exit`. This enables lossless round-trips and integration with Effect's error model. Combinators `AsyncResult.match`, `.map`, `.flatMap`, `.getOrElse`, and `.getOrThrow` are available for ergonomic pattern matching and transformation.

### defineMutation / mutationEffect — Mutations

Handles writes with optimistic UI, rollback, and automatic refresh.

```ts
import { Effect } from "effect";
import { Atom, Registry, createOptimistic, mutationEffect } from "effect-atom-jsx";

const registry = Registry.make();
const savedCount = Atom.make(0);
const optimistic = createOptimistic(() => registry.get(savedCount));

const save = mutationEffect(
  (next: number) => Effect.succeed(next).pipe(Effect.delay("250 millis")),
  {
    optimistic: (next) => optimistic.set(next),
    rollback: () => optimistic.clear(),
    onSuccess: (next) => {
      optimistic.clear();
      registry.set(savedCount, next);
    },
  },
);

save.run(10);
console.log(optimistic.get()); // 10 immediately
```

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

### fromStream / fromQueue — Streaming Atoms

Create atoms whose values are continuously updated from Effect Streams or Queues.

```ts
import { Stream, Queue, Effect } from "effect";
import { Atom } from "effect-atom-jsx";

// Atom fed by a Stream — starts a fiber on first read
const prices = Atom.fromStream(
  Stream.fromIterable([10, 20, 30]),
  0, // initial value
);

// Atom fed by a Queue
const queue = Effect.runSync(Queue.unbounded<string>());
const messages = Atom.fromQueue(queue, "");
```

### Server-Side Rendering

Render components to HTML strings on the server and hydrate on the client.

```ts
import {
  renderToString, hydrateRoot, isServer,
  setRequestEvent, getRequestEvent,
} from "effect-atom-jsx";
import { Hydration, Registry, Atom } from "effect-atom-jsx";

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

// Attach reactivity to existing DOM
const dispose = hydrateRoot(() => <App />, document.getElementById("root")!);
```

## Control-Flow Components

JSX components for declarative conditional and list rendering:

| Component | Purpose | Example |
|-----------|---------|---------|
| `Show` | Conditional rendering | `<Show when={show()}><p>Visible</p></Show>` |
| `For` | List rendering with keying | `<For each={items()}>{(item) => <li>{item}</li>}</For>` |
| `Async` | AsyncResult pattern matching | `<Async result={r} loading={...} success={...} />` |
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

Each module is available as a namespace import and as a deep import:

```ts
// Namespace import
import { Atom, AtomRef, Registry, Result, Hydration } from "effect-atom-jsx";
import { AtomSchema, AtomLogger, AtomRpc, AtomHttpApi } from "effect-atom-jsx";

// Deep imports
import * as Atom from "effect-atom-jsx/Atom";
import * as AtomSchema from "effect-atom-jsx/AtomSchema";
```

| Module | Key Exports |
|--------|-------------|
| `Atom` | `make`, `readable`, `writable`, `family`, `map`, `withFallback`, `projection`, `projectionAsync`, `withReactivity`, `invalidateReactivity`, `keepAlive`, `runtime`, `fn`, `pull`, `Stream.*` (advanced OOO helpers), `searchParam`, `kvs`, `batch`, `get`, `set`, `update`, `modify`, `refresh`, `subscribe`, `fromStream`, `fromQueue`, `query` |
| `AtomRef` | `make`, `collection` |
| `Registry` | `make` (returns instance with `get`, `set`, `update`, `modify`, `mount`, `refresh`, `subscribe`, `reset`, `dispose`) |
| `Result` | `initial`, `success`, `failure`, `isInitial`, `isSuccess`, `isFailure`, `isWaiting`, `fromAsyncResult`, `toAsyncResult`, `map`, `flatMap`, `match`, `all` |
| `Hydration` | `dehydrate`, `hydrate`, `toValues` |
| `AtomSchema` | `make`, `makeInitial`, `path`, `HtmlInput` |
| `AtomLogger` | `traced`, `tracedWritable`, `logGet`, `logSet`, `snapshot` |
| `AtomRpc` | `Tag()` factory with `query`, `mutation`, `refresh` |
| `AtomHttpApi` | `Tag()` factory with grouped `query`, `mutation`, `refresh` |

### Effect Integration

```ts
import {
  atomEffect, queryEffect, defineQuery,
  queryEffectStrict, defineQueryStrict, createQueryKey, invalidate, refresh,
  isPending, latest,
  createOptimistic, defineMutation, mutationEffect,
  defineMutationStrict, mutationEffectStrict,
  useService, useServices, createMount, mount,
  layerContext,
  scopedRoot, scopedRootEffect,
  scopedQuery, scopedQueryEffect,
  scopedMutation, scopedMutationEffect,
  signal, computed,
} from "effect-atom-jsx";
```

### Reactive Core

```ts
import {
  createSignal, createEffect, createMemo, createRoot,
  createContext, useContext,
  onCleanup, onMount,
  untrack, sample, batch,
  mergeProps, splitProps,
  getOwner, runWithOwner,
} from "effect-atom-jsx";
```

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
| TodoMVC | `examples/todomvc/` | Full app with `defineQuery`, `mutationEffect`, optimistic UI, service injection |
| RPC & HTTP API | `examples/rpc-httpapi/` | `AtomRpc.Tag()`, `AtomHttpApi.Tag()`, `MatchTag` component |
| Schema Form | `examples/schema-form/` | `AtomSchema` validation, touched/dirty/reset, `AtomLogger.snapshot` |
| SSR | `examples/ssr/` | `renderToString`, `hydrateRoot`, `Hydration.dehydrate/hydrate` |

## How It Works

1. **`createMount(layer)` / `mount(fn, el, layer)`** builds a `ManagedRuntime` from your `Layer`
2. Components call **`useService(Tag)`** to synchronously access services from that runtime
3. **`defineQuery()` / `queryEffect()` / `atomEffect()`** run service effects reactively, exposing `AsyncResult` state
4. **`mutationEffect()`** handles writes with optimistic UI, rollback, and post-success refresh
5. Component lifetimes are scope-backed: mount/root and component boundaries map to Effect scopes so parent disposal interrupts descendant fibers transitively
6. **`scopedRootEffect()` / `scopedQueryEffect()` / `scopedMutationEffect()`** provide Effect-first scoped constructors
7. **`scopedQuery()` / `scopedMutation()`** remain sync convenience wrappers over the scoped constructors
8. Babel compiles JSX to **dom-expressions** helpers — reactivity updates only the affected DOM nodes

## Testing

DOM-free test harness via `effect-atom-jsx/testing`:

```ts
import { withTestLayer, renderWithLayer, mockService } from "effect-atom-jsx/testing";

const ApiMock = mockService(Api, {
  load: () => Effect.succeed(42),
});

// Option 1: withTestLayer — manual execution
const harness = withTestLayer(ApiMock);
const result = harness.run(() => queryEffect(() => useService(Api).load()));
await harness.tick();
await harness.dispose();

// Option 2: renderWithLayer — runs UI immediately
const harness2 = renderWithLayer(ApiMock, () => {
  const save = mutationEffect((n: number) => useService(Api).save(n));
  save.run(42);
});
await harness2.tick();
await harness2.dispose();
```

> See [`docs/TESTING.md`](docs/TESTING.md) for the full testing guide.

## Relationship to `@effect-atom/atom`

This project provides an effect-atom-like ergonomic surface, implemented natively for Effect v4.

- **Same:** namespace-style API (`Atom`, `Result`, `Registry`, `AtomRef`), atom graph patterns, waiting/revalidation async model
- **Different:** native implementation tuned for JSX + dom-expressions, targets Effect v4 beta (vs v3)
- **Guidance:** if you already think in effect-atom terms, this API should feel familiar. Prefer `defineQuery` / `mutationEffect` / `createMount` for Effect service integration.



## Compatibility

- Runtime: Effect v4 beta (`effect@^4.0.0-beta.29`)
- JSX: `dom-expressions` via `effect-atom-jsx/runtime`
- Test: `npm test` / Typecheck: `npm run typecheck` / Build: `npm run build`
