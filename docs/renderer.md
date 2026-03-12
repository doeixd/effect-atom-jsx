Yes. This is the logical conclusion of the entire design. If setup is an Effect, and context is services, and lifecycle is scopes, then rendering should be an Effect too. And if rendering is an Effect that depends on a `Renderer` service, then swapping the renderer is just swapping a layer.

**The Renderer as a service:**

```ts
// The core rendering primitives — what any renderer must implement
class Renderer extends Effect.Tag("Renderer")<Renderer, {
  // Create a native element
  readonly createElement: (tag: string) => Effect.Effect<RenderNode>;

  // Create a text node
  readonly createText: (content: string) => Effect.Effect<RenderNode>;

  // Set a property/attribute on a node
  readonly setProperty: (node: RenderNode, key: string, value: unknown) => Effect.Effect<void>;

  // Remove a property
  readonly removeProperty: (node: RenderNode, key: string) => Effect.Effect<void>;

  // Append child
  readonly appendChild: (parent: RenderNode, child: RenderNode) => Effect.Effect<void>;

  // Remove child
  readonly removeChild: (parent: RenderNode, child: RenderNode) => Effect.Effect<void>;

  // Insert before
  readonly insertBefore: (parent: RenderNode, child: RenderNode, ref: RenderNode) => Effect.Effect<void>;

  // Replace text content
  readonly setText: (node: RenderNode, content: string) => Effect.Effect<void>;

  // Add event listener
  readonly addEventListener: (
    node: RenderNode,
    event: string,
    handler: (e: unknown) => void,
  ) => Effect.Effect<Scope>;

  // Request animation frame equivalent
  readonly requestFrame: (fn: () => void) => Effect.Effect<void>;

  // Batch DOM mutations
  readonly batch: (fn: () => void) => Effect.Effect<void>;

  // Mount root
  readonly mount: (root: RenderNode, container: unknown) => Effect.Effect<void, RenderError>;

  // Get the root container
  readonly getContainer: (target: unknown) => Effect.Effect<RenderNode, RenderError>;
}>() {}
```

`RenderNode` is opaque — each renderer defines what a node actually is. For DOM it's `HTMLElement`. For a TUI it's a terminal cell region. For mobile it's a native view. The component doesn't know or care:

```ts
// RenderNode is a branded opaque type
interface RenderNode {
  readonly [RenderNodeTypeId]: unique symbol;
  // Renderer-specific internals are hidden
}
```

**DOM renderer:**

```ts
const DomRenderer = Layer.succeed(Renderer, {
  createElement: (tag) => Effect.sync(() => document.createElement(tag) as unknown as RenderNode),

  createText: (content) => Effect.sync(() => document.createTextNode(content) as unknown as RenderNode),

  setProperty: (node, key, value) => Effect.sync(() => {
    const el = node as unknown as HTMLElement;
    if (key === "class") el.className = value as string;
    else if (key.startsWith("on")) {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    }
    else el.setAttribute(key, String(value));
  }),

  appendChild: (parent, child) => Effect.sync(() => {
    (parent as unknown as HTMLElement).appendChild(child as unknown as Node);
  }),

  removeChild: (parent, child) => Effect.sync(() => {
    (parent as unknown as HTMLElement).removeChild(child as unknown as Node);
  }),

  addEventListener: (node, event, handler) =>
    Effect.gen(function* () {
      const el = node as unknown as HTMLElement;
      el.addEventListener(event, handler as EventListener);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => el.removeEventListener(event, handler as EventListener))
      );
    }).pipe(Effect.scoped) as any,

  requestFrame: (fn) => Effect.sync(() => requestAnimationFrame(fn)),

  batch: (fn) => Effect.sync(fn),

  mount: (root, container) => Effect.sync(() => {
    (container as HTMLElement).appendChild(root as unknown as Node);
  }),

  getContainer: (target) => Effect.sync(() => target as unknown as RenderNode),
});
```

**TUI renderer:**

```ts
import * as blessed from "blessed";

interface TuiNode {
  readonly [RenderNodeTypeId]: typeof RenderNodeTypeId;
  readonly element: blessed.Widgets.BlessedElement;
}

const TuiRenderer = Layer.scoped(Renderer,
  Effect.gen(function* () {
    const screen = blessed.screen({ smartCSR: true });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => screen.destroy())
    );

    return {
      createElement: (tag) => Effect.sync(() => {
        const el = tag === "div" ? blessed.box({})
          : tag === "p" ? blessed.text({})
          : tag === "button" ? blessed.button({ mouse: true })
          : tag === "input" ? blessed.textbox({ inputOnFocus: true })
          : blessed.box({});
        return { [RenderNodeTypeId]: RenderNodeTypeId, element: el } as unknown as RenderNode;
      }),

      createText: (content) => Effect.sync(() => {
        const el = blessed.text({ content });
        return { [RenderNodeTypeId]: RenderNodeTypeId, element: el } as unknown as RenderNode;
      }),

      setProperty: (node, key, value) => Effect.sync(() => {
        const tui = node as unknown as TuiNode;
        if (key === "class" || key === "style") {
          tui.element.style = parseTuiStyle(value);
        } else if (key === "content" || key === "label") {
          (tui.element as any)[key] = value;
        }
      }),

      appendChild: (parent, child) => Effect.sync(() => {
        const p = parent as unknown as TuiNode;
        const c = child as unknown as TuiNode;
        p.element.append(c.element);
      }),

      removeChild: (parent, child) => Effect.sync(() => {
        const c = child as unknown as TuiNode;
        c.element.detach();
      }),

      addEventListener: (node, event, handler) =>
        Effect.gen(function* () {
          const tui = node as unknown as TuiNode;
          const mappedEvent = mapDomEventToTui(event);
          tui.element.on(mappedEvent, handler);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => tui.element.removeListener(mappedEvent, handler))
          );
        }).pipe(Effect.scoped) as any,

      requestFrame: (fn) => Effect.sync(() => setImmediate(fn)),

      batch: (fn) => Effect.sync(() => {
        fn();
        screen.render();
      }),

      mount: (root, _container) => Effect.sync(() => {
        screen.append((root as unknown as TuiNode).element);
        screen.render();
      }),

      getContainer: (_target) => Effect.sync(() =>
        ({ [RenderNodeTypeId]: RenderNodeTypeId, element: screen } as unknown as RenderNode)
      ),
    };
  })
);
```

**React Native / mobile renderer:**

```ts
const MobileRenderer = Layer.scoped(Renderer,
  Effect.gen(function* () {
    const bridge = yield* NativeBridge;

    return {
      createElement: (tag) => Effect.gen(function* () {
        const nativeType = mapTagToNative(tag);
        const viewId = yield* bridge.createView(nativeType);
        return { [RenderNodeTypeId]: RenderNodeTypeId, viewId } as unknown as RenderNode;
      }),

      setProperty: (node, key, value) => Effect.gen(function* () {
        const mobile = node as unknown as { viewId: string };
        yield* bridge.setViewProp(mobile.viewId, key, value);
      }),

      appendChild: (parent, child) => Effect.gen(function* () {
        const p = parent as unknown as { viewId: string };
        const c = child as unknown as { viewId: string };
        yield* bridge.addChild(p.viewId, c.viewId);
      }),

      addEventListener: (node, event, handler) =>
        Effect.gen(function* () {
          const mobile = node as unknown as { viewId: string };
          const subscription = yield* bridge.subscribe(mobile.viewId, event, handler);
          yield* Effect.addFinalizer(() => subscription.unsubscribe());
        }).pipe(Effect.scoped) as any,

      requestFrame: (fn) => Effect.sync(() => bridge.requestAnimationFrame(fn)),

      batch: (fn) => Effect.gen(function* () {
        yield* bridge.beginBatch();
        fn();
        yield* bridge.commitBatch();
      }),

      mount: (root, container) => Effect.gen(function* () {
        yield* bridge.mountRoot((root as any).viewId, container);
      }),

      getContainer: (target) => Effect.gen(function* () {
        const viewId = yield* bridge.getRootView(target);
        return { [RenderNodeTypeId]: RenderNodeTypeId, viewId } as unknown as RenderNode;
      }),
    };
  })
);
```

**Canvas / WebGL renderer:**

```ts
const CanvasRenderer = Layer.scoped(Renderer,
  Effect.gen(function* () {
    const canvas = document.createElement("canvas");
    const ctx2d = canvas.getContext("2d")!;
    const sceneGraph = yield* Ref.make<SceneNode[]>([]);

    // Render loop as a scoped fiber
    yield* Effect.gen(function* () {
      while (true) {
        const nodes = yield* Ref.get(sceneGraph);
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        renderSceneGraph(ctx2d, nodes);
        yield* Effect.sleep("16 millis"); // ~60fps
      }
    }).pipe(Effect.forkScoped);

    return {
      createElement: (tag) => Effect.sync(() => {
        const node: CanvasNode = {
          type: tag,
          props: {},
          children: [],
          layout: { x: 0, y: 0, width: 0, height: 0 },
        };
        return { [RenderNodeTypeId]: RenderNodeTypeId, ...node } as unknown as RenderNode;
      }),

      setProperty: (node, key, value) => Effect.sync(() => {
        (node as any).props[key] = value;
        // Mark dirty for next frame
      }),

      appendChild: (parent, child) => Effect.gen(function* () {
        (parent as any).children.push(child);
        yield* Ref.update(sceneGraph, (nodes) => [...nodes]); // trigger re-render
      }),

      // ... etc

      mount: (root, container) => Effect.sync(() => {
        (container as HTMLElement).appendChild(canvas);
        Ref.update(sceneGraph, () => [root as any]);
      }),
    };
  })
);
```

**Same component, four renderers:**

```tsx
const TodoApp = Component.make(
  Component.props<{}>(),
  Component.require(Api, Renderer),

  (props) => Effect.gen(function* () {
    const api = yield* Api;

    const todos = yield* Component.query(
      () => api.listTodos(),
      { name: "todos" },
    );

    const addTodo = yield* Component.action(
      Effect.fn(function* (text: string) {
        yield* api.addTodo(text);
      }),
      { reactivityKeys: ["todos"] },
    );

    const input = yield* Component.state("");

    return { todos, addTodo, input };
  }),

  (props, { todos, addTodo, input }) => (
    <div>
      <input
        value={input()}
        onInput={(e) => input.set(e.target.value)}
      />
      <button onClick={() => { addTodo(input()); input.set(""); }}>
        Add
      </button>
      <Async
        result={todos()}
        loading={() => <p>Loading...</p>}
        success={(items) => (
          <ul>
            <For each={items}>{(todo) => <li>{todo().text}</li>}</For>
          </ul>
        )}
      />
    </div>
  ),
);

// Web
Component.mount(TodoApp, {
  layer: Layer.mergeAll(ApiLive, DomRenderer),
  target: document.getElementById("root")!,
});

// Terminal
Component.mount(TodoApp, {
  layer: Layer.mergeAll(ApiLive, TuiRenderer),
  target: process.stdout,
});

// Mobile
Component.mount(TodoApp, {
  layer: Layer.mergeAll(ApiLive, MobileRenderer, NativeBridgeLive),
  target: "root-view",
});

// Testing — no renderer at all, just test the logic
const test = Effect.gen(function* () {
  const bindings = yield* Component.setupEffect(TodoApp, {});
  yield* TestClock.adjust("100 millis");
  assert.deepEqual(Result.getOrThrow(bindings.todos()), [...]);
}).pipe(
  Effect.provide(TestApiLayer),
  Effect.scoped,
);
```

The component code doesn't change. The setup logic is identical. The view function uses the same JSX. Only the layer changes.

**But wait — JSX assumes DOM semantics. How does the view work across renderers?**

This is the hard problem. `<div>`, `<input>`, `<button>` are DOM concepts. A TUI has boxes and text. Mobile has views and scroll containers. There are two approaches.

**Approach A: Abstract element vocabulary.**

Define a renderer-agnostic element set that each renderer maps to its native equivalent:

```tsx
import { Box, Text, Input, Button, List, ListItem, Stack } from "effect-atom-jsx/elements";

const TodoApp = Component.make(
  // ...
  (props, { todos, addTodo, input }) => (
    <Stack direction="vertical">
      <Stack direction="horizontal">
        <Input
          value={input()}
          onInput={(e) => input.set(e.target.value)}
          placeholder="New todo..."
        />
        <Button onPress={() => { addTodo(input()); input.set(""); }}>
          <Text>Add</Text>
        </Button>
      </Stack>
      <Async
        result={todos()}
        loading={() => <Text>Loading...</Text>}
        success={(items) => (
          <List>
            <For each={items}>
              {(todo) => (
                <ListItem>
                  <Text>{todo().text}</Text>
                </ListItem>
              )}
            </For>
          </List>
        )}
      />
    </Stack>
  ),
);
```

Each renderer maps these to native elements:

```ts
// DOM: Box -> div, Text -> span, Input -> input, Button -> button
// TUI: Box -> blessed.box, Text -> blessed.text, Input -> blessed.textbox
// Mobile: Box -> View, Text -> Text, Input -> TextInput
// Canvas: Box -> rect node, Text -> text node
```

The abstract elements carry layout and style information in a portable way:

```tsx
<Box
  padding={[8, 16]}
  background="surface"
  border={{ width: 1, color: "border", radius: 4 }}
  flex={{ direction: "row", gap: 8 }}
>
  <Text size="body" color="primary" weight="bold">Hello</Text>
</Box>
```

The renderer translates `padding`, `background`, `border`, `flex` into whatever the target platform uses — CSS for DOM, blessed styles for TUI, native layout props for mobile, manual positioning for canvas.

**Approach B: Renderer-specific views with shared setup.**

The more pragmatic approach. The setup is shared, but each renderer gets its own view:

```tsx
// Shared setup — renderer-agnostic
const todoSetup = (props: {}) => Effect.gen(function* () {
  const api = yield* Api;
  const todos = yield* Component.query(() => api.listTodos());
  const addTodo = yield* Component.action(
    Effect.fn(function* (text: string) { yield* api.addTodo(text); }),
    { reactivityKeys: ["todos"] },
  );
  const input = yield* Component.state("");
  return { todos, addTodo, input };
});

// DOM view
const TodoAppWeb = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  todoSetup,
  (props, { todos, addTodo, input }) => (
    <div class="todo-app">
      <input value={input()} onInput={(e) => input.set(e.target.value)} />
      <button onClick={() => addTodo(input())}>Add</button>
      <Async result={todos()} success={(items) => (
        <ul>{items.map((t) => <li>{t.text}</li>)}</ul>
      )} />
    </div>
  ),
);

// TUI view
const TodoAppTui = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  todoSetup,
  (props, { todos, addTodo, input }) => (
    <box top={0} left={0} width="100%" height="100%">
      <textbox top={0} left={0} width="80%" value={input()} />
      <button top={0} right={0} content="Add" onPress={() => addTodo(input())} />
      <list top={2} items={Result.getOrElse(todos(), () => []).map((t) => t.text)} />
    </box>
  ),
);
```

Same setup, different views. The setup is the headless component. The view is renderer-specific. This is approach A's abstract elements taken to the logical extreme — the consumer provides the entire view.

**Approach C: Both. Abstract elements with renderer-specific escape hatches.**

```tsx
import { Box, Text, Input, Button } from "effect-atom-jsx/elements";

// Works on all renderers
const TodoApp = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  todoSetup,
  (props, bindings) => (
    <Box>
      <Input value={bindings.input()} onInput={(v) => bindings.input.set(v)} />
      <Button onPress={() => bindings.addTodo(bindings.input())}>
        <Text>Add</Text>
      </Button>
    </Box>
  ),
);

// When you need platform-specific rendering, use Platform.match
import { Platform } from "effect-atom-jsx";

const TodoAppPlatformAware = Component.make(
  Component.props<{}>(),
  Component.require(Api, Platform),
  (props) => Effect.gen(function* () {
    const platform = yield* Platform;
    const setup = yield* todoSetup(props);
    return { ...setup, platform: platform.type };
  }),
  (props, bindings) => (
    <Platform.Match
      dom={() => (
        <div class="web-specific">
          <input value={bindings.input()} />
          <button onClick={() => bindings.addTodo(bindings.input())}>Add</button>
        </div>
      )}
      tui={() => (
        <box>
          <textbox value={bindings.input()} />
          <button content="Add" />
        </box>
      )}
      mobile={() => (
        <NativeView>
          <NativeTextInput value={bindings.input()} />
          <NativeButton title="Add" />
        </NativeView>
      )}
    />
  ),
);
```

**The Renderer service as a layer hierarchy:**

The renderer isn't just one service — it's a family of services that can be composed:

```ts
// Core rendering
class Renderer extends Effect.Tag("Renderer")<Renderer, RenderPrimitives>() {}

// Layout engine
class LayoutEngine extends Effect.Tag("LayoutEngine")<LayoutEngine, {
  readonly computeLayout: (tree: LayoutTree) => Effect.Effect<ComputedLayout>;
}>() {}

// Style resolution
class StyleResolver extends Effect.Tag("StyleResolver")<StyleResolver, {
  readonly resolve: (styles: StyleDeclaration) => Effect.Effect<ResolvedStyles>;
  readonly theme: ReadonlyAtom<ThemeTokens>;
}>() {}

// Event system
class EventSystem extends Effect.Tag("EventSystem")<EventSystem, {
  readonly addEventListener: (node: RenderNode, event: string, handler: Handler) => Effect.Effect<void, never, Scope>;
  readonly createEventBus: () => Effect.Effect<PubSub.PubSub<AppEvent>>;
}>() {}

// Accessibility
class AccessibilityService extends Effect.Tag("A11y")<AccessibilityService, {
  readonly setRole: (node: RenderNode, role: string) => Effect.Effect<void>;
  readonly setLabel: (node: RenderNode, label: string) => Effect.Effect<void>;
  readonly announce: (message: string) => Effect.Effect<void>;
}>() {}

// Compose into a full rendering stack
const DomRenderStack = Layer.mergeAll(
  DomRendererLive,
  CssLayoutEngine,
  CssStyleResolver,
  DomEventSystem,
  AriaAccessibility,
);

const TuiRenderStack = Layer.mergeAll(
  TuiRendererLive,
  FlexLayoutEngine,  // yoga-layout for TUI
  TuiStyleResolver,
  TuiEventSystem,
  TuiAccessibility,  // screen reader announcements via terminal
);

const TestRenderStack = Layer.mergeAll(
  NoopRenderer,       // does nothing — for headless testing
  MockLayoutEngine,
  MockStyleResolver,
  MockEventSystem,
  MockAccessibility,
);
```

Components declare which parts of the rendering stack they need:

```tsx
const AnimatedCard = Component.make(
  Component.props<{}>(),
  Component.require(Renderer, LayoutEngine, StyleResolver),

  (props) => Effect.gen(function* () {
    const renderer = yield* Renderer;
    const layout = yield* LayoutEngine;
    const style = yield* StyleResolver;

    // Use layout engine to compute positions
    const cardLayout = yield* Component.derived(() =>
      layout.computeLayout({ type: "card", children: props.children })
    );

    return { cardLayout };
  }),

  (props, { cardLayout }) => (
    <Box layout={cardLayout()}>
      {props.children}
    </Box>
  ),
);
```

**SSR becomes a renderer:**

Server-side rendering is just a renderer that produces strings instead of DOM nodes:

```ts
const SsrRenderer = Layer.succeed(Renderer, {
  createElement: (tag) => Effect.sync(() => ({
    [RenderNodeTypeId]: RenderNodeTypeId,
    tag,
    attrs: {} as Record<string, string>,
    children: [] as any[],
  } as unknown as RenderNode)),

  createText: (content) => Effect.sync(() => ({
    [RenderNodeTypeId]: RenderNodeTypeId,
    text: content,
  } as unknown as RenderNode)),

  setProperty: (node, key, value) => Effect.sync(() => {
    (node as any).attrs[key] = String(value);
  }),

  appendChild: (parent, child) => Effect.sync(() => {
    (parent as any).children.push(child);
  }),

  // Events are no-ops during SSR
  addEventListener: () => Effect.void as any,

  // No animation frames during SSR
  requestFrame: () => Effect.void,

  mount: () => Effect.void,

  getContainer: () => Effect.sync(() => ({
    [RenderNodeTypeId]: RenderNodeTypeId,
    tag: "root",
    attrs: {},
    children: [],
  } as unknown as RenderNode)),
});

// Serialize the render tree to HTML
class SsrSerializer extends Effect.Tag("SsrSerializer")<SsrSerializer, {
  readonly toHtml: (root: RenderNode) => Effect.Effect<string>;
}>() {}

const SsrSerializerLive = Layer.succeed(SsrSerializer, {
  toHtml: (root) => Effect.sync(() => renderNodeToHtml(root)),
});
```

Server rendering is an Effect pipeline:

```ts
const renderPage: Effect.Effect<string, RenderError, Api | Db> =
  Effect.gen(function* () {
    const serializer = yield* SsrSerializer;
    const root = yield* Component.renderToNode(App, {});
    const html = yield* serializer.toHtml(root);

    // Collect atom state for hydration
    const state = yield* Hydration.collectState();

    return `
      <!DOCTYPE html>
      <html>
        <body>
          <div id="root">${html}</div>
          <script>window.__STATE__ = ${JSON.stringify(state)}</script>
          <script src="/app.js"></script>
        </body>
      </html>
    `;
  });

// Run with SSR layers
const html = await Effect.runPromise(
  renderPage.pipe(
    Effect.provide(Layer.mergeAll(
      SsrRenderer,
      SsrSerializerLive,
      ApiLive,
      DbLive,
    )),
    Effect.scoped,
  ),
);
```

The component code is identical to what runs in the browser. The setup Effect is the same. The view function is the same. Only the renderer layer changes.

**Streaming SSR:**

Because rendering is an Effect and Effects compose with Streams:

```ts
const streamPage: Stream.Stream<string, RenderError, Api | Db> =
  Stream.gen(function* () {
    yield* Stream.make("<!DOCTYPE html><html><body><div id='root'>");

    // Stream component tree rendering as chunks
    yield* Component.renderToStream(App, {}).pipe(
      Stream.map((chunk) => chunk.html),
    );

    yield* Stream.make("</div>");

    // Stream serialized state
    const state = yield* Hydration.collectState();
    yield* Stream.make(`<script>window.__STATE__ = ${JSON.stringify(state)}</script>`);

    yield* Stream.make("</body></html>");
  });

// Pipe to HTTP response
app.get("/", (req, res) => {
  const stream = streamPage.pipe(
    Stream.provideLayer(Layer.mergeAll(SsrRenderer, ApiLive, DbLive)),
  );

  Stream.runForEach(stream, (chunk) =>
    Effect.sync(() => res.write(chunk))
  ).pipe(
    Effect.tap(() => Effect.sync(() => res.end())),
    Effect.runPromise,
  );
});
```

**Static site generation:**

SSG is just SSR run at build time for multiple routes:

```ts
const generateSite: Effect.Effect<void, BuildError, Api | Db | FileSystem> =
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const routes = ["/", "/about", "/users", "/users/1", "/users/2"];

    yield* Effect.forEach(routes, (route) =>
      Effect.gen(function* () {
        const html = yield* renderPage.pipe(
          Effect.provideService(Router, { currentRoute: route }),
        );
        yield* fs.writeFile(`dist${route}/index.html`, html);
      }),
      { concurrency: 10 },
    );
  });
```

Ten routes rendered concurrently, each with its own scoped rendering context, errors typed and composable. 

**Testing renderer — captures operations for assertions:**

```ts
const TestRenderer = Layer.effect(Renderer,
  Effect.gen(function* () {
    const operations = yield* Ref.make<RenderOp[]>([]);

    return {
      createElement: (tag) => Effect.gen(function* () {
        const id = crypto.randomUUID();
        yield* Ref.update(operations, (ops) => [...ops, { type: "create", tag, id }]);
        return { [RenderNodeTypeId]: RenderNodeTypeId, id, tag } as unknown as RenderNode;
      }),

      setProperty: (node, key, value) => Effect.gen(function* () {
        yield* Ref.update(operations, (ops) => [
          ...ops,
          { type: "setProp", nodeId: (node as any).id, key, value },
        ]);
      }),

      appendChild: (parent, child) => Effect.gen(function* () {
        yield* Ref.update(operations, (ops) => [
          ...ops,
          { type: "appendChild", parentId: (parent as any).id, childId: (child as any).id },
        ]);
      }),

      // ... etc
    };
  })
);

// Test assertions on render operations
const test = Effect.gen(function* () {
  yield* Component.render(TodoApp, {});
  yield* TestClock.adjust("100 millis"); // let queries settle

  const ops = yield* TestRenderer.getOperations();

  // Assert structure
  const creates = ops.filter((op) => op.type === "create");
  assert(creates.some((op) => op.tag === "ul")); // list was rendered

  // Assert content
  const textSets = ops.filter((op) => op.type === "setText");
  assert(textSets.some((op) => op.content === "Buy milk"));
});
```

**The implication for the JSX compiler:**

Currently `babel-plugin-jsx-dom-expressions` compiles JSX to direct DOM calls. For renderer-agnostic output, the compiler needs to target the `Renderer` service's methods instead:

```tsx
// Input JSX
<div class="card">
  <p>{name()}</p>
</div>

// Current compilation (DOM-specific)
const _el = document.createElement("div");
_el.className = "card";
const _el2 = document.createElement("p");
_el.appendChild(_el2);
createEffect(() => _el2.textContent = name());

// Renderer-agnostic compilation
const _el = yield* renderer.createElement("div");
yield* renderer.setProperty(_el, "class", "card");
const _el2 = yield* renderer.createElement("p");
yield* renderer.appendChild(_el, _el2);
createEffect(
  () => name(),
  (value) => renderer.setText(_el2, value),
);
```

This is where `dom-expressions` would need to be forked or abstracted. The dom-expressions library assumes DOM APIs. A renderer-agnostic version would compile JSX to calls against the `Renderer` service interface.

The pragmatic path: keep dom-expressions for the DOM renderer (it's fast, battle-tested), but provide an alternative compilation target for the abstract renderer:

```json
{
  "plugins": [
    ["babel-plugin-jsx-dom-expressions", {
      "moduleName": "effect-atom-jsx/dom"
    }]
  ]
}

// OR for renderer-agnostic

{
  "plugins": [
    ["babel-plugin-jsx-universal-expressions", {
      "moduleName": "effect-atom-jsx/universal"
    }]
  ]
}
```

**The full architecture:**

```
Component<Props, Req, E>
  │
  ├── Setup: Effect<Bindings, E, Req | Scope>
  │     ├── yield* services (context)
  │     ├── Component.query (reactive data)
  │     ├── Component.state (reactive state)
  │     ├── Component.action (mutations)
  │     └── Effect.addFinalizer (cleanup)
  │
  └── View: (Props, Bindings) → JSX
        │
        └── JSX compiles to Renderer service calls
              │
              ├── DomRenderer (browser)
              ├── TuiRenderer (terminal)
              ├── MobileRenderer (native)
              ├── CanvasRenderer (WebGL/2D)
              ├── SsrRenderer (server → HTML string)
              ├── StreamRenderer (server → chunked HTML)
              └── TestRenderer (captures operations)

Layer composition:
  App = Component logic + Business services + Renderer

  Browser:  AppLayer = ApiLive + DbLive + DomRenderer
  Terminal: AppLayer = ApiLive + DbLive + TuiRenderer
  Server:   AppLayer = ApiLive + DbLive + SsrRenderer
  Test:     AppLayer = TestApi + TestDb + TestRenderer (or no renderer)
```

Components don't know what renderer they're using. Services don't know what renderer they're targeting. The renderer is just another layer. Everything is an Effect. Everything is scoped. Everything is typed. Everything is testable.

This is what "rendering is an Effect" means taken to its conclusion. The framework becomes a thin typed bridge between Effect programs and whatever output medium you target. The component model, the state management, the service integration, the error handling, the resource management — all of that is Effect. Only the final "put pixels/characters/native views on screen" step is renderer-specific, and that step is a swappable service.