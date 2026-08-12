/**
 * Anchor position — place a floating element relative to an anchor.
 *
 * The geometry pipeline is an injected SEAM: `measure` computes coordinates
 * and `autoUpdate` decides when to recompute. Element handles are
 * renderer-neutral and carry no geometry, so the DOM adapter (floating-ui
 * per the research decision) supplies real seams; unit tests inject fakes;
 * attaching with no `measure` fails closed with a typed error instead of
 * fabricating zero-valued coordinates.
 *
 * @see docs/kit-research/behaviors/anchor-position.md
 */
import { Effect, Schema, Scope } from "effect";
import * as Atom from "../Atom.js";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import type * as Element from "../Element.js";

export const AnchorPlacement = Schema.Literals([
  "top",
  "top-start",
  "top-end",
  "bottom",
  "bottom-start",
  "bottom-end",
  "left",
  "left-start",
  "left-end",
  "right",
  "right-start",
  "right-end",
]);
export type AnchorPlacement = typeof AnchorPlacement.Type;

export const AnchorPositionOptions = Schema.Struct({
  placement: AnchorPlacement.pipe(
    Schema.withDecodingDefault(Effect.succeed("bottom-start" as const)),
  ),
  /** CSS positioning strategy applied to the floating element. */
  strategy: Schema.Literals(["absolute", "fixed"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("absolute" as const)),
  ),
  /** Main-axis offset in pixels, passed through to the measure seam. */
  offset: Schema.Number.pipe(
    Schema.withDecodingDefault(Effect.succeed(0)),
  ),
});

export type AnchorPositionOptions = typeof AnchorPositionOptions.Type;

export type AnchorCoords = { readonly x: number; readonly y: number };

/** Context handed to the measurement seam on every update. */
export type AnchorMeasureContext = AnchorPositionOptions & {
  readonly anchor: Element.Interactive;
  readonly floating: Element.Container;
};

/** Caller-facing config: Schema knobs optional (defaults decode in) + seams. */
export type AnchorPositionConfig = typeof AnchorPositionOptions.Encoded & {
  /** Compute the floating element's coordinates. REQUIRED to attach. */
  readonly measure?: (context: AnchorMeasureContext) => AnchorCoords;
  /**
   * Subscribe the recompute callback to whatever should trigger updates
   * (scroll, resize, mutation); return the unsubscribe. Default: measure
   * once at attach, never again.
   */
  readonly autoUpdate?: (update: () => void) => () => void;
};

export type AnchorPositionBindings = {
  /** Last measured coordinates; undefined until the first measure. */
  readonly coords: Atom.ReadonlyAtom<AnchorCoords | undefined>;
  /** Recompute and re-apply position now. */
  readonly update: () => void;
};

/** Attaching without a measurement seam fails closed with this error. */
export class AnchorPositionMeasureError extends Schema.TaggedErrorClass<AnchorPositionMeasureError>(
  "@effect-atom-jsx/AnchorPositionMeasureError",
)("AnchorPositionMeasureError", {
  message: Schema.String,
}) {}

/**
 * Position a floating container relative to an anchor element.
 *
 * Each update applies `left`/`top` (px) and the position strategy to the
 * floating element and publishes the coordinates on the `coords` binding.
 * The `autoUpdate` unsubscribe runs exactly once when the attachment scope
 * closes.
 *
 * Options decode against `AnchorPositionOptions` at attach time: defaults
 * come from the Schema, and a malformed config fails the attach Effect with a
 * typed `Behavior.BehaviorOptionsError` — the factory itself never throws.
 */
export const anchorPosition = (config: AnchorPositionConfig = {}) =>
  Behavior.make<
    {
      readonly anchor: Element.Interactive;
      readonly floating: Element.Container;
    },
    AnchorPositionBindings,
    Scope.Scope,
    Behavior.BehaviorOptionsError | AnchorPositionMeasureError
  >((elements) =>
    Effect.gen(function* () {
      const options = yield* Behavior.decodeOptions(
        "anchorPosition",
        AnchorPositionOptions,
        {
          placement: config.placement,
          strategy: config.strategy,
          offset: config.offset,
        },
      );
      const measure = config.measure;
      if (measure === undefined) {
        return yield* new AnchorPositionMeasureError({
          message:
            "anchorPosition requires a `measure` seam: element handles carry no geometry, so the DOM adapter (e.g. floating-ui) must supply measurement. Refusing to fabricate coordinates.",
        });
      }

      const coords = yield* Component.state<AnchorCoords | undefined>(undefined);

      const update = (): void => {
        const next = measure({ ...options, ...elements });
        coords.set(next);
        Effect.runSync(elements.floating.setStyleOnce("position", options.strategy));
        Effect.runSync(elements.floating.setStyleOnce("left", `${next.x}px`));
        Effect.runSync(elements.floating.setStyleOnce("top", `${next.y}px`));
      };

      const subscribe = config.autoUpdate ?? ((run: () => void) => {
        run();
        return () => {};
      });
      const stop = subscribe(update);
      yield* Effect.acquireRelease(Effect.void, () => Effect.sync(stop));

      return {
        coords,
        update,
      } satisfies AnchorPositionBindings;
    })
  ).pipe(
    Behavior.events({ floating: [] }),
    Behavior.provides({
      coords: Behavior.binding<"coords", Atom.ReadonlyAtom<AnchorCoords | undefined>>("coords"),
      update: Behavior.binding<"update", () => void>("update"),
    }),
  );
