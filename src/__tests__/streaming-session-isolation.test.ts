/**
 * M11.1 — per-render server render state. Promoted from
 * `future/streaming/resume-session-isolation.spec.ts` (all green 2026-08-11),
 * retyped.
 *
 * Two renders that interleave must not see each other's markers, components,
 * expressions, diagnostics — or documents. The session and the render's own
 * server document travel on the fiber (`Resume.collectAsync`), inherited by
 * forked children; `renderToString` installs them for exactly its own
 * synchronous slices. Ratified `DQ-001` (widened item 1) and `DQ-009`
 * (scope-qualified markers, `:` rejected in ids at collection time).
 */
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Schema,
} from "effect";
import { describe, expect, it } from "vitest";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";
import { addEventListener, renderToString, template } from "../dom.js";

const StreamBuildId = "session-isolation-test-build";

interface SinkService {
  readonly record: (label: string) => Effect.Effect<void>;
}

function makeSink(name: string) {
  const calls: string[] = [];
  const Tag = Context.Service<SinkService>(name);
  const layer = Layer.succeed(Tag, {
    record: (label) =>
      Effect.sync(() => {
        calls.push(label);
      }),
  });
  return { calls, layer, Tag };
}

type Sink = ReturnType<typeof makeSink>;

/** A portable code whose run records its captured label through `sink`. */
function recordingCode(sink: Sink, id: string) {
  return Portable.code({
    id,
    buildId: StreamBuildId,
    captures: Schema.Struct({ label: Schema.String }),
    run: (captures: { readonly label: string }) =>
      Effect.gen(function* () {
        const service = yield* sink.Tag;
        yield* service.record(captures.label);
      }),
  });
}

/**
 * The server-side `Component.action` for a recording code, with a server stub
 * that dies: the action must only ever execute on the client.
 */
function portableAction(
  sink: Sink,
  code: ReturnType<typeof recordingCode>,
  label: string,
) {
  return Effect.runSync(
    Component.action(Portable.bind(code, { label })).pipe(
      Effect.provideService(sink.Tag, {
        record: () => Effect.die("server must not run a resumable action"),
      }),
    ),
  );
}

/** A `<button>` carrying a resume event handler, in the current render doc. */
function resumeButton(action: ReturnType<typeof portableAction>, text: string) {
  const button = template(`<button>${text}`)();
  addEventListener(button, "click", Resume.event(action), true);
  return button;
}

function eventCodeIds(result: Resume.CollectionResult): ReadonlyArray<string> {
  return Object.values(result.manifest.events)
    .map((entry) => ("code" in entry ? String(entry.code.id) : "activation"))
    .sort();
}

function eventMarkersOf(html: string): string[] {
  return [...html.matchAll(/data-af-event-click="([^"]*)"/g)].map(
    (match) => match[1]!,
  );
}

describe("resume session isolation (M11.1)", () => {
  it("keeps two interleaved renders' manifests disjoint", async () => {
    const sink = makeSink("isolation/manifests");
    const codeA = recordingCode(sink, "test.stream.iso.a");
    const codeB = recordingCode(sink, "test.stream.iso.b");
    const actionA1 = portableAction(sink, codeA, "a1");
    const actionA2 = portableAction(sink, codeA, "a2");
    const actionB = portableAction(sink, codeB, "b1");

    const program = Effect.gen(function* () {
      const parked = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();

      const renderA = Resume.collectAsync(
        () =>
          Effect.gen(function* () {
            const first = renderToString(() => resumeButton(actionA1, "A1"));
            // Hand control to request B mid-render.
            yield* Deferred.succeed(parked, undefined);
            yield* Deferred.await(released);
            const second = renderToString(() => resumeButton(actionA2, "A2"));
            return `${first}${second}`;
          }),
        { buildId: StreamBuildId },
      );

      const renderB = Effect.gen(function* () {
        yield* Deferred.await(parked);
        const result = yield* Resume.collectAsync(
          () => Effect.succeed(renderToString(() => resumeButton(actionB, "B1"))),
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
      program.pipe(Effect.provide(Serialization.layer)),
    );

    // A recorded both of its own passes: the second pass must still find A's
    // session even though B's render began and finished in between. With a
    // module-global session, A's second pass registers nothing.
    expect(eventCodeIds(resultA)).toEqual([codeA.id, codeA.id]);
    // And B saw only its own event — no bleed in the other direction.
    expect(eventCodeIds(resultB)).toEqual([codeB.id]);

    // Both renders number their markers from zero: ids are session-scoped
    // (DQ-009: "<installationId>:<eventId>", `:` reserved), so a shared
    // counter or marker table would show up here.
    const markersA = eventMarkersOf(resultA.html);
    const markersB = eventMarkersOf(resultB.html);
    for (const marker of [...markersA, ...markersB]) {
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

  it("does not leak one request's fallback diagnostic into another", async () => {
    const sink = makeSink("isolation/diagnostics");
    const code = recordingCode(sink, "test.stream.iso.diag");
    const clean = portableAction(sink, code, "clean");
    // An opaque (non-portable) handler is the cheapest fallback diagnostic.
    const opaque = Effect.runSync(Component.action(() => Effect.void));

    const program = Effect.gen(function* () {
      const parked = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();

      const cleanRender = Resume.collectAsync(
        () =>
          Effect.gen(function* () {
            const html = renderToString(() => resumeButton(clean, "Clean"));
            yield* Deferred.succeed(parked, undefined);
            yield* Deferred.await(released);
            return html;
          }),
        { buildId: StreamBuildId },
      );

      const dirtyRender = Effect.gen(function* () {
        yield* Deferred.await(parked);
        const result = yield* Resume.collectAsync(
          () =>
            Effect.succeed(
              renderToString(() => {
                const button = template("<button>Dirty")();
                addEventListener(button, "click", opaque, true);
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
      program.pipe(Effect.provide(Serialization.layer)),
    );

    expect(cleanResult.diagnostics).toEqual([]);
    expect(dirtyResult.diagnostics).toMatchObject([
      { code: "opaque-event-handler", eventType: "click" },
    ]);
    // The clean request still shipped its own resumable event.
    expect(Object.keys(cleanResult.manifest.events)).toEqual(["e0"]);
    expect(dirtyResult.manifest.events).toEqual({});
  });

  it("carries the session into forked render fibers, one per request", async () => {
    const sink = makeSink("isolation/forks");
    const codeA = recordingCode(sink, "test.stream.fork.a");
    const codeB = recordingCode(sink, "test.stream.fork.b");

    // Each request renders one region on a *forked* fiber — the shape M11
    // item 4 needs. The marker must still land in the forking request's
    // manifest.
    const requestFor = (code: ReturnType<typeof recordingCode>, label: string) => {
      const shell = portableAction(sink, code, `${label}-shell`);
      const region = portableAction(sink, code, `${label}-region`);
      return Resume.collectAsync(
        () =>
          Effect.gen(function* () {
            const shellHtml = renderToString(() =>
              resumeButton(shell, `${label} shell`)
            );
            const fiber = yield* Effect.forkChild(
              Effect.sync(() =>
                renderToString(() => resumeButton(region, `${label} region`))
              ).pipe(Effect.delay("5 millis")),
            );
            const regionHtml = yield* Fiber.await(fiber).pipe(
              Effect.flatMap((exit) => exit),
            );
            return `${shellHtml}${regionHtml}`;
          }),
        { buildId: StreamBuildId },
      );
    };

    const [resultA, resultB] = await Effect.runPromise(
      Effect.all([requestFor(codeA, "a"), requestFor(codeB, "b")], {
        concurrency: "unbounded",
      }).pipe(Effect.provide(Serialization.layer)),
    );

    // Two markers each — the shell's and the forked region's.
    expect(Object.keys(resultA.manifest.events)).toHaveLength(2);
    expect(Object.keys(resultB.manifest.events)).toHaveLength(2);
    // And no request registered the other's code.
    expect([...new Set(eventCodeIds(resultA))]).toEqual([codeA.id]);
    expect([...new Set(eventCodeIds(resultB))]).toEqual([codeB.id]);
    expect(sink.calls).toEqual([]);
  });

  it("gives two interleaved renders disjoint documents, and leaks neither globally", async () => {
    const carrier = globalThis as { document?: unknown };
    const globalBefore = carrier.document;
    const seen: Record<"a" | "b", unknown[]> = { a: [], b: [] };
    const observe = (which: "a" | "b") =>
      renderToString(() => {
        seen[which].push(carrier.document);
        const element = template("<span>")();
        element.textContent = which;
        return element;
      });

    const program = Effect.gen(function* () {
      const parked = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();

      const renderA = Resume.collectAsync(
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
        const result = yield* Resume.collectAsync(
          () => Effect.succeed(observe("b")),
          { buildId: StreamBuildId },
        );
        yield* Deferred.succeed(released, undefined);
        return result;
      });
      return yield* Effect.all([renderA, renderB], { concurrency: "unbounded" });
    });

    const [resultA, resultB] = await Effect.runPromise(
      program.pipe(Effect.provide(Serialization.layer)),
    );

    // Each render saw a document, and A saw the *same* one across its two
    // passes — the identity assertion is the point.
    expect(seen.a).toHaveLength(2);
    expect(seen.b).toHaveLength(1);
    for (const documentValue of [...seen.a, ...seen.b]) {
      expect(documentValue).toBeDefined();
    }
    expect(seen.a[0]).toBe(seen.a[1]);
    // …and B's document is a different object entirely.
    expect(seen.b[0]).not.toBe(seen.a[0]);

    // Neither render's HTML carries the other's content.
    expect(resultA.html).not.toContain(">b<");
    expect(resultB.html).not.toContain(">a<");

    // NEGATIVE CONTROL on the global: the ambient document is restored exactly
    // as it was, so "install a per-render document and forget to remove it"
    // is caught rather than left as a process-wide leak.
    expect(carrier.document).toBe(globalBefore);
  });

  it("rejects a reserved `:` inside a scope id at collection time", async () => {
    // DQ-009: `:` is the marker separator and is rejected inside installation
    // ids at collection time — validating at parse time on the client would
    // be too late, because the ambiguous marker is already in the HTML.
    const render = () => renderToString(() => "inert");
    const attempt = (installationId: string) =>
      Effect.runPromise(
        Effect.exit(
          Resume.collect(render, { buildId: StreamBuildId, installationId }),
        ).pipe(Effect.provide(Serialization.layer)),
      );

    for (const bad of ["page:one", ":", "a:b:c"]) {
      const exit = await attempt(bad);
      expect(Exit.isFailure(exit), `expected "${bad}" to be rejected`).toBe(true);
    }

    // NEGATIVE CONTROL. An ordinary scope id is accepted, and it is the one
    // that shows up in the manifest — so "reject every scope id" and "ignore
    // the scope id" both fail here.
    const ok = await attempt("pageok");
    expect(Exit.isSuccess(ok)).toBe(true);
    if (Exit.isSuccess(ok)) {
      expect(ok.value.manifest.installationId).toBe("pageok");
    }
  });
});
