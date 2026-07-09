import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Diagnostics from "../Diagnostics.js";
import * as Element from "../Element.js";
import * as Route from "../Route.js";
import * as ServerRoute from "../ServerRoute.js";
import * as Style from "../Style.js";
import * as View from "../View.js";

describe("Diagnostics", () => {
  it("normalizes structured view diagnostics with source, severity, and details", () => {
    const view = View.make(
      { root: Element.container(), secret: Element.interactive() },
      null,
      { slotMetadata: { root: View.slot("root"), secret: View.hidden("secret") } },
    );

    const diagnostics = Diagnostics.collectView(view, { slotTargets: ["secret", "missing"] });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "view:hidden-slot",
      "view:unknown-slot",
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.source === "view")).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(Diagnostics.hasErrors(diagnostics)).toBe(true);
    expect(Diagnostics.format(diagnostics[0]!)).toContain("view/view:hidden-slot");
  });

  it("collects component rendered slot contract diagnostics", () => {
    const Slots = View.Slots.define({
      root: { capability: Element.Capability.Container },
    });
    const Bad = Component.make<{}, never, never, { readonly slots: { readonly extra: Element.Container } }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: { extra: Element.container() } }),
      (_props, bindings) => View.make(bindings.slots, null),
    ).pipe(Component.withSlots(Slots));

    const diagnostics = Effect.runSync(Diagnostics.collectComponent(Bad, {}));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "component:missing-declared-slot",
      "component:undeclared-view-slot",
      "component:undeclared-bindings-slot",
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.source === "component")).toBe(true);
  });

  it("collects style platform and behavior attachment diagnostics", () => {
    const view = View.make(
      { input: Element.textInput() },
      null,
      {
        slotMetadata: {
          input: View.slot("input", {
            capability: Element.Capability.TextInput,
            allowedEvents: [View.Event.Input],
          }),
        },
      },
    );
    const style = Style.make({
      input: Style.slot({ color: "red", backdropFilter: "blur(4px)" }),
    });
    const behavior = Behavior.events({ input: [View.Event.Focus] })(
      Behavior.make<{ readonly input: Element.TextInput }>(() => Effect.succeed({})),
    );

    const styleDiagnostics = Diagnostics.collectStylePlatform(style, {
      name: "minimal-style",
      properties: [Style.Property.Color],
    });
    const behaviorDiagnostics = Diagnostics.collectBehaviorAttachment(
      behavior,
      { input: "input" },
      view,
    );

    expect(styleDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(["style:unsupported-property"]);
    expect(styleDiagnostics[0]?.source).toBe("style");
    expect(behaviorDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(["view:unsupported-slot-event"]);
    expect(behaviorDiagnostics[0]?.source).toBe("behavior");
  });

  it("attributes style attachment diagnostics to the style subsystem", () => {
    const view = View.make(
      { root: Element.container() },
      null,
      { slotMetadata: { root: View.slot("root") } },
    );
    const style = Style.make({
      missing: Style.slot({ color: "red" }),
    });

    const diagnostics = Diagnostics.collectStyleAttachment(style, view);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.source).toBe("style");
    expect(diagnostics[0]?.code).toBe("view:unknown-slot");
  });

  it("normalizes string diagnostics from route-like validators", () => {
    const diagnostics = Diagnostics.fromMessages("route", ["Duplicate route id 'home'"]);

    expect(diagnostics).toEqual([
      {
        source: "route",
        severity: "error",
        code: "route:validation",
        message: "Duplicate route id 'home'",
      },
    ]);
  });

  it("reports diagnostics through a deduping reporter layer and summarizes doctor output", () => {
    const seen: Array<Diagnostics.Diagnostic> = [];
    const diagnostic: Diagnostics.Diagnostic = {
      source: "view",
      severity: "error",
      code: "view:unknown-slot",
      message: "Missing slot",
      slot: "missing",
    };

    const out = Effect.runSync(
      Diagnostics.report([diagnostic, diagnostic]).pipe(
        Effect.provide(Diagnostics.layer((item) => seen.push(item))),
      ),
    );
    const report = Diagnostics.doctor(out);

    expect(seen).toEqual([diagnostic]);
    expect(report).toMatchObject({
      ok: false,
      errorCount: 2,
      warningCount: 0,
      infoCount: 0,
    });
    expect(Diagnostics.formatReport(report)).toContain("view:unknown-slot");
  });

  it("can report duplicate diagnostics when dedupe is disabled", () => {
    const seen: Array<Diagnostics.Diagnostic> = [];
    const diagnostic: Diagnostics.Diagnostic = {
      source: "style",
      severity: "warning",
      code: "style:test",
      message: "Style warning",
    };

    Effect.runSync(
      Diagnostics.report([diagnostic, diagnostic]).pipe(
        Effect.provide(Diagnostics.layer((item) => seen.push(item), { dedupe: false })),
      ),
    );

    expect(seen).toEqual([diagnostic, diagnostic]);
    expect(Diagnostics.doctor(seen)).toMatchObject({
      ok: true,
      errorCount: 0,
      warningCount: 2,
    });
  });

  it("collects doctor targets from module-like exports", () => {
    const Page = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({}),
      () => View.fromSlots(View.Slots.define({ root: { capability: Element.Capability.Container } }), null),
    );
    const GoodRoute = Page.pipe(Route.path("/ok"), Route.id("ok"));
    const BadServerRoute = ServerRoute.action({ key: "save" }).pipe(ServerRoute.path("/save"));
    const diagnostic: Diagnostics.Diagnostic = {
      source: "view",
      severity: "warning",
      code: "view:test",
      message: "Test warning",
    };

    const targets = Diagnostics.collectDoctorTargets({
      diagnostics: [diagnostic],
      app: GoodRoute,
      serverRoutes: [BadServerRoute],
      ignored: 123,
    });
    const report = Diagnostics.doctorFromTargets(targets);

    expect(targets.map((target) => target.name)).toEqual(["diagnostics", "app", "serverRoutes"]);
    expect(targets.find((target) => target.name === "app")?.diagnostics).toEqual([]);
    expect(targets.find((target) => target.name === "serverRoutes")?.diagnostics.map((item) => item.source)).toEqual(["server-route"]);
    expect(report).toMatchObject({
      ok: false,
      errorCount: 1,
      warningCount: 1,
      infoCount: 0,
    });
  });

  it("collects only requested doctor exports", () => {
    const warning: Diagnostics.Diagnostic = {
      source: "style",
      severity: "warning",
      code: "style:test",
      message: "Style warning",
    };
    const error: Diagnostics.Diagnostic = {
      source: "route",
      severity: "error",
      code: "route:test",
      message: "Route error",
    };

    const targets = Diagnostics.collectDoctorTargets(
      { warnings: [warning], errors: [error] },
      { exports: ["warnings"] },
    );

    expect(targets).toEqual([{ name: "warnings", diagnostics: [warning] }]);
    expect(Diagnostics.doctorFromTargets(targets).ok).toBe(true);
  });

  it("auto-reports slot-contract diagnostics at render when a reporter layer is present", async () => {
    const seen: Array<Diagnostics.Diagnostic> = [];
    const Slots = View.Slots.define({
      root: { capability: Element.Capability.Container },
    });
    const Bad = Component.make<{}, never, never, { readonly slots: { readonly extra: Element.Container } }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: { extra: Element.container() } }),
      (_props, bindings) => View.make(bindings.slots, null),
    ).pipe(Component.withSlots(Slots));

    await Effect.runPromise(
      Component.renderEffect(Bad, {}).pipe(
        Effect.provide(Diagnostics.layer((diagnostic) => {
          seen.push(diagnostic as Diagnostics.Diagnostic);
        }, { dedupe: true })),
      ),
    );

    expect(seen.map((diagnostic) => diagnostic.code).sort()).toEqual([
      "component:missing-declared-slot",
      "component:undeclared-bindings-slot",
      "component:undeclared-view-slot",
    ]);
    expect(seen.every((diagnostic) => diagnostic.source === "component")).toBe(true);
  });

  it("does not auto-report diagnostics without a reporter layer", async () => {
    const Slots = View.Slots.define({
      root: { capability: Element.Capability.Container },
    });
    const Bad = Component.make<{}, never, never, { readonly slots: { readonly extra: Element.Container } }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ slots: { extra: Element.container() } }),
      (_props, bindings) => View.make(bindings.slots, null),
    ).pipe(Component.withSlots(Slots));

    // Production default: explicit-only — render succeeds without throwing.
    await Effect.runPromise(Component.renderEffect(Bad, {}));
  });

  it("devLayer formats diagnostics for console consumers", () => {
    const seen: Array<Diagnostics.Diagnostic> = [];
    const layer = Diagnostics.devLayer({
      console: false,
      onDiagnostic: (diagnostic) => seen.push(diagnostic),
    });
    const diagnostic: Diagnostics.Diagnostic = {
      source: "component",
      severity: "error",
      code: "component:missing-declared-slot",
      message: "Missing root",
    };

    Effect.runSync(
      Diagnostics.report([diagnostic]).pipe(Effect.provide(layer)),
    );

    expect(seen).toEqual([diagnostic]);
  });
});
