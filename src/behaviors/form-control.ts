/**
 * formControl behavior — the hidden-native-input projection (K0b).
 *
 * A dormant custom widget must submit in a REAL form before any JS loads:
 * the projection is *structural* — the hidden native input is an element in
 * the anatomy (a slot), so SSR emits it, `A11y.validate` can see it, and no
 * raw HTML string is concatenated anywhere (SafeHtml discipline).
 *
 * The widget's value atom stays the single source of truth and the
 * projection follows it reactively — one mechanism, no
 * controlled/uncontrolled split (`DQ-052`: the atom travels on the DEPS
 * channel, never smuggled through the elements record, which is
 * capability-checked and must contain elements only).
 *
 * @see docs/kit-research/behaviors/README.md (formControl tier)
 */
import { Effect, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import type * as Element from "../Element.js";

export const FormControlOptions = Schema.Struct({
  /** The submitted form field name. */
  name: Schema.String,
  /** Mirror `required` onto the native input. Default false. */
  required: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
});

export type FormControlOptions = typeof FormControlOptions.Type;

/** Caller-facing config: every Schema knob beyond `name` optional. */
export type FormControlConfig = typeof FormControlOptions.Encoded;

export type FormControlElements = {
  readonly root: Element.Interactive;
  /** The projected native input slot — rendered by SSR, hidden on screen. */
  readonly hiddenInput: Element.Handle;
};

export type FormControlDeps = {
  /** The widget's value atom — the single source of truth. */
  readonly value: Atom.WritableAtom<string>;
};

export type FormControlBindings = {
  /**
   * Validity as an atom, not an imperative setter: it composes with
   * `Style.whenBinding` and is snapshotted by resume for free.
   */
  readonly invalid: Component.StateAtom<boolean>;
};

/**
 * Project a widget's value onto a hidden native input so the surrounding
 * form submits it — dormant, before any JS loads. `aria-invalid` mirrors
 * the `invalid` binding on the root.
 *
 * Options decode against `FormControlOptions` at attach time: defaults come
 * from the Schema, and a malformed config fails the attach Effect with a
 * typed `Behavior.BehaviorOptionsError` — the factory itself never throws.
 */
export const formControl = (config: FormControlConfig) =>
  Behavior.make<
    FormControlElements,
    FormControlBindings,
    never,
    Behavior.BehaviorOptionsError,
    FormControlDeps
  >((elements, deps) =>
    Effect.gen(function* () {
      const options = yield* Behavior.decodeOptions(
        "formControl",
        FormControlOptions,
        { name: config.name, required: config.required },
      );
      const invalid = yield* Component.state(false);

      yield* elements.hiddenInput.setAttr("type", "hidden");
      yield* elements.hiddenInput.setAttr("name", options.name);
      if (options.required) {
        yield* elements.hiddenInput.setAttr("required", true);
      }
      // The projection FOLLOWS the atom: a reactive attribute, so the native
      // input is never a second copy of the state that can drift.
      yield* elements.hiddenInput.setAttr("value", () => deps.value());
      yield* elements.root.setAttr("aria-invalid", () => invalid());

      return { invalid } satisfies FormControlBindings;
    })
  ).pipe(
    Behavior.provides({
      invalid: Behavior.binding<"invalid", Component.StateAtom<boolean>>("invalid"),
    }),
  );
