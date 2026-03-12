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
    const User = Component.from<{ readonly title: string }>(() => null).pipe(
      Component.route("/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
    );

    const userLink = Route.link(User);
    expect(userLink({ userId: "alice" })).toBe("/users/alice");
  });

  it("preserves route metadata across component wrappers", () => {
    const User = Component.from<{}>(() => null).pipe(
      Component.route("/wrapped/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader((params: { readonly userId: string }) => Effect.succeed({ id: params.userId, name: "Alice" })),
      Route.title((params: { readonly userId: string }, data: { readonly id: string; readonly name: string } | undefined) => `${params.userId}:${data?.name ?? "none"}`),
      Component.withLoading(() => "loading"),
    ).pipe(Component.withSpan("wrapped-user"));

    const userLink = Route.link(User);
    expect(userLink({ userId: "alice" })).toBe("/wrapped/alice");

    const collected = Route.collect([User]);
    expect(collected[0]?.fullPattern).toBe("/wrapped/:userId");
  });

  it("renders routed component only when matched initially", () => {
    const Page = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ ok: true }),
      () => "ok",
    ).pipe(Component.route("/users/:userId", { params: Schema.Struct({ userId: Schema.String }) }));

    const matched = Effect.runSync(
      (Component.renderEffect(Page, {}).pipe(Effect.provide(memoryRouter("/users/alice"))) as unknown as Effect.Effect<unknown, unknown, never>),
    );
    expect(matched).toBe("ok");

    const unmatched = Effect.runSync(
      (Component.renderEffect(Page, {}).pipe(Effect.provide(memoryRouter("/about"))) as unknown as Effect.Effect<unknown, unknown, never>),
    );
    expect(unmatched).toBe(null);
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
    const One = Component.from<{}>(() => null).pipe(Component.route("/one"));
    const Two = Component.from<{}>(() => null).pipe(Component.route("/one"));
    const collected = Route.collect([One, Two]);
    expect(collected.length).toBe(2);
    const errors = Route.validateLinks([One, Two]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("supports route nodes for linking and collection", () => {
    const UserView = Component.from<{}>(() => null);
    const UserPage = Route.define(
      Route.page("/users/:userId", UserView).pipe(
        Route.id("users.detail"),
        Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
        Route.title("User"),
      ),
    );

    const userLink = Route.link(UserPage);
    expect(userLink({ userId: "alice" })).toBe("/users/alice");

    const collected = Route.collect(UserPage);
    expect(collected[0]?.id).toBe("users.detail");
    expect(collected[0]?.fullPattern).toBe("/users/:userId");
  });

  it("provides route-node introspection helpers", () => {
    const Root = Route.layout(Component.from<{}>(() => null)).pipe(Route.id("root"));
    const Users = Route.page("users", Component.from<{}>(() => null)).pipe(Route.id("users"));
    const User = Route.page(":userId", Component.from<{}>(() => null)).pipe(Route.id("user"));
    const UsersMounted = Route.mount(Users, [Route.ref(User)]);
    const Tree = Route.define(Route.children([
      UsersMounted,
    ])(Root));

    expect(Route.nodes(Tree).length).toBeGreaterThanOrEqual(3);
    expect(Route.parentOf(Tree, User)).toBe(UsersMounted);
    expect(Route.depthOf(Tree, User)).toBe(2);
    expect(Route.ancestorsOf(Tree, User)).toEqual([Tree, UsersMounted]);
    expect(Route.routeChainOf(Tree, User)).toEqual([Tree, UsersMounted, User]);
    expect(Route.fullPathOf(Tree, User)).toBe("/users/:userId");
    expect(Route.paramNamesOf(Tree, User)).toEqual(["userId"]);
  });

  it("validates route-node trees", () => {
    const Problem = Route.define(
      Route.page("/users/:id/:id", Component.from<{}>(() => null)).pipe(Route.id("dup")),
    );
    const AlsoProblem = Route.define(
      Route.children([
        Problem,
        Route.page("/other", Component.from<{}>(() => null)).pipe(Route.id("dup")),
      ])(Route.layout(Component.from<{}>(() => null))),
    );

    const errors = Route.validateTree(AlsoProblem);
    expect(errors.some((e) => e.includes("Duplicate route id 'dup'"))).toBe(true);
    expect(errors.some((e) => e.includes("Duplicate route param 'id'"))).toBe(true);
  });

  it("detects conflicting sibling route patterns", () => {
    const Root = Route.layout(Component.from<{}>(() => null));
    const A = Route.page("users/:id", Component.from<{}>(() => null));
    const B = Route.page("users/:userId", Component.from<{}>(() => null));
    const Tree = Route.define(Route.children([A, B])(Root));

    const errors = Route.validateTree(Tree);
    expect(errors.some((e) => e.includes("Conflicting sibling routes"))).toBe(true);
  });

  it("materializes route-node components", () => {
    const UserView = Component.from<{}>(() => null);
    const UserPage = Route.define(
      Route.page("/materialized/:userId", UserView).pipe(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
        Route.loader((params: { readonly userId: string }) => Effect.succeed({ id: params.userId })),
      ),
    );

    const rendered = Effect.runSync(
      (Component.renderEffect(Route.componentOf(UserPage), {}).pipe(Effect.provide(memoryRouter("/materialized/alice"))) as unknown as Effect.Effect<unknown, unknown, never>),
    );
    expect(rendered).toBe(null);
  });

  it("supports route-node title/meta enhancers", () => {
    const UserView = Component.from<{}>(() => null);
    let observedTitle: string | undefined;
    let observedDescription: string | undefined;
    const UserPage = Route.define(
      Route.page("/node-head/:userId", UserView).pipe(
        Route.id("node.head"),
        Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
        Route.loader((params: { readonly userId: string }) => Effect.succeed({ id: params.userId, name: params.userId.toUpperCase() })),
        Route.title((params: { readonly userId: string }, data: { readonly id: string; readonly name: string } | undefined) => {
          observedTitle = `${params.userId}:${data?.name ?? "none"}`;
          return observedTitle;
        }),
        Route.meta((params: { readonly userId: string }, data: { readonly id: string; readonly name: string } | undefined) => {
          observedDescription = `${params.userId}:${data?.id ?? "none"}`;
          return { description: observedDescription };
        }),
      ),
    );

    Effect.runSync(
      (Component.renderEffect(Route.componentOf(UserPage), {}).pipe(Effect.provide(memoryRouter("/node-head/alice"))) as unknown as Effect.Effect<unknown, never, never>),
    );

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
