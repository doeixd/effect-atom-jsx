import { describe, expect, it } from "vitest";
import * as Element from "../Element.js";
import * as View from "../View.js";

describe("View", () => {
  it("validates unknown and hidden slot targets", () => {
    const root = Element.container();
    const secret = Element.interactive();
    const view = View.make(
      { root, secret },
      null,
      {
        name: "Panel",
        slotMetadata: {
          root: View.slot("root", { capability: "Container" }),
          secret: View.hidden("secret", { capability: "Interactive" }),
        },
      },
    );

    const diagnostics = View.validateSlotTargets(view, ["root", "secret", "missing"]);

    expect(diagnostics.map((d) => d.code)).toEqual([
      "view:hidden-slot",
      "view:unknown-slot",
    ]);
    expect(diagnostics[0]?.slot).toBe("secret");
    expect(diagnostics[1]?.slot).toBe("missing");
  });

  it("allows hidden slot targets when explicitly requested", () => {
    const view = View.make(
      { secret: Element.interactive() },
      null,
      {
        slotMetadata: {
          secret: View.hidden("secret"),
        },
      },
    );

    expect(View.validateSlotTargets(view, ["secret"], { allowHidden: true })).toEqual([]);
  });

  it("validates remap capability compatibility", () => {
    const view = View.make(
      {
        trigger: Element.interactive(),
        content: Element.container(),
      },
      null,
      {
        name: "Modal",
        slotMetadata: {
          trigger: View.slot("trigger", { capability: "Interactive" }),
          content: View.slot("content", { capability: "Container" }),
        },
        slotRemaps: [
          View.remap<{ readonly trigger: Element.Interactive; readonly content: Element.Container }>("trigger", "content"),
        ],
      },
    );

    const diagnostics = View.validateRemaps(view);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "view:remap-capability-mismatch",
      source: "trigger",
      target: "content",
    });
  });

  it("infers capabilities from handles when metadata is absent", () => {
    const view = View.make(
      {
        input: Element.textInput(),
        otherInput: Element.textInput(),
      },
      null,
      {
        slotRemaps: [
          View.remap<{ readonly input: Element.TextInput; readonly otherInput: Element.TextInput }>("input", "otherInput"),
        ],
      },
    );

    expect(View.capabilityOf(view.slots.input)).toBe("TextInput");
    expect(View.validateRemaps(view)).toEqual([]);
  });
});

