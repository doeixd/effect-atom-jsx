import { Effect } from "effect";
import type * as Portable from "effect-atom-jsx/Portable";
import { browserState } from "../shared/browser-state.js";
import {
  SaveButtonActivationCodeId,
  SaveCodeId,
} from "../shared/build.js";

export const CodeManifest: Portable.ResolverEntries = {
  [SaveCodeId]: () =>
    Effect.tryPromise(async () => {
      const state = browserState();
      if (state !== undefined) state.loaderCalls += 1;
      const module = await import("../actions/save-action.js");
      return module.SaveCode;
    }),
  [SaveButtonActivationCodeId]: () =>
    Effect.tryPromise(async () => {
      const state = browserState();
      if (state !== undefined) state.componentLoaderCalls += 1;
      const module = await import("../server/save-button.js");
      return module.SaveButtonActivation;
    }),
};
