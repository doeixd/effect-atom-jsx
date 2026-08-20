/**
 * R1 / R2 invariants that must stay green, plus one known gap.
 *
 * Everything in the first describe block was established by R1 and R2 and is a
 * standing guarantee: path identity, optional segments, revalidation semantics,
 * per-request isolation, and the versioned handoff.
 *
 * The second block is the router lane's slice of `Stale` unification
 * (RESULT_UNIFICATION_PLAN.md Risk 3): `loaderSuccess` does not read
 * `Stale.data`, so a failed refresh loses data that is still in hand. Those
 * specs are expected RED.
 *
 * `DQ-035` (ratified 2026-07-30) settles the dependent half in one sentence:
 * *a dependent loader is never fresher than its parent, and its `Result` says
 * so.* A `Stale` parent **feeds** its `dependsOnParent` child and the child's own
 * `Result` is marked stale — which is exactly the composition `Result.all`
 * already encodes, so this is consistency rather than invention. Rejected:
 * failing the child with `ParentUnavailable`, which discards data that is in
 * hand — the precise thing the `Stale` variant exists to avoid. And the related
 * expectation is fixed with it: `loaderSuccess` must equal `Result.getData`, i.e.
 * Success, Refreshing(Success), **and Stale** all surface their data.
 */
import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as RouterRuntime from "../RouterRuntime.js";
import { Result } from "../effect-ts.js";
import * as Serialization from "../Serialization.js";
import {
  LoaderCacheTag,
  clearLoaderCache,
  getLoaderCacheEntry,
  makeLoaderCacheStore,
  setLoaderCacheEntry,
} from "../router-runtime.js";

// Promoted from future/router/regression-invariants.spec.ts (all green
// 2026-08-11).
const cache = { setLoaderCacheEntry, makeLoaderCacheStore, LoaderCacheTag };
const runtime = { makeLoaderCacheStore, getLoaderCacheEntry, LoaderCacheTag };

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("R1/R2 — standing router invariants", () => {
  it("[R1] a nested route keeps one path identity for matching and loading", async () => {

    const loaded: Array<string> = [];
    const Settings = Route.loader((_: {}) => Effect.sync(() => {
      loaded.push("settings");
      return { settings: true };
    }))(Route.page("settings", Component.from(() => null)));
    const Users = Route.page("/users/:userId", Component.from(() => null));
    const App = Route.layout(Component.from(() => null)).pipe(
      Route.children([Route.mount(Users, [Settings])]),
    );

    const runtime = RouterRuntime.create({
      app: App,
      history: RouterRuntime.createMemoryHistory("/"),
    });
    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.navigate("/users/1/settings"));
    await flush();

    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.appMatches).toContain("/users/:userId/settings");
    expect(snapshot.appMatches).not.toContain("/settings");
    // Render identity and loader identity are the same joined path.
    expect(snapshot.loaderData.get("/users/:userId/settings")).toEqual({ settings: true });
    expect(loaded).toEqual(["settings"]);
  });

  it("[R1] optional `:name?` segments match and extract consistently", async () => {

    expect(Route.matchPattern("/opt/:id?", "/opt", true)).toBe(true);
    expect(Route.matchPattern("/opt/:id?", "/opt/a", true)).toBe(true);
    expect(Route.matchPattern("/opt/:id?", "/opt/a/b", true)).toBe(false);
    expect(Route.extractParams("/opt/:id?", "/opt/a")).toEqual({ id: "a" });
    expect(Route.extractParams("/opt/:id?", "/opt")).toEqual({});
    expect(Route.matchPattern("/:a?/opt", "/opt")).toBe(false);
  });

  it("[R1] revalidate:\"matched\" returns every matched loader; \"reactivity\" with no invalidations returns none and loads once", async () => {

    const makePage = (pattern: string, onLoad: () => void) =>
      Route.loader((params: { readonly userId: string }) => Effect.sync(() => {
        onLoad();
        return { name: params.userId };
      }))(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
          Route.path(pattern)(Component.from(() => null)),
        ),
      );

    let matchedLoads = 0;
    const MatchedPage = makePage("/reval-matched/:userId", () => {
      matchedLoads += 1;
    });
    // ISOLATION: scoped to this spec's own route id, never a process-wide wipe.
    clearLoaderCache("/reval-matched/:userId");
    const matchedResponse = await Effect.runPromise(
      Route.singleFlight((userId: string) => Effect.succeed({ ok: userId }), {
        app: MatchedPage,
        revalidate: "matched",
        baseUrl: "http://localhost",
      })({ args: ["alice"], url: "/reval-matched/alice" }),
    );
    expect(matchedResponse.ok).toBe(true);
    if (!matchedResponse.ok) return;
    expect(matchedResponse.payload.loaders.map((item) => item.routeId))
      .toEqual(["/reval-matched/:userId"]);

    let reactivityLoads = 0;
    const ReactivityPage = makePage("/reval-reactivity/:userId", () => {
      reactivityLoads += 1;
    });
    clearLoaderCache("/reval-reactivity/:userId");
    const reactivityResponse = await Effect.runPromise(
      Route.singleFlight((userId: string) => Effect.succeed({ ok: userId }), {
        app: ReactivityPage,
        revalidate: "reactivity",
        baseUrl: "http://localhost",
      })({ args: ["alice"], url: "/reval-reactivity/alice" }) as Effect.Effect<any, never, never>,
    );
    expect(reactivityResponse.ok).toBe(true);
    // Nothing was invalidated: no revalidation entries, and no duplicate pass.
    expect(reactivityResponse.payload.loaders).toEqual([]);
    expect(reactivityLoads).toBe(1);
  });

  it("[R2] two interleaved concurrent renders share no head or loader state", async () => {

    const page = (pattern: string, titleText: string, onLoad: () => void, delayMs: number) =>
      Route.title(() => titleText)(
        Route.loader((params: { readonly userId: string }) => Effect.sync(() => {
          onLoad();
          return { name: params.userId };
        }).pipe(Effect.delay(delayMs)), { staleTime: "5 minutes" })(
          Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
            Route.path(pattern)(Component.from(() => null)),
          ),
        ),
      );

    let aLoads = 0;
    let bLoads = 0;
    const A = page("/inv-a/:userId", "title-a", () => {
      aLoads += 1;
    }, 10);
    const B = page("/inv-b/:userId", "title-b", () => {
      bLoads += 1;
    }, 5);

    clearLoaderCache("/inv-a/:userId");
    clearLoaderCache("/inv-b/:userId");
    const [resultA, resultB] = await Effect.runPromise(Effect.all([
      Route.renderRequest(A, { request: new Request("http://test.local/inv-a/alice") }),
      Route.renderRequest(B, { request: new Request("http://test.local/inv-b/bob") }),
    ], { concurrency: "unbounded" }) as unknown as Effect.Effect<ReadonlyArray<any>, never, never>);

    expect(resultA.head.title).toBe("title-a");
    expect(resultB.head.title).toBe("title-b");
    expect(aLoads).toBe(1);
    expect(bLoads).toBe(1);
    // A server render never warms the client cache.
    expect(getLoaderCacheEntry("/inv-a/:userId", { userId: "alice" })).toBeUndefined();
    expect(getLoaderCacheEntry("/inv-b/:userId", { userId: "bob" })).toBeUndefined();
  });

  it("[R2] the versioned handoff round-trips and a version mismatch is a typed failure", async () => {

    const routeId = "/inv-handoff/:userId";
    const Page = Route.loader((params: { readonly userId: string }) => Effect.succeed({ name: params.userId }))(
      Route.path(routeId)(Component.from(() => null)),
    );

    const scripts = Route.streamDeferredLoaderScripts([{
      routeId,
      params: { userId: "alice" },
      result: Result.success({ name: "alice" }),
    }]);
    expect(scripts).toHaveLength(1);

    const store = runtime.makeLoaderCacheStore();
    await Effect.runPromise(
      Route.hydrateLoaderHandoff(Page, {
        input: {
          version: Route.loaderHandoffVersion,
          entries: [{
            routeId,
            params: { userId: "alice" },
            result: Serialization.resultToWire(Result.success({ name: "alice" })),
          }],
        },
      }).pipe(
        Effect.provideService(runtime.LoaderCacheTag, store),
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<void, any, never>,
    );
    expect(runtime.getLoaderCacheEntry(routeId, { userId: "alice" }, store)?.result._tag).toBe("Success");

    // The round-trip above is this spec's own negative control: the matching
    // version is accepted and lands in the cache, so a `hydrateLoaderHandoff`
    // that rejected every handoff cannot pass the mismatch assertion below.
    const mismatch = await Effect.runPromiseExit(
      Route.hydrateLoaderHandoff(Page, { input: { version: 99, entries: [] } }).pipe(
        Effect.provide(Serialization.layer),
      ),
    );
    expect(Exit.isFailure(mismatch)).toBe(true);
    if (!Exit.isFailure(mismatch)) return;
    // A version mismatch is deploy skew, so it must arrive as a typed failure the
    // client can act on — not as a defect. Note the near neighbour: a *malformed*
    // handoff is a decode failure and gets its own code; this one is specifically
    // about the version field.
    const error = Cause.findErrorOption(mismatch.cause);
    expect(error._tag).toBe("Some");
    if (error._tag === "Some") {
      const tagged = error.value as { readonly _tag?: unknown };
      expect(typeof tagged._tag).toBe("string");
      expect(JSON.stringify(error.value)).toContain("99");
    }
  });
});

describe("Risk 3 — loader results must read Stale.data (expected RED)", () => {
  // `loaderSuccess` must be `Result.getData`, no more and no less: Success,
  // Refreshing(Success) and **Stale** all carry data that is in hand; Failure and
  // Loading do not. The current implementation stops at the first two, so a
  // failed refresh drops data it is still holding.
  it("[R5] loader data surfaces for Success, Refreshing(Success) and Stale — and only those", async () => {

    let loads = 0;
    const Page = Route.loader((_: { readonly id: string }) => Effect.sync(() => {
      loads += 1;
      return { fresh: true };
    }), { staleTime: "1 minute" })(
      Route.id("inv.stale")(
        Route.paramsSchema(Schema.Struct({ id: Schema.String }))(
          Route.path("/inv-stale/:id")(Component.from(() => null)),
        ),
      ),
    );

    // ISOLATION: clear only this spec's own route id. A bare `clearLoaderCache()`
    // wipes the process-wide store that every other spec file shares.
    clearLoaderCache("inv.stale");
    const seed = (id: string, result: Result<unknown, unknown>) =>
      setLoaderCacheEntry("inv.stale", { id }, result, { staleTime: "1 minute" });

    const data = { cached: true };
    seed("succeeded", Result.success(data));
    seed("refreshing", Result.refreshing(Result.success(data)));
    seed("stale", Result.stale({ _tag: "Offline" } as const, data));
    seed("failed", Result.failure({ _tag: "Offline" } as const));

    const runtime = RouterRuntime.create({
      app: Page,
      history: RouterRuntime.createMemoryHistory("/"),
    });
    Effect.runSync(runtime.initialize());

    const visit = async (id: string) => {
      await Effect.runPromise(runtime.navigate(`/inv-stale/${id}`));
      await flush();
      const snapshot = Effect.runSync(runtime.snapshot());
      return {
        data: snapshot.loaderData.get("inv.stale"),
        error: snapshot.errors?.get("inv.stale"),
      };
    };

    // Every seeded entry was fresh enough to serve, so nothing reloaded — which
    // is what makes the seeded `Result` variant the only thing under test.
    // Success and Refreshing(Success) are the NEGATIVE CONTROL for Stale: an
    // implementation that surfaced data unconditionally would fail on `failed`,
    // and one that surfaced none would fail on `succeeded`.
    expect(await visit("succeeded")).toEqual({ data, error: undefined });
    expect(await visit("refreshing")).toEqual({ data, error: undefined });
    // The whole point of `Stale`: the data is still in hand AND the typed error
    // is available alongside it.
    expect(await visit("stale")).toEqual({ data, error: { _tag: "Offline" } });
    // A plain failure has no data to surface.
    expect(await visit("failed")).toEqual({ data: undefined, error: { _tag: "Offline" } });
    expect(loads).toBe(0);
  });

  // `DQ-035`: *a dependent loader is never fresher than its parent, and its
  // `Result` says so.* The parent's stale data still feeds the child — discarding
  // data that is in hand is the precise thing `Stale` exists to avoid — but the
  // child must not then advertise itself as fresh.
  it("[R5] a Stale parent feeds its dependsOnParent child, and the child's Result is Stale too", async () => {

    const makeTree = (pattern: string) => {
      const Child = Route.loader((_: {}, deps?: { readonly parent: <A>() => A }) =>
        Effect.succeed({ parent: deps?.parent<{ readonly cached: boolean }>() }), { dependsOnParent: true })(
        Route.path("child")(Component.from(() => null)),
      );
      return Route.children([Child])(
        Route.layout()(
          Route.loader((_: {}) => Effect.succeed({ fresh: true }), { staleTime: "1 minute" })(
            Route.path(pattern)(Component.from(() => null)),
          ),
        ),
      );
    };

    // ISOLATION: a store per phase, so neither the shared module-global cache nor
    // the other phase can affect this one.
    const runWith = async (pattern: string, seeded: Result<unknown, unknown>) => {
      const store = cache.makeLoaderCacheStore();
      cache.setLoaderCacheEntry(pattern, {}, seeded, { staleTime: "1 minute" }, store);
      const results = await Effect.runPromise(
        Route.runMatchedLoaders(makeTree(pattern), new URL(`http://test.local${pattern}/child`)).pipe(
          Effect.provideService(cache.LoaderCacheTag, store),
        ),
      );
      return results.find((item) => item.routeId === `${pattern}/child`);
    };

    const error = { _tag: "Offline" } as const;
    const child = await runWith("/inv-parent-stale", Result.stale(error, { cached: true }));
    expect(child).toBeDefined();
    // The child ran and saw the parent's in-hand data...
    const childData = Result.getData(child!.result);
    expect(childData._tag).toBe("Some");
    if (childData._tag === "Some") {
      expect(childData.value).toEqual({ parent: { cached: true } });
    }
    // ...and says it is no fresher than its parent, carrying the parent's error.
    // This is the `Result.all` composition rule, applied along the loader tree.
    expect(child!.result._tag).toBe("Stale");
    if (child!.result._tag === "Stale") {
      expect(child!.result.error).toEqual(error);
    }

    // NEGATIVE CONTROL. Without it, an implementation that marks every dependent
    // child `Stale` — or one that fails every child — satisfies the above forever.
    // Same tree, fresh parent: the child is a plain Success with no error.
    const fresh = await runWith("/inv-parent-fresh", Result.success({ cached: true }));
    expect(fresh).toBeDefined();
    expect(fresh!.result._tag).toBe("Success");
    if (fresh!.result._tag === "Success") {
      expect(fresh!.result.value).toEqual({ parent: { cached: true } });
    }
    expect(Result.getError(fresh!.result)._tag).toBe("None");
  });
});
