# Slot Contract Golden Path

This is the preferred authored shape for structural UI in AF-UI.

The component author defines slot identity once with `View.Slot` and
`View.Slots`. Components publish that contract with `Component.withSlots(...)`.
Styles and behaviors consume the same contract from the outside.

```ts
import { Effect } from "effect";
import { Behavior, Component, Element, Style, View } from "effect-atom-jsx";

const Root = View.Slot.make("root", {
  capability: Element.Capability.Container,
});

const Label = View.Slot.make("label", {
  capability: Element.Capability.Container,
});

const Input = View.Slot.make("input", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input, View.Event.Focus],
  allowedAttributes: [View.Attribute.AriaLabel],
});

const FieldSlots = View.Slots.make({
  root: View.Slot.bind(Root, Element.container()),
  label: View.Slot.bind(Label, Element.container()),
  input: View.Slot.bind(Input, Element.textInput()),
});

const Field = Component.make(
  Component.props<{ readonly label: string }>(),
  Component.require<never>(),
  Component.setup<{ readonly label: string }>()
    .value("slots", () => View.Slots.handles(FieldSlots)),
  (props) =>
    View.fromSlots(FieldSlots, null, {
      tree: View.element(Root, {
        children: [
          View.element(Label, {
            children: [View.textNode(props.label)],
          }),
          View.element(Input),
        ],
      }),
    }),
).pipe(
  Component.withSlots(FieldSlots),
);

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

const StyledField = Field.pipe(
  Style.attachToSlots(FieldStyle, FieldSlots),
  Behavior.attachToSlots(FieldBehavior, FieldSlots),
);
```

## Rules

- `View.Slots` is the authored structural contract.
- `Component.SlotContractOf<typeof Field>` returns that authored contract.
- `Component.SlotsOf<typeof Field>` returns the handle-map projection.
- `Style.forSlots(...)` and `Behavior.forSlots(...)` are the authored APIs.
- `Style.attachToSlots(...)` and `Behavior.attachToSlots(...)` attach to the
  same contract.
- Direct `slotMetadata` and string slot maps are low-level dynamic/generated
  APIs, not the authored golden path.
