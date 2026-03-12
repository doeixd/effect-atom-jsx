import { Effect, Layer, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Route from "../Route.js";

type UserNotFound = { readonly _tag: "UserNotFound"; readonly id: string };
type Forbidden = { readonly _tag: "Forbidden"; readonly reason: string };

const UserRouteBase = Route.path("/users/:userId")(Component.from<{}>(() => null));
const UserRoute = Route.loader((params: { readonly userId: string }) =>
  Effect.succeed({ id: params.userId, name: "Alice" }))(
  Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(UserRouteBase),
);

const UserRouteWithHead = Route.meta<{ readonly userId: string }, { readonly id: string; readonly name: string }>((params, loaderData) => ({
  description: `${params.userId}:${loaderData?.id ?? "none"}`,
}))(
  Route.title<{ readonly userId: string }, { readonly id: string; readonly name: string }>((params, loaderData) =>
    `${params.userId}-${loaderData?.name ?? "none"}`)(UserRoute),
);

const ErrorRoute = Route.loader((params: { readonly userId: string }): Effect.Effect<never, UserNotFound | Forbidden> =>
  Effect.fail<UserNotFound | Forbidden>({ _tag: "UserNotFound", id: params.userId }))(
  Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(Route.path("/users/:userId/error")(Component.from<{}>(() => null))),
);

const errorCases = {
  UserNotFound: (error: UserNotFound, params: { readonly userId: string }) => `${params.userId}:${error.id}`,
  Forbidden: (error: Forbidden) => error.reason,
  _: (error: UserNotFound | Forbidden) => error,
} satisfies Route.LoaderErrorCases<{ readonly userId: string }, UserNotFound | Forbidden>;

const ErrorRouteWithCases = Route.loaderError(errorCases)(ErrorRoute);

const userLink = Route.link(UserRoute);
userLink({ userId: "alice" });

const seededPayload = Route.setLoaderData(UserRoute, { id: "alice", name: "Alice" });
const projectedSeed = Route.seedLoader(UserRoute, (result: { readonly id: string; readonly profile: { readonly name: string } }) => ({
  id: result.id,
  name: result.profile.name,
}));

type UserParams = Route.ParamsOf<typeof UserRoute>;
type UserData = Route.LoaderDataOf<typeof UserRoute>;
type ErrorParams = Route.ParamsOf<typeof ErrorRoute>;
type ErrorType = Route.LoaderErrorOf<typeof ErrorRoute>;

declare const userParams: UserParams;
declare const userData: UserData;
declare const errorParams: ErrorParams;
declare const errorType: ErrorType;

void userParams.userId;
void userData.name;
void errorParams.userId;
void errorType;
void UserRouteWithHead;
void ErrorRouteWithCases;
void seededPayload;
void projectedSeed;

const sfmFactory = Route.actionSingleFlight((userId: string) => Effect.succeed({ ok: userId }), {
  target: (_result, [userId]) => `/users/${userId}`,
});
const sfm = Effect.runSync(sfmFactory as Effect.Effect<(userId: string) => Effect.Effect<Route.SingleFlightPayload<{ readonly ok: string }>, never, Route.RouterService>, never, never>);
void sfm;

const sfmHandler = Route.createSingleFlightHandler(sfm, { baseUrl: "https://example.com" });
void sfmHandler;

const sfmInvoke = Route.invokeSingleFlight<[string], { readonly ok: string }>("/api/sfm", {
  args: ["alice"],
  url: "/users/alice",
}, {
  fetch: async () => ({
    json: async () => ({ ok: true as const, payload: { mutation: { ok: "alice" }, url: "https://example.com/users/alice", loaders: [] } }),
  }),
});
void sfmInvoke;

const sfmMutation = Route.mutationSingleFlight((userId: string) => Effect.succeed({ ok: userId }), {
  target: (_result, [userId]) => `/users/${userId}`,
});
const sfmMutationHandle = Effect.runSync(
  sfmMutation.pipe(Effect.provide(Route.Memory("/"))) as Effect.Effect<Route.SingleFlightMutationHandle<[string], { readonly ok: string }, never, never>, never, never>,
);
void sfmMutationHandle;

const atomSingleFlight = Atom.action(
  (userId: string) => Effect.succeed({ ok: userId }),
  {
    singleFlight: {
      endpoint: "/api/sfm",
      url: (userId: string) => `/users/${userId}`,
      fetch: async () => ({
        json: async () => ({ ok: true as const, payload: { mutation: { ok: "alice" }, url: "https://example.com/users/alice", loaders: [] } }),
      }),
    },
  },
);
void atomSingleFlight;

const atomRuntime = Atom.runtime(Layer.empty);
const runtimeSingleFlight = atomRuntime.action(
  (userId: string) => Effect.succeed({ ok: userId }),
  {
    singleFlight: {
      endpoint: "/api/sfm",
      url: (userId: string) => `/users/${userId}`,
      fetch: async () => ({
        json: async () => ({ ok: true as const, payload: { mutation: { ok: "alice" }, url: "https://example.com/users/alice", loaders: [] } }),
      }),
    },
  },
);
void runtimeSingleFlight;
