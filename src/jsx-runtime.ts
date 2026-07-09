/**
 * JSX runtime types for the web platform, resolved via
 * `"jsxImportSource": "effect-atom-jsx"`. The actual JSX-to-DOM transform is
 * performed by `babel-plugin-jsx-dom-expressions` (classic runtime,
 * `moduleName: "effect-atom-jsx"`); this module exists so `tsc` can type-check
 * JSX in consumer code.
 *
 * Values in attributes and children may be static, or reactive: a
 * zero-arg accessor (`() => T`) or a callable atom (`Atom<T>` reads as `T`).
 * Intrinsic host tags use per-tag attribute maps for the web platform. Unknown
 * tags remain available through the custom-element fallback so generated code
 * and platform experiments have an escape hatch during the migration.
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

  /**
   * What may appear in element position (`<X/>`). Intrinsic host tags are
   * strings; components are any callable — including the branded callable
   * `Component` objects `Component.make(...)` returns, which are not plain
   * functions and would otherwise be rejected.
   */
  export type ElementType = string | ((props: any) => unknown) | { (props: any): unknown };

  export interface ElementChildrenAttribute {
    readonly children: object;
  }

  /** Common attributes shared by intrinsic elements. */
  export interface IntrinsicAttributes {
    readonly key?: string | number;
  }

  export type JSXEvent<Target extends EventTarget, EventType extends Event = Event> = EventType & {
    readonly currentTarget: Target;
    readonly target: EventTarget & Target;
  };

  export type EventHandler<Target extends EventTarget, EventType extends Event = Event> = (
    event: JSXEvent<Target, EventType>,
  ) => unknown;

  export type Booleanish = boolean | "true" | "false";
  export type CrossOrigin = "anonymous" | "use-credentials" | "";
  export type AriaRole =
    | "alert"
    | "button"
    | "checkbox"
    | "combobox"
    | "dialog"
    | "form"
    | "grid"
    | "heading"
    | "link"
    | "listbox"
    | "menu"
    | "menuitem"
    | "navigation"
    | "option"
    | "presentation"
    | "progressbar"
    | "radio"
    | "region"
    | "search"
    | "slider"
    | "status"
    | "switch"
    | "tab"
    | "table"
    | "tabpanel"
    | "textbox";

  export interface DataAttributes {
    readonly [dataAttribute: `data-${string}`]: unknown;
  }

  export interface AriaAttributes {
    readonly role?: Reactive<AriaRole | string | undefined>;
    readonly "aria-activedescendant"?: Reactive<string | undefined>;
    readonly "aria-atomic"?: Reactive<Booleanish | undefined>;
    readonly "aria-autocomplete"?: Reactive<"none" | "inline" | "list" | "both" | undefined>;
    readonly "aria-busy"?: Reactive<Booleanish | undefined>;
    readonly "aria-checked"?: Reactive<boolean | "false" | "mixed" | "true" | undefined>;
    readonly "aria-controls"?: Reactive<string | undefined>;
    readonly "aria-current"?: Reactive<boolean | "page" | "step" | "location" | "date" | "time" | undefined>;
    readonly "aria-describedby"?: Reactive<string | undefined>;
    readonly "aria-description"?: Reactive<string | undefined>;
    readonly "aria-details"?: Reactive<string | undefined>;
    readonly "aria-disabled"?: Reactive<Booleanish | undefined>;
    readonly "aria-errormessage"?: Reactive<string | undefined>;
    readonly "aria-expanded"?: Reactive<Booleanish | undefined>;
    readonly "aria-haspopup"?: Reactive<boolean | "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined>;
    readonly "aria-hidden"?: Reactive<Booleanish | undefined>;
    readonly "aria-invalid"?: Reactive<boolean | "false" | "true" | "grammar" | "spelling" | undefined>;
    readonly "aria-keyshortcuts"?: Reactive<string | undefined>;
    readonly "aria-label"?: Reactive<string | undefined>;
    readonly "aria-labelledby"?: Reactive<string | undefined>;
    readonly "aria-live"?: Reactive<"off" | "assertive" | "polite" | undefined>;
    readonly "aria-modal"?: Reactive<Booleanish | undefined>;
    readonly "aria-multiline"?: Reactive<Booleanish | undefined>;
    readonly "aria-multiselectable"?: Reactive<Booleanish | undefined>;
    readonly "aria-orientation"?: Reactive<"horizontal" | "vertical" | undefined>;
    readonly "aria-owns"?: Reactive<string | undefined>;
    readonly "aria-placeholder"?: Reactive<string | undefined>;
    readonly "aria-posinset"?: Reactive<number | undefined>;
    readonly "aria-pressed"?: Reactive<boolean | "false" | "mixed" | "true" | undefined>;
    readonly "aria-readonly"?: Reactive<Booleanish | undefined>;
    readonly "aria-required"?: Reactive<Booleanish | undefined>;
    readonly "aria-roledescription"?: Reactive<string | undefined>;
    readonly "aria-rowcount"?: Reactive<number | undefined>;
    readonly "aria-rowindex"?: Reactive<number | undefined>;
    readonly "aria-selected"?: Reactive<Booleanish | undefined>;
    readonly "aria-setsize"?: Reactive<number | undefined>;
    readonly "aria-sort"?: Reactive<"none" | "ascending" | "descending" | "other" | undefined>;
    readonly "aria-valuemax"?: Reactive<number | undefined>;
    readonly "aria-valuemin"?: Reactive<number | undefined>;
    readonly "aria-valuenow"?: Reactive<number | undefined>;
    readonly "aria-valuetext"?: Reactive<string | undefined>;
  }

  /** Common attributes shared by known intrinsic elements. */
  export interface HTMLAttributes<Element extends HTMLElement = HTMLElement> extends DataAttributes, AriaAttributes {
    readonly key?: string | number;
    readonly children?: JSXChildren;
    readonly ref?: ((el: Element) => void) | { current: Element | null };
    readonly accessKey?: Reactive<string | undefined>;
    readonly autofocus?: Reactive<boolean | undefined>;
    readonly contenteditable?: Reactive<boolean | "inherit" | "plaintext-only" | undefined>;
    readonly dir?: Reactive<"ltr" | "rtl" | "auto" | undefined>;
    readonly draggable?: Reactive<Booleanish | undefined>;
    readonly hidden?: Reactive<boolean | "" | "hidden" | "until-found" | undefined>;
    readonly lang?: Reactive<string | undefined>;
    readonly part?: Reactive<string | undefined>;
    readonly spellcheck?: Reactive<Booleanish | undefined>;
    readonly tabIndex?: Reactive<number | undefined>;
    readonly title?: Reactive<string | undefined>;
    readonly translate?: Reactive<"yes" | "no" | undefined>;
    readonly class?: Reactive<string | undefined>;
    readonly className?: Reactive<string | undefined>;
    readonly id?: Reactive<string | undefined>;
    readonly style?: Reactive<string | Record<string, unknown> | undefined>;
    readonly slot?: Reactive<string | undefined>;
    readonly onClick?: EventHandler<Element, MouseEvent>;
    readonly onDblClick?: EventHandler<Element, MouseEvent>;
    readonly onInput?: EventHandler<Element, InputEvent>;
    readonly onChange?: EventHandler<Element, Event>;
    readonly onSubmit?: EventHandler<Element, SubmitEvent>;
    readonly onKeyDown?: EventHandler<Element, KeyboardEvent>;
    readonly onKeyUp?: EventHandler<Element, KeyboardEvent>;
    readonly onFocus?: EventHandler<Element, FocusEvent>;
    readonly onBlur?: EventHandler<Element, FocusEvent>;
    readonly onPointerDown?: EventHandler<Element, PointerEvent>;
    readonly onPointerUp?: EventHandler<Element, PointerEvent>;
    readonly onPointerMove?: EventHandler<Element, PointerEvent>;
    readonly onMouseDown?: EventHandler<Element, MouseEvent>;
    readonly onMouseUp?: EventHandler<Element, MouseEvent>;
    readonly onMouseEnter?: EventHandler<Element, MouseEvent>;
    readonly onMouseLeave?: EventHandler<Element, MouseEvent>;
    readonly onMouseMove?: EventHandler<Element, MouseEvent>;
  }

  export interface LooseHTMLAttributes extends HTMLAttributes<any> {
    readonly [attr: string]: unknown;
  }

  export interface AnchorHTMLAttributes extends HTMLAttributes<HTMLAnchorElement> {
    readonly download?: Reactive<string | boolean | undefined>;
    readonly href?: Reactive<string | undefined>;
    readonly hreflang?: Reactive<string | undefined>;
    readonly ping?: Reactive<string | undefined>;
    readonly referrerpolicy?: Reactive<ReferrerPolicy | undefined>;
    readonly rel?: Reactive<string | undefined>;
    readonly target?: Reactive<"_self" | "_blank" | "_parent" | "_top" | string | undefined>;
    readonly type?: Reactive<string | undefined>;
  }

  export interface ButtonHTMLAttributes extends HTMLAttributes<HTMLButtonElement> {
    readonly disabled?: Reactive<boolean | undefined>;
    readonly form?: Reactive<string | undefined>;
    readonly formaction?: Reactive<string | undefined>;
    readonly formenctype?: Reactive<"application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain" | undefined>;
    readonly formmethod?: Reactive<"get" | "post" | "dialog" | undefined>;
    readonly formnovalidate?: Reactive<boolean | undefined>;
    readonly formtarget?: Reactive<string | undefined>;
    readonly name?: Reactive<string | undefined>;
    readonly type?: Reactive<"button" | "submit" | "reset" | undefined>;
    readonly value?: Reactive<string | number | readonly string[] | undefined>;
  }

  export interface FormHTMLAttributes extends HTMLAttributes<HTMLFormElement> {
    readonly acceptCharset?: Reactive<string | undefined>;
    readonly action?: Reactive<string | undefined>;
    readonly autocomplete?: Reactive<"on" | "off" | undefined>;
    readonly enctype?: Reactive<"application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain" | undefined>;
    readonly method?: Reactive<"get" | "post" | "dialog" | undefined>;
    readonly name?: Reactive<string | undefined>;
    readonly novalidate?: Reactive<boolean | undefined>;
    readonly target?: Reactive<string | undefined>;
  }

  export interface InputHTMLAttributes extends HTMLAttributes<HTMLInputElement> {
    readonly accept?: Reactive<string | undefined>;
    readonly alt?: Reactive<string | undefined>;
    readonly autocomplete?: Reactive<string | undefined>;
    readonly checked?: Reactive<boolean | undefined>;
    readonly disabled?: Reactive<boolean | undefined>;
    readonly form?: Reactive<string | undefined>;
    readonly formaction?: Reactive<string | undefined>;
    readonly formenctype?: Reactive<string | undefined>;
    readonly formmethod?: Reactive<string | undefined>;
    readonly formnovalidate?: Reactive<boolean | undefined>;
    readonly formtarget?: Reactive<string | undefined>;
    readonly height?: Reactive<number | string | undefined>;
    readonly list?: Reactive<string | undefined>;
    readonly max?: Reactive<number | string | undefined>;
    readonly maxlength?: Reactive<number | undefined>;
    readonly min?: Reactive<number | string | undefined>;
    readonly minlength?: Reactive<number | undefined>;
    readonly multiple?: Reactive<boolean | undefined>;
    readonly name?: Reactive<string | undefined>;
    readonly pattern?: Reactive<string | undefined>;
    readonly placeholder?: Reactive<string | undefined>;
    readonly readonly?: Reactive<boolean | undefined>;
    readonly required?: Reactive<boolean | undefined>;
    readonly size?: Reactive<number | undefined>;
    readonly src?: Reactive<string | undefined>;
    readonly step?: Reactive<number | string | undefined>;
    readonly type?: Reactive<
      | "button"
      | "checkbox"
      | "color"
      | "date"
      | "datetime-local"
      | "email"
      | "file"
      | "hidden"
      | "image"
      | "month"
      | "number"
      | "password"
      | "radio"
      | "range"
      | "reset"
      | "search"
      | "submit"
      | "tel"
      | "text"
      | "time"
      | "url"
      | "week"
      | undefined
    >;
    readonly value?: Reactive<string | number | readonly string[] | undefined>;
    readonly width?: Reactive<number | string | undefined>;
  }

  export interface LabelHTMLAttributes extends HTMLAttributes<HTMLLabelElement> {
    readonly for?: Reactive<string | undefined>;
    readonly htmlFor?: Reactive<string | undefined>;
  }

  export interface TextareaHTMLAttributes extends HTMLAttributes<HTMLTextAreaElement> {
    readonly autocomplete?: Reactive<string | undefined>;
    readonly cols?: Reactive<number | undefined>;
    readonly disabled?: Reactive<boolean | undefined>;
    readonly form?: Reactive<string | undefined>;
    readonly maxlength?: Reactive<number | undefined>;
    readonly minlength?: Reactive<number | undefined>;
    readonly name?: Reactive<string | undefined>;
    readonly placeholder?: Reactive<string | undefined>;
    readonly readonly?: Reactive<boolean | undefined>;
    readonly required?: Reactive<boolean | undefined>;
    readonly rows?: Reactive<number | undefined>;
    readonly value?: Reactive<string | undefined>;
    readonly wrap?: Reactive<"hard" | "soft" | "off" | undefined>;
  }

  export interface SelectHTMLAttributes extends HTMLAttributes<HTMLSelectElement> {
    readonly autocomplete?: Reactive<string | undefined>;
    readonly disabled?: Reactive<boolean | undefined>;
    readonly form?: Reactive<string | undefined>;
    readonly multiple?: Reactive<boolean | undefined>;
    readonly name?: Reactive<string | undefined>;
    readonly required?: Reactive<boolean | undefined>;
    readonly size?: Reactive<number | undefined>;
    readonly value?: Reactive<string | readonly string[] | undefined>;
  }

  export interface OptionHTMLAttributes extends HTMLAttributes<HTMLOptionElement> {
    readonly disabled?: Reactive<boolean | undefined>;
    readonly label?: Reactive<string | undefined>;
    readonly selected?: Reactive<boolean | undefined>;
    readonly value?: Reactive<string | number | undefined>;
  }

  export interface MediaHTMLAttributes<Element extends HTMLMediaElement = HTMLMediaElement> extends HTMLAttributes<Element> {
    readonly autoplay?: Reactive<boolean | undefined>;
    readonly controls?: Reactive<boolean | undefined>;
    readonly crossorigin?: Reactive<CrossOrigin | undefined>;
    readonly loop?: Reactive<boolean | undefined>;
    readonly muted?: Reactive<boolean | undefined>;
    readonly preload?: Reactive<"none" | "metadata" | "auto" | "" | undefined>;
    readonly src?: Reactive<string | undefined>;
  }

  export interface ImgHTMLAttributes extends HTMLAttributes<HTMLImageElement> {
    readonly alt?: Reactive<string | undefined>;
    readonly crossorigin?: Reactive<CrossOrigin | undefined>;
    readonly decoding?: Reactive<"async" | "auto" | "sync" | undefined>;
    readonly height?: Reactive<number | string | undefined>;
    readonly loading?: Reactive<"eager" | "lazy" | undefined>;
    readonly referrerpolicy?: Reactive<ReferrerPolicy | undefined>;
    readonly sizes?: Reactive<string | undefined>;
    readonly src?: Reactive<string | undefined>;
    readonly srcset?: Reactive<string | undefined>;
    readonly width?: Reactive<number | string | undefined>;
  }

  export interface ScriptHTMLAttributes extends HTMLAttributes<HTMLScriptElement> {
    readonly async?: Reactive<boolean | undefined>;
    readonly crossorigin?: Reactive<CrossOrigin | undefined>;
    readonly defer?: Reactive<boolean | undefined>;
    readonly integrity?: Reactive<string | undefined>;
    readonly nomodule?: Reactive<boolean | undefined>;
    readonly referrerpolicy?: Reactive<ReferrerPolicy | undefined>;
    readonly src?: Reactive<string | undefined>;
    readonly type?: Reactive<string | undefined>;
  }

  export interface LinkHTMLAttributes extends HTMLAttributes<HTMLLinkElement> {
    readonly as?: Reactive<string | undefined>;
    readonly crossorigin?: Reactive<CrossOrigin | undefined>;
    readonly href?: Reactive<string | undefined>;
    readonly hreflang?: Reactive<string | undefined>;
    readonly imagesizes?: Reactive<string | undefined>;
    readonly imagesrcset?: Reactive<string | undefined>;
    readonly integrity?: Reactive<string | undefined>;
    readonly media?: Reactive<string | undefined>;
    readonly referrerpolicy?: Reactive<ReferrerPolicy | undefined>;
    readonly rel?: Reactive<string | undefined>;
    readonly sizes?: Reactive<string | undefined>;
    readonly type?: Reactive<string | undefined>;
  }

  export interface MetaHTMLAttributes extends HTMLAttributes<HTMLMetaElement> {
    readonly charset?: Reactive<string | undefined>;
    readonly content?: Reactive<string | undefined>;
    readonly "http-equiv"?: Reactive<string | undefined>;
    readonly name?: Reactive<string | undefined>;
    readonly property?: Reactive<string | undefined>;
  }

  export interface SourceHTMLAttributes extends HTMLAttributes<HTMLSourceElement> {
    readonly media?: Reactive<string | undefined>;
    readonly sizes?: Reactive<string | undefined>;
    readonly src?: Reactive<string | undefined>;
    readonly srcset?: Reactive<string | undefined>;
    readonly type?: Reactive<string | undefined>;
  }

  export interface TableCellHTMLAttributes<Element extends HTMLElement = HTMLElement> extends HTMLAttributes<Element> {
    readonly colspan?: Reactive<number | undefined>;
    readonly headers?: Reactive<string | undefined>;
    readonly rowspan?: Reactive<number | undefined>;
    readonly scope?: Reactive<"row" | "col" | "rowgroup" | "colgroup" | undefined>;
  }

  export interface OrderedListHTMLAttributes extends HTMLAttributes<HTMLOListElement> {
    readonly reversed?: Reactive<boolean | undefined>;
    readonly start?: Reactive<number | undefined>;
    readonly type?: Reactive<"1" | "a" | "A" | "i" | "I" | undefined>;
  }

  export interface IntrinsicElements {
    readonly [elemName: `${string}-${string}`]: LooseHTMLAttributes;
    readonly a: AnchorHTMLAttributes;
    readonly abbr: HTMLAttributes<HTMLElement>;
    readonly address: HTMLAttributes<HTMLElement>;
    readonly area: HTMLAttributes<HTMLAreaElement>;
    readonly article: HTMLAttributes<HTMLElement>;
    readonly aside: HTMLAttributes<HTMLElement>;
    readonly audio: MediaHTMLAttributes<HTMLAudioElement>;
    readonly b: HTMLAttributes<HTMLElement>;
    readonly base: HTMLAttributes<HTMLBaseElement> & { readonly href?: Reactive<string | undefined>; readonly target?: Reactive<string | undefined> };
    readonly bdi: HTMLAttributes<HTMLElement>;
    readonly bdo: HTMLAttributes<HTMLElement>;
    readonly blockquote: HTMLAttributes<HTMLQuoteElement> & { readonly cite?: Reactive<string | undefined> };
    readonly body: HTMLAttributes<HTMLBodyElement>;
    readonly br: HTMLAttributes<HTMLBRElement>;
    readonly button: ButtonHTMLAttributes;
    readonly canvas: HTMLAttributes<HTMLCanvasElement> & { readonly height?: Reactive<number | string | undefined>; readonly width?: Reactive<number | string | undefined> };
    readonly caption: HTMLAttributes<HTMLTableCaptionElement>;
    readonly cite: HTMLAttributes<HTMLElement>;
    readonly code: HTMLAttributes<HTMLElement>;
    readonly col: HTMLAttributes<HTMLTableColElement> & { readonly span?: Reactive<number | undefined> };
    readonly colgroup: HTMLAttributes<HTMLTableColElement> & { readonly span?: Reactive<number | undefined> };
    readonly data: HTMLAttributes<HTMLDataElement> & { readonly value?: Reactive<string | number | undefined> };
    readonly datalist: HTMLAttributes<HTMLDataListElement>;
    readonly dd: HTMLAttributes<HTMLElement>;
    readonly del: HTMLAttributes<HTMLModElement> & { readonly cite?: Reactive<string | undefined>; readonly datetime?: Reactive<string | undefined> };
    readonly details: HTMLAttributes<HTMLDetailsElement> & { readonly open?: Reactive<boolean | undefined>; readonly name?: Reactive<string | undefined> };
    readonly dfn: HTMLAttributes<HTMLElement>;
    readonly dialog: HTMLAttributes<HTMLDialogElement> & { readonly open?: Reactive<boolean | undefined> };
    readonly div: HTMLAttributes<HTMLDivElement>;
    readonly dl: HTMLAttributes<HTMLDListElement>;
    readonly dt: HTMLAttributes<HTMLElement>;
    readonly em: HTMLAttributes<HTMLElement>;
    readonly embed: HTMLAttributes<HTMLEmbedElement> & { readonly height?: Reactive<number | string | undefined>; readonly src?: Reactive<string | undefined>; readonly type?: Reactive<string | undefined>; readonly width?: Reactive<number | string | undefined> };
    readonly fieldset: HTMLAttributes<HTMLFieldSetElement> & { readonly disabled?: Reactive<boolean | undefined>; readonly form?: Reactive<string | undefined>; readonly name?: Reactive<string | undefined> };
    readonly figcaption: HTMLAttributes<HTMLElement>;
    readonly figure: HTMLAttributes<HTMLElement>;
    readonly footer: HTMLAttributes<HTMLElement>;
    readonly form: FormHTMLAttributes;
    readonly h1: HTMLAttributes<HTMLHeadingElement>;
    readonly h2: HTMLAttributes<HTMLHeadingElement>;
    readonly h3: HTMLAttributes<HTMLHeadingElement>;
    readonly h4: HTMLAttributes<HTMLHeadingElement>;
    readonly h5: HTMLAttributes<HTMLHeadingElement>;
    readonly h6: HTMLAttributes<HTMLHeadingElement>;
    readonly head: HTMLAttributes<HTMLHeadElement>;
    readonly header: HTMLAttributes<HTMLElement>;
    readonly hgroup: HTMLAttributes<HTMLElement>;
    readonly hr: HTMLAttributes<HTMLHRElement>;
    readonly html: HTMLAttributes<HTMLHtmlElement> & { readonly manifest?: Reactive<string | undefined> };
    readonly i: HTMLAttributes<HTMLElement>;
    readonly iframe: HTMLAttributes<HTMLIFrameElement> & { readonly allow?: Reactive<string | undefined>; readonly allowfullscreen?: Reactive<boolean | undefined>; readonly height?: Reactive<number | string | undefined>; readonly loading?: Reactive<"eager" | "lazy" | undefined>; readonly name?: Reactive<string | undefined>; readonly referrerpolicy?: Reactive<ReferrerPolicy | undefined>; readonly sandbox?: Reactive<string | undefined>; readonly src?: Reactive<string | undefined>; readonly srcdoc?: Reactive<string | undefined>; readonly width?: Reactive<number | string | undefined> };
    readonly img: ImgHTMLAttributes;
    readonly input: InputHTMLAttributes;
    readonly ins: HTMLAttributes<HTMLModElement> & { readonly cite?: Reactive<string | undefined>; readonly datetime?: Reactive<string | undefined> };
    readonly kbd: HTMLAttributes<HTMLElement>;
    readonly label: LabelHTMLAttributes;
    readonly legend: HTMLAttributes<HTMLLegendElement>;
    readonly li: HTMLAttributes<HTMLLIElement> & { readonly value?: Reactive<number | undefined> };
    readonly link: LinkHTMLAttributes;
    readonly main: HTMLAttributes<HTMLElement>;
    readonly map: HTMLAttributes<HTMLMapElement> & { readonly name?: Reactive<string | undefined> };
    readonly mark: HTMLAttributes<HTMLElement>;
    readonly menu: HTMLAttributes<HTMLMenuElement>;
    readonly meta: MetaHTMLAttributes;
    readonly meter: HTMLAttributes<HTMLMeterElement> & { readonly high?: Reactive<number | undefined>; readonly low?: Reactive<number | undefined>; readonly max?: Reactive<number | undefined>; readonly min?: Reactive<number | undefined>; readonly optimum?: Reactive<number | undefined>; readonly value?: Reactive<number | undefined> };
    readonly nav: HTMLAttributes<HTMLElement>;
    readonly noscript: HTMLAttributes<HTMLElement>;
    readonly object: HTMLAttributes<HTMLObjectElement> & { readonly data?: Reactive<string | undefined>; readonly form?: Reactive<string | undefined>; readonly height?: Reactive<number | string | undefined>; readonly name?: Reactive<string | undefined>; readonly type?: Reactive<string | undefined>; readonly width?: Reactive<number | string | undefined> };
    readonly ol: OrderedListHTMLAttributes;
    readonly optgroup: HTMLAttributes<HTMLOptGroupElement> & { readonly disabled?: Reactive<boolean | undefined>; readonly label?: Reactive<string | undefined> };
    readonly option: OptionHTMLAttributes;
    readonly output: HTMLAttributes<HTMLOutputElement> & { readonly for?: Reactive<string | undefined>; readonly form?: Reactive<string | undefined>; readonly name?: Reactive<string | undefined> };
    readonly p: HTMLAttributes<HTMLParagraphElement>;
    readonly picture: HTMLAttributes<HTMLPictureElement>;
    readonly pre: HTMLAttributes<HTMLPreElement>;
    readonly progress: HTMLAttributes<HTMLProgressElement> & { readonly max?: Reactive<number | undefined>; readonly value?: Reactive<number | undefined> };
    readonly q: HTMLAttributes<HTMLQuoteElement> & { readonly cite?: Reactive<string | undefined> };
    readonly rp: HTMLAttributes<HTMLElement>;
    readonly rt: HTMLAttributes<HTMLElement>;
    readonly ruby: HTMLAttributes<HTMLElement>;
    readonly s: HTMLAttributes<HTMLElement>;
    readonly samp: HTMLAttributes<HTMLElement>;
    readonly script: ScriptHTMLAttributes;
    readonly search: HTMLAttributes<HTMLElement>;
    readonly section: HTMLAttributes<HTMLElement>;
    readonly select: SelectHTMLAttributes;
    readonly slot: HTMLAttributes<HTMLSlotElement> & { readonly name?: Reactive<string | undefined> };
    readonly small: HTMLAttributes<HTMLElement>;
    readonly source: SourceHTMLAttributes;
    readonly span: HTMLAttributes<HTMLSpanElement>;
    readonly strong: HTMLAttributes<HTMLElement>;
    readonly style: HTMLAttributes<HTMLStyleElement> & { readonly media?: Reactive<string | undefined>; readonly nonce?: Reactive<string | undefined> };
    readonly sub: HTMLAttributes<HTMLElement>;
    readonly summary: HTMLAttributes<HTMLElement>;
    readonly sup: HTMLAttributes<HTMLElement>;
    readonly table: HTMLAttributes<HTMLTableElement>;
    readonly tbody: HTMLAttributes<HTMLTableSectionElement>;
    readonly td: TableCellHTMLAttributes<HTMLTableCellElement>;
    readonly template: HTMLAttributes<HTMLTemplateElement>;
    readonly textarea: TextareaHTMLAttributes;
    readonly tfoot: HTMLAttributes<HTMLTableSectionElement>;
    readonly th: TableCellHTMLAttributes<HTMLTableCellElement> & { readonly abbr?: Reactive<string | undefined> };
    readonly thead: HTMLAttributes<HTMLTableSectionElement>;
    readonly time: HTMLAttributes<HTMLTimeElement> & { readonly datetime?: Reactive<string | undefined> };
    readonly title: HTMLAttributes<HTMLTitleElement>;
    readonly tr: HTMLAttributes<HTMLTableRowElement>;
    readonly track: HTMLAttributes<HTMLTrackElement> & { readonly default?: Reactive<boolean | undefined>; readonly kind?: Reactive<"subtitles" | "captions" | "descriptions" | "chapters" | "metadata" | undefined>; readonly label?: Reactive<string | undefined>; readonly src?: Reactive<string | undefined>; readonly srclang?: Reactive<string | undefined> };
    readonly u: HTMLAttributes<HTMLElement>;
    readonly ul: HTMLAttributes<HTMLUListElement>;
    readonly var: HTMLAttributes<HTMLElement>;
    readonly video: MediaHTMLAttributes<HTMLVideoElement> & { readonly height?: Reactive<number | string | undefined>; readonly playsinline?: Reactive<boolean | undefined>; readonly poster?: Reactive<string | undefined>; readonly width?: Reactive<number | string | undefined> };
    readonly wbr: HTMLAttributes<HTMLElement>;
  }
}
