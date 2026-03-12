A router should be simple to add to the components? All you need is a URL (fragment) that must match for the component (and it's parents?) you could throw that in the component pipe? Asking with any other route metadata/options? Or maybe you could have a higher lel Route which wrap components ( if needed?) and you could create typesafe links from the component refs? It's not traditional. But it should seamlessly integrate, and get the job done? Also effect schema v4  has strong string parsing and url param encoding, and we could  use that. That's basically all we need? Flesh this out?Yes. A route is just a component with a URL pattern attached. The pattern has typed parameters parsed by Schema. Links are derived from route definitions so they're type-safe. The router itself is a service. Everything composes through the existing primitives.

**A route is a component with a pattern:**

```ts
const UserProfile = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const route = yield* Route.params;
    // route.userId is string — parsed and validated from the URL
    const user = yield* Component.query(() => api.findUser(route.userId));
    return { user };
  }),
  (props, { user }) => (
    <Async result={user()} success={(u) => <div>{u.name}</div>} />
  ),
).pipe(
  Component.route("/users/:userId"),
);
```

That's it. `Component.route("/users/:userId")` attaches a URL pattern to the component. The `:userId` segment becomes a typed parameter. The component only mounts when the URL matches. When the URL changes away, the component unmounts, its scope closes, fibers are interrupted, cleanup runs.

But a plain string pattern isn't type-safe. The params are just `Record<string, string>`. We can do better.

**Schema-typed route parameters:**

```ts
import { Schema } from "effect";

const UserProfile = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const { userId } = yield* Route.params;
    const user = yield* Component.query(() => api.findUser(userId));
    return { user };
  }),
  (props, { user }) => (
    <Async result={user()} success={(u) => <div>{u.name}</div>} />
  ),
).pipe(
  Component.route("/users/:userId", {
    params: Schema.Struct({
      userId: Schema.String.pipe(Schema.nonEmpty()),
    }),
  }),
);
```

Now `Route.params` inside the setup Effect returns `{ userId: string }` — typed, validated, non-empty. But we can go further with Schema v4's parsing:

```ts
Component.route("/users/:userId/posts/:postId", {
  params: Schema.Struct({
    userId: Schema.String.pipe(Schema.nonEmpty()),
    postId: Schema.NumberFromString.pipe(Schema.int(), Schema.positive()),
  }),
})
// Route.params yields { userId: string; postId: number }
// postId is automatically parsed from string to number via Schema
```

The URL contains `/users/alice/posts/42`. Schema parses `"42"` into `42` as a number. If the URL has `/users/alice/posts/abc`, the schema validation fails, and the route doesn't match — or it matches and renders an error boundary, depending on configuration.

**Query parameters with Schema:**

```ts
const UserList = Component.make(
  // ...
).pipe(
  Component.route("/users", {
    params: Schema.Struct({}),
    query: Schema.Struct({
      page: Schema.optional(Schema.NumberFromString, { default: () => 1 }),
      sort: Schema.optional(
        Schema.Literal("name", "date", "email"),
        { default: () => "name" as const },
      ),
      search: Schema.optional(Schema.String),
      active: Schema.optional(Schema.BooleanFromString, { default: () => true }),
    }),
  }),
);

// Inside setup:
(props) => Effect.gen(function* () {
  const { page, sort, search, active } = yield* Route.query;
  // page: number (default 1)
  // sort: "name" | "date" | "email" (default "name")
  // search: string | undefined
  // active: boolean (default true)

  const users = yield* Component.query(
    () => api.listUsers({ page, sort, search, active }),
  );
  return { users, page, sort, search, active };
})
```

URL `/users?page=3&sort=date&active=false` is parsed into typed values. Missing params get defaults. Invalid values fail validation. Schema v4's `NumberFromString`, `BooleanFromString`, and `Literal` handle all the parsing.

**Hash/fragment support:**

```ts
Component.route("/docs/:section", {
  params: Schema.Struct({
    section: Schema.String,
  }),
  hash: Schema.optional(Schema.String),
})

// /docs/getting-started#installation
// params: { section: "getting-started" }
// hash: "installation"
```

**Route as a service:**

The current route state is a service. Components `yield*` it to read params, query, hash, and the full URL:

```ts
class Route extends Effect.Tag("Route")<Route, {
  // Typed params — type depends on the route's schema
  readonly params: ReadonlyAtom<RouteParams>;

  // Typed query — type depends on the route's query schema
  readonly query: ReadonlyAtom<RouteQuery>;

  // Hash fragment
  readonly hash: ReadonlyAtom<string | undefined>;

  // Full URL
  readonly url: ReadonlyAtom<URL>;

  // Navigation
  readonly navigate: (to: string | RouteRef, options?: NavigateOptions) => Effect.Effect<void>;

  // Reactive path matching
  readonly matches: (pattern: string) => ReadonlyAtom<boolean>;
}>() {}
```

But the generic `Route` service has untyped params. The magic is that `Component.route(pattern, { params: schema })` creates a narrowed route service for that specific component. Inside the component's setup, `yield* Route.params` returns the schema's output type, not `Record<string, string>`.

How this works at the type level:

```ts
// Component.route creates a RouteBinding that narrows the Route service
declare function route<P, Q>(
  pattern: string,
  options: {
    params: Schema.Schema<P>;
    query?: Schema.Schema<Q>;
  },
): <Props, Req, E>(
  component: Component<Props, Req, E>,
) => RoutedComponent<Props, Req, E, P, Q>;

// Inside a RoutedComponent's setup, Route.params yields P
// and Route.query yields Q
```

The component's setup Effect sees a narrowed `Route` service where `.params` returns `P` (the params schema output) and `.query` returns `Q` (the query schema output). This is enforced by the type system — you can't access params that aren't in your route's schema.

**Nested routes — route trees:**

Routes compose through the component tree. A parent route matches a prefix, child routes match the rest:

```ts
const UsersLayout = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const stats = yield* Component.query(() => api.getUserStats());
    return { stats };
  }),
  (props, { stats }) => (
    <div class="users-layout">
      <Sidebar stats={stats()} />
      <Route.Outlet />
    </div>
  ),
).pipe(
  Component.route("/users"),
);

const UserList = Component.make(
  // ...list component...
).pipe(
  Component.route("/", {
    // matches /users/ (the parent already matched /users)
    query: Schema.Struct({
      page: Schema.optional(Schema.NumberFromString, { default: () => 1 }),
    }),
  }),
);

const UserProfile = Component.make(
  // ...profile component...
).pipe(
  Component.route("/:userId", {
    params: Schema.Struct({
      userId: Schema.String.pipe(Schema.nonEmpty()),
    }),
  }),
);

const UserSettings = Component.make(
  // ...settings component...
).pipe(
  Component.route("/:userId/settings", {
    params: Schema.Struct({
      userId: Schema.String.pipe(Schema.nonEmpty()),
    }),
  }),
);
```

The route tree:

```
/users              → UsersLayout (always mounts when /users/*)
  /                 → UserList (mounts at /users/)
  /:userId          → UserProfile (mounts at /users/alice)
  /:userId/settings → UserSettings (mounts at /users/alice/settings)
```

`Route.Outlet` is where child routes render. The parent provides layout, the outlet swaps based on the URL. This is the standard nested routing pattern but expressed through components and pipes.

**Defining the route tree explicitly:**

```ts
const router = Route.tree(
  Route.layout(UsersLayout, [
    Route.index(UserList),
    Route.path(UserProfile),
    Route.path(UserSettings),
  ]),
  Route.path(
    Component.make(/* ... */).pipe(Component.route("/about")),
  ),
  Route.path(
    Component.make(/* ... */).pipe(Component.route("/settings")),
  ),
);

// Mount with router
Component.mount(App, {
  layer: Layer.mergeAll(AppLive, router.layer),
  target: root,
});
```

`router.layer` provides the `Route` service. It handles URL listening, pattern matching, and param parsing.

**Type-safe links — the killer feature:**

If routes are defined with schemas, links can be derived from route definitions. You can't create an invalid link:

```ts
// Route.link creates a typed link factory from a routed component
const userProfileLink = Route.link(UserProfile);
const userSettingsLink = Route.link(UserSettings);
const userListLink = Route.link(UserList);

// Type-safe link creation
userProfileLink({ userId: "alice" })
// → "/users/alice"

userProfileLink({ userId: "" })
// Runtime error: Schema validation failed — userId must be non-empty

userProfileLink({})
// Compile error: Property 'userId' is missing

userProfileLink({ userId: "alice", bogus: true })
// Compile error: 'bogus' does not exist in { userId: string }

userSettingsLink({ userId: "alice" })
// → "/users/alice/settings"

userListLink({}, { query: { page: 3, sort: "date" } })
// → "/users/?page=3&sort=date"

userListLink({}, { query: { page: "three" } })
// Compile error: Type 'string' is not assignable to type 'number'
```

The link factory's type is derived from the route's param and query schemas:

```ts
// Route.link extracts param and query types from the routed component
declare function link<P, Q>(
  route: RoutedComponent<any, any, any, P, Q>,
): (
  params: P,
  options?: { query?: Partial<Q>; hash?: string },
) => string;
```

Schema v4's encoding handles the reverse — converting typed values back to URL strings:

```ts
userListLink({}, { query: { page: 3, sort: "date", active: false } })
// Schema.NumberFromString encodes 3 → "3"
// Schema.BooleanFromString encodes false → "false"
// Schema.Literal encodes "date" → "date"
// → "/users/?page=3&sort=date&active=false"
```

**Link component with type safety:**

```tsx
// Route.Link is a typed component that renders an anchor
<Route.Link to={userProfileLink} params={{ userId: "alice" }}>
  View Alice's Profile
</Route.Link>

// Compiles to <a href="/users/alice">View Alice's Profile</a>
// with client-side navigation on click

// With query params
<Route.Link
  to={userListLink}
  params={{}}
  query={{ page: 3, sort: "date" }}
>
  Page 3
</Route.Link>
// → <a href="/users/?page=3&sort=date">Page 3</a>

// Type errors for invalid params
<Route.Link to={userProfileLink} params={{ userId: 42 }}>
// Error: Type 'number' is not assignable to type 'string'

<Route.Link to={userProfileLink} params={{}}>
// Error: Property 'userId' is missing
```

`Route.Link` is a component. Its props are typed based on the route it points to. The Babel compiler sees `to={userProfileLink}` and narrows the `params` prop type to match `UserProfile`'s param schema.

**Programmatic navigation with type safety:**

```ts
const UserProfile = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const route = yield* Route;
    const { userId } = yield* Route.params;

    const user = yield* Component.query(() => api.findUser(userId));

    const deleteUser = yield* Component.action(
      Effect.fn(function* () {
        yield* api.deleteUser(userId);
        // Navigate after deletion — type-safe
        yield* route.navigate(userListLink({}));
      }),
    );

    // Or navigate to another profile — type-safe
    const viewOther = (otherId: string) =>
      Effect.gen(function* () {
        yield* route.navigate(userProfileLink({ userId: otherId }));
      });

    return { user, deleteUser, viewOther };
  }),
  // ...
);
```

`route.navigate` accepts a string (from a link factory) or a route ref directly:

```ts
// String form — from link factory
yield* route.navigate(userProfileLink({ userId: "bob" }));

// Route ref form — also type-safe
yield* route.navigate(UserProfile, { userId: "bob" });
// Overload checks: does { userId: "bob" } match UserProfile's param schema?

// With options
yield* route.navigate(UserProfile, { userId: "bob" }, {
  replace: true,        // replace history entry instead of push
  scroll: "top",        // scroll to top after navigation
  query: {},            // query params
  hash: "details",      // hash fragment
});
```

**Route guards as Effects:**

Route guards are just Effects that run before a route's component mounts. They can redirect, check permissions, or load data:

```ts
const UserSettings = Component.make(
  // ...
).pipe(
  Component.route("/:userId/settings", {
    params: Schema.Struct({
      userId: Schema.String,
    }),
  }),
  Route.guard((params) => Effect.gen(function* () {
    const auth = yield* Auth;
    const currentUser = yield* auth.currentUser();

    if (currentUser.id !== params.userId && currentUser.role !== "admin") {
      // Redirect — type-safe link
      yield* Route.redirect(userProfileLink({ userId: params.userId }));
    }
  })),
);
```

`Route.guard` receives the parsed params and returns an Effect. If the Effect succeeds, the route mounts. If it redirects, the router navigates elsewhere. If it fails, the route's error boundary handles it. The guard's requirements (`Auth` in this case) add to the route's `R` type.

Guards compose through pipes:

```ts
const requireAuth = Route.guard(() => Effect.gen(function* () {
  const auth = yield* Auth;
  const user = yield* auth.currentUser();
  if (!user) yield* Route.redirect(loginLink({}));
}));

const requireAdmin = Route.guard(() => Effect.gen(function* () {
  const auth = yield* Auth;
  const user = yield* auth.currentUser();
  if (user.role !== "admin") yield* Route.redirect(homeLink({}));
}));

const AdminPanel = Component.make(/* ... */).pipe(
  Component.route("/admin"),
  requireAuth,
  requireAdmin,
);
```

**Route metadata and loading states:**

```ts
const UserProfile = Component.make(/* ... */).pipe(
  Component.route("/:userId", {
    params: Schema.Struct({
      userId: Schema.String,
    }),
    meta: {
      title: (params) => `User: ${params.userId}`,
      description: "User profile page",
      breadcrumb: (params) => ({ label: params.userId, parent: userListLink({}) }),
    },
    loading: () => <ProfileSkeleton />,
    error: (cause) => <RouteErrorPage cause={cause} />,
  }),
);
```

Meta functions receive typed params. `title` can set `document.title` on navigation. `breadcrumb` builds a typed breadcrumb chain — each `parent` is a link factory call, so the breadcrumb trail is type-safe.

**Extracting all routes for static analysis:**

Because routes are components with metadata, you can extract the full route table:

```ts
const routes = Route.extractAll(router);
// [
//   { pattern: "/users", component: UsersLayout, params: Schema<{}>, query: undefined },
//   { pattern: "/users/", component: UserList, params: Schema<{}>, query: Schema<{ page: number; sort: ... }> },
//   { pattern: "/users/:userId", component: UserProfile, params: Schema<{ userId: string }>, query: undefined },
//   { pattern: "/users/:userId/settings", component: UserSettings, params: Schema<{ userId: string }>, query: undefined },
//   { pattern: "/about", component: About, params: Schema<{}>, query: undefined },
// ]
```

This enables generating a sitemap, type-checking all links at build time, generating API documentation, preloading all routes for SSG.

**Type-safe link validation at build time:**

```ts
// A build-time check that all link usages match existing routes
Route.validateLinks(router, {
  onInvalidLink: (location, target) => {
    console.error(`Invalid link at ${location}: route ${target} not found`);
  },
  onInvalidParams: (location, target, params) => {
    console.error(`Invalid params at ${location}: ${target} expects ${params}`);
  },
});
```

But really, the TypeScript compiler already catches this. If `userProfileLink` is derived from `UserProfile`'s route, and `UserProfile` is in the router tree, any link usage is validated by the type checker. If you remove `UserProfile` from the router, every `userProfileLink(...)` call becomes a type error. Dead routes produce dead links, and the compiler tells you.

**Route-level code splitting:**

```ts
const UserProfile = Route.lazy(
  () => import("./UserProfile"),
  {
    pattern: "/:userId",
    params: Schema.Struct({ userId: Schema.String }),
    loading: () => <ProfileSkeleton />,
  },
);
```

`Route.lazy` creates a routed component from a dynamic import. The route pattern and params are defined upfront (so the router can match without loading the chunk), but the component code is loaded on demand. The `loading` component shows while the chunk loads.

The link factory still works for lazy routes because the pattern and schema are known statically:

```ts
const userProfileLink = Route.link(UserProfile);
// Works even though UserProfile's implementation is lazy-loaded
// The link factory only needs the pattern and schema, not the component code
userProfileLink({ userId: "alice" }) // → "/users/alice"
```

**Route-level data preloading:**

When the user hovers over a link, preload the route's data:

```ts
<Route.Link
  to={userProfileLink}
  params={{ userId: "alice" }}
  preload="hover"  // preload on hover
>
  View Profile
</Route.Link>
```

`preload="hover"` starts the route's queries when the user hovers the link. By the time they click, the data might already be cached. This works because queries are keyed and cached — preloading just starts the query early.

The preload behavior is an Effect that runs the route's setup in a detached scope:

```ts
// Internally, Route.Link with preload="hover"
onMouseEnter={() => {
  const preloadScope = yield* Scope.fork(routerScope);
  // Run the target component's queries without rendering
  yield* Component.preloadQueries(UserProfile, { userId: "alice" }).pipe(
    Effect.provideService(Scope, preloadScope),
    Effect.forkDaemon,
  );
}
```

**The Router service implementation:**

```ts
class Router extends Effect.Tag("Router")<Router, {
  // Current URL
  readonly url: ReadonlyAtom<URL>;

  // Parsed route state
  readonly current: ReadonlyAtom<{
    pattern: string;
    params: Record<string, unknown>;
    query: Record<string, unknown>;
    hash: string | undefined;
  }>;

  // Navigation
  readonly navigate: (to: string, options?: NavigateOptions) => Effect.Effect<void>;
  readonly back: () => Effect.Effect<void>;
  readonly forward: () => Effect.Effect<void>;

  // Route matching
  readonly matches: (pattern: string) => ReadonlyAtom<boolean>;

  // Preload a route's data
  readonly preload: <P>(route: RoutedComponent<any, any, any, P, any>, params: P) => Effect.Effect<void>;
}>() {}

// Browser implementation
const BrowserRouter = Layer.scoped(Router,
  Effect.gen(function* () {
    const url = Atom.make(new URL(window.location.href));

    // Listen to popstate — scoped cleanup
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const handler = () => url.set(new URL(window.location.href));
        window.addEventListener("popstate", handler);
        return handler;
      }),
      (handler) => Effect.sync(() =>
        window.removeEventListener("popstate", handler)
      ),
    );

    return {
      url,
      current: Atom.derived((get) => matchRoute(get(url), routeTable)),
      navigate: (to, options) => Effect.sync(() => {
        if (options?.replace) {
          window.history.replaceState(null, "", to);
        } else {
          window.history.pushState(null, "", to);
        }
        url.set(new URL(to, window.location.origin));
      }),
      back: () => Effect.sync(() => window.history.back()),
      forward: () => Effect.sync(() => window.history.forward()),
      matches: (pattern) => Atom.derived((get) =>
        matchPattern(pattern, get(url).pathname)
      ),
      preload: (route, params) => Effect.void, // implemented via query cache
    };
  })
);

// Server implementation — static URL from request
const ServerRouter = (request: Request) => Layer.succeed(Router, {
  url: Atom.make(new URL(request.url)),
  current: Atom.make(matchRoute(new URL(request.url), routeTable)),
  navigate: () => Effect.void, // no navigation on server
  back: () => Effect.void,
  forward: () => Effect.void,
  matches: (pattern) => Atom.make(matchPattern(pattern, new URL(request.url).pathname)),
  preload: () => Effect.void,
});

// Test implementation — manual URL control
const TestRouter = Layer.effect(Router,
  Effect.gen(function* () {
    const url = Atom.make(new URL("http://test.local/"));
    return {
      url,
      current: Atom.derived((get) => matchRoute(get(url), routeTable)),
      navigate: (to) => Effect.sync(() => url.set(new URL(to, "http://test.local"))),
      back: () => Effect.void,
      forward: () => Effect.void,
      matches: (pattern) => Atom.derived((get) =>
        matchPattern(pattern, get(url).pathname)
      ),
      preload: () => Effect.void,
    };
  })
);
```

Three router implementations — browser, server, test — swappable via layers. Components don't know which router they're using.

**Route transitions with Effect:**

When navigating between routes, you might want transition effects. Because navigation is an Effect, you can compose transitions:

```ts
const UserProfile = Component.make(/* ... */).pipe(
  Component.route("/:userId", {
    params: Schema.Struct({ userId: Schema.String }),
  }),
  Route.transition({
    enter: Effect.gen(function* () {
      yield* animate({ opacity: [0, 1], duration: 200 });
    }),
    exit: Effect.gen(function* () {
      yield* animate({ opacity: [1, 0], duration: 150 });
    }),
  }),
);
```

The exit transition runs before the old component's scope closes. The enter transition runs after the new component's setup completes. Both are Effects — they can be async, they can use services, they can be traced.

**Search params as atoms — two-way binding:**

A common pattern is syncing component state with URL query params. Schema makes this bidirectional:

```ts
const UserList = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const api = yield* Api;

    // Route.queryAtom creates a two-way binding between URL and atom state
    const page = yield* Route.queryAtom("page",
      Schema.NumberFromString.pipe(Schema.int(), Schema.positive()),
      { default: 1 },
    );
    // page is WritableAtom<number>
    // Reading: parses from URL query param
    // Writing: encodes back to URL query param

    const sort = yield* Route.queryAtom("sort",
      Schema.Literal("name", "date", "email"),
      { default: "name" as const },
    );

    const search = yield* Route.queryAtom("search",
      Schema.String,
      { default: "" },
    );

    const users = yield* Component.query(
      () => api.listUsers({
        page: page(),
        sort: sort(),
        search: search(),
      }),
    );

    return { users, page, sort, search };
  }),
  (props, { users, page, sort, search }) => (
    <div>
      <input
        value={search()}
        onInput={(e) => search.set(e.target.value)}
        // Typing in the search box updates the URL: /users?search=alice
      />
      <select
        value={sort()}
        onChange={(e) => sort.set(e.target.value)}
        // Changing sort updates the URL: /users?search=alice&sort=date
      >
        <option value="name">Name</option>
        <option value="date">Date</option>
        <option value="email">Email</option>
      </select>
      <Async result={users()} success={(xs) => (
        <ul>
          <For each={xs}>{(u) => <li>{u().name}</li>}</For>
        </ul>
      )} />
      <button onClick={() => page.update((p) => p + 1)}>
        Next Page
        {/* Updates URL: /users?search=alice&sort=date&page=2 */}
      </button>
    </div>
  ),
).pipe(
  Component.route("/users"),
);
```

`Route.queryAtom` is bidirectional: reading the atom parses the URL param through the schema, writing the atom encodes the value back to the URL through the schema. The URL is always in sync with the component state. Back/forward browser navigation updates the atoms. Atom writes update the URL. Schema handles all the parsing and encoding.

The implementation:

```ts
Route.queryAtom = <A>(key: string, schema: Schema.Schema<A, string>, options: { default: A }) =>
  Effect.gen(function* () {
    const router = yield* Router;
    const encode = Schema.encodeSync(schema);
    const decode = Schema.decodeUnknownOption(schema);

    // Read from URL, falling back to default
    const value = Atom.make((get) => {
      const url = get(router.url);
      const raw = url.searchParams.get(key);
      if (raw === null) return options.default;
      return Option.getOrElse(decode(raw), () => options.default);
    });

    // Override set to also update URL
    const original = value.set;
    value.set = (next: A) => {
      original(next);
      const url = new URL(router.url());
      const encoded = encode(next);
      if (encoded === encode(options.default)) {
        url.searchParams.delete(key); // clean URL when at default
      } else {
        url.searchParams.set(key, encoded);
      }
      Effect.runSync(router.navigate(url.toString(), { replace: true }));
    };

    return value;
  });
```

**Typed route references across the entire app:**

All route links can be collected into a single typed object for the whole app:

```ts
// routes.ts — single source of truth
export const routes = {
  home: Route.link(
    Component.make(/* ... */).pipe(Component.route("/"))
  ),
  users: {
    list: Route.link(
      UserList  // already has Component.route("/users")
    ),
    profile: Route.link(
      UserProfile  // Component.route("/users/:userId")
    ),
    settings: Route.link(
      UserSettings  // Component.route("/users/:userId/settings")
    ),
  },
  admin: {
    dashboard: Route.link(
      AdminDashboard  // Component.route("/admin")
    ),
    users: Route.link(
      AdminUsers  // Component.route("/admin/users")
    ),
  },
  about: Route.link(
    About  // Component.route("/about")
  ),
} as const;

// Usage anywhere in the app
import { routes } from "./routes";

routes.users.profile({ userId: "alice" })
// → "/users/alice"

routes.users.list({}, { query: { page: 3, sort: "date" } })
// → "/users/?page=3&sort=date"

routes.admin.dashboard({})
// → "/admin"

// Type error
routes.users.profile({})
// Error: Property 'userId' is missing

routes.users.profile({ userId: 42 })
// Error: Type 'number' is not assignable to type 'string'
```

In JSX:

```tsx
<Route.Link to={routes.users.profile} params={{ userId: user.id }}>
  {user.name}
</Route.Link>

<Route.Link to={routes.users.list} query={{ sort: "date" }}>
  Sort by date
</Route.Link>

// Active link styling — reactive
<Route.Link
  to={routes.users.list}
  class={(active) => active ? "nav-active" : "nav-link"}
>
  Users
</Route.Link>
```

`Route.Link` knows if it's the active route because it can compare its `to` pattern against the current URL. The `class` callback receives a boolean for active state.

**Complex schema patterns with Effect Schema v4:**

Schema v4's string parsing shines for route params:

```ts
// UUID params
Component.route("/items/:itemId", {
  params: Schema.Struct({
    itemId: Schema.UUID,
  }),
})
// Validates that itemId is a valid UUID format

// Date params
Component.route("/reports/:date", {
  params: Schema.Struct({
    date: Schema.DateFromString,
  }),
})
// Route.params yields { date: Date }
// URL /reports/2024-03-15 → Date object

// Enum params
Component.route("/items/:status", {
  params: Schema.Struct({
    status: Schema.Literal("active", "archived", "draft"),
  }),
})
// Only matches /items/active, /items/archived, /items/draft
// /items/unknown → doesn't match

// Composite params with transforms
Component.route("/geo/:coords", {
  params: Schema.Struct({
    coords: Schema.transform(
      Schema.String,
      Schema.Struct({ lat: Schema.Number, lng: Schema.Number }),
      {
        decode: (s) => {
          const [lat, lng] = s.split(",").map(Number);
          return { lat, lng };
        },
        encode: ({ lat, lng }) => `${lat},${lng}`,
      },
    ),
  }),
})
// URL /geo/37.77,-122.42 → { lat: 37.77, lng: -122.42 }
// Link: geoLink({ coords: { lat: 37.77, lng: -122.42 } }) → "/geo/37.77,-122.42"

// Array query params
Component.route("/search", {
  query: Schema.Struct({
    tags: Schema.transform(
      Schema.String,
      Schema.Array(Schema.String),
      {
        decode: (s) => s.split(","),
        encode: (arr) => arr.join(","),
      },
    ),
  }),
})
// URL /search?tags=react,effect,typescript
// Route.query yields { tags: ["react", "effect", "typescript"] }
// Link: searchLink({}, { query: { tags: ["react", "effect"] } })
//   → "/search?tags=react,effect"
```

**Error handling for route param validation:**

When a URL has invalid params (user navigated manually or received a bad link), the schema validation fails. This should be handled gracefully:

```ts
Component.route("/:userId/posts/:postId", {
  params: Schema.Struct({
    userId: Schema.String.pipe(Schema.nonEmpty()),
    postId: Schema.NumberFromString.pipe(Schema.int(), Schema.positive()),
  }),
  onParseError: "not-found",  // treat invalid params as route not matching
  // or: "error" — mount the route but yield a ParseError to the error boundary
  // or: custom handler
  // or: (error) => Route.redirect(routes.home({}))
})
```

`onParseError: "not-found"` means `/users/alice/posts/abc` doesn't match this route (because "abc" isn't a valid positive integer). The router continues trying other routes. If no route matches, a 404 component renders.

`onParseError: "error"` means the route matches but the component's setup receives a `ParseError` in its error channel. The component's error boundary handles it:

```tsx
const UserPost = Component.make(/* ... */).pipe(
  Component.route("/:userId/posts/:postId", {
    params: Schema.Struct({
      userId: Schema.String,
      postId: Schema.NumberFromString.pipe(Schema.int()),
    }),
    onParseError: "error",
  }),
  Component.withErrorBoundary({
    ParseError: (e) => <p>Invalid URL: {e.message}</p>,
  }),
);
```

**Testing routes:**

```ts
const test = Effect.gen(function* () {
  const router = yield* Router;

  // Navigate to a route
  yield* router.navigate(routes.users.profile({ userId: "alice" }));

  // Get the component bindings
  const bindings = yield* Component.setupEffect(UserProfile, {});

  // Verify params were parsed
  const params = yield* Route.params;
  assert.equal(params.userId, "alice");

  // Verify query data
  yield* TestClock.adjust("100 millis");
  assert.deepEqual(Result.getOrThrow(bindings.user()), { id: "alice", name: "Alice" });

  // Navigate to another route
  yield* router.navigate(routes.users.settings({ userId: "alice" }));

  // Previous component's scope should be closed
  // New component's setup should have run
}).pipe(
  Effect.provide(TestRouter),
  Effect.provide(TestApiLayer),
  Effect.scoped,
);
```

Routes are tested the same way as any other component — provide test layers, run Effects, assert on bindings. The `TestRouter` layer gives you manual URL control. No browser, no DOM, no navigation API.

**The complete routing architecture:**

```
Route definition:
  Component.route(pattern, { params: Schema, query: Schema, ...options })
  → attaches URL pattern + typed schemas to a Component

Route composition:
  Route.tree(Route.layout(..., [...children]))
  → builds nested route structure

Route service:
  Router — provided as a Layer (Browser / Server / Test)
  → handles URL listening, matching, navigation

Type-safe links:
  Route.link(RoutedComponent) → (params: P, options?: { query: Q }) => string
  → derived from route's Schema definitions

Type-safe navigation:
  yield* router.navigate(link) or yield* router.navigate(Route, params)
  → params type-checked against route's Schema

Route guards:
  Route.guard(Effect) → runs before mount, can redirect
  → requirements flow into component's R

Query atoms:
  Route.queryAtom(key, Schema, default)
  → two-way atom ↔ URL binding with Schema parse/encode

Everything is:
  - An Effect (guards, navigation, transitions)
  - A Layer (Router service — swappable per platform)
  - A Schema (params, query — parse and encode)
  - A Component (routes are components with patterns attached)
  - Pipeable (guards, transitions, error handling compose via pipe)
  - Type-safe (links derived from schemas, params typed, navigation checked)
```

No special router primitives. Routes are components. Navigation is an Effect. URL parsing is Schema. The router is a service. Links are derived from types. Everything integrates through the existing system.We don't need an outlet? The child components will have there own route urls? Also we don't need to define the route tree upfront? The component tree exists? Maybe?Also the routing layer could be a layer/service?You're right on all three points. I over-engineered it. Let me strip it back to what actually follows from the existing design.

**A route is just a component that conditionally mounts based on URL.**

No outlets. No route tree definition. No special router primitives. A routed component renders when its pattern matches and doesn't render when it doesn't. The parent component renders its children normally — some of those children happen to be routed, and they appear or disappear based on the URL.

```tsx
const App = Component.make(
  Component.props<{}>(),
  Component.require(),
  (props) => Effect.succeed({}),
  (props) => (
    <div>
      <Nav />
      {/* These are just children. They mount/unmount based on URL. */}
      <Home />
      <UserList />
      <UserProfile />
      <About />
    </div>
  ),
);

const Home = Component.make(
  Component.props<{}>(),
  Component.require(),
  (props) => Effect.succeed({}),
  (props) => <h1>Welcome</h1>,
).pipe(Component.route("/"));

const About = Component.make(
  Component.props<{}>(),
  Component.require(),
  (props) => Effect.succeed({}),
  (props) => <p>About us</p>,
).pipe(Component.route("/about"));
```

`Component.route("/")` is a pipe that wraps the component in a `Show`-like conditional: mount when URL matches, unmount when it doesn't. The parent doesn't know or care that its children are routed. It just renders them. The routing is a property of the child, not the parent.

This means nesting is just component nesting:

```tsx
const UserList = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const users = yield* Component.query(() => api.listUsers());
    return { users };
  }),
  (props, { users }) => (
    <div class="users-layout">
      <Sidebar />
      <Async result={users()} success={(xs) => (
        <ul><For each={xs}>{(u) => <li>{u().name}</li>}</For></ul>
      )} />
      {/* Child routes — they render themselves when their URL matches */}
      <UserProfile />
      <UserSettings />
    </div>
  ),
).pipe(Component.route("/users"));

const UserProfile = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const { userId } = yield* Route.params;
    const api = yield* Api;
    const user = yield* Component.query(() => api.findUser(userId));
    return { user };
  }),
  (props, { user }) => (
    <Async result={user()} success={(u) => <div>{u.name}</div>} />
  ),
).pipe(
  Component.route("/:userId", {
    params: Schema.Struct({
      userId: Schema.String.pipe(Schema.nonEmpty()),
    }),
  }),
);

const UserSettings = Component.make(
  // ...
).pipe(
  Component.route("/:userId/settings", {
    params: Schema.Struct({
      userId: Schema.String,
    }),
  }),
);
```

When the URL is `/users`, `UserList` mounts. `UserProfile` and `UserSettings` are in its template but their patterns don't match, so they don't mount. When the URL changes to `/users/alice`, `UserProfile` mounts because `/:userId` matches. `UserSettings` still doesn't mount. When the URL changes to `/users/alice/settings`, both `UserProfile` and `UserSettings` match — and that's fine if that's what you want, or you can make them exclusive.

**Route patterns are relative to the parent route.**

`UserList` matches `/users`. Its children's patterns are relative to `/users`. So `UserProfile`'s `/:userId` actually matches `/users/:userId`. `UserSettings`'s `/:userId/settings` matches `/users/:userId/settings`. The component tree determines the URL hierarchy:

```
App → /
├── Home → / (exact)
├── UserList → /users
│   ├── UserProfile → /users/:userId
│   └── UserSettings → /users/:userId/settings
└── About → /about
```

The router resolves this automatically by tracking the path prefix as it traverses the component tree. Each `Component.route(pattern)` consumes a segment of the URL. Children see the remaining URL after the parent's pattern is consumed.

**Exclusive routes — when you want only one child to match:**

Sometimes you want exactly one of several routes to render. That's `Route.switch`:

```tsx
(props, { users }) => (
  <div class="users-layout">
    <Sidebar />
    <Async result={users()} success={(xs) => (
      <ul><For each={xs}>{(u) => <li>{u().name}</li>}</For></ul>
    )} />

    {/* Only the first matching route renders */}
    <Route.Switch>
      <UserProfile />
      <UserSettings />
      <UserNotFound />
    </Route.Switch>
  </div>
),
```

`Route.Switch` renders only the first child whose route pattern matches. If none match, nothing renders (or a fallback if provided). This is just the `Switch`/`Match` control flow component applied to routes. You don't need it if you want multiple routes to match simultaneously — just render them as siblings.

But even `Route.Switch` is optional. You could achieve the same with `Show`:

```tsx
<Show when={!routeMatches("/:userId") && !routeMatches("/:userId/settings")}>
  <UserNotFound />
</Show>
```

The `Route.Switch` is just ergonomic sugar for the common "one of these" pattern.

**Implementation: `Component.route` is a pipe that wraps in a conditional.**

```ts
function route<P, Q>(
  pattern: string,
  options?: {
    params?: Schema.Schema<P>;
    query?: Schema.Schema<Q>;
    exact?: boolean;
  },
) {
  return <Props, Req, E>(
    component: Component<Props, Req, E>,
  ): Component<Props, Req | Router, E | RouteParseError> => {
    return Component.make(
      component.propsSpec,
      Component.require(Router, ...component.requirements),

      // Setup: check if route matches, parse params, delegate to inner setup
      (props) => Effect.gen(function* () {
        const router = yield* Router;
        const parentPrefix = yield* Route.prefix;
        const fullPattern = parentPrefix + pattern;

        // Reactive match check
        const matches = yield* Component.derived(() =>
          matchPattern(fullPattern, router.url().pathname, options?.exact)
        );

        // Parse params when matched
        const params = yield* Component.derived(() => {
          if (!matches()) return Option.none();
          const raw = extractParams(fullPattern, router.url().pathname);
          if (options?.params) {
            return Schema.decodeUnknownOption(options.params)(raw);
          }
          return Option.some(raw as P);
        });

        // Parse query when matched
        const query = yield* Component.derived(() => {
          if (!matches()) return Option.none();
          const raw = Object.fromEntries(router.url().searchParams);
          if (options?.query) {
            return Schema.decodeUnknownOption(options.query)(raw);
          }
          return Option.some(raw as Q);
        });

        // Provide parsed route context to inner component
        const innerSetup = matches()
          ? yield* component.setup(props).pipe(
              Effect.provideService(Route.Params, params),
              Effect.provideService(Route.Query, query),
              Effect.provideService(Route.Prefix, fullPattern),
            )
          : null;

        return { matches, innerSetup };
      }),

      // View: render inner component only when matched
      (props, { matches, innerSetup }) => (
        <Show when={matches()}>
          {() => component.view(props, innerSetup!)}
        </Show>
      ),
    );
  };
}
```

That's it. `Component.route` wraps the component in a `Show` conditioned on URL matching. When the URL matches, the inner component's setup runs (creating its scope, fibers, queries, etc.). When it doesn't match, the inner component doesn't exist (scope closed, fibers interrupted, cleanup done). The existing scope lifecycle handles everything.

**Route.Params and Route.Query are services scoped to the matched route.**

```ts
// Route params — provided by the nearest matched route ancestor
class Route {
  static Params = Effect.Tag("Route.Params")
    Route.Params,
    ReadonlyAtom<unknown>
  >() {};

  static Query = Effect.Tag("Route.Query")
    Route.Query,
    ReadonlyAtom<unknown>
  >() {};

  static Prefix = Effect.Tag("Route.Prefix")
    Route.Prefix,
    string
  >() {};
}
```

But these are untyped — `ReadonlyAtom<unknown>`. The trick is that inside a routed component, the `yield* Route.params` call is narrowed by the route's schema:

```ts
// Convenience accessor that narrows based on the enclosing route's schema
// This is what the component's setup actually calls
const params = yield* Route.params;
// Returns the schema output type, not unknown
```

How? `Component.route(pattern, { params: schema })` creates a type-level binding. The routed component's setup Effect has a narrowed `Route.Params` in its environment where the atom carries the schema's output type. The implementation uses `Effect.provideService` to inject the parsed, typed atom.

From the developer's perspective:

```ts
const UserProfile = Component.make(
  Component.props<{}>(),
  Component.require(Api),

  (props) => Effect.gen(function* () {
    const { userId } = yield* Route.params;
    // userId is string — typed by the schema
    const api = yield* Api;
    const user = yield* Component.query(() => api.findUser(userId));
    return { user };
  }),

  (props, { user }) => (
    <Async result={user()} success={(u) => <div>{u.name}</div>} />
  ),
).pipe(
  Component.route("/:userId", {
    params: Schema.Struct({
      userId: Schema.String.pipe(Schema.nonEmpty()),
    }),
  }),
);
```

The type of `yield* Route.params` inside `UserProfile`'s setup is `{ userId: string }` because `Component.route` narrows it. If you try to access `params.bogus`, it's a compile error.

**The Router service — just a layer:**

```ts
class Router extends Effect.Tag("Router")<Router, {
  readonly url: ReadonlyAtom<URL>;
  readonly navigate: (to: string, options?: { replace?: boolean }) => Effect.Effect<void>;
  readonly back: () => Effect.Effect<void>;
  readonly forward: () => Effect.Effect<void>;
}>() {
  // Browser
  static Browser = Layer.scoped(Router,
    Effect.gen(function* () {
      const url = Atom.make(new URL(window.location.href));

      const handler = () => url.set(new URL(window.location.href));
      window.addEventListener("popstate", handler);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => window.removeEventListener("popstate", handler))
      );

      return {
        url,
        navigate: (to, options) => Effect.sync(() => {
          if (options?.replace) {
            window.history.replaceState(null, "", to);
          } else {
            window.history.pushState(null, "", to);
          }
          url.set(new URL(to, window.location.origin));
        }),
        back: () => Effect.sync(() => window.history.back()),
        forward: () => Effect.sync(() => window.history.forward()),
      };
    })
  );

  // Hash-based
  static Hash = Layer.scoped(Router,
    Effect.gen(function* () {
      const url = Atom.make(new URL(window.location.hash.slice(1) || "/", window.location.origin));

      const handler = () =>
        url.set(new URL(window.location.hash.slice(1) || "/", window.location.origin));
      window.addEventListener("hashchange", handler);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => window.removeEventListener("hashchange", handler))
      );

      return {
        url,
        navigate: (to, options) => Effect.sync(() => {
          window.location.hash = to;
        }),
        back: () => Effect.sync(() => window.history.back()),
        forward: () => Effect.sync(() => window.history.forward()),
      };
    })
  );

  // Server — static URL from request
  static Server = (request: { url: string }) =>
    Layer.succeed(Router, {
      url: Atom.make(new URL(request.url)),
      navigate: () => Effect.void,
      back: () => Effect.void,
      forward: () => Effect.void,
    });

  // Memory — for testing
  static Memory = (initial: string = "/") =>
    Layer.effect(Router,
      Effect.gen(function* () {
        const url = Atom.make(new URL(initial, "http://test.local"));
        return {
          url,
          navigate: (to) => Effect.sync(() =>
            url.set(new URL(to, "http://test.local"))
          ),
          back: () => Effect.void,
          forward: () => Effect.void,
        };
      })
    );
}
```

Mount with whichever router you want:

```ts
// Browser app
Component.mount(App, {
  layer: Layer.mergeAll(AppLive, Router.Browser),
  target: root,
});

// SSR
const html = yield* Component.renderToString(App, {}).pipe(
  Effect.provide(Layer.mergeAll(AppLive, Router.Server(request))),
);

// Test
const test = Effect.gen(function* () {
  // ...
}).pipe(
  Effect.provide(Router.Memory("/users/alice")),
);
```

**Type-safe links — derived from routes:**

Now links. A routed component has a pattern and a param schema. A link factory is just a function that encodes params into a URL string using the schema:

```ts
// Route.link extracts the pattern and schema from a routed component
declare function link<P, Q>(
  route: RoutedComponent<any, any, any, P, Q>,
): RouteLink<P, Q>;

interface RouteLink<P, Q> {
  (params: P, options?: { query?: Partial<Q>; hash?: string }): string;
  readonly pattern: string;
  readonly paramsSchema: Schema.Schema<P>;
  readonly querySchema?: Schema.Schema<Q>;
}
```

The link factory uses Schema's encode to convert typed values back to URL strings:

```ts
function link(route) {
  const encode = route.paramsSchema
    ? Schema.encodeSync(route.paramsSchema)
    : () => ({});
  const encodeQuery = route.querySchema
    ? Schema.encodeSync(route.querySchema)
    : undefined;

  const fn = (params, options) => {
    // Encode params into the pattern
    let path = route.fullPattern;
    const encoded = encode(params);
    for (const [key, value] of Object.entries(encoded)) {
      path = path.replace(`:${key}`, encodeURIComponent(String(value)));
    }

    // Add query params
    if (options?.query && encodeQuery) {
      const queryEncoded = encodeQuery(options.query);
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(queryEncoded)) {
        if (value !== undefined) searchParams.set(key, String(value));
      }
      const qs = searchParams.toString();
      if (qs) path += `?${qs}`;
    }

    // Add hash
    if (options?.hash) path += `#${options.hash}`;

    return path;
  };

  fn.pattern = route.fullPattern;
  fn.paramsSchema = route.paramsSchema;
  fn.querySchema = route.querySchema;

  return fn;
}
```

Usage:

```ts
const userProfileLink = Route.link(UserProfile);
const userListLink = Route.link(UserList);
const userSettingsLink = Route.link(UserSettings);

userProfileLink({ userId: "alice" })
// → "/users/alice"

userSettingsLink({ userId: "alice" })
// → "/users/alice/settings"

userListLink({}, { query: { page: 3, sort: "date" } })
// → "/users?page=3&sort=date"

// Compile errors
userProfileLink({})
// Error: Property 'userId' is missing

userProfileLink({ userId: 42 })
// Error: Type 'number' is not assignable to type 'string'

userProfileLink({ userId: "alice", extra: true })
// Error: 'extra' does not exist
```

**Link component:**

```tsx
// Route.Link is a thin component over <a>
function Link<P, Q>(props: {
  to: RouteLink<P, Q>;
  params: P;
  query?: Partial<Q>;
  hash?: string;
  class?: string | ((active: boolean) => string);
  children: JSX.Element;
}) {
  return Component.make(
    Component.props<typeof props>(),
    Component.require(Router),
    (p) => Effect.gen(function* () {
      const router = yield* Router;

      const href = yield* Component.derived(() =>
        p.to(p.params, { query: p.query, hash: p.hash })
      );

      const active = yield* Component.derived(() =>
        router.url().pathname.startsWith(p.to.pattern.replace(/:[^/]+/g, ""))
      );

      const navigate = (e: MouseEvent) => {
        e.preventDefault();
        return router.navigate(href());
      };

      return { href, active, navigate };
    }),
    (p, { href, active, navigate }) => (
      
        href={href()}
        class={typeof p.class === "function" ? p.class(active()) : p.class}
        onClick={navigate}
      >
        {p.children}
      </a>
    ),
  );
}
```

Usage in templates:

```tsx
<Route.Link
  to={userProfileLink}
  params={{ userId: "alice" }}
  class={(active) => active ? "nav-active" : "nav-link"}
>
  Alice's Profile
</Route.Link>

<Route.Link
  to={userListLink}
  params={{}}
  query={{ sort: "date", page: 2 }}
>
  Users (sorted by date)
</Route.Link>

// Type error — wrong params
<Route.Link to={userProfileLink} params={{ id: "alice" }}>
// Error: 'id' does not exist, did you mean 'userId'?
```

**Programmatic navigation:**

```ts
// In a component's setup
(props) => Effect.gen(function* () {
  const router = yield* Router;

  const goToProfile = (userId: string) =>
    router.navigate(userProfileLink({ userId }));

  const deleteAndRedirect = yield* Component.action(
    Effect.fn(function* (userId: string) {
      const api = yield* Api;
      yield* api.deleteUser(userId);
      yield* router.navigate(userListLink({}));
    }),
  );

  return { goToProfile, deleteAndRedirect };
})
```

Navigation is `yield* router.navigate(linkFactory(params))`. The link factory produces a type-safe string. The router service handles the actual navigation. Everything is an Effect.

**Guards as pipes:**

```ts
const requireAuth = Component.guard(
  Effect.gen(function* () {
    const auth = yield* Auth;
    const user = yield* auth.currentUser();
    if (!user) {
      const router = yield* Router;
      yield* router.navigate(loginLink({}));
      yield* Effect.interrupt; // prevent component from mounting
    }
  }),
);

const requireAdmin = Component.guard(
  Effect.gen(function* () {
    const auth = yield* Auth;
    const user = yield* auth.currentUser();
    if (user?.role !== "admin") {
      const router = yield* Router;
      yield* router.navigate(homeLink({}));
      yield* Effect.interrupt;
    }
  }),
);

const AdminPanel = Component.make(/* ... */).pipe(
  Component.route("/admin"),
  requireAuth,
  requireAdmin,
);
```

`Component.guard` is a pipe that runs an Effect before the component's setup. If the guard interrupts or fails, the component doesn't mount. Guards compose — `requireAuth` runs first, then `requireAdmin`. Guard requirements (`Auth`) add to the component's `R`.

**Route query atoms — two-way URL binding:**

```ts
(props) => Effect.gen(function* () {
  const router = yield* Router;
  const api = yield* Api;

  // Two-way binding: atom ↔ URL query param
  const page = yield* Route.queryAtom("page",
    Schema.NumberFromString.pipe(Schema.int(), Schema.positive()),
    { default: 1 },
  );

  const sort = yield* Route.queryAtom("sort",
    Schema.Literal("name", "date", "email"),
    { default: "name" as const },
  );

  const search = yield* Route.queryAtom("search",
    Schema.String,
    { default: "" },
  );

  // Queries react to the atoms, which react to the URL
  const users = yield* Component.query(
    () => api.listUsers({ page: page(), sort: sort(), search: search() }),
  );

  return { users, page, sort, search };
})
```

`Route.queryAtom` is an Effect that creates a `WritableAtom` backed by the URL query param. Reading the atom parses the URL param through the Schema. Writing the atom encodes the value back to the URL through the Schema. Browser back/forward updates the atoms. Atom writes update the URL. Everything stays in sync.

Implementation:

```ts
Route.queryAtom = <A>(
  key: string,
  schema: Schema.Schema<A, string>,
  options: { default: A },
) =>
  Effect.gen(function* () {
    const router = yield* Router;
    const decode = Schema.decodeUnknownOption(schema);
    const encode = Schema.encodeSync(schema);
    const defaultEncoded = encode(options.default);

    // Derived from URL — reactive
    const value = Atom.make((get) => {
      const raw = get(router.url).searchParams.get(key);
      if (raw === null) return options.default;
      return Option.getOrElse(decode(raw), () => options.default);
    });

    // Wrap set to also update URL
    const writable = Atom.writable(
      (get) => get(value),
      (next: A) => {
        const encoded = encode(next);
        const url = new URL(router.url());
        if (encoded === defaultEncoded) {
          url.searchParams.delete(key);
        } else {
          url.searchParams.set(key, encoded);
        }
        Effect.runSync(router.navigate(url.pathname + url.search, { replace: true }));
      },
    );

    return writable;
  });
```

**Route metadata via pipe:**

```ts
const UserProfile = Component.make(/* ... */).pipe(
  Component.route("/:userId", {
    params: Schema.Struct({ userId: Schema.String }),
  }),
  Route.title((params) => `User: ${params.userId}`),
  Route.meta({
    description: "User profile page",
    og: { type: "profile" },
  }),
);
```

`Route.title` sets `document.title` when the route matches. `Route.meta` sets meta tags. Both are pipes that add behavior without changing the component. On the server, meta information is collected during SSR for the HTML head.

**Code splitting via pipe:**

```ts
const AdminPanel = Route.lazy(
  () => import("./AdminPanel"),
  Component.route("/admin"),
  {
    loading: () => <AdminSkeleton />,
  },
);
```

`Route.lazy` wraps a dynamic import with a route. The pattern is known upfront for matching. The component code is loaded on demand. The loading component shows while the chunk loads. It's just a pipe that adds async loading behavior.

**Preloading via link:**

```tsx
<Route.Link
  to={userProfileLink}
  params={{ userId: "alice" }}
  preload="hover"
>
  Alice
</Route.Link>
```

On hover, the router prefetches the target route's chunk (if lazy) and optionally starts its queries. This is handled by the `Route.Link` component internally — it calls the router service's preload capability.

**Collecting all routes — for sitemaps, type checking, documentation:**

Since routes are just components with metadata attached via pipes, you can walk the component tree and extract all route information:

```ts
const allRoutes = Route.collect(App);
// [
//   { pattern: "/", component: Home },
//   { pattern: "/users", component: UserList, query: Schema<{ page, sort, search }> },
//   { pattern: "/users/:userId", component: UserProfile, params: Schema<{ userId }> },
//   { pattern: "/users/:userId/settings", component: UserSettings, params: Schema<{ userId }> },
//   { pattern: "/about", component: About },
//   { pattern: "/admin", component: AdminPanel, guards: [requireAuth, requireAdmin] },
// ]
```

Or define all links in one place for app-wide usage:

```ts
// routes.ts
export const links = {
  home: Route.link(Home),
  users: {
    list: Route.link(UserList),
    profile: Route.link(UserProfile),
    settings: Route.link(UserSettings),
  },
  about: Route.link(About),
  admin: Route.link(AdminPanel),
} as const;
```

Import and use anywhere with full type safety:

```tsx
import { links } from "./routes";

// Typed — params checked, query checked
links.users.profile({ userId: "alice" })
links.users.list({}, { query: { page: 2, sort: "name" } })

// In templates
<Route.Link to={links.users.profile} params={{ userId: user.id }}>
  {user.name}
</Route.Link>
```

**Testing:**

```ts
const test = Effect.gen(function* () {
  const router = yield* Router;

  // Start at /users
  yield* router.navigate("/users");

  // UserList should be mounted, UserProfile should not
  const listBindings = yield* Component.setupEffect(UserList, {});
  yield* TestClock.adjust("100 millis");
  assert(Result.isSuccess(listBindings.users()));

  // Navigate to /users/alice
  yield* router.navigate(links.users.profile({ userId: "alice" }));

  // UserProfile should now be mounted
  const profileBindings = yield* Component.setupEffect(UserProfile, {});
  const params = yield* Route.params;
  assert.equal(params.userId, "alice");
}).pipe(
  Effect.provide(Router.Memory("/users")),
  Effect.provide(TestApiLayer),
  Effect.scoped,
);
```

**The whole thing is:**

```
Component.route(pattern, { params, query })
  → pipe that wraps component in URL-conditional Show
  → pattern is relative to parent route's prefix
  → params parsed by Schema, typed in component setup
  → query parsed by Schema, typed in component setup

Router service (Layer)
  → Browser / Hash / Server / Memory implementations
  → url: ReadonlyAtom<URL>
  → navigate: Effect

Route.link(RoutedComponent)
  → typed link factory derived from route's schemas
  → compile-time param/query validation

Route.Link component
  → <a> with typed to/params/query props
  → client-side navigation
  → active state

Route.queryAtom(key, schema, default)
  → two-way atom ↔ URL query binding
  → Schema parse (URL → value) and encode (value → URL)

Pipes: Route.guard, Route.title, Route.meta, Route.lazy, Route.transition

No outlets. No route tree. No special router primitives.
Routes are components. The component tree is the route tree.
Navigation is an Effect. URL parsing is Schema. The router is a Layer.
```