import { Effect, Layer, ServiceMap } from "effect";
import * as Element from "./Element.js";
import * as MetadataToken from "./MetadataToken.js";
import type * as SafeHtml from "./SafeHtml.js";

export const ViewTypeId: unique symbol = Symbol.for("effect-atom-jsx/View");

export type SlotValue = Element.Handle | Element.Collection<Element.Handle>;

export type SlotCapability =
  | string
  | Element.Capability.Any;

export type EventName<Name extends string = string> = MetadataToken.MetadataToken<"view.event", Name>;
export type AttributeName<Name extends string = string> = MetadataToken.MetadataToken<"view.attribute", Name>;
export type RequirementName<Name extends string = string> = MetadataToken.MetadataToken<"view.requirement", Name>;

export type MetadataName = string | MetadataToken.Any;

function makeEvent<const Name extends string>(name: Name): EventName<Name> {
  return MetadataToken.make("view.event", name);
}

function makeAttribute<const Name extends string>(name: Name): AttributeName<Name> {
  return MetadataToken.make("view.attribute", name);
}

function makeRequirement<const Name extends string>(name: Name): RequirementName<Name> {
  return MetadataToken.make("view.requirement", name);
}

export const Event = {
  make: makeEvent,
  Press: makeEvent("press"),
  Click: makeEvent("click"),
  Input: makeEvent("input"),
  Focus: makeEvent("focus"),
  Blur: makeEvent("blur"),
  Hover: makeEvent("hover"),
} as const;

export const Attribute = {
  make: makeAttribute,
  AriaLabel: makeAttribute("aria-label"),
  Role: makeAttribute("role"),
  Disabled: makeAttribute("disabled"),
  Value: makeAttribute("value"),
} as const;

export const Requirement = {
  make: makeRequirement,
  Keyboard: makeRequirement("keyboard"),
  Pointer: makeRequirement("pointer"),
  Clipboard: makeRequirement("clipboard"),
} as const;

export interface SlotMetadata<Name extends string = string> {
  readonly name: Name;
  readonly capability?: SlotCapability;
  readonly hidden?: boolean;
  readonly allowedEvents?: readonly (string | EventName)[];
  readonly allowedAttributes?: readonly (string | AttributeName)[];
  readonly platformRequirements?: readonly (string | RequirementName)[];
}

export type SlotMetadataMap<Slots> = {
  readonly [K in keyof Slots & string]?: SlotMetadata<K>;
};

export interface SlotRemap<Slots = Record<string, unknown>> {
  readonly source: keyof Slots & string;
  readonly target: keyof Slots & string;
}

export type ViewDiagnosticCode =
  | "view:unknown-slot"
  | "view:hidden-slot"
  | "view:remap-capability-mismatch"
  | "view:unsupported-slot-capability"
  | "view:unsupported-slot-event"
  | "view:unsupported-slot-attribute"
  | "view:missing-platform-requirement";

export interface ViewDiagnostic {
  readonly code: ViewDiagnosticCode;
  readonly message: string;
  readonly slot?: string;
  readonly source?: string;
  readonly target?: string;
  readonly capability?: string;
  readonly event?: string;
  readonly attribute?: string;
  readonly requirement?: string;
  readonly platform?: string;
}

export interface View<Slots> {
  readonly [ViewTypeId]: {
    readonly Slots: Slots;
  };
  readonly slots: Slots;
  readonly node: unknown;
  readonly name?: string;
  readonly metadata?: ViewMetadata;
  readonly slotMetadata?: SlotMetadataMap<Slots>;
  readonly slotRemaps?: readonly SlotRemap<Slots>[];
}

export interface ViewMetadata {
  readonly [key: string]: unknown;
}

export type SlotsOf<T> = T extends View<infer Slots> ? Slots : never;

export interface PlatformMetadata {
  readonly name: string;
  readonly capabilities?: readonly SlotCapability[];
  readonly events?: readonly (string | EventName)[];
  readonly attributes?: readonly (string | AttributeName)[];
  readonly requirements?: readonly (string | RequirementName)[];
}

export type SlotCapabilityOf<T> = T extends { readonly capability?: infer Capability }
  ? MetadataToken.NameOf<NonNullable<Capability>>
  : never;

export type SlotEventsOf<T> = T extends { readonly allowedEvents?: readonly unknown[] }
  ? MetadataToken.NamesOf<NonNullable<T["allowedEvents"]>>
  : never;

export type SlotAttributesOf<T> = T extends { readonly allowedAttributes?: readonly unknown[] }
  ? MetadataToken.NamesOf<NonNullable<T["allowedAttributes"]>>
  : never;

export type SlotRequirementsOf<T> = T extends { readonly platformRequirements?: readonly unknown[] }
  ? MetadataToken.NamesOf<NonNullable<T["platformRequirements"]>>
  : never;

export type PlatformCapabilitiesOf<T> = T extends { readonly metadata: infer Metadata }
  ? PlatformCapabilitiesOf<Metadata>
  : T extends { readonly capabilities?: readonly unknown[] }
    ? MetadataToken.NamesOf<NonNullable<T["capabilities"]>>
    : never;

export type PlatformEventsOf<T> = T extends { readonly metadata: infer Metadata }
  ? PlatformEventsOf<Metadata>
  : T extends { readonly events?: readonly unknown[] }
    ? MetadataToken.NamesOf<NonNullable<T["events"]>>
    : never;

export type PlatformAttributesOf<T> = T extends { readonly metadata: infer Metadata }
  ? PlatformAttributesOf<Metadata>
  : T extends { readonly attributes?: readonly unknown[] }
    ? MetadataToken.NamesOf<NonNullable<T["attributes"]>>
    : never;

export type PlatformRequirementsOf<T> = T extends { readonly metadata: infer Metadata }
  ? PlatformRequirementsOf<Metadata>
  : T extends { readonly requirements?: readonly unknown[] }
    ? MetadataToken.NamesOf<NonNullable<T["requirements"]>>
    : never;

type LiteralMissing<Required, Supported> =
  [Required] extends [never] ? never
    : string extends Required ? never
      : string extends Supported ? never
        : Exclude<Required, Supported>;

type PlatformCapabilitySupport<T> = T extends { readonly metadata: infer Metadata }
  ? PlatformCapabilitySupport<Metadata>
  : "capabilities" extends keyof T
    ? PlatformCapabilitiesOf<T>
    : string;

type PlatformEventSupport<T> = T extends { readonly metadata: infer Metadata }
  ? PlatformEventSupport<Metadata>
  : "events" extends keyof T
    ? PlatformEventsOf<T>
    : string;

type PlatformAttributeSupport<T> = T extends { readonly metadata: infer Metadata }
  ? PlatformAttributeSupport<Metadata>
  : "attributes" extends keyof T
    ? PlatformAttributesOf<T>
    : string;

type PlatformRequirementSupport<T> = T extends { readonly metadata: infer Metadata }
  ? PlatformRequirementSupport<Metadata>
  : "requirements" extends keyof T
    ? PlatformRequirementsOf<T>
    : string;

export type MissingPlatformCapability<Slot, Platform> =
  LiteralMissing<SlotCapabilityOf<Slot>, PlatformCapabilitySupport<Platform>> extends infer Capability
    ? [Capability] extends [never]
      ? never
      : {
        readonly code: "view:unsupported-slot-capability";
        readonly capability: Capability;
      }
    : never;

export type MissingPlatformEvents<Slot, Platform> =
  LiteralMissing<SlotEventsOf<Slot>, PlatformEventSupport<Platform>> extends infer Event
    ? [Event] extends [never]
      ? never
      : {
        readonly code: "view:unsupported-slot-event";
        readonly event: Event;
      }
    : never;

export type MissingPlatformAttributes<Slot, Platform> =
  LiteralMissing<SlotAttributesOf<Slot>, PlatformAttributeSupport<Platform>> extends infer Attribute
    ? [Attribute] extends [never]
      ? never
      : {
        readonly code: "view:unsupported-slot-attribute";
        readonly attribute: Attribute;
      }
    : never;

export type MissingPlatformRequirements<Slot, Platform> =
  LiteralMissing<SlotRequirementsOf<Slot>, PlatformRequirementSupport<Platform>> extends infer Requirement
    ? [Requirement] extends [never]
      ? never
      : {
        readonly code: "view:missing-platform-requirement";
        readonly requirement: Requirement;
      }
    : never;

export type MissingPlatformSupport<Slot, Platform> =
  | MissingPlatformCapability<Slot, Platform>
  | MissingPlatformEvents<Slot, Platform>
  | MissingPlatformAttributes<Slot, Platform>
  | MissingPlatformRequirements<Slot, Platform>;

export type IsPlatformCompatible<Slot, Platform> =
  [MissingPlatformSupport<Slot, Platform>] extends [never] ? true : false;

export interface PlatformService {
  readonly metadata: PlatformMetadata;
  readonly onDiagnostic?: (diagnostic: ViewDiagnostic) => void;
}

export const PlatformTag = ServiceMap.Service<PlatformService>("ViewPlatform");

export type PlatformLayer<Metadata extends PlatformMetadata = PlatformMetadata> =
  & Layer.Layer<PlatformService>
  & {
    readonly metadata: Metadata;
  };

export function platform<const Metadata extends PlatformMetadata>(
  metadata: Metadata,
  options?: {
    readonly onDiagnostic?: (diagnostic: ViewDiagnostic) => void;
  },
): PlatformLayer<Metadata> {
  return Object.assign(Layer.succeed(PlatformTag, {
    metadata,
    onDiagnostic: options?.onDiagnostic,
  }), { metadata }) as PlatformLayer<Metadata>;
}

export type TextHoleValue = string | number | boolean | null | undefined;

export type ClassHoleValue =
  | string
  | false
  | null
  | undefined
  | readonly ClassHoleValue[]
  | { readonly [className: string]: boolean | null | undefined };

export type StyleHoleValue = Readonly<Record<string, string | number | null | undefined>>;

export type EventHoleHandler<Event, Req, E> = (event: Event) => void | Effect.Effect<void, E, Req>;

export type Hole =
  | TextHole
  | ClassHole
  | StyleHole
  | HtmlHole
  | EventHole<unknown, unknown, unknown>
  | ChildrenHole;

export interface TextHole {
  readonly kind: "view.hole.text";
  readonly value: TextHoleValue;
}

export interface ClassHole {
  readonly kind: "view.hole.class";
  readonly value: ClassHoleValue;
}

export interface StyleHole {
  readonly kind: "view.hole.style";
  readonly value: StyleHoleValue;
}

export interface HtmlHole {
  readonly kind: "view.hole.html";
  readonly value: SafeHtml.SafeHtml;
}

export interface EventHole<Event = unknown, Req = never, E = never> {
  readonly kind: "view.hole.event";
  readonly handler: EventHoleHandler<Event, Req, E>;
  readonly _event?: (_: Event) => Event;
  readonly _Req?: (_: Req) => Req;
  readonly _E?: (_: E) => E;
}

export interface ChildrenHole {
  readonly kind: "view.hole.children";
  readonly value: unknown;
}

export function make<Slots>(
  slots: Slots,
  node: unknown,
  options?: {
    readonly name?: string;
    readonly metadata?: ViewMetadata;
    readonly slotMetadata?: SlotMetadataMap<Slots>;
    readonly slotRemaps?: readonly SlotRemap<Slots>[];
  },
): View<Slots> {
  return {
    [ViewTypeId]: {
      Slots: undefined as unknown as Slots,
    },
    slots,
    node,
    name: options?.name,
    metadata: options?.metadata,
    slotMetadata: options?.slotMetadata,
    slotRemaps: options?.slotRemaps,
  };
}

export function isView(value: unknown): value is View<unknown> {
  return (typeof value === "object" || typeof value === "function")
    && value !== null
    && ViewTypeId in value;
}

export function node(value: unknown): unknown {
  return isView(value) ? value.node : value;
}

export function text(value: TextHoleValue): TextHole {
  return {
    kind: "view.hole.text",
    value,
  };
}

export function className(value: ClassHoleValue): ClassHole {
  return {
    kind: "view.hole.class",
    value,
  };
}

export function style(value: StyleHoleValue): StyleHole {
  return {
    kind: "view.hole.style",
    value,
  };
}

export function html(value: SafeHtml.SafeHtml): HtmlHole {
  return {
    kind: "view.hole.html",
    value,
  };
}

export function event<Event, Req = never, E = never>(
  handler: EventHoleHandler<Event, Req, E>,
): EventHole<Event, Req, E> {
  return {
    kind: "view.hole.event",
    handler,
  };
}

export function children(value: unknown): ChildrenHole {
  return {
    kind: "view.hole.children",
    value,
  };
}

export function slot<
  const Name extends string,
  const Options extends object = {},
>(
  name: Name,
  options?: Options & Omit<SlotMetadata<Name>, "name">,
): SlotMetadata<Name> & Options & { readonly name: Name } {
  return {
    name,
    ...options,
  } as SlotMetadata<Name> & Options & { readonly name: Name };
}

export function hidden<
  const Name extends string,
  const Options extends object = {},
>(
  name: Name,
  options?: Options & Omit<SlotMetadata<Name>, "name" | "hidden">,
): SlotMetadata<Name> & Options & { readonly name: Name; readonly hidden: true } {
  return slot(name, {
    ...options,
    hidden: true,
  } as Options & { readonly hidden: true });
}

export function remap<Slots>(
  source: keyof Slots & string,
  target: keyof Slots & string,
): SlotRemap<Slots> {
  return { source, target };
}

export function capabilityOf(value: unknown): SlotCapability | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if ((value as Element.Collection<Element.Handle>)._tag === "Collection") return "Collection";
  const kind = (value as { readonly kind?: unknown }).kind;
  return typeof kind === "string" ? kind : undefined;
}

export function nameOfCapability(value: SlotCapability): string {
  return Element.nameOfCapability(value);
}

export function nameOfEvent(value: string | EventName): string {
  return MetadataToken.nameOf(value);
}

export function nameOfAttribute(value: string | AttributeName): string {
  return MetadataToken.nameOf(value);
}

export function nameOfRequirement(value: string | RequirementName): string {
  return MetadataToken.nameOf(value);
}

function metadataFor<Slots>(view: View<Slots>, slotName: string): SlotMetadata | undefined {
  return (view.slotMetadata as Record<string, SlotMetadata | undefined> | undefined)?.[slotName];
}

function slotValueFor<Slots>(view: View<Slots>, slotName: string): unknown {
  return (view.slots as Record<string, unknown>)[slotName];
}

export function nameOfMetadata(value: MetadataName): string {
  return MetadataToken.nameOf(value);
}

function includesMetadataOptional(values: readonly MetadataName[] | undefined, value: MetadataName): boolean {
  if (values === undefined) return true;
  const expected = nameOfMetadata(value);
  return values.some((current) => nameOfMetadata(current) === expected);
}

export function validateSlotTargets<Slots>(
  view: View<Slots>,
  slotNames: Iterable<string>,
  options?: {
    readonly allowHidden?: boolean;
  },
): readonly ViewDiagnostic[] {
  const diagnostics: ViewDiagnostic[] = [];
  for (const slotName of slotNames) {
    const value = slotValueFor(view, slotName);
    if (value === undefined) {
      diagnostics.push({
        code: "view:unknown-slot",
        message: `View ${view.name ?? "<anonymous>"} does not expose slot ${slotName}.`,
        slot: slotName,
      });
      continue;
    }

    const meta = metadataFor(view, slotName);
    if (meta?.hidden === true && options?.allowHidden !== true) {
      diagnostics.push({
        code: "view:hidden-slot",
        message: `View ${view.name ?? "<anonymous>"} slot ${slotName} is hidden.`,
        slot: slotName,
      });
    }
  }
  return diagnostics;
}

export function validateRemaps<Slots>(
  view: View<Slots>,
  remaps: readonly SlotRemap<Slots>[] = view.slotRemaps ?? [],
): readonly ViewDiagnostic[] {
  const diagnostics: ViewDiagnostic[] = [];
  for (const current of remaps) {
    const sourceValue = slotValueFor(view, current.source);
    const targetValue = slotValueFor(view, current.target);
    if (sourceValue === undefined) {
      diagnostics.push({
        code: "view:unknown-slot",
        message: `View ${view.name ?? "<anonymous>"} does not expose source slot ${current.source}.`,
        slot: current.source,
        source: current.source,
        target: current.target,
      });
      continue;
    }
    if (targetValue === undefined) {
      diagnostics.push({
        code: "view:unknown-slot",
        message: `View ${view.name ?? "<anonymous>"} does not expose target slot ${current.target}.`,
        slot: current.target,
        source: current.source,
        target: current.target,
      });
      continue;
    }

    const sourceCapability = metadataFor(view, current.source)?.capability ?? capabilityOf(sourceValue);
    const targetCapability = metadataFor(view, current.target)?.capability ?? capabilityOf(targetValue);
    const sourceCapabilityName = sourceCapability === undefined ? undefined : nameOfCapability(sourceCapability);
    const targetCapabilityName = targetCapability === undefined ? undefined : nameOfCapability(targetCapability);
    if (
      sourceCapabilityName !== undefined
      && targetCapabilityName !== undefined
      && sourceCapabilityName !== targetCapabilityName
    ) {
      diagnostics.push({
        code: "view:remap-capability-mismatch",
        message: `View ${view.name ?? "<anonymous>"} cannot remap ${current.source} (${sourceCapabilityName}) to ${current.target} (${targetCapabilityName}).`,
        source: current.source,
        target: current.target,
      });
    }
  }
  return diagnostics;
}

export function validatePlatform<Slots>(
  view: View<Slots>,
  platform: PlatformMetadata,
): readonly ViewDiagnostic[] {
  const diagnostics: ViewDiagnostic[] = [];
  for (const slotName of Object.keys(view.slots as Record<string, unknown>)) {
    const metadata = metadataFor(view, slotName);
    const capability = metadata?.capability ?? capabilityOf(slotValueFor(view, slotName));
    const capabilityName = capability === undefined ? undefined : nameOfCapability(capability);

    if (capability !== undefined && !includesMetadataOptional(platform.capabilities, capability)) {
      diagnostics.push({
        code: "view:unsupported-slot-capability",
        message: `Platform ${platform.name} does not support ${capabilityName} slot ${slotName}.`,
        slot: slotName,
        capability: capabilityName,
        platform: platform.name,
      });
    }

    for (const eventName of metadata?.allowedEvents ?? []) {
      const event = nameOfEvent(eventName);
      if (!includesMetadataOptional(platform.events, eventName)) {
        diagnostics.push({
          code: "view:unsupported-slot-event",
          message: `Platform ${platform.name} does not support event ${event} on slot ${slotName}.`,
          slot: slotName,
          event,
          platform: platform.name,
        });
      }
    }

    for (const attributeName of metadata?.allowedAttributes ?? []) {
      const attribute = nameOfAttribute(attributeName);
      if (!includesMetadataOptional(platform.attributes, attributeName)) {
        diagnostics.push({
          code: "view:unsupported-slot-attribute",
          message: `Platform ${platform.name} does not support attribute ${attribute} on slot ${slotName}.`,
          slot: slotName,
          attribute,
          platform: platform.name,
        });
      }
    }

    for (const requirement of metadata?.platformRequirements ?? []) {
      const requirementName = nameOfRequirement(requirement);
      if (!includesMetadataOptional(platform.requirements, requirement)) {
        diagnostics.push({
          code: "view:missing-platform-requirement",
          message: `Platform ${platform.name} does not satisfy requirement ${requirementName} for slot ${slotName}.`,
          slot: slotName,
          requirement: requirementName,
          platform: platform.name,
        });
      }
    }
  }
  return diagnostics;
}

export function reportPlatformDiagnostics<Slots>(
  view: View<Slots>,
  service: PlatformService,
): readonly ViewDiagnostic[] {
  const diagnostics = validatePlatform(view, service.metadata);
  if (service.onDiagnostic) {
    for (const diagnostic of diagnostics) {
      service.onDiagnostic(diagnostic);
    }
  }
  return diagnostics;
}

export const View = {
  TypeId: ViewTypeId,
  PlatformTag,
  Event,
  Attribute,
  Requirement,
  make,
  platform,
  isView,
  node,
  text,
  className,
  style,
  html,
  event,
  children,
  slot,
  hidden,
  remap,
  capabilityOf,
  nameOfCapability,
  nameOfEvent,
  nameOfAttribute,
  nameOfRequirement,
  nameOfMetadata,
  validateSlotTargets,
  validateRemaps,
  validatePlatform,
  reportPlatformDiagnostics,
} as const;
