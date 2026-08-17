import * as ComponentModule from "../Component.js";
import * as A11yModule from "../A11y.js";
import * as ViewModule from "../View.js";
import * as ElementModule from "../Element.js";
import * as BehaviorModule from "../Behavior.js";
import * as StyleModule from "../Style.js";
import * as MachineModule from "../Machine.js";
import * as ThemeModule from "../Theme.js";
import * as domModule from "../dom.js";
import * as kitIndexModule from "../kit/index.js";
import * as kitDialogModule from "../kit/dialog.js";
import * as kitTimeModule from "../kit/time.js";
import * as formControlModule from "../behaviors/form-control.js";
import * as liveAnnounceModule from "../behaviors/live-announce.js";
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


/** What a captured announcement looks like, for the mock below. */
type Announcement = { readonly politeness: "polite" | "assertive"; readonly message: string };

describe("services swap wholesale in tests", () => {
  it("[AF-UI] a widget's announcements go through an injected service a mock captures with no DOM", async () => {
    const Component = ComponentModule as Record<string, any>;
    const { make, props, require, setup, setupEffect, withLayer } = ((Component) as any);

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
    const { liveAnnounce, LiveAnnouncer, makeLiveAnnouncer } = liveAnnounceModule as Record<string, any>;
    const { attachScoped } = BehaviorModule as Record<string, any>;

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
    const Component = ComponentModule as Record<string, any>;
    const { make, props, require, setup, setupEffect, withLayer } = ((Component) as any);

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
    // Built with K3's first time-holding widget (ratified DQ-066(b)):
    // `kit/time` ships the `Clock`/`Locale` services and `RelativeTime`,
    // which reads BOTH from context — so a test provides fixed layers and
    // owns time and locale wholesale, no fake globals, no sleeping.
    // (`press`'s 50ms window deliberately stays on its function-prop seam —
    // DQ-066(a) — because a suppression window holds no cross-async state.)
    const time = kitTimeModule as Record<string, any>;
    const { Clock, Locale, clockLayer, localeLayer, clockLive, RelativeTime } = ((time) as any);
    const Component = ComponentModule as Record<string, any>;
    const { setupEffect, withLayer } = ((Component) as any);

    const NOW = 1_700_000_000_000;
    const THREE_MINUTES_AGO = NOW - 3 * 60_000;

    const render = (locale: string) => {
      const Deterministic = withLayer(
        Layer.mergeAll(clockLayer(() => NOW), localeLayer(locale)),
      )(RelativeTime);
      const scope = Scope.makeUnsafe();
      const bindings: any = Effect.runSync(
        Effect.provideService(
          setupEffect(Deterministic, { at: THREE_MINUTES_AGO }),
          Scope.Scope,
          scope,
        ) as any,
      );
      const label = bindings.label;
      Effect.runSync(Scope.close(scope, Exit.void));
      return label as string;
    };

    // Deterministic: same injected instant, same output, every run — and the
    // LOCALE is injected too, so the two languages prove the service is read
    // rather than a formatting default.
    expect(render("en")).toBe("3 minutes ago");
    expect(render("en")).toBe("3 minutes ago");
    expect(render("de")).toBe("vor 3 Minuten");

    // NEGATIVE CONTROL: the live clock layer disagrees with the fixed one
    // for an old timestamp (it is not 3 minutes ago in wall-clock time), so
    // an implementation ignoring the injected service cannot pass above.
    const Live = withLayer(
      Layer.mergeAll(clockLive, localeLayer("en")),
    )(RelativeTime);
    const liveScope = Scope.makeUnsafe();
    const liveBindings: any = Effect.runSync(
      Effect.provideService(
        setupEffect(Live, { at: THREE_MINUTES_AGO }),
        Scope.Scope,
        liveScope,
      ) as any,
    );
    expect(liveBindings.label).not.toBe("3 minutes ago");
    Effect.runSync(Scope.close(liveScope, Exit.void));

    // The services are ordinary Context services — the tags are exported so
    // "a missing service is a compile error" can be pinned in type-tests.
    expect(Context.isKey?.(Clock) ?? typeof Clock).toBeTruthy();
    expect(Context.isKey?.(Locale) ?? typeof Locale).toBeTruthy();
  });
});
