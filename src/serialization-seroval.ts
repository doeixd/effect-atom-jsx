/**
 * serialization-seroval.ts — the universal value codec (M10 items 2-3,
 * ratified `DQ-012`).
 *
 * A `Serialization` layer backed by seroval's `toJSON`/`fromJSON` **tree**
 * form: cycles, `Date`/`Map`/`Set`/`RegExp`, typed arrays — as inert,
 * HTML-safe JSON. Two hard constraints hold:
 *
 * - **eval output is prohibited by default.** `seroval({ mode: "eval" })`
 *   throws; the opt-in is the separately named {@link serovalUnsafeEval}
 *   whose CSP cost is documented at the export site (`DQ-012`: the name
 *   carries the warning).
 * - **the serializer identity gates decoding like the build id.** Every
 *   layer names itself (`SerializationService.id`); the wire carries an
 *   `$afSerializer` envelope, and `Resume.decodeManifest` rejects a payload
 *   from a different codec BEFORE decoding any value.
 *
 * Reference plugins (M10 item 3) serialize framework-managed values as
 * *references*, never structure: state handles/atoms by hydration key,
 * `Portable.BoundCode` as its resolvable descriptor, `SafeHtml` under its
 * branding. Live resources (Scope, Fiber, Layer, services, DOM nodes) stay
 * non-serializable — seroval refuses unknown class/function-bearing values,
 * which is the correct fail-closed default; service access crosses the
 * boundary as a typed `R` requirement instead.
 *
 * seroval itself is loaded lazily (dynamic import at layer construction), so
 * strict-mode projects that never provide these layers ship no seroval.
 */
import { Effect, Layer, Option, Schema, SchemaIssue } from "effect";
import {
  Tag,
  escapeJsonForHtml,
  type SerializationService,
} from "./serialization-core.js";

// Framework modules load lazily WITH seroval at layer construction: this
// module sits beside `Serialization.ts` in an intentional re-export pair, so
// a static import of Portable/Atom-adjacent modules here would close a
// module-evaluation cycle (Portable -> Serialization -> here -> ... ->
// Portable) and leave partially-evaluated bindings behind.
type PortableModule = typeof import("./Portable.js");
type SafeHtmlModule = typeof import("./SafeHtml.js");
type ResumeHandleModule = typeof import("./resume-handle.js");

interface CodecModules {
  readonly Portable: PortableModule;
  readonly SafeHtml: SafeHtmlModule;
  readonly isStateHandleValue: ResumeHandleModule["isStateHandleValue"];
}

function loadCodecModules(): Promise<CodecModules & { readonly seroval: SerovalModule }> {
  return Promise.all([
    import("seroval"),
    import("./Portable.js"),
    import("./SafeHtml.js"),
    import("./resume-handle.js"),
  ]).then(([seroval, Portable, SafeHtml, resumeHandle]) => ({
    seroval: seroval as unknown as SerovalModule,
    Portable,
    SafeHtml,
    isStateHandleValue: resumeHandle.isStateHandleValue,
  }));
}

export const serovalSerializerId = "af.seroval-json.v1";
export const serovalUnsafeEvalSerializerId = "af.seroval-eval.v1";

/** The wire envelope key carrying the serializer identity (`DQ-012`). */
export const serializerEnvelopeKey = "$afSerializer";

function schemaError(message: string, value?: unknown): Schema.SchemaError {
  return new Schema.SchemaError(
    new SchemaIssue.InvalidValue(Option.some(value), { message }),
  );
}

// Hydration identity for state handles: minted per handle, stable for the
// process, resolvable back to the SAME live handle. Cross-process restore
// resolves the key against the client hydration registry once M10 item 4's
// adapter wires it; in-process (SSR tests, same-runtime transfer) the
// registry below is the resolver.
const stateHandleKeys = new WeakMap<object, string>();
const stateHandlesByKey = new Map<string, WeakRef<object>>();
let nextStateHandleOrdinal = 0;

function hydrationKeyOf(handle: object): string {
  const existing = stateHandleKeys.get(handle);
  if (existing !== undefined) return existing;
  const key = `state:h${nextStateHandleOrdinal++}`;
  stateHandleKeys.set(handle, key);
  stateHandlesByKey.set(key, new WeakRef(handle));
  return key;
}

interface SerovalModule {
  readonly toJSON: (value: unknown, options?: { readonly plugins?: ReadonlyArray<unknown> }) => unknown;
  readonly fromJSON: (tree: unknown, options?: { readonly plugins?: ReadonlyArray<unknown> }) => unknown;
  readonly createPlugin: (definition: {
    readonly tag: string;
    readonly test: (value: unknown) => boolean;
    readonly parse: {
      readonly sync?: (value: never, ctx: { readonly parse: (value: unknown) => unknown }) => unknown;
    };
    readonly serialize: (node: never, ctx: unknown) => string;
    readonly deserialize: (node: never, ctx: { readonly deserialize: (node: unknown) => unknown }) => unknown;
  }) => unknown;
  readonly serialize: (value: unknown, options?: { readonly plugins?: ReadonlyArray<unknown> }) => string;
  readonly deserialize: (wire: string) => unknown;
}

/**
 * Live resources are not values: Effect runtime objects brand themselves
 * with `~effect/...` keys (Scope, Fiber, runtime internals), and DOM nodes
 * carry `nodeType`/`nodeName`. Service access crosses the boundary as a
 * typed `R` requirement instead of a payload.
 */
function isLiveResource(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string | symbol, unknown>;
  if (
    typeof record["nodeType"] === "number"
    && typeof record["nodeName"] === "string"
  ) {
    return true;
  }
  for (const key of Reflect.ownKeys(record)) {
    const name = typeof key === "symbol" ? key.description ?? "" : key;
    if (name.startsWith("~effect") || name.startsWith("effect/")) return true;
  }
  return false;
}

function makePlugins(seroval: SerovalModule, modules: CodecModules): ReadonlyArray<unknown> {
  const liveResourceGuard = seroval.createPlugin({
    tag: "af/live-resource-guard",
    test: isLiveResource,
    parse: {
      sync: (value: object) => {
        throw new Error(
          `Live resources (Scope, Fiber, Layer, services, DOM nodes) are not serializable values; found ${Object.prototype.toString.call(value)}. Cross the boundary with a typed R requirement instead.`,
        );
      },
    },
    serialize: () => {
      throw new Error("af/live-resource-guard never serializes.");
    },
    deserialize: () => {
      throw new Error("af/live-resource-guard never deserializes.");
    },
  });
  const stateHandle = seroval.createPlugin({
    tag: "af/state-handle",
    test: modules.isStateHandleValue,
    parse: {
      sync: (value: object) => ({
        kind: "state.hydration-key",
        key: hydrationKeyOf(value),
      }),
    },
    serialize: () => {
      throw new Error("af/state-handle serializes in JSON-tree mode only.");
    },
    deserialize: (node: { readonly key: string }) => {
      const live = stateHandlesByKey.get(node.key)?.deref();
      if (live === undefined) {
        throw new Error(
          `No live state handle is registered for hydration key "${node.key}".`,
        );
      }
      return live;
    },
  });
  const boundCode = seroval.createPlugin({
    tag: "af/bound-code",
    test: (value): boolean => modules.Portable.isBoundCode(value),
    parse: {
      sync: (value: import("./Portable.js").AnyBoundCode) => ({
        descriptor: {
          version: 1,
          kind: "portable.code",
          id: value.code.id,
          buildId: value.code.buildId,
          captures: Schema.encodeUnknownSync(value.code.captures)(value.captures),
        },
      }),
    },
    serialize: () => {
      throw new Error("af/bound-code serializes in JSON-tree mode only.");
    },
    // The descriptor IS the wire form: resolvable via `Portable.resolve`
    // against the client resolver, never a detached structural copy.
    deserialize: (node: { readonly descriptor: unknown }) => node.descriptor,
  });
  const safeHtml = seroval.createPlugin({
    tag: "af/safe-html",
    test: (value): boolean => modules.SafeHtml.isSafeHtml(value),
    parse: {
      sync: (value: import("./SafeHtml.js").SafeHtml) => ({ html: modules.SafeHtml.unwrap(value) }),
    },
    serialize: () => {
      throw new Error("af/safe-html serializes in JSON-tree mode only.");
    },
    // Branding survives the boundary: the value comes back AS SafeHtml, so it
    // neither decays to a string that gets escaped nor gets trusted by
    // accident.
    deserialize: (node: { readonly html: string }) => modules.SafeHtml.make(node.html),
  });
  // Order matters: framework references claim their values BEFORE the guard
  // sees them (a state handle is also `~effect`-branded underneath).
  return [stateHandle, boundCode, safeHtml, liveResourceGuard];
}

function makeSerovalCodec(seroval: SerovalModule, modules: CodecModules): SerializationService {
  const plugins = makePlugins(seroval, modules);
  return {
    id: serovalSerializerId,
    serialize: (schema, value) =>
      Schema.encodeEffect(schema)(value).pipe(
        Effect.flatMap((encoded) =>
          Effect.try({
            try: () => {
              const tree = seroval.toJSON(encoded, { plugins });
              return escapeJsonForHtml(
                JSON.stringify({ [serializerEnvelopeKey]: serovalSerializerId, tree }),
              );
            },
            catch: (cause) =>
              schemaError(
                `Value is not serializable by the seroval codec (live resources — Scope, Fiber, Layer, services, DOM nodes — are not values): ${
                  cause instanceof Error ? cause.message : String(cause)
                }`,
                value,
              ),
          })
        ),
      ),
    deserialize: (schema, wire) =>
      Effect.try({
        try: () => JSON.parse(wire) as { readonly [serializerEnvelopeKey]?: unknown; readonly tree?: unknown },
        catch: (cause) =>
          schemaError(
            `Malformed seroval wire payload: ${cause instanceof Error ? cause.message : String(cause)}`,
            wire,
          ),
      }).pipe(
        Effect.flatMap((parsed) => {
          const stamp = parsed?.[serializerEnvelopeKey];
          if (stamp !== serovalSerializerId) {
            return Effect.fail(
              schemaError(
                `Wire payload was produced by serializer ${JSON.stringify(stamp)}, not "${serovalSerializerId}".`,
                wire,
              ),
            );
          }
          return Effect.try({
            try: () => seroval.fromJSON(parsed.tree, { plugins }),
            catch: (cause) =>
              schemaError(
                `seroval tree restore failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                wire,
              ),
          });
        }),
        Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      ),
  };
}

export interface SerovalOptions {
  /** Only `"json"` is constructible here; see {@link serovalUnsafeEval}. */
  readonly mode?: "json" | "eval";
}

/**
 * Construct the seroval-backed codec layer (JSON-tree mode).
 *
 * Asking for eval mode through this door THROWS: the manifest must remain
 * inert JSON per the security rules. The explicit opt-in is
 * {@link serovalUnsafeEval}, whose name carries the warning (`DQ-012`).
 */
export function seroval(options: SerovalOptions = {}): Layer.Layer<SerializationService> {
  if (options.mode === "eval") {
    throw new Error(
      'seroval eval output mode is prohibited by default: the resume manifest must stay inert JSON. If you accept the CSP cost, use the explicitly named "serovalUnsafeEval" layer instead.',
    );
  }
  return Layer.effect(
    Tag,
    Effect.promise(loadCodecModules).pipe(
      Effect.map(({ seroval: serovalModule, ...modules }) =>
        makeSerovalCodec(serovalModule, modules)
      ),
    ),
  );
}

/**
 * The seroval JSON-tree codec layer. Suspended: this module and
 * `Serialization.ts` re-export each other, so the Tag must be read at layer
 * BUILD time, after both module bodies have evaluated.
 */
export const serovalLayer: Layer.Layer<SerializationService> = Layer.suspend(
  () => seroval(),
);

/**
 * seroval's EVAL-STRING output mode, deliberately named to carry its cost:
 * payloads deserialize by evaluating server-produced JavaScript, which
 * requires `unsafe-eval`/`unsafe-inline` under CSP and moves the payload
 * outside the inert-JSON trust story. Its serializer id differs from the
 * JSON layer's, so a manifest produced here can never be decoded by the safe
 * codec by accident (`DQ-012`'s gate).
 */
export const serovalUnsafeEval: Layer.Layer<SerializationService> = Layer.suspend(() => Layer.effect(
  Tag,
  Effect.promise(() => import("seroval")).pipe(
    Effect.map((module) => {
      const api = module as unknown as SerovalModule;
      const codec: SerializationService = {
        id: serovalUnsafeEvalSerializerId,
        serialize: (schema, value) =>
          Schema.encodeEffect(schema)(value).pipe(
            Effect.flatMap((encoded) =>
              Effect.try({
                try: () =>
                  escapeJsonForHtml(
                    JSON.stringify({
                      [serializerEnvelopeKey]: serovalUnsafeEvalSerializerId,
                      code: api.serialize(encoded),
                    }),
                  ),
                catch: (cause) =>
                  schemaError(
                    `Value is not serializable: ${cause instanceof Error ? cause.message : String(cause)}`,
                    value,
                  ),
              })
            ),
          ),
        deserialize: (schema, wire) =>
          Effect.try({
            try: () => {
              const parsed = JSON.parse(wire) as {
                readonly [serializerEnvelopeKey]?: unknown;
                readonly code?: unknown;
              };
              if (parsed?.[serializerEnvelopeKey] !== serovalUnsafeEvalSerializerId) {
                throw new Error(
                  `Wire payload was produced by serializer ${JSON.stringify(parsed?.[serializerEnvelopeKey])}.`,
                );
              }
              return api.deserialize(String(parsed.code));
            },
            catch: (cause) =>
              schemaError(
                `seroval eval restore failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                wire,
              ),
          }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema))),
      };
      return codec;
    }),
  ),
));
