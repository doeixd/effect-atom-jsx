/**
 * Counter — callable-atom example.
 */
import { Atom } from "effect-atom-jsx";
import { AsyncUserCard } from "./AsyncExample.js";

function LocalCounter() {
  const count = Atom.make<number>(0);
  const doubled = Atom.map(count, (n: number) => n * 2);
  const parity = Atom.map(count, (n: number) => (n % 2 === 0 ? "even" : "odd"));

  return (
    <div class="counter">
      <h2>Local Atom Counter</h2>
      <p>
        Count: <strong>{count()}</strong>
        {" "}- doubled: <strong>{doubled()}</strong>
        {" "}- <em>{parity()}</em>
      </p>
      <button onClick={() => count.update((n: number) => n - 1)}>−</button>
      <button onClick={() => count.set(0)}>Reset</button>
      <button onClick={() => count.update((n: number) => n + 1)}>+</button>
      <button onClick={() => {
        count.set(10);
        count.update((n: number) => n + 5);
      }}>
        Batch → 15
      </button>
    </div>
  );
}

const sharedCount = Atom.make<number>(0);
const sharedDoubled = Atom.map(sharedCount, (n: number) => n * 2);

function SharedCounter() {
  return (
    <div class="counter">
      <h2>Shared Atom Counter</h2>
      <p>
        Count: <strong>{sharedCount()}</strong>
        {" "}- doubled: <strong>{sharedDoubled()}</strong>
      </p>
      <button onClick={() => sharedCount.update((n: number) => n - 1)}>−</button>
      <button onClick={() => sharedCount.set(0)}>Reset</button>
      <button onClick={() => sharedCount.update((n: number) => n + 1)}>+</button>
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
