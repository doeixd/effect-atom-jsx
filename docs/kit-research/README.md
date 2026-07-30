# Kit research matrix

Date: 2026-07-29  
Status: active

Decision records for kit primitives. Two tracks:

| Track | Path | Entry gate for |
| --- | --- | --- |
| **Behaviors / machines** | `docs/kit-research/behaviors/` | implementing a catalog behavior or shared machine |
| **Widgets** | `docs/kit-research/widgets/` | implementing a shipped component (K2+) |

Research docs are **decision records, not surveys**. Every section ends in a
choice. Building a behavior or widget without its research doc is out of process.

## Competitors (canonical set)

| Source | What we take |
| --- | --- |
| **Zag.js** | Machines, utilities, edge cases (typeahead timing, dismiss stack, focus order) |
| **Ark UI** | Zag-on-multi-framework packaging; anatomy naming |
| **Radix Primitives** | Layer stack, collection, roving focus, presence; MIT |
| **Base UI** | Specs + behavioral tests (not React code); modal/dismiss model |
| **react-aria** | Press/focus/overlay semantics; keyboard maps; APG alignment |
| **Floating UI** | Positioning math (`@floating-ui/dom`); list navigation / focus manager concepts |
| **@stylextras/ui** | Platform-native floor (dialog, popover, invokers, anchor) |
| **CSS-Tags / native** | Rung-zero contracts; pure CSS hosts |
| **shadcn/ui** | Consumer customization pressure only (not a behavior source) |
| **`@remix-run/ui`** | **Mixin-style composition** — closest prior art for our K0c `Mixin` design; styled-vs-primitives packaging; per-component module imports |
| **WAI-ARIA APG** | Tiebreaker for keyboard/ARIA divergences |

**Note on `@remix-run/ui` (added 2026-07-30).** Remix's own headless library
applies component styling to a host element through a *mixin* prop —
`<input mix={checkbox()} />` — rather than by wrapping it in a component. That is
the same shape as our deferred K0c `Mixin` module and as `Style`/`Behavior`
attaching from outside a component, so it is the most direct prior art we have
for the ergonomics of that API. It also splits **styled components** from
**primitives** (`@remix-run/ui/<component>` vs a `/primitives` subpath) and has
moved *away* from grouped subpath exports toward one module per component —
evidence for our own no-barrel / per-widget-subpath rule.

Worth reading specifically for: how `mix={...}` composes when two mixins target
one element (our `Behavior.compose` last-wins question, `DQ-057`), and whether
their primitives carry anatomy or leave it to the caller.

The API reference URL `https://api.remix.run/api/remix/ui/` returned **404** when
checked on 2026-07-30 — find the current docs entry point before starting this
research doc; the package itself and its release notes are the reliable source
today.

## Behavior catalog status

Load-bearing five first (build order):

| Behavior | Doc | Status |
| --- | --- | --- |
| `collection` | [behaviors/collection.md](behaviors/collection.md) | researched |
| `rovingTabindex` | [behaviors/roving-tabindex.md](behaviors/roving-tabindex.md) | researched |
| `press` | [behaviors/press.md](behaviors/press.md) | researched |
| `dismissableLayer` | [behaviors/dismissable-layer.md](behaviors/dismissable-layer.md) | researched |
| `anchorPosition` | [behaviors/anchor-position.md](behaviors/anchor-position.md) | researched |

Full tiers:

| Tier | Behavior | Doc | Seed today |
| --- | --- | --- | --- |
| T1 | `press` | [press.md](behaviors/press.md) | — |
| T1 | `hover` | [hover.md](behaviors/hover.md) | — |
| T1 | `focusVisible` | [focus-visible.md](behaviors/focus-visible.md) | — |
| T1 | `longPress` | [long-press.md](behaviors/long-press.md) | — |
| T1 | `move` | [move.md](behaviors/move.md) | — |
| T2 | `focusTrap` | [focus-trap.md](behaviors/focus-trap.md) | ✅ `behaviors.focusTrap` |
| T2 | `focusScope` | [focus-scope.md](behaviors/focus-scope.md) | — |
| T2 | `rovingTabindex` | [roving-tabindex.md](behaviors/roving-tabindex.md) | — |
| T3 | `dismissableLayer` | [dismissable-layer.md](behaviors/dismissable-layer.md) | — |
| T3 | `interactOutside` | [interact-outside.md](behaviors/interact-outside.md) | — |
| T3 | `hideOutside` | [hide-outside.md](behaviors/hide-outside.md) | — |
| T3 | `scrollLock` | [scroll-lock.md](behaviors/scroll-lock.md) | — |
| T3 | `anchorPosition` | [anchor-position.md](behaviors/anchor-position.md) | — |
| T4 | `collection` | [collection.md](behaviors/collection.md) | partial `Element.Collection` |
| T4 | `listNavigation` | [list-navigation.md](behaviors/list-navigation.md) | ✅ `keyboardNav` |
| T4 | `typeahead` | [typeahead.md](behaviors/typeahead.md) | — |
| T4 | `selectionModel` | [selection-model.md](behaviors/selection-model.md) | ✅ `selection` |
| T4 | `gridNavigation` | [grid-navigation.md](behaviors/grid-navigation.md) | — |
| T5 | `spinValue` | [spin-value.md](behaviors/spin-value.md) | — |
| T5 | `rangeControl` | [range-control.md](behaviors/range-control.md) | — |
| T5 | `toggleState` | [toggle-state.md](behaviors/toggle-state.md) | — |
| T6 | `formControl` | [form-control.md](behaviors/form-control.md) | — |
| T6 | `fieldAssociation` | [field-association.md](behaviors/field-association.md) | — |
| T6 | controlled bridge | [controlled-uncontrolled.md](behaviors/controlled-uncontrolled.md) | atoms |
| T7 | `liveAnnounce` | [live-announce.md](behaviors/live-announce.md) | — |
| T7 | `presence` | [presence.md](behaviors/presence.md) | — (first Machine customer) |
| T7 | `observeResize` / `observeRect` | [observe-geometry.md](behaviors/observe-geometry.md) | — |

Existing seeds also documented for upgrade path:

| Seed | Doc |
| --- | --- |
| `disclosure` | [disclosure.md](behaviors/disclosure.md) |
| `combobox` (seed) | [combobox-behavior.md](behaviors/combobox-behavior.md) |
| `searchFilter` | [search-filter.md](behaviors/search-filter.md) |
| `pagination` | [pagination.md](behaviors/pagination.md) |

## Widget research

Widget docs use the 9-section template in
[`COMPONENT_KIT_PLAN.md`](../COMPONENT_KIT_PLAN.md) (KR phase). Combobox is
the K2 entry gate and the template all other widget docs copy.

| Widget | Doc | Status | Gate |
| --- | --- | --- | --- |
| `Combobox` | [widgets/combobox.md](widgets/combobox.md) | researched | K2 |
| `Dialog` | [widgets/dialog.md](widgets/dialog.md) | researched | K3 |
| `Select` | [widgets/select.md](widgets/select.md) | researched — owns the native-first inversion (`render:"native"` default) and the `typeahead` reconciliation | K3 |
| `Tooltip` | [widgets/tooltip.md](widgets/tooltip.md) | researched — describe-only, non-interactive (`content` is `Base`); `popover="hint"` floor; activation-only (does not resume open) | K3 |
| `Popover` | [widgets/popover.md](widgets/popover.md) | researched — `popover="auto"` + invoker rung-zero; folds `HoverCard` into a `trigger` policy axis | K3 |

## Behavior research template

See [`behaviors/_TEMPLATE.md`](behaviors/_TEMPLATE.md).
