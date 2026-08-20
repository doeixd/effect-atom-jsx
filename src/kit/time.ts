/**
 * Kit time services (K3, `DQ-066`(b)): the injected `Clock`/`Locale`
 * services, shipped WITH the kit's first time-holding widget — a service
 * earns its place when a consumer holds state across async boundaries,
 * which is exactly what a relative-time display does and a 50ms press
 * window does not.
 *
 * "Anything two widgets share, and anything a test must control, is a
 * `Context.Service` provided by a `Layer` — never a module global."
 * Deterministic tests provide `clockLayer`/`localeLayer` wholesale via
 * `Component.withLayer`; production uses the live defaults.
 */
import { Context, Effect, Layer } from "effect";
import * as A11y from "../A11y.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as View from "../View.js";

// ─── Services ────────────────────────────────────────────────────────────────

export interface ClockService {
  readonly now: () => number;
}

export const Clock = Context.Service<ClockService>("affe/kit/Clock");

export interface LocaleService {
  readonly locale: string;
}

export const Locale = Context.Service<LocaleService>("affe/kit/Locale");

/** Wall-clock live layer — the production default. */
export const clockLive: Layer.Layer<ClockService> = Layer.succeed(Clock, {
  now: () => Date.now(),
});

/** Fixed-instant layer for deterministic tests. */
export function clockLayer(now: () => number): Layer.Layer<ClockService> {
  return Layer.succeed(Clock, { now });
}

/** System locale live layer. */
export const localeLive: Layer.Layer<LocaleService> = Layer.succeed(Locale, {
  locale: typeof Intl !== "undefined"
    ? new Intl.DateTimeFormat().resolvedOptions().locale
    : "en",
});

export function localeLayer(locale: string): Layer.Layer<LocaleService> {
  return Layer.succeed(Locale, { locale });
}

// ─── The time-holding widget ─────────────────────────────────────────────────

export const RelativeTimeAnatomy = View.Slots.define({
  root: { capability: Element.Capability.Container },
});

export const relativeTimePattern = A11y.pattern("relative-time", RelativeTimeAnatomy);

export interface RelativeTimeProps {
  /** The instant being described, in epoch milliseconds. */
  readonly at: number;
}

const divisions: ReadonlyArray<readonly [number, Intl.RelativeTimeFormatUnit]> = [
  [60_000, "second"],
  [3_600_000, "minute"],
  [86_400_000, "hour"],
  [2_592_000_000, "day"],
  [31_536_000_000, "month"],
  [Number.POSITIVE_INFINITY, "year"],
];

/** Pure formatting core — exported so hosts can reuse it without the widget. */
export function formatRelative(at: number, now: number, locale: string): string {
  const delta = at - now;
  const magnitude = Math.abs(delta);
  let unitMs = 1000;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  for (const [ceiling, ceilingUnit] of divisions) {
    if (magnitude < ceiling) {
      unit = ceilingUnit;
      break;
    }
    unitMs = ceiling;
  }
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return formatter.format(Math.trunc(delta / unitMs), unit);
}

/**
 * The kit's first time-holding widget: renders "3 minutes ago"-style text.
 * Time and locale arrive as SERVICES, so a test provides fixed layers and
 * the widget is deterministic — no fake global time, no sleeping.
 */
export const RelativeTime = Component.make(
  Component.props<RelativeTimeProps>(),
  Component.require<ClockService | LocaleService>(),
  Component.setup<RelativeTimeProps>().bind("label", ({ props }) =>
    Effect.gen(function* () {
      const clock = yield* Clock;
      const { locale } = yield* Locale;
      return formatRelative(props.at, clock.now(), locale);
    })),
  (_props, bindings) => View.fromSlots(RelativeTimeAnatomy, bindings.label),
).pipe(Component.withSlots(RelativeTimeAnatomy));
