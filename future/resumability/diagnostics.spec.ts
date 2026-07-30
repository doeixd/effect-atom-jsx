/**
 * Diagnostics completeness.
 *
 * Owning plans: `docs/RESUMABILITY_M8C_PLAN.md` 8c.8 (documentation and status
 * closure: "supported target/value tables, examples, diagnostics") and
 * `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` Milestone 9 work item 3:
 * "add diagnostics for capture size, unsupported policy, missing codec,
 * unknown code identity, build mismatch, stale DOM marker, and duplicate ID."
 *
 * The claim under test is the *negative* one, and it is the one most likely to
 * rot: none of these situations may surface as a defect (an unhandled throw or
 * `Effect.die`). Each must arrive as a named collect diagnostic with a
 * disposition, a source-located compiler diagnostic, or a tagged typed error.
 */

import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc } from "../harness.js";
import { FakeDocument } from "./fake-dom.js";

/**
 * The harness hands back `any`-shaped values on purpose, so `Effect.runSync`
 * cannot infer a success type from them. These thin wrappers keep the specs
 * readable without sprinkling casts through every assertion.
 */
const runSync = (effect: any): any => Effect.runSync(effect);
const runSyncExit = (effect: any): Exit.Exit<any, any> =>
  Effect.runSyncExit(effect) as Exit.Exit<any, any>;
const runPromise = (effect: any): Promise<any> => Effect.runPromise(effect);
const runFork = (effect: any): any => Effect.runFork(effect);
const decode = (schema: any) => (input: unknown): any =>
  Schema.decodeUnknownSync(schema)(input);


const BuildId = "future-resume-build";

function taggedFailure(exit: Exit.Exit<unknown, unknown>): string {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return "success";
  // A classified failure, never a defect: this is the whole guarantee.
  expect(Cause.hasDies(exit.cause)).toBe(false);
  return Cause.findErrorOption(exit.cause).pipe(
    Option.map((error) => (error as { readonly _tag?: string })._tag ?? "untagged"),
    Option.getOrElse(() => "none"),
  );
}

async function kit() {
  const Resume = await fromSrc(
    "Resume",
    "collect",
    "decodeManifest",
    "installClient",
    "event",
    "snapshotState",
  );
  const Component = await fromSrc(
    "Component",
    "make",
    "props",
    "require",
    "setup",
    "state",
    "action",
    "renderEffect",
    "withDefinition",
  );
  const dom = await fromSrc(
    "dom",
    "renderToString",
    "template",
    "insert",
    "addEventListener",
  );
  const Serialization = await fromSrc("Serialization", "layer");
  const Portable = await fromSrc("Portable", "code", "bind");
  const extract = await fromSrc("portable-extract", "expressionCode", "bindExpression");

  const collect = (render: () => string, options: Record<string, unknown> = {}) =>
    runSync(
      Resume.collect(render, { buildId: BuildId, ...options }).pipe(
        Effect.provide(Serialization.layer),
      ),
    );

  return { Resume, Component, dom, Serialization, Portable, extract, collect };
}

describe("Resumability diagnostics completeness", () => {
  it("[M9] reports an oversized capture as a source-located build diagnostic, not a throw", async () => {
    const babel = await import("@babel/core");
    const { default: plugin } = await fromSrc(
      "compiler/resume-extract-plugin",
      "default",
    );
    const diagnostics: Array<any> = [];
    const output = babel.transformSync(
      `import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";

const payload = ${JSON.stringify("x".repeat(400))};
export const save = extract((captures) => Effect.succeed(captures.payload), {
  captures: Schema.Struct({ payload: Schema.String }),
  bind: { payload },
});
`,
      {
        filename: "C:/app/src/big.ts",
        babelrc: false,
        configFile: false,
        plugins: [[
          plugin,
          {
            buildId: BuildId,
            root: "C:/app",
            maxBindSourceLength: 8,
            onDiagnostic: (diagnostic: any) => diagnostics.push(diagnostic),
          },
        ]],
      },
    );

    // Warned, but still lowered: capture size is advisory at build time and the
    // runtime byte ceiling stays authoritative.
    expect(output?.code).toContain('id: "src/big.ts#save"');
    expect(diagnostics).toMatchObject([
      { code: "oversized-bind", severity: "warning" },
    ]);
    // Source-located: the author can find the offending `bind` expression.
    expect(typeof diagnostics[0].line).toBe("number");
    expect(typeof diagnostics[0].column).toBe("number");
    expect(diagnostics[0].message).toContain("bind");

    // NEGATIVE CONTROL. The identical source under a ceiling it fits emits no
    // diagnostic at all, and still lowers. Without this, a transform that
    // warned "oversized-bind" on every `bind` would satisfy the assertions
    // above forever.
    const clean: Array<any> = [];
    const cleanOutput = babel.transformSync(
      `import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";

const payload = "small";
export const save = extract((captures) => Effect.succeed(captures.payload), {
  captures: Schema.Struct({ payload: Schema.String }),
  bind: { payload },
});
`,
      {
        filename: "C:/app/src/small.ts",
        babelrc: false,
        configFile: false,
        plugins: [[
          plugin,
          {
            buildId: BuildId,
            root: "C:/app",
            maxBindSourceLength: 8_000,
            onDiagnostic: (diagnostic: any) => clean.push(diagnostic),
          },
        ]],
      },
    );
    expect(cleanOutput?.code).toContain('id: "src/small.ts#save"');
    expect(clean).toEqual([]);
  });

  it("[M9] classifies unsupported policy, missing snapshot bindings, and unresolvable dependencies as collect diagnostics with a disposition", async () => {
    const { Resume, Component, dom, Portable, extract, collect } = await kit();

    // 1. Unsupported policy: action concurrency semantics the wire cannot carry.
    const SaveCode = Portable.code({
      id: "future.resume.diag.save",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: () => Effect.void,
    });
    const queued = runSync(
      Component.action(Portable.bind(SaveCode, { label: "Save" }), {
        concurrency: "queue",
      }),
    );
    const policy = collect(() =>
      dom.renderToString(() => {
        const button = dom.template("<button>Save")();
        dom.addEventListener(button, "click", Resume.event(queued), true);
        return button;
      }),
    );
    expect(policy.manifest.events).toEqual({});
    expect(policy.diagnostics).toMatchObject([
      {
        code: "unsupported-event-semantics",
        phase: "collect",
        severity: "warning",
        disposition: "fallback-required",
      },
    ]);

    // NEGATIVE CONTROL for (1). The same action with wire-expressible
    // semantics ships a manifest entry and *no* diagnostic — so "diagnose
    // every portable action" cannot pass this spec.
    const supported = runSync(
      Component.action(Portable.bind(SaveCode, { label: "Save" })),
    );
    const supportedCollect = collect(() =>
      dom.renderToString(() => {
        const button = dom.template("<button>Save")();
        dom.addEventListener(button, "click", Resume.event(supported), true);
        return button;
      }),
    );
    expect(Object.keys(supportedCollect.manifest.events)).toEqual(["e0"]);
    expect(supportedCollect.diagnostics).toEqual([]);

    // 2. Missing codec/identity: an expression dependency that is not a
    //    resumable state binding has no serializable identity.
    const Expression = extract.expressionCode({
      id: "future.resume.diag.expression",
      buildId: BuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (_captures: unknown, [count]: readonly [number]) => `v${count}`,
    });
    const Unsnapshotted = Component.make(
      Component.props(),
      Component.require(),
      // No `resume:` codec, so the handle has no wire identity.
      Component.setup().bind("count", () => Component.state(1)),
      (_props: unknown, bindings: any) => {
        const span = dom.template("<span>")();
        dom.insert(
          span,
          extract.bindExpression(Expression, {}, [bindings.count]),
        );
        return span;
      },
    ).pipe(Component.withDefinition({ name: "FutureDiagUnsnapshotted" }));
    const scope = Scope.makeUnsafe();
    const unresolved = collect(() =>
      dom.renderToString(() =>
        runSync(
          Component.renderEffect(Unsnapshotted, {}).pipe(Scope.provide(scope)),
        ),
      ),
    );
    runSync(Scope.close(scope, Exit.void));

    // The region falls back rather than shipping an unaddressable dependency.
    expect(
      unresolved.diagnostics.map((diagnostic: any) => diagnostic.code),
    ).toContain("unresolved-expression-dependency");
    for (const diagnostic of unresolved.diagnostics) {
      expect(diagnostic).toMatchObject({
        phase: "collect",
        severity: "warning",
        disposition: "fallback-required",
      });
      expect(typeof diagnostic.reason).toBe("string");
    }
    // A diagnosed region must not leave a half-installed manifest entry.
    expect(Object.keys(unresolved.manifest.expressions ?? {})).toEqual([]);

    // NEGATIVE CONTROL for (2). The same component with a `resume:` codec on
    // the dependency ships the expression entry and emits nothing.
    const Snapshotted = Component.make(
      Component.props(),
      Component.require(),
      Component.setup().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props: unknown, bindings: any) => {
        const span = dom.template("<span>")();
        dom.insert(
          span,
          extract.bindExpression(Expression, {}, [bindings.count]),
        );
        return span;
      },
    ).pipe(Component.withDefinition({ name: "FutureDiagSnapshotted" }));
    const cleanScope = Scope.makeUnsafe();
    const resolved = collect(() =>
      dom.renderToString(() =>
        runSync(
          Component.renderEffect(Snapshotted, {}).pipe(
            Scope.provide(cleanScope),
          ),
        ),
      ),
    );
    runSync(Scope.close(cleanScope, Exit.void));
    expect(resolved.diagnostics).toEqual([]);
    expect(Object.keys(resolved.manifest.expressions ?? {})).toEqual(["x0"]);
  });

  it("[M9] classifies build mismatch, stale markers, and duplicate installs as tagged errors", async () => {
    const { Resume, Component, Portable, dom, Serialization, collect } = await kit();
    const SaveCode = Portable.code({
      id: "future.resume.diag.tagged",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: () => Effect.void,
    });
    const action = runSync(
      Component.action(Portable.bind(SaveCode, { label: "Save" })),
    );
    const collected = collect(() =>
      dom.renderToString(() => {
        const button = dom.template("<button>Save")();
        dom.addEventListener(button, "click", Resume.event(action), true);
        return button;
      }),
    );
    expect(Object.keys(collected.manifest.events)).toEqual(["e0"]);

    // Build mismatch — server payload from another deploy.
    const mismatchTag = taggedFailure(
      runSyncExit(
        Resume.decodeManifest(collected.serializedManifest, "another-build").pipe(
          Effect.provide(Serialization.layer),
        ),
      ),
    );
    expect(mismatchTag).toBe("ResumeClientBuildMismatchError");
    // NEGATIVE CONTROL: the *matching* build id decodes, so "reject every
    // payload" cannot satisfy the assertion above.
    const decoded = runSync(
      Resume.decodeManifest(collected.serializedManifest, BuildId).pipe(
        Effect.provide(Serialization.layer),
      ),
    );
    expect(Object.keys(decoded.events)).toEqual(["e0"]);

    // Stale DOM marker — the HTML references an event the manifest dropped.
    const staleRoot = new FakeDocument([
      { kind: "element", attributes: { "data-af-event-click": "e9" } },
    ]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const staleTag = taggedFailure(
      runSyncExit(
        Resume.installClient({
          root: staleRoot.asDocument(),
          manifest: collected.manifest,
          expectedBuildId: BuildId,
          resolverEntries: {},
          runtime,
        }),
      ),
    );
    expect(staleTag).toBe("ResumeUnknownEventMarkerError");

    // NEGATIVE CONTROL for the marker gate, and the first install of the
    // duplicate-install case below: a marker the manifest *does* carry
    // installs cleanly.
    const goodRoot = new FakeDocument([
      { kind: "element", attributes: { "data-af-event-click": "e0" } },
    ]);
    const installation = runSync(
      Resume.installClient({
        root: goodRoot.asDocument(),
        manifest: collected.manifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime,
      }),
    );
    expect(installation.inspect()).toMatchObject({ disposed: false });
    expect(installation.inspect().eventListeners).toBeGreaterThan(0);

    // Duplicate install — one root may only be installed once.
    const duplicateTag = taggedFailure(
      runSyncExit(
        Resume.installClient({
          root: goodRoot.asDocument(),
          manifest: collected.manifest,
          expectedBuildId: BuildId,
          resolverEntries: {},
          runtime,
        }),
      ),
    );
    expect(duplicateTag).toBe("ResumeDuplicateClientInstallationError");

    // Three near-neighbour install-time failures, three distinct codes: one
    // generic "the payload is bad" error would otherwise pass all three.
    expect(new Set([mismatchTag, staleTag, duplicateTag]).size).toBe(3);

    await runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("[M8c.8] documents every client diagnostic code it can emit", async () => {
    const guide = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../../docs/RESUMABILITY_GUIDE.md", import.meta.url),
        "utf8",
      )
    );
    // 8c.8 exit criterion: the guide carries the diagnostics table. Every code
    // the runtime can hand an application must be findable in it, or an
    // operator meeting it in production has nothing to read.
    const codes = [
      "unknown-event-marker",
      "event-type-mismatch",
      "dispatch-resolution-failure",
      "dispatch-execution-failure",
      "event-handoff-failure",
      "component-resumption-fallback",
      "component-transition-mode-conflict",
      "component-query-refresh-failure",
      "expression-resolution-failure",
      "expression-execution-failure",
      "expression-patch-failure",
      "client-runtime-failure",
    ];
    const undocumented = codes.filter((code) => !guide.includes(code));
    expect(undocumented).toEqual([]);
    // Control on the check itself: a code that does not exist must *not* be
    // found, or this spec would pass against any non-empty document.
    expect(guide.includes("no-such-diagnostic-code")).toBe(false);
  });

  it("[M8c.8] documents every COLLECT diagnostic code it can emit", async () => {
    const guide = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../../docs/RESUMABILITY_GUIDE.md", import.meta.url),
        "utf8",
      )
    );
    // The sibling spec above audits only *client* codes. That gap is how 8c.4's
    // `unsupported-expression-target` shipped undocumented: it is emitted on the
    // server during `Resume.collect`, so nothing checked it. Collect diagnostics
    // are the contract that nothing opaque is silently serialized, which makes
    // them at least as operator-facing as the client ones.
    const codes = [
      "opaque-event-handler",
      "opaque-query-executor",
      "unsupported-event-semantics",
      "unsupported-query-semantics",
      "unsupported-expression-output",
      "unsupported-expression-target",
      "missing-component-boundary",
      "missing-expression-boundary",
      "missing-snapshot-binding",
    ];
    const undocumented = codes.filter((code) => !guide.includes(code));
    expect(undocumented).toEqual([]);
    // Same control as above: the check must be capable of failing.
    expect(guide.includes("no-such-collect-diagnostic")).toBe(false);
  });

  it("[M8c.8] the two diagnostic families are documented as distinct", async () => {
    const guide = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../../docs/RESUMABILITY_GUIDE.md", import.meta.url),
        "utf8",
      )
    );
    // Knowing *which side* emitted a diagnostic is the first thing an operator
    // needs: a collect diagnostic means "this was left out of the manifest, the
    // page still works"; a client diagnostic means "something that should have
    // resumed did not". Documenting the codes without that split would send
    // someone hunting on the wrong side of the wire.
    expect(guide).toMatch(/[Cc]ollect diagnostics/);
    expect(guide).toMatch(/[Cc]lient diagnostics/);
    expect(guide).toMatch(/Resume\.collect/);
    expect(guide).toMatch(/Resume\.installClient/);
  });
});
