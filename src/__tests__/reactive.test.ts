/**
 * Reactive core unit tests.
 * Run with: node --experimental-vm-modules node_modules/.bin/jest
 * (or via `npm test`)
 */

// We import from source; Jest is configured to transform TS via babel.
import { Signal } from "../signal.js";
import { Computation, Memo } from "../computation.js";
import { Owner, getOwner, runWithOwner } from "../owner.js";
import { runUntracked, runBatch } from "../tracking.js";
import {
  createSignal,
  createEffect,
  createMemo,
  createRoot,
  onCleanup,
  batch,
  untrack,
  mergeProps,
  splitProps,
} from "../api.js";

// ─── Signal ───────────────────────────────────────────────────────────────────

describe("Signal", () => {
  test("reads initial value", () => {
    const s = new Signal(42);
    expect(s.get()).toBe(42);
    expect(s.peek()).toBe(42);
  });

  test("set with value", () => {
    const s = new Signal(0);
    s.set(5);
    expect(s.get()).toBe(5);
  });

  test("set with updater function", () => {
    const s = new Signal(10);
    s.set((n) => n * 2);
    expect(s.get()).toBe(20);
  });

  test("does not notify when value is same (===)", () => {
    const s = new Signal(1);
    let runs = 0;
    new Computation(() => { s.get(); runs++; });
    const before = runs;
    s.set(1); // same value
    expect(runs).toBe(before); // no re-run
  });

  test("notifies when value changes", () => {
    const s = new Signal(1);
    let runs = 0;
    new Computation(() => { s.get(); runs++; });
    expect(runs).toBe(1); // initial run
    s.set(2);
    expect(runs).toBe(2);
  });
});

// ─── createSignal ─────────────────────────────────────────────────────────────

describe("createSignal", () => {
  test("returns [read, write] tuple", () => {
    const [read, write] = createSignal(0);
    expect(typeof read).toBe("function");
    expect(typeof write).toBe("function");
    expect(read()).toBe(0);
  });

  test("write triggers re-computation", () => {
    const [count, setCount] = createSignal(0);
    const log: number[] = [];
    createRoot(() => {
      createEffect(() => log.push(count()));
    });
    expect(log).toEqual([0]);
    setCount(1);
    expect(log).toEqual([0, 1]);
    setCount(2);
    expect(log).toEqual([0, 1, 2]);
  });
});

// ─── createMemo ───────────────────────────────────────────────────────────────

describe("createMemo", () => {
  test("computes derived value", () => {
    const [count] = createSignal(3);
    const doubled = createMemo(() => count() * 2);
    expect(doubled()).toBe(6);
  });

  test("updates when dependency changes", () => {
    const [count, setCount] = createSignal(1);
    const doubled = createMemo(() => count() * 2);
    expect(doubled()).toBe(2);
    setCount(5);
    expect(doubled()).toBe(10);
  });

  test("does not re-run when result is same", () => {
    const [count, setCount] = createSignal(2);
    let memoRuns = 0;
    const isEven = createMemo(() => { memoRuns++; return count() % 2 === 0; });
    expect(memoRuns).toBe(1);
    setCount(4); // still even — result unchanged
    expect(memoRuns).toBe(2);
    // downstream that reads isEven should NOT re-run since isEven() === true unchanged:
    let downstreamRuns = 0;
    createRoot(() => {
      createEffect(() => { isEven(); downstreamRuns++; });
    });
    const before = downstreamRuns;
    setCount(6); // still even
    expect(downstreamRuns).toBe(before); // no downstream re-run
  });
});

// ─── batch ────────────────────────────────────────────────────────────────────

describe("batch", () => {
  test("defers notifications until end of batch", () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const log: [number, number][] = [];
    createRoot(() => {
      createEffect(() => log.push([a(), b()]));
    });
    expect(log).toEqual([[0, 0]]);

    batch(() => {
      setA(1);
      setB(2);
    });
    // Only one re-run, not two:
    expect(log).toEqual([[0, 0], [1, 2]]);
  });
});

// ─── untrack ──────────────────────────────────────────────────────────────────

describe("untrack", () => {
  test("reads without tracking", () => {
    const [count, setCount] = createSignal(0);
    let runs = 0;
    createRoot(() => {
      createEffect(() => {
        runs++;
        // Read count untracked — should NOT re-run when count changes.
        untrack(() => count());
      });
    });
    expect(runs).toBe(1);
    setCount(99);
    expect(runs).toBe(1); // still 1
  });
});

// ─── Owner / createRoot ───────────────────────────────────────────────────────

describe("createRoot / onCleanup", () => {
  test("dispose tears down effects", () => {
    const [count, setCount] = createSignal(0);
    const log: number[] = [];
    const dispose = createRoot((d) => {
      createEffect(() => log.push(count()));
      return d;
    });
    expect(log).toEqual([0]);
    setCount(1);
    expect(log).toEqual([0, 1]);

    dispose();
    setCount(2);
    // Effect should NOT run after dispose.
    expect(log).toEqual([0, 1]);
  });

  test("onCleanup runs on dispose", () => {
    let cleaned = false;
    const dispose = createRoot((d) => {
      onCleanup(() => { cleaned = true; });
      return d;
    });
    expect(cleaned).toBe(false);
    dispose();
    expect(cleaned).toBe(true);
  });

  test("onCleanup runs before effect re-runs", () => {
    const [count, setCount] = createSignal(0);
    const log: string[] = [];
    createRoot(() => {
      createEffect(() => {
        const c = count();
        log.push(`run:${c}`);
        onCleanup(() => log.push(`cleanup:${c}`));
      });
    });
    expect(log).toEqual(["run:0"]);
    setCount(1);
    expect(log).toEqual(["run:0", "cleanup:0", "run:1"]);
    setCount(2);
    expect(log).toEqual(["run:0", "cleanup:0", "run:1", "cleanup:1", "run:2"]);
  });
});

// ─── mergeProps / splitProps ──────────────────────────────────────────────────

describe("mergeProps", () => {
  test("merges plain objects", () => {
    const merged = mergeProps({ a: 1 }, { b: 2 }, { a: 3 });
    expect(merged.a).toBe(3);
    expect((merged as Record<string, number>).b).toBe(2);
  });

  test("preserves getters", () => {
    const [count] = createSignal(5);
    const merged = mergeProps({ get count() { return count(); } });
    expect(merged.count).toBe(5);
  });
});

describe("splitProps", () => {
  test("splits into two objects", () => {
    const props = { a: 1, b: 2, c: 3 };
    const [left, right] = splitProps(props, ["a", "c"]);
    expect(left.a).toBe(1);
    expect(left.c).toBe(3);
    expect((right as Record<string, number>).b).toBe(2);
  });
});
