/**
 * Schema Form — AtomSchema with Atom/Registry rendering.
 */
import { Schema, Effect, Option } from "effect";
import { Atom, AtomSchema, AtomLogger, Registry } from "effect-atom-jsx";

const AgeSchema = Schema.Int;
const NameSchema = Schema.String;

const ui = Registry.make();

function IntField(props: {
  label: string;
  field: AtomSchema.ValidatedAtom<number, number>;
}) {
  return (
    <div class={`form-field ${ui.get(props.field.isValid) ? "valid" : ui.get(props.field.touched) ? "invalid" : ""}`}>
      <label>{props.label}</label>
      <input
        type="number"
        value={ui.get(props.field.input)}
        onInput={(e: Event) => {
          const raw = Number((e.currentTarget as HTMLInputElement).value);
          ui.set(props.field.input, raw);
        }}
      />
      {ui.get(props.field.touched) && !ui.get(props.field.isValid) ? <div class="error">Must be a whole number</div> : null}
      <div class="meta">
        <span>touched: {ui.get(props.field.touched) ? "yes" : "no"}</span>
        <span>dirty: {ui.get(props.field.dirty) ? "yes" : "no"}</span>
        <span>valid: {ui.get(props.field.isValid) ? "yes" : "no"}</span>
      </div>
    </div>
  );
}

function StringField(props: {
  label: string;
  field: AtomSchema.ValidatedAtom<string, string>;
}) {
  return (
    <div class={`form-field ${ui.get(props.field.dirty) ? "valid" : ""}`}>
      <label>{props.label}</label>
      <input
        type="text"
        value={ui.get(props.field.input)}
        onInput={(e: Event) => {
          ui.set(props.field.input, (e.currentTarget as HTMLInputElement).value);
        }}
      />
      <div class="meta">
        <span>touched: {ui.get(props.field.touched) ? "yes" : "no"}</span>
        <span>dirty: {ui.get(props.field.dirty) ? "yes" : "no"}</span>
      </div>
    </div>
  );
}

export function App() {
  const nameField = AtomSchema.makeInitial(NameSchema, "Alice");
  const ageField = AtomSchema.makeInitial(AgeSchema, 30);

  const tracedAge = AtomLogger.tracedWritable(ageField.input, "age-input");

  const summary = Atom.make((get) => {
    const name = get(nameField.input as Atom.Atom<string>);
    const ageVal = get(ageField.value);
    const age = Option.isSome(ageVal) ? ageVal.value : "?";
    return `${name} (age: ${age})`;
  });

  return (
    <main>
      <h1>Schema Form Validation</h1>
      <p>Form fields validated with Effect Schema + AtomSchema.</p>

      <StringField label="Name" field={nameField} />
      <IntField label="Age" field={ageField} />

      <div class="result">
        Summary: {ui.get(summary)}
      </div>

      <div style="margin-top: 1rem">
        <button onClick={() => { nameField.reset(); ageField.reset(); }}>
          Reset All
        </button>
        <button onClick={() => {
          const snap = Effect.runSync(
            AtomLogger.snapshot([
              ["name", nameField.input as Atom.Atom<string>],
              ["age", tracedAge],
              ["ageValid", ageField.isValid],
            ]),
          );
          console.log("Form snapshot:", snap);
        }}>
          Log Snapshot
        </button>
      </div>
    </main>
  );
}
