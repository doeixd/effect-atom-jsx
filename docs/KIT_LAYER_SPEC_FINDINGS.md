# Findings: component / view / slot / style / kit layer

Date: 2026-07-30
Source: writing and then auditing `future/components/*.spec.ts` (54 specs,
19 green / 35 red) against `docs/COMPONENT_KIT_PLAN.md`, the AF-UI contract,
`docs/kit-research/`, and the real source.

Status: findings record. Decisions ratified from this live in
[`COMPONENT_KIT_PLAN.md`](COMPONENT_KIT_PLAN.md) (kit phases) and
[`DESIGN_IMPROVEMENT_NOTES.md`](DESIGN_IMPROVEMENT_NOTES.md) (library-wide);
this file keeps the full evidence and the reasoning, including items too
fine-grained to promote.

---

## 1. Bugs — design decided, code wrong

**1.1 Every catalog behaviour leaks its listeners (highest severity).**
`Element.Handle.on()` registers removal via `onCleanup(...)` → the *reactive
owner*, not the ambient Effect **Scope**. So `Behavior.attachScoped(...)`'s
dispose and `Scope.close` do **not** remove listeners; a `press` behaviour fires
again after dispose. It cleans up only when a reactive render owner happens to
exist — i.e. the DOM mount path — which is why no existing test catches it, and
why the **resume/reattach path leaks by construction**. Contradicts the plan's
headline invariant. Fix: `Effect.acquireRelease` against the ambient Scope,
keeping `listen` as the manual form. 5 reds, one cause.

Everything else in the Scope machinery verified sound: `acquireRelease`,
`forkScoped` interruption, triple-dispose no-op, and `attachScoped`'s
`Exclude<Req, Scope>` cast is genuinely sound (closing the "prove it or document
it" item in `DESIGN_IMPROVEMENT_NOTES.md`).

**1.2 `press()` and `rovingTabindex()` throw on default/partial config.**
`decodeOptions` builds `{ k: undefined }` and feeds it to `Schema.optionalKey`,
which rejects explicit `undefined`. `press()`, `press({ onPress })`, and
`rovingTabindex({ loop: false })` all throw `SchemaError`. Two of the
load-bearing five are unusable as documented, and **neither factory is touched
by any test in `src/__tests__`**. This is what the six `TODO(kit)` comments owe:
defaults belong in the Schema (`withDecodingDefault`), which also preserves the
full unions and deletes the `?? default` ladder; and decode must be fail-closed
*typed*, not a thrown ParseError at factory time.

**1.3 Two instances of one widget share their slot handles.** `Slots.define`
creates handles once at module scope and `View.fromSlots` returns exactly those.
Two mounted Dialogs overwrite each other's attributes/styles/listeners, and
resume identity cannot separate the regions. Verified:
`first.slots.root === second.slots.root`. Needs per-instance materialization.

**1.4 Binding-conditional styles are not reactive.** `Style.whenBinding`
resolves once at attach/view-transform time, so a machine transition does not
restyle. `style.test.ts` only ever compares two *separately constructed*
components, which hides it. Kills the "one reactive substrate from FSM to CSS"
claim.

**1.5 Dynamic attachment ignores capability.** `validateAttachmentBySlots`
checks existence, hidden slots and events but **not capability**: a TextInput
behaviour on a Container slot yields zero diagnostics — the generated path fails
**open**. Compounding it, `Behavior.forSlots(slots)` **discards its `slots`
argument**, so the required capability is retained nowhere; implementing the
diagnostic requires changing `forSlots` too.

**1.6 A machine binding is not collected as a resumable state binding.**
`bind("machine", () => spawn(def), { resume: Machine.snapshotPolicy() })`
collects nothing (`components.c0.bindings === {}`), so `restoreStateBindings`
fails with "missing binding machine". Structurally: the kernel snapshots
bindings that *are* state atoms, and here the atom is a field inside the handle.
It also does not typecheck — `BindingResumePolicy<SpawnedMachine>` is `never`.
The plan's "zero new resume kernel code" claim holds only if the widget binds
`machine.state`. The lower-level round trip **is** green (encode → JSON →
decode → `spawn({snapshot})` restores `Opened{highlighted:5}`), so this is a
component-boundary wiring gap, not a kernel gap. Proposed: `Machine.resumable(def)`
as a binding source, plus a projection policy
`Resume.snapshotVia({ schema, read, restore })`.

---

## 2. Holes — design not decided

**2.1 `Style.mergeRecipes` absent; `recipe` has no `compound`.** The primary
restyle-without-forking axis does not exist, and "compound" has *three* shapes in
play (plan: `compound: [{...axes, style}]`; `Style.variants`:
`compounds: [{when, style}]`; `Style.recipe`: neither). `mergeRecipes` must
deep-merge variant axes **and** validate `defaults` against the widened union, or
it degrades to `RecipeDef<string>` and every downstream selection loses key
checking — pin with a type test. `allowNewSlots: boolean` cannot re-type the
result; a name-carrying `extendRecipeSlots(base, ["footer"] as const)` can.

**2.2 The public `@layer` order exists only in prose.** `Style.layers` is an
identity helper and `inLayer(name: string, …)` takes a bare string, so
`inLayer("compnents", …)` is a silent no-op. Needs a closed tuple of branded
tokens.

**2.3 Theme is single-level and axis layers override instead of merging.** No
two-level palette (semantic tokens naming primitives are not chased, and
`lookupToken` **fails open**, returning its input, so a typo lands in CSS);
`Layer.merge` of two Theme layers yields one winner, so "zinc color + compact
spacing compose freely" is inexpressible; no `Theme.lightDark`.
`ThemeDefinition.path(...)` already exists and is the right primitive — nothing
should be writing raw reference strings.

**2.4 Style and Behavior attach to *different things*.**
`Style.attachToSlots` = `attachByView` (the rendered `View`, and silently a
**no-op** if the view isn't a `View`); `Behavior.attachToSlots` reads
`bindings.slots`. The working shape — `value("slots", () => Slots.handles(A))`
**and** `view: () => fromSlots(A, …)` — is undocumented; get it wrong and
styling vanishes with no diagnostic.

> **Sequencing hazard:** the two paths agree today *only because of bug 1.3*.
> Fixing per-instance handles will **expose** this divergence. Treat 1.3 and 2.4
> as one knot, not two independent fixes.

**2.5 "Mis-wiring is a type error" does not hold.** `attachToSlots` takes the
contract from the **caller**, and the component-side check is name-only
(`SlotsOf<C> extends Record<names, Element.Handle>` — `Handle` is the top of the
lattice). Capability is checked between the behaviour and the caller's argument,
never against the component's published contract. Proposed: derive the contract
from the component and make the remap the only argument —
`Behavior.attachTo(behavior, { container: "root" })`.

**2.6 No typed behaviour-key → slot-name remap.** When names differ (the common
case) the only route is `attachBySlotContract(b, { container: A.bound.root.slot })`,
which needs `as any` and loses `View.Slots` typing. The record branch of
`SlotContractInput` *models* a remap but is undocumented and capability-unchecked.
`attachToSlots`'s `merge?` callback — the only way to avoid a binding-name
collision — is untyped in its return position, so the post-attach `Bindings` axis
is a lie (`Bindings & AddedBindings`). Proposed `{ as: "header_nav" }` for
namespacing.

**2.7 A behaviour's non-element dependencies have no channel.**
`Behavior<Elements, …>` has one input, filled only from slots, so
`formControl({name})` needing a value atom must abandon the typed path for
`Behavior.attach({select})` — the escape hatch the no-fork guarantee exists to
prevent, for the **most common** behaviour shape. Proposed: split
`(elements, deps)` with `attachToSlots(b, remap, { deps })`.

**2.8 `Style.forSlots` — the *recommended* path — erases binding inference.**
`make` returns `ComposedStyle<Slots, BindingNamesOfStyleMap>`; `forSlots` returns
`Bindings = never`, so `StyleBindingCompatible` is vacuous and
`whenBinding("stateTag", …)` is unchecked on the golden path while checked on the
"low-level" one. `whenBinding`'s `predicate: unknown` also has no relation to the
binding's value type.

**2.9 Config mixes wire-serializable options and function props in one flat bag**,
so the portability boundary runs invisibly through the middle of one object
literal. Make it syntactic: `press({ trackPressed: false }, { onPress })`.

**2.10 `Behavior` is not pipeable**, and `compose` is variadic-only up to **three**
members while typing bindings as an *intersection* — even though the runtime is
`Object.assign` last-wins, so the blessed REPLACE path types as a
near-uninhabited intersection.

**2.11 Unexported types.** `RecipeDef`, `VariantDef`, `SlotContractInput`, and
`ElementsForSlotContract` are bare `type`s, so a consumer cannot write
`Style.RecipePatch<typeof kitRecipe>`. `SlotContractInput`/`Names`/`TargetNames`
are **duplicated verbatim** in `Style.ts` and `Behavior.ts`.

**2.12 Double-attach is silent** — duplicate listeners, no diagnostic, not
idempotent. Marked `unbuilt`; policy undecided.

**2.13 Six overlapping component entry points**
(`setupEffect`/`renderEffect`/`renderViewEffect`/`renderWithBindings`/
`renderViewWithBindings`/`validateRenderedSlotContract`) with nothing in the
naming to distinguish them; `renderWithBindings` returned a non-`View` even for a
`fromSlots` view. Also: the project docs name the `setup()` builder as preferred,
yet every spec needed the four-positional-argument `make(props(), require(), …)`
form. Decide which the kit ships — a spec is also documentation.

**2.14 Unbuilt by decision:** K0c `Mixin`; static CSS extraction (must preserve
cross-module `compose`, fail open); CSS-Tags absorb-vs-depend (token-namespace
*ownership*); slot-as-projection (DIN-11 — note it **requires fixing 1.3
first**); and the whole `src/kit/*` tier including `dismissableLayer` +
`DismissLayerStack` and `anchorPosition` (load-bearing behaviours #4 and #5).

---

## 3. Coverage gaps identified but not yet written

Ranked:

1. **`collection` has zero executable coverage** — the plan's "most load-bearing
   invisible piece", and its "tests day one" list is entirely untouched.
2. **`SafeHtml` branding** — "unbranded strings render as text, never as HTML, by
   construction" is asserted nowhere in the repo.
3. **The a11y matrix** — reduced motion, forced colors, RTL, zoom;
   `roving-tabindex.md` lists RTL horizontal as day-one.
4. **Controlled/uncontrolled `bindable`** — one mechanism, no
   `value`/`defaultValue` split.
5. **`liveAnnounce` as a mockable service.**
6. **`presence`** — close → still mounted until `animationEnd`; reduced motion
   skips `Exiting`.
7. **Injected Clock/Locale determinism.**
8. **Tree-shakeability / no-barrel-export.**
9. **Marker-preserving source + foreign-buildId rejection.** (Confirmed absent:
   the only `buildId` use is an incidental test parameter.)

---

## 4. Smaller items worth deciding later

- `press` uses wall-clock `Date.now()+50` for click suppression, while the plan
  says timing should be Effect-built and interruptible.
- `press`'s keyup branch needs a truth table.
- `rovingTabindex` writes attributes with `Effect.runSync` inside a plain
  callback.
- `collection` bumps a version atom, so **any** item change invalidates **every**
  derived value.
- `Element.getAttr/setAttr` are `unknown`-typed, so every read casts, with no
  value-coercion contract.
- `compose` merges duplicate `provides` keys last-wins with **no conflict
  diagnostic**, though the plan says "prefer no silent conflict".
- **`Component.state` inside a behaviour ties widget state to the *behaviour's*
  scope, so the blessed "replace the behaviour" path silently resets state.**
  This is a direct hole in the no-fork story and deserves promotion.
- `platformFloor.covers` needs a closed union, or `covers: ["focus-trapp"]`
  passes forever.
- The a11y-gate `widgets` array must tie `exampleProps` to `PropsOf<component>`,
  or the gate can be satisfied by a mismatched pair.
- `RecipeSelection` is all-optional, so an axis with a default cannot be
  explicitly deselected.

---

## 5. Suggested sequencing

1. **1.1** (`Element.on` → Scope) — first, before more behaviours inherit it.
2. **1.2** (Schema defaults) — unblocks two of the load-bearing five.
3. **2.4 + 1.3** together (attach target + per-instance handles) — one knot;
   DIN-11 depends on it, and fixing 1.3 alone exposes 2.4.
4. **K1 block** (2.1–2.3) — the largest red mass.
5. **1.4** (reactive binding-conditional styles).
6. **1.6** (machine resume wiring).
7. **1.5 + 2.12** (capability validation, double-attach policy).
8. The `src/kit/*` tier, with `Mixin` last.

---

## 6. Audit round applied to the specs

The specs were reviewed against this file's own standards and corrected:

- **Retagged** four generic Scope specs `[K0b]` → `[AF-UI]` — they exercise
  `src/Behavior.ts` primitives, not the catalog convention, so as tagged they
  falsely implied K0b was incomplete.
- **Removed over-reach**: `mergeRecipes`'s signature is an explicit open
  question, so the unknown-slot spec now asserts only *"never silently
  succeeds"* (throw, type error, or diagnostic all pass) and the widening API
  became `unbuilt`; the `@layer` spec no longer invents the consumer layer name.
- **Fixed three specs that were red for the wrong reason**: malformed-config now
  isolates the malformed field; the recipe harness no longer reads styles from a
  *closed* scope (a false green the day style teardown lands); the token specs
  now point implementers at Theme **layer composition** rather than
  `lookupToken`.
- **Killed two vacuous assertions**: the machine-in-behaviour spec now counts
  listener invocations — it previously passed regardless of the 1.1 leak and now
  correctly detects it; the wire-serializability spec now asserts no options
  field *accepts* a function, instead of re-testing `Schema.Struct`'s own
  key-dropping.
- **Added negative controls** wherever an always-report implementation would
  pass: capability-mismatch, slot drift, `allowHidden`; plus a new
  `a11y:missing-slot-event` spec (deleting that whole branch of `A11y.validate`
  previously went unnoticed), per-member exact-once disposal in `compose`, and a
  plain-`state` control binding in machine-resume so an empty manifest can only
  mean the machine binding was skipped.
- **Fixed contradictions**: the dismissable-layer specs now provide **one** stack
  service to both layers (the old form built two services and could only pass
  with a module global — the exact cross-request bleed the `future/README.md`
  calls out), plus a new two-subtree isolation spec; `formControl` now specs a
  *structural* hidden-input slot and a writable `invalid` atom instead of a
  stringly-typed `nativeHtml` plus imperative `setInvalid`.
- Strengthened the commit-boundary specs (typed failure vs defect;
  style-applies-and-attaches-last), renamed two specs whose titles over-claimed
  what runtime can check, and fixed encoding damage.
