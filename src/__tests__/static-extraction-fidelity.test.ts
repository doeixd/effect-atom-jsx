/**
 * Static extraction fidelity (`DQ-064` follow-through, K4 polish).
 *
 * `Style.extractStatic` landed with the ratified slot-unit fail-open rule, but
 * its first slice only extracted flat declarations. That leaves real static
 * CSS on the runtime floor: pseudo-classes, machine-state selectors, media
 * blocks, and layer overrides are all statically known at module time. The
 * finished design extracts them — and the states case is the load-bearing one:
 * per the DQ-056 rationale, a state-tag becomes a `[data-state="..."]`
 * attribute selector, so SSR emits the attribute and the dormant widget is
 * styled by CSS that is already loaded, with zero JavaScript.
 *
 * The fail-open contract is unchanged and re-asserted here: any runtime
 * condition, binding conditional, or dynamic function value anywhere in a
 * slot sends the WHOLE slot to runtime composition.
 */
import { describe, expect, it } from "vitest";
import {
  compose,
  extractStatic,
  inLayer,
  make,
  media,
  nest,
  pseudo,
  slot,
  states,
  when,
  whenBinding,
} from "../Style.js";

describe("static extraction fidelity", () => {
  it("[K4] pseudo-classes extract as selector suffixes", () => {
    const style = make({
      trigger: compose(
        slot({ cursor: "pointer" }),
        pseudo({
          ":hover": { background: "color.accent.hover" },
          ":focus-visible": { outlineWidth: "2px" },
        }),
      ),
    });
    const extraction = extractStatic(style);

    expect(extraction.staticSlots).toEqual(["trigger"]);
    expect(extraction.css).toContain(".af-trigger { cursor: pointer; }");
    // Token paths resolve to the shared --af-* namespace inside pseudo rules too.
    expect(extraction.css).toContain(
      ".af-trigger:hover { background: var(--af-color-accent-hover); }",
    );
    // camelCase properties kebab-case in every emitted rule.
    expect(extraction.css).toContain(".af-trigger:focus-visible { outline-width: 2px; }");
  });

  it("[K4] machine states extract as data-state attribute selectors (the DQ-056 dormant-widget payoff)", () => {
    const style = make({
      content: states({
        default: { display: "none" },
        open: { display: "block" },
        closing: { opacity: 0 },
      }),
    });
    const extraction = extractStatic(style);

    expect(extraction.staticSlots).toEqual(["content"]);
    // `default` is the base rule; every other state is an attribute selector,
    // which is what makes the dormant case free: SSR stamps data-state and
    // the cascade does the rest — no hydration required to look right.
    expect(extraction.css).toContain(".af-content { display: none; }");
    expect(extraction.css).toContain('.af-content[data-state="open"] { display: block; }');
    expect(extraction.css).toContain('.af-content[data-state="closing"] { opacity: 0; }');
  });

  it("[K4] media blocks and nested selectors extract in place", () => {
    const style = make({
      root: compose(
        slot({ display: "flex" }),
        media({ "(min-width: 600px)": { flexDirection: "row" } }),
        nest({
          "> label": { fontWeight: 600 },
          "&:disabled": { opacity: 0.5 },
        }),
      ),
    });
    const extraction = extractStatic(style);

    expect(extraction.staticSlots).toEqual(["root"]);
    expect(extraction.css).toContain(
      "@media (min-width: 600px) { .af-root { flex-direction: row; } }",
    );
    // Nested selector keys append; `&` splices the slot selector itself.
    expect(extraction.css).toContain(".af-root > label { font-weight: 600; }");
    expect(extraction.css).toContain(".af-root:disabled { opacity: 0.5; }");
  });

  it("[K4] inLayer overrides the cascade layer per piece; fail-open still swallows the whole slot", () => {
    const style = make({
      // The layer piece places ITS declarations in the named layer.
      base: inLayer("defaults", slot({ boxSizing: "border-box" })),
      // NEGATIVE CONTROLS: fidelity must not weaken fail-open. A runtime
      // condition or binding conditional poisons the slot even when the
      // sibling pieces are the newly-extractable kinds.
      cond: compose(pseudo({ ":hover": { color: "red" } }), when(() => true, slot({ opacity: 1 }))),
      bound: compose(slot({ margin: 0 }), whenBinding("isOpen", true, slot({ color: "blue" }))),
    });
    const extraction = extractStatic(style);

    expect(extraction.staticSlots).toEqual(["base"]);
    expect([...extraction.runtimeSlots].sort()).toEqual(["bound", "cond"]);
    expect(extraction.css).toContain("@layer defaults {");
    expect(extraction.css).toContain(".af-base { box-sizing: border-box; }");
    expect(extraction.css).not.toContain("hover");
    expect(extraction.css).not.toContain("blue");
  });
});
