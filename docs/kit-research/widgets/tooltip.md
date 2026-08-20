# Widget research: Tooltip

Date: 2026-07-30
Status: **researched — K3 entry gate satisfied (Tooltip)**
Template: KR 9-section widget template (`docs/COMPONENT_KIT_PLAN.md`, KR phase),
following `widgets/combobox.md` as the exemplar.
Downstream: gates K3's Tooltip; shares its floating-layer floor with
`widgets/popover.md` (read together — `popover`/anchor-positioning/
`dismissableLayer` decisions are made once, for both).

Sources consulted: WAI-ARIA APG *Tooltip* pattern (tiebreaker, W3C document
licence — cited, not copied), the Popover API `popover="hint"` and `manual`
states (WHATWG/OpenUI), CSS Anchor Positioning (`anchor-name`/
`position-anchor`/`@position-try`), Zag.js `tooltip` machine + `tooltip.connect.ts`
(the shared open/close-delay timer and the `interactive` option), Ark UI Tooltip
anatomy, Radix `Tooltip` + `TooltipProvider` (the group/skip-delay model), Base UI
Tooltip/`TooltipProvider`, react-aria `Tooltip`/`useTooltipTrigger`/
`TooltipTrigger` (**Apache-2.0 — read for spec only, never copied**),
`@floating-ui/dom` positioning, `@stylextras/ui` popover/anchor notes, CSS-Tags
rung-zero contract. Local: `src/A11y.ts` `TooltipSlots`/`Tooltip` pattern
(L144–149, catalog L197 `tier:"stateless"`), `src/Element.ts` capability lattice,
`docs/kit-research/behaviors/{hover,anchor-position,dismissable-layer,
live-announce}.md`, `docs/kit-research/widgets/popover.md` (shared floor).

Scope decision up front: **Tooltip is a describe-only, non-interactive overlay
and nothing else.** The moment content must be hovered into, focused, or
clicked — a link, a button, a form — it is **not a tooltip**; it is a
`Popover` (click) or a `HoverCard` (hover, interactive). This is the single most
important boundary in the doc and it is a *type-enforced rejection* (§1, §4):
the `content` slot is `Base`, not `Container`/`Interactive`, so interactive
children are a compile-time error. Rejected: an `interactive: true` escape
hatch (Zag/Radix ship one; it is exactly the footgun that produces inaccessible
"tooltips" that trap the pointer). Rejected: a separate `HoverCard` widget in
this doc (it is a `Popover` with the `hover` trigger policy — deferred to the
Popover doc's trigger axis, §7 there).

---

## Decision summary (one line per section)

Read this table first; each row is expanded, with sources and rejected
alternatives, in the numbered section it points at.

| § | Decision |
| --- | --- |
| 1 | **Anatomy**: 2 slots only — `trigger` (`Interactive`, declares `Hover`+`Focus`) and `content` (**`Base`, deliberately not `Container`** — the type-level ban on interactive tooltip content); this **matches today's `A11y.TooltipSlots` exactly**, so no contract change is needed; `arrow`/`positioner`/`portal`/`provider` all rejected as slots (decoration, renderer, or a service — the group timer is the `hover` behavior's shared service, not a slot). |
| 2 | **State & machine**: **no `Machine`** — like Dialog, this is a "no machine needed" case, but for a different reason: 2 states (`closed`/`open`) driven entirely by a **shared delay timer**, and on the platform path `popover="hint"` holds the open state. Ship a plain `tooltip` behavior over one `Atom.Writable<boolean>` (`open`) plus the shared-timer service from the `hover` behavior; snapshot, if anything, is `{}` (see §8 — a tooltip is **activation-only, it does not resume open**). |
| 3 | **Interaction**: hover **and** focus open (APG requires both); open after a **group-aware warm-up delay**, close after a short **cool-down** (Radix's `delayDuration`/`skipDelayDuration` group model, adopted); Escape closes immediately and stays closed until re-trigger; pointer-leave of *both* trigger and tooltip closes; **touch has no hover → decision: on touch, tooltip does not open at all** (the description must live in the accessible name / visible label instead — a tooltip is never the only home for information); never a tab stop, never focus-trapped, content is never pointer-reachable. |
| 4 | **ARIA**: `content` is `role="tooltip"` and the trigger points at it with **`aria-describedby`, never `aria-labelledby`** (a tooltip supplements, it does not name — APG); trigger keeps its own accessible name; no `aria-haspopup`, no `aria-expanded` (a tooltip is not a disclosure); three `a11y:*` diagnostics — `content` has no focusable/interactive descendants (the interactive-content ban, enforced at runtime too), `aria-describedby` resolves to the `content` id, trigger has an independent accessible name. |
| 5 | **Platform floor**: rung zero is **`popover="hint"`** on `content` + CSS anchor positioning + `interesttarget`/CSS `:popover-open` where available — the platform gives top-layer, non-modal, auto-dismiss-on-other-popover hint semantics with zero JS; `@floating-ui/dom` attaches only behind the shared `CSS.supports("anchor-name:--a")` seam in `anchorPosition`; `dismissableLayer` is **not used** (a hint auto-hides; there is nothing to light-dismiss); the delay/warm-up timing is the only thing JS strictly owns. |
| 6 | **Tokens & variants**: consumes color (surface/`bgInverse`, most themes ship a dark "inverted" tooltip), spacing (compact padding), radius, typography (small scale), elevation (low), motion (fast fade, `prefers-reduced-motion` → opacity-only), plus optional blur; **no `variant` axis** beyond `size: sm\|md` and `tone: default\|inverse` — a tooltip is deliberately the least-themed widget in the kit; `open`/placement are data-attributes, never variants. |
| 7 | **API**: `open?: Atom.Writable<boolean>` (one code path, no `defaultOpen`/`onOpenChange` triad); adopt Radix's `TooltipProvider` as a **`Tooltip.group(...)` service** carrying `delayDuration`/`skipDelayDuration`, not a component wrapper; adopt Zag's `openDelay`/`closeDelay` names; **reject** `interactive`, `disableHoverableContent` (moot once non-interactive), `asChild`-style render props (slot remapping), and all callbacks (atoms + `Component.action`). |
| 8 | **Resumability & dormancy**: **decision — a tooltip is activation-only; it does NOT resume open.** Its snapshot is empty: an open tooltip is a transient hover artifact with no meaningful dormant state to restore, and re-showing it on resume without a live pointer/focus would be a phantom. Dormant experience: `popover="hint"` + anchor CSS means the tooltip **still shows on hover/focus with zero JS**; activation (bound to first pointer-enter/focus on `trigger`) only upgrades the delay/group policy. The resume proof is the *negative*: dormant-then-activate must **not** flash a tooltip open. |
| 9 | **Port sources**: Zag `tooltip.machine.ts` read for its **delay/group-timer edge cases only** (we do not port the machine — §2), `tooltip.connect.ts` for the ARIA set; Radix `Tooltip`/`TooltipProvider` **tests** (MIT) for the group skip-delay and Escape-close matrix; `@floating-ui/dom` as a dependency; react-aria `useTooltipTrigger` **spec-only, Apache-2.0, never copied**; APG as tiebreaker; `@stylextras/ui`/CSS-Tags for the `popover="hint"` floor confirmation. |

### Prerequisites K3 must add first

Three gaps, decided here rather than worked around:

1. **`View.Event` has no `Keydown`** (it is `{Press, Click, Input, Focus, Blur,
   Hover}`). Tooltip needs it only for the Escape-to-close handler on `trigger`;
   it shares Combobox's/Dialog's pending **`View.Event.Keydown`** request rather
   than inventing its own. `View.Event.make("keydown")` is the stopgap. (Note:
   `TooltipSlots.trigger` already declares `Hover`+`Focus`, which is the load
   path; Keydown is additive.)
2. **No `popover="hint"` / `interesttarget` typing on the JSX host.** Rung zero
   in §5 requires authoring the hint popover attribute and the invoker-adjacent
   `interesttarget`; K3 adds them to the intrinsic attribute types (ambient,
   zero runtime — the CSS-Tags pattern), shared with Popover's `popover="auto"`
   / `popovertarget` addition.
3. **The shared open/close-delay timer needs a home.** Decision: it is a
   **service exposed by the `hover` behavior** (`hover`'s research doc already
   owns delay policy and touch rejection), consumed by both Tooltip and the
   Popover `hover` trigger. It is *not* a new behavior and *not* a slot. Recorded
   so nobody builds a `tooltipTimer` behavior.

Also recorded: `A11y.catalog` lists Tooltip as `tier: "stateless"` (L197).
**Decision: keep it.** The tier taxonomy is about whether the pattern owns
persistent state; a tooltip owns only a transient timer, so "stateless" is
correct and consistent with the §2 no-machine, §8 no-snapshot decisions.

---

## 1. Anatomy

### Per-library parts

| Part | Zag / Ark | Radix | Base UI | react-aria | Native | Ours |
| --- | --- | --- | --- | --- | --- | --- |
| provider / group | (context) | `TooltipProvider` | `TooltipProvider` | (context) | — | ⛔ service (`Tooltip.group`) |
| trigger | `trigger` | `Trigger` | `Trigger` | `TooltipTrigger` (wraps) | any element + `popovertarget`/`interesttarget` | ✅ `trigger` |
| portal | (framework) | `Portal` | `Portal` | (Overlay) | — (top layer) | ⛔ renderer concern |
| positioner | `positioner` | (in `Content`) | `Positioner` | — | — (anchor CSS) | ⛔ merged into `content` |
| content / popup | `content` | `Content` | `Popup` | `Tooltip` | `[popover=hint]` | ✅ `content` (**`Base`**) |
| arrow | `arrow` | `Arrow` | `Arrow` | — | — | ⛔ decoration |

### Decision — minimal anatomy (2 slots; already the shipped contract)

```ts
// This is already src/A11y.ts L144–147 — no change required.
export const TooltipSlots = View.Slots.define({
  trigger: { capability: Element.Capability.Interactive,
             allowedEvents: [View.Event.Hover, View.Event.Focus /* + Keydown, prereq 1 */] },
  content: { capability: Element.Capability.Base }, // NOT Container — see below
})
```

The load-bearing capability choice is `content: Base`. Every other overlay in
the kit (Dialog `content`, Popover `content`, Combobox `content`) is a
`Container` because interactive children are legitimate. **A tooltip's content
must never be interactive**, so it is `Base` — the narrowest capability, with no
child-interaction contract — and an author who tries to put a `<button>`/`<a>`/
input inside it gets a capability error at the slot boundary. This is how the
scope decision ("that's a Popover, not a Tooltip") is *enforced* rather than
merely documented. The current `A11y.TooltipSlots` already types `content` as
`Base`, so the shipped contract is correct as-is and K3 changes nothing here —
worth stating explicitly so no one "upgrades" it to `Container`.

`trigger` is `Interactive` and **is** a real element in the tab order (its own
tab stop, because the described control is itself interactive), declaring
`Hover` and `Focus` — the two APG-required open triggers — plus (prereq 1) a
`Keydown` for Escape.

Rejected parts and why: `provider`/`group` (Radix/Base ship a `TooltipProvider`
component so a set of tooltips shares one warm-up timer; we make that a
**service**, `Tooltip.group(...)`, §7 — it is cross-cutting state, not DOM
structure); `portal` (renderer concern); `positioner` (a wrapper node exists
only because React cannot attach transforms externally — `anchorPosition`
attaches to `content` directly, exactly as in Combobox §1); `arrow` (pure
decoration — a `::before` on `content`).

---

## 2. State & machine

Zag models tooltip as a machine (`closed`/`opening`/`open`/`closing`) with a
shared global timer store so a group of tooltips can "warm up" once. Radix and
Base UI hold a boolean plus a provider-level delay context. react-aria:
`useTooltipTriggerState` (a boolean + a global warm-up/cooldown timer).

### Decision — **no `Machine`.** Plain behavior + shared timer service.

The plan's rule is "machine only when states × events > trivial." Tooltip is
2 meaningful states (`closed`/`open`) and — like Dialog — **the platform can own
the state**: `popover="hint"` opens/closes the hint in the top layer with no JS.
The only genuine logic is *timing* (warm-up/cool-down, group skip-delay), and
timing is a timer, not a state machine. A `Machine` here would encode
`opening`/`closing` transient states that are really just "a timer is pending" —
better modelled as a pending Effect with a finalizer.

So Tooltip ships as:

- one `Atom.Writable<boolean>` (`open`) — the intent channel; on the platform
  path it mirrors `content`'s `:popover-open`,
- a `tooltip` **behavior** that: (a) on `Hover.enter`/`Focus` starts the
  warm-up timer, on expiry shows (`showPopover()` or writes the atom); (b) on
  `Hover.leave` (of *both* trigger and content) / `Blur` / `Escape` starts the
  cool-down and hides; (c) consults the **shared group timer service** from the
  `hover` behavior so a second tooltip within `skipDelayDuration` opens
  instantly,
- composed behaviors: `hover` (touch rejection + delay policy + the group
  service), `anchorPosition` (placement, §5), `focusVisible` (open on
  keyboard-focus, not on click-focus — a mouse click on the trigger should not
  pop a tooltip).

**Snapshot state (see §8): `{}` — nothing.** A tooltip does not resume open.

**Runtime refs (never snapshotted):** the `content` handle, the pending
warm-up/cool-down timers, the group-timer service token, the pointer-modality
flag, floating-ui `autoUpdate` cleanup.

Rejected: porting `tooltip.machine.ts` (we read it for its **timer edge cases**
— the exact warm-up/skip-delay/close-on-scroll list — and port none of its
states, §9); a `presence` Machine for the fade (§6 does it in CSS);
`CONTROLLED.*` events (the atom is the control channel, as in Dialog §2).

---

## 3. Interaction spec

**APG *Tooltip* is the tiebreaker.** APG's tooltip is intentionally thin:
show on hover *and* keyboard focus, hide on Escape and on blur/leave, never
take focus, never contain interactive content.

| Interaction | Behavior | Divergences → decision |
| --- | --- | --- |
| pointer enter `trigger` | after **warm-up delay** (group-aware), show | Radix `delayDuration` (default ~700ms) + `skipDelayDuration` group window; Zag shared timer store; **decision: adopt Radix's two-number group model** (`openDelay`, and a group `skipDelay` that makes the next tooltip instant). |
| pointer leave | after **cool-down** (short, ~default 0–300ms), hide — but only when the pointer has left **both** `trigger` and `content` | react-aria closes on leave of trigger; Radix keeps open while over content only if `interactive`. **Decision: since content is non-interactive, leaving the trigger closes; we still guard against the pointer crossing the gap to a non-interactive tooltip by treating trigger+content as one hover region for the leave test.** |
| keyboard focus `trigger` | show **immediately** (no warm-up) | APG + all libs: focus is intentional, hover is incidental. **Adopt: `Focus` opens with zero delay.** Only `focusVisible` focus (not click-induced focus) opens — mousedown-then-focus must not double-trigger. |
| blur `trigger` | hide immediately | unanimous. **Adopt.** |
| `Escape` | hide immediately, stay closed until pointer re-enters or re-focus | APG explicit ("Escape dismisses"). **Adopt.** Decision: Escape sets a "suppressed" runtime flag cleared on next leave+re-enter, so the tooltip does not immediately reappear while still hovered. |
| click / press `trigger` | **no tooltip state change** | a tooltip is not a disclosure; clicking the underlying control does its own thing. **Decision: press does not toggle the tooltip** (contrast Popover §3). |
| scroll / trigger leaves viewport | hide | Zag closes on scroll of an ancestor. **Adopt** (also prevents an orphaned hint after the anchor scrolls away). |
| touch (no hover) | **does not open** | touch has no hover state; Radix/Zag variously long-press or ignore. **Decision: on touch (`hover` behavior's touch rejection), the tooltip never opens — the information must also live in the accessible name or a visible label.** A tooltip is never the sole home for essential content; this is stated as an authoring rule and enforced by the interactive-content ban (§4). |

Focus: the tooltip **never takes DOM focus** and is **never focus-trapped** —
there is nothing focusable inside it (§1/§4). This is the cleanest contrast with
Dialog and Popover in the whole kit.

Group "warm" behavior (decided): a `Tooltip.group(...)` service holds one
warm-up timer and one skip-delay timer for all tooltips created under it. First
tooltip in a group pays the full `openDelay`; subsequent tooltips within
`skipDelay` of the last close open instantly ("the group is warm"). This is
Radix's `TooltipProvider` semantics and Zag's global timer store, converged —
implemented as the shared service from the `hover` behavior (prereq 3), not as a
component.

---

## 4. ARIA contract

```
trigger  → keeps its own role and its own accessible name (label/text);
           aria-describedby = content-id (ONLY while shown, or always —
           see decision); NO aria-labelledby, NO aria-haspopup, NO aria-expanded
content  → role="tooltip", id (stable), popover="hint" (§5);
           contains ONLY text/inline non-interactive content
```

### Decision — `aria-describedby`, never `aria-labelledby`

A tooltip *describes*; it does not *name*. APG's tooltip pattern uses
`aria-describedby`. Using `aria-labelledby` would replace the trigger's own
accessible name with the tooltip text, which is wrong for a control that already
has a label. **Decision: the trigger references `content` via `aria-describedby`
and retains its independent accessible name; if the trigger has *no* other
accessible name, that is an authoring error the diagnostic (below) flags — the
fix is to name the control, not to relabel it with the tooltip.**

Sub-decision — describedby always vs only-while-open: some AT do not announce a
`role="tooltip"` that is `display:none`. **Decision: keep `aria-describedby`
pointing at `content` permanently (the id is stable), and toggle visibility via
`popover`/CSS, not by removing the node** — so the description is discoverable by
AT even before the visual tooltip shows, matching APG's guidance that the
description be programmatically associated.

No `aria-haspopup` (a tooltip is not a popup you open), no `aria-expanded` (not
a disclosure) — both are Popover's, not Tooltip's, and emitting them here would
mis-announce the trigger.

`A11y.pattern("tooltip", TooltipSlots)` must validate: both slots present;
`trigger` is `Interactive` and declares `Hover`+`Focus`; `content` is `Base`.
Beyond the generic validator, three dev-only runtime diagnostics: (1)
**`content` has no focusable or interactive descendants** — the interactive-
content ban, enforced at runtime in addition to the compile-time `Base`
capability, because dynamic/`dangerouslySetInnerHTML` content can smuggle a
link in; (2) `trigger`'s `aria-describedby` resolves to `content`'s id;
(3) `trigger` has an accessible name **independent of** the tooltip.
**Decision: these three become `a11y:*` diagnostic codes and each is a Chromium
keyboard test.** Diagnostic (1) is the enforcement teeth behind the whole "not a
Popover" scope decision.

---

## 5. Platform-native floor

| Piece | Native primitive | Coverage | Remains for JS |
| --- | --- | --- | --- |
| layering | `popover="hint"` on `content` | top layer, above `z-index`, escapes overflow/transform ancestors, **zero JS** | delay timing only |
| auto-dismiss | `popover="hint"` semantics | a hint is light-dismissed and auto-closed when another popover opens; it does not need Escape wiring | Escape refinement + suppress flag |
| placement | CSS anchor positioning (`anchor-name`/`position-anchor`/`@position-try`) | Chrome 125+, Firefox 132+, Safari 18.2+ (flip 18.4+) → ~91% traffic | collision fallback on older engines |
| show-on-hover, no JS | CSS `:hover`/`:focus-visible` + `interesttarget` (where supported) | a pure-CSS hover tooltip is possible for the simplest case | group warm-up/skip-delay, touch policy |
| exit fade | `transition-behavior: allow-discrete` + `@starting-style` | enter and exit in pure CSS | nothing |

**Decisions.**

1. **Rung zero is `popover="hint"` on `content` + CSS anchor positioning.**
   `hint` (distinct from Popover's `auto`) is exactly the tooltip semantics: it
   coexists with an open `auto` popover instead of closing it, and it
   auto-dismisses. Feature-detection seam is shared with Popover in
   `anchorPosition` (`CSS.supports("anchor-name: --a")`); `@floating-ui/dom`
   attaches only on the fallback path. Tooltip declares intent (`placement`,
   `offset`) and never branches itself.
2. **`dismissableLayer` is NOT used by Tooltip.** A hint auto-hides and takes no
   focus; there is no outside-press to intercept and no layer stack to
   participate in. This is the "behaviors are progressive, not always-on" rule
   at its sharpest — Tooltip is the widget that consumes the *fewest* T3
   behaviors. Recorded so no one wires a dismiss layer "for consistency."
3. **JS strictly owns only the delay/group timing and the touch/suppress
   policy.** Everything else — top layer, positioning, fade, hover-show — the
   platform can do. Where `popover="hint"` is unsupported, the tooltip degrades
   to a positioned `role="tooltip"` div toggled by the behavior; where anchor
   positioning is unsupported, `@floating-ui/dom` positions it.
4. **CSS-Tags rung-zero contract:** `[data-affe-tooltip][popover=hint]` + an
   `interesttarget`/`aria-describedby` trigger gives a working, positioned,
   OS-theme-following (`light-dark()`) hover/focus tooltip **with no framework
   at all** — no group timing, no touch policy, which is acceptable and is
   exactly the dormant experience (§8).

Shared-floor note (with Popover): the anchor-positioning seam, the
`@floating-ui/dom` dependency, and the intrinsic-attribute typing for popover
attributes are **decided once here and in `popover.md`** and must stay
identical. The only tooltip/popover divergence at the floor is
`popover="hint"` (tooltip) vs `popover="auto"` (popover) and the presence
(popover) vs absence (tooltip) of `dismissableLayer`.

---

## 6. Tokens & variants

Token axes consumed: **color** (surface — most design systems ship an
*inverted*/high-contrast tooltip surface, so a `bgInverse` + `fgInverse` token
pair, with a normal-surface variant), **spacing** (deliberately compact
padding), **radius** (small), **typography** (the smallest readable scale),
**elevation** (low — a tooltip floats only slightly), **motion** (fast fade,
`prefers-reduced-motion` → opacity/none only), and **optionally blur** (rarely).
All via `light-dark()` so a dormant tooltip follows OS theme with zero JS.

Variant surfaces surveyed: Zag/Ark/Radix/Base UI expose none (headless);
`@stylextras/ui` exposes `size`/`sx`.

**Decision — Recipe surface (the smallest in the kit):**

```ts
variants: {
  size: { sm | md },                    // padding + font only
  tone: { default | inverse },          // inverse = dark-on-light-page tooltip
  state: (derived, not authored)        // [data-open], [data-side], [data-align]
}
defaults: { size: "sm", tone: "inverse" }  // inverted is the conventional default
```

Rejected: any `variant: solid|subtle|outline` axis (a tooltip is not a surface
you theme — it is one thing), `intent`/color-by-meaning (a tooltip is not a
status message; that is Toast/`role="alert"`), an `arrow` toggle as a variant
(the arrow is a `::before` styled from tokens). Placement (`data-side`/
`data-align`) and open are data-attributes driven by `anchorPosition` and the
behavior, never authored variants.

---

## 7. API surface comparison

| Concern | Zag/Ark | Radix | Base UI | react-aria | **Ours** |
| --- | --- | --- | --- | --- | --- |
| open state | `open`/`defaultOpen`/`onOpenChange` | same | same | `isOpen` via state | `open?: Atom.Writable<boolean>` |
| open delay | `openDelay` | `delayDuration` (provider) | `delay` | global warm-up | `openDelay?: number` |
| close delay | `closeDelay` | (provider) | `closeDelay` | global cooldown | `closeDelay?: number` |
| group / warm | global timer store | `TooltipProvider` + `skipDelayDuration` | `TooltipProvider` | global | **`Tooltip.group({ openDelay, skipDelay })` service** |
| interactive content | `interactive` | `disableHoverableContent` inverse | (hoverable) | — | **rejected** (that is `Popover`/`HoverCard`) |
| placement | `positioning` | `side`/`align`/`sideOffset` | `side`/`align` | `placement` | `placement`/`offset` → `anchorPosition` |
| disabled trigger | `disabled` | wraps disabled control | — | handles disabled | `disabled?: boolean` (still describes; §3) |
| callbacks | `onOpenChange` | `onOpenChange` | similar | — | **no callbacks** — atoms + `Component.action` |

**Decisions.** Controlled/uncontrolled collapses to **one code path**: `open` is
an optional writable atom; when omitted, `Component.state` creates it. No
`defaultOpen`/`onOpenChange` triad, same thesis as Combobox/Dialog §7. Radix's
`TooltipProvider` becomes **`Tooltip.group(...)`, a service** carrying
`openDelay`/`skipDelay` (the group warm timer, prereq 3) — it is ambient shared
state, so a service beats a wrapper component and composes through Effect layers.
Names adopted: Zag's `openDelay`/`closeDelay` (clearer than Radix's single
`delayDuration`). **Rejected outright:** `interactive`/`disableHoverableContent`
(moot and dangerous once content is non-interactive — this is the API expression
of the scope decision), `asChild`/render props (slot remapping covers it), and
all `on*Change` callbacks.

Composition points we publish: the headless component + `TooltipSlots` (already
in `A11y`), the `tooltip` behavior alone (attachable to any trigger/content pair
— "I already have markup"), `Tooltip.group` separately, and the recipe data
(`mergeRecipes`-patchable). Hostile-customization list: restyle to a
non-inverted surface, add an arrow, change delays per-group, and swap the
positioning strategy — all from outside, over plain imports, no fork. Notably
**"make the tooltip interactive" is NOT on the list** — it is refused, and the
refusal points the author at `Popover`.

---

## 8. Resumability & dormancy

**Decision — a tooltip is activation-only; it does not resume open. Snapshot is
empty (`{}`).** This is the deliberate contrast with Dialog (which resumes open)
and the reason Tooltip's `A11y` tier is `"stateless"`. An open tooltip is a
transient artifact of a *live* pointer or focus; there is no meaningful state to
carry across dormancy, and re-showing a tooltip on resume — with no pointer over
the trigger and no focus on it — would be a phantom overlay pointing at nothing.
So the runtime does not snapshot `open`, and on activation it does **not**
restore an open tooltip.

**Dormant experience (decided):** the server renders `trigger` with
`aria-describedby` and `content` with `popover="hint"` + anchor CSS. Before any
JS: hovering or focusing the trigger **still shows the positioned tooltip**
(pure `popover="hint"` + `:popover-open` + `interesttarget` where supported),
following OS theme via `light-dark()`. What is missing pre-JS: the group
warm-up/skip-delay timing (the platform shows on hover with the UA's own timing)
and the touch-suppression policy. Both are acceptable degradations — the tooltip
is *useful* at rung zero, just not delay-tuned.

**Activation trigger:** the widget is **addressable and activatable** —
activation binds to the first `pointer-enter`/`focus` on `trigger` (recorded by
the resume event recorder in `src/resume-event.ts`), and it only *upgrades* the
policy (installs the group timer, the touch rejection, the Escape-suppress
flag). It never *opens* a tooltip as a side effect of activation.

**Resume proof (the negative):** dormant page, then activate — assert that
**no tooltip flashes open** (activation must not synthesize a hover), that the
`aria-describedby` association is intact throughout, and that a subsequent real
hover opens the tooltip with the *group-tuned* delay rather than the UA default.
A second proof: hover-while-dormant shows the hint (platform), then activate
mid-hover — assert the visible hint is **adopted, not re-shown** (no flash, no
double fade), and cool-down now uses our timing.

---

## 9. Port sources

| From | Artifact | License | Use |
| --- | --- | --- | --- |
| WAI-ARIA APG | *Tooltip* pattern | W3C Document Licence | **primary spec** — describe-not-label, hover+focus, Escape, non-interactive; tiebreaker citations (§3, §4) |
| Zag.js | `packages/machines/tooltip/src/tooltip.machine.ts` | MIT | **deliberately NOT ported** (§2) — read only for the timer/group/close-on-scroll **edge-case inventory** |
| Zag.js | `tooltip/src/tooltip.connect.ts` | MIT | **ARIA/attribute set** port (§4) — `role="tooltip"`, `aria-describedby`, id conventions |
| Zag.js | global tooltip timer store | MIT | reference for `Tooltip.group` skip-delay semantics (§3/§7); implemented via `hover`'s shared service |
| Radix | `packages/react/tooltip/src/**/*.test.tsx`, `TooltipProvider` tests | MIT | **test suites to port** — group skip-delay, warm/cool timing, Escape-close, focus-vs-hover open |
| Base UI | tooltip/`TooltipProvider` test suite | MIT | **test suites to port** — delay grouping, exit-animation, disabled-trigger describe |
| Floating UI | `@floating-ui/dom` | MIT | **dependency, not a port** (fallback placement only, §5) — shared with Popover |
| react-aria | `@react-aria/tooltip` (`useTooltipTrigger`, `useTooltip`) | Apache-2.0 | **spec only — read for behavior, never copied source, never copied tests** |
| Popover API / OpenUI | `popover="hint"`, `interesttarget` | spec | the rung-zero floor in §5 — a spec read, not a port; shared attribute-typing prereq with Popover |
| CSS Anchor Positioning | `anchor-name`/`@position-try` | spec | placement floor (§5); shared seam with Popover |
| `@stylextras/ui` | popover/anchor + hint notes | (per package) | platform-floor + activation-boundary confirmation; no code |
| CSS-Tags | `[data-affe-tooltip][popover=hint]` host + `@layer` order | MIT (same author) | rung-zero stylesheet contract (§5.4) |

Provenance rules: every ported file carries a header naming the upstream repo,
path, commit SHA, and licence; `NOTICE`/`THIRD_PARTY` entries for Zag (MIT),
Radix (MIT), Base UI (MIT); react-aria's Apache-2.0 material is **read-for-spec
only** and must not appear as copied source or copied tests — recorded explicitly
so a later agent does not paste it in.

Gates this widget must pass: type tests that **interactive content in `content`
is a compile error** (the scope decision, enforced); the three `a11y:*` tooltip
diagnostics (interactive-content ban runtime check included); exact-once disposal
+ no-op double-dispose (timers cleared); Chromium keyboard test covering the §3
table including hover+focus open, Escape-close-and-suppress, and touch-no-open;
the two dormant-resume proofs in §8 (including the *negative* no-flash proof);
the group warm/skip-delay timing test; and the `@stylextras/ui`-derived matrix —
reduced motion (fade collapses), forced colors (border/background remain),
RTL (side flip), 200% zoom, narrow viewport.
