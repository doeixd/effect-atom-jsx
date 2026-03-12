# `Atom.runtime(...).action`, `useService()`, and `defineQuery()`

This guide focuses on the three APIs you will use most when wiring Effect services into UI logic:

- `useService(tag)` for synchronous service lookup
- `defineQuery(fn, options?)` for reactive reads
- `Atom.runtime(layer).action(...)` for linear runtime-bound writes
- `defineMutation(fn, options?)` as callback-style mutation alternative

---

## Mental Model

- `mount(() => <App />, el, layer)` creates an ambient `ManagedRuntime`
- `useService(tag)` reads services from that runtime
- `defineQuery` runs read effects reactively and exposes `Result`
- `apiRuntime.action` runs mutation effects in a linear Effect flow and supports `reactivityKeys`
- `defineMutation` runs mutation effects with callback lifecycle hooks

Use `defineQuery` for query/read paths. For writes, prefer `apiRuntime.action` first and use `defineMutation` when callback hooks are a better fit.

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
- Best used to grab a service handle, then run effects via `defineQuery` and `Atom.runtime(...).action(...)` (or `defineMutation` when callback hooks fit better).
- `useServices({ api: Api, clock: Clock })` resolves multiple services in one call.

---

## `defineQuery(fn, options?)`

Creates a reactive async computation that:

- tracks dependencies read inside `fn()`
- interrupts in-flight fibers when dependencies change
- returns `Accessor<Result<A, E>>`

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
- If used without ambient runtime, `defineQuery` returns a `Defect` result accessor with a guidance message.

If you are outside `mount`, use `defineQuery(fn, { runtime })`.

For typed Effect composition, use `query.effect()`:

```ts
const user = defineQuery(() => useService(Api).getUser("u1"), { name: "user" });

const program = Effect.gen(function* () {
  const current = yield* user.effect();
  return current.id;
});
```

`isPending` and `latest` give stale-while-revalidate UX:

```tsx
import { Show, defineQuery, isPending, latest, useService } from "effect-atom-jsx";

const users = defineQuery(() => useService(Api).listUsers(), { name: "users" });
const refreshing = isPending(users.result);
const cached = latest(users.result);

<Show when={refreshing()}>
  <p>Refreshing users...</p>
</Show>
<Show when={cached()}>{(xs) => <p>Cached: {xs().length}</p>}</Show>
```

---

## `Atom.runtime(layer).action(...)` (preferred for service-backed writes)

Builds a runtime-bound action with a linear Effect generator flow.

```ts
import { Effect } from "effect";
import { Atom, createOptimistic, createSignal } from "effect-atom-jsx";

const apiRuntime = Atom.runtime(ApiLive);
const [savedCount] = createSignal(0);
const optimisticCount = createOptimistic(() => savedCount());

const saveCount = apiRuntime.action(
  Effect.fn(function* (next: number) {
    optimisticCount.set(next);
    const api = yield* Api;
    yield* api.saveCount(next);
  }),
  {
    reactivityKeys: ["counter"],
    onSuccess: () => optimisticCount.clear(),
    onError: () => optimisticCount.clear(),
  },
);

saveCount(10);
```

---

## `defineMutation(fn, options?)` (callback-style alternative)

Builds mutation actions with explicit lifecycle hooks.

```ts
import { defineMutation, createOptimistic, createSignal, useService } from "effect-atom-jsx";

const [savedCount, setSavedCount] = createSignal(0);

const optimisticCount = createOptimistic(() => savedCount());

const saveCount = defineMutation(
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
- `effect(input)` returns an `Effect` for typed composition in generator flows
- `result()` is `Result<void, E>`
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
  const apiRuntime = Atom.runtime(ApiLive);

  const counter = defineQuery(
    () => useService(Api).getCounter(),
    { name: "counter" },
  );

  const increment = apiRuntime.action(
    Effect.fn(function* () {
      const api = yield* Api;
      yield* api.incrementCounter();
    }),
    {
      reactivityKeys: [counter.key],
    },
  );

  return (
    <>
      <Async
        result={counter.result()}
        loading={() => <p>Loading...</p>}
        success={(n) => <p>Count: {n}</p>}
      />
      <button onClick={() => increment(void 0)}>
        Increment
      </button>
    </>
  );
}
```

---

## Common Pitfalls

- Calling `useService(tag)` outside a mounted layer boundary.
- Using `defineQuery` for write operations (prefer `Atom.runtime(...).action(...)` or `defineMutation`).
- Forgetting to clear optimistic overlays on success.
- Treating `Refreshing` as initial loading. Use `Loading` vs `Refreshing` distinctly in UI.
