# Widget research: Select

Date: 2026-07-29
Status: **researched — K3 entry gate satisfied (Select)**
Template: KR 9-section widget template (`docs/COMPONENT_KIT_PLAN.md`, KR phase),
following `widgets/combobox.md` as the exemplar.
Downstream: gates K3's `Select`. Also settles the **native-first inversion** the
plan mandates ("styled native `<select>` first … the custom-rendered variant is
an explicit opt-in, exactly inverse to Radix-style libraries") — Combobox §5
explicitly deferred that decision to this document.

Sources consulted: native `<select>`/`<option>`/`<optgroup>` (HTML spec: form
participation, constraint validation, autofill, mobile native pickers,
`size`/`multiple`, `change`/`input` events) plus the Chromium
**customizable-select** work (`appearance: base-select`, `<button>` +
`<selectedcontent>` inside `<select>`, `::picker(select)`, `::picker-icon`,
`::checkmark`, rich content in `<option>`, picker in the top layer with
`popover`-style light dismiss, `@starting-style` + `transition-behavior:
allow-discrete` for animation); WAI-ARIA APG **Listbox** and *Select-Only
Combobox* patterns (tiebreaker, W3C document licence — cited, not copied);
Zag.js `select` machine + `select.connect.ts` + `select.dom.ts`; Ark UI Select
anatomy; Radix `Select`; Base UI `Select`; react-aria `Select`/`ListBox`
(**Apache-2.0 — read for spec only, never copied source or copied tests**);
`@stylextras/ui` native-first select notes; CSS-Tags rung-zero contract. Local:
`src/A11y.ts` (**has no Select/Listbox anatomy yet** — see Prerequisites),
`src/Element.ts` capability lattice, `src/Machine.ts`,
`docs/kit-research/behaviors/{typeahead,collection,list-navigation,roving-tabindex,selection-model,form-control,dismissable-layer,anchor-position,live-announce}.md`.

Scope decision up front: **one widget, `Select`, with a `render:
"native" | "custom"` axis and a `multiple` boolean** — not two widgets and not
a separate `Listbox` widget. A standalone `Listbox` (an always-expanded,
in-flow selection list) is a real APG pattern but it is the `custom` Select's
`listbox`+`options` subtree with the trigger/popup removed; ship it in K4 as a
composition of the same behaviors, not now. Rejected: separate
`NativeSelect`/`Select` widgets (that is the split this document's whole thesis
removes — it would let a consumer's choice of styling fidelity change their
import, their props, and their a11y contract); rejected: `Combobox` absorbing
select-only mode (a select has no text input, no filter, uses typeahead not
filtering, and has a completely different form story — §3/§5).

---

## Decision summary (one line per section)

Read this table first; each row is expanded, with sources and rejected
alternatives, in the numbered section it points at.

| § | Decision |
| --- | --- |
| 0 | **The inversion**: `Select` defaults to `render: "native"` — a real `<select>` styled with `appearance: base-select` where supported, degrading to native chrome elsewhere — and `render: "custom"` (the Radix-class `div`+`role=listbox` build) is an **explicit, per-instance opt-in**. Both are the *same component*, same props, same value atom, same slot names; only the emitted markup and the behavior set differ. Rejected: custom-by-default (Radix/Base UI/Zag/react-aria all do this and pay for it in form participation, autofill, mobile pickers, and ~2kB of dismissal/positioning JS per page); rejected: two separate widgets. |
| 1 | **Anatomy** — one contract covering both forms: 5 required + 4 hidden-capable slots (`root`, `label`, `trigger`, `valueText`, `options` + `content`, `group`, `clearTrigger`, `hiddenInput`). In `native`, `trigger` **is** the `<select>` element, `valueText` is `<selectedcontent>`, `content` is `::picker(select)` (a pseudo-element, so the slot is hidden), and `options` are real `<option>`s; in `custom`, `trigger` is a `<button>`, `content` is the positioned popover, `options` are `role=option` divs, and `hiddenInput` becomes required. Rejected: `positioner`, `portal`, `arrow`, `backdrop`, `indicator`/`itemIndicator`, `itemText` (recipe slots or platform pseudo-elements, per §6). |
| 2 | **State & machine**: a real `Machine` for `custom` only — Zag's 3 states collapsed to `Idle`/`Open` **plus** Zag's `focused` retained as `Focused` (it carries the closed-but-typeahead-active behavior), snapshot = `{ value: string[], highlightedValue: string \| null, currentPlacement?, state tag }`; **`native` uses no machine at all** — the platform owns open/highlight state, so it is a plain behavior over one `Atom.Writable<ReadonlyArray<string>>`. Same divergence from Zag as Combobox: keys in the snapshot, item objects re-derived; `selectedItems`/`highlightedItem`/DOM handles/typeahead buffer + timer are runtime refs. Dropped: `CONTROLLED.*`, `SELECTED_ITEMS.SYNC`. |
| 3 | **Interaction**: full keyboard map where — unlike Combobox — **`typeahead` IS used** (it is the T4 `typeahead` behavior's flagship customer, ~500ms Zag buffer/reset semantics, match-forward-then-wrap), `Home`/`End` are **first/last item** (no caret to compete with, so the Combobox APG divergence does *not* apply here), closed-state `ArrowUp`/`ArrowDown` **select the adjacent value without opening** on desktop (APG select-only combobox + native parity) behind `selectOnArrowWhenClosed` (default true, off for `multiple`), `Space` toggles in `multiple` and opens when closed, `Enter` selects+closes and does **not** submit while open; in `native` **every one of these rows is free** and our keyboard tests assert we did not break them. |
| 4 | **ARIA**: `native` contributes **zero ARIA** (a `<select>` is already `role=combobox`+`listbox` to AT and `appearance: base-select` preserves it) — the biggest single argument for the inversion; `custom` uses `role=combobox` on the trigger (APG *select-only combobox*, **not** `role=button aria-haspopup=listbox`, which Radix/Zag still emit and which reads worse in NVDA/JAWS) + `aria-activedescendant` virtual focus, so exactly one tab stop and the `rovingTabindex` behavior is **not** used; four new `a11y:*` diagnostics — no ARIA overrides on a `native` render, activedescendant target exists, `aria-multiselectable` iff `multiple`, exactly one tab stop. |
| 5 | **Platform floor**: the floor **is the widget** — `<select>` + `appearance: base-select` gives trigger, popup in the top layer, light dismiss, positioning, full keyboard map, typeahead, form submission, constraint validation, autofill, and mobile native pickers with **zero JS**; the feature-detection seam is a single `CSS.supports("appearance", "base-select")` **style-only** query (no JS branch, no fallback bundle: unsupported engines get native chrome, which is *correct*, not degraded); `custom` exists only for the two things `base-select` cannot do (arbitrary interactive content in the popup; multi-select chips/virtualized 10k lists) and rides `popover="auto"` + CSS anchor positioning above that, exactly like Combobox. |
| 6 | **Tokens & variants**: consumes all eight axes; **`base-select` is styled from the same recipe** by mapping our anatomy slots onto `::picker(select)`, `::picker-icon`, `::checkmark`, `option:checked` — one stylesheet, two renderers, which is what makes the inversion cheap; Recipe surface `size: sm\|md\|lg`, `variant: outline\|subtle\|ghost` (identical to Combobox — deliberate: they must be visually interchangeable), plus recipe-only `item`/`itemIndicator`/`groupLabel`; `render`/`multiple`/`invalid`/`open` are data-attributes, never variants. |
| 7 | **API**: single prop surface across both renderers — `value?: Atom.Writable<ReadonlyArray<string>>`, `open?: Atom.Writable<boolean>` (ignored, with a dev diagnostic, when `render:"native"` — the platform owns it), `items: Atom.Readonly<ReadonlyArray<T>>` + `itemToValue`/`itemToLabel`, `multiple`, `name`, `placeholder`, `render`; no `defaultX`/`onXChange` triad, no callbacks; adopt Zag's `highlightedValue`/`closeOnSelect`/`deselectable` and Radix's `position` **rejected**; virtualization deferred to K4; `asChild` rejected (slot remapping). |
| 8 | **Resumability**: `native` Select is **the kit's dormancy flagship and needs no resume at all** — it selects, keyboards, typeaheads and submits a real form POST before a byte of JS, so its "activation" is a no-op unless a consumer attaches reactive behavior; `custom` is the `formControl` hidden-input-projection flagship: dormant markup ships `popover="auto"` + a real `<select>` (visually hidden, not `display:none`) as the projection, so a dormant custom select **submits**, and the two K3 proofs are (a) submit-while-dormant with no JS, (b) open+highlight-while-dormant then activate restores `Open` + `aria-activedescendant` with no closed-state flash. |
| 9 | **Port sources**: Zag `select.machine.ts`/`.connect.ts`/`.dom.ts` (MIT) as the primary port for `custom`, Zag's typeahead utility as the `typeahead` behavior's source, Base UI `select/**/*.test.tsx` (MIT) as the ported test suite, WPT + Chromium `customizable-select` web tests as the conformance source for `native`; react-aria `Select`/`ListBox`/`useTypeSelect` are **Apache-2.0, read-for-spec only — never copied source, never copied tests**; APG cited as tiebreaker; shadcn's Radix-Select recipe used only as customization-pressure inventory. |

### Prerequisites K3 must add first

Four gaps, decided here rather than worked around:

1. **`View.Event.Keydown`** — same prerequisite Combobox §Prerequisites raised
   and still unmet (`src/View.ts` L60–68 has only
   `{Press, Click, Input, Focus, Blur, Hover}`). Select additionally wants
   **`View.Event.Change`** (`makeEvent("change")`): the `native` renderer's
   entire reactive surface is the `<select>`'s `change` event, and modelling it
   as `Input` would be a lie. **Decision: add both; `View.Event.make("change")`
   is the stopgap.**
2. **`A11y.SelectSlots` + `A11y.pattern("select", …)` do not exist** —
   `src/A11y.ts` ships Dialog/Tooltip/Popover/Tabs/Slider/Calendar/DragAndDrop
   only. **Decision: add `SelectSlots` per §1 in K3** (Dialog's doc likewise
   extends its existing entry; Select creates a new one).
3. **Optional slots use the hidden-slot mechanism**, not a new `optional`
   metadata flag — identical to Combobox's ruling, and here it is load-bearing
   for a second reason: `content`/`valueText` are *conditionally* hidden by
   **renderer**, which is exactly what `View.hidden` expresses.
4. **`typeahead` behavior must exist before Select** (T4, currently no seed).
   Select is its first and primary customer; its research doc
   (`behaviors/typeahead.md`) is already written but the behavior is not built.

---

## 0. The inversion (the decision this document exists to make)

The plan states the policy; nobody has yet decided what it *means* for a
component's API. Deciding it here:

| Option | Consequence |
| --- | --- |
| Custom-by-default, native as an escape hatch (**Radix, Base UI, Zag/Ark, react-aria — unanimous**) | Every consumer pays form-projection, dismissal, positioning, typeahead, live-region and mobile-picker cost to change a border radius. |
| Two widgets (`NativeSelect` + `Select`) | Styling fidelity becomes an import decision; migrating between them rewrites props, tests, and the a11y contract. This is `@stylextras/ui`'s shape and it leaks. |
| **One widget, `render: "native"` default, `render: "custom"` opt-in** | Chosen. |

**Decision.** `Select` is one component whose `render` axis selects the
emitted markup. `render: "native"` is the default. The prop surface (§7), the
slot names (§1), the value atom, the recipe (§6), and the a11y guarantees are
identical across both; what differs is which behaviors attach (§2) and which
slots are hidden (§1).

Why this is safe now and was not in 2020: `appearance: base-select` makes a
real `<select>` fully styleable — including the picker, the selected-value
display, per-option rich content, and check marks — so the historical reason
to abandon the native element (*"you cannot style `<option>`"*) is gone on
Chromium and is a *progressive-enhancement* gap, not a bug, elsewhere.

Why `custom` still ships: two cases `base-select` genuinely cannot serve —
(a) interactive content inside the popup (nested inputs, buttons, sticky search
headers), which the customizable-select content model forbids; (b) very large
or virtualized collections and multi-select chip UIs. **Decision: those two
bullets are the documented, and only, justification for `render: "custom"`, and
the docs page says so — "you probably do not need `custom`" is the same
rhetorical move Combobox §5 makes for `<datalist>`, pointed the other way.**

Escalation is one prop, and the diagnostics tell you when you have escalated
for no reason: **decision — a dev-only `select:unnecessary-custom` diagnostic
fires when `render:"custom"` is used with no interactive popup content and
fewer than 200 options.**

---

## 1. Anatomy

### Per-library parts

| Part | Zag / Ark | Radix | Base UI | react-aria | Native `base-select` | Ours |
| --- | --- | --- | --- | --- | --- | --- |
| root | `root` | `Root` | `Root` | `Select` | `<select>` (is also trigger) | ✅ `root` |
| label | `label` | (Field) | (Field label) | `Label` | `<label for>` | ✅ `label` |
| control wrapper | `control` | — | — | — | — | ⛔ merged into `trigger` |
| trigger | `trigger` | `Trigger` | `Trigger` | `Button` | `<select>` / its child `<button>` | ✅ `trigger` |
| selected-value text | `valueText` | `Value` | `Value` | `SelectValue` | `<selectedcontent>` | ✅ `valueText` |
| open indicator icon | `indicator` | `Icon` | `Icon` | (custom) | `::picker-icon` | ⛔ recipe/pseudo |
| portal | (framework) | `Portal` | `Portal` | (Popover) | (top layer, free) | ⛔ renderer concern |
| positioner | `positioner` | — | `Positioner` | — | (free) | ⛔ merged into `content` |
| content / popup | `content` | `Content` | `Popup` | `Popover` | `::picker(select)` | ✅ `content` (hidden in `native`) |
| viewport / scroll buttons | — | `Viewport`, `ScrollUp/DownButton` | `ScrollUpArrow`… | — | (free) | ⛔ rejected (see below) |
| list | `list` | (Viewport) | `List` | `ListBox` | (the picker itself) | ⛔ merged into `content` |
| item | `item` | `Item` | `Item` | `ListBoxItem` | `<option>` | ✅ `options` (Collection) |
| item text | `itemText` | `ItemText` | `Value` | `Text` | (option content) | ⛔ recipe slot |
| item indicator | `itemIndicator` | `ItemIndicator` | `ItemIndicator` | — | `::checkmark` | ⛔ recipe/pseudo |
| group + label | `itemGroup`/`itemGroupLabel` | `Group`/`Label` | `Group`/`GroupLabel` | `Section`/`Header` | `<optgroup label>` | ✅ optional `group` |
| separator | — | `Separator` | `Separator` | `Separator` | `<hr>` (allowed!) | ⛔ decoration |
| arrow | — | `Arrow` | `Arrow` | — | — | ⛔ decoration |
| clear button | `clearTrigger` | — | — | — | (empty `<option>`) | ✅ optional `clearTrigger` |
| hidden native select | `hiddenSelect` | `BubbleSelect` | (form) | `HiddenSelect` | (is native) | ✅ optional `hiddenInput` |

### Decision — one contract, 5 required + 4 hidden-capable

```ts
export const SelectSlots = View.Slots.define({
  // required in both renderers
  root:         { capability: Element.Capability.Container },
  label:        { capability: Element.Capability.Base },
  trigger:      { capability: Element.Capability.Focusable,
                  allowedEvents: [View.Event.Press, View.Event.Focus, View.Event.Blur,
                                  Keydown, Change /* see Prerequisites */] },
  valueText:    { capability: Element.Capability.Base },
  options:      { capability: Element.Capability.Collection },
  // hidden-capable (by renderer or by feature)
  content:      { capability: Element.Capability.Container /* hidden in native */ },
  group:        { capability: Element.Capability.Base },
  clearTrigger: { capability: Element.Capability.Interactive,
                  allowedEvents: [View.Event.Press] },
  hiddenInput:  { capability: Element.Capability.Focusable /* required in custom */ },
})
```

Renderer projection — the part no source library has, because none of them
treat native as a first-class render target:

| Slot | `render: "native"` | `render: "custom"` |
| --- | --- | --- |
| `root` | wrapper `<div data-affe-select>` | same |
| `trigger` | the `<select>` itself (or, under `base-select`, its child `<button>`) | `<button type=button role=combobox>` |
| `valueText` | `<selectedcontent>` | `<span>` bound to the value atom |
| `content` | `::picker(select)` — a **pseudo-element**, so the slot is `View.hidden` | the positioned `popover="auto"` layer |
| `options` | real `<option>` / `<optgroup>` | `role=option` elements, `collection` behavior |
| `hiddenInput` | `View.hidden` (the trigger *is* the form control) | **required** — the visually-hidden real `<select name>` projection (§8) |

Capability notes: `trigger` is `Focusable` (unlike Combobox's `Interactive`
trigger) because here it **is** the widget's single tab stop; `label`/
`valueText`/`group` are `Base` so they can never become press targets;
`options` is `Element.Collection<Interactive>`; `hiddenInput` is `Focusable`
rather than `Base` because a real `<select>` participating in constraint
validation must be focusable for the browser to report validity on it.

Rejected parts and why: `positioner`/`portal` (top layer + anchor positioning
remove the reason they exist — same ruling as Dialog §1); `list` as distinct
from `content` (Combobox keeps them apart because `content` may hold non-list
chrome; a Select popup is *only* the list, and in `native` there is literally
one pseudo-element — collapsing is correct here and the asymmetry with Combobox
is deliberate); **`Viewport` + `ScrollUpButton`/`ScrollDownButton` rejected** —
Radix's scroll buttons exist to emulate the *native macOS* select's scrolling
popup, which is precisely the thing we get for free by not abandoning
`<select>`; `indicator`/`itemIndicator`/`itemText` are recipe slots mapping to
`::picker-icon`/`::checkmark`/option content (§6); `separator`/`arrow`
decoration.

---

## 2. State & machine

Zag's select machine: states `idle`, `focused`, `open`; ~25 events; typeahead
activity; `collection`-based highlight.

### Decision — a `Machine` for `custom`, **no machine for `native`**

This is the sharpest consequence of the inversion, and the plan's "machine only
when states × events > trivial" rule applied at *renderer* granularity for the
first time: in `native`, open/closed, highlight, typeahead buffer and scroll
position all live in the browser's own picker, unobservable and unnecessary to
model. **Decision: `render:"native"` attaches one plain behavior
(`nativeSelect`) — value atom ↔ `<select>.value` via `change`, plus
`fieldAssociation` — and spawns no machine.** Rejected: a shared machine with a
`native` no-op branch (it would tempt someone to mirror platform state, the
classic double-source-of-truth bug).

For `custom`, three states, keeping Zag's names:

```ts
class Idle    extends Schema.TaggedClass()("Idle", {}) {}
class Focused extends Schema.TaggedClass()("Focused", {}) {} // closed, tab-stop focused
class Open    extends Schema.TaggedClass()("Open", {}) {}
```

`Focused` is retained (not collapsed into `Idle`) because closed-state
typeahead and closed-state arrow-selection (§3) are only legal while focused —
the same reason Combobox keeps `Suggesting` distinct from `Interacting`.

### Decision — context split

**Snapshot (Schema, JSON, resumable):**

| Field | Schema | Why |
| --- | --- | --- |
| `value` | `Schema.Array(Schema.String)` | the selection; array even when single (Zag's shape) |
| `highlightedValue` | `Schema.NullOr(Schema.String)` | **value key, never index or node** |
| `open` | (encoded as the state tag) | resumes an open picker |
| `currentPlacement` | `Schema.optional(PlacementSchema)` | no first-frame flip on resume |

**Runtime refs (never snapshotted):** all DOM handles (trigger, content,
option elements, the projected `<select>`), the resolved `collection` object,
`selectedItems`/`highlightedItem` **objects**, the **typeahead buffer string
and its timer** (explicitly: `behaviors/typeahead.md` already rules these
runtime-only — a stale 500ms buffer restored from a snapshot would be a bug),
pointer-vs-keyboard modality flag, `autoUpdate`/anchor cleanup, restore-focus
target, live-region handle.

Same Zag divergence as Combobox: keys in state, item objects re-derived at
activation from `value`/`highlightedValue` + the items atom, so arbitrary user
data never enters a snapshot. Guards written against `highlightedItem` become
guards over `highlightedValue` + an injected collection accessor.

Snapshot-shape guard: `Schema.decodeUnknownEffect` round-trip asserting
`JSON.parse(JSON.stringify(x))` stability.

### Decision — event set

Port Zag's names essentially verbatim: `TRIGGER.CLICK`, `TRIGGER.FOCUS/BLUR`,
`TRIGGER.ARROW_UP/ARROW_DOWN/ARROW_LEFT/ARROW_RIGHT`, `TRIGGER.ENTER`,
`TRIGGER.TYPEAHEAD`, `ITEM.CLICK/POINTER_MOVE/POINTER_LEAVE`,
`CONTENT.TYPEAHEAD`, `CONTENT.ARROW_UP/ARROW_DOWN/HOME/END/ENTER/ESCAPE`,
`VALUE.SET/CLEAR`, `HIGHLIGHTED_VALUE.SET/CLEAR`, `LAYER.ESCAPE/
INTERACT_OUTSIDE`, `POSITIONING.SET`, `OPEN`, `CLOSE`, `COLLECTION.CHANGE`
(Zag's `CHILDREN_CHANGE`, renamed as in Combobox §2). **Dropped**:
`CONTROLLED.OPEN/CLOSE`, `SELECTED_ITEMS.SYNC` — external control is a write
to the same atom (§7), the identical deletion Combobox made.

Guards ported: `hasHighlightedItem`, `hasSelectedItems`, `closeOnSelect`,
`multiple`, `deselectable`, `loopFocus`, `isTriggerArrowUpEvent`,
`isTypeaheadMatch`. Dropped: `isOpenControlled`.

Activities → scoped Effects with finalizers: `scrollToHighlightedItem`
(`block: "nearest"`), `trackDismissableLayer`, `trackPlacement`
(→ `anchorPosition`), `trackFormReset`, `trackTypeahead` (→ `typeahead`).

---

## 3. Interaction spec

Keyboard map for `custom`. **APG *Listbox* + *Select-Only Combobox* are the
tiebreaker.** In `render: "native"` every row is supplied by the platform —
**decision: the `native` keyboard test asserts these behaviors exist and that
our styling/behaviors did not break them; we implement none of them.**

| Key | Closed (`Focused`) | Open | Divergences → decision |
| --- | --- | --- | --- |
| `Enter` / `Space` | open the picker | select highlighted, close (unless `closeOnSelect:false`); in `multiple`, `Space` toggles and keeps open | Zag: both open. APG: both open. **Adopt.** `Enter` while open must **not** submit the form — `preventDefault` (native parity). |
| `ArrowDown` / `ArrowUp` | **select next/previous value without opening** | move highlight; **no wrap** by default | This is native `<select>` desktop behavior and APG's select-only-combobox note; Radix/Base UI *open* instead. **Decision: match the platform — `selectOnArrowWhenClosed` default `true`, forced `false` when `multiple` (there is no "next value" for a set), and always `false` on touch (an invisible value change is hostile).** `loop: false` default, as Combobox §3. |
| `Alt+ArrowDown` / `Alt+ArrowUp` | open / (no-op) | close | APG. Zag partial. **Implement fully** — and it is the documented way to open without the closed-state arrow-selection above. |
| `Home` / `End` | select first / last value | highlight first / last item | **No divergence from Zag here** — and note this is the *opposite* of Combobox §3, which gives `Home`/`End` to the text caret and moves item-jumping to `Ctrl+Home`/`Ctrl+End`. A Select has no caret, so the plain keys are free. Recorded because the two widgets' tables must not be copied into each other. |
| `PageUp` / `PageDown` | — | move highlight by 10 | react-aria; native picker does the same. **Adopt (10, non-configurable)** — same constant as Combobox. |
| `Escape` | — | close, **revert nothing**, keep highlight = current value, restore focus to trigger | Combobox's two-stage Escape (close+revert, then clear) **does not apply**: there is no uncommitted text to revert. **Decision: single-stage Escape; a second Escape does *not* clear the value** (that is `clearTrigger`'s job, and native `<select>` has no clear-on-Escape). |
| `Tab` | native next tab stop | **close and commit the highlighted value**, then move focus | Radix closes without committing; react-aria commits. **Decision: commit — the highlighted option is rendered as visually selected in a select picker (unlike a combobox suggestion), so discarding it is a lie.** This mirrors Combobox's *reason* while inverting its *conclusion*, because there the highlight is only a suggestion unless `inline`/`both`. |
| printable chars | **typeahead: jump to and select the matching value** | typeahead: jump to and highlight the match | **Decision: Select USES the `typeahead` behavior** — this is its flagship customer, and the explicit reconciliation the catalog needs: `behaviors/typeahead.md` ("menus, selects") vs Combobox §3's "`typeahead` is NOT used by Combobox … it belongs to Select". Semantics per that doc: Zag timing (~500ms buffer, reset on timeout), match from the current index forward then wrap, locale-sensitive lowercasing, repeated same-character cycles through items starting with it, buffer + timer are runtime refs (§2), dispose clears the buffer. |
| `Backspace` / `Delete` | clear when `deselectable` | — | Zag `deselectable`. **Adopt, default false.** |
| `Ctrl/Cmd+A` | — | select all (`multiple` only) | react-aria ListBox. **Adopt for `multiple`.** |
| `Shift+Arrow`, `Shift+Click` | — | range-extend (`multiple` only) | `selectionModel` behavior's range mode. **Adopt; single-select ignores modifiers.** |

Pointer/touch: trigger press toggles (`press` behavior, giving touch/virtual
click normalization); pointer-move over an option highlights it; pointer-leave
**clears** the highlight only when the picker was opened by pointer, otherwise
the keyboard highlight survives (pointer-modality flag is a runtime ref, §2);
option press selects on `pointerup` **within** the option; touch gets no hover
highlight. On touch, `render:"native"` is strongly preferred and the docs say
so — the OS wheel/sheet picker is better than anything we would build, and it
is free.

Dismissal (`custom` only): `dismissableLayer`, deferring to the popover stack
per §5, with the **trigger registered as an excluded node** so outside-press
does not dismiss-then-reopen (the classic bug; identical ruling to
Combobox §3).

Focus (`custom`): DOM focus **never leaves the trigger** while the picker is
open — virtual focus via `aria-activedescendant` (§4). On close focus returns
to the trigger. **No focus trap** (`focusTrap` is not used by Select, same as
Combobox), and **no roving tabindex** (§4).

Form reset: `trackFormReset` — a `reset` on the owning form restores the
initial value in both renderers (`native` gets it free; `custom` must listen).

---

## 4. ARIA contract

### `render: "native"` — decision: contribute **nothing**

```
label   → <label for=select-id>
trigger → <select id name required disabled>   ← already combobox+listbox to AT
options → <option value selected disabled>, <optgroup label>
```

**Decision: the `native` renderer adds no `role` and no `aria-*` attribute
except `aria-invalid` mirroring validation state and `aria-describedby` for
help/error text.** `appearance: base-select` explicitly preserves the accessible
semantics of `<select>`, including announcing the picker as a listbox and the
selected option as such; adding `role=combobox` or `aria-expanded` on top would
*downgrade* it. This is the single strongest argument for §0's inversion: the
best a11y implementation of a select is the one we do not write. **A dev-only
diagnostic `a11y:native-select-aria-override` fires if a consumer attaches
`role`/`aria-expanded`/`aria-activedescendant` to a `native` trigger.**

### `render: "custom"`

```
label      → <label for=trigger-id> (or aria-labelledby)
trigger    → <button type=button role=combobox> aria-expanded
             aria-controls=content-id (only while open)
             aria-activedescendant=<highlighted option id> | absent
             aria-labelledby="label-id valueText-id"
             aria-invalid, aria-required, aria-disabled
valueText  → id, referenced by trigger's aria-labelledby
content    → role=listbox, aria-multiselectable (iff multiple),
             aria-labelledby=label-id
options[i] → role=option, stable id derived from item value,
             aria-selected, aria-disabled, data-highlighted
group      → role=group + aria-labelledby=grouplabel-id
clearTrigger → <button> aria-label, tabindex=-1
hiddenInput  → real <select name> (visually hidden, NOT aria-hidden, NOT display:none)
```

**Decision — `role=combobox` on the trigger, not `role=button
aria-haspopup=listbox`.** APG's *Select-Only Combobox* pattern is the current
guidance and produces the better screen-reader experience (the value is
announced as the combobox's value rather than as button label text); Radix and
Zag still emit the older button+haspopup shape. **APG wins.**

**Decision — `aria-activedescendant` virtual focus, not roving tabindex.** All
four libraries plus APG agree for the popup case; consequence: `clearTrigger`
is `tabindex="-1"`, the widget has **exactly one tab stop**, and the
`rovingTabindex` behavior is **not** used by Select (it remains for
Menu/Tabs/Toolbar). Recorded because the T2 doc lists "selects" loosely —
Select's *popup* form does not use it; a future always-expanded `Listbox`
(§ scope) will.

Live region: selection changes are announced by the option's own
`aria-selected`, so **decision: no routine `liveAnnounce` use** — the service is
used only for the `multiple` count ("3 of 12 selected", polite, debounced),
avoiding Combobox's result-count chatter which has no analogue here.

`A11y.pattern("select", SelectSlots)` must validate: required slots present;
`trigger` ⊒ `Focusable` and declares Press+Keydown(+Change); `options` is a
`Collection`; `content` present iff `render:"custom"`. Plus four
runtime/dev diagnostics, each also a Chromium keyboard test: no ARIA override
on a `native` render; `aria-activedescendant` names an existing id inside
`content`; `aria-multiselectable` present iff `multiple`; exactly one tab stop
inside `root`.

---

## 5. Platform-native floor

For every other widget this section says "here is what the platform gives you,
here is the rest." For Select it says: **the platform gives you the widget.**

| Piece | Native primitive | Coverage | Remains for JS |
| --- | --- | --- | --- |
| trigger + value display | `<select>` + `<button>` + `<selectedcontent>` | fully styleable under `appearance: base-select` | nothing |
| popup layer | `::picker(select)` in the **top layer** | stacking, light dismiss, Escape, scroll containment | nothing |
| placement | UA anchoring of the picker (+ `position-area`/`@position-try` on the picker) | flips/shifts within the viewport | nothing |
| option styling | `<option>` with rich content, `::checkmark`, `option:checked` | arbitrary markup inside options; check-mark styling | nothing |
| open icon | `::picker-icon` | rotate/replace via CSS | nothing |
| keyboard + typeahead | `<select>` | the entire §3 table, per-platform-correct | nothing |
| form participation | `<select name>` | submit, `FormData`, constraint validation, `:user-invalid`, reset, autofill | nothing |
| mobile | OS sheet/wheel picker | native touch UX | nothing |
| animation | `@starting-style` + `transition-behavior: allow-discrete` | enter/exit transitions on the picker | nothing |
| grouping | `<optgroup label>` | grouped, labelled, announced | nothing |
| separators | `<hr>` inside `<select>` | permitted in the customizable content model | nothing |

**Decisions.**

1. **Default rendering is a real `<select>`, styled with `appearance:
   base-select` behind `@supports (appearance: base-select)`.** Chromium 135+
   ships it; Firefox and Safari have not as of 2026-07. **The feature-detection
   seam is a CSS `@supports` block and nothing else** — no `CSS.supports()` JS
   branch, no alternative bundle, no runtime measurement. Unsupported engines
   render the UA's own select chrome, which is a *correct, accessible,
   fully-functional select*, not a broken one. This is the cleanest
   feature-detection seam in the entire kit and is the reason the inversion
   costs nothing: **the fallback is the same element.**
2. **`render: "custom"` rides Combobox's floor**, not a bespoke one:
   `popover="auto"` on `content` + CSS anchor positioning, with
   `@floating-ui/dom` attached only behind `anchorPosition`'s support seam, and
   `dismissableLayer` deferring to the native popover stack (adding only
   trigger-exclusion). Zero new platform work — decided so K3 does not
   re-derive Combobox §5.
3. **Rung-zero (CSS-Tags) contract.** `native`: a plain
   `<label>` + `<select name>` + `<option>`s, styled entirely from the
   foundation stylesheet via `[data-affe-select]` / `[data-part="…"]` hosts and
   the `base-select` pseudo-elements — **a fully working, submittable,
   keyboard-complete, typeahead-complete select with zero JavaScript and zero
   framework.** No other widget in the kit reaches rung zero completely; Select
   does. `custom`: markup + `popover="auto"` + anchor CSS + the projected
   `<select>` gives open/close/dismiss/position/**submit** with no JS —
   highlight, typeahead and multi-select toggling are the activation boundary
   (§8).
4. **`<select size>`/`<select multiple>` in list form is *not* the default for
   `multiple`.** Its native rendering is poor and inconsistent, and
   `base-select` support for `multiple` lags single-select. **Decision:
   `multiple` still defaults to `native` (a real `<select multiple>`, correct
   and submittable) but the docs flag it as the one case where
   `render:"custom"` is routinely justified**, and the
   `select:unnecessary-custom` diagnostic (§0) does not fire for `multiple`.
5. `<input list>`/`<datalist>` is **out of scope** — that is Combobox's escape
   hatch (Combobox §5.4), not a select.

---

## 6. Tokens & variants

Token axes consumed (all eight): **color** (trigger surface/border, picker
surface, `brand` for selected, `dangerBorder` for `:user-invalid`/
`aria-invalid`, `*Hover`/`*Active` suffixes aligning with `data-highlighted`
and `option:hover`), **spacing** (trigger padding, option padding, picker
padding), **radius** (trigger, picker, option), **stroke** (trigger border,
focus ring), **typography** (value text, option label, group label),
**elevation** (picker shadow), **blur** (optional picker backdrop-filter),
**motion** (picker enter/exit via `@starting-style` +
`transition-behavior: allow-discrete`, honoring `prefers-reduced-motion`). All
values through `light-dark()` so a dormant page follows OS theme with no JS.

**Decision — one recipe, two renderers.** The recipe's slot→style map is
authored against our anatomy names, and the `native` stylesheet maps them onto
platform pseudo-elements:

| Recipe slot | `native` selector | `custom` selector |
| --- | --- | --- |
| `trigger` | `select, select::picker-icon`'s host | `[data-part=trigger]` |
| `valueText` | `selectedcontent` | `[data-part=valueText]` |
| `content` | `::picker(select)` | `[data-part=content]` |
| `item` | `option` | `[data-part=item]` |
| `itemIndicator` | `option::checkmark` | `[data-part=itemIndicator]` |
| `groupLabel` | `optgroup` label | `[data-part=groupLabel]` |
| (selected) | `option:checked` | `[aria-selected=true]` |
| (highlighted) | `option:hover`, `option:focus` | `[data-highlighted]` |

This mapping is what makes §0 affordable: escalating `render` changes markup
and behaviors but **not the theme**, so a `native` and a `custom` Select are
visually indistinguishable. **Decision: a K3 visual-parity test renders both
with the same recipe and diffs them.**

Variant surfaces surveyed: Zag/Ark, Radix, Base UI, react-aria expose none
(headless); shadcn bakes size into copied source; `@stylextras/ui` exposes
`size`/`variant`/`sx`.

**Decision — Recipe surface, deliberately identical to Combobox's:**

```ts
variants: {
  size:    { sm | md | lg },
  variant: { outline | subtle | ghost },
}
defaults: { size: "md", variant: "outline" }
compound: [{ variant: "ghost", size: "sm", style: {...} }]
```

Identical on purpose: a form containing a Select and a Combobox must not look
like it contains two libraries. Rejected: `intent`/color variants (theme axis),
`rounded`/`shadow` knobs (radius/elevation axes), `density` (spacing axis
composed per-subtree), and Radix's `position: "item-aligned" | "popper"` —
item-aligned popups are the native macOS behavior we get free in `native` and
deliberately do not emulate in `custom` (§1's rejection of `Viewport`).
`render`/`multiple`/`invalid`/`open` are **data-attributes** driven by state
and renderer, never variants.

---

## 7. API surface comparison

| Concern | Zag/Ark | Radix | Base UI | react-aria | **Ours** |
| --- | --- | --- | --- | --- | --- |
| renderer choice | — | — | — | — | **`render?: "native" \| "custom"` (default `"native"`)** — unique to us (§0) |
| open state | `open`/`defaultOpen`/`onOpenChange` | same | same | internal | `open?: Atom.Writable<boolean>` (**ignored + dev-warned in `native`**) |
| selection | `value: string[]` | `value: string` | `value` | `selectedKey` | `value?: Atom.Writable<ReadonlyArray<string>>` (array even when single — Zag's shape, adopted) |
| items | `collection` object | children | `items` | `items` + render fn | `items: Atom.Readonly<ReadonlyArray<T>>` + `itemToValue`/`itemToLabel`/`itemToDisabled` |
| multiple | `multiple` | ⛔ unsupported | `multiple` | `selectionMode` | `multiple?: boolean` |
| deselect by re-click | `deselectable` | — | — | — | **adopt `deselectable`** (default false) |
| close on select | `closeOnSelect` | always | `closeOnSelect` | always | `closeOnSelect?: boolean` (default `!multiple`) |
| placeholder | via `valueText` | `Placeholder` | `Value` render | `placeholder` | `placeholder?: string` → empty `<option>` in `native` |
| loop navigation | `loopFocus` | `loop` | — | — | `loop?: boolean` (default **false**, as Combobox) |
| popup placement | `positioning` | `side`/`align`/`position` | `side`/`align` | `placement` | `placement?: Placement` (`custom` only; `native` warns) |
| form | `hiddenSelect` part | `BubbleSelect` | Field | `HiddenSelect` | `name?: string` + `formControl`; **`native` needs neither** |
| validation | — | — | Field/`required` | `isRequired`/`validate` | `required`/`disabled` + `fieldAssociation`; `native` uses real constraint validation |
| virtualization | consumer | consumer | `virtualized` | `Virtualizer` | **deferred to K4** |
| callbacks | `onValueChange`… | `onValueChange` | `onValueChange` | `onSelectionChange` | **no callbacks** — atoms; `Component.action` for effects |
| `asChild` | Ark `asChild` | `asChild` | `render` prop | render props | **rejected** — slot remapping covers it |

**Decisions.** Controlled/uncontrolled is **one code path**: every externally
controllable value is an optional writable atom, created internally via
`Component.state` when omitted — which is why Zag's `CONTROLLED.*` events could
be deleted (§2), identical to Combobox §7. `value` is always an array, even for
single-select, so `multiple` never changes the type of the value atom (Radix's
`string` forces a breaking change to add multi-select; Zag's array shape is
right). **`open` and `placement` are accepted but inert under
`render:"native"`, with a dev diagnostic** rather than a type error — a type-level
split would make `render` a phantom type parameter and infect every consumer's
signatures, which is precisely the closed-typing failure the kit exists to
avoid. Rejected: Radix's `position` (§6), `Viewport`/scroll-button props (§1),
`onOpenChange` callbacks, separate `NativeSelect` component (§0).

Composition points we publish: the headless component + `SelectSlots`
contract; the `custom` machine definition (swappable); each behavior
individually (`collection`, `listNavigation`, `typeahead`, `selectionModel`,
`dismissableLayer`, `anchorPosition`, `press`, `formControl`,
`fieldAssociation`, `nativeSelect`); and the recipe data
(`mergeRecipes`-patchable).

Customization pressure (from shadcn's Radix-Select recipe, which is what people
actually fork): grouped options, per-option icons/avatars, sticky search inside
the popup, multi-select badges, "select all", and async option loading.
**Decision: those six become the hostile-customization test list for K3's
Select** — each must be achievable from outside, over plain imports, without
forking; and the first two must work in `render:"native"` too (rich `<option>`
content under `base-select`), which is the demo that sells §0.

---

## 8. Resumability & dormancy

**`render: "native"` — decision: nothing to resume, and that is the point.**
There is no machine (§2) and no snapshot beyond the value atom. A dormant page's
native Select is **not degraded in any respect**: it opens, keyboards,
typeaheads, groups, validates, autofills, shows the OS picker on mobile, and
submits in a real form POST with zero JavaScript. Activation is a **no-op**
unless the consumer attached reactive behavior (a dependent second select, a
live-computed total), in which case activation is triggered by the first
`change` event — already recorded pre-JS by the resume event recorder in
`src/resume-event.ts`. **This makes `native` Select the kit's dormancy
flagship: the widget where dormant and live are behaviorally identical.**
Proof for K3: a Playwright run with JS disabled that fills and submits a form
containing a Select and asserts the POST body.

**`render: "custom"` — the `formControl` projection flagship.** What snapshots
(§2): `value`, `highlightedValue`, the state tag, `currentPlacement` — held in
`Component.state` as a `Machine.EncodedSnapshot`, so
`Resume.snapshotState(Machine.EncodedSnapshotSchema)` round-trips with no new
resume-kernel code. What does not: DOM handles, collection/item objects, the
**typeahead buffer and timer** (a resumed 500ms buffer would be a bug — see §2),
pointer-modality flags, anchor cleanup.

Dormant markup for `custom`: full option list + `popover="auto"` + anchor CSS
+ **a real `<select name>` (or `<select multiple>`) as the `hiddenInput`
projection, visually hidden but focusable and not `display:none`** so the
browser will report constraint violations on it. Before any JS the picker
opens, positions, light-dismisses, and **the current value submits** — options
are rendered as labels against that projected select. Typeahead, highlight
tracking and multi-select toggling are absent; that is the honest activation
boundary.

**Activation trigger (`custom`):** first `keydown` or `press` on `trigger`, or
first pointer-enter on `content`. **Decision — two K3 resume proofs:**

1. **Dormant submit** (the flagship): with JS disabled, open the dormant custom
   select, choose an option, submit the form, assert the POST body carries the
   right `name=value`. No source library can express this test.
2. **Dormant-open restore**: open the picker while dormant and highlight an
   option via the platform, activate, and assert the machine restores to `Open`
   with the same `highlightedValue`, `aria-activedescendant` re-established, no
   flash of closed state, and no setup replay.

Third proof, cheap and worth having: **renderer parity** — the same
`Resume.snapshotState` value atom round-trips identically under both `render`
modes, proving §0's "same component" claim at the resume boundary.

---

## 9. Port sources

| From | Artifact | License | Use |
| --- | --- | --- | --- |
| Zag.js | `packages/machines/select/src/select.machine.ts` | MIT | **primary port** for `custom` — states, events, guards, actions per §2, with the context split, deletions and renames recorded there |
| Zag.js | `select/src/select.connect.ts` | MIT | prop-getters → behavior slot attachments; source of the exact ARIA set in §4 (**with the `role=combobox` upgrade over its button+haspopup shape**) |
| Zag.js | `select/src/select.dom.ts` | MIT | id conventions, `scrollIntoView` policy (`block: "nearest"`), form-reset tracking |
| Zag.js | `packages/utilities/typeahead` (or the machine's typeahead activity) | MIT | **the `typeahead` behavior's port source** (§3 timing/wrap semantics) |
| Zag.js | `packages/utilities/collection` | MIT | reference for `collection` accessors (already scheduled; Select consumes) |
| Zag.js | `utils/dismissable`, `interact-outside`, `aria-hidden` | MIT | consumed via the `dismissableLayer`/`interactOutside`/`hideOutside` behaviors; not re-ported here |
| Floating UI | `@floating-ui/dom` | MIT | **dependency, not a port**; `custom` fallback path only (§5.2) |
| Base UI | `packages/react/src/select/**/*.test.tsx` | MIT | **test suites to port** — typeahead timing, closed-state arrow behavior, multi-select toggling, form reset, `closeOnSelect`, scrollbar-drag-no-close |
| Radix | `packages/react/select` | MIT | read for the `BubbleSelect` hidden-select projection technique (§8) and its excluded-trigger dismissal fix; **do not port `Viewport`/scroll buttons** (§1) |
| WPT + Chromium | `customizable-select` web tests, `html/semantics/forms/the-select-element/**` | (per project) | **conformance source for `native`** — the §3 rows we assert but do not implement |
| WAI-ARIA APG | *Listbox* and *Select-Only Combobox* patterns | W3C Document Licence | tiebreaker citations (§3/§4); keyboard-map conformance checklist |
| react-aria | `@react-aria/select`, `@react-aria/listbox`, `useTypeSelect`, `@react-stately/select` | **Apache-2.0** | **read-for-spec only — never copied source, never copied tests.** Adopted *ideas*: PageUp/PageDown step of 10, Tab-commits-highlight, `Ctrl+A` in multi-select. Recorded explicitly so a later agent does not paste it in. |
| `@stylextras/ui` | native-first select notes (`appearance: base-select`, token axes) | (per package) | platform-floor and §0 design confirmation; no code |
| shadcn/ui | Radix-Select recipe | MIT | **customization-pressure inventory only** → the six-item hostile-customization list (§7). Not a behavior source. |

Provenance rules: every ported file carries a header naming upstream repo,
path, commit SHA and licence; `NOTICE`/`THIRD_PARTY` entries for Zag (MIT),
Base UI (MIT), Radix (MIT). **react-aria's Apache-2.0 material is
read-for-spec only and must not appear as copied source or copied tests** —
the same fence Combobox §9 raises, restated because Select's spec debt to
react-aria (`useTypeSelect`) is larger and therefore more tempting.

Gates this widget must pass: state/event/R/E type tests through define→spawn
(`custom`); Schema round-trip of machine state; the four `a11y:*` Select
diagnostics; exact-once disposal + no-op double-dispose; **two** Chromium
keyboard suites — one implementing §3 for `custom`, one *asserting* §3 for
`native` (the "we didn't break the platform" suite, including that
`appearance: base-select` styling preserves typeahead and mobile pickers);
the three §8 resume proofs; the §7 hostile-customization suite; the §6
native-vs-custom visual-parity diff; and the `@stylextras/ui`-derived matrix —
reduced motion, forced colors, RTL, 200% zoom, narrow viewport, plus a real
touch-device pass (Select is the widget where touch differs most).
