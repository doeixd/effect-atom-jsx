/**
 * Local helpers for the `future/security/` lane.
 *
 * Deliberately imports nothing from `src/`: this file is loaded at module scope
 * by every spec in the folder, and the `future/` contract forbids module-scope
 * source imports. It also deliberately does **not** import
 * `../resumability/fake-dom.js`: that helper belongs to another lane that is
 * being edited concurrently, and a security spec that goes red because someone
 * else refactored a fixture is noise.
 */

import { Cause, Effect, Exit, Option } from "effect";
import { expect } from "vitest";

/** The harness hands back `any`, so `Effect.run*` cannot infer a success type. */
export const runSync = (effect: any): any => Effect.runSync(effect);
export const runSyncExit = (effect: any): Exit.Exit<any, any> =>
  Effect.runSyncExit(effect) as Exit.Exit<any, any>;
export const runPromise = (effect: any): Promise<any> => Effect.runPromise(effect);
export const runPromiseExit = (effect: any): Promise<Exit.Exit<any, any>> =>
  Effect.runPromiseExit(effect) as Promise<Exit.Exit<any, any>>;

/**
 * The central classification helper for this lane. A trust-boundary rejection
 * must be a **typed failure**, never a defect (`Effect.die` / a thrown
 * exception) and never a silent success. `Cause.hasDies` is asserted here
 * rather than in each spec so that "fails, but as a defect" can never be
 * mistaken for "fails closed".
 */
export function classifiedTag(exit: Exit.Exit<unknown, unknown>): string {
  if (!Exit.isFailure(exit)) return "success";
  expect(
    Cause.hasDies(exit.cause),
    "a boundary rejection must be a typed error, not a defect",
  ).toBe(false);
  return Cause.findErrorOption(exit.cause).pipe(
    Option.map((error) => (error as { readonly _tag?: string })._tag ?? "untagged"),
    Option.getOrElse(() => "none"),
  );
}

/** Assert a set of near-neighbour codes did not collapse into one generic code. */
export function distinctCodes(codes: ReadonlyArray<string>): void {
  expect(new Set(codes).size, `codes collapsed: ${codes.join(", ")}`).toBe(codes.length);
}

/**
 * The canonical XSS-shaped payload used across this lane. Kept in one place so
 * that "did it end up as markup" is asked the same way everywhere.
 */
export const XssPayload = `<img src=x onerror="globalThis.__afuiPwned=1">`;

/** The canonical script-breakout payload for serialized-into-`<script>` checks. */
export const ScriptBreakoutPayload = `</script><script>globalThis.__afuiPwned=1</script>`;

/**
 * True when `html` contains live markup for the payload rather than escaped
 * text. Deliberately checks only for a real `<tag` opener: an earlier version
 * also matched `/onerror=/`, which fires on the perfectly-escaped
 * `&lt;img … onerror=&quot;…&quot;&gt;` and made a passing implementation look
 * broken. The property is "did a new element/attribute come into existence",
 * and only an unescaped `<` can do that in text position.
 */
export function containsLiveMarkup(html: string): boolean {
  return /<img\b/i.test(html) || /<script\b/i.test(html);
}

/** The number of double quotes in `html` — attribute breakout shows up here. */
export function quoteCount(html: string): number {
  return (html.match(/"/g) ?? []).length;
}

// ─── A minimal renderer-neutral fake DOM ─────────────────────────────────────

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
  getAttribute?: (name: string) => string | null;
  getAttributeNames?: () => Array<string>;
  setAttribute?: (name: string, value: string) => void;
  removeAttribute?: (name: string) => void;
  hasAttribute?: (name: string) => boolean;
}

export type MarkerSpec =
  | { readonly kind: "component"; readonly id: string; readonly edge: "start" | "end" }
  | { readonly kind: "expression"; readonly id: string; readonly edge: "start" | "end" }
  | { readonly kind: "text"; readonly value: string }
  | {
      readonly kind: "element";
      readonly name?: string;
      readonly expressions?: ReadonlyArray<string>;
      readonly attributes?: Readonly<Record<string, string>>;
    };

/** A flat fake document: every node is a direct child of the root. */
export class FakeDocument {
  readonly childNodes: FakeNode[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(
    markers: ReadonlyArray<MarkerSpec>,
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

  makeElement(spec: Extract<MarkerSpec, { readonly kind: "element" }>): FakeNode {
    const attributes = new Map<string, string>(Object.entries(spec.attributes ?? {}));
    const expressions = spec.expressions ?? [];
    if (expressions.length > 0) {
      attributes.set(this.markerAttribute, expressions.join(" "));
    }
    const element: FakeNode = {
      nodeType: 1,
      nodeName: (spec.name ?? "div").toUpperCase(),
      childNodes: [],
      parentNode: this,
      nextSibling: null,
      ownerDocument: this,
      attributes,
      className: "",
      getAttribute: (name) => attributes.get(name) ?? null,
      getAttributeNames: () => [...attributes.keys()],
      hasAttribute: (name) => attributes.has(name),
      setAttribute: (name, value) => {
        attributes.set(name, value);
        if (name === "class") element.className = value;
      },
      removeAttribute: (name) => {
        attributes.delete(name);
        if (name === "class") element.className = "";
      },
    };
    return element;
  }

  insertBefore(node: FakeNode, reference: FakeNode | null): FakeNode {
    const index =
      reference === null ? this.childNodes.length : this.childNodes.indexOf(reference);
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
    return elements.filter((element) => element.getAttribute?.(attribute) != null);
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

  element(index = 0): FakeNode {
    const elements = this.childNodes.filter((node) => node.nodeType === 1);
    const found = elements[index];
    if (found === undefined) throw new Error(`No fake element at index ${index}.`);
    return found;
  }

  /** Every attribute name present anywhere in the tree — used by injection specs. */
  allAttributeNames(): ReadonlyArray<string> {
    return this.childNodes
      .filter((node) => node.nodeType === 1)
      .flatMap((node) => node.getAttributeNames?.() ?? []);
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

/** One component region containing one durable text expression region. */
export function textFixture(options: {
  readonly markerAttribute?: string;
  readonly componentId?: string;
  readonly expressionId?: string;
  readonly value?: string;
}): FakeDocument {
  const componentId = options.componentId ?? "c0";
  const expressionId = options.expressionId ?? "x0";
  return new FakeDocument(
    [
      { kind: "component", id: componentId, edge: "start" },
      { kind: "expression", id: expressionId, edge: "start" },
      { kind: "text", value: options.value ?? "state-1" },
      { kind: "expression", id: expressionId, edge: "end" },
      { kind: "component", id: componentId, edge: "end" },
    ],
    options.markerAttribute ?? "data-af-expr",
  );
}

/**
 * Save and restore an arbitrary `globalThis` key around a spec. Isolation specs
 * poke at `globalThis.__afuiLoaderHandoff`, and a leaked global between specs is
 * exactly the kind of shared-fixture rot the `future/` README warns about.
 */
export function withGlobal<A>(key: string, value: unknown, run: () => A): A {
  const carrier = globalThis as Record<string, unknown>;
  const had = key in carrier;
  const previous = carrier[key];
  carrier[key] = value;
  try {
    return run();
  } finally {
    if (had) carrier[key] = previous;
    else delete carrier[key];
  }
}
