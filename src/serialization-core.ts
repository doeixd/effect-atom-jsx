/**
 * serialization-core.ts — the dependency-free heart of the Serialization
 * seam: the service interface, its Tag, the default codec's identity, and
 * the HTML-safe JSON escape.
 *
 * Deliberately a LEAF (imports `effect` only): `Portable` consults the
 * service for universal capture encoding, and `Serialization.ts` itself sits
 * behind `result-wire`/`effect-ts`/`dom` — importing it from `Portable`
 * would close a module-evaluation cycle back into `Portable`. Everything
 * here is re-exported from `Serialization.ts`, which stays the public
 * import surface.
 */
import { Context, Effect, Schema } from "effect";

/**
 * Escape a JSON string so it is safe to embed inside an HTML `<script>` tag.
 *
 * `<`, `>`, `&` and the JS line separators U+2028/U+2029 can break out of a
 * `<script>` or be invalid JS. Each maps to a valid JSON unicode escape, so
 * the output is script-safe AND still parses via `JSON.parse`.
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

export interface SerializationService {
  /**
   * The codec's identity (`DQ-012`): stamped as `manifest.serializer` beside
   * `buildId` and gated at decode, so a client configured with a different
   * codec rejects a payload instead of misdecoding it. A client's own id is
   * simply the id of the layer it provided.
   */
  readonly id: string;
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

/** Identity of the default Effect-`Schema` JSON codec. */
export const defaultSerializerId = "af.schema-json.v1";
