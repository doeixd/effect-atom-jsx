/**
 * M11.5 — the incremental (streamed) resume manifest. Promoted from
 * `future/streaming/streaming-manifest.spec.ts` (all green 2026-08-11),
 * retyped.
 *
 * The manifest becomes one record per flushed region (same schemas, same
 * build-ID gate, byte ceiling enforced *cumulatively*), plus a terminal
 * completeness record so install can tell "stream ended" from "stream
 * truncated" and fall back closed. Completeness is ratified `DQ-007`: SET
 * EQUALITY over region ids, never a count.
 */
import { Deferred, Effect, Fiber, Layer, ManagedRuntime, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import * as Component from "../Component.js";
import * as Resume from "../Resume.js";
import { renderToStream } from "../dom.js";
import {
  ResumeStreamPayloadTooLargeError,
  StreamRecordSchema,
  type StreamRecord,
  type StreamRegionRecord,
  type StreamTerminalRecord,
} from "../streaming-manifest.js";
import { asDocument, fakeDocument } from "./streaming-fake-dom.js";

const StreamBuildId = "streaming-manifest-test-build";

/** Pull the `data-af-resume` JSON payloads out of a streamed document. */
function manifestRecords(html: string): StreamRecord[] {
  const pattern =
    /<script type="application\/json" data-af-resume[^>]*>([\s\S]*?)<\/script>/g;
  const found: StreamRecord[] = [];
  let match = pattern.exec(html);
  while (match !== null) {
    const json = match[1]!
      .replace(/\\u003c/g, "<")
      .replace(/\\u003e/g, ">")
      .replace(/\\u0026/g, "&");
    found.push(Schema.decodeUnknownSync(StreamRecordSchema)(JSON.parse(json)));
    match = pattern.exec(html);
  }
  return found;
}

const isTerminal = (record: StreamRecord): record is StreamTerminalRecord =>
  "complete" in record;
const isRegion = (record: StreamRecord): record is StreamRegionRecord =>
  !("complete" in record);

const drainToString = (
  stream: Stream.Stream<string, unknown>,
): Effect.Effect<string, unknown> =>
  Stream.runFold(stream, () => "", (accumulator, chunk) => accumulator + chunk);

const labelledRegion = (label: string, ms: number) =>
  Component.renderEffect(
    Component.from<{}>(() =>
      Effect.succeed(label).pipe(Effect.delay(`${ms} millis`))
    ),
    {},
  );

describe("streaming manifest (M11.5)", () => {
  it("emits one manifest record per flushed region plus a terminal completeness record", async () => {
    const html = await Effect.runPromise(
      drainToString(
        renderToStream(
          () => [labelledRegion("one", 5), labelledRegion("two", 10)],
          { mode: "ordered", buildId: StreamBuildId },
        ),
      ) as Effect.Effect<string, never>,
    );

    const records = manifestRecords(html);
    // Two regions, two incremental records, then exactly one terminal record.
    expect(records.length).toBeGreaterThanOrEqual(3);
    const terminals = records.filter(isTerminal);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toBe(records[records.length - 1]);
    // DQ-007: the terminal record carries **region ids, not a count**, so
    // completeness is *set equality* — robust to a duplicated or reordered
    // flush in a way a counter is not.
    const flushed = records.filter(isRegion).map((record) => record.region);
    expect([...terminals[0]!.regionIds].sort()).toEqual([...flushed].sort());
    // A counter would also satisfy "same length"; distinct ids are what make a
    // *duplicate* flush detectable.
    expect(new Set(flushed).size).toBe(flushed.length);
    // Every record is gated on the same build id and the same discriminated
    // version — a v4 decoder must not silently accept a stream record.
    for (const record of records) {
      expect(record.buildId).toBe(StreamBuildId);
      expect(record.version).toBe(5);
    }
  });

  it("registers nothing for a region that never flushes", async () => {
    const program = Effect.gen(function* () {
      const never = yield* Deferred.make<string>();
      const Ghost = Component.from<{}>(() => Deferred.await(never));
      const chunks: string[] = [];
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(
          renderToStream(
            () => ["shell", Component.renderEffect(Ghost, {})],
            {
              mode: "out-of-order",
              buildId: StreamBuildId,
              deadline: "20 millis",
            },
          ),
          (chunk) => Effect.sync(() => void chunks.push(chunk)),
        ),
      );
      yield* Fiber.await(fiber);
      return chunks.join("");
    });

    const html = await Effect.runPromise(program);
    const records = manifestRecords(html);

    // The terminal record still arrives — and nothing claims the ghost region.
    // The non-empty guard matters: a loop over an empty list asserts nothing.
    expect(records.length).toBeGreaterThan(0);
    const terminal = records.find(isTerminal);
    expect(terminal).toBeDefined();
    // Completeness is over the regions that actually flushed: the abandoned
    // region is absent from the id set, so a client cannot be told to wait
    // for it.
    expect([...terminal!.regionIds]).toEqual(
      records.filter(isRegion).map((record) => record.region),
    );
  });

  it("enforces the byte ceiling cumulatively across records", async () => {
    const region = (label: string) =>
      Component.renderEffect(
        Component.from<{}>(() => Effect.succeed(label)),
        {},
      );
    const tree = () => [region("a"), region("b"), region("c")];

    // Each individual record fits; the sum does not. Failing per-record would
    // let a stream smuggle an unbounded manifest past the ceiling.
    const failure = await Effect.runPromise(
      Effect.flip(
        Stream.runDrain(
          renderToStream(tree, {
            mode: "ordered",
            buildId: StreamBuildId,
            maxPayloadBytes: 32,
          }),
        ),
      ) as Effect.Effect<unknown, never>,
    );

    // DQ-007: the cumulative ceiling has an error DISTINCT from the
    // single-manifest `ResumePayloadTooLargeError`, attributed to the record
    // that blew the budget.
    expect(failure).toBeInstanceOf(ResumeStreamPayloadTooLargeError);
    if (!(failure instanceof ResumeStreamPayloadTooLargeError)) return;
    expect(failure._tag).toBe("ResumeStreamPayloadTooLargeError");
    expect(failure.region.length).toBeGreaterThan(0);
    expect(failure.cumulativeBytes).toBeGreaterThan(failure.maximumBytes);

    // NEGATIVE CONTROL. The identical stream under a ceiling its *sum* fits
    // runs to completion.
    const roomy = await Effect.runPromise(
      Effect.exit(
        Stream.runDrain(
          renderToStream(tree, {
            mode: "ordered",
            buildId: StreamBuildId,
            maxPayloadBytes: 64_000,
          }),
        ),
      ),
    );
    expect(roomy._tag).toBe("Success");
  });

  it("fails a truncated stream closed at install time", async () => {
    // A stream that ended without its terminal completeness record.
    const truncated: unknown[] = [
      { version: 5, buildId: StreamBuildId, region: "r0", events: {} },
    ];
    const complete: unknown[] = [
      ...truncated,
      { version: 5, buildId: StreamBuildId, complete: true, regionIds: ["r0"] },
    ];

    const runtime = ManagedRuntime.make(Layer.empty);
    const doc = fakeDocument([]);

    const failure = await Effect.runPromise(
      Effect.flip(
        Resume.installClientStreamed({
          root: asDocument(doc),
          records: truncated,
          expectedBuildId: StreamBuildId,
          resolverEntries: {},
          runtime,
        }),
      ),
    );
    // Truncation is a typed, closed failure — never a partial install — and a
    // DIFFERENT failure from a build mismatch, its nearest neighbour.
    expect(failure._tag).toBe("ResumeStreamTruncatedError");

    // NEGATIVE CONTROL: the same records plus the terminal record install.
    const installed = await Effect.runPromise(
      Resume.installClientStreamed({
        root: asDocument(doc),
        records: complete,
        expectedBuildId: StreamBuildId,
        resolverEntries: {},
        runtime,
      }),
    );
    expect(installed.inspect().disposed).toBe(false);
    await Effect.runPromise(installed.dispose);
    await runtime.dispose();
  });

  it("rejects a record whose build id disagrees with the page", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const failure = await Effect.runPromise(
      Effect.flip(
        Resume.installClientStreamed({
          root: asDocument(fakeDocument([])),
          records: [
            { version: 5, buildId: StreamBuildId, region: "r0", events: {} },
            // One stale record poisons the whole install; a build gate that
            // only checked the first record would let this through.
            { version: 5, buildId: "other-build", region: "r1", events: {} },
            {
              version: 5,
              buildId: StreamBuildId,
              complete: true,
              regionIds: ["r0", "r1"],
            },
          ],
          expectedBuildId: StreamBuildId,
          resolverEntries: {},
          runtime,
        }),
      ),
    );

    // Distinct from truncation, the other way this install fails closed.
    expect(failure._tag).toBe("ResumeClientBuildMismatchError");

    // NEGATIVE CONTROL. The identical record set with every build id agreeing
    // installs cleanly, so "reject every multi-record install" cannot pass.
    const installed = await Effect.runPromise(
      Resume.installClientStreamed({
        root: asDocument(fakeDocument([])),
        records: [
          { version: 5, buildId: StreamBuildId, region: "r0", events: {} },
          { version: 5, buildId: StreamBuildId, region: "r1", events: {} },
          {
            version: 5,
            buildId: StreamBuildId,
            complete: true,
            regionIds: ["r0", "r1"],
          },
        ],
        expectedBuildId: StreamBuildId,
        resolverEntries: {},
        runtime,
      }),
    );
    expect(installed.inspect().disposed).toBe(false);
    await Effect.runPromise(installed.dispose);
    await runtime.dispose();
  });
});
