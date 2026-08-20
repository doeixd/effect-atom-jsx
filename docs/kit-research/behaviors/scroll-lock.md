# Behavior research: `scrollLock`

Date: 2026-07-29  
Status: researched  
Tier: T3  
Build priority: supporting

## 1. Problem statement

Prevent body scroll while modal open without layout shift (scrollbar
compensation).

## 2. Competitors

Radix RemoveScroll; react-remove-scroll; Zag body scroll lock; native
dialog modal scrolls.

**Decision:** Port RemoveScroll semantics (padding compensation); refcount
for nested.

## 3–9

Runtime body styles only. Service or behavior with refcount. Tests:
nested open/close; iOS touchmove edge if feasible; dispose restores.
