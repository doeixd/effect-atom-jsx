# Behavior research: `longPress`

Date: 2026-07-29  
Status: researched  
Tier: T1  
Build priority: later

## 1. Problem statement

Fire an action after pointer held beyond threshold (context menus,
accessibility long-press). Must cancel on move past threshold or early
release; compose with `press` without double-fire.

## 2. Competitors

react-aria `useLongPress`; Zag context-menu; Floating UI less central.

**Decision:** react-aria long-press semantics.

## 3–9

Runtime timers only. Options: `threshold` (default 500ms), `onLongPress`,
`onLongPressStart/End`. Cancel on pointer move > tolerance. Tests: fire
after threshold; cancel on release; dispose clears timer. Effect
`Effect.sleep` + interrupt preferred over bare setTimeout.
