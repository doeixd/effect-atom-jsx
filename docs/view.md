# View And Slots

`View` is the renderer-neutral structure that exposes a component's slots.
Authored components use `View.Slots.define(...)` and `View.fromSlots(...)`;
styles, behaviors, diagnostics, and renderers consume the same contract.

## Mental Model

- A **slot** is a named attachment point with capability metadata.
- A **slot contract** is a typed object of slots.
- A **view** pairs a host node/JSX payload with the runtime handles for those
  slots.
- A **component** publishes its authored slot contract with
  `Component.withSlots(...)`.

```ts
Component<Props, Req, E, Bindings, SlotContract> -> View<Slots>
```

## Golden Path

```tsx
import { Component, Element, View } from "effect-atom-jsx";
import { Effect } from "effect";

const FieldSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  label: { capability: Element.Capability.Container },
  input: {
    capability: Element.Capability.TextInput,
    allowedEvents: [View.Event.Input, View.Event.Focus],
    allowedAttributes: [View.Attribute.AriaLabel],
  },
});

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
```

`View.fromSlots(...)` creates runtime handles for the contract and attaches
slot metadata to the returned view. The JSX payload remains renderer-owned; the
slot contract is the stable API surface.

## Slot Definitions

Use `View.Slots.define(...)` for authored contracts:

```ts
const DialogSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  trigger: {
    capability: Element.Capability.Interactive,
    allowedEvents: [View.Event.Press],
  },
  content: {
    capability: Element.Capability.Container,
    allowedAttributes: [View.Attribute.Role, View.Attribute.AriaDescribedby],
  },
});
```

Slot metadata can include:

- `capability`: required element capability.
- `allowedEvents`: event metadata used by behavior diagnostics.
- `allowedAttributes`: attribute metadata used by diagnostics and accessibility
  contracts.
- `hidden`: private slot marker when created with `View.hidden(...)`.

Low-level helpers:

- `View.slot(name, options?)`
- `View.hidden(name, options?)`
- `View.Slot.make(name, options?)`
- `View.Slot.bind(slot, handle)`
- `View.Slots.make(boundSlots)`
- `View.Slots.handles(slots)`

Use these when generated/dynamic code needs explicit handle control. For
authored components, prefer `View.Slots.define(...)` and `View.fromSlots(...)`.

## View Construction

- `View.fromSlots(slots, node)` is the authored path.
- `View.fromJsx(slots, node)` is an alias for JSX-first authoring.
- `View.make(slots, node, metadata?)` is the low-level dynamic constructor.

```ts
const view = View.fromSlots(CardSlots, <article />);

view.slots.root.getStyle("padding");
view.node; // renderer-owned payload
```

## Typed Trees

Views can carry renderer-neutral tree metadata. This lets diagnostics and
tooling reason about structure without requiring DOM access.

```ts
const tree = View.element("article", {
  children: [
    View.element("h2"),
    View.text("Body"),
  ],
});

const view = View.make(slots, node, { tree });
```

`View.fromSlots(...)` attaches default tree metadata when no explicit tree is
provided. JSX compiler extraction is still a renderer/tooling concern; the
runtime API already has the metadata channel.

## Slot Remapping And Hidden Slots

Remaps adapt one component's slot names to another contract:

```ts
const remapped = View.withRemaps(
  View.remap("surface", "root"),
)(view);
```

Hidden slots are available to component internals but should not be targeted by
public style/behavior attachments. Diagnostics report hidden-slot attachment
attempts.

```ts
const Slots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  privateMeasure: View.hidden("privateMeasure", {
    capability: Element.Capability.Container,
  }),
});
```

## Diagnostics And Validation

Use validation helpers for dynamic/generated integrations and tooling:

- `View.validateSlotTargets(view, names)` reports unknown or hidden targets.
- `View.validateRemaps(...)` checks capability compatibility for declared
  remaps.
- `View.validatePlatform(...)` checks slot capability/event/attribute support
  against a platform declaration.
- `View.platform(metadata, options?)` creates a platform diagnostic layer.

Compile-time safety is preferred for authored code. Runtime diagnostics are
still useful for generated code, cross-platform validation, and development
tooling.

## Capability Model

Element capabilities are hierarchical:

```txt
TextInput -> Focusable -> Interactive -> Base
Container -> Interactive -> Base
Draggable -> Interactive -> Base
Collection -> Base
```

A slot requiring `Interactive` accepts a `TextInput`; a slot requiring
`TextInput` does not accept a generic `Interactive` handle. Custom capabilities
can extend built-ins:

```ts
const DateInput = Element.Capability.make("DateInput", {
  extends: [Element.Capability.TextInput],
});
```

## Related Docs

- `docs/SLOT_CONTRACT_GOLDEN_PATH.md`
- `docs/component.md`
- `docs/style.md`
- `docs/API.md`
