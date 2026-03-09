# effect-atom-jsx

`effect-atom-jsx` is basically:
- an **effect-atom style API as the main API** (`Atom`, `Result`, `Registry`)
- plus a **`dom-expressions` JSX runtime target**
- with **Effect v4 beta** runtime/service integration built in

Compatibility note:
- this package provides an effect-atom-like ergonomic surface as first-class API, implemented natively for Effect v4
- it does not currently depend on `@effect-atom/atom` directly (that package line is currently Effect v3-oriented)

### Relationship to `@effect-atom/atom`

This project is intentionally close to effect-atom, but not a direct re-export.

- What is the same:
  - primary namespace-style API (`Atom`, `Result`, `Registry`, `AtomRef`)
  - atom graph usage patterns (`make`, `family`, `map`, `set/update/modify`, subscriptions)
  - waiting/revalidation-oriented async model
- What is different:
  - backend implementation is native to this library and tuned for JSX + `dom-expressions`
  - Effect runtime baseline is v4 beta here; `@effect-atom/atom` currently targets Effect v3
  - some advanced effect-atom modules are still being expanded toward parity
- Practical guidance:
  - if you already think in effect-atom terms, use `Atom` / `Registry` / `Result` / `AtomRef` directly here
  - use `resource` / `actionEffect` / `mount` for Effect service + UI integration

## Main API (Effect-Atom Style)

- `Atom` namespace (from `effect-atom-jsx` or `effect-atom-jsx/Atom`)
  - constructors: `Atom.make`, `Atom.readable`, `Atom.writable`
  - graph helpers: `Atom.family`, `Atom.map`, `Atom.withFallback`, `Atom.batch`
  - effect helpers: `Atom.get`, `Atom.set`, `Atom.update`, `Atom.modify`, `Atom.refresh`, `Atom.subscribe`
- `AtomRef` namespace (from `effect-atom-jsx` or `effect-atom-jsx/AtomRef`)
  - `AtomRef.make`, `AtomRef.collection`, `ref.prop(...)`, `ref.set(...)`, `ref.update(...)`
- `Result` namespace (from `effect-atom-jsx` or `effect-atom-jsx/Result`)
  - `Result.initial`, `Result.success`, `Result.failure`
  - guards and waiting helpers
- `Registry` namespace (from `effect-atom-jsx` or `effect-atom-jsx/Registry`)
  - `Registry.make` with `get/set/update/modify/refresh/subscribe/dispose`
- `Hydration` namespace (from `effect-atom-jsx` or `effect-atom-jsx/Hydration`)
  - `Hydration.dehydrate`, `Hydration.hydrate`, `Hydration.toValues`

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

### 3) Use `Atom` / `Registry` + Effect services

Use `Atom`/`Registry` for local graph state, and `use(Tag)` + `resource(...)` for Effect-powered async data.

```ts
import { Effect, Layer, ServiceMap } from "effect";
import { mount, use, resource, Async, Atom, Registry } from "effect-atom-jsx";

const CounterApi = ServiceMap.Service<{
  readonly load: () => Effect.Effect<number>;
}>("CounterApi");

const CounterApiLive = Layer.succeed(CounterApi, {
  load: () => Effect.succeed(42)
});

function App() {
  const registry = Registry.make();
  const count = Atom.make(0);
  const remote = resource(() => use(CounterApi).load());

  return (
    <main>
      <button onClick={() => registry.update(count, (n) => n + 1)}>
        Local: {registry.get(count)}
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
  - provides ergonomic primitives like `Atom`, `Registry`, `AtomRef`, `resource`, and `actionEffect`
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

## Compatibility And Roadmap

- **Today**
  - Runtime baseline: Effect v4 beta (`effect@^4.0.0-beta.29`)
  - API style: effect-atom-like primitives and async/mutation patterns
  - JSX runtime target: `dom-expressions` via `effect-atom-jsx/runtime`
- **Near-term goal**
  - keep this public API stable and predictable for app code
  - continue tightening type-safety and integration tests
- **Future alignment**
  - monitor official Effect v4 atom modules as they mature
  - if a stable framework-agnostic v4 atom core becomes available, adopt/adapter it behind the same public API

## Simple Examples

### Mental model (quick)

- **Local state**: `Atom` / `Registry`
  - fast in-memory reactive values for UI state
- **Service state**: `resource` / `atomEffect`
  - Effect-powered async reads with typed errors and cancellation
- **Mutation state**: `actionEffect` + `createOptimistic` (or `AtomRef` for object-like local editing)
  - optimistic write flow with rollback and refresh hooks

### Local graph state with `Atom` / `Registry`

```ts
import { Effect } from "effect";
import { Atom, Registry } from "effect-atom-jsx";

const count = Atom.make(1);
const doubled = Atom.map(count, (n) => n * 2);
const registry = Registry.make();

registry.set(count, 3);
console.log(registry.get(count));   // 3
console.log(registry.get(doubled)); // 6

Effect.runSync(Atom.update(count, (n) => n + 1));
console.log(registry.get(count)); // 4
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
import { mount, use, resource, Result } from "effect-atom-jsx";

const Api = ServiceMap.Service<{ getMessage: () => Effect.Effect<string> }>("Api");
const ApiLive = Layer.succeed(Api, { getMessage: () => Effect.succeed("hello") });

function App() {
  const message = resource(() => use(Api).getMessage());
  const state = Result.fromAsyncResult(message());
  return <div>{Result.isSuccess(state) ? state.value : "..."}</div>;
}

mount(() => App(), document.getElementById("root")!, ApiLive);
```

### Optimistic mutation with `actionEffect`

```ts
import { Effect } from "effect";
import { Atom, Registry, createOptimistic, actionEffect } from "effect-atom-jsx";

const registry = Registry.make();
const savedCount = Atom.make(0);
const optimisticCount = createOptimistic(() => registry.get(savedCount));

const save = actionEffect(
  (next: number) => Effect.succeed(next).pipe(Effect.delay("250 millis")),
  {
    optimistic: (next) => optimisticCount.set(next),
    rollback: () => optimisticCount.clear(),
    onSuccess: (next) => {
      optimisticCount.clear();
      registry.set(savedCount, next);
    },
  },
);

save.run(10);
console.log(optimisticCount.get()); // 10 immediately
```

### Object editing with `AtomRef`

```ts
import { AtomRef } from "effect-atom-jsx";

const todo = AtomRef.make({ title: "Write docs", done: false });
const title = todo.prop("title");

title.set("Ship release notes");
console.log(todo.value.title); // "Ship release notes"
```

## Additional APIs

- `signal(initial)` / `computed(fn)`
  - optional convenience API layered on the same reactive core
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
import { mount, use, resource, Atom, Registry, actionEffect, createOptimistic } from "effect-atom-jsx";

const Api = ServiceMap.Service<{ load: () => Effect.Effect<number>; save: (n: number) => Effect.Effect<void, string> }>("Api");
const ApiLive = Layer.succeed(Api, {
  load: () => Effect.succeed(1),
  save: () => Effect.void,
});

function App() {
  const registry = Registry.make();
  const count = Atom.make(0);
  const remote = resource(() => use(Api).load());
  const optimistic = createOptimistic(() => registry.get(count));

  const save = actionEffect(
    (next: number) => use(Api).save(next),
    {
      optimistic: (next) => optimistic.set(next),
      rollback: () => optimistic.clear(),
      onSuccess: (next) => registry.set(count, next),
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
