import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { createRoot } from "../api.js";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Style from "../Style.js";
import * as View from "../View.js";

describe("Component", () => {
  it("runs setupEffect with Effect-native setup helpers", () => {
    const Counter = Component.make(
      Component.props<{ readonly start: number }>(),
      Component.require<never>(),
      ({ start }) => Effect.gen(function* () {
        const count = yield* Component.state(start);
        const doubled = yield* Component.derived(() => count() * 2);
        return { count, doubled };
      }),
      (_props, bindings) => bindings.doubled(),
    );

    const bindings = Effect.runSync(Component.setupEffect(Counter, { start: 2 }));
    expect(bindings.count()).toBe(2);
    expect(bindings.doubled()).toBe(4);
    bindings.count.set(4);
    expect(bindings.doubled()).toBe(8);
  });

  it("supports headless render-prop components", () => {
    const Headless = Component.headless(
      Component.props<{ readonly label: string }>(),
      Component.require<never>(),
      ({ label }) => Effect.gen(function* () {
        const text = yield* Component.state(label);
        return { text };
      }),
    );

    const rendered = Effect.runSync(
      Component.renderEffect(Headless, {
        label: "hello",
        children: ({ text }) => text(),
      }),
    );

    expect(rendered).toBe("hello");
  });

  it("supports timeout wrapper for setup", async () => {
    const Slow = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.sleep("20 millis").pipe(Effect.as({ ok: true })),
      () => "ok",
    ).pipe(Component.withSetupTimeout(1));

    await expect(Effect.runPromise(Component.setupEffect(Slow, {}) as Effect.Effect<unknown, unknown, never>)).rejects.toMatchObject({
      _tag: "ComponentSetupTimeout",
    });
  });

  it("supports typed setup error boundaries", async () => {
    const Broken = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.fail({ _tag: "Boom", message: "x" } as const),
      () => "never",
    ).pipe(
      Component.withErrorBoundary({
        Boom: () => "handled",
      }),
    );

    const view = createRoot(() => Broken({})) as () => unknown;
    await Effect.runPromise(Effect.sleep("5 millis"));
    expect(view()).toBe("handled");
  });

  it("unwraps View nodes from component render functions", () => {
    const ViewBacked = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const root = yield* Component.slotContainer();
        return { slots: { root } };
      }),
      (_props, bindings) => View.make(bindings.slots, "rendered", { name: "ViewBacked" }),
    );

    const rendered = Effect.runSync(Component.renderEffect(ViewBacked, {}));
    expect(rendered).toBe("rendered");
  });

  it("preserves inspectable View metadata through common wrappers", () => {
    const addReady = Behavior.make<
      { readonly root: Element.Container },
      { readonly ready: true },
      never,
      never
    >(() => Effect.succeed({ ready: true as const }));

    const Base = Component.make<
      {},
      never,
      never,
      { readonly slots: { readonly root: Element.Container } }
    >(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: { root: Element.container() } }),
      (_props, bindings) => View.make(
        bindings.slots,
        "rendered",
        {
          name: "WrappedView",
          slotMetadata: {
            root: View.slot("root", {
              capability: Element.Capability.Container,
              allowedAttributes: [View.Attribute.AriaLabel],
            }),
          },
        },
      ),
    );

    const Wrapped = Base.pipe(
      Component.withBehavior(addReady, (bindings) => ({ root: bindings.slots.root })),
      Style.attachByView(Style.make({ root: Style.slot({ color: "red" }) })),
      Component.withLayer(Layer.empty),
      Component.guard(Effect.void),
    );

    const view = Effect.runSync(Component.renderViewEffect(Wrapped, {}));

    expect(view).toBeDefined();
    expect(view?.name).toBe("WrappedView");
    expect(view?.slotMetadata?.root?.name).toBe("root");
    expect(View.nameOfCapability(view?.slotMetadata?.root?.capability ?? "missing")).toBe("Container");
    expect(view?.slots.root.getStyle("color")).toBe("red");
  });

  it("reports platform diagnostics for View-backed component render output", () => {
    const diagnostics: Array<View.ViewDiagnostic> = [];
    const ViewBacked = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const input = yield* Component.slotTextInput();
        return { slots: { input } };
      }),
      (_props, bindings) => View.make(bindings.slots, "rendered", {
        name: "InputView",
        slotMetadata: {
          input: View.slot("input", {
            capability: "TextInput",
            allowedEvents: ["input"],
            platformRequirements: ["keyboard"],
          }),
        },
      }),
    );

    const rendered = Effect.runSync(
      Component.renderEffect(ViewBacked, {}).pipe(
        Effect.provide(View.platform(
          {
            name: "minimal",
            capabilities: ["Container"],
            events: [],
            requirements: [],
          },
          { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
        )),
      ),
    );

    expect(rendered).toBe("rendered");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "view:unsupported-slot-capability",
      "view:unsupported-slot-event",
      "view:missing-platform-requirement",
    ]);
  });

  it("unwraps View nodes from headless render props", () => {
    const Headless = Component.headless(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const root = yield* Component.slotContainer();
        return { slots: { root } };
      }),
    );

    const rendered = Effect.runSync(
      Component.renderEffect(Headless, {
        children: ({ slots }) => View.make(slots, "headless-view"),
      }),
    );

    expect(rendered).toBe("headless-view");
  });

  it("reports platform diagnostics for View-backed headless render props", () => {
    const diagnostics: Array<View.ViewDiagnostic> = [];
    const Headless = Component.headless(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const root = yield* Component.slotContainer();
        return { slots: { root } };
      }),
    );

    const rendered = Effect.runSync(
      Component.renderEffect(Headless, {
        children: ({ slots }) => View.make(slots, "headless-view", {
          slotMetadata: {
            root: View.slot("root", {
              capability: "Container",
              allowedAttributes: ["aria-label"],
            }),
          },
        }),
      }).pipe(
        Effect.provide(View.platform(
          {
            name: "minimal",
            capabilities: ["Container"],
            attributes: [],
          },
          { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
        )),
      ),
    );

    expect(rendered).toBe("headless-view");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "view:unsupported-slot-attribute",
    ]);
  });

  it("creates inspectable Views with slots", () => {
    const root = Element.container();
    const view = View.make({ root }, "node");

    expect(View.isView(view)).toBe(true);
    expect(view.slots.root).toBe(root);
    expect(View.node(view)).toBe("node");
  });
});
