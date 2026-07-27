import { Effect, Layer, Schema, ServiceMap } from "effect";

export const CodeTypeId: unique symbol = Symbol.for("effect-atom-jsx/Portable/Code");
export const BoundCodeTypeId: unique symbol = Symbol.for("effect-atom-jsx/Portable/BoundCode");
export const ExecutableInspectionTypeId: unique symbol = Symbol.for(
  "effect-atom-jsx/Portable/ExecutableInspection",
);

/** Stable logical code identity. This is an address, never executable source. */
export const CodeId = Schema.String
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("@effect-atom-jsx/Portable/CodeId"));
export type CodeId = typeof CodeId.Type;

/** Deployment/build identity used to reject stale manifests. */
export const BuildId = Schema.String
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("@effect-atom-jsx/Portable/BuildId"));
export type BuildId = typeof BuildId.Type;

export class PortableCodeNotFoundError
  extends Schema.TaggedErrorClass<PortableCodeNotFoundError>(
    "@effect-atom-jsx/PortableCodeNotFoundError",
  )("PortableCodeNotFoundError", {
    id: CodeId,
    reason: Schema.String,
  })
{
  override get message(): string {
    return this.reason;
  }
}

export class PortableCodeLoadError
  extends Schema.TaggedErrorClass<PortableCodeLoadError>(
    "@effect-atom-jsx/PortableCodeLoadError",
  )("PortableCodeLoadError", {
    id: CodeId,
    reason: Schema.String,
  })
{
  override get message(): string {
    return this.reason;
  }
}

export class PortableCodeIdentityMismatchError
  extends Schema.TaggedErrorClass<PortableCodeIdentityMismatchError>(
    "@effect-atom-jsx/PortableCodeIdentityMismatchError",
  )("PortableCodeIdentityMismatchError", {
    requested: CodeId,
    loaded: CodeId,
    reason: Schema.String,
  })
{
  override get message(): string {
    return this.reason;
  }
}

export class PortableBuildMismatchError
  extends Schema.TaggedErrorClass<PortableBuildMismatchError>(
    "@effect-atom-jsx/PortableBuildMismatchError",
  )("PortableBuildMismatchError", {
    id: CodeId,
    expected: BuildId,
    actual: BuildId,
    reason: Schema.String,
  })
{
  override get message(): string {
    return this.reason;
  }
}

export class PortableCaptureEncodeError
  extends Schema.TaggedErrorClass<PortableCaptureEncodeError>(
    "@effect-atom-jsx/PortableCaptureEncodeError",
  )("PortableCaptureEncodeError", {
    id: CodeId,
    reason: Schema.String,
  })
{
  override get message(): string {
    return this.reason;
  }
}

export class PortableCaptureDecodeError
  extends Schema.TaggedErrorClass<PortableCaptureDecodeError>(
    "@effect-atom-jsx/PortableCaptureDecodeError",
  )("PortableCaptureDecodeError", {
    id: CodeId,
    reason: Schema.String,
  })
{
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
  readonly run: (
    captures: Captures,
    ...args: Args
  ) => Effect.Effect<A, E, R>;
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
  readonly run: (
    captures: Captures,
    ...args: Args
  ) => Effect.Effect<A, E, R>;
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

export type AnyBoundCode = BoundCode<any, any, ReadonlyArray<any>, any, any, any>;

export type ExecutableInspection<
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
> =
  | {
    readonly kind: "portable";
    readonly executable: BoundCode<any, any, Args, A, E, R>;
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
  readonly [ExecutableInspectionTypeId]: () => ExecutableInspection<Args, A, E, R>;
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
  return (typeof value === "object" || typeof value === "function")
    && value !== null
    && (value as Partial<AnyBoundCode>)[BoundCodeTypeId] === BoundCodeTypeId;
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

export function inspectExecutable<
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
>(
  value: InspectableExecutable<Args, A, E, R>,
): ExecutableInspection<Args, A, E, R>;
export function inspectExecutable(
  value: unknown,
): ExecutableInspection<ReadonlyArray<unknown>, unknown, unknown, unknown>;
export function inspectExecutable(
  value: unknown,
): ExecutableInspection<ReadonlyArray<unknown>, unknown, unknown, unknown> {
  if (
    (typeof value === "object" || typeof value === "function")
    && value !== null
    && ExecutableInspectionTypeId in value
  ) {
    return (value as InspectableExecutable<
      ReadonlyArray<unknown>,
      unknown,
      unknown,
      unknown
    >)[ExecutableInspectionTypeId]();
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
  return Schema.encodeEffect(executable.code.captures)(executable.captures).pipe(
    Effect.flatMap((captures) => {
      const issue = jsonValueIssue(captures);
      return issue === undefined
        ? Effect.succeed({
          version: 1 as const,
          kind: "portable.code" as const,
          id: executable.code.id,
          buildId: executable.code.buildId,
          captures,
        })
        : Effect.fail(new PortableCaptureEncodeError({
          id: executable.code.id,
          reason: issue,
        }));
    }),
    Effect.catch((error) =>
      Effect.fail(new PortableCaptureEncodeError({
        id: executable.code.id,
        reason: String(error),
      }))
    ),
  );
}

export function decodeDescriptor(
  input: unknown,
): Effect.Effect<Descriptor, Schema.SchemaError> {
  return Schema.decodeUnknownEffect(DescriptorSchema)(input);
}

export type CodeLoader = () => Effect.Effect<AnyCode, PortableCodeLoadError>;

export interface ResolverService {
  readonly load: (
    id: CodeId,
  ) => Effect.Effect<
    AnyCode,
    PortableCodeNotFoundError | PortableCodeLoadError
  >;
}

export const Resolver = ServiceMap.Service<ResolverService>(
  "effect-atom-jsx/Portable/Resolver",
);

export type ResolverEntries = Readonly<
  Record<string, AnyCode | CodeLoader>
>;

/**
 * Build one resolver instance. Lazy loaders are memoized within the instance so
 * concurrent or repeated events share the same module request.
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
      const load = typeof entry === "function"
        ? yield* Effect.cached(entry())
        : Effect.succeed(entry);
      resolvedEntries.set(id, load);
    }
    return {
      load: (id) => {
        const load = resolvedEntries.get(id);
        if (load === undefined) {
          return Effect.fail(new PortableCodeNotFoundError({
            id,
            reason: `No portable code is registered for "${id}".`,
          }));
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

export interface ResolvedCode<
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
> {
  readonly id: CodeId;
  readonly buildId: BuildId;
  readonly run: (...args: Args) => Effect.Effect<A, E, R>;
}

export function resolve<
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
>(
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
      return yield* Effect.fail(new PortableCodeIdentityMismatchError({
        requested: descriptor.id,
        loaded: definition.id,
        reason: `Portable code "${descriptor.id}" resolved to "${definition.id}".`,
      }));
    }
    if (definition.buildId !== descriptor.buildId) {
      return yield* Effect.fail(new PortableBuildMismatchError({
        id: descriptor.id,
        expected: definition.buildId,
        actual: descriptor.buildId,
        reason: `Portable code "${descriptor.id}" belongs to a different build.`,
      }));
    }
    const captures = yield* Schema.decodeUnknownEffect(
      definition.captures,
    )(descriptor.captures).pipe(
      Effect.catch((error) =>
        Effect.fail(new PortableCaptureDecodeError({
          id: descriptor.id,
          reason: String(error),
        }))
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
  decodeDescriptor,
  makeResolver,
  resolverLayer,
  resolve,
} as const;

function jsonValueIssue(value: unknown): string | undefined {
  const seen = new WeakSet<object>();
  const visit = (current: unknown, path: string): string | undefined => {
    if (
      current === null
      || typeof current === "string"
      || typeof current === "boolean"
    ) {
      return undefined;
    }
    if (typeof current === "number") {
      return Number.isFinite(current)
        ? undefined
        : `Portable capture ${path} must be a finite JSON number.`;
    }
    if (typeof current !== "object") {
      return `Portable capture ${path} is not JSON-safe (${typeof current}).`;
    }
    if (seen.has(current)) {
      return `Portable capture ${path} contains a cycle.`;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        const issue = visit(current[index], `${path}[${index}]`);
        if (issue !== undefined) {
          seen.delete(current);
          return issue;
        }
      }
      seen.delete(current);
      return undefined;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      seen.delete(current);
      return `Portable capture ${path} must encode to a plain JSON object.`;
    }
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") {
        seen.delete(current);
        return `Portable capture ${path} contains a symbol key.`;
      }
      const issue = visit(
        (current as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
      if (issue !== undefined) {
        seen.delete(current);
        return issue;
      }
    }
    seen.delete(current);
    return undefined;
  };
  try {
    return visit(value, "$");
  } catch (error) {
    return `Portable captures could not be inspected as JSON: ${String(error)}`;
  }
}
