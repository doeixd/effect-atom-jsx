import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Option, Schema, Scope } from "effect";
import * as Behavior from "../Behavior.js";
import * as Behaviors from "../behaviors.js";
import * as Element from "../Element.js";

describe("Behavior", () => {
  it("emits and unsubscribes typed logical out-events", () => {
    const Dismissed = Behavior.outEvent<"dismissed", { readonly reason: "escape" | "outside" }>("dismissed");
    const bus = Behavior.eventBus({ dismissed: Dismissed });
    const seen: Array<string> = [];

    const unsubscribe = Effect.runSync(
      bus.on(Dismissed, (payload) => {
        seen.push(payload.reason);
      }),
    );

    bus.emit("dismissed", { reason: "escape" });
    unsubscribe();
    bus.emit(Dismissed, { reason: "outside" });

    expect(seen).toEqual(["escape"]);
  });

  it("supports multiple listeners and treats unknown events as no-ops", () => {
    const Changed = Behavior.outEvent<"changed", number>("changed");
    const bus = Behavior.eventBus({ changed: Changed });
    const seen: Array<string> = [];

    Effect.runSync(bus.on("changed", (value) => {
      seen.push(`a:${value}`);
    }));
    Effect.runSync(bus.on(Changed, (value) => {
      seen.push(`b:${value}`);
    }));

    bus.emit("missing" as never, 1 as never);
    bus.emit(Changed, 2);

    expect(seen).toEqual(["a:2", "b:2"]);
  });

  it("allows listener cleanup to be called more than once", () => {
    const Changed = Behavior.outEvent<"changed", number>("changed");
    const bus = Behavior.eventBus({ changed: Changed });
    const seen: Array<number> = [];

    const unsubscribe = Effect.runSync(bus.on(Changed, (value) => {
      seen.push(value);
    }));

    unsubscribe();
    unsubscribe();
    bus.emit(Changed, 1);

    expect(seen).toEqual([]);
  });

  it("preserves logical out-event metadata through emits and compose", () => {
    const Selected = Behavior.outEvent<"selected", { readonly id: string }>("selected");
    const Dismissed = Behavior.outEvent<"dismissed", void>("dismissed");
    const selection = Behavior.emits({ selected: Selected })(
      Behavior.make(() => Effect.succeed({})),
    );
    const dismiss = Behavior.emits({ dismissed: Dismissed })(
      Behavior.make(() => Effect.succeed({})),
    );

    const composed = Behavior.compose(selection, dismiss);

    expect(selection.metadata?.emits?.selected).toBe(Selected);
    expect(composed.metadata?.emits?.selected).toBe(Selected);
    expect(composed.metadata?.emits?.dismissed).toBe(Dismissed);
  });

  it("merges provided binding and logical event metadata through withMetadata", () => {
    const IsOpen = Behavior.binding<"isOpen", boolean>("isOpen");
    const Dismissed = Behavior.outEvent<"dismissed", void>("dismissed");
    const behavior = Behavior.make(() => Effect.succeed({ isOpen: true }));

    const withBindings = Behavior.withMetadata(behavior, { provides: { isOpen: IsOpen } });
    const withEvents = Behavior.withMetadata(withBindings, { emits: { dismissed: Dismissed } });

    expect(withEvents.metadata?.provides?.isOpen).toBe(IsOpen);
    expect(withEvents.metadata?.emits?.dismissed).toBe(Dismissed);
  });

  it("traps tab focus inside the configured focusable collection", () => {
    const container = Element.container();
    const first = Element.focusable();
    const second = Element.focusable();
    const focused: Array<string> = [];
    Effect.runSync(first.on("focus", () => focused.push("first")));
    Effect.runSync(second.on("focus", () => focused.push("second")));

    const bindings = Effect.runSync(
      Behaviors.focusTrap({ initialIndex: 0 }).run({
        container,
        focusables: Element.collection([first, second]),
      }),
    );
    let prevented = 0;

    bindings.activate();
    container.emit("keydown", {
      key: "Tab",
      preventDefault: () => {
        prevented += 1;
      },
    });
    container.emit("keydown", {
      key: "Tab",
      shiftKey: true,
      preventDefault: () => {
        prevented += 1;
      },
    });

    expect(prevented).toBe(2);
    expect(focused).toEqual(["first", "second", "first"]);
    expect(bindings.activeIndex()).toBe(0);

    // Deactivating must actually stop the trap. Without this, an
    // implementation that ignored `active()` left identical final state
    // (index 0) and passed every assertion above.
    bindings.deactivate();
    container.emit("keydown", {
      key: "Tab",
      preventDefault: () => {
        prevented += 1;
      },
    });
    expect(prevented).toBe(2);
    expect(focused).toEqual(["first", "second", "first"]);
  });

  it("removes the focus-trap keydown listener when its scope closes", () => {
    const container = Element.container();
    const first = Element.focusable();
    const focused: Array<string> = [];
    const scope = Scope.makeUnsafe();
    Effect.runSync(
      Effect.provideService(first.on("focus", () => focused.push("first")), Scope.Scope, scope),
    );

    const bindings = Effect.runSync(
      Effect.provideService(
        Behaviors.focusTrap({ initialIndex: 0 }).run({
          container,
          focusables: Element.collection([first]),
        }),
        Scope.Scope,
        scope,
      ),
    );
    let prevented = 0;
    const tab = () =>
      container.emit("keydown", {
        key: "Tab",
        preventDefault: () => {
          prevented += 1;
        },
      });

    bindings.activate();
    tab();
    expect(prevented).toBe(1);

    // Counting, not final state: a leaked listener keeps handling keydown
    // against a torn-down behaviour while `activeIndex()` still reads 0.
    Effect.runSync(Scope.close(scope, Exit.void));
    tab();
    tab();
    expect(prevented).toBe(1);

    // Closing twice is a no-op.
    Effect.runSync(Scope.close(scope, Exit.void));
    tab();
    expect(prevented).toBe(1);
  });
});

describe("Behavior deps channel (DQ-052)", () => {
  it("typed deps flow from attachScoped options into run, per instance", () => {
    // Fully typed authoring: no casts anywhere in this test. If any appear
    // necessary, that is an API bug per the project quality bar.
    const bump = Behavior.make(
      (
        elements: { readonly target: Element.Interactive },
        deps: { readonly step: number; readonly log: Array<number> },
      ) =>
        Effect.gen(function* () {
          yield* elements.target.on("click", () => deps.log.push(deps.step));
          return { step: deps.step };
        }),
    );

    // Compile-time pins for the new type axis.
    const _deps: Behavior.DepsOf<typeof bump> = { step: 1, log: [] };
    void _deps;

    const left = { target: Element.interactive(), log: [] as Array<number> };
    const right = { target: Element.interactive(), log: [] as Array<number> };
    const a = Effect.runSync(
      Behavior.attachScoped(bump, { target: left.target }, {
        deps: { step: 1, log: left.log },
      }),
    );
    const b = Effect.runSync(
      Behavior.attachScoped(bump, { target: right.target }, {
        deps: { step: 100, log: right.log },
      }),
    );
    expect(a.bindings.step).toBe(1);
    expect(b.bindings.step).toBe(100);

    left.target.emit("click", {});
    right.target.emit("click", {});
    right.target.emit("click", {});
    expect(left.log).toEqual([1]);
    expect(right.log).toEqual([100, 100]);

    Effect.runSync(a.dispose);
    Effect.runSync(b.dispose);
  });

  it("a deps-free behavior still attaches without an options argument", () => {
    const plain = Behavior.make((elements: { readonly target: Element.Interactive }) =>
      Effect.succeed({ ok: elements.target !== undefined })
    );
    const attached = Effect.runSync(
      Behavior.attachScoped(plain, { target: Element.interactive() }),
    );
    expect(attached.bindings.ok).toBe(true);
    Effect.runSync(attached.dispose);
  });

  it("compose intersects the deps of its members and forwards one deps object", () => {
    const first = Behavior.make(
      (_elements: {}, deps: { readonly a: number }) => Effect.succeed({ a: deps.a }),
    );
    const second = Behavior.make(
      (_elements: {}, deps: { readonly b: string }) => Effect.succeed({ b: deps.b }),
    );
    const stacked = Behavior.compose(first, second);
    // Compile-time: composed deps require BOTH members' dependencies.
    const _deps: Behavior.DepsOf<typeof stacked> = { a: 1, b: "x" };
    void _deps;
    const attached = Effect.runSync(
      Behavior.attachScoped(stacked, {}, { deps: { a: 7, b: "seven" } }),
    );
    expect(attached.bindings).toEqual({ a: 7, b: "seven" });
    Effect.runSync(attached.dispose);
  });
});

describe("Behavior API hardening", () => {
  it("forgetting { deps } for a deps-requiring behavior is a compile error", () => {
    const needsDeps = Behavior.make(
      (_e: { readonly target: Element.Interactive }, deps: { readonly step: number }) =>
        Effect.succeed({ step: deps.step }),
    );
    // @ts-expect-error — a behavior with real dependencies requires them at
    // attach; this used to compile and crash reading deps.step of {}.
    const missing = () => Behavior.attachScoped(needsDeps, { target: Element.interactive() });
    void missing;
    const attached = Effect.runSync(
      Behavior.attachScoped(needsDeps, { target: Element.interactive() }, {
        deps: { step: 3 },
      }),
    );
    expect(attached.bindings.step).toBe(3);
    Effect.runSync(attached.dispose);
  });

  it("isBehavior detects a spread copy that silently lost pipe", () => {
    const behavior = Behavior.make((_e: {}) => Effect.succeed({}));
    expect(Behavior.isBehavior(behavior)).toBe(true);
    const spread = { ...behavior };
    expect(Behavior.isBehavior(spread)).toBe(false);
    expect((spread as { readonly pipe?: unknown }).pipe).toBeUndefined();
  });

  it("BehaviorOptionsError carries the structured schema issue", () => {
    const exit = Effect.runSyncExit(
      Behavior.decodeOptions(
        "probe",
        Schema.Struct({ flag: Schema.Boolean }),
        { flag: "nope" },
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const error = Cause.findErrorOption(exit.cause).pipe(
      Option.getOrElse(() => undefined),
    );
    expect(error?._tag).toBe("BehaviorOptionsError");
    if (error?._tag !== "BehaviorOptionsError") return;
    expect(error.behavior).toBe("probe");
    // the structured issue survives beside the flattened message
    expect(error.issue).toBeDefined();
    expect(error.message).toContain("probe");
  });
});
