# Widget research: Combobox

Date: 2026-07-29
Status: **researched — K2 entry gate satisfied**
Template: KR 9-section widget template (`docs/COMPONENT_KIT_PLAN.md`, KR phase)
Downstream: gates K2 (`Combobox` implementation); this doc is the template all
other widget research docs copy.

Sources consulted (all MIT unless noted): Zag.js combobox machine + docs, Ark UI
combobox anatomy, Radix Primitives (no combobox primitive — see §7), Base UI
Autocomplete/Combobox, react-aria `ComboBox`, shadcn/ui combobox recipe
(Popover + cmdk `Command`), WAI-ARIA APG Combobox pattern (tiebreaker,
W3C document licence — cited, not copied), `@stylextras/ui` platform-native
floor notes, CSS-Tags rung-zero contract. Local: `src/behaviors.ts` combobox
seed (L328+), `src/A11y.ts` pattern/anatomy conventions, `src/Element.ts`
capability lattice, `src/Machine.ts`.

Scope decision up front: **one widget, `Combobox`, with an
`allowCustomValue` axis** — we do *not* ship Base UI's split of
Autocomplete (free text, suggestions advisory) vs Combobox (value must come
from the collection). Base UI's split is an API-ergonomics choice; the machine
is the same machine with one guard flipped, and two widgets would double the
anatomy, recipe, and test surface. Rejected: separate `Autocomplete` widget.

---

## Decision summary (one line per section)

Read this table first; each row is expanded, with sources and rejected
alternatives, in the numbered section it points at.

| § | Decision |
| --- | --- |
| 1 | **Anatomy**: 8 required + 3 hidden-capable slots (`root`, `label`, `control`, `input`, `trigger`, `content`, `listbox`, `options` + `clearTrigger`, `empty`, `hiddenInput`), narrowest capability each — `label`/`empty` are `Base`, `input` is the only `TextInput`, `trigger` is `Interactive` (not a tab stop), `options` is a `Collection`; rejected `positioner`, `portal`, `arrow`, `backdrop`, `separator`, `itemText`/`itemIndicator` (recipe slots, not anatomy), the multi-select tag strip (deferred to `TagsInput`), and `status` (becomes the `liveAnnounce` service). |
| 2 | **State & machine**: a real `Machine` on Zag's flat 4 states (`Idle`/`Focused`/`Suggesting`/`Interacting`); snapshot holds only `value`, `inputValue`, `highlightedValue` (**value key, never index or node**), the state tag, `currentPlacement`, `mode` — all DOM handles, collection/item objects, `selectedItemMap`, live region, timers and pointer-modality flags are runtime refs; we diverge from Zag by re-deriving item objects from keys so arbitrary user data never poisons snapshots; dropped `CONTROLLED.*` and `SELECTED_ITEMS.SYNC`, renamed `CHILDREN_CHANGE` → `COLLECTION.CHANGE`. |
| 3 | **Interaction**: full keyboard map with APG-resolved divergences — no wrap by default (against Zag's loop), `Home`/`End` are caret keys with `Ctrl+Home`/`Ctrl+End` for first/last item (**against Zag docs**), two-stage `Escape` (close+revert, then clear), `Tab` commits the highlight only in `inline`/`both` mode, `Alt+Arrow` fully implemented, PageUp/PageDown = 10; `openOnClick` defaults false; Combobox uses **no** `typeahead` and **no** `focusTrap` (the seed's `focusTrap` on `content` is a bug removed in K2). |
| 4 | **ARIA**: `aria-activedescendant` virtual focus, **not** roving tabindex (APG plus all three libraries agree; roving would break typing), so `trigger`/`clearTrigger` are `tabindex="-1"` and the widget has exactly one tab stop; announcements go through the `liveAnnounce` service (`role="status"`, polite, debounced); four new `a11y:*` diagnostics — activedescendant target exists, `aria-controls` present iff expanded, unique stable option ids, single tab stop. |
| 5 | **Platform floor**: default is `popover="auto"` + CSS anchor positioning (Chrome 125+, Firefox 132+, Safari 18.2+, ~91% traffic), with `@floating-ui/dom` attached only behind a `CSS.supports` seam inside `anchorPosition`; `dismissableLayer` defers to the native popover stack and only adds trigger-exclusion and pointer-in-content; rung zero = open/close/dismiss/position/**submit** with zero JS; `<datalist>` rejected as the default but documented as an escape hatch; the native-`<select>`-first inversion belongs to Select, not Combobox. |
| 6 | **Tokens & variants**: consumes all eight token axes via `light-dark()`; the Recipe surface is deliberately tiny (`size: sm\|md\|lg`, `variant: outline\|subtle\|ghost`, defaults + one compound), with `item`/`itemIndicator`/`groupLabel` as recipe-only slots; invalid/disabled/open are machine-tag data-attributes, never variants; rejected `intent`, `rounded`/`shadow`, `density`. |
| 7 | **API**: every externally controllable value is an optional writable atom (`open`, `value`, `inputValue`), so controlled/uncontrolled is **one code path** with no `defaultX`/`onXChange` triad — which is what let us delete Zag's `CONTROLLED.*`; adopt Zag's three-way `selectionBehavior` and react-aria's `menuTrigger` enum; loading is just `ResultAtom` state, no extra prop; no callbacks (atoms + `Component.action`); Radix has **no** combobox — its answer is Popover + cmdk, exactly the shadcn recipe, whose fork pressure becomes the hostile-customization test list; virtualization deferred to K4, grid mode rejected. |
| 8 | **Resumability**: the dormant page ships full markup + `popover=auto` + hidden-input/`<select>` projection, so the dropdown opens, positions, light-dismisses and **submits before any JS**, with `aria-autocomplete="none"` until activation; activation binds to first input/keydown and first pointer-enter on `content`; two K2 proofs — type-while-dormant then activate must replay the keystroke (filtered list + caret preserved), and open-while-dormant then activate must restore `Interacting`/`Suggesting` with no closed-state flash. |
| 9 | **Port sources**: Zag `combobox.machine.ts` (+ `.connect.ts` for the ARIA set, `.dom.ts` for ids and `block:"nearest"`) and the collection utility as the primary MIT port with commit-SHA provenance headers; Base UI autocomplete/combobox `*.test.tsx` as the ported test suites; `@floating-ui/dom` as a dependency, not a port; react-aria is **Apache-2.0 — read-for-spec only, never copied source or copied tests**; APG cited as tiebreaker; shadcn used only as customization-pressure inventory. |

### Prerequisites K2 must add first

Two gaps in the current primitives, decided here rather than worked around:

1. `View.Event` is `{Press, Click, Input, Focus, Blur, Hover}` — **add
   `View.Event.Keydown = makeEvent("keydown")`**. A keyboard-driven widget
   cannot state its slot contract without it; `View.Event.make("keydown")` is
   the stopgap until then.
2. Slot metadata has no `optional` flag — the three optional slots use the
   existing **hidden-slot** mechanism (declared in the contract, `View.hidden`
   when absent) rather than a new metadata field, so `A11y.validate` keeps
   requiring every declared slot.

Also pending from the seed: `src/behaviors.ts` (L328+) types `input` and
`listbox` as `Element.Interactive`; widen to `TextInput` and `Container`
respectively when K2 lands (the seed predates the capability lattice).

---

## 1. Anatomy

### Per-library parts

| Part | Zag / Ark | Base UI | react-aria | shadcn recipe | Ours |
| --- | --- | --- | --- | --- | --- |
| root | `root` | `Root` | `ComboBox` | `Popover` | ✅ `root` |
| label | `label` | (Field label) | `Label` | `Label` | ✅ `label` |
| control (input wrapper) | `control` | `InputGroup` | `FieldGroup` | `PopoverTrigger` | ✅ `control` |
| input | `input` | `Input` | `Input` | `CommandInput` | ✅ `input` |
| trigger (open button) | `trigger` | `Trigger` + `Icon` | `FieldButton` | `Button` | ✅ `trigger` |
| clear button | `clearTrigger` | `Clear` | (custom) | — | ✅ `clearTrigger` |
| value display (multi) | (item tags custom) | `Value` | `ComboBoxValue` | badges | ⛔ (see below) |
| portal | (framework) | `Portal` | (Popover) | (Portal) | ⛔ renderer concern |
| positioner | `positioner` | `Positioner` | — | — | ⛔ merged into `content` |
| content/popup | `content` | `Popup` | `Popover` | `PopoverContent` | ✅ `content` |
| list (listbox) | `list` | `List` | `ListBox` | `CommandList` | ✅ `listbox` |
| item | `item` | `Item` | `ComboBoxItem` | `CommandItem` | ✅ `options` (Collection) |
| item text | `itemText` | — | `Text` | — | ⛔ |
| item indicator | `itemIndicator` | (custom) | — | `Check` | ⛔ |
| group + label | `itemGroup`/`itemGroupLabel` | `Group`/`GroupLabel` | `ListBoxSection`/`Header` | `CommandGroup` | ✅ optional `group` |
| empty state | (custom) | `Empty` | `renderEmptyState` | `CommandEmpty` | ✅ optional `empty` |
| status / live region | machine `trackLiveRegion` | `Status` | internal announcer | — | ⛔ service (`liveAnnounce`) |
| arrow | `arrow` | `Arrow` | — | — | ⛔ decoration |
| backdrop | `backdrop` | — | — | — | ⛔ |
| separator | — | `Separator` | — | `CommandSeparator` | ⛔ decoration |
| hidden native input | (form hidden input) | (form) | (form) | — | ✅ `hiddenInput` (opt) |

### Decision — minimal anatomy (7 required + 3 optional)

```ts
export const ComboboxSlots = View.Slots.define({
  // required
  root:         { capability: Element.Capability.Container },
  label:        { capability: Element.Capability.Base },
  control:      { capability: Element.Capability.Container },
  input:        { capability: Element.Capability.TextInput,
                  allowedEvents: [View.Event.Input, View.Event.Focus, View.Event.Blur,
                                  Keydown /* see note */] },
  trigger:      { capability: Element.Capability.Interactive,
                  allowedEvents: [View.Event.Press] },
  content:      { capability: Element.Capability.Container },
  listbox:      { capability: Element.Capability.Container },
  options:      { capability: Element.Capability.Collection },
  // optional (hidden-slot compatible)
  clearTrigger: { capability: Element.Capability.Interactive,
                  allowedEvents: [View.Event.Press] /* hidden-capable */ },
  empty:        { capability: Element.Capability.Base /* hidden-capable */ },
  hiddenInput:  { capability: Element.Capability.TextInput /* hidden-capable */ },
})
```

Two prerequisites this snippet exposes, both decided as small K2 additions
rather than workarounds: (a) `View.Event` today is
`{Press, Click, Input, Focus, Blur, Hover}` — **add
`View.Event.Keydown = makeEvent("keydown")`**, since a keyboard-driven widget
cannot declare its contract without it (`View.Event.make("keydown")` is the
stopgap); (b) slot metadata has no `optional` flag — the three optional slots
use the existing **hidden-slot** mechanism (declared in the contract,
`View.hidden` when absent) rather than a new metadata field, so
`A11y.validate` keeps requiring every declared slot.

Narrowest capability per slot is deliberate: `label`/`empty` are
`Base` (no interaction contract — they must not become press targets);
`input` is the only `TextInput`; `trigger`/`clearTrigger` are `Interactive`
(not `Focusable`: in the APG focus model they are not tab stops — see §3/§4);
`options` is `Element.Collection<Interactive>` so items register in DOM order
via the `collection` behavior; `content` vs `listbox` stay distinct because
`content` is the positioned/dismissable layer and `listbox` is the ARIA
container — collapsing them breaks grouped and non-listbox popups later.

Note the seed in `src/behaviors.ts` types `input`/`listbox` as
`Element.Interactive`; **decision: widen the seed to `TextInput` for `input`
and `Container` for `listbox`/`content`** when K2 lands (seed is pre-lattice).

Rejected parts and why: `positioner` (a wrapper node exists only because React
cannot attach transforms externally — `anchorPosition` attaches to `content`
directly); `portal` (renderer concern, not a slot); `itemText`/`itemIndicator`
(pure styling structure — recipe slots, not anatomy); `arrow`/`backdrop`/
`separator` (decoration); `Value`/tag list for multi-select (**deferred**: the
tag/chip strip is its own widget, `TagsInput`, and Zag models it separately —
multi-select Combobox renders selected values through the consumer's own
markup in v1). `status` becomes the `liveAnnounce` **service**, not a slot,
per house rule 2.

---

## 2. State & machine

Zag's combobox machine (primary source) is: states `idle`, `focused`,
`interacting`, `suggesting` (i.e. one closed cluster + three open sub-modes),
~30 events, ~16 guards, 5 activities.

### Decision — this is a `Machine`, not a plain behavior

Machine policy is "states × events > trivial." Combobox is the canonical
customer: it is the widget the plan already uses in the `Machine.spawn`
example. Ancillary logic stays as behaviors (`collection`, `listNavigation`,
`typeahead`, `dismissableLayer`, `anchorPosition`, `press`, `formControl`,
`searchFilter`).

### Decision — flat 4-state tree, Zag's names preserved

```ts
class Idle       extends Schema.TaggedClass()("Idle", {}) {}
class Focused    extends Schema.TaggedClass()("Focused", {}) {}
class Suggesting extends Schema.TaggedClass()("Suggesting", {}) {} // open, typing drove it
class Interacting extends Schema.TaggedClass()("Interacting", {}) {} // open, pointer/keyboard nav
```

Keeping `Suggesting` vs `Interacting` separate is *not* redundant: they differ
in whether `ArrowDown` from a closed-but-typed input re-filters or navigates,
and in whether pointer-move steals highlight. Both are `open` for styling —
expose `data-state` plus a derived `data-open` so recipes do not branch on
four tags. Rejected: collapsing to `Open`/`Closed` (loses Zag's encoded edge
cases, which is the whole reason to port).

### Decision — context split (snapshot vs runtime ref)

The hard porting rule applied concretely. **Machine Schema state (snapshot-safe,
JSON, resumable):**

| Field | Schema | Why in snapshot |
| --- | --- | --- |
| `value` | `Schema.Array(Schema.String)` | the selection; must survive dormancy |
| `inputValue` | `Schema.String` | user's typed text; must survive dormancy |
| `highlightedValue` | `Schema.NullOr(Schema.String)` | **value key, never index/node** |
| `open` | (encoded as the state tag) | resumes an open popup |
| `currentPlacement` | `Schema.optional(PlacementSchema)` | avoids first-frame flip on resume |
| `mode` | `"none" \| "list" \| "both" \| "inline"` | affects rendering decisions |

**Runtime refs (behavior scope, never snapshotted):** every DOM node handle
(`input`, `content`, `listbox`, option elements), the live-region element
(Zag's `liveRegion` ref → our `liveAnnounce` service), the resolved
`collection` object and `selectedItemMap`/`highlightedItem` **objects**
(derived from `value`/`highlightedValue` + collection at activation),
floating-ui `autoUpdate` cleanup, typeahead timers, `isPointerOverContent`
/pointer-vs-keyboard flags, `restoreFocus` target, filter function.

The one substantive divergence from Zag: Zag keeps `highlightedItem` and
`selectedItemMap` in machine context. We keep only the **keys** in state and
re-derive item objects, because item objects are arbitrary user data with
functions/DOM in them and would poison snapshots. Guards that Zag writes
against `highlightedItem` become guards over `highlightedValue` + a
collection accessor injected as a machine dependency.

Snapshot-shape guard: `Schema.decodeUnknownEffect` round-trip test asserts
the encoded snapshot is structurally `JSON.parse(JSON.stringify(x))`-stable.

### Decision — event set

Port Zag's event names essentially verbatim (they are the documentation of the
edge cases): `INPUT.CHANGE/CLICK/FOCUS/BLUR/ESCAPE/ARROW_DOWN/ARROW_UP/
ENTER/HOME/END`, `TRIGGER.CLICK`, `ITEM.CLICK/POINTER_MOVE/POINTER_LEAVE/
SELECT/CLEAR`, `VALUE.SET/CLEAR`, `INPUT_VALUE.SET`, `HIGHLIGHTED_VALUE.SET/
CLEAR`, `LAYER.ESCAPE/INTERACT_OUTSIDE`, `POSITIONING.SET`, `OPEN`, `CLOSE`,
`COLLECTION.CHANGE` (Zag's `CHILDREN_CHANGE`, renamed — it is a collection
event, not a DOM-children event). **Dropped**: `CONTROLLED.OPEN/CLOSE` and
`SELECTED_ITEMS.SYNC` — controlled-mode reconciliation is not a machine event
here; the atom bridge (§7) makes external control a write to the same atom,
which is the whole point of the controlled/uncontrolled behavior. This removes
Zag's most awkward event pair.

Guards ported: `isInputValueEmpty`, `autoComplete`, `autoHighlight`,
`isFirstItemHighlighted`, `isLastItemHighlighted`, `isCustomValue`,
`allowCustomValue`, `hasHighlightedItem`, `closeOnSelect`, `openOnChange`,
`restoreFocus`, `isHighlightedItemRemoved`, `hasCollectionItems`. Dropped:
`isOpenControlled`, `isChangeEvent`, `autoFocus` (first two by the decision
above; `autoFocus` is a mount option, not a guard).

Activities → scoped Effects with finalizers: `scrollToHighlightedItem`,
`trackDismissableLayer` (→ our layer service), `trackPlacement`
(→ `anchorPosition`), `trackLiveRegion` (→ `liveAnnounce`), `trackFocusVisible`
(→ `focusVisible`).

---

## 3. Interaction spec

Keyboard map. **APG is the tiebreaker for every divergence.**

| Key | Closed | Open | Divergences → decision |
| --- | --- | --- | --- |
| `ArrowDown` | open + highlight first (`Alt+ArrowDown` = open without highlight) | next item; **no wrap** at end | Zag/Base wrap optionally; APG says arrow keys move without wrapping by default. **Decision: no wrap; `loop: false` default, opt-in option.** |
| `ArrowUp` | open + highlight **last** (`Alt+ArrowUp` = open without highlight) | previous item | react-aria opens to last item; Zag same. **Adopt.** |
| `Alt+ArrowDown/Up` | open / close | close (Alt+Up) | APG-specified; Zag partially implements. **Decision: implement fully.** |
| `Home` / `End` | move text caret | Zag: first/last item. APG (editable combobox): **caret to start/end of input** | **Decision: APG wins — `Home`/`End` are text-editing keys; `Ctrl+Home`/`Ctrl+End` jump to first/last item.** This diverges from Zag docs deliberately. |
| `PageUp`/`PageDown` | — | move by 10 items | react-aria only. **Adopt (10, non-configurable).** |
| `Enter` | submit form (native) | select highlighted, close (unless `closeOnSelect:false`) | unanimous. **Adopt.** With no highlight and `allowCustomValue`, commit the typed value. |
| `Escape` | clear input if `clearOnEscape` | close, revert `inputValue` to last committed value, keep focus | Base UI reverts; Zag `revertInputValue`. APG: dismisses popup, then clears. **Decision: first `Escape` closes+reverts, second `Escape` clears the value (two-stage), matching APG's "if popup hidden, clear".** |
| `Tab` | native next tab stop | select highlighted (if `selectOnTab`) then close and move focus | react-aria selects on Tab; Zag closes without selecting. **Decision: close + commit highlighted only when `mode` is `inline`/`both` (an inline completion is already visible, so not committing it is a lie); otherwise close without selecting.** |
| `Backspace`/`Delete` | — | re-filter; do **not** auto-highlight when input becomes empty | Base UI explicit. **Adopt.** |
| printable chars | open if `openOnChange` (default true) | re-filter, reset highlight per `autoHighlight` | **Adopt.** No typeahead-jump behavior: filtering *is* the typeahead for an editable combobox. **Decision: `typeahead` behavior is NOT used by Combobox** (it belongs to Select). |

Pointer/touch: `trigger` press toggles; `input` click opens only when
`openOnClick` (default **false** — react-aria's `menuTrigger:"input"` default,
against Zag's `INPUT.CLICK` opening); pointer-move over an item highlights it
(`ITEM.POINTER_MOVE`), pointer-leave **clears** highlight only when the popup
was opened by pointer, otherwise keyboard highlight is preserved — the
pointer-vs-keyboard flag is a runtime ref (§2); item press selects on
`pointerup` within the item (via `press`, which gives us touch/virtual-click
normalization for free); touch gets no hover highlight (the `hover` behavior's
touch rejection). Scroll: `scrollToHighlightedItem` uses
`block: "nearest"` and is suppressed while the pointer is the input device.

Dismissal: `dismissableLayer` — Escape and outside-press route to the topmost
layer; outside-press on the `trigger` must not double-toggle (the classic
bug: dismiss-then-reopen). **Decision: trigger is registered as an excluded
node on the layer, exactly as Radix does.**

Focus: DOM focus **never leaves the input** while the popup is open (§4).
On close, focus returns to the input; on select-and-close with
`restoreFocus`, focus returns to whatever opened it. No focus trap —
**decision: `focusTrap` is not used by Combobox** (the seed's use of
`focusTrap()` on `content` is wrong and is removed in K2; it is the seed's
most consequential bug).

Blur: `INPUT.BLUR` closes and, per `allowCustomValue`, either commits the
typed value or reverts. Blur onto the popup content (scrollbar drag) must not
close — guarded by the `isPointerOverContent` runtime ref.

---

## 4. ARIA contract

```
label            → <label for=input>
control          → (presentational wrapper; role omitted)
input            → role=combobox (or bare <input>), aria-expanded,
                   aria-controls=listbox-id (only while open),
                   aria-autocomplete=none|list|both,
                   aria-activedescendant=<highlighted option id> | absent,
                   aria-describedby (status), aria-invalid, aria-required,
                   autocomplete="off", spellcheck="false", role-safe type="text"
trigger          → <button type=button> tabindex=-1 aria-hidden? NO —
                   aria-label required, aria-expanded mirrored, aria-controls
listbox          → role=listbox, aria-multiselectable when multiple,
                   aria-labelledby=label-id
options[i]       → role=option, id (stable, derived from item value),
                   aria-selected, data-highlighted, aria-disabled
empty            → role=status (polite) — not role=alert
clearTrigger     → <button> aria-label, tabindex=-1
hiddenInput      → <input type=hidden name=...> (or a real <select multiple>)
```

### Decision — `aria-activedescendant`, not roving focus

APG: "DOM focus remains on the combobox" for listbox popups. Zag, Base UI,
react-aria all agree. Roving tabindex into the list would break typing, which
is the whole point of a combobox. **Decision: `aria-activedescendant` virtual
focus; the `rovingTabindex` behavior is not used by Combobox** (it is used by
Select/Menu/Tabs). `listNavigation` therefore runs in its virtual-focus mode
and writes `highlightedValue` + `aria-activedescendant`, never `.focus()`.

Consequence, decided: **`trigger` and `clearTrigger` are `tabindex="-1"`** —
one tab stop for the whole widget (react-aria keeps the button focusable;
APG's editable-combobox examples do not). Rationale: a screen-reader user
tabbing into a "button" that only duplicates `Alt+ArrowDown` is noise, and it
also justifies `Interactive` rather than `Focusable` in §1.

Live region: the count of filtered results and the highlighted option are
announced through the `liveAnnounce` service (`role="status"`, polite,
debounced ~500ms, deduplicated) — Zag's `trackLiveRegion` and Base UI's
`Status` part converge here. Announcement text is a Schema-typed message
function so it is localizable.

`A11y.pattern("combobox", ComboboxSlots)` must validate: all required slots
present; `input` capability ⊒ `TextInput` and declares Key+Input+Focus events;
`options` is a `Collection`; `trigger` declares `Press`. Beyond the generic
validator, add combobox-specific runtime diagnostics (dev-only, dynamic
attachments): `aria-activedescendant` references an existing id in `listbox`;
`aria-controls` present iff `aria-expanded="true"`; every option has a unique
stable id; exactly one tab stop within `root`. **Decision: these four become
`a11y:*` diagnostic codes, and each is also a Chromium keyboard test.**

---

## 5. Platform-native floor

| Piece | Native primitive | Coverage | Remains for JS |
| --- | --- | --- | --- |
| popup layering + light dismiss | `popover="auto"` + `popovertarget` invoker | top layer, Escape, outside-click dismiss, stacking, **works with zero JS** | highlight, filter, activedescendant, selection |
| placement | CSS anchor positioning (`anchor-name`/`position-anchor`, `@position-try`) | Chrome 125+, Firefox 132+, Safari 18.2+ (flip needs 18.4+) → ~91% traffic | collision fallback on older engines |
| value submission | `<select>` / hidden `<input>` | full form participation, validation, autofill | — |
| simple case | `<input list=...>` + `<datalist>` | free native combobox | rejected: unstylable options, inconsistent filtering/a11y across engines |
| text suggestions | `<input autocomplete>` | browser-native history/address suggestions | must be **off** (`autocomplete="off"`) to avoid double popups |

**Decisions.**

1. The default rendering is **`popover="auto"` on `content` + CSS anchor
   positioning**, with `@floating-ui/dom` attached only when
   `CSS.supports("anchor-name: --a")` is false or `@position-try` is
   unsupported and a flip is required. The feature-detection seam lives in
   the `anchorPosition` behavior (already its documented design), so
   Combobox declares intent (`placement`, `flip`) and never branches itself.
2. `dismissableLayer` **defers to the popover stack when `popover="auto"` is
   in use** (the platform already routes Escape/outside-press to the topmost
   popover); the behavior then only adds the trigger-exclusion and the
   "pointer inside content" nuance. This is the "behaviors are progressive,
   not always-on" rule made concrete.
3. Rung-zero (no JS, no framework) contract: markup with
   `popovertarget` + `popover="auto"` + anchor CSS gives a **working
   open/close/dismiss/positioned dropdown**, and the `hiddenInput`/`<select>`
   projection makes it **submittable**. Filtering and highlighting are absent
   — accepted, and this is exactly the dormant experience in §8. The CSS-Tags
   contract for us: class/data-attribute hosts (`[data-affe-combobox]`,
   `[data-part="content"]`) styled purely from the foundation stylesheet.
4. `<datalist>` is **rejected** as the styled default but **accepted as the
   documented "you may not need this widget" escape hatch** in the docs page.
5. Native `<select>`-first (the `@stylextras/ui` inversion) applies to
   **Select**, not Combobox: a filterable combobox has no native equivalent,
   so Combobox is legitimately custom above the popover floor. Recorded here
   so K3's Select doc does not re-derive it.

---

## 6. Tokens & variants

Token axes consumed (of the eight independent axes): **color** (surface/border/
`bgSubtle`, `brand` for selected, `dangerBorder` for invalid, with
`*Hover`/`*Active` state suffixes that line up with `data-highlighted`),
**spacing** (control padding, item padding, list gap), **radius** (control,
popup, item), **stroke** (control border, focus ring width), **typography**
(input font, item label, group label), **elevation** (popup shadow), **blur**
(optional popup backdrop), **motion** (popup enter/exit, honoring
`prefers-reduced-motion`). All values via `light-dark()` so a dormant page
follows OS theme with zero JS.

Variant surfaces surveyed: Ark/Zag expose none (headless); Base UI none
(styling is yours); react-aria none; shadcn bakes size/variant into the
copied source (the fork pressure we are removing); `@stylextras/ui` exposes
`size`/`variant`/`sx`.

**Decision — Recipe surface (deliberately small):**

```ts
variants: {
  size:    { sm | md | lg },        // control height, item padding, font
  variant: { outline | subtle | ghost },
  state:   (derived, not authored) // invalid | disabled | open via data-attrs
}
defaults: { size: "md", variant: "outline" }
compound: [{ variant: "ghost", size: "sm", style: {...} }]
```

Anatomy-bound slots for the recipe: `root`, `control`, `input`, `trigger`,
`content`, `listbox`, `item`, `itemIndicator`, `groupLabel`, `empty` — note
`item`/`itemIndicator`/`groupLabel` are **recipe slots without being anatomy
slots** (§1), which is the intended asymmetry: styling structure is finer than
behavioral structure. Rejected: `intent`/color variants (a combobox is not a
button; color belongs to the theme axis), `rounded`/`shadow` per-widget knobs
(radius/elevation are token axes), and any `density` variant (that is the
spacing axis composed per-subtree). Invalid/disabled/open are **data-attribute
states driven by machine tags**, never variants — `Style.bindingConditional`
keys off `data-state="Suggesting|Interacting"` and `data-open`.

---

## 7. API surface comparison

| Concern | Zag/Ark | Base UI | react-aria | shadcn | **Ours** |
| --- | --- | --- | --- | --- | --- |
| open state | `open`/`defaultOpen`/`onOpenChange` | same | `isOpen`? via Popover | local `useState` | `open?: Atom.Writable<boolean>` |
| selection | `value: string[]` | `value` | `selectedKey`/`value` | `value` string | `value?: Atom.Writable<ReadonlyArray<string>>` |
| input text | `inputValue` | `value` (input) | `inputValue` | `search` | `inputValue?: Atom.Writable<string>` |
| items | `collection` object | `items` | `items` + render fn | children | `items: Atom.Readonly<ReadonlyArray<T>>` + `itemToValue` |
| filtering | you filter, `mode` guards | `filter`, `mode`, `limit` | you filter | cmdk internal | `filter?: (item, query) => boolean` (Schema-configured `searchFilter`) |
| multiple | `multiple` | `multiple` | `selectionMode` | recipe | `multiple?: boolean` (value is always an array) |
| custom values | `allowCustomValue` | free by design | `allowsCustomValue` | — | `allowCustomValue?: boolean` |
| post-select input | `selectionBehavior: clear\|replace\|preserve` | — | replace | — | **adopt Zag's three-way verbatim** |
| open trigger policy | `openOnClick`, `openOnChange` | `openOnInputClick` | `menuTrigger: input\|focus\|manual` | — | **adopt react-aria's `menuTrigger`** (one enum beats two booleans) |
| auto highlight | `autoHighlight` | `autoHighlight` | internal | cmdk always | `autoHighlight?: boolean` (default false) |
| inline completion | via `mode: both` | `mode: inline\|both` | — | — | `mode: "none"\|"list"\|"both"\|"inline"` (drives `aria-autocomplete`) |
| loading/async | `SELECTED_ITEMS.SYNC` dance | `Status`, `aria-busy` | `loadingState` | — | items atom is a `ResultAtom` — **loading is Result state, no extra prop** |
| virtualization | consumer | `virtualized` | `Virtualizer` | — | **deferred to K4** (needs `collection` virtual mode) |
| grid layout | — | `grid`, `Row` | — | — | **rejected** (that is `gridNavigation`/its own widget) |
| callbacks | `onValueChange` etc. | `onValueChange` | `onChange` | props | **no callbacks** — atoms are the change channel; `Component.action` for effects |
| form | hidden input | Field integration | `name` | — | `name?: string` + `formControl` behavior |

**Decisions.** Controlled/uncontrolled collapses to **one code path**: every
piece of external state is an optional writable atom; when omitted, the
component creates its own via `Component.state`. There is no `defaultX`/`X`/
`onXChange` triad and no dual internal/external branch — this is the
`controlled-uncontrolled` behavior's entire thesis, and it is why we could
delete Zag's `CONTROLLED.*` events (§2). Renames adopted: Zag's
`highlightedValue` (kept — better than react-aria's "focused key"),
`clearTrigger` (kept), `CHILDREN_CHANGE` → `COLLECTION.CHANGE`. Rejected:
`portal`/`positioner` props, `asChild` (slot remapping covers it),
`onOpenChange` callbacks, Base UI's `limit` (a filter concern), grid mode.

Radix note, since the plan asks: **Radix Primitives has no Combobox and no
Autocomplete.** Its position is that you compose `Popover` + a third-party
command/filter component (cmdk), which is precisely what the shadcn combobox
recipe does — Popover + `Command`, with `Check` indicators and manual
`open`/`value` state in user code. What we take from that: the *pressure*
(shadcn users fork the recipe to change grouping, indicators, empty state,
multi-select badges), which becomes the hostile-customization test list for
K2 — restyle, reslot the item row, swap the filter, swap the machine, all from
outside, over plain imports.

Composition points we publish: headless component + `ComboboxSlots` contract,
the machine definition itself (swappable), each constituent behavior
separately, and the recipe data (`mergeRecipes`-patchable).

---

## 8. Resumability & dormancy

**What snapshots** (§2 state): `value`, `inputValue`, `highlightedValue`,
the state tag (hence open/closed), `currentPlacement`, `mode`. Backed by
`Component.state` holding a `Machine.EncodedSnapshot`, so
`Resume.snapshotState(Machine.EncodedSnapshotSchema)` round-trips with zero
new resume-kernel code.

**What does not**: all DOM handles, the collection/item objects, live-region
node, floating-ui cleanup, timers, pointer-modality flags — re-derived on
activation from the snapshot + the items atom. The `filter` function is
Schema-configured options data (portable by construction) or, if a function
prop, part of the `Portable` captures/bind split.

**Dormant experience (decided, and this is the headline K2 demo):** server
renders the full markup with `popover="auto"` + anchor CSS + the
`hiddenInput`/`<select>` projection. Before any JS: the dropdown **opens,
positions, light-dismisses, and the current value submits in a real form
POST**. Options are all present (unfiltered) and clickable as labels/radios
against the hidden control. Typing filters nothing yet — that is the
activation boundary, and it is honest: the input carries
`aria-autocomplete="none"` until activated, then upgrades to `list`/`both`.

**Activation trigger:** the widget is **addressable and activatable** —
activation is bound to first `input`/`keydown` on the input slot and first
pointer-enter on `content` (both cheap, both pre-JS-observable via the
resume event recorder in `src/resume-event.ts`). The recorded first keystroke
must be replayed after activation, not dropped: **decision — the resume proof
test for K2 is "type a character while dormant, activate, assert the list is
filtered by that character and the caret position is preserved."**

Second resume proof: open the popup while dormant (pure popover), activate,
and assert the machine restores to `Interacting`/`Suggesting` with the popup
still open and `aria-activedescendant` re-established — no flash of closed
state, no setup replay.

---

## 9. Port sources

| From | Artifact | License | Use |
| --- | --- | --- | --- |
| Zag.js | `packages/machines/combobox/src/combobox.machine.ts` | MIT | **primary port** — states, events, guards, actions per §2 (with the context split and the deletions/renames recorded above) |
| Zag.js | `combobox/src/combobox.connect.ts` | MIT | prop-getters → behavior slot attachments; the source of the exact ARIA attribute set in §4 |
| Zag.js | `combobox/src/combobox.dom.ts` | MIT | id conventions + `scrollIntoView` policy (`block: "nearest"`) |
| Zag.js | `utils/dismissable`, `interact-outside`, `aria-hidden` | MIT | already scheduled by the `dismissableLayer`/`interactOutside`/`hideOutside` behavior docs — Combobox consumes, does not re-port |
| Zag.js | `packages/utilities/collection` | MIT | reference for `collection` behavior's value/label/disabled accessors |
| Floating UI | `@floating-ui/dom` | MIT | **dependency, not a port** (fallback path only, per §5) |
| Base UI | `packages/react/src/autocomplete/**/*.test.tsx` and `combobox/**/*.test.tsx` | MIT | **test suites to port** — filtering modes, `autoHighlight`, empty state, `Status`/`aria-busy`, blur-commit-vs-revert, scrollbar-drag-no-close |
| react-aria | `@react-aria/combobox` + `@react-stately/combobox` test suites | Apache-2.0 | **tests + spec only** (note the non-MIT licence: read for behavior, write our own assertions; do **not** copy test source) |
| react-aria | `menuTrigger` semantics, PageUp/PageDown step | Apache-2.0 | spec adoption (§3, §7) — idea, not code |
| WAI-ARIA APG | Combobox pattern + editable-combobox examples | W3C Document Licence | tiebreaker citations; keyboard-map conformance checklist |
| shadcn/ui | combobox recipe (Popover + cmdk) | MIT | **customization-pressure inventory only** → hostile-customization test list (§7). Not a behavior source. |
| `@stylextras/ui` | Combobox notes: native input + `popover=auto` + anchor positioning + `aria-activedescendant` | (per package) | platform-floor design confirmation (§5); no code |

Provenance rules for the port: every ported file carries a header naming the
upstream repo, path, commit SHA, and licence; `NOTICE`/`THIRD_PARTY` entries
for Zag (MIT) and Base UI (MIT); react-aria's Apache-2.0 material is
**read-for-spec only** and must not appear as copied source or copied tests —
recorded explicitly so a later agent does not paste it in.

Gates this widget must pass (same as native machines): state/event/R/E type
tests through define→spawn; Schema round-trip of machine state; the four
`a11y:*` combobox diagnostics; exact-once disposal + no-op double-dispose;
Chromium keyboard test covering the full §3 table including the two APG
divergences (`Home`/`End`, `Escape` two-stage); the two dormant-resume proofs
in §8; the hostile-customization suite from §7; and the `@stylextras/ui`-derived
matrix — reduced motion, forced colors, RTL, 200% zoom, narrow viewport.
