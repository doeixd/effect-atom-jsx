/**
 * reactive.test.ts — Unit tests for the synchronous reactive core.
 *
 * Tests are grouped by primitive and cover: basic behaviour, dependency
 * tracking, cleanup ordering, batching, untracked reads, memo caching,
 * and owner/disposal semantics.
 *
 * No DOM, no Effect-TS required — pure synchronous reactive graph.
 */

import { describe, it, expect, vi } from "vitest";
import { Signal } from "../signal.js";
import { Computation, Memo } from "../computation.js";
import { Owner, getOwner, runWithOwner } from "../owner.js";
import { runUntracked, runBatch } from "../tracking.js";
import {
  createSignal,
  createEffect,
  createMemo,
  createRoot,
  createContext,
  useContext,
  onCleanup,
  onMount,
  untrack,
  batch,
  mergeProps,
  splitProps,
} from "../api.js";

// ─── Signal ───────────────────────────────────────────────────────────────────

describe("Signal", () => {
  it("reads initial value", () => {
    const s = new Signal(42);
    expect(s.get()).toBe(42);
    expect(s.peek()).toBe(42);
  });

  it("set with a plain value", () => {
    const s = new Signal(0);
    s.set(7);
    expect(s.get()).toBe(7);
  });

  it("set with an updater function", () => {
    const s = new Signal(3);
    s.set((n) => n * 4);
    expect(s.get()).toBe(12);
  });

  it("does not notify subscribers when value is unchanged (===)", () => {
    const s = new Signal(1);
    const runs: number[] = [];
    createRoot(() => createEffect(() => { runs.push(s.get()); }));
    expect(runs).toEqual([1]);
    s.set(1); // same reference — no re-run
    expect(runs).toEqual([1]);
  });

  it("notifies subscribers when value changes", () => {
    const s = new Signal("a");
    const seen: string[] = [];
    createRoot(() => createEffect(() => { seen.push(s.get()); }));
    expect(seen).toEqual(["a"]);
    s.set("b");
    expect(seen).toEqual(["a", "b"]);
    s.set("c");
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("custom equals function suppresses notification when it returns true", () => {
    // Treat all even numbers as equal to each other.
    const s = new Signal(2, (a, b) => a % 2 === b % 2);
    const runs: number[] = [];
    createRoot(() => createEffect(() => { runs.push(s.get()); }));
    s.set(4); // 4 % 2 === 2 % 2 — no notification
    expect(runs).toHaveLength(1);
    s.set(3); // odd vs even — notifies
    expect(runs).toHaveLength(2);
  });

  it("forceSet notifies even when value is ===", () => {
    const obj = { count: 0 };
    const s = new Signal(obj);
    const runs: number[] = [];
    createRoot(() => createEffect(() => { s.get(); runs.push(1); }));
    expect(runs).toHaveLength(1);
    s.forceSet(obj); // same reference, but forceSet bypasses equals
    expect(runs).toHaveLength(2);
  });

  it("peek reads without registering a dependency", () => {
    const s = new Signal(0);
    let computeRuns = 0;
    createRoot(() => createEffect(() => {
      computeRuns++;
      s.peek(); // read without tracking
    }));
    expect(computeRuns).toBe(1);
    s.set(99);
    expect(computeRuns).toBe(1); // NOT re-run
  });
});

// ─── createSignal ─────────────────────────────────────────────────────────────

describe("createSignal", () => {
  it("returns [read, write] tuple", () => {
    const [read, write] = createSignal("hello");
    expect(read()).toBe("hello");
    write("world");
    expect(read()).toBe("world");
  });

  it("write with updater function", () => {
    const [n, setN] = createSignal(5);
    setN((x) => x * 2);
    expect(n()).toBe(10);
  });

  it("equals: false always notifies", () => {
    const [n, setN] = createSignal(1, { equals: false });
    let runs = 0;
    createRoot(() => createEffect(() => { n(); runs++; }));
    setN(1); // same value but equals:false
    expect(runs).toBe(2);
  });
});

// ─── createEffect ─────────────────────────────────────────────────────────────

describe("createEffect", () => {
  it("runs immediately", () => {
    let ran = false;
    createRoot(() => createEffect(() => { ran = true; }));
    expect(ran).toBe(true);
  });

  it("re-runs when a tracked signal changes", () => {
    const [x, setX] = createSignal(1);
    const log: number[] = [];
    createRoot(() => createEffect(() => log.push(x())));
    setX(2); setX(3);
    expect(log).toEqual([1, 2, 3]);
  });

  it("does not re-run when an unread signal changes", () => {
    const [a] = createSignal(0);
    const [b, setB] = createSignal(0);
    let runs = 0;
    createRoot(() => createEffect(() => { a(); runs++; })); // only reads `a`
    setB(1); // `b` not tracked
    expect(runs).toBe(1);
  });

  it("drops stale dependencies after branching", () => {
    const [flag, setFlag] = createSignal(true);
    const [a, setA] = createSignal("A");
    const [b, setB] = createSignal("B");
    const log: string[] = [];
    createRoot(() =>
      createEffect(() => log.push(flag() ? a() : b()))
    );
    expect(log).toEqual(["A"]);
    setFlag(false); // now tracks b, not a
    expect(log).toEqual(["A", "B"]);
    setA("A2"); // `a` is no longer a dep
    expect(log).toEqual(["A", "B"]); // no re-run
    setB("B2");
    expect(log).toEqual(["A", "B", "B2"]);
  });

  it("passes the previous return value as argument on re-run", () => {
    const [n, setN] = createSignal(1);
    const history: (number | undefined)[] = [];
    createRoot(() =>
      createEffect<number>((prev) => {
        history.push(prev);
        return n();
      })
    );
    setN(2);
    expect(history).toEqual([undefined, 1]);
  });

  it("does not track reads inside untrack()", () => {
    const [x, setX] = createSignal(0);
    let runs = 0;
    createRoot(() => createEffect(() => {
      runs++;
      untrack(() => x()); // read without tracking
    }));
    setX(1);
    expect(runs).toBe(1); // no re-run
  });
});

// ─── onCleanup ────────────────────────────────────────────────────────────────

describe("onCleanup", () => {
  it("fires before the next effect execution", () => {
    const [n, setN] = createSignal(0);
    const log: string[] = [];
    createRoot(() =>
      createEffect(() => {
        const v = n();
        log.push(`run:${v}`);
        onCleanup(() => log.push(`cleanup:${v}`));
      })
    );
    setN(1);
    setN(2);
    expect(log).toEqual([
      "run:0",
      "cleanup:0", "run:1",
      "cleanup:1", "run:2",
    ]);
  });

  it("fires on owner disposal", () => {
    let cleaned = false;
    const dispose = createRoot((d) => {
      onCleanup(() => { cleaned = true; });
      return d;
    });
    expect(cleaned).toBe(false);
    dispose();
    expect(cleaned).toBe(true);
  });

  it("fires cleanups in LIFO order", () => {
    const order: number[] = [];
    const dispose = createRoot((d) => {
      onCleanup(() => order.push(1));
      onCleanup(() => order.push(2));
      onCleanup(() => order.push(3));
      return d;
    });
    dispose();
    expect(order).toEqual([3, 2, 1]);
  });
});

// ─── createMemo ───────────────────────────────────────────────────────────────

describe("createMemo", () => {
  it("computes derived value from deps", () => {
    const [a] = createSignal(3);
    const [b] = createSignal(4);
    const sum = createMemo(() => a() + b());
    expect(sum()).toBe(7);
  });

  it("updates when a dep changes", () => {
    const [x, setX] = createSignal(2);
    const doubled = createMemo(() => x() * 2);
    setX(5);
    expect(doubled()).toBe(10);
  });

  it("does NOT notify downstream when value is unchanged", () => {
    const [n, setN] = createSignal(2);
    let memoRuns = 0;
    const isEven = createMemo(() => { memoRuns++; return n() % 2 === 0; });

    let effectRuns = 0;
    createRoot(() => createEffect(() => { isEven(); effectRuns++; }));

    // Memo re-runs but produces the same value (true) → downstream doesn't fire.
    setN(4);
    expect(memoRuns).toBe(2);    // memo ran twice
    expect(effectRuns).toBe(1);  // effect ran only once (initial)

    // Now the value actually changes.
    setN(3);
    expect(effectRuns).toBe(2);  // effect ran again
  });

  it("memos can depend on other memos", () => {
    const [x, setX] = createSignal(1);
    const doubled = createMemo(() => x() * 2);
    const quadrupled = createMemo(() => doubled() * 2);
    expect(quadrupled()).toBe(4);
    setX(3);
    expect(quadrupled()).toBe(12);
  });

  it("custom equals suppresses re-notification", () => {
    const [x, setX] = createSignal(1);
    // Round to nearest 10 — changes within a band don't notify.
    const rounded = createMemo(() => Math.round(x() / 10) * 10, { equals: (a, b) => a === b });
    let downstream = 0;
    createRoot(() => createEffect(() => { rounded(); downstream++; }));
    setX(3); // rounds to 0 — same as before
    expect(downstream).toBe(1); // no re-run
    setX(8); // rounds to 10 — changed
    expect(downstream).toBe(2);
  });
});

// ─── batch ────────────────────────────────────────────────────────────────────

describe("batch", () => {
  it("defers notifications until the batch completes", () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const snapshots: [number, number][] = [];
    createRoot(() => createEffect(() => snapshots.push([a(), b()])));
    expect(snapshots).toEqual([[0, 0]]);

    batch(() => {
      setA(1);
      setB(2);
    });
    // Only one re-run after the batch, not one per write.
    expect(snapshots).toEqual([[0, 0], [1, 2]]);
  });

  it("returns the value of the batched function", () => {
    const result = batch(() => 42);
    expect(result).toBe(42);
  });

  it("nested batches flush only at the outermost", () => {
    const [x, setX] = createSignal(0);
    const log: number[] = [];
    createRoot(() => createEffect(() => log.push(x())));

    batch(() => {
      batch(() => {
        setX(1);
        setX(2);
      });
      // Inner batch ends — but outer is still open, no flush yet.
      expect(log).toEqual([0]);
      setX(3);
    });
    // Outermost ends — single flush with final value.
    expect(log).toEqual([0, 3]);
  });
});

// ─── createRoot / disposal ────────────────────────────────────────────────────

describe("createRoot", () => {
  it("disposes child effects when dispose() is called", () => {
    const [x, setX] = createSignal(0);
    const log: number[] = [];
    const dispose = createRoot((d) => {
      createEffect(() => log.push(x()));
      return d;
    });
    setX(1);
    expect(log).toEqual([0, 1]);
    dispose();
    setX(2);
    expect(log).toEqual([0, 1]); // no more updates
  });

  it("nested roots are independently disposable", () => {
    const [x, setX] = createSignal(0);
    const outer: number[] = [];
    const inner: number[] = [];
    let disposeInner!: () => void;

    const disposeOuter = createRoot((d) => {
      createEffect(() => outer.push(x()));
      disposeInner = createRoot((d2) => {
        createEffect(() => inner.push(x()));
        return d2;
      });
      return d;
    });

    setX(1);
    expect(outer).toEqual([0, 1]);
    expect(inner).toEqual([0, 1]);

    disposeInner();
    setX(2);
    expect(outer).toEqual([0, 1, 2]); // outer still alive
    expect(inner).toEqual([0, 1]);     // inner stopped

    disposeOuter();
    setX(3);
    expect(outer).toEqual([0, 1, 2]); // both stopped
  });
});

// ─── Owner / getOwner ─────────────────────────────────────────────────────────

describe("getOwner / runWithOwner", () => {
  it("getOwner returns null outside a root", () => {
    // Runs at module level — no owner.
    expect(getOwner()).toBeNull();
  });

  it("getOwner returns the current owner inside createRoot", () => {
    let captured: Owner | null = null;
    createRoot(() => { captured = getOwner(); });
    expect(captured).not.toBeNull();
  });

  it("runWithOwner restores the previous owner after fn returns", () => {
    const owner = new Owner();
    let inside: Owner | null = null;
    const before = getOwner();
    runWithOwner(owner, () => { inside = getOwner(); });
    expect(inside).toBe(owner);
    expect(getOwner()).toBe(before);
  });
});

// ─── createContext / useContext ───────────────────────────────────────────────

describe("createContext / useContext", () => {
  it("returns the default value when no provider is found", () => {
    const ctx = createContext(42);
    let captured = 0;
    createRoot(() => { captured = useContext(ctx); });
    expect(captured).toBe(42);
  });

  it("returns the provided value inside a Provider", () => {
    const ctx = createContext(0);
    let value = -1;
    createRoot(() => {
      ctx.Provider({ value: 99, children: undefined });
      value = useContext(ctx);
    });
    expect(value).toBe(99);
  });

  it("child owners inherit context from ancestor owners", () => {
    const ctx = createContext("default");
    let inner = "";
    createRoot(() => {
      ctx.Provider({ value: "provided", children: undefined });
      // Nested root shares the parent owner chain.
      createRoot(() => {
        inner = useContext(ctx);
      });
    });
    expect(inner).toBe("provided");
  });
});

// ─── mergeProps ───────────────────────────────────────────────────────────────

describe("mergeProps", () => {
  it("merges multiple plain objects left-to-right (last wins)", () => {
    const merged = mergeProps({ a: 1, b: 2 } as Record<string, number>, { b: 3, c: 4 });
    expect(merged.a).toBe(1);
    expect(merged.b).toBe(3);
    expect(merged.c).toBe(4);
  });

  it("preserves getters reactively", () => {
    const [n, setN] = createSignal(5);
    const base = { get count() { return n(); } };
    const merged = mergeProps(base);
    expect(merged.count).toBe(5);
    setN(10);
    expect(merged.count).toBe(10);
  });

  it("skips null / undefined sources", () => {
    const merged = mergeProps({ a: 1 } as Record<string, unknown>, null as unknown as {}, { b: 2 });
    expect(merged.a).toBe(1);
    expect(merged.b).toBe(2);
  });
});

// ─── splitProps ───────────────────────────────────────────────────────────────

describe("splitProps", () => {
  it("partitions props into two objects", () => {
    const props = { a: 1, b: 2, c: 3, d: 4 } as Record<string, number>;
    const [left, right] = splitProps(props, ["a", "c"] as ("a" | "c")[]);
    expect(left.a).toBe(1);
    expect(left.c).toBe(3);
    expect((right as Record<string, number>).b).toBe(2);
    expect((right as Record<string, number>).d).toBe(4);
  });

  it("preserves getters in both halves", () => {
    const [n] = createSignal(7);
    const props = { get val() { return n(); }, other: "x" };
    const [left] = splitProps(props, ["val"]);
    expect(left.val).toBe(7);
  });
});

// ─── Owner parent chain ───────────────────────────────────────────────────────

describe("Owner.parent", () => {
  it("exposes the parent owner", () => {
    const parent = new Owner();
    const child = new Owner(parent);
    expect(child.parent).toBe(parent);
  });

  it("parent becomes null after disposal", () => {
    const parent = new Owner();
    const child = new Owner(parent);
    child.dispose();
    expect(child.parent).toBeNull();
  });
});

// ─── Computation ─────────────────────────────────────────────────────────────

describe("Computation", () => {
  it("runs immediately on construction", () => {
    let ran = false;
    createRoot(() => new Computation(() => { ran = true; }));
    expect(ran).toBe(true);
  });

  it("stops reacting after the owner is disposed", () => {
    const s = new Signal(0);
    let count = 0;
    const owner = new Owner();
    runWithOwner(owner, () => new Computation(() => { s.get(); count++; }));
    s.set(1);
    expect(count).toBe(2);
    owner.dispose();
    s.set(2);
    expect(count).toBe(2); // disposed
  });
});

// ─── Memo ────────────────────────────────────────────────────────────────────

describe("Memo class", () => {
  it("is initialised on construction (no circular-dep error)", () => {
    const s = new Signal(3);
    const m = new Memo(() => s.get() * 2);
    expect(m.get()).toBe(6);
  });

  it("updates lazily when dep changes", () => {
    const s = new Signal(1);
    const m = new Memo(() => s.get() + 100);
    s.set(9);
    expect(m.get()).toBe(109);
  });
});
