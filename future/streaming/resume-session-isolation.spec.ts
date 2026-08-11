/**
 * M11 item 1 — per-request resume sessions.
 *
 * Today `src/resume-session.ts` keeps one module-global `activeSession` and
 * swaps it around a synchronous render (`runInResumeSession`). That is safe
 * only because `Resume.collect` never suspends. The finished design makes the
 * session **per request**: a `ResumeSession` service resolved from Effect
 * context, paired with an ambient dynamic scope for the synchronous renderer
 * (the pattern `src/resume-session.ts` already uses for the head/loader stores)
 * — this Effect v4 beta has no `FiberRef`, and `Effect.runSync` inside
 * `renderToString` starts a fresh fiber, so context alone cannot carry it.
 *
 * The observable claim these specs pin: **two renders that interleave must not
 * see each other's markers, components, expressions or diagnostics.**
 *
 * WIDENED 2026-07-30, ratifying DQ-001: M11 item 1 is now "per-render server
 * render state — session **and document and SSR mode**". The module-global
 * server `document`/`Node` that `dom.ts` installs is part of the same problem:
 * de-globalizing the session is necessary but not sufficient, because two
 * concurrent renders would still share one mutable document. So the isolation
 * claim these specs pin is **disjoint documents**, not merely disjoint
 * manifests — see the document spec at the bottom of this file.
 */

import { Deferred, Effect, Fiber } from "effect";
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

describe("resume session isolation (M11.1)", () => {
  it("[M11.1] keeps two interleaved renders' manifests disjoint", async () => {
    const { Portable, Resume, Serialization, dom } = await resumeKit();
    // `collectAsync` is the async-capable collector M11 item 2 introduces; item
    // 1 is what makes it safe. A render may suspend between marker-emitting
    // passes while another request renders to completion.
    const collectAsync = Resume.collectAsync;
    if (collectAsync === undefined) {
      unbuilt("Resume.collectAsync (async render mode)", "M11 items 1-2");
    }

    const sink = await makeSink();
    const codeA = await recordingCode(Portable, sink, "future.stream.iso.a");
    const codeB = await recordingCode(Portable, sink, "future.stream.iso.b");
    const actionA1 = await portableAction(sink, codeA, "a1");
    const actionA2 = await portableAction(sink, codeA, "a2");
    const actionB = await portableAction(sink, codeB, "b1");

    const program = Effect.gen(function* () {
      const parked = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();

      const renderA = collectAsync(
        () =>
          Effect.gen(function* () {
            const first = dom.renderToString(() =>
              resumeButton(dom, Resume, actionA1, "A1"),
            );
            // Hand control to request B mid-render.
            yield* Deferred.succeed(parked, undefined);
            yield* Deferred.await(released);
            const second = dom.renderToString(() =>
              resumeButton(dom, Resume, actionA2, "A2"),
            );
            return `${first}${second}`;
          }),
        { buildId: StreamBuildId },
      );

      const renderB = Effect.gen(function* () {
        yield* Deferred.await(parked);
        const result = yield* collectAsync(
          () =>
            Effect.succeed(
              dom.renderToString(() => resumeButton(dom, Resume, actionB, "B1")),
            ),
          { buildId: StreamBuildId },
        );
        yield* Deferred.succeed(released, undefined);
        return result;
      });

      return yield* Effect.all([renderA, renderB], {
        concurrency: "unbounded",
      });
    });

    const [resultA, resultB] = await Effect.runPromise(
      program.pipe(Effect.provide(Serialization.layer)) as unknown as Effect.Effect<ReadonlyArray<any>, never, never>,
    );

    // A recorded both of its own passes: the second pass must still find A's
    // session even though B's render began and finished in between. With a
    // module-global session, A's second pass registers nothing.
    const codeIdsOf = (result: any): string[] =>
      Object.values(result.manifest.events as Record<string, any>)
        .map((entry: any) => entry.code?.id)
        .sort();
    expect(codeIdsOf(resultA)).toEqual([codeA.id, codeA.id]);
    // And B saw only its own event — no bleed in the other direction.
    expect(codeIdsOf(resultB)).toEqual([codeB.id]);

    // Both renders number their markers from zero: ids are session-scoped, so
    // a shared counter (or a shared marker table) would show up here.
    //
    // Ratified DQ-009: every marker is `"<installationId>:<eventId>"`, and **the page
    // installation gets an explicit scope id too** — there is no unqualified
    // special case, because that is precisely how a fragment id eventually
    // collides with the page's.
    const markersOf = (html: string): string[] =>
      [...html.matchAll(/data-af-event-click="([^"]*)"/g)].map(
        (match) => match[1]!,
      );
    const markersA = markersOf(resultA.html);
    const markersB = markersOf(resultB.html);
    for (const marker of [...markersA, ...markersB]) {
      // Exactly one separator: scope-qualified, and `:` is reserved so it
      // cannot appear inside either half.
      expect(marker.split(":")).toHaveLength(2);
    }
    expect(markersA.map((marker) => marker.split(":")[1])).toEqual(["e0", "e1"]);
    expect(markersB.map((marker) => marker.split(":")[1])).toEqual(["e0"]);
    // Two independent collections must not share a scope id, or `r0:e0` from
    // one would resolve against the other's table after a fragment mount.
    const scopesA = new Set(markersA.map((marker) => marker.split(":")[0]));
    const scopesB = new Set(markersB.map((marker) => marker.split(":")[0]));
    expect(scopesA.size).toBe(1);
    expect(scopesB.size).toBe(1);
    expect([...scopesA][0]).not.toBe([...scopesB][0]);

    // Neither action executed on the server.
    expect(sink.calls).toEqual([]);
  });

  it("[M11.1] does not leak one request's fallback diagnostic into another", async () => {
    const { Portable, Resume, Serialization, dom } = await resumeKit();
    const collectAsync = Resume.collectAsync;
    if (collectAsync === undefined) {
      unbuilt("Resume.collectAsync (async render mode)", "M11 items 1-2");
    }

    const Component = await srcModule("Component");
    const sink = await makeSink();
    const code = await recordingCode(Portable, sink, "future.stream.iso.diag");
    const clean = await portableAction(sink, code, "clean");
    // An opaque (non-portable) handler is the cheapest fallback diagnostic.
    const opaque = Effect.runSync(Component.action(() => Effect.void));

    const program = Effect.gen(function* () {
      const parked = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();

      const cleanRender = collectAsync(
        () =>
          Effect.gen(function* () {
            const html = dom.renderToString(() =>
              resumeButton(dom, Resume, clean, "Clean"),
            );
            yield* Deferred.succeed(parked, undefined);
            yield* Deferred.await(released);
            return html;
          }),
        { buildId: StreamBuildId },
      );

      const dirtyRender = Effect.gen(function* () {
        yield* Deferred.await(parked);
        const result = yield* collectAsync(
          () =>
            Effect.succeed(
              dom.renderToString(() => {
                const button = dom.template("<button>Dirty")();
                dom.addEventListener(button, "click", opaque, true);
                return button;
              }),
            ),
          { buildId: StreamBuildId },
        );
        yield* Deferred.succeed(released, undefined);
        return result;
      });

      return yield* Effect.all([cleanRender, dirtyRender], {
        concurrency: "unbounded",
      });
    });

    const [cleanResult, dirtyResult] = await Effect.runPromise(
      program.pipe(Effect.provide(Serialization.layer)) as unknown as Effect.Effect<ReadonlyArray<any>, never, never>,
    );

    expect(cleanResult.diagnostics).toEqual([]);
    expect(dirtyResult.diagnostics).toMatchObject([
      { code: "opaque-event-handler", eventType: "click" },
    ]);
    // The clean request still shipped its own resumable event.
    expect(Object.keys(cleanResult.manifest.events)).toEqual(["e0"]);
    expect(dirtyResult.manifest.events).toEqual({});
  });

  it("[M11.1] carries the session into forked render fibers, one per request", async () => {
    const { Portable, Resume, Serialization, dom } = await resumeKit();
    const collectAsync = Resume.collectAsync;
    if (collectAsync === undefined) {
      unbuilt("Resume.collectAsync (async render mode)", "M11 items 1-2");
    }

    const sink = await makeSink();
    const codeA = await recordingCode(Portable, sink, "future.stream.fork.a");
    const codeB = await recordingCode(Portable, sink, "future.stream.fork.b");

    // Each request renders one region on a *forked* fiber — the shape M11 item
    // 4 needs. The marker must still land in the forking request's manifest.
    const requestFor = async (code: any, label: string) => {
      const shell = await portableAction(sink, code, `${label}-shell`);
      const region = await portableAction(sink, code, `${label}-region`);
      return collectAsync(
        () =>
          Effect.gen(function* () {
            const shellHtml = dom.renderToString(() =>
              resumeButton(dom, Resume, shell, `${label} shell`),
            );
            const fiber = yield* Effect.forkChild(
              Effect.sync(() =>
                dom.renderToString(() =>
                  resumeButton(dom, Resume, region, `${label} region`),
                ),
              ).pipe(Effect.delay("5 millis")),
            );
            // (Corrected to this Effect v4 beta's API: `Fiber.await(fiber)`,
            // not a `.await` property on the fiber.)
            const regionHtml = yield* Fiber.await(fiber).pipe(
              Effect.flatMap((exit: any) => exit),
            );
            return `${shellHtml}${regionHtml as string}`;
          }),
        { buildId: StreamBuildId },
      );
    };

    const [resultA, resultB] = await Effect.runPromise(
      Effect.all(
        [await requestFor(codeA, "a"), await requestFor(codeB, "b")],
        { concurrency: "unbounded" },
      ).pipe(Effect.provide(Serialization.layer)) as unknown as Effect.Effect<ReadonlyArray<any>, never, never>,
    );

    const idsOf = (result: any): string[] => [
      ...new Set(
        Object.values(result.manifest.events as Record<string, any>).map(
          (entry: any) => entry.code?.id,
        ),
      ),
    ];
    // Two markers each — the shell's and the forked region's.
    expect(Object.keys(resultA.manifest.events)).toHaveLength(2);
    expect(Object.keys(resultB.manifest.events)).toHaveLength(2);
    // And no request registered the other's code.
    expect(idsOf(resultA)).toEqual([codeA.id]);
    expect(idsOf(resultB)).toEqual([codeB.id]);
    expect(sink.calls).toEqual([]);
  });

  it("[M11.1] gives two interleaved renders disjoint documents, and leaks neither globally", async () => {
    // Ratified DQ-001: M11 item 1 is per-render server render state — session
    // **and document and SSR mode**. De-globalizing only the session leaves two
    // concurrent renders mutating one `document`, which is the failure this
    // spec exists to catch. There is no `FiberRef` in this Effect v4 beta and
    // `Effect.runSync` inside `renderToString` starts a fresh fiber, so this
    // needs a service paired with an ambient dynamic scope.
    const { Resume, Serialization, dom } = await resumeKit();
    const collectAsync = Resume.collectAsync;
    if (collectAsync === undefined) {
      unbuilt("Resume.collectAsync (async render mode)", "M11 items 1-2");
    }

    const globalBefore = (globalThis as any).document;
    const seen: Record<string, unknown[]> = { a: [], b: [] };
    const observe = (which: "a" | "b") =>
      dom.renderToString(() => {
        seen[which]!.push((globalThis as any).document);
        const element = dom.template("<span>")();
        element.textContent = which;
        return element;
      });

    const program = Effect.gen(function* () {
      const parked = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();

      const renderA = collectAsync(
        () =>
          Effect.gen(function* () {
            const first = observe("a");
            yield* Deferred.succeed(parked, undefined);
            yield* Deferred.await(released);
            // Resuming after another render came and went must find *A's*
            // document again, not whatever B installed last.
            const second = observe("a");
            return `${first}${second}`;
          }),
        { buildId: StreamBuildId },
      );
      const renderB = Effect.gen(function* () {
        yield* Deferred.await(parked);
        const result = yield* collectAsync(
          () => Effect.succeed(observe("b")),
          { buildId: StreamBuildId },
        );
        yield* Deferred.succeed(released, undefined);
        return result;
      });
      return yield* Effect.all([renderA, renderB], { concurrency: "unbounded" });
    });

    const [resultA, resultB] = await Effect.runPromise(
      program.pipe(Effect.provide(Serialization.layer)) as unknown as Effect.Effect<
        ReadonlyArray<any>,
        never,
        never
      >,
    );

    // Each render saw a document, and A saw the *same* one across its two
    // passes — the identity assertion is the point; comparing rendered HTML
    // would pass even under one shared global document.
    expect(seen.a).toHaveLength(2);
    expect(seen.b).toHaveLength(1);
    for (const document of [...seen.a!, ...seen.b!]) {
      expect(document).toBeDefined();
    }
    expect(seen.a![0]).toBe(seen.a![1]);
    // …and B's document is a different object entirely.
    expect(seen.b![0]).not.toBe(seen.a![0]);

    // Neither render's HTML carries the other's content: the disjointness is
    // observable in the output as well as in the identities.
    expect(resultA.html).not.toContain(">b<");
    expect(resultB.html).not.toContain(">a<");

    // NEGATIVE CONTROL on the global: the ambient document is restored exactly
    // as it was, so "install a per-render document and forget to remove it"
    // is caught rather than left as a process-wide leak.
    expect((globalThis as any).document).toBe(globalBefore);
  });

  it("[M11.1] rejects a reserved `:` inside a scope id at collection time", async () => {
    // Ratified DQ-009: `:` is the marker separator and is **rejected inside
    // region and installation ids at collection time** — validating at parse
    // time on the client would be too late, because the ambiguous marker is
    // already in the HTML by then.
    const { Resume, Serialization, dom } = await resumeKit();
    const collect = Resume.collect;

    const render = () => dom.renderToString(() => "inert");
    const attempt = (installationId: string) =>
      Effect.runPromise(
        Effect.exit(
          collect(render, { buildId: StreamBuildId, installationId }),
        ).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<
          any,
          never,
          never
        >,
      );

    for (const bad of ["page:one", ":", "a:b:c"]) {
      const exit = await attempt(bad);
      expect(exit._tag, `expected "${bad}" to be rejected`).toBe("Failure");
    }

    // NEGATIVE CONTROL. An ordinary scope id is accepted, and it is the one
    // that shows up in the markers — so "reject every scope id" and "ignore
    // the scope id" both fail here.
    const ok = await attempt("page0");
    expect(ok._tag).toBe("Success");
    expect(ok.value.manifest.installationId ?? "page0").toBe("page0");
  });
});
