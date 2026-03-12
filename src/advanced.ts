/**
 * Advanced APIs for power users and migration paths.
 *
 * This subpath exposes lower-level async constructors, scoped variants,
 * and async state internals that are intentionally omitted from the
 * top-level golden-path exports.
 */

export {
  atomEffect,
  defineQuery,
  defineMutation,
  scopedRootEffect,
  scopedQueryEffect,
  scopedMutationEffect,
  layerContext,
  Async,
  Result,
  TypedBoundary,
  type Loading,
  type Refreshing,
  type Success,
  type Failure,
  type Defect,
  type Result as ResultType,
} from "./effect-ts.js";

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
  flush,
  mergeProps,
  splitProps,
  getOwner,
  runWithOwner,
  type Accessor,
  type Setter,
  type SignalOptions,
  type Context,
} from "./api.js";
