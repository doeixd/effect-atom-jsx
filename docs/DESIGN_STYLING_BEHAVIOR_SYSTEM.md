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

This separation enables:
- Independent development of view, behavior, and style concerns
- Reusable behavior and style libraries
- External customization without forking
- Platform-agnostic implementations (Web, TUI, Mobile)
- Granular reactive updates

## The Effect Influence

AF-UI's design is fundamentally influenced by **Effect-TS**, inheriting its core patterns and guarantees:

1. **Services as Context:** Like Effect uses the environment (`R`) for dependency injection, AF-UI components declare services in their `Req` type parameter. Providing a Theme or a Router is identical to `Effect.provide(layer)`.
2. **Pipeable Composition:** AF-UI components, behaviors, and styles are transformed and composed using `.pipe()`, matching Effect's standard composition model.
3. **Typed Errors:** Components track explicit error types (`E`) from their asynchronous behaviors, ensuring unhandled failure cases are caught at compile time.
4. **Data as Values:** Styles and behaviors are plain data structures that are interpreted at runtime, not side-effecting function calls. This makes them easily testable as pure data.

## Quick Start: The Anatomy of a Component

Here is a complete example demonstrating the inside-out workflow:

```tsx
import { Component, Style, Behavior, view, Element } from "af-ui";

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
  root: { padding: ["sm", "md"], borderRadius: "md", backgroundColor: "primary" },
  label: { color: "inverse", fontWeight: "bold" }
});

// 3. Define the Behavior (Interaction)
const buttonBehavior = Behavior.make({
  root: { onClick: () => console.log("Clicked!") }
});

// 4. Compose Externally
export const Button = BaseButton.pipe(
  Style.attach(buttonStyle),
  Behavior.attach(buttonBehavior)
);
```

## How Components Enable This System

Components in AF-UI are first-class values with explicit requirements in their type system. They separate logical state (`Bindings`) from structural representation (`Slots`) by returning a `View<Slots>`.

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
Components declare exactly what services, atoms, or context they need:
```ts
const UserCard = Component.make(
  Component.props<{ id: string }>(),
  Component.require(Api, Auth) // Explicit requirements
)(
  // ... setup and view
);
```
Missing requirements become compile errors, not runtime surprises.

### 2. Type-Safe Composition
Both behaviors and styles use identical attachment patterns. Validation happens at compile time:
```ts
// Compile error if style references non-existent slot
const badStyle = Style.make({
  root: { padding: 16 },
  footer: { padding: 8 }, // Error: "footer" slot doesn't exist on BaseButton
});

BaseButton.pipe(Style.attach(badStyle));
```

### 3. Typed Holes and View Compilation
AF-UI's view system goes beyond simple JSX. The JSX compiler transforms the view into an Effect generator where every single expression becomes a "Typed Hole". 

A Typed Hole (`ClassHole`, `HandlerHole`, `StyleHole`) enforces strict internal type-checking. For example:
- An `<input onClick={...}>` creates a `HandlerHole<MouseEvent>`. Passing it a generic `Event` is a compile error.
- An `<div innerHTML={...}>` creates an `HtmlHole` that rejects raw strings and requires a strictly branded `SafeHtml` type to prevent XSS.

Because the JSX is compiled into an `Effect` tree, if an `onClick` handler yields an Effect that can fail with an `HttpError`, that error type `E` automatically bubbles up into the component's signature!

### 4. Typed Views and Element Slots
If Typed Holes validate the *inside* of a view, the `View<Slots>` wrapper validates the *outside*. In AF-UI, a `View` is a formal type that encapsulates both the compiled JSX effect and the structural slots exposed to the outside world:

```ts
export interface View<Slots> {
  readonly _Slots: Slots;
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

AF-UI's styling system reimagines CSS through Effect's lens, creating a type-safe, composable, platform-agnostic alternative to traditional styling approaches.

### Core Principles

1. **Styles as Typed Operations on Element Slots**
   ```ts
   const cardStyle = Style.make({
     root: {
       padding: [16, 24],
       borderRadius: 8,
       backgroundColor: "surface",
     },
   });
   ```

2. **Tokens as a Typed Service**
   Instead of raw values, styles reference tokens resolved through a Theme service:
   ```ts
   class Theme extends Effect.Tag("Theme")<Theme, {
     readonly tokens: ThemeTokens;
     readonly resolve: (token: string) => string;
     readonly mode: ReadonlyAtom<"light" | "dark">;
   }>() {}
   ```

3. **Type-Checked Token References**
   Invalid token names are compile errors:
   ```ts
   Style.make({
     root: {
       backgroundColor: "surfce", // Error: "surfce" not valid TokenPath<"color">
     },
   });
   ```

### Composable Style Utilities

AF-UI provides a library of atomic style utilities that mirror Tailwind's granularity but with full type safety:
```ts
// Atomic utilities
const padded = (amount: StyleSpacing) => Style.slot({ padding: amount });
const flexRow = (options: { gap?: StyleSpacing; align?: string }) => 
  Style.slot({ flex: { direction: "row", ...options } });

// Compose them onto slots
const cardStyle = Style.make({
  root: Style.compose(
    padded("md"),
    flexRow({ gap: "sm", align: "center" }),
    Style.slot({ backgroundColor: "surface" })
  ),
});
```

### Advanced Layout and Selection

AF-UI supports the full expressiveness of modern CSS while maintaining platform agnosticism:

1. **Typed Grid & Flex**: Define complex layouts with typed areas and templates.
2. **Nested Selectors**: Use `Style.nest` or typed helpers like `Style.child("a", "hover")` to target elements relative to a slot.
3. **Container & Media Queries**: Responsive design is built-in via `Style.responsive`, `Style.media`, and even the latest `Style.container` queries.
4. **CSS Custom Properties (Vars)**: Use `Style.vars` to declare typed variables that cascade down the tree, enabling highly efficient dynamic theming.

### Lifecycle and Layout Animations

Unlike traditional libraries that require external animation engines, AF-UI integrates motion directly into the style system:

- **Enter/Exit Animations**: Use `Style.enter` and `Style.exit` to tie animations to the component's DOM lifecycle.
- **Staggered Lists**: `Style.enterStagger` makes animating list item entry trivial.
- **Layout Transitions (FLIP)**: `Style.layoutAnimation` automatically animates elements when they reorder, sort, or move.

### The Style Resolution Pipeline

To eliminate the "Specificity Wars" of traditional CSS, AF-UI resolves styles in a strict, predictable order:
1. Theme Defaults
2. Recipe Base Styles
3. Variant Styles
4. Composed Utilities
5. Handle Overrides (highest precedence)

Additionally, AF-UI supports **CSS Layers** (`Style.layers`), allowing you to group styles into priority buckets (e.g., `reset` < `base` < `components` < `utilities`).

### Dynamic and Reactive Styles

Style pieces can accept reactive values for state-driven styling. When state changes, only the affected style properties update on the affected elements - no unnecessary re-renders.
```ts
const selectedStyle = (isSelected: () => boolean) =>
  Style.slot({
    backgroundColor: () => isSelected() ? "accent.subtle" : "surface",
    border: {
      width: () => isSelected() ? 2 : 1,
      color: () => isSelected() ? "accent.default" : "border",
    },
  });
```

### Supporting Native CSS Features

AF-UI's style objects seamlessly support native CSS features like pseudo-elements, media queries, and animations while keeping the typed constraints:

**Keyframes & Animations:**
```ts
const pulse = Style.keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.5 },
  "100%": { opacity: 1 },
});

const animatedStyle = Style.make({
  root: {
    animation: `${pulse} 2s infinite ease-in-out`
  }
});
```

**Pseudo-elements & Nesting:**
```ts
const customCheckbox = Style.make({
  root: {
    position: "relative",
    // Use '&' for nesting and pseudo-selectors
    "&::before": {
      content: '""',
      position: "absolute",
      inset: 0,
      backgroundColor: "accent.default",
      opacity: 0,
      transition: "fast"
    },
    "&:checked::before": {
      opacity: 1
    }
  }
});
```

### State-Based Styles

Define style variations for interaction states. The platform renderer maps these appropriately (e.g., CSS `:hover` pseudo-classes on Web, pressable state callbacks on Mobile).
```ts
const buttonStates = Style.states({
  default: { backgroundColor: "accent.default" },
  hover: { backgroundColor: "accent.hover" },
  active: { transform: "scale(0.98)" },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
});
```

### Variant Styles (Like CVA but Typed)

```ts
const buttonVariants = Style.variants({
  base: Style.compose(/* ... */),
  variants: {
    intent: {
      primary: Style.slot({ backgroundColor: "accent.default", color: "text.inverse" }),
      secondary: Style.slot({ backgroundColor: "surface", color: "text.primary" }),
    },
    size: {
      sm: padded(["xs", "sm"]),
      md: padded(["sm", "md"]),
    },
  },
  defaults: { intent: "primary", size: "md" },
});

// Used in a component:
buttonVariants({ intent: props.intent, size: props.size })
```

### Style Handles for External Customization

Components expose style handles for external override, enabling true design system customization **without forking**:

```ts
// Component exposes style handles
const Card = Component.make(
  Component.props<{ title: string }>(),
  Component.require()
)(
  () => Effect.succeed({}), // Empty bindings
  (props) => view({
    root: Element.Container,
    title: Element.Text
  }, () => (
    <Box slot="root" styleHandle="card.root">
      <Text slot="title" styleHandle="card.title">{props.title}</Text>
    </Box>
  ))
);

// Consumer overrides specific handles
const brandOverrides = Style.override({
  "card.root": Style.compose(rounded("none"), Style.slot({ border: "none" })),
  "card.title": textStyle({ color: "accent.default" }),
});

// Apply override to the entire application tree
<Style.Provider overrides={brandOverrides}>
  <App />
</Style.Provider>
```

## The Behavior System

While less documented in a single file, the behavior system follows identical principles to styling, but with a critical distinction: **Behaviors are active slot-consumers.**

### Core Concepts

1. **Direct Attachment (The "No Props" Rule)**: 
   Traditional headless libraries (like Headless UI or Radix) require you to "spread" a bag of props onto your elements. This is fragile and error-prone. In AF-UI, behaviors **directly attach** event listeners and ARIA attributes to the elements provided by slots.
   ```ts
   // Behavior.attach finds the "trigger" slot and 
   // injects "onClick" and "aria-expanded" automatically.
   BaseButton.pipe(Behavior.attach(disclosure, { trigger: "root" }))
   ```

2. **Identical Attachment Pattern**: (`Behavior.attach(focusBehavior)`)

3. **Type-Safe Validation**: Behaviors declare what abstract capabilities they need (e.g., "needs `Element.Interactive`"). The system ensures the slot satisfies this before allowing attachment.

### Dynamic and Reactive Behaviors

Because behaviors have direct access to element refs, they can react to state changes without re-rendering the view. A behavior can subscribe to an atom and call `el.setAttr()` directly when it changes, resulting in zero virtual-dom overhead.

### Collection Slots (Lists)

When a slot is defined inside a loop (e.g., `<For each={...}>`), it automatically becomes an `Element.Collection`. Behaviors like multi-selection management or keyboard navigation use `collection.forEach((el) => ...)` to dynamically attach logic as items are added or removed from the DOM.

## Renderer Agnosticism and Typed Tags

Because AF-UI's styles and behaviors are defined as plain data structures referencing a `Theme` service, they are completely decoupled from the browser DOM. The system relies on a **Platform Renderer** layer to interpret the instructions.

### Platform-Specific Typed Tags

A key enabler of this agnosticism is how JSX tags (like `<Box>`, `<Button>`) are typed. AF-UI doesn't hardcode HTML types into the global `JSX.IntrinsicElements`. Instead, **the JSX namespace is parameterized by the platform** via `jsxImportSource`:

```ts
// For web projects (tsconfig.json)
{ "jsxImportSource": "af-ui/web" }

// For TUI projects
{ "jsxImportSource": "af-ui/tui" }
```

When you use the Web platform, `<Button onClick={e => ...}>` types `e` as a DOM `MouseEvent`. If you swap to the TUI platform, the exact same tag infers `e` as a `KeyEvent`. 

The platform layer defines the element vocabulary (`PlatformElements`), and every attribute, property, and event on every element is typed by that specific platform. Universal elements (like `<Box>`) provide a cross-platform intersection, while the compiler will throw an error if you try to use a purely web-specific tag in a TUI project.

### Swapping the Renderer

At runtime, swapping the environment is as simple as swapping the platform layer when mounting:

- **Web Browser:** The Web renderer (`WebPlatformLive`) compiles `padding: "sm"` into `padding: var(--spacing-sm)` and injects CSS rules, while attaching event listeners (`onClick`) to DOM nodes.
- **Terminal (TUI):** A TUI renderer (`TuiPlatformLive`) resolves `padding: "sm"` to absolute positioning calculations or blessed object attributes, and maps `onClick` to terminal mouse events or keyboard shortcuts.
- **Native Mobile:** A mobile renderer (`MobilePlatformLive`) translates the style data into `StyleSheet.create` objects and maps behaviors to `Pressable` components.

```ts
// Web Environment
Component.mount(App, { layer: WebPlatformLive });

// Terminal Environment
Component.mount(App, { layer: TuiPlatformLive });
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

AF-UI's Design/Styling/Behavior system represents a paradigm shift in UI architecture by:

1. **Applying Effect's service/layer model** to styling and theming.
2. **Creating a truly type-safe, composable styling system** that validates at compile time.
3. **Enabling platform-agnostic UI design** that adapts to Web, TUI, or Native automatically.
4. **Providing granular, reactive style/behavior updates** with zero virtual-dom overhead.
5. **Supporting true design system customization** through handles instead of painful forking.
6. **Separating concerns cleanly** between view (structure), behavior (logic), and style (appearance).

The system achieves what Tailwind, shadcn/ui, and CSS-in-JS attempt, but with stronger type guarantees, better composability, and genuine platform independence. This inside-out approach creates a foundation for building maintainable, customizable, and scalable UI systems.