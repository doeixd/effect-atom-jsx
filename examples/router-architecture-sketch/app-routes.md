# App Routes Sketch

```ts
import { Effect, Schema } from "effect";
import { Component, Route } from "effect-atom-jsx";
import { UsersService, type User } from "./domain-services.js";

const RootLayout = Component.from<{}>(() => (
  <div>
    <header>My App</header>
    <main>
      <Route.Outlet />
    </main>
  </div>
));

const HomePage = Component.from<{}>(() => <section>Home</section>);
const UsersView = Component.from<{}>(() => null);
const UserView = Component.from<{}>(() => null);
const UserSettingsView = Component.from<{}>(() => null);

const UserParams = Schema.Struct({ userId: Schema.String });

export const UsersPage = Route.page("/users", UsersView).pipe(
  Route.id("users.index"),
  Route.title("Users"),
  Route.loader(() => Effect.gen(function* () {
    const users = yield* UsersService;
    return yield* users.list();
  })),
);

export const UserPage = Route.page("/users/:userId", UserView).pipe(
  Route.id("users.detail"),
  Route.paramsSchema(UserParams),
  Route.loader((params: { readonly userId: string }) => Effect.gen(function* () {
    const users = yield* UsersService;
    return yield* users.byId(params.userId);
  })),
  Route.title((params, user) => user ? user.name : params.userId),
);

export const UserSettingsPage = Route.page("settings", UserSettingsView).pipe(
  Route.id("users.settings"),
  Route.loader(() => Effect.succeed({ section: "settings" as const })),
);

export const appRoutes = Route.define(
  Route.layout(RootLayout).pipe(
    Route.id("root"),
    Route.children([
      Route.index(HomePage).pipe(Route.id("home")),
      Route.ref(UsersPage),
      Route.mount(UserPage, [Route.ref(UserSettingsPage)]),
    ]),
  ),
);

type UserPageParams = Route.ParamsOf<typeof UserPage>;
type UserPageData = Route.LoaderDataOf<typeof UserPage>;
```

Notes:

- route identity lives on first-class route nodes (`Route.page`, `Route.layout`, `Route.index`)
- components attach to route nodes instead of acting as the only route anchor
- constructors establish identity; pipes attach behavior
- route-node pipes preserve params/loader inference without requiring casts in examples
- route references remain exportable and type-safe
