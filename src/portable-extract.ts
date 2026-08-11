import type { Effect, Schema } from "effect";
import type * as Portable from "./Portable.js";
import type {
  ExpressionDependenciesInput,
  ExpressionContext,
  ExpressionOutput,
  ResumableExpression,
} from "./resume-expression.js";

export {
  ExpressionDependencyDecodeError,
  ExpressionDependenciesSchemaTypeId,
  ExpressionRenderTypeId,
  ExpressionTypeId,
  ExpressionStructuralModeTypeId,
  bindExpression,
  bindStructuralExpression,
  decodeStructuralRowKey,
  encodeStructuralRowKey,
  expressionCode,
  inspectExpression,
  structuralExpressionCode,
} from "./resume-expression.js";
export type {
  ExpressionCode,
  ExpressionCodeOptions,
  ExpressionContext,
  ExpressionDependenciesInput,
  ExpressionDependency,
  ExpressionInspection,
  ExpressionOutput,
  ResumableExpression,
  ResumableStructuralExpression,
  StructuralExpressionCode,
  StructuralExpressionCodeOptions,
  StructuralMode,
  StructuralOutput,
  StructuralRow,
} from "./resume-expression.js";

/**
 * Options for the compiler-extracted portable marker.
 *
 * `captures` is the wire schema for the extracted closure's logical inputs and
 * `bind` supplies their values at the call site. `bind` is evaluated in place,
 * so it may reference any surrounding scope; the extracted function and the
 * `captures` schema must be module-closed because the companion transform
 * hoists them into an addressable module export.
 */
export interface ExtractOptions<Captures, EncodedCaptures> {
  readonly captures: Schema.Codec<Captures, EncodedCaptures>;
  /**
   * Values are checked against the capture codec; they do not participate in
   * inferring its domain. This prevents an invalid bind object from widening
   * `Captures` until both the schema and the value appear acceptable.
   */
  readonly bind: NoInfer<Captures>;
}

/**
 * Options for {@link autoExpr} (`expr.auto`).
 *
 * Captures are inferred by the companion transform, but dependencies are not:
 * dependency identity is never inferred, so `dependencies` and `deps` stay
 * required and explicit exactly as in {@link ExprOptions}.
 */
export interface ExprAutoOptions<
  Dependencies extends ReadonlyArray<unknown>,
  EncodedDependencies,
> {
  readonly dependencies: Schema.Codec<Dependencies, EncodedDependencies>;
  /**
   * Dependency positions are inferred from `dependencies`; handles and keys
   * must satisfy that tuple rather than widening it.
   */
  readonly deps: NoInfer<ExpressionDependenciesInput<Dependencies>>;
}

export interface ExprOptions<
  Captures,
  EncodedCaptures,
  Dependencies extends ReadonlyArray<unknown>,
  EncodedDependencies,
> {
  readonly captures: Schema.Codec<Captures, EncodedCaptures>;
  readonly bind: NoInfer<Captures>;
  readonly dependencies: Schema.Codec<Dependencies, EncodedDependencies>;
  /**
   * Dependency positions are inferred from `dependencies`; handles and keys
   * must satisfy that tuple rather than widening it.
   */
  readonly deps: NoInfer<ExpressionDependenciesInput<Dependencies>>;
}

/**
 * Marker for compiler-driven closure extraction (Milestone 7).
 *
 * The companion `resume-extract` Babel transform rewrites
 * `extract(run, { captures, bind })` into a hoisted, exported
 * `Portable.code(...)` definition with a stable `module#name` identity and a
 * `Portable.bind(...)` call at the original site.
 *
 * Without the transform this marker fails closed: portable identities must be
 * build-stable, and an untransformed call has none. The compiler-independent
 * escape hatch is writing `Portable.code` + `Portable.bind` manually.
 */
export function extract<
  Captures,
  EncodedCaptures,
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
>(
  _run: (captures: Captures, ...args: Args) => Effect.Effect<A, E, R>,
  _options: ExtractOptions<Captures, EncodedCaptures>,
): Portable.BoundCode<Captures, EncodedCaptures, Args, A, E, R> {
  throw new Error(
    "[effect-atom-jsx] Portable extract(...) was called without the companion "
      + "resume-extract compiler transform. Either enable the transform or use "
      + "Portable.code(...) + Portable.bind(...) directly.",
  );
}

/**
 * Auto-capture variant of {@link extract} (Milestone 10 item 1).
 *
 * `extract.auto(run)` takes no options: the companion transform infers the
 * captured lexical identifiers, synthesizes the `captures` schema
 * (`Schema.Struct` of `Schema.Unknown` fields) and the call-site `bind`
 * object, and rewrites `run` to receive those captures as its first
 * parameter. `this`/`super`/`arguments` remain hard compile errors, and
 * secret-name/oversize capture diagnostics still apply to inferred captures.
 *
 * The typed-wire guarantee explicitly degrades here: inferred captures are
 * `Schema.Unknown`, so their JSON safety is enforced downstream at render
 * time by `Portable.describe` / `jsonValueIssue` rather than by a declared
 * per-capture codec. Prefer explicit {@link extract} when the wire shape
 * matters.
 *
 * Without the transform this marker fails closed, exactly like
 * {@link extract}: an untransformed call has no build-stable identity.
 */
export function autoExtract<Args extends ReadonlyArray<unknown>, A, E, R>(
  _run: (...args: Args) => Effect.Effect<A, E, R>,
): Portable.BoundCode<
  Record<string, unknown>,
  Record<string, unknown>,
  Args,
  A,
  E,
  R
> {
  throw new Error(
    "[effect-atom-jsx] Portable extract.auto(...) was called without the "
      + "companion resume-extract compiler transform. Either enable the "
      + "transform or use Portable.code(...) + Portable.bind(...) directly.",
  );
}

extract.auto = autoExtract;

/**
 * Explicit compiler marker for a fine-grained resumable text expression.
 *
 * The companion transform extracts `render` into stable portable code and
 * rewrites this call to an internal expression binding. Without that
 * transform there is no build-stable expression identity, so the marker
 * fails closed.
 */
export function expr<
  Captures,
  EncodedCaptures,
  Dependencies extends ReadonlyArray<unknown>,
  EncodedDependencies,
  A extends ExpressionOutput,
>(
  _render: (captures: Captures, dependencies: Dependencies) => A,
  _options: ExprOptions<
    Captures,
    EncodedCaptures,
    Dependencies,
    EncodedDependencies
  >,
): ResumableExpression<A> {
  throw new Error(
    "[effect-atom-jsx] Portable expr(...) was called without the companion "
      + "resume-extract compiler transform. Enable the transform or use an "
      + "ordinary JSX expression that activates with its component.",
  );
}

/**
 * Auto-capture variant of {@link expr} (Milestone 10 item 1), symmetric with
 * {@link autoExtract}.
 *
 * `expr.auto(render, { dependencies, deps })` infers the captured lexical
 * identifiers and synthesizes the `captures` schema (`Schema.Struct` of
 * `Schema.Unknown` fields) plus the call-site `bind` object. Dependencies are
 * deliberately *not* inferred: dependency identity determines when the
 * expression re-renders, and a missed or spurious edge is a correctness bug
 * that no heuristic may introduce. So `dependencies` and `deps` remain
 * required and explicit.
 *
 * `this`/`super`/`arguments` remain hard compile errors, and
 * secret-name/oversize capture diagnostics still apply to inferred captures.
 * The typed-wire guarantee degrades for captures only — inferred captures are
 * `Schema.Unknown`, validated downstream at render time; the declared
 * `dependencies` codec is untouched.
 *
 * Without the transform this marker fails closed, exactly like {@link expr}.
 */
export function autoExpr<
  Dependencies extends ReadonlyArray<unknown>,
  EncodedDependencies,
  A extends ExpressionOutput,
>(
  _render: (dependencies: Dependencies) => A,
  _options: ExprAutoOptions<Dependencies, EncodedDependencies>,
): ResumableExpression<A> {
  throw new Error(
    "[effect-atom-jsx] Portable expr.auto(...) was called without the "
      + "companion resume-extract compiler transform. Enable the transform or "
      + "use an ordinary JSX expression that activates with its component.",
  );
}

expr.auto = autoExpr;
