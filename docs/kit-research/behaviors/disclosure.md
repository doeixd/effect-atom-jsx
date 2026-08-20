# Behavior research: `disclosure` (seed upgrade)

Date: 2026-07-29  
Status: researched  
Tier: seed → T2/T3 composite  
Build priority: demo for Machine (K0 acceptance)

## 1. Problem statement

Expand/collapse content from a trigger (`aria-expanded` /
`aria-controls`). Seed exists as boolean atom + press toggle. Upgrade
path: optional Machine + presence + focus.

## 2. Competitors

| Library | API |
| --- | --- |
| Zag | accordion/collapsible machines |
| Radix | Collapsible / Disclosure |
| react-aria | useDisclosure |
| Native | `<details>` / `summary` |

**Decision:** Keep plain Behavior for simple cases; Machine when
animating (compose presence). Platform floor = `<details>`.

## 3. State vs refs

| Snapshot-safe | Runtime-only |
| --- | --- |
| `isOpen` | trigger/content handles |

**Decision:** isOpen snapshots (dormant disclosure restores open).

## 4–9

Keyboard: Enter/Space via press. Single vs accordion exclusive = widget.
Tests: seed coverage + resume open state + details floor note.
