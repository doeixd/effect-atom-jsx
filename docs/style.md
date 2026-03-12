The insight is the same one that made behaviors work. The view exposes named element slots. Behaviors attach interaction to those slots. Styles attach appearance to those slots. Both compose from outside the view. Both are type-safe. Both are small composable pieces.

**The parallel:**

```
Behavior.attach → attaches handlers, ARIA, state to element slots
Style.attach    → attaches colors, spacing, layout, typography to element slots
```

A view is a skeleton. Behaviors give it life. Styles give it skin. All three compose independently.

**Style as typed operations on element slots:**

```ts
// A style composition targets named slots and applies visual properties
const cardStyle = Style.make({
  root: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: "surface",
    border: { width: 1, color: "border" },
    shadow: { x: 0, y: 2, blur: 8, color: "shadow" },
  },
  header: {
    padding: [0, 0, 12, 0],
    borderBottom: { width: 1, color: "border" },
  },
  title: {
    fontSize: "heading.sm",
    fontWeight: "bold",
    color: "text.primary",
  },
  body: {
    padding: [12, 0, 0, 0],
    color: "text.secondary",
    fontSize: "body.md",
    lineHeight: 1.5,
  },
});
```

The values aren't raw CSS. `"surface"`, `"border"`, `"text.primary"`, `"heading.sm"` are token references. They resolve through a theme service.

**Tokens as a typed service:**

```ts
class Theme extends Effect.Tag("Theme")<Theme, {
  readonly tokens: ThemeTokens;
  readonly resolve: (token: string) => string;
  readonly mode: ReadonlyAtom<"light" | "dark">;
}>() {}

// Tokens are a typed tree
interface ThemeTokens {
  color: {
    surface: string;
    background: string;
    border: string;
    shadow: string;
    text: {
      primary: string;
      secondary: string;
      muted: string;
      inverse: string;
      link: string;
      error: string;
      success: string;
    };
    accent: {
      default: string;
      hover: string;
      active: string;
      subtle: string;
    };
    danger: {
      default: string;
      hover: string;
      active: string;
      subtle: string;
    };
  };
  spacing: {
    xs: number;   // 4
    sm: number;   // 8
    md: number;   // 16
    lg: number;   // 24
    xl: number;   // 32
    "2xl": number; // 48
  };
  fontSize: {
    "body.xs": number;
    "body.sm": number;
    "body.md": number;
    "body.lg": number;
    "heading.sm": number;
    "heading.md": number;
    "heading.lg": number;
    "heading.xl": number;
    "display.sm": number;
    "display.lg": number;
  };
  fontWeight: {
    normal: number;
    medium: number;
    semibold: number;
    bold: number;
  };
  radius: {
    none: number;
    sm: number;
    md: number;
    lg: number;
    full: number;
  };
  shadow: {
    sm: ShadowDef;
    md: ShadowDef;
    lg: ShadowDef;
    xl: ShadowDef;
  };
  transition: {
    fast: string;
    normal: string;
    slow: string;
  };
  breakpoint: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
}
```

The token path strings in style definitions are type-checked against the token tree:

```ts
// Style values accept token paths or raw values
type StyleColor = TokenPath<"color"> | string;
// TokenPath<"color"> = "surface" | "background" | "border" | "shadow"
//                    | "text.primary" | "text.secondary" | "text.muted" | ...
//                    | "accent.default" | "accent.hover" | ...
//                    | "danger.default" | ...

type StyleSpacing = TokenPath<"spacing"> | number;
// TokenPath<"spacing"> = "xs" | "sm" | "md" | "lg" | "xl" | "2xl"

type StyleFontSize = TokenPath<"fontSize"> | number;
// TokenPath<"fontSize"> = "body.xs" | "body.sm" | ... | "heading.sm" | ...
```

If you misspell a token:

```ts
Style.make({
  root: {
    backgroundColor: "surfce",  // Error: "surfce" is not a valid TokenPath<"color">
    fontSize: "body.xxl",       // Error: "body.xxl" is not a valid TokenPath<"fontSize">
  },
});
```

**Attaching styles to components — same as behaviors:**

```tsx
const Card = Component.make(
  Component.props<{ title: string; children: ViewNode }>(),
  Component.require(),
  (props) => Effect.succeed({}),
  (props) => (
    <Box slot="root">
      <Box slot="header">
        <Text slot="title">{props.title}</Text>
      </Box>
      <Box slot="body">{props.children}</Box>
    </Box>
  ),
);

// Attach style from outside — same pattern as Behavior.attach
const StyledCard = Card.pipe(
  Style.attach(cardStyle),
);
```

`Style.attach` maps style keys to slot names. If the style references a slot that doesn't exist on the component, compile error:

```ts
const badStyle = Style.make({
  root: { padding: 16 },
  footer: { padding: 8 },  // "footer" slot doesn't exist on Card
});

Card.pipe(Style.attach(badStyle));
// Error: Style references slot 'footer' which does not exist on Card.
// Available slots: root, header, title, body
```

**Small composable style pieces — like Tailwind utilities:**

Instead of one monolithic style, compose small style pieces:

```ts
// Atomic style utilities
const padded = (amount: StyleSpacing) =>
  Style.slot({ padding: amount });

const rounded = (amount: TokenPath<"radius">) =>
  Style.slot({ borderRadius: amount });

const elevated = (level: "sm" | "md" | "lg" | "xl") =>
  Style.slot({ shadow: level });

const bordered = (options?: { width?: number; color?: StyleColor }) =>
  Style.slot({
    border: {
      width: options?.width ?? 1,
      color: options?.color ?? "border",
    },
  });

const textStyle = (options: {
  size?: StyleFontSize;
  weight?: TokenPath<"fontWeight">;
  color?: StyleColor;
  align?: "left" | "center" | "right";
}) =>
  Style.slot({
    fontSize: options.size,
    fontWeight: options.weight,
    color: options.color,
    textAlign: options.align,
  });

const flexRow = (options?: { gap?: StyleSpacing; align?: string; justify?: string }) =>
  Style.slot({
    flex: {
      direction: "row",
      gap: options?.gap,
      align: options?.align,
      justify: options?.justify,
    },
  });

const flexCol = (options?: { gap?: StyleSpacing; align?: string; justify?: string }) =>
  Style.slot({
    flex: {
      direction: "column",
      gap: options?.gap,
      align: options?.align,
      justify: options?.justify,
    },
  });

const interactive = Style.slot({
  cursor: "pointer",
  transition: "fast",
});

const truncated = Style.slot({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
```

Compose them onto specific slots:

```ts
const cardStyle = Style.make({
  root: Style.compose(
    padded("md"),
    rounded("md"),
    elevated("md"),
    bordered(),
    Style.slot({ backgroundColor: "surface" }),
  ),
  header: Style.compose(
    padded([0, 0, "sm", 0]),
    bordered({ width: 0 }),
    Style.slot({ borderBottom: { width: 1, color: "border" } }),
  ),
  title: Style.compose(
    textStyle({ size: "heading.sm", weight: "bold", color: "text.primary" }),
  ),
  body: Style.compose(
    padded(["sm", 0, 0, 0]),
    textStyle({ size: "body.md", color: "text.secondary" }),
  ),
});
```

`Style.compose` merges style pieces for a single slot. Later pieces override earlier ones for the same property. This is exactly Tailwind's composition model but type-safe:

```
Tailwind:  className="p-4 rounded-md shadow-md border bg-surface"
This:      Style.compose(padded("md"), rounded("md"), elevated("md"), bordered(), bg("surface"))
```

Same granularity. Same composability. But type-checked token values, slot-targeted, and renderable on any platform.

**Dynamic styles — factories with reactive values:**

Style pieces can be functions that accept reactive values:

```ts
// A style factory that produces reactive styles
const selectedStyle = (isSelected: () => boolean) =>
  Style.slot({
    backgroundColor: () => isSelected() ? "accent.subtle" : "surface",
    border: {
      width: () => isSelected() ? 2 : 1,
      color: () => isSelected() ? "accent.default" : "border",
    },
  });

const disabledStyle = (isDisabled: () => boolean) =>
  Style.slot({
    opacity: () => isDisabled() ? 0.5 : 1,
    cursor: () => isDisabled() ? "not-allowed" : "pointer",
    pointerEvents: () => isDisabled() ? "none" : "auto",
  });

const loadingStyle = (isLoading: () => boolean) =>
  Style.slot({
    opacity: () => isLoading() ? 0.7 : 1,
    animation: () => isLoading() ? "pulse" : "none",
  });

const hoverStyle = (options: { backgroundColor?: StyleColor; scale?: number }) =>
  Style.states({
    hover: {
      backgroundColor: options.backgroundColor ?? "accent.subtle",
      transform: options.scale ? `scale(${options.scale})` : undefined,
    },
  });
```

Use in composition:

```ts
// Inside a component setup — styles react to state
(props) => Effect.gen(function* () {
  const sel = yield* selection();
  const loading = yield* Component.derived(() => Result.isLoading(data()));

  const itemStyle = (item: Item) => Style.compose(
    padded("sm"),
    rounded("sm"),
    interactive,
    selectedStyle(() => sel.isSelected(item)),
    disabledStyle(() => item.archived),
    hoverStyle({ backgroundColor: "accent.subtle" }),
  );

  return { sel, itemStyle };
}),

(props, { sel, itemStyle }) => (
  <Box slot="list">
    <For each={items}>
      {(item) => (
        <Box slot="item" style={itemStyle(item())}>
          <Text>{item().name}</Text>
        </Box>
      )}
    </For>
  </Box>
),
```

The reactive functions (`() => isSelected() ? ...`) subscribe via `Reactivity`. When selection state changes, only the affected style properties update on the affected elements. No re-render of the entire list — just the specific CSS properties on the specific elements that changed.

**State-based styles — hover, focus, active, disabled:**

```ts
const buttonStates = Style.states({
  default: {
    backgroundColor: "accent.default",
    color: "text.inverse",
    padding: ["sm", "md"],
    borderRadius: "md",
    fontWeight: "semibold",
    transition: "fast",
  },
  hover: {
    backgroundColor: "accent.hover",
  },
  active: {
    backgroundColor: "accent.active",
    transform: "scale(0.98)",
  },
  focus: {
    outline: { width: 2, color: "accent.default", offset: 2 },
  },
  disabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
});
```

`Style.states` defines style variations for interaction states. The renderer maps these to the appropriate mechanism — CSS pseudo-classes on web, state tracking on TUI, Pressable state callbacks on mobile.

On web, `Style.states` might compile to:

```css
.btn { background: var(--accent-default); color: var(--text-inverse); ... }
.btn:hover { background: var(--accent-hover); }
.btn:active { background: var(--accent-active); transform: scale(0.98); }
.btn:focus-visible { outline: 2px solid var(--accent-default); outline-offset: 2px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
```

On TUI, hover doesn't exist, but focus and active are tracked via keyboard state. On mobile, hover doesn't exist, but pressed/focused states map to Pressable callbacks.

The platform renderer handles the translation. The style definition is platform-agnostic.

**Responsive styles — breakpoint-aware composition:**

```ts
const responsivePadding = Style.responsive({
  base: padded("sm"),
  sm: padded("md"),
  md: padded("lg"),
  lg: padded("xl"),
});

const responsiveLayout = Style.responsive({
  base: flexCol({ gap: "sm" }),
  md: flexRow({ gap: "md" }),
});

const responsiveText = Style.responsive({
  base: textStyle({ size: "body.sm" }),
  md: textStyle({ size: "body.md" }),
  lg: textStyle({ size: "body.lg" }),
});

// Compose responsive styles
const cardStyle = Style.make({
  root: Style.compose(
    responsivePadding,
    rounded("md"),
    elevated("md"),
    bordered(),
  ),
  content: Style.compose(
    responsiveLayout,
    responsiveText,
  ),
});
```

`Style.responsive` creates a style that changes based on viewport/container size. Breakpoint values come from the theme tokens. On web, this compiles to media queries. On TUI, it uses terminal dimensions. On mobile, it uses Dimensions API.

**Variant styles — like CVA (Class Variance Authority) but typed:**

```ts
const buttonVariants = Style.variants({
  // Base styles applied to all variants
  base: Style.compose(
    padded(["sm", "md"]),
    rounded("md"),
    textStyle({ weight: "semibold" }),
    Style.slot({ transition: "fast", cursor: "pointer" }),
  ),

  // Variant axes
  variants: {
    intent: {
      primary: Style.compose(
        Style.slot({ backgroundColor: "accent.default", color: "text.inverse" }),
        Style.states({
          hover: { backgroundColor: "accent.hover" },
          active: { backgroundColor: "accent.active" },
        }),
      ),
      secondary: Style.compose(
        Style.slot({ backgroundColor: "surface", color: "text.primary" }),
        bordered(),
        Style.states({
          hover: { backgroundColor: "accent.subtle" },
        }),
      ),
      danger: Style.compose(
        Style.slot({ backgroundColor: "danger.default", color: "text.inverse" }),
        Style.states({
          hover: { backgroundColor: "danger.hover" },
          active: { backgroundColor: "danger.active" },
        }),
      ),
      ghost: Style.compose(
        Style.slot({ backgroundColor: "transparent", color: "text.primary" }),
        Style.states({
          hover: { backgroundColor: "accent.subtle" },
        }),
      ),
    },
    size: {
      sm: Style.compose(
        padded(["xs", "sm"]),
        textStyle({ size: "body.sm" }),
      ),
      md: Style.compose(
        padded(["sm", "md"]),
        textStyle({ size: "body.md" }),
      ),
      lg: Style.compose(
        padded(["md", "lg"]),
        textStyle({ size: "body.lg" }),
      ),
    },
    fullWidth: {
      true: Style.slot({ width: "100%" }),
      false: Style.slot({ width: "auto" }),
    },
  },

  // Compound variants — when specific combinations need special treatment
  compounds: [
    {
      when: { intent: "primary", size: "lg" },
      style: Style.slot({ fontWeight: "bold" }),
    },
    {
      when: { intent: "ghost", size: "sm" },
      style: padded(["xs", "xs"]),
    },
  ],

  // Defaults
  defaults: {
    intent: "primary",
    size: "md",
    fullWidth: false,
  },
});
```

The variant system produces a typed style factory:

```ts
// buttonVariants is a function with typed parameters
buttonVariants({ intent: "primary", size: "lg" })
// Returns composed Style for primary + large

buttonVariants({ intent: "danger", size: "sm", fullWidth: true })
// Returns composed Style for danger + small + full width

buttonVariants({ intent: "oops" })
// Error: "oops" is not assignable to "primary" | "secondary" | "danger" | "ghost"

buttonVariants({ size: 42 })
// Error: 42 is not assignable to "sm" | "md" | "lg"
```

Attach to a component:

```tsx
const Button = Component.make(
  Component.props<{
    intent?: "primary" | "secondary" | "danger" | "ghost";
    size?: "sm" | "md" | "lg";
    fullWidth?: boolean;
    disabled?: boolean;
    children: ViewNode;
  }>(),
  Component.require(),
  (props) => Effect.gen(function* () {
    const style = yield* Component.derived(() =>
      buttonVariants({
        intent: props.intent ?? "primary",
        size: props.size ?? "md",
        fullWidth: props.fullWidth ?? false,
      })
    );
    return { style };
  }),
  (props, { style }) => (
    <Button slot="root" style={style()} disabled={props.disabled}>
      {props.children}
    </Button>
  ),
);
```

The variant selection is reactive. If a parent changes the `intent` prop, only the affected style properties update.

**Variant prop types are inferred from the variant definition:**

```ts
// Extract variant props from a variant definition
type ButtonVariantProps = Style.VariantProps<typeof buttonVariants>;
// {
//   intent?: "primary" | "secondary" | "danger" | "ghost";
//   size?: "sm" | "md" | "lg";
//   fullWidth?: boolean;
// }
```

The component's props can include the variant props automatically:

```ts
const Button = Component.make(
  // Props include variant props automatically
  Component.props
    Style.VariantProps<typeof buttonVariants> & {
      disabled?: boolean;
      children: ViewNode;
    }
  >(),
  // ...
);
```

**Style recipes — pre-composed slot styles for common patterns:**

```ts
// A recipe combines slot styles into a complete component style
const cardRecipe = Style.recipe({
  slots: ["root", "header", "title", "description", "body", "footer", "action"],

  base: {
    root: Style.compose(
      rounded("lg"),
      bordered(),
      Style.slot({ backgroundColor: "surface", overflow: "hidden" }),
    ),
    header: Style.compose(
      padded(["md", "md", "sm", "md"]),
    ),
    title: textStyle({ size: "heading.sm", weight: "bold", color: "text.primary" }),
    description: textStyle({ size: "body.sm", color: "text.muted" }),
    body: padded("md"),
    footer: Style.compose(
      padded(["sm", "md", "md", "md"]),
      Style.slot({ borderTop: { width: 1, color: "border" } }),
      flexRow({ justify: "end", gap: "sm" }),
    ),
    action: Style.compose(interactive),
  },

  variants: {
    elevated: {
      true: {
        root: elevated("md"),
      },
      false: {},
    },
    compact: {
      true: {
        header: padded(["sm", "sm", "xs", "sm"]),
        body: padded("sm"),
        footer: padded(["xs", "sm", "sm", "sm"]),
        title: textStyle({ size: "body.md" }),
      },
      false: {},
    },
  },

  defaults: {
    elevated: false,
    compact: false,
  },
});
```

Usage:

```tsx
const Card = Component.make(
  Component.props
    Style.RecipeProps<typeof cardRecipe> & {
      title: string;
      description?: string;
      children: ViewNode;
      actions?: ViewNode;
    }
  >(),
  Component.require(),
  (props) => Effect.gen(function* () {
    const styles = yield* Component.derived(() =>
      cardRecipe({ elevated: props.elevated, compact: props.compact })
    );
    return { styles };
  }),
  (props, { styles }) => (
    <Box slot="root" style={styles().root}>
      <Box slot="header" style={styles().header}>
        <Text slot="title" style={styles().title}>{props.title}</Text>
        <Show when={props.description}>
          <Text slot="description" style={styles().description}>
            {props.description}
          </Text>
        </Show>
      </Box>
      <Box slot="body" style={styles().body}>
        {props.children}
      </Box>
      <Show when={props.actions}>
        <Box slot="footer" style={styles().footer}>
          {props.actions}
        </Box>
      </Show>
    </Box>
  ),
);

// Type-safe usage
<Card title="Users" description="Manage users" elevated compact>
  <UserList />
  <Card.Actions>
    <Button intent="primary">Save</Button>
    <Button intent="ghost">Cancel</Button>
  </Card.Actions>
</Card>
```

**Style handles — like refs, exposed from the component for external styling:**

Just as components expose element slots for behaviors, they expose style handles for external style overrides:

```ts
// Component exposes style handles
const Card = Component.make(
  Component.props<{ title: string; children: ViewNode }>(),
  Component.require(),
  (props) => Effect.succeed({}),
  (props) => (
    <Box slot="root" styleHandle="card.root">
      <Box slot="header" styleHandle="card.header">
        <Text slot="title" styleHandle="card.title">{props.title}</Text>
      </Box>
      <Box slot="body" styleHandle="card.body">{props.children}</Box>
    </Box>
  ),
);

// External code can target these handles
const customCardStyle = Style.override({
  "card.root": Style.compose(
    rounded("none"),        // override: no border radius
    Style.slot({ border: "none" }),  // override: no border
  ),
  "card.title": textStyle({ color: "accent.default" }),  // override: colored title
});

// Apply override to a component tree
<Style.Provider overrides={customCardStyle}>
  <Card title="Custom styled">...</Card>
</Style.Provider>
```

Style handles work like CSS custom properties or CSS parts — they're named styling attachment points that external code can target. But they're typed. You can only override properties that exist on the handle's element type. And you can only target handles that the component declares.

```ts
Style.override({
  "card.nonexistent": padded("md"),
  // Error: "card.nonexistent" is not a declared style handle on Card
});
```

**Theme overrides via style handles — design system customization:**

A design system publishes components with style handles. Consumers override the handles for their brand:

```ts
// Design system publishes:
export const DSButton = /* button with style handles */;
export const DSCard = /* card with style handles */;
export const DSInput = /* input with style handles */;

// Consumer's brand overrides:
const brandOverrides = Style.override({
  "button.root": Style.compose(
    rounded("full"),  // pill-shaped buttons
    Style.slot({ fontFamily: "brand-font" }),
  ),
  "card.root": Style.compose(
    rounded("none"),  // sharp card corners
    elevated("lg"),   // more dramatic shadows
  ),
  "input.root": Style.compose(
    rounded("none"),
    Style.slot({ borderBottom: { width: 2, color: "accent.default" } }),
    Style.slot({ border: "none" }),  // underline-only inputs
  ),
});

// Apply brand-wide
<Style.Provider overrides={brandOverrides}>
  <App />
</Style.Provider>
```

The consumer doesn't fork the design system. They override specific handles. The design system can add new handles in future versions without breaking overrides. Overrides are typed against the published handle map.

**Conditional style composition — state-driven styling:**

```ts
// Style pieces that compose conditionally
const listItemStyle = (options: {
  selected: () => boolean;
  active: () => boolean;
  disabled: () => boolean;
  dragging: () => boolean;
}) =>
  Style.compose(
    // Base
    padded(["sm", "md"]),
    rounded("sm"),
    interactive,
    Style.slot({ transition: "fast" }),

    // Conditional pieces — only applied when condition is true
    Style.when(options.selected, Style.compose(
      Style.slot({ backgroundColor: "accent.subtle" }),
      bordered({ color: "accent.default", width: 2 }),
    )),

    Style.when(options.active, Style.compose(
      Style.slot({ backgroundColor: "accent.subtle" }),
      Style.slot({ fontWeight: "semibold" }),
    )),

    Style.when(options.disabled, Style.compose(
      disabledStyle(options.disabled),
    )),

    Style.when(options.dragging, Style.compose(
      elevated("lg"),
      Style.slot({ opacity: 0.8, transform: "rotate(2deg)" }),
    )),
  );
```

`Style.when(condition, style)` only applies the style piece when the condition is true. The condition is reactive — when it changes, only the affected properties update. This is the equivalent of Tailwind's conditional classes but with reactive bindings and type-safe tokens.

**Animation styles:**

```ts
const fadeIn = Style.animation({
  from: { opacity: 0, transform: "translateY(8px)" },
  to: { opacity: 1, transform: "translateY(0)" },
  duration: "normal",
  easing: "ease-out",
});

const slideDown = Style.animation({
  from: { height: 0, opacity: 0 },
  to: { height: "auto", opacity: 1 },
  duration: "normal",
  easing: "ease-out",
});

const pulse = Style.keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.5 },
  "100%": { opacity: 1 },
}, { duration: "2s", iteration: "infinite" });

// Attach to transitions
const accordionContent = Style.compose(
  Style.transition({
    enter: slideDown,
    exit: Style.animation({
      from: { height: "auto", opacity: 1 },
      to: { height: 0, opacity: 0 },
      duration: "fast",
    }),
  }),
);
```

The disclosure behavior already controls visibility. The style adds how the visibility change looks. Behavior and appearance remain independent.

**The style resolution pipeline:**

When multiple style sources apply to the same element, they're resolved in a predictable order:

```
1. Theme defaults (from Theme service)
2. Recipe base styles (from Style.recipe base)
3. Variant styles (from Style.recipe variants)
4. Composed utilities (from Style.compose)
5. Conditional styles (from Style.when, reactive)
6. State styles (from Style.states — hover, focus, etc.)
7. Handle overrides (from Style.Provider)
8. Inline reactive styles (from factory functions)
```

Later sources override earlier ones per-property. The resolver merges them into a final style object for each element. On web, this can compile to CSS custom properties + utility classes for static parts and inline styles for reactive parts. On other platforms, it resolves to the platform's style model.

**The resolution is an Effect — it goes through the Theme service:**

```ts
// Style resolution pipeline
const resolveStyle = (style: ComposedStyle) =>
  Effect.gen(function* () {
    const theme = yield* Theme;

    // Walk the style tree, resolve tokens
    return resolveTokens(style, theme.tokens);
  });

// Token resolution
function resolveTokens(style: StyleDef, tokens: ThemeTokens): ResolvedStyle {
  const resolved: ResolvedStyle = {};

  for (const [key, value] of Object.entries(style)) {
    if (typeof value === "string" && isTokenPath(value)) {
      // "text.primary" → "#1a1a1a"
      resolved[key] = lookupToken(tokens, value);
    } else if (typeof value === "function") {
      // Reactive value — resolve lazily
      resolved[key] = () => {
        const raw = value();
        return typeof raw === "string" && isTokenPath(raw)
          ? lookupToken(tokens, raw)
          : raw;
      };
    } else if (typeof value === "object") {
      // Nested (border, shadow, flex, etc.)
      resolved[key] = resolveTokens(value, tokens);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}
```

Because resolution goes through the Theme service, switching themes is just swapping the layer:

```ts
// Light theme
Component.mount(App, {
  layer: Layer.mergeAll(AppLive, Theme.Light, WebPlatform),
  target: root,
});

// Dark theme
Component.mount(App, {
  layer: Layer.mergeAll(AppLive, Theme.Dark, WebPlatform),
  target: root,
});

// Dynamic theme switching
const themeAtom = Atom.make<"light" | "dark">("light");

const DynamicTheme = Layer.effect(Theme,
  Effect.gen(function* () {
    const mode = themeAtom;
    const tokens = yield* Component.derived(() =>
      mode() === "dark" ? darkTokens : lightTokens
    );
    return {
      tokens: tokens(),
      resolve: (path) => lookupToken(tokens(), path),
      mode,
    };
  })
);
```

All token references re-resolve when the theme changes. Styles update reactively.

**Platform-specific style compilation:**

The resolver produces an abstract resolved style. The platform renders it:

```ts
// Web: resolved styles → CSS properties or className
// Static styles → compile-time CSS class generation (like Tailwind's JIT)
// Reactive styles → CSS custom properties that update
// State styles → pseudo-class rules

// TUI: resolved styles → blessed style objects
// Colors → ANSI color codes
// Layout → absolute positioning

// Mobile: resolved styles → StyleSheet.create objects
// Flexbox properties map directly
// Shadows map to platform shadow APIs
```

**Style.attach operates on element refs — same as behaviors:**

When `Style.attach(cardStyle)` is piped onto a component, it attaches resolved styles to the element refs identified by slots. The mechanism is identical to how behaviors attach handlers:

```ts
// Internally, Style.attach does:
function attachStyle(component: Component, style: ComposedStyle) {
  return Component.pipe(component,
    Component.tapSetup((bindings) =>
      Effect.gen(function* () {
        const theme = yield* Theme;
        const resolved = resolveTokens(style, theme.tokens);

        // For each slot in the style definition
        for (const [slotName, slotStyle] of Object.entries(resolved)) {
          const el = bindings.__slots__[slotName];
          if (!el) continue;

          // Attach static styles
          for (const [prop, value] of Object.entries(slotStyle)) {
            if (typeof value === "function") {
              // Reactive — subscribe via Reactivity
              yield* el.setStyle(prop, value);
            } else {
              // Static — set once
              yield* el.setStyleOnce(prop, value);
            }
          }
        }
      })
    ),
  );
}
```

Element refs have `setStyle` and `setStyleOnce` methods. The renderer translates these to the platform's style API. On web, `setStyle("backgroundColor", "red")` might set `element.style.backgroundColor = "red"` or add a CSS class. The component never sees CSS.

**The complete design system as layers:**

```ts
// @myorg/design-system

// Theme tokens
export const Theme = {
  Light: Layer.succeed(Theme, { tokens: lightTokens, ... }),
  Dark: Layer.succeed(Theme, { tokens: darkTokens, ... }),
  Brand: Layer.succeed(Theme, { tokens: brandTokens, ... }),
};

// Style utilities (composable pieces)
export {
  padded, rounded, elevated, bordered,
  textStyle, flexRow, flexCol,
  interactive, truncated, scrollable,
  selectedStyle, disabledStyle, loadingStyle,
};

// Variant definitions (typed variant factories)
export const buttonVariants = Style.variants({ ... });
export const inputVariants = Style.variants({ ... });
export const badgeVariants = Style.variants({ ... });
export const alertVariants = Style.variants({ ... });

// Recipes (multi-slot component styles)
export const cardRecipe = Style.recipe({ ... });
export const dialogRecipe = Style.recipe({ ... });
export const tableRecipe = Style.recipe({ ... });
export const formRecipe = Style.recipe({ ... });

// Behaviors (interaction logic)
export { disclosure, selection, searchFilter, keyboardNav, pagination, focusTrap };

// Composed components (behavior + style + view)
export const Button = BaseButton.pipe(
  Style.attach(buttonVariants),
  Behavior.attach(focusBehavior),
);

export const Card = BaseCard.pipe(
  Style.attach(cardRecipe),
);

export const Combobox = BaseCombobox.pipe(
  Style.attach(comboboxRecipe),
  Behavior.attach(comboboxBehavior),
);

// Style handles for consumer overrides
export type StyleHandles = {
  "button.root": typeof buttonVariants;
  "card.root": typeof cardRecipe;
  "card.header": typeof cardRecipe;
  "combobox.input": typeof comboboxRecipe;
  // ... all published handles
};
```

Consumer:

```ts
import { Theme, Button, Card, buttonVariants } from "@myorg/design-system";

// Use as-is
<Button intent="primary" size="md">Save</Button>
<Card title="Users" elevated>...</Card>

// Override with brand styles
const brandOverrides = Style.override({
  "button.root": rounded("full"),
  "card.root": Style.compose(rounded("none"), elevated("lg")),
});

<Style.Provider overrides={brandOverrides}>
  <App />
</Style.Provider>

// Or use just the pieces you need
const MySpecialButton = MyButtonView.pipe(
  Style.attach(Style.compose(
    buttonVariants.base,
    buttonVariants.variants.intent.primary,
    rounded("full"),
    Style.slot({ fontFamily: "custom-font" }),
  )),
  Behavior.attach(focusBehavior),
);

// Or just use the utilities directly
const myStyle = Style.make({
  root: Style.compose(padded("md"), rounded("lg"), elevated("sm")),
});
```

**What this replaces:**

Tailwind: `className="p-4 rounded-lg shadow-sm bg-white border"` → `Style.compose(padded("md"), rounded("lg"), elevated("sm"), bordered(), bg("surface"))`. Same granularity, but type-checked tokens, reactive values, platform-agnostic, and attached to typed slots instead of className strings.

CSS-in-JS (styled-components/emotion): Template literal CSS with runtime injection → typed style objects resolved through a theme service. No CSS parsing at runtime. No style injection ordering bugs.

CVA/cva: Class variance authority → `Style.variants` with the same variant/compound model but fully typed and composable with the behavior system.

shadcn/ui: Copy-paste components with Tailwind classes → composable behaviors + composable styles + view slots. No copying. No forking. Override via handles.

CSS Modules: File-scoped CSS → slot-scoped styles. No naming collisions because styles target typed slot names, not global class names.

**The architecture:**

```
Theme (service/layer)
├── Tokens: typed tree of design values
├── resolve(): token path → concrete value
└── mode: light/dark/brand (reactive)

Style utilities (composable pieces)
├── padded(), rounded(), elevated(), bordered()
├── textStyle(), flexRow(), flexCol()
├── interactive(), truncated(), scrollable()
├── selectedStyle(), disabledStyle() (reactive factories)
└── Style.when(), Style.states(), Style.responsive()

Style.variants (typed variant factories)
├── Variant axes with typed options
├── Compound variants for combinations
├── Defaults
└── Inferred VariantProps type

Style.recipe (multi-slot variant factories)
├── Slot names → style compositions
├── Variant axes per slot
└── Inferred RecipeProps type

Style.compose (merges style pieces)
├── Later overrides earlier per-property
├── Reactive values subscribe via Reactivity
└── Token references resolve through Theme

Style.attach (pipe onto component)
├── Maps style slots to component element slots
├── Type-checks slot existence and compatibility
└── Attaches via element refs (same as behaviors)

Style.override + Style.Provider
├── Named style handles exposed by components
├── External override targeting specific handles
└── Type-checked against published handle map

Resolution pipeline
├── Theme tokens → concrete values
├── Variants → selected style pieces
├── Composition → merged properties
├── Conditions → reactive toggles
├── Platform renderer → native style API
└── Reactivity → granular updates
```

Everything is typed. Tokens are type-checked paths. Variants are typed options. Slots are typed element refs. Overrides are typed handle maps. Compositions merge predictably. Reactive values update granularly. Platform rendering is a service. Theme switching is a layer swap.

The same component, the same behaviors, the same style compositions — web, TUI, mobile. The only thing that changes is the Theme layer (different token values for different platforms/brands) and the Platform layer (different rendering of the resolved styles).