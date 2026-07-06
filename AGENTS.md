# Agent Notes

This repository is `effect-atom-jsx`, a runtime JSX and Effect-based reactive UI library. Current work is converging it toward the AF-UI vision: an inside-out UI framework where components expose typed structural slots, and styles, behaviors, routing, reactivity, hydration, and server routes compose around those slots.

## Source Of Truth

Use these documents first:

- [`docs/AF_UI_CONTRACT.md`](docs/AF_UI_CONTRACT.md) — canonical AF-UI architecture contract.
- [`docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md`](docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md) — current implementation status and backlog.
- [`docs/SLOT_CONTRACT_UNIFICATION_PLAN.md`](docs/SLOT_CONTRACT_UNIFICATION_PLAN.md) — next slot design plan; `View.Slots` becomes the canonical authored slot contract.
- [`docs/PROPS_BINDINGS_SLOTS.md`](docs/PROPS_BINDINGS_SLOTS.md) — ownership model for caller props, setup bindings, and public slots.
- [`docs/BINDINGS_ASYNC_COMMIT_BOUNDARY.md`](docs/BINDINGS_ASYNC_COMMIT_BOUNDARY.md) — bindings as the component-level async commit boundary.
- [`docs/SLOT_WITNESS_PLAN.md`](docs/SLOT_WITNESS_PLAN.md) — first-class slot witness design and implementation plan.
- [`docs/TYPED_VIEW_TREE_PLAN.md`](docs/TYPED_VIEW_TREE_PLAN.md) — typed renderer-neutral tree plan.
- [`docs/GEN2_UI_IMPLEMENTATION_NOTES.md`](docs/GEN2_UI_IMPLEMENTATION_NOTES.md) — notes from `../gen2` UI IR implementation and what can be adapted here.
- [`docs/ROUTER_ARCHITECTURE_IMPLEMENTATION_PLAN.md`](docs/ROUTER_ARCHITECTURE_IMPLEMENTATION_PLAN.md) — route-node, server-route, and runtime architecture notes.
- [`docs/DESIGN_STYLING_BEHAVIOR_SYSTEM.md`](docs/DESIGN_STYLING_BEHAVIOR_SYSTEM.md) — broader design narrative.
- [`docs/RUNTIME_ROUTING_REACTIVITY_SYSTEM.md`](docs/RUNTIME_ROUTING_REACTIVITY_SYSTEM.md) — runtime, routing, reactivity, single-flight, hydration vision.

When older exploratory docs conflict with `docs/AF_UI_CONTRACT.md`, the contract wins.

## Current Architecture Direction

The target core shape is:

```ts
Component<Props, Req, E, Bindings, SlotContract> -> View<Slots>
```

Important boundaries:

- `Bindings` are logical state created during setup.
- `Props` are caller-owned configuration.
- `Bindings` are setup-created implementation state.
- Bindings should be treated as the committed setup snapshot: setup collects
  dependencies/resources, then the view renders from committed bindings, then
  style/behavior effects attach.
- `View.Slots` is the canonical authored slot contract.
- `Component.SlotsOf<T>` is the runtime handle-map projection.
- `Component.SlotWitnessesOf<T>` is the current static witness metadata implementation detail.
- The next public naming slice should add `Component.withSlots(...)` and `Component.SlotContractOf<T>`.
- Styles and behaviors attach from outside the component.
- Witness APIs are the authored path: `Style.forSlots(...)`, `Style.attachToSlots(...)`, `Behavior.forSlots(...)`, `Behavior.attachToSlots(...)`.
- String slot maps are dynamic/generated APIs.
- Requirement and error types should bubble through components, behaviors, routes, and local layers.
- Web is the concrete runtime today, but component/style/behavior types should avoid DOM-only coupling.

## Current Implementation State

Current AF-UI implementation state:

- `Component.Component` has an explicit fifth `Slots` type axis.
- `Component.SlotsOf<T>` extracts component slot metadata.
- `Component.Component` also has a sixth `SlotWitnesses` implementation axis.
- `Component.SlotWitnessesOf<T>` extracts static witness metadata.
- `Component.withSlotWitnesses(...)` publishes witness metadata on a component.
- Behavior/style slot attachment paths preserve component slot and witness metadata.
- Runtime views can return JSX-like `unknown` or explicit `View<Slots>`.
- `View.Slot`, `View.Slots`, `View.fromSlots(...)`, typed tree helpers, hidden slots, remaps, diagnostics, and pipeable `View<Slots>` transforms are implemented.
- Existing slots are still commonly stored in `bindings.slots`; new authored APIs should move away from that convention.

The next major implementation slice should execute
`docs/SLOT_CONTRACT_UNIFICATION_PLAN.md`: add `Component.withSlots(...)`, add
`Component.SlotContractOf<T>`, migrate examples to the canonical `View.Slots`
contract path, and add diagnostics for drift between declared component
contracts, rendered `View` slots, and setup/runtime `bindings.slots`.

## Gen2 Notes

`../gen2` has useful UI IR implementation in [`../gen2/src/ui/ui.ts`](../gen2/src/ui/ui.ts) and [`../gen2/src/gen/ui-backends.ts`](../gen2/src/gen/ui-backends.ts), plus the related UI docs and tests:

- [`../gen2/gen-ui-implementation-plan.md`](../gen2/gen-ui-implementation-plan.md)
- [`../gen2/docs/spec.md`](../gen2/docs/spec.md)
- [`../gen2/tests/ui.test.ts`](../gen2/tests/ui.test.ts)
- [`../gen2/tests/ui-generic.test.ts`](../gen2/tests/ui-generic.test.ts)
- [`../gen2/tests/ui-attachment.test.ts`](../gen2/tests/ui-attachment.test.ts)

The useful UI pieces are:

- `ElementCapability`
- `Slot`
- `View`
- `Component`
- `Style`
- `Behavior`
- style/behavior attachment validation
- hidden slots
- slot remapping
- platform/renderer metadata
- `SafeHtml`
- `checkUi` diagnostics

Do not copy it wholesale. It is a static/generator IR. This repo needs runtime-native primitives that work with Effect, atoms, scopes, JSX runtime output, and existing `Element.Handle` values.

Portable ideas from gen2:

- slot metadata records
- hidden slots
- slot remapping
- safe HTML branding
- platform/event/style diagnostics
- runtime validation for dynamic/generated attachments

For the route side, see the routing references in `../gen2/tests/router.test.ts`, `../gen2/tests/router-pass.test.ts`, `../gen2/atom_plan.md`, and `../gen2/atom_plan_continuation.md`.

Avoid porting directly:

- `View.structure: string`
- `Component.props_type: string`
- `Component.bindings: readonly string[]`
- `Behavior.body: string`
- generator namespace APIs as runtime APIs

## Development Commands

Use the existing npm scripts:

```bash
npm run typecheck
npm test
npm run build
```

Before finishing implementation changes, run:

1. `npm run typecheck`
2. `npm test`
3. `npm run build`

For narrow doc-only changes, typecheck/build are usually unnecessary unless source files changed.

## Coding Rules For This Repo

- Prefer existing patterns in `src/Component.ts`, `src/Behavior.ts`, `src/Style.ts`, `src/Element.ts`, and route/reactivity modules.
- This is prerelease redesign work. Prefer the coherent final API over backwards
  compatibility when the two conflict.
- Preserve callable atom and Effect-native APIs.
- Add type tests when changing public type behavior.
- Use compile-time tests for slot compatibility, requirement bubbling, and inference regressions.
- Keep runtime tests focused on actual behavior: cleanup, invalidation, loader refresh, hydration, and attachment lifecycle.
- Do not revert unrelated user changes.

## UI/Slot Migration Guidance

When adding `View<Slots>`:

- Keep current JSX authoring valid.
- Make `View.make(slots, node)` or equivalent an opt-in first.
- Do not require a JSX compiler rewrite in the first slice.
- Preserve `Component.SlotsOf<T>`.
- Move authored APIs away from `bindings.slots` conventions while introducing
  explicit view metadata.
- Add type coverage showing style/behavior attachments can target `Component.SlotsOf<T>`.

When working on slot contract unification:

- Prefer `View.Slots` as the single authored slot contract object.
- Add `Component.withSlots(...)` as the canonical public helper; rename or hide
  `withSlotWitnesses(...)` before release.
- Add `Component.SlotContractOf<T>` as the canonical extraction helper while
  keeping `SlotWitnessesOf<T>`.
- Preserve both `Component.SlotsOf<T>` and slot contract metadata across
  wrappers.
- Add diagnostics for declared-vs-rendered slot drift.

When adding diagnostics:

- Compile-time safety is preferred for library-authored code.
- Runtime diagnostics are still useful for generated/dynamic attachments.
- Gen2 `checkUi` is a good checklist for diagnostics, but this repo should expose runtime-native helpers.

## Git/Workspace Notes

There may be unrelated or pre-existing changes in the worktree. Do not reset or revert them unless explicitly asked.

Known recent untracked path observed during AF-UI work:

- `docs/af-ui-json-render/`
