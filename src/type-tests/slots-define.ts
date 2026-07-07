import * as Element from "../Element.js";
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
