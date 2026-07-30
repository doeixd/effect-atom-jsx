# Widget research: Popover

Date: 2026-07-30
Status: **researched — K3 entry gate satisfied (Popover)**
Template: KR 9-section widget template (`docs/COMPONENT_KIT_PLAN.md`, KR phase),
following `widgets/combobox.md` as the exemplar.
Downstream: gates K3's Popover; shares its floating-layer floor with
`widgets/tooltip.md` (read together — `popover`/anchor-positioning/
`dismissableLayer` decisions are made once, for both). Popover is also the
substrate the plan folds `HoverCard` into (§7 trigger axis).

Sources consulted: the Popover API (WHATWG/OpenUI: `popover="auto" | "manual" |
"hint"`, `popovertarget`/`popovertargetaction`, `:popover-open`, `beforetoggle`/
`toggle`, top layer, light dismiss), CSS Anchor Positioning (`anchor-name`/
`position-anchor`/`@position-try`), WAI-ARIA APG (**there is no "Popover"
pattern** — the relevant patterns are *Dialog (Non-Modal)* and disclosure; W3C
document licence, cited not copied), Zag.js `popover` machine + `popover.connect.ts`,
Ark UI Popover anatomy, Radix `Popover` (+ `HoverCard`), Base UI Popover, react-aria
`Popover`/`DialogTrigger`/`usePopover` (**Apache-2.0 — read for spec only, never
copied**), `@floating-ui/dom`, `@stylextras/ui` popover/invoker/anchor notes,
CSS-Tags rung-zero contract. Local: `src/A11y.ts` `PopoverSlots`/`Popover`
pattern (L151–157, catalog L198 `tier:"stateful"`, `roles:["dialog"]`),
`src/Element.ts` capability lattice, `docs/kit-research/behaviors/{dismissable-layer,
anchor-position,focus-scope,live-announce}.md`, `docs/kit-research/widgets/
{dialog,tooltip}.md` (shared floor).

Scope decision up front: **one widget, `Popover`, with a `trigger` policy axis
(`"click" | "hover"`) that subsumes `HoverCard`.** Radix ships `HoverCard` as a
separate component; it is the same non-modal anchored floating panel with a hover
open policy and the tooltip warm-up timer instead of a click. A second widget
would double the anatomy/recipe/test surface for a trigger policy. Rejected:
separate `HoverCard` widget (it is `Popover trigger="hover"` + the shared
`hover` group timer — the same timer Tooltip uses). Distinct from Tooltip:
a Popover **may contain interactive content** (`content` is `Container`), takes
focus, and is click-dismissable — the exact boundary Tooltip refuses to cross.

---

## Decision summary (one line per section)

Read this table first; each row is expanded, with sources and rejected
alternatives, in the numbered section it points at.

| § | Decision |
| --- | --- |
| 1 | **Anatomy**: 3 slots — `trigger` (`Interactive`, `Press` for click policy / `Hover`+`Focus` for hover policy), `content` (**`Container`** — interactive children are the whole point, the opposite of Tooltip), `anchor` optional/hidden-capable (positioning anchored to a different element than the trigger, per Zag/Radix); `arrow`/`positioner`/`portal`/`backdrop`/`title`/`close` rejected as anatomy (decoration, renderer, top-layer-obviated, or consumer content inside `content`); this **extends `A11y.PopoverSlots`**, which today declares only `trigger`/`content`. |
| 2 | **State & machine**: **no `Machine`** — same reasoning as Dialog: 2 states and `popover="auto"` holds the open state in the platform. Ship a plain `popover` behavior over one `Atom.Writable<boolean>` (`open`); snapshot is `{open}`; on the hover policy it composes the shared `hover` group timer. Rejected: porting Zag's `popover.machine.ts` states (port its `connect` attribute set + edge cases instead). |
| 3 | **Interaction**: `popover="auto"` supplies light-dismiss (outside-click), Escape, and top-layer stacking for free; what remains is **focus policy (non-modal), open/close on the chosen trigger, and hover warm-up for `HoverCard` mode**; the trigger is an **excluded node** on the dismiss path (the classic dismiss-then-reopen bug); nested popovers are platform-stacked LIFO. |
| 4 | **ARIA**: **decision — role depends on content** — default `role="dialog"` on `content` (the non-modal dialog reading APG endorses) with `aria-labelledby` when a heading exists; trigger gets `aria-haspopup="dialog"` + `aria-expanded` + `aria-controls` (a Popover **is** a disclosure, unlike Tooltip); a `role`-less "just a positioned panel" mode is available for menus/listboxes that carry their own role; three `a11y:*` diagnostics — `aria-expanded` mirrors open, `aria-controls` resolves to `content`, focus lands in `content` on open. |
| 5 | **Platform floor**: rung zero is **`popover="auto"` + `popovertarget` invoker + CSS anchor positioning** — open/close/light-dismiss/Escape/stacking/positioning **with zero JS** (a strictly stronger rung-zero win than Tooltip's hint, because the invoker toggles it); `@floating-ui/dom` behind the shared `CSS.supports` seam in `anchorPosition`; `dismissableLayer` **defers to the popover stack** and only adds trigger-exclusion + hover-intent — identical seam design to Combobox §5. |
| 6 | **Tokens & variants**: consumes color/spacing/radius/stroke/typography/elevation/motion (+ optional blur); Recipe surface `size: sm\|md\|lg`, `variant: solid\|subtle`, `placement` via data-attrs from `anchorPosition`; `open`/`side`/`align` are data-attributes, never variants; a `HoverCard` is **not** a variant — it is the `trigger` policy (§7); exit animation is `allow-discrete` + `@starting-style` in CSS, not a `presence` machine (shared decision with Dialog §5). |
| 7 | **API**: `open?: Atom.Writable<boolean>` is the whole controlled/uncontrolled story; add `trigger?: "click" \| "hover"` (the `HoverCard` fold) with `openDelay`/`closeDelay` reusing Tooltip's group service; adopt Zag's `positioning`, Radix's `modal?` (a rarely-true opt-in that adds `scrollLock`+`focusTrap` and makes it dialog-ish); adopt native `command="toggle-popover"`; **reject** `portal`, `asChild`, `forceMount`, `onOpenChange` callbacks, and a separate `HoverCard` API. |
| 8 | **Resumability & dormancy**: **decision — Popover resumes open** (unlike Tooltip): snapshot is `{open}`, and the **invoker `command="toggle-popover"`/`popovertarget` gives a fully working open/close/light-dismiss/positioned panel with ZERO JS** — this is the rung-zero win the plan names, second only to Dialog; activation binds to `content`'s `beforetoggle`/`toggle` + first `press`/`hover` on `trigger`, DOM-open reconciled DOM-wins; two proofs — open-while-dormant→activate (still open, no reopen/flash) and dismiss-while-dormant→activate (atom reads false). |
| 9 | **Port sources**: Zag `popover.connect.ts` (ARIA/attribute set) as MIT port; Zag `popover.machine.ts` **NOT ported** (§2), read for edge cases; Radix `Popover`+`HoverCard` **tests** (MIT) for the trigger-policy + focus-return matrix; Base UI popover tests (MIT); `@floating-ui/dom` dependency; react-aria `usePopover` **spec-only, Apache-2.0, never copied**; APG *Dialog (Non-Modal)* as tiebreaker; `@stylextras/ui`/CSS-Tags for the invoker+`popover=auto`+anchor floor. |

### Prerequisites K3 must add first

Four gaps, decided here rather than worked around:

1. **`A11y.PopoverSlots` is minimal.** It declares `trigger`/`content` only
   (`src/A11y.ts` L152–154). K3 extends it to the §1 contract (adds the optional
   hidden-capable `anchor` slot; keeps `content` as `Container`). Additive change
   to a published contract; in scope for prerelease. (Note: today's catalog entry
   `roles:["dialog"]` is retained but §4 makes the role content-dependent —
   recorded so the catalog metadata is understood as the *default* role.)
2. **No `popover="auto"` / `popovertarget` / `command="toggle-popover"` typing
   on the JSX host.** Rung zero in §5/§8 requires authoring the popover attribute
   and the invoker; K3 adds them to the intrinsic attribute types (ambient, zero
   runtime — the CSS-Tags pattern), **shared** with Dialog's invoker-command
   prerequisite and Tooltip's `popover="hint"` prerequisite.
3. **`View.Event` has no keyboard/native-popover events.** It is
   `{Press, Click, Input, Focus, Blur, Hover}`. Popover needs the shared
   **`View.Event.Keydown`** (Escape refinement on the fallback path) and, for the
   `content` slot contract, native **`View.Event.Toggle`** (`toggle`, shared
   spelling with Dialog's `beforetoggle`). `View.Event.make("toggle")` is the
   stopgap.
4. **The hover-policy path reuses Tooltip's shared group timer** (the `hover`
   behavior's service, prereq 3 in `tooltip.md`) — recorded so `HoverCard` mode
   does not grow its own timer. Decision noted, not a new primitive.

Also recorded: `A11y.catalog` lists Popover as `tier: "stateful"` (L198).
**Decision: keep it** — a Popover owns open state (unlike Tooltip's transient
timer), so "stateful" is correct even though §2 uses no `Machine` (tier is about
owning state, not about a `Machine`, per Dialog's prerequisite 4).

---

## 1. Anatomy

### Per-library parts

| Part | Zag / Ark | Radix | Base UI | react-aria | Native | Ours |
| --- | --- | --- | --- | --- | --- | --- |
| trigger | `trigger` | `Trigger` | `Trigger` | `DialogTrigger`/`Button` | `popovertarget` / `command` invoker | ✅ `trigger` |
| anchor (positioning) | `anchor` (via `positioning`) | `Anchor` | `PositionerAnchor` | — | (anchor CSS `position-anchor`) | ✅ optional `anchor` |
| portal | (framework) | `Portal` | `Portal` | (Overlay) | — (top layer) | ⛔ renderer concern |
| positioner | `positioner` | (in `Content`) | `Positioner` | — | — (anchor CSS) | ⛔ merged into `content` |
| content / popup | `content` | `Content` | `Popup` | `Popover`/`Dialog` | `[popover=auto]` | ✅ `content` (**`Container`**) |
| backdrop | — | — | `Backdrop` (modal) | (ModalOverlay) | `::backdrop` (modal only) | ⛔ pseudo-element / modal-only |
| arrow | `arrow` | `Arrow` | `Arrow` | — | — | ⛔ decoration |
| title / description | `title`/`description` | (consumer) | (Title/Description) | `Heading` | — | ⛔ consumer content inside `content` |
| close button | `closeTrigger` | `Close` | `Close` | `CloseButton` | `command="hide-popover"` invoker | ⛔ consumer button (invoker/`Press` inside `content`) |

### Decision — minimal anatomy (2 required + 1 hidden-capable)

```ts
export const PopoverSlots = View.Slots.define({
  // required
  trigger: { capability: Element.Capability.Interactive,
             allowedEvents: [View.Event.Press, View.Event.Hover, View.Event.Focus] },
  content: { capability: Element.Capability.Container,  // interactive children WELCOME
             allowedEvents: [Toggle /* prereq 3 */] },
  // optional (hidden-slot compatible)
  anchor:  { capability: Element.Capability.Base /* position-anchor target ≠ trigger */ },
})
```

The load-bearing choice is the mirror image of Tooltip: **`content` is
`Container`.** A Popover's reason to exist is to hold interactive content —
forms, menus, buttons, links — so it carries the full child-interaction
contract, and this is the type-level line between Popover and Tooltip
(`Base`). `trigger` declares `Press` (click policy) *and* `Hover`+`Focus`
(hover/HoverCard policy) so one contract serves both trigger modes (§7).

`anchor` is optional and hidden-capable: Zag and Radix both let the popover be
positioned relative to a *different* element than the one that opens it (e.g. a
toolbar button opens a panel anchored to a selection). When absent, `trigger` is
the anchor. It is `Base` because it is a pure positioning reference with no
interaction contract.

Rejected parts and why: `portal` (renderer concern); `positioner` (a wrapper
that exists only because React cannot attach transforms externally —
`anchorPosition` attaches to `content` directly, as in Combobox/Tooltip §1);
`backdrop` (a Popover is non-modal by default — no backdrop; in the rare
`modal:true` case it is `::backdrop`, a pseudo-element, §5, per the Dialog
decision); `arrow` (decoration — a `::before`); `title`/`description`/`close`
(these are **consumer content placed inside `content`**, not anatomy — a
Popover, unlike Dialog, does not require a title, and its close button is any
`Press` target or a `command="hide-popover"` invoker inside `content`). This is
the intended asymmetry with Dialog: Dialog structures its interior because
modality demands a labelled title and a close affordance; Popover leaves its
interior to the consumer.

---

## 2. State & machine

Zag models popover as a machine (`open`/`closed`) with activities for
dismissable-layer, focus management, and positioning. Radix: a boolean +
`Presence` + `DismissableLayer` + `PopperContent`. Base UI: boolean + transition
state. react-aria: `useOverlayTriggerState` (a boolean).

### Decision — **no `Machine`.** Plain behavior; the platform holds the state.

Identical reasoning to Dialog §2: 2 states, and `popover="auto"` holds the open
state on the element (`:popover-open`, toggled by the invoker, by
`showPopover()`/`hidePopover()`, and by light-dismiss) with no JS. A `Machine`
would be a lagging second copy of authoritative platform state, and the desync
failure mode (user light-dismisses while the machine still says `Open`) is
exactly what the machine was meant to prevent. The plan's dividing line —
"does the platform already own the state machine?" — puts Popover with Dialog,
not with Menu/Select/Combobox.

So Popover ships as:

- one `Atom.Writable<boolean>` (`open`) — the intent channel, mirroring
  `content`'s `:popover-open`,
- a `popover` **behavior** that (a) reflects intent → `showPopover()`/
  `hidePopover()` (or lets the invoker do it), and (b) reflects platform reality
  → writes the atom back from `toggle`/`beforetoggle`, with a re-entrancy guard,
- composed behaviors: `press` (click trigger), `hover` + the shared group timer
  (hover/HoverCard trigger, §7), `focusScope` (non-modal focus policy, §3),
  `anchorPosition` (§5), and on the fallback path only `dismissableLayer`; when
  `modal:true`, additionally `scrollLock` + `focusTrap` (which is when it becomes
  a Dialog in all but name — §7).

**Snapshot state (see §8): `{ open: Schema.Boolean }`.** No state tag, no
placement (re-derived), no highlight.

**Runtime refs (never snapshotted):** the `content`/`trigger`/`anchor` handles,
previously-focused element (for restore), the hover group-timer token, floating-ui
`autoUpdate` cleanup, the re-entrancy guard, fallback focus-trap/dismiss state.

Rejected: porting `popover.machine.ts` (read for edge cases, port none of the
states — §9); a `presence` Machine for exit animation (§6/§5 does it in CSS,
same as Dialog); `CONTROLLED.*` events (the atom is the control channel).

---

## 3. Interaction spec

**APG *Dialog (Non-Modal)* and the disclosure pattern are the tiebreakers.**
As with Dialog, much of the table says "native".

| Interaction | Native `popover="auto"` | Ours adds |
| --- | --- | --- |
| open (click policy) | `popovertarget`/`command="toggle-popover"` invoker — **zero JS** | intent atom → `showPopover()`; `press` when authored imperatively |
| open (hover policy) | — (no native hover-open for `auto`) | **`hover` + shared warm-up timer** (the `HoverCard` fold, §7); opens after `openDelay` |
| light dismiss (outside click) | auto-dismissed by the platform | **trigger-exclusion only** — register `trigger` as excluded so the outside-click that closes does not immediately reopen (the classic dismiss-then-reopen bug; Radix does exactly this) |
| Escape | closes the topmost `auto` popover | nothing on the native path (fallback path: `interactOutside`/Escape wiring) |
| focus on open | **not modal — focus does NOT auto-move** for `popover=auto` | **decision: non-modal focus policy** — move focus into `content` (first focusable / `initialFocus`) *only* when opened by keyboard/click intent, keep the page live (contrast Dialog's containment); `HoverCard` mode does **not** move focus (a hover panel stealing focus is a bug) |
| Tab inside | not contained (non-modal) — Tab can leave into the page | **nothing** — this is the defining non-modal property; on `Tab` out of `content` the popover closes (Radix behavior) unless `modal` |
| close from inside | `command="hide-popover"` invoker or `<form>` — zero JS | `hidePopover()`; focus returns to `trigger` per `restoreFocus` |
| focus on close | not automatic for popover | **`restoreFocus` policy** — return focus to `trigger` when close was keyboard/programmatic; do nothing on light-dismiss-by-pointer |
| nested popovers | top-layer stack, LIFO, each light-dismisses independently | nothing — **no layer registry on the native path** (Dialog's decision, reused) |
| body scroll | not locked (non-modal) | **not locked** — a non-modal popover must not lock scroll; only `modal:true` adds `scrollLock` |

So "what remains for our behaviors?" on the click path: **non-modal focus-in /
focus-return policy, trigger-exclusion, and Tab-out-closes.** On the hover path:
**the warm-up/cool-down timer** (reused from Tooltip). Everything else — top
layer, light dismiss, Escape, stacking, positioning — is platform.

`modal:true` (rare opt-in): adds `scrollLock` + `focusTrap` + `::backdrop` and
becomes, honestly, a Dialog. **Decision: `modal:true` is supported but
documented-as-thin — "if you want a modal popover you want `Dialog`"** — the
mirror of Dialog's `modal:false` note ("you probably want Popover"). The two
widgets meet in the middle and the docs point each mode at the other's home.

---

## 4. ARIA contract

```
trigger  → <button type=button> (or invoker: popovertarget / command="toggle-popover")
           aria-haspopup="dialog"  (present — a popover IS a disclosure)
           aria-expanded=<open>    (mirrors open state)
           aria-controls=content-id
content  → role="dialog"  (DEFAULT — non-modal dialog; role-less mode available)
           aria-labelledby=<heading-id if a title exists> | aria-label
           popover="auto"  (§5)
           [role omitted when content carries its own: menu/listbox/etc.]
anchor   → (positioning only; no role/aria)
```

### Decision — role is content-dependent, default `role="dialog"`

APG has **no "popover" pattern**; a general interactive floating panel reads best
as a **non-modal dialog**, which is what Radix and Base UI emit by default.
**Decision: `content` defaults to `role="dialog"` (non-modal — *without*
`aria-modal`, exactly the Dialog §4 rule), with `aria-labelledby` pointing at a
heading inside `content` when one exists, else an `aria-label`.** But when the
Popover is the shell for a widget that carries its own role — a menu
(`role="menu"`), a listbox, a color picker — **the `role` is omitted on
`content`** so it does not double-wrap the inner role. This is the
"role-less positioned panel" mode, and it is why Popover is a *substrate* for
Menu/Select rather than competing with them.

### Decision — trigger IS a disclosure (opposite of Tooltip)

Unlike Tooltip (§4 there: no `aria-haspopup`, no `aria-expanded`), the Popover
trigger **does** emit `aria-haspopup="dialog"` (or `"menu"`/`"listbox"` matching
the content role), `aria-expanded` mirroring open, and `aria-controls` pointing
at `content`. A Popover is an opened thing; the trigger must announce it. This
pair of opposite decisions (Tooltip omits, Popover emits) is the clearest ARIA
expression of the two widgets' different natures.

`A11y.pattern("popover", PopoverSlots)` must validate: required slots present;
`trigger` is `Interactive` and declares `Press` (and `Hover`/`Focus` when
`trigger:"hover"`); `content` is `Container` and declares `Toggle`. Beyond the
generic validator, three dev-only runtime diagnostics: (1) `aria-expanded` on
`trigger` equals the open state; (2) `aria-controls` resolves to `content`'s id;
(3) after a keyboard/click open, `document.activeElement` is inside `content`
(non-modal focus-in) — skipped for `trigger:"hover"`. **Decision: these three
become `a11y:*` diagnostic codes and each is a Chromium keyboard test.**

---

## 5. Platform-native floor

| Piece | Native primitive | Coverage | Remains for JS |
| --- | --- | --- | --- |
| layering / stacking | `popover="auto"` top layer | above `z-index`, escapes overflow/transform/contain ancestors, LIFO stack | nothing |
| open/close, zero JS | `popovertarget` / `command="toggle-popover"` invoker | full toggle cycle with no script | hover-open, focus policy |
| light dismiss | `popover="auto"` | outside-click + Escape dismiss the topmost popover | trigger-exclusion, hover-intent |
| placement | CSS anchor positioning (`anchor-name`/`position-anchor`/`@position-try`) | Chrome 125+, Firefox 132+, Safari 18.2+ (flip 18.4+) → ~91% traffic | collision fallback on older engines |
| close from inside, zero JS | `command="hide-popover"` invoker, `<form>` | closes without script | focus-return policy |
| state observability | `beforetoggle`/`toggle` events, `:popover-open` | pre-JS-observable open/close (§8 activation) | nothing |
| exit animation | `transition-behavior: allow-discrete` + `@starting-style` | enter + exit in pure CSS | nothing |
| modal case (rare) | `::backdrop` when `modal:true` via `showModal`-style path | backdrop/blur | `scrollLock` + `focusTrap` (fallback of Dialog) |

**Decisions.**

1. **Rung zero is `popover="auto"` on `content` + a `popovertarget`/
   `command="toggle-popover"` invoker + CSS anchor positioning.** This is a
   *stronger* rung-zero than Tooltip's `hint`: the invoker means the panel
   **opens, closes, light-dismisses, and positions with zero JS** — the exact
   win the plan names ("a `popover="auto"` light-dismiss ... functions before any
   framework code loads"). Feature-detection seam is the shared
   `CSS.supports("anchor-name: --a")` in `anchorPosition`; `@floating-ui/dom`
   attaches only on the fallback path. Popover declares intent (`placement`,
   `flip`, `offset`) and never branches itself.
2. **`dismissableLayer` defers to the popover stack when `popover="auto"` is in
   use** — the platform already routes Escape/outside-press to the topmost
   popover; the behavior then only adds trigger-exclusion and (hover policy) the
   hover-intent grace. This is **the same seam design as Combobox §5**, reused
   verbatim, and is the "behaviors are progressive, not always-on" rule made
   concrete.
3. **`modal:true` reuses Dialog's fallback stack** (`scrollLock` + `focusTrap` +
   `::backdrop`) behind the same `showModal`/dialog-detection seam — recorded so
   the two widgets share one modal implementation rather than forking it.
4. **CSS-Tags rung-zero contract:** `<button popovertarget="p">` +
   `<div id="p" popover="auto" data-affe-popover data-part="content">` gives a
   working, positioned, light-dismissable, OS-theme-following (`light-dark()`)
   panel **with no framework at all**. The three host forms (`[popover]` element,
   `[data-affe-popover]`, `.popover`) are styled purely from the foundation
   stylesheet. This is the dormant experience (§8).

Shared-floor note (with Tooltip): anchor-positioning seam, `@floating-ui/dom`
dependency, and the popover intrinsic-attribute typing are **decided once across
`popover.md` and `tooltip.md`** and stay identical. The only divergence:
`popover="auto"` + invoker + `dismissableLayer` (Popover) vs `popover="hint"` +
no dismiss layer (Tooltip).

---

## 6. Tokens & variants

Token axes consumed: **color** (surface, border, `bgSubtle`), **spacing**
(padding, gap), **radius**, **stroke** (border, focus ring), **typography**,
**elevation** (a popover floats higher than a tooltip — a real shadow),
**motion** (enter/exit via `@starting-style` + `allow-discrete`, honouring
`prefers-reduced-motion`), and **optionally blur** (frosted panel / modal
backdrop). All via `light-dark()` so a dormant panel follows OS theme with zero
JS.

Variant surfaces surveyed: Zag/Ark/Radix/Base UI expose none (headless);
`@stylextras/ui` exposes `size`/`variant`/`sx`.

**Decision — Recipe surface:**

```ts
variants: {
  size:    { sm | md | lg },              // max-inline-size, padding
  variant: { solid | subtle },
  state:   (derived, not authored)        // [data-open], [data-side], [data-align]
}
defaults: { size: "md", variant: "solid" }
```

Anatomy-bound recipe slots: `content`, `arrow` (**recipe-only, `::before`** — the
§1 asymmetry: styling structure finer than behavioral), plus consumer-styled
interior. Rejected: `intent`/tone variants (a popover is a surface, not a status
message); a `HoverCard` variant (**it is the `trigger` policy, not a style
variant** — §7); a `modal` variant (`modal` is behavior, a data-attribute state,
not a Recipe axis); any `placement` authored variant (placement is
`anchorPosition` output → `data-side`/`data-align`). Open/side/align are
data-attributes driven by the behavior and `anchorPosition`, never variants.

Exit animation is CSS (`allow-discrete` + `@starting-style`), not the `presence`
behavior — the **same decision as Dialog §5**, for the same reason: the top layer
keeps the element alive through the exit transition, so `presence` is not needed
on the native path (it remains for JS-unmounted lazy content and the fallback).

---

## 7. API surface comparison

| Concern | Zag/Ark | Radix | Base UI | react-aria | Native | **Ours** |
| --- | --- | --- | --- | --- | --- | --- |
| open state | `open`/`defaultOpen`/`onOpenChange` | same | same | `useOverlayTriggerState` | `:popover-open` / methods | `open?: Atom.Writable<boolean>` |
| trigger policy | click | click; `HoverCard` separate | click | click | invoker (click) | **`trigger?: "click"\|"hover"`** (folds `HoverCard`) |
| hover delays | — | `HoverCard` `openDelay`/`closeDelay` | — | — | — | `openDelay`/`closeDelay` (reuse Tooltip group service) |
| modality | — | `modal?` | `modal?` | `isModal` | (non-modal; modal via dialog) | `modal?: boolean` (default `false`; true ⇒ "use Dialog") |
| placement | `positioning` | `side`/`align`/`sideOffset`/`collisionPadding` | `side`/`align` | `placement` | anchor CSS | `placement`/`offset`/`flip` → `anchorPosition` |
| anchor ≠ trigger | `anchor`/`getAnchorRect` | `Anchor` | `PositionerAnchor` | `triggerRef` | `position-anchor` | optional `anchor` slot (§1) |
| initial focus | `initialFocusEl` | `onOpenAutoFocus` | `initialFocus` | `autoFocus` | — | `initialFocus?: "auto"\|"first"\|SlotRef` |
| restore focus | `finalFocusEl` | `onCloseAutoFocus` | `finalFocus` | (restore) | (none) | `restoreFocus?: boolean\|SlotRef` (default true) |
| close on outside | `closeOnInteractOutside` | `onPointerDownOutside` | — | `isDismissable` | light dismiss | (platform) + trigger-exclusion; `closeOnInteractOutside?` on fallback |
| exit animation | data-state + CSS | `Presence`/`forceMount` | transition | — | `allow-discrete` | **CSS only** (§6); no `forceMount` |
| portal | — | `Portal` | `Portal` | `UNSAFE_portalContainer` | — (top layer) | **rejected** |
| callbacks | `onOpenChange` | `onOpenChange` + focus/dismiss pairs | similar | similar | events | **no callbacks** — atoms + `Component.action`; `beforeClose` guard only |

**Decisions.** Controlled/uncontrolled collapses to **one code path** (`open`
atom; `Component.state` when omitted) — no `defaultOpen`/`onOpenChange` triad,
same thesis as Combobox/Dialog. **The headline API decision: `trigger:
"click" | "hover"` folds `HoverCard` into Popover** — `"hover"` composes the
`hover` behavior + Tooltip's shared group warm-up timer and suppresses focus-in;
Radix ships a whole second component for exactly this. Adopt: Zag's
`positioning` shape (→ `anchorPosition`), the optional `anchor` (positioning ≠
trigger), Radix's `modal?` (default false, documented as "reach for Dialog").
Radix's focus/dismiss callback quartet collapses to declarative `initialFocus`/
`restoreFocus` + one `beforeClose` guard, exactly as in Dialog §7. **Rejected
outright:** `portal`, `forceMount`, `asChild` (slot remapping), a separate
`HoverCard` API, and all `on*Change` callbacks.

Composition points we publish: the headless component + the extended
`PopoverSlots` contract; the `popover` behavior alone (attach to any
`[popover]`/trigger pair — the "I already have markup" story); `anchorPosition`/
`dismissableLayer`/`hover` separately; the recipe data (`mergeRecipes`-patchable).
Hostile-customization list (from what Radix/shadcn users fork): convert click →
hover (HoverCard) without swapping components, anchor to a non-trigger element,
nest a popover inside a popover, make it modal, and swap the positioning
strategy — all from outside, over plain imports, no fork.

---

## 8. Resumability & dormancy

**Decision — Popover resumes open** (the contrast with Tooltip, which is
activation-only): snapshot is `{ open: Schema.Boolean }`, held in
`Component.state`, so `Resume.snapshotState` round-trips it with zero new
resume-kernel code. Open state is *meaningful* across dormancy because a Popover
holds durable content (a form, a menu) the user may have opened deliberately —
unlike a tooltip's transient hover artifact.

**Dormant experience (decided — a rung-zero win second only to Dialog):** the
server renders `<button popovertarget="p" command="toggle-popover">` +
`<div id="p" popover="auto" data-affe-popover>…</div>` with anchor CSS. Before a
single byte of JS: the panel **opens and closes from the invoker, positions
against its anchor, light-dismisses on outside-click and Escape, stacks in the
top layer, and follows OS theme** via `light-dark()`. Interactive content inside
(links, form controls, submit buttons) works because it is real DOM. What is
missing pre-JS: the hover-open policy (HoverCard mode needs the timer), the
non-modal focus-in/return policy, and trigger-exclusion nicety — all acceptable
degradations layered on at activation.

**What snapshots:** `{ open }`. **What does not:** the `content`/`trigger`/
`anchor` handles, previously-focused element, hover timer token, floating-ui
cleanup, re-entrancy guard, `beforeClose` closure (a `Portable` captures/bind
concern if a function; Schema-configured options are portable by construction).

**Activation trigger:** the widget is **addressable and activatable** —
activation binds to `content`'s own **`beforetoggle`/`toggle`** (the platform
fires it regardless of who opened the popover) plus first `press`/`hover` on
`trigger`, all pre-JS-observable via `src/resume-event.ts`. **Decision: the
popover is opened by the platform first and adopted by the runtime second**
(Dialog's rule reused) — activation attaches listeners and reconciles the atom
from observed reality; it never calls `showPopover()` on an already-open panel
(a no-op-or-flash) and never closes-and-reopens to "sync".

Two K3 resume proofs (mirroring Dialog §8):

1. **Open-while-dormant, then activate**: assert the panel is still open, the
   `open` atom reads `true`, focus is untouched (non-modal — no focus steal), no
   position re-flash, no closed-state flash.
2. **Light-dismiss-while-dormant, then activate**: the platform closed it on an
   outside click; assert the `open` atom activates to `false` and no stale
   snapshot reopens it — proving DOM-wins reconciliation (the authority is the
   platform, §2).

---

## 9. Port sources

| From | Artifact | License | Use |
| --- | --- | --- | --- |
| Popover API / OpenUI | `popover="auto"`, `popovertarget`, `command="toggle-popover"`, `beforetoggle`/`toggle`, light dismiss, top layer | spec | **the primary "source"** — the floor in §5/§8 is a spec read, not a port; shared attribute-typing prereq with Dialog + Tooltip |
| CSS Anchor Positioning | `anchor-name`/`position-anchor`/`@position-try` | spec | placement floor (§5); shared seam with Tooltip/Combobox |
| Zag.js | `packages/machines/popover/src/popover.connect.ts` | MIT | **primary port** — id conventions + exact ARIA/attribute set (§4), minus a fixed role (ours is content-dependent) |
| Zag.js | `popover/src/popover.machine.ts` | MIT | **deliberately NOT ported** (§2) — read for edge-case inventory (dismiss stack, focus-return, anchor-rect) only |
| Zag.js | `utils/dismissable`, `interact-outside` | MIT | already scheduled by the `dismissableLayer`/`interactOutside` behavior docs; Popover consumes, does not re-port |
| Radix | `packages/react/popover/src/**/*.test.tsx`, `hover-card` tests | MIT | **test suites to port** — trigger-exclusion (dismiss-then-reopen), non-modal focus/Tab-out, focus-return, HoverCard warm-up |
| Base UI | popover test suite | MIT | **test suites to port** — anchor-vs-trigger positioning, nested stack, exit-animation, modal backdrop |
| Floating UI | `@floating-ui/dom` | MIT | **dependency, not a port** (fallback placement only, §5) — shared with Tooltip/Combobox |
| react-aria | `@react-aria/overlays` `usePopover`, `DialogTrigger` | Apache-2.0 | **spec only — read for behavior, never copied source, never copied tests** |
| WAI-ARIA APG | *Dialog (Non-Modal)* + disclosure patterns | W3C Document Licence | tiebreaker citations (§3, §4) — there is no "popover" pattern |
| `@stylextras/ui` | popover + invoker + anchor notes | (per package) | platform-floor + activation-boundary confirmation (§5); no code |
| CSS-Tags | `[popover=auto]` + `popovertarget` host + `@layer` order | MIT (same author) | rung-zero stylesheet contract (§5.4) |
| shadcn/ui | `popover`, `hover-card` recipes | MIT | **customization-pressure inventory only** → hostile-customization list (§7). Not a behavior source. |

Provenance rules: every ported file carries a header naming the upstream repo,
path, commit SHA, and licence; `NOTICE`/`THIRD_PARTY` entries for Zag (MIT),
Radix (MIT), Base UI (MIT); react-aria's Apache-2.0 material is **read-for-spec
only** and must not appear as copied source or copied tests — recorded explicitly
so a later agent does not paste it in.

Gates this widget must pass: type tests for the extended `PopoverSlots` contract
(optional `anchor`, `content` is `Container`) and slot remapping/hidden slots;
the three `a11y:*` popover diagnostics; exact-once disposal + no-op double-dispose
(hover timer + floating-ui cleanup included); Chromium keyboard test covering the
§3 table including click and hover policies, non-modal Tab-out-closes, and
trigger-exclusion; the two dormant-resume proofs in §8; a **zero-JS test** that
asserts the §8 invoker markup opens, positions and light-dismisses with scripting
disabled (shared gate class with Dialog); the hostile-customization suite from
§7; and the `@stylextras/ui`-derived matrix — reduced motion (exit collapses),
forced colors (border/shadow remain), RTL (side flip), 200% zoom, narrow
viewport.
