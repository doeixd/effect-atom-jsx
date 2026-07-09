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

    const selected = button({ intent: "ghost", size: "lg" });
    expect(Array.isArray(selected) ? selected.length > 0 : true).toBe(true);
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

    const styles = card({ compact: "true" });
    expect(styles.root).toBeDefined();
    expect(styles.title).toBeDefined();
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
