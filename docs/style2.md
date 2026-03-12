Right. The style system already has typed tokens, slot targeting, and platform resolution. Complex CSS features are just more expressive style descriptions that flow through the same pipeline. The key is that our style objects are data — they describe what you want, and the platform renderer decides how to implement it.

**Nested selectors — targeting children and descendants of a slot:**

```ts
const navStyle = Style.make({
  root: Style.compose(
    padded("md"),
    Style.slot({ backgroundColor: "surface" }),

    // Nested: target children of this slot
    Style.nest({
      // Direct children
      "> a": {
        color: "text.link",
        textDecoration: "none",
        padding: ["xs", "sm"],
        borderRadius: "sm",
        transition: "fast",
      },
      // Hover on child links
      "> a:hover": {
        backgroundColor: "accent.subtle",
        color: "accent.default",
      },
      // Active link
      "> a[data-active]": {
        fontWeight: "bold",
        color: "accent.default",
        backgroundColor: "accent.subtle",
      },
      // Separator between items
      "> a + a": {
        marginLeft: "xs",
      },
    }),
  ),
});
```

`Style.nest` takes a record of selector → style. Selectors are relative to the element the slot is attached to. Token references still work inside nested selectors. The platform renderer compiles this to whatever mechanism it supports — CSS nested rules on web, manual child traversal on other platforms.

**The nesting can go deep:**

```ts
const tableStyle = Style.make({
  root: Style.compose(
    Style.slot({ width: "100%", borderCollapse: "collapse" }),

    Style.nest({
      thead: {
        backgroundColor: "surface",
        borderBottom: { width: 2, color: "border" },
      },
      "thead th": {
        padding: ["sm", "md"],
        textAlign: "left",
        fontWeight: "semibold",
        fontSize: "body.sm",
        color: "text.muted",
        textTransform: "uppercase",
        letterSpacing: 0.5,
      },
      "thead th:hover": {
        color: "text.primary",
        cursor: "pointer",
      },
      tbody: {},
      "tbody tr": {
        borderBottom: { width: 1, color: "border" },
        transition: "fast",
      },
      "tbody tr:hover": {
        backgroundColor: "accent.subtle",
      },
      "tbody tr:nth-child(even)": {
        backgroundColor: "background",
      },
      "tbody tr[data-selected]": {
        backgroundColor: "accent.subtle",
        borderLeft: { width: 3, color: "accent.default" },
      },
      "tbody td": {
        padding: ["sm", "md"],
        fontSize: "body.md",
        color: "text.primary",
      },
      "tbody td:first-child": {
        fontWeight: "medium",
      },
      tfoot: {
        borderTop: { width: 2, color: "border" },
      },
      "tfoot td": {
        padding: ["sm", "md"],
        fontSize: "body.sm",
        color: "text.muted",
      },
    }),
  ),
});
```

Every value is still a token reference or a typed style value. The selectors are strings, but the style values inside them are typed the same way as any other style in our system.

**Type-safe selectors via helpers:**

Raw selector strings are flexible but untyped. For common patterns, provide typed helpers:

```ts
Style.nest({
  // These are equivalent — one string, one typed
  "> a:hover": { color: "accent.default" },
  [Style.child("a", "hover")]: { color: "accent.default" },

  // Typed helpers for common selector patterns
  [Style.child("li")]: { padding: "sm" },
  [Style.child("li", "first-child")]: { paddingTop: 0 },
  [Style.child("li", "last-child")]: { paddingBottom: 0 },
  [Style.child("li", "nth-child", "odd")]: { backgroundColor: "background" },
  [Style.descendant("span")]: { color: "text.muted" },
  [Style.sibling("+ div")]: { marginTop: "sm" },
  [Style.attr("data-active")]: { fontWeight: "bold" },
  [Style.attr("data-status", "error")]: { color: "danger.default" },
  [Style.not("[disabled]")]: { cursor: "pointer" },
  [Style.is("a", "button")]: { textDecoration: "underline" },
})
```

The helpers produce selector strings but provide autocomplete and validation:

```ts
declare namespace Style {
  function child(tag: string, pseudo?: PseudoClass, arg?: string): string;
  function descendant(tag: string, pseudo?: PseudoClass): string;
  function sibling(selector: string): string;
  function attr(name: string, value?: string): string;
  function not(selector: string): string;
  function is(...selectors: string[]): string;
}

type PseudoClass =
  | "hover" | "focus" | "focus-visible" | "focus-within"
  | "active" | "visited" | "disabled" | "enabled"
  | "checked" | "indeterminate"
  | "first-child" | "last-child" | "only-child"
  | "first-of-type" | "last-of-type"
  | "nth-child" | "nth-last-child" | "nth-of-type"
  | "empty" | "not" | "is" | "where" | "has"
  | "placeholder-shown" | "required" | "optional" | "valid" | "invalid"
  | "read-only" | "read-write"
  | "before" | "after" | "first-line" | "first-letter"
  | "selection" | "placeholder" | "marker";
```

**CSS custom properties / variables:**

Custom properties are how themes propagate through CSS. Our token system already does this conceptually — token references resolve to values. But we should also support explicit CSS custom properties for cases where you want the cascading behavior:

```ts
const componentStyle = Style.make({
  root: Style.compose(
    // Declare custom properties on this element
    Style.vars({
      "--card-padding": "md",           // token reference → resolved value
      "--card-radius": "lg",
      "--card-bg": "surface",
      "--card-border": "border",
      "--card-shadow": "md",
    }),

    // Use the custom properties
    Style.slot({
      padding: "var(--card-padding)",
      borderRadius: "var(--card-radius)",
      backgroundColor: "var(--card-bg)",
      border: { width: 1, color: "var(--card-border)" },
      shadow: "var(--card-shadow)",
    }),
  ),

  header: Style.slot({
    // Inherits --card-padding from root
    padding: "var(--card-padding)",
    borderBottom: { width: 1, color: "var(--card-border)" },
  }),
});
```

`Style.vars` declares CSS custom properties. Token references inside vars are resolved at render time through the Theme service. The properties cascade to children just like regular CSS custom properties.

The power: consumers can override custom properties without touching the component's internal styles:

```ts
// Override a component's custom properties from outside
const customCard = Style.override({
  "card.root": Style.vars({
    "--card-padding": "xl",        // bigger padding
    "--card-radius": "none",       // sharp corners
    "--card-bg": "background",     // different background
  }),
});

<Style.Provider overrides={customCard}>
  <Card>...</Card>
  {/* The Card's internal styles that reference these vars all update */}
</Style.Provider>
```

This is the CSS custom properties pattern but typed. Token references in vars are validated against the theme. Property names are strings (custom properties are inherently dynamic), but the values they resolve to are typed.

**Reactive custom properties — dynamic theming:**

```ts
const dynamicVars = Style.vars({
  "--accent-hue": () => hueAtom(),           // reactive
  "--accent": () => `hsl(${hueAtom()}, 70%, 50%)`,
  "--accent-subtle": () => `hsl(${hueAtom()}, 70%, 95%)`,
  "--content-width": () => isWide() ? "1200px" : "800px",
});
```

When `hueAtom` changes, only the CSS custom properties update. Every element that references `--accent` through `var()` automatically picks up the new value. Zero JavaScript re-renders — CSS handles the cascading. This is the most efficient possible update path on web.

**Animations — keyframes and transitions:**

Keyframe animations as typed data:

```ts
const fadeIn = Style.keyframes("fadeIn", {
  from: {
    opacity: 0,
    transform: { translateY: 8 },
  },
  to: {
    opacity: 1,
    transform: { translateY: 0 },
  },
});

const slideIn = Style.keyframes("slideIn", {
  "0%": {
    transform: { translateX: -20 },
    opacity: 0,
  },
  "60%": {
    transform: { translateX: 4 },
    opacity: 1,
  },
  "100%": {
    transform: { translateX: 0 },
    opacity: 1,
  },
});

const pulse = Style.keyframes("pulse", {
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.5 },
});

const shimmer = Style.keyframes("shimmer", {
  "0%": {
    backgroundPosition: "-200% 0",
  },
  "100%": {
    backgroundPosition: "200% 0",
  },
});

const spin = Style.keyframes("spin", {
  from: { transform: { rotate: 0 } },
  to: { transform: { rotate: 360 } },
});
```

Transform values are typed objects instead of CSS strings:

```ts
interface TransformValue {
  translateX?: number | string;
  translateY?: number | string;
  translateZ?: number | string;
  rotate?: number;        // degrees
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  perspective?: number;
}
```

On web, `{ translateY: 8, rotate: 45, scale: 1.1 }` compiles to `translateY(8px) rotate(45deg) scale(1.1)`. On mobile, it maps to native Animated transforms. The typed object is more composable than CSS transform strings — you can merge two transform objects without string parsing.

**Using animations in styles:**

```ts
const skeletonStyle = Style.compose(
  rounded("md"),
  Style.slot({
    backgroundColor: "border",
    backgroundImage: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
    backgroundSize: "200% 100%",
    animation: Style.animate(shimmer, {
      duration: "1.5s",
      timing: "ease-in-out",
      iteration: "infinite",
    }),
  }),
);

const spinnerStyle = Style.compose(
  Style.slot({
    width: 24,
    height: 24,
    border: { width: 3, color: "border" },
    borderTop: { width: 3, color: "accent.default" },
    borderRadius: "full",
    animation: Style.animate(spin, {
      duration: "0.8s",
      timing: "linear",
      iteration: "infinite",
    }),
  }),
);

const toastEnter = Style.animate(fadeIn, {
  duration: "normal",
  timing: "ease-out",
  fill: "forwards",
});

const toastExit = Style.animate(fadeIn, {
  duration: "fast",
  timing: "ease-in",
  direction: "reverse",
  fill: "forwards",
});
```

Duration values use theme tokens: `"fast"`, `"normal"`, `"slow"` resolve through the Theme service to millisecond values.

**Transition styles — declarative transitions on property changes:**

```ts
const cardStyle = Style.compose(
  Style.slot({
    backgroundColor: "surface",
    shadow: "sm",
    transform: { scale: 1 },
  }),

  // Transition specific properties when they change
  Style.transition({
    backgroundColor: { duration: "fast", timing: "ease" },
    shadow: { duration: "normal", timing: "ease-out" },
    transform: { duration: "fast", timing: "ease" },
  }),

  // State-driven changes will animate
  Style.states({
    hover: {
      shadow: "md",
      transform: { scale: 1.02 },
    },
    active: {
      shadow: "sm",
      transform: { scale: 0.98 },
    },
  }),
);
```

When the element enters hover state, `shadow` transitions from `sm` to `md` over `"normal"` duration, and `transform` scales from 1 to 1.02 over `"fast"` duration. Each property can have its own transition timing. No CSS string concatenation.

**Enter/exit animations tied to component lifecycle:**

```ts
const listItemStyle = Style.compose(
  padded("sm"),
  rounded("sm"),

  // Animate when the element enters the DOM
  Style.enter(Style.animate(fadeIn, {
    duration: "normal",
    timing: "ease-out",
  })),

  // Animate when the element leaves the DOM
  Style.exit(Style.animate(fadeIn, {
    duration: "fast",
    timing: "ease-in",
    direction: "reverse",
  })),

  // Staggered entry for list items
  Style.enterStagger({
    delay: (index) => index * 50,  // 50ms between each item
    animation: Style.animate(slideIn, {
      duration: "normal",
      timing: "ease-out",
    }),
  }),
);
```

`Style.enter` and `Style.exit` hook into the component/element lifecycle. When a `For` loop adds items, each new item plays the enter animation. When items are removed, they play the exit animation before being removed from the DOM. The framework holds the removal until the exit animation completes.

`Style.enterStagger` is specifically for list items — each successive item's entry is delayed by an offset. The `index` parameter is the item's position in the list.

**Layout animations — animating position changes:**

```ts
const listStyle = Style.compose(
  flexCol({ gap: "sm" }),

  // When children reorder, animate their position
  Style.layoutAnimation({
    duration: "normal",
    timing: "ease-out",
  }),
);
```

`Style.layoutAnimation` uses FLIP (First, Last, Invert, Play) to animate elements when their position changes — sorting, reordering, filtering. On web, this uses the Web Animations API or CSS `view-transition`. The style system captures the element's position before and after the change and generates the animation.

**Complex selectors — container queries, media queries, supports:**

```ts
const responsiveCard = Style.compose(
  padded("md"),
  rounded("md"),

  // Container query — style based on parent container size
  Style.container("card-container", {
    // When the container is narrow
    "(max-width: 400px)": {
      padding: "sm",
      fontSize: "body.sm",

      // Nested selectors inside container queries
      ...Style.nest({
        ".card-actions": {
          flexDirection: "column",
          gap: "xs",
        },
      }),
    },
    // When the container is wide
    "(min-width: 800px)": {
      padding: "xl",
      flexDirection: "row",
    },
  }),

  // Media query
  Style.media({
    "(prefers-reduced-motion: reduce)": {
      transition: "none",
      animation: "none",
    },
    "(prefers-color-scheme: dark)": {
      // Override specific values for dark mode
      // (usually handled by theme, but sometimes you need media query)
      backgroundColor: "rgba(0,0,0,0.8)",
    },
    "(prefers-contrast: high)": {
      border: { width: 2, color: "text.primary" },
      fontWeight: "bold",
    },
    "(hover: none)": {
      // Touch devices — no hover states
      ...Style.nest({
        "a:hover, button:hover": {
          backgroundColor: "transparent",
        },
      }),
    },
    print: {
      shadow: "none",
      border: { width: 1, color: "black" },
      backgroundColor: "white",
      color: "black",
    },
  }),

  // Feature query
  Style.supports({
    "(display: grid)": {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
      gap: "md",
    },
    "not (display: grid)": {
      display: "flex",
      flexWrap: "wrap",
    },
    "(backdrop-filter: blur(1px))": {
      backdropFilter: "blur(8px)",
      backgroundColor: "rgba(255,255,255,0.8)",
    },
  }),
);
```

Each of these compiles to the corresponding CSS at-rule. The style values inside them are still typed and token-resolved.

**Typed container queries with named containers:**

```ts
// Declare a container on a slot
const layoutStyle = Style.make({
  sidebar: Style.compose(
    Style.containerType("sidebar", "inline-size"),
    // This element is a container named "sidebar"
  ),
  content: Style.compose(
    Style.containerType("content", "inline-size"),
  ),
});

// Query the container by name
const sidebarWidget = Style.compose(
  Style.containerQuery("sidebar", {
    "(max-width: 250px)": {
      // Compact mode when sidebar is narrow
      fontSize: "body.xs",
      padding: "xs",
      ...Style.nest({
        ".widget-title": { display: "none" },
        ".widget-icon": { width: 16, height: 16 },
      }),
    },
    "(min-width: 400px)": {
      // Expanded mode
      padding: "md",
      ...Style.nest({
        ".widget-actions": {
          display: "flex",
          gap: "sm",
        },
      }),
    },
  }),
);
```

**CSS grid — typed grid definitions:**

```ts
const dashboardLayout = Style.compose(
  Style.grid({
    template: {
      columns: ["240px", "1fr", "300px"],
      rows: ["auto", "1fr", "auto"],
      areas: [
        ["sidebar", "header",  "header"],
        ["sidebar", "content", "aside"],
        ["sidebar", "footer",  "footer"],
      ],
    },
    gap: { row: "md", column: "lg" },
  }),

  // Responsive grid
  Style.media({
    "(max-width: 768px)": Style.grid({
      template: {
        columns: ["1fr"],
        rows: ["auto", "auto", "1fr", "auto", "auto"],
        areas: [
          ["header"],
          ["sidebar"],
          ["content"],
          ["aside"],
          ["footer"],
        ],
      },
      gap: "sm",
    }),
  }),
);

// Place children in grid areas
const headerStyle = Style.slot({ gridArea: "header" });
const sidebarStyle = Style.slot({ gridArea: "sidebar" });
const contentStyle = Style.slot({ gridArea: "content" });
const asideStyle = Style.slot({ gridArea: "aside" });
const footerStyle = Style.slot({ gridArea: "footer" });
```

Grid areas are typed. If you reference an area that doesn't exist in the template:

```ts
Style.slot({ gridArea: "nonexistent" });
// If using typed grid: Error — "nonexistent" is not a defined grid area
```

For typed grid areas, define the grid with a type parameter:

```ts
const dashboardGrid = Style.grid({
  template: {
    columns: ["240px", "1fr", "300px"],
    rows: ["auto", "1fr", "auto"],
    areas: [
      ["sidebar", "header",  "header"],
      ["sidebar", "content", "aside"],
      ["sidebar", "footer",  "footer"],
    ] as const,  // const assertion preserves literal types
  },
});

// TypeScript knows the valid areas
type DashboardArea = Style.GridAreas<typeof dashboardGrid>;
// "sidebar" | "header" | "content" | "aside" | "footer"

Style.slot({ gridArea: "sidebar" as DashboardArea }); // OK
Style.slot({ gridArea: "nonexistent" as DashboardArea }); // Error
```

**CSS layers — cascade layering:**

```ts
// Define cascade layers for style precedence control
const layers = Style.layers([
  "reset",       // lowest priority
  "base",
  "components",
  "utilities",
  "overrides",   // highest priority
]);

// Assign styles to layers
const resetStyles = Style.inLayer("reset", Style.global({
  "*": { margin: 0, padding: 0, boxSizing: "border-box" },
  "html": { fontSize: 16, lineHeight: 1.5 },
}));

const baseStyles = Style.inLayer("base", Style.global({
  body: { fontFamily: "system-ui", color: "text.primary", backgroundColor: "background" },
  a: { color: "text.link", textDecoration: "none" },
  "a:hover": { textDecoration: "underline" },
}));

// Component styles automatically go in the "components" layer
const buttonStyle = Style.inLayer("components", buttonVariants);

// Utility overrides go in "utilities" layer
const utilityPadding = Style.inLayer("utilities", padded("lg"));
```

CSS `@layer` ensures that utilities always beat components, components always beat base, regardless of specificity. This eliminates the biggest pain point of CSS — specificity wars.

**Global styles and CSS reset:**

```ts
// Global styles — applied once, not per component
const globalStyles = Style.global({
  // CSS reset
  "*, *::before, *::after": {
    boxSizing: "border-box",
    margin: 0,
    padding: 0,
  },

  html: {
    fontSize: 16,
    lineHeight: 1.5,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  },

  body: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "text.primary",
    backgroundColor: "background",
  },

  // Typography defaults
  "h1, h2, h3, h4, h5, h6": {
    fontWeight: "bold",
    lineHeight: 1.2,
  },
  h1: { fontSize: "display.lg" },
  h2: { fontSize: "display.sm" },
  h3: { fontSize: "heading.lg" },
  h4: { fontSize: "heading.md" },
  h5: { fontSize: "heading.sm" },

  // Link defaults
  a: {
    color: "text.link",
    textDecoration: "none",
    transition: "fast",
  },
  "a:hover": {
    textDecoration: "underline",
    color: "accent.hover",
  },

  // Focus visible for keyboard navigation
  ":focus-visible": {
    outline: { width: 2, color: "accent.default", style: "solid" },
    outlineOffset: 2,
  },

  // Reduced motion
  "@media (prefers-reduced-motion: reduce)": {
    "*, *::before, *::after": {
      animationDuration: "0.01ms !important",
      animationIterationCount: "1 !important",
      transitionDuration: "0.01ms !important",
      scrollBehavior: "auto !important",
    },
  },

  // Selection
  "::selection": {
    backgroundColor: "accent.subtle",
    color: "text.primary",
  },

  // Scrollbar (webkit)
  "::-webkit-scrollbar": {
    width: 8,
    height: 8,
  },
  "::-webkit-scrollbar-track": {
    backgroundColor: "background",
  },
  "::-webkit-scrollbar-thumb": {
    backgroundColor: "border",
    borderRadius: "full",
  },
  "::-webkit-scrollbar-thumb:hover": {
    backgroundColor: "text.muted",
  },
});

// Apply global styles via a layer
Component.mount(App, {
  layer: Layer.mergeAll(
    AppLive,
    Theme.Light,
    Style.globalLayer(globalStyles),
    WebPlatform,
  ),
  target: root,
});
```

`Style.globalLayer` creates a Layer that applies global styles when provided. The styles are resolved through the Theme service — token references in global styles are resolved the same way as in component styles. When the theme changes (light → dark), global styles update too because the token values change.

**Pseudo-elements — before, after, marker, placeholder:**

```ts
const fancyLink = Style.compose(
  Style.slot({
    position: "relative",
    color: "text.link",
    textDecoration: "none",
  }),

  Style.pseudo({
    "::after": {
      content: '""',
      position: "absolute",
      bottom: 0,
      left: 0,
      width: "100%",
      height: 2,
      backgroundColor: "accent.default",
      transform: { scaleX: 0 },
      transformOrigin: "right",
      transition: {
        transform: { duration: "normal", timing: "ease-out" },
      },
    },
    ":hover::after": {
      transform: { scaleX: 1 },
      transformOrigin: "left",
    },
    "::before": {
      content: '"→ "',
      opacity: 0,
      transition: {
        opacity: { duration: "fast" },
      },
    },
    ":hover::before": {
      opacity: 1,
    },
  }),
);

const inputStyle = Style.compose(
  Style.pseudo({
    "::placeholder": {
      color: "text.muted",
      fontStyle: "italic",
    },
    ":focus::placeholder": {
      opacity: 0.5,
    },
  }),
);

const listMarker = Style.compose(
  Style.pseudo({
    "::marker": {
      color: "accent.default",
      fontWeight: "bold",
    },
  }),
);
```

**Complex real-world example — a full form style:**

```ts
const formRecipe = Style.recipe({
  slots: [
    "form", "fieldGroup", "field", "label",
    "input", "textarea", "select",
    "error", "hint", "counter",
    "actions", "submitButton", "cancelButton",
  ],

  base: {
    form: Style.compose(
      flexCol({ gap: "lg" }),
      Style.slot({ width: "100%", maxWidth: 600 }),
    ),

    fieldGroup: Style.compose(
      flexCol({ gap: "md" }),
      padded("md"),
      rounded("md"),
      bordered(),
      Style.slot({ backgroundColor: "surface" }),
    ),

    field: Style.compose(
      flexCol({ gap: "xs" }),
      Style.slot({ position: "relative" }),
    ),

    label: Style.compose(
      textStyle({ size: "body.sm", weight: "medium", color: "text.primary" }),
      Style.nest({
        // Required field indicator
        "&[data-required]::after": {
          content: '" *"',
          color: "danger.default",
        },
      }),
    ),

    input: Style.compose(
      padded(["sm", "md"]),
      rounded("md"),
      bordered(),
      textStyle({ size: "body.md", color: "text.primary" }),
      Style.slot({
        width: "100%",
        backgroundColor: "surface",
        transition: "fast",
      }),
      Style.pseudo({
        "::placeholder": { color: "text.muted" },
        ":focus": {
          border: { width: 2, color: "accent.default" },
          outline: "none",
        },
      }),
      Style.nest({
        "&[data-invalid]": {
          border: { width: 2, color: "danger.default" },
        },
        "&[data-invalid]:focus": {
          border: { width: 2, color: "danger.default" },
          shadow: { x: 0, y: 0, blur: 0, spread: 3, color: "danger.subtle" },
        },
        "&:disabled": {
          opacity: 0.5,
          cursor: "not-allowed",
          backgroundColor: "background",
        },
      }),
    ),

    textarea: Style.compose(
      // Inherits input styles
      Style.extends("input"),
      Style.slot({
        minHeight: 100,
        resize: "vertical",
      }),
    ),

    select: Style.compose(
      Style.extends("input"),
      Style.slot({ cursor: "pointer" }),
      Style.pseudo({
        // Custom dropdown arrow
        "::after": {
          content: '"▾"',
          position: "absolute",
          right: 12,
          top: "50%",
          transform: { translateY: "-50%" },
          color: "text.muted",
          pointerEvents: "none",
        },
      }),
    ),

    error: Style.compose(
      textStyle({ size: "body.xs", color: "danger.default" }),
      Style.slot({ minHeight: 20 }),
      Style.enter(Style.animate(fadeIn, { duration: "fast" })),
    ),

    hint: textStyle({ size: "body.xs", color: "text.muted" }),

    counter: Style.compose(
      textStyle({ size: "body.xs", color: "text.muted", align: "right" }),
      Style.nest({
        "&[data-near-limit]": { color: "danger.default", fontWeight: "semibold" },
      }),
    ),

    actions: Style.compose(
      flexRow({ gap: "sm", justify: "end" }),
      padded(["md", 0, 0, 0]),
      Style.slot({ borderTop: { width: 1, color: "border" } }),
    ),

    submitButton: buttonVariants({ intent: "primary", size: "md" }),
    cancelButton: buttonVariants({ intent: "ghost", size: "md" }),
  },

  variants: {
    layout: {
      vertical: {
        field: flexCol({ gap: "xs" }),
      },
      horizontal: {
        field: Style.compose(
          flexRow({ gap: "md", align: "center" }),
          Style.nest({
            // Label takes fixed width in horizontal layout
            "> label": { width: 120, textAlign: "right", flexShrink: 0 },
            // Input fills remaining space
            "> input, > textarea, > select": { flex: { grow: 1 } },
          }),
        ),
      },
      inline: {
        form: flexRow({ gap: "md", align: "end" }),
        field: flexRow({ gap: "xs", align: "center" }),
        actions: Style.slot({ borderTop: "none", paddingTop: 0 }),
      },
    },
    density: {
      comfortable: {
        fieldGroup: padded("lg"),
        field: Style.slot({ marginBottom: "md" }),
      },
      compact: {
        fieldGroup: padded("sm"),
        field: Style.slot({ marginBottom: "xs" }),
        input: padded(["xs", "sm"]),
        label: textStyle({ size: "body.xs" }),
      },
    },
  },

  defaults: {
    layout: "vertical",
    density: "comfortable",
  },
});
```

**How this all compiles on web:**

The platform renderer takes the resolved style tree and produces CSS. Static styles become CSS classes (generated at build time or runtime). Reactive styles become CSS custom properties. Animations become `@keyframes` rules. Nested selectors become nested CSS rules. Container queries become `@container` rules. The output is standard CSS — the style system is a typed abstraction over it, not a replacement for it.

```ts
// What the web renderer produces from our style definitions:

// Token-based CSS custom properties (from theme)
:root {
  --color-surface: #ffffff;
  --color-text-primary: #1a1a1a;
  --color-accent-default: #3b82f6;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --radius-md: 8px;
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
  --transition-fast: 150ms ease;
  /* ... all tokens */
}

// Generated class from Style.compose(padded("md"), rounded("md"), elevated("md"))
.s_a1b2c3 {
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

// Nested selectors from Style.nest
.s_d4e5f6 > a {
  color: var(--color-text-link);
  text-decoration: none;
}
.s_d4e5f6 > a:hover {
  background-color: var(--color-accent-subtle);
}

// Keyframes from Style.keyframes
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

// Container query from Style.containerQuery
@container sidebar (max-width: 250px) {
  .s_g7h8i9 { font-size: var(--fontSize-body-xs); padding: var(--spacing-xs); }
}

// Media query from Style.media
@media (prefers-reduced-motion: reduce) {
  .s_j0k1l2 { transition: none; animation: none; }
}
```

The style system doesn't invent a new styling model. It's a typed, composable, platform-agnostic layer over whatever styling the platform provides. On web, that's CSS. On mobile, that's StyleSheet. On TUI, that's blessed styles. The same style definitions produce different output per platform, but the developer writes the same typed, token-based, composable style code everywhere.

**What you don't lose:**

Full CSS expressiveness — nested selectors, pseudo-elements, container queries, media queries, grid, animations, custom properties, cascade layers. It's all there.

What you gain: type-safe tokens, composable utilities, variant systems, slot-targeted styles, reactive values, platform abstraction, and the ability to swap themes by swapping a layer. All without learning a new styling model — if you know CSS concepts, you know this system. The typed layer just prevents mistakes and adds composability.