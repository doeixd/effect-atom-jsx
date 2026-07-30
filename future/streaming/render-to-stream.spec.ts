/**
 * M11 item 3 — `renderToStream`.
 *
 * Shell-first streaming: synchronous content flushes immediately, each async
 * boundary emits a placeholder region (comment-pair, the same discipline as
 * resume boundaries), and its content flushes when its setup settles — ordered
 * first, then an out-of-order mode using the `ooo-async` swap technique.
 *
 * The render thunk keeps `renderToString`'s shape. What is new is that an
 * unresolved `Component.renderEffect(...)` in the tree is no longer a bug the
 * renderer papers over with `Effect.runSync`: it *is* the async boundary. The
 * renderer emits a placeholder region for it and flushes when it settles.
 *
 * The claims worth pinning, in order of how easily they rot:
 *   1. the shell is observable before the slow region settles (otherwise this
 *      milestone bought nothing);
 *   2. ordered mode holds a fast region back; out-of-order mode does not, and
 *      swaps over a CSP-compatible nonce-carrying script;
 *   3. no chunk ever splits a resume marker, so a boundary spanning a chunk
 *      boundary still scans as one region.
 */

import { Deferred, Effect, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { unbuilt } from "../harness.js";
import { StreamBuildId, resumeKit, srcModule } from "./support.js";

/** Collect every chunk a stream emits, plus the concatenated document. */
function drain(
  stream: any,
): Effect.Effect<{ readonly chunks: string[]; readonly html: string }, any> {
  const chunks: string[] = [];
  return Stream.runForEach(stream, (chunk: string) =>
    Effect.sync(() => {
      chunks.push(chunk);
    }),
  ).pipe(Effect.map(() => ({ chunks, html: chunks.join("") }))) as Effect.Effect<
    { readonly chunks: string[]; readonly html: string },
    any
  >;
}

/** Every `<!--af:...-->` token must be whole inside the chunk that carries it. */
function splitsAMarker(chunk: string): boolean {
  const opens = chunk.split("<!--af:").length - 1;
  const whole = (chunk.match(/<!--af:[\s\S]*?-->/g) ?? []).length;
  return opens !== whole;
}

describe("renderToStream (M11.3)", () => {
  it("[M11.3] flushes the shell before a slow region settles", async () => {
    const { dom } = await resumeKit();
    const Component = await srcModule("Component");
    if (dom.renderToStream === undefined) {
      unbuilt("dom.renderToStream", "M11 item 3");
    }

    const program = Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const Slow = Component.from(() =>
        Effect.gen(function* () {
          yield* Deferred.await(gate);
          return "slow body";
        }),
      );

      const chunks: string[] = [];
      let shellSeenWhileBlocked = false;
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(
          dom.renderToStream(
            () => ["shell", Component.renderEffect(Slow, {})],
            { mode: "ordered", buildId: StreamBuildId },
          ),
          (chunk: string) =>
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

    const { shellFirst, chunks, html } = await Effect.runPromise(
      program as Effect.Effect<any, never, never>,
    );

    // The point of the milestone: TTFB does not wait on the slow region.
    expect(shellFirst).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
    // And the slow content still arrives, after the shell.
    expect(html).toContain("slow body");
    expect(html.indexOf("shell")).toBeLessThan(html.indexOf("slow body"));
  });

  it("[M11.3] ordered mode holds a fast region behind a slow one", async () => {
    const { dom } = await resumeKit();
    const Component = await srcModule("Component");
    if (dom.renderToStream === undefined) {
      unbuilt("dom.renderToStream", "M11 item 3");
    }

    const delayed = (label: string, ms: number) =>
      Component.renderEffect(
        Component.from(() =>
          Effect.succeed(label).pipe(Effect.delay(`${ms} millis`)),
        ),
        {},
      );

    const { html, chunks } = await Effect.runPromise(
      drain(
        dom.renderToStream(() => [delayed("first", 40), delayed("second", 5)], {
          mode: "ordered",
          buildId: StreamBuildId,
        }),
      ) as Effect.Effect<any, never, never>,
    );

    // Document order, despite the second region settling first.
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
    // Ordered mode needs no swap scripts at all.
    expect(html).not.toContain("<script");
    for (const chunk of chunks) expect(splitsAMarker(chunk)).toBe(false);
  });

  it("[M11.3] out-of-order mode emits placeholders first, then a nonce-carrying swap", async () => {
    const { dom } = await resumeKit();
    const Component = await srcModule("Component");
    if (dom.renderToStream === undefined) {
      unbuilt("dom.renderToStream", "M11 item 3");
    }

    const delayed = (label: string, ms: number) =>
      Component.renderEffect(
        Component.from(() =>
          Effect.succeed(label).pipe(Effect.delay(`${ms} millis`)),
        ),
        {},
      );

    const { chunks, html } = await Effect.runPromise(
      drain(
        dom.renderToStream(
          () => [delayed("slowest", 40), delayed("quickest", 5)],
          { mode: "out-of-order", buildId: StreamBuildId, nonce: "future-nonce" },
        ),
      ) as Effect.Effect<any, never, never>,
    );

    // The fast region's content is streamed before the slow one's, which is the
    // only reason out-of-order mode exists.
    expect(html.indexOf("quickest")).toBeLessThan(html.indexOf("slowest"));
    // Placeholders come first, in document order, before any region content.
    const first = chunks[0] ?? "";
    expect(first).toMatch(/<!--af:region:[\s\S]*?:start-->/);
    expect(first).not.toContain("quickest");
    // The swap is a nonce-carrying inline script — CSP-compatible, with no
    // inline event handlers and no `javascript:` URLs.
    const swap =
      (chunks as string[]).find((chunk: string) => chunk.includes("<script")) ?? "";
    expect(swap).toContain('nonce="future-nonce"');
    expect(swap).not.toMatch(/\son[a-z]+=/);
    expect(swap).not.toContain("javascript:");
    for (const chunk of chunks) expect(splitsAMarker(chunk)).toBe(false);
  });

  it("[M11.3] treats async boundaries as authored, with ordered/out-of-order as one option", async () => {
    // Ratified DQ-006 (`RESUMABILITY_IMPLEMENTATION_PLAN.md` §Ratified
    // DQ-005–DQ-012): async boundaries are **explicit** — page structure must
    // not be a function of timing — `renderToStream` lives in `dom` beside
    // `renderToString`, and ordered vs out-of-order is ONE option on the call,
    // not two functions.
    const { dom } = await resumeKit();
    const Component = await srcModule("Component");
    if (dom.renderToStream === undefined) {
      unbuilt("dom.renderToStream", "M11 item 3");
    }

    // One module, one function: a sibling `renderToStreamOutOfOrder`-shaped
    // export would mean the mode had become a second entry point.
    expect(typeof dom.renderToString).toBe("function");
    expect(
      Object.keys(dom).filter((name) => /^renderToStream./.test(name)),
    ).toEqual([]);

    // A *synchronous* region that merely takes wall-clock time is not a
    // boundary: nothing about it is authored as async, so it must render
    // inline with no placeholder region. This is the whole of DQ-006 — an
    // implementation that inferred boundaries from timing fails right here.
    const spin = () => {
      const until = Date.now() + 30;
      while (Date.now() < until) {
        /* deliberately blocking */
      }
      return "sync-slow";
    };
    const { html: inferred } = await Effect.runPromise(
      drain(
        dom.renderToStream(() => ["shell", spin()], {
          mode: "ordered",
          buildId: StreamBuildId,
        }),
      ) as Effect.Effect<any, never, never>,
    );
    expect(inferred).toContain("sync-slow");
    expect(inferred.match(/<!--af:region:[\s\S]*?:start-->/g) ?? []).toEqual([]);

    // NEGATIVE CONTROL. The authored boundary — an unresolved
    // `Component.renderEffect` — *does* get a region, so "never emit a region"
    // cannot satisfy the assertion above.
    const { html: authored } = await Effect.runPromise(
      drain(
        dom.renderToStream(
          () => [
            "shell",
            Component.renderEffect(
              Component.from(() =>
                Effect.succeed("async-body").pipe(Effect.delay("5 millis")),
              ),
              {},
            ),
          ],
          { mode: "ordered", buildId: StreamBuildId },
        ),
      ) as Effect.Effect<any, never, never>,
    );
    expect(authored).toContain("async-body");
    expect(
      (authored.match(/<!--af:region:[\s\S]*?:start-->/g) ?? []).length,
    ).toBe(1);

    // And the mode is validated rather than silently defaulted: an unknown
    // value must fail, not quietly pick one of the two behaviours.
    const bad = await Effect.runPromise(
      Effect.exit(
        Stream.runDrain(
          dom.renderToStream(() => ["shell"], {
            mode: "whenever",
            buildId: StreamBuildId,
          }),
        ),
      ) as Effect.Effect<any, never, never>,
    );
    expect(bad._tag).toBe("Failure");
  });

  it("[M11.3] keeps a component boundary balanced across chunk boundaries", async () => {
    const { Resume, dom } = await resumeKit();
    const Component = await srcModule("Component");
    if (dom.renderToStream === undefined) {
      unbuilt("dom.renderToStream", "M11 item 3");
    }

    const { Schema } = await import("effect");
    const Addressable = Resume.addressable({
      id: "future.stream.chunked-boundary",
      buildId: StreamBuildId,
      props: Schema.Struct({}),
    })(
      Component.from(() =>
        Effect.succeed("region").pipe(Effect.delay("10 millis")),
      ),
    );

    const { chunks, html } = await Effect.runPromise(
      drain(
        dom.renderToStream(
          () => ["shell", Component.renderEffect(Addressable, {})],
          { mode: "ordered", buildId: StreamBuildId },
        ),
      ) as Effect.Effect<any, never, never>,
    );

    // Exactly one balanced pair survives the split.
    const starts = html.match(/<!--af:component:[\s\S]*?:start-->/g) ?? [];
    const ends = html.match(/<!--af:component:[\s\S]*?:end-->/g) ?? [];
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(html.indexOf(starts[0]!)).toBeLessThan(html.indexOf(ends[0]!));
    // And neither marker was cut in half by a flush.
    for (const chunk of chunks) expect(splitsAMarker(chunk)).toBe(false);
  });
});
