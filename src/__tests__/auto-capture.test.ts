/**
 * M10.1 — `extract.auto` / `expr.auto` capture synthesis. Promoted from
 * `future/streaming/auto-capture.spec.ts` (all green 2026-08-11), retyped.
 *
 * What these pin is the POLICY, because that is the part a refactor can
 * quietly weaken: inference is reported (so diagnostics can say the wire
 * types are runtime-validated rather than declared); `this` and secret-named
 * captures stay hard errors even when inferred; dependency identity is never
 * inferred for `expr.auto`; and — the acceptance criterion that needed the
 * M10.2 universal codec — an inferred `Map`/cyclic capture round-trips
 * without a hand-written schema.
 */
import * as babel from "@babel/core";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import resumeExtractPlugin, {
  type ResumeExtractEntry,
  type ResumeExtractOptions,
} from "../compiler/resume-extract-plugin.js";
import * as Portable from "../Portable.js";
import * as Serialization from "../Serialization.js";

function transform(
  source: string,
  options: Partial<ResumeExtractOptions> = {},
  filename = "C:/app/src/auto.ts",
): {
  readonly code: string;
  readonly entries: ResumeExtractEntry[];
} {
  const entries: ResumeExtractEntry[] = [];
  const result = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    plugins: [[
      resumeExtractPlugin,
      {
        buildId: "build-auto",
        root: "C:/app",
        onCode: (entry: ResumeExtractEntry) => entries.push(entry),
        ...options,
      } satisfies Partial<ResumeExtractOptions> & { buildId: string },
    ]],
  });
  if (result?.code == null) throw new Error("Babel produced no output.");
  return { code: result.code, entries };
}

describe("auto capture synthesis (M10.1)", () => {
  it("synthesizes captures and bind from inferred identifiers and reports them", () => {
    const { code, entries } = transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
function make(label, count) {
  return extract.auto(() => Effect.succeed(label + count));
}
`);

    // Both captures are inferred, in first-reference order.
    expect(entries).toHaveLength(1);
    expect(entries[0]!.inferredCaptures).toEqual(["label", "count"]);
    // A synthesized schema struct, not a hand-written one …
    expect(code).toMatch(/captures:[\s\S]*Struct\(\{[\s\S]*label[\s\S]*count/);
    // … and a call-site bind carrying the live values.
    expect(code).toMatch(/\{\s*label,?\s*count,?\s*\}/);
    // The lowering consumed the marker call entirely.
    expect(code).not.toContain("extract.auto");
  });

  it("still rejects `this` and secret-named captures in auto mode", () => {
    // The negative control is the first spec: an ordinary `extract.auto`
    // with inferred captures compiles, so "reject every auto call" cannot
    // pass both.
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
const handler = { run() { return extract.auto(() => Effect.succeed(this.value)); } };
`)
    ).toThrow(/this/i);

    // Captures are embedded in server HTML, so a credential-looking inferred
    // name is a compile error by default, exactly as for explicit captures.
    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
function make(apiKey) {
  return extract.auto(() => Effect.succeed(apiKey));
}
`)
    ).toThrow(/api[-_]?key|secret/i);
  });

  it("refuses to infer expression dependencies", () => {
    // `dependencies`/`deps` are required: a missed or spurious dependency
    // edge is a correctness bug no heuristic may introduce.
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
const view = expr.auto((deps) => String(deps[0]));
`)
    ).toThrow(/dependencies|deps/i);

    // And declaring captures alongside auto inference is an error, not a
    // merge.
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
const label = "x";
const view = expr.auto((deps) => String(deps[0]), {
  dependencies: Schema.Tuple([Schema.Number]),
  deps: ["count"],
  captures: Schema.Struct({ label: Schema.String }),
  bind: { label },
});
`)
    ).toThrow(/captures|bind/i);

    // NEGATIVE CONTROL: dependencies declared, captures inferred — compiles.
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
const label = "x";
const view = expr.auto((deps) => label + String(deps[0]), {
  dependencies: Schema.Tuple([Schema.Number]),
  deps: ["count"],
});
`)
    ).not.toThrow();
  });

  it("round-trips an inferred Map/cyclic capture without a hand-written schema", async () => {
    // What `extract.auto` generates: an Unknown-typed capture struct. A Map
    // and a cycle fail the plain-JSON gate, so the descriptor rides the
    // universal codec envelope (M10.2) — stamped with the layer id, restored
    // by the same layer, refused by any other.
    const code = Portable.code({
      id: "test.m10.auto.roundtrip",
      buildId: "build-auto",
      captures: Schema.Struct({ index: Schema.Unknown, self: Schema.Unknown }),
      run: (captures) => Effect.succeed(captures),
    });
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    const bound = Portable.bind(code, {
      index: new Map([["a", 1]]),
      self: cyclic,
    });

    const descriptor = await Effect.runPromise(
      Portable.describe(bound).pipe(Effect.provide(Serialization.serovalLayer)),
    );
    // Over the wire as inert JSON — a tree, never an eval string.
    const wire = JSON.stringify(descriptor);
    expect(wire).not.toContain("function");
    const decoded = await Effect.runPromise(
      Portable.decodeDescriptor(JSON.parse(wire)),
    );
    const resolved = await Effect.runPromise(
      Portable.resolve<readonly [], unknown, unknown, never>(decoded as Portable.Descriptor<readonly [], unknown, unknown, never>).pipe(
        Effect.provide(Portable.resolverLayer({ [code.id]: code })),
        Effect.provide(Serialization.serovalLayer),
      ),
    );
    const captures = (await Effect.runPromise(resolved.run())) as {
      readonly index: Map<string, number>;
      readonly self: { readonly self: unknown };
    };

    // A live Map and a cycle survive as VALUES — not strings, not flattened
    // into something merely JSON-shaped.
    expect(captures.index instanceof Map).toBe(true);
    expect(captures.index.get("a")).toBe(1);
    expect(captures.self.self).toBe(captures.self);
  });
});
