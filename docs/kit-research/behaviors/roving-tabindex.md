# Behavior research: `rovingTabindex`

Date: 2026-07-29  
Status: researched  
Tier: T2  
Build priority: **load-bearing #2**

## 1. Problem statement

Composite widgets expose **one tab stop**; arrow keys move focus/highlight
among items. Foundation under menus, toolbars, radio groups, tabs, grids
(1D). Without this, every widget reinvents Tab vs Arrow semantics.

**Decision:** Ship `rovingTabindex` as a Behavior composed with `collection`.

## 2. Competitor map

| Library | Module / API | Notes |
| --- | --- | --- |
| Zag.js | Built into menu/tabs/radio/combobox machines | Current index in machine context |
| Radix | `@radix-ui/react-roving-focus` | `RovingFocusGroup` / Item; orientation; loop; current tabIndex 0/-1 |
| Base UI | Composite focus patterns on Tabs/Menu | Port keyboard tests |
| react-aria | `useRovingTabIndex` / focus management in collections | Strong keyboard edge cases |
| Floating UI | `useListNavigation` | Virtual vs real focus for floating lists |
| APG | Toolbar, Menubar, Radio Group, Tabs patterns | Tiebreaker |

**Decision:** Primary = **Radix roving-focus** + **APG**. react-aria for
edge cases (Home/End, rtl). Floating `useListNavigation` only when virtual
focus needed (combobox list while focus stays in input).

## 3. State vs refs split

| Snapshot-safe | Runtime-only |
| --- | --- |
| `currentIndex` or `currentKey` (atom/machine) | Focused element refs, tabIndex writes |
| `orientation`, `loop` (props) | |

**Decision:** Index/key is snapshot-safe (resume open menu with highlight).
tabIndex mutation is runtime.

## 4. Interaction spec

- Tab enters group at current item (tabIndex 0); others -1.
- ArrowNext/Prev move; optional Home/End; optional typeahead (compose
  `typeahead` separately).
- Orientation: horizontal | vertical | both.
- `loop` boolean.
- RTL flips horizontal arrows (via document/dir or service).
- Skip disabled items.
- Virtual focus mode: update highlight without DOM focus (combobox).

**Decision:** Real focus default; virtual mode option for combobox; RTL
aware; skip disabled.

## 5. ARIA contract

Does not set roles. Ensures only one item is tabbable. May set
`aria-activedescendant` in virtual mode (widget chooses).

**Decision:** Real mode = DOM focus; virtual mode = activedescendant
helper optional.

## 6. Platform-native floor

`focusgroup` (limited support) — progressive enhancement later, not v1
dependency.

**Decision:** No platform floor in v1; watch `focusgroup`.

## 7. Affe API shape

```ts
rovingTabindex({
  // requires collection items: Element.Focusable[]
  orientation: "vertical",
  loop: true,
  virtual?: boolean,
})
// provides: currentIndex atom, focus(i), next, prev
```

Plain Behavior; highlight may be machine state at widget level.

**Decision:** Behavior; compose with collection; optional Machine at widget.

## 8. Port sources

- Radix roving-focus keyboard matrix.
- react-aria collection keyboard tests.
- APG examples for toolbar/radio.

**Decision:** Port test matrices, reimplement runtime.

## 9. Tests day one

- Tab into group lands on current; arrows cycle; loop off clamps.
- Disabled skip; RTL horizontal.
- Dispose mid-focus → no leak; tabIndex restored.
- Chromium keyboard suite.
