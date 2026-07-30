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
import { createRoot, mergeProps, onCleanup } from "./api.js";
import {
  bindScopeCleanup,
  currentComponentScope,
  forkComponentScope,
  withComponentScope,
} from "./component-scope.js";
import {
  observeDirectEventHandler,
  observeRenderedExpression,
  observeRenderedExpressionTarget,
  observeServerEventTarget,
} from "./resume-session.js";
import {
  inspectExpression,
  type ExpressionTargetValue,
  type ResumableExpression,
} from "./resume-expression.js";
import {
  registerActivationEventTarget,
  replayTargetAttribute,
} from "./resume-event.js";

/**
 * Create the lazy clone factory required by `babel-plugin-jsx-dom-expressions`.
 *
 * The compiler calls `template(...)` at module evaluation time and invokes the
 * returned function while rendering. Deferring DOM access keeps compiled
 * modules importable on the server before `renderToString` installs its virtual
 * document.
 */
export function template(
  html: string,
  _isCustomElement?: boolean,
  _isSVG?: boolean,
  _hasCustomElement?: boolean,
): () => Element {
  const browserTemplates = new WeakMap<Document, Node>();
  let serverTemplate: ServerNode | undefined;

  return () => {
    if (_ssrMode) {
      if (serverTemplate === undefined) {
        serverTemplate = parseHTML(html)[0] ?? new ServerDocumentFragment();
      }
      return serverTemplate.cloneNode(true) as unknown as Element;
    }

    if (typeof document === "undefined") {
      throw new Error(
        "[effect-atom-jsx/template] cannot instantiate a DOM template without a document or active SSR render.",
      );
    }
    let reusable = browserTemplates.get(document);
    if (reusable === undefined) {
      const templateElement = document.createElement("template") as HTMLTemplateElement;
      templateElement.innerHTML = html;
      reusable = templateElement.content.firstChild ?? templateElement.content;
      browserTemplates.set(document, reusable);
    }
    return reusable.cloneNode(true) as Element;
  };
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
  accessor: unknown | (() => unknown),
  marker: Node | null = null,
  current: Node | Node[] | null = null,
): Node | Node[] | null {
  if (typeof accessor === "function") {
    const childAccessor = accessor as () => Child;
    let currentNodes: Node | Node[] | null = current;
    const resumableExpression = inspectExpression(accessor) === undefined
      ? undefined
      : accessor as ResumableExpression;
    const expressionInsertion = {};
    new Computation(() => {
      const value = resumableExpression === undefined
        ? childAccessor()
        : observeRenderedExpression(
          resumableExpression,
          expressionInsertion,
          childAccessor,
        ) as Child;
      currentNodes = insertExpression(parent, value, currentNodes, marker);
    });
    return currentNodes;
  }
  return insertExpression(parent, accessor as Child, current, marker);
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
        if (
          current[0]?.nodeName === "#text"
          && newNode.nodeName === "#text"
        ) {
          current[0].textContent = newNode.textContent;
          return current[0];
        }
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
      if (current.nodeName === "#text" && newNode.nodeName === "#text") {
        current.textContent = newNode.textContent;
        return current;
      }
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
  return createRoot(() => {
    const childScope = forkComponentScope(currentComponentScope());
    bindScopeCleanup(childScope);
    return withComponentScope(childScope, () => runUntracked(() => Comp(props)));
  });
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
  const previous: Record<string, unknown> = {};
  new Computation(() => {
    const props = typeof accessor === "function" ? accessor() : accessor;
    applyProps(node, props ?? {}, isSVG, skipChildren, previous);
  });
}

function applyProps(
  node: Element,
  props: Record<string, unknown>,
  isSVG: boolean,
  skipChildren: boolean,
  previous: Record<string, unknown>,
): void {
  for (const key of Object.keys(previous)) {
    if (key in props || (skipChildren && key === "children")) continue;
    setProp(node, key, null, isSVG, previous[key]);
    delete previous[key];
  }
  for (const [key, value] of Object.entries(props)) {
    if (skipChildren && key === "children") continue;
    const stateful = key === "style" || key === "classList"
      || key.startsWith("on");
    if (!stateful && previous[key] === value) continue;
    previous[key] = setProp(node, key, value, isSVG, previous[key]);
  }
}

// ─── Prop/attribute setters ───────────────────────────────────────────────────

/** Set an ordinary attribute, removing it for nullish values. */
export function setAttribute(
  node: Element,
  name: string,
  value?: unknown,
): void {
  if (value == null) {
    node.removeAttribute(name);
  } else {
    node.setAttribute(name, String(value));
  }
}

/** Backwards-compatible runtime alias for {@link setAttribute}. */
export const attr = setAttribute;

/** Set a namespaced attribute, removing it for nullish values. */
export function setAttributeNS(
  node: Element,
  namespace: string,
  name: string,
  value?: unknown,
): void {
  if (value == null) {
    node.removeAttributeNS(namespace, name);
  } else {
    node.setAttributeNS(namespace, name, String(value));
  }
}

/** Toggle a boolean attribute using presence semantics. */
export function setBoolAttribute(
  node: Element,
  name: string,
  value: unknown,
): void {
  if (value) node.setAttribute(name, "");
  else node.removeAttribute(name);
}

/** Set a DOM property (not attribute) on a node. */
export function setProperty(node: Element, name: string, value: unknown): void {
  (node as unknown as Record<string, unknown>)[name] = value;
}

/** Backwards-compatible runtime alias for {@link setProperty}. */
export const prop = setProperty;

/** Apply the compiler's HTML class-string semantics. */
export function className(node: Element, value: unknown): void {
  if (value == null) node.removeAttribute("class");
  else (node as HTMLElement).className = String(value);
}

interface SpreadEventState {
  readonly kind: "spread-event";
  readonly source: unknown;
  readonly listener: EventListenerOrEventListenerObject;
  readonly capture: boolean;
}

function setSpreadEvent(
  node: Element,
  name: string,
  value: unknown,
  previous: unknown,
  capture: boolean,
): SpreadEventState | undefined {
  if (
    typeof previous === "object"
    && previous !== null
    && (previous as Partial<SpreadEventState>).kind === "spread-event"
    && (previous as SpreadEventState).source === value
    && (previous as SpreadEventState).capture === capture
  ) {
    return previous as SpreadEventState;
  }
  if (
    typeof previous === "object"
    && previous !== null
    && (previous as Partial<SpreadEventState>).kind === "spread-event"
  ) {
    const event = previous as SpreadEventState;
    node.removeEventListener(name, event.listener, event.capture);
  }
  if (value == null) return undefined;

  const listener: EventListenerOrEventListenerObject = Array.isArray(value)
    ? ((event: Event) => {
      const [handler, data] = value as [
        (data: unknown, event: Event) => unknown,
        unknown,
      ];
      handler.call(node, data, event);
    })
    : value as EventListenerOrEventListenerObject;
  node.addEventListener(name, listener, capture);
  return { kind: "spread-event", source: value, listener, capture };
}

const svgNamespaces: Readonly<Record<string, string>> = {
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace",
  xmlns: "http://www.w3.org/2000/xmlns/",
};

function setProp(
  node: Element,
  name: string,
  value: unknown,
  isSVG: boolean,
  previous?: unknown,
): unknown {
  if (name === "children") {
    return insert(
      node,
      value,
      null,
      previous as Node | Node[] | null | undefined ?? null,
    );
  } else if (name === "ref") {
    if (typeof value === "function" && value !== previous) {
      use(value as (element: Element) => unknown, node);
    }
  } else if (name === "style") {
    return style(node as HTMLElement, value as StyleValue, previous as StyleState);
  } else if (name === "classList") {
    return classList(
      node,
      value as ClassListValue,
      previous as Record<string, boolean> | undefined,
    );
  } else if (name === "class" || name === "className") {
    if (isSVG) setAttribute(node, "class", value);
    else className(node, value);
  } else if (name.startsWith("oncapture:")) {
    return setSpreadEvent(
      node,
      name.slice("oncapture:".length),
      value,
      previous,
      true,
    );
  } else if (name.startsWith("on:")) {
    return setSpreadEvent(
      node,
      name.slice("on:".length),
      value,
      previous,
      false,
    );
  } else if (name.startsWith("on") && name.length > 2) {
    const eventName = name.slice(2).toLowerCase();
    return setSpreadEvent(node, eventName, value, previous, false);
  } else if (!isSVG && name in node) {
    setProperty(node, name, value);
  } else {
    const colon = isSVG ? name.indexOf(":") : -1;
    const namespace = colon > 0 ? svgNamespaces[name.slice(0, colon)] : undefined;
    if (namespace === undefined) setAttribute(node, name, value);
    else setAttributeNS(node, namespace, name, value);
  }
  return value;
}

// ─── classList ────────────────────────────────────────────────────────────────

/**
 * Reactively manage classList.
 * `value` is a `{ className: boolean }` map.
 */
export function classList(
  node: Element,
  value: ClassListValue,
  prev: Record<string, boolean> = {},
): Record<string, boolean> {
  const next = value ?? {};
  for (const name of Object.keys(prev)) {
    if (!next[name]) {
      toggleClassKey(node, name, false);
      delete prev[name];
    }
  }
  for (const name of Object.keys(next)) {
    const enabled = Boolean(next[name]);
    if (enabled !== prev[name]) {
      toggleClassKey(node, name, enabled);
      if (enabled) prev[name] = true;
      else delete prev[name];
    }
  }
  return prev;
}

type ClassListValue = Record<string, boolean | null | undefined> | null | undefined;

function toggleClassKey(node: Element, key: string, enabled: boolean): void {
  for (const name of key.trim().split(/\s+/)) {
    if (name !== "") node.classList.toggle(name, enabled);
  }
}

// ─── style ────────────────────────────────────────────────────────────────────

type StylePropertyValue = string | number | null | undefined;
type StyleRecord = Record<string, StylePropertyValue>;
type StyleValue = string | StyleRecord | null | undefined;
type StyleState = string | Record<string, string> | undefined;

/** Set one inline style property using nullish removal semantics. */
export function setStyleProperty(
  node: HTMLElement,
  name: string,
  value: StylePropertyValue,
): void {
  if (value == null) node.style.removeProperty(name);
  else node.style.setProperty(name, String(value));
}

/** Reactively set inline styles and return the state for the next diff. */
export function style(
  node: HTMLElement,
  value: StyleValue,
  prev?: StyleState,
): StyleState {
  if (value == null || value === "") {
    if (prev !== undefined) setAttribute(node, "style", undefined);
    return undefined;
  }
  if (typeof value === "string") {
    node.style.cssText = value;
    return value;
  }
  if (typeof prev === "string") {
    node.style.cssText = "";
    prev = undefined;
  }
  const state = prev ?? {};
  for (const key of Object.keys(state)) {
    if (value[key] == null) {
      node.style.removeProperty(key);
      delete state[key];
    }
  }
  for (const [key, val] of Object.entries(value)) {
    if (val == null || state[key] === String(val)) continue;
    const normalized = String(val);
    node.style.setProperty(key, normalized);
    state[key] = normalized;
  }
  return state;
}

// ─── Resumable non-text expression targets ────────────────────────────────────

/**
 * Attach one resumable expression to one non-text target on a host element.
 *
 * The ordinary mutation helper is called *inside* the resumable path, so there
 * is no second DOM-mutation implementation that could drift from the ordinary
 * one on nullish removal or coercion (Decision 7 of
 * `docs/RESUMABILITY_M8C_PLAN.md`). Registration is delegated to the single
 * `observeRenderedExpressionTarget` registrar, which owns target validation and
 * installation-marker accumulation.
 */
function attachExpressionTarget<ElementType extends Element>(
  node: ElementType,
  expression: unknown,
  target: ExpressionTargetValue,
  write: (node: ElementType, value: unknown) => void,
): void {
  const resumable = inspectExpression(expression) === undefined
    ? undefined
    : expression as ResumableExpression;
  const accessor = typeof expression === "function"
    ? expression as () => unknown
    : () => expression;
  if (resumable === undefined) {
    new Computation(() => {
      write(node, accessor());
    });
    return;
  }
  const registration = {};
  new Computation(() => {
    const observed = observeRenderedExpressionTarget(
      node,
      resumable,
      registration,
      target,
      accessor,
    );
    if (observed.write) write(node, observed.value);
  });
}

/**
 * Compiler-facing helper: bind a resumable expression to one allowlisted
 * ordinary attribute.
 */
export function exprAttribute(
  node: Element,
  expression: unknown,
  name: string,
): void {
  attachExpressionTarget(
    node,
    expression,
    { kind: "attribute", name },
    (element, value) => setAttribute(element, name, value),
  );
}

/** Compiler-facing helper: bind a resumable expression to the class string. */
export function exprClass(node: Element, expression: unknown): void {
  attachExpressionTarget(
    node,
    expression,
    { kind: "class" },
    (element, value) => className(element, value),
  );
}

/**
 * Compiler-facing helper: bind a resumable expression to one allowlisted
 * inline style property.
 */
export function exprStyleProperty(
  node: HTMLElement,
  expression: unknown,
  name: string,
): void {
  attachExpressionTarget(
    node,
    expression,
    { kind: "style-property", name },
    (element, value) =>
      setStyleProperty(element, name, value as StylePropertyValue),
  );
}

/**
 * Compiler entry point for resumable non-text targets.
 *
 * Called **eagerly** from the generated `ref` callback with the host element
 * and a plain array of `[boundExpression, target]` pairs — one call per host
 * element, which is what keeps the generated code and the single
 * `data-af-expr` marker in agreement by construction. This is not a
 * dom-expressions directive and receives no accessor.
 */
export function resumeExprDirective(
  node: Element,
  pairs: ReadonlyArray<readonly [expression: unknown, target: ExpressionTargetValue]>,
): void {
  for (const [expression, target] of pairs) {
    switch (target.kind) {
      case "attribute":
        exprAttribute(node, expression, target.name);
        break;
      case "class":
        exprClass(node, expression);
        break;
      case "style-property":
        exprStyleProperty(node as HTMLElement, expression, target.name);
        break;
      case "text":
        throw new TypeError(
          "[effect-atom-jsx] A text expression target is inserted, not attached to a host element.",
        );
    }
  }
}

/**
 * Invoke a compiler-emitted ref or directive outside reactive tracking.
 *
 * Directive arguments are accessors chosen by the JSX compiler; the runtime
 * intentionally passes them through without evaluating them.
 */
export function use<ElementType extends Element>(
  fn: (element: ElementType) => unknown,
  element: ElementType,
): unknown;
export function use<ElementType extends Element, Argument>(
  fn: (element: ElementType, argument: Argument) => unknown,
  element: ElementType,
  argument: Argument,
): unknown;
export function use(
  fn: (element: Element, argument?: unknown) => unknown,
  element: Element,
  argument?: unknown,
): unknown {
  return runUntracked(() =>
    arguments.length < 3 ? fn(element) : fn(element, argument)
  );
}

// ─── Event delegation ─────────────────────────────────────────────────────────

export type RuntimeEventHandler =
  | EventListener
  | EventListenerObject
  | readonly [
    (data: unknown, event: Event) => unknown,
    unknown,
  ];

const delegatedEvents = new WeakMap<Document, Set<string>>();

/**
 * Attach an event through the compiler-facing runtime ABI.
 *
 * `babel-plugin-jsx-dom-expressions` passes `delegate = true` for delegated
 * events. Those handlers are stored on the element for the document-level
 * dispatcher instead of allocating one native listener per element.
 */
export function addEventListener(
  node: Element,
  name: string,
  handler: RuntimeEventHandler,
  delegate = false,
): void {
  const activationTargetKey = registerActivationEventTarget(
    node,
    name,
    Array.isArray(handler) ? handler[0] : handler,
  );
  if (activationTargetKey !== undefined) {
    node.setAttribute(replayTargetAttribute(name), activationTargetKey);
  }
  if (delegate) {
    const key = `$$${name}`;
    const record = node as unknown as Record<string, unknown>;
    if (Array.isArray(handler)) {
      record[key] = handler[0];
      record[`${key}Data`] = handler[1];
    } else {
      record[key] = handler;
      delete record[`${key}Data`];
    }
    return;
  }

  // The delegated branch above records `$$name` on the element, which is what
  // SSR collection reads. Non-delegated handlers have no such trace — and
  // `ServerElement.addEventListener` is a no-op — so they are registered with
  // the collection session explicitly. Off the collection path this is a
  // single `undefined` check.
  observeDirectEventHandler(node, name, handler);

  if (Array.isArray(handler)) {
    const [listener, data] = handler;
    node.addEventListener(name, function (this: Element, event) {
      listener.call(this, data, event);
    });
    return;
  }
  node.addEventListener(name, handler as EventListenerOrEventListenerObject);
}

/**
 * Set up global event delegation for the listed event names.
 * Delegated handlers are attached to `document` and use
 * the `$$eventName` property convention emitted by the JSX compiler.
 */
export function delegateEvents(events: string[], document_?: Document): void {
  const target = document_ ?? (typeof document === "undefined" ? undefined : document);
  if (target === undefined) return;

  let installed = delegatedEvents.get(target);
  if (installed === undefined) {
    installed = new Set<string>();
    delegatedEvents.set(target, installed);
  }
  for (const event of events) {
    if (!installed.has(event)) {
      installed.add(event);
      target.addEventListener(event, delegatedEventHandler);
    }
  }
}

/** Remove all delegated listeners installed by this runtime for a document. */
export function clearDelegatedEvents(document_?: Document): void {
  const target = document_ ?? (typeof document === "undefined" ? undefined : document);
  if (target === undefined) return;

  const installed = delegatedEvents.get(target);
  if (installed === undefined) return;
  for (const event of installed) {
    target.removeEventListener(event, delegatedEventHandler);
  }
  delegatedEvents.delete(target);
}

function delegatedEventHandler(e: Event): void {
  const key = `$$${e.type}`;
  const dataKey = `${key}Data`;
  const composedPath = typeof e.composedPath === "function" ? e.composedPath() : [];
  const path: EventTarget[] = composedPath.length > 0
    ? [...composedPath]
    : [];

  if (path.length === 0) {
    let current = e.target as (EventTarget & {
      readonly parentNode?: EventTarget | null;
      readonly parentElement?: EventTarget | null;
      readonly host?: EventTarget | null;
    }) | null;
    while (current !== null) {
      path.push(current);
      current = current.parentNode ?? current.parentElement ?? current.host ?? null;
    }
  }

  let currentTarget: EventTarget | null = null;
  const previousCurrentTarget = Object.getOwnPropertyDescriptor(e, "currentTarget");
  let patchedCurrentTarget = false;
  try {
    Object.defineProperty(e, "currentTarget", {
      configurable: true,
      get: () => currentTarget,
    });
    patchedCurrentTarget = true;
  } catch {
    // Some custom Event implementations expose a non-configurable property.
  }

  try {
    for (const target of path) {
      const node = target as Element;
      currentTarget = target;
      const record = node as unknown as Record<string, unknown>;
      const handler = record[key] as EventListener | EventListenerObject | undefined;
      if (handler === undefined || record.disabled === true) continue;

      const data = record[dataKey];
      if (typeof handler === "function") {
        if (dataKey in record) {
          (handler as unknown as (data: unknown, event: Event) => unknown).call(node, data, e);
        } else {
          handler.call(node, e);
        }
      } else {
        handler.handleEvent(e);
      }
      if (e.cancelBubble) return;
    }
  } finally {
    currentTarget = null;
    if (patchedCurrentTarget) {
      if (previousCurrentTarget === undefined) {
        delete (e as unknown as Record<string, unknown>).currentTarget;
      } else {
        Object.defineProperty(e, "currentTarget", previousCurrentTarget);
      }
    }
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
  // Ensure remounts (including HMR) don't duplicate old DOM content.
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  let dispose!: () => void;
  createRoot((d) => {
    onCleanup(() => {
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    });

    dispose = d;
    insert(container, fn as () => Child);
  });
  return dispose;
}

export interface ViteHotContext {
  readonly data: Record<string, unknown>;
  accept(cb?: () => void): void;
  dispose(cb: (data: Record<string, unknown>) => void): void;
}

/**
 * Register a dispose handler with Vite HMR and auto-dispose the previous mount.
 */
export function withViteHMR(
  dispose: () => void,
  hot?: ViteHotContext,
  key = "effect-atom-jsx:dispose",
): () => void {
  if (!hot) return dispose;

  const previous = hot.data[key] as (() => void) | undefined;
  previous?.();
  hot.data[key] = dispose;

  hot.accept();
  hot.dispose((data) => {
    dispose();
    delete data[key];
  });

  return dispose;
}

/**
 * Render helper that wires dispose lifecycle to Vite HMR automatically.
 */
export function renderWithHMR(
  fn: () => unknown,
  container: Element,
  hot?: ViteHotContext,
  key = "effect-atom-jsx:dispose",
): () => void {
  return withViteHMR(render(fn, container), hot, key);
}

// ─── effect / memo re-exports (used by compiled JSX output) ──────────────────
// The babel-compiled output imports `effect` and `memo` from the runtime module.
// We proxy them here so the runtime module is self-contained.

export { createEffect as effect, createMemo as memo, untrack, sample, batch, createRoot as root, getOwner, runWithOwner, mergeProps } from "./api.js";

// ─── SSR support ──────────────────────────────────────────────────────────────

/**
 * `true` when running in a server environment (no `window` or `document`).
 */
export const isServer: boolean =
  typeof window === "undefined" || typeof document === "undefined";

// ─── Virtual DOM for SSR ──────────────────────────────────────────────────────

/** Minimal attributes map. */
type Attrs = Record<string, string>;

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Escape HTML special chars in text content and attribute values. */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Base class for server-side virtual DOM nodes.
 */
class ServerNode {
  nodeName = "#node";
  childNodes: ServerNode[] = [];
  parentNode: ServerNode | null = null;
  textContent = "";
  nextSibling: ServerNode | null = null;

  get firstChild(): ServerNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): ServerNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  appendChild(child: ServerNode): ServerNode {
    child.parentNode = this;
    this.childNodes.push(child);
    this._updateSiblings();
    return child;
  }

  insertBefore(newChild: ServerNode, ref: ServerNode | null): ServerNode {
    if (ref == null) return this.appendChild(newChild);
    const idx = this.childNodes.indexOf(ref);
    if (idx === -1) return this.appendChild(newChild);
    newChild.parentNode = this;
    this.childNodes.splice(idx, 0, newChild);
    this._updateSiblings();
    return newChild;
  }

  removeChild(child: ServerNode): ServerNode {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
      this._updateSiblings();
    }
    return child;
  }

  replaceChild(newChild: ServerNode, oldChild: ServerNode): ServerNode {
    const idx = this.childNodes.indexOf(oldChild);
    if (idx !== -1) {
      newChild.parentNode = this;
      oldChild.parentNode = null;
      this.childNodes.splice(idx, 1, newChild);
      this._updateSiblings();
    }
    return oldChild;
  }

  remove(): void {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  cloneNode(deep?: boolean): ServerNode {
    const clone = new ServerNode();
    clone.nodeName = this.nodeName;
    clone.textContent = this.textContent;
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  /** Serialize this node subtree to an HTML string. */
  toHTML(): string {
    return this.childNodes.map((c) => c.toHTML()).join("");
  }

  private _updateSiblings(): void {
    for (let i = 0; i < this.childNodes.length; i++) {
      this.childNodes[i].nextSibling = this.childNodes[i + 1] ?? null;
    }
  }
}

/**
 * Virtual DOM element for SSR.
 */
class ServerElement extends ServerNode {
  private _attrs: Attrs = {};
  private _style: Record<string, string> = {};
  private _classList: Set<string> = new Set();

  constructor(public override nodeName: string) {
    super();
  }

  setAttribute(name: string, value: string): void {
    this._attrs[name] = value;
  }

  setAttributeNS(_namespace: string, name: string, value: string): void {
    this.setAttribute(name, value);
  }

  removeAttribute(name: string): void {
    delete this._attrs[name];
  }

  removeAttributeNS(_namespace: string, name: string): void {
    this.removeAttribute(name);
  }

  getAttribute(name: string): string | null {
    return this._attrs[name] ?? null;
  }

  get className(): string {
    return this._attrs["class"] ?? "";
  }

  set className(val: string) {
    if (val) this._attrs["class"] = val;
    else delete this._attrs["class"];
  }

  get classList() {
    const self = this;
    return {
      add(name: string) { self._classList.add(name); self._syncClassList(); },
      remove(name: string) { self._classList.delete(name); self._syncClassList(); },
      toggle(name: string, force?: boolean) {
        if (force === undefined) {
          if (self._classList.has(name)) self._classList.delete(name);
          else self._classList.add(name);
        } else if (force) self._classList.add(name);
        else self._classList.delete(name);
        self._syncClassList();
      },
      contains(name: string) { return self._classList.has(name); },
    };
  }

  private _syncClassList(): void {
    const existing = this._attrs["class"]?.split(/\s+/).filter(Boolean) ?? [];
    const merged = new Set([...existing, ...this._classList]);
    if (merged.size > 0) this._attrs["class"] = [...merged].join(" ");
    else delete this._attrs["class"];
  }

  get style(): Record<string, unknown> & { cssText: string; setProperty: (k: string, v: string) => void; removeProperty: (k: string) => void } {
    const self = this;
    const proxy: Record<string, unknown> = {};
    return Object.assign(proxy, {
      get cssText() {
        return Object.entries(self._style).map(([k, v]) => `${k}: ${v}`).join("; ");
      },
      set cssText(val: string) {
        self._style = {};
        if (!val) return;
        for (const part of val.split(";")) {
          const colon = part.indexOf(":");
          if (colon === -1) continue;
          const k = part.slice(0, colon).trim();
          const v = part.slice(colon + 1).trim();
          if (k) self._style[k] = v;
        }
      },
      setProperty(k: string, v: string) { self._style[k] = v; },
      removeProperty(k: string) { delete self._style[k]; },
    });
  }

  addEventListener(): void { /* no-op on server */ }
  removeEventListener(): void { /* no-op on server */ }

  override cloneNode(deep?: boolean): ServerElement {
    const clone = new ServerElement(this.nodeName);
    clone._attrs = { ...this._attrs };
    clone._style = { ...this._style };
    clone._classList = new Set(this._classList);
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  override toHTML(): string {
    const tag = this.nodeName.toLowerCase();
    let attrStr = "";
    // Merge inline style into attrs for serialisation
    const styleStr = Object.entries(this._style).map(([k, v]) => `${k}: ${v}`).join("; ");
    const attrs = { ...this._attrs };
    if (styleStr) attrs["style"] = styleStr;
    Object.assign(attrs, observeServerEventTarget(this));

    for (const [k, v] of Object.entries(attrs)) {
      attrStr += ` ${k}="${escapeHTML(v)}"`;
    }

    if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrStr}>`;

    const inner = this.childNodes.map((c) => c.toHTML()).join("");
    return `<${tag}${attrStr}>${inner}</${tag}>`;
  }
}

/**
 * Virtual DOM text node for SSR.
 */
class ServerTextNode extends ServerNode {
  override nodeName = "#text";

  constructor(public override textContent: string) {
    super();
  }

  override cloneNode(): ServerTextNode {
    return new ServerTextNode(this.textContent);
  }

  override toHTML(): string {
    return escapeHTML(this.textContent);
  }
}

/**
 * Virtual DOM document fragment for SSR.
 */
class ServerDocumentFragment extends ServerNode {
  override nodeName = "#document-fragment";

  override cloneNode(deep?: boolean): ServerDocumentFragment {
    const clone = new ServerDocumentFragment();
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }
}

/** Simple HTML parser — turns an HTML string into ServerElement nodes. */
function parseHTML(html: string): ServerNode[] {
  const nodes: ServerNode[] = [];
  let pos = 0;

  function parseNodes(stop?: string): ServerNode[] {
    const result: ServerNode[] = [];
    while (pos < html.length) {
      if (stop && html.startsWith(stop, pos)) {
        pos += stop.length;
        return result;
      }
      if (html[pos] === "<") {
        if (html[pos + 1] === "/") {
          // Closing tag — handled by caller via stop
          return result;
        }
        const el = parseElement();
        if (el) result.push(el);
      } else {
        const nextTag = html.indexOf("<", pos);
        const text = nextTag === -1 ? html.slice(pos) : html.slice(pos, nextTag);
        pos = nextTag === -1 ? html.length : nextTag;
        if (text) result.push(new ServerTextNode(text));
      }
    }
    return result;
  }

  function parseElement(): ServerElement | null {
    // Skip '<'
    pos++;
    const tagEnd = html.slice(pos).search(/[\s/>]/);
    if (tagEnd === -1) return null;
    const tagName = html.slice(pos, pos + tagEnd);
    pos += tagEnd;

    const el = new ServerElement(tagName.toUpperCase());

    // Parse attributes
    while (pos < html.length) {
      // Skip whitespace
      while (pos < html.length && /\s/.test(html[pos])) pos++;

      if (html[pos] === "/" && html[pos + 1] === ">") {
        pos += 2;
        return el;
      }
      if (html[pos] === ">") {
        pos++;
        break;
      }

      // Attribute name
      const attrNameEnd = html.slice(pos).search(/[\s=/>]/);
      if (attrNameEnd <= 0) { pos++; continue; }
      const attrName = html.slice(pos, pos + attrNameEnd);
      pos += attrNameEnd;

      // Skip whitespace
      while (pos < html.length && /\s/.test(html[pos])) pos++;

      if (html[pos] === "=") {
        pos++; // skip '='
        while (pos < html.length && /\s/.test(html[pos])) pos++;
        if (html[pos] === '"' || html[pos] === "'") {
          const quote = html[pos];
          pos++;
          const valEnd = html.indexOf(quote, pos);
          const val = valEnd === -1 ? "" : html.slice(pos, valEnd);
          pos = valEnd === -1 ? html.length : valEnd + 1;
          el.setAttribute(attrName, val);
        } else {
          const valEnd = html.slice(pos).search(/[\s>]/);
          const val = valEnd === -1 ? html.slice(pos) : html.slice(pos, pos + valEnd);
          pos = valEnd === -1 ? html.length : pos + valEnd;
          el.setAttribute(attrName, val);
        }
      } else {
        el.setAttribute(attrName, "");
      }
    }

    if (VOID_ELEMENTS.has(tagName.toLowerCase())) return el;

    // Parse children
    const children = parseNodes();
    for (const child of children) el.appendChild(child);

    // Skip closing tag
    const closeTag = `</${tagName}>`;
    const closeLower = `</${tagName.toLowerCase()}>`;
    if (html.startsWith(closeTag, pos) || html.startsWith(closeLower, pos)) {
      pos += closeTag.length;
    }

    return el;
  }

  nodes.push(...parseNodes());
  return nodes;
}

/**
 * Create a mock `document` object for server-side rendering.
 */
function createServerDocument(): unknown {
  const doc = {
    createElement(tag: string): ServerElement {
      return new ServerElement(tag.toUpperCase());
    },
    createTextNode(text: string): ServerTextNode {
      return new ServerTextNode(text);
    },
    createDocumentFragment(): ServerDocumentFragment {
      return new ServerDocumentFragment();
    },
    addEventListener(): void { /* no-op */ },
    removeEventListener(): void { /* no-op */ },
    querySelector(): null { return null; },
    querySelectorAll(): never[] { return []; },
    createComment(text: string): ServerTextNode {
      // Approximate comments as empty text nodes (they act as markers)
      const n = new ServerTextNode("");
      n.nodeName = "#comment";
      (n as unknown as Record<string, string>)._commentText = text;
      n.toHTML = () => `<!--${text}-->`;
      return n;
    },
  };
  return doc;
}

// Module-level SSR state
let _ssrMode = false;
let _serverDoc: unknown = null;

function serverValueToHTML(value: unknown): string {
  if (value instanceof ServerNode) {
    return value.toHTML();
  }
  if (Array.isArray(value)) {
    return value.map(serverValueToHTML).join("");
  }
  return value == null ? "" : String(value);
}

/**
 * Render a component tree to an HTML string on the server.
 *
 * Temporarily replaces the global `document` with a virtual DOM implementation,
 * runs the component function inside a reactive root, serialises the resulting
 * virtual tree to HTML, and restores the original state.
 *
 * @param fn - A zero-argument function that returns a component tree (the same
 *   function you would pass to `render()` on the client).
 * @returns The rendered HTML string.
 *
 * @example
 * ```ts
 * const html = renderToString(() => <App />);
 * res.send(`<!DOCTYPE html><html><body>${html}</body></html>`);
 * ```
 */
export function renderToString(fn: () => unknown): string {
  const prevSSR = _ssrMode;
  const prevDoc = _serverDoc;
  const origDocument = typeof globalThis.document !== "undefined" ? globalThis.document : undefined;
  const origNode = typeof globalThis.Node !== "undefined" ? globalThis.Node : undefined;
  let dispose: (() => void) | undefined;

  try {
    _ssrMode = true;
    const serverDoc = createServerDocument();
    _serverDoc = serverDoc;

    // Temporarily install the server document as the global `document` so
    // that existing functions (template, insert, toNode, etc.) work as-is.
    (globalThis as Record<string, unknown>).document = serverDoc;

    // Also patch `Node` so that `instanceof Node` checks work with virtual nodes.
    (globalThis as Record<string, unknown>).Node = ServerNode as unknown;

    let result: unknown;

    createRoot((d) => {
      dispose = d;
      result = fn();
    });

    return serverValueToHTML(result);
  } finally {
    try {
      // Dispose on both success and failure; SSR only needs one snapshot.
      dispose?.();
    } finally {
      _ssrMode = prevSSR;
      _serverDoc = prevDoc;
      if (origNode !== undefined) {
        (globalThis as Record<string, unknown>).Node = origNode;
      } else {
        delete (globalThis as Record<string, unknown>).Node;
      }
      if (origDocument !== undefined) {
        (globalThis as Record<string, unknown>).document = origDocument;
      } else {
        delete (globalThis as Record<string, unknown>).document;
      }
    }
  }
}

// ─── Hydration ────────────────────────────────────────────────────────────────

/** Module-level hydration state. */
let _hydrating = false;
let _hydrateWalker: { node: Node | null } | null = null;

/**
 * Returns `true` when the runtime is currently hydrating server-rendered HTML.
 */
export function isHydrating(): boolean {
  return _hydrating;
}

/**
 * Advance the hydration walker to the next DOM node, returning the current one.
 * Components and `insert()` call this during hydration instead of creating
 * new DOM nodes.
 */
export function getNextHydrateNode(): Node | null {
  if (!_hydrateWalker) return null;
  const current = _hydrateWalker.node;
  if (current) {
    _hydrateWalker.node = current.nextSibling;
  }
  return current;
}

/**
 * Hydrate server-rendered HTML inside `container`.
 *
 * Instead of creating new DOM nodes, the reactive runtime attaches bindings
 * to the existing children that were rendered on the server via
 * `renderToString`.
 *
 * @param fn - The same component function used in `renderToString`.
 * @param container - The DOM element that contains the server-rendered HTML.
 * @returns A dispose function that tears down all reactive subscriptions.
 *
 * @example
 * ```ts
 * const dispose = hydrateRoot(() => <App />, document.getElementById("root")!);
 * ```
 */
export function hydrateRoot(
  fn: () => unknown,
  container: Element,
): () => void {
  const prevHydrating = _hydrating;
  const prevWalker = _hydrateWalker;

  _hydrating = true;
  _hydrateWalker = { node: container.firstChild };

  let dispose!: () => void;

  try {
    createRoot((d) => {
      dispose = d;
      insert(container, fn as () => Child, null, Array.from(container.childNodes) as unknown as Node[]);
    });
  } finally {
    _hydrating = prevHydrating;
    _hydrateWalker = prevWalker;
  }

  return dispose;
}

// ─── Request event context (SSR) ─────────────────────────────────────────────

let _requestEvent: unknown | undefined;

/**
 * Retrieve the current SSR request context.
 *
 * During server-side rendering, framework integrations can call
 * `setRequestEvent()` to store request metadata (headers, URL, cookies, etc.)
 * that components can access synchronously via `getRequestEvent()`.
 *
 * @returns The current request event, or `undefined` outside of an SSR pass.
 */
export function getRequestEvent(): unknown | undefined {
  return _requestEvent;
}

/**
 * Set the SSR request context.
 *
 * Call this before `renderToString()` to make request information available
 * to components during server-side rendering.
 *
 * @param event - An arbitrary request context object (e.g., a `Request`,
 *   framework-specific event, or custom object with headers/cookies).
 */
export function setRequestEvent(event: unknown): void {
  _requestEvent = event;
}
