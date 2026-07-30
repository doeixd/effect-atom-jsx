# Behavior research: `spinValue`

Date: 2026-07-29  
Status: researched  
Tier: T5  
Build priority: later (NumberField / time)

## 1. Problem statement

Step/clamp numeric value via buttons, keyboard (Up/Down/Page), wheel,
optional press-and-hold repeat.

## 2. Competitors

react-aria useNumberField / useSpinButton; Zag number-input; APG spinbutton.

**Decision:** APG spinbutton keys + react-aria step/clamp rules.

## 3–9

Snapshot: `value` number (or string for big decimals later). Runtime:
repeat timers. `min`/`max`/`step`. formControl for native submit.
Platform floor: `<input type=number>`. Tests: clamp; step; hold repeat
interrupt on dispose.
