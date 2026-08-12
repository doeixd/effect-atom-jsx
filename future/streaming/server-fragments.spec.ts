/**
 * M11b — server UI fragments (`Resume.mountFragment`).
 *
 * A typed server function returns live, dormant UI: `{html, manifest}` from a
 * `Resume.collect` on the server, mounted into a validated boundary region of a
 * live page as an incremental install into the existing installation — the same
 * mechanism as a streamed region flush (M11 item 6), over a different
 * transport.
 *
 * What has to hold:
 *   - the fragment's button resumes on first touch, with the host page's
 *     counters untouched;
 *   - fragment-local ids (`c0`, `e0`, `x0`) are installation-scoped, so they
 *     cannot collide with the page's;
 *   - build-ID equality with the page is required, else the fragment renders
 *     inert with a diagnostic;
 *   - replacing or removing the region disposes the fragment exactly once, and
 *     never touches the parent installation.
 */

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { unbuilt } from "../harness.js";
import {
  StreamBuildId,
  makeSink,
  portableAction,
  recordingCode,
  resumeButton,
  resumeKit,
  runtimeFor,
  srcModule,
} from "./support.js";
import {
  asDocument,
  fakeDocument,
  fillRegion,
  removeRegion,
} from "./fake-dom.js";

/**
 * The host page: one resumable event of its own, plus an empty mount region.
 *
 * Ratified DQ-009: **the page installation gets an explicit scope id too**, so
 * its marker is `"page0:e0"` rather than a bare `"e0"`. A special-cased
 * unqualified page marker is exactly how a fragment id eventually collides
 * with the page's, which is the failure the spec below exercises.
 */
function hostPage() {
  return fakeDocument([
    {
      kind: "element",
      tag: "button",
      attributes: { "data-af-event-click": "page0:e0", id: "page" },
    },
    { kind: "region", id: "slot", edge: "start" },
    { kind: "region", id: "slot", edge: "end" },
  ]);
}

function pageManifest(code: any, label: string): unknown {
  return {
    version: 1,
    buildId: StreamBuildId,
    // The page's own scope id — see DQ-009 and `hostPage` above.
    installationId: "page0",
    events: {
      e0: {
        type: "click",
        invocation: "deferred-no-args",
        code: {
          version: 1,
          kind: "portable.code",
          id: code.id,
          buildId: StreamBuildId,
          captures: { label },
        },
      },
    },
  };
}

describe("server UI fragments (M11b)", () => {
  it("[M11b] mounts a server-rendered fragment that resumes on first touch", async () => {
    const { Portable, Resume, Serialization, dom } = await resumeKit();
    const mountFragment = Resume.mountFragment;
    if (mountFragment === undefined) {
      unbuilt("Resume.mountFragment (handle shape)", "DQ-013");
    }

    const sink = await makeSink();
    const pageCode = await recordingCode(Portable, sink, "future.fragment.page");
    const fragmentCode = await recordingCode(Portable, sink, "future.fragment.body");
    const doc = hostPage();
    const runtime = runtimeFor(sink.layer);

    const installation = await Effect.runPromise(
      Resume.installClient({
        root: asDocument(doc),
        manifest: pageManifest(pageCode, "page"),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [pageCode.id]: pageCode, [fragmentCode.id]: fragmentCode },
        runtime,
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );
    const before = installation.inspect();

    // The server side is just `Resume.collect` over a component — already
    // composable today; M11b adds the receiving primitive.
    const action = await portableAction(sink, fragmentCode, "fragment");
    const collected = await Effect.runPromise(
      Resume.collect(
        () => dom.renderToString(() => resumeButton(dom, Resume, action, "Fragment")),
        { buildId: StreamBuildId },
      ).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    const fragment = await Effect.runPromise(
      mountFragment(installation, "slot", {
        html: collected.html,
        manifest: collected.manifest,
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    const mounted = doc
      .querySelectorAll("[data-af-event-click]")
      .find((element) => element.getAttribute("id") === null);
    expect(mounted).toBeDefined();
    doc.dispatch("click", mounted!);
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["fragment"]);
    });

    // The page's own resumability is unaffected — its event still fires once,
    // and the mount added exactly one root listener's worth of ownership, not a
    // second whole installation.
    doc.dispatch("click", doc.querySelectorAll("[data-af-event-click]")[0]!);
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["fragment", "page"]);
    });
    expect(installation.inspect().disposed).toBe(false);
    expect(installation.inspect().eventListeners).toBe(before.eventListeners);

    await Effect.runPromise(fragment.dispose);
    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M11b] namespaces fragment ids so they cannot collide with the page's", async () => {
    const { Portable, Resume, Serialization, dom } = await resumeKit();
    const mountFragment = Resume.mountFragment;
    if (mountFragment === undefined) {
      unbuilt("Resume.mountFragment (id namespacing)", "DQ-015");
    }

    const sink = await makeSink();
    const pageCode = await recordingCode(Portable, sink, "future.fragment.ns.page");
    const fragmentCode = await recordingCode(Portable, sink, "future.fragment.ns.body");
    const doc = hostPage();
    const runtime = runtimeFor(sink.layer);

    const installation = await Effect.runPromise(
      Resume.installClient({
        root: asDocument(doc),
        manifest: pageManifest(pageCode, "page"),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [pageCode.id]: pageCode, [fragmentCode.id]: fragmentCode },
        runtime,
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    const action = await portableAction(sink, fragmentCode, "fragment");
    const collected = await Effect.runPromise(
      Resume.collect(
        () => dom.renderToString(() => resumeButton(dom, Resume, action, "Fragment")),
        { buildId: StreamBuildId },
      ).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );
    // The fragment independently numbered its event `e0` — exactly the same id
    // the page already uses. This is the collision the namespacing prevents,
    // and per DQ-015 the manifest keys stay verbatim: only the DOM marker is
    // scope-qualified, so the server's output stays position-independent.
    expect(Object.keys(collected.manifest.events)).toEqual(["e0"]);

    await Effect.runPromise(
      mountFragment(installation, "slot", {
        html: collected.html,
        manifest: collected.manifest,
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    const targets = doc.querySelectorAll("[data-af-event-click]");
    expect(targets).toHaveLength(2);
    for (const target of targets) doc.dispatch("click", target);

    // Both codes ran, once each. A flat id table would have resolved one id
    // twice and dropped or duplicated the other.
    await vi.waitFor(() => {
      expect([...sink.calls].sort()).toEqual(["fragment", "page"]);
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M11b] leaves a fragment from another build inert, with a diagnostic", async () => {
    const { Portable, Resume, Serialization, dom } = await resumeKit();
    const mountFragment = Resume.mountFragment;
    if (mountFragment === undefined) {
      unbuilt("Resume.mountFragment (id namespacing)", "DQ-015");
    }

    const sink = await makeSink();
    const pageCode = await recordingCode(Portable, sink, "future.fragment.stale.page");
    const staleCode = await recordingCode(
      Portable,
      sink,
      "future.fragment.stale.body",
      "other-build",
    );
    const doc = hostPage();
    const runtime = runtimeFor(sink.layer);
    const diagnostics: any[] = [];

    const installation = await Effect.runPromise(
      Resume.installClient({
        root: asDocument(doc),
        manifest: pageManifest(pageCode, "page"),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [pageCode.id]: pageCode, [staleCode.id]: staleCode },
        runtime,
        onDiagnostic: (diagnostic: any) => diagnostics.push(diagnostic),
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    const action = await portableAction(sink, staleCode, "stale");
    const collected = await Effect.runPromise(
      Resume.collect(
        () => dom.renderToString(() => resumeButton(dom, Resume, action, "Stale")),
        { buildId: "other-build" },
      ).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    const failure = await Effect.runPromise(
      Effect.flip(
        mountFragment(installation, "slot", {
          html: collected.html,
          manifest: collected.manifest,
        }),
      ).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    expect(String(failure._tag)).toMatch(/BuildMismatch/);
    // Inert, not absent: the HTML is still shown, it simply never resumes.
    expect(doc.text()).toContain("Stale");
    const stale = doc
      .querySelectorAll("[data-af-event-click]")
      .find((element) => element.getAttribute("id") === null);
    if (stale !== undefined) doc.dispatch("click", stale);
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(sink.calls).toEqual([]);
    // And the host page is untouched by the rejected fragment.
    doc.dispatch("click", doc.querySelectorAll("[data-af-event-click]")[0]!);
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["page"]);
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M11b] disposes a fragment exactly once when its region is replaced or removed", async () => {
    const { Portable, Resume, Serialization, dom } = await resumeKit();
    const mountFragment = Resume.mountFragment;
    if (mountFragment === undefined) {
      unbuilt("Resume.mountFragment (handle shape)", "DQ-013");
    }

    const sink = await makeSink();
    const pageCode = await recordingCode(Portable, sink, "future.fragment.life.page");
    const fragmentCode = await recordingCode(Portable, sink, "future.fragment.life.body");
    const doc = hostPage();
    const runtime = runtimeFor(sink.layer);

    const installation = await Effect.runPromise(
      Resume.installClient({
        root: asDocument(doc),
        manifest: pageManifest(pageCode, "page"),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [pageCode.id]: pageCode, [fragmentCode.id]: fragmentCode },
        runtime,
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    const mount = async (label: string) => {
      const action = await portableAction(sink, fragmentCode, label);
      const collected = await Effect.runPromise(
        Resume.collect(
          () => dom.renderToString(() => resumeButton(dom, Resume, action, label)),
          { buildId: StreamBuildId },
        ).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
          any,
          never,
          never
        >,
      );
      return Effect.runPromise(
        mountFragment(installation, "slot", {
          html: collected.html,
          manifest: collected.manifest,
        }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
          any,
          never,
          never
        >,
      );
    };

    const first = await mount("first");
    const beforeReplace = installation.inspect();

    // Replacing the region's content: the first fragment must be disposed once.
    const second = await mount("second");
    expect(first.disposed?.()).toBe(true);
    expect(second.disposed?.()).toBe(false);
    // Ownership did not accumulate — a leaked first fragment would show here.
    expect(installation.inspect().boundarySubscribers).toBe(
      beforeReplace.boundarySubscribers,
    );

    // Disposing an already-disposed fragment is a no-op, not a second teardown.
    await Effect.runPromise(first.dispose);
    await Effect.runPromise(first.dispose);
    expect(installation.inspect().disposed).toBe(false);

    // Removing the region tears the live fragment down exactly once, and the
    // parent installation survives it.
    removeRegion(doc, "slot");
    await Effect.runPromise(second.dispose);
    expect(second.disposed?.()).toBe(true);
    expect(installation.inspect().disposed).toBe(false);
    doc.dispatch("click", doc.querySelectorAll("[data-af-event-click]")[0]!);
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["page"]);
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M11b] pairs replacement UI with revalidated loader data in one round trip", async () => {
    // RATIFIED DQ-014 (2026-08-12, TRIAGE-2026-08-12.md item 5):
    // `ServerRoute.fragment(...)` is the server half (schema'd args in,
    // {html, manifest} + single-flight loaders out, riding the EXISTING
    // SingleFlightPayload), and `ServerRoute.invokeFragment` is the client
    // caller pairing it with `Resume.mountFragment`. The property: ONE call
    // returns both the fragment and the revalidated loader snapshots, and
    // hydrating those snapshots is a cache fill — never a second loader run.
    const { Portable, Resume, Serialization, dom } = await resumeKit();
    const ServerRoute = await srcModule("ServerRoute");
    const RouteMod = await srcModule("Route");
    const Component = await srcModule("Component");
    const routerRuntime = await srcModule("router-runtime");
    const { Schema } = await import("effect");
    if (ServerRoute.fragment === undefined || ServerRoute.invokeFragment === undefined) {
      unbuilt("ServerRoute.fragment / ServerRoute.invokeFragment", "DQ-014");
    }

    const sink = await makeSink();
    const fragmentCode = await recordingCode(Portable, sink, "future.fragment.sf.body");
    const runtime = runtimeFor(sink.layer);

    // A route whose loader counts its runs: the revalidation must run it
    // exactly once, server-side, and hydration must not run it again.
    let loads = 0;
    const App = RouteMod.loader((_: {}) =>
      Effect.sync(() => {
        loads += 1;
        return { fresh: loads };
      })
    )(RouteMod.id("sf.page")(RouteMod.path("/")(Component.from(() => null))));

    // The server half, invoked in-process through the fetch stub.
    const handler = ServerRoute.fragment({
      args: Schema.Tuple([Schema.String]),
      buildId: StreamBuildId,
      render: (label: string) => resumeButton(dom, Resume, Effect.runSync(
        Component.action(Portable.bind(fragmentCode, { label })).pipe(
          Effect.provideService(sink.service, {
            record: () => Effect.die("server must not run a resumable action"),
          }),
        ),
      ), label),
      app: App,
    });

    // The live page the fragment mounts into.
    const doc = fakeDocument([
      { kind: "region", id: "slot", edge: "start" },
      { kind: "region", id: "slot", edge: "end" },
    ]);
    const installation = await Effect.runPromise(
      Resume.installClient({
        root: asDocument(doc),
        manifest: { version: 1, buildId: StreamBuildId, installationId: "page0", events: {} },
        expectedBuildId: StreamBuildId,
        resolverEntries: { [fragmentCode.id]: fragmentCode },
        runtime,
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<any, never, never>,
    );

    const result = await Effect.runPromise(
      ServerRoute.invokeFragment(
        "/__fragment",
        { args: ["replaced"], url: "http://test.local/" },
        {
          installation,
          region: "slot",
          app: App,
          fetch: async (_input: string, init?: { readonly body?: string }) => {
            const request = JSON.parse(init?.body ?? "{}");
            const response = await Effect.runPromise(
              handler(request).pipe(
                Effect.provide(Serialization.layer),
              ) as Effect.Effect<unknown, never, never>,
            );
            return { json: async () => response };
          },
        },
      ).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<any, never, never>,
    );

    // One payload carried BOTH halves: the loaders array holds the
    // revalidated snapshot for the matched route…
    expect(result.loaders.map((entry: any) => entry.routeId)).toContain("sf.page");
    const snapshot = result.loaders.find((entry: any) => entry.routeId === "sf.page");
    expect(snapshot.result).toMatchObject({ _tag: "Success", value: { fresh: 1 } });
    // …and the loader ran exactly once, server-side. Hydration was a cache
    // fill, not a refetch.
    expect(loads).toBe(1);
    expect(
      routerRuntime.getLoaderCacheEntry("sf.page", {}),
    ).toBeDefined();
    expect(loads).toBe(1);

    // The mounted fragment is live: its button resumes on first touch.
    const mounted = doc.querySelectorAll("[data-af-event-click]");
    expect(mounted).toHaveLength(1);
    doc.dispatch("click", mounted[0]!);
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["replaced"]);
    });

    await Effect.runPromise(result.fragment.dispose as Effect.Effect<void, never, never>);
    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });
});
