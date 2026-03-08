# effect-atom-jsx

`effect-atom-jsx` is basically:
- an **effect-atom style API** (`signal`, `computed`, `atomEffect`, optimistic actions)
- plus a **`dom-expressions` JSX runtime target**
- with **Effect v4 beta** runtime/service integration built in

The design is also inspired by Solid 2.0 beta ideas around async UX:
- initial `Loading` vs revalidation `Refreshing(previous)`
- `isPending(...)` for refresh state
- optimistic mutation flow via `actionEffect(...)`

## Install

```bash
npm i effect-atom-jsx effect
```

This library currently targets `effect@^4.0.0-beta.29`.

## Getting Started

### 1) Configure JSX transform

This package is intended to be used with `babel-plugin-jsx-dom-expressions` and `moduleName: "effect-atom-jsx"`.

```json
{
  "plugins": [
    [
      "babel-plugin-jsx-dom-expressions",
      {
        "moduleName": "effect-atom-jsx",
        "contextToCustomElements": true
      }
    ]
  ]
}
```

### 2) Mount with a Layer runtime

`mount(...)` creates a `ManagedRuntime` from your `Layer` and injects it into the component tree.

### 3) Use services + async atoms

Use `use(Tag)` for sync service access and `resource(...)` / `atomEffect(...)` for reactive async state.

```ts
import { Effect, Layer, ServiceMap } from "effect";
import { mount, use, resource, signal, Async } from "effect-atom-jsx";

const CounterApi = ServiceMap.Service<{
  readonly load: () => Effect.Effect<number>;
}>("CounterApi");

const CounterApiLive = Layer.succeed(CounterApi, {
  load: () => Effect.succeed(42)
});

function App() {
  const count = signal(0);
  const remote = resource(() => use(CounterApi).load());

  return (
    <main>
      <button onClick={() => count.update((n) => n + 1)}>
        Local: {count.get()}
      </button>
      <Async
        result={remote()}
        loading={() => <p>Loading...</p>}
        success={(value) => <p>From Effect service: {value}</p>}
      />
    </main>
  );
}

mount(() => App(), document.getElementById("root")!, CounterApiLive);
```

## How The Pieces Fit Together

`effect-atom-jsx` combines three ideas into one workflow:

- **Effect v4** (`effect`)
  - provides typed effects, services, layers, and managed runtimes
  - you model reads/writes as `Effect.Effect<A, E, R>`
- **effect-atom style reactivity** (this library)
  - provides ergonomic reactive primitives like `signal`, `computed`, `atomEffect`, and `actionEffect`
  - bridges reactive invalidation to Effect fibers with interruption/cancellation
- **dom-expressions JSX runtime**
  - Babel turns JSX into fine-grained DOM operations against `effect-atom-jsx/runtime`
  - updates are surgical: only nodes that depend on changed signals/effects update

In practice:

1. `mount(() => App(), el, layer)` builds a `ManagedRuntime` from your `Layer`.
2. Components call `use(Tag)` to synchronously access services from that runtime.
3. `resource(...)` / `atomEffect(...)` run service effects reactively and expose `AsyncResult` state.
4. `actionEffect(...)` handles writes, optimistic UI, rollback, and post-success refresh.
5. JSX is compiled to dom-expressions helpers, so reactivity updates the DOM efficiently.

## Simple Examples

### Mental model (quick)

- **Local state**: `signal` / `computed`
  - fast in-memory reactive values for UI state
- **Service state**: `resource` / `atomEffect`
  - Effect-powered async reads with typed errors and cancellation
- **Mutation state**: `actionEffect` + `createOptimistic`
  - optimistic write flow with rollback and refresh hooks

### Local state with `signal` / `computed`

```ts
import { signal, computed } from "effect-atom-jsx";

const count = signal(1);
const doubled = computed(() => count.get() * 2);

count.set(3);
console.log(count.get());   // 3
console.log(doubled.get()); // 6
```

### Effect-backed async state with `atomEffect`

```ts
import { Effect } from "effect";
import { atomEffect, AsyncResult } from "effect-atom-jsx";

const user = atomEffect(() =>
  Effect.succeed({ id: 1, name: "Ada" }).pipe(Effect.delay("200 millis"))
);

const state = user();
if (AsyncResult.isLoading(state)) console.log("loading");
if (AsyncResult.isSuccess(state)) console.log(state.value.name);
```

### Service injection with `mount` + `use`

```ts
import { Effect, Layer, ServiceMap } from "effect";
import { mount, use, resource } from "effect-atom-jsx";

const Api = ServiceMap.Service<{ getMessage: () => Effect.Effect<string> }>("Api");
const ApiLive = Layer.succeed(Api, { getMessage: () => Effect.succeed("hello") });

function App() {
  const message = resource(() => use(Api).getMessage());
  return <div>{message()._tag === "Success" ? message().value : "..."}</div>;
}

mount(() => App(), document.getElementById("root")!, ApiLive);
```

### Optimistic mutation with `actionEffect`

```ts
import { Effect } from "effect";
import { signal, createOptimistic, actionEffect } from "effect-atom-jsx";

const savedCount = signal(0);
const optimisticCount = createOptimistic(() => savedCount.get());

const save = actionEffect(
  (next: number) => Effect.succeed(next).pipe(Effect.delay("250 millis")),
  {
    optimistic: (next) => optimisticCount.set(next),
    rollback: () => optimisticCount.clear(),
    onSuccess: (next) => {
      optimisticCount.clear();
      savedCount.set(next);
    },
  },
);

save.run(10);
console.log(optimisticCount.get()); // 10 immediately
```

## Core API

- `signal(initial)` / `computed(fn)`
  - object-oriented atom API (`get`, `set`, `update`, `subscribe`)
- `atomEffect(() => Effect)`
  - tracked reactive async computation with cancellation on dependency changes
- `mount(fn, container, layer)`
  - bootstraps a `ManagedRuntime` from `Layer` and injects it into the component tree
- `use(tag)`
  - sync service access from the ambient runtime created by `mount`
- `resource(fn)` / `resourceWith(runtime, fn)`
  - runtime-aware async atom helpers (ambient and explicit forms)

## Async UI Model

`atomEffect` and `resource` return `Accessor<AsyncResult<A, E>>` where:
- `Loading` = initial load (no settled value yet)
- `Refreshing(previous)` = revalidation while preserving last settled value
- `Success(value)`
- `Failure(error)` (typed error channel)
- `Defect(cause)` (unexpected defects / interrupts)

Helpers:
- `isPending(result)` returns `true` only during `Refreshing`
- `Async({ result, ...slots })` declaratively renders these states

## Mutation Helpers

- `createOptimistic(source)` creates an optimistic overlay:
  - `get`, `set`, `clear`, `isPending`
- `actionEffect(fn, options)` creates an Effect-powered mutation action:
  - cancellation of stale runs
  - optional `optimistic`, `rollback`, `onSuccess`, `onFailure`
  - `result: Accessor<AsyncResult<void, E>>`
  - `pending: Accessor<boolean>` for loading/refreshing mutation state

## Examples

- Counter + async sample: `examples/counter/`
- Full TodoMVC with optimistic mutations and service injection: `examples/todomvc/`
  - includes a `TodoApiFromRpc(...)` adapter so an Effect RPC client can be mounted as the backend service layer

## Documentation

- Full API reference: `docs/API.md`
- Release checklist: `docs/RELEASE_CHECKLIST.md`

## Minimal Example

```ts
import { Effect, Layer, ServiceMap } from "effect";
import { mount, use, resource, signal, actionEffect, createOptimistic } from "effect-atom-jsx";

const Api = ServiceMap.Service<{ load: () => Effect.Effect<number>; save: (n: number) => Effect.Effect<void, string> }>("Api");
const ApiLive = Layer.succeed(Api, {
  load: () => Effect.succeed(1),
  save: () => Effect.void,
});

function App() {
  const count = signal(0);
  const remote = resource(() => use(Api).load());
  const optimistic = createOptimistic(() => count.get());

  const save = actionEffect(
    (next: number) => use(Api).save(next),
    {
      optimistic: (next) => optimistic.set(next),
      rollback: () => optimistic.clear(),
      onSuccess: (next) => count.set(next),
    },
  );

  return { remote, optimistic, save };
}

mount(() => App(), document.getElementById("root")!, ApiLive);
```

## Release Readiness

- Type-safe Effect v4 integration
- Full test suite (`npm test`), typecheck (`npm run typecheck`), and build (`npm run build`)
- Release checklist: `docs/RELEASE_CHECKLIST.md`
