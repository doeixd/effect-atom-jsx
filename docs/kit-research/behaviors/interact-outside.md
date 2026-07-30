# Behavior research: `interactOutside`

Date: 2026-07-29  
Status: researched  
Tier: T3  
Build priority: supporting (used by dismissableLayer)

## 1. Problem statement

Detect pointer/focus interaction outside a set of nodes (content +
optional trigger). Building block for dismiss; also combobox "click
outside to close".

## 2. Competitors

Zag interact-outside; Radix DismissableLayer outside branch; react-aria
useInteractOutside; Floating useDismiss outsidePress.

**Decision:** Standalone behavior + used internally by dismissableLayer.

## 3–9

Runtime node sets only. Events: pointerdown/up strategy (Radix uses down
for disableOutside). Allow `onInteractOutside(event)` with
preventDefault. Tests: click inside no fire; outside fire; nested
portals counted as inside when registered.
