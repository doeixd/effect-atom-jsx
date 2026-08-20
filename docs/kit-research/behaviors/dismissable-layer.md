# Behavior research: `dismissableLayer`

Date: 2026-07-29  
Status: researched  
Tier: T3  
Build priority: **load-bearing #4**

## 1. Problem statement

Overlays (dialog, popover, menu, select) stack. **Escape** and **outside
pointer** must dismiss the **topmost** layer only; nested layers must not
steal each other's dismiss. Source libraries use module globals; we need
testable Effect services.

**Decision:** `DismissLayerStack` Context service + `dismissableLayer`
behavior; never a process-wide singleton without Layer override.

## 2. Competitor map

| Library | Module / API | Notes |
| --- | --- | --- |
| Zag.js | dismissable layer / interact-outside utils | Stack + branch; port edge cases |
| Radix | `DismissableLayer`, `RemoveScroll`, focus guards | Gold for nesting + pointer-down outside |
| Base UI | Dialog/Popover dismiss + modal modes | `modal` / `trap-focus` / false trichotomy |
| react-aria | `useOverlay`, `DismissButton`, `useInteractOutside` | SR dismiss buttons; isOpen wiring |
| Floating UI | `useDismiss` | Escape + outside press; bubbles option |
| Native | `<dialog>` cancel, `popover` light-dismiss | Platform floor |

**Decision:** Primary = **Radix DismissableLayer** nesting rules + **Base UI
modal trichotomy**. Secondary = Floating `useDismiss`. Platform =
dialog/popover when used.

## 3. State vs refs split

| Snapshot-safe | Runtime-only |
| --- | --- |
| Layer id, open boolean (widget) | Stack order array of layer ids, DOM node refs |
| | Pointer capture, body listeners |

**Decision:** Stack membership is runtime service state (atom in service).
Widget open state is widget machine/atom (snapshot-safe).

## 4. Interaction spec

- On open: push layer; on close/dispose: pop exact-once.
- Escape: only topmost `disableOutsidePointerEvents` / dismiss-on-escape layer.
- Pointer down outside: topmost with outside-dismiss; optional
  `onInteractOutside` preventDefault to keep open (combobox).
- Nested: outside of child is still "inside" parent for parent purposes.
- Focus guards optional (compose `focusTrap` / `focusScope`).

**Decision:** Stack service + per-layer options:
`dismissOnEscape`, `dismissOnOutsidePress`, `disableOutsidePointerEvents`.

## 5. ARIA contract

Behavior doesn't set roles. May coordinate `aria-modal` at widget.
react-aria's hidden DismissButton for SR: widget-level optional.

**Decision:** SR dismiss buttons stay in dialog/popover anatomy, not core
stack.

## 6. Platform-native floor

- `<dialog>.showModal()`: native light dismiss / Escape / focus trap.
- `popover="auto"`: light dismiss + stacking.
- Progressive: behavior is fallback/enhancement when custom markup used.

**Decision:** Document platform floor; JS stack still required for custom
non-dialog overlays and cross-widget nesting.

## 7. Affe API shape

```ts
// Service
class DismissLayerStack extends Context.Service<DismissLayerStack, {
  push(layer): Effect
  // ...
}>()("DismissLayerStack") {}

dismissableLayer({
  onDismiss: () => void,
  dismissOnEscape: true,
  dismissOnOutsidePress: true,
})
// requires root: Element.Container
```

**Decision:** Service in `R` + Behavior; Layer.succeed for tests.

## 8. Port sources

- Zag dismissable-layer / interact-outside (MIT).
- Radix DismissableLayer branch logic (MIT) — reimplement.
- Floating UI useDismiss option matrix.

**Decision:** Port Zag utility logic into Affe service+behavior.

## 9. Tests day one

- Nested two layers: Escape closes top only.
- Outside press on parent while child open → child only.
- Dispose mid-stack reorders correctly; double-dispose no-op.
- Test Layer with mock stack, no DOM globals.
