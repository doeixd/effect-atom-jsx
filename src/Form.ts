/**
 * Form — first-class form vertical: schema-driven fields, touched/dirty,
 * submit as mutation/action with optional optimistic + single-flight (P9).
 */
import { Effect, Schema } from "effect";
import { createSignal, type Accessor } from "./api.js";
import * as Atom from "./Atom.js";
import {
  defineMutation,
  type MutationEffectHandle,
  type Result as ResultType,
} from "./effect-ts.js";

/** Snapshot of one form field's value, interaction state, and validation error. */
export interface FieldState<A, E = unknown> {
  readonly value: A;
  readonly touched: boolean;
  readonly dirty: boolean;
  readonly error: E | undefined;
}

/**
 * Mutable form field handle backed by runtime signals.
 *
 * `reset()` with no argument restores the current baseline. `reset(value)`
 * updates the baseline to `value`, including when `value` is explicitly
 * `undefined`.
 */
export interface FieldHandle<A, E = unknown> {
  readonly value: Accessor<A>;
  readonly touched: Accessor<boolean>;
  readonly dirty: Accessor<boolean>;
  readonly error: Accessor<E | undefined>;
  readonly state: Accessor<FieldState<A, E>>;
  set(value: A): void;
  touch(): void;
  reset(value?: A): void;
  setError(error: E | undefined): void;
}

/** Create a standalone field handle. */
export function field<A, E = unknown>(initial: A): FieldHandle<A, E> {
  const [value, setValue] = createSignal(initial);
  const [touched, setTouched] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [error, setError] = createSignal<E | undefined>(undefined);
  let baseline = initial;

  return {
    value,
    touched,
    dirty,
    error,
    state: () => ({
      value: value(),
      touched: touched(),
      dirty: dirty(),
      error: error(),
    }),
    set(next) {
      setValue(next);
      setDirty(!Object.is(next, baseline));
    },
    touch() {
      setTouched(true);
    },
    reset(...args: [] | [A]) {
      const resetTo = args.length === 0 ? baseline : args[0];
      baseline = resetTo;
      setValue(resetTo);
      setDirty(false);
      setTouched(false);
      setError(undefined);
    },
    setError(err) {
      setError(err);
    },
  };
}

/** Schema and initial value for one schema-driven form field. */
export interface FormSchemaFieldSpec<A> {
  readonly schema: Schema.Schema<A>;
  readonly initial: A;
}

/** Infer the submitted value object from a form field spec record. */
export type FormValuesOf<T extends Record<string, FormSchemaFieldSpec<any>>> = {
  readonly [K in keyof T]: T[K] extends FormSchemaFieldSpec<infer A> ? A : never;
};

/** Typed validation failure returned by `FormHandle.validate()` and submit. */
export type FormInvalid<E = string> = {
  readonly _tag: "FormInvalid";
  readonly errors: Readonly<Record<string, E>>;
};

/**
 * Submit handle shared by mutation and action paths.
 *
 * Callable and `.run()` forms fire-and-forget. `.effect()` returns the Effect
 * so callers can compose, provide layers, or await failures explicitly.
 */
export interface FormSubmitHandle<E> {
  (input?: void): void;
  run(input?: void): void;
  effect(input?: void): Effect.Effect<void, E | import("./effect-ts.js").BridgeError | import("./effect-ts.js").MutationSupersededError>;
  result: Accessor<ResultType<void, E>>;
  pending: Accessor<boolean>;
}

/**
 * Runtime form handle.
 *
 * Values are signal-backed and validation is Effect-native. `E` is the field
 * error type plus any typed submit error.
 */
export interface FormHandle<Values extends Record<string, unknown>, E = string> {
  readonly fields: { readonly [K in keyof Values]: FieldHandle<Values[K], E> };
  readonly values: Accessor<Values>;
  readonly touched: Accessor<boolean>;
  readonly dirty: Accessor<boolean>;
  readonly valid: Accessor<boolean>;
  readonly errors: Accessor<Partial<Record<keyof Values & string, E | undefined>>>;
  validate(): Effect.Effect<Values, FormInvalid<E>>;
  reset(): void;
  /** Submit validates then runs onSubmit; supports optimistic + single-flight options. */
  readonly submit: FormSubmitHandle<E | FormInvalid<E>>;
}

/**
 * Create a schema-driven form.
 *
 * Validation runs before submit and writes field errors. The submit path can
 * use local mutation semantics or the `Atom.action` single-flight transport.
 *
 * @example
 * const form = Form.make({
 *   email: { schema: Schema.String, initial: "" },
 * }, {
 *   onSubmit: (values) => UserService.save(values),
 *   reactivityKeys: ["users"],
 * })
 */
export function make<
  const Spec extends Record<string, FormSchemaFieldSpec<any>>,
  E = never,
>(
  spec: Spec,
  options: {
    readonly onSubmit: (values: FormValuesOf<Spec>) => Effect.Effect<void, E>;
    readonly name?: string;
    /** Optimistic UI update with current (pre/post-validate snapshot) values. */
    readonly optimistic?: (values: FormValuesOf<Spec>) => void;
    readonly rollback?: (values: FormValuesOf<Spec>) => void;
    readonly reactivityKeys?: Atom.ReactivityKeysInput;
    /** Single-flight transport options — uses `Atom.action` path when set. */
    readonly singleFlight?: false | Atom.SingleFlightClientOptions<void>;
  },
): FormHandle<FormValuesOf<Spec>, string | E> {
  type Values = FormValuesOf<Spec>;
  type FieldE = string | E;
  type SubmitE = FieldE | FormInvalid<FieldE>;
  const fields = {} as { [K in keyof Values]: FieldHandle<Values[K], FieldE> };
  for (const key of Object.keys(spec) as Array<keyof Spec & string>) {
    fields[key as keyof Values] = field(spec[key]!.initial) as FieldHandle<Values[keyof Values], FieldE>;
  }

  const values = (): Values => {
    const out = {} as Record<string, unknown>;
    for (const key of Object.keys(fields)) {
      out[key] = fields[key as keyof Values]!.value();
    }
    return out as Values;
  };

  const touched = () => Object.values(fields).some((f) => f.touched());
  const dirty = () => Object.values(fields).some((f) => f.dirty());
  const errors = () => {
    const out: Record<string, FieldE | undefined> = {};
    for (const key of Object.keys(fields)) {
      out[key] = fields[key as keyof Values]!.error();
    }
    return out as Partial<Record<keyof Values & string, FieldE | undefined>>;
  };
  const valid = () => Object.values(fields).every((f) => f.error() === undefined);

  const validate = (): Effect.Effect<Values, FormInvalid<FieldE>> =>
    Effect.suspend(() => {
      const next = { ...values() } as Values;
      const fieldErrors: Record<string, FieldE> = {};
      for (const key of Object.keys(spec) as Array<keyof Spec & string>) {
        const fieldSpec = spec[key]!;
        const fieldHandle = fields[key as keyof Values]!;
        fieldHandle.touch();
        try {
          const decoded = Schema.decodeUnknownSync(fieldSpec.schema as any)(fieldHandle.value());
          fieldHandle.setError(undefined);
          (next as any)[key] = decoded;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Invalid field";
          fieldHandle.setError(message as FieldE);
          fieldErrors[key] = message as FieldE;
        }
      }
      if (Object.keys(fieldErrors).length > 0) {
        return Effect.fail({ _tag: "FormInvalid" as const, errors: fieldErrors });
      }
      return Effect.succeed(next);
    });

  const useSingleFlight = options.singleFlight !== undefined && options.singleFlight !== false;

  const submitBody = (_: void): Effect.Effect<void, SubmitE> =>
    validate().pipe(
      Effect.flatMap((vals) => options.onSubmit(vals) as Effect.Effect<void, SubmitE>),
    );

  let submit: FormSubmitHandle<SubmitE>;
  if (useSingleFlight) {
    // Atom.action carries single-flight; optimistic/rollback layered around run.
    const action = Atom.action(submitBody, {
      name: options.name ?? "form.submit",
      singleFlight: options.singleFlight as Atom.SingleFlightClientOptions<void>,
      reactivityKeys: options.reactivityKeys,
      onError: () => {
        options.rollback?.(values());
      },
    });
    const run = (input?: void) => {
      options.optimistic?.(values());
      action.run(input as void);
    };
    const handle = ((input?: void) => run(input)) as FormSubmitHandle<SubmitE>;
    handle.run = run;
    handle.effect = (input?: void) => {
      options.optimistic?.(values());
      return action.effect(input as void) as Effect.Effect<void, SubmitE | import("./effect-ts.js").BridgeError | import("./effect-ts.js").MutationSupersededError>;
    };
    handle.result = action.result as Accessor<ResultType<void, SubmitE>>;
    handle.pending = action.pending;
    submit = handle;
  } else {
    const mutation = defineMutation(submitBody, {
      name: options.name ?? "form.submit",
      optimistic: () => {
        options.optimistic?.(values());
      },
      rollback: () => {
        options.rollback?.(values());
      },
    }) as MutationEffectHandle<void, SubmitE>;
    const handle = ((input?: void) => mutation.run(input as void)) as FormSubmitHandle<SubmitE>;
    handle.run = (input?: void) => mutation.run(input as void);
    handle.effect = (input?: void) => mutation.effect(input as void);
    handle.result = mutation.result;
    handle.pending = mutation.pending;
    submit = handle;
  }

  return {
    fields,
    values,
    touched,
    dirty,
    valid,
    errors,
    validate,
    reset() {
      for (const key of Object.keys(spec) as Array<keyof Spec & string>) {
        fields[key as keyof Values]!.reset(spec[key]!.initial as Values[keyof Values]);
      }
    },
    submit,
  };
}

/**
 * Apply server validation errors into matching field state by key.
 *
 * Unknown keys are ignored so this can consume partial API error payloads.
 */
export function applyServerErrors<Values extends Record<string, unknown>, E>(
  form: FormHandle<Values, E>,
  serverErrors: Partial<Record<keyof Values & string, E>>,
): void {
  for (const [key, error] of Object.entries(serverErrors)) {
    const fieldHandle = form.fields[key as keyof Values];
    if (fieldHandle === undefined || error === undefined) continue;
    fieldHandle.touch();
    fieldHandle.setError(error as E);
  }
}

export const Form = {
  field,
  make,
  applyServerErrors,
} as const;
