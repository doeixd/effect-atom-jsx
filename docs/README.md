# Documentation

Start here when you are reading the repository docs directly.

## Current Reference Docs

| Doc | Purpose |
| --- | --- |
| `../README.md` | Quick product overview, setup, and end-to-end examples. |
| `API.md` | Broad API reference across atoms, components, styles, routing, server, diagnostics, and testing. |
| `SLOT_CONTRACT_GOLDEN_PATH.md` | The shortest authored slot-contract component path. |
| `component.md` | Current component model: setup as Effect, bindings, slot contracts, layers, and transforms. |
| `view.md` | Current `View`, `View.Slots`, slot metadata, tree metadata, and diagnostics. |
| `style.md` | Current style/theme system, attachment tiers, global styles, platform diagnostics, and recipes. |
| `router.md` | Current route-node router, loaders, preload, lazy components, head metadata, single flight, and SSR helpers. |
| `reactivity.md` | Semantic reactivity keys and invalidation. |
| `SERVICES_AND_LAYERS.md` | Effect service/layer architecture, provision tiers, and request scoping. |
| `TESTING.md` | DOM-free tests, layer swapping, behavior drivers, stories/scenes, and diagnostics. |
| `RELEASE_CHECKLIST.md` | Release gates and prerelease/stable criteria. |
| `V1_SCOPE.md` | Ships/deferred authority for the current prerelease scope. |
| `afui.md` | Long-form AF-UI narrative and architecture explanation. |

The broad `API.md` reference also covers the smaller exported modules:
`A11y`, `Form`, `Devtools`, `Diagnostics`, `Serialization`, and `SafeHtml`.

## Status And Planning

- `CURRENT_STATUS_IN_REDESIGN_PLAN.md` is the active status ledger. It is useful
  for maintainers, but not the first doc new users should read.
- `EVENT_RUNTIME_PLAN.md` is the proposed typed logical-event contract design;
  it is not ratified release scope.
- `archive/` contains historical plans, design notes, and superseded API
  sketches. Do not treat archive snippets as current unless a live doc links to
  a specific historical decision.
- `adr/` contains architecture decision records.
- `af-ui-json-render/` contains renderer/generator notes.

## Current Golden Paths

- State: `Atom.make`, `Atom.derived`, `Atom.runtime(layer).atom(...)`, and
  `Atom.runtime(layer).action(...)`.
- Async state: the unified `Result` model (`Loading`, `Refreshing`, `Success`,
  `Failure`, `Stale`, `Defect`).
- Components: `Component.make(...)` with setup as `Effect`, plus
  `Component.withSlots(...)` for slot-bearing components.
- Views: `View.Slots.define(...)` plus `View.fromSlots(...)`.
- Styles: `Style.forSlots(slots)(...)` plus `Style.attachToSlots(...)`.
- Behaviors: `Behavior.forSlots(slots)(...)` plus
  `Behavior.attachToSlots(...)`.
- Routing: `Route.page(...)`, `Route.layout(...)`, `Route.index(...)`,
  `Route.define(...)`, `Route.loader(...)`, and `Route.link(...)`.
- Services: one composition root shared by `Atom.runtime(...)` and
  `Component.mount(...)` or passed as `runtime`.
- Events: `Event.channel(...)`, `Event.layer(...)`, `Event.publish(...)`, and
  `Event.stream(...)`; use direct Effect `PubSub` for private channels.

## Validation Commands

Run these before claiming a doc/code release pass is complete:

```sh
npm run typecheck:all
npm test
npm run build
```

For doc-only edits, at least run a markdown/link sanity check if one is added
to the project. The current repository does not require a markdown build step.
