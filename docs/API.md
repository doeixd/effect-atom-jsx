# API Reference

`effect-atom-jsx` exports reactive primitives, Effect integration utilities, namespace modules, and DOM runtime helpers.

<br />

## Atom (`src/Atom.ts`)

The core reactive state primitive. Atoms are plain objects with `read`/`write` methods backed by the signal graph.

### Constructors

- **`Atom.make(value)`** — Create a writable atom with an initial value.
- **`Atom.make((get) => ...)`** — Create a derived (read-only) atom that tracks dependencies.
- **`Atom.readable(read, refresh?)`** — Low-level read-only atom constructor.
- **`Atom.writable(read, write, refresh?)`** — Low-level writable atom constructor.
- **`Atom.family(fn)`** — Create a memoized atom factory keyed by argument identity. Same arg returns same atom instance.
- **`Atom.runtime(layer)`** — Create an Atom runtime bound to an Effect `Layer` with `atom(...)` and `fn(...)` helpers.
- **`Atom.runtime.addGlobalLayer(layer)`** — Add a global layer applied to newly-created atom runtimes.
- **`Atom.keepAlive(atom)`** — Compatibility helper matching effect-atom ergonomics (identity in this package).
- **`Atom.fn(effect, options?)`** / **`Atom.fn(runtime, effect, options?)`** — Create function-style mutation atoms from Effect functions.
- **`Atom.pull(stream, options?)`** — Create pull-based stream pagination atom. Call `set(void 0)` to pull next chunk.
- **`Atom.projection(derive, initial, options?)`** — Mutable derived projection. Mutate draft or return a next value with keyed reconciliation.
- **`Atom.projectionAsync(derive, initial, options?)`** — Async projection variant returning `AsyncResult<T, E>`. Uses `options.runtime` or ambient mount runtime.
- **`Atom.searchParam(name, codec?)`** — Atom bound to URL search params (browser environments).
- **`Atom.kvs({ key, defaultValue, ... })`** — Atom backed by key-value storage (`localStorage` by default).
- **`Atom.withReactivity(atom, keys)`** / **`Atom.invalidateReactivity(keys)`** — Register and invalidate logical reactivity keys.
- **`Atom.Stream.emptyState()` / `Atom.Stream.applyChunk(state, chunk)` / `Atom.Stream.hydrateState(value)`** — Advanced out-of-order stream assembly + hydration helpers.

```ts
const count = Atom.make(0);
const doubled = Atom.make((get) => get(count) * 2);
const todoById = Atom.family((id: string) => Atom.make({ id, done: false }));

const runtime = Atom.runtime(MyLayer);
const userAtom = runtime.atom(Effect.service(UserApi).pipe(Effect.flatMap((api) => api.me())));
const incrementAtom = runtime.fn((n: number) => Effect.sync(() => console.log(n)));
const selectedMap = Atom.projection((draft: Record<string, boolean>) => {
  draft["a"] = true;
}, {});
```

### Derivations

- **`Atom.map(atom, fn)` / `Atom.map(fn)`** — Derive a new atom by transforming the value. Supports data-first and data-last.
- **`Atom.withFallback(atom, fallback)` / `Atom.withFallback(fallback)`** — Replace `null`/`undefined` with a fallback value.

```ts
const label = Atom.map(count, (n) => `Count: ${n}`);
const safe = Atom.withFallback(nameAtom, "anonymous");
```

### Effect Helpers

All support both data-first `Atom.set(atom, value)` and data-last `Atom.set(value)` forms.

- **`Atom.get(atom)`** → `Effect<A>` — Read atom value.
- **`Atom.set(atom, value)`** → `Effect<void>` — Write atom value.
- **`Atom.update(atom, fn)`** → `Effect<void>` — Update from previous value.
- **`Atom.modify(atom, fn)`** → `Effect<A>` — Read-modify-write, returning a computed value.
- **`Atom.refresh(atom)`** → `Effect<void>` — Force-invalidate atom and dependents.

```ts
Effect.runSync(Atom.get(count));           // 0
Effect.runSync(Atom.update(count, n => n + 1));
const prev = Effect.runSync(Atom.modify(count, n => [n, n + 1]));
```

### Subscriptions & Batching

- **`Atom.subscribe(atom, listener, options?)`** — Subscribe to value changes. Returns unsubscribe function. Calls listener immediately by default (pass `{ immediate: false }` to skip).
- **`Atom.batch(fn)`** — Batch multiple writes into a single notification cycle.

### Stream Integration

- **`Atom.fromStream(stream, initialValue, runtime?)`** — Create an atom whose value updates from an Effect Stream. Starts a fiber on first read.
- **`Atom.fromQueue(queue, initialValue)`** — Create an atom that reads from an Effect Queue. Shorthand for `fromStream(Stream.fromQueue(queue), initial)`.
- **`Atom.fromResource(fn)`** — Create an atom backed by `queryEffect` semantics using ambient runtime from `mount()`.
- **`Atom.fromResource(runtime, fn)`** — Explicit-runtime variant for non-mounted usage.
- **`Atom.fromResource(...)`** — Alias of `Atom.query(...)`.

```ts
const prices = Atom.fromStream(priceStream, 0);
const events = Atom.fromQueue(eventQueue, null);
const user = Atom.fromResource(() => useService(Api).getUser("1"));
```

### Type Guards

- **`Atom.isAtom(u)`** — `true` if `u` is an `Atom<any>`.
- **`Atom.isWritable(atom)`** — `true` if the atom is a `Writable<R, W>`.

### Types

- `Atom.Atom<A>` — Read-only atom.
- `Atom.Writable<R, W>` — Readable as `R`, writable as `W`.
- `Atom.Context` — Callable read context with `get`, `refresh`, `set`, `result`, `addFinalizer` methods.
- `Atom.WriteContext<A>` — Write context with `get`, `set`, `refreshSelf`, `setSelf`, `result`, `addFinalizer`.
- `Atom.AtomRuntime<R, E>` — Runtime wrapper with `managed`, `atom(...)`, `fn(...)`, and `dispose()`.
- `Atom.ProjectionOptions<T>` / `Atom.ProjectionAsyncOptions<T, R>` — Projection configuration.

<br />

## AtomSchema (`src/AtomSchema.ts`)

Schema-validated form fields backed by atoms. Wraps a writable atom with an Effect Schema to produce a `ValidatedAtom`.

- **`AtomSchema.make(schema, inputAtom, options?)`** — Wrap an existing writable atom with validation.
  - `options.initial` — baseline value for `dirty` comparison and `reset()`.
- **`AtomSchema.makeInitial(schema, initial)`** — Create a standalone validated atom with an initial value.
- **`AtomSchema.path(root, ...segments)`** — Create a writable atom focused on a nested object path.
- **`AtomSchema.HtmlInput`** — Built-in form codecs/helpers:
  - `number` (`Schema.NumberFromString`)
  - `date` (`Schema.Date`)
  - `optionalString` (`schema` + `input(value)` for empty-string mapping)
  - `optionalNumber` (`schema` + `input(value)` for empty-string mapping)

```ts
const field = AtomSchema.makeInitial(Schema.Int, 25);
Effect.runSync(Atom.get(field.isValid));  // true
Effect.runSync(Atom.set(field.input, 1.5));
Effect.runSync(Atom.get(field.isValid));  // false
field.reset();
```

### ValidatedAtom\<A, I\>

| Property | Type | Description |
|----------|------|-------------|
| `input` | `Writable<I, I>` | Raw input atom (writes mark field as touched) |
| `result` | `Atom<Exit<A, SchemaError>>` | Parse result |
| `error` | `Atom<Option<SchemaError>>` | Validation error or `None` |
| `value` | `Atom<Option<A>>` | Parsed value or `None` |
| `isValid` | `Atom<boolean>` | `true` when input passes validation |
| `touched` | `Atom<boolean>` | `true` after first write |
| `dirty` | `Atom<boolean>` | `true` when input differs from initial |
| `reset()` | `() => void` | Restore initial value, clear touched |

### Types

- `AtomSchema.ValidatedAtom<A, I>`
- `AtomSchema.SchemaError`

<br />

## AtomLogger (`src/AtomLogger.ts`)

Structured debug logging for atom reads and writes using Effect's Logger.

- **`AtomLogger.traced(atom, label)`** — Wrap a read-only atom to log reads via `Effect.logDebug` with `{ atom, op, value }` annotations.
- **`AtomLogger.tracedWritable(atom, label)`** — Wrap a writable atom to log both reads and writes.
- **`AtomLogger.logGet(atom, label?)`** → `Effect<A>` — Read atom as an Effect with debug logging.
- **`AtomLogger.logSet(atom, value, label?)`** → `Effect<void>` — Write atom as an Effect with debug logging.
- **`AtomLogger.snapshot(atoms)`** → `Effect<Record<string, unknown>>` — Read all labeled atoms and return a snapshot.

```ts
const traced = AtomLogger.tracedWritable(count, "count");
const snap = Effect.runSync(AtomLogger.snapshot([["count", count], ["name", name]]));
```

<br />

## Registry (`src/Registry.ts`)

Provides a centralized read/write/subscribe context for atoms. Useful for managing atom state outside of reactive computations.

- **`Registry.make()`** — Create a new registry instance.

### Registry Instance Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `get(atom)` | `<A>(atom: Atom<A>) => A` | Read current value |
| `set(atom, value)` | `<R,W>(atom: Writable<R,W>, value: W) => void` | Write a value |
| `update(atom, fn)` | `<R>(atom: Writable<R,R>, fn: (v: R) => R) => void` | Update from previous |
| `modify(atom, fn)` | `<R,W,A>(atom: Writable<R,W>, fn: (v: R) => [A, W]) => A` | Read-modify-write |
| `subscribe(atom, fn)` | `<A>(atom: Atom<A>, fn: (v: A) => void) => () => void` | Subscribe to changes |
| `mount(atom)` | `<A>(atom: Atom<A>) => () => void` | Keep atom alive (run effects) |
| `refresh(atom)` | `<A>(atom: Atom<A>) => void` | Force-invalidate |
| `reset(atom)` | `<A>(atom: Writable<A,A>) => void` | Reset to initial value |
| `dispose()` | `() => void` | Clean up all subscriptions |

### Types

- `Registry.Registry`

<br />

## Result (`src/Result.ts`)

A three-state result type for data fetching: `Initial`, `Success`, or `Failure`. Used by `AtomRpc` and `AtomHttpApi`.

> **Note:** This is different from `AsyncResult` (used by `atomEffect`/`queryEffect`). Convert between them with `Result.fromAsyncResult()` and `Result.toAsyncResult()`.

### Constructors

- **`Result.initial(waiting?)`** — Create an initial result. `waiting: true` means a fetch is in progress.
- **`Result.success(value, options?)`** — Create a success result. Options: `{ waiting?, timestamp? }`.
- **`Result.failure(error, options?)`** — Create a failure result. Options: `{ previousSuccess? }`.

### Guards

- `Result.isInitial(r)`, `Result.isSuccess(r)`, `Result.isFailure(r)`, `Result.isWaiting(r)`, `Result.isNotInitial(r)`, `Result.isResult(r)`

### Transformations

- **`Result.map(result, fn)`** — Map over success value.
- **`Result.flatMap(result, fn)`** — Chain results.
- **`Result.match(result, { initial, success, failure })`** — Pattern match all states.
- **`Result.all(results)`** — Combine multiple results (all must succeed).

### Accessors

- **`Result.value(result)`** — Extract success value or `undefined`.
- **`Result.getOrElse(result, fallback)`** — Success value or fallback.
- **`Result.getOrThrow(result)`** — Success value or throw.

### Conversions

- **`Result.fromAsyncResult(asyncResult)`** — Convert `AsyncResult` to `Result`.
- **`Result.toAsyncResult(result)`** — Convert `Result` to `AsyncResult`.
- **`Result.fromExit(exit)`** — Convert Effect `Exit` to `Result`.
- **`Result.fromExitWithPrevious(exit, previous)`** — Convert Exit, preserving previous success on failure.
- **`Result.waiting(result)`** — Set `waiting: true` on an existing result.
- **`Result.waitingFrom(result)`** — Create a waiting version, preserving success value.

### Types

- `Result.Result<A, E>` — `Initial | Success<A> | Failure<E>`

<br />

## AtomRef (`src/AtomRef.ts`)

Per-property reactive access to objects and arrays.

- **`AtomRef.make(initial)`** — Create a ref for an object. Returns `AtomRef<A>`.
- **`AtomRef.collection(items)`** — Create a reactive array. Returns `Collection<A>`.

### AtomRef Instance

| Method | Description |
|--------|-------------|
| `prop(key)` | Get a reactive ref for a single property |
| `set(value)` | Replace the entire object |
| `update(fn)` | Update via a function |
| `subscribe(fn)` | Subscribe to changes |
| `value` | Current snapshot (non-reactive) |

### Collection Instance

| Method | Description |
|--------|-------------|
| `push(item)` | Append an item |
| `insertAt(index, item)` | Insert at position |
| `remove(predicate)` | Remove matching items |
| `toArray()` | Get current items array |

### Types

- `AtomRef.AtomRef<A>`, `AtomRef.ReadonlyRef<A>`, `AtomRef.Collection<A>`

<br />

## Hydration (`src/Hydration.ts`)

SSR state transfer — serialize atom values on the server and restore them on the client.

- **`Hydration.dehydrate(registry, entries)`** — Snapshot atom values to a serializable array.
  - `entries`: `Iterable<[key: string, atom: Atom<any>]>`
  - Returns `DehydratedAtomValue[]`
- **`Hydration.hydrate(registry, state, resolvers)`** — Restore atom values from a dehydrated snapshot.
  - `resolvers`: `Record<string, Writable<any, any>>` mapping keys to atoms
- **`Hydration.toValues(state)`** — Filter dehydrated state to typed value entries.

```ts
// Server
const state = Hydration.dehydrate(registry, [["count", countAtom]]);

// Client
Hydration.hydrate(registry, state, { count: countAtom });
```

### Types

- `Hydration.DehydratedAtom`, `Hydration.DehydratedAtomValue`

<br />

## AtomRpc (`src/AtomRpc.ts`)

RPC client factory for flat endpoint maps.

- **`AtomRpc.Tag()(id, { call, runtime? })`** — Create a typed RPC client.
  - `query(tag, payload, options?)` — reactive query
  - `mutation(tag)` — mutation action
  - `refresh(tag, payload)` — force refresh a query

### Types

- `AtomRpc.AtomRpcClient<Defs, R>`

<br />

## AtomHttpApi (`src/AtomHttpApi.ts`)

HTTP API client factory for grouped endpoints.

- **`AtomHttpApi.Tag()(id, { call, runtime? })`** — Create a typed HTTP API client.
  - `query(group, endpoint, request)` — reactive query
  - `mutation(group, endpoint)` — mutation action
  - `refresh(group, endpoint, request)` — force refresh

### Types

- `AtomHttpApi.AtomHttpApiClient<Defs, R>`

<br />

## Effect Integration (`src/effect-ts.ts`)

For practical usage patterns and edge cases, see [`docs/ACTION_EFFECT_USE_RESOURCE.md`](ACTION_EFFECT_USE_RESOURCE.md).

### Async Data

- **`atomEffect(fn, runtime?)`** — Create a reactive async computation. Tracks signal dependencies, interrupts previous fiber on re-run.
- **`queryEffect(fn, options?)`** — Preferred Effect-native query API. Uses ambient Layer runtime from `mount()`. Supports `key` invalidation hooks and optional explicit runtime.
- **`defineQuery(fn, options?)`** — Ergonomic keyed query bundle returning `{ key, result, pending, latest, invalidate, refresh }`.
- **`scopedQueryEffect(scope, fn, options?)`** — Effect constructor variant that creates a scope-bound query accessor.
- **`scopedQuery(scope, fn, options?)`** — Sync convenience wrapper over `scopedQueryEffect(...)`.
- **`queryEffectStrict(runtime, fn, options?)`** — Strict explicit-runtime query helper with optional key tracking.
- **`defineQueryStrict(runtime, fn, options?)`** — Strict explicit-runtime query bundle helper.
- **`createQueryKey<A>(name?)`** — Create typed invalidation keys for queries.
- **`invalidate(key)` / `refresh(key)`** — Invalidate one or many query keys.
- **`isPending(result)`** — `true` only during `Refreshing` (not initial `Loading`).
- **`latest(result)`** — Returns the last successful value, or `undefined` if none.

### Services

- **`useService(tag)`** — Synchronously access a service from the ambient runtime. Throws if called outside a `mount(..., layer)` tree.
- **`use(tag)`** — Alias of `useService(tag)`.
- **`useServices({ ...tags })`** — Resolve multiple services at once with inferred return types.
- **`mount(fn, container, layer)`** — Bootstrap a `ManagedRuntime` from a `Layer` and render.
- **`createMount(layer)` / `mountWith(layer)`** — Create a mount function pre-bound to a layer.
- **`layerContext(layer, fn, runtime?)`** — Run a function with a Layer-provided context.
- **`scopedRootEffect(scope, fn)`** — Effect constructor variant for creating a reactive root tied to an Effect Scope.
- **`scopedRoot(scope, fn)`** — Sync convenience wrapper over `scopedRootEffect(...)`.

### Mutations

- **`createOptimistic(source)`** — Create an optimistic overlay with `get`, `set`, `clear`, `isPending`.
- **`mutationEffect(fn, options?)`** — Create an Effect-powered mutation action with `optimistic`, `rollback`, `onSuccess`, `onFailure`, `refresh` hooks. Returns `{ run, result, pending }`. Supports `invalidates` query keys.
- **`scopedMutationEffect(scope, fn, options?)`** — Effect constructor variant that creates a scope-bound mutation handle.
- **`scopedMutation(scope, fn, options?)`** — Sync convenience wrapper over `scopedMutationEffect(...)`.
- **`mutationEffectStrict(runtime, fn, options?)`** — Strict explicit-runtime mutation helper.


### OO Facade

- **`signal(initial)`** — Create a `SignalRef<T>` with `get()`/`set(v)`.
- **`computed(fn)`** — Create a `ComputedRef<T>` with `get()`.

### AsyncResult

The async state type used by `atomEffect` and `queryEffect`:

| Variant | Description |
|---------|-------------|
| `Loading` | Initial load, no value yet |
| `Refreshing<A, E>` | Revalidating with previous settled value |
| `Success<A>` | Settled with a value |
| `Failure<E>` | Settled with a typed error |
| `Defect` | Unexpected defect or interrupt |

Constructors/helpers: `AsyncResult.loading`, `refreshing`, `success`, `failure`, `defect`, `settled`, `fromExit`, `toExit`, `toOption`, `rawCause`

Guards: `AsyncResult.isLoading`, `isRefreshing`, `isSuccess`, `isFailure`, `isDefect`

### Control-Flow Components

- **`Async({ result, loading?, success?, error? })`** — Render slots based on AsyncResult state.
- **`Loading({ when, fallback?, children })`** — Show children while loading.
- **`Errored({ result, children })`** — Show children on error.
- **`Show({ when, fallback?, children })`** — Conditional rendering.
- **`For({ each, children })`** — List rendering with keying.
- **`Switch` / `Match({ when, children })`** — Multi-case conditional.
- **`MatchTag({ value, cases, fallback? })`** — Type-safe `_tag` pattern matching.
- **`Optional({ when, fallback?, children })`** — Render when truthy.
- **`MatchOption({ value, some, none? })`** — Match Effect `Option`.
- **`Dynamic({ component, ...props })`** — Dynamic component selection.
- **`WithLayer({ layer, runtime?, fallback?, children })`** — Provide a Layer boundary.
- **`Frame({ children })` / `createFrame(initial?)`** — Animation frame loop.

### Types

- `AsyncResult<A, E>`, `Loading`, `Refreshing<A, E>`, `Success<A>`, `Failure<E>`, `Defect`
- `RuntimeLike<R, E>`, `OptimisticRef<T>`, `MutationEffectHandle<A, E>`, `MutationEffectOptions<A, E, R>`
- `SignalRef<T>`, `ComputedRef<T>`

<br />

## Reactive Core (`src/api.ts`)

Solid.js-compatible reactive primitives:

- `createSignal<T>(initial, options?)` → `[Accessor<T>, Setter<T>]`
- `createEffect(fn)` — Run side effect when dependencies change.
- `createMemo(fn, options?)` → `Accessor<T>` — Cached derived value.
- `createRoot(fn)` — Create a new reactive ownership scope.
- `createContext(defaultValue)` / `useContext(ctx)` — Dependency injection.
- `onCleanup(fn)` — Register cleanup when owner disposes.
- `onMount(fn)` — Run after component mounts.
- `untrack(fn)` / `sample(fn)` — Read without tracking.
- `batch(fn)` — Batch updates.
- `mergeProps(...sources)` / `splitProps(props, keys)` — Props utilities.
- `getOwner()` / `runWithOwner(owner, fn)` — Ownership utilities.

### Types

- `Accessor<T>`, `Setter<T>`, `SignalOptions<T>`, `Context<T>`

<br />

## DOM Runtime (`src/dom.ts`)

Functions called by `babel-plugin-jsx-dom-expressions` compiled output:

- `template(html)` — Create reusable DOM template from HTML string.
- `insert(parent, accessor, marker?, current?)` — Insert reactive children.
- `createComponent(Comp, props)` — Instantiate a component in a new reactive root.
- `spread(node, accessor, isSVG?, skipChildren?)` — Reactive prop spreading.
- `attr(node, name, value)` / `prop(node, name, value)` — Set attributes/properties.
- `classList(node, value, prev?)` — Reactive class toggling.
- `style(node, value, prev?)` — Reactive inline styles.
- `delegateEvents(events)` — Set up global event delegation.
- `render(fn, container)` — Mount a component tree. Returns dispose function.
- `renderWithHMR(fn, container, hot?, key?)` — Mount with Vite HMR self-accept + previous dispose handling.
- `withViteHMR(dispose, hot?, key?)` — Attach any disposer to Vite HMR lifecycle.

### SSR

- **`isServer`** — `true` when `window`/`document` are unavailable.
- **`renderToString(fn)`** — Render component tree to HTML string using virtual DOM.
- **`hydrateRoot(fn, container)`** — Attach reactivity to server-rendered DOM. Returns dispose function.
- **`isHydrating()`** — `true` during hydration pass.
- **`getNextHydrateNode()`** — Advance hydration walker (for custom component hydration).
- **`getRequestEvent()` / `setRequestEvent(event)`** — SSR request context.

For JSX runtime transforms, use the package entry: `effect-atom-jsx/runtime`.
