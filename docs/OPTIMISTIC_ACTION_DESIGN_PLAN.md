# Optimistic Action Design Plan

This plan defines the improved design for optimistic updates, actions,
mutations, async state, pending indicators, rollback, and revalidation.

For the target end-user experience, see
[`ASYNC_COUNTER_OPTIMISTIC_EXAMPLE.md`](ASYNC_COUNTER_OPTIMISTIC_EXAMPLE.md).

It follows the same direction as the slot contract work:

- one authored model
- typed projections from that model
- low-level escape hatches for dynamic or specialized cases
- Effect requirements and typed errors preserved end to end

## Thesis

Optimistic UI should be authored as an atom/action lifecycle, not as loose
callback glue around a separate mutation handle.

The current primitives are useful:

- `createOptimistic(source)` creates a temporary overlay.
- `defineMutation(...)` runs callback-style mutation lifecycles.
- `Atom.runtime(layer).action(...)` runs service-backed writes.
- `Component.action(...)` creates component-local write handles.
- `Result` represents async loading, refreshing, success, typed failure, and
  defects.

The problem is that the golden path asks users to manually coordinate these
pieces:

```ts
const optimistic = createOptimistic(count);

const save = defineMutation(api.save, {
  optimistic: (next) => optimistic.set(next),
  rollback: () => optimistic.clear(),
  onSuccess: (next) => {
    count.set(next);
    optimistic.clear();
  },
});
```

That is powerful, but it leaks orchestration. Users must remember when to set
the overlay, when to clear it, how to commit, how to rollback, what to read in
the view, and which result/pending handle belongs to which visible value.

The right authored API should make optimistic state and mutation lifecycle one
coherent handle.

## Design Principle

Committed state and optimistic state are separate, but the read surface should
be unified.

```text
committed atom       durable truth
optimistic overlay   temporary visible truth
action effect        async write attempt
result               lifecycle state
pending              derived from result
rollback             restoring committed truth
reconcile            replacing temporary truth with server truth
invalidate/refresh   dependent read consistency
```

The UI should usually read one value:

```ts
saveCount.value()
```

It should not have to know whether that value is confirmed or optimistic unless
it explicitly asks:

```ts
saveCount.optimistic()
saveCount.pending()
saveCount.result()
```

## Proposed Golden Path

Prefer an `Atom.optimistic(...)` builder:

```ts
const count = Atom.writable(0);

const saveCount = Atom.optimistic(count).action({
  name: "counter.save",

  update: (current, delta: number) => current + delta,

  effect: (next, delta) =>
    api.saveCount(next),

  commit: (next) =>
    count.set(next),
});
```

View code reads the handle:

```tsx
<div>Count: {saveCount.value()}</div>

<button disabled={saveCount.pending()} onClick={() => saveCount.run(-1)}>
  -
</button>

<button disabled={saveCount.pending()} onClick={() => saveCount.run(1)}>
  +
</button>
```

Failure UI reads the same async model as the rest of the library:

```tsx
{Result.match(saveCount.result(), {
  onLoading: () => null,
  onRefreshing: () => "Saving...",
  onSuccess: () => null,
  onFailure: (error) => `Save failed: ${error.message}`,
  onDefect: (cause) => `Unexpected failure: ${cause}`,
})}
```

## Proposed Component Setup Shape

Component-local state should have the same authored model:

```ts
const Counter = Component.make(
  Component.props<{ readonly initial: number }>(),
  Component.require<CounterApi>(CounterApi),
  Component.setup<{ readonly initial: number }>()
    .bind("count", ({ props }) => Component.state(props.initial))
    .bind("saveCount", ({ bindings }) =>
      Component.optimistic(bindings.count).action({
        name: "counter.save",
        update: (current, delta: number) => current + delta,
        effect: (next) =>
          CounterApi.pipe(Effect.flatMap((api) => api.saveCount(next))),
        commit: (next) => bindings.count.set(next),
      })
    ),
  (_props, bindings) => (
    <button onClick={() => bindings.saveCount.run(1)}>
      {bindings.saveCount.value()}
    </button>
  ),
);
```

`Component.optimistic(...)` should be a component-scoped convenience over
`Atom.optimistic(...)`, just as `Component.state`, `Component.query`, and
`Component.action` are setup-scoped conveniences over lower-level primitives.

## Handle Shape

An optimistic action handle should expose:

```ts
interface OptimisticActionHandle<Input, A, E> {
  readonly value: Accessor<A>;
  readonly committed: Accessor<A>;
  readonly optimistic: Accessor<A | undefined>;
  readonly hasOptimistic: Accessor<boolean>;

  readonly result: Accessor<Result<void, E>>;
  readonly pending: Accessor<boolean>;

  run(input: Input): void;
  effect(input: Input): Effect.Effect<void, E | BridgeError | MutationSupersededError>;
  runEffect(input: Input): Effect.Effect<A, E | BridgeError | MutationSupersededError>;

  rollback(): void;
  clear(): void;
}
```

Notes:

- `value()` reads the optimistic value when present, otherwise the committed
  source value.
- `committed()` always reads the source.
- `optimistic()` exposes only the overlay value.
- `pending()` is derived from `result()`.
- `runEffect(input)` should preserve the action success value where possible.
- `rollback()` and `clear()` may be aliases initially, but the names carry
  different intent: failure recovery vs removing a temporary overlay.

## Basic State Algorithm

For a simple optimistic action:

```ts
Atom.optimistic(source).action({
  update,
  effect,
  commit,
})
```

`run(input)` should:

1. Read `base = value()`.
2. Compute `next = update(base, input)`.
3. Store `next` as the optimistic overlay.
4. Set `result` to `Loading` or `Refreshing(previous)`.
5. Run `effect(next, input, context)`.
6. On success:
   - commit the confirmed value
   - clear the overlay
   - set `result = Success`
   - run refresh/invalidation hooks
7. On typed failure:
   - rollback/clear the overlay
   - set `result = Failure<E>`
8. On defect:
   - rollback/clear the overlay
   - set `result = Defect`

This means the visible value changes immediately, but the committed source only
changes after the Effect succeeds.

## Reconciliation

Some mutations return canonical server data rather than just confirming the
optimistic value. The API needs a reconciliation hook:

```ts
const addTodo = Atom.optimistic(todos).action({
  update: (todos, title: string) => [
    { id: TempId.make(), title, completed: false },
    ...todos,
  ],

  effect: (_optimisticTodos, title) =>
    api.addTodo(title),

  reconcile: (optimisticTodos, savedTodo) =>
    optimisticTodos.map((todo) =>
      TempId.is(todo.id) ? savedTodo : todo
    ),

  commit: (nextTodos) =>
    todos.set(nextTodos),
});
```

Lifecycle:

```text
input -> optimistic next -> server result -> reconciled next -> commit
```

This is more honest than pretending the optimistic value and server value are
the same thing.

## Concurrency

The existing mutation model is latest-run-wins:

- starting a new run interrupts the previous fiber
- stale completions are ignored
- `effect(input)` can fail with `MutationSupersededError`

The optimistic action API should keep this as the default because it is simple
and matches the current implementation.

But collection-heavy optimistic UI eventually needs policies:

```ts
concurrency?: "switch" | "queue" | "drop" | { readonly max: number }
```

Suggested defaults:

- `switch` for scalar state, forms, and saves
- `queue` for ordered append/update operations
- `drop` for idempotent button spam prevention

Do not add every policy in the first implementation slice. Preserve the current
latest-run-wins behavior first, then add policies when tests cover them.

## Requirement And Error Typing

Optimistic actions must preserve the same type strengths as the rest of the
library:

```ts
Atom.optimistic(source).action({
  effect: (next, input) => Effect.Effect<A, E, R>
})
```

The handle should expose:

```ts
OptimisticActionInputOf<T>
OptimisticActionErrorOf<T>
OptimisticActionEffectErrorOf<T>
OptimisticActionSuccessOf<T>
OptimisticActionRequirementsOf<T>
```

Runtime-bound actions should eliminate satisfied requirements:

```ts
const rt = Atom.runtime(ApiLive);

const save = rt.optimistic(count).action({
  effect: (next) => api.save(next),
});
```

Component-scoped actions should bubble unsatisfied requirements through
`Component.Component<Props, Req, E, Bindings, SlotContract>`.

## Relationship To Existing APIs

### `createOptimistic(source)`

Keep as the low-level overlay primitive.

It is useful for:

- specialized UI experiments
- generated code
- manual integration with external mutation systems
- tests

But docs should stop presenting it as the golden path for common optimistic
mutations.

### `defineMutation(...)`

Keep as the callback-style compatibility/dynamic API.

It is useful when:

- callers already have mutation lifecycle callbacks
- code is outside Atom/Component setup
- migration from current examples is needed

But the primary authored path should be `Atom.optimistic(...).action(...)`.

### `Atom.runtime(...).action(...)`

Keep as the primary non-optimistic service-backed write API.

Add optimistic composition:

```ts
Atom.runtime(layer).optimistic(source).action(...)
```

or:

```ts
Atom.optimistic(source).withRuntime(runtime).action(...)
```

Prefer the first form for discoverability.

### `Component.action(...)`

Keep for simple component-local actions.

Add:

```ts
Component.optimistic(source).action(...)
```

for component-local optimistic actions with setup-scoped lifetime.

## Naming

Preferred public naming:

```ts
Atom.optimistic(source)
Atom.withOptimistic()
Component.optimistic(source)
runtime.optimistic(source)
```

Avoid making `createOptimistic(...)` the headline API. It sounds like an
isolated utility, while `Atom.optimistic(...)` says optimistic state is part of
the atom algebra.

Use `action` for authored Effect writes. Use `mutation` only for callback-style
or transport-specific compatibility APIs.

## Result And Pending Semantics

The optimistic action should use the same five-state `Result` model:

- `Loading`: first action run has no previous result
- `Refreshing(previous)`: another run starts after a settled result
- `Success`: last action completed
- `Failure<E>`: typed domain failure
- `Defect`: unexpected failure

`pending()` should be a projection:

```ts
pending = result is Loading | Refreshing
```

Do not add a second pending source. The handle can expose `hasOptimistic()` for
"is the visible value temporary?" because that is a different question.

## Reactivity And Invalidation

Optimistic commit should integrate with existing reactivity keys:

```ts
Atom.optimistic(todos).action({
  update,
  effect,
  commit,
  reactivityKeys: ["todos"],
});
```

On success:

1. commit/reconcile local state
2. invalidate semantic keys
3. refresh queries/loaders

This order gives immediate local consistency while still letting server reads
revalidate the canonical state.

For route mutations and single-flight:

- optimistic state updates immediately
- single-flight response may hydrate loader payloads
- reconciliation can use the mutation result
- invalidation remains semantic and explicit

## Style With Recent AF-UI Design

The recent slot work established a pattern:

```text
authored contract -> typed projections -> runtime diagnostics
```

Optimistic actions should mirror that:

```text
authored optimistic action spec
  -> value projection
  -> result projection
  -> pending projection
  -> Effect type projections
  -> runtime lifecycle diagnostics
```

Possible diagnostics:

- optimistic action committed without clearing overlay
- rollback missing for an action with optimistic update
- reconcile returned a value incompatible with source shape
- action failed after source changed externally
- invalidation key missing for server-backed collection writes

Diagnostics should be dev helpers first, not automatic runtime noise.

## Implementation Slices

### Slice 1: Document And Stabilize The Target API

Status: this plan.

- Add this design plan.
- Update status docs to mark `Atom.optimistic(...)` as the desired golden path.
- Keep current APIs unchanged while implementation is designed.

### Slice 2: Add `Atom.optimistic(source)` Builder

Status: first pass complete.

- Implement a builder over the existing `createOptimistic(source)` primitive.
- Expose `.value`, `.committed`, `.optimistic`, `.hasOptimistic`, `.clear`, and
  `.rollback`.
- Preserve callable atom ergonomics.
- Add runtime tests for overlay reads and clearing.

Implemented:

- `Atom.optimistic(source).action(...)`
- `Atom.runtime(layer).optimistic(source).action(...)`
- handle projections:
  - `value`
  - `committed`
  - `optimistic`
  - `hasOptimistic`
  - `rollback`
  - `clear`
- runtime tests for success commit and typed failure rollback
- type tests for input, value, success, error, run-error, result, runtime-bound
  actions, and component requirement bubbling

### Slice 3: Add `.action(spec)`

Status: first pass complete.

- Build action lifecycle on top of the existing mutation/action machinery.
- Support `update`, `effect`, `commit`, optional `reconcile`, optional
  `reactivityKeys`, and lifecycle hooks.
- Preserve latest-run-wins behavior initially.
- Add tests for success commit, typed failure rollback, defect rollback, and
  superseded runs.

Implemented:

- `update(current, input)` computes the optimistic visible value.
- `effect(next, input)` runs the typed Effect.
- `commit(confirmed, input, success)` can override default source commit.
- `reconcile(optimistic, success, input)` can replace optimistic state with
  server-confirmed state.
- `reactivityKeys`, `singleFlight`, and `onTransition` pass through to the
  existing action machinery.
- `onSuccess` and `onFailure` lifecycle hooks run around commit/rollback.
- runtime tests cover success commit, typed failure rollback, defect rollback,
  server reconciliation, custom commit, latest-run-wins, and reactivity key
  invalidation

Remaining:

- decide whether `rollback` and `clear` should remain aliases or diverge for
  advanced recovery

### Slice 4: Add Runtime And Component Variants

Status: first pass complete.

- Add `Atom.runtime(layer).optimistic(source).action(...)`.
- Add `Component.optimistic(source).action(...)`.
- Ensure requirements are eliminated by runtime-bound variants and bubbled by
  component variants.
- Add type tests for `A`, `E`, `R`, `Input`, and success-value inference.

Implemented:

- `Atom.runtime(layer).optimistic(source).action(...)`
- `Component.optimistic(source).action(...)`
- component runtime coverage for setup-scoped optimistic actions
- focused type tests for `A`, `E`, `Input`, success inference, runtime-bound
  actions, and component requirement bubbling

### Slice 5: Reconcile And Collections

Status: pending.

- Add `reconcile(optimisticValue, success, input)`.
- Add examples for todo add/update/delete with temporary IDs.
- Add tests for rollback preserving previous committed collection state.

### Slice 6: Docs And Examples

Status: pending.

- Rewrite optimistic sections in README/API docs to lead with:
  - `Atom.optimistic(source).action(...)`
  - `runtime.optimistic(source).action(...)`
  - `Component.optimistic(source).action(...)`
- Move `createOptimistic(...)` and `defineMutation(...)` to lower-level or
  compatibility sections.
- Add an async counter example that shows:
  - optimistic visible count
  - pending indicator
  - typed failure rollback
  - `Result.match(...)`
  - revalidation/invalidation

## Acceptance Criteria

- Common optimistic mutations no longer require manual `set/clear/onSuccess`
  callback choreography.
- The visible value, pending state, result state, rollback, and commit lifecycle
  are exposed by one typed handle.
- `Result` remains the only async lifecycle model.
- `pending()` remains a projection from `Result`.
- `hasOptimistic()` answers the separate question of whether visible state is
  temporary.
- Runtime-bound and component-bound optimistic actions preserve Effect
  requirement/error typing.
- Low-level `createOptimistic(...)` and `defineMutation(...)` remain available
  but are no longer the primary authored API.
