/**
 * M11.6 — client install over a live record stream. Promoted from
 * `future/streaming/live-stream-install.spec.ts` (all green 2026-08-11),
 * retyped.
 *
 * Marker scoping follows ratified `DQ-009` with the REGION id as the scope:
 * a streamed marker is `"<regionId>:<eventId>"`, so two regions numbering
 * their events identically can never collide in a flat id table. An
 * interaction landing before its region's record is a wait, not a failure:
 * it queues silently and replays exactly once on ingest. `endOfStream` gates
 * on the `DQ-007` terminal record and on truncation fails CLOSED — one
 * `"stream-truncated"` diagnostic, every listener removed.
 *
 * Ratified `DQ-008`: `installClientStreamed`, `installClientStreaming.ingest`
 * and `Resume.mountFragment` are three doors over ONE record primitive.
 */
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import {
  appendMarkup,
  asDocument,
  elementWith,
  fakeDocument,
  type FakeMarkup,
} from "./streaming-fake-dom.js";

const StreamBuildId = "live-stream-install-test-build";

interface RecorderService {
  readonly record: (label: string) => Effect.Effect<void>;
}

const Recorder = Context.Service<RecorderService>(
  "effect-atom-jsx/test/LiveStreamRecorder",
);

/** A sink whose layer records every label a dispatched code runs with. */
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

/** A portable code whose run records its captured `label` through the sink. */
const recordingCode = (id: string) =>
  Portable.code<
    { readonly label: string },
    { readonly label: string },
    readonly [],
    void,
    never,
    RecorderService
  >({
    id,
    buildId: StreamBuildId,
    captures: Schema.Struct({ label: Schema.String }),
    run: (captures) =>
      Effect.gen(function* () {
        const recorder = yield* Recorder;
        yield* recorder.record(captures.label);
      }),
  });

type RecordingCode = ReturnType<typeof recordingCode>;

/** One region's manifest record, describing a single portable click event. */
function regionRecord(
  regionId: string,
  code: RecordingCode,
  label: string,
): unknown {
  return {
    version: 5,
    buildId: StreamBuildId,
    region: regionId,
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

/** DQ-007: the terminal record names region IDS, so completeness is set equality. */
function terminalRecord(...regionIds: ReadonlyArray<string>): unknown {
  return { version: 5, buildId: StreamBuildId, complete: true, regionIds };
}

/** A region wrapping one button whose marker is scoped to that region. */
function regionMarkup(scope: string): FakeMarkup[] {
  return [
    { kind: "region", id: scope, edge: "start" },
    {
      kind: "element",
      tag: "button",
      attributes: { "data-af-event-click": `${scope}:e0` },
    },
    { kind: "region", id: scope, edge: "end" },
  ];
}

describe("client install over a live stream (M11.6)", () => {
  it("runs a dormant interaction on a flushed region before the stream ends, exactly once", async () => {
    const sink = makeSink();
    const code = recordingCode("test.stream.live.first");
    const doc = fakeDocument(regionMarkup("r0"));
    const runtime = ManagedRuntime.make(sink.layer);

    const installation = await Effect.runPromise(
      Resume.installClientStreaming({
        root: asDocument(doc),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [code.id]: code },
        runtime,
      }),
    );

    await Effect.runPromise(installation.ingest(regionRecord("r0", code, "live")));

    doc.dispatch("click", elementWith(doc, "data-af-event-click"));
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["live"]);
    });

    // The completeness record arriving later must not replay anything.
    await Effect.runPromise(installation.ingest(terminalRecord("r0")));
    await Effect.runPromise(installation.endOfStream());
    expect(sink.calls).toEqual(["live"]);

    // And the handler is still live afterwards: exact-once is per interaction,
    // not a one-shot fuse.
    doc.dispatch("click", elementWith(doc, "data-af-event-click"));
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["live", "live"]);
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("queues an interaction that lands before its region's record", async () => {
    const sink = makeSink();
    const code = recordingCode("test.stream.live.queued");
    // The region's HTML has been flushed but its manifest record has not
    // arrived yet — the window this milestone exists to close.
    const doc = fakeDocument(regionMarkup("r0"));
    const runtime = ManagedRuntime.make(sink.layer);
    const diagnostics: Resume.ClientDiagnostic[] = [];

    const installation = await Effect.runPromise(
      Resume.installClientStreaming({
        root: asDocument(doc),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [code.id]: code },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    doc.dispatch("click", elementWith(doc, "data-af-event-click"));
    // Nothing ran, and — crucially — nothing was *dropped* with a diagnostic:
    // an unresolved region is a wait, not a failure.
    expect(sink.calls).toEqual([]);
    expect(diagnostics).toEqual([]);
    expect(installation.inspect().queuedInteractions).toBe(1);

    await Effect.runPromise(
      installation.ingest(regionRecord("r0", code, "queued")),
    );

    // The queued interaction replays exactly once when its region registers.
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["queued"]);
    });
    expect(installation.inspect().queuedInteractions).toBe(0);
    await Effect.runPromise(installation.ingest(terminalRecord("r0")));
    expect(sink.calls).toEqual(["queued"]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("keeps two regions' identically-numbered events apart", async () => {
    const sink = makeSink();
    const first = recordingCode("test.stream.live.a");
    const second = recordingCode("test.stream.live.b");
    const doc = fakeDocument(regionMarkup("r0"));
    const runtime = ManagedRuntime.make(sink.layer);

    const installation = await Effect.runPromise(
      Resume.installClientStreaming({
        root: asDocument(doc),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [first.id]: first, [second.id]: second },
        runtime,
      }),
    );
    await Effect.runPromise(
      installation.ingest(regionRecord("r0", first, "from-r0")),
    );

    // A second region flushes later, numbering its own event `e0` too.
    appendMarkup(doc, regionMarkup("r1"));
    await Effect.runPromise(
      installation.ingest(regionRecord("r1", second, "from-r1")),
    );
    await Effect.runPromise(installation.ingest(terminalRecord("r0", "r1")));

    const buttons = doc.querySelectorAll("[data-af-event-click]");
    expect(buttons).toHaveLength(2);
    doc.dispatch("click", buttons[0]!);
    doc.dispatch("click", buttons[1]!);

    // Each region's event resolved to its own code: a flat id table would have
    // let `r1:e0` overwrite `r0:e0` and run one code twice.
    await vi.waitFor(() => {
      expect([...sink.calls].sort()).toEqual(["from-r0", "from-r1"]);
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("falls back closed when the stream ends without its completeness record", async () => {
    const sink = makeSink();
    const code = recordingCode("test.stream.live.truncated");
    const doc = fakeDocument(regionMarkup("r0"));
    const runtime = ManagedRuntime.make(sink.layer);
    const diagnostics: Resume.ClientDiagnostic[] = [];

    const installation = await Effect.runPromise(
      Resume.installClientStreaming({
        root: asDocument(doc),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [code.id]: code },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );
    await Effect.runPromise(
      installation.ingest(regionRecord("r0", code, "before-truncation")),
    );

    // The transport dies without a terminal record.
    const failure = await Effect.runPromise(
      Effect.flip(installation.endOfStream()),
    );
    // Distinct from a build mismatch, the other way an install fails closed.
    expect(failure._tag).toBe("ResumeStreamTruncatedError");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "stream-truncated",
    ]);

    // Fail-closed means the page reverts to needing hydration, not that
    // already-resumed regions keep half-working: no further interaction is
    // claimed.
    doc.dispatch("click", elementWith(doc, "data-af-event-click"));
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(sink.calls).toEqual([]);
    expect(installation.inspect().eventListeners).toBe(0);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();

    // NEGATIVE CONTROL, on a *fresh* fixture — the same stream that DOES
    // deliver its completeness record ends without a failure, without a
    // diagnostic, and with its handlers still live. Without this half, an
    // `endOfStream` that always failed closed would satisfy everything above.
    const cleanSink = makeSink();
    const cleanCode = recordingCode("test.stream.live.complete");
    const cleanDoc = fakeDocument(regionMarkup("r0"));
    const cleanRuntime = ManagedRuntime.make(cleanSink.layer);
    const cleanDiagnostics: Resume.ClientDiagnostic[] = [];
    const cleanInstallation = await Effect.runPromise(
      Resume.installClientStreaming({
        root: asDocument(cleanDoc),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [cleanCode.id]: cleanCode },
        runtime: cleanRuntime,
        onDiagnostic: (diagnostic) => cleanDiagnostics.push(diagnostic),
      }),
    );
    await Effect.runPromise(
      cleanInstallation.ingest(regionRecord("r0", cleanCode, "complete")),
    );
    await Effect.runPromise(cleanInstallation.ingest(terminalRecord("r0")));
    await Effect.runPromise(cleanInstallation.endOfStream());
    expect(cleanDiagnostics).toEqual([]);
    expect(cleanInstallation.inspect().eventListeners).toBeGreaterThan(0);
    cleanDoc.dispatch("click", elementWith(cleanDoc, "data-af-event-click"));
    await vi.waitFor(() => {
      expect(cleanSink.calls).toEqual(["complete"]);
    });

    await Effect.runPromise(cleanInstallation.dispose);
    await cleanRuntime.dispose();
  });

  it("routes all three ingestion doors through one record primitive", async () => {
    // Ratified DQ-008: one identical record, three doors, one identical
    // outcome — that is what makes "a fetched fragment and a streamed flush
    // are one operation" true in code rather than in prose.
    const outcomes: Record<string, string[]> = {};

    // Door 1 — a settled record list.
    {
      const sink = makeSink();
      const code = recordingCode("test.stream.doors.a");
      const doc = fakeDocument(regionMarkup("r0"));
      const runtime = ManagedRuntime.make(sink.layer);
      const installation = await Effect.runPromise(
        Resume.installClientStreamed({
          root: asDocument(doc),
          records: [regionRecord("r0", code, "door"), terminalRecord("r0")],
          expectedBuildId: StreamBuildId,
          resolverEntries: { [code.id]: code },
          runtime,
        }),
      );
      doc.dispatch("click", elementWith(doc, "data-af-event-click"));
      await vi.waitFor(() => expect(sink.calls).toHaveLength(1));
      outcomes["streamed"] = [...sink.calls];
      await Effect.runPromise(installation.dispose);
      await runtime.dispose();
    }

    // Door 2 — the live handle's `ingest`.
    {
      const sink = makeSink();
      const code = recordingCode("test.stream.doors.b");
      const doc = fakeDocument(regionMarkup("r0"));
      const runtime = ManagedRuntime.make(sink.layer);
      const installation = await Effect.runPromise(
        Resume.installClientStreaming({
          root: asDocument(doc),
          expectedBuildId: StreamBuildId,
          resolverEntries: { [code.id]: code },
          runtime,
        }),
      );
      await Effect.runPromise(
        installation.ingest(regionRecord("r0", code, "door")),
      );
      doc.dispatch("click", elementWith(doc, "data-af-event-click"));
      await vi.waitFor(() => expect(sink.calls).toHaveLength(1));
      outcomes["ingested"] = [...sink.calls];
      await Effect.runPromise(installation.dispose);
      await runtime.dispose();
    }

    // Door 3 — a fragment fetched out of band and mounted into a live page.
    {
      const sink = makeSink();
      const code = recordingCode("test.stream.doors.c");
      const doc = fakeDocument([]);
      const runtime = ManagedRuntime.make(sink.layer);
      const installation = await Effect.runPromise(
        Resume.installClientStreaming({
          root: asDocument(doc),
          expectedBuildId: StreamBuildId,
          resolverEntries: { [code.id]: code },
          runtime,
        }),
      );
      appendMarkup(doc, regionMarkup("f0"));
      await Effect.runPromise(
        Resume.mountFragment(installation, "f0", {
          manifest: regionRecord("f0", code, "door"),
        }),
      );
      doc.dispatch("click", elementWith(doc, "data-af-event-click"));
      await vi.waitFor(() => expect(sink.calls).toHaveLength(1));
      outcomes["mounted"] = [...sink.calls];
      await Effect.runPromise(installation.dispose);
      await runtime.dispose();
    }

    // The same record produced the same behaviour through every door.
    expect(outcomes["streamed"]).toEqual(["door"]);
    expect(outcomes["ingested"]).toEqual(outcomes["streamed"]);
    expect(outcomes["mounted"]).toEqual(outcomes["streamed"]);

    // NEGATIVE CONTROL, on the shared primitive's validation rather than its
    // happy path: a record whose build id disagrees must be refused at ALL
    // three doors. A door that skipped the shared primitive would accept it.
    const rejections: string[] = [];
    for (const door of ["streamed", "ingested", "mounted"] as const) {
      const sink = makeSink();
      const code = recordingCode(`test.stream.doors.bad.${door}`);
      const stale = {
        ...(regionRecord("r0", code, "door") as Record<string, unknown>),
        buildId: "other-build",
      };
      const doc = fakeDocument(regionMarkup("r0"));
      const runtime = ManagedRuntime.make(sink.layer);
      if (door === "streamed") {
        const failure = await Effect.runPromise(
          Effect.flip(
            Resume.installClientStreamed({
              root: asDocument(doc),
              records: [stale, terminalRecord("r0")],
              expectedBuildId: StreamBuildId,
              resolverEntries: { [code.id]: code },
              runtime,
            }),
          ),
        );
        rejections.push(failure._tag);
      } else {
        const installation = await Effect.runPromise(
          Resume.installClientStreaming({
            root: asDocument(doc),
            expectedBuildId: StreamBuildId,
            resolverEntries: { [code.id]: code },
            runtime,
          }),
        );
        const failure = await Effect.runPromise(
          Effect.flip(
            door === "ingested"
              ? installation.ingest(stale)
              : Resume.mountFragment(installation, "r0", { manifest: stale }),
          ),
        );
        rejections.push(failure._tag);
        await Effect.runPromise(installation.dispose);
      }
      expect(sink.calls).toEqual([]);
      await runtime.dispose();
    }
    // One shared primitive means one shared failure tag.
    expect(new Set(rejections).size).toBe(1);
    expect(rejections[0]).toBe("ResumeClientBuildMismatchError");
  });
});
