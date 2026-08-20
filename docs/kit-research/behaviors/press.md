# Behavior research: `press`

Date: 2026-07-29  
Status: researched  
Tier: T1  
Build priority: **load-bearing #3**

## 1. Problem statement

Normalize activation across **mouse, touch, pen, keyboard (Enter/Space), and
virtual clicks** (screen readers). Raw `click` misses keyboard, double-fires
on touch, and confuses drag-off cancel. Nearly every interactive slot needs
this.

**Decision:** `press` is the single activation primitive; widgets/behaviors
must not attach raw `click` for primary activation.

## 2. Competitor map

| Library | Module / API | Notes |
| --- | --- | --- |
| Zag.js | pressable utility / machine press handling | Pointer + key paths in machines |
| Radix | Internal press on Primitive; mostly click | Less thorough than react-aria |
| Base UI | useButton / press semantics | Port tests |
| react-aria | **`usePress`** | Gold standard: press start/end/up, cancel, keyboard, virtual |
| Floating UI | — | |
| Native | `click`, `keydown` Space/Enter on buttons | Floor for real `<button>` |

**Decision:** Primary = **react-aria usePress** semantics (not code). Zag
pressable as secondary checklist.

## 3. State vs refs split

| Snapshot-safe | Runtime-only |
| --- | --- |
| Usually none (stateless) | Pointer id, target, pressed boolean for styling |
| Optional `pressed` atom for visual | |

**Decision:** Stateless by default; optional `isPressed` atom for styles;
no machine.

## 4. Interaction spec

- Keyboard: Space/Enter on focusable; preventDefault Space keyup scroll.
- Pointer: down on target, up on target → press; leave+release → cancel.
- Touch: avoid 300ms ghost click double-fire; ignore emulated mouse after touch.
- Virtual: `click` with `detail === 0` or virtual click flag still fires once.
- `preventFocusOnPress` option (menus).
- Compose with `longPress` (threshold) without double-trigger.

**Decision:** Match react-aria press lifecycle events:
`onPressStart` / `onPressEnd` / `onPress` / `onPressUp` / cancel.

## 5. ARIA contract

Does not set roles. Works with `button`, `summary`, custom `role=button`
(ensure key handlers when not native button).

**Decision:** Behavior assumes Interactive capability; document need for
role=button when not native.

## 6. Platform-native floor

Native `<button>` / `<a href>` already activate via click+keyboard. For
dormant pages, prefer real buttons so press JS is enhancement.

**Decision:** Platform floor = native button semantics; JS press normalizes
custom elements and consistent cross-input styling.

## 7. Affe API shape

```ts
press({
  onPress: () => void,
  // onPressStart, onPressEnd, isDisabled, preventFocusOnPress
})
// attaches to Element.Interactive
// provides optional isPressed atom
```

**Decision:** Plain Behavior; portable candidate (zero-arg handlers via
Resume.event).

## 8. Port sources

- react-aria usePress test suite / documented edge cases (MIT).
- Zag pressable if present in utilities.

**Decision:** Spec+tests from react-aria; reimplement on Element handles.

## 9. Tests day one

- Keyboard Space/Enter; pointer down-up; cancel on leave.
- Touch then mouse ghost not double-firing.
- Disabled ignores.
- Exact-once listener dispose.
