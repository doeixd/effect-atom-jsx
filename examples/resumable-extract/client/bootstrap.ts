import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import * as Resume from "effect-atom-jsx/Resume";
import * as Serialization from "effect-atom-jsx/Serialization";
import { resolverEntries } from "virtual:af-resume-entries";
import { browserState } from "../shared/browser-state.js";
import { BuildId } from "../shared/build.js";
import { NoteService } from "../shared/note-service.js";
import { installEagerBaseline } from "./eager-baseline.js";

const state = browserState();
if (state === undefined) {
  throw new Error("The resumable-extract browser state was not initialized.");
}

const manifestElement = document.querySelector<HTMLScriptElement>(
  "script[data-af-resume]",
);
if (manifestElement === null) {
  throw new Error("The resume manifest script is missing.");
}

const manifest = await Effect.runPromise(
  Resume.decodeManifest(
    manifestElement.textContent ?? "",
    BuildId,
  ).pipe(Effect.provide(Serialization.layer)),
);
const runtime = ManagedRuntime.make(
  Layer.succeed(NoteService, {
    record: (note) =>
      Effect.sync(() => {
        state.notes.push(note);
      }),
  }),
);
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
const disposeEagerBaseline = installEagerBaseline();

window.__EXTRACT_WRITE__ = (count) =>
  Effect.runPromise(
    installation.writeBinding("c0", "count", Schema.Number, count),
  );
window.__EXTRACT_DISPOSE__ = async () => {
  disposeEagerBaseline();
  await Effect.runPromise(installation.dispose);
  await runtime.dispose();
  state.disposed = true;
};
state.ready = true;
