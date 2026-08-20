import { Layer, ManagedRuntime } from "effect";
import type {
  BenchmarkBrowserState,
  BenchmarkOwnership,
} from "../shared/browser-state.js";
import { browserState } from "../shared/browser-state.js";
import { mountEager } from "../app/benchmark.js";

export async function installEager(
  options: { readonly withManagedRuntime: boolean },
): Promise<void> {
  const candidateState = browserState();
  const root = document.querySelector<HTMLElement>("#root");
  if (candidateState === undefined || root === null) {
    throw new Error("The eager benchmark document is incomplete.");
  }
  const state: BenchmarkBrowserState = candidateState;
  const runtime = options.withManagedRuntime
    ? ManagedRuntime.make(Layer.empty)
    : undefined;

  const observer = new MutationObserver((records) => {
    if (!state.ready || state.disposed) return;
    state.patches += records.length;
    state.lastPatchAt = performance.now();
  });
  observer.observe(root, {
    characterData: true,
    childList: true,
    subtree: true,
  });

  const mount = mountEager(state.density, root);
  state.startupNodeReused = mount.startupNodeReused;

  const ownership = (): BenchmarkOwnership => {
    if (state.disposed) {
      return {
        boundaryControllers: 0,
        expressionControllers: 0,
        expressionDependencyKeys: 0,
        expressionSubscriptions: 0,
        pendingFibers: 0,
      };
    }
    const dependencyKeys = state.density === 1 ? 1 : 13;
    return {
      boundaryControllers: 1,
      expressionControllers: state.density,
      expressionDependencyKeys: dependencyKeys,
      expressionSubscriptions: state.density,
      pendingFibers: 0,
    };
  };

  window.__AF_BENCHMARK_WRITE_SHARED__ = async (value) => {
    mount.writeShared(value);
  };
  window.__AF_BENCHMARK_WRITE_INDEPENDENT__ = async (index, value) => {
    mount.writeIndependent(index, value);
  };
  window.__AF_BENCHMARK_INSPECT__ = ownership;
  window.__AF_BENCHMARK_DISPOSE__ = async () => {
    if (state.disposed) return;
    mount.dispose();
    observer.disconnect();
    await runtime?.dispose();
    state.disposed = true;
    state.ownershipAfterDispose = ownership();
  };

  state.ownershipBeforeUse = ownership();
  state.readyAt = performance.now();
  state.ready = true;
}

