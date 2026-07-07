import { Component, Route, WithLayer } from "effect-atom-jsx";
import { Effect, Schema } from "effect";

const SearchPageBase = Route.page(
  "/search",
  Component.make(
    Component.props<{}>(),
    Component.require<Route.RouterService>(),
    () => Effect.gen(function* () {
      const page = yield* Route.queryAtom(
        "page",
        Schema.NumberFromString,
        { default: 1 },
      );

      const sort = yield* Route.queryAtom(
        "sort",
        Schema.String,
        { default: "name" },
      );

      const search = yield* Route.queryAtom("search", Schema.String, { default: "" });
      return { page, sort, search };
    }),
    (_props, b) => (
      <section>
        <h2>Typed Query Atoms</h2>
        <p>
          <button onClick={() => b.page.update((n: number) => n + 1)}>Next Page</button>
          {" "}
          <button onClick={() => b.sort.set(b.sort() === "name" ? "date" : "name")}>Toggle Sort</button>
        </p>
        <p>
          <input
            value={b.search()}
            onInput={(e: Event) => b.search.set((e.currentTarget as HTMLInputElement).value)}
            placeholder="Search"
          />
        </p>
        <p>page={b.page()} sort={b.sort()} search={b.search() || "(empty)"}</p>
      </section>
    ),
  ),
).pipe(
  Route.querySchema(Schema.Struct({
    page: Schema.optional(Schema.NumberFromString),
    sort: Schema.optional(Schema.String),
    search: Schema.optional(Schema.String),
  })),
);
const SearchPage = SearchPageBase.pipe(
  Route.title<typeof SearchPageBase>(() => "Search"),
  Route.meta<typeof SearchPageBase>(() => ({ description: "Typed query atom route" })),
);

const UserDetailBase = Route.page(
  "/users/:userId",
  Component.make(
    Component.props<{}>(),
    Component.require<Route.RouteContext<any, any, any>>(),
    () => Route.params,
    (_props, params: { userId?: string }) => (
      <section>
        <h2>User Detail</h2>
        <p>userId={String(params.userId ?? "unknown")}</p>
      </section>
    ),
  ),
).pipe(
  Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
);
const UserDetail = UserDetailBase.pipe(
  Route.title<typeof UserDetailBase>((p) => `User ${p.userId}`),
);

const searchLink = Route.link(SearchPage);
const userLink = Route.link(UserDetail);

const SearchView = Route.componentOf(SearchPage);
const UserDetailView = Route.componentOf(UserDetail);

export function App() {
  return (
    <WithLayer layer={Route.Router.Browser}>
      {() => (
        <main style="font-family: ui-sans-serif, system-ui; margin: 0 auto; max-width: 760px; padding: 24px;">
          <h1>Router Typed Links</h1>

          <p>
            <Route.Link
              to={searchLink}
              params={{}}
              query={{ page: 2, sort: "name", search: "alice" }}
              class={(active) => active ? "active" : ""}
              preload="hover"
            >
              Search Alice
            </Route.Link>
            {" · "}
            <Route.Link to={userLink} params={{ userId: "alice" }}>Alice Profile</Route.Link>
          </p>

          <Route.Switch children={[SearchView({}), UserDetailView({})]} fallback={<p>No route matched.</p>} />
        </main>
      )}
    </WithLayer>
  );
}
