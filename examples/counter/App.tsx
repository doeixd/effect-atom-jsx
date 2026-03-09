/**
 * Counter — Atom/Registry-first example.
 */
import { Atom, Registry } from "effect-atom-jsx";
import { AsyncUserCard } from "./AsyncExample.js";

function LocalCounter() {
  const registry = Registry.make();
  const count = Atom.make<number>(0);
  const doubled = Atom.map(count, (n) => n * 2);
  const parity = Atom.map(count, (n) => (n % 2 === 0 ? "even" : "odd"));

  return (
    <div class="counter">
      <h2>Local Atom Counter</h2>
      <p>
        Count: <strong>{registry.get(count)}</strong>
        {" "}- doubled: <strong>{registry.get(doubled)}</strong>
        {" "}- <em>{registry.get(parity)}</em>
      </p>
      <button onClick={() => registry.update(count, (n) => n - 1)}>−</button>
      <button onClick={() => registry.set(count, 0)}>Reset</button>
      <button onClick={() => registry.update(count, (n) => n + 1)}>+</button>
      <button onClick={() => Atom.batch(() => {
        registry.set(count, 10);
        registry.update(count, (n) => n + 5);
      })}>
        Batch → 15
      </button>
    </div>
  );
}

const sharedRegistry = Registry.make();
const sharedCount = Atom.make<number>(0);
const sharedDoubled = Atom.map(sharedCount, (n) => n * 2);

function SharedCounter() {
  return (
    <div class="counter">
      <h2>Shared Atom Counter</h2>
      <p>
        Count: <strong>{sharedRegistry.get(sharedCount)}</strong>
        {" "}- doubled: <strong>{sharedRegistry.get(sharedDoubled)}</strong>
      </p>
      <button onClick={() => sharedRegistry.update(sharedCount, (n) => n - 1)}>−</button>
      <button onClick={() => sharedRegistry.set(sharedCount, 0)}>Reset</button>
      <button onClick={() => sharedRegistry.update(sharedCount, (n) => n + 1)}>+</button>
    </div>
  );
}

export function App() {
  return (
    <main>
      <h1>effect-atom-jsx</h1>
      <p>Fine-grained reactivity powered by Atom and Registry.</p>
      <LocalCounter />
      <SharedCounter />
      <SharedCounter />
      <AsyncUserCard />
    </main>
  );
}
