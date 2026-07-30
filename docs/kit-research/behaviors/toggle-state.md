# Behavior research: `toggleState`

Date: 2026-07-29  
Status: researched  
Tier: T5  
Build priority: supporting

## 1. Problem statement

Boolean on/off with optional indeterminate (checkbox) or pressed
(toggle button). Controlled/uncontrolled collapse to atoms.

## 2. Competitors

Radix Toggle/Checkbox; react-aria useToggleState; Zag checkbox.

**Decision:** Atom-backed; no Machine unless group exclusivity (radio →
selectionModel).

## 3–9

Snapshot: boolean | 'indeterminate'. ARIA aria-checked/pressed. Native
floor: checkbox/switch. formControl projects value.
