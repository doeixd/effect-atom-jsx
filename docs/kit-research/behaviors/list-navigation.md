# Behavior research: `listNavigation`

Date: 2026-07-29  
Status: researched  
Tier: T4  
Build priority: supporting (seed `keyboardNav` ✅)

## 1. Problem statement

Arrow/Home/End/Page navigation over a collection; may move DOM focus or
only highlight. Generalize existing `keyboardNav`.

## 2. Competitors

Zag list navigation in select/menu; Radix (via roving); Floating
useListNavigation; react-aria useListBox keyboard; APG listbox.

**Decision:** Compose **rovingTabindex** for real focus; listNavigation
adds Home/End/typeahead hook points and virtual mode. Migrate
`keyboardNav` → this name.

## 3–9

Snapshot: currentIndex/key. Runtime: collection refs. RTL. Tests: extend
keyboardNav suite; virtual mode with activedescendant.
