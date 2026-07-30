/**
 * K0b — the Schema-first behaviour catalog convention.
 *
 * Owning doc: `docs/COMPONENT_KIT_PLAN.md`, "Foundation: behaviors (Schema
 * options + compose)" and phase K0b. Research: `docs/kit-research/behaviors/`.
 *
 * The convention: every catalog behaviour exports an `*Options` Schema plus a
 * `name(config?)` factory; data knobs are Schema fields (with defaults),
 * overridable algorithm steps are plain function props, extra bindings come
 * from `Behavior.compose`, and the factory result attaches to a slot contract.
 *
 * These specs also resolve the six `TODO(kit)` comments in `src/behaviors/*`:
 *  - "widened so resolved options stay boolean / keep the full unions" →
 *    defaults belong in the Schema (`Schema.withDecodingDefault`), so decoding
 *    a partial config yields the full option type with no hand-written
 *    `?? default` ladder — and omitting a field must not fail decoding.
 *  - "Behavior is not pipeable; use the applied provides form" → `Behavior`
 *    must be pipeable, so the documented `Behavior.make(...).pipe(...)` shape
 *    in the plan is the real authoring path.
 */
import { Effect, Exit, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick, unbuilt } from "../harness.js";

describe("catalog option contract", () => {
  it("[K0b] press() works with no config at all — Schema defaults, not a decode failure", async () => {
    const { press } = await fromSrc("behaviors/press", "press");
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const { interactive } = await fromSrc("Element", "interactive");

    let presses = 0;
    // No options supplied: every knob must come from the Schema's declared
    // defaults. Today `decodeOptions` forwards `undefined` into
    // `Schema.optionalKey` fields and throws a SchemaError, so `press()` and
    // `press({ onPress })` are unusable.
    const behavior = press({ onPress: () => { presses += 1; } });

    const target = interactive();
    const attached: any = Effect.runSync(attachScoped(behavior, { target }));

    // trackPressed defaults to true.
    expect(attached.bindings.isPressed()).toBe(false);
    target.emit("pointerdown", { button: 0, pointerId: 1 });
    expect(attached.bindings.isPressed()).toBe(true);
    target.emit("pointerup", { button: 0, pointerId: 1 });
    expect(attached.bindings.isPressed()).toBe(false);
    expect(presses).toBe(1);

    Effect.runSync(attached.dispose);
  });

  it("[K0b] rovingTabindex() works with a partial config and keeps the full option unions", async () => {
    const { rovingTabindex } = await fromSrc("behaviors/roving-tabindex", "rovingTabindex");
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const Element = await loadSrc("Element");
    const { container, focusable, collection } = pick(
      Element,
      "Element",
      "container",
      "focusable",
      "collection",
    );

    // A single non-default field. Everything else defaults from the Schema.
    const behavior = rovingTabindex({ loop: false });

    const items = [focusable(), focusable(), focusable()];
    const elements = { container: container(), items: collection(items) };
    const attached: any = Effect.runSync(attachScoped(behavior, elements));

    // default orientation is vertical
    elements.container.emit("keydown", { key: "ArrowDown" });
    expect(attached.bindings.currentIndex()).toBe(1);
    elements.container.emit("keydown", { key: "End" });
    expect(attached.bindings.currentIndex()).toBe(2);
    // loop: false — End then ArrowDown must clamp, not wrap.
    elements.container.emit("keydown", { key: "ArrowDown" });
    expect(attached.bindings.currentIndex()).toBe(2);

    // one tab stop
    expect(items[2]!.getAttr("tabIndex")).toBe(0);
    expect(items[0]!.getAttr("tabIndex")).toBe(-1);
    expect(items[1]!.getAttr("tabIndex")).toBe(-1);

    Effect.runSync(attached.dispose);
  });

  it("[K0b] a malformed config fails closed as a typed error, not a thrown ParseError at factory time", async () => {
    const { press } = await fromSrc("behaviors/press", "press");
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const { interactive } = await fromSrc("Element", "interactive");

    // Plan acceptance item 4: decode is fail-closed *and typed*. Constructing
    // a behaviour is not an Effect, so the failure must surface where there is
    // an error channel — on attach — never as a synchronous throw.
    let behavior: unknown;
    expect(() => {
      // Every other field is supplied explicitly, so the ONLY defect is the
      // malformed one - this must not accidentally re-test missing defaults.
      behavior = press({
        trackPressed: "yes" as unknown as boolean,
        preventFocusOnPress: false,
        onPress: () => {},
      });
    }).not.toThrow();

    const exit = Effect.runSyncExit(
      attachScoped(behavior as any, { target: interactive() }),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("[K0b] every catalog option struct is wire-serializable; function props never are", async () => {
    const press = await loadSrc("behaviors/press");
    const roving = await loadSrc("behaviors/roving-tabindex");
    const collection = await loadSrc("behaviors/collection");
    const { PressOptions } = pick(press, "behaviors/press", "PressOptions");
    const { RovingTabindexOptions } = pick(
      roving,
      "behaviors/roving-tabindex",
      "RovingTabindexOptions",
    );
    const { CollectionOptions } = pick(
      collection,
      "behaviors/collection",
      "CollectionOptions",
    );

    // Options are Schema data, so a configuration round-trips through the wire
    // — the portability on-ramp (plan acceptance item 6).
    for (const [schema, value] of [
      [PressOptions, { trackPressed: true, preventFocusOnPress: false }],
      [RovingTabindexOptions, { orientation: "horizontal", loop: false, virtual: false, initialIndex: 1 }],
      [CollectionOptions, { trackDisabled: true, setPosInSet: false }],
    ] as const) {
      const encoded = JSON.parse(
        JSON.stringify(Schema.encodeUnknownSync(schema as any)(value)),
      );
      expect(Schema.decodeUnknownSync(schema as any)(encoded)).toEqual(value);
    }

    // ...and a function prop never becomes part of the decoded options struct,
    // so it cannot reach a serialized surface by accident.
    // Not "unknown keys are dropped" (that is Schema.Struct's own behaviour) -
    // the guarantee is that no catalog options struct *declares* a field whose
    // value could be a function, so `props` can never leak onto the wire.
    for (const schema of [PressOptions, RovingTabindexOptions, CollectionOptions]) {
      const fields = (schema as any).fields ?? {};
      expect(Object.keys(fields).length).toBeGreaterThan(0);
      for (const [name, field] of Object.entries(fields)) {
        const encodedOk = (() => {
          try {
            Schema.encodeUnknownSync(field as any)(() => {});
            return true;
          } catch {
            return false;
          }
        })();
        expect(
          `${name}:${encodedOk ? "accepts-function" : "rejects-function"}`,
        ).toBe(`${name}:rejects-function`);
      }
    }
  });
});

describe("catalog composition contract", () => {
  it("[K0b] Behavior is pipeable, so the documented make(...).pipe(provides(...)) shape works", async () => {
    const Behavior = await loadSrc("Behavior");
    const { make, provides, binding, attachScoped } = pick(
      Behavior,
      "Behavior",
      "make",
      "provides",
      "binding",
      "attachScoped",
    );

    const b = make(() => Effect.succeed({ buffer: "" })).pipe(
      provides({ buffer: binding("buffer") }),
    );

    expect(b.metadata.provides.buffer.name).toBe("buffer");
    const attached: any = Effect.runSync(attachScoped(b, {}));
    expect(attached.bindings).toEqual({ buffer: "" });
    Effect.runSync(attached.dispose);
  });

  it("[K0b] compose merges bindings, provides-metadata, and runs members in order", async () => {
    const Behavior = await loadSrc("Behavior");
    const { make, provides, binding, compose, attachScoped } = pick(
      Behavior,
      "Behavior",
      "make",
      "provides",
      "binding",
      "compose",
      "attachScoped",
    );

    const order: Array<string> = [];
    const released: Array<string> = [];
    const member = (name: string, bindings: Record<string, unknown>) =>
      make(() =>
        Effect.gen(function* () {
          order.push(name);
          yield* Effect.acquireRelease(Effect.void, () =>
            Effect.sync(() => {
              released.push(name);
            }));
          return bindings;
        })
      );
    const first = provides({ a: binding("a") })(member("first", { a: 1 }));
    const second = provides({ b: binding("b") })(member("second", { b: 2 }));

    const stacked = compose(first, second);
    const attached: any = Effect.runSync(attachScoped(stacked, {}));

    expect(order).toEqual(["first", "second"]);
    expect(attached.bindings).toEqual({ a: 1, b: 2 });
    expect(Object.keys(stacked.metadata.provides).sort()).toEqual(["a", "b"]);

    // House rule 4: one dispose releases EVERY member exactly once, and a
    // second dispose is a no-op. A compose that drops a member's finalizer
    // must fail here.
    Effect.runSync(attached.dispose);
    Effect.runSync(attached.dispose);
    expect(released).toEqual(["second", "first"]);

    // Composition portability: an opaque member makes the stack opaque.
    const { inspectAttachment } = pick(Behavior, "Behavior", "inspectAttachment");
    expect(inspectAttachment(stacked).kind).toBe("opaque");
  });

  it("[K0b] the load-bearing five all exist as Schema-option factories", async () => {
    // collection / rovingTabindex / press are landed; dismissableLayer (as a
    // service + behavior) and anchorPosition are the remaining two.
    const { dismissableLayer, DismissableLayerOptions } = await fromSrc(
      "behaviors/dismissable-layer",
      "dismissableLayer",
      "DismissableLayerOptions",
    );
    const { anchorPosition, AnchorPositionOptions } = await fromSrc(
      "behaviors/anchor-position",
      "anchorPosition",
      "AnchorPositionOptions",
    );

    // Every knob is a Schema field with a declared default (the research docs'
    // decided option matrices).
    expect(Schema.decodeUnknownSync(DismissableLayerOptions)({})).toMatchObject({
      dismissOnEscape: true,
      dismissOnOutsidePress: true,
      disableOutsidePointerEvents: false,
    });
    expect(Schema.decodeUnknownSync(AnchorPositionOptions)({})).toMatchObject({
      placement: "bottom-start",
    });

    // ...and each factory produces an attachable Behavior with the documented
    // element contract and provided bindings — not merely a function.
    const { inspectAttachment } = await fromSrc("Behavior", "inspectAttachment");
    const layer = dismissableLayer({ onDismiss: () => {} });
    expect(Object.keys(layer.metadata?.provides ?? {})).toContain("isTopmost");
    // DOM measurement / global listeners are opaque, never falsely portable.
    expect(inspectAttachment(layer).kind).toBe("opaque");

    const anchored = anchorPosition({ placement: "top-end" });
    expect(Object.keys(anchored.metadata?.provides ?? {})).toContain("coords");
    expect(Object.keys(anchored.metadata?.events ?? {})).toEqual(
      expect.arrayContaining(["floating"]),
    );
  });

  it("[K0b] anchorPosition unsubscribes its autoUpdate observer exactly once on scope close", async () => {
    const { anchorPosition } = await fromSrc(
      "behaviors/anchor-position",
      "anchorPosition",
    );
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const Element = await loadSrc("Element");
    const { container, interactive } = pick(
      Element,
      "Element",
      "container",
      "interactive",
    );

    let updates = 0;
    let stops = 0;
    const attached: any = Effect.runSync(
      attachScoped(
        anchorPosition({
          placement: "bottom-start",
          // injected measurement seam — no DOM, no floating-ui, in unit tests
          measure: () => ({ x: 10, y: 20 }),
          autoUpdate: (run: () => void) => {
            updates += 1;
            run();
            return () => {
              stops += 1;
            };
          },
        }),
        { anchor: interactive(), floating: container() },
      ),
    );

    expect(attached.bindings.coords()).toEqual({ x: 10, y: 20 });
    expect(updates).toBe(1);

    Effect.runSync(attached.dispose);
    Effect.runSync(attached.dispose);
    expect(stops).toBe(1);
  });

  it("[K0b] nested dismissable layers: Escape dismisses the topmost layer only", async () => {
    const { dismissableLayer } = await fromSrc(
      "behaviors/dismissable-layer",
      "dismissableLayer",
    );
    const { DismissLayerStack } = await fromSrc(
      "behaviors/dismissable-layer",
      "DismissLayerStack",
    );
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const { container } = await fromSrc("Element", "container");

    const dismissed: Array<string> = [];
    const parentRoot = container();
    const childRoot = container();

    // ONE stack instance shared by both layers, provided as a Layer — never a
    // module global. That is the whole point of making the stack a service:
    // two concurrent SSR requests get two stacks, and a test gets its own.
    const stack: any = Effect.runSync(
      Effect.provide(Effect.service(DismissLayerStack), DismissLayerStack.layer) as any,
    );
    const attachIn = (name: string, root: unknown) =>
      Effect.runSync(
        attachScoped(
          dismissableLayer({ onDismiss: () => dismissed.push(name) }),
          { root },
        ).pipe(Effect.provideService(DismissLayerStack, stack)) as any,
      ) as any;

    const parent = attachIn("parent", parentRoot);
    const child = attachIn("child", childRoot);

    // The stack is observable state, not a hidden global.
    expect(stack.layers().length).toBe(2);

    childRoot.emit("keydown", { key: "Escape" });
    expect(dismissed).toEqual(["child"]);

    Effect.runSync(child.dispose);
    parentRoot.emit("keydown", { key: "Escape" });
    expect(dismissed).toEqual(["child", "parent"]);

    Effect.runSync(parent.dispose);
    // Disposed layers are out of the stack: no further dismissals, and the
    // stack pops exactly once per layer.
    parentRoot.emit("keydown", { key: "Escape" });
    expect(dismissed).toEqual(["child", "parent"]);
    expect(stack.layers().length).toBe(0);
  });

  it("[K0b] two sibling subtrees get independent layer stacks (no cross-subtree bleed)", async () => {
    const { dismissableLayer, DismissLayerStack } = await fromSrc(
      "behaviors/dismissable-layer",
      "dismissableLayer",
      "DismissLayerStack",
    );
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const { container } = await fromSrc("Element", "container");

    const dismissed: Array<string> = [];
    const makeStack = () =>
      Effect.runSync(
        Effect.provide(Effect.service(DismissLayerStack), DismissLayerStack.layer) as any,
      ) as any;

    // Two isolated stacks, as two `Component.withLayer` subtrees would produce.
    const left = makeStack();
    const right = makeStack();
    expect(left).not.toBe(right);

    const rootA = container();
    const rootB = container();
    Effect.runSync(
      attachScoped(dismissableLayer({ onDismiss: () => dismissed.push("a") }), {
        root: rootA,
      }).pipe(Effect.provideService(DismissLayerStack, left)) as any,
    );
    Effect.runSync(
      attachScoped(dismissableLayer({ onDismiss: () => dismissed.push("b") }), {
        root: rootB,
      }).pipe(Effect.provideService(DismissLayerStack, right)) as any,
    );

    // Each layer is topmost *of its own stack*, so both dismiss — the exact
    // opposite of the shared-stack case, and impossible with a module global.
    expect(left.layers().length).toBe(1);
    expect(right.layers().length).toBe(1);
    rootA.emit("keydown", { key: "Escape" });
    rootB.emit("keydown", { key: "Escape" });
    expect(dismissed).toEqual(["a", "b"]);
  });

  it("[K0b] a behavior's dependencies arrive on the deps channel, not smuggled through the elements record", async () => {
    // DQ-052, half one: the caller-supplied case — "the call site knows this
    // value". `Behavior.make<Elements, Deps, …>((elements, deps) => …)` and
    // `attachScoped(behavior, elements, { deps })`.
    //
    // Rejected alternative on record: expressing dependencies as Effect
    // requirements on `Req`. That loses per-instance identity — the same class
    // of mistake as DQ-050's shared handles, since a behavior attached twice to
    // two elements would share one dependency. The spec below is what makes
    // that concrete.
    const Behavior = await loadSrc("Behavior");
    const { make, attachScoped } = pick(Behavior, "Behavior", "make", "attachScoped");
    const { interactive } = await fromSrc("Element", "interactive");
    const { state } = await fromSrc("Component", "state");

    const bumpBy = make((elements: any, deps: any) =>
      Effect.gen(function* () {
        yield* elements.target.on("click", () => deps.total.set(deps.total() + deps.step));
        return { total: deps.total };
      })
    );

    const scope = Scope.makeUnsafe();
    const newState = (initial: unknown) =>
      Effect.runSync(Effect.provideService(state(initial), Scope.Scope, scope) as any) as any;
    const left = { target: interactive(), total: newState(0) };
    const right = { target: interactive(), total: newState(0) };

    const a: any = Effect.runSync(
      attachScoped(bumpBy, { target: left.target }, {
        deps: { total: left.total, step: 1 },
      }) as any,
    );
    const b: any = Effect.runSync(
      attachScoped(bumpBy, { target: right.target }, {
        deps: { total: right.total, step: 100 },
      }) as any,
    );

    // Two attachments of ONE behavior, two dependency sets. Per-instance
    // identity is the whole reason deps are a channel and not a service.
    left.target.emit("click", {});
    expect(a.bindings.total()).toBe(1);
    expect(b.bindings.total()).toBe(0);

    right.target.emit("click", {});
    expect(a.bindings.total()).toBe(1);
    expect(b.bindings.total()).toBe(100);

    Effect.runSync(a.dispose);
    Effect.runSync(b.dispose);
    Effect.runSync(Scope.close(scope, Exit.void));
  });

  it("[K0b] a behavior-to-behavior dependency resolves from the component's existing bindings", async () => {
    // DQ-052, half two: "the component already has this binding". The two
    // halves answer different questions and the decision takes both, so a
    // behavior must be attachable without the call site restating a value the
    // component already published.
    const Component = await loadSrc("Component");
    const { make, props, require, setup, setupEffect, renderViewWithBindings, state, withSlots } =
      pick(
        Component,
        "Component",
        "make",
        "props",
        "require",
        "setup",
        "setupEffect",
        "renderViewWithBindings",
        "state",
        "withSlots",
      );
    const Behavior = await loadSrc("Behavior");
    const { make: behaviorMake, attachTo } = pick(Behavior, "Behavior", "make", "attachTo");
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    const Anatomy = Slots.define({ root: { capability: Capability.Container } });

    const mirror = behaviorMake((elements: any, deps: any) =>
      Effect.gen(function* () {
        yield* elements.root.on("click", () => deps.selected.set("clicked"));
        return { mirrored: () => deps.selected() };
      })
    );

    const Widget = make(
      props(),
      require(),
      setup().bind("selected", () => state("initial")),
      () => fromSlots(Anatomy, null),
    ).pipe(
      withSlots(Anatomy),
      // No `{ deps }` at the call site: `selected` is resolved from the
      // component's own bindings by name. That is what makes a behavior
      // composable against a component that already owns the state.
      attachTo(mirror, { root: "root" }),
    );

    const scope = Scope.makeUnsafe();
    const bindings: any = Effect.runSync(
      Effect.provideService(setupEffect(Widget, {}), Scope.Scope, scope) as any,
    );
    const view: any = renderViewWithBindings(Widget, {}, bindings);

    expect(bindings.mirrored()).toBe("initial");
    view.slots.root.emit("click", {});
    // Same atom, seen from both sides — not a copy.
    expect(bindings.selected()).toBe("clicked");
    expect(bindings.mirrored()).toBe("clicked");

    Effect.runSync(Scope.close(scope, Exit.void));
  });

  it("[K0c] Mixin packages tag + options Schema + props + effect and materializes to an identical Behavior", async () => {
    unbuilt(
      "Mixin.create/toBehavior fragment merge (golden parity with a hand-written Schema factory)",
      "DQ-065",
    );
  });
});
