import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as Serialization from "../Serialization.js";
import { Result } from "../effect-ts.js";
import {
  clearLoaderCache,
  defaultLoaderCacheStore,
  getLoaderCacheEntry,
  makeLoaderCacheStore,
  runCachedLoader,
  LoaderCacheTag,
} from "../router-runtime.js";

/**
 * R2 acceptance: routes carry no module-global state.
 *
 * These tests are the regression guard for the three globals R2 deleted —
 * the route registry, the shared head map, and the module-level loader cache —
 * plus the versioned loader-data handoff that replaced
 * `window.__LOADER_DATA__` / `window.__HYDRATE_ROUTE__`.
 */
describe("router de-globalization (R2)", () => {
  const titledRoute = (pattern: string, title: string, onLoad?: () => void, delayMs = 0) =>
    Route.title(() => title)(
      Route.loader((params: { readonly userId: string }) =>
        Effect.sync(() => {
          onLoad?.();
          return { name: params.userId };
        }).pipe(delayMs > 0 ? Effect.delay(delayMs) : (self) => self), { staleTime: "5 minutes" })(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
          Route.path(pattern)(Component.from<{}>(() => null)),
        ),
      ),
    );

  it("constructing a route has no side effects", () => {
    const First = Route.path("/no-side-effects/:userId")(Component.from<{}>(() => null));
    const Second = Route.path("/no-side-effects/:userId")(Component.from<{}>(() => null));

    // No generated `route-N` identity: routes are keyed by their resolved
    // pattern unless `Route.id(...)` assigns a stable one.
    expect(First[Route.UnifiedRouteSymbol].meta.id).toBeUndefined();
    expect(Second[Route.UnifiedRouteSymbol].meta.id).toBeUndefined();

    // Nothing global to look them up in; a source only ever contains what it
    // was explicitly given.
    expect(Route.collectAll(First).map((entry) => entry.meta.fullPattern))
      .toEqual(["/no-side-effects/:userId"]);
    expect(Route.registry([]).entries).toEqual([]);
    expect(Effect.runSync(Route.resolveRouteSource())).toBeUndefined();
  });

  it("resolves an injected route source instead of a global registry", () => {
    const Page = Component.from<{}>(() => null).pipe(
      Component.route("/injected/:userId", { params: Schema.Struct({ userId: Schema.String }) }),
    );
    const source = Route.registry([Page]);

    const resolved = Effect.runSync(
      Route.resolveRouteSource().pipe(
        Effect.provideService(Route.RouteSourceTag, { source }),
      ) as Effect.Effect<Route.RouteSource | undefined, never, never>,
    );
    expect(resolved).toBe(source);
  });

  it("gives two concurrent server renders isolated head and loader state", async () => {
    let aLoads = 0;
    let bLoads = 0;
    // The loaders suspend, so both renders' loader phases genuinely interleave.
    const A = titledRoute("/iso-a/:userId", "title-a", () => {
      aLoads += 1;
    }, 10);
    const B = titledRoute("/iso-b/:userId", "title-b", () => {
      bLoads += 1;
    }, 5);

    clearLoaderCache();
    const [resultA, resultB] = await Effect.runPromise(Effect.all([
      Route.renderRequest(A, { request: new Request("http://test.local/iso-a/alice") }),
      Route.renderRequest(B, { request: new Request("http://test.local/iso-b/bob") }),
    ], { concurrency: "unbounded" }) as Effect.Effect<
      ReadonlyArray<Route.RenderRequestResult>,
      never,
      never
    >);

    // Each render sees only its own head entry — no cross-render leakage and no
    // `clear()` racing between them.
    expect(resultA?.head.title).toBe("title-a");
    expect(resultB?.head.title).toBe("title-b");
    // A cached loader runs once per request store; a shared cache would have
    // let one render serve the other's loader.
    expect(aLoads).toBe(1);
    expect(bLoads).toBe(1);

    // Server loader data lives in the per-request store, never the client one.
    expect(getLoaderCacheEntry("/iso-a/:userId", { userId: "alice" })).toBeUndefined();
    expect(getLoaderCacheEntry("/iso-b/:userId", { userId: "bob" })).toBeUndefined();
  });

  it("re-runs loaders per server request rather than sharing one cache", async () => {
    let loads = 0;
    const App = titledRoute("/per-request/:userId", "per-request", () => {
      loads += 1;
    });

    await Effect.runPromise(Effect.all([
      Route.renderRequest(App, { request: new Request("http://test.local/per-request/alice") }),
      Route.renderRequest(App, { request: new Request("http://test.local/per-request/alice") }),
    ], { concurrency: "unbounded" }) as Effect.Effect<unknown, never, never>);

    // Both renders ran the same route+params with a 5-minute staleTime: a
    // shared module-level cache would have produced exactly one load.
    expect(loads).toBe(2);
  });

  it("does not let a server render clobber client head state", () => {
    const store = Route.clientRouteHeadStore;
    Route.setRouteHead(store, { id: "client-entry", depth: 1, title: "client-title" });
    try {
      const App = titledRoute("/no-clobber/:userId", "server-title");
      const result = Effect.runSync(
        Route.renderRequest(App, { request: new Request("http://test.local/no-clobber/alice") }),
      );

      expect(result.head.title).toBe("server-title");
      expect(Route.resolveRouteHeadOf(store).title).toBe("client-title");
    } finally {
      Route.removeRouteHead(store, "client-entry");
    }
  });

  it("scopes the loader cache to the provided store", () => {
    const scoped = makeLoaderCacheStore();
    clearLoaderCache();

    const run = runCachedLoader("/scoped", { id: 1 }, Effect.succeed("value"));
    Effect.runSync(run.pipe(Effect.provideService(LoaderCacheTag, scoped)));

    expect(getLoaderCacheEntry("/scoped", { id: 1 }, scoped)).toBeDefined();
    expect(getLoaderCacheEntry("/scoped", { id: 1 }, defaultLoaderCacheStore)).toBeUndefined();
  });

  it("emits a versioned loader handoff and hydrates from it", async () => {
    const App = titledRoute("/handoff/:userId", "handoff");
    const scripts = Route.streamDeferredLoaderScripts([
      {
        routeId: "/handoff/:userId",
        params: { userId: "alice" },
        result: Result.success({ name: "alice" }),
      },
    ]);
    expect(scripts).toHaveLength(1);
    // R6 (DQ-034): the streamed entry is inert data on the manifest channel —
    // no executable script and no second window global beside the manifest.
    expect(scripts[0]).toContain(Route.loaderEntryScriptAttribute);
    expect(scripts[0]).toContain('type="application/json"');
    expect(scripts[0]).not.toContain(Route.loaderHandoffGlobalKey);

    const handoff = {
      version: Route.loaderHandoffVersion,
      entries: [{
        routeId: "/handoff/:userId",
        params: { userId: "alice" },
        result: Serialization.resultToWire(Result.success({ name: "alice" })),
      }],
    };

    const scoped = makeLoaderCacheStore();
    await Effect.runPromise(
      Route.hydrateLoaderHandoff(App, { input: handoff }).pipe(
        Effect.provideService(LoaderCacheTag, scoped),
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<void, never, never>,
    );

    const entry = getLoaderCacheEntry("/handoff/:userId", { userId: "alice" }, scoped);
    expect(entry).toBeDefined();
    expect(entry?.result._tag).toBe("Success");
  });

  it("reports a version mismatch in the handoff as a typed failure", async () => {
    const App = titledRoute("/handoff-bad/:userId", "handoff-bad");
    const exit = await Effect.runPromise(
      Route.hydrateLoaderHandoff(App, { input: { version: 99, entries: [] } }).pipe(
        Effect.exit,
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<{ readonly _tag: string }, never, never>,
    );
    expect(exit._tag).toBe("Failure");
  });

  it("reports unknown route ids when hydrating a handoff", async () => {
    const App = titledRoute("/handoff-missing/:userId", "handoff-missing");
    const missing: Array<string> = [];
    await Effect.runPromise(
      Route.hydrateLoaderHandoff(App, {
        input: {
          version: Route.loaderHandoffVersion,
          entries: [{
            routeId: "/nope",
            params: {},
            result: Serialization.resultToWire(Result.success(1)),
          }],
        },
        onMissingRoute: (routeId) => {
          missing.push(routeId);
        },
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<void, never, never>,
    );
    expect(missing).toEqual(["/nope"]);
  });

  it("notifies subscribers of streamed handoff entries", () => {
    const carrier = globalThis as unknown as Record<string, unknown>;
    delete carrier[Route.loaderHandoffGlobalKey];
    delete carrier[Route.loaderHandoffNotifyKey];

    const seen: Array<string> = [];
    const unsubscribe = Route.onLoaderHandoffEntry((entry) => {
      seen.push(entry.routeId);
    });
    try {
      const notify = carrier[Route.loaderHandoffNotifyKey] as
        | ((entry: { readonly routeId: string }) => void)
        | undefined;
      notify?.({ routeId: "/streamed" });
      expect(seen).toEqual(["/streamed"]);
    } finally {
      unsubscribe();
      delete carrier[Route.loaderHandoffGlobalKey];
      delete carrier[Route.loaderHandoffNotifyKey];
    }
  });
});
