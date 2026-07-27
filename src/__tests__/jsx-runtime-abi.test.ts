import { transformSync } from "@babel/core";
import { describe, expect, it, vi } from "vitest";
import {
  addEventListener,
  clearDelegatedEvents,
  delegateEvents,
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

describe("JSX compiler/runtime ABI", () => {
  it("pins the helpers emitted for events, inserts, components, and spreads", () => {
    const output = compile(`
      const handler = (event) => event
      const Child = (props) => <span>{props.label}</span>
      const Direct = () => <button onClick={handler} />
      const App = (props) => (
        <section {...props.section}>
          <button onClick={props.onClick}>{props.count}</button>
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
    expect(output).toContain('"click"');
    expect(output).toContain(".$$click = handler");
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
