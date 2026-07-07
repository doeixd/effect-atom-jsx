# Gen2 UI Implementation Notes

Source inspected: `../gen2`, especially:

- `../gen2/src/ui/ui.ts`
- `../gen2/src/gen/ui-backends.ts`
- `../gen2/tests/ui.test.ts`
- `../gen2/tests/ui-generic.test.ts`
- `../gen2/tests/ui-attachment.test.ts`
- `../gen2/gen-ui-implementation-plan.md`
- `../gen2/docs/spec.md`

## Summary

`gen2` has a real UI implementation, but it is a static/generator IR rather than a runtime JSX view system.

It is useful for AF-UI because it already models the same architectural ideas:

- element capabilities
- typed slots
- views as inspectable data
- components containing views
- styles and behaviors attaching to slots
- slot remapping
- platform/renderer metadata
- hidden slots
- safe HTML branding
- attachment diagnostics

It should not be copied wholesale into this repo because `effect-atom-jsx` is a runtime JSX library with Effect, atoms, scopes, and DOM/runtime integration. `gen2` is closer to a generator/catalog representation.

## What Gen2 Implements

### Element Capabilities

`gen2/src/ui/ui.ts` defines:

```ts
export type ElementCapabilityKind =
  | "Base"
  | "Container"
  | "Text"
  | "Interactive"
  | "TextInput"
  | "NumberInput"
  | "Select"
  | "Form"
  | "Label"
  | "Field"
  | "Table"
  | "Row"
  | "Cell"
  | "Collection";

export interface ElementCapability {
  readonly kind: ElementCapabilityKind;
  readonly inner_capability?: ElementCapability;
  readonly collection_item?: ElementCapability;
}
```

Constructors:

- `cap(kind)`
- `collection(item)`
- `container(inner)`

Relevance for this repo:

- This maps conceptually to `src/Element.ts`, but `effect-atom-jsx` element capabilities are runtime handles with operations.
- Gen2 capabilities are static descriptors.
- We can reuse the descriptor idea for view metadata, but runtime behavior should still use current `Element.Handle` interfaces.

### Slot

Gen2 slot shape:

```ts
export interface Slot<E = unknown, C extends ElementCapability = ElementCapability> {
  readonly _element?: E;
  readonly _capability?: C;
  readonly name: string;
  readonly capability: ElementCapability;
  readonly owning_view?: View;
  readonly allowed_attributes: readonly string[];
  readonly allowed_events: readonly string[];
  readonly platform_requirements: readonly string[];
  readonly hidden: boolean;
}
```

Important details:

- `E` is a phantom platform element type.
- `C` is a phantom capability type.
- `hidden` allows internal structure that cannot be styled/behaved against externally.
- allowed attributes/events/platform requirements are diagnostic metadata.

Relevance for this repo:

- Current slots are runtime handles in `bindings.slots`.
- AF-UI should probably add a lightweight slot metadata record eventually:
  - name
  - runtime handle/capability
  - hidden flag
  - optional platform/event/style metadata

### View

Gen2 view shape:

```ts
export interface View<
  E = unknown,
  S extends Record<string, ElementCapability> = Record<string, ElementCapability>,
> {
  readonly _element?: E;
  readonly backend?: string;
  readonly _slots?: S;
  readonly name: string;
  readonly slots: readonly Slot<E>[];
  readonly structure: string;
  readonly slot_remaps: readonly SlotRemap<E>[];
  readonly target_platforms: readonly Platform<E>[];
}
```

Important limitation:

- `structure` is currently just a `string`.
- `../gen2/gen-ui-implementation-plan.md` explicitly calls this a placeholder and proposes a typed `ViewTree`.

Relevance for this repo:

- Gen2 proves the useful shape of view metadata.
- It does not provide the runtime `View<Slots>` with JSX node output or typed Effect holes that AF-UI wants.
- We should adapt the shape with a runtime-native payload, for example:

```ts
interface View<Slots> {
  readonly slots: Slots;
  readonly node: unknown;
  readonly remaps?: readonly SlotRemap[];
}
```

### Slot Remapping

Gen2 has:

```ts
export interface SlotRemap<E = unknown> {
  readonly source: Slot<E>;
  readonly target: Slot<E>;
}
```

It validates remap capability compatibility in `checkUi`.

Relevance for this repo:

- This is worth porting conceptually.
- AF-UI component composition needs slot remapping so a wrapper can expose renamed slots without leaking child internals.

### Component

Gen2 component shape:

```ts
export interface Component<P = unknown, E = unknown> {
  readonly name: string;
  readonly props_type: string;
  readonly _props?: P;
  readonly requirements: readonly string[];
  readonly errors: readonly ErrorType[];
  readonly bindings: readonly string[];
  readonly view: View<E>;
}
```

Important limitation:

- Requirements and bindings are string metadata, not Effect `R`/`E` types.
- This is generator metadata, not an executable runtime component.

Relevance for this repo:

- Do not port this directly.
- This repo already has a stronger runtime component type:

```ts
Component<Props, Req, E, Bindings, Slots>
```

- The part to borrow is “component contains a view,” not the stringly component representation.

### Style

Gen2 style shape:

```ts
export interface Style<T extends string = string, E = unknown> {
  readonly name: string;
  readonly slot_styles: readonly SlotStyle<T>[];
  readonly target_view?: View<E>;
}
```

Attachment:

```ts
attachStyleToView(style, view)
```

Validation rejects:

- unknown slot
- hidden slot

Relevance for this repo:

- Current `src/Style.ts` already has richer runtime style composition.
- Gen2’s explicit `target_view` and validation diagnostics are useful.
- AF-UI should eventually expose both compile-time slot safety and runtime diagnostics for dynamic/generated style attachments.

### Behavior

Gen2 behavior shape:

```ts
export interface Behavior<
  R extends Record<string, ElementCapability> = Record<string, ElementCapability>,
  E = unknown,
> {
  readonly name: string;
  readonly required_slots: readonly BehaviorSlot[];
  readonly attached_view?: View<E>;
  readonly body: string;
  readonly allowed_events: readonly string[];
  readonly _required?: R;
}
```

Attachment:

```ts
attachBehaviorToView(behavior, view)
```

Validation rejects:

- unknown slot
- incompatible capability
- collection behavior on non-collection slot

Relevance for this repo:

- Current `src/Behavior.ts` has executable Effect behavior logic, which is stronger.
- Gen2’s validation model is still worth adapting for dynamic or generated attachments.
- The static `allowed_events` idea can inform platform diagnostics.

### Platform And Renderer

Gen2 models:

```ts
export interface Platform<E = unknown> {
  readonly _element?: E;
  readonly backend?: string;
  readonly name: string;
  readonly element_capabilities: readonly ElementCapability[];
  readonly event_model: readonly string[];
  readonly attribute_model: readonly string[];
  readonly renderer_name: string;
  readonly host_capabilities: readonly string[];
}

export interface Renderer<E = unknown> {
  readonly name: string;
  readonly target_platform: Platform<E>;
  readonly supported_capabilities: readonly string[];
}
```

Relevance for this repo:

- AF-UI should eventually have this platform boundary.
- For now, web can remain the only concrete platform.
- Platform metadata is useful for docs, diagnostics, and future TUI/native support.

### Safe HTML

Gen2 has:

```ts
export type SafeHtml = string & { readonly _safeHtmlBrand: unique symbol };
export const safeHtml = (html: string): SafeHtml => html as SafeHtml;
```

Important caveat in source:

- It brands only.
- It does not sanitize.

Relevance for this repo:

- This is directly relevant to typed holes.
- AF-UI should require a branded `SafeHtml` for raw HTML holes.
- The branding helper should clearly document that sanitization is caller responsibility unless a sanitizer helper is added.

## Gen2 Diagnostics Worth Porting

`checkUi` catches:

- duplicate slots in a view
- collection slot missing item capability
- slot capability unsupported by target platform
- style targets unknown/hidden slot
- behavior slot capability mismatch
- collection behavior on non-collection slot
- invalid theme token
- component hides every slot
- missing UI service
- slot remapping incompatible capability
- style property unsupported by platform
- behavior event unsupported by platform
- backend/platform mismatch

Relevance for this repo:

- Compile-time typing should catch most library-authored mistakes.
- Runtime diagnostics still matter for generated views, dynamic attachments, plugin-defined components, and devtools.

## Gen2 ViewTree Plan

`../gen2/gen-ui-implementation-plan.md` proposes extending `View` with a typed tree:

```ts
export type UiNode<E = unknown> =
  | UiElementNode<unknown, E, Record<string, ComponentSlotSpec>>
  | UiTextNode
  | UiFragmentNode<E>
  | UiRepeatNode<unknown, E>
  | UiConditionalNode<E>;

export interface ViewTree<E = unknown> {
  readonly kind: "ui.viewTree";
  readonly root: UiNode<E>;
}
```

Then:

```ts
interface View<...> {
  readonly tree?: ViewTree<E>;
}
```

Relevance for this repo:

- This is useful directionally, but it is still a plan in `gen2`.
- AF-UI should not start by building the full static IR.
- Better first step here:
  - add minimal runtime `View<Slots>`
  - keep current JSX output as `node`
  - add optional metadata fields that can later grow into a tree

## Recommended Adaptation For This Repo

The AF-UI roadmap in `docs/AF_UI_CONTRACT.md` now explicitly incorporates the best `gen2` pieces:

- view records
- slot metadata
- hidden slots
- slot remapping
- attachment diagnostics
- capability checks
- collection-slot diagnostics
- safe HTML branding
- platform/event/attribute metadata
- renderer-boundary diagnostics

### Do Port Conceptually

- Slot metadata shape:
  - name
  - capability
  - hidden
  - allowed events/attrs later
- View as inspectable data:
  - slots
  - node/render payload
  - optional remaps
- SafeHtml brand.
- Runtime validation helpers for dynamic attachments.
- Slot remapping compatibility checks.
- Platform phantom/metadata concepts.

### Do Not Port Directly

- `Component.props_type: string`
- `Component.bindings: readonly string[]`
- `Behavior.body: string`
- `View.structure: string` as the main structure model
- generator namespace shape as the runtime API

### Proposed First AF-UI Runtime Shape

```ts
export interface View<Slots> {
  readonly [ViewTypeId]: {
    readonly Slots: Slots;
  };
  readonly slots: Slots;
  readonly node: unknown;
}

export function make<Slots>(
  slots: Slots,
  node: unknown,
): View<Slots>;

export function isView(value: unknown): value is View<unknown>;
```

Then `Component.make` can gradually support view returns:

```ts
view: (props, bindings) => unknown | View<Slots>
```

Current migration path:

1. Keep existing JSX output valid.
2. Use `View.Slots` plus `View.fromSlots(slots, jsx)` for authored
   slot-bearing views.
3. Keep `View.make(slots, jsx)` as the lower-level/dynamic constructor.
4. Preserve authored component contracts with `Component.withSlots(slots)` and
   `Component.SlotContractOf<T>`.
5. Keep evolving the optional typed tree / hole model without breaking
   `node: unknown` compatibility.

## Conclusion

`gen2` confirms the AF-UI direction and gives us several concrete design pieces, especially around slot metadata, static diagnostics, platform phantom typing, hidden slots, safe HTML, and attachment validation.

It does not remove the need to keep adapting runtime `View<Slots>` in this
repo. The correct path is the small runtime-native `View` module already
started here, not a direct transplant of `gen2`'s generator IR.
