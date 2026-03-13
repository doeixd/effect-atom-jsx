import { describe, expect, it } from "vitest";
import { Effect, Layer, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Route from "../Route.js";

function memoryRouter(initial: string) {
  const url = Atom.value(new URL(initial, "http://test.local")) as unknown as Atom.WritableAtom<URL>;
  return Layer.succeed(Route.RouterTag, {
    url,
    navigate: (to: string) => Effect.sync(() => {
      url.set(new URL(to, "http://test.local"));
    }),
    back: () => Effect.void,
    forward: () => Effect.void,
    preload: () => Effect.void,
  });
}

describe("Route", () => {
  it("matches patterns and extracts params", () => {
    expect(Route.matchPattern("/users/:userId", "/users/alice", true)).toBe(true);
    expect(Route.matchPattern("/users/:userId", "/users/alice/settings", true)).toBe(false);
    expect(Route.extractParams("/users/:userId", "/users/alice")).toEqual({ userId: "alice" });
  });

  it("creates typed-ish links from routed components", () => {
    const User = Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
      Route.path("/users/:userId")(Component.from<{ readonly title: string }>(() => null)),
    );

    const userLink = Route.link(User);
    expect(userLink({ userId: "alice" })).toBe("/users/alice");
  });

  it("preserves route metadata across component wrappers", () => {
    const User = Route.title((params: { readonly userId: string }, data: { readonly id: string; readonly name: string } | undefined) => `${params.userId}:${data?.name ?? "none"}`)(
      Route.loader((params: { readonly userId: string }) => Effect.succeed({ id: params.userId, name: "Alice" }))(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
          Route.path("/wrapped/:userId")(
            Component.from<{}>(() => null).pipe(
              Component.withLoading(() => "loading"),
              Component.withSpan("wrapped-user"),
            ),
          ),
        ),
      ),
    );

    const userLink = Route.link(User);
    expect(userLink({ userId: "alice" })).toBe("/wrapped/alice");

    const collected = Route.collect([User]);
    expect(collected[0]?.fullPattern).toBe("/wrapped/:userId");
  });

  it("renders routed component only when matched initially", () => {
    const Page = Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
      Route.path("/users/:userId")(Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ ok: true }),
      () => "ok",
    )));

    const matched = Effect.runSync(
      Route.renderRequest(Page, { request: new Request("http://test.local/users/alice") }),
    );
    expect(matched.html).toBe("ok");

    const unmatched = Effect.runSync(
      Route.renderRequest(Page, { request: new Request("http://test.local/about") }),
    );
    expect(unmatched.html).toBe("ok");
  });

  it("creates queryAtom synced with router", () => {
    const eff = Effect.gen(function* () {
      const page = yield* Route.queryAtom("page", Schema.NumberFromString, { default: 1 });
      expect(page()).toBe(2);
      page.set(3);
      return true;
    }).pipe(Effect.provide(memoryRouter("/users?page=2")));

    expect(Effect.runSync(eff)).toBe(true);
  });

  it("tracks memory router back/forward history", () => {
    const eff = Effect.gen(function* () {
      const router = yield* Route.RouterTag;
      yield* router.navigate("/users");
      yield* router.navigate("/users/alice");
      expect(router.url().pathname).toBe("/users/alice");
      yield* router.back();
      expect(router.url().pathname).toBe("/users");
      yield* router.forward();
      expect(router.url().pathname).toBe("/users/alice");
    }).pipe(Effect.provide(Route.Memory("/")));

    Effect.runSync(eff);
  });

  it("collects and validates route metadata", () => {
    const One = Route.path("/one")(Component.from<{}>(() => null));
    const Two = Route.path("/one")(Component.from<{}>(() => null));
    const collected = Route.collect([One, Two]);
    expect(collected.length).toBe(2);
    const errors = Route.validateLinks([One, Two]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("supports unified routes for linking and collection", () => {
    const UserView = Component.from<{}>(() => null);
    const UserPage = Route.title<{ readonly userId: string }, void>("User")(
      Route.id("users.detail")(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
          Route.path("/users/:userId")(UserView),
        ),
      ),
    );

    const userLink = Route.link(UserPage);
    expect(userLink({ userId: "alice" })).toBe("/users/alice");

    const collected = Route.collect(UserPage);
    expect(collected[0]?.id).toBe("users.detail");
    expect(collected[0]?.fullPattern).toBe("/users/:userId");
  });

  it("provides unified-route introspection helpers", () => {
    const Root: Route.AnyRoute = Route.id("root")(Route.layout()(Route.path("/")(Component.from<{}>(() => null))));
    const User: Route.AnyRoute = Route.id("user")(Route.path(":userId")(Component.from<{}>(() => null)));
    const UsersMounted: Route.AnyRoute = Route.children([User])(
      Route.id("users")(Route.layout()(Route.path("users")(Component.from<{}>(() => null)))),
    );
    const Tree: Route.AnyRoute = Route.children([UsersMounted])(Root as Route.AnyLayoutRoute);

    expect(Route.nodes(Tree).length).toBeGreaterThanOrEqual(3);
    expect(Route.parentOf(Tree, User)).toBe(UsersMounted);
    expect(Route.depthOf(Tree, User)).toBe(2);
    expect(Route.ancestorsOf(Tree, User)).toEqual([Tree, UsersMounted]);
    expect(Route.routeChainOf(Tree, User)).toEqual([Tree, UsersMounted, User]);
    expect(Route.fullPathOf(Tree, User)).toBe("/users/:userId");
    expect(Route.paramNamesOf(Tree, User)).toEqual(["userId"]);
  });

  it("validates unified-route trees", () => {
    const Problem: Route.AnyRoute = Route.id("dup")(Route.path("/users/:id/:id")(Component.from<{}>(() => null)));
    const AlsoProblem = Route.children([
      Problem,
      Route.id("dup")(Route.path("/other")(Component.from<{}>(() => null))),
    ])(Route.layout()(Route.path("/")(Component.from<{}>(() => null))));

    const errors = Route.validateTree(AlsoProblem);
    expect(errors.some((e) => e.includes("Duplicate route id 'dup'"))).toBe(true);
    expect(errors.some((e) => e.includes("Duplicate route param 'id'"))).toBe(true);
  });

  it("detects conflicting sibling route patterns", () => {
    const Root = Route.layout()(Route.path("/")(Component.from<{}>(() => null)));
    const A: Route.AnyRoute = Route.path("users/:id")(Component.from<{}>(() => null));
    const B: Route.AnyRoute = Route.path("users/:userId")(Component.from<{}>(() => null));
    const Tree = Route.children([A, B])(Root);

    const errors = Route.validateTree(Tree);
    expect(errors.some((e) => e.includes("Conflicting sibling routes"))).toBe(true);
  });

  it("supports unified route title/meta callbacks", () => {
    const UserView = Component.from<{}>(() => null);
    let observedTitle: string | undefined;
    let observedDescription: string | undefined;
    const UserPage = Route.meta((params: { readonly userId: string }, data: { readonly id: string; readonly name: string } | undefined) => {
      observedDescription = `${params.userId}:${data?.id ?? "none"}`;
      return { description: observedDescription };
    })(
      Route.title((params: { readonly userId: string }, data: { readonly id: string; readonly name: string } | undefined) => {
        observedTitle = `${params.userId}:${data?.name ?? "none"}`;
        return observedTitle;
      })(
        Route.loader((params: { readonly userId: string }) => Effect.succeed({ id: params.userId, name: params.userId.toUpperCase() }))(
          Route.id("node.head")(
            Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
              Route.path("/node-head/:userId")(UserView),
            ),
          ),
        ),
      ),
    );

    Effect.runSync(Route.renderRequest(UserPage, {
      request: new Request("http://test.local/node-head/alice"),
    }));

    expect(observedTitle).toBe("alice:ALICE");
    expect(observedDescription).toBe("alice:alice");
  });

  it("merges route metadata root-to-leaf with deepest title", () => {
    const merged = Route.mergeRouteMetaChain([
      {
        description: "Root",
        keywords: ["app", "users"],
        og: { type: "website", title: "Root" },
      },
      {
        description: "Users",
        keywords: ["users", "list"],
        og: { title: "Users" },
        twitter: { card: "summary" },
      },
    ]);

    expect(merged?.description).toBe("Users");
    expect(merged?.keywords).toEqual(["app", "users", "list"]);
    expect(merged?.og).toEqual({ type: "website", title: "Users" });

    const head = Route.resolveRouteHead([
      { id: "a", depth: 1, title: "App", meta: { description: "App" } },
      { id: "b", depth: 3, title: "Users", meta: { description: "Users" } },
      { id: "c", depth: 5, title: "User Detail", meta: { description: "Detail" } },
    ] as any);

    expect(head.title).toBe("User Detail");
    expect(head.meta?.description).toBe("Detail");
  });
});
