# API Reference

`effect-atom-jsx` exports a reactive core, Effect integration utilities, and DOM runtime helpers.

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
