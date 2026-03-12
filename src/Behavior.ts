import { Effect } from "effect";
import * as Component from "./Component.js";

const BehaviorTypeId: unique symbol = Symbol.for("effect-atom-jsx/Behavior");

export interface Behavior<Elements, Bindings, Req, E> {
  readonly [BehaviorTypeId]: {
    readonly Elements: Elements;
    readonly Bindings: Bindings;
    readonly Req: Req;
    readonly E: E;
  };
  readonly run: (elements: Elements) => Effect.Effect<Bindings, E, Req>;
}

export type ElementsOf<T> = T extends Behavior<infer E, any, any, any> ? E : never;
export type BindingsOf<T> = T extends Behavior<any, infer B, any, any> ? B : never;
export type RequirementsOf<T> = T extends Behavior<any, any, infer R, any> ? R : never;
export type ErrorsOf<T> = T extends Behavior<any, any, any, infer E> ? E : never;

type SlotMapLike = Record<string, unknown>;

type CompatibleSlotKey<Slots extends SlotMapLike, Needed> = {
  readonly [K in keyof Slots]: unknown extends Slots[K]
    ? K
    : Slots[K] extends Needed
      ? K
      : never;
}[keyof Slots];

export function make<Elements, Bindings, Req, E>(
  run: (elements: Elements) => Effect.Effect<Bindings, E, Req>,
): Behavior<Elements, Bindings, Req, E> {
  return {
    [BehaviorTypeId]: {
      Elements: undefined as unknown as Elements,
      Bindings: undefined as unknown as Bindings,
      Req: undefined as unknown as Req,
      E: undefined as unknown as E,
    },
    run,
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
>(
  behavior: Behavior<Elements, AddedBindings, BR, BE>,
  elementMap: { readonly [K in keyof Elements]: CompatibleSlotKey<Slots, Elements[K]> },
  merge?: (bindings: Bindings, added: AddedBindings) => Bindings & AddedBindings,
): (
  component: Component.Component<Props, Req, E, Bindings>,
) => Component.Component<Props, Req | BR, E | BE, Bindings & AddedBindings> {
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
  );
}

export const Behavior = {
  TypeId: BehaviorTypeId,
  make,
  compose,
  decorator,
  attach,
  attachBySlots,
} as const;
