/**
 * Companion Babel transform for Milestone 7 closure extraction and Milestone
 * 8 resumable-expression extraction.
 *
 * Rewrites calls to the `extract` marker (from `portable-extract`) into a
 * hoisted, exported `Portable.code(...)` definition plus a `Portable.bind(...)`
 * call at the original site. The sibling `expr` marker follows the same
 * identity and closure-safety policy, but emits an expression definition and
 * binding carrying declared semantic dependencies.
 *
 *     import { extract } from "effect-atom-jsx/portable-extract";
 *     const save = extract((captures) => ..., { captures: SCHEMA, bind: { label } });
 *
 * becomes
 *
 *     import { code as _c, bind as _b } from "effect-atom-jsx/Portable";
 *     export const __afCode$save = _c({ id: "<moduleId>#save", buildId, captures: SCHEMA, run: (captures) => ... });
 *     const save = _b(__afCode$save, { label });
 *
 * Identity policy: `<moduleId>#<constName>` when the call initializes a
 * `const`, otherwise `<moduleId>#$<contentHash>`. Identities are stable across
 * formatting-only rebuilds; renaming the const or module changes the identity,
 * which the build-ID check makes safe across deployments.
 *
 * The unassigned case deliberately hashes the marker call's *structure* rather
 * than counting occurrences. A positional ordinal (`#$0`) renumbers every later
 * unassigned call in the module as soon as an earlier one is added, silently
 * moving a stable identity and churning chunk/prefetch identity across deploys
 * for code that did not change. The structural hash ignores formatting,
 * comments, and source positions, so an identity changes exactly when the
 * extracted code changes. Two structurally identical unassigned calls in one
 * module are disambiguated by a `~<n>` suffix in source order.
 *
 * `extract.auto(fn)` (Milestone 10 item 1) is the auto-capture mode: the
 * module-closed check flips from rejecting captured outer identifiers to
 * collecting them, and the transform synthesizes
 * `captures: Schema.Struct({ <name>: Schema.Unknown, ... })`, a call-site
 * `bind: { <name> }`, and a wrapper `run` that destructures the captures
 * before invoking the original function. `this`/`super`/`arguments` remain
 * hard errors, and secret-name/oversize capture diagnostics still apply to
 * inferred captures. JSON safety of bound values is not weakened: it stays
 * enforced downstream by `Portable.describe` / `jsonValueIssue` at render
 * time. Identity policy and the duplicate-identity guard are shared with
 * explicit `extract`.
 *
 * `expr.auto(render, { dependencies, deps })` is the symmetric expression mode
 * and shares that entire synthesis path. Dependencies are deliberately not
 * inferred — dependency identity decides when an expression re-renders, so
 * `dependencies` and `deps` stay required and explicit, and declaring
 * `captures`/`bind` alongside them is an error.
 *
 * The extracted function and its `captures` schema expression must be
 * module-closed (in auto mode, only for the `this`/`super`/`arguments` part): referencing a function-local outer binding is a compile
 * error with a code frame, never a silent serialization. The `bind` argument
 * stays at the call site and may reference any scope.
 *
 * This module imports Babel types only; the plugin receives the live `babel`
 * API through the standard plugin signature, so the published package gains no
 * runtime Babel dependency.
 */
import type * as Babel from "@babel/core";

export interface ResumeExtractEntry {
  /** Stable logical code identity written into the generated definition. */
  readonly id: string;
  /** Name of the generated module export holding the `Portable.code`. */
  readonly exportName: string;
  /** Logical module identity used as the id prefix. */
  readonly moduleId: string;
  /** Babel `filename` the entry was generated from, when available. */
  readonly filename?: string;
  /**
   * Present only for `extract.auto(...)` / `expr.auto(...)`: the capture names the transform
   * inferred from lexical references, in first-reference order. Diagnostics
   * can use this to report that the entry's wire types are runtime-validated
   * (`Schema.Unknown`) rather than declared.
   */
  readonly inferredCaptures?: ReadonlyArray<string>;
}

export interface ResumeExtractOptions {
  /** Deployment/build identity stamped on every generated definition. */
  readonly buildId: string;
  /**
   * Logical module identity. Defaults to the Babel filename relative to
   * `root` (or its basename) with forward slashes.
   */
  readonly moduleId?: string;
  /** Root used to relativize filenames into module identities. */
  readonly root?: string;
  /** Module specifier for the generated `code`/`bind` imports. */
  readonly runtimeModule?: string;
  /** Module specifier for generated expression runtime helpers. */
  readonly expressionRuntimeModule?: string;
  /**
   * Module specifier the per-element resumable-expression directive is taken
   * from. Namespace-imported, so generated JSX never introduces a bare
   * `resumeExprDirective` binding into author scope.
   */
  readonly directiveModule?: string;
  /**
   * Module specifier the synthesized `Schema` import for `extract.auto` /
   * `expr.auto` capture structs is taken from. Defaults to `effect`.
   */
  readonly schemaModule?: string;
  /**
   * Marker import sources, matched by suffix after stripping an extension.
   * Defaults to `portable-extract`.
   */
  readonly markerSuffixes?: ReadonlyArray<string>;
  /** Receives one entry per generated definition, in source order. */
  readonly onCode?: (entry: ResumeExtractEntry) => void;
  /**
   * Receives non-fatal, source-located diagnostics (currently
   * `oversized-bind` and, when `secretCaptureSeverity` is "warning",
   * `secret-prone-capture`). Error-severity diagnostics are always thrown as
   * code-framed compile errors.
   */
  readonly onDiagnostic?: (diagnostic: ResumeExtractDiagnostic) => void;
  /**
   * How to treat bind/capture property names that look like credentials.
   * Captures are embedded in server HTML, so the default is a hard error.
   */
  readonly secretCaptureSeverity?: "error" | "warning" | "off";
  /** Overrides the built-in secret-prone name heuristic. */
  readonly secretNamePattern?: RegExp;
  /**
   * Source-length ceiling (in characters) for one `bind` expression before an
   * `oversized-bind` warning is emitted. The runtime manifest byte ceiling is
   * still authoritative; this warns at build time before it bites. `0`
   * disables the check.
   */
  readonly maxBindSourceLength?: number;
}

/** Non-fatal, source-located diagnostic reported through `onDiagnostic`. */
export interface ResumeExtractDiagnostic {
  readonly code: "secret-prone-capture" | "oversized-bind";
  readonly severity: "warning";
  /** Human-readable message including a source code frame. */
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

const defaultRuntimeModule = "effect-atom-jsx/Portable";
const defaultExpressionRuntimeModule = "effect-atom-jsx/portable-extract";
const defaultMarkerSuffixes = ["portable-extract"];
const defaultSchemaModule = "effect";
const defaultDirectiveModule = "effect-atom-jsx/dom";
/** Exported name of the per-element resumable-expression directive. */
const directiveExportName = "resumeExprDirective";

/**
 * The conservative first-slice target allowlists (Milestone 8c.2).
 *
 * `src/resume-expression.ts` owns the authoritative arrays and `src/Resume.ts`
 * links them to the wire schemas at compile time; these literals are a
 * deliberate build-time duplicate so the Babel plugin keeps importing nothing
 * but Babel types (a real import would drag `effect`, `Portable`, and the
 * reactivity runtime into the published plugin). Divergence is not left to
 * discipline: they are exported below and
 * `src/__tests__/resume-extract-plugin.test.ts` fails if either list drifts
 * from `resume-expression.ts`. The manifest schema is still the one that fails
 * closed on the wire.
 */
const allowedExpressionAttributeNames: ReadonlySet<string> = new Set([
  "aria-description",
  "aria-label",
  "aria-valuetext",
  "data-state",
  "data-status",
  "title",
]);
const allowedExpressionStyleProperties: ReadonlySet<string> = new Set([
  "background-color",
  "color",
  "display",
  "height",
  "opacity",
  "transform",
  "visibility",
  "width",
]);
const customStylePropertyPattern = /^--[a-z][a-z0-9-]*$/;

/**
 * The build-time copy of the allowlists, exported solely so the drift test can
 * compare it against `resume-expression.ts`. Exporting the values adds no
 * imports and no runtime dependencies to the plugin.
 */
export const expressionTargetAllowlists = {
  attributes: allowedExpressionAttributeNames,
  styleProperties: allowedExpressionStyleProperties,
  customStylePropertyPattern,
} as const;

/** The discriminated manifest-v4 target the directive receives verbatim. */
type ExpressionTargetLiteral =
  | { readonly kind: "class" }
  | { readonly kind: "attribute"; readonly name: string }
  | { readonly kind: "style-property"; readonly name: string };
const defaultSecretNamePattern =
  /passw|secret|token|api[-_]?key|credential|private[-_]?key|bearer|session[-_]?id/i;
const defaultMaxBindSourceLength = 4096;

function testRegExp(pattern: RegExp, value: string): boolean {
  // User-supplied global/sticky patterns are stateful. Compiler diagnostics
  // must not depend on which property happened to be inspected previously.
  // Clone rather than mutating `lastIndex`: configuration objects are often
  // frozen, and inspecting them must not throw or alter caller-owned state.
  return pattern.global || pattern.sticky
    ? new RegExp(pattern.source, pattern.flags).test(value)
    : pattern.test(value);
}

function normalizeModulePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\.[cm]?[jt]sx?$/, "");
}

function isMarkerSource(
  source: string,
  suffixes: ReadonlyArray<string>,
): boolean {
  const normalized = normalizeModulePath(source);
  return suffixes.some((suffix) =>
    normalized === suffix || normalized.endsWith(`/${suffix}`)
  );
}

/**
 * Keys that describe *where* a node sits (or how it was printed) rather than
 * what it means. Excluding them is what makes the content hash insensitive to
 * formatting, comments, and unrelated edits elsewhere in the file.
 */
const structuralIgnoredKeys = new Set([
  "start",
  "end",
  "loc",
  "range",
  "extra",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);

/** Deterministic, position-free serialization of an AST subtree. */
function structuralKey(value: unknown): string {
  if (value === null || value === undefined) return "n";
  if (Array.isArray(value)) {
    return `[${value.map(structuralKey).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) =>
        !structuralIgnoredKeys.has(key) && !key.startsWith("_")
      )
      .sort();
    return `{${
      keys.map((key) => `${key}:${structuralKey(record[key])}`).join(",")
    }}`;
  }
  return `${typeof value}:${String(value)}`;
}

function fnv1a(input: string, offset: number): number {
  let hash = offset >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Two independent FNV-1a passes, base36-encoded. Pure arithmetic on purpose:
 * the published plugin must not acquire a `node:crypto` (or any) runtime
 * dependency, and the digest only needs to be stable and collision-resistant
 * enough to separate distinct extracted bodies inside one module.
 */
function contentHash(value: unknown): string {
  const key = structuralKey(value);
  return `${fnv1a(key, 0x811c9dc5).toString(36)}${
    fnv1a(key, 0x01000193).toString(36)
  }`;
}

function moduleIdFrom(
  options: ResumeExtractOptions,
  filename: string | undefined,
): string {
  if (options.moduleId !== undefined) return options.moduleId;
  if (filename === undefined) return "<unknown-module>";
  const normalized = filename.replace(/\\/g, "/");
  if (options.root !== undefined) {
    const root = options.root.replace(/\\/g, "/").replace(/\/$/, "");
    if (normalized.startsWith(`${root}/`)) {
      return normalized.slice(root.length + 1);
    }
  }
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

export default function resumeExtractPlugin(
  babel: typeof Babel,
): Babel.PluginObj<Babel.PluginPass> {
  const t = babel.types;

  /**
   * Rejects (or, in auto mode, collects) references that would change meaning
   * when the expression is hoisted to module scope.
   *
   * When `collect` is supplied the outer-function-scope reference check flips
   * from detection-and-rejection into synthesis: each offending identifier is
   * recorded (first occurrence wins, for the diagnostic code frame) instead of
   * throwing. `this`/`super`/`arguments` stay hard errors in both modes —
   * there is no capture that can stand in for them.
   */
  function assertModuleClosed(
    path: Babel.NodePath,
    subject: string,
    collect?: Map<string, Babel.NodePath>,
  ): void {
    const contextError = (
      offender: Babel.NodePath,
      construct: string,
    ): Error =>
      offender.buildCodeFrameError(
        `[resume-extract] ${subject} uses \`${construct}\`, which would change meaning when hoisted to module scope. `
          + "Extracted portable code must be module-closed; pass the value through captures/bind instead.",
      );
    // `this`/`arguments`/`super` inside a nested non-arrow function keep their
    // own binding and are safe; only occurrences that resolve to an enclosing
    // scope outside the extracted expression are rejected.
    const bindsOwnContext = (
      functionPath: Babel.NodePath,
    ): boolean =>
      functionPath.isFunctionExpression()
      || functionPath.isFunctionDeclaration()
      || functionPath.isObjectMethod()
      || functionPath.isClassMethod()
      || functionPath.isClassPrivateMethod();
    const resolvesOutside = (offender: Babel.NodePath): boolean => {
      let current: Babel.NodePath | null = offender.parentPath;
      while (current !== null && current !== path.parentPath) {
        if (bindsOwnContext(current)) return false;
        current = current.parentPath;
      }
      return true;
    };
    const checkIdentifier = (
      idPath: Babel.NodePath<
        Babel.types.Identifier | Babel.types.JSXIdentifier
      >,
    ): void => {
      const name = idPath.node.name;
      if (name === "arguments") {
        const binding = idPath.scope.getBinding(name);
        if (binding === undefined && resolvesOutside(idPath)) {
          throw contextError(idPath, "arguments");
        }
        return;
      }
      const binding = idPath.scope.getBinding(name);
      if (binding === undefined) return; // global/import-less reference
      if (binding.scope.block.type === "Program") return; // module scope
      const owner = binding.scope.path;
      if (owner === path || owner.isDescendant(path)) return; // internal
      if (collect !== undefined) {
        if (!collect.has(name)) collect.set(name, idPath);
        return;
      }
      throw idPath.buildCodeFrameError(
        `[resume-extract] ${subject} references "${name}" from an enclosing function scope. `
          + "Extracted portable code must be module-closed; pass the value through captures/bind instead.",
      );
    };
    // `traverse` visits descendants only, so a subject that *is* a bare
    // identifier (`captures: LocalSchema`) would otherwise slip through the
    // hoisting check entirely.
    if (path.isIdentifier()) checkIdentifier(path);
    path.traverse({
      ThisExpression(thisPath) {
        if (resolvesOutside(thisPath)) {
          throw contextError(thisPath, "this");
        }
      },
      Super(superPath) {
        if (resolvesOutside(superPath)) {
          throw contextError(superPath, "super");
        }
      },
      // Babel's ReferencedIdentifier virtual type.
      ReferencedIdentifier(
        idPath: Babel.NodePath<
          Babel.types.Identifier | Babel.types.JSXIdentifier
        >,
      ) {
        checkIdentifier(idPath);
      },
    });
  }

  const jsxAttributeName = (
    name: Babel.types.JSXIdentifier | Babel.types.JSXNamespacedName,
  ): string =>
    t.isJSXNamespacedName(name)
      ? `${name.namespace.name}:${name.name.name}`
      : name.name;

  /**
   * Classifies a JSX attribute position into the discriminated manifest-v4
   * target, or throws the source-located compile error that fences it.
   *
   * Every rejection here is an 8c.2 fence rather than a missing feature: events
   * are executable code, whole-`style`/`classList` objects and spreads hide the
   * target name from the compiler, DOM properties and URL-bearing attributes
   * have no security contract yet, and structural positions have no stable
   * element to attach to.
   */
  function targetForAttribute(
    attributePath: Babel.NodePath<Babel.types.JSXAttribute>,
  ): ExpressionTargetLiteral {
    const reject = (reason: string): Error =>
      attributePath.buildCodeFrameError(
        `[resume-extract] expr(...) is not supported in this JSX position: ${reason}. `
          + "Supported non-text targets are the allowlisted attributes, `class`, and a single "
          + "`style:<property>`; anything else must stay an ordinary reactive value.",
      );
    const name = jsxAttributeName(attributePath.node.name);
    if (t.isJSXNamespacedName(attributePath.node.name)) {
      const namespace = attributePath.node.name.namespace.name;
      const local = attributePath.node.name.name.name;
      if (namespace === "style") {
        if (
          !allowedExpressionStyleProperties.has(local)
          && !customStylePropertyPattern.test(local)
        ) {
          throw reject(`\`${name}\` is not an allowlisted style property`);
        }
        return { kind: "style-property", name: local };
      }
      if (namespace === "attr") {
        if (!allowedExpressionAttributeNames.has(local)) {
          throw reject(`\`${name}\` is not an allowlisted attribute`);
        }
        return { kind: "attribute", name: local };
      }
      if (namespace === "prop") throw reject("DOM properties are fenced");
      if (namespace === "on" || namespace === "oncapture") {
        throw reject("event handlers are executable code, never resumable");
      }
      throw reject(`the \`${namespace}:\` namespace is fenced`);
    }
    if (/^on[A-Z]/.test(name) || name === "onclick") {
      throw reject("event handlers are executable code, never resumable");
    }
    if (name === "class" || name === "className") return { kind: "class" };
    if (name === "classList") {
      throw reject("class-list objects hide their target names");
    }
    if (name === "style") {
      throw reject(
        "a whole style object is fenced; target one `style:<property>` instead",
      );
    }
    if (name === "ref") throw reject("`ref` is a structural position");
    if (!allowedExpressionAttributeNames.has(name)) {
      throw reject(`\`${name}\` is not an allowlisted attribute`);
    }
    return { kind: "attribute", name };
  }

  /** Builds the object literal the directive receives as the pair's target. */
  function targetLiteral(
    target: ExpressionTargetLiteral,
  ): Babel.types.ObjectExpression {
    return t.objectExpression([
      t.objectProperty(t.identifier("kind"), t.stringLiteral(target.kind)),
      ...("name" in target
        ? [
          t.objectProperty(t.identifier("name"), t.stringLiteral(target.name)),
        ]
        : []),
    ]);
  }

  return {
    name: "af-ui-resume-extract",
    visitor: {
      Program(programPath, state) {
        const options = (state.opts ?? {}) as ResumeExtractOptions;
        if (typeof options.buildId !== "string" || options.buildId.length === 0) {
          throw new Error(
            "[resume-extract] The plugin requires a non-empty `buildId` option.",
          );
        }
        if (
          options.secretCaptureSeverity !== undefined
          && options.secretCaptureSeverity !== "error"
          && options.secretCaptureSeverity !== "warning"
          && options.secretCaptureSeverity !== "off"
        ) {
          throw new Error(
            '[resume-extract] `secretCaptureSeverity` must be "error", "warning", or "off".',
          );
        }
        if (
          options.maxBindSourceLength !== undefined
          && (
            !Number.isSafeInteger(options.maxBindSourceLength)
            || options.maxBindSourceLength < 0
          )
        ) {
          throw new Error(
            "[resume-extract] `maxBindSourceLength` must be a non-negative safe integer.",
          );
        }
        const markerSuffixes = options.markerSuffixes ?? defaultMarkerSuffixes;
        const filename = state.file.opts.filename ?? undefined;
        const moduleId = moduleIdFrom(options, filename);

        // Which marker was called, and whether through its `.auto` member —
        // the mode whose captures/bind are synthesized from the detected
        // lexical references instead of declared.
        type MarkerName = "extract" | "expr";
        interface MarkerKind {
          readonly marker: MarkerName;
          readonly auto: boolean;
        }

        // Resolve local names bound to either marker import.
        const markerLocals = new Map<string, MarkerName>();
        const markerNamespaces = new Set<string>();
        for (const statement of programPath.get("body")) {
          if (!statement.isImportDeclaration()) continue;
          if (!isMarkerSource(statement.node.source.value, markerSuffixes)) {
            continue;
          }
          for (const specifier of statement.node.specifiers) {
            if (
              t.isImportSpecifier(specifier)
              && t.isIdentifier(specifier.imported)
              && (
                specifier.imported.name === "extract"
                || specifier.imported.name === "expr"
              )
            ) {
              markerLocals.set(
                specifier.local.name,
                specifier.imported.name,
              );
            }
            if (t.isImportNamespaceSpecifier(specifier)) {
              markerNamespaces.add(specifier.local.name);
            }
          }
        }
        if (markerLocals.size === 0 && markerNamespaces.size === 0) return;

        const markerKindOf = (
          callPath: Babel.NodePath<Babel.types.CallExpression>,
        ): MarkerKind | undefined => {
          const callee = callPath.node.callee;
          // `<marker>.auto(...)` — either `<local>.auto` or `<ns>.<marker>.auto`.
          if (
            t.isMemberExpression(callee)
            && t.isIdentifier(callee.property)
            && callee.property.name === "auto"
          ) {
            const target = callee.object;
            if (t.isIdentifier(target)) {
              const marker = markerLocals.get(target.name);
              if (marker === undefined) return undefined;
              return callPath.scope.getBinding(target.name)?.kind === "module"
                ? { marker, auto: true }
                : undefined;
            }
            if (
              t.isMemberExpression(target)
              && t.isIdentifier(target.object)
              && markerNamespaces.has(target.object.name)
              && t.isIdentifier(target.property)
              && (
                target.property.name === "extract"
                || target.property.name === "expr"
              )
            ) {
              const marker = target.property.name;
              return callPath.scope.getBinding(target.object.name)?.kind
                  === "module"
                ? { marker, auto: true }
                : undefined;
            }
            return undefined;
          }
          if (t.isIdentifier(callee)) {
            const marker = markerLocals.get(callee.name);
            if (marker === undefined) return undefined;
            const binding = callPath.scope.getBinding(callee.name);
            return binding?.kind === "module"
              ? { marker, auto: false }
              : undefined;
          }
          if (
            t.isMemberExpression(callee)
            && t.isIdentifier(callee.object)
            && markerNamespaces.has(callee.object.name)
            && t.isIdentifier(callee.property)
            && (
              callee.property.name === "extract"
              || callee.property.name === "expr"
            )
          ) {
            const marker = callee.property.name;
            const binding = callPath.scope.getBinding(callee.object.name);
            return binding?.kind === "module"
              ? { marker, auto: false }
              : undefined;
          }
          return undefined;
        };

        const markerCalls: Array<{
          readonly path: Babel.NodePath<Babel.types.CallExpression>;
          readonly kind: MarkerKind;
        }> = [];
        programPath.traverse({
          CallExpression(callPath) {
            const kind = markerKindOf(callPath);
            if (kind !== undefined) markerCalls.push({ path: callPath, kind });
          },
        });
        if (markerCalls.length === 0) return;

        // ─── §8c.3 — JSX directive seam ───────────────────────────────────
        // Recognize `expr(...)` by JSX context *before* lowering, so an
        // unsupported context is a compile error rather than a silently
        // lowered text expression. Supported non-text contexts are grouped by
        // host element: one directive attachment per element, carrying an
        // array of `[boundExpression, target]` pairs. Per-element grouping
        // makes the generated code agree with the single `data-af-expr`
        // marker the v4 wire format already assumes.
        interface JsxAttachment {
          readonly callPath: Babel.NodePath<Babel.types.CallExpression>;
          readonly attributePath: Babel.NodePath<Babel.types.JSXAttribute>;
          readonly target: ExpressionTargetLiteral;
        }
        const jsxAttachments = new Map<
          Babel.types.JSXOpeningElement,
          {
            readonly path: Babel.NodePath<Babel.types.JSXOpeningElement>;
            readonly attachments: Array<JsxAttachment>;
          }
        >();
        for (const { path: callPath, kind } of markerCalls) {
          if (kind.marker !== "expr") continue;
          const container = callPath.findParent((candidate) =>
            candidate.isJSXAttribute()
            || candidate.isJSXSpreadAttribute()
            || candidate.isJSXElement()
            || candidate.isJSXFragment()
          );
          if (container === null) continue; // ordinary, non-JSX call site
          if (container.isJSXSpreadAttribute()) {
            throw container.buildCodeFrameError(
              "[resume-extract] expr(...) is not supported in a JSX spread: the spread hides the "
                + "target name from the compiler. Author the attribute explicitly.",
            );
          }
          // Child position stays the existing text lowering, unchanged.
          if (!container.isJSXAttribute()) continue;
          const valueContainer = callPath.parentPath;
          if (
            valueContainer === null
            || !valueContainer.isJSXExpressionContainer()
            || valueContainer.parentPath !== container
          ) {
            throw callPath.buildCodeFrameError(
              "[resume-extract] expr(...) must be the whole JSX attribute value. Nesting it inside a "
                + "larger expression hides the resumable target from the compiler.",
            );
          }
          const openingElement = container.parentPath;
          if (!openingElement.isJSXOpeningElement()) {
            throw callPath.buildCodeFrameError(
              "[resume-extract] expr(...) is not supported in this structural JSX position.",
            );
          }
          const elementName = openingElement.node.name;
          if (
            !t.isJSXIdentifier(elementName)
            || !/^[a-z]/.test(elementName.name)
          ) {
            throw callPath.buildCodeFrameError(
              "[resume-extract] expr(...) is only supported on host elements. A component prop is an "
                + "ordinary value the component owns, not a DOM target the runtime can patch.",
            );
          }
          const target = targetForAttribute(container);
          const existing = jsxAttachments.get(openingElement.node);
          const group = existing ?? { path: openingElement, attachments: [] };
          if (existing === undefined) {
            jsxAttachments.set(openingElement.node, group);
          }
          group.attachments.push({
            callPath,
            attributePath: container,
            target,
          });
        }
        const directiveNamespaceId = jsxAttachments.size === 0
          ? undefined
          : programPath.scope.generateUidIdentifier("afExprDirectives");

        const hasAuto = markerCalls.some(({ kind }) => kind.auto);
        const hasExtract = markerCalls.some(({ kind }) =>
          kind.marker === "extract"
        );
        const hasExpression = markerCalls.some(({ kind }) =>
          kind.marker === "expr"
        );
        const schemaImportId = hasAuto
          ? programPath.scope.generateUidIdentifier("afSchema")
          : undefined;
        const codeImportId = hasExtract
          ? programPath.scope.generateUidIdentifier("afPortableCode")
          : undefined;
        const bindImportId = hasExtract
          ? programPath.scope.generateUidIdentifier("afPortableBind")
          : undefined;
        const expressionCodeImportId = hasExpression
          ? programPath.scope.generateUidIdentifier("afExpressionCode")
          : undefined;
        const bindExpressionImportId = hasExpression
          ? programPath.scope.generateUidIdentifier("afBindExpression")
          : undefined;
        const runtimeImports: Array<Babel.types.ImportDeclaration> = [];
        if (codeImportId !== undefined && bindImportId !== undefined) {
          runtimeImports.push(
            t.importDeclaration(
              [
                t.importSpecifier(codeImportId, t.identifier("code")),
                t.importSpecifier(bindImportId, t.identifier("bind")),
              ],
              t.stringLiteral(options.runtimeModule ?? defaultRuntimeModule),
            ),
          );
        }
        if (
          expressionCodeImportId !== undefined
          && bindExpressionImportId !== undefined
        ) {
          runtimeImports.push(
            t.importDeclaration(
              [
                t.importSpecifier(
                  expressionCodeImportId,
                  t.identifier("expressionCode"),
                ),
                t.importSpecifier(
                  bindExpressionImportId,
                  t.identifier("bindExpression"),
                ),
              ],
              t.stringLiteral(
                options.expressionRuntimeModule
                  ?? defaultExpressionRuntimeModule,
              ),
            ),
          );
        }

        if (directiveNamespaceId !== undefined) {
          // Namespace-imported deliberately. A named import would introduce a
          // bare `resumeExprDirective` binding into author scope (and could
          // collide with one), while the qualified reference names the ABI
          // exactly once per host element and nowhere else.
          runtimeImports.push(
            t.importDeclaration(
              [t.importNamespaceSpecifier(directiveNamespaceId)],
              t.stringLiteral(
                options.directiveModule ?? defaultDirectiveModule,
              ),
            ),
          );
        }

        if (schemaImportId !== undefined) {
          runtimeImports.push(
            t.importDeclaration(
              [t.importSpecifier(schemaImportId, t.identifier("Schema"))],
              t.stringLiteral(options.schemaModule ?? defaultSchemaModule),
            ),
          );
        }

        const deferred: Array<Babel.types.Statement> = [];
        const generatedIds = new Set<string>();
        let extractOrdinal = 0;
        let expressionOrdinal = 0;

        for (const markerCall of markerCalls) {
          const callPath = markerCall.path;
          const isAuto = markerCall.kind.auto;
          const isExpr = markerCall.kind.marker === "expr";
          const markerName = isAuto
            ? `${markerCall.kind.marker}.auto`
            : markerCall.kind.marker;
          // `extract.auto` infers everything and takes no options. `expr.auto`
          // still requires an options object: dependency identity is never
          // inferred (ratified decision), so `dependencies`/`deps` stay
          // declared even when captures are not.
          const requiredProps = isAuto
            ? (isExpr ? ["`dependencies`", "`deps`"] : [])
            : isExpr
            ? ["`captures`", "`bind`", "`dependencies`", "`deps`"]
            : ["`captures`", "`bind`"];
          const requiredPropsText = requiredProps.length === 0
            ? ""
            : requiredProps.length === 1
            ? requiredProps[0]!
            : `${requiredProps.slice(0, -1).join(", ")}, and ${
              requiredProps[requiredProps.length - 1]!
            }`;
          const callArguments = callPath.get("arguments");
          const [runArg, optionsArg] = callArguments;
          if (
            runArg === undefined
            || !(runArg.isArrowFunctionExpression()
              || runArg.isFunctionExpression())
          ) {
            throw callPath.buildCodeFrameError(
              `[resume-extract] ${markerName}(...) requires an inline arrow or function expression as its first argument.`,
            );
          }
          if (isAuto && !isExpr && callArguments.length > 1) {
            throw callPath.buildCodeFrameError(
              "[resume-extract] extract.auto(...) takes only the function to extract; "
                + "captures and bind are inferred. Use extract(fn, { captures, bind }) to declare them explicitly.",
            );
          }
          if (isAuto && isExpr && callArguments.length > 2) {
            throw callPath.buildCodeFrameError(
              "[resume-extract] expr.auto(...) takes the render function and an options object "
                + "with `dependencies` and `deps`; captures and bind are inferred.",
            );
          }
          const needsOptions = requiredProps.length > 0;
          if (
            needsOptions
            && (optionsArg === undefined || !optionsArg.isObjectExpression())
          ) {
            throw callPath.buildCodeFrameError(
              `[resume-extract] ${markerName}(...) requires an inline options object literal with ${requiredPropsText}.`,
            );
          }
          let capturesProp:
            | Babel.NodePath<Babel.types.ObjectProperty>
            | undefined;
          let bindProp: Babel.NodePath<Babel.types.ObjectProperty> | undefined;
          let dependenciesProp:
            | Babel.NodePath<Babel.types.ObjectProperty>
            | undefined;
          let depsProp: Babel.NodePath<Babel.types.ObjectProperty> | undefined;
          if (needsOptions) {
            const declaredOptions =
              optionsArg as Babel.NodePath<Babel.types.ObjectExpression>;
            for (const property of declaredOptions.get("properties")) {
              if (!property.isObjectProperty()) {
                throw property.buildCodeFrameError(
                  `[resume-extract] ${markerName} options must use plain ${requiredPropsText} properties.`,
                );
              }
              const key = property.node.key;
              if (!t.isIdentifier(key)) continue;
              if (
                isAuto && (key.name === "captures" || key.name === "bind")
              ) {
                throw property.buildCodeFrameError(
                  `[resume-extract] ${markerName} infers captures, so \`${key.name}\` must not be declared. `
                    + "Use expr(fn, { captures, bind, dependencies, deps }) to declare them explicitly.",
                );
              }
              if (key.name === "captures") capturesProp = property;
              if (key.name === "bind") bindProp = property;
              if (key.name === "dependencies") dependenciesProp = property;
              if (key.name === "deps") depsProp = property;
            }
            if (
              (!isAuto && (capturesProp === undefined || bindProp === undefined))
              || (
                isExpr
                && (dependenciesProp === undefined || depsProp === undefined)
              )
            ) {
              throw declaredOptions.buildCodeFrameError(
                `[resume-extract] ${markerName} options must declare ${requiredPropsText}.`,
              );
            }
          }

          // Auto mode collects the outer-scope references the strict check
          // would reject; explicit mode still rejects them.
          const collected = isAuto
            ? new Map<string, Babel.NodePath>()
            : undefined;
          assertModuleClosed(
            runArg,
            isExpr
              ? "The extracted expression"
              : "The extracted function",
            collected,
          );
          if (capturesProp !== undefined) {
            assertModuleClosed(
              capturesProp.get("value"),
              "The captures schema",
            );
          }
          if (dependenciesProp !== undefined) {
            assertModuleClosed(
              dependenciesProp.get("value"),
              "The dependencies schema",
            );
          }

          const inferredCaptures = collected === undefined
            ? undefined
            : [...collected.keys()];

          // Capture-content diagnostics. Captures are embedded in server
          // HTML, so credential-looking names fail closed by default, and a
          // very large bind expression warns before the runtime manifest
          // byte ceiling rejects the render.
          const secretSeverity = options.secretCaptureSeverity ?? "error";
          const secretPattern = options.secretNamePattern
            ?? defaultSecretNamePattern;
          if (secretSeverity !== "off") {
            const inspectKey = (
              keyPath: Babel.NodePath,
              name: string,
            ): void => {
              if (!testRegExp(secretPattern, name)) return;
              const framed = keyPath.buildCodeFrameError(
                `[resume-extract] Capture property "${name}" looks like a credential. `
                  + "Captures are serialized into server HTML; never place secrets in them. "
                  + "Rename the property or set `secretCaptureSeverity` if this is a false positive.",
              );
              if (secretSeverity === "error") throw framed;
              options.onDiagnostic?.({
                code: "secret-prone-capture",
                severity: "warning",
                message: framed.message,
                ...(keyPath.node.loc == null ? {} : {
                  line: keyPath.node.loc.start.line,
                  column: keyPath.node.loc.start.column,
                }),
              });
            };
            const scanObjectKeys = (target: Babel.NodePath): void => {
              const visit = (propPath: Babel.NodePath): void => {
                if (!propPath.isObjectProperty()) return;
                const key = propPath.node.key;
                if (t.isIdentifier(key)) inspectKey(propPath, key.name);
                else if (t.isStringLiteral(key)) inspectKey(propPath, key.value);
              };
              target.traverse({
                ObjectProperty(propPath) {
                  visit(propPath);
                },
              });
            };
            if (bindProp !== undefined) scanObjectKeys(bindProp.get("value"));
            // Inferred captures are held to the same standard: the name is
            // known at build time even though the value is lexical, so a
            // credential-looking capture still fails closed.
            if (collected !== undefined) {
              for (const [name, referencePath] of collected) {
                inspectKey(referencePath, name);
              }
            }
          }
          const maxBindLength = options.maxBindSourceLength
            ?? defaultMaxBindSourceLength;
          // An inferred bind has no source range, so the same advisory ceiling
          // is applied to the synthesized `{ a, b }` shorthand text.
          const bindSourceLength = bindProp !== undefined
            ? (
              bindProp.node.value.start == null
                || bindProp.node.value.end == null
                ? undefined
                : bindProp.node.value.end - bindProp.node.value.start
            )
            : `{ ${(inferredCaptures ?? []).join(", ")} }`.length;
          const bindDiagnosticNode = bindProp?.node.value ?? runArg.node;
          if (
            maxBindLength > 0
            && bindSourceLength !== undefined
            && bindSourceLength > maxBindLength
          ) {
            const framed = (bindProp ?? runArg).buildCodeFrameError(
              `[resume-extract] This bind expression is ${bindSourceLength} source characters, `
                + `exceeding the ${maxBindLength}-character advisory ceiling. Large captures inflate the `
                + "resume manifest and may exceed its byte limit at render time.",
            );
            options.onDiagnostic?.({
              code: "oversized-bind",
              severity: "warning",
              message: framed.message,
              ...(bindDiagnosticNode.loc == null ? {} : {
                line: bindDiagnosticNode.loc.start.line,
                column: bindDiagnosticNode.loc.start.column,
              }),
            });
          }

          const declarator = callPath.parentPath;
          const constName =
            declarator !== null
              && declarator.isVariableDeclarator()
              && t.isIdentifier(declarator.node.id)
              && declarator.parentPath.isVariableDeclaration()
              && declarator.parentPath.node.kind === "const"
              ? declarator.node.id.name
              : undefined;
          const ordinal = isExpr
            ? expressionOrdinal++
            : extractOrdinal++;
          // Unassigned calls take a structural content hash, not a position:
          // adding an earlier unassigned call must not renumber (and so
          // silently move) an unrelated identity.
          const localName = constName ?? `$${contentHash(callPath.node)}`;
          const baseId = isExpr
            ? `${moduleId}#expr$${localName}`
            : `${moduleId}#${localName}`;
          let id = baseId;
          if (constName === undefined) {
            // Structurally identical unassigned calls hash alike. Disambiguate
            // in source order, which only churns among the identical siblings.
            let suffix = 1;
            while (generatedIds.has(id)) {
              id = `${baseId}~${suffix}`;
              suffix += 1;
            }
          }
          if (generatedIds.has(id)) {
            throw callPath.buildCodeFrameError(
              `[resume-extract] Duplicate portable code identity "${id}" in this module. `
                + "Const-based identities are module-wide and scope-blind, so two same-named consts in different "
                + "functions collide. Rename one const, or drop the const binding to let positional ordinal "
                + "identities apply.",
            );
          }
          generatedIds.add(id);
          const exportId = programPath.scope.generateUidIdentifier(
            isExpr
              ? `afExpr$${constName ?? `anon${ordinal}`}`
              : `afCode$${constName ?? `anon${ordinal}`}`,
          );

          const definitionFactory = isExpr
            ? expressionCodeImportId
            : codeImportId;
          if (definitionFactory === undefined) {
            throw new Error(
              `[resume-extract] Missing generated runtime import for ${markerName}(...).`,
            );
          }
          // Auto mode synthesis. The captures schema is a struct of
          // `Schema.Unknown` fields — the typed-wire guarantee degrades to
          // runtime validation, and JSON safety of the bound values stays
          // enforced downstream by `Portable.describe` / `jsonValueIssue` at
          // render time. The extracted function is wrapped rather than
          // rewritten: destructuring the captures at the top of the wrapper
          // re-establishes exactly the names the original body already refers
          // to, so no reference rewriting (and no risk of missing one) is
          // needed.
          let capturesExpression: Babel.types.Expression;
          let bindExpression: Babel.types.Expression;
          let runExpression: Babel.types.Expression;
          if (isAuto) {
            if (schemaImportId === undefined) {
              throw new Error(
                "[resume-extract] Internal invariant: the Schema import for extract.auto was not generated.",
              );
            }
            const names = inferredCaptures ?? [];
            capturesExpression = t.callExpression(
              t.memberExpression(
                t.cloneNode(schemaImportId),
                t.identifier("Struct"),
              ),
              [
                t.objectExpression(
                  names.map((name) =>
                    t.objectProperty(
                      t.identifier(name),
                      t.memberExpression(
                        t.cloneNode(schemaImportId),
                        t.identifier("Unknown"),
                      ),
                    )
                  ),
                ),
              ],
            );
            bindExpression = t.objectExpression(
              names.map((name) =>
                t.objectProperty(
                  t.identifier(name),
                  t.identifier(name),
                  false,
                  true,
                )
              ),
            );
            const capturesParamId = programPath.scope.generateUidIdentifier(
              "afCaptures",
            );
            const argsParamId = programPath.scope.generateUidIdentifier(
              "afArgs",
            );
            runExpression = t.arrowFunctionExpression(
              [capturesParamId, t.restElement(argsParamId)],
              t.blockStatement([
                ...(names.length === 0 ? [] : [
                  t.variableDeclaration("const", [
                    t.variableDeclarator(
                      t.objectPattern(
                        names.map((name) =>
                          t.objectProperty(
                            t.identifier(name),
                            t.identifier(name),
                            false,
                            true,
                          )
                        ),
                      ),
                      t.cloneNode(capturesParamId),
                    ),
                  ]),
                ]),
                t.returnStatement(
                  t.callExpression(t.cloneNode(runArg.node), [
                    t.spreadElement(t.cloneNode(argsParamId)),
                  ]),
                ),
              ]),
            );
          } else {
            if (capturesProp === undefined || bindProp === undefined) {
              throw new Error(
                "[resume-extract] Internal invariant: declared captures/bind were not resolved.",
              );
            }
            capturesExpression = t.cloneNode(
              capturesProp.node.value as Babel.types.Expression,
            );
            bindExpression = t.cloneNode(
              bindProp.node.value as Babel.types.Expression,
            );
            runExpression = t.cloneNode(runArg.node);
          }

          const definition = t.exportNamedDeclaration(
            t.variableDeclaration("const", [
              t.variableDeclarator(
                exportId,
                t.callExpression(t.cloneNode(definitionFactory), [
                  t.objectExpression([
                    t.objectProperty(
                      t.identifier("id"),
                      t.stringLiteral(id),
                    ),
                    t.objectProperty(
                      t.identifier("buildId"),
                      t.stringLiteral(options.buildId),
                    ),
                    t.objectProperty(
                      t.identifier("captures"),
                      capturesExpression,
                    ),
                    ...(isExpr &&
                        dependenciesProp !== undefined
                      ? [
                          t.objectProperty(
                            t.identifier("dependencies"),
                            t.cloneNode(
                              dependenciesProp.node
                                .value as Babel.types.Expression,
                            ),
                          ),
                        ]
                      : []),
                    t.objectProperty(
                      t.identifier(
                        isExpr ? "render" : "run",
                      ),
                      runExpression,
                    ),
                  ]),
                ]),
              ),
            ]),
          );

          // Placement mirrors original evaluation order. A top-level call
          // evaluated during module load gets its definition immediately
          // before its own statement, preserving whatever declaration order
          // the source already relied on. A call inside a function executes
          // after module load, so its definition goes to the end of the
          // module where every module-scope binding is initialized.
          if (callPath.getFunctionParent() === null) {
            const topLevel = callPath.find(
              (candidate) => candidate.parentPath?.isProgram() ?? false,
            );
            if (topLevel === null) {
              throw callPath.buildCodeFrameError(
                `[resume-extract] Could not resolve a top-level statement for this ${markerName}(...) call.`,
              );
            }
            // Narrowed together so the declarator node is provably present
            // when its index is looked up, without a non-null assertion.
            const declaratorPath =
              declarator !== null && declarator.isVariableDeclarator()
                ? declarator
                : undefined;
            const variableDeclaration = declaratorPath !== undefined
                && declaratorPath.parentPath.isVariableDeclaration()
              ? declaratorPath.parentPath
              : undefined;
            const declarationIndex =
              variableDeclaration === undefined || declaratorPath === undefined
                ? -1
                : variableDeclaration.node.declarations.indexOf(
                  declaratorPath.node,
                );
            if (variableDeclaration !== undefined && declarationIndex > 0) {
              // `const Schema = ..., action = extract(... { captures: Schema })`
              // evaluates the first declarator before the marker. Hoisting the
              // generated definition ahead of the whole statement would read
              // `Schema` in its TDZ. Split only the preceding declarators so
              // the generated export occupies the marker's exact evaluation
              // boundary.
              const preceding = variableDeclaration.node.declarations.splice(
                0,
                declarationIndex,
              );
              const precedingDeclaration = t.variableDeclaration(
                variableDeclaration.node.kind,
                preceding,
              );
              const precedingStatement = topLevel.isExportNamedDeclaration()
                ? t.exportNamedDeclaration(precedingDeclaration, [])
                : precedingDeclaration;
              topLevel.insertBefore([precedingStatement, definition]);
            } else {
              topLevel.insertBefore(definition);
            }
          } else {
            deferred.push(definition);
          }

          const bindFactory = isExpr
            ? bindExpressionImportId
            : bindImportId;
          if (bindFactory === undefined) {
            throw new Error(
              `[resume-extract] Missing generated binding import for ${markerName}(...).`,
            );
          }
          const bindArguments: Babel.types.Expression[] = [
            t.cloneNode(exportId),
            bindExpression,
          ];
          if (isExpr) {
            if (depsProp === undefined) {
              throw new Error(
                "[resume-extract] Internal invariant: expr deps were not resolved.",
              );
            }
            bindArguments.push(
              t.cloneNode(depsProp.node.value as Babel.types.Expression),
            );
          }
          callPath.replaceWith(
            t.callExpression(t.cloneNode(bindFactory), bindArguments),
          );

          options.onCode?.({
            id,
            exportName: exportId.name,
            moduleId,
            ...(filename === undefined ? {} : { filename }),
            ...(inferredCaptures === undefined ? {} : { inferredCaptures }),
          });
        }

        // ─── §8c.3 — emit one directive attachment per host element ───────
        // The lowering above already rewrote each marker call in place, so the
        // attribute values now hold the *bound* branded expressions. Move them
        // into a single per-element attachment and drop the attributes: the
        // resumable target is owned by the directive plus the manifest, and
        // must never be re-derived from HTML.
        if (directiveNamespaceId !== undefined) {
          for (const { path: openingElement, attachments } of jsxAttachments
            .values()) {
            const pairs = t.arrayExpression(
              attachments.map((attachment) =>
                t.arrayExpression([
                  t.cloneNode(attachment.callPath.node),
                  targetLiteral(attachment.target),
                ])
              ),
            );
            for (const attachment of attachments) {
              attachment.attributePath.remove();
            }
            const elementParamId = programPath.scope.generateUidIdentifier(
              "afExprHost",
            );
            const body: Array<Babel.types.Statement> = [
              t.expressionStatement(
                t.callExpression(
                  t.memberExpression(
                    t.cloneNode(directiveNamespaceId),
                    t.identifier(directiveExportName),
                  ),
                  [t.cloneNode(elementParamId), pairs],
                ),
              ),
            ];
            // An authored `ref` must keep working. The directive needs the host
            // element before the JSX transform runs, and `ref` is the only
            // authored channel that hands it over, so an existing callback ref
            // is composed rather than replaced.
            const authoredRef = openingElement
              .get("attributes")
              .find((attribute): attribute is Babel.NodePath<
                Babel.types.JSXAttribute
              > =>
                attribute.isJSXAttribute()
                && t.isJSXIdentifier(attribute.node.name)
                && attribute.node.name.name === "ref"
              );
            if (authoredRef !== undefined) {
              const value = authoredRef.node.value;
              if (
                !t.isJSXExpressionContainer(value)
                || t.isJSXEmptyExpression(value.expression)
              ) {
                throw authoredRef.buildCodeFrameError(
                  "[resume-extract] A resumable expression on this element requires its `ref` to be an "
                    + "expression the compiler can compose with.",
                );
              }
              const refExpression = value.expression;
              if (t.isIdentifier(refExpression)) {
                const binding = openingElement.scope.getBinding(
                  refExpression.name,
                );
                if (binding?.kind === "let" || binding?.kind === "var") {
                  throw authoredRef.buildCodeFrameError(
                    `[resume-extract] The variable-assignment ref form (\`ref={${refExpression.name}}\`) cannot be `
                      + "composed with a resumable expression on the same element. Use a callback ref instead.",
                  );
                }
              }
              const authoredRefId = programPath.scope.generateUidIdentifier(
                "afAuthoredRef",
              );
              body.push(
                t.variableDeclaration("const", [
                  t.variableDeclarator(authoredRefId, t.cloneNode(refExpression)),
                ]),
                t.ifStatement(
                  t.binaryExpression(
                    "===",
                    t.unaryExpression("typeof", t.cloneNode(authoredRefId)),
                    t.stringLiteral("function"),
                  ),
                  t.expressionStatement(
                    t.callExpression(t.cloneNode(authoredRefId), [
                      t.cloneNode(elementParamId),
                    ]),
                  ),
                ),
              );
              authoredRef.remove();
            }
            openingElement.node.attributes.push(
              t.jsxAttribute(
                t.jsxIdentifier("ref"),
                t.jsxExpressionContainer(
                  t.arrowFunctionExpression(
                    [t.cloneNode(elementParamId)],
                    t.blockStatement(body),
                  ),
                ),
              ),
            );
          }
        }

        // The runtime import goes in the module header (imports hoist, so
        // this is TDZ-free); deferred definitions append at the end of the
        // module body.
        const body = programPath.get("body");
        let lastImportIndex = -1;
        for (let index = 0; index < body.length; index += 1) {
          if (body[index]!.isImportDeclaration()) lastImportIndex = index;
        }
        const anchor = body[lastImportIndex];
        if (anchor === undefined) {
          programPath.unshiftContainer("body", runtimeImports);
        } else {
          anchor.insertAfter(runtimeImports);
        }
        if (deferred.length > 0) {
          programPath.pushContainer("body", deferred);
        }
      },
    },
  };
}
