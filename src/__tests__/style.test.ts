import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Style from "../Style.js";
import * as StyleUtils from "../style-utils.js";
import { defaultThemeTokens } from "../style-types.js";
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
            StyleUtils.padded("md" as any),
            Style.slot({ backgroundColor: "surface" }),
          ),
        }),
      ),
    );

    const bindings = Effect.runSync(Component.setupEffect(Card, {}) as Effect.Effect<any, never, never>);
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

    const styles = card({ compact: "true" as any });
    expect(styles.root).toBeDefined();
    expect(styles.title).toBeDefined();
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
      ) as Effect.Effect<any, never, never>,
    );

    expect(bindings.slots.root.getStyle("color")).toBe("red");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["style:unsupported-property"]);
    expect(diagnostics[0]).toMatchObject({
      platform: "minimal-style",
      slot: "root",
      property: "backdropFilter",
    });
  });

  it("exposes theme helpers through the Style namespace", () => {
    expect(Style.Style.ThemeLight).toBeDefined();
    expect(Style.Style.lookupToken(defaultThemeTokens, "surface")).toBe("#ffffff");
  });
});
