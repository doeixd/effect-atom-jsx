import * as Element from "../Element.js";
import * as SafeHtml from "../SafeHtml.js";
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
