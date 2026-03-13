# Design/Styling/Behavior System in AF-UI

## The Main Value Add: Why AF-UI?

If you are frustrated by maintaining forks of `shadcn/ui`, debugging typos in massive `Tailwind` strings, or paying the runtime performance cost of `CSS-in-JS`, AF-UI offers a fundamentally different approach. 

AF-UI is built on an **"Inside-Out" Component Model** powered by Effect-TS. Instead of hardcoding behavior and styles into a single file, AF-UI separates UI into purely structural **Views**, and allows you to attach **Behaviors** and **Styles** from the outside, with 100% compile-time type safety.

This solves three major ecosystem pain points:
1. **The Tailwind Problem:** Styles in AF-UI are composable data structures backed by a typed Token service. Invalid CSS or invalid theme tokens fail at compile-time. No more typos or runtime layout bugs.
2. **The shadcn/ui Problem:** You no longer need to copy/paste and fork underlying components just to change a border radius or add an aria-attribute. You simply override the component's published `Style Handles` via context, completely avoiding fork rot.
3. **The Platform Lock-in Problem:** Because Styles and Behaviors are data, they are completely decoupled from the Web DOM. The exact same Component can be compiled to Web (CSS/HTML), Terminal (TUI), or React Native just by swapping the Platform Layer.

## Architecture: From Tag to Platform

AF-UI is designed with a clear hierarchy that maintains type safety from the lowest-level element up to the platform rendering boundary:

```text
Tags ➔ Views ➔ Components ➔ Renderer ➔ Platform
```

1. **Tags (Elements):** The fundamental building blocks (e.g., `<Box>`, `<Button>`). These are not hardcoded HTML; they are defined by the active platform. Every attribute and event (`onClick`) is strictly typed for that environment (e.g., `MouseEvent` vs `KeyEvent`).
2. **Views:** Structural skeletons composed of tags. Views don't perform logic; they define the named **Slots** (e.g., `root`, `label`) and specify exactly what element types those slots expect.
3. **Components:** The logical units. A component declares its requirements (`Req`, `E`), isolates its reactive state (**Bindings**) from its structure (**Slots**), and returns a **View<Slots>**. This is the boundary where external Behaviors and Styles attach to the View's slots.
4. **Renderer:** A service (`WebRenderer`, `TuiRenderer`) responsible for translating the abstract tree of styled/behavioral nodes into concrete host nodes.
5. **Platform:** The overarching layer (`WebPlatformLive`, `TuiPlatformLive`) that bundles the Renderer, the Event System, and the specific Element Vocabulary (the Tags) together into a single, cohesive environment.

## The Inside-Out Design Philosophy

```text
Traditional Model:
[Component] 
  ├── Hardcoded Tailwind Strings
  ├── Hardcoded Interaction Hooks
  └── Structure (JSX)

AF-UI Inside-Out Model:
[Component Declaration] 
          ↓
[View: Typed Element Slots] 
       ↙     ↘
[Behavior]  [Style]
       ↘     ↙
 [Final Rendered UI]
```

In this model:
1. **Views expose named element slots** - structural skeletons with defined attachment points.
2. **Behaviors attach interaction** to those slots (event handlers, ARIA, state).
3. **Styles attach appearance** to those slots (colors, spacing, layout, typography).
4. **Both compose from outside** the view through piped transformations.
5. **Everything is type-safe** - invalid attachments are compile-time errors.

## The Effect Influence

AF-UI's design is fundamentally influenced by **Effect-TS**, inheriting its core patterns and guarantees:

1. **Services as Context:** Like Effect uses the environment (`R`) for dependency injection, AF-UI components declare services in their `Req` type parameter. Providing a Theme or a Router is identical to `Effect.provide(layer)`.
2. **Pipeable Composition:** AF-UI components, behaviors, and styles are transformed and composed using `.pipe()`, matching Effect's standard composition model.
3. **Requirement Bubbling:** AF-UI uses Effect Generators (`View.gen`) to render. When a component renders a child that requires a service (like `Auth`), that requirement automatically bubbles up through the `yield*` chain into the parent's `Req` type.
4. **Data as Values:** Styles and behaviors are plain data structures that are interpreted at runtime, not side-effecting function calls. This makes them easily testable as pure data.

## Quick Start: The Anatomy of a Component

Here is a complete example demonstrating the inside-out workflow:

```tsx
import { Component, Style, Behavior, view, Element, Effect } from "af-ui";

// 1. Define the Component (Setup Logic & Structural View)
const BaseButton = Component.make(
  Component.props<{ children: ViewNode }>(),
  Component.require()
)(
  // Setup: computes logical state (Bindings)
  () => Effect.succeed({}), 
  
  // View: Defines structure and abstract element slots
  (props) => view({
    root: Element.Interactive,
    label: Element.Text
  }, () => (
    <button slot="root">
      <span slot="label">{props.children}</span>
    </button>
  ))
);

// 2. Define the Style (Appearance)
const buttonStyle = Style.make({
  // Use typed tokens for colors, spacing, etc.
  root: { padding: ["sm", "md"], borderRadius: "md", backgroundColor: "primary" },
  label: { color: "inverse", fontWeight: "bold" }
});

// 3. Define the Behavior (Interaction)
// Behaviors are "Active Consumers" - they receive typed slots and attach logic.
const buttonBehavior = Behavior.make({
  root: Element.Interactive
})(({ root }) => Effect.gen(function*() {
  yield* root.onPress(() => console.log("Clicked!"))
}));

// 4. Compose Externally
export const Button = BaseButton.pipe(
  Style.attach(buttonStyle),
  Behavior.attach(buttonBehavior)
);
```

## How Components Enable This System

Components in AF-UI separate logical state (`Bindings`) from structural representation (`Slots`) by returning a `View<Slots>`.

```ts
interface Component<Props, Req, E, Bindings = unknown, Slots = {}> {
  // Returns a Typed View (wrapping JSX and structural slots)
  (props: Props): View<Slots>;
  
  pipe: PipeableComponent<Props, Req, E, Bindings, Slots>;
  
  readonly [ComponentTypeId]: {
    readonly Props: Props;
    readonly Req: Req;           // Services/context needed
    readonly E: E;               // Errors from async deps
    readonly Bindings: Bindings; // Purely logical state (e.g., isOpen)
    readonly Slots: Slots;       // Purely structural elements (e.g., root: Element.Button)
  };
}
```

**Important:** The component does not return a black-box `JSX.Element`. It returns a `View<Slots>`, which provides the exact structural interface that external Behaviors and Styles look at to ensure compile-time validation.

### 1. Explicit Requirements
Components declare exactly what services, atoms, or context they need. Missing requirements become compile errors, not runtime surprises.

### 2. Type-Safe Composition
Both behaviors and styles use identical attachment patterns. Validation happens at compile time, ensuring all slots referenced exist on the component and match required element capabilities.

### 3. Typed Holes and View Compilation
The JSX compiler transforms views into an Effect generator where every expression becomes a **Typed Hole** (`ClassHole`, `HandlerHole`, `StyleHole`). This ensures:
- **Internal Type-Checking**: You cannot pass a `string` where an `Atom<number>` is expected.
- **Error Bubbling**: If a hole yields an Effect that can fail with `DatabaseError`, the entire component's error type `E` automatically includes `DatabaseError`.
- **Security**: Specific holes like `HtmlHole` strictly require branded types (e.g., `SafeHtml`), preventing accidental XSS vulnerabilities.

### 4. Typed Views and Element Slots
If Typed Holes validate the *inside* of a view, the `View<Slots>` wrapper validates the *outside*. In AF-UI, a `View` is a formal type that encapsulates both the compiled JSX effect and the structural slots exposed to the outside world:

```ts
export interface View<Slots> {
  readonly _Slots: Slots;
  readonly effect: Effect.Effect<ViewNode, any, any>; // The underlying ViewEffect generator
  (props: any): JSX.Element;
}
```

Where `Slots` is a record mapping slot names to their permitted abstract element capabilities:
```ts
type SlotMap = {
  root: Element.Container;
  header: Element.Container;
  title: Element.Text;
  body: Element.Container;
  // etc...
};
```

#### Slot Type Definitions
Element types form a hierarchy that describes what capabilities an element has:
```ts
// Base element type - all elements have this
interface Element.Base {
  readonly __elementBrand: unique symbol;
}

// Specialized element types build on the base
interface Element.Container extends Element.Base {
  readonly children: ViewNode[];
}

interface Element.Button extends Element.Base {
  readonly disabled: WritableAtom<boolean>;
  readonly onClick: () => void;
}
```

#### Slot Constraints and Compatibility
The type system enforces strict rules about what can be attached to slots:

1. **Element Type Compatibility:** A behavior requiring `Element.TextInput` cannot attach to a slot defined as `Element.Container`.
2. **Cardinality Constraints:** A behavior expecting a `Collection<Element.Item>` cannot attach to a single-element slot.
3. **Capability Requirements:** Behaviors declare what capabilities they need (e.g., "needs onClick handler"). The type system verifies the slot's element type provides these capabilities.

## The Styling System

AF-UI's styling system reimagines CSS as a type-safe, composable, platform-agnostic service.

### Composable Style Utilities
AF-UI provides atomic utilities that mirror Tailwind's granularity with full type safety:
```ts
const cardStyle = Style.make({
  root: Style.compose(
    padded("md"),
    flexRow({ gap: "sm", align: "center" }),
    Style.slot({ backgroundColor: "surface" })
  ),
});
```

### Flexibility and Cascading
The system supports the full expressiveness of modern CSS while adding structural guarantees:
1. **Typed Variables (`Style.vars`)**: Declare CSS custom properties with strict types and defaults. These cascade through the platform-agnostic tree.
   ```ts
   const accentVar = Style.var("accent-color", "blue");
   const myStyle = Style.slot({ 
     backgroundColor: accentVar.ref,
     "& .child": { [accentVar]: "red" } // overrides for subtree
   });
   ```
2. **Internal Styling (`Style.nest`)**: Target un-slotted child elements using standard CSS selectors or typed child helpers without exposing them in the component's public `Slots` API.
   ```ts
   Style.make({
     root: Style.nest({
       "& img": { borderRadius: "full" },
       "&:hover": { opacity: 0.8 }
     })
   })
   ```
3. **Responsive & Media**: Built-in support for `Style.responsive` (breakpoints), `Style.media` (queries), and `Style.container` (container queries).
4. **Order of Precedence**: Specificity is replaced by a predictable pipeline: Theme ➔ Recipe ➔ Variant ➔ Utility ➔ Handle Overrides.

### Style Handles
Components expose style handles for external override, enabling true design system customization **without forking**.

## The Behavior System

Behaviors in AF-UI are **active slot-consumers** that directly attach interaction logic to elements.

### Core Concepts

1. **Direct Attachment (The "No Props" Rule)**: 
   Behaviors **directly attach** event listeners and ARIA attributes to the elements provided by slots. This ensures that interaction logic is bound to the element ref itself, avoiding fragile "prop spreading" and unnecessary re-renders.
   ```ts
   // Behavior.attach finds the "trigger" slot and 
   // injects "onClick" and "aria-expanded" automatically via el.setAttr/addEventListener.
   BaseButton.pipe(Behavior.attach(disclosure, { trigger: "root" }))
   ```

2. **Lifecycle Management**: 
   Behaviors leverage Effect's `Scope` to manage their lifecycle. When a behavior is attached, any resources it acquires (event listeners, timers, subscriptions) are automatically cleaned up when the element or component is unmounted.

3. **Composable Behaviors**: 
   Combine simple primitives into complex interaction layers using `Behavior.compose`.
   ```ts
   const modalBehavior = Behavior.compose(
     disclosure({ defaultOpen: false }), // State
     focusTrap(),                        // A11y: traps focus within the slot
     keyboardNav({ onEscape: (b) => b.close() }) // Logic
   );
   ```

4. **Capability-Based Matching**: 
   Behaviors are matched based on **Element Capability**. Each behavior declares exactly what abstract element interface it requires to function (e.g., `Element.Interactive` for a press behavior, `Element.TextInput` for an autocomplete behavior).

   ```ts
   // 1. Behavior requires an Interactive element
   const focusBehavior = Behavior.make({ target: Element.Interactive })((slots) => ...);

   // 2. Component provides an Interactive slot
   const MyComponent = Component.make(...)(
     ...,
     () => view({ root: Element.Interactive }, () => <button slot="root" />)
   );

   // 3. SUCCESS: root (Interactive) satisfies behavior's target (Interactive)
   MyComponent.pipe(Behavior.attach(focusBehavior, { target: "root" }));
   ```

## Renderer Agnosticism and Typed Tags

Styles and behaviors are plain data structures completely decoupled from the browser DOM. The system relies on a **Platform Renderer** layer to interpret the instructions.

### Platform-Specific Typed Tags
JSX tags (like `<Box>`, `<Button>`) are typed by the active platform via `jsxImportSource`. This ensures that attributes, properties, and events are strictly typed for the target environment.
- **Web**: `onClick` provides a `DOM MouseEvent`.
- **TUI**: `onClick` provides a `Terminal MouseEvent`.
- **Native**: `onClick` maps to a `GestureResponderEvent`.

---

## Advanced Examples

### 1. The Composable Modal (Behavior + Style + View)

```tsx
// 1. Define Structural View with Slots
const BaseModal = Component.make(
  Component.props<{ title: string; children: ViewNode }>(),
  Component.require()
)(
  () => Effect.succeed({}),
  (props) => view({
    root: Element.Container,
    backdrop: Element.Interactive,
    content: Element.Container,
    closeButton: Element.Interactive,
    title: Element.Text
  }, () => (
    <div slot="root">
      <div slot="backdrop" />
      <div slot="content">
        <h2 slot="title">{props.title}</h2>
        {props.children}
        <button slot="closeButton">Close</button>
      </div>
    </div>
  ))
);

// 2. Behavioral Composition (Active Consumers)
const modalBehavior = Behavior.make({
  closeButton: Element.Interactive,
  container: Element.Container,
  backdrop: Element.Interactive
})((slots) => Effect.gen(function*() {
  const isOpen = yield* Atom.make(true); // Assume it's already open
  
  yield* slots.closeButton.onPress(() => isOpen.set(false));
  yield* slots.backdrop.onPress(() => isOpen.set(false));
  yield* slots.container.setVisible(isOpen);
  
  return { isOpen };
}));

// 3. Complete Component
export const Modal = BaseModal.pipe(
  Behavior.attach(modalBehavior, {
    closeButton: "closeButton",
    container: "content",
    backdrop: "backdrop"
  }),
  Style.attach(modalStyle) 
);
```

### 2. View Composition & Slot Remapping

```tsx
const Panel = Component.make(
  Component.props<{ title: string; children: ViewNode }>(),
  Component.require()
)(
  () => Effect.succeed({}),
  (props) => {
    return view({
      panelRoot: Element.Container,
      panelTitle: Element.Text,
      panelBody: Element.Container
    }, () => (
      <BaseModal 
        title={props.title}
        // Remap BaseModal's internal slots to Panel's public slots
        slots={{
          root: "panelRoot",
          content: "panelBody",
          title: "panelTitle"
        }}
      >
        {props.children}
      </BaseModal>
    ));
  }
);
```

### 3. Cross-Platform StatusBadge

```tsx
const StatusBadge = Component.make(...)(...)(
  (props) => view({
    root: Element.Container,
    indicator: Element.Base
  }, () => (
    <Box slot="root">
      <Circle slot="indicator" />
      <Text>{props.status}</Text>
    </Box>
  ))
).pipe(
  Style.attach(Style.make({
    root: Style.compose(flexRow({ gap: "xs" }), padded(["xs", "sm"]), rounded("full")),
    indicator: (props) => Style.slot({
      backgroundColor: props.status === "online" ? "success" : "neutral"
    })
  }))
);

// RENDERED ON WEB: <div class="badge"><div class="dot online"></div>online</div>
// RENDERED ON TUI: [ (●) online ] 
```

### 4. Collection Slots and Dynamic Control Flow

AF-UI handles loops and conditionals not just as runtime branches, but as structural type-level transformers.

```tsx
const List = Component.make(...)(
  (props) => Effect.succeed({}),
  (props) => view({
    root: Element.Container,
    // Slots inside For automatically become Collections
    items: Element.Collection<Element.Container>
  }, () => (
    <div slot="root">
      <For each={props.items}>
        {(item) => (
          <div slot="items" key={item.id}>
             <Text>{item.name}</Text>
          </div>
        )}
      </For>
    </div>
  ))
);

// Selection behavior can now safely 'forEach' over the collection
const SelectableList = List.pipe(
  Behavior.attach(selectionBehavior, { target: "items" })
);
```

## Comparison to Other Systems

| Aspect | Tailwind | shadcn/ui | CSS-in-JS | AF-UI |
|--------|----------|-----------|-----------|-------|
| **Granularity** | Utility classes | Copy-paste | Template literals | Composable typed utilities |
| **Type Safety** | None (Magic strings) | Limited (props only) | Limited | Full compile-time validation |
| **Customization** | Complex overrides | Requires forking | Context providers | Typed Style Handles |
| **Platform** | Web-only | Web-only | Web-focused | Platform-agnostic |
| **Encapsulation** | Global namespaces | Tailwind classes | CSS scoping hacks | Slot-scoped, zero collisions |

## Addressing Common Critiques

**1. Ergonomics at Scale: Does pipe-based composition become boilerplate with complex components?**
While the button example is simple, real-world components scale beautifully in this architecture. Because Logic (`setup`) and Structure (`view`) are completely isolated, complex state machines remain purely functional and don't clutter the JSX. Dozens of slots are managed in a flat `SlotMap`, making the structure easy to read. The `.pipe()` composition happens *once* at the export boundary, acting as a clean summary of what is attached, rather than deeply nesting HOCs or scattering hooks throughout the render function.

**2. Learning Curve: Doesn't this require fluency in Effect-TS?**
Yes. This architecture targets teams already investing in robust, type-safe applications. However, UI engineers only need a small subset of Effect (`Effect.gen`, `yield*`, and basic Layer management). Because the type system is so strict, the compiler acts as an interactive tutor—missing requirements are caught instantly at compile time, eliminating the hours spent debugging "undefined context" runtime errors.

**3. The TUI/Mobile Claim: Is the cross-platform story real or just an aspiration?**
The platform agnosticism is a structural reality enforced by the compiler. By defining tags via `jsxImportSource` and mapping them to abstract interfaces (e.g., `Element.Interactive`), the framework mathematically prevents DOM-coupling in the Component logic. While writing a production-ready React Native or TUI renderer takes framework-level effort, the *Component code* you write today is guaranteed to compile cleanly against those renderers once they exist.

**4. Runtime Cost: How does runtime styling compare to zero-runtime solutions like Panda CSS or Vanilla Extract?**
Unlike traditional CSS-in-JS that parses massive template literals at runtime, AF-UI styles are lightweight, pre-structured objects that map closely to platform primitives. More importantly, AF-UI's reactivity is granular—when a reactive style updates, it directly mutates the specific DOM node's style attribute without triggering a full Virtual DOM diff. Additionally, because styles are pure data structures, a future build step could statically extract non-reactive styles exactly like Vanilla Extract.

**5. Ecosystem Interop: Can I use this in an existing React app?**
Yes, incrementally. Because AF-UI separates its lifecycle and rendering from React's VDOM, an AF-UI component tree can be mounted inside a standard React component using a `useEffect` hook (much like mounting a complex D3 chart or WebGL canvas). You can adopt AF-UI to build your core design system or complex state-heavy forms without rewriting your existing React application.

## Conclusion

AF-UI's Design/Styling/Behavior system represents a paradigm shift in UI architecture. By applying Effect's service/layer model to UI development, it achieves true type safety, effortless composability, and genuine platform independence, finally solving the long-standing problems of Tailwind and `shadcn/ui`.
