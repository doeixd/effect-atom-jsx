/**
 * Slices 4–6 end state: one Result model, one wire projection module.
 * Promoted from `future/result/unification.spec.ts` (all green 2026-08-12,
 * after Slices 4–5 deleted the fetch model), retyped.
 *
 * These are `docs/RESULT_UNIFICATION_PLAN.md`'s own acceptance criteria 1, 2
 * and 5 written as assertions. Two of them read source text, which normally
 * violates "assert behaviour, not implementation" — but here the ABSENCE of a
 * second model and of a second copy of the mapping IS the deliverable, and no
 * runtime observation distinguishes "one mapping" from "three identical
 * mappings". They are scoped as narrowly as possible: module graph and import
 * edges only, never internals.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as index from "../index.js";
import * as Serialization from "../Serialization.js";
import { Result } from "../effect-ts.js";
import { toWire, fromWire } from "../result-wire.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string = srcDir, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "type-tests") continue;
      sourceFiles(full, acc);
    } else if (entry.name.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

const rel = (path: string) => path.slice(srcDir.length + 1).replaceAll("\\", "/");

/**
 * Every "no offenders" assertion below is a scan over `src/`, and an empty
 * scan would satisfy all of them at once — so each spec first asserts the
 * scan actually saw the tree.
 */
const scanned = () => {
  const files = sourceFiles();
  expect(files.length).toBeGreaterThan(20);
  expect(files.map(rel)).toContain("index.ts");
  return files;
};

describe("one Result model", () => {
  it("[Slice 5] `FetchResult` and the fetch model are gone from src/", () => {
    const offenders = scanned()
      .filter((file) => readFileSync(file, "utf8").includes("FetchResult"))
      .map(rel);
    expect(offenders).toEqual([]);
    // The fetch model's module is gone (Slice 6 may later reclaim the
    // filename for the core model; what must never return is the fetch API).
    expect(existsSync(join(srcDir, "Result.ts"))).toBe(false);
  });

  it("[Slice 5] the package no longer exports a second result model", () => {
    expect(Object.keys(index)).not.toContain("FetchResult");
    // …and the surviving model is reachable, with the ported ergonomics.
    for (const capability of [
      "loading",
      "refreshing",
      "success",
      "failure",
      "stale",
      "defect",
      "settled",
      "fromExit",
      "toExit",
      "toOption",
      "getData",
      "getError",
      "rawCause",
      "match",
      "map",
      "flatMap",
      "getOrElse",
      "getOrThrow",
      "builder",
      "all",
    ]) {
      expect(Object.keys(Result)).toContain(capability);
    }
  });

  it("[Risk 5] `ResultErrorOf` no longer strips the deleted model's untagged defect arm", () => {
    // `Exclude<E, { readonly defect: string }>` existed only to strip the
    // fetch model's untagged defect arm. With the model gone it would be
    // actively wrong for a core error type that legitimately has a `defect`
    // member — the type tests in `type-tests/atom-type-axes.ts` pin the
    // preserved inference.
    const atom = readFileSync(join(srcDir, "Atom.ts"), "utf8");
    expect(atom).not.toContain("{ readonly defect: string }");
  });
});

describe("one wire projection", () => {
  it("[Decision 3] exactly one module constructs or interprets the flat DTO", () => {
    // `previousSuccess` is the DTO's distinctive field: only the projection
    // module may mention it. Anything else naming it is a hand-rolled
    // mapping, which the plan calls a review-blocking defect.
    const offenders = scanned()
      .filter((file) => rel(file) !== "result-wire.ts")
      .filter((file) => readFileSync(file, "utf8").includes("previousSuccess"))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("[Decision 3] only Serialization re-exports the wire schema", () => {
    // Consuming the schema THROUGH the sanctioned re-export
    // (`Serialization.ResultWire`) is what the plan prescribes; what must
    // not exist is a second copy or a direct import around Serialization.
    const allowed = new Set(["result-wire.ts", "Serialization.ts"]);
    const offenders = scanned()
      .filter((file) => !allowed.has(rel(file)))
      .filter((file) => {
        const text = readFileSync(file, "utf8").replaceAll(
          /Serialization\.ResultWire/g,
          "",
        );
        return /\bResultWire\b/.test(text);
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("[Slice 2] the projection module depends on neither the fetch model nor Serialization", () => {
    const wire = readFileSync(join(srcDir, "result-wire.ts"), "utf8");
    expect(wire).not.toMatch(/from\s+["']\.\/Result\.js["']/);
    expect(wire).not.toMatch(/from\s+["']\.\/Serialization\.js["']/);
  });

  it("[Slice 5] `Serialization` re-exports stay import-compatible", () => {
    // Deleting the fetch model must not move any historic import path.
    expect(Serialization.ResultWire).toBeDefined();
    expect(Serialization.ResultWireRecord).toBeDefined();
    expect(Serialization.encodeResult).toBeTypeOf("function");
    expect(Serialization.decodeResult).toBeTypeOf("function");
    expect(Serialization.encodeResultRecord).toBeTypeOf("function");
    expect(Serialization.decodeResultRecord).toBeTypeOf("function");
    // Re-exports are the same functions, not a second copy.
    expect(Serialization.resultToWire).toBe(toWire);
    expect(Serialization.resultFromWire).toBe(fromWire);
  });
});
