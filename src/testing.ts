/**
 * testing.ts — First-class testing harness for effect-atom-jsx.
 *
 * Provides utilities to test reactive code that depends on Effect layers
 * and services, without requiring a DOM or jsdom environment.
 *
 * Taxonomy (F3):
 * - **story** tests drive bindings/actions/results directly (unit path)
 * - **scene** tests simulate users against slot handles via the driver
 *   (always through the production root path; DOM-free)
 */

import { Effect, Layer, ManagedRuntime, ServiceMap } from "effect";
import { createRoot, getOwner, runWithOwner } from "./api.js";
import { ManagedRuntimeContext, Result, setResultForTest, type Result as ResultType } from "./effect-ts.js";
import * as Component from "./Component.js";
import * as Element from "./Element.js";
import * as View from "./View.js";

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
   * `defineQuery`/`defineMutation` operations run against the runtime.
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
 *   const data = defineQuery(() => useService(Api).fetchData(), { name: "fetch-data" });
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
 *   const save = defineMutation((n: number) => useService(Api).save(n));
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

/** Result of rendering a slot-bearing component through the test harness. */
export interface ComponentRender<C extends Component.Component<any, any, any, any, any>> {
  readonly view: View.View<Component.SlotsOf<C>>;
  readonly slots: Component.SlotsOf<C>;
  readonly driver: BehaviorDriver<Component.SlotsOf<C>>;
}

/**
 * Render a component and expose its `View`, slots, and behavior driver.
 *
 * This uses the production component render path and requires the component to
 * return an explicit `View` (for example via `View.fromSlots(...)`).
 */
export async function render<C extends Component.Component<any, any, any, any, any>>(
  component: C,
  options: {
    readonly props: Component.PropsOf<C>;
    readonly layer?: Layer.Layer<any, any, any>;
  },
): Promise<ComponentRender<C>> {
  const effect = Component.renderViewEffect(component, options.props);
  const provided = options.layer === undefined ? effect : effect.pipe(Effect.provide(options.layer));
  const view = await Effect.runPromise(provided as Effect.Effect<View.View<Component.SlotsOf<C>> | undefined, unknown, never>);
  if (view === undefined) {
    throw new Error("Component test render expected a View result.");
  }
  return {
    view,
    slots: view.slots as Component.SlotsOf<C>,
    driver: behaviorDriver(view.slots as Component.SlotsOf<C>),
  };
}

/**
 * DOM-free user-event driver for slot handles.
 *
 * The driver emits the same events behaviors listen for, so scene tests can
 * exercise behavior attachment without a browser environment.
 */
export interface BehaviorDriver<Slots> {
  readonly slots: Slots;
  handle<Name extends keyof Slots & string>(name: Name): Slots[Name];
  emit<Name extends keyof Slots & string>(name: Name, event: string, eventData?: unknown): void;
  press<Name extends keyof Slots & string>(name: Name, eventData?: unknown): void;
  input<Name extends keyof Slots & string>(name: Name, eventData?: unknown): void;
  keydown<Name extends keyof Slots & string>(name: Name, key: string, eventData?: unknown): void;
  focus<Name extends keyof Slots & string>(name: Name, eventData?: unknown): void;
  blur<Name extends keyof Slots & string>(name: Name, eventData?: unknown): void;
  attr<Name extends keyof Slots & string>(name: Name, attribute: string): unknown;
  style<Name extends keyof Slots & string>(name: Name, property: string): unknown;
  /** Drive an item in an `Element.Collection` slot by index. */
  item<Name extends keyof Slots & string>(name: Name, index: number): Element.Handle;
  pressItem<Name extends keyof Slots & string>(name: Name, index: number, eventData?: unknown): void;
  keydownItem<Name extends keyof Slots & string>(name: Name, index: number, key: string, eventData?: unknown): void;
  collectionSize<Name extends keyof Slots & string>(name: Name): number;
}

function asHandle(value: unknown, slot: string): Element.Handle {
  if (typeof value === "object" && value !== null && "emit" in value) {
    return value as Element.Handle;
  }
  throw new Error(`Slot '${slot}' is not an Element.Handle.`);
}

function asCollection(value: unknown, slot: string): Element.Collection<Element.Handle> {
  if (
    typeof value === "object"
    && value !== null
    && "_tag" in value
    && (value as { readonly _tag: unknown })._tag === "Collection"
    && "items" in value
  ) {
    return value as Element.Collection<Element.Handle>;
  }
  throw new Error(`Slot '${slot}' is not an Element.Collection.`);
}

/** Create a behavior driver for a slot handle map. */
export function behaviorDriver<Slots>(slots: Slots): BehaviorDriver<Slots> {
  return {
    slots,
    handle(name) {
      return slots[name];
    },
    emit(name, event, eventData) {
      asHandle(slots[name], String(name)).emit(event, eventData);
    },
    press(name, eventData) {
      asHandle(slots[name], String(name)).emit("press", eventData);
    },
    input(name, eventData) {
      asHandle(slots[name], String(name)).emit("input", eventData);
    },
    keydown(name, key, eventData) {
      asHandle(slots[name], String(name)).emit(
        "keydown",
        eventData !== undefined && typeof eventData === "object"
          ? { key, ...(eventData as Record<string, unknown>) }
          : { key },
      );
    },
    focus(name, eventData) {
      asHandle(slots[name], String(name)).emit("focus", eventData);
    },
    blur(name, eventData) {
      asHandle(slots[name], String(name)).emit("blur", eventData);
    },
    attr(name, attribute) {
      return asHandle(slots[name], String(name)).getAttr(attribute);
    },
    style(name, property) {
      return asHandle(slots[name], String(name)).getStyle(property);
    },
    item(name, index) {
      const items = asCollection(slots[name], String(name)).items();
      const handle = items[index];
      if (handle === undefined) {
        throw new Error(`Slot '${String(name)}' collection has no item at index ${index} (size ${items.length}).`);
      }
      return handle;
    },
    pressItem(name, index, eventData) {
      this.item(name, index).emit("press", eventData);
    },
    keydownItem(name, index, key, eventData) {
      this.item(name, index).emit(
        "keydown",
        eventData !== undefined && typeof eventData === "object"
          ? { key, ...(eventData as Record<string, unknown>) }
          : { key },
      );
    },
    collectionSize(name) {
      return asCollection(slots[name], String(name)).items().length;
    },
  };
}

/**
 * Short-circuit a query handle's `Result` without running its Effect.
 * Unit-test path; use mock layers for integration tests.
 *
 * @example
 * resolveQuery(todos, Result.success([{ id: 1 }]));
 * resolveQuery(todos, Result.failure(new NetworkError()));
 */
export function resolveQuery<A, E>(
  query: { readonly result: () => ResultType<A, E> },
  result: ResultType<A, E>,
): void {
  setResultForTest(query.result, result);
}

/**
 * Short-circuit an action/mutation handle's `Result` without running its Effect.
 *
 * @example
 * resolveAction(save, Result.success(undefined));
 * resolveAction(save, Result.failure(new ValidationError()));
 */
export function resolveAction<E>(
  action: { readonly result: () => ResultType<void, E> },
  result: ResultType<void, E>,
): void {
  setResultForTest(action.result, result);
}

export { Result };

/** Read a style property from an element handle. */
export function styleOf(handle: Element.Handle, property: string): unknown {
  return handle.getStyle(property);
}

/** Read an attribute from an element handle. */
export function attrOf(handle: Element.Handle, attribute: string): unknown {
  return handle.getAttr(attribute);
}

/** Assert that an element handle has a style property value. */
export function expectStyle(handle: Element.Handle, property: string, expected: unknown): void {
  const actual = handle.getStyle(property);
  if (!Object.is(actual, expected)) {
    throw new Error(`Expected style '${property}' to be ${String(expected)}, got ${String(actual)}.`);
  }
}

/** Assert that an element handle has an attribute value. */
export function expectAttr(handle: Element.Handle, attribute: string, expected: unknown): void {
  const actual = handle.getAttr(attribute);
  if (!Object.is(actual, expected)) {
    throw new Error(`Expected attribute '${attribute}' to be ${String(expected)}, got ${String(actual)}.`);
  }
}

/** One named scenario/story/scene step. */
export interface ScenarioStep<Context> {
  readonly name: string;
  readonly run: (context: Context) => void | Promise<void>;
}

/** Result of running a named scenario. */
export interface ScenarioResult {
  readonly name: string;
  readonly kind?: "story" | "scene" | "scenario";
  readonly steps: readonly {
    readonly name: string;
    readonly ok: boolean;
    readonly error?: unknown;
  }[];
}

/** Result of a story test, which drives bindings/actions directly. */
export type StoryResult = ScenarioResult & { readonly kind: "story" };
/** Result of a scene test, which drives slot-handle interactions. */
export type SceneResult = ScenarioResult & { readonly kind: "scene" };

/** Create a named scenario step. */
export function step<Context>(
  name: string,
  run: (context: Context) => void | Promise<void>,
): ScenarioStep<Context> {
  return { name, run };
}

/** Run scenario steps until the first failure and return a structured result. */
export async function scenario<Context>(
  name: string,
  context: Context,
  steps: readonly ScenarioStep<Context>[],
  options?: { readonly kind?: ScenarioResult["kind"] },
): Promise<ScenarioResult> {
  const results: Array<{ readonly name: string; readonly ok: boolean; readonly error?: unknown }> = [];
  for (const item of steps) {
    try {
      await item.run(context);
      results.push({ name: item.name, ok: true });
    } catch (error) {
      results.push({ name: item.name, ok: false, error });
      break;
    }
  }
  return { name, kind: options?.kind ?? "scenario", steps: results };
}

/**
 * Story test: drive bindings/actions/results directly (no user-event simulation).
 * Prefer `*.story.test.ts` naming for story suites.
 */
export async function story<Context>(
  name: string,
  context: Context,
  steps: readonly ScenarioStep<Context>[],
): Promise<StoryResult> {
  return scenario(name, context, steps, { kind: "story" }) as Promise<StoryResult>;
}

/**
 * Scene test: simulate user interaction against slot handles via the production path.
 * Prefer `*.scene.test.ts` naming for scene suites. DOM-free when using `behaviorDriver`.
 */
export async function scene<Context>(
  name: string,
  context: Context,
  steps: readonly ScenarioStep<Context>[],
): Promise<SceneResult> {
  return scenario(name, context, steps, { kind: "scene" }) as Promise<SceneResult>;
}

/** Throw if a scenario/story/scene result contains a failed step. */
export function expectScenarioOk(result: ScenarioResult): void {
  const failed = result.steps.find((item) => !item.ok);
  if (failed !== undefined) {
    const label = result.kind === undefined || result.kind === "scenario"
      ? "Scenario"
      : result.kind === "story"
      ? "Story"
      : "Scene";
    throw new Error(`${label} '${result.name}' failed at step '${failed.name}': ${String(failed.error)}`);
  }
}
