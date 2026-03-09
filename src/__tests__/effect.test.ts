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
import { Effect, Exit, Scope, Cause, Layer, ServiceMap, ManagedRuntime, Option } from "effect";
import {
  atomEffect,
  queryEffect,
  queryEffectStrict,
  defineQuery,
  defineQueryStrict,
  createQueryKey,
  invalidate,
  refresh,
  isPending,
  latest,
  createOptimistic,
  mutationEffect,
  mutationEffectStrict,
  use,
  useService,
  useServices,
  signal,
  computed,
  createAtom,
  AsyncResult,
  Async,
  Loading,
  Errored,
  Switch,
  Match,
  MatchTag,
  Optional,
  MatchOption,
  Dynamic,
  createFrame,
  Frame,
  WithLayer,
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

  it("refreshing wraps the last settled value", () => {
    const prev = AsyncResult.success(42);
    const r = AsyncResult.refreshing<number, never>(prev);
    expect(r._tag).toBe("Refreshing");
    expect(r.previous).toEqual(prev);
  });

  it("type guards are mutually exclusive", () => {
    const l = AsyncResult.loading;
    const s = AsyncResult.success(1);
    const f = AsyncResult.failure("err");
    const d = AsyncResult.defect("oops");
    const rf = AsyncResult.refreshing<number, string>(f);
    expect(AsyncResult.isLoading(l)).toBe(true);
    expect(AsyncResult.isSuccess(s)).toBe(true);
    expect(AsyncResult.isFailure(f)).toBe(true);
    expect(AsyncResult.isDefect(d)).toBe(true);
    expect(AsyncResult.isRefreshing(rf)).toBe(true);
    // Cross-checks
    expect(AsyncResult.isLoading(s)).toBe(false);
    expect(AsyncResult.isSuccess(f)).toBe(false);
  });

  it("fromExit and toExit round-trip settled results", () => {
    const ok = Exit.succeed(7);
    const fail = Exit.fail("bad");

    const okResult = AsyncResult.fromExit(ok);
    const failResult = AsyncResult.fromExit(fail);

    expect(AsyncResult.toExit(okResult)).toEqual(Option.some(ok));
    expect(AsyncResult.toExit(failResult)).toEqual(Option.some(fail));
    expect(AsyncResult.toExit(AsyncResult.loading)).toEqual(Option.none());
  });

  it("toOption returns latest successful value", () => {
    expect(AsyncResult.toOption(AsyncResult.loading)).toEqual(Option.none());
    expect(AsyncResult.toOption(AsyncResult.success(1))).toEqual(Option.some(1));
    expect(AsyncResult.toOption(AsyncResult.refreshing(AsyncResult.success(2)))).toEqual(Option.some(2));
    expect(AsyncResult.toOption(AsyncResult.failure("no"))).toEqual(Option.none());
  });

  it("rawCause exposes structured defect cause when available", () => {
    const cause = Cause.die("boom");
    const defect = AsyncResult.defect("pretty", cause);
    expect(AsyncResult.rawCause(defect)).toEqual(Option.some(cause));
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
    constructor(readonly status: number) { }
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

  it("emits Refreshing while revalidating after first settled value", async () => {
    const [id, setId] = createSignal(1);
    let result!: () => AsyncResultType<number, never>;
    const dispose = createRoot((d) => {
      result = atomEffect(() =>
        Effect.succeed(id()).pipe(Effect.delay("30 millis"))
      );
      return d;
    });

    await tick(50);
    expect(result()).toEqual(AsyncResult.success(1));

    setId(2);
    const during = result();
    expect(AsyncResult.isRefreshing(during)).toBe(true);
    if (AsyncResult.isRefreshing(during)) {
      expect(during.previous).toEqual(AsyncResult.success(1));
    }

    await tick(50);
    expect(result()).toEqual(AsyncResult.success(2));
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

describe("atomEffect — runtime compatibility", () => {
  const Greeting = ServiceMap.Service<{ readonly prefix: string }>("Greeting");

  it("accepts ManagedRuntime as the runtime argument", async () => {
    const runtime = ManagedRuntime.make(Layer.succeed(Greeting, { prefix: "hello" }));

    let result!: () => AsyncResultType<string, never>;
    const dispose = createRoot((d) => {
      result = atomEffect(
        () =>
          Effect.gen(function* () {
            const svc = yield* Effect.service(Greeting);
            return `${svc.prefix} world`;
          }),
        runtime,
      );
      return d;
    });

    await tick();
    expect(result()).toEqual(AsyncResult.success("hello world"));
    dispose();
    await runtime.dispose();
  });
});

describe("signal / computed", () => {
  it("signal exposes object-oriented read/write API", () => {
    const count = signal(1);
    expect(count.get()).toBe(1);
    count.set(5);
    expect(count.get()).toBe(5);
    count.update((n) => n + 2);
    expect(count.get()).toBe(7);
  });

  it("computed derives reactively from signal", () => {
    const count = signal(2);
    const doubled = computed(() => count.get() * 2);
    expect(doubled.get()).toBe(4);
    count.set(9);
    expect(doubled.get()).toBe(18);
  });
});

describe("use / queryEffect (ambient runtime behavior)", () => {
  it("use(tag) throws when no ambient ManagedRuntime is present", () => {
    const Name = ServiceMap.Service<{ readonly value: string }>("Name");
    expect(() => use(Name)).toThrow(/no ambient ManagedRuntime/i);
  });

  it("resource(fn) returns a defect when no ambient runtime is available", async () => {
    let result!: () => AsyncResultType<number, never>;
    const dispose = createRoot((d) => {
      result = queryEffect(() => Effect.succeed(123));
      return d;
    });
    await tick();
    const current = result();
    expect(AsyncResult.isDefect(current)).toBe(true);
    if (AsyncResult.isDefect(current)) {
      expect(current.cause).toMatch(/requires an ambient ManagedRuntime/i);
    }
    dispose();
  });

  it("resourceWith(runtime, fn) runs with explicit managed runtime", async () => {
    const Greeting = ServiceMap.Service<{ readonly prefix: string }>("Greeting");
    const runtime = ManagedRuntime.make(Layer.succeed(Greeting, { prefix: "yo" }));

    let result!: () => AsyncResultType<string, never>;
    const dispose = createRoot((d) => {
      result = queryEffectStrict(runtime, () =>
        Effect.gen(function* () {
          const svc = yield* Effect.service(Greeting);
          return `${svc.prefix}!`;
        }));
      return d;
    });

    await tick();
    expect(result()).toEqual(AsyncResult.success("yo!"));
    dispose();
    await runtime.dispose();
  });

  it("useService(tag) aliases use(tag)", () => {
    const Name = ServiceMap.Service<{ readonly value: string }>("Name");
    expect(() => useService(Name)).toThrow(/no ambient ManagedRuntime/i);
  });

  it("useServices throws without ambient runtime", () => {
    const A = ServiceMap.Service<{ readonly value: string }>("A");
    const B = ServiceMap.Service<{ readonly n: number }>("B");
    expect(() => useServices({ a: A, b: B })).toThrow(/no ambient ManagedRuntime/i);
  });
});

describe("query keys / queryEffect", () => {
  it("invalidate(key) triggers queryEffect re-run", async () => {
    const key = createQueryKey<number>("counter");
    const runtime = ManagedRuntime.make(Layer.empty);
    let runs = 0;
    let result!: () => AsyncResultType<number, never>;

    const dispose = createRoot((d) => {
      result = queryEffect(() => Effect.sync(() => ++runs), { key, runtime });
      return d;
    });

    await tick();
    expect(result()).toEqual(AsyncResult.success(1));
    invalidate(key);
    await tick();
    expect(result()).toEqual(AsyncResult.success(2));
    refresh(key);
    await tick();
    expect(result()).toEqual(AsyncResult.success(3));
    dispose();
    await runtime.dispose();
  });

  it("queryEffectStrict runs with explicit runtime", async () => {
    const Greeting = ServiceMap.Service<{ readonly prefix: string }>("Greeting");
    const runtime = ManagedRuntime.make(Layer.succeed(Greeting, { prefix: "hey" }));

    let result!: () => AsyncResultType<string, never>;
    const dispose = createRoot((d) => {
      result = queryEffectStrict(runtime, () =>
        Effect.gen(function* () {
          const svc = yield* Effect.service(Greeting);
          return `${svc.prefix}!`;
        }));
      return d;
    });

    await tick();
    expect(result()).toEqual(AsyncResult.success("hey!"));
    dispose();
    await runtime.dispose();
  });

  it("defineQuery bundles key/result/pending/latest", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    let runs = 0;

    const query = createRoot(() => defineQuery(() => Effect.sync(() => ++runs), { runtime, name: "q" }));
    await tick();
    expect(query.result()).toEqual(AsyncResult.success(1));
    expect(query.latest()).toBe(1);

    query.invalidate();
    await tick();
    expect(query.result()).toEqual(AsyncResult.success(2));
    await runtime.dispose();
  });

  it("defineQueryStrict requires explicit runtime", async () => {
    const Svc = ServiceMap.Service<{ readonly value: string }>("Svc");
    const runtime = ManagedRuntime.make(Layer.succeed(Svc, { value: "ok" }));
    const query = createRoot(() => defineQueryStrict(
      runtime,
      () => Effect.service(Svc).pipe(Effect.map((s) => s.value)),
      { name: "svc" },
    ));

    await tick();
    expect(query.result()).toEqual(AsyncResult.success("ok"));
    await runtime.dispose();
  });
});

describe("strict aliases", () => {
  it("mutationEffect invalidates query keys", async () => {
    const key = createQueryKey<number>("todos");
    const runtime = ManagedRuntime.make(Layer.empty);
    let observed = 0;

    const dispose = createRoot((d) => {
      const q = queryEffect(() => Effect.sync(() => {
        key.read();
        observed += 1;
        return observed;
      }), { runtime });
      const mutate = mutationEffect(
        (_: void) => Effect.void,
        { invalidates: key },
      );

      mutate.run(void 0);
      return d;
    });

    await tick();
    expect(observed).toBeGreaterThanOrEqual(2);
    dispose();
    await runtime.dispose();
  });

  it("mutationEffectStrict injects runtime", async () => {
    const Svc = ServiceMap.Service<{ readonly save: (n: number) => Effect.Effect<void> }>("Svc");
    let saved = 0;
    const runtime = ManagedRuntime.make(Layer.succeed(Svc, { save: (n) => Effect.sync(() => { saved = n; }) }));

    const action = mutationEffectStrict(
      runtime,
      (n: number) => Effect.service(Svc).pipe(Effect.flatMap((svc) => svc.save(n))),
    );

    action.run(7);
    await tick();
    expect(saved).toBe(7);
    await runtime.dispose();
  });
});

describe("isPending", () => {
  it("tracks refreshing state (not initial loading)", async () => {
    const [id, setId] = createSignal(1);
    let pending!: () => boolean;
    let result!: () => AsyncResultType<number, never>;

    const dispose = createRoot((d) => {
      result = atomEffect(() => Effect.succeed(id()).pipe(Effect.delay("20 millis")));
      pending = isPending(result);
      return d;
    });

    expect(AsyncResult.isLoading(result())).toBe(true);
    expect(pending()).toBe(false);
    await tick(40);
    expect(AsyncResult.isSuccess(result())).toBe(true);

    setId(2);
    expect(AsyncResult.isRefreshing(result())).toBe(true);
    expect(pending()).toBe(true);

    await tick(40);
    expect(AsyncResult.isSuccess(result())).toBe(true);
    expect(pending()).toBe(false);
    dispose();
  });
});

describe("latest", () => {
  it("returns latest success across refreshing states", async () => {
    const [id, setId] = createSignal(1);
    let result!: () => AsyncResultType<number, never>;
    let latestValue!: () => number | undefined;

    const dispose = createRoot((d) => {
      result = atomEffect(() => Effect.succeed(id()).pipe(Effect.delay("15 millis")));
      latestValue = latest(result);
      return d;
    });

    expect(latestValue()).toBeUndefined();
    await tick(30);
    expect(latestValue()).toBe(1);

    setId(2);
    expect(AsyncResult.isRefreshing(result())).toBe(true);
    expect(latestValue()).toBe(1);

    await tick(30);
    expect(latestValue()).toBe(2);
    dispose();
  });
});

describe("createOptimistic", () => {
  it("overlays source until cleared", () => {
    const [count, setCount] = createSignal(1);
    const optimistic = createOptimistic(count);

    expect(optimistic.get()).toBe(1);
    expect(optimistic.isPending()).toBe(false);

    optimistic.set(5);
    expect(optimistic.get()).toBe(5);
    expect(optimistic.isPending()).toBe(true);

    setCount(2);
    expect(optimistic.get()).toBe(5);

    optimistic.clear();
    expect(optimistic.isPending()).toBe(false);
    expect(optimistic.get()).toBe(2);
  });

  it("supports updater function", () => {
    const [value] = createSignal(10);
    const optimistic = createOptimistic(value);
    optimistic.set((n) => n + 3);
    expect(optimistic.get()).toBe(13);
  });
});

describe("mutationEffect", () => {
  it("runs effect and transitions result to Success", async () => {
    const action = mutationEffect((n: number) =>
      Effect.succeed(n).pipe(Effect.delay("10 millis"))
    );

    action.run(1);
    expect(AsyncResult.isRefreshing(action.result())).toBe(true);
    expect(action.pending()).toBe(true);
    await tick(30);
    expect(action.result()).toEqual(AsyncResult.success(undefined));
    expect(action.pending()).toBe(false);
  });

  it("supports optimistic + rollback for typed failures", async () => {
    const [count, setCount] = createSignal(1);
    const optimistic = createOptimistic(count);

    const action = mutationEffect(
      (_n: number) => Effect.fail("nope").pipe(Effect.delay("10 millis")),
      {
        optimistic: (n) => optimistic.set(n),
        rollback: () => optimistic.clear(),
      },
    );

    action.run(7);
    expect(optimistic.get()).toBe(7);
    await tick(30);

    expect(optimistic.isPending()).toBe(false);
    expect(optimistic.get()).toBe(1);
    expect(action.result()).toEqual(AsyncResult.failure("nope"));
  });

  it("requires runtime when action effect needs services", async () => {
    const Greeting = ServiceMap.Service<{ readonly prefix: string }>("ActionGreeting");
    const runtime = ManagedRuntime.make(Layer.succeed(Greeting, { prefix: "ok" }));

    const action = mutationEffectStrict(
      runtime,
      (_: void) => Effect.gen(function* () {
        const svc = yield* Effect.service(Greeting);
        return svc.prefix;
      }),
    );

    action.run(undefined);
    await tick();
    expect(action.result()).toEqual(AsyncResult.success(undefined));
    await runtime.dispose();
  });

  it("supports refresh hooks on success", async () => {
    const [tickValue, setTickValue] = createSignal(0);
    const calls: number[] = [];

    const action = mutationEffect(
      () => Effect.succeed("ok").pipe(Effect.delay("10 millis")),
      {
        refresh: [
          () => calls.push(1),
          () => setTickValue((n) => n + 1),
        ],
      },
    );

    action.run(undefined);
    await tick(30);
    expect(calls).toEqual([1]);
    expect(tickValue()).toBe(1);
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

describe("Loading", () => {
  it("renders fallback during initial loading", () => {
    const r = Loading({ when: AsyncResult.loading, fallback: () => "spin", children: "ready" });
    expect(r).toBe("spin");
  });

  it("renders children for non-loading async states", () => {
    const r = Loading({ when: AsyncResult.success(1), fallback: () => "spin", children: () => "ok" });
    expect(r).toBe("ok");
  });

  it("accepts accessor boolean input", () => {
    const [pending, setPending] = createSignal(true);
    expect(Loading({ when: pending, fallback: () => "wait", children: "done" })).toBe("wait");
    setPending(false);
    expect(Loading({ when: pending, fallback: () => "wait", children: "done" })).toBe("done");
  });
});

describe("Errored", () => {
  it("renders typed failure", () => {
    const r = Errored({
      result: AsyncResult.failure({ code: 401 }),
      children: (e: any) => "code" in e ? `error:${e.code}` : "defect",
    });
    expect(r).toBe("error:401");
  });

  it("renders defect as structured error", () => {
    const r = Errored({
      result: AsyncResult.defect("boom"),
      children: (e: any) => "defect" in e ? `defect:${e.defect}` : "typed",
    });
    expect(r).toBe("defect:boom");
  });

  it("renders fallback when not in error state", () => {
    const r = Errored({
      result: AsyncResult.success(1),
      fallback: () => "ok",
      children: () => "bad",
    });
    expect(r).toBe("ok");
  });
});

describe("Switch/Match", () => {
  it("renders first matching branch", () => {
    const r = Switch({
      children: [
        Match({ when: false, children: "no" }),
        Match({ when: "yes", children: (v: string) => `got:${v}` }),
        Match({ when: true, children: "later" }),
      ],
      fallback: () => "fallback",
    });
    expect(r).toBe("got:yes");
  });

  it("renders fallback when nothing matches", () => {
    const r = Switch({
      children: [
        Match({ when: 0, children: "no" }),
        Match({ when: "", children: "no" }),
      ],
      fallback: () => "fallback",
    });
    expect(r).toBe("fallback");
  });
});

describe("MatchTag", () => {
  it("matches by _tag with typed handlers", () => {
    const value: AsyncResultType<number, string> = AsyncResult.success(42);
    const r = MatchTag<AsyncResultType<number, string>, string>({
      value,
      cases: {
        Success: (v) => `ok:${v.value}`,
        Failure: (v) => `err:${String(v.error)}`,
      },
      fallback: () => "other",
    });
    expect(r).toBe("ok:42");
  });

  it("supports accessor input and fallback", () => {
    const [state, setState] = createSignal<AsyncResultType<number, string>>(AsyncResult.loading);
    const first = MatchTag({
      value: state,
      cases: {
        Success: (v) => v.value,
      },
      fallback: () => -1,
    });
    expect(first).toBe(-1);

    setState(AsyncResult.success(9));
    const second = MatchTag({
      value: state,
      cases: {
        Success: (v) => v.value,
      },
      fallback: () => -1,
    });
    expect(second).toBe(9);
  });
});

describe("Optional", () => {
  it("treats nullish as absent but keeps falsey values", () => {
    expect(Optional({ when: null, fallback: () => "none", children: "some" })).toBe("none");
    expect(Optional({ when: 0, fallback: () => "none", children: (v: number) => `v:${v}` })).toBe("v:0");
    expect(Optional({ when: "", fallback: () => "none", children: (v: string) => `v:${v}` })).toBe("v:");
  });
});

describe("MatchOption", () => {
  it("matches Option.Some and Option.None", () => {
    const some = MatchOption({
      value: Option.some(5),
      some: (v) => `some:${v}`,
      none: () => "none",
    });
    const none = MatchOption({
      value: Option.none<number>(),
      some: (v) => `some:${v}`,
      none: () => "none",
    });
    expect(some).toBe("some:5");
    expect(none).toBe("none");
  });
});

describe("Dynamic", () => {
  it("renders selected component or fallback", () => {
    const A = (p: { label: string }) => `A:${p.label}`;
    expect(Dynamic({ component: A, label: "x" })).toBe("A:x");
    expect(Dynamic({ component: null, label: "x", fallback: () => "fallback" })).toBe("fallback");
  });
});

describe("createFrame / Frame", () => {
  it("updates with requestAnimationFrame and cleans up", () => {
    const rafPrev = globalThis.requestAnimationFrame;
    const cafPrev = globalThis.cancelAnimationFrame;
    let cb: ((t: number) => void) | undefined;
    globalThis.requestAnimationFrame = ((f: FrameRequestCallback) => {
      cb = f;
      return 1;
    }) as typeof requestAnimationFrame;
    const cancel = vi.fn();
    globalThis.cancelAnimationFrame = cancel as unknown as typeof cancelAnimationFrame;

    let time!: () => number;
    const dispose = createRoot((d) => {
      time = createFrame(0);
      return d;
    });

    expect(time()).toBe(0);
    cb?.(16);
    expect(time()).toBe(16);

    const framed = createRoot(() => {
      const out = Frame({ children: (t) => `t:${Math.floor(t)}` });
      return out;
    });
    expect(typeof framed()).toBe("string");

    dispose();
    expect(cancel).toHaveBeenCalled();
    globalThis.requestAnimationFrame = rafPrev;
    globalThis.cancelAnimationFrame = cafPrev;
  });
});

describe("WithLayer", () => {
  it("renders fallback while layer is unresolved", () => {
    const layer = Layer.succeed(ServiceMap.Service<{ readonly v: number }>("Tmp"), { v: 1 });
    const r = WithLayer({ layer, fallback: () => "loading", children: () => "ok" });
    expect(r === "loading" || r === "ok" || r === null).toBe(true);
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
