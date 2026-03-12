import * as Style from "../Style.js";

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
  defaults: {
    intent: "primary",
    size: "sm",
  },
});

type ButtonVariantProps = Style.VariantProps<typeof button>;

const ok: ButtonVariantProps = { intent: "ghost", size: "lg" };
void ok;

// @ts-expect-error invalid intent
button({ intent: "oops" });
