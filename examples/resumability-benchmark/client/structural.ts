/**
 * Client entry for the structural-rows lane (Milestone 8d item 6).
 *
 * Identical to `resume.ts` except the resolver also carries the hand-authored
 * structural expression — it is not compiler-extracted, so the virtual entry
 * module does not know it.
 */
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import * as Resume from "effect-atom-jsx/Resume";
import * as Serialization from "effect-atom-jsx/Serialization";
import { resolverEntries } from "virtual:af-resume-entries";
import { StructuralRowsExpression } from "../app/benchmark.js";
import { browserState } from "../shared/browser-state.js";
import { BuildId } from "../shared/build.js";

const state = browserState();
if (state === undefined) {
  throw new Error("The resumability benchmark state was not initialized.");
}

const root = document.querySelector<HTMLElement>("#root");
const manifestElement = document.querySelector<HTMLScriptElement>(
  "script[data-af-resume]",
);
if (root === null || manifestElement === null) {
  throw new Error("The resumability benchmark document is incomplete.");
}

const observer = new MutationObserver((records) => {
  if (!state.ready || state.disposed) return;
  state.patches += records.length;
  state.lastPatchAt = performance.now();
});
const serverNode = root.firstElementChild;
observer.observe(root, {
  characterData: true,
  childList: true,
  subtree: true,
});

const manifest = await Effect.runPromise(
  Resume.decodeManifest(
    manifestElement.textContent ?? "",
    BuildId,
  ).pipe(Effect.provide(Serialization.layer)),
);
const runtime = ManagedRuntime.make(Layer.empty);
const installation = await Effect.runPromise(
  Resume.installClient({
    root: document,
    manifest,
    expectedBuildId: BuildId,
    resolverEntries: {
      ...resolverEntries,
      [StructuralRowsExpression.id]: StructuralRowsExpression,
    },
    runtime,
    onDiagnostic: (diagnostic) => state.diagnostics.push(diagnostic),
  }),
);
state.startupNodeReused = root.firstElementChild === serverNode;

window.__AF_BENCHMARK_WRITE_SHARED__ = (value) =>
  Effect.runPromise(
    installation.writeBinding("c0", "shared", Schema.Number, value),
  );
window.__AF_BENCHMARK_INSPECT__ = () => {
  const inspection = installation.inspect();
  return {
    boundaryControllers: inspection.boundaryControllers,
    expressionControllers: inspection.expressionControllers,
    expressionDependencyKeys: inspection.expressionDependencyKeys,
    expressionSubscriptions: inspection.expressionSubscriptions,
    pendingFibers: inspection.pendingFibers,
  };
};
window.__AF_BENCHMARK_DISPOSE__ = async () => {
  if (state.disposed) return;
  await Effect.runPromise(installation.dispose);
  await runtime.dispose();
  observer.disconnect();
  state.disposed = true;
};

state.readyAt = performance.now();
state.ready = true;
