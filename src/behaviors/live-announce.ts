/**
 * Live announce — screen-reader announcements for non-focused updates
 * (`DQ-072`, ratified: one `announce(message, politeness?)` method;
 * clear-after-timeout is the LAYER's policy).
 *
 * `LiveAnnouncer` is a Context service — one region pair per document is the
 * DOM adapter's concern; the service itself is renderer-neutral state a mock
 * Layer captures with NO DOM. Tests swap the whole service wholesale.
 *
 * @see docs/kit-research/behaviors/live-announce.md
 */
import { Context, Effect, Layer, Schema } from "effect";
import * as Behavior from "../Behavior.js";

export type Politeness = "polite" | "assertive";

export interface LiveAnnouncerService {
  /** Announce a message; default politeness is "polite". */
  readonly announce: (
    message: string,
    politeness?: Politeness,
  ) => Effect.Effect<void>;
  /** The currently rendered message per politeness (what a region shows). */
  readonly current: (politeness: Politeness) => string | undefined;
}

export interface LiveAnnouncerOptions {
  /**
   * Clear a rendered message this many milliseconds after it was announced
   * (the ratified policy home). `undefined` disables auto-clear.
   */
  readonly clearAfterMs?: number;
  /** Sink invoked on every announcement (the DOM adapter's region writer). */
  readonly onAnnounce?: (message: string, politeness: Politeness) => void;
}

/** Construct an isolated announcer (one per Layer provision). */
export function makeLiveAnnouncer(
  options: LiveAnnouncerOptions = {},
): LiveAnnouncerService {
  const current = new Map<Politeness, string>();
  const timers = new Map<Politeness, ReturnType<typeof setTimeout>>();
  return {
    announce: (message, politeness = "polite") =>
      Effect.sync(() => {
        current.set(politeness, message);
        options.onAnnounce?.(message, politeness);
        const pending = timers.get(politeness);
        if (pending !== undefined) clearTimeout(pending);
        if (options.clearAfterMs !== undefined) {
          timers.set(
            politeness,
            setTimeout(() => {
              // Only clear the message this timer announced; a newer
              // announcement replaced the timer above.
              current.delete(politeness);
              timers.delete(politeness);
            }, options.clearAfterMs),
          );
        }
      }),
    current: (politeness) => current.get(politeness),
  };
}

const LiveAnnouncerTag = Context.Service<LiveAnnouncerService>(
  "effect-atom-jsx/behaviors/LiveAnnouncer",
);

/**
 * The service tag, with a default `layer` (no auto-clear, no sink) and
 * `layerOf(options)` for adapters and tests.
 */
export const LiveAnnouncer = Object.assign(LiveAnnouncerTag, {
  layer: Layer.sync(LiveAnnouncerTag, () => makeLiveAnnouncer()),
  layerOf: (options: LiveAnnouncerOptions) =>
    Layer.sync(LiveAnnouncerTag, () => makeLiveAnnouncer(options)),
});

export const LiveAnnounceOptions = Schema.Struct({
  /** Default politeness for this attachment's `announce` binding. */
  politeness: Schema.Literals(["polite", "assertive"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("polite" as const)),
  ),
});

export type LiveAnnounceOptions = typeof LiveAnnounceOptions.Type;

/** Caller-facing config: every Schema knob optional (defaults decode in). */
export type LiveAnnounceConfig = typeof LiveAnnounceOptions.Encoded;

export type LiveAnnounceBindings = {
  /** Announce through the subtree's LiveAnnouncer service. */
  readonly announce: (message: string, politeness?: Politeness) => void;
};

/**
 * Give a component an `announce` binding wired to the subtree's
 * `LiveAnnouncer` service. Requires the service in `R` — provision is
 * per-subtree (`Component.withLayer`), never a module global.
 *
 * Options decode against `LiveAnnounceOptions` at attach time: defaults come
 * from the Schema, and a malformed config fails the attach Effect with a
 * typed `Behavior.BehaviorOptionsError` — the factory itself never throws.
 */
export const liveAnnounce = (config: LiveAnnounceConfig = {}) =>
  Behavior.make<
    {},
    LiveAnnounceBindings,
    LiveAnnouncerService,
    Behavior.BehaviorOptionsError
  >(() =>
    Effect.gen(function* () {
      const options = yield* Behavior.decodeOptions(
        "liveAnnounce",
        LiveAnnounceOptions,
        config,
      );
      const announcer = yield* LiveAnnouncer;
      return {
        announce: (message, politeness) =>
          Effect.runSync(
            announcer.announce(message, politeness ?? options.politeness),
          ),
      } satisfies LiveAnnounceBindings;
    })
  ).pipe(
    Behavior.provides({
      announce: Behavior.binding<
        "announce",
        (message: string, politeness?: Politeness) => void
      >("announce"),
    }),
  );
