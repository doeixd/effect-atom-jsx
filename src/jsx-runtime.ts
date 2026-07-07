/**
 * JSX runtime types for the web platform, resolved via
 * `"jsxImportSource": "effect-atom-jsx"`. The actual JSX-to-DOM transform is
 * performed by `babel-plugin-jsx-dom-expressions` (classic runtime,
 * `moduleName: "effect-atom-jsx"`); this module exists so `tsc` can type-check
 * JSX in consumer code.
 *
 * Values in attributes and children may be static, or reactive: a
 * zero-arg accessor (`() => T`) or a callable atom (`Atom<T>` reads as `T`).
 * The typing here is intentionally permissive on attribute *names* for now —
 * full per-element / per-attribute web typing is tracked as a follow-up
 * (see docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md, JSX types). It is precise
 * enough to catch import/usage errors and obviously-wrong children.
 */

/** A reactive or static value usable in JSX attributes/children. */
export type Reactive<T> = T | (() => T);

/**
 * Anything renderable as a JSX child. Intentionally permissive (`unknown`):
 * dom-expressions accepts nodes, primitives, arrays, accessor functions, and
 * atoms interchangeably, and `JSX.Element` is itself `unknown`. Tightening this
 * to a precise union is tracked with the full JSX-typing follow-up.
 */
export type JSXChild = unknown;

export type JSXChildren = unknown;

// The jsx factory functions the classic transform emits. Typed loosely because
// the transform — not tsc — produces real DOM nodes.
export function jsx(type: unknown, props: unknown, key?: unknown): JSX.Element;
export function jsx(): JSX.Element {
  throw new Error("[effect-atom-jsx] jsx-runtime is types-only; use babel-plugin-jsx-dom-expressions to transform JSX.");
}

export const jsxs = jsx;
export const jsxDEV = jsx;

/** Fragment marker. */
export const Fragment: unknown = Symbol.for("effect-atom-jsx/Fragment");

export namespace JSX {
  /** The result of a JSX expression (a DOM node or reactive node at runtime). */
  export type Element = unknown;

  export interface ElementChildrenAttribute {
    readonly children: object;
  }

  /** Common attributes shared by intrinsic elements. */
  export interface IntrinsicAttributes {
    readonly key?: string | number;
  }

  /** A DOM-ish event; permissive until full per-element typing lands. */
  export interface JSXEvent {
    readonly target: any;
    readonly currentTarget: any;
    preventDefault(): void;
    stopPropagation(): void;
    readonly [key: string]: any;
  }

  /** Base attribute bag: known reactive events/refs plus permissive extras. */
  export interface HTMLAttributes {
    readonly children?: JSXChildren;
    readonly ref?: (el: any) => void | { current: unknown };
    readonly class?: Reactive<string | undefined>;
    readonly className?: Reactive<string | undefined>;
    readonly id?: Reactive<string | undefined>;
    readonly style?: Reactive<string | Record<string, unknown> | undefined>;
    readonly slot?: string;
    readonly onClick?: (event: JSXEvent) => void;
    readonly onInput?: (event: JSXEvent) => void;
    readonly onChange?: (event: JSXEvent) => void;
    readonly onSubmit?: (event: JSXEvent) => void;
    readonly onKeyDown?: (event: JSXEvent) => void;
    readonly [attr: string]: unknown;
  }

  export interface IntrinsicElements {
    readonly [elemName: string]: HTMLAttributes;
  }
}
