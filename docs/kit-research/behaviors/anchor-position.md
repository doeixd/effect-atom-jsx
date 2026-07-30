# Behavior research: `anchorPosition`

Date: 2026-07-29  
Status: researched  
Tier: T3  
Build priority: **load-bearing #5**

## 1. Problem statement

Position a floating surface relative to an anchor (trigger) with collision
detection, flips/shifts, arrow alignment, and scroll/resize updates —
without each widget reimplementing geometry.

**Decision:** Depend on **`@floating-ui/dom`** (not React bindings); wrap as
Affe Behavior. Platform CSS anchor where available as floor.

## 2. Competitor map

| Library | Module / API | Notes |
| --- | --- | --- |
| Zag.js | Wrapper around floating-ui | Don't port wrapper; call floating-ui |
| Radix | Popper / Position | Historically floating-ui based |
| Base UI | Floating UI team members; position APIs | Specs/tests |
| react-aria | Overlay placement hooks | Less geometry-complete than floating-ui |
| Floating UI | **`@floating-ui/dom`** computePosition, autoUpdate, middleware | Industry standard |
| Native | CSS `anchor()` / `position-anchor` | Progressive floor |

**Decision:** Primary = **`@floating-ui/dom`**. Native CSS anchor as
feature-detected floor for dormant/static cases.

## 3. State vs refs split

| Snapshot-safe | Runtime-only |
| --- | --- |
| Placement preference (`bottom-start`), strategy | Anchor/floating element refs |
| | Middleware results (x,y), autoUpdate teardown |

**Decision:** Only placement prefs may be props (not usually snapshotted).
Geometry is runtime-only.

## 4. Interaction spec

- `computePosition` + `autoUpdate` while open.
- Middleware: flip, shift, offset, arrow, size (optional).
- Update on scroll/resize/layout.
- RTL-aware placement mapping.

**Decision:** Expose middleware config passthrough; sensible defaults
(offset 4–8, flip+shift).

## 5. ARIA contract

None (pure geometry). Widgets set aria-controls / relationships.

**Decision:** No ARIA in this behavior.

## 6. Platform-native floor

CSS anchor positioning when supported; floating-ui fallback.

**Decision:** Feature-detect CSS anchor; fall back to floating-ui; document
seam.

## 7. Affe API shape

```ts
anchorPosition({
  // anchor: Element.Handle, floating: Element.Container
  placement: "bottom-start",
  // middleware options
})
// provides: coords atom?, update()
```

Requires Scope for autoUpdate cleanup. Opaque (DOM measurement).

**Decision:** Behavior; runtime dep `@floating-ui/dom`.

## 8. Port sources

- `@floating-ui/dom` as dependency (MIT).
- Zag popover positioning options as default middleware set.
- Base UI positioning tests if portable.

**Decision:** Depend, don't port floating-ui.

## 9. Tests day one

- Mock getBoundingClientRect / computePosition in unit tests.
- autoUpdate unsubscribed on Scope close (exact-once).
- Placement option affects middleware config.
