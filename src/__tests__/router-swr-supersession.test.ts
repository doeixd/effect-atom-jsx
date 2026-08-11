/**
 * R4 / R2 follow-up — stale-while-revalidate refreshes are supersession-tracked.
 *
 * R2 had to move the SWR refresh to `Effect.forkDetach`: `forkChild` tied it to
 * the requesting loader fiber, which completes immediately with the stale value
 * and therefore cancelled every refresh. The finished design threads the
 * navigation scope down to loaders, so a refresh both *completes* and *is
 * cancellable by navigating away*.
 *
 * `DQ-032` (ratified 2026-07-30) gives the refresh **two owners, by role**: the
 * **cache-store scope bounds the write** (taken first — the server-side
 * write-after-response leak is a live safety issue) and the **navigation scope
 * may interrupt**. Independently: **at most one in-flight refresh per cache
 * key** — a second request joins the running one rather than starting a second,
 * which removes a last-write-wins race and matches how `Refreshing` already
 * reads as a single state.
 *
 * Owner: docs/ROUTER_CONSOLIDATION_PLAN.md § R2 handoff task 3 → R3/R4
 * (`DQ-032`).
 */
import { describe, expect, it } from "vitest";
import { Deferred, Effect } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as RouterRuntime from "../RouterRuntime.js";
import {
  LoaderCacheTag,
  clearLoaderCache,
  getLoaderCacheEntry,
  makeLoaderCacheStore,
  runCachedLoader,
} from "../router-runtime.js";

// Promoted from future/router/swr-supersession.spec.ts (all green 2026-08-11),
// retyped: no `any`, no assertion casts.
const runtime = { runCachedLoader, makeLoaderCacheStore, getLoaderCacheEntry, LoaderCacheTag };

/** The success value of a cached result — direct or behind `Refreshing`. */
function cachedValue(result: unknown): unknown {
  if (typeof result !== "object" || result === null) return undefined;
  const tagged = result as { readonly _tag?: unknown; readonly value?: unknown; readonly previous?: { readonly value?: unknown } };
  if (tagged._tag === "Success") return tagged.value;
  if (tagged._tag === "Refreshing") return tagged.previous?.value;
  return undefined;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("R4 — SWR refresh supervision", () => {
  it("[R4] a stale-while-revalidate refresh completes and updates the cache", async () => {

    const store = runtime.makeLoaderCacheStore();
    let value = 0;
    const load = Effect.sync(() => {
      value += 1;
      return { value };
    });
    const run = () => Effect.runPromise(
      runtime.runCachedLoader("/r4-swr-cache", { id: 1 }, load, {
        staleTime: 0,
        staleWhileRevalidate: true,
      }).pipe(Effect.provideService(runtime.LoaderCacheTag, store)),
    );

    const first = await run();
    expect(first._tag).toBe("Success");
    expect(cachedValue(first)).toEqual({ value: 1 });

    // Second read is served stale immediately while a refresh runs behind it.
    const second = await run();
    expect(second._tag).toBe("Refreshing");
    await flush();

    // The refresh actually finished and wrote through to the cache.
    const entry = runtime.getLoaderCacheEntry("/r4-swr-cache", { id: 1 }, store);
    expect(entry?.result._tag).toBe("Success");
    expect(cachedValue(entry?.result)).toEqual({ value: 2 });
    expect(value).toBe(2);
  });

  // `DQ-032`, half one: **the cache-store scope bounds the write.** This is the
  // half taken first, because it fixes a live safety issue — on the server the
  // loader cache is per request, so a refresh that outlives the response writes
  // into a store nobody will ever read, holding the request's data alive behind
  // it. Counts, not final state: a leak is "it wrote at all", which a final-value
  // assertion can miss when the value happens to match.
  it("[R4] disposing the cache store interrupts and refuses a late SWR refresh write", async () => {

    const store = runtime.makeLoaderCacheStore();
    const gate = Effect.runSync(Deferred.make<void>());
    let starts = 0;
    let interrupted = 0;
    const load = Effect.suspend(() => {
      starts += 1;
      const n = starts;
      if (n === 1) return Effect.succeed({ n });
      return Deferred.await(gate).pipe(
        Effect.map(() => ({ n })),
        Effect.onInterrupt(() => Effect.sync(() => {
          interrupted += 1;
        })),
      );
    });
    const run = () => Effect.runPromise(
      runtime.runCachedLoader("/r4-swr-scope", { id: 1 }, load, {
        staleTime: 0,
        staleWhileRevalidate: true,
      }).pipe(Effect.provideService(runtime.LoaderCacheTag, store)),
    );

    expect((await run())._tag).toBe("Success");
    expect((await run())._tag).toBe("Refreshing");
    await flush();
    expect(starts).toBe(2);

    // The store's scope closes — on the server this is the response being sent.
    // (The plan leaves the *name* of this open; the semantics is what is pinned:
    // closing the cache store's scope ends any write it still owns.)
    store.dispose();
    Effect.runSync(Deferred.succeed(gate, undefined));
    await flush();
    await flush();

    expect(interrupted).toBe(1);
    // Nothing was written after the scope closed.
    const entry = runtime.getLoaderCacheEntry("/r4-swr-scope", { id: 1 }, store);
    expect(cachedValue(entry?.result)).toEqual({ n: 1 });

    // NEGATIVE CONTROL: an identical refresh in a *live* store completes and
    // writes. Without it, a `runCachedLoader` that never refreshes at all — or a
    // `dispose` that is a no-op because refreshes never write anyway — passes
    // everything above forever. (See also the first spec in this file, which
    // pins the write-through on the happy path.)
    const live = runtime.makeLoaderCacheStore();
    let liveStarts = 0;
    const liveLoad = Effect.sync(() => {
      liveStarts += 1;
      return { n: liveStarts };
    });
    const runLive = () => Effect.runPromise(
      runtime.runCachedLoader("/r4-swr-scope-live", { id: 1 }, liveLoad, {
        staleTime: 0,
        staleWhileRevalidate: true,
      }).pipe(Effect.provideService(runtime.LoaderCacheTag, live)),
    );
    await runLive();
    await runLive();
    await flush();
    expect(liveStarts).toBe(2);
    expect(cachedValue(runtime.getLoaderCacheEntry("/r4-swr-scope-live", { id: 1 }, live)?.result))
      .toEqual({ n: 2 });
  });

  // `DQ-032`, the independent half: **at most one in-flight refresh per cache
  // key.** A second request joins the running one rather than starting a second,
  // which removes a last-write-wins race between two refreshes of the same key.
  // Counted, because the failure mode is a *duplicate*, which a final-value
  // assertion cannot see.
  it("[R4] concurrent reads of a stale key share one in-flight refresh", async () => {

    const store = runtime.makeLoaderCacheStore();
    const gate = Effect.runSync(Deferred.make<void>());
    let starts = 0;
    const load = Effect.suspend(() => {
      starts += 1;
      const n = starts;
      if (n === 1) return Effect.succeed({ n });
      return Deferred.await(gate).pipe(Effect.map(() => ({ n })));
    });
    const run = () => Effect.runPromise(
      runtime.runCachedLoader("/r4-swr-join", { id: 1 }, load, {
        staleTime: 0,
        staleWhileRevalidate: true,
      }).pipe(Effect.provideService(runtime.LoaderCacheTag, store)),
    );

    await run();
    expect(starts).toBe(1);

    // Three concurrent stale reads. Each is served the stale value immediately;
    // between them they must start exactly ONE refresh.
    const reads = await Promise.all([run(), run(), run()]);
    for (const read of reads) expect(read._tag).toBe("Refreshing");
    await flush();
    expect(starts).toBe(2);

    Effect.runSync(Deferred.succeed(gate, undefined));
    await flush();
    await flush();
    // One refresh, one write, one winner — no last-write-wins race to arbitrate.
    expect(starts).toBe(2);
    expect(cachedValue(runtime.getLoaderCacheEntry("/r4-swr-join", { id: 1 }, store)?.result))
      .toEqual({ n: 2 });

    // NEGATIVE CONTROL: joining must not become caching-forever. Once the refresh
    // has settled, a later stale read starts a NEW refresh rather than joining the
    // completed one.
    const later = await run();
    expect(later._tag).toBe("Refreshing");
    await flush();
    expect(starts).toBe(3);
  });

  // Keep-stale on failure (the M6 rule, applied to loaders): a refresh that
  // FAILS while the cache still holds last-known-good data settles to
  // `Stale(error, data)` — the data stays in hand and the typed error rides
  // alongside it — rather than blanking to `Failure`.
  it("[R5] a failed SWR refresh settles the cache to Stale, keeping the data", async () => {
    const store = runtime.makeLoaderCacheStore();
    let starts = 0;
    const load = Effect.suspend(() => {
      starts += 1;
      if (starts === 1) return Effect.succeed({ n: 1 });
      return Effect.fail({ _tag: "Offline" } as const);
    });
    const run = () => Effect.runPromise(
      runtime.runCachedLoader("/r5-keep-stale", { id: 1 }, load, {
        staleTime: 0,
        staleWhileRevalidate: true,
      }).pipe(Effect.provideService(runtime.LoaderCacheTag, store)),
    );

    expect((await run())._tag).toBe("Success");
    expect((await run())._tag).toBe("Refreshing");
    await flush();
    expect(starts).toBe(2);

    const entry = runtime.getLoaderCacheEntry("/r5-keep-stale", { id: 1 }, store);
    expect(entry?.result._tag).toBe("Stale");
    if (entry?.result._tag === "Stale") {
      expect(entry.result.data).toEqual({ n: 1 });
      expect(entry.result.error).toEqual({ _tag: "Offline" });
    }

    // NEGATIVE CONTROL: with no previous data in hand, a failure is a plain
    // Failure — keep-stale must not conjure data from nowhere.
    const empty = runtime.makeLoaderCacheStore();
    const failed = await Effect.runPromise(
      runtime.runCachedLoader("/r5-keep-stale-empty", { id: 1 }, Effect.fail({ _tag: "Offline" } as const), {})
        .pipe(Effect.provideService(runtime.LoaderCacheTag, empty)),
    );
    expect(failed._tag).toBe("Failure");
  });

  it("[R4] navigating away interrupts an in-flight SWR refresh", async () => {

    let calls = 0;
    let refreshInterrupted = false;
    const Swr = Route.loader((_: {}) => Effect.suspend(() => {
      calls += 1;
      if (calls === 1) return Effect.succeed({ value: "first" });
      return Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => {
        refreshInterrupted = true;
      })));
    }), { staleTime: 0, staleWhileRevalidate: true })(
      Route.id("r4.swr")(Route.path("/r4-swr")(Component.from(() => null))),
    );
    const Other = Route.id("r4.swr-other")(Route.path("/r4-swr-other")(Component.from(() => null)));
    const App = Route.children([Swr, Other])(
      Route.layout()(Route.path("/")(Component.from(() => null))),
    );

    // ISOLATION: clear only this spec's own key. A bare `clearLoaderCache()`
    // wipes the process-wide store that every other spec file shares, which is a
    // real source of cross-file flakiness under parallel runs.
    clearLoaderCache("r4.swr");
    const runtime = RouterRuntime.create({
      app: App,
      history: RouterRuntime.createMemoryHistory("/"),
    });
    Effect.runSync(runtime.initialize());

    await Effect.runPromise(runtime.navigate("/r4-swr"));
    await flush();
    expect(calls).toBe(1);

    // Re-entering the same route serves the stale entry and starts a refresh
    // that never settles on its own.
    await Effect.runPromise(runtime.navigate("/r4-swr?again=1"));
    await flush();
    expect(calls).toBe(2);
    expect(refreshInterrupted).toBe(false);

    // Navigating away must cancel it: the refresh belongs to the navigation
    // scope, not to a detached fiber nobody owns.
    await Effect.runPromise(runtime.navigate("/r4-swr-other"));
    await flush();
    expect(refreshInterrupted).toBe(true);
  });
});
