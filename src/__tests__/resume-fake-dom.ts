/**
 * Renderer-neutral fake DOM shared by the promoted resumability regression tests (from `future/resumability/fake-dom.ts`).
 *
 * Deliberately imports nothing from `src/`: the `future/` contract forbids
 * module-scope source imports, and a helper file is loaded at module scope by
 * every spec file that uses it. The one piece of protocol vocabulary it needs
 * (the installation-only element marker attribute) is passed in by the caller,
 * which reads it from `Resume.ExpressionElementMarkerAttribute` inside the spec
 * body.
 *
 * The shapes mirror the fakes in `src/__tests__/resume.test.ts` (flat sibling
 * list, `nodeType`/`nodeName`/`data`/`nextSibling`/`parentNode`) so a spec that
 * goes green here can be promoted into that suite with minimal edits, and adds
 * what non-text targets need: real `Element`-shaped nodes carrying attributes,
 * a class string, and a style declaration.
 */

export interface FakeStyleDeclaration {
  readonly properties: Map<string, string>;
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): string;
  getPropertyValue(name: string): string;
}

export interface FakeNode {
  nodeType: number;
  nodeName: string;
  data?: string;
  textContent?: string | null;
  childNodes: FakeNode[];
  parentNode: unknown;
  nextSibling: FakeNode | null;
  ownerDocument?: unknown;
  attributes?: Map<string, string>;
  className?: string;
  style?: FakeStyleDeclaration;
  getAttribute?: (name: string) => string | null;
  getAttributeNames?: () => Array<string>;
  setAttribute?: (name: string, value: string) => void;
  removeAttribute?: (name: string) => void;
  hasAttribute?: (name: string) => boolean;
}

function makeStyle(): FakeStyleDeclaration {
  const properties = new Map<string, string>();
  return {
    properties,
    setProperty(name, value) {
      properties.set(name, value);
    },
    removeProperty(name) {
      const previous = properties.get(name) ?? "";
      properties.delete(name);
      return previous;
    },
    getPropertyValue(name) {
      return properties.get(name) ?? "";
    },
  };
}

export type MarkerSpec =
  | { readonly kind: "component"; readonly id: string; readonly edge: "start" | "end" }
  | { readonly kind: "expression"; readonly id: string; readonly edge: "start" | "end" }
  | { readonly kind: "text"; readonly value: string }
  | {
      /**
       * An SSR element carrying zero or more resumable non-text targets. When
       * `expressions` is non-empty the element receives the installation-only
       * marker attribute.
       */
      readonly kind: "element";
      readonly name?: string;
      readonly expressions?: ReadonlyArray<string>;
      readonly attributes?: Readonly<Record<string, string>>;
      readonly className?: string;
      readonly style?: Readonly<Record<string, string>>;
      /** Make `removeAttribute` throw, to exercise marker-cleanup rollback. */
      readonly removeAttributeError?: string;
    };

/**
 * A flat fake document: every node is a direct child, which is exactly what
 * component-boundary containment (`start.nextSibling … end`) and the
 * `childNodes` scan fallback need.
 */
export class FakeDocument {
  readonly childNodes: FakeNode[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(
    markers: ReadonlyArray<MarkerSpec>,
    /** Usually `Resume.ExpressionElementMarkerAttribute`. */
    readonly markerAttribute = "data-af-expr",
  ) {
    for (const marker of markers) {
      switch (marker.kind) {
        case "text":
          this.childNodes.push(this.createTextNode(marker.value));
          break;
        case "element":
          this.childNodes.push(this.makeElement(marker));
          break;
        default:
          this.childNodes.push(
            this.comment(
              `af:${marker.kind === "component" ? "component" : "expr"}:${marker.id}:${marker.edge}`,
            ),
          );
      }
    }
    this.relink();
  }

  comment(data: string): FakeNode {
    return {
      nodeType: 8,
      nodeName: "#comment",
      data,
      textContent: data,
      childNodes: [],
      parentNode: this,
      nextSibling: null,
      ownerDocument: this,
    };
  }

  createTextNode(value: string): FakeNode {
    return {
      nodeType: 3,
      nodeName: "#text",
      textContent: value,
      childNodes: [],
      parentNode: this,
      nextSibling: null,
      ownerDocument: this,
    };
  }

  makeElement(
    spec: Extract<MarkerSpec, { readonly kind: "element" }>,
  ): FakeNode {
    const attributes = new Map<string, string>(
      Object.entries(spec.attributes ?? {}),
    );
    const expressions = spec.expressions ?? [];
    if (expressions.length > 0) {
      attributes.set(this.markerAttribute, expressions.join(" "));
    }
    const style = makeStyle();
    for (const [name, value] of Object.entries(spec.style ?? {})) {
      style.setProperty(name, value);
    }
    const element: FakeNode = {
      nodeType: 1,
      nodeName: (spec.name ?? "div").toUpperCase(),
      childNodes: [],
      parentNode: this,
      nextSibling: null,
      ownerDocument: this,
      attributes,
      className: spec.className ?? "",
      style,
      getAttribute: (name) => attributes.get(name) ?? null,
      getAttributeNames: () => [...attributes.keys()],
      hasAttribute: (name) => attributes.has(name),
      setAttribute: (name, value) => {
        attributes.set(name, value);
        if (name === "class") element.className = value;
      },
      removeAttribute: (name) => {
        if (spec.removeAttributeError !== undefined) {
          throw new Error(spec.removeAttributeError);
        }
        attributes.delete(name);
        if (name === "class") element.className = "";
      },
    };
    return element;
  }

  insertBefore(node: FakeNode, reference: FakeNode | null): FakeNode {
    const index = reference === null
      ? this.childNodes.length
      : this.childNodes.indexOf(reference);
    if (index < 0) throw new Error("Reference node is not in the fake root.");
    this.childNodes.splice(index, 0, node);
    this.relink();
    return node;
  }

  removeChild(node: FakeNode): FakeNode {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error("Node is not in the fake root.");
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    node.nextSibling = null;
    this.relink();
    return node;
  }

  replaceChild(node: FakeNode, child: FakeNode): FakeNode {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error("Node is not in the fake root.");
    this.childNodes.splice(index, 1, node);
    child.parentNode = null;
    child.nextSibling = null;
    this.relink();
    return child;
  }

  querySelectorAll(selector: string): ReadonlyArray<FakeNode> {
    const elements = this.childNodes.filter((node) => node.nodeType === 1);
    if (selector === "*") return elements;
    const attribute = selector.replace(/^\[|\]$/g, "");
    return elements.filter(
      (element) => element.getAttribute?.(attribute) != null,
    );
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  dispatchPath(type: string, path: ReadonlyArray<FakeNode>): void {
    const event = {
      type,
      target: path[0],
      composedPath: () => [...path, this],
      preventDefault: () => {},
      stopPropagation: () => {},
      stopImmediatePropagation: () => {},
      button: 0,
      clientX: 0,
      clientY: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener.call(this, event);
    }
  }

  /** The element carrying (or that carried) the given expression's marker. */
  element(index = 0): FakeNode {
    const elements = this.childNodes.filter((node) => node.nodeType === 1);
    const found = elements[index];
    if (found === undefined) {
      throw new Error(`No fake element at index ${index}.`);
    }
    return found;
  }

  /** Concatenated text of one durable comment-pair expression region. */
  regionText(expressionId: string): string {
    const startIndex = this.childNodes.findIndex(
      (node) =>
        node.nodeType === 8 && node.data === `af:expr:${expressionId}:start`,
    );
    const endIndex = this.childNodes.findIndex(
      (node) =>
        node.nodeType === 8 && node.data === `af:expr:${expressionId}:end`,
    );
    if (startIndex < 0 || endIndex < 0) {
      throw new Error(`Expression region "${expressionId}" is missing.`);
    }
    return this.childNodes
      .slice(startIndex + 1, endIndex)
      .map((node) => node.textContent ?? "")
      .join("");
  }

  regionNodes(expressionId: string): ReadonlyArray<FakeNode> {
    const startIndex = this.childNodes.findIndex(
      (node) =>
        node.nodeType === 8 && node.data === `af:expr:${expressionId}:start`,
    );
    const endIndex = this.childNodes.findIndex(
      (node) =>
        node.nodeType === 8 && node.data === `af:expr:${expressionId}:end`,
    );
    return this.childNodes.slice(startIndex + 1, endIndex);
  }

  asDocument(): any {
    return this as unknown as any;
  }

  private relink(): void {
    for (let index = 0; index < this.childNodes.length; index += 1) {
      const node = this.childNodes[index]!;
      node.parentNode = this;
      node.nextSibling = this.childNodes[index + 1] ?? null;
    }
  }
}

/**
 * The canonical fixture shape for the non-text vertical slice: one component
 * region containing one durable text expression region and one marked element
 * carrying the supplied non-text expression instances.
 */
export function nonTextFixture(options: {
  readonly markerAttribute: string;
  readonly componentId?: string;
  readonly textExpressionId?: string;
  readonly textValue?: string;
  readonly elementExpressions: ReadonlyArray<string>;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly className?: string;
  readonly style?: Readonly<Record<string, string>>;
}): FakeDocument {
  const componentId = options.componentId ?? "c0";
  const markers: Array<MarkerSpec> = [
    { kind: "component", id: componentId, edge: "start" },
  ];
  if (options.textExpressionId !== undefined) {
    markers.push(
      { kind: "expression", id: options.textExpressionId, edge: "start" },
      { kind: "text", value: options.textValue ?? "Count: 1" },
      { kind: "expression", id: options.textExpressionId, edge: "end" },
    );
  }
  markers.push({
    kind: "element",
    expressions: options.elementExpressions,
    ...(options.attributes === undefined ? {} : { attributes: options.attributes }),
    ...(options.className === undefined ? {} : { className: options.className }),
    ...(options.style === undefined ? {} : { style: options.style }),
  });
  markers.push({ kind: "component", id: componentId, edge: "end" });
  return new FakeDocument(markers, options.markerAttribute);
}
