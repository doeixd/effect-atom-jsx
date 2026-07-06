import { Effect } from "effect";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Route from "../Route.js";
import * as Style from "../Style.js";
import * as View from "../View.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const Root = View.Slot.make("root", {
  capability: Element.Capability.Container,
});
const Input = View.Slot.make("input", {
  capability: Element.Capability.TextInput,
});
const Secret = View.Slot.make("secret", {
  capability: Element.Capability.Interactive,
  hidden: true,
});

const root = Element.container();
const input = Element.textInput();
const secret = Element.interactive();
const slotHandles = { root, input, secret };
const FieldSlots = View.Slots.make({
  root: View.Slot.bind(Root, root),
  input: View.Slot.bind(Input, input),
  secret: View.Slot.bind(Secret, secret),
});
type SlotHandles = View.Slots.HandlesOf<typeof FieldSlots>;

const Field = Component.make<{}, never, never, { readonly slots: typeof slotHandles }>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({ slots: slotHandles }),
  () => View.fromSlots(FieldSlots, null),
).pipe(
  Component.withSlots(FieldSlots),
);

type FieldSlotContract = Component.SlotContractOf<typeof Field>;
type _FieldSlotContract = Expect<Equal<FieldSlotContract, typeof FieldSlots>>;
type FieldMetadataSlotContract = typeof Field[typeof Component.ComponentTypeId]["SlotContract"];
type _FieldMetadataSlotContract = Expect<Equal<FieldMetadataSlotContract, typeof FieldSlots>>;
type FieldPublicSlots = Component.PublicSlotsOf<typeof Field>;
type _FieldPublicSlots = Expect<Equal<FieldPublicSlots, Pick<SlotHandles, "root" | "input">>>;
type FieldHiddenSlots = Component.HiddenSlotsOf<typeof Field>;
type _FieldHiddenSlots = Expect<Equal<FieldHiddenSlots, Pick<SlotHandles, "secret">>>;

const ContractProjectedField = Component.make<{}, never, never, { readonly slots: { readonly root: Element.TextInput } }>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({ slots: { root: Element.textInput() } }),
  () => null,
).pipe(
  Component.withSlots(FieldSlots),
);

type ContractProjectedSlots = Component.SlotsOf<typeof ContractProjectedField>;
type _ContractProjectedSlots = Expect<Equal<ContractProjectedSlots, SlotHandles>>;
type ContractProjectedSlotContract = Component.SlotContractOf<typeof ContractProjectedField>;
type _ContractProjectedSlotContract = Expect<Equal<ContractProjectedSlotContract, typeof FieldSlots>>;

const fieldStyle = Style.forSlots(FieldSlots)({
  input: Style.slot({ color: "red" }),
});

Style.forSlots(FieldSlots)({
  // @ts-expect-error style slots must be authored slot contract names
  missing: Style.slot({ color: "red" }),
});

const focusBehavior = Behavior.forSlots(FieldSlots)((elements) =>
  Effect.succeed({
    focusedKind: elements.input.kind,
  }),
);

const remappedBehavior = Behavior.forSlots({ field: Input })((elements) =>
  Effect.succeed({
    fieldKind: elements.field.kind,
  }),
);

const EnhancedField = Field.pipe(
  Style.attachToSlots(fieldStyle, FieldSlots),
  Behavior.attachToSlots(focusBehavior, FieldSlots),
  Behavior.attachToSlots(remappedBehavior, { field: Input }),
);

type EnhancedSlotContract = Component.SlotContractOf<typeof EnhancedField>;
type _EnhancedSlotContract = Expect<Equal<EnhancedSlotContract, typeof FieldSlots>>;

type EnhancedSlots = Component.SlotsOf<typeof EnhancedField>;
type _EnhancedSlots = Expect<Equal<EnhancedSlots, SlotHandles>>;

const MixedStyledBehaviorField = Field.pipe(
  Style.attachToSlots(fieldStyle, FieldSlots),
  Behavior.attachToSlots(focusBehavior, FieldSlots),
  Component.withLoading(() => null),
);

const MixedWrappedField = MixedStyledBehaviorField.pipe(
  Component.withPreSetup(Effect.void),
  Component.guard(Effect.void),
  Component.route("/field"),
);

type MixedWrappedSlotContract = Component.SlotContractOf<typeof MixedWrappedField>;
type _MixedWrappedSlotContract = Expect<Equal<MixedWrappedSlotContract, typeof FieldSlots>>;
type MixedWrappedSlots = Component.SlotsOf<typeof MixedWrappedField>;
type _MixedWrappedSlots = Expect<Equal<MixedWrappedSlots, SlotHandles>>;
type MixedWrappedPublicSlots = Component.PublicSlotsOf<typeof MixedWrappedField>;
type _MixedWrappedPublicSlots = Expect<Equal<MixedWrappedPublicSlots, Pick<SlotHandles, "root" | "input">>>;
type MixedWrappedHiddenSlots = Component.HiddenSlotsOf<typeof MixedWrappedField>;
type _MixedWrappedHiddenSlots = Expect<Equal<MixedWrappedHiddenSlots, Pick<SlotHandles, "secret">>>;

const ViewSlotOnlyField = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({ ready: true }),
  () => View.fromSlots(FieldSlots, null),
).pipe(
  Component.withSlots(FieldSlots),
);

type ViewSlotOnlyBindings = Component.BindingsOf<typeof ViewSlotOnlyField>;
type _ViewSlotOnlyBindingsHasSlots = Expect<Equal<ViewSlotOnlyBindings["slots"], SlotHandles>>;

const ViewSlotOnlyWithBehavior = ViewSlotOnlyField.pipe(
  Behavior.attachToSlots(focusBehavior, FieldSlots),
);

type _ViewSlotOnlyWithBehaviorSlots = Expect<Equal<Component.SlotsOf<typeof ViewSlotOnlyWithBehavior>, SlotHandles>>;
type _ViewSlotOnlyWithBehaviorContract = Expect<Equal<Component.SlotContractOf<typeof ViewSlotOnlyWithBehavior>, typeof FieldSlots>>;

const FieldRoute = Route.page("/field-node", Field).pipe(
  Route.id("field.node"),
  Route.loader(() => Effect.succeed({ ok: true as const })),
);
type FieldRouteStoredSlotContract = Component.SlotContractOf<typeof FieldRoute.component>;
type _FieldRouteStoredSlotContract = Expect<Equal<FieldRouteStoredSlotContract, typeof FieldSlots>>;
type FieldRouteStoredSlots = Component.SlotsOf<typeof FieldRoute.component>;
type _FieldRouteStoredSlots = Expect<Equal<FieldRouteStoredSlots, SlotHandles>>;

const FieldRouteComponent = Route.componentOf(FieldRoute);
type FieldRouteComponentSlotContract = Component.SlotContractOf<typeof FieldRouteComponent>;
type _FieldRouteComponentSlotContract = Expect<Equal<FieldRouteComponentSlotContract, typeof FieldSlots>>;
type FieldRouteComponentSlots = Component.SlotsOf<typeof FieldRouteComponent>;
type _FieldRouteComponentSlots = Expect<Equal<FieldRouteComponentSlots, SlotHandles>>;

const MaterializedFieldRoute = Route.componentOf(FieldRoute).pipe(
  Style.attachToSlots(fieldStyle, FieldSlots),
  Behavior.attachToSlots(focusBehavior, FieldSlots),
);

type MaterializedFieldRouteSlotContract = Component.SlotContractOf<typeof MaterializedFieldRoute>;
type _MaterializedFieldRouteSlotContract = Expect<Equal<MaterializedFieldRouteSlotContract, typeof FieldSlots>>;
type MaterializedFieldRouteSlots = Component.SlotsOf<typeof MaterializedFieldRoute>;
type _MaterializedFieldRouteSlots = Expect<Equal<MaterializedFieldRouteSlots, SlotHandles>>;

