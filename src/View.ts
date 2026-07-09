import { Effect, Layer, ServiceMap } from "effect";
import * as Element from "./Element.js";
import * as MetadataToken from "./MetadataToken.js";
import type * as SafeHtml from "./SafeHtml.js";

export const ViewTypeId: unique symbol = Symbol.for("effect-atom-jsx/View");

/**
 * Runtime value stored for a view slot.
 *
 * Slots expose renderer-neutral `Element.Handle` values to styles, behaviors,
 * diagnostics, and tests. A slot can also expose a collection when one authored
 * slot maps to repeated runtime elements.
 */
export type SlotValue = Element.Handle | Element.Collection<Element.Handle>;

/**
 * Capability required by a slot or supported by a platform.
 *
 * Prefer `Element.Capability.*` tokens for authored APIs; raw strings remain
 * accepted for dynamic/generated integrations.
 */
export type SlotCapability =
  | string
  | Element.Capability.Any;

/** Branded event token used by slot contracts and behavior validation. */
export type EventName<Name extends string = string> = MetadataToken.MetadataToken<"view.event", Name>;
/** Branded attribute token used by platform-aware slot diagnostics. */
export type AttributeName<Name extends string = string> = MetadataToken.MetadataToken<"view.attribute", Name>;
/** Branded platform requirement token used by renderer capability checks. */
export type RequirementName<Name extends string = string> = MetadataToken.MetadataToken<"view.requirement", Name>;

/** Raw or branded metadata name accepted by normalization helpers. */
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

/**
 * Common event tokens for slot contracts.
 *
 * @example
 * const FieldSlots = View.Slots.define({
 *   input: {
 *     capability: Element.Capability.TextInput,
 *     allowedEvents: [View.Event.Input, View.Event.Focus],
 *   },
 * })
 */
export const Event = {
  make: makeEvent,
  Press: makeEvent("press"),
  Click: makeEvent("click"),
  Input: makeEvent("input"),
  Focus: makeEvent("focus"),
  Blur: makeEvent("blur"),
  Hover: makeEvent("hover"),
} as const;

/** Common attribute tokens for platform diagnostics and generated renderers. */
export const Attribute = {
  make: makeAttribute,
  AriaLabel: makeAttribute("aria-label"),
  AriaDescribedby: makeAttribute("aria-describedby"),
  Role: makeAttribute("role"),
  Disabled: makeAttribute("disabled"),
  Value: makeAttribute("value"),
} as const;

/** Common platform requirement tokens for slot contracts. */
export const Requirement = {
  make: makeRequirement,
  Keyboard: makeRequirement("keyboard"),
  Pointer: makeRequirement("pointer"),
  Clipboard: makeRequirement("clipboard"),
} as const;

/**
 * Authored metadata for one named slot.
 *
 * Metadata is intentionally renderer-neutral: capabilities, allowed events,
 * attributes, and requirements describe what the slot promises rather than a
 * concrete DOM element.
 */
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

/**
 * Project a slot type to its runtime handle-map form. A `View.Slots` witness
 * collection (authored contract) normalizes to its `HandlesOf<...>` handle
 * map; a plain handle map passes through unchanged. Use this wherever a
 * `SlotContract`-axis type reaches `View<Slots>` (which is keyed by slot name
 * → handle at runtime), so witness-collection contracts and handle maps agree.
 */
export type NormalizeSlots<S> = S extends Slots.Any ? Slots.HandlesOf<S> : S;

/**
 * Declares that one public slot is implemented by another runtime slot.
 *
 * Remaps are validated for existence and capability compatibility by
 * `View.validateRemaps`.
 */
export interface SlotRemap<Slots = Record<string, unknown>> {
  readonly source: keyof Slots & string;
  readonly target: keyof Slots & string;
}

/** Diagnostic codes produced by view, slot, remap, tree, and platform checks. */
export type ViewDiagnosticCode =
  | "view:unknown-slot"
  | "view:hidden-slot"
  | "view:remap-capability-mismatch"
  | "view:unsupported-slot-capability"
  | "view:unsupported-slot-event"
  | "view:unsupported-slot-attribute"
  | "view:missing-platform-requirement";

/** Structured view diagnostic used directly and normalized by `Diagnostics`. */
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

type ViewPipeable<Slots> = {
  pipe(): View<Slots>;
  pipe(...fns: ReadonlyArray<(self: View<Slots>) => View<Slots>>): View<Slots>;
  pipe<A>(ab: (self: View<Slots>) => A): A;
};

/**
 * Renderer-neutral view value.
 *
 * `Slots` is the runtime handle map, usually projected from an authored
 * `View.Slots` contract by `View.fromSlots(...)`. The `node` may be JSX output,
 * a renderer-native value, or an explicit typed tree. Optional `tree` metadata
 * enables diagnostics and future non-DOM renderers without requiring a JSX
 * compiler transform in the first release slice.
 *
 * @example
 * const Slots = View.Slots.define({
 *   root: { capability: Element.Capability.Container },
 * })
 *
 * const view = View.fromSlots(Slots, <section />)
 * type Handles = View.SlotsOf<typeof view>
 */
export interface View<Slots> extends ViewPipeable<Slots> {
  readonly [ViewTypeId]: {
    readonly Slots: Slots;
  };
  readonly slots: Slots;
  readonly node: unknown;
  readonly tree?: ViewNode<Slots>;
  readonly name?: string;
  readonly metadata?: ViewMetadata;
  readonly slotMetadata?: SlotMetadataMap<Slots>;
  readonly slotRemaps?: readonly SlotRemap<Slots>[];
}

/** Free-form metadata carried by a view for tools and generated adapters. */
export interface ViewMetadata {
  readonly [key: string]: unknown;
}

/** Extract the runtime slot handle map from a `View<Slots>`. */
export type SlotsOf<T> = T extends View<infer Slots> ? Slots : never;

export const SlotTypeId: unique symbol = Symbol.for("effect-atom-jsx/View/Slot");
export const SlotsTypeId: unique symbol = Symbol.for("effect-atom-jsx/View/Slots");

type SlotHandle = Element.Handle | Element.Collection<Element.Handle>;

type HandleCapabilityAssignableNames<T> =
  T extends Element.Collection<Element.Handle> ? Element.Capability.AssignableNamesOf<typeof Element.Capability.Collection>
    : T extends Element.TextInput ? Element.Capability.AssignableNamesOf<typeof Element.Capability.TextInput>
      : T extends Element.Draggable ? Element.Capability.AssignableNamesOf<typeof Element.Capability.Draggable>
        : T extends Element.Container ? Element.Capability.AssignableNamesOf<typeof Element.Capability.Container>
          : T extends Element.Focusable ? Element.Capability.AssignableNamesOf<typeof Element.Capability.Focusable>
            : T extends Element.Interactive ? Element.Capability.AssignableNamesOf<typeof Element.Capability.Interactive>
              : string;

type SlotCapabilityName<T> = T extends Slot.Slot<any, infer Capability, any, any, any, any>
  ? MetadataToken.NameOf<Capability>
  : never;

type HandleCapabilityName<T> =
  T extends Element.Collection<Element.Handle> ? "Collection"
    : T extends Element.TextInput ? "TextInput"
      : T extends Element.Draggable ? "Draggable"
        : T extends Element.Container ? "Container"
          : T extends Element.Focusable ? "Focusable"
            : T extends Element.Interactive ? "Interactive"
              : "Base";

/**
 * Branded compile-time diagnostic. When an attachment or binding is invalid,
 * the type error surfaces this readable message instead of an opaque
 * structural dump of witness internals.
 */
export interface TypeErrorMessage<Message extends string> {
  readonly "~af-ui/error": Message;
}

/**
 * The compile-time check behind `Slot.bind(...)`: resolves to `unknown` when
 * the handle's capability satisfies the slot's capability (hierarchy-aware),
 * or to a readable `TypeErrorMessage` otherwise. Exported so error-text
 * expectations can be asserted in type tests.
 */
export type BindableHandle<S extends Slot.Any, H extends SlotHandle> =
  SlotCapabilityName<S> extends HandleCapabilityAssignableNames<H> ? unknown
    : TypeErrorMessage<`Handle capability '${HandleCapabilityName<H>}' does not satisfy slot '${Slot.NameOf<S>}' capability '${SlotCapabilityName<S>}'`>;

type Pipeable<Self> = {
  pipe(): Self;
  pipe(...fns: ReadonlyArray<(self: Self) => Self>): Self;
  pipe<A>(ab: (self: Self) => A): A;
  pipe<A, B>(ab: (self: Self) => A, bc: (a: A) => B): B;
  pipe<A, B, C>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C): C;
  pipe<A, B, C, D>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C, de: (c: C) => D): D;
  pipe<A, B, C, D, E>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C, de: (c: C) => D, ef: (d: D) => E): E;
  pipe<A, B, C, D, E, F>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C, de: (c: C) => D, ef: (d: D) => E, fg: (e: E) => F): F;
  pipe<A, B, C, D, E, F, G>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C, de: (c: C) => D, ef: (d: D) => E, fg: (e: E) => F, gh: (f: F) => G): G;
  pipe<A, B, C, D, E, F, G, H>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C, de: (c: C) => D, ef: (d: D) => E, fg: (e: E) => F, gh: (f: F) => G, hi: (g: G) => H): H;
  pipe<A, B, C, D, E, F, G, H, I>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C, de: (c: C) => D, ef: (d: D) => E, fg: (e: E) => F, gh: (f: F) => G, hi: (g: G) => H, ij: (h: H) => I): I;
};

function pipeSelf(self: unknown, fns: ReadonlyArray<(value: any) => any>): unknown {
  return fns.reduce((acc, fn) => fn(acc), self);
}

export namespace Slot {
  /**
   * Authored witness for one structural slot.
   *
   * Slots are type-level metadata plus a name. Binding a slot to an
   * `Element.Handle` checks capability compatibility at compile time.
   */
  export interface Slot<
    Name extends string = string,
    Capability extends SlotCapability = typeof Element.Capability.Base,
    Events extends readonly (string | EventName)[] = readonly [],
    Attributes extends readonly (string | AttributeName)[] = readonly [],
    Requirements extends readonly (string | RequirementName)[] = readonly [],
    Hidden extends boolean = false,
  > extends Pipeable<Slot<Name, Capability, Events, Attributes, Requirements, Hidden>> {
    readonly [SlotTypeId]: {
      readonly Name: Name;
      readonly Capability: Capability;
      readonly Events: Events;
      readonly Attributes: Attributes;
      readonly Requirements: Requirements;
      readonly Hidden: Hidden;
    };
    readonly name: Name;
    readonly metadata: SlotMetadata<Name> & {
      readonly capability: Capability;
      readonly allowedEvents: Events;
      readonly allowedAttributes: Attributes;
      readonly platformRequirements: Requirements;
      readonly hidden: Hidden;
    };
  }

  /** Any slot witness, useful for helpers that accept arbitrary contracts. */
  export type Any = Slot<string, SlotCapability, readonly (string | EventName)[], readonly (string | AttributeName)[], readonly (string | RequirementName)[], boolean>;

  /** A slot witness paired with the runtime handle that implements it. */
  export interface Bound<
    S extends Any = Any,
    H extends SlotHandle = SlotHandle,
  > {
    readonly slot: S;
    readonly handle: H;
  }

  /** Any bound slot/handle pair. */
  export type BoundAny = Bound<Any, SlotHandle>;
  export type NameOf<T> = T extends Bound<infer S, any> ? NameOf<S> : T extends Slot<infer Name, any, any, any, any, any> ? Name : never;
  export type CapabilityOf<T> = T extends Bound<infer S, any> ? CapabilityOf<S> : T extends Slot<any, infer Capability, any, any, any, any> ? MetadataToken.NameOf<Capability> : never;
  export type CapabilityValueOf<T> = T extends Bound<infer S, any> ? CapabilityValueOf<S> : T extends Slot<any, infer Capability, any, any, any, any> ? Capability : never;
  export type EventsOf<T> = T extends Bound<infer S, any> ? EventsOf<S> : T extends Slot<any, any, infer Events, any, any, any> ? MetadataToken.NamesOf<Events> : never;
  export type AttributesOf<T> = T extends Bound<infer S, any> ? AttributesOf<S> : T extends Slot<any, any, any, infer Attributes, any, any> ? MetadataToken.NamesOf<Attributes> : never;
  export type RequirementsOf<T> = T extends Bound<infer S, any> ? RequirementsOf<S> : T extends Slot<any, any, any, any, infer Requirements, any> ? MetadataToken.NamesOf<Requirements> : never;
  export type HiddenOf<T> = T extends Bound<infer S, any> ? HiddenOf<S> : T extends Slot<any, any, any, any, any, infer Hidden> ? Hidden : never;
  export type HandleOf<T> = T extends Bound<any, infer H> ? H : never;
  export type MetadataOf<T> = T extends Bound<infer S, any> ? MetadataOf<S> : T extends Slot<any, any, any, any, any, any> ? T["metadata"] : never;
  export type AssignableCapabilityNamesOf<T> = Element.Capability.AssignableNamesOf<CapabilityValueOf<T>>;
  export type IsAssignableTo<T, Capability extends SlotCapability> =
    MetadataToken.NameOf<Capability> extends AssignableCapabilityNamesOf<T> ? true : false;
  export type RequiresCapability<Capability extends SlotCapability> = Any & {
    readonly [SlotTypeId]: {
      readonly Capability: Capability;
    };
  };
  export type Public<T> = HiddenOf<T> extends true ? never : T;
  export type Hidden<T> = HiddenOf<T> extends true ? T : never;

  /**
   * Create one slot witness.
   *
   * Prefer `View.Slots.define(...)` for component contracts. Use this directly
   * when you need a reusable slot witness or want to bind handles manually.
   *
   * @example
   * const input = View.Slot.make("input", {
   *   capability: Element.Capability.TextInput,
   *   allowedEvents: [View.Event.Input],
   * })
   */
  export function make<
    const Name extends string,
    const Capability extends SlotCapability = typeof Element.Capability.Base,
    const Events extends readonly (string | EventName)[] = readonly [],
    const Attributes extends readonly (string | AttributeName)[] = readonly [],
    const Requirements extends readonly (string | RequirementName)[] = readonly [],
    const Hidden extends boolean = false,
  >(
    name: Name,
    options?: {
      readonly capability?: Capability;
      readonly allowedEvents?: Events;
      readonly allowedAttributes?: Attributes;
      readonly platformRequirements?: Requirements;
      readonly hidden?: Hidden;
    },
  ): Slot<Name, Capability, Events, Attributes, Requirements, Hidden> {
    const capability = options?.capability ?? Element.Capability.Base as unknown as Capability;
    const allowedEvents = options?.allowedEvents ?? [] as unknown as Events;
    const allowedAttributes = options?.allowedAttributes ?? [] as unknown as Attributes;
    const platformRequirements = options?.platformRequirements ?? [] as unknown as Requirements;
    const hidden = options?.hidden ?? false as Hidden;
    const out = {
      [SlotTypeId]: {
        Name: undefined as unknown as Name,
        Capability: undefined as unknown as Capability,
        Events: undefined as unknown as Events,
        Attributes: undefined as unknown as Attributes,
        Requirements: undefined as unknown as Requirements,
        Hidden: undefined as unknown as Hidden,
      },
      name,
      metadata: {
        name,
        capability,
        allowedEvents,
        allowedAttributes,
        platformRequirements,
        hidden,
      },
    } as Slot<Name, Capability, Events, Attributes, Requirements, Hidden>;
    return Object.assign(out, {
      pipe: (...fns: ReadonlyArray<(value: any) => any>) => pipeSelf(out, fns),
    }) as Slot<Name, Capability, Events, Attributes, Requirements, Hidden>;
  }

  /**
   * Bind a slot witness to a runtime element handle.
   *
   * The `handle` type must satisfy the slot capability. Invalid bindings fail
   * as readable TypeScript errors via `TypeErrorMessage`.
   */
  export function bind<S extends Any, H extends SlotHandle>(
    slot: S,
    handle: H & BindableHandle<S, H>,
  ): Bound<S, H> {
    return { slot, handle };
  }

  /** Pipeable transform that replaces a slot's capability. */
  export function capability<const C extends SlotCapability>(
    cap: C,
  ): <N extends string, OldC extends SlotCapability, E extends readonly (string | EventName)[], A extends readonly (string | AttributeName)[], R extends readonly (string | RequirementName)[], H extends boolean>(
    slot: Slot<N, OldC, E, A, R, H>,
  ) => Slot<N, C, E, A, R, H> {
    return (slot) => make(slot.name, {
      capability: cap,
      allowedEvents: slot.metadata.allowedEvents,
      allowedAttributes: slot.metadata.allowedAttributes,
      platformRequirements: slot.metadata.platformRequirements,
      hidden: slot.metadata.hidden,
    }) as any;
  }

  /** Pipeable transform that replaces the allowed event list for a slot. */
  export function events<const E extends readonly (string | EventName)[]>(
    ...evts: E
  ): <N extends string, C extends SlotCapability, OldE extends readonly (string | EventName)[], A extends readonly (string | AttributeName)[], R extends readonly (string | RequirementName)[], H extends boolean>(
    slot: Slot<N, C, OldE, A, R, H>,
  ) => Slot<N, C, E, A, R, H> {
    return (slot) => make(slot.name, {
      capability: slot.metadata.capability,
      allowedEvents: evts,
      allowedAttributes: slot.metadata.allowedAttributes,
      platformRequirements: slot.metadata.platformRequirements,
      hidden: slot.metadata.hidden,
    }) as any;
  }

  /** Pipeable transform that replaces the allowed attribute list for a slot. */
  export function attributes<const A extends readonly (string | AttributeName)[]>(
    ...attrs: A
  ): <N extends string, C extends SlotCapability, E extends readonly (string | EventName)[], OldA extends readonly (string | AttributeName)[], R extends readonly (string | RequirementName)[], H extends boolean>(
    slot: Slot<N, C, E, OldA, R, H>,
  ) => Slot<N, C, E, A, R, H> {
    return (slot) => make(slot.name, {
      capability: slot.metadata.capability,
      allowedEvents: slot.metadata.allowedEvents,
      allowedAttributes: attrs,
      platformRequirements: slot.metadata.platformRequirements,
      hidden: slot.metadata.hidden,
    }) as any;
  }

  /** Pipeable transform that replaces platform requirements for a slot. */
  export function requires<const R extends readonly (string | RequirementName)[]>(
    ...reqs: R
  ): <N extends string, C extends SlotCapability, E extends readonly (string | EventName)[], A extends readonly (string | AttributeName)[], OldR extends readonly (string | RequirementName)[], H extends boolean>(
    slot: Slot<N, C, E, A, OldR, H>,
  ) => Slot<N, C, E, A, R, H> {
    return (slot) => make(slot.name, {
      capability: slot.metadata.capability,
      allowedEvents: slot.metadata.allowedEvents,
      allowedAttributes: slot.metadata.allowedAttributes,
      platformRequirements: reqs,
      hidden: slot.metadata.hidden,
    }) as any;
  }

  /** Mark a slot as hidden from public style/behavior attachment by default. */
  export function hidden<N extends string, C extends SlotCapability, E extends readonly (string | EventName)[], A extends readonly (string | AttributeName)[], R extends readonly (string | RequirementName)[], H extends boolean>(
    slot: Slot<N, C, E, A, R, H>,
  ): Slot<N, C, E, A, R, true> {
    return make(slot.name, {
      capability: slot.metadata.capability,
      allowedEvents: slot.metadata.allowedEvents,
      allowedAttributes: slot.metadata.allowedAttributes,
      platformRequirements: slot.metadata.platformRequirements,
      hidden: true,
    }) as any;
  }
}

type BoundSlotRecord = Record<string, Slot.BoundAny>;
type SlotRecordKeyMatches<T extends BoundSlotRecord> = {
  readonly [K in keyof T]: K extends Slot.NameOf<T[K]> ? T[K] : never;
};
type PickRecord<T, K extends keyof T> = {
  readonly [P in K]: T[P];
};
type OmitRecord<T, K extends keyof T> = PickRecord<T, Exclude<keyof T, K>>;

export namespace Slots {
  /**
   * Authored slot contract for a component or view.
   *
   * This is the canonical structural contract. Runtime views expose
   * `HandlesOf<Slots>`; components publish it with `Component.withSlots(...)`.
   */
  export interface Slots<T extends BoundSlotRecord = BoundSlotRecord> {
    readonly [SlotsTypeId]: {
      readonly Bound: T;
    };
    readonly bound: T;
  }

  /** Any authored slot contract. */
  export type Any = Slots<BoundSlotRecord>;
  export type BoundOf<T> = T extends Slots<infer Bound> ? Bound : never;
  export type HandlesOf<T> = {
    readonly [K in keyof BoundOf<T>]: Slot.HandleOf<BoundOf<T>[K]>;
  };
  export type MetadataOf<T> = {
    readonly [K in keyof BoundOf<T> & string]: Slot.MetadataOf<BoundOf<T>[K]>;
  };
  export type NamesOf<T> = keyof BoundOf<T> & string;
  export type PublicNamesOf<T> = {
    readonly [K in keyof BoundOf<T> & string]: Slot.HiddenOf<BoundOf<T>[K]> extends true ? never : K;
  }[keyof BoundOf<T> & string];
  export type HiddenNamesOf<T> = {
    readonly [K in keyof BoundOf<T> & string]: Slot.HiddenOf<BoundOf<T>[K]> extends true ? K : never;
  }[keyof BoundOf<T> & string];
  export type WithCapability<T, Capability extends SlotCapability> = {
    readonly [K in keyof BoundOf<T> & string as MetadataToken.NameOf<Capability> extends Slot.AssignableCapabilityNamesOf<BoundOf<T>[K]> ? K : never]: BoundOf<T>[K];
  };
  export type Pick<T, Names extends keyof BoundOf<T> & string> = Slots<PickRecord<BoundOf<T>, Names>>;
  export type Omit<T, Names extends keyof BoundOf<T> & string> = Slots<OmitRecord<BoundOf<T>, Names>>;

  /**
   * Create a slot contract from already-bound slot witnesses.
   *
   * Most authored code should use `define(...)`, which creates and binds the
   * witnesses from a concise record shape.
   */
  export function make<const T extends BoundSlotRecord>(
    bound: T & SlotRecordKeyMatches<T>,
  ): Slots<T> {
    return {
      [SlotsTypeId]: {
        Bound: undefined as unknown as T,
      },
      bound,
    };
  }

  /** Options for one slot in `Slots.define(...)` — `Slot.make` options minus the name (taken from the record key). */
  /**
   * Options for one slot in `Slots.define(...)`.
   *
   * The slot name comes from the record key, so this mirrors `Slot.make`
   * options minus `name`.
   */
  export interface DefineOptions {
    readonly capability?: SlotCapability;
    readonly allowedEvents?: readonly (string | EventName)[];
    readonly allowedAttributes?: readonly (string | AttributeName)[];
    readonly platformRequirements?: readonly (string | RequirementName)[];
    readonly hidden?: boolean;
  }

  type DefinedCapability<O extends DefineOptions> = O["capability"] extends SlotCapability ? O["capability"]
    : typeof Element.Capability.Base;

  type DefinedSlot<Name extends string, O extends DefineOptions> = Slot.Slot<
    Name,
    DefinedCapability<O>,
    O["allowedEvents"] extends readonly (string | EventName)[] ? O["allowedEvents"] : readonly [],
    O["allowedAttributes"] extends readonly (string | AttributeName)[] ? O["allowedAttributes"] : readonly [],
    O["platformRequirements"] extends readonly (string | RequirementName)[] ? O["platformRequirements"] : readonly [],
    O["hidden"] extends true ? true : false
  >;

  type DefaultHandleFor<C> = MetadataToken.NameOf<C> extends "TextInput" ? Element.TextInput
    : MetadataToken.NameOf<C> extends "Focusable" ? Element.Focusable
    : MetadataToken.NameOf<C> extends "Container" ? Element.Container
    : MetadataToken.NameOf<C> extends "Draggable" ? Element.Draggable
    : MetadataToken.NameOf<C> extends "Collection" ? Element.Collection<Element.Handle>
    : MetadataToken.NameOf<C> extends "Interactive" ? Element.Interactive
    : Element.Handle;

  export type Defined<T extends Record<string, DefineOptions>> = Slots<{
    readonly [K in keyof T & string]: Slot.Bound<DefinedSlot<K, T[K]>, DefaultHandleFor<DefinedCapability<T[K]>>>;
  }>;

  /**
   * One-step authored slot contract: witness names come from the record keys
   * and default handles are derived from each slot's capability, collapsing
   * the `Slot.make` x N + `Slot.bind` map ceremony into a single declaration.
   *
   * ```ts
   * const FieldSlots = View.Slots.define({
   *   root: { capability: Element.Capability.Container },
   *   input: {
   *     capability: Element.Capability.TextInput,
   *     allowedEvents: [View.Event.Input, View.Event.Focus],
   *   },
   * });
   * ```
   *
   * Equivalent to `Slots.make({ root: Slot.bind(Slot.make("root", ...), Element.container()), ... })`.
   * Use `Slots.make` + `Slot.bind` directly when a slot needs a custom handle.
   */
  /**
   * Define an authored slot contract from a record.
   *
   * @example
   * export const FieldSlots = View.Slots.define({
   *   root: { capability: Element.Capability.Container },
   *   input: {
   *     capability: Element.Capability.TextInput,
   *     allowedEvents: [View.Event.Input],
   *   },
   * })
   */
  export function define<const T extends Record<string, DefineOptions>>(
    definitions: T,
  ): Defined<T> {
    const bound: Record<string, Slot.BoundAny> = {};
    for (const [name, options] of Object.entries(definitions)) {
      const slot = Slot.make(name, options as never);
      bound[name] = { slot, handle: Element.handleFor(slot.metadata.capability) };
    }
    return make(bound as never) as unknown as Defined<T>;
  }

  export function handles<T extends Any>(slots: T): HandlesOf<T> {
    const out: Record<string, SlotHandle> = {};
    for (const [name, bound] of Object.entries(slots.bound)) {
      out[name] = bound.handle;
    }
    return out as HandlesOf<T>;
  }

  export function metadata<T extends Any>(slots: T): MetadataOf<T> {
    const out: Record<string, SlotMetadata> = {};
    for (const [name, bound] of Object.entries(slots.bound)) {
      out[name] = bound.slot.metadata;
    }
    return out as MetadataOf<T>;
  }

  export function withCapability<T extends Any, C extends SlotCapability>(
    slots: T,
    capability: C,
  ): {
    readonly [K in keyof BoundOf<T> & string as MetadataToken.NameOf<C> extends Slot.AssignableCapabilityNamesOf<BoundOf<T>[K]> ? K : never]: BoundOf<T>[K];
  } {
    const out: Record<string, Slot.BoundAny> = {};
    const capabilityName = MetadataToken.nameOf(capability);
    for (const [name, bound] of Object.entries(slots.bound)) {
      const slotCapabilityName = MetadataToken.nameOf(bound.slot.metadata.capability);
      if (Element.extendsCapability(slotCapabilityName, capabilityName)) {
        out[name] = bound;
      }
    }
    return out as any;
  }
}

export type ViewPropValue =
  | TextHoleValue
  | Hole
  | readonly ViewPropValue[]
  | { readonly [key: string]: ViewPropValue };

export type ViewProps = Readonly<Record<string, ViewPropValue>>;

export type ViewNode<Slots> =
  | ViewElement<Slots>
  | ViewTextNode
  | ViewFragment<Slots>
  | ViewHoleNode;

export interface ViewElement<Slots> {
  readonly kind: "view.node.element";
  readonly element: SlotCapability;
  readonly slot?: keyof Slots & string;
  readonly props?: ViewProps;
  readonly children?: readonly ViewNode<Slots>[];
}

export interface ViewTextNode {
  readonly kind: "view.node.text";
  readonly value: TextHoleValue;
}

export interface ViewFragment<Slots> {
  readonly kind: "view.node.fragment";
  readonly children: readonly ViewNode<Slots>[];
}

export interface ViewHoleNode {
  readonly kind: "view.node.hole";
  readonly hole: Hole;
}

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

type PlatformCapabilityValuesOf<T> = T extends { readonly metadata: infer Metadata }
  ? PlatformCapabilityValuesOf<Metadata>
  : "capabilities" extends keyof T
    ? T extends { readonly capabilities?: readonly unknown[] }
      ? NonNullable<T["capabilities"]>[number]
      : never
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
  LiteralMissing<SlotCapabilityOf<Slot>, Element.Capability.AssignableNamesOf<PlatformCapabilityValuesOf<Platform>>> extends infer Capability
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

export type EventHoleHandler<Event, Req, E> = {
  bivarianceHack(event: Event): void | Effect.Effect<void, E, Req>;
}["bivarianceHack"];

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
  readonly _event?: Event;
  readonly _Req?: Req;
  readonly _E?: E;
}

export interface ChildrenHole {
  readonly kind: "view.hole.children";
  readonly value: unknown;
}

/**
 * Low-level / generated constructor. Prefer `View.fromSlots` / `View.fromJsx`
 * for authored code. `slotMetadata` on this form is the dynamic escape hatch;
 * `View.slot` / `View.hidden` remain public as low-level witness builders.
 */
export function make<Slots>(
  slots: Slots,
  node: unknown,
  options?: {
    readonly tree?: ViewNode<Slots>;
    readonly name?: string;
    readonly metadata?: ViewMetadata;
    readonly slotMetadata?: SlotMetadataMap<Slots>;
    readonly slotRemaps?: readonly SlotRemap<Slots>[];
  },
): View<Slots> {
  const out = {
    [ViewTypeId]: {
      Slots: undefined as unknown as Slots,
    },
    slots,
    node,
    tree: options?.tree,
    name: options?.name,
    metadata: options?.metadata,
    slotMetadata: options?.slotMetadata,
    slotRemaps: options?.slotRemaps,
  } as View<Slots>;
  return Object.assign(out, {
    pipe: (...fns: ReadonlyArray<(value: any) => any>) => pipeSelf(out, fns),
  }) as View<Slots>;
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

type SlotsOfViewNodeChildren<T> = T extends readonly ViewNode<infer Slots>[] ? Slots : {};

export function element<
  const S extends Slot.Any,
  const Children extends readonly ViewNode<any>[] | undefined = undefined,
>(
  element: S,
  options?: {
    readonly props?: ViewProps;
    readonly children?: Children;
  },
): ViewElement<Record<Slot.NameOf<S>, unknown> & SlotsOfViewNodeChildren<Children>>;
export function element<Slots>(
  element: SlotCapability,
  options?: {
    readonly slot?: keyof Slots & string;
    readonly props?: ViewProps;
    readonly children?: readonly ViewNode<Slots>[];
  },
): ViewElement<Slots>;
export function element<Slots>(
  element: SlotCapability | Slot.Any,
  options?: {
    readonly slot?: keyof Slots & string;
    readonly props?: ViewProps;
    readonly children?: readonly ViewNode<Slots>[];
  },
): ViewElement<Slots> {
  const slotWitness = typeof element === "object" && element !== null && SlotTypeId in element
    ? element as Slot.Any
    : undefined;
  return {
    kind: "view.node.element",
    element: slotWitness?.metadata.capability ?? element as SlotCapability,
    slot: options?.slot ?? slotWitness?.name as keyof Slots & string | undefined,
    props: options?.props,
    children: options?.children,
  };
}

export function textNode(value: TextHoleValue): ViewTextNode {
  return {
    kind: "view.node.text",
    value,
  };
}

export function fragment<Slots>(
  children: readonly ViewNode<Slots>[],
): ViewFragment<Slots> {
  return {
    kind: "view.node.fragment",
    children,
  };
}

export function hole(hole: Hole): ViewHoleNode {
  return {
    kind: "view.node.hole",
    hole,
  };
}

/** Narrow a `ViewNode` to a `ViewElement` (has `element`, `slot`, `children`). */
export function isElement<Slots>(node: ViewNode<Slots> | undefined): node is ViewElement<Slots> {
  return node?.kind === "view.node.element";
}

/** Narrow a `ViewNode` to a `ViewFragment` (has `children`). */
export function isFragment<Slots>(node: ViewNode<Slots> | undefined): node is ViewFragment<Slots> {
  return node?.kind === "view.node.fragment";
}

/** Narrow a `ViewNode` to a `ViewTextNode`. */
export function isTextNode<Slots>(node: ViewNode<Slots> | undefined): node is ViewTextNode {
  return node?.kind === "view.node.text";
}

export function tree<Slots>(
  slots: Slots,
  tree: ViewNode<Slots>,
  node: unknown = tree,
  options?: {
    readonly name?: string;
    readonly metadata?: ViewMetadata;
    readonly slotMetadata?: SlotMetadataMap<Slots>;
    readonly slotRemaps?: readonly SlotRemap<Slots>[];
  },
): View<Slots> {
  return make(slots, node, {
    ...options,
    tree,
  });
}

/**
 * Authored path: build a View from a slot contract + JSX (or other) node.
 * Prefer this over `View.make` / raw `slotMetadata` maps.
 *
 * When `options.tree` is omitted, a minimal fragment tree is attached so
 * authored views always carry `tree` metadata (Finding 6 staging).
 */
export function fromSlots<S extends Slots.Any>(
  slots: S,
  node: unknown,
  options?: {
    readonly tree?: ViewNode<Slots.HandlesOf<S>>;
    readonly name?: string;
    readonly metadata?: ViewMetadata;
    readonly slotMetadata?: SlotMetadataMap<Slots.HandlesOf<S>>;
    readonly slotRemaps?: readonly SlotRemap<Slots.HandlesOf<S>>[];
  },
): View<Slots.HandlesOf<S>> {
  const handles = Slots.handles(slots);
  const treeNode = options?.tree ?? fragment([]);
  return make(handles, node, {
    ...options,
    tree: treeNode as ViewNode<Slots.HandlesOf<S>>,
    slotMetadata: {
      ...Slots.metadata(slots),
      ...options?.slotMetadata,
    } as SlotMetadataMap<Slots.HandlesOf<S>>,
  });
}

/**
 * Finding 2 residual: authored JSX is the markup surface; optional explicit
 * typed tree metadata rides alongside (compiler extraction is v1.x).
 */
export function fromJsx<S extends Slots.Any>(
  slots: S,
  jsxNode: unknown,
  options?: {
    readonly tree?: ViewNode<Slots.HandlesOf<S>>;
    readonly name?: string;
  },
): View<Slots.HandlesOf<S>> {
  return fromSlots(slots, jsxNode, options);
}

function cloneView<Slots>(
  view: View<Slots>,
  options: {
    readonly tree?: ViewNode<Slots>;
    readonly name?: string;
    readonly metadata?: ViewMetadata;
    readonly slotMetadata?: SlotMetadataMap<Slots>;
    readonly slotRemaps?: readonly SlotRemap<Slots>[];
  },
): View<Slots> {
  return make(view.slots, view.node, {
    tree: options.tree,
    name: options.name,
    metadata: options.metadata,
    slotMetadata: options.slotMetadata,
    slotRemaps: options.slotRemaps,
  });
}

function appendTreeChildren<Slots>(
  treeNode: ViewNode<Slots> | undefined,
  added: readonly ViewNode<Slots>[],
): ViewNode<Slots> {
  if (treeNode === undefined) return fragment(added);
  switch (treeNode.kind) {
    case "view.node.fragment":
      return fragment([...treeNode.children, ...added]);
    case "view.node.element":
      return {
        ...treeNode,
        children: [...(treeNode.children ?? []), ...added],
      };
    case "view.node.text":
    case "view.node.hole":
      return fragment([treeNode, ...added]);
  }
}

export function withTree(
  tree: ViewNode<any>,
): <Slots>(view: View<Slots>) => View<Slots> {
  return (view) => cloneView(view, {
    tree: tree as unknown as ViewNode<typeof view.slots>,
    name: view.name,
    metadata: view.metadata,
    slotMetadata: view.slotMetadata,
    slotRemaps: view.slotRemaps,
  });
}

export function withChildren(
  ...children: readonly ViewNode<any>[]
): <Slots>(view: View<Slots>) => View<Slots> {
  return appendChildren(...children);
}

export function appendChildren(
  ...children: readonly ViewNode<any>[]
): <Slots>(view: View<Slots>) => View<Slots> {
  return (view) => cloneView(view, {
    tree: appendTreeChildren(view.tree, children as unknown as readonly ViewNode<typeof view.slots>[]),
    name: view.name,
    metadata: view.metadata,
    slotMetadata: view.slotMetadata,
    slotRemaps: view.slotRemaps,
  });
}

export function withName(
  name: string,
): <Slots>(view: View<Slots>) => View<Slots> {
  return (view) => cloneView(view, {
    tree: view.tree,
    name,
    metadata: view.metadata,
    slotMetadata: view.slotMetadata,
    slotRemaps: view.slotRemaps,
  });
}

export function withMetadata(
  metadata: ViewMetadata,
): <Slots>(view: View<Slots>) => View<Slots> {
  return (view) => cloneView(view, {
    tree: view.tree,
    name: view.name,
    metadata: {
      ...view.metadata,
      ...metadata,
    },
    slotMetadata: view.slotMetadata,
    slotRemaps: view.slotRemaps,
  });
}

export function withSlotMetadata<MetadataSlots>(
  slotMetadata: SlotMetadataMap<MetadataSlots>,
): <Slots extends MetadataSlots>(view: View<Slots>) => View<Slots> {
  return <ViewSlots extends MetadataSlots>(view: View<ViewSlots>) => cloneView(view, {
    tree: view.tree,
    name: view.name,
    metadata: view.metadata,
    slotMetadata: {
      ...view.slotMetadata,
      ...slotMetadata,
    } as SlotMetadataMap<ViewSlots>,
    slotRemaps: view.slotRemaps,
  });
}

export function withRemaps<Slots>(
  ...slotRemaps: readonly SlotRemap<Slots>[]
): (view: View<Slots>) => View<Slots> {
  return (view) => cloneView(view, {
    tree: view.tree,
    name: view.name,
    metadata: view.metadata,
    slotMetadata: view.slotMetadata,
    slotRemaps: [
      ...(view.slotRemaps ?? []),
      ...slotRemaps,
    ],
  });
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

export function extendsCapability(value: SlotCapability, base: SlotCapability): boolean {
  return Element.extendsCapability(value, base);
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

function includesCapabilityOptional(values: readonly SlotCapability[] | undefined, value: SlotCapability): boolean {
  if (values === undefined) return true;
  return values.some((current) => extendsCapability(current, value));
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
      && targetCapability !== undefined
      && sourceCapability !== undefined
      && !extendsCapability(targetCapability, sourceCapability)
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

function validateTreeNode<Slots>(
  view: View<Slots>,
  node: ViewNode<Slots>,
  diagnostics: ViewDiagnostic[],
  options: {
    readonly allowHidden?: boolean;
  },
): void {
  switch (node.kind) {
    case "view.node.element": {
      if (node.slot !== undefined) {
        const slotValue = slotValueFor(view, node.slot);
        if (slotValue === undefined) {
          diagnostics.push({
            code: "view:unknown-slot",
            message: `View ${view.name ?? "<anonymous>"} tree references unknown slot ${node.slot}.`,
            slot: node.slot,
          });
        } else {
          const meta = metadataFor(view, node.slot);
          if (meta?.hidden === true && options.allowHidden !== true) {
            diagnostics.push({
              code: "view:hidden-slot",
              message: `View ${view.name ?? "<anonymous>"} tree references hidden slot ${node.slot}.`,
              slot: node.slot,
            });
          }

          const slotCapability = meta?.capability ?? capabilityOf(slotValue);
          const treeCapability = node.element;
          if (slotCapability !== undefined && !extendsCapability(treeCapability, slotCapability)) {
            diagnostics.push({
              code: "view:remap-capability-mismatch",
              message: `View ${view.name ?? "<anonymous>"} tree element ${nameOfCapability(treeCapability)} is incompatible with slot ${node.slot} (${nameOfCapability(slotCapability)}).`,
              slot: node.slot,
              source: "tree",
              target: node.slot,
              capability: nameOfCapability(treeCapability),
            });
          }
        }
      }

      for (const child of node.children ?? []) {
        validateTreeNode(view, child, diagnostics, options);
      }
      return;
    }
    case "view.node.fragment":
      for (const child of node.children) {
        validateTreeNode(view, child, diagnostics, options);
      }
      return;
    case "view.node.text":
    case "view.node.hole":
      return;
  }
}

export function validateTree<Slots>(
  view: View<Slots>,
  options?: {
    readonly allowHidden?: boolean;
  },
): readonly ViewDiagnostic[] {
  if (view.tree === undefined) return [];
  const diagnostics: ViewDiagnostic[] = [];
  validateTreeNode(view, view.tree, diagnostics, options ?? {});
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

    if (capability !== undefined && !includesCapabilityOptional(platform.capabilities, capability)) {
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
  Slot,
  Slots,
  make,
  fromSlots,
  fromJsx,
  withTree,
  withChildren,
  appendChildren,
  withName,
  withMetadata,
  withSlotMetadata,
  withRemaps,
  platform,
  isView,
  node,
  text,
  className,
  style,
  html,
  event,
  children,
  element,
  textNode,
  fragment,
  hole,
  tree,
  slot,
  hidden,
  remap,
  capabilityOf,
  nameOfCapability,
  extendsCapability,
  nameOfEvent,
  nameOfAttribute,
  nameOfRequirement,
  nameOfMetadata,
  validateSlotTargets,
  validateRemaps,
  validateTree,
  validatePlatform,
  reportPlatformDiagnostics,
} as const;
