# Slot Witness Plan

This plan defines a first-class slot witness API for AF-UI. The goal is to
replace duplicated slot identity and slot metadata with composable values that
carry runtime metadata and type information together.

This plan is historical and is now paired with
[`SLOT_CONTRACT_UNIFICATION_PLAN.md`](SLOT_CONTRACT_UNIFICATION_PLAN.md), which
defines the next step: `View.Slots` becomes the single canonical authored slot
contract object for components, styles, behaviors, diagnostics, and future
renderer integration.

This is a prerelease redesign path, not a compatibility patch. The canonical
authored component model is now the `View.Slots` slot contract. Breaking changes
are acceptable when they remove string drift, improve inference, or make the
public API more coherent. Historical references below to
`Component.withSlotWitnesses(...)`, `Component.SlotWitnessesOf<T>`, or a
separate `SlotWitnesses` component axis are not current API guidance.
Raw `{ slots }` plus `{ slotMetadata }` records are low-level generated/dynamic
inputs, not the primary authored design.

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
- Treat slot witnesses as the canonical authored slot model.
- Keep `View.make({ slots }, node, { slotMetadata })` as a low-level
  generated/dynamic-data path.
- Avoid end-user casts in normal slot authoring and composition.
- Let generic helpers filter, compose, and infer slot names/capabilities/events.
- Keep runtime diagnostics able to consume current `View.slot(...)` metadata.
- Integrate slot witnesses with components, behaviors, styles, typed trees,
  platform diagnostics, and route wrappers.
- Make slot metadata extraction precise enough that wrapper utilities can carry
  slot names and constraints through object arguments, generic parameters, and
  composed records.

## Non-Goals

- Do not require all components to migrate in the first implementation slice.
- Do not require JSX transform changes.
- Do not force a class-based fluent API if a pipeable value API fits better.
- Do not hide raw `Element.Handle` values from advanced/runtime code.
- Do not keep APIs that preserve a split mental model before release. Docs and
  examples should move to witnesses, and direct `slotMetadata` should become a
  low-level generated/dynamic escape hatch.

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
  Capability = Element.Capability.Base,
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

The `Capability` type parameter should retain the actual witness value where
available, not only its printable name. Printable names are derived through
`MetadataToken.NameOf<T>` for diagnostics; generic filtering should use the
witness value so capability hierarchy remains visible.

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

Pipeable helpers must preserve all prior type axes. For example:

```ts
const BaseInput = View.Slot.make("input").pipe(
  View.Slot.capability(Element.Capability.Focusable),
);

const TextInput = BaseInput.pipe(
  View.Slot.capability(Element.Capability.TextInput),
  View.Slot.events(View.Event.Input),
);

type TextInputName = View.Slot.NameOf<typeof TextInput>;
// "input"

type TextInputAssignable = View.Slot.AssignableCapabilityNamesOf<typeof TextInput>;
// "TextInput" | "Focusable" | "Interactive" | "Base"
```

No helper should widen a literal slot name to `string` or erase tuple metadata
unless the caller supplies widened input.

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
interface BoundSlot<
  S extends View.Slot.Any,
  H extends Element.Handle | Element.Collection<Element.Handle>,
> {
  readonly slot: S;
  readonly handle: H;
}
```

Binding should be capability-aware. The target design should reject obviously
wrong bindings at compile time:

```ts
const Input = View.Slot.make("input", {
  capability: Element.Capability.TextInput,
});

View.Slot.bind(Input, Element.textInput());

// @ts-expect-error Container does not satisfy TextInput
View.Slot.bind(Input, Element.container());
```

The rule should use the same hierarchy direction as diagnostics: a handle or
element with a child capability can satisfy a parent slot requirement, but a
parent capability cannot satisfy a child slot requirement.

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
type PublicNames = View.Slots.PublicNamesOf<typeof slots>;
type InputSlots = View.Slots.WithCapability<typeof slots, typeof Element.Capability.TextInput>;
```

`View.Slots.make(...)` should verify that the object key matches the slot
witness name when literal information is available:

```ts
View.Slots.make({
  // @ts-expect-error key must match witness name
  field: View.Slot.bind(Input, inputHandle),
});
```

The collection should itself be a witness-carrying value, not just a plain
object. That lets APIs accept either one slot or a composed slot collection and
still infer names and metadata:

```ts
function attachDisclosure<S extends View.Slots.Any>(slots: S) {
  type Trigger = View.Slots.WithCapability<S, typeof Element.Capability.Interactive>;
}
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

`View.fromSlots(...)` should be the canonical constructor for authored views.
`View.make(...)` remains useful for dynamic/generated views and low-level
runtime construction, but examples should use:

```ts
return View.fromSlots(
  View.Slots.make({
    root: View.Slot.bind(Root, root),
    input: View.Slot.bind(Input, input),
  }),
  node,
  {
    tree: View.element(Root, {
      children: [View.element(Input)],
    }),
  },
);
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
- `View.Slot.IsAssignableTo<T, Capability>`
- `View.Slot.RequiresCapability<Capability>`
- `View.Slot.Public<T>`
- `View.Slot.Hidden<T>`

Collection helpers:

- `View.Slots.HandlesOf<T>`
- `View.Slots.MetadataOf<T>`
- `View.Slots.NamesOf<T>`
- `View.Slots.PublicNamesOf<T>`
- `View.Slots.HiddenNamesOf<T>`
- `View.Slots.WithCapability<T, Capability>`
- `View.Slots.Pick<T, Names>`
- `View.Slots.Omit<T, Names>`
- `View.Slots.Merge<A, B>`
- `View.Slots.Remap<T, Map>`

Capability filtering should reuse `Element.Capability.AssignableNamesOf<T>` so
child capabilities can satisfy parent requirements.

### Inference Requirements

The slot witness API should preserve type information through these forms:

1. Direct value passing:

   ```ts
   function useSlot<S extends View.Slot.Any>(slot: S) {
     type Name = View.Slot.NameOf<S>;
   }

   useSlot(Input);
   ```

2. Object composition:

   ```ts
   const FieldSlots = View.Slots.make({
     root: View.Slot.bind(Root, root),
     input: View.Slot.bind(Input, input),
   });

   type Names = View.Slots.NamesOf<typeof FieldSlots>;
   // "root" | "input"
   ```

3. Generic forwarding:

   ```ts
   function wrap<S extends View.Slots.Any>(slots: S): S {
     return slots;
   }

   type WrappedNames = View.Slots.NamesOf<ReturnType<typeof wrap<typeof FieldSlots>>>;
   ```

4. Composition/remapping:

   ```ts
   const Public = View.Slots.remap(FieldSlots, {
     input: "field",
   });

   type PublicNames = View.Slots.NamesOf<typeof Public>;
   // "root" | "field"
   ```

5. Capability filtering:

   ```ts
   type FocusableSlots = View.Slots.WithCapability<
     typeof FieldSlots,
     typeof Element.Capability.Focusable
   >;
   ```

All of these should work without explicit generic arguments in ordinary
authored code. Generic arguments remain acceptable for library authors and
advanced helper definitions.

### Type-Level Failure Modes

The API should intentionally reject:

- binding a handle whose capability cannot satisfy the slot requirement
- object keys that do not match bound slot witness names
- remapping to duplicate public names unless an explicit merge helper is used
- attaching behavior/style requirements to slots whose capabilities are not
  assignable
- targeting hidden slots unless an explicit hidden/unsafe option is present
- losing literal metadata through helper composition

Where TypeScript cannot prove a dynamic case, runtime diagnostics should remain
available and structured.

## Integration With The Rest Of The Library

### Component

`Component<Props, Req, E, Bindings, Slots, SlotWitnesses>` currently treats
`Slots` as the runtime handle map and `SlotWitnesses` as the authored metadata
implementation axis.

The long-term target is a single slot contract axis, where `View.Slots` is the
component contract and handle maps are derived:

```ts
Component<Props, Req, E, Bindings, SlotContract>
```

Near-term canonical helper:

```ts
const Field = Component.make(...).pipe(
  Component.withSlots(FieldSlots),
);
```

`Component.withSlotWitnesses(...)` should be renamed or hidden before release;
`Component.withSlots(...)` is the right public API.

`Component.SlotsOf<T>` should continue returning the handle map projection,
while `Component.SlotContractOf<T>` should expose the canonical authored slot
contract. `Component.SlotWitnessesOf<T>` is the current implementation
extraction helper and should not be the primary documented concept.

```ts
const FieldSlots = View.Slots.define({
  root: Root,
  input: Input,
});

type FieldHandles = View.Slots.HandlesOf<typeof FieldSlots>;

const Field = Component.make<..., { readonly slots: FieldHandles }>(...);
```

Potential component helpers:

- `Component.slots(FieldSlots)` to allocate/bind handles during setup
- `Component.viewFromSlots(...)` to reduce boilerplate around
  `View.fromSlots(...)`
- `Component.withSlots(FieldSlots)` to publish the authored slot contract
- `Component.SlotContractOf<T>` as the canonical extraction helper

Wrapper transforms (`withLayer`, `guard`, `withBehavior`, style attachments,
behavior attachments, routes) must preserve the authored slot contract.

### Behavior

Behaviors should be able to declare requirements in terms of slot witnesses:

```ts
const NeedsInput = Behavior.forSlots({
  input: Input,
})(...);
```

Benefits:

- behavior event requirements can be compared against `View.Slot.EventsOf<T>`
- behavior capability requirements can use hierarchy-aware slot filtering
- `Behavior.attachBySlots(...)` can accept witness maps instead of string maps
- hidden slots can be rejected at type level for normal attachment

The old string mapping path can remain for generated/dynamic attachments but
should not be the primary authored API.

### Style

Styles should be able to target witnesses:

```ts
const fieldStyle = Style.forSlots({
  root: Root,
  input: Input,
})({
  root: Style.slot({ display: "grid" }),
  input: Style.slot({ color: "red" }),
});
```

or:

```ts
Style.attachToSlots(style, FieldSlots);
```

Benefits:

- style target names come from witnesses
- hidden slot targeting can fail unless explicit
- style diagnostics can include witness metadata
- platform style diagnostics can compose with platform/view slot metadata

### Typed View Tree

Typed tree helpers should accept slot witnesses directly:

```ts
View.element(Root, {
  children: [
    View.element(Input, {
      props: { onInput: View.event<InputEvent>(() => undefined) },
    }),
  ],
});
```

When given a slot witness, `View.element(...)` can infer:

- `slot: View.Slot.NameOf<typeof Input>`
- element capability from the slot capability
- tree/slot capability compatibility by construction

String `slot` options remain useful for dynamic trees, but witness-based tree
authoring should be the primary path.

### View Diagnostics

`View.validateSlotTargets(...)`, `View.validateRemaps(...)`,
`View.validatePlatform(...)`, and `View.validateTree(...)` should all consume
metadata derived from witnesses without callers passing duplicate metadata.

Component-level diagnostics should compare:

- declared component slot contract (`Component.SlotContractOf<T>`)
- rendered `View.slots` / `View.slotMetadata`
- setup/runtime `bindings.slots` when present

This declared-vs-rendered comparison is tracked in
[`SLOT_CONTRACT_UNIFICATION_PLAN.md`](SLOT_CONTRACT_UNIFICATION_PLAN.md).

Diagnostics should still normalize to printable strings, but the source data
should keep witness values so type-level helpers remain precise.

### Routes And Router Runtime

Route-node materialization and route wrappers must preserve slot contract
metadata through `Component.SlotContractOf<T>`.
This matters for nested layouts where styles/behaviors attach above route
children.

Potential route helper:

```ts
Route.componentOf(route).pipe(
  Style.attachToSlots(layoutStyle, LayoutSlots),
);
```

The route layer should not force consumers back to string slot names.

### SSR And Hydration

Slot witnesses give SSR/hydration stable structural identities:

- server render can serialize public slot names and capabilities
- hydration can associate event holes with slot witnesses
- diagnostics can identify unsupported renderer slots before DOM output
- future devtools can show slot witnesses rather than raw string targets

The first slot witness slice should not change SSR output, but the design
should avoid choices that prevent these uses.

## Relationship To Existing APIs

Low-level generated/dynamic APIs:

- `View.slot(name, options?)`
- `View.hidden(name, options?)`
- `View.make(slots, node, options?)`
- `View.tree(slots, tree, node?, options?)`
- `slotMetadata` option

New canonical APIs:

- `View.Slot.*`
- `View.Slots.*`
- `View.fromSlots(...)`
- future pipeable `View` transforms for authored tree composition

Authoring guidance:

- New authored components should prefer slot witnesses.
- Generated/dynamic code may use strings and `slotMetadata`.
- Existing tests/docs should migrate aggressively where witness APIs improve
  clarity or prevent duplication.
- Direct `slotMetadata` should be documented as low-level/dynamic.

## First Implementation Slice

Status: complete.

Implement the core witness path, accepting breaking changes where they improve
the canonical model:

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
   - wrong handle capability bindings fail where statically knowable
   - component/style/behavior helpers preserve witness metadata through at least
     one wrapper chain
   - no casts are needed in public authoring examples
6. Update at least one API example to use slot witnesses as the preferred path.

## Follow-Up Slices

1. Add pipeable metadata composition helpers: **Complete**
   - `View.Slot.capability(...)` — updates slot capability while preserving all other metadata
   - `View.Slot.events(...)` — updates slot allowed events
   - `View.Slot.attributes(...)` — updates slot allowed attributes
   - `View.Slot.requires(...)` — updates slot platform requirements
   - `View.Slot.hidden` — marks slot as hidden
   - All helpers preserve type information through pipe chains
   - Runtime and type tests verify composition works correctly
2. Add capability filtering helpers for behavior/style selection: **Complete**
   - `View.Slots.withCapability(slots, capability)` — runtime filtering of slots by capability
   - `Behavior.attachToAllWithCapability(behavior, capability)` — attaches behavior to all slots matching capability
   - `Style.attachToAllWithCapability(style, capability)` — attaches style to all slots matching capability
   - All helpers support both string and witness-based capabilities
   - Runtime tests verify filtering and attachment work correctly
   - Behavior/style capability attachment now uses the same hierarchy-aware matching as View diagnostics and filtering
3. Migrate API examples from manual `slotMetadata` to slot witnesses.
4. Integrate slot witnesses into typed tree helpers: **Initial slice complete**
   - `View.element(Input, ...)` now infers the element capability and `slot: "input"` directly from the slot witness
   - Type coverage verifies witness-authored trees can be passed to `View.fromSlots(...)`
5. Consider de-emphasizing direct `slotMetadata` in docs once witnesses cover
   the common path.
6. Add component slot witness metadata: **Initial slice complete**
   - `Component.Component` now carries a sixth `SlotWitnesses` implementation axis.
   - `Component.SlotWitnessesOf<T>` extracts the authored witness metadata.
   - `Component.withSlotWitnesses(...)` publishes witness metadata on a component.
   - Component wrappers and route metadata helpers preserve the witness axis.
   - Next design slice: replace the public naming with `Component.withSlots(...)` and `Component.SlotContractOf<T>`.
7. Add behavior/style witness-targeted APIs: **Historical slice complete, naming superseded**
   - `Style.forSlots(...)` builds composed styles from a slot witness record
   - `Style.attachToSlots(...)` attaches a style to a `View.Slots` collection by witness-derived names
   - Historical name: `Style.attachBySlotWitnesses(...)` and
     `Behavior.attachBySlotWitnesses(...)` mapped style/behavior element keys
     through slot witnesses instead of duplicated string slot maps.
   - Current release-facing name:
     `Style.attachBySlotContract(...)` and
     `Behavior.attachBySlotContract(...)`.
   - Runtime coverage verifies witness-targeted style and behavior attachment
   - Example/docs update is still pending
8. Make `View<Slots>` pipeable and add pipeable View transform helpers: **Complete**
   - `View.make(...)`, `View.tree(...)`, and `View.fromSlots(...)` return records with `.pipe(...)`, matching the slot witness authoring style.
   - `View.make(slots, node, options?)` remains the low-level constructor; no zero-argument builder was added.
   - Added transform helpers:
     - `View.withTree(tree)`
     - `View.withChildren(...children)`
     - `View.appendChildren(...children)`
     - `View.withName(name)`
     - `View.withMetadata(metadata)`
     - `View.withSlotMetadata(metadata)`
     - `View.withRemaps(...remaps)`
   - `View.withChildren(...)` / `View.appendChildren(...)` operate on `view.tree`: append to existing fragments/elements where possible, create a fragment when no tree exists, and wrap text/hole roots in a fragment.
   - `View.children(...)` remains the dynamic children hole helper.
   - Type coverage proves transforms preserve `View.SlotsOf<T>`.
   - Runtime coverage proves transforms do not change `View.node(...)` unwrapping.
9. Execute slot contract unification: **Planned**
   - `View.Slots` becomes the single canonical authored slot contract object.
   - `Component.withSlots(...)` becomes the component helper.
   - `Component.SlotContractOf<T>` becomes the extraction helper.
   - Add diagnostics for drift between declared contract, rendered view slots,
     and setup/runtime `bindings.slots`.
   - Collapse the two-axis `Slots` / `SlotWitnesses` implementation into one
     `SlotContract` axis before release.

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
