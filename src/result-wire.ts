/**
 * result-wire.ts — the single canonical wire projection for core `Result`.
 *
 * This is the **only** module in the repo that constructs or interprets the
 * flat, JSON-safe result DTO (`Initial | Success | Failure` with `waiting`,
 * `timestamp`, and `previousSuccess`). Core `Result` carries `Exit`/`Cause` and
 * is not JSON-safe; at every transport boundary it is projected through
 * {@link toWire} and rehydrated through {@link fromWire}.
 *
 * Any future module that needs a serializable result must import this one.
 * Hand-rolling the mapping is a review-blocking defect
 * (`docs/RESULT_UNIFICATION_PLAN.md`, Decision 3).
 *
 * ## The frozen field mapping
 *
 * The DTO shape predates `Stale` and is frozen, so three fields are *shadows*
 * of the core algebra rather than state of their own:
 *
 * - `waiting` is the boolean shadow of the `Refreshing` wrapper.
 * - `previousSuccess` is `Stale.data` when settled, `Refreshing.previous`
 *   in flight.
 * - `timestamp` is **write-only**: it is emitted from the injectable `now`
 *   parameter and every decoder ignores it. It is a serializer field, not a
 *   model field, and is deliberately not promoted onto core `Result`
 *   (Decision 4). It must stay in the schema — the format is frozen.
 *
 * `Exit` and `rawCause` are intentionally absent: `Defect` travels as
 * `error: { defect: string }` and decode reconstructs it via `Result.defect`,
 * which synthesizes `Cause.die`. Frozen behaviour.
 *
 * Encode is total; **decode is deliberately lenient** and must keep accepting
 * every historical wire value, including ones {@link toWire} can no longer
 * produce (`Initial{waiting:false}`, a waiting `Failure` carrying
 * `previousSuccess`). Every row is pinned by golden-byte fixtures in
 * `src/__tests__/serialization.test.ts`; those fixtures are immutable outside
 * an explicitly wire-versioned change.
 *
 * ## Known unprojected path
 *
 * `SingleFlightPayload.loaders[].result` does **not** go through this module:
 * it `JSON.stringify`s a core `Result` directly, silently dropping
 * `exit`/`rawCause`, and the client rehydrates it unvalidated. Routing that
 * path through `toWire`/`fromWire` is a byte-changing fix and is a named
 * follow-up, fenced out of the unification by plan Decision 6.
 */

import { Schema } from "effect";
import { Result as CoreResult, type Result as CoreResultType } from "./effect-ts.js";

// ─── Wire schema ────────────────────────────────────────────────────────────

const SuccessWire = Schema.Struct({
  _tag: Schema.Literal("Success"),
  value: Schema.Unknown,
  waiting: Schema.Boolean,
  timestamp: Schema.Number,
});

/**
 * Flat, JSON-safe wire projection of a core loader `Result`.
 *
 * `value` and `error` are `Unknown` (structural passthrough) because the router
 * serializes results for many routes whose payload types are not known at this
 * layer; routes that declare a loader schema get validated through their own
 * schema upstream. The shape is deliberately settled-and-serializable — no
 * `Cause`/`Exit` — which is why the wire holds this rather than a core
 * `Result` directly.
 */
export const ResultWire = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Initial"),
    waiting: Schema.Boolean,
  }),
  SuccessWire,
  Schema.Struct({
    _tag: Schema.Literal("Failure"),
    error: Schema.Unknown,
    waiting: Schema.Boolean,
    previousSuccess: Schema.NullOr(SuccessWire),
  }),
]);

/** Wire schema for a full loader-data payload keyed by route id. */
export const ResultWireRecord = Schema.Record(Schema.String, ResultWire);

/** The flat, JSON-safe wire shape a loader `Result` is projected to. */
export type ResultWireValue = typeof ResultWire.Type;

/** The `Success` arm of {@link ResultWireValue}. */
export type SuccessWireValue = typeof SuccessWire.Type;

// ─── Encode: core `Result` → wire DTO ───────────────────────────────────────

const initialWire = (waiting: boolean): ResultWireValue => ({ _tag: "Initial", waiting });

const successWire = (
  value: unknown,
  waiting: boolean,
  timestamp: number,
): SuccessWireValue => ({ _tag: "Success", value, waiting, timestamp });

const failureWire = (
  error: unknown,
  waiting: boolean,
  previousSuccess: SuccessWireValue | null,
): ResultWireValue => ({ _tag: "Failure", error, waiting, previousSuccess });

/**
 * Project a core `Result` to its flat, JSON-safe wire shape.
 *
 * @param result - The core result to project.
 * @param now    - Clock used for the write-only `timestamp` field. Defaults to
 *                 `Date.now`, which preserves the historical bytes; tests pin
 *                 it to make the output deterministic.
 */
export function toWire(
  result: CoreResultType<unknown, unknown>,
  now: () => number = Date.now,
): ResultWireValue {
  switch (result._tag) {
    case "Loading":
      return initialWire(true);
    case "Refreshing":
      switch (result.previous._tag) {
        case "Success":
          return successWire(result.previous.value, true, now());
        case "Failure":
          return failureWire(result.previous.error, true, null);
        case "Defect":
          return failureWire({ defect: result.previous.cause }, true, null);
      }
    // eslint-disable-next-line no-fallthrough
    case "Success":
      return successWire(result.value, false, now());
    case "Failure":
      return failureWire(result.error, false, null);
    case "Stale":
      return failureWire(result.error, false, successWire(result.data, false, now()));
    case "Defect":
      return failureWire({ defect: result.cause }, false, null);
  }
}

// ─── Decode: wire DTO → core `Result` ───────────────────────────────────────

/**
 * Is this wire `error` the structured defect envelope rather than a typed `E`?
 *
 * Kept as a named predicate because it participates in *two* frozen rules:
 * a defect error takes precedence over the stale reconstruction, and it is the
 * only way `Defect` survives a round-trip.
 */
function isDefectError(error: unknown): error is { readonly defect: string } {
  return typeof error === "object" && error !== null && "defect" in error;
}

/**
 * Rehydrate a core `Result` from its flat wire shape.
 *
 * Lenient by contract: accepts every historical value, including the two rows
 * {@link toWire} cannot produce. Do **not** "simplify" the `Failure` branch —
 * each of its clauses is a separate frozen row with its own golden fixture.
 */
export function fromWire(wire: ResultWireValue): CoreResultType<unknown, unknown> {
  switch (wire._tag) {
    case "Initial":
      // `waiting: false` is the historically unreachable slot reserved for a
      // future `Idle`; today both booleans decode to `Loading`.
      return CoreResult.loading;

    case "Success":
      return wire.waiting
        ? CoreResult.refreshing(CoreResult.success(wire.value))
        : CoreResult.success(wire.value);

    case "Failure": {
      if (isDefectError(wire.error)) {
        // Defect wins over the stale rule. A waiting defect that still carries
        // last-known-good data degrades to `Refreshing(Success)` — lossy, and
        // frozen that way.
        return wire.waiting && wire.previousSuccess !== null
          ? CoreResult.refreshing(CoreResult.success(wire.previousSuccess.value))
          : CoreResult.defect(wire.error.defect);
      }
      if (wire.previousSuccess !== null) {
        // Settled failure that still has last-known-good data is a failed
        // refresh: `Stale` once settled, `Refreshing` while in flight.
        return wire.waiting
          ? CoreResult.refreshing(CoreResult.success(wire.previousSuccess.value))
          : CoreResult.stale(wire.error, wire.previousSuccess.value);
      }
      // No previous data: `waiting` carries no recoverable information, so a
      // waiting failure settles to `Failure` (lossy, frozen — see the row-5
      // note on the golden fixtures).
      return CoreResult.failure(wire.error);
    }
  }
}
