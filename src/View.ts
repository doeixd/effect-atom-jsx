import type { Effect } from "effect";
import * as Element from "./Element.js";
import type * as SafeHtml from "./SafeHtml.js";

export const ViewTypeId: unique symbol = Symbol.for("effect-atom-jsx/View");

export type SlotValue = Element.Handle | Element.Collection<Element.Handle>;

export type SlotCapability =
  | "Base"
  | "Container"
  | "Interactive"
  | "Focusable"
  | "TextInput"
  | "Draggable"
  | "Collection"
  | string;

export interface SlotMetadata<Name extends string = string> {
  readonly name: Name;
  readonly capability?: SlotCapability;
  readonly hidden?: boolean;
  readonly allowedEvents?: readonly string[];
  readonly allowedAttributes?: readonly string[];
  readonly platformRequirements?: readonly string[];
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
  readonly events?: readonly string[];
  readonly attributes?: readonly string[];
  readonly requirements?: readonly string[];
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

export function slot<Name extends string>(
  name: Name,
  options?: Omit<SlotMetadata<Name>, "name">,
): SlotMetadata<Name> {
  return {
    name,
    ...options,
  };
}

export function hidden<Name extends string>(
  name: Name,
  options?: Omit<SlotMetadata<Name>, "name" | "hidden">,
): SlotMetadata<Name> {
  return slot(name, {
    ...options,
    hidden: true,
  });
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

function metadataFor<Slots>(view: View<Slots>, slotName: string): SlotMetadata | undefined {
  return (view.slotMetadata as Record<string, SlotMetadata | undefined> | undefined)?.[slotName];
}

function slotValueFor<Slots>(view: View<Slots>, slotName: string): unknown {
  return (view.slots as Record<string, unknown>)[slotName];
}

function includesOptional<T extends string>(values: readonly T[] | undefined, value: T): boolean {
  return values === undefined || values.includes(value);
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
    if (
      sourceCapability !== undefined
      && targetCapability !== undefined
      && sourceCapability !== targetCapability
    ) {
      diagnostics.push({
        code: "view:remap-capability-mismatch",
        message: `View ${view.name ?? "<anonymous>"} cannot remap ${current.source} (${sourceCapability}) to ${current.target} (${targetCapability}).`,
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

    if (capability !== undefined && !includesOptional(platform.capabilities, capability)) {
      diagnostics.push({
        code: "view:unsupported-slot-capability",
        message: `Platform ${platform.name} does not support ${capability} slot ${slotName}.`,
        slot: slotName,
        capability,
        platform: platform.name,
      });
    }

    for (const eventName of metadata?.allowedEvents ?? []) {
      if (!includesOptional(platform.events, eventName)) {
        diagnostics.push({
          code: "view:unsupported-slot-event",
          message: `Platform ${platform.name} does not support event ${eventName} on slot ${slotName}.`,
          slot: slotName,
          event: eventName,
          platform: platform.name,
        });
      }
    }

    for (const attributeName of metadata?.allowedAttributes ?? []) {
      if (!includesOptional(platform.attributes, attributeName)) {
        diagnostics.push({
          code: "view:unsupported-slot-attribute",
          message: `Platform ${platform.name} does not support attribute ${attributeName} on slot ${slotName}.`,
          slot: slotName,
          attribute: attributeName,
          platform: platform.name,
        });
      }
    }

    for (const requirement of metadata?.platformRequirements ?? []) {
      if (!includesOptional(platform.requirements, requirement)) {
        diagnostics.push({
          code: "view:missing-platform-requirement",
          message: `Platform ${platform.name} does not satisfy requirement ${requirement} for slot ${slotName}.`,
          slot: slotName,
          requirement,
          platform: platform.name,
        });
      }
    }
  }
  return diagnostics;
}

export const View = {
  TypeId: ViewTypeId,
  make,
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
  validateSlotTargets,
  validateRemaps,
  validatePlatform,
} as const;
