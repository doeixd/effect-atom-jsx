# Behavior research: `hideOutside`

Date: 2026-07-29  
Status: researched  
Tier: T3  
Build priority: supporting

## 1. Problem statement

Mark rest of document inert/hidden from AT while modal open
(`aria-hidden` or `inert`).

## 2. Competitors

Radix `aria-hidden` / `HideOthers`; Zag aria-hidden util; `inert`
attribute modern floor.

**Decision:** Prefer `inert` when available; fallback aria-hidden tree
walk. Exact-once restore on dispose.

## 3–9

Runtime only. Never snapshot. Tests: siblings get inert; dispose clears;
nested modals refcount.
