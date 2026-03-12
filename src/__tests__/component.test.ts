import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { createRoot } from "../api.js";
import * as Component from "../Component.js";

describe("Component", () => {
  it("runs setupEffect with Effect-native setup helpers", () => {
    const Counter = Component.make(
      Component.props<{ readonly start: number }>(),
      Component.require<never>(),
      ({ start }) => Effect.gen(function* () {
        const count = yield* Component.state(start);
        const doubled = yield* Component.derived(() => count() * 2);
        return { count, doubled };
      }),
      (_props, bindings) => bindings.doubled(),
    );

    const bindings = Effect.runSync(Component.setupEffect(Counter, { start: 2 }));
    expect(bindings.count()).toBe(2);
    expect(bindings.doubled()).toBe(4);
    bindings.count.set(4);
    expect(bindings.doubled()).toBe(8);
  });

  it("supports headless render-prop components", () => {
    const Headless = Component.headless(
      Component.props<{ readonly label: string }>(),
      Component.require<never>(),
      ({ label }) => Effect.gen(function* () {
        const text = yield* Component.state(label);
        return { text };
      }),
    );

    const rendered = Effect.runSync(
      Component.renderEffect(Headless, {
        label: "hello",
        children: ({ text }) => text(),
      }),
    );

    expect(rendered).toBe("hello");
  });

  it("supports timeout wrapper for setup", async () => {
    const Slow = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.sleep("20 millis").pipe(Effect.as({ ok: true })),
      () => "ok",
    ).pipe(Component.withSetupTimeout(1));

    await expect(Effect.runPromise(Component.setupEffect(Slow, {}) as Effect.Effect<unknown, unknown, never>)).rejects.toMatchObject({
      _tag: "ComponentSetupTimeout",
    });
  });

  it("supports typed setup error boundaries", async () => {
    const Broken = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.fail({ _tag: "Boom", message: "x" } as const),
      () => "never",
    ).pipe(
      Component.withErrorBoundary({
        Boom: () => "handled",
      }),
    );

    const view = createRoot(() => Broken({})) as () => unknown;
    await Effect.runPromise(Effect.sleep("5 millis"));
    expect(view()).toBe("handled");
  });
});
