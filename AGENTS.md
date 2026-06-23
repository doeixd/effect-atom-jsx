# Agent Notes

This repository is `effect-atom-jsx`, a runtime JSX and Effect-based reactive UI library. Current work is converging it toward the AF-UI vision: an inside-out UI framework where components expose typed structural slots, and styles, behaviors, routing, reactivity, hydration, and server routes compose around those slots.

## Source Of Truth

Use these documents first:

- `docs/AF_UI_CONTRACT.md` — canonical AF-UI architecture contract.
- `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md` — current implementation status and backlog.
- `docs/GEN2_UI_IMPLEMENTATION_NOTES.md` — notes from `../gen2` UI IR implementation and what can be adapted here.
- `docs/DESIGN_STYLING_BEHAVIOR_SYSTEM.md` — broader design narrative.
- `docs/RUNTIME_ROUTING_REACTIVITY_SYSTEM.md` — runtime, routing, reactivity, single-flight, hydration vision.

When older exploratory docs conflict with `docs/AF_UI_CONTRACT.md`, the contract wins.

## Current Architecture Direction

The target core shape is:

```ts
Component<Props, Req, E, Bindings, Slots> -> View<Slots>
```

Important boundaries:

- `Bindings` are logical state created during setup.
- `Slots` are the public structural API consumed by styles and behaviors.
- Styles and behaviors attach from outside the component.
- Requirement and error types should bubble through components, behaviors, routes, and local layers.
- Web is the concrete runtime today, but component/style/behavior types should avoid DOM-only coupling.

## Current Implementation State

As of the AF-UI convergence start:

- `Component.Component` has an explicit fifth `Slots` type axis.
- `Component.SlotsOf<T>` extracts component slot metadata.
- Behavior/style slot attachment paths preserve component slot metadata.
- Current runtime views still return JSX-like `unknown`; a real runtime `View<Slots>` module is not implemented yet.
- Existing slots are still commonly stored in `bindings.slots`; this remains the compatibility path during migration.

The next major implementation slice should be a minimal runtime-native `View<Slots>` type inspired by `../gen2`, but not copied from it directly.

Suggested first shape:

```ts
export interface View<Slots> {
  readonly [ViewTypeId]: {
    readonly Slots: Slots;
  };
  readonly slots: Slots;
  readonly node: unknown;
}
```

Then allow component view functions to return either current JSX output or `View<Slots>` while preserving existing behavior.

## Gen2 Notes

`../gen2` has useful UI IR implementation in `../gen2/src/ui/ui.ts`, including:

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
- Keep migrations backward-compatible unless the user explicitly asks for breaking cleanup.
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
- Keep `bindings.slots` compatibility while introducing explicit view metadata.
- Add type coverage showing style/behavior attachments can target `Component.SlotsOf<T>`.

When adding diagnostics:

- Compile-time safety is preferred for library-authored code.
- Runtime diagnostics are still useful for generated/dynamic attachments.
- Gen2 `checkUi` is a good checklist for diagnostics, but this repo should expose runtime-native helpers.

## Git/Workspace Notes

There may be unrelated or pre-existing changes in the worktree. Do not reset or revert them unless explicitly asked.

Known recent untracked path observed during AF-UI work:

- `docs/af-ui-json-render/`

