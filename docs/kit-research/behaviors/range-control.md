# Behavior research: `rangeControl`

Date: 2026-07-29  
Status: researched  
Tier: T5  
Build priority: later (Slider)

## 1. Problem statement

Multi-thumb range math: ordered thumbs, keyboard, pointer drag, RTL,
minStepsBetween.

## 2. Competitors

Radix Slider; Zag slider machine; react-aria useSlider; APG slider.

**Decision:** Zag/Radix multi-thumb constraints; compose `move` for drag.

## 3–9

Snapshot: values array. Runtime: thumb refs, dragging. Machine optional
for drag vs keyboard. Tests: thumb order invariant; RTL; keyboard page
steps.
