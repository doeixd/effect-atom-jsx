/**
 * K0b — `presence` as a catalog behavior (`DQ-071`, ratified) plus the
 * `ReducedMotion` service it injects. Exit animations keep content mounted;
 * reduced motion is a swappable test dimension, never a media-query sniff.
 */
import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import * as Behavior from "../Behavior.js";
import * as Element from "../Element.js";
import {
  presence,
  PresenceOptions,
} from "../behaviors/presence.js";
import {
  makeReducedMotion,
  ReducedMotion,
} from "../behaviors/reduced-motion.js";

// Machine spawning schedules its processing fiber asynchronously, so the
// attach itself runs through runPromise (same as machine.test.ts).
const attach = async (
  config: Parameters<typeof presence>[0],
  reducedMotion?: boolean | (() => boolean),
) => {
  const root = Element.container();
  const effect = Behavior.attachScoped(presence(config), { root });
  const attached = await Effect.runPromise(
    reducedMotion === undefined
      ? effect
      : effect.pipe(
        Effect.provideService(ReducedMotion, makeReducedMotion(reducedMotion)),
      ),
  );
  return { root, attached };
};

describe("presence behavior", () => {
  it("close parks in exiting; the root's animationend completes the unmount", async () => {
    const { root, attached } = await attach({});
    expect(attached.bindings.phase()).toBe("mounted");
    expect(attached.bindings.isPresent()).toBe(true);

    attached.bindings.close();
    await vi.waitFor(() => expect(attached.bindings.phase()).toBe("exiting"));
    // Logically closed, physically still there.
    expect(attached.bindings.isPresent()).toBe(true);

    root.emit("animationend", {});
    await vi.waitFor(() => expect(attached.bindings.phase()).toBe("unmounted"));
    expect(attached.bindings.isPresent()).toBe(false);

    // Reusable, not terminal.
    attached.bindings.open();
    await vi.waitFor(() => expect(attached.bindings.phase()).toBe("mounted"));
    Effect.runSync(attached.dispose);
  });

  it("under reduced motion, close unmounts immediately — read at transition time from the service", async () => {
    let prefers = false;
    const { attached } = await attach({}, () => prefers);

    // Same attachment, both preferences: the service is READ at transition
    // time, so flipping it between closes changes behavior without re-attach.
    attached.bindings.close();
    await vi.waitFor(() => expect(attached.bindings.phase()).toBe("exiting"));
    attached.bindings.open();
    await vi.waitFor(() => expect(attached.bindings.phase()).toBe("mounted"));

    prefers = true;
    attached.bindings.close();
    await vi.waitFor(() => expect(attached.bindings.phase()).toBe("unmounted"));
    Effect.runSync(attached.dispose);
  });

  it("a stale animationend from a cancelled exit does not tear down reopened content", async () => {
    const { root, attached } = await attach({});
    attached.bindings.close();
    await vi.waitFor(() => expect(attached.bindings.phase()).toBe("exiting"));
    attached.bindings.open();
    await vi.waitFor(() => expect(attached.bindings.phase()).toBe("mounted"));

    // The bug every presence implementation has had at least once.
    root.emit("animationend", {});
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(attached.bindings.phase()).toBe("mounted");
    expect(attached.bindings.isPresent()).toBe(true);
    Effect.runSync(attached.dispose);
  });

  it("initiallyPresent: false starts unmounted; Schema defaults decode from empty config", async () => {
    const { attached } = await attach({ initiallyPresent: false });
    expect(attached.bindings.phase()).toBe("unmounted");
    expect(attached.bindings.isPresent()).toBe(false);
    Effect.runSync(attached.dispose);

    expect(
      Effect.runSync(Behavior.decodeOptions("presence", PresenceOptions, {})),
    ).toEqual({ initiallyPresent: true });
  });

  it("publishes the ratified catalog contract: isPresent + phase provides, opaque attachment", () => {
    const behavior = presence();
    expect(Object.keys(behavior.metadata?.provides ?? {}).sort()).toEqual([
      "isPresent",
      "phase",
    ]);
    expect(Behavior.inspectAttachment(behavior).kind).toBe("opaque");
  });
});

describe("presence disposal", () => {
  it("dispose aborts: a mid-exit presence stops and refuses further events", async () => {
    const { root, attached } = await attach({});
    attached.bindings.close();
    await vi.waitFor(() => expect(attached.bindings.phase()).toBe("exiting"));

    Effect.runSync(attached.dispose);
    // The machine is stopped: no event moves it again, including the
    // animation end that was still in flight when the widget disposed.
    root.emit("animationend", {});
    attached.bindings.open();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(attached.bindings.phase()).toBe("exiting");
  });
});
