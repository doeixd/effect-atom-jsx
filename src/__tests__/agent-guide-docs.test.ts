/**
 * Documentation-completeness audit for the agent surface — the same
 * anti-drift discipline `resume-diagnostics.test.ts` applies to
 * `RESUMABILITY_GUIDE.md`: every operator-facing code and error tag is
 * DERIVED from the source (never hand-maintained) and must be findable in
 * `docs/AGENT_SURFACE_GUIDE.md`. Hand-kept lists are exactly how
 * `unsupported-expression-target` once shipped undocumented.
 */
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  fs.readFile(new URL(relative, import.meta.url), "utf8");

const guide = () => read("../../docs/AGENT_SURFACE_GUIDE.md");

describe("AGENT_SURFACE_GUIDE completeness", () => {
  it("documents every ViewSpec diagnostic code, derived from the source union", async () => {
    const source = await read("../ViewSpec.ts");
    const unionBlock = source.match(
      /export type ViewSpecDiagnosticCode =([\s\S]*?);/,
    )?.[1];
    expect(unionBlock).toBeDefined();
    const codes = [...unionBlock!.matchAll(/"(ui:[a-z-]+)"/g)].map(
      (match) => match[1]!,
    );
    // The union genuinely enumerates the codes (a broken regex must not
    // vacuously pass an empty list).
    expect(codes.length).toBeGreaterThanOrEqual(7);

    const doc = await guide();
    for (const code of codes) {
      expect(doc, `undocumented ViewSpec diagnostic: ${code}`).toContain(code);
    }
  });

  it("documents every Agent error tag, derived from the exported error classes", async () => {
    const source = await read("../Agent.ts");
    const tags = [...source.matchAll(/export class (\w+Error) extends/g)].map(
      (match) => match[1]!,
    );
    expect(tags.length).toBeGreaterThanOrEqual(10);

    const doc = await guide();
    for (const tag of tags) {
      expect(doc, `undocumented Agent error: ${tag}`).toContain(tag);
    }
  });

  it("documents every @affe/agent MCP error tag, derived from the adapter source", async () => {
    const source = await read("../../packages/agent/src/mcp.ts");
    const tags = [...source.matchAll(/export class (\w+Error) extends/g)].map(
      (match) => match[1]!,
    );
    expect(tags.length).toBeGreaterThanOrEqual(2);

    const doc = await guide();
    for (const tag of tags) {
      expect(doc, `undocumented MCP error: ${tag}`).toContain(tag);
    }
  });

  it("documents every ViewSpec node kind, derived from NodeKinds", async () => {
    const source = await read("../ViewSpec.ts");
    const kindsBlock = source.match(
      /export const NodeKinds = \[([\s\S]*?)\]/,
    )?.[1];
    expect(kindsBlock).toBeDefined();
    const kinds = [...kindsBlock!.matchAll(/"(ui\.[a-z]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(kinds.length).toBeGreaterThanOrEqual(2);

    const doc = await guide();
    for (const kind of kinds) {
      expect(doc, `undocumented node kind: ${kind}`).toContain(kind);
    }
  });

  it("carries the load-bearing structure an operator navigates by", async () => {
    const doc = await guide();
    // The ratified dispatch order, spelled out — the single most important
    // sentence for anyone debugging a refusal.
    expect(doc).toMatch(/authorize → tool lookup → drift → args decode → approve/);
    // The two-arm envelope and its owner.
    expect(doc).toContain("ok: true");
    expect(doc).toContain("ok: false");
    expect(doc).toContain("DQ-080");
    // Both halves of the approval-store contract.
    expect(doc).toMatch(/[Rr]estart denies/);
    expect(doc).toContain("pending()");
    // Exposure enforcement vs hiding, and the two distinct MCP refusals.
    expect(doc).toContain("McpToolNotExposedError");
    expect(doc).toContain("McpUnknownToolError");
    // The structural security claims by their decision ids.
    for (const dq of ["DQ-081", "DQ-083", "DQ-084", "DQ-085", "DQ-086", "DQ-087", "DQ-088", "DQ-090", "DQ-095", "DQ-097"]) {
      expect(doc, `missing decision reference: ${dq}`).toContain(dq);
    }
  });
});
