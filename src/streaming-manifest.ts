/**
 * streaming-manifest.ts — incremental resume manifest records (M11.5,
 * ratified `DQ-007`).
 *
 * A streamed document cannot wait for one final manifest: the manifest
 * becomes one record per flushed region — same build-ID gate, byte ceiling
 * enforced *cumulatively* — plus a terminal completeness record carrying the
 * **set of flushed region ids** (not a count: set equality makes a duplicated
 * or dropped flush detectable in a way a counter is not). `DQ-007` chose a
 * discriminated record shape over optional fields bolted onto the v4/v5
 * manifest, so a static-manifest decoder can never silently accept a stream
 * record.
 *
 * This module is deliberately leaf-shaped (effect + Portable + the session
 * types) so `dom.renderToStream` can emit records without importing
 * `Resume.ts`; the install side (`Resume.installClientStreamed`) validates
 * records against the schemas exported here.
 */
import { Effect, Schema } from "effect";
import * as Portable from "./Portable.js";
import type { ResumeSession } from "./resume-session.js";

export const StreamRegionRecordSchema = Schema.Struct({
  version: Schema.Literal(5),
  buildId: Schema.String,
  installationId: Schema.optional(Schema.String),
  region: Schema.String,
  events: Schema.Record(Schema.String, Schema.Unknown),
});
export type StreamRegionRecord = typeof StreamRegionRecordSchema.Type;

export const StreamTerminalRecordSchema = Schema.Struct({
  version: Schema.Literal(5),
  buildId: Schema.String,
  installationId: Schema.optional(Schema.String),
  complete: Schema.Literal(true),
  regionIds: Schema.Array(Schema.String),
});
export type StreamTerminalRecord = typeof StreamTerminalRecordSchema.Type;

export const StreamRecordSchema = Schema.Union([
  StreamRegionRecordSchema,
  StreamTerminalRecordSchema,
]);
export type StreamRecord = typeof StreamRecordSchema.Type;

/**
 * The cumulative streamed-manifest budget was exceeded (`DQ-007`): distinct
 * from the single-manifest `ResumePayloadTooLargeError`, and attributed to
 * the record that blew the budget — one shared tag would make "which record"
 * unanswerable.
 */
export class ResumeStreamPayloadTooLargeError extends Schema.TaggedErrorClass<ResumeStreamPayloadTooLargeError>(
  "@effect-atom-jsx/ResumeStreamPayloadTooLargeError",
)("ResumeStreamPayloadTooLargeError", {
  region: Schema.String,
  maximumBytes: Schema.Number,
  cumulativeBytes: Schema.Number,
  message: Schema.String,
}) {}

/** A streamed record referenced code from a different build. */
export class ResumeStreamRecordBuildError extends Schema.TaggedErrorClass<ResumeStreamRecordBuildError>(
  "@effect-atom-jsx/ResumeStreamRecordBuildError",
)("ResumeStreamRecordBuildError", {
  region: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
  message: Schema.String,
}) {}

/**
 * Build the manifest record for one flushed region from the session events
 * that region's own synchronous slice registered — captured per slice, not
 * via a shared cursor, so concurrently-flushing regions cannot scramble
 * attribution. Descriptors go through the same portable/build-id gate
 * `Resume.collect` applies.
 *
 * Component and expression deltas are NOT yet carried on stream records —
 * that is the remainder of M11 item 6 (install-over-stream), tracked in the
 * plan; a resumable component inside a streamed region currently resumes via
 * the ordinary post-stream manifest path.
 */
export function buildStreamRegionRecord(
  session: ResumeSession,
  pendingEvents: ResumeSession["events"],
  region: string,
  buildId: string,
): Effect.Effect<StreamRegionRecord, ResumeStreamRecordBuildError> {
  return Effect.gen(function* () {
    const events: Record<string, unknown> = {};
    for (const pending of pendingEvents) {
      if (pending.kind === "activation") {
        events[pending.id] = {
          type: pending.eventType,
          invocation: pending.invocation,
          projection: pending.projection,
          targetKey: pending.targetKey,
        };
        continue;
      }
      const descriptor = yield* Portable.describe(pending.executable).pipe(
        Effect.catchTag("PortableCaptureEncodeError", (error) =>
          Effect.fail(
            new ResumeStreamRecordBuildError({
              region,
              expected: buildId,
              actual: buildId,
              message: `Event "${pending.id}" in region "${region}" failed capture encoding: ${error.message}`,
            }),
          ),
        ),
      );
      if (descriptor.buildId !== buildId) {
        return yield* new ResumeStreamRecordBuildError({
          region,
          expected: buildId,
          actual: descriptor.buildId,
          message: `Event "${pending.id}" in region "${region}" references code from a different build.`,
        });
      }
      events[pending.id] = {
        type: pending.eventType,
        invocation: pending.invocation,
        code: descriptor,
      };
    }
    return {
      version: 5,
      buildId,
      installationId: session.installationId,
      region,
      events,
    };
  });
}

export function buildStreamTerminalRecord(
  session: ResumeSession,
  buildId: string,
  regionIds: ReadonlyArray<string>,
): StreamTerminalRecord {
  return {
    version: 5,
    buildId,
    installationId: session.installationId,
    complete: true,
    regionIds,
  };
}

/**
 * HTML-safe embedding: the same `<`/`>`/`&` escapes the static manifest
 * script uses, so a hostile captured string cannot break out of the tag.
 */
export function streamRecordScript(record: StreamRecord): string {
  const json = JSON.stringify(record)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return `<script type="application/json" data-af-resume data-af-stream>${json}</script>`;
}
