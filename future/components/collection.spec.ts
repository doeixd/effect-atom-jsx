/**
 * K0b — `collection`, the load-bearing invisible behaviour.
 *
 * Owning doc: `docs/COMPONENT_KIT_PLAN.md`, "Mandated coverage per phase" item
 * K0b.1 ("`collection` — currently zero coverage anywhere ... the single
 * biggest gap in the kit today"). Requirements list:
 * `docs/kit-research/behaviors/collection.md` §9 "Tests day one":
 *
 *   - register three items → order matches DOM order;
 *   - dispose the middle one → indices recompact;
 *   - nested/sibling collections stay isolated;
 *   - unregister runs **exact-once** on Scope close;
 *   - integration: the collection feeds `rovingTabindex`.
 *
 * Every fixture is built inside its `it`: `Element.collection` handles are
 * mutable registries and `Slots.define`-style module-scope sharing is a proven
 * hazard (`KIT_LAYER_SPEC_FINDINGS.md` 1.3).
 */
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick } from "../harness.js";

/** Three focusable items plus a collection handle over them, fresh per spec. */
async function itemsFixture(count = 3) {
  const Element = await loadSrc("Element");
  const { focusable, container, collection: collectionHandle } = pick(
    Element,
    "Element",
    "focusable",
    "container",
    "collection",
  );
  const items = Array.from({ length: count }, () => focusable());
  return {
    items,
    handle: collectionHandle(items),
    container: container(),
  };
}

describe("collection: ordered registry", () => {
  it("[K0b] three registered items expose DOM order, and index lookups agree with it", async () => {
    const { collection } = await fromSrc("behaviors/collection", "collection");
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const { items, handle } = await itemsFixture(3);

    // No config at all: every knob must come from the Schema's declared
    // defaults (the K0b options contract).
    const attached: any = Effect.runSync(attachScoped(collection(), { items: handle }));

    expect(attached.bindings.size()).toBe(3);
    // Order is the collection's (DOM) order, not registration order.
    expect(attached.bindings.items()).toEqual(items);
    expect(items.map((item) => attached.bindings.indexOf(item))).toEqual([0, 1, 2]);
    expect(attached.bindings.getByIndex(1)).toBe(items[1]);
    // Out-of-range reads are `undefined`, never a throw or a wrapped item.
    expect(attached.bindings.getByIndex(3)).toBeUndefined();
    expect(attached.bindings.indexOf({ id: "not-a-member" } as any)).toBe(-1);

    // setPosInSet defaults to false, so the behaviour writes no ARIA of its
    // own. This is the negative control for the posinset spec below: without
    // it, an implementation that always writes posinset would pass that one.
    expect(items[0]!.getAttr("aria-posinset")).toBeUndefined();
    expect(items[0]!.getAttr("aria-setsize")).toBeUndefined();

    Effect.runSync(attached.dispose);
  });

  it("[K0b] removing the middle item recompacts indices for the survivors", async () => {
    const { collection } = await fromSrc("behaviors/collection", "collection");
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const { items, handle } = await itemsFixture(3);
    const [first, middle, last] = items as [any, any, any];

    const attached: any = Effect.runSync(attachScoped(collection(), { items: handle }));
    expect(attached.bindings.indexOf(last)).toBe(2);

    // "Dispose the middle item" at the Element layer is the parent removing it
    // from the collection — the behaviour must track the change reactively.
    handle.set([first, last]);

    expect(attached.bindings.size()).toBe(2);
    expect(attached.bindings.items()).toEqual([first, last]);
    expect(attached.bindings.indexOf(last)).toBe(1);
    expect(attached.bindings.indexOf(middle)).toBe(-1);
    expect(attached.bindings.getByIndex(2)).toBeUndefined();

    Effect.runSync(attached.dispose);
  });

  it("[K0b] setPosInSet publishes 1-based posinset/setsize and re-numbers on change", async () => {
    const { collection } = await fromSrc("behaviors/collection", "collection");
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const { items, handle } = await itemsFixture(3);
    const [first, middle, last] = items as [any, any, any];

    const attached: any = Effect.runSync(
      attachScoped(collection({ setPosInSet: true }), { items: handle }),
    );

    expect(items.map((item) => item.getAttr("aria-posinset"))).toEqual([1, 2, 3]);
    expect(items.map((item) => item.getAttr("aria-setsize"))).toEqual([3, 3, 3]);

    handle.set([first, last]);

    // The survivors renumber: a stale posinset is an ARIA lie a screen reader
    // reads aloud.
    expect(first.getAttr("aria-posinset")).toBe(1);
    expect(last.getAttr("aria-posinset")).toBe(2);
    expect([first, last].map((item) => item.getAttr("aria-setsize"))).toEqual([2, 2]);
    // Deliberately no assertion about `middle`: it left the collection, so its
    // stale attributes are unobservable (its element is unmounted). Asserting
    // they are cleared would pin an implementation choice nothing depends on.
    expect(middle).toBeDefined();

    Effect.runSync(attached.dispose);
  });

  it("[K0b] disabled items keep their index but are skipped by the navigation projection", async () => {
    const { collection } = await fromSrc("behaviors/collection", "collection");
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const { items, handle } = await itemsFixture(3);
    const [first, middle, last] = items as [any, any, any];

    const tracked: any = Effect.runSync(attachScoped(collection(), { items: handle }));
    expect(tracked.bindings.enabledIndices()).toEqual([0, 1, 2]);

    tracked.bindings.setDisabled(middle, true);

    // Index stability: the disabled item stays in `items` at index 1 …
    expect(tracked.bindings.size()).toBe(3);
    expect(tracked.bindings.indexOf(middle)).toBe(1);
    expect(tracked.bindings.isDisabled(middle)).toBe(true);
    // … and is only absent from the navigation projection.
    expect(tracked.bindings.enabledIndices()).toEqual([0, 2]);
    expect(tracked.bindings.enabledItems()).toEqual([first, last]);

    // Re-enabling is symmetric (not a one-way flag).
    tracked.bindings.setDisabled(middle, false);
    expect(tracked.bindings.isDisabled(middle)).toBe(false);
    expect(tracked.bindings.enabledIndices()).toEqual([0, 1, 2]);

    Effect.runSync(tracked.dispose);

    // Negative control for the skip: with trackDisabled off, the same disabled
    // flag changes nothing. Without this, "always skip" and "never skip" are
    // indistinguishable from the spec above.
    const untrackedFixture = await itemsFixture(3);
    const untracked: any = Effect.runSync(
      attachScoped(collection({ trackDisabled: false }), {
        items: untrackedFixture.handle,
      }),
    );
    untracked.bindings.setDisabled(untrackedFixture.items[1], true);
    expect(untracked.bindings.enabledIndices()).toEqual([0, 1, 2]);
    expect(untracked.bindings.enabledItems()).toEqual(untrackedFixture.items);

    Effect.runSync(untracked.dispose);
  });
});

describe("collection: isolation and disposal", () => {
  it("[K0b] two sibling collections never cross-register", async () => {
    const { collection } = await fromSrc("behaviors/collection", "collection");
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");

    // Two composites, each owning its registry — the research doc's
    // "nested-local, no global" decision.
    const left = await itemsFixture(3);
    const right = await itemsFixture(2);

    const leftAttached: any = Effect.runSync(
      attachScoped(collection({ setPosInSet: true }), { items: left.handle }),
    );
    const rightAttached: any = Effect.runSync(
      attachScoped(collection({ setPosInSet: true }), { items: right.handle }),
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
    leftAttached.bindings.setDisabled(left.items[1], true);
    expect(rightAttached.bindings.isDisabled(right.items[0])).toBe(false);
    expect(rightAttached.bindings.enabledIndices()).toEqual([0]);

    // Disposing one leaves the other fully live.
    Effect.runSync(leftAttached.dispose);
    right.handle.set(right.items);
    expect(rightAttached.bindings.size()).toBe(2);
    expect(right.items.map((item) => item.getAttr("aria-posinset"))).toEqual([1, 2]);

    Effect.runSync(rightAttached.dispose);
  });

  it("[K0b] Scope close unregisters exactly once: later collection changes touch nothing", async () => {
    const { collection } = await fromSrc("behaviors/collection", "collection");
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const { focusable } = await fromSrc("Element", "focusable");
    const { items, handle } = await itemsFixture(2);

    const attached: any = Effect.runSync(
      attachScoped(collection({ setPosInSet: true }), { items: handle }),
    );
    // Live: the observer is registered and writing ARIA.
    expect(items.map((item) => item.getAttr("aria-posinset"))).toEqual([1, 2]);

    Effect.runSync(attached.dispose);
    // Exact-once: a second dispose must be a no-op, not a second unregister.
    Effect.runSync(attached.dispose);

    // A parent that mutates the collection after the widget unmounted must not
    // reach a disposed behaviour. Today the collection's `observeEach` cleanup
    // is registered on the *reactive owner* via `onCleanup`, not on the ambient
    // Effect Scope (findings 1.1), so the observer survives `dispose`: the
    // surviving observer's `bump()` writes to a closed `Component.state` and
    // throws "cannot write component-local state after its setup scope has
    // closed". Expected RED, and the throw is the diagnosis.
    const late = focusable();
    expect(() => handle.set([items[0]!, late])).not.toThrow();
    expect(late.getAttr("aria-posinset")).toBeUndefined();
    expect(late.getAttr("aria-setsize")).toBeUndefined();
  });

  // NOT SPECIFIED HERE, deliberately: `collection` bumps a single version atom,
  // so *any* item change invalidates *every* derived value
  // (KIT_LAYER_SPEC_FINDINGS §4). A recomputation counter was attempted and
  // withdrawn: reading an `Atom.derived` by calling it recomputes on every call
  // even when nothing changed, so the necessary negative control ("no change →
  // no recompute") fails and the over-invalidation assertion would prove
  // nothing. Observing it needs a subscription-based read harness
  // (`Registry`/`subscribe`) that no spec in `future/components` has yet; that
  // harness, not this behaviour, is the missing piece.
});

describe("collection: integration", () => {
  it("[K0b] a collection feeds rovingTabindex: one tab stop, disabled items skipped, indices recompact", async () => {
    const { collection } = await fromSrc("behaviors/collection", "collection");
    const { rovingTabindex } = await fromSrc(
      "behaviors/roving-tabindex",
      "rovingTabindex",
    );
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const fixture = await itemsFixture(3);
    const { items, handle, container } = fixture;
    const [first, middle, last] = items as [any, any, any];

    const registry: any = Effect.runSync(
      attachScoped(collection(), { items: handle }),
    );
    // The composition point: navigation asks the *collection* what is
    // skippable, instead of keeping its own parallel disabled list.
    const roving: any = Effect.runSync(
      attachScoped(
        // Every Schema field is supplied explicitly so this spec cannot fail
        // for defect 1.2 (partial config throws) — that is behavior-catalog's
        // spec, not this one's.
        rovingTabindex({
          orientation: "vertical",
          loop: true,
          virtual: false,
          initialIndex: 0,
          isItemDisabled: (item: any) => registry.bindings.isDisabled(item),
        }),
        { container, items: handle },
      ),
    );

    // Exactly one tab stop, on the initial index.
    expect(items.map((item) => item.getAttr("tabIndex"))).toEqual([0, -1, -1]);

    registry.bindings.setDisabled(middle, true);
    container.emit("keydown", { key: "ArrowDown" });

    // ArrowDown skips the collection-disabled item entirely.
    expect(roving.bindings.currentIndex()).toBe(2);
    expect(items.map((item) => item.getAttr("tabIndex"))).toEqual([-1, -1, 0]);

    // Removing an item recompacts both projections at once, and the tab stop
    // stays unique — the invariant a leaked stale index breaks.
    handle.set([first, last]);
    expect(registry.bindings.size()).toBe(2);
    expect(
      [first, last].filter((item) => item.getAttr("tabIndex") === 0).length,
    ).toBe(1);

    container.emit("keydown", { key: "Home" });
    expect(roving.bindings.currentIndex()).toBe(0);
    expect(first.getAttr("tabIndex")).toBe(0);
    expect(last.getAttr("tabIndex")).toBe(-1);

    Effect.runSync(roving.dispose);
    Effect.runSync(registry.dispose);
  });
});
