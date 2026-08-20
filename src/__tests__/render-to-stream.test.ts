/**
 * M11.2/11.3 — `renderToStream`. Promoted from
 * `future/streaming/render-to-stream.spec.ts` (all green 2026-08-11), retyped.
 *
 * Async boundaries are AUTHORED (ratified `DQ-006`): any Effect value in the
 * render tree is the boundary; a synchronous region that merely takes
 * wall-clock time renders inline with no region. Ordered mode flushes in
 * document order with zero scripts; out-of-order flushes the shell first and
 * swaps regions in as they settle over a nonce-carrying CSP-compatible
 * script. No chunk ever splits a resume marker.
 */
import { Deferred, Effect, Exit, Fiber, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import * as Component from "../Component.js";
import * as Resume from "../Resume.js";
import { renderToStream, type RenderToStreamOptions } from "../dom.js";

const StreamBuildId = "render-to-stream-test-build";

/** Collect every chunk a stream emits, plus the concatenated document. */
function drain(
  stream: Stream.Stream<string, unknown>,
): Effect.Effect<{ readonly chunks: string[]; readonly html: string }, unknown> {
  const chunks: string[] = [];
  return Stream.runForEach(stream, (chunk) =>
    Effect.sync(() => {
      chunks.push(chunk);
    }),
  ).pipe(Effect.map(() => ({ chunks, html: chunks.join("") })));
}

/** Every `<!--af:...-->` token must be whole inside the chunk that carries it. */
function splitsAMarker(chunk: string): boolean {
  const opens = chunk.split("<!--af:").length - 1;
  const whole = (chunk.match(/<!--af:[\s\S]*?-->/g) ?? []).length;
  return opens !== whole;
}

const delayed = (label: string, ms: number) =>
  Component.renderEffect(
    Component.from<{}>(() =>
      Effect.succeed(label).pipe(Effect.delay(`${ms} millis`))
    ),
    {},
  );

describe("renderToStream (M11.2/11.3)", () => {
  it("flushes the shell before a slow region settles", async () => {
    const program = Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const Slow = Component.from<{}>(() =>
        Effect.gen(function* () {
          yield* Deferred.await(gate);
          return "slow body";
        })
      );

      const chunks: string[] = [];
      let shellSeenWhileBlocked = false;
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(
          renderToStream(
            () => ["shell", Component.renderEffect(Slow, {})],
            { mode: "ordered", buildId: StreamBuildId },
          ),
          (chunk) =>
            Effect.sync(() => {
              chunks.push(chunk);
              if (chunk.includes("shell")) shellSeenWhileBlocked = true;
            }),
        ),
      );

      // Give the shell a chance to flush while the slow setup is still parked.
      yield* Effect.sleep("20 millis");
      const shellFirst =
        shellSeenWhileBlocked && !chunks.join("").includes("slow body");
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.await(fiber);
      return { shellFirst, chunks, html: chunks.join("") };
    });

    const { shellFirst, chunks, html } = await Effect.runPromise(program);

    // The point of the milestone: TTFB does not wait on the slow region.
    expect(shellFirst).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
    // And the slow content still arrives, after the shell.
    expect(html).toContain("slow body");
    expect(html.indexOf("shell")).toBeLessThan(html.indexOf("slow body"));
  });

  it("ordered mode holds a fast region behind a slow one", async () => {
    const { html, chunks } = await Effect.runPromise(
      drain(
        renderToStream(() => [delayed("first", 40), delayed("second", 5)], {
          mode: "ordered",
          buildId: StreamBuildId,
        }),
      ),
    );

    // Document order, despite the second region settling first.
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
    // Ordered mode needs no EXECUTABLE swap scripts at all. Inert
    // `application/json` streaming-manifest records (M11.5) are data, not
    // code, and are the only script tags allowed here.
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    for (const tag of scripts) {
      expect(tag).toContain('type="application/json"');
      expect(tag).toContain("data-af-stream");
    }
    for (const chunk of chunks) expect(splitsAMarker(chunk)).toBe(false);
  });

  it("out-of-order mode emits placeholders first, then a nonce-carrying swap", async () => {
    const { chunks, html } = await Effect.runPromise(
      drain(
        renderToStream(
          () => [delayed("slowest", 40), delayed("quickest", 5)],
          { mode: "out-of-order", buildId: StreamBuildId, nonce: "test-nonce" },
        ),
      ),
    );

    // The fast region's content is streamed before the slow one's, which is
    // the only reason out-of-order mode exists.
    expect(html.indexOf("quickest")).toBeLessThan(html.indexOf("slowest"));
    // Placeholders come first, in document order, before any region content.
    const first = chunks[0] ?? "";
    expect(first).toMatch(/<!--af:region:[^:]+:start-->/);
    expect(first).not.toContain("quickest");
    // The swap is a nonce-carrying inline script — CSP-compatible, with no
    // inline event handlers and no `javascript:` URLs.
    const swap = chunks.find((chunk) => chunk.includes("<script")) ?? "";
    expect(swap).toContain('nonce="test-nonce"');
    expect(swap).not.toMatch(/\son[a-z]+=/);
    expect(swap).not.toContain("javascript:");
    // The swap body must be syntactically valid JS — a quoting slip inside
    // the generated selector parses as HTML but throws in the browser before
    // any swap runs (caught by the Chromium proof 2026-08-11).
    const body = /<script[^>]*>([\s\S]*?)<\/script>/.exec(swap)?.[1] ?? "";
    expect(body.length).toBeGreaterThan(0);
    expect(() => new Function(body)).not.toThrow();
    for (const chunk of chunks) expect(splitsAMarker(chunk)).toBe(false);
  });

  it("treats async boundaries as authored, with ordered/out-of-order as one option", async () => {
    // DQ-006: page structure must not be a function of timing. A synchronous
    // region that merely takes wall-clock time is not a boundary.
    const spin = () => {
      const until = Date.now() + 30;
      while (Date.now() < until) {
        /* deliberately blocking */
      }
      return "sync-slow";
    };
    const { html: inferred } = await Effect.runPromise(
      drain(
        renderToStream(() => ["shell", spin()], {
          mode: "ordered",
          buildId: StreamBuildId,
        }),
      ),
    );
    expect(inferred).toContain("sync-slow");
    expect(inferred.match(/<!--af:region:[^:]+:start-->/g) ?? []).toEqual([]);

    // NEGATIVE CONTROL. The authored boundary — an unresolved
    // `Component.renderEffect` — *does* get a region, so "never emit a region"
    // cannot satisfy the assertion above.
    const { html: authored } = await Effect.runPromise(
      drain(
        renderToStream(() => ["shell", delayed("async-body", 5)], {
          mode: "ordered",
          buildId: StreamBuildId,
        }),
      ),
    );
    expect(authored).toContain("async-body");
    expect(
      (authored.match(/<!--af:region:[^:]+:start-->/g) ?? []).length,
    ).toBe(1);

    // And the mode is validated rather than silently defaulted. The invalid
    // value is deliberately outside the option type — this models an untyped
    // JS caller, which is exactly what the runtime validation exists for.
    const untypedOptions: unknown = { mode: "whenever", buildId: StreamBuildId };
    const bad = await Effect.runPromise(
      Effect.exit(
        Stream.runDrain(
          renderToStream(() => ["shell"], untypedOptions as RenderToStreamOptions),
        ),
      ),
    );
    expect(Exit.isFailure(bad)).toBe(true);
  });

  it("keeps a component boundary balanced across chunk boundaries", async () => {
    const Addressable = Resume.addressable({
      id: "test.stream.chunked-boundary",
      buildId: StreamBuildId,
      props: Schema.Struct({}),
    })(
      Component.from<{}>(() =>
        Effect.succeed("region").pipe(Effect.delay("10 millis"))
      ),
    );

    const { chunks, html } = await Effect.runPromise(
      drain(
        renderToStream(
          () => ["shell", Component.renderEffect(Addressable, {})],
          { mode: "ordered", buildId: StreamBuildId },
        ),
      ),
    );

    // Exactly one balanced pair survives the split (ids contain no `:`).
    const starts = html.match(/<!--af:component:[^:]+:start-->/g) ?? [];
    const ends = html.match(/<!--af:component:[^:]+:end-->/g) ?? [];
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(html.indexOf(starts[0]!)).toBeLessThan(html.indexOf(ends[0]!));
    // And neither marker was cut in half by a flush.
    for (const chunk of chunks) expect(splitsAMarker(chunk)).toBe(false);
  });
});
