# Typed View Tree Plan

This plan defines the next step from the current minimal `View<Slots>` runtime
wrapper toward a typed, renderer-neutral view tree. It is intentionally
incremental: existing JSX/unknown returns must keep working, and
`Component.renderEffect(...)` must continue to return the current runtime node.

## Current State

`View<Slots>` is currently:

```ts
interface View<Slots> {
  readonly slots: Slots;
  readonly node: unknown;
  readonly name?: string;
  readonly metadata?: ViewMetadata;
  readonly slotMetadata?: SlotMetadataMap<Slots>;
  readonly slotRemaps?: readonly SlotRemap<Slots>[];
}
```

This is enough for:

- slot metadata inspection through `Component.renderViewEffect(...)`
- style and behavior attachment validation
- platform diagnostics
- hidden slots and remap diagnostics
- typed holes as standalone values (`View.text`, `View.className`,
  `View.style`, `View.event`, `View.children`, `View.html`)

The missing piece is that the view structure itself is still opaque. The
runtime cannot inspect a renderer-neutral tree unless callers manually encode
metadata on `View.make(...)`.

## Goals

- Add a typed structural tree without requiring a JSX compiler rewrite.
- Preserve the existing `View.make(slots, node, options?)` authoring path.
- Preserve `Component.renderEffect(...)` behavior by continuing to unwrap to
  `View.node(view)`.
- Keep `Component.renderViewEffect(...)` as the inspection boundary.
- Make dynamic holes explicit and inspectable.
- Avoid end-user casts in the public authoring path.
- Keep web as the first concrete renderer while avoiding DOM-only core types.

## Non-Goals

- Do not replace the JSX runtime in the first slice.
- Do not make every component return a typed tree immediately.
- Do not introduce generator-style `View.structure: string` APIs.
- Do not require users to hand-author large IR records for normal UI.
- Do not make `View<Slots>` incompatible with existing code.

## Proposed Model

Add a renderer-neutral tree type that can coexist with the existing `node:
unknown` field:

```ts
type ViewNode<Slots> =
  | ViewElement<Slots>
  | ViewText
  | ViewFragment<Slots>
  | ViewHoleNode;

interface ViewElement<Slots> {
  readonly kind: "view.node.element";
  readonly element: Element.Capability.Any | string;
  readonly slot?: keyof Slots & string;
  readonly props?: ViewProps;
  readonly children?: readonly ViewNode<Slots>[];
}

interface ViewText {
  readonly kind: "view.node.text";
  readonly value: View.TextHoleValue;
}

interface ViewFragment<Slots> {
  readonly kind: "view.node.fragment";
  readonly children: readonly ViewNode<Slots>[];
}

interface ViewHoleNode {
  readonly kind: "view.node.hole";
  readonly hole: View.Hole;
}
```

Then extend `View<Slots>` with optional tree metadata:

```ts
interface View<Slots> {
  readonly slots: Slots;
  readonly node: unknown;
  readonly tree?: ViewNode<Slots>;
}
```

The key compatibility rule is that `node` remains the runtime output. `tree` is
initially metadata for diagnostics, SSR/hydration planning, and future renderer
adapters.

## Public Construction Helpers

The first public helpers should be small and composable:

```ts
View.element(capability, options?)
View.fragment(children)
View.tree(slots, tree, node?, options?)
```

Where:

- `View.element(...)` creates a typed structural element node.
- `View.fragment(...)` groups children without introducing a platform element.
- `View.tree(...)` creates a `View<Slots>` with both `tree` and `node`.
- `View.make(...)` stays unchanged and can optionally accept `tree` later.

The ergonomic first path can be:

```ts
const view = View.tree(
  bindings.slots,
  View.element(Element.Capability.Container, {
    slot: "root",
    children: [
      View.element(Element.Capability.TextInput, {
        slot: "input",
        props: {
          className: View.className(["field", { invalid }]),
          onInput: View.event<InputEvent>((event) => Effect.sync(() => {})),
        },
      }),
    ],
  }),
  jsxNode,
  {
    slotMetadata: {
      input: View.slot("input", {
        capability: Element.Capability.TextInput,
      }),
    },
  },
);
```

No cast should be required. If a helper cannot infer slot names or hole types
without a cast, the helper shape needs to change.

## Typed Holes

Existing hole helpers become the value layer used by typed tree props:

- `View.text(value)` for text-like dynamic content
- `View.className(value)` for class values
- `View.style(value)` for inline style values
- `View.event(handler)` for event handlers with `Req`/`E` metadata
- `View.children(value)` for compatibility children
- `View.html(safeHtml)` for explicitly branded safe HTML only

Next type-level helpers should extract event requirements and errors from a
tree:

```ts
type View.RequirementsOf<T>
type View.ErrorsOf<T>
```

These should start with `View.EventHole` extraction and remain conservative for
opaque `unknown` nodes.

## Static Metadata Extraction

Static metadata should be opt-in and partial at first.

Initial extractable metadata:

- slot names referenced by typed tree nodes
- slot capabilities declared on typed tree nodes
- event hole `Req` and `E`
- safe HTML usage through `View.html(...)`

Deferred metadata:

- complete accessibility model
- complete renderer property support
- automatic component child metadata extraction
- JSX compiler generated tree metadata

## SSR And Hydration Direction

The typed tree should eventually let SSR and hydration inspect renderer-neutral
structure before producing web output. The first slice should not change SSR.

Future SSR/hydration uses:

- detect unsafe or opaque holes before server render
- record hydration boundaries by tree node identity
- serialize safe static tree metadata alongside runtime payloads
- connect event holes to client reactivation metadata

## Migration Path

1. Keep current components returning JSX/unknown or `View.make(...)`.
2. Add typed tree helpers as opt-in metadata.
3. Allow `View.make(..., { tree })` or `View.tree(...)` to carry structure.
4. Add diagnostics that only run when `tree` exists.
5. Add renderer adapters that can consume `tree` but fall back to `node`.
6. Later, teach the JSX transform to emit typed tree metadata where useful.

At every step, existing components should still render through
`Component.renderEffect(...)` without behavior changes.

## First Implementation Slice

Status: complete.

Implement a minimal typed tree layer in `src/View.ts`:

- `ViewNode<Slots>`
- `ViewElement<Slots>`
- `ViewTextNode`
- `ViewFragment<Slots>`
- `ViewHoleNode`
- `View.element(...)`
- `View.fragment(...)`
- `View.textNode(...)`
- `View.hole(...)`
- `View.tree(...)`
- optional `tree?: ViewNode<Slots>` on `View<Slots>`

Tests:

- Type test: `View.element(..., { slot: "input" })` accepts only keys of
  `Slots` when a slot map type is supplied.
- Type test: `Component.renderViewEffect(...)` preserves
  `View.View<Component.SlotsOf<typeof Component>> | undefined` when a component
  returns `View.tree(...)`.
- Runtime test: `View.tree(...)` still unwraps to the provided `node` through
  `Component.renderEffect(...)`.
- Runtime test: `Component.renderViewEffect(...)` exposes `view.tree`.
- Type test: `View.html("raw")` remains rejected; `View.html(SafeHtml.make(...))`
  remains accepted.

Migration constraints:

- Do not change `View.node(...)`.
- Do not change `Component.renderEffect(...)`.
- Do not require existing `View.make(...)` callers to provide a tree.
- Do not require casts in tests or examples for the public path.

## Follow-Up Slices

1. Add tree diagnostics. Status: complete.
   - unknown slot reference inside tree
   - hidden slot reference inside public tree
   - tree slot capability mismatch with `slotMetadata`
2. Add `View.RequirementsOf<T>` / `View.ErrorsOf<T>` extraction for event holes.
3. Add SSR/hydration metadata sketch based on typed tree boundaries.
4. Add optional JSX transform integration that emits tree metadata while
   preserving current runtime node output.

## Open Questions

- Should `View.element(...)` identify elements by `Element.Capability.*`, by
  renderer tag, or by both? First slice should use capability and leave renderer
  tags as metadata.
- Should tree props accept raw primitive values or only explicit hole wrappers?
  First slice should accept explicit holes for metadata-rich fields and allow
  primitives only where the type is unambiguous.
- Should `View.tree(...)` require a `node`, or synthesize one later through a
  renderer? First slice should accept an explicit `node` to preserve runtime
  behavior.
- How much static metadata should be extracted from child components before JSX
  transform support exists? First slice should avoid child component extraction.
