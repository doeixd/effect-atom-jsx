import { describe, it, expect } from "vitest";
import { Effect, Exit, Layer, Scope, ServiceMap } from "effect";
import { createRoot, flush } from "../api.js";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Style from "../Style.js";
import * as View from "../View.js";

describe("Component", () => {
  it("runs setupEffect with Effect-native setup helpers", () => {
    const effectLog: number[] = [];
    const cleanupLog: number[] = [];
    const Counter = Component.make(
      Component.props<{ readonly start: number }>(),
      Component.require<never>(),
      ({ start }) => Effect.gen(function* () {
        const count = yield* Component.state(start);
        const [step, setStep] = yield* Component.signal(1);
        const doubled = yield* Component.derived(() => count() * 2);
        yield* Component.effect(() => {
          effectLog.push(step());
          return () => cleanupLog.push(step());
        });
        return { count, doubled, step, setStep };
      }),
      (_props, bindings) => bindings.doubled(),
    );

    createRoot((dispose) => {
      const bindings = Effect.runSync(Component.setupEffect(Counter, { start: 2 }));
      expect(bindings.count()).toBe(2);
      expect(bindings.step()).toBe(1);
      expect(bindings.doubled()).toBe(4);
      expect(effectLog).toEqual([1]);

      bindings.count.set(4);
      flush();
      expect(bindings.doubled()).toBe(8);
      expect(effectLog).toEqual([1]);
      expect(cleanupLog).toEqual([]);

      bindings.setStep(3);
      flush();
      expect(effectLog).toEqual([1, 3]);
      expect(cleanupLog).toEqual([3]);

      dispose();
      expect(cleanupLog).toEqual([3, 3]);
    });
  });

  it("supports pipeable setup builders", () => {
    const order: string[] = [];
    const pagination = Component.setup<{ readonly start: number }>()
      .bind("page", () => {
        order.push("page");
        return Component.state(0);
      })
      .value("pageLabel", ({ props, bindings }) => {
        order.push("pageLabel");
        return `${props.start}:${bindings.page()}`;
      });

    const setup = Component.setup<{ readonly start: number }>()
      .bind("count", ({ props }) => {
        order.push("count");
        return Component.state(props.start);
      })
      .use(pagination)
      .bind("increment", ({ bindings }) => {
        order.push("increment");
        return Effect.succeed(() => bindings.count.update((n) => n + bindings.page() + 1));
      })
      .doEffect(({ bindings }) =>
        Effect.sync(() => {
          order.push(`ready:${bindings.pageLabel}`);
        })
      );

    const Counter = Component.make(
      Component.props<{ readonly start: number }>(),
      Component.require<never>(),
      setup,
      (_props, bindings) => bindings.count(),
    );

    const bindings = Effect.runSync(Component.setupEffect(Counter, { start: 2 }));

    expect(order).toEqual(["count", "page", "pageLabel", "increment", "ready:2:0"]);
    expect(bindings.count()).toBe(2);
    expect(bindings.page()).toBe(0);
    expect(bindings.pageLabel).toBe("2:0");

    bindings.page.set(3);
    bindings.increment();

    expect(bindings.count()).toBe(6);
  });

  it("ties Component.state writes to the provided setup scope", () => {
    const Counter = Component.make(
      Component.props<{ readonly start: number }>(),
      Component.require<never>(),
      ({ start }) => Effect.gen(function* () {
        const count = yield* Component.state(start);
        return { count };
      }),
      (_props, bindings) => bindings.count(),
    );

    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Component.setupEffect(Counter, { start: 1 }).pipe(Scope.provide(scope)),
    );

    bindings.count.set(2);
    expect(bindings.count()).toBe(2);

    Effect.runSync(Scope.close(scope, Exit.void));

    expect(bindings.count()).toBe(2);
    expect(() => bindings.count.set(3)).toThrow(
      "[effect-atom-jsx/Component.state] cannot write component-local state after its setup scope has closed.",
    );
  });

  it("ties Component.signal setters and Component.effect cleanup to the provided setup scope", () => {
    const effectLog: number[] = [];
    const cleanupLog: number[] = [];
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const [step, setStep] = yield* Component.signal(1);
        yield* Component.effect(() => {
          effectLog.push(step());
          return () => cleanupLog.push(step());
        });
        return { step, setStep };
      }),
      (_props, bindings) => bindings.step(),
    );

    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Component.setupEffect(Counter, {}).pipe(Scope.provide(scope)),
    );

    expect(effectLog).toEqual([1]);
    bindings.setStep(2);
    flush();
    expect(effectLog).toEqual([1, 2]);
    expect(cleanupLog).toEqual([2]);

    Effect.runSync(Scope.close(scope, Exit.void));

    expect(cleanupLog).toEqual([2, 2]);
    expect(() => bindings.setStep(3)).toThrow(
      "[effect-atom-jsx/Component.signal] cannot write component-local state after its setup scope has closed.",
    );
  });

  it("ties Component.action handles to the provided setup scope", async () => {
    const log: number[] = [];
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const save = yield* Component.action((n: number) =>
          Effect.sync(() => {
            log.push(n);
            return n + 1;
          })
        );
        return { save };
      }),
      () => null,
    );

    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Component.setupEffect(Counter, {}).pipe(Scope.provide(scope)),
    );

    bindings.save.run(1);
    await Effect.runPromise(Effect.sleep("5 millis"));
    expect(log).toEqual([1]);

    Effect.runSync(Scope.close(scope, Exit.void));

    expect(() => bindings.save.run(2)).toThrow(
      "[effect-atom-jsx/Component.action] cannot write component-local state after its setup scope has closed.",
    );
    await expect(Effect.runPromise(bindings.save.runEffect(3))).rejects.toThrow(
      "[effect-atom-jsx/Component.action] cannot write component-local state after its setup scope has closed.",
    );
  });

  it("ties Component.optimistic handles to the provided setup scope", () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const count = yield* Component.state(0);
        const save = yield* Component.optimistic(count).action({
          update: (current, delta: number) => current + delta,
          effect: (next) => Effect.succeed(next),
        });
        return { count, save };
      }),
      () => null,
    );

    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Component.setupEffect(Counter, {}).pipe(Scope.provide(scope)),
    );

    bindings.save.run(1);
    expect(bindings.save.value()).toBe(1);

    Effect.runSync(Scope.close(scope, Exit.void));

    expect(() => bindings.save.run(2)).toThrow(
      "[effect-atom-jsx/Component.optimistic] cannot write component-local state after its setup scope has closed.",
    );
    expect(() => bindings.save.clear()).toThrow(
      "[effect-atom-jsx/Component.optimistic] cannot write component-local state after its setup scope has closed.",
    );
  });

  it("clears Component.ref values when the provided setup scope closes", () => {
    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const node = yield* Component.ref<{ readonly id: string }>();
        node.current = { id: "node" };
        return { node };
      }),
      () => null,
    );

    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Component.setupEffect(Widget, {}).pipe(Scope.provide(scope)),
    );

    expect(bindings.node.current).toEqual({ id: "node" });

    Effect.runSync(Scope.close(scope, Exit.void));

    expect(bindings.node.current).toBeNull();
  });

  it("keeps unscoped Component.state usable for explicit setupEffect callers", () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const count = yield* Component.state(0);
        return { count };
      }),
      (_props, bindings) => bindings.count(),
    );

    const bindings = Effect.runSync(Component.setupEffect(Counter, {}));

    bindings.count.set(1);
    expect(bindings.count()).toBe(1);
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

  it("supports component-scoped optimistic actions", async () => {
    const Counter = Component.make(
      Component.props<{ readonly initial: number }>(),
      Component.require<never>(),
      ({ initial }) => Effect.gen(function* () {
        const count = yield* Component.state(initial);
        const save = yield* Component.optimistic(count).action({
          update: (current, delta: number) => current + delta,
          effect: (next) => Effect.succeed(next).pipe(Effect.delay("10 millis")),
        });
        return { count, save };
      }),
      (_props, bindings) => bindings.save.value(),
    );

    const bindings = Effect.runSync(Component.setupEffect(Counter, { initial: 1 }));
    bindings.save.run(2);

    expect(bindings.save.value()).toBe(3);
    expect(bindings.count()).toBe(1);
    expect(bindings.save.hasOptimistic()).toBe(true);

    await Effect.runPromise(Effect.sleep("20 millis"));

    expect(bindings.count()).toBe(3);
    expect(bindings.save.value()).toBe(3);
    expect(bindings.save.hasOptimistic()).toBe(false);
  });

  it("supports component action effect bridge", async () => {
    const log: Array<number> = [];
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const save = yield* Component.action((n: number) =>
          Effect.sync(() => {
            log.push(n);
            return n + 1;
          })
        );
        return { save };
      }),
      () => null,
    );

    const bindings = Effect.runSync(Component.setupEffect(Counter, {}));

    await Effect.runPromise(bindings.save.effect(3));
    const value = await Effect.runPromise(bindings.save.runEffect(4));

    expect(log).toEqual([3, 4]);
    expect(value).toBe(5);
  });

  it("runs component actions with the setup runtime context", async () => {
    type Api = { readonly save: (n: number) => Effect.Effect<number> };
    const Api = ServiceMap.Service<Api>("ComponentActionApi");

    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const save = yield* Component.action((n: number) =>
          Effect.gen(function* () {
            const api = yield* Api;
            return yield* api.save(n);
          })
        );
        return { save };
      }),
      () => null,
    ).pipe(
      Component.withLayer(Layer.succeed(Api, {
        save: (n) => Effect.succeed(n + 10),
      })),
    );

    const bindings = Effect.runSync(Component.setupEffect(Counter, {}));

    await Effect.runPromise(bindings.save.effect(1));
    await expect(Effect.runPromise(bindings.save.runEffect(2))).resolves.toBe(12);
  });

  it("runs component queries with the setup runtime context", async () => {
    type Api = { readonly load: () => Effect.Effect<string> };
    const Api = ServiceMap.Service<Api>("ComponentQueryApi");

    const User = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const user = yield* Component.query(() =>
          Effect.gen(function* () {
            const api = yield* Api;
            return yield* api.load();
          })
        );
        return { user };
      }),
      () => null,
    ).pipe(
      Component.withLayer(Layer.succeed(Api, {
        load: () => Effect.succeed("Ada"),
      })),
    );

    const bindings = Effect.runSync(Component.setupEffect(User, {}));

    await Effect.runPromise(Effect.sleep("5 millis"));
    const settled = bindings.user();
    expect(settled._tag).toBe("Success");
    if (settled._tag === "Success") {
      expect(settled.value).toBe("Ada");
    }
  });

  it("runs component optimistic actions with the setup runtime context", async () => {
    type Api = { readonly save: (n: number) => Effect.Effect<{ readonly confirmed: number }> };
    const Api = ServiceMap.Service<Api>("ComponentOptimisticApi");

    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const count = yield* Component.state(0);
        const save = yield* Component.optimistic(count).action({
          update: (current, delta: number) => current + delta,
          effect: (next) =>
            Effect.gen(function* () {
              const api = yield* Api;
              return yield* api.save(next);
            }),
          reconcile: (_optimistic, success) => success.confirmed,
        });
        return { count, save };
      }),
      () => null,
    ).pipe(
      Component.withLayer(Layer.succeed(Api, {
        save: (n) => Effect.succeed({ confirmed: n + 10 }),
      })),
    );

    const bindings = Effect.runSync(Component.setupEffect(Counter, {}));

    await expect(Effect.runPromise(bindings.save.runEffect(2))).resolves.toEqual({ confirmed: 12 });
    expect(bindings.count()).toBe(12);
    expect(bindings.save.value()).toBe(12);
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
    const rootSlot = View.Slot.make("root", {
      capability: Element.Capability.Container,
      allowedAttributes: [View.Attribute.AriaLabel],
    });
    const slots = View.Slots.make({
      root: View.Slot.bind(rootSlot, Element.container()),
    });
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
      () => Effect.succeed({ slots: View.Slots.handles(slots) }),
      () => View.fromSlots(slots, "rendered", { name: "WrappedView" }),
    ).pipe(Component.withSlots(slots));

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
    const inputSlot = View.Slot.make("input", {
      capability: Element.Capability.TextInput,
      allowedEvents: [View.Event.Input],
      platformRequirements: [View.Requirement.Keyboard],
    });
    const slots = View.Slots.make({
      input: View.Slot.bind(inputSlot, Element.textInput()),
    });
    const ViewBacked = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: View.Slots.handles(slots) }),
      () => View.fromSlots(slots, "rendered", { name: "InputView" }),
    ).pipe(Component.withSlots(slots));

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
    const rootSlot = View.Slot.make("root", {
      capability: Element.Capability.Container,
      allowedAttributes: [View.Attribute.AriaLabel],
    });
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
        children: ({ slots }) => {
          const slotContract = View.Slots.make({
            root: View.Slot.bind(rootSlot, slots.root),
          });
          return View.fromSlots(slotContract, "headless-view");
        },
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

  it("validates rendered View slots against the authored component slot contract", () => {
    const rootSlot = View.Slot.make("root", { capability: Element.Capability.Container });
    const slots = View.Slots.make({
      root: View.Slot.bind(rootSlot, Element.container()),
    });

    const Card = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: View.Slots.handles(slots) }),
      () => View.fromSlots(slots, "card", { name: "Card" }),
    ).pipe(Component.withSlots(slots));

    const diagnostics = Effect.runSync(Component.validateRenderedSlotContract(Card, {}));

    expect(diagnostics).toEqual([]);
    expect(Component.getSlotContract(Card)).toBe(slots);
  });

  it("reports declared slots missing from the rendered View", () => {
    const rootSlot = View.Slot.make("root", { capability: Element.Capability.Container });
    const inputSlot = View.Slot.make("input", { capability: Element.Capability.TextInput });
    const declaredSlots = View.Slots.make({
      root: View.Slot.bind(rootSlot, Element.container()),
      input: View.Slot.bind(inputSlot, Element.textInput()),
    });
    const renderedSlots = View.Slots.make({
      root: declaredSlots.bound.root,
    });

    const Field = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: View.Slots.handles(declaredSlots) }),
      () => View.fromSlots(renderedSlots, "field", { name: "Field" }),
    ).pipe(Component.withSlots(declaredSlots));

    const diagnostics = Effect.runSync(Component.validateRenderedSlotContract(Field, {}));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["component:missing-declared-slot"]);
    expect(diagnostics[0]?.slot).toBe("input");
    expect(diagnostics[0]?.declaredCapability).toBe("TextInput");
  });

  it("reports View slots that are not declared by the component contract", () => {
    const rootSlot = View.Slot.make("root", { capability: Element.Capability.Container });
    const extraSlot = View.Slot.make("extra", { capability: Element.Capability.Focusable });
    const declaredSlots = View.Slots.make({
      root: View.Slot.bind(rootSlot, Element.container()),
    });
    const renderedSlots = View.Slots.make({
      root: declaredSlots.bound.root,
      extra: View.Slot.bind(extraSlot, Element.focusable()),
    });

    const Card = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: View.Slots.handles(declaredSlots) }),
      () => View.fromSlots(renderedSlots, "card", { name: "Card" }),
    ).pipe(Component.withSlots(declaredSlots));

    const diagnostics = Effect.runSync(Component.validateRenderedSlotContract(Card, {}));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["component:undeclared-view-slot"]);
    expect(diagnostics[0]?.slot).toBe("extra");
    expect(diagnostics[0]?.renderedCapability).toBe("Focusable");
  });

  it("reports rendered slot capability mismatches", () => {
    const inputSlot = View.Slot.make("input", { capability: Element.Capability.TextInput });
    const declaredSlots = View.Slots.make({
      input: View.Slot.bind(inputSlot, Element.textInput()),
    });

    const Field = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: View.Slots.handles(declaredSlots) }),
      () => View.make({ input: Element.container() }, "field", {
        name: "Field",
        slotMetadata: {
          input: View.slot("input", { capability: Element.Capability.Container }),
        },
      }),
    ).pipe(Component.withSlots(declaredSlots));

    const diagnostics = Effect.runSync(Component.validateRenderedSlotContract(Field, {}));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["component:slot-capability-mismatch"]);
    expect(diagnostics[0]?.slot).toBe("input");
    expect(diagnostics[0]?.declaredCapability).toBe("TextInput");
    expect(diagnostics[0]?.renderedCapability).toBe("Container");
  });

  it("preserves component slot contracts through wrappers", () => {
    const rootSlot = View.Slot.make("root", { capability: Element.Capability.Container });
    const slots = View.Slots.make({
      root: View.Slot.bind(rootSlot, Element.container()),
    });
    const ready = Behavior.make<
      { readonly root: Element.Container },
      { readonly ready: true },
      never,
      never
    >(() => Effect.succeed({ ready: true as const }));

    const Card = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: View.Slots.handles(slots) }),
      () => View.fromSlots(slots, "card", { name: "Card" }),
    ).pipe(Component.withSlots(slots));

    const Wrapped = Card.pipe(
      Component.withBehavior(ready, (bindings) => ({ root: bindings.slots.root })),
      Component.withLayer(Layer.empty),
    );

    expect(Component.getSlotContract(Wrapped)).toBe(slots);
    expect(Effect.runSync(Component.validateRenderedSlotContract(Wrapped, {}))).toEqual([]);
  });
});
