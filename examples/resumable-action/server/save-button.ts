import { Effect, Exit, Schema, Scope } from "effect";
import * as Component from "effect-atom-jsx/Component";
import * as Resume from "effect-atom-jsx/Resume";
import * as Serialization from "effect-atom-jsx/Serialization";
import {
  addEventListener,
  delegateEvents,
  template,
} from "effect-atom-jsx/runtime";
import { renderToString } from "effect-atom-jsx";
import { SaveCode } from "../actions/save-action.js";
import { browserState } from "../shared/browser-state.js";
import { BuildId, SaveButtonActivationCodeId } from "../shared/build.js";
import { SaveService } from "../shared/save-service.js";
import * as Portable from "effect-atom-jsx/Portable";

const state = browserState();
if (state !== undefined) {
  state.componentImports += 1;
  delegateEvents(["click"]);
}

const buttonTemplate = template(
  '<button type="button" data-testid="resumable-save">Save',
);
const activationButtonTemplate = template(
  '<button type="button" data-testid="activation-save">Activate and save',
);

const SaveButtonProps = Schema.Struct({
  label: Schema.String,
});

const SaveButtonBase = Component.make(
  Component.propsSchema(SaveButtonProps),
  Component.require<SaveService>(),
  ({ label }) =>
    Effect.gen(function* () {
      const browser = browserState();
      if (browser !== undefined) {
        browser.setupRuns += 1;
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            browser.componentResources += 1;
          }),
          () =>
            Effect.sync(() => {
              browser.componentDisposals += 1;
            }),
        );
        yield* Effect.sleep("25 millis");
      }
      const save = yield* Component.action(Portable.bind(SaveCode, { label }));
      return { save };
    }),
  (_props, bindings) => {
    const browser = browserState();
    if (browser !== undefined) browser.viewRuns += 1;
    const button = buttonTemplate();
    addEventListener(button, "click", Resume.event(bindings.save), true);
    const activationButton = activationButtonTemplate();
    addEventListener(
      activationButton,
      "click",
      Resume.activationEvent(
        "activation-save",
        Resume.MouseEventProjection,
        () => bindings.save(),
      ),
      true,
    );
    return [button, activationButton];
  },
);

const SaveButton = SaveButtonBase.pipe(
  Resume.addressable({
    id: SaveButtonActivationCodeId,
    buildId: BuildId,
    props: SaveButtonProps,
  }),
);

export const SaveButtonActivation = Resume.activationOf(SaveButton);

export function renderSaveButton(): Resume.CollectionResult {
  const scope = Scope.makeUnsafe();
  const serverService: SaveService = {
    save: () => Effect.die("The server action must never execute."),
  };
  try {
    return Effect.runSync(
      Resume.collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              Component.renderEffect(SaveButton, {
                label: "saved-from-browser",
              }).pipe(
                Scope.provide(scope),
                Effect.provideService(SaveService, serverService),
              ),
            ),
          ),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
  } finally {
    Effect.runSync(Scope.close(scope, Exit.void));
  }
}
