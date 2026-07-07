You're almost there. The primitives cover rendering, elements, events, styles, lifecycle, and services. But to use React, Vue, Svelte, or Angular as a renderer/platform, you need a few bridge pieces that don't exist yet. Let me trace through what works, what's missing, and what falls out.

**What already works:**

Setup as an Effect — this is framework-agnostic. An Effect that creates atoms, queries, and actions doesn't care what renders the result. The setup produces bindings. Something needs to consume those bindings and put UI on screen. That something is currently our renderer service. If React is the renderer, it consumes the same bindings.

Services via layers — completely framework-agnostic. `yield* Api` works regardless of what renders the UI.

Typed elements and events — these are already parameterized by platform. A React platform would define React-flavored elements and events.

Scope-based lifecycle — this is the one that needs the most bridging work.

**The core missing piece: a reactivity bridge.**

Our atoms are the source of truth. React has `useState`/`useSyncExternalStore`. Vue has `ref`/`reactive`. Svelte has `$state`. Angular has signals. Each framework has its own way of knowing when to re-render. The bridge needs to tell the host framework "this atom changed, re-render the component that reads it."

This is a service:

```ts
class ReactivityBridge extends Effect.Tag("ReactivityBridge")<ReactivityBridge, {
  // Subscribe a host framework component to an atom's changes
  readonly subscribe: <A>(atom: ReadonlyAtom<A>, onUpdate: () => void) => Effect.Effect<void, never, Scope>;

  // Read an atom's current value (synchronous, for render phase)
  readonly read: <A>(atom: ReadonlyAtom<A>) => A;

  // Batch multiple atom writes into a single host framework update
  readonly batch: (fn: () => void) => void;

  // Create a host-framework-native reactive wrapper around an atom
  readonly toHostReactive: <A>(atom: ReadonlyAtom<A>) => unknown;
}>() {}
```

Each framework implements this differently.

**React as a renderer:**

```ts
const ReactBridge = Layer.succeed(ReactivityBridge, {
  subscribe: (atom, onUpdate) =>
    Effect.gen(function* () {
      // useSyncExternalStore expects a subscribe function
      // We hook our atom subscription into React's external store protocol
      const unsubscribe = atom.subscribe(onUpdate);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => unsubscribe())
      );
    }),

  read: (atom) => atom(),

  batch: (fn) => ReactDOM.unstable_batchedUpdates(fn),

  toHostReactive: (atom) => atom, // React reads via useSyncExternalStore
});
```

The React renderer wraps our components into React components. Each of our `Component<Props, Req, E>` becomes a React function component that:

1. Runs our setup Effect once (in a `useEffect` or `useRef` for initialization)
2. Subscribes to our atoms via `useSyncExternalStore`
3. Calls our view function with the bindings
4. Cleans up our scope on unmount

```ts
const ReactRenderer = Layer.scoped(Renderer,
  Effect.gen(function* () {
    return {
      // Wrap our Component into a React component
      toHostComponent: <P, R, E>(
        component: Component<P, R, E>,
        layer: Layer<R>,
      ) => {
        // Returns a React function component
        return function ReactWrapper(props: P) {
          // Run setup once
          const bindingsRef = React.useRef<any>(null);
          const scopeRef = React.useRef<Scope>(null);

          if (!bindingsRef.current) {
            const { bindings, scope } = Effect.runSync(
              Effect.gen(function* () {
                const scope = yield* Scope.make();
                const bindings = yield* component.setup(props).pipe(
                  Effect.provideService(Scope, scope),
                  Effect.provide(layer),
                );
                return { bindings, scope };
              })
            );
            bindingsRef.current = bindings;
            scopeRef.current = scope;
          }

          // Cleanup scope on unmount
          React.useEffect(() => {
            return () => {
              if (scopeRef.current) {
                Effect.runSync(Scope.close(scopeRef.current, Exit.void));
              }
            };
          }, []);

          // Subscribe to atoms in bindings
          // Each atom read triggers useSyncExternalStore
          return component.view(props, bindingsRef.current);
        };
      },

      createElement: (tag) => Effect.sync(() =>
        React.createElement(tag) as unknown as RenderNode
      ),
      // ... rest of Renderer interface
    };
  })
);
```

But this is awkward. We're wrapping our component model inside React's component model. The view function returns JSX, but React expects React JSX, not our compiled `View.gen` JSX. This is the fundamental tension.

**The cleaner approach: our Component IS the host framework component.**

Instead of wrapping, our `Component.make` compiles to the host framework's component model. The setup becomes framework-native initialization. The atoms become framework-native reactive state. The view is the framework's template/render function.

```ts
// React platform: Component.make produces a React component
// that uses useSyncExternalStore for atom reads

// Vue platform: Component.make produces a Vue component
// that uses Vue's reactivity system for atom reads

// Svelte platform: Component.make produces a Svelte component
// that uses Svelte's $state rune for atom reads
```

This means the platform layer doesn't just define elements and events — it defines how components are instantiated and how reactivity is bridged.

**The ComponentHost service:**

```ts
class ComponentHost extends Effect.Tag("ComponentHost")<ComponentHost, {
  // How to instantiate a component in this framework
  readonly createInstance: <P, Bindings>(
    setup: (props: P) => Effect.Effect<Bindings, any, any>,
    view: (props: P, bindings: Bindings) => HostNode,
    props: P,
    scope: Scope,
  ) => HostComponent;

  // How to make an atom readable by the host framework's reactivity
  readonly bindAtom: <A>(atom: ReadonlyAtom<A>) => HostReactive<A>;

  // How to make an atom writable from host framework events
  readonly bindWritableAtom: <A>(atom: WritableAtom<A>) => HostWritableReactive<A>;

  // How to render children in the host framework
  readonly renderChildren: (children: HostNode[]) => HostNode;

  // How to conditionally render (Show)
  readonly conditional: <A>(
    condition: () => A | false | null | undefined,
    render: (value: A) => HostNode,
    fallback?: () => HostNode,
  ) => HostNode;

  // How to render a list (For)
  readonly list: <A>(
    items: () => readonly A[],
    render: (item: A, index: () => number) => HostNode,
    key?: (item: A) => string,
  ) => HostNode;

  // Mount root
  readonly mount: (node: HostNode, container: unknown) => Effect.Effect<void>;

  // Unmount
  readonly unmount: (container: unknown) => Effect.Effect<void>;
}>() {}
```

`HostNode` and `HostReactive` are opaque types that each framework fills in:

```ts
// React
type HostNode = React.ReactElement;
type HostReactive<A> = { read: () => A; subscribe: (cb: () => void) => () => void };
type HostComponent = React.FC;

// Vue
type HostNode = VNode;
type HostReactive<A> = Ref<A>;
type HostComponent = DefineComponent;

// Svelte
type HostNode = SvelteComponent;
type HostReactive<A> = Readable<A>;
type HostComponent = SvelteComponent;

// Angular
type HostNode = TemplateRef;
type HostReactive<A> = Signal<A>;
type HostComponent = Component;
```

**React as a ComponentHost:**

```ts
const ReactHost = Layer.succeed(ComponentHost, {
  createInstance: (setup, view, props, scope) => {
    return function ReactComponent(hostProps: any) {
      const [bindings, setBindings] = React.useState<any>(null);
      const scopeRef = React.useRef(scope);

      // Run setup once
      React.useEffect(() => {
        const result = Effect.runSync(
          setup(hostProps).pipe(
            Effect.provideService(Scope, scopeRef.current),
          )
        );
        setBindings(result);

        return () => {
          Effect.runSync(Scope.close(scopeRef.current, Exit.void));
        };
      }, []);

      if (!bindings) return null;
      return view(hostProps, bindings);
    };
  },

  bindAtom: (atom) => ({
    read: () => atom(),
    subscribe: (cb) => atom.subscribe(cb),
  }),

  renderChildren: (children) => React.createElement(React.Fragment, null, ...children),

  conditional: (condition, render, fallback) => {
    return function ConditionalWrapper() {
      const value = useSyncExternalStore(
        (cb) => { /* subscribe to condition's deps */ return () => {} },
        condition,
      );
      if (value) return render(value);
      return fallback ? fallback() : null;
    } as any;
  },

  list: (items, render, key) => {
    return function ListWrapper() {
      const list = useSyncExternalStore(
        (cb) => { /* subscribe to items' deps */ return () => {} },
        items,
      );
      return React.createElement(
        React.Fragment,
        null,
        list.map((item, i) => {
          const el = render(item, () => i);
          return key
            ? React.cloneElement(el, { key: key(item) })
            : React.cloneElement(el, { key: i });
        }),
      );
    } as any;
  },

  mount: (node, container) => Effect.sync(() => {
    const root = ReactDOM.createRoot(container as HTMLElement);
    root.render(node as React.ReactElement);
  }),

  unmount: (container) => Effect.sync(() => {
    const root = ReactDOM.createRoot(container as HTMLElement);
    root.unmount();
  }),
});
```

**Vue as a ComponentHost:**

```ts
const VueHost = Layer.succeed(ComponentHost, {
  createInstance: (setup, view, props, scope) => {
    return defineComponent({
      props: Object.keys(props) as any,
      setup(hostProps) {
        const bindings = shallowRef<any>(null);
        const scopeVal = scope;

        // Run setup once
        onMounted(() => {
          const result = Effect.runSync(
            setup(hostProps).pipe(
              Effect.provideService(Scope, scopeVal),
            )
          );
          bindings.value = result;
        });

        onUnmounted(() => {
          Effect.runSync(Scope.close(scopeVal, Exit.void));
        });

        return () => {
          if (!bindings.value) return null;
          return view(hostProps, bindings.value);
        };
      },
    });
  },

  bindAtom: (atom) => {
    // Bridge our atom into Vue's reactivity
    const vueRef = shallowRef(atom());
    // Watch our atom and update the Vue ref
    watch(
      () => atom(),
      (newVal) => { vueRef.value = newVal; },
    );
    return vueRef;
  },

  bindWritableAtom: (atom) => {
    const vueRef = ref(atom());
    // Two-way sync: atom → vue ref, vue ref → atom
    watch(
      () => atom(),
      (newVal) => { vueRef.value = newVal; },
    );
    watch(vueRef, (newVal) => { atom.set(newVal); });
    return vueRef;
  },

  conditional: (condition, render, fallback) => {
    // Vue template: v-if equivalent
    return () => {
      const value = condition();
      if (value) return render(value);
      return fallback ? fallback() : null;
    };
  },

  list: (items, render, key) => {
    // Vue template: v-for equivalent
    return () => items().map((item, i) => render(item, () => i));
  },

  mount: (node, container) => Effect.sync(() => {
    const app = createApp(node as any);
    app.mount(container as HTMLElement);
  }),

  unmount: (container) => Effect.sync(() => {
    // Vue unmount
  }),
});
```

**Svelte as a ComponentHost:**

```ts
const SvelteHost = Layer.succeed(ComponentHost, {
  createInstance: (setup, view, props, scope) => {
    // Svelte 5 with runes
    return class SvelteWrapper {
      bindings = $state(null);
      scope = scope;

      constructor(target: HTMLElement, hostProps: any) {
        const result = Effect.runSync(
          setup(hostProps).pipe(
            Effect.provideService(Scope, this.scope),
          )
        );
        this.bindings = result;
      }

      destroy() {
        Effect.runSync(Scope.close(this.scope, Exit.void));
      }
    };
  },

  bindAtom: (atom) => {
    // Bridge to Svelte's reactive system
    // Svelte 5: create a $derived that reads our atom
    let value = $state(atom());
    atom.subscribe((newVal) => { value = newVal; });
    return { get value() { return value; } };
  },

  // ... similar bridges for other operations
});
```

**But there's a deeper problem: the view function.**

Our view function currently produces our own JSX — compiled to `View.gen` with `yield*` calls. React expects React elements. Vue expects VNodes. Svelte expects Svelte template output. The view can't produce a universal output that all frameworks consume.

Two approaches:

**Approach A: The view function produces host-framework JSX.**

Instead of our own JSX compilation, use the host framework's JSX:

```tsx
// When React is the host, the view function uses React JSX
// The Babel plugin compiles to React.createElement
const Counter = Component.make(
  Component.props<{}>(),
  Component.require(),
  (props) => Effect.gen(function* () {
    const count = yield* Component.state(0);
    return { count };
  }),
  // This view is React JSX — compiled by React's JSX transform
  (props, { count }) => (
    <div>
      <p>Count: {useAtomValue(count)}</p>
      <button onClick={() => count.update(n => n + 1)}>+</button>
    </div>
  ),
);
```

But this means the view is framework-specific. You can't write one view that works on React and Vue. The setup is universal, the view is not.

This is actually fine for most cases. It means:

```
Universal:
  - Setup (Effects, atoms, services, queries, actions)
  - Component type (Props, Req, E)
  - Pipes (guards, error boundaries, layers)
  - Testing (setup-only, no rendering)

Platform-specific:
  - View function (React JSX, Vue template, Svelte template)
  - Element types (from platform layer)
  - Event types (from platform layer)
```

**Approach B: Our view compiles to an intermediate representation that each host framework consumes.**

The view produces an IR — a tree of nodes, attributes, and reactive bindings. Each host framework has an adapter that turns the IR into its native output:

```ts
// View produces an IR
interface ViewIR {
  readonly type: "element" | "text" | "component" | "fragment";
  readonly tag?: string;
  readonly props?: Record<string, ViewIRValue>;
  readonly children?: readonly ViewIR[];
  readonly component?: Component<any, any, any>;
  readonly text?: string;
  readonly reactive?: ReadonlyAtom<any>;
}

type ViewIRValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyAtom<any>           // reactive value
  | ((event: any) => void)      // event handler
  | ((event: any) => Effect.Effect<any, any, any>)  // effect handler
  ;

// Each host framework has an IR-to-native adapter
class ViewAdapter extends Effect.Tag("ViewAdapter")<ViewAdapter, {
  readonly render: (ir: ViewIR) => HostNode;
}>() {}
```

The Babel plugin compiles our JSX to IR construction:

```tsx
// JSX
<div class={isActive() ? "active" : ""}>
  <p>{message()}</p>
  <button onClick={handleClick}>Click</button>
</div>

// Compiled to IR
ViewIR.element("div", {
  class: Atom.derived(() => isActive() ? "active" : ""),
}, [
  ViewIR.element("p", {}, [
    ViewIR.reactive(message),
  ]),
  ViewIR.element("button", {
    onClick: handleClick,
  }, [
    ViewIR.text("Click"),
  ]),
])
```

Each framework adapter turns this IR into native output:

```ts
// React adapter
const ReactAdapter = Layer.succeed(ViewAdapter, {
  render: (ir) => {
    switch (ir.type) {
      case "element":
        const reactProps = {};
        for (const [key, value] of Object.entries(ir.props ?? {})) {
          if (isAtom(value)) {
            // Wrap in a component that uses useSyncExternalStore
            reactProps[key] = useAtomValue(value);
          } else {
            reactProps[key] = value;
          }
        }
        return React.createElement(
          ir.tag!,
          reactProps,
          ...(ir.children ?? []).map(child => this.render(child)),
        );
      case "text":
        return ir.text;
      case "reactive":
        // Wrap in a component that subscribes to the atom
        return React.createElement(ReactiveText, { atom: ir.reactive });
      case "component":
        // Render our Component through the React host
        return React.createElement(
          componentToReact(ir.component, ir.props),
        );
    }
  },
});

// Vue adapter
const VueAdapter = Layer.succeed(ViewAdapter, {
  render: (ir) => {
    switch (ir.type) {
      case "element":
        const vueProps = {};
        for (const [key, value] of Object.entries(ir.props ?? {})) {
          if (isAtom(value)) {
            vueProps[key] = toVueRef(value);
          } else {
            vueProps[key] = value;
          }
        }
        return h(
          ir.tag!,
          vueProps,
          (ir.children ?? []).map(child => this.render(child)),
        );
      // ...
    }
  },
});
```

**Approach B is the truly universal one.** Write once, run on any framework. But the IR adds overhead and complexity. And framework-specific optimizations are harder through an IR layer.

**The pragmatic answer: both approaches, with the IR as the universal path and native JSX as the optimized path.**

```ts
// Universal component — view produces IR, works on any framework
const Counter = Component.make(
  Component.props<{}>(),
  Component.require(),
  (props) => Effect.gen(function* () {
    const count = yield* Component.state(0);
    return { count };
  }),
  // Universal view — compiled to IR by the universal Babel plugin
  (props, { count }) => (
    <Box>
      <Text>Count: {count()}</Text>
      <Button onPress={() => count.update(n => n + 1)}>+</Button>
    </Box>
  ),
);

// React-optimized component — view is native React JSX
const CounterReact = Component.make(
  Component.props<{}>(),
  Component.require(),
  (props) => Effect.gen(function* () {
    const count = yield* Component.state(0);
    return { count };
  }),
  // React-native view — compiled by React's JSX transform
  Component.reactView((props, { count }) => (
    <div>
      <p>Count: {useAtomValue(count)}</p>
      <button onClick={() => count.update(n => n + 1)}>+</button>
    </div>
  )),
);
```

Most library authors would use the universal path. App developers who care about performance on a specific framework would use the native path.

**But what's actually missing to make this work?**

**1. A lifecycle bridge service.**

Each framework has its own lifecycle. React has `useEffect` cleanup. Vue has `onMounted`/`onUnmounted`. Svelte has `onMount`/`onDestroy`. Angular has `ngOnInit`/`ngOnDestroy`. Our scope-based lifecycle needs to connect to these:

```ts
class LifecycleBridge extends Effect.Tag("LifecycleBridge")<LifecycleBridge, {
  // Register a callback that runs when the host component mounts
  readonly onHostMount: (fn: () => void) => void;

  // Register a callback that runs when the host component unmounts
  readonly onHostUnmount: (fn: () => void) => void;

  // Register a callback that runs when the host component updates
  readonly onHostUpdate: (fn: () => void) => void;

  // Connect our Scope.close to the host's unmount lifecycle
  readonly bindScope: (scope: Scope) => void;
}>() {}

// React lifecycle bridge
const ReactLifecycle = {
  onHostMount: (fn) => {
    React.useEffect(() => { fn(); }, []);
  },
  onHostUnmount: (fn) => {
    React.useEffect(() => fn, []);
  },
  onHostUpdate: (fn) => {
    React.useEffect(() => { fn(); });
  },
  bindScope: (scope) => {
    React.useEffect(() => {
      return () => {
        Effect.runSync(Scope.close(scope, Exit.void));
      };
    }, []);
  },
};

// Vue lifecycle bridge
const VueLifecycle = {
  onHostMount: (fn) => onMounted(fn),
  onHostUnmount: (fn) => onUnmounted(fn),
  onHostUpdate: (fn) => onUpdated(fn),
  bindScope: (scope) => {
    onUnmounted(() => {
      Effect.runSync(Scope.close(scope, Exit.void));
    });
  },
};

// Svelte lifecycle bridge
const SvelteLifecycle = {
  onHostMount: (fn) => onMount(fn),
  onHostUnmount: (fn) => onDestroy(fn),
  onHostUpdate: (fn) => afterUpdate(fn),
  bindScope: (scope) => {
    onDestroy(() => {
      Effect.runSync(Scope.close(scope, Exit.void));
    });
  },
};
```

**2. A context bridge.**

Our services are provided via Effect layers. Host frameworks have their own context systems. The bridge needs to flow our services through the host's context so child components can access them:

```ts
class ContextBridge extends Effect.Tag("ContextBridge")<ContextBridge, {
  // Provide a layer to the host framework's subtree
  readonly provideLayer: <R>(layer: Layer<R>) => HostContextProvider;

  // Read a service from the host framework's context
  readonly readService: <S>(tag: Context.Tag<S, S>) => S | undefined;
}>() {}

// React context bridge
// Uses React.createContext under the hood
const ReactContextBridge = {
  provideLayer: (layer) => {
    const runtime = Effect.runSync(ManagedRuntime.make(layer));
    const ctx = React.createContext(runtime);
    return {
      Provider: ({ children }) =>
        React.createElement(ctx.Provider, { value: runtime }, children),
      useRuntime: () => React.useContext(ctx),
    };
  },
  readService: (tag) => {
    const runtime = useNearestRuntime();
    return runtime?.context.get(tag);
  },
};

// Vue context bridge
// Uses Vue's provide/inject
const VueContextBridge = {
  provideLayer: (layer) => {
    const runtime = Effect.runSync(ManagedRuntime.make(layer));
    return {
      setup() { provide("effect-runtime", runtime); },
    };
  },
  readService: (tag) => {
    const runtime = inject("effect-runtime");
    return runtime?.context.get(tag);
  },
};
```

**3. A reactive primitive bridge.**

Our atoms need to talk to the host's reactive system bidirectionally. Not just "atom changed, re-render" but also "host reactive changed, update atom":

```ts
class ReactiveBridge extends Effect.Tag("ReactiveBridge")<ReactiveBridge, {
  // Our atom → host reactive (read-only)
  readonly fromAtom: <A>(atom: ReadonlyAtom<A>) => HostReactive<A>;

  // Our atom → host reactive (read-write)
  readonly fromWritableAtom: <A>(atom: WritableAtom<A>) => HostWritableReactive<A>;

  // Host reactive → our atom (for interop with existing host code)
  readonly toAtom: <A>(hostReactive: HostReactive<A>) => ReadonlyAtom<A>;

  // Host writable → our atom (bidirectional)
  readonly toWritableAtom: <A>(hostReactive: HostWritableReactive<A>) => WritableAtom<A>;
}>() {}

// React reactive bridge
const ReactReactiveBridge = {
  fromAtom: (atom) => ({
    // Compatible with useSyncExternalStore
    getSnapshot: () => atom(),
    subscribe: (cb: () => void) => atom.subscribe(cb),
  }),

  fromWritableAtom: (atom) => ({
    getSnapshot: () => atom(),
    subscribe: (cb: () => void) => atom.subscribe(cb),
    set: (value: any) => atom.set(value),
    update: (fn: any) => atom.update(fn),
  }),

  toAtom: (reactiveSource) => {
    // Create an atom that mirrors a React state/external source
    const atom = Atom.make(reactiveSource.getSnapshot());
    reactiveSource.subscribe(() => {
      atom.set(reactiveSource.getSnapshot());
    });
    return atom;
  },
};

// Vue reactive bridge
const VueReactiveBridge = {
  fromAtom: (atom) => {
    const vueRef = shallowRef(atom());
    atom.subscribe((value) => { vueRef.value = value; });
    return vueRef;
  },

  fromWritableAtom: (atom) => {
    const vueRef = ref(atom());
    // Atom → Vue
    atom.subscribe((value) => { vueRef.value = value; });
    // Vue → Atom
    watch(vueRef, (newVal) => atom.set(newVal));
    return vueRef;
  },

  toAtom: (vueRef) => {
    const atom = Atom.make(vueRef.value);
    watch(vueRef, (newVal) => atom.set(newVal));
    return atom;
  },
};
```

**4. An interop layer — using host framework components inside our tree and vice versa.**

This is critical for incremental adoption. You need to use existing React/Vue/Svelte components inside an effect-atom-jsx tree, and use effect-atom-jsx components inside existing React/Vue/Svelte apps:

```ts
class InteropBridge extends Effect.Tag("InteropBridge")<InteropBridge, {
  // Wrap a host framework component for use in our tree
  readonly fromHost: <P>(hostComponent: HostComponent<P>) => Component<P, never, never>;

  // Wrap our component for use in a host framework tree
  readonly toHost: <P, R, E>(
    component: Component<P, R, E>,
    layer: Layer<R>,
  ) => HostComponent<P>;
}>() {}

// React interop
const ReactInterop = {
  // Use a React component in our tree
  fromHost: (ReactComp) => {
    return Component.make(
      Component.props<any>(),
      Component.require(),
      (props) => Effect.succeed({}),
      (props) => {
        // Render the React component directly
        // The IR adapter knows to pass this through as a React element
        return ViewIR.hostComponent(ReactComp, props);
      },
    );
  },

  // Use our component in a React tree
  toHost: (component, layer) => {
    return function EffectComponentWrapper(props: any) {
      const scopeRef = React.useRef<Scope>(null);
      const [bindings, setBindings] = React.useState(null);

      React.useEffect(() => {
        const scope = Effect.runSync(Scope.make());
        scopeRef.current = scope;

        const result = Effect.runSync(
          component.setup(props).pipe(
            Effect.provideService(Scope, scope),
            Effect.provide(layer),
          )
        );
        setBindings(result);

        return () => {
          Effect.runSync(Scope.close(scope, Exit.void));
        };
      }, []);

      if (!bindings) return null;

      // Render our view through the React adapter
      return renderViewIRToReact(component.view(props, bindings));
    };
  },
};
```

Usage in React:

```tsx
// Existing React app
import { toReact } from "effect-atom-jsx/react";
import { UserList } from "./effect-components";

// Convert our component to a React component
const UserListReact = toReact(UserList, AppLayer);

// Use in a React tree
function App() {
  return (
    <div>
      <h1>My React App</h1>
      <UserListReact />  {/* Our component, running as React */}
    </div>
  );
}
```

Usage in Vue:

```vue
<!-- Existing Vue app -->
<script setup>
import { toVue } from "effect-atom-jsx/vue";
import { UserList } from "./effect-components";

const UserListVue = toVue(UserList, AppLayer);
</script>

<template>
  <div>
    <h1>My Vue App</h1>
    <UserListVue />  <!-- Our component, running as Vue -->
  </div>
</template>
```

**5. An element mapping service.**

Universal elements (`Box`, `Text`, `Button`) need to map to host-framework-specific elements. On React, `Box` might be a `div`. On React Native, it's a `View`. On Vue, it's a `div`. On a design system, it might be a custom component.

```ts
class ElementMapping extends Effect.Tag("ElementMapping")<ElementMapping, {
  readonly map: (universalTag: string) => string | HostComponent<any>;
}>() {}

// React web mapping
const ReactWebElements = Layer.succeed(ElementMapping, {
  map: (tag) => {
    switch (tag) {
      case "Box": return "div";
      case "Text": return "span";
      case "Input": return "input";
      case "Button": return "button";
      case "Image": return "img";
      case "List": return "ul";
      case "ListItem": return "li";
      case "ScrollView": return "div"; // with overflow: auto
      default: return tag;  // pass through HTML tags
    }
  },
});

// React Native mapping
const ReactNativeElements = Layer.succeed(ElementMapping, {
  map: (tag) => {
    switch (tag) {
      case "Box": return RN.View;
      case "Text": return RN.Text;
      case "Input": return RN.TextInput;
      case "Button": return RN.Pressable;
      case "Image": return RN.Image;
      case "List": return RN.FlatList;
      case "ScrollView": return RN.ScrollView;
      default: return RN.View;
    }
  },
});

// Vue Vuetify mapping
const VuetifyElements = Layer.succeed(ElementMapping, {
  map: (tag) => {
    switch (tag) {
      case "Box": return "v-container";
      case "Text": return "v-text";
      case "Input": return "v-text-field";
      case "Button": return "v-btn";
      case "Image": return "v-img";
      case "List": return "v-list";
      case "ListItem": return "v-list-item";
      default: return tag;
    }
  },
});
```

**The full host framework platform layer:**

Each framework platform bundles all these bridges:

```ts
// React platform
const ReactPlatform = Layer.mergeAll(
  ReactHost,            // ComponentHost — how to create/mount components
  ReactLifecycle,       // LifecycleBridge — connect scope to useEffect cleanup
  ReactContextBridge,   // ContextBridge — services via React.createContext
  ReactReactiveBridge,  // ReactiveBridge — atoms via useSyncExternalStore
  ReactInterop,         // InteropBridge — React ↔ our components
  ReactWebElements,     // ElementMapping — universal → HTML tags
  WebEventSystem,       // EventMapper — DOM events
);

// Vue platform
const VuePlatform = Layer.mergeAll(
  VueHost,
  VueLifecycle,
  VueContextBridge,
  VueReactiveBridge,
  VueInterop,
  VueWebElements,
  WebEventSystem,
);

// Svelte platform
const SveltePlatform = Layer.mergeAll(
  SvelteHost,
  SvelteLifecycle,
  SvelteContextBridge,
  SvelteReactiveBridge,
  SvelteInterop,
  SvelteWebElements,
  WebEventSystem,
);

// React Native platform
const ReactNativePlatform = Layer.mergeAll(
  ReactHost,
  ReactLifecycle,
  ReactContextBridge,
  ReactReactiveBridge,
  ReactInterop,
  ReactNativeElements,    // different element mapping
  MobileEventSystem,      // different event system
);
```

**Mounting on any framework:**

```ts
// Standalone — our own renderer
Component.mount(App, {
  layer: Layer.mergeAll(AppLive, DomPlatform),
  target: document.getElementById("root")!,
});

// Inside React — our components as React components
import { createReactBridge } from "effect-atom-jsx/react";
const bridge = createReactBridge(AppLive);

function ReactApp() {
  return (
    <bridge.Provider>
      <bridge.Component component={App} />
    </bridge.Provider>
  );
}

ReactDOM.createRoot(root).render(<ReactApp />);

// Inside Vue — our components as Vue components
import { createVueBridge } from "effect-atom-jsx/vue";
const bridge = createVueBridge(AppLive);

const app = createApp({
  setup() {
    return () => h(bridge.Component, { component: App });
  },
});
app.use(bridge.plugin);
app.mount("#root");

// Inside Svelte — our components as Svelte components
import { createSvelteBridge } from "effect-atom-jsx/svelte";
const bridge = createSvelteBridge(AppLive);
// Use bridge.Component in Svelte templates
```

**What about sharing components across frameworks?**

This is the ultimate payoff. A headless component library written with effect-atom-jsx works on every framework:

```ts
// Published as: @myorg/headless-ui
// Written with universal elements and Effect setup
export const Combobox = Component.headless(/* ... */);
export const DataTable = Component.headless(/* ... */);
export const Dialog = Component.headless(/* ... */);
```

Consumer in React:

```tsx
import { Combobox } from "@myorg/headless-ui";
import { toReact } from "effect-atom-jsx/react";

const ReactCombobox = toReact(Combobox, AppLayer);

function MyApp() {
  return (
    <ReactCombobox items={items} onSelect={handleSelect}>
      {(bindings) => (
        // React JSX for rendering
        <div className="combobox">
          <input ref={bindings.inputRef} value={bindings.query()} />
          {/* ... */}
        </div>
      )}
    </ReactCombobox>
  );
}
```

Consumer in Vue:

```vue
<script setup>
import { Combobox } from "@myorg/headless-ui";
import { toVue } from "effect-atom-jsx/vue";

const VueCombobox = toVue(Combobox, AppLayer);
</script>

<template>
  <VueCombobox :items="items" @select="handleSelect" v-slot="bindings">
    <div class="combobox">
      <input :ref="bindings.inputRef" :value="bindings.query()" />
    </div>
  </VueCombobox>
</template>
```

Consumer in Svelte:

```svelte
<script>
import { Combobox } from "@myorg/headless-ui";
import { toSvelte } from "effect-atom-jsx/svelte";

const SvelteCombobox = toSvelte(Combobox, AppLayer);
</script>

<SvelteCombobox items={items} onSelect={handleSelect} let:bindings>
  <div class="combobox">
    <input bind:this={bindings.inputRef} value={bindings.query()} />
  </div>
</SvelteCombobox>
```

Same headless component. Same typed bindings. Same behavior. Different rendering framework. The setup (all the state, queries, actions, accessibility, keyboard handling) is shared. Only the template is framework-specific.

**What's still missing?**

**SSR interop.** Each framework has its own SSR story. React has `renderToString`/`renderToPipeableStream`. Vue has `renderToString`. Svelte has server-side compilation. The SSR bridge needs to produce framework-native SSR output:

```ts
class SSRBridge extends Effect.Tag("SSRBridge")<SSRBridge, {
  readonly renderToString: (node: HostNode) => Effect.Effect<string>;
  readonly renderToStream: (node: HostNode) => Stream.Stream<string>;
}>() {}
```

**HMR interop.** Each framework has its own hot module replacement mechanism. The HMR bridge needs to preserve our scopes and atom state across hot reloads while letting the framework do its own component replacement.

**DevTools interop.** React DevTools, Vue DevTools, Svelte DevTools — each has its own protocol. A DevTools bridge would expose our component tree, atom state, and scope information through the host framework's DevTools protocol.

**The final architecture:**

```
effect-atom-jsx (core)
├── Component<Props, Req, E>     — universal component model
├── Atom / Query / Action        — universal state/async
├── Effect services / layers     — universal DI
├── Scope lifecycle              — universal cleanup
├── View IR                      — universal template representation
└── Typed elements / events      — platform-parameterized

effect-atom-jsx/dom              — standalone DOM renderer (no framework)
effect-atom-jsx/tui              — standalone TUI renderer
effect-atom-jsx/mobile           — standalone mobile renderer

effect-atom-jsx/react            — React as host framework
├── ReactHost                    — component instantiation via React
├── ReactReactiveBridge          — atoms via useSyncExternalStore
├── ReactLifecycleBridge         — scopes via useEffect
├── ReactContextBridge           — services via React.createContext
├── ReactInterop                 — toReact() / fromReact()
└── ReactSSR                     — renderToString/stream

effect-atom-jsx/vue              — Vue as host framework
├── VueHost                      — component instantiation via defineComponent
├── VueReactiveBridge            — atoms via Vue refs
├── VueLifecycleBridge           — scopes via onUnmounted
├── VueContextBridge             — services via provide/inject
├── VueInterop                   — toVue() / fromVue()
└── VueSSR                       — renderToString

effect-atom-jsx/svelte           — Svelte as host framework
├── SvelteHost
├── SvelteReactiveBridge
├── SvelteLifecycleBridge
├── SvelteContextBridge
├── SvelteInterop
└── SvelteSSR

effect-atom-jsx/angular          — Angular as host framework
├── AngularHost
├── AngularReactiveBridge         — atoms via Angular signals
├── AngularLifecycleBridge
├── AngularContextBridge          — services via Angular DI
├── AngularInterop
└── AngularSSR
```

Every integration is a set of services provided as layers. The core is framework-agnostic. Setup is always an Effect. State is always atoms. Services are always layers. Lifecycle is always scopes. The framework-specific part is just the bridge layer that connects these universal primitives to the host framework's rendering, reactivity, lifecycle, and context systems.

The answer to your original question: yes, the primitives are sufficient. What was missing was the bridge services — `ComponentHost`, `LifecycleBridge`, `ReactiveBridge`, `ContextBridge`, `InteropBridge`, `ElementMapping`, and `SSRBridge`. Each of these is a service, each is provided as a layer, each is swappable. The core abstractions didn't need to change. They just needed these connection points to plug into host frameworks.Yes. This is the right move. `Reactivity` from `@effect/experimental` is already an Effect service with key-based invalidation. Instead of building our own subscription system, our own atom notification system, and then bridging that to each framework's reactivity — we make `Reactivity` the single source of truth for "something changed, consumers need to update." Every framework bridge just subscribes to `Reactivity` invalidations and does whatever its framework needs to re-render.

**The insight:**

Right now we have multiple reactive notification paths:

- Atoms have `.subscribe()` for direct listeners
- `Atom.withReactivity(keys)` hooks into the `Reactivity` service
- `reactivityKeys` on actions/mutations triggers invalidation
- Each framework bridge needs its own subscription mechanism

Collapse all of these into `Reactivity`. Every atom gets reactivity keys. Every atom read registers interest in those keys. Every atom write invalidates those keys. `Reactivity` is the universal event bus for "data changed." Framework bridges subscribe to `Reactivity` invalidations and trigger their framework's re-render mechanism.

**Atom backed by Reactivity:**

```ts
// Every atom gets a reactivity key — derived from identity or explicit
const count = Atom.make(0);
// Internally: count has reactivity key "atom:<unique-id>"

// Derived atoms track their source keys
const doubled = Atom.make((get) => get(count) * 2);
// Internally: doubled depends on count's key

// When count is written, Reactivity.invalidate(["atom:<count-id>"]) fires
// doubled sees the invalidation because it depends on count's key
// Any framework subscriber watching doubled's key gets notified
```

But you don't have to think about this. The atom API stays the same. Under the hood, every `atom.set(...)` calls `Reactivity.invalidate` with the atom's keys. Every `atom()` read registers interest in the atom's keys via the current `Reactivity` subscription context.

**Explicit reactivity keys are the power feature:**

The `@effect/experimental` `Reactivity` pattern shines because keys are semantic, not identity-based. You don't invalidate "this specific atom" — you invalidate a concept like "users" or "user:alice". Multiple atoms can watch the same key. One mutation can invalidate a key that refreshes ten different atoms across ten different components.

```ts
const userList = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  }),
).pipe(Atom.withReactivity(["users"]));

const userCount = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.countUsers();
  }),
).pipe(Atom.withReactivity(["users"]));

const activeUsers = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listActiveUsers();
  }),
).pipe(Atom.withReactivity(["users"]));

// One mutation invalidates all three
const addUser = apiRuntime.action(
  Effect.fn(function* (name: string) {
    const api = yield* Api;
    yield* api.addUser(name);
  }),
  { reactivityKeys: ["users"] },
);
```

When `addUser` runs, `Reactivity.invalidate(["users"])` fires. All three atoms refresh. No manual wiring. No "which queries does this mutation invalidate" lists. Just semantic keys.

**Reactivity as the universal bridge layer:**

Instead of each framework bridge implementing its own atom subscription:

```ts
// OLD: each bridge implements atom subscription differently
// React: useSyncExternalStore(atom.subscribe, atom.read)
// Vue: watch(() => atom(), (v) => vueRef.value = v)
// Svelte: atom.subscribe((v) => svelteState = v)
```

Each framework bridge subscribes to `Reactivity` invalidation events and batch-triggers its own update mechanism:

```ts
class FrameworkReactivityBridge extends Effect.Tag("FrameworkReactivityBridge")
  FrameworkReactivityBridge,
  {
    // Connect Reactivity invalidations to the host framework's update cycle
    readonly connect: (
      keys: readonly string[],
      onInvalidate: () => void,
    ) => Effect.Effect<void, never, Scope>;
  }
>() {}
```

**React bridge via Reactivity:**

```ts
const ReactReactivityBridge = Layer.succeed(FrameworkReactivityBridge, {
  connect: (keys, onInvalidate) =>
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;

      // Subscribe to invalidation events for these keys
      yield* reactivity.subscribe(keys, () => {
        // When any watched key is invalidated,
        // trigger React's re-render mechanism
        // This works with useSyncExternalStore or setState
        onInvalidate();
      });

      // Subscription is scoped — cleaned up when component unmounts
    }),
});

// In a React component wrapper:
function useReactivityAtom<A>(atom: ReadonlyAtom<A>): A {
  const bridge = useFrameworkBridge();
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  React.useEffect(() => {
    const cleanup = Effect.runSync(
      bridge.connect(atom.reactivityKeys, () => forceUpdate()).pipe(
        Effect.scoped,
      )
    );
    return cleanup;
  }, [atom]);

  return atom();
}
```

**Vue bridge via Reactivity:**

```ts
const VueReactivityBridge = Layer.succeed(FrameworkReactivityBridge, {
  connect: (keys, onInvalidate) =>
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;

      yield* reactivity.subscribe(keys, () => {
        // Trigger Vue's reactivity system
        // Vue will re-render any component reading the affected refs
        onInvalidate();
      });
    }),
});

// In a Vue composable:
function useReactivityAtom<A>(atom: ReadonlyAtom<A>): Ref<A> {
  const vueRef = shallowRef(atom());
  const bridge = inject("reactivity-bridge");

  onMounted(() => {
    Effect.runSync(
      bridge.connect(atom.reactivityKeys, () => {
        vueRef.value = atom();
      }).pipe(Effect.scoped)
    );
  });

  return vueRef;
}
```

**Svelte bridge via Reactivity:**

```ts
const SvelteReactivityBridge = Layer.succeed(FrameworkReactivityBridge, {
  connect: (keys, onInvalidate) =>
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;

      yield* reactivity.subscribe(keys, () => {
        onInvalidate();
      });
    }),
});

// In Svelte 5 with runes:
function useReactivityAtom<A>(atom: ReadonlyAtom<A>) {
  let value = $state(atom());
  const bridge = getContext("reactivity-bridge");

  $effect(() => {
    return Effect.runSync(
      bridge.connect(atom.reactivityKeys, () => {
        value = atom();
      }).pipe(Effect.scoped)
    );
  });

  return { get value() { return value; } };
}
```

**The deeper point: Reactivity replaces our internal atom subscription system entirely.**

Instead of atoms having their own `.subscribe()` mechanism with their own notification graph, atoms are thin wrappers around `Ref` (for storage) + `Reactivity` (for change notification):

```ts
// Atom internal implementation backed by Reactivity
function makeAtom<A>(initial: A, options?: { key?: string }): WritableAtom<A> {
  const key = options?.key ?? `atom:${generateId()}`;
  const ref = Effect.runSync(Ref.make(initial));

  const atom = Object.assign(
    // Read — just read the ref
    () => Effect.runSync(Ref.get(ref)),
    {
      // Write — update ref, then invalidate via Reactivity
      set: (value: A) => {
        Effect.runSync(Ref.set(ref, value));
        Effect.runSync(
          Effect.gen(function* () {
            const reactivity = yield* Reactivity;
            yield* reactivity.invalidate([key]);
          }).pipe(
            // If no Reactivity service is available (standalone usage),
            // fall back to direct notification
            Effect.catchAll(() => Effect.void),
          )
        );
      },

      update: (fn: (a: A) => A) => {
        Effect.runSync(Ref.update(ref, fn));
        Effect.runSync(
          Reactivity.invalidate([key]).pipe(
            Effect.catchAll(() => Effect.void),
          )
        );
      },

      // Reactivity metadata
      reactivityKeys: [key],
    },
  );

  return atom;
}
```

Derived atoms subscribe to their sources' reactivity keys:

```ts
function makeDerived<A>(fn: (get: AtomGetter) => A): ReadonlyAtom<A> {
  const key = `derived:${generateId()}`;
  const trackedKeys: string[] = [];

  // The getter tracks which keys are read
  const get: AtomGetter = (source) => {
    trackedKeys.push(...source.reactivityKeys);
    return source();
  };

  const compute = () => fn(get);
  let cached = compute();

  const atom = Object.assign(
    () => cached,
    {
      reactivityKeys: [key, ...trackedKeys],
      recompute: () => {
        cached = compute();
        // Derived atom invalidates its own key when it recomputes
        // so downstream derived atoms and framework bridges get notified
      },
    },
  );

  // Subscribe to source keys via Reactivity
  // When sources change, recompute and invalidate own key
  Effect.runSync(
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;
      yield* reactivity.subscribe(trackedKeys, () => {
        atom.recompute();
        yield* reactivity.invalidate([key]);
      });
    }).pipe(
      Effect.catchAll(() => Effect.void),
    )
  );

  return atom;
}
```

**Async atoms (queries) are just atoms with Reactivity-triggered refresh:**

```ts
function makeQueryAtom<A, E>(
  effect: () => Effect.Effect<A, E>,
  options?: { reactivityKeys?: string[] },
): ReadonlyAtom<Result<A, E>> {
  const key = `query:${generateId()}`;
  const resultRef = Effect.runSync(Ref.make<Result<A, E>>(Result.loading()));

  // Run the effect, store result
  const execute = Effect.gen(function* () {
    yield* Ref.set(resultRef, Result.loading());
    const exit = yield* Effect.exit(effect());
    const result = Exit.match(exit, {
      onSuccess: (a) => Result.success(a),
      onFailure: (cause) => Result.failure(cause),
    });
    yield* Ref.set(resultRef, result);
    // Invalidate our own key so subscribers know the result changed
    yield* Reactivity.invalidate([key]);
  });

  // Subscribe to reactivity keys — when they're invalidated, re-execute
  if (options?.reactivityKeys) {
    Effect.runSync(
      Effect.gen(function* () {
        const reactivity = yield* Reactivity;
        yield* reactivity.subscribe(options.reactivityKeys!, () => {
          // Re-run the query
          Effect.runFork(execute);
        });
      })
    );
  }

  return Object.assign(
    () => Effect.runSync(Ref.get(resultRef)),
    {
      reactivityKeys: [key, ...(options?.reactivityKeys ?? [])],
    },
  );
}
```

**Actions invalidate via Reactivity — which is already how effect-atom works:**

```ts
const addUser = apiRuntime.action(
  Effect.fn(function* (name: string) {
    const api = yield* Api;
    yield* api.addUser(name);
    // This invalidation is the ONLY mechanism needed
    // No "refresh(userList)" — Reactivity handles the fan-out
  }),
  { reactivityKeys: ["users"] },
);

// Or manually inside the Effect
const addUserManual = apiRuntime.action(
  Effect.fn(function* (name: string) {
    const api = yield* Api;
    yield* api.addUser(name);
    yield* Reactivity.invalidate(["users"]);
  }),
);
```

When `Reactivity.invalidate(["users"])` fires:
- `userList` atom refreshes (it subscribed via `Atom.withReactivity(["users"])`)
- `userCount` atom refreshes (same key)
- `activeUsers` atom refreshes (same key)
- React components reading any of these atoms re-render (React bridge subscribed to those keys)
- Vue components reading any of these atoms update (Vue bridge subscribed)
- Svelte components update
- Any framework, any number of consumers

One invalidation call. `Reactivity` fans it out to every subscriber. No framework-specific notification code needed.

**Hierarchical keys for fine-grained invalidation:**

The `@effect/experimental` `Reactivity` already supports structured keys:

```ts
const userProfile = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.findUser(userId);
  }),
).pipe(
  // Refreshes on "users" (all users changed) or "user:alice" (this user changed)
  Atom.withReactivity({ users: [userId] }),
);

// Invalidate all user-related atoms
yield* Reactivity.invalidate(["users"]);

// Invalidate only alice's profile
yield* Reactivity.invalidate({ users: ["alice"] });
```

This is exactly what `@effect-atom/atom` already does. The structure `{ users: ["alice"] }` means "invalidate the 'users' key with sub-key 'alice'". Atoms subscribed to `{ users: [userId] }` where `userId === "alice"` get refreshed. Atoms subscribed to just `["users"]` (all users) also get refreshed.

This granularity means a mutation that updates one user doesn't refresh the entire user list — only atoms watching that specific user's sub-key. But a mutation that creates a new user invalidates `["users"]` which refreshes everything.

**Framework bridge becomes extremely simple:**

Since `Reactivity` handles all the notification routing, each framework bridge is just "subscribe to keys, call framework update":

```ts
// The ENTIRE React bridge for reactivity
function useAtom<A>(atom: ReadonlyAtom<A>): A {
  return React.useSyncExternalStore(
    (onStoreChange) => {
      // Subscribe to this atom's reactivity keys
      const unsubscribe = Effect.runSync(
        Effect.gen(function* () {
          const reactivity = yield* Reactivity;
          return yield* reactivity.subscribe(
            atom.reactivityKeys,
            onStoreChange,
          );
        }).pipe(Effect.scoped)
      );
      return unsubscribe;
    },
    // Read current value
    () => atom(),
  );
}
```

That's the entire React reactivity bridge. One hook. `useSyncExternalStore` + `Reactivity.subscribe`. Everything else — invalidation routing, dependency tracking, cache management, stale-while-revalidate — is handled by `Reactivity` and the atom layer.

Vue:

```ts
function useAtom<A>(atom: ReadonlyAtom<A>): Ref<A> {
  const value = shallowRef(atom());

  onMounted(() => {
    Effect.runSync(
      Effect.gen(function* () {
        const reactivity = yield* Reactivity;
        yield* reactivity.subscribe(atom.reactivityKeys, () => {
          value.value = atom();
        });
      }).pipe(Effect.scoped)
    );
  });

  return readonly(value);
}
```

Svelte:

```ts
function useAtom<A>(atom: ReadonlyAtom<A>) {
  let value = $state(atom());

  $effect(() => {
    return Effect.runSync(
      Effect.gen(function* () {
        const reactivity = yield* Reactivity;
        yield* reactivity.subscribe(atom.reactivityKeys, () => {
          value = atom();
        });
      }).pipe(Effect.scoped)
    );
  });

  return { get value() { return value; } };
}
```

Angular:

```ts
function useAtom<A>(atom: ReadonlyAtom<A>): Signal<A> {
  const sig = signal(atom());

  Effect.runSync(
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;
      yield* reactivity.subscribe(atom.reactivityKeys, () => {
        sig.set(atom());
      });
    }).pipe(Effect.scoped)
  );

  return sig.asReadonly();
}
```

Every bridge is the same pattern: subscribe to reactivity keys, update framework-native reactive primitive. Five lines of framework-specific code.

**Our own dom-expressions renderer also uses Reactivity:**

For the standalone renderer (no host framework), the dom-expressions reactive system subscribes to `Reactivity` the same way:

```ts
// dom-expressions integration
function createReactiveExpression<A>(fn: () => A): () => A {
  let cached = fn();
  const trackedKeys = trackReactivityKeys(fn);

  Effect.runSync(
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;
      yield* reactivity.subscribe(trackedKeys, () => {
        const next = fn();
        if (next !== cached) {
          cached = next;
          // Update the specific DOM node
          updateDOMBinding(cached);
        }
      });
    }).pipe(Effect.scoped)
  );

  return () => cached;
}
```

This means dom-expressions' internal `createSignal`/`createEffect`/`createMemo` can be backed by `Reactivity` instead of their own notification system. The reactive core becomes a thin wrapper over Effect's `Reactivity` service.

**Batching through Reactivity:**

Multiple atom writes in the same synchronous block should produce one invalidation, not N:

```ts
count.set(5);
name.set("hello");
flag.set(true);
// Should produce ONE batch of invalidations, not three separate ones
```

`Reactivity` can batch invalidations. The service collects invalidated keys during a synchronous block and flushes them as a batch on the next microtask (matching our existing microtask batching model):

```ts
// Internally, Reactivity batches invalidations
Reactivity.invalidate(["count-key"]);   // queued
Reactivity.invalidate(["name-key"]);    // queued
Reactivity.invalidate(["flag-key"]);    // queued
// Microtask fires → all subscribers notified once with the full set of invalidated keys
```

Framework bridges receive the batched notification and trigger one re-render, not three.

**`Reactivity` as a layer — provided or not:**

The beauty of making `Reactivity` a service: it's optional. In tests, you can provide a test `Reactivity` that gives you manual control:

```ts
const test = Effect.gen(function* () {
  const reactivity = yield* Reactivity;

  // Create atoms and queries
  const count = Atom.make(0);
  const doubled = Atom.make((get) => get(count) * 2);

  // Write
  count.set(5);

  // Manually flush reactivity (in tests, don't wait for microtask)
  yield* reactivity.flush();

  // Now doubled has recomputed
  assert.equal(doubled(), 10);

  // Inspect what was invalidated
  const invalidated = yield* reactivity.lastInvalidated();
  assert.deepEqual(invalidated, ["atom:<count-id>", "derived:<doubled-id>"]);
}).pipe(
  Effect.provide(Reactivity.test), // test implementation with manual flush
);
```

In production, provide the standard `Reactivity` layer:

```ts
Component.mount(App, {
  layer: Layer.mergeAll(
    AppLive,
    Reactivity.live, // standard implementation with microtask batching
    WebPlatformLive,
  ),
  target: root,
});
```

In standalone scripts without any framework, atoms still work — they just won't have `Reactivity` and writes are synchronous. The `Effect.catchAll(() => Effect.void)` fallback in the atom implementation means atoms gracefully degrade when no `Reactivity` service is present.

**Cross-component communication via Reactivity keys:**

`Reactivity` is already a pub/sub system. You don't need a separate `PubSub` for most cross-component communication:

```ts
// Toast notifications via reactivity keys
const toasts = Atom.make<Toast[]>([]).pipe(
  Atom.withReactivity(["toasts"]),
);

// Any component can trigger a toast by invalidating the key
// after updating the atom
function showToast(toast: Toast) {
  toasts.update((prev) => [...prev, toast]);
  // The atom write already invalidates ["toasts"] via Reactivity
  // All subscribers (the toast display component) re-render
}

// Or from an Effect
const saveAction = apiRuntime.action(
  Effect.fn(function* () {
    yield* api.save();
    toasts.update((prev) => [...prev, { message: "Saved!", type: "success" }]);
    // No need for separate PubSub — Reactivity keys handle the notification
  }),
);
```

For cases where you genuinely need event-style communication (not state-based), `Effect.PubSub` is still there. But for most UI reactive communication patterns, `Reactivity` keys are sufficient and simpler.

**The `Reactivity` service replaces:**

Our internal atom `.subscribe()` mechanism — atoms subscribe to reactivity keys instead.

Our internal dependency tracking graph — derived atoms subscribe to source keys via `Reactivity`.

Our internal batch notification system — `Reactivity` batches invalidations.

The `refresh()` function — becomes `Reactivity.invalidate(keys)`.

The `invalidates` option on mutations — becomes `reactivityKeys` (already exists in effect-atom).

The `FrameworkReactivityBridge` service — each framework bridge just subscribes to `Reactivity`.

Cross-component events for most cases — invalidation keys are the pub/sub mechanism.

**What the dependency graph looks like:**

```
Reactivity (from @effect/experimental)
  │
  ├── Atom.make(value)
  │     writes → Reactivity.invalidate([atomKey])
  │
  ├── Atom.make((get) => derived)
  │     subscribes → Reactivity.subscribe(sourceKeys)
  │     recompute → Reactivity.invalidate([derivedKey])
  │
  ├── apiRuntime.atom(effect)
  │     subscribes → Reactivity.subscribe(reactivityKeys)
  │     result change → Reactivity.invalidate([queryKey])
  │
  ├── apiRuntime.action(effect, { reactivityKeys })
  │     on success → Reactivity.invalidate(reactivityKeys)
  │
  ├── React bridge
  │     useSyncExternalStore → Reactivity.subscribe(atomKeys)
  │
  ├── Vue bridge
  │     watch → Reactivity.subscribe(atomKeys)
  │
  ├── Svelte bridge
  │     $effect → Reactivity.subscribe(atomKeys)
  │
  ├── Angular bridge
  │     signal → Reactivity.subscribe(atomKeys)
  │
  └── dom-expressions bridge
        createEffect → Reactivity.subscribe(atomKeys)
```

One service. One notification mechanism. Every atom, every query, every mutation, every framework bridge, every derived computation — all routing through `Reactivity`. The service is Effect-native, scoped, testable, and already exists in the ecosystem.

**The final layer stack for any app:**

```ts
// Core (always present)
const CoreLayer = Layer.mergeAll(
  Reactivity.live,      // THE reactivity engine — from @effect/experimental
  AppServicesLive,      // your business logic services
);

// Standalone (our own renderer)
Component.mount(App, {
  layer: Layer.mergeAll(CoreLayer, DomPlatformLive),
  target: root,
});

// React host
const reactBridge = createReactBridge(CoreLayer);
ReactDOM.createRoot(root).render(<reactBridge.Root component={App} />);

// Vue host
const vueBridge = createVueBridge(CoreLayer);
createApp(vueBridge.root(App)).mount("#root");

// TUI
Component.mount(App, {
  layer: Layer.mergeAll(CoreLayer, TuiPlatformLive),
  target: process.stdout,
});

// Test (no framework, no rendering)
Effect.gen(function* () {
  const bindings = yield* Component.setupEffect(App, {});
  // test bindings directly
}).pipe(
  Effect.provide(Layer.mergeAll(CoreLayer, Reactivity.test)),
);
```

`Reactivity` from `@effect/experimental` is the single piece that makes the entire multi-framework story work. It's the universal reactive glue. Everything subscribes to it, everything invalidates through it, and every framework bridge is just five lines of "subscribe to keys, update my framework's reactive primitive."