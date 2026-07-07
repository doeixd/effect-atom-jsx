# PR: AF-UI Convergence Checkpoint

## Summary

This checkpoint moves `effect-atom-jsx` further toward the AF-UI contract:

```ts
Component<Props, Req, E, Bindings, Slots> -> View<Slots>
```

The main user-facing theme is that slots, metadata, styles, behaviors, routes,
and diagnostics now compose around a runtime-inspectable `View<Slots>` model.
Metadata can be authored with branded witnesses instead of magic strings while
remaining backward-compatible with string metadata.

This is a broad convergence checkpoint, not a narrow one-file patch. It includes
metadata witnesses, component-rendered View validation, route slot-axis
preservation, SSR/route hydration proof work, and Atom type-axis convergence
already present in the worktree.

## Public API Additions

### Metadata Witnesses

- `Element.Capability.make(name)`
- `Element.Capability.Base`
- `Element.Capability.Interactive`
- `Element.Capability.Container`
- `Element.Capability.Focusable`
- `Element.Capability.TextInput`
- `Element.Capability.Draggable`
- `Element.Capability.Collection`
- `View.Event.make(name)`
- `View.Event.Press`
- `View.Event.Click`
- `View.Event.Input`
- `View.Event.Focus`
- `View.Event.Blur`
- `View.Event.Hover`
- `View.Attribute.make(name)`
- `View.Attribute.AriaLabel`
- `View.Attribute.Role`
- `View.Attribute.Disabled`
- `View.Attribute.Value`
- `View.Requirement.make(name)`
- `View.Requirement.Keyboard`
- `View.Requirement.Pointer`
- `View.Requirement.Clipboard`
- `Style.Property.make(name)`
- `Style.Property.Color`
- `Style.Property.BackgroundColor`
- `Style.Property.Opacity`
- `Style.Property.Display`
- `Style.Property.Gap`
- `Style.Property.Padding`
- `Style.Property.Margin`
- `Style.Property.FontSize`
- `Style.Property.BorderRadius`

### Metadata Normalization Helpers

- `Element.nameOfCapability(...)`
- `View.nameOfCapability(...)`
- `View.nameOfEvent(...)`
- `View.nameOfAttribute(...)`
- `View.nameOfRequirement(...)`
- `View.nameOfMetadata(...)`
- `Style.nameOfProperty(...)`

### Type Extraction Helpers

- `View.SlotCapabilityOf<T>`
- `View.SlotEventsOf<T>`
- `View.SlotAttributesOf<T>`
- `View.SlotRequirementsOf<T>`
- `View.PlatformCapabilitiesOf<T>`
- `View.PlatformEventsOf<T>`
- `View.PlatformAttributesOf<T>`
- `View.PlatformRequirementsOf<T>`
- `Style.Property.NameOf<T>`
- `Style.Property.NamesOf<T>`
- `Style.PropertyNameOf<T>`
- `Style.PropertyNamesOf<T>`
- `Behavior.EventRequirementsOf<T>`

### Runtime Validation Helpers

- `Component.renderViewEffect(component, props)`
- `Style.validateComponentAttachment(style, component, props, options?)`
- `Style.validatePlatform(style, metadata)`
- `Style.propertiesOf(style)`
- `Behavior.events(eventMap)`
- `Behavior.withMetadata(behavior, metadata)`
- `Behavior.validateComponentAttachmentBySlots(behavior, map, component, props, options?)`

## Compatibility Notes

- Existing string metadata remains supported.
- Diagnostics continue to expose printable string fields.
- Built-in element handles keep their existing `kind` strings.
- `MetadataToken` is an internal implementation module. Public code should use
  domain-specific constructors such as `Element.Capability.*`, `View.Event.*`,
  and `Style.Property.*`.
- `Component.renderEffect(...)` still unwraps `View.node` for existing runtime
  behavior.
- `Component.renderViewEffect(...)` is the opt-in inspection path for
  `View<Slots>` metadata.

## Notable Implementation Details

- `View.validatePlatform(...)` accepts string or witness metadata for
  capabilities, events, attributes, and requirements.
- `Style.validatePlatform(...)` checks style properties against renderer/platform
  property metadata.
- `Behavior.events(...)` lets behaviors declare event requirements that are
  validated against `View.slot(...allowedEvents)`.
- `View.validateRemaps(...)` compares normalized capability names, so
  `"Container"` and `Element.Capability.Container` are compatible.
- Route component/tag aliases now carry the fifth `Component` slot axis.
- `RoutedComponent` and `LoaderTaggedComponent` are metadata tags instead of
  broad component intersections, avoiding `Component.SlotsOf<T>` widening.

## Coverage Added

Runtime coverage includes:

- witness-based `View.validatePlatform(...)`
- string/witness capability remap compatibility
- style property platform diagnostics
- behavior event requirement diagnostics
- component-rendered View validation for styles and behaviors
- end-to-end AF-UI metadata diagnostics across View, Behavior, and Style
- `View<Slots>` preservation through:
  - `Behavior.attachBySlots(...)` / `Component.withBehavior(...)`
  - `Style.attachByView(...)`
  - `Component.withLayer(...)`
  - `Component.guard(...)`
  - legacy `Component.route(...)`
  - `Route.page(...)` / `Route.componentOf(...)`

Type coverage includes:

- witness literal inference through `View.slot(...)`
- platform metadata extraction through `View.platform(...)`
- style property witness extraction
- behavior event requirement extraction
- component-rendered View effect slot typing
- wrapper preservation of `Component.SlotsOf<T>`
- route-node and legacy route preservation of slot axes
- public root-import API coverage through `src/index.ts`

## Documentation Updated

- `docs/AF_UI_CONTRACT.md`
  - Domain-specific witnesses are now the canonical authored metadata form.
  - `View<Slots>` metadata is runtime-inspectable today.
  - Static component metadata extraction beyond the `Slots` axis remains future
    work.
- `docs/API.md`
  - Documents View, Behavior, Style, Component, Route updates.
- `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md`
  - Records the AF-UI convergence checkpoint.
- `docs/METADATA_WITNESS_IMPLEMENTATION_PLAN.md`
  - Rewritten as a status/handoff document with a golden-path example.

## Validation

Latest validation:

```bash
npm run typecheck
npm test
npm run build
```

Results:

- `npm run typecheck`: passed
- `npm test`: passed, 24 files / 418 tests
- `npm run build`: passed

## Reviewer Focus Areas

- Public metadata API shape:
  - witness names
  - string compatibility
  - whether `MetadataToken` should remain internal
- `Component.renderViewEffect(...)` as the runtime inspection boundary.
- Route type changes:
  - fifth `Component` slot axis through route nodes
  - `RoutedComponent` / `LoaderTaggedComponent` as metadata tags
  - stricter loader helper overloads requiring component + loader metadata
- Whether `Style.validatePlatform(...)` should remain explicit for now or later
  be wired into a renderer/platform service like `View.platform(...)`.
- Docs accuracy around current runtime metadata versus future static metadata.

## Remaining Follow-ups

- Add type-level compatibility helpers only if they stay small and do not slow
  inference.
- Decide whether capability hierarchy is worth adding, for example
  `TextInput extends Focusable`.
- Continue wrapper preservation audits as new component/route/style transforms
  are introduced.
- Consider renderer integration for style property diagnostics.
- Keep `AF_UI_CONTRACT.md`, API docs, and current-status docs aligned as
  `View<Slots>` evolves from a runtime wrapper toward a richer typed view tree.
