/**
 * Slices 4–6 end state: one model, one projection module.
 *
 * These are the plan's own acceptance criteria 1, 2 and 5 written as assertions.
 * Two of them read source text, which normally violates "assert behaviour, not
 * implementation" — but here the *absence of a second model* and the *absence of
 * a second copy of the mapping* IS the deliverable, and there is no runtime
 * observation that distinguishes "one mapping" from "three identical mappings".
 * They are scoped as narrowly as possible: module graph and import edges only,
 * never internals.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc } from "../harness.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

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
 * Every "no offenders" assertion below is a scan over `src/`, and an empty scan
 * would satisfy all of them at once. So each spec first asserts the scan actually
 * saw the tree: without this, a broken `srcDir`, a renamed folder, or a `readdir`
 * that silently returns nothing turns the whole file green for the wrong reason.
 */
const scanned = () => {
  const files = sourceFiles();
  expect(files.length).toBeGreaterThan(20);
  expect(files.map(rel)).toContain("index.ts");
  return files;
};

describe("one Result model", () => {
  it("[Slice 5] `FetchResult` and the fetch model are gone from src/", async () => {
    const offenders = scanned()
      .filter((file) => readFileSync(file, "utf8").includes("FetchResult"))
      .map(rel);
    expect(offenders).toEqual([]);

    // The module itself is either absent or reclaimed for the core model
    // (Slice 6): what must never exist again is the fetch model's API.
    let fetchModel: Record<string, unknown> | undefined;
    try {
      fetchModel = await loadSrc("Result");
    } catch {
      fetchModel = undefined;
    }
    if (fetchModel !== undefined) {
      expect(Object.keys(fetchModel)).not.toContain("fromResult");
      expect(Object.keys(fetchModel)).not.toContain("toResult");
      expect(Object.keys(fetchModel)).not.toContain("initial");
      expect(Object.keys(fetchModel)).not.toContain("fromExitWithPrevious");
    }
  });

  it("[Slice 5] the package no longer exports a second result model", async () => {
    const index = await loadSrc("index");
    expect(Object.keys(index)).not.toContain("FetchResult");
    // …and the surviving model is reachable, with the ported ergonomics on it.
    const { Result } = await fromSrc("effect-ts", "Result");
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

  it("[Risk 5] `ResultErrorOf` no longer strips the deleted model's untagged defect arm", async () => {
    // `Exclude<E, { readonly defect: string }>` existed only to strip
    // `FetchResult.Failure`'s untagged defect arm. With the model gone it is
    // either dead (remove it) or actively wrong for a core error type that
    // legitimately has a `defect: string` member. Either way the text must not
    // survive unexplained — Slice 4 owes a decision plus a JSDoc note.
    const atom = readFileSync(join(srcDir, "Atom.ts"), "utf8");
    expect(atom).not.toContain("{ readonly defect: string }");
  });
});

describe("one wire projection", () => {
  it("[Decision 3] exactly one module constructs or interprets the flat DTO", async () => {
    // `previousSuccess` is the DTO's distinctive field: only the projection
    // module may mention it. Anything else naming it is a hand-rolled mapping,
    // which the plan calls a review-blocking defect.
    const offenders = scanned()
      .filter((file) => rel(file) !== "result-wire.ts")
      .filter((file) => readFileSync(file, "utf8").includes("previousSuccess"))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("[Decision 3] only Serialization re-exports the wire schema", async () => {
    const allowed = new Set(["result-wire.ts", "Serialization.ts"]);
    const offenders = scanned()
      .filter((file) => !allowed.has(rel(file)))
      .filter((file) => /\bResultWire\b/.test(readFileSync(file, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("[Slice 2] the projection module depends on neither the fetch model nor Serialization", async () => {
    const wire = readFileSync(join(srcDir, "result-wire.ts"), "utf8");
    expect(wire).not.toMatch(/from\s+["']\.\/Result\.js["']/);
    expect(wire).not.toMatch(/from\s+["']\.\/Serialization\.js["']/);
  });

  it("[Slice 5] `Serialization` re-exports stay import-compatible", async () => {
    // Deleting the fetch model must not move any historic import path.
    const s = await fromSrc(
      "Serialization",
      "ResultWire",
      "ResultWireRecord",
      "resultToWire",
      "resultFromWire",
      "encodeResult",
      "decodeResult",
      "encodeResultRecord",
      "decodeResultRecord",
    );
    const { toWire, fromWire } = await fromSrc("result-wire", "toWire", "fromWire");
    // Re-exports must be the same functions, not a second copy.
    expect(s.resultToWire).toBe(toWire);
    expect(s.resultFromWire).toBe(fromWire);
  });
});
