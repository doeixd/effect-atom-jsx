/**
 * Non-text expression targets: the compiler directive seam and the attribute /
 * class / style-property vertical slice. Promoted from
 * `future/resumability/expression-targets.spec.ts` (all green 2026-08-12),
 * retyped.
 *
 * Owning plans: `docs/RESUMABILITY_M8C_PLAN.md` 8c.3, 8c.4, 8c.5 and the
 * "Ratify the Non-Text Target Protocol" section of 8c.2.
 *
 * The protocol foundation is built (manifest v4 discriminated targets, the
 * `data-af-expr` installation-only marker, `scanExpressionTargets`, the
 * conservative name allowlist), and so is the patch strategy (8c.4/8c.5): these
 * specs drive collection → manifest → install → invalidate → assert the
 * patched DOM.
 */

import { Effect, Exit, Layer, ManagedRuntime, Schema, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import plugin from "../compiler/resume-extract-plugin.js";
import * as Component from "../Component.js";
import {
  exprAttribute,
  exprClass,
  exprStyleProperty,
  insert,
  renderToString,
  template,
} from "../dom.js";
import {
  bindExpression,
  expressionCode,
  type ExpressionCode,
  type ExpressionOutput,
} from "../portable-extract.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";
import { nonTextFixture } from "./resume-fake-dom.js";

const BuildId = "future-resume-build";

const expressionId = (raw: string) => Schema.decodeUnknownSync(Resume.ExpressionId)(raw);

/** Narrow a collected manifest to v4 and return its expression map. */
function expressionsOf(manifest: Resume.CollectionResult["manifest"]) {
  if (manifest.version !== 4) {
    throw new Error(`Expected a v4 manifest, received v${manifest.version}.`);
  }
  return manifest.expressions;
}

/**
 * Same as `expressionsOf`, but a collection that never reached v4 (every
 * target refused, so the manifest stayed at whatever version preceded it)
 * counts as "no expressions" rather than a spec-breaking assertion failure.
 */
function expressionsOfOrEmpty(manifest: Resume.CollectionResult["manifest"]) {
  return manifest.version === 4 ? manifest.expressions : {};
}

/**
 * One component owning one expression whose only dependency is the
 * component's own resumable `count` state binding. Collected through real
 * SSR so the manifest, ownership, dependency keys, and code descriptor are
 * the genuine wire values.
 */
function collectCounter<Captures, EncodedCaptures, A extends ExpressionOutput>(
  code: ExpressionCode<Captures, EncodedCaptures, readonly [number], readonly [number], A>,
  captures: Captures,
) {
  const Counter = Component.make(
    Component.props<{}>(),
    Component.require<never>(),
    Component.setup<{}>().bind("count", () => Component.state(1), {
      resume: Resume.snapshotState(Schema.Number),
    }),
    (_props, bindings) => {
      const span = template("<span>")();
      insert(span, bindExpression(code, captures, [bindings.count]));
      return span;
    },
  ).pipe(Component.withDefinition({ name: "FutureNonTextCounter" }));
  const scope = Scope.makeUnsafe();
  const result = Effect.runSync(
    Resume.collect(
      () =>
        renderToString(() =>
          Effect.runSync(
            Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
          ),
        ),
      { buildId: BuildId },
    ).pipe(Effect.provide(Serialization.layer)),
  );
  // Closing before returning is deliberate and is *not* the
  // "teardown before assertion" defect: the returned value is the serialized
  // collect snapshot (html + manifest), not a live handle map. A real server
  // closes the render scope before it serializes.
  Effect.runSync(Scope.close(scope, Exit.void));
  return result;
}

/**
 * The 8c.4 authoring path: SSR renders a host element and the compiler-facing
 * `expr*` helpers attach the resumable target(s) to it. `attach` receives the
 * host element and the already-bound branded expression, mirroring what the
 * §8c.3 directive hands the runtime.
 */
function collectViaHelper<Captures, EncodedCaptures, A extends ExpressionOutput>(
  code: ExpressionCode<Captures, EncodedCaptures, readonly [number], readonly [number], A>,
  attach: (element: Element, bound: unknown) => void,
  captures: Captures,
) {
  const Host = Component.make(
    Component.props<{}>(),
    Component.require<never>(),
    Component.setup<{}>().bind("count", () => Component.state(1), {
      resume: Resume.snapshotState(Schema.Number),
    }),
    (_props, bindings) => {
      const element = template("<span>")();
      attach(element, bindExpression(code, captures, [bindings.count]));
      return element;
    },
  ).pipe(Component.withDefinition({ name: "FutureHelperHost" }));
  const scope = Scope.makeUnsafe();
  const result = Effect.runSync(
    Resume.collect(
      () =>
        renderToString(() =>
          Effect.runSync(Component.renderEffect(Host, {}).pipe(Scope.provide(scope))),
        ),
      { buildId: BuildId },
    ).pipe(Effect.provide(Serialization.layer)),
  );
  Effect.runSync(Scope.close(scope, Exit.void));
  return result;
}

/** Re-target one collected v4 text entry, optionally fanning it out. */
function retarget(
  manifest: Resume.CollectionResult["manifest"],
  targets: Readonly<Record<string, unknown>>,
) {
  if (manifest.version !== 4) {
    throw new Error(`Expected a v4 manifest, received v${manifest.version}.`);
  }
  const base = manifest.expressions[expressionId("x0")];
  if (base === undefined) throw new Error("Expected a collected x0 entry.");
  const expressions: Record<string, unknown> = {};
  for (const [id, target] of Object.entries(targets)) {
    expressions[expressionId(id)] = { ...base, target };
  }
  // boundary: retargeting deliberately swaps in arbitrary discriminated
  // targets to build fixtures the ordinary collector never produces.
  return {
    ...manifest,
    expressions: expressions as typeof manifest.expressions,
  };
}

describe("Non-text expression targets", () => {
  // ─── 8c.3 — the compiler directive seam ───────────────────────────────────

  it("[M8c.3] refuses to lower an expr(...) in an unsupported JSX context, with a source location", async () => {
    const babel = await import("@babel/core");

    const compile = (jsx: string) =>
      babel.transformSync(
        `import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";

const label = "hi";
export const view = () => (${jsx});
`,
        {
          filename: "C:/app/src/view.tsx",
          babelrc: false,
          configFile: false,
          presets: [],
          plugins: [
            "@babel/plugin-syntax-jsx",
            [plugin, { buildId: BuildId, root: "C:/app" }],
          ],
        },
      );

    const forbidden = [
      // An event handler is executable code, not a value: never resumable.
      `<button onClick={expr(() => label, { captures: Schema.Struct({ label: Schema.String }), bind: { label }, dependencies: Schema.Tuple([Schema.Unknown]), deps: ["k"] })} />`,
      // A whole style object is fenced; only single properties widen in 8c.5.
      `<div style={expr(() => label, { captures: Schema.Struct({ label: Schema.String }), bind: { label }, dependencies: Schema.Tuple([Schema.Unknown]), deps: ["k"] })} />`,
      // A spread hides the target name from the compiler entirely.
      `<div {...expr(() => label, { captures: Schema.Struct({ label: Schema.String }), bind: { label }, dependencies: Schema.Tuple([Schema.Unknown]), deps: ["k"] })} />`,
      // A URL-bearing attribute stays fenced until it has a security contract.
      `<a href={expr(() => label, { captures: Schema.Struct({ label: Schema.String }), bind: { label }, dependencies: Schema.Tuple([Schema.Unknown]), deps: ["k"] })} />`,
    ];

    for (const jsx of forbidden) {
      let thrown: unknown;
      try {
        compile(jsx);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `expected a compile error for: ${jsx}`).toBeInstanceOf(Error);
      // Source-located: the diagnostic must name the file the author wrote.
      expect(String((thrown as Error).message)).toContain("view.tsx");
    }

    // NEGATIVE CONTROL. A supported context — a plain allowlisted attribute —
    // must compile. Without it, a transform that rejected *every* `expr(...)`
    // in JSX would satisfy the loop above forever, and this spec could never
    // distinguish "fenced correctly" from "not implemented".
    const allowed =
      `<div title={expr(() => label, { captures: Schema.Struct({ label: Schema.String }), bind: { label }, dependencies: Schema.Tuple([Schema.Unknown]), deps: ["k"] })} />`;
    expect(() => compile(allowed)).not.toThrow();
  });

  it("[M8c.3] emits one directive attachment per host element carrying an array of [expression, target] pairs", async () => {
    // Ratified in `RESUMABILITY_M8C_PLAN.md` §8c.3 ("the directive ABI, closes
    // DQ-003"): ONE `use:`-style directive attachment per host element, taking
    // an array of `[boundExpression, target]` pairs where `target` is the
    // discriminated v4 target value. Per-element grouping is load-bearing — it
    // is what makes the generated code and the single `data-af-expr` marker
    // agree by construction rather than by the runtime re-grouping N calls.
    const babel = await import("@babel/core");

    const compile = (jsx: string): string => {
      const output = babel.transformSync(
        `import { expr } from "effect-atom-jsx/portable-extract";
import { Schema } from "effect";

const label = "hi";
const authoredRef = (element) => element;
export const view = () => (${jsx});
`,
        {
          filename: "C:/app/src/view.tsx",
          babelrc: false,
          configFile: false,
          presets: [],
          plugins: [
            "@babel/plugin-syntax-jsx",
            [plugin, { buildId: BuildId, root: "C:/app" }],
          ],
        },
      );
      return String(output?.code ?? "");
    };

    const E = (n: number) =>
      `expr(() => label + ${n}, { captures: Schema.Struct({ label: Schema.String }), bind: { label }, dependencies: Schema.Tuple([Schema.Unknown]), deps: ["k${n}"] })`;
    // Whitespace-insensitive: the transform owns its printing, not this spec.
    const dense = (code: string) => code.replace(/\s+/g, "");
    const count = (code: string, needle: string) =>
      dense(code).split(needle).length - 1;

    // Two resumable targets on ONE element, alongside an authored ref, an
    // ordinary reactive attribute and a static attribute — the coexistence set
    // 8c.3 requires.
    const two = compile(
      `<div ref={authoredRef} id="static" data-count={label} title={${E(0)}} class={${E(1)}} />`,
    );
    // Exactly one directive attachment for the element…
    expect(count(two, "resumeExprDirective")).toBe(1);
    // …carrying both discriminated targets, in one array.
    expect(dense(two)).toContain(`{kind:"attribute",name:"title"}`);
    expect(dense(two)).toContain(`{kind:"class"}`);
    // Coexistence: the authored ref and the static/reactive attributes survive.
    expect(two).toContain("authoredRef");
    expect(dense(two)).toContain(`"static"`);

    // Two elements, one expression each ⇒ two attachments, one pair each. This
    // is the half that stops "emit one directive per *render*" from passing.
    const split = compile(
      `<div><span title={${E(0)}} /><span class={${E(1)}} /></div>`,
    );
    expect(count(split, "resumeExprDirective")).toBe(2);

    // NEGATIVE CONTROL. An element with no `expr(...)` gets no directive at
    // all; without this, a transform that attached the directive
    // unconditionally would satisfy every count above.
    const none = compile(`<div ref={authoredRef} title={label} />`);
    expect(count(none, "resumeExprDirective")).toBe(0);
  });

  // ─── 8c.4 — ordinary attribute vertical slice ─────────────────────────────

  it("[M8c.4] patches a dormant attribute on first invalidation, loading only that expression's chunk", async () => {
    const AttributeExpression = expressionCode({
      id: "future.resume.expr.attribute",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (captures, [count]) => `${captures.label}: ${count}`,
    });
    const collected = collectCounter(AttributeExpression, { label: "Count" });
    const manifest = retarget(collected.manifest, {
      x0: { kind: "attribute", name: "aria-label" },
    });

    const root = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      elementExpressions: ["x0"],
      // SSR already applied the initial value once, and a neighbouring
      // attribute exists to prove the patch is surgical.
      attributes: { "aria-label": "Count: 1", title: "untouched" },
    });
    const element = root.element();

    let loads = 0;
    const diagnostics: Array<unknown> = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {
          [AttributeExpression.id]: () =>
            Effect.sync(() => {
              loads += 1;
              return AttributeExpression;
            }),
        },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    // Dormant: no expression code, and the installation-only marker is gone.
    expect(loads).toBe(0);
    expect(element.getAttribute!(Resume.ExpressionElementMarkerAttribute)).toBeNull();
    expect(element.getAttribute!("aria-label")).toBe("Count: 1");
    expect(installation.inspect()).toMatchObject({
      expressionControllers: 1,
      expressionSubscriptions: 1,
      runningExpressions: 0,
    });

    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 2));
    await vi.waitFor(() => {
      expect(element.getAttribute!("aria-label")).toBe("Count: 2");
      expect(installation.pending()).toBe(0);
    });
    // Cold interaction loaded exactly one chunk and touched exactly one target.
    expect(loads).toBe(1);
    expect(element.getAttribute!("title")).toBe("untouched");
    expect(diagnostics).toEqual([]);

    // Warm update: memoized module, no second load.
    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 3));
    await vi.waitFor(() => {
      expect(element.getAttribute!("aria-label")).toBe("Count: 3");
    });
    expect(loads).toBe(1);

    await Effect.runPromise(installation.dispose);
    expect(installation.inspect()).toMatchObject({
      disposed: true,
      pendingFibers: 0,
      expressionControllers: 0,
      expressionDependencyKeys: 0,
      expressionSubscriptions: 0,
    });
    await runtime.dispose();
  });

  it("[M8c.4] never runs component setup or view to patch a dormant attribute", async () => {
    let setupRuns = 0;
    let viewRuns = 0;
    const AttributeExpression = expressionCode({
      id: "future.resume.expr.attribute.no-setup",
      buildId: BuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (_captures, [count]) => `v${count}`,
    });
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "count",
        () =>
          Effect.sync(() => {
            setupRuns += 1;
          }).pipe(Effect.flatMap(() => Component.state(1))),
        { resume: Resume.snapshotState(Schema.Number) },
      ),
      (_props, bindings) => {
        viewRuns += 1;
        const span = template("<span>")();
        insert(span, bindExpression(AttributeExpression, {}, [bindings.count]));
        return span;
      },
    ).pipe(Component.withDefinition({ name: "FutureNoSetupCounter" }));
    const scope = Scope.makeUnsafe();
    const collected = Effect.runSync(
      Resume.collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
            ),
          ),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
    Effect.runSync(Scope.close(scope, Exit.void));
    expect({ setupRuns, viewRuns }).toEqual({ setupRuns: 1, viewRuns: 1 });

    const manifest = retarget(collected.manifest, {
      x0: { kind: "attribute", name: "data-state" },
    });
    const root = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      elementExpressions: ["x0"],
      attributes: { "data-state": "v1" },
    });
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: { [AttributeExpression.id]: AttributeExpression },
        runtime,
      }),
    );

    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 9));
    await vi.waitFor(() => {
      expect(root.element().getAttribute!("data-state")).toBe("v9");
    });
    // The whole point of fine-grained resumption: no rediscovery.
    expect({ setupRuns, viewRuns }).toEqual({ setupRuns: 1, viewRuns: 1 });
    expect(installation.boundaryState("c0")).toEqual({ status: "dormant" });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  // ─── 8c.5 — class-string and single-style-property widening ───────────────

  it("[M8c.5] fans one dependency out to text, attribute, class, and style-property targets with one chunk load", async () => {
    const Shared = expressionCode({
      id: "future.resume.expr.shared-target",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (captures, [count]) => `${captures.label}-${count}`,
    });
    // Pass the captures explicitly: `collectCounter`'s default is
    // `{ label: "Count" }`, so relying on it here would assert `"state-2"`
    // against a rendered `"Count-2"` and fail on the *string* long before the
    // fan-out claim this spec is actually about.
    const collected = collectCounter(Shared, { label: "state" });
    const manifest = retarget(collected.manifest, {
      x0: { kind: "text" },
      x1: { kind: "attribute", name: "aria-label" },
      x2: { kind: "class" },
      x3: {
        kind: "style-property",
        name: Schema.decodeUnknownSync(Resume.ExpressionStylePropertyName)("--progress"),
      },
    });

    const root = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      textExpressionId: "x0",
      textValue: "state-1",
      elementExpressions: ["x1", "x2", "x3"],
      attributes: { "aria-label": "state-1" },
      className: "state-1",
      style: { "--progress": "state-1" },
    });
    const element = root.element();

    let loads = 0;
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {
          [Shared.id]: () =>
            Effect.sync(() => {
              loads += 1;
              return Shared;
            }),
        },
        runtime,
      }),
    );
    expect(installation.inspect()).toMatchObject({
      expressionControllers: 4,
      // One shared dependency key, four subscribers on it.
      expressionDependencyKeys: 1,
      expressionSubscriptions: 4,
    });

    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 2));
    await vi.waitFor(() => {
      expect(root.regionText("x0")).toBe("state-2");
      expect(element.getAttribute!("aria-label")).toBe("state-2");
      expect(element.className).toBe("state-2");
      expect(element.style!.getPropertyValue("--progress")).toBe("state-2");
      expect(installation.pending()).toBe(0);
    });
    // One code identity ⇒ at most one in-flight module load, ever.
    expect(loads).toBe(1);

    await Effect.runPromise(installation.dispose);
    expect(installation.inspect()).toMatchObject({
      expressionControllers: 0,
      expressionDependencyKeys: 0,
      expressionSubscriptions: 0,
    });
    await runtime.dispose();
  });

  it("[M8c.5] coerces a numeric style-property value exactly like the ordinary style helper", async () => {
    const Numeric = expressionCode({
      id: "future.resume.expr.numeric-style",
      buildId: BuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Number]),
      // A number reaches the patch strategy unstringified.
      render: (_captures, [count]) => count / 4,
    });
    const collected = collectCounter(Numeric, {});
    const manifest = retarget(collected.manifest, {
      x0: {
        kind: "style-property",
        name: Schema.decodeUnknownSync(Resume.ExpressionStylePropertyName)("opacity"),
      },
    });
    const root = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      elementExpressions: ["x0"],
      style: { opacity: "0.25" },
    });
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: { [Numeric.id]: Numeric },
        runtime,
      }),
    );

    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 2));
    await vi.waitFor(() => {
      expect(root.element().style!.getPropertyValue("opacity")).toBe("0.5");
    });
    // Repeated identical writes must be idempotent, not accumulate.
    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 2));
    await vi.waitFor(() => expect(installation.pending()).toBe(0));
    expect(root.element().style!.getPropertyValue("opacity")).toBe("0.5");
    expect([...root.element().style!.properties.keys()]).toEqual(["opacity"]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M8c.5] removes an attribute and a style property when the expression yields nothing", async () => {
    // Ratified in `RESUMABILITY_M8C_PLAN.md` §8c.5 (closes DQ-002):
    // `ExpressionOutput = string | number | null | undefined`, and `null` and
    // `undefined` both mean **remove** — the same semantics as the ordinary
    // helpers, which Decision 7 requires the resumable path to match exactly.
    const Removing = expressionCode({
      id: "future.resume.expr.removal",
      buildId: BuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Number]),
      // 1 → a value; 2 → `undefined`; 3 → `null`; 4 → the empty string.
      render: (_captures, [count]) =>
        count === 1 ? "on" : count === 2 ? undefined : count === 3 ? null : "",
    });
    const collected = collectCounter(Removing, {});
    const manifest = retarget(collected.manifest, {
      x0: { kind: "attribute", name: "aria-label" },
      x1: {
        kind: "style-property",
        name: Schema.decodeUnknownSync(Resume.ExpressionStylePropertyName)("opacity"),
      },
    });

    const root = nonTextFixture({
      markerAttribute: Resume.ExpressionElementMarkerAttribute,
      elementExpressions: ["x0", "x1"],
      attributes: { "aria-label": "on", title: "untouched" },
      style: { opacity: "on" },
    });
    const element = root.element();
    const runtime = ManagedRuntime.make(Layer.empty);
    const diagnostics: Array<unknown> = [];
    const installation = Effect.runSync(
      Resume.installClient({
        root: root.asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: { [Removing.id]: Removing },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    // `undefined` removes — the attribute is absent, not set to "undefined".
    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 2));
    await vi.waitFor(() => {
      expect(element.hasAttribute!("aria-label")).toBe(false);
      expect(installation.pending()).toBe(0);
    });
    expect([...element.style!.properties.keys()]).toEqual([]);

    // …and it comes back on a later value: removal is not terminal.
    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 1));
    await vi.waitFor(() => {
      expect(element.getAttribute!("aria-label")).toBe("on");
      expect(element.style!.getPropertyValue("opacity")).toBe("on");
    });

    // `null` removes identically: one authored concept, one behaviour.
    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 3));
    await vi.waitFor(() => {
      expect(element.hasAttribute!("aria-label")).toBe(false);
    });
    expect([...element.style!.properties.keys()]).toEqual([]);

    // NEGATIVE CONTROL. The empty string is a *value*, not an absence: an
    // implementation that removed on every falsy output would pass every
    // assertion above and silently break `aria-hidden=""`-style attributes.
    Effect.runSync(installation.writeBinding("c0", "count", Schema.Number, 4));
    await vi.waitFor(() => {
      expect(installation.pending()).toBe(0);
      expect(element.hasAttribute!("aria-label")).toBe(true);
    });
    expect(element.getAttribute!("aria-label")).toBe("");
    // Nothing about removal is an error, and the neighbour is untouched.
    expect(diagnostics).toEqual([]);
    expect(element.getAttribute!("title")).toBe("untouched");

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M8c.5] an expression's output never crosses the wire; the manifest carries no `output`", async () => {
    // CORRECTED 2026-07-30 (see RESUMABILITY_M8C_PLAN.md, "Corrections resolved
    // after speccing these decisions"). The original DQ-002 ratification said
    // absence was "an omitted output field". That premise was wrong: the v4
    // entry is `{target, code, deps, inputs?, component?}` and `ExpressionOutput`
    // appears in NO Schema. An expression's value is computed on the client from
    // its portable code — it is never serialized.
    //
    // So the widening to `string | number | null | undefined` is an *authoring
    // and patch* decision, not a wire one, and DQ-002 needs no manifest version
    // bump. What the wire must do is refuse to grow an output field by accident,
    // because a manifest-carried initial value would be a second source of truth
    // for something the served HTML already states.
    const entry = (extra: string) =>
      `{"version":4,"buildId":"${BuildId}","events":{},"components":{},"expressions":{"x0":{"target":{"kind":"attribute","name":"title"},${extra}"code":{"version":1,"kind":"portable.code","id":"future.resume.expr.absent","buildId":"${BuildId}","captures":{}},"deps":["k"]}}}`;

    const decodeManifest = (extra: string) =>
      Effect.runSync(
        Resume.decodeManifest(entry(extra), BuildId).pipe(
          Effect.provide(Serialization.layer),
        ),
      );

    // The canonical entry decodes, and exposes no output channel.
    const plain = decodeManifest("") as {
      readonly expressions: Record<string, { readonly target: unknown }>;
    };
    expect(plain.expressions.x0!.target).toMatchObject({ kind: "attribute", name: "title" });
    expect("output" in plain.expressions.x0!).toBe(false);

    // NEGATIVE CONTROL / the actual guarantee: a manifest that *does* carry an
    // output must not silently become authoritative. Either it is rejected, or
    // it is dropped — but it must never survive into the decoded entry, because
    // that would reintroduce the second source of truth this decision removed.
    let smuggled: { readonly expressions: Record<string, unknown> } | undefined;
    try {
      smuggled = decodeManifest(`"output":"Count: 1",`) as typeof smuggled;
    } catch {
      smuggled = undefined; // rejected outright is also acceptable
    }
    if (smuggled !== undefined) {
      expect("output" in (smuggled.expressions.x0 as Record<string, unknown>)).toBe(false);
    }

    // And the same for an explicit null, which was the spelling the superseded
    // ratification worried about. It has no wire meaning either way.
    let nulled: { readonly expressions: Record<string, unknown> } | undefined;
    try {
      nulled = decodeManifest(`"output":null,`) as typeof nulled;
    } catch {
      nulled = undefined;
    }
    if (nulled !== undefined) {
      expect("output" in (nulled.expressions.x0 as Record<string, unknown>)).toBe(false);
    }
  });

  // ─── conservative target-name allowlist ──────────────────────────────────

  it("[M8c.2] fails a wire manifest closed when a target names a fenced attribute or style property", async () => {
    const entry = (target: string) =>
      `{"version":4,"buildId":"${BuildId}","events":{},"components":{},"expressions":{"x0":{"target":${target},"code":{"version":1,"kind":"portable.code","id":"future.resume.expr.fenced","buildId":"${BuildId}","captures":{}},"deps":["k"]}}}`;

    const fenced = [
      '{"kind":"attribute","name":"href"}',
      '{"kind":"attribute","name":"onclick"}',
      '{"kind":"attribute","name":"srcdoc"}',
      '{"kind":"attribute","name":"xlink:href"}',
      '{"kind":"style-property","name":"cssText"}',
      '{"kind":"style-property","name":"background-image"}',
      '{"kind":"property","name":"innerHTML"}',
    ];
    for (const target of fenced) {
      const failure = Effect.runSync(
        Resume.decodeManifest(entry(target), BuildId).pipe(
          Effect.flip,
          Effect.provide(Serialization.layer),
        ),
      );
      expect(failure._tag, `expected ${target} to be rejected`).toBe(
        "ResumeManifestDecodeError",
      );
    }

    // …and the allowlisted ones decode and survive the round trip.
    const allowed = Effect.runSync(
      Resume.decodeManifest(
        entry('{"kind":"attribute","name":"title"}'),
        BuildId,
      ).pipe(Effect.provide(Serialization.layer)),
    );
    expect((allowed as { expressions: Record<string, { target: unknown }> }).expressions.x0!.target).toEqual({
      kind: "attribute",
      name: "title",
    });
  });

  it("[M8c.2] rejects an unlisted target name at collection time, before any HTML is emitted", async () => {
    // Ratified in `RESUMABILITY_M8C_PLAN.md` §8c.4 (closes DQ-004): the SSR
    // seam is three compiler-facing helpers in `dom.ts` — `exprAttribute`,
    // `exprClass`, `exprStyleProperty` — each delegating to one
    // `observeRenderedExpressionTarget` registrar that owns target validation.
    // So the authoring gate now has a call to make.
    const Code = expressionCode({
      id: "future.resume.expr.collect-gate",
      buildId: BuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (_captures, [count]) => `v${count}`,
    });

    const collectWith = (attach: (element: Element, bound: unknown) => void) =>
      collectViaHelper(Code, attach, {});

    // A fenced attribute, a fenced style property, and a forbidden name — all
    // refused during collection, so no HTML and no manifest entry ships.
    for (const attach of [
      (element: Element, bound: unknown) => exprAttribute(element, bound, "href"),
      (element: Element, bound: unknown) => exprAttribute(element, bound, "onclick"),
      (element: Element, bound: unknown) =>
        exprStyleProperty(element as HTMLElement, bound, "background-image"),
    ]) {
      const collected = collectWith(attach);
      expect(
        collected.diagnostics.map((diagnostic) => diagnostic.code),
      ).toContain("unsupported-expression-target");
      expect(collected.diagnostics[0]).toMatchObject({
        phase: "collect",
        disposition: "fallback-required",
      });
      expect(Object.keys(expressionsOfOrEmpty(collected.manifest))).toEqual([]);
      expect(collected.html).not.toContain(
        Resume.ExpressionElementMarkerAttribute,
      );
    }

    // NEGATIVE CONTROLS. Allowlisted targets register cleanly through each of
    // the three helpers, with no diagnostic — without this, a registrar that
    // refused every target would satisfy the loop above forever.
    for (const [attach, target] of [
      [
        (element: Element, bound: unknown) => exprAttribute(element, bound, "title"),
        { kind: "attribute", name: "title" },
      ],
      [
        (element: Element, bound: unknown) => exprClass(element, bound),
        { kind: "class" },
      ],
      [
        (element: Element, bound: unknown) =>
          exprStyleProperty(element as HTMLElement, bound, "opacity"),
        { kind: "style-property", name: "opacity" },
      ],
    ] as const) {
      const ok = collectWith(attach);
      expect(ok.diagnostics).toEqual([]);
      const entries = Object.values(expressionsOf(ok.manifest));
      expect(entries).toHaveLength(1);
      expect(entries[0]!.target).toEqual(target);
      // The ordinary helper ran too: SSR emitted the initial value, which is
      // what Decision 7's "the ordinary call sits inside the resumable one"
      // structurally guarantees.
      expect(ok.html).toContain("v1");
    }
  });

  it("[M8c.4] accumulates two expressions on one element into a single marker", async () => {
    // The single `observeRenderedExpressionTarget` registrar (§8c.4) is
    // load-bearing rather than stylistic: it is what makes two expressions on
    // one host element produce ONE `data-af-expr` marker listing both instance
    // ids, matching what the v4 wire format already assumes.
    const Code = expressionCode({
      id: "future.resume.expr.one-marker",
      buildId: BuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (_captures, [count]) => `v${count}`,
    });

    const both = collectViaHelper(
      Code,
      (element, bound) => {
        exprAttribute(element, bound, "title");
        exprStyleProperty(element as HTMLElement, bound, "opacity");
      },
      {},
    );

    const marker = Resume.ExpressionElementMarkerAttribute;
    const occurrences = both.html.split(`${marker}=`).length - 1;
    expect(occurrences).toBe(1);
    // …and the one marker lists both instance ids.
    const listed = /data-af-expr="([^"]*)"/.exec(both.html)?.[1] ?? "";
    expect(listed.split(/\s+/).filter(Boolean)).toHaveLength(2);
    expect(Object.keys(expressionsOf(both.manifest))).toHaveLength(2);

    // NEGATIVE CONTROL. One expression yields one marker with one id, so a
    // registrar that always emitted a two-id marker cannot pass.
    const single = collectViaHelper(
      Code,
      (element, bound) => {
        exprAttribute(element, bound, "title");
      },
      {},
    );
    expect(single.html.split(`${marker}=`).length - 1).toBe(1);
    expect(
      (/data-af-expr="([^"]*)"/.exec(single.html)?.[1] ?? "")
        .split(/\s+/)
        .filter(Boolean),
    ).toHaveLength(1);
  });
});
