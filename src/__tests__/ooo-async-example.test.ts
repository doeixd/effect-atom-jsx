import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { Result } from "../advanced.js";
import { createOOOAsyncDemo } from "../../examples/ooo-async/App.js";

describe("ooo-async example", () => {
  it("starts in loading state", () => {
    const demo = createOOOAsyncDemo();
    expect(demo.getState()._tag).toBe("Loading");
  });

  it("pulls out-of-order chunks and renders ordered state", async () => {
    const demo = createOOOAsyncDemo();

    expect(demo.getState()._tag).toBe("Loading");

    demo.pullNext();
    await Effect.runPromise(Effect.sleep("10 millis"));

    const afterFirst = demo.getState();
    expect(afterFirst._tag).toBe("Success");
    if (afterFirst._tag === "Success") {
      expect(afterFirst.value.items).toEqual([]);
      expect(afterFirst.value.nextSequence).toBe(0);
    }

    demo.pullNext();
    const afterSecond = demo.getState();
    expect(afterSecond._tag).toBe("Success");
    if (afterSecond._tag === "Success") {
      expect(afterSecond.value.items).toEqual([10, 20, 21]);
      expect(afterSecond.value.complete).toBe(false);
    }

    demo.pullNext();
    const afterThird = demo.getState();
    expect(afterThird._tag).toBe("Success");
    if (afterThird._tag === "Success") {
      expect(afterThird.value.items).toEqual([10, 20, 21, 30]);
      expect(afterThird.value.complete).toBe(true);
    }
  });

  it("shows failure state when forced error is toggled", () => {
    const demo = createOOOAsyncDemo();
    demo.toggleError();

    const state = demo.getState();
    expect(Result.isFailure(state)).toBe(true);
    if (state._tag === "Failure") {
      expect(state.error).toBe("Manually forced stream error");
    }
  });
});
