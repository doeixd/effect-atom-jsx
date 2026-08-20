# json-render v0.20.0 — upstream changes relevant to AN-5 (2026-08-17)

Reviewed from `vercel-labs/json-render` PR **#321** (the v0.20.0 release,
merged 2026-08-16) and the feature PRs it ships: **#299, #300, #302, #307,
#319, #320**. Per the ratified `DQ-094`, json-render is *reference input* for
AN-5 and the *target format* of the `src/view-spec-json-render.ts` lowering —
this note records what v0.20.0 changes about that target and what it
validates about our IR. The AN-5 plan itself remains
`future/agent/generative-view-spec.spec.ts`; the lowering-contract additions
below are appended there as executable specs.

## The headline: named slots (#320) — our slot model is now expressible 1:1

v0.20.0 adds `UIElement.slots` as **named structural child references**,
with `children` remaining the default slot (rendered React-side as
`slots?: Record<string, ReactNode>`; `slots.default` and unknown names
warn). This is the single most consequential change for us:

- Our IR is slot-shaped from the ground up (`element("Card", { slots:
  { body: [...] } })`, mirroring `View.Slots`). Against v0.19 the lowering
  had to flatten named slots into the one `children` array, losing the slot
  names — the exact information our whole slot-contract system exists to
  carry. Against v0.20 the lowering maps named slots to `UIElement.slots`
  **verbatim**: no flattening, no name loss, no invented wrapper elements.
- Upstream scoping rule to preserve: named slots render once and do **not**
  inherit the repeat scope of their owning element; `repeat` applies only to
  `children`. Our lowering must not emit a repeat whose iterated content
  sits in a named slot.
- Upstream calls named-slot *rendering* React-specific for now; the spec
  field itself is renderer-neutral, which is the part the lowering targets.

## Other changes, mapped

| PR | Upstream change | Implication for us |
| --- | --- | --- |
| #299 | `visible` is now explicitly optional in every framework schema; `children` stays **required**, with the prompt rules demanding `children: []` on leaves (models omit it ~⅓ of the time otherwise) | Lowered output must stamp `children: []` on every leaf element rather than omitting the field; omitting `visible` is legal and preferred when we have no condition. Their "models omit required fields" finding independently supports our `decodeSpec`-as-trust-boundary posture. |
| #300 | `autoFixSpec` prunes dangling children references; `invalid_visible` validation; filtered repeat | Their validator/auto-fix loop is a *host-side repair convenience*. Our boundary stays fail-closed: `decodeSpec` + `validate` refuse, they do not repair. If a host wants auto-repair it runs upstream `autoFixSpec` on the LOWERED artifact, after our validation — never as a substitute for it. Dangling-reference pruning also implies the lowered format is a flat element dictionary with id references, which the lowering must emit consistently. |
| #302 | `harness-chat` example (AI SDK 7 canary + sandbox transport) | Reference only — a working chat-host integration to test any future demo against. No plan impact. |
| #307 | `onSuccess`/`onError` action chains forward the full binding — `{ action, params }` — and the renderer-bridge contract is now `executeAction(binding: ActionBinding)` instead of `(name: string)` (**breaking** for custom bridges) | Two consequences. (1) Lowering: our typed `on("click", action(name, params))` events lower to full `{ action, params }` bindings, including `onSuccess`/`onError` chains — params survive the wire now, so the lowering does not need a side channel. (2) If we ever ship a renderer bridge (an `@affe/agent`-style adapter binding lowered specs to our dispatch), it implements the v0.20 `ActionBinding` contract from day one; the bare-string form is dead. Our action-allowlist validation (`ui:action-not-registered`) applies to the binding's `action` name exactly as before. |
| #319 | Nested repeats: `repeat.statePath` accepts `{ "$item": "field" }` for item-relative paths; relative paths outside a repeat scope are rejected | Our typed state refs already distinguish root paths from item paths structurally, so nested-list lowering becomes expressible without flattening. The upstream validation rule (relative path requires an enclosing repeat scope) is one our own `validate` should mirror when repeats land in the IR — same diagnostic-with-negative-control pattern as the existing codes. Repeat is not yet in the AN-5 first slice; this is recorded for the slice that adds it. |
| #293 | pnpm/Node toolchain pins | No plan impact. |

## What this changes in the plan

1. **The lowering contract grew** — pinned as a new executable spec in
   `future/agent/generative-view-spec.spec.ts`: named slots lower to
   `slots` (not flattened), every lowered element carries a `children`
   array (`[]` on leaves), and lowered action bindings carry their
   `params`. Red until `src/view-spec-json-render.ts` exists; it is part of
   the AN-5 work item, not new scope.
2. **The IR needs nothing new for v0.20.0.** Named slots, optional
   visibility, and full action bindings are all *better* targets for what
   the IR already expresses. Nested repeats affect the future repeat slice
   only.
3. **Versioning**: the lowering targets json-render **v0.20.0 semantics**.
   If a pre-0.20 target is ever needed, slot flattening becomes an explicit
   downlevel option — not the default.
