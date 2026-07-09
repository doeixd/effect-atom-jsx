# Style And Theme

The style system treats appearance as typed data attached to `View.Slots`.
Author components with a slot contract, build a style map for that contract,
and attach the style from outside the component.

Use this guide for current public APIs. Older style design notes live in
`docs/archive/`.

## Golden Path

```ts
import { Component, Element, Style, View } from "effect-atom-jsx";
import { Effect } from "effect";

const CardSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  title: { capability: Element.Capability.Container },
  body: { capability: Element.Capability.Container },
});

const Card = Component.make(
  Component.props<{ readonly title: string; readonly children: unknown }>(),
  Component.require<never>(),
  () => Effect.succeed({}),
  (props) =>
    View.fromSlots(CardSlots, (
      <section>
        <h2>{props.title}</h2>
        <div>{props.children}</div>
      </section>
    )),
).pipe(Component.withSlots(CardSlots));

const CardStyle = Style.forSlots(CardSlots)({
  root: Style.compose(
    Style.slot({ display: "grid", gap: "md", padding: "lg" }),
    Style.pseudo({ ":focus-within": { outlineColor: "accent.default" } }),
  ),
  title: Style.slot({ fontSize: "heading.sm", color: "text.primary" }),
  body: Style.slot({ color: "text.secondary" }),
});

export const StyledCard = Card.pipe(
  Style.attachToSlots(CardStyle, CardSlots),
);
```

Slot names, style binding requirements, and component slot contracts are checked
by TypeScript. Dynamic/generated integrations can use the string-map helpers
described below.

## Core Pieces

- `Style.slot(style)` creates a concrete style object.
- `Style.compose(...pieces)` merges style pieces left to right.
- `Style.when(condition, piece)` includes a piece when a predicate is true.
- `Style.whenBinding(binding, predicateOrValue, piece)` includes a piece based
  on setup or behavior-created bindings.
- `Style.states(...)`, `Style.responsive(...)`, `Style.animation(...)`,
  `Style.transition(...)`, and `Style.keyframes(...)` model common style data.
- `Style.media(...)`, `Style.supports(...)`, `Style.container(...)`,
  `Style.containerQuery(...)`, and `Style.containerType(...)` preserve at-rule
  descriptors for renderer adapters.
- `Style.pseudo(...)`, `Style.nest(...)`, `Style.child(...)`,
  `Style.descendant(...)`, `Style.sibling(...)`, `Style.attr(...)`,
  `Style.not(...)`, and `Style.is(...)` preserve selector descriptors.
- `Style.animate(...)`, `Style.enter(...)`, `Style.exit(...)`,
  `Style.enterStagger(...)`, and `Style.layoutAnimation(...)` preserve
  animation/lifecycle descriptors.
- `Style.grid(...)`, `Style.layers(...)`, `Style.inLayer(...)`,
  `Style.global(...)`, and `Style.globalLayer(...)` model layout, cascade
  layers, and global style sheets.

Advanced descriptors are renderer-neutral. The core runtime stores them on
element handles (`__media`, `__pseudo`, etc.) so renderers, diagnostics, and
tests can inspect them without a DOM dependency.

## Attachment Tiers

Use the strongest tier that matches your component shape.

| API | Use When |
| --- | --- |
| `Style.attachToSlots(style, slots)` | Authored component publishes the same `View.Slots` contract. This is the golden path. |
| `Style.attachBySlotContract(style, map)` | Authored remap from style slots to component slot witnesses. |
| `Style.attachBySlots(style, map)` | Dynamic/generated string slot map. Runtime validation is expected. |
| `Style.attach(style)` | Low-level binding-slot component with `bindings.slots`, no published contract. |
| `Style.attachByView(style)` | Low-level rendered-`View` attachment for no-contract components. |
| `Style.attachToAllWithCapability(piece, capability)` | Apply one piece to every rendered slot with a compatible capability. |

`Style.attach` and `Style.attachByView` are not deprecated. They are the
general tier for no-contract or generated code. Authored design-system code
should publish `View.Slots` and use `attachToSlots`.

## Binding-Aware Styles

Behavior-created or setup-created state can drive style pieces without coupling
the behavior to the style implementation.

```ts
import { Behavior, Style } from "effect-atom-jsx";

const IsOpen = Behavior.binding<"isOpen", boolean>("isOpen");

const DisclosureStyle = Style.forSlots(DisclosureSlots)({
  panel: Style.compose(
    Style.slot({ opacity: 0 }),
    Style.whenBinding(IsOpen, true, Style.slot({ opacity: 1 })),
  ),
});
```

If an authored style references a binding witness, `Style.attachToSlots` checks
that the component exposes that binding after behavior attachment.

## Global Styles

`Style.global(...)` creates a renderer-neutral global stylesheet descriptor.
`Style.globalLayer(...)` publishes it as an Effect service:

```ts
const Globals = Style.global({
  body: Style.slot({ color: "text.primary", backgroundColor: "surface" }),
  ".app": { minHeight: "100vh" },
});

const GlobalLayer = Style.globalLayer(Globals, {
  apply: (sheet) =>
    Effect.sync(() => {
      // Renderer adapters can turn sheet.resolved into CSS.
      console.log(sheet.resolved.body);
    }),
});
```

The service is available through `Style.GlobalStyleTag`. `sheet.resolved`
contains token-resolved ordinary properties and preserves advanced descriptors.

## Platform Diagnostics

Platforms can declare supported style properties and receive diagnostics when a
style uses unsupported properties.

```ts
const WebStyle = Style.platform(
  {
    name: "web",
    properties: [
      Style.Property.Color,
      Style.Property.BackgroundColor,
      Style.Property.Display,
      Style.Property.make("backdropFilter"),
    ],
  },
  {
    onDiagnostic: (diagnostic) => console.warn(diagnostic.message),
  },
);
```

Provide the platform layer during component setup to report diagnostics during
style attachment. You can also call `Style.validatePlatform(...)` or
`Style.reportPlatformDiagnostics(...)` explicitly in renderers and tooling.

## Themes And Tokens

Default token paths are available for common color, spacing, and font-size
values:

```ts
Style.slot({
  color: "text.primary",
  padding: "md",
  fontSize: "body.md",
});
```

User themes are plain token trees:

```ts
const AppTheme = Theme.define({
  color: {
    brand: { primary: "#2563eb" },
  },
  spacing: {
    page: { gutter: 24 },
  },
});

AppTheme.path("color", "brand.primary");
AppTheme.lookup("color.brand.primary");

const ThemeLayer = Theme.layer(AppTheme.tokens);
```

`Theme.ThemeLight` is the default light theme layer. `Style.Style` re-exports
theme helpers for convenience: `defineTheme`, `defineThemeTokens`,
`themeLayer`, and `lookupToken`.

## Variants And Recipes

Use `Style.variants(...)` for one-slot variation and `Style.recipe(...)` for
multi-slot variation.

```ts
const button = Style.variants({
  base: Style.slot({ padding: "sm" }),
  variants: {
    tone: {
      primary: Style.slot({ backgroundColor: "accent.default" }),
      ghost: Style.slot({ backgroundColor: "surface" }),
    },
  },
  defaults: { tone: "primary" },
});

const card = Style.recipe({
  slots: ["root", "title"] as const,
  base: {
    root: Style.slot({ padding: "md" }),
    title: Style.slot({ fontSize: "heading.sm" }),
  },
  variants: {
    compact: {
      true: { root: Style.slot({ padding: "sm" }) },
      false: {},
    },
  },
  defaults: { compact: "false" },
});
```

## Testing

The in-memory `Element` handles expose `getStyle(prop)`, so style behavior can
be tested without a browser.

```ts
const bindings = Effect.runSync(Component.setupEffect(StyledCard, {
  title: "Docs",
  children: null,
}));

expect(bindings.slots.root.getStyle("padding")).toBe(16);
expect(bindings.slots.root.getStyle("__pseudo")).toBeDefined();
```

Use `Style.validateAttachment(...)`, `Style.validateComponentAttachment(...)`,
and `Style.validateAttachmentBySlots(...)` for diagnostics over dynamic slots.

## Related Docs

- `docs/SLOT_CONTRACT_GOLDEN_PATH.md`
- `docs/view.md`
- `docs/component.md`
- `docs/API.md`
