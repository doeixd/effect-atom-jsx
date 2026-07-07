import {
  Cause,
  Effect,
  Fiber,
  Layer,
  Queue,
  Schedule,
  Scope,
  Schema,
  Stream as FxStream,
  type ServiceMap,
} from "effect";
import { createEffect, createSignal, onCleanup, useContext, type Accessor, type Setter } from "./api.js";
import { Owner, getOwner, runWithOwner } from "./owner.js";
import * as Atom from "./Atom.js";
import type * as Behavior from "./Behavior.js";
import * as Element from "./Element.js";
import * as Route from "./Route.js";
import * as View from "./View.js";
import {
  defineMutation,
  defineQuery,
  ManagedRuntimeContext,
  mount as mountRuntime,
  mountWithManagedRuntime,
  type BridgeError,
  type MutationSupersededError,
  type Result,
  type RuntimeLike,
} from "./effect-ts.js";
import { currentComponentScope } from "./component-scope.js";

export const ComponentTypeId: unique symbol = Symbol.for("effect-atom-jsx/Component");

const ComponentImplTypeId: unique symbol = Symbol.for("effect-atom-jsx/ComponentImpl");
const ComponentSetupTypeId: unique symbol = Symbol.for("effect-atom-jsx/ComponentSetup");

export interface SlotMap {
  readonly [name: string]: Element.Handle | Element.Collection<Element.Handle>;
}

type SlotsFromBindings<Bindings> = Bindings extends { readonly slots: infer Slots extends SlotMap } ? Slots : {};

// ─── View slot registry ────────────────────────────────────────────────────────
// Allows components to expose slot handles through View<Slots> without requiring
// them to be stored in bindings.slots. Style/Behavior attach can target these
// view-level slots directly.

type ViewSlotRecord = Record<string, Element.Handle | Element.Collection<Element.Handle>>;

const viewSlotRegistry = new WeakMap<Component<any, any, any, any, any>, ViewSlotRecord>();
const slotContractRegistry = new WeakMap<Component<any, any, any, any, any>, AnySlotContract>();

export function registerViewSlots(slots: ViewSlotRecord, component: Component<any, any, any, any, any>): void {
  viewSlotRegistry.set(component, slots);
}

export function getViewSlots(component: Component<any, any, any, any, any>): ViewSlotRecord {
  return viewSlotRegistry.get(component) ?? {};
}

export function getSlotContract(component: Component<any, any, any, any, any>): AnySlotContract | undefined {
  return slotContractRegistry.get(component);
}

type Pipeable<Self> = {
  pipe(): Self;
  pipe<A>(ab: (self: Self) => A): A;
  pipe<A, B>(ab: (self: Self) => A, bc: (a: A) => B): B;
  pipe<A, B, C>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C): C;
  pipe<A, B, C, D>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C, de: (c: C) => D): D;
};

type Simplify<T> = { readonly [K in keyof T]: T[K] };
type NoDuplicateName<Bindings, Name extends string> = Name extends keyof Bindings ? never : Name;
type NoDuplicateFragment<Bindings, Added> = Extract<keyof Bindings, keyof Added> extends never ? unknown : never;
type SetupStep<Props> = (
  input: { readonly props: Props; readonly bindings: Readonly<Record<string, unknown>> },
) => Effect.Effect<Readonly<Record<string, unknown>>, unknown, unknown>;

export interface SetupInput<Props, Bindings> {
  readonly props: Props;
  readonly bindings: Bindings;
}

export interface Setup<Props, Bindings, E = never, R = never> extends Pipeable<Setup<Props, Bindings, E, R>> {
  readonly [ComponentSetupTypeId]: {
    readonly Props: Props;
    readonly Bindings: Bindings;
    readonly E: E;
    readonly R: R;
  };
  readonly effect: (props: Props) => Effect.Effect<Bindings, E, R>;
  bind<const Name extends string, A, E2, R2>(
    name: NoDuplicateName<Bindings, Name>,
    f: (input: SetupInput<Props, Bindings>) => Effect.Effect<A, E2, R2>,
  ): Setup<Props, Simplify<Bindings & { readonly [K in Name]: A }>, E | E2, R | R2>;
  value<const Name extends string, A>(
    name: NoDuplicateName<Bindings, Name>,
    f: (input: SetupInput<Props, Bindings>) => A,
  ): Setup<Props, Simplify<Bindings & { readonly [K in Name]: A }>, E, R>;
  doEffect<E2, R2>(
    f: (input: SetupInput<Props, Bindings>) => Effect.Effect<void, E2, R2>,
  ): Setup<Props, Bindings, E | E2, R | R2>;
  use<Added, E2, R2>(
    fragment: Setup<Props, Added, E2, R2> & NoDuplicateFragment<Bindings, Added>,
  ): Setup<Props, Simplify<Bindings & Added>, E | E2, R | R2>;
}

export type SetupPropsOf<T> = T extends Setup<infer Props, any, any, any> ? Props : never;
export type SetupBindingsOf<T> = T extends Setup<any, infer Bindings, any, any> ? Bindings : never;
export type SetupErrorsOf<T> = T extends Setup<any, any, infer E, any> ? E : never;
export type SetupRequirementsOf<T> = T extends Setup<any, any, any, infer R> ? R : never;
type SetupSource<Props, Bindings, E, R> =
  | ((props: Props) => Effect.Effect<Bindings, E, R>)
  | Setup<Props, Bindings, E, R>;

export type AnySlotContract = View.Slots.Any | Record<string, View.Slot.Any>;
export type SlotsFromSlotContract<SlotContract, Fallback> = SlotContract extends View.Slots.Any
  ? View.Slots.HandlesOf<SlotContract>
  : Fallback;

export interface Component<Props, Req, E, Bindings = unknown, SlotContract = SlotsFromBindings<Bindings>> {
  (props: Props): unknown;
  readonly [ComponentTypeId]: {
    readonly Props: Props;
    readonly Req: Req;
    readonly E: E;
    readonly Bindings: Bindings;
    readonly Slots: SlotsFromSlotContract<SlotContract, SlotContract>;
    readonly SlotContract: SlotContract;
  };
  pipe(): this;
  pipe<A>(ab: (self: this) => A): A;
  pipe<A, B>(ab: (self: this) => A, bc: (a: A) => B): B;
  pipe<A, B, C>(ab: (self: this) => A, bc: (a: A) => B, cd: (b: B) => C): C;
  pipe<A, B, C, D>(ab: (self: this) => A, bc: (a: A) => B, cd: (b: B) => C, de: (c: C) => D): D;
}

export interface HeadlessComponent<Props, Req, E, Bindings>
  extends Component<Props & { readonly children?: (bindings: Bindings) => unknown }, Req, E, Bindings> {}

type ErrorHandlers = Record<string, (error: any) => unknown>;

type PropsSpec<Props> = {
  readonly parse: (value: unknown) => Props;
};

type RequirementSpec<Req> = {
  readonly tags: ReadonlyArray<ServiceMap.Key<any, any>>;
  readonly _Req?: (_: Req) => Req;
};

type InternalComponent<Props, Req, E, Bindings> = {
  readonly [ComponentImplTypeId]: true;
  readonly props: PropsSpec<Props>;
  readonly requirements: RequirementSpec<Req>;
  readonly setup: (props: Props) => Effect.Effect<Bindings, E, Req>;
  readonly view?: (props: Props, bindings: Bindings) => unknown;
  readonly loading?: () => unknown;
  readonly boundary?: ErrorHandlers;
  readonly memo?: (prev: Props, next: Props) => boolean;
};

function isInternalComponent<Props, Req, E, Bindings>(
  value: unknown,
): value is InternalComponent<Props, Req, E, Bindings> {
  return (typeof value === "object" || typeof value === "function")
    && value !== null
    && ComponentImplTypeId in value;
}

function pipeSelf(self: unknown, fns: ReadonlyArray<(value: any) => any>): unknown {
  return fns.reduce((acc, fn) => fn(acc), self);
}

function isSetup<Props, Bindings, E, R>(value: unknown): value is Setup<Props, Bindings, E, R> {
  return typeof value === "object" && value !== null && ComponentSetupTypeId in value;
}

function setupSourceEffect<Props, Bindings, E, R>(
  source: SetupSource<Props, Bindings, E, R>,
): (props: Props) => Effect.Effect<Bindings, E, R> {
  return isSetup<Props, Bindings, E, R>(source) ? source.effect : source;
}

function makeSetup<Props, Bindings, E, R>(
  steps: ReadonlyArray<SetupStep<Props>>,
): Setup<Props, Bindings, E, R> {
  const effect = ((props: Props) =>
    Effect.gen(function* () {
      let bindings: Record<string, unknown> = {};
      for (const step of steps) {
        const added = yield* step({ props, bindings });
        bindings = { ...bindings, ...added };
      }
      return bindings as Bindings;
    })) as (props: Props) => Effect.Effect<Bindings, E, R>;

  const out = {
    [ComponentSetupTypeId]: {
      Props: undefined as unknown as Props,
      Bindings: undefined as unknown as Bindings,
      E: undefined as unknown as E,
      R: undefined as unknown as R,
    },
    effect,
    bind: (name: string, f: (input: SetupInput<Props, Bindings>) => Effect.Effect<unknown, unknown, unknown>) =>
      makeSetup<Props, any, any, any>([
        ...steps,
        (input) =>
          f(input as unknown as SetupInput<Props, Bindings>).pipe(
            Effect.map((value) => ({ [name]: value })),
          ),
      ]),
    value: (name: string, f: (input: SetupInput<Props, Bindings>) => unknown) =>
      makeSetup<Props, any, any, any>([
        ...steps,
        (input) => Effect.succeed({ [name]: f(input as unknown as SetupInput<Props, Bindings>) }),
      ]),
    doEffect: (f: (input: SetupInput<Props, Bindings>) => Effect.Effect<void, unknown, unknown>) =>
      makeSetup<Props, Bindings, any, any>([
        ...steps,
        (input) =>
          f(input as unknown as SetupInput<Props, Bindings>).pipe(
            Effect.as({}),
          ),
      ]),
    use: (fragment: Setup<Props, unknown, unknown, unknown>) =>
      makeSetup<Props, any, any, any>([
        ...steps,
        (input) => fragment.effect(input.props).pipe(Effect.map((added) => added as Readonly<Record<string, unknown>>)),
      ]),
  } as unknown as Setup<Props, Bindings, E, R>;

  out.pipe = ((...fns: ReadonlyArray<(value: any) => any>) => pipeSelf(out, fns)) as typeof out["pipe"];
  return out;
}

function runForkWithAmbient<R, A, E>(effect: Effect.Effect<A, E, R>): Fiber.Fiber<A, E> {
  const ambient = useContext(ManagedRuntimeContext);
  const scope = currentComponentScope();
  const scoped = scope === null
    ? effect
    : Scope.provide(scope)(effect as Effect.Effect<A, E, R | Scope.Scope>) as Effect.Effect<A, E, R>;
  if (ambient !== null) {
    return ambient.runFork(scoped as Effect.Effect<A, E, never>) as Fiber.Fiber<A, E>;
  }
  return Effect.runFork(scoped as Effect.Effect<A, E, never>) as Fiber.Fiber<A, E>;
}

function matchBoundary(boundary: ErrorHandlers | undefined, error: unknown): unknown {
  if (boundary === undefined) return null;
  if (typeof error === "object" && error !== null && "_tag" in error) {
    const tag = String((error as { readonly _tag: string })._tag);
    const handler = boundary[tag];
    if (handler !== undefined) return handler(error);
  }
  if (boundary.Unknown !== undefined) return boundary.Unknown(error);
  return null;
}

function toComponent<Props, Req, E, Bindings, SlotContract = SlotsFromBindings<Bindings>>(
  internal: InternalComponent<Props, Req, E, Bindings>,
): Component<Props, Req, E, Bindings, SlotContract> {
  const component = ((unsafeProps: Props) => {
    const props = internal.props.parse(unsafeProps);
    const [bindings, setBindings] = createSignal<Bindings | null>(null);
    const [error, setError] = createSignal<unknown | null>(null);

    const fiber = runForkWithAmbient(
      internal.setup(props).pipe(
        Effect.matchCause({
          onSuccess: (value): void => {
            setBindings(value);
          },
          onFailure: (cause): void => {
            const typed = Cause.findErrorOption(cause);
            if (typed._tag === "Some") {
              setError(typed.value);
            } else {
              setError({ _tag: "Defect", cause: Cause.pretty(cause) });
            }
          },
        }),
      ),
    );

    onCleanup(() => {
      Effect.runFork(Fiber.interrupt(fiber));
    });

    return () => {
      const failure = error();
      if (failure !== null) {
        const rendered = matchBoundary(internal.boundary, failure);
        return rendered;
      }

      const ready = bindings();
      if (ready === null) {
        return internal.loading?.() ?? null;
      }

      if (internal.view === undefined) {
        const renderProp = (props as RenderPropChildren<Bindings>).children;
        return typeof renderProp === "function" ? View.node(renderProp(ready)) : null;
      }
      const result = internal.view(props, ready);
      if (View.isView(result)) {
        registerViewSlots(result.slots as unknown as ViewSlotRecord, out);
      }
      return View.node(result);
    };
  }) as Component<Props, Req, E, Bindings, SlotContract>;

  const out = Object.assign(component, {
    [ComponentTypeId]: {
      Props: undefined as unknown as Props,
      Req: undefined as unknown as Req,
      E: undefined as unknown as E,
      Bindings: undefined as unknown as Bindings,
      Slots: undefined as unknown as SlotsFromSlotContract<SlotContract, SlotContract>,
      SlotContract: undefined as unknown as SlotContract,
    },
    [ComponentImplTypeId]: true as const,
    props: internal.props,
    requirements: internal.requirements,
    setup: internal.setup,
    view: internal.view,
    loading: internal.loading,
    boundary: internal.boundary,
    memo: internal.memo,
  });

  out.pipe = ((...fns: ReadonlyArray<(value: any) => any>) => pipeSelf(out, fns)) as typeof out["pipe"];
  return out;
}

function internals<Props, Req, E, Bindings, SlotContract>(
  component: Component<Props, Req, E, Bindings, SlotContract>,
): InternalComponent<Props, Req, E, Bindings> {
  if (!isInternalComponent<Props, Req, E, Bindings>(component)) {
    throw new Error("[effect-atom-jsx/Component] expected a Component value.");
  }
  return component;
}

function provideLayerToSetup<Props, Req, E, Bindings, SlotContract, ROut, E2, RIn>(
  component: Component<Props, Req, E, Bindings, SlotContract>,
  layer: Layer.Layer<ROut, E2, RIn>,
): Component<Props, Exclude<Req, ROut> | RIn, E | E2, Bindings, SlotContract> {
  const i = internals(component);
  return toComponentLike(component, {
    ...i,
    setup: (props) => i.setup(props).pipe(Effect.provide(layer as any)) as any,
  }) as Component<Props, Exclude<Req, ROut> | RIn, E | E2, Bindings, SlotContract>;
}

type HeadlessChildren<Bindings> = { readonly children?: (bindings: Bindings) => unknown };

export function props<Props>(): PropsSpec<Props> {
  return {
    parse: (value) => value as Props,
  };
}

export function propsSchema<SchemaProps>(schema: Schema.Schema<SchemaProps>): PropsSpec<SchemaProps> {
  const decode = Schema.decodeUnknownSync(schema as any);
  return {
    parse: (value) => decode(value) as SchemaProps,
  };
}

export function require<Req = never>(...tags: ReadonlyArray<ServiceMap.Key<any, any>>): RequirementSpec<Req> {
  return { tags };
}

export function setup<Props = {}>(): Setup<Props, {}, never, never> {
  return makeSetup<Props, {}, never, never>([]);
}

export function bind<const Name extends string, Props = any, Bindings = any, A = unknown, E = never, R = never>(
  name: Name,
  f: (input: SetupInput<Props, Bindings>) => Effect.Effect<A, E, R>,
): <E0, R0>(
  source: Setup<Props, Bindings, E0, R0> & (Name extends keyof Bindings ? never : unknown),
) => Setup<Props, Simplify<Bindings & { readonly [K in Name]: A }>, E0 | E, R0 | R> {
  return (source) => source.bind(name as any, f as any) as any;
}

export function value<const Name extends string, Props = any, Bindings = any, A = unknown>(
  name: Name,
  f: (input: SetupInput<Props, Bindings>) => A,
): <E0, R0>(
  source: Setup<Props, Bindings, E0, R0> & (Name extends keyof Bindings ? never : unknown),
) => Setup<Props, Simplify<Bindings & { readonly [K in Name]: A }>, E0, R0> {
  return (source) => source.value(name as any, f as any) as any;
}

export function doEffect<Props = any, Bindings = any, E = never, R = never>(
  f: (input: SetupInput<Props, Bindings>) => Effect.Effect<void, E, R>,
): <E0, R0>(source: Setup<Props, Bindings, E0, R0>) => Setup<Props, Bindings, E0 | E, R0 | R> {
  return (source) => source.doEffect(f as any) as any;
}

export function use<Props = any, Added = any, E = never, R = never>(
  fragment: Setup<Props, Added, E, R>,
): <Bindings, E0, R0>(
  source: Setup<Props, Bindings, E0, R0> & NoDuplicateFragment<Bindings, Added>,
) => Setup<Props, Simplify<Bindings & Added>, E0 | E, R0 | R> {
  return (source) => source.use(fragment as any) as any;
}

export function make<Props, Req, E, Bindings>(
  propSpec: PropsSpec<Props>,
  req: RequirementSpec<Req>,
  setup: SetupSource<Props, Bindings, E, Req>,
  view: (props: Props, bindings: Bindings) => unknown,
): Component<Props, Req, E, Bindings>;
export function make<Props, Req, E, Bindings, Slots>(
  propSpec: PropsSpec<Props>,
  req: RequirementSpec<Req>,
  setup: SetupSource<Props, Bindings, E, Req>,
  view: (props: Props, bindings: Bindings) => View.View<Slots>,
): Component<Props, Req, E, Bindings, Slots>;
export function make<Props, Req, SetupReq, E, Bindings>(
  propSpec: PropsSpec<Props>,
  req: RequirementSpec<Req>,
  setup: SetupSource<Props, Bindings, E, SetupReq>,
  view: (props: Props, bindings: Bindings) => unknown,
): Component<Props, Req | SetupReq, E, Bindings>;
export function make<Props, Req, SetupReq, E, Bindings, Slots>(
  propSpec: PropsSpec<Props>,
  req: RequirementSpec<Req>,
  setup: SetupSource<Props, Bindings, E, SetupReq>,
  view: (props: Props, bindings: Bindings) => View.View<Slots>,
): Component<Props, Req | SetupReq, E, Bindings, Slots>;
export function make<Props, Req, SetupReq, E, Bindings>(
  propSpec: PropsSpec<Props>,
  req: RequirementSpec<Req>,
  setup: SetupSource<Props, Bindings, E, SetupReq>,
  view: (props: Props, bindings: Bindings) => unknown,
): Component<Props, Req | SetupReq, E, Bindings> {
  return toComponent({
    [ComponentImplTypeId]: true,
    props: propSpec,
    requirements: req as unknown as RequirementSpec<Req | SetupReq>,
    setup: setupSourceEffect(setup),
    view,
  });
}

export function headless<Props, Req, E, Bindings>(
  propSpec: PropsSpec<Props>,
  req: RequirementSpec<Req>,
  setup: SetupSource<Props, Bindings, E, Req>,
): HeadlessComponent<Props, Req, E, Bindings>;
export function headless<Props, Req, SetupReq, E, Bindings>(
  propSpec: PropsSpec<Props>,
  req: RequirementSpec<Req>,
  setup: SetupSource<Props, Bindings, E, SetupReq>,
): HeadlessComponent<Props, Req | SetupReq, E, Bindings> {
  const setupEffect = setupSourceEffect(setup);
  return toComponent({
    [ComponentImplTypeId]: true,
    props: propSpec as unknown as PropsSpec<Props & HeadlessChildren<Bindings>>,
    requirements: req as unknown as RequirementSpec<Req | SetupReq>,
    setup: setupEffect as unknown as (props: Props & HeadlessChildren<Bindings>) => Effect.Effect<Bindings, E, Req | SetupReq>,
  }) as HeadlessComponent<Props, Req | SetupReq, E, Bindings>;
}

export function from<Props>(
  fn: (props: Props) => unknown,
): Component<Props, never, never, {}> {
  return make(
    props<Props>(),
    require<never>(),
    () => Effect.succeed({}),
    (componentProps) => fn(componentProps),
  );
}

export type Requirements<T> = T extends Component<any, infer Req, any, any, any> ? Req : never;
export type Errors<T> = T extends Component<any, any, infer E, any, any> ? E : never;
export type PropsOf<T> = T extends Component<infer Props, any, any, any, any> ? Props : never;
export type BindingsOf<T> = T extends Component<any, any, any, infer Bindings, any> ? Bindings : never;
export type SlotContractOf<T> = T extends { readonly [ComponentTypeId]: { readonly SlotContract: infer SlotContract } } ? SlotContract : never;
export type SlotsOf<T> = SlotContractOf<T> extends never ? never : SlotsFromSlotContract<SlotContractOf<T>, SlotContractOf<T>>;
export type PublicSlotsOf<T> = SlotContractOf<T> extends View.Slots.Any
  ? Pick<SlotsOf<T>, View.Slots.PublicNamesOf<SlotContractOf<T>> & keyof SlotsOf<T>>
  : SlotsOf<T>;
export type HiddenSlotsOf<T> = SlotContractOf<T> extends View.Slots.Any
  ? Pick<SlotsOf<T>, View.Slots.HiddenNamesOf<SlotContractOf<T>> & keyof SlotsOf<T>>
  : {};

export type ComponentDiagnosticCode =
  | "component:missing-declared-slot"
  | "component:undeclared-view-slot"
  | "component:slot-capability-mismatch"
  | "component:missing-bindings-slot"
  | "component:undeclared-bindings-slot";

export interface ComponentDiagnostic {
  readonly code: ComponentDiagnosticCode;
  readonly message: string;
  readonly component?: string;
  readonly slot?: string;
  readonly declaredCapability?: string;
  readonly renderedCapability?: string;
}

type RenderPropChildren<Bindings> = { readonly children?: (bindings: Bindings) => unknown };

function isSlotContract(value: AnySlotContract): value is View.Slots.Any {
  return typeof value === "object" && value !== null && View.SlotsTypeId in value;
}

function slotContractMetadata(contract: AnySlotContract): Record<string, View.SlotMetadata> {
  if (isSlotContract(contract)) {
    return View.Slots.metadata(contract) as Record<string, View.SlotMetadata>;
  }
  const out: Record<string, View.SlotMetadata> = {};
  for (const [name, witness] of Object.entries(contract)) {
    out[name] = witness.metadata;
  }
  return out;
}

function slotsRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function bindingsSlotsRecord(bindings: unknown): Record<string, unknown> | undefined {
  if (typeof bindings !== "object" || bindings === null || !("slots" in bindings)) return undefined;
  return slotsRecord((bindings as { readonly slots?: unknown }).slots);
}

function capabilityName(value: View.SlotCapability | undefined): string | undefined {
  return value === undefined ? undefined : View.nameOfCapability(value);
}

export function validateSlotContract<Props, Req, E, Bindings, Slots>(
  component: Component<Props, Req, E, Bindings, any>,
  view: View.View<Slots>,
  bindings?: Bindings,
): readonly ComponentDiagnostic[] {
  const contract = getSlotContract(component);
  if (contract === undefined) return [];

  const diagnostics: ComponentDiagnostic[] = [];
  const componentName = view.name;
  const declaredMetadata = slotContractMetadata(contract);
  const renderedSlots = slotsRecord(view.slots);
  const renderedMetadata = view.slotMetadata as Record<string, View.SlotMetadata | undefined> | undefined;
  const bindingSlots = bindingsSlotsRecord(bindings);

  for (const [slot, declared] of Object.entries(declaredMetadata)) {
    if (!(slot in renderedSlots)) {
      diagnostics.push({
        code: "component:missing-declared-slot",
        message: `Component ${componentName ?? "<anonymous>"} declares slot ${slot} but its View does not expose it.`,
        component: componentName,
        slot,
        declaredCapability: capabilityName(declared.capability),
      });
      continue;
    }

    const renderedCapability = renderedMetadata?.[slot]?.capability ?? View.capabilityOf(renderedSlots[slot]);
    if (
      declared.capability !== undefined
      && renderedCapability !== undefined
      && !View.extendsCapability(renderedCapability, declared.capability)
    ) {
      diagnostics.push({
        code: "component:slot-capability-mismatch",
        message: `Component ${componentName ?? "<anonymous>"} renders slot ${slot} as ${View.nameOfCapability(renderedCapability)}, which does not satisfy declared capability ${View.nameOfCapability(declared.capability)}.`,
        component: componentName,
        slot,
        declaredCapability: capabilityName(declared.capability),
        renderedCapability: capabilityName(renderedCapability),
      });
    }

    if (bindingSlots !== undefined && !(slot in bindingSlots)) {
      diagnostics.push({
        code: "component:missing-bindings-slot",
        message: `Component ${componentName ?? "<anonymous>"} declares slot ${slot} but bindings.slots does not expose it.`,
        component: componentName,
        slot,
        declaredCapability: capabilityName(declared.capability),
      });
    }
  }

  for (const slot of Object.keys(renderedSlots)) {
    if (!(slot in declaredMetadata)) {
      diagnostics.push({
        code: "component:undeclared-view-slot",
        message: `Component ${componentName ?? "<anonymous>"} View exposes undeclared slot ${slot}.`,
        component: componentName,
        slot,
        renderedCapability: capabilityName(renderedMetadata?.[slot]?.capability ?? View.capabilityOf(renderedSlots[slot])),
      });
    }
  }

  if (bindingSlots !== undefined) {
    for (const slot of Object.keys(bindingSlots)) {
      if (!(slot in declaredMetadata)) {
        diagnostics.push({
          code: "component:undeclared-bindings-slot",
          message: `Component ${componentName ?? "<anonymous>"} bindings.slots exposes undeclared slot ${slot}.`,
          component: componentName,
          slot,
          renderedCapability: capabilityName(View.capabilityOf(bindingSlots[slot])),
        });
      }
    }
  }

  return diagnostics;
}

export function validateRenderedSlotContract<Props, Req, E, Bindings, Slots>(
  component: Component<Props, Req, E, Bindings, any>,
  propsValue: Props,
): Effect.Effect<readonly ComponentDiagnostic[], E, Req> {
  const i = internals(component);
  const parsed = i.props.parse(propsValue);
  return i.setup(parsed).pipe(
    Effect.map((bindings) => {
      const result = i.view === undefined
        ? typeof (parsed as RenderPropChildren<Bindings>).children === "function"
          ? (parsed as RenderPropChildren<Bindings>).children?.(bindings)
          : undefined
        : i.view(parsed, bindings);
      if (!View.isView(result)) return [];
      registerViewSlots(result.slots as unknown as ViewSlotRecord, component);
      return validateSlotContract(component, result as View.View<Slots>, bindings);
    }),
  );
}

function renderViewResult(
  component: Component<any, any, any, any, any>,
  result: unknown,
  platform: View.PlatformService | undefined,
): unknown {
  if (View.isView(result)) {
    registerViewSlots(result.slots as unknown as ViewSlotRecord, component);
    if (platform) {
      View.reportPlatformDiagnostics(result, platform);
    }
  }
  return View.node(result);
}

export function setupEffect<Props, Req, E, Bindings, SlotContract>(
  component: Component<Props, Req, E, Bindings, SlotContract>,
  propsValue: Props,
): Effect.Effect<Bindings, E, Req> {
  const i = internals(component);
  const parsed = i.props.parse(propsValue);
  return i.setup(parsed);
}

export function renderEffect<Props, Req, E, Bindings, SlotContract>(
  component: Component<Props, Req, E, Bindings, SlotContract>,
  propsValue: Props,
): Effect.Effect<unknown, E, Req> {
  const i = internals(component);
  const parsed = i.props.parse(propsValue);
  return i.setup(parsed).pipe(
    Effect.flatMap((bindings) => Effect.serviceOption(View.PlatformTag).pipe(Effect.map((maybePlatform) => {
      const platform = maybePlatform._tag === "Some" ? maybePlatform.value : undefined;
      if (i.view === undefined) {
        const renderProp = (parsed as RenderPropChildren<Bindings>).children;
        return typeof renderProp === "function"
          ? renderViewResult(component, renderProp(bindings), platform)
          : null;
      }
      const result = i.view(parsed, bindings);
      return renderViewResult(component, result, platform);
    }))),
  );
}

export function renderViewEffect<Props, Req, E, Bindings, Slots>(
  component: Component<Props, Req, E, Bindings, Slots>,
  propsValue: Props,
): Effect.Effect<View.View<Slots> | undefined, E, Req> {
  const i = internals(component);
  const parsed = i.props.parse(propsValue);
  return i.setup(parsed).pipe(
    Effect.map((bindings) => {
      const result = i.view === undefined
        ? typeof (parsed as RenderPropChildren<Bindings>).children === "function"
          ? (parsed as RenderPropChildren<Bindings>).children?.(bindings)
          : undefined
        : i.view(parsed, bindings);
      if (!View.isView(result)) return undefined;
      registerViewSlots(result.slots as unknown as ViewSlotRecord, component);
      return result as View.View<Slots>;
    }),
  );
}

export interface ComponentAction<Args extends ReadonlyArray<unknown>, A, E> {
  (...args: Args): void;
  run(...args: Args): void;
  runEffect(...args: Args): Effect.Effect<A, E>;
  effect(...args: Args): Effect.Effect<void, E | BridgeError | MutationSupersededError>;
  result: Accessor<Result<void, E>>;
  pending: Accessor<boolean>;
}

export type ActionArgsOf<T> = T extends ComponentAction<infer Args, any, any> ? Args : never;
export type ActionInputOf<T> = T extends ComponentAction<infer Args, any, any>
  ? Args extends readonly [infer Input] ? Input : Args
  : never;
export type ActionErrorOf<T> = T extends ComponentAction<any, any, infer E> ? E : never;
export type ActionSuccessOf<T> = T extends ComponentAction<any, infer A, any> ? A : never;
export type ActionRunErrorOf<T> = T extends ComponentAction<any, any, infer E> ? E : never;
export type ActionEffectErrorOf<T> = T extends ComponentAction<any, any, infer E>
  ? E | BridgeError | MutationSupersededError
  : never;
export type ActionRunEffectOf<T> = T extends ComponentAction<infer Args, infer A, infer E>
  ? (...args: Args) => Effect.Effect<A, E>
  : never;
export type ActionEffectOf<T> = T extends ComponentAction<infer Args, any, infer E>
  ? (...args: Args) => Effect.Effect<void, E | BridgeError | MutationSupersededError>
  : never;

export interface ActionOptions {
  readonly name?: string;
  readonly reactivityKeys?: Atom.ReactivityKeysInput;
  readonly onTransition?: (event: { readonly phase: "start" | "success" | "failure" | "defect" }) => void;
  readonly concurrency?: "switch" | "queue" | "drop" | { readonly max: number };
  readonly detached?: boolean;
}

type SetupLifetime = {
  readonly hasScope: boolean;
  readonly isDisposed: () => boolean;
  readonly assertLive: () => void;
};

function setupLifetime(label: string): Effect.Effect<SetupLifetime> {
  return Effect.gen(function* () {
    const scope = yield* Effect.serviceOption(Scope.Scope);
    let disposed = false;
    if (scope._tag === "Some") {
      yield* Scope.addFinalizer(scope.value, Effect.sync(() => {
        disposed = true;
      }));
    }
    return {
      hasScope: scope._tag === "Some",
      isDisposed: () => disposed,
      assertLive: () => {
        if (disposed) {
          throw new Error(`[effect-atom-jsx/${label}] cannot write component-local state after its setup scope has closed.`);
        }
      },
    };
  });
}

function setupReactiveOwner<A>(make: () => A): Effect.Effect<A> {
  return Effect.gen(function* () {
    const scope = yield* Effect.serviceOption(Scope.Scope);
    let owner: Owner | null = null;
    if (scope._tag === "Some") {
      yield* Scope.addFinalizer(scope.value, Effect.sync(() => {
        owner?.dispose();
        owner = null;
      }));
    }
    return yield* Effect.sync(() => {
      owner = new Owner(getOwner());
      return runWithOwner(owner, make);
    });
  });
}

export function signal<A>(initial: A): Effect.Effect<readonly [Accessor<A>, Setter<A>]> {
  return Effect.gen(function* () {
    const lifetime = yield* setupLifetime("Component.signal");
    return yield* Effect.sync(() => {
      const [get, set] = createSignal(initial);
      const guardedSet: Setter<A> = (value) => {
        lifetime.assertLive();
        set(value);
      };
      return [get, guardedSet] as const;
    });
  });
}

export function effect<T>(
  fn: (prev: T | undefined) => T | void | (() => void),
  initialValue?: T,
): Effect.Effect<void> {
  return setupReactiveOwner(() => {
    createEffect<T | void>((prev) => {
      const result = fn(prev as T | undefined);
      if (typeof result === "function") {
        onCleanup(result as () => void);
        return undefined;
      }
      return result;
    }, initialValue);
  });
}

export function state<A>(initial: A): Effect.Effect<Atom.WritableAtom<A>> {
  return Effect.gen(function* () {
    const lifetime = yield* setupLifetime("Component.state");
    const [getValue, setValue] = createSignal(initial);
    return Atom.writable(
      () => getValue(),
      (_ctx, value: A) => {
        lifetime.assertLive();
        setValue(() => value);
      },
    );
  });
}

export function derived<A>(fn: () => A): Effect.Effect<Atom.ReadonlyAtom<A>> {
  return Effect.sync(() => Atom.derived(() => fn()));
}

export function query<A, E, R>(
  effect: () => Effect.Effect<A, E, R>,
  options?: {
    readonly name?: string;
    readonly retrySchedule?: Schedule.Schedule<unknown, any, any>;
    readonly pollSchedule?: Schedule.Schedule<unknown, any, any>;
  },
): Effect.Effect<Atom.ReadonlyAtom<Result<A, E>, E>, never, R> {
  return Effect.gen(function* () {
    const runtimeContext = yield* Effect.services<R>();
    return yield* setupReactiveOwner(() =>
      defineQuery(effect, {
        ...options,
        runtime: runtimeContext as RuntimeLike<R, unknown>,
      }).result as Atom.ReadonlyAtom<Result<A, E>, E>
    );
  });
}

export function action<Args extends ReadonlyArray<unknown>, A, E, R>(
  fn: (...args: Args) => Effect.Effect<A, E, R>,
  options?: ActionOptions,
): Effect.Effect<ComponentAction<Args, A, E>, never, R> {
  return Effect.gen(function* () {
    const lifetime = yield* setupLifetime("Component.action");
    const runtimeContext = yield* Effect.services<R>();
    return yield* setupReactiveOwner(() => {
    const handle = defineMutation<Args, E, R>(
      (args) => fn(...args),
      {
        runtime: runtimeContext as RuntimeLike<R, unknown>,
        name: options?.name,
        onTransition: options?.onTransition,
        onSuccess: () => {
          if (options?.reactivityKeys !== undefined) {
            Atom.invalidateReactivity(options.reactivityKeys);
          }
        },
      },
    );

    const out = ((...args: Args) => {
      lifetime.assertLive();
      if (options?.concurrency === "drop" && handle.pending()) return;
      handle.run(args);
    }) as ComponentAction<Args, A, E>;
    out.run = (...args: Args) => {
      lifetime.assertLive();
      if (options?.concurrency === "drop" && handle.pending()) return;
      handle.run(args);
    };
    out.runEffect = (...args: Args) =>
      Effect.sync(() => lifetime.assertLive()).pipe(
        Effect.flatMap(() => Effect.tryPromise({
          try: async () => {
          if (options?.concurrency === "drop" && handle.pending()) {
            return undefined as unknown as A;
          }
          return await Effect.runPromiseWith(runtimeContext as any)(fn(...args));
        },
          catch: (error) => error as E,
        })),
      );
    out.effect = (...args: Args) =>
      Effect.sync(() => lifetime.assertLive()).pipe(
        Effect.flatMap(() => handle.effect(args) as Effect.Effect<void, E | BridgeError | MutationSupersededError>),
      );
    out.result = handle.result;
    out.pending = handle.pending;
    return out;
    });
  });
}

export interface OptimisticBuilder<A> {
  action<Success = A, E = never, R = never, Input = void>(
    spec: Atom.OptimisticActionSpec<A, Input, Success, E, R>,
  ): Effect.Effect<Atom.OptimisticActionHandle<Input, A, Success, E>, never, R>;
}

export function optimistic<A>(source: Atom.WritableAtom<A>): OptimisticBuilder<A> {
  return {
    action: <Success = A, E = never, R = never, Input = void>(
    spec: Atom.OptimisticActionSpec<A, Input, Success, E, R>,
    ) => Effect.gen(function* () {
      const lifetime = yield* setupLifetime("Component.optimistic");
      const runtimeContext = yield* Effect.services<R>();
      return yield* setupReactiveOwner(() => {
        const handle = Atom.optimistic(source, runtimeContext as RuntimeLike<R, unknown>).action(spec);
        const out = ((input: Input) => {
          lifetime.assertLive();
          handle(input);
        }) as Atom.OptimisticActionHandle<Input, A, Success, E>;
        Object.assign(out, handle);
        out.run = (input: Input) => {
          lifetime.assertLive();
          handle.run(input);
        };
        out.runEffect = (input: Input) =>
          Effect.sync(() => lifetime.assertLive()).pipe(
            Effect.flatMap(() => handle.runEffect(input)),
          );
        out.effect = (input: Input) =>
          Effect.sync(() => lifetime.assertLive()).pipe(
            Effect.flatMap(() => handle.effect(input)),
          );
        out.rollback = () => {
          lifetime.assertLive();
          handle.rollback();
        };
        out.clear = () => {
          lifetime.assertLive();
          handle.clear();
        };
        return out;
      });
    }) as Effect.Effect<Atom.OptimisticActionHandle<Input, A, Success, E>, never, R>,
  };
}

export type ComponentRef<T> = { current: T | null };

export function ref<T>(): Effect.Effect<ComponentRef<T>> {
  return Effect.gen(function* () {
    const ref: ComponentRef<T> = { current: null };
    const scope = yield* Effect.serviceOption(Scope.Scope);
    if (scope._tag === "Some") {
      yield* Scope.addFinalizer(scope.value, Effect.sync(() => {
        ref.current = null;
      }));
    }
    return ref;
  });
}

export function fromDequeue<A>(
  dequeue: Queue.Dequeue<A>,
  handler: (value: A) => void,
): Effect.Effect<void, never, Scope.Scope> {
  return FxStream.fromQueue(dequeue).pipe(
    FxStream.runForEach((value) => Effect.sync(() => handler(value as A))),
    Effect.forkScoped,
    Effect.asVoid,
  );
}

export function schedule(
  scheduleDef: Schedule.Schedule<unknown, any, any>,
  run: () => void,
): Effect.Effect<void, never, Scope.Scope> {
  return scheduleEffect(scheduleDef, Effect.sync(run));
}

export function scheduleEffect<A, E, R>(
  scheduleDef: Schedule.Schedule<unknown, any, any>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<void, never, Scope.Scope | R> {
  return FxStream.fromSchedule(scheduleDef).pipe(
    FxStream.runForEach(() => effect.pipe(Effect.catchCause(() => Effect.void))),
    Effect.forkScoped,
    Effect.asVoid,
  ) as Effect.Effect<void, never, Scope.Scope | R>;
}

export function withLayer<ROut, E2, RIn>(
  layer: Layer.Layer<ROut, E2, RIn>,
): <C extends Component<any, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Exclude<Requirements<C>, ROut> | RIn, Errors<C> | E2, BindingsOf<C>, SlotContractOf<C>>> {
  return <C extends Component<any, any, any, any, any>>(component: C) =>
    provideLayerToSetup(component, layer) as PreserveRouteMetadata<C, Component<PropsOf<C>, Exclude<Requirements<C>, ROut> | RIn, Errors<C> | E2, BindingsOf<C>, SlotContractOf<C>>>;
}

export function withSlotContract<const SlotContract extends AnySlotContract>(
  slotContract: SlotContract,
): <C extends Component<any, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C>, BindingsOf<C>, SlotContract>> {
  return <C extends Component<any, any, any, any, any>>(component: C) => {
    slotContractRegistry.set(component, slotContract);
    return component as unknown as PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C>, BindingsOf<C>, SlotContract>>;
  };
}

export function withSlots<const SlotContract extends View.Slots.Any>(
  slots: SlotContract,
): <C extends Component<any, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<
  PropsOf<C>,
  Requirements<C>,
  Errors<C>,
  BindingsOf<C> & { readonly slots: View.Slots.HandlesOf<SlotContract> },
  SlotContract
>>;
export function withSlots<const SlotContract extends AnySlotContract>(
  slots: SlotContract,
): <C extends Component<any, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C>, BindingsOf<C>, SlotContract>>;
export function withSlots<const SlotContract extends AnySlotContract>(
  slots: SlotContract,
): <C extends Component<any, any, any, any, any>>(component: C) => PreserveRouteMetadata<C, Component<any, any, any, any, SlotContract>> {
  return <C extends Component<any, any, any, any, any>>(component: C) => {
    if (!isSlotContract(slots)) {
      return withSlotContract(slots)(component) as any;
    }

    const i = internals(component);
    const handles = View.Slots.handles(slots);
    const wrapped = toComponentLike(component, {
      ...i,
      setup: (props) => i.setup(props).pipe(Effect.map((bindings) => {
        if (typeof bindings === "object" && bindings !== null) {
          const existingSlots = (bindings as { readonly slots?: unknown }).slots;
          return {
            ...(bindings as Record<string, unknown>),
            slots: existingSlots === undefined ? handles : existingSlots,
          };
        }
        return { value: bindings, slots: handles };
      })) as any,
    });
    slotContractRegistry.set(wrapped, slots);
    return wrapped as any;
  };
}

export function withErrorBoundary<Handled extends string>(
  handlers: Record<Handled, (error: any) => unknown>,
): <C extends Component<any, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Exclude<Errors<C>, { readonly _tag: Handled }>, BindingsOf<C>, SlotContractOf<C>>> {
  return <C extends Component<any, any, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      boundary: {
        ...(i.boundary ?? {}),
        ...handlers,
      },
    }) as PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Exclude<Errors<C>, { readonly _tag: Handled }>, BindingsOf<C>, SlotContractOf<C>>>;
  };
}

export function withLoading(
  fallback: () => unknown,
): <C extends Component<any, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C>, BindingsOf<C>, SlotContractOf<C>>> {
  return <C extends Component<any, any, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, { ...i, loading: fallback });
  };
}

export function withSpan(
  name: string,
  _attributes?: Record<string, unknown>,
): <C extends Component<any, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C>, BindingsOf<C>, SlotContractOf<C>>> {
  return <C extends Component<any, any, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      setup: (props) => i.setup(props).pipe(Effect.withSpan(name)),
    });
  };
}

export function memo<Props>(
  equals: (prev: Props, next: Props) => boolean,
): <C extends Component<Props, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<Props, Requirements<C>, Errors<C>, BindingsOf<C>, SlotContractOf<C>>> {
  return <C extends Component<Props, any, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, { ...i, memo: equals });
  };
}

export function tapSetup<Props, Req, E, Bindings, E2, R2>(
  tap: (bindings: Bindings) => Effect.Effect<unknown, E2, R2>,
): <C extends Component<Props, Req, E, Bindings, any>>(component: C) => PreserveRouteMetadata<C, Component<Props, Req | R2, E | E2, Bindings, SlotContractOf<C>>> {
  return <C extends Component<Props, Req, E, Bindings, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      setup: (props) => i.setup(props).pipe(Effect.tap(tap as any)) as any,
    }) as PreserveRouteMetadata<C, Component<Props, Req | R2, E | E2, Bindings, SlotContractOf<C>>>;
  };
}

export function withViewTransform<Props, Req, E, Bindings, SlotContract = {}>(
  transform: (result: unknown, props: Props, bindings: Bindings) => unknown,
): <C extends Component<Props, Req, E, Bindings, SlotContract>>(component: C) => PreserveRouteMetadata<C, Component<Props, Req, E, Bindings, SlotContractOf<C>>> {
  return <C extends Component<Props, Req, E, Bindings, SlotContract>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      view: i.view === undefined
        ? undefined
        : (props: Props, bindings: Bindings) => transform(i.view!(props, bindings), props, bindings),
    }) as PreserveRouteMetadata<C, Component<Props, Req, E, Bindings, SlotContractOf<C>>>;
  };
}

export function withPreSetup<E2, R2>(
  pre: Effect.Effect<unknown, E2, R2>,
): <C extends Component<any, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C> | R2, Errors<C> | E2, BindingsOf<C>, SlotContractOf<C>>> {
  return <C extends Component<any, any, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      setup: (props) => pre.pipe(Effect.flatMap(() => i.setup(props))) as any,
    }) as PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C> | R2, Errors<C> | E2, BindingsOf<C>, SlotContractOf<C>>>;
  };
}

export function withSetupRetry(
  retry: Schedule.Schedule<unknown, any, any>,
): <C extends Component<any, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C>, BindingsOf<C>, SlotContractOf<C>>> {
  return <C extends Component<any, any, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      setup: (props) => i.setup(props).pipe(Effect.retry(retry)),
    });
  };
}

export function withSetupTimeout(
  duration: number | string,
): <C extends Component<any, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C> | { readonly _tag: "ComponentSetupTimeout" }, BindingsOf<C>, SlotContractOf<C>>> {
  return <C extends Component<any, any, any, any, any>>(component: C) => {
    const i = internals(component);
    const timeout = typeof duration === "number" ? `${duration} millis` : duration;
    return toComponentLike(component, {
      ...i,
      setup: (props) => Effect.raceFirst(
        i.setup(props) as any,
        Effect.sleep(timeout as any).pipe(
          Effect.flatMap(() => Effect.fail({ _tag: "ComponentSetupTimeout" as const })),
        ),
      ),
    }) as PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C> | { readonly _tag: "ComponentSetupTimeout" }, BindingsOf<C>, SlotContractOf<C>>>;
  };
}

type RoutedComponentInternals<P, Q, H, A, E> = Route.RoutedComponent<P, Q, H> & {
  readonly [Route.RouteLoaderMetaSymbol]?: {
    readonly data: A;
    readonly error: E;
  };
  __routeLoader?: (params: unknown, deps?: { readonly parent: <X>() => X }) => Effect.Effect<unknown, unknown, unknown>;
  __routeLoaderOptions?: Route.LoaderOptions;
  __routeLoaderError?: Record<string, (error: unknown, params: unknown) => unknown>;
  __routeTitle?: string | ((params: P, loaderData: unknown | undefined, loaderResult: Result<unknown, unknown> | undefined) => string);
  __routeMetaExtra?: Route.RouteMetaRecord | ((params: P, loaderData: unknown | undefined, loaderResult: Result<unknown, unknown> | undefined) => Route.RouteMetaRecord);
  __routeGuards?: ReadonlyArray<Effect.Effect<unknown, any, any>>;
};

type WithRouteMeta<P, Q, H> = {
  [Route.RouteMetaSymbol]: Route.RouteMeta<P, Q, H>;
};

type PreserveRouteMetadata<Source, Target> = Target
  & (Source extends Route.RoutedComponent<infer P, infer Q, infer H> ? Route.RoutedComponent<P, Q, H> : {})
  & (Source extends Route.LoaderTaggedComponent<infer A, infer E> ? Route.LoaderTaggedComponent<A, E> : {});

type RouteBindings<P, Q, H> = {
  readonly __routeMatched: Atom.ReadonlyAtom<boolean>;
  readonly __routeInner: unknown;
  readonly __routeCtx: Route.RouteContext<P, Q, H>;
  readonly __routeHeadId: string;
  readonly __routePattern: string;
};

function asRoutedComponent<P, Q, H, A = unknown, E = unknown>(
  component: Component<any, any, any, any, any>,
): RoutedComponentInternals<P, Q, H, A, E> {
  return component as unknown as RoutedComponentInternals<P, Q, H, A, E>;
}

function setRoutedMeta<P, Q, H>(component: Component<any, any, any, any, any>, meta: Route.RouteMeta<P, Q, H>): void {
  (asRoutedComponent<P, Q, H>(component) as RoutedComponentInternals<P, Q, H, unknown, unknown> & WithRouteMeta<P, Q, H>)[Route.RouteMetaSymbol] = meta;
}

function copyRouteDecorations(
  source: Component<any, any, any, any, any>,
  target: Component<any, any, any, any, any>,
): void {
  const slotContract = slotContractRegistry.get(source);
  if (slotContract !== undefined) {
    slotContractRegistry.set(target, slotContract);
  }

  const sourceRoute = asRoutedComponent(source);
  const targetRoute = asRoutedComponent(target);

  const meta = sourceRoute[Route.RouteMetaSymbol];
  if (meta) {
    setRoutedMeta(target, meta);
    Route.registerRoute(target, meta);
  }

  const loaderMeta = sourceRoute[Route.RouteLoaderMetaSymbol];
  if (loaderMeta) {
    (targetRoute as RoutedComponentInternals<any, any, any, unknown, unknown> & { [Route.RouteLoaderMetaSymbol]: typeof loaderMeta })[Route.RouteLoaderMetaSymbol] = loaderMeta;
  }

  targetRoute.__routeLoader = sourceRoute.__routeLoader;
  targetRoute.__routeLoaderOptions = sourceRoute.__routeLoaderOptions;
  targetRoute.__routeLoaderError = sourceRoute.__routeLoaderError;
  targetRoute.__routeTitle = sourceRoute.__routeTitle;
  targetRoute.__routeMetaExtra = sourceRoute.__routeMetaExtra;
  targetRoute.__routeGuards = sourceRoute.__routeGuards;
}

function toComponentLike<Source extends Component<any, any, any, any, any>, Props, Req, E, Bindings, SlotContract = SlotContractOf<Source>>(
  source: Source,
  internal: InternalComponent<Props, Req, E, Bindings>,
): PreserveRouteMetadata<Source, Component<Props, Req, E, Bindings, SlotContract>> {
  const wrapped = toComponent<Props, Req, E, Bindings, SlotContract>(internal);
  copyRouteDecorations(source, wrapped);
  return wrapped as PreserveRouteMetadata<Source, Component<Props, Req, E, Bindings, SlotContract>>;
}

function decodeRouteOption<A>(schema: Schema.Schema<A>) {
  return Schema.decodeUnknownOption(schema as any);
}

function routeErrorTag(error: unknown): string {
  return typeof error === "object" && error !== null && "_tag" in error
    ? String((error as { readonly _tag: string })._tag)
    : "_";
}

/**
 * Component-first routing (Tier 1): attach route context, params/query/hash,
 * loader, and guards to an **already-composed** component in place. Use this
 * when the routing decision is local to a component — e.g. retrofitting
 * routing onto an exported/composed component, or a component-scoped guard.
 *
 * The route-first tree API (`Route.page`/`Route.path(...)` + pipe enhancers,
 * `Route.children`, `Route.define`, driven by `RouterRuntime`) is the other
 * tier: use it for app-wide route trees, nested layouts, SSR/streaming, and
 * tree-wide loader coordination. Neither tier is legacy — they are different
 * abstraction levels over the shared `Route.Router` history service.
 */
export function route<P = Record<string, string>, Q = Record<string, string | undefined>, H = string>(
  pattern: string,
  options?: {
    readonly params?: Schema.Schema<P>;
    readonly query?: Schema.Schema<Q>;
    readonly hash?: Schema.Schema<H>;
    readonly exact?: boolean;
    readonly onParseError?: "not-found" | "error" | ((error: unknown) => Effect.Effect<void>);
  },
): <Props, Req, E, Bindings, SlotContract>(
  component: Component<Props, Req, E, Bindings, SlotContract>,
) => (Component<Props, Exclude<Req, Route.RouteContext<any, any, any>> | Route.RouterService, E | { readonly _tag: "RouteParseError" }, Bindings, SlotContract>
  & Route.RoutedComponent<P, Q, H>) {
  return <Props, Req, E, Bindings, SlotContract>(component: Component<Props, Req, E, Bindings, SlotContract>) => {
    const i = internals(component);

    let wrapped: Component<Props, Req | Route.RouterService | Route.RouteContext<any, any, any>, E | { readonly _tag: "RouteParseError" }, RouteBindings<P, Q, H>, SlotContract>;

    wrapped = toComponent({
      ...i,
      setup: (props) => Effect.gen(function* () {
        const router = yield* Route.RouterTag;
        const parentPrefix = "";
        const headId = Route.createRouteHeadId();

        const fullPattern = Route.resolvePattern(parentPrefix, pattern);
        const routeMatched = yield* derived(() => Route.matchPattern(fullPattern, router.url().pathname, options?.exact));

        const paramsAtom = yield* derived(() => {
          if (!routeMatched()) return {} as P;
          const raw = Route.extractParams(fullPattern, router.url().pathname) ?? {};
          if (!options?.params) return raw as P;
          const decoded = decodeRouteOption(options.params)(raw);
          if (decoded._tag === "Some") return decoded.value as P;
          if (options?.onParseError === "error") {
            throw { _tag: "RouteParseError" as const, message: "Invalid route params" };
          }
          if (typeof options?.onParseError === "function") {
            Effect.runFork(options.onParseError({ _tag: "RouteParseError", message: "Invalid route params" }));
          }
          return {} as P;
        });

        const queryAtomValue = yield* derived(() => {
          if (!routeMatched()) return {} as Q;
          const raw = Object.fromEntries(router.url().searchParams.entries());
          if (!options?.query) return raw as Q;
          const decoded = decodeRouteOption(options.query)(raw);
          if (decoded._tag === "Some") return decoded.value as Q;
          if (options?.onParseError === "error") {
            throw { _tag: "RouteParseError" as const, message: "Invalid route query" };
          }
          if (typeof options?.onParseError === "function") {
            Effect.runFork(options.onParseError({ _tag: "RouteParseError", message: "Invalid route query" }));
          }
          return {} as Q;
        });

        const hashAtomValue = yield* derived(() => {
          const h = router.url().hash;
          const raw = h.startsWith("#") ? h.slice(1) : h;
          if (raw.length === 0) return undefined as H | undefined;
          if (!options?.hash) return raw as H;
          const decoded = decodeRouteOption(options.hash)(raw);
          return decoded._tag === "Some" ? decoded.value as H : undefined;
        });

        const prefixAtom = yield* derived(() => {
          if (!routeMatched()) return "";
          const matched = Route.extractParams(fullPattern, router.url().pathname);
          return matched === null ? "" : fullPattern;
        });

        const ctx: Route.RouteContext<P, Q, H> = {
          prefix: prefixAtom,
          params: paramsAtom,
          query: queryAtomValue,
          hash: hashAtomValue,
          matched: routeMatched,
          pattern: fullPattern,
          routeId: undefined,
        };

        const guards = asRoutedComponent<P, Q, H, unknown, unknown>(wrapped).__routeGuards ?? [];
        if (routeMatched()) {
          for (const guardEffect of guards) {
            yield* guardEffect;
          }
        }

        if (!routeMatched()) {
          Route.removeRouteHead(headId);
          return { __routeMatched: routeMatched, __routeInner: null, __routeCtx: ctx, __routeHeadId: headId, __routePattern: fullPattern } satisfies RouteBindings<P, Q, H>;
        }

        const wrappedRoute = asRoutedComponent<P, Q, H, unknown, unknown>(wrapped);
        const routeMeta = wrappedRoute[Route.RouteMetaSymbol];
        const routeId = routeMeta?.id ?? fullPattern;
        const loaderOptions = wrappedRoute.__routeLoaderOptions ?? {};
        const loaderResult = yield* Route.runRouteLoader(wrapped, {
          pattern,
          fullPattern,
          paramsSchema: options?.params,
          querySchema: options?.query,
          hashSchema: options?.hash,
          exact: options?.exact,
          id: routeId,
        }, router.url());

        let loaderDataAtom: Atom.ReadonlyAtom<unknown> | undefined;
        let loaderResultAtom: Atom.ReadonlyAtom<any> | undefined;
        if (wrappedRoute.__routeLoader) {
          if (loaderOptions.streaming) {
            const resultState = yield* state(loaderResult);
            loaderResultAtom = resultState;
            loaderDataAtom = Atom.derived(() => {
              const current = resultState();
              return current._tag === "Success" ? current.value : undefined;
            });
          } else {
            if (loaderResult._tag === "Failure") {
              const cases = wrappedRoute.__routeLoaderError;
              if (cases) {
                const tag = routeErrorTag(loaderResult.error);
                const handler = cases[tag] ?? cases._;
                if (handler) {
                  const fallbackView = handler(loaderResult.error, paramsAtom());
                  return { __routeMatched: routeMatched, __routeInner: { __routeLoaderErrorView: fallbackView }, __routeCtx: ctx, __routeHeadId: headId, __routePattern: fullPattern } satisfies RouteBindings<P, Q, H>;
                }
              }
              throw loaderResult.error;
            }
            const loaded = loaderResult._tag === "Success" ? loaderResult.value : undefined;
            loaderDataAtom = Atom.value(loaded);
            loaderResultAtom = Atom.value(loaderResult);
          }
        }

        const ctxWithLoader: Route.RouteContext<P, Q, H> = {
          ...ctx,
          routeId,
          loaderData: loaderDataAtom,
          loaderResult: loaderResultAtom,
        };

        const inner = yield* i.setup(props).pipe(
          Effect.provideService(Route.RouteContextTag, ctxWithLoader),
        );

        const routeTitle: string
          | ((params: P, loaderData: unknown | undefined, loaderResult: Result<unknown, unknown> | undefined) => string)
          | undefined = wrappedRoute.__routeTitle;
        const routeMetaExtra: Route.RouteMetaRecord
          | ((params: P, loaderData: unknown | undefined, loaderResult: Result<unknown, unknown> | undefined) => Route.RouteMetaRecord)
          | undefined = wrappedRoute.__routeMetaExtra;
        const applyHead = () => {
          if (!routeMatched()) {
            Route.removeRouteHead(headId);
            return;
          }
          const loaderDataForHead = loaderDataAtom ? loaderDataAtom() : undefined;
          // Head callbacks receive the unified Result model (matching the
          // tree-render path and Route.loaderResult()); the cache is FetchResult.
          const loaderResultForHead = Route.toUnifiedLoaderResult(loaderResultAtom ? loaderResultAtom() : undefined);
          const titleResolved = routeTitle === undefined
            ? undefined
            : typeof routeTitle === "function"
              ? routeTitle(paramsAtom(), loaderDataForHead, loaderResultForHead)
              : routeTitle;
          const metaResolved = routeMetaExtra === undefined
            ? undefined
            : typeof routeMetaExtra === "function"
              ? routeMetaExtra(paramsAtom(), loaderDataForHead, loaderResultForHead)
              : routeMetaExtra;

          Route.setRouteHead({
            id: headId,
            depth: fullPattern.split("/").filter(Boolean).length,
            title: titleResolved,
            meta: metaResolved,
          });
        };

        applyHead();

        const headUnsubscribers: Array<() => void> = [];
        headUnsubscribers.push(Atom.subscribe(routeMatched, applyHead, { immediate: false }));
        headUnsubscribers.push(Atom.subscribe(paramsAtom, applyHead, { immediate: false }));
        if (loaderDataAtom) {
          headUnsubscribers.push(Atom.subscribe(loaderDataAtom, applyHead, { immediate: false }));
        }
        if (loaderResultAtom) {
          headUnsubscribers.push(Atom.subscribe(loaderResultAtom, applyHead, { immediate: false }));
        }
        const componentScope = currentComponentScope();
        if (componentScope !== null) {
          yield* Effect.addFinalizer(() => Effect.sync(() => {
            for (const unsubscribe of headUnsubscribers) {
              unsubscribe();
            }
            Route.removeRouteHead(headId);
          })).pipe(Scope.provide(componentScope));
        }

        return { __routeMatched: routeMatched, __routeInner: inner, __routeCtx: ctxWithLoader, __routeHeadId: headId, __routePattern: fullPattern } satisfies RouteBindings<P, Q, H>;
      }),
      view: (props, bindings: RouteBindings<P, Q, H>) => {
        if (!bindings.__routeMatched()) {
          if (bindings.__routeHeadId) {
            Route.removeRouteHead(String(bindings.__routeHeadId));
          }
          return null;
        }
        if (bindings.__routeInner && typeof bindings.__routeInner === "object" && "__routeLoaderErrorView" in bindings.__routeInner) {
          return bindings.__routeInner.__routeLoaderErrorView;
        }
        if (bindings.__routeInner === null) return null;
        if (i.view === undefined) {
          const renderProp = (props as RenderPropChildren<unknown>).children;
          return typeof renderProp === "function" ? renderProp(bindings.__routeInner) : null;
        }
        return i.view(props, bindings.__routeInner as Bindings);
      },
    }) as Component<Props, Req | Route.RouterService | Route.RouteContext<any, any, any>, E | { readonly _tag: "RouteParseError" }, RouteBindings<P, Q, H>, SlotContract>;

    const meta: Route.RouteMeta<P, Q, H> = {
      pattern,
      fullPattern: Route.resolvePattern("", pattern),
      paramsSchema: options?.params,
      querySchema: options?.query,
      hashSchema: options?.hash,
      exact: options?.exact,
      id: Route.createRouteId(),
    };
    setRoutedMeta<P, Q, H>(wrapped, meta);
    Route.registerRoute(wrapped, meta);
    return wrapped as unknown as Component<Props, Exclude<Req, Route.RouteContext<any, any, any>> | Route.RouterService, E | { readonly _tag: "RouteParseError" }, Bindings, SlotContract> & Route.RoutedComponent<P, Q, H>;
  };
}

/**
 * Component-scoped guard (Tier 1, pairs with `Component.route`): runs a check
 * Effect in the component's setup and short-circuits render on failure. Use
 * for guards local to a component; use `Route.guard(...)` on unified routes
 * for tree-level guards. Both tiers are supported.
 */
export function guard<Req, E>(
  check: Effect.Effect<unknown, E, Req>,
): <C extends Component<any, any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C> | Req, Errors<C> | E, BindingsOf<C>, SlotContractOf<C>>> {
  return <C extends Component<any, any, any, any, any>>(component: C) => {
    const routed = asRoutedComponent(component);
    const current = routed.__routeGuards ?? [];
    routed.__routeGuards = [...current, check];
    return component as unknown as PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C> | Req, Errors<C> | E, BindingsOf<C>, SlotContractOf<C>>>;
  };
}

export function withBehavior<Elements, AddedBindings, BR, BE, Props, Req, E, Bindings, Slots = SlotsFromBindings<Bindings>, SlotContract = {}>(
  behavior: Behavior.Behavior<Elements, AddedBindings, BR, BE>,
  selectElements: (bindings: Bindings, props: Props) => Elements,
  merge?: (bindings: Bindings, added: AddedBindings) => Bindings & AddedBindings,
): (
  component: Component<Props, Req, E, Bindings, SlotContract>,
) => Component<Props, Req | BR, E | BE, Bindings & AddedBindings, SlotContract> {
  return (component) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      setup: (props) => Effect.gen(function* () {
        const base: Bindings = yield* (i.setup(props) as any);
        const elements = selectElements(base, props);
        const added: AddedBindings = yield* (behavior.run(elements) as any);
        if (merge) {
          return merge(base, added);
        }
        return { ...(base as any), ...(added as any) };
      }) as any,
    }) as Component<Props, Req | BR, E | BE, Bindings & AddedBindings, SlotContract>;
  };
}

export function slotInteractive(): Effect.Effect<Element.Interactive> {
  return Effect.sync(() => Element.interactive());
}

export function slotContainer(): Effect.Effect<Element.Container> {
  return Effect.sync(() => Element.container());
}

export function slotFocusable(): Effect.Effect<Element.Focusable> {
  return Effect.sync(() => Element.focusable());
}

export function slotTextInput(): Effect.Effect<Element.TextInput> {
  return Effect.sync(() => Element.textInput());
}

export function slotDraggable(): Effect.Effect<Element.Draggable> {
  return Effect.sync(() => Element.draggable());
}

export function slotCollection<E extends Element.Handle>(items: ReadonlyArray<E> = []): Effect.Effect<Element.Collection<E>> {
  return Effect.sync(() => Element.collection(items));
}

export interface MountOptions<Props, R, E> {
  readonly props: Props;
  readonly layer: Layer.Layer<R, E, never>;
  readonly target: Element;
  readonly onScopeError?: (cause: Cause.Cause<unknown>) => void;
  readonly supervisor?: unknown;
}

/**
 * Mount options for the one-composition-root golden path: reuse the service
 * world of an existing `Atom.runtime(layer)` instead of building a second one
 * from a separate layer value. The caller keeps ownership of the runtime —
 * disposing the mount tears down the tree, not the shared runtime.
 */
export interface MountWithRuntimeOptions<Props, R, E> {
  readonly props: Props;
  readonly runtime: Atom.AtomRuntime<R, E>;
  readonly target: Element;
  readonly onScopeError?: (cause: Cause.Cause<unknown>) => void;
  readonly supervisor?: unknown;
}

export function mount<Props, Req, E>(
  component: Component<Props, Req, E, any>,
  options: MountOptions<Props, Req, any> | MountWithRuntimeOptions<Props, Req, any>,
): () => void {
  const dispose = "runtime" in options
    ? mountWithManagedRuntime(() => component(options.props), options.target, options.runtime.managed)
    : mountRuntime(() => component(options.props), options.target, options.layer as Layer.Layer<Req, any, never>);
  return () => {
    dispose();
  };
}

export const Component = {
  TypeId: ComponentTypeId,
  make,
  from,
  headless,
  props,
  propsSchema,
  require,
  setup,
  bind,
  value,
  doEffect,
  use,
  setupEffect,
  renderEffect,
  renderViewEffect,
  validateSlotContract,
  validateRenderedSlotContract,
  mount,
  signal,
  effect,
  state,
  derived,
  query,
  action,
  optimistic,
  ref,
  registerViewSlots,
  getViewSlots,
  getSlotContract,
  fromDequeue,
  schedule,
  scheduleEffect,
  withLayer,
  withSlotContract,
  withSlots,
  withErrorBoundary,
  withLoading,
  withSpan,
  memo,
  tapSetup,
  withViewTransform,
  withPreSetup,
  withSetupRetry,
  withSetupTimeout,
  route,
  withBehavior,
  slotInteractive,
  slotContainer,
  slotFocusable,
  slotTextInput,
  slotDraggable,
  slotCollection,
} as const;




