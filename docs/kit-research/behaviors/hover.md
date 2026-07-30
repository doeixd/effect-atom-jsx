# Behavior research: `hover`

Date: 2026-07-29  
Status: researched  
Tier: T1  
Build priority: supporting

## 1. Problem statement

Open/close or style on pointer hover with **touch rejection**, open/close
delays (tooltips), and no sticky hover after touch.

**Decision:** Separate from `press`; delay policies first-class.

## 2. Competitor map

| Library | Module / API | Notes |
| --- | --- | --- |
| Zag | tooltip machine delays | openDelay/closeDelay |
| Radix | Tooltip Provider delayDuration | Skip delay on consecutive |
| react-aria | useHover | isDisabled; touch ignore |
| Floating UI | useHover | restMs, move, handleClose |

**Decision:** Primary = Floating UI useHover + react-aria touch ignore.

## 3. State vs refs

| Snapshot-safe | Runtime-only |
| --- | --- |
| rarely | timers, isHovered |

**Decision:** Optional isHovered atom; timers runtime-only.

## 4. Interaction

Pointer enter/leave; ignore pure touch; configurable open/close delay;
cancel timers on dispose.

**Decision:** Match tooltip-grade delay API.

## 5–6. ARIA / platform

No ARIA. CSS `:hover` is floor for non-JS styling; JS hover for delayed
overlays.

**Decision:** CSS floor for styles; JS for delayed popups.

## 7. Affe API

`hover({ openDelay, closeDelay, onHoverChange })` on Interactive/Container.

## 8–9. Port / tests

react-aria useHover + Floating useHover tests; timer cleanup tests.
