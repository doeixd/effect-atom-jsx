/**
 * runtime.ts — The module that babel-plugin-jsx-dom-expressions imports from.
 *
 * Configure babel with:
 *   { moduleName: "effect-atom-jsx/runtime", generate: "dom" }
 *
 * All exports here match the interface the compiled JSX output expects.
 */

export {
  // DOM helpers
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
  // Reactive helpers called by compiled expressions
  effect,
  memo,
  untrack,
  sample,
  batch,
  root,
  getOwner,
  runWithOwner,
  mergeProps,
} from "./dom.js";

// The babel plugin also needs these for certain compiled patterns:
export {
  createSignal,
  createEffect,
  createMemo,
  createRoot,
  onCleanup,
  onMount,
  splitProps,
} from "./api.js";

// UI primitives that dom-expressions assumes exist:
export { For, Show, Async } from "./effect-ts.js";
