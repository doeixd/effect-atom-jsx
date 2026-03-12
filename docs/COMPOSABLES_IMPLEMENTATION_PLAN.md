# Composables / Behavior System Plan

This plan implements the model described in `docs/composables.md`: behavior-first composition, slot-based element wiring, no prop-spreading contract, and typed decorator-style reuse.

## 1) Goals

- Introduce first-class `Behavior` primitives that operate on typed element handles.
- Let components expose named element slots from the view.
- Attach behaviors to components via `pipe`, with compile-time slot compatibility checks.
- Support decorator-style behavior application to any compatible component.
- Preserve Effect-native setup (`yield*`), scope cleanup, and composability.

## 2) Non-goals (v1)

- Full static JSX AST slot-type extraction in TypeScript compiler.
- Perfect compile-time guarantee that every required slot is rendered in every conditional path.
- Multi-renderer production adapters (ship web adapter first; keep abstractions renderer-agnostic).

## 3) Core API Shape (target)

- `Behavior.make(elements, logic)`
- `Behavior.compose(...behaviors, wiring?)`
- `Behavior.attach(behavior, { elementMap })` (pipe transform)
- `Behavior.decorator(elements, logic)`

- `Component.slot(name, kind)` helper for explicit slot registration from view
- `Component.withBehavior(...)` convenience (built on `Behavior.attach`)
- `Component.ref<typeof Child>()` exposing child public bindings

- `Element` capability kinds:
  - `Interactive`, `Container`, `Focusable`, `TextInput`, `Scrollable`, `Measurable`, `Positionable`, `Draggable`, `Collection<E>`

## 4) Architecture Decisions

- Keep setup logic Effect-native; behaviors are Effect programs returning typed bindings.
- Behaviors attach to element handles, not prop bags.
- Slot registration is explicit in v1 (`Component.slot(...)`) to keep typing reliable.
- Behavior attachment merges requirements/errors/bindings into component type surface.
- Runtime validation reports missing/unbound required slots in dev mode.

## 5) Phased Implementation

### Phase A — Type and Runtime Foundations

Files:
- `src/Behavior.ts` (new)
- `src/Element.ts` (new)
- `src/Component.ts` (extend)
- `src/index.ts` (exports)

Work:
- Add branded `Behavior<Elements, AddBindings, Req, E>` type.
- Add `Element` capability interfaces and handle wrappers.
- Add internal slot registry structures on component instances.
- Add `Behavior.make` and minimal `Behavior.attach` runtime.

Acceptance:
- Can define a simple behavior (`isOpen`, click handler, aria attr) and attach it to a component with explicit slot map.

### Phase B — Slot Registration and Binding

Files:
- `src/Component.ts`
- `src/dom.ts`
- `src/runtime.ts`

Work:
- Add explicit slot declaration helper in views (`Component.slot("name", kind)`).
- Wire slot refs from rendered elements to behavior attachment runtime.
- Ensure lifecycle cleanup of behavior-installed listeners/attrs through scope finalizers.
- Add dev-time diagnostics for unresolved required slots.

Acceptance:
- Behavior can install listeners and reactive attrs directly on registered slots.
- Unmounted components release all behavior side effects.

### Phase C — Composition and Decorators

Files:
- `src/Behavior.ts`
- `src/Component.ts`
- `src/type-tests/composables-*.ts` (new)

Work:
- Add `Behavior.compose` with merged element requirements and merged bindings.
- Add `Behavior.decorator` for component-transform functions with slot constraints.
- Add `Behavior.attach` compile-time compatibility checks (element map + capability constraints).
- Add `Component.withBehavior` alias for ergonomic piping.

Acceptance:
- `makeSelectable(UserList)` style decorator works.
- Incompatible slot/capability mappings fail in type-tests.

### Phase D — Exposed Bindings / Parent Refs

Files:
- `src/Component.ts`
- `src/type-tests/composables-bindings.ts` (new)
- `src/__tests__/composables-bindings.test.ts` (new)

Work:
- Extend component public instance/ref contract to expose declared bindings.
- Ensure behavior-added bindings are present in child public ref typing.
- Add safe nullability/lifecycle semantics for parent reads.

Acceptance:
- Parent can read `childRef.current.bindings.<behaviorBinding>()` with full typing.

### Phase E — First-party Behavior Pack

Files:
- `src/behaviors/*.ts` (new folder)
- `src/index.ts` exports
- `examples/composables/*` (new)

Work:
- Implement baseline behaviors from conversation:
  - `disclosure`, `selection`, `searchFilter`, `keyboardNav`, `pagination`, `focusTrap`
- Add at least one composed behavior (`combobox`) using `Behavior.compose`.
- Keep each behavior renderer-agnostic via `Element` capability API.

Acceptance:
- Composed combobox works without prop spreading.

### Phase F — Docs, Migration, and Hardening

Files:
- `README.md`
- `docs/API.md`
- `docs/TESTING.md`
- `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md`
- `CHANGELOG.md`

Work:
- Document composables architecture and migration from prop-spread headless patterns.
- Add testing guidance for behavior-only unit tests and component+behavior integration tests.
- Add performance and edge-case notes (dynamic collections, slot churn, conditional slots).

Acceptance:
- Typecheck/tests/build/pack all green.
- Docs align with shipped signatures.

## 6) Test Matrix

Type tests:
- Slot name compatibility.
- Capability compatibility (`TextInput` vs `Container`, etc.).
- Decorator constraints on accepted/rejected components.
- Binding merge types across multiple attached behaviors.

Runtime tests:
- Listener attach/detach with mount/unmount.
- Reactive attr synchronization.
- Dynamic collection slots add/remove cleanup.
- Behavior composition coordination (e.g., combobox open/search/nav/select flow).
- Missing-slot diagnostics in dev mode.

## 7) Delivery Order

1. Phase A + B (foundations and slot runtime)
2. Phase C (compose/decorator typing)
3. Phase D (parent-exposed bindings)
4. Phase E (behavior pack + combobox)
5. Phase F (docs/release hardening)

## 8) Risks and Mitigations

- Slot typing drift: use explicit slot registration API in v1.
- Over-constrained generics: add targeted helper types and type-tests before adding many built-ins.
- Runtime overhead from behavior layers: keep attach path O(slots + behaviors), cache stable mappings.
- Dynamic list complexity: handle `Collection` as first-class runtime primitive with scoped per-item cleanup.

## 9) Immediate Next Step

Start Phase A by introducing `src/Behavior.ts` and `src/Element.ts`, then implement one vertical slice:
- `disclosure` behavior
- one component with `trigger/content` slots
- one integration test proving attach + no-prop-spread interaction.
