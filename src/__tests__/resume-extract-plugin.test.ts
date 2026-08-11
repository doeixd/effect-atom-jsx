import * as babel from "@babel/core";
import { describe, expect, it } from "vitest";
import resumeExtractPlugin, {
  expressionTargetAllowlists,
  type ResumeExtractEntry,
  type ResumeExtractOptions,
} from "../compiler/resume-extract-plugin.js";
import {
  ExpressionAttributeNames,
  ExpressionCustomStylePropertyPattern,
  ExpressionNamedStylePropertyNames,
  isExpressionAttributeName,
  isExpressionStylePropertyName,
} from "../resume-expression.js";
import { expr, extract } from "../portable-extract.js";
import * as Portable from "../Portable.js";
import { Effect, Schema } from "effect";

function transform(
  source: string,
  options: Partial<ResumeExtractOptions> = {},
  filename = "C:/app/src/todo.ts",
): string {
  const result = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    plugins: [[
      resumeExtractPlugin,
      {
        buildId: "build-1",
        root: "C:/app",
        ...options,
      } satisfies Partial<ResumeExtractOptions> & { buildId: string },
    ]],
  });
  if (result?.code == null) throw new Error("Babel produced no output.");
  return result.code;
}

/**
 * Compile a module with the transform and *run it*, so evaluation-order claims
 * are proven by execution rather than by the index of a substring.
 *
 * The transformed ESM is lowered to CJS and evaluated with a `require` that
 * serves the real `Portable` runtime, so a TDZ violation in the generated
 * placement surfaces here as the `ReferenceError` a browser would raise.
 */
async function evaluateTransformed(
  source: string,
  options: Partial<ResumeExtractOptions> = {},
  filename = "C:/app/src/todo.ts",
): Promise<Record<string, unknown>> {
  const esm = transform(source, options, filename);
  const cjs = babel.transformSync(esm, {
    filename,
    babelrc: false,
    configFile: false,
    sourceType: "module",
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  })?.code;
  if (cjs == null) throw new Error("Babel produced no CommonJS output.");
  const Portable = await import("../Portable.js");
  const effect = await import("effect");
  const moduleExports: Record<string, unknown> = {};
  const requireModule = (id: string): unknown => {
    if (id === "effect") return effect;
    if (id === "effect-atom-jsx/Portable") return Portable;
    // The marker import survives the transform but is never called in
    // generated code; the generated calls go to `effect-atom-jsx/Portable`.
    if (id === "effect-atom-jsx/portable-extract") return {};
    throw new Error(`Unexpected import of "${id}" in generated module.`);
  };
  new Function("require", "exports", "module", cjs)(
    requireModule,
    moduleExports,
    { exports: moduleExports },
  );
  return moduleExports;
}

const fixture = `
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
const label = "Save";
export const save = extract((captures) => Effect.succeed(captures.label), {
  captures: Schema.Struct({ label: Schema.String }),
  bind: { label },
});
`;

/** Generated code identities, in source order. */
function identities(output: string): ReadonlyArray<string> {
  return [...output.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]!);
}

describe("resume-extract compiler transform", () => {
  it("hoists an exported Portable.code with a stable module#name identity", () => {
    const output = transform(fixture);
    expect(output).toContain('id: "src/todo.ts#save"');
    expect(output).toContain('buildId: "build-1"');
    expect(output).toMatch(/export const _afCode\$save = _afPortableCode\(/);
    expect(output).toMatch(/const save = _afPortableBind\(_afCode\$save, \{\s*label\s*\}\)/);
    expect(output).toContain(
      'import { code as _afPortableCode, bind as _afPortableBind } from "effect-atom-jsx/Portable"',
    );
  });

  it("produces identical identities across repeated builds", () => {
    expect(transform(fixture)).toBe(transform(fixture));
  });

  it("uses content-hashed identities for calls not assigned to a const", () => {
    // Positional ordinals renumbered every later unassigned call as soon as an
    // earlier one appeared, silently moving a stable identity for code that
    // did not change. The identity now tracks the extracted content.
    const module = (prefix: string) => `
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
${prefix}
registry.push(extract(() => Effect.succeed(1), {
  captures: Schema.Struct({}),
  bind: {},
}));
`;
    const alone = identities(transform(module("")));
    expect(alone).toHaveLength(1);
    expect(alone[0]).toMatch(/^src\/todo\.ts#\$[0-9a-z]+$/);

    // Formatting-only rebuilds keep the identity.
    expect(
      identities(transform(module("").replace(/\n/g, "\n\n"))),
    ).toEqual(alone);

    // …and so does adding an unrelated unassigned call *before* it.
    const withEarlier = identities(
      transform(module(`registry.push(extract(() => Effect.succeed(0), {
  captures: Schema.Struct({}),
  bind: {},
}));`)),
    );
    expect(withEarlier).toHaveLength(2);
    expect(withEarlier[1]).toBe(alone[0]);
  });

  it("reports build-manifest entries in source order", () => {
    const entries: ResumeExtractEntry[] = [];
    transform(fixture, { onCode: (entry) => entries.push(entry) });
    expect(entries).toMatchObject([
      {
        id: "src/todo.ts#save",
        moduleId: "src/todo.ts",
        exportName: "_afCode$save",
      },
    ]);
  });

  it("allows module-scope and internal references but rejects enclosing function captures", () => {
    // Module-scope reference inside the extracted function is fine.
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
const suffix = "!";
export const shout = extract((captures) => Effect.succeed(captures.label + suffix), {
  captures: Schema.Struct({ label: Schema.String }),
  bind: { label: "hi" },
});
`)
    ).not.toThrow();

    // Function-local outer capture must fail closed with the identifier named.
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export function makeSave(prefix) {
  return extract((captures) => Effect.succeed(prefix + captures.label), {
    captures: Schema.Struct({ label: Schema.String }),
    bind: { label: "hi" },
  });
}
`)
    ).toThrow(/references "prefix" from an enclosing function scope/);
  });

  it("keeps bind expressions at the call site so they may close over local scope", () => {
    const output = transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export function makeSave(prefix) {
  return extract((captures) => Effect.succeed(captures.label), {
    captures: Schema.Struct({ label: Schema.String }),
    bind: { label: prefix },
  });
}
`);
    expect(output).toMatch(/_afPortableBind\(_afCode\$anon\d*, \{\s*label: prefix\s*\}\)/);
  });

  it("supports namespace marker imports", () => {
    const output = transform(`
import * as PortableExtract from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export const ping = PortableExtract.extract(() => Effect.succeed("pong"), {
  captures: Schema.Struct({}),
  bind: {},
});
`);
    expect(output).toContain('id: "src/todo.ts#ping"');
  });

  it("does not transform a shadowed namespace import", () => {
    const output = transform(`
import * as PortableExtract from "effect-atom-jsx/portable-extract";
export function run(PortableExtract) {
  return PortableExtract.expr(() => "local", {
    captures: null,
    bind: {},
    dependencies: null,
    deps: [],
  });
}
`);
    expect(output).not.toContain("_afExpressionCode");
    expect(output).toContain("PortableExtract.expr");
  });

  it("requires inline function and options literals", () => {
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
const run = () => 1;
export const bad = extract(run, { captures: null, bind: {} });
`)
    ).toThrow(/inline arrow or function expression/);

    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
const options = {};
export const bad = extract(() => 1, options);
`)
    ).toThrow(/inline options object literal/);
  });

  it("leaves modules without the marker untouched", () => {
    const source = `import { extract } from "./unrelated.js";\nexport const value = extract(1);`;
    const output = transform(source);
    expect(output).not.toContain("_afPortableCode");
    expect(output).toContain("extract(1)");
  });

  it("requires a buildId option", () => {
    expect(() =>
      babel.transformSync(fixture, {
        filename: "C:/app/src/todo.ts",
        babelrc: false,
        configFile: false,
        plugins: [[resumeExtractPlugin, {}]],
      })
    ).toThrow(/requires a non-empty `buildId`/);
  });

  it("rejects invalid diagnostic configuration", () => {
    expect(() =>
      transform(fixture, {
        maxBindSourceLength: -1,
      })
    ).toThrow(/non-negative safe integer/);
    expect(() =>
      transform(fixture, {
        secretCaptureSeverity: "loud" as "error",
      })
    ).toThrow(/must be "error", "warning", or "off"/);
  });

  it("does not mutate frozen stateful diagnostic patterns", () => {
    const pattern = Object.freeze(/token/gi);
    expect(() =>
      transform(fixture, {
        secretNamePattern: pattern,
      })
    ).not.toThrow();
    expect(pattern.lastIndex).toBe(0);
  });
});

describe("resume-extract expression transform", () => {
  const expressionFixture = `
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
const label = "Count: 1";
const key = "count:1";
export const countText = expr((captures) => captures.label, {
  captures: Schema.Struct({ label: Schema.String }),
  bind: { label },
  dependencies: Schema.Tuple([Schema.Unknown]),
  deps: [key],
});
`;

  it("extracts stable expression code and keeps bind/deps at the call site", () => {
    const output = transform(expressionFixture);
    expect(output).toContain('id: "src/todo.ts#expr$countText"');
    expect(output).toMatch(
      /export const _afExpr\$countText = _afExpressionCode\(/,
    );
    expect(output).toMatch(
      /const countText = _afBindExpression\(_afExpr\$countText, \{\s*label\s*\}, \[key\]\)/,
    );
    expect(output).toContain(
      'import { expressionCode as _afExpressionCode, bindExpression as _afBindExpression } from "effect-atom-jsx/portable-extract"',
    );
    expect(output).not.toContain(
      'from "effect-atom-jsx/Portable"',
    );
  });

  it("keeps expression identities in their own namespace, independent of actions", () => {
    const output = transform(`
import { extract, expr } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
registry.push(extract(() => Effect.void, {
  captures: Schema.Struct({}),
  bind: {},
}));
registry.push(expr(() => "text", {
  captures: Schema.Struct({}),
  bind: {},
  dependencies: Schema.Tuple([]),
  deps: [],
}));
`);
    const [action, expression] = identities(output);
    expect(action).toMatch(/^src\/todo\.ts#\$[0-9a-z]+$/);
    expect(expression).toMatch(/^src\/todo\.ts#expr\$\$[0-9a-z]+$/);
  });

  it("requires declared deps and applies module-closure checks", () => {
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export const text = expr(() => "text", {
  captures: Schema.Struct({}),
  bind: {},
});
`)
    ).toThrow(/must declare `captures`, `bind`, `dependencies`, and `deps`/);

    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export function makeText(local) {
  return expr(() => local, {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([]),
    deps: [],
  });
}
`)
    ).toThrow(/references "local" from an enclosing function scope/);
  });

  it("reports expression definitions through the shared resolver entry hook", () => {
    const entries: ResumeExtractEntry[] = [];
    transform(expressionFixture, {
      onCode: (entry) => entries.push(entry),
    });
    expect(entries).toMatchObject([
      {
        id: "src/todo.ts#expr$countText",
        moduleId: "src/todo.ts",
        exportName: "_afExpr$countText",
      },
    ]);
  });
});

describe("resume-extract auto-capture mode", () => {
  const autoFixture = `
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
export function Todo(label, count) {
  const save = extract.auto(() => Effect.succeed(label + count));
  return save;
}
`;

  it("synthesizes a captures struct, a bind object, and a destructuring wrapper", () => {
    const output = transform(autoFixture);
    expect(output).toContain('id: "src/todo.ts#save"');
    expect(output).toMatch(
      /captures: _afSchema\.Struct\(\{\s*label: _afSchema\.Unknown,\s*count: _afSchema\.Unknown\s*\}\)/,
    );
    expect(output).toMatch(/const \{\s*label,\s*count\s*\} = _afCaptures/);
    expect(output).toMatch(
      /const save = _afPortableBind\(_afCode\$save, \{\s*label,\s*count\s*\}\)/,
    );
    expect(output).toContain('import { Schema as _afSchema } from "effect"');
  });

  it("produces identical output across repeated builds", () => {
    expect(transform(autoFixture)).toBe(transform(autoFixture));
  });

  it("honors the schemaModule option", () => {
    const output = transform(autoFixture, { schemaModule: "effect/Schema" });
    expect(output).toContain(
      'import { Schema as _afSchema } from "effect/Schema"',
    );
  });

  it("reports inferred capture names in the build-manifest entry", () => {
    const entries: ResumeExtractEntry[] = [];
    transform(autoFixture, { onCode: (entry) => entries.push(entry) });
    expect(entries).toMatchObject([
      { id: "src/todo.ts#save", inferredCaptures: ["label", "count"] },
    ]);
  });

  it("omits inferredCaptures for explicit extract entries", () => {
    const entries: ResumeExtractEntry[] = [];
    transform(fixture, { onCode: (entry) => entries.push(entry) });
    expect(entries[0]).not.toHaveProperty("inferredCaptures");
  });

  it("leaves module-scope and global references uncaptured", () => {
    const output = transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
const PREFIX = "p";
export function Todo(label) {
  return extract.auto(() => Effect.succeed(PREFIX + label + globalThis.x));
}
`);
    expect(output).toMatch(
      /captures: _afSchema\.Struct\(\{\s*label: _afSchema\.Unknown\s*\}\)/,
    );
  });

  it("synthesizes an empty captures struct and skips destructuring when nothing is captured", () => {
    const output = transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
export const ping = extract.auto(() => Effect.succeed(1));
`);
    expect(output).toContain("captures: _afSchema.Struct({})");
    expect(output).not.toContain("= _afCaptures");
  });

  it("disambiguates structurally identical auto calls not assigned to a const", () => {
    const output = transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
export function Todo(label) {
  registry.push(extract.auto(() => Effect.succeed(label)));
  registry.push(extract.auto(() => Effect.succeed(label)));
}
`);
    // Identical content hashes alike, so the collision is resolved in source
    // order — churn is confined to the identical siblings.
    const [first, second] = identities(output);
    expect(first).toMatch(/^src\/todo\.ts#\$[0-9a-z]+$/);
    expect(second).toBe(`${first!}~1`);
  });

  it("shares the duplicate-identity guard with explicit extract", () => {
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export function A(label) {
  const save = extract.auto(() => Effect.succeed(label));
  return save;
}
export function B() {
  const save = extract(() => Effect.succeed(1), {
    captures: Schema.Struct({}),
    bind: {},
  });
  return save;
}
`)
    ).toThrow(/Duplicate portable code identity "src\/todo\.ts#save"/);
  });

  it("still fails closed on a credential-looking inferred capture", () => {
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
export function Todo(sessionId) {
  return extract.auto(() => Effect.succeed(sessionId));
}
`)
    ).toThrow(/Capture property "sessionId" looks like a credential/);
  });

  it("still rejects `this` inside an auto-extracted function", () => {
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
export function Todo() {
  return extract.auto(() => Effect.succeed(this.label));
}
`)
    ).toThrow(/uses `this`/);
  });

  it("still rejects `arguments` inside an auto-extracted function", () => {
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
export function Todo() {
  return extract.auto(() => Effect.succeed(arguments.length));
}
`)
    ).toThrow(/uses `arguments`/);
  });

  it("rejects an options argument on extract.auto", () => {
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export const save = extract.auto(() => Effect.succeed(1), {
  captures: Schema.Struct({}),
  bind: {},
});
`)
    ).toThrow(/takes only the function to extract/);
  });

  it("resolves auto through a namespace import", () => {
    const output = transform(`
import * as PortableExtract from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
export function Todo(label) {
  const save = PortableExtract.extract.auto(() => Effect.succeed(label));
  return save;
}
`);
    expect(output).toContain('id: "src/todo.ts#save"');
    expect(output).toMatch(
      /captures: _afSchema\.Struct\(\{\s*label: _afSchema\.Unknown\s*\}\)/,
    );
  });

  it("round-trips two lexical captures through the generated definition", async () => {
    const body = transform(autoFixture)
      .replace(/^import .*$/gm, "")
      .replace(/^export /gm, "");
    const evaluate = new Function(
      "_afSchema",
      "_afPortableCode",
      "_afPortableBind",
      "Effect",
      `${body}\nreturn Todo;`,
    ) as (
      schema: typeof Schema,
      code: (definition: unknown) => unknown,
      bind: (code: unknown, captures: unknown) => unknown,
      effect: typeof Effect,
    ) => (label: string, count: number) => {
      readonly code: {
        readonly id: string;
        readonly captures: Schema.Codec<never, never>;
        readonly run: (
          captures: Record<string, unknown>,
        ) => Effect.Effect<string>;
      };
      readonly captures: Record<string, unknown>;
    };
    const Todo = evaluate(
      Schema,
      (definition) => definition,
      (code, captures) => ({ code, captures }),
      Effect,
    );
    const bound = Todo("Save", 2);
    expect(bound.captures).toEqual({ label: "Save", count: 2 });
    expect(bound.code.id).toBe("src/todo.ts#save");
    // The wrapper receives captures positionally and the original body reads
    // them by their original names.
    expect(await Effect.runPromise(bound.code.run(bound.captures))).toBe(
      "Save2",
    );
    // The synthesized struct accepts the bound values it was derived from.
    expect(
      Schema.decodeUnknownSync(bound.code.captures as never)(bound.captures),
    ).toEqual({ label: "Save", count: 2 });
  });

  it("leaves explicit extract output unchanged", () => {
    const output = transform(fixture);
    expect(output).not.toContain("_afSchema");
    expect(output).toContain("captures: Schema.Struct({");
    expect(output).toMatch(
      /const save = _afPortableBind\(_afCode\$save, \{\s*label\s*\}\)/,
    );
  });
});

describe("resume-extract expr.auto auto-capture mode", () => {
  const exprAutoFixture = `
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export function Counter(label, count) {
  const key = "count:1";
  const text = expr.auto(() => label + count, {
    dependencies: Schema.Tuple([Schema.Unknown]),
    deps: [key],
  });
  return text;
}
`;

  it("synthesizes captures/bind while keeping declared dependencies and deps", () => {
    const output = transform(exprAutoFixture);
    expect(output).toContain('id: "src/todo.ts#expr$text"');
    expect(output).toMatch(
      /captures: _afSchema\.Struct\(\{\s*label: _afSchema\.Unknown,\s*count: _afSchema\.Unknown\s*\}\)/,
    );
    expect(output).toContain("dependencies: Schema.Tuple([Schema.Unknown])");
    expect(output).toMatch(/const \{\s*label,\s*count\s*\} = _afCaptures/);
    expect(output).toMatch(
      /const text = _afBindExpression\(_afExpr\$text, \{\s*label,\s*count\s*\}, \[key\]\)/,
    );
    expect(output).toContain('import { Schema as _afSchema } from "effect"');
    expect(output).toContain(
      'import { expressionCode as _afExpressionCode, bindExpression as _afBindExpression } from "effect-atom-jsx/portable-extract"',
    );
    // Auto expressions are expression definitions, not portable actions.
    expect(output).not.toContain('from "effect-atom-jsx/Portable"');
  });

  it("produces identical output across repeated builds", () => {
    expect(transform(exprAutoFixture)).toBe(transform(exprAutoFixture));
  });

  it("reports inferred capture names on the expression manifest entry", () => {
    const entries: ResumeExtractEntry[] = [];
    transform(exprAutoFixture, { onCode: (entry) => entries.push(entry) });
    expect(entries).toMatchObject([
      {
        id: "src/todo.ts#expr$text",
        exportName: "_afExpr$text",
        inferredCaptures: ["label", "count"],
      },
    ]);
  });

  it("still requires declared dependencies and deps", () => {
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
export function Counter(label) {
  return expr.auto(() => label);
}
`)
    ).toThrow(
      /expr\.auto\(\.\.\.\) requires an inline options object literal with `dependencies`, and `deps`/,
    );

    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export function Counter(label) {
  return expr.auto(() => label, {
    dependencies: Schema.Tuple([Schema.Unknown]),
  });
}
`)
    ).toThrow(/options must declare `dependencies`, and `deps`/);
  });

  it("rejects declared captures or bind on expr.auto", () => {
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export function Counter(label) {
  return expr.auto(() => label, {
    captures: Schema.Struct({ label: Schema.String }),
    bind: { label },
    dependencies: Schema.Tuple([]),
    deps: [],
  });
}
`)
    ).toThrow(/expr\.auto infers captures, so `captures` must not be declared/);
  });

  it("still applies the module-closed check to the dependencies schema", () => {
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
export function Counter(label, LocalSchema) {
  return expr.auto(() => label, {
    dependencies: LocalSchema,
    deps: [],
  });
}
`)
    ).toThrow(
      /The dependencies schema references "LocalSchema" from an enclosing function scope/,
    );
  });

  it("still fails closed on a credential-looking inferred capture", () => {
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export function Counter(apiKey) {
  return expr.auto(() => apiKey, {
    dependencies: Schema.Tuple([]),
    deps: [],
  });
}
`)
    ).toThrow(/Capture property "apiKey" looks like a credential/);
  });

  it("still rejects `this` and `arguments` inside an auto-extracted expression", () => {
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export function Counter() {
  return expr.auto(() => this.label, {
    dependencies: Schema.Tuple([]),
    deps: [],
  });
}
`)
    ).toThrow(/The extracted expression uses `this`/);

    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export function Counter() {
  return expr.auto(() => arguments.length, {
    dependencies: Schema.Tuple([]),
    deps: [],
  });
}
`)
    ).toThrow(/The extracted expression uses `arguments`/);
  });

  it("keeps auto expression identities in their own namespace", () => {
    const output = transform(`
import { extract, expr } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export function Counter(label) {
  registry.push(extract.auto(() => Effect.succeed(label)));
  registry.push(expr.auto(() => label, {
    dependencies: Schema.Tuple([]),
    deps: [],
  }));
}
`);
    const [action, expression] = identities(output);
    expect(action).toMatch(/^src\/todo\.ts#\$[0-9a-z]+$/);
    expect(expression).toMatch(/^src\/todo\.ts#expr\$\$[0-9a-z]+$/);
  });

  it("resolves expr.auto through a namespace import", () => {
    const output = transform(`
import * as PortableExtract from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export function Counter(label) {
  const text = PortableExtract.expr.auto(() => label, {
    dependencies: Schema.Tuple([]),
    deps: [],
  });
  return text;
}
`);
    expect(output).toContain('id: "src/todo.ts#expr$text"');
    expect(output).toMatch(
      /captures: _afSchema\.Struct\(\{\s*label: _afSchema\.Unknown\s*\}\)/,
    );
  });

  it("round-trips lexical captures through the generated expression definition", () => {
    const body = transform(exprAutoFixture)
      .replace(/^import .*$/gm, "")
      .replace(/^export /gm, "");
    const evaluate = new Function(
      "_afSchema",
      "Schema",
      "_afExpressionCode",
      "_afBindExpression",
      `${body}\nreturn Counter;`,
    ) as (
      autoSchema: typeof Schema,
      schema: typeof Schema,
      expressionCode: (definition: unknown) => unknown,
      bindExpression: (
        code: unknown,
        captures: unknown,
        deps: unknown,
      ) => unknown,
    ) => (label: string, count: number) => {
      readonly code: {
        readonly id: string;
        readonly render: (captures: Record<string, unknown>) => string;
      };
      readonly captures: Record<string, unknown>;
      readonly deps: ReadonlyArray<unknown>;
    };
    const Counter = evaluate(
      Schema,
      Schema,
      (definition) => definition,
      (code, captures, deps) => ({ code, captures, deps }),
    );
    const bound = Counter("Save", 2);
    expect(bound.code.id).toBe("src/todo.ts#expr$text");
    expect(bound.captures).toEqual({ label: "Save", count: 2 });
    expect(bound.deps).toEqual(["count:1"]);
    expect(bound.code.render(bound.captures)).toBe("Save2");
  });

  it("leaves explicit expr output free of synthesized captures", () => {
    const output = transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
const label = "Save";
export const countText = expr((captures) => captures.label, {
  captures: Schema.Struct({ label: Schema.String }),
  bind: { label },
  dependencies: Schema.Tuple([Schema.Unknown]),
  deps: ["count:1"],
});
`);
    expect(output).not.toContain("_afSchema");
    expect(output).toContain("captures: Schema.Struct({");
  });
});

describe("portable-extract runtime marker", () => {
  it("fails closed when called without the compiler transform", () => {
    expect(() =>
      extract(() => Effect.succeed(1), {
        captures: Schema.Struct({}),
        bind: {},
      })
    ).toThrow(/companion resume-extract compiler transform/);
  });

  it("fails closed when extract.auto is called without the transform", () => {
    expect(() => extract.auto(() => Effect.succeed(1))).toThrow(
      /extract\.auto\(\.\.\.\) was called without the companion resume-extract/,
    );
  });

  it("fails closed for untransformed fine-grained expressions", () => {
    expect(() =>
      expr(() => "text", {
        captures: Schema.Struct({}),
        bind: {},
        dependencies: Schema.Tuple([]),
        deps: [],
      })
    ).toThrow(/Portable expr\(\.\.\.\).*companion resume-extract/);
  });

  it("fails closed when expr.auto is called without the transform", () => {
    expect(() =>
      expr.auto(() => "text", {
        dependencies: Schema.Tuple([]),
        deps: [],
      })
    ).toThrow(
      /expr\.auto\(\.\.\.\) was called without the companion resume-extract/,
    );
  });
});

describe("resume-extract evaluation-order and context safety", () => {
  it("places top-level definitions before their own statement, preserving declaration order", () => {
    const output = transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
const LabelSchema = Schema.Struct({ label: Schema.String });
export const save = extract((captures) => Effect.succeed(captures.label), {
  captures: LabelSchema,
  bind: { label: "hi" },
});
`);
    const schemaIndex = output.indexOf("const LabelSchema");
    const definitionIndex = output.indexOf("_afPortableCode(");
    const bindIndex = output.indexOf("_afPortableBind(");
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(schemaIndex).toBeLessThan(definitionIndex);
    expect(definitionIndex).toBeLessThan(bindIndex);
  });

  it("preserves earlier declarator initialization before a generated definition", async () => {
    const source = `
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export const LabelSchema = Schema.Struct({ label: Schema.String }),
  save = extract((captures) => Effect.succeed(captures.label), {
    captures: LabelSchema,
    bind: { label: "hi" },
  });
`;
    const output = transform(source);
    const schemaIndex = output.indexOf("const LabelSchema");
    const definitionIndex = output.indexOf("_afPortableCode(");
    const bindIndex = output.indexOf("_afPortableBind(");
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(schemaIndex).toBeLessThan(definitionIndex);
    expect(definitionIndex).toBeLessThan(bindIndex);

    // Ordering is only a proxy. Evaluate the module: hoisting the generated
    // definition ahead of the whole declaration would read `LabelSchema` in
    // its TDZ, which no index comparison can observe.
    const module = await evaluateTransformed(source);
    const save = module.save as Portable.AnyBoundCode;
    expect(Portable.isBoundCode(save)).toBe(true);
    expect(save.code.id).toBe("src/todo.ts#save");
    // The definition really closed over the *initialized* schema, not a
    // placeholder: decoding through it succeeds.
    expect(
      Schema.decodeUnknownSync(save.code.captures as never)({ label: "hi" }),
    ).toEqual({ label: "hi" });
    expect(await Effect.runPromise(
      Portable.execute(save) as Effect.Effect<unknown>,
    )).toBe("hi");
  });

  it("places definitions for deferred calls at the end of the module so later consts are initialized", async () => {
    const source = `
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export function makeSave() {
  return extract((captures) => Effect.succeed(captures.label), {
    captures: LabelSchema,
    bind: { label: "hi" },
  });
}
const LabelSchema = Schema.Struct({ label: Schema.String });
`;
    const output = transform(source);
    const schemaIndex = output.indexOf("const LabelSchema");
    const definitionIndex = output.indexOf("_afPortableCode(");
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(definitionIndex).toBeGreaterThan(schemaIndex);

    // The claim in the test name is a *runtime* claim, so run it. Deferring
    // the definition to the end of the module body is what makes the
    // `LabelSchema` reference inside it legal; emitting it before the `const`
    // would throw here while leaving the index assertion above satisfied.
    const module = await evaluateTransformed(source);
    const made = (module.makeSave as () => Portable.AnyBoundCode)();
    expect(Portable.isBoundCode(made)).toBe(true);
    expect(made.captures).toEqual({ label: "hi" });
    expect(
      Schema.decodeUnknownSync(made.code.captures as never)({ label: "hi" }),
    ).toEqual({ label: "hi" });
    expect(await Effect.runPromise(
      Portable.execute(made) as Effect.Effect<unknown>,
    )).toBe("hi");
  });

  it("places a deferred definition right after its last dependency, so a factory invoked at module scope still works", async () => {
    const source = `
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export function makeSave() {
  return extract((captures) => Effect.succeed(captures.label), {
    captures: LabelSchema,
    bind: { label: "hi" },
  });
}
const LabelSchema = Schema.Struct({ label: Schema.String });
export const first = makeSave();
`;
    // Appending the definition after *every* statement put it after
    // `export const first = makeSave()`, so evaluating the module threw
    // `ReferenceError: Cannot access '_afCode$...' before initialization`.
    // The definition only needs to follow `LabelSchema`, not the whole body.
    const output = transform(source);
    const schemaIndex = output.indexOf("const LabelSchema");
    const definitionIndex = output.indexOf("_afPortableCode(");
    // The call, not the `export function makeSave()` declaration -- which
    // also contains the bare text `makeSave()`.
    const callerIndex = output.indexOf("= makeSave()");
    expect(definitionIndex).toBeGreaterThan(schemaIndex);
    expect(definitionIndex).toBeLessThan(callerIndex);

    const module = await evaluateTransformed(source);
    const first = module.first as Portable.AnyBoundCode;
    expect(Portable.isBoundCode(first)).toBe(true);
    expect(
      Schema.decodeUnknownSync(first.code.captures as never)({ label: "hi" }),
    ).toEqual({ label: "hi" });
    expect(await Effect.runPromise(
      Portable.execute(first) as Effect.Effect<unknown>,
    )).toBe("hi");
  });

  it("keeps a deferred definition after a dependency that follows the caller", async () => {
    // The mirror image: here the schema genuinely is declared after the
    // module-scope call, so no placement can satisfy both. The definition
    // must still follow its dependency, and the *author's* code is what
    // throws -- we must not paper over it by capturing an uninitialized
    // binding.
    const source = `
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export function makeSave() {
  return extract((captures) => Effect.succeed(captures.label), {
    captures: LabelSchema,
    bind: { label: "hi" },
  });
}
export const eager = makeSave();
const LabelSchema = Schema.Struct({ label: Schema.String });
`;
    const output = transform(source);
    expect(output.indexOf("_afPortableCode(")).toBeGreaterThan(
      output.indexOf("const LabelSchema"),
    );
    await expect(evaluateTransformed(source)).rejects.toThrow(
      /before initialization/,
    );
  });

  it("rejects `this` in extracted arrows that inherit enclosing context", () => {
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export class Widget {
  save() {
    return extract(() => Effect.succeed(this.label), {
      captures: Schema.Struct({}),
      bind: {},
    });
  }
}
`)
    ).toThrow(/uses `this`/);
  });

  it("allows `this` inside nested functions that bind their own context", () => {
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export const probe = extract(() => Effect.sync(function probeThis() { return this === undefined; }), {
  captures: Schema.Struct({}),
  bind: {},
});
`)
    ).not.toThrow();
  });

  it("rejects `arguments` in extracted arrows", () => {
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export function makeSave() {
  return extract(() => Effect.succeed(arguments.length), {
    captures: Schema.Struct({}),
    bind: {},
  });
}
`)
    ).toThrow(/uses `arguments`/);
  });
});

describe("resume-extract capture diagnostics", () => {
  const secretFixture = `
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export const login = extract((captures) => Effect.succeed(captures.apiToken), {
  captures: Schema.Struct({ apiToken: Schema.String }),
  bind: { apiToken: "abc123" },
});
`;

  it("rejects credential-looking capture names by default", () => {
    expect(() => transform(secretFixture)).toThrow(
      /Capture property "apiToken" looks like a credential/,
    );
  });

  it("downgrades secret-prone captures to source-located warnings when configured", () => {
    const diagnostics: Array<{ code: string; line?: number }> = [];
    const output = transform(secretFixture, {
      secretCaptureSeverity: "warning",
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(output).toContain('id: "src/todo.ts#login"');
    expect(diagnostics).toMatchObject([
      { code: "secret-prone-capture", severity: "warning" },
    ]);
    expect(diagnostics[0]!.line).toBeGreaterThan(0);
  });

  it("handles stateful custom secret patterns deterministically", () => {
    const diagnostics: Array<{ readonly code: string }> = [];
    transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export const save = extract((captures) => Effect.succeed(captures), {
  captures: Schema.Struct({
    firstToken: Schema.String,
    secondToken: Schema.String,
  }),
  bind: { firstToken: "one", secondToken: "two" },
});
`, {
      secretCaptureSeverity: "warning",
      secretNamePattern: /token/gi,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(diagnostics).toHaveLength(2);
  });

  it("supports disabling and overriding the secret-name heuristic", () => {
    expect(() =>
      transform(secretFixture, { secretCaptureSeverity: "off" })
    ).not.toThrow();
    expect(() =>
      transform(fixture, { secretNamePattern: /label/ })
    ).toThrow(/Capture property "label" looks like a credential/);
  });

  it("warns on oversized bind expressions", () => {
    const bigLiteral = `"${"x".repeat(300)}"`;
    const diagnostics: Array<{ code: string }> = [];
    transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export const big = extract((captures) => Effect.succeed(captures.blob), {
  captures: Schema.Struct({ blob: Schema.String }),
  bind: { blob: ${bigLiteral} },
});
`, {
      maxBindSourceLength: 128,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(diagnostics).toMatchObject([{ code: "oversized-bind" }]);
  });

  it("stays quiet for ordinary binds under the ceiling", () => {
    const diagnostics: Array<unknown> = [];
    transform(fixture, { onDiagnostic: (d) => diagnostics.push(d) });
    expect(diagnostics).toEqual([]);
  });
});

describe("M8 audit pins (2026-07-29)", () => {
  // Audit finding: expression identity is scope-blind — two `const label =
  // expr(...)` in different functions of one module both emit
  // `mod#expr$label` under one portable id. The Babel plugin should reject
  // the intra-module duplicate itself (the Vite layer only catches
  // cross-module collisions).
  it("rejects duplicate intra-module expression identities in the transform", () => {
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export function A(count) {
  const label = expr((_c, [v]) => "A: " + v, {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([Schema.Number]),
    deps: [count],
  });
  return label;
}
export function B(count) {
  const label = expr((_c, [v]) => "B: " + v, {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([Schema.Number]),
    deps: [count],
  });
  return label;
}
`)
    ).toThrow(/duplicate|collision|already/i);
  });

  it("rejects a const-derived extract identity reused across scopes", () => {
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export const save = extract(() => Effect.void, {
  captures: Schema.Struct({}),
  bind: {},
});
export function again() {
  const save = extract(() => Effect.void, {
    captures: Schema.Struct({}),
    bind: {},
  });
  return save;
}
`)
    ).toThrow(/duplicate|collision|already/i);
  });

  it("keeps distinct const names in different functions working", () => {
    const output = transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export function A(count) {
  const labelA = expr((_c, [v]) => "A: " + v, {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([Schema.Number]),
    deps: [count],
  });
  return labelA;
}
export function B(count) {
  const labelB = expr((_c, [v]) => "B: " + v, {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([Schema.Number]),
    deps: [count],
  });
  return labelB;
}
`);
    expect(output).toContain('id: "src/todo.ts#expr$labelA"');
    expect(output).toContain('id: "src/todo.ts#expr$labelB"');
  });

  it("leaves content-hashed identities unaffected by the collision check", () => {
    const output = transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export function A(count) {
  return expr((_c, [v]) => "A: " + v, {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([Schema.Number]),
    deps: [count],
  });
}
export function B(count) {
  return expr((_c, [v]) => "B: " + v, {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([Schema.Number]),
    deps: [count],
  });
}
`);
    // Distinct bodies hash apart, so the collision check never fires.
    const [a, b] = identities(output);
    expect(a).toMatch(/^src\/todo\.ts#expr\$\$[0-9a-z]+$/);
    expect(b).toMatch(/^src\/todo\.ts#expr\$\$[0-9a-z]+$/);
    expect(a).not.toBe(b);
  });
});

// ─── Milestone 8c.3 — the JSX directive seam ─────────────────────────────────

/**
 * JSX fixtures need the syntax plugin; the extraction transform runs *before*
 * the JSX compiler, so the assertions below are about the JSX it hands on.
 */
function transformJsx(
  body: string,
  options: Partial<ResumeExtractOptions> = {},
): string {
  const result = babel.transformSync(
    `import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";

const label = "hi";
const authoredRef = (element) => element;
export const view = () => (${body});
`,
    {
      filename: "C:/app/src/view.tsx",
      babelrc: false,
      configFile: false,
      plugins: [
        "@babel/plugin-syntax-jsx",
        [
          resumeExtractPlugin,
          { buildId: "build-1", root: "C:/app", ...options },
        ],
      ],
    },
  );
  if (result?.code == null) throw new Error("Babel produced no output.");
  return result.code;
}

/** One `expr(...)` marker call, parameterized by dependency key. */
const exprCall = (key: string) =>
  `expr(() => label + "${key}", { captures: Schema.Struct({ label: Schema.String }), `
  + `bind: { label }, dependencies: Schema.Tuple([Schema.Unknown]), deps: ["${key}"] })`;

const dense = (code: string) => code.replace(/\s+/g, "");
const occurrences = (code: string, needle: string) =>
  dense(code).split(needle).length - 1;

describe("resume-extract JSX directive seam", () => {
  it("emits one directive attachment per host element carrying [expression, target] pairs", () => {
    const output = transformJsx(
      `<div ref={authoredRef} id="static" data-count={label} title={${
        exprCall("k0")
      }} class={${exprCall("k1")}} />`,
    );
    // Per-element grouping: the v4 marker already lists several instance ids,
    // so one attachment per element keeps generated code and wire in step.
    expect(occurrences(output, "resumeExprDirective")).toBe(1);
    expect(dense(output)).toContain('{kind:"attribute",name:"title"}');
    expect(dense(output)).toContain('{kind:"class"}');
    // Target metadata reaches the directive, never the HTML.
    expect(output).not.toContain("data-af-expr");
    // Coexistence: authored ref, reactive attribute, static attribute survive.
    expect(output).toContain("authoredRef");
    expect(dense(output)).toContain('id="static"');
    expect(dense(output)).toContain("data-count={label}");
    // The lowered attributes are gone; the directive owns them now.
    expect(dense(output)).not.toContain("title={_afBindExpression");
    // The directive is namespace-imported so no bare binding enters author
    // scope and the ABI name is spelled exactly once per host element.
    expect(output).toContain('import * as _afExprDirectives from "effect-atom-jsx/dom"');
  });

  it("emits one attachment per element, not per render", () => {
    const output = transformJsx(
      `<div><span title={${exprCall("k0")}} /><span class={${
        exprCall("k1")
      }} /></div>`,
    );
    expect(occurrences(output, "resumeExprDirective")).toBe(2);
  });

  it("attaches nothing to an element without a resumable expression", () => {
    const output = transformJsx(`<div ref={authoredRef} title={label} />`);
    expect(occurrences(output, "resumeExprDirective")).toBe(0);
    expect(output).not.toContain("_afExprDirectives");
  });

  it("supports a single allowlisted style property", () => {
    const output = transformJsx(`<div style:opacity={${exprCall("k")}} />`);
    expect(dense(output)).toContain('{kind:"style-property",name:"opacity"}');
    // Custom properties are allowlisted by the target schema but are not
    // authorable as `style:--x`: JSX identifiers may not begin with `-`.
    // They remain reachable through the `dom.exprStyleProperty` helper.
  });

  it("honors the directiveModule option", () => {
    const output = transformJsx(`<div title={${exprCall("k")}} />`, {
      directiveModule: "./local-dom.js",
    });
    expect(output).toContain('import * as _afExprDirectives from "./local-dom.js"');
  });

  it("leaves text lowering unchanged", () => {
    const output = transformJsx(`<span>{${exprCall("k")}}</span>`);
    expect(occurrences(output, "resumeExprDirective")).toBe(0);
    expect(output).toContain("_afBindExpression(");
  });

  it("leaves ordinary non-JSX expr calls unchanged", () => {
    const output = transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
export const bound = expr(() => "text", {
  captures: Schema.Struct({}),
  bind: {},
  dependencies: Schema.Tuple([]),
  deps: [],
});
`);
    expect(output).not.toContain("resumeExprDirective");
  });

  it("rejects unsupported JSX target kinds with a source location", () => {
    const cases: ReadonlyArray<readonly [string, RegExp]> = [
      // Executable code is never resumable.
      [`<button onClick={${exprCall("k")}} />`, /event handlers/],
      [`<button on:click={${exprCall("k")}} />`, /event handlers/],
      // A whole style object or class list hides the target name.
      [`<div style={${exprCall("k")}} />`, /whole style object/],
      [`<div classList={${exprCall("k")}} />`, /class-list objects/],
      // A spread hides it entirely.
      [`<div {...${exprCall("k")}} />`, /JSX spread/],
      // URL-bearing and unlisted attributes stay fenced.
      [`<a href={${exprCall("k")}} />`, /not an allowlisted attribute/],
      [`<img src={${exprCall("k")}} />`, /not an allowlisted attribute/],
      // DOM properties have no security contract yet.
      [`<div prop:innerHTML={${exprCall("k")}} />`, /DOM properties are fenced/],
      // Unlisted style properties.
      [
        `<div style:background-image={${exprCall("k")}} />`,
        /not an allowlisted style property/,
      ],
      // Structural positions.
      [`<div ref={${exprCall("k")}} />`, /structural position/],
      [`<Child title={${exprCall("k")}} />`, /only supported on host elements/],
      // Nested inside a larger attribute expression.
      [
        `<div title={cond ? ${exprCall("k")} : "x"} />`,
        /whole JSX attribute value/,
      ],
    ];
    for (const [body, message] of cases) {
      let thrown: unknown;
      try {
        transformJsx(body);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `expected a compile error for ${body}`).toBeInstanceOf(
        Error,
      );
      expect(String((thrown as Error).message)).toMatch(message);
      // Source-located: the diagnostic names the file the author wrote.
      expect(String((thrown as Error).message)).toContain("view.tsx");
    }

    // NEGATIVE CONTROL. A supported context still compiles, so "reject
    // everything" cannot satisfy the loop above.
    expect(() => transformJsx(`<div title={${exprCall("k")}} />`)).not.toThrow();
  });

  it("refuses to compose with the variable-assignment ref form", () => {
    expect(() =>
      babel.transformSync(
        `import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
const label = "hi";
export const view = () => {
  let host;
  return <div ref={host} title={${exprCall("k")}} />;
};
`,
        {
          filename: "C:/app/src/view.tsx",
          babelrc: false,
          configFile: false,
          plugins: [
            "@babel/plugin-syntax-jsx",
            [resumeExtractPlugin, { buildId: "build-1", root: "C:/app" }],
          ],
        },
      )
    ).toThrow(/variable-assignment ref form/);
  });

  it("produces identical output across repeated builds", () => {
    const body = `<div title={${exprCall("k0")}} class={${exprCall("k1")}} />`;
    expect(transformJsx(body)).toBe(transformJsx(body));
  });
});

describe("resume-extract plugin allowlist parity", () => {
  // 8c.3/8c.4 left the expression target allowlist in three places: the
  // runtime source of truth (`resume-expression.ts`), the branded wire schemas
  // (`Resume.ts`, linked to it at compile time), and the Babel plugin's
  // deliberate build-time duplicate. The plugin copy is the only unlinked one,
  // because a real import would pull `effect` and the reactivity runtime into
  // the published plugin -- so it is checked here instead. A widening that
  // touches only one side fails this test rather than shipping a compiler that
  // emits targets the wire rejects (or, worse, rejects targets the wire
  // accepts).
  it("matches resume-expression.ts exactly", () => {
    expect([...expressionTargetAllowlists.attributes].sort()).toEqual(
      [...ExpressionAttributeNames].sort(),
    );
    expect([...expressionTargetAllowlists.styleProperties].sort()).toEqual(
      [...ExpressionNamedStylePropertyNames].sort(),
    );
    expect(expressionTargetAllowlists.customStylePropertyPattern.source).toBe(
      ExpressionCustomStylePropertyPattern.source,
    );
    expect(expressionTargetAllowlists.customStylePropertyPattern.flags).toBe(
      ExpressionCustomStylePropertyPattern.flags,
    );
  });

  it("agrees with the runtime predicates on every allowlisted name", () => {
    for (const name of expressionTargetAllowlists.attributes) {
      expect(isExpressionAttributeName(name)).toBe(true);
    }
    for (const name of expressionTargetAllowlists.styleProperties) {
      expect(isExpressionStylePropertyName(name)).toBe(true);
    }
    // NEGATIVE CONTROL: a name neither side allows.
    expect(isExpressionAttributeName("href")).toBe(false);
    expect(expressionTargetAllowlists.attributes.has("href")).toBe(false);
  });

  it("keeps the plugin free of value imports", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../compiler/resume-extract-plugin.ts", import.meta.url),
      "utf8",
    );
    // The parity check above is only *necessary* because the plugin imports
    // nothing but Babel types. If that ever stops being true, prefer a real
    // import over the duplicate.
    const imports = source.match(/^import .*$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const statement of imports) {
      expect(statement.startsWith("import type ")).toBe(true);
    }
    // `^import ...` alone cannot see the two other ways a value dependency
    // gets in. Neither is used today, so these guard the drift the check
    // exists to catch rather than describing current code.
    const reExports = source.match(/^export\s[^\n]*\sfrom\s/gm) ?? [];
    for (const statement of reExports) {
      expect(statement.startsWith("export type ")).toBe(true);
    }
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });

  it("catches a value dependency the plain import scan would miss", () => {
    // NEGATIVE CONTROL for the guard above: the same predicates applied to
    // sources that *do* smuggle a value dependency must reject them, so the
    // guard is not vacuously satisfied by the current file's shape.
    const scan = (source: string): boolean => {
      const imports = source.match(/^import .*$/gm) ?? [];
      const reExports = source.match(/^export\s[^\n]*\sfrom\s/gm) ?? [];
      return imports.every((s) => s.startsWith("import type "))
        && reExports.every((s) => s.startsWith("export type "))
        && !/\bimport\s*\(/.test(source)
        && !/\brequire\s*\(/.test(source);
    };
    expect(scan(`import type * as Babel from "@babel/core";\n`)).toBe(true);
    expect(scan(`export type { X } from "./x.js";\n`)).toBe(true);
    expect(scan(`import { Schema } from "effect";\n`)).toBe(false);
    expect(scan(`export { Schema } from "effect";\n`)).toBe(false);
    expect(scan(`const s = await import("effect");\n`)).toBe(false);
    expect(scan(`const s = require("effect");\n`)).toBe(false);
  });
});
