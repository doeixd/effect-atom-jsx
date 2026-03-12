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
  { id: "alice", name: "Alice", bio: "Fetch transport demo user." },
  { id: "bob", name: "Bob", bio: "Updated through a fetch-backed adapter." },
]);

const usersStore = usersState.pipe(Atom.withReactivity(["users"]));

const UsersService = ServiceMap.Service<{
  readonly list: () => Effect.Effect<ReadonlyArray<User>>;
  readonly byId: (id: string) => Effect.Effect<User>;
  readonly rename: (input: SaveUserInput) => Effect.Effect<User>;
}>("Example:UsersService:Fetch");

const UsersLive = Layer.succeed(UsersService, {
  list: () => Reactivity.tracked(Effect.sync(() => usersStore()), { keys: ["users"] }),
  byId: (id: string) => Reactivity.tracked(
    Effect.sync(() => usersStore().find((user) => user.id === id) ?? { id, name: "Unknown", bio: "Missing user" }),
    { keys: ["users", `user:${id}`] },
  ),
  rename: (input: SaveUserInput) => Reactivity.invalidating(
    Effect.sync(() => {
      const nextUser: User = {
        id: input.id,
        name: input.name,
        bio: `Saved through fetch transport at ${new Date().toLocaleTimeString()}.`,
      };
      usersState.update((prev) => prev.map((user) => user.id === input.id ? nextUser : user));
      return nextUser;
    }),
    (user) => ["users", `user:${user.id}`],
  ),
});

const Home = Component.from<{}>(() => (
  <section>
    <h2>Fetch Transport Demo</h2>
    <p>
      This version installs `Route.FetchSingleFlightTransport(...)` and routes a fetch-style request to a single-flight handler.
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

const UserPageBase = Component.make(
  Component.props<{}>(),
  Component.require<Route.RouteContext<any, any, any>>(),
  () => Effect.gen(function* () {
    const user = yield* Route.loaderData<User>();
    return { user };
  }),
  (_props, b: { readonly user: () => User }) => (
    <section>
      <h2>{b.user().name}</h2>
      <p>{b.user().bio}</p>
      <button
        onClick={() => {
          const current = b.user();
          void Effect.runPromise(saveUser.runEffect({
            id: current.id,
            name: current.name.endsWith("!") ? current.name.replace(/!+$/, "") : `${current.name}!`,
          }));
        }}
      >
        Toggle Exclamation
      </button>
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

const FetchTransportLive = Route.FetchSingleFlightTransport({
  endpoint: (request) => request.name ? `/_single-flight/${request.name}` : undefined,
  fetch: async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Route.SingleFlightRequest<[SaveUserInput]>;
    if (input !== "/_single-flight/save-user") {
      return { json: async () => ({ ok: false as const, error: { message: `Unknown endpoint: ${input}` } }) };
    }
    const response = await Effect.runPromise(saveUserHandler(body).pipe(Effect.provide(UsersLive)));
    return { json: async () => response };
  },
});

const saveUser = Atom.action(
  (input: SaveUserInput) => Effect.succeed(input),
  { name: "save-user" },
);

const homeLink = Route.link(Home);
const usersLink = Route.link(UsersList);
const userLink = Route.link(UserPage);

export function App() {
  return (
    <WithLayer layer={Layer.mergeAll(Route.Router.Browser, UsersLive, FetchTransportLive)}>
      {() => (
        <main style="font-family: 'Segoe UI', sans-serif; margin: 0 auto; max-width: 760px; padding: 24px; line-height: 1.5;">
          <h1>Router Single-Flight Fetch</h1>
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
