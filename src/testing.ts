/**
 * testing.ts — First-class testing harness for effect-atom-jsx.
 *
 * Provides utilities to test reactive code that depends on Effect layers
 * and services, without requiring a DOM or jsdom environment.
 */

import { Layer, ManagedRuntime, ServiceMap } from "effect";
import { createRoot, getOwner, runWithOwner } from "./api.js";
import { ManagedRuntimeContext } from "./effect-ts.js";

// We need access to the internal contextMap to inject the ambient runtime
// on the root Owner before any child effects run.
import { contextMap } from "./api.js";

/**
 * A logical test harness providing a configured Effect Runtime and a
 * bound reactive root.
 */
export interface TestHarness<R> {
  /** The initialized ManagedRuntime powering the test. */
  readonly runtime: ManagedRuntime.ManagedRuntime<R, never>;

  /**
   * Run a function inside the harness's reactive root.
   *
   * Services from the layer are available via `useService` and
   * `queryEffect`/`mutationEffect` operations run against the runtime.
   */
  run<T>(fn: () => T): T;

  /**
   * Advance the JS execution environment by awaiting a microtask tick.
   * Optionally delays by `ms` milliseconds.
   *
   * @param ms - Milliseconds to delay. Defaults to 0 (next tick).
   */
  tick(ms?: number): Promise<void>;

  /**
   * Dispose the reactive root, canceling any running Effects and
   * cleaning up resources, then dispose the ManagedRuntime.
   */
  dispose(): Promise<void>;
}

/**
 * Create a test harness using the provided Effect Layer.
 *
 * It initializes a `ManagedRuntime`, sets it as the ambient context
 * for a new reactive root, and allows you to execute code within that root.
 *
 * @example
 * const harness = withTestLayer(MyMockLayer);
 * harness.run(() => {
 *   const data = queryEffect(() => useService(Api).fetchData());
 *   // ...
 * });
 * await harness.dispose();
 */
export function withTestLayer<R>(layer: Layer.Layer<R, never, never>): TestHarness<R> {
  const runtime = ManagedRuntime.make(layer);

  let rootDispose!: () => void;
  let rootOwner: ReturnType<typeof getOwner> = null;
  let isDisposed = false;

  createRoot((dispose) => {
    rootDispose = dispose;
    rootOwner = getOwner();

    // Inject ManagedRuntimeContext directly into the owner's contextMap.
    // This is the same thing Provider does, but we do it eagerly so that
    // any code run later via `harness.run()` will find the ambient runtime.
    if (rootOwner !== null) {
      let map = contextMap.get(rootOwner);
      if (!map) {
        map = new Map();
        contextMap.set(rootOwner, map);
      }
      map.set(ManagedRuntimeContext.id, runtime);
    }
  });

  return {
    runtime,
    run: <T>(fn: () => T): T => {
      if (isDisposed) throw new Error("TestHarness is already disposed.");
      if (!rootOwner) return fn();
      return runWithOwner(rootOwner, fn);
    },
    tick: (ms?: number) => new Promise((resolve) => setTimeout(resolve, ms ?? 0)),
    dispose: async () => {
      if (isDisposed) return;
      isDisposed = true;
      rootDispose();
      await runtime.dispose();
    },
  };
}

/**
 * Create a test harness and immediately run the provided `ui` callback inside it.
 *
 * @example
 * const harness = renderWithLayer(MyMockLayer, () => {
 *   const save = mutationEffect((n: number) => useService(Api).save(n));
 *   save.run(42);
 * });
 * await harness.tick();
 * await harness.dispose();
 */
export function renderWithLayer<R>(
  layer: Layer.Layer<R, never, never>,
  ui: () => unknown,
): TestHarness<R> {
  const harness = withTestLayer(layer);
  harness.run(ui);
  return harness;
}

/**
 * Helper to construct an Effect Layer from a single mock implementation.
 *
 * Equivalent to `Layer.succeed(tag, impl)`, provided for better test discoverability.
 *
 * @example
 * const ApiMock = mockService(Api, { fetch: () => Effect.succeed("mocked") });
 */
export function mockService<I, S>(
  tag: ServiceMap.Key<I, S>,
  impl: S,
): Layer.Layer<I, never, never> {
  return Layer.succeed(tag, impl);
}
