import { JSDOM } from "jsdom";
const jsdom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
global.window = jsdom.window;
global.document = jsdom.window.document;
global.Node = jsdom.window.Node;
global.Element = jsdom.window.Element;
global.HTMLElement = jsdom.window.HTMLElement;

import { Atom, Registry, render, createSignal } from "effect-atom-jsx";
import { SmokeComponent } from "./Component.js";

console.log("--- Starting Manual ESM Smoke Test ---");

// Test 1: Atoms
try {
  const count = Atom.make(0);
  const registry = Registry.make();
  if (registry.get(count) !== 0) throw new Error("Initial value wrong");
  registry.set(count, 1);
  if (registry.get(count) !== 1) throw new Error("Updated value wrong");
  console.log("Test 1 (Atoms) PASSED");
} catch (e) {
  console.error("Test 1 (Atoms) FAILED:", e.message);
  process.exit(1);
}

// Test 2: JSX
try {
  const [count, setCount] = createSignal(0);
  const container = document.createElement("div");
  
  render(() => SmokeComponent({ count }), container);
  
  if (container.textContent.trim() !== "Count: 0") {
    throw new Error("Initial render wrong: " + container.textContent);
  }
  
  setCount(1);
  
  if (container.textContent.trim() !== "Count: 1") {
    throw new Error("Reactive update wrong: " + container.textContent);
  }
  
  console.log("Test 2 (JSX) PASSED");
} catch (e) {
  console.error("Test 2 (JSX) FAILED:", e);
  process.exit(1);
}

console.log("--- ALL SMOKE TESTS PASSED ---");
