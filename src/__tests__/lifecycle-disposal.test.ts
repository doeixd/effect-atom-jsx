/**
 * Lifecycle correctness for the component/behavior layer.
 *
 * Promoted from future/components/lifecycle-disposal.spec.ts (all green
 * 2026-08-12), retyped.
 *
 * Owning docs: `docs/COMPONENT_KIT_PLAN.md` ("Scope is the lifecycle currency
 * of the whole kit" — house rule 4: *every* widget/machine test asserts
 * exact-once disposal and no-op double-dispose),
 * `docs/DESIGN_IMPROVEMENT_NOTES.md` item 3 (attachScoped `Exclude<Req, Scope>`).
 *
 * These are the negative guarantees the kit sells: nothing survives disposal,
 * every finalizer runs exactly once, and a re-attached (resumed) widget is
 * disposable through the same Scope discipline as a freshly mounted one.
 */
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it } from "vitest";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Diagnostics from "../Diagnostics.js";
import * as Element from "../Element.js";
import * as View from "../View.js";

describe("behavior lifecycle", () => {
  it("[AF-UI] a listener acquired with Element.on is removed when the behavior scope closes", () => {
    const target = Element.interactive();
    let fired = 0;

    const listens = Behavior.make((elements: { target: Element.Interactive }) =>
      Effect.gen(function* () {
        // `on` is the ergonomic form every catalog behavior uses. Its contract
        // must be: removal is owned by the ambient Effect Scope, so that a
        // behavior attached outside a reactive render owner (the resume /
        // reattach path) still cleans up.
        yield* elements.target.on("click", () => {
          fired += 1;
        });
        return {};
      })
    );

    const attached = Effect.runSync(Behavior.attachScoped(listens, { target }));
    target.emit("click", {});
    expect(fired).toBe(1);

    Effect.runSync(attached.dispose);
    target.emit("click", {});

    // THE guarantee. If this is 2, every catalog behavior leaks its listeners
    // on the reattachment path.
    expect(fired).toBe(1);
  });

  it("[AF-UI] disposal runs each finalizer exactly once and double-dispose is a no-op", async () => {
    let released = 0;
    let interrupted = 0;

    const b = Behavior.make(() =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.sync(() => {
            released += 1;
          }));
        yield* Effect.forkScoped(
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted += 1;
              })
            ),
          ),
        );
        return {};
      })
    );

    const attached = Effect.runSync(
      Behavior.attachScoped(b, { target: Element.interactive() }),
    );

    await Effect.runPromise(attached.dispose);
    await Effect.runPromise(attached.dispose);
    await Effect.runPromise(attached.dispose);
    await Effect.runPromise(Effect.sleep("20 millis"));

    expect(released).toBe(1);
    expect(interrupted).toBe(1);
  });

  it("[AF-UI] a failed attach releases everything it acquired before failing", () => {
    const target = Element.interactive();
    let released = 0;
    let fired = 0;

    const b = Behavior.make((elements: { target: Element.Interactive }) =>
      Effect.gen(function* () {
        yield* elements.target.on("click", () => {
          fired += 1;
        });
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.sync(() => {
            released += 1;
          }));
        return yield* Effect.fail({ _tag: "AttachFailed" as const });
      })
    );

    const exit = Effect.runSyncExit(Behavior.attachScoped(b, { target }));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(released).toBe(1);

    target.emit("click", {});
    expect(fired).toBe(0);
  });

  it("[DIN-3] attachScoped's Exclude<Req, Scope> is sound: the fresh Scope satisfies the behavior's Scope requirement and disposes it", () => {
    let released = 0;
    let scopeSeen = false;

    // A behavior that explicitly requires Scope. `attachScoped` erases Scope
    // from the requirement type; the cast is only sound if the scope it
    // provides is the one that actually closes on `dispose`.
    const b = Behavior.make(() =>
      Effect.gen(function* () {
        const scope = yield* Effect.service(Scope.Scope);
        scopeSeen = scope !== undefined;
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            released += 1;
          }),
        );
        return {};
      })
    );

    const attached = Effect.runSync(
      Behavior.attachScoped(b, { target: Element.interactive() }),
    );
    expect(scopeSeen).toBe(true);
    expect(released).toBe(0);

    Effect.runSync(attached.dispose);
    expect(released).toBe(1);
  });

  it("[AF-UI] the same behavior attached to two element sets keeps independent lifetimes", () => {
    const first = Element.interactive();
    const second = Element.interactive();
    const hits: Array<string> = [];

    const b = Behavior.make((elements: { target: Element.Interactive }) =>
      Effect.gen(function* () {
        yield* elements.target.on("click", () => {
          hits.push(elements.target.id);
        });
        return {};
      })
    );

    const a1 = Effect.runSync(Behavior.attachScoped(b, { target: first }));
    const a2 = Effect.runSync(Behavior.attachScoped(b, { target: second }));

    Effect.runSync(a1.dispose);
    first.emit("click", {});
    second.emit("click", {});

    // Disposing one attachment must not disarm the other, and must fully
    // disarm itself.
    expect(hits).toEqual([second.id]);

    Effect.runSync(a2.dispose);
    second.emit("click", {});
    expect(hits).toEqual([second.id]);
  });
});

describe("component-scope disposal", () => {
  it("[AF-UI] closing the setup scope removes every listener a slot behavior installed", () => {
    const anatomy = View.Slots.define({
      root: { capability: Element.Capability.Container },
    });
    let fired = 0;

    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>()
        .bind("root", () => Component.slotContainer())
        .value("slots", ({ bindings }) => ({ root: bindings.root })),
      () => null,
    ).pipe(
      Behavior.attachToSlots(
        Behavior.forSlots(anatomy)((elements) =>
          Effect.gen(function* () {
            yield* elements.root.on("click", () => {
              fired += 1;
            });
            return {};
          })
        ),
        anatomy,
      ),
    );

    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Effect.provideService(Component.setupEffect(Widget, {}), Scope.Scope, scope),
    );

    bindings.slots.root.emit("click", {});
    expect(fired).toBe(1);

    Effect.runSync(Scope.close(scope, Exit.void));
    bindings.slots.root.emit("click", {});

    // A widget that unmounts mid-interaction must leave no live listener.
    expect(fired).toBe(1);
  });

  it("[AF-UI] double-attaching the same behavior to one slot is diagnosed rather than silently duplicated", () => {
    // RATIFIED DQ-058 (2026-08-12, TRIAGE-2026-08-12.md item 1): a repeat
    // attach of the SAME behavior to a slot it already occupies emits a
    // `component:duplicate-attachment` diagnostic through the opt-in
    // diagnostics reporter. The diagnostic REPORTS — it does not
    // de-duplicate — and two DIFFERENT behaviors on one slot stay silent.
    const Root = View.Slot.make("root", { capability: Element.Capability.Container });
    const root = Element.container();
    const slots = View.Slots.make({ root: View.Slot.bind(Root, root) });

    let attaches = 0;
    const counted = Behavior.forSlots(slots)(() =>
      Effect.sync(() => {
        attaches += 1;
        return {};
      }),
    );
    const other = Behavior.forSlots(slots)(() => Effect.succeed({}));

    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().value("slots", () => ({ root })),
      () => null,
    ).pipe(
      Behavior.attachToSlots(counted, slots),
      Behavior.attachToSlots(counted, slots), // the accidental re-pipe DQ-058 names
      Behavior.attachToSlots(other, slots),
    );

    const seen: Diagnostics.Diagnostic[] = [];
    Effect.runSync(
      Effect.scoped(Component.setupEffect(Widget, {})).pipe(
        Effect.provide(Diagnostics.layer((diagnostic) => seen.push(diagnostic))),
      ),
    );

    // Exactly one diagnostic: the SAME behavior twice on `root`. The distinct
    // behavior on the same slot is legal and silent — without that half,
    // "diagnose every second attachment on a slot" would pass.
    expect(
      seen.filter((d) => d.code === "component:duplicate-attachment"),
    ).toMatchObject([{ source: "behavior", slot: "root" }]);
    // REPORTS, not de-duplicates: both attachments still ran.
    expect(attaches).toBe(2);

    // NEGATIVE CONTROL: a single attach of each behavior emits nothing.
    const clean: Diagnostics.Diagnostic[] = [];
    const CleanWidget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().value("slots", () => ({ root })),
      () => null,
    ).pipe(Behavior.attachToSlots(counted, slots), Behavior.attachToSlots(other, slots));
    Effect.runSync(
      Effect.scoped(Component.setupEffect(CleanWidget, {})).pipe(
        Effect.provide(Diagnostics.layer((diagnostic) => clean.push(diagnostic))),
      ),
    );
    expect(
      clean.filter((d) => d.code === "component:duplicate-attachment"),
    ).toEqual([]);
  });
});
