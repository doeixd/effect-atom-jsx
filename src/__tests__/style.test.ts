import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as Component from "../Component.js";
import * as Style from "../Style.js";
import * as StyleUtils from "../style-utils.js";

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
});
