import { Effect } from "effect";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Style from "../Style.js";
import * as View from "../View.js";

// Slots.define derives witness names from keys, capabilities from options,
// and default handle types from capabilities — all without explicit generics.
const FieldSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  label: { capability: Element.Capability.Container },
  input: {
    capability: Element.Capability.TextInput,
    allowedEvents: [View.Event.Input, View.Event.Focus],
  },
  secret: { capability: Element.Capability.Interactive, hidden: true },
});

// names are literal
type Names = View.Slots.NamesOf<typeof FieldSlots>;
const names: Names = "input";
void names;
// @ts-expect-error unknown slot name
const badName: Names = "missing";
void badName;

// hidden filtering sees define's hidden flag
type PublicNames = View.Slots.PublicNamesOf<typeof FieldSlots>;
const publicName: PublicNames = "root";
void publicName;
// @ts-expect-error secret is hidden
const hiddenAsPublic: PublicNames = "secret";
void hiddenAsPublic;

// handle types derive from capability
type Handles = View.Slots.HandlesOf<typeof FieldSlots>;
const inputHandle: Handles["input"] = Element.textInput();
void inputHandle;
const rootHandle: Handles["root"] = Element.container();
void rootHandle;
// @ts-expect-error container handle does not satisfy the TextInput slot handle type
const wrongHandle: Handles["input"] = Element.container();
void wrongHandle;

// event metadata is literal
type InputEvents = View.Slot.EventsOf<View.Slots.BoundOf<typeof FieldSlots>["input"]>;
const inputEvent: InputEvents = "input";
void inputEvent;
// @ts-expect-error click is not an allowed event on the input slot
const badEvent: InputEvents = "click";
void badEvent;

// defined contracts flow through fromSlots like hand-built ones
const view = View.fromSlots(FieldSlots, null);
const viewSlots: View.SlotsOf<typeof view> = View.Slots.handles(FieldSlots);
void viewSlots;

// capability filtering works on defined contracts
type TextInputSlots = View.Slots.WithCapability<typeof FieldSlots, typeof Element.Capability.TextInput>;
type TextInputNames = keyof TextInputSlots & string;
const textInputName: TextInputNames = "input";
void textInputName;

// ── Finding 4 acceptance: the authored golden path needs no explicit generics ──
// Props come from Component.props, Req from Component.require, Bindings from
// setup inference, and the slot contract from Component.withSlots.
const Field = Component.make(
  Component.props<{ readonly label: string }>(),
  Component.require<never>(),
  () => Effect.succeed({ draft: "" }),
  (props, bindings) => {
    // props and bindings are fully inferred inside the view
    const label: string = props.label;
    const draft: string = bindings.draft;
    void label;
    void draft;
    return View.fromSlots(FieldSlots, null);
  },
).pipe(Component.withSlots(FieldSlots));

// the published contract is precise without annotations
type FieldContract = Component.SlotContractOf<typeof Field>;
type FieldContractNames = View.Slots.NamesOf<FieldContract>;
const contractName: FieldContractNames = "input";
void contractName;

// styles and behaviors attach without generics and reject unknown slots
const fieldStyle = Style.forSlots(FieldSlots)({
  root: Style.slot({ display: "grid" }),
  input: Style.slot({ padding: "sm" }),
});
const fieldBehavior = Behavior.forSlots(FieldSlots)((elements) => {
  // element types derive from slot capabilities
  const focus: (() => void) | undefined = elements.input.focus;
  void focus;
  return Effect.succeed({});
});
const Styled = Field.pipe(
  Style.attachToSlots(fieldStyle, FieldSlots),
  Behavior.attachToSlots(fieldBehavior, FieldSlots),
);
void Styled;

Style.forSlots(FieldSlots)({
  // @ts-expect-error unknown slot in a contract-keyed style
  missing: Style.slot({ color: "red" }),
});
