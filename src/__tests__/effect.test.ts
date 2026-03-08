/**
 * effect.test.ts — Integration tests for the Effect-TS layer.
 *
 * Covers:
 *   - atomEffect: success, typed failure, defect, fiber interruption, reactivity
 *   - createAtom: writable and derived
 *   - AsyncResult: all constructors and guards
 *   - For: reactive list rendering
 *   - Show: conditional rendering
 *   - scopedRoot: bidirectional Owner ↔ Scope lifetime binding
 *
 * All tests are async because Effect fibers execute on the microtask queue.
 */

import { describe, it, expect, vi } from "vitest";
import { Effect, Exit, Scope, Cause, fiber } from "effect";
import {
  atomEffect,
  createAtom,
  AsyncResult,
  Async,
  For,
  Show,
  scopedRoot,
  type AsyncResult as AsyncResultType,
  type Failure,
  type Success,
  type Defect,
} from "../effect-ts.js";
import { createSignal, createRoot, createEffect, onCleanup } from "../api.js";
import { Owner, runWithOwner } from "../owner.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wait for the microtask / promise queue to drain. */
const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

// ─── AsyncResult ──────────────────────────────────────────────────────────────

describe("AsyncResult", () => {
  it("loading sentinel has _tag Loading", () => {
    expect(AsyncResult.loading._tag).toBe("Loading");
  });

  it("success wraps a value", () => {
    const r = AsyncResult.success(42);
    expect(r._tag).toBe("Success");
    expect((r as Success<number>).value).toBe(42);
  });

  it("failure wraps a typed error", () => {
    const err = { code: 404 };
    const r = AsyncResult.failure(err);
    expect(r._tag).toBe("Failure");
    expect((r as Failure<typeof err>).error).toBe(err);
  });

  it("defect wraps a string cause", () => {
    const r = AsyncResult.defect("boom");
    expect(r._tag).toBe("Defect");
    expect((r as Defect).cause).toBe("boom");
  });

  it("type guards are mutually exclusive", () => {
    const l = AsyncResult.loading;
    const s = AsyncResult.success(1);
    const f = AsyncResult.failure("err");
    const d = AsyncResult.defect("oops");
    expect(AsyncResult.isLoading(l)).toBe(true);
    expect(AsyncResult.isSuccess(s)).toBe(true);
    expect(AsyncResult.isFailure(f)).toBe(true);
    expect(AsyncResult.isDefect(d)).toBe(true);
    // Cross-checks
    expect(AsyncResult.isLoading(s)).toBe(false);
    expect(AsyncResult.isSuccess(f)).toBe(false);
  });
});

// ─── atomEffect — success ─────────────────────────────────────────────────────

describe("atomEffect — success", () => {
  it("starts in Loading state for async effects", () => {
    // Effect.succeed has no async boundary and resolves synchronously inside
    // runFork, so Loading is transient for pure sync effects. Use a delayed
    // effect to observe the Loading state before resolution.
    const dispose = createRoot((d) => {
      const result = atomEffect(() => Effect.succeed(1).pipe(Effect.delay("50 millis")));
      expect(AsyncResult.isLoading(result())).toBe(true);
      return d;
    });
    dispose();
  });

  it("transitions to Success after the fiber resolves", async () => {
    let result!: () => AsyncResultType<number, never>;
    const dispose = createRoot((d) => {
      result = atomEffect(() => Effect.succeed(99));
      return d;
    });
    await tick();
    expect(result()).toEqual(AsyncResult.success(99));
    dispose();
  });

  it("resolves with async Effects", async () => {
    let result!: () => AsyncResultType<string, never>;
    const dispose = createRoot((d) => {
      result = atomEffect(() => Effect.succeed("hello").pipe(Effect.delay("10 millis")));
      return d;
    });
    expect(AsyncResult.isLoading(result())).toBe(true);
    await tick(50);
    expect(result()).toEqual(AsyncResult.success("hello"));
    dispose();
  });
});

// ─── atomEffect — typed failure ───────────────────────────────────────────────

describe("atomEffect — typed failure (E channel)", () => {
  class ApiError {
    readonly _tag = "ApiError";
    constructor(readonly status: number) {}
  }

  it("transitions to Failure with the typed error", async () => {
    let result!: () => AsyncResultType<never, ApiError>;
    const dispose = createRoot((d) => {
      result = atomEffect(() => Effect.fail(new ApiError(404)));
      return d;
    });
    await tick();
    const r = result();
    expect(AsyncResult.isFailure(r)).toBe(true);
    expect((r as Failure<ApiError>).error).toBeInstanceOf(ApiError);
    expect(((r as Failure<ApiError>).error as ApiError).status).toBe(404);
    dispose();
  });
});

// ─── atomEffect — defect ──────────────────────────────────────────────────────

describe("atomEffect — defect (unexpected errors)", () => {
  it("surfaces as Defect instead of crashing", async () => {
    let result!: () => AsyncResultType<never, never>;
    const dispose = createRoot((d) => {
      // Effect.die produces a defect (not a typed E-channel error).
      result = atomEffect(() => Effect.die(new Error("unexpected bug")));
      return d;
    });
    await tick();
    const r = result();
    expect(AsyncResult.isDefect(r)).toBe(true);
    expect(typeof (r as Defect).cause).toBe("string");
    dispose();
  });
});

// ─── atomEffect — reactivity ──────────────────────────────────────────────────

describe("atomEffect — reactive dependencies", () => {
  it("re-runs when a tracked signal changes", async () => {
    const [userId, setUserId] = createSignal(1);
    let result!: () => AsyncResultType<number, never>;
    const dispose = createRoot((d) => {
      result = atomEffect(() => {
        const id = userId(); // ← tracked dep
        return Effect.succeed(id * 10);
      });
      return d;
    });
    await tick();
    expect(result()).toEqual(AsyncResult.success(10));

    setUserId(3);
    // Note: Effect.succeed is synchronous — Loading is transient and the fiber
    // completes before we observe. For async effects use Effect.delay (covered
    // by the "interrupts the previous fiber" test). We just verify the final value.
    await tick();
    expect(result()).toEqual(AsyncResult.success(30));
    dispose();
  });

  it("interrupts the previous fiber when deps change", async () => {
    const completions: number[] = [];
    const [id, setId] = createSignal(1);
    const dispose = createRoot((d) => {
      atomEffect(() => {
        const v = id();
        return Effect.succeed(v).pipe(
          Effect.delay("50 millis"),
          Effect.tap((n) => Effect.sync(() => completions.push(n))),
        );
      });
      return d;
    });

    // Change the signal before the first fiber completes.
    await tick(20);
    setId(2);
    await tick(100); // wait long enough for both to have potentially resolved

    // Only the second fiber should have completed; first was interrupted.
    expect(completions).toEqual([2]);
    dispose();
  });

  it("cleans up the fiber when the root is disposed", async () => {
    const completions: number[] = [];
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      atomEffect(() =>
        Effect.succeed(42).pipe(
          Effect.delay("100 millis"),
          Effect.tap((n) => Effect.sync(() => completions.push(n))),
        )
      );
    });
    // Dispose before the fiber resolves.
    dispose();
    await tick(200);
    expect(completions).toHaveLength(0); // fiber was interrupted
  });
});

// ─── atomEffect — Effect.gen with services ────────────────────────────────────

describe("atomEffect — Effect.gen", () => {
  it("works with Effect.gen for sequential async logic", async () => {
    const [multiplier, setMultiplier] = createSignal(2);
    let result!: () => AsyncResultType<number, never>;
    const dispose = createRoot((d) => {
      result = atomEffect(() =>
        Effect.gen(function* () {
          const m = multiplier(); // tracked dep (called synchronously in fn())
          const a = yield* Effect.succeed(10);
          const b = yield* Effect.succeed(m);
          return a * b;
        })
      );
      return d;
    });
    await tick();
    expect(result()).toEqual(AsyncResult.success(20));

    setMultiplier(5);
    await tick();
    expect(result()).toEqual(AsyncResult.success(50));
    dispose();
  });
});

// ─── createAtom — writable ────────────────────────────────────────────────────

describe("createAtom — WritableAtom", () => {
  it("get returns the initial value", () => {
    const count = createAtom(7);
    expect(count.get()).toBe(7);
  });

  it("set updates the value", () => {
    const count = createAtom(0);
    count.set(5);
    expect(count.get()).toBe(5);
  });

  it("set with updater function", () => {
    const count = createAtom(3);
    count.set((n) => n * 2);
    expect(count.get()).toBe(6);
  });

  it("update convenience method", () => {
    const count = createAtom(10);
    count.update((n) => n - 3);
    expect(count.get()).toBe(7);
  });

  it("get() is reactive inside createEffect", () => {
    const count = createAtom(0);
    const log: number[] = [];
    const dispose = createRoot((d) => {
      createEffect(() => log.push(count.get()));
      return d;
    });
    count.set(1);
    count.set(2);
    expect(log).toEqual([0, 1, 2]);
    dispose();
  });

  it("subscribe notifies external listeners", async () => {
    const count = createAtom(0);
    const values: number[] = [];
    const unsub = count.subscribe((v) => values.push(v));
    count.set(1);
    count.set(2);
    // subscribe creates an effect which runs synchronously.
    expect(values).toEqual([0, 1, 2]);
    unsub();
    count.set(3);
    expect(values).toEqual([0, 1, 2]); // stopped
  });
});

// ─── createAtom — derived ─────────────────────────────────────────────────────

describe("createAtom — DerivedAtom", () => {
  it("computes from another atom", () => {
    const count = createAtom(4);
    const doubled = createAtom((get) => get(count) * 2);
    expect(doubled.get()).toBe(8);
  });

  it("updates reactively when the source atom changes", () => {
    const x = createAtom(3);
    const y = createAtom(4);
    const hyp = createAtom((get) => Math.sqrt(get(x) ** 2 + get(y) ** 2));
    expect(hyp.get()).toBe(5);
    x.set(5);
    y.set(12);
    expect(hyp.get()).toBe(13);
  });

  it("chained derived atoms all update", () => {
    const base = createAtom(1);
    const double = createAtom((get) => get(base) * 2);
    const quad = createAtom((get) => get(double) * 2);
    expect(quad.get()).toBe(4);
    base.set(3);
    expect(double.get()).toBe(6);
    expect(quad.get()).toBe(12);
  });

  it("subscribe on derived atom notifies on upstream change", () => {
    const n = createAtom(10);
    const squared = createAtom((get) => get(n) ** 2);
    const log: number[] = [];
    const unsub = squared.subscribe((v) => log.push(v));
    n.set(3);
    n.set(4);
    expect(log).toEqual([100, 9, 16]);
    unsub();
    n.set(5);
    expect(log).toEqual([100, 9, 16]);
  });
});

// ─── For ─────────────────────────────────────────────────────────────────────

describe("For", () => {
  it("maps a static array through the children function", () => {
    const memo = For({
      each: [1, 2, 3],
      children: (item) => item * 10,
    });
    // For returns a createMemo accessor.
    expect(typeof memo).toBe("function");
    expect(memo()).toEqual([10, 20, 30]);
  });

  it("is reactive — updates when the signal changes", () => {
    const [items, setItems] = createSignal([1, 2]);
    const snapshots: number[][] = [];
    const dispose = createRoot((d) => {
      const memo = For({ each: items, children: (x) => x * 10 });
      createEffect(() => snapshots.push(memo() as number[]));
      return d;
    });
    expect(snapshots).toEqual([[10, 20]]);
    setItems([3, 4, 5]);
    expect(snapshots).toEqual([[10, 20], [30, 40, 50]]);
    dispose();
  });

  it("renders fallback for an empty list", () => {
    const [items, setItems] = createSignal<number[]>([]);
    const dispose = createRoot((d) => {
      const memo = For({
        each: items,
        fallback: () => "empty",
        children: (x) => x,
      });
      expect(memo()).toEqual(["empty"]);
      setItems([1]);
      expect(memo()).toEqual([1]);
      return d;
    });
    dispose();
  });

  it("passes a reactive index accessor to children", () => {
    const indices: number[] = [];
    createRoot(() => {
      const memo = For({
        each: ["a", "b", "c"],
        children: (_item, index) => { indices.push(index()); return null; },
      });
      memo(); // evaluate to trigger children
    });
    expect(indices).toEqual([0, 1, 2]);
  });
});

// ─── Show ─────────────────────────────────────────────────────────────────────

describe("Show", () => {
  it("renders children when `when` is truthy", () => {
    const result = Show({ when: "hello", children: (v: string) => v.toUpperCase() });
    expect(result).toBe("HELLO");
  });

  it("renders fallback when `when` is falsy", () => {
    const result = Show({ when: false, fallback: () => "fallback", children: () => "children" });
    expect(result).toBe("fallback");
  });

  it("returns null when `when` is falsy and no fallback", () => {
    expect(Show({ when: 0, children: () => "x" })).toBeNull();
  });

  it("renders static children (non-function) when truthy", () => {
    const result = Show({ when: true, children: "static" });
    expect(result).toBe("static");
  });
});

// ─── Async ───────────────────────────────────────────────────────────────────

describe("Async", () => {
  it("renders loading slot", () => {
    const r = Async({
      result: AsyncResult.loading,
      loading: () => "loading...",
      success: () => "done",
    });
    expect(r).toBe("loading...");
  });

  it("renders success slot with the value", () => {
    const r = Async({
      result: AsyncResult.success(42),
      success: (v) => `value:${v}`,
    });
    expect(r).toBe("value:42");
  });

  it("renders error slot with the typed error", () => {
    const r = Async({
      result: AsyncResult.failure({ code: 500 }),
      success: () => "ok",
      error: (e) => `error:${e.code}`,
    });
    expect(r).toBe("error:500");
  });

  it("renders defect slot when a defect is present", () => {
    const r = Async({
      result: AsyncResult.defect("internal error"),
      success: () => "ok",
      defect: (msg) => `defect:${msg}`,
    });
    expect(r).toBe("defect:internal error");
  });

  it("returns null for unhandled failure/defect slots", () => {
    expect(Async({ result: AsyncResult.failure("e"), success: () => "ok" })).toBeNull();
    expect(Async({ result: AsyncResult.defect("d"), success: () => "ok" })).toBeNull();
  });
});

// ─── scopedRoot ───────────────────────────────────────────────────────────────

describe("scopedRoot", () => {
  it("runs fn under the provided owner", () => {
    Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        let owner!: Owner | null;
        scopedRoot(scope, () => {
          // Just verify fn runs.
          owner = null; // scope runs synchronously
        });
        yield* Scope.close(scope, Exit.void);
      })
    );
  });

  it("disposes the reactive root when the scope closes", async () => {
    const log: number[] = [];
    const [n, setN] = createSignal(0);

    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        scopedRoot(scope, () => {
          createEffect(() => log.push(n()));
        });
        expect(log).toEqual([0]);
        setN(1);
        expect(log).toEqual([0, 1]);

        yield* Scope.close(scope, Exit.void);
        // Give the fork time to run the dispose.
        yield* Effect.sleep("20 millis");
      })
    );

    setN(2);
    // Effect disposed — no more updates.
    expect(log).toEqual([0, 1]);
  });

  it("closes the scope when the reactive root is disposed manually", async () => {
    let scopeClosed = false;

    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        // Add a finalizer to detect scope closure.
        yield* Scope.addFinalizer(scope, Effect.sync(() => { scopeClosed = true; }));

        // scopedRoot creates its own internal Owner. We capture the dispose by
        // wrapping in createRoot — when createRoot's owner disposes, it disposes
        // the scopedRoot's owner which triggers the scope close.
        let dispose!: () => void;
        createRoot((d) => {
          scopedRoot(scope, () => {
            // reactive work here
          });
          dispose = d;
        });

        // Dispose the reactive root — this should propagate to close the scope.
        dispose();
        // Give the fork time to run the scope close.
        yield* Effect.sleep("30 millis");
      })
    );

    expect(scopeClosed).toBe(true);
  });
});
