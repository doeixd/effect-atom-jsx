Status note (2026-03-10): this document is an ongoing idea/log file. Core naming has since consolidated to `Result` (5-state async model), and references to `AsyncResult` below should be read as historical naming unless explicitly discussing migration history.

Progress snapshot:

- Completed: callable `Atom.make(...)` reads and sync write methods (`set`/`update`/`modify`)
- Completed: README/runtime golden-path examples, `isPending`/`latest`, `flush()` guidance
- Completed: `Atom.family` eviction docs and implementation (`evict`, `clear`)
- Completed: `useService` diagnostics improvements
- Completed: public result terminology cleanup (`Result` + `FetchResult`, conversion names `fromResult`/`toResult`)
- Completed: removed `Atom.batch(...)` from core namespace (microtask batching + `flush()` only)
- Completed: `AtomRef` callable alignment (`ref()`/`collectionRef()` + `get`/`modify`)
- Completed: nested `AtomRef.prop(...).prop(...)` now stays linked to root state (no detached nested refs)
- Completed: README de-emphasizes `Registry` as advanced/manual API instead of primary local-state path
- Completed: top-level API now expects `Registry` deep import (`effect-atom-jsx/Registry`) for advanced/manual flows
- Completed: practical query+mutation guide now leads with linear `Atom.runtime(...).action(...)` flow
- Completed: advanced scoped/layer constructors moved behind advanced-only root exports (tighter app-first top-level)
- Completed: docs/examples now prefer callable atom style (`atom()`/`atom.set(...)`) in compatibility snippets
- Completed: AtomRef nested path caching hardened (collision-resistant keying)
- Completed: `defineQuery(...).effect()` composition helper added for typed query-to-Effect composition
- Completed: `defineMutation(...).effect(input)` and action-handle `.effect(input)` composition helpers
- Completed: `AtomSchema.struct(...)` for typed multi-field form composition
- Completed: `createOptimistic(source)` explicitly supports callable atoms as source
- Completed: `TypedBoundary` component added for schema/type-guard-based typed error boundaries
- Completed: composed-query error propagation covered via `query.effect()` (success + typed failure paths)
- Completed: `Atom.family` generalized to variadic key tuples with typed `evict(...args)`
- Completed: `Atom.make` disambiguation improved with explicit `Atom.value(...)` and `Atom.derived(...)` constructors
- Completed: README/API terminology pass clarifies all core concepts in context (atom/query/mutation/action/effect/Effect/Result/ref/optimistic/store)
- Completed: `Atom.result(atom)` helper added for typed atom-result-to-Effect composition
- Completed: composition bridge error channel now uses tagged errors (`ResultLoadingError`, `ResultDefectError`, `MutationSupersededError`)
- Completed: `AtomRef.toAtom(ref)` interop path documented and tested
- Completed: `runtime.atom((get) => Effect...)` dependency-aware composition overload
- Completed: typecheck assertions for runtime requirement subset enforcement (`RReq extends R`)
- Completed: action handles now expose `runEffect(input)` preserving success type in Effect composition
- Completed: `Atom.family(..., { equals })` custom key equality option
- Completed: `AtomSchema.struct` nested-struct composition + `touch()` form-level helper
- Completed: RPC/HTTP action type-inference checks for success channel (`src/type-tests/rpc-httpapi-inference.ts`)


**1. Make the counter work without Registry.**

This is the single highest-impact change. Every new user hits the Quick Start first, and right now it teaches them the most verbose pattern. The atom needs to be callable for reads and have methods for writes:

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
```

This requires two things under the hood. First, `Atom.make` returns an object that's callable (reading via the current reactive scope, auto-tracked by dom-expressions) and has `.set()`, `.update()`, `.modify()` methods that write synchronously. Second, the JSX compilation already wraps expressions in reactive computations — the atom's call just needs to register with that computation the same way a Solid signal does.

Registry stays available for tests, server code, and manual subscriptions, but it's no longer the primary API. Import it from `effect-atom-jsx/Registry` or access it via `Registry.useRegistry()` when you genuinely need it.

The derived atom with `(get) => get(count) * 2` matches effect-atom's pattern exactly. `Atom.map` stays as a convenience shorthand.

**2. Show `Atom.runtime(layer)` concretely.**

The Golden Path recommends it but the README never demonstrates it. Add this as the primary service integration pattern:

```tsx
import { Effect, Layer } from "effect";
import { Atom, Loading, For } from "effect-atom-jsx";

class Api extends Effect.Service<Api>()("Api", {
  effect: Effect.gen(function* () {
    const listUsers = () => Effect.succeed([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ]);
    const addUser = (name: string) => Effect.succeed({ id: "3", name });
    return { listUsers, addUser } as const;
  }),
}) {}

const apiRuntime = Atom.runtime(Api.Default);

// Read: runtime-bound atom
const users = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  }),
).pipe(Atom.withReactivity(["users"]));

// Write: runtime-bound action (linear flow)
const addUser = apiRuntime.action(
  Effect.fn(function* (name: string) {
    const api = yield* Api;
    yield* api.addUser(name);
  }),
  { reactivityKeys: ["users"] }
);

function App() {
  return (
    <Loading fallback={<p>Loading...</p>}>
      <For each={users()}>{(u) => <li>{u().name}</li>}</For>
      <button onClick={() => addUser("Charlie")}>Add</button>
    </Loading>
  );
}
```

This demonstrates `Atom.runtime`, `apiRuntime.atom`, `apiRuntime.action`, `Atom.withReactivity`, `reactivityKeys`, and `Loading` all working together. Keep `createMount` + `useService` + `defineQuery` as the secondary "ambient runtime" pattern for simpler apps that don't need multiple runtimes.

**3. Linearize the mutation example.**

Replace the callback-based `defineMutation` example with the linear action flow:

```tsx
const [todos, setOptimisticTodos] = createOptimisticStore(
  () => apiRuntime.get(todosAtom),
  []
);

const addTodo = apiRuntime.action(
  Effect.fn(function* (todo: Todo) {
    // Optimistic update — immediate
    setOptimisticTodos((s) => { s.list.push(todo); });

    // Async work — interruptible
    const api = yield* Api;
    yield* api.addTodo(todo);

    // Refresh — after success
    refresh(todosAtom);
  })
);
```

If the effect fails, the optimistic update reverts automatically because the action runs inside a transition scope. For custom error handling:

```tsx
const addTodo = apiRuntime.action(
  Effect.fn(function* (todo: Todo) {
    setOptimisticTodos((s) => { s.list.push(todo); });
    yield* api.addTodo(todo);
    refresh(todosAtom);
  }),
  {
    onError: (cause) => notifications.show("Failed to save"),
  }
);
```

Keep the callback-based `defineMutation` as an alternative for cases where the linear flow doesn't fit, but don't lead with it.

**4. Demonstrate `isPending` and `latest`.**

These are imported but never shown. Add a concrete stale-while-revalidate example:

```tsx
function UserList() {
  const refreshing = isPending(() => users());
  const latestSearch = latest(searchQuery);

  return (
    <div>
      <Show when={refreshing()}>
        <RefreshBanner />
      </Show>
      <Loading fallback={<Spinner />}>
        <For each={users()}>{(u) => <li>{u().name}</li>}</For>
      </Loading>
    </div>
  );
}
```

This shows the Solid 2.0 pattern: `Loading` handles initial suspension, `isPending` handles subsequent revalidation. That two-phase model is one of the strongest parts of the Solid 2.0 design and it's currently invisible in the README.

**5. Document `Atom.family` with eviction.**

This is critical for real apps and it's been an empty entry in the API table through every revision:

```tsx
const userAtom = Atom.family((id: string) =>
  apiRuntime.atom(
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.findUser(id);
    })
  )
);

// Usage — creates or retrieves by key
const alice = userAtom("user-1");
const bob = userAtom("user-2");

// In JSX
function UserCard(props: { id: string }) {
  const user = userAtom(props.id);
  return (
    <Loading fallback={<Skeleton />}>
      <div>{user().name}</div>
    </Loading>
  );
}

// Eviction — explicit cleanup for long-running apps
userAtom.evict("user-1");   // remove single entry
userAtom.clear();            // remove all entries
```

Add a sentence about memory: family entries are cached indefinitely unless evicted. In long-running SPAs, eviction matters.

**6. Resolve AtomRef or drop it.**

You have three options, and each is better than the current state of leaving it unexplained.

Option A — make `AtomRef.prop()` return a regular callable Atom:

```tsx
const todo = AtomRef.make({ title: "Write docs", done: false });
const title = todo.prop("title"); // returns Atom<string>

// Same API as any atom
title();           // "Write docs"
title.set("Ship"); // write
<input value={title()} onInput={(e) => title.set(e.target.value)} />
```

This integrates AtomRef into the atom graph. Props are just atoms with object-backed storage.

Option B — replace AtomRef with Solid 2.0 stores:

```tsx
import { createStore } from "effect-atom-jsx";

const [todo, setTodo] = createStore({ title: "Write docs", done: false });

setTodo((s) => { s.title = "Ship"; });
<input value={todo.title} onInput={(e) => setTodo((s) => { s.title = e.target.value; })} />
```

This aligns with the dom-expressions runtime you're already using, since stores are native to that ecosystem.

Option C — remove AtomRef from the top-level API, document it as advanced/experimental.

I'd lean toward Option A for consistency or Option B for ecosystem alignment. Don't leave it in the main README without explaining how it relates to everything else.

**7. Reduce to one result type.**

The honest question: do you need `Result` as a separate type? `AsyncResult` already covers:

- `Loading` → initial, no data
- `Refreshing(previous)` → has stale data, fetching new data
- `Success(value)` → has data
- `Failure(error)` → typed error
- `Defect(cause)` → untyped error

`Result` from effect-atom has:

- `Initial` → no data yet
- `Success(value, waiting)` → has data, maybe fetching
- `Failure(cause, waiting)` → has error, maybe retrying

The mapping is: `Initial` = `Loading`, `Success + waiting` = `Refreshing`, `Success + !waiting` = `Success`, `Failure` = `Failure`.

If `AtomRpc` and `AtomHttpApi` are the only consumers of `Result`, make them produce `AsyncResult` instead and drop `Result` as a public type. If there's a genuine reason to keep both (maybe `Result` is what effect-atom users expect and the builder pattern only works with it), then rename `Result` to something like `FetchResult` or `DataResult` and document the exact state mapping with a clear table showing which `AsyncResult` state maps to which `FetchResult` state.

**8. Remove `batch` from the main Atom namespace.**

If microtask batching is the default, `batch` is a legacy concept. Keep `flush()` as the "apply pending updates now" escape hatch. Move `batch` to `effect-atom-jsx/advanced` if it needs to exist for backward compatibility.

**9. Add the `flush()` example.**

Show when and why you'd use it:

```tsx
function handleSubmit() {
  formState.set("submitted");
  flush(); // force DOM update before focus
  submitButton.focus();
}
```

One sentence of guidance: you almost never need this. Microtask batching handles the common case. `flush()` is for imperative DOM work where you need the DOM to reflect state changes synchronously.

**10. Improve `useService` error messages now.**

This doesn't require any API changes and pays off immediately:

```tsx
function useService<S>(tag: ServiceTag<S>): S {
  const runtime = getManagedRuntime();
  if (!runtime) {
    throw new Error(
      `useService(${tag.key}) called outside of mount(). ` +
      `Wrap your app with createMount(layer) or mount(fn, el, layer).`
    );
  }
  const service = runtime.tryGet(tag);
  if (!service) {
    throw new Error(
      `Service "${tag.key}" not found in the current Layer. ` +
      `Available: [${runtime.listServices().join(", ")}]. ` +
      `Add ${tag.key} to your mount layer.`
    );
  }
  return service;
}
```

This turns a confusing "undefined is not a function" into a five-second fix. Ship it independently of everything else.

**The order I'd ship these in:**

First: items 1 and 10. Callable atoms and better error messages. These are the highest-impact, lowest-risk changes. They make the daily experience better without changing any architectural decisions.

Second: items 2 and 4. Concrete `Atom.runtime` examples and `isPending`/`latest` demos. These are documentation changes that showcase capabilities the library already has.

Third: items 3 and 5. Linear mutations and `Atom.family` documentation. These require some API work but are additive.

Fourth: items 6 and 7. AtomRef resolution and result type consolidation. These are the breaking changes that need the most design thought.

Fifth: items 8 and 9. Batch cleanup and flush documentation. Small polish once the bigger pieces are settled.

Let me go through Effect's major subsystems one by one and assess honestly.

**Layers and Services — decent but could go deeper.**

`createMount(layer)` building a `ManagedRuntime` is correct. `Atom.runtime(layer)` binding atoms to a specific layer is the right pattern from effect-atom. `useService(Tag)` for synchronous access works. But there are gaps. Layer composition at the component level via `WithLayer` exists, but there's no story for layer scoping — what if you want a fresh service instance per route, per modal, per list item? Effect's `Layer.fresh` and `Layer.scope` exist for this. The library should let you express "this subtree gets its own instance of `DbConnection`" without manually constructing a new runtime:

```tsx
// Hypothetical — scoped layer per route
<WithLayer layer={Layer.fresh(DbLive)}>
  <RouteContent />
</WithLayer>
// Each mount gets its own connection, disposed on unmount
```

Also missing: `Layer.memoize` awareness. If two `Atom.runtime` calls share the same layer, are the services shared or duplicated? Effect's layer memoization semantics matter here and the library doesn't address it.

**Scope — the biggest gap.**

The enhancement plan's Phase 1 identifies this correctly, and the revised README mentions scope-backed lifetimes, but the actual integration seems shallow. Effect's `Scope` is one of its most powerful primitives — it gives you deterministic, composable resource lifetimes. A deep integration would mean:

Every component gets a child `Scope` of its parent. Every fiber spawned by `defineQuery` or `apiRuntime.action` is forked into that scope. When the component unmounts, `Scope.close` runs, which interrupts all fibers and runs all finalizers — transitively, deterministically. `Effect.addFinalizer` inside an atom's effect body would attach to the component scope automatically.

```tsx
// Hypothetical — finalizers just work
const connection = apiRuntime.atom(
  Effect.gen(function* () {
    const conn = yield* Database.connect();
    yield* Effect.addFinalizer(() => conn.close());
    return yield* conn.query("SELECT ...");
  })
);
// Component unmount closes the scope, which closes the connection
```

Right now, cleanup seems to go through the dom-expressions owner system with scope layered on as an additional mechanism. The ideal is for scope to be *the* cleanup mechanism, with the owner system as a thin compatibility layer.

**Fibers and Structured Concurrency — partially used.**

Query fibers auto-interrupt on dependency change, which is good. But structured concurrency is more than just cancellation. Effect gives you:

`Fiber.join` / `Fiber.await` for waiting on child fibers. `FiberSet` and `FiberMap` for managing dynamic collections of fibers. `Deferred` for one-shot synchronization. The library doesn't seem to expose any of these. Consider a real-world case: a dashboard component that spawns five independent queries and needs to know when all of them have settled (not for rendering — `Loading` handles that — but for analytics, logging, or triggering a side effect after everything loads). There's no obvious way to express "when all queries in this subtree have settled, do X."

```tsx
// Hypothetical — fiber group awareness
const dashboard = Atom.fiberGroup([
  usersQuery,
  ordersQuery,
  metricsQuery,
  alertsQuery,
]);

createEffect(
  () => dashboard.allSettled(),
  (settled) => {
    if (settled) analytics.track("dashboard_loaded");
  }
);
```

**Error Model — underutilized.**

Effect's typed error channel (`Effect<A, E, R>`) is one of its defining features. The library partially uses it — `AsyncResult` has `Failure` and `Defect` variants, and `Async` component has slots for both. But there's no typed propagation. If `usersQuery` can fail with `UserNotFound | NetworkError`, that type information doesn't flow to the boundary. You can't write:

```tsx
// Hypothetical — typed error boundary
<TypedBoundary
  catch={NetworkError}
  fallback={(err) => <RetryPanel error={err} />}
>
  <Dashboard />
</TypedBoundary>
```

The enhancement plan has this as Phase 5, but even without full typed boundaries, the library could do more. `defineQuery` could preserve the error type so that `Async`'s `error` callback receives `E` rather than `unknown`. `apiRuntime.action` could surface the error type so callers know what failures to expect.

Also missing: `Cause` integration. Effect distinguishes between failures (expected typed errors), defects (unexpected crashes), and interruptions (cancellation). The `Async` component collapses defects and failures into separate slots, which is good, but there's no way to handle interruptions distinctly. When a query is interrupted because the user navigated away, that's different from a network failure — and the UI should potentially handle them differently.

**Schema — partially integrated.**

`AtomSchema` uses `Schema` for form validation, which is good. But Schema is far more powerful than field validation. It's a full encode/decode system with transformations, and it should show up in more places:

SSR hydration could use Schema for type-safe serialization/deserialization instead of raw `JSON.stringify`/`JSON.parse`. Query results could be validated through Schema automatically. RPC integration already uses Schema through `@effect/rpc`, but `AtomRpc.Tag` could expose the schema types so that query atoms are automatically validated.

```tsx
// Hypothetical — schema-validated query results
const users = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  }),
  { schema: Schema.Array(UserSchema) } // auto-validate response
);
```

**Concurrency Primitives — barely touched.**

Effect has `Semaphore`, `Queue`, `PubSub`, `STM`, `Ref`, `SynchronizedRef`. The library uses `Queue` for `fromQueue` and that's about it. Missing opportunities:

`Semaphore` for bounded query concurrency (at most N in-flight requests globally or per-runtime). `PubSub` for cross-component event buses — `fromPubSub` is in the enhancement plan but not shipped. `Ref` and `SynchronizedRef` as the backing store for atoms — this would give you atomic read-modify-write and STM transactions across multiple atoms. `Deferred` for one-shot "wait until ready" patterns in component initialization.

```tsx
// Hypothetical — semaphore-backed global concurrency
const apiRuntime = Atom.runtime(ApiLive, {
  queryConcurrency: 4, // at most 4 in-flight queries, backed by Semaphore
});

// Hypothetical — cross-component events via PubSub
const notifications = Atom.fromPubSub(notificationPubSub, []);

// Hypothetical — atomic multi-atom updates via STM
Atom.transaction((tx) => {
  const balance = tx.get(balanceAtom);
  const price = tx.get(priceAtom);
  if (balance >= price) {
    tx.set(balanceAtom, balance - price);
    tx.set(inventoryAtom, (n) => n - 1);
  }
});
```

**Tracing and Metrics — absent.**

Effect has a full tracing system (`Effect.withSpan`, `Tracer`, `Span`) and metrics (`Metric.counter`, `Metric.histogram`, etc.). The library doesn't integrate with either. `AtomLogger` is a custom logging utility, not an integration with Effect's `Logger`. Every `defineQuery` execution should optionally emit a span. Every `apiRuntime.action` should optionally record duration as a histogram. Every invalidation cascade should be traceable.

The zero-cost approach: if no `Tracer` layer is provided, span annotations are no-ops. If a user adds `TracerLive` to their layer, they get full observability for free.

```tsx
// Hypothetical — automatic spans
const users = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  }),
  { name: "users" } // becomes the span name automatically
);

// In production with tracing enabled:
// Span: "atom:query:users" { duration: 150ms, status: "success" }
// Span: "atom:action:addUser" { duration: 200ms, invalidated: ["users"] }
```

**Stream — underused.**

`fromStream` and `fromQueue` exist, which is the basics. But Effect's `Stream` module is enormous and much of it is relevant to UI:

`Stream.debounce` and `Stream.throttle` for input handling — these are Effect-native alternatives to `setTimeout`-based debouncing. `Stream.groupedWithin` for batching rapid events. `Stream.retry` for reconnectable WebSocket streams. `Stream.broadcast` for sharing a single stream across multiple atoms.

```tsx
// Hypothetical — native stream operators on atoms
const searchResults = Atom.fromStream(
  searchInput.toStream().pipe(
    Stream.debounce("300 millis"),
    Stream.mapEffect((query) => api.search(query)),
  ),
  []
);
```

**Schedule — completely absent.**

Effect's `Schedule` module is perfect for retry, polling, and periodic refresh — all common UI patterns. There's no integration:

```tsx
// Hypothetical — schedule-backed polling
const prices = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.getPrices();
  }),
  { schedule: Schedule.spaced("10 seconds") } // auto-refresh every 10s
);

// Hypothetical — retry with backoff
const users = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  }),
  {
    retry: Schedule.exponential("1 second").pipe(
      Schedule.compose(Schedule.recurs(3))
    ),
  }
);
```

effect-atom already integrates `Schedule` through `Stream.fromSchedule` — the JSX library should bring this forward.

**Config and ConfigProvider — absent.**

Effect has `Config` for typed configuration and `ConfigProvider` for sourcing it. effect-atom supports `Atom.runtime.addGlobalLayer` for adding a `ConfigProvider`. effect-atom-jsx doesn't mention it. In a UI app, feature flags, API endpoints, and environment-specific settings are common. Schema-validated config atoms would be natural:

```tsx
// Hypothetical
const apiUrl = Atom.fromConfig(Config.string("API_URL"));
const featureFlags = Atom.fromConfig(
  Config.all({
    darkMode: Config.boolean("DARK_MODE"),
    betaFeatures: Config.boolean("BETA"),
  })
);
```

**Rx / @effect/rx — unacknowledged.**

`@effect/rx` is Effect's own reactive primitive library. It has `Rx.make`, `Rx.family`, and integrates with Effect's runtime natively. effect-atom-jsx is essentially building a parallel reactive system. It should either acknowledge the relationship and explain why it exists separately, or consider building on top of `@effect/rx` as a foundation.

**Overall assessment:**

The library uses Effect primarily for two things: `Layer`/`ManagedRuntime` for dependency injection, and `Effect` values for async work. These are real integrations but they're the surface level. Effect's deeper primitives — `Scope` for resource management, `Fiber` for structured concurrency, typed error channels, `Schema` for encode/decode, `Stream` for continuous data, `Schedule` for time-based patterns, tracing for observability, `Semaphore`/`PubSub`/`STM` for coordination — are mostly untouched.

The result is a library that uses Effect as an async runtime with DI, when it could be using Effect as a complete application framework. The distance between "runs Effects and provides services" and "deeply integrates with Effect's resource, concurrency, error, and observability model" is the distance between a good library and a genuinely powerful one.

The highest-leverage additions would be, in this order: proper `Scope` integration for component lifetimes, `Schedule` integration for retry/polling, `Stream` operators for input handling, typed error propagation, and tracing. Each one would take a feature that UI developers currently implement ad-hoc (cleanup, polling, debounce, error handling, debugging) and replace it with something that's already battle-tested in Effect.

This is where the design has the most latent risk, because Effect's type system is unusually rich and the library's API choices can either preserve or destroy that richness.

**Service requirements are invisible.**

This is the fundamental type safety issue. In Effect proper, every effectful computation carries its requirements in the `R` type parameter:

```ts
// Effect knows this needs Api and Db
const program: Effect<User[], HttpError, Api | Db> = Effect.gen(function* () {
  const api = yield* Api;
  const db = yield* Db;
  // ...
});
```

The compiler enforces that you provide `Api` and `Db` before running. If you forget one, it's a type error. This is Effect's most important safety guarantee.

`useService(Api)` throws that away. It's a runtime lookup with no type-level trace. A component that calls `useService(Api)` and `useService(Db)` has no type signature reflecting those requirements. `createMount(layer)` doesn't check that the layer satisfies what the component tree needs. You discover missing services at runtime, in the browser, probably in production.

The enhancement plan's Phase 2 (`Component.require`) tries to recover this, but it's opt-in and the proposed phantom type approach has composability problems. The deeper issue is that `useService` is fundamentally an escape from Effect's type system — it's `Effect.runSync` with extra steps, and `runSync` is where type safety goes to die.

What a type-safe version would look like:

```tsx
// Each atom carries its requirements in the type
const users: Atom<User[], never, Api> = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  })
);

// Runtime-bound atoms have requirements satisfied — R becomes never
const boundUsers: Atom<User[]> = apiRuntime.atom(/* ... */);
// apiRuntime was created with Api.Default, so Api is satisfied
```

This is actually what `Atom.runtime(layer)` gives you if implemented correctly — the runtime's layer type constrains what effects you can run through it. But `useService` bypasses this by reading from an ambient untyped context. If `Atom.runtime(layer).atom(effect)` is the primary pattern, service requirements can be checked at atom creation time. If `useService` is the primary pattern, they can't.

This is the strongest argument for making `Atom.runtime` primary and `useService` secondary. It's not just an ergonomic preference — it's a type safety boundary.

**Error types are erased.**

When you write a `defineQuery`:

```tsx
const users = defineQuery(() => useService(Api).listUsers(), { name: "users" });
```

What's the type of `users.result()`? It's `AsyncResult<User[], unknown>` — the error type is `unknown` because `useService` returns a plain value and the effect's error channel doesn't flow through. Even if `Api.listUsers()` returns `Effect<User[], HttpError>`, that `HttpError` is gone by the time it reaches `AsyncResult`.

Compare to what Effect preserves natively:

```ts
// Effect preserves the error type
const program: Effect<User[], HttpError> = api.listUsers();

// After running, Exit preserves it
const exit: Exit<User[], HttpError> = yield* Effect.exit(program);
```

The library should preserve `E` through the entire chain:

```tsx
// Hypothetical — error type preserved
const users = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers(); // Effect<User[], HttpError>
  })
);
// users.result() should be AsyncResult<User[], HttpError>
// not AsyncResult<User[], unknown>
```

Then `Async`'s error callback receives `HttpError`, and typed boundaries can catch `HttpError` specifically. This requires the atom type to carry `E` as a generic parameter and for the runtime binding to propagate it.

**Atom type parameters are too simple.**

Currently atoms seem to be typed as `Atom<A>` — just the value type. Effect's model suggests they should be `Atom<A, E, R>`:

```ts
// Hypothetical full atom type
type Atom<A, E = never, R = never> = {
  (): A;                    // read (may suspend)
  set(value: A): void;      // write
  update(f: (a: A) => A): void;
};
```

`E` carries the error type for async atoms. `R` carries unresolved service requirements. When you bind an atom to a runtime, `R` is eliminated:

```ts
// Unbound — requires Api
const usersUnbound: Atom<User[], HttpError, Api> = Atom.make(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  })
);

// Bound — requirements satisfied
const apiRuntime = Atom.runtime(Api.Default);
const users: Atom<User[], HttpError> = apiRuntime.atom(/* ... */);
// R is gone because the runtime provides Api
```

This mirrors Effect's own pattern where `Layer.provide` eliminates requirements from `R`. It means the compiler catches "you tried to use this atom without providing its services" at the type level.

**`Atom.make` overloads create inference ambiguity.**

`Atom.make` currently does too many things:

```ts
Atom.make(0)                           // sync value
Atom.make((get) => get(other) * 2)     // derived
Atom.make(Effect.succeed(42))          // async (from effect-atom)
Atom.make(Stream.fromSchedule(...))    // stream (from effect-atom)
```

TypeScript's overload resolution will struggle here. If you pass a function, is it a derived atom or an effect? If you pass an object, is it a value or an Effect or a Stream? effect-atom handles this because Effect, Stream, and plain values have distinct branded types that TypeScript can discriminate. But the `(get) => ...` form vs a plain function value is ambiguous:

```ts
// Is this a derived atom or a value that happens to be a function?
const atom = Atom.make(() => console.log("hi"));
```

The safest approach is explicit constructors for each case:

```ts
Atom.make(0)                                    // value
Atom.make((get) => get(other) * 2)              // derived (get parameter disambiguates)
Atom.effect(Effect.succeed(42))                 // async — separate constructor
Atom.fromStream(stream, initial)                // stream — already separate
apiRuntime.atom(effect)                         // service-backed — separate
```

This is actually what the library partially does already with `Atom.effect` and `Atom.fromStream`. The question is whether `Atom.make` should also accept Effects directly (like effect-atom does) or whether that overload creates more confusion than convenience.

**`Atom.map` and derived atoms lose type narrowing.**

When you derive an atom:

```ts
const count = Atom.make(0);
const doubled = Atom.map(count, (n) => n * 2);
```

`doubled` should be `Atom<number>` — readonly. You shouldn't be able to call `doubled.set(5)` because it's derived. But if `Atom.make` returns a writable atom and `Atom.map` returns the same type, the type system allows writes to derived atoms that would be nonsensical.

Effect-atom handles this with `Atom.Atom<A>` (readable) vs `Atom.Writable<A, S>` (readable + settable with input type `S`). The library should distinguish:

```ts
type ReadonlyAtom<A, E = never> = {
  (): A;
  // no set, no update
};

type WritableAtom<A, E = never> = ReadonlyAtom<A, E> & {
  set(value: A): void;
  update(f: (a: A) => A): void;
};

Atom.make(0);                        // WritableAtom<number>
Atom.make((get) => get(count) * 2);  // ReadonlyAtom<number>
Atom.map(count, (n) => n * 2);       // ReadonlyAtom<number>
```

**`Atom.family` inference is tricky and probably broken.**

```ts
const userAtom = Atom.family((id: string) =>
  apiRuntime.atom(
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.findUser(id);
    })
  )
);
```

What's `userAtom`? It should be `(id: string) => Atom<User, UserNotFound>`. But if the factory function's return type isn't inferred precisely — which is common with complex Effect generators — you'll get `(id: string) => Atom<unknown, unknown>` and users will need manual annotations everywhere.

The fix: make `Atom.family` generic and constrain its return type:

```ts
declare function family<Args extends readonly unknown[], A, E>(
  factory: (...args: Args) => Atom<A, E>
): (...args: Args) => Atom<A, E>;
```

Test this with realistic Effect generators and verify inference actually works without annotations. If it doesn't, consider adding a schema parameter for validation and type assertion.

**`defineQuery` / `defineMutation` don't compose.**

In Effect, you compose programs by yielding them:

```ts
const getUser = (id: string) => Effect.gen(function* () { /* ... */ });
const enrichUser = (user: User) => Effect.gen(function* () { /* ... */ });

// Composition — types flow through
const getEnrichedUser = (id: string) => Effect.gen(function* () {
  const user = yield* getUser(id);
  return yield* enrichUser(user);
});
```

But `defineQuery` returns a query object, not an Effect. You can't yield a query inside another query. If you want a query that depends on the result of another query, what do you do?

```tsx
const userId = defineQuery(() => useService(Auth).currentUserId(), { name: "userId" });
const user = defineQuery(() => {
  const id = userId.result(); // this is an AsyncResult, not a value
  // how do you unwrap this and use it as a dependency?
}, { name: "user" });
```

The Solid 2.0 model handles this naturally because async is just a property of computations — one memo can read another and suspension propagates. effect-atom handles it with `get.result(otherAtom)` inside the atom factory. effect-atom-jsx needs an equivalent:

```tsx
// Hypothetical — atom composition via get
const user = Atom.make((get) => {
  const id = get.result(userIdAtom); // suspends until userId resolves
  return useService(Api).findUser(id);
});
```

Without this, every dependent query has to manually handle all the intermediate states of its dependencies, which is both verbose and error-prone.

**`createOptimistic` type relationships are fragile.**

```ts
const savedCount = Atom.make(0);
const optimistic = createOptimistic(() => registry.get(savedCount));
```

What ensures `optimistic` has the same type as `savedCount`? If `savedCount` is `Atom<number>` but `createOptimistic` returns `Optimistic<unknown>` because the callback return type isn't inferred precisely, you lose safety. The type should flow from the source atom:

```ts
// Type-safe optimistic — tied to source atom's type
const optimistic = createOptimistic(savedCount);
// optimistic.get(): number
// optimistic.set(n: number): void
// type mismatch is a compile error
```

Passing the atom directly rather than a getter callback preserves the type relationship without relying on inference through a closure.

**`AtomSchema` field composition is unclear.**

Individual fields work:

```ts
const age = AtomSchema.make(Schema.Int, 25);
const name = AtomSchema.make(Schema.String, "");
```

But how do you compose them into a form? Is there a `AtomSchema.all` or `AtomSchema.struct` that produces a combined validation result?

```ts
// Hypothetical — composed form validation
const form = AtomSchema.struct({
  age: AtomSchema.make(Schema.Int, 25),
  name: AtomSchema.make(Schema.NonEmpty, ""),
  email: AtomSchema.make(Schema.String.pipe(Schema.pattern(emailRegex)), ""),
});

form.isValid();  // Atom<boolean> — all fields valid
form.errors();   // Atom<Record<string, SchemaError>> — per-field errors
form.values();   // Atom<{ age: number; name: string; email: string }>
form.reset();    // reset all fields

// Type-safe: form.values() type is inferred from the schemas
```

Without form composition, users build it ad-hoc with manual `Atom.make((get) => get(age.isValid) && get(name.isValid) && ...)`, which is verbose and loses the structural relationship between fields and the form.

**`AtomRpc.Tag` and `AtomHttpApi.Tag` type inference.**

These are inherited from effect-atom and probably work well since effect-atom has tested them. But there's a composability question: can you derive one RPC client from another? Can you add middleware or interceptors that preserve types?

```tsx
// Hypothetical — typed middleware
const AuthenticatedApi = AtomRpc.withMiddleware(CountClient, {
  before: (req) => ({ ...req, headers: { ...req.headers, auth: token() } }),
});
// AuthenticatedApi has the same query/mutation types as CountClient
```

If middleware is untyped or erases the RPC schema types, it defeats the purpose of the typed RPC layer.

**The `R` parameter problem across component boundaries.**

This is subtle but important. If atoms carry `R` (service requirements) and components render atoms, then a component implicitly requires whatever its atoms require. But JSX doesn't have a way to express `R` on a component:

```tsx
// This component implicitly requires Api
function UserList() {
  return <For each={users()}>{(u) => <li>{u().name}</li>}</For>;
}

// How does the parent know UserList needs Api?
function App() {
  return <UserList />; // no type error even if Api isn't provided
}
```

This is where `Component.require` from Phase 2 would help, but the type challenge is real: you need the `R` parameter to propagate through JSX element types, which means extending the JSX type definitions. React Server Components face a similar challenge and haven't solved it cleanly either.

The pragmatic solution is to make `Atom.runtime(layer).atom(...)` the primary pattern, because that eliminates `R` at atom creation time. Then the component doesn't carry `R` because its atoms are already bound. The type safety lives at the point where you create `apiRuntime`, not at the component level:

```ts
// Type error here if layer doesn't provide Api
const apiRuntime = Atom.runtime(SomeLayerMissingApi);
//                               ^ type error: Api is not in layer output

// Atoms created through apiRuntime have R = never
// Components using these atoms have no requirements to propagate
```

This is why `Atom.runtime` being primary isn't just an ergonomic choice — it's the only pattern where Effect's type safety actually works end-to-end.

**Summary of the type safety gaps, ranked by severity:**

First, service requirements (`R`) are invisible at the component level. Fix by making `Atom.runtime` primary so `R` is eliminated at atom creation.

Second, error types (`E`) are erased through `useService` and query creation. Fix by preserving `E` through the atom and AsyncResult types.

Third, no readable/writable distinction on atoms. Fix by splitting the type so derived atoms are readonly.

Fourth, query composition requires manual AsyncResult unwrapping. Fix by supporting `get.result()` or suspension-based composition.

Fifth, `Atom.make` overloads may confuse inference. Fix by keeping distinct constructors for distinct use cases.

Sixth, `createOptimistic` type relationship with source atom is implicit. Fix by accepting the atom directly.

Seventh, `AtomSchema` fields don't compose into typed forms. Fix by adding `AtomSchema.struct`.

The theme across all of these: Effect's type system is designed around making requirements and failure modes visible in types. Everywhere the library introduces ambient access (`useService`), type erasure (`unknown` errors), or missing distinctions (writable vs readable), it's fighting against Effect's grain. The fixes are mostly about letting Effect's types flow through rather than cutting them off at API boundaries.

**1. Make `Atom.runtime(layer)` the primary pattern so `R` is eliminated at creation time.**

This is the most important change because it's the foundation for everything else. The runtime binding is where type safety either works or breaks.

```ts
// Atom.runtime checks at the type level that the layer provides what the effect needs
declare function runtime<ROut>(
  layer: Layer<ROut, never, never>
): AtomRuntime<ROut>;

interface AtomRuntime<Services> {
  // Effect's R must be a subset of Services — compiler enforces this
  atom<A, E>(
    effect: Effect<A, E, Services>
  ): ReadonlyAtom<A, E>;

  // Same for actions
  action<Args extends readonly unknown[], A, E>(
    fn: (...args: Args) => Effect<A, E, Services>,
    options?: ActionOptions
  ): Action<Args, A, E>;

  // Family variant
  family<Args extends readonly unknown[], A, E>(
    factory: (...args: Args) => Effect<A, E, Services>
  ): (...args: Args) => ReadonlyAtom<A, E>;
}
```

The key constraint: the `effect` parameter's `R` must be assignable to `Services`. If you try to use a service that isn't in the layer, the compiler catches it:

```ts
const apiRuntime = Atom.runtime(Api.Default);

// Compiles — Api is in the runtime
const users = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  })
);

// Type error — Db is not in Api.Default
const data = apiRuntime.atom(
  Effect.gen(function* () {
    const db = yield* Db; // Error: Db is not assignable to Api
    return yield* db.query();
  })
);
```

For apps that need multiple service sets, compose runtimes from composed layers:

```ts
const appRuntime = Atom.runtime(
  Layer.mergeAll(Api.Default, Db.Default, Auth.Default)
);
```

Keep `useService` as an escape hatch but mark it clearly in types:

```ts
// useService returns the service but erases R — type-unsafe by design
declare function useService<S>(tag: Context.Tag<S, S>): S;

// Document: prefer apiRuntime.atom() for type safety.
// useService is for imperative code in event handlers where R tracking isn't possible.
```

**2. Preserve `E` through the entire atom and result chain.**

Define the atom types to carry `E`:

```ts
interface ReadonlyAtom<A, E = never> {
  (): A;  // read — may suspend, may throw E
  readonly result: () => AsyncResult<A, E>;  // explicit result access
}

interface WritableAtom<A, E = never> extends ReadonlyAtom<A, E> {
  set(value: A): void;
  update(f: (a: A) => A): void;
  modify<B>(f: (a: A) => readonly [B, A]): B;
}
```

`AsyncResult` already has `E` — the issue is making sure it flows from effect creation through to the UI:

```ts
// E flows from the Effect definition...
const users = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers(); // Effect<User[], HttpError>
  })
);
// users is ReadonlyAtom<User[], HttpError>
// users.result() is AsyncResult<User[], HttpError>

// ...through to the Async component
<Async
  result={users.result()}
  error={(e) => {
    // e is HttpError, not unknown
    return <p>{e.message}</p>;
  }}
  success={(data) => <UserList users={data} />}
/>
```

For `defineQuery` (the ambient runtime path), preserve `E` from the callback return type:

```ts
declare function defineQuery<A, E>(
  fn: () => Effect<A, E>,
  options: QueryOptions
): QueryHandle<A, E>;

interface QueryHandle<A, E> {
  result: () => AsyncResult<A, E>;
  key: QueryKey;
  refresh: () => void;
}
```

TypeScript can infer `E` from the Effect returned by the callback — no annotation needed by the user as long as the generics flow through.

**3. Split readable and writable atom types.**

```ts
// Base — all atoms are readable
interface ReadonlyAtom<A, E = never> {
  (): A;
  readonly result: () => AsyncResult<A, E>;
}

// Extension — only value atoms are writable
interface WritableAtom<A, E = never> extends ReadonlyAtom<A, E> {
  set(value: A): void;
  update(f: (a: A) => A): void;
}

// Atom.make with a value returns WritableAtom
declare function make<A>(initial: A): WritableAtom<A>;

// Atom.make with a getter returns ReadonlyAtom
declare function make<A>(
  derive: (get: AtomGetter) => A
): ReadonlyAtom<A>;

// Atom.map returns ReadonlyAtom
declare function map<A, B>(
  source: ReadonlyAtom<A>,
  f: (a: A) => B
): ReadonlyAtom<B>;

// apiRuntime.atom returns ReadonlyAtom (async, not directly settable)
// apiRuntime.action returns Action (not an atom at all)
```

This means derived atoms and async atoms physically can't be set — the method doesn't exist on the type. No runtime check needed, the compiler prevents it:

```ts
const count = Atom.make(0);            // WritableAtom<number>
const doubled = Atom.map(count, n => n * 2); // ReadonlyAtom<number>

count.set(5);     // fine
doubled.set(10);  // compile error: Property 'set' does not exist on ReadonlyAtom
```

For atoms that need to be both derived and writable (Solid 2.0's "writable memo" pattern), add an explicit constructor:

```ts
const clamped = Atom.writable(
  (get) => Math.min(get(count), 100),  // derive
  (value, set) => set(count, value),   // write-back
);
// WritableAtom<number>
```

**4. Add `get.result()` for atom composition.**

This is how effect-atom handles dependent async atoms and it's the cleanest pattern. Inside a derived atom's getter, `get.result()` unwraps an async atom's current value, suspending if it isn't ready:

```ts
interface AtomGetter {
  // Sync read — for value atoms and derived atoms
  <A>(atom: ReadonlyAtom<A>): A;

  // Async read — unwraps result, suspends if loading, throws if failed
  result<A, E>(atom: ReadonlyAtom<A, E>): A;
}

// Usage: composed query
const userId = apiRuntime.atom(
  Effect.gen(function* () {
    const auth = yield* Auth;
    return yield* auth.currentUserId();
  })
);

const userProfile = Atom.make((get) => {
  const id = get.result(userId); // suspends until userId resolves
  return apiRuntime.run(
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.findUser(id);
    })
  );
});
```

But that pattern is awkward because you're mixing `get.result` (reactive) with `apiRuntime.run` (imperative). Better: let `apiRuntime.atom` accept a factory that receives `get`:

```ts
const userProfile = apiRuntime.atom((get) =>
  Effect.gen(function* () {
    const id = get.result(userId); // suspend/track dependency
    const api = yield* Api;
    return yield* api.findUser(id);
  })
);
```

This is the key composability primitive. The factory receives `get`, which can read both sync and async atoms. The returned Effect runs in the runtime. When `userId` changes, `userProfile` re-runs with the new id. When `userId` is loading, `userProfile` suspends. The types flow through:

```ts
// userId: ReadonlyAtom<string, AuthError>
// userProfile: ReadonlyAtom<User, AuthError | HttpError>
// Error types compose via union
```

The error type of `userProfile` is `AuthError | HttpError` because it depends on `userId` (which can fail with `AuthError`) and calls `api.findUser` (which can fail with `HttpError`). TypeScript infers this union automatically from the Effect generator.

**5. Fix `Atom.make` overload disambiguation.**

Keep `Atom.make` for the two unambiguous cases and use separate constructors for everything else:

```ts
// Unambiguous — value
Atom.make(0)
Atom.make("hello")
Atom.make({ x: 1, y: 2 })

// Unambiguous — derived (TypeScript can see the `get` parameter)
Atom.make((get) => get(count) * 2)

// Separate constructors for other cases
Atom.effect(someEffect)                    // async from Effect
Atom.fromStream(stream, initial)           // from Stream
Atom.fromQueue(queue, initial)             // from Queue
Atom.fromPubSub(pubsub, initial)           // from PubSub
apiRuntime.atom(effect)                    // service-backed
apiRuntime.atom((get) => effect)           // service-backed with deps
```

The discrimination between "value" and "derived" works because TypeScript can check whether the argument is a function with a specific parameter shape. If the function takes `(get: AtomGetter) => A`, it's derived. If it's any other type, it's a value. This works because `AtomGetter` is a branded type that plain functions don't satisfy:

```ts
declare function make<A>(initial: A): WritableAtom<A>;
declare function make<A>(
  derive: (get: AtomGetter) => A
): ReadonlyAtom<A>;

// TypeScript picks the right overload:
Atom.make(0);                          // first overload — A is number
Atom.make((get) => get(count) * 2);    // second overload — get is AtomGetter
Atom.make(() => console.log("hi"));    // first overload — A is () => void
```

The third case works correctly because `() => void` doesn't match `(get: AtomGetter) => A` — the parameter type is wrong.

**6. Type-safe `createOptimistic` by accepting the atom directly.**

```ts
// Current — type relationship is inferred through callback (fragile)
const optimistic = createOptimistic(() => registry.get(savedCount));

// Proposed — accept atom, type is preserved structurally
declare function createOptimistic<A>(
  source: ReadonlyAtom<A>
): OptimisticAtom<A>;

interface OptimisticAtom<A> extends ReadonlyAtom<A> {
  set(value: A): void;    // apply optimistic override
  clear(): void;           // revert to source
  isPending(): boolean;    // has uncommitted optimistic value
}

// Usage
const savedCount = Atom.make(0);
const optimistic = createOptimistic(savedCount);
// optimistic is OptimisticAtom<number> — set() only accepts number
```

The type flows from the source atom. If `savedCount` is `WritableAtom<number>`, then `optimistic.set` accepts `number`. No chance of type mismatch.

For the common case where the optimistic atom wraps a query result:

```ts
const users = apiRuntime.atom(/* ... */); // ReadonlyAtom<User[], HttpError>
const optimisticUsers = createOptimistic(users);
// optimisticUsers is OptimisticAtom<User[]>
// optimisticUsers.set only accepts User[]
```

**7. Add `AtomSchema.struct` for typed form composition.**

```ts
declare namespace AtomSchema {
  function struct<Fields extends Record<string, AtomSchemaField<any>>>(
    fields: Fields
  ): AtomSchemaForm<{
    [K in keyof Fields]: Fields[K] extends AtomSchemaField<infer A> ? A : never
  }>;
}

interface AtomSchemaForm<T> {
  // Composed validation — all fields
  isValid: ReadonlyAtom<boolean>;
  isDirty: ReadonlyAtom<boolean>;
  isTouched: ReadonlyAtom<boolean>;

  // Typed values — only available when all valid
  values: ReadonlyAtom<Option<T>>;

  // Per-field errors as a record
  errors: ReadonlyAtom<Partial<Record<keyof T, SchemaError>>>;

  // Field access preserves individual types
  fields: {
    [K in keyof T]: AtomSchemaField<T[K]>
  };

  // Lifecycle
  reset(): void;
  touch(): void;  // mark all fields touched (useful for submit validation display)
}
```

Usage:

```tsx
const form = AtomSchema.struct({
  name: AtomSchema.make(Schema.NonEmpty, ""),
  age: AtomSchema.make(Schema.Int.pipe(Schema.between(0, 150)), 25),
  email: AtomSchema.make(Schema.String.pipe(Schema.pattern(/@/)), ""),
});

// Type of form.values() is ReadonlyAtom<Option<{ name: string; age: number; email: string }>>

function SubmitButton() {
  const valid = form.isValid();
  const values = form.values();

  const submit = apiRuntime.action(
    Effect.fn(function* () {
      // Option.getOrThrow is safe here because button is disabled when invalid
      const data = Option.getOrThrow(values());
      // data is { name: string; age: number; email: string } — fully typed
      yield* useService(Api).submitForm(data);
    })
  );

  return (
    <button disabled={!valid()} onClick={() => submit()}>
      Submit
    </button>
  );
}
```

For nested forms, `AtomSchema.struct` should nest:

```ts
const addressForm = AtomSchema.struct({
  street: AtomSchema.make(Schema.NonEmpty, ""),
  city: AtomSchema.make(Schema.NonEmpty, ""),
  zip: AtomSchema.make(Schema.String.pipe(Schema.pattern(/^\d{5}$/)), ""),
});

const userForm = AtomSchema.struct({
  name: AtomSchema.make(Schema.NonEmpty, ""),
  address: addressForm,
});

// userForm.values() type includes nested address
// userForm.isValid() requires address fields to also be valid
```

**8. Type-safe action error handling.**

Actions should preserve error types so callers can handle them:

```ts
interface Action<Args extends readonly unknown[], A, E> {
  (...args: Args): void;                    // fire and forget
  run(...args: Args): Effect<A, E>;          // returns Effect for composition
  result: ReadonlyAtom<AsyncResult<A, E>>;   // reactive result
  pending: ReadonlyAtom<boolean>;            // is in-flight
}

// Usage
const addUser = apiRuntime.action(
  Effect.fn(function* (name: string) {
    const api = yield* Api;
    return yield* api.addUser(name); // Effect<User, ValidationError | HttpError>
  })
);
// addUser is Action<[string], User, ValidationError | HttpError>

// Fire and forget (errors handled by boundary or result atom)
addUser("Alice");

// Explicit error handling
const exit = await Effect.runPromiseExit(addUser.run("Alice"));
Exit.match(exit, {
  onSuccess: (user) => { /* User */ },
  onFailure: (cause) => {
    // cause is Cause<ValidationError | HttpError> — typed
    if (Cause.isFailType(cause, ValidationError)) {
      // handle validation error specifically
    }
  },
});
```

The `.run()` method returning an `Effect` is important for composability — you can yield an action inside another action or inside an Effect pipeline, and the error types compose:

```ts
const createTeam = apiRuntime.action(
  Effect.fn(function* (teamName: string, members: string[]) {
    const api = yield* Api;
    const team = yield* api.createTeam(teamName);

    // Compose with addUser action — errors accumulate
    yield* Effect.forEach(members, (name) =>
      addUser.run(name) // ValidationError | HttpError flows into this action's E
    );

    return team;
  })
);
// createTeam error type: ValidationError | HttpError | TeamError (union of all)
```

**9. Typed error boundaries that use the `E` parameter.**

Once atoms carry `E`, boundaries can match on it:

```tsx
declare function TypedBoundary<E>(props: {
  catch: Schema.Schema<E> | ((error: unknown) => error is E);
  fallback: (error: E) => JSX.Element;
  children: JSX.Element;
}): JSX.Element;
```

Using Schema for the catch predicate gives you both type narrowing and runtime validation:

```tsx
class NetworkError extends Schema.TaggedError<NetworkError>()(
  "NetworkError",
  { status: Schema.Number, message: Schema.String }
) {}

class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  { field: Schema.String, message: Schema.String }
) {}

// Catches only NetworkError — typed fallback
<TypedBoundary
  catch={NetworkError}
  fallback={(err) => (
    // err is NetworkError — err.status and err.message are typed
    <RetryPanel status={err.status} message={err.message} />
  )}
>
  {/* Catches only ValidationError at a different level */}
  <TypedBoundary
    catch={ValidationError}
    fallback={(err) => <FieldError field={err.field} message={err.message} />}
  >
    <UserForm />
  </TypedBoundary>
</TypedBoundary>
```

The implementation checks errors against the Schema or predicate, catches matches, and rethrows non-matches to the next boundary. `Defect` (untyped errors) should always propagate to the outermost boundary or crash — they shouldn't be caught by typed boundaries.

**10. Type-safe `Atom.family` with explicit constraints.**

The inference issue with complex Effect generators is real. Address it by making the return type explicit in the factory signature and adding a variant that accepts a Schema for the result:

```ts
// Basic — inference works when the Effect is simple
const userAtom = Atom.family((id: string) =>
  apiRuntime.atom(
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.findUser(id);
    })
  )
);
// Inferred: (id: string) => ReadonlyAtom<User, HttpError>

// When inference fails — explicit generic
const userAtom = Atom.family<[id: string], User, HttpError>((id) =>
  apiRuntime.atom(
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.findUser(id);
    })
  )
);

// With schema validation — guarantees output type matches
const userAtom = Atom.family(
  (id: string) =>
    apiRuntime.atom(
      Effect.gen(function* () {
        const api = yield* Api;
        return yield* api.findUser(id);
      })
    ),
  { schema: UserSchema } // validates and narrows the type
);
```

The `schema` option serves double duty: it narrows the type at compile time and validates the data at runtime. For production apps hitting real APIs, this catches schema drift early.

Also add an `equals` option for cache key stability:

```ts
const userAtom = Atom.family(
  (id: string) => apiRuntime.atom(/* ... */),
  {
    equals: (a, b) => a === b,  // default reference equality
    // or for complex keys:
    // equals: (a, b) => a.id === b.id && a.version === b.version
  }
);
```

**11. Make `AtomRpc.Tag` and `AtomHttpApi.Tag` preserve error types through queries and mutations.**

The current pattern from effect-atom:

```ts
class CountClient extends AtomRpc.Tag<CountClient>()("CountClient", {
  group: Rpcs,
  protocol: protocolLayer,
}) {}

const count = CountClient.query("count", void 0);
```

The `query` method should infer the success and error types from the RPC definition:

```ts
// If Rpcs defines:
class Rpcs extends RpcGroup.make(
  Rpc.make("count", {
    success: Schema.Number,
    error: Schema.Never,
  }),
  Rpc.make("getUser", {
    payload: Schema.Struct({ id: Schema.String }),
    success: UserSchema,
    error: UserNotFoundSchema,
  }),
) {}

// Then:
const count = CountClient.query("count", void 0);
// count is ReadonlyAtom<number, never>

const user = CountClient.query("getUser", { id: "123" });
// user is ReadonlyAtom<User, UserNotFound>

const createUser = CountClient.mutation("createUser");
// createUser is Action<[CreateUserPayload], User, ValidationError>
```

The error types from the RPC schema should flow all the way through to `Async`'s error callback and to typed boundaries. This is where the full type chain pays off — define the error once in the RPC schema, and it's type-checked everywhere from the server handler to the UI error boundary.

**12. Propagate error types through atom composition.**

When atoms compose, their error types should union:

```ts
const userId: ReadonlyAtom<string, AuthError> = authRuntime.atom(/* ... */);

const profile: ReadonlyAtom<Profile, AuthError | HttpError> = apiRuntime.atom(
  (get) => Effect.gen(function* () {
    const id = get.result(userId); // AuthError joins the union
    const api = yield* Api;
    return yield* api.getProfile(id); // HttpError joins the union
  })
);

const enriched: ReadonlyAtom<EnrichedProfile, AuthError | HttpError | EnrichError> =
  apiRuntime.atom((get) => Effect.gen(function* () {
    const p = get.result(profile); // AuthError | HttpError joins
    return yield* enrichService.enrich(p); // EnrichError joins
  }));
```

TypeScript handles this naturally through `Effect.gen` inference — each `yield*` adds its error type to the union. The key is making sure `get.result()` contributes the source atom's `E` to the enclosing Effect's error type. The implementation:

```ts
interface AtomGetter {
  <A, E>(atom: ReadonlyAtom<A, E>): A;  // sync read

  // result contributes E to the calling Effect's error channel
  result<A, E>(atom: ReadonlyAtom<A, E>): Effect<A, E>;
  // returns Effect<A, E> which, when yielded, adds E to the parent's error type
}
```

By returning `Effect<A, E>` from `get.result()` instead of a raw value, the caller must `yield*` it, which makes TypeScript accumulate the error types automatically. The suspension/tracking behavior is an implementation detail — the type signature is what makes composition safe.

**The overall type architecture after these changes:**

```
Atom<A, E, R>
  - A: value type
  - E: error type (never for sync atoms)
  - R: service requirements (never after runtime binding)

Atom.make(value)           → WritableAtom<A>
Atom.make((get) => ...)    → ReadonlyAtom<A>
Atom.effect(effect)        → ReadonlyAtom<A, E>
runtime.atom(effect)       → ReadonlyAtom<A, E>      (R eliminated)
runtime.atom((get) => ...) → ReadonlyAtom<A, E₁|E₂>  (E accumulates)
runtime.action(fn)         → Action<Args, A, E>
runtime.family(factory)    → (...args) → ReadonlyAtom<A, E>

createOptimistic(atom)     → OptimisticAtom<A>       (A flows from source)
AtomSchema.struct(fields)  → AtomSchemaForm<T>       (T inferred from schemas)

AsyncResult<A, E>          — E preserved from atom
Async component            — error callback receives E
TypedBoundary<E>           — catches specific E from subtree
```

Every `E` and `A` flows from definition to UI without erasure. Every `R` is eliminated at the point where the runtime is created, which is where the compiler checks that the layer satisfies the requirements. No `unknown` errors in the happy path. No invisible service requirements at the component level.
