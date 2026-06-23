import { describe, expect, it } from "vitest";
import * as Element from "../Element.js";
import * as SafeHtml from "../SafeHtml.js";
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

  it("brands SafeHtml for html holes", () => {
    const safe = SafeHtml.make("<strong>trusted</strong>");
    const hole = View.html(safe);

    expect(SafeHtml.isSafeHtml(safe)).toBe(true);
    expect(SafeHtml.unwrap(hole.value)).toBe("<strong>trusted</strong>");
    expect(hole.kind).toBe("view.hole.html");
  });

  it("creates typed runtime holes", () => {
    expect(View.text("hello")).toEqual({ kind: "view.hole.text", value: "hello" });
    expect(View.className(["primary", { active: true }]).kind).toBe("view.hole.class");
    expect(View.style({ opacity: 1, color: "red" }).kind).toBe("view.hole.style");
    expect(View.event<MouseEvent>(() => undefined).kind).toBe("view.hole.event");
    expect(View.children(["child"]).kind).toBe("view.hole.children");
  });

  it("validates slot metadata against platform metadata", () => {
    const view = View.make(
      {
        root: Element.container(),
        trigger: Element.interactive(),
        input: Element.textInput(),
      },
      null,
      {
        slotMetadata: {
          root: View.slot("root", {
            capability: "Container",
            allowedAttributes: ["aria-label"],
          }),
          trigger: View.slot("trigger", {
            capability: "Interactive",
            allowedEvents: ["press", "hover"],
          }),
          input: View.slot("input", {
            capability: "TextInput",
            platformRequirements: ["keyboard"],
          }),
        },
      },
    );

    const diagnostics = View.validatePlatform(view, {
      name: "minimal",
      capabilities: ["Container", "Interactive"],
      events: ["press"],
      attributes: [],
      requirements: [],
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "view:unsupported-slot-attribute",
      "view:unsupported-slot-event",
      "view:unsupported-slot-capability",
      "view:missing-platform-requirement",
    ]);
    expect(diagnostics[0]).toMatchObject({ slot: "root", attribute: "aria-label", platform: "minimal" });
    expect(diagnostics[1]).toMatchObject({ slot: "trigger", event: "hover", platform: "minimal" });
    expect(diagnostics[2]).toMatchObject({ slot: "input", capability: "TextInput", platform: "minimal" });
    expect(diagnostics[3]).toMatchObject({ slot: "input", requirement: "keyboard", platform: "minimal" });
  });
});
