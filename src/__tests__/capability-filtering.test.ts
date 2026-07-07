import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Style from "../Style.js";
import * as View from "../View.js";

describe("Capability filtering helpers", () => {
  describe("View.Slots.withCapability", () => {
    it("filters slots by capability", () => {
      const Root = View.Slot.make("root", { capability: Element.Capability.Base });
      const Input = View.Slot.make("input", { capability: Element.Capability.TextInput });
      const Button = View.Slot.make("button", { capability: Element.Capability.Interactive });

      const slots = View.Slots.make({
        root: View.Slot.bind(Root, Element.container()),
        input: View.Slot.bind(Input, Element.textInput()),
        button: View.Slot.bind(Button, Element.interactive()),
      });

      const interactiveSlots = View.Slots.withCapability(slots, Element.Capability.Interactive);

      expect(Object.keys(interactiveSlots)).toEqual(["input", "button"]);
      expect(interactiveSlots.input).toBeDefined();
      expect(interactiveSlots.button).toBeDefined();
      expect((interactiveSlots as any).root).toBeUndefined();
    });

    it("returns empty object when no slots match", () => {
      const Root = View.Slot.make("root", { capability: Element.Capability.Container });

      const slots = View.Slots.make({
        root: View.Slot.bind(Root, Element.container()),
      });

      const textInputSlots = View.Slots.withCapability(slots, Element.Capability.TextInput);

      expect(Object.keys(textInputSlots)).toEqual([]);
    });

    it("returns all slots when all match", () => {
      const Input1 = View.Slot.make("input1", { capability: Element.Capability.TextInput });
      const Input2 = View.Slot.make("input2", { capability: Element.Capability.TextInput });

      const slots = View.Slots.make({
        input1: View.Slot.bind(Input1, Element.textInput()),
        input2: View.Slot.bind(Input2, Element.textInput()),
      });

      const textInputSlots = View.Slots.withCapability(slots, Element.Capability.TextInput);

      expect(Object.keys(textInputSlots)).toEqual(["input1", "input2"]);
    });
  });

  describe("Behavior.attachToAllWithCapability", () => {
    it("attaches behavior to all slots with matching capability", () => {
      const focusBehavior = Behavior.make<{ readonly [key: string]: Element.Handle }, { matchedSlots: readonly string[] }>(
        (elements) => Effect.sync(() => {
          return { matchedSlots: Object.keys(elements) };
        }),
      );

      const Root = View.Slot.make("root", { capability: Element.Capability.Container });
      const Input = View.Slot.make("input", { capability: Element.Capability.TextInput });
      const Button = View.Slot.make("button", { capability: Element.Capability.Interactive });

      const MyComponent = Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.gen(function* () {
          const root = yield* Component.slotContainer();
          const input = yield* Component.slotTextInput();
          const button = yield* Component.slotInteractive();
          return {
            slots: { root, input, button },
            slotMetadata: {
              root: Root.metadata,
              input: Input.metadata,
              button: Button.metadata,
            },
          };
        }),
        () => null,
      );

      const EnhancedComponent = MyComponent.pipe(
        Behavior.attachToAllWithCapability(focusBehavior, Element.Capability.Interactive),
      );

      const bindings = Effect.runSync(Component.setupEffect(EnhancedComponent, {}));

      expect(bindings).toBeDefined();
      expect((bindings as any).matchedSlots).toEqual(["root", "input", "button"]);
    });

    it("uses capability hierarchy when selecting behavior slots", () => {
      const focusableBehavior = Behavior.make<{ readonly [key: string]: Element.Handle }, { matchedSlots: readonly string[] }>(
        (elements) => Effect.sync(() => ({ matchedSlots: Object.keys(elements) })),
      );

      const Input = View.Slot.make("input", { capability: Element.Capability.TextInput });
      const Button = View.Slot.make("button", { capability: Element.Capability.Interactive });

      const MyComponent = Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.gen(function* () {
          const input = yield* Component.slotTextInput();
          const button = yield* Component.slotInteractive();
          return {
            slots: { input, button },
            slotMetadata: {
              input: Input.metadata,
              button: Button.metadata,
            },
          };
        }),
        () => null,
      );

      const EnhancedComponent = MyComponent.pipe(
        Behavior.attachToAllWithCapability(focusableBehavior, Element.Capability.Focusable),
      );

      const bindings = Effect.runSync(Component.setupEffect(EnhancedComponent, {}));

      expect((bindings as any).matchedSlots).toEqual(["input"]);
    });

    it("does not attach behavior when no slots match", () => {
      const textInputBehavior = Behavior.make<{ readonly [key: string]: Element.Handle }, { hasTextInput: boolean }>(
        (elements) => Effect.sync(() => {
          const elementKeys = Object.keys(elements);
          return { hasTextInput: elementKeys.length > 0 };
        }),
      );

      const Root = View.Slot.make("root", { capability: Element.Capability.Base });

      const MyComponent = Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.gen(function* () {
          const root = yield* Component.slotContainer();
          return {
            slots: { root },
            slotMetadata: {
              root: Root.metadata,
            },
          };
        }),
        () => null,
      );

      const EnhancedComponent = MyComponent.pipe(
        Behavior.attachToAllWithCapability(textInputBehavior, Element.Capability.TextInput),
      );

      const bindings = Effect.runSync(Component.setupEffect(EnhancedComponent, {}));

      expect(bindings).toBeDefined();
      // When no slots match, behavior runs with empty elements, so hasTextInput is false
      expect((bindings as any).hasTextInput).toBe(false);
    });
  });

  describe("Style.attachToAllWithCapability", () => {
    it("attaches style to all slots with matching capability hierarchy", () => {
      const inputStyle = Style.slot({ color: "blue" });

      const Root = View.Slot.make("root", { capability: Element.Capability.Container });
      const Input = View.Slot.make("input", { capability: Element.Capability.TextInput });
      const Button = View.Slot.make("button", { capability: Element.Capability.Interactive });
      const root = Element.container();
      const input = Element.textInput();
      const button = Element.interactive();

      const MyComponent = Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.succeed({}),
        () => View.fromSlots(
          View.Slots.make({
            root: View.Slot.bind(Root, root),
            input: View.Slot.bind(Input, input),
            button: View.Slot.bind(Button, button),
          }),
          null,
        ),
      );

      const EnhancedComponent = MyComponent.pipe(
        Style.attachToAllWithCapability(inputStyle, Element.Capability.Focusable),
      );

      const view = Component.renderViewEffect(EnhancedComponent, {});
      const result = Effect.runSync(view);

      expect(result).toBeDefined();
      expect(View.isView(result)).toBe(true);
      expect(input.getStyle("color")).toBe("blue");
      expect(button.getStyle("color")).toBeUndefined();
      expect(root.getStyle("color")).toBeUndefined();
    });

    it("does not attach style when no slots match", () => {
      const textInputStyle = Style.slot({ color: "red" });

      const Root = View.Slot.make("root", { capability: Element.Capability.Container });

      const MyComponent = Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.succeed({}),
        () => View.fromSlots(
          View.Slots.make({
            root: View.Slot.bind(Root, Element.container()),
          }),
          null,
        ),
      );

      const EnhancedComponent = MyComponent.pipe(
        Style.attachToAllWithCapability(textInputStyle, Element.Capability.TextInput),
      );

      const view = Component.renderViewEffect(EnhancedComponent, {});
      const result = Effect.runSync(view);

      expect(result).toBeDefined();
      expect(View.isView(result)).toBe(true);
    });

    it("supports slot-contract style construction and slot collection attachment", () => {
      const Root = View.Slot.make("root", { capability: Element.Capability.Container });
      const Input = View.Slot.make("input", { capability: Element.Capability.TextInput });
      const root = Element.container();
      const input = Element.textInput();
      const slots = View.Slots.make({
        root: View.Slot.bind(Root, root),
        input: View.Slot.bind(Input, input),
      });
      const fieldStyle = Style.forSlots({ root: Root, input: Input })({
        input: Style.slot({ color: "green" }),
      });

      const MyComponent = Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.succeed({}),
        () => View.fromSlots(slots, null),
      ).pipe(
        Component.withSlots(slots),
      );

      const EnhancedComponent = MyComponent.pipe(
        Style.attachToSlots(fieldStyle, slots),
      );

      Effect.runSync(Component.renderViewEffect(EnhancedComponent, {}));

      expect(input.getStyle("color")).toBe("green");
      expect(root.getStyle("color")).toBeUndefined();
    });

    it("maps style keys through slot contracts", () => {
      const Input = View.Slot.make("input", { capability: Element.Capability.TextInput });
      const input = Element.textInput();
      const style = Style.make({
        field: Style.slot({ color: "blue" }),
      });

      const MyComponent = Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.succeed({ slots: { input } }),
        () => View.make({ input }, null),
      );

      const EnhancedComponent = MyComponent.pipe(
        Style.attachBySlotContract(style, { field: Input }),
      );

      Effect.runSync(Component.renderViewEffect(EnhancedComponent, {}));

      expect(input.getStyle("color")).toBe("blue");
    });
  });

  describe("Behavior.attachBySlotContract", () => {
    it("maps behavior element keys through slot contracts", () => {
      const Input = View.Slot.make("input", { capability: Element.Capability.TextInput });
      const inputBehavior = Behavior.make<{ readonly field: Element.TextInput }, { attachedTo: string }>(
        (elements) => Effect.sync(() => ({ attachedTo: elements.field.kind })),
      );

      const MyComponent = Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.gen(function* () {
          const input = yield* Component.slotTextInput();
          return {
            slots: { input },
            slotMetadata: { input: Input.metadata },
          };
        }),
        () => null,
      );

      const EnhancedComponent = MyComponent.pipe(
        Behavior.attachBySlotContract(inputBehavior, { field: Input }),
      );

      const bindings = Effect.runSync(Component.setupEffect(EnhancedComponent, {}));

      expect((bindings as any).attachedTo).toBe("TextInput");
    });

    it("supports slot-contract behavior construction and slot collection attachment", () => {
      const Root = View.Slot.make("root", { capability: Element.Capability.Container });
      const Input = View.Slot.make("input", { capability: Element.Capability.TextInput });
      const root = Element.container();
      const input = Element.textInput();
      const slots = View.Slots.make({
        root: View.Slot.bind(Root, root),
        input: View.Slot.bind(Input, input),
      });
      const inputBehavior = Behavior.forSlots(slots)((elements) =>
        Effect.sync(() => ({ attachedTo: elements.input.kind })),
      );

      const MyComponent = Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.succeed({ slots: { root, input } }),
        () => View.fromSlots(slots, null),
      ).pipe(
        Component.withSlots(slots),
      );

      const EnhancedComponent = MyComponent.pipe(
        Behavior.attachToSlots(inputBehavior, slots),
      );

      const bindings = Effect.runSync(Component.setupEffect(EnhancedComponent, {}));

      expect((bindings as any).attachedTo).toBe("TextInput");
    });

    it("attaches behavior to withSlots components without authored bindings.slots", () => {
      const Input = View.Slot.make("input", { capability: Element.Capability.TextInput });
      const input = Element.textInput();
      const slots = View.Slots.make({
        input: View.Slot.bind(Input, input),
      });
      const inputBehavior = Behavior.forSlots(slots)((elements) =>
        Effect.sync(() => ({ attachedTo: elements.input.kind })),
      );

      const MyComponent = Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.succeed({ ready: true }),
        () => View.fromSlots(slots, null),
      ).pipe(
        Component.withSlots(slots),
      );

      const EnhancedComponent = MyComponent.pipe(
        Behavior.attachToSlots(inputBehavior, slots),
      );

      const bindings = Effect.runSync(Component.setupEffect(EnhancedComponent, {}));

      expect((bindings as any).ready).toBe(true);
      expect((bindings as any).slots.input).toBe(input);
      expect((bindings as any).attachedTo).toBe("TextInput");
    });
  });
});
