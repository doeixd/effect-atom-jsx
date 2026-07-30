# Behavior research: `<name>`

Date:  
Status: draft | researched | implementing | done  
Tier: T1–T7  
Build priority: load-bearing | supporting | later

## 1. Problem statement

What interaction problem this behavior owns in one paragraph. Which widgets
compose it.

**Decision:** …

## 2. Competitor map

| Library | Module / API | Notes |
| --- | --- | --- |
| Zag.js | | |
| Ark UI | | |
| Radix | | |
| Base UI | | |
| react-aria | | |
| Floating UI | | |
| Native / StyleXtras | | |

**Decision:** primary inspiration source = …; secondary = …

## 3. State vs refs split (resumability)

What is Schema-serializable machine/atom state vs DOM refs / ephemera that
must live only in the behavior Scope.

| Snapshot-safe | Runtime-only |
| --- | --- |
| | |

**Decision:** …

## 4. Interaction / keyboard / pointer spec

Keys, pointer paths, touch, virtual click, cancellation. Cite APG when
libraries diverge.

**Decision:** …

## 5. ARIA / a11y contract

Attributes, roles, live regions, focus movement this behavior is responsible
for (vs the widget anatomy).

**Decision:** …

## 6. Platform-native floor

What the browser already does; feature-detection seam; dormant-page story.

**Decision:** …

## 7. Affe API shape

Slots / capabilities required, bindings contributed (`Behavior.provides`),
services (`R`), whether Machine is needed or plain Behavior, portable or opaque.

```ts
// sketched public shape
```

**Decision:** …

## 8. Port sources & license

Exact files/packages to port from (Zag utilities, Base UI tests, etc.) + MIT
attribution.

**Decision:** …

## 9. Tests required day one

Unit + Chromium keyboard/pointer cases; exact-once dispose; hostile
customization if relevant.

**Decision:** …
