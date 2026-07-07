import { Effect, Layer, Schedule, Scope, ServiceMap } from "effect";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Route from "../Route.js";
import * as View from "../View.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

type Api = { readonly find: (id: string) => Effect.Effect<string> };
const Api = ServiceMap.Service<Api>("Api");

type Auth = { readonly current: () => Effect.Effect<string> };
const Auth = ServiceMap.Service<Auth>("Auth");

type HttpError = { readonly _tag: "HttpError" };
type AuthError = { readonly _tag: "AuthError" };
type SaveError = { readonly _tag: "SaveError" };

const UserCard = Component.make(
  Component.props<{ readonly id: string }>(),
  Component.require<Api | Auth>(Api, Auth),
  ({ id }) => Effect.gen(function* () {
    const api = yield* Api;
    const auth = yield* Auth;
    const user = yield* Component.query(() => api.find(id).pipe(Effect.mapError(() => ({ _tag: "HttpError" } as const))));
    const who = yield* Component.query(() => auth.current().pipe(Effect.mapError(() => ({ _tag: "AuthError" } as const))));
    return { user, who };
  }),
  (_props, _bindings) => null,
);

type _ReqCheckA = Expect<Component.Requirements<typeof UserCard> extends Api | Auth ? true : false>;
type _ReqCheckB = Expect<Api | Auth extends Component.Requirements<typeof UserCard> ? true : false>;

const WithApi = UserCard.pipe(
  Component.withLayer(Layer.succeed(Api, { find: (id: string) => Effect.succeed(id) })),
);

type _WithApiReq = Component.Requirements<typeof WithApi>;
type _WithApiReqCheck = Expect<_WithApiReq extends Auth | unknown ? true : false>;

const TypedErrorComponent = Component.make<{ readonly id: string }, never, HttpError | AuthError, {}>(
  Component.props<{ readonly id: string }>(),
  Component.require<never>(),
  () => Effect.succeed({}),
  () => null,
);

type _ErrorsCheck = Expect<Equal<Component.Errors<typeof TypedErrorComponent>, HttpError | AuthError>>;

const Safe = TypedErrorComponent.pipe(
  Component.withErrorBoundary({
    HttpError: () => null,
  }),
);

type _SafeErrors = Component.Errors<typeof Safe>;
type _SafeErrorsCheck = Expect<Equal<Extract<_SafeErrors, { readonly _tag: "HttpError" }>, never>>;

const ViewBacked = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.gen(function* () {
    const root = yield* Component.slotContainer();
    const input = yield* Component.slotTextInput();
    return {
      slots: {
        root,
        input,
      },
    };
  }),
  (_props, bindings) => View.make(bindings.slots, null),
);

type _ViewBackedSlots = Component.SlotsOf<typeof ViewBacked>;
type _ViewBackedSlotsCheck = Expect<Equal<_ViewBackedSlots, {
  root: Element.Container;
  input: Element.TextInput;
}>>;

const standaloneView = View.make({
  root: Element.container(),
  input: Element.textInput(),
}, null);

type _StandaloneViewSlots = View.SlotsOf<typeof standaloneView>;
type _StandaloneViewSlotsCheck = Expect<Equal<_StandaloneViewSlots, {
  root: Element.Container;
  input: Element.TextInput;
}>>;

const StateComponent = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.gen(function* () {
    const count = yield* Component.state(0);
    const config = yield* Component.state<{ retries: number }>({ retries: 0 });
    const [step, setStep] = yield* Component.signal(1);
    yield* Component.effect(() => {
      step();
    });
    return { count, config, step, setStep };
  }),
  () => null,
);

type _StateBindings = Component.BindingsOf<typeof StateComponent>;
type _StateCountCheck = Expect<Equal<_StateBindings["count"], import("../Atom.js").WritableAtom<number>>>;
type _StateConfigCheck = Expect<Equal<_StateBindings["config"], import("../Atom.js").WritableAtom<{ retries: number }>>>;
type _SignalAccessorCheck = Expect<Equal<_StateBindings["step"], import("../api.js").Accessor<number>>>;
type _SignalSetterCheck = Expect<Equal<_StateBindings["setStep"], import("../api.js").Setter<number>>>;

const BuilderFragment = Component.setup<{ readonly id: string }>()
  .bind("page", () => Component.state(0))
  .value("pageLabel", ({ props, bindings }) => `${props.id}:${bindings.page()}`);

const BuilderSetup = Component.setup<{ readonly id: string }>()
  .use(BuilderFragment)
  .bind("user", ({ props, bindings }) =>
    Component.query(() =>
      Effect.gen(function* () {
        const api = yield* Api;
        const suffix = bindings.pageLabel;
        return `${yield* api.find(props.id)}:${suffix}`;
      })
    )
  )
  .bind("save", ({ props }) =>
    Component.action((value: string) =>
      Effect.gen(function* () {
        const api = yield* Api;
        return yield* api.find(`${props.id}:${value}`);
      })
    )
  );

type _BuilderSetupBindings = Component.SetupBindingsOf<typeof BuilderSetup>;
type _BuilderPage = Expect<Equal<_BuilderSetupBindings["page"], Atom.WritableAtom<number>>>;
type _BuilderPageLabel = Expect<Equal<_BuilderSetupBindings["pageLabel"], string>>;
type _BuilderUserValue = Expect<Equal<Atom.ValueOf<_BuilderSetupBindings["user"]>, import("../effect-ts.js").Result<string, never>>>;
type _BuilderSaveInput = Expect<Equal<Component.ActionInputOf<_BuilderSetupBindings["save"]>, string>>;
type _BuilderSetupReq = Expect<Equal<Component.SetupRequirementsOf<typeof BuilderSetup>, Api>>;

const BuilderComponent = Component.make(
  Component.props<{ readonly id: string }>(),
  Component.require<never>(),
  BuilderSetup,
  (_props, _bindings) => null,
);

type _BuilderComponentReq = Expect<Equal<Component.Requirements<typeof BuilderComponent>, Api>>;
type _BuilderComponentBindings = Expect<Equal<Component.BindingsOf<typeof BuilderComponent>, _BuilderSetupBindings>>;

const PipeBuilderSetup = Component.setup<{ readonly id: string }>().pipe(
  Component.bind("count", () => Component.state(0)),
);

type _PipeBuilderBindings = Component.SetupBindingsOf<typeof PipeBuilderSetup>;
type _PipeBuilderCount = Expect<Equal<_PipeBuilderBindings["count"], Atom.WritableAtom<number>>>;

Component.setup<{}>()
  .bind("count", () => Component.state(0))
  // @ts-expect-error setup builder binding names must be unique
  .bind("count", () => Component.state(1));

const QueryRequirementComponent = Component.make(
  Component.props<{ readonly id: string }>(),
  Component.require<never>(),
  ({ id }) => Effect.gen(function* () {
    const user = yield* Component.query(() =>
      Effect.gen(function* () {
        const api = yield* Api;
        return yield* api.find(id);
      }),
    );
    return { user };
  }),
  () => null,
);

type _QueryRequirement = Expect<Equal<Component.Requirements<typeof QueryRequirementComponent>, Api>>;
type _QueryBindings = Component.BindingsOf<typeof QueryRequirementComponent>;
type _QueryAtom = _QueryBindings["user"];
type _QueryValue = Expect<Equal<Atom.ValueOf<_QueryAtom>, import("../effect-ts.js").Result<string, never>>>;
type _QueryError = Expect<Equal<Atom.ErrorOf<_QueryAtom>, never>>;
type _QueryCapturedRequirements = Expect<Equal<Atom.RequirementsOf<_QueryAtom>, never>>;

const ActionRequirementComponent = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.gen(function* () {
    const save = yield* Component.action((id: string) =>
      Effect.gen(function* () {
        const api = yield* Api;
        yield* api.find(id).pipe(Effect.mapError(() => ({ _tag: "SaveError" } as SaveError)));
        return id.length;
      }),
    );
    return { save };
  }),
  () => null,
);

type _ActionRequirement = Expect<Equal<Component.Requirements<typeof ActionRequirementComponent>, Api>>;
type _ActionErrors = Expect<Equal<Component.Errors<typeof ActionRequirementComponent>, never>>;
type _ActionBindings = Component.BindingsOf<typeof ActionRequirementComponent>;
type _ActionHandle = _ActionBindings["save"];
type _ActionArgs = Expect<Equal<Component.ActionArgsOf<_ActionHandle>, [id: string]>>;
type _ActionInput = Expect<Equal<Component.ActionInputOf<_ActionHandle>, string>>;
type _ActionSuccess = Expect<Equal<Component.ActionSuccessOf<_ActionHandle>, number>>;
type _ActionError = Expect<Equal<Component.ActionErrorOf<_ActionHandle>, SaveError>>;
type _ActionRunError = Expect<Equal<Component.ActionRunErrorOf<_ActionHandle>, SaveError>>;
type _ActionEffectError = Expect<Equal<
  Component.ActionEffectErrorOf<_ActionHandle>,
  SaveError | import("../effect-ts.js").BridgeError | import("../effect-ts.js").MutationSupersededError
>>;
type _ActionRunEffect = Expect<Equal<Component.ActionRunEffectOf<_ActionHandle>, (id: string) => Effect.Effect<number, SaveError>>>;
type _ActionEffect = Expect<Equal<
  Component.ActionEffectOf<_ActionHandle>,
  (id: string) => Effect.Effect<void, SaveError | import("../effect-ts.js").BridgeError | import("../effect-ts.js").MutationSupersededError>
>>;
type _ActionCallReturn = Expect<Equal<ReturnType<_ActionHandle>, void>>;
type _ActionRunReturn = Expect<Equal<ReturnType<_ActionHandle["run"]>, void>>;
type _ActionHasNoRequirementAxis = Expect<Equal<_ActionHandle extends Component.ComponentAction<any, any, any> ? true : false, true>>;

const ActionWithApi = ActionRequirementComponent.pipe(
  Component.withLayer(Layer.succeed(Api, { find: (id: string) => Effect.succeed(id) })),
);

type _ActionWithApiReq = Expect<Equal<Component.Requirements<typeof ActionWithApi>, never>>;

const ScheduleRequirementComponent = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.gen(function* () {
    yield* Component.scheduleEffect(
      Schedule.recurs(1),
      Effect.gen(function* () {
        const auth = yield* Auth;
        return yield* auth.current();
      }),
    );
    return {};
  }),
  () => null,
);

type _ScheduleRequirement = Expect<Equal<Component.Requirements<typeof ScheduleRequirementComponent>, Auth | Scope.Scope>>;

const Guarded = QueryRequirementComponent.pipe(
  Component.guard(
    Effect.gen(function* () {
      const auth = yield* Auth;
      return yield* auth.current().pipe(Effect.mapError(() => ({ _tag: "AuthError" } as AuthError)));
    }),
  ),
);

type _GuardedRequirements = Expect<Equal<Component.Requirements<typeof Guarded>, Api | Auth>>;
type _GuardedErrors = Expect<Equal<Component.Errors<typeof Guarded>, AuthError>>;

const Routed = QueryRequirementComponent.pipe(
  Component.route("/users/:id"),
);

type _RoutedKeepsApi = Expect<Api extends Component.Requirements<typeof Routed> ? true : false>;
type _RoutedAddsRouter = Expect<Route.RouterService extends Component.Requirements<typeof Routed> ? true : false>;
// Component.route provides RouteContext to the inner setup, so it must NOT
// leak into the wrapped component's requirements.
type _RoutedDischargesRouteContext = Expect<Route.RouteContext<any, any, any> extends Component.Requirements<typeof Routed> ? false : true>;
type _RoutedAddsParseError = Expect<{ readonly _tag: "RouteParseError" } extends Component.Errors<typeof Routed> ? true : false>;
