# AF-UI Contract

This document is the source of truth for aligning `effect-atom-jsx` with the AF-UI vision. It describes the target model the implementation should converge on; older design notes remain useful, but this contract wins when documents disagree.

## Thesis

AF-UI is an Effect-native UI algebra built around an inside-out component model:

```text
Component<Props, Req, E, Bindings, Slots> -> View<Slots>
```

Components own logic and state. Views own structure. Slots are the public structural API. Styles and behaviors attach from the outside to those slots. Runtime services provide routing, reactivity, single-flight, hydration, rendering, and platform integration.

## Core Boundaries

### Element

An element is a platform capability, not a DOM type. `Element.Interactive`, `Element.Container`, `Element.TextInput`, and collections describe what a slot can do. Web, TUI, and native renderers interpret those capabilities differently.

Elements expose operations such as:

- lifecycle-scoped listeners
- attributes and ARIA
- reactive style writes
- focus/input/collection operations where supported

Application components should depend on element capabilities, not browser-only APIs.

### Slot

A slot is a named element capability exposed by a view:

```ts
type ButtonSlots = {
  readonly root: Element.Interactive;
  readonly label: Element.Handle;
};
```

Slots are the public structural interface consumed by styles and behaviors. A component can hide internal children by not exposing them as slots.

### View

A view is the structural skeleton of a component plus its slot map:

```ts
interface View<Slots> {
  readonly slots: Slots;
}
```

The target model is not "component returns opaque JSX". JSX is authoring syntax for a typed view. The implementation may use the current JSX runtime internally while moving toward explicit view metadata, but the public contract is `View<Slots>`.

### Component

A component separates setup from structure:

```ts
interface Component<Props, Req, E, Bindings, Slots> {
  (props: Props): View<Slots>;
  readonly type: {
    readonly Props: Props;
    readonly Req: Req;
    readonly E: E;
    readonly Bindings: Bindings;
    readonly Slots: Slots;
  };
}
```

- `Props` are caller inputs.
- `Req` is the Effect environment required by setup, children, styles, behaviors, loaders, or routes.
- `E` is the typed error channel.
- `Bindings` are logical state created during setup.
- `Slots` are structural element handles exposed by the view.

Requirement and error bubbling are part of the contract: rendering a child component, attaching a behavior, attaching a style, adding a loader, or providing a local layer must transform the component's `Req` and `E` types predictably.

### Behavior

A behavior is an active slot consumer:

```ts
Behavior<Elements, Bindings, Req, E>
```

Behaviors attach listeners, attributes, visibility, focus logic, keyboard handling, and other interaction directly to element handles. They do not rely on prop spreading. Cleanup is scoped through Effect lifecycle management.

Attachment must be slot-safe:

- unknown slot names fail type-checking
- incompatible element capabilities fail type-checking
- collection behaviors manage per-item attach and cleanup

### Style

A style is platform-agnostic appearance data over slots:

```ts
Style<Slots>
```

Styles are not component internals. They are external attachments interpreted by the active renderer/platform. The style system owns:

- typed tokens and theme service integration
- slot style composition
- variants and recipes
- reactive property updates
- nested/internal selectors where appropriate
- responsive, media, and container query descriptors
- style handles and overrides

Style merge order is:

```text
Theme -> Recipe -> Variant -> Utility -> Handle Override
```

### Route

Routes are pipeable metadata over components or route nodes. The canonical route model is schema-first:

- path params, query, hash, headers, cookies, and bodies decode with Effect Schema where applicable
- loaders produce `Result<A, E>` state
- loader requirements and errors bubble into route/runtime types
- title and metadata can derive from params and loader snapshots
- guards and error boundaries are typed transforms

### Reactivity

Reactivity is semantic, key-based invalidation:

```ts
Reactivity.tracked(effect, { keys })
Reactivity.invalidating(effect, keys)
```

Services, atoms, route loaders, styles, and behaviors should participate through the library-owned `Reactivity` service. Invalidating a semantic key refreshes observers of that key without coupling writers to specific atoms or components.

### SingleFlight

SingleFlight bundles mutation execution and affected loader refresh into one transport-aware round trip. Loader selection should prefer captured reactivity keys and fall back to matched loaders where needed.

The preferred client API is action-based; low-level route single-flight helpers are implementation/runtime tools.

### Hydration

Hydration is a service/layer boundary, not an incidental script helper. It owns server snapshots, client seeding, validation, and selective inclusion/exclusion of state.

The SSR target is zero-flicker bootstrapping: route loader data and dehydrated atoms are available before the client component tree first reads them.

### Platform

The platform layer bundles:

- renderer
- element vocabulary
- event system
- style interpreter
- hydration hooks
- server/client document integration where relevant

Web is the first production target. TUI/native support can remain interface-first until the web contract is solid, but framework code should not make DOM coupling part of component, behavior, or style types.

## Current Project Plan

### Current Checkpoint

As of 2026-06-23, AF-UI convergence has started in this repo.

Completed in the current checkpoint:

- Added this canonical contract doc.
- Added `docs/GEN2_UI_IMPLEMENTATION_NOTES.md` after inspecting `../gen2`.
- Added project-level `AGENTS.md` with source-of-truth and migration guidance.
- Added an explicit fifth `Slots` type axis to `Component.Component`.
- Added `Component.SlotsOf<T>`.
- Updated behavior/style slot attachment paths to preserve component slot metadata.
- Added type coverage using `Component.SlotsOf<T>` for behavior and style attachment.
- Added minimal runtime-native `View<Slots>` with `View.make`, `View.isView`, `View.node`, and `View.SlotsOf<T>`.
- Made component render paths unwrap `View.node` while preserving existing JSX/unknown returns.
- Added initial slot metadata, hidden slot, remap, and diagnostics helpers on `View`.
- Added style/behavior validation helpers that consume `View` diagnostics before dynamic/generated attachments.
- Verified the code with:
  - `npm run typecheck`
  - `npm test`
  - `npm run build`

Current state:

- Components now carry slot metadata at the type level.
- Existing components still generally expose runtime handles through `bindings.slots`.
- Runtime view functions can return JSX-like `unknown` or an opt-in `View<Slots>`.
- `View<Slots>` exists as a minimal wrapper around current runtime output; typed holes and static view trees are still future work.
- `View` can carry optional slot metadata, hidden slots, and remaps; validation helpers can diagnose unknown/hidden targets and incompatible remaps.
- `Style` and `Behavior` expose validation helpers for checking attachments against `View` metadata without changing existing attach semantics.

### Primary Goal

Move the project from “Effect atoms plus JSX runtime with component/style/behavior modules” to AF-UI:

```text
Component<Props, Req, E, Bindings, Slots> -> View<Slots>
```

AF-UI should provide:

- typed component setup with Effect `Req` and `E`
- typed structural slots as the public customization API
- styles and behaviors attached from outside the component
- semantic reactivity and single-flight-driven data refresh
- route-node-first routing with typed loaders and server routes
- SSR/hydration with seeded data available before first client render
- web runtime first, with platform boundaries that do not bake DOM assumptions into component/style/behavior types

### Gen2 Incorporation Goals

`../gen2` already solved several static UI contract problems. AF-UI should incorporate the best parts, adapted to this runtime library.

Adopt into AF-UI:

- **Explicit view records:** `View` as inspectable data, not opaque JSX only.
- **Slot metadata:** name, capability, hidden/public status, platform requirements, allowed events/attributes where useful.
- **Hidden slots:** internal handles that cannot be targeted by external style/behavior attachments.
- **Slot remapping:** wrapper views/components can remap child slots to public slots.
- **Attachment diagnostics:** runtime validation for dynamic/generated style and behavior attachments.
- **Capability compatibility checks:** behavior/style attachments should validate required element capabilities.
- **Collection-slot diagnostics:** collection behaviors must target collection slots with compatible item capabilities.
- **Platform metadata:** renderer/platform capabilities, event model, attribute model, host capabilities.
- **Safe HTML brand:** raw HTML holes require an explicit trusted/sanitized value.
- **Backend boundary idea:** JSX/web is the first concrete runtime, but the core view/slot/style/behavior contracts should not hardcode web-only semantics.

Do not adopt directly:

- `View.structure: string` as the primary structure model.
- `Component.props_type: string`.
- `Component.bindings: readonly string[]`.
- `Behavior.body: string`.
- `gen.ui.*` generator namespace shape as the runtime API.
- Static generator-only assumptions that do not fit Effect scopes, atoms, or live element handles.

Integration rule:

When porting from `gen2`, preserve the **contract idea** and redesign the **runtime shape** around this repo's existing `Effect`, `Atom`, `Component`, `Element.Handle`, `Behavior`, and `Style` modules.

### Milestone 1: Slot Metadata Foundation

Status: mostly complete.

Done:

- `Component.Component` carries `Slots`.
- `Component.SlotsOf<T>` exists.
- `Behavior.attachBySlots` preserves slots.
- `Style.attach` / `Style.attachBySlots` preserve slots.
- Type tests exercise `SlotsOf`.

Remaining:

- Add a direct component-slot attach helper where useful so callers do not need to thread `Bindings` generics manually in strict cases.
- Add negative type tests for `Component.SlotsOf<T>` on styles, not only behavior mappings.
- Audit all component transforms to make sure they preserve `SlotsOf<C>`.

### Milestone 2: Minimal Runtime View

Status: complete for the minimal runtime wrapper.

Goal:

Introduce a small runtime-native `View<Slots>` module inspired by `../gen2`, but not copied from it.

Candidate first shape:

```ts
export const ViewTypeId: unique symbol = Symbol.for("effect-atom-jsx/View");

export interface View<Slots> {
  readonly [ViewTypeId]: {
    readonly Slots: Slots;
  };
  readonly slots: Slots;
  readonly node: unknown;
}

export function make<Slots>(slots: Slots, node: unknown): View<Slots>;
export function isView(value: unknown): value is View<unknown>;
export type SlotsOf<T> = T extends View<infer Slots> ? Slots : never;
```

Gen2 features to include in this milestone if they stay small:

- `ViewTypeId`
- `View.SlotsOf<T>`
- optional `name?: string`
- optional `metadata?: ViewMetadata`
- enough structure to add hidden slots/remaps later without breaking the type

Acceptance:

- Existing JSX return values keep working — done.
- Components can opt into returning `View<Slots>` — done.
- `Component.renderEffect` unwraps `View.node` for current runtime behavior — done.
- Component type metadata can be inferred from current binding slot compatibility path — done.
- Type tests show `View.SlotsOf` and `Component.SlotsOf` for view-backed components — done.

Non-goal for this milestone:

- Do not redesign the JSX compiler.
- Do not implement `View.gen`, typed holes, or full static view trees yet.

### Milestone 3: View-Aware Component API

Status: partially complete.

Goal:

Make `Component.make` and related helpers understand view-backed components.

Work:

- Add overloads or helpers for view-returning component definitions — initial support done.
- Preserve existing `Component.make(..., view: () => unknown)` compatibility.
- Add explicit `Component.view(...)` or `View.from(...)` helper if overload inference gets awkward.
- Ensure transforms preserve slots when internal bindings change, especially route wrappers and behavior attachments.

Acceptance:

- A component can expose slots without requiring the public slot map to be derived only from `bindings.slots`.
- Style/behavior attach types target component slot metadata directly.
- Existing examples and tests keep passing.

### Milestone 4: Runtime Diagnostics From Gen2 Ideas

Status: partially complete at the View/style/behavior validation layer.

Goal:

Adapt the useful `gen2` diagnostics to this runtime library.

Portable diagnostics:

- duplicate slot names where applicable
- style targets unknown slot — available through `Style.validateAttachment` and `Style.validateAttachmentBySlots`
- behavior targets unknown slot — available through `Behavior.validateAttachmentBySlots`
- behavior capability mismatch
- collection behavior on non-collection slot
- style/behavior targets hidden slot — available through the View, Style, and Behavior validation helpers
- slot remapping capability mismatch — available through `View.validateRemaps`
- unsafe HTML without branded `SafeHtml` once HTML holes exist
- unsupported style property for active platform once platform metadata exists
- unsupported behavior event for active platform once platform metadata exists
- component hides all public handles once hidden slots exist

Acceptance:

- Compile-time checks remain primary for typed code.
- Runtime diagnostics exist for dynamic/generated attachments.
- Style and behavior validation helpers can be called before attachment.
- Diagnostics are structured enough for tests and devtools.

### Milestone 5: Slot Metadata, Hidden Slots, And Remapping

Status: initial View-level support complete.

Goal:

Move from a plain slot map to richer slot metadata where needed.

Work:

- Add optional slot metadata records inspired by `gen2`:
  - name
  - capability
  - hidden
  - allowed events/attributes
  - platform requirements
- Add slot remapping helpers for wrapper components.
- Keep the simple handle map ergonomic for normal runtime code.

Acceptance:

- Wrapper components can describe renamed child slots through `View.remap`.
- Hidden/internal slots can be diagnosed by `View.validateSlotTargets`.
- Remapping rejects incompatible capabilities through `View.validateRemaps`.

### Milestone 6: Typed Holes And Safe HTML

Status: design only.

Goal:

Define the typed dynamic surface inside views.

Work:

- Add `SafeHtml` brand.
- Add `safeHtml(...)` branding helper with clear documentation that it does not sanitize.
- Consider a future sanitizer helper, but do not imply branding performs sanitization.
- Define hole taxonomy:
  - text
  - class
  - style
  - attribute/ARIA
  - handler
  - ref
  - children
  - HTML
- Decide which holes can be runtime helpers and which require JSX transform support.

Acceptance:

- Unsafe raw HTML is rejected without a branded safe value.
- Event/style/class holes can carry typed errors or requirements where appropriate.
- The design does not force a full compiler rewrite before useful runtime APIs ship.

### Milestone 7: Style Surface Consolidation

Status: pending.

Goal:

Turn current `Style` plus advanced descriptors into one public style story.

Work:

- Document stable style APIs.
- Mark experimental descriptors if needed.
- Confirm slot attachment docs use `Component.SlotsOf<T>` / view slots.
- Keep examples focused:
  - styled card
  - styled combobox
  - recipe/variant example
  - token/theme example

Acceptance:

- One style guide covers utilities, recipes, variants, tokens, nesting, responsive/media/container descriptors, and overrides.
- Public docs do not imply separate `Style2` as a competing system.

### Milestone 8: Route-Node Golden Path

Status: pending.

Goal:

Promote one routing model.

Work:

- Decide whether route nodes are the canonical path.
- Position component-route helpers as transitional/ergonomic wrappers if needed.
- Update examples around:
  - nested layout
  - params/query/hash schemas
  - typed links
  - loaders
  - loader result/error handling
  - metadata/head
  - server route execution

Acceptance:

- One nested router example demonstrates the full golden path.
- Docs stop presenting multiple route APIs as equally primary.

### Milestone 9: SSR, Hydration, And SingleFlight Product Example

Status: pending.

Goal:

Prove zero-flicker data continuity.

Work:

- Add or update an SSR example where route loader data is available synchronously on first client render.
- Connect loader payloads, atom snapshots, hydration service, and single-flight seeds.
- Document the layer workflow clearly.

Acceptance:

- Example covers server render, payload injection, client hydration, and post-mutation refresh.
- Tests prove seeded loader data does not initially render loading state.

### Milestone 10: Release Hardening

Status: ongoing.

Required before release checkpoints:

- `npm run typecheck`
- `npm test`
- `npm run build`
- update `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md`
- update README/API examples where public surface changed
- add type tests for public type guarantees
- label stale exploratory docs as historical or superseded

### Milestone 11: Platform Metadata And Renderer Boundary

Status: pending.

Goal:

Adopt the useful parts of gen2 `Platform<E>` / `Renderer<E>` without forcing a second renderer implementation yet.

Work:

- Define lightweight platform metadata:
  - element capabilities
  - event model
  - attribute/style support
  - host capabilities
  - renderer name/id
- Keep web as the only concrete runtime initially.
- Use platform metadata for diagnostics before using it for code generation.

Acceptance:

- Style/behavior diagnostics can explain unsupported events/properties for a platform.
- Core component/style/behavior types still do not expose browser-only types as their architectural contract.

## Current Implementation Gap Map

The repo already has broad coverage for atoms, components, behaviors, styles, routing, reactivity, single-flight, server routes, hydration, tests, and examples. The remaining work is convergence.

### Gap 1: Component Slots Are Not First-Class Enough

Status: partially addressed.

Current `Component.Component` now tracks `Props`, `Req`, `E`, `Bindings`, and `Slots`, but runtime slots still mostly live inside `Bindings` conventions such as `{ slots }`.

Target:

- add `Slots` to the component type model
- make view/slot metadata explicit
- keep current bindings-compatible path during migration

Acceptance:

- a component exposes a typed `Slots` parameter — done
- `Behavior.attachBySlots` and `Style.attachBySlots` preserve component slot metadata — done
- view-backed components can expose slots without relying only on `bindings.slots` — pending

### Gap 2: View Is Still Mostly Opaque Runtime Output

Current views return `unknown`/JSX-like values. The target contract is `View<Slots>`.

Target:

- define a minimal `View<Slots>` type
- preserve the existing JSX authoring experience
- add explicit helpers for constructing slot-bearing views

Acceptance:

- components can return a view with typed slots
- docs stop presenting opaque JSX as the final architecture

### Gap 3: Typed Holes Need A Concrete Implementation Story

The vision depends on typed dynamic holes for text, handlers, styles, children, and safe HTML.

Target:

- define hole types and security boundaries
- decide which holes are runtime-only and which require JSX transform support
- prevent unsafe HTML without a branded safe value

Acceptance:

- type tests cover at least class/style/event/text/html holes
- unsafe HTML examples fail without explicit branding

### Gap 4: Style Surface Needs Consolidation

`Style` and the advanced `Style2` descriptors have mostly landed, but the public story should be one coherent style API.

Target:

- document the stable style surface
- mark experimental descriptors where necessary
- align tests and examples around the merged style model

Acceptance:

- one style guide explains utilities, recipes, variants, tokens, nesting, responsive descriptors, and overrides

### Gap 5: Route API Needs One Golden Path

The code contains component-route helpers and newer route-node/server-route/runtime architecture.

Target:

- promote route nodes as the canonical app model if they are the long-term direction
- keep older helpers as compatibility/ergonomic wrappers where useful
- make loader/result/head/error examples consistent

Acceptance:

- one nested-route example covers params, query, loader, typed links, metadata, and loader errors

### Gap 6: Hydration Layer Needs Product-Level Examples

Hydration exists, but the vision requires explicit SSR data continuity.

Target:

- document server dehydration and client rehydration as a layer workflow
- connect route loader payloads, atom snapshots, and single-flight seeds

Acceptance:

- one SSR example proves seeded data is read synchronously on first client render

## Implementation Workstream

1. Add explicit `Slots` to component type metadata — done.
2. Introduce minimal `View<Slots>` type and construction helpers — done.
3. Make `Component.make` view-aware while preserving current JSX returns — initial support done.
4. Finish behavior/style attachment migration to component/view slots directly.
5. Add type tests for valid and invalid slot attachments.
6. Add runtime diagnostics inspired by `../gen2` for dynamic/generated attachments — initial View/style/behavior validation support done.
7. Add slot metadata, hidden slot support, and slot remapping — initial View-level support done.
8. Define typed holes and `SafeHtml`.
9. Add lightweight platform metadata and renderer-boundary diagnostics.
10. Consolidate style docs around the single public API.
11. Promote one route-node golden path and update examples.
12. Add SSR hydration example with loader seed data.
13. Run `npm run typecheck`, `npm test`, and `npm run build` before each release checkpoint.
