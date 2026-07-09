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
const IsOpen = Behavior.binding<"isOpen", boolean>("isOpen");
const SelectionChanged = Behavior.outEvent<"selectionChanged", { readonly key: string }>("selectionChanged");
const statefulBehavior = Behavior.provides({ isOpen: IsOpen })(
  Behavior.forSlots(FieldSlots)(() => Effect.succeed({ isOpen: true })),
);
const selectionEvents = { selectionChanged: SelectionChanged };
const selectionBus = Behavior.eventBus(selectionEvents);
const eventfulBehavior = Behavior.emits(selectionEvents)(
  Behavior.forSlots(FieldSlots)(() => Effect.succeed({ events: selectionBus })),
);
type StatefulProvides = Behavior.BindingContractOf<typeof statefulBehavior>;
const providedBindingName: Behavior.BindingNameOf<StatefulProvides["isOpen"]> = "isOpen";
void providedBindingName;
type EventfulEmits = Behavior.OutEventsOf<typeof eventfulBehavior>;
const emittedEventName: Behavior.OutEventNameOf<EventfulEmits["selectionChanged"]> = "selectionChanged";
void emittedEventName;
selectionBus.emit(SelectionChanged, { key: "a" });
selectionBus.emit("selectionChanged", { key: "b" });
selectionBus.on(SelectionChanged, (payload) => {
  const key: string = payload.key;
  void key;
  return undefined;
});
// @ts-expect-error logical behavior event payloads are typed
selectionBus.emit(SelectionChanged, { value: "missing key" });
const Styled = Field.pipe(
  Style.attachToSlots(fieldStyle, FieldSlots),
  Behavior.attachToSlots(fieldBehavior, FieldSlots),
  Behavior.attachToSlots(statefulBehavior, FieldSlots),
  Behavior.attachToSlots(eventfulBehavior, FieldSlots),
);
void Styled;

Style.forSlots(FieldSlots)({
  root: Style.whenBinding(IsOpen, true, Style.slot({ opacity: 1 })),
});

const bindingAwareStyle = Style.make({
  root: Style.compose(
    Style.slot({ opacity: 0.5 }),
    Style.when(
      () => true,
      Style.whenBinding(IsOpen, true, Style.slot({ opacity: 1 })),
    ),
  ),
});
const SetupCardWithBinding = Component.make<{}, never, never, {
  readonly isOpen: boolean;
  readonly slots: { readonly root: Element.Container };
}>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({ isOpen: true, slots: { root: Element.container() } }),
  () => null,
).pipe(Style.attach(bindingAwareStyle));
void SetupCardWithBinding;
const SetupCardWithoutBinding = Component.make<{}, never, never, {
  readonly slots: { readonly root: Element.Container };
}>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({ slots: { root: Element.container() } }),
  () => null,
);
// @ts-expect-error binding-aware styles require the referenced binding on the component
SetupCardWithoutBinding.pipe(Style.attach(bindingAwareStyle));

Style.forSlots(FieldSlots)({
  // @ts-expect-error unknown slot in a contract-keyed style
  missing: Style.slot({ color: "red" }),
});

// ── D1: compile errors are engineered messages, not structural dumps ──
const InputWitness = View.Slot.make("input", { capability: Element.Capability.TextInput });

// invalid binding rejects with a readable branded message...
type BindErr = View.BindableHandle<typeof InputWitness, Element.Container>;
const bindErrText: BindErr extends View.TypeErrorMessage<infer M> ? M : never =
  "Handle capability 'Container' does not satisfy slot 'input' capability 'TextInput'";
void bindErrText;

// ...and the invalid call itself still fails to compile
// @ts-expect-error a container handle cannot bind to a TextInput slot
View.Slot.bind(InputWitness, Element.container());

// valid bindings resolve to unknown — no error brand, no constraint noise
type BindOk = View.BindableHandle<typeof InputWitness, Element.TextInput>;
const bindOk: BindOk extends View.TypeErrorMessage<string> ? false : true = true;
void bindOk;

// hierarchy-aware: a TextInput handle satisfies a Focusable slot
const FocusWitness = View.Slot.make("focus", { capability: Element.Capability.Focusable });
type BindChildOk = View.BindableHandle<typeof FocusWitness, Element.TextInput>;
const bindChildOk: BindChildOk extends View.TypeErrorMessage<string> ? false : true = true;
void bindChildOk;
