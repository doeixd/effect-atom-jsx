/**
 * SERVER-ONLY render entry. This module imports the preset (and through it
 * the compiler plugin), so it must never be reachable from the client
 * bundle — the client lazy-loads `pin-board.ts` for its extracted handler,
 * and keeping that module free of `@affe/permissive` is what keeps babel out
 * of the browser. The Playwright spec pins the resulting chunk size.
 */

import { Effect, Exit, Scope } from "effect";
import * as Component from "effect-atom-jsx/Component";
import * as Resume from "effect-atom-jsx/Resume";
import { renderToString } from "effect-atom-jsx";
import { permissive } from "@affe/permissive";
import { BuildId } from "../shared/build.js";
import { PinBoard } from "./pin-board.js";

export async function renderPinBoard(): Promise<Resume.CollectionResult> {
  const preset = permissive({ buildId: BuildId });
  const scope = Scope.makeUnsafe();
  try {
    // runPromise, not runSync: the seroval codec loads lazily and the async
    // layer's serialize awaits (that is what lets Promise captures settle).
    return await Effect.runPromise(
      Resume.collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              Component.renderEffect(PinBoard, {
                label: "permissive-map-capture",
              }).pipe(Scope.provide(scope)),
            ),
          ),
        { buildId: BuildId },
      ).pipe(Effect.provide(preset.serverLayer)),
    );
  } finally {
    Effect.runSync(Scope.close(scope, Exit.void));
  }
}
