/**
 * M11.2 — async component setup during SSR. Promoted from
 * `future/streaming/async-ssr.spec.ts` (all green 2026-08-11), retyped.
 *
 * Ratified `DQ-005`: `Resume.collectAsync` / `Resume.renderComponentAsync`
 * are separate entry points beside the synchronous pair, the deadline is
 * request-level only, and an overrun is classified as a per-region
 * activation fallback (an `"async-setup-timeout"` diagnostic) — a slow
 * region degrades to interactive-after-activation, never a 500. Purely
 * synchronous renders stay byte- and manifest-identical.
 */
import { Context, Deferred, Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";
import { addEventListener, renderToString, template } from "../dom.js";

const TestBuildId = "async-ssr-test-build";

const asyncTimeouts = (diagnostics: ReadonlyArray<Resume.ResumeDiagnostic>) =>
  diagnostics.filter((diagnostic) => diagnostic.code === "async-setup-timeout");

describe("async setup during SSR (M11.2)", () => {
  it("awaits a suspended setup and renders its committed bindings", async () => {
    const program = Effect.gen(function* () {
      const gate = yield* Deferred.make<string>();
      const Slow = Component.from<{}>(() =>
        Effect.gen(function* () {
          const label = yield* Deferred.await(gate);
          return template(`<span>${label}`)();
        })
      );
      // Release after the render has started, proving the renderer suspended
      // rather than sampling an unresolved setup.
      yield* Effect.forkChild(
        Deferred.succeed(gate, "settled").pipe(Effect.delay("10 millis")),
      );
      return yield* Resume.collectAsync(
        () => Resume.renderComponentAsync(Slow, {}),
        { buildId: TestBuildId, deadline: "1 second" },
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Serialization.layer)),
    );

    expect(result.html).toContain("settled");
    // A suspended-but-settled setup is not a deadline fallback.
    expect(asyncTimeouts(result.diagnostics)).toEqual([]);
  });

  it("turns a deadline overrun into a classified fallback, not a hang or defect", async () => {
    const program = Effect.gen(function* () {
      // Never resolves: the deadline is the only thing that can end this.
      const never = yield* Deferred.make<string>();
      const Stuck = Component.from<{}>(() =>
        Effect.gen(function* () {
          const label = yield* Deferred.await(never);
          return template(`<span>${label}`)();
        })
      );
      // A healthy sibling renders beside it: the overrun is a PER-REGION
      // fallback, so the fast region must still ship.
      const Fast = Component.from<{}>(() =>
        Effect.succeed(template("<span>fast")())
      );
      return yield* Resume.collectAsync(
        () =>
          Effect.all([
            Resume.renderComponentAsync(Fast, {}),
            Resume.renderComponentAsync(Stuck, {}),
          ]),
        { buildId: TestBuildId, deadline: "20 millis" },
      );
    });

    // Fails closed AS A VALUE: the response still exists, the region is
    // classified, nothing surfaced as a defect.
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Serialization.layer)),
    );

    const timeouts = asyncTimeouts(result.diagnostics);
    expect(timeouts).toMatchObject([
      { code: "async-setup-timeout", disposition: "fallback-required" },
    ]);
    // Exactly one: attributed to the one region that overran.
    expect(timeouts).toHaveLength(1);
    // NEGATIVE CONTROL in the same render: the healthy sibling shipped.
    expect(result.html).toContain("fast");
    expect(result.html).not.toContain("never");
    // A timed-out region contributes nothing to the manifest: the
    // ghost-snapshot rule — never register what was never rendered.
    expect(
      "expressions" in result.manifest ? result.manifest.expressions : {},
    ).toEqual({});
  });

  it("leaves purely synchronous renders byte- and manifest-identical", async () => {
    interface RecorderService {
      readonly record: (label: string) => Effect.Effect<void>;
    }
    const Recorder = Context.Service<RecorderService>(
      "effect-atom-jsx/test/AsyncSsrRecorder",
    );
    const code = Portable.code<
      { readonly label: string },
      { readonly label: string },
      readonly [],
      void,
      never,
      RecorderService
    >({
      id: "test.async-ssr.parity",
      buildId: TestBuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures) =>
        Effect.gen(function* () {
          const recorder = yield* Recorder;
          yield* recorder.record(captures.label);
        }),
    });
    const action = Effect.runSync(
      Component.action(Portable.bind(code, { label: "parity" })).pipe(
        Effect.provideService(Recorder, {
          record: () => Effect.die("the server must never run the action"),
        }),
      ),
    );
    const render = () =>
      renderToString(() => {
        const button = template("<button>Sync")();
        addEventListener(button, "click", Resume.event(action), true);
        return button;
      });

    // DQ-009 mints a distinct scope per collection, so byte parity requires
    // pinning the scope explicitly on both sides. The property under test:
    // the async mode adds no bytes and no manifest deltas.
    const sync = await Effect.runPromise(
      Resume.collect(render, {
        buildId: TestBuildId,
        installationId: "parity",
      }).pipe(Effect.provide(Serialization.layer)),
    );
    const async_ = await Effect.runPromise(
      Resume.collectAsync(() => Effect.sync(render), {
        buildId: TestBuildId,
        installationId: "parity",
        deadline: "1 second",
      }).pipe(Effect.provide(Serialization.layer)),
    );

    expect(async_.html).toBe(sync.html);
    expect(async_.manifest).toEqual(sync.manifest);
    expect(async_.serializedManifest).toBe(sync.serializedManifest);
    expect(async_.diagnostics).toEqual(sync.diagnostics);
  });

  it("releases the request scope even when a setup times out", async () => {
    const released: string[] = [];
    const program = Effect.gen(function* () {
      const never = yield* Deferred.make<string>();
      const Leaky = Component.from<{}>(() =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              released.push("setup");
            })
          );
          yield* Deferred.await(never);
          return template("<span>never")();
        })
      );
      return yield* Resume.collectAsync(
        () => Resume.renderComponentAsync(Leaky, {}),
        { buildId: TestBuildId, deadline: "20 millis" },
      );
    });

    await Effect.runPromise(
      Effect.exit(program.pipe(Effect.provide(Serialization.layer))),
    );

    // Exactly one release: the timed-out setup's resources are freed once
    // when the request scope closes — not left dangling, not double-released.
    expect(released).toEqual(["setup"]);
  });
});
