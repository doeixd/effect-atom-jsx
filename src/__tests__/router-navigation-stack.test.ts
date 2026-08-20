/**
 * R4 — one navigation stack.
 *
 * `RouterService` becomes the public facade *implemented by* `RouterRuntime`:
 * `Link`, `queryAtom`, `reload`, and `prefetch` all drive the runtime's
 * supersession path and read the runtime's URL state — never `window.location`,
 * never a synthetic `PopStateEvent`, never `Effect.runSync` inside a signal
 * write.
 *
 * `DQ-031` (ratified 2026-07-30) settles two things: (a) `RouterService` is a
 * **narrow** read/command interface implemented by `RouterRuntime` *and* by the
 * loader-less Browser/Hash/Memory/Server layers — narrow enough that it cannot
 * expose pending state or supersession; and (b) a `queryAtom` signal write
 * updates optimistically, forks the navigation, and rolls back on failure with
 * the error observable.
 *
 * Owner: docs/ROUTER_CONSOLIDATION_PLAN.md § R4 (`DQ-031`).
 */
import { describe, expect, it } from "vitest";
import { Deferred, Effect, Exit, Layer, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as RouterRuntime from "../RouterRuntime.js";
import { clearLoaderCache } from "../router-runtime.js";
import { withTestLayer } from "../testing.js";

// Promoted from future/router/navigation-stack.spec.ts (all green 2026-08-11),
// retyped: no `any`, no assertion casts.

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("R4 — one navigation stack", () => {
  it("[R4] RouterService is implemented by the runtime, so navigating through it drives loaders", async () => {

    let loads = 0;
    const Page = Route.loader((_: {}) => Effect.sync(() => {
      loads += 1;
      return { visits: loads };
    }))(
      Route.id("r4.page")(Route.path("/r4-page")(Component.from(() => null))),
    );
    const App = Route.children([Page])(
      Route.layout()(Route.path("/")(Component.from(() => null))),
    );
    const history = RouterRuntime.createMemoryHistory("/");
    const runtime = RouterRuntime.create({ app: App, history });
    Effect.runSync(runtime.initialize());

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const router = yield* Route.RouterTag;
        yield* router.navigate("/r4-page");
        // The facade's URL state is the runtime's, not a parallel atom.
        return router.url().pathname;
      }).pipe(Effect.provide(RouterRuntime.toLayer(runtime, history))),
    );

    expect(exit._tag).toBe("Success");
    expect(Exit.isSuccess(exit) ? exit.value : undefined).toBe("/r4-page");
    await flush();
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.location.pathname).toBe("/r4-page");
    expect(snapshot.loaderData.get("r4.page")).toEqual({ visits: 1 });
  });

  it("[R4] a superseded navigation's loader result is discarded, not applied", async () => {

    const gates = new Map<string, Deferred.Deferred<void>>();
    const gated = (id: string, path: string) =>
      Route.loader((_: {}) => Effect.gen(function* () {
        const gate = yield* Effect.sync(() => {
          const made = Effect.runSync(Deferred.make<void>());
          gates.set(id, made);
          return made;
        });
        yield* Deferred.await(gate);
        return { id };
      }))(Route.id(id)(Route.path(path)(Component.from(() => null))));

    const Slow = gated("r4.slow", "/r4-slow");
    const Fast = gated("r4.fast", "/r4-fast");
    const App = Route.children([Slow, Fast])(
      Route.layout()(Route.path("/")(Component.from(() => null))),
    );
    const history = RouterRuntime.createMemoryHistory("/");
    const runtime = RouterRuntime.create({ app: App, history });
    Effect.runSync(runtime.initialize());

    const layer = RouterRuntime.toLayer(runtime, history);
    const navigate = (to: string) =>
      Effect.runPromiseExit(Effect.gen(function* () {
        const router = yield* Route.RouterTag;
        yield* router.navigate(to);
      }).pipe(Effect.provide(layer)));

    const first = navigate("/r4-slow");
    await flush();
    const second = navigate("/r4-fast");
    await flush();

    // Both navigations must have reached the runtime's loader path at all.
    expect([...gates.keys()].sort()).toEqual(["r4.fast", "r4.slow"]);

    // Release the loser last: its result must never reach the snapshot.
    const release = (id: string) => {
      const gate = gates.get(id);
      if (gate) Effect.runSync(Deferred.succeed(gate, undefined));
    };
    release("r4.fast");
    await flush();
    release("r4.slow");
    await flush();
    await first;
    await second;

    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.location.pathname).toBe("/r4-fast");
    expect(snapshot.loaderData.get("r4.fast")).toEqual({ id: "r4.fast" });
    expect(snapshot.loaderData.has("r4.slow")).toBe(false);
  });

  it("[R4] Route.reload revalidates through the runtime", async () => {

    let loads = 0;
    const Page = Route.loader((_: {}) => Effect.sync(() => {
      loads += 1;
      return { loads };
    }))(Route.id("r4.reload")(Route.path("/r4-reload")(Component.from(() => null))));

    const history = RouterRuntime.createMemoryHistory("/r4-reload");
    const runtime = RouterRuntime.create({ app: Page, history });
    Effect.runSync(runtime.initialize());
    await flush();
    expect(loads).toBe(1);

    await Effect.runPromise(
      Route.reload.pipe(Effect.provide(RouterRuntime.toLayer(runtime, history))),
    );
    await flush();

    expect(loads).toBe(2);
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.loaderData.get("r4.reload")).toEqual({ loads: 2 });
  });

  it("[R4] prefetch warms the cache so the following navigation does not re-run the loader", async () => {

    let loads = 0;
    const Page = Route.loader((_: {}) => Effect.sync(() => {
      loads += 1;
      return { loads };
    }), { staleTime: "1 minute" })(
      Route.id("r4.prefetch")(Route.path("/r4-prefetch/:id")(Component.from(() => null))),
    );
    // ISOLATION: scoped to this spec's own route id, never a process-wide wipe.
    clearLoaderCache("r4.prefetch");

    await Effect.runPromise(Route.prefetch(Page, Route.link(Page), { id: "alice" }));
    expect(loads).toBe(1);

    const runtime = RouterRuntime.create({
      app: Page,
      history: RouterRuntime.createMemoryHistory("/"),
    });
    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.navigate("/r4-prefetch/alice"));
    await flush();

    // Exactly once: the prefetched entry served the navigation.
    expect(loads).toBe(1);
    expect(Effect.runSync(runtime.snapshot()).loaderData.get("r4.prefetch")).toEqual({ loads: 1 });
  });

  // `DQ-031`(b), ratified 2026-07-30: a `queryAtom` signal write updates the atom
  // **immediately** from the encoded value, **forks** the navigation, and on
  // failure **rolls the atom back** with the error observable — never swallowed.
  // Rejected: fire-and-forget (no error story) and a read-only atom with an
  // `Effect` setter (which breaks `page.set(7)`, the entire point of the API).
  // The accepted cost is a visible window where atom and URL disagree, which the
  // rollback rule bounds.
  it("[R4] queryAtom.set updates the atom immediately and drives the navigation to completion", async () => {

    // A router whose navigation is genuinely asynchronous: `Effect.runSync`
    // inside a signal write cannot drive this.
    const url = Atom.value(new URL("/r4-query?page=2", "http://test.local"));
    const asyncRouter = Layer.succeed(Route.RouterTag, {
      url,
      navigate: (to: string) => Effect.sleep(5).pipe(Effect.map(() => {
        url.set(new URL(to, "http://test.local"));
      })),
      back: () => Effect.void,
      forward: () => Effect.void,
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const page = yield* Route.queryAtom("page", Schema.NumberFromString, { default: 1 });
        expect(page()).toBe(2);
        page.set(7);
        // Optimistic: readable as 7 before the navigation has had any chance to
        // land. The URL still says 2 here — that disagreement window is the
        // accepted cost, and its existence is the proof the update was optimistic
        // rather than a synchronous navigation in disguise.
        expect(page()).toBe(7);
        expect(url().searchParams.get("page")).toBe("2");
        return page;
      }).pipe(Effect.provide(asyncRouter)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    // Reconciled: the forked navigation completed and the atom still agrees.
    expect(url().searchParams.get("page")).toBe("7");
    if (Exit.isSuccess(exit)) expect(exit.value()).toBe(7);
  });

  it("[R4] a failed queryAtom navigation rolls the atom back and surfaces the error", async () => {

    const url = Atom.value(new URL("/r4-query-fail?page=2", "http://test.local"));
    const seen: Array<unknown> = [];
    const failingRouter = Layer.succeed(Route.RouterTag, {
      url,
      navigate: (_to: string) => Effect.sleep(5).pipe(
        Effect.flatMap(() => Effect.fail({ _tag: "NavigationBlocked" } as const)),
      ),
      back: () => Effect.void,
      forward: () => Effect.void,
      // The runtime's navigation error channel. "Never swallowed" is the whole
      // point of the decision, so a spec that only checked the rollback would
      // pass against a `catchAll(() => void)` implementation.
      onNavigationError: (error: unknown) => Effect.sync(() => {
        seen.push(error);
      }),
    });

    const page = await Effect.runPromise(
      Effect.gen(function* () {
        const atom = yield* Route.queryAtom("page", Schema.NumberFromString, { default: 1 });
        atom.set(7);
        expect(atom()).toBe(7);
        return atom;
      }).pipe(Effect.provide(failingRouter)),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    // Rolled back to the URL's value, not left showing a state that never landed.
    expect(page()).toBe(2);
    expect(url().searchParams.get("page")).toBe("2");
    expect(seen).toEqual([{ _tag: "NavigationBlocked" }]);
  });

  // `DQ-031`(a): `RouterService` is a **narrow** read/command interface that the
  // runtime and the loader-less Browser/Hash/Memory/Server layers all implement.
  // That is what makes "one navigation stack" true as a *type* rather than as a
  // convention — so the test that earns it runs one script against both.
  it("[R4] one script over RouterService behaves identically against the runtime and a Memory layer", async () => {

    // The script only ever touches the narrow interface.
    const script = Effect.gen(function* () {
      const router = yield* Route.RouterTag;
      const start = router.url().pathname;
      yield* router.navigate("/r4-narrow/a");
      const afterFirst = router.url().pathname;
      yield* router.navigate("/r4-narrow/b");
      const afterSecond = router.url().pathname;
      yield* router.back();
      return { start, afterFirst, afterSecond, afterBack: router.url().pathname };
    });

    const App = Route.children([
      Route.id("r4.narrow.a")(Route.path("/r4-narrow/a")(Component.from(() => null))),
      Route.id("r4.narrow.b")(Route.path("/r4-narrow/b")(Component.from(() => null))),
    ])(Route.layout()(Route.path("/")(Component.from(() => null))));
    const history = RouterRuntime.createMemoryHistory("/");
    const runtime = RouterRuntime.create({ app: App, history });
    Effect.runSync(runtime.initialize());

    const viaRuntime = await Effect.runPromise(
      script.pipe(Effect.provide(RouterRuntime.toLayer(runtime, history))),
    );
    const viaMemory = await Effect.runPromise(
      script.pipe(Effect.provide(Route.Memory("/"))),
    );

    const expected = {
      start: "/",
      afterFirst: "/r4-narrow/a",
      afterSecond: "/r4-narrow/b",
      afterBack: "/r4-narrow/a",
    };
    expect(viaMemory).toEqual(expected);
    expect(viaRuntime).toEqual(expected);
    // Stated as the invariant it is, so a future divergence names itself.
    expect(viaRuntime).toEqual(viaMemory);
  });

  it("[R4] the RouterService interface stays narrow enough for a loader-less layer to honour", async () => {

    const probe = Effect.gen(function* () {
      const router = yield* Route.RouterTag;
      // Structural view for key-presence probing only — services have no
      // index signature, and absence checks are inherently untypeable.
      const record: Readonly<Record<string, unknown>> = { ...router };
      return {
        // Present on both, or the interface is not honoured.
        has: ["url", "navigate", "back", "forward"].filter((k) => record[k] !== undefined),
        // Absent from both. The constraint the decision imposes: a loader-less
        // layer cannot produce pending state or supersession, so the interface
        // must not promise them. Widening it until only the runtime can satisfy it
        // is the failure mode this guards.
        leaked: ["pending", "navigation", "supersede", "loaderData", "revalidation"]
          .filter((k) => record[k] !== undefined),
      };
    });

    const App = Route.children([Route.id("r4.narrow2")(Route.path("/r4-narrow2")(Component.from(() => null)))])(
      Route.layout()(Route.path("/")(Component.from(() => null))),
    );
    const history = RouterRuntime.createMemoryHistory("/");
    const runtime = RouterRuntime.create({ app: App, history });
    Effect.runSync(runtime.initialize());

    const fromRuntime = await Effect.runPromise(
      probe.pipe(Effect.provide(RouterRuntime.toLayer(runtime, history))),
    );
    const fromMemory = await Effect.runPromise(
      probe.pipe(Effect.provide(Route.Memory("/"))),
    );

    expect(fromMemory.has).toEqual(["url", "navigate", "back", "forward"]);
    expect(fromRuntime.has).toEqual(["url", "navigate", "back", "forward"]);
    expect(fromMemory.leaked).toEqual([]);
    expect(fromRuntime.leaked).toEqual([]);
  });

  // `DQ-031`, the fix both halves require: `Link` active state must read the
  // *service's* URL. `window.location.pathname` is simply wrong under the Hash,
  // Memory, and Server layers.
  it("[R4] Link active state comes from the router service, not the document location", async () => {

    const Page = Route.path("/r4-active/:id")(Component.from(() => null));

    // The `class` callback receives `active` before any DOM construction, so it
    // observes the decision even though rendering an anchor outside compiled JSX
    // does not complete in this environment (`createComponent("a", …)` needs a
    // DOM). Only the recorded `active` flag is asserted, so this spec stays about
    // the URL source and does not accidentally become a rendering test — see the
    // sibling spec below for the "no browser global" half.
    const activeUnder = async (initial: string) => {
      const harness = withTestLayer(Route.Memory(initial));
      const seen: Array<boolean> = [];
      try {
        harness.run(() => {
          try {
            Route.Link({
              to: Route.link(Page),
              params: { id: "alice" },
              class: (active: boolean) => {
                seen.push(active);
                return active ? "on" : "off";
              },
              children: "go",
            });
          } catch {
            // Rendering the anchor is out of scope here; the `class` callback has
            // already reported the only thing under test.
          }
        });
      } finally {
        await harness.dispose();
      }
      return seen;
    };

    // Contradict the document so a `window.location` read cannot accidentally
    // agree with the service.
    const carrier = globalThis as unknown as Record<string, unknown>;
    const previousWindow = carrier["window"];
    carrier["window"] = { location: { pathname: "/somewhere-else" } };
    try {
      const onRoute = await activeUnder("/r4-active/alice");
      // Guard the guard: an empty recorder would make the flag assertion vacuous.
      expect(onRoute).toHaveLength(1);
      expect(onRoute[0]).toBe(true);
      // NEGATIVE CONTROL: same route, same document location, different service
      // URL. An implementation that hard-codes `true` — or that reads the
      // (unchanged) document — cannot satisfy both halves.
      const offRoute = await activeUnder("/elsewhere");
      expect(offRoute).toHaveLength(1);
      expect(offRoute[0]).toBe(false);
    } finally {
      if (previousWindow === undefined) delete carrier["window"];
      else carrier["window"] = previousWindow;
    }
  });

  it("[R4] Link renders without consulting any browser global", async () => {
    // Renamed: the body cannot see which global was *not* used, only that none
    // was touched at all — which is the stronger and actually-checkable claim,
    // and covers both `window.location` reads and `new PopStateEvent(...)`.

    const touched: Array<string> = [];
    const fakeWindow = new Proxy({}, {
      get: (_target, property) => {
        touched.push(String(property));
        return undefined;
      },
    });
    const carrier = globalThis as unknown as Record<string, unknown>;
    const previousWindow = carrier["window"];
    carrier["window"] = fakeWindow;
    try {
      const Page = Route.path("/r4-link/:id")(Component.from(() => null));
      // Rendering the anchor must not consult browser globals for active state
      // or fall back to `pushState` + `new PopStateEvent(...)`. Any throw here
      // is itself a symptom, so it is recorded rather than propagated: the
      // assertion below is the contract.
      try {
        Route.Link({
          to: Route.link(Page),
          params: { id: "alice" },
          class: (active: boolean) => (active ? "on" : "off"),
          children: "go",
        });
      } catch {
        touched.push("threw");
      }
      // NEGATIVE CONTROL for the probe itself: if the Proxy were mis-built, or if
      // `globalThis.window` were not the object the code under test reads,
      // `touched` would be empty no matter what `Link` did. Prove the recorder
      // actually records before trusting its silence.
      void (fakeWindow as { readonly location?: unknown }).location;
      expect(touched).toEqual(["location"]);
      touched.length = 0;
      // Re-render with the recorder known-live.
      try {
        Route.Link({
          to: Route.link(Page),
          params: { id: "bob" },
          class: (active: boolean) => (active ? "on" : "off"),
          children: "go",
        });
      } catch {
        touched.push("threw");
      }
    } finally {
      if (previousWindow === undefined) delete carrier["window"];
      else carrier["window"] = previousWindow;
    }

    expect(touched).toEqual([]);
  });
});
