import { describe, expect, it } from "vitest";
import { Effect, Layer, Schema, ServiceMap } from "effect";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as Result from "../Result.js";
import { clearLoaderCache, getLoaderCacheEntry, isFresh } from "../router-runtime.js";
import * as Reactivity from "../Reactivity.js";
import { installReactivityService } from "../reactivity-runtime.js";
import { installSingleFlightTransport } from "../single-flight-runtime.js";

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

function withUserIdRoute<C extends Component.Component<any, any, any, any>>(pattern: string, component: C) {
  return Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(Route.path(pattern)(component));
}

function routeIdOf(route: Route.AnyRoute): string {
  return String(route[Route.UnifiedRouteSymbol].meta.id ?? route[Route.UnifiedRouteSymbol].meta.fullPattern);
}

describe("Route loader", () => {
  it("provides loaderData in component setup", () => {
    const UserPage = Component.make(
      Component.props<{}>(),
      Component.require<Route.RouteContext<any, any, any>>(),
      () => Effect.gen(function* () {
        const user = yield* Route.loaderData<{ readonly name: string }>();
        return { user };
      }),
      (_props, b) => b.user().name,
    ).pipe(
      Component.route("/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId })),
    );

    const out = Effect.runSync(
      (Component.renderEffect(UserPage, {}).pipe(Effect.provide(memoryRouter("/users/alice"))) as unknown as Effect.Effect<unknown, never, never>),
    );
    expect(out).toBe("alice");
  });

  it("supports dependency-aware matched loader execution", () => {
    const Parent = Component.from<{}>(() => null).pipe(
      Component.route("/users/:userId", { params: Schema.Struct({ userId: Schema.String }) }),
      Route.loader<{ readonly userId: string }, { readonly id: string }, never, never>((params) =>
        Effect.succeed({ id: params.userId })),
    );

    const Child = Component.from<{}>(() => null).pipe(
      Component.route("/users/:userId/posts", { params: Schema.Struct({ userId: Schema.String }) }),
      Route.loader<{ readonly userId: string }, ReadonlyArray<string>, never, never>(
        (_params, deps) => Effect.sync(() => {
          const parent = deps?.parent<{ readonly id: string }>();
          return [`post-for-${parent?.id ?? "unknown"}`];
        }),
        { dependsOnParent: true },
      ),
    );

    void Parent;
    void Child;

    const results = Effect.runSync(Route.runMatchedLoaders(new URL("http://test.local/users/alice/posts")));
    const child = results.find((r) => String(r.routeId).includes("route-"));
    expect(child).toBeDefined();
  });

  it("serializes streamed loader payload and sitemap entries", () => {
    const entries = Effect.runSync(Route.collectSitemapEntries("https://example.com"));
    expect(Array.isArray(entries)).toBe(true);

    const serialized = Route.serializeLoaderData([
      { routeId: "r1", result: { _tag: "Success", value: { ok: true }, waiting: false, timestamp: Date.now() } as any },
    ]);
    const parsed = Route.deserializeLoaderData(serialized);
    expect(parsed.r1).toBeDefined();

    const scripts = Route.streamDeferredLoaderScripts([
      { routeId: "r1", result: { _tag: "Success", value: 1, waiting: false, timestamp: Date.now() } as any },
    ]);
    expect(scripts[0]).toContain("__LOADER_DATA__");
  });

  it("supports critical/deferred streaming navigation batches", () => {
    const Critical = Component.from<{}>(() => null).pipe(
      Component.route("/stream/users/:userId", { params: Schema.Struct({ userId: Schema.String }) }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId }), { priority: "critical" }),
    );

    const Deferred = Component.from<{}>(() => null).pipe(
      Component.route("/stream/users/:userId/details", { params: Schema.Struct({ userId: Schema.String }) }),
      Route.loader<{ readonly userId: string }, { readonly bio: string }, never, never>((params) =>
        Effect.succeed({ bio: `bio-${params.userId}` }), { priority: "deferred", dependsOnParent: true }),
    );

    void Critical;
    void Deferred;

    const streamed = Effect.runSync(Route.runStreamingNavigation(new URL("http://test.local/stream/users/alice/details")));
    expect(streamed.critical.length).toBeGreaterThan(0);
    expect(streamed.deferredScripts.length).toBeGreaterThan(0);
  });

  it("supports tree-based prefetch and sitemap collection for unified routes", () => {
    const UserRoute = Route.path("/sitemap/users/:userId")(Component.from<{}>(() => null));
    const App = Route.layout()(Route.path("/")(Component.from<{}>(() => null))).pipe(
      Route.children([UserRoute]),
    );

    const prefetched = Effect.runSync(Route.prefetch(App, Route.link(UserRoute), { userId: "alice" }));
    const sitemap = Effect.runSync(Route.collectSitemapEntries(App, "https://example.com"));

    expect(prefetched).toBeUndefined();
    expect(sitemap).toEqual([{ loc: "https://example.com/" }]);
  });

  it("hydrates single-flight payloads from an explicit unified route tree", () => {
    clearLoaderCache();
    const UserRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ id: params.userId, name: "Alice" }))(
      Route.id("sf.users.detail")(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
          Route.path("/sf-users/:userId")(Component.from<{}>(() => null)),
        ),
      ),
    );

    const payload = {
      mutation: { ok: true },
      url: "http://test.local/sf-users/alice",
      loaders: [
        {
          routeId: "sf.users.detail",
          result: Result.success({ id: "alice", name: "Alice" }),
        },
      ],
    } satisfies Route.SingleFlightPayload<{ readonly ok: boolean }>;

    Effect.runSync(Route.hydrateSingleFlightPayload(payload, UserRoute));
    const cacheEntry = getLoaderCacheEntry("sf.users.detail", { userId: "alice" });
    expect(cacheEntry?.result?._tag).toBe("Success");
    expect(cacheEntry?.result._tag === "Success" ? cacheEntry.result.value : undefined).toEqual({ id: "alice", name: "Alice" });
  });

  it("exposes loaderResult as Result for async UI control flow", () => {
    const StreamingUser = Component.make(
      Component.props<{}>(),
      Component.require<Route.RouteContext<any, any, any>>(),
      () => Effect.gen(function* () {
        const result = yield* Route.loaderResult<{ readonly name: string }, never>();
        return { result };
      }),
      (_props, b) => b.result()._tag,
    ).pipe(
      Component.route("/streaming/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>(
        (params) => Effect.succeed({ name: params.userId }),
        { streaming: true },
      ),
    );

    const out = Effect.runSync(
      (Component.renderEffect(StreamingUser, {}).pipe(Effect.provide(memoryRouter("/streaming/users/alice"))) as unknown as Effect.Effect<unknown, never, never>),
    );

    expect(["Initial", "Success", "Failure"]).toContain(String(out));
  });

  it("marks loader cache stale when reactivity key is invalidated through service", () => {
    clearLoaderCache();
    const service = Effect.runSync(
      Effect.service(Reactivity.ReactivityTag).pipe(Effect.provide(Reactivity.test)) as Effect.Effect<Reactivity.ReactivityService, never, never>,
    );
    const restore = installReactivityService(service);

    try {
      const RouteWithKey = Component.from<{}>(() => null).pipe(
        Component.route("/reactive/users/:userId", { params: Schema.Struct({ userId: Schema.String }) }),
        Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>(
          (params) => Effect.succeed({ name: params.userId }),
          { reactivityKeys: ["users"], staleTime: "5 minutes" },
        ),
      );
      void RouteWithKey;

      const results = Effect.runSync(Route.runMatchedLoaders(new URL("http://test.local/reactive/users/alice")));
      const routeId = results[0]?.routeId;
      expect(routeId).toBeDefined();

      const before = getLoaderCacheEntry(String(routeId), { userId: "alice" });
      expect(before).toBeDefined();
      expect(before ? isFresh(before) : false).toBe(true);

      Effect.runSync(service.invalidate(["users"]));
      Effect.runSync(service.flush());

      const after = getLoaderCacheEntry(String(routeId), { userId: "alice" });
      expect(after).toBeDefined();
      expect(after ? isFresh(after) : true).toBe(false);
    } finally {
      restore();
    }
  });

  it("captures reactivity keys from atoms read inside loaders", () => {
    clearLoaderCache();
    const reactiveName = Atom.value("alice").pipe(Atom.withReactivity(["users"]));

    const ReactiveLoaderRoute = Component.from<{}>(() => null).pipe(
      Component.route("/reactive-capture/users/:userId", { params: Schema.Struct({ userId: Schema.String }) }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>(() =>
        Effect.sync(() => ({ name: reactiveName() })),
      ),
    );
    void ReactiveLoaderRoute;

    const results = Effect.runSync(Route.runMatchedLoaders(new URL("http://test.local/reactive-capture/users/alice")));
    const routeId = results[0]?.routeId;
    const entry = getLoaderCacheEntry(String(routeId), { userId: "alice" });

    expect(entry?.reactivityKeys).toContain("users");
  });

  it("resolves route title/meta from loader data", () => {
    let observedTitle: string | undefined;
    let observedDescription: string | undefined;

    const ProfilePage = Route.meta((params: { readonly userId: string }, loaderData: { readonly name: string } | undefined) => {
      observedDescription = `User ${params.userId} (${loaderData?.name ?? "n/a"})`;
      return { description: observedDescription };
    })(
      Route.title((_params: { readonly userId: string }, loaderData: { readonly name: string } | undefined) => {
        observedTitle = `Profile: ${loaderData?.name ?? "Unknown"}`;
        return observedTitle;
      })(
        Route.loader((params: { readonly userId: string }) => Effect.succeed({ name: params.userId.toUpperCase() }))(
          Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
            Route.path("/head/users/:userId")(Component.from<{}>(() => null)),
          ),
        ),
      ),
    );

    Effect.runSync(
      Route.renderRequest(ProfilePage, { request: new Request("http://test.local/head/users/alice") }),
    );

    expect(observedTitle).toBe("Profile: ALICE");
    expect(observedDescription).toBe("User alice (ALICE)");
  });

  it("supports typed tagged loader error handlers on unified routes", () => {
    const ErrorRoute = Route.loaderError({
      UserNotFound: (error, params) => `missing:${params.userId}:${error.id}`,
    })(
      Route.loader((params: { readonly userId: string }) =>
        Effect.fail({ _tag: "UserNotFound", id: params.userId } as const))(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
          Route.path("/users/:userId/error")(Component.from<{}>(() => "ok")),
        ),
      ),
    );

    const cases = ErrorRoute[Route.UnifiedRouteSymbol].loaderErrorCases as {
      readonly UserNotFound?: (error: { readonly _tag: "UserNotFound"; readonly id: string }, params: { readonly userId: string }) => string;
    };

    expect(cases.UserNotFound?.({ _tag: "UserNotFound", id: "alice" }, { userId: "alice" })).toBe("missing:alice:alice");
  });

  it("recomputes route head callbacks when route params change", () => {
    let observedTitle = "";

    const HeadRoute = Route.title((params: { readonly userId: string }) => {
        observedTitle = `Profile ${params.userId}`;
        return observedTitle;
      })(
      Route.loader((params: { readonly userId: string }) => Effect.succeed({ name: params.userId }))(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
          Route.path("/headlive/users/:userId")(Component.from<{}>(() => null)),
        ),
      ),
    );

    Effect.runSync(Route.renderRequest(HeadRoute, { request: new Request("http://test.local/headlive/users/alice") }));
    expect(observedTitle).toBe("Profile alice");
    Effect.runSync(Route.renderRequest(HeadRoute, { request: new Request("http://test.local/headlive/users/bob") }));
    expect(observedTitle).toBe("Profile bob");
  });

  it("builds single-flight payload with mutation plus revalidated loaders", () => {
    const RouteForFlight = Route.loader((params: { readonly userId: string }) => Effect.succeed({ name: params.userId }))(
      withUserIdRoute("/sfm/users/:userId", Component.from<{}>(() => null)),
    );
    void RouteForFlight;

    const run = Effect.runSync(
      Route.actionSingleFlight((userId: string) => Effect.succeed({ ok: userId }), {
        app: RouteForFlight,
        target: (_result, [userId]) => `/sfm/users/${userId}`,
      }),
    );

    const payload = Effect.runSync(
      run("alice").pipe(Effect.provide(memoryRouter("/"))) as Effect.Effect<Route.SingleFlightPayload<{ readonly ok: string }>, never, never>,
    );

    expect(payload.mutation.ok).toBe("alice");
    expect(payload.url.endsWith("/sfm/users/alice")).toBe(true);
    expect(payload.loaders.length).toBeGreaterThan(0);
  });

  it("revalidates only loaders whose captured reactivity keys were invalidated", () => {
    clearLoaderCache();
    const usersAtom = Atom.value("alice").pipe(Atom.withReactivity(["users"]));
    const postsAtom = Atom.value("post-1").pipe(Atom.withReactivity(["posts"]));

    const UserRoute = Route.loader((_: { readonly userId: string }) =>
      Effect.sync(() => ({ name: usersAtom() })))(
      withUserIdRoute("/sfm-reactivity/users/:userId", Component.from<{}>(() => null)),
    );
    const PostsRoute = Route.loader((_: { readonly userId: string }) =>
      Effect.sync(() => ({ post: postsAtom() })))(
      withUserIdRoute("/sfm-reactivity/users/:userId/posts", Component.from<{}>(() => null)),
    );
    const App = Route.children([UserRoute, PostsRoute])(
      Route.layout()(Route.path("/")(Component.from<{}>(() => null))),
    );

    Effect.runSync(Route.runMatchedLoaders(App, new URL("http://test.local/sfm-reactivity/users/alice/posts")));

    const run = Effect.runSync(
      Route.actionSingleFlight(() => Effect.sync(() => {
        Atom.invalidateReactivity(["users"]);
        return { ok: true as const };
      }), {
        app: App,
        target: "/sfm-reactivity/users/alice/posts",
      }),
    );

    const payload = Effect.runSync(
      run().pipe(Effect.provide(memoryRouter("/"))) as Effect.Effect<Route.SingleFlightPayload<{ readonly ok: true }>, never, never>,
    );

    expect(payload.loaders.length).toBe(1);
    expect((payload.loaders[0]?.result as any)?.value?.name).toBe("alice");
  });

  it("captures tracked service reads and invalidating service writes for single-flight", () => {
    clearLoaderCache();
    const usersState = Atom.value([{ id: "alice", name: "Alice" }]);
    const Users = ServiceMap.Service<{
      readonly byId: (id: string) => Effect.Effect<{ readonly id: string; readonly name: string }>;
      readonly rename: (id: string, name: string) => Effect.Effect<{ readonly id: string; readonly name: string }>;
    }>("Users:RouteLoaderTest");

    const UsersLive = Layer.succeed(Users, {
      byId: (id: string) => Reactivity.tracked(
        Effect.sync(() => usersState().find((user) => user.id === id) ?? { id, name: "Unknown" }),
        { keys: ["users", `user:${id}`] },
      ),
      rename: (id: string, name: string) => Reactivity.invalidating(
        Effect.sync(() => {
          const next = { id, name };
          usersState.update((prev) => prev.map((user) => user.id === id ? next : user));
          return next;
        }),
        (user) => ["users", `user:${user.id}`],
      ),
    });

    const ServiceRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.gen(function* () {
        const users = yield* Users;
        return yield* users.byId(params.userId);
      }))(withUserIdRoute("/service/users/:userId", Component.from<{}>(() => null)));

    Effect.runSync(
      Route.runMatchedLoaders(ServiceRoute, new URL("http://test.local/service/users/alice")).pipe(Effect.provide(UsersLive)) as Effect.Effect<unknown, never, never>,
    );

    const run = Effect.runSync(Route.actionSingleFlight(
      (id: string, name: string) => Effect.gen(function* () {
        const users = yield* Users;
        return yield* users.rename(id, name);
      }),
      { app: ServiceRoute, target: (_result, [id]) => `/service/users/${id}` },
    ));

    const payload = Effect.runSync(
      run("alice", "Alicia").pipe(
        Effect.provide(UsersLive),
        Effect.provide(memoryRouter("/service/users/alice")),
      ) as Effect.Effect<Route.SingleFlightPayload<{ readonly id: string; readonly name: string }>, never, never>,
    );

    expect(payload.loaders.length).toBe(1);
    expect((payload.loaders[0]?.result as any).value.name).toBe("Alicia");
  });

  it("hydrates loader cache from a single-flight payload", () => {
    clearLoaderCache();
    const RouteForHydrate = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" })(
      withUserIdRoute("/sfm-hydrate/users/:userId", Component.from<{}>(() => null)),
    );
    void RouteForHydrate;

    const run = Effect.runSync(
      Route.actionSingleFlight((userId: string) => Effect.succeed({ ok: userId }), {
        app: RouteForHydrate,
        target: (_result, [userId]) => `/sfm-hydrate/users/${userId}`,
      }),
    );
    const payload = Effect.runSync(
      run("alice").pipe(Effect.provide(memoryRouter("/"))) as Effect.Effect<Route.SingleFlightPayload<{ readonly ok: string }>, never, never>,
    );

    clearLoaderCache();
    Effect.runSync(Route.hydrateSingleFlightPayload(payload as Route.SingleFlightPayload<unknown>, RouteForHydrate));

    const cached = payload.loaders
      .map((item) => getLoaderCacheEntry(item.routeId, { userId: "alice" }))
      .find((entry) => entry !== undefined);
    expect(cached).toBeDefined();
  });

  it("creates server single-flight handler bound to request url", () => {
    const RouteForHandler = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ name: params.userId }))(withUserIdRoute("/sfm-handler/users/:userId", Component.from<{}>(() => null)));
    void RouteForHandler;

    const run = Effect.runSync(
      Route.actionSingleFlight((userId: string) => Effect.succeed({ ok: userId }), {
        app: RouteForHandler,
        target: (_result, [userId]) => `/sfm-handler/users/${userId}`,
      }),
    );

    const handler = Route.createSingleFlightHandler(run, { baseUrl: "http://test.local" });
    const response = Effect.runSync(
      handler({ args: ["alice"], url: "/sfm-handler/users/alice" }) as Effect.Effect<Route.SingleFlightResponse<{ readonly ok: string }, never>, never, never>,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.payload.url).toBe("http://test.local/sfm-handler/users/alice");
      expect(response.payload.loaders.length).toBeGreaterThan(0);
    }
  });

  it("invokes single-flight endpoint and hydrates cache", async () => {
    clearLoaderCache();
    const RouteForInvoke = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" })(
      withUserIdRoute("/sfm-invoke/users/:userId", Component.from<{}>(() => null)),
    );
    void RouteForInvoke;

    const routeId = routeIdOf(RouteForInvoke);
    const payload: Route.SingleFlightPayload<{ readonly ok: string }> = {
      mutation: { ok: "alice" },
      url: "http://test.local/sfm-invoke/users/alice",
      loaders: [
        {
          routeId,
          result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() } as any,
        },
      ],
    };

    const out = await Effect.runPromise(Route.invokeSingleFlight<[string], { readonly ok: string }>(
      "/api/sfm",
      { args: ["alice"], url: "/sfm-invoke/users/alice" },
      {
        app: RouteForInvoke,
        fetch: async () => ({ json: async () => ({ ok: true as const, payload }) }),
      },
    ));

    expect(out.mutation.ok).toBe("alice");
    const cached = getLoaderCacheEntry(routeId, { userId: "alice" });
    expect(cached).toBeDefined();
  });

  it("exposes mutation-style single-flight handle with pending/result ergonomics", () => {
    const RouteForMutationHandle = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ name: params.userId }))(withUserIdRoute("/sfm-mutation/users/:userId", Component.from<{}>(() => null)));
    void RouteForMutationHandle;

    const seen: Array<string> = [];
    const make = Route.mutationSingleFlight((userId: string) => Effect.succeed({ ok: userId }), {
      app: RouteForMutationHandle,
      target: (_result, [userId]) => `/sfm-mutation/users/${userId}`,
      onPayload: (payload) => Effect.sync(() => {
        seen.push(String(payload.mutation.ok));
      }),
    });

    const handle = Effect.runSync(make.pipe(Effect.provide(memoryRouter("/"))) as Effect.Effect<Route.SingleFlightMutationHandle<[string], { readonly ok: string }, never, never>, never, never>);

    const payload = Effect.runSync(handle.runEffect("alice"));
    expect(payload.mutation.ok).toBe("alice");
    expect(payload.loaders.length).toBeGreaterThan(0);
    expect(seen).toEqual(["alice"]);
    expect(handle.result()._tag).toBe("Success");
  });

  it("integrates single-flight transport into Atom.action", async () => {
    clearLoaderCache();
    const AtomRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" })(
      withUserIdRoute("/atom-sfm/users/:userId", Component.from<{}>(() => null)),
    );
    void AtomRoute;

    const routeId = routeIdOf(AtomRoute);
    const saveUser = Atom.action(
      (userId: string) => Effect.succeed({ ok: userId }),
      {
        singleFlight: {
          endpoint: "/api/sfm",
          url: (userId) => `/atom-sfm/users/${userId}`,
          fetch: async () => ({
            json: async () => ({
              ok: true as const,
              payload: {
                mutation: { ok: "alice" },
                url: "http://test.local/atom-sfm/users/alice",
                loaders: [
                  {
                    routeId,
                    result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() } as any,
                  },
                ],
              },
            }),
          }),
        },
      },
    );

    const result = await Effect.runPromise(saveUser.runEffect("alice"));
    expect(result.ok).toBe("alice");
    expect(getLoaderCacheEntry(routeId, { userId: "alice" })).toBeDefined();
  });

  it("integrates single-flight transport into Atom.runtime(...).action", async () => {
    clearLoaderCache();
    const RuntimeRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" })(
      withUserIdRoute("/runtime-sfm/users/:userId", Component.from<{}>(() => null)),
    );
    void RuntimeRoute;

    const routeId = routeIdOf(RuntimeRoute);
    const runtime = Atom.runtime(Layer.empty);
    const saveUser = runtime.action(
      (userId: string) => Effect.succeed({ ok: userId }),
      {
        singleFlight: {
          endpoint: "/api/sfm",
          url: (userId) => `/runtime-sfm/users/${userId}`,
          fetch: async () => ({
            json: async () => ({
              ok: true as const,
              payload: {
                mutation: { ok: "alice" },
                url: "http://test.local/runtime-sfm/users/alice",
                loaders: [
                  {
                    routeId,
                    result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() } as any,
                  },
                ],
              },
            }),
          }),
        },
      },
    );

    const result = await Effect.runPromise(saveUser.runEffect("alice"));
    expect(result.ok).toBe("alice");
    expect(getLoaderCacheEntry(routeId, { userId: "alice" })).toBeDefined();
    await runtime.dispose();
  });

  it("uses installed transport automatically in Atom.runtime(...).action", async () => {
    clearLoaderCache();
    const AutoRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" })(
      withUserIdRoute("/auto-runtime/users/:userId", Component.from<{}>(() => null)),
    );
    const routeId = routeIdOf(AutoRoute);
    const runtime = Atom.runtime(Layer.succeed(Route.SingleFlightTransportTag, {
      execute: () => Effect.succeed({
        ok: true as const,
        payload: {
          mutation: { ok: "alice" },
          url: "http://test.local/auto-runtime/users/alice",
          loaders: [{ routeId, result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() } as any }],
        },
      }) as any,
    }));
    const saveUser = runtime.action(
      (userId: string) => Effect.succeed({ ok: userId }),
      { name: "/api/sfm/auto-runtime" },
    );

    const result = await Effect.runPromise(saveUser.runEffect("alice"));
    expect(result.ok).toBe("alice");
    expect(getLoaderCacheEntry(routeId, { userId: "alice" })).toBeDefined();
    await runtime.dispose();
  });

  it("uses globally installed transport automatically in Atom.action", async () => {
    clearLoaderCache();
    const AutoRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" })(
      withUserIdRoute("/auto-global/users/:userId", Component.from<{}>(() => null)),
    );
    const routeId = routeIdOf(AutoRoute);
    const restore = installSingleFlightTransport({
      execute: () => Effect.succeed({
        ok: true as const,
        payload: {
          mutation: { ok: "alice" },
          url: "http://test.local/auto-global/users/alice",
          loaders: [{ routeId, result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() } as any }],
        },
      }) as any,
    });

    try {
      const saveUser = Atom.action(
        (userId: string) => Effect.succeed({ ok: userId }),
        { name: "/api/sfm/auto-global" },
      );
      const result = await Effect.runPromise(saveUser.runEffect("alice"));
      expect(result.ok).toBe("alice");
      expect(getLoaderCacheEntry(routeId, { userId: "alice" })).toBeDefined();
    } finally {
      restore();
    }
  });

  it("can seed loader payload directly from mutation result and skip rerun", () => {
    clearLoaderCache();
    let loaderRuns = 0;

    const SeededRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.sync(() => {
        loaderRuns += 1;
        return { name: `server-${params.userId}` };
      }))(withUserIdRoute("/sfm-seeded/users/:userId", Component.from<{}>(() => null)));

    const run = Effect.runSync(
      Route.actionSingleFlight((userId: string) => Effect.succeed({ id: userId, name: `client-${userId}` }), {
        app: SeededRoute,
        target: (_result, [userId]) => `/sfm-seeded/users/${userId}`,
        revalidate: "none",
        setLoaders: (result) => [Route.setLoaderData(SeededRoute, { name: result.name })],
      }),
    );

    const payload = Effect.runSync(
      run("alice").pipe(Effect.provide(memoryRouter("/"))) as Effect.Effect<Route.SingleFlightPayload<{ readonly id: string; readonly name: string }>, never, never>,
    );

    expect(payload.loaders).toHaveLength(1);
    expect((payload.loaders[0]?.result as any).value.name).toBe("client-alice");
    expect(loaderRuns).toBe(0);

    Effect.runSync(Route.hydrateSingleFlightPayload(payload as Route.SingleFlightPayload<unknown>, SeededRoute));
    const routeId = routeIdOf(SeededRoute);
    const cached = getLoaderCacheEntry(routeId, { userId: "alice" });
    expect((cached?.result as any).value.name).toBe("client-alice");
  });

  it("supports high-level singleFlight handler with direct loader seeding", () => {
    clearLoaderCache();
    let loaderRuns = 0;

    const SeededRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.sync(() => {
        loaderRuns += 1;
        return { name: `server-${params.userId}` };
      }))(withUserIdRoute("/sfm-endpoint/users/:userId", Component.from<{}>(() => null)));

    const handler = Route.singleFlight(
      (userId: string) => Effect.succeed({ id: userId, name: `client-${userId}` }),
      {
        app: SeededRoute,
        baseUrl: "http://test.local",
        target: (_result, [userId]) => `/sfm-endpoint/users/${userId}`,
        revalidate: "none",
        setLoaders: (result) => [Route.setLoaderData(SeededRoute, { name: result.name })],
      },
    );

    const response = Effect.runSync(
      handler({ args: ["alice"], url: "/sfm-endpoint/users/alice" }) as Effect.Effect<Route.SingleFlightResponse<{ readonly id: string; readonly name: string }, never>, never, never>,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.payload.loaders).toHaveLength(1);
      expect((response.payload.loaders[0]?.result as any).value.name).toBe("client-alice");
    }
    expect(loaderRuns).toBe(0);
  });

  it("supports seedLoader helper for common direct-set cases", () => {
    clearLoaderCache();

    const UserRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ id: params.userId, name: `server-${params.userId}` }))(
      withUserIdRoute("/sfm-seed-helper/users/:userId", Component.from<{}>(() => null)),
    );

    const handler = Route.singleFlight(
      (userId: string) => Effect.succeed({ id: userId, name: `client-${userId}` }),
      {
        app: UserRoute,
        baseUrl: "http://test.local",
        target: (_result, [userId]) => `/sfm-seed-helper/users/${userId}`,
        revalidate: "none",
        setLoaders: Route.seedLoader(UserRoute),
      },
    );

    const response = Effect.runSync(
      handler({ args: ["alice"], url: "/sfm-seed-helper/users/alice" }) as Effect.Effect<Route.SingleFlightResponse<{ readonly id: string; readonly name: string }, never>, never, never>,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect((response.payload.loaders[0]?.result as any).value.name).toBe("client-alice");
    }
  });
});
