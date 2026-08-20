# Behavior research: `move`

Date: 2026-07-29  
Status: researched  
Tier: T1  
Build priority: later (slider/drag first consumers)

## 1. Problem statement

Pointer-capture drag math: deltas, origin, pointerId, lostcapture. Used by
slider thumbs, splitters, draggable.

## 2. Competitors

react-aria `useMove`; Zag slider drag; Radix Slider. Native:
`setPointerCapture`.

**Decision:** react-aria useMove event shape (`deltaX/Y`, `pointerType`).

## 3. State vs refs

Snapshot: none (or transient dragging flag). Runtime: pointerId, origin,
capture element.

## 4–9

`move({ onMoveStart, onMove, onMoveEnd })` on Draggable capability.
Pointer capture required. Tests: capture/release; multi-pointer ignore
non-primary; dispose releases capture.
