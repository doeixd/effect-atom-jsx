/**
 * Reduced motion — the injected environment input for motion-sensitive
 * behaviors (`DQ-071`, ratified).
 *
 * A Context SERVICE, not a media-query sniff: the a11y matrix needs reduced
 * motion as a testable dimension, and a subtree (or a test) provides its own
 * reader. The DOM adapter provides a layer backed by
 * `matchMedia("(prefers-reduced-motion: reduce)")`; the static default is
 * `false` (full motion).
 */
import { Context, Layer } from "effect";

export interface ReducedMotionService {
  /** Read the current preference; consulted at transition time, not cached. */
  readonly prefersReducedMotion: () => boolean;
}

const ReducedMotionTag = Context.Service<ReducedMotionService>(
  "effect-atom-jsx/behaviors/ReducedMotion",
);

/** Build a service from a static value or a live reader. */
export function makeReducedMotion(
  value: boolean | (() => boolean),
): ReducedMotionService {
  return {
    prefersReducedMotion: typeof value === "function" ? value : () => value,
  };
}

/**
 * The service tag, with a static default `layer` (full motion) and `layerOf`
 * for tests and adapters.
 */
export const ReducedMotion = Object.assign(ReducedMotionTag, {
  layer: Layer.succeed(ReducedMotionTag, makeReducedMotion(false)),
  layerOf: (value: boolean | (() => boolean)) =>
    Layer.succeed(ReducedMotionTag, makeReducedMotion(value)),
});
