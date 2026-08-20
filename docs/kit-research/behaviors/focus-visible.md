# Behavior research: `focusVisible`

Date: 2026-07-29  
Status: researched  
Tier: T1  
Build priority: supporting

## 1. Problem statement

Show focus rings for **keyboard** (and modality-appropriate) focus, not
every mouse click. `:focus-visible` is the platform floor; JS modality
tracking helps polyfill and data-attribute styling.

**Decision:** Prefer CSS `:focus-visible`; JS behavior for attribute bridging
and older targets.

## 2. Competitor map

| Library | API | Notes |
| --- | --- | --- |
| react-aria | useFocusRing / useFocusable | isFocusVisible |
| Radix | Focus management internals | |
| Native | `:focus-visible` | Floor |

**Decision:** Primary = CSS; secondary = react-aria modality heuristics.

## 3. State vs refs

| Snapshot-safe | Runtime-only |
| --- | --- |
| none | modality (keyboard/pointer), isFocusVisible |

**Decision:** Runtime-only modality service optional later.

## 4–9

Track focusin/focusout + last input modality. Provides `isFocusVisible`
atom. Tests: mouse click no ring attr; Tab shows ring. Platform floor =
`:focus-visible` always documented.
