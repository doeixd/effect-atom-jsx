import { describe, expect, it } from "vitest";
import { Effect, Layer, Schema, Context } from "effect";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import { Result } from "../effect-ts.js";
import { RouteLoaderTimeoutError, clearLoaderCache, getLoaderCacheEntry, isFresh } from "../router-runtime.js";
import * as Reactivity from "../Reactivity.js";
import { installReactivityService } from "../reactivity-runtime.js";

function memoryRouter(initial: string) {
  const url = Atom.value(new URL(initial, "http://test.local"));
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


/** Narrow a loader result's success value to an object field, castlessly. */
function successField(result: unknown, name: string): unknown {
  if (typeof result !== "object" || result === null) return undefined;
  const tagged = result as { readonly _tag?: unknown; readonly value?: unknown };
  if (tagged._tag !== "Success") return undefined;
  const value = tagged.value;
  return typeof value === "object" && value !== null && name in value
    ? (value as Record<string, unknown>)[name]
    : undefined;
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
      // KNOWN INFERENCE GAP (ADR-006 collapse, see LoaderRouteEnhancer): a
      // pipe-built sugar route loses its component facet in contextual
      // inference, so this render still needs the cast.
      Component.renderEffect(UserPage, {}).pipe(Effect.provide(memoryRouter("/users/alice"))) as Effect.Effect<unknown, never, never>,
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

    // R2: routes no longer self-register; the registry is explicit and route
    // identity is the resolved pattern (no `route-N` counter).
    const routes = Route.registry([Parent, Child]);

    const results = Effect.runSync(Route.runMatchedLoaders(routes, new URL("http://test.local/users/alice/posts")));
    const child = results.find((r) => r.routeId === "/users/:userId/posts");
    expect(child).toBeDefined();
  });

  it("preloads matched route loaders without navigating the memory router", () => {
    clearLoaderCache();
    let loads = 0;
    const User = Component.from<{}>(() => null).pipe(
      Component.route("/preload/users/:userId", { params: Schema.Struct({ userId: Schema.String }) }),
      Route.loader<{ readonly userId: string }, { readonly id: string }, never, never>((params) =>
        Effect.sync(() => {
          loads += 1;
          return { id: params.userId };
        })),
    );

    // R2: `preload` resolves the app's routes from the injected route source
    // instead of a module-global registry.
    Effect.runSync(
      Effect.gen(function* () {
        const router = yield* Route.RouterTag;
        if (router.preload) {
          yield* router.preload("/preload/users/alice");
        }
        expect(router.url().pathname).toBe("/");
      }).pipe(
        Effect.provide(Route.Memory("/")),
        Effect.provide(Route.routeSourceLayer(Route.registry([User]))),
      ) as Effect.Effect<void, never, never>,
    );

    expect(loads).toBe(1);
  });

  it("serializes streamed loader payload and sitemap entries", () => {
    const entries = Effect.runSync(Route.collectSitemapEntries(Route.registry([]), "https://example.com"));
    expect(entries).toEqual([]);

    const serialized = Route.serializeLoaderData([
      { routeId: "r1", result: Result.success({ ok: true }) },
    ]);
    const parsed = Route.deserializeLoaderData(serialized);
    expect(parsed.r1).toBeDefined();

    // R2: the ad-hoc `__LOADER_DATA__`/`__HYDRATE_ROUTE__` pair is replaced by
    // one declared, versioned envelope.
    const scripts = Route.streamDeferredLoaderScripts([
      { routeId: "r1", result: Result.success(1) },
    ]);
    // R6 (DQ-034): one handoff. Streamed entries are inert JSON on the
    // manifest channel; neither the legacy ad-hoc global nor the handoff
    // global appears in served scripts.
    expect(scripts[0]).toContain(Route.loaderEntryScriptAttribute);
    expect(scripts[0]).toContain('type="application/json"');
    expect(scripts[0]).not.toContain(Route.loaderHandoffGlobalKey);
    expect(scripts[0]).not.toContain("__LOADER_DATA__");
  });

  // ── Finding-5 characterization: pin the CURRENT on-the-wire loader-result
  // shape. Runtime loader state is core Result, but the wire remains the flat
  // JSON-safe DTO at the Serialization seam.
  it("pins the current loader-result wire shape for core Result", () => {
    const successWire = JSON.parse(Route.serializeLoaderData([
      { routeId: "r1", result: Result.success({ n: 1 }) },
    ]));
    expect(successWire.r1).toMatchObject({ _tag: "Success", value: { n: 1 }, waiting: false });
    expect(typeof successWire.r1.timestamp).toBe("number");

    const failureWire = JSON.parse(Route.serializeLoaderData([
      { routeId: "r2", result: Result.failure({ _tag: "Boom" }) },
    ]));
    expect(failureWire.r2).toEqual({ _tag: "Failure", error: { _tag: "Boom" }, waiting: false, previousSuccess: null });

    // deserialize returns core Result, not the flat DTO.
    const roundTrip = Route.deserializeLoaderData(Route.serializeLoaderData([
      { routeId: "r3", result: Result.success([1, 2, 3]) },
    ]));
    expect(roundTrip.r3?._tag).toBe("Success");
    expect(roundTrip.r3?._tag === "Success" ? roundTrip.r3.value : undefined).toEqual([1, 2, 3]);
  });

  // ── Security: SSR loader data must not break out of a <script> tag (XSS).
  it("escapes HTML-unsafe chars in serialized loader data (script-injection safety)", () => {
    const hostile = "</script><script>alert(1)</script>";
    const payload = [
      { routeId: "r1", result: Result.success({ html: hostile, amp: "a&b", lt: "1<2>0" }) },
    ];

    // serializeLoaderData: no literal `</script>` (or raw < > &) survives...
    const wire = Route.serializeLoaderData(payload);
    expect(wire).not.toContain("</script>");
    expect(wire).not.toContain("<");
    expect(wire).not.toContain(">");
    expect(wire.includes("\\u003c")).toBe(true);
    // ...but it still round-trips to the exact original value.
    expect(Route.deserializeLoaderData(wire).r1).toEqual(payload[0].result);

    // streamDeferredLoaderScripts: the embedded <script> body is injection-safe.
    const scripts = Route.streamDeferredLoaderScripts(payload);
    const body = scripts[0]!.replace(/^<script>/, "").replace(/<\/script>$/, "");
    expect(body).not.toContain("</script>");
    expect(body).not.toContain("<script>");

    // line separators U+2028/U+2029 (valid JSON, invalid JS) are also escaped.
    const u2028 = String.fromCharCode(0x2028);
    const u2029 = String.fromCharCode(0x2029);
    const sepValue = `a${u2028}b${u2029}c`;
    const sepWire = Route.serializeLoaderData([
      { routeId: "r2", result: Result.success(sepValue) },
    ]);
    expect(sepWire).not.toContain(u2028);
    expect(sepWire).not.toContain(u2029);
    const sepResult = Route.deserializeLoaderData(sepWire).r2;
    expect(sepResult?._tag === "Success" ? sepResult.value : undefined).toBe(sepValue);
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

    const streamed = Effect.runSync(Route.runStreamingNavigation(
      Route.registry([Critical, Deferred]),
      new URL("http://test.local/stream/users/alice/details"),
    ));
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

  it("reports unknown route ids during single-flight hydration via onMissingRoute", () => {
    clearLoaderCache();
    const UserRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ id: params.userId }))(
      Route.id("sf.users.known")(
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
          routeId: "sf.users.unknown",
          result: Result.success({ id: "nobody" }),
        },
        {
          routeId: "sf.users.known",
          result: Result.success({ id: "alice" }),
        },
      ],
    } satisfies Route.SingleFlightPayload<{ readonly ok: boolean }>;

    const missing: Array<string> = [];
    Effect.runSync(Route.hydrateSingleFlightPayload(payload, UserRoute, {
      onMissingRoute: (routeId) => {
        missing.push(routeId);
      },
    }));

    expect(missing).toEqual(["sf.users.unknown"]);
    // The known entry still hydrates; nothing is hydrated under the unknown id.
    expect(getLoaderCacheEntry("sf.users.known", { userId: "alice" })?.result?._tag).toBe("Success");
    expect(getLoaderCacheEntry("sf.users.unknown", { userId: "alice" })).toBeUndefined();
    expect(getLoaderCacheEntry("sf.users.unknown", {})).toBeUndefined();
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
      // KNOWN INFERENCE GAP (ADR-006 collapse): same as above.
      Component.renderEffect(StreamingUser, {}).pipe(Effect.provide(memoryRouter("/streaming/users/alice"))) as Effect.Effect<unknown, never, never>,
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
      const results = Effect.runSync(Route.runMatchedLoaders(
        Route.registry([RouteWithKey]),
        new URL("http://test.local/reactive/users/alice"),
      ));
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

  it("accepts reactivity key witnesses in loader options and matcher filters", () => {
    clearLoaderCache();
    const service = Effect.runSync(
      Effect.service(Reactivity.ReactivityTag).pipe(Effect.provide(Reactivity.test)) as Effect.Effect<Reactivity.ReactivityService, never, never>,
    );
    const restore = installReactivityService(service);

    const Projects = Reactivity.Key.make("projects");

    try {
      const RouteWithWitness = Component.from<{}>(() => null).pipe(
        Component.route("/witness/projects/:projectId", { params: Schema.Struct({ projectId: Schema.String }) }),
        Route.loader<{ readonly projectId: string }, { readonly name: string }, never, never>(
          (params) => Effect.succeed({ name: params.projectId }),
          { reactivityKeys: [Projects.child("p1")], staleTime: "5 minutes" },
        ),
      );
      const routes = Route.registry([RouteWithWitness]);

      const url = new URL("http://test.local/witness/projects/p1");
      const results = Effect.runSync(Route.runMatchedLoaders(routes, url));
      const routeId = results[0]?.routeId;
      expect(routeId).toBeDefined();

      // witness expanded to ancestors + self in the cache entry
      const entry = getLoaderCacheEntry(String(routeId), { projectId: "p1" });
      expect(entry?.reactivityKeys).toContain("projects");
      expect(entry?.reactivityKeys).toContain("projects:p1");

      // matcher filter accepts a witness and selects the loader via the parent key
      const matched = Effect.runSync(Route.runMatchedLoaders(routes, url, { reactivityKeys: [Projects] }));
      expect(matched.map((item) => item.routeId)).toContain(String(routeId));

      // invalidating the parent witness marks the child-keyed cache entry stale
      Effect.runSync(service.invalidate(["projects"]));
      Effect.runSync(service.flush());
      const after = getLoaderCacheEntry(String(routeId), { projectId: "p1" });
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
    const results = Effect.runSync(Route.runMatchedLoaders(
      Route.registry([ReactiveLoaderRoute]),
      new URL("http://test.local/reactive-capture/users/alice"),
    ));
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

  // Finding-5: the title/meta loaderResult (3rd) callback param is the unified
  // Result model, not FetchResult. A settled loader gives a unified `Success`.
  it("passes the unified Result model to title/meta loaderResult callbacks", () => {
    let observedTag: string | undefined;
    let observedValue: unknown;

    const Page = Route.title((
      _params: { readonly userId: string },
      _loaderData: { readonly name: string } | undefined,
      loaderResult,
    ) => {
      observedTag = loaderResult?._tag;
      // unified Success carries `.value`; there is no FetchResult `waiting`/`timestamp`
      observedValue = loaderResult?._tag === "Success" ? loaderResult.value : undefined;
      expect(loaderResult && "waiting" in loaderResult).toBe(false);
      return "t";
    })(
      Route.loader((params: { readonly userId: string }) => Effect.succeed({ name: params.userId.toUpperCase() }))(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
          Route.path("/head-result/users/:userId")(Component.from<{}>(() => null)),
        ),
      ),
    );

    Effect.runSync(
      Route.renderRequest(Page, { request: new Request("http://test.local/head-result/users/alice") }),
    );

    expect(observedTag).toBe("Success");
    expect(observedValue).toEqual({ name: "ALICE" });
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
        // Default mode is "reactivity": a mutation that invalidates nothing
        // returns no loader entries. "matched" always returns the matched set.
        revalidate: "matched",
      }),
    );

    const payload = Effect.runSync(
      run("alice").pipe(Effect.provide(memoryRouter("/"))) as Effect.Effect<Route.SingleFlightPayload<{ readonly ok: string }>, never, never>,
    );

    expect(payload.mutation.ok).toBe("alice");
    expect(payload.url.endsWith("/sfm/users/alice")).toBe(true);
    expect(payload.loaders.length).toBeGreaterThan(0);
  });

  it('revalidate: "matched" returns all matched loader results', () => {
    clearLoaderCache();
    const UserRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ name: params.userId }))(
      Route.id("sfm.matched.user")(withUserIdRoute("/sfm-matched/users/:userId", Component.from<{}>(() => null))),
    );
    const PostsRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ posts: [`post-for-${params.userId}`] }))(
      Route.id("sfm.matched.posts")(withUserIdRoute("/sfm-matched/users/:userId/posts", Component.from<{}>(() => null))),
    );
    const App = Route.children([UserRoute, PostsRoute])(
      Route.layout()(Route.path("/")(Component.from<{}>(() => null))),
    );

    const run = Effect.runSync(
      Route.actionSingleFlight(() => Effect.succeed({ ok: true as const }), {
        app: App,
        target: "/sfm-matched/users/alice/posts",
        revalidate: "matched",
      }),
    );

    const payload = Effect.runSync(
      run().pipe(Effect.provide(memoryRouter("/"))) as Effect.Effect<Route.SingleFlightPayload<{ readonly ok: true }>, never, never>,
    );

    const routeIds = payload.loaders.map((item) => item.routeId);
    expect(routeIds).toContain("sfm.matched.user");
    expect(routeIds).toContain("sfm.matched.posts");
    expect(payload.loaders.length).toBe(2);
  });

  it('revalidate: "reactivity" with no invalidations returns no loaders and runs them once', () => {
    clearLoaderCache();
    let executions = 0;
    const UserRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.sync(() => {
        executions += 1;
        return { name: params.userId };
      }))(
      Route.id("sfm.empty.user")(withUserIdRoute("/sfm-empty/users/:userId", Component.from<{}>(() => null))),
    );

    const run = Effect.runSync(
      Route.actionSingleFlight((userId: string) => Effect.succeed({ ok: userId }), {
        app: UserRoute,
        target: (_result, [userId]) => `/sfm-empty/users/${userId}`,
      }),
    );

    const payload = Effect.runSync(
      run("alice").pipe(Effect.provide(memoryRouter("/"))) as Effect.Effect<Route.SingleFlightPayload<{ readonly ok: string }>, never, never>,
    );

    // Nothing was invalidated: the payload carries no loader entries, and the
    // loader executed exactly the single matched pass (no duplicate rerun).
    expect(payload.loaders.length).toBe(0);
    expect(executions).toBe(1);
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
    expect(successField(payload.loaders[0]?.result, "name")).toBe("alice");
  });

  it("captures tracked service reads and invalidating service writes for single-flight", () => {
    clearLoaderCache();
    const usersState = Atom.value([{ id: "alice", name: "Alice" }]);
    const Users = Context.Service<{
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
    expect(successField(payload.loaders[0]?.result, "name")).toBe("Alicia");
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
        // The mutation invalidates nothing; "matched" keeps loader data in the payload.
        revalidate: "matched",
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
        // The mutation invalidates nothing; "matched" keeps loader data in the payload.
        revalidate: "matched",
      }),
    );

    const handler = Route.createSingleFlightHandler(run, { baseUrl: "http://test.local" });
    const response = Effect.runSync(
      handler({ args: ["alice"], url: "/sfm-handler/users/alice" }) as Effect.Effect<Route.SingleFlightWireResponse, never, never>,
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
    // The value a fake fetch returns is the WIRE payload — the flat DTO the
    // schema validates — not the in-memory `SingleFlightPayload` of core
    // Results, so it types against the exported wire schema.
    const payload: typeof Route.SingleFlightWirePayloadSchema.Type = {
      mutation: { ok: "alice" },
      url: "http://test.local/sfm-invoke/users/alice",
      loaders: [
        {
          routeId,
          result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() },
        },
      ],
    };

    const out = await Effect.runPromise(Route.invokeSingleFlight<[string], { readonly ok: string }>(
      "/api/sfm",
      { args: ["alice"], url: "/sfm-invoke/users/alice" },
      {
        app: RouteForInvoke,
        fetch: async () => ({ json: async () => ({ version: 1, ok: true as const, payload }) }),
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
      // The mutation invalidates nothing; "matched" keeps loader data in the payload.
      revalidate: "matched",
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
    const routeId = routeIdOf(AtomRoute);
    const saveUser = Atom.action(
      (userId: string) => Effect.succeed({ ok: userId }),
      {
        singleFlight: {
          app: AtomRoute,
          endpoint: "/api/sfm",
          url: (userId) => `/atom-sfm/users/${userId}`,
          fetch: async () => ({
            json: async () => ({
              version: 1,
              ok: true as const,
              payload: {
                mutation: { ok: "alice" },
                url: "http://test.local/atom-sfm/users/alice",
                loaders: [
                  {
                    routeId,
                    result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() },
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
    const routeId = routeIdOf(RuntimeRoute);
    const runtime = Atom.runtime(Layer.empty);
    const saveUser = runtime.action(
      (userId: string) => Effect.succeed({ ok: userId }),
      {
        singleFlight: {
          app: RuntimeRoute,
          endpoint: "/api/sfm",
          url: (userId) => `/runtime-sfm/users/${userId}`,
          fetch: async () => ({
            json: async () => ({
              version: 1,
              ok: true as const,
              payload: {
                mutation: { ok: "alice" },
                url: "http://test.local/runtime-sfm/users/alice",
                loaders: [
                  {
                    routeId,
                    result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() },
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
        version: 1,
        ok: true as const,
        payload: {
          mutation: { ok: "alice" },
          url: "http://test.local/auto-runtime/users/alice",
          loaders: [{ routeId, result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() } }],
        },
      }),
    }));
    const saveUser = runtime.action(
      (userId: string) => Effect.succeed({ ok: userId }),
      { name: "/api/sfm/auto-runtime", singleFlight: { app: AutoRoute } },
    );

    const result = await Effect.runPromise(saveUser.runEffect("alice"));
    expect(result.ok).toBe("alice");
    expect(getLoaderCacheEntry(routeId, { userId: "alice" })).toBeDefined();
    await runtime.dispose();
  });

  it("uses a context-provided transport in free Atom.action (no process-global slot)", async () => {
    // DQ-033: the process-global transport install is deleted. A free action
    // reaches a transport exclusively through Effect context, so the caller
    // provides it as a layer on `runEffect` — request-scoped by construction.
    clearLoaderCache();
    const AutoRoute = Route.loader((params: { readonly userId: string }) =>
      Effect.succeed({ name: params.userId }), { staleTime: "5 minutes" })(
      withUserIdRoute("/auto-global/users/:userId", Component.from<{}>(() => null)),
    );
    const routeId = routeIdOf(AutoRoute);
    const transport = Layer.succeed(Route.SingleFlightTransportTag, {
      execute: () => Effect.succeed({
        version: 1,
        ok: true as const,
        payload: {
          mutation: { ok: "alice" },
          url: "http://test.local/auto-global/users/alice",
          loaders: [{ routeId, result: { _tag: "Success", value: { name: "alice" }, waiting: false, timestamp: Date.now() } }],
        },
      }),
    });

    const saveUser = Atom.action(
      (userId: string) => Effect.succeed({ ok: userId }),
      { name: "/api/sfm/auto-global", singleFlight: { app: AutoRoute } },
    );
    const result = await Effect.runPromise(
      saveUser.runEffect("alice").pipe(Effect.provide(transport)) as Effect.Effect<{ readonly ok: string }, never, never>,
    );
    expect(result.ok).toBe("alice");
    expect(getLoaderCacheEntry(routeId, { userId: "alice" })).toBeDefined();
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
    expect(successField(payload.loaders[0]?.result, "name")).toBe("client-alice");
    expect(loaderRuns).toBe(0);

    Effect.runSync(Route.hydrateSingleFlightPayload(payload as Route.SingleFlightPayload<unknown>, SeededRoute));
    const routeId = routeIdOf(SeededRoute);
    const cached = getLoaderCacheEntry(routeId, { userId: "alice" });
    expect(successField(cached?.result, "name")).toBe("client-alice");
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
      handler({ args: ["alice"], url: "/sfm-endpoint/users/alice" }) as Effect.Effect<Route.SingleFlightWireResponse, never, never>,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.payload.loaders).toHaveLength(1);
      expect(successField(response.payload.loaders[0]?.result, "name")).toBe("client-alice");
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
      handler({ args: ["alice"], url: "/sfm-seed-helper/users/alice" }) as Effect.Effect<Route.SingleFlightWireResponse, never, never>,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(successField(response.payload.loaders[0]?.result, "name")).toBe("client-alice");
    }
  });

  it("fails a loader that exceeds its configured timeout", async () => {
    clearLoaderCache();
    const SlowRoute = Route.loader((_: { readonly userId: string }) =>
      Effect.never,
      { timeout: 20 },
    )(
      withUserIdRoute("/loader-timeout/users/:userId", Component.from<{}>(() => null)),
    );

    const routeId = routeIdOf(SlowRoute);
    const results = await Effect.runPromise(
      Route.runMatchedLoaders(SlowRoute, new URL("http://test.local/loader-timeout/users/alice")),
    );

    const entry = results.find((item) => item.routeId === routeId);
    expect(entry?.result._tag).toBe("Failure");
    // DQ-036: the timeout is attributable — it names the route and the budget,
    // not a bare `TimeoutError` that names neither.
    const error = entry?.result._tag === "Failure" ? entry.result.error : undefined;
    expect(error).toBeInstanceOf(RouteLoaderTimeoutError);
    if (error instanceof RouteLoaderTimeoutError) {
      expect(error.routeId).toBe(routeId);
      expect(error.timeoutMs).toBe(20);
    }
  });
});
