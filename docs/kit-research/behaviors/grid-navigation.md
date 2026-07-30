# Behavior research: `gridNavigation`

Date: 2026-07-29  
Status: researched  
Tier: T4  
Build priority: later

## 1. Problem statement

2D arrow navigation (date grids, color grids, data grids).

## 2. Competitors

react-aria useGridList / useCalendar; Zag date-picker; APG grid.

**Decision:** Defer until DatePicker/Calendar KR; API
`gridNavigation({ columns, wrap })` over collection.

## 3–9

Snapshot: row/col or flat index. RTL flips columns. Tests with 7-col
calendar fixture when DatePicker researched.
