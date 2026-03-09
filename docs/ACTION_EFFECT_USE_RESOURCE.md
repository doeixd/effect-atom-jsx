# `mutationEffect`, `useService()`, and `queryEffect()`

This guide focuses on the three APIs you will use most when wiring Effect services into UI logic:

- `useService(tag)` for synchronous service lookup
- `queryEffect(fn, options?)` for reactive reads
- `mutationEffect(fn, options?)` for writes and mutations

---

## Mental Model

- `mount(() => <App />, el, layer)` creates an ambient `ManagedRuntime`
- `useService(tag)` reads services from that runtime
- `queryEffect` runs read effects reactively and exposes `AsyncResult`
- `mutationEffect` runs mutation effects with optional optimistic updates and refresh hooks

Use `queryEffect` for query/read paths, and `mutationEffect` for write paths.

---

## `useService(tag)`

Synchronously resolves a service from the ambient runtime.

```ts
import { Effect, Layer, ServiceMap } from "effect";
import { mount, useService } from "effect-atom-jsx";

const Api = ServiceMap.Service<{
  readonly getHealth: () => Effect.Effect<string>;
}>("Api");

const ApiLive = Layer.succeed(Api, {
  getHealth: () => Effect.succeed("ok"),
});

function App() {
  const api = useService(Api);
  // `api` is available immediately and fully typed.
  return <div>Service ready: {String(typeof api.getHealth === "function")}</div>;
}

mount(() => <App />, document.getElementById("root")!, ApiLive);
```

Notes:

- Must be called under `mount(..., layer)`.
- Throws if no ambient runtime exists.
- Best used to grab a service handle, then run effects via `defineQuery` / `queryEffect` and `mutationEffect`.
- `use(tag)` is still supported as an alias.
- `useServices({ api: Api, clock: Clock })` resolves multiple services in one call.

---

## `queryEffect(fn, options?)`

Creates a reactive async computation that:

- tracks dependencies read inside `fn()`
- interrupts in-flight fibers when dependencies change
- returns `Accessor<AsyncResult<A, E>>`

```tsx
import { Async, defineQuery, useService, createSignal } from "effect-atom-jsx";

function UserPane() {
  const [userId, setUserId] = createSignal("u1");

  const user = defineQuery(
    () => useService(Api).getUser(userId()),
    { name: "user" },
  );

  return (
    <>
      <button onClick={() => setUserId("u2")}>Load u2</button>
      <Async
        result={user.result()}
        loading={() => <p>Loading...</p>}
        error={(e) => <p>Error: {String(e)}</p>}
        success={(value) => <pre>{JSON.stringify(value, null, 2)}</pre>}
      />
    </>
  );
}
```

Behavior details:

- First run starts at `Loading`.
- Re-runs become `Refreshing(previous)`.
- Typed failures become `Failure<E>`.
- Defects/interruption surface as `Defect`.
- If used without ambient runtime, `queryEffect` returns a `Defect` result accessor with a guidance message.

If you are outside `mount`, use `queryEffectStrict(runtime, fn)`.

---

## `mutationEffect(fn, options?)`

Builds mutation actions with explicit lifecycle hooks.

```ts
import { mutationEffect, createOptimistic, createSignal, useService } from "effect-atom-jsx";

const [savedCount, setSavedCount] = createSignal(0);

const optimisticCount = createOptimistic(() => savedCount());

const saveCount = mutationEffect(
  (next: number) => useService(Api).saveCount(next),
  {
    optimistic: (next) => optimisticCount.set(next),
    rollback: () => optimisticCount.clear(),
    refresh: () => {
      // e.g. invalidate or refresh read resources after successful write
    },
    onSuccess: (next) => {
      optimisticCount.clear();
      setSavedCount(next);
    },
    onFailure: (err) => {
      console.error("Save failed", err);
    },
  },
);

saveCount.run(10);
```

Return shape:

- `run(input)` starts the mutation
- `result()` is `AsyncResult<void, E>`
- `pending()` is `true` for `Loading` and `Refreshing`

Concurrency semantics:

- Starting a new run interrupts the previous run.
- Stale completions are ignored (latest run wins).

Hook order on success:

1. set `result` to `Success<void>`
2. run `refresh` hook(s)
3. run `onSuccess(input)`

Hook behavior on failure:

- `rollback(input)` runs for both typed failures and defects
- `onFailure(error, input)` receives either typed `E` or `{ defect: string }`

---

## Practical Pattern: Query + Mutation

```tsx
function CounterPage() {
  const counter = defineQuery(
    () => useService(Api).getCounter(),
    { name: "counter" },
  );

  const increment = mutationEffect(
    (_: void) => useService(Api).incrementCounter(),
    {
      invalidates: counter.key,
    },
  );

  return (
    <>
      <Async
        result={counter.result()}
        loading={() => <p>Loading...</p>}
        success={(n) => <p>Count: {n}</p>}
      />
      <button disabled={increment.pending()} onClick={() => increment.run(void 0)}>
        {increment.pending() ? "Saving..." : "Increment"}
      </button>
    </>
  );
}
```

---

## Common Pitfalls

- Calling `useService(tag)` outside a mounted layer boundary.
- Using `queryEffect` for write operations (prefer `mutationEffect`).
- Forgetting to clear optimistic overlays on success.
- Treating `Refreshing` as initial loading. Use `Loading` vs `Refreshing` distinctly in UI.
