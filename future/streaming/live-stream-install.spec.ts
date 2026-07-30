/**
 * M11 item 6 — client install over a live stream.
 *
 * `installClient` must tolerate installing before the stream completes:
 * dormant interactions on already-flushed regions work immediately, and
 * interactions targeting an unflushed region queue against the same exact-once
 * claim machinery the handoff already ratified.
 *
 * Modelled as two entry points, matching the two arrival shapes:
 *   - `Resume.installClientStreamed({ records })` — a settled list of records,
 *     which must include the terminal completeness record (see M11.5);
 *   - `Resume.installClientStreaming({...})` — a live handle with
 *     `ingest(record)` per flushed region and `endOfStream()` at the end.
 *
 * Marker spelling is ratified (DQ-009,
 * `RESUMABILITY_IMPLEMENTATION_PLAN.md` §Ratified DQ-005–DQ-012): every marker
 * is `"<installationId>:<eventId>"` with `:` reserved, and **the page installation
 * gets an explicit scope id too** — a special-cased unqualified page marker is
 * exactly how a fragment id eventually collides with it.
 */

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { unbuilt } from "../harness.js";
import {
  StreamBuildId,
  makeSink,
  recordingCode,
  resumeKit,
  runtimeFor,
} from "./support.js";
import { appendMarkup, asDocument, elementWith, fakeDocument } from "./fake-dom.js";

/** One region's manifest record, describing a single portable click event. */
function regionRecord(regionId: string, code: any, label: string): unknown {
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

/**
 * Ratified DQ-007: the terminal record names the **region ids** it expects, so
 * completeness is set equality rather than arithmetic.
 */
function terminalRecord(...regionIds: ReadonlyArray<string>): unknown {
  return { version: 5, buildId: StreamBuildId, complete: true, regionIds };
}

describe("client install over a live stream (M11.6)", () => {
  it("[M11.6] runs a dormant interaction on a flushed region before the stream ends, exactly once", async () => {
    const { Portable, Resume, Serialization } = await resumeKit();
    const installStreaming = Resume.installClientStreaming;
    if (installStreaming === undefined) {
      unbuilt("Resume.installClientStreaming (live-stream install)", "M11 item 6");
    }

    const sink = await makeSink();
    const code = await recordingCode(Portable, sink, "future.stream.live.first");
    const doc = fakeDocument([
      { kind: "region", id: "r0", edge: "start" },
      {
        kind: "element",
        tag: "button",
        attributes: { "data-af-event-click": "r0:e0" },
      },
      { kind: "region", id: "r0", edge: "end" },
    ]);
    const runtime = runtimeFor(sink.layer);

    const installation = await Effect.runPromise(
      installStreaming({
        root: asDocument(doc),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [code.id]: code },
        runtime,
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    await Effect.runPromise(
      installation.ingest(regionRecord("r0", code, "live")) as Effect.Effect<
        void,
        never,
        never
      >,
    );

    doc.dispatch("click", elementWith(doc, "data-af-event-click"));
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["live"]);
    });

    // The completeness record arriving later must not replay anything.
    await Effect.runPromise(
      installation.ingest(terminalRecord("r0")) as Effect.Effect<void, never, never>,
    );
    await Effect.runPromise(
      installation.endOfStream() as Effect.Effect<void, never, never>,
    );
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

  it("[M11.6] queues an interaction that lands before its region's record", async () => {
    const { Portable, Resume, Serialization } = await resumeKit();
    const installStreaming = Resume.installClientStreaming;
    if (installStreaming === undefined) {
      unbuilt("Resume.installClientStreaming (live-stream install)", "M11 item 6");
    }

    const sink = await makeSink();
    const code = await recordingCode(Portable, sink, "future.stream.live.queued");
    // The region's HTML has been flushed but its manifest record has not
    // arrived yet — the window this item exists to close.
    const doc = fakeDocument([
      { kind: "region", id: "r0", edge: "start" },
      {
        kind: "element",
        tag: "button",
        attributes: { "data-af-event-click": "r0:e0" },
      },
      { kind: "region", id: "r0", edge: "end" },
    ]);
    const runtime = runtimeFor(sink.layer);
    const diagnostics: any[] = [];

    const installation = await Effect.runPromise(
      installStreaming({
        root: asDocument(doc),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [code.id]: code },
        runtime,
        onDiagnostic: (diagnostic: any) => diagnostics.push(diagnostic),
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    doc.dispatch("click", elementWith(doc, "data-af-event-click"));
    // Nothing ran, and — crucially — nothing was *dropped* with a diagnostic:
    // an unresolved region is a wait, not a failure.
    expect(sink.calls).toEqual([]);
    expect(diagnostics).toEqual([]);

    await Effect.runPromise(
      installation.ingest(regionRecord("r0", code, "queued")) as Effect.Effect<
        void,
        never,
        never
      >,
    );

    // The queued interaction replays exactly once when its region registers.
    await vi.waitFor(() => {
      expect(sink.calls).toEqual(["queued"]);
    });
    await Effect.runPromise(
      installation.ingest(terminalRecord("r0")) as Effect.Effect<void, never, never>,
    );
    expect(sink.calls).toEqual(["queued"]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M11.6] keeps two regions' identically-numbered events apart", async () => {
    const { Portable, Resume, Serialization } = await resumeKit();
    const installStreaming = Resume.installClientStreaming;
    if (installStreaming === undefined) {
      unbuilt("Resume.installClientStreaming (live-stream install)", "M11 item 6");
    }

    const sink = await makeSink();
    const first = await recordingCode(Portable, sink, "future.stream.live.a");
    const second = await recordingCode(Portable, sink, "future.stream.live.b");
    const doc = fakeDocument([
      { kind: "region", id: "r0", edge: "start" },
      {
        kind: "element",
        tag: "button",
        attributes: { "data-af-event-click": "r0:e0", id: "a" },
      },
      { kind: "region", id: "r0", edge: "end" },
    ]);
    const runtime = runtimeFor(sink.layer);

    const installation = await Effect.runPromise(
      installStreaming({
        root: asDocument(doc),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [first.id]: first, [second.id]: second },
        runtime,
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );
    await Effect.runPromise(
      installation.ingest(regionRecord("r0", first, "from-r0")) as Effect.Effect<
        void,
        never,
        never
      >,
    );

    // A second region flushes later, numbering its own event `e0` too.
    appendMarkup(doc, [
      { kind: "region", id: "r1", edge: "start" },
      {
        kind: "element",
        tag: "button",
        attributes: { "data-af-event-click": "r1:e0", id: "b" },
      },
      { kind: "region", id: "r1", edge: "end" },
    ]);
    await Effect.runPromise(
      installation.ingest(regionRecord("r1", second, "from-r1")) as Effect.Effect<
        void,
        never,
        never
      >,
    );
    await Effect.runPromise(
      installation.ingest(terminalRecord("r0", "r1")) as Effect.Effect<void, never, never>,
    );

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

  it("[M11.6] falls back closed when the stream ends without its completeness record", async () => {
    const { Portable, Resume, Serialization } = await resumeKit();
    const installStreaming = Resume.installClientStreaming;
    if (installStreaming === undefined) {
      unbuilt("Resume.installClientStreaming (live-stream install)", "M11 item 6");
    }

    const sink = await makeSink();
    const code = await recordingCode(Portable, sink, "future.stream.live.truncated");
    const doc = fakeDocument([
      { kind: "region", id: "r0", edge: "start" },
      {
        kind: "element",
        tag: "button",
        attributes: { "data-af-event-click": "r0:e0" },
      },
      { kind: "region", id: "r0", edge: "end" },
    ]);
    const runtime = runtimeFor(sink.layer);
    const diagnostics: any[] = [];

    const installation = await Effect.runPromise(
      installStreaming({
        root: asDocument(doc),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [code.id]: code },
        runtime,
        onDiagnostic: (diagnostic: any) => diagnostics.push(diagnostic),
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );
    await Effect.runPromise(
      installation.ingest(regionRecord("r0", code, "before-truncation")) as
        Effect.Effect<void, never, never>,
    );

    // The transport dies without a terminal record.
    const failure = await Effect.runPromise(
      Effect.flip(installation.endOfStream()) as Effect.Effect<any, never, never>,
    );
    expect(String(failure._tag)).toMatch(/Truncated|Incomplete/);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "stream-truncated",
    ]);
    // Distinct from a build mismatch, the other way an install fails closed.
    expect(String(failure._tag)).not.toMatch(/BuildMismatch/);

    // Fail-closed means the page reverts to needing hydration, not that already
    // resumed regions keep half-working: no further interaction is claimed.
    doc.dispatch("click", elementWith(doc, "data-af-event-click"));
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(sink.calls).toEqual([]);
    expect(installation.inspect().eventListeners).toBe(0);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();

    // NEGATIVE CONTROL, on a *fresh* fixture — the truncated installation above
    // is now torn down, and reusing it would be reading post-disposal state.
    // The same stream that does deliver its completeness record ends without a
    // failure, without a diagnostic, and with its handlers still live. Without
    // this half, an `endOfStream` that always failed closed would satisfy every
    // assertion above forever.
    const cleanSink = await makeSink();
    const cleanCode = await recordingCode(
      Portable,
      cleanSink,
      "future.stream.live.complete",
    );
    const cleanDoc = fakeDocument([
      { kind: "region", id: "r0", edge: "start" },
      {
        kind: "element",
        tag: "button",
        attributes: { "data-af-event-click": "r0:e0" },
      },
      { kind: "region", id: "r0", edge: "end" },
    ]);
    const cleanRuntime = runtimeFor(cleanSink.layer);
    const cleanDiagnostics: any[] = [];
    const cleanInstallation = await Effect.runPromise(
      installStreaming({
        root: asDocument(cleanDoc),
        expectedBuildId: StreamBuildId,
        resolverEntries: { [cleanCode.id]: cleanCode },
        runtime: cleanRuntime,
        onDiagnostic: (diagnostic: any) => cleanDiagnostics.push(diagnostic),
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );
    await Effect.runPromise(
      cleanInstallation.ingest(
        regionRecord("r0", cleanCode, "complete"),
      ) as Effect.Effect<void, never, never>,
    );
    await Effect.runPromise(
      cleanInstallation.ingest(terminalRecord("r0")) as Effect.Effect<
        void,
        never,
        never
      >,
    );
    await Effect.runPromise(
      cleanInstallation.endOfStream() as Effect.Effect<void, never, never>,
    );
    expect(cleanDiagnostics).toEqual([]);
    expect(cleanInstallation.inspect().eventListeners).toBeGreaterThan(0);
    cleanDoc.dispatch("click", elementWith(cleanDoc, "data-af-event-click"));
    await vi.waitFor(() => {
      expect(cleanSink.calls).toEqual(["complete"]);
    });

    await Effect.runPromise(cleanInstallation.dispose);
    await cleanRuntime.dispose();
  });
  it("[M11.6] routes all three ingestion doors through one record primitive", async () => {
    // Ratified DQ-008 (`RESUMABILITY_IMPLEMENTATION_PLAN.md` §Ratified
    // DQ-005–DQ-012): `installClientStreamed`, `installClientStreaming.ingest`
    // and `Resume.mountFragment` all call the same internal `ingestRecord`.
    // That is what makes the plan's claim "a fetched fragment and a streamed
    // flush are one operation" true **in code rather than in prose** — so the
    // spec is: one identical record, three doors, one identical outcome.
    const { Portable, Resume, Serialization } = await resumeKit();
    const installStreamed = Resume.installClientStreamed;
    const installStreaming = Resume.installClientStreaming;
    const mountFragment = Resume.mountFragment;
    if (
      installStreamed === undefined
      || installStreaming === undefined
      || mountFragment === undefined
    ) {
      unbuilt(
        "the three ingestion doors over one internal ingestRecord "
          + "(installClientStreamed / installClientStreaming.ingest / mountFragment)",
        "M11 items 5-6 + M11b item 1",
      );
    }

    const markup = (scope: string) => [
      { kind: "region", id: scope, edge: "start" } as const,
      {
        kind: "element",
        tag: "button",
        attributes: { "data-af-event-click": `${scope}:e0` },
      } as const,
      { kind: "region", id: scope, edge: "end" } as const,
    ];

    /** Dispatch the region's only button and report what ran. */
    const outcomes: Record<string, string[]> = {};

    // Door 1 — a settled record list.
    {
      const sink = await makeSink();
      const code = await recordingCode(Portable, sink, "future.stream.doors.a");
      const doc = fakeDocument(markup("r0"));
      const runtime = runtimeFor(sink.layer);
      const installation = await Effect.runPromise(
        installStreamed({
          root: asDocument(doc),
          records: [regionRecord("r0", code, "door"), terminalRecord("r0")],
          expectedBuildId: StreamBuildId,
          resolverEntries: { [code.id]: code },
          runtime,
        }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<any, never, never>,
      );
      doc.dispatch("click", elementWith(doc, "data-af-event-click"));
      await vi.waitFor(() => expect(sink.calls).toHaveLength(1));
      outcomes.streamed = [...sink.calls];
      await Effect.runPromise(installation.dispose);
      await runtime.dispose();
    }

    // Door 2 — the live handle's `ingest`.
    {
      const sink = await makeSink();
      const code = await recordingCode(Portable, sink, "future.stream.doors.b");
      const doc = fakeDocument(markup("r0"));
      const runtime = runtimeFor(sink.layer);
      const installation = await Effect.runPromise(
        installStreaming({
          root: asDocument(doc),
          expectedBuildId: StreamBuildId,
          resolverEntries: { [code.id]: code },
          runtime,
        }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<any, never, never>,
      );
      await Effect.runPromise(
        installation.ingest(regionRecord("r0", code, "door")) as Effect.Effect<
          void,
          never,
          never
        >,
      );
      doc.dispatch("click", elementWith(doc, "data-af-event-click"));
      await vi.waitFor(() => expect(sink.calls).toHaveLength(1));
      outcomes.ingested = [...sink.calls];
      await Effect.runPromise(installation.dispose);
      await runtime.dispose();
    }

    // Door 3 — a fragment fetched out of band and mounted into a live page.
    {
      const sink = await makeSink();
      const code = await recordingCode(Portable, sink, "future.stream.doors.c");
      const doc = fakeDocument([]);
      const runtime = runtimeFor(sink.layer);
      const installation = await Effect.runPromise(
        installStreaming({
          root: asDocument(doc),
          expectedBuildId: StreamBuildId,
          resolverEntries: { [code.id]: code },
          runtime,
        }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<any, never, never>,
      );
      appendMarkup(doc, markup("f0"));
      await Effect.runPromise(
        mountFragment(installation, "f0", {
          manifest: regionRecord("f0", code, "door"),
        }) as Effect.Effect<any, never, never>,
      );
      doc.dispatch("click", elementWith(doc, "data-af-event-click"));
      await vi.waitFor(() => expect(sink.calls).toHaveLength(1));
      outcomes.mounted = [...sink.calls];
      await Effect.runPromise(installation.dispose);
      await runtime.dispose();
    }

    // The same record produced the same behaviour through every door. Diverging
    // here is exactly the drift a second ingestion implementation causes.
    expect(outcomes.streamed).toEqual(["door"]);
    expect(outcomes.ingested).toEqual(outcomes.streamed);
    expect(outcomes.mounted).toEqual(outcomes.streamed);

    // NEGATIVE CONTROL, on the shared primitive's validation rather than its
    // happy path: a record whose build id disagrees must be refused at ALL
    // three doors. A door that skipped the shared primitive would accept it.
    const rejections: string[] = [];
    for (const door of ["streamed", "ingested", "mounted"] as const) {
      const sink = await makeSink();
      const code = await recordingCode(
        Portable,
        sink,
        `future.stream.doors.bad.${door}`,
      );
      const stale = {
        ...(regionRecord("r0", code, "door") as Record<string, unknown>),
        buildId: "other-build",
      };
      const doc = fakeDocument(markup("r0"));
      const runtime = runtimeFor(sink.layer);
      if (door === "streamed") {
        const failure = await Effect.runPromise(
          installStreamed({
            root: asDocument(doc),
            records: [stale, terminalRecord("r0")],
            expectedBuildId: StreamBuildId,
            resolverEntries: { [code.id]: code },
            runtime,
          }).pipe(
            Effect.flip,
            Effect.provide(Serialization.layer),
          ) as Effect.Effect<any, never, never>,
        );
        rejections.push(String(failure._tag));
      } else {
        const installation = await Effect.runPromise(
          installStreaming({
            root: asDocument(doc),
            expectedBuildId: StreamBuildId,
            resolverEntries: { [code.id]: code },
            runtime,
          }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<any, never, never>,
        );
        const failure = await Effect.runPromise(
          Effect.flip(
            door === "ingested"
              ? installation.ingest(stale)
              : mountFragment(installation, "r0", { manifest: stale }),
          ) as Effect.Effect<any, never, never>,
        );
        rejections.push(String(failure._tag));
        await Effect.runPromise(installation.dispose);
      }
      expect(sink.calls).toEqual([]);
      await runtime.dispose();
    }
    // One shared primitive means one shared failure tag.
    expect(new Set(rejections).size).toBe(1);
    expect(rejections[0]).toMatch(/BuildMismatch/);
  });
});
