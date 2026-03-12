import { Effect, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";

const UserRouteBase = Route.path("/bridge/users/:userId")(Component.from<{}>(() => null));

const UserRouteWithParams = Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(UserRouteBase);
const UserRouteWithQuery = Route.querySchema(Schema.Struct({ page: Schema.optional(Schema.NumberFromString) }))(UserRouteWithParams);
const UserRouteWithLoader = Route.loader((params: { readonly userId: string }) => Effect.succeed({ id: params.userId, name: "Bridge" }))(UserRouteWithQuery);
const UserRouteWithTitle = Route.title<{ readonly userId: string }, { readonly id: string; readonly name: string }>((params, data) =>
  `${params.userId}:${data?.name ?? "none"}`)(UserRouteWithLoader);
const UserRoute = Route.meta<{ readonly userId: string }, { readonly id: string; readonly name: string }>((params, data) => ({
  description: `${params.userId}:${data?.id ?? "none"}`,
}))(UserRouteWithTitle);

void UserRoute;
