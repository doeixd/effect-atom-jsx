import { Effect, Layer } from "effect";
import * as Behavior from "../Behavior.js";
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

const FieldInput = View.Slot.make("input", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input],
});
const makeFieldSlots = () =>
  View.Slots.make({
    input: View.Slot.bind(FieldInput, Element.textInput()),
  });

const Field = Component.make<{}, never, never, { readonly slots: { readonly input: Element.TextInput } }>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({ slots: View.Slots.handles(makeFieldSlots()) }),
  () => View.fromSlots(makeFieldSlots(), null),
);

type FieldSlots = Component.SlotsOf<typeof Field>;
type _FieldSlots = Expect<Equal<FieldSlots, { readonly input: Element.TextInput }>>;

const viewEffect = Component.renderViewEffect(Field, {});
type ViewEffectValue = typeof viewEffect extends Effect.Effect<infer A, any, any> ? A : never;
type _RenderedViewSlots = Expect<Equal<ViewEffectValue, View.View<FieldSlots> | undefined>>;

const style = Style.make({
  input: Style.slot({ color: "red" }),
});

Style.validateComponentAttachment(style, Field, {});

const NeedsInput = Behavior.events({
  input: [View.Event.Input],
})(
  Behavior.make<
    { readonly input: Element.TextInput },
    {},
    never,
    never
  >(() => Effect.succeed({})),
);

Behavior.validateComponentAttachmentBySlots(
  NeedsInput,
  { input: "input" },
  Field,
  {},
);

Behavior.validateComponentAttachmentBySlots(
  NeedsInput,
  // @ts-expect-error mapped target must be a component slot
  { input: "missing" },
  Field,
  {},
);

const WrappedField = Field.pipe(
  Behavior.attachBySlots(NeedsInput, { input: "input" }),
  Style.attachByView(style),
  Component.withLayer(Layer.empty),
  Component.guard(Effect.void),
);

type WrappedSlots = Component.SlotsOf<typeof WrappedField>;
type _WrappedSlots = Expect<Equal<WrappedSlots, FieldSlots>>;

const wrappedViewEffect = Component.renderViewEffect(WrappedField, {});
type WrappedViewEffectValue = typeof wrappedViewEffect extends Effect.Effect<infer A, any, any> ? A : never;
type _WrappedRenderedViewSlots = Expect<Equal<WrappedViewEffectValue, View.View<WrappedSlots> | undefined>>;
