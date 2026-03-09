/**
 * effect-atom-jsx — main entry point.
 *
 * Re-exports the full public API: reactive primitives, DOM helpers,
 * and Effect-TS integration.
 *
 * The babel-plugin-jsx-dom-expressions should point to
 * "effect-atom-jsx/runtime" for compiled JSX output.
 */

// ─── Reactive core ────────────────────────────────────────────────────────────
export {
  createSignal,
  createEffect,
  createMemo,
  createRoot,
  createContext,
  useContext,
  onCleanup,
  onMount,
  untrack,
  sample,
  batch,
  mergeProps,
  splitProps,
  getOwner,
  runWithOwner,
  type Accessor,
  type Setter,
  type SignalOptions,
  type Context,
} from "./api.js";

// ─── Atom API (Jotai-style ergonomics on top of reactive core) ────────────────
export {
  createAtom,
  type Atom as AtomType,
  type WritableAtom,
  type DerivedAtom,
  type AtomGetter,
} from "./effect-ts.js";

// ─── Effect-atom style namespace APIs ─────────────────────────────────────────
export * as Atom from "./Atom.js";
export * as AtomHttpApi from "./AtomHttpApi.js";
export * as AtomRef from "./AtomRef.js";
export * as AtomRpc from "./AtomRpc.js";
export * as AtomLogger from "./AtomLogger.js";
export * as AtomSchema from "./AtomSchema.js";
export * as Hydration from "./Hydration.js";
export * as Result from "./Result.js";
export * as Registry from "./Registry.js";

// ─── Effect-TS integration ───────────────────────────────────────────────────
export {
  atomEffect,
  queryEffect,
  queryEffectStrict,
  defineQuery,
  defineQueryStrict,
  createQueryKey,
  invalidate,
  refresh,
  isPending,
  latest,
  createOptimistic,
  mutationEffect,
  mutationEffectStrict,
  use,
  useService,
  useServices,
  mount,
  createMount,
  mountWith,
  signal,
  computed,
  scopedRoot,
  scopedRootEffect,
  scopedQuery,
  scopedQueryEffect,
  scopedMutation,
  scopedMutationEffect,
  layerContext,
  AsyncResult,
  Async,
  Loading,
  Errored,
  Switch,
  Match,
  MatchTag,
  Optional,
  MatchOption,
  Dynamic,
  createFrame,
  Frame,
  WithLayer,
  For,
  Show,
  type Loading as AsyncLoading,
  type Refreshing,
  type Success,
  type Failure,
  type AsyncResult as AsyncResultType,
  type RuntimeLike,
  type QueryKey,
  type QueryRef,
  type OptimisticRef,
  type MutationEffectHandle,
  type MutationEffectOptions,
  type SignalRef,
  type ComputedRef,
} from "./effect-ts.js";

// ─── DOM runtime helpers (also exported from ./runtime for compiled JSX) ──────
export {
  template,
  insert,
  createComponent,
  spread,
  attr,
  prop,
  classList,
  style,
  delegateEvents,
  render,
  renderWithHMR,
  withViteHMR,
  // SSR / Hydration:
  isServer,
  renderToString,
  hydrateRoot,
  isHydrating,
  getNextHydrateNode,
  getRequestEvent,
  setRequestEvent,
  // Reactive primitives re-exported for runtime consumers:
  effect,
  memo,
  type ViteHotContext,
} from "./dom.js";
