# Behavior research: `observeResize` / `observeRect`

Date: 2026-07-29  
Status: researched  
Tier: T7  
Build priority: later

## 1. Problem statement

Scoped ResizeObserver / rect tracking for positioners and responsive
slots.

## 2. Competitors

Floating UI autoUpdate; Radix useSize; react-aria useResizeObserver.

**Decision:** Effect.acquireRelease around observers; atom of DOMRect.

## 3–9

Runtime-only. Tests: callback on size change; disconnect on dispose
exact-once.
