import { Effect } from "effect";
import * as View from "../View.js";
import * as Element from "../Element.js";

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

const Input = View.Slot.make("input").pipe(
  View.Slot.capability(Element.Capability.TextInput),
  View.Slot.events(View.Event.Input, View.Event.Focus),
  View.Slot.attributes(View.Attribute.AriaLabel),
  View.Slot.requires(View.Requirement.Keyboard),
);

type InputName = View.Slot.NameOf<typeof Input>;
type InputCapability = View.Slot.CapabilityOf<typeof Input>;
type InputEvents = View.Slot.EventsOf<typeof Input>;
type InputAttributes = View.Slot.AttributesOf<typeof Input>;
type InputRequirements = View.Slot.RequirementsOf<typeof Input>;
type InputHidden = View.Slot.HiddenOf<typeof Input>;

type _InputNameCheck = Expect<Equal<InputName, "input">>;
type _InputCapabilityCheck = Expect<Equal<InputCapability, "TextInput">>;
type _InputEventsCheck = Expect<Equal<InputEvents, "input" | "focus">>;
type _InputAttributesCheck = Expect<Equal<InputAttributes, "aria-label">>;
type _InputRequirementsCheck = Expect<Equal<InputRequirements, "keyboard">>;
type _InputHiddenCheck = Expect<Equal<InputHidden, false>>;

const SecretTrigger = View.Slot.make("trigger").pipe(
  View.Slot.capability(Element.Capability.Interactive),
  View.Slot.hidden,
);

type SecretName = View.Slot.NameOf<typeof SecretTrigger>;
type SecretHidden = View.Slot.HiddenOf<typeof SecretTrigger>;
type SecretPublic = View.Slot.Public<typeof SecretTrigger>;
type SecretHiddenType = View.Slot.Hidden<typeof SecretTrigger>;

type _SecretNameCheck = Expect<Equal<SecretName, "trigger">>;
type _SecretHiddenCheck = Expect<Equal<SecretHidden, true>>;
type _SecretPublicCheck = Expect<Equal<SecretPublic, never>>;
type _SecretHiddenTypeCheck = Expect<Equal<SecretHiddenType, typeof SecretTrigger>>;

const Root = View.Slot.make("root", {
  capability: Element.Capability.Container,
});

const rootHandle = Element.container();
const inputHandle = Element.textInput();

const boundRoot = View.Slot.bind(Root, rootHandle);
const boundInput = View.Slot.bind(Input, inputHandle);

type BoundRootName = View.Slot.NameOf<typeof boundRoot>;
type BoundInputName = View.Slot.NameOf<typeof boundInput>;
type BoundInputHandle = View.Slot.HandleOf<typeof boundInput>;

type _BoundRootNameCheck = Expect<Equal<BoundRootName, "root">>;
type _BoundInputNameCheck = Expect<Equal<BoundInputName, "input">>;
type _BoundInputHandleCheck = Expect<Equal<BoundInputHandle, typeof inputHandle>>;

const slots = View.Slots.make({
  root: boundRoot,
  input: boundInput,
});

type SlotNames = View.Slots.NamesOf<typeof slots>;
type SlotHandles = View.Slots.HandlesOf<typeof slots>;
type SlotMetadata = View.Slots.MetadataOf<typeof slots>;
type PublicNames = View.Slots.PublicNamesOf<typeof slots>;

type _SlotNamesCheck = Expect<Equal<SlotNames, "root" | "input">>;
type _SlotHandlesCheck = Expect<Equal<SlotHandles, { readonly root: typeof rootHandle; readonly input: typeof inputHandle }>>;
type _PublicNamesCheck = Expect<Equal<PublicNames, "root" | "input">>;

const slotsWithHidden = View.Slots.make({
  root: boundRoot,
  input: boundInput,
  trigger: View.Slot.bind(SecretTrigger, Element.interactive()),
});

type HiddenSlotNames = View.Slots.NamesOf<typeof slotsWithHidden>;
type HiddenSlotPublicNames = View.Slots.PublicNamesOf<typeof slotsWithHidden>;
type HiddenSlotHiddenNames = View.Slots.HiddenNamesOf<typeof slotsWithHidden>;

type _HiddenSlotNamesCheck = Expect<Equal<HiddenSlotNames, "root" | "input" | "trigger">>;
type _HiddenSlotPublicNamesCheck = Expect<Equal<HiddenSlotPublicNames, "root" | "input">>;
type _HiddenSlotHiddenNamesCheck = Expect<Equal<HiddenSlotHiddenNames, "trigger">>;

const view = View.fromSlots(slots, null);
type ViewSlots = typeof view.slots;
type _ViewSlotsCheck = Expect<Equal<ViewSlots, SlotHandles>>;

const contractTree = View.fragment([
  View.element(Root, {
    children: [
      View.element(Input),
    ],
  }),
]);

const viewWithContractTree = View.fromSlots(slots, null, {
  tree: contractTree,
});

type _ContractTreeAssignableCheck = Expect<typeof contractTree extends View.ViewNode<SlotHandles> ? true : false>;
type _ViewWithContractTreeSlotsCheck = Expect<Equal<typeof viewWithContractTree.slots, SlotHandles>>;

type TextInputSlots = View.Slots.WithCapability<typeof slots, typeof Element.Capability.TextInput>;
type _TextInputSlotsCheck = Expect<Equal<TextInputSlots, { readonly input: typeof boundInput }>>;

type PickedSlots = View.Slots.Pick<typeof slots, "root">;
type _PickedSlotsCheck = Expect<Equal<View.Slots.NamesOf<PickedSlots>, "root">>;

type OmittedSlots = View.Slots.Omit<typeof slots, "input">;
type _OmittedSlotsCheck = Expect<Equal<View.Slots.NamesOf<OmittedSlots>, "root">>;
