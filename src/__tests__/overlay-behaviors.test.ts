/**
 * K0b load-bearing five, last two: `dismissableLayer` (service-backed stack)
 * and `anchorPosition` (injected measurement seam). The authoritative
 * acceptance scenarios live in `future/components/behavior-catalog.spec.ts`;
 * these keep the behaviors covered by `npm test` until that file promotes.
 */
import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Option } from "effect";
import * as Behavior from "../Behavior.js";
import * as Element from "../Element.js";
import {
  anchorPosition,
  AnchorPositionOptions,
} from "../behaviors/anchor-position.js";
import {
  dismissableLayer,
  DismissableLayerOptions,
  DismissLayerStack,
  makeDismissLayerStack,
} from "../behaviors/dismissable-layer.js";

describe("dismissableLayer", () => {
  it("dismisses only the topmost layer of its own service stack, exact-once", () => {
    const dismissed: Array<string> = [];
    const stack = makeDismissLayerStack();
    const parentRoot = Element.container();
    const childRoot = Element.container();
    const attach = (name: string, root: Element.Container) =>
      Effect.runSync(
        Behavior.attachScoped(
          dismissableLayer({ onDismiss: () => dismissed.push(name) }),
          { root },
        ).pipe(Effect.provideService(DismissLayerStack, stack)),
      );

    const parent = attach("parent", parentRoot);
    const child = attach("child", childRoot);
    expect(stack.layers()).toHaveLength(2);
    expect(parent.bindings.isTopmost()).toBe(false);
    expect(child.bindings.isTopmost()).toBe(true);

    // Escape reaches both roots (as a bubbled document event would); only
    // the topmost layer may act on it.
    parentRoot.emit("keydown", { key: "Escape" });
    childRoot.emit("keydown", { key: "Escape" });
    expect(dismissed).toEqual(["child"]);

    Effect.runSync(child.dispose);
    expect(parent.bindings.isTopmost()).toBe(true);
    parentRoot.emit("keydown", { key: "Escape" });
    expect(dismissed).toEqual(["child", "parent"]);

    Effect.runSync(parent.dispose);
    Effect.runSync(parent.dispose);
    parentRoot.emit("keydown", { key: "Escape" });
    expect(dismissed).toEqual(["child", "parent"]);
    expect(stack.layers()).toHaveLength(0);
  });

  it("a press inside a parent layer dismisses the layers above it only", () => {
    const dismissed: Array<string> = [];
    const stack = makeDismissLayerStack();
    const parentRoot = Element.container();
    const childRoot = Element.container();
    for (const [name, root] of [["parent", parentRoot], ["child", childRoot]] as const) {
      Effect.runSync(
        Behavior.attachScoped(
          dismissableLayer({ onDismiss: () => dismissed.push(name) }),
          { root },
        ).pipe(Effect.provideService(DismissLayerStack, stack)),
      );
    }
    // Inside the child: nothing above it, nothing dismisses.
    childRoot.emit("pointerdown", {});
    expect(dismissed).toEqual([]);
    // Inside the parent = outside the child.
    parentRoot.emit("pointerdown", {});
    expect(dismissed).toEqual(["child"]);
  });

  it("Schema defaults decode from an empty config", () => {
    expect(
      Effect.runSync(
        Behavior.decodeOptions("dismissableLayer", DismissableLayerOptions, {}),
      ),
    ).toEqual({
      dismissOnEscape: true,
      dismissOnOutsidePress: true,
      disableOutsidePointerEvents: false,
    });
  });
});

describe("anchorPosition", () => {
  it("measures through the injected seam, applies styles, and stops exactly once", () => {
    let stops = 0;
    let measures = 0;
    const floating = Element.container();
    const attached = Effect.runSync(
      Behavior.attachScoped(
        anchorPosition({
          placement: "top-end",
          measure: () => {
            measures += 1;
            return { x: 10, y: 20 };
          },
          autoUpdate: (run) => {
            run();
            return () => {
              stops += 1;
            };
          },
        }),
        { anchor: Element.interactive(), floating },
      ),
    );
    expect(attached.bindings.coords()).toEqual({ x: 10, y: 20 });
    expect(floating.getStyle("left")).toBe("10px");
    expect(floating.getStyle("top")).toBe("20px");
    attached.bindings.update();
    expect(measures).toBe(2);

    Effect.runSync(attached.dispose);
    Effect.runSync(attached.dispose);
    expect(stops).toBe(1);
  });

  it("fails closed with a typed error when no measure seam is supplied", () => {
    const exit = Effect.runSyncExit(
      Behavior.attachScoped(anchorPosition(), {
        anchor: Element.interactive(),
        floating: Element.container(),
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.hasDies(exit.cause)).toBe(false);
    expect(
      Cause.findErrorOption(exit.cause).pipe(
        Option.map((error) => error._tag),
        Option.getOrElse(() => "none"),
      ),
    ).toBe("AnchorPositionMeasureError");
  });

  it("placement defaults to bottom-start via the Schema", () => {
    expect(
      Effect.runSync(
        Behavior.decodeOptions("anchorPosition", AnchorPositionOptions, {}),
      ),
    ).toMatchObject({ placement: "bottom-start", strategy: "absolute", offset: 0 });
  });
});

describe("anchorPosition error-channel honesty", () => {
  it("a config with a static measure seam excludes the measure error from E", () => {
    type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends
      (<T>() => T extends B ? 1 : 2) ? true : false;

    const withMeasure = anchorPosition({ measure: () => ({ x: 0, y: 0 }) });
    const withoutMeasure = anchorPosition({ placement: "top" });

    // With `measure` present the attach can only fail on options decode…
    const exact1: Eq<
      Behavior.ErrorsOf<typeof withMeasure>,
      Behavior.BehaviorOptionsError
    > = true;
    // …without it, the guaranteed-failure case is honestly in the channel.
    const exact2: Eq<
      Behavior.ErrorsOf<typeof withoutMeasure>,
      Behavior.BehaviorOptionsError | import("../behaviors/anchor-position.js").AnchorPositionMeasureError
    > = true;
    void exact1;
    void exact2;
    expect(Behavior.isBehavior(withMeasure)).toBe(true);
  });
});
