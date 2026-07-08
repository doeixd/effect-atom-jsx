import { bench, describe } from "vitest";
import { Effect } from "effect";
import * as Component from "../Component.js";
import * as Style from "../Style.js";
import * as StyleUtils from "../style-utils.js";

/**
 * Microbenchmarks for the UI authoring hot paths that back the perf claims in
 * README/afui.md ("styles are data, resolved without a CSS-in-JS runtime";
 * "granular components without a VDOM"). Characterization benchmarks — run with
 * `npm run bench` — not asserted thresholds; they exist so regressions in style
 * construction/resolution and per-component setup are visible.
 * See docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md (PR3).
 */

// A representative one-slot styled component (mirrors src/__tests__/style.test.ts).
function makeCard() {
  return Component.make<{}, never, never, {
    readonly slots: {
      readonly root: ReturnType<typeof Component.slotContainer> extends Effect.Effect<infer S, any, any> ? S : never;
    };
  }>(
    Component.props<{}>(),
    Component.require<never>(),
    () => Effect.gen(function* () {
      const root = yield* Component.slotContainer();
      return { slots: { root } };
    }),
    () => null,
  ).pipe(
    Style.attach(
      Style.make({
        root: Style.compose(
          StyleUtils.padded("md"),
          Style.slot({ backgroundColor: "surface" }),
        ),
      }),
    ),
  );
}

describe("style data construction", () => {
  bench("Style.make + compose a slot style", () => {
    Style.make({
      root: Style.compose(
        StyleUtils.padded("md"),
        Style.slot({ backgroundColor: "surface", color: "text" }),
      ),
    });
  });

  bench("StyleUtils.padded token piece", () => {
    StyleUtils.padded("md");
  });
});

describe("style resolution", () => {
  const Card = makeCard();
  const bindings = Effect.runSync(Component.setupEffect(Card, {}));

  bench("resolve a spacing token (getStyle padding)", () => {
    bindings.slots.root.getStyle("padding");
  });

  bench("resolve a theme color token (getStyle backgroundColor)", () => {
    bindings.slots.root.getStyle("backgroundColor");
  });
});

describe("component mount", () => {
  const Card = makeCard();

  bench("setup a styled one-slot component (per-mount setup Effect)", () => {
    Effect.runSync(Component.setupEffect(Card, {}));
  });
});
