import { describe, expect, it } from "vitest";
import { Effect, Layer, Schema, ServiceMap } from "effect";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
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

    const ProfilePageBase = Component.from<{}>(() => null).pipe(
      Component.route("/head/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId.toUpperCase() })),
    );

    const ProfilePage = Route.metaFor(
      Route.titleFor(ProfilePageBase, (_params, loaderData) => {
        observedTitle = `Profile: ${loaderData?.name ?? "Unknown"}`;
        return observedTitle;
      }),
      (params, loaderData) => {
        observedDescription = `User ${params.userId} (${loaderData?.name ?? "n/a"})`;
        return { description: observedDescription };
      },
    );

    Effect.runSync(
      (Component.renderEffect(ProfilePage, {}).pipe(Effect.provide(memoryRouter("/head/users/alice"))) as unknown as Effect.Effect<unknown, never, never>),
    );

    expect(observedTitle).toBe("Profile: ALICE");
    expect(observedDescription).toBe("User alice (ALICE)");
  });

  it("supports loaderErrorFor with typed tagged handlers", () => {
    const ErrorBase = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({}),
      () => "ok",
    ).pipe(
      Component.route("/users/:userId/error", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, never, { readonly _tag: "UserNotFound"; readonly id: string }, never>((params) =>
        Effect.fail({ _tag: "UserNotFound", id: params.userId })),
    );

    const ErrorRoute = Route.loaderErrorFor(ErrorBase, {
      UserNotFound: (error, params) => `missing:${params.userId}:${error.id}`,
    });

    const out = Effect.runSync(
      (Component.renderEffect(ErrorRoute, {}).pipe(Effect.provide(memoryRouter("/users/alice/error"))) as unknown as Effect.Effect<unknown, never, never>),
    );

    expect(out).toBe("missing:alice:alice");
  });

  it("recomputes route head callbacks when route params change", () => {
    let observedTitle = "";

    const HeadRoute = Route.titleFor(
      Component.from<{}>(() => null).pipe(
        Component.route("/headlive/users/:userId", {
          params: Schema.Struct({ userId: Schema.String }),
        }),
        Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
          Effect.succeed({ name: params.userId })),
      ),
      (params) => {
        observedTitle = `Profile ${params.userId}`;
        return observedTitle;
      },
    );

    const eff = Effect.gen(function* () {
      yield* Component.setupEffect(HeadRoute, {});
      expect(observedTitle).toBe("Profile alice");

      const router = yield* Route.RouterTag;
      yield* router.navigate("/headlive/users/bob");
      Atom.flush();

      expect(observedTitle).toBe("Profile bob");
    }).pipe(Effect.provide(memoryRouter("/headlive/users/alice")));

    Effect.runSync(eff as Effect.Effect<void, never, never>);
  });

  it("builds single-flight payload with mutation plus revalidated loaders", () => {
    const RouteForFlight = Component.from<{}>(() => null).pipe(
      Component.route("/sfm/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId })),
    );
    void RouteForFlight;

    const run = Effect.runSync(
      Route.actionSingleFlight((userId: string) => Effect.succeed({ ok: userId }), {
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

    const UserRoute = Component.from<{}>(() => null).pipe(
      Component.route("/sfm-reactivity/users/:userId", { params: Schema.Struct({ userId: Schema.String }) }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>(() =>
        Effect.sync(() => ({ name: usersAtom() })),
      ),
    );
    const PostsRoute = Component.from<{}>(() => null).pipe(
      Component.route("/sfm-reactivity/users/:userId/posts", { params: Schema.Struct({ userId: Schema.String }) }),
      Route.loader<{ readonly userId: string }, { readonly post: string }, never, never>(() =>
        Effect.sync(() => ({ post: postsAtom() })),
      ),
    );
    void UserRoute;
    void PostsRoute;

    Effect.runSync(Route.runMatchedLoaders(new URL("http://test.local/sfm-reactivity/users/alice/posts")));

    const run = Effect.runSync(
      Route.actionSingleFlight(() => Effect.sync(() => {
        Atom.invalidateReactivity(["users"]);
        return { ok: true as const };
      }), {
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

    const ServiceRoute = Component.from<{}>(() => null).pipe(
      Component.route("/service/users/:userId", { params: Schema.Struct({ userId: Schema.String }) }),
      Route.loader((params: { readonly userId: string }) =>
        Effect.gen(function* () {
          const users = yield* Users;
          return yield* users.byId(params.userId);
        }),
      ),
    );
    void ServiceRoute;

    Effect.runSync(
      Route.runMatchedLoaders(new URL("http://test.local/service/users/alice")).pipe(Effect.provide(UsersLive)) as Effect.Effect<unknown, never, never>,
    );

    const run = Effect.runSync(Route.actionSingleFlight(
      (id: string, name: string) => Effect.gen(function* () {
        const users = yield* Users;
        return yield* users.rename(id, name);
      }),
      { target: (_result, [id]) => `/service/users/${id}` },
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
    const RouteForHydrate = Component.from<{}>(() => null).pipe(
      Component.route("/sfm-hydrate/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" }),
    );
    void RouteForHydrate;

    const run = Effect.runSync(
      Route.actionSingleFlight((userId: string) => Effect.succeed({ ok: userId }), {
        target: (_result, [userId]) => `/sfm-hydrate/users/${userId}`,
      }),
    );
    const payload = Effect.runSync(
      run("alice").pipe(Effect.provide(memoryRouter("/"))) as Effect.Effect<Route.SingleFlightPayload<{ readonly ok: string }>, never, never>,
    );

    clearLoaderCache();
    Effect.runSync(Route.hydrateSingleFlightPayload(payload as Route.SingleFlightPayload<unknown>));

    const cached = payload.loaders
      .map((item) => getLoaderCacheEntry(item.routeId, { userId: "alice" }))
      .find((entry) => entry !== undefined);
    expect(cached).toBeDefined();
  });

  it("creates server single-flight handler bound to request url", () => {
    const RouteForHandler = Component.from<{}>(() => null).pipe(
      Component.route("/sfm-handler/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId })),
    );
    void RouteForHandler;

    const run = Effect.runSync(
      Route.actionSingleFlight((userId: string) => Effect.succeed({ ok: userId }), {
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
    const RouteForInvoke = Component.from<{}>(() => null).pipe(
      Component.route("/sfm-invoke/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" }),
    );
    void RouteForInvoke;

    const routeId = String((RouteForInvoke as any)[Route.RouteMetaSymbol]?.id ?? "");
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
        fetch: async () => ({ json: async () => ({ ok: true as const, payload }) }),
      },
    ));

    expect(out.mutation.ok).toBe("alice");
    const cached = getLoaderCacheEntry(routeId, { userId: "alice" });
    expect(cached).toBeDefined();
  });

  it("exposes mutation-style single-flight handle with pending/result ergonomics", () => {
    const RouteForMutationHandle = Component.from<{}>(() => null).pipe(
      Component.route("/sfm-mutation/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId })),
    );
    void RouteForMutationHandle;

    const seen: Array<string> = [];
    const make = Route.mutationSingleFlight((userId: string) => Effect.succeed({ ok: userId }), {
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
    const AtomRoute = Component.from<{}>(() => null).pipe(
      Component.route("/atom-sfm/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" }),
    );
    void AtomRoute;

    const routeId = String((AtomRoute as any)[Route.RouteMetaSymbol]?.id ?? "");
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
    const RuntimeRoute = Component.from<{}>(() => null).pipe(
      Component.route("/runtime-sfm/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" }),
    );
    void RuntimeRoute;

    const routeId = String((RuntimeRoute as any)[Route.RouteMetaSymbol]?.id ?? "");
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
    const AutoRoute = Component.from<{}>(() => null).pipe(
      Component.route("/auto-runtime/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" }),
    );
    const routeId = String((AutoRoute as any)[Route.RouteMetaSymbol]?.id ?? "");
    const runtime = Atom.runtime(Layer.succeed(Route.SingleFlightTransportTag, {
      execute: () => Effect.succeed({
        ok: true as const,
        payload: {
          mutation: { ok: "alice" },
          url: "http://test.local/auto-runtime/users/alice",
          loaders: [{ routeId, result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() } as any }],
        },
      }),
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
    const AutoRoute = Component.from<{}>(() => null).pipe(
      Component.route("/auto-global/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" }),
    );
    const routeId = String((AutoRoute as any)[Route.RouteMetaSymbol]?.id ?? "");
    const restore = installSingleFlightTransport({
      execute: () => Effect.succeed({
        ok: true as const,
        payload: {
          mutation: { ok: "alice" },
          url: "http://test.local/auto-global/users/alice",
          loaders: [{ routeId, result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() } as any }],
        },
      }),
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

    const SeededRoute = Component.from<{}>(() => null).pipe(
      Component.route("/sfm-seeded/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.sync(() => {
          loaderRuns += 1;
          return { name: `server-${params.userId}` };
        }),
      ),
    );

    const run = Effect.runSync(
      Route.actionSingleFlight((userId: string) => Effect.succeed({ id: userId, name: `client-${userId}` }), {
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

    Effect.runSync(Route.hydrateSingleFlightPayload(payload as Route.SingleFlightPayload<unknown>));
    const routeId = String((SeededRoute as any)[Route.RouteMetaSymbol]?.id ?? "");
    const cached = getLoaderCacheEntry(routeId, { userId: "alice" });
    expect((cached?.result as any).value.name).toBe("client-alice");
  });

  it("supports high-level singleFlight handler with direct loader seeding", () => {
    clearLoaderCache();
    let loaderRuns = 0;

    const SeededRoute = Component.from<{}>(() => null).pipe(
      Component.route("/sfm-endpoint/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly name: string }, never, never>((params) =>
        Effect.sync(() => {
          loaderRuns += 1;
          return { name: `server-${params.userId}` };
        }),
      ),
    );

    const handler = Route.singleFlight(
      (userId: string) => Effect.succeed({ id: userId, name: `client-${userId}` }),
      {
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

    const UserRoute = Component.from<{}>(() => null).pipe(
      Component.route("/sfm-seed-helper/users/:userId", {
        params: Schema.Struct({ userId: Schema.String }),
      }),
      Route.loader<{ readonly userId: string }, { readonly id: string; readonly name: string }, never, never>((params) =>
        Effect.succeed({ id: params.userId, name: `server-${params.userId}` }),
      ),
    );

    const handler = Route.singleFlight(
      (userId: string) => Effect.succeed({ id: userId, name: `client-${userId}` }),
      {
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
