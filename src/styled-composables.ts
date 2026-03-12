import * as Composables from "./composables.js";
import * as Style from "./Style.js";
import * as StyleUtils from "./style-utils.js";
import type * as Component from "./Component.js";

export function createStyledCombobox<T>(options: {
  readonly filter: (item: T, query: string) => boolean;
  readonly multiple?: boolean;
}) {
  const Base = Composables.createCombobox<T>(options);
  const style = Style.make({
    trigger: Style.compose(StyleUtils.interactive, StyleUtils.rounded("md"), StyleUtils.bordered()),
    content: Style.compose(StyleUtils.bordered(), StyleUtils.rounded("md"), StyleUtils.elevated("md")),
    input: Style.compose(StyleUtils.padded("sm")),
    listbox: Style.compose(StyleUtils.padded("xs")),
  });

  return Base.pipe(
    Style.attachBySlotsFor<Component.BindingsOf<typeof Base>>()(style, {
      trigger: "trigger",
      content: "content",
      input: "input",
      listbox: "listbox",
    }),
  );
}
