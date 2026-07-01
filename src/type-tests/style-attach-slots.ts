import { Effect } from "effect";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Style from "../Style.js";
import * as View from "../View.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const style = Style.make({
  root: Style.slot({ padding: "md" }),
  title: Style.slot({ fontSize: "heading.sm" }),
});

const Card = Component.make<
  {},
  never,
  never,
  {
    readonly slots: {
      readonly root: ReturnType<typeof Component.slotContainer> extends Effect.Effect<infer S, any, any> ? S : never;
      readonly title: ReturnType<typeof Component.slotInteractive> extends Effect.Effect<infer S, any, any> ? S : never;
    };
  }
>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.gen(function* () {
    const root = yield* Component.slotContainer();
    const title = yield* Component.slotInteractive();
    return { slots: { root, title } };
  }),
  () => null,
);

Card.pipe(
  Style.attachBySlots(style, {
    root: "root",
    title: "title",
  }),
);

const strictAttach = Style.attachBySlotsFor<Component.BindingsOf<typeof Card>>();
const strictAttachFromSlots = Style.attachBySlotsFor<Component.SlotsOf<typeof Card>>();

strictAttach(style, {
  root: "root",
  title: "title",
});

strictAttachFromSlots(style, {
  root: "root",
  title: "title",
});

strictAttach(style, {
  root: "root",
  // @ts-expect-error missing component slot name
  title: "header",
});

// Negative: attach requires all style slot names to exist in component Slots
Card.pipe(
  // @ts-expect-error missing slot 'missing' does not exist in component
  Style.attach(Style.make({ missing: Style.slot({ padding: "md" }) })),
);

// SlotsOf preserved through style attachment
const StyledCard = Card.pipe(
  Style.attachBySlots(style, { root: "root", title: "title" }),
);
type _StyledCardSlots = Component.SlotsOf<typeof StyledCard>;
type _SlotsPreservedCheck = Expect<Equal<_StyledCardSlots, Component.SlotsOf<typeof Card>>>;

const StylePlatform = Style.platform({
  name: "type-test-style-platform",
  properties: [Style.Property.Padding, Style.Property.FontSize],
});

const StyledCardWithPlatform = Card.pipe(
  Style.attach(style),
  Component.withLayer(StylePlatform),
);
type _StyledCardWithPlatformSlots = Component.SlotsOf<typeof StyledCardWithPlatform>;
type _StyledCardWithPlatformSlotsPreserved = Expect<Equal<
  _StyledCardWithPlatformSlots,
  Component.SlotsOf<typeof Card>
>>;

const styledCardWithPlatformViewEffect = Component.renderViewEffect(StyledCardWithPlatform, {});
type StyledCardWithPlatformViewEffectValue =
  typeof styledCardWithPlatformViewEffect extends Effect.Effect<infer A, any, any> ? A : never;
type _StyledCardWithPlatformRenderView = Expect<Equal<
  StyledCardWithPlatformViewEffectValue,
  View.View<Component.SlotsOf<typeof StyledCardWithPlatform>> | undefined
>>;

// ─── attachByView tests ───────────────────────────────────────────────────────
// A View-backed component with explicit Slots (5th type param), no bindings.slots
const ViewCard = Component.make<
  {},
  never,
  never,
  {},
  { readonly root: Element.Container; readonly title: Element.Interactive }
>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({}),
  () => View.make(
    { root: null as unknown as Element.Container, title: null as unknown as Element.Interactive },
    null,
  ),
);

// Positive: attachByView with matching style slots
ViewCard.pipe(
  Style.attachByView(style),
);

// Negative: attachByView with style slot not in component Slots
ViewCard.pipe(
  // @ts-expect-error style slot 'missing' not in component Slots
  Style.attachByView(Style.make({ missing: Style.slot({ padding: "md" }) })),
);

// SlotsOf preserved through attachByView
const StyledViewCard = ViewCard.pipe(
  Style.attachByView(style),
);
type _StyledViewCardSlots = Component.SlotsOf<typeof StyledViewCard>;
type _ViewSlotsPreservedCheck = Expect<Equal<_StyledViewCardSlots, Component.SlotsOf<typeof ViewCard>>>;
