/**
 * K0b — controlled / uncontrolled collapse (`Component.bindable`).
 * Promoted from `future/components/bindable.spec.ts` (all green 2026-08-12).
 *
 * Owning docs: `docs/COMPONENT_KIT_PLAN.md` K0b.4 and
 * `docs/kit-research/behaviors/controlled-uncontrolled.md` ("Snapshot only
 * for setup-owned state"). The two directions are a differential pair: the
 * SAME call site must adopt a caller's atom without overwriting it, and own
 * (and snapshot) state when there is none.
 */
import { Effect, Exit, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import { renderToString } from "../dom.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";

const BuildId = "bindable-test-build";

function makeWidget(name: string) {
  return Component.make(
    Component.props<{ readonly value?: Atom.WritableAtom<string> }>(),
    Component.require<never>(),
    Component.setup<{ readonly value?: Atom.WritableAtom<string> }>().bind(
      "value",
      ({ props }) => Component.bindable(props.value ?? "own-default"),
      { resume: Resume.snapshotState(Schema.String) },
    ),
    (_props, bindings) => `${bindings.value()}`,
  ).pipe(Component.withDefinition({ name }));
}

function collectWidget(
  widget: ReturnType<typeof makeWidget>,
  props: { readonly value?: Atom.WritableAtom<string> },
) {
  const scope = Scope.makeUnsafe();
  const collected = Effect.runSync(
    Resume.collect(
      () =>
        renderToString(() =>
          Effect.runSync(
            Component.renderEffect(widget, props).pipe(Scope.provide(scope)),
          )
        ),
      { buildId: BuildId },
    ).pipe(Effect.provide(Serialization.layer)),
  );
  Effect.runSync(Scope.close(scope, Exit.void));
  return collected;
}

describe("Component.bindable", () => {
  it("adopts an externally supplied atom, never overwriting it on spawn", () => {
    const external = Atom.make("caller-owned");
    const Widget = makeWidget("BindableControlled");

    const scope = Scope.makeUnsafe();
    const bindings = Effect.runSync(
      Effect.provideService(
        Component.setupEffect(Widget, { value: external }),
        Scope.Scope,
        scope,
      ),
    );

    // Spawn did not clobber the caller's value with the widget's default.
    expect(bindings.value()).toBe("caller-owned");

    // One mechanism, both directions.
    bindings.value.set("set-by-widget");
    expect(external()).toBe("set-by-widget");
    external.set("set-by-caller");
    expect(bindings.value()).toBe("set-by-caller");

    // Disposing the widget does not destroy state it never owned.
    Effect.runSync(Scope.close(scope, Exit.void));
    expect(external()).toBe("set-by-caller");
  });

  it("with no external atom, setup owns writable state and resume snapshots it", () => {
    const collected = collectWidget(makeWidget("BindableUncontrolled"), {});
    expect(collected.manifest.version).not.toBe(1);
    if (collected.manifest.version === 1) return;
    expect(collected.manifest.components.c0?.bindings.value).toMatchObject({
      kind: "state",
      value: "own-default",
    });
  });

  it("a controlled binding is NOT snapshotted, and is not a fallback diagnostic", () => {
    const external = Atom.make("caller-owned");
    // Identical widget and policy; the ONLY difference is the caller's atom.
    const collected = collectWidget(makeWidget("BindableControlledCollect"), {
      value: external,
    });

    // "Snapshot only for setup-owned state": the caller's atom is the
    // caller's to serialize — snapshotting it would restore a stale value
    // over the caller's own resume path (two owners, one slot).
    if (collected.manifest.version !== 1) {
      expect(
        collected.manifest.components.c0?.bindings ?? {},
      ).not.toHaveProperty("value");
    }
    // ...and adoption is configuration, not a failure: no mismatch/fallback
    // diagnostic fires for the controlled binding.
    expect(
      collected.diagnostics.filter((diagnostic) =>
        "binding" in diagnostic && diagnostic.binding === "value"
      ),
    ).toEqual([]);
  });

  it("treats any writable atom argument as controlled (documented edge)", () => {
    const external = Atom.make(42);
    const scope = Scope.makeUnsafe();
    const adopted = Effect.runSync(
      Effect.provideService(
        Component.bindable(external),
        Scope.Scope,
        scope,
      ),
    );
    expect(adopted).toBe(external);
    const owned = Effect.runSync(
      Effect.provideService(Component.bindable(7), Scope.Scope, scope),
    );
    expect(owned()).toBe(7);
    expect(Component.isStateHandle(owned)).toBe(true);
    Effect.runSync(Scope.close(scope, Exit.void));
  });
});
