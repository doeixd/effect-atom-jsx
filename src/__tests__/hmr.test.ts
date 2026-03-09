import { describe, it, expect } from "vitest";
import { withViteHMR } from "../dom.js";

function makeHot() {
  const disposeHandlers: Array<(data: Record<string, unknown>) => void> = [];
  let acceptCount = 0;
  const data: Record<string, unknown> = {};

  return {
    hot: {
      data,
      accept: () => {
        acceptCount += 1;
      },
      dispose: (cb: (data: Record<string, unknown>) => void) => {
        disposeHandlers.push(cb);
      },
    },
    triggerDispose() {
      for (const cb of disposeHandlers) cb(data);
    },
    get acceptCount() {
      return acceptCount;
    },
  };
}

describe("withViteHMR", () => {
  it("registers accept/dispose and stores current disposer", () => {
    const h = makeHot();
    let disposed = false;

    withViteHMR(() => {
      disposed = true;
    }, h.hot);

    expect(h.acceptCount).toBe(1);
    expect(typeof h.hot.data["effect-atom-jsx:dispose"]).toBe("function");

    h.triggerDispose();
    expect(disposed).toBe(true);
    expect(h.hot.data["effect-atom-jsx:dispose"]).toBeUndefined();
  });

  it("disposes previous instance on hot replace", () => {
    const h = makeHot();
    let firstDisposed = 0;
    let secondDisposed = 0;

    withViteHMR(() => {
      firstDisposed += 1;
    }, h.hot, "custom");

    withViteHMR(() => {
      secondDisposed += 1;
    }, h.hot, "custom");

    expect(firstDisposed).toBe(1);
    expect(secondDisposed).toBe(0);
  });
});
