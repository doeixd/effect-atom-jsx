# Slot Contract Unification Plan

This plan records the AF-UI slot contract unification that replaced the earlier
slot witness split. It is now the current authored slot model.

For the component ownership model behind this plan, see
[`PROPS_BINDINGS_SLOTS.md`](PROPS_BINDINGS_SLOTS.md).

## Thesis

`View.Slots` is the single canonical authored slot contract object.
Runtime handle maps, static component slot metadata, slot metadata records, and
style/behavior attachment types should all be projections of that one contract.

The old six-axis component shape was an intermediate implementation detail:

```ts
Component<Props, Req, E, Bindings, Slots, SlotWitnesses>
```

It exposed a split that should not become the public design. `Slots` and
`SlotWitnesses` could drift. The implementation now uses one slot contract axis:

```ts
Component<Props, Req, E, Bindings, SlotContract>
```

where `SlotContract` is usually a `View.Slots.Any` value/type, and helper types
derive the public projections:

```ts
Component.SlotsOf<T>          // runtime handle map
Component.SlotContractOf<T>   // canonical View.Slots contract
Component.PublicSlotsOf<T>    // public handle map
Component.HiddenSlotsOf<T>    // hidden/internal handle map
```

## Design Principle

Slot contracts are the authored API. String slot maps are the
dynamic/generated escape hatch.

That means:

- `View.Slots.make(...)` defines the authored structural contract.
- `Component.withSlots(slots)` publishes that contract on a component.
- `Style.forSlots(slots)(...)` and `Behavior.forSlots(slots)(...)` consume the
  authored contract.
- `Style.attachToSlots(style, slots)` and
  `Behavior.attachToSlots(behavior, slots)` are the preferred authored
  attachment helpers.
- `attachBySlotContract(...)` is the explicit typed remapping helper.
- `attachBySlots(..., stringMap)` is the dynamic/generated helper.

## Canonical Authoring Shape

The desired public path should read like this:

```ts
const Root = View.Slot.make("root", {
  capability: Element.Capability.Container,
});

const Input = View.Slot.make("input", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input],
});

const slots = View.Slots.make({
  root: View.Slot.bind(Root, Element.container()),
  input: View.Slot.bind(Input, Element.textInput()),
});

const Field = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  Component.setup<{}>()
    .value("slots", () => View.Slots.handles(slots)),
  () => View.fromSlots(slots, null, {
    tree: View.element(Root, {
      children: [View.element(Input)],
    }),
  }),
).pipe(
  Component.withSlots(slots),
);

const fieldStyle = Style.forSlots(slots)({
  input: Style.slot({ color: "red" }),
});

const fieldBehavior = Behavior.forSlots(slots)((elements) =>
  Effect.succeed({ inputKind: elements.input.kind }),
);

const StyledField = Field.pipe(
  Style.attachToSlots(fieldStyle, slots),
  Behavior.attachToSlots(fieldBehavior, slots),
);
```

The component author writes the slot identity once. Everything else derives from
that value.

## Correct Component API

The canonical component helper should be:

```ts
Component.withSlots(slots)
```

The public API should say what authors are doing: publishing the component's
slot contract.

Canonical extraction helpers:

```ts
Component.SlotsOf<T>
Component.SlotContractOf<T>
Component.PublicSlotsOf<T>
Component.HiddenSlotsOf<T>
```

Current implementation note:

- Component metadata now carries `SlotContract` as the primary branded field.
- `Component.withSlotContract(...)` is the direct contract helper.
- `Component.withSlots(...)` remains the golden-path authoring helper.
- `Component.withSlots(View.Slots)` now projects `Component.SlotsOf<T>` from
  `View.Slots.HandlesOf<typeof slots>`, so the authored contract wins over a
  stale `bindings.slots` handle-map type.
- `Component.withSlots(View.Slots)` also injects the projected handles into
  setup bindings when the component did not already expose `bindings.slots`.
  This lets view-backed components use behavior attachment without duplicating
  slot maps in setup.
- Component-level witness-named aliases have been removed from the public API.

## Component Type

Collapse the split axes:

```ts
Component<Props, Req, E, Bindings, SlotContract = {}>
```

Then define:

```ts
type SlotsOf<C> =
  SlotContractOf<C> extends View.Slots.Any
    ? View.Slots.HandlesOf<SlotContractOf<C>>
    : never;
```

This makes drift between handles and authored metadata structurally harder. A component
has one slot contract; handle maps, metadata, public/hidden views, diagnostics,
and attach types are derived.

## Style And Behavior API Shape

Standardize public docs on this matrix:

| API | Intended Use |
| --- | --- |
| `Style.forSlots(slots)(...)` | authored style over a slot contract |
| `Style.attachToSlots(style, slots)` | authored attachment to the same contract |
| `Style.attachBySlotContract(style, map)` | typed remapping between style keys and slot contracts |
| `Style.attachBySlots(style, map)` | dynamic/generated string-key mapping |
| `Behavior.forSlots(slots)(...)` | authored behavior over a slot contract |
| `Behavior.attachToSlots(behavior, slots)` | authored attachment to the same contract |
| `Behavior.attachBySlotContract(behavior, map)` | typed remapping between behavior keys and slot contracts |
| `Behavior.attachBySlots(behavior, map)` | dynamic/generated string-key mapping |

The docs should avoid presenting these as equally primary. The first two rows in
each namespace are the golden path.

## Diagnostics

Runtime diagnostics should compare all three surfaces:

1. Declared component slot contract: `Component.SlotContractOf<T>`.
2. Rendered view slots and metadata: `View.fromSlots(...)` / `View.slotMetadata`.
3. Setup/runtime slots when present: `bindings.slots`.

The diagnostic surface covers:

- declared slot is missing from rendered `View.slots`
- rendered `View.slots` contains public slots not declared by the component
- declared slot contract capability does not match rendered metadata
- setup/runtime slot shape disagrees with the declared slot contract when both
  are available
- hidden slots are targeted by normal style/behavior attachment
- route/layout wrappers drop or widen a slot contract

Compile-time checks remain primary for authored code. Runtime diagnostics are
for dynamic/generated code and implementation drift.

Decision: declared-vs-rendered component diagnostics are explicit-only for now.
Normal render paths do not automatically report them. Authors, tests, adapters,
or future dev tools can call the validation helpers where the extra work and
reporting behavior are desired.

Current implementation:

- `Component.withSlots(slots)` stores the authored slot contract in a runtime
  registry as well as the static type axis.
- `Component.getSlotContract(component)` exposes that authored contract for
  inspection.
- `Component.validateSlotContract(component, view, bindings?)` compares a
  rendered `View` with the declared contract.
- `Component.validateRenderedSlotContract(component, props)` runs setup/view and
  returns the diagnostics explicitly. Normal rendering remains unchanged.

## Implementation Slices

### Slice 1: Rename To The Right API

Status: complete.

- Added `Component.withSlots(slots)`.
- Added `Component.SlotContractOf<T>`.
- Added `Component.PublicSlotsOf<T>` and `Component.HiddenSlotsOf<T>` as slot
  contract projections.
- Updated focused type/runtime coverage to use `withSlots`.

### Slice 2: Contract Preservation Audit

Status: complete for the current six-axis implementation.

- The existing wrapper path now preserves the runtime slot contract registry
  while continuing to preserve `SlotContractOf<C>`:
  `withLayer`, `withErrorBoundary`, `withLoading`, `withSpan`, `memo`,
  `tapSetup`, `withViewTransform`, `withPreSetup`, `withSetupRetry`,
  `withSetupTimeout`, `route`, `guard`, `withBehavior`, style attachments,
  behavior attachments, and route-node materialization.
- Runtime coverage verifies preservation across a mixed behavior/layer wrapper
  chain.
- Type coverage verifies preservation across mixed style/behavior/component
  wrapper chains and route-node materialization, including loader-decorated route
  nodes followed by slot-contract-based style/behavior attachment.

### Slice 3: Declared Vs Rendered Diagnostics

Status: explicit diagnostics complete.

- Added explicit helpers:
  - `Component.validateSlotContract(component, view, bindings?)`
  - `Component.validateRenderedSlotContract(component, props)`
- Tests cover matching contracts, missing declared slots, undeclared rendered
  slots, capability mismatches, and wrapper preservation.
- View, Style, and Behavior validation helpers report hidden-slot targets at the
  attachment boundary.
- Decision: keep declared-vs-rendered component diagnostics explicit-only for
  now. Normal rendering remains unchanged; tests, adapters, and future dev tools
  can opt into the validation helpers.

### Slice 4: Documentation And Examples

Status: complete for active docs.

- Added `docs/SLOT_CONTRACT_GOLDEN_PATH.md` and linked it from README/API.
- Golden-path docs show:
  - `View.Slots.make(...)`
  - `View.fromSlots(...)`
  - `Component.withSlots(...)`
  - `Style.forSlots(...)` / `Style.attachToSlots(...)`
  - `Behavior.forSlots(...)` / `Behavior.attachToSlots(...)`
- Direct `slotMetadata` is now described as dynamic/generated or low-level
  adapter surface in active docs.
- Document `attachBySlots(...)` as dynamic/generated, not the authored primary
  API.

### Slice 5: Collapse The Component Slot Axes

Status: complete.

- Added the primary `SlotContract` metadata name and `withSlotContract(...)`
  helper.
- `withSlots(View.Slots)` now derives the public `SlotsOf<T>` handle-map
  projection from the slot contract.
- `withSlots(View.Slots)` now makes the projected handles available to
  setup-time behavior attachment when author setup did not expose
  `bindings.slots`.
- Replaced the internal two-axis split with one `SlotContract` axis.
- Keep `SlotsOf<T>` as the runtime handle-map projection.
- Removed component-level witness-named compatibility aliases from the public
  API.

## Acceptance Criteria

- New authored examples define slot identity once with `View.Slots.make(...)`.
- `Component.withSlots(...)` is the documented component slot contract helper.
- `Component.SlotsOf<T>` and `Component.SlotContractOf<T>` remain precise across
  common wrappers.
- Style and behavior docs present the same slot-contract-first API shape.
- String maps are clearly documented as dynamic/generated APIs.
- Runtime diagnostics can catch drift between declared contract, rendered view,
  and setup/runtime slots.
