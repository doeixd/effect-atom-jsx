/**
 * A minimal DOM stand-in for the `future/streaming/` specs.
 *
 * The main suite (`src/__tests__/resume.test.ts`) grows a bespoke fake per
 * test; the streaming specs need one shared model because they all have to
 * install over a *growing* document — regions appear after the installation
 * exists. So this one supports mutation (insertBefore/removeChild), a real
 * tree walk for `querySelectorAll("[attr]")`, comment markers, and capture-
 * phase dispatch with a `composedPath`.
 *
 * Deliberately src-free: this module must never import `../../src/**`, or the
 * whole file would abort at collection time when an API is missing (see
 * `future/README.md` rule 2).
 */

export interface FakeEventRecord {
  readonly type: string;
  readonly targetName: string;
}

export class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  textContent: string | null = null;
  data?: string;
  readonly attributes = new Map<string, string>();

  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes;
    if (siblings === undefined) return null;
    const index = siblings.indexOf(this);
    return index < 0 ? null : siblings[index + 1] ?? null;
  }

  get previousSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes;
    if (siblings === undefined) return null;
    const index = siblings.indexOf(this);
    return index <= 0 ? null : siblings[index - 1] ?? null;
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): FakeNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  appendChild(child: FakeNode): FakeNode {
    child.parentNode?.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }

  insertBefore(child: FakeNode, reference: FakeNode | null): FakeNode {
    child.parentNode?.removeChild(child);
    if (reference === null) return this.appendChild(child);
    const index = this.childNodes.indexOf(reference);
    if (index < 0) {
      throw new Error(`insertBefore: reference node is not a child.`);
    }
    this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild(child: FakeNode): FakeNode {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error("removeChild: node is not a child.");
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  replaceChild(next: FakeNode, previous: FakeNode): FakeNode {
    const index = this.childNodes.indexOf(previous);
    if (index < 0) throw new Error("replaceChild: node is not a child.");
    this.childNodes.splice(index, 1, next);
    next.parentNode = this;
    previous.parentNode = null;
    return previous;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  /** Every descendant, document order, self excluded. */
  descendants(): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (node: FakeNode): void => {
      for (const child of node.childNodes) {
        out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  /** Comment markers in this subtree, document order. */
  comments(): FakeNode[] {
    return this.descendants().filter((node) => node.nodeType === 8);
  }

  /** Concatenated text of this subtree, so specs can assert flushed content. */
  text(): string {
    if (this.nodeType === 3) return this.textContent ?? "";
    return this.childNodes.map((child) => child.text()).join("");
  }
}

export class FakeDocument extends FakeNode {
  private readonly listeners = new Map<
    string,
    Set<{ readonly listener: (event: unknown) => void; readonly capture: boolean }>
  >();

  readonly dispatched: FakeEventRecord[] = [];

  constructor() {
    super(9, "#document", undefined as unknown as FakeDocument);
    (this as { ownerDocument: FakeDocument }).ownerDocument = this;
  }

  createElement(tagName: string): FakeNode {
    return new FakeNode(1, tagName.toUpperCase(), this);
  }

  createComment(data: string): FakeNode {
    const node = new FakeNode(8, "#comment", this);
    node.data = data;
    node.textContent = data;
    return node;
  }

  createTextNode(value: string): FakeNode {
    const node = new FakeNode(3, "#text", this);
    node.textContent = value;
    return node;
  }

  createDocumentFragment(): FakeNode {
    return new FakeNode(11, "#document-fragment", this);
  }

  querySelectorAll(selector: string): FakeNode[] {
    const all = this.descendants().filter((node) => node.nodeType === 1);
    if (selector === "*") return all;
    if (selector.startsWith("[") && selector.endsWith("]")) {
      const attribute = selector.slice(1, -1);
      return all.filter((node) => node.getAttribute(attribute) !== null);
    }
    return [];
  }

  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: boolean | { readonly capture?: boolean },
  ): void {
    const capture =
      options === true || (typeof options === "object" && options?.capture === true);
    let bucket = this.listeners.get(type);
    if (bucket === undefined) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    bucket.add({ listener, capture });
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    const bucket = this.listeners.get(type);
    if (bucket === undefined) return;
    for (const entry of bucket) {
      if (entry.listener === listener) bucket.delete(entry);
    }
    if (bucket.size === 0) this.listeners.delete(type);
  }

  /** True when *something* is listening for `type` in the capture phase. */
  listensInCapture(type: string): boolean {
    const bucket = this.listeners.get(type);
    return bucket !== undefined && [...bucket].some((entry) => entry.capture);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  /** Dispatch `type` at `target`, with a composed path up to the document. */
  dispatch(type: string, target: FakeNode): void {
    this.dispatched.push({ type, targetName: target.nodeName });
    const path: FakeNode[] = [];
    for (let node: FakeNode | null = target; node !== null; node = node.parentNode) {
      path.push(node);
    }
    const event = {
      type,
      target,
      currentTarget: this,
      cancelBubble: false,
      defaultPrevented: false,
      preventDefault: () => {},
      stopPropagation: () => {},
      composedPath: () => path,
    };
    for (const entry of [...(this.listeners.get(type) ?? [])]) {
      entry.listener(event as unknown);
    }
  }
}

/** Declarative marker/element spec, so specs read as the HTML they stand for. */
export type FakeMarkup =
  | { readonly kind: "component"; readonly id: string; readonly edge: "start" | "end" }
  | { readonly kind: "expr"; readonly id: string; readonly edge: "start" | "end" }
  | { readonly kind: "region"; readonly id: string; readonly edge: "start" | "end" }
  | { readonly kind: "text"; readonly value: string }
  | {
      readonly kind: "element";
      readonly tag?: string;
      readonly attributes: Readonly<Record<string, string>>;
      readonly children?: ReadonlyArray<FakeMarkup>;
    };

function markerData(
  kind: "component" | "expr" | "region",
  id: string,
  edge: "start" | "end",
): string {
  return `af:${kind}:${id}:${edge}`;
}

function build(doc: FakeDocument, markup: FakeMarkup): FakeNode {
  switch (markup.kind) {
    case "text":
      return doc.createTextNode(markup.value);
    case "element": {
      const element = doc.createElement(markup.tag ?? "div");
      for (const [name, value] of Object.entries(markup.attributes)) {
        element.setAttribute(name, value);
      }
      for (const child of markup.children ?? []) {
        element.appendChild(build(doc, child));
      }
      return element;
    }
    default:
      return doc.createComment(markerData(markup.kind, markup.id, markup.edge));
  }
}

/** Build a whole document from markup. */
export function fakeDocument(markup: ReadonlyArray<FakeMarkup>): FakeDocument {
  const doc = new FakeDocument();
  for (const item of markup) doc.appendChild(build(doc, item));
  return doc;
}

/** Append markup to a live document — a streamed flush arriving late. */
export function appendMarkup(
  doc: FakeDocument,
  markup: ReadonlyArray<FakeMarkup>,
  parent: FakeNode = doc,
): FakeNode[] {
  return markup.map((item) => parent.appendChild(build(doc, item)));
}

/** Insert markup between an existing comment pair — an out-of-order swap. */
export function fillRegion(
  doc: FakeDocument,
  regionId: string,
  markup: ReadonlyArray<FakeMarkup>,
): FakeNode[] {
  const end = doc
    .comments()
    .find((node) => node.data === markerData("region", regionId, "end"));
  if (end === undefined) {
    throw new Error(`No region "${regionId}" to fill.`);
  }
  const parent = end.parentNode;
  if (parent === null) throw new Error("Region end marker is detached.");
  return markup.map((item) => parent.insertBefore(build(doc, item), end));
}

/** Remove everything a region encloses, plus its markers. */
export function removeRegion(doc: FakeDocument, regionId: string): void {
  const comments = doc.comments();
  const start = comments.find(
    (node) => node.data === markerData("region", regionId, "start"),
  );
  const end = comments.find(
    (node) => node.data === markerData("region", regionId, "end"),
  );
  if (start === undefined || end === undefined) {
    throw new Error(`No region "${regionId}" to remove.`);
  }
  const parent = start.parentNode;
  if (parent === null || parent !== end.parentNode) {
    throw new Error("Region markers do not share a parent.");
  }
  const from = parent.childNodes.indexOf(start);
  const to = parent.childNodes.indexOf(end);
  for (const node of parent.childNodes.slice(from, to + 1)) {
    parent.removeChild(node);
  }
}

/** The first element carrying `attribute`, for dispatching at. */
export function elementWith(doc: FakeDocument, attribute: string): FakeNode {
  const found = doc.querySelectorAll(`[${attribute}]`)[0];
  if (found === undefined) {
    throw new Error(`No element carries "${attribute}".`);
  }
  return found;
}

/** Cast helpers, kept in one place so the specs stay readable. */
export function asDocument(doc: FakeDocument): Document {
  return doc as unknown as Document;
}
