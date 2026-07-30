/**
 * Shared fixtures for the `future/streaming/` specs.
 *
 * `effect` itself is a real dependency, so it is imported at module scope.
 * Everything from `src/` is loaded lazily through the harness, so a missing
 * module fails one spec instead of a whole file.
 */

import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { loadSrc } from "../harness.js";

export const StreamBuildId = "future-streaming-build";

/** Load a `src/` module as an untyped namespace (see harness rationale). */
export async function srcModule(path: string): Promise<any> {
  return (await loadSrc(path)) as any;
}

export interface ResumeKit {
  readonly Portable: any;
  readonly Resume: any;
  readonly Serialization: any;
  readonly dom: any;
}

export async function resumeKit(): Promise<ResumeKit> {
  const [Portable, Resume, Serialization, dom] = await Promise.all([
    srcModule("Portable"),
    srcModule("Resume"),
    srcModule("Serialization"),
    srcModule("dom"),
  ]);
  return { Portable, Resume, Serialization, dom };
}

/** A service whose single method records the labels it is called with. */
export interface Sink {
  readonly calls: string[];
  readonly layer: Layer.Layer<any>;
  readonly service: any;
}

export async function makeSink(name = "future/streaming/Sink"): Promise<Sink> {
  const { Context } = await import("effect");
  const calls: string[] = [];
  const Tag = (Context as any).Service(name);
  const layer = Layer.succeed(Tag, {
    record: (label: string) =>
      Effect.sync(() => {
        calls.push(label);
      }),
  });
  return { calls, layer, service: Tag };
}

/**
 * A portable code whose run records its captured `label` through `sink`.
 * The same identity is used on both sides of the boundary, which is what makes
 * "resolved exactly once" and "dispatched exactly once" assertable.
 */
export async function recordingCode(
  Portable: any,
  sink: Sink,
  id: string,
  buildId = StreamBuildId,
): Promise<any> {
  return Portable.code({
    id,
    buildId,
    captures: Schema.Struct({ label: Schema.String }),
    run: (captures: { readonly label: string }) =>
      Effect.gen(function* () {
        const service = yield* sink.service;
        yield* service.record(captures.label);
      }),
  });
}

/** A `ManagedRuntime` over one or more layers, for `installClient`. */
export function runtimeFor(...layers: ReadonlyArray<Layer.Layer<any>>) {
  const merged = layers.length === 0
    ? Layer.empty
    : layers.reduce((left, right) => Layer.merge(left, right) as Layer.Layer<any>);
  return ManagedRuntime.make(merged as unknown as Layer.Layer<any, any>);
}

/**
 * Build the server-side `Component.action` for a recording code, with a server
 * stub that dies: the action must only ever execute on the client.
 */
export async function portableAction(
  sink: Sink,
  code: any,
  label: string,
): Promise<any> {
  const Component = await srcModule("Component");
  return Effect.runSync(
    Component.action((await srcModule("Portable")).bind(code, { label })).pipe(
      Effect.provideService(sink.service, {
        record: () => Effect.die("server must not run a resumable action"),
      }),
    ),
  );
}

/** A `<button>` carrying a resume event handler, in the current render doc. */
export function resumeButton(dom: any, Resume: any, action: any, text = "Go"): any {
  const button = dom.template(`<button>${text}`)();
  dom.addEventListener(button, "click", Resume.event(action), true);
  return button;
}

/** Wall-clock ordering probe: records `label` with a monotonic sequence number. */
export function makeTimeline() {
  const entries: Array<{ readonly label: string; readonly at: number }> = [];
  let sequence = 0;
  return {
    entries,
    mark: (label: string): void => {
      entries.push({ label, at: sequence++ });
    },
    labels: (): string[] => entries.map((entry) => entry.label),
    indexOf: (label: string): number =>
      entries.findIndex((entry) => entry.label === label),
    has: (label: string): boolean => entries.some((entry) => entry.label === label),
  };
}
