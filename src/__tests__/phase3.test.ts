/**
 * phase3.test.ts — Tests for Phase 3 vNext Cleanup features.
 *
 *   - Naming consolidation (queryEffect/mutationEffect primary)
 *   - Exit-first internals (.exit field on Success/Failure/Defect)
 *   - Scoped lifecycle primitives (scopedQuery, scopedMutation)
 */

import { describe, it, expect } from "vitest";
import { Effect, Exit, Scope, Layer, ManagedRuntime, Option } from "effect";
import {
  queryEffect,
  mutationEffect,
  AsyncResult,
  scopedQuery,
  scopedQueryEffect,
  scopedMutation,
  scopedMutationEffect,
  type AsyncResult as AsyncResultType,
  type Success,
  type Failure,
  type Defect,
} from "../effect-ts.js";
import { createRoot } from "../api.js";

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Naming Consolidation ────────────────────────────────────────────────────

describe("Naming consolidation", () => {
  it("queryEffect is the primary query API and accepts a runtime option", () => {
    let result: any;
    const rt = ManagedRuntime.make(Layer.empty);
    createRoot(() => {
      result = queryEffect(() => Effect.succeed(1), { runtime: rt });
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("function");
  });

  it("mutationEffect is the primary mutation API", () => {
    let handle: any;
    createRoot(() => {
      handle = mutationEffect(
        (_n: number) => Effect.succeed(undefined),
        { runtime: ManagedRuntime.make(Layer.empty) },
      );
    });
    expect(handle).toHaveProperty("run");
    expect(handle).toHaveProperty("result");
    expect(handle).toHaveProperty("pending");
  });

  it("queryEffect returns defect when no ambient runtime is present", () => {
    let result: any;
    createRoot(() => {
      result = queryEffect(() => Effect.succeed(2));
    });
    expect(result()._tag).toBe("Defect");
  });
});

// ─── AsyncResult Combinators ─────────────────────────────────────────────────

describe("AsyncResult combinators", () => {
  describe("match", () => {
    const handlers = {
      onLoading: () => "loading",
      onRefreshing: () => "refreshing",
      onSuccess: (v: number) => `ok:${v}`,
      onFailure: (e: string) => `err:${e}`,
      onDefect: (c: string) => `defect:${c}`,
    };

    it("dispatches Loading", () => {
      expect(AsyncResult.match(AsyncResult.loading, handlers)).toBe("loading");
    });
    it("dispatches Success", () => {
      expect(AsyncResult.match(AsyncResult.success(42), handlers)).toBe("ok:42");
    });
    it("dispatches Failure", () => {
      expect(AsyncResult.match(AsyncResult.failure("oops"), handlers)).toBe("err:oops");
    });
    it("dispatches Defect", () => {
      expect(AsyncResult.match(AsyncResult.defect("boom"), handlers)).toBe("defect:boom");
    });
    it("dispatches Refreshing", () => {
      const r = AsyncResult.refreshing<number, string>(AsyncResult.success(1));
      expect(AsyncResult.match(r, handlers)).toBe("refreshing");
    });
  });

  describe("map", () => {
    it("transforms success value", () => {
      const r = AsyncResult.map(AsyncResult.success(2), (x) => x * 10);
      expect(r._tag).toBe("Success");
      expect((r as Success<number>).value).toBe(20);
    });
    it("passes through Loading unchanged", () => {
      const r = AsyncResult.map(AsyncResult.loading as AsyncResultType<number, string>, (x) => x * 10);
      expect(r._tag).toBe("Loading");
    });
    it("passes through Failure unchanged", () => {
      const r = AsyncResult.map(AsyncResult.failure("err") as AsyncResultType<number, string>, (x) => x * 10);
      expect(r._tag).toBe("Failure");
    });
  });

  describe("flatMap", () => {
    it("chains success to success", () => {
      const r = AsyncResult.flatMap(AsyncResult.success(5), (x) => AsyncResult.success(x + 1));
      expect(r._tag).toBe("Success");
      expect((r as Success<number>).value).toBe(6);
    });
    it("chains success to failure", () => {
      const r = AsyncResult.flatMap(AsyncResult.success(5), () => AsyncResult.failure("nope"));
      expect(r._tag).toBe("Failure");
    });
    it("short-circuits on Loading", () => {
      const r = AsyncResult.flatMap(AsyncResult.loading as AsyncResultType<number, string>, (x) => AsyncResult.success(x + 1));
      expect(r._tag).toBe("Loading");
    });
    it("short-circuits on Failure", () => {
      const r = AsyncResult.flatMap(AsyncResult.failure("err") as AsyncResultType<number, string>, (x) => AsyncResult.success(x + 1));
      expect(r._tag).toBe("Failure");
    });
  });

  describe("getOrElse", () => {
    it("returns value on Success", () => {
      expect(AsyncResult.getOrElse(AsyncResult.success(42), () => 0)).toBe(42);
    });
    it("returns fallback on Loading", () => {
      expect(AsyncResult.getOrElse(AsyncResult.loading as AsyncResultType<number, string>, () => -1)).toBe(-1);
    });
    it("returns fallback on Failure", () => {
      expect(AsyncResult.getOrElse(AsyncResult.failure("err") as AsyncResultType<number, string>, () => -1)).toBe(-1);
    });
  });

  describe("getOrThrow", () => {
    it("returns value on Success", () => {
      expect(AsyncResult.getOrThrow(AsyncResult.success(42))).toBe(42);
    });
    it("throws on Loading", () => {
      expect(() => AsyncResult.getOrThrow(AsyncResult.loading as AsyncResultType<number, string>)).toThrow("Loading");
    });
    it("throws the error on Failure", () => {
      expect(() => AsyncResult.getOrThrow(AsyncResult.failure("oops") as AsyncResultType<number, string>)).toThrow();
    });
  });
});

// ─── Exit-first Internals ────────────────────────────────────────────────────

describe("Exit-first internals", () => {
  it("Success carries a .exit field", () => {
    const r = AsyncResult.success(42) as Success<number>;
    expect(r).toHaveProperty("exit");
    expect(Exit.isExit(r.exit)).toBe(true);
    expect(Exit.isSuccess(r.exit)).toBe(true);
  });

  it("Failure carries a .exit field", () => {
    const r = AsyncResult.failure("err") as Failure<string>;
    expect(r).toHaveProperty("exit");
    expect(Exit.isExit(r.exit)).toBe(true);
    expect(Exit.isFailure(r.exit)).toBe(true);
  });

  it("Defect carries a .exit field", () => {
    const r = AsyncResult.defect("boom") as Defect;
    expect(r).toHaveProperty("exit");
    expect(Exit.isExit(r.exit)).toBe(true);
  });

  it("fromExit → toExit round-trips for success", () => {
    const exitOk = Exit.succeed(99);
    const r = AsyncResult.fromExit(exitOk);
    expect(r._tag).toBe("Success");
    const backOpt = AsyncResult.toExit(r);
    expect(Option.isSome(backOpt)).toBe(true);
    if (Option.isSome(backOpt)) {
      expect(Exit.isSuccess(backOpt.value)).toBe(true);
    }
  });

  it("fromExit → toExit round-trips for failure", () => {
    const exitFail = Exit.fail("bad");
    const r = AsyncResult.fromExit(exitFail);
    expect(r._tag).toBe("Failure");
    const backOpt = AsyncResult.toExit(r);
    expect(Option.isSome(backOpt)).toBe(true);
    if (Option.isSome(backOpt)) {
      expect(Exit.isFailure(backOpt.value)).toBe(true);
    }
  });

  it("toExit returns None for Loading", () => {
    const r = AsyncResult.toExit(AsyncResult.loading);
    expect(Option.isNone(r)).toBe(true);
  });
});

// ─── Scoped Lifecycle Primitives ─────────────────────────────────────────────

describe("scopedQuery", () => {
  it("creates a query tied to a scope and disposes on scope close", async () => {
    let fiberRan = false;
    let fiberInterrupted = false;

    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const rt = ManagedRuntime.make(Layer.empty);

        createRoot(() => {
          scopedQuery(scope, () =>
            Effect.gen(function* () {
              fiberRan = true;
              yield* Effect.sleep("1 hour");
              return "done";
            }).pipe(Effect.onInterrupt(() => Effect.sync(() => { fiberInterrupted = true; }))),
            { runtime: rt },
          );
        });

        yield* Effect.sleep("30 millis");
        expect(fiberRan).toBe(true);
        expect(fiberInterrupted).toBe(false);

        yield* Scope.close(scope, Exit.void);
        yield* Effect.sleep("30 millis");
        expect(fiberInterrupted).toBe(true);
      })
    );
  });
});

describe("scopedMutation", () => {
  it("creates a mutation handle tied to a scope", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const rt = ManagedRuntime.make(Layer.empty);

        let handle: any;
        createRoot(() => {
          handle = scopedMutation(scope, (_n: number) => Effect.succeed(undefined), { runtime: rt });
        });

        expect(handle).toHaveProperty("run");
        expect(handle).toHaveProperty("result");
        expect(handle).toHaveProperty("pending");

        yield* Scope.close(scope, Exit.void);
      })
    );
  });

  it("exposes Effect constructor variants for scoped lifecycle APIs", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const rt = ManagedRuntime.make(Layer.empty);

        const query = yield* scopedQueryEffect(
          scope,
          () => Effect.succeed("ok"),
          { runtime: rt },
        );

        const mutation = yield* scopedMutationEffect(
          scope,
          (_n: number) => Effect.succeed(undefined),
          { runtime: rt },
        );

        expect(typeof query).toBe("function");
        expect(mutation).toHaveProperty("run");

        yield* Scope.close(scope, Exit.void);
      })
    );
  });
});
