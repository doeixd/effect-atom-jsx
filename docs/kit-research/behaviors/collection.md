# Behavior research: `collection`

Date: 2026-07-29  
Status: researched  
Tier: T4  
Build priority: **load-bearing #1**

## 1. Problem statement

Items in a composite widget (menu, listbox, radio group, tabs, grid) must
self-register in **document order**, expose a stable index for keyboard
nav/selection, and update when children mount/unmount — without the parent
hand-maintaining an array of refs.

**Decision:** Own `collection` as a first-class behavior +
`Element.Collection` capability; every list-like widget composes it.

## 2. Competitor map

| Library | Module / API | Notes |
| --- | --- | --- |
| Zag.js | collection helpers in select/menu/combobox machines | Item ids in context; DOM order resolved at connect time |
| Ark UI | Same as Zag via anatomy parts | |
| Radix | `@radix-ui/react-collection` (`createCollection`) | Item register via context; `useCollection` reads ordered items; **load-bearing invisible primitive** |
| Base UI | Internal item registration on Menu/Select | Port **tests** for order + disabled skip |
| react-aria | `useListState` / collection in `@react-stately` | Keyed collections, not DOM-order self-register; more data-model than DOM |
| Floating UI | `FloatingList` + `useListItem` | Index from React context for list navigation |
| Native | `<select>` / radiogroup | Browser owns collection; no self-register API |

**Decision:** Primary = **Radix Collection** (register/unregister + ordered
read). Secondary = FloatingList index model. Avoid react-stately's full
collection data model for v1 DOM widgets.

## 3. State vs refs split

| Snapshot-safe | Runtime-only |
| --- | --- |
| Optional: selected keys / highlighted key (widget machine) | Element handles, MutationObserver/cleanup, index map |
| Item **logical ids** if authored | DOM order array |

**Decision:** Collection registry is **runtime-only** (refs). Widget machines
snapshot selection/highlight keys, never element handles.

## 4. Interaction spec

- Register on attach; unregister on Scope dispose (exact-once).
- Order = DOM order (TreeWalker or sibling index), not registration time.
- Disabled/hidden items remain in collection but are skippable by nav
  behaviors (flag on item metadata).
- Nested collections: each composite owns its registry (no global).

**Decision:** DOM-order authoritative; skip flags on items; nested-local.

## 5. ARIA contract

Collection itself sets no roles; consumers set `role=listbox|menu|…` on
container and `option|menuitem|…` on items. Collection may assist
`aria-posinset` / `aria-setsize` if requested.

**Decision:** Optional posinset/setsize helper; roles stay on widget anatomy.

## 6. Platform-native floor

None for custom lists. Native `<select>` / radio groups skip this behavior.

**Decision:** No platform floor; custom composites only.

## 7. Affe API shape

```ts
// pairs with Element.Collection capability
collection({
  // container: Element.Container
  // items observe via observeEach / register
})
// provides: { items: ReadonlyAtom<Item[]>, getByIndex, indexOf }
```

Requires `Element.Collection` or Container + child Interactive. Plain
Behavior (no Machine). Portable only if registration is re-run on attach
(reattachScoped) — opaque registration is fine if dormant UX is native.

**Decision:** Behavior over `Element.Collection`; not a Machine.

## 8. Port sources

- Radix `react-collection` semantics (MIT) — reimplement, don't copy React
  context.
- Base UI Menu item order tests.
- Existing `Element.collection` / `observeEach` in this repo.

**Decision:** Reimplement on Affe Element handles; cite Radix in comments.

## 9. Tests day one

- Register 3 items → order matches DOM; dispose middle → indices recompact.
- Nested collections isolated.
- Exact-once unregister on Scope close.
- Integration: feeds `rovingTabindex` / `listNavigation`.
