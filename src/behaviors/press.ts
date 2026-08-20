/**
 * Press behavior — normalized activation (pointer + keyboard + virtual).
 *
 * Semantics inspired by react-aria `usePress` (not a port of that code).
 *
 * @see docs/kit-research/behaviors/press.md
 */
import { Effect, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import type * as Element from "../Element.js";

export const PressOptions = Schema.Struct({
  /** When true, do not move focus to the target on pointer press. */
  preventFocusOnPress: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  /** Track `isPressed` atom for styling. Default true. */
  trackPressed: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  /**
   * How long a synthetic click is suppressed after a real pointer press
   * (`DQ-066`). Default 50ms.
   */
  clickSuppressionMs: Schema.Number.pipe(
    Schema.withDecodingDefault(Effect.succeed(50)),
  ),
});

export type PressOptions = typeof PressOptions.Type;

/** Caller-facing config: every Schema knob optional (defaults decode in). */
export type PressConfig = typeof PressOptions.Encoded & {
  readonly onPress?: () => void;
  readonly onPressStart?: () => void;
  readonly onPressEnd?: () => void;
  readonly isDisabled?: () => boolean;
  /**
   * Timing seam (`DQ-066`, ratified): behaviour listener callbacks are
   * synchronous, so an Effect Clock cannot be read inside them — the
   * injected `now` is how deterministic tests own time. Default `Date.now`.
   */
  readonly now?: () => number;
};

export type PressBindings = {
  readonly isPressed: Atom.WritableAtom<boolean>;
  readonly press: () => void;
};

type PointerLike = {
  readonly pointerId?: number;
  readonly pointerType?: string;
  readonly button?: number;
  readonly preventDefault?: () => void;
};

type KeyLike = {
  readonly key?: string;
  readonly preventDefault?: () => void;
  readonly repeat?: boolean;
};

type ClickLike = {
  readonly detail?: number;
  readonly pointerType?: string;
};

/**
 * Attach press handlers to an interactive element.
 *
 * Keyboard: Enter / Space. Pointer: primary button down+up on target.
 * Cancels if pointer leaves before up. Virtual click (detail 0) fires once.
 *
 * Options decode against `PressOptions` at attach time: defaults come from
 * the Schema, and a malformed config fails the attach Effect with a typed
 * `Behavior.BehaviorOptionsError` — the factory itself never throws.
 */
export const press = (config: PressConfig = {}) =>
  Behavior.make<
    { readonly target: Element.Interactive },
    PressBindings,
    never,
    Behavior.BehaviorOptionsError
  >((elements) =>
    Effect.gen(function* () {
      const options = yield* Behavior.decodeOptions("press", PressOptions, {
        preventFocusOnPress: config.preventFocusOnPress,
        trackPressed: config.trackPressed,
        clickSuppressionMs: config.clickSuppressionMs,
      });
      const now = config.now ?? Date.now;
      const isPressed = yield* Component.state(false);
      let pointerDown = false;
      let activePointerId: number | undefined;
      let ignoreClickUntil = 0;

      const disabled = (): boolean => config.isDisabled?.() === true;

      const setPressed = (value: boolean): void => {
        if (options.trackPressed) isPressed.set(value);
      };

      const firePress = (): void => {
        if (disabled()) return;
        config.onPress?.();
      };

      const start = (): void => {
        if (disabled()) return;
        setPressed(true);
        config.onPressStart?.();
      };

      const end = (didPress: boolean): void => {
        setPressed(false);
        config.onPressEnd?.();
        if (didPress) firePress();
      };

      yield* elements.target.on("pointerdown", (raw) => {
        const event = raw as PointerLike;
        if (disabled()) return;
        if (event.button !== undefined && event.button !== 0) return;
        pointerDown = true;
        activePointerId = event.pointerId;
        start();
        if (options.preventFocusOnPress) {
          event.preventDefault?.();
        }
        // Suppress following synthetic click after real pointer press.
        ignoreClickUntil = now() + options.clickSuppressionMs;
      });

      yield* elements.target.on("pointerup", (raw) => {
        const event = raw as PointerLike;
        if (!pointerDown) return;
        if (
          activePointerId !== undefined &&
          event.pointerId !== undefined &&
          event.pointerId !== activePointerId
        ) {
          return;
        }
        pointerDown = false;
        activePointerId = undefined;
        end(true);
      });

      yield* elements.target.on("pointerleave", () => {
        if (!pointerDown) return;
        pointerDown = false;
        activePointerId = undefined;
        end(false);
      });

      yield* elements.target.on("keydown", (raw) => {
        const event = raw as KeyLike;
        if (disabled() || event.repeat) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault?.();
        start();
      });

      yield* elements.target.on("keyup", (raw) => {
        const event = raw as KeyLike;
        if (event.key !== "Enter" && event.key !== " ") return;
        if (!isPressed() && !options.trackPressed) {
          // keydown may have been missed
          firePress();
          return;
        }
        if (options.trackPressed && !isPressed()) return;
        event.preventDefault?.();
        end(true);
      });

      yield* elements.target.on("click", (raw) => {
        const event = raw as ClickLike;
        if (disabled()) return;
        if (now() < ignoreClickUntil) return;
        // Virtual / SR click often has detail 0
        if (event.detail === 0 || event.pointerType === "virtual") {
          firePress();
        }
      });

      return {
        isPressed,
        press: () => {
          if (disabled()) return;
          start();
          end(true);
        },
      } satisfies PressBindings;
    })
  ).pipe(
    Behavior.provides({
      isPressed: Behavior.binding<"isPressed", Atom.WritableAtom<boolean>>("isPressed"),
    }),
  );
