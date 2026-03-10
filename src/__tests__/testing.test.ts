import { describe, expect, it } from "vitest";
import { Effect, Layer, ServiceMap } from "effect";
import { createSignal, createMemo } from "../api.js";
import { defineQuery, defineMutation, useService } from "../effect-ts.js";
import { mockService, renderWithLayer, withTestLayer } from "../testing.js";

interface Api {
  fetchData(): Effect.Effect<string, Error>;
  saveData(n: number): Effect.Effect<void, Error>;
}
const Api = ServiceMap.Service<Api>("Api");

describe("testing.ts harness", () => {
  it("withTestLayer executes logic inside a reactive root with layer services", async () => {
    const ApiMock = mockService(Api, {
      fetchData: () => Effect.succeed("mocked data"),
      saveData: () => Effect.void,
    });

    const harness = withTestLayer(ApiMock);

    // Run logic inside the harness's boundary
    const result = harness.run(() => {
      return defineQuery(() => useService(Api).fetchData()).result;
    });

    // Effect.succeed resolves synchronously, so the result is immediately Success
    // (no Loading state for sync effects).
    await harness.tick();

    const settled = result();
    expect(settled._tag).toBe("Success");
    if (settled._tag === "Success") {
      expect(settled.value).toBe("mocked data");
    }

    await harness.dispose();
  });

  it("renderWithLayer runs the ui block immediately", async () => {
    let savedValue = 0;
    const ApiMock = mockService(Api, {
      fetchData: () => Effect.succeed(""),
      saveData: (n) => Effect.sync(() => { savedValue = n; }),
    });

    const harness = renderWithLayer(ApiMock, () => {
      const save = defineMutation((n: number) => useService(Api).saveData(n));
      save.run(42);
    });

    await harness.tick();
    expect(savedValue).toBe(42);

    await harness.dispose();
  });

  it("cleans up running effects on dispose", async () => {
    let started = false;
    let interrupted = false;
    const ApiMock = mockService(Api, {
      fetchData: () => Effect.gen(function* () {
        started = true;
        yield* Effect.sleep("1 hour");
        return "done";
      }).pipe(Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; }))),
      saveData: () => Effect.void,
    });

    const harness = renderWithLayer(ApiMock, () => {
      defineQuery(() => useService(Api).fetchData());
    });

    await harness.tick();
    expect(started).toBe(true);
    expect(interrupted).toBe(false);

    await harness.dispose();
    expect(interrupted).toBe(true);
  });
});
