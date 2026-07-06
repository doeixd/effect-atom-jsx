import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as Element from "../Element.js";

describe("Element", () => {
  it("makes text inputs focusable at runtime", () => {
    const input = Element.textInput();
    let focused = 0;
    let blurred = 0;

    Effect.runSync(input.listen("focus", () => {
      focused += 1;
    }));
    Effect.runSync(input.listen("blur", () => {
      blurred += 1;
    }));

    input.focus();
    input.blur();

    expect(focused).toBe(1);
    expect(blurred).toBe(1);
  });
});
