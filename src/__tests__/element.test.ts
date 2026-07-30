import { Effect, Exit, Scope } from "effect";
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

describe("Element.on scope ownership", () => {
  it("removes a listener on scope close with no reactive owner in play", () => {
    const target = Element.interactive();
    let fired = 0;

    const scope = Scope.makeUnsafe();
    Effect.runSync(
      Effect.provideService(
        target.on("click", () => {
          fired += 1;
        }),
        Scope.Scope,
        scope,
      ),
    );

    target.emit("click", {});
    expect(fired).toBe(1);

    Effect.runSync(Scope.close(scope, Exit.void));

    target.emit("click", {});
    target.emit("click", {});
    expect(fired).toBe(1);
  });

  it("closing a scope twice removes the listener exactly once", () => {
    const target = Element.interactive();
    let fired = 0;

    const scope = Scope.makeUnsafe();
    Effect.runSync(
      Effect.provideService(
        target.on("click", () => {
          fired += 1;
        }),
        Scope.Scope,
        scope,
      ),
    );

    Effect.runSync(Scope.close(scope, Exit.void));
    Effect.runSync(Scope.close(scope, Exit.void));

    target.emit("click", {});
    expect(fired).toBe(0);
  });

  it("keeps sibling scopes independent for the same element (on)", () => {
    const target = Element.interactive();
    const hits: Array<string> = [];

    const first = Scope.makeUnsafe();
    const second = Scope.makeUnsafe();
    Effect.runSync(
      Effect.provideService(target.on("click", () => hits.push("first")), Scope.Scope, first),
    );
    Effect.runSync(
      Effect.provideService(target.on("click", () => hits.push("second")), Scope.Scope, second),
    );

    Effect.runSync(Scope.close(first, Exit.void));
    target.emit("click", {});
    expect(hits).toEqual(["second"]);

    Effect.runSync(Scope.close(second, Exit.void));
    target.emit("click", {});
    expect(hits).toEqual(["second"]);
  });
});

describe("Element.collection observeEach scope ownership", () => {
  const observeIn = <E extends Element.Handle>(
    scope: Scope.Scope,
    handle: Element.Collection<E>,
    f: (item: E, index: number) => Effect.Effect<(() => void) | void>,
  ) => Effect.runSync(Effect.provideService(handle.observeEach(f), Scope.Scope, scope));

  it("stops running the observer after scope close with no reactive owner", () => {
    const items = Element.collection([Element.focusable(), Element.focusable()]);
    let runs = 0;

    const scope = Scope.makeUnsafe();
    observeIn(scope, items, () =>
      Effect.sync(() => {
        runs += 1;
      }));
    expect(runs).toBe(2);

    items.set([Element.focusable()]);
    expect(runs).toBe(3);

    Effect.runSync(Scope.close(scope, Exit.void));

    // The leak this guards: a surviving observer keeps invoking `run` against a
    // torn-down owner, while the collection's final state still looks correct.
    items.set([Element.focusable(), Element.focusable(), Element.focusable()]);
    items.set([]);
    expect(runs).toBe(3);
  });

  it("runs every per-item cleanup exactly once on scope close", () => {
    const items = Element.collection([
      Element.focusable(),
      Element.focusable(),
      Element.focusable(),
    ]);
    const released: Array<number> = [];

    const scope = Scope.makeUnsafe();
    observeIn(scope, items, (_item, index) =>
      Effect.sync(() => () => {
        released.push(index);
      }));

    expect(released).toEqual([]);

    Effect.runSync(Scope.close(scope, Exit.void));
    expect(released).toEqual([0, 1, 2]);

    // Closing again must not re-release, and neither must a later mutation.
    Effect.runSync(Scope.close(scope, Exit.void));
    items.set([]);
    expect(released).toEqual([0, 1, 2]);
  });

  it("does not release an item twice when it left the collection before scope close", () => {
    const first = Element.focusable();
    const second = Element.focusable();
    const items = Element.collection([first, second]);
    const released: Array<string> = [];
    const names = new Map([[first, "first"], [second, "second"]]);

    const scope = Scope.makeUnsafe();
    observeIn(scope, items, (item) =>
      Effect.sync(() => () => {
        released.push(names.get(item)!);
      }));

    // Removing `second` re-runs the observer, which releases the previous
    // generation of cleanups — including `second`'s.
    items.set([first]);
    expect(released).toEqual(["first", "second"]);

    Effect.runSync(Scope.close(scope, Exit.void));
    // Only the surviving generation is released again: `second` is not double
    // released, `first` is released once per generation it was live in.
    expect(released).toEqual(["first", "second", "first"]);
    expect(released.filter((name) => name === "second")).toHaveLength(1);
  });

  it("keeps sibling scopes independent for the same collection", () => {
    const items = Element.collection([Element.focusable()]);
    const hits: Array<string> = [];

    const left = Scope.makeUnsafe();
    const right = Scope.makeUnsafe();
    observeIn(left, items, () => Effect.sync(() => void hits.push("left")));
    observeIn(right, items, () => Effect.sync(() => void hits.push("right")));
    expect(hits).toEqual(["left", "right"]);

    Effect.runSync(Scope.close(left, Exit.void));
    items.set([Element.focusable()]);
    expect(hits).toEqual(["left", "right", "right"]);

    Effect.runSync(Scope.close(right, Exit.void));
    items.set([Element.focusable()]);
    expect(hits).toEqual(["left", "right", "right"]);
  });
});
