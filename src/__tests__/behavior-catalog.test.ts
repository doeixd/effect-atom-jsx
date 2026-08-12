/**
 * K0b — the Schema-first behavior catalog convention. Promoted from
 * `future/components/behavior-catalog.spec.ts` (all green 2026-08-12).
 * Coverage split on promotion: pipe/compose/deps live in behavior.test.ts,
 * dismissableLayer/anchorPosition in overlay-behaviors.test.ts, Mixin golden
 * parity in mixin.test.ts; this file keeps the catalog-convention scenarios.
 */
import { describe, expect, it } from "vitest";
import { Effect, Exit, Schema, Scope } from "effect";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as View from "../View.js";
import { press, PressOptions } from "../behaviors/press.js";
import {
  rovingTabindex,
  RovingTabindexOptions,
} from "../behaviors/roving-tabindex.js";
import { CollectionOptions } from "../behaviors/collection.js";

describe("catalog option contract", () => {
  it("press() works with no options at all — Schema defaults, not a decode failure", () => {
    let presses = 0;
    const behavior = press({ onPress: () => { presses += 1; } });
    const target = Element.interactive();
    const attached = Effect.runSync(Behavior.attachScoped(behavior, { target }));

    // trackPressed defaults to true.
    expect(attached.bindings.isPressed()).toBe(false);
    target.emit("pointerdown", { button: 0, pointerId: 1 });
    expect(attached.bindings.isPressed()).toBe(true);
    target.emit("pointerup", { button: 0, pointerId: 1 });
    expect(attached.bindings.isPressed()).toBe(false);
    expect(presses).toBe(1);
    Effect.runSync(attached.dispose);
  });

  it("rovingTabindex() works with a partial config and keeps the full option unions", () => {
    // A single non-default field; everything else defaults from the Schema.
    const behavior = rovingTabindex({ loop: false });
    const items = [Element.focusable(), Element.focusable(), Element.focusable()];
    const elements = {
      container: Element.container(),
      items: Element.collection(items),
    };
    const attached = Effect.runSync(Behavior.attachScoped(behavior, elements));

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

  it("every catalog option struct is wire-serializable; no field ever accepts a function", () => {
    for (const [schema, value] of [
      [PressOptions, { trackPressed: true, preventFocusOnPress: false }],
      [RovingTabindexOptions, {
        orientation: "horizontal",
        loop: false,
        virtual: false,
        initialIndex: 1,
      }],
      [CollectionOptions, { trackDisabled: true, setPosInSet: false }],
    ] as const) {
      const encoded = JSON.parse(
        JSON.stringify(Schema.encodeUnknownSync(schema as Schema.Top)(value)),
      );
      expect(Schema.decodeUnknownSync(schema as Schema.Top)(encoded)).toEqual(value);
    }

    // No catalog options struct DECLARES a field whose value could be a
    // function, so `props` can never leak onto the wire.
    for (const schema of [PressOptions, RovingTabindexOptions, CollectionOptions]) {
      const fields: Record<string, unknown> = schema.fields;
      expect(Object.keys(fields).length).toBeGreaterThan(0);
      for (const [name, field] of Object.entries(fields)) {
        const encodedOk = (() => {
          try {
            Schema.encodeUnknownSync(field as Schema.Top)(() => {});
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

describe("behavior-to-behavior dependencies (DQ-052 half two)", () => {
  it("attachTo resolves deps from the component's existing bindings by name", () => {
    const Anatomy = View.Slots.define({
      root: { capability: Element.Capability.Container },
    });

    const mirror = Behavior.make(
      (
        elements: { readonly root: Element.Container },
        deps: { readonly selected: Component.StateAtom<string> },
      ) =>
        Effect.gen(function* () {
          yield* elements.root.on("click", () => deps.selected.set("clicked"));
          return { mirrored: () => deps.selected() };
        }),
    );

    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("selected", () => Component.state("initial")),
      () => View.fromSlots(Anatomy, null),
    ).pipe(
      Component.withSlots(Anatomy),
      // No { deps } at the call site: `selected` resolves from the
      // component's own bindings by name.
      Behavior.attachTo(mirror, { root: "root" }),
    );

    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Effect.provideService(
        Component.setupEffect(Widget, {}),
        Scope.Scope,
        scope,
      ),
    );
    const view = Component.renderViewWithBindings(Widget, {}, bindings);

    expect(bindings.mirrored()).toBe("initial");
    view.slots.root.emit("click", {});
    // Same atom, seen from both sides — not a copy.
    expect(bindings.selected()).toBe("clicked");
    expect(bindings.mirrored()).toBe("clicked");

    Effect.runSync(Scope.close(scope, Exit.void));
  });
});

describe("provided state lives in the component's scope (DQ-053)", () => {
  const Anatomy = View.Slots.define({
    root: { capability: Element.Capability.Container },
  });
  const counter = (step: number, tag: string) =>
    Behavior.make(
      (
        elements: { readonly root: Element.Container },
        deps: { readonly count: Component.StateAtom<number> },
      ) =>
        Effect.gen(function* () {
          yield* elements.root.on("keydown", () => deps.count.set(deps.count() + step));
          return { count: deps.count, algorithm: tag };
        }),
    ).pipe(
      Behavior.provides({
        count: Behavior.binding("count", { state: () => Component.state(0) }),
      }),
    );

  const runWidget = (component: Component.Component<{}, any, any, any, any>) => {
    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Effect.provideService(
        Component.setupEffect(component, {}),
        Scope.Scope,
        scope,
      ),
    );
    const view = Component.renderViewWithBindings(component, {}, bindings);
    return {
      bindings: bindings as Record<string, any>,
      view,
      close: () => Effect.runSync(Scope.close(scope, Exit.void)),
    };
  };

  const base = () =>
    Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>(),
      () => View.fromSlots(Anatomy, null),
    ).pipe(Component.withSlots(Anatomy));

  it("replacing the behavior that authored the state keeps it — one shared atom", () => {
    const swapped = base().pipe(
      Behavior.attachTo(counter(1, "v1"), { root: "root" }),
      Behavior.attachTo(counter(10, "v2"), { root: "root" }),
    );
    const widget = runWidget(swapped);
    expect(widget.bindings.algorithm).toBe("v2");
    widget.view!.slots.root.emit("keydown", { key: "ArrowDown" });
    // 11: one keydown reaches both handlers incrementing ONE component-owned
    // atom. A per-behavior atom would read 10 and strand v1's state.
    expect(widget.bindings.count()).toBe(11);
    widget.close();
  });

  it("an incompatible replacement is surfaced loudly, never a silent reset", () => {
    const stringCounter = Behavior.make((_e: { readonly root: Element.Container }) =>
      Effect.succeed({})
    ).pipe(
      Behavior.provides({
        count: Behavior.binding("count", { state: () => Component.state("zero") }),
      }),
    );
    const mismatched = base().pipe(
      Behavior.attachTo(counter(1, "v1"), { root: "root" }),
      Behavior.attachTo(stringCounter, { root: "root" }),
    );
    expect(() => runWidget(mismatched)).toThrow(/incompatible state shape/);
  });

  it("a component-authored binding of the same name is adopted, not overridden", () => {
    const authored = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(100)),
      () => View.fromSlots(Anatomy, null),
    ).pipe(
      Component.withSlots(Anatomy),
      Behavior.attachTo(counter(1, "v1"), { root: "root" }),
    );
    const widget = runWidget(authored);
    // The behavior's factory (initial 0) did NOT override the component's
    // authored state (initial 100) — the component owns the binding.
    expect(widget.bindings.count()).toBe(100);
    widget.view!.slots.root.emit("keydown", { key: "ArrowDown" });
    expect(widget.bindings.count()).toBe(101);
    widget.close();
  });
});
