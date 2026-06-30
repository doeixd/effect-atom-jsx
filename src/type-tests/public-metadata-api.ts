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

const style = Style.make({
  root: Style.slot({ color: "red" }),
});

Style.validateComponentAttachment(style, Card, {});
Style.validatePlatform(style, {
  name: "public-test",
  properties: [Style.Property.Color],
});

const RoutedCard = Route.componentOf(Route.page("/card", Card));
type _RoutedCardSlots = Expect<Equal<Component.SlotsOf<typeof RoutedCard>, Component.SlotsOf<typeof Card>>>;

View.nameOfEvent(View.Event.Press);
View.nameOfAttribute(View.Attribute.AriaLabel);
View.nameOfCapability(Element.Capability.Container);
Element.nameOfCapability(Element.Capability.Container);
Style.nameOfProperty(Style.Property.Color);
