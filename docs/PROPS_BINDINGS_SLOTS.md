# Props, Bindings, And Slots

This document defines three different component surfaces in AF-UI:

```ts
Component<Props, Req, E, Bindings, SlotContract>
```

These axes should stay separate because they represent different ownership
boundaries.

For the async consistency role of bindings, see
[`BINDINGS_ASYNC_COMMIT_BOUNDARY.md`](BINDINGS_ASYNC_COMMIT_BOUNDARY.md).
For why `Component.state()` exists as a local ownership helper rather than a
separate state model, see
[`COMPONENT_STATE_OWNERSHIP.md`](COMPONENT_STATE_OWNERSHIP.md).
For the practical setup/view comparison with React, Solid, and Foldkit, see
[`SETUP_VIEW_COMPARISON.md`](SETUP_VIEW_COMPARISON.md).

## Summary

| Axis | Owner | Purpose | Public? |
| --- | --- | --- | --- |
| `Props` | parent/caller | configure a component instance | yes |
| `Bindings` | component implementation | hold setup-created state and services | no |
| `SlotContract` / `Slots` | component author | publish structural attachment points | yes |

Short version:

```text
Props    = what the caller configures
Bindings = what setup creates privately
Slots    = what outside styles and behaviors can target
```

## Props

Props are caller inputs. They configure an instance of a component.

```tsx
<Field label="Email" required />
```

Props should answer:

- What does the parent want this component to render or do?
- What controlled values or callbacks does the parent intentionally own?
- What domain configuration is part of this component's public API?

Examples:

```ts
type FieldProps = {
  readonly label: string;
  readonly required?: boolean;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
};
```

Props are not a good place for internal subscriptions, local atoms, renderer
handles, style attachment handles, or behavior wiring. If a parent owns a value,
make it a prop. If setup creates it, it is a binding. If external styles or
behaviors target it structurally, it is a slot.

## Bindings

Bindings are the component implementation's private setup output.

They are created by `setup` and consumed by the component's own `view` function.
They may include local atoms, queries, actions, schedules, services, handles,
derived state, cleanup-aware resources, and implementation helpers.

Bindings also form the component-level async commit boundary: setup may collect
and resolve async dependencies, and the normal view renders from the committed
binding snapshot rather than half-real in-flight values.

```ts
type FieldBindings = {
  readonly value: Atom.WritableAtom<string>;
  readonly focused: Atom.Atom<boolean>;
  readonly validate: () => Effect.Effect<void>;
};
```

Bindings should answer:

- What state/resources did setup create?
- What does this component's own view need to render?
- What implementation details should wrappers preserve but callers should not
  construct?

Bindings are intentionally not the component's customization API. A parent
should not need to know that `Field` uses a `focused` atom or a `validate`
effect internally.

When implementation state genuinely must be caller-owned, expose that state as
props intentionally:

```ts
type ControlledFieldProps = {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
};
```

That is controlled component design, not a reason to collapse bindings into
props.

## Slots

Slots are the component's public structural attachment surface.

In the target design, the authored slot surface is a `View.Slots` contract:

```ts
const Root = View.Slot.make("root", {
  capability: Element.Capability.Container,
});

const Input = View.Slot.make("input", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input],
});

const FieldSlots = View.Slots.make({
  root: View.Slot.bind(Root, Element.container()),
  input: View.Slot.bind(Input, Element.textInput()),
});
```

Slots should answer:

- What named structure does this component expose?
- What capabilities do those structural points support?
- What can outside styles and behaviors target safely?

The runtime handle projection is:

```ts
type FieldHandles = View.Slots.HandlesOf<typeof FieldSlots>;
```

The component publishes the contract:

```ts
const Field = Component.make(...)
  .pipe(Component.withSlots(FieldSlots));
```

Styles and behaviors consume the same contract:

```ts
const fieldStyle = Style.forSlots(FieldSlots)({
  input: Style.slot({ color: "red" }),
});

const fieldBehavior = Behavior.forSlots(FieldSlots)((elements) =>
  Effect.succeed({ inputKind: elements.input.kind }),
);

const StyledField = Field.pipe(
  Style.attachToSlots(fieldStyle, FieldSlots),
  Behavior.attachToSlots(fieldBehavior, FieldSlots),
);
```

The component author writes slot identity once. The handle map, metadata,
diagnostics, and style/behavior types derive from that contract.

## Why Not Put Everything In Props?

Everything could be represented as props mechanically, but it would make props
do too many jobs:

1. Caller configuration.
2. Component-private runtime state.
3. Public structural attachment surface.

That loses ownership clarity.

### If Bindings Become Props

The parent would need to construct implementation details:

```ts
<Field
  valueAtom={value}
  focusedAtom={focused}
  validate={validate}
/>
```

That makes the component less encapsulated. Changing the implementation from a
local atom to a query, or from one validation strategy to another, becomes a
public API change.

Some components should be controlled. In those cases, expose the controlled
state intentionally as props. But the component's setup-created resources should
remain bindings.

### If Slots Become Props

Styling and behavior customization usually turns into ad hoc prop conventions:

```tsx
<Field
  inputStyle={...}
  rootClass="..."
  onInputFocus={...}
  components={{ Input }}
/>
```

Every component then invents its own customization API. Styles and behaviors
become component-specific prop plumbing instead of reusable attachments over a
shared structural model.

AF-UI wants the opposite:

```ts
Field.pipe(
  Style.attachToSlots(fieldStyle, FieldSlots),
  Behavior.attachToSlots(fieldBehavior, FieldSlots),
);
```

The style/behavior API is uniform because components expose slots as a separate
structural contract.

## Separation Of Concerns

The split creates three clear boundaries.

### Caller Boundary

Props are the caller boundary. They represent the intentional input API.

Changing props is a product/API decision.

### Implementation Boundary

Bindings are the implementation boundary. They represent the resources setup
creates so the component can render and manage effects.

Changing bindings should usually not affect callers, styles, or behaviors.

### Composition Boundary

Slots are the composition boundary. They represent the public structure that
external styles, behaviors, routes, devtools, diagnostics, and renderer adapters
can reason about.

Changing public slots is a structural API decision.

## Type Safety

The type system enforces different things on each axis.

### Props Type Safety

Props validate caller input:

```ts
Component.props<FieldProps>()
```

The caller cannot pass unknown or incorrectly typed configuration without a type
error.

### Binding Type Safety

Bindings preserve setup output through the component implementation and wrappers:

```ts
type BindingsOfField = Component.BindingsOf<typeof Field>;
```

Wrapper helpers such as layers, guards, styles, behaviors, routes, and setup
transforms should preserve or intentionally transform the binding type.

### Slot Type Safety

Slot contracts protect outside composition:

```ts
Style.forSlots(FieldSlots)({
  input: Style.slot({ color: "red" }),

  // type error: not part of FieldSlots
  missing: Style.slot({ color: "red" }),
});
```

Capabilities also constrain what can attach:

```ts
const Input = View.Slot.make("input", {
  capability: Element.Capability.TextInput,
});
```

A behavior that requires a text input should not attach to a container slot.
Capability hierarchy lets specific capabilities satisfy broader requirements:
`TextInput` can satisfy `Focusable`, `Interactive`, and `Base`.

Hidden slots are excluded from normal public attachment. Dynamic/generated
attachment paths can still be validated at runtime.

## How The Axes Compose

A component can use all three axes without mixing their responsibilities:

```ts
type FieldProps = {
  readonly label: string;
};

type FieldBindings = {
  readonly value: Atom.WritableAtom<string>;
};

const Field = Component.make<FieldProps, never, never, FieldBindings>(
  Component.props<FieldProps>(),
  Component.require<never>(),
  () => Effect.succeed({
    value: Atom.value(""),
  }),
  (props, bindings) =>
    View.fromSlots(FieldSlots, null, {
      tree: View.element(Root, {
        children: [
          View.textNode(props.label),
          View.element(Input),
        ],
      }),
    }),
).pipe(
  Component.withSlots(FieldSlots),
);
```

The parent controls `label`.

The component owns `value`.

Styles and behaviors target `root` and `input`.

## Design Rules

- Put caller-owned configuration in `Props`.
- Put setup-created implementation state in `Bindings`.
- Put public structural attachment points in `View.Slots`.
- Do not make parents construct bindings unless the value is intentionally
  controlled.
- Do not use props as a substitute for style/behavior attachment APIs.
- Do not use bindings as the public slot contract.
- Prefer `Component.withSlots(...)` and `Component.SlotContractOf<T>` as the
  public slot contract model.
- Treat string slot maps as dynamic/generated APIs, not the authored path.
