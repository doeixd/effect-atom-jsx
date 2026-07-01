# Slot Witness Plan

This plan defines a first-class slot witness API for AF-UI. The goal is to
replace duplicated slot identity and slot metadata with composable values that
carry runtime metadata and type information together.

## Problem

Today a view usually has two parallel structures:

```ts
const view = View.make(
  {
    root: Element.container(),
    input: Element.textInput(),
  },
  node,
  {
    slotMetadata: {
      root: View.slot("root", {
        capability: Element.Capability.Container,
      }),
      input: View.slot("input", {
        capability: Element.Capability.TextInput,
        allowedEvents: [View.Event.Input],
      }),
    },
  },
);
```

This is workable, but it duplicates slot identity:

- the object key `input`
- the metadata name `View.slot("input", ...)`
- any typed tree reference `View.element(..., { slot: "input" })`
- any style/behavior attachment target `"input"`

The duplication makes drift possible and limits inference. `View.slot(...)` is
currently a metadata record constructor, not a reusable slot identity witness.
It does not bind a handle, carry a stable type identity through generics, or
derive both the `slots` map and `slotMetadata` map from one source.

## Goals

- Make slots first-class branded/type-witness values.
- Let slot witnesses carry name, capability, visibility, events, attributes,
  and platform requirements.
- Derive `View<Slots>` `slots` and `slotMetadata` from bound slot witnesses.
- Preserve the existing `View.make({ slots }, node, { slotMetadata })` path.
- Avoid end-user casts in normal slot authoring and composition.
- Let generic helpers filter, compose, and infer slot names/capabilities/events.
- Keep runtime diagnostics compatible with current `View.slot(...)` metadata.

## Non-Goals

- Do not remove plain object slots or `slotMetadata` in the first slice.
- Do not require all components to migrate at once.
- Do not require JSX transform changes.
- Do not force a class-based fluent API if a pipeable value API fits better.
- Do not hide raw `Element.Handle` values from advanced/runtime code.

## Proposed API Shape

Add a `View.Slot` namespace for slot witnesses:

```ts
const Input = View.Slot.make("input", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input, View.Event.Focus],
  allowedAttributes: [View.Attribute.AriaLabel],
  platformRequirements: [View.Requirement.Keyboard],
});

const Root = View.Slot.make("root", {
  capability: Element.Capability.Container,
});
```

The witness should preserve literal type information:

```ts
type InputName = View.Slot.NameOf<typeof Input>;
// "input"

type InputCapability = View.Slot.CapabilityOf<typeof Input>;
// "TextInput"

type InputEvents = View.Slot.EventsOf<typeof Input>;
// "input" | "focus"
```

The runtime shape can be branded similarly to capability/event/property
witnesses:

```ts
interface Slot<
  Name extends string,
  Capability = never,
  Events extends readonly unknown[] = readonly [],
  Attributes extends readonly unknown[] = readonly [],
  Requirements extends readonly unknown[] = readonly [],
  Hidden extends boolean = false,
> {
  readonly [SlotTypeId]: {
    readonly Name: Name;
    readonly Capability: Capability;
    readonly Events: Events;
    readonly Attributes: Attributes;
    readonly Requirements: Requirements;
    readonly Hidden: Hidden;
  };
  readonly name: Name;
  readonly metadata: View.SlotMetadata<Name>;
}
```

## Composition Helpers

Prefer pipeable helpers so slot definitions compose like the rest of the API:

```ts
const Input = View.Slot.make("input").pipe(
  View.Slot.capability(Element.Capability.TextInput),
  View.Slot.events(View.Event.Input, View.Event.Focus),
  View.Slot.attributes(View.Attribute.AriaLabel),
  View.Slot.requires(View.Requirement.Keyboard),
);

const SecretTrigger = View.Slot.make("trigger").pipe(
  View.Slot.capability(Element.Capability.Interactive),
  View.Slot.hidden,
);
```

Object-style `make(name, options)` should also exist for direct definitions:

```ts
const Input = View.Slot.make("input", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input],
});
```

Both styles must produce the same witness type and runtime metadata.

## Binding Handles

Slot witnesses become useful when bound to runtime handles:

```ts
const bound = View.Slot.bind(Input, Element.textInput());
```

or, if the witness object supports methods:

```ts
const bound = Input.bind(Element.textInput());
```

The static helper is preferable for the first slice because it keeps the runtime
object simple and avoids method variance issues.

Proposed bound slot shape:

```ts
interface BoundSlot<S extends View.Slot.Any, H extends Element.Handle> {
  readonly slot: S;
  readonly handle: H;
}
```

Type helpers:

```ts
type BoundName = View.Slot.NameOf<typeof bound>;
type BoundHandle = View.Slot.HandleOf<typeof bound>;
type BoundMetadata = View.Slot.MetadataOf<typeof bound>;
```

## Slot Collections

Add a `View.Slots` namespace that derives maps from bound slots:

```ts
const slots = View.Slots.make({
  root: View.Slot.bind(Root, rootHandle),
  input: View.Slot.bind(Input, inputHandle),
});
```

Derived data:

```ts
View.Slots.handles(slots);
// { root: rootHandle, input: inputHandle }

View.Slots.metadata(slots);
// { root: View.slot("root", ...), input: View.slot("input", ...) }

type Handles = View.Slots.HandlesOf<typeof slots>;
type Metadata = View.Slots.MetadataOf<typeof slots>;
type Names = View.Slots.NamesOf<typeof slots>;
```

`View.Slots.make(...)` should verify that the object key matches the slot
witness name when literal information is available:

```ts
View.Slots.make({
  // @ts-expect-error key must match witness name
  field: View.Slot.bind(Input, inputHandle),
});
```

## View Construction

Add a constructor that accepts bound slot collections:

```ts
const view = View.fromSlots(
  View.Slots.make({
    root: View.Slot.bind(Root, root),
    input: View.Slot.bind(Input, input),
  }),
  node,
);
```

Equivalent output:

```ts
View.make(
  { root, input },
  node,
  {
    slotMetadata: {
      root: Root.metadata,
      input: Input.metadata,
    },
  },
);
```

`View.fromSlots(...)` should also accept typed tree metadata:

```ts
View.fromSlots(slots, node, {
  tree: View.element(Element.Capability.Container, { slot: "root" }),
});
```

## Generic Inference And Filtering

The primary value of slot witnesses is type-level composition:

```ts
function needsFocusable<S extends View.Slot.Any>(
  slot: S & View.Slot.RequiresCapability<typeof Element.Capability.Focusable>,
) {
  return slot;
}
```

Required helpers:

- `View.Slot.NameOf<T>`
- `View.Slot.CapabilityOf<T>`
- `View.Slot.EventsOf<T>`
- `View.Slot.AttributesOf<T>`
- `View.Slot.RequirementsOf<T>`
- `View.Slot.HiddenOf<T>`
- `View.Slot.HandleOf<T>`
- `View.Slot.MetadataOf<T>`
- `View.Slot.AssignableCapabilityNamesOf<T>`

Collection helpers:

- `View.Slots.HandlesOf<T>`
- `View.Slots.MetadataOf<T>`
- `View.Slots.NamesOf<T>`
- `View.Slots.PublicNamesOf<T>`
- `View.Slots.HiddenNamesOf<T>`
- `View.Slots.WithCapability<T, Capability>`

Capability filtering should reuse `Element.Capability.AssignableNamesOf<T>` so
child capabilities can satisfy parent requirements.

## Relationship To Existing APIs

Keep these APIs:

- `View.slot(name, options?)`
- `View.hidden(name, options?)`
- `View.make(slots, node, options?)`
- `View.tree(slots, tree, node?, options?)`
- `slotMetadata` option

Additive APIs:

- `View.Slot.*`
- `View.Slots.*`
- `View.fromSlots(...)`

Migration guidance:

- New authored components should prefer slot witnesses.
- Generated/dynamic code may continue using strings and `slotMetadata`.
- Existing tests/docs should migrate gradually where witness APIs improve
  clarity or prevent duplication.

## First Implementation Slice

Implement only the core witness path:

1. Add `View.Slot` namespace:
   - `SlotTypeId`
   - `Slot` interface
   - `make(name, options?)`
   - `bind(slot, handle)`
   - extraction helpers
2. Add `View.Slots` namespace:
   - `make(record)`
   - `handles(record)`
   - `metadata(record)`
   - extraction helpers
3. Add `View.fromSlots(boundSlots, node, options?)`.
4. Add runtime tests proving:
   - `fromSlots(...)` derives `slots` and `slotMetadata`
   - hidden slots are diagnosed without duplicating metadata
   - platform/tree diagnostics work with derived metadata
5. Add type tests proving:
   - slot name/capability/event metadata survives through generics
   - mismatched `View.Slots.make(...)` keys fail
   - `View.fromSlots(...)` returns `View<HandlesOf<typeof slots>>`
   - no casts are needed in public authoring examples

## Follow-Up Slices

1. Add pipeable metadata composition helpers:
   - `View.Slot.capability(...)`
   - `View.Slot.events(...)`
   - `View.Slot.attributes(...)`
   - `View.Slot.requires(...)`
   - `View.Slot.hidden`
2. Add capability filtering helpers for behavior/style selection.
3. Migrate API examples from manual `slotMetadata` to slot witnesses.
4. Integrate slot witnesses into typed tree helpers so `View.element(Input, ...)`
   can infer `slot: "input"` directly.
5. Consider de-emphasizing direct `slotMetadata` in docs once witnesses cover
   the common path.

## Open Questions

- Should `View.Slot.make("input")` return a pipeable object with methods, or a
  plain branded value used with static helpers? First slice should prefer a
  plain value plus static helpers.
- Should `View.Slots.make(...)` require object keys to match witness names, or
  allow aliases for remapping? First slice should require matching keys. Remaps
  should stay explicit through `View.remap(...)`.
- Should bound slot handles require capability compatibility at compile time?
  This is desirable, but the first slice can validate through metadata and add
  stricter type constraints after inference is proven ergonomic.
- Should collection slots use `View.Slot.bindCollection(...)` or the same
  `bind(...)` helper? First slice can allow `Element.Collection<Element.Handle>`
  in `bind(...)`.
