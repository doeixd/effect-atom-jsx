import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("create-af-ui scaffold", () => {
  it("scaffolds a project with Field component golden path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "create-af-ui-"));
    const script = path.resolve("scripts/create-af-ui.mjs");
    const result = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "src", "Field.tsx"))).toBe(true);
    const field = fs.readFileSync(path.join(dir, "src", "Field.tsx"), "utf8");
    expect(field).toContain("View.Slots.define");
    expect(field).toContain("Component.withSlots");
    expect(field).toContain("Style.attachToSlots");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
