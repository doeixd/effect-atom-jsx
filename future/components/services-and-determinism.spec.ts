/**
 * Kit services: swappable wholesale, isolated per subtree, deterministic.
 *
 * Owning docs: `docs/COMPONENT_KIT_PLAN.md` "Services & layers (`R`)" —
 * *"Anything two widgets share, and anything a test must control, is a
 * `Context.Service` provided by a `Layer` — never a module global … Provision is
 * per-subtree (`Component.withLayer`), so two themed regions or two isolated
 * layer stacks coexist; tests provide deterministic layers wholesale"* — plus
 * mandated coverage items K0b.5 (mock `LiveAnnouncer` captures polite/assertive
 * with **no DOM**), K0b.7 (two sibling subtrees, different layers, no
 * cross-contamination) and K3.10 (injected `Clock`/`Locale` determinism).
 *
 * Two of those three claims are about a *mechanism that already exists*
 * (`Component.withLayer` + `Component.require`), so they are specified
 * executably here and tagged `[AF-UI]`: tagging them `[K0b]` would falsely
 * imply the catalog phase owes the mechanism, when what it owes is the two
 * named services. The services themselves are `unbuilt`, with the reason.
 */
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick, unbuilt } from "../harness.js";

/** What a captured announcement looks like, for the mock below. */
type Announcement = { readonly politeness: "polite" | "assertive"; readonly message: string };

describe("services swap wholesale in tests", () => {
  it("[AF-UI] a widget's announcements go through an injected service a mock captures with no DOM", async () => {
    const Component = await loadSrc("Component");
    const { make, props, require, setup, setupEffect, withLayer } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "setupEffect",
      "withLayer",
    );

    // The shape a kit announcer service must satisfy to be testable: an
    // interface in `R`, never a module-level aria-live region.
    type Announcer = {
      readonly announce: (
        message: string,
        politeness: "polite" | "assertive",
      ) => Effect.Effect<void>;
    };
    const Announcer = Context.Service<Announcer>("future/kit/Announcer");

    const captured: Array<Announcement> = [];
    const mock = Layer.succeed(Announcer, {
      announce: (message, politeness) =>
        Effect.sync(() => {
          captured.push({ politeness, message });
        }),
    });

    // A widget that announces result counts, the way a typeahead/toast does.
    const Results = make(
      props(),
      require(),
      setup().bind("announceCount", ({ props: p }: any) =>
        Effect.gen(function* () {
          const announcer = yield* Announcer;
          return () =>
            Effect.runSync(announcer.announce(`${p.count} results`, "polite"));
        })),
      () => null,
    ).pipe(withLayer(mock));

    const scope = Scope.makeUnsafe();
    const bindings: any = Effect.runSync(
      Effect.provideService(setupEffect(Results, { count: 3 }), Scope.Scope, scope),
    );

    bindings.announceCount();
    await Effect.runPromise(
      Effect.gen(function* () {
        const announcer = yield* Announcer;
        yield* announcer.announce("loading", "assertive");
      }).pipe(Effect.provide(mock)) as any,
    );

    // Both queues are observable, distinctly — a mock that collapses
    // politeness would pass a message-only assertion.
    expect(captured).toEqual([
      { politeness: "polite", message: "3 results" },
      { politeness: "assertive", message: "loading" },
    ]);

    // …and the whole thing ran with no document at all. This is the concrete
    // content of "no DOM in unit tests required if service-injected"
    // (`docs/kit-research/behaviors/live-announce.md` §3–9).
    expect(typeof (globalThis as any).document).toBe("undefined");

    Effect.runSync(Scope.close(scope, Exit.void));
  });

  it("[K0b] the kit's own LiveAnnouncer service + liveAnnounce behavior", async () => {
    // DQ-072 ratified and built: one announce(message, politeness?) method,
    // clear-after-timeout on the Layer maker, mock captures with no DOM.
    const { liveAnnounce, LiveAnnouncer, makeLiveAnnouncer } = await fromSrc(
      "behaviors/live-announce",
      "liveAnnounce",
      "LiveAnnouncer",
      "makeLiveAnnouncer",
    );
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");

    const captured: Array<Announcement> = [];
    const announcer = makeLiveAnnouncer({
      onAnnounce: (message: string, politeness: "polite" | "assertive") =>
        captured.push({ politeness, message }),
    });
    const attached: any = Effect.runSync(
      (attachScoped(liveAnnounce(), {}) as Effect.Effect<any>).pipe(
        Effect.provideService(LiveAnnouncer, announcer),
      ),
    );
    attached.bindings.announce("3 results");
    attached.bindings.announce("loading", "assertive");
    expect(captured).toEqual([
      { politeness: "polite", message: "3 results" },
      { politeness: "assertive", message: "loading" },
    ]);
    expect(typeof (globalThis as any).document).toBe("undefined");
    Effect.runSync(attached.dispose);
  });
});

describe("per-subtree layer isolation", () => {
  it("[AF-UI] two sibling subtrees given different layers do not cross-contaminate", async () => {
    const Component = await loadSrc("Component");
    const { make, props, require, setup, setupEffect, withLayer } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "setupEffect",
      "withLayer",
    );

    // A stack service that owns mutable state — the layer-stack shape, reduced
    // to its essentials so the spec tests isolation and nothing else.
    type LayerStack = {
      readonly push: (name: string) => void;
      readonly entries: () => ReadonlyArray<string>;
    };
    const LayerStack = Context.Service<LayerStack>("future/kit/LayerStack");

    const makeStack = (): LayerStack => {
      const entries: Array<string> = [];
      return { push: (name) => entries.push(name), entries: () => entries };
    };
    const left = makeStack();
    const right = makeStack();
    expect(left).not.toBe(right);

    // ONE component definition, re-piped with a different layer per region.
    // That the two regions differ only by the piped layer is what makes this a
    // test of provision rather than of two hand-built fixtures.
    const Region = (stack: LayerStack) =>
      make(
        props(),
        require(),
        setup().bind("register", ({ props: p }: any) =>
          Effect.gen(function* () {
            const service = yield* LayerStack;
            service.push(p.name);
            return service;
          })),
        () => null,
      ).pipe(withLayer(Layer.succeed(LayerStack, stack)));

    const scope = Scope.makeUnsafe();
    const leftBindings: any = Effect.runSync(
      Effect.provideService(
        setupEffect(Region(left), { name: "left-dialog" }),
        Scope.Scope,
        scope,
      ),
    );
    const rightBindings: any = Effect.runSync(
      Effect.provideService(
        setupEffect(Region(right), { name: "right-dialog" }),
        Scope.Scope,
        scope,
      ),
    );

    // Each subtree saw its own service instance …
    expect(leftBindings.register).toBe(left);
    expect(rightBindings.register).toBe(right);
    // … and each stack holds only its own region's entry. A module global —
    // the failure mode this house rule exists to prevent — yields
    // ["left-dialog", "right-dialog"] in both.
    expect(left.entries()).toEqual(["left-dialog"]);
    expect(right.entries()).toEqual(["right-dialog"]);

    // Later writes stay local too, so the isolation is not just a mount-time
    // coincidence.
    leftBindings.register.push("left-popover");
    expect(right.entries()).toEqual(["right-dialog"]);

    Effect.runSync(Scope.close(scope, Exit.void));
  });
});

describe("determinism", () => {
  it("[K3] a time-dependent widget is deterministic under an injected Clock/Locale", async () => {
    // The plan promises: *"a date picker with an injected clock is deterministic
    // under test; a missing service is a compile error"* (mandated coverage item
    // 10). There is nothing to inject a clock *into*: no `Clock`/`Locale` kit
    // service exists, and no behaviour or widget in `src/` reads the current
    // time or a locale — the only wall-clock read in the kit is `press`'s
    // `Date.now() + 50` click-suppression window (findings §4), which takes no
    // service and is exactly the pattern the claim forbids.
    //
    // Rather than invent a clock-consuming widget to inject into, this is
    // declared open: K3's DatePicker gate owns it. Note the second half of the
    // claim ("a missing service is a compile error") is a *type* obligation and
    // belongs in `src/type-tests/` once the service exists — a runtime spec
    // cannot assert it.
    unbuilt(
      "an injected Clock/Locale service and a time-dependent widget to make deterministic (nothing in src/ consumes a clock service today; press uses wall-clock Date.now directly)",
      "K3",
    );
  });
});
