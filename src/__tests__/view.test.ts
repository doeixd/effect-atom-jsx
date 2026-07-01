import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as Component from "../Component.js";
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
        trigger: Element.draggable(),
        content: Element.container(),
      },
      null,
      {
        name: "Modal",
        slotMetadata: {
          trigger: View.slot("trigger", { capability: "Draggable" }),
          content: View.slot("content", { capability: "Container" }),
        },
        slotRemaps: [
          View.remap<{ readonly trigger: Element.Draggable; readonly content: Element.Container }>("trigger", "content"),
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

  it("normalizes string and witness capabilities for remap compatibility", () => {
    const view = View.make(
      {
        source: Element.container(),
        target: Element.container(),
      },
      null,
      {
        slotMetadata: {
          source: View.slot("source", { capability: Element.Capability.Container }),
          target: View.slot("target", { capability: "Container" }),
        },
        slotRemaps: [
          View.remap<{ readonly source: Element.Container; readonly target: Element.Container }>("source", "target"),
        ],
      },
    );

    expect(View.nameOfCapability(Element.Capability.Container)).toBe("Container");
    expect(Element.nameOfCapability(Element.Capability.Container)).toBe("Container");
    expect(View.validateRemaps(view)).toEqual([]);
  });

  it("uses capability hierarchy for remap compatibility", () => {
    const ok = View.make(
      {
        focusable: Element.focusable(),
        input: Element.textInput(),
      },
      null,
      {
        slotMetadata: {
          focusable: View.slot("focusable", { capability: Element.Capability.Focusable }),
          input: View.slot("input", { capability: Element.Capability.TextInput }),
        },
        slotRemaps: [
          View.remap<{ readonly focusable: Element.Focusable; readonly input: Element.TextInput }>("focusable", "input"),
        ],
      },
    );

    const bad = View.make(
      {
        input: Element.textInput(),
        focusable: Element.focusable(),
      },
      null,
      {
        slotMetadata: {
          input: View.slot("input", { capability: Element.Capability.TextInput }),
          focusable: View.slot("focusable", { capability: Element.Capability.Focusable }),
        },
        slotRemaps: [
          View.remap<{ readonly input: Element.TextInput; readonly focusable: Element.Focusable }>("input", "focusable"),
        ],
      },
    );

    expect(Element.extendsCapability(Element.Capability.TextInput, Element.Capability.Focusable)).toBe(true);
    expect(Element.extendsCapability(Element.Capability.Focusable, Element.Capability.TextInput)).toBe(false);
    expect(View.validateRemaps(ok)).toEqual([]);
    expect(View.validateRemaps(bad).map((diagnostic) => diagnostic.code)).toEqual(["view:remap-capability-mismatch"]);
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

  it("creates typed tree metadata without changing node unwrapping", () => {
    type Slots = {
      readonly root: Element.Container;
      readonly input: Element.TextInput;
    };

    const root = Element.container();
    const input = Element.textInput();
    const tree = View.element<Slots>(Element.Capability.Container, {
      slot: "root",
      children: [
        View.element<Slots>(Element.Capability.TextInput, {
          slot: "input",
          props: {
            className: View.className(["field", { invalid: false }]),
            onInput: View.event<InputEvent>(() => undefined),
          },
        }),
      ],
    });
    const view = View.tree(
      { root, input },
      tree,
      "runtime-node",
      {
        name: "TypedTree",
        slotMetadata: {
          root: View.slot("root", { capability: Element.Capability.Container }),
          input: View.slot("input", { capability: Element.Capability.TextInput }),
        },
      },
    );

    expect(View.node(view)).toBe("runtime-node");
    expect(view.tree).toBe(tree);
    expect(view.tree?.kind).toBe("view.node.element");
    expect(view.tree?.children?.[0]?.kind).toBe("view.node.element");
  });

  it("exposes typed tree metadata through component render inspection", () => {
    type Slots = {
      readonly root: Element.Container;
    };

    const Card = Component.make<{}, never, never, { readonly slots: Slots }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: { root: Element.container() } }),
      (_props, bindings) => View.tree(
        bindings.slots,
        View.element<Slots>(Element.Capability.Container, { slot: "root" }),
        "card-node",
        {
          name: "Card",
          slotMetadata: {
            root: View.slot("root", { capability: Element.Capability.Container }),
          },
        },
      ),
    );

    const rendered = Effect.runSync(Component.renderEffect(Card, {}));
    const inspected = Effect.runSync(Component.renderViewEffect(Card, {}));

    expect(rendered).toBe("card-node");
    expect(inspected?.name).toBe("Card");
    expect(inspected?.tree?.kind).toBe("view.node.element");
    expect(inspected?.tree?.slot).toBe("root");
  });

  it("validates typed tree slot references and capabilities", () => {
    type Slots = {
      readonly root: Element.Container;
      readonly secret: Element.Interactive;
      readonly input: Element.TextInput;
      readonly focusable: Element.Focusable;
    };

    const view = View.tree(
      {
        root: Element.container(),
        secret: Element.interactive(),
        input: Element.textInput(),
        focusable: Element.focusable(),
      },
      View.fragment<Slots>([
        View.element<Slots>(Element.Capability.Container, { slot: "root" }),
        View.element<Slots>(Element.Capability.Interactive, { slot: "secret" }),
        View.element<Slots>(Element.Capability.TextInput, { slot: "focusable" }),
        View.element<Slots>(Element.Capability.Container, { slot: "input" }),
        View.element<any>(Element.Capability.Container, { slot: "missing" }),
      ]),
      "node",
      {
        name: "TreeDiagnostics",
        slotMetadata: {
          root: View.slot("root", { capability: Element.Capability.Container }),
          secret: View.hidden("secret", { capability: Element.Capability.Interactive }),
          input: View.slot("input", { capability: Element.Capability.TextInput }),
          focusable: View.slot("focusable", { capability: Element.Capability.Focusable }),
        },
      },
    );

    const diagnostics = View.validateTree(view);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "view:hidden-slot",
      "view:remap-capability-mismatch",
      "view:unknown-slot",
    ]);
    expect(diagnostics[0]).toMatchObject({ slot: "secret" });
    expect(diagnostics[1]).toMatchObject({ slot: "input", capability: "Container" });
    expect(diagnostics[2]).toMatchObject({ slot: "missing" });
  });

  it("allows hidden typed tree slots when requested", () => {
    type Slots = {
      readonly secret: Element.Interactive;
    };

    const view = View.tree(
      { secret: Element.interactive() },
      View.element<Slots>(Element.Capability.Interactive, { slot: "secret" }),
      "node",
      {
        slotMetadata: {
          secret: View.hidden("secret", { capability: Element.Capability.Interactive }),
        },
      },
    );

    expect(View.validateTree(view, { allowHidden: true })).toEqual([]);
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

  it("validates witness-based platform metadata", () => {
    const DatePicker = Element.Capability.make("DatePicker");
    const Commit = View.Event.make("commit");
    const DataTestId = View.Attribute.make("data-testid");
    const Pointer = View.Requirement.make("pointer");
    const view = View.make(
      {
        input: Element.textInput(),
        picker: Element.interactive(),
      },
      null,
      {
        slotMetadata: {
          input: View.slot("input", {
            capability: Element.Capability.TextInput,
            allowedEvents: [View.Event.Input, Commit],
            allowedAttributes: [View.Attribute.AriaLabel, DataTestId],
            platformRequirements: [View.Requirement.Keyboard, Pointer],
          }),
          picker: View.slot("picker", {
            capability: DatePicker,
            allowedEvents: ["legacy-change"],
          }),
        },
      },
    );

    const diagnostics = View.validatePlatform(view, {
      name: "witness-web",
      capabilities: [Element.Capability.TextInput, "DatePicker"],
      events: [View.Event.Input, "legacy-change"],
      attributes: ["aria-label"],
      requirements: [View.Requirement.Keyboard],
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "view:unsupported-slot-event",
      "view:unsupported-slot-attribute",
      "view:missing-platform-requirement",
    ]);
    expect(diagnostics[0]).toMatchObject({ event: "commit" });
    expect(diagnostics[1]).toMatchObject({ attribute: "data-testid" });
    expect(diagnostics[2]).toMatchObject({ requirement: "pointer" });
  });

  it("uses capability hierarchy for platform support", () => {
    const view = View.make(
      {
        focusable: Element.focusable(),
        input: Element.textInput(),
      },
      null,
      {
        slotMetadata: {
          focusable: View.slot("focusable", { capability: Element.Capability.Focusable }),
          input: View.slot("input", { capability: Element.Capability.TextInput }),
        },
      },
    );

    const diagnostics = View.validatePlatform(view, {
      name: "text-only",
      capabilities: [Element.Capability.TextInput],
    });

    expect(diagnostics).toEqual([]);
  });
});
