import { Effect, Schema, ServiceMap } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";

type AuthError = { readonly _tag: "AuthError" };
type DbError = { readonly _tag: "DbError" };

const AuthService = ServiceMap.Service<{ readonly check: () => Effect.Effect<string, AuthError> }>("AuthService");
const DbService = ServiceMap.Service<{ readonly query: () => Effect.Effect<ReadonlyArray<string>, DbError> }>("DbService");

const BaseComponent = Component.from<{}>(() => null);

const authCheck = Effect.gen(function* () {
  const auth = yield* AuthService;
  return yield* auth.check();
});

const GuardedBase = Route.path("/protected")(BaseComponent);
const GuardedRoute = Route.guard(authCheck)(GuardedBase);

type GuardedComponent = typeof GuardedRoute.component;
type GuardedReq = GuardedComponent extends Component.Component<any, infer Req, any, any, any> ? Req : never;

type _GuardHasReq = [GuardedReq] extends [never] ? "never" : "has-req";
const _guardCheck: "has-req" = null as any as _GuardHasReq;

const LoadedBase = Route.paramsSchema(Schema.Struct({ id: Schema.String }))(Route.path("/data/:id")(BaseComponent));
const LoadedRoute = Route.loader((params: { readonly id: string }) => Effect.gen(function* () {
  const db = yield* DbService;
  return yield* db.query();
}))(LoadedBase);

type LoadedComponent = typeof LoadedRoute.component;
type LoadedReq = LoadedComponent extends Component.Component<any, infer Req, any, any, any> ? Req : never;

type _LoaderHasReq = [LoadedReq] extends [never] ? "never" : "has-req";
const _loaderCheck: "has-req" = null as any as _LoaderHasReq;

type LoadedErrors = LoadedComponent extends Component.Component<any, any, infer E, any, any> ? E : never;
type _LoaderHasError = [LoadedErrors] extends [never] ? "never" : "has-error";
const _loaderErrorCheck: "has-error" = null as any as _LoaderHasError;
