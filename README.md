# effect-atom-jsx

Effect-native reactive JSX runtime built on a small signal graph + `dom-expressions`-compatible runtime helpers.

It aims to feel natural for users coming from either:
- Effect services / Layer / Runtime patterns
- atom-style reactive APIs (`signal`, `computed`, `atomEffect`)

## Install

```bash
npm i effect-atom-jsx effect
```

This library currently targets `effect@^4.0.0-beta.29`.

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
- Effect v4 migration plan and notes: `EFFECT_V4_UPGRADE_PLAN.md`

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
- Detailed v4 upgrade notes: `EFFECT_V4_UPGRADE_PLAN.md`
- Release checklist: `docs/RELEASE_CHECKLIST.md`
