/**
 * K1 --- recipe data + merge precedence + `@layer` order + token resolution.
 *
 * Owning doc: `docs/COMPONENT_KIT_PLAN.md`, "Foundation: styles and recipes"
 * (Gap 2, phase K1) and "Rung zero: CSS-Tags as the styling floor" (`@layer`
 * order *is* the recipe merge contract).
 *
 * Authoring resolution order, which the plan says must be specified and
 * property-tested before the API is considered done:
 *   1. recipe `base`
 *   2. selected `variants` (documented axis order)
 *   3. `compound` matches
 *   4. kit default per-slot attachment
 *   5. consumer `mergeRecipes` patches + `Style.attachToSlots` (last per rule)
 */
import { Effect, Exit, Layer, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import * as BehaviorModule from "../Behavior.js";
import * as ComponentModule from "../Component.js";
import * as ElementModule from "../Element.js";
import * as StyleModule from "../Style.js";
import * as ThemeModule from "../Theme.js";
import * as ViewModule from "../View.js";
import * as domModule from "../dom.js";
import * as affeCss from "@affe/css";

/**
 * Scopes opened by `styleHarness().resolve(...)`. Closed only AFTER a spec's
 * assertions run: reading handle styles from a disposed scope would become a
 * false green the day style teardown lands.
 */
const openScopes: Array<Scope.Scope> = [];
afterEach(() => {
  while (openScopes.length > 0) {
    Effect.runSync(Scope.close(openScopes.pop()!, Exit.void));
  }
});

async function styleHarness() {
  const Component = ComponentModule as Record<string, any>;
  const { make, props, require, setup, renderViewEffect, withSlots } = ((Component) as any);
  const Style = StyleModule as Record<string, any>;
  const View = ViewModule as Record<string, any>;
  const { Slots, fromSlots } = ((View) as any);
  const { Capability } = ElementModule as Record<string, any>;

  /**
   * Resolve a slot style map through the authored path - a widget that renders
   * `View.fromSlots(anatomy, ...)` and receives the style with
   * `Style.attachToSlots` - then read the resulting handle styles back.
   * A fresh anatomy per call keeps specs isolated.
   */
  const resolve = (slotStyles: Record<string, unknown>) => {
    const { attachToSlots, make: styleMake } = ((Style) as any);
    const Anatomy = Slots.define({
      root: { capability: Capability.Container },
      label: { capability: Capability.Container },
    });
    // DQ-050: no setup-declared handles; the rendered view is canonical.
    // DQ-054: one contract-aware `Style.make`, so the cast this call site used
    // to need is gone.
    const Widget = make(
      props(),
      require(),
      setup(),
      () => fromSlots(Anatomy, null),
    ).pipe(withSlots(Anatomy), attachToSlots(styleMake(Anatomy, slotStyles), Anatomy));

    const scope = Scope.makeUnsafe();
    openScopes.push(scope);
    const view: any = Effect.runSync(
      Effect.provideService(renderViewEffect(Widget, {}), Scope.Scope, scope),
    );
    return (slot: string, property: string) => view.slots[slot].getStyle(property);
  };

  return { Style, resolve };
}

/** Like styleHarness, but with a root+footer anatomy for widening specs. */
async function styleHarness2() {
  const Component = ComponentModule as Record<string, any>;
  const { make, props, require, setup, renderViewEffect, withSlots } = ((Component) as any);
  const Style = StyleModule as Record<string, any>;
  const View = ViewModule as Record<string, any>;
  const { Slots, fromSlots } = ((View) as any);
  const { Capability } = ElementModule as Record<string, any>;
  const resolve = (slotStyles: Record<string, unknown>) => {
    const { attachToSlots, make: styleMake } = ((Style) as any);
    const Anatomy = Slots.define({
      root: { capability: Capability.Container },
      footer: { capability: Capability.Container },
    });
    const Widget = make(
      props(),
      require(),
      setup(),
      () => fromSlots(Anatomy, null),
    ).pipe(withSlots(Anatomy), attachToSlots(styleMake(Anatomy, slotStyles), Anatomy));
    const scope = Scope.makeUnsafe();
    openScopes.push(scope);
    const view: any = Effect.runSync(
      Effect.provideService(renderViewEffect(Widget, {}), Scope.Scope, scope),
    );
    return (slot: string, property: string) => view.slots[slot].getStyle(property);
  };
  return { Style, resolve };
}

describe("recipe merge contract", () => {
  it("[K1] resolution order is base -> variants -> compound, with compound winning", async () => {
    const { Style, resolve } = await styleHarness();
    const { slot, recipe } = ((Style) as any);

    const def = {
      slots: ["root", "label"] as const,
      base: { root: slot({ padding: "xs" }), label: slot({ fontSize: "body.sm" }) },
      variants: {
        intent: { danger: { root: slot({ padding: "sm" }) } },
        size: { lg: { root: slot({ padding: "lg" }) } },
      },
      // PREMISE CORRECTED (2026-08-12): the plan ratified `{ when, style }`
      // — the flat-axis-keys form this spec used was explicitly rejected
      // (indistinguishable from reserved keys, untypeable against axes).
      compound: [
        { when: { intent: "danger", size: "lg" }, style: { root: slot({ padding: "2xl" }) } },
      ],
      defaults: { intent: "danger", size: "lg" },
    };

    const button = recipe(def);

    // compound match wins over both variants, which win over base.
    expect(resolve(button())("root", "padding")).toBe(48);
    // base still applies where no variant/compound touches the slot.
    expect(resolve(button())("label", "fontSize")).toBe(14);
    // a non-matching selection falls back to the variant, not the compound.
    // PREMISE CORRECTED: `null` is the ratified explicit-unset selection.
    expect(resolve(button({ size: "lg", intent: null }))("root", "padding")).toBe(24);
  });

  it("[K1] mergeRecipes is a pure data merge: adds variants, overrides defaults, leaves the base recipe untouched", async () => {
    const { Style, resolve } = await styleHarness();
    const { slot, recipe } = ((Style) as any);
    const { mergeRecipes } = ((Style) as any);

    const base = {
      slots: ["root", "label"] as const,
      base: { root: slot({ padding: "sm" }), label: slot({ fontSize: "body.sm" }) },
      variants: { intent: { primary: { root: slot({ backgroundColor: "surface" }) } } },
      defaults: { intent: "primary" },
    };

    const patched = mergeRecipes(base, {
      variants: { intent: { brand: { root: slot({ padding: "xl" }) } } },
      defaults: { intent: "brand" },
    });

    // purity
    expect(Object.keys((base.variants as any).intent)).toEqual(["primary"]);
    expect(base.defaults).toEqual({ intent: "primary" });

    // the patch's variant and default are live
    expect(resolve(recipe(patched)())("root", "padding")).toBe(32);
    // ...and untouched axes/slots survive the merge
    expect(resolve(recipe(patched)())("label", "fontSize")).toBe(14);
    // ...and the original variant is still selectable
    expect(String(resolve(recipe(patched)({ intent: "primary" }))("root", "backgroundColor")))
      .toBe("#ffffff");

    // merging the same axis key twice: the patch wins (last-wins, documented).
    const twice = mergeRecipes(patched, {
      variants: { intent: { brand: { root: slot({ padding: "xs" }) } } },
    });
    expect(resolve(recipe(twice)())("root", "padding")).toBe(4);
  });

  it("[K1] merging a slot the anatomy does not declare never silently succeeds", async () => {
    const { Style } = await styleHarness();
    const { slot } = ((Style) as any);
    const { mergeRecipes } = ((Style) as any);

    const base = {
      slots: ["root"] as const,
      base: { root: slot({ padding: "sm" }) },
    };

    // Contract rule 2: merge only known slots. Anatomy-bound recipes must not
    // silently grow a slot the component never renders. The *failure channel*
    // is deliberately not pinned here (COMPONENT_KIT_PLAN.md lists the exact
    // `mergeRecipes` signature as an open question) - a type error, a thrown
    // error, or a returned diagnostic all satisfy this spec. Silently merging
    // does not.
    let merged: any;
    let rejected = false;
    let diagnostics: ReadonlyArray<unknown> = [];
    try {
      merged = mergeRecipes(base, { base: { footer: slot({ padding: "sm" }) } } as any);
      diagnostics = (merged?.diagnostics ?? []) as ReadonlyArray<unknown>;
    } catch {
      rejected = true;
    }

    const silentlyMerged =
      !rejected && diagnostics.length === 0 && "footer" in (merged?.base ?? {});
    expect(silentlyMerged).toBe(false);
  });

  it("[K1] widening a recipe with a new slot is an explicit, name-carrying operation", async () => {
    // DQ-062 ratified and built: the boolean-flag form was rejected (it
    // cannot re-type the result); widening is Style.extendRecipeSlots.
    const { Style, resolve } = await styleHarness2();
    const { slot, recipe, mergeRecipes, extendRecipeSlots } = ((Style) as any);

    const base = {
      slots: ["root"] as const,
      base: { root: slot({ padding: "sm" }) },
    };
    const widened = extendRecipeSlots(base, ["footer"] as const);
    expect([...widened.slots]).toEqual(["root", "footer"]);

    // The widened def accepts footer patches that the base rejected…
    const themed = mergeRecipes(widened, {
      base: { footer: slot({ padding: "lg" }) },
    });
    expect((themed as any).diagnostics ?? []).toEqual([]);
    const read = resolve(recipe(themed)());
    expect(read("root", "padding")).toBe(8);
    expect(read("footer", "padding")).toBe(24);
    // …and the base recipe is untouched (purity, as everywhere in K1).
    expect([...base.slots]).toEqual(["root"]);
  });

  it("[K1] the public @layer order is declared, and consumer layers come after ours", async () => {
    const Style = StyleModule as Record<string, any>;
    // PREMISE CORRECTED: the ratified name is `cssLayerOrder` (branded,
    // closed tuple; `publicLayerOrder` was the spec's invention).
    const { cssLayerOrder: publicLayerOrder } = ((Style) as any);

    // Precedence is enforced by the platform cascade, not by specificity or
    // atomic class ordering. Consumer override policy is one sentence:
    // "your layers come after ours".
    const order = [...publicLayerOrder] as ReadonlyArray<string>;
    expect(order).toContain("defaults");
    expect(order).toContain("components");
    expect(order).toContain("variants");
    expect(order).toContain("utilities");
    expect(order.indexOf("defaults")).toBeLessThan(order.indexOf("components"));
    expect(order.indexOf("components")).toBeLessThan(order.indexOf("variants"));
    expect(order.indexOf("variants")).toBeLessThan(order.indexOf("utilities"));
    // "Your layers come after ours": the last declared layer must not be one
    // of ours. (The consumer layer's *name* is not decided in the plan, so it
    // is deliberately not asserted.)
    expect(["defaults", "components", "variants", "utilities"]).not.toContain(
      order[order.length - 1],
    );
  });

  it("[K1] cross-module Style.compose is a stability guarantee: composing pieces from two modules keeps both", async () => {
    const { Style, resolve } = await styleHarness();
    const { slot, compose } = ((Style) as any);

    const kitPiece = slot({ padding: "sm", backgroundColor: "surface" });
    const appPiece = slot({ padding: "lg" });

    const read = resolve({ root: compose(kitPiece, appPiece) });
    // later piece wins per-property; untouched properties from the earlier
    // piece survive. No extraction pass may change this.
    expect(read("root", "padding")).toBe(24);
    expect(String(read("root", "backgroundColor"))).toBe("#ffffff");
  });
});

describe("one contract-aware style builder (DQ-054)", () => {
  it("[K1] Style.forSlots is gone and Style.make takes the slot contract directly", async () => {
    const Style = StyleModule as Record<string, any>;
    const { make: styleMake, slot } = ((Style) as any);
    const Component = ComponentModule as Record<string, any>;
    const { make, props, require, setup, renderViewEffect, withSlots } = ((Component) as any);
    const { attachToSlots } = ((Style) as any);
    const View = ViewModule as Record<string, any>;
    const { Slots, fromSlots } = ((View) as any);
    const { Capability } = ElementModule as Record<string, any>;

    // Two builders where the *recommended* one is strictly weaker is not a
    // shape worth preserving: `forSlots` erases `Bindings` to `never`, which
    // makes `StyleBindingCompatible` vacuous exactly on the golden path while
    // the "low-level" `make` keeps the check. So it is deleted outright, not
    // deprecated — this is prerelease redesign work.
    expect((Style as any).forSlots).toBeUndefined();

    // ...and the contract awareness it existed for now lives in `make`, which
    // is the only builder. The binding-inference half (`whenBinding`'s
    // predicate relating to the binding's value type) is a compile-time
    // guarantee and is pinned in `src/type-tests/`, not here.
    const Anatomy = Slots.define({
      root: { capability: Capability.Container },
      label: { capability: Capability.Container },
    });
    const Widget = make(
      props(),
      require(),
      setup(),
      () => fromSlots(Anatomy, null),
    ).pipe(
      withSlots(Anatomy),
      attachToSlots(styleMake(Anatomy, { root: slot({ padding: "lg" }) }), Anatomy),
    );

    const scope = Scope.makeUnsafe();
    openScopes.push(scope);
    const view: any = Effect.runSync(
      Effect.provideService(renderViewEffect(Widget, {}), Scope.Scope, scope),
    );
    expect(view.slots.root.getStyle("padding")).toBe(24);
  });

  it("[K1] full slot coverage is opt-in exhaustive, not default-required", async () => {
    const Style = StyleModule as Record<string, any>;
    const { make: styleMake, slot } = ((Style) as any);
    const View = ViewModule as Record<string, any>;
    const { Slots } = ((View) as any);
    const { Capability } = ElementModule as Record<string, any>;

    const Anatomy = Slots.define({
      root: { capability: Capability.Container },
      label: { capability: Capability.Container },
    });
    const partial = { root: slot({ padding: "sm" }) };
    const full = { root: slot({ padding: "sm" }), label: slot({ padding: "xs" }) };

    // NEGATIVE CONTROL, and the default: partial recipes are LEGITIMATE. A
    // patch that touches one slot must not be forced to restate the others.
    expect(() => styleMake(Anatomy, partial)).not.toThrow();
    // ...and still legitimate when the author opts in AND covers everything.
    expect(() => styleMake(Anatomy, full, { exhaustive: true })).not.toThrow();

    // Only under the explicit opt-in is a gap an error. The failure channel is
    // deliberately not pinned (a type error, a throw, or a returned diagnostic
    // all satisfy this); silently accepting the gap under `exhaustive: true`
    // does not.
    let surfaced = false;
    let result: any;
    try {
      result = styleMake(Anatomy, partial, { exhaustive: true });
      surfaced = ((result?.diagnostics ?? []) as ReadonlyArray<unknown>).length > 0;
    } catch {
      surfaced = true;
    }
    expect(surfaced).toBe(true);
  });
});

describe("theme tokens", () => {
  it("[K1] two-level tokens: a semantic token resolves through the raw palette layer", async () => {
    const Theme = ThemeModule as Record<string, any>;
    const { define, Theme: ThemeTag } = ((Theme) as any);

    // @stylextras-inspired rule copied exactly: a raw primitive palette with no
    // dependencies, plus semantic tokens *derived* from those primitives.
    const palette = define({ color: { blue500: "#1d4ed8", zinc100: "#f4f4f5" } });
    const semantic = define({
      color: { brand: "color.blue500", bgSubtle: "color.zinc100" },
    });

    // PREMISE CORRECTED (2026-08-12, DQ-061 ratified option 1): composition
    // is a DEFINITION-time operation (`Theme.compose`) producing one complete
    // Layer — `Layer.merge` of two Theme layers is last-wins by Effect's own
    // contract, and making one service merge-aware was the rejected option.
    const { compose: themeCompose } = ((Theme) as any);
    const layered = themeCompose(palette, semantic).layer();
    const resolved: any = Effect.runSync(
      Effect.gen(function* () {
        const theme: any = yield* Effect.service(ThemeTag);
        return {
          brand: theme.resolve("brand"),
          bgSubtle: theme.resolve("bgSubtle"),
          raw: theme.resolve("blue500"),
        };
      }).pipe(Effect.provide(layered)) as any,
    );

    expect(resolved.raw).toBe("#1d4ed8");
    expect(resolved.brand).toBe("#1d4ed8");
    expect(resolved.bgSubtle).toBe("#f4f4f5");
  });

  it("[K1] token axes are independently themeable and compose per subtree", async () => {
    const Theme = ThemeModule as Record<string, any>;
    const { define, Theme: ThemeTag } = ((Theme) as any);

    // Eight independent axes; `zinc color + compact spacing` must compose
    // rather than forcing a fork of a monolithic theme.
    const color = define({ color: { accent: "#111827" } });
    const spacing = define({ spacing: { md: 4 } });

    const resolved: any = Effect.runSync(
      Effect.gen(function* () {
        const theme: any = yield* Effect.service(ThemeTag);
        return { accent: theme.resolve("accent"), md: theme.resolve("md") };
        // PREMISE CORRECTED: definition-time composition (DQ-061).
      }).pipe(Effect.provide(((Theme) as any).compose(color, spacing).layer())) as any,
    );

    expect(resolved.accent).toBe("#111827");
    expect(resolved.md).toBe("4");
  });

  it("[K1] static CSS extraction preserves cross-module compose and fails open to runtime CSS", async () => {
    const Style = StyleModule as Record<string, any>;
    const { make, compose, slot, when, whenBinding, extractStatic } = ((Style) as any);

    // "Another module"'s contribution, composed in as plain data — extraction
    // must see through the compose, not choke on it.
    const crossModulePiece = slot({ padding: "md" });

    const style = make({
      // Fully static, spanning a cross-module compose and a token path.
      root: compose(slot({ display: "grid", gap: "sm" }), crossModulePiece),
      // Binding-conditional: reactive per DQ-056, NEVER extracted.
      label: whenBinding("isOpen", true, slot({ color: "red" })),
      // A runtime condition poisons the WHOLE slot (slot-unit fail-open),
      // even though its sibling piece is static.
      badge: compose(slot({ color: "color.text.primary" }), when(() => true, slot({ opacity: 1 }))),
    });
    const before = JSON.stringify(Object.keys(style.slots));

    const extraction = extractStatic(style);

    // The slot is the unit: one static, two runtime.
    expect(extraction.staticSlots).toEqual(["root"]);
    expect(extraction.runtimeSlots).toEqual(["label", "badge"]);

    // Extracted CSS lands in the ratified cascade layer, carries the merged
    // cross-module declarations, and resolves token paths to the SAME
    // `--af-*` variable namespace the @affe/css foundation emits — extracted
    // CSS stays theme-swappable.
    expect(extraction.css).toContain("@layer components");
    expect(extraction.css).toContain(".af-root");
    expect(extraction.css).toContain("display: grid;");
    expect(extraction.css).toContain("gap: var(--af-spacing-sm);");
    expect(extraction.css).toContain("padding: var(--af-spacing-md);");

    // Fail-open means the runtime slots contribute NOTHING statically...
    expect(extraction.css).not.toContain("opacity");
    expect(extraction.css).not.toContain("red");

    // ...and extraction is non-destructive: the style value is untouched, so
    // runtime attachment / further cross-module composition keep working on
    // the exact same object.
    expect(JSON.stringify(Object.keys(style.slots))).toBe(before);
    expect(extractStatic(style)).toEqual(extraction);
  });

  it("[K1] CSS-Tags rung zero: absorbed as @affe/css (ratified DQ-063)", async () => {
    // The foundation stylesheet is OURS: one token namespace, the ratified
    // @layer order stated first (which is what makes precedence hold
    // regardless of import order), zero JavaScript.
    const { foundationStylesheet, tokenVariableName, cssLayerOrder } = affeCss as Record<string, any>;
    const Style = StyleModule as Record<string, any>;
    const { cssLayerOrder: coreOrder } = ((Style) as any);

    const css = foundationStylesheet();

    // The @layer declaration IS the recipe merge contract, and it is the
    // CORE's ratified order — re-exported, never restated.
    expect(css.startsWith(`@layer ${coreOrder.join(", ")};`)).toBe(true);
    expect(cssLayerOrder).toEqual(coreOrder);

    // The one token namespace: Theme's dotted paths become custom
    // properties mechanically, so recipes and CSS resolve the same names.
    expect(tokenVariableName("color.text.primary")).toBe("--af-color-text-primary");
    expect(css).toContain("--af-color-text-primary");
    expect(css).toContain("--af-color-surface: #ffffff");

    // Zero-JS theming floor: the platform owns mode switching.
    expect(css).toContain("color-scheme: light dark");

    // Custom token schemas emit under the same namespace; nothing is
    // hard-coded to the default theme.
    const custom = foundationStylesheet({
      tokens: { brand: { accent: "#123456" } },
      selector: ".themed",
    });
    expect(custom).toContain(".themed {");
    expect(custom).toContain("--af-brand-accent: #123456");
    expect(custom).not.toContain("--af-color-surface");
  });
});
