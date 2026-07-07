# Style System Implementation Plan

This plan translates `docs/style.md` into a staged, shippable implementation for the current codebase.

## Objectives

- Implement a typed, token-driven `Style` system that mirrors composable `Behavior` architecture.
- Attach styles to named element slots from outside the view (`Style.attach(...)`), with slot safety.
- Support utility composition, reactive values, state styles, responsive styles, variants, and recipes.
- Introduce style handles + override provider for external customization without forking components.
- Keep renderer-agnostic core with web-first runtime adapter.

## Scope Boundaries

### In scope (v1)

- Typed style primitives and composition.
- Theme service and token resolution.
- Slot-style attach transform.
- Variants and recipes with inferred prop types.
- Reactive style value updates.
- Dynamic theme switching support.
- Style handle overrides via provider.

### Out of scope (v1)

- Full static CSS extraction/JIT compiler.
- Complete parity for TUI/mobile renderers (define interfaces; web adapter first).
- Visual editor tooling/devtools.

## Design Contracts

- Style and behavior both target slot handles.
- Tokens are typed paths; misspelled tokens fail type-check.
- Style merge order is deterministic.
- Reactive style values update by property, not whole-view re-render.
- Style attach fails at compile-time when style references unknown slots.
- Overrides only target declared handles.

## Phase Plan

## Phase 1: Core Style Types and Runtime Skeleton

### Deliverables

- `src/Style.ts` (new)
- `src/style-runtime.ts` (new)
- `src/style-types.ts` (new)

### Work

- Define style AST/types:
  - `Style.slot(def)`
  - `Style.compose(...pieces)`
  - `Style.when(condition, piece)`
  - `Style.states(map)`
  - `Style.responsive(map)`
  - `Style.make(slotMap)`
- Define common style properties initially used by docs/examples:
  - spacing, color, typography, border, radius, shadow, flex, opacity, transform, width, overflow.
- Define reactive property value support (`T | (() => T)`).
- Implement pure merge engine with predictable precedence.

### Acceptance

- Style pieces can be composed and merged into final slot style maps in unit tests.

## Phase 2: Theme Service and Token Resolution

### Deliverables

- `src/Theme.ts` (new)
- `src/style-tokens.ts` (new)
- `src/__tests__/style-tokens.test.ts` (new)

### Work

- Add typed `Theme` Effect service:
  - `tokens`
  - `mode` atom
  - `resolve(path)`
- Introduce token-path utility types:
  - category paths (`color`, `spacing`, `fontSize`, `fontWeight`, `radius`, `shadow`, `transition`, `breakpoint`).
- Add token resolver from style AST to resolved style values.
- Implement fallback rules for raw non-token values.

### Acceptance

- Token path misspellings fail type-check in type-tests.
- Resolved output maps token references to concrete values in runtime tests.

## Phase 3: Element Style Capabilities and Attach Pipeline

### Deliverables

- `src/Element.ts` updates (style operations)
- `src/Style.ts` attach APIs
- `src/Behavior.ts` interop alignment (slot mapping style parity)
- `src/__tests__/style-attach.test.ts` (new)

### Work

- Add style operations to element handles:
  - `setStyle(prop, valueFn)`
  - `setStyleOnce(prop, value)`
- Implement `Style.attach(style, options?)` pipe transform:
  - map style slots to component slots
  - validate slot existence/compatibility at type level
  - resolve tokens via Theme service in setup scope
  - bind reactive style functions using existing reactivity system
- Add `Style.attachBySlots(...)` helper analogous to behavior attach patterns.

### Acceptance

- Styles can be attached from outside the component.
- Unknown style slots produce type errors.
- Reactive style properties update element styles in tests.

## Phase 4: Utility Layer and Built-ins

### Deliverables

- `src/style-utils.ts` (new)
- Exported utility functions from `src/index.ts`
- `src/__tests__/style-utils.test.ts` (new)

### Work

- Implement common utility generators shown in `style.md`:
  - `padded`, `rounded`, `elevated`, `bordered`, `textStyle`, `flexRow`, `flexCol`, `interactive`, `truncated`.
- Ensure utilities return `Style.slot(...)` pieces and remain composable.
- Keep utility API typed on token categories.

### Acceptance

- Utility composition works across multiple slots.
- Wrong token category usage is rejected by type-check.

## Phase 5: Variants API (CVA-like)

### Deliverables

- `Style.variants(...)`
- `Style.VariantProps<typeof variants>` type extraction
- `src/__tests__/style-variants.test.ts` (new)
- `src/type-tests/style-variants.ts` (new)

### Work

- Implement variants engine:
  - `base`
  - `variants`
  - `compounds`
  - `defaults`
- Implement style factory output callable by variant selection.
- Add inferred prop extraction helper.

### Acceptance

- Invalid variant values fail type-check.
- Compound variants apply correctly at runtime.

## Phase 6: Recipe API (Multi-slot Variants)

### Deliverables

- `Style.recipe(...)`
- `Style.RecipeProps<typeof recipe>` type extraction
- `src/__tests__/style-recipe.test.ts` (new)
- `src/type-tests/style-recipe.ts` (new)

### Work

- Implement recipe model:
  - slot base styles
  - slot variants
  - defaults
  - recipe output per slot style map
- Ensure recipe slots can feed `Style.attach(...)` directly.

### Acceptance

- Recipe returns typed slot style map.
- Recipe prop inference and validation behave as expected.

## Phase 7: Style Handles and Override Provider

### Deliverables

- `Style.Provider` context/service support
- `Style.override(...)`
- handle registration support in component bindings/slots
- `src/__tests__/style-overrides.test.ts` (new)

### Work

- Add handle naming contract and metadata registration.
- Implement scoped override collection and resolution layering.
- Apply overrides late in style precedence pipeline.
- Type-check override keys against declared handle map where available.

### Acceptance

- Overrides can change published handle styles without forking components.
- Unknown handles fail type-check (or fail fast dev diagnostic when not inferable).

## Phase 8: Responsive + State + Animation Styling

### Deliverables

- `Style.responsive`, `Style.states`, `Style.animation`, `Style.keyframes`, `Style.transition`
- `src/__tests__/style-responsive-state-animation.test.ts` (new)

### Work

- Implement responsive composition with breakpoint tokens.
- Implement state style maps with renderer abstraction for web pseudo-states first.
- Implement animation/keyframe descriptors in abstract style model.

### Acceptance

- Responsive styles switch by breakpoint source.
- State styles resolve and apply through style runtime.

## Phase 9: Composable Styled Factories and Examples

### Deliverables

- `src/styled-composables.ts` (new)
- Example(s) in `examples/` for styled combobox/card/button
- docs updates

### Work

- Build at least one end-to-end styled headless factory:
  - `createStyledCombobox` (behavior + style + slot view)
- Demonstrate external override handles and theme swap.

### Acceptance

- Example proves independent composition of view/behavior/style.

## Type System Milestones

- Token path correctness (category-safe).
- Slot-key compatibility for `Style.attach`.
- Variant value correctness and inferred variant props.
- Recipe prop inference.
- Override handle key validity.

## Runtime Test Matrix

- Merge precedence correctness.
- Reactive value updates only mutate targeted properties.
- Theme change propagates token re-resolution.
- Attach/detach cleanup on component unmount.
- Behavior + Style coexistence on same slots without conflicts.

## Rollout and Compatibility

- Ship behind additive API; do not break existing `Component`/`Behavior` surfaces.
- Keep `Style` module opt-in initially.
- Add `Style` exports in root + subpath (`./Style`) once Phase 3 lands.

## Documentation Plan

- `docs/API.md`: full `Style` reference.
- `README.md`: quick start with themed style attach.
- New guide `docs/STYLING.md`:
  - tokens
  - utilities
  - variants/recipes
  - handles/overrides
  - behavior + style composition patterns.

## Risks and Mitigation

- Type complexity growth:
  - mitigate with layered helper types and focused type-tests.
- Runtime overhead from reactive style functions:
  - defer to property-level subscriptions and cleanup finalizers.
- Cross-platform divergence:
  - keep abstract style model strict; renderer adapters perform mapping.

## Suggested Execution Order (practical)

1. Phase 1 + 2 together (core style AST + theme/tokens)
2. Phase 3 (attach pipeline)
3. Phase 4 (utilities)
4. Phase 5 + 6 (variants/recipes)
5. Phase 7 (handles/overrides)
6. Phase 8 (responsive/state/animation)
7. Phase 9 (styled factory + examples)

## Definition of Done

- `npm run typecheck` green.
- Full test suite green with new style runtime and type-tests.
- Build + pack dry-run green.
- `docs/API.md`, `README.md`, `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md`, and `CHANGELOG.md` aligned with shipped APIs.
