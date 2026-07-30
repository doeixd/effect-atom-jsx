import { Effect, Schema } from "effect";
import * as Portable from "./Portable.js";
import {
  isReactivityKeyWitness,
  type ReactivityKeyInput,
} from "./reactivity-runtime.js";
import {
  HandleInspectionTypeId,
  type InspectableStateHandle,
} from "./resume-handle.js";

export const ExpressionTypeId: unique symbol = Symbol.for(
  "effect-atom-jsx/Resume/Expression",
);
export const ExpressionRenderTypeId: unique symbol = Symbol.for(
  "effect-atom-jsx/Resume/ExpressionRender",
);
export const ExpressionDependenciesSchemaTypeId: unique symbol = Symbol.for(
  "effect-atom-jsx/Resume/ExpressionDependenciesSchema",
);

/**
 * The authored return type of a resumable expression.
 *
 * `null` and `undefined` both mean **absence**: during SSR nothing is written,
 * and during a client patch the attribute/class/style property is removed. This
 * matches the ordinary null-safe DOM helpers exactly (see
 * `docs/RESUMABILITY_M8C_PLAN.md`, `DQ-002`). The empty string is a *value*, not
 * an absence.
 *
 * An expression's output never crosses the wire — the dormant client loads the
 * expression's own code and computes the value locally — so widening this type
 * needs no manifest field and no manifest version bump.
 */
export type ExpressionOutput = string | number | null | undefined;

/**
 * Installation-only marker listing the resumable expression instances attached
 * to one host element. Removed once the marker/manifest bijection is validated.
 */
export const ExpressionElementMarkerAttributeName = "data-af-expr";

/**
 * Conservative first-slice element target names. URL-bearing/event attributes,
 * URL-capable style properties, DOM properties, and HTML injection sinks remain
 * intentionally outside the portable protocol.
 *
 * These arrays are the single source of truth shared by the SSR registrar in
 * `resume-session.ts` and the wire schemas in `Resume.ts`; the latter asserts
 * coverage at compile time.
 */
export const ExpressionAttributeNames = [
  "aria-description",
  "aria-label",
  "aria-valuetext",
  "data-state",
  "data-status",
  "title",
] as const;

export const ExpressionNamedStylePropertyNames = [
  "background-color",
  "color",
  "display",
  "height",
  "opacity",
  "transform",
  "visibility",
  "width",
] as const;

export const ExpressionCustomStylePropertyPattern = /^--[a-z][a-z0-9-]*$/;

export function isExpressionAttributeName(name: string): boolean {
  return (ExpressionAttributeNames as ReadonlyArray<string>).includes(name);
}

export function isExpressionStylePropertyName(name: string): boolean {
  return (
    (ExpressionNamedStylePropertyNames as ReadonlyArray<string>).includes(name)
    || ExpressionCustomStylePropertyPattern.test(name)
  );
}

/**
 * The discriminated patch target recorded for one rendered expression instance.
 * Structurally identical to the v4 wire target; `Resume.ts` owns the branded
 * schema, this module owns the renderer-facing shape.
 */
export type ExpressionTargetValue =
  | { readonly kind: "text" }
  | { readonly kind: "attribute"; readonly name: string }
  | { readonly kind: "class" }
  | { readonly kind: "style-property"; readonly name: string };
export type ExpressionDependency<A = unknown> =
  | InspectableStateHandle<A>
  | (undefined extends A ? ReactivityKeyInput : never);
export type ExpressionDependenciesInput<
  Dependencies extends ReadonlyArray<unknown> = ReadonlyArray<unknown>,
> = {
  readonly [Index in keyof Dependencies]: ExpressionDependency<
    Dependencies[Index]
  >;
};

export interface ExpressionContext {
  /** Schema-encoded dependency values in manifest `inputs` order. */
  readonly values: ReadonlyArray<unknown>;
}

export class ExpressionDependencyDecodeError extends Schema.TaggedErrorClass<ExpressionDependencyDecodeError>(
  "@effect-atom-jsx/ExpressionDependencyDecodeError",
)("ExpressionDependencyDecodeError", {
  codeId: Portable.CodeId,
  message: Schema.String,
}) {}

export interface ExpressionCode<
  Captures,
  EncodedCaptures,
  Dependencies extends ReadonlyArray<unknown>,
  EncodedDependencies,
  A extends ExpressionOutput,
>
  extends Portable.Code<
    Captures,
    EncodedCaptures,
    readonly [context: ExpressionContext],
    A,
    ExpressionDependencyDecodeError,
    never
  >
{
  readonly [ExpressionDependenciesSchemaTypeId]:
    Schema.Codec<Dependencies, EncodedDependencies>;
  readonly [ExpressionRenderTypeId]: (
    captures: Captures,
    dependencies: Dependencies,
  ) => A;
}

export interface ExpressionCodeOptions<
  Captures,
  EncodedCaptures,
  Dependencies extends ReadonlyArray<unknown>,
  EncodedDependencies,
  A extends ExpressionOutput,
> {
  readonly id: string;
  readonly buildId: string;
  readonly captures: Schema.Codec<Captures, EncodedCaptures>;
  readonly dependencies: Schema.Codec<Dependencies, EncodedDependencies>;
  readonly render: (captures: Captures, dependencies: Dependencies) => A;
}

export interface ExpressionInspection<A extends ExpressionOutput = ExpressionOutput> {
  readonly executable: Portable.BoundCode<
    any,
    any,
    readonly [context: ExpressionContext],
    A,
    ExpressionDependencyDecodeError,
    never
  >;
  readonly deps: ReadonlyArray<ExpressionDependency>;
  /**
   * Validate the schema-encoded dependency snapshot that the dormant client
   * will receive. Collection uses this before publishing a manifest, catching
   * mismatches between a state snapshot codec and the expression dependency
   * codec on the server rather than at first interaction.
   */
  readonly validateDependencies: (
    values: ReadonlyArray<unknown>,
  ) => Effect.Effect<void, ExpressionDependencyDecodeError>;
}

export interface ResumableExpression<A extends ExpressionOutput = ExpressionOutput> {
  (): A;
  readonly [ExpressionTypeId]: () => ExpressionInspection<A>;
}

const creationObservers = new Set<
  (expression: ResumableExpression) => void
>();

function decodeExpressionDependencies<
  Dependencies extends ReadonlyArray<unknown>,
  EncodedDependencies,
>(
  codeId: Portable.CodeId,
  schema: Schema.Codec<Dependencies, EncodedDependencies>,
  values: ReadonlyArray<unknown>,
): Effect.Effect<Dependencies, ExpressionDependencyDecodeError> {
  return Schema.decodeUnknownEffect(schema)(values).pipe(
    Effect.catchTag("SchemaError", (error) =>
      Effect.fail(
        new ExpressionDependencyDecodeError({
          codeId,
          message: `Expression "${codeId}" dependency decoding failed: ${String(error)}`,
        }),
      ),
    ),
  );
}

/**
 * Compiler runtime helper. Generated modules export this value through the
 * same resolver-entry path as every other portable code definition.
 *
 * The synchronous render function is retained only for the original SSR pass.
 * Resolved client execution uses the Effect-returning `run` field.
 *
 * @internal
 */
export function expressionCode<
  Captures,
  EncodedCaptures,
  Dependencies extends ReadonlyArray<unknown>,
  EncodedDependencies,
  A extends ExpressionOutput,
>(
  options: ExpressionCodeOptions<
    Captures,
    EncodedCaptures,
    Dependencies,
    EncodedDependencies,
    A
  >,
): ExpressionCode<
  Captures,
  EncodedCaptures,
  Dependencies,
  EncodedDependencies,
  A
> {
  const codeId = Schema.decodeUnknownSync(Portable.CodeId)(options.id);
  const definition = Portable.code({
    id: options.id,
    buildId: options.buildId,
    captures: options.captures,
    run: (captures: Captures, context: ExpressionContext) =>
      decodeExpressionDependencies(
        codeId,
        options.dependencies,
        context.values,
      ).pipe(
        Effect.map((dependencies) =>
          options.render(captures, dependencies)
        ),
      ),
  });
  return Object.freeze({
    ...definition,
    [ExpressionDependenciesSchemaTypeId]: options.dependencies,
    [ExpressionRenderTypeId]: options.render,
  }) as ExpressionCode<
    Captures,
    EncodedCaptures,
    Dependencies,
    EncodedDependencies,
    A
  >;
}

/**
 * Compiler runtime helper that binds serializable captures and canonical
 * semantic dependencies while preserving a synchronous SSR accessor.
 *
 * @internal
 */
export function bindExpression<
  Captures,
  EncodedCaptures,
  Dependencies extends ReadonlyArray<unknown>,
  EncodedDependencies,
  A extends ExpressionOutput,
>(
  definition: ExpressionCode<
    Captures,
    EncodedCaptures,
    Dependencies,
    EncodedDependencies,
    A
  >,
  captures: Captures,
  deps: ExpressionDependenciesInput<Dependencies>,
): ResumableExpression<A> {
  const executable = Portable.bind(definition, captures);
  const orderedDeps: Array<ExpressionDependency> = [];
  const readDependencies: Array<() => unknown> = [];
  for (const dep of deps) {
    if (
      (typeof dep === "object" || typeof dep === "function")
      && dep !== null
      && HandleInspectionTypeId in dep
    ) {
      const inspection = dep[HandleInspectionTypeId]();
      if (inspection.kind !== "state") {
        throw new TypeError(
          `[effect-atom-jsx] Expression dependencies currently support value-bearing Component.state handles only; received a ${inspection.kind} handle.`,
        );
      }
      orderedDeps.push(dep);
      readDependencies.push(inspection.read);
    } else if (typeof dep === "string" || isReactivityKeyWitness(dep)) {
      orderedDeps.push(dep);
      readDependencies.push(() => undefined);
    } else {
      throw new TypeError(
        "[effect-atom-jsx] Expression dependencies must be reactivity keys or Component.state handles.",
      );
    }
  }
  const frozenDeps = Object.freeze([...orderedDeps]);
  const expression = (() => {
    // Read inside the accessor rather than at bind time. Ordinary active
    // rendering invokes this accessor from its reactive computation, so state
    // handles must participate in normal dependency tracking and always
    // provide their latest values. A fresh positional snapshot also prevents
    // a render callback that retains its tuple from observing later mutation.
    const dependencies = readDependencies.map((read) => read()) as unknown as
      Dependencies;
    return definition[ExpressionRenderTypeId](
      captures,
      dependencies,
    );
  }) as ResumableExpression<A>;
  Object.defineProperty(expression, ExpressionTypeId, {
    enumerable: false,
    value: () => ({
      executable,
      deps: frozenDeps,
      validateDependencies: (values: ReadonlyArray<unknown>) =>
        decodeExpressionDependencies(
          definition.id,
          definition[ExpressionDependenciesSchemaTypeId],
          values,
        ).pipe(Effect.asVoid),
    }),
  });
  Object.freeze(expression);
  for (const observer of creationObservers) {
    observer(expression);
  }
  return expression;
}

export function inspectExpression<A extends ExpressionOutput>(
  value: ResumableExpression<A>,
): ExpressionInspection<A>;
export function inspectExpression(
  value: unknown,
): ExpressionInspection | undefined;
export function inspectExpression(
  value: unknown,
): ExpressionInspection | undefined {
  if (
    typeof value !== "function"
    || !(ExpressionTypeId in value)
  ) {
    return undefined;
  }
  return (value as ResumableExpression)[ExpressionTypeId]();
}

/**
 * Observe resumable-expression creation during one synchronous SSR session.
 * The returned disposer is idempotent.
 *
 * @internal
 */
export function onExpressionCreated(
  observer: (expression: ResumableExpression) => void,
): () => void {
  creationObservers.add(observer);
  return () => {
    creationObservers.delete(observer);
  };
}
