import { Effect, Schema } from "effect";
import * as Portable from "effect-atom-jsx/Portable";
import { browserState } from "../shared/browser-state.js";
import { BuildId, SaveCodeId } from "../shared/build.js";
import { SaveService } from "../shared/save-service.js";

const state = browserState();
if (state !== undefined) {
  state.actionImports += 1;
}

export const SaveCode = Portable.code<
  { readonly label: string },
  { readonly label: string },
  readonly [],
  void,
  never,
  SaveService
>({
  id: SaveCodeId,
  buildId: BuildId,
  captures: Schema.Struct({
    label: Schema.String,
  }),
  run: (captures) =>
    Effect.gen(function* () {
      const saves = yield* SaveService;
      yield* saves.save(captures.label);
    }),
});
