import * as Element from "../Element.js";
import * as View from "../View.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const Commit = View.Event.make("commit");
const DataTestId = View.Attribute.make("data-testid");

const InputSlot = View.slot("input", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input, Commit],
  allowedAttributes: [View.Attribute.AriaLabel, DataTestId],
  platformRequirements: [View.Requirement.Keyboard],
});

const CompatiblePlatform = View.platform({
  name: "compatible",
  capabilities: [Element.Capability.TextInput],
  events: [View.Event.Input, Commit],
  attributes: [View.Attribute.AriaLabel, DataTestId],
  requirements: [View.Requirement.Keyboard],
});

type _CompatibleMissing = Expect<Equal<
  View.MissingPlatformSupport<typeof InputSlot, typeof CompatiblePlatform>,
  never
>>;
type _Compatible = Expect<Equal<View.IsPlatformCompatible<typeof InputSlot, typeof CompatiblePlatform>, true>>;
type _TextInputParents = Expect<Equal<
  Element.Capability.ExtendsOf<typeof Element.Capability.TextInput>,
  "Focusable"
>>;
type _TextInputAssignable = Expect<Equal<
  Element.Capability.AssignableNamesOf<typeof Element.Capability.TextInput>,
  "TextInput" | "Focusable" | "Interactive" | "Base"
>>;

const MinimalPlatform = View.platform({
  name: "minimal",
  capabilities: [Element.Capability.Container],
  events: [View.Event.Input],
  attributes: [View.Attribute.AriaLabel],
  requirements: [],
});

type MinimalMissing = View.MissingPlatformSupport<typeof InputSlot, typeof MinimalPlatform>;
type _MinimalMissing = Expect<Equal<
  MinimalMissing,
  | {
    readonly code: "view:unsupported-slot-capability";
    readonly capability: "TextInput";
  }
  | {
    readonly code: "view:unsupported-slot-event";
    readonly event: "commit";
  }
  | {
    readonly code: "view:unsupported-slot-attribute";
    readonly attribute: "data-testid";
  }
  | {
    readonly code: "view:missing-platform-requirement";
    readonly requirement: "keyboard";
  }
>>;
type _MinimalCompatible = Expect<Equal<View.IsPlatformCompatible<typeof InputSlot, typeof MinimalPlatform>, false>>;

const DynamicSlot = View.slot("dynamic", {
  capability: "TextInput",
  allowedEvents: ["custom-event"],
});

const DynamicPlatform = View.platform({
  name: "dynamic",
  capabilities: ["TextInput"],
  events: ["input"] as ReadonlyArray<string>,
});

type _DynamicMissing = Expect<Equal<
  View.MissingPlatformSupport<typeof DynamicSlot, typeof DynamicPlatform>,
  never
>>;
type _DynamicCompatible = Expect<Equal<View.IsPlatformCompatible<typeof DynamicSlot, typeof DynamicPlatform>, true>>;

const NoMetadataPlatform = View.platform({
  name: "no-metadata",
});

type _NoMetadataMeansDynamic = Expect<Equal<
  View.MissingPlatformSupport<typeof InputSlot, typeof NoMetadataPlatform>,
  never
>>;

const FocusableSlot = View.slot("focusable", {
  capability: Element.Capability.Focusable,
});

const TextInputOnlyPlatform = View.platform({
  name: "text-input-only",
  capabilities: [Element.Capability.TextInput],
});

type _ChildCapabilitySatisfiesParentSlot = Expect<Equal<
  View.MissingPlatformSupport<typeof FocusableSlot, typeof TextInputOnlyPlatform>,
  never
>>;
type _ChildCapabilityIsCompatible = Expect<Equal<
  View.IsPlatformCompatible<typeof FocusableSlot, typeof TextInputOnlyPlatform>,
  true
>>;

const FocusableOnlyPlatform = View.platform({
  name: "focusable-only",
  capabilities: [Element.Capability.Focusable],
});

type _ParentCapabilityDoesNotSatisfyChildSlot = Expect<Equal<
  View.MissingPlatformSupport<typeof InputSlot, typeof FocusableOnlyPlatform>,
  {
    readonly code: "view:unsupported-slot-capability";
    readonly capability: "TextInput";
  }
>>;
