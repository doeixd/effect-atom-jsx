/**
 * M10 item 1 — `extract.auto` / `expr.auto` capture synthesis.
 *
 * The transform slice is landed: the module-closed check flips from rejecting
 * captured outer identifiers to collecting them, and synthesizes
 * `captures: Schema.Struct({ … Schema.Unknown })`, a call-site `bind`, and a
 * wrapper `run`. What these specs pin is the *policy*, because that is the part
 * a refactor can quietly weaken:
 *
 *   - inference is reported, so diagnostics can say the wire types are
 *     runtime-validated rather than declared;
 *   - `this` / `super` / `arguments` stay hard errors;
 *   - secret-named captures stay hard errors even when inferred;
 *   - dependency identity is never inferred for `expr.auto`.
 */

import * as babel from "@babel/core";
import { describe, expect, it } from "vitest";
import { unbuilt } from "../harness.js";
import { srcModule } from "./support.js";

async function transformer() {
  const plugin = await srcModule("compiler/resume-extract-plugin");
  return (
    source: string,
    options: Record<string, unknown> = {},
    filename = "C:/app/src/auto.ts",
  ): { readonly code: string; readonly entries: any[]; readonly diagnostics: any[] } => {
    const entries: any[] = [];
    const diagnostics: any[] = [];
    const result = babel.transformSync(source, {
      filename,
      babelrc: false,
      configFile: false,
      plugins: [
        [
          plugin.default ?? plugin,
          {
            buildId: "build-auto",
            root: "C:/app",
            onCode: (entry: any) => entries.push(entry),
            onDiagnostic: (diagnostic: any) => diagnostics.push(diagnostic),
            ...options,
          },
        ],
      ],
    });
    if (result?.code == null) throw new Error("Babel produced no output.");
    return { code: result.code, entries, diagnostics };
  };
}

describe("auto capture synthesis (M10.1)", () => {
  it("[M10.1] synthesizes captures and bind from inferred identifiers and reports them", async () => {
    const transform = await transformer();
    const { code, entries } = transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
function make(label, count) {
  return extract.auto(() => Effect.succeed(label + count));
}
`);

    // Both captures are inferred, in first-reference order.
    expect(entries).toHaveLength(1);
    expect(entries[0].inferredCaptures).toEqual(["label", "count"]);
    // A synthesized schema struct, not a hand-written one …
    expect(code).toMatch(/captures:[\s\S]*Struct\(\{[\s\S]*label[\s\S]*count/);
    // … and a call-site bind carrying the live values.
    expect(code).toMatch(/\{\s*label,?\s*count,?\s*\}/);
    // The run wrapper destructures captures, so the original body is unchanged
    // in meaning: no free variables left dangling in the extracted module.
    expect(code).toContain("label");
    expect(code).not.toContain("extract.auto");
  });

  it("[M10.1] still rejects `this` and secret-named captures in auto mode", async () => {
    // The negative control for this spec is the first one in this file: an
    // ordinary `extract.auto` with inferred `label`/`count` captures compiles
    // and lowers, so "reject every auto call" cannot pass both.
    const transform = await transformer();

    expect(() =>
      transform(`
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect } from "effect";
const handler = { run() { return extract.auto(() => Effect.succeed(this.value)); } };
`),
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
`),
    ).toThrow(/api[-_]?key|secret/i);
  });

  it("[M10.1] refuses to infer expression dependencies", async () => {
    const transform = await transformer();

    // `dependencies`/`deps` are required: a missed or spurious dependency edge
    // is a correctness bug no heuristic may introduce.
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
const view = expr.auto((deps) => String(deps[0]));
`),
    ).toThrow(/dependencies|deps/i);

    // And declaring captures alongside them is an error, not a merge.
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
`),
    ).toThrow(/captures|bind/i);

    // NEGATIVE CONTROL. `expr.auto` with its dependency edge declared and its
    // captures left to inference compiles. Without this, a transform that
    // rejected every `expr.auto` call would satisfy both assertions above.
    expect(() =>
      transform(`
import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";
const label = "x";
const view = expr.auto((deps) => label + String(deps[0]), {
  dependencies: Schema.Tuple([Schema.Number]),
  deps: ["count"],
});
`),
    ).not.toThrow();
  });

  it("[M10.1] round-trips an inferred Map/cyclic capture without a hand-written schema", async () => {
    // The acceptance criterion that closes item 1, and the only one that needs
    // item 2: `Schema.Unknown` captures are JSON-validated today, so a Map or a
    // cycle is rejected at describe time until the universal codec lands.
    const Serialization = await srcModule("Serialization");
    if (Serialization.serovalLayer === undefined) {
      unbuilt(
        "Serialization.serovalLayer — inferred captures need the universal "
          + "codec before Map/Set/Date/cyclic values can round-trip",
        "M10 item 2",
      );
    }

    const { Effect, Schema } = await import("effect");
    const Portable = await srcModule("Portable");
    // What `extract.auto` generates: an Unknown-typed capture struct.
    const code = Portable.code({
      id: "future.m10.auto.roundtrip",
      buildId: "build-auto",
      captures: Schema.Struct({ index: Schema.Unknown, self: Schema.Unknown }),
      run: (captures: any) => Effect.succeed(captures),
    });
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    const bound = Portable.bind(code, {
      index: new Map([["a", 1]]),
      self: cyclic,
    });

    const descriptor = await Effect.runPromise(
      Portable.describe(bound).pipe(
        Effect.provide(Serialization.serovalLayer),
      ) as any,
    );
    // Over the wire as inert JSON — a tree, never an eval string.
    const wire = JSON.stringify(descriptor);
    expect(wire).not.toContain("function");
    const decoded = await Effect.runPromise(
      Portable.decodeDescriptor(JSON.parse(wire)).pipe(
        Effect.provide(Serialization.serovalLayer),
      ) as any,
    );
    const resolved = await Effect.runPromise(
      Portable.resolve(decoded).pipe(
        Effect.provide(Portable.resolverLayer({ [code.id]: code })),
        Effect.provide(Serialization.serovalLayer),
      ) as any,
    );
    const captures: any = await Effect.runPromise((resolved as any).run() as any);

    // A live Map and a cycle survive as values — not as strings, and not
    // flattened into something merely JSON-shaped.
    expect(captures.index instanceof Map).toBe(true);
    expect(captures.index.get("a")).toBe(1);
    expect(captures.self.self).toBe(captures.self);
  });
});
