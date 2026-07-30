import { transformSync } from "@babel/core";
import { describe, expect, it, vi } from "vitest";
import * as runtime from "../runtime.js";
import { createRoot, createSignal, flush, mergeProps } from "../api.js";
import {
  addEventListener,
  classList,
  className,
  clearDelegatedEvents,
  delegateEvents,
  renderToString,
  setAttribute,
  setAttributeNS,
  setBoolAttribute,
  setStyleProperty,
  spread,
  style,
  template,
  use,
} from "../dom.js";

function compile(source: string): string {
  const result = transformSync(source, {
    filename: "runtime-abi.tsx",
    configFile: "./babel.config.json",
  });
  if (result?.code === undefined || result.code === null) {
    throw new Error("Expected Babel to emit JSX runtime code.");
  }
  return result.code;
}

function compileExecutable<Module>(
  source: string,
): Module {
  const imports: Array<{ readonly imported: string; readonly local: string }> = [];
  const withoutImports = compile(source).replace(
    /import\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*"effect-atom-jsx\/runtime";?/g,
    (_statement, imported: string, local: string) => {
      imports.push({ imported, local });
      return "";
    },
  );
  const body = withoutImports.replace(/\bexport\s+default\s+/, "return ");
  const bindings = imports
    .map(({ imported, local }) => `const ${local} = __runtime.${imported};`)
    .join("\n");
  return Function(
    "__runtime",
    `"use strict";\n${bindings}\n${body}`,
  )(runtime) as Module;
}

function fakeElement() {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const styles = new Map<string, string>();
  const element = {
    attributes,
    classes,
    styles,
    setAttribute(name: string, value: string) {
      attributes.set(name, String(value));
    },
    removeAttribute(name: string) {
      attributes.delete(name);
      if (name === "style") styles.clear();
      if (name === "class") classes.clear();
    },
    setAttributeNS(_namespace: string, name: string, value: string) {
      attributes.set(name, String(value));
    },
    removeAttributeNS(_namespace: string, name: string) {
      attributes.delete(name);
    },
    classList: {
      toggle(name: string, enabled?: boolean) {
        const next = enabled ?? !classes.has(name);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
    },
    get className() {
      return [...classes].join(" ");
    },
    set className(value: string) {
      classes.clear();
      for (const name of value.split(/\s+/).filter(Boolean)) classes.add(name);
      if (value === "") attributes.delete("class");
      else attributes.set("class", value);
    },
    style: {
      cssText: "",
      setProperty(name: string, value: string) {
        styles.set(name, String(value));
      },
      removeProperty(name: string) {
        styles.delete(name);
      },
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return element;
}

describe("JSX compiler/runtime ABI", () => {
  it("pins the helpers emitted for ordinary JSX runtime patterns", () => {
    const output = compile(`
      const handler = (event) => event
      const Child = (props) => <span>{props.label}</span>
      const Direct = () => <button onClick={handler} />
      const App = (props) => (
        <section {...props.section} class={props.className} title={props.title}>
          <button
            onClick={props.onClick}
            bool:disabled={props.disabled}
            style={{ color: props.color }}
            ref={props.ref}
            use:focus={props.focus}
          >
            {props.count}
          </button>
          <svg viewBox={props.viewBox}>
            <use xlink:href={props.href} />
          </svg>
          <Child label={props.label} />
        </section>
      )
    `);

    expect(output).toContain('from "effect-atom-jsx/runtime"');
    expect(output).toContain("addEventListener");
    expect(output).toContain("delegateEvents");
    expect(output).toContain("insert");
    expect(output).toContain("createComponent");
    expect(output).toContain("spread");
    expect(output).toContain("mergeProps");
    expect(output).toContain("setAttribute");
    expect(output).toContain("setAttributeNS");
    expect(output).toContain("setBoolAttribute");
    expect(output).toContain("className");
    expect(output).toContain("use");
    expect(output).toContain("effect");
    expect(output).toContain('"click"');
    expect(output).toContain(".$$click = handler");
  });

  it("executes compiler output for attributes, class, style, refs, directives, spreads, SVG, booleans, and properties", () => {
    const view = compileExecutable<(props: {
      readonly title: string;
      readonly className: string;
      readonly color: string;
      readonly count: number;
      readonly spread: Readonly<Record<string, unknown>>;
      readonly svgSpread: Readonly<Record<string, unknown>>;
      readonly disabled: boolean;
      readonly kind: string;
      readonly value: string;
      readonly viewBox: string;
      readonly href: string;
      readonly directiveValue: string;
      readonly ref: (element: Element) => void;
    }) => unknown>(`
      const probe = (element, value) => {
        element.setAttribute("data-directive", value())
      }
      export default (props) => (
        <section
          title={props.title}
          class={props.className}
          style={{ color: props.color, "--count": props.count }}
        >
          <div {...props.spread} />
          <input
            bool:disabled={props.disabled}
            attr:data-kind={props.kind}
            prop:value={props.value}
            ref={props.ref}
          />
          <svg viewBox={props.viewBox}>
            <use xlink:href={props.href} />
          </svg>
          <svg {...props.svgSpread} />
          <aside use:probe={props.directiveValue} />
        </section>
      )
    `);

    const html = renderToString(() =>
      view({
        title: "Runtime ABI",
        className: "ready",
        color: "rebeccapurple",
        count: 2,
        spread: {
          id: "spread",
          "data-spread": "yes",
          children: "Spread child",
        },
        svgSpread: { "xlink:href": "#spread-shape" },
        disabled: true,
        kind: "text",
        value: "property-value",
        viewBox: "0 0 10 10",
        href: "#shape",
        directiveValue: "attached",
        ref: (element) => element.setAttribute("data-ref", "attached"),
      })
    );

    expect(html).toContain('title="Runtime ABI"');
    expect(html).toContain('class="ready"');
    expect(html).toContain('style="color: rebeccapurple; --count: 2"');
    expect(html).toContain(
      '<div id="spread" data-spread="yes">Spread child</div>',
    );
    expect(html).toContain("<input ");
    expect(html).toContain('disabled=""');
    expect(html).toContain('data-kind="text"');
    expect(html).toContain('data-ref="attached"');
    expect(html).toContain('viewBox="0 0 10 10"');
    expect(html).toContain('xlink:href="#shape"');
    expect(html).toContain('<svg xlink:href="#spread-shape"></svg>');
    expect(html).toContain('data-directive="attached"');
  });

  it("keeps compiler-facing mutation helpers null-safe and diffable", () => {
    const node = fakeElement();

    setAttribute(node as unknown as Element, "title", "one");
    setAttribute(node as unknown as Element, "title", null);
    setAttributeNS(node as unknown as Element, "urn:test", "x:item", "one");
    setAttributeNS(node as unknown as Element, "urn:test", "x:item", undefined);
    setBoolAttribute(node as unknown as Element, "disabled", true);
    setBoolAttribute(node as unknown as Element, "disabled", false);
    className(node as unknown as Element, "one two");
    className(node as unknown as Element, null);
    const classState = classList(
      node as unknown as Element,
      { "one two": true, gone: true },
    );
    classList(node as unknown as Element, { "one two": false }, classState);

    let styleState = style(
      node as unknown as HTMLElement,
      { color: "red", display: "block" },
    );
    styleState = style(
      node as unknown as HTMLElement,
      { color: "blue" },
      styleState,
    );
    setStyleProperty(node as unknown as HTMLElement, "--count", 2);
    style(node as unknown as HTMLElement, null, styleState);

    let directiveTracked = true;
    const result = use(
      (_element, argument?: string) => {
        directiveTracked = false;
        return argument;
      },
      node as unknown as Element,
      "value",
    );

    expect(node.attributes.size).toBe(0);
    expect(node.classes.size).toBe(0);
    expect(node.styles.size).toBe(0);
    expect(directiveTracked).toBe(false);
    expect(result).toBe("value");
  });

  it("tracks function-valued mergeProps spreads and removes stale keys", () => {
    const node = fakeElement();
    const firstHandler = vi.fn();
    const ref = vi.fn();
    let setSource!: (value: Record<string, unknown>) => void;
    let dispose!: () => void;

    createRoot((close) => {
      dispose = close;
      const [source, set] = createSignal<Record<string, unknown>>({
        title: "one",
        "data-old": "present",
        style: { color: "red", display: "block" },
        classList: { active: true, "one two": true },
        onCustom: firstHandler,
        ref,
      });
      setSource = set;
      const props = mergeProps(
        source,
        { id: "stable" },
      );
      spread(node as unknown as Element, props);
    });

    expect(Object.fromEntries(node.attributes)).toEqual({
      title: "one",
      "data-old": "present",
      id: "stable",
    });
    expect(Object.fromEntries(node.styles)).toEqual({
      color: "red",
      display: "block",
    });
    expect([...node.classes].sort()).toEqual(["active", "one", "two"]);
    expect(node.addEventListener).toHaveBeenCalledTimes(1);
    expect(ref).toHaveBeenCalledWith(node);

    setSource({
      title: "two",
      "data-new": "present",
      style: { color: "blue" },
      classList: { active: false, "one two": false },
    });
    flush();
    expect(Object.fromEntries(node.attributes)).toEqual({
      title: "two",
      "data-new": "present",
      id: "stable",
    });
    expect(Object.fromEntries(node.styles)).toEqual({ color: "blue" });
    expect(node.classes.size).toBe(0);
    expect(node.removeEventListener).toHaveBeenCalledTimes(1);

    dispose();
  });

  it("uses property presence for mergeProps precedence, including undefined", () => {
    const merged = mergeProps(
      () => ({ id: "spread", title: "fallback" }),
      {
        id: undefined,
        get title() {
          return "explicit";
        },
      },
    );

    expect(merged).toHaveProperty("id");
    expect(merged.id).toBeUndefined();
    expect(merged.title).toBe("explicit");

    expect(
      mergeProps(
        {
          get id() {
            return "getter";
          },
        },
        { id: "data" },
      ).id,
    ).toBe("data");
  });

  it("implements the compiler's lazy template-factory contract during SSR", () => {
    const factory = template("<button>Save");

    expect(factory).toBeTypeOf("function");
    expect(renderToString(() => factory())).toBe("<button>Save</button>");
    expect(renderToString(() => [factory(), factory()])).toBe(
      "<button>Save</button><button>Save</button>",
    );
  });

  it("stores delegated handlers using the compiler's $$event convention", () => {
    const node = {
      addEventListener: vi.fn(),
    } as unknown as Element;
    const handler = vi.fn();

    addEventListener(node, "click", handler, true);

    expect((node as unknown as Record<string, unknown>).$$click).toBe(handler);
    expect((node as unknown as { addEventListener: ReturnType<typeof vi.fn> }).addEventListener).not.toHaveBeenCalled();
  });

  it("preserves currentTarget semantics for bound non-delegated handlers", () => {
    const nativeAdd = vi.fn();
    const node = {
      addEventListener: nativeAdd,
    } as unknown as Element;
    const handler = vi.fn(function (this: unknown) {
      return this;
    });
    const event = { type: "custom" } as Event;

    addEventListener(node, "custom", [handler, "payload"]);
    const listener = nativeAdd.mock.calls[0]?.[1] as EventListener;
    listener.call(node, event);

    expect(handler).toHaveBeenCalledWith("payload", event);
    expect(handler.mock.instances[0]).toBe(node);
  });

  it("supports delegated handler data and installs once per document", () => {
    const documentListener = vi.fn();
    const fakeDocument = {
      addEventListener: documentListener,
    } as unknown as Document;
    const handler = vi.fn();
    const node = {
      addEventListener: vi.fn(),
    } as unknown as Element;

    addEventListener(node, "click", [handler, { id: 1 }], true);
    delegateEvents(["click"], fakeDocument);
    delegateEvents(["click"], fakeDocument);

    expect((node as unknown as Record<string, unknown>).$$click).toBe(handler);
    expect((node as unknown as Record<string, unknown>).$$clickData).toEqual({ id: 1 });
    expect(documentListener).toHaveBeenCalledTimes(1);

    const dispatch = documentListener.mock.calls[0]?.[1] as EventListener;
    const event = {
      type: "click",
      target: Object.assign(node, { parentElement: null }),
      cancelBubble: false,
    } as unknown as Event;
    dispatch(event);

    expect(handler).toHaveBeenCalledWith({ id: 1 }, event);
  });

  it("allows compiler-emitted delegation setup during server module import", () => {
    const globals = globalThis as Record<string, unknown>;
    const hadDocument = Object.prototype.hasOwnProperty.call(globals, "document");
    const previousDocument = globals.document;
    delete globals.document;

    try {
      expect(() => delegateEvents(["click"])).not.toThrow();
    } finally {
      if (hadDocument) globals.document = previousDocument;
    }
  });

  it("uses the composed event path, exposes the delegated currentTarget, and cleans up", () => {
    const documentListener = vi.fn();
    const removeDocumentListener = vi.fn();
    const fakeDocument = {
      addEventListener: documentListener,
      removeEventListener: removeDocumentListener,
    } as unknown as Document;
    const seen: EventTarget[] = [];
    const parent = {
      $$click(event: Event) {
        seen.push(event.currentTarget as EventTarget);
      },
    };
    const child = {
      $$click(event: Event) {
        seen.push(event.currentTarget as EventTarget);
      },
    };
    const event = {
      type: "click",
      target: parent,
      cancelBubble: false,
      composedPath: () => [child, parent, fakeDocument],
    } as unknown as Event;

    delegateEvents(["click"], fakeDocument);
    const dispatch = documentListener.mock.calls[0]?.[1] as EventListener;
    dispatch(event);
    clearDelegatedEvents(fakeDocument);

    expect(seen).toEqual([child, parent]);
    expect(removeDocumentListener).toHaveBeenCalledWith("click", dispatch);
  });
});
