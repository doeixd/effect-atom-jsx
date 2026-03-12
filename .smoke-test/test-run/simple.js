import { Atom, Registry } from "effect-atom-jsx";

const count = Atom.make(42);
const registry = Registry.make();

console.log("Initial count:", registry.get(count));
registry.set(count, 100);
console.log("Updated count:", registry.get(count));

if (registry.get(count) === 100) {
  console.log("SMOKE TEST PASSED (sync state)");
} else {
  console.log("SMOKE TEST FAILED");
  process.exit(1);
}
