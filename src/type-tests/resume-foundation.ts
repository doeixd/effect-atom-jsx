import { Effect } from "effect";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as View from "../View.js";

const CardSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
});

const Card = Component.make(
  Component.props<{ readonly id: string }>(),
  Component.require<never>(),
  Component.setup<{ readonly id: string }>()
    .value("label", ({ props }) => `card:${props.id}`),
  (_props, bindings) => View.fromSlots(CardSlots, bindings.label),
).pipe(
  Component.withSlots(CardSlots),
  Component.withDefinition({ name: "Card" }),
);

const inspection = Component.inspect(Card);
const namespaceInspection = Component.Component.inspect(Card);

const parsed: { readonly id: string } = inspection.parseProps({ id: "1" });
const setup: Effect.Effect<
  Component.BindingsOf<typeof Card>,
  Component.Errors<typeof Card>,
  Component.Requirements<typeof Card>
> = inspection.setup(parsed);
const rendered: unknown = inspection.render(
  parsed,
  {
    label: "restored",
    slots: View.Slots.handles(CardSlots),
  },
);
const renderedView:
  | View.View<View.NormalizeSlots<Component.SlotContractOf<typeof Card>>>
  | undefined = inspection.renderView(
    parsed,
    {
      label: "restored",
      slots: View.Slots.handles(CardSlots),
    },
  );

void setup;
void rendered;
void renderedView;
void namespaceInspection;

// @ts-expect-error props remain required and strongly typed
Component.renderWithBindings(Card, {}, {
  label: "restored",
  slots: View.Slots.handles(CardSlots),
});

// @ts-expect-error restored bindings must match the component binding snapshot
Component.renderWithBindings(Card, { id: "1" }, { label: 1 });
