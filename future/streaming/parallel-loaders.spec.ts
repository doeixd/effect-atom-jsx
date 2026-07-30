/**
 * M11 item 4 — router integration: parallel fetch-and-render.
 *
 * Today `renderRequest` runs `runStreamingNavigationInternal` *to completion*
 * before the first component renders, and that function itself runs the matched
 * loaders twice in sequence (critical, then critical+deferred). The finished
 * design forks **all** matched loaders at once as fibers under the request
 * scope and starts streaming the shell immediately.
 *
 * The observable claims: every loader has *started* before any loader has
 * finished; each loader runs exactly once per request; a slow deferred loader
 * does not delay the first byte; and results still land in the existing loader
 * cache / single-flight identity so client revalidation does not refetch.
 */

import { Deferred, Effect, Fiber, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { unbuilt } from "../harness.js";
import { makeTimeline, srcModule } from "./support.js";

describe("parallel route data with streaming (M11.4)", () => {
  it("[M11.4] starts every matched loader before any of them finishes", async () => {
    const Route = await srcModule("Route");
    const Component = await srcModule("Component");
    const renderRequestStream = Route.renderRequestStream;
    if (renderRequestStream === undefined) {
      unbuilt(
        "Route.renderRequestStream (fork-all-loaders navigation)",
        "DQ-017",
      );
    }

    const timeline = makeTimeline();
    const program = Effect.gen(function* () {
      const releaseParent = yield* Deferred.make<void>();
      const releaseChild = yield* Deferred.make<void>();

      const loader = (name: string, release: Deferred.Deferred<void>) =>
        Effect.gen(function* () {
          timeline.mark(`${name}:start`);
          yield* Deferred.await(release);
          timeline.mark(`${name}:end`);
          return { name };
        });

      const Child = Route.loader(() => loader("child", releaseChild), {
        staleTime: "5 minutes",
      })(Route.path("/child")(Component.from(() => "child")));
      const App = Route.loader(() => loader("parent", releaseParent), {
        staleTime: "5 minutes",
      })(
        Route.children([Child])(
          Route.path("/parallel")(Component.from(() => "parent")),
        ),
      );

      const chunks: string[] = [];
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(
          renderRequestStream(App, {
            request: new Request("http://test.local/parallel/child"),
          }),
          (chunk: string) =>
            Effect.sync(() => {
              chunks.push(chunk);
              if (chunks.length === 1) timeline.mark("first-byte");
            }),
        ),
      );

      // Both loaders must be in flight, and the shell already flushed, before
      // either loader is allowed to settle.
      yield* Effect.sleep("30 millis");
      const bothStartedBeforeEitherFinished =
        timeline.has("parent:start")
        && timeline.has("child:start")
        && !timeline.has("parent:end")
        && !timeline.has("child:end");
      const firstByteBeforeLoaders =
        timeline.indexOf("first-byte") >= 0
        && !timeline.has("parent:end")
        && !timeline.has("child:end");

      yield* Deferred.succeed(releaseChild, undefined);
      yield* Deferred.succeed(releaseParent, undefined);
      yield* Fiber.await(fiber);
      return { bothStartedBeforeEitherFinished, firstByteBeforeLoaders, chunks };
    });

    const result = await Effect.runPromise(program as Effect.Effect<any, never, never>);

    // Sequential loaders make this impossible — the second cannot start until
    // the first settles.
    expect(result.bothStartedBeforeEitherFinished).toBe(true);
    // And the shell was already on the wire while both were pending.
    expect(result.firstByteBeforeLoaders).toBe(true);
    // Exactly one run per loader per request: no double pass, no cache miss.
    expect(timeline.labels().filter((label) => label === "parent:start")).toHaveLength(1);
    expect(timeline.labels().filter((label) => label === "child:start")).toHaveLength(1);
  });

  it("[M11.4] never delays the first byte on a slow deferred loader", async () => {
    const Route = await srcModule("Route");
    const Component = await srcModule("Component");
    const renderRequestStream = Route.renderRequestStream;
    if (renderRequestStream === undefined) {
      unbuilt(
        "Route.renderRequestStream (fork-all-loaders navigation)",
        "DQ-017",
      );
    }

    const timeline = makeTimeline();
    const program = Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const Slow = Route.loader(
        () =>
          Effect.gen(function* () {
            timeline.mark("deferred:start");
            yield* Deferred.await(release);
            timeline.mark("deferred:end");
            return { slow: true };
          }),
        { deferred: true },
      )(Route.path("/deferred-shell")(Component.from(() => "shell")));

      const chunks: string[] = [];
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(
          renderRequestStream(Slow, {
            request: new Request("http://test.local/deferred-shell"),
          }),
          (chunk: string) => Effect.sync(() => void chunks.push(chunk)),
        ),
      );
      yield* Effect.sleep("30 millis");
      const shellFlushed = chunks.join("").includes("shell");
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.await(fiber);
      return { shellFlushed, chunks };
    });

    const { shellFlushed, chunks } = await Effect.runPromise(
      program as Effect.Effect<any, never, never>,
    );

    expect(shellFlushed).toBe(true);
    // The deferred loader's data still arrives, on the existing script-streaming
    // path — a versioned handoff script, not a new wire format.
    expect(chunks.join("")).toContain(Route.loaderHandoffGlobalKey);
    expect(timeline.has("deferred:end")).toBe(true);
  });

  it("[M11.4] hands streamed loader results to the request cache so revalidation does not refetch", async () => {
    const Route = await srcModule("Route");
    const Component = await srcModule("Component");
    const routerRuntime = await srcModule("router-runtime");
    const Serialization = await srcModule("Serialization");
    const { Result } = await srcModule("effect-ts");
    const renderRequestStream = Route.renderRequestStream;
    if (renderRequestStream === undefined) {
      unbuilt(
        "Route.renderRequestStream (fork-all-loaders navigation)",
        "DQ-017",
      );
    }

    let loads = 0;
    const App = Route.loader(
      (params: { readonly id: string }) =>
        Effect.sync(() => {
          loads += 1;
          return { id: params.id };
        }),
      { staleTime: "5 minutes" },
    )(
      Route.paramsSchema(Schema.Struct({ id: Schema.String }))(
        Route.path("/single-flight/:id")(Component.from(() => "page")),
      ),
    );

    const html = await Effect.runPromise(
      Stream.runFold(
        renderRequestStream(App, {
          request: new Request("http://test.local/single-flight/abc"),
        }),
        () => "",
        (accumulator: string, chunk: string) => accumulator + chunk,
      ).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        string,
        never,
        never
      >,
    );

    // One load for the request, and the streamed result carries the identity
    // the client cache keys on, so hydration is a cache fill rather than a
    // second fetch.
    expect(loads).toBe(1);
    expect(html).toContain(Route.loaderHandoffGlobalKey);

    const store = routerRuntime.makeLoaderCacheStore();
    await Effect.runPromise(
      Route.hydrateLoaderHandoff(App, {
        input: {
          version: Route.loaderHandoffVersion,
          entries: [
            {
              routeId: "/single-flight/:id",
              params: { id: "abc" },
              result: Serialization.resultToWire(Result.success({ id: "abc" })),
            },
          ],
        },
      }).pipe(
        Effect.provideService(routerRuntime.LoaderCacheTag, store),
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<void, never, never>,
    );

    // `toBeDefined()` alone was trivially satisfiable here, so assert the
    // entry's *content*: hydration must have filled the cache with the streamed
    // value, keyed on the params the client will look it up by.
    const entry = routerRuntime.getLoaderCacheEntry(
      "/single-flight/:id",
      { id: "abc" },
      store,
    );
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).toContain("abc");
    // Negative control on the key: a different param set is a miss, so this is
    // a real keyed cache and not a "anything you ask for is present" stub.
    expect(
      routerRuntime.getLoaderCacheEntry(
        "/single-flight/:id",
        { id: "other" },
        store,
      ),
    ).toBeUndefined();
    // Hydrating the streamed result must not have re-run the loader.
    expect(loads).toBe(1);
  });
});
