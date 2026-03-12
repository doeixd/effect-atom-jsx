import * as Style from "../Style.js";

Style.slot({
  backgroundColor: "surface",
  fontSize: "body.md",
  borderRadius: "md",
});

Style.tokenColor("surface");

// @ts-expect-error invalid color token path
Style.tokenColor("surfce");
