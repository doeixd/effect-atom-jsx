# Slot Contract Golden Path

This is the preferred authored shape for structural UI in AF-UI.

The component author defines slot identity once with `View.Slots.define`.
Components publish that contract with `Component.withSlots(...)`. Styles and
behaviors consume the same contract from the outside. JSX is the authored
markup surface — `View.fromSlots(slots, <jsx/>)` takes the rendered node
directly.

```tsx
import { Effect } from "effect";
import { Behavior, Component, Element, Style, View } from "effect-atom-jsx";

// 1. The contract: names from keys, default handles from capabilities.
const FieldSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  label: { capability: Element.Capability.Container },
  input: {
    capability: Element.Capability.TextInput,
    allowedEvents: [View.Event.Input, View.Event.Focus],
  },
});

// 2. The component: setup for logic, JSX for structure.
//    withSlots publishes the contract and injects the slot handles.
const Field = Component.make(
  Component.props<{ readonly label: string }>(),
  Component.require<never>(),
  () => Effect.succeed({}),
  (props) =>
    View.fromSlots(FieldSlots, (
      <label>
        <span>{props.label}</span>
        <input />
      </label>
    )),
).pipe(Component.withSlots(FieldSlots));

// 3. Appearance and interaction attach from outside, keyed by the contract.
const FieldStyle = Style.forSlots(FieldSlots)({
  root: Style.slot({ display: "grid", gap: "0.5rem" }),
  label: Style.slot({ fontWeight: 600 }),
  input: Style.slot({ padding: "0.5rem" }),
});

const FieldBehavior = Behavior.forSlots(FieldSlots)((elements) =>
  Effect.succeed({
    focus: () => elements.input.focus(),
  }),
);

export const StyledField = Field.pipe(
  Style.attachToSlots(FieldStyle, FieldSlots),
  Behavior.attachToSlots(FieldBehavior, FieldSlots),
);
```

## The Tiers

**Cheap tier — no contract.** A private/app-local component that will never
be externally styled or re-behaviored pays zero slot ceremony:

```tsx
const Greeting = Component.make(
  Component.props<{ readonly name: string }>(),
  Component.require<never>(),
  () => Effect.succeed({}),
  (props) => <p>Hello, {props.name}</p>,
);
```

Publish a contract only when the component is part of a design system or
needs an external override surface. That is the decision rule: **contract =
public API; no external customization = no contract.**

**Custom handles.** `View.Slots.define` binds default handles derived from
each capability. When a slot needs a custom or shared handle, drop to the
explicit form for that slot: `View.Slots.make({ input:
View.Slot.bind(InputWitness, myHandle) })`. The two forms produce identical
contracts and mix with the same attachment APIs.

**Typed tree metadata (optional in v1).** `View.fromSlots(slots, node,
{ tree: View.element(...) })` attaches renderer-neutral typed tree metadata.
This is the generated/tooling layer, not the authored surface — JSX is the
authored surface. Typed-tree extraction from JSX is planned for v1.x (see
`docs/V1_SCOPE.md`, Finding 2 decision).

## Rules

- `View.Slots` is the authored structural contract; `View.Slots.define` is
  the one-step authored constructor.
- JSX is the authored markup path (`View.fromSlots(slots, <jsx/>)`);
  `View.element(...)` builders are the typed-tree/generated layer.
- `Component.SlotContractOf<typeof Field>` returns the authored contract.
- `Component.SlotsOf<typeof Field>` returns the handle-map projection.
- `Style.forSlots(...)` / `Behavior.forSlots(...)` are the authored
  attachment constructors; `Style.attachToSlots(...)` /
  `Behavior.attachToSlots(...)` attach to the same contract.
- `attachBySlotContract(...)` is the typed remapping form;
  `attachBySlots(...)` (string maps) and raw `slotMetadata` are the
  dynamic/generated escape hatches.
