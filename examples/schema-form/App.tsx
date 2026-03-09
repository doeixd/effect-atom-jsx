/**
 * Schema Form — demonstrates AtomSchema for reactive form validation.
 *
 * Each form field is backed by an AtomSchema.ValidatedAtom that provides:
 * - `input` — writable atom for the raw value
 * - `value` — Option<A> of the parsed result
 * - `error` — Option<SchemaError> for validation errors
 * - `isValid` — boolean convenience accessor
 * - `touched` — has the user modified this field?
 * - `dirty` — does the current value differ from initial?
 * - `reset()` — restore to initial value
 */
import { Schema, Effect, Option } from "effect";
import {
  createSignal,
  createEffect,
  onCleanup,
  Atom,
  AtomSchema,
  AtomLogger,
} from "effect-atom-jsx";

// ─── Schema definitions ──────────────────────────────────────────────────────

// Schema.Int validates that the value is a finite integer (rejects NaN, floats)
const AgeSchema = Schema.Int;

// Schema.String validates strings (accepts any string value)
const NameSchema = Schema.String;

// ─── Individual form field component ──────────────────────────────────────────

function IntField(props: {
  label: string;
  field: AtomSchema.ValidatedAtom<number, number>;
}) {
  const [value, setValue] = createSignal(
    Effect.runSync(Atom.get(props.field.input as Atom.Atom<number>))
  );
  const [isValid, setIsValid] = createSignal(
    Effect.runSync(Atom.get(props.field.isValid))
  );
  const [touched, setTouched] = createSignal(
    Effect.runSync(Atom.get(props.field.touched))
  );
  const [dirty, setDirty] = createSignal(
    Effect.runSync(Atom.get(props.field.dirty))
  );

  const unsub1 = Atom.subscribe(props.field.input as Atom.Atom<number>, (v) => setValue(v));
  const unsub2 = Atom.subscribe(props.field.isValid, (v) => setIsValid(v));
  const unsub3 = Atom.subscribe(props.field.touched, (v) => setTouched(v));
  const unsub4 = Atom.subscribe(props.field.dirty, (v) => setDirty(v));

  onCleanup(() => { unsub1(); unsub2(); unsub3(); unsub4(); });

  return (
    <div class={`form-field ${isValid() ? "valid" : touched() ? "invalid" : ""}`}>
      <label>{props.label}</label>
      <input
        type="number"
        value={value()}
        onInput={(e: Event) => {
          const raw = Number((e.target as HTMLInputElement).value);
          Effect.runSync(Atom.set(props.field.input, raw));
        }}
      />
      {touched() && !isValid() ? <div class="error">Must be a whole number</div> : null}
      <div class="meta">
        <span>touched: {touched() ? "yes" : "no"}</span>
        <span>dirty: {dirty() ? "yes" : "no"}</span>
        <span>valid: {isValid() ? "yes" : "no"}</span>
      </div>
    </div>
  );
}

function StringField(props: {
  label: string;
  field: AtomSchema.ValidatedAtom<string, string>;
}) {
  const [value, setValue] = createSignal(
    Effect.runSync(Atom.get(props.field.input as Atom.Atom<string>))
  );
  const [touched, setTouched] = createSignal(
    Effect.runSync(Atom.get(props.field.touched))
  );
  const [dirty, setDirty] = createSignal(
    Effect.runSync(Atom.get(props.field.dirty))
  );

  const unsub1 = Atom.subscribe(props.field.input as Atom.Atom<string>, (v) => setValue(v));
  const unsub2 = Atom.subscribe(props.field.touched, (v) => setTouched(v));
  const unsub3 = Atom.subscribe(props.field.dirty, (v) => setDirty(v));

  onCleanup(() => { unsub1(); unsub2(); unsub3(); });

  return (
    <div class={`form-field ${dirty() ? "valid" : ""}`}>
      <label>{props.label}</label>
      <input
        type="text"
        value={value()}
        onInput={(e: Event) => {
          Effect.runSync(Atom.set(props.field.input, (e.target as HTMLInputElement).value));
        }}
      />
      <div class="meta">
        <span>touched: {touched() ? "yes" : "no"}</span>
        <span>dirty: {dirty() ? "yes" : "no"}</span>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  // Create validated form fields with initial values
  const nameField = AtomSchema.makeInitial(NameSchema, "Alice");
  const ageField = AtomSchema.makeInitial(AgeSchema, 30);

  // Debug: trace the age field to log changes
  const tracedAge = AtomLogger.tracedWritable(ageField.input, "age-input");

  // Derive a summary using Atom.map
  const summary = Atom.make((get) => {
    const name = get(nameField.input as Atom.Atom<string>);
    const ageVal = get(ageField.value);
    const age = Option.isSome(ageVal) ? ageVal.value : "?";
    return `${name} (age: ${age})`;
  });

  const [summaryText, setSummaryText] = createSignal(
    Effect.runSync(Atom.get(summary))
  );
  const unsub = Atom.subscribe(summary, (v) => setSummaryText(v));
  onCleanup(unsub);

  return (
    <main>
      <h1>Schema Form Validation</h1>
      <p>Form fields validated with Effect Schema + AtomSchema.</p>

      <StringField label="Name" field={nameField} />
      <IntField label="Age" field={ageField} />

      <div class="result">
        Summary: {summaryText()}
      </div>

      <div style="margin-top: 1rem">
        <button onClick={() => { nameField.reset(); ageField.reset(); }}>
          Reset All
        </button>
        <button onClick={() => {
          const snap = Effect.runSync(
            AtomLogger.snapshot([
              ["name", nameField.input as Atom.Atom<string>],
              ["age", ageField.input as Atom.Atom<number>],
              ["ageValid", ageField.isValid],
            ])
          );
          console.log("Form snapshot:", snap);
        }}>
          Log Snapshot
        </button>
      </div>
    </main>
  );
}
