/**
 * A11y as a gate, and the platform-native / zero-JS floor.
 *
 * Owning doc: `docs/COMPONENT_KIT_PLAN.md` — "A11y as a gate, not a feature"
 * (*a widget without a passing pattern contract does not ship*), "The
 * platform-native floor", and "Rung zero: CSS-Tags as the styling floor" (the
 * capability ladder: pure CSS → platform-native → dormant/resumable →
 * activated, each rung additive, none rewriting markup).
 * Research: `docs/kit-research/behaviors/form-control.md`,
 * `docs/kit-research/widgets/dialog.md`.
 */
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick } from "../harness.js";

describe("pattern contract gate", () => {
  it("[K2] a rendered widget view that drops a pattern slot fails A11y.validate, and the complete one passes clean", async () => {
    const A11y = await loadSrc("A11y");
    const { validate, Dialog } = pick(A11y, "A11y", "validate", "Dialog");
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Event } = pick(View, "View", "Event");
    const { Capability } = await fromSrc("Element", "Capability");

    const complete = Slots.define({
      root: { capability: Capability.Container },
      trigger: { capability: Capability.Interactive, allowedEvents: [Event.Press] },
      content: { capability: Capability.Container },
    });
    const incomplete = Slots.define({
      root: { capability: Capability.Container },
      content: { capability: Capability.Container },
    });

    expect(validate(Dialog, fromSlots(complete, null))).toEqual([]);

    const diagnostics = validate(Dialog, fromSlots(incomplete, null));
    expect(diagnostics.map((d: any) => d.code)).toContain("a11y:missing-pattern-slot");
    expect(diagnostics.every((d: any) => d.severity === "error")).toBe(true);
  });

  it("[K2] a pattern slot that renders without the required event is a diagnostic", async () => {
    const A11y = await loadSrc("A11y");
    const { validate, Dialog } = pick(A11y, "A11y", "validate", "Dialog");
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    // The dialog pattern requires `trigger` to accept Press. Rendering the
    // trigger without it must fail the gate — otherwise deleting the whole
    // event-checking branch of `A11y.validate` would go unnoticed.
    const eventless = Slots.define({
      root: { capability: Capability.Container },
      trigger: { capability: Capability.Interactive, allowedEvents: [] },
      content: { capability: Capability.Container },
    });

    const codes = validate(Dialog, fromSlots(eventless, null)).map((d: any) => d.code);
    expect(codes).toContain("a11y:missing-slot-event");
  });

  it("[K2] a pattern slot rendered with too weak a capability is a diagnostic, not a silent downgrade", async () => {
    const A11y = await loadSrc("A11y");
    const { validate, pattern } = pick(A11y, "A11y", "validate", "pattern");
    const View = await loadSrc("View");
    const { Slots, fromSlots } = pick(View, "View", "Slots", "fromSlots");
    const { Capability } = await fromSrc("Element", "Capability");

    const contract = pattern(
      "future-combobox",
      Slots.define({ input: { capability: Capability.TextInput } }),
    );
    const rendered = fromSlots(
      Slots.define({ input: { capability: Capability.Container } }),
      null,
    );

    const codes = validate(contract, rendered).map((d: any) => d.code);
    expect(codes).toContain("a11y:slot-capability-mismatch");
  });

  it("[K3] every shipped kit widget passes its own pattern contract", async () => {
    // The gate, mechanised: iterate the catalog rather than trusting per-widget
    // discipline. A widget in the kit index whose default render fails its
    // pattern contract must fail this spec.
    const kit = await loadSrc("kit/index");
    const { widgets } = pick(kit, "kit/index", "widgets");
    const A11y = await loadSrc("A11y");
    const { validate } = pick(A11y, "A11y", "validate");
    const Component = await loadSrc("Component");
    const { renderViewEffect } = pick(Component, "Component", "renderViewEffect");

    expect(widgets.length).toBeGreaterThan(0);
    for (const widget of widgets as ReadonlyArray<any>) {
      const scope = Scope.makeUnsafe();
      const view = Effect.runSync(
        Effect.provideService(
          renderViewEffect(widget.component, widget.exampleProps ?? {}),
          Scope.Scope,
          scope,
        ) as any,
      );
      expect(validate(widget.pattern, view as any)).toEqual([]);
      Effect.runSync(Scope.close(scope, Exit.void));
    }
  });
});

describe("the zero-JS floor", () => {
  it("[K0b] formControl projects a native input at SSR time, so a dormant custom widget submits in a real form before any JS loads", async () => {
    const { formControl } = await fromSrc("behaviors/form-control", "formControl");
    const { attachScoped } = await fromSrc("Behavior", "attachScoped");
    const Element = await loadSrc("Element");
    const { container } = pick(Element, "Element", "container");
    const { state } = await fromSrc("Component", "state");

    const scope = Scope.makeUnsafe();
    const value = Effect.runSync(
      Effect.provideService(state("red"), Scope.Scope, scope) as any,
    ) as any;

    // The projection is *structural*: the hidden native input is a slot in the
    // anatomy, so SSR emits it, `A11y.validate` can see it, and no raw HTML
    // string is concatenated anywhere (SafeHtml discipline).
    const root = container();
    const hiddenInput = container();
    const attached: any = Effect.runSync(
      Effect.provideService(
        attachScoped(
          formControl({ name: "color", required: true }),
          // DQ-052: `elements` carries ELEMENTS ONLY. The value atom travels
          // on the deps channel, because a dependency smuggled through the
          // elements record is a slot as far as `attachTo` is concerned, and
          // that defeats DQ-051's capability checking outright — the record
          // whose keys are capability-checked would contain a non-element.
          { root, hiddenInput },
          { deps: { value } },
        ) as any,
        Scope.Scope,
        scope,
      ),
    );

    expect(hiddenInput.getAttr("type")).toBe("hidden");
    expect(hiddenInput.getAttr("name")).toBe("color");
    expect(hiddenInput.getAttr("value")).toBe("red");
    expect(hiddenInput.getAttr("required")).toBe(true);

    // The atom stays the single source of truth and the projection follows it —
    // one mechanism, no controlled/uncontrolled split. (Propagation rides the
    // repo's batched reactive scheduler — one microtask — like every other
    // reactive attribute; the guarantee is "follows the atom", not
    // "same-tick".)
    value.set("blue");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hiddenInput.getAttr("value")).toBe("blue");

    // Validity is an atom too, so it composes with `Style.whenBinding` and is
    // snapshotted by resume for free — not an imperative setter.
    attached.bindings.invalid.set(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.getAttr("aria-invalid")).toBe(true);

    Effect.runSync(Scope.close(scope, Exit.void));
  });

  it("[K3] a dormant dialog uses the platform floor: native <dialog> + invoker command, no JS required for the first open", async () => {
    const dialog = await loadSrc("kit/dialog");
    const { Dialog, platformFloor } = pick(dialog, "kit/dialog", "Dialog", "platformFloor");
    const Component = await loadSrc("Component");
    const { renderEffect } = pick(Component, "Component", "renderEffect");
    const { renderToString } = await fromSrc("dom", "renderToString");

    // The floor is declared, per-behavior, as the plan requires: what native
    // covers, what the behavior adds, and the feature-detection seam.
    expect(platformFloor).toMatchObject({
      element: "dialog",
      covers: expect.arrayContaining(["focus-trap", "escape-dismiss", "inert"]),
    });

    const scope = Scope.makeUnsafe();
    const html = renderToString(() =>
      Effect.runSync(
        renderEffect(Dialog, { title: "Hi" }).pipe(Scope.provide(scope)) as any,
      ) as any
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    // Markup that works before activation: an invoker command opens the native
    // dialog with no script at all.
    expect(html).toMatch(/<dialog/);
    expect(html).toMatch(/command="show-modal"/);
    expect(html).toMatch(/commandfor="/);
    // ...and no inline handler smuggles JS into the "zero-JS" claim.
    expect(html).not.toMatch(/onclick=/);
  });

  it("[K1] light/dark theming needs no JavaScript: token values use light-dark()", async () => {
    const Theme = await loadSrc("Theme");
    const { define } = pick(Theme, "Theme", "define");
    const { lightDark } = pick(Theme, "Theme", "lightDark");

    // A dormant page must honour an OS theme change with zero framework code —
    // the platform handles mode, the Theme service only governs which tokens
    // apply.
    const tokens = define({
      color: { surface: lightDark("#ffffff", "#111111") },
    });
    expect(String(tokens.lookup("color.surface"))).toBe(
      "light-dark(#ffffff, #111111)",
    );
  });
});
