# Behavior research: `combobox` seed / composite

Date: 2026-07-29  
Status: researched  
Tier: composite (seed in behaviors.ts)  
Build priority: K2 widget gate — full research in `widgets/combobox.md`

## 1. Problem statement

Combobox composes: collection, listNavigation, typeahead, selection,
dismissableLayer, anchorPosition, press, formControl, filter. Seed is
incomplete; **do not expand seed without widgets/combobox.md**.

## 2. Competitors (preview)

Zag combobox machine (primary); Radix/Base combobox; react-aria
useComboBox; APG Combobox.

**Decision:** Full KR in widgets track; this file only maps behavior
dependencies.

## 3. Behavior dependency graph

```
collection
  └─ listNavigation (virtual focus) + typeahead
selectionModel
dismissableLayer + interactOutside
anchorPosition
press (trigger) + focusScope
formControl (value)
searchFilter (optional)
Machine (open/highlighted/inputValue)
```

## 4–9

Snapshot: open, highlighted, inputValue, selected. Refs: DOM. Native
floor: `<select>` for simple; custom is opt-in. Port Zag combobox machine
with context split.
