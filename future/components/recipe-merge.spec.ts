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
import { fromSrc, loadSrc, pick, unbuilt } from "../harness.js";

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
  const Component = await loadSrc("Component");
  const { make, props, require, setup, renderViewEffect, withSlots } = pick(
    Component,
    "Component",
    "make",
    "props",
    "require",
    "setup",
    "renderViewEffect",
    "withSlots",
  );
  const Style = await loadSrc("Style");
  const View = await loadSrc("View");
  const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
  const { Capability } = await fromSrc("Element", "Capability");

  /**
   * Resolve a slot style map through the authored path - a widget that renders
   * `View.fromSlots(anatomy, ...)` and receives the style with
   * `Style.attachToSlots` - then read the resulting handle styles back.
   * A fresh anatomy per call keeps specs isolated.
   */
  const resolve = (slotStyles: Record<string, unknown>) => {
    const { attachToSlots, make: styleMake } = pick(
      Style,
      "Style",
      "attachToSlots",
      "make",
    );
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

describe("recipe merge contract", () => {
  it("[K1] resolution order is base -> variants -> compound, with compound winning", async () => {
    const { Style, resolve } = await styleHarness();
    const { slot, recipe } = pick(Style, "Style", "slot", "recipe");

    const def = {
      slots: ["root", "label"] as const,
      base: { root: slot({ padding: "xs" }), label: slot({ fontSize: "body.sm" }) },
      variants: {
        intent: { danger: { root: slot({ padding: "sm" }) } },
        size: { lg: { root: slot({ padding: "lg" }) } },
      },
      compound: [
        { intent: "danger", size: "lg", style: { root: slot({ padding: "2xl" }) } },
      ],
      defaults: { intent: "danger", size: "lg" },
    };

    const button = recipe(def);

    // compound match wins over both variants, which win over base.
    expect(resolve(button())("root", "padding")).toBe(48);
    // base still applies where no variant/compound touches the slot.
    expect(resolve(button())("label", "fontSize")).toBe(14);
    // a non-matching selection falls back to the variant, not the compound.
    expect(resolve(button({ size: "lg", intent: undefined as never }))("root", "padding")).toBe(24);
  });

  it("[K1] mergeRecipes is a pure data merge: adds variants, overrides defaults, leaves the base recipe untouched", async () => {
    const { Style, resolve } = await styleHarness();
    const { slot, recipe } = pick(Style, "Style", "slot", "recipe");
    const { mergeRecipes } = pick(Style, "Style", "mergeRecipes");

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
    const { slot } = pick(Style, "Style", "slot");
    const { mergeRecipes } = pick(Style, "Style", "mergeRecipes");

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
    unbuilt(
      "recipe slot widening (`allowNewSlots` boolean cannot re-type the result; a name-carrying form such as Style.extendRecipeSlots(base, [\"footer\"] as const) -> RecipeDef<\"root\" | \"footer\"> is needed instead)",
      "DQ-062",
    );
  });

  it("[K1] the public @layer order is declared, and consumer layers come after ours", async () => {
    const Style = await loadSrc("Style");
    const { publicLayerOrder } = pick(Style, "Style", "publicLayerOrder");

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
    const { slot, compose } = pick(Style, "Style", "slot", "compose");

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
    const Style = await loadSrc("Style");
    const { make: styleMake, slot } = pick(Style, "Style", "make", "slot");
    const Component = await loadSrc("Component");
    const { make, props, require, setup, renderViewEffect, withSlots } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "renderViewEffect",
      "withSlots",
    );
    const { attachToSlots } = pick(Style, "Style", "attachToSlots");
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

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
    const Style = await loadSrc("Style");
    const { make: styleMake, slot } = pick(Style, "Style", "make", "slot");
    const View = await loadSrc("View");
    const { Slots } = pick(View, "View", "Slots");
    const { Capability } = await fromSrc("Element", "Capability");

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
    const Theme = await loadSrc("Theme");
    const { define, Theme: ThemeTag } = pick(Theme, "Theme", "define", "Theme");

    // @stylextras-inspired rule copied exactly: a raw primitive palette with no
    // dependencies, plus semantic tokens *derived* from those primitives.
    const palette = define({ color: { blue500: "#1d4ed8", zinc100: "#f4f4f5" } });
    const semantic = define({
      color: { brand: "color.blue500", bgSubtle: "color.zinc100" },
    });

    // NOTE for the implementer: the gap here is Theme *layer composition*, not
    // `lookupToken` - two layers providing the same `Theme` tag yield one
    // winner, so a merged token schema is what is missing.
    const layered = Layer.merge(palette.layer(), semantic.layer());
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
    const Theme = await loadSrc("Theme");
    const { define, Theme: ThemeTag } = pick(Theme, "Theme", "define", "Theme");

    // Eight independent axes; `zinc color + compact spacing` must compose
    // rather than forcing a fork of a monolithic theme.
    const color = define({ color: { accent: "#111827" } });
    const spacing = define({ spacing: { md: 4 } });

    const resolved: any = Effect.runSync(
      Effect.gen(function* () {
        const theme: any = yield* Effect.service(ThemeTag);
        return { accent: theme.resolve("accent"), md: theme.resolve("md") };
      }).pipe(Effect.provide(Layer.merge(color.layer(), spacing.layer()))) as any,
    );

    expect(resolved.accent).toBe("#111827");
    expect(resolved.md).toBe("4");
  });

  it("[K1] static CSS extraction preserves cross-module compose and fails open to runtime CSS", async () => {
    unbuilt(
      "static style extraction pass (must not break cross-module Style.compose; fail-open to runtime CSS)",
      "DQ-064",
    );
  });

  it("[K1] CSS-Tags rung zero: absorbed as @affe/css or depended on externally", async () => {
    unbuilt(
      "CSS-Tags foundation stylesheet --- absorb into the @affe/* workspace vs depend externally (token-namespace ownership)",
      "DQ-063",
    );
  });
});
