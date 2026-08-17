/**
 * The attribute value/coercion contract (`DQ-068`, ratified) — stated ONCE,
 * here, and honoured by BOTH handle implementations (the test handle in
 * `Element.ts` and the DOM/SSR renderer in `dom.ts`). Two renderers that
 * can both be "correct" while disagreeing make every attribute assertion
 * meaningless; this table is what requires them to agree.
 *
 * The rule:
 * - **boolean attributes** (`required`, `disabled`, …): `false` REMOVES the
 *   attribute, `true` serializes to `""`; a typed read of a present value is
 *   `true`, of an absent one `undefined`.
 * - **enumerated ARIA booleans** (`aria-invalid`, `aria-expanded`, …):
 *   booleans serialize to the strings `"true"`/`"false"` (per ARIA), and
 *   typed reads coerce those two strings back to booleans.
 * - **numeric attributes** (`tabindex`, …): numbers serialize with
 *   `String(...)`; typed reads coerce back through `Number(...)`.
 * - everything else — including the `data-*` escape hatch — is a string;
 *   values serialize with `String(...)` and read back verbatim.
 * - **absence**: `null`/`undefined` writes remove; reads of an absent
 *   attribute return `undefined` — never `null`, never `""`.
 */

/** HTML boolean attributes: presence IS the value. */
const booleanAttributes = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
]);

/** ARIA attributes whose value space is the enumerated `"true"`/`"false"`. */
const ariaBooleanAttributes = new Set([
  "aria-atomic",
  "aria-busy",
  "aria-checked",
  "aria-disabled",
  "aria-expanded",
  "aria-grabbed",
  "aria-hidden",
  "aria-invalid",
  "aria-modal",
  "aria-multiline",
  "aria-multiselectable",
  "aria-pressed",
  "aria-readonly",
  "aria-required",
  "aria-selected",
]);

/** Attributes whose typed value is numeric. */
const numberAttributes = new Set([
  "aria-colcount",
  "aria-colindex",
  "aria-colspan",
  "aria-level",
  "aria-posinset",
  "aria-rowcount",
  "aria-rowindex",
  "aria-rowspan",
  "aria-setsize",
  "aria-valuemax",
  "aria-valuemin",
  "aria-valuenow",
  "colspan",
  "maxlength",
  "minlength",
  "rows",
  "rowspan",
  "size",
  "span",
  "tabindex",
]);

export type AttributeKind = "boolean" | "aria-boolean" | "number" | "string";

/** The token table: attribute name → declared value kind. */
export function attributeKind(name: string): AttributeKind {
  const normalized = name.toLowerCase();
  if (booleanAttributes.has(normalized)) return "boolean";
  if (ariaBooleanAttributes.has(normalized)) return "aria-boolean";
  if (numberAttributes.has(normalized)) return "number";
  return "string";
}

/**
 * Serialize one attribute write. `null` means REMOVE — the single spelling
 * of absence on the write side.
 */
export function serializeAttribute(name: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  switch (attributeKind(name)) {
    case "boolean":
      return value === false ? null : "";
    case "aria-boolean":
      return typeof value === "boolean" ? String(value) : String(value);
    case "number":
      return String(value);
    case "string":
      return String(value);
  }
}

/**
 * Read one attribute back as its TYPED value. `raw === null` (absent) is
 * `undefined` for every kind.
 */
export function parseAttribute(
  name: string,
  raw: string | null,
): boolean | number | string | undefined {
  if (raw === null) return undefined;
  switch (attributeKind(name)) {
    case "boolean":
      return true;
    case "aria-boolean":
      return raw === "true" ? true : raw === "false" ? false : raw;
    case "number": {
      const value = Number(raw);
      return Number.isNaN(value) ? raw : value;
    }
    case "string":
      return raw;
  }
}
