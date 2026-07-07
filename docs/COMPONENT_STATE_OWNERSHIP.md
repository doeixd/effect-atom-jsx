# Component Setup Ownership

`Component.state()` is an authoring helper for component-instance-local writable
state. It is not a claim that all state belongs inside components, and it is not
intended to replace `Atom`.

The important distinction is ownership:

```text
Component.state(initial)
  = this component setup owns a local writable atom for this instance

Atom.*
  = a state description or state primitive whose ownership depends on where it
    is allocated, provided, shared, or run
```

## Why Have Component Helpers?

The library has two useful state levels:

- `Atom` is the general state and effect-reactivity model.
- `Component.setup(...)` is the component-instance resource boundary.

`Component.state(initial)` sits at the second level. It says: create a writable
atom as part of this component setup, expose it in this component's `Bindings`,
and let the component view render from that binding.

When setup runs with a component `Scope`, `Component.state()` registers with
that scope. Closing the scope marks the atom as disposed and later writes throw.
This is the runtime enforcement that makes the helper more than a naming alias.
When `Component.setupEffect(...)` is called without a provided scope, the
returned state remains explicitly caller-owned. That path is useful for tests,
server-side inspection, and low-level tooling.

```ts
const Counter = Component.make(
  Component.props<{ readonly initial: number }>(),
  Component.require<never>(),
  Component.setup<{ readonly initial: number }>()
    .bind("count", ({ props }) => Component.state(props.initial)),
  (_props, bindings) => (
    <button onClick={() => bindings.count.update((count) => count + 1)}>
      {bindings.count()}
    </button>
  ),
);
```

That example does not need a global atom, a service, or an external owner. The
state is implementation detail for one component instance.

The same rule applies to the other requirement-free component setup helpers:

- `Component.signal(...)` returns a local signal setter that rejects writes after
  the setup scope closes.
- `Component.effect(...)` creates its reactive owner under the setup scope, so
  cleanup runs when the scope closes even when setup is not running inside a DOM
  owner.
- `Component.query(...)` creates its query owner under the setup scope, so query
  fibers and polling cleanup follow component lifetime.
- `Component.action(...)` creates its mutation owner under the setup scope and
  rejects later runs after scope close.
- `Component.optimistic(...).action(...)` follows the same action rule and also
  guards rollback/clear writes after scope close.
- `Component.ref<T>()` clears `.current` when the setup scope closes.

Helpers that already require `Scope.Scope`, such as
`Component.fromDequeue(...)`, `Component.schedule(...)`, and
`Component.scheduleEffect(...)`, keep using Effect's scoped finalization
directly.

## Is It Superfluous?

It would be superfluous if it were presented as a new state model.

It is useful if it has a narrow meaning:

- local to one component instance
- created during setup
- returned as a named binding
- preserved through component wrappers as part of `Bindings`
- disposed with the component setup scope when one is available
- no service requirement
- no public customization contract

In other words, `Component.state()` is a convenience for the common case where
setup needs local writable state. It should not be the only way to create state.

## Why Not Just Use `Atom`?

Use `Atom` directly when the state is not owned by a single component instance.

Good `Atom` use cases:

- shared state across components
- state created by a service or runtime
- reusable domain state
- server/cache/query state
- state families keyed by identity
- effectful atoms with typed requirements and errors
- state passed into a component as a prop

Good `Component.state()` use cases:

- open/closed state for one popover instance
- current tab inside one widget
- local input draft before submit
- transient hover/focus/drag state
- pagination state owned by a single list component

The difference is not capability. Both produce atoms. The difference is where
the atom is allocated and who owns it.

The current implementation uses the same writable atom shape as the rest of the
library. `Component.state()` adds the setup ownership boundary: scoped component
state rejects writes after the setup scope closes, while shared `Atom` values
remain governed by their own runtime/owner.

## Why Not Put It In Props?

Props are caller-owned configuration. Component state is implementation-owned
state.

If the parent should control the value, make it a prop:

```ts
type ControlledFieldProps = {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
};
```

If the component owns the draft value, keep it in setup:

```ts
const Field = Component.make(
  Component.props<{ readonly initialValue?: string }>(),
  Component.require<never>(),
  Component.setup<{ readonly initialValue?: string }>()
    .bind("draft", ({ props }) => Component.state(props.initialValue ?? "")),
  (_props, bindings) => (
    <input
      value={bindings.draft()}
      onInput={(event) => bindings.draft.set(event.currentTarget.value)}
    />
  ),
);
```

Collapsing local implementation state into props makes every internal detail a
public API. That weakens component encapsulation and makes composition noisier.

## Why Not Put It In Bindings Manually?

You can. `Bindings` are just the setup output.

`Component.state()` is useful because it gives local writable state the same
setup shape as `Component.query(...)`, `Component.action(...)`,
`Component.effect(...)`, and setup fragments:

```ts
Component.setup<Props>()
  .bind("query", () => Component.state(""))
  .bind("results", ({ props, bindings }) =>
    Component.query(() => props.search(bindings.query()))
  );
```

Everything in the setup builder has the same composition rule:

```text
setup helper -> Effect<binding, E, R>
```

That keeps requirement and error inference uniform.

`Component.state(...)` contributes no service requirement. If a setup scope is
present in the Effect environment, it registers a finalizer on that scope. If no
scope is present, ownership stays with the caller that requested the bindings.

## What It Should Not Mean

`Component.state()` should not imply:

- all state is component state
- shared atoms should be recreated per component instance
- component-local state is publicly configurable
- setup helpers are a separate state runtime from `Atom`
- component state should bypass the normal atom metadata model
- writes after component scope disposal should silently mutate stale local state

If it is ever only a thin alias with no ownership or inference value, then the
API should be reconsidered. The name earns its place only by making the common
component-local case clear.

## Design Rule

Use this rule:

```text
Caller owns it?        Props.
Component setup owns it? Bindings, often via Component.state().
Shared/runtime owns it? Atom, service, query, family, or layer.
External style/behavior targets it structurally? SlotContract / View.Slots.
```

`Component.state()` belongs in the second line only.

The broader version:

```text
Component.* setup helpers are local ownership helpers.
Atom.* remains the shared/general state model.
Effect Scope remains the lifetime authority.
```
