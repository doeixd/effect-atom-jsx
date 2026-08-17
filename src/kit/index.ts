/**
 * The kit index — the widget catalog, and the MECHANIZED a11y gate (K3).
 *
 * "A widget without a passing pattern contract does not ship" is enforced by
 * iterating this registry rather than trusting per-widget discipline:
 * `src/__tests__` renders every entry's default example and runs
 * `A11y.validate` against its declared pattern. `exampleProps` is typed
 * against the component's OWN props (`DQ-069`), so the gate cannot be
 * satisfied by validating a widget against props it does not have.
 */
import type * as A11y from "../A11y.js";
import type * as Component from "../Component.js";
import { Dialog, pattern as dialogPattern, type DialogProps } from "./dialog.js";

export interface KitWidget<
  C extends Component.Component<any, any, any, any, any> = Component.Component<any, any, any, any, any>,
> {
  readonly name: string;
  readonly component: C;
  readonly pattern: A11y.PatternContract<any>;
  /** DQ-069: tied to the component's own props — no mismatched-pair gate. */
  readonly exampleProps: Component.PropsOf<C>;
}

function widget<C extends Component.Component<any, any, any, any, any>>(
  entry: KitWidget<C>,
): KitWidget<C> {
  return entry;
}

/** Every shipped kit widget. The a11y gate iterates this list. */
export const widgets: ReadonlyArray<KitWidget<any>> = [
  widget<typeof Dialog>({
    name: "dialog",
    component: Dialog,
    pattern: dialogPattern,
    exampleProps: { title: "Example dialog" } satisfies DialogProps,
  }),
];

export { Dialog, type DialogProps } from "./dialog.js";
