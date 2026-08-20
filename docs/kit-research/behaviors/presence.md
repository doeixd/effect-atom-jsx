# Behavior research: `presence` (Machine)

Date: 2026-07-29  
Status: researched  
Tier: T7  
Build priority: supporting — **first non-widget Machine customer**

## 1. Problem statement

Keep content mounted through **exit animations** after logical close;
unmount only when animation ends or reduced-motion skip.

## 2. Competitors

Radix Presence / `@radix-ui/react-presence`; Base UI transitions; Framer
presence patterns; CSS `@starting-style` / transitions.

**Decision:** Small Machine: `Mounted | Exiting | Unmounted` with events
`open`, `close`, `animationEnd`. Force unmount on reduced motion.

## 3. State vs refs

| Snapshot-safe | Runtime-only |
| --- | --- |
| phase tag (optional) | animationend listeners, timers |

**Decision:** Prefer not snapshot mid-exit (restore as open/closed only).

## 4–9

Compose with dialog/popover. Platform: CSS transitions. Tests: close →
still mounted until animationEnd; reduced-motion immediate unmount;
dispose aborts.
