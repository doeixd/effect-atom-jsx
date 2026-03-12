import * as Style from "../Style.js";

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
  defaults: {
    compact: "false",
  },
});

type CardRecipeProps = Style.RecipeProps<typeof card>;
const props: CardRecipeProps = { compact: "true" };
void props;
