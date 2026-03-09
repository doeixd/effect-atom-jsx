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

  removeAttribute(name: string): void {
    delete this._attrs[name];
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

  try {
    _ssrMode = true;
    const serverDoc = createServerDocument();
    _serverDoc = serverDoc;

    // Temporarily install the server document as the global `document` so
    // that existing functions (template, insert, toNode, etc.) work as-is.
    (globalThis as Record<string, unknown>).document = serverDoc;

    // Also patch `Node` so that `instanceof Node` checks work with virtual nodes.
    const origNode = typeof globalThis.Node !== "undefined" ? globalThis.Node : undefined;
    (globalThis as Record<string, unknown>).Node = ServerNode as unknown;

    let result: unknown;
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;
      result = fn();
    });

    let html = "";
    if (result instanceof ServerNode) {
      html = (result as ServerNode).toHTML();
    } else if (Array.isArray(result)) {
      html = (result as unknown[])
        .map((r) => (r instanceof ServerNode ? (r as ServerNode).toHTML() : String(r ?? "")))
        .join("");
    } else if (result != null) {
      html = String(result);
    }

    // Dispose the reactive root — we only needed a single snapshot.
    dispose?.();

    // Restore Node
    if (origNode !== undefined) {
      (globalThis as Record<string, unknown>).Node = origNode;
    } else {
      delete (globalThis as Record<string, unknown>).Node;
    }

    return html;
  } finally {
    _ssrMode = prevSSR;
    _serverDoc = prevDoc;
    if (origDocument !== undefined) {
      (globalThis as Record<string, unknown>).document = origDocument;
    } else {
      delete (globalThis as Record<string, unknown>).document;
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
