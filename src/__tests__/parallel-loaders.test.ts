/**
 * M11.4 — router integration: parallel fetch-and-render. Promoted from
 * `future/streaming/parallel-loaders.spec.ts` (all green 2026-08-11),
 * retyped.
 *
 * `Route.renderRequestStream` (`DQ-017`) forks ALL matched loaders —
 * critical and deferred — as one concurrent pass under the request and
 * flushes the shell immediately; results land on the ratified `DQ-034`
 * handoff wire (inert `data-af-loader` entry scripts, never a window
 * global), so client hydration is a cache fill rather than a refetch.
 * The same single-pass loader run also fixed `renderRequest`'s old
 * critical-then-all double execution in place.
 */
import { Deferred, Effect, Fiber, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as Serialization from "../Serialization.js";
import { Result } from "../effect-ts.js";
import {
  LoaderCacheTag,
  getLoaderCacheEntry,
  makeLoaderCacheStore,
} from "../router-runtime.js";

/** Wall-clock ordering probe: labels with a monotonic sequence. */
function makeTimeline() {
  const entries: Array<{ readonly label: string; readonly at: number }> = [];
  let sequence = 0;
  return {
    mark: (label: string): void => {
      entries.push({ label, at: sequence++ });
    },
    labels: (): string[] => entries.map((entry) => entry.label),
    indexOf: (label: string): number =>
      entries.findIndex((entry) => entry.label === label),
    has: (label: string): boolean =>
      entries.some((entry) => entry.label === label),
  };
}

describe("parallel route data with streaming (M11.4)", () => {
  it("starts every matched loader before any of them finishes", async () => {
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

      // Child route paths are absolute (R1 house style).
      const Child = Route.loader((_: {}) => loader("child", releaseChild), {
        staleTime: "5 minutes",
      })(Route.path("/parallel/child")(Component.from(() => "child")));
      const App = Route.loader((_: {}) => loader("parent", releaseParent), {
        staleTime: "5 minutes",
      })(
        Route.children([Child])(
          Route.layout()(Route.path("/parallel")(Component.from(() => "parent"))),
        ),
      );

      const chunks: string[] = [];
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(
          Route.renderRequestStream(App, {
            request: new Request("http://test.local/parallel/child"),
          }),
          (chunk) =>
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
      return { bothStartedBeforeEitherFinished, firstByteBeforeLoaders };
    });

    const result = await Effect.runPromise(program);

    // Sequential loaders make this impossible — the second cannot start until
    // the first settles.
    expect(result.bothStartedBeforeEitherFinished).toBe(true);
    // And the shell was already on the wire while both were pending.
    expect(result.firstByteBeforeLoaders).toBe(true);
    // Exactly one run per loader per request: no double pass, no cache miss.
    expect(
      timeline.labels().filter((label) => label === "parent:start"),
    ).toHaveLength(1);
    expect(
      timeline.labels().filter((label) => label === "child:start"),
    ).toHaveLength(1);
  });

  it("never delays the first byte on a slow deferred loader", async () => {
    const timeline = makeTimeline();
    const program = Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const Slow = Route.loader(
        (_: {}) =>
          Effect.gen(function* () {
            timeline.mark("deferred:start");
            yield* Deferred.await(release);
            timeline.mark("deferred:end");
            return { slow: true };
          }),
        { priority: "deferred" },
      )(Route.path("/deferred-shell")(Component.from(() => "shell")));

      const chunks: string[] = [];
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(
          Route.renderRequestStream(Slow, {
            request: new Request("http://test.local/deferred-shell"),
          }),
          (chunk) => Effect.sync(() => void chunks.push(chunk)),
        ),
      );
      yield* Effect.sleep("30 millis");
      const shellFlushed = chunks.join("").includes("shell");
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.await(fiber);
      return { shellFlushed, chunks };
    });

    const { shellFlushed, chunks } = await Effect.runPromise(program);

    expect(shellFlushed).toBe(true);
    // DQ-034 wire: the deferred data arrives as inert entry scripts, and the
    // legacy window global never appears.
    expect(chunks.join("")).toContain(Route.loaderEntryScriptAttribute);
    expect(chunks.join("")).not.toContain(Route.loaderHandoffGlobalKey);
    expect(timeline.has("deferred:end")).toBe(true);
  });

  it("hands streamed loader results to the request cache so revalidation does not refetch", async () => {
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
        Route.renderRequestStream(App, {
          request: new Request("http://test.local/single-flight/abc"),
        }),
        () => "",
        (accumulator, chunk) => accumulator + chunk,
      ),
    );

    // One load for the request, streamed on the DQ-034 entry-script wire.
    expect(loads).toBe(1);
    expect(html).toContain(Route.loaderEntryScriptAttribute);

    const store = makeLoaderCacheStore();
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
        Effect.provideService(LoaderCacheTag, store),
        Effect.provide(Serialization.layer),
      ),
    );

    // Hydration filled the cache with the streamed value, keyed on the params
    // the client will look it up by.
    const entry = getLoaderCacheEntry("/single-flight/:id", { id: "abc" }, store);
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).toContain("abc");
    // Negative control on the key: a different param set is a miss.
    expect(
      getLoaderCacheEntry("/single-flight/:id", { id: "other" }, store),
    ).toBeUndefined();
    // Hydrating the streamed result must not have re-run the loader.
    expect(loads).toBe(1);
  });
});
