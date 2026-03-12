import { Effect } from "effect";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const addOpenState = Behavior.make<{
  readonly trigger: Element.Interactive;
}, {
  readonly isOpen: ReturnType<typeof Component.state<boolean>> extends Effect.Effect<infer S, any, any> ? S : never;
}, never, never>((elements) =>
  Effect.gen(function* () {
    const isOpen = yield* Component.state(false);
    yield* elements.trigger.setAttr("aria-expanded", () => isOpen());
    return { isOpen };
  }));

const Base = Component.make<{}, never, never, { readonly trigger: Element.Interactive }>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.gen(function* () {
    const trigger = yield* Component.slotInteractive();
    return { trigger };
  }),
  () => null,
);

const Enhanced = Base.pipe(
  Component.withBehavior(addOpenState, (bindings: { readonly trigger: Element.Interactive }) => ({
    trigger: bindings.trigger,
  })),
);

type _ReqCheck = Expect<Component.Requirements<typeof Enhanced> extends never | unknown ? true : false>;
type _HasIsOpen = Component.BindingsOf<typeof Enhanced> extends { readonly isOpen: any } ? true : false;
type _HasIsOpenCheck = Expect<Equal<_HasIsOpen, true>>;

const SlotBase = Component.make<
  {},
  never,
  never,
  {
    readonly slots: {
      readonly trigger: Element.Interactive;
      readonly content: Element.Container;
    };
  }
>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.gen(function* () {
    const trigger = yield* Component.slotInteractive();
    const content = yield* Component.slotContainer();
    return { slots: { trigger, content } };
  }),
  () => null,
);

const WithSlots = SlotBase.pipe(
  Behavior.attachBySlots(
    Behavior.make<
      { readonly trigger: Element.Interactive; readonly content: Element.Container },
      { readonly ok: true },
      never,
      never
    >(() => Effect.succeed({ ok: true as const })),
    { trigger: "trigger", content: "content" },
  ),
);

type _HasOk = Component.BindingsOf<typeof WithSlots> extends { readonly ok: true } ? true : false;
type _HasOkCheck = Expect<Equal<_HasOk, true>>;
