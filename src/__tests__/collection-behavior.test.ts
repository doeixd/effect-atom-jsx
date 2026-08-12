/**
 * K0b — `collection`, the load-bearing invisible behaviour. Promoted from
 * `future/components/collection.spec.ts` (all green 2026-08-12), retyped.
 *
 * Owning doc: `docs/COMPONENT_KIT_PLAN.md` K0b.1; requirements list:
 * `docs/kit-research/behaviors/collection.md` §9 "Tests day one".
 *
 * Every fixture is built inside its `it`: `Element.collection` handles are
 * mutable registries and module-scope sharing is a proven hazard
 * (`KIT_LAYER_SPEC_FINDINGS.md` 1.3).
 */
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as Behavior from "../Behavior.js";
import * as Element from "../Element.js";
import { collection } from "../behaviors/collection.js";
import { rovingTabindex } from "../behaviors/roving-tabindex.js";
import { createEffect, createRoot, flush } from "../api.js";

/** Three focusable items plus a collection handle over them, fresh per spec. */
function itemsFixture(count = 3) {
  const items = Array.from({ length: count }, () => Element.focusable());
  return {
    items,
    handle: Element.collection(items),
    container: Element.container(),
  };
}

describe("collection: ordered registry", () => {
  it("three registered items expose DOM order, and index lookups agree with it", () => {
    const { items, handle } = itemsFixture(3);

    // No config at all: every knob must come from the Schema's declared
    // defaults (the K0b options contract).
    const attached = Effect.runSync(
      Behavior.attachScoped(collection(), { items: handle }),
    );

    expect(attached.bindings.size()).toBe(3);
    // Order is the collection's (DOM) order, not registration order.
    expect(attached.bindings.items()).toEqual(items);
    expect(items.map((item) => attached.bindings.indexOf(item))).toEqual([0, 1, 2]);
    expect(attached.bindings.getByIndex(1)).toBe(items[1]);
    // Out-of-range reads are `undefined`, never a throw or a wrapped item.
    expect(attached.bindings.getByIndex(3)).toBeUndefined();
    expect(attached.bindings.indexOf(Element.focusable())).toBe(-1);

    // setPosInSet defaults to false, so the behaviour writes no ARIA of its
    // own — the negative control for the posinset spec below.
    expect(items[0]!.getAttr("aria-posinset")).toBeUndefined();
    expect(items[0]!.getAttr("aria-setsize")).toBeUndefined();

    Effect.runSync(attached.dispose);
  });

  it("removing the middle item recompacts indices for the survivors", () => {
    const { items, handle } = itemsFixture(3);
    const [first, middle, last] = items;

    const attached = Effect.runSync(
      Behavior.attachScoped(collection(), { items: handle }),
    );
    expect(attached.bindings.indexOf(last!)).toBe(2);

    // "Dispose the middle item" at the Element layer is the parent removing
    // it from the collection — the behaviour must track the change
    // reactively.
    handle.set([first!, last!]);

    expect(attached.bindings.size()).toBe(2);
    expect(attached.bindings.items()).toEqual([first, last]);
    expect(attached.bindings.indexOf(last!)).toBe(1);
    expect(attached.bindings.indexOf(middle!)).toBe(-1);
    expect(attached.bindings.getByIndex(2)).toBeUndefined();

    Effect.runSync(attached.dispose);
  });

  it("setPosInSet publishes 1-based posinset/setsize and re-numbers on change", () => {
    const { items, handle } = itemsFixture(3);
    const [first, middle, last] = items;

    const attached = Effect.runSync(
      Behavior.attachScoped(collection({ setPosInSet: true }), { items: handle }),
    );

    expect(items.map((item) => item.getAttr("aria-posinset"))).toEqual([1, 2, 3]);
    expect(items.map((item) => item.getAttr("aria-setsize"))).toEqual([3, 3, 3]);

    handle.set([first!, last!]);

    // The survivors renumber: a stale posinset is an ARIA lie a screen
    // reader reads aloud.
    expect(first!.getAttr("aria-posinset")).toBe(1);
    expect(last!.getAttr("aria-posinset")).toBe(2);
    expect([first!, last!].map((item) => item.getAttr("aria-setsize"))).toEqual([2, 2]);
    // Deliberately no assertion about `middle`: it left the collection, so
    // its stale attributes are unobservable (its element is unmounted).
    expect(middle).toBeDefined();

    Effect.runSync(attached.dispose);
  });

  it("disabled items keep their index but are skipped by the navigation projection", () => {
    const { items, handle } = itemsFixture(3);
    const [first, middle, last] = items;

    const tracked = Effect.runSync(
      Behavior.attachScoped(collection(), { items: handle }),
    );
    expect(tracked.bindings.enabledIndices()).toEqual([0, 1, 2]);

    tracked.bindings.setDisabled(middle!, true);

    // Index stability: the disabled item stays in `items` at index 1 …
    expect(tracked.bindings.size()).toBe(3);
    expect(tracked.bindings.indexOf(middle!)).toBe(1);
    expect(tracked.bindings.isDisabled(middle!)).toBe(true);
    // … and is only absent from the navigation projection.
    expect(tracked.bindings.enabledIndices()).toEqual([0, 2]);
    expect(tracked.bindings.enabledItems()).toEqual([first, last]);

    // Re-enabling is symmetric (not a one-way flag).
    tracked.bindings.setDisabled(middle!, false);
    expect(tracked.bindings.isDisabled(middle!)).toBe(false);
    expect(tracked.bindings.enabledIndices()).toEqual([0, 1, 2]);

    Effect.runSync(tracked.dispose);

    // Negative control for the skip: with trackDisabled off, the same
    // disabled flag changes nothing. Without this, "always skip" and "never
    // skip" are indistinguishable from the spec above.
    const untrackedFixture = itemsFixture(3);
    const untracked = Effect.runSync(
      Behavior.attachScoped(collection({ trackDisabled: false }), {
        items: untrackedFixture.handle,
      }),
    );
    untracked.bindings.setDisabled(untrackedFixture.items[1]!, true);
    expect(untracked.bindings.enabledIndices()).toEqual([0, 1, 2]);
    expect(untracked.bindings.enabledItems()).toEqual(untrackedFixture.items);

    Effect.runSync(untracked.dispose);
  });
});

describe("collection: isolation and disposal", () => {
  it("two sibling collections never cross-register", () => {
    // Two composites, each owning its registry — the research doc's
    // "nested-local, no global" decision.
    const left = itemsFixture(3);
    const right = itemsFixture(2);

    const leftAttached = Effect.runSync(
      Behavior.attachScoped(collection({ setPosInSet: true }), {
        items: left.handle,
      }),
    );
    const rightAttached = Effect.runSync(
      Behavior.attachScoped(collection({ setPosInSet: true }), {
        items: right.handle,
      }),
    );

    expect(leftAttached.bindings.size()).toBe(3);
    expect(rightAttached.bindings.size()).toBe(2);

    // Mutating one registry is invisible to the other …
    right.handle.set([right.items[0]!]);
    expect(rightAttached.bindings.size()).toBe(1);
    expect(leftAttached.bindings.size()).toBe(3);
    expect(leftAttached.bindings.items()).toEqual(left.items);
    expect(left.items.map((item) => item.getAttr("aria-setsize"))).toEqual([3, 3, 3]);

    // … and so is per-item metadata: a disabled flag must not be keyed on
    // anything shared between the two behaviours.
    leftAttached.bindings.setDisabled(left.items[1]!, true);
    expect(rightAttached.bindings.isDisabled(right.items[0]!)).toBe(false);
    expect(rightAttached.bindings.enabledIndices()).toEqual([0]);

    // Disposing one leaves the other fully live.
    Effect.runSync(leftAttached.dispose);
    right.handle.set(right.items);
    expect(rightAttached.bindings.size()).toBe(2);
    expect(right.items.map((item) => item.getAttr("aria-posinset"))).toEqual([1, 2]);

    Effect.runSync(rightAttached.dispose);
  });

  it("Scope close unregisters exactly once: later collection changes touch nothing", () => {
    const { items, handle } = itemsFixture(2);

    const attached = Effect.runSync(
      Behavior.attachScoped(collection({ setPosInSet: true }), { items: handle }),
    );
    // Live: the observer is registered and writing ARIA.
    expect(items.map((item) => item.getAttr("aria-posinset"))).toEqual([1, 2]);

    Effect.runSync(attached.dispose);
    // Exact-once: a second dispose must be a no-op, not a second unregister.
    Effect.runSync(attached.dispose);

    // A parent that mutates the collection after the widget unmounted must
    // not reach a disposed behaviour.
    const late = Element.focusable();
    expect(() => handle.set([items[0]!, late])).not.toThrow();
    expect(late.getAttr("aria-posinset")).toBeUndefined();
    expect(late.getAttr("aria-setsize")).toBeUndefined();
  });
});

describe("collection: invalidation granularity (characterization)", () => {
  // Promotion-expansion (2026-08-12): the original spec WITHDREW this
  // observation for lack of a subscription harness — `createRoot` +
  // `createEffect` is that harness. KIT_LAYER_SPEC_FINDINGS §4 records that
  // `collection` bumps a single version atom, so ANY item change invalidates
  // EVERY derived value. This pins the current behaviour as a canary: the
  // negative control proves the harness has teeth (no change → no rerun),
  // and the metadata-only case documents the over-invalidation. If the
  // granularity is ever fixed, the last assertion flips — update it, and
  // celebrate.
  it("a metadata-only change invalidates the membership projection too", () => {
    const { items, handle } = itemsFixture(3);
    const attached = Effect.runSync(
      Behavior.attachScoped(collection(), { items: handle }),
    );

    let membershipRuns = 0;
    const mounted = createRoot((dispose) => {
      createEffect(() => {
        attached.bindings.items();
        membershipRuns += 1;
        return undefined;
      });
      return { dispose };
    });
    flush();
    expect(membershipRuns).toBe(1);

    // NEGATIVE CONTROL: no change → no recompute. Without this, "reruns on
    // everything" and "reruns on schedule" would be indistinguishable.
    flush();
    expect(membershipRuns).toBe(1);

    // A REAL membership change reruns the subscriber — the harness observes
    // genuine invalidation, not polling.
    handle.set([items[0]!, items[2]!]);
    flush();
    expect(membershipRuns).toBe(2);

    // The documented over-invalidation: a disabled-flag change (pure
    // metadata — membership is untouched) also reruns the membership
    // subscriber, because one version atom carries every projection.
    attached.bindings.setDisabled(items[0]!, true);
    flush();
    expect(membershipRuns).toBe(3);

    mounted.dispose();
    Effect.runSync(attached.dispose);
  });
});

describe("collection: integration", () => {
  it("a collection feeds rovingTabindex: one tab stop, disabled items skipped, indices recompact", () => {
    const fixture = itemsFixture(3);
    const { items, handle, container } = fixture;
    const [first, middle, last] = items;

    const registry = Effect.runSync(
      Behavior.attachScoped(collection(), { items: handle }),
    );
    // The composition point: navigation asks the COLLECTION what is
    // skippable, instead of keeping its own parallel disabled list.
    const roving = Effect.runSync(
      Behavior.attachScoped(
        rovingTabindex({
          orientation: "vertical",
          loop: true,
          virtual: false,
          initialIndex: 0,
          isItemDisabled: (item) => registry.bindings.isDisabled(item),
        }),
        { container, items: handle },
      ),
    );

    // Exactly one tab stop, on the initial index.
    expect(items.map((item) => item.getAttr("tabIndex"))).toEqual([0, -1, -1]);

    registry.bindings.setDisabled(middle!, true);
    container.emit("keydown", { key: "ArrowDown" });

    // ArrowDown skips the collection-disabled item entirely.
    expect(roving.bindings.currentIndex()).toBe(2);
    expect(items.map((item) => item.getAttr("tabIndex"))).toEqual([-1, -1, 0]);

    // Removing an item recompacts both projections at once, and the tab stop
    // stays unique — the invariant a leaked stale index breaks.
    handle.set([first!, last!]);
    expect(registry.bindings.size()).toBe(2);
    expect(
      [first!, last!].filter((item) => item.getAttr("tabIndex") === 0).length,
    ).toBe(1);

    container.emit("keydown", { key: "Home" });
    expect(roving.bindings.currentIndex()).toBe(0);
    expect(first!.getAttr("tabIndex")).toBe(0);
    expect(last!.getAttr("tabIndex")).toBe(-1);

    Effect.runSync(roving.dispose);
    Effect.runSync(registry.dispose);
  });
});
