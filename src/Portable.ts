import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Ref,
  Schema,
} from "effect";
import { jsonValueIssue } from "./wire-json.js";
import * as Serialization from "./serialization-core.js";
import { makeResourceCacheIdentity } from "./cache-identity.js";

export const CodeTypeId: unique symbol = Symbol.for(
  "effect-atom-jsx/Portable/Code",
);
export const BoundCodeTypeId: unique symbol = Symbol.for(
  "effect-atom-jsx/Portable/BoundCode",
);
export const ExecutableInspectionTypeId: unique symbol = Symbol.for(
  "effect-atom-jsx/Portable/ExecutableInspection",
);

/** Stable logical code identity. This is an address, never executable source. */
export const CodeId = Schema.String.check(Schema.isNonEmpty()).pipe(
  Schema.brand("@effect-atom-jsx/Portable/CodeId"),
);
export type CodeId = typeof CodeId.Type;

/** Deployment/build identity used to reject stale manifests. */
export const BuildId = Schema.String.check(Schema.isNonEmpty()).pipe(
  Schema.brand("@effect-atom-jsx/Portable/BuildId"),
);
export type BuildId = typeof BuildId.Type;

export class PortableCodeNotFoundError extends Schema.TaggedErrorClass<PortableCodeNotFoundError>(
  "@effect-atom-jsx/PortableCodeNotFoundError",
)("PortableCodeNotFoundError", {
  id: CodeId,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

export class PortableCodeLoadError extends Schema.TaggedErrorClass<PortableCodeLoadError>(
  "@effect-atom-jsx/PortableCodeLoadError",
)("PortableCodeLoadError", {
  id: CodeId,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

export class PortableCodeIdentityMismatchError extends Schema.TaggedErrorClass<PortableCodeIdentityMismatchError>(
  "@effect-atom-jsx/PortableCodeIdentityMismatchError",
)("PortableCodeIdentityMismatchError", {
  requested: CodeId,
  loaded: CodeId,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

export class PortableBuildMismatchError extends Schema.TaggedErrorClass<PortableBuildMismatchError>(
  "@effect-atom-jsx/PortableBuildMismatchError",
)("PortableBuildMismatchError", {
  id: CodeId,
  expected: BuildId,
  actual: BuildId,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

export class PortableCaptureEncodeError extends Schema.TaggedErrorClass<PortableCaptureEncodeError>(
  "@effect-atom-jsx/PortableCaptureEncodeError",
)("PortableCaptureEncodeError", {
  id: CodeId,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

export class PortableCaptureDecodeError extends Schema.TaggedErrorClass<PortableCaptureDecodeError>(
  "@effect-atom-jsx/PortableCaptureDecodeError",
)("PortableCaptureDecodeError", {
  id: CodeId,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

export type ResolutionError =
  | PortableCodeNotFoundError
  | PortableCodeLoadError
  | PortableCodeIdentityMismatchError
  | PortableBuildMismatchError
  | PortableCaptureDecodeError;

export interface Code<
  Captures,
  EncodedCaptures,
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
> {
  readonly [CodeTypeId]: typeof CodeTypeId;
  readonly id: CodeId;
  readonly buildId: BuildId;
  readonly captures: Schema.Codec<Captures, EncodedCaptures>;
  readonly run: (captures: Captures, ...args: Args) => Effect.Effect<A, E, R>;
}

export type AnyCode = Code<any, any, ReadonlyArray<any>, any, any, any>;

export interface CodeOptions<
  Captures,
  EncodedCaptures,
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
> {
  readonly id: string;
  readonly buildId: string;
  readonly captures: Schema.Codec<Captures, EncodedCaptures>;
  readonly run: (captures: Captures, ...args: Args) => Effect.Effect<A, E, R>;
}

/**
 * Define an addressable executable exported by an independently loadable
 * module. The returned value is runtime code, not a wire descriptor.
 */
export function code<
  Captures,
  EncodedCaptures,
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
>(
  options: CodeOptions<Captures, EncodedCaptures, Args, A, E, R>,
): Code<Captures, EncodedCaptures, Args, A, E, R> {
  const definition: Code<Captures, EncodedCaptures, Args, A, E, R> = {
    [CodeTypeId]: CodeTypeId,
    id: Schema.decodeUnknownSync(CodeId)(options.id),
    buildId: Schema.decodeUnknownSync(BuildId)(options.buildId),
    captures: options.captures,
    run: options.run,
  };
  return Object.freeze(definition);
}

export interface BoundCode<
  Captures,
  EncodedCaptures,
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
> extends InspectableExecutable<Args, A, E, R> {
  readonly [BoundCodeTypeId]: typeof BoundCodeTypeId;
  readonly code: Code<Captures, EncodedCaptures, Args, A, E, R>;
  readonly captures: Captures;
}

export type AnyBoundCode = BoundCode<
  any,
  any,
  ReadonlyArray<any>,
  any,
  any,
  any
>;

export type ExecutableInspection<
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
> =
  | {
      readonly kind: "portable";
      readonly executable: BoundCode<any, any, Args, A, E, R>;
      readonly execution?:
        | {
            readonly kind: "component-action";
            readonly hasReactivityKeys: boolean;
            readonly hasTransitionObserver: boolean;
            readonly concurrency?:
              | "switch"
              | "queue"
              | "drop"
              | {
                  readonly max: number;
                };
            readonly detached: boolean;
          }
        | {
            readonly kind: "component-query";
            readonly hasRetry: boolean;
            readonly hasPoll: boolean;
            readonly reactivityKeys: ReadonlyArray<string>;
          };
    }
  | {
      readonly kind: "opaque";
    };

export interface InspectableExecutable<
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
> {
  readonly [ExecutableInspectionTypeId]: () => ExecutableInspection<
    Args,
    A,
    E,
    R
  >;
}

export function bind<
  Captures,
  EncodedCaptures,
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
>(
  definition: Code<Captures, EncodedCaptures, Args, A, E, R>,
  captures: Captures,
): BoundCode<Captures, EncodedCaptures, Args, A, E, R> {
  const bound = {
    [BoundCodeTypeId]: BoundCodeTypeId,
    code: definition,
    captures,
  } as BoundCode<Captures, EncodedCaptures, Args, A, E, R>;
  Object.defineProperty(bound, ExecutableInspectionTypeId, {
    enumerable: false,
    value: () => ({ kind: "portable", executable: bound }),
  });
  return Object.freeze(bound);
}

export function isBoundCode(value: unknown): value is AnyBoundCode {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    (value as Partial<AnyBoundCode>)[BoundCodeTypeId] === BoundCodeTypeId
  );
}

export function execute<
  Captures,
  EncodedCaptures,
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
>(
  executable: BoundCode<Captures, EncodedCaptures, Args, A, E, R>,
  ...args: Args
): Effect.Effect<A, E, R> {
  return executable.code.run(executable.captures, ...args);
}

export function annotateExecutable<
  Target extends object,
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
>(
  target: Target,
  inspection: ExecutableInspection<Args, A, E, R>,
): Target & InspectableExecutable<Args, A, E, R> {
  Object.defineProperty(target, ExecutableInspectionTypeId, {
    enumerable: false,
    value: () => inspection,
  });
  return target as Target & InspectableExecutable<Args, A, E, R>;
}

export function inspectExecutable<Args extends ReadonlyArray<unknown>, A, E, R>(
  value: InspectableExecutable<Args, A, E, R>,
): ExecutableInspection<Args, A, E, R>;
export function inspectExecutable(
  value: unknown,
): ExecutableInspection<ReadonlyArray<unknown>, unknown, unknown, unknown>;
export function inspectExecutable(
  value: unknown,
): ExecutableInspection<ReadonlyArray<unknown>, unknown, unknown, unknown> {
  if (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    ExecutableInspectionTypeId in value
  ) {
    return (
      value as InspectableExecutable<
        ReadonlyArray<unknown>,
        unknown,
        unknown,
        unknown
      >
    )[ExecutableInspectionTypeId]();
  }
  return { kind: "opaque" };
}

export const DescriptorSchema = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("portable.code"),
  id: CodeId,
  buildId: BuildId,
  captures: Schema.Unknown,
});

type DescriptorValue = typeof DescriptorSchema.Type;

export interface Descriptor<
  Args extends ReadonlyArray<unknown> = ReadonlyArray<unknown>,
  A = unknown,
  E = unknown,
  R = unknown,
> extends DescriptorValue {
  readonly "~types"?: {
    readonly Args: Args;
    readonly A: A;
    readonly E: E;
    readonly R: R;
  };
}

/**
 * Derive the canonical cache identity for one portable descriptor.
 *
 * The descriptor supplies the executable identity axes and the canonical
 * reactivity keys supply its invalidation identity. Cache lookup and
 * single-flight coordination must use this same derived key; it is never
 * duplicated in a wire manifest.
 */
export function cacheKey(
  descriptor: Descriptor,
  reactivityKeys: ReadonlyArray<string> = [],
): string {
  const resourceId =
    `${descriptor.kind}:${descriptor.version}:${descriptor.buildId}:${descriptor.id}`;
  const canonicalReactivityKeys = [...new Set(reactivityKeys)].sort();
  return makeResourceCacheIdentity(resourceId, {
    captures: descriptor.captures,
    reactivityKeys: canonicalReactivityKeys,
  }).key;
}

/**
 * Marker wrapping rich captures encoded by a universal codec (M10 items 1-2):
 * when a capture is not plain JSON (a `Map`, a cycle — what `extract.auto`
 * infers) and a non-default `Serialization` layer is present, the captures
 * ride the descriptor as this codec-stamped envelope instead of failing the
 * plain-JSON gate. The stamp is the layer id, so a resolver configured with
 * a different codec fails closed instead of misdecoding (`DQ-012`).
 */
interface EncodedCapturesEnvelope {
  readonly $afCapturesCodec: string;
  readonly wire: string;
}

function isEncodedCapturesEnvelope(value: unknown): value is EncodedCapturesEnvelope {
  return (
    typeof value === "object"
    && value !== null
    && typeof (value as Partial<EncodedCapturesEnvelope>).$afCapturesCodec === "string"
    && typeof (value as Partial<EncodedCapturesEnvelope>).wire === "string"
  );
}

export function describe<
  Captures,
  EncodedCaptures,
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
>(
  executable: BoundCode<Captures, EncodedCaptures, Args, A, E, R>,
): Effect.Effect<Descriptor<Args, A, E, R>, PortableCaptureEncodeError> {
  return Schema.encodeEffect(executable.code.captures)(
    executable.captures,
  ).pipe(
    Effect.flatMap((captures) => {
      const issue = jsonValueIssue(captures, "Portable capture");
      if (issue === undefined) {
        return Effect.succeed({
          version: 1 as const,
          kind: "portable.code" as const,
          id: executable.code.id,
          buildId: executable.code.buildId,
          captures,
        });
      }
      // Not plain JSON: fall back to the universal codec when one is
      // configured. The default schema codec cannot carry these values any
      // better than the gate above, so it does not qualify — the typed-wire
      // guarantee degrades to runtime-validated ONLY under an explicitly
      // provided universal layer.
      return Effect.serviceOption(Serialization.Tag).pipe(
        Effect.flatMap((service) => {
          if (
            service._tag !== "Some"
            || service.value.id === Serialization.defaultSerializerId
          ) {
            return Effect.fail(
              new PortableCaptureEncodeError({
                id: executable.code.id,
                reason: issue,
              }),
            );
          }
          const codec = service.value;
          return codec.serialize(Schema.Unknown, captures).pipe(
            Effect.map((wire) => ({
              version: 1 as const,
              kind: "portable.code" as const,
              id: executable.code.id,
              buildId: executable.code.buildId,
              // The envelope stands in for the schema-encoded form on the
              // wire; `resolve` unwraps it back to that form before the
              // schema decode, so the type-level `EncodedCaptures` claim
              // holds at every point captures are actually consumed.
              captures: ({
                $afCapturesCodec: codec.id,
                wire,
              } satisfies EncodedCapturesEnvelope) as unknown as EncodedCaptures,
            })),
            Effect.catchTag("SchemaError", (error) =>
              Effect.fail(
                new PortableCaptureEncodeError({
                  id: executable.code.id,
                  reason: `Universal codec "${codec.id}" could not encode the captures: ${String(error)}`,
                }),
              ),
            ),
          );
        }),
      );
    }),
    Effect.catchTag("SchemaError", (error) =>
      Effect.fail(
        new PortableCaptureEncodeError({
          id: executable.code.id,
          reason: String(error),
        }),
      ),
    ),
  );
}

export function decodeDescriptor(
  input: unknown,
): Effect.Effect<Descriptor, Schema.SchemaError> {
  return Schema.decodeUnknownEffect(DescriptorSchema)(input);
}

/**
 * Effect-native lazy code loader.
 *
 * Loader failures and defects are normalized to `PortableCodeLoadError` at
 * the resolver boundary, so dynamic imports can use `Effect.tryPromise`
 * without hand-authoring protocol errors.
 */
export type CodeLoader = () => Effect.Effect<AnyCode, unknown>;

export interface ResolverService {
  readonly load: (
    id: CodeId,
  ) => Effect.Effect<
    AnyCode,
    PortableCodeNotFoundError | PortableCodeLoadError
  >;
}

export const Resolver = Context.Service<ResolverService>(
  "effect-atom-jsx/Portable/Resolver",
);

export type ResolverEntries = Readonly<Record<string, AnyCode | CodeLoader>>;

/**
 * Build one resolver instance. Concurrent callers share one loader attempt;
 * successful code is retained for the resolver lifetime, while a failed
 * attempt returns to idle so a later interaction can retry.
 */
export function makeResolver(
  entries: ResolverEntries,
): Effect.Effect<ResolverService> {
  return Effect.gen(function* () {
    const resolvedEntries = new Map<
      string,
      Effect.Effect<AnyCode, PortableCodeLoadError>
    >();
    for (const [id, entry] of Object.entries(entries)) {
      if (typeof entry !== "function") {
        resolvedEntries.set(id, Effect.succeed(entry));
        continue;
      }
      const attempt: Effect.Effect<AnyCode, PortableCodeLoadError> = Effect.try({
        try: entry,
        catch: (error) =>
          new PortableCodeLoadError({
            id: id as CodeId,
            reason: `Portable code "${id}" loader threw before returning an Effect: ${String(error)}`,
        }),
      }).pipe(
        Effect.flatten,
        Effect.mapError((error) =>
          error instanceof PortableCodeLoadError
            ? error
            : new PortableCodeLoadError({
                id: id as CodeId,
                reason: `Portable code "${id}" loader failed: ${String(error)}`,
              })
        ),
        Effect.catchDefect((defect) =>
          Effect.fail(
            new PortableCodeLoadError({
              id: id as CodeId,
              reason: `Portable code "${id}" loader failed unexpectedly: ${String(defect)}`,
            }),
          ),
        ),
      );
      type LoaderState =
        | { readonly _tag: "Idle" }
        | {
            readonly _tag: "Loading";
            readonly deferred: Deferred.Deferred<
              AnyCode,
              PortableCodeLoadError
            >;
          }
        | { readonly _tag: "Loaded"; readonly code: AnyCode };
      type LoaderDecision =
        | {
            readonly _tag: "Await";
            readonly effect: Effect.Effect<
              AnyCode,
              PortableCodeLoadError
            >;
          }
        | {
            readonly _tag: "Load";
            readonly deferred: Deferred.Deferred<
              AnyCode,
              PortableCodeLoadError
            >;
          }
        | { readonly _tag: "Loaded"; readonly code: AnyCode };
      const state = yield* Ref.make<LoaderState>({ _tag: "Idle" });
      const load: Effect.Effect<
        AnyCode,
        PortableCodeLoadError
      > = Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const observed = yield* Ref.get(state);
          if (observed._tag === "Loaded") return observed.code;
          if (observed._tag === "Loading") {
            return yield* restore(Deferred.await(observed.deferred));
          }
          const candidate = yield* Deferred.make<
            AnyCode,
            PortableCodeLoadError
          >();
          const decision = yield* Ref.modify(
            state,
            (
              current,
            ): readonly [LoaderDecision, LoaderState] => {
              switch (current._tag) {
                case "Loaded":
                  return [
                    { _tag: "Loaded", code: current.code },
                    current,
                  ];
                case "Loading":
                  return [
                    {
                      _tag: "Await",
                      effect: Deferred.await(current.deferred),
                    },
                    current,
                  ];
                case "Idle":
                  return [
                    { _tag: "Load", deferred: candidate },
                    { _tag: "Loading", deferred: candidate },
                  ];
              }
            },
          );
          if (decision._tag === "Loaded") return decision.code;
          if (decision._tag === "Await") {
            return yield* restore(decision.effect);
          }

          const exit = yield* Effect.exit(restore(attempt));
          yield* Ref.set(
            state,
            Exit.isSuccess(exit)
              ? { _tag: "Loaded", code: exit.value }
              : { _tag: "Idle" },
          );
          yield* Deferred.done(decision.deferred, exit);
          if (Exit.isSuccess(exit)) return exit.value;
          return yield* Effect.failCause(exit.cause);
        })
      );
      resolvedEntries.set(id, load);
    }
    return {
      load: (id) => {
        const load = resolvedEntries.get(id);
        if (load === undefined) {
          return Effect.fail(
            new PortableCodeNotFoundError({
              id,
              reason: `No portable code is registered for "${id}".`,
            }),
          );
        }
        return load;
      },
    };
  });
}

export function resolverLayer(
  entries: ResolverEntries,
): Layer.Layer<ResolverService> {
  return Layer.effect(Resolver)(makeResolver(entries));
}

export interface ResolvedCode<Args extends ReadonlyArray<unknown>, A, E, R> {
  readonly id: CodeId;
  readonly buildId: BuildId;
  readonly run: (...args: Args) => Effect.Effect<A, E, R>;
}

export function resolve<Args extends ReadonlyArray<unknown>, A, E, R>(
  descriptor: Descriptor<Args, A, E, R>,
): Effect.Effect<
  ResolvedCode<Args, A, E, R>,
  ResolutionError,
  ResolverService
> {
  return Effect.gen(function* () {
    const resolver = yield* Resolver;
    const definition = yield* resolver.load(descriptor.id);
    if (definition.id !== descriptor.id) {
      return yield* new PortableCodeIdentityMismatchError({
        requested: descriptor.id,
        loaded: definition.id,
        reason: `Portable code "${descriptor.id}" resolved to "${definition.id}".`,
      });
    }
    if (definition.buildId !== descriptor.buildId) {
      return yield* new PortableBuildMismatchError({
        id: descriptor.id,
        expected: definition.buildId,
        actual: descriptor.buildId,
        reason: `Portable code "${descriptor.id}" belongs to a different build.`,
      });
    }
    let rawCaptures: unknown = descriptor.captures;
    if (isEncodedCapturesEnvelope(rawCaptures)) {
      const service = yield* Effect.serviceOption(Serialization.Tag);
      if (
        service._tag !== "Some"
        || service.value.id !== rawCaptures.$afCapturesCodec
      ) {
        return yield* new PortableCaptureDecodeError({
          id: descriptor.id,
          reason: `Captures were encoded by serializer "${rawCaptures.$afCapturesCodec}", but this resolver's Serialization layer is ${
            service._tag === "Some" ? `"${service.value.id}"` : "absent"
          }; refusing to misdecode.`,
        });
      }
      rawCaptures = yield* service.value
        .deserialize(Schema.Unknown, rawCaptures.wire)
        .pipe(
          Effect.catchTag("SchemaError", (error) =>
            Effect.fail(
              new PortableCaptureDecodeError({
                id: descriptor.id,
                reason: `Universal codec restore failed: ${String(error)}`,
              }),
            ),
          ),
        );
    }
    const captures = yield* Schema.decodeUnknownEffect(definition.captures)(
      rawCaptures,
    ).pipe(
      Effect.catchTag("SchemaError", (error) =>
        Effect.fail(
          new PortableCaptureDecodeError({
            id: descriptor.id,
            reason: String(error),
          }),
        ),
      ),
    );
    return {
      id: definition.id,
      buildId: definition.buildId,
      run: (...args: Args) =>
        definition.run(captures, ...args) as Effect.Effect<A, E, R>,
    };
  });
}

export const Portable = {
  CodeTypeId,
  BoundCodeTypeId,
  ExecutableInspectionTypeId,
  CodeId,
  BuildId,
  DescriptorSchema,
  Resolver,
  code,
  bind,
  execute,
  isBoundCode,
  inspectExecutable,
  describe,
  cacheKey,
  decodeDescriptor,
  makeResolver,
  resolverLayer,
  resolve,
} as const;
