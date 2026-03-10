/**
 * effect-atom-jsx — main entry point.
 *
 * Re-exports the full public API: reactive primitives, DOM helpers,
 * and Effect-TS integration.
 *
 * The babel-plugin-jsx-dom-expressions should point to
 * "effect-atom-jsx/runtime" for compiled JSX output.
 */

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
export { useRegistry } from "./Registry.js";

// ─── Effect-TS integration ───────────────────────────────────────────────────
export {
  atomEffect,
  defineQuery,
  createQueryKey,
  invalidate,
  isPending,
  latest,
  createOptimistic,
  defineMutation,
  useService,
  useServices,
  mount,
  createMount,
  scopedRootEffect,
  scopedQueryEffect,
  scopedMutationEffect,
  layerContext,
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
  type RuntimeLike,
  type QueryKey,
  type QueryRef,
  type OptimisticRef,
  type MutationEffectHandle,
  type MutationEffectOptions,
} from "./effect-ts.js";
