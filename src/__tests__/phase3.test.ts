/**
 * phase3.test.ts — Tests for Phase 3 vNext Cleanup features.
 *
 *   - Naming consolidation (defineQuery/defineMutation primary)
 *   - Exit-first internals (.exit field on Success/Failure/Defect)
 *   - Scoped lifecycle primitives (Effect constructors)
 */

import { describe, it, expect } from "vitest";
import { Effect, Exit, Scope, Layer, ManagedRuntime, Option } from "effect";
import {
  defineQuery,
  defineMutation,
  atomEffect,
  latest,
  Result as AsyncResult,
  scopedQueryEffect,
  scopedMutationEffect,
  type Result as AsyncResultType,
  type Success,
  type Failure,
  type Defect,
} from "../effect-ts.js";
import { createRoot, createSignal } from "../api.js";

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Naming Consolidation ────────────────────────────────────────────────────

describe("Naming consolidation", () => {
  it("defineQuery is the primary query API and accepts a runtime option", () => {
    let result: any;
    const rt = ManagedRuntime.make(Layer.empty);
    createRoot(() => {
      result = defineQuery(() => Effect.succeed(1), { runtime: rt }).result;
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("function");
  });

  it("defineMutation is the primary mutation API", () => {
    let handle: any;
    createRoot(() => {
      handle = defineMutation(
        (_n: number) => Effect.succeed(undefined),
        { runtime: ManagedRuntime.make(Layer.empty) },
      );
    });
    expect(handle).toHaveProperty("run");
    expect(handle).toHaveProperty("result");
    expect(handle).toHaveProperty("pending");
  });

  it("defineQuery returns defect when no ambient runtime is present", () => {
    let result: any;
    createRoot(() => {
      result = defineQuery(() => Effect.succeed(2)).result;
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
      onStale: (e: string, v: number) => `stale:${v}:${e}`,
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
    it("dispatches Stale", () => {
      const r = AsyncResult.stale("oops", 1);
      expect(AsyncResult.match(r, handlers)).toBe("stale:1:oops");
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
    it("transforms stale data while preserving the error", () => {
      const r = AsyncResult.map(AsyncResult.stale("err", 2), (x) => x * 10);
      expect(r._tag).toBe("Stale");
      if (r._tag === "Stale") {
        expect(r.error).toBe("err");
        expect(r.data).toBe(20);
      }
    });
    it("transforms refreshing success previous values", () => {
      const r = AsyncResult.map(AsyncResult.refreshing(AsyncResult.success(2)), (x) => x * 10);
      expect(r._tag).toBe("Refreshing");
      if (r._tag === "Refreshing") {
        expect(r.previous._tag).toBe("Success");
        if (r.previous._tag === "Success") {
          expect(r.previous.value).toBe(20);
        }
      }
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
    it("returns stale data on Stale", () => {
      expect(AsyncResult.getOrElse(AsyncResult.stale("err", 42), () => -1)).toBe(42);
    });
  });

  describe("getData/getError", () => {
    it("extracts data and error from Stale", () => {
      const r = AsyncResult.stale("err", 42);
      const data = AsyncResult.getData(r);
      const error = AsyncResult.getError(r);
      expect(Option.isSome(data) ? data.value : undefined).toBe(42);
      expect(Option.isSome(error) ? error.value : undefined).toBe("err");
    });
    it("extracts data from Refreshing(Success) and error from Refreshing(Failure)", () => {
      const refreshingSuccess = AsyncResult.refreshing(AsyncResult.success(7));
      const refreshingFailure = AsyncResult.refreshing(AsyncResult.failure("retrying"));
      const successData = AsyncResult.getData(refreshingSuccess);
      const successError = AsyncResult.getError(refreshingSuccess);
      const failureData = AsyncResult.getData(refreshingFailure);
      const failureError = AsyncResult.getError(refreshingFailure);

      expect(Option.isSome(successData) ? successData.value : undefined).toBe(7);
      expect(Option.isNone(successError)).toBe(true);
      expect(Option.isNone(failureData)).toBe(true);
      expect(Option.isSome(failureError) ? failureError.value : undefined).toBe("retrying");
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
    it("throws the typed stale error instead of returning stale data", () => {
      expect(() => AsyncResult.getOrThrow(AsyncResult.stale("stale-oops", 1))).toThrow("stale-oops");
    });
    it("throws the previous typed error while refreshing a failure", () => {
      expect(() => AsyncResult.getOrThrow(AsyncResult.refreshing(AsyncResult.failure("still-bad")))).toThrow("still-bad");
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

  it("Stale carries a failure .exit field and converts to an Exit", () => {
    const r = AsyncResult.stale("err", 42);
    expect(r).toHaveProperty("exit");
    expect(Exit.isExit(r.exit)).toBe(true);
    expect(Exit.isFailure(r.exit)).toBe(true);

    const backOpt = AsyncResult.toExit(r);
    expect(Option.isSome(backOpt)).toBe(true);
    if (Option.isSome(backOpt)) {
      expect(Exit.isFailure(backOpt.value)).toBe(true);
    }
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

describe("Stale result state", () => {
  it("preserves last successful data when a refresh fails with a typed error", async () => {
    let setId!: (value: number) => void;
    let result!: () => AsyncResultType<number, string>;

    const dispose = createRoot((d) => {
      const [id, set] = createSignal(1);
      setId = set;
      result = atomEffect(() => id() === 1
        ? Effect.succeed(10)
        : Effect.sleep("5 millis").pipe(Effect.flatMap(() => Effect.fail("nope"))));
      return d;
    });

    await tick(20);
    expect(result()._tag).toBe("Success");

    setId(2);
    await tick(20);

    const state = result();
    expect(state._tag).toBe("Stale");
    if (state._tag === "Stale") {
      expect(state.data).toBe(10);
      expect(state.error).toBe("nope");
    }

    dispose();
  });

  it("recovers from Stale to Success when a later refresh succeeds", async () => {
    let setId!: (value: number) => void;
    let result!: () => AsyncResultType<number, string>;

    const dispose = createRoot((d) => {
      const [id, set] = createSignal(1);
      setId = set;
      result = atomEffect(() => {
        const current = id();
        if (current === 1) return Effect.succeed(10);
        if (current === 2) return Effect.sleep("5 millis").pipe(Effect.flatMap(() => Effect.fail("nope")));
        return Effect.sleep("5 millis").pipe(Effect.as(30));
      });
      return d;
    });

    await tick(20);
    setId(2);
    await tick(20);
    expect(result()._tag).toBe("Stale");

    setId(3);
    await tick(20);
    const state = result();
    expect(state._tag).toBe("Success");
    if (state._tag === "Success") {
      expect(state.value).toBe(30);
    }

    dispose();
  });

  it("keeps stale data across repeated failed refreshes", async () => {
    let setId!: (value: number) => void;
    let result!: () => AsyncResultType<number, string>;

    const dispose = createRoot((d) => {
      const [id, set] = createSignal(1);
      setId = set;
      result = atomEffect(() => id() === 1
        ? Effect.succeed(10)
        : Effect.sleep("5 millis").pipe(Effect.flatMap(() => Effect.fail(`nope-${id()}`))));
      return d;
    });

    await tick(20);
    setId(2);
    await tick(20);
    setId(3);
    await tick(20);

    const state = result();
    expect(state._tag).toBe("Stale");
    if (state._tag === "Stale") {
      expect(state.data).toBe(10);
      expect(state.error).toBe("nope-3");
    }

    dispose();
  });

  it("latest returns stale data while getError exposes the refresh failure", () => {
    const result = () => AsyncResult.stale("nope", 10) as AsyncResultType<number, string>;
    const readLatest = latest(result);

    expect(readLatest()).toBe(10);
    const error = AsyncResult.getError(result());
    expect(Option.isSome(error) ? error.value : undefined).toBe("nope");
  });
});

// ─── Scoped Lifecycle Primitives ─────────────────────────────────────────────

describe("scopedQueryEffect", () => {
  it("creates a query tied to a scope and disposes on scope close", async () => {
    let fiberRan = false;
    let fiberInterrupted = false;

    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const rt = ManagedRuntime.make(Layer.empty);

        createRoot(() => {
          Effect.runSync(scopedQueryEffect(scope, () =>
            Effect.gen(function* () {
              fiberRan = true;
              yield* Effect.sleep("1 hour");
              return "done";
            }).pipe(Effect.onInterrupt(() => Effect.sync(() => { fiberInterrupted = true; }))),
            { runtime: rt },
          ));
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

describe("scopedMutationEffect", () => {
  it("creates a mutation handle tied to a scope", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const rt = ManagedRuntime.make(Layer.empty);

        let handle: any;
        createRoot(() => {
          handle = Effect.runSync(
            scopedMutationEffect(scope, (_n: number) => Effect.succeed(undefined), { runtime: rt }),
          );
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
