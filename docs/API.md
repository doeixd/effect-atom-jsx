# API Reference

`effect-atom-jsx` exports a reactive core, Effect integration utilities, and DOM runtime helpers.

## Effect-Atom Style Main API

### `Atom` (`src/Atom.ts`)

- `Atom.make(value | read)`
- `Atom.readable(read)`
- `Atom.writable(read, write)`
- `Atom.family(fn)`
- `Atom.map(...)`
- `Atom.withFallback(...)`
- `Atom.batch(fn)`
- `Atom.get(atom) => Effect.Effect<A>`
- `Atom.set(atom, value)`
- `Atom.update(atom, fn)`
- `Atom.modify(atom, fn)`
- `Atom.refresh(atom)`
- `Atom.subscribe(atom, listener, options?)`

Types:
- `Atom.Atom<A>`
- `Atom.Writable<R, W>`
- `Atom.Context`
- `Atom.WriteContext<A>`

### `Result` (`src/Result.ts`)

- `Result.initial(waiting?)`
- `Result.success(value, options?)`
- `Result.failure(error, options?)`
- `Result.isInitial/isSuccess/isFailure/isWaiting`
- `Result.isNotInitial`
- `Result.fromAsyncResult(...)`
- `Result.toAsyncResult(...)`
- `Result.waiting(...)`

Type:
- `Result.Result<A, E>`

### `Registry` (`src/Registry.ts`)

- `Registry.make()`
- registry instance methods:
  - `get`, `set`, `update`, `modify`
  - `mount`, `refresh`, `subscribe`
  - `reset`, `dispose`

Type:
- `Registry.Registry`

### `AtomRef` (`src/AtomRef.ts`)

- `AtomRef.make(initial)`
- `ref.prop(key)`
- `ref.set(value)`
- `ref.update(fn)`
- `ref.subscribe(listener)`
- `AtomRef.collection(items)` with:
  - `push`, `insertAt`, `remove`, `toArray`

Types:
- `AtomRef.AtomRef<A>`
- `AtomRef.ReadonlyRef<A>`
- `AtomRef.Collection<A>`

### `Hydration` (`src/Hydration.ts`)

- `Hydration.dehydrate(registry, entries)`
- `Hydration.toValues(state)`
- `Hydration.hydrate(registry, state, resolvers)`

Types:
- `Hydration.DehydratedAtom`
- `Hydration.DehydratedAtomValue`

## Reactive Core (`src/api.ts`)

- `createSignal<T>(initial, options?) => [Accessor<T>, Setter<T>]`
- `createEffect(fn, initialValue?)`
- `createMemo(fn, options?) => Accessor<T>`
- `createRoot(fn)`
- `createContext(defaultValue)` / `useContext(context)`
- `onCleanup(fn)` / `onMount(fn)`
- `untrack(fn)` / `sample(fn)`
- `batch(fn)`
- `mergeProps(...sources)`
- `splitProps(props, keys)`
- `getOwner()` / `runWithOwner(owner, fn)`

Types:
- `Accessor<T>`
- `Setter<T>`
- `SignalOptions<T>`
- `Context<T>`

## Atom API (`src/effect-ts.ts`)

- `createAtom(value)` writable atom (`get/set/update/subscribe`)
- `createAtom(getter)` derived atom (`get/subscribe`)

Types:
- `Atom<T>`
- `WritableAtom<T>`
- `DerivedAtom<T>`
- `AtomGetter<T>`

## Effect Integration (`src/effect-ts.ts`)

### Async State

- `AsyncResult.loading`
- `AsyncResult.refreshing(previous)`
- `AsyncResult.success(value)`
- `AsyncResult.failure(error)`
- `AsyncResult.defect(cause)`
- `AsyncResult.isLoading/isRefreshing/isSuccess/isFailure/isDefect`

Types:
- `Loading`
- `Refreshing<A, E>`
- `Success<A>`
- `Failure<E>`
- `Defect`
- `AsyncResult<A, E>`

### Data / Services

- `atomEffect(fn, runtime?)`
- `resource(fn)`
- `resourceWith(runtime, fn)`
- `isPending(result)`
- `use(tag)`
- `mount(fn, container, layer)`
- `layerContext(layer, fn, runtime?)`
- `scopedRoot(scope, fn)`

Type:
- `RuntimeLike<R, E = never>`

### Atom-like OO Facade

- `signal(initial)`
- `computed(fn)`

Types:
- `SignalRef<T>`
- `ComputedRef<T>`

### Mutation / Optimistic Helpers

- `createOptimistic(source)`
- `actionEffect(fn, options?)`

Types:
- `OptimisticRef<T>`
- `ActionEffectHandle<A, E>`
- `ActionEffectOptions<A, E, R>`

### Control-flow Helpers

- `Async(props)`
- `For(props)`
- `Show(props)`

## DOM Runtime (`src/dom.ts`)

- `template`
- `insert`
- `createComponent`
- `spread`
- `attr`
- `prop`
- `classList`
- `style`
- `delegateEvents`
- `render`
- `effect`
- `memo`

For JSX runtime transforms, use the package runtime entry: `effect-atom-jsx/runtime`.
