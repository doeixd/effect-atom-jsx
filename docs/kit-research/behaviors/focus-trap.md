# Behavior research: `focusTrap`

Date: 2026-07-29  
Status: researched  
Tier: T2  
Build priority: supporting (seed exists ✅)

## 1. Problem statement

While active, Tab cycles inside a container; outside focus forbidden
(modal dialogs). Seed: `behaviors.focusTrap`.

## 2. Competitors

| Library | API |
| --- | --- |
| Zag | focus-trap util |
| Radix | FocusScope trapped |
| react-aria | FocusScope contain |
| Floating UI | FloatingFocusManager modal |
| Native | `<dialog>` modal |

**Decision:** Align with Radix/react-aria contain; use native dialog when
possible (platform floor).

## 3. State vs refs

Runtime: container, focusable list, previously focused. Snapshot: none.

## 4–9

Upgrade seed: initial focus option, restore focus on deactivate,
MutationObserver for dynamic focusables, inert outside optional
(compose hideOutside). Tests already partial — add restore-focus and
dynamic children.
