/**
 * AtomSchema.ts — Schema-validated form fields backed by atoms.
 *
 * Wraps a writable atom with an Effect Schema to produce a `ValidatedAtom`
 * that exposes derived atoms for the parse result, validation errors, dirty
 * state, and touched state. Useful for building type-safe form inputs where
 * the raw input type (e.g. string) differs from the domain type (e.g. number).
 */

import { Option, Schema, Exit, Cause, Effect } from "effect";
import * as Atom from "./Atom.js";
import { createSignal } from "./api.js";

export type SchemaError = Schema.SchemaError;

/**
 * A reactive pair of atoms for managing form/input state with validation.
 */
export interface ValidatedAtom<A, I> {
  /** The raw, unvalidated input state. */
  readonly input: Atom.Writable<I, I>;
  /** The result of parsing the current input against the Schema. */
  readonly result: Atom.Atom<Exit.Exit<A, SchemaError>>;
  /** A derived atom containing validation errors, or None if valid. */
  readonly error: Atom.Atom<Option.Option<SchemaError>>;
  /** A derived atom containing the successfully parsed value, or None if invalid. */
  readonly value: Atom.Atom<Option.Option<A>>;
  /** Whether the field has been modified since creation. */
  readonly touched: Atom.Atom<boolean>;
  /** Whether the current input differs from the initial value. */
  readonly dirty: Atom.Atom<boolean>;
  /** Convenience boolean: true when the current input is valid. */
  readonly isValid: Atom.Atom<boolean>;
  /** Reset input to initial value and clear touched state. */
  readonly reset: () => void;
}

/**
 * Wrap a Writable atom with a Schema to create a validated form field.
 *
 * @example
 * const ageInput = Atom.make("25")
 * const ageField = AtomSchema.make(Schema.NumberFromString, ageInput)
 *
 * // Read current parse result
 * const current = Atom.get(ageField.value) // Option.some(25)
 */
/**
 * Wrap a Writable atom with a Schema to create a validated form field.
 *
 * @param schema    - The Effect Schema used to decode the raw input.
 * @param inputAtom - The writable atom holding the raw input value.
 * @param options   - Optional config. Pass `initial` to enable dirty detection and reset.
 *
 * @example
 * const ageInput = Atom.make("25")
 * const ageField = AtomSchema.make(Schema.NumberFromString, ageInput)
 *
 * // Read current parse result
 * const current = Atom.get(ageField.value) // Option.some(25)
 */
export function make<A, I>(
  schema: Schema.Schema<A>,
  inputAtom: Atom.Writable<I, I>,
  options?: { readonly initial?: I },
): ValidatedAtom<A, I> {
  const decode = Schema.decodeUnknownSync(schema as any);

  const result = Atom.map(inputAtom, (raw) => {
    try {
      return Exit.succeed(decode(raw));
    } catch (e: any) {
      return Exit.fail(e as SchemaError);
    }
  }) as Atom.Atom<Exit.Exit<A, SchemaError>>;

  const error = Atom.map(result, (res) => {
    if (res._tag === "Failure") {
      return Cause.findErrorOption(res.cause) as Option.Option<SchemaError>;
    }
    return Option.none() as Option.Option<SchemaError>;
  });

  const value = Atom.map(result, (res) =>
    res._tag === "Success" ? Option.some(res.value) : Option.none()
  );

  const isValid = Atom.map(result, (res) => res._tag === "Success");

  // Track touched state via a separate writable atom
  const touchedAtom = Atom.make(false);
  const hasInitial = options !== undefined && "initial" in options;
  const initialValue = options?.initial;

  // Wrap input with touched tracking
  const trackedInput = Atom.writable<I, I>(
    (get) => get(inputAtom),
    (ctx, val) => {
      ctx.set(touchedAtom as Atom.Writable<boolean>, true);
      ctx.set(inputAtom, val);
    },
  );

  const dirty = hasInitial
    ? Atom.map(inputAtom, (v) => v !== initialValue)
    : (touchedAtom as Atom.Atom<boolean>);

  const resetFn = () => {
    if (hasInitial) {
      Effect.runSync(Atom.set(inputAtom, initialValue as I));
    }
    Effect.runSync(Atom.set(touchedAtom as Atom.Writable<boolean>, false));
  };

  return {
    input: trackedInput,
    result,
    error,
    value,
    touched: touchedAtom as Atom.Atom<boolean>,
    dirty,
    isValid,
    reset: resetFn,
  };
}

/**
 * Creates a new independent ValidatedAtom with its own input atom and initial value.
 *
 * This is a convenience over `make` when you do not need to share the input
 * atom with other consumers.
 *
 * @param schema  - The Effect Schema used to decode the raw input.
 * @param initial - The starting input value (also used for dirty detection and reset).
 *
 * @example
 * const emailField = AtomSchema.makeInitial(Schema.String.pipe(Schema.nonEmptyString()), "")
 * // emailField.isValid starts as false (empty string fails nonEmptyString)
 * Effect.runSync(Atom.set(emailField.input, "alice@example.com"))
 * // emailField.isValid is now true
 */
export function makeInitial<A, I>(
  schema: Schema.Schema<A>,
  initial: I,
): ValidatedAtom<A, I> {
  // Use createSignal + writable directly to avoid Atom.make's function detection
  const [getValue, setValue] = createSignal<I>(initial);
  const inputAtom = Atom.writable<I, I>(
    () => getValue(),
    (_ctx, v) => setValue(v),
  );

  return make(schema, inputAtom, { initial });
}
