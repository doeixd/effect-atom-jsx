import { Effect, Schema, Context } from "effect";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";
import * as View from "../View.js";
import {
  expr,
  extract,
  inspectExpression,
  type ExpressionInspection,
  type ResumableExpression,
} from "../portable-extract.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
type CodeError<T> =
  T extends Portable.Code<any, any, ReadonlyArray<any>, any, infer E, any>
    ? E
    : never;
type CodeRequirements<T> =
  T extends Portable.Code<any, any, ReadonlyArray<any>, any, any, infer R>
    ? R
    : never;

const CardSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
});

const Card = Component.make(
  Component.props<{ readonly id: string }>(),
  Component.require<never>(),
  Component.setup<{ readonly id: string }>().value(
    "label",
    ({ props }) => `card:${props.id}`,
  ),
  (_props, bindings) => View.fromSlots(CardSlots, bindings.label),
).pipe(
  Component.withSlots(CardSlots),
  Component.withDefinition({ name: "Card" }),
);

const inspection = Component.inspect(Card);
const namespaceInspection = Component.Component.inspect(Card);

const parsed: { readonly id: string } = inspection.parseProps({ id: "1" });
const setup: Effect.Effect<
  Component.BindingsOf<typeof Card>,
  Component.Errors<typeof Card>,
  Component.Requirements<typeof Card>
> = inspection.setup(parsed);
const rendered: unknown = inspection.render(parsed, {
  label: "restored",
  slots: View.Slots.handles(CardSlots),
});
const renderedView:
  | View.View<View.NormalizeSlots<Component.SlotContractOf<typeof Card>>>
  | undefined = inspection.renderView(parsed, {
  label: "restored",
  slots: View.Slots.handles(CardSlots),
});

void setup;
void rendered;
void renderedView;
void namespaceInspection;

const collection: Effect.Effect<
  Resume.CollectionResult,
  Resume.CollectionError,
  Serialization.SerializationService
> = Resume.collect(() => "<button>Save</button>", {
  buildId: "type-test-build",
});

void collection;

declare const zeroArgumentAction: Component.ComponentAction<
  readonly [],
  void,
  never
>;
declare const inputAction: Component.ComponentAction<
  readonly [input: string],
  void,
  never
>;

Resume.event(zeroArgumentAction);

// @ts-expect-error resumed event entrypoints must bind all logical inputs
Resume.event(inputAction);

Resume.activationEvent(
  "save",
  Resume.MouseEventProjection,
  (projection) => {
    const clientX: number = projection.clientX;
    const kind: "mouse-v1" = projection.kind;
    // @ts-expect-error projections expose only the predefined schema fields
    projection.nativeEvent;
    void clientX;
    void kind;
  },
);

declare const expressionBindingDependency:
  Resume.InspectableStateHandle<number>;
const resumableText: ResumableExpression<string> = expr(
  (captures, dependencies) => {
    const label: string = captures.label;
    const count: number = dependencies[0];
    return `${label}:${count}`;
  },
  {
    captures: Schema.Struct({ label: Schema.String }),
    bind: { label: "Count: 1" },
    dependencies: Schema.Tuple([Schema.Number]),
    deps: [
      expressionBindingDependency,
    ],
  },
);
void resumableText;
const textInspection: ExpressionInspection<string> =
  inspectExpression(resumableText);
void textInspection;

extract(
  (captures) => Effect.succeed(captures.label),
  {
    captures: Schema.Struct({ label: Schema.String }),
    bind: {
      // @ts-expect-error extracted binds are checked against the capture codec
      label: 1,
    },
  },
);

expr(
  (captures) => captures.label,
  {
    captures: Schema.Struct({ label: Schema.String }),
    bind: {
      // @ts-expect-error bind values are checked against the capture codec
      label: 1,
    },
    dependencies: Schema.Tuple([]),
    deps: [],
  },
);

declare const expressionQueryDependency: Component.QueryAtom<number, never>;
expr(
  (_captures, [count]) => String(count),
  {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([Schema.Number]),
    // @ts-expect-error query handles expose Result during SSR; M8b value dependencies are state-only
    deps: [expressionQueryDependency],
  },
);

expr(
  (_captures: {}, [count]: readonly [number]) => String(count),
  {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([Schema.Number]),
    // @ts-expect-error dependency declarations are positionally coupled to the codec
    deps: [],
  },
);

expr(
  (_captures: {}, [count]: readonly [number]) => String(count),
  {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([Schema.Number]),
    // @ts-expect-error value-bearing dependency slots require a typed handle
    deps: ["count:1"],
  },
);

expr(
  // @ts-expect-error the first fine-grained slice accepts text only
  (_captures: {}) =>
    ({ node: "not text" }),
  {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([]),
    deps: [],
  },
);

Component.renderWithBindings(
  Card,
  // @ts-expect-error props remain required and strongly typed
  {},
  {
    label: "restored",
    slots: View.Slots.handles(CardSlots),
  },
);

// @ts-expect-error restored bindings must match the component binding snapshot
Component.renderWithBindings(Card, { id: "1" }, { label: 1 });

const StateCounter = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  Component.setup<{}>().bind("count", () => Component.state(0), {
    resume: Resume.snapshotState(Schema.Number),
  }),
  (_props, bindings) => bindings.count(),
);

declare const stateManifest: Resume.Manifest;
declare const resumeRoot: Document;

const restoredState: Effect.Effect<
  Resume.RestoredStateBindings<Component.BindingsOf<typeof StateCounter>>,
  Resume.StateBindingRestoreError
> = Resume.restoreStateBindings(StateCounter, stateManifest, "c0");

void restoredState;

// A duplicate restoration of one boundary is a declared restoration failure.
const duplicateRestoration: Resume.StateBindingRestoreError =
  new Resume.ResumeDuplicateComponentRestorationError({
    componentId: "c0" as Resume.ComponentId,
    message: "duplicate",
  });

void duplicateRestoration;

// A failed restored render is a classified restoration fallback, so it widens
// the fallback union but never the public restoration union.
const restoredRenderFallback: Resume.RestorationFallbackError =
  new Resume.ResumeRestoredRenderError({
    componentId: "c0" as Resume.ComponentId,
    message: "render failed",
  });

void restoredRenderFallback;

const modeConflictDiagnostic: Resume.ClientDiagnosticCode =
  "component-transition-mode-conflict";

void modeConflictDiagnostic;

const componentBoundaries: Effect.Effect<
  ReadonlyMap<Resume.ComponentId, Resume.ComponentBoundary>,
  Resume.ComponentBoundaryScanError
> = Resume.scanComponentBoundaries(resumeRoot, stateManifest);

void componentBoundaries;

const expressionTargets: Effect.Effect<
  ReadonlyMap<Resume.ExpressionId, Resume.ScannedExpressionTarget>,
  Resume.ExpressionTargetScanError
> = Resume.scanExpressionTargets(resumeRoot, stateManifest);

const attributeTarget: Resume.ExpressionTarget =
  Schema.decodeUnknownSync(Resume.ExpressionTargetSchema)({
    kind: "attribute",
    name: "aria-label",
  });
const styleTarget: Resume.ExpressionTarget =
  Schema.decodeUnknownSync(Resume.ExpressionTargetSchema)({
    kind: "style-property",
    name: "--progress",
  });

void expressionTargets;
void attributeTarget;
void styleTarget;

const AddressableProps = Schema.Struct({
  id: Schema.String,
});
const AddressableCard = Component.make(
  Component.propsSchema(AddressableProps),
  Component.require<never>(),
  ({ id }) => Effect.succeed({ id }),
  (_props, bindings) => bindings.id,
);
const AddressableCardWithActivation = AddressableCard.pipe(
  Component.withDefinition({ name: "AddressableCard" }),
  Resume.addressable({
    id: "type-test.addressable-card",
    buildId: "type-test-build",
    props: AddressableProps,
  }),
);
const AddressableCardActivation = Resume.activationOf(
  AddressableCardWithActivation,
);
// @ts-expect-error required component props must be available to restoration
Resume.restoreStateBindings(AddressableCard, stateManifest, "c0");
Resume.restoreStateBindings(
  AddressableCard,
  stateManifest,
  "c0",
  { id: "card-1" },
);
// @ts-expect-error scoped restoration has the same required-props contract
Resume.restoreStateBindingsScoped(AddressableCard, stateManifest, "c0");
Resume.restoreStateBindingsScoped(
  AddressableCard,
  stateManifest,
  "c0",
  { id: "card-1" },
);
type _AddressablePropsPreserved = Expect<
  Equal<
    Component.PropsOf<typeof AddressableCardWithActivation>,
    Component.PropsOf<typeof AddressableCard>
  >
>;
type _AddressableRequirementsPreserved = Expect<
  Equal<
    Component.Requirements<typeof AddressableCardWithActivation>,
    Component.Requirements<typeof AddressableCard>
  >
>;
type _AddressableErrorsPreserved = Expect<
  Equal<
    Component.Errors<typeof AddressableCardWithActivation>,
    Component.Errors<typeof AddressableCard>
  >
>;
type _AddressableBindingsPreserved = Expect<
  Equal<
    Component.BindingsOf<typeof AddressableCardWithActivation>,
    Component.BindingsOf<typeof AddressableCard>
  >
>;
type _ActivationErrorsInferred = Expect<
  Equal<
    CodeError<typeof AddressableCardActivation>,
    Resume.ResumeComponentActivationMountError
  >
>;
type _ActivationRequirementsInferred = Expect<
  Equal<CodeRequirements<typeof AddressableCardActivation>, never>
>;

type ActivationSetupError = {
  readonly _tag: "ActivationSetupError";
};
interface ActivationService {
  readonly label: Effect.Effect<string, ActivationSetupError>;
}
const ActivationService = Context.Service<ActivationService>(
  "effect-atom-jsx/type-tests/ResumeActivationService",
);
const EffectfulAddressableCard = Component.make(
  Component.propsSchema(AddressableProps),
  Component.require<ActivationService>(ActivationService),
  ({ id }) =>
    Effect.gen(function* () {
      const service = yield* ActivationService;
      const label = yield* service.label;
      return { id, label };
    }),
  (_props, bindings) => `${bindings.label}:${bindings.id}`,
).pipe(
  Resume.addressable({
    id: "type-test.effectful-addressable-card",
    buildId: "type-test-build",
    props: AddressableProps,
  }),
);
const EffectfulCardActivation = Resume.activationOf(EffectfulAddressableCard);
type _EffectfulActivationErrorsInferred = Expect<
  Equal<
    CodeError<typeof EffectfulCardActivation>,
    ActivationSetupError | Resume.ResumeComponentActivationMountError
  >
>;
type _EffectfulActivationRequirementsInferred = Expect<
  Equal<CodeRequirements<typeof EffectfulCardActivation>, ActivationService>
>;

const WrappedAfterAddressable = AddressableCardWithActivation.pipe(
  Component.withDefinition({ name: "TooLate" }),
);
// @ts-expect-error addressable must be the terminal component combinator
Resume.activationOf(WrappedAfterAddressable);

void AddressableCardWithActivation;
void AddressableCardActivation;
void EffectfulAddressableCard;
void EffectfulCardActivation;

AddressableCard.pipe(
  // @ts-expect-error addressable props must match the final component props
  Resume.addressable({
    id: "type-test.wrong-card",
    buildId: "type-test-build",
    props: Schema.Struct({ count: Schema.Number }),
  }),
);

declare const clientInstallation: Resume.ClientInstallation;
const clientInspection: Resume.ClientInstallationInspection =
  clientInstallation.inspect();
const dormantBoundaryCount: number =
  clientInspection.boundaries.dormant;
void dormantBoundaryCount;
const activationRequest: Effect.Effect<void, Resume.ComponentActivationError> =
  clientInstallation.activate("c0");
const dormantWrite: Effect.Effect<
  void,
  Resume.BindingSnapshotWriteError
> = clientInstallation.writeBinding(
  "c0",
  "count",
  Schema.Number,
  1,
);
clientInstallation.writeBinding(
  "c0",
  "count",
  Schema.Number,
  // @ts-expect-error written values are inferred from the supplied codec
  "not-a-number",
);
const encodedDormantWrite: Effect.Effect<
  void,
  Resume.BindingSnapshotWriteError
> = clientInstallation.writeBindingEncoded("c0", "count", 1);

void activationRequest;
void dormantWrite;
void encodedDormantWrite;

const inspectableState = Effect.runSync(Component.state(0));
const stateInspection: Resume.StateHandleInspection<number> =
  Resume.inspectHandle(inspectableState);

void stateInspection;

Component.setup<{}>().pipe(
  Component.bind("count", () => Component.state(0), {
    resume: Resume.snapshotState(Schema.Number),
  }),
);

Component.setup<{}>().bind("label", () => Effect.succeed("not-state"), {
  // @ts-expect-error snapshotState policies only apply to Component.state handles
  resume: Resume.snapshotState(Schema.Number),
});

Component.setup<{}>().bind("count", () => Component.state(0), {
  // @ts-expect-error the state snapshot codec must encode the state value type
  resume: Resume.snapshotState(Schema.String),
});
