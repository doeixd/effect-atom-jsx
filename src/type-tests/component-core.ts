import { Effect, Layer, Schedule, Scope, ServiceMap } from "effect";
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
    return { count, config };
  }),
  () => null,
);

type _StateBindings = Component.BindingsOf<typeof StateComponent>;
type _StateCountCheck = Expect<Equal<_StateBindings["count"], import("../Atom.js").WritableAtom<number>>>;
type _StateConfigCheck = Expect<Equal<_StateBindings["config"], import("../Atom.js").WritableAtom<{ retries: number }>>>;

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
type _RoutedAddsRouteContext = Expect<Route.RouteContext<any, any, any> extends Component.Requirements<typeof Routed> ? true : false>;
type _RoutedAddsParseError = Expect<{ readonly _tag: "RouteParseError" } extends Component.Errors<typeof Routed> ? true : false>;
