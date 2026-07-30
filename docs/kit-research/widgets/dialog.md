# Widget research: Dialog

Date: 2026-07-29
Status: **researched — K3 entry gate satisfied (Dialog)**
Template: KR 9-section widget template (`docs/COMPONENT_KIT_PLAN.md`, KR phase),
following `widgets/combobox.md` as the exemplar.
Downstream: gates K3's first widget (`Dialog`); also fixes the shared
`presence`/`scrollLock`/`focusTrap` platform-floor seams that Popover, Menu,
Select and Toast inherit.

Sources consulted: HTML `<dialog>` (WHATWG spec: `showModal()`/`show()`/
`close()`/`requestClose()`, top layer, `::backdrop`, `cancel`/`close`/
`beforetoggle`/`toggle` events, `closedby`, `returnValue`,
`<form method="dialog">`), invoker commands (`command="show-modal" |
"close" | "request-close"` + `commandfor`), WAI-ARIA APG *Dialog (Modal)*
and *Alert Dialog* patterns (tiebreaker, W3C document licence — cited, not
copied), Zag.js `dialog` machine + `dialog.connect.ts`, Ark UI Dialog anatomy,
Radix `Dialog` and `AlertDialog` primitives, Base UI Dialog/AlertDialog,
react-aria `Dialog`/`Modal`/`AlertDialog` (**Apache-2.0 — read for spec only,
never copied**), `@stylextras/ui` Dialog notes (native-first, no-React-state
defaults, `/client` opt-in, lazy trigger-only entries), CSS-Tags
`<dialog data-modal>` rung-zero contract. Local: `src/A11y.ts` `DialogSlots` /
`Dialog` pattern (L116–131, catalog L196), `src/Element.ts` capability lattice,
`src/Machine.ts`, `docs/kit-research/behaviors/{focus-trap,scroll-lock,presence,
dismissable-layer}.md`.

Scope decision up front: **one widget, `Dialog`, with a `role` axis
(`"dialog" | "alertdialog"`) and a `modal` boolean** — we do *not* ship Radix's
and Base UI's separate `AlertDialog` primitive. AlertDialog is the same anatomy
and the same native element with three policy bits flipped (no light dismiss,
no Escape dismiss, `aria-describedby` required); a second widget would double
the anatomy, recipe and test surface for a variant. Rejected: separate
`AlertDialog` widget; rejected: separate `Drawer`/`Sheet` widget (that is a
recipe over the same `Dialog` — placement + motion tokens, per §6).

---

## Decision summary (one line per section)

Read this table first; each row is expanded, with sources and rejected
alternatives, in the numbered section it points at.

| § | Decision |
| --- | --- |
| 1 | **Anatomy**: `root` is the **native `<dialog>` element itself** (not a wrapper), giving 4 required + 3 hidden-capable slots (`trigger`, `root`, `title`, `closeTrigger` + `content`, `description`, `footerActions`); `backdrop` is **rejected as a slot** because `::backdrop` is a pseudo-element the platform owns; `portal`/`positioner`/`overlay` rejected (top layer removes the reason they exist); this **extends `A11y.DialogSlots`**, which today declares only `root`/`trigger`/`content`. |
| 2 | **State & machine**: **no `Machine`** — Dialog is the plan's canonical "machine only when states × events > trivial" *negative* example: two states, and the state already lives in the platform (`dialog.open`). Ship a plain `dialog` behavior over one `Atom.Writable<boolean>` plus a `returnValue` atom; snapshot is `{open, returnValue}`. Rejected: porting Zag's `dialog.machine.ts` states (we port its *connect* attribute set and its edge-case list instead). |
| 3 | **Interaction**: `showModal()` supplies Escape-to-dismiss (via `cancel`), focus containment, and outside-inert for free; what remains for our behaviors is **initial-focus policy, focus-restore policy, and `liveAnnounce`** — plus `closedby="closerequest"` for `alertdialog` (no light dismiss) and `closedby="any"` for the non-modal/popover-ish case; `requestClose()` (not `close()`) is the default close path so a `cancel` guard can veto (dirty-form confirm); nested dialogs allowed, LIFO, platform-stacked. |
| 4 | **ARIA**: native `<dialog>` + `showModal()` already maps to `role=dialog` + modal semantics, so we add **only** `aria-labelledby=title-id`, `aria-describedby` (required when `role="alertdialog"`), and `role="alertdialog"` as an explicit override; **no** `aria-modal="true"` (harmful on a native modal `<dialog>` — it duplicates what the top layer already communicates and breaks when the element is non-modal); four new `a11y:*` diagnostics — labelled dialog, `alertdialog` has a description, focus lands inside on open, exactly one `autofocus` candidate. |
| 5 | **Platform floor**: native `<dialog>` is the floor, and it is the **highest floor of any widget in the kit** — top layer, `::backdrop`, focus containment, outside-inert, Escape, focus-restore, `<form method="dialog">` submission and **invoker commands all with zero JS**; JS adds only focus policy, veto-on-close, announcements, scroll lock and lazy content; the `<div role=dialog>` fallback path exists **only** behind a `HTMLDialogElement.prototype.showModal` detection seam and is where `focusTrap`/`hideOutside` are attached. |
| 6 | **Tokens & variants**: consumes seven of eight axes (color, spacing, radius, stroke, typography, elevation, motion) plus **blur on `::backdrop`** — the one widget where the blur axis is load-bearing; Recipe surface is `size: sm\|md\|lg\|full`, `placement: center\|top\|start\|end\|bottom` (this is what makes Drawer a recipe, not a widget), `variant: solid\|subtle`; `role`/`modal`/`open` are **not** variants (data-attributes and machine-free state); exit animation is expressed in tokens as `transition-behavior: allow-discrete` + `@starting-style`, not as a JS duration. |
| 7 | **API**: `open?: Atom.Writable<boolean>` is the whole controlled/uncontrolled story (one code path, no `defaultOpen`/`onOpenChange` triad); adopt Zag's `role`, `closeOnEscape`/`closeOnInteractOutside`, `initialFocusEl`/`finalFocusEl` (renamed `initialFocus`/`restoreFocus`), Radix's `modal`; adopt native `returnValue` as a first-class `Atom.Readonly<string>`; **reject** `portal`, `overlay`/`backdrop` render props, `asChild`, `forceMount`, `onOpenAutoFocus`/`onCloseAutoFocus` callback pairs (replaced by declarative focus options), and any `preventScroll` prop that is not just `scrollLock`'s option. |
| 8 | **Resumability & dormancy**: **the flagship rung-zero demo of the whole kit** — `<button command="show-modal" commandfor="d">` opens a fully focus-trapped, inerted, Escape-dismissable, backdrop-styled, form-submitting modal with **zero JavaScript ever loaded**; snapshot is `{open, returnValue, id}` only; activation binds to the dialog's own `beforetoggle`/`toggle` event (pre-JS-observable), so the dialog is *opened by the platform first and adopted by the runtime second* — the resume proof is "open while dormant → activate → assert still open, no reopen, no flash, focus untouched". |
| 9 | **Port sources**: Zag `dialog.connect.ts` (ARIA/attribute set) and its dismiss/scroll-lock utilities as MIT ports with commit-SHA provenance; Radix `Dialog`/`AlertDialog` **tests** (MIT) and `react-remove-scroll` semantics for `scrollLock`; Base UI dialog test suite (MIT) for the nested/backdrop/exit-animation matrix; react-aria is **spec-only, Apache-2.0, never copied**; APG as tiebreaker; **Zag's `dialog.machine.ts` is deliberately not ported.** |

### Prerequisites K3 must add first

Four gaps, decided here rather than worked around:

1. **`A11y.DialogSlots` is incomplete.** It declares `root`/`trigger`/`content`
   only (`src/A11y.ts` L117–128). K3 extends it to the §1 contract
   (`title`, `closeTrigger` required; `content`, `description`,
   `footerActions` hidden-capable). This is an additive change to a published
   contract and is in scope for prerelease.
2. **`View.Event` has no keyboard or native-dialog events.** It is
   `{Press, Click, Input, Focus, Blur, Hover}`. Dialog needs **`View.Event.Cancel`
   (`cancel`) and `View.Event.Close` (`close`)**, and shares Combobox's
   **`View.Event.Keydown`** request. `View.Event.make("cancel")` is the stopgap.
   Without them the `root` slot cannot state its contract.
3. **No `command`/`commandfor` typing on the JSX host.** Rung zero in §8
   requires authoring invoker attributes; K3 adds them to the intrinsic
   attribute types (ambient, zero runtime — the CSS-Tags pattern).
4. **`A11y.catalog` tier for Dialog stays `"stateful"`** even though §2 removes
   the machine: the tier taxonomy is about *whether the pattern owns state*, not
   about *whether a `Machine` implements it*. Recorded so nobody "fixes" it.

---

## 1. Anatomy

### Per-library parts

| Part | Zag / Ark | Radix | Base UI | react-aria | Native | Ours |
| --- | --- | --- | --- | --- | --- | --- |
| trigger | `trigger` | `Trigger` | `Trigger` | `Button` | `command`+`commandfor` invoker | ✅ `trigger` |
| portal | (framework) | `Portal` | `Portal` | (`ModalOverlay`) | — (top layer) | ⛔ renderer concern |
| backdrop / overlay | `backdrop` | `Overlay` | `Backdrop` | `ModalOverlay` | `::backdrop` | ⛔ pseudo-element |
| positioner | `positioner` | — | — | — | — (top layer centring) | ⛔ |
| dialog element / content | `content` | `Content` | `Popup` | `Dialog` | `<dialog>` | ✅ `root` **is** the `<dialog>` |
| inner scroll body | (custom) | (custom) | (custom) | — | — | ✅ optional `content` |
| title | `title` | `Title` | `Title` | `Heading` | — | ✅ `title` |
| description | `description` | `Description` | `Description` | (`slot="description"`) | — | ✅ optional `description` |
| close button | `closeTrigger` | `Close` | `Close` | `CloseButton` | `command="close"` invoker / `<form method=dialog>` | ✅ `closeTrigger` |
| action row | — | `Action`/`Cancel` (AlertDialog) | `Actions` | — | — | ✅ optional `footerActions` |
| focus guards | — | (internal sentinels) | — | (FocusScope) | — (native containment) | ⛔ unnecessary |

Two structural observations drive the decision. First, **the top layer deletes
three parts**: `portal` exists because React cannot escape overflow/stacking
contexts, `positioner` exists because a portalled overlay must be re-centred,
and focus-guard sentinels exist because JS focus traps need boundary nodes —
`showModal()` removes the cause of all three. Second, **`::backdrop` is a
pseudo-element**, so a backdrop cannot be a slot at all in the native path;
making it one would force every consumer onto the fallback path and is exactly
the kind of framework tax the platform floor exists to avoid.

### Decision — minimal anatomy (4 required + 3 hidden-capable)

```ts
export const DialogSlots = View.Slots.define({
  // required
  trigger:       { capability: Element.Capability.Interactive,
                   allowedEvents: [View.Event.Press] },
  root:          { capability: Element.Capability.Container,   // the <dialog>
                   allowedEvents: [Cancel, Close /* see prerequisite 2 */] },
  title:         { capability: Element.Capability.Base },
  closeTrigger:  { capability: Element.Capability.Interactive,
                   allowedEvents: [View.Event.Press] },
  // optional (hidden-slot compatible)
  content:       { capability: Element.Capability.Container /* scroll body */ },
  description:   { capability: Element.Capability.Base /* required when role=alertdialog */ },
  footerActions: { capability: Element.Capability.Container },
})
```

Narrowest capability per slot is deliberate: `title`/`description` are `Base`
(they must never become press targets — a clickable heading is a bug we can
forbid by type); `trigger`/`closeTrigger` are `Interactive` and **are** real tab
stops here (unlike Combobox's trigger — a dialog's close button must be
reachable); `root` is `Container` rather than a new capability because the
top-layer/modal semantics are attributes and method calls on the element, not a
new interaction contract — **decision: no `Element.Capability.TopLayer`.**

`content` is optional and distinct from `root` for one reason: the scrollable
region needs `tabindex="0"` when it overflows (APG scrollable-content rule) and
`overscroll-behavior: contain`; folding it into `root` puts the scroll container
in the same box as the padding/border, which breaks sticky headers in every
real design. When absent, `root` is the scroll container.

`description` is *conditionally* required: `role="alertdialog"` demands
`aria-describedby` (APG), so the diagnostic in §4 fires when
`role="alertdialog"` and the `description` slot is hidden. **Decision: enforced
as a runtime `a11y:*` diagnostic, not in the type** — the type system cannot see
the runtime `role` value, and inventing a second slot contract per role
contradicts the one-anatomy decision.

Rejected parts and why: `backdrop`/`overlay` (pseudo-element, above);
`portal`/`positioner` (top layer); focus guards (native containment);
Radix's `AlertDialog.Action`/`Cancel` as *slots* (they are consumer buttons
inside `footerActions`; their only special property is being the
initial-focus target, which is §3's `initialFocus` option); a `header` slot
(recipe structure, not anatomy).

---

## 2. State & machine

Zag models dialog as a machine with `open`/`closed` states, ~10 events
(`OPEN`, `CLOSE`, `TOGGLE`, `CONTROLLED.*`) and activities for
dismissable-layer, scroll-lock, aria-hidden-outside and focus trap. Radix uses
a single boolean + `Presence` + `FocusScope` + `DismissableLayer`. Base UI: a
boolean plus transition state. react-aria: `useOverlayTriggerState` (a boolean).

### Decision — **no `Machine`.** This is the "no machine needed" example.

The plan's rule is "machine only when states × events > trivial." Dialog is
2 states × 3 meaningful events, and — decisively — **the state is not ours to
hold**: the platform holds it on `HTMLDialogElement.open`, mutated by
`showModal()`/`close()` and by user Escape without any JS involvement. A
`Machine` here would be a second, lagging copy of authoritative platform state,
and the failure mode (user dismisses with Escape while the machine still says
`Open`) is exactly the desync the machine was supposed to prevent.

So Dialog ships as:

- one `Atom.Writable<boolean>` (`open`) as the *intent* channel,
- a `dialog` **behavior** that (a) reflects intent → `showModal()`/`show()`/
  `requestClose()`, and (b) reflects platform reality → writes the atom back
  from the native `close` and `toggle` events, with a re-entrancy guard so the
  round trip cannot loop,
- `returnValue` as a derived `Atom.Readonly<string>` fed by the `close` event,
- composed behaviors: `press` (trigger/closeTrigger), `scrollLock` (§5),
  `liveAnnounce` (§4), and on the fallback path only, `focusTrap` +
  `hideOutside` + `dismissableLayer`.

**Snapshot state** (see §8): `{ open: Schema.Boolean, returnValue:
Schema.String }`. There is no state tag, no placement, no highlight — this is
the smallest snapshot in the kit and it is the reason Dialog is the resume demo.

**Runtime refs (never snapshotted):** the `<dialog>` handle, previously-focused
element (the platform tracks its own; we track ours only for the
`restoreFocus` override), scroll-lock refcount token, the `cancel`-veto guard
function, announcement debounce timer, fallback-path focus-trap state.

Rejected: porting `dialog.machine.ts` (we take its *edge-case inventory* and
its `connect` attribute set instead — §9); a `presence` Machine for exit
animation (§5 does it in CSS); `CONTROLLED.OPEN/CLOSE` events (same reason as
Combobox — the atom *is* the control channel).

Consequence recorded for K3's other widgets: Popover gets the same treatment
(`popover="auto"` holds the state), while Menu/Select/Combobox keep real
machines. The dividing line is **"does the platform already own the state
machine?"**

---

## 3. Interaction spec

**APG is the tiebreaker for every divergence.** The striking property of this
table is how much of it says "native".

| Interaction | Native `<dialog>` (modal) | Ours adds |
| --- | --- | --- |
| open | `showModal()`, or invoker `command="show-modal"` with **zero JS** | intent atom → method call; `show()` when `modal: false` |
| focus on open | focus moves into the dialog; `autofocus` element wins, else first focusable, else the dialog | **`initialFocus` policy** — decision: honour `autofocus` and do nothing else by default; `initialFocus: "first" \| "container" \| SlotRef` overrides; `alertdialog` defaults to the **least-destructive** action (APG) |
| Tab / Shift+Tab | contained by the top layer + outside inert | nothing (fallback path only: `focusTrap`) |
| click outside | modal: nothing; `closedby="any"` opts into light dismiss | **decision: `closedby` is how `closeOnInteractOutside` is implemented** — `"any"` for `dialog`, `"closerequest"` for `alertdialog`; JS `interactOutside` only on the fallback path |
| Escape | fires `cancel` then closes (close request) | **veto seam**: `preventDefault()` on `cancel` when a consumer guard rejects (dirty-form confirm). `closeOnEscape: false` → `closedby="none"` |
| close button | `command="close"` invoker, or `<form method="dialog">` submit — **zero JS** | `requestClose()` (not `close()`) so the `cancel` guard also runs for programmatic closes |
| focus on close | platform refocuses the previously-focused element | **`restoreFocus` policy** — decision: rely on the platform by default; override to a `SlotRef` or `false`; on the fallback path do it ourselves |
| value out | `dialog.returnValue` from the submitter's `value` | expose as an atom; **decision: adopt the native mechanism rather than inventing an `onClose(data)` callback** |
| nested dialogs | top-layer stack, LIFO, each `::backdrop` composes | nothing — **decision: no layer registry for the native path**; `dismissableLayer` only coordinates the fallback path |
| body scroll | **not** locked by the platform | **`scrollLock` is still required** (§5) |
| announcement | none | `liveAnnounce` for `alertdialog` content and for close confirmation |

So the honest answer to "what remains for our behaviors?" is: **initial-focus
policy, focus-restore policy, close-veto, `liveAnnounce`, and `scrollLock`.**
Everything else on the modal path is platform.

Non-modal (`show()`): no top layer, no `::backdrop`, no inert, no Escape
handling, no focus containment. **Decision: `modal: false` is a supported but
*documented-as-thin* mode that composes `dismissableLayer` +
`anchorPosition` — and if you want that, you probably want `Popover`.** The
docs page says so explicitly, mirroring §5's `<datalist>` note in the Combobox
doc.

`alertdialog`, as a policy triple (not a widget): `closedby="closerequest"`
(no light dismiss), `closeOnEscape` default **false** (APG: an alert dialog
must not be dismissible by Escape when the choice is destructive — decision:
default false for `alertdialog`, true for `dialog`), and `initialFocus` on the
least-destructive action. Radix and Base UI implement exactly this triple in a
separate component; we implement it as defaults keyed off `role`.

---

## 4. ARIA contract

```
trigger        → <button type=button> (or invoker: command="show-modal" commandfor=id)
                 aria-haspopup="dialog" (decision: omit — see below)
root           → <dialog> [role="alertdialog" when role option set]
                 aria-labelledby=title-id
                 aria-describedby=description-id (required when alertdialog)
                 NO aria-modal
title          → <h2> (heading level is a consumer choice; id generated)
description    → <p> id generated
content        → tabindex="0" + aria-label when scrollable (APG scrollable region)
closeTrigger   → <button type=button> aria-label="Close" (required if icon-only)
                 or <form method="dialog"><button value="cancel">
footerActions  → presentational container
```

### Decision — no `aria-modal="true"`

A modal `<dialog>` opened with `showModal()` already communicates modality
through the top layer and the inert-outside behavior; adding `aria-modal` is
redundant at best, and actively harmful in the two known cases (it hides
content from some screen readers when the element is *not* actually modal, and
it interacts badly with nested dialogs). Radix sets `aria-modal` because it
renders a `<div role="dialog">`. **Decision: `aria-modal` is set only on the
`<div role=dialog>` fallback path (§5), never on a native modal `<dialog>`.**
This is the clearest single instance of "the platform floor changes the ARIA
you should emit."

### Decision — omit `aria-haspopup` on the trigger

`aria-haspopup="dialog"` is inconsistently supported and APG's dialog examples
do not use it; the accessible name of the button should say what it opens.
Rejected as noise.

### Decision — labelling is by slot, not by prop

`aria-labelledby` always points at the `title` slot's generated id; there is no
`aria-label` escape hatch on `root`, because a dialog without a visible title
is a design bug we can prevent structurally (`title` is a **required** slot,
§1). Consumers who need a visually hidden title use the visually-hidden
utility on the `title` slot — the same trick, but it keeps the accessible name
and the visual name from drifting.

`A11y.pattern("dialog", DialogSlots)` must validate: all required slots
present; `trigger`/`closeTrigger` declare `Press`; `root` is a `Container` and
declares `Cancel`/`Close`; `title` is `Base`. Beyond the generic validator, add
dialog-specific dev-only runtime diagnostics: (1) `root` has a resolvable
`aria-labelledby` target; (2) `role="alertdialog"` implies a rendered
`description`; (3) after open, `document.activeElement` is inside `root`;
(4) at most one `autofocus` candidate inside `root`. **Decision: these four
become `a11y:*` diagnostic codes and each is also a Chromium keyboard test.**

---

## 5. Platform-native floor

This is the highest native floor in the kit. Enumerated honestly:

| Piece | Native primitive | Coverage | Remains for JS |
| --- | --- | --- | --- |
| layering / stacking | top layer via `showModal()` | above all `z-index`, escapes `overflow`/`transform`/`contain` ancestors | nothing |
| backdrop | `::backdrop` | full-viewport, animatable, blur-able, stacks per dialog | nothing (it is CSS) |
| focus containment | modal `<dialog>` | Tab/Shift+Tab cannot leave; AT virtual cursor constrained | fallback path only |
| outside inert | modal `<dialog>` | outside content non-interactive + hidden from AT | fallback path only |
| Escape dismiss | close request → `cancel` → `close` | full | **veto** via `preventDefault()` |
| focus restore | previously-focused element refocused on close | full | **policy override** only |
| open/close with zero JS | invoker `command="show-modal" \| "close" \| "request-close"` + `commandfor` | full open/close cycle, no script | nothing |
| close from inside, zero JS | `<form method="dialog">` | closes + sets `returnValue` from the submitter | nothing |
| light dismiss | `closedby="any"` | outside-click dismiss without a layer library | nothing where supported |
| exit animation | `transition-behavior: allow-discrete` on `display`/`overlay` + `@starting-style` | enter **and** exit animation in pure CSS | nothing (see below) |
| body scroll lock | — | **not covered** | `scrollLock` behavior |
| announcements | — | not covered | `liveAnnounce` |
| lazy content | — | not covered | fragment/lazy entry (M11b) |

**Decisions.**

1. **Native `<dialog>` + `showModal()` is the default and only styled path.**
   The `<div role="dialog">` implementation exists exclusively behind a
   `typeof HTMLDialogElement !== "undefined" && "showModal" in
   HTMLDialogElement.prototype` seam and is where `focusTrap`, `hideOutside`,
   `dismissableLayer` and `aria-modal` attach. Baseline is wide enough
   (`<dialog>` in all engines since early 2022) that the fallback is a
   compatibility artifact, not a co-equal branch — **decision: it is a separate
   opt-in module, not shipped in the default entry**, so the common case pays
   nothing for it.
2. **`closedby` is the implementation of `closeOnInteractOutside`**, with the
   feature-detection seam in the `dismissableLayer` behavior (`"closedBy" in
   HTMLDialogElement.prototype`). Where unsupported and light dismiss is
   requested, `interactOutside` fills in. Newer attribute, narrower support
   than `<dialog>` itself — recorded so the seam is not forgotten.
3. **Exit animation is CSS, not `presence`.** `overlay` and `display` are
   discretely-animatable with `transition-behavior: allow-discrete`, and
   `@starting-style` gives the enter side; this keeps the element in the top
   layer for the duration of the exit transition, which is precisely what
   Radix's `Presence` machine reimplements in JS. **Decision: Dialog does
   **not** consume the `presence` behavior on the native path.** `presence`
   remains for JS-unmounted lazy content and for the fallback path, and its
   research doc's "prefer not to snapshot mid-exit" note stands. This is the
   second-largest deletion this doc makes (after the machine).
4. **`scrollLock` is still needed.** The top layer does not stop the document
   behind from scrolling (wheel/touch over the backdrop scrolls the page in
   current engines). **Decision: `scrollLock` attaches by default when
   `modal: true`, refcounted for nested dialogs, with `scrollLock: false` as an
   opt-out** — and the reason is written into the behavior's platform-floor note
   so it is not "optimized away" by a later agent who assumes the top layer
   covers it.
5. **Rung-zero contract (CSS-Tags):** `<dialog data-affe-dialog data-modal>`
   plus an invoker button is a **complete, working modal with no JavaScript at
   all** — open, focus-trapped, inert background, styled backdrop, Escape,
   form submission, animated enter/exit. The three host forms
   (`<dialog data-modal>`, `.dialog`, unregistered tag) are styled purely from
   the foundation stylesheet, and all values go through `light-dark()` so a
   scriptless page follows OS theme. **Decision: this markup is the kit's
   headline rung-zero example in the docs site (K4).**
6. **`@stylextras/ui` alignment, adopted:** native-first with no framework
   state by default, `/client` for the enhanced entry, and lazy content loaded
   on trigger focus/hover. Their "no React state" default *is* our §2
   no-machine decision arrived at independently; their lazy trigger-only entry
   *is* our dormant activation boundary (§8). Recorded as convergence, not as
   a port.

---

## 6. Tokens & variants

Token axes consumed: **color** (surface, border, `bgSubtle`, plus a backdrop
scrim colour with alpha — dark surfaces via translucency per the token rules),
**spacing** (padding, gap between title/description/actions), **radius**
(dialog corners; `0` at `size: full`), **stroke** (border, focus ring),
**typography** (title scale, description), **elevation** (dialog shadow),
**motion** (enter/exit via `@starting-style` + `allow-discrete`, honouring
`prefers-reduced-motion` by collapsing to opacity-only), and — uniquely —
**blur**, on `::backdrop` (`backdrop-filter`). **Decision: Dialog is the
reference consumer for the blur axis**, which no other widget currently
justifies; if blur cannot be expressed cleanly here it should be dropped from
the eight axes.

Variant surfaces surveyed: Zag/Ark and Radix expose none (headless); Base UI
none; react-aria none; `@stylextras/ui` exposes `size`/`variant`/`sx`; shadcn
bakes size + a `DialogContent`/`AlertDialogContent` split into copied source
(the fork pressure), and its Drawer is a *separate vendored component* over
vaul.

**Decision — Recipe surface:**

```ts
variants: {
  size:      { sm | md | lg | full },       // max-inline-size; `full` = fullscreen, radius 0
  placement: { center | top | start | end | bottom },  // `start|end|bottom` ⇒ Drawer
  variant:   { solid | subtle },
  state:     (derived, not authored)        // [open], [data-role=alertdialog], [data-scrolled]
}
defaults: { size: "md", placement: "center", variant: "solid" }
compound: [{ placement: "end", size: "full", style: {/* full-height sheet */} }]
```

Anatomy-bound recipe slots: `root`, `backdrop` (**recipe-only, targeting
`::backdrop`** — the asymmetry §1 predicts: styling structure is finer than
behavioral structure), `title`, `description`, `content`, `footerActions`,
`closeTrigger`.

**Decision: Drawer/Sheet is `placement` + motion tokens, not a widget.** This
is the single largest surface reduction in the doc — Radix+vaul, shadcn, and
most kits ship a second component for it, and the difference is genuinely an
inset and a transform origin.

Rejected: `intent`/tone variants (a dialog is not a button; destructive
emphasis belongs on the action buttons inside `footerActions`); `blurBackdrop`
as a variant (it is the blur token axis); `centered` boolean (subsumed by
`placement`); any `overlay` opacity knob (colour axis with alpha).

---

## 7. API surface comparison

| Concern | Zag/Ark | Radix | Base UI | react-aria | Native | **Ours** |
| --- | --- | --- | --- | --- | --- | --- |
| open state | `open`/`defaultOpen`/`onOpenChange` | same | same | `useOverlayTriggerState` | `open` attr / methods | `open?: Atom.Writable<boolean>` |
| modality | `modal` | `modal` | `modal` | `Modal` vs `Popover` | `showModal()` vs `show()` | `modal?: boolean` (default `true`) |
| role variant | `role: dialog\|alertdialog` | separate `AlertDialog` | separate `AlertDialog` | separate `AlertDialog` | `role="alertdialog"` | **adopt Zag's `role` option**; one widget |
| Escape | `closeOnEscape` | `onEscapeKeyDown` | `onEscapeKeyDown` | `isKeyboardDismissDisabled` | `closedby`, `cancel` | `closeOnEscape?: boolean` (default `role==="dialog"`) |
| outside press | `closeOnInteractOutside` | `onPointerDownOutside` | `onOpenChangeComplete` | `isDismissable` | `closedby="any"` | `closeOnInteractOutside?: boolean` → `closedby` |
| veto a close | (guard in userland) | `preventDefault()` in callback | same | same | `cancel` event | `beforeClose?: Effect<boolean>` → `cancel.preventDefault()` |
| initial focus | `initialFocusEl` | `onOpenAutoFocus` | `initialFocus` | `autoFocus` | `autofocus` attr | `initialFocus?: "auto"\|"first"\|"container"\|SlotRef` (default `"auto"`) |
| restore focus | `finalFocusEl` | `onCloseAutoFocus` | `finalFocus` | (FocusScope restore) | automatic | `restoreFocus?: boolean \| SlotRef` (default `true` = platform) |
| scroll lock | `preventScroll` | `Overlay` + RemoveScroll | internal | `usePreventScroll` | — | `scrollLock?: boolean` (default `modal`) |
| exit animation | data-state + CSS | `Presence`/`forceMount` | transition props | — | `allow-discrete` | **CSS only** (§5); no `forceMount` |
| return value | — | — | — | — | `returnValue` | `returnValue: Atom.Readonly<string>` — **adopt the native mechanism** |
| nested | layer stack | layer stack | layer stack | overlay stack | top-layer stack | platform (no registry) |
| portal | — | `Portal` container prop | `Portal` | `UNSAFE_portalContainer` | — | **rejected** |
| lazy content | — | `forceMount` inverse | — | — | — | fragment/lazy entry (M11b), activation-bound |
| callbacks | `onOpenChange` | `onOpenChange`, 4 focus/dismiss callbacks | similar | similar | events | **no callbacks** — atoms + `Component.action`; only `beforeClose` (a guard, not a notification) |
| form integration | — | — | — | — | `<form method="dialog">` | **first-class**: the close button may be a submitter |

**Decisions.** Controlled/uncontrolled collapses to **one code path** (the
`open` atom; `Component.state` when omitted) — no `defaultOpen`/`onOpenChange`
triad, same thesis as Combobox §7. Radix's four focus/dismiss callbacks
(`onOpenAutoFocus`, `onCloseAutoFocus`, `onEscapeKeyDown`,
`onPointerDownOutside`) collapse into two **declarative** options
(`initialFocus`, `restoreFocus`) plus one **guard** (`beforeClose`) — the
callbacks exist in Radix because imperative focus fixing is the only escape
hatch a JS focus trap can offer; with the native element there is nothing to
fix. Rejected outright: `portal`, `forceMount`, `asChild` (slot remapping),
overlay/backdrop render props, and a bespoke `preventScroll` prop distinct from
`scrollLock`'s option.

Composition points we publish: the headless component + the `DialogSlots`
contract; the `dialog` behavior alone (attachable to any `<dialog>` handle —
this is the "I already have markup" story); `scrollLock`/`liveAnnounce`
separately; the recipe data (`mergeRecipes`-patchable); and the fallback module
as an explicit import. Hostile-customization test list, derived from what
shadcn users fork: replace the close button with an icon-only variant, add a
sticky header/footer inside `content`, convert to a bottom sheet, nest a
confirm `alertdialog` inside a form dialog, and swap the backdrop for a blurred
one — all from outside, over plain imports, no fork.

---

## 8. Resumability & dormancy

**This is the flagship rung-zero demo of the kit.** The dormant page ships:

```html
<button command="show-modal" commandfor="confirm">Delete…</button>

<dialog id="confirm" data-affe-dialog data-modal closedby="closerequest">
  <h2 id="confirm-t">Delete project?</h2>
  <p id="confirm-d">This cannot be undone.</p>
  <form method="dialog">
    <button value="cancel" autofocus>Cancel</button>
    <button value="confirm" formmethod="post" formaction="/delete">Delete</button>
  </form>
</dialog>
```

Before a single byte of JavaScript loads, that markup **opens in the top layer,
traps focus, inerts and AT-hides the background, styles and animates its
backdrop, dismisses on Escape (but not on outside click, because
`alertdialog`), focuses the least-destructive action, closes with a
`returnValue`, restores focus to the trigger, and performs a real form POST.**
No other widget in the kit reaches this far at rung zero, which is why Dialog —
not Combobox — is the demo that makes the "four rungs, additive, no markup
rewrite" claim concrete.

**What snapshots:** `{ open: boolean, returnValue: string }`, plus the dialog's
stable id for nested-stack ordering. That is the entire snapshot. Held in
`Component.state`, so `Resume.snapshotState` round-trips it with zero new
resume-kernel code. **Decision: `open` is snapshotted, and on activation it is
read *from the DOM* (`dialog.open`) and reconciled against the snapshot, DOM
winning** — because the user may have opened or Escape-dismissed the dialog
while dormant, and the platform is the authority (§2).

**What does not snapshot:** the `<dialog>` handle, previously-focused element,
scroll-lock token, `beforeClose` guard closure (a `Portable` captures/bind
concern if it is a function prop; Schema-configured options are portable by
construction), announcement timers, exit-transition state.

**Activation trigger:** the dialog's own **`beforetoggle`/`toggle` event** —
which the platform fires for `<dialog>` regardless of who opened it — plus
first `press` on `trigger`/`closeTrigger`. Both are pre-JS-observable through
the resume event recorder in `src/resume-event.ts`. **Decision: the dialog is
opened by the platform first and adopted by the runtime second.** Activation
never calls `showModal()` on an already-open dialog (that would be a no-op at
best and a focus/animation reset at worst) and never closes-and-reopens to
"sync" — it attaches listeners, refcounts the scroll lock, and writes the atom
from observed reality.

Two K3 resume proofs:

1. **Open-while-dormant, then activate**: assert the dialog is still open, the
   `open` atom reads `true`, `document.activeElement` is unchanged (no focus
   steal), no `::backdrop` re-animation, and no flash of the closed state.
2. **Escape-while-dormant, then activate**: the platform closed it; assert the
   `open` atom activates to `false` with the recorded `returnValue`
   (`""` for a cancel), and that focus is on the trigger — proving the
   DOM-wins reconciliation rather than a stale snapshot reopening the dialog.

Third (scroll-lock specific, easy to get wrong): open while dormant → activate
→ assert the body scroll lock is applied *on activation* and released on close,
with no double-application if the dialog was already open.

---

## 9. Port sources

| From | Artifact | License | Use |
| --- | --- | --- | --- |
| WHATWG HTML | `<dialog>`, top layer, `closedby`, invoker commands, `cancel`/`close`/`toggle` | spec | **the primary "source"** — the floor in §5 is a spec read, not a port |
| Zag.js | `packages/machines/dialog/src/dialog.connect.ts` | MIT | **primary port** — id conventions and the exact attribute/ARIA set (§4), minus `aria-modal` |
| Zag.js | `dialog/src/dialog.machine.ts` | MIT | **deliberately NOT ported** (§2); read for its edge-case inventory only |
| Zag.js | `utils/dismissable`, `interact-outside`, `aria-hidden`, `remove-scroll` | MIT | already scheduled by the `dismissableLayer`/`interactOutside`/`hideOutside`/`scrollLock` behavior docs; Dialog consumes, does not re-port |
| Radix | `packages/react/dialog/src/**/*.test.tsx`, `alert-dialog` tests | MIT | **test suites to port** — labelling, required description on alertdialog, nested dialogs, focus restore, close-button semantics |
| Radix | `react-remove-scroll` semantics (via the `scrollLock` doc) | MIT | scrollbar-compensation policy (§5.4) |
| Base UI | dialog/alert-dialog test suites | MIT | **test suites to port** — nested open/close ordering, backdrop click policy, exit-animation-then-unmount, `beforeClose`-style veto |
| react-aria | `@react-aria/dialog`, `@react-aria/overlays`, `AlertDialog` | Apache-2.0 | **spec only — read for behavior, never copied source, never copied tests** |
| WAI-ARIA APG | Dialog (Modal) + Alert Dialog patterns, scrollable-region rule | W3C Document Licence | tiebreaker citations (§3, §4); keyboard conformance checklist |
| `@stylextras/ui` | Dialog notes: native-first, no framework state, `/client` opt-in, lazy entries | (per package) | platform-floor + activation-boundary confirmation (§5.6); no code |
| CSS-Tags | `<dialog data-modal>` host + `@layer` order | MIT (same author) | the rung-zero stylesheet contract (§5.5) |
| shadcn/ui | `dialog`, `alert-dialog`, `drawer` (vaul) recipes | MIT | **customization-pressure inventory only** → hostile-customization list (§7). Not a behavior source. |

Provenance rules for the port: every ported file carries a header naming the
upstream repo, path, commit SHA, and licence; `NOTICE`/`THIRD_PARTY` entries
for Zag (MIT), Radix (MIT), Base UI (MIT); react-aria's Apache-2.0 material is
**read-for-spec only** and must not appear as copied source or copied tests —
recorded explicitly so a later agent does not paste it in.

Gates this widget must pass: type tests for the extended `DialogSlots` contract
and for slot remapping/hidden slots; the four `a11y:*` dialog diagnostics;
exact-once disposal + no-op double-dispose (scroll-lock refcount included);
Chromium keyboard test covering the full §3 table plus the `alertdialog`
policy triple and nested LIFO dismissal; the three dormant-resume proofs in §8;
a **zero-JS test** that asserts the §8 markup opens, dismisses and submits with
scripting disabled (new gate class this widget introduces); the
hostile-customization suite from §7; and the `@stylextras/ui`-derived matrix —
reduced motion (exit animation collapses), forced colors (`::backdrop` and
border remain visible), RTL, 200% zoom, narrow viewport (fullscreen `size`).
