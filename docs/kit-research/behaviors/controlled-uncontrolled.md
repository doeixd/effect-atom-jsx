# Behavior research: controlled / uncontrolled bridge

Date: 2026-07-29  
Status: researched  
Tier: T6  
Build priority: supporting (atoms already unify)

## 1. Problem statement

React libraries dual-path `value`/`defaultValue`. Affe: external atom vs
`Component.state` — same type.

## 2. Competitors

React controlled components; Radix `value`+`onValueChange`; Zag controlled
context props.

**Decision:** One helper `bindable(propAtom | initial)` → WritableAtom.
No dual code paths in widgets.

## 3–9

Snapshot only for setup-owned state. Document pattern in kit guide.
Tests: controlled external atom not overwritten on spawn; uncontrolled
snapshots.
