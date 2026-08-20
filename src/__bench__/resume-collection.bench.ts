import { bench, describe } from "vitest";
import { Effect, Schema } from "effect";
import * as Component from "../Component.js";
import {
  addEventListener,
  renderToString,
  template,
  type RuntimeEventHandler,
} from "../dom.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";

/**
 * Milestone 9 item 6 — the two server-side benchmarks the plan names:
 *
 * - **No-instrumentation overhead**: a server render with no `Resume.collect`
 *   scope. Portable-event authoring must cost nothing extra when the
 *   application never asks for a manifest.
 * - **Collection cost**: the same render inside `Resume.collect`, which
 *   observes every rendered handler, encodes descriptors, and assembles the
 *   manifest.
 *
 * Characterization benchmarks (`npm run bench`), not asserted thresholds — the
 * client-side dormant-vs-eager protocol is gated separately by
 * `benchmarks/resumability/` in real Chromium.
 */

const BuildId = "resume-bench-build";

const SaveCode = Portable.code({
  id: "bench.resume.save",
  buildId: BuildId,
  captures: Schema.Struct({
    label: Schema.String,
  }),
  run: (_captures) => Effect.void,
});

const plainHandler: RuntimeEventHandler = () => {};

function renderPage(count: number, handlerAt: (index: number) => RuntimeEventHandler): string {
  return renderToString(() => {
    const root = template("<div>")();
    for (let index = 0; index < count; index += 1) {
      const button = template("<button>Save")();
      addEventListener(button, "click", handlerAt(index), true);
      root.appendChild(button);
    }
    return root;
  });
}

// Bound actions are created once so the benchmarks measure render/collect
// cost, not per-sample action allocation.
const resumableHandlers = Array.from({ length: 24 }, (_, index) =>
  Resume.event(
    Effect.runSync(
      Component.action(Portable.bind(SaveCode, { label: `save-${index}` })),
    ),
  ));

function collectPage(count: number): void {
  Effect.runSync(
    Resume.collect(
      () => renderPage(count, (index) => resumableHandlers[index]!),
      { buildId: BuildId, installationId: "bench0" },
    ).pipe(Effect.provide(Serialization.layer)),
  );
}

describe("no-instrumentation server render (no Resume.collect scope)", () => {
  bench("24 plain handlers", () => {
    renderPage(24, () => plainHandler);
  });

  bench("24 portable Resume.event handlers, collection off", () => {
    renderPage(24, (index) => resumableHandlers[index]!);
  });
});

describe("collection cost (Resume.collect around the same render)", () => {
  bench("collect 1 portable event", () => {
    collectPage(1);
  });

  bench("collect 24 portable events", () => {
    collectPage(24);
  });
});
