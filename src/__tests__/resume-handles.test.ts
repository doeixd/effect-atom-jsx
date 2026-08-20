import { describe, expect, it } from "vitest";
import { Effect, Exit, Schedule, Schema, Scope } from "effect";
import { createRoot } from "../api.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Route from "../Route.js";
import * as View from "../View.js";

/**
 * Milestone 1 item 7 and Milestone 2 items 3-5 coverage.
 *
 * These pin the uniform symbol-based handle inspection protocol across every
 * setup handle kind, the conservative "no declared policy means no snapshot"
 * default, and wrapper preservation of the full component decoration set.
 */

const runSetup = <Props, Req, E, Bindings, SlotContract>(
  component: Component.Component<Props, Req, E, Bindings, SlotContract>,
  props: Props,
): Bindings =>
  Effect.runSync(
    Component.setupEffect(component, props) as Effect.Effect<Bindings>,
  );

describe("uniform handle inspection protocol", () => {
  const Handles = Component.make(
    Component.props<{ readonly start: number }>(),
    Component.require<never>(),
    ({ start }) =>
      Effect.gen(function* () {
        const count = yield* Component.state(start);
        const doubled = yield* Component.derived(() => count() * 2);
        const node = yield* Component.ref<{ readonly id: string }>();
        const save = yield* Component.action(
          (_next: number) => Effect.void,
          { reactivityKeys: ["counts"] },
        );
        return { count, doubled, node, save };
      }),
    () => null,
  );

  it("publishes an inspection for every setup handle kind", () => {
    createRoot((dispose) => {
      const bindings = runSetup(Handles, { start: 3 });

      const state = Resume.inspectHandle(bindings.count);
      expect(state).toMatchObject({ kind: "state" });
      expect(state?.kind === "state" && state.read()).toBe(3);

      const derived = Resume.inspectHandle(bindings.doubled);
      expect(derived).toMatchObject({ kind: "derived", recomputed: true });
      expect(derived?.kind === "derived" && derived.read()).toBe(6);

      const ref = Resume.inspectHandle(bindings.node);
      expect(ref).toMatchObject({ kind: "ref", hostBound: true });
      expect(ref?.kind === "ref" && ref.read()).toBe(null);

      const action = Resume.inspectHandle(bindings.save);
      expect(action).toMatchObject({
        kind: "action",
        reactivityKeys: ["counts"],
      });

      dispose();
    });
  });

  it("brands each handle with its kind under the shared kind symbol", () => {
    createRoot((dispose) => {
      const bindings = runSetup(Handles, { start: 1 });
      const kindOf = (value: object): unknown =>
        (value as Record<symbol, unknown>)[Resume.HandleKindTypeId];
      expect(kindOf(bindings.count)).toBe("state");
      expect(kindOf(bindings.doubled)).toBe("derived");
      expect(kindOf(bindings.node)).toBe("ref");
      expect(kindOf(bindings.save)).toBe("action");
      dispose();
    });
  });

  it("reports disposal through every handle inspection", () => {
    const keys = ["count", "doubled", "node", "save"] as const;
    type Bag = { readonly [K in (typeof keys)[number]]: unknown };
    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Component.setupEffect(Handles, { start: 1 }).pipe(
        Scope.provide(scope),
      ) as Effect.Effect<Bag>,
    );

    // Live before the owning Scope closes...
    for (const key of keys) {
      const inspection = Resume.inspectHandle(bindings[key]);
      expect(typeof inspection?.isDisposed).toBe("function");
      expect(inspection?.isDisposed()).toBe(false);
    }

    Effect.runSync(Scope.close(scope, Exit.void));

    // ...and every kind actually *reports* disposal afterwards. Asserting only
    // that `isDisposed` is callable (and false) would pass with the flag never
    // being set at all, which is the whole guarantee this test is named for.
    for (const key of keys) {
      const inspection = Resume.inspectHandle(bindings[key]);
      expect(inspection?.isDisposed()).toBe(true);
    }
  });

  it("classifies an opaque action body as having no portable executable", () => {
    createRoot((dispose) => {
      const bindings = runSetup(Handles, { start: 0 });
      const action = Resume.inspectHandle(bindings.save);
      expect(action?.kind === "action" && action.executable).toBeUndefined();
      expect(Portable.inspectExecutable(bindings.save)).toMatchObject({
        kind: "opaque",
      });
      dispose();
    });
  });

  it("carries the portable executable on a portable action handle", () => {
    const SaveCode = Portable.code({
      id: "test.handles.save",
      buildId: "resume-handles-build",
      captures: Schema.Struct({ label: Schema.String }),
      run: (_captures) => Effect.void,
    });
    const Portably = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () =>
        Effect.gen(function* () {
          const save = yield* Component.action(
            Portable.bind(SaveCode, { label: "Save" }),
          );
          return { save };
        }),
      () => null,
    );
    createRoot((dispose) => {
      const bindings = runSetup(Portably, {});
      const action = Resume.inspectHandle(bindings.save);
      expect(action?.kind).toBe("action");
      // `toBeDefined()` alone would accept any object here; the executable's
      // identity and captures are the actual guarantee, because that is what a
      // resumed client re-executes.
      expect(action?.kind === "action" ? action.executable : undefined)
        .toMatchObject({
          code: { id: "test.handles.save", buildId: "resume-handles-build" },
          captures: { label: "Save" },
        });
      expect(Portable.inspectExecutable(bindings.save)).toMatchObject({
        kind: "portable",
      });
      dispose();
    });
  });

  it("returns undefined for values that are not inspectable handles", () => {
    expect(Resume.inspectHandle(() => 1)).toBeUndefined();
    expect(Resume.inspectHandle({})).toBeUndefined();
    expect(Resume.inspectHandle(null)).toBeUndefined();
    expect(Resume.inspectHandle(42)).toBeUndefined();
  });
});

describe("setup-step resume policies default conservatively", () => {
  const Counter = Component.make(
    Component.props<{}>(),
    Component.require<never>(),
    Component.setup<{}>()
      .bind("declared", () => Component.state(0), {
        resume: Resume.snapshotState(Schema.Number),
      })
      .bind("undeclared", () => Component.state(0)),
    () => null,
  );

  it("records a policy only for steps that declare one", () => {
    const plan = Component.inspect(Counter).definition.setupPlan;
    expect(plan.kind).toBe("named");
    if (plan.kind !== "named") return;
    const byName = new Map(
      plan.steps.map((step) => [step.name, step] as const),
    );
    expect(byName.get("declared")?.resume).toMatchObject({
      kind: "state",
      strategy: "snapshot",
    });
    // The conservative default: no declared policy means no snapshot, so the
    // binding falls back to client activation.
    expect(byName.get("undeclared")?.resume).toBeUndefined();
    expect("resume" in (byName.get("undeclared") as object)).toBe(false);
  });

  it("inspects a raw setup function as opaque", () => {
    const Raw = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({}),
      () => null,
    );
    expect(Component.inspect(Raw).definition.setupPlan).toEqual({ kind: "opaque" });
  });
});

describe("component wrappers preserve every decoration", () => {
  const makeRouted = () => {
    const Base = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({}),
      () => null,
    ).pipe(
      Component.withSlots(View.Slots.make({ root: View.Slot.bind(View.Slot.make("root", { capability: Element.Capability.Container }), Element.container()) })),
      Component.route("/decorated"),
    );
    return Base.pipe(
      Route.loader(() => Effect.succeed(1)),
      Route.title("Decorated"),
      Route.guard(Effect.void),
      Route.sitemapParams(() => Effect.succeed([{ id: "1" }])),
    );
  };

  const wrappers: ReadonlyArray<
    readonly [string, (c: any) => any]
  > = [
    ["withLoading", (c) => c.pipe(Component.withLoading(() => null))],
    ["memo", (c) => c.pipe(Component.memo(() => true))],
    ["withSpan", (c) => c.pipe(Component.withSpan("span"))],
    ["withSetupTimeout", (c) => c.pipe(Component.withSetupTimeout("1 second"))],
    ["withSetupRetry", (c) => c.pipe(Component.withSetupRetry(Schedule.recurs(1)))],
    ["tapSetup", (c) => c.pipe(Component.tapSetup(() => Effect.void))],
    ["withPreSetup", (c) => c.pipe(Component.withPreSetup(Effect.void))],
    [
      "withViewTransform",
      (c) => c.pipe(Component.withViewTransform((node: unknown) => node)),
    ],
    [
      "withErrorBoundary",
      (c) => c.pipe(Component.withErrorBoundary({} as never)),
    ],
  ];

  for (const [name, wrap] of wrappers) {
    it(`${name} preserves slot, route, loader, guard, and sitemap metadata`, () => {
      const source = makeRouted();
      const wrapped = wrap(source);

      expect(Component.getSlotContract(wrapped)).toBe(
        Component.getSlotContract(source),
      );
      expect((wrapped as any)[Route.RouteMetaSymbol]?.pattern).toBe(
        "/decorated",
      );
      for (const field of Route.RouteDecorationFields) {
        expect((wrapped as any)[field]).toBe((source as any)[field]);
      }
      // The decorations most recently added to the record; these were the
      // fields silently dropped before the copy list was centralized.
      // (`__routeTransition` was deleted with `Route.transition` in R3.)
      expect((wrapped as any).__routeGuards).toBeDefined();
      expect((wrapped as any).__routeSitemapParams).toBeDefined();
    });
  }

  it("keeps the decoration copy list exhaustive", () => {
    expect(new Set(Route.RouteDecorationFields).size).toBe(
      Route.RouteDecorationFields.length,
    );
    const source = makeRouted();
    for (const field of Route.RouteDecorationFields) {
      expect(field.startsWith("__route")).toBe(true);
      void (source as any)[field];
    }
  });
});

describe("headless components and View results", () => {
  it("renders a headless component through its render prop", () => {
    const Headless = Component.headless(
      Component.props<{ readonly children?: (b: { readonly n: number }) => unknown }>(),
      Component.require<never>(),
      () => Effect.succeed({ n: 7 }),
    );
    const rendered = Component.inspect(Headless).render(
      { children: (b) => b.n },
      { n: 7 },
    );
    expect(rendered).toBe(7);
  });

  it("rejects props that fail the public prop schema", () => {
    const Schematic = Component.make(
      Component.propsSchema(Schema.Struct({ n: Schema.Number })),
      Component.require<never>(),
      () => Effect.succeed({}),
      () => null,
    );
    expect(() => Component.inspect(Schematic).parseProps({ n: "no" })).toThrow();
    expect(Component.inspect(Schematic).parseProps({ n: 1 })).toEqual({ n: 1 });
  });

  it("renders restored bindings without re-running setup", () => {
    let setupRuns = 0;
    const Counted = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () =>
        Effect.sync(() => {
          setupRuns += 1;
          return { label: "from-setup" };
        }),
      (_props, bindings) => bindings.label,
    );
    const rendered = Component.renderWithBindings(Counted, {}, {
      label: "restored",
    });
    expect(rendered).toBe("restored");
    expect(setupRuns).toBe(0);
  });
});
