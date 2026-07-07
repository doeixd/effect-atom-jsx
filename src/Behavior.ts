import { Effect } from "effect";
import * as Component from "./Component.js";
import * as Element from "./Element.js";
import * as View from "./View.js";

const BehaviorTypeId: unique symbol = Symbol.for("effect-atom-jsx/Behavior");

export interface Behavior<Elements, Bindings, Req, E> {
  readonly [BehaviorTypeId]: {
    readonly Elements: Elements;
    readonly Bindings: Bindings;
    readonly Req: Req;
    readonly E: E;
  };
  readonly run: (elements: Elements) => Effect.Effect<Bindings, E, Req>;
  readonly metadata?: BehaviorMetadata<Elements>;
}

export type ElementsOf<T> = T extends Behavior<infer E, any, any, any> ? E : never;
export type BindingsOf<T> = T extends Behavior<any, infer B, any, any> ? B : never;
export type RequirementsOf<T> = T extends Behavior<any, any, infer R, any> ? R : never;
export type ErrorsOf<T> = T extends Behavior<any, any, any, infer E> ? E : never;

type SlotMapLike = Record<string, unknown>;
type SlotContractRecord = Record<string, View.Slot.Any>;
type SlotContractInput = SlotContractRecord | View.Slots.Any;
type SlotContractNames<T> =
  T extends View.Slots.Any ? keyof View.Slots.BoundOf<T> & string
    : T extends SlotContractRecord ? keyof T & string
      : never;
type SlotContractTargetNames<T> =
  T extends View.Slots.Any ? keyof View.Slots.BoundOf<T> & string
    : T extends SlotContractRecord ? View.Slot.NameOf<T[keyof T & string]> & string
      : never;
type HandleForCapability<Name> =
  Name extends "TextInput" ? Element.TextInput
    : Name extends "Container" ? Element.Container
      : Name extends "Focusable" ? Element.Focusable
        : Name extends "Draggable" ? Element.Draggable
          : Name extends "Interactive" ? Element.Interactive
            : Element.Handle;
type ElementsForSlotContract<T extends SlotContractInput> = {
  readonly [K in SlotContractNames<T>]: T extends View.Slots.Any
    ? View.Slot.HandleOf<View.Slots.BoundOf<T>[K]>
    : T extends SlotContractRecord
      ? HandleForCapability<View.Slot.CapabilityOf<T[K]>>
      : never;
};

export type BehaviorEventName = string | View.EventName;

export type BehaviorEventMap<Elements> = {
  readonly [K in keyof Elements & string]?: readonly BehaviorEventName[];
};

export interface BehaviorMetadata<Elements = Record<string, unknown>> {
  readonly events?: BehaviorEventMap<Elements>;
}

export type MetadataOf<T> = T extends Behavior<infer Elements, any, any, any> ? BehaviorMetadata<Elements> : never;
export type EventRequirementsOf<T> = T extends { readonly metadata?: { readonly events?: infer Events } }
  ? NonNullable<Events>
  : never;

type CompatibleSlotKey<Slots extends SlotMapLike, Needed> = {
  readonly [K in keyof Slots]: unknown extends Slots[K]
    ? K
    : Slots[K] extends Needed
      ? K
      : never;
}[keyof Slots];

export function make<Elements, Bindings = {}, Req = never, E = never>(
  run: (elements: Elements) => Effect.Effect<Bindings, E, Req>,
  metadata?: BehaviorMetadata<Elements>,
): Behavior<Elements, Bindings, Req, E> {
  return {
    [BehaviorTypeId]: {
      Elements: undefined as unknown as Elements,
      Bindings: undefined as unknown as Bindings,
      Req: undefined as unknown as Req,
      E: undefined as unknown as E,
    },
    run,
    metadata,
  };
}

function slotContractRecordFrom(input: SlotContractInput): SlotContractRecord {
  if (typeof input === "object" && input !== null && "bound" in input) {
    const out: Record<string, View.Slot.Any> = {};
    for (const [name, bound] of Object.entries(input.bound)) {
      out[name] = bound.slot;
    }
    return out;
  }
  return input as SlotContractRecord;
}

export function forSlots<const S extends SlotContractInput>(
  slots: S,
): <Bindings, Req, E>(
  run: (elements: ElementsForSlotContract<S>) => Effect.Effect<Bindings, E, Req>,
  metadata?: BehaviorMetadata<ElementsForSlotContract<S>>,
) => Behavior<ElementsForSlotContract<S>, Bindings, Req, E> {
  return (run, metadata) => make(run, metadata);
}

export function withMetadata<Elements, Bindings, Req, E>(
  behavior: Behavior<Elements, Bindings, Req, E>,
  metadata: BehaviorMetadata<Elements>,
): Behavior<Elements, Bindings, Req, E> {
  return {
    ...behavior,
    metadata: {
      ...behavior.metadata,
      ...metadata,
      events: {
        ...behavior.metadata?.events,
        ...metadata.events,
      },
    },
  };
}

export function events<
  const EventMap extends Record<string, readonly BehaviorEventName[]>,
>(
  eventMap: EventMap,
): (
  <Elements extends { readonly [K in keyof EventMap & string]: unknown }, Bindings, Req, E>(
    behavior: Behavior<Elements, Bindings, Req, E>,
  ) => Behavior<Elements, Bindings, Req, E> & { readonly metadata: BehaviorMetadata<Elements> & { readonly events: EventMap } }
) {
  return <Elements extends { readonly [K in keyof EventMap & string]: unknown }, Bindings, Req, E>(
    behavior: Behavior<Elements, Bindings, Req, E>,
  ) => withMetadata(behavior, { events: eventMap }) as Behavior<Elements, Bindings, Req, E> & {
    readonly metadata: BehaviorMetadata<Elements> & { readonly events: EventMap };
  };
}

export function compose<E1, B1, R1, Err1, E2, B2, R2, Err2>(
  first: Behavior<E1, B1, R1, Err1>,
  second: Behavior<E2, B2, R2, Err2>,
): Behavior<E1 & E2, B1 & B2, R1 | R2, Err1 | Err2>;
export function compose<E1, B1, R1, Err1, E2, B2, R2, Err2, E3, B3, R3, Err3>(
  first: Behavior<E1, B1, R1, Err1>,
  second: Behavior<E2, B2, R2, Err2>,
  third: Behavior<E3, B3, R3, Err3>,
): Behavior<E1 & E2 & E3, B1 & B2 & B3, R1 | R2 | R3, Err1 | Err2 | Err3>;
export function compose(...behaviors: ReadonlyArray<Behavior<any, any, any, any>>): Behavior<any, any, any, any> {
  return make((elements) =>
    Effect.gen(function* () {
      const out: Record<string, unknown> = {};
      for (const behavior of behaviors) {
        const next = yield* behavior.run(elements);
        Object.assign(out, next);
      }
      return out;
    }));
}

export function decorator<Elements, Bindings, Req, E>(
  behavior: Behavior<Elements, Bindings, Req, E>,
): <ComponentLike extends { pipe: (...fns: ReadonlyArray<(value: any) => any>) => any }>(
  component: ComponentLike,
  attach: (behavior: Behavior<Elements, Bindings, Req, E>) => (self: ComponentLike) => ComponentLike,
) => ComponentLike {
  return (component, attach) => component.pipe(attach(behavior));
}

/**
 * Low-level behavior attachment: a `select` function picks the behavior's
 * elements from **any** bindings — including derived/computed values
 * (`items: () => bindings.filtered()`), not just named slots — with an
 * optional `merge`. This is strictly more general than the contract-keyed
 * forms (`attachToSlots` / `attachBySlotContract` / `attachBySlots`), which
 * are typed sugar over it for the slot-mapped common case. Prefer those when
 * a `View.Slots` contract exists; use this when selecting arbitrary bindings.
 * Intentionally retained as the general form, not deprecated.
 */
export function attach<Elements, AddedBindings, BR, BE, Props, Req, E, Bindings>(
  behavior: Behavior<Elements, AddedBindings, BR, BE>,
  options: {
    readonly select: (bindings: Bindings, props: Props) => Elements;
    readonly merge?: (bindings: Bindings, added: AddedBindings) => Bindings & AddedBindings;
  },
): (
  component: Component.Component<Props, Req, E, Bindings>,
) => Component.Component<Props, Req | BR, E | BE, Bindings & AddedBindings> {
  return Component.withBehavior(behavior, options.select, options.merge);
}

export function attachBySlots<
  Elements extends SlotMapLike,
  AddedBindings,
  BR,
  BE,
  Props,
  Req,
  E,
  Slots extends SlotMapLike,
  Bindings extends { readonly slots: Slots },
  SlotContract = Slots,
>(
  behavior: Behavior<Elements, AddedBindings, BR, BE>,
  elementMap: { readonly [K in keyof Elements]: CompatibleSlotKey<Slots, Elements[K]> },
  merge?: (bindings: Bindings, added: AddedBindings) => Bindings & AddedBindings,
): (
  component: Component.Component<Props, Req, E, Bindings, SlotContract>,
) => Component.Component<Props, Req | BR, E | BE, Bindings & AddedBindings, SlotContract> {
  return Component.withBehavior(
    behavior,
    (bindings) => {
      const out: Record<string, unknown> = {};
      for (const [behaviorKey, slotKey] of Object.entries(elementMap)) {
        out[behaviorKey] = (bindings.slots as Record<string, unknown>)[String(slotKey)];
      }
      return out as Elements;
    },
    merge,
  ) as (
    component: Component.Component<Props, Req, E, Bindings, SlotContract>,
  ) => Component.Component<Props, Req | BR, E | BE, Bindings & AddedBindings, SlotContract>;
}

export function attachBySlotContract<
  Elements extends SlotMapLike,
  AddedBindings,
  BR,
  BE,
  Props,
  Req,
  E,
  Slots extends SlotMapLike,
  Bindings extends { readonly slots: Slots },
  M extends { readonly [K in keyof Elements]: View.Slot.Any },
  SlotContract = Slots,
>(
  behavior: Behavior<Elements, AddedBindings, BR, BE>,
  elementMap: M,
  merge?: (bindings: Bindings, added: AddedBindings) => Bindings & AddedBindings,
): (
  component: Component.Component<Props, Req, E, Bindings, SlotContract>,
) => Component.Component<Props, Req | BR, E | BE, Bindings & AddedBindings, SlotContract> {
  const mappedSlots: Record<string, string> = {};
  for (const [behaviorKey, slot] of Object.entries(elementMap)) {
    mappedSlots[behaviorKey] = slot.name;
  }
  return attachBySlots(behavior, mappedSlots as any, merge);
}

export function attachToSlots<
  S extends SlotContractInput,
  AddedBindings,
  BR,
  BE,
>(
  behavior: Behavior<ElementsForSlotContract<S>, AddedBindings, BR, BE>,
  slots: S,
  merge?: (bindings: any, added: AddedBindings) => any,
): <
  C extends Component.Component<any, any, any, { readonly slots: SlotMapLike }, any>,
>(
  component: Component.SlotsOf<C> extends Record<SlotContractTargetNames<S>, Element.Handle | Element.Collection<Element.Handle>>
    ? C
    : never,
) => Component.Component<
  Component.PropsOf<C>,
  Component.Requirements<C> | BR,
  Component.Errors<C> | BE,
  Component.BindingsOf<C> & AddedBindings,
  Component.SlotContractOf<C>
> & Omit<C, keyof Component.Component<any, any, any, any, any>> {
  const witnesses = slotContractRecordFrom(slots);
  const map: Record<string, View.Slot.Any> = {};
  for (const key of Object.keys(witnesses)) {
    map[key] = witnesses[key]!;
  }
  return attachBySlotContract(behavior as any, map as any, merge) as any;
}

export function attachToAllWithCapability<
  Elements extends SlotMapLike,
  AddedBindings,
  BR,
  BE,
  Props,
  Req,
  E,
  Slots extends SlotMapLike,
  Bindings extends { readonly slots: Slots },
  C extends View.SlotCapability,
  SlotContract = Slots,
>(
  behavior: Behavior<Elements, AddedBindings, BR, BE>,
  capability: C,
  merge?: (bindings: Bindings, added: AddedBindings) => Bindings & AddedBindings,
): (
  component: Component.Component<Props, Req, E, Bindings, SlotContract>,
) => Component.Component<Props, Req | BR, E | BE, Bindings & AddedBindings, SlotContract> {
  return Component.withBehavior(
    behavior,
    (bindings) => {
      const out: Record<string, unknown> = {};

      const slotMetadata = (bindings as { readonly slotMetadata?: Record<string, View.SlotMetadata> }).slotMetadata;
      const slots = bindings.slots ?? {};

      for (const [slotKey, slotValue] of Object.entries(slots)) {
        const metadata = slotMetadata?.[slotKey];
        const slotCapability = metadata?.capability ?? View.capabilityOf(slotValue);
        if (slotCapability === undefined) continue;

        if (View.extendsCapability(slotCapability, capability)) {
          out[slotKey] = slotValue;
        }
      }

      return out as Elements;
    },
    merge,
  ) as (
    component: Component.Component<Props, Req, E, Bindings, SlotContract>,
  ) => Component.Component<Props, Req | BR, E | BE, Bindings & AddedBindings, SlotContract>;
}

export function validateAttachmentBySlots<
  Elements extends SlotMapLike,
  Slots,
  M extends { readonly [K in keyof Elements]: keyof Slots & string },
>(
  behavior: Behavior<Elements, unknown, unknown, unknown>,
  elementMap: M,
  view: View.View<Slots>,
  options?: {
    readonly allowHidden?: boolean;
  },
): readonly View.ViewDiagnostic[] {
  const diagnostics = [
    ...View.validateSlotTargets(view, Object.values(elementMap) as string[], options),
  ];
  const eventRequirements = behavior.metadata?.events;
  if (eventRequirements === undefined) return diagnostics;

  const slotMetadata = view.slotMetadata as Record<string, View.SlotMetadata | undefined> | undefined;
  for (const [behaviorKey, requiredEvents] of Object.entries(eventRequirements) as Array<[keyof Elements & string, readonly BehaviorEventName[] | undefined]>) {
    if (requiredEvents === undefined) continue;
    const slotName = elementMap[behaviorKey];
    if (slotName === undefined) continue;
    const metadata = slotMetadata?.[String(slotName)];
    const allowedEvents = metadata?.allowedEvents;
    if (allowedEvents === undefined) continue;
    for (const event of requiredEvents) {
      const eventName = View.nameOfEvent(event);
      if (allowedEvents.some((allowed) => View.nameOfEvent(allowed) === eventName)) continue;
      diagnostics.push({
        code: "view:unsupported-slot-event",
        message: `View ${view.name ?? "<anonymous>"} slot ${String(slotName)} does not allow event ${eventName}.`,
        slot: String(slotName),
        event: eventName,
      });
    }
  }
  return diagnostics;
}

export function validateComponentAttachmentBySlots<
  Elements extends SlotMapLike,
  Props,
  Req,
  E,
  Bindings,
  Slots,
  // Dynamic string-map escape hatch: component-slot targets are plain strings,
  // validated against the rendered View's slot metadata at runtime (not the
  // static SlotContract, which may be empty for view-only / bindings-based
  // slots). Unknown targets surface as diagnostics — the point of this helper.
  M extends { readonly [K in keyof Elements]: string },
>(
  behavior: Behavior<Elements, unknown, unknown, unknown>,
  elementMap: M,
  component: Component.Component<Props, Req, E, Bindings, Slots>,
  props: Props,
  options?: {
    readonly allowHidden?: boolean;
  },
): Effect.Effect<readonly View.ViewDiagnostic[], E, Req> {
  return Component.renderViewEffect(component, props).pipe(
    // elementMap is a dynamic string map; validated against the rendered view.
    Effect.map((view) => view === undefined ? [] : validateAttachmentBySlots(behavior, elementMap as never, view, options)),
  );
}

export const Behavior = {
  TypeId: BehaviorTypeId,
  make,
  forSlots,
  compose,
  decorator,
  attach,
  attachBySlots,
  attachBySlotContract,
  attachToSlots,
  attachToAllWithCapability,
  withMetadata,
  events,
  validateAttachmentBySlots,
  validateComponentAttachmentBySlots,
} as const;


