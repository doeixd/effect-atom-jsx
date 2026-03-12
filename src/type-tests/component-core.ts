import { Effect, Layer, ServiceMap } from "effect";
import * as Component from "../Component.js";

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
