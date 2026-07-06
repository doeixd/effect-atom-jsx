import { Effect } from "effect";
import {
  Behavior,
  Component,
  Element,
  Route,
  Style,
  View,
} from "../index.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const Card = Component.make<
  {},
  never,
  never,
  { readonly slots: { readonly root: Element.Container } }
>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({ slots: { root: Element.container() } }),
  (_props, bindings) => View.make(bindings.slots, "card", {
    slotMetadata: {
      root: View.slot("root", {
        capability: Element.Capability.Container,
        allowedEvents: [View.Event.Press],
        allowedAttributes: [View.Attribute.AriaLabel],
      }),
    },
  }),
);

const viewEffect = Component.renderViewEffect(Card, {});
type ViewEffectValue = typeof viewEffect extends Effect.Effect<infer A, any, any> ? A : never;
type _ViewEffectValue = Expect<Equal<ViewEffectValue, View.View<Component.SlotsOf<typeof Card>> | undefined>>;

const behavior = Behavior.events({
  root: [View.Event.Press],
})(
  Behavior.make<
    { readonly root: Element.Container },
    {},
    never,
    never
  >(() => Effect.succeed({})),
);

Behavior.validateComponentAttachmentBySlots(behavior, { root: "root" }, Card, {});

const RootSlot = View.Slot.make("root", {
  capability: Element.Capability.Container,
});
const remappedBehavior = Behavior.make<
  { readonly container: Element.Container },
  {},
  never,
  never
>(() => Effect.succeed({}));
const BehaviorMappedCard = Card.pipe(
  Behavior.attachBySlotContract(remappedBehavior, { container: RootSlot }),
);
type _BehaviorMappedCardSlots = Expect<Equal<Component.SlotsOf<typeof BehaviorMappedCard>, Component.SlotsOf<typeof Card>>>;

const style = Style.make({
  root: Style.slot({ color: "red" }),
});

Style.validateComponentAttachment(style, Card, {});
const remappedStyle = Style.make({
  container: Style.slot({ color: "blue" }),
});
const StyleMappedCard = Card.pipe(
  Style.attachBySlotContract(remappedStyle, { container: RootSlot }),
);
type _StyleMappedCardSlots = Expect<Equal<Component.SlotsOf<typeof StyleMappedCard>, Component.SlotsOf<typeof Card>>>;
Style.validatePlatform(style, {
  name: "public-test",
  properties: [Style.Property.Color],
});
const StylePlatform = Style.platform({
  name: "public-style-platform",
  properties: [Style.Property.Color],
});
Style.reportPlatformDiagnostics(style, { metadata: StylePlatform.metadata });

const RoutedCard = Route.componentOf(Route.page("/card", Card));
type _RoutedCardSlots = Expect<Equal<Component.SlotsOf<typeof RoutedCard>, Component.SlotsOf<typeof Card>>>;

const PublicPlatform = View.platform({
  name: "public-platform",
  capabilities: [Element.Capability.Container],
  events: [View.Event.Press],
  attributes: [View.Attribute.AriaLabel],
});

const publicSlot = View.slot("root", {
  capability: Element.Capability.Container,
  allowedEvents: [View.Event.Press],
});

type _PublicPlatformSupport = Expect<Equal<
  View.MissingPlatformSupport<typeof publicSlot, typeof PublicPlatform>,
  never
>>;
type _PublicPlatformIsCompatible = Expect<Equal<
  View.IsPlatformCompatible<typeof publicSlot, typeof PublicPlatform>,
  true
>>;

View.nameOfEvent(View.Event.Press);
View.nameOfAttribute(View.Attribute.AriaLabel);
View.nameOfCapability(Element.Capability.Container);
Element.nameOfCapability(Element.Capability.Container);
Style.nameOfProperty(Style.Property.Color);
