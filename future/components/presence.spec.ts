/**
 * K0b — `presence`, the first non-widget `Machine` customer.
 *
 * Owning docs: `docs/COMPONENT_KIT_PLAN.md` mandated coverage item K0b.6
 * (*"`close` keeps content mounted in `Exiting` until `animationEnd`, then
 * `Unmounted`; under reduced motion it force-unmounts immediately, skipping
 * `Exiting` entirely"*) and `docs/kit-research/behaviors/presence.md` §2, which
 * decides the shape: a small Machine `Mounted | Exiting | Unmounted` with events
 * `open`, `close`, `animationEnd`, forcing unmount under reduced motion, and §4
 * "dispose aborts".
 *
 * The machine is built inside the specs from `src/Machine.ts` (the pattern
 * `machine-resume.spec.ts` uses for its disclosure machine) because the states
 * and events are *decided* while the catalog packaging is not: whether reduced
 * motion arrives as a Schema option or as a `ReducedMotion` service layer, and
 * what the behaviour's published binding names are, is K0b's call — see the
 * final `unbuilt` spec. What is specified here is the semantics that packaging
 * must preserve, and the claim that `Machine` can express a lifecycle machine
 * at all.
 */
import { Effect, Exit, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { loadSrc, pick, unbuilt } from "../harness.js";

/**
 * Fresh presence machine per spec. `reducedMotion` is read at transition time,
 * so one definition covers both motion preferences.
 */
async function presenceMachine(options: { readonly reducedMotion: boolean }) {
  const Machine = await loadSrc("Machine");
  const { defineStates, make, spawn } = pick(
    Machine,
    "Machine",
    "defineStates",
    "make",
    "spawn",
  );

  class Mounted extends Schema.TaggedClass<Mounted>()("Mounted", {}) {}
  class Exiting extends Schema.TaggedClass<Exiting>()("Exiting", {}) {}
  class Unmounted extends Schema.TaggedClass<Unmounted>()("Unmounted", {}) {}
  class OpenEvent extends Schema.TaggedClass<OpenEvent>()("OpenEvent", {}) {}
  class CloseEvent extends Schema.TaggedClass<CloseEvent>()("CloseEvent", {}) {}
  class AnimationEndEvent
    extends Schema.TaggedClass<AnimationEndEvent>()("AnimationEndEvent", {})
  {}

  const states = defineStates({ Mounted, Exiting, Unmounted });
  const definition = make({
    id: "future-presence",
    states: states.states,
    events: [OpenEvent, CloseEvent, AnimationEndEvent],
    initial: () => states.initial.Mounted(new Mounted()),
  }).handle({
    Mounted: {
      on: {
        // The whole decision, in one branch: with motion, close parks in
        // `Exiting` and waits for the animation; without it, close unmounts now.
        CloseEvent: ({ target }: any) =>
          Effect.succeed(
            options.reducedMotion
              ? target.full.Unmounted(new Unmounted())
              : target.full.Exiting(new Exiting()),
          ),
      },
    },
    Exiting: {
      on: {
        AnimationEndEvent: ({ target }: any) =>
          Effect.succeed(target.full.Unmounted(new Unmounted())),
        // Re-opening mid-exit cancels the exit rather than unmounting late.
        OpenEvent: ({ target }: any) => Effect.succeed(target.full.Mounted(new Mounted())),
      },
    },
    Unmounted: {
      on: {
        OpenEvent: ({ target }: any) => Effect.succeed(target.full.Mounted(new Mounted())),
      },
    },
  });

  const scope = Scope.makeUnsafe();
  const machine: any = await Effect.runPromise(
    Effect.provideService(spawn(definition), Scope.Scope, scope) as any,
  );

  const settle = () => Effect.runPromise(Effect.sleep("30 millis"));
  return {
    machine,
    scope,
    settle,
    /** The rendered question: is the content in the tree at all? */
    isPresent: () => machine.matches("Mounted") || machine.matches("Exiting"),
    events: { OpenEvent, CloseEvent, AnimationEndEvent },
    close: () => Scope.close(scope, Exit.void),
  };
}

describe("presence: exit animations keep content mounted", () => {
  it("[K0b] close parks in Exiting with content still present until animationEnd", async () => {
    const p = await presenceMachine({ reducedMotion: false });
    const { OpenEvent, CloseEvent, AnimationEndEvent } = p.events;

    expect(p.machine.matches("Mounted")).toBe(true);
    expect(p.isPresent()).toBe(true);

    p.machine.send(new CloseEvent());
    await p.settle();

    // The guarantee: logically closed, physically still there. An
    // implementation that unmounts on close passes nothing below.
    expect(p.machine.matches("Exiting")).toBe(true);
    expect(p.machine.matches("Unmounted")).toBe(false);
    expect(p.isPresent()).toBe(true);

    // A second close while exiting is not a second exit.
    p.machine.send(new CloseEvent());
    await p.settle();
    expect(p.machine.matches("Exiting")).toBe(true);

    p.machine.send(new AnimationEndEvent());
    await p.settle();

    expect(p.machine.matches("Unmounted")).toBe(true);
    expect(p.isPresent()).toBe(false);

    // Reopening from Unmounted remounts, so the machine is reusable rather
    // than terminal.
    p.machine.send(new OpenEvent());
    await p.settle();
    expect(p.machine.matches("Mounted")).toBe(true);

    Effect.runSync(p.close());
  });

  it("[K0b] reopening mid-exit cancels the exit and no later animationEnd unmounts it", async () => {
    const p = await presenceMachine({ reducedMotion: false });
    const { OpenEvent, CloseEvent, AnimationEndEvent } = p.events;

    p.machine.send(new CloseEvent());
    await p.settle();
    p.machine.send(new OpenEvent());
    await p.settle();
    expect(p.machine.matches("Mounted")).toBe(true);

    // The stale `animationend` from the cancelled exit must not tear down
    // content the user just reopened — the bug every presence implementation
    // has had at least once.
    p.machine.send(new AnimationEndEvent());
    await p.settle();
    expect(p.machine.matches("Mounted")).toBe(true);
    expect(p.isPresent()).toBe(true);

    Effect.runSync(p.close());
  });

  it("[K0b] under reduced motion close unmounts immediately, skipping Exiting", async () => {
    const p = await presenceMachine({ reducedMotion: true });
    const { CloseEvent, AnimationEndEvent } = p.events;

    p.machine.send(new CloseEvent());
    await p.settle();

    // Skipped, not merely fast: `Exiting` is never entered, so nothing waits
    // for an animationEnd that a reduced-motion user will never produce.
    expect(p.machine.matches("Unmounted")).toBe(true);
    expect(p.machine.matches("Exiting")).toBe(false);
    expect(p.isPresent()).toBe(false);

    // And the never-arriving event is harmless if it does arrive.
    p.machine.send(new AnimationEndEvent());
    await p.settle();
    expect(p.machine.matches("Unmounted")).toBe(true);

    Effect.runSync(p.close());
  });

  it("[K0b] dispose aborts: a mid-exit presence machine stops and refuses further events", async () => {
    const p = await presenceMachine({ reducedMotion: false });
    const { CloseEvent, AnimationEndEvent } = p.events;

    p.machine.send(new CloseEvent());
    await p.settle();
    expect(p.machine.matches("Exiting")).toBe(true);

    // Unmounting the widget mid-exit closes the machine's scope. Read the state
    // BEFORE closing; asserting on post-close reads is the false-green trap in
    // `future/README.md`.
    Effect.runSync(p.close());
    Effect.runSync(p.close());

    const exit = await Effect.runPromiseExit(
      p.machine.sendEffect(new AnimationEndEvent()),
    );
    // Aborted, not silently completed: the exit animation's finisher cannot
    // resurrect or advance a disposed presence.
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("presence: catalog packaging", () => {
  it("[K0b] presence ships as a catalog behavior whose reduced-motion input is injected, not sniffed", async () => {
    // The semantics above are decided and (per the specs) expressible today.
    // What is NOT decided, and must not be pinned by an executable spec:
    //
    //   1. Where reduced motion enters. The research doc says "force unmount on
    //      reduced motion" without choosing between a `PresenceOptions` Schema
    //      field and a `ReducedMotion` service provided per subtree. The plan's
    //      services-not-globals house rule points at the service (and the a11y
    //      matrix — mandated coverage item 9 — wants reduced motion as a
    //      *testable dimension*, which a global media-query read is not), but
    //      no such service exists in `src/`.
    //   2. The behaviour's element contract and published bindings: which slot
    //      the `animationend` listener attaches to, and whether consumers read
    //      `isPresent` / `phase` / the raw machine handle.
    //
    // Both are K0b catalog-convention decisions; `src/behaviors/presence.ts`
    // does not exist yet.
    unbuilt(
      "behaviors/presence as a Schema-option catalog behavior, plus the injected ReducedMotion service its a11y-matrix row needs",
      "DQ-071",
    );
  });
});
