# Architectural Vision: Separating Bindings and Slots

## The Current Compromise

In the pursuit of strict type safety and a fully composable "Inside-Out" architecture, AF-UI's current implementation makes a pragmatic but flawed compromise in its core type signature. 

Currently, a component is defined as:
```ts
export interface Component<Props, Req, E, Bindings = unknown> {
  // ...
  readonly [ComponentTypeId]: {
    readonly Props: Props;
    readonly Req: Req;
    readonly E: E;
    readonly Bindings: Bindings; 
  };
}
```

Because TypeScript historically struggles with inferring many generic type parameters at once, the `Bindings` type was overloaded to act as a catch-all for **both** the component's logical state AND its structural slots.

If a component exposes slots for behaviors/styles to attach to, its `Bindings` looks like this:
```ts
Bindings: {
  // Logical State (Returned by Setup)
  isOpen: Accessor<boolean>;
  toggle: () => void;
  
  // Structural View (Exported by View)
  slots: {
    root: Element.Button;
    panel: Element.Container;
  }
}
```

### Why This is Problematic

1. **Conceptual Leakage:** The `setup` Effect is responsible for returning logical bindings, but it shouldn't know anything about the DOM or Platform elements. Forcing `slots` into `Bindings` blurs the line between logic and structure.
2. **Type Pollution:** If a consumer uses the component headlessly (e.g., as a render prop `{(bindings) => ...}`), they are handed a `slots` object they neither need nor care about.
3. **Complex Type Gymnastics:** Internal framework functions like `Behavior.attachBySlots` have to do incredibly awkward type mapping to inject new behavior bindings into the existing `Bindings` object while carefully preserving the `slots` key:
   ```ts
   // Current awkward constraint in Behavior.ts
   Bindings extends { readonly slots: Slots }
   ```

---

## The Ideal Architecture: Introducing the Typed View

To truly realize the "Inside-Out" philosophy, we must treat **Structure (Slots)** and **Logic (Bindings)** as distinct, first-class citizens in the type system.

Furthermore, a Component isn't just a function that returns a black-box `JSX.Element`. A Component is an entity that produces a **Typed View**. The `View` is the interface that exposes the Slots.

The ideal component signature separates them entirely:

```ts
export interface Component<Props, Req, E, Bindings = unknown, Slots = {}> {
  // The component returns a Typed View, not just JSX
  (props: Props): View<Slots>;
  
  pipe: PipeableComponent<Props, Req, E, Bindings, Slots>;
  
  readonly [ComponentTypeId]: {
    readonly Props: Props;
    readonly Req: Req;
    readonly E: E;
    readonly Bindings: Bindings; // Purely logical state (isOpen, toggle)
    readonly Slots: Slots;       // Purely structural elements (root: Element.Button)
  };
}

// The View is the container for structural slots
export interface View<Slots> {
  readonly slots: Slots;
  (props: any): JSX.Element; // The actual render function used by the platform
}
```

### The Relationship Between Component, View, Bindings, and Slots

1. **`Component.make` orchestration:**
   - The developer provides a `setup` function: `(props) => Effect<Bindings, E, Req>`.
   - The developer provides a `view` function: `(props, bindings) => View<Slots>`.
   - The `Component` inherits `Bindings` from the `setup` return type.
   - The `Component` inherits `Slots` from the `view` return type.

2. **The Separation of Concerns:** 
   - `Setup` strictly computes and returns `Bindings` (Logic). It has zero knowledge of the UI structure.
   - `View` strictly defines and returns `Slots` (Structure). It uses the bindings, but does not alter them.
   
3. **Cleaner Attachments:**
   - **`Style.attach`**: Targets the Component's `Slots`. It supports complex features like `Style.nest` (targeting descendants) and `Style.vars` (cascading variables). It requires specific slots to exist, but it **never touches `Bindings`**.
   - **`Behavior.attach`**: Targets the Component's `Slots` (to map DOM events) and intersects its return values into the Component's `Bindings` (e.g., adding an `isFocused` Accessor). The `Slots` signature remains unchanged.
   - **`Style.variants` & `Style.recipe`**: These become typed factories that generate the correct `Style` definitions based on props, which are then passed to `Style.attach`.

4. **Purer Headless Components:** Headless consumers only interact with `Bindings`. They don't have to wade through DOM element refs to find the state variables.

5. **Ergonomics at Scale:** By keeping the UI structure completely flat inside the `Slots` definition, deeply nested components don't result in unreadable type signatures. State machines stay neatly packed in the `Bindings`, ensuring the component scales ergonomically regardless of visual complexity. Use `Style.nest` for targeting internal un-slotted elements without polluting the public `Slots` API.

### How do Slots relate to Platforms and Typed Tags?

A critical question arises: do the `Slots` in `View<Slots>` carry information about the Web (e.g., `HTMLButtonElement`), the Terminal, or Native platforms? 

**The answer is No. Slots should carry Abstract Element Capabilities.**

If a component hardcodes web-specific tags into its `Slots`, it loses its platform agnosticism. Instead, the `Slots` type utilizes an abstract element vocabulary.

#### The Abstract Element Hierarchy
AF-UI defines a hierarchy of capabilities that platforms must implement:

- **`Element.Base`**: The root of all elements. Provides identity and basic metadata.
- **`Element.Interactive`**: An element that supports user interaction (e.g., `onPress`, `onKeyDown`) and attribute manipulation (`setAttr`).
- **`Element.Container`**: Extends `Interactive`. Can contain children and control their visibility (`setVisible`).
- **`Element.TextInput`**: Extends `Interactive`. Manages a textual value via a `WritableAtom<string>` and supports `onInput` events.
- **`Element.Collection<E>`**: A special slot type for repeated elements (e.g., inside a loop). Provides `forEach`, `at(index)`, and `count`.

#### How the hierarchy cleanly resolves at compile-time:

1. **The Abstract Component (Portable):**
   The Component defines its view using abstract slots:
   ```ts
   Slots = { root: Element.Interactive }
   ```
2. **The Behaviors (Portable):**
   A "Pressable" behavior declares it requires an `Element.Interactive`. Because the Component's slot matches, `Behavior.attach` succeeds.
3. **The Typed JSX (Global/Platform-Specific):**
   When the developer writes the JSX in the view:
   ```tsx
   <Button slot="root">Click Me</Button>
   ```
   The active `jsxImportSource` (e.g., `af-ui/web`) dictates that `<Button>` is a Web element. The framework's type-checker verifies that the Web `<Button>` successfully implements the abstract `Element.Interactive` interface required by the slot.
4. **Platform Binding (If Required):**
   If a component *must* use a platform-specific feature, it specifies the platform in its Requirements, not its Slots.
   ```ts
   Component.require(Platform.Web)
   ```

This means `Slots` act as the **abstract structural contract**, while the global JSX namespace acts as the **concrete platform implementer**.

---

## Control Flow and Slot Transformations

In a system where structure is statically typed, control flow (like conditional rendering or loops) is not merely about runtime branching—it is a **type-level structural transformer**. If AF-UI provides primitives like `<Show>`, `<If>`, `<Match>`, or `<ForEach>`, they must preserve the slot guarantees required for safe external attachment.

### 1. Branching Computes Intersections
When rendering conditionally, if two branches expose different slots, the resulting view should only expose the **intersection (guaranteed slots)** common to all branches by default.

```tsx
// If loading, slots: { root, spinner }
// Else, slots: { root, body }
<If 
  when={props.loading} 
  then={() => <LoadingView />} 
  else={() => <ContentView />} 
/>
// Resulting Slot Surface: { root: Element.Container }
```
This ensures that `Style.attach` or `Behavior.attach` never attempts to target a slot that might not exist at runtime. If advanced branch-aware typing is needed, it must be explicitly opted into (e.g., via tagged union slots). Optional structure is not externally attachable unless explicitly modeled.

### 2. Iteration Produces Typed Collections
Iteration primitives shouldn't just return a loose bag of nodes. They should preserve the cardinality in the type system, producing typed collections of slots.

```tsx
<ForEach each={items}>
  {(item) => <ItemView item={item} />} // slots: { root: Element.Container }
</ForEach>
// Resulting Slot Surface: { items: Collection<Element.Container> }
```
This allows behaviors like roving focus, selection management, or keyboard navigation to attach safely to the collection.

### 3. Effect as the Computational Substrate
Effect already provides robust primitives for modeling these concepts computationally:
- **`Option`**: Maps naturally to optional/conditional UI branches.
- **`Match`**: Provides typed, exhaustive pattern matching for view selection.
- **`Effect.all`**: Handles traversal and collection of repeated structure.
- **`Layer`**: Perfect for modeling boundaries (Suspense, context, platform injection).

**The architectural split:** Effect handles the control-flow computation and exhaustiveness, while AF-UI defines the structural meaning (the slot algebra) of that control flow.

---

## Implementation Plan

Transitioning the codebase to this ideal state requires a coordinated refactoring effort. Here are the concrete steps to execute this migration.

### Step 1: Define the `View` Interface
Create a formal `View` type that encapsulates both the structural slots and the renderable JSX function.

```ts
// src/View.ts (or inside Component.ts)
export interface View<Slots> {
  readonly _Slots: Slots;
  readonly effect: Effect.Effect<ViewNode, any, any>; // The underlying ViewEffect generator
  (props: any): JSX.Element;
}

export const view = <Slots>(
  slots: Slots, 
  render: () => JSX.Element // JSX compiles to yield* View.intrinsic, etc.
): View<Slots> => {
  // ... implementation that captures the ViewEffect from the render generator
};
```

### Step 2: Update the Core Component Interface
Modify `src/Component.ts` to introduce the 5th generic parameter (`Slots`), and update the call signature to return `View<Slots>`.

```ts
// src/Component.ts
export interface Component<Props, Req, E, Bindings = unknown, Slots = {}> {
  (props: Props): View<Slots>; // Returns a View, not JSX!
  readonly [ComponentTypeId]: {
    readonly Props: Props;
    readonly Req: Req;
    readonly E: E;
    readonly Bindings: Bindings;
    readonly Slots: Slots;
  };
}
```

### Step 3: The ViewEffect and Requirement Bubbling
A critical part of AF-UI is how child requirements (from `Req`) and errors (from `E`) bubble up to the root.

1. **JSX as Generators**: The compiler transforms JSX into a `View.gen` generator.
2. **Child Rendering as yields**: Rendering a child component becomes `yield* View.child(ChildComponent, props)`.
3. **The View return**: Because the `View<Slots>` wraps this `ViewEffect`, the Component's total `Req` and `E` types are the union of its `setup` Effect and its `view` generator's Effect.

```ts
// Example of bubbling:
const Parent = Component.make(...)(
  (props) => Effect.succeed({}), // Req: never
  (props) => view({}, () => (
    <Child /> // Child requires Auth. Parent now requires Auth automatically.
  ))
)
```

### Step 4: Update Component Factories (`Component.make`)
Refactor the construction APIs to infer `Bindings` strictly from the setup Effect, and `Slots` strictly from the View definition.

```ts
// Proposed API refinement (Curried to guarantee inference)
export function make<Props, Req>(
  props: PropsSpec<Props>,
  req: ReqSpec<Req>
): <E, Bindings, Slots>(
  setup: (props: Props) => Effect.Effect<Bindings, E, Req>,
  view: (props: Props, bindings: Bindings) => View<Slots> // Requires a typed View
) => Component<Props, Req, E, Bindings, Slots>;
```

*Note on TypeScript Inference:* TypeScript historically struggles to infer a generic (`Bindings`) from one function argument (`setup`) and pass it immediately to the next function argument (`view`) in the same call signature. By changing `Component.make` to a curried function, we guarantee that the `Bindings` returned by the `setup` block flow perfectly into the `view` block's arguments.

*Current Implementation Status:* The codebase currently uses `Component.withBehavior` as the underlying mechanism for behavior attachment. The refactor should consolidate these patterns into a unified `Component.pipe` flow that understands the `Bindings` vs `Slots` distinction.

```ts
// Usage:
const MyComponent = Component.make(props, req)(
  () => Effect.succeed({ isOpen: true }),
  (props, bindings) => view(...) // `bindings` is correctly and automatically inferred as { isOpen: boolean }
)
```

### Step 5: Refactor Behavior Attachments
Update `src/Behavior.ts` to remove the awkward `{ readonly slots: Slots }` constraint. `attachBySlots` should map the behavior's required elements against the Component's `Slots` parameter, and merge the behavior's output into the Component's `Bindings` parameter.

```ts
// src/Behavior.ts
export function attachBySlots<
  Elements extends SlotMapLike, // What the Behavior needs
  AddedBindings,                // What the Behavior provides
  BR, BE,
  Props, Req, E, Bindings, Slots extends SlotMapLike // Component generics
>(
  behavior: Behavior<Elements, AddedBindings, BR, BE>,
  elementMap: { readonly [K in keyof Elements]: CompatibleSlotKey<Slots, Elements[K]> }
): (
  component: Component<Props, Req, E, Bindings, Slots>
) => Component<
  Props, 
  Req | BR, 
  E | BE, 
  Bindings & AddedBindings, // Bindings grow!
  Slots                     // Slots remain unchanged!
>;
```

### Step 6: Refactor Style Attachments
Update `Style.attach` to operate strictly against the `Slots` generic.

```ts
// src/Style.ts
export function attach<
  RequiredSlots extends SlotMapLike,
  Props, Req, E, Bindings, Slots extends RequiredSlots
>(
  style: StyleDefinition<RequiredSlots>
): (
  component: Component<Props, Req, E, Bindings, Slots>
) => Component<Props, Req, E, Bindings, Slots>; 
// Notice: Style.attach changes NOTHING about the component's signature, 
// it only acts as a compile-time constraint gate!
```

### Step 7: Migrate Internal Composables and Tests
1. Update `src/type-tests/composables-slot-compat.ts` to use the split `Bindings`/`Slots` signature.
2. Update the base components in the test files. Remove `{ readonly slots: { ... } }` from their Bindings types and move them to the new `Slots` parameter.
3. Fix any inference failures in `pipe()` chains by ensuring the 5th parameter flows correctly through the `PipeableComponent` utility types.

### Step 8: Compiler and Typed Hole Integration
The final step is bridging the high-level `Slots` API with the internal JSX compiler's `Typed Holes`.

1. **Implement Hole Taxonomy:** Define the `View.Hole` types (`ClassHole`, `HandlerHole`, `StyleHole`, etc.) as described in the architecture documents.
2. **Preserve Slot Identity:** Update the compiler to recognize the `slot="name"` attribute. Instead of compiling it into an opaque attribute, it must elevate that node's typed holes and expose them on the final `View<Slots>` object.
3. **Bridge Style.attach to Holes:** Refactor `Style.attach` so that it doesn't just check for a slot's existence, but specifically targets the `StyleHole` and `ClassHole` of that slot for property injection.

### Step 9: Support Slot Remapping in Composition
To enable advanced view composition (wrapping components), the system must support remapping slots at the component boundary.

1. **Add `slots` Prop to Components**: Update the base component prop type to optionally accept a `slots` map.
2. **Compiler support**: When the compiler encounters a child component with a `slots` mapping, it must redirect the child's typed holes to the parent's named slots.
3. **Type-safe Mapping**: Ensure that remapping is checked at compile-time—mapping a child's `root` to a parent's `panelRoot` should only work if their abstract element capabilities are compatible.

## Conclusion

By isolating `Bindings` (Logic/Data) from `Slots` (Structure/View) at the type level, we remove the final architectural compromise in AF-UI. Components become cleaner, headless usage becomes native, and the "Inside-Out" philosophy is perfectly reflected in the TypeScript signatures. This refactoring will make the framework significantly easier to explain, maintain, and extend.