import * as Style from "../Style.js";
import * as Theme from "../Theme.js";

Style.slot({
  backgroundColor: "surface",
  fontSize: "body.md",
  borderRadius: "md",
});

Style.tokenColor("surface");

// @ts-expect-error invalid color token path
Style.tokenColor("surfce");

const appTheme = Theme.define({
  color: {
    brand: {
      tertiary: "#f0f",
    },
  },
  spacing: {
    page: {
      gutter: 24,
    },
  },
});

const customColor = appTheme.path("color", "brand.tertiary");
void customColor;
const customSpacing = appTheme.path("spacing", "page.gutter");
void customSpacing;

// @ts-expect-error custom token paths are checked against the declared schema
appTheme.path("color", "brand.primary");

const appLayer = appTheme.layer({ mode: "dark" });
void appLayer;

const directLayer = Theme.layer(Theme.defineTokens({
  color: { ok: "#fff" },
}));
void directLayer;
