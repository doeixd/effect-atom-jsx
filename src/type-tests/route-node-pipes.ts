import { Effect, Schema } from "effect";
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

type UserLoaderError = { readonly _tag: "UserLoaderError"; readonly userId: string };

const Home = Route.index(Component.from<{}>(() => null)).pipe(Route.id("home"));
const Users = Route.page("/users", Component.from<{}>(() => null)).pipe(Route.id("users.index"));
const UserBase = Route.id("users.detail")(Route.page("/users/:userId", Component.from<{}>(() => null)));
const UserWithParams = Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(UserBase);
const UserWithQuery = Route.querySchema(Schema.Struct({ tab: Schema.optional(Schema.Union([Schema.Literal("profile"), Schema.Literal("settings")])) }))(UserWithParams);
const UserWithSchema = Route.hashSchema(Schema.String)(UserWithQuery);
const UserWithLoader = Route.loader<typeof UserWithSchema, { readonly id: string; readonly name: string }, UserLoaderError, never>((params) =>
  Effect.gen(function* () {
    if (params.userId.length === 0) {
      return yield* Effect.fail({ _tag: "UserLoaderError", userId: params.userId } as const);
    }
    return { id: params.userId, name: "Ada" };
  }),
)(UserWithSchema);
const UserWithTitle = Route.title<typeof UserWithLoader>((params, user) =>
  `${params.userId}:${user?.name ?? "loading"}`)(UserWithLoader);
const User = Route.meta<typeof UserWithTitle>((params, user) => ({
  description: `${params.userId}:${user?.id ?? "none"}`,
}))(UserWithTitle);
const UserWithInlineLoader = Route.page("/inline-users/:userId", Component.from<{}>(() => null)).pipe(
  Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
  Route.loader((params) =>
    Effect.gen(function* () {
      if (params.userId.length === 0) {
        return yield* Effect.fail({ _tag: "UserLoaderError", userId: params.userId } as const);
      }
      return { id: params.userId, name: "Ada" };
    }),
  ),
);
void UserWithInlineLoader;
const PipedUser = Route.page("/piped-users/:userId", Component.from<{}>(() => null)).pipe(
  Route.id("users.piped"),
  Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
  Route.querySchema(Schema.Struct({ tab: Schema.optional(Schema.Union([Schema.Literal("profile"), Schema.Literal("settings")])) })),
  Route.hashSchema(Schema.String),
);
const Settings = Route.page("settings", Component.from<{}>(() => null)).pipe(Route.id("users.settings"));

const App = Route.define(
  Route.layout(Component.from<{}>(() => null)).pipe(
    Route.id("app"),
    Route.children([
      Route.ref(Home),
      Route.ref(Users),
      Route.mount(User, [Route.ref(Settings)]),
    ]),
  ),
);

type AppChildren = typeof App.children;
void App;
void (null as unknown as AppChildren);

const materialized = Route.componentOf(User);
void materialized;

type UserRouteParams = Route.ParamsOf<typeof User>;
type UserRouteQuery = Route.QueryOf<typeof User>;
type UserRouteHash = Route.HashOf<typeof User>;
type UserRouteData = Route.LoaderDataOf<typeof User>;
type UserRouteError = Route.LoaderErrorOf<typeof User>;
type PipedUserParams = Route.ParamsOf<typeof PipedUser>;
type PipedUserQuery = Route.QueryOf<typeof PipedUser>;
type PipedUserHash = Route.HashOf<typeof PipedUser>;

type _UserParamsHasId = Expect<UserRouteParams extends { readonly userId: string } ? true : false>;
type _UserParamsId = Expect<Equal<UserRouteParams["userId"], string>>;
type _UserHash = Expect<UserRouteHash extends string ? true : false>;
type _UserLoaderData = Expect<Equal<UserRouteData, { readonly id: string; readonly name: string }>>;
type _UserLoaderError = Expect<Equal<UserRouteError, UserLoaderError>>;
type _PipedUserParamsHasId = Expect<PipedUserParams extends { readonly userId: string } ? true : false>;
type _PipedUserParamsId = Expect<Equal<PipedUserParams["userId"], string>>;
type _PipedUserHash = Expect<PipedUserHash extends string ? true : false>;

declare const userRouteQuery: UserRouteQuery;
const userRouteTab: "profile" | "settings" | undefined = userRouteQuery.tab;
void userRouteTab;
declare const pipedUserQuery: PipedUserQuery;
const pipedUserTab: "profile" | "settings" | undefined = pipedUserQuery.tab;
void pipedUserTab;

const userLink = Route.link(User);
userLink(
  { userId: "ada" },
  {
    query: { tab: "profile" },
    hash: "activity",
  },
);

// @ts-expect-error query tab is schema-limited
userLink({ userId: "ada" }, { query: { tab: "billing" } });

const ViewBacked = Component.make<
  {},
  never,
  never,
  { readonly slots: { readonly root: Element.Container } }
>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({ slots: { root: Element.container() } }),
  (_props, bindings) => View.make(bindings.slots, null, {
    slotMetadata: {
      root: View.slot("root", { capability: Element.Capability.Container }),
    },
  }),
);

const LegacyViewRoute = ViewBacked.pipe(Component.route("/typed-view"));
type LegacyViewRouteSlots = Component.SlotsOf<typeof LegacyViewRoute>;
type _LegacyViewRouteSlots = Expect<Equal<LegacyViewRouteSlots, Component.SlotsOf<typeof ViewBacked>>>;
const legacyViewRouteEffect = Component.renderViewEffect(LegacyViewRoute, {});
type LegacyViewRouteResult = typeof legacyViewRouteEffect extends Effect.Effect<infer A, any, any> ? A : never;
type _LegacyViewRouteResult = Expect<Equal<LegacyViewRouteResult, View.View<LegacyViewRouteSlots> | undefined>>;

const ViewRouteNode = Route.page("/typed-node-view", ViewBacked).pipe(Route.id("typed.node.view"));
const MaterializedViewRoute = Route.componentOf(ViewRouteNode);
type MaterializedViewRouteSlots = Component.SlotsOf<typeof MaterializedViewRoute>;
type _MaterializedViewRouteSlots = Expect<Equal<MaterializedViewRouteSlots, Component.SlotsOf<typeof ViewBacked>>>;
const materializedViewRouteEffect = Component.renderViewEffect(MaterializedViewRoute, {});
type MaterializedViewRouteResult = typeof materializedViewRouteEffect extends Effect.Effect<infer A, any, any> ? A : never;
type _MaterializedViewRouteResult = Expect<Equal<MaterializedViewRouteResult, View.View<MaterializedViewRouteSlots> | undefined>>;
