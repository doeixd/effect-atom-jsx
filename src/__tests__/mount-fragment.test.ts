/**
 * M11b items 1-3 — `Resume.mountFragment` (static door): a server-collected
 * `{html, manifest}` fragment mounted into a live `installClient` page.
 * Typed unit coverage for the four green specs in
 * `future/streaming/server-fragments.spec.ts`; that file stays in `future/`
 * because its fifth spec (`Resume.fragmentAction`, DQ-014) is deferred.
 *
 * What has to hold: the fragment resumes on first touch through the PAGE
 * installation's existing listeners (a mount adds zero root listeners);
 * fragment-local ids are re-qualified to a client-assigned scope (`DQ-015`:
 * manifest keys verbatim, only DOM markers rewritten) so they cannot collide
 * with the page's; a fragment from another build stays visible but inert with
 * a `"fragment-build-mismatch"` diagnostic; replacing or removing the region
 * disposes the fragment exactly once and never touches the parent.
 */
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";
import { addEventListener, renderToString, template } from "../dom.js";
import { asDocument, fakeDocument, removeRegion } from "./streaming-fake-dom.js";

const TestBuildId = "mount-fragment-test-build";

interface RecorderService {
  readonly record: (label: string) => Effect.Effect<void>;
}

const Recorder = Context.Service<RecorderService>(
  "effect-atom-jsx/test/MountFragmentRecorder",
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

describe("Resume.mountFragment (M11b)", () => {
  it("mounts a server-rendered fragment that resumes on first touch", async () => {
    const sink = makeSink();
    const pageCode = recordingCode("test.fragment.page");
    const fragmentCode = recordingCode("test.fragment.body");
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

    // The page's own resumability is unaffected, and the mount added zero
    // root listeners — fragment events ride the page's dispatch.
    doc.dispatch("click", doc.querySelectorAll("[data-af-event-click]")[0]!);
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["fragment", "page"]);
    });
    expect(installation.inspect().disposed).toBe(false);
    expect(installation.inspect().eventListeners).toBe(before.eventListeners);

    await Effect.runPromise(fragment.dispose);
    // A disposed fragment claims nothing further.
    doc.dispatch("click", mounted!);
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(sink.calls).toEqual(["fragment", "page"]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("namespaces fragment ids so they cannot collide with the page's", async () => {
    const sink = makeSink();
    const pageCode = recordingCode("test.fragment.ns.page");
    const fragmentCode = recordingCode("test.fragment.ns.body");
    const doc = hostPage();
    const runtime = ManagedRuntime.make(sink.layer);
    const installation = await installPage({
      doc,
      codes: [pageCode, fragmentCode],
      pageCode,
      runtime,
    });

    const collected = collectFragment(fragmentCode, "fragment");
    // The fragment independently numbered its event `e0` — the same id the
    // page already uses. Per DQ-015 the manifest keys stay verbatim; only the
    // DOM marker is scope-qualified.
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

    // Both codes ran, once each: a flat id table would have resolved one id
    // twice and dropped or duplicated the other.
    await vi.waitFor(() => {
      expect([...sink.calls].sort()).toEqual(["fragment", "page"]);
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("leaves a fragment from another build inert, with a diagnostic", async () => {
    const sink = makeSink();
    const pageCode = recordingCode("test.fragment.stale.page");
    const staleCode = recordingCode("test.fragment.stale.body", "other-build");
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

    expect(failure._tag).toBe("ResumeClientBuildMismatchError");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "fragment-build-mismatch",
    ]);
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
    const pageCode = recordingCode("test.fragment.life.page");
    const fragmentCode = recordingCode("test.fragment.life.body");
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

    // Replacing the region's content disposes the first fragment exactly once.
    const second = await mount("second");
    expect(first.disposed()).toBe(true);
    expect(second.disposed()).toBe(false);
    expect(second.inspect().region).toBe("slot");
    // Ownership did not accumulate on the parent installation.
    expect(installation.inspect().boundarySubscribers).toBe(
      beforeReplace.boundarySubscribers,
    );

    // Disposing an already-disposed fragment is a no-op, not a re-teardown.
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
});
