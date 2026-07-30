/**
 * The bindings commit boundary.
 *
 * Owning docs: `docs/archive/BINDINGS_ASYNC_COMMIT_BOUNDARY.md`,
 * `docs/archive/PROPS_BINDINGS_SLOTS.md`, `docs/COMPONENT_KIT_PLAN.md`
 * ("Setup is an Effect; bindings are the committed snapshot").
 *
 * The invariant, in order: setup resolves **all** async → bindings commit
 * **atomically** → the view renders from that snapshot → style/behavior
 * effects attach. A view must never observe a half-resolved binding, and a
 * failed setup must attach nothing and leak nothing.
 */
import { Cause, Deferred, Effect, Exit, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick } from "../harness.js";

const flush = (): Promise<void> => Effect.runPromise(Effect.sleep("20 millis"));

describe("bindings commit boundary", () => {
  it("[AF-UI] never renders the view from a partially resolved binding set", async () => {
    const Component = await loadSrc("Component");
    const { make, props, require, setup } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
    );
    const { createRoot } = await fromSrc("api", "createRoot");

    const gateA = Effect.runSync(Deferred.make<number>());
    const gateB = Effect.runSync(Deferred.make<number>());
    const observed: Array<ReadonlyArray<string>> = [];

    const Widget = make(
      props(),
      require(),
      setup()
        .value("sync", () => "committed")
        .bind("a", () => Deferred.await(gateA))
        .bind("b", () => Deferred.await(gateB)),
      (_props: unknown, bindings: Record<string, unknown>) => {
        observed.push(Object.keys(bindings).sort());
        return `${String(bindings["a"])}:${String(bindings["b"])}`;
      },
    );

    const mounted = createRoot((dispose: () => void) => ({
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

  it("[AF-UI] a failed setup attaches no behavior and renders no view", async () => {
    const Component = await loadSrc("Component");
    const { make, props, require, setup, slotContainer, setupEffect } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "slotContainer",
      "setupEffect",
    );
    const { make: behavior, attachToSlots } = await fromSrc(
      "Behavior",
      "make",
      "attachToSlots",
    );
    const { Slots } = await fromSrc("View", "Slots");
    const { Capability } = await fromSrc("Element", "Capability");

    const anatomy = Slots.define({ root: { capability: Capability.Container } });

    let attachments = 0;
    let viewRuns = 0;
    let released = 0;

    const Widget = make(
      props(),
      require(),
      setup()
        .bind("root", () => slotContainer())
        .value("slots", ({ bindings }: any) => ({ root: bindings.root }))
        .bind("resource", () =>
          Effect.acquireRelease(
            Effect.succeed("acquired"),
            () => Effect.sync(() => {
              released += 1;
            }),
          ))
        .bind("boom", () => Effect.fail({ _tag: "SetupFailed" as const })),
      (_props: unknown, _bindings: unknown) => {
        viewRuns += 1;
        return "rendered";
      },
    ).pipe(
      attachToSlots(
        behavior(() =>
          Effect.sync(() => {
            attachments += 1;
            return { attached: true };
          })
        ),
        anatomy,
      ),
    );

    const exit = Effect.runSyncExit(Effect.scoped(setupEffect(Widget, {})));

    expect(Exit.isFailure(exit)).toBe(true);
    // The failure must arrive as the *typed* error in `E`, not as a defect: an
    // error boundary can only match on a tag it can see.
    const failure: any = Exit.isFailure(exit)
      ? (Cause.findErrorOption?.(exit.cause) ?? { _tag: "None" })
      : { _tag: "None" };
    expect(failure._tag === "Some" ? failure.value._tag : undefined).toBe(
      "SetupFailed",
    );
    // Nothing downstream of the failure may have happened.
    expect(attachments).toBe(0);
    expect(viewRuns).toBe(0);
    // ...and everything acquired before the failure is released exactly once.
    expect(released).toBe(1);
  });

  it("[AF-UI] style and behavior effects only observe committed slot handles", async () => {
    const Component = await loadSrc("Component");
    const { make, props, require, setup, slotContainer, setupEffect } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "slotContainer",
      "setupEffect",
    );
    const Behavior = await loadSrc("Behavior");
    const { make: behavior, attachToSlots } = pick(
      Behavior,
      "Behavior",
      "make",
      "attachToSlots",
    );
    const Style = await loadSrc("Style");
    const {
      make: styleMake,
      slot: styleSlot,
      attachToSlots: attachStyle,
    } = pick(Style, "Style", "make", "slot", "attachToSlots");
    const ViewModule = await loadSrc("View");
    const { Slots, fromSlots } = pick(ViewModule, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    const anatomy = Slots.define({ root: { capability: Capability.Container } });
    const order: Array<string> = [];
    const gate = Effect.runSync(Deferred.make<string>());

    const Widget = make(
      props(),
      require(),
      setup()
        .value("slots", () => Slots.handles(anatomy))
        .bind("late", () =>
          Deferred.await(gate).pipe(
            Effect.tap(() => Effect.sync(() => order.push("setup:late")))
          )),
      () => fromSlots(anatomy, null),
    ).pipe(
      attachToSlots(
        behavior((elements: any) =>
          Effect.sync(() => {
            order.push("behavior:attach");
            // The behavior must see a fully-built handle, never undefined.
            expect(elements.root).toBeDefined();
            expect(typeof elements.root.setAttr).toBe("function");
            return {};
          })
        ),
        anatomy,
      ),
      attachStyle(styleMake({ root: styleSlot({ padding: "md" }) }), anatomy),
    );

    const { renderViewWithBindings } = pick(
      Component,
      "Component",
      "renderViewWithBindings",
    );
    let bindings: any;
    Effect.runFork(
      Effect.scoped(setupEffect(Widget, {})).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            bindings = value;
          })
        ),
        Effect.catchCause(() => Effect.void),
      ) as any,
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
    const view: any = renderViewWithBindings(Widget, {}, bindings);
    expect(view.slots.root.getStyle("padding")).toBe(16);
    expect(order).toEqual(["setup:late", "behavior:attach"]);
  });

  it("[AF-UI] bindings are a committed snapshot, not re-derived per render", async () => {
    const Component = await loadSrc("Component");
    const { make, props, require, setup, renderWithBindings, setupEffect } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "renderWithBindings",
      "setupEffect",
    );

    let setupRuns = 0;
    let viewRuns = 0;

    const Widget = make(
      props(),
      require(),
      setup().bind("n", () =>
        Effect.sync(() => {
          setupRuns += 1;
          return 41;
        })),
      (_props: unknown, bindings: any) => {
        viewRuns += 1;
        return bindings.n + 1;
      },
    );

    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Effect.provideService(setupEffect(Widget, {}), Scope.Scope, scope),
    );

    expect(renderWithBindings(Widget, {}, bindings)).toBe(42);
    expect(renderWithBindings(Widget, {}, bindings)).toBe(42);

    expect(setupRuns).toBe(1);
    expect(viewRuns).toBe(2);

    Effect.runSync(Scope.close(scope, Exit.void));
  });
});
