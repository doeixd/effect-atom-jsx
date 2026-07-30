import { Effect, Exit, Scope } from "effect";
import * as Component from "effect-atom-jsx/Component";
import { hydrateRoot } from "effect-atom-jsx";
import { browserState } from "../shared/browser-state.js";

const EagerBaseline = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  () =>
    Effect.sync(() => {
      const state = browserState();
      if (state !== undefined) state.eagerSetupRuns += 1;
      return {};
    }),
  () => {
    const state = browserState();
    if (state !== undefined) state.eagerViewRuns += 1;
    return (
      <button
        type="button"
        data-testid="eager-baseline"
        data-rendered-by="client"
      >
        Client baseline
      </button>
    );
  },
);

/**
 * Execute the repository's current `hydrateRoot` path over an SSR node and
 * record whether the compiled client view retained that exact node.
 *
 * The pinned JSX compiler uses `hydratable: false`, so this probe is expected
 * to identify the comparison mode as eager rerender until that configuration
 * and runtime contract change together.
 */
export function installEagerBaseline(): () => void {
  const state = browserState();
  const root = document.querySelector<HTMLElement>("#eager-baseline-root");
  if (state === undefined || root === null) {
    throw new Error("The eager baseline fixture is missing.");
  }
  const serverNode = root.firstElementChild;
  if (serverNode === null) {
    throw new Error("The eager baseline SSR node is missing.");
  }

  const scope = Scope.makeUnsafe();
  const disposeRoot = hydrateRoot(
    () =>
      Effect.runSync(
        Component.renderEffect(EagerBaseline, {}).pipe(
          Scope.provide(scope),
        ),
      ),
    root,
  );
  const clientNode = root.firstElementChild;
  state.eagerNodeReused = clientNode === serverNode;
  state.eagerRenderedText = clientNode?.textContent ?? "";
  state.eagerComparator = state.eagerNodeReused
    ? "dom-hydration"
    : "eager-rerender";

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    disposeRoot();
    Effect.runSync(Scope.close(scope, Exit.void));
  };
}
