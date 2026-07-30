/**
 * K1 / K4 — the no-fork guarantee, written as the "hostile customization"
 * suite the plan demands.
 *
 * Owning doc: `docs/COMPONENT_KIT_PLAN.md`, "Gap 3 — Distribution: one package,
 * and the no-fork guarantee": *if a reasonable customization can only be
 * achieved by forking widget source, that is a missing external axis — a kit
 * API bug.* Each widget ships its layers (anatomy, machine, behavior, recipe,
 * assembled default) and every customization must be expressible from outside
 * over plain imports.
 *
 * The widget below plays the part of a published kit widget: the specs may only
 * touch its exported layers, exactly as a consumer of `@affe/kit` could. If a
 * spec here needs anything that is not reachable from outside, that is the bug.
 */
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick } from "../harness.js";

/** Stand-in for one published kit widget's exported layer set. */
async function publishedWidget() {
  const Component = await loadSrc("Component");
  const { make, props, require, setup, withSlots } = pick(
    Component,
    "Component",
    "make",
    "props",
    "require",
    "setup",
    "withSlots",
  );
  const Behavior = await loadSrc("Behavior");
  const { make: behaviorMake, provides, binding, attachTo } = pick(
    Behavior,
    "Behavior",
    "make",
    "provides",
    "binding",
    "attachTo",
  );
  const Style = await loadSrc("Style");
  const {
    slot: styleSlot,
    recipe: styleRecipe,
    attachToSlots: attachStyle,
    make: styleMake,
  } = pick(Style, "Style", "slot", "recipe", "attachToSlots", "make");
  const ViewModule = await loadSrc("View");
  const { Slots, fromSlots } = pick(ViewModule, "View", "Slots", "fromSlots");
  const { Capability } = await fromSrc("Element", "Capability");

  /** Layer 1 — anatomy. */
  const Anatomy = Slots.define({
    root: { capability: Capability.Container },
    header: { capability: Capability.Container },
    item: { capability: Capability.Focusable },
  });

  /** Layer 2 — recipe *data* (not a closed function). */
  const recipeData = {
    slots: ["root", "header", "item"] as const,
    base: {
      root: styleSlot({ padding: "md", backgroundColor: "surface" }),
      header: styleSlot({ fontSize: "body.md" }),
      item: styleSlot({ padding: "sm" }),
    },
    variants: {
      size: {
        sm: { root: styleSlot({ padding: "sm" }) },
        lg: { root: styleSlot({ padding: "lg" }) },
      },
    },
    defaults: { size: "sm" },
  };

  /** Layer 3 — behavior factory (Schema-shaped options + function props). */
  const navigate = (config: { readonly onMove?: (n: number) => void } = {}) =>
    provides({ index: binding("index") })(
      behaviorMake((elements: any) =>
        Effect.gen(function* () {
          let index = 0;
          const moves: Array<number> = [];
          yield* elements.container.on("keydown", (event: any) => {
            if (event?.key !== "ArrowDown") return;
            index += 1;
            moves.push(index);
            config.onMove?.(index);
          });
          return { index: () => index, moves: () => moves, kind: "kit" };
        })
      ),
    );

  /** Layer 4 — assembled, themed default. */
  // DQ-050: setup declares no handles. The rendered view is the single source
  // of truth and `bindings.slots` is its projection.
  const assembled = make(
    props(),
    require(),
    setup(),
    () => fromSlots(Anatomy, null),
  ).pipe(
    withSlots(Anatomy),
    // DQ-051: the remap's keys are the behavior's element keys and its values
    // are the *component's* slot names. No cast — the whole point of moving
    // the capability contract onto the component is that this call site is
    // typed, and a slot whose capability does not satisfy `container`'s is a
    // compile error (pinned in `src/type-tests/`).
    attachTo(navigate(), { container: "root" }),
    attachStyle(styleMake(styleRecipe(recipeData)({ size: "sm" })), Anatomy),
  );

  return {
    Anatomy,
    recipeData,
    navigate,
    behaviorMake,
    provides,
    binding,
    attachTo,
    attachStyle,
    styleSlot,
    styleRecipe,
    styleMake,
    Component,
    assembled,
    setupEffect: pick(Component, "Component", "setupEffect").setupEffect,
    renderViewWithBindings: pick(Component, "Component", "renderViewWithBindings")
      .renderViewWithBindings,
    slotsOfBindings: (bindings: any) => bindings.slots,
  };
}

/**
 * Set the widget up and render it, so both attachment paths run: behaviors from
 * committed bindings, styles from the rendered `View.fromSlots` contract.
 */
function runWidget(kit: any, component: unknown) {
  const scope = Scope.makeUnsafe();
  const bindings: any = Effect.runSync(
    Effect.provideService(kit.setupEffect(component, {}), Scope.Scope, scope),
  );
  const view: any = kit.renderViewWithBindings(component, {}, bindings);
  return {
    bindings,
    view,
    slots: view?.slots ?? bindings.slots,
    close: () => Effect.runSync(Scope.close(scope, Exit.void)),
  };
}

describe("hostile customization (no-fork guarantee)", () => {
  it("[K1] restyle: a consumer patches the kit recipe with mergeRecipes and gets a new variant + default, without touching kit source", async () => {
    const kit = await publishedWidget();
    const { mergeRecipes } = await fromSrc("Style", "mergeRecipes");

    const brandRecipe = mergeRecipes(kit.recipeData, {
      variants: {
        size: { xl: { root: kit.styleSlot({ padding: "xl" }) } },
        intent: { brand: { root: kit.styleSlot({ backgroundColor: "accent.default" }) } },
      },
      defaults: { size: "xl", intent: "brand" },
    });

    // The base recipe is untouched: merging is pure data, never mutation.
    expect((kit.recipeData.variants as any).intent).toBeUndefined();
    expect(kit.recipeData.defaults).toEqual({ size: "sm" });

    const brandButton = kit.styleRecipe(brandRecipe);
    const restyled = kit.assembled.pipe(kit.attachStyle(kit.styleMake(brandButton()), kit.Anatomy));

    const { slots, close } = runWidget(kit, restyled);
    const root = slots.root;

    // Consumer attachment is composed last, so it wins over the kit default:
    // spacing xl = 32, where the kit default (size: "sm") resolved to 8.
    expect(root.getStyle("padding")).toBe(32);
    expect(String(root.getStyle("backgroundColor"))).not.toBe("#ffffff");

    close();
  });

  it("[K1] reslot: the kit behavior is re-piped onto a different slot of the same anatomy", async () => {
    const kit = await publishedWidget();

    // The kit default wires navigation to `root`. A consumer wants the header
    // to own the keyboard interaction instead — expressible because attachment
    // is an external stage taking the slot as an argument.
    const moves: Array<number> = [];
    const reslotted = kit.assembled.pipe(
      // The kit default already binds `index` from `root`. Re-attaching the
      // same behavior to `header` would collide on that binding name, so the
      // remap carries `as` — the ratified namespacing form that replaces the
      // untyped `merge?` callback. Everything this attachment provides lands
      // under `bindings.header_nav`.
      kit.attachTo(kit.navigate({ onMove: (n: number) => moves.push(n) }), {
        container: "header",
        as: "header_nav",
      }),
    );

    const { bindings, slots, close } = runWidget(kit, reslotted);

    slots.header.emit("keydown", { key: "ArrowDown" });
    expect(moves).toEqual([1]);

    // Both attachments coexist without either being edited.
    expect(bindings.header_nav.index()).toBe(1);
    expect(bindings.index()).toBe(0);

    close();
  });

  it("[K1] override: wrapping the kit behavior adds a step, and replacing it swaps the algorithm", async () => {
    const kit = await publishedWidget();
    const { compose } = await fromSrc("Behavior", "compose");

    // WRAP — compose a sibling that adds bindings and observes the same event.
    const announced: Array<number> = [];
    const wrapped = compose(
      kit.navigate({ onMove: (n: number) => announced.push(n) }),
      kit.behaviorMake((elements: any) =>
        Effect.gen(function* () {
          yield* elements.container.on("keydown", () => {
            announced.push(-1);
          });
          return { announcer: true };
        })
      ),
    );

    const wrapping = kit.assembled.pipe(
      kit.attachTo(wrapped, { container: "header", as: "wrapped" }),
    );
    const first = runWidget(kit, wrapping);
    first.slots.header.emit("keydown", { key: "ArrowDown" });
    expect(announced).toEqual([1, -1]);
    expect(first.bindings.wrapped.announcer).toBe(true);
    first.close();

    // REPLACE — a completely different algorithm on the same slot contract,
    // providing the same binding name. The kit factory is simply not called.
    const replacement = kit.provides({ index: kit.binding("index") })(
      kit.behaviorMake((elements: any) =>
        Effect.gen(function* () {
          let index = 100;
          yield* elements.container.on("keydown", () => {
            index += 10;
          });
          return { index: () => index, kind: "consumer" };
        })
      ),
    );

    // A fresh widget instance for the REPLACE phase: reusing `kit` would leave
    // the wrap phase's listeners live (see the Element.on leak) and make this
    // spec's result depend on the previous phase.
    const kit2 = await publishedWidget();
    const replacement2 = kit2.provides({ index: kit2.binding("index") })(
      kit2.behaviorMake((elements: any) =>
        Effect.gen(function* () {
          let index = 100;
          yield* elements.container.on("keydown", () => {
            index += 10;
          });
          return { index: () => index, kind: "consumer" };
        })
      ),
    );
    void replacement;
    const replaced = kit2.assembled.pipe(
      // No `as`: the replacement deliberately collides with the kit default's
      // `index` on the same slot, which is the documented replace path.
      kit2.attachTo(replacement2, { container: "root" }),
    );
    const second = runWidget(kit2, replaced);
    second.slots.root.emit("keydown", { key: "ArrowDown" });

    // Last attachment wins on the shared binding name — the documented
    // replace path, with no kit edit and no fork.
    expect(second.bindings.kind).toBe("consumer");
    expect(second.bindings.index()).toBe(110);
    second.close();
  });

  it("[K1] identity attachment takes no argument at all", async () => {
    const kit = await publishedWidget();

    // DQ-051: when the behavior's element keys already *are* the component's
    // slot names, there is nothing to remap and the second argument is absent.
    // A required-but-identity `{ root: "root" }` is ceremony that pushes
    // authors toward the untyped escape hatch, which is how the suite grew 99
    // casts in the first place.
    const observed: Array<string> = [];
    const watchRoot = kit.behaviorMake((elements: any) =>
      Effect.gen(function* () {
        yield* elements.root.on("click", () => observed.push("root"));
        return { watching: true };
      })
    );

    const wired = kit.assembled.pipe(kit.attachTo(watchRoot));
    const { bindings, slots, close } = runWidget(kit, wired);

    slots.root.emit("click", {});
    expect(observed).toEqual(["root"]);
    expect(bindings.watching).toBe(true);

    // Negative control: identity attachment wires `root` and nothing else, so
    // an implementation that fans out to every slot is caught.
    slots.header.emit("click", {});
    slots.item.emit("click", {});
    expect(observed).toEqual(["root"]);

    close();
  });

  it("[K1] a behavior's `provides` state is materialized in the COMPONENT's scope, so replacing its owner does not reset it", async () => {
    const kit = await publishedWidget();
    const { state } = pick(kit.Component, "Component", "state");

    // DQ-053. `Component.state` called inside a behavior's `run` binds to that
    // BEHAVIOR's scope today, so the sanctioned no-fork move — replace the
    // behavior, keep the widget — silently discards the state it owned. That
    // is a hole in the no-fork guarantee itself: the guarantee holds only for
    // stateless behaviors, and the failure reads as "the widget forgot",
    // filed against the customizer.
    //
    // Decision: the behavior keeps authoring the state locally but DECLARES it
    // in `metadata.provides`; the attach machinery materializes the atom in the
    // component's scope and hands it in through DQ-052's deps channel. What is
    // pinned below is that ownership move and its consequence; the exact
    // spelling of the declaration is the implementer's, so it is written in the
    // most obvious extension of the existing `Behavior.binding(name)` form.
    const counter = (step: number, tag: string) =>
      kit.provides({ count: kit.binding("count", { state: () => state(0) }) })(
        kit.behaviorMake((elements: any, deps: any) =>
          Effect.gen(function* () {
            yield* elements.container.on("keydown", () => deps.count.set(deps.count() + step));
            return { count: deps.count, algorithm: tag };
          })
        ),
      );

    // NEGATIVE CONTROL: attached once, the state behaves like any other
    // binding. Without this, "never materialize anything" passes the swap
    // assertion below by accident.
    const single = kit.assembled.pipe(kit.attachTo(counter(1, "v1"), { container: "header" }));
    const solo = runWidget(kit, single);
    solo.slots.header.emit("keydown", { key: "ArrowDown" });
    expect(solo.bindings.count()).toBe(1);
    expect(solo.bindings.algorithm).toBe("v1");
    solo.close();

    // The consumer replaces the algorithm with one whose `provides` shape
    // matches. Both attachments are live on ONE component instance, and both
    // must be writing the SAME atom — the one the component owns.
    const swapped = kit.assembled.pipe(
      kit.attachTo(counter(1, "v1"), { container: "header" }),
      kit.attachTo(counter(10, "v2"), { container: "header" }),
    );
    const widget = runWidget(kit, swapped);

    expect(widget.bindings.algorithm).toBe("v2");
    widget.slots.header.emit("keydown", { key: "ArrowDown" });

    // 11, not 10: one keydown reaches both handlers and they increment one
    // shared atom. A per-behavior atom would expose 10 (v2's own, fresh) and
    // strand v1's — which is exactly the silent discard being specified away.
    expect(widget.bindings.count()).toBe(11);

    widget.close();
  });

  it("[K1] replacing a behavior whose `provides` shape does NOT match is surfaced, never a silent reset", async () => {
    const kit = await publishedWidget();
    const { state } = pick(kit.Component, "Component", "state");

    const owned = (init: unknown) =>
      kit.provides({ count: kit.binding("count", { state: () => state(init) }) })(
        kit.behaviorMake(() => Effect.succeed({ ok: true })),
      );

    // NEGATIVE CONTROL: matching shapes are accepted cleanly — no throw, no
    // diagnostic, and the widget works. Without this, "reject every second
    // attachment" satisfies the rejection half forever.
    const matching = kit.assembled.pipe(
      kit.attachTo(owned(0), { container: "header" }),
      kit.attachTo(owned(0), { container: "header" }),
    );
    const clean = runWidget(kit, matching);
    expect(clean.bindings.ok).toBe(true);
    expect(clean.bindings.count()).toBe(0);
    expect((clean.bindings.diagnostics ?? []).length).toBe(0);
    clean.close();

    // MISMATCH: same binding name, incompatible state. The DECIDED semantics
    // are "a diagnostic, never a silent reset". The diagnostic *surface* is
    // not pinned, because DQ-057 (`provides` merges last-wins with no conflict
    // diagnostic) is still open and owns where conflicts are reported — so a
    // throw, a failed Effect, or a returned diagnostic all satisfy this.
    // Silently swallowing it does not.
    const mismatched = kit.assembled.pipe(
      kit.attachTo(owned(0), { container: "header" }),
      kit.attachTo(owned("zero"), { container: "header" }),
    );

    let surfaced = false;
    let result: any;
    try {
      result = runWidget(kit, mismatched);
      surfaced = ((result.bindings.diagnostics ?? []) as ReadonlyArray<unknown>).length > 0;
    } catch {
      surfaced = true;
    } finally {
      result?.close();
    }
    expect(surfaced).toBe(true);
  });

  it("[K1] the slot contract survives every customization stage (Props/Req/E/Bindings are pinned by src/type-tests)", async () => {
    const kit = await publishedWidget();
    const { getSlotContract } = pick(kit.Component, "Component", "getSlotContract");
    const { compose } = await fromSrc("Behavior", "compose");

    const customized = kit.assembled.pipe(
      kit.attachTo(
        compose(kit.navigate(), kit.behaviorMake(() => Effect.succeed({ extra: 1 }))),
        { container: "header", as: "stacked" },
      ),
      kit.attachStyle(
        kit.styleMake(kit.styleRecipe(kit.recipeData)({ size: "lg" })),
        kit.Anatomy,
      ),
    );

    // Slot contract metadata is preserved through behavior + style stages, so
    // a downstream consumer can keep customizing.
    expect(getSlotContract(customized)).toBe(kit.Anatomy);

    const { slots, close } = runWidget(kit, customized);
    expect(Object.keys(slots).sort()).toEqual([
      "header",
      "item",
      "root",
    ]);
    close();
  });

  it("[K4] a published kit widget exports each of its six layers separately", async () => {
    // Tokens → Recipe → Anatomy (+A11y pattern) → Machine → Behavior →
    // assembled Component, each independently importable so "customize" means
    // recomposing published layers.
    const dialog = await loadSrc("kit/dialog");
    const { tokens, Anatomy, pattern, machine, behavior, recipe, Dialog } = pick(
      dialog,
      "kit/dialog",
      "tokens",
      "Anatomy",
      "pattern",
      "machine",
      "behavior",
      "recipe",
      "Dialog",
    );
    // Each layer must be usable *on its own*, which is the whole point of
    // exporting them: our anatomy with your machine, our machine with your DOM.
    const { Slots } = await fromSrc("View", "Slots");
    const { validate } = await fromSrc("A11y", "validate");
    const { fromSlots } = await fromSrc("View", "fromSlots");
    const { spawn } = await fromSrc("Machine", "spawn");
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const { recipe: styleRecipe } = await fromSrc("Style", "recipe");

    // anatomy + pattern: the anatomy alone satisfies the ARIA contract.
    expect(pattern.name).toBe("dialog");
    expect(validate(pattern, fromSlots(Anatomy, null))).toEqual([]);

    // machine alone: spawnable, and its states are the documented ones.
    const scope = Scope.makeUnsafe();
    const spawned: any = Effect.runSync(
      Effect.provideService(spawn(machine), Scope.Scope, scope) as any,
    );
    expect(spawned.matches("Closed")).toBe(true);

    // behavior alone: attachable to the anatomy's handles, providing `isOpen`.
    const attached: any = Effect.runSync(
      Effect.provideService(
        attachScoped(behavior(), Slots.handles(Anatomy)) as any,
        Scope.Scope,
        scope,
      ),
    );
    expect(attached.bindings.isOpen()).toBe(false);

    // recipe alone: plain data, selectable without the assembled component.
    expect(Object.keys(styleRecipe(recipe)()).sort()).toEqual(
      Object.keys(Anatomy.bound).sort(),
    );

    // tokens alone: a Theme layer, swappable without touching the widget.
    expect(typeof tokens.layer).toBe("function");

    // ...and the assembled default is a component, not a factory of one.
    const { ComponentTypeId } = await fromSrc("Component", "ComponentTypeId");
    expect((Dialog as any)[ComponentTypeId]).toBeDefined();

    Effect.runSync(Scope.close(scope, Exit.void));
  });
});
