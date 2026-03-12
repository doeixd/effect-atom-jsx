import { Effect } from "effect";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";

const NeedsInput = Behavior.make<
  { readonly input: Element.TextInput },
  { readonly ok: true },
  never,
  never
>(() => Effect.succeed({ ok: true as const }));

const NeedsItems = Behavior.make<
  { readonly items: Element.Collection<Element.Interactive> },
  { readonly selectedCount: number },
  never,
  never
>(() => Effect.succeed({ selectedCount: 0 }));

const Base = Component.make<
  {},
  never,
  never,
  {
    readonly slots: {
      readonly input: Element.TextInput;
      readonly list: Element.Collection<Element.Interactive>;
      readonly content: Element.Container;
    };
  }
>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.gen(function* () {
    const input = yield* Component.slotTextInput();
    const list = yield* Component.slotCollection([Element.interactive()]);
    const content = yield* Component.slotContainer();
    return {
      slots: {
        input,
        list,
        content,
      },
    };
  }),
  () => null,
);

Base.pipe(
  Behavior.attachBySlots(NeedsInput, { input: "input" }),
  Behavior.attachBySlots(NeedsItems, { items: "list" }),
);

type BaseBindings = Component.BindingsOf<typeof Base>;

const attachInputStrict = Behavior.attachBySlots<
  { readonly input: Element.TextInput },
  { readonly ok: true },
  never,
  never,
  {},
  never,
  never,
  BaseBindings["slots"],
  BaseBindings
>(NeedsInput, { input: "input" });

attachInputStrict(Base);

Behavior.attachBySlots<
  { readonly input: Element.TextInput },
  { readonly ok: true },
  never,
  never,
  {},
  never,
  never,
  BaseBindings["slots"],
  BaseBindings
>(
  NeedsInput,
  // @ts-expect-error content is not assignable to TextInput requirement
  { input: "content" },
);

Behavior.attachBySlots<
  { readonly items: Element.Collection<Element.Interactive> },
  { readonly selectedCount: number },
  never,
  never,
  {},
  never,
  never,
  BaseBindings["slots"],
  BaseBindings
>(
  NeedsItems,
  // @ts-expect-error input is not assignable to Collection requirement
  { items: "input" },
);
