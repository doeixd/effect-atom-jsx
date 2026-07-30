/**
 * K0b — controlled / uncontrolled collapse (`bindable`).
 *
 * Owning docs: `docs/COMPONENT_KIT_PLAN.md` mandated coverage item K0b.4 —
 * *"`bindable(propAtom | initial)` is the 'one mechanism, no
 * `value`/`defaultValue` split' claim (advantage 7) and nothing tests it.
 * Require: a passed-in external atom is **not** overwritten on spawn; with no
 * external atom, setup creates an internal `Component.state` that resume can
 * snapshot"* — and `docs/kit-research/behaviors/controlled-uncontrolled.md`,
 * which decides the helper (`bindable(propAtom | initial)` → WritableAtom, no
 * dual code paths in widgets) and the snapshot rule: *"Snapshot only for
 * setup-owned state."*
 *
 * Those two sentences are a differential pair, and the pair is what makes the
 * claim non-vacuous: the same call site must (a) defer entirely to a caller's
 * atom, and (b) own and snapshot state when there isn't one. A helper that
 * always creates state fails (a); one that always adopts fails (b).
 *
 * Only the helper's *semantics* are specified. Where it lives is not decided in
 * any doc, so the resolver below accepts either plausible home rather than
 * pinning one.
 */
import { Effect, Exit, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { NotImplemented, fromSrc, loadSrc, pick } from "../harness.js";

const TestBuildId = "future-components-bindable";

/**
 * Resolve `bindable` from whichever module ends up owning it. The catalog
 * convention would put it in `src/behaviors/`; it is equally defensible as a
 * `Component` primitive since it allocates `Component.state`. Both are accepted
 * so this spec does not pre-empt that choice; only "it exists somewhere" is
 * asserted.
 */
async function resolveBindable(): Promise<any> {
  const candidates: ReadonlyArray<readonly [string, string]> = [
    ["behaviors/bindable", "bindable"],
    ["Component", "bindable"],
    ["behaviors/controlled", "bindable"],
  ];
  for (const [path, name] of candidates) {
    try {
      const mod = await loadSrc(path);
      if (mod[name] !== undefined) return mod[name];
    } catch {
      // keep looking — a missing module is not a failure until all miss
    }
  }
  throw new NotImplemented(
    "bindable(propAtom | initial)",
    `tried ${candidates.map(([p, n]) => `${p}.${n}`).join(", ")} — owned by K0b`,
  );
}

describe("bindable: controlled", () => {
  it("[K0b] an externally supplied atom is adopted, never overwritten on spawn", async () => {
    const bindable = await resolveBindable();
    const Atom = await loadSrc("Atom");
    const { make: atom } = pick(Atom, "Atom", "make");
    const Component = await loadSrc("Component");
    const { make, props, require, setup, setupEffect } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "setupEffect",
    );

    // The caller owns the value. It is already non-default when the widget
    // mounts, which is exactly the case a `defaultValue` code path corrupts.
    const external: any = atom("caller-owned");

    const Widget = make(
      props(),
      require(),
      setup().bind("value", ({ props: p }: any) => bindable(p.value ?? "widget-default")),
      () => null,
    );

    const scope = Scope.makeUnsafe();
    const bindings: any = Effect.runSync(
      Effect.provideService(setupEffect(Widget, { value: external }), Scope.Scope, scope),
    );

    // Spawn did not clobber the caller's value with the widget's default.
    expect(bindings.value()).toBe("caller-owned");
    expect(external()).toBe("caller-owned");

    // One mechanism, both directions: a widget write lands on the caller's atom…
    bindings.value.set("set-by-widget");
    expect(external()).toBe("set-by-widget");
    expect(bindings.value()).toBe("set-by-widget");

    // …and a caller write is visible to the widget with no sync prop dance.
    external.set("set-by-caller");
    expect(bindings.value()).toBe("set-by-caller");

    // Read state before teardown, then tear down.
    Effect.runSync(Scope.close(scope, Exit.void));

    // Disposing the widget does not destroy state the widget never owned — the
    // caller's atom outlives its consumer.
    expect(external()).toBe("set-by-caller");
  });
});

describe("bindable: uncontrolled", () => {
  it("[K0b] with no external atom, setup owns writable state and resume snapshots it", async () => {
    const bindable = await resolveBindable();
    const Component = await loadSrc("Component");
    const { make, props, require, setup, renderEffect, withDefinition } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "renderEffect",
      "withDefinition",
    );
    const Resume = await loadSrc("Resume");
    const { collect, snapshotState } = pick(Resume, "Resume", "collect", "snapshotState");
    const { renderToString } = await fromSrc("dom", "renderToString");
    const Serialization = await loadSrc("Serialization");
    const { layer: serializationLayer } = pick(Serialization, "Serialization", "layer");

    const Widget = make(
      props(),
      require(),
      setup().bind(
        "value",
        ({ props: p }: any) => bindable(p.value ?? "own-default"),
        // The point of "setup creates an internal `Component.state`": the
        // binding is an ordinary state atom, so the existing resume kernel
        // snapshots it with no new kernel code.
        { resume: snapshotState(Schema.String) },
      ),
      (_props: unknown, bindings: any) => `${bindings.value()}`,
    ).pipe(withDefinition({ name: "FutureBindable" }));

    const scope = Scope.makeUnsafe();
    const collected: any = Effect.runSync(
      collect(
        () =>
          renderToString(() =>
            Effect.runSync(renderEffect(Widget, {}).pipe(Scope.provide(scope)) as any) as any
          ),
        { buildId: TestBuildId },
      ).pipe(Effect.provide(serializationLayer)) as any,
    );

    expect(collected.manifest.components.c0.bindings.value).toMatchObject({
      kind: "state",
      value: "own-default",
    });

    Effect.runSync(Scope.close(scope, Exit.void));
  });

  it("[K0b] a controlled binding is NOT snapshotted: the snapshot follows ownership", async () => {
    const bindable = await resolveBindable();
    const Atom = await loadSrc("Atom");
    const { make: atom } = pick(Atom, "Atom", "make");
    const Component = await loadSrc("Component");
    const { make, props, require, setup, renderEffect, withDefinition } = pick(
      Component,
      "Component",
      "make",
      "props",
      "require",
      "setup",
      "renderEffect",
      "withDefinition",
    );
    const Resume = await loadSrc("Resume");
    const { collect, snapshotState } = pick(Resume, "Resume", "collect", "snapshotState");
    const { renderToString } = await fromSrc("dom", "renderToString");
    const Serialization = await loadSrc("Serialization");
    const { layer: serializationLayer } = pick(Serialization, "Serialization", "layer");

    const external: any = atom("caller-owned");

    // Identical widget to the spec above — identical binding, identical policy.
    // The ONLY difference is that the caller passes an atom. That isolation is
    // what makes the negative result meaningful rather than an artefact.
    const Widget = make(
      props(),
      require(),
      setup().bind(
        "value",
        ({ props: p }: any) => bindable(p.value ?? "own-default"),
        { resume: snapshotState(Schema.String) },
      ),
      (_props: unknown, bindings: any) => `${bindings.value()}`,
    ).pipe(withDefinition({ name: "FutureBindableControlled" }));

    const scope = Scope.makeUnsafe();
    const collected: any = Effect.runSync(
      collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              renderEffect(Widget, { value: external }).pipe(Scope.provide(scope)) as any,
            ) as any
          ),
        { buildId: TestBuildId },
      ).pipe(Effect.provide(serializationLayer)) as any,
    );

    // "Snapshot only for setup-owned state": the caller's atom is the caller's
    // to serialize. Snapshotting it here would restore a stale value over
    // whatever the caller's own resume path produced — two owners, one slot.
    expect(collected.manifest.components.c0.bindings).not.toHaveProperty("value");

    Effect.runSync(Scope.close(scope, Exit.void));
  });
});
