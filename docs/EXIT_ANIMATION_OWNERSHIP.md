# Exit Animation Ownership (P10)

**Status:** decided 2026-07-09  
**Decision owner:** AF-UI runtime / renderer contract

## Question

`Style.animate` / `enter` / `exit` exist as style descriptors, but exit
animations require delaying unmount until the animation finishes. Who owns
deferred removal?

## Decision

**The renderer (DOM/runtime host) owns deferred unmount.**

| Layer | Owns |
| --- | --- |
| **Style** | Exit descriptors only (keyframes, duration, easing) — pure data |
| **Behavior** | May *signal* “closing” state (e.g. disclosure `isOpen → false`) but must not schedule unmount timers itself |
| **View / component** | Declares structure; does not wait on animation clocks |
| **Renderer** | Detects exit style on a node about to leave the tree, keeps the node mounted until `animationend` / timeout fallback, then removes and runs cleanup |

## Rationale

1. Exit completion is a host lifecycle problem (DOM `animationend`, platform
   timers). Putting it in Style reintroduces CSS-in-JS runtime ownership.
2. Behaviors stay portable (no DOM clocks). Disclosure closes state; the
   renderer honors exit descriptors if present.
3. A later view-transition service can *plug into* the renderer hook without
   changing Style/Behavior APIs.

## Fallback

If no exit descriptor is present, unmount is immediate (current behavior).

## Non-goals (this note)

- Implementing the renderer delay itself (follows this decision).
- Cross-document View Transitions API (optional enhancement later).
