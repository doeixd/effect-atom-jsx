/**
 * Serialization.ts — schema-driven wire codec service.
 *
 * The SSR trust boundary needs one place that turns typed values into a
 * transport string and back, with structural validation on the way in. This
 * module provides that seam as both:
 *
 * - **pure codec helpers** (`encodeSync` / `decodeSync`) for the synchronous
 *   HTML-string-building path (server render), and
 * - an injectable **`Serialization` service** (`Tag` + `layer`) for Effect
 *   contexts that want the codec swapped (e.g. an alternate encoder such as
 *   `seroval` for streaming/`Date`/`Map` payloads) without touching call sites.
 *
 * The default layer is backed by Effect `Schema`: values are `Schema.encode`d
 * to their JSON representation, `JSON.stringify`d, and HTML-escaped so the
 * output is safe to embed inside a `<script>` tag; decoding validates the
 * incoming JSON against the same schema. This keeps the package's single
 * runtime dependency (`effect`) and gives validation + versioning at the
 * boundary rather than eval-on-hydrate.
 *
 * The loader-result wire projection itself lives in `./result-wire.js`, which is
 * the single canonical place that knows the flat DTO. This module keeps the
 * *string* layer (HTML escaping, `encodeSync`/`decodeSync`, the convenience
 * result codecs, and the injectable service) and re-exports the schema and the
 * projection functions so existing import paths keep working.
 */

import { Effect, Layer, Schema, SchemaIssue, Context, Option } from "effect";
import { type Result as CoreResultType } from "./effect-ts.js";
import { ResultWire, ResultWireRecord, toWire, fromWire, type ResultWireValue } from "./result-wire.js";

/**
 * Escape a JSON string so it is safe to embed inside an HTML `<script>` tag.
 *
 * `<`, `>`, `&` and the JS line separators U+2028/U+2029 can break out of a
 * `<script>` or be invalid JS. Each maps to a valid JSON unicode escape, so the
 * output is script-safe AND still parses via `JSON.parse`.
 */
export function escapeJsonForHtml(json: string): string {
  const HTML_UNSAFE = new RegExp(
    "[<>&" + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + "]",
    "g",
  );
  return json.replace(HTML_UNSAFE, (c) => {
    switch (c.charCodeAt(0)) {
      case 0x3c: return "\\u003c";
      case 0x3e: return "\\u003e";
      case 0x26: return "\\u0026";
      case 0x2028: return "\\u2028";
      case 0x2029: return "\\u2029";
      default: return c;
    }
  });
}

// ─── Loader-result wire projection (re-exported) ────────────────────────────
//
// Canonical definitions live in `./result-wire.js` — the only module that
// constructs or interprets the flat DTO. These re-exports preserve the historic
// `Serialization.*` import paths (docs, router, tests).

export {
  /** Canonical loader-result wire schema. @see result-wire.js */
  ResultWire,
  /** Wire schema for a full loader-data payload keyed by route id. */
  ResultWireRecord,
} from "./result-wire.js";

export type { ResultWireValue } from "./result-wire.js";

/**
 * Project a core `Result` to its flat, JSON-safe wire shape.
 *
 * Re-export of `resultWire.toWire`; see `./result-wire.js` for the frozen
 * field mapping.
 */
export const resultToWire: (
  result: CoreResultType<unknown, unknown>,
  now?: () => number,
) => ResultWireValue = toWire;

/**
 * Rehydrate a core `Result` from its flat wire shape.
 *
 * Re-export of `resultWire.fromWire`; decode is lenient by contract.
 */
export const resultFromWire: (
  wire: ResultWireValue,
) => CoreResultType<unknown, unknown> = fromWire;

// ─── Pure synchronous codec ─────────────────────────────────────────────────

/**
 * Encode a value to an HTML-safe JSON wire string via its schema.
 *
 * Throws `Schema.SchemaError` if the value does not conform to the schema.
 */
export function encodeSync<T, E>(schema: Schema.Codec<T, E>, value: T): string {
  return escapeJsonForHtml(JSON.stringify(Schema.encodeSync(schema)(value)));
}

/**
 * Decode an HTML-safe JSON wire string back to a value via its schema.
 *
 * Throws on malformed JSON or a schema mismatch.
 */
export function decodeSync<T, E>(schema: Schema.Codec<T, E>, wire: string): T {
  return Schema.decodeUnknownSync(schema)(JSON.parse(wire));
}

// ─── Loader-result convenience codec ────────────────────────────────────────

/** Encode a single core loader `Result` to an HTML-safe wire string. */
export function encodeResult(result: CoreResultType<unknown, unknown>): string {
  return encodeSync(ResultWire, resultToWire(result));
}

/** Decode a single core loader `Result` from an HTML-safe wire string. */
export function decodeResult(wire: string): CoreResultType<unknown, unknown> {
  return resultFromWire(decodeSync(ResultWire, wire));
}

/** Encode a keyed loader-data payload of core `Result`s to a wire string. */
export function encodeResultRecord(record: Record<string, CoreResultType<unknown, unknown>>): string {
  const wire: Record<string, ResultWireValue> = {};
  for (const [key, result] of Object.entries(record)) {
    wire[key] = resultToWire(result);
  }
  return encodeSync(ResultWireRecord, wire);
}

/** Decode a keyed loader-data payload of core `Result`s from a wire string. */
export function decodeResultRecord(wire: string): Record<string, CoreResultType<unknown, unknown>> {
  const decoded = decodeSync(ResultWireRecord, wire);
  const out: Record<string, CoreResultType<unknown, unknown>> = {};
  for (const [key, value] of Object.entries(decoded)) {
    out[key] = resultFromWire(value as ResultWireValue);
  }
  return out;
}

// ─── Injectable service ─────────────────────────────────────────────────────

export interface SerializationService {
  /** Encode a value to an HTML-safe wire string via its schema. */
  readonly serialize: <T, E>(
    schema: Schema.Codec<T, E>,
    value: T,
  ) => Effect.Effect<string, Schema.SchemaError>;
  /** Decode a wire string back to a value, validating it against the schema. */
  readonly deserialize: <T, E>(
    schema: Schema.Codec<T, E>,
    wire: string,
  ) => Effect.Effect<T, Schema.SchemaError>;
}

export const Tag = Context.Service<SerializationService>("Serialization");

const schemaCodec: SerializationService = {
  serialize: (schema, value) =>
    Schema.encodeEffect(schema)(value).pipe(
      Effect.map((encoded) => escapeJsonForHtml(JSON.stringify(encoded))),
    ),
  deserialize: (schema, wire) =>
    parseJson(wire).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema))),
};

/**
 * `JSON.parse` in the typed error channel.
 *
 * A syntax error in an untrusted wire payload is an ordinary boundary failure,
 * not a bug, so it must not escape as a defect. It is surfaced as a
 * `Schema.SchemaError` — the same channel a structural mismatch uses — so that
 * callers which already handle decode failure (e.g. `Resume.decodeManifest`'s
 * `catchTag("SchemaError", ...)`) see malformed JSON as a typed failure without
 * needing to widen their error unions.
 */
function parseJson(wire: string): Effect.Effect<unknown, Schema.SchemaError> {
  return Effect.try({
    try: () => JSON.parse(wire) as unknown,
    catch: (cause) =>
      new Schema.SchemaError(
        new SchemaIssue.InvalidValue(Option.some(wire), {
          message: `Malformed JSON wire payload: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        }),
      ),
  });
}

/**
 * Default `Serialization` layer: Effect-`Schema`-backed JSON codec with
 * HTML-safe escaping. Zero dependencies beyond `effect`.
 */
export const layer: Layer.Layer<SerializationService> = Layer.succeed(Tag, schemaCodec);

/** Alias for {@link layer}, matching the `live`/`test` naming used elsewhere. */
export const live = layer;
