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
 * `ResultWire` is the canonical loader-result wire schema: a flat, JSON-safe
 * projection of the stale-while-revalidate result shape. It is the schema the
 * router serializes loader data through, and the seam the internal `Result`
 * migration (Finding-5 step 2) swaps its transform behind.
 */

import { Effect, Layer, Schema, ServiceMap } from "effect";

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

// ─── Loader-result wire schema ──────────────────────────────────────────────

const SuccessWire = Schema.Struct({
  _tag: Schema.Literal("Success"),
  value: Schema.Unknown,
  waiting: Schema.Boolean,
  timestamp: Schema.Number,
});

/**
 * Flat, JSON-safe wire projection of a stale-while-revalidate loader result.
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

export const Tag = ServiceMap.Service<SerializationService>("Serialization");

const schemaCodec: SerializationService = {
  serialize: (schema, value) =>
    Schema.encodeEffect(schema)(value).pipe(
      Effect.map((encoded) => escapeJsonForHtml(JSON.stringify(encoded))),
    ),
  deserialize: (schema, wire) =>
    Effect.suspend(() => Schema.decodeUnknownEffect(schema)(JSON.parse(wire) as unknown)),
};

/**
 * Default `Serialization` layer: Effect-`Schema`-backed JSON codec with
 * HTML-safe escaping. Zero dependencies beyond `effect`.
 */
export const layer: Layer.Layer<SerializationService> = Layer.succeed(Tag, schemaCodec);

/** Alias for {@link layer}, matching the `live`/`test` naming used elsewhere. */
export const live = layer;
