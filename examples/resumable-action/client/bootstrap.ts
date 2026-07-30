import { Effect, Layer, ManagedRuntime } from "effect";
import * as Resume from "effect-atom-jsx/Resume";
import * as Serialization from "effect-atom-jsx/Serialization";
import { CodeManifest } from "./code-manifest.js";
import { browserState } from "../shared/browser-state.js";
import { BuildId } from "../shared/build.js";
import { SaveService } from "../shared/save-service.js";

const state = browserState();
if (state === undefined) {
  throw new Error("The resumable-action browser state was not initialized.");
}

const manifestElement = document.querySelector<HTMLScriptElement>(
  "script[data-af-resume]",
);
if (manifestElement === null) {
  throw new Error("The resume manifest script is missing.");
}
if (document.querySelectorAll("script[data-af-resume]").length !== 1) {
  throw new Error("Expected exactly one resume manifest script.");
}

const manifest = await Effect.runPromise(
  Resume.decodeManifest(
    manifestElement.textContent ?? "",
    BuildId,
  ).pipe(Effect.provide(Serialization.layer)),
);
const runtime = ManagedRuntime.make(
  Layer.succeed(SaveService, {
    save: (label) =>
      Effect.sync(() => {
        state.saves.push(label);
      }),
  }),
);
const installation = await Effect.runPromise(
  Resume.installClient({
    root: document,
    manifest,
    expectedBuildId: BuildId,
    resolverEntries: CodeManifest,
    runtime,
    onDiagnostic: (diagnostic) => state.diagnostics.push(diagnostic),
  }),
);

window.__RESUME_ACTIVATE__ = (componentId = "c0") =>
  Effect.runPromise(installation.activate(componentId));
window.__RESUME_RESUME__ = (componentId = "c0") =>
  Effect.runPromise(installation.resume(componentId));
window.__RESUME_BOUNDARY_STATE__ = (componentId = "c0") =>
  installation.boundaryState(componentId);
window.__RESUME_DISPOSE__ = async () => {
  await Effect.runPromise(installation.dispose);
  await runtime.dispose();
  state.disposed = true;
};
state.ready = true;
