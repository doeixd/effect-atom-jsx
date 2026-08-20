# Behavior research: `selectionModel`

Date: 2026-07-29  
Status: researched  
Tier: T4  
Build priority: supporting (seed `selection` ✅)

## 1. Problem statement

Single/multiple selection of logical items with toggle, clear, range
(Shift), anchor. Seed is single/multi array only.

## 2. Competitors

react-stately selection; Zag select machine; Radix Checkbox/Radio/Toggle
group; APG listbox multiselect.

**Decision:** Upgrade seed: modes `single | multiple | none`; range via
anchor index; equals fn preserved.

## 3. State vs refs

| Snapshot-safe | Runtime-only |
| --- | --- |
| selected keys/values atom | DOM selected attrs via effects |

**Decision:** Selection is snapshot-safe (form + resume).

## 4–9

`aria-selected` wiring. Controlled: external atom. Tests: multi toggle;
range select; clear; controlled path.
