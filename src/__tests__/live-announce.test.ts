/**
 * K0b item 5 — `LiveAnnouncer` service + `liveAnnounce` behavior
 * (`DQ-072`, ratified: one announce method; clear-after-timeout is the
 * Layer's policy). The concrete proof of services-not-globals: everything
 * here runs with no DOM.
 */
import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import * as Behavior from "../Behavior.js";
import {
  liveAnnounce,
  LiveAnnouncer,
  makeLiveAnnouncer,
} from "../behaviors/live-announce.js";

describe("LiveAnnouncer service", () => {
  it("a mock captures polite/assertive distinctly, with no DOM", () => {
    const captured: Array<{ message: string; politeness: string }> = [];
    const announcer = makeLiveAnnouncer({
      onAnnounce: (message, politeness) => captured.push({ message, politeness }),
    });
    Effect.runSync(announcer.announce("3 results"));
    Effect.runSync(announcer.announce("loading", "assertive"));
    expect(captured).toEqual([
      { message: "3 results", politeness: "polite" },
      { message: "loading", politeness: "assertive" },
    ]);
    // Two independent channels of rendered state.
    expect(announcer.current("polite")).toBe("3 results");
    expect(announcer.current("assertive")).toBe("loading");
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
  });

  it("clear-after-timeout is the Layer's policy, and a newer announcement wins the race", async () => {
    const announcer = makeLiveAnnouncer({ clearAfterMs: 50 });
    Effect.runSync(announcer.announce("first"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Replace before the first clear fires: the stale timer must not clear
    // the newer message.
    Effect.runSync(announcer.announce("second"));
    // Past the FIRST announcement's deadline, before the second's: a stale
    // timer that survived the replacement would have cleared this already.
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(announcer.current("polite")).toBe("second");
    await vi.waitFor(() => expect(announcer.current("polite")).toBeUndefined());
  });

  it("each Layer provision is an isolated announcer", async () => {
    const read = Effect.gen(function* () {
      const announcer = yield* LiveAnnouncer;
      yield* announcer.announce("mine");
      return announcer.current("polite");
    });
    const [left, right] = await Promise.all([
      Effect.runPromise(read.pipe(Effect.provide(LiveAnnouncer.layer))),
      Effect.runPromise(read.pipe(Effect.provide(LiveAnnouncer.layer))),
    ]);
    expect(left).toBe("mine");
    expect(right).toBe("mine");
  });
});

describe("liveAnnounce behavior", () => {
  it("binds announce to the subtree's service with a Schema default politeness", () => {
    const captured: Array<string> = [];
    const announcer = makeLiveAnnouncer({
      onAnnounce: (message, politeness) => captured.push(`${politeness}:${message}`),
    });
    const attached = Effect.runSync(
      Behavior.attachScoped(liveAnnounce({ politeness: "assertive" }), {}).pipe(
        Effect.provideService(LiveAnnouncer, announcer),
      ),
    );
    attached.bindings.announce("saved");
    attached.bindings.announce("count", "polite");
    expect(captured).toEqual(["assertive:saved", "polite:count"]);
    expect(Object.keys(attached.bindings)).toEqual(["announce"]);
    Effect.runSync(attached.dispose);
  });
});
