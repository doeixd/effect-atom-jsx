# effect-atom-jsx

Fine-grained reactive JSX runtime powered by Effect v4. Combines **effect-atom style state management**, a **dom-expressions JSX runtime**, and **Effect v4 service integration** into a single, cohesive framework.

```bash
npm i effect-atom-jsx effect
```

> Targets `effect@^4.0.0-beta.29`

## Overview

```
effect-atom-jsx = Effect v4 services + Atom/Registry state + dom-expressions JSX
```

- **Local state** via `Atom` / `Registry` / `AtomRef` — reactive graph primitives
- **Async state** via `resource` / `atomEffect` — Effect fibers with automatic cancellation
- **Mutations** via `actionEffect` / `createOptimistic` — optimistic UI with rollback
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
  const registry = Registry.make();
  const doubled = Atom.map(count, (n) => n * 2);

  return (
    <div>
      <p>Count: {registry.get(count)} (doubled: {registry.get(doubled)})</p>
      <button onClick={() => registry.update(count, (c) => c + 1)}>+</button>
    </div>
  );
}

render(() => <Counter />, document.getElementById("root")!);
```

### 3. Add Effect services

```tsx
import { Effect, Layer, ServiceMap } from "effect";
import { mount, use, resource, Async } from "effect-atom-jsx";

const Api = ServiceMap.Service<{
  readonly load: () => Effect.Effect<number>;
}>("Api");

const ApiLive = Layer.succeed(Api, {
  load: () => Effect.succeed(42),
});

function App() {
  const data = resource(() => use(Api).load());

  return (
    <Async
      result={data()}
      loading={() => <p>Loading...</p>}
      success={(value) => <p>Loaded: {value}</p>}
    />
  );
}

mount(() => <App />, document.getElementById("root")!, ApiLive);
```

## Core Concepts

### Atom & Registry — Local State

Atoms are reactive values. A `Registry` reads, writes, and subscribes to atoms.

```ts
import { Effect } from "effect";
import { Atom, Registry } from "effect-atom-jsx";

const count = Atom.make(0);
const doubled = Atom.map(count, (n) => n * 2);

// Registry provides the read/write context
const registry = Registry.make();
registry.set(count, 3);
console.log(registry.get(doubled)); // 6

// Atom also exposes Effect-based helpers
Effect.runSync(Atom.update(count, (n) => n + 1));
```

All Effect helpers (`get`, `set`, `update`, `modify`) support both data-first and data-last (pipeable) forms.

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

### atomEffect & resource — Async State

Both create reactive async computations backed by Effect fibers. When tracked dependencies change, the previous fiber is interrupted and a new one starts.

```tsx
import { Effect } from "effect";
import { atomEffect, resource, use, AsyncResult, Async } from "effect-atom-jsx";

// atomEffect — standalone, no runtime needed
const time = atomEffect(() =>
  Effect.succeed(new Date().toISOString()).pipe(Effect.delay("1 second"))
);

// resource — uses the ambient Layer runtime from mount()
const data = resource(() => use(Api).load());

// Pattern-match on the result in JSX
<Async
  result={data()}
  loading={() => <p>Loading...</p>}
  error={(e) => <p>Error: {e.message}</p>}
  success={(value) => <p>{value}</p>}
/>
```

**Key difference:** `resource` uses the ambient runtime injected by `mount()`, while `atomEffect` runs Effects directly (or accepts an explicit runtime parameter).

### AsyncResult vs Result

The library has two result types for different use cases:

| Type | Module | Used by | Purpose |
|------|--------|---------|---------|
| `AsyncResult<A, E>` | `effect-ts.ts` | `atomEffect`, `resource` | UI async state (Loading / Refreshing / Success / Failure / Defect) |
| `Result<A, E>` | `Result.ts` | `AtomRpc`, `AtomHttpApi` | Data fetching state (Initial / Success / Failure) with waiting flag |

Convert between them with `Result.fromAsyncResult()` and `Result.toAsyncResult()`.

### actionEffect — Mutations

Handles writes with optimistic UI, rollback, and automatic refresh.

```ts
import { Effect } from "effect";
import { Atom, Registry, createOptimistic, actionEffect } from "effect-atom-jsx";

const registry = Registry.make();
const savedCount = Atom.make(0);
const optimistic = createOptimistic(() => registry.get(savedCount));

const save = actionEffect(
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
| `Atom` | `make`, `readable`, `writable`, `family`, `map`, `withFallback`, `batch`, `get`, `set`, `update`, `modify`, `refresh`, `subscribe`, `fromStream`, `fromQueue` |
| `AtomRef` | `make`, `collection` |
| `Registry` | `make` (returns instance with `get`, `set`, `update`, `modify`, `mount`, `refresh`, `subscribe`, `reset`, `dispose`) |
| `Result` | `initial`, `success`, `failure`, `isInitial`, `isSuccess`, `isFailure`, `isWaiting`, `fromAsyncResult`, `toAsyncResult`, `map`, `flatMap`, `match`, `all` |
| `Hydration` | `dehydrate`, `hydrate`, `toValues` |
| `AtomSchema` | `make`, `makeInitial` |
| `AtomLogger` | `traced`, `tracedWritable`, `logGet`, `logSet`, `snapshot` |
| `AtomRpc` | `Tag()` factory with `query`, `mutation`, `refresh` |
| `AtomHttpApi` | `Tag()` factory with grouped `query`, `mutation`, `refresh` |

### Effect Integration

```ts
import {
  atomEffect, resource, resourceWith,
  isPending, latest,
  createOptimistic, actionEffect,
  use, mount, layerContext, scopedRoot,
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

## Examples

| Example | Location | What it shows |
|---------|----------|---------------|
| Counter | `examples/counter/` | Signals, atoms, Registry, async data with `atomEffect` |
| TodoMVC | `examples/todomvc/` | Full app with `AtomRef`, `resource`, `actionEffect`, optimistic UI, service injection |
| RPC & HTTP API | `examples/rpc-httpapi/` | `AtomRpc.Tag()`, `AtomHttpApi.Tag()`, `MatchTag` component |
| Schema Form | `examples/schema-form/` | `AtomSchema` validation, touched/dirty/reset, `AtomLogger.snapshot` |
| SSR | `examples/ssr/` | `renderToString`, `hydrateRoot`, `Hydration.dehydrate/hydrate` |

## How It Works

1. **`mount(() => <App />, el, layer)`** builds a `ManagedRuntime` from your `Layer`
2. Components call **`use(Tag)`** to synchronously access services from that runtime
3. **`resource()` / `atomEffect()`** run service effects reactively, exposing `AsyncResult` state
4. **`actionEffect()`** handles writes with optimistic UI, rollback, and post-success refresh
5. Babel compiles JSX to **dom-expressions** helpers — reactivity updates only the affected DOM nodes

## Relationship to `@effect-atom/atom`

This project provides an effect-atom-like ergonomic surface, implemented natively for Effect v4.

- **Same:** namespace-style API (`Atom`, `Result`, `Registry`, `AtomRef`), atom graph patterns, waiting/revalidation async model
- **Different:** native implementation tuned for JSX + dom-expressions, targets Effect v4 beta (vs v3)
- **Guidance:** if you already think in effect-atom terms, this API should feel familiar. Use `resource` / `actionEffect` / `mount` for Effect service integration.

## Compatibility

- Runtime: Effect v4 beta (`effect@^4.0.0-beta.29`)
- JSX: `dom-expressions` via `effect-atom-jsx/runtime`
- Test: `npm test` / Typecheck: `npm run typecheck` / Build: `npm run build`
