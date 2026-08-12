/**
 * Dismissable layer — stacked overlay dismissal (Escape / outside press),
 * topmost-only.
 *
 * The layer stack is a Context SERVICE, never a module global: two concurrent
 * SSR requests get two stacks, sibling `Component.withLayer` subtrees are
 * isolated, and a test provides its own. Semantics inspired by Radix
 * `DismissableLayer` nesting rules and Zag's dismissable-layer utilities (not
 * a port of that code).
 *
 * @see docs/kit-research/behaviors/dismissable-layer.md
 */
import { Context, Effect, Layer, Schema, Scope } from "effect";
import * as Behavior from "../Behavior.js";
import type * as Element from "../Element.js";

export const DismissableLayerOptions = Schema.Struct({
  /** Escape dismisses this layer when it is topmost. Default true. */
  dismissOnEscape: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  /** A press outside this layer dismisses it when topmost. Default true. */
  dismissOnOutsidePress: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  /**
   * Reserved modal posture flag (Base UI's trichotomy): widgets read it to
   * decide pointer-events handling outside the layer. Default false.
   */
  disableOutsidePointerEvents: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
});

export type DismissableLayerOptions = typeof DismissableLayerOptions.Type;

/** Caller-facing config: every Schema knob optional (defaults decode in). */
export type DismissableLayerConfig = typeof DismissableLayerOptions.Encoded & {
  readonly onDismiss?: () => void;
};

export type DismissableLayerBindings = {
  /** True while this layer is the top of its stack. */
  readonly isTopmost: () => boolean;
  /** Programmatic dismissal (same path as Escape). */
  readonly dismiss: () => void;
};

/** One registered layer, as observable stack state. */
export interface DismissLayerEntry {
  readonly id: number;
  readonly dismissOnEscape: boolean;
  readonly dismissOnOutsidePress: boolean;
  readonly disableOutsidePointerEvents: boolean;
}

/**
 * The shared layer stack. `layers()` is observable state (bottom to top);
 * registration and removal keep exact-once semantics — a removed layer can
 * never dismiss again.
 */
export interface DismissLayerStackService {
  readonly layers: () => ReadonlyArray<DismissLayerEntry>;
  readonly register: (
    entry: Omit<DismissLayerEntry, "id"> & { readonly dismiss: () => void },
  ) => number;
  readonly unregister: (id: number) => void;
  readonly isTopmost: (id: number) => boolean;
  /**
   * A pointer press observed inside layer `id` (or outside every layer when
   * `id` is undefined): layers stacked ABOVE the pressed layer with
   * `dismissOnOutsidePress` dismiss, topmost first — outside a child is
   * still inside its parent, so the parent stays.
   */
  readonly notifyPress: (id?: number) => void;
}

/** Construct an isolated stack instance (one per Layer provision). */
export function makeDismissLayerStack(): DismissLayerStackService {
  type Registered = DismissLayerEntry & { readonly dismiss: () => void };
  const stack: Array<Registered> = [];
  let nextId = 0;
  const indexOf = (id: number): number =>
    stack.findIndex((entry) => entry.id === id);
  return {
    layers: () =>
      stack.map(({ dismiss: _dismiss, ...entry }) => entry),
    register: (entry) => {
      const id = nextId;
      nextId += 1;
      stack.push({ ...entry, id });
      return id;
    },
    unregister: (id) => {
      const index = indexOf(id);
      if (index !== -1) stack.splice(index, 1);
    },
    isTopmost: (id) => stack.length > 0 && stack[stack.length - 1]!.id === id,
    notifyPress: (id) => {
      const floor = id === undefined ? -1 : indexOf(id);
      if (id !== undefined && floor === -1) return;
      for (const entry of [...stack.slice(floor + 1)].reverse()) {
        if (entry.dismissOnOutsidePress) entry.dismiss();
      }
    },
  };
}

const DismissLayerStackTag = Context.Service<DismissLayerStackService>(
  "effect-atom-jsx/behaviors/DismissLayerStack",
);

/**
 * The stack service tag, with a `layer` constructing a FRESH stack per
 * provision — provide it once per isolation boundary (page, subtree, test).
 */
export const DismissLayerStack = Object.assign(DismissLayerStackTag, {
  layer: Layer.sync(DismissLayerStackTag, makeDismissLayerStack),
});

/**
 * Register the attached root as a dismissable overlay layer.
 *
 * Escape on the root dismisses the layer only while it is topmost of ITS
 * stack. A pointerdown on the root is reported to the stack so layers above
 * it (a press inside a parent is outside its children) dismiss; presses
 * outside every layer are the embedding's to report via
 * `stack.notifyPress()`. Removal on scope close is exact-once.
 *
 * Options decode against `DismissableLayerOptions` at attach time: defaults
 * come from the Schema, and a malformed config fails the attach Effect with a
 * typed `Behavior.BehaviorOptionsError` — the factory itself never throws.
 */
export const dismissableLayer = (config: DismissableLayerConfig = {}) =>
  Behavior.make<
    { readonly root: Element.Container },
    DismissableLayerBindings,
    DismissLayerStackService | Scope.Scope,
    Behavior.BehaviorOptionsError
  >((elements) =>
    Effect.gen(function* () {
      const options = yield* Behavior.decodeOptions(
        "dismissableLayer",
        DismissableLayerOptions,
        {
          dismissOnEscape: config.dismissOnEscape,
          dismissOnOutsidePress: config.dismissOnOutsidePress,
          disableOutsidePointerEvents: config.disableOutsidePointerEvents,
        },
      );
      const stack = yield* DismissLayerStack;

      const dismiss = (): void => {
        config.onDismiss?.();
      };
      const id = stack.register({ ...options, dismiss });
      yield* Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => stack.unregister(id)));

      yield* elements.root.on("keydown", (raw) => {
        const event = raw as { readonly key?: string; readonly preventDefault?: () => void };
        if (event.key !== "Escape") return;
        if (!options.dismissOnEscape) return;
        if (!stack.isTopmost(id)) return;
        event.preventDefault?.();
        dismiss();
      });

      yield* elements.root.on("pointerdown", () => {
        stack.notifyPress(id);
      });

      return {
        isTopmost: () => stack.isTopmost(id),
        dismiss,
      } satisfies DismissableLayerBindings;
    })
  ).pipe(
    Behavior.provides({
      isTopmost: Behavior.binding<"isTopmost", () => boolean>("isTopmost"),
      dismiss: Behavior.binding<"dismiss", () => void>("dismiss"),
    }),
  );
