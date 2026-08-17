# Ratification brief — components-lane open questions (2026-08-17)

Prepared in discovery mode after the agent lane closed and the 2026-08-17
issue sweep landed (reactive `whenBinding`, `formControl`, `Theme.lightDark`,
SafeHtml rendering). Ten entries remain open in `components.md`; several
premises have materially changed since they were written (2026-07-30). Each
item below restates the question, what changed, and a recommendation with
premises re-verified today.

This packet is the gateway to the **kit-widget milestone** — the last one in
`future/` (7 reds: `src/kit/` widgets + pattern registry, six-layer exports,
Clock seam, and the three parked DQs below).

Status key: ☐ pending · ✅ ratified · ❌ rejected (edit inline when deciding).

---

## Group A — outcome records (implemented; close with a note)

### ☐ 1. DQ-056 — binding-conditional style subscription and granularity

- **Context change:** the defect half ("`whenBinding` is not reactive") was
  **fixed 2026-08-17** (`59e0f02`), and the fix embodies concrete answers to
  two of the entry's three questions:
  - *What subscribes?* One reactive accessor **per property** (via
    `handle.setStyle`'s reaction), installed only for pieces that actually
    contain a binding conditional; non-conditional pieces keep the cheap
    resolve-once path.
  - *What granularity?* Per property: each accessor re-resolves the slot's
    piece and reads its own key; a branch switching off **unsets** the
    property (the K1 null-unset rule) rather than freezing it.
- **Recommendation:** close DQ-056 with this outcome, recording the third
  question (dormancy: does a binding-conditional style resolve from the
  serialized snapshot at SSR time, and who wins on hydration disagreement)
  as the one **residual**, owned by the resume lane and gated on a consumer
  that actually styles dormant regions from snapshots. Nothing needs it
  today; SSR currently resolves from the live setup bindings, which is
  correct for everything that exists.
- **Cost:** zero code; a Decided-table row.

## Group B — the three parked DQs blocking `future/` reds

### ☐ 2. DQ-063 — CSS-Tags: absorb as `@affe/css` or depend externally?

- **Blocks:** `recipe-merge.spec.ts` (1 of its 2 reds).
- **Premise check:** the entry's deciding fact ("upstream's release cadence
  and API stability, which I did not investigate") has an answer the entry
  never states: **CSS-Tags is this repo's author's own project** (recorded
  in the kit plan's rung-zero notes). "Absorb" is therefore not forking a
  stranger's work, and "depend externally" still couples Theme's typed token
  references (`DQ-061`, built) to names living in a second repo with a
  second release cadence.
- **Recommendation:** **Option 1 — absorb as `@affe/css`**, a workspace
  package beside `@affe/permissive` and `@affe/agent` (the packaging
  playbook now exists and is exercised twice). The token namespace, the
  ratified `@layer` order, and Theme's typed references version together as
  one surface; upstream CSS-Tags remains the design source, absorbed
  deliberately rather than tracked passively. Option 3's mapping layer buys
  insulation this ownership situation does not need, at the cost of two
  names for every token forever.
- **Cost:** package scaffold + stylesheet import surface, sequenced INTO the
  kit milestone (the foundation stylesheet is rung zero under the widgets).

### ☐ 3. DQ-064 — static CSS extraction across cross-module `Style.compose`

- **Blocks:** `recipe-merge.spec.ts` (the other red).
- **Recommendation (= the entry's own):** **Option 1 with the slot as the
  fail-open unit**, stated as a rule an author can predict: *a slot whose
  style value is fully resolvable within its own module is extracted to
  static CSS; any slot whose chain crosses a module boundary is
  runtime-composed, whole.* The slot is already the unit attachment applies,
  and per-slot fail-open keeps the split point statable. One addition since
  the entry: the extraction pass must skip binding-conditional pieces
  entirely (they are reactive per DQ-056's outcome — extracting them would
  re-freeze what was just unfrozen).
- **Sequencing:** ratify the design now; **build in K4**, after the kit
  widgets exist (extraction needs real recipes to extract, and it is the
  performance story, not the correctness story). The spec marker re-points
  from "blocked on DQ-064" to "owned by K4".
- **Cost now:** zero code; the K4 work item gains a decided shape.

### ☐ 4. DQ-070 — slot-as-projection (slot = addressable named region)

- **Blocks:** `slots-and-dynamic-attachment.spec.ts` (its last red).
- **Context change — the hard prerequisite is DONE:** the entry gates
  option 1 on `DQ-050` per-instance handle identity, which landed 2026-08-12
  (`Slots.instantiate`; handles materialize per instance). M11/M11b — the
  other stated sequencing constraint — are also complete, and
  `Resume.installFragment`/`mountFragment` are exactly the consumers that
  want typed named mount targets.
- **Recommendation:** **Option 1, now unblocked** — a slot can emit a
  comment-pair region as itself, unifying the compile-time slot contract
  with runtime resume identity. Sequence as the kit milestone's **final**
  item (after widgets, which exercise the slot surface it builds on), and
  keep the upstream ABI watch (the pinned jsx-runtime-abi test) exactly as
  DIN-11 says — Solid 2.0 projection semantics turning up midway converts
  this into leverage, not a rewrite.
- **Cost:** the largest single item in the milestone (compiler-adjacent);
  everything else in this packet is small by comparison.

## Group C — timing, granularity, and surface-freeze items

### ☐ 5. DQ-066 — behaviour timing seam

- **Blocks (indirectly):** the K3 Clock/Locale marker in
  `services-and-determinism.spec.ts`.
- **Recommendation (= the 2026-08-12 status update, now ratified):**
  (a) `press` gains a `now?: () => number` function-prop seam (default
  `Date.now`) plus a `clickSuppressionMs` Schema knob (default 50) — the
  injected-seam precedent `anchorPosition` set, since behaviour listener
  callbacks are synchronous and cannot read an Effect Clock; (b) the full
  Effect `Clock`/`Locale` SERVICE ships **with K3's first time-holding
  widget** (the spec's own gate) — a service earns its place when a consumer
  holds state across async boundaries, which a 50 ms window does not.
- **Cost:** small (two knobs on press + a deterministic test); the service
  half lands inside the kit milestone.

### ☐ 6. DQ-067 — `collection` invalidation granularity

- **Recommendation (= the 2026-08-12 status update, now ratified):** keep
  the single version counter; finer granularity is a **measurement-gated**
  change per the repo's own precedent (DQ-100/M8d: structural cost gets
  priced by a benchmark before it gets designed). If a real widget shows
  O(items) recompute pain, add a bench lane first, then split (per-item
  disabled epoch vs order epoch).
- **Cost:** zero now; a Decided-table row.

### ☐ 7. DQ-068 — attribute value type and coercion contract

- **Recommendation (= the entry's option 1):** typed attribute tokens with
  per-token value types plus an explicit absence rule, stated once on the
  `Handle` doc comment and honoured by BOTH handle implementations:
  booleans — `false` removes, `true` sets `""`; numbers stringify; absent
  reads return `undefined`; `data-*` remains the string escape hatch. The
  kit's dialog work (which sets `command`/`commandfor`/`aria-*`) is the
  natural place to land it, with a conformance test both renderers share.
- **Cost:** small-medium (token table + two implementations aligned +
  conformance test), inside the kit milestone.

### ☐ 8. DQ-069 — closed-union batch (platformFloor, RecipeSelection, a11y gate)

- **Recommendation (= the entry's own):** closed unions for
  `platformFloor.covers` and the a11y-gate `widgets` array (whose
  `exampleProps` must tie to `PropsOf<component>` — the false-green risk,
  worth doing first); `null` as explicit deselection for `RecipeSelection`
  axes with defaults. All three land naturally with the kit widgets that
  consume them.
- **Cost:** small, inside the kit milestone.

### ☐ 9. DQ-059 + DQ-060 — the shipped setup/render surface and authoring form

Taken together because they freeze the same first-touch surface.

- **Context change since the entries:** `Component.make(setup, view)` — the
  two-argument shorthand with view-inferred props — landed with AN-4 and is
  exercised across the promoted agent tests. It answers DQ-060's open
  question ("find out WHY spec authors reached for positional"): the
  positional form won because the builder required explicit `<Props>` typing
  and four arguments carried two empties; the shorthand removes exactly that
  ceremony.
- **Recommendation:**
  - **DQ-060:** both forms ship with a stated division — the golden path is
    `make(setup, view)` (shorthand) growing into `make(props(), require(),
    setup, view)` only when props validation or requirement tags are
    declared; the `setup()` builder remains the blessed way to AUTHOR the
    setup value either form consumes. Docs and examples standardize on the
    shorthand. (`Component.require`'s global-shadowing name is noted for the
    v1 export audit, not renamed here.)
  - **DQ-059:** two blessed entry points — `setupEffect` and `renderEffect`
    (view-typed results discriminated by the `SlotContract` axis, folding
    `renderViewEffect` in) — with the `…WithBindings` pair demoted to
    `advanced`/internal at the export audit, and one **scoped test helper**
    (`Component.testScope(component, props)`-shaped) replacing the
    thirteen hand-rolled `Scope.makeUnsafe()` sites, so test scopes stop
    being the place lifecycle bugs hide.
- **Cost:** DQ-060 is documentation-only now; DQ-059's helper + fold is a
  small slice inside the kit milestone (its tests are the consumers).

---

**Suggested order:** Group A (free) → 5/6/8 (small) → 2 (package scaffold)
→ 7 → 9 → kit widgets (K3) → 3 build (K4) → 4 (slot-as-projection, last).
Ratifying the whole packet defines the kit milestone's complete work list.
