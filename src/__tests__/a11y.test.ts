import { describe, expect, it } from "vitest";
import * as A11y from "../A11y.js";
import * as Element from "../Element.js";
import * as View from "../View.js";

describe("A11y", () => {
  it("validates pattern slots, capabilities, and required events", () => {
    const view = View.make(
      {
        root: Element.container(),
        trigger: Element.collection(),
      },
      null,
      {
        slotMetadata: {
          root: View.slot("root", { capability: Element.Capability.Container }),
          trigger: View.slot("trigger", { capability: Element.Capability.Collection }),
        },
      },
    );

    const diagnostics = A11y.validate(A11y.Dialog, view);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "a11y:slot-capability-mismatch",
      "a11y:missing-slot-event",
      "a11y:missing-pattern-slot",
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.source === "a11y")).toBe(true);
  });

  it("accepts a View that satisfies the dialog pattern", () => {
    const view = View.fromSlots(A11y.DialogSlots, null);

    expect(A11y.validate(A11y.Dialog, view)).toEqual([]);
  });
});
