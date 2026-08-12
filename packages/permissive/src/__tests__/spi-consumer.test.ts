/**
 * S2 (`docs/PERMISSIVE_PACKAGE_PLAN.md`) — the workspace scaffold's two
 * contracts:
 *
 *  1. this package is a genuine external-style SPI consumer: it resolves the
 *     core through the published `effect-atom-jsx` subpaths and fails closed
 *     on an SPI version mismatch;
 *  2. it stays that way: every import in `src/` must be either relative
 *     within the package, `effect`, or a subpath `effect-atom-jsx` actually
 *     publishes in its `exports` map. A deep import (`effect-atom-jsx/src/…`,
 *     `effect-atom-jsx/dist/…`, a `../../../src` escape) fails here, because
 *     the moment one lands the package stops proving the SPI is sufficient.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SpiVersionMismatchError,
  assertSpiCompatible,
  spiVersion,
  supportedSpiVersion,
} from "../index.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const repoRoot = path.resolve(packageRoot, "..", "..");

describe("@affe/permissive scaffold", () => {
  it("consumes the core through the published adapter-spi subpath", () => {
    // The re-exported spiVersion is the core's own value, reached through
    // workspace resolution of the published subpath — not a copy.
    expect(spiVersion).toBe(supportedSpiVersion);
    expect(() => assertSpiCompatible()).not.toThrow();

    // The mismatch error is typed and names both sides, so a startup failure
    // in an app log is actionable without a debugger.
    const error = new SpiVersionMismatchError("af.resume-spi.v0", spiVersion);
    expect(error._tag).toBe("SpiVersionMismatchError");
    expect(error.message).toContain("af.resume-spi.v0");
    expect(error.message).toContain(spiVersion);
  });

  it("imports only public effect-atom-jsx subpaths — never src/ or dist/ deep imports", () => {
    const corePkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { readonly name: string; readonly exports: Record<string, unknown> };
    expect(corePkg.name).toBe("effect-atom-jsx");
    const publishedSubpaths = new Set(
      Object.keys(corePkg.exports).map((key) =>
        key === "." ? "effect-atom-jsx" : `effect-atom-jsx/${key.slice(2)}`,
      ),
    );

    const sourceFiles: Array<string> = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(full);
      }
    };
    walk(path.join(packageRoot, "src"));
    expect(sourceFiles.length).toBeGreaterThan(0);

    const violations: Array<string> = [];
    const importPattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
    for (const file of sourceFiles) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1]!;
        const where = `${path.relative(repoRoot, file)}: "${specifier}"`;
        if (specifier.startsWith(".")) {
          // Relative imports must stay inside the package.
          const resolved = path.resolve(path.dirname(file), specifier);
          if (!resolved.startsWith(packageRoot)) violations.push(where);
          continue;
        }
        if (
          specifier === "effect-atom-jsx" ||
          specifier.startsWith("effect-atom-jsx/")
        ) {
          if (!publishedSubpaths.has(specifier)) violations.push(where);
          continue;
        }
        // Everything else (effect, node builtins, test tooling) is fine.
      }
    }
    expect(violations).toEqual([]);
  });
});
