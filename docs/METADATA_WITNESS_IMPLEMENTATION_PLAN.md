# Metadata Witness Status And Handoff

This document records the implemented metadata witness surface and the remaining
work. It started as an implementation plan; the core runtime and type APIs have
now landed.

## Status

Implemented:

- Shared internal witness primitive in `src/MetadataToken.ts`.
- Element capability witnesses:
  - `Element.Capability.make(name, { extends })`
  - built-ins: `Base`, `Interactive`, `Container`, `Focusable`, `TextInput`,
    `Draggable`, `Collection`
  - hierarchy helpers: `Element.extendsCapability(...)`,
    `Element.Capability.ExtendsOf<T>`, and
    `Element.Capability.AssignableNamesOf<T>`
- View metadata witnesses:
  - `View.Event.make(name)` plus `Press`, `Click`, `Input`, `Focus`, `Blur`,
    `Hover`
  - `View.Attribute.make(name)` plus `AriaLabel`, `Role`, `Disabled`, `Value`
  - `View.Requirement.make(name)` plus `Keyboard`, `Pointer`, `Clipboard`
- Style property witnesses:
  - `Style.Property.make(name)`
  - built-ins: `Color`, `BackgroundColor`, `Opacity`, `Display`, `Gap`,
    `Padding`, `Margin`, `FontSize`, `BorderRadius`
- Witness-aware metadata fields:
  - `View.slot(..., { capability, allowedEvents, allowedAttributes,
    platformRequirements })`
  - `View.platform(..., { capabilities, events, attributes, requirements })`
  - `Style.validatePlatform(..., { properties })`
  - `Behavior.events(...)`
- Public normalization helpers:
  - `Element.nameOfCapability(...)`
  - `Element.extendsCapability(...)`
  - `View.nameOfCapability(...)`
  - `View.extendsCapability(...)`
  - `View.nameOfEvent(...)`
  - `View.nameOfAttribute(...)`
  - `View.nameOfRequirement(...)`
  - `View.nameOfMetadata(...)`
  - `Style.nameOfProperty(...)`
- Component-rendered View validation helpers:
  - `Component.renderViewEffect(...)`
  - `Style.validateComponentAttachment(...)`
  - `Behavior.validateComponentAttachmentBySlots(...)`
- Conservative View/platform type compatibility helpers:
  - `View.MissingPlatformSupport<Slot, Platform>`
  - `View.IsPlatformCompatible<Slot, Platform>`

Compatibility:

- Existing string metadata remains accepted.
- Diagnostics expose printable string fields.
- `MetadataToken` is internal. Public code should use domain-specific
  constructors and helpers rather than importing `MetadataToken` directly.

## Inference Model

Witnesses are runtime values that preserve literal identity in TypeScript:

```ts
const Commit = View.Event.make("commit");

const slot = View.slot("input", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input, Commit],
});

type Events = View.SlotEventsOf<typeof slot>;
// "input" | "commit"
```

Tuple-style metadata keeps useful unions when values are passed inline:

```ts
const Web = View.platform({
  name: "web",
  capabilities: [Element.Capability.Container, Element.Capability.TextInput],
  events: [View.Event.Input, View.Event.Focus],
});

type WebCapabilities = View.PlatformCapabilitiesOf<typeof Web>;
// "Container" | "TextInput"
```

Plain strings remain valid, but mixed or non-literal string metadata may widen
to `string`. That is intentional for compatibility.

Type-level compatibility helpers are available for the View/platform path:

```ts
type Missing = View.MissingPlatformSupport<typeof slot, typeof Web>;
type Compatible = View.IsPlatformCompatible<typeof slot, typeof Web>;
```

They are conservative by design. Literal witness metadata can produce precise
missing diagnostic unions; widened strings return compatible and defer to
runtime diagnostics.

Capability witnesses can also carry parent metadata:

```ts
const DatePicker = Element.Capability.make("DatePicker", {
  extends: [Element.Capability.TextInput],
});

Element.extendsCapability(DatePicker, Element.Capability.Focusable);
// true
```

The built-in hierarchy is:

```text
Base
├─ Interactive
│  ├─ Container
│  ├─ Focusable
│  │  └─ TextInput
│  └─ Draggable
└─ Collection
```

`View.validateRemaps(...)` and `View.validatePlatform(...)` use this hierarchy:
a child capability can satisfy a parent slot requirement, but a parent does not
satisfy a more specific child requirement. The same rule is reflected in
`View.MissingPlatformSupport<Slot, Platform>` when literal witnesses are used.

## Golden Path

```ts
const Submit = View.Event.make("submit");
const Shadow = Style.Property.make("boxShadow");

const SearchBox = Component.make<
  {},
  never,
  never,
  { readonly slots: { readonly input: Element.TextInput } }
>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.succeed({ slots: { input: Element.textInput() } }),
  (_props, bindings) => View.make(
    bindings.slots,
    "search-box",
    {
      name: "SearchBox",
      slotMetadata: {
        input: View.slot("input", {
          capability: Element.Capability.TextInput,
          allowedEvents: [View.Event.Input, Submit],
          allowedAttributes: [View.Attribute.AriaLabel],
          platformRequirements: [View.Requirement.Keyboard],
        }),
      },
    },
  ),
);

const NeedsInput = Behavior.events({
  input: [View.Event.Input, Submit],
})(
  Behavior.make<
    { readonly input: Element.TextInput },
    {},
    never,
    never
  >(() => Effect.succeed({})),
);

const searchStyle = Style.make({
  input: Style.slot({
    color: "red",
    boxShadow: "0 0 0 1px red",
  }),
});

const view = Effect.runSync(Component.renderViewEffect(SearchBox, {}));

const behaviorDiagnostics = Effect.runSync(
  Behavior.validateComponentAttachmentBySlots(
    NeedsInput,
    { input: "input" },
    SearchBox,
    {},
  ),
);

const styleAttachmentDiagnostics = Effect.runSync(
  Style.validateComponentAttachment(searchStyle, SearchBox, {}),
);

const viewPlatformDiagnostics = view === undefined
  ? []
  : View.validatePlatform(view, {
    name: "minimal-web",
    capabilities: [Element.Capability.TextInput],
    events: [View.Event.Input],
    attributes: [],
    requirements: [View.Requirement.Keyboard],
  });

const stylePlatformDiagnostics = Style.validatePlatform(searchStyle, {
  name: "minimal-style",
  properties: [Style.Property.Color, Shadow],
});
```

The important property is that all checks normalize witnesses and strings to the
same diagnostic names while preserving literal witness names for type helpers.

## Preservation Coverage

`View<Slots>` metadata is covered by runtime and type tests through:

- direct component rendering via `Component.renderViewEffect(...)`
- `Style.validateComponentAttachment(...)`
- `Behavior.validateComponentAttachmentBySlots(...)`
- `Behavior.attachBySlots(...)` / `Component.withBehavior(...)`
- `Style.attachByView(...)`
- `Component.withLayer(...)`
- `Component.guard(...)`
- legacy `Component.route(...)`
- route-node materialization via `Route.page(...)` / `Route.componentOf(...)`

Route component/tag aliases now carry the fifth `Component` slot axis, and
`RoutedComponent` / `LoaderTaggedComponent` are metadata tags rather than broad
component intersections.

## Public Export Audit

Root `src/index.ts` exports the public namespaces that carry these APIs:

- `Component`
- `View`
- `Element`
- `Behavior`
- `Style`
- `Route`

The emitted declarations include:

- `Component.renderViewEffect(...)`
- `Behavior.events(...)`
- `Behavior.validateComponentAttachmentBySlots(...)`
- `Style.Property.*`
- `Style.validateComponentAttachment(...)`
- `Style.validatePlatform(...)`
- `View.Event/Attribute/Requirement.*`
- `View.nameOf*`
- `Element.Capability.*`
- `Element.nameOfCapability(...)`
- `Element.extendsCapability(...)`

`src/type-tests/public-metadata-api.ts` covers the root-import path.

## Remaining Work

- Consider whether style-property compatibility needs type-level helpers similar
  to `View.MissingPlatformSupport<Slot, Platform>`.
- Continue auditing new wrappers as they are added so `View<Slots>` metadata is
  preserved across composition.
- Add renderer/platform integration that consumes `Style.validatePlatform(...)`
  automatically, similar to current `View.platform(...)` diagnostics.
- Keep docs aligned as `View<Slots>` evolves from a runtime wrapper toward a
  richer typed view tree.

## Validation

Current validation status for this slice:

- `npm run typecheck`
- `npm test`
- `npm run build`
