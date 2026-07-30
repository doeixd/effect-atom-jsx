/**
 * R6 — the loader-data channel merges into the streaming resume manifest.
 *
 * One handoff, not two: after R6 there is no separate loader-data global
 * alongside the resume manifest. Loader results stream inside the manifest, over
 * the same `Serialization` wire projection, and hydrate through the same
 * channel. (Coordinates conceptually with M11.5; the specs stay here.)
 *
 * `DQ-034` (ratified 2026-07-30): loader data **folds into** the resume manifest
 * — two streamed channels into the same document during the same phase is
 * coupling that only gets more expensive, and R2 already proved the hard part
 * (one `Serialization` wire projection for loader `Result`s).
 *
 * The cross-reference is **bidirectional and binding**: the router-side
 * requirements below — `(routeId, params)` identity and **incremental per-entry
 * delivery** — are constraints on M11.5's manifest design, not router
 * implementation details. If M11.5's manifest lands without incremental
 * per-entry delivery, `DQ-034` is not implementable and reverts to keeping the
 * loader channel as a separate fallback. The two specs at the bottom of this file
 * state those constraints so an M11.5 change that breaks either one fails here
 * rather than silently invalidating the decision.
 *
 * Owner: docs/ROUTER_CONSOLIDATION_PLAN.md § R6, closing finding F7 (`DQ-034`).
 */
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { fromSrc, loadSrc } from "../harness.js";

describe("R6 — one handoff", () => {
  it("[R6] SSR does not emit a second loader-data global beside the resume manifest", async () => {
    const Route = await fromSrc("Route", "path", "id", "loader", "children", "layout", "renderRequest", "loaderHandoffGlobalKey");
    const Component: any = await loadSrc("Component");

    const Deferred = Route.loader((_: {}) => Effect.succeed({ slow: true }), { priority: "deferred" })(
      Route.id("r6.deferred")(Route.path("/r6-handoff")(Component.from(() => null))),
    );
    const App = Route.children([Deferred])(
      Route.layout()(Route.path("/")(Component.from(() => null))),
    );

    const rendered: any = await Effect.runPromise(
      Route.renderRequest(App, { request: new Request("http://test.local/r6-handoff") }),
    );

    // Deferred loader data still streams...
    expect(rendered.deferred.length).toBeGreaterThan(0);
    // ...but through the resume manifest channel, not a parallel window global.
    for (const script of rendered.deferred) {
      expect(script).not.toContain(Route.loaderHandoffGlobalKey);
    }
  });

  it("[R6] the resume manifest carries loader entries through one decoder", async () => {
    const Resume = await fromSrc("Resume", "decodeManifest");
    const Serialization: any = await loadSrc("Serialization");
    const { resultToWire }: any = await loadSrc("Serialization");
    const { Result }: any = await loadSrc("effect-ts");

    const buildId = "r6-build";
    const manifest = {
      version: 5,
      buildId,
      events: {},
      components: {},
      expressions: {},
      loaders: {
        "/r6-manifest/:id": {
          params: { id: "alice" },
          result: resultToWire(Result.success({ name: "alice" })),
        },
      },
    };

    const decoded = await Effect.runPromise(
      Resume.decodeManifest(JSON.stringify(manifest), buildId).pipe(
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<any, any, never>,
    );

    expect(decoded.version).toBe(5);
    expect(Object.keys(decoded.loaders)).toEqual(["/r6-manifest/:id"]);
    expect(decoded.loaders["/r6-manifest/:id"].params).toEqual({ id: "alice" });
  });

  it("[R6] hydrating the manifest fills the loader cache without a second handoff read", async () => {
    const Route = await fromSrc("Route", "path", "id", "loader", "hydrateLoaderHandoff", "loaderHandoffVersion");
    const Component: any = await loadSrc("Component");
    const Serialization: any = await loadSrc("Serialization");
    const { Result }: any = await loadSrc("effect-ts");
    const runtime = await fromSrc("router-runtime", "makeLoaderCacheStore", "getLoaderCacheEntry", "LoaderCacheTag");

    const routeId = "/r6-hydrate/:id";
    const Page = Route.loader((params: { readonly id: string }) => Effect.succeed({ id: params.id }))(
      Route.path(routeId)(Component.from(() => null)),
    );

    const store = runtime.makeLoaderCacheStore();
    // The client reads loader data from wherever the manifest put it: one
    // channel, one decoder, one cache write.
    await Effect.runPromise(
      Route.hydrateLoaderHandoff(Page, {
        input: {
          version: Route.loaderHandoffVersion,
          entries: [{
            routeId,
            params: { id: "alice" },
            result: Serialization.resultToWire(Result.success({ id: "alice" })),
          }],
        },
      }).pipe(
        Effect.provideService(runtime.LoaderCacheTag, store),
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<void, any, never>,
    );

    const entry = runtime.getLoaderCacheEntry(routeId, { id: "alice" }, store);
    expect(entry?.result._tag).toBe("Success");
    expect((entry?.result as any).value).toEqual({ id: "alice" });
  });

  // `DQ-034` router-side requirement 1: loader identity in the manifest is
  // `(routeId, params)`, not `routeId` alone. A parameterised route legitimately
  // has many concurrently-live entries, and collapsing them onto the route id
  // would silently serve one user's data for another's URL.
  it("[R6] manifest loader identity is (routeId, params), so sibling params do not collide", async () => {
    const Route = await fromSrc("Route", "path", "loader", "hydrateLoaderHandoff", "loaderHandoffVersion");
    const Component: any = await loadSrc("Component");
    const Serialization: any = await loadSrc("Serialization");
    const { Result }: any = await loadSrc("effect-ts");
    const runtime = await fromSrc("router-runtime", "makeLoaderCacheStore", "getLoaderCacheEntry", "LoaderCacheTag");

    const routeId = "/r6-identity/:id";
    const Page = Route.loader((params: { readonly id: string }) => Effect.succeed({ id: params.id }))(
      Route.path(routeId)(Component.from(() => null)),
    );

    const store = runtime.makeLoaderCacheStore();
    const entryFor = (id: string) => ({
      routeId,
      params: { id },
      result: Serialization.resultToWire(Result.success({ id })),
    });

    await Effect.runPromise(
      Route.hydrateLoaderHandoff(Page, {
        input: {
          version: Route.loaderHandoffVersion,
          entries: [entryFor("alice"), entryFor("bob")],
        },
      }).pipe(
        Effect.provideService(runtime.LoaderCacheTag, store),
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<void, any, never>,
    );

    // Both survive, each under its own params — the second did not overwrite the
    // first the way a routeId-only identity would.
    expect((runtime.getLoaderCacheEntry(routeId, { id: "alice" }, store)?.result as any).value)
      .toEqual({ id: "alice" });
    expect((runtime.getLoaderCacheEntry(routeId, { id: "bob" }, store)?.result as any).value)
      .toEqual({ id: "bob" });
    // NEGATIVE CONTROL: params that were never delivered are a miss, not a
    // wildcard hit. Without this, a cache keyed on routeId alone — returning the
    // same entry for any params — would satisfy both assertions above.
    expect(runtime.getLoaderCacheEntry(routeId, { id: "carol" }, store)).toBeUndefined();
  });

  // `DQ-034` router-side requirement 2, and the binding condition on M11.5: the
  // manifest must deliver loader entries **incrementally, per entry**. A manifest
  // that is only readable once complete cannot carry deferred loader data at all,
  // because the whole point of a deferred loader is that the document is already
  // interactive while it resolves. If this cannot hold, `DQ-034` reverts to a
  // separate loader channel.
  it("[R6] manifest loader entries are delivered incrementally, each observable before the next", async () => {
    const Route = await fromSrc(
      "Route",
      "onLoaderHandoffEntry",
      "loaderHandoffGlobalKey",
      "loaderHandoffNotifyKey",
      "loaderHandoffVersion",
    );
    const Serialization: any = await loadSrc("Serialization");
    const { Result }: any = await loadSrc("effect-ts");

    const carrier = globalThis as unknown as Record<string, unknown>;
    const previousEnvelope = carrier[Route.loaderHandoffGlobalKey];
    const previousNotify = carrier[Route.loaderHandoffNotifyKey];
    const observed: Array<string> = [];
    let unsubscribe = () => {};
    try {
      carrier[Route.loaderHandoffGlobalKey] = { version: Route.loaderHandoffVersion, entries: [] };
      delete carrier[Route.loaderHandoffNotifyKey];
      unsubscribe = Route.onLoaderHandoffEntry((entry: any) => {
        observed.push(String(entry.routeId));
      });

      const deliver = (routeId: string) => {
        const envelope = carrier[Route.loaderHandoffGlobalKey] as any;
        const entry = {
          routeId,
          params: { id: "alice" },
          result: Serialization.resultToWire(Result.success({ id: "alice" })),
        };
        envelope.entries.push(entry);
        // Optional call: after the negative-control unsubscribe there is no hook,
        // which is precisely the state being asserted.
        (carrier[Route.loaderHandoffNotifyKey] as ((e: unknown) => void) | undefined)?.(entry);
      };

      // Counted, one at a time: the observation must land as each entry arrives,
      // not in one batch once the stream closes.
      deliver("/r6-incremental/a");
      expect(observed).toEqual(["/r6-incremental/a"]);
      deliver("/r6-incremental/b");
      expect(observed).toEqual(["/r6-incremental/a", "/r6-incremental/b"]);

      // NEGATIVE CONTROL: unsubscribing stops delivery. Without it, a subscription
      // that is never actually wired — and a `deliver` that pushed straight into
      // `observed` — would be indistinguishable from a working one.
      unsubscribe();
      deliver("/r6-incremental/c");
      expect(observed).toEqual(["/r6-incremental/a", "/r6-incremental/b"]);
    } finally {
      unsubscribe();
      if (previousEnvelope === undefined) delete carrier[Route.loaderHandoffGlobalKey];
      else carrier[Route.loaderHandoffGlobalKey] = previousEnvelope;
      if (previousNotify === undefined) delete carrier[Route.loaderHandoffNotifyKey];
      else carrier[Route.loaderHandoffNotifyKey] = previousNotify;
    }
  });
});
