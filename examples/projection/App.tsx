import { Atom, Registry, Async } from "effect-atom-jsx";
import { Effect, Layer } from "effect";

const registry = Registry.make();
const runtime = Atom.runtime(Layer.empty);

const selectedId = Atom.make<string>("a");

const selectedMap = Atom.projection<Record<string, boolean>>(
  (draft: Record<string, boolean>, get) => {
    const id = get(selectedId);
    for (const key of Object.keys(draft)) {
      delete draft[key];
    }
    draft[id] = true;
  },
  {},
);

const multiplier = Atom.make<number>(2);
const stats = Atom.projection<{ value: number; history: number[] }>(
  (draft: { value: number; history: number[] }, get) => {
    const n = get(multiplier);
    draft.value = n * 10;
    draft.history.push(draft.value);
  },
  { value: 0, history: [] },
);

const users = Atom.projectionAsync<Array<{ id: string; name: string }>, never>(
  (_draft: Array<{ id: string; name: string }>, get) =>
    Effect.sync(() => {
      const id = get(selectedId);
      return [
        { id: "a", name: `Ada (${id})` },
        { id: "b", name: "Grace" },
      ];
    }),
  [] as Array<{ id: string; name: string }>,
  { key: "id", runtime: runtime.managed },
);

function setId(id: string) {
  Effect.runSync(Atom.set(selectedId, id));
}

function bumpMultiplier() {
  Effect.runSync(Atom.update(multiplier, (n) => n + 1));
}

export function App() {
  const selected = registry.get(selectedMap);
  const state = registry.get(stats);
  const asyncUsers = registry.get(users);

  return (
    <main>
      <h1>Projection Demo</h1>

      <section>
        <h2>Atom.projection (draft mutation)</h2>
        <p>Selected map: <code>{JSON.stringify(selected)}</code></p>
        <button onClick={() => setId("a")}>Select A</button>
        <button onClick={() => setId("b")}>Select B</button>
      </section>

      <section>
        <h2>Atom.projection (stateful cache)</h2>
        <p>value={state.value} history={state.history.join(", ")}</p>
        <button onClick={bumpMultiplier}>Bump multiplier</button>
      </section>

      <section>
        <h2>Atom.projectionAsync + Async</h2>
        <Async
          result={asyncUsers}
          loading={() => <p>Loading users...</p>}
          error={(e) => <p style="color:red">Error: {String(e)}</p>}
          success={(rows) => (
            <ul>
              {rows.map((u) => <li>{u.id}: {u.name}</li>)}
            </ul>
          )}
        />
      </section>
    </main>
  );
}
