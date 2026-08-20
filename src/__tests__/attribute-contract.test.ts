/**
 * DQ-068 (ratified) — the attribute value/coercion contract, enforced as a
 * CONFORMANCE suite both handle implementations share. Two renderers that
 * can each be "correct" while disagreeing make every attribute assertion
 * meaningless; this table-driven suite is what requires them to agree.
 */
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parseAttribute, serializeAttribute } from "../attributes.js";
import { renderToString, setAttribute, template } from "../dom.js";
import * as Element from "../Element.js";

/** One conformance row: write `value`, expect this serialization + read. */
const rows: ReadonlyArray<{
  readonly name: string;
  readonly value: unknown;
  readonly serialized: string | null;
  readonly read: unknown;
}> = [
  // HTML boolean attributes: false removes, true sets "", reads are booleans.
  { name: "required", value: true, serialized: "", read: true },
  { name: "required", value: false, serialized: null, read: undefined },
  { name: "disabled", value: true, serialized: "", read: true },
  // Enumerated ARIA booleans: booleans travel as "true"/"false" and read back.
  { name: "aria-invalid", value: true, serialized: "true", read: true },
  { name: "aria-invalid", value: false, serialized: "false", read: false },
  { name: "aria-expanded", value: true, serialized: "true", read: true },
  // Numeric attributes: stringify out, Number back.
  { name: "tabindex", value: 0, serialized: "0", read: 0 },
  { name: "tabindex", value: -1, serialized: "-1", read: -1 },
  { name: "aria-posinset", value: 3, serialized: "3", read: 3 },
  // Strings, and the data-* escape hatch: verbatim strings both ways.
  { name: "id", value: "af-1", serialized: "af-1", read: "af-1" },
  { name: "data-count", value: 1, serialized: "1", read: "1" },
  { name: "commandfor", value: "af-dialog-1", serialized: "af-dialog-1", read: "af-dialog-1" },
  // Absence: null/undefined writes remove for every kind.
  { name: "id", value: null, serialized: null, read: undefined },
  { name: "aria-invalid", value: undefined, serialized: null, read: undefined },
];

describe("DQ-068 attribute contract", () => {
  it("the table itself: serialize and parse are the stated rule", () => {
    for (const row of rows) {
      expect(
        serializeAttribute(row.name, row.value),
        `serialize ${row.name} <- ${String(row.value)}`,
      ).toBe(row.serialized);
      expect(
        parseAttribute(row.name, row.serialized),
        `parse ${row.name} <- ${String(row.serialized)}`,
      ).toEqual(row.read);
    }
  });

  it("the test handle honours the contract", () => {
    for (const row of rows) {
      const handle = Element.container();
      Effect.runSync(handle.setAttr(row.name, row.value));
      expect(handle.getAttr(row.name), `test handle: ${row.name}`).toEqual(row.read);
    }
    // Absent reads are `undefined` — never null, never "".
    expect(Element.container().getAttr("nonexistent")).toBeUndefined();
  });

  it("the SSR renderer serializes identically", () => {
    for (const row of rows) {
      const html = renderToString(() => {
        const element = template("<div>")();
        setAttribute(element, row.name, row.value);
        return element;
      });
      if (row.serialized === null) {
        expect(html, `ssr absent: ${row.name}`).toBe("<div></div>");
      } else if (row.serialized === "") {
        expect(html, `ssr boolean: ${row.name}`).toContain(`${row.name}=""`);
      } else {
        expect(html, `ssr: ${row.name}`).toContain(`${row.name}="${row.serialized}"`);
      }
    }
  });

  it("false REMOVES a previously set boolean attribute (both sides)", () => {
    const handle = Element.container();
    Effect.runSync(handle.setAttr("required", true));
    expect(handle.getAttr("required")).toBe(true);
    Effect.runSync(handle.setAttr("required", false));
    expect(handle.getAttr("required")).toBeUndefined();

    const html = renderToString(() => {
      const element = template("<div>")();
      setAttribute(element, "required", true);
      setAttribute(element, "required", false);
      return element;
    });
    expect(html).toBe("<div></div>");
  });
});
