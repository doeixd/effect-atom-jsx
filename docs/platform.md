Yes. If the renderer is a service, then the tags it provides are also from that service. Different platforms have different elements with different attributes and different event types. A `Button` on web has `onClick` with `MouseEvent`. A `Button` in a terminal has `onKeypress` with `KeyEvent`. A `Button` on mobile has `onPress` with `NativePressEvent`. The platform layer defines the element vocabulary, and every attribute, property, and event on every element is typed by the platform.

**The platform defines its element vocabulary:**

```ts
// Platform is a service that provides the element types
class Platform extends Effect.Tag("Platform")<Platform, {
  readonly elements: PlatformElements;
}>() {}

// Each platform declares its own element set with typed attributes
interface PlatformElements {
  readonly Box: ElementDef<BoxAttributes, BoxEvents>;
  readonly Text: ElementDef<TextAttributes, TextEvents>;
  readonly Input: ElementDef<InputAttributes, InputEvents>;
  readonly Button: ElementDef<ButtonAttributes, ButtonEvents>;
  readonly Image: ElementDef<ImageAttributes, ImageEvents>;
  readonly List: ElementDef<ListAttributes, ListEvents>;
  readonly ScrollView: ElementDef<ScrollViewAttributes, ScrollViewEvents>;
  // ...
}

interface ElementDef<Attrs, Events> {
  readonly [ElementDefTypeId]: unique symbol;
  readonly _Attrs: Attrs;
  readonly _Events: Events;
}
```

**Web platform elements:**

```ts
interface WebBoxAttributes {
  class?: string | string[] | Record<string, boolean>;
  style?: Partial<CSSStyleDeclaration> | string;
  id?: string;
  role?: AriaRole;
  tabIndex?: number;
  draggable?: boolean;
  hidden?: boolean;
  // ... all valid HTML div attributes
}

interface WebBoxEvents {
  onClick?: (e: MouseEvent) => void;
  onMouseDown?: (e: MouseEvent) => void;
  onMouseUp?: (e: MouseEvent) => void;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  onKeyUp?: (e: KeyboardEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  onDragStart?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onPointerDown?: (e: PointerEvent) => void;
  onPointerUp?: (e: PointerEvent) => void;
  onScroll?: (e: Event) => void;
  onWheel?: (e: WheelEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  onTouchStart?: (e: TouchEvent) => void;
  onTouchEnd?: (e: TouchEvent) => void;
  // ...
}

interface WebInputAttributes {
  type?: "text" | "number" | "email" | "password" | "checkbox" | "radio" | "date" | "file" | "range" | "color" | "search" | "tel" | "url";
  value?: string | number;
  checked?: boolean;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  pattern?: string;
  required?: boolean;
  autoComplete?: AutocompleteToken;
  autoFocus?: boolean;
  name?: string;
  maxLength?: number;
  minLength?: number;
  multiple?: boolean;
  accept?: string;
}

interface WebInputEvents {
  onInput?: (e: InputEvent) => void;
  onChange?: (e: Event) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  onKeyUp?: (e: KeyboardEvent) => void;
  onSelect?: (e: Event) => void;
  onInvalid?: (e: Event) => void;
}

interface WebButtonAttributes {
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  autoFocus?: boolean;
  name?: string;
  value?: string;
  form?: string;
}

interface WebButtonEvents {
  onClick?: (e: MouseEvent) => void;
  onMouseDown?: (e: MouseEvent) => void;
  onMouseUp?: (e: MouseEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  onPointerDown?: (e: PointerEvent) => void;
}

const WebPlatform = Layer.succeed(Platform, {
  elements: {
    Box: elementDef<WebBoxAttributes, WebBoxEvents>(),
    Text: elementDef<WebTextAttributes, WebTextEvents>(),
    Input: elementDef<WebInputAttributes, WebInputEvents>(),
    Button: elementDef<WebButtonAttributes, WebButtonEvents>(),
    Image: elementDef<WebImageAttributes, WebImageEvents>(),
    List: elementDef<WebListAttributes, WebListEvents>(),
    ScrollView: elementDef<WebScrollViewAttributes, WebScrollViewEvents>(),
  },
});
```

**TUI platform elements — different attributes, different events:**

```ts
interface TuiBoxAttributes {
  top?: number | string;
  left?: number | string;
  right?: number | string;
  bottom?: number | string;
  width?: number | string;
  height?: number | string;
  border?: "line" | "bg" | "none";
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
  scrollable?: boolean;
  focusable?: boolean;
  label?: string;
  shadow?: boolean;
  // CSS properties don't exist here — different styling model
}

interface TuiBoxEvents {
  // No MouseEvent — terminals have different input
  onKeypress?: (e: TuiKeyEvent) => void;
  onFocus?: (e: TuiFocusEvent) => void;
  onBlur?: (e: TuiFocusEvent) => void;
  onResize?: (e: TuiResizeEvent) => void;
  onMouse?: (e: TuiMouseEvent) => void;  // basic mouse in terminals that support it
  // No drag events, no touch events, no pointer events
}

interface TuiKeyEvent {
  readonly key: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly sequence: string;
}

interface TuiMouseEvent {
  readonly x: number;
  readonly y: number;
  readonly button: "left" | "right" | "middle";
  readonly action: "mousedown" | "mouseup" | "click";
}

interface TuiInputAttributes {
  value?: string;
  placeholder?: string;
  secret?: boolean;     // password mode — shows asterisks
  censor?: boolean;     // hide input completely
  inputOnFocus?: boolean;
  // No type variants like "checkbox" or "radio" — different model
}

interface TuiInputEvents {
  onInput?: (e: { value: string }) => void;
  onSubmit?: (e: { value: string }) => void;  // user pressed enter
  onCancel?: (e: {}) => void;                 // user pressed escape
  onKeypress?: (e: TuiKeyEvent) => void;
  onFocus?: (e: TuiFocusEvent) => void;
  onBlur?: (e: TuiFocusEvent) => void;
}

interface TuiButtonAttributes {
  content?: string;
  align?: "left" | "center" | "right";
  shrink?: boolean;
  // No "type" variants — no form submission concept
}

interface TuiButtonEvents {
  onPress?: (e: TuiKeyEvent | TuiMouseEvent) => void;
  onFocus?: (e: TuiFocusEvent) => void;
  onBlur?: (e: TuiFocusEvent) => void;
  // No onClick — onPress unifies keyboard and mouse
}

const TuiPlatform = Layer.succeed(Platform, {
  elements: {
    Box: elementDef<TuiBoxAttributes, TuiBoxEvents>(),
    Text: elementDef<TuiTextAttributes, TuiTextEvents>(),
    Input: elementDef<TuiInputAttributes, TuiInputEvents>(),
    Button: elementDef<TuiButtonAttributes, TuiButtonEvents>(),
    Image: elementDef<TuiImageAttributes, TuiImageEvents>(),
    List: elementDef<TuiListAttributes, TuiListEvents>(),
    ScrollView: elementDef<TuiScrollViewAttributes, TuiScrollViewEvents>(),
  },
});
```

**Mobile platform elements — yet another attribute and event model:**

```ts
interface MobileBoxAttributes {
  flex?: number;
  flexDirection?: "row" | "column";
  justifyContent?: "flex-start" | "center" | "flex-end" | "space-between" | "space-around";
  alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
  padding?: number | [number, number] | [number, number, number, number];
  margin?: number | [number, number] | [number, number, number, number];
  backgroundColor?: string;
  borderRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  opacity?: number;
  overflow?: "visible" | "hidden" | "scroll";
  // Flexbox-native — no CSS strings, no class names
}

interface MobileBoxEvents {
  onPress?: (e: MobilePressEvent) => void;
  onLongPress?: (e: MobilePressEvent) => void;
  onPressIn?: (e: MobilePressEvent) => void;
  onPressOut?: (e: MobilePressEvent) => void;
  onLayout?: (e: MobileLayoutEvent) => void;
  // No mouse events — touch only
  // No keyboard events on arbitrary elements
}

interface MobilePressEvent {
  readonly nativeEvent: {
    readonly locationX: number;
    readonly locationY: number;
    readonly pageX: number;
    readonly pageY: number;
    readonly timestamp: number;
    readonly touches: readonly MobileTouch[];
    readonly changedTouches: readonly MobileTouch[];
  };
}

interface MobileLayoutEvent {
  readonly nativeEvent: {
    readonly layout: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  };
}

interface MobileInputAttributes {
  value?: string;
  placeholder?: string;
  placeholderTextColor?: string;
  keyboardType?: "default" | "numeric" | "email-address" | "phone-pad" | "decimal-pad" | "url";
  returnKeyType?: "done" | "go" | "next" | "search" | "send";
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  multiline?: boolean;
  numberOfLines?: number;
  editable?: boolean;
  selectTextOnFocus?: boolean;
  // Completely different from web — no type="checkbox", no pattern, no min/max
}

interface MobileInputEvents {
  onChangeText?: (text: string) => void;    // direct string, not event object
  onFocus?: (e: MobileFocusEvent) => void;
  onBlur?: (e: MobileFocusEvent) => void;
  onSubmitEditing?: (e: { nativeEvent: { text: string } }) => void;
  onKeyPress?: (e: { nativeEvent: { key: string } }) => void;
  onSelectionChange?: (e: { nativeEvent: { selection: { start: number; end: number } } }) => void;
  // No onInput with InputEvent — different model
}

interface MobileButtonAttributes {
  title?: string;
  disabled?: boolean;
  color?: string;
  // Much simpler than web — no type, no form association
}

interface MobileButtonEvents {
  onPress?: (e: MobilePressEvent) => void;
  onLongPress?: (e: MobilePressEvent) => void;
  onPressIn?: (e: MobilePressEvent) => void;
  onPressOut?: (e: MobilePressEvent) => void;
  // No onClick, no onMouseDown — press events only
}

const MobilePlatform = Layer.succeed(Platform, {
  elements: {
    Box: elementDef<MobileBoxAttributes, MobileBoxEvents>(),
    Text: elementDef<MobileTextAttributes, MobileTextEvents>(),
    Input: elementDef<MobileInputAttributes, MobileInputEvents>(),
    Button: elementDef<MobileButtonAttributes, MobileButtonEvents>(),
    Image: elementDef<MobileImageAttributes, MobileImageEvents>(),
    List: elementDef<MobileListAttributes, MobileListEvents>(),
    ScrollView: elementDef<MobileScrollViewAttributes, MobileScrollViewEvents>(),
  },
});
```

**How components use platform elements:**

The platform elements are yielded in the view, and their types come from the platform layer. The component doesn't import concrete element types — it uses the platform's elements, and the platform layer determines what's valid.

```tsx
// The component uses abstract elements
// The TYPE of each element's attributes and events
// comes from whichever platform layer is provided

const Counter = Component.make(
  Component.props<{}>(),
  Component.require(Platform),

  (props) => Effect.gen(function* () {
    const count = yield* Component.state(0);
    return { count };
  }),

  (props, { count }) => (
    <Box padding={8} flex={{ direction: "column", gap: 4 }}>
      <Text fontSize="heading" fontWeight="bold">
        Count: {count()}
      </Text>
      <Button onPress={() => count.update((n) => n + 1)}>
        Increment
      </Button>
    </Box>
  ),
);
```

But here's the critical question: when the compiler sees `<Box padding={8}>`, how does it know what `padding` should accept? The answer: the JSX element types are parameterized by the platform.

**JSX namespace parameterized by platform:**

```ts
// The JSX type definitions are generated from the platform type
declare namespace JSX {
  // Elements come from the platform
  type IntrinsicElements = PlatformIntrinsicElements<ActivePlatform>;
}

// PlatformIntrinsicElements maps element names to their typed props
type PlatformIntrinsicElements<P extends PlatformElements> = {
  [K in keyof P]: P[K] extends ElementDef<infer Attrs, infer Events>
    ? Attrs & Events & { ref?: any; children?: any }
    : never;
};
```

When you provide `WebPlatform`, JSX elements have web types. When you provide `TuiPlatform`, JSX elements have TUI types. When you provide `MobilePlatform`, JSX elements have mobile types.

But TypeScript's JSX namespace is global — you can't parameterize it per-component. So how does this work?

**Approach: platform-specific JSX imports.**

Each platform ships its own JSX type definitions. You configure which one via tsconfig or Babel:

```ts
// For web projects
// tsconfig.json: { "jsx": "react-jsx", "jsxImportSource": "effect-atom-jsx/web" }
// This makes JSX elements use WebPlatform types

// For TUI projects
// tsconfig.json: { "jsxImportSource": "effect-atom-jsx/tui" }

// For mobile projects
// tsconfig.json: { "jsxImportSource": "effect-atom-jsx/mobile" }
```

Each import source defines its own `JSX.IntrinsicElements` based on its platform:

```ts
// effect-atom-jsx/web/jsx-runtime.d.ts
declare namespace JSX {
  interface IntrinsicElements {
    Box: WebBoxAttributes & WebBoxEvents & CommonProps;
    Text: WebTextAttributes & WebTextEvents & CommonProps;
    Input: WebInputAttributes & WebInputEvents & CommonProps;
    Button: WebButtonAttributes & WebButtonEvents & CommonProps;
    // ...
  }
}

// effect-atom-jsx/tui/jsx-runtime.d.ts
declare namespace JSX {
  interface IntrinsicElements {
    Box: TuiBoxAttributes & TuiBoxEvents & CommonProps;
    Text: TuiTextAttributes & TuiTextEvents & CommonProps;
    Input: TuiInputAttributes & TuiInputEvents & CommonProps;
    Button: TuiButtonAttributes & TuiButtonEvents & CommonProps;
    // ...
  }
}
```

Now the compiler knows exactly what each element accepts based on the platform:

```tsx
// With web platform:
<Button onClick={(e) => {
  e.clientX  // ✓ — MouseEvent has clientX
  e.key      // Error: Property 'key' does not exist on MouseEvent
}}>Click</Button>

// With TUI platform:
<Button onPress={(e) => {
  e.key      // ✓ — TuiKeyEvent has key
  e.ctrl     // ✓ — TuiKeyEvent has ctrl
  e.clientX  // Error: Property 'clientX' does not exist on TuiKeyEvent
}}>Press</Button>

// With mobile platform:
<Button onPress={(e) => {
  e.nativeEvent.locationX  // ✓ — MobilePressEvent has locationX
  e.key                    // Error: Property 'key' does not exist on MobilePressEvent
}}>Tap</Button>
```

**Cross-platform components — the universal element set:**

For components that should work on any platform, use a universal element set that's the intersection of all platforms:

```ts
// Universal attributes — only attributes that exist on ALL platforms
interface UniversalBoxAttributes {
  padding?: number | [number, number] | [number, number, number, number];
  margin?: number | [number, number] | [number, number, number, number];
  flex?: {
    direction?: "row" | "column";
    justify?: "start" | "center" | "end" | "between";
    align?: "start" | "center" | "end" | "stretch";
    gap?: number;
    grow?: number;
  };
  backgroundColor?: string;
  borderRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  opacity?: number;
  visible?: boolean;
}

// Universal events — only events that exist on ALL platforms
interface UniversalBoxEvents {
  onPress?: (e: UniversalPressEvent) => void;
  onFocus?: (e: UniversalFocusEvent) => void;
  onBlur?: (e: UniversalFocusEvent) => void;
}

// Universal press event — lowest common denominator
interface UniversalPressEvent {
  readonly x: number;
  readonly y: number;
  readonly timestamp: number;
}
```

Each platform maps the universal event to its native event:

```ts
// Web: UniversalPressEvent is constructed from MouseEvent
// TUI: UniversalPressEvent is constructed from TuiKeyEvent/TuiMouseEvent
// Mobile: UniversalPressEvent is constructed from MobilePressEvent
```

Cross-platform components import universal types:

```tsx
// tsconfig: "jsxImportSource": "effect-atom-jsx/universal"

const UniversalCounter = Component.make(
  Component.props<{}>(),
  Component.require(Platform),

  (props) => Effect.gen(function* () {
    const count = yield* Component.state(0);
    return { count };
  }),

  (props, { count }) => (
    <Box padding={8} flex={{ direction: "column", gap: 4 }}>
      <Text>Count: {count()}</Text>
      <Button onPress={() => count.update((n) => n + 1)}>
        Increment
      </Button>
    </Box>
  ),
);

// Works on web, TUI, and mobile — universal types are the intersection
```

But you lose platform-specific features. No `onClick` on web. No `onKeypress` on TUI. No `onLongPress` on mobile. The universal set is deliberately limited.

**Platform-specific extensions via module augmentation:**

When you need platform-specific attributes on a universal component, use platform extensions:

```tsx
import { Platform } from "effect-atom-jsx";

const MyButton = Component.make(
  Component.props<{ label: string }>(),
  Component.require(Platform),

  (props) => Effect.gen(function* () {
    const platform = yield* Platform;

    // Platform-specific setup
    const handler = yield* platform.match({
      web: () => Component.handler((e: MouseEvent) => {
        console.log("clicked at", e.clientX, e.clientY);
      }),
      tui: () => Component.handler((e: TuiKeyEvent) => {
        console.log("pressed", e.key);
      }),
      mobile: () => Component.handler((e: MobilePressEvent) => {
        console.log("tapped at", e.nativeEvent.locationX);
      }),
    });

    return { handler };
  }),

  (props, { handler }) => (
    <Button onPress={handler}>
      {props.label}
    </Button>
  ),
);
```

`platform.match` dispatches based on which platform layer is provided. The return types are different per platform, but the component handles all cases. Inside each branch, the event types are fully typed for that platform.

**But really, most components don't need platform.match.**

The universal element set with `onPress` instead of `onClick`/`onKeypress`/`onPress` covers the vast majority of cases. Platform-specific code should be rare — most components just need "user activated this button" regardless of whether it was a mouse click, a key press, or a touch.

```tsx
// This works everywhere with no platform branching
<Button onPress={() => count.update((n) => n + 1)}>
  Increment
</Button>
```

The platform layer translates `onPress` to the native event mechanism. On web, it attaches `click`. On TUI, it attaches `keypress` for Enter/Space and `mouse` for click. On mobile, it attaches the native press handler. The component doesn't know or care.

**Platform-specific elements that don't exist universally:**

Some elements only exist on certain platforms. Web has `<Canvas>`. TUI has `<ProgressBar>`. Mobile has `<FlatList>`.

These should be importable from platform-specific modules:

```tsx
// Web-specific element
import { Canvas } from "effect-atom-jsx/web/elements";

const DrawingApp = Component.make(
  Component.props<{}>(),
  Component.require(Platform.Web),  // requires web platform specifically

  (props) => Effect.gen(function* () {
    const canvasRef = yield* Component.ref<HTMLCanvasElement>();
    return { canvasRef };
  }),

  (props, { canvasRef }) => (
    <Canvas
      ref={canvasRef}
      width={800}
      height={600}
      onMouseMove={(e) => draw(e.clientX, e.clientY)}
    />
  ),
);

// This component requires Platform.Web — won't compile with TuiPlatform
```

`Component.require(Platform.Web)` narrows the platform requirement. If you try to mount this component with `TuiPlatform`, the compiler rejects it because `Platform.Web` is not assignable to `Platform.Tui`.

**The platform layer provides the renderer AND the element types:**

```ts
// Web platform provides both rendering and typed elements
const WebPlatformLive = Layer.mergeAll(
  WebRenderer,        // how to create/modify DOM nodes
  WebElements,        // typed element definitions
  WebEventSystem,     // how to attach event listeners
);

// TUI platform provides both
const TuiPlatformLive = Layer.mergeAll(
  TuiRenderer,
  TuiElements,
  TuiEventSystem,
);

// Mobile platform provides both
const MobilePlatformLive = Layer.mergeAll(
  MobileRenderer,
  MobileElements,
  MobileEventSystem,
);
```

Mounting:

```ts
// Web
Component.mount(App, {
  layer: Layer.mergeAll(AppLive, WebPlatformLive),
  target: document.getElementById("root")!,
});

// TUI
Component.mount(App, {
  layer: Layer.mergeAll(AppLive, TuiPlatformLive),
  target: process.stdout,
});

// Mobile
Component.mount(App, {
  layer: Layer.mergeAll(AppLive, MobilePlatformLive),
  target: "root-view",
});
```

**Events as Effects:**

Event handlers that return Effects should have their error types tracked. The platform defines what event types its elements produce, and the Effect return type's errors flow into the component's error channel:

```tsx
<Button onPress={() => Effect.gen(function* () {
  const api = yield* Api;
  yield* api.deleteItem(itemId);
  // This can fail with HttpError — flows into component's E
})}>
  Delete
</Button>
```

The compiler sees that the `onPress` handler returns an `Effect<void, HttpError, Api>`. The `HttpError` flows into the view's `E`. The `Api` requirement is checked against the component's available services.

For synchronous handlers (no Effect return), no error tracking:

```tsx
<Button onPress={() => count.update((n) => n + 1)}>
  Increment
</Button>
// No Effect returned — no error contribution to E
```

The distinction: if the handler returns `void`, it's fire-and-forget with no error tracking. If it returns `Effect<A, E, R>`, the errors and requirements flow into the component's types.

**Platform event mapping — how universal events map to native:**

The platform layer includes an event mapping layer that normalizes native events to the universal event interface:

```ts
class EventMapper extends Effect.Tag("EventMapper")<EventMapper, {
  // Normalize native events to universal events
  readonly normalizePress: (native: unknown) => UniversalPressEvent;
  readonly normalizeFocus: (native: unknown) => UniversalFocusEvent;
  readonly normalizeKeyboard: (native: unknown) => UniversalKeyboardEvent;
  readonly normalizeInput: (native: unknown) => UniversalInputEvent;
  readonly normalizeScroll: (native: unknown) => UniversalScrollEvent;
  readonly normalizeResize: (native: unknown) => UniversalResizeEvent;

  // Register native listener and emit universal event
  readonly listen: <E>(
    node: RenderNode,
    universalEvent: string,
    handler: (e: E) => void,
  ) => Effect.Effect<void, never, Scope>;
}>() {}

// Web event mapper
const WebEventMapper = Layer.succeed(EventMapper, {
  normalizePress: (native: MouseEvent) => ({
    x: native.clientX,
    y: native.clientY,
    timestamp: native.timeStamp,
  }),
  normalizeFocus: (native: FocusEvent) => ({
    relatedTarget: native.relatedTarget,
  }),
  normalizeInput: (native: InputEvent) => ({
    value: (native.target as HTMLInputElement).value,
    data: native.data,
  }),
  listen: (node, event, handler) =>
    Effect.gen(function* () {
      const el = node as unknown as HTMLElement;
      const nativeEvent = mapUniversalToNative(event); // "onPress" → "click"
      el.addEventListener(nativeEvent, (e) => {
        handler(normalizeEvent(event, e));
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => el.removeEventListener(nativeEvent, handler as any))
      );
    }),
});

// TUI event mapper
const TuiEventMapper = Layer.succeed(EventMapper, {
  normalizePress: (native: TuiKeyEvent | TuiMouseEvent) => ({
    x: "x" in native ? native.x : 0,
    y: "y" in native ? native.y : 0,
    timestamp: Date.now(),
  }),
  normalizeInput: (native: { value: string }) => ({
    value: native.value,
    data: null,
  }),
  listen: (node, event, handler) =>
    Effect.gen(function* () {
      const tui = node as unknown as TuiNode;
      const nativeEvent = mapUniversalToTui(event); // "onPress" → "keypress" + "click"
      tui.element.on(nativeEvent, (e: any) => {
        handler(normalizeEvent(event, e));
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => tui.element.removeListener(nativeEvent, handler as any))
      );
    }),
});
```

**Custom elements per platform:**

Platforms can provide custom elements that only exist in their context:

```ts
// Web-specific elements
interface WebCustomElements {
  Canvas: ElementDef<{
    width: number;
    height: number;
    contextType?: "2d" | "webgl" | "webgl2";
  }, {
    onMouseMove?: (e: MouseEvent) => void;
    onMouseDown?: (e: MouseEvent) => void;
    onMouseUp?: (e: MouseEvent) => void;
    onWheel?: (e: WheelEvent) => void;
  }>;
  Video: ElementDef<{
    src: string;
    autoplay?: boolean;
    controls?: boolean;
    muted?: boolean;
    loop?: boolean;
    poster?: string;
    width?: number;
    height?: number;
    preload?: "none" | "metadata" | "auto";
  }, {
    onPlay?: (e: Event) => void;
    onPause?: (e: Event) => void;
    onEnded?: (e: Event) => void;
    onTimeUpdate?: (e: Event) => void;
    onError?: (e: Event) => void;
    onLoadedMetadata?: (e: Event) => void;
  }>;
  Audio: ElementDef<{
    src: string;
    autoplay?: boolean;
    controls?: boolean;
    muted?: boolean;
    loop?: boolean;
    preload?: "none" | "metadata" | "auto";
  }, {
    onPlay?: (e: Event) => void;
    onPause?: (e: Event) => void;
    onEnded?: (e: Event) => void;
  }>;
  IFrame: ElementDef<{
    src: string;
    sandbox?: string;
    allow?: string;
    width?: number | string;
    height?: number | string;
  }, {
    onLoad?: (e: Event) => void;
    onError?: (e: Event) => void;
  }>;
}

// TUI-specific elements
interface TuiCustomElements {
  ProgressBar: ElementDef<{
    value: number;
    max?: number;
    orientation?: "horizontal" | "vertical";
    filled?: string;  // fill character
    empty?: string;   // empty character
  }, {
    onChange?: (e: { value: number }) => void;
  }>;
  Table: ElementDef<{
    rows: readonly string[][];
    headers?: readonly string[];
    columnWidths?: readonly number[];
    align?: readonly ("left" | "center" | "right")[];
    border?: "line" | "dashed" | "none";
  }, {
    onSelect?: (e: { row: number; column: number }) => void;
  }>;
  Log: ElementDef<{
    lines: readonly string[];
    scrollback?: number;
    autoScroll?: boolean;
  }, {}>;
  Sparkline: ElementDef<{
    data: readonly number[];
    min?: number;
    max?: number;
  }, {}>;
}

// Mobile-specific elements
interface MobileCustomElements {
  FlatList: ElementDef<{
    data: readonly unknown[];
    renderItem: (item: unknown) => ViewNode;
    keyExtractor?: (item: unknown) => string;
    horizontal?: boolean;
    numColumns?: number;
    initialNumToRender?: number;
  }, {
    onEndReached?: () => void;
    onRefresh?: () => void;
    onScroll?: (e: MobileScrollEvent) => void;
    onViewableItemsChanged?: (e: { viewableItems: unknown[] }) => void;
  }>;
  SafeAreaView: ElementDef<{
    edges?: readonly ("top" | "bottom" | "left" | "right")[];
  }, {}>;
  StatusBar: ElementDef<{
    barStyle?: "default" | "light-content" | "dark-content";
    backgroundColor?: string;
    hidden?: boolean;
  }, {}>;
  Modal: ElementDef<{
    visible: boolean;
    animationType?: "none" | "slide" | "fade";
    transparent?: boolean;
  }, {
    onRequestClose?: () => void;
    onShow?: () => void;
  }>;
  Switch: ElementDef<{
    value: boolean;
    disabled?: boolean;
    trackColor?: { false?: string; true?: string };
    thumbColor?: string;
  }, {
    onValueChange?: (value: boolean) => void;
  }>;
}
```

Import platform-specific elements from the platform module:

```tsx
// Web-specific component
import { Canvas, Video } from "effect-atom-jsx/web/elements";

<Canvas width={800} height={600} onMouseMove={handleDraw} />
<Video src={videoUrl} controls autoplay muted />

// TUI-specific component
import { ProgressBar, Table, Sparkline } from "effect-atom-jsx/tui/elements";

<ProgressBar value={progress()} max={100} filled="█" empty="░" />
<Table rows={data} headers={["Name", "Email", "Role"]} border="line" />
<Sparkline data={cpuHistory()} />

// Mobile-specific component
import { FlatList, SafeAreaView, Modal } from "effect-atom-jsx/mobile/elements";

<SafeAreaView edges={["top", "bottom"]}>
  <FlatList
    data={items()}
    renderItem={(item) => <ListRow item={item} />}
    onEndReached={() => loadMore()}
  />
</SafeAreaView>
```

These imports bring in the element types for that platform. If you accidentally use a web element in a TUI project, the compiler catches it because the element doesn't exist in the TUI JSX namespace.

**Style attributes — platform-specific with shared semantics:**

Styles are the biggest divergence between platforms. Rather than trying to unify them, let each platform define its own style type and provide a translation layer for the universal subset:

```ts
// Universal style tokens — work everywhere
interface UniversalStyle {
  // Layout
  padding?: number | [number, number] | [number, number, number, number];
  margin?: number | [number, number] | [number, number, number, number];
  flex?: {
    direction?: "row" | "column";
    justify?: "start" | "center" | "end" | "between" | "around";
    align?: "start" | "center" | "end" | "stretch";
    gap?: number;
    grow?: number;
    shrink?: number;
    basis?: number | "auto";
    wrap?: boolean;
  };
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  overflow?: "visible" | "hidden" | "scroll";
  position?: "relative" | "absolute";

  // Appearance
  backgroundColor?: string;
  opacity?: number;
  borderRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  visible?: boolean;

  // Text (on Text elements)
  color?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold" | number;
  textAlign?: "left" | "center" | "right";
  lineHeight?: number;
}

// Each platform extends with platform-specific styles
interface WebStyle extends UniversalStyle {
  // Web-specific
  class?: string | string[] | Record<string, boolean>;
  cssText?: string;
  display?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gap?: number | string;  // CSS gap (extends universal)
  boxShadow?: string;
  transform?: string;
  transition?: string;
  animation?: string;
  cursor?: string;
  userSelect?: "none" | "text" | "all" | "auto";
  zIndex?: number;
  // ... full CSS property set
}

interface TuiStyle extends UniversalStyle {
  // TUI-specific
  fg?: string | number;      // foreground color (ANSI)
  bg?: string | number;      // background color (ANSI)
  bold?: boolean;
  underline?: boolean;
  blink?: boolean;
  inverse?: boolean;
  border?: "line" | "bg" | "none";
  label?: string;
  shadow?: boolean;
  scrollbar?: boolean;
}

interface MobileStyle extends UniversalStyle {
  // Mobile-specific
  shadowColor?: string;
  shadowOffset?: { width: number; height: number };
  shadowOpacity?: number;
  shadowRadius?: number;
  elevation?: number;       // Android shadow
  tintColor?: string;
  backfaceVisibility?: "visible" | "hidden";
}
```

Components using universal styles work everywhere:

```tsx
// This works on any platform
<Box style={{ padding: 8, flex: { direction: "row", gap: 4 }, backgroundColor: "#f0f0f0" }}>
  <Text style={{ fontSize: 16, fontWeight: "bold", color: "#333" }}>
    Hello
  </Text>
</Box>
```

Components using platform-specific styles only work on that platform:

```tsx
// Web-only — uses CSS-specific properties
<Box style={{ display: "grid", gridTemplateColumns: "1fr 1fr", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
  ...
</Box>
// Compile error on TUI/mobile: 'display', 'gridTemplateColumns', 'boxShadow' don't exist

// TUI-only — uses terminal-specific properties
<Box style={{ border: "line", fg: "green", bold: true }}>
  ...
</Box>
// Compile error on web/mobile: 'fg', 'bold', 'border' (as string) don't exist

// Mobile-only — uses native shadow properties
<Box style={{ elevation: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 2 } }}>
  ...
</Box>
// Compile error on web/TUI: 'elevation', 'shadowColor', 'shadowOffset' don't exist
```

**Accessibility attributes — platform-specific but with universal semantics:**

```ts
// Universal accessibility
interface UniversalAccessibility {
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "link" | "header" | "image" | "text" | "search" | "tab" | "list" | "listitem" | "checkbox" | "radio" | "switch" | "slider" | "progressbar" | "alert" | "dialog" | "menu" | "menuitem" | "timer" | "toolbar" | "none";
  accessibilityState?: {
    disabled?: boolean;
    selected?: boolean;
    checked?: boolean | "mixed";
    busy?: boolean;
    expanded?: boolean;
  };
}

// Web maps to ARIA attributes
// accessibilityLabel → aria-label
// accessibilityRole → role
// accessibilityState.disabled → aria-disabled
// accessibilityState.expanded → aria-expanded

// Mobile maps to native accessibility APIs
// accessibilityLabel → accessibilityLabel (direct)
// accessibilityRole → accessibilityRole (direct)

// TUI maps to terminal-specific behavior
// accessibilityLabel → used by screen readers that support terminal apps
// accessibilityRole → affects keyboard navigation behavior
```

**The full picture:**

```
Platform Layer (service)
├── Renderer        — how to create/modify/destroy nodes
├── Elements        — typed element definitions (attributes + events)
├── EventMapper     — normalize native events to universal events
├── StyleResolver   — translate universal styles to platform-specific
└── Accessibility   — map universal a11y to platform-specific APIs

Element Vocabulary
├── Universal: Box, Text, Input, Button, Image, List, ScrollView
│   └── typed attributes/events that work on all platforms
├── Web: Canvas, Video, Audio, IFrame, Form, Select, ...
│   └── web-specific attributes/events (MouseEvent, CSS, ARIA)
├── TUI: ProgressBar, Table, Log, Sparkline, ...
│   └── TUI-specific attributes/events (TuiKeyEvent, ANSI styles)
└── Mobile: FlatList, SafeAreaView, Modal, Switch, ...
    └── mobile-specific attributes/events (PressEvent, native styles)

JSX Type Resolution
├── jsxImportSource: "effect-atom-jsx/web"      → web element types
├── jsxImportSource: "effect-atom-jsx/tui"      → TUI element types
├── jsxImportSource: "effect-atom-jsx/mobile"   → mobile element types
└── jsxImportSource: "effect-atom-jsx/universal" → intersection types only

Component Requirements
├── Component.require(Platform)      — any platform
├── Component.require(Platform.Web)  — web only
├── Component.require(Platform.Tui)  — TUI only
├── Component.require(Platform.Mobile) — mobile only

Mount
├── Web:    layer includes WebPlatformLive
├── TUI:    layer includes TuiPlatformLive
├── Mobile: layer includes MobilePlatformLive
└── Test:   layer includes TestPlatformLive (no rendering)
```

Every attribute on every element is typed by the platform. Every event handler receives the platform's event type. Every style property is validated against the platform's style model. Platform-specific elements only exist in their platform's JSX namespace. Universal elements work everywhere with the intersection of all platforms' capabilities. The compiler enforces all of it.

The platform is a service. Elements are typed by that service. Events come from that service. Styles are validated by that service. Swapping the platform swaps everything — rendering, element types, event types, style types, accessibility mapping. The component code either uses universal elements (works everywhere) or platform-specific elements (compiler enforces the platform requirement). No runtime checks. No "this doesn't work on mobile" surprises. The types tell you exactly what works where.