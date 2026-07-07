import { Atom, Component, Reactivity, Route, WithLayer, Async, Show, For, Loading, Errored, FetchResult } from "effect-atom-jsx";
import { Effect, Layer, Schema, ServiceMap } from "effect";

// ─── Domain Types ─────────────────────────────────────────────────────────────

type User = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly bio: string;
};

type Team = {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
};

type UserNotFound = { readonly _tag: "UserNotFound"; readonly id: string };
type TeamNotFound = { readonly _tag: "TeamNotFound"; readonly id: string };

// ─── Domain Services ──────────────────────────────────────────────────────────

const UsersService = ServiceMap.Service<{
  readonly list: () => Effect.Effect<ReadonlyArray<User>>;
  readonly byId: (id: string) => Effect.Effect<User, UserNotFound>;
  readonly search: (query: string) => Effect.Effect<ReadonlyArray<User>>;
  readonly update: (id: string, updates: { readonly name?: string; readonly bio?: string }) => Effect.Effect<User, UserNotFound>;
}>("UsersService");

const TeamsService = ServiceMap.Service<{
  readonly list: () => Effect.Effect<ReadonlyArray<Team>>;
  readonly byId: (id: string) => Effect.Effect<Team, TeamNotFound>;
}>("TeamsService");

// ─── In-Memory State ──────────────────────────────────────────────────────────

const usersState = Atom.value<ReadonlyArray<User>>([
  { id: "alice", name: "Alice", email: "alice@example.com", bio: "Enjoys shipping zero-waterfall UX." },
  { id: "bob", name: "Bob", email: "bob@example.com", bio: "Keeps route state and cache in sync." },
  { id: "charlie", name: "Charlie", email: "charlie@example.com", bio: "Loves Effect-native reactivity." },
]);

const teamsState = Atom.value<ReadonlyArray<Team>>([
  { id: "platform", name: "Platform", memberCount: 5 },
  { id: "frontend", name: "Frontend", memberCount: 8 },
  { id: "backend", name: "Backend", memberCount: 6 },
]);

const usersWithReactivity = usersState.pipe(Atom.withReactivity(["users"]));
const teamsWithReactivity = teamsState.pipe(Atom.withReactivity(["teams"]));

// ─── Service Implementations ──────────────────────────────────────────────────

const UsersLive = Layer.succeed(UsersService, {
  list: () => Reactivity.tracked(
    Effect.sync(() => usersWithReactivity()),
    { keys: ["users"] },
  ),
  byId: (id: string) => Reactivity.tracked(
    Effect.gen(function* () {
      const users = yield* Effect.sync(() => usersWithReactivity());
      const user = users.find((u) => u.id === id);
      if (!user) return yield* Effect.fail<UserNotFound>({ _tag: "UserNotFound", id });
      return user;
    }),
    { keys: ["users", `user:${id}`] },
  ),
  search: (query: string) => Reactivity.tracked(
    Effect.sync(() => {
      const users = usersWithReactivity();
      const q = query.toLowerCase();
      return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }),
    { keys: ["users"] },
  ),
  update: (id: string, updates: { readonly name?: string; readonly bio?: string }) =>
    Reactivity.invalidating(
      Effect.gen(function* () {
        const users = yield* Effect.sync(() => usersState());
        const user = users.find((u) => u.id === id);
        if (!user) return yield* Effect.fail<UserNotFound>({ _tag: "UserNotFound", id });
        const updated: User = { ...user, ...updates };
        usersState.update((prev) => prev.map((u) => u.id === id ? updated : u));
        return updated;
      }),
      (user) => ["users", `user:${user.id}`],
    ),
});

const TeamsLive = Layer.succeed(TeamsService, {
  list: () => Reactivity.tracked(
    Effect.sync(() => teamsWithReactivity()),
    { keys: ["teams"] },
  ),
  byId: (id: string) => Reactivity.tracked(
    Effect.gen(function* () {
      const teams = yield* Effect.sync(() => teamsWithReactivity());
      const team = teams.find((t) => t.id === id);
      if (!team) return yield* Effect.fail<TeamNotFound>({ _tag: "TeamNotFound", id });
      return team;
    }),
    { keys: ["teams", `team:${id}`] },
  ),
});

// ─── Route Schemas ────────────────────────────────────────────────────────────

const UserParams = Schema.Struct({ userId: Schema.String });
const TeamParams = Schema.Struct({ teamId: Schema.String });
const SearchQuery = Schema.Struct({
  q: Schema.optional(Schema.String),
  page: Schema.optional(Schema.NumberFromString),
});

// ─── Route Nodes ──────────────────────────────────────────────────────────────

const HomeView = Component.from<{}>(() => (
  <section>
    <h2>Welcome</h2>
    <p>This example demonstrates the route-node golden path:</p>
    <ul>
      <li>First-class route nodes with <code>Route.page</code>, <code>Route.layout</code>, <code>Route.index</code></li>
      <li>Typed params/query/hash with Effect Schema</li>
      <li>Loaders that use domain services</li>
      <li>Typed links with <code>Route.link</code></li>
      <li>Nested route trees with <code>Route.define</code>, <code>Route.children</code>, <code>Route.mount</code></li>
      <li>Error handling with <code>Async</code>, <code>Loading</code>, <code>Errored</code></li>
      <li>Head metadata with <code>Route.title</code> and <code>Route.meta</code></li>
    </ul>
  </section>
));

const HomePage = Route.index(HomeView).pipe(Route.id("home"), Route.title("Home"));

const UsersListView = Component.make(
  Component.props<{}>(),
  Component.require<Route.RouteContext<any, any, any> | Route.RouterService>(),
  () => Effect.gen(function* () {
    const users = yield* Route.loaderResult<ReadonlyArray<User>>();
    const searchQuery = yield* Route.queryAtom("q", Schema.String, { default: "" });
    return { users, searchQuery };
  }),
  (_props, b) => (
    <section>
      <h2>Users</h2>
      <input
        type="text"
        value={b.searchQuery()}
        onInput={(e: InputEvent) => b.searchQuery.set((e.currentTarget as HTMLInputElement).value)}
        placeholder="Search users..."
      />
      <Async
        result={b.users()}
        loading={() => <p>Loading users...</p>}
        error={() => <p>Unable to load users.</p>}
        success={(list) => (
          <ul>
            {list.map((user) => (
                <li>
                  <a href={userLink({ userId: user.id })}>{user.name}</a>
                  {" — "}
                  <span>{user.email}</span>
                </li>
            ))}
          </ul>
        )}
      />
    </section>
  ),
);

const UsersListPage = Route.page("/users", UsersListView).pipe(
  Route.id("users.index"),
  Route.querySchema(SearchQuery),
  Route.loader(() => Effect.gen(function* () {
    const users = yield* UsersService;
    return yield* users.list();
  })),
  Route.title("Users"),
  Route.meta({ description: "List of all users" }),
);

const UserDetailView = Component.make(
  Component.props<{}>(),
  Component.require<Route.RouteContext<any, any, any>>(),
  () => Effect.gen(function* () {
    const userResult = yield* Route.loaderResult<User, UserNotFound>();
    return { userResult };
  }),
  (_props, b) => (
    <section>
      <Async
        result={b.userResult()}
        loading={() => <p>Loading user...</p>}
        success={(user) => (
          <div>
            <h2>{user.name}</h2>
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Bio:</strong> {user.bio}</p>
            <a href={usersLink({})}>← Back to users</a>
          </div>
        )}
        error={(err) => (
          <div>
            <h2>User Not Found</h2>
            <p>No user with ID {"id" in err ? err.id : "unknown"} exists.</p>
            <a href={usersLink({})}>← Back to users</a>
          </div>
        )}
      />
    </section>
  ),
);

const UserDetailWithLoader = Route.page("/users/:userId", UserDetailView).pipe(
  Route.id("users.detail"),
  Route.paramsSchema(UserParams),
  Route.loader((params: { readonly userId: string }) => Effect.gen(function* () {
    const users = yield* UsersService;
    return yield* users.byId(params.userId);
  })),
);

const UserDetailPage = UserDetailWithLoader.pipe(
  Route.title<typeof UserDetailWithLoader>((params, user) => user ? user.name : `User ${params.userId}`),
  Route.meta<typeof UserDetailWithLoader>((params, user) => ({
    description: user ? `Profile for ${user.name}` : `User ${params.userId}`,
  })),
);

const TeamsListView = Component.make(
  Component.props<{}>(),
  Component.require<Route.RouteContext<any, any, any>>(),
  () => Effect.gen(function* () {
    const teams = yield* Route.loaderResult<ReadonlyArray<Team>>();
    return { teams };
  }),
  (_props, b) => (
    <section>
      <h2>Teams</h2>
      <Async
        result={b.teams()}
        loading={() => <p>Loading teams...</p>}
        error={() => <p>Unable to load teams.</p>}
        success={(list) => (
          <ul>
            {list.map((team) => (
                <li>
                  <a href={teamLink({ teamId: team.id })}>{team.name}</a>
                  {" — "}
                  <span>{team.memberCount} members</span>
                </li>
            ))}
          </ul>
        )}
      />
    </section>
  ),
);

const TeamsListPage = Route.page("/teams", TeamsListView).pipe(
  Route.id("teams.index"),
  Route.loader(() => Effect.gen(function* () {
    const teams = yield* TeamsService;
    return yield* teams.list();
  })),
  Route.title("Teams"),
  Route.meta({ description: "List of all teams" }),
);

const TeamDetailView = Component.make(
  Component.props<{}>(),
  Component.require<Route.RouteContext<any, any, any>>(),
  () => Effect.gen(function* () {
    const teamResult = yield* Route.loaderResult<Team, TeamNotFound>();
    return { teamResult };
  }),
  (_props, b) => (
    <section>
      <Async
        result={b.teamResult()}
        loading={() => <p>Loading team...</p>}
        success={(team) => (
          <div>
            <h2>{team.name}</h2>
            <p><strong>Members:</strong> {team.memberCount}</p>
            <a href={teamsLink({})}>← Back to teams</a>
          </div>
        )}
        error={(err) => (
          <div>
            <h2>Team Not Found</h2>
            <p>No team with ID {"id" in err ? err.id : "unknown"} exists.</p>
            <a href={teamsLink({})}>← Back to teams</a>
          </div>
        )}
      />
    </section>
  ),
);

const TeamDetailWithLoader = Route.page("/teams/:teamId", TeamDetailView).pipe(
  Route.id("teams.detail"),
  Route.paramsSchema(TeamParams),
  Route.loader((params: { readonly teamId: string }) => Effect.gen(function* () {
    const teams = yield* TeamsService;
    return yield* teams.byId(params.teamId);
  })),
);

const TeamDetailPage = TeamDetailWithLoader.pipe(
  Route.title<typeof TeamDetailWithLoader>((params, team) => team ? team.name : `Team ${params.teamId}`),
);

// ─── Route Tree ───────────────────────────────────────────────────────────────

const RootLayoutView = Component.from<{}>(() => (
    <div style="font-family: ui-sans-serif, system-ui; margin: 0 auto; max-width: 960px; padding: 24px;">
      <header style="border-bottom: 1px solid #ccc; margin-bottom: 24px; padding-bottom: 12px;">
        <h1 style="margin: 0;">Router Golden Path</h1>
        <nav style="margin-top: 12px;">
          <a href={homeLink({})} style="margin-right: 16px;">Home</a>
          <a href={usersLink({})} style="margin-right: 16px;">Users</a>
          <a href={teamsLink({})}>Teams</a>
        </nav>
      </header>
    </div>
));

const RootLayout = Route.layout(RootLayoutView).pipe(Route.id("root"));

export const appRoutes = Route.define(
  RootLayout.pipe(
    Route.children([
      HomePage,
      Route.ref(UsersListPage),
      Route.mount(UserDetailPage, []),
      Route.ref(TeamsListPage),
      Route.mount(TeamDetailPage, []),
    ]),
  ),
);

// ─── Typed Links ──────────────────────────────────────────────────────────────

const homeLink = Route.link(HomePage);
const usersLink = Route.link(UsersListPage);
const userLink = Route.link(UserDetailPage);
const teamsLink = Route.link(TeamsListPage);
const teamLink = Route.link(TeamDetailPage);

// ─── App Component ────────────────────────────────────────────────────────────

export function App() {
  return (
    <WithLayer layer={Layer.mergeAll(Route.Router.Browser, UsersLive, TeamsLive)}>
      {() => (
        <Route.Switch
          fallback={<p>404 — Page not found</p>}
          children={[
            Route.componentOf(HomePage)({}),
            Route.componentOf(UsersListPage)({}),
            Route.componentOf(UserDetailPage)({}),
            Route.componentOf(TeamsListPage)({}),
            Route.componentOf(TeamDetailPage)({}),
          ]}
        />
      )}
    </WithLayer>
  );
}
