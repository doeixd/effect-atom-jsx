import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import * as Portable from "effect-atom-jsx/Portable";
import * as Resume from "effect-atom-jsx/Resume";
import * as Serialization from "effect-atom-jsx/Serialization";
import { resolverEntries } from "virtual:af-resume-entries";
import type {
  AttributionBrowserState,
  AttributionStage,
} from "../shared/attribution-state.js";
import { BuildId } from "../shared/build.js";

const state: AttributionBrowserState = window.__AF_ATTRIBUTION__;
const stages: ReadonlySet<AttributionStage> = new Set([
  "modules",
  "runtime",
  "serialization",
  "json",
  "guard",
  "schema",
  "manifest",
  "runtime-manifest",
  "resolver",
  "scans",
  "installed",
]);
if (!stages.has(state.stage)) {
  throw new Error(`Unknown attribution stage: ${String(state.stage)}`);
}
const manifestElement = document.querySelector<HTMLScriptElement>(
  "script[data-af-resume]",
);
if (manifestElement === null) {
  throw new Error("The attribution manifest is missing.");
}
const serializedManifest = manifestElement.textContent ?? "";

let runtime:
  | ManagedRuntime.ManagedRuntime<never, never>
  | undefined;
let manifest: Resume.Manifest | undefined;
let resolver: Portable.ResolverService | undefined;
let serialization:
  | Serialization.SerializationService
  | undefined;
let json: unknown;
let boundaries:
  | ReadonlyMap<Resume.ComponentId, Resume.ComponentBoundary>
  | undefined;
let expressions:
  | ReadonlyMap<Resume.ExpressionId, Resume.ExpressionBoundary>
  | undefined;
let installation: Resume.ClientInstallation | undefined;

const requireRuntime = (): ManagedRuntime.ManagedRuntime<never, never> => {
  runtime ??= ManagedRuntime.make(Layer.empty);
  return runtime;
};
const requireManifest = async (): Promise<Resume.Manifest> => {
  manifest ??= await Effect.runPromise(
    Resume.decodeManifest(serializedManifest, BuildId).pipe(
      Effect.provide(Serialization.layer),
    ),
  );
  return manifest;
};
const requireJson = (): unknown => {
  json ??= JSON.parse(serializedManifest);
  return json;
};

const applyStage = async (stage: AttributionStage): Promise<void> => {
  switch (stage) {
    case "modules":
      break;
    case "runtime":
      requireRuntime();
      break;
    case "serialization":
      serialization = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* Serialization.Tag;
        }).pipe(Effect.provide(Serialization.layer)),
      );
      break;
    case "json":
      requireJson();
      break;
    case "guard":
      {
        const value = requireJson();
        if (!Schema.is(Resume.ManifestSchema)(value)) {
          throw new Error(
            "The attribution manifest failed its type-side schema guard.",
          );
        }
        manifest = value;
      }
      break;
    case "schema":
      manifest = await Effect.runPromise(
        Schema.decodeUnknownEffect(Resume.ManifestSchema)(requireJson()),
      );
      break;
    case "manifest":
      await requireManifest();
      break;
    case "runtime-manifest":
      requireRuntime();
      await requireManifest();
      break;
    case "resolver":
      resolver = await Effect.runPromise(
        Portable.makeResolver(resolverEntries),
      );
      break;
    case "scans":
      {
        const decoded = await requireManifest();
        [boundaries, expressions] = await Effect.runPromise(
          Effect.all([
            Resume.scanComponentBoundaries(document, decoded),
            Resume.scanExpressionBoundaries(document, decoded),
          ]),
        );
        state.boundaryCount = boundaries.size;
        state.expressionCount = expressions.size;
      }
      break;
    case "installed":
      {
        const activeRuntime = requireRuntime();
        const decoded = await requireManifest();
        installation = await Effect.runPromise(
          Resume.installClient({
            root: document,
            manifest: decoded,
            expectedBuildId: BuildId,
            resolverEntries,
            runtime: activeRuntime,
            onDiagnostic: (diagnostic) => state.diagnostics.push(diagnostic),
          }),
        );
        state.installation = installation.inspect();
      }
      break;
  }
};

window.__AF_ATTRIBUTION_DISPOSE__ = async () => {
  if (state.disposed) return;
  if (installation !== undefined) {
    await Effect.runPromise(installation.dispose);
    state.afterDispose = installation.inspect();
  }
  await runtime?.dispose();
  installation = undefined;
  expressions = undefined;
  boundaries = undefined;
  resolver = undefined;
  json = undefined;
  serialization = undefined;
  manifest = undefined;
  runtime = undefined;
  state.disposed = true;
};

await applyStage(state.stage);
state.readyAt = performance.now();
state.ready = true;
