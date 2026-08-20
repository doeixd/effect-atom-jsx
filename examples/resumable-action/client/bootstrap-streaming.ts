/**
 * Client side of the streaming + fragment proof (`streaming.html`).
 *
 * Installs the streamed area from its M11.5 record scripts through
 * `Resume.installClientStreamed`, installs the static host area through the
 * ordinary `Resume.installClient`, then mounts the out-of-band fragment into
 * the host's `slot` region with `Resume.mountFragment` — the M11b static
 * door.
 */
import { Effect, Layer, ManagedRuntime } from "effect";
import * as Resume from "effect-atom-jsx/Resume";
import * as Serialization from "effect-atom-jsx/Serialization";
import { CodeManifest } from "./code-manifest.js";
import { BuildId } from "../shared/build.js";
import { SaveService } from "../shared/save-service.js";
import { streamingBrowserState } from "../shared/stream-state.js";

const state = streamingBrowserState();
if (state === undefined) {
  throw new Error("The streaming browser state was not initialized.");
}

const runtime = ManagedRuntime.make(
  Layer.succeed(SaveService, {
    save: (label) =>
      Effect.sync(() => {
        state.saves.push(label);
      }),
  }),
);
const onDiagnostic = (diagnostic: Resume.ClientDiagnostic): void => {
  state.diagnostics.push(diagnostic);
};

// ── Streamed area: install from the M11.5 record scripts. ────────────────────
const recordScripts = [
  ...document.querySelectorAll<HTMLScriptElement>(
    "script[data-af-resume][data-af-stream]",
  ),
];
if (recordScripts.length < 2) {
  throw new Error("Expected streamed manifest records plus a terminal record.");
}
const records = recordScripts.map((script) =>
  JSON.parse(script.textContent ?? "null") as unknown
);
const streamedInstallation = await Effect.runPromise(
  Resume.installClientStreamed({
    root: document.querySelector("#stream-root") ?? document,
    records,
    expectedBuildId: BuildId,
    resolverEntries: CodeManifest,
    runtime,
    onDiagnostic,
  }),
);

// ── Static host area: ordinary install, then mount the fragment. ─────────────
const hostRoot = document.querySelector<HTMLElement>("#frag-root");
if (hostRoot === null) throw new Error("The fragment host root is missing.");
const hostManifestScript = hostRoot.querySelector<HTMLScriptElement>(
  "script[data-af-resume]:not([data-af-stream])",
);
if (hostManifestScript === null) {
  throw new Error("The host manifest script is missing.");
}
const hostManifest = await Effect.runPromise(
  Resume.decodeManifest(hostManifestScript.textContent ?? "", BuildId).pipe(
    Effect.provide(Serialization.layer),
  ),
);
const hostInstallation = await Effect.runPromise(
  Resume.installClient({
    root: hostRoot,
    manifest: hostManifest,
    expectedBuildId: BuildId,
    resolverEntries: CodeManifest,
    runtime,
    onDiagnostic,
  }),
);

const payloadScript = document.querySelector<HTMLScriptElement>(
  "#fragment-payload",
);
if (payloadScript === null) throw new Error("The fragment payload is missing.");
const payload = JSON.parse(payloadScript.textContent ?? "null") as {
  readonly html: string;
  readonly manifest: unknown;
};

let fragment = await Effect.runPromise(
  Resume.mountFragment(hostInstallation, "slot", payload),
);

window.__STREAM_REMOUNT__ = async () => {
  const previous = fragment;
  fragment = await Effect.runPromise(
    Resume.mountFragment(hostInstallation, "slot", payload),
  );
  state.firstFragmentDisposed = previous.disposed();
};
window.__STREAM_END__ = async () => {
  await Effect.runPromise(fragment.dispose);
  await Effect.runPromise(hostInstallation.dispose);
  await Effect.runPromise(streamedInstallation.dispose);
  await runtime.dispose();
};

state.ready = true;
