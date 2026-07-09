import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("package release surface", () => {
  it("keeps top-level namespaces available as tree-shakeable subpath exports", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      readonly sideEffects?: unknown;
      readonly exports: Record<string, unknown>;
    };

    expect(pkg.sideEffects).toBe(false);
    expect(Object.keys(pkg.exports)).toEqual(expect.arrayContaining([
      ".",
      "./runtime",
      "./jsx-runtime",
      "./testing",
      "./advanced",
      "./Atom",
      "./View",
      "./Component",
      "./Behavior",
      "./Style",
      "./Route",
      "./ServerRoute",
      "./RouterRuntime",
      "./Result",
      "./Serialization",
      "./Diagnostics",
      "./A11y",
      "./Form",
      "./Devtools",
      "./Event",
      "./Registry",
      "./package.json",
    ]));
  });

  it("points every declared import and type export at an existing build artifact", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      readonly exports: Record<string, string | Record<string, string>>;
      readonly bin: Record<string, string>;
    };

    for (const [name, entry] of Object.entries(pkg.exports)) {
      const fields = typeof entry === "string" ? { import: entry } : entry;
      for (const key of ["import", "types", "default"] as const) {
        const target = fields[key];
        if (target === undefined || target === "./package.json") continue;
        expect(fs.existsSync(target), `${name}.${key} -> ${target}`).toBe(true);
      }
    }

    for (const [name, target] of Object.entries(pkg.bin)) {
      expect(fs.existsSync(target), `bin ${name} -> ${target}`).toBe(true);
    }
  });
});
