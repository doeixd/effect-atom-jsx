import { Component, Element, Style, StyleUtils } from "effect-atom-jsx";
import { Effect } from "effect";

const cardRecipe = Style.recipe({
  slots: ["root", "header", "title", "body"] as const,
  base: {
    root: Style.compose(
      StyleUtils.rounded("md"),
      StyleUtils.bordered(),
      StyleUtils.padded("md"),
      Style.slot({ backgroundColor: "surface" }),
      Style.nest({
        [Style.child("button", "hover")]: { backgroundColor: "accent.subtle" },
      }),
    ),
    header: Style.compose(StyleUtils.flexRow({ justify: "space-between", align: "center" }), StyleUtils.padded([0, 0, "sm", 0])),
    title: Style.compose(StyleUtils.textStyle({ size: "heading.sm", weight: "bold", color: "text.primary" })),
    body: Style.compose(StyleUtils.textStyle({ size: "body.md", color: "text.secondary" })),
  },
  variants: {
    elevated: {
      true: { root: StyleUtils.elevated("md") },
      false: {},
    },
    compact: {
      true: {
        root: StyleUtils.padded("sm"),
        title: StyleUtils.textStyle({ size: "body.md", weight: "semibold" }),
      },
      false: {},
    },
  },
  defaults: {
    elevated: "true",
    compact: "false",
  },
});

type CardProps = Style.RecipeProps<typeof cardRecipe> & {
  readonly title: string;
  readonly body: string;
};

type CardBindings = {
  readonly slots: {
    readonly root: Element.Container;
    readonly header: Element.Container;
    readonly title: Element.Interactive;
    readonly body: Element.Container;
  };
};

const Card = Component.make<CardProps, never, never, CardBindings>(
  Component.props<CardProps>(),
  Component.require<never>(),
  () => Effect.gen(function* () {
    const root = yield* Component.slotContainer();
    const header = yield* Component.slotContainer();
    const title = yield* Component.slotInteractive();
    const body = yield* Component.slotContainer();
    return { slots: { root, header, title, body } };
  }),
  (props, bindings) => (
    <section>
      <h3>{props.title}</h3>
      <p>{props.body}</p>
      <small>
        bg={String(bindings.slots.root.getStyle("backgroundColor"))} radius={String(bindings.slots.root.getStyle("borderRadius"))}
      </small>
    </section>
  ),
).pipe(
  Component.tapSetup<CardProps, never, never, CardBindings, never, never>((bindings) =>
    Effect.sync(() => {
      bindings.slots.header.emit("mounted");
    }),
  ),
  Style.attachBySlots(
    Style.make(cardRecipe({ elevated: "true", compact: "false" })),
    { root: "root", header: "header", title: "title", body: "body" },
  ),
);

export function App() {
  return (
    <main style="font-family: ui-sans-serif, system-ui; max-width: 680px; margin: 0 auto; padding: 24px;">
      <h1>Styled Card Recipe</h1>
      <Card title="Users" body="Recipe + variants + nested selectors + slot styles." elevated="true" compact="false" />
      <Card title="Compact" body="Same component, different variant inputs." elevated="true" compact="true" />
    </main>
  );
}
