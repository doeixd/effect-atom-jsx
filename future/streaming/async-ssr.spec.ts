/**
 * M11 item 2 — async component setup during SSR.
 *
 * Component setup is already an Effect; the synchronous renderer simply never
 * awaits it. Ratified DQ-005 (`RESUMABILITY_IMPLEMENTATION_PLAN.md` §Ratified
 * DQ-005–DQ-012): `Resume.collectAsync` / `renderComponentAsync` are **separate
 * entry points beside the synchronous pair** — the type-level separation is
 * what makes the "no regression to the synchronous path" promise checkable —
 * and the deadline is **request-level only** in this slice. An overrun is
 * classified as a **per-region activation fallback**, reusing the existing
 * fail-closed path, so a slow region degrades to "interactive after
 * activation" rather than becoming a 500.
 *
 * Ordinary synchronous components must be unaffected: same bytes, same
 * manifest, no deadline machinery in their path.
 *
 * SCOPE LIMIT. These specs render **one request at a time**, so they say
 * nothing about two requests suspending inside a render simultaneously. That
 * is M11 item 1's job (widened by DQ-001 to cover the server `document` and
 * SSR mode as well as the session), and it is specified in
 * `resume-session-isolation.spec.ts`.
 */

import { Deferred, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { unbuilt } from "../harness.js";
import {
  StreamBuildId,
  makeSink,
  portableAction,
  recordingCode,
  resumeButton,
  resumeKit,
  srcModule,
} from "./support.js";

describe("async setup during SSR (M11.2)", () => {
  it("[M11.2] awaits a suspended setup and renders its committed bindings", async () => {
    const { Resume, Serialization, dom } = await resumeKit();
    const Component = await srcModule("Component");
    const collectAsync = Resume.collectAsync;
    const renderComponentAsync = Resume.renderComponentAsync;
    if (collectAsync === undefined || renderComponentAsync === undefined) {
      unbuilt(
        "Resume.collectAsync + Resume.renderComponentAsync (async render mode)",
        "M11 item 2",
      );
    }

    const program = Effect.gen(function* () {
      const gate = yield* Deferred.make<string>();
      const Slow = Component.from(() =>
        Effect.gen(function* () {
          const label = yield* Deferred.await(gate);
          return dom.template(`<span>${label}`)();
        }),
      );
      // Release after the render has started, proving the renderer suspended
      // rather than sampling an unresolved setup.
      yield* Effect.forkChild(
        Deferred.succeed(gate, "settled").pipe(Effect.delay("10 millis")),
      );
      return yield* collectAsync(
        () => renderComponentAsync(Slow, {}),
        { buildId: StreamBuildId, deadline: "1 second" },
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    expect(result.html).toContain("settled");
    // A suspended-but-settled setup is not a fallback: no diagnostic.
    expect(result.diagnostics).toEqual([]);
  });

  it("[M11.2] turns a deadline overrun into a classified fallback, not a hang or defect", async () => {
    const { Resume, Serialization, dom } = await resumeKit();
    const Component = await srcModule("Component");
    const collectAsync = Resume.collectAsync;
    const renderComponentAsync = Resume.renderComponentAsync;
    if (collectAsync === undefined || renderComponentAsync === undefined) {
      unbuilt(
        "Resume.collectAsync + Resume.renderComponentAsync (async render mode)",
        "M11 item 2",
      );
    }

    const program = Effect.gen(function* () {
      // Never resolves: the deadline is the only thing that can end this.
      const never = yield* Deferred.make<string>();
      const Stuck = Component.from(() =>
        Effect.gen(function* () {
          const label = yield* Deferred.await(never);
          return dom.template(`<span>${label}`)();
        }),
      );
      // A healthy sibling renders beside it. The overrun is a **per-region**
      // fallback, so the fast region must still ship — a request-level
      // deadline that failed the whole render would take this down too.
      const Fast = Component.from(() =>
        Effect.succeed(dom.template("<span>fast")()),
      );
      return yield* collectAsync(
        () =>
          Effect.all([
            renderComponentAsync(Fast, {}),
            renderComponentAsync(Stuck, {}),
          ]),
        { buildId: StreamBuildId, deadline: "20 millis" },
      );
    });

    const exit = await Effect.runPromise(
      Effect.exit(program).pipe(
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<any, never, never>,
    );

    // Fails closed *as a value*: the response still exists, the region is
    // classified as needing fallback, and nothing surfaced as a defect. This
    // is the existing fail-closed path being reused, not a new failure mode.
    expect(exit._tag).toBe("Success");
    const result = exit.value;
    expect(result.diagnostics).toMatchObject([
      { code: "async-setup-timeout", disposition: "fallback-required" },
    ]);
    // Exactly one diagnostic: the overrun is attributed to the one region that
    // overran, not raised once per region under a request-level deadline.
    expect(result.diagnostics).toHaveLength(1);
    // NEGATIVE CONTROL, in the same render: the healthy sibling still shipped
    // its HTML. "Slow region degrades to interactive-after-activation, never a
    // 500" is meaningless if the rest of the page dies with it, and an
    // implementation that failed the whole render would pass every assertion
    // above if this line were absent.
    expect(result.html).toContain("fast");
    expect(result.html).not.toContain("never");
    // A timed-out region contributes no boundaries or expressions: the
    // ghost-snapshot rule — never register what was never rendered.
    for (const entry of Object.values(result.manifest.components ?? {}) as any[]) {
      expect(entry.id).not.toBe("Stuck");
    }
    expect(result.manifest.expressions ?? {}).toEqual({});
  });

  it("[M11.2] leaves purely synchronous renders byte- and manifest-identical", async () => {
    const { Portable, Resume, Serialization, dom } = await resumeKit();
    const collectAsync = Resume.collectAsync;
    if (collectAsync === undefined) {
      unbuilt("Resume.collectAsync (async render mode)", "M11 item 2");
    }

    const sink = await makeSink();
    const code = await recordingCode(Portable, sink, "future.stream.sync.parity");
    const action = await portableAction(sink, code, "parity");
    const render = () => dom.renderToString(() => resumeButton(dom, Resume, action, "Sync"));

    const sync = await Effect.runPromise(
      Resume.collect(render, { buildId: StreamBuildId }).pipe(
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<any, never, never>,
    );
    const async_ = await Effect.runPromise(
      collectAsync(() => Effect.sync(render), {
        buildId: StreamBuildId,
        deadline: "1 second",
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    expect(async_.html).toBe(sync.html);
    expect(async_.manifest).toEqual(sync.manifest);
    expect(async_.serializedManifest).toBe(sync.serializedManifest);
    expect(async_.diagnostics).toEqual(sync.diagnostics);
  });

  it("[M11.2] releases the request scope even when a setup times out", async () => {
    const { Resume, Serialization, dom } = await resumeKit();
    const Component = await srcModule("Component");
    const collectAsync = Resume.collectAsync;
    const renderComponentAsync = Resume.renderComponentAsync;
    if (collectAsync === undefined || renderComponentAsync === undefined) {
      unbuilt(
        "Resume.collectAsync + Resume.renderComponentAsync (async render mode)",
        "M11 item 2",
      );
    }

    const released: string[] = [];
    const program = Effect.gen(function* () {
      const never = yield* Deferred.make<string>();
      const Leaky = Component.from(() =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              released.push("setup");
            }),
          );
          yield* Deferred.await(never);
          return dom.template("<span>never")();
        }),
      );
      return yield* collectAsync(
        () => renderComponentAsync(Leaky, {}),
        { buildId: StreamBuildId, deadline: "20 millis" },
      );
    });

    await Effect.runPromise(
      Effect.exit(program).pipe(
        Effect.provide(Serialization.layer),
      ) as Effect.Effect<any, never, never>,
    );

    // Exactly one release: the timed-out setup's resources are freed once when
    // the request scope closes, not left dangling and not double-released.
    expect(released).toEqual(["setup"]);
  });
});
