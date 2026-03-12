import * as Style from "../Style.js";

const grid = Style.grid({
  template: {
    columns: ["240px", "1fr", "300px"],
    rows: ["auto", "1fr", "auto"],
    areas: [
      ["sidebar", "header", "header"],
      ["sidebar", "content", "aside"],
      ["sidebar", "footer", "footer"],
    ] as const,
  },
});

type Area = Style.GridAreas<typeof grid>;
const okArea: Area = "sidebar";
void okArea;

// @ts-expect-error invalid area
const badArea: Area = "nonexistent";
void badArea;

Style.nest({
  [Style.child("a", "hover")]: { color: "accent.default" },
  [Style.descendant("span", "focus")]: { color: "text.primary" },
});
