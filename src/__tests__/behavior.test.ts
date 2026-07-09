import { describe, expect, it } from "vitest";
import { Effect } from "effect";
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
  });
});
