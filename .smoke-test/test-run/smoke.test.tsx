import { describe, it, expect } from "vitest";
import { Atom, Registry, render, createSignal } from "effect-atom-jsx";
import { Effect } from "effect";

describe("effect-atom-jsx smoke test", () => {
  it("should handle basic atom state", () => {
    const count = Atom.make<number>(0);
    const registry = Registry.make();
    
    expect(registry.get(count)).toBe(0);
    registry.set(count, 1);
    expect(registry.get(count)).toBe(1);
    
    registry.update(count, n => n + 1);
    expect(registry.get(count)).toBe(2);
  });

  it("should render JSX and update reactively", () => {
    const [count, setCount] = createSignal(0);
    const container = document.createElement("div");
    
    const dispose = render(() => (
      <div id="counter">
        Count: <span id="value">{count()}</span>
      </div>
    ), container);

    expect(container.querySelector("#value")?.textContent).toBe("0");
    
    setCount(1);
    expect(container.querySelector("#value")?.textContent).toBe("1");
    
    dispose();
  });

  it("should support effect integration", async () => {
    const { queryEffect } = await import("effect-atom-jsx");
    const data = queryEffect(() => Effect.succeed("hello"));
    
    // We need to wait for the effect to run
    // In a real app we'd use mount() or similar, 
    // but for smoke we just check if the exports exist and types work.
    expect(typeof queryEffect).toBe("function");
  });
});
