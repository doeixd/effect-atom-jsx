import { Effect, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";

const SearchRouteBase = Route.path("/teams/:teamId")(Component.from<{}>(() => null));
const SearchRouteWithId = Route.id("teams.detail")(SearchRouteBase);
const SearchRouteWithParams = Route.paramsSchema(Schema.Struct({ teamId: Schema.String }))(SearchRouteWithId);
const SearchRouteWithQuery = Route.querySchema<{ readonly page?: number }>(Schema.Struct({ page: Schema.optional(Schema.NumberFromString) }))(SearchRouteWithParams);
const SearchRouteWithHash = Route.hashSchema<string>(Schema.String)(SearchRouteWithQuery);
const SearchRouteWithLoader = Route.loader((params: { readonly teamId: string }) => Effect.succeed({ id: params.teamId, name: "A-Team" }))(SearchRouteWithHash);
const SearchRouteWithTitle = Route.title((params: { readonly teamId: string }, team: { readonly id: string; readonly name: string } | undefined) =>
  `${params.teamId}:${team?.name ?? "none"}`)(SearchRouteWithLoader);
const SearchRoute = Route.meta((params: { readonly teamId: string }, team: { readonly id: string; readonly name: string } | undefined) => ({
  description: `${params.teamId}:${team?.id ?? "none"}`,
}))(SearchRouteWithTitle);

type SearchRouteParams = Route.ParamsOf<typeof SearchRoute>;
type SearchRouteQuery = Route.QueryOf<typeof SearchRoute>;
type SearchRouteHash = Route.HashOf<typeof SearchRoute>;
type SearchRouteData = Route.LoaderDataOf<typeof SearchRoute>;

declare const searchRouteParams: SearchRouteParams;
declare const searchRouteQuery: SearchRouteQuery;
declare const searchRouteHash: SearchRouteHash;
declare const searchRouteData: SearchRouteData;

void searchRouteParams.teamId;
void searchRouteQuery;
void searchRouteHash;
void searchRouteData.name;

const searchRouteLink = Route.link(SearchRoute);
searchRouteLink({ teamId: "a-team" }, { query: { page: 2 }, hash: "members" });

type SearchRouteLinkParams = Parameters<typeof searchRouteLink>[0];
type SearchRouteLinkOptions = Parameters<typeof searchRouteLink>[1];

declare const searchRouteLinkParams: SearchRouteLinkParams;
declare const searchRouteLinkOptions: SearchRouteLinkOptions;

void searchRouteLinkParams.teamId;
void searchRouteLinkOptions;
