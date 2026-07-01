import { Effect } from "effect";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as SafeHtml from "../SafeHtml.js";
import * as Style from "../Style.js";
import * as View from "../View.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

type Slots = {
  readonly root: Element.Container;
  readonly trigger: Element.Interactive;
};

const root = Element.container();
const trigger = Element.interactive();

const view = View.make(
  { root, trigger },
  null,
  {
    slotMetadata: {
      root: View.slot("root", { capability: "Container" }),
      trigger: View.hidden("trigger", { capability: "Interactive" }),
    },
    slotRemaps: [
      View.remap<Slots>("root", "root"),
    ],
  },
);

type ViewSlots = View.SlotsOf<typeof view>;

const _root: ViewSlots["root"] = root;
const _trigger: ViewSlots["trigger"] = trigger;

View.remap<Slots>("root", "trigger");

// @ts-expect-error unknown source slot
View.remap<Slots>("missing", "trigger");

// @ts-expect-error unknown target slot
View.remap<Slots>("root", "missing");

View.validateSlotTargets(view, ["root", "trigger"]);
View.validatePlatform(view, {
  name: "web",
  capabilities: ["Container", "Interactive"],
  events: ["click"],
  attributes: ["aria-label"],
  requirements: [],
});

const DatePicker = Element.Capability.make("DatePicker");
const Commit = View.Event.make("commit");
const DataTestId = View.Attribute.make("data-testid");
const Pointer = View.Requirement.make("pointer");

const witnessSlot = View.slot("input", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input, View.Event.Focus, Commit],
  allowedAttributes: [View.Attribute.AriaLabel, DataTestId],
  platformRequirements: [View.Requirement.Keyboard, Pointer],
});

type _WitnessSlotCapability = Expect<Equal<View.SlotCapabilityOf<typeof witnessSlot>, "TextInput">>;
type _WitnessSlotEvents = Expect<Equal<View.SlotEventsOf<typeof witnessSlot>, "input" | "focus" | "commit">>;
type _WitnessSlotAttributes = Expect<Equal<View.SlotAttributesOf<typeof witnessSlot>, "aria-label" | "data-testid">>;
type _WitnessSlotRequirements = Expect<Equal<View.SlotRequirementsOf<typeof witnessSlot>, "keyboard" | "pointer">>;

const mixedSlot = View.slot("mixed", {
  capability: DatePicker,
  allowedEvents: [View.Event.Input, "legacy-change"],
  allowedAttributes: ["aria-label", View.Attribute.Role],
  platformRequirements: ["keyboard", View.Requirement.Pointer],
});

type _MixedSlotCapability = Expect<Equal<View.SlotCapabilityOf<typeof mixedSlot>, "DatePicker">>;
type _MixedSlotEvents = Expect<Equal<View.SlotEventsOf<typeof mixedSlot>, string>>;
type _MixedSlotAttributes = Expect<Equal<View.SlotAttributesOf<typeof mixedSlot>, string>>;
type _MixedSlotRequirements = Expect<Equal<View.SlotRequirementsOf<typeof mixedSlot>, string>>;

const WebPlatform = View.platform({
  name: "web",
  capabilities: [Element.Capability.Container, Element.Capability.TextInput, DatePicker],
  events: [View.Event.Input, "legacy-change"],
  attributes: [View.Attribute.AriaLabel, "data-testid"],
  requirements: [View.Requirement.Keyboard, "pointer"],
});

type _PlatformCapabilities = Expect<Equal<View.PlatformCapabilitiesOf<typeof WebPlatform>, "Container" | "TextInput" | "DatePicker">>;
type _PlatformEvents = Expect<Equal<View.PlatformEventsOf<typeof WebPlatform>, "input" | "legacy-change">>;
type _PlatformAttributes = Expect<Equal<View.PlatformAttributesOf<typeof WebPlatform>, "aria-label" | "data-testid">>;
type _PlatformRequirements = Expect<Equal<View.PlatformRequirementsOf<typeof WebPlatform>, "keyboard" | "pointer">>;

View.text("label");
View.text(1);
View.text(false);
View.className(["root", { active: true, disabled: false }]);
View.style({ color: "red", opacity: 0.5 });
View.event<MouseEvent>((event) => {
  event.preventDefault();
});
View.children([View.text("child")]);

const safe = SafeHtml.make("<strong>trusted</strong>");
View.html(safe);

// @ts-expect-error raw strings are not accepted for HTML holes
View.html("<strong>unsafe</strong>");

// @ts-expect-error arbitrary objects are not accepted for HTML holes
View.html({ html: "<strong>unsafe</strong>" });

// @ts-expect-error style hole values must be primitive CSS values
View.style({ color: { nested: true } });

const typedTree = View.element<Slots>(Element.Capability.Container, {
  slot: "root",
  props: {
    className: View.className(["root", { active: true }]),
    onClick: View.event<MouseEvent>((event) => {
      event.preventDefault();
    }),
  },
  children: [
    View.element<Slots>(Element.Capability.Interactive, { slot: "trigger" }),
    View.hole(View.text("label")),
    View.textNode("plain text"),
  ],
});

View.fragment<Slots>([typedTree]);

// @ts-expect-error typed tree slot must be a known slot key
View.element<Slots>(Element.Capability.Container, { slot: "missing" });

const treeSlots: Slots = { root, trigger };

const treeView = View.tree(
  treeSlots,
  typedTree,
  "runtime-node",
  {
    slotMetadata: {
      root: View.slot("root", { capability: Element.Capability.Container }),
      trigger: View.slot("trigger", { capability: Element.Capability.Interactive }),
    },
  },
);

type TreeViewSlots = View.SlotsOf<typeof treeView>;
type _TreeViewSlots = Expect<Equal<TreeViewSlots, { readonly root: Element.Container; readonly trigger: Element.Interactive }>>;

const TreeComponent = Component.make<{}, never, never, { readonly slots: Slots }>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({ slots: { root, trigger } }),
  (_props, bindings) => View.tree(
    bindings.slots,
    View.element<Slots>(Element.Capability.Container, { slot: "root" }),
    "runtime-node",
  ),
);

const treeComponentViewEffect = Component.renderViewEffect(TreeComponent, {});
type TreeComponentViewEffectValue =
  typeof treeComponentViewEffect extends Effect.Effect<infer A, any, any> ? A : never;
type _TreeComponentRenderView = Expect<Equal<
  TreeComponentViewEffectValue,
  View.View<Component.SlotsOf<typeof TreeComponent>> | undefined
>>;

const RootSlot = View.Slot.make("root", {
  capability: Element.Capability.Container,
  allowedAttributes: [View.Attribute.AriaLabel],
});
const InputSlot = View.Slot.make("input", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input, Commit],
  allowedAttributes: [View.Attribute.AriaLabel],
  platformRequirements: [View.Requirement.Keyboard],
});
const HiddenTriggerSlot = View.Slot.make("trigger", {
  capability: Element.Capability.Interactive,
  hidden: true,
});

type _SlotName = Expect<Equal<View.Slot.NameOf<typeof InputSlot>, "input">>;
type _SlotCapability = Expect<Equal<View.Slot.CapabilityOf<typeof InputSlot>, "TextInput">>;
type _SlotCapabilityValue = Expect<Equal<View.Slot.CapabilityValueOf<typeof InputSlot>, typeof Element.Capability.TextInput>>;
type _SlotEvents = Expect<Equal<View.Slot.EventsOf<typeof InputSlot>, "input" | "commit">>;
type _SlotAttributes = Expect<Equal<View.Slot.AttributesOf<typeof InputSlot>, "aria-label">>;
type _SlotRequirements = Expect<Equal<View.Slot.RequirementsOf<typeof InputSlot>, "keyboard">>;
type _SlotHidden = Expect<Equal<View.Slot.HiddenOf<typeof HiddenTriggerSlot>, true>>;
type _SlotAssignableCapabilities = Expect<Equal<
  View.Slot.AssignableCapabilityNamesOf<typeof InputSlot>,
  "TextInput" | "Focusable" | "Interactive" | "Base"
>>;
type _SlotIsAssignableToFocusable = Expect<Equal<
  View.Slot.IsAssignableTo<typeof InputSlot, typeof Element.Capability.Focusable>,
  true
>>;

function identitySlot<S extends View.Slot.Any>(slot: S): S {
  return slot;
}
const forwardedInputSlot = identitySlot(InputSlot);
type _ForwardedSlotName = Expect<Equal<View.Slot.NameOf<typeof forwardedInputSlot>, "input">>;
type _ForwardedSlotEvents = Expect<Equal<View.Slot.EventsOf<typeof forwardedInputSlot>, "input" | "commit">>;

const boundRoot = View.Slot.bind(RootSlot, Element.container());
const boundInput = View.Slot.bind(InputSlot, Element.textInput());
const boundTrigger = View.Slot.bind(HiddenTriggerSlot, Element.interactive());

// @ts-expect-error Container does not satisfy TextInput slot capability
View.Slot.bind(InputSlot, Element.container());

type _BoundName = Expect<Equal<View.Slot.NameOf<typeof boundInput>, "input">>;
type _BoundHandle = Expect<Equal<View.Slot.HandleOf<typeof boundInput>, Element.TextInput>>;
type _BoundMetadata = Expect<Equal<View.Slot.MetadataOf<typeof boundInput>, typeof InputSlot.metadata>>;

const witnessSlots = View.Slots.make({
  root: boundRoot,
  input: boundInput,
  trigger: boundTrigger,
});

View.Slots.make({
  root: boundRoot,
  // @ts-expect-error object key must match bound slot witness name
  field: boundInput,
});

type _WitnessSlotNames = Expect<Equal<View.Slots.NamesOf<typeof witnessSlots>, "root" | "input" | "trigger">>;
type _WitnessPublicNames = Expect<Equal<View.Slots.PublicNamesOf<typeof witnessSlots>, "root" | "input">>;
type _WitnessHiddenNames = Expect<Equal<View.Slots.HiddenNamesOf<typeof witnessSlots>, "trigger">>;
type _WitnessHandles = Expect<Equal<View.Slots.HandlesOf<typeof witnessSlots>, {
  readonly root: Element.Container;
  readonly input: Element.TextInput;
  readonly trigger: Element.Interactive;
}>>;
type _WitnessMetadata = Expect<Equal<View.Slots.MetadataOf<typeof witnessSlots>, {
  readonly root: typeof RootSlot.metadata;
  readonly input: typeof InputSlot.metadata;
  readonly trigger: typeof HiddenTriggerSlot.metadata;
}>>;
type _WitnessTextInputSlots = Expect<Equal<keyof View.Slots.WithCapability<typeof witnessSlots, typeof Element.Capability.TextInput>, "input">>;
type _WitnessFocusableSlots = Expect<Equal<keyof View.Slots.WithCapability<typeof witnessSlots, typeof Element.Capability.Focusable>, "input">>;

function identitySlots<S extends View.Slots.Any>(slots: S): S {
  return slots;
}
const forwardedSlots = identitySlots(witnessSlots);
type _ForwardedSlotNames = Expect<Equal<View.Slots.NamesOf<typeof forwardedSlots>, "root" | "input" | "trigger">>;

const witnessView = View.fromSlots(witnessSlots, "node", {
  tree: View.fragment<View.Slots.HandlesOf<typeof witnessSlots>>([
    View.element<View.Slots.HandlesOf<typeof witnessSlots>>(Element.Capability.Container, { slot: "root" }),
    View.element<View.Slots.HandlesOf<typeof witnessSlots>>(Element.Capability.TextInput, { slot: "input" }),
  ]),
});

type WitnessViewSlots = View.SlotsOf<typeof witnessView>;
type _WitnessViewSlots = Expect<Equal<WitnessViewSlots, View.Slots.HandlesOf<typeof witnessSlots>>>;

const WitnessComponent = Component.make<{}, never, never, { readonly slots: View.Slots.HandlesOf<typeof witnessSlots> }>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({ slots: View.Slots.handles(witnessSlots) }),
  () => View.fromSlots(witnessSlots, "node"),
);

const WrappedWitnessComponent = WitnessComponent.pipe(
  Style.attachByView(Style.make({
    root: Style.slot({ color: "red" }),
    input: Style.slot({ opacity: 1 }),
  })),
  Component.guard(Effect.void),
);

type _WrappedWitnessComponentSlots = Expect<Equal<
  Component.SlotsOf<typeof WrappedWitnessComponent>,
  View.Slots.HandlesOf<typeof witnessSlots>
>>;
