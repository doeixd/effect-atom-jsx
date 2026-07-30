import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Layer,
  ManagedRuntime,
  Schedule,
  Schema,
  SchemaGetter,
  Scope,
  Context,
} from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Atom from "../Atom.js";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import {
  addEventListener,
  exprAttribute,
  exprClass,
  exprStyleProperty,
  insert,
  renderToString,
  template,
  type RuntimeEventHandler,
} from "../dom.js";
import * as Portable from "../Portable.js";
import * as Reactivity from "../Reactivity.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";
import * as View from "../View.js";
import {
  bindExpression,
  expressionCode,
  type ResumableExpression,
} from "../portable-extract.js";
import { trackReactivityRuntime } from "../reactivity-runtime.js";

const TestBuildId = "resume-test-build";

interface SaveService {
  readonly save: (label: string) => Effect.Effect<void>;
}

const SaveService = Context.Service<SaveService>(
  "effect-atom-jsx/test/ResumeSaveService",
);

const SaveCode = Portable.code({
  id: "test.resume.save",
  buildId: TestBuildId,
  captures: Schema.Struct({
    label: Schema.String,
  }),
  run: (_captures) => Effect.void,
});

const ClientSaveCode = Portable.code<
  { readonly label: string },
  { readonly label: string },
  readonly [],
  void,
  never,
  SaveService
>({
  id: "test.resume.client-save",
  buildId: TestBuildId,
  captures: Schema.Struct({
    label: Schema.String,
  }),
  run: (captures) =>
    Effect.gen(function* () {
      const saves = yield* SaveService;
      yield* saves.save(captures.label);
    }),
});

function makePortableAction(label = "Save") {
  return Effect.runSync(Component.action(Portable.bind(SaveCode, { label })));
}

function makeButton(handler: RuntimeEventHandler, data?: unknown): Element {
  const button = template("<button>Save")();
  if (data === undefined) {
    addEventListener(button, "click", handler, true);
  } else {
    const record = button as unknown as Record<string, unknown>;
    record.$$click = handler;
    record.$$clickData = data;
  }
  return button;
}

function collect(
  render: () => string,
  options: Partial<Resume.CollectOptions> = {},
) {
  return Effect.runSync(
    Resume.collect(render, {
      buildId: TestBuildId,
      ...options,
    }).pipe(Effect.provide(Serialization.layer)),
  );
}

class FakeElement {
  readonly attributes = new Map<string, string>();

  constructor(readonly parentNode: FakeRoot) {}

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeRoot {
  readonly children: FakeElement[] = [];
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly captureListeners = new Set<string>();

  element(attributes: Readonly<Record<string, string>>): FakeElement {
    const element = new FakeElement(this);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    this.children.push(element);
    return element;
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector === "*") return [...this.children];
    const attribute = selector.slice(1, -1);
    return this.children.filter(
      (element) => element.getAttribute(attribute) !== null,
    );
  }

  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
    if (
      options === true ||
      (typeof options === "object" && options.capture === true)
    ) {
      this.captureListeners.add(type);
    }
  }

  removeEventListener(
    type: string,
    listener: EventListener,
    _options?: boolean | EventListenerOptions,
  ): void {
    this.listeners.get(type)?.delete(listener);
    if ((this.listeners.get(type)?.size ?? 0) === 0) {
      this.captureListeners.delete(type);
    }
  }

  listensInCapture(type: string): boolean {
    return this.captureListeners.has(type);
  }

  dispatch(type: string, target: FakeElement): Event {
    const event = {
      type,
      target,
      cancelBubble: false,
      composedPath: () => [target, this],
    } as unknown as Event;
    for (const listener of this.listeners.get(type) ?? []) {
      listener.call(this, event);
    }
    return event;
  }
}

function componentBoundaryRoot(
  markers: ReadonlyArray<readonly [componentId: string, edge: "start" | "end"]>,
): Document {
  const root = new FakeRoot() as FakeRoot & {
    childNodes: unknown[];
  };
  const comments = markers.map(([componentId, edge]) => ({
    nodeType: 8,
    nodeName: "#comment",
    data: `af:component:${componentId}:${edge}`,
    childNodes: [],
    parentNode: root,
    nextSibling: null as unknown,
  }));
  for (let index = 0; index < comments.length - 1; index += 1) {
    comments[index]!.nextSibling = comments[index + 1]!;
  }
  root.childNodes = comments;
  return root as unknown as Document;
}

function componentBoundaryEventRoot(
  attributes: Readonly<Record<string, string>>,
): Document {
  const root = new FakeRoot() as FakeRoot & { childNodes: unknown[] };
  const target = root.element(attributes) as FakeElement & {
    nextSibling: unknown;
  };
  const start = {
    nodeType: 8,
    nodeName: "#comment",
    data: "af:component:c0:start",
    childNodes: [],
    parentNode: root,
    nextSibling: target,
  };
  const end = {
    nodeType: 8,
    nodeName: "#comment",
    data: "af:component:c0:end",
    childNodes: [],
    parentNode: root,
    nextSibling: null,
  };
  target.nextSibling = end;
  root.childNodes = [start, target, end];
  return root as unknown as Document;
}

interface FakeRegionNode {
  readonly nodeType: number;
  readonly nodeName: string;
  data?: string;
  textContent: string | null;
  childNodes: FakeRegionNode[];
  parentNode: FakeRegionDocument | null;
  nextSibling: FakeRegionNode | null;
  ownerDocument: FakeRegionDocument;
}

class FakeRegionDocument {
  readonly childNodes: FakeRegionNode[] = [];

  constructor(
    markers: ReadonlyArray<
      | { readonly kind: "component"; readonly id: string; readonly edge: "start" | "end" }
      | { readonly kind: "expression"; readonly id: string; readonly edge: "start" | "end" }
      | { readonly kind: "text"; readonly value: string }
      | {
        readonly kind: "element";
        readonly expressions?: ReadonlyArray<string>;
        readonly attributes?: Readonly<Record<string, string>>;
      }
    >,
  ) {
    for (const marker of markers) {
      if (marker.kind === "text") {
        this.childNodes.push(this.createTextNode(marker.value));
      } else if (marker.kind === "element") {
        this.childNodes.push(this.createElement(marker));
      } else {
        this.childNodes.push(this.createComment(
          `af:${marker.kind === "component" ? "component" : "expr"}:${marker.id}:${marker.edge}`,
        ));
      }
    }
    this.relink();
  }

  private createComment(data: string): FakeRegionNode {
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

  private createElement(spec: {
    readonly expressions?: ReadonlyArray<string>;
    readonly attributes?: Readonly<Record<string, string>>;
  }): FakeRegionNode {
    const attributes = new Map<string, string>(
      Object.entries(spec.attributes ?? {}),
    );
    const expressions = spec.expressions ?? [];
    if (expressions.length > 0) {
      attributes.set(
        Resume.ExpressionElementMarkerAttribute,
        expressions.join(" "),
      );
    }
    return {
      nodeType: 1,
      nodeName: "DIV",
      textContent: null,
      childNodes: [],
      parentNode: this,
      nextSibling: null,
      ownerDocument: this,
      attributes,
      getAttribute: (name: string) => attributes.get(name) ?? null,
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
      },
      removeAttribute: (name: string) => {
        attributes.delete(name);
      },
    } as unknown as FakeRegionNode;
  }

  /** The first element node in the fake document. */
  elementNode(): FakeRegionNode & {
    getAttribute: (name: string) => string | null;
    hasAttribute: (name: string) => boolean;
  } {
    const found = this.childNodes.find((node) => node.nodeType === 1);
    if (found === undefined) throw new Error("No fake element node.");
    return found as FakeRegionNode & {
      getAttribute: (name: string) => string | null;
      hasAttribute: (name: string) => boolean;
    };
  }

  createTextNode(value: string): FakeRegionNode {
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

  insertBefore(
    node: FakeRegionNode,
    reference: FakeRegionNode,
  ): FakeRegionNode {
    const index = this.childNodes.indexOf(reference);
    if (index < 0) throw new Error("Reference node is not in the fake root.");
    this.childNodes.splice(index, 0, node);
    this.relink();
    return node;
  }

  removeChild(node: FakeRegionNode): FakeRegionNode {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error("Node is not in the fake root.");
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    node.nextSibling = null;
    this.relink();
    return node;
  }

  querySelectorAll(_selector: string): ReadonlyArray<never> {
    return [];
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  expressionText(): string | null {
    const startIndex = this.childNodes.findIndex(
      (node) =>
        node.nodeType === 8
        && node.data?.startsWith("af:expr:")
        && node.data.endsWith(":start"),
    );
    return startIndex < 0
      ? null
      : this.childNodes[startIndex + 1]?.textContent ?? null;
  }

  expressionTextNode(): FakeRegionNode | undefined {
    const startIndex = this.childNodes.findIndex(
      (node) =>
        node.nodeType === 8
        && node.data?.startsWith("af:expr:")
        && node.data.endsWith(":start"),
    );
    return startIndex < 0 ? undefined : this.childNodes[startIndex + 1];
  }

  private relink(): void {
    for (let index = 0; index < this.childNodes.length; index += 1) {
      const node = this.childNodes[index]!;
      node.parentNode = this;
      node.nextSibling = this.childNodes[index + 1] ?? null;
    }
  }
}

interface FakeExpressionTargetElement {
  readonly nodeType: 1;
  readonly nodeName: "DIV";
  readonly childNodes: ReadonlyArray<never>;
  readonly attributes: Map<string, string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

function fakeExpressionTargetElement(
  marker: string | undefined,
  options: {
    readonly removeError?: string;
  } = {},
): FakeExpressionTargetElement {
  const attributes = new Map<string, string>();
  if (marker !== undefined) {
    attributes.set(Resume.ExpressionElementMarkerAttribute, marker);
  }
  return {
    nodeType: 1,
    nodeName: "DIV",
    childNodes: [],
    attributes,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    removeAttribute: (name) => {
      if (options.removeError !== undefined) {
        throw new Error(options.removeError);
      }
      attributes.delete(name);
    },
  };
}

function expressionComponentBoundaryRoot(
  value = "Count: 1",
): FakeRegionDocument {
  return new FakeRegionDocument([
    { kind: "component", id: "c0", edge: "start" },
    { kind: "expression", id: "x0", edge: "start" },
    { kind: "text", value },
    { kind: "expression", id: "x0", edge: "end" },
    { kind: "component", id: "c0", edge: "end" },
  ]);
}

function clientRoot(eventId = "e0") {
  const root = new FakeRoot();
  const target = root.element({
    "data-af-event-click": eventId,
  });
  return {
    root,
    target,
    domRoot: root as unknown as Document,
  };
}

describe("Resume.collect", () => {
  it("collects portable server events into a versioned manifest", () => {
    const action = makePortableAction();
    const result = collect(() =>
      renderToString(() => makeButton(Resume.event(action))),
    );

    expect(result.html).toBe('<button data-af-event-click="e0">Save</button>');
    expect(result.manifest).toEqual({
      version: 1,
      buildId: TestBuildId,
      events: {
        e0: {
          type: "click",
          invocation: "deferred-no-args",
          code: {
            version: 1,
            kind: "portable.code",
            id: SaveCode.id,
            buildId: TestBuildId,
            captures: { label: "Save" },
          },
        },
      },
    });
    expect(
      Serialization.decodeSync(
        Resume.ManifestSchema,
        result.serializedManifest,
      ),
    ).toEqual(result.manifest);
    expect(result.script).toBe(
      `<script type="application/json" data-af-resume>${result.serializedManifest}</script>`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps ordinary SSR byte-compatible when no collector is active", () => {
    const action = makePortableAction();

    expect(renderToString(() => makeButton(Resume.event(action)))).toBe(
      "<button>Save</button>",
    );
  });

  it("diagnoses opaque closures without claiming they are resumable", () => {
    const opaque = Effect.runSync(Component.action(() => Effect.void));
    const result = collect(() => renderToString(() => makeButton(opaque)));

    expect(result.html).toBe("<button>Save</button>");
    expect(result.manifest.events).toEqual({});
    expect(result.diagnostics).toMatchObject([
      {
        code: "opaque-event-handler",
        eventType: "click",
        element: "button",
      },
    ]);
  });

  it("contains faulty event inspection as a diagnostic", () => {
    const broken = (() => undefined) as EventListener;
    Object.defineProperty(broken, Resume.EventHandlerTypeId, {
      value: () => {
        throw new Error("broken event metadata");
      },
    });
    const result = collect(() => renderToString(() => makeButton(broken)));

    expect(result.html).toBe("<button>Save</button>");
    expect(result.manifest.events).toEqual({});
    expect(result.diagnostics).toMatchObject([
      {
        code: "event-inspection-failure",
        eventType: "click",
        element: "button",
      },
    ]);
  });

  it("requires an explicit event invocation contract for portable handlers", () => {
    const result = collect(() =>
      renderToString(() => makeButton(makePortableAction())),
    );

    expect(result.html).toBe("<button>Save</button>");
    expect(result.manifest.events).toEqual({});
    expect(result.diagnostics).toMatchObject([
      {
        code: "event-contract-missing",
        eventType: "click",
        element: "button",
      },
    ]);
  });

  it("rejects action semantics that are not represented on the wire", () => {
    const action = Effect.runSync(
      Component.action(Portable.bind(SaveCode, { label: "Save" }), {
        concurrency: "queue",
      }),
    );
    const result = collect(() =>
      renderToString(() => makeButton(Resume.event(action))),
    );

    expect(result.html).toBe("<button>Save</button>");
    expect(result.manifest.events).toEqual({});
    expect(result.diagnostics).toMatchObject([
      {
        code: "unsupported-event-semantics",
        eventType: "click",
        element: "button",
      },
    ]);
  });

  it("diagnoses compiler-bound event data until it has a wire contract", () => {
    const action = makePortableAction();
    const result = collect(() =>
      renderToString(() =>
        makeButton(Resume.event(action), { source: "toolbar" }),
      ),
    );

    expect(result.html).toBe("<button>Save</button>");
    expect(result.manifest.events).toEqual({});
    expect(result.diagnostics).toMatchObject([
      {
        code: "event-data-unsupported",
        eventType: "click",
        element: "button",
      },
    ]);
  });

  it("isolates nested and consecutive collections", () => {
    const action = makePortableAction();
    let inner: Resume.CollectionResult | undefined;
    const outer = collect(() => {
      inner = collect(() =>
        renderToString(() => makeButton(Resume.event(action))),
      );
      return renderToString(() => makeButton(Resume.event(action)));
    });
    const next = collect(() =>
      renderToString(() => makeButton(Resume.event(action))),
    );

    expect(inner?.html).toContain('data-af-event-click="e0"');
    expect(Object.keys(inner?.manifest.events ?? {})).toEqual(["e0"]);
    expect(outer.html).toContain('data-af-event-click="e0"');
    expect(Object.keys(outer.manifest.events)).toEqual(["e0"]);
    expect(next.html).toContain('data-af-event-click="e0"');
    expect(Object.keys(next.manifest.events)).toEqual(["e0"]);
  });

  it("restores collection state when rendering throws", () => {
    const failure = Effect.runSync(
      Resume.collect(
        () => {
          throw new Error("render exploded");
        },
        { buildId: TestBuildId },
      ).pipe(Effect.flip, Effect.provide(Serialization.layer)),
    );
    const next = collect(() =>
      renderToString(() => makeButton(Resume.event(makePortableAction()))),
    );

    expect(failure._tag).toBe("ResumeRenderError");
    expect(next.html).toContain('data-af-event-click="e0"');
    expect(Object.keys(next.manifest.events)).toEqual(["e0"]);
  });

  it("does not duplicate manifest entries when a node is inspected twice", () => {
    const action = makePortableAction();
    const result = collect(() =>
      renderToString(() => {
        const button = makeButton(Resume.event(action));
        (button as unknown as { readonly toHTML: () => string }).toHTML();
        return button;
      }),
    );

    expect(result.html).toBe('<button data-af-event-click="e0">Save</button>');
    expect(Object.keys(result.manifest.events)).toEqual(["e0"]);
  });

  it("refuses to overwrite reserved marker attributes", () => {
    const action = makePortableAction();
    const result = collect(() =>
      renderToString(() => {
        const button = makeButton(Resume.event(action));
        button.setAttribute("data-af-event-click", "application-value");
        return button;
      }),
    );

    expect(result.html).toBe(
      '<button data-af-event-click="application-value">Save</button>',
    );
    expect(result.manifest.events).toEqual({});
    expect(result.diagnostics).toMatchObject([
      {
        code: "marker-collision",
        eventType: "click",
        element: "button",
      },
    ]);
  });

  it("escapes manifest captures for safe script embedding", () => {
    const action = makePortableAction("</script><script>alert(1)</script>");
    const result = collect(() =>
      renderToString(() => makeButton(Resume.event(action))),
    );

    expect(result.serializedManifest).not.toContain("</script>");
    expect(result.serializedManifest).toContain("\\u003c/script\\u003e");
    const decodedEntry = Object.values(
      Serialization.decodeSync(
        Resume.ManifestSchema,
        result.serializedManifest,
      ).events,
    )[0];
    expect(decodedEntry?.invocation).toBe("deferred-no-args");
    if (decodedEntry?.invocation !== "deferred-no-args") {
      throw new Error("Expected a portable event entry.");
    }
    expect(decodedEntry.code.captures).toEqual({
      label: "</script><script>alert(1)</script>",
    });
  });

  it("rejects stale build descriptors and oversized manifests", () => {
    const mismatched = Effect.runSync(
      Resume.collect(
        () =>
          renderToString(() => makeButton(Resume.event(makePortableAction()))),
        { buildId: "another-build" },
      ).pipe(Effect.flip, Effect.provide(Serialization.layer)),
    );
    const oversized = Effect.runSync(
      Resume.collect(
        () =>
          renderToString(() => makeButton(Resume.event(makePortableAction()))),
        { buildId: TestBuildId, maxPayloadBytes: 1 },
      ).pipe(Effect.flip, Effect.provide(Serialization.layer)),
    );

    expect(mismatched._tag).toBe("ResumeBuildMismatchError");
    expect(oversized._tag).toBe("ResumePayloadTooLargeError");
  });
});

describe("Resume client adapter", () => {
  function serverCollection(label = "Save") {
    const serverService: SaveService = {
      save: () => Effect.die("server action must not execute"),
    };
    const action = Effect.runSync(
      Component.action(Portable.bind(ClientSaveCode, { label })).pipe(
        Effect.provideService(SaveService, serverService),
      ),
    );
    return collect(() =>
      renderToString(() => makeButton(Resume.event(action))),
    );
  }

  it("only ever memoizes a manifest it has already frozen (DQ-099)", () => {
    // The validation memo used to be keyed on caller-supplied object identity
    // and was safe only because `Schema.decodeUnknownEffect` returns a copy --
    // an accident of the decoder, not an invariant. The memo now admits an
    // object only *after* the whole graph has been deeply frozen, so
    // "validated" implies "immutable" and validate-then-mutate-then-reuse is
    // unrepresentable even if decoding ever became identity-preserving.
    const result = serverCollection();
    const decoded = Effect.runSync(
      Resume.decodeManifest(result.serializedManifest, TestBuildId).pipe(
        Effect.provide(Serialization.layer),
      ),
    );

    expect(Object.isFrozen(decoded)).toBe(true);
    // The witness is not a property, so holding a validated manifest does not
    // let anyone mint one: there is no symbol or key to copy onto a look-alike.
    expect(Object.getOwnPropertySymbols(decoded)).toEqual([]);
    const lookAlike = { ...decoded };
    expect(Object.isFrozen(lookAlike)).toBe(false);
    expect(Object.getOwnPropertySymbols(lookAlike)).toEqual([]);
  });

  it("decodes manifests against an independent client build identity", () => {
    const result = serverCollection();
    const decoded = Effect.runSync(
      Resume.decodeManifest(result.serializedManifest, TestBuildId).pipe(
        Effect.provide(Serialization.layer),
      ),
    );
    const stale = Effect.runSync(
      Resume.decodeManifest(result.serializedManifest, "another-build").pipe(
        Effect.flip,
        Effect.provide(Serialization.layer),
      ),
    );

    expect(decoded).toEqual(result.manifest);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.events)).toBe(true);
    const decodedEvent = Object.values(decoded.events)[0];
    expect(Object.isFrozen(decodedEvent)).toBe(true);
    if (decodedEvent?.invocation === "deferred-no-args") {
      expect(Object.isFrozen(decodedEvent.code)).toBe(true);
    }
    expect(() =>
      Object.assign(decoded, { buildId: "mutated-build" })
    ).toThrow(TypeError);
    expect(stale._tag).toBe("ResumeClientBuildMismatchError");
  });

  it("enforces a configurable client-side manifest size ceiling", () => {
    const result = serverCollection();
    const oversized = Effect.runSync(
      Resume.decodeManifest(result.serializedManifest, TestBuildId, {
        maxPayloadBytes: 1,
      }).pipe(Effect.flip, Effect.provide(Serialization.layer)),
    );
    const invalidLimit = Effect.runSync(
      Resume.decodeManifest(result.serializedManifest, TestBuildId, {
        maxPayloadBytes: 0,
      }).pipe(Effect.flip, Effect.provide(Serialization.layer)),
    );

    expect(oversized._tag).toBe("ResumePayloadTooLargeError");
    expect(invalidLimit._tag).toBe("ResumeConfigurationError");
  });

  it("rejects tampered activation manifests with incompatible event projections", async () => {
    const eventId = Schema.decodeUnknownSync(Resume.EventId)("e0");
    const eventType = Schema.decodeUnknownSync(Resume.EventType)("keydown");
    const runtime = ManagedRuntime.make(Layer.empty);
    const failure = Effect.runSync(
      Resume.installClient({
        root: new FakeRoot() as unknown as Document,
        manifest: {
          version: 1,
          buildId: Schema.decodeUnknownSync(Portable.BuildId)(TestBuildId),
          events: {
            [eventId]: {
              type: eventType,
              invocation: "activation-projection",
              projection: "mouse-v1",
              targetKey: "save",
            },
          },
        },
        expectedBuildId: TestBuildId,
        resolverEntries: {},
        runtime,
      }).pipe(Effect.flip),
    );

    expect(failure._tag).toBe("ResumeUnsupportedActivationEventTypeError");
    await runtime.dispose();
  });

  it("fails closed for malformed manifests and missing DOM markers", async () => {
    const result = serverCollection();
    const malformed = Effect.runSync(
      Resume.decodeManifest(
        '{"version":1,"buildId":"resume-test-build","events":[]}',
        TestBuildId,
      ).pipe(Effect.flip, Effect.provide(Serialization.layer)),
    );
    const emptyRoot = new FakeRoot();
    const runtime = ManagedRuntime.make(Layer.empty);
    const invalidManifest = Effect.runSync(
      Resume.installClient({
        root: emptyRoot as unknown as Document,
        manifest: {
          version: 1,
          buildId: TestBuildId,
          events: [],
        } as unknown as Resume.Manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {},
        runtime,
      }).pipe(Effect.flip),
    );
    const missingMarker = Effect.runSync(
      Resume.installClient({
        root: emptyRoot as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [ClientSaveCode.id]: ClientSaveCode,
        },
        runtime,
      }).pipe(Effect.flip),
    );

    expect(malformed._tag).toBe("ResumeManifestDecodeError");
    expect(invalidManifest._tag).toBe("ResumeManifestDecodeError");
    expect(missingMarker._tag).toBe("ResumeMissingEventMarkerError");

    await runtime.dispose();
  });

  it("rejects a DOM marker whose event type is absent from the manifest", async () => {
    const result = serverCollection();
    const { domRoot } = clientRoot();
    const runtime = ManagedRuntime.make(Layer.empty);
    const unknownMarker = Effect.runSync(
      Resume.installClient({
        root: domRoot,
        manifest: {
          ...result.manifest,
          events: {},
        },
        expectedBuildId: TestBuildId,
        resolverEntries: {},
        runtime,
      }).pipe(Effect.flip),
    );

    expect(unknownMarker._tag).toBe("ResumeUnknownEventMarkerError");

    await runtime.dispose();
  });

  it("uses capture listeners and prevents duplicate root installations", async () => {
    const result = serverCollection();
    const { root, domRoot } = clientRoot();
    const runtime = ManagedRuntime.make(Layer.empty);
    const options = {
      root: domRoot,
      manifest: result.manifest,
      expectedBuildId: TestBuildId,
      resolverEntries: {
        [ClientSaveCode.id]: ClientSaveCode,
      },
      runtime,
    };
    const first = Effect.runSync(Resume.installClient(options));
    const duplicate = Effect.runSync(
      Resume.installClient(options).pipe(Effect.flip),
    );

    expect(root.listensInCapture("click")).toBe(true);
    expect(first.boundaries.size).toBe(0);
    expect(duplicate._tag).toBe("ResumeDuplicateClientInstallationError");

    await Effect.runPromise(first.dispose);
    expect(root.listensInCapture("click")).toBe(false);

    const reinstalled = Effect.runSync(Resume.installClient(options));
    await Effect.runPromise(reinstalled.dispose);
    await runtime.dispose();
  });

  it("releases a scoped client installation with its caller Scope", async () => {
    const result = serverCollection();
    const { root, domRoot } = clientRoot();
    const runtime = ManagedRuntime.make(Layer.empty);
    const scope = Scope.makeUnsafe();
    const installation = Effect.runSync(
      Resume.installClientScoped({
        root: domRoot,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [ClientSaveCode.id]: ClientSaveCode,
        },
        runtime,
      }).pipe(Scope.provide(scope)),
    );

    expect(root.listensInCapture("click")).toBe(true);
    Effect.runSync(Scope.close(scope, Exit.void));
    expect(root.listensInCapture("click")).toBe(false);
    expect(installation.pending()).toBe(0);

    await runtime.dispose();
  });

  it("observes non-bubbling event types through the root capture listener", async () => {
    const action = Effect.runSync(
      Component.action(
        Portable.bind(ClientSaveCode, { label: "focused" }),
      ).pipe(
        Effect.provideService(SaveService, {
          save: () => Effect.die("server action must not execute"),
        }),
      ),
    );
    const result = collect(() =>
      renderToString(() => {
        const button = template("<button>Focus")();
        addEventListener(button, "focus", Resume.event(action), true);
        return button;
      }),
    );
    const root = new FakeRoot();
    const target = root.element({
      "data-af-event-focus": "e0",
    });
    const saves: string[] = [];
    const runtime = ManagedRuntime.make(
      Layer.succeed(SaveService, {
        save: (label) =>
          Effect.sync(() => {
            saves.push(label);
          }),
      }),
    );
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [ClientSaveCode.id]: ClientSaveCode,
        },
        runtime,
      }),
    );

    expect(root.listensInCapture("focus")).toBe(true);
    root.dispatch("focus", target);
    await vi.waitFor(() => expect(saves).toEqual(["focused"]));

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("shares one lazy module request while executing each event once", async () => {
    const result = serverCollection("client-save");
    const { root, target, domRoot } = clientRoot();
    const saves: string[] = [];
    let loads = 0;
    const runtime = ManagedRuntime.make(
      Layer.succeed(SaveService, {
        save: (label) =>
          Effect.sync(() => {
            saves.push(label);
          }),
      }),
    );
    const installation = Effect.runSync(
      Resume.installClient({
        root: domRoot,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [ClientSaveCode.id]: () =>
            Effect.promise(async () => {
              loads += 1;
              await Promise.resolve();
              return ClientSaveCode;
            }),
        },
        runtime,
      }),
    );

    root.dispatch("click", target);
    root.dispatch("click", target);

    await vi.waitFor(() => {
      expect(installation.pending()).toBe(0);
      expect(saves).toEqual(["client-save", "client-save"]);
    });
    expect(loads).toBe(1);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("reports resolution failures without leaving failed fibers unobserved", async () => {
    const result = serverCollection();
    const { root, target, domRoot } = clientRoot();
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: domRoot,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {},
        runtime,
        onDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
          throw new Error("diagnostic observer failed");
        },
      }),
    );

    root.dispatch("click", target);

    await vi.waitFor(() => {
      expect(installation.pending()).toBe(0);
      expect(diagnostics).toMatchObject([
        {
          code: "dispatch-resolution-failure",
          eventType: "click",
          eventId: "e0",
        },
      ]);
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("reports invalid client captures as a resolution failure", async () => {
    const result = serverCollection();
    const [eventId, entry] = Object.entries(result.manifest.events)[0]!;
    if (entry.invocation !== "deferred-no-args") {
      throw new Error("Expected a portable event entry.");
    }
    const invalidManifest = {
      ...result.manifest,
      events: {
        [eventId]: {
          ...entry,
          code: {
            ...entry.code,
            captures: { label: 42 },
          },
        },
      },
    } as Resume.Manifest;
    const { root, target, domRoot } = clientRoot();
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const runtime = ManagedRuntime.make(
      Layer.succeed(SaveService, {
        save: () => Effect.void,
      }),
    );
    const installation = Effect.runSync(
      Resume.installClient({
        root: domRoot,
        manifest: invalidManifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [ClientSaveCode.id]: ClientSaveCode,
        },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    root.dispatch("click", target);

    await vi.waitFor(() => {
      expect(diagnostics[0]?.code).toBe("dispatch-resolution-failure");
      expect(installation.pending()).toBe(0);
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("interrupts pending dispatches and removes listeners on disposal", async () => {
    let interrupted = false;
    const SlowCode = Portable.code({
      id: "test.resume.slow",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () =>
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
    });
    const action = Effect.runSync(
      Component.action(Portable.bind(SlowCode, {})),
    );
    const result = collect(() =>
      renderToString(() => makeButton(Resume.event(action))),
    );
    const { root, target, domRoot } = clientRoot();
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: domRoot,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [SlowCode.id]: SlowCode,
        },
        runtime,
      }),
    );

    root.dispatch("click", target);
    await vi.waitFor(() => expect(installation.pending()).toBe(1));
    await Effect.runPromise(installation.dispose);

    expect(interrupted).toBe(true);
    expect(installation.pending()).toBe(0);
    root.dispatch("click", target);
    expect(installation.pending()).toBe(0);

    await runtime.dispose();
  });

  it("does not replay component setup or view in the fresh client runtime", async () => {
    let setups = 0;
    let views = 0;
    let serverScopeClosed = false;
    let serverServiceClosed = false;
    const serverScope = Scope.makeUnsafe();
    Effect.runSync(
      Scope.addFinalizer(
        serverScope,
        Effect.sync(() => {
          serverScopeClosed = true;
        }),
      ),
    );
    const Button = Component.make(
      Component.props<{ readonly label: string }>(),
      Component.require<SaveService>(),
      ({ label }) =>
        Effect.gen(function* () {
          setups += 1;
          const save = yield* Component.action(
            Portable.bind(ClientSaveCode, { label }),
          );
          return { save };
        }),
      (_props, bindings) => {
        views += 1;
        return makeButton(Resume.event(bindings.save));
      },
    );
    const serverService: SaveService = {
      save: () => Effect.die("server action must not execute"),
    };
    const serverLayer = Layer.effect(
      SaveService,
      Effect.acquireRelease(Effect.succeed(serverService), () =>
        Effect.sync(() => {
          serverServiceClosed = true;
        }),
      ),
    );
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Button, { label: "fresh-client" }).pipe(
            Scope.provide(serverScope),
            Effect.provide(serverLayer),
          ),
        ),
      ),
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));

    const { root, target, domRoot } = clientRoot();
    const saves: string[] = [];
    const runtime = ManagedRuntime.make(
      Layer.succeed(SaveService, {
        save: (label) =>
          Effect.sync(() => {
            saves.push(label);
          }),
      }),
    );
    const installation = Effect.runSync(
      Resume.installClient({
        root: domRoot,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [ClientSaveCode.id]: ClientSaveCode,
        },
        runtime,
      }),
    );

    expect(serverScopeClosed).toBe(true);
    expect(serverServiceClosed).toBe(true);
    expect(setups).toBe(1);
    expect(views).toBe(1);

    root.dispatch("click", target);

    await vi.waitFor(() => expect(saves).toEqual(["fresh-client"]));
    expect(setups).toBe(1);
    expect(views).toBe(1);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });
});

describe("Resume state binding restoration", () => {
  function makeCounter(counters: { setupRuns: number; viewRuns: number }) {
    return Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "count",
        () =>
          Effect.sync(() => {
            counters.setupRuns += 1;
          }).pipe(Effect.flatMap(() => Component.state(41))),
        {
          resume: Resume.snapshotState(Schema.Number),
        },
      ),
      (_props, bindings) => {
        counters.viewRuns += 1;
        return bindings.count();
      },
    ).pipe(Component.withDefinition({ name: "ResumeStateCounter" }));
  }

  it("collects a schema-encoded state binding in a v2 manifest", () => {
    const counters = { setupRuns: 0, viewRuns: 0 };
    const Counter = makeCounter(counters);
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.html).toBe(
      "<!--af:component:c0:start-->41<!--af:component:c0:end-->",
    );
    expect(result.manifest).toMatchObject({
      version: 2,
      buildId: TestBuildId,
      components: {
        c0: {
          definitionName: "ResumeStateCounter",
          region: {
            kind: "comment-pair",
          },
          bindings: {
            count: {
              kind: "state",
              key: "c0/count",
              value: 41,
            },
          },
        },
      },
    });
    expect(
      Effect.runSync(
        Resume.decodeManifest(result.serializedManifest, TestBuildId).pipe(
          Effect.provide(Serialization.layer),
        ),
      ),
    ).toEqual(result.manifest);
    expect(counters).toEqual({ setupRuns: 1, viewRuns: 1 });
  });

  it("collects schema-backed component activation through wrappers", () => {
    const Props = Schema.Struct({
      label: Schema.String,
    });
    const Greeting = Component.make(
      Component.propsSchema(Props),
      Component.require<never>(),
      ({ label }) => Effect.succeed({ label }),
      (_props, bindings) => bindings.label,
    );
    const AddressableGreeting = Greeting.pipe(
      Component.withDefinition({ name: "AddressableGreeting" }),
      Resume.addressable({
        id: "test.resume.greeting",
        buildId: TestBuildId,
        props: Props,
      }),
    );
    const activation = Resume.activationOf(AddressableGreeting);
    expect(activation.id).toBe("test.resume.greeting");
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(AddressableGreeting, {
            label: "hello",
          }).pipe(Scope.provide(scope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.html).toBe(
      "<!--af:component:c0:start-->hello<!--af:component:c0:end-->",
    );
    expect(result.manifest).toMatchObject({
      version: 2,
      components: {
        c0: {
          definitionName: "AddressableGreeting",
          activation: {
            version: 1,
            kind: "portable.code",
            id: "test.resume.greeting",
            buildId: TestBuildId,
            captures: {
              label: "hello",
            },
          },
          bindings: {},
        },
      },
    });
  });

  it("collects activation-required events with a schema-backed projection", () => {
    const handler = Resume.activationEvent(
      "save",
      Resume.MouseEventProjection,
      () => undefined,
    );
    const result = collect(() =>
      renderToString(() => makeButton(handler)),
    );

    expect(result.html).toContain('data-af-replay-click="save"');
    expect(result.html).toContain('data-af-event-click="e0"');
    expect(result.manifest.events).toEqual({
      e0: {
        type: "click",
        invocation: "activation-projection",
        projection: "mouse-v1",
        targetKey: "save",
      },
    });
  });

  it("rejects activation projections that cannot represent the event type", () => {
    const handler = Resume.activationEvent(
      "save",
      Resume.MouseEventProjection,
      () => undefined,
    );
    const result = collect(() =>
      renderToString(() => {
        const input = template("<input>")();
        addEventListener(input, "keydown", handler, true);
        return input;
      }),
    );

    expect(result.manifest.events).toEqual({});
    expect(result.html).not.toContain("data-af-event-keydown");
    expect(result.diagnostics).toMatchObject([
      {
        code: "unsupported-event-semantics",
        eventType: "keydown",
        disposition: "fallback-required",
      },
    ]);
  });

  it("does not carry addressability through a later component wrapper", () => {
    const Props = Schema.Struct({
      label: Schema.String,
    });
    const Base = Component.make(
      Component.propsSchema(Props),
      Component.require<never>(),
      ({ label }) => Effect.succeed({ label }),
      (_props, bindings) => bindings.label,
    ).pipe(
      Resume.addressable({
        id: "test.resume.wrapper-order",
        buildId: TestBuildId,
        props: Props,
      }),
    );
    const WrappedTooLate = Base.pipe(
      Component.withDefinition({ name: "WrappedTooLate" }),
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(WrappedTooLate, {
            label: "hello",
          }).pipe(Scope.provide(scope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.html).toBe("hello");
    expect(result.manifest.version).toBe(1);
  });

  it("uses paired ownership markers for fragments, text, and empty output", () => {
    const cases: ReadonlyArray<{
      readonly render: () => unknown;
      readonly inner: string;
    }> = [
      {
        render: () => ["before", template("<span>inside")(), "after"],
        inner: "before<span>inside</span>after",
      },
      {
        render: () => "text-only",
        inner: "text-only",
      },
      {
        render: () => null,
        inner: "",
      },
    ];

    for (const testCase of cases) {
      const Boundary = Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        Component.setup<{}>().bind("state", () => Component.state(1), {
          resume: Resume.snapshotState(Schema.Number),
        }),
        testCase.render,
      );
      const scope = Scope.makeUnsafe();
      const result = collect(() =>
        renderToString(() =>
          Effect.runSync(
            Component.renderEffect(Boundary, {}).pipe(Scope.provide(scope)),
          ),
        ),
      );
      Effect.runSync(Scope.close(scope, Exit.void));

      expect(result.html).toBe(
        `<!--af:component:c0:start-->${testCase.inner}<!--af:component:c0:end-->`,
      );
      expect(result.manifest).toMatchObject({
        version: 2,
        components: {
          c0: {
            region: {
              kind: "comment-pair",
            },
          },
        },
      });
    }
  });

  it("discovers complete component regions and rejects missing or crossing markers", () => {
    const counters = { setupRuns: 0, viewRuns: 0 };
    const Counter = makeCounter(counters);
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(scope, Exit.void));
    if (result.manifest.version !== 2) {
      throw new Error("Expected a v2 component manifest.");
    }
    const comment = (data: string) => ({
      nodeType: 8,
      nodeName: "#comment",
      data,
      childNodes: [],
    });
    const root = (childNodes: ReadonlyArray<unknown>) =>
      ({ childNodes }) as unknown as Document;
    const start = comment("af:component:c0:start");
    const end = comment("af:component:c0:end");
    const discovered = Effect.runSync(
      Resume.scanComponentBoundaries(
        root([start, { childNodes: [] }, end]),
        result.manifest,
      ),
    );
    const missing = Effect.runSync(
      Resume.scanComponentBoundaries(root([start]), result.manifest).pipe(
        Effect.flip,
      ),
    );
    const componentId = Schema.decodeUnknownSync(Resume.ComponentId)("c1");
    const crossingManifest: Resume.Manifest = {
      ...result.manifest,
      components: {
        ...result.manifest.components,
        [componentId]: {
          region: {
            kind: "comment-pair",
          },
          bindings: {},
        },
      },
    };
    const crossing = Effect.runSync(
      Resume.scanComponentBoundaries(
        root([
          comment("af:component:c0:start"),
          comment("af:component:c1:start"),
          comment("af:component:c0:end"),
          comment("af:component:c1:end"),
        ]),
        crossingManifest,
      ).pipe(Effect.flip),
    );

    expect([...discovered.keys()]).toEqual(["c0"]);
    expect(
      discovered.get(Schema.decodeUnknownSync(Resume.ComponentId)("c0")),
    ).toMatchObject({
      start,
      end,
    });
    expect(missing._tag).toBe("ResumeMissingComponentBoundaryError");
    expect(crossing._tag).toBe("ResumeComponentBoundaryNestingError");
  });

  it("omits committed snapshots that never acquire a rendered boundary", () => {
    const counters = { setupRuns: 0, viewRuns: 0 };
    const Counter = makeCounter(counters);
    const scope = Scope.makeUnsafe();
    const result = collect(() => {
      Effect.runSync(
        Component.setupEffect(Counter, {}).pipe(Scope.provide(scope)),
      );
      return "outside";
    });
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.html).toBe("outside");
    expect(result.manifest.version).toBe(1);
    expect(result.diagnostics).toMatchObject([
      {
        code: "missing-component-boundary",
        phase: "collect",
        severity: "warning",
        disposition: "fallback-required",
        componentId: "c0",
      },
    ]);
  });

  it("contains faulty state-handle inspection as a diagnostic", () => {
    const broken = (() => 0) as unknown as Component.StateAtom<number>;
    Object.defineProperty(broken, Resume.HandleInspectionTypeId, {
      value: () => {
        throw new Error("broken state metadata");
      },
    });
    const Broken = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Effect.succeed(broken), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      () => null,
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Broken, {}).pipe(Scope.provide(scope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.diagnostics).toMatchObject([
      {
        code: "snapshot-inspection-failure",
        componentId: "c0",
        binding: "count",
      },
    ]);
  });

  it("restores fresh client-owned state and renders without setup", () => {
    const counters = { setupRuns: 0, viewRuns: 0 };
    const Counter = makeCounter(counters);
    const serverScope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(serverScope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));

    const restored = Effect.runSync(
      Resume.restoreStateBindings(Counter, result.manifest, "c0"),
    );
    expect(counters.setupRuns).toBe(1);
    expect(Component.renderWithBindings(Counter, {}, restored.bindings)).toBe(
      41,
    );
    expect(counters).toEqual({ setupRuns: 1, viewRuns: 2 });

    restored.registry.set(restored.bindings.count, 42);
    expect(restored.registry.get(restored.bindings.count)).toBe(42);
    expect(Resume.inspectHandle(restored.bindings.count)).toMatchObject({
      kind: "state",
    });

    Effect.runSync(restored.dispose);
    expect(Resume.inspectHandle(restored.bindings.count)?.isDisposed()).toBe(
      true,
    );
    expect(() => restored.registry.set(restored.bindings.count, 43)).toThrow(
      /setup scope has closed/,
    );
  });

  it("releases scoped restored bindings with the caller Scope", () => {
    const counters = { setupRuns: 0, viewRuns: 0 };
    const Counter = makeCounter(counters);
    const serverScope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(serverScope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));

    const clientScope = Scope.makeUnsafe();
    const restored = Effect.runSync(
      Resume.restoreStateBindingsScoped(Counter, result.manifest, "c0").pipe(
        Scope.provide(clientScope),
      ),
    );
    expect(Resume.inspectHandle(restored.bindings.count)?.isDisposed()).toBe(
      false,
    );

    Effect.runSync(Scope.close(clientScope, Exit.void));
    expect(Resume.inspectHandle(restored.bindings.count)?.isDisposed()).toBe(
      true,
    );
  });

  it("reconstructs a single authored slot transform with ordinary bindings", () => {
    const counters = { setupRuns: 0, viewRuns: 0 };
    const slots = View.Slots.define({
      root: {},
    });
    const Counter = makeCounter(counters).pipe(Component.withSlots(slots));
    const serverScope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(serverScope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));

    const restored = Effect.runSync(
      Resume.restoreStateBindings(Counter, result.manifest, "c0"),
    );

    expect(Object.getPrototypeOf(restored.bindings)).toBe(Object.prototype);
    expect(restored.bindings.slots).toEqual(View.Slots.handles(slots));
    expect(Component.renderWithBindings(Counter, {}, restored.bindings)).toBe(
      41,
    );

    Effect.runSync(restored.dispose);
  });

  it("fails before allocation for invalid or incomplete snapshots", () => {
    const counters = { setupRuns: 0, viewRuns: 0 };
    const Counter = makeCounter(counters);
    const serverScope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(serverScope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));
    if (result.manifest.version !== 2) {
      throw new Error("Expected a v2 state snapshot manifest.");
    }
    const componentId = Schema.decodeUnknownSync(Resume.ComponentId)("c0");
    const bindingName = Schema.decodeUnknownSync(Resume.BindingName)("count");
    const invalidManifest: Resume.Manifest = {
      ...result.manifest,
      components: {
        ...result.manifest.components,
        [componentId]: {
          ...result.manifest.components[componentId]!,
          bindings: {
            [bindingName]: {
              ...result.manifest.components[componentId]!.bindings[
                bindingName
              ]!,
              value: "not-a-number",
            },
          },
        },
      },
    };
    const invalid = Effect.runSync(
      Resume.restoreStateBindings(Counter, invalidManifest, "c0").pipe(
        Effect.flip,
      ),
    );

    const Mixed = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>()
        .bind("count", () => Component.state(1), {
          resume: Resume.snapshotState(Schema.Number),
        })
        .bind("opaque", () => Effect.succeed("client-only")),
      () => null,
    );
    const mixedScope = Scope.makeUnsafe();
    const mixedResult = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Mixed, {}).pipe(Scope.provide(mixedScope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(mixedScope, Exit.void));
    const incomplete = Effect.runSync(
      Resume.restoreStateBindings(Mixed, mixedResult.manifest, "c0").pipe(
        Effect.flip,
      ),
    );

    expect(invalid._tag).toBe("ResumeStateSnapshotDecodeError");
    expect(incomplete._tag).toBe("ResumeComponentPlanUnsupportedError");
  });
});

describe("Resume component activation", () => {
  beforeAll(() => {
    vi.stubGlobal("Node", class {});
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  function activationManifest(
    entries: Readonly<Record<string, Portable.AnyBoundCode>>,
  ): Resume.Manifest {
    const components: Record<string, Resume.ComponentSnapshot> = {};
    for (const [componentId, executable] of Object.entries(entries)) {
      components[componentId] = {
        region: { kind: "comment-pair" },
        activation: Effect.runSync(Portable.describe(executable)),
        bindings: {},
      };
    }
    return {
      version: 2,
      buildId: Schema.decodeUnknownSync(Portable.BuildId)(TestBuildId),
      events: {},
      components,
    };
  }

  it("fails closed when an activation event has no validated replay target", async () => {
    const ActivationCode = Portable.code({
      id: "test.resume.invalid-event-owner",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () => Effect.succeed({ dispose: Effect.void }),
    });
    const base = activationManifest({
      c0: Portable.bind(ActivationCode, {}),
    });
    const eventId = Schema.decodeUnknownSync(Resume.EventId)("e0");
    const manifest: Resume.Manifest = {
      ...base,
      events: {
        [eventId]: {
          type: Schema.decodeUnknownSync(Resume.EventType)("click"),
          invocation: "activation-projection",
          projection: "mouse-v1",
          targetKey: "save",
        },
      },
    };
    const runtime = ManagedRuntime.make(Layer.empty);
    const failure = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryEventRoot({
          "data-af-event-click": "e0",
        }),
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [ActivationCode.id]: ActivationCode },
        runtime,
      }).pipe(Effect.flip),
    );

    expect(failure._tag).toBe("ResumeActivationEventOwnershipError");
    await runtime.dispose();
  });

  it("resumes committed state through the boundary controller without replaying setup", async () => {
    let setupRuns = 0;
    const Resumable = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "count",
        () =>
          Effect.sync(() => {
            setupRuns += 1;
            return 7;
          }).pipe(Effect.flatMap(Component.state)),
        { resume: Resume.snapshotState(Schema.Number) },
      ),
      () => null,
    ).pipe(
      Component.withDefinition({ name: "BoundaryResumable" }),
      Resume.addressable({
        id: "test.resume.boundary-resume",
        buildId: TestBuildId,
        props: Schema.Struct({}),
      }),
    );
    const serverScope = Scope.makeUnsafe();
    const collected = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Resumable, {}).pipe(
            Scope.provide(serverScope),
          ),
        ),
      ),
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));
    expect(setupRuns).toBe(1);

    const activation = Resume.activationOf(Resumable);
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c0", "end"],
        ]),
        manifest: collected.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [activation.id]: () =>
            Effect.promise(async () => {
              await loadGate;
              return activation;
            }),
        },
        runtime,
      }),
    );

    const resumption = Effect.runPromise(installation.resume("c0"));
    await vi.waitFor(() => {
      expect(installation.boundaryState("c0")).toEqual({
        status: "resuming",
      });
    });
    releaseLoad();
    await resumption;

    expect(setupRuns).toBe(1);
    expect(installation.boundaryState("c0")).toEqual({ status: "active" });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("falls back from incomplete restoration to one normal activation", async () => {
    let setupRuns = 0;
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const Incomplete = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () =>
        Effect.sync(() => {
          setupRuns += 1;
          return {};
        }),
      () => null,
    ).pipe(
      Component.withDefinition({ name: "BoundaryFallback" }),
      Resume.addressable({
        id: "test.resume.boundary-fallback",
        buildId: TestBuildId,
        props: Schema.Struct({}),
      }),
    );
    const serverScope = Scope.makeUnsafe();
    const collected = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Incomplete, {}).pipe(
            Scope.provide(serverScope),
          ),
        ),
      ),
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));
    expect(setupRuns).toBe(1);

    const activation = Resume.activationOf(Incomplete);
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c0", "end"],
        ]),
        manifest: collected.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [activation.id]: activation },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    await Effect.runPromise(installation.resume("c0"));

    expect(setupRuns).toBe(2);
    expect(installation.boundaryState("c0")).toEqual({ status: "active" });
    expect(diagnostics).toMatchObject([
      {
        code: "component-resumption-fallback",
        componentId: "c0",
      },
    ]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("rolls back portable behavior restoration before fallback activation", async () => {
    let setupRuns = 0;
    let behaviorRuns = 0;
    let acquired = 0;
    let released = 0;
    const BehaviorCode = Portable.code<
      {},
      {},
      readonly [{ readonly count: unknown }],
      {},
      "restore-failed",
      Scope.Scope
    >({
      id: "test.resume.behavior-rollback",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () =>
        Effect.gen(function* () {
          behaviorRuns += 1;
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              acquired += 1;
            }),
            () =>
              Effect.sync(() => {
                released += 1;
              }),
          );
          if (behaviorRuns === 2) {
            return yield* Effect.fail("restore-failed" as const);
          }
          return {};
        }),
    });
    const behavior = Behavior.portable(Portable.bind(BehaviorCode, {}));
    const Resumable = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "count",
        () =>
          Effect.sync(() => {
            setupRuns += 1;
            return 1;
          }).pipe(Effect.flatMap(Component.state)),
        { resume: Resume.snapshotState(Schema.Number) },
      ),
      () => null,
    ).pipe(
      Behavior.attach(behavior, {
        select: (bindings) => ({ count: bindings.count }),
      }),
      Resume.addressable({
        id: "test.resume.behavior-rollback-activation",
        buildId: TestBuildId,
        props: Schema.Struct({}),
      }),
    );
    const serverScope = Scope.makeUnsafe();
    const collected = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Resumable, {}).pipe(
            Scope.provide(serverScope),
          ),
        ),
      ),
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));
    expect({ setupRuns, behaviorRuns, acquired, released }).toEqual({
      setupRuns: 1,
      behaviorRuns: 1,
      acquired: 1,
      released: 1,
    });

    const activation = Resume.activationOf(Resumable);
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c0", "end"],
        ]),
        manifest: collected.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [activation.id]: activation },
        runtime,
      }),
    );

    await Effect.runPromise(installation.resume("c0"));
    expect(installation.boundaryState("c0")).toEqual({ status: "active" });
    expect({ setupRuns, behaviorRuns, acquired, released }).toEqual({
      setupRuns: 2,
      behaviorRuns: 3,
      acquired: 3,
      released: 2,
    });

    await Effect.runPromise(installation.dispose);
    expect(released).toBe(3);
    await runtime.dispose();
  });

  it("does not activate after an unclassified restoration defect", async () => {
    let setupRuns = 0;
    let behaviorRuns = 0;
    const DefectCode = Portable.code<
      {},
      {},
      readonly [{ readonly count: unknown }],
      {},
      never,
      never
    >({
      id: "test.resume.behavior-defect",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () =>
        Effect.suspend(() => {
          behaviorRuns += 1;
          return behaviorRuns === 2
            ? Effect.die("restoration defect")
            : Effect.succeed({});
        }),
    });
    const Resumable = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "count",
        () =>
          Effect.sync(() => {
            setupRuns += 1;
            return 1;
          }).pipe(Effect.flatMap(Component.state)),
        { resume: Resume.snapshotState(Schema.Number) },
      ),
      () => null,
    ).pipe(
      Behavior.attach(
        Behavior.portable(Portable.bind(DefectCode, {})),
        { select: (bindings) => ({ count: bindings.count }) },
      ),
      Resume.addressable({
        id: "test.resume.defect-no-fallback",
        buildId: TestBuildId,
        props: Schema.Struct({}),
      }),
    );
    const serverScope = Scope.makeUnsafe();
    const collected = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Resumable, {}).pipe(
            Scope.provide(serverScope),
          ),
        ),
      ),
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));

    const activation = Resume.activationOf(Resumable);
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c0", "end"],
        ]),
        manifest: collected.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [activation.id]: activation },
        runtime,
      }),
    );

    const failure = await Effect.runPromise(
      installation.resume("c0").pipe(Effect.flip),
    );
    expect(failure._tag).toBe("ResumeComponentActivationExecutionError");
    expect(setupRuns).toBe(1);
    expect(behaviorRuns).toBe(2);
    expect(installation.boundaryState("c0")).toMatchObject({
      status: "failed",
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("shares one activation and disposes the mounted region exactly once", async () => {
    let executions = 0;
    let disposals = 0;
    let loads = 0;
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const ActivationCode = Portable.code<
      {},
      {},
      readonly [Resume.ComponentActivationContext],
      Resume.ComponentActivationMount,
      never,
      never
    >({
      id: "test.resume.activate-once",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () =>
        Effect.sync(() => {
          executions += 1;
          return {
            dispose: Effect.sync(() => {
              disposals += 1;
            }),
          };
        }),
    });
    const manifest = activationManifest({
      c0: Portable.bind(ActivationCode, {}),
    });
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c0", "end"],
        ]),
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [ActivationCode.id]: () =>
            Effect.promise(async () => {
              loads += 1;
              await loadGate;
              return ActivationCode;
            }),
        },
        runtime,
      }),
    );

    const first = Effect.runPromise(installation.activate("c0"));
    const second = Effect.runPromise(installation.activate("c0"));
    await vi.waitFor(() => {
      expect(installation.boundaryState("c0")).toEqual({
        status: "activating",
      });
      expect(installation.pending()).toBe(1);
      expect(loads).toBe(1);
    });
    releaseLoad();
    await Promise.all([first, second]);

    expect(executions).toBe(1);
    expect(installation.boundaryState("c0")).toEqual({
      status: "active",
    });
    await Effect.runPromise(installation.activate("c0"));
    expect(executions).toBe(1);

    await Effect.runPromise(installation.dispose);
    await Effect.runPromise(installation.dispose);
    expect(disposals).toBe(1);
    expect(installation.boundaryState("c0")).toEqual({
      status: "disposed",
    });
    await runtime.dispose();
  });

  it("disposal wins over an in-flight activation", async () => {
    let executions = 0;
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const ActivationCode = Portable.code<
      {},
      {},
      readonly [Resume.ComponentActivationContext],
      Resume.ComponentActivationMount,
      never,
      never
    >({
      id: "test.resume.dispose-activating",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () =>
        Effect.sync(() => {
          executions += 1;
          return { dispose: Effect.void };
        }),
    });
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c0", "end"],
        ]),
        manifest: activationManifest({
          c0: Portable.bind(ActivationCode, {}),
        }),
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [ActivationCode.id]: () =>
            Effect.promise(async () => {
              await loadGate;
              return ActivationCode;
            }),
        },
        runtime,
      }),
    );

    const activation = Effect.runPromise(
      installation.activate("c0").pipe(Effect.exit),
    );
    await vi.waitFor(() => {
      expect(installation.boundaryState("c0")).toEqual({
        status: "activating",
      });
    });
    await Effect.runPromise(installation.dispose);
    releaseLoad();
    const activationExit = await activation;

    expect(Exit.isFailure(activationExit)).toBe(true);
    expect(executions).toBe(0);
    expect(installation.boundaryState("c0")).toEqual({
      status: "disposed",
    });
    await runtime.dispose();
  });

  it("disposes active descendants before activating their owner", async () => {
    let childDisposals = 0;
    const activationCode = (id: string, onDispose: () => void) =>
      Portable.code<
        {},
        {},
        readonly [Resume.ComponentActivationContext],
        Resume.ComponentActivationMount,
        never,
        never
      >({
        id,
        buildId: TestBuildId,
        captures: Schema.Struct({}),
        run: () =>
          Effect.succeed({
            dispose: Effect.sync(onDispose),
          }),
      });
    const ParentActivation = activationCode(
      "test.resume.activate-parent",
      () => {},
    );
    const ChildActivation = activationCode("test.resume.activate-child", () => {
      childDisposals += 1;
    });
    const manifest = activationManifest({
      c0: Portable.bind(ParentActivation, {}),
      c1: Portable.bind(ChildActivation, {}),
    });
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c1", "start"],
          ["c1", "end"],
          ["c0", "end"],
        ]),
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [ParentActivation.id]: ParentActivation,
          [ChildActivation.id]: ChildActivation,
        },
        runtime,
      }),
    );

    await Effect.runPromise(installation.activate("c1"));
    expect(installation.boundaryState("c1")).toEqual({
      status: "active",
    });
    await Effect.runPromise(installation.activate("c0"));

    expect(childDisposals).toBe(1);
    expect(installation.boundaryState("c0")).toEqual({
      status: "active",
    });
    expect(installation.boundaryState("c1")).toEqual({
      status: "disposed",
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("keeps resolution failure terminal and observable", async () => {
    const ActivationCode = Portable.code<
      {},
      {},
      readonly [Resume.ComponentActivationContext],
      Resume.ComponentActivationMount,
      never,
      never
    >({
      id: "test.resume.missing-activation",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () => Effect.succeed({ dispose: Effect.void }),
    });
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c0", "end"],
        ]),
        manifest: activationManifest({
          c0: Portable.bind(ActivationCode, {}),
        }),
        expectedBuildId: TestBuildId,
        resolverEntries: {},
        runtime,
      }),
    );

    const first = await Effect.runPromise(
      installation.activate("c0").pipe(Effect.flip),
    );
    const second = await Effect.runPromise(
      installation.activate("c0").pipe(Effect.flip),
    );

    expect(first._tag).toBe("ResumeComponentActivationResolutionError");
    expect(second).toBe(first);
    expect(installation.boundaryState("c0")).toMatchObject({
      status: "failed",
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });
});

describe("Resume portable queries", () => {
  const QueryCode = Portable.code<
    { readonly label: string },
    { readonly label: string },
    readonly [],
    string,
    never,
    never
  >({
    id: "test.resume.query",
    buildId: TestBuildId,
    captures: Schema.Struct({
      label: Schema.String,
    }),
    run: (captures) => Effect.succeed(`server:${captures.label}`),
  });

  const ClientQueryCode = Portable.code<
    { readonly label: string },
    { readonly label: string },
    readonly [],
    string,
    never,
    never
  >({
    id: "test.resume.query",
    buildId: TestBuildId,
    captures: Schema.Struct({
      label: Schema.String,
    }),
    run: (captures) => Effect.succeed(`client:${captures.label}`),
  });

  it("derives one canonical cache and single-flight identity from descriptor and keys", () => {
    const descriptor = Effect.runSync(
      Portable.describe(Portable.bind(QueryCode, { label: "todos" })),
    );
    expect(
      Portable.cacheKey(descriptor, ["todos:all", "todos", "todos"]),
    ).toBe(
      Portable.cacheKey(descriptor, ["todos", "todos:all"]),
    );
    expect(Portable.cacheKey(descriptor, ["todos"])).not.toBe(
      Portable.cacheKey(descriptor, ["todos", "todos:all"]),
    );
  });

  function makeQueryComponent() {
    return Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "data",
        () =>
          Component.query(Portable.bind(QueryCode, { label: "todos" }), {
            reactivityKeys: ["todos", "todos:all"],
          }),
        {
          resume: Resume.snapshotQuery(Schema.String),
        },
      ),
      (_props, bindings) => {
        const result = bindings.data();
        return result._tag === "Success" ? result.value : "pending";
      },
    ).pipe(Component.withDefinition({ name: "ResumeQueryCard" }));
  }

  it("collects a settled portable query snapshot with its executor descriptor", () => {
    const QueryCard = makeQueryComponent();
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(QueryCard, {}).pipe(Scope.provide(scope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.html).toBe(
      "<!--af:component:c0:start-->server:todos<!--af:component:c0:end-->",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toMatchObject({
      version: 2,
      buildId: TestBuildId,
      components: {
        c0: {
          definitionName: "ResumeQueryCard",
          bindings: {
            data: {
              kind: "query",
              key: "c0/data",
              value: "server:todos",
              executor: {
                version: 1,
                kind: "portable.code",
                id: "test.resume.query",
                buildId: TestBuildId,
                captures: { label: "todos" },
              },
              reactivityKeys: ["todos", "todos:all"],
            },
          },
        },
      },
    });
    expect(
      Effect.runSync(
        Resume.decodeManifest(result.serializedManifest, TestBuildId).pipe(
          Effect.provide(Serialization.layer),
        ),
      ),
    ).toEqual(result.manifest);
  });

  it("falls back with a diagnostic for unsettled query snapshots", () => {
    const Pending = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "data",
        () =>
          Component.query(
            Portable.bind(
              Portable.code<{}, {}, readonly [], string, never, never>({
                id: "test.resume.query-pending",
                buildId: TestBuildId,
                captures: Schema.Struct({}),
                run: () => Effect.never,
              }),
              {},
            ),
          ),
        {
          resume: Resume.snapshotQuery(Schema.String),
        },
      ),
      () => null,
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Pending, {}).pipe(Scope.provide(scope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.diagnostics).toMatchObject([
      {
        code: "unsettled-query-snapshot",
        componentId: "c0",
        binding: "data",
      },
    ]);
    if (result.manifest.version === 2) {
      const componentId = Schema.decodeUnknownSync(Resume.ComponentId)("c0");
      expect(result.manifest.components[componentId]?.bindings).toEqual({});
    }
  });

  it("falls back with a diagnostic for opaque query executors", () => {
    const Opaque = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "data",
        () => Component.query(() => Effect.succeed("opaque-value")),
        {
          resume: Resume.snapshotQuery(Schema.String),
        },
      ),
      () => null,
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Opaque, {}).pipe(Scope.provide(scope)),
        ),
      ),
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.diagnostics).toMatchObject([
      {
        code: "opaque-query-executor",
        componentId: "c0",
        binding: "data",
      },
    ]);
  });

  it("restores a settled query without loading its executor and lazy-loads it once on refresh", async () => {
    const QueryCard = makeQueryComponent();
    const serverScope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(QueryCard, {}).pipe(
            Scope.provide(serverScope),
          ),
        ),
      ),
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));

    let loads = 0;
    const resolver = Effect.runSync(
      Portable.makeResolver({
        "test.resume.query": () =>
          Effect.sync(() => {
            loads += 1;
            return ClientQueryCode;
          }),
      }),
    );
    const resolverLayer = Layer.succeed(Portable.Resolver, resolver);

    const restored = Effect.runSync(
      Resume.restoreStateBindings(QueryCard, result.manifest, "c0"),
    );
    expect(loads).toBe(0);
    expect(Component.renderWithBindings(QueryCard, {}, restored.bindings)).toBe(
      "server:todos",
    );
    expect(loads).toBe(0);
    expect(Resume.inspectHandle(restored.bindings.data)).toMatchObject({
      kind: "query",
      reactivityKeys: ["todos", "todos:all"],
    });

    const query = restored.queries["data"]!;
    expect(query.reactivityKeys).toEqual(["todos", "todos:all"]);
    if (result.manifest.version !== 2) {
      throw new Error("Expected a component manifest");
    }
    const querySnapshot = result.manifest.components[
      Schema.decodeUnknownSync(Resume.ComponentId)("c0")
    ]?.bindings[Schema.decodeUnknownSync(Resume.BindingName)("data")];
    if (querySnapshot?.kind !== "query") {
      throw new Error("Expected a query snapshot");
    }
    expect(query.cacheKey).toBe(
      Portable.cacheKey(
        querySnapshot.executor,
        querySnapshot.reactivityKeys,
      ),
    );
    const refresh = query.refresh;
    await Effect.runPromise(refresh.pipe(Effect.provide(resolverLayer)));
    expect(loads).toBe(1);
    expect(Component.renderWithBindings(QueryCard, {}, restored.bindings)).toBe(
      "client:todos",
    );

    await Effect.runPromise(refresh.pipe(Effect.provide(resolverLayer)));
    expect(loads).toBe(1);

    Effect.runSync(restored.dispose);
    expect(Resume.inspectHandle(restored.bindings.data)?.isDisposed()).toBe(
      true,
    );
    const disposedFailure = await Effect.runPromise(
      refresh.pipe(Effect.provide(resolverLayer), Effect.flip),
    );
    expect(disposedFailure._tag).toBe("ResumeRestoredQueryDisposedError");
  });

  it("revalidates a resumed query from its restored semantic keys", async () => {
    vi.stubGlobal("Node", class {});
    let setupRuns = 0;
    let queryLoads = 0;
    const seen: string[] = [];
    const QueryCard = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "data",
        () =>
          Effect.sync(() => {
            setupRuns += 1;
          }).pipe(
            Effect.flatMap(() =>
              Component.query(
                Portable.bind(QueryCode, { label: "todos" }),
                { reactivityKeys: ["todos"] },
              ),
            ),
          ),
        { resume: Resume.snapshotQuery(Schema.String) },
      ),
      (_props, bindings) => () => {
        const result = bindings.data();
        if (result._tag === "Success") seen.push(result.value);
        return null;
      },
    ).pipe(
      Component.withDefinition({ name: "RevalidatingQueryCard" }),
      Resume.addressable({
        id: "test.resume.query-card-activation",
        buildId: TestBuildId,
        props: Schema.Struct({}),
      }),
    );
    const serverScope = Scope.makeUnsafe();
    const collected = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(QueryCard, {}).pipe(
            Scope.provide(serverScope),
          ),
        ),
      ),
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));
    expect(setupRuns).toBe(1);

    const activation = Resume.activationOf(QueryCard);
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c0", "end"],
        ]),
        manifest: collected.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [activation.id]: activation,
          [ClientQueryCode.id]: () =>
            Effect.sync(() => {
              queryLoads += 1;
              return ClientQueryCode;
            }),
        },
        runtime,
      }),
    );

    await Effect.runPromise(installation.resume("c0"));
    expect(setupRuns).toBe(1);
    expect(queryLoads).toBe(0);
    expect(seen).toContain("server:todos");

    Atom.invalidateReactivity(["todos"]);
    await vi.waitFor(() => {
      expect(seen).toContain("client:todos");
    });
    expect(queryLoads).toBe(1);
    expect(setupRuns).toBe(1);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
    vi.unstubAllGlobals();
  });
});

describe("Resume portable query semantics", () => {
  it("falls back with a diagnostic when a query uses retry or poll schedules", () => {
    const RetryCode = Portable.code<
      {},
      {},
      readonly [],
      string,
      never,
      never
    >({
      id: "test.resume.query-retry",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () => Effect.succeed("retry-value"),
    });
    const Retrying = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "data",
        () =>
          Component.query(Portable.bind(RetryCode, {}), {
            retrySchedule: Schedule.recurs(1),
          }),
        {
          resume: Resume.snapshotQuery(Schema.String),
        },
      ),
      () => null,
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Retrying, {}).pipe(Scope.provide(scope)),
        )
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.diagnostics).toMatchObject([
      {
        code: "unsupported-query-semantics",
        componentId: "c0",
        binding: "data",
      },
    ]);
    if (result.manifest.version === 2) {
      const componentId = Schema.decodeUnknownSync(Resume.ComponentId)("c0");
      expect(result.manifest.components[componentId]?.bindings).toEqual({});
    }
  });
});

describe("Resume portable behaviors", () => {
  interface CounterElements {
    readonly root: { readonly id: string };
  }

  const AttachCode = Portable.code<
    { readonly label: string },
    { readonly label: string },
    readonly [CounterElements],
    { readonly attachedTo: string },
    never,
    never
  >({
    id: "test.resume.behavior-attach",
    buildId: TestBuildId,
    captures: Schema.Struct({ label: Schema.String }),
    run: (captures, elements) =>
      Effect.succeed({ attachedTo: `${captures.label}:${elements.root.id}` }),
  });

  it("records portable attachment metadata and preserves it through composition", () => {
    const portableBehavior = Behavior.portable(
      Portable.bind(AttachCode, { label: "hover" }),
    );
    expect(Behavior.inspectAttachment(portableBehavior)).toMatchObject({
      kind: "portable",
    });

    const withMeta = Behavior.withMetadata(portableBehavior, {
      events: { root: ["click"] },
    });
    expect(Behavior.inspectAttachment(withMeta).kind).toBe("portable");

    const secondPortable = Behavior.portable(
      Portable.bind(AttachCode, { label: "focus" }),
    );
    const composedPortable = Behavior.compose(
      portableBehavior,
      secondPortable,
    );
    const composedAttachment = Behavior.inspectAttachment(composedPortable);
    expect(composedAttachment.kind).toBe("portable");
    if (composedAttachment.kind === "portable") {
      expect(composedAttachment.executables).toHaveLength(2);
    }

    const opaqueBehavior = Behavior.make<CounterElements, {}>(
      () => Effect.succeed({}),
    );
    expect(Behavior.inspectAttachment(opaqueBehavior).kind).toBe("opaque");
    expect(
      Behavior.inspectAttachment(
        Behavior.compose(portableBehavior, opaqueBehavior),
      ).kind,
    ).toBe("opaque");
  });

  it("records a behavior attachment transform descriptor on the component", () => {
    const Base = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().value("root", () => ({ id: "r1" })),
      () => null,
    );

    const Portablized = Base.pipe(
      Behavior.attach(
        Behavior.portable(Portable.bind(AttachCode, { label: "hover" })),
        { select: (bindings) => ({ root: bindings.root }) },
      ),
    );
    expect(
      Component.inspect(Portablized).definition.transforms,
    ).toMatchObject([
      {
        kind: "component.withBehavior",
        phase: "setup",
        portability: "portable",
        codeIds: ["test.resume.behavior-attach"],
      },
    ]);

    const Opaqued = Base.pipe(
      Behavior.attach(
        Behavior.make<CounterElements, {}>(() => Effect.succeed({})),
        { select: (bindings) => ({ root: bindings.root }) },
      ),
    );
    expect(
      Component.inspect(Opaqued).definition.transforms,
    ).toMatchObject([
      {
        kind: "component.withBehavior",
        phase: "setup",
        portability: "opaque",
      },
    ]);
  });

  it("reattaches a portable behavior in a fresh Scope without rerunning setup", async () => {
    let setupRuns = 0;
    let acquired = 0;
    let released = 0;
    const ListenerCode = Portable.code<
      {},
      {},
      readonly [CounterElements],
      { readonly listening: () => boolean },
      never,
      Scope.Scope
    >({
      id: "test.resume.behavior-listener",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: (_captures, _elements) =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              acquired += 1;
            }),
            () =>
              Effect.sync(() => {
                released += 1;
              }),
          );
          return { listening: () => acquired > released };
        }),
    });

    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "count",
        () =>
          Effect.sync(() => {
            setupRuns += 1;
          }).pipe(Effect.flatMap(() => Component.state(41))),
        {
          resume: Resume.snapshotState(Schema.Number),
        },
      ),
      (_props, bindings) => bindings.count(),
    ).pipe(Component.withDefinition({ name: "ResumeBehaviorCounter" }));

    const serverScope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(
            Scope.provide(serverScope),
          ),
        )
      )
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));
    expect(setupRuns).toBe(1);

    const restored = Effect.runSync(
      Resume.restoreStateBindings(Counter, result.manifest, "c0"),
    );

    const behavior = Behavior.portable(Portable.bind(ListenerCode, {}));
    const attached = await Effect.runPromise(
      Behavior.attachScoped(behavior, { root: { id: "restored-root" } }),
    );
    expect(setupRuns).toBe(1);
    expect(acquired).toBe(1);
    expect(attached.bindings.listening()).toBe(true);

    await Effect.runPromise(attached.dispose);
    expect(released).toBe(1);
    expect(attached.bindings.listening()).toBe(false);
    await Effect.runPromise(attached.dispose);
    expect(released).toBe(1);

    Effect.runSync(restored.dispose);
    expect(setupRuns).toBe(1);
  });
});

describe("Milestone 8 expression collection and text restoration", () => {
  const TextExpression = expressionCode({
    id: "test.resume.expression.text",
    buildId: TestBuildId,
    captures: Schema.Struct({
      key: Schema.String,
      label: Schema.String,
    }),
    dependencies: Schema.Tuple([Schema.Unknown]),
    render: (captures) => {
      trackReactivityRuntime([captures.key]);
      return captures.label;
    },
  });
  const BindingExpression = expressionCode({
    id: "test.resume.expression.binding",
    buildId: TestBuildId,
    captures: Schema.Struct({ label: Schema.String }),
    dependencies: Schema.Tuple([Schema.Number]),
    render: (_captures, [count]) => `Count: ${count}`,
  });

  function renderExpression(
    expression: ResumableExpression<string>,
  ): string {
    return renderToString(() => {
      const span = template("<span>")();
      insert(span, expression);
      return span;
    });
  }

  function renderBindingExpression(
    count: Resume.InspectableStateHandle<number>,
  ): Element {
    const span = template("<span>")();
    insert(
      span,
      bindExpression(
        BindingExpression,
        { label: "Count" },
        [count],
      ),
    );
    return span;
  }

  it("reads active expression dependencies when the accessor runs", () => {
    const count = Effect.runSync(Component.state(1));
    const expression = bindExpression(
      BindingExpression,
      { label: "Count" },
      [count],
    );

    expect(expression()).toBe("Count: 1");
    count.set(2);
    expect(expression()).toBe("Count: 2");
  });

  it("emits a v4 portable text target and durable SSR region", () => {
    const expression = bindExpression(
      TextExpression,
      { key: "count:1", label: "Count: 1" },
      ["count:1"],
    );
    const result = collect(() => renderExpression(expression));

    expect(result.html).toBe(
      "<span><!--af:expr:x0:start-->Count: 1<!--af:expr:x0:end--></span>",
    );
    expect(result.manifest).toMatchObject({
      version: 4,
      components: {},
      expressions: {
        x0: {
          target: {
            kind: "text",
          },
          code: {
            id: "test.resume.expression.text",
            buildId: TestBuildId,
            captures: { key: "count:1", label: "Count: 1" },
          },
          deps: ["count:1"],
        },
      },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("continues to decode, scan, and install legacy v3 text manifests", async () => {
    const result = collect(() =>
      renderExpression(
        bindExpression(
          TextExpression,
          { key: "legacy", label: "Legacy" },
          ["legacy"],
        ),
      )
    );
    if (result.manifest.version !== 4) {
      throw new Error("Expected a v4 expression manifest.");
    }
    const expressionId =
      Schema.decodeUnknownSync(Resume.ExpressionId)("x0");
    const entry = result.manifest.expressions[expressionId]!;
    if (entry.target.kind !== "text") {
      throw new Error("Expected a text expression target.");
    }
    const legacyManifest: Resume.ManifestV3 = {
      version: 3,
      buildId: result.manifest.buildId,
      events: result.manifest.events,
      components: result.manifest.components,
      expressions: {
        [expressionId]: {
          region: { kind: "comment-pair" },
          code: entry.code,
          deps: entry.deps,
          ...(entry.inputs === undefined ? {} : { inputs: entry.inputs }),
          ...(entry.component === undefined
            ? {}
            : { component: entry.component }),
        },
      },
    };
    const decoded = Effect.runSync(
      Resume.decodeManifest(
        Serialization.encodeSync(Resume.ManifestV3Schema, legacyManifest),
        TestBuildId,
      ).pipe(Effect.provide(Serialization.layer)),
    );
    const start = {
      nodeType: 8,
      nodeName: "#comment",
      data: "af:expr:x0:start",
      childNodes: [],
    };
    const end = {
      nodeType: 8,
      nodeName: "#comment",
      data: "af:expr:x0:end",
      childNodes: [],
    };
    const targets = Effect.runSync(
      Resume.scanExpressionTargets(
        { childNodes: [start, end] } as unknown as Document,
        decoded,
      ),
    );
    const runtimeRoot = new FakeRegionDocument([
      { kind: "expression", id: "x0", edge: "start" },
      { kind: "text", value: "Legacy" },
      { kind: "expression", id: "x0", edge: "end" },
    ]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: runtimeRoot as unknown as Document,
        manifest: decoded,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [TextExpression.id]: TextExpression,
        },
        runtime,
      }),
    );

    expect(decoded.version).toBe(3);
    expect(targets.get(expressionId)).toMatchObject({
      kind: "text",
      boundary: { start, end },
    });
    expect(installation.inspect().expressionControllers).toBe(1);
    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("scans mixed v4 targets in one pass and removes element markers after validation", () => {
    const result = collect(() =>
      renderExpression(
        bindExpression(
          TextExpression,
          { key: "mixed", label: "Mixed" },
          ["mixed"],
        ),
      )
    );
    if (result.manifest.version !== 4) {
      throw new Error("Expected a v4 expression manifest.");
    }
    const x0 = Schema.decodeUnknownSync(Resume.ExpressionId)("x0");
    const x1 = Schema.decodeUnknownSync(Resume.ExpressionId)("x1");
    const x2 = Schema.decodeUnknownSync(Resume.ExpressionId)("x2");
    const x3 = Schema.decodeUnknownSync(Resume.ExpressionId)("x3");
    const base = result.manifest.expressions[x0]!;
    const manifest: Resume.ManifestV4 = {
      ...result.manifest,
      expressions: {
        [x0]: base,
        [x1]: {
          ...base,
          target: { kind: "attribute", name: "aria-label" },
        },
        [x2]: {
          ...base,
          target: { kind: "class" },
        },
        [x3]: {
          ...base,
          target: {
            kind: "style-property",
            name: Schema.decodeUnknownSync(
              Resume.ExpressionStylePropertyName,
            )("background-color"),
          },
        },
      },
    };
    const start = {
      nodeType: 8,
      nodeName: "#comment",
      data: "af:expr:x0:start",
      childNodes: [],
    };
    const end = {
      nodeType: 8,
      nodeName: "#comment",
      data: "af:expr:x0:end",
      childNodes: [],
    };
    const element = fakeExpressionTargetElement("x1 x2 x3");
    const targets = Effect.runSync(
      Resume.scanExpressionTargets(
        { childNodes: [start, end, element] } as unknown as Document,
        manifest,
      ),
    );

    expect([...targets.keys()]).toEqual(["x0", "x1", "x2", "x3"]);
    expect(targets.get(x0)?.kind).toBe("text");
    expect(targets.get(x1)).toMatchObject({
      kind: "attribute",
      element,
      name: "aria-label",
    });
    expect(targets.get(x2)).toMatchObject({ kind: "class", element });
    expect(targets.get(x3)).toMatchObject({
      kind: "style-property",
      element,
      name: "background-color",
    });
    expect(
      element.getAttribute(Resume.ExpressionElementMarkerAttribute),
    ).toBeNull();
  });

  it("includes an element root and rolls back earlier marker cleanup on failure", () => {
    const result = collect(() =>
      renderExpression(
        bindExpression(
          TextExpression,
          { key: "root-target", label: "Root" },
          ["root-target"],
        ),
      )
    );
    if (result.manifest.version !== 4) {
      throw new Error("Expected a v4 expression manifest.");
    }
    const x0 = Schema.decodeUnknownSync(Resume.ExpressionId)("x0");
    const x1 = Schema.decodeUnknownSync(Resume.ExpressionId)("x1");
    const base = result.manifest.expressions[x0]!;
    const rootManifest: Resume.ManifestV4 = {
      ...result.manifest,
      expressions: {
        [x0]: {
          ...base,
          target: { kind: "class" },
        },
      },
    };
    const rootElement = fakeExpressionTargetElement("x0");
    const targets = Effect.runSync(
      Resume.scanExpressionTargets(
        rootElement as unknown as Element,
        rootManifest,
      ),
    );
    expect(targets.get(x0)).toMatchObject({
      kind: "class",
      element: rootElement,
    });
    expect(
      rootElement.getAttribute(Resume.ExpressionElementMarkerAttribute),
    ).toBeNull();

    const cleanupManifest: Resume.ManifestV4 = {
      ...rootManifest,
      expressions: {
        [x0]: rootManifest.expressions[x0]!,
        [x1]: {
          ...base,
          target: { kind: "class" },
        },
      },
    };
    const first = fakeExpressionTargetElement("x0");
    const second = fakeExpressionTargetElement("x1", {
      removeError: "cleanup failed",
    });
    const failure = Effect.runSync(
      Resume.scanExpressionTargets(
        { childNodes: [first, second] } as unknown as Document,
        cleanupManifest,
      ).pipe(Effect.flip),
    );
    expect(failure._tag).toBe(
      "ResumeExpressionElementMarkerCleanupError",
    );
    expect(
      first.getAttribute(Resume.ExpressionElementMarkerAttribute),
    ).toBe("x0");
    expect(
      second.getAttribute(Resume.ExpressionElementMarkerAttribute),
    ).toBe("x1");
  });

  it("fails closed for invalid, duplicate, missing, and wrong-kind element targets", () => {
    const result = collect(() =>
      renderExpression(
        bindExpression(
          TextExpression,
          { key: "target-errors", label: "Target" },
          ["target-errors"],
        ),
      )
    );
    if (result.manifest.version !== 4) {
      throw new Error("Expected a v4 expression manifest.");
    }
    const expressionId =
      Schema.decodeUnknownSync(Resume.ExpressionId)("x0");
    const base = result.manifest.expressions[expressionId]!;
    const elementManifest: Resume.ManifestV4 = {
      ...result.manifest,
      expressions: {
        [expressionId]: {
          ...base,
          target: { kind: "class" },
        },
      },
    };
    const invalidElement = fakeExpressionTargetElement("x0  x0");
    const invalid = Effect.runSync(
      Resume.scanExpressionTargets(
        { childNodes: [invalidElement] } as unknown as Document,
        elementManifest,
      ).pipe(Effect.flip),
    );
    const first = fakeExpressionTargetElement("x0");
    const second = fakeExpressionTargetElement("x0");
    const duplicate = Effect.runSync(
      Resume.scanExpressionTargets(
        { childNodes: [first, second] } as unknown as Document,
        elementManifest,
      ).pipe(Effect.flip),
    );
    const missing = Effect.runSync(
      Resume.scanExpressionTargets(
        { childNodes: [] } as unknown as Document,
        elementManifest,
      ).pipe(Effect.flip),
    );
    const unknownElement = fakeExpressionTargetElement("x9");
    const unknown = Effect.runSync(
      Resume.scanExpressionTargets(
        { childNodes: [unknownElement] } as unknown as Document,
        elementManifest,
      ).pipe(Effect.flip),
    );
    const wrongKindElement = fakeExpressionTargetElement("x0");
    const wrongKind = Effect.runSync(
      Resume.scanExpressionTargets(
        { childNodes: [wrongKindElement] } as unknown as Document,
        result.manifest,
      ).pipe(Effect.flip),
    );

    expect(invalid._tag).toBe(
      "ResumeInvalidExpressionElementMarkerError",
    );
    expect(duplicate._tag).toBe(
      "ResumeDuplicateExpressionElementTargetError",
    );
    expect(missing._tag).toBe(
      "ResumeMissingExpressionElementTargetError",
    );
    expect(unknown._tag).toBe(
      "ResumeUnknownExpressionElementTargetError",
    );
    expect(wrongKind._tag).toBe(
      "ResumeExpressionTargetKindMismatchError",
    );
    expect(
      invalidElement.getAttribute(
        Resume.ExpressionElementMarkerAttribute,
      ),
    ).toBe("x0  x0");
    expect(
      first.getAttribute(Resume.ExpressionElementMarkerAttribute),
    ).toBe("x0");
  });

  it("validates closest component ownership before removing target markers", () => {
    const result = collect(() =>
      renderExpression(
        bindExpression(
          TextExpression,
          { key: "owned-target", label: "Owned" },
          ["owned-target"],
        ),
      )
    );
    if (result.manifest.version !== 4) {
      throw new Error("Expected a v4 expression manifest.");
    }
    const expressionId =
      Schema.decodeUnknownSync(Resume.ExpressionId)("x0");
    const componentId =
      Schema.decodeUnknownSync(Resume.ComponentId)("c0");
    const base = result.manifest.expressions[expressionId]!;
    const manifest: Resume.ManifestV4 = {
      ...result.manifest,
      components: {
        [componentId]: {
          region: { kind: "comment-pair" },
          bindings: {},
        },
      },
      expressions: {
        [expressionId]: {
          ...base,
          target: { kind: "class" },
          component: componentId,
        },
      },
    };
    const makeRoot = (targetInside: boolean) => {
      const root = { childNodes: [] as unknown[] };
      const start = {
        nodeType: 8,
        nodeName: "#comment",
        data: "af:component:c0:start",
        childNodes: [],
        parentNode: root,
        nextSibling: null as unknown,
      };
      const end = {
        nodeType: 8,
        nodeName: "#comment",
        data: "af:component:c0:end",
        childNodes: [],
        parentNode: root,
        nextSibling: null as unknown,
      };
      const element = fakeExpressionTargetElement("x0") as
        FakeExpressionTargetElement & {
          parentNode: typeof root;
          nextSibling: unknown;
        };
      element.parentNode = root;
      if (targetInside) {
        start.nextSibling = element;
        element.nextSibling = end;
        root.childNodes = [start, element, end];
      } else {
        element.nextSibling = start;
        start.nextSibling = end;
        root.childNodes = [element, start, end];
      }
      return { root, element };
    };
    const inside = makeRoot(true);
    const targets = Effect.runSync(
      Resume.scanExpressionTargets(
        inside.root as unknown as Document,
        manifest,
      ),
    );
    const outside = makeRoot(false);
    const ownershipFailure = Effect.runSync(
      Resume.scanExpressionTargets(
        outside.root as unknown as Document,
        manifest,
      ).pipe(Effect.flip),
    );

    expect(targets.get(expressionId)).toMatchObject({
      kind: "class",
      element: inside.element,
    });
    expect(
      inside.element.getAttribute(
        Resume.ExpressionElementMarkerAttribute,
      ),
    ).toBeNull();
    expect(ownershipFailure._tag).toBe(
      "ResumeExpressionOwnershipError",
    );
    expect(
      outside.element.getAttribute(
        Resume.ExpressionElementMarkerAttribute,
      ),
    ).toBe("x0");
  });

  // Superseded by M8c.4: non-text targets are installable, so a class target is
  // no longer refused for being schema-valid-but-unsupported. What must still
  // fail closed is a manifest whose element target has no marker in the DOM.
  it("fails an element target closed when the served DOM carries no marker for it", async () => {
    const result = collect(() =>
      renderExpression(
        bindExpression(
          TextExpression,
          { key: "not-yet-installable", label: "Pending" },
          ["not-yet-installable"],
        ),
      )
    );
    if (result.manifest.version !== 4) {
      throw new Error("Expected a v4 expression manifest.");
    }
    const expressionId =
      Schema.decodeUnknownSync(Resume.ExpressionId)("x0");
    const entry = result.manifest.expressions[expressionId]!;
    const manifest: Resume.ManifestV4 = {
      ...result.manifest,
      expressions: {
        [expressionId]: {
          ...entry,
          target: { kind: "class" },
        },
      },
    };
    const runtime = ManagedRuntime.make(Layer.empty);
    const failure = Effect.runSync(
      Resume.installClient({
        root: new FakeRoot() as unknown as Document,
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {},
        runtime,
      }).pipe(Effect.flip),
    );

    expect(failure._tag).toBe(
      "ResumeMissingExpressionElementTargetError",
    );
    await runtime.dispose();
  });

  it("rejects unsafe or unsupported v4 target names at the schema boundary", () => {
    const decode = Schema.decodeUnknownSync(Resume.ExpressionTargetSchema);

    expect(() =>
      decode({ kind: "attribute", name: "href" })
    ).toThrow();
    expect(() =>
      decode({ kind: "attribute", name: "onclick" })
    ).toThrow();
    expect(() =>
      decode({ kind: "style-property", name: "cssText" })
    ).toThrow();
    expect(() =>
      decode({ kind: "style-property", name: "background-image" })
    ).toThrow();
    expect(
      decode({ kind: "attribute", name: "data-state" }),
    ).toEqual({ kind: "attribute", name: "data-state" });
    expect(
      decode({ kind: "style-property", name: "--progress" }),
    ).toEqual({ kind: "style-property", name: "--progress" });
  });

  it("assigns distinct document-local instances when one expression is inserted twice", () => {
    const expression = bindExpression(
      TextExpression,
      { key: "shared", label: "Shared" },
      ["shared"],
    );
    const result = collect(() =>
      renderToString(() => {
        const first = template("<span>")();
        const second = template("<span>")();
        insert(first, expression);
        insert(second, expression);
        return [first, second];
      })
    );

    expect(result.html).toContain("af:expr:x0:start");
    expect(result.html).toContain("af:expr:x1:start");
    if (result.manifest.version !== 4) {
      throw new Error("Expected a v4 expression manifest.");
    }
    expect(Object.keys(result.manifest.expressions)).toEqual(["x0", "x1"]);
    const firstId = Schema.decodeUnknownSync(Resume.ExpressionId)("x0");
    const secondId = Schema.decodeUnknownSync(Resume.ExpressionId)("x1");
    expect(result.manifest.expressions[firstId]?.code.id).toBe(
      result.manifest.expressions[secondId]?.code.id,
    );
  });

  it("separates hierarchical trigger keys from ordered dependency inputs", async () => {
    const users = Reactivity.Key.make("users");
    const user = users.child("alice");
    const HierarchicalExpression = expressionCode({
      id: "test.resume.expression.hierarchical",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Undefined]),
      render: () => {
        trackReactivityRuntime([user]);
        return "Alice";
      },
    });
    const result = collect(() =>
      renderExpression(
        bindExpression(HierarchicalExpression, {}, [user]),
      )
    );

    expect(result.manifest).toMatchObject({
      version: 4,
      expressions: {
        x0: {
          deps: ["users", "users:alice"],
          inputs: ["users:alice"],
        },
      },
    });
    expect(result.diagnostics).toEqual([]);

    const root = new FakeRegionDocument([
      { kind: "expression", id: "x0", edge: "start" },
      { kind: "text", value: "Alice" },
      { kind: "expression", id: "x0", edge: "end" },
    ]);
    let loads = 0;
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [HierarchicalExpression.id]: () =>
            Effect.sync(() => {
              loads += 1;
              return HierarchicalExpression;
            }),
        },
        runtime,
      }),
    );

    Atom.invalidateReactivity([users]);
    await vi.waitFor(() => {
      expect(loads).toBe(1);
      expect(installation.pending()).toBe(0);
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("resolves state-handle dependencies to implicit binding keys", () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => {
        const span = template("<span>")();
        insert(
          span,
          bindExpression(
            BindingExpression,
            { label: "Count" },
            [bindings.count],
          ),
        );
        return span;
      },
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
        )
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.manifest).toMatchObject({
      version: 4,
      expressions: {
        x0: {
          deps: ["af:binding:c0/count"],
          component: "c0",
        },
      },
    });
    expect(result.html).toContain(
      "<!--af:component:c0:start--><span><!--af:expr:x0:start-->Count: 1<!--af:expr:x0:end--></span><!--af:component:c0:end-->",
    );
    const restored = Effect.runSync(
      Resume.restoreStateBindings(Counter, result.manifest, "c0"),
    );
    expect(restored.bindings.count()).toBe(1);
    Effect.runSync(restored.dispose);
  });

  it("fails closed on undeclared reads, unsupported output, and ghost regions", () => {
    const undeclared = bindExpression(
      TextExpression,
      { key: "count:actual", label: "Count" },
      ["count:declared"],
    );
    const undeclaredResult = collect(() => renderExpression(undeclared));

    const UnsupportedExpression = expressionCode({
      id: "test.resume.expression.unsupported",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([]),
      render: (() => null) as unknown as () => string,
    });
    const unsupportedResult = collect(() =>
      renderExpression(bindExpression(UnsupportedExpression, {}, []))
    );

    const ghostResult = collect(() =>
      renderToString(() => {
        bindExpression(
          TextExpression,
          { key: "ghost", label: "Ghost" },
          ["ghost"],
        );
        return "plain";
      })
    );

    expect(undeclaredResult.html).toBe("<span>Count</span>");
    expect(undeclaredResult.manifest.version).toBe(1);
    expect(undeclaredResult.diagnostics).toMatchObject([
      { code: "undeclared-expression-dependency" },
    ]);
    expect(unsupportedResult.manifest.version).toBe(1);
    expect(unsupportedResult.diagnostics).toMatchObject([
      { code: "unsupported-expression-output" },
    ]);
    expect(ghostResult.diagnostics).toMatchObject([
      { code: "missing-expression-boundary" },
    ]);
  });

  it("does not let authored keys impersonate installation-owned binding keys", () => {
    const expression = bindExpression(
      TextExpression,
      {
        key: "af:binding:c0/count",
        label: "Count",
      },
      ["af:binding:c0/count"],
    );
    const result = collect(() => renderExpression(expression));

    expect(result.html).toBe("<span>Count</span>");
    expect(result.manifest.version).toBe(1);
    expect(result.diagnostics).toMatchObject([
      {
        code: "reserved-expression-dependency",
        disposition: "fallback-required",
      },
    ]);
  });

  it("rejects state handles owned by a different component boundary", () => {
    let firstCount: Resume.InspectableStateHandle<number> | undefined;
    const First = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => {
        firstCount = bindings.count;
        return "first";
      },
    );
    const Second = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("local", () => Component.state(0), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      () => {
        if (firstCount === undefined) {
          throw new Error("The first component did not publish its state.");
        }
        return renderBindingExpression(firstCount);
      },
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() => [
        Effect.runSync(
          Component.renderEffect(First, {}).pipe(Scope.provide(scope)),
        ),
        Effect.runSync(
          Component.renderEffect(Second, {}).pipe(Scope.provide(scope)),
        ),
      ])
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.manifest.version).toBe(2);
    expect(result.html).not.toContain("af:expr:");
    expect(result.diagnostics).toMatchObject([
      {
        code: "expression-dependency-ownership",
        componentId: "c1",
        disposition: "fallback-required",
      },
    ]);
  });

  it("validates expression boundary identity and completeness", () => {
    const expression = bindExpression(
      TextExpression,
      { key: "count:1", label: "Count" },
      ["count:1"],
    );
    const result = collect(() => renderExpression(expression));
    if (result.manifest.version !== 4) {
      throw new Error("Expected a v4 expression manifest.");
    }
    const comment = (data: string) => ({
      nodeType: 8,
      nodeName: "#comment",
      data,
      childNodes: [],
    });
    const root = (childNodes: ReadonlyArray<unknown>) =>
      ({ childNodes }) as unknown as Document;
    const start = comment("af:expr:x0:start");
    const end = comment("af:expr:x0:end");

    const boundaries = Effect.runSync(
      Resume.scanExpressionBoundaries(
        root([start, { childNodes: [] }, end]),
        result.manifest,
      ),
    );
    const missing = Effect.runSync(
      Resume.scanExpressionBoundaries(root([start]), result.manifest).pipe(
        Effect.flip,
      ),
    );
    const malformed = Effect.runSync(
      Resume.scanExpressionBoundaries(
        root([comment("af:expr:not-an-id:start")]),
        result.manifest,
      ).pipe(Effect.flip),
    );
    const x0 = Schema.decodeUnknownSync(Resume.ExpressionId)("x0");
    const x1 = Schema.decodeUnknownSync(Resume.ExpressionId)("x1");
    const crossingManifest: Resume.Manifest = {
      ...result.manifest,
      expressions: {
        ...result.manifest.expressions,
        [x1]: result.manifest.expressions[x0]!,
      },
    };
    const crossing = Effect.runSync(
      Resume.scanExpressionBoundaries(
        root([
          comment("af:expr:x0:start"),
          comment("af:expr:x1:start"),
          comment("af:expr:x0:end"),
          comment("af:expr:x1:end"),
        ]),
        crossingManifest,
      ).pipe(Effect.flip),
    );

    expect([...boundaries.keys()]).toEqual(["x0"]);
    expect(boundaries.get(
      x0,
    )).toMatchObject({ start, end });
    expect(missing._tag).toBe("ResumeMissingExpressionBoundaryError");
    expect(malformed._tag).toBe(
      "ResumeInvalidExpressionBoundaryMarkerError",
    );
    expect(crossing._tag).toBe("ResumeExpressionBoundaryNestingError");
  });

  it("rejects non-canonical expression input metadata before installing subscribers", async () => {
    const expression = bindExpression(
      TextExpression,
      { key: "count:1", label: "Count" },
      ["count:1"],
    );
    const result = collect(() => renderExpression(expression));
    if (result.manifest.version !== 4) {
      throw new Error("Expected a v4 expression manifest.");
    }
    const expressionId = Schema.decodeUnknownSync(Resume.ExpressionId)("x0");
    const entry = result.manifest.expressions[expressionId]!;
    const invalidManifest = {
      ...result.manifest,
      expressions: {
        ...result.manifest.expressions,
        [expressionId]: {
          ...entry,
          inputs: ["not-declared"],
        },
      },
    } as unknown as Resume.Manifest;
    const root = new FakeRegionDocument([
      { kind: "expression", id: "x0", edge: "start" },
      { kind: "text", value: "Count" },
      { kind: "expression", id: "x0", edge: "end" },
    ]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const error = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: invalidManifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {},
        runtime,
      }).pipe(Effect.flip),
    );

    expect(error._tag).toBe(
      "ResumeExpressionDependencyMetadataError",
    );
    await runtime.dispose();
  });

  it("attributes an oversized payload to its largest expression entry", () => {
    const expression = bindExpression(
      TextExpression,
      { key: "large", label: "x".repeat(2_000) },
      ["large"],
    );
    const error = Effect.runSync(
      Resume.collect(() => renderExpression(expression), {
        buildId: TestBuildId,
        maxPayloadBytes: 256,
      }).pipe(
        Effect.provide(Serialization.layer),
        Effect.flip,
      ),
    );

    expect(error).toMatchObject({
      _tag: "ResumePayloadTooLargeError",
      largestEntryKind: "expression",
      largestEntryId: "x0",
    });
    if (error._tag !== "ResumePayloadTooLargeError") {
      throw new Error(`Expected payload error, received ${error._tag}.`);
    }
    expect(error.largestEntryBytes).toBeGreaterThan(1_000);
  });

  it("lazily coalesces dormant state writes and reuses the SSR text node", async () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => renderBindingExpression(bindings.count),
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
        )
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    const root = expressionComponentBoundaryRoot();
    const originalTextNode = root.expressionTextNode();
    const diagnostics: Resume.ClientDiagnostic[] = [];
    let loads = 0;
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [BindingExpression.id]: () =>
            Effect.sync(() => {
              loads += 1;
              return BindingExpression;
            }),
        },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    expect(loads).toBe(0);
    expect(installation.inspect()).toMatchObject({
      disposed: false,
      pendingFibers: 0,
      boundaryControllers: 1,
      boundarySubscribers: 0,
      boundaries: {
        dormant: 1,
        resuming: 0,
        activating: 0,
        active: 0,
        failed: 0,
        disposed: 0,
      },
      expressionControllers: 1,
      expressionDependencyKeys: 1,
      expressionSubscriptions: 1,
      runningExpressions: 0,
      queuedExpressions: 0,
      bindingValues: 1,
      bindingOverrides: 0,
    });
    Atom.invalidateReactivity(["af:binding:c0/count"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toBe(0);
    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 1),
    );
    await Promise.resolve();
    expect(loads).toBe(0);

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 2),
    );
    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 3),
    );

    await vi.waitFor(() => {
      expect(root.expressionText()).toBe("Count: 3");
      expect(installation.pending()).toBe(0);
    });
    expect(loads).toBe(1);
    expect(root.expressionTextNode()).toBe(originalTextNode);
    expect(diagnostics).toEqual([]);

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 4),
    );
    await vi.waitFor(() => {
      expect(root.expressionText()).toBe("Count: 4");
    });
    expect(loads).toBe(1);

    await Effect.runPromise(installation.dispose);
    expect(installation.inspect()).toMatchObject({
      disposed: true,
      pendingFibers: 0,
      eventListeners: 0,
      boundaryControllers: 0,
      boundarySubscribers: 0,
      boundaries: {
        disposed: 1,
      },
      expressionControllers: 0,
      expressionDependencyKeys: 0,
      expressionSubscriptions: 0,
      runningExpressions: 0,
      queuedExpressions: 0,
      bindingValues: 0,
      bindingOverrides: 0,
    });
    await runtime.dispose();
  });

  it("drops an in-flight stale expression result and reruns with the latest write", async () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => renderBindingExpression(bindings.count),
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
        )
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let loads = 0;
    const root = expressionComponentBoundaryRoot();
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [BindingExpression.id]: () =>
            Effect.promise(async () => {
              loads += 1;
              await gate;
              return BindingExpression;
            }),
        },
        runtime,
      }),
    );

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 2),
    );
    await vi.waitFor(() => expect(loads).toBe(1));
    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 3),
    );
    release();

    await vi.waitFor(() => {
      expect(root.expressionText()).toBe("Count: 3");
      expect(installation.pending()).toBe(0);
    });
    expect(loads).toBe(1);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("rejects a state snapshot and expression codec mismatch during collection", () => {
    const MismatchedExpression = expressionCode({
      id: "test.resume.expression.mismatched-input",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Number]),
      render: (_captures, [value]) => `Value: ${value}`,
    });
    const Mismatched = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "value",
        () => Component.state(1),
        { resume: Resume.snapshotState(Schema.NumberFromString) },
      ),
      (_props, bindings) => {
        const span = template("<span>")();
        insert(
          span,
          bindExpression(MismatchedExpression, {}, [bindings.value]),
        );
        return span;
      },
    );
    const scope = Scope.makeUnsafe();
    try {
      const failure = Effect.runSync(
        Resume.collect(
          () =>
            renderToString(() =>
              Effect.runSync(
                Component.renderEffect(Mismatched, {}).pipe(
                  Scope.provide(scope),
                ),
              )
            ),
          { buildId: TestBuildId },
        ).pipe(
          Effect.flip,
          Effect.provide(Serialization.layer),
        ),
      );
      expect(failure._tag).toBe("ResumeExpressionInputDecodeError");
    } finally {
      Effect.runSync(Scope.close(scope, Exit.void));
    }
  });

  it("encodes transformed state writes without end-user casts", async () => {
    const StockExpression = expressionCode({
      id: "test.resume.expression.stock",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.NumberFromString]),
      render: (_captures, [stock]) => `Stock: ${stock}`,
    });
    const Stock = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "stock",
        () => Component.state(1),
        { resume: Resume.snapshotState(Schema.NumberFromString) },
      ),
      (_props, bindings) => {
        const span = template("<span>")();
        insert(
          span,
          bindExpression(StockExpression, {}, [bindings.stock]),
        );
        return span;
      },
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Stock, {}).pipe(Scope.provide(scope)),
        )
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    const root = expressionComponentBoundaryRoot("Stock: 1");
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [StockExpression.id]: StockExpression,
        },
        runtime,
      }),
    );

    Effect.runSync(
      installation.writeBinding(
        "c0",
        "stock",
        Schema.NumberFromString,
        2,
      ),
    );
    await vi.waitFor(() => {
      expect(root.expressionText()).toBe("Stock: 2");
    });

    const nonJson = Effect.runSync(
      installation.writeBinding(
        "c0",
        "stock",
        Schema.Number,
        Number.NaN,
      ).pipe(Effect.flip),
    );
    expect(nonJson._tag).toBe(
      "ResumeBindingSnapshotWriteEncodeError",
    );
    expect(root.expressionText()).toBe("Stock: 2");

    const encodeStarted = Effect.runSync(Deferred.make<void>());
    const releaseEncode = Effect.runSync(Deferred.make<void>());
    const GatedNumber = Schema.Number.pipe(
      Schema.decode({
        decode: SchemaGetter.passthrough<number>(),
        encode: SchemaGetter.checkEffect<number>(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(encodeStarted, undefined);
            yield* Deferred.await(releaseEncode);
            return undefined;
          })
        ),
      }),
    );
    const staleWrite = Effect.runPromise(
      installation.writeBinding(
        "c0",
        "stock",
        GatedNumber,
        3,
      ).pipe(Effect.flip),
    );
    await Effect.runPromise(Deferred.await(encodeStarted));
    await Effect.runPromise(installation.dispose);
    Effect.runSync(Deferred.succeed(releaseEncode, undefined));
    expect((await staleWrite)._tag).toBe(
      "ResumeBindingSnapshotWriteDisposedError",
    );
    expect(root.expressionText()).toBe("Stock: 2");

    await runtime.dispose();
  });

  it("reports dependency decoding failures and recovers on the next valid write", async () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => renderBindingExpression(bindings.count),
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
        )
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    const root = expressionComponentBoundaryRoot();
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [BindingExpression.id]: BindingExpression,
        },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    Effect.runSync(
      installation.writeBindingEncoded("c0", "count", "invalid"),
    );
    await vi.waitFor(() => {
      expect(diagnostics).toMatchObject([
        {
          code: "expression-execution-failure",
          componentId: "c0",
          expressionId: "x0",
        },
      ]);
    });
    expect(root.expressionText()).toBe("Count: 1");

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 2),
    );
    await vi.waitFor(() => {
      expect(root.expressionText()).toBe("Count: 2");
    });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("makes expression disposal terminal before a queued write can load code", async () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => renderBindingExpression(bindings.count),
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
        )
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    const root = expressionComponentBoundaryRoot();
    let loads = 0;
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [BindingExpression.id]: () =>
            Effect.sync(() => {
              loads += 1;
              return BindingExpression;
            }),
        },
        runtime,
      }),
    );

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 2),
    );
    Effect.runSync(installation.dispose);
    Effect.runSync(installation.dispose);
    await Promise.resolve();
    await Promise.resolve();

    expect(loads).toBe(0);
    expect(root.expressionText()).toBe("Count: 1");
    const disposed = Effect.runSync(
      installation.writeBinding(
        "c0",
        "count",
        Schema.Number,
        3,
      ).pipe(Effect.flip),
    );
    expect(disposed._tag).toBe("ResumeBindingSnapshotWriteDisposedError");

    await runtime.dispose();
  });

  it("hands expression ownership to activation before queued work can run", async () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => renderBindingExpression(bindings.count),
    ).pipe(
      Component.withDefinition({ name: "ExpressionHandoffCounter" }),
      Resume.addressable({
        id: "test.resume.expression-handoff-counter",
        buildId: TestBuildId,
        props: Schema.Struct({}),
      }),
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
        )
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    const root = expressionComponentBoundaryRoot();
    const activation = Resume.activationOf(Counter);
    let expressionLoads = 0;
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [activation.id]: () => Effect.never,
          [BindingExpression.id]: () =>
            Effect.sync(() => {
              expressionLoads += 1;
              return BindingExpression;
            }),
        },
        runtime,
      }),
    );

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 2),
    );
    const activationExit = Effect.runPromiseExit(
      installation.activate("c0"),
    );
    await vi.waitFor(() => {
      expect(installation.boundaryState("c0")).toEqual({
        status: "activating",
      });
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(expressionLoads).toBe(0);
    expect(root.expressionText()).toBe("Count: 1");

    await Effect.runPromise(installation.dispose);
    expect(Exit.isFailure(await activationExit)).toBe(true);
    expect(installation.boundaryState("c0")).toEqual({
      status: "disposed",
    });
    expect(expressionLoads).toBe(0);

    await runtime.dispose();
  });

  it("rolls a typed activation failure back to dormant ownership and permits one retry", async () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => renderBindingExpression(bindings.count),
    ).pipe(
      Component.withDefinition({ name: "RetryableActivationCounter" }),
      Resume.addressable({
        id: "test.resume.retryable-activation-counter",
        buildId: TestBuildId,
        props: Schema.Struct({}),
      }),
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
        )
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    const activation = Resume.activationOf(Counter);
    let loadAttempts = 0;
    let executions = 0;
    let disposals = 0;
    const RetryableActivation = Portable.code<
      {},
      {},
      readonly [Resume.ComponentActivationContext],
      Resume.ComponentActivationMount,
      never,
      never
    >({
      id: activation.id,
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () =>
        Effect.sync(() => {
          executions += 1;
          return {
            dispose: Effect.sync(() => {
              disposals += 1;
            }),
          };
        }),
    });
    const root = expressionComponentBoundaryRoot();
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [activation.id]: () =>
            Effect.suspend(() => {
              loadAttempts += 1;
              return loadAttempts === 1
                ? Effect.fail("transient-activation-load-failure")
                : Effect.succeed(RetryableActivation);
            }),
          [BindingExpression.id]: BindingExpression,
        },
        runtime,
      }),
    );

    const failure = await Effect.runPromise(
      installation.activate("c0").pipe(Effect.flip),
    );
    expect(failure._tag).toBe("ResumeComponentActivationResolutionError");
    expect(installation.boundaryState("c0")).toEqual({ status: "dormant" });
    expect(installation.inspect()).toMatchObject({
      expressionControllers: 1,
      expressionSubscriptions: 1,
    });

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 2),
    );
    await vi.waitFor(() => expect(root.expressionText()).toBe("Count: 2"));

    await Effect.runPromise(installation.activate("c0"));
    expect(loadAttempts).toBe(2);
    expect(executions).toBe(1);
    expect(installation.boundaryState("c0")).toEqual({ status: "active" });
    expect(installation.inspect()).toMatchObject({
      expressionControllers: 0,
      expressionSubscriptions: 0,
    });

    await Effect.runPromise(installation.dispose);
    expect(disposals).toBe(1);
    await runtime.dispose();
  });

  it("uses the latest dormant write when the boundary later resumes", async () => {
    vi.stubGlobal("Node", class {});
    let setupRuns = 0;
    const rendered: number[] = [];
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "count",
        () =>
          Effect.sync(() => {
            setupRuns += 1;
          }).pipe(Effect.flatMap(() => Component.state(1))),
        { resume: Resume.snapshotState(Schema.Number) },
      ),
      (_props, bindings) => () => {
        rendered.push(bindings.count());
        return null;
      },
    ).pipe(
      Component.withDefinition({ name: "DormantWriteCounter" }),
      Resume.addressable({
        id: "test.resume.dormant-write-counter",
        buildId: TestBuildId,
        props: Schema.Struct({}),
      }),
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(scope)),
        ),
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    const activation = Resume.activationOf(Counter);
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c0", "end"],
        ]),
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [activation.id]: activation,
        },
        runtime,
      }),
    );

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 7),
    );
    await Effect.runPromise(installation.resume("c0"));

    expect(setupRuns).toBe(1);
    expect(rendered).toEqual([7]);
    expect(installation.boundaryState("c0")).toEqual({ status: "active" });

    const activeWrite = Effect.runSync(
      installation.writeBinding(
        "c0",
        "count",
        Schema.Number,
        8,
      ).pipe(Effect.flip),
    );
    expect(activeWrite._tag).toBe(
      "ResumeBindingSnapshotNotWritableError",
    );

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
    vi.unstubAllGlobals();
  });
});

describe("Resume audit pins (M0-7 review, 2026-07-29)", () => {
  // Audit finding 1: a refresh/invalidation arriving while a restored query
  // is already Refreshing is silently dropped instead of coalesced-and-rerun
  // (expressions coalesce via dirty/requeue; queries do not). Expected
  // behavior: the second request schedules exactly one more executor run.
  it("coalesces a refresh requested while a restored query refresh is in flight", async () => {
    const ServerQueryCode = Portable.code({
      id: "test.resume.query",
      buildId: TestBuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures) => Effect.succeed(`server:${captures.label}`),
    });
    const QueryCard = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "data",
        () =>
          Component.query(
            Portable.bind(ServerQueryCode, { label: "todos" }),
            { reactivityKeys: ["todos", "todos:all"] },
          ),
        { resume: Resume.snapshotQuery(Schema.String) },
      ),
      (_props, bindings) => {
        const result = bindings.data();
        return result._tag === "Success" ? result.value : "pending";
      },
    ).pipe(Component.withDefinition({ name: "ResumeAuditQueryCard" }));
    const serverScope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(QueryCard, {}).pipe(Scope.provide(serverScope)),
        )
      )
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));

    let runs = 0;
    let releaseRun!: () => void;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const GatedClientCode = Portable.code<
      { readonly label: string },
      { readonly label: string },
      readonly [],
      string,
      never,
      never
    >({
      id: "test.resume.query",
      buildId: TestBuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures) =>
        Effect.promise(async () => {
          runs += 1;
          if (runs === 1) await runGate;
          return `client:${captures.label}:${runs}`;
        }),
    });
    const resolver = Effect.runSync(
      Portable.makeResolver({ "test.resume.query": GatedClientCode }),
    );
    const resolverLayer = Layer.succeed(Portable.Resolver, resolver);

    const restored = Effect.runSync(
      Resume.restoreStateBindings(QueryCard, result.manifest, "c0"),
    );
    const refresh = restored.queries["data"]!.refresh.pipe(
      Effect.provide(resolverLayer),
    );

    const first = Effect.runPromise(refresh);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = Effect.runPromise(refresh);
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseRun();
    await Promise.all([first, second]);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Coalesce-and-rerun: the in-flight run settles, then exactly one more
    // run reflects the second request. Today the second request is dropped
    // (runs stays 1) and the query can serve stale data indefinitely.
    expect(runs).toBe(2);
    Effect.runSync(restored.dispose);
  });

  // Failed attempts are shared only while in flight. Success is retained for
  // the installation, while a later interaction may retry a transient load.
  it("re-attempts a portable code load after a transient loader failure", async () => {
    const FlakyCode = Portable.code<
      {},
      {},
      readonly [],
      string,
      never,
      never
    >({
      id: "test.resume.flaky",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () => Effect.succeed("loaded"),
    });
    let attempts = 0;
    const resolver = Effect.runSync(
      Portable.makeResolver({
        "test.resume.flaky": () =>
          Effect.suspend(() => {
            attempts += 1;
            return attempts === 1
              ? Effect.fail("transient network failure")
              : Effect.succeed(FlakyCode);
          }),
      }),
    );
    const codeId = Schema.decodeUnknownSync(Portable.CodeId)("test.resume.flaky");

    const firstExit = await Effect.runPromise(
      Effect.exit(resolver.load(codeId)),
    );
    expect(firstExit._tag).toBe("Failure");
    expect(attempts).toBe(1);

    // A retried interaction should re-attempt the import instead of
    // replaying the cached failure forever.
    const second = await Effect.runPromise(
      Effect.exit(resolver.load(codeId)),
    );
    expect(attempts).toBe(2);
    expect(second._tag).toBe("Success");
  });

  it("shares one failing portable load across concurrent callers and retries after", async () => {
    const FlakyCode = Portable.code<
      {},
      {},
      readonly [],
      string,
      never,
      never
    >({
      id: "test.resume.flaky.concurrent",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () => Effect.succeed("loaded"),
    });
    let attempts = 0;
    let releaseFailure!: () => void;
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const resolver = Effect.runSync(
      Portable.makeResolver({
        "test.resume.flaky.concurrent": () =>
          Effect.suspend(() => {
            attempts += 1;
            if (attempts === 1) {
              return Effect.promise(() => failureGate).pipe(
                Effect.flatMap(() => Effect.fail("transient chunk failure")),
              );
            }
            return Effect.succeed(FlakyCode);
          }),
      }),
    );
    const codeId = Schema.decodeUnknownSync(Portable.CodeId)(
      "test.resume.flaky.concurrent",
    );

    // Two callers arrive while the first (failing) attempt is still in flight.
    const first = Effect.runPromise(Effect.exit(resolver.load(codeId)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = Effect.runPromise(Effect.exit(resolver.load(codeId)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(attempts).toBe(1);

    releaseFailure();
    const [firstExit, secondExit] = await Promise.all([first, second]);

    // Both share the single in-flight failure, normalized to a load error.
    expect(Exit.isFailure(firstExit)).toBe(true);
    expect(Exit.isFailure(secondExit)).toBe(true);
    expect(attempts).toBe(1);
    if (Exit.isFailure(firstExit) && Exit.isFailure(secondExit)) {
      expect(String(firstExit.cause)).toContain("PortableCodeLoadError");
      expect(String(secondExit.cause)).toContain("PortableCodeLoadError");
    }

    // The failed cell is cleared, so a later interaction re-attempts.
    const third = await Effect.runPromise(Effect.exit(resolver.load(codeId)));
    expect(attempts).toBe(2);
    expect(third._tag).toBe("Success");

    // Success is retained: no further attempts.
    const fourth = await Effect.runPromise(Effect.exit(resolver.load(codeId)));
    expect(fourth._tag).toBe("Success");
    expect(attempts).toBe(2);
  });
});

describe("Resume audit pins II (2026-07-29)", () => {
  beforeAll(() => {
    vi.stubGlobal("Node", class {});
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  interface ChainNode {
    nodeType: number;
    nodeName: string;
    data?: string;
    childNodes: ChainNode[];
    parentNode: unknown;
    nextSibling: ChainNode | null;
    getAttribute?: (name: string) => string | null;
    getAttributeNames?: () => string[];
  }

  /**
   * A flat fake root whose dispatch takes an explicit ancestor path so
   * two same-type markers can appear on one composed path.
   */
  class ChainRoot {
    childNodes: ChainNode[] = [];
    private readonly listeners = new Map<string, Set<EventListener>>();

    element(attributes: Readonly<Record<string, string>>): ChainNode {
      const map = new Map(Object.entries(attributes));
      return {
        nodeType: 1,
        nodeName: "DIV",
        childNodes: [],
        parentNode: null,
        nextSibling: null,
        getAttribute: (name: string) => map.get(name) ?? null,
        getAttributeNames: () => [...map.keys()],
      };
    }

    comment(data: string): ChainNode {
      return {
        nodeType: 8,
        nodeName: "#comment",
        data,
        childNodes: [],
        parentNode: null,
        nextSibling: null,
      };
    }

    setChildren(parent: ChainRoot | ChainNode, children: ChainNode[]): void {
      const target = parent as { childNodes: ChainNode[] };
      target.childNodes = children;
      for (let index = 0; index < children.length; index += 1) {
        children[index]!.parentNode = parent;
        children[index]!.nextSibling = children[index + 1] ?? null;
      }
    }

    private allElements(): ChainNode[] {
      const collected: ChainNode[] = [];
      const walk = (nodes: ChainNode[]): void => {
        for (const node of nodes) {
          if (node.nodeType === 1) collected.push(node);
          walk(node.childNodes);
        }
      };
      walk(this.childNodes);
      return collected;
    }

    querySelectorAll(selector: string): ChainNode[] {
      const elements = this.allElements();
      if (selector === "*") return elements;
      const attribute = selector.slice(1, -1);
      return elements.filter(
        (element) => element.getAttribute?.(attribute) !== null,
      );
    }

    addEventListener(type: string, listener: EventListener): void {
      let set = this.listeners.get(type);
      if (set === undefined) {
        set = new Set();
        this.listeners.set(type, set);
      }
      set.add(listener);
    }

    removeEventListener(type: string, listener: EventListener): void {
      this.listeners.get(type)?.delete(listener);
    }

    dispatchPath(type: string, path: ChainNode[]): void {
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
      } as unknown as Event;
      for (const listener of this.listeners.get(type) ?? []) {
        listener.call(this, event);
      }
    }
  }

  const buildId = Schema.decodeUnknownSync(Portable.BuildId)(TestBuildId);

  function portableEventEntry(label: string) {
    return {
      type: "click",
      invocation: "deferred-no-args",
      code: Effect.runSync(
        Portable.describe(Portable.bind(ClientSaveCode, { label })),
      ),
    };
  }

  const activationEventEntry = {
    type: "click",
    invocation: "activation-projection",
    projection: "mouse-v1",
    targetKey: "save",
  };

  function makeActivationCode(id: string) {
    return Portable.code<
      {},
      {},
      readonly [Resume.ComponentActivationContext],
      Resume.ComponentActivationMount,
      never,
      never
    >({
      id,
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () => Effect.succeed({ dispose: Effect.void }),
    });
  }

  function componentEntry(executable: Portable.AnyBoundCode) {
    return {
      region: { kind: "comment-pair" },
      activation: Effect.runSync(Portable.describe(executable)),
      bindings: {},
    };
  }

  function saveRuntime(saves: string[]) {
    return ManagedRuntime.make(
      Layer.succeed(SaveService, {
        save: (label) =>
          Effect.sync(() => {
            saves.push(label);
          }),
      }),
    );
  }

  // ----- M0-7 finding 3: activate() racing an in-flight resume() -----------
  //
  // The contract allows only one transition to claim a dormant boundary, so
  // first-wins is acceptable — but the second caller's conflicting mode must
  // not be discarded silently. Expected: a diagnostic reports the discarded
  // "activate" request while the boundary is still resuming.
  it("diagnoses an activate() request that joins an in-flight resume() with a conflicting mode", async () => {
    let setupRuns = 0;
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "count",
        () =>
          Effect.sync(() => {
            setupRuns += 1;
          }).pipe(Effect.flatMap(() => Component.state(1))),
        { resume: Resume.snapshotState(Schema.Number) },
      ),
      () => null,
    ).pipe(
      Component.withDefinition({ name: "ModeRaceCounter" }),
      Resume.addressable({
        id: "test.resume.audit2.mode-race",
        buildId: TestBuildId,
        props: Schema.Struct({}),
      }),
    );
    const serverScope = Scope.makeUnsafe();
    const collected = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(Scope.provide(serverScope)),
        ),
      )
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));
    expect(setupRuns).toBe(1);

    const activation = Resume.activationOf(Counter);
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c0", "end"],
        ]),
        manifest: collected.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [activation.id]: () =>
            Effect.promise(async () => {
              await loadGate;
              return activation;
            }),
        },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    const resumption = Effect.runPromise(installation.resume("c0"));
    await vi.waitFor(() => {
      expect(installation.boundaryState("c0")).toEqual({ status: "resuming" });
    });
    const activationRequest = Effect.runPromise(installation.activate("c0"));
    releaseLoad();
    await Promise.all([resumption, activationRequest]);

    // First-wins is the documented contract: the boundary resumed once.
    expect(installation.boundaryState("c0")).toEqual({ status: "active" });
    expect(setupRuns).toBe(1);
    // Finding 3: the discarded "activate" mode must produce a diagnostic
    // instead of being silently coalesced into the resume transition.
    expect(diagnostics.length).toBeGreaterThan(0);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  // ----- M0-7 finding 4: two same-type markers on one ancestor chain -------
  //
  // The boundary contract requires each interaction to be "consumed by
  // exactly one owner". Portable markers keep walking the composed path after
  // dispatch, so an ancestor marker of the same event type fires a second
  // owner for the same interaction.
  it("lets exactly one owner consume an interaction crossing two portable markers", async () => {
    const root = new ChainRoot();
    const child = root.element({ "data-af-event-click": "e0" });
    const ancestor = root.element({ "data-af-event-click": "e1" });
    root.setChildren(root, [ancestor]);
    root.setChildren(ancestor, [child]);
    const manifest = {
      version: 1,
      buildId,
      events: {
        e0: portableEventEntry("child"),
        e1: portableEventEntry("parent"),
      },
    } as unknown as Resume.Manifest;
    const saves: string[] = [];
    const runtime = saveRuntime(saves);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [ClientSaveCode.id]: ClientSaveCode },
        runtime,
      }),
    );

    root.dispatchPath("click", [child, ancestor]);
    await vi.waitFor(() => {
      expect(installation.pending()).toBe(0);
      expect(saves.length).toBeGreaterThan(0);
    });
    // Exactly-once ownership: only the closest marker's owner runs.
    // Today both portable markers fire for the same interaction.
    expect(saves).toEqual(["child"]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("does not start an ancestor activation when a closer portable marker consumed the event", async () => {
    const ActivationCode = makeActivationCode(
      "test.resume.audit2.claim-ancestor-activation",
    );
    const root = new ChainRoot();
    const start = root.comment("af:component:c0:start");
    const ancestor = root.element({
      "data-af-event-click": "e1",
      "data-af-replay-click": "save",
    });
    const end = root.comment("af:component:c0:end");
    root.setChildren(root, [start, ancestor, end]);
    const child = root.element({ "data-af-event-click": "e0" });
    root.setChildren(ancestor, [child]);
    const manifest = {
      version: 2,
      buildId,
      events: {
        e0: portableEventEntry("child"),
        e1: activationEventEntry,
      },
      components: {
        c0: componentEntry(Portable.bind(ActivationCode, {})),
      },
    } as unknown as Resume.Manifest;
    const saves: string[] = [];
    const runtime = saveRuntime(saves);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [ClientSaveCode.id]: ClientSaveCode,
          [ActivationCode.id]: ActivationCode,
        },
        runtime,
      }),
    );

    root.dispatchPath("click", [child, ancestor]);
    await vi.waitFor(() => {
      expect(saves).toEqual(["child"]);
      expect(installation.pending()).toBe(0);
    });
    // Exactly-once ownership: the closer portable marker consumed the
    // interaction, so the ancestor activation marker must not also claim it.
    // Today the walk continues and the ancestor boundary leaves dormant.
    expect(installation.boundaryState("c0")).toEqual({ status: "dormant" });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("claims exclusively at an activation marker below a portable ancestor marker", async () => {
    const ActivationCode = makeActivationCode(
      "test.resume.audit2.claim-child-activation",
    );
    const root = new ChainRoot();
    const start = root.comment("af:component:c0:start");
    const child = root.element({
      "data-af-event-click": "e1",
      "data-af-replay-click": "save",
    });
    const end = root.comment("af:component:c0:end");
    const ancestor = root.element({ "data-af-event-click": "e0" });
    root.setChildren(root, [start, child, end, ancestor]);
    const manifest = {
      version: 2,
      buildId,
      events: {
        e0: portableEventEntry("parent"),
        e1: activationEventEntry,
      },
      components: {
        c0: componentEntry(Portable.bind(ActivationCode, {})),
      },
    } as unknown as Resume.Manifest;
    const saves: string[] = [];
    const runtime = saveRuntime(saves);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [ClientSaveCode.id]: ClientSaveCode,
          [ActivationCode.id]: ActivationCode,
        },
        runtime,
      }),
    );

    root.dispatchPath("click", [child, ancestor]);
    await vi.waitFor(() => {
      expect(installation.boundaryState("c0")).toEqual({ status: "active" });
      expect(installation.pending()).toBe(0);
    });
    // The activation marker claimed the interaction; the portable ancestor
    // marker of the same event type must not fire a second owner.
    expect(saves).toEqual([]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  // ----- M0-7 finding 5: snapshot-less inner boundary ----------------------
  //
  // An event inside an inner boundary that has no usable snapshot must not
  // be claimed by (and activate) its snapshot-bearing ancestor. Both fixture
  // shapes fail closed at install time today, so the runtime disagreement is
  // not reachable through the public API.
  it("fails closed before an event inside a snapshot-less inner boundary can claim its ancestor", async () => {
    const ActivationCode = makeActivationCode(
      "test.resume.audit2.snapshotless-inner",
    );
    const buildRoot = () => {
      const root = new ChainRoot();
      const c0start = root.comment("af:component:c0:start");
      const c1start = root.comment("af:component:c1:start");
      const target = root.element({
        "data-af-event-click": "e0",
        "data-af-replay-click": "save",
      });
      const c1end = root.comment("af:component:c1:end");
      const c0end = root.comment("af:component:c0:end");
      root.setChildren(root, [c0start, c1start, target, c1end, c0end]);
      return root;
    };
    const runtime = ManagedRuntime.make(Layer.empty);

    // Shape 1: the inner boundary marker has no manifest record at all.
    const unknownBoundary = Effect.runSync(
      Resume.installClient({
        root: buildRoot() as unknown as Document,
        manifest: {
          version: 2,
          buildId,
          events: { e0: activationEventEntry },
          components: {
            c0: componentEntry(Portable.bind(ActivationCode, {})),
          },
        } as unknown as Resume.Manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [ActivationCode.id]: ActivationCode },
        runtime,
      }).pipe(Effect.flip),
    );
    expect(unknownBoundary._tag).toBe("ResumeUnknownComponentBoundaryError");

    // Shape 2: the inner boundary exists in the manifest but cannot activate.
    const unownedEvent = Effect.runSync(
      Resume.installClient({
        root: buildRoot() as unknown as Document,
        manifest: {
          version: 2,
          buildId,
          events: { e0: activationEventEntry },
          components: {
            c0: componentEntry(Portable.bind(ActivationCode, {})),
            c1: { region: { kind: "comment-pair" }, bindings: {} },
          },
        } as unknown as Resume.Manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [ActivationCode.id]: ActivationCode },
        runtime,
      }).pipe(Effect.flip),
    );
    expect(unownedEvent._tag).toBe("ResumeActivationEventOwnershipError");

    await runtime.dispose();
  });

  // ----- M0-7 finding 6: restoration failing inside render -----------------
  //
  // When restoration fails inside the render callback (after DOM writes may
  // have begun), the boundary should still fall back to exactly one normal
  // activation without double-mounting. Observed today: the render throw is
  // swallowed and the boundary reports `active` with no fallback activation
  // (setup never reruns), so an unusable restored mount claims the readiness
  // guarantee — the precondition for the double-mount hazard is unguarded.
  it("falls back to one activation when restoration fails inside the render callback", async () => {
    let setupRuns = 0;
    let viewRuns = 0;
    const Exploding = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "count",
        () =>
          Effect.sync(() => {
            setupRuns += 1;
          }).pipe(Effect.flatMap(() => Component.state(1))),
        { resume: Resume.snapshotState(Schema.Number) },
      ),
      () => {
        viewRuns += 1;
        if (viewRuns === 2) {
          // The restored mount render fails after restoration committed.
          throw new Error("render failed after restoration");
        }
        return null;
      },
    ).pipe(
      Component.withDefinition({ name: "InRenderFallback" }),
      Resume.addressable({
        id: "test.resume.audit2.in-render-fallback",
        buildId: TestBuildId,
        props: Schema.Struct({}),
      }),
    );
    const serverScope = Scope.makeUnsafe();
    const collected = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Exploding, {}).pipe(
            Scope.provide(serverScope),
          ),
        ),
      )
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));
    expect({ setupRuns, viewRuns }).toEqual({ setupRuns: 1, viewRuns: 1 });

    const activation = Resume.activationOf(Exploding);
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: componentBoundaryRoot([
          ["c0", "start"],
          ["c0", "end"],
        ]),
        manifest: collected.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [activation.id]: activation },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    await Effect.runPromise(installation.resume("c0"));

    // The failed restored render must roll back and hand the boundary to one
    // normal activation, never a terminal failure or a second mounted copy.
    expect(installation.boundaryState("c0")).toEqual({ status: "active" });
    expect(setupRuns).toBe(2);
    expect(viewRuns).toBe(3);
    expect(diagnostics).toMatchObject([
      { code: "component-resumption-fallback", componentId: "c0" },
    ]);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  // ----- M8 expression fixtures --------------------------------------------

  const AuditBindingExpression = expressionCode({
    id: "test.resume.audit2.expression.count",
    buildId: TestBuildId,
    captures: Schema.Struct({ label: Schema.String }),
    dependencies: Schema.Tuple([Schema.Number]),
    render: (captures, [count]) => `${captures.label}: ${count}`,
  });
  const AuditDoubleExpression = expressionCode({
    id: "test.resume.audit2.expression.double",
    buildId: TestBuildId,
    captures: Schema.Struct({}),
    dependencies: Schema.Tuple([Schema.Number]),
    render: (_captures, [count]) => `Twice: ${count * 2}`,
  });
  const AuditEmptyableExpression = expressionCode({
    id: "test.resume.audit2.expression.emptyable",
    buildId: TestBuildId,
    captures: Schema.Struct({}),
    dependencies: Schema.Tuple([Schema.Number]),
    render: (_captures, [count]) => (count === 0 ? "" : `v${count}`),
  });

  function makeExpressionCounter(
    view: (
      bindings: { readonly count: Resume.InspectableStateHandle<number> },
    ) => Element,
  ) {
    return Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => view(bindings),
    );
  }

  function collectComponent(
    component: Component.Component<{}, never, never, any, any>,
  ) {
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(component, {}).pipe(Scope.provide(scope)),
        ),
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));
    return result;
  }

  function regionText(root: FakeRegionDocument, expressionId: string): string {
    const startIndex = root.childNodes.findIndex(
      (node) =>
        node.nodeType === 8 && node.data === `af:expr:${expressionId}:start`,
    );
    const endIndex = root.childNodes.findIndex(
      (node) =>
        node.nodeType === 8 && node.data === `af:expr:${expressionId}:end`,
    );
    if (startIndex < 0 || endIndex < 0) {
      throw new Error(`Expression region "${expressionId}" is missing.`);
    }
    return root.childNodes
      .slice(startIndex + 1, endIndex)
      .map((node) => node.textContent ?? "")
      .join("");
  }

  // ----- M8 finding 3: dispose during an in-flight expression resolve ------
  it("interrupts an in-flight expression resolve on disposal without touching the DOM", async () => {
    const Counter = makeExpressionCounter((bindings) => {
      const span = template("<span>")();
      insert(
        span,
        bindExpression(AuditBindingExpression, { label: "Count" }, [
          bindings.count,
        ]),
      );
      return span;
    });
    const result = collectComponent(Counter);

    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    let loads = 0;
    const root = expressionComponentBoundaryRoot();
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [AuditBindingExpression.id]: () =>
            Effect.promise(async () => {
              loads += 1;
              await loadGate;
              return AuditBindingExpression;
            }),
        },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 2),
    );
    await vi.waitFor(() => expect(loads).toBe(1));
    expect(installation.inspect().runningExpressions).toBe(1);

    const disposal = Effect.runPromise(installation.dispose);
    releaseLoad();
    await disposal;

    await Promise.resolve();
    await Promise.resolve();
    expect(installation.pending()).toBe(0);
    expect(installation.inspect()).toMatchObject({
      disposed: true,
      runningExpressions: 0,
      expressionControllers: 0,
      expressionSubscriptions: 0,
    });
    // The interrupted resolve must not patch the region or report a
    // patch/execution failure for the disposed expression.
    expect(root.expressionText()).toBe("Count: 1");
    expect(diagnostics).toEqual([]);

    await runtime.dispose();
  });

  // ----- M8 finding 4: two expressions sharing one dependency key ----------
  it("fans one dependency invalidation out to every subscribed expression and drops the key with the last subscriber", async () => {
    const Counter = makeExpressionCounter((bindings) => {
      const div = template("<div>")();
      const first = template("<span>")();
      insert(
        first,
        bindExpression(AuditBindingExpression, { label: "Count" }, [
          bindings.count,
        ]),
      );
      const second = template("<span>")();
      insert(
        second,
        bindExpression(AuditDoubleExpression, {}, [bindings.count]),
      );
      insert(div, first);
      insert(div, second);
      return div;
    });
    const result = collectComponent(Counter);

    const root = new FakeRegionDocument([
      { kind: "component", id: "c0", edge: "start" },
      { kind: "expression", id: "x0", edge: "start" },
      { kind: "text", value: "Count: 1" },
      { kind: "expression", id: "x0", edge: "end" },
      { kind: "expression", id: "x1", edge: "start" },
      { kind: "text", value: "Twice: 2" },
      { kind: "expression", id: "x1", edge: "end" },
      { kind: "component", id: "c0", edge: "end" },
    ]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [AuditBindingExpression.id]: AuditBindingExpression,
          [AuditDoubleExpression.id]: AuditDoubleExpression,
        },
        runtime,
      }),
    );

    expect(installation.inspect()).toMatchObject({
      expressionControllers: 2,
      expressionDependencyKeys: 1,
      expressionSubscriptions: 2,
    });

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 3),
    );
    await vi.waitFor(() => {
      expect(regionText(root, "x0")).toBe("Count: 3");
      expect(regionText(root, "x1")).toBe("Twice: 6");
      expect(installation.pending()).toBe(0);
    });

    await Effect.runPromise(installation.dispose);
    // Last subscriber removal deletes the shared dependency key.
    expect(installation.inspect()).toMatchObject({
      expressionControllers: 0,
      expressionDependencyKeys: 0,
      expressionSubscriptions: 0,
    });
    await runtime.dispose();
  });

  // ----- M8 finding 6: empty-string SSR region and "" round trips ----------
  it("patches an empty-string SSR expression region through \"\"->x->\"\"->y", async () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(0), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => {
        const span = template("<span>")();
        insert(
          span,
          bindExpression(AuditEmptyableExpression, {}, [bindings.count]),
        );
        return span;
      },
    );
    const result = collectComponent(Counter);
    expect(result.html).toContain(
      "<!--af:expr:x0:start--><!--af:expr:x0:end-->",
    );

    // Zero-node SSR region: nothing between the expression markers.
    const root = new FakeRegionDocument([
      { kind: "component", id: "c0", edge: "start" },
      { kind: "expression", id: "x0", edge: "start" },
      { kind: "expression", id: "x0", edge: "end" },
      { kind: "component", id: "c0", edge: "end" },
    ]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [AuditEmptyableExpression.id]: AuditEmptyableExpression,
        },
        runtime,
      }),
    );

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 1),
    );
    await vi.waitFor(() => expect(regionText(root, "x0")).toBe("v1"));

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 0),
    );
    await vi.waitFor(() => expect(regionText(root, "x0")).toBe(""));

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 3),
    );
    await vi.waitFor(() => expect(regionText(root, "x0")).toBe("v3"));
    expect(installation.pending()).toBe(0);

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  // ----- M8 finding 8: non-JSON capture graphs must fail validation --------
  it("rejects class-instance captures before a manifest receives an identity proof", async () => {
    class CaptureBag {
      label = "before";
    }
    const bag = new CaptureBag();
    const BagCode = Portable.code<
      { readonly bag: unknown },
      { readonly bag: unknown },
      readonly [],
      void,
      never,
      never
    >({
      id: "test.resume.audit2.capture-bag",
      buildId: TestBuildId,
      captures: Schema.Struct({ bag: Schema.Unknown }),
      run: () => Effect.void,
    });
    const manifest = {
      version: 1,
      buildId,
      events: {
        e0: {
          type: "click",
          invocation: "deferred-no-args",
          // Portable.describe rejects non-JSON captures at collection time,
          // but a hand-built (or transport-bypassing) manifest object can
          // still carry a class instance into client validation.
          code: {
            version: 1,
            kind: "portable.code",
            id: BagCode.id,
            buildId,
            captures: { bag },
          },
        },
      },
    } as unknown as Resume.Manifest;
    const { domRoot } = clientRoot();
    const runtime = ManagedRuntime.make(Layer.empty);
    const failure = Effect.runSync(
      Resume.installClient({
        root: domRoot,
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [BagCode.id]: BagCode },
        runtime,
      }).pipe(Effect.flip),
    );

    expect(failure._tag).toBe("ResumeManifestDecodeError");
    expect(failure.message).toMatch(/plain JSON object/);
    expect(Object.isFrozen(bag)).toBe(false);
    await runtime.dispose();
  });

  // ----- M0-7 finding 7: interrupted refresh writing into a live handle ----
  //
  // Scope finalizers run LIFO, so the refresh-interrupting finalizer used to
  // run while restoration still reported "not disposed". An interrupted
  // refresh must never publish its interrupt cause as query data.
  it("rolls a restored query back to its settled state when a refresh is interrupted", async () => {
    const ServerQueryCode = Portable.code({
      id: "test.resume.audit3.query",
      buildId: TestBuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures) => Effect.succeed(`server:${captures.label}`),
    });
    const QueryCard = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "data",
        () =>
          Component.query(
            Portable.bind(ServerQueryCode, { label: "todos" }),
            { reactivityKeys: ["todos"] },
          ),
        { resume: Resume.snapshotQuery(Schema.String) },
      ),
      (_props, bindings) => {
        const result = bindings.data();
        return result._tag === "Success" ? result.value : "pending";
      },
    ).pipe(Component.withDefinition({ name: "AuditInterruptQueryCard" }));
    const serverScope = Scope.makeUnsafe();
    const collected = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(QueryCard, {}).pipe(
            Scope.provide(serverScope),
          ),
        )
      )
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));

    let releaseRun!: () => void;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const GatedClientCode = Portable.code<
      { readonly label: string },
      { readonly label: string },
      readonly [],
      string,
      never,
      never
    >({
      id: "test.resume.audit3.query",
      buildId: TestBuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures) =>
        Effect.promise(async () => {
          await runGate;
          return `client:${captures.label}`;
        }),
    });
    const resolver = Effect.runSync(
      Portable.makeResolver({ [GatedClientCode.id]: GatedClientCode }),
    );
    const restored = Effect.runSync(
      Resume.restoreStateBindings(QueryCard, collected.manifest, "c0"),
    );
    const settled = Resume.inspectHandle(restored.bindings.data)!;
    expect(settled.read()).toMatchObject({
      _tag: "Success",
      value: "server:todos",
    });

    const fiber = Effect.runFork(
      restored.queries["data"]!.refresh.pipe(
        Effect.provideService(Portable.Resolver, resolver),
      ),
    );
    await vi.waitFor(() => {
      expect(settled.read()._tag).toBe("Refreshing");
    });
    await Effect.runPromise(Fiber.interrupt(fiber));
    releaseRun();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // An interrupted refresh restores the pre-refresh settled state instead of
    // publishing an interruption as a query failure.
    expect(settled.read()).toMatchObject({
      _tag: "Success",
      value: "server:todos",
    });
    Effect.runSync(restored.dispose);
  });

  // ----- M0-7 finding 8: double restoration of one boundary ---------------
  it("fails closed when one component boundary is restored twice", () => {
    const Counter = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(7), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      () => null,
    ).pipe(Component.withDefinition({ name: "AuditDoubleRestore" }));
    const serverScope = Scope.makeUnsafe();
    const collected = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Counter, {}).pipe(
            Scope.provide(serverScope),
          ),
        )
      )
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));

    const first = Effect.runSync(
      Resume.restoreStateBindings(Counter, collected.manifest, "c0"),
    );
    const duplicate = Effect.runSync(
      Resume.restoreStateBindings(Counter, collected.manifest, "c0").pipe(
        Effect.flip,
      ),
    );
    expect(duplicate._tag).toBe("ResumeDuplicateComponentRestorationError");

    // Disposing the first restoration releases the boundary again.
    Effect.runSync(first.dispose);
    const second = Effect.runSync(
      Resume.restoreStateBindings(Counter, collected.manifest, "c0"),
    );
    expect(second.registry.get(second.bindings.count)).toBe(7);
    Effect.runSync(second.dispose);
  });

  // ----- M0-7 finding 9: frozen bindings and slot publication -------------
  //
  // A portable behavior reattachment may return a frozen bindings object.
  // Publishing the slot contract onto it must be a classified restoration
  // failure, not a terminal defect from `Object.defineProperty`.
  it("classifies a frozen restored bindings object instead of dying", () => {
    const FreezeCode = Portable.code<
      {},
      {},
      readonly [{ readonly root: { readonly id: string } }],
      { readonly attached: boolean },
      never,
      never
    >({
      id: "test.resume.audit3.freeze-behavior",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      run: () => Effect.succeed({ attached: true }),
    });
    const RootSlot = View.Slot.make("root", {
      capability: Element.Capability.Base,
    });
    const contract = View.Slots.make({
      root: View.Slot.bind(RootSlot, Element.container()),
    });
    const Frozen = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(3), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      () => null,
    ).pipe(
      Behavior.attach(
        Behavior.portable(Portable.bind(FreezeCode, {})),
        {
          select: () => ({ root: { id: "frozen-root" } }),
          merge: (bindings, added) =>
            Object.freeze({ ...bindings, ...added }) as never,
        },
      ),
      Component.withSlots(contract),
      Component.withDefinition({ name: "AuditFrozenBindings" }),
    );
    const serverScope = Scope.makeUnsafe();
    const collected = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Frozen, {}).pipe(Scope.provide(serverScope)),
        )
      )
    );
    Effect.runSync(Scope.close(serverScope, Exit.void));

    const resolver = Effect.runSync(
      Portable.makeResolver({ [FreezeCode.id]: FreezeCode }),
    );
    const exit = Effect.runSyncExit(
      Resume.restoreStateBindings(Frozen, collected.manifest, "c0").pipe(
        Effect.provideService(Portable.Resolver, resolver),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // A classified, recoverable restoration failure — never a defect.
      expect(Cause.hasDies(exit.cause)).toBe(false);
      expect(
        Cause.findErrorOption(exit.cause).pipe(
          Option.map((error) => (error as { readonly _tag: string })._tag),
          Option.getOrElse(() => "none"),
        ),
      ).toBe("ResumeComponentPlanUnsupportedError");
    }
  });

  // ----- M0-7 finding 10: claiming boundary must be the innermost one -----
  //
  // An activation event inside a boundary that can no longer transition must
  // not be promoted to an ancestor boundary: the ancestor would remount a
  // region it does not own the interaction for.
  it("never promotes an activation event to an ancestor of a failed boundary", async () => {
    const OuterCode = makeActivationCode("test.resume.audit3.outer");
    const MissingInnerCode = makeActivationCode("test.resume.audit3.inner");
    const root = new ChainRoot();
    const c0start = root.comment("af:component:c0:start");
    const c1start = root.comment("af:component:c1:start");
    const target = root.element({
      "data-af-event-click": "e0",
      "data-af-replay-click": "save",
    });
    const c1end = root.comment("af:component:c1:end");
    const c0end = root.comment("af:component:c0:end");
    root.setChildren(root, [c0start, c1start, target, c1end, c0end]);
    const manifest = {
      version: 2,
      buildId,
      events: { e0: activationEventEntry },
      components: {
        c0: componentEntry(Portable.bind(OuterCode, {})),
        c1: componentEntry(Portable.bind(MissingInnerCode, {})),
      },
    } as unknown as Resume.Manifest;
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest,
        expectedBuildId: TestBuildId,
        // The inner boundary's activation code is deliberately unresolvable.
        resolverEntries: { [OuterCode.id]: OuterCode },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    const failure = await Effect.runPromise(
      installation.activate("c1").pipe(Effect.flip),
    );
    expect(failure._tag).toBe("ResumeComponentActivationResolutionError");
    expect(installation.boundaryState("c1")).toMatchObject({
      status: "failed",
    });

    root.dispatchPath("click", [target]);
    await vi.waitFor(() => {
      expect(installation.pending()).toBe(0);
      expect(
        diagnostics.some(
          (diagnostic) => diagnostic.code === "event-handoff-failure",
        ),
      ).toBe(true);
    });
    // The event belongs to c1; c0 must not claim it.
    expect(installation.boundaryState("c0")).toEqual({ status: "dormant" });

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });
});

describe("Milestone 8c non-text expression targets", () => {
  const AttributeExpression = expressionCode({
    id: "test.resume.expression.attribute",
    buildId: TestBuildId,
    captures: Schema.Struct({}),
    dependencies: Schema.Tuple([Schema.Number]),
    // 1 → a value; 2 → the empty string; 3 → undefined; 4 → null.
    render: (_captures, [count]: readonly [number]) =>
      count === 1 ? "v1" : count === 2 ? "" : count === 3 ? undefined : null,
  });

  /**
   * SSR one host element through the compiler-facing helpers, exactly as the
   * generated `resumeExprDirective` ref callback does.
   */
  function collectViaHelpers(
    attach: (element: Element, bound: ResumableExpression<any>) => void,
  ) {
    const Host = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => {
        const element = template("<div>")();
        attach(
          element,
          bindExpression(AttributeExpression, {}, [bindings.count]),
        );
        return element;
      },
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Host, {}).pipe(Scope.provide(scope)),
        )
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));
    return result;
  }

  it("registers allowlisted targets and accumulates one marker per element", () => {
    const result = collectViaHelpers((element, bound) => {
      exprAttribute(element, bound, "title");
      exprStyleProperty(element as HTMLElement, bound, "opacity");
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toMatchObject({
      version: 4,
      expressions: {
        x0: { target: { kind: "attribute", name: "title" }, component: "c0" },
        x1: {
          target: { kind: "style-property", name: "opacity" },
          component: "c0",
        },
      },
    });
    // One marker, both instance ids: the single registrar owns accumulation.
    expect(result.html.split('data-af-expr="').length - 1).toBe(1);
    expect(/data-af-expr="([^"]*)"/.exec(result.html)?.[1]).toBe("x0 x1");
    // The ordinary helper ran inside the resumable one, so SSR emitted the
    // initial value for both targets.
    expect(result.html).toContain('title="v1"');
    expect(result.html).toContain("opacity: v1");
  });

  it("accepts a custom style property the JSX compiler cannot author", () => {
    const result = collectViaHelpers((element, bound) => {
      exprStyleProperty(element as HTMLElement, bound, "--progress");
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toMatchObject({
      version: 4,
      expressions: {
        x0: { target: { kind: "style-property", name: "--progress" } },
      },
    });
  });

  it("registers a class target through the ordinary class helper", () => {
    const result = collectViaHelpers((element, bound) => {
      exprClass(element, bound);
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toMatchObject({
      version: 4,
      expressions: { x0: { target: { kind: "class" } } },
    });
    expect(result.html).toContain('class="v1"');
  });

  it("refuses a fenced target name at collection, before any HTML is emitted", () => {
    for (
      const attach of [
        (element: Element, bound: ResumableExpression<any>) =>
          exprAttribute(element, bound, "href"),
        (element: Element, bound: ResumableExpression<any>) =>
          exprAttribute(element, bound, "onclick"),
        (element: Element, bound: ResumableExpression<any>) =>
          exprStyleProperty(
            element as HTMLElement,
            bound,
            "background-image",
          ),
      ]
    ) {
      const result = collectViaHelpers(attach);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code))
        .toContain("unsupported-expression-target");
      expect(result.diagnostics[0]).toMatchObject({
        phase: "collect",
        severity: "warning",
        disposition: "fallback-required",
      });
      expect(result.manifest.version).not.toBe(4);
      expect(result.html).not.toContain("data-af-expr");
      // A refused target writes nothing: an SSR document must never carry an
      // `onclick`/`href` value the portable protocol declined to own.
      expect(result.html).toContain("<div></div>");
    }
  });

  it("writes nothing during SSR when the expression yields nothing", () => {
    const Absent = expressionCode({
      id: "test.resume.expression.absent",
      buildId: TestBuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Number]),
      render: () => undefined,
    });
    const Host = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => {
        const element = template("<div>")();
        exprAttribute(
          element,
          bindExpression(Absent, {}, [bindings.count]),
          "aria-label",
        );
        return element;
      },
    );
    const scope = Scope.makeUnsafe();
    const result = collect(() =>
      renderToString(() =>
        Effect.runSync(
          Component.renderEffect(Host, {}).pipe(Scope.provide(scope)),
        )
      )
    );
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(result.diagnostics).toEqual([]);
    // Absent, not `aria-label="undefined"` — and still resumable.
    expect(result.html).not.toContain("aria-label");
    expect(result.manifest).toMatchObject({
      version: 4,
      expressions: { x0: { target: { kind: "attribute", name: "aria-label" } } },
    });
  });

  function elementTargetRoot(
    attributes: Readonly<Record<string, string>> = {},
  ): FakeRegionDocument {
    return new FakeRegionDocument([
      { kind: "component", id: "c0", edge: "start" },
      { kind: "element", expressions: ["x0"], attributes },
      { kind: "component", id: "c0", edge: "end" },
    ]);
  }

  function attributeManifest(): Resume.ManifestV4 {
    const collected = collectViaHelpers((element, bound) => {
      exprAttribute(element, bound, "aria-label");
    });
    if (collected.manifest.version !== 4) {
      throw new Error("Expected a v4 expression manifest.");
    }
    return collected.manifest;
  }

  it('patches a dormant attribute on invalidation, treating "" as a value and nullish as removal', async () => {
    const manifest = attributeManifest();
    const root = elementTargetRoot({ "aria-label": "v1", title: "untouched" });
    const element = root.elementNode();
    let loads = 0;
    const diagnostics: Array<Resume.ClientDiagnostic> = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [AttributeExpression.id]: () =>
            Effect.sync(() => {
              loads += 1;
              return AttributeExpression;
            }),
        },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    // Dormant: nothing loaded and the installation-only marker is consumed.
    expect(loads).toBe(0);
    expect(element.getAttribute(Resume.ExpressionElementMarkerAttribute))
      .toBeNull();
    expect(installation.inspect()).toMatchObject({
      expressionControllers: 1,
      expressionSubscriptions: 1,
      runningExpressions: 0,
    });

    // The empty string is a value, not an absence.
    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 2),
    );
    await vi.waitFor(() => {
      expect(installation.pending()).toBe(0);
      expect(element.getAttribute("aria-label")).toBe("");
    });
    expect(element.hasAttribute("aria-label")).toBe(true);
    expect(loads).toBe(1);

    // `undefined` removes…
    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 3),
    );
    await vi.waitFor(() => {
      expect(element.hasAttribute("aria-label")).toBe(false);
    });

    // …removal is not terminal…
    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 1),
    );
    await vi.waitFor(() => {
      expect(element.getAttribute("aria-label")).toBe("v1");
    });

    // …and `null` removes identically.
    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 4),
    );
    await vi.waitFor(() => {
      expect(element.hasAttribute("aria-label")).toBe(false);
    });

    // Warm updates never reload, and the neighbour was never touched.
    expect(loads).toBe(1);
    expect(element.getAttribute("title")).toBe("untouched");
    expect(diagnostics).toEqual([]);

    await Effect.runPromise(installation.dispose);
    expect(installation.inspect()).toMatchObject({
      disposed: true,
      expressionControllers: 0,
      expressionSubscriptions: 0,
    });
    await runtime.dispose();
  });

  it("fails closed when a text manifest's instance also carries an element marker", async () => {
    const manifest = attributeManifest();
    const x0 = Schema.decodeUnknownSync(Resume.ExpressionId)("x0");
    const textManifest: Resume.ManifestV4 = {
      ...manifest,
      expressions: {
        [x0]: { ...manifest.expressions[x0]!, target: { kind: "text" } },
      },
    };
    // The durable text region exists, so a missing-boundary failure cannot
    // explain the rejection: the contradicting element marker is the only
    // thing wrong with this DOM.
    const tampered = new FakeRegionDocument([
      { kind: "component", id: "c0", edge: "start" },
      { kind: "expression", id: "x0", edge: "start" },
      { kind: "text", value: "v1" },
      { kind: "expression", id: "x0", edge: "end" },
      { kind: "element", expressions: ["x0"] },
      { kind: "component", id: "c0", edge: "end" },
    ]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const failure = Effect.runSync(
      Resume.installClient({
        root: tampered as unknown as Document,
        manifest: textManifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {},
        runtime,
      }).pipe(Effect.flip),
    );

    expect(failure._tag).toBe("ResumeExpressionTargetKindMismatchError");
    // Fail closed leaves the marker in place rather than half-cleaning the DOM.
    expect(
      tampered.elementNode().getAttribute(
        Resume.ExpressionElementMarkerAttribute,
      ),
    ).toBe("x0");
    await runtime.dispose();

    // NEGATIVE CONTROL, and the near-neighbour separation: the same text
    // manifest over an untampered DOM installs, and a genuinely region-less
    // DOM produces a *different* code.
    const clean = new FakeRegionDocument([
      { kind: "component", id: "c0", edge: "start" },
      { kind: "expression", id: "x0", edge: "start" },
      { kind: "text", value: "v1" },
      { kind: "expression", id: "x0", edge: "end" },
      { kind: "component", id: "c0", edge: "end" },
    ]);
    const cleanRuntime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: clean as unknown as Document,
        manifest: textManifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {},
        runtime: cleanRuntime,
      }),
    );
    await Effect.runPromise(installation.dispose);
    await cleanRuntime.dispose();

    const regionless = new FakeRegionDocument([
      { kind: "component", id: "c0", edge: "start" },
      { kind: "component", id: "c0", edge: "end" },
    ]);
    const regionlessRuntime = ManagedRuntime.make(Layer.empty);
    const regionlessFailure = Effect.runSync(
      Resume.installClient({
        root: regionless as unknown as Document,
        manifest: textManifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {},
        runtime: regionlessRuntime,
      }).pipe(Effect.flip),
    );
    expect(regionlessFailure._tag).toBe(
      "ResumeMissingExpressionBoundaryError",
    );
    expect(regionlessFailure._tag).not.toBe(failure._tag);
    await regionlessRuntime.dispose();
  });

  it("abandons a patch when the element leaves the document while work is in flight", async () => {
    const manifest = attributeManifest();
    const root = elementTargetRoot({ "aria-label": "v1" });
    const element = root.elementNode();
    const diagnostics: Array<Resume.ClientDiagnostic> = [];
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [AttributeExpression.id]: () =>
            Effect.succeed(AttributeExpression).pipe(Effect.delay("30 millis")),
        },
        runtime,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    );

    Effect.runSync(
      installation.writeBinding("c0", "count", Schema.Number, 2),
    );
    root.removeChild(element);
    await vi.waitFor(() => {
      expect(installation.pending()).toBe(0);
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "expression-patch-failure",
      ]);
    });
    expect(element.getAttribute("aria-label")).toBe("v1");

    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });
});
