import { describe, expect, it } from "vitest";
import * as A11y from "../A11y.js";
import * as Element from "../Element.js";
import * as View from "../View.js";

describe("A11y catalog", () => {
  it("ships Dialog through DragAndDrop catalog entries with tiers", () => {
    const names = A11y.catalog.map((e) => e.contract.name);
    expect(names).toEqual(
      expect.arrayContaining(["dialog", "tooltip", "popover", "tabs", "slider", "calendar", "drag-and-drop"]),
    );
    expect(A11y.catalog.every((e) => e.tier === "stateful" || e.tier === "stateless")).toBe(true);
  });

  it("validates Tooltip required slots against a View", () => {
    const view = View.fromSlots(A11y.TooltipSlots, null);
    const ok = A11y.validate(A11y.Tooltip, view);
    expect(ok.filter((d) => d.severity === "error")).toEqual([]);

    const incomplete = View.make(
      { trigger: Element.interactive() },
      null,
      {
        slotMetadata: {
          trigger: View.slot("trigger", {
            capability: Element.Capability.Interactive,
            allowedEvents: [View.Event.Hover, View.Event.Focus],
          }),
        },
      },
    );
    const diagnostics = A11y.validate(A11y.Tooltip, incomplete);
    expect(diagnostics.some((d) => d.code === "a11y:missing-pattern-slot" && d.slot === "content")).toBe(true);
  });
});
