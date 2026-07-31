import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Style from "../Style.js";
import * as StyleUtils from "../style-utils.js";
import { defaultThemeTokens } from "../style-types.js";
import * as Theme from "../Theme.js";
import * as View from "../View.js";
import { createSignal, flush } from "../api.js";

/**
 * Resolve a style value the way a real attachment does — through
 * `Style.make` + `Style.attach` onto a component slot — and read the
 * resulting handle styles back. Asserting on *resolved* values is what makes
 * variant/recipe tests falsifiable: `toBeDefined()` on the returned piece
 * passes for any implementation that returns a non-undefined object.
 */
const resolveOnSlot = (piece: Style.StyleValue): Element.Container => {
  const Probe = Component.make<{}, never, never, {
    readonly slots: { readonly root: Element.Container };
  }>(
    Component.props<{}>(),
    Component.require<never>(),
    () => Effect.succeed({ slots: { root: Element.container() } }),
    () => null,
  ).pipe(Style.attach(Style.make({ root: piece })));
  return Effect.runSync(Component.setupEffect(Probe, {})).slots.root;
};

describe("Style", () => {
  it("attaches slot styles to component slots", () => {
    const Card = Component.make<{}, never, never, {
      readonly slots: {
        readonly root: ReturnType<typeof Component.slotContainer> extends Effect.Effect<infer S, any, any> ? S : never;
      };
    }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const root = yield* Component.slotContainer();
        return { slots: { root } };
      }),
      () => null,
    ).pipe(
      Style.attach(
        Style.make({
          root: Style.compose(
            StyleUtils.padded("md"),
            Style.slot({ backgroundColor: "surface" }),
          ),
        }),
      ),
    );

    const bindings = Effect.runSync(Component.setupEffect(Card, {}));
    expect(bindings.slots.root.getStyle("padding")).toBe(16);
    expect(bindings.slots.root.getStyle("backgroundColor")).toBe("#ffffff");
  });

  it("supports variant factories", () => {
    const button = Style.variants({
      base: Style.slot({ padding: "sm" }),
      variants: {
        intent: {
          primary: Style.slot({ backgroundColor: "accent.default" }),
          ghost: Style.slot({ backgroundColor: "surface" }),
        },
        size: {
          sm: Style.slot({ fontSize: "body.sm" }),
          lg: Style.slot({ fontSize: "body.lg" }),
        },
      },
      defaults: { intent: "primary", size: "sm" },
    });

    // Resolve both the explicit selection and the defaults. Asserting the two
    // differ on exactly the selected axes is what makes this falsifiable: an
    // implementation that ignored `selection` and always applied `defaults`
    // used to pass the old `length > 0` check.
    const selected = resolveOnSlot(button({ intent: "ghost", size: "lg" }));
    const defaulted = resolveOnSlot(button());

    expect(selected.getStyle("backgroundColor")).toBe("#ffffff");
    expect(defaulted.getStyle("backgroundColor")).not.toBe("#ffffff");
    expect(selected.getStyle("fontSize")).not.toBe(defaulted.getStyle("fontSize"));
    // `base` applies to both regardless of selection.
    expect(selected.getStyle("padding")).toBe(defaulted.getStyle("padding"));
    expect(selected.getStyle("padding")).not.toBeUndefined();
  });

  it("applies variant compounds only when every axis matches", () => {
    const button = Style.variants({
      base: Style.slot({ padding: "sm" }),
      variants: {
        intent: {
          primary: Style.slot({ backgroundColor: "accent.default" }),
          ghost: Style.slot({ backgroundColor: "surface" }),
        },
        size: {
          sm: Style.slot({ fontSize: "body.sm" }),
          lg: Style.slot({ fontSize: "body.lg" }),
        },
      },
      compounds: [
        { when: { intent: "ghost", size: "lg" }, style: Style.slot({ opacity: 0.5 }) },
      ],
      defaults: { intent: "primary", size: "sm" },
    });

    expect(resolveOnSlot(button({ intent: "ghost", size: "lg" })).getStyle("opacity")).toBe(0.5);
    // Negative controls: a partial match must not apply the compound.
    expect(resolveOnSlot(button({ intent: "ghost", size: "sm" })).getStyle("opacity")).toBeUndefined();
    expect(resolveOnSlot(button({ intent: "primary", size: "lg" })).getStyle("opacity")).toBeUndefined();
  });

  it("supports recipe factories", () => {
    const card = Style.recipe({
      slots: ["root", "title"] as const,
      base: {
        root: Style.slot({ padding: "md" }),
        title: Style.slot({ fontSize: "heading.sm" }),
      },
      variants: {
        compact: {
          true: { root: Style.slot({ padding: "sm" }) },
          false: {},
        },
      },
      defaults: { compact: "false" },
    });

    // The guarantee is that the selected variant *overrides* the base for the
    // slot it patches, and leaves untouched slots alone. `toBeDefined()` on the
    // returned pieces passed even if the variant patch was dropped entirely.
    const compact = card({ compact: "true" });
    const roomy = card({ compact: "false" });

    const compactRoot = resolveOnSlot(compact.root);
    const roomyRoot = resolveOnSlot(roomy.root);
    expect(roomyRoot.getStyle("padding")).toBe(16); // base "md"
    expect(compactRoot.getStyle("padding")).toBe(8); // variant "sm" wins
    // The `title` slot has no patch on either selection.
    expect(resolveOnSlot(compact.title).getStyle("fontSize"))
      .toBe(resolveOnSlot(roomy.title).getStyle("fontSize"));
    expect(resolveOnSlot(compact.title).getStyle("padding")).toBeUndefined();
  });

  it("applies binding-conditional styles against setup bindings", () => {
    const makeCard = (isOpen: boolean) =>
      Component.make<{}, never, never, {
        readonly isOpen: boolean;
        readonly slots: {
          readonly root: Element.Container;
        };
      }>(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.succeed({ isOpen, slots: { root: Element.container() } }),
        () => null,
      ).pipe(
        Style.attach(
          Style.make({
            root: Style.compose(
              Style.slot({ opacity: 0.5 }),
              Style.whenBinding("isOpen", true, Style.slot({ opacity: 1 })),
            ),
          }),
        ),
      );

    const open = Effect.runSync(Component.setupEffect(makeCard(true), {}));
    const closed = Effect.runSync(Component.setupEffect(makeCard(false), {}));

    expect(open.slots.root.getStyle("opacity")).toBe(1);
    expect(closed.slots.root.getStyle("opacity")).toBe(0.5);
  });

  // ── Piece selection is a setup-time snapshot; value functions are reactive ──
  //
  // The two tests above compare *separately constructed* components, which
  // cannot distinguish "whenBinding evaluated the binding" from "whenBinding
  // re-evaluates when the binding changes". These two pin the actual contract:
  // `Style.whenBinding` picks pieces once, at attach time (`resolveSlot` runs
  // outside any reaction), while a function-valued style *property* stays
  // reactive through `handle.setStyle`.

  it("evaluates a signal-valued binding once at attach time (whenBinding is not reactive)", () => {
    const [isOpen, setIsOpen] = createSignal(false);
    const Card = Component.make<{}, never, never, {
      readonly isOpen: () => boolean;
      readonly slots: { readonly root: Element.Container };
    }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ isOpen, slots: { root: Element.container() } }),
      () => null,
    ).pipe(
      Style.attach(
        Style.make({
          root: Style.compose(
            Style.slot({ opacity: 0.5 }),
            Style.whenBinding("isOpen", true, Style.slot({ opacity: 1 })),
          ),
        }),
      ),
    );

    const bindings = Effect.runSync(Component.setupEffect(Card, {}));
    expect(bindings.slots.root.getStyle("opacity")).toBe(0.5);

    setIsOpen(true);
    flush();
    // Characterized, not aspirational: piece selection does not re-run.
    expect(bindings.slots.root.getStyle("opacity")).toBe(0.5);
  });

  it("re-evaluates a function-valued style property when its signal changes", () => {
    const [opacity, setOpacity] = createSignal(0.5);
    let recomputes = 0;
    const root = resolveOnSlot(Style.slot({
      opacity: () => {
        recomputes += 1;
        return opacity();
      },
    }));

    expect(root.getStyle("opacity")).toBe(0.5);
    expect(recomputes).toBe(1);

    setOpacity(1);
    flush();
    expect(root.getStyle("opacity")).toBe(1);
    expect(recomputes).toBe(2);
  });

  it("publishes resolved global styles through a layer service", () => {
    const piece = Style.global({
      body: Style.slot({ color: "text.primary" }),
      ".app": { display: "grid" },
    });
    const applied: Array<string | undefined> = [];
    const layer = Style.globalLayer(piece, {
      apply: (sheet) => Effect.sync(() => {
        applied.push(String(sheet.resolved.body?.color));
      }),
    });

    const service = Effect.runSync(
      Effect.service(Style.GlobalStyleTag).pipe(Effect.provide(layer)) as Effect.Effect<Style.GlobalStyleService, never, never>,
    );

    expect(service.sheet.resolved.body?.color).toBe("#111827");
    expect(service.sheet.resolved[".app"]?.display).toBe("grid");
    expect(applied).toEqual(["#111827"]);
  });

  it("preserves renderer-neutral style descriptors on attached handles", () => {
    const Card = Component.make<{}, never, never, {
      readonly slots: {
        readonly root: Element.Container;
      };
    }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: { root: Element.container() } }),
      () => null,
    ).pipe(
      Style.attach(
        Style.make({
          root: Style.compose(
            Style.media({ "(min-width: 800px)": Style.slot({ display: "grid" }) }),
            Style.pseudo({ ":hover": { color: "accent.default" } }),
          ),
        }),
      ),
    );

    const bindings = Effect.runSync(Component.setupEffect(Card, {}));

    expect(bindings.slots.root.getStyle("__media")).toEqual({
      "(min-width: 800px)": Style.slot({ display: "grid" }),
    });
    expect(bindings.slots.root.getStyle("__pseudo")).toEqual({
      ":hover": { color: "accent.default" },
    });
  });

  it("resolves binding-conditional styles nested inside responsive base pieces", () => {
    const makeCard = (isOpen: boolean) =>
      Component.make<{}, never, never, {
        readonly isOpen: boolean;
        readonly slots: {
          readonly root: Element.Container;
        };
      }>(
        Component.props<{}>(),
        Component.require<never>(),
        () => Effect.succeed({ isOpen, slots: { root: Element.container() } }),
        () => null,
      ).pipe(
        Style.attach(
          Style.make({
            root: Style.compose(
              Style.slot({ opacity: 0.25 }),
              Style.responsive({
                base: Style.whenBinding("isOpen", true, Style.slot({ opacity: 1 })),
              }),
            ),
          }),
        ),
      );

    const open = Effect.runSync(Component.setupEffect(makeCard(true), {}));
    const closed = Effect.runSync(Component.setupEffect(makeCard(false), {}));

    expect(open.slots.root.getStyle("opacity")).toBe(1);
    expect(closed.slots.root.getStyle("opacity")).toBe(0.25);
  });

  it("applies binding-conditional styles against behavior-provided bindings in view attachment", () => {
    const Slots = View.Slots.define({
      root: { capability: Element.Capability.Container },
    });
    const IsOpen = Behavior.binding<"isOpen", boolean>("isOpen");
    const disclosure = Behavior.provides({ isOpen: IsOpen })(
      Behavior.forSlots(Slots)(() => Effect.succeed({ isOpen: true })),
    );
    const Card = Component.make<{}, never, never, {
      readonly slots: View.Slots.HandlesOf<typeof Slots>;
    }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: View.Slots.handles(Slots) }),
      () => View.fromSlots(Slots, null),
    ).pipe(
      Component.withSlots(Slots),
      Behavior.attachToSlots(disclosure, Slots),
      Style.attachToSlots(
        Style.forSlots(Slots)({
          root: Style.compose(
            Style.slot({ opacity: 0.25 }),
            Style.whenBinding(IsOpen, true, Style.slot({ opacity: 1 })),
          ),
        }),
        Slots,
      ),
    );

    const view = Effect.runSync(Component.renderViewEffect(Card, {}));
    expect(view?.slots.root.getStyle("opacity")).toBe(1);
  });

  it("validates style attachments against View slot metadata", () => {
    const view = View.make(
      {
        root: Element.container(),
        secret: Element.interactive(),
      },
      null,
      {
        name: "Card",
        slotMetadata: {
          root: View.slot("root"),
          secret: View.hidden("secret"),
        },
      },
    );

    const style = Style.make({
      root: Style.slot({ padding: "md" }),
      secret: Style.slot({ opacity: 0 }),
      missing: Style.slot({ color: "red" }),
    });

    expect(Style.validateAttachment(style, view).map((d) => d.code)).toEqual([
      "view:hidden-slot",
      "view:unknown-slot",
    ]);
  });

  it("validates mapped style attachments against View slot metadata", () => {
    const view = View.make(
      {
        root: Element.container(),
        secret: Element.interactive(),
      },
      null,
      {
        slotMetadata: {
          root: View.slot("root"),
          secret: View.hidden("secret"),
        },
      },
    );

    const style = Style.make({
      surface: Style.slot({ padding: "md" }),
      affordance: Style.slot({ opacity: 0 }),
    });

    expect(Style.validateAttachmentBySlots(style, {
      surface: "root",
      affordance: "secret",
    }, view).map((d) => d.code)).toEqual(["view:hidden-slot"]);
  });

  it("validates style attachments against component-rendered View metadata", () => {
    const Card = Component.make<{}, never, never, { readonly root: Element.Container }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ root: Element.container() }),
      (_props, bindings) => View.make(
        { root: bindings.root },
        null,
        {
          slotMetadata: {
            root: View.hidden("root"),
          },
        },
      ),
    );

    const diagnostics = Effect.runSync(Style.validateComponentAttachment(
      Style.make({ root: Style.slot({ padding: "md" }) }),
      Card,
      {},
    ));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["view:hidden-slot"]);
  });

  it("validates style properties against platform metadata", () => {
    const style = Style.make({
      root: Style.compose(
        Style.slot({ color: "red", opacity: 1 }),
        Style.slot({ backdropFilter: "blur(4px)" }),
      ),
      title: Style.slot({ fontSize: "heading.sm" }),
    });

    const diagnostics = Style.validatePlatform(style, {
      name: "minimal-style",
      properties: [
        Style.Property.Color,
        Style.Property.Opacity,
        Style.Property.FontSize,
      ],
    });

    expect(diagnostics).toEqual([
      {
        code: "style:unsupported-property",
        message: "Style slot 'root' uses property 'backdropFilter', but platform 'minimal-style' does not list that property as supported.",
        platform: "minimal-style",
        slot: "root",
        property: "backdropFilter",
      },
    ]);
  });

  it("reports style platform diagnostics during setup attachment", () => {
    const diagnostics: Array<Style.StyleDiagnostic> = [];
    const Card = Component.make<{}, never, never, {
      readonly slots: {
        readonly root: Element.Container;
      };
    }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: { root: Element.container() } }),
      () => null,
    ).pipe(
      Style.attach(
        Style.make({
          root: Style.slot({
            color: "red",
            backdropFilter: "blur(4px)",
          }),
        }),
      ),
    );

    const bindings = Effect.runSync(
      Component.setupEffect(Card, {}).pipe(
        Effect.provide(Style.platform(
          {
            name: "minimal-style",
            properties: [Style.Property.Color],
          },
          { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
        )),
      ),
    );

    expect(bindings.slots.root.getStyle("color")).toBe("red");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["style:unsupported-property"]);
    expect(diagnostics[0]).toMatchObject({
      platform: "minimal-style",
      slot: "root",
      property: "backdropFilter",
    });
  });

  it("preserves View metadata through setup style attachment with a platform layer", () => {
    const diagnostics: Array<Style.StyleDiagnostic> = [];
    const Card = Component.make<{}, never, never, {
      readonly slots: {
        readonly root: Element.Container;
      };
    }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: { root: Element.container() } }),
      (_props, bindings) => View.make(
        bindings.slots,
        "card",
        {
          name: "StyledCard",
          slotMetadata: {
            root: View.slot("root", {
              capability: Element.Capability.Container,
              allowedAttributes: [View.Attribute.AriaLabel],
            }),
          },
        },
      ),
    ).pipe(
      Style.attach(
        Style.make({
          root: Style.slot({
            color: "red",
            backdropFilter: "blur(4px)",
          }),
        }),
      ),
      Component.withLayer(Style.platform(
        {
          name: "minimal-style",
          properties: [Style.Property.Color],
        },
        { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
      )),
    );

    const view = Effect.runSync(Component.renderViewEffect(Card, {}));

    expect(view?.name).toBe("StyledCard");
    expect(view?.slotMetadata?.root?.name).toBe("root");
    expect(View.nameOfCapability(view?.slotMetadata?.root?.capability ?? "missing")).toBe("Container");
    expect(view?.slots.root.getStyle("color")).toBe("red");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["style:unsupported-property"]);
  });

  it("exposes theme helpers through the Style namespace", () => {
    expect(Style.Style.ThemeLight).toBeDefined();
    expect(Style.Style.lookupToken(defaultThemeTokens, "surface")).toBe("#ffffff");
  });

  it("supports user-declared theme token schemas at runtime", () => {
    const appTheme = Theme.define({
      color: {
        brand: {
          tertiary: "#ff00ff",
        },
      },
      spacing: {
        page: {
          gutter: 24,
        },
      },
    });

    expect(appTheme.path("color", "brand.tertiary")).toBe("brand.tertiary");
    expect(appTheme.lookup("color.brand.tertiary")).toBe("#ff00ff");
    expect(appTheme.lookup("brand.tertiary")).toBe("#ff00ff");
    expect(appTheme.lookup("missing.token")).toBe("missing.token");
    expect(Style.Style.defineTheme(appTheme.tokens).lookup("spacing.page.gutter")).toBe(24);
    expect(Style.Style.themeLayer(appTheme.tokens)).toBeDefined();
  });
});
