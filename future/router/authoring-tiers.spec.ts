/**
 * R3 — one authoring tier.
 *
 * The unified `Route` value is canonical; `Component.route` and the node
 * builders are sugar that produce an equivalent route.
 *
 * `DQ-030` (ratified 2026-07-30) splits the three stored-but-never-read tier-3
 * features: `guard` and `loaderErrorCases` are **wired**, `transition` is
 * **deleted from the type**. The safety-critical half is the sequencing rule —
 * *no inert authorization API ships*: if `Route.guard` exists in the build, it
 * gates. A guard that type-checks, composes and blocks nothing is an auth bypass
 * shipped as a working API, so "guard is exported" and "guard gates" are asserted
 * together rather than as separate concerns.
 *
 * `DQ-037` (ratified 2026-07-30) is deliberately **not** specified anywhere in
 * this lane: R1's `node.state.materialized` path-keyed cache rule gets no fix,
 * because R3 deletes the cache. A route is an immutable value whose full pattern
 * resolves during traversal, so there is nothing left to cache — fixing a rule we
 * are about to remove is wasted motion. (Fallback if R3 is rejected: make tree
 * context mandatory with a real diagnostic. Not today's rule, which has been
 * deferred twice.) No spec here pins the current rule; if one is ever added, it
 * belongs to that fallback and must say so.
 *
 * Owner: docs/ROUTER_CONSOLIDATION_PLAN.md § R3 (`DQ-030`, `DQ-037`).
 */
import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { fromSrc, loadSrc } from "../harness.js";

/** Let forked loader/guard fibers settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("R3 — one authoring tier", () => {
  it("[R3] a failing unified-route guard prevents the loader from running and blocks navigation", async () => {
    const Route = await fromSrc("Route", "path", "id", "guard", "loader", "children", "layout");
    const Component: any = await loadSrc("Component");
    const RouterRuntime = await fromSrc("RouterRuntime", "create", "createMemoryHistory");

    let loads = 0;
    let guardChecks = 0;
    let openLoads = 0;
    const Guarded = Route.guard(Effect.suspend(() => {
      guardChecks += 1;
      return Effect.fail({ _tag: "Denied" } as const);
    }))(
      Route.loader((_: {}) => Effect.sync(() => {
        loads += 1;
        return { ok: true };
      }))(
        Route.id("r3.guarded")(Route.path("/r3-guarded")(Component.from(() => null))),
      ),
    );
    // NEGATIVE CONTROL, in-app: an unguarded sibling under the same layout. Without
    // it, a runtime that fails *every* navigation — or one whose loaders never run
    // at all — satisfies every assertion below forever.
    const Open = Route.loader((_: {}) => Effect.sync(() => {
      openLoads += 1;
      return { ok: true };
    }))(Route.id("r3.open")(Route.path("/r3-open")(Component.from(() => null))));
    const App = Route.children([Guarded, Open])(
      Route.layout()(Route.path("/")(Component.from(() => null))),
    );

    const runtime = RouterRuntime.create({
      app: App,
      history: RouterRuntime.createMemoryHistory("/"),
    });
    Effect.runSync(runtime.initialize());
    await Effect.runPromise(Effect.exit(runtime.navigate("/r3-guarded")));
    await flush();

    const snapshot: any = Effect.runSync(runtime.snapshot());
    // The guard was consulted...
    expect(guardChecks).toBe(1);
    // ...the loader never ran behind it...
    expect(loads).toBe(0);
    // ...no loader data was committed...
    expect(snapshot.loaderData.has("r3.guarded")).toBe(false);
    // ...and the navigation did not land.
    expect(snapshot.location.pathname).toBe("/");

    await Effect.runPromise(runtime.navigate("/r3-open"));
    await flush();
    const openSnapshot: any = Effect.runSync(runtime.snapshot());
    expect(openSnapshot.location.pathname).toBe("/r3-open");
    expect(openLoads).toBe(1);
    // The guard belongs to its own route: it is not consulted for a sibling.
    expect(guardChecks).toBe(1);
  });

  it("[R3] a passing guard runs exactly once, before the loader", async () => {
    const Route = await fromSrc("Route", "path", "id", "guard", "loader", "children", "layout");
    const Component: any = await loadSrc("Component");
    const RouterRuntime = await fromSrc("RouterRuntime", "create", "createMemoryHistory");

    const order: Array<string> = [];
    const Allowed = Route.guard(Effect.suspend(() => {
      order.push("guard");
      return Effect.void;
    }))(
      Route.loader((_: {}) => Effect.sync(() => {
        order.push("loader");
        return { ok: true };
      }))(
        Route.id("r3.allowed")(Route.path("/r3-allowed")(Component.from(() => null))),
      ),
    );
    const App = Route.children([Allowed])(
      Route.layout()(Route.path("/")(Component.from(() => null))),
    );

    const runtime = RouterRuntime.create({
      app: App,
      history: RouterRuntime.createMemoryHistory("/"),
    });
    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.navigate("/r3-allowed"));
    await flush();

    expect(order).toEqual(["guard", "loader"]);
    const snapshot: any = Effect.runSync(runtime.snapshot());
    expect(snapshot.location.pathname).toBe("/r3-allowed");
    expect(snapshot.loaderData.get("r3.allowed")).toEqual({ ok: true });
  });

  it("[R3] a guard survives a component wrapper and still blocks", async () => {
    const Route = await fromSrc("Route", "path", "id", "guard", "children", "layout");
    const Component: any = await loadSrc("Component");
    const RouterRuntime = await fromSrc("RouterRuntime", "create", "createMemoryHistory");

    let guardChecks = 0;
    const Base = Component.from(() => null).pipe(Component.withLoading(() => "loading"));
    const Guarded = Route.guard(Effect.suspend(() => {
      guardChecks += 1;
      return Effect.fail({ _tag: "Denied" } as const);
    }))(Route.id("r3.wrapped")(Route.path("/r3-wrapped")(Base)));
    const App = Route.children([Guarded])(
      Route.layout()(Route.path("/")(Component.from(() => null))),
    );

    const runtime = RouterRuntime.create({
      app: App,
      history: RouterRuntime.createMemoryHistory("/"),
    });
    Effect.runSync(runtime.initialize());
    await Effect.runPromise(Effect.exit(runtime.navigate("/r3-wrapped")));
    await flush();

    expect(guardChecks).toBe(1);
    expect((Effect.runSync(runtime.snapshot()) as any).location.pathname).toBe("/");
  });

  it("[R3] Component.route sugar produces a route with the same identity as Route.path", async () => {
    const Route = await fromSrc("Route", "path", "loader", "id", "collectAll", "runMatchedLoaders", "UnifiedRouteSymbol");
    const Component: any = await loadSrc("Component");

    const Sugar = Route.loader((params: { readonly id: string }) => Effect.succeed({ from: "sugar", id: params.id }))(
      Component.from(() => null).pipe(
        Component.route("/r3-tier/:id", { params: Schema.Struct({ id: Schema.String }) }),
      ),
    );
    const Canonical = Route.loader((params: { readonly id: string }) => Effect.succeed({ from: "canonical", id: params.id }))(
      Route.path("/r3-tier-canonical/:id")(Component.from(() => null)),
    );

    // Sugar *is* a unified route value, not a differently-shaped carrier.
    expect(Sugar[Route.UnifiedRouteSymbol]).toBeDefined();
    expect(Sugar[Route.UnifiedRouteSymbol].meta.fullPattern).toBe("/r3-tier/:id");
    expect(Route.collectAll(Sugar).map((entry: any) => entry.meta.fullPattern))
      .toEqual(["/r3-tier/:id"]);

    // And it loads under the pattern identity, exactly like the canonical form.
    const sugarRun: any = await Effect.runPromise(
      Route.runMatchedLoaders(Sugar, new URL("http://test.local/r3-tier/alice")),
    );
    const canonicalRun: any = await Effect.runPromise(
      Route.runMatchedLoaders(Canonical, new URL("http://test.local/r3-tier-canonical/alice")),
    );
    expect(sugarRun.map((item: any) => item.routeId)).toEqual(["/r3-tier/:id"]);
    expect(canonicalRun.map((item: any) => item.routeId)).toEqual(["/r3-tier-canonical/:id"]);
    expect((sugarRun[0] as any).result.value).toEqual({ from: "sugar", id: "alice" });
  });

  // `DQ-030`: `transition` was the one inert feature that needed a view-transition
  // model this repo does not have, and view transitions are deferred past R4.
  // A silent no-op behind a plausible name is worse than a compile error, so the
  // decision is deletion — which makes *absence* the assertion.
  it("[R3] Route.transition is deleted from the surface, while the wired features remain", async () => {
    const Route: any = await loadSrc("Route");

    expect(Route.transition).toBeUndefined();
    // Not reachable through the inner namespace object either — this repo exports
    // both `* as Route` and an inner `Route` const, so a deletion that only
    // touched one of them would still ship the no-op.
    expect(Route.Route?.transition).toBeUndefined();

    // NEGATIVE CONTROL. Every `toBeUndefined` above passes vacuously if the module
    // failed to load or the export surface were empty. The two features `DQ-030`
    // decided to KEEP must still be present and callable.
    expect(Route.guard).toBeTypeOf("function");
    expect(Route.loaderError).toBeTypeOf("function");

    // And no route value carries transition metadata any more: building a route
    // through the canonical combinators must produce no `transition` field for a
    // runtime to read (or for an author to believe in).
    const Component: any = await loadSrc("Component");
    const Page = Route.id("r3.no-transition")(
      Route.path("/r3-no-transition")(Component.from(() => null)),
    );
    const meta = Page[Route.UnifiedRouteSymbol]?.meta;
    // Guard the guard: an absent `meta` would make the next line vacuously true.
    expect(meta?.fullPattern).toBe("/r3-no-transition");
    expect(Object.keys(meta)).not.toContain("transition");
  });

  it("[R3] unified loaderErrorCases render the tagged fallback instead of throwing", async () => {
    const Route = await fromSrc("Route", "path", "id", "loader", "loaderError", "renderRequest");
    const Component: any = await loadSrc("Component");

    const Page = Route.loaderError({
      NotFound: (_error: unknown, _params: unknown) => "user-missing",
    })(
      Route.loader((_: {}) => Effect.fail({ _tag: "NotFound" } as const))(
        Route.id("r3.errorcases")(Route.path("/r3-error/:id")(Component.from(() => "loaded"))),
      ),
    );

    const rendered: any = await Effect.runPromise(
      Route.renderRequest(Page, { request: new Request("http://test.local/r3-error/alice") }),
    );

    // The tagged case rendered; the loader failure was neither thrown nor
    // silently swallowed into an empty document.
    expect(rendered.html).toContain("user-missing");
    expect(rendered.html).not.toContain("loaded");

    // NEGATIVE CONTROL. Without this, a router that renders the error fallback
    // unconditionally — or one that never renders the page component at all —
    // satisfies the assertions above forever. Same route shape, succeeding loader.
    const Ok = Route.loaderError({
      NotFound: (_error: unknown, _params: unknown) => "user-missing",
    })(
      Route.loader((_: {}) => Effect.succeed({ ok: true }))(
        Route.id("r3.errorcases.ok")(
          Route.path("/r3-error-ok/:id")(Component.from(() => "loaded")),
        ),
      ),
    );
    const okRendered: any = await Effect.runPromise(
      Route.renderRequest(Ok, { request: new Request("http://test.local/r3-error-ok/alice") }),
    );
    expect(okRendered.html).toContain("loaded");
    expect(okRendered.html).not.toContain("user-missing");
  });
});
