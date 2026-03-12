import { Atom, Component, Reactivity, Route, WithLayer } from "../../src/index.js";
import { Effect, Layer, Schema, ServiceMap } from "effect";

type User = {
  readonly id: string;
  readonly name: string;
  readonly bio: string;
};

type SaveUserInput = {
  readonly id: string;
  readonly name: string;
};

const usersState = Atom.value<ReadonlyArray<User>>([
  { id: "alice", name: "Alice", bio: "Enjoys shipping zero-waterfall UX." },
  { id: "bob", name: "Bob", bio: "Keeps route state and cache in sync." },
]);

const usersStore = usersState.pipe(Atom.withReactivity(["users"]));

const UsersService = ServiceMap.Service<{
  readonly list: () => Effect.Effect<ReadonlyArray<User>>;
  readonly byId: (id: string) => Effect.Effect<User>;
  readonly rename: (input: SaveUserInput) => Effect.Effect<User>;
}>("Example:UsersService");

const UsersLive = Layer.succeed(UsersService, {
  list: () => Reactivity.tracked(
    Effect.sync(() => usersStore()),
    { keys: ["users"] },
  ),
  byId: (id: string) => Reactivity.tracked(
    Effect.sync(() => usersStore().find((user) => user.id === id) ?? {
      id,
      name: "Unknown",
      bio: "Missing user",
    }),
    { keys: ["users", `user:${id}`] },
  ),
  rename: (input: SaveUserInput) => Reactivity.invalidating(
    Effect.sync(() => {
      const nextUser: User = {
        id: input.id,
        name: input.name,
        bio: `Updated at ${new Date().toLocaleTimeString()}.`,
      };
      usersState.update((prev) => prev.map((user) => user.id === input.id ? nextUser : user));
      return nextUser;
    }),
    (user) => ["users", `user:${user.id}`],
  ),
});

const Home = Component.from<{}>(() => (
  <section>
    <h2>Single-Flight Demo</h2>
    <p>
      This example uses a service-first design: loaders `yield*` a domain service, the service uses `Reactivity.tracked(...)` for reads, and mutations use `Reactivity.invalidating(...)` for writes.
    </p>
  </section>
)).pipe(Component.route("/"));

const UsersList = Component.make(
  Component.props<{}>(),
  Component.require<Route.RouteContext<any, any, any>>(),
  () => Effect.gen(function* () {
    const users = yield* Route.loaderData<ReadonlyArray<User>>();
    return { users };
  }),
  (_props, b: { readonly users: () => ReadonlyArray<User> }) => (
    <section>
      <h2>Users</h2>
      <ul>
        {b.users().map((user) => (
          <li>
            <a href={userLink({ userId: user.id })}>{user.name}</a>
          </li>
        ))}
      </ul>
    </section>
  ),
).pipe(
  Component.route("/users"),
  Route.loader(() => Effect.gen(function* () {
    const users = yield* UsersService;
    return yield* users.list();
  })),
  Route.title("Users"),
);

const saveUser = Atom.action(
  (input: SaveUserInput) => Effect.succeed(input),
  { name: "save-user" },
);

const UserPageBase = Component.make(
  Component.props<{}>(),
  Component.require<Route.RouteContext<any, any, any>>(),
  () => Effect.gen(function* () {
    const user = yield* Route.loaderData<User>();
    return { user, pending: saveUser.pending };
  }),
  (_props, b: { readonly user: () => User; readonly pending: () => boolean }) => (
    <section>
      <h2>{b.user().name}</h2>
      <p>{b.user().bio}</p>
      <p>
        <button
          disabled={b.pending()}
          onClick={() => {
            const current = b.user();
            void Effect.runPromise(saveUser.runEffect({
              id: current.id,
              name: current.name.endsWith("!") ? current.name.replace(/!+$/, "") : `${current.name}!`,
            }));
          }}
        >
          {b.pending() ? "Saving..." : "Toggle Exclamation"}
        </button>
      </p>
      <p>
        Detail data is seeded directly from the mutation result, while list data refreshes through captured Reactivity dependencies.
      </p>
    </section>
  ),
).pipe(
  Component.route("/users/:userId", {
    params: Schema.Struct({ userId: Schema.String }),
  }),
  Route.loader((params: { readonly userId: string }) => Effect.gen(function* () {
    const users = yield* UsersService;
    return yield* users.byId(params.userId);
  })),
);

const UserPage = UserPageBase.pipe(Route.title("User"));

const saveUserHandler = Route.singleFlight(
  (input: SaveUserInput) => Effect.gen(function* () {
    const users = yield* UsersService;
    return yield* users.rename(input);
  }),
  {
    baseUrl: "http://example.local",
    target: (result) => `/users/${result.id}`,
    setLoaders: Route.seedLoader(UserPageBase as any),
  },
);

const SingleFlightTransportLive = Layer.succeed(Route.SingleFlightTransportTag, {
  execute: ((request: Route.SingleFlightRequest<[SaveUserInput]>) => {
    if (request.name !== "save-user") {
      return Effect.succeed({ ok: false as const, error: { message: `Unknown mutation: ${String(request.name ?? "")}` } });
    }
    return saveUserHandler(request).pipe(Effect.provide(UsersLive));
  }) as any,
});

const homeLink = Route.link(Home);
const usersLink = Route.link(UsersList);
const userLink = Route.link(UserPage);

export function App() {
  return (
    <WithLayer layer={Layer.mergeAll(Route.Router.Browser, UsersLive, SingleFlightTransportLive)}>
      {() => (
        <main style="font-family: 'Segoe UI', sans-serif; margin: 0 auto; max-width: 760px; padding: 24px; line-height: 1.5;">
          <h1>Router Single-Flight</h1>
          <p>
            <a href={homeLink({})}>Home</a>
            {" · "}
            <a href={usersLink({})}>Users</a>
            {" · "}
            <a href={userLink({ userId: "alice" })}>Alice</a>
            {" · "}
            <a href={userLink({ userId: "bob" })}>Bob</a>
          </p>
          <Route.Switch fallback={<p>No route matched.</p>} children={[Home({}), UsersList({}), UserPage({})]} />
        </main>
      )}
    </WithLayer>
  );
}
