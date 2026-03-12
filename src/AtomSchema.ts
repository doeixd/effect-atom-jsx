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

type AnyRecord = Record<PropertyKey, unknown>;

function readPath(root: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as AnyRecord)[key];
  }
  return current;
}

function writePath(root: unknown, path: ReadonlyArray<PropertyKey>, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...tail] = path;

  const base =
    root !== null && typeof root === "object"
      ? root
      : typeof head === "number"
        ? []
        : {};

  if (Array.isArray(base)) {
    const copy = base.slice();
    const index = Number(head);
    copy[index] = writePath(copy[index], tail, value);
    return copy;
  }

  return {
    ...(base as AnyRecord),
    [head]: writePath((base as AnyRecord)[head], tail, value),
  };
}

/**
 * Create a writable atom focused on a nested path in an object atom.
 *
 * @example
 * const form = Atom.make({ user: { name: "Ada" } })
 * const userName = AtomSchema.path(form, "user", "name")
 * Effect.runSync(Atom.set(userName, "Grace"))
 */
export function path<Root, Value>(
  root: Atom.Writable<Root, Root>,
  ...segments: ReadonlyArray<PropertyKey>
): Atom.Writable<Value, Value> {
  return Atom.writable<Value, Value>(
    (get) => readPath(get(root), segments) as Value,
    (ctx, next) => {
      const current = ctx.get(root);
      ctx.set(root, writePath(current, segments, next) as Root);
    },
  );
}

/**
 * Common input codecs for form wiring.
 */
export const HtmlInput = {
  /** String input -> finite number (e.g. `<input type="number">`). */
  number: Schema.NumberFromString,
  /** String input -> Date (ISO-like values accepted by `Schema.Date`). */
  date: Schema.Date,
  /** Empty string maps to `null`, otherwise string payload. */
  optionalString: {
    schema: Schema.OptionFromNullOr(Schema.String),
    input: (value: string): string | null => value.trim() === "" ? null : value,
  },
  /** Empty string maps to `null`, otherwise numeric string payload. */
  optionalNumber: {
    schema: Schema.OptionFromNullOr(Schema.NumberFromString),
    input: (value: string): string | null => value.trim() === "" ? null : value,
  },
} as const;

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

type FieldModel = ValidatedAtom<any, any> | ValidatedStruct<any>;

type StructValue<Fields extends Record<string, FieldModel>> = {
  [K in keyof Fields]: Fields[K] extends ValidatedAtom<infer A, any>
    ? A
    : Fields[K] extends ValidatedStruct<infer Nested>
      ? StructValue<Nested>
      : never;
};

type StructInput<Fields extends Record<string, FieldModel>> = {
  [K in keyof Fields]: Fields[K] extends ValidatedAtom<any, infer I>
    ? I
    : Fields[K] extends ValidatedStruct<infer Nested>
      ? StructInput<Nested>
      : never;
};

type StructError<Fields extends Record<string, FieldModel>> = {
  [K in keyof Fields]?: Fields[K] extends ValidatedAtom<any, any>
    ? SchemaError
    : Fields[K] extends ValidatedStruct<infer Nested>
      ? StructError<Nested>
      : never;
};

export interface ValidatedStruct<Fields extends Record<string, FieldModel>> {
  readonly fields: Fields;
  readonly input: Atom.Writable<StructInput<Fields>, StructInput<Fields>>;
  readonly value: Atom.Atom<Option.Option<StructValue<Fields>>>;
  readonly error: Atom.Atom<Option.Option<StructError<Fields>>>;
  readonly touched: Atom.Atom<boolean>;
  readonly dirty: Atom.Atom<boolean>;
  readonly isValid: Atom.Atom<boolean>;
  readonly touch: () => void;
  readonly reset: () => void;
}

/**
 * Compose many validated fields into one typed form model.
 *
 * `input` allows writing all field inputs at once while preserving each field's
 * touched/dirty bookkeeping via `field.input` setters.
 */
export function struct<Fields extends Record<string, FieldModel>>(
  fields: Fields,
): ValidatedStruct<Fields> {
  const keys = Object.keys(fields) as Array<Extract<keyof Fields, string>>;

  const isStruct = (field: FieldModel): field is ValidatedStruct<any> =>
    typeof field === "object" && field !== null && "fields" in field && "touch" in field;

  const input = Atom.writable<StructInput<Fields>, StructInput<Fields>>(
    (get) => {
      const out = {} as StructInput<Fields>;
      for (const key of keys) {
        const field = fields[key] as unknown as FieldModel;
        if (isStruct(field)) {
          out[key] = get(field.input) as StructInput<Fields>[typeof key];
        } else {
          out[key] = get((field as ValidatedAtom<any, any>).input) as StructInput<Fields>[typeof key];
        }
      }
      return out;
    },
    (ctx, next) => {
      for (const key of keys) {
        const field = fields[key] as unknown as FieldModel;
        if (isStruct(field)) {
          ctx.set(field.input as Atom.Writable<any, any>, next[key]);
        } else {
          ctx.set((field as ValidatedAtom<any, any>).input as Atom.Writable<any, any>, next[key]);
        }
      }
    },
  );

  const value = Atom.readable<Option.Option<StructValue<Fields>>>((get) => {
    const out = {} as StructValue<Fields>;
    for (const key of keys) {
      const field = fields[key] as unknown as FieldModel;
      const current = isStruct(field)
        ? get(field.value)
        : get((field as ValidatedAtom<any, any>).value);
      if (Option.isNone(current)) return Option.none();
      out[key] = current.value as StructValue<Fields>[typeof key];
    }
    return Option.some(out);
  });

  const error = Atom.readable<Option.Option<StructError<Fields>>>((get) => {
    const out = {} as StructError<Fields>;
    let hasError = false;
    for (const key of keys) {
      const field = fields[key] as unknown as FieldModel;
      const current = isStruct(field)
        ? get(field.error)
        : get((field as ValidatedAtom<any, any>).error);
      if (Option.isSome(current as Option.Option<unknown>)) {
        hasError = true;
        out[key] = (current as Option.Some<unknown>).value as StructError<Fields>[typeof key];
      }
    }
    return hasError ? Option.some(out) : Option.none();
  });

  const touched = Atom.readable<boolean>((get) =>
    keys.some((key) => {
      const field = fields[key] as unknown as FieldModel;
      return isStruct(field) ? get(field.touched) : get((field as ValidatedAtom<any, any>).touched);
    }),
  );
  const dirty = Atom.readable<boolean>((get) =>
    keys.some((key) => {
      const field = fields[key] as unknown as FieldModel;
      return isStruct(field) ? get(field.dirty) : get((field as ValidatedAtom<any, any>).dirty);
    }),
  );
  const isValid = Atom.readable<boolean>((get) =>
    keys.every((key) => {
      const field = fields[key] as unknown as FieldModel;
      return isStruct(field) ? get(field.isValid) : get((field as ValidatedAtom<any, any>).isValid);
    }),
  );

  const touch = () => {
    for (const key of keys) {
      const field = fields[key] as unknown as FieldModel;
      if (isStruct(field)) {
        field.touch();
        continue;
      }
      const model = field as ValidatedAtom<any, any>;
      model.input.set(model.input());
    }
  };

  const reset = () => {
    for (const key of keys) {
      const field = fields[key] as unknown as FieldModel;
      if (isStruct(field)) {
        field.reset();
      } else {
        (field as ValidatedAtom<any, any>).reset();
      }
    }
  };

  return {
    fields,
    input,
    value,
    error,
    touched,
    dirty,
    isValid,
    touch,
    reset,
  };
}

/**
 * Wrap a Writable atom with a Schema to create a validated form field.
 *
 * @param schema    - The Effect Schema used to decode the raw input.
 * @param inputAtom - The writable atom holding the raw input value.
 * @param options   - Optional config. Pass `initial` to enable dirty detection and reset.
 *
 * `input` is wrapped to auto-mark `touched` on every write.
 *
 * `dirty` semantics:
 * - when `initial` is provided: `dirty = currentInput !== initial`
 * - otherwise: `dirty` mirrors `touched`
 *
 * @example
 * const ageInput = Atom.make("25")
 * const ageField = AtomSchema.make(Schema.NumberFromString, ageInput)
 *
 * const parsed = Effect.runSync(Atom.get(ageField.value))
 * // Option.some(25)
 *
 * Effect.runSync(Atom.set(ageField.input, "oops"))
 * const valid = Effect.runSync(Atom.get(ageField.isValid))
 * // false
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
 *
 * emailField.reset()
 * // input resets to initial value and touched becomes false
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

/**
 * Pipeable schema wrapper for existing writable atoms.
 *
 * @example
 * const age = Atom.make("25").pipe(AtomSchema.validated(Schema.NumberFromString))
 */
export function validated<A, I>(
  schema: Schema.Schema<A>,
  options?: { readonly initial?: I },
): (input: Atom.Writable<I, I>) => ValidatedAtom<A, I> {
  return (input) => make(schema, input, options);
}

/** Alias of `validated` to emphasize parse-first usage in forms. */
export const parsed = validated;

/**
 * Read and validate a form model as a composable Effect.
 *
 * Succeeds with the typed value when valid; fails with schema/form errors when invalid.
 */
export function validateEffect<A, I>(field: ValidatedAtom<A, I>): Effect.Effect<A, SchemaError>;
export function validateEffect<Fields extends Record<string, FieldModel>>(
  model: ValidatedStruct<Fields>,
): Effect.Effect<StructValue<Fields>, StructError<Fields>>;
export function validateEffect(
  model: ValidatedAtom<any, any> | ValidatedStruct<any>,
): Effect.Effect<any, any> {
  if ("fields" in model) {
    return Effect.suspend(() => {
      const value = model.value();
      if (Option.isSome(value)) return Effect.succeed(value.value);
      const error = model.error();
      if (Option.isSome(error)) return Effect.fail(error.value);
      return Effect.fail({ _tag: "FormInvalid", message: "Form is invalid" } as unknown as StructError<any>);
    });
  }

  return Effect.suspend(() => {
    const value = model.value();
    if (Option.isSome(value)) return Effect.succeed(value.value);
    const error = model.error();
    if (Option.isSome(error)) return Effect.fail(error.value);
    return Effect.fail({ _tag: "FormInvalid", message: "Field is invalid" } as unknown as SchemaError);
  });
}
