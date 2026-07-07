import { Component, Route, WithLayer } from "effect-atom-jsx";
import { Schema } from "effect";

const HomeBase = Route.page(
  "/",
  Component.from<{}>(() => (
    <section>
      <h2>Home</h2>
      <p>Welcome to the router basic example.</p>
    </section>
  )),
);
const Home = HomeBase.pipe(
  Route.title<typeof HomeBase>(() => "Home"),
  Route.meta<typeof HomeBase>(() => ({ description: "Router basic home route" })),
);

const UsersBase = Route.page(
  "/users",
  Component.from<{}>(() => (
    <section>
      <h2>Users</h2>
      <ul>
        <li><a href={userLink({ userId: "alice" })}>Alice</a></li>
        <li><a href={userLink({ userId: "bob" })}>Bob</a></li>
      </ul>
    </section>
  )),
);
const Users = UsersBase.pipe(
  Route.title<typeof UsersBase>(() => "Users"),
  Route.meta<typeof UsersBase>(() => ({ description: "Users list route", keywords: ["users", "list"] })),
);

const UserProfileBase = Route.page(
  "/users/:userId",
  Component.make(
    Component.props<{}>(),
    Component.require<Route.RouteContext<any, any, any>>(),
    () => Route.params,
    (_props, params: { userId?: string }) => (
      <section>
        <h2>User Profile</h2>
        <p>Current user: {params.userId ?? "(missing)"}</p>
      </section>
    ),
  ),
).pipe(
  Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
);
const UserProfile = UserProfileBase.pipe(
  Route.title<typeof UserProfileBase>((params) => `Profile: ${params.userId}`),
  Route.meta<typeof UserProfileBase>((params) => ({
    description: `User profile for ${params.userId}`,
    keywords: ["users", "profile", params.userId],
  })),
);

const homeLink = Route.link(Home);
const usersLink = Route.link(Users);
const userLink = Route.link(UserProfile);

const HomeView = Route.componentOf(Home);
const UsersView = Route.componentOf(Users);
const UserProfileView = Route.componentOf(UserProfile);

export function App() {
  return (
    <WithLayer layer={Route.Router.Browser}>
      {() => (
        <main style="font-family: ui-sans-serif, system-ui; margin: 0 auto; max-width: 760px; padding: 24px;">
          <h1>Router Basic</h1>
          <p>
            <a href={homeLink({})}>Home</a>
            {" · "}
            <a href={usersLink({})}>Users</a>
            {" · "}
            <a href={userLink({ userId: "alice" })}>Alice</a>
          </p>

          <Route.Switch
            fallback={<p>No route matched.</p>}
            children={[
              HomeView({}),
              UsersView({}),
              UserProfileView({}),
            ]}
          />
        </main>
      )}
    </WithLayer>
  );
}
