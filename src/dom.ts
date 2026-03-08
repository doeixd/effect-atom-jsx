/**
 * dom.ts — DOM runtime helpers.
 *
 * These are the functions the babel-plugin-jsx-dom-expressions compiled
 * output calls. They bridge our reactive system with the actual DOM.
 *
 * The key insight: `insert` wraps reactive child expressions in a
 * Computation so they update only the minimal DOM node when deps change.
 */

import { Computation } from "./computation.js";
import { runUntracked } from "./tracking.js";
import { createRoot, mergeProps } from "./api.js";

/**
 * Create a reusable DOM template from an HTML string.
 * Called once at module load time per unique JSX tree shape.
 * The returned node is cloned by the compiled output: `_tmpl$.cloneNode(true)`.
 */
export function template(html: string): Element {
  const t = document.createElement("template");
  t.innerHTML = html;
  const node = (t.content.firstChild ?? t.content) as Element;
  // Detach so it can be cleanly cloned.
  node.remove?.();
  return node;
}

// ─── insert ───────────────────────────────────────────────────────────────────

type Child = string | number | boolean | null | undefined | Node | Child[];

/**
 * Insert `accessor` as a child of `parent`, before optional `marker`.
 *
 * If `accessor` is a function, it is wrapped in a reactive Computation that
 * re-evaluates and patches the DOM whenever dependencies change.
 */
export function insert(
  parent: Element,
  accessor: Child | (() => Child),
  marker: Node | null = null,
  current: Node | Node[] | null = null,
): Node | Node[] | null {
  if (typeof accessor === "function") {
    let currentNodes: Node | Node[] | null = current;
    new Computation(() => {
      currentNodes = insertExpression(parent, (accessor as () => Child)(), currentNodes, marker);
    });
    return currentNodes;
  }
  return insertExpression(parent, accessor, current, marker);
}

function toNode(val: Child): Node | null {
  if (val == null || val === false || val === true) return null;
  if (val instanceof Node) return val;
  return document.createTextNode(String(val));
}

function insertExpression(
  parent: Element,
  value: Child,
  current: Node | Node[] | null,
  marker: Node | null,
): Node | Node[] | null {
  if (Array.isArray(value)) {
    const newNodes: Node[] = value.flatMap(flattenChild).filter(Boolean) as Node[];
    reconcileArrays(parent, current as Node[] | null ?? [], newNodes, marker);
    return newNodes;
  }

  const newNode = toNode(value);

  if (Array.isArray(current)) {
    // Replace array with single node.
    for (let i = current.length - 1; i > 0; i--) {
      parent.removeChild(current[i]);
    }
    if (current.length > 0) {
      if (newNode) {
        parent.replaceChild(newNode, current[0]);
      } else {
        parent.removeChild(current[0]);
      }
    } else if (newNode) {
      parent.insertBefore(newNode, marker);
    }
    return newNode;
  }

  if (current instanceof Node) {
    if (newNode) {
      parent.replaceChild(newNode, current);
    } else {
      parent.removeChild(current);
    }
    return newNode;
  }

  // First render.
  if (newNode) {
    parent.insertBefore(newNode, marker);
  }
  return newNode;
}

function flattenChild(c: Child): Node[] {
  if (c == null || c === false || c === true) return [];
  if (Array.isArray(c)) return c.flatMap(flattenChild);
  if (c instanceof Node) return [c];
  return [document.createTextNode(String(c))];
}

function reconcileArrays(
  parent: Element,
  oldNodes: Node[],
  newNodes: Node[],
  marker: Node | null,
): void {
  // Simple keyed reconciliation using a LCS-free approach.
  // Good enough for most UI patterns; a keyed For component handles large lists.
  let o = 0, n = 0;
  while (o < oldNodes.length && n < newNodes.length) {
    if (oldNodes[o] === newNodes[n]) {
      o++; n++;
    } else {
      parent.insertBefore(newNodes[n], oldNodes[o]);
      n++;
    }
  }
  while (n < newNodes.length) {
    parent.insertBefore(newNodes[n++], marker);
  }
  while (o < oldNodes.length) {
    parent.removeChild(oldNodes[o++]);
  }
}

// ─── createComponent ──────────────────────────────────────────────────────────

/**
 * Instantiate a component function. Runs `Comp(props)` untracked inside a new
 * reactive root so that top-level reads inside the component body don't
 * accidentally track as deps of the parent.
 *
 * Child computations created inside `Comp` are owned by its root and disposed
 * when the parent's owner disposes.
 */
export function createComponent<P extends object>(
  Comp: (props: P) => unknown,
  props: P,
): unknown {
  return createRoot(() => runUntracked(() => Comp(props)));
}

// ─── spread ───────────────────────────────────────────────────────────────────

/**
 * Reactively spread an accessor of props onto a DOM element.
 * Called by compiled JSX for `<div {...props} />`.
 */
export function spread(
  node: Element,
  accessor: Record<string, unknown> | (() => Record<string, unknown>),
  isSVG = false,
  skipChildren = false,
): void {
  if (typeof accessor === "function") {
    new Computation(() => {
      applyProps(node, accessor(), isSVG, skipChildren);
    });
  } else {
    applyProps(node, accessor, isSVG, skipChildren);
  }
}

function applyProps(
  node: Element,
  props: Record<string, unknown>,
  isSVG: boolean,
  skipChildren: boolean,
): void {
  for (const [key, value] of Object.entries(props)) {
    if (skipChildren && key === "children") continue;
    setProp(node, key, value, isSVG);
  }
}

// ─── Prop/attribute setters ───────────────────────────────────────────────────

/** Set an attribute or DOM property on a node. */
export function attr(node: Element, name: string, value: unknown): void {
  if (value == null) {
    node.removeAttribute(name);
  } else {
    node.setAttribute(name, String(value));
  }
}

/** Set a DOM property (not attribute) on a node. */
export function prop(node: Element, name: string, value: unknown): void {
  (node as unknown as Record<string, unknown>)[name] = value;
}

function setProp(node: Element, name: string, value: unknown, isSVG: boolean): void {
  if (name === "style") {
    style(node as HTMLElement, value as Record<string, string>);
  } else if (name === "classList") {
    classList(node, value as Record<string, boolean>);
  } else if (name.startsWith("on") && name.length > 2) {
    const eventName = name.slice(2).toLowerCase();
    node.addEventListener(eventName, value as EventListener);
  } else if (!isSVG && name in node) {
    prop(node, name, value);
  } else {
    attr(node, name, value);
  }
}

// ─── classList ────────────────────────────────────────────────────────────────

/**
 * Reactively manage classList.
 * `value` is a `{ className: boolean }` map.
 */
export function classList(
  node: Element,
  value: Record<string, boolean>,
  prev: Record<string, boolean> = {},
): Record<string, boolean> {
  for (const name of Object.keys(prev)) {
    if (!value[name]) node.classList.remove(name);
  }
  for (const name of Object.keys(value)) {
    if (value[name] !== prev[name]) {
      if (value[name]) node.classList.add(name);
      else node.classList.remove(name);
    }
  }
  return value;
}

// ─── style ────────────────────────────────────────────────────────────────────

/** Reactively set inline styles. */
export function style(
  node: HTMLElement,
  value: string | Record<string, string>,
  prev?: string | Record<string, string>,
): void {
  if (typeof value === "string") {
    node.style.cssText = value;
    return;
  }
  if (typeof prev === "object") {
    for (const key of Object.keys(prev)) {
      if (!(key in value)) node.style.removeProperty(key);
    }
  }
  for (const [key, val] of Object.entries(value)) {
    node.style.setProperty(key, val);
  }
}

// ─── Event delegation ─────────────────────────────────────────────────────────

const delegatedEvents = new Set<string>();

/**
 * Set up global event delegation for the listed event names.
 * Delegated handlers are attached to `document` and use
 * a `__handlers` property on each element.
 */
export function delegateEvents(events: string[], document_: Document = document): void {
  for (const event of events) {
    if (!delegatedEvents.has(event)) {
      delegatedEvents.add(event);
      document_.addEventListener(event, delegatedEventHandler);
    }
  }
}

function delegatedEventHandler(e: Event): void {
  let node = e.target as Element | null;
  const key = `__${e.type}`;
  while (node !== null) {
    const handler = (node as unknown as Record<string, unknown>)[key] as EventListener | undefined;
    if (handler) {
      handler(e);
      if (e.cancelBubble) return;
    }
    node = node.parentElement;
  }
}

// ─── render ───────────────────────────────────────────────────────────────────

/**
 * Mount a component tree into a DOM container.
 *
 * @example
 * render(() => <App />, document.getElementById("root")!);
 */
export function render(
  fn: () => unknown,
  container: Element,
): () => void {
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    insert(container, fn as () => Child);
  });
  return dispose;
}

// ─── effect / memo re-exports (used by compiled JSX output) ──────────────────
// The babel-compiled output imports `effect` and `memo` from the runtime module.
// We proxy them here so the runtime module is self-contained.

export { createEffect as effect, createMemo as memo, untrack, sample, batch, createRoot as root, getOwner, runWithOwner, mergeProps } from "./api.js";
