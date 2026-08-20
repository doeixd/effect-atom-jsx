/**
 * The bindings commit boundary. Promoted from
 * `future/components/commit-boundary.spec.ts` (all green 2026-08-12),
 * retyped.
 *
 * Owning docs: `docs/archive/BINDINGS_ASYNC_COMMIT_BOUNDARY.md`,
 * `docs/archive/PROPS_BINDINGS_SLOTS.md` ("Setup is an Effect; bindings are
 * the committed snapshot").
 *
 * The invariant, in order: setup resolves ALL async → bindings commit
 * atomically → the view renders from that snapshot → style/behavior effects
 * attach. A view must never observe a half-resolved binding, and a failed
 * setup must attach nothing and leak nothing.
 */
import { Cause, Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { describe, expect, it } from "vitest";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Style from "../Style.js";
import * as View from "../View.js";
import { createRoot } from "../api.js";

const flush = (): Promise<void> => Effect.runPromise(Effect.sleep("20 millis"));

describe("bindings commit boundary", () => {
  it("never renders the view from a partially resolved binding set", async () => {
    const gateA = Effect.runSync(Deferred.make<number>());
    const gateB = Effect.runSync(Deferred.make<number>());
    const observed: Array<ReadonlyArray<string>> = [];

    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>()
        .value("sync", () => "committed")
        .bind("a", () => Deferred.await(gateA))
        .bind("b", () => Deferred.await(gateB)),
      (_props, bindings) => {
        observed.push(Object.keys(bindings).sort());
        return `${String(bindings.a)}:${String(bindings.b)}`;
      },
    );

    const mounted = createRoot((dispose) => ({
      render: Widget({}) as () => unknown,
      dispose,
    }));

    // Nothing resolved: the view has not run at all.
    expect(mounted.render()).toBeNull();
    expect(observed).toEqual([]);

    // Half resolved: still nothing. This is the load-bearing assertion — a
    // view that could see `{ sync, a }` without `b` would be observing an
    // uncommitted snapshot.
    Effect.runSync(Deferred.succeed(gateA, 1));
    await flush();
    expect(observed).toEqual([]);
    expect(mounted.render()).toBeNull();

    // Fully resolved: exactly one commit, with every binding present.
    Effect.runSync(Deferred.succeed(gateB, 2));
    await flush();
    expect(mounted.render()).toBe("1:2");
    expect(observed).toEqual([["a", "b", "sync"]]);

    mounted.dispose();
  });

  it("a failed setup attaches no behavior and renders no view", () => {
    const anatomy = View.Slots.define({
      root: { capability: Element.Capability.Container },
    });

    let attachments = 0;
    let viewRuns = 0;
    let released = 0;

    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>()
        .bind("root", () => Component.slotContainer())
        .value("slots", ({ bindings }) => ({ root: bindings.root }))
        .bind("resource", () =>
          Effect.acquireRelease(
            Effect.succeed("acquired"),
            () =>
              Effect.sync(() => {
                released += 1;
              }),
          ))
        .bind("boom", () => Effect.fail({ _tag: "SetupFailed" as const })),
      () => {
        viewRuns += 1;
        return "rendered";
      },
    ).pipe(
      Behavior.attachToSlots(
        Behavior.forSlots(anatomy)(() =>
          Effect.sync(() => {
            attachments += 1;
            return { attached: true };
          })
        ),
        anatomy,
      ),
    );

    const exit = Effect.runSyncExit(
      Effect.scoped(Component.setupEffect(Widget, {})),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    // The failure must arrive as the TYPED error in `E`, not as a defect: an
    // error boundary can only match on a tag it can see.
    const failure = Exit.isFailure(exit)
      ? Cause.findErrorOption(exit.cause)
      : { _tag: "None" as const };
    expect(
      failure._tag === "Some"
        ? (failure.value as { readonly _tag: string })._tag
        : undefined,
    ).toBe("SetupFailed");
    // Nothing downstream of the failure may have happened.
    expect(attachments).toBe(0);
    expect(viewRuns).toBe(0);
    // ...and everything acquired before the failure is released exactly once.
    expect(released).toBe(1);
  });

  it("style and behavior effects only observe committed slot handles", async () => {
    // House slot idiom (see capability-filtering.test.ts): a bound Slots
    // value carries both the contract and the live handles.
    const Root = View.Slot.make("root", {
      capability: Element.Capability.Container,
    });
    const root = Element.container();
    const slots = View.Slots.make({ root: View.Slot.bind(Root, root) });
    const order: Array<string> = [];
    const gate = Effect.runSync(Deferred.make<string>());

    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>()
        .value("slots", () => ({ root }))
        .bind("late", () =>
          Deferred.await(gate).pipe(
            Effect.tap(() => Effect.sync(() => order.push("setup:late"))),
          )),
      () => View.fromSlots(slots, null),
    ).pipe(
      Behavior.attachToSlots(
        Behavior.forSlots(slots)((elements) =>
          Effect.sync(() => {
            order.push("behavior:attach");
            // The behavior must see a fully-built handle, never undefined.
            expect(elements.root).toBeDefined();
            expect(typeof elements.root.setAttr).toBe("function");
            return {};
          })
        ),
        slots,
      ),
      Style.attachToSlots(
        Style.make({ root: Style.slot({ padding: "md" }) }),
        slots,
      ),
    );

    let bindings: Component.BindingsOf<typeof Widget> | undefined;
    Effect.runFork(
      Effect.scoped(Component.setupEffect(Widget, {})).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            bindings = value;
          })
        ),
        Effect.catchCause(() => Effect.void),
      ),
    );
    await flush();
    // Setup is still pending, so no attachment has run.
    expect(order).toEqual([]);

    Effect.runSync(Deferred.succeed(gate, "ok"));
    await flush();

    // Setup finished, then the behavior attached. Both strictly after commit.
    expect(order).toEqual(["setup:late", "behavior:attach"]);

    // Style attaches last of all — after the view renders from the committed
    // snapshot — and actually applies (padding token md = 16).
    const view = Component.renderViewWithBindings(Widget, {}, bindings!);
    expect(view?.slots.root.getStyle("padding")).toBe(16);
    expect(order).toEqual(["setup:late", "behavior:attach"]);
  });

  it("an interrupted setup releases resources exactly once and attaches nothing", async () => {
    // Promotion-expansion (2026-08-12): the file pinned the FAILURE path but
    // not interruption — the other way a suspended setup ends early (a
    // navigation away, a request deadline). The commit boundary's promise is
    // identical: nothing downstream runs, everything acquired is released
    // exactly once.
    const anatomy = View.Slots.define({
      root: { capability: Element.Capability.Container },
    });
    const never = Effect.runSync(Deferred.make<string>());
    let attachments = 0;
    let viewRuns = 0;
    let released = 0;

    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>()
        .bind("root", () => Component.slotContainer())
        .value("slots", ({ bindings }) => ({ root: bindings.root }))
        .bind("resource", () =>
          Effect.acquireRelease(
            Effect.succeed("acquired"),
            () =>
              Effect.sync(() => {
                released += 1;
              }),
          ))
        .bind("parked", () => Deferred.await(never)),
      () => {
        viewRuns += 1;
        return "rendered";
      },
    ).pipe(
      Behavior.attachToSlots(
        Behavior.forSlots(anatomy)(() =>
          Effect.sync(() => {
            attachments += 1;
            return {};
          })
        ),
        anatomy,
      ),
    );

    const fiber = Effect.runFork(
      Effect.scoped(Component.setupEffect(Widget, {})),
    );
    await flush();
    // Parked mid-suspension: the resource is held, nothing committed.
    expect(released).toBe(0);
    expect(viewRuns).toBe(0);

    const exit = await Effect.runPromise(
      Fiber.interrupt(fiber).pipe(Effect.flatMap(() => Fiber.await(fiber))),
    );
    expect(Exit.isFailure(exit)).toBe(true);

    // Exactly one release, no attachment, no view — same promise as the
    // failure path, on the interruption path.
    expect(released).toBe(1);
    expect(attachments).toBe(0);
    expect(viewRuns).toBe(0);
  });

  it("bindings are a committed snapshot, not re-derived per render", () => {
    let setupRuns = 0;
    let viewRuns = 0;

    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("n", () =>
        Effect.sync(() => {
          setupRuns += 1;
          return 41;
        })),
      (_props, bindings) => {
        viewRuns += 1;
        return bindings.n + 1;
      },
    );

    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Effect.provideService(Component.setupEffect(Widget, {}), Scope.Scope, scope),
    );

    expect(Component.renderWithBindings(Widget, {}, bindings)).toBe(42);
    expect(Component.renderWithBindings(Widget, {}, bindings)).toBe(42);

    expect(setupRuns).toBe(1);
    expect(viewRuns).toBe(2);

    Effect.runSync(Scope.close(scope, Exit.void));
  });
});
