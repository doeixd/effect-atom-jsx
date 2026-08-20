/**
 * Server side of the streaming + fragment proof (`streaming.html`).
 *
 * Three artifacts, all real:
 *  - a streamed document (out-of-order `renderToStream`): a resumable shell
 *    button, a slow region swapped in by the nonce-carrying inline script,
 *    and the M11.5 record scripts (per-region + terminal);
 *  - a statically collected host area (`Resume.collect`) with its own page
 *    button, for the fragment proof to install into;
 *  - a fragment (`Resume.collect`) serialized as JSON for the client to
 *    `Resume.mountFragment` into the host's `slot` region.
 */
import { Effect, Stream } from "effect";
import * as Component from "effect-atom-jsx/Component";
import * as Portable from "effect-atom-jsx/Portable";
import * as Resume from "effect-atom-jsx/Resume";
import * as Serialization from "effect-atom-jsx/Serialization";
import { addEventListener, template } from "effect-atom-jsx/runtime";
import { renderToStream, renderToString } from "effect-atom-jsx";
import { SaveCode } from "../actions/save-action.js";
import { BuildId } from "../shared/build.js";
import { SaveService } from "../shared/save-service.js";

function saveButton(testId: string, label: string, text: string): Element {
  const action = Effect.runSync(
    Component.action(Portable.bind(SaveCode, { label })).pipe(
      Effect.provideService(SaveService, {
        save: () => Effect.die("The server action must never execute."),
      }),
    ),
  );
  const button = template(
    `<button type="button" data-testid="${testId}">${text}`,
  )();
  addEventListener(button, "click", Resume.event(action), true);
  return button;
}

export interface StreamingPageArtifacts {
  readonly streamedHtml: string;
  readonly hostHtml: string;
  readonly hostManifestScript: string;
  readonly fragmentJson: string;
}

export async function renderStreamingPage(): Promise<StreamingPageArtifacts> {
  const SlowRegion = Component.from<{}>(() =>
    Effect.succeed("streamed-region-content").pipe(Effect.delay("30 millis"))
  );
  const streamedHtml = await Effect.runPromise(
    Stream.runFold(
      renderToStream(
        () => [
          saveButton("stream-save", "stream-save", "Streamed save"),
          Component.renderEffect(SlowRegion, {}),
        ],
        { mode: "out-of-order", buildId: BuildId, nonce: "stream-proof" },
      ),
      () => "",
      (accumulator, chunk) => accumulator + chunk,
    ) as Effect.Effect<string, never>,
  );

  const host = await Effect.runPromise(
    Resume.collect(
      () => renderToString(() => saveButton("page-save", "page-save", "Page save")),
      { buildId: BuildId, installationId: "page0" },
    ).pipe(Effect.provide(Serialization.layer)),
  );

  const fragment = await Effect.runPromise(
    Resume.collect(
      () =>
        renderToString(() =>
          saveButton("fragment-save", "fragment-save", "Fragment save")
        ),
      { buildId: BuildId },
    ).pipe(Effect.provide(Serialization.layer)),
  );

  const fragmentJson = JSON.stringify({
    html: fragment.html,
    manifest: fragment.manifest,
  })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return {
    streamedHtml,
    hostHtml: host.html,
    hostManifestScript: host.script,
    fragmentJson,
  };
}
