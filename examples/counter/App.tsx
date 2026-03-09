/**
 * Counter — minimal example demonstrating the effect-atom-jsx API.
 *
 * Components are plain functions that run once. Reactive state is created
 * with createSignal / createAtom. JSX expressions that reference signals are
 * automatically wrapped in effects by the babel plugin and update surgically
 * — only the specific DOM node that reads the changed signal re-renders.
 */
import {
  createSignal,
  createMemo,
  createAtom,
  Atom,
  Registry,
  batch,
  onCleanup,
} from "effect-atom-jsx";
import { AsyncUserCard } from "./AsyncExample.js";

// ─── Plain signal API ─────────────────────────────────────────────────────────

function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);
  const isEven = createMemo(() => count() % 2 === 0);

  // onCleanup runs when this component is removed from the DOM.
  onCleanup(() => console.log("Counter unmounted"));

  return (
    <div class="counter">
      <h2>Signal Counter</h2>
      <p>
        Count: <strong>{count()}</strong>
        {" "}— doubled: <strong>{doubled()}</strong>
        {" "}— <em>{isEven() ? "even" : "odd"}</em>
      </p>
      <button onClick={() => setCount((c) => c - 1)}>−</button>
      <button onClick={() => setCount(0)}>Reset</button>
      <button onClick={() => setCount((c) => c + 1)}>+</button>
      <button onClick={() => batch(() => { setCount(10); setCount((c) => c + 5); })}>
        Batch → 15
      </button>
    </div>
  );
}

// ─── Atom API ─────────────────────────────────────────────────────────────────

const globalCount = createAtom(0);
const globalDoubled = createAtom((get) => get(globalCount) * 2);

function AtomCounter() {
  return (
    <div class="counter">
      <h2>Atom Counter (shared global state)</h2>
      <p>
        Count: <strong>{globalCount.get()}</strong>
        {" "}— doubled: <strong>{globalDoubled.get()}</strong>
      </p>
      <button onClick={() => globalCount.update((c) => c - 1)}>−</button>
      <button onClick={() => globalCount.set(0)}>Reset</button>
      <button onClick={() => globalCount.update((c) => c + 1)}>+</button>
    </div>
  );
}

// ─── Effect-atom style namespace API ──────────────────────────────────────────

const atomCount = Atom.make(0);
const atomDoubled = Atom.map(atomCount, (n) => n * 2);
const atomRegistry = Registry.make();

function EffectAtomStyleCounter() {
  const [count, setCount] = createSignal(atomRegistry.get(atomCount));
  const [doubled, setDoubled] = createSignal(atomRegistry.get(atomDoubled));

  const unsubCount = atomRegistry.subscribe(atomCount, setCount);
  const unsubDoubled = atomRegistry.subscribe(atomDoubled, setDoubled);

  onCleanup(() => {
    unsubCount();
    unsubDoubled();
  });

  return (
    <div class="counter">
      <h2>Effect-Atom Style (Atom/Registry)</h2>
      <p>
        Count: <strong>{count()}</strong>
        {" "}- doubled: <strong>{doubled()}</strong>
      </p>
      <button onClick={() => atomRegistry.update(atomCount, (n) => n - 1)}>−</button>
      <button onClick={() => atomRegistry.set(atomCount, 0)}>Reset</button>
      <button onClick={() => atomRegistry.update(atomCount, (n) => n + 1)}>+</button>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

export function App() {
  return (
    <main>
      <h1>effect-atom-jsx</h1>
      <p>Fine-grained reactivity powered by Effect-TS primitives.</p>
      <Counter />
      <AtomCounter />
      <EffectAtomStyleCounter />
      {/* Two instances share the same globalCount atom */}
      <AtomCounter />
      <AsyncUserCard />
    </main>
  );
}
