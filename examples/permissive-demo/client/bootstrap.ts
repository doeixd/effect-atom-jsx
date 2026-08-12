import { Effect, ManagedRuntime } from "effect";
import * as Resume from "effect-atom-jsx/Resume";
import { permissiveClient } from "@affe/permissive/client";
import { resolverEntries } from "virtual:af-resume-entries";
import { browserState } from "../shared/browser-state.js";
import { BuildId } from "../shared/build.js";

const state = browserState();
if (state === undefined) {
  throw new Error("The permissive-demo browser state was not initialized.");
}

const manifestElement = document.querySelector<HTMLScriptElement>(
  "script[data-af-resume]",
);
if (manifestElement === null) {
  throw new Error("The resume manifest script is missing.");
}

// The client half of the preset: the codec layer matching the manifest's
// serializer stamp. Without it, the Map capture would fail closed.
const client = permissiveClient();

const manifest = await Effect.runPromise(
  Resume.decodeManifest(
    manifestElement.textContent ?? "",
    BuildId,
  ).pipe(Effect.provide(client.layer)),
);
state.serializerId = manifest.serializer ?? "(unstamped)";

// The pinned operational rule: the codec layer rides in the CLIENT RUNTIME —
// that is where capture envelopes decode when a handler dispatches.
const runtime = ManagedRuntime.make(client.layer);
const trackedResolverEntries = Object.fromEntries(
  Object.entries(resolverEntries).map(([id, entry]) => [
    id,
    typeof entry !== "function"
      ? entry
      : () =>
        Effect.sync(() => {
          state.loaderCalls += 1;
        }).pipe(Effect.andThen(entry())),
  ]),
);
const installation = await Effect.runPromise(
  Resume.installClient({
    root: document,
    manifest,
    expectedBuildId: BuildId,
    resolverEntries: trackedResolverEntries,
    runtime,
    onDiagnostic: (diagnostic) => state.diagnostics.push(diagnostic),
  }),
);

window.__PERMISSIVE_DISPOSE__ = async () => {
  await Effect.runPromise(installation.dispose);
  await runtime.dispose();
  state.disposed = true;
};
state.ready = true;
