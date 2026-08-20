/**
 * The permissive-preset proof app (`PERMISSIVE_PACKAGE_PLAN.md` S5).
 *
 * Qwik-parity in one file: the click handler is a one-liner `extract.auto`
 * arrow — no capture schema, no code id, no buildId at the call site. The
 * transform infers the captures (`label`, a string, and `tags`, a **Map**),
 * and the Map rides the preset's universal seroval codec through the
 * manifest. The component never sets up on load; the counters prove it.
 */

import { Effect } from "effect";
import * as Component from "effect-atom-jsx/Component";
import * as Resume from "effect-atom-jsx/Resume";
import { addEventListener, template } from "effect-atom-jsx/runtime";
import { extract } from "effect-atom-jsx/portable-extract";
import { browserState } from "../shared/browser-state.js";

const buttonTemplate = template(
  '<button type="button" data-testid="permissive-pin">Pin',
);

export const PinBoard = Component.make(
  Component.props<{ readonly label: string }>(),
  Component.require<never>(),
  Component.setup<{ readonly label: string }>()
    .doEffect(() =>
      Effect.sync(() => {
        const browser = browserState();
        if (browser !== undefined) browser.setupRuns += 1;
      })
    )
    .bind("pin", ({ props }) => {
      const label = props.label;
      const tags = new Map([
        ["alpha", 1],
        ["beta", 2],
        ["gamma", 39],
      ]);
      return Component.action(
        // The Qwik-parity one-liner: captures inferred, Map included.
        extract.auto(() =>
          Effect.sync(() => {
            const browser = browserState();
            if (browser !== undefined) {
              browser.clicks.push({
                label,
                isMap: tags instanceof Map,
                size: tags.size,
                sum: [...tags.values()].reduce((total, value) => total + value, 0),
              });
            }
          })
        ),
      );
    }),
  (_props, bindings) => {
    const browser = browserState();
    if (browser !== undefined) browser.viewRuns += 1;
    const button = buttonTemplate();
    addEventListener(button, "click", Resume.event(bindings.pin), true);
    return button;
  },
);
