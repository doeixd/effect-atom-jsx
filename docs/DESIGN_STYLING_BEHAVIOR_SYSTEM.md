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
  () => Effect.succeed({}), 
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
  (props: Props): View<Slots>;
  pipe: PipeableComponent<Props, Req, E, Bindings, Slots>;
  
  readonly [ComponentTypeId]: {
    readonly Props: Props;
    readonly Req: Req;           
    readonly E: E;               
    readonly Bindings: Bindings; 
    readonly Slots: Slots;       
  };
}
```

**Important:** The component does not return a black-box `JSX.Element`. It returns a `View<Slots>`, which provides the exact structural interface that external Behaviors and Styles look at to ensure compile-time validation.

### 1. Explicit Requirements
Components declare exactly what services, atoms, or context they need. Missing requirements become compile errors.

### 2. Type-Safe Composition
Both behaviors and styles use identical attachment patterns. Validation happens at compile time, ensuring all slots referenced exist on the component and match the required **Element Capability**.

### 3. Typed Holes and View Compilation
The JSX compiler transforms views into an Effect generator where every expression becomes a **Typed Hole** (`ClassHole`, `HandlerHole`, `StyleHole`). This ensures:
- **Internal Type-Checking**: You cannot pass a `string` where an `Atom<number>` is expected.
- **Error Bubbling**: If a hole yields an Effect that can fail with `DatabaseError`, the entire component's error type `E` automatically includes `DatabaseError`.

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
The system supports modern CSS while adding structural guarantees:
1. **Typed Variables (`Style.vars`)**: Declare CSS custom properties with strict types and defaults. 
2. **Internal Styling (`Style.nest`)**: Target un-slotted child elements using standard CSS selectors without exposing them in the component's public `Slots` API.
3. **Order of Precedence**: Specificity is replaced by a predictable pipeline: Theme ➔ Recipe ➔ Variant ➔ Utility
