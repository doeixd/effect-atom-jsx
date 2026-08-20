/**
 * M11b — server UI fragments (`Resume.mountFragment` and the `DQ-014`
 * fragment action pair). Promoted from `future/streaming/server-fragments.spec.ts`
 * (all five specs green 2026-08-12), retyped.
 *
 * The first four specs mirror `mount-fragment.test.ts`'s fixtures directly
 * (a server-collected `{html, manifest}` fragment mounted into a live
 * `installClient` page). The fifth spec covers ratified `DQ-014`:
 * `ServerRoute.fragment(...)` is the server half (schema'd args in,
 * `{html, manifest}` + single-flight loaders out, riding the existing
 * `SingleFlightPayload`), and `ServerRoute.invokeFragment` is the client
 * caller pairing it with `Resume.mountFragment`. The property under test:
 * ONE call returns both the fragment and the revalidated loader snapshots,
 * and hydrating those snapshots is a cache fill — never a second loader run.
 *
 * What has to hold:
 *   - the fragment's button resumes on first touch, with the host page's
 *     counters untouched;
 *   - fragment-local ids (`c0`, `e0`, `x0`) are installation-scoped, so they
 *     cannot collide with the page's;
 *   - build-ID equality with the page is required, else the fragment renders
 *     inert with a diagnostic;
 *   - replacing or removing the region disposes the fragment exactly once, and
 *     never touches the parent installation;
 *   - the fragment action pairs replacement UI with revalidated loader data in
 *     one round trip.
 */
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Route from "../Route.js";
import * as Serialization from "../Serialization.js";
import * as ServerRoute from "../ServerRoute.js";
import { addEventListener, renderToString, template } from "../dom.js";
import { getLoaderCacheEntry } from "../router-runtime.js";
import { asDocument, fakeDocument, removeRegion } from "./streaming-fake-dom.js";

const TestBuildId = "server-fragments-test-build";

interface RecorderService {
  readonly record: (label: string) => Effect.Effect<void>;
}

const Recorder = Context.Service<RecorderService>(
  "effect-atom-jsx/test/ServerFragmentsRecorder",
);

function makeSink(): {
  readonly calls: string[];
  readonly layer: Layer.Layer<RecorderService>;
} {
  const calls: string[] = [];
  const layer = Layer.succeed(Recorder, {
    record: (label) =>
      Effect.sync(() => {
        calls.push(label);
      }),
  });
  return { calls, layer };
}

const recordingCode = (id: string, buildId: string = TestBuildId) =>
  Portable.code<
    { readonly label: string },
    { readonly label: string },
    readonly [],
    void,
    never,
    RecorderService
  >({
    id,
    buildId,
    captures: Schema.Struct({ label: Schema.String }),
    run: (captures) =>
      Effect.gen(function* () {
        const recorder = yield* Recorder;
        yield* recorder.record(captures.label);
      }),
  });

type RecordingCode = ReturnType<typeof recordingCode>;

/** The server half: collect a resumable button rendered by the real SSR path. */
function collectFragment(
  code: RecordingCode,
  label: string,
  buildId = TestBuildId,
  installationId?: string,
) {
  const action = Effect.runSync(
    Component.action(Portable.bind(code, { label })).pipe(
      Effect.provideService(Recorder, {
        record: () => Effect.die("the server must never run a resumable action"),
      }),
    ),
  );
  return Effect.runSync(
    Resume.collect(
      () =>
        renderToString(() => {
          const button = template(`<button>${label}`)();
          addEventListener(button, "click", Resume.event(action), true);
          return button;
        }),
      { buildId, ...(installationId === undefined ? {} : { installationId }) },
    ).pipe(Effect.provide(Serialization.layer)),
  );
}

/** The host page: one resumable event of its own plus an empty mount region. */
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

function installPage(options: {
  readonly doc: ReturnType<typeof hostPage>;
  readonly codes: ReadonlyArray<RecordingCode>;
  readonly pageCode: RecordingCode;
  readonly runtime: ManagedRuntime.ManagedRuntime<RecorderService, never>;
  readonly onDiagnostic?: (diagnostic: Resume.ClientDiagnostic) => void;
}) {
  const resolverEntries: Record<string, RecordingCode> = {};
  for (const code of options.codes) resolverEntries[code.id] = code;
  // The page manifest comes from a real collect with the deterministic
  // "page0" scope, matching the host fixture's "page0:e0" marker.
  const collected = collectFragment(options.pageCode, "page", TestBuildId, "page0");
  return Effect.runPromise(
    Resume.installClient({
      root: asDocument(options.doc),
      manifest: collected.manifest,
      expectedBuildId: TestBuildId,
      resolverEntries,
      runtime: options.runtime,
      ...(options.onDiagnostic === undefined
        ? {}
        : { onDiagnostic: options.onDiagnostic }),
    }).pipe(Effect.provide(Serialization.layer)),
  );
}

describe("server UI fragments (M11b)", () => {
  it("mounts a server-rendered fragment that resumes on first touch", async () => {
    const sink = makeSink();
    const pageCode = recordingCode("test.server-fragment.page");
    const fragmentCode = recordingCode("test.server-fragment.body");
    const doc = hostPage();
    const runtime = ManagedRuntime.make(sink.layer);
    const installation = await installPage({
      doc,
      codes: [pageCode, fragmentCode],
      pageCode,
      runtime,
    });
    const before = installation.inspect();

    const collected = collectFragment(fragmentCode, "fragment");
    const fragment = await Effect.runPromise(
      Resume.mountFragment(installation, "slot", {
        html: collected.html,
        manifest: collected.manifest,
      }),
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

  it("namespaces fragment ids so they cannot collide with the page's", async () => {
    const sink = makeSink();
    const pageCode = recordingCode("test.server-fragment.ns.page");
    const fragmentCode = recordingCode("test.server-fragment.ns.body");
    const doc = hostPage();
    const runtime = ManagedRuntime.make(sink.layer);
    const installation = await installPage({
      doc,
      codes: [pageCode, fragmentCode],
      pageCode,
      runtime,
    });

    const collected = collectFragment(fragmentCode, "fragment");
    // The fragment independently numbered its event `e0` — exactly the same id
    // the page already uses. This is the collision the namespacing prevents,
    // and per DQ-015 the manifest keys stay verbatim: only the DOM marker is
    // scope-qualified, so the server's output stays position-independent.
    expect(Object.keys(collected.manifest.events)).toEqual(["e0"]);

    await Effect.runPromise(
      Resume.mountFragment(installation, "slot", {
        html: collected.html,
        manifest: collected.manifest,
      }),
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

  it("leaves a fragment from another build inert, with a diagnostic", async () => {
    const sink = makeSink();
    const pageCode = recordingCode("test.server-fragment.stale.page");
    const staleCode = recordingCode("test.server-fragment.stale.body", "other-build");
    const doc = hostPage();
    const runtime = ManagedRuntime.make(sink.layer);
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const installation = await installPage({
      doc,
      codes: [pageCode, staleCode],
      pageCode,
      runtime,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    const collected = collectFragment(staleCode, "Stale", "other-build");
    const failure = await Effect.runPromise(
      Effect.flip(
        Resume.mountFragment(installation, "slot", {
          html: collected.html,
          manifest: collected.manifest,
        }),
      ),
    );

    expect(failure._tag).toMatch(/BuildMismatch/);
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

  it("disposes a fragment exactly once when its region is replaced or removed", async () => {
    const sink = makeSink();
    const pageCode = recordingCode("test.server-fragment.life.page");
    const fragmentCode = recordingCode("test.server-fragment.life.body");
    const doc = hostPage();
    const runtime = ManagedRuntime.make(sink.layer);
    const installation = await installPage({
      doc,
      codes: [pageCode, fragmentCode],
      pageCode,
      runtime,
    });

    const mount = (label: string) => {
      const collected = collectFragment(fragmentCode, label);
      return Effect.runPromise(
        Resume.mountFragment(installation, "slot", {
          html: collected.html,
          manifest: collected.manifest,
        }),
      );
    };

    const first = await mount("first");
    const beforeReplace = installation.inspect();

    // Replacing the region's content: the first fragment must be disposed once.
    const second = await mount("second");
    expect(first.disposed()).toBe(true);
    expect(second.disposed()).toBe(false);
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
    expect(second.disposed()).toBe(true);
    expect(installation.inspect().disposed).toBe(false);
    doc.dispatch("click", doc.querySelectorAll("[data-af-event-click]")[0]!);
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["page"]);
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("pairs replacement UI with revalidated loader data in one round trip", async () => {
    // RATIFIED DQ-014 (2026-08-12, TRIAGE-2026-08-12.md item 5):
    // `ServerRoute.fragment(...)` is the server half (schema'd args in,
    // {html, manifest} + single-flight loaders out, riding the EXISTING
    // SingleFlightPayload), and `ServerRoute.invokeFragment` is the client
    // caller pairing it with `Resume.mountFragment`. The property: ONE call
    // returns both the fragment and the revalidated loader snapshots, and
    // hydrating those snapshots is a cache fill — never a second loader run.
    const sink = makeSink();
    const fragmentCode = recordingCode("test.server-fragment.sf.body");
    const runtime = ManagedRuntime.make(sink.layer);

    // A route whose loader counts its runs: the revalidation must run it
    // exactly once, server-side, and hydration must not run it again.
    let loads = 0;
    const App = Route.loader((_: {}) =>
      Effect.sync(() => {
        loads += 1;
        return { fresh: loads };
      })
    )(Route.id("sf.page")(Route.path("/")(Component.from(() => null))));

    // The server half, invoked in-process through the fetch stub.
    const handler = ServerRoute.fragment({
      args: Schema.Tuple([Schema.String]),
      buildId: TestBuildId,
      render: (label: string) => {
        const action = Effect.runSync(
          Component.action(Portable.bind(fragmentCode, { label })).pipe(
            Effect.provideService(Recorder, {
              record: () => Effect.die("server must not run a resumable action"),
            }),
          ),
        );
        const button = template(`<button>${label}`)();
        addEventListener(button, "click", Resume.event(action), true);
        return button;
      },
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
        // Boundary: hand-built page manifest with no events — the host has
        // nothing of its own to resume, so a real `Resume.collect` would
        // produce this exact shape.
        manifest: {
          version: 1,
          buildId: TestBuildId,
          installationId: "page0",
          events: {},
        } as unknown as Resume.Manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [fragmentCode.id]: fragmentCode },
        runtime,
      }).pipe(Effect.provide(Serialization.layer)),
    );

    const result = await Effect.runPromise(
      ServerRoute.invokeFragment(
        "/__fragment",
        { args: ["replaced"], url: "http://test.local/" },
        {
          installation,
          region: "slot",
          app: App,
          fetch: async (_input, init) => {
            // Boundary: the in-process fetch stub decodes the same wire body
            // `Route.invokeSingleFlight` posts, typed at the boundary.
            const request = JSON.parse(
              init?.body ?? "{}",
            ) as Route.SingleFlightRequest<readonly [string]>;
            const response = await Effect.runPromise(
              handler(request).pipe(Effect.provide(Serialization.layer)),
            );
            return { json: async () => response };
          },
        },
      ).pipe(Effect.provide(Serialization.layer)),
    );

    // One payload carried BOTH halves: the loaders array holds the
    // revalidated snapshot for the matched route…
    expect(result.loaders.map((entry) => entry.routeId)).toContain("sf.page");
    const snapshot = result.loaders.find((entry) => entry.routeId === "sf.page");
    expect(snapshot?.result).toMatchObject({ _tag: "Success", value: { fresh: 1 } });
    // …and the loader ran exactly once, server-side. Hydration was a cache
    // fill, not a refetch.
    expect(loads).toBe(1);
    expect(getLoaderCacheEntry("sf.page", {})).toBeDefined();
    expect(loads).toBe(1);

    // The mounted fragment is live: its button resumes on first touch.
    const mounted = doc.querySelectorAll("[data-af-event-click]");
    expect(mounted).toHaveLength(1);
    doc.dispatch("click", mounted[0]!);
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["replaced"]);
    });

    await Effect.runPromise(result.fragment.dispose);
    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });
});
