/**
 * Slot contracts at the seams: dynamic/generated attachment validation, and
 * the slot-as-projection direction.
 *
 * Owning docs: `docs/archive/AF_UI_CONTRACT.md`,
 * `docs/SLOT_CONTRACT_UNIFICATION_PLAN.md` (declared-vs-rendered drift),
 * `docs/DESIGN_IMPROVEMENT_NOTES.md` item 11 (slot = named region),
 * `docs/COMPONENT_KIT_PLAN.md` ("attaching the combobox behavior to a slot
 * that lacks text-input capability is a *type error*" — and for the dynamic
 * path, a runtime diagnostic).
 *
 * Compile-time safety covers authored attachment. These specs cover the escape
 * hatch: generated or string-keyed attachment, where the only defence is a
 * runtime diagnostic that must fail closed rather than mis-wire ARIA silently.
 */
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick, unbuilt } from "../harness.js";

describe("dynamic attachment validation", () => {
  it("[AF-UI] a dynamic attachment onto an unknown or hidden slot is diagnosed", async () => {
    const Behavior = await loadSrc("Behavior");
    const { make, validateAttachmentBySlots } = pick(
      Behavior,
      "Behavior",
      "make",
      "validateAttachmentBySlots",
    );
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    const anatomy = Slots.define({
      root: { capability: Capability.Container },
      secret: { capability: Capability.Container, hidden: true },
    });
    const view = fromSlots(anatomy, null);
    const behavior = make(() => Effect.succeed({}));

    expect(validateAttachmentBySlots(behavior, { target: "root" }, view)).toEqual([]);

    // The two failures must be *distinguishable* — one generic "something is
    // wrong" diagnostic would satisfy a length check and tell a generated
    // integration nothing.
    //
    // DELIBERATE ESCAPE HATCH: the casts below are the point of this spec.
    // `validateAttachmentBySlots` exists for the generated/dynamic path where
    // the slot name is a string not known to the type system; the cast models
    // a code generator emitting a name the contract does not have. The
    // compile-time half (DQ-051's `Behavior.attachTo` keyed by the component's
    // slot names) is pinned in `src/type-tests/`, not here.
    const unknownSlot = validateAttachmentBySlots(
      behavior,
      { target: "nope" } as any,
      view,
    );
    const hiddenSlot = validateAttachmentBySlots(behavior, { target: "secret" } as any, view);

    expect(unknownSlot.length).toBeGreaterThan(0);
    expect(hiddenSlot.length).toBeGreaterThan(0);
    expect(unknownSlot[0].code).not.toBe(hiddenSlot[0].code);
    expect(unknownSlot[0].slot).toBe("nope");
    expect(hiddenSlot[0].slot).toBe("secret");

    // ...and a hidden slot becomes attachable when explicitly opted into.
    expect(
      validateAttachmentBySlots(behavior, { target: "secret" } as any, view, {
        allowHidden: true,
      }),
    ).toEqual([]);
  });

  it("[AF-UI] a dynamic attachment demanding an event the slot does not allow is diagnosed", async () => {
    const Behavior = await loadSrc("Behavior");
    const { make, events, validateAttachmentBySlots } = pick(
      Behavior,
      "Behavior",
      "make",
      "events",
      "validateAttachmentBySlots",
    );
    const View = await loadSrc("View");
    const { Slots, fromSlots, Event } = pick(View, "View", "Slots", "fromSlots", "Event");
    const { Capability } = await fromSrc("Element", "Capability");

    const anatomy = Slots.define({
      label: { capability: Capability.Container, allowedEvents: [Event.Press] },
    });
    const behavior = events({ target: ["keydown"] })(make(() => Effect.succeed({})));

    const diagnostics = validateAttachmentBySlots(
      behavior,
      { target: "label" } as any,
      fromSlots(anatomy, null),
    );
    expect(diagnostics.map((d: any) => d.code)).toContain("view:unsupported-slot-event");
  });

  it("[AF-UI] a dynamic attachment onto a slot with too weak a capability is diagnosed", async () => {
    const Behavior = await loadSrc("Behavior");
    const { forSlots, validateAttachmentBySlots } = pick(
      Behavior,
      "Behavior",
      "forSlots",
      "validateAttachmentBySlots",
    );
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    // The behavior needs text input; the rendered slot is a plain container.
    // `forSlots` must RETAIN this contract (DQ-051): today it discards its
    // `slots` argument entirely, so the required capability is recorded
    // nowhere and the check below is unimplementable. Nothing about the
    // retention is asserted directly — it is asserted through the only thing
    // that matters, namely that the validator can see what was required.
    const needed = Slots.define({ target: { capability: Capability.TextInput } });
    const behavior = forSlots(needed)(() => Effect.succeed({}));

    // NEGATIVE CONTROL FIRST: a slot that satisfies the required capability is
    // clean, so an implementation that reports mismatches unconditionally
    // fails here. `Capability.TextInput` against `Capability.TextInput`.
    expect(
      validateAttachmentBySlots(
        behavior,
        // DELIBERATE ESCAPE HATCH — see the first spec: this is the dynamic
        // path, and the cast is what makes it the dynamic path.
        { target: "target" } as any,
        fromSlots(Slots.define({ target: { capability: Capability.TextInput } }), null),
      ),
    ).toEqual([]);

    // ...and so is a slot with a STRICTLY STRONGER capability, because the
    // check is an `Element.extendsCapability` lattice walk, not equality:
    // `TextInput extends Focusable extends Interactive`. Without this control
    // an implementation comparing capability names for equality would pass the
    // rejection spec below while rejecting every legal widening.
    const needsFocusable = forSlots(
      Slots.define({ target: { capability: Capability.Focusable } }),
    )(() => Effect.succeed({}));
    expect(
      validateAttachmentBySlots(
        needsFocusable,
        { target: "target" } as any,
        fromSlots(Slots.define({ target: { capability: Capability.TextInput } }), null),
      ),
    ).toEqual([]);

    const diagnostics = validateAttachmentBySlots(
      behavior,
      { target: "target" } as any,
      fromSlots(Slots.define({ target: { capability: Capability.Container } }), null),
    );

    // Capability is the mechanism that makes mis-wiring a compile error on the
    // authored path. On the generated path it must still fail closed — today a
    // container silently accepts a text-input behavior, i.e. it fails OPEN.
    //
    // DQ-051 consolidates the three spellings of this idea onto one code, so
    // the exact string is now pinned. `a11y:slot-capability-mismatch` and
    // `view:unsupported-slot-event` are near neighbours; asserting the exact
    // code is what stops a generic "something is wrong" from satisfying both
    // this spec and the event spec above.
    expect(diagnostics.map((d: any) => d.code)).toEqual([
      "component:slot-capability-mismatch",
    ]);
    expect(diagnostics.map((d: any) => d.slot)).toEqual(["target"]);
    // Nothing else fired: an over-eager validator that also reports, say, a
    // spurious unknown-slot alongside the real defect is caught here.
    expect(diagnostics.length).toBe(1);
  });

  it("[AF-UI] declared-vs-rendered slot drift on an assembled widget is reported, not silently tolerated", async () => {
    const Component = await loadSrc("Component");
    const {
      make,
      props,
      require,
      setup,
      slotContainer,
      withSlots,
      validateRenderedSlotContract,
    } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "slotContainer",
      "withSlots",
      "validateRenderedSlotContract",
    );
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    const declared = Slots.define({
      root: { capability: Capability.Container },
      footer: { capability: Capability.Container },
    });
    // The view renders only `root` — `footer` is declared but never rendered.
    const renderedOnly = Slots.define({ root: { capability: Capability.Container } });

    const Widget = make(
      props(),
      require(),
      setup()
        .bind("root", () => slotContainer())
        .value("slots", ({ bindings }: any) => ({ root: bindings.root })),
      () => fromSlots(renderedOnly, null),
    ).pipe(withSlots(declared));

    // NEGATIVE CONTROL: a widget whose render covers its declared contract is
    // clean. Without this, an always-report implementation passes.
    // PREMISE CORRECTED (2026-08-12): the faithful shape is DQ-050's —
    // setup declares no slot record and the render instance is the single
    // source of truth. The previous control used the legacy manual
    // `Slots.handles` record, which under per-instance handles is exactly
    // the drift the backstop spec below REQUIRES to be reported.
    const Faithful = make(
      props(),
      require(),
      setup(),
      () => fromSlots(declared, null),
    ).pipe(withSlots(declared));
    expect(
      Effect.runSync(validateRenderedSlotContract(Faithful, {}) as any),
    ).toEqual([]);

    const diagnostics = Effect.runSync(
      validateRenderedSlotContract(Widget, {}) as any,
    ) as ReadonlyArray<any>;

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => String(d.message).includes("footer"))).toBe(true);
  });
});

describe("slot target drift (DQ-051 backstop, lands FIRST)", () => {
  it("[AF-UI] a setup-declared slot that the rendered view does not carry is reported as component:slot-target-drift", async () => {
    // This is the net that makes the DQ-050 migration safe, and the plan is
    // explicit that it lands BEFORE per-instance handles. Today `Style`
    // resolves through the rendered view and `Behavior` resolves through
    // `bindings.slots`; they agree only because `Slots.define` shares handles
    // module-wide. The moment handles become per-instance, a widget whose
    // `bindings.slots` is not a faithful projection of its view starts styling
    // one handle and listening on another — silently, with nothing thrown and
    // nothing logged. So the divergence must be a named diagnostic first.
    const Component = await loadSrc("Component");
    const { make, props, require, setup, withSlots, validateRenderedSlotContract } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "withSlots",
      "validateRenderedSlotContract",
    );
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    const Anatomy = Slots.define({
      root: { capability: Capability.Container },
      label: { capability: Capability.Container },
    });

    // NEGATIVE CONTROL: the DQ-050 shape. Setup declares no slot handles at
    // all; the rendered view is the single source of truth and `bindings.slots`
    // is its projection. Nothing can drift, so nothing is reported.
    const Faithful = make(
      props(),
      require(),
      setup(),
      () => fromSlots(Anatomy, null),
    ).pipe(withSlots(Anatomy));
    expect(
      Effect.runSync(validateRenderedSlotContract(Faithful, {}) as any),
    ).toEqual([]);

    // DRIFT: the legacy shape. Setup materializes its own handles and the view
    // materializes a second, independent set. Every name matches and every
    // capability matches — the only defect is *identity*, which is exactly the
    // defect per-instance handles introduce and the reason this diagnostic has
    // to exist before the migration rather than after it.
    const Drifting = make(
      props(),
      require(),
      setup().value("slots", () => Slots.handles(Anatomy)),
      () => fromSlots(Anatomy, null),
    ).pipe(withSlots(Anatomy));

    const diagnostics = Effect.runSync(
      validateRenderedSlotContract(Drifting, {}) as any,
    ) as ReadonlyArray<any>;

    // Exact code, and only that code. `component:slot-capability-mismatch` and
    // the declared-vs-rendered "missing slot" diagnostic are near neighbours —
    // neither applies here, because names and capabilities both line up. If a
    // single generic code satisfied all three, this suite would be worthless.
    expect(diagnostics.map((d) => d.code)).toEqual(["component:slot-target-drift"]);
    expect(diagnostics.length).toBe(1);
    expect(String(diagnostics[0].message)).toMatch(/root|label/);
  });
});

describe("slot identity", () => {
  it("[AF-UI] two instances of the same widget do not share slot element handles", async () => {
    const Component = await loadSrc("Component");
    const { make, props, require, setup, setupEffect, withSlots } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "setupEffect",
      "withSlots",
    );
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    // `Slots.define` returns a contract/**factory**. It is a declaration, and
    // declarations do not own DOM handles; handles materialize once per
    // instance — per setup/render Scope — never once per module at define time.
    const Anatomy = Slots.define({ root: { capability: Capability.Container } });
    const Widget = make(
      props(),
      require(),
      setup(),
      () => fromSlots(Anatomy, null),
    ).pipe(withSlots(Anatomy));

    const scope = Scope.makeUnsafe();
    const runOnce = () =>
      Effect.runSync(
        Effect.provideService(setupEffect(Widget, {}), Scope.Scope, scope) as any,
      ) as any;

    const first = runOnce();
    const second = runOnce();

    // Sharing them means two mounted widgets write each other's attributes,
    // styles, and listeners — and resume identity cannot tell the two regions
    // apart.
    expect(first.slots.root).not.toBe(second.slots.root);

    // Distinctness of the reference is not enough on its own: two handles
    // could be distinct wrappers over one shared attribute map. Prove the
    // isolation is real by writing through both and reading each back.
    Effect.runSync(first.slots.root.setAttr("data-instance", "first"));
    Effect.runSync(second.slots.root.setAttr("data-instance", "second"));
    expect(first.slots.root.getAttr("data-instance")).toBe("first");
    expect(second.slots.root.getAttr("data-instance")).toBe("second");

    Effect.runSync(Scope.close(scope, Exit.void));
  });

  it("[AF-UI] bindings.slots is a projection of the rendered view, not an independent record", async () => {
    // The DQ-050 decision in one assertion. `Style` already resolves through
    // the rendered view; `Behavior` resolves through `bindings.slots`. Those
    // are only allowed to be two names for one thing.
    const Component = await loadSrc("Component");
    const { make, props, require, setup, setupEffect, renderViewWithBindings, withSlots } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "setupEffect",
      "renderViewWithBindings",
      "withSlots",
    );
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    const Anatomy = Slots.define({
      root: { capability: Capability.Container },
      label: { capability: Capability.Container },
    });
    const Widget = make(
      props(),
      require(),
      setup(),
      () => fromSlots(Anatomy, null),
    ).pipe(withSlots(Anatomy));

    const scope = Scope.makeUnsafe();
    const bindings: any = Effect.runSync(
      Effect.provideService(setupEffect(Widget, {}), Scope.Scope, scope) as any,
    );
    const view: any = renderViewWithBindings(Widget, {}, bindings);

    expect(Object.keys(bindings.slots).sort()).toEqual(["label", "root"]);
    // Identity, not shape: a structurally-equal-but-separate record is exactly
    // the bug (the styles land on one handle, the listeners on the other).
    expect(bindings.slots.root).toBe(view.slots.root);
    expect(bindings.slots.label).toBe(view.slots.label);

    // ...and a write through the projection is visible through the view, which
    // is the observable consequence that makes the identity assertion matter.
    Effect.runSync(bindings.slots.root.setAttr("data-via", "bindings"));
    expect(view.slots.root.getAttr("data-via")).toBe("bindings");

    Effect.runSync(Scope.close(scope, Exit.void));
  });
});

describe("behavior attachment resolves through the rendered view", () => {
  it("[AF-UI] a behavior attached to a slot listens on the handle the view rendered", async () => {
    // The other half of DQ-050: `Behavior.attachToSlots` switches to view
    // resolution, matching `Style`. Today it reads `bindings.slots`, and the
    // two agree ONLY because handles are shared module-wide. Once they are
    // per-instance, a behavior resolving from a setup-owned record installs
    // its listeners on a handle nothing ever mounts — a silent no-op.
    const Component = await loadSrc("Component");
    const { make, props, require, setup, setupEffect, renderViewWithBindings, withSlots } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "setupEffect",
      "renderViewWithBindings",
      "withSlots",
    );
    const Behavior = await loadSrc("Behavior");
    const { make: behaviorMake, attachTo } = pick(
      Behavior,
      "Behavior",
      "make",
      "attachTo",
    );
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    const Anatomy = Slots.define({
      root: { capability: Capability.Container },
      trigger: { capability: Capability.Container },
    });

    const seen: Array<string> = [];
    const listen = behaviorMake((elements: any) =>
      Effect.gen(function* () {
        yield* elements.trigger.on("click", () => seen.push("click"));
        return { listening: true };
      })
    );

    const Widget = make(
      props(),
      require(),
      setup(),
      () => fromSlots(Anatomy, null),
    ).pipe(
      withSlots(Anatomy),
      // DQ-051: keys are `keyof Behavior.ElementsOf<typeof listen>`, values are
      // the *component's* slot names. No cast, no caller-supplied contract.
      attachTo(listen, { trigger: "trigger" }),
    );

    const scope = Scope.makeUnsafe();
    const bindings: any = Effect.runSync(
      Effect.provideService(setupEffect(Widget, {}), Scope.Scope, scope) as any,
    );
    const view: any = renderViewWithBindings(Widget, {}, bindings);

    // Emitting on the VIEW's handle — the one that would be in the document —
    // must reach the behavior. This is what "silent no-op" looks like when it
    // regresses: `seen` stays empty and nothing is thrown.
    view.slots.trigger.emit("click", {});
    expect(seen).toEqual(["click"]);
    expect(bindings.listening).toBe(true);

    // ...and it did NOT wire the wrong slot.
    view.slots.root.emit("click", {});
    expect(seen).toEqual(["click"]);

    Effect.runSync(Scope.close(scope, Exit.void));
  });
});

describe("slot as projection", () => {
  it("[DIN-11] a slot is a named region: it emits its own resume boundary and can be a typed mount target", async () => {
    unbuilt(
      "slot-as-projection-element (`Slot.render name=...`): lazy child evaluation at placement, slot-owned comment-pair region, typed named mount targets for M11b fragments",
      "kit milestone finale (DQ-070 ratified 2026-08-17, unblocked by DQ-050: slot emits its region as itself; typed mount targets for fragments)",
    );
  });
});
