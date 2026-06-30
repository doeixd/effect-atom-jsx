import * as Style from "../Style.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const BackdropFilter = Style.Property.make("backdropFilter");

type _CustomPropertyName = Expect<Equal<Style.Property.NameOf<typeof BackdropFilter>, "backdropFilter">>;
type _PropertyNames = Expect<
  Equal<
    Style.Property.NamesOf<[
      typeof Style.Property.Color,
      typeof Style.Property.Opacity,
      typeof BackdropFilter,
    ]>,
    "color" | "opacity" | "backdropFilter"
  >
>;

const style = Style.make({
  root: Style.slot({ color: "red", backdropFilter: "blur(4px)" }),
});

Style.validatePlatform(style, {
  name: "web",
  properties: [
    Style.Property.Color,
    BackdropFilter,
  ],
});

Style.validatePlatform(style, {
  name: "legacy",
  properties: [
    "color",
    Style.Property.make("backdropFilter"),
  ],
});
