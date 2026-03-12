import { Effect, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";

const UserRouteBase = Route.path("/users/:userId")(Component.from<{}>(() => null));
const UserRoute = Route.querySchema(Schema.Struct({ page: Schema.optional(Schema.NumberFromString) }))(
  Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(UserRouteBase),
);

const LoadedUserRoute = Route.loader((params: { readonly userId: string }) =>
  Effect.succeed({ id: params.userId, name: "Alice" }))(UserRoute);

const HeadedUserRoute = LoadedUserRoute.pipe(
  Route.title((params: { readonly userId: string }, data: { readonly id: string; readonly name: string } | undefined) => `${params.userId}:${data?.name ?? "none"}`),
  Route.meta((params: { readonly userId: string }, data: { readonly id: string; readonly name: string } | undefined) => ({ description: `${params.userId}:${data?.id ?? "none"}` })),
);

const userLink = Route.link(UserRoute);
const loadedUserLink = Route.link(LoadedUserRoute);

type UserParams = Route.ParamsOf<typeof UserRoute>;
type UserQuery = Route.QueryOf<typeof UserRoute>;
type LoadedUserData = Route.LoaderDataOf<typeof LoadedUserRoute>;

declare const userParams: UserParams;
declare const userQuery: UserQuery;
declare const loadedUserData: LoadedUserData;

void userParams.userId;
void userQuery.page;
void loadedUserData.name;

userLink({ userId: "alice" });
userLink({ userId: "alice" }, { query: { page: 2 } });
loadedUserLink({ userId: "alice" });

void HeadedUserRoute;

// @ts-expect-error userId missing
userLink({});

// @ts-expect-error wrong userId type
userLink({ userId: 42 });
