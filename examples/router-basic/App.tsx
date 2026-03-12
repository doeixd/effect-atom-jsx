import { Component, Route, WithLayer } from "effect-atom-jsx";
import { Schema } from "effect";

const Home = Component.from<{}>(() => (
  <section>
    <h2>Home</h2>
    <p>Welcome to the router basic example.</p>
  </section>
)).pipe(
  Component.route("/"),
  Route.title("Home"),
  Route.meta({ description: "Router basic home route" }),
);

const Users = Component.from<{}>(() => (
  <section>
    <h2>Users</h2>
    <ul>
      <li><a href={userLink({ userId: "alice" })}>Alice</a></li>
      <li><a href={userLink({ userId: "bob" })}>Bob</a></li>
    </ul>
  </section>
)).pipe(
  Component.route("/users"),
  Route.title("Users"),
  Route.meta({ description: "Users list route", keywords: ["users", "list"] }),
);

const UserProfile = Component.make(
  Component.props<{}>(),
  Component.require<Route.RouteContext<any, any, any>>(),
  () => Route.params,
  (_props, params: { userId?: string }) => (
    <section>
      <h2>User Profile</h2>
      <p>Current user: {params.userId ?? "(missing)"}</p>
    </section>
  ),
).pipe(
  Component.route("/users/:userId", { params: Schema.Struct({ userId: Schema.String }) }),
  Route.title<{ userId: string }>((params) => `Profile: ${params.userId}`),
  Route.meta<{ userId: string }>((params) => ({
    description: `User profile for ${params.userId}`,
    keywords: ["users", "profile", params.userId],
  })),
);

const homeLink = Route.link(Home);
const usersLink = Route.link(Users);
const userLink = Route.link(UserProfile);

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
              Home({}),
              Users({}),
              UserProfile({}),
            ]}
          />
        </main>
      )}
    </WithLayer>
  );
}
