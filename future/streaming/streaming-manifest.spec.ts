/**
 * M11 item 5 — the incremental manifest.
 *
 * The manifest becomes one record per flushed region (same schemas, same
 * build-ID and serializer gates, byte ceiling enforced *cumulatively*), plus a
 * terminal completeness record so `installClient` can tell "stream ended" from
 * "stream truncated" and fall back closed.
 *
 * Two negative guarantees carry this milestone:
 *   - a never-flushed region registers nothing (the ghost-snapshot rule,
 *     generalized to streaming);
 *   - a truncated stream is *detectably* incomplete and fails closed on install
 *     rather than installing a partially-trusted manifest.
 */

import { Deferred, Effect, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { unbuilt } from "../harness.js";
import { StreamBuildId, resumeKit, runtimeFor, srcModule } from "./support.js";
import { asDocument, fakeDocument } from "./fake-dom.js";

/** Pull the `data-af-resume` JSON payloads out of a streamed document. */
function manifestChunks(html: string): unknown[] {
  const pattern =
    /<script type="application\/json" data-af-resume[^>]*>([\s\S]*?)<\/script>/g;
  const found: unknown[] = [];
  let match = pattern.exec(html);
  while (match !== null) {
    found.push(JSON.parse(match[1]!.replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&")));
    match = pattern.exec(html);
  }
  return found;
}

describe("streaming manifest (M11.5)", () => {
  it("[M11.5] emits one manifest record per flushed region plus a terminal completeness record", async () => {
    const { dom } = await resumeKit();
    const Component = await srcModule("Component");
    if (dom.renderToStream === undefined) {
      unbuilt("dom.renderToStream", "M11 items 3+5");
    }

    const region = (label: string, ms: number) =>
      Component.renderEffect(
        Component.from(() =>
          Effect.succeed(label).pipe(Effect.delay(`${ms} millis`)),
        ),
        {},
      );

    const html = await Effect.runPromise(
      Stream.runFold(
        dom.renderToStream(() => [region("one", 5), region("two", 10)], {
          mode: "ordered",
          buildId: StreamBuildId,
        }),
        () => "",
        (accumulator: string, chunk: string) => accumulator + chunk,
      ) as Effect.Effect<string, never, never>,
    );

    const records = manifestChunks(html) as any[];
    // Two regions, two incremental records, then exactly one terminal record.
    expect(records.length).toBeGreaterThanOrEqual(3);
    const terminal = records.filter((record) => record.complete === true);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toBe(records[records.length - 1]);
    // Ratified DQ-007: the terminal record carries **region ids, not a count**,
    // so completeness is *set equality* — robust to a duplicated or reordered
    // flush in a way a counter is not.
    const flushed = records
      .filter((record) => record.complete !== true)
      .map((record) => record.region);
    expect(flushed.every((id: unknown) => typeof id === "string")).toBe(true);
    expect([...terminal[0].regionIds].sort()).toEqual([...flushed].sort());
    // A counter would also satisfy "same length"; set equality is what makes a
    // *duplicate* flush detectable, so assert the ids themselves are distinct.
    expect(new Set(flushed).size).toBe(flushed.length);
    // Every record is gated on the same build id and the same manifest
    // version — DQ-007 chose a new discriminated version over optional fields
    // bolted onto v4, so a v4 decoder must not silently accept a stream record.
    for (const record of records) {
      expect(record.buildId).toBe(StreamBuildId);
      expect(record.version).not.toBe(4);
      expect(record.version).toBe(records[0].version);
    }
  });

  it("[M11.5] registers nothing for a region that never flushes", async () => {
    const { dom } = await resumeKit();
    const Component = await srcModule("Component");
    if (dom.renderToStream === undefined) {
      unbuilt("dom.renderToStream", "M11 items 3+5");
    }

    const program = Effect.gen(function* () {
      const never = yield* Deferred.make<string>();
      const Ghost = Component.from(() => Deferred.await(never));
      const chunks: string[] = [];
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(
          dom.renderToStream(
            () => ["shell", Component.renderEffect(Ghost, {})],
            { mode: "out-of-order", buildId: StreamBuildId, deadline: "20 millis" },
          ),
          (chunk: string) => Effect.sync(() => void chunks.push(chunk)),
        ),
      );
      yield* Fiber.await(fiber);
      return chunks.join("");
    });

    const html = await Effect.runPromise(program as Effect.Effect<any, never, never>);
    const records = manifestChunks(html) as any[];

    // The shell's record and the terminal record — and nothing claiming the
    // ghost region's boundaries or expressions. The non-empty guard matters:
    // a `for` loop over an empty list asserts nothing, so a renderer that
    // emitted no records at all would otherwise pass this spec.
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(Object.keys(record.components ?? {})).not.toContain("ghost");
    }
    const terminal = records.find((record) => record.complete === true);
    expect(terminal).toBeDefined();
    // Completeness is over the regions that actually flushed: the ghost region
    // is absent from the id set, so a client cannot be told to wait for it.
    expect([...terminal!.regionIds]).not.toContain("ghost");
    expect([...terminal!.regionIds]).toEqual(
      records.filter((record) => record.complete !== true).map((r) => r.region),
    );
  });

  it("[M11.5] enforces the byte ceiling cumulatively across records", async () => {
    const { dom } = await resumeKit();
    const Component = await srcModule("Component");
    if (dom.renderToStream === undefined) {
      unbuilt("dom.renderToStream", "M11 items 3+5");
    }

    const region = (label: string) =>
      Component.renderEffect(
        Component.from(() => Effect.succeed(label)),
        {},
      );

    // Each individual record fits; the sum does not. Failing per-record would
    // let a stream smuggle an unbounded manifest past the ceiling. `flip` is
    // deliberate: it makes the *typed failure value* the subject, so the tag
    // and its attribution can be asserted rather than just "it broke".
    const failure = await Effect.runPromise(
      Effect.flip(
        Stream.runDrain(
          dom.renderToStream(
            () => [region("a"), region("b"), region("c")],
            { mode: "ordered", buildId: StreamBuildId, maxPayloadBytes: 32 },
          ),
        ),
      ) as Effect.Effect<any, never, never>,
    );

    // Ratified DQ-007: the cumulative ceiling has an error **distinct** from
    // the single-manifest `ResumePayloadTooLargeError`, carrying the per-record
    // attribution the M9 review asked for. One shared tag would make "which
    // record blew the budget" unanswerable.
    expect(String(failure._tag)).toMatch(/TooLarge|PayloadLimit/);
    expect(String(failure._tag)).not.toBe("ResumePayloadTooLargeError");
    expect(failure.region ?? failure.recordId).toBeDefined();

    // NEGATIVE CONTROL. The identical stream under a ceiling its *sum* fits
    // runs to completion. Without this, a renderer that rejected every
    // streamed manifest would satisfy the assertion above forever.
    const roomy = await Effect.runPromise(
      Effect.exit(
        Stream.runDrain(
          dom.renderToStream(
            () => [region("a"), region("b"), region("c")],
            { mode: "ordered", buildId: StreamBuildId, maxPayloadBytes: 64_000 },
          ),
        ),
      ) as Effect.Effect<any, never, never>,
    );
    expect(roomy._tag).toBe("Success");
  });

  it("[M11.5] fails a truncated stream closed at install time", async () => {
    const { Resume, Serialization } = await resumeKit();
    const installStreamed = Resume.installClientStreamed;
    if (installStreamed === undefined) {
      unbuilt(
        "Resume.installClientStreamed (completeness-gated install)",
        "M11 item 6",
      );
    }

    // A stream that ended without its terminal completeness record.
    const truncated = [
      { version: 5, buildId: StreamBuildId, region: "r0", events: {} },
    ];
    const complete = [
      ...truncated,
      { version: 5, buildId: StreamBuildId, complete: true, regionIds: ["r0"] },
    ];

    const runtime = runtimeFor();
    const doc = fakeDocument([]);

    const failure = await Effect.runPromise(
      installStreamed({
        root: asDocument(doc),
        records: truncated,
        expectedBuildId: StreamBuildId,
        resolverEntries: {},
        runtime,
      }).pipe(
        Effect.flip,
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<any, never, never>,
    );
    // Truncation is a typed, closed failure — never a partial install. The
    // spelling of the tag stays loose because DQ-018 (the resume error union)
    // is still open; DQ-008 says to pin it when DQ-018 settles.
    expect(String(failure._tag)).toMatch(/Truncated|Incomplete/);
    // …and it is a *different* failure from a build mismatch, its nearest
    // neighbour. One generic "bad stream" error would satisfy this spec and the
    // build-id spec below simultaneously.
    expect(String(failure._tag)).not.toMatch(/BuildMismatch/);

    // NEGATIVE CONTROL: the same records plus the terminal record install.
    const installed = await Effect.runPromise(
      installStreamed({
        root: asDocument(doc),
        records: complete,
        expectedBuildId: StreamBuildId,
        resolverEntries: {},
        runtime,
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );
    expect(installed.inspect().disposed).toBe(false);
    await Effect.runPromise(installed.dispose);
    await runtime.dispose();
  });

  it("[M11.5] rejects a record whose build id disagrees with the page", async () => {
    const { Resume, Serialization } = await resumeKit();
    const installStreamed = Resume.installClientStreamed;
    if (installStreamed === undefined) {
      unbuilt(
        "Resume.installClientStreamed (completeness-gated install)",
        "M11 item 6",
      );
    }

    const runtime = runtimeFor();
    const failure = await Effect.runPromise(
      installStreamed({
        root: asDocument(fakeDocument([])),
        records: [
          { version: 5, buildId: StreamBuildId, region: "r0", events: {} },
          // One stale record poisons the whole install; a per-region build gate
          // that only checked the first record would let this through.
          { version: 5, buildId: "other-build", region: "r1", events: {} },
          { version: 5, buildId: StreamBuildId, complete: true, regionIds: ["r0", "r1"] },
        ],
        expectedBuildId: StreamBuildId,
        resolverEntries: {},
        runtime,
      }).pipe(
        Effect.flip,
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<any, never, never>,
    );

    expect(String(failure._tag)).toMatch(/BuildMismatch/);
    // Distinct from truncation, which is the other way this install fails.
    expect(String(failure._tag)).not.toMatch(/Truncated|Incomplete/);

    // NEGATIVE CONTROL. The identical record set with every build id agreeing
    // installs cleanly, so "reject every multi-record install" cannot pass.
    const installed = await Effect.runPromise(
      installStreamed({
        root: asDocument(fakeDocument([])),
        records: [
          { version: 5, buildId: StreamBuildId, region: "r0", events: {} },
          { version: 5, buildId: StreamBuildId, region: "r1", events: {} },
          { version: 5, buildId: StreamBuildId, complete: true, regionIds: ["r0", "r1"] },
        ],
        expectedBuildId: StreamBuildId,
        resolverEntries: {},
        runtime,
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );
    expect(installed.inspect().disposed).toBe(false);
    await Effect.runPromise(installed.dispose);
    await runtime.dispose();
  });
});
