# Behavior research: `typeahead`

Date: 2026-07-29  
Status: researched  
Tier: T4  
Build priority: supporting

## 1. Problem statement

Buffer printable keys within a timeout to jump to matching item (menus,
selects). Timing is the hard part.

## 2. Competitors

Zag typeahead (timeout ~500ms, reset); Radix RovingFocus typeahead;
react-aria; APG.

**Decision:** Zag timeout/reset semantics; match from current index
forward then wrap.

## 3–9

Runtime buffer string + timer only. Locale-sensitive lowercase. Tests:
timing reset; wrap; no-match no-move; dispose clears buffer.
