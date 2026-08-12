# Components lane — triaged design questions (`DQ-050`–`DQ-079`)

Slots, views, styles, behaviors, kit. Triaged 2026-07-30 from
`docs/KIT_LAYER_SPEC_FINDINGS.md` §2/§2.14/§4, `docs/COMPONENT_KIT_PLAN.md`
"Open questions" 7–11, `docs/DESIGN_IMPROVEMENT_NOTES.md` items 11–21, and the
`unbuilt(...)` calls in `future/components/*.spec.ts`.

Ordered by severity. `§1` defects from the findings file are **not** duplicated
here except where a real choice sits behind them (see the last section).

## Summary

| ID | Question | Severity | Owning plan |
| --- | --- | --- | --- |
| DQ-056 | What subscribes to a binding-conditional style, and at what granularity? | deferrable | `COMPONENT_KIT_PLAN.md` (seq. step 5) |
| DQ-059 | What is the shipped component setup/render surface, and does the library owe a scoped test helper? | deferrable | DIN-20 |
| DQ-060 | `setup()` builder or positional `make(props(), require(), …)` — which ships? | deferrable | DIN-20 |
| DQ-061 | How does Theme express a two-level palette across layers? | deferrable | DIN-18 / K1 |
| DQ-062 | What is the slot-widening form for recipes? | deferrable | `COMPONENT_KIT_PLAN.md` K1 |
| DQ-063 | CSS-Tags: absorb as `@affe/css` or depend externally? | deferrable | `COMPONENT_KIT_PLAN.md` OQ-8 |
| DQ-064 | How does static CSS extraction survive a cross-module `Style.compose` chain? | deferrable | `COMPONENT_KIT_PLAN.md` OQ-9 |
| DQ-066 | Where does interruptible behaviour timing come from? | deferrable | `COMPONENT_KIT_PLAN.md` K0b |
| DQ-067 | What is `collection`'s invalidation granularity? | deferrable | `COMPONENT_KIT_PLAN.md` K0b |
| DQ-068 | What is the attribute value type and coercion contract? | deferrable | DIN-17 |
| DQ-069 | Batch: three closed-union / exhaustiveness tightenings. | cosmetic | `COMPONENT_KIT_PLAN.md` §4 items |
| DQ-070 | Does a slot become an addressable named region (slot-as-projection)? | deferrable | DIN-11 |

---



## Decided — promoted into the owning plan

Closed entries stay listed here (never renumbered) so a `DQ-nnn` cited anywhere
still resolves. The decision and its rejected alternatives live in the plan.

| ID | Decision | Ratified in |
| --- | --- | --- |
| DQ-050 | The rendered `View` is the single source of truth. `Slots.define` returns a contract/factory; handles materialise **per instance**; `bindings.slots` becomes a projection. | `COMPONENT_KIT_PLAN.md` — "the attachment knot" |
| DQ-051 | The capability contract comes from the **component**: `Behavior.attachTo(behavior, remap)`. `forSlots` retains its contract. Backstops (drift diagnostic + runtime capability check) land **first**. | `COMPONENT_KIT_PLAN.md` — "the attachment knot" |
| DQ-052 | Split `(elements, deps)` with a `{ deps }` attach option for caller-supplied values **and** resolution from component bindings for behaviour-to-behaviour. Rejected `Req`-as-service: loses per-instance identity. | `COMPONENT_KIT_PLAN.md` |
| DQ-053 | Behaviours declare state in `provides`; the attach machinery materialises it in the **component's** scope. Matching shape reuses the atom; a mismatch is a **diagnostic**, never a silent reset. Depends on `DQ-057`. | `COMPONENT_KIT_PLAN.md` |
| DQ-054 | Delete `Style.forSlots`; fold contract-awareness into one `make` that keeps binding inference. Full slot coverage is **opt-in** exhaustive, not default-required. | `COMPONENT_KIT_PLAN.md` |
| DQ-055 | `Resume.snapshotVia({schema, read, restore})` is the primitive (it generalises to every handle-shaped binding, incl. `DQ-053` state); `Machine.resumable(def)` is sugar on it. Interim: bind `machine.state`. | `COMPONENT_KIT_PLAN.md` |
| DQ-058 | Double-attach is LEGAL but reported: attach records behaviour identity + elements, a repeat emits `component:duplicate-attachment` through the opt-in diagnostics reporter, and nothing is ever silently de-duplicated. | implemented in `src/Component.ts` (`recordBehaviorAttachment`), tested in `src/__tests__/lifecycle-disposal.test.ts` |
| DQ-057 | Last-wins TRUTH types: variadic `compose` over a tuple with `MergeAll` bindings (later keys override), `provides`/`events`/`emits` stay last-wins with a `behavior:provides-override` diagnostic through the DQ-058 reporter channel (report, never block). Deps stay intersection (inputs). Pipe landed. Rejected: intersection-with-conflict-errors — it outlaws the sanctioned REPLACE path. | ratified 2026-08-12, `COMPONENT_KIT_PLAN.md` K0b |
| DQ-065 | Option 1 confirmed and DISCHARGED: the five factories were fixed first and now prove the boilerplate; `Mixin` (K0c) proceeds, extracted from the working shape — it must collapse the three observed repetitions (factory name, doubled witness names, options pick-list) and desugar to the same Schema+Behavior patterns, never a second runtime. | ratified 2026-08-12, `COMPONENT_KIT_PLAN.md` K0c |
| DQ-071 | `presence` packages as option 1: a `ReducedMotion` Context service (boolean reader, static default `false`, `Layer`-swappable per subtree) + `PresenceOptions` Schema for per-instance knobs; bindings are `isPresent` + `phase` (machine handle stays internal); the `animationend` listener attaches to the single `root` element. | ratified 2026-08-12, `COMPONENT_KIT_PLAN.md` K0b item 6 |
| DQ-072 | `LiveAnnouncer` is option 1: one `announce(message, politeness?)` method; clear-after-timeout is the LAYER's policy (`makeLiveAnnouncer({ clearAfterMs })`); a mock Layer captures `[message, politeness]` tuples. Queue handles deferred until a consumer needs backpressure. | ratified 2026-08-12, `COMPONENT_KIT_PLAN.md` K0b item 5 |






## DQ-056 — What subscribes to a binding-conditional style, and at what granularity does it restyle?

- **Severity:** deferrable
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` (findings §5 sequencing step 5)
- **Raised:** 2026-07-30, from findings §1.4 — the defect is clear, the design is not

**What I was doing.** Separating the defect ("`whenBinding` is not reactive")
from the question ("what should be reactive, and how").

**What is undecided.** `Style.whenBinding` (`src/Style.ts:342-360`) produces a
`BindingConditionalPiece` whose predicate is evaluated **once**, at attach /
view-transform time. A machine transition therefore does not restyle.
`style.test.ts` only ever compares two *separately constructed* components,
which is why nothing catches it. The defect is agreed; three design questions
are not:

- **What subscribes?** The style attachment (one subscription per attached
  style), the slot handle (one per slot), or the individual conditional piece
  (one per `whenBinding`)?
- **What granularity of update?** Recompute and reapply the whole slot's style
  object, or diff to the properties the conditional piece contributes?
- **What happens while dormant?** A resumed-but-not-yet-hydrated region has
  bindings that exist only as serialized snapshots. Does a binding-conditional
  style resolve from the snapshot at SSR time (so the dormant DOM is already
  correctly styled and hydration is a no-op), and if the snapshot and the live
  binding disagree on hydration, which wins?

**Why it matters.** "One reactive substrate from FSM to CSS" is a headline
claim; today an FSM transition changes no CSS. But the defect can be fixed
crudely (subscribe per attachment, reapply the whole slot) without deciding
granularity, so this is deferrable — it must be settled before the styling
surface freezes at K1, and the dormancy question must be settled before it can
interact with resume correctly.

**Options.**

1. **Per-attachment subscription, whole-slot recompute.** One reactive scope per
   attached style; on any tracked binding change, recompute every slot's style
   value and reapply. *Cost:* over-invalidation — one binding change rewrites
   unrelated slots; churn on the DOM style surface. *Buys:* simplest correct
   thing; no diffing machinery; matches how `Style.compose` already folds.
2. **Per-piece subscription, property-level patch.** Each
   `BindingConditionalPiece` owns a subscription and toggles exactly the
   properties it contributes. *Cost:* needs a property-ownership model so two
   pieces contributing the same property resolve deterministically — i.e. it
   re-litigates cascade precedence at runtime. *Buys:* minimal DOM writes;
   composes with the `@layer` story.
3. **Compile the conditional into a CSS class/attribute toggle.** The
   conditional piece becomes a static rule keyed on a data attribute; the
   subscription only writes the attribute. *Cost:* only works for predicates
   expressible as a finite set of states (fine for a machine's state tag, not
   for an arbitrary `(value) => boolean`); needs the static extraction pass
   (DQ-064). *Buys:* one attribute write per transition; the cascade does the
   rest; and it is the only option where the *dormant* case is free, because
   SSR emits the attribute and the CSS is already loaded.

**Recommendation.** Option 3 for the state-tag case with option 1 as the
fallback for arbitrary predicates — and make the typed-witness change from
DQ-054 first, because a predicate with a known value type is what makes "is this
predicate a finite state discriminator?" answerable. Option 3 also resolves the
dormancy question by construction, which neither of the others does. If DQ-064
(static extraction) stalls, ship option 1 as the defect fix and record that the
granularity question is still open.

**Related.** DQ-054 (typed predicate), DQ-064 (static extraction), the
resumability lane for dormancy semantics, findings §1.4.

---

## DQ-057 — `compose`: last-wins or intersection, what happens to conflicting `provides`, what arity, and is `Behavior` pipeable?

> **RATIFIED 2026-08-12** — option 1 per the status update below: last-wins truth types (`MergeAll` over a variadic tuple), `behavior:provides-override` diagnostic via the DQ-058 reporter channel, deps stay intersection, pipe already landed. Decision row in the Decided table; implementation is the K0b compose-types slice.

- **Severity:** deferrable
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` K0b
- **Raised:** 2026-07-30, from findings §2.10 and §4

**What I was doing.** Checking `Behavior.compose` against the plan's REPLACE
customization path and the catalog convention.

**What is undecided.** Four coupled facts in `src/Behavior.ts:431-470`:

- **Types say intersection, runtime says last-wins.** The overloads produce
  `B1 & B2` / `B1 & B2 & B3` (`:434`, `:439`) while the implementation merges
  returned bindings with `Object.assign` semantics. So the blessed REPLACE path
  — compose the default with an override contributing the same binding name —
  types as a near-uninhabited intersection while behaving correctly at runtime.
- **`provides` merges last-wins with no conflict diagnostic** (`:454-456`:
  `{ ...metadataProvides, ...behavior.metadata.provides }`), though the plan
  says "prefer no silent conflict". Same for `events` and `emits`.
- **Arity is capped at three.** Only two overloads exist (`:431`, `:435`); the
  implementation is variadic, so a fourth member falls to the `any` signature
  and loses all typing.
- **`Behavior` is not pipeable** — there is no `pipe` on the interface
  (`src/Behavior.ts:22-36`), though the catalog convention requires it and
  components have it (`src/Behavior.ts:494-498` pipes the *component*).

**Why it matters.** REPLACE is the sanctioned customization move, so the type of
`compose` is the type consumers meet first. But the runtime is correct, so
nothing is broken today — this must be settled before the catalog surface
freezes.

**Options.**

1. **Last-wins types matching the runtime.** A `MergeAll<[B1, B2, …]>` helper
   where later keys override earlier ones; make `compose` genuinely variadic
   over a tuple; add `pipe`. Make duplicate `provides` a **diagnostic** (not a
   type error) since last-wins is now intentional. *Cost:* the mapped tuple
   type is the kind of thing that shows up in typecheck budgets (the plan
   already flags this for `Mixin`). *Buys:* types tell the truth; REPLACE has a
   real type; arity cap gone.
2. **Intersection types, and make conflicts illegal.** Keep `&`, but reject
   composing two behaviours that contribute the same binding name — a type
   error, with an explicit `Behavior.override(base, replacement)` for the
   REPLACE case. *Cost:* two functions where authors expect one; REPLACE stops
   being "just compose". *Buys:* no silent overriding at all, which is the
   plan's stated preference; simpler types.
3. **Last-wins runtime, conflicts are a hard error at attach time.** Keep the
   intersection type as an approximation but throw/fail typed on a duplicate.
   *Cost:* an unsound type plus a runtime failure is the worst of both.
   *Buys:* nothing. Listed to be dismissed.

**Recommendation.** Option 1, with **one exception**: make duplicate `provides`
keys a type error rather than a diagnostic when the *value types differ*, and
last-wins-with-diagnostic when they match. That is what makes DQ-053's
state-hoisting safe — silently taking the wrong owner's atom is exactly the
failure mode there. Add `pipe` regardless; it is unconditional and required by
the catalog convention.

**Related.** DQ-053 (`provides` is the state-identity channel), DQ-052 (deps
must merge too), DQ-065 (`Mixin` has the same precedence problem, and the plan
already demands property tests for it), findings §2.10/§4.

**Status update (2026-08-12) — two of the four sub-questions are settled by
landed work; a firm recommendation for the rest.**

- **Pipeability: DONE.** `Behavior` has `pipe` (non-enumerable, re-attached at
  every construction site); the catalog authors with
  `make(...).pipe(provides(...))`.
- **Deps: settled by `DQ-052`, and intersection is CORRECT there.** `compose`
  types member deps as `D1 & D2` and forwards ONE deps object to every
  member — unlike bindings, deps are inputs, so intersection tells the truth.
- **Remaining: bindings/provides precedence and arity.** Recommend **option 1**
  (last-wins types matching the runtime), with the evidence that option 2 is
  now unaffordable: the five landed factories all publish fixed `provides`
  contracts, so REPLACE-by-compose (the plan's sanctioned customization move)
  necessarily collides on binding names — making collisions a type error would
  outlaw the blessed path. Concretely: a `MergeAll` tuple type over a variadic
  `compose`, and a `behavior:provides-override` diagnostic through the SAME
  opt-in reporter channel `DQ-058` established (report, never block) when a
  later member overrides an earlier `provides` key. The `DQ-058` precedent is
  the tiebreaker the original entry lacked: "legal but reported" is now the
  house pattern for suspicious-but-sanctioned composition.

---

## DQ-058 — Is double-attach a type error, a runtime diagnostic, or legal?

- **Severity:** deferrable — **RESOLVED (verified 2026-08-12): option 1 is implemented and tested.** `Component.withBehavior` records behaviour identity + selected elements per instance (`recordBehaviorAttachment`, `src/Component.ts`) and a repeat attach of the same behaviour to the same elements emits `component:duplicate-attachment` through the opt-in diagnostics reporter — reported, never de-duplicated. Pinned by `src/__tests__/lifecycle-disposal.test.ts` (fires on repeat, silent when clean). The row moved to the Decided table.
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` "Open questions" 10
- **Raised:** 2026-07-30, from findings §2.12
- **Blocks specs:** `future/components/lifecycle-disposal.spec.ts:243`
  (`unbuilt("double-attach detection", …)` — should be re-pointed at `DQ-058`)

**What I was doing.** Triaging the `unbuilt` call in the disposal spec.

**What is undecided.** Attaching the same `Behavior` twice to the same slot
installs duplicate listeners, with no diagnostic, and is not idempotent.
Whether that is legal is undecided. Note the plan's own framing: re-piping an
assembled default **is** the sanctioned customization path, which makes
double-attach the likeliest way to do it by accident.

**Why it matters.** Needed before K3 (assembled defaults). Not blocking now
because nothing depends on the answer yet — but a duplicated `press` handler
firing twice is indistinguishable from a bug in the behaviour.

**Options.**

1. **Runtime diagnostic via the existing `validateAttachment*` channel.**
   Behaviour identity + slot name recorded at attach; a repeat emits
   `component:duplicate-attachment`. *Cost:* needs a stable behaviour identity
   (a symbol on the value; `compose` must derive one from its members); catches
   it late. *Buys:* uniform with the other attachment diagnostics; works for
   the generated/dynamic path where types cannot.
2. **Type error via attachment identity in the slot contract.** Track attached
   behaviour identities in the component's type so a second attach of the same
   behaviour to the same slot fails to typecheck. *Cost:* a new accumulating
   type axis on `Component` — five parameters already — and it cannot see
   through the dynamic path anyway. *Buys:* prevention.
3. **Legal, documented, and idempotent-by-declaration.** Behaviours declare
   `stackable: true | false` in metadata; the framework de-duplicates
   non-stackable ones and permits stacking where declared. *Cost:* the metadata
   field must be right on every catalog behaviour, and "de-duplicate" needs a
   rule for differing configs (`press({onPress: a})` then
   `press({onPress: b})` — same behaviour, different config). *Buys:* the only
   option that acknowledges some behaviours legitimately stack.

**Recommendation.** Option 1 now, option 3's `stackable` declaration later if a
genuine stacking case appears. Option 2's cost is out of proportion: it adds a
type axis to catch a mistake that a diagnostic catches at the first render, and
it is blind on exactly the path (generated/dynamic) where the mistake is most
likely. Define the de-duplication question explicitly as out of scope for
option 1 — the diagnostic reports, it does not de-duplicate.

**Related.** DQ-051 (same validation channel), findings §2.12,
`COMPONENT_KIT_PLAN.md` OQ-10.

**RATIFIED 2026-08-12** (user-approved via TRIAGE-2026-08-12.md): option 1 — a runtime
`component:duplicate-attachment` diagnostic through the existing attachment
validation channel, keyed on behavior identity + slot name. De-duplication is
explicitly out of scope (the diagnostic reports, it does not fix); option 3's
`stackable` metadata waits for a genuine stacking case.

---

## DQ-059 — What is the shipped component setup/render surface, and does the library owe a scoped test helper?

- **Severity:** deferrable
- **Owning plan:** DIN-20
- **Raised:** 2026-07-30, from findings §2.13

**What I was doing.** Counting the entry points the spec suite needed.

**What is undecided.** Six overlapping entry points with nothing in the naming
to distinguish them: `setupEffect` (`src/Component.ts:1065`), `renderEffect`
(`:1074`), `renderViewEffect` (`:1102`), `renderWithBindings` (`:1124`),
`renderViewWithBindings` (`:1141`), `validateRenderedSlotContract` (`:914`).
Nothing tells a consumer when `renderEffect` applies versus `renderViewEffect`.
Separately, **thirteen** spec files hand-roll `Scope.makeUnsafe()` +
`Effect.provideService(…, Scope.Scope, scope)`.

**Why it matters.** This is the surface every consumer touches first, and it
freezes at the export audit. The hand-rolled `Scope` plumbing is itself a
correctness hazard — it is how the missing-reactive-owner listener leak (DIN-12)
went unnoticed for so long, because hand-rolled scopes have no reactive owner
and nobody noticed that mattered.

**Options.**

1. **Two entry points, discriminated by the type axis.**
   `Component.setup(component, props): Effect<Bindings, E, Req | Scope>` and
   `Component.render(component, props, bindings?)`, with View-typed results
   distinguished by the component's `SlotContract` axis rather than by method
   name. *Cost:* the return type becomes conditional on `SlotContractOf<C>`,
   which is harder to read in errors. *Buys:* two names instead of six; the
   distinction lives where the information already is.
2. **Keep the six, add naming discipline and docs.** Rename to a scheme that
   says what varies (`renderTo…`, `…WithBindings`) and document a decision
   table. *Cost:* six entry points remain six. *Buys:* no breaking change.
3. **One entry point plus options.**
   `Component.run(component, props, { bindings?, validate? })`. *Cost:* an
   options bag is where type inference goes to die; `bindings?` and the return
   type are correlated. *Buys:* minimal surface.

**Recommendation.** Option 1, and **yes** — ship the scoped test helper.
`Component.scoped(effect)` or a `testing.ts` export that builds a `Scope` *and*
a reactive owner is owed, precisely because the missing-owner case is a real
failure class that hand-rolling hides. That helper is arguably the more valuable
half of this entry.

**Related.** DQ-060 (the authoring-form half of DIN-20), DIN-12 (the leak the
hand-rolling hid), DIN-20, findings §2.13.

---

## DQ-060 — Does the finished library ship the `setup()` builder or the positional `make(props(), require(), …)` form?

- **Severity:** deferrable
- **Owning plan:** DIN-20
- **Raised:** 2026-07-30, from findings §2.13 ("a spec is also documentation")

**What I was doing.** Reconciling the documented preferred authoring path with
what the spec suite actually needed.

**What is undecided.** `AGENTS.md` and `CLAUDE.md` name
`Component.setup<Props>()` + `bind`/`value`/`doEffect`/`use` as the preferred
authoring path. **Every** spec in the suite used the four-positional-argument
`make(props(), require(), setup(), view)` form instead. Both work today, and the
docs and practice disagree. Also `Component.require` (`src/Component.ts:627`)
shadows a well-known global.

**Why it matters.** Two blessed spellings means examples, generated code, and
agent-written code diverge, and the ecosystem forks on style before it exists.
Low urgency, but this is the first thing anyone writes.

**Options.**

1. **Builder ships; positional becomes internal.** *Cost:* the specs — the most
   honest evidence of what is ergonomic — are all in the other form, which is
   weak evidence *against* the builder. Someone must find out *why* spec authors
   reached for positional; if it was inference quality, that is a real defect in
   the builder. *Buys:* named arguments, incremental construction, and it is
   what the docs already say.
2. **Positional ships; builder is removed.** *Cost:* four positional arguments
   with two of them frequently empty is exactly the readability problem the
   builder was introduced to solve. *Buys:* matches every existing spec and
   example; one form.
3. **Both ship, with a stated division.** Positional for simple components,
   builder when setup has ≥N bindings or needs names. *Cost:* the status quo
   with a rationale attached; agents will still pick inconsistently. *Buys:*
   honest if the two really do serve different sizes.

**Recommendation.** Do not decide this without first answering *why* every spec
used positional — that fact is the only real data here, and it may be reporting
a builder inference bug rather than a preference. If the builder's inference is
sound, take option 1 and mechanically convert the specs (which is also a good
test of the builder). Rename `Component.require` regardless — shadowing a
well-known global is not defensible in either option; `Component.needs` or
`Component.requires` both work.

**Related.** DQ-059, DIN-20.

---

## DQ-061 — How does Theme express a two-level palette when layers compose?

- **Severity:** deferrable
- **Owning plan:** DIN-18; kit phase K1
- **Raised:** 2026-07-30, from findings §2.3

**What I was doing.** Checking whether the kit's "raw palette → semantic
derivation" token architecture is reachable.

**What is undecided.** It is not, as two layers. `ThemeService` is a single
`Context` service holding a single tokens schema (`src/Theme.ts:15-21`), and
`define(...).layer()` builds a **complete** service (`src/Theme.ts:97-108`), so
`Layer.merge` of a palette layer and a semantic layer yields **one winner**.
"Zinc color + compact spacing compose freely" is therefore inexpressible.
Adjacent facts (recommendations already recorded in DIN-18, restated here only
because they constrain the choice): `lookupToken` **fails open**, returning its
input on a miss (`src/Theme.ts:93`), so `"color.blu500"` lands inert in the
emitted CSS; `resolve: (token: string) => string` (`:18`) is stringly-typed both
ways; `ThemeDefinition.path(...)` (`:31-34`) already exists and is the right
primitive.

The genuine choice: **is theme composition a Layer-level operation at all?**

**Options.**

1. **`Theme.extend(palette, (p) => …)` producing one merged layer.** Composition
   happens at *definition* time; the Layer is always a complete service. *Cost:*
   an author cannot mix two independently-published themes without a definition
   site that knows both — so "zinc + compact from two packages" needs a third
   module. *Buys:* typed references via `p.path(...)`; one service; no
   Layer-merge semantics to invent.
2. **Make `ThemeService` merge-aware.** The service holds a *stack* of token
   scopes; `Layer.merge` of two Theme layers concatenates rather than replaces,
   and lookup walks the stack. *Cost:* invents merge semantics for a `Context`
   service against Effect's grain — last-wins is the Layer contract; order
   becomes load-order-dependent, which is exactly the surprise Layer avoids.
   *Buys:* independently-published themes compose without a coordinating module.
3. **Split into two services.** `PaletteService` and `SemanticTokensService`,
   composed by construction: the semantic layer *requires* the palette layer.
   *Cost:* fixes the depth at two — a third level needs a third service; and
   spacing vs color are not levels, they are *categories*, so this doesn't
   actually solve "zinc + compact". *Buys:* uses Layer requirements as intended;
   the dependency is explicit and typed.

**Recommendation.** Option 1 for levels (palette → semantic), and address
"zinc + compact" as a **category** problem rather than a layer problem — those
two vary along different axes and should be separate token categories inside one
definition, not two competing services. Do not take option 2: making
`Layer.merge` mean something non-standard for one service will cost more in
confusion than it buys. Fix the fail-open `lookupToken` independently — it is a
defect, already recorded in DIN-18, and worth doing regardless of this decision.

**Related.** DQ-062, DQ-064, DIN-18, findings §2.3.

---

## DQ-062 — What is the slot-widening form for recipes?

- **Severity:** deferrable
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` K1 (the `mergeRecipes` *signature* was ratified 2026-07-30; widening was not)
- **Raised:** 2026-07-30, triaging the `unbuilt` in `recipe-merge.spec.ts`
- **Blocks specs:** `future/components/recipe-merge.spec.ts:180`
  (`unbuilt("recipe slot widening", …)` — should be re-pointed at `DQ-062`)

**What I was doing.** Triaging the recipe-merge spec's `unbuilt`, which cites
"`mergeRecipes` exact signature is explicitly undecided" — but the plan has
since ratified the signature, leaving only the widening question.

**What is undecided.** How a consumer's merged recipe gains a slot the base
recipe did not declare. A boolean `allowNewSlots` **cannot re-type the result**:
the merged recipe would be `RecipeDef<string>` and every downstream
`RecipeSelection` loses key checking. The findings propose a name-carrying
`extendRecipeSlots(base, ["footer"] as const) -> RecipeDef<"root" | "footer">`.
Undecided: whether widening is a separate operation or a parameter of the merge,
and whether widening also requires widening the *component's* slot contract
(which is where the new slot must actually render).

**Why it matters.** Restyle-without-forking is the primary no-fork axis; adding
a slot is the case that most obviously needs it. Deferrable because K1 has
larger red mass ahead of it, but the merge surface freezes together.

**Options.**

1. **Separate name-carrying operation.** `Style.extendRecipeSlots(base, names)`
   then `mergeRecipes`. *Cost:* two calls for one intent. *Buys:* types are
   exact; `mergeRecipes` stays closed-world and its key checking stays strict.
2. **Widening as a typed parameter of the merge.**
   `mergeRecipes(base, patch, { addSlots: ["footer"] as const })`. *Cost:* the
   merge's return type becomes conditional on an options field, which reads
   poorly in errors. *Buys:* one call.
3. **No widening.** A patch may only restyle declared slots; a new slot means a
   new recipe (and a new component, since the slot must render somewhere).
   *Cost:* narrows the no-fork story. *Buys:* nothing to design, and it is
   arguably *honest* — a recipe cannot conjure a DOM node.

**Recommendation.** Option 1, but note the constraint option 3 exposes: a
widened recipe is only useful if the component's slot contract can also accept
the slot, which is a `View.Slots` question, not a `Style` one. Pin whichever is
chosen with a **type test** asserting the merged result is
`RecipeDef<"root" | "footer">` and not `RecipeDef<string>` — the degradation is
silent otherwise. Keep the spec's current assertion ("never silently succeeds")
until then.

**Related.** DQ-050 (slot contracts), DIN-16 (`RecipeDef` is unexported, so
this cannot be type-tested by a consumer today), findings §2.1.

---

## DQ-063 — CSS-Tags: absorb as `@affe/css` or depend on it externally?

- **Severity:** deferrable
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` "Open questions" 8 (carried from rung zero)
- **Raised:** 2026-07-30, triaging the `unbuilt` in `recipe-merge.spec.ts`
- **Blocks specs:** `future/components/recipe-merge.spec.ts:284`
  (`unbuilt("CSS-Tags foundation stylesheet", …)` — re-point at `DQ-063`)

**What I was doing.** Triaging a plan-level open question that a spec is
blocked on.

**What is undecided.** Whether the foundation stylesheet is absorbed into the
`@affe/*` workspace or consumed as an external dependency. The plan records the
crux as **token-namespace ownership**: whoever ships the foundation owns the
token names the kit's recipes and Theme resolve against.

**Why it matters.** It determines whether Theme's token categories (DQ-061) are
ours to define or ours to mirror, and whether a breaking change upstream is our
breaking change. Not blocking — no code depends on it yet — but it should be
settled before Theme's token architecture is built on top of a namespace we may
not own.

**Options.**

1. **Absorb as `@affe/css`.** Vendor and re-publish under our namespace.
   *Cost:* we inherit maintenance and divergence from upstream. *Buys:* token
   namespace is ours; Theme, recipes, and the `@layer` order are one coherent
   surface we can version together.
2. **Depend externally.** *Cost:* token names, layer names, and the upgrade
   cadence are someone else's; a breaking upstream change breaks the kit's
   recipes. *Buys:* no maintenance; upstream fixes arrive free.
3. **Depend externally, but define our own token namespace that maps onto it.**
   *Cost:* a mapping layer to maintain, and two names for every token. *Buys:*
   insulation — upstream changes hit the mapping, not the recipes.

**Recommendation.** Option 3 if the upstream is actively maintained, option 1 if
it is not. The deciding fact is upstream's release cadence and API stability,
which I did not investigate — that is what would settle this. Do not take
option 2: DQ-061 will make Theme's typed token references depend on the
namespace, and typed references to names we do not own is a version-coupling
trap.

**Related.** DQ-061, DQ-064, `COMPONENT_KIT_PLAN.md` OQ-8.

---

## DQ-064 — How does static CSS extraction survive a `Style.compose` chain spanning two packages?

- **Severity:** deferrable
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` "Open questions" 9
- **Raised:** 2026-07-30, triaging the `unbuilt` in `recipe-merge.spec.ts`
- **Blocks specs:** `future/components/recipe-merge.spec.ts:277`
  (`unbuilt("static style extraction pass", …)` — re-point at `DQ-064`)

**What I was doing.** Triaging the extraction `unbuilt`, whose stated
constraints are "must not break cross-module `Style.compose`" and "fail open to
runtime CSS".

**What is undecided.** The plan states the stability guarantee but no extraction
design shows how a compose chain spanning two packages survives the pass. The
extractor sees one module at a time; `Style.compose` folds pieces that may be
imported from a package built separately (and possibly published as JS with the
compose already partially applied). Undecided: what the unit of extraction is,
and what "fail open" means concretely — per-declaration, per-slot, or
per-component.

**Why it matters.** It is the performance story for the styling layer, and it
constrains DQ-056 (option 3 there *requires* extraction). Deferrable: nothing
depends on it until K4.

**Options.**

1. **Extract per-module, emit a runtime merge for anything crossing a module
   boundary.** Each module's own pieces become static CSS; a cross-module
   compose falls back to runtime composition for the crossing part only.
   *Cost:* two mechanisms live simultaneously, and the split point is invisible
   to authors, so performance becomes hard to reason about. *Buys:* honest
   fail-open at the finest useful granularity; no whole-program requirement.
2. **Whole-program extraction at the app build.** The app's bundler sees every
   package and extracts the fully-folded result. *Cost:* requires a build
   integration and defeats library pre-compilation; a package cannot ship
   extracted CSS. *Buys:* maximal extraction; one mechanism.
3. **Extraction only for `Style.make`/recipe *literals*; `compose` is always
   runtime.** *Cost:* leaves the composed path — the interesting one — dynamic.
   *Buys:* trivially sound; a clear, statable rule authors can predict.

**Recommendation.** Option 1, with the fail-open unit being the **slot**: a slot
whose style value is fully resolvable within the module is extracted, otherwise
that slot is runtime-composed. A slot is the right granularity because it is
already the unit the attachment applies. Whatever is chosen, the guarantee must
be *stated as a rule an author can predict*, not as "the extractor does its
best" — the current phrasing is the latter.

**Related.** DQ-056 (option 3 depends on this), DQ-063, `COMPONENT_KIT_PLAN.md`
OQ-9.

---

## DQ-065 — Does K0c `Mixin` land before or as the fix to the three hand-written factories?

> **RATIFIED 2026-08-12** — option 1 confirmed and its precondition discharged (all five factories fixed first). `Mixin` proceeds per the plan's K0c design, extracted from the working factory shape; it must collapse the three repetitions listed in the status update and desugar to Schema+Behavior — never a second runtime.

- **Severity:** deferrable
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` "Open questions" 7
- **Raised:** 2026-07-30, triaging the `unbuilt` in `behavior-catalog.spec.ts`
- **Blocks specs:** `future/components/behavior-catalog.spec.ts:412`
  (`unbuilt("Mixin.create/toBehavior fragment merge", …)` — the plan owns this
  one; keep the plan-item owner and cite `DQ-065` in the plan instead)

**What I was doing.** Triaging the `Mixin` `unbuilt`, whose stated gate is
"after 2–3 hand-written factories prove the boilerplate".

**What is undecided.** The gate's premise is no longer true. The three factories
that exist (`src/behaviors/collection.ts`, `press.ts`, `roving-tabindex.ts`) are
partly broken (`press` and `rovingTabindex` throw on default/partial config —
findings §1.2) and **none** uses the ratified two-argument config split. So they
do not currently prove the boilerplate honestly. Does fixing them come first, or
does the fix land *as* the Mixin migration?

**Why it matters.** Sequencing only — but the wrong order wastes work: fixing
three factories in a form Mixin will replace, or designing Mixin against
boilerplate that the fix would have changed.

**Options.**

1. **Fix the three first, then extract Mixin from the fixed shape.** *Cost:* the
   Schema-defaults and config-split work is done three times by hand and then
   partly discarded. *Buys:* Mixin is extracted from *working* code, which is
   the only way the "prove the boilerplate" gate means anything; the two known
   defects get fixed on the near-term path rather than behind a new abstraction.
2. **Land the fix as the Mixin migration.** *Cost:* Mixin is designed against
   boilerplate that was never actually written correctly, so it may miss the real
   repetition; and two known-broken factories stay broken until a large new
   abstraction lands. *Buys:* the work is done once.
3. **Fix one factory by hand, then Mixin the other two.** *Cost:* an awkward
   middle. *Buys:* one honest datapoint for the boilerplate at ~1/3 the
   duplicated effort.

**Recommendation.** Option 1. The findings' own sequencing puts the config-defaults
fix at step 2 (it "unblocks two of the load-bearing five") and Mixin **last**;
that ordering is right for an independent reason — the plan's own K0c acceptance
criteria demand *property tests on fragment precedence*, and you cannot
property-test a merge whose inputs are broken. Two of the load-bearing five
being unusable-as-documented is a bigger cost than doing the boilerplate twice.

**Related.** DQ-057 (fragment precedence has the same last-wins-vs-error
question), findings §1.2/§5, `COMPONENT_KIT_PLAN.md` OQ-7 and the K0c
acceptance additions.

**Status update (2026-08-12) — Option 1's precondition is now satisfied, and
the boilerplate is proven.** All FIVE load-bearing factories exist fixed and
working (`collection`, `press`, `rovingTabindex`, `dismissableLayer`,
`anchorPosition`), each hand-written in the same shape:
`Behavior.make(...)` + `Behavior.decodeOptions(name, Schema, picks)` +
`.pipe(Behavior.provides({...}))`. The shared repetition Mixin should
collapse, observed across all five: (a) the factory name is restated as
`decodeOptions`'s first argument; (b) every `provides` witness spells its
binding name twice (`Behavior.binding<"isPressed", T>("isPressed")` — a typo
between the two compiles); (c) the options pick-list restates the Schema's
field names. A ratified Mixin (or a thinner `Behavior.catalog` convention)
should infer all three from one declaration. This is input to the
ratification, not a decision.

---

## DQ-066 — Where does interruptible behaviour timing come from?

- **Severity:** deferrable
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` K0b
- **Raised:** 2026-07-30, from findings §4

**What I was doing.** Checking `press`'s click-suppression window against the
plan's claim that timing should be Effect-built and interruptible.

**What is undecided.** `press` uses wall-clock arithmetic:
`ignoreClickUntil = Date.now() + 50` (`src/behaviors/press.ts:131`), read back at
`:180` (`if (Date.now() < ignoreClickUntil) return;`). The plan says behaviour
timing should be Effect-built and interruptible; the findings' §3 coverage gap
also asks for injected-Clock determinism. Undecided: what the mechanism is.

**Why it matters.** Wall-clock reads are untestable without faking global time,
non-deterministic under load, and not interruptible — so the suppression window
survives disposal. It is also the pattern the next four behaviours will copy.

**Status update (2026-08-12) — recommendation grounded in landed precedent.**
The catalog now has an established answer for environment the runtime cannot
own: the INJECTED SEAM (`anchorPosition`'s `measure`/`autoUpdate`; behaviour
listener callbacks are synchronous, so an Effect `Clock` cannot be read
inside them anyway). Recommend: (a) `press` gains a function-prop seam
`now?: () => number` (default `Date.now`) plus a Schema knob
`clickSuppressionMs` (default 50) — deterministic tests inject a fake `now`,
matching rule-of-thumb 2 ("overridable algorithm step → function prop");
(b) the full Effect `Clock`/`Locale` SERVICE question stays owned by K3's
DatePicker gate, exactly as `services-and-determinism.spec.ts` already
declares — a service earns its place when a consumer holds state across
async boundaries, which a 50 ms suppression window does not.

**Options.**

1. **Effect `Clock` from context, read via `Effect`.** Suppression becomes a
   clock read inside the behaviour's effect. *Cost:* the click handler is a
   plain DOM callback, so reading the clock there needs a sync escape or the
   handler must become an Effect — which is the broader "callbacks vs Effects at
   the DOM boundary" question. *Buys:* deterministic under a `TestClock`; one
   mechanism for all timing.
2. **`forkScoped` a fibre that clears a flag after a `sleep`.** Interruptible by
   construction — scope close cancels the window. *Cost:* a fibre per press;
   the flag is still read synchronously from the callback. *Buys:* correct
   interruption semantics; no wall-clock.
3. **Keep wall-clock, inject a `now()` for tests.** *Cost:* still not
   interruptible; two time sources. *Buys:* minimal change, testable.

**Recommendation.** Option 2 for the *window* (it is the only one that gets
interruption right, and scope-close cancelling the suppression window is the
correct semantics), with the flag remaining a synchronously-readable cell. Note
this exposes a real question option 1 raises and 2 dodges: **whether DOM event
handlers are plain callbacks or Effects** — `rovingTabindex` already calls
`Effect.runSync` inside a plain callback, which is the same seam. If that turns
out to need a general answer, this entry should be widened rather than
answered locally.

**Related.** DQ-067, findings §4, findings §3 item 7 (injected Clock/Locale
determinism).

---

## DQ-067 — What is `collection`'s invalidation granularity?

- **Severity:** deferrable
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` K0b
- **Raised:** 2026-07-30, from findings §4

**What I was doing.** Reading `collection`, the plan's "most load-bearing
invisible piece".

**What is undecided.** `collection` holds a single version counter —
`const version = yield* Component.state(0)` (`src/behaviors/collection.ts:85`),
bumped on any change (`:89`) and tracked by every derived read (`:101`). So
**any** item change invalidates **every** derived value: focus index, the
enabled subset, the typeahead index, all of it. Undecided: whether that is the
intended trade-off, and if not, what the finer granularity is.

**Why it matters.** `collection` underlies `rovingTabindex`, typeahead, and
selection; over-invalidation there is O(items) recompute per keystroke in a long
list. It also has **zero executable coverage** today (findings §3 item 1), so
there is no measurement either way.

**Status update (2026-08-12) — recommendation.** Keep the single version
counter for K0b and make finer granularity a MEASUREMENT-GATED change: the
repo's own precedent (`DQ-100`, the M8d row-marker lane) is that structural
cost questions get priced by a benchmark before they get designed. Concretely:
(a) coverage exists now (`collection-behavior.test.ts` plus the catalog
specs) but no perf characterization; (b) if a real widget shows O(items)
recompute pain (long listbox + typeahead is the likely reproducer), add a
`vitest bench` lane and only then split the counter (per-item disabled epoch
vs order epoch is the natural split). Deciding granularity now would be
designing ahead of the measurement the repo's culture requires.

**Options.**

1. **Keep the version counter; declare it intentional.** *Cost:* recompute cost
   scales with derived-value count on every mutation. *Buys:* trivially correct;
   no invalidation bugs, which for the load-bearing invisible piece is worth a
   lot.
2. **Per-item atoms plus a structural version.** Item identity/content changes
   invalidate only that item's dependents; insert/remove bumps the structural
   version. *Cost:* real complexity, and the classic source of stale-derived
   bugs; needs stable item identity, which is its own question. *Buys:* keystroke
   cost independent of list length.
3. **Keep the counter, add memoised derived values keyed on the inputs they
   actually read.** *Cost:* memo-key design; still recomputes the key.
   *Buys:* most of option 2's benefit without restructuring the store.

**Recommendation.** Option 1 until there is a measurement — but **write the
tests first**: `collection` having zero coverage is the bigger problem, and any
granularity change without them is unsafe. Then measure with a list long enough
to matter (the plan's own a11y matrix implies large lists) and take option 3 if
it does. Record the current behaviour as an explicit, documented trade-off so it
is not mistaken for an oversight.

**Related.** DQ-066, findings §3 item 1, findings §4.

---

## DQ-068 — What is the attribute value type and coercion contract?

- **Severity:** deferrable
- **Owning plan:** DIN-17
- **Raised:** 2026-07-30, from findings §4

**What I was doing.** Reading specs that assert `aria-invalid === true`
(boolean) next to `tabIndex === 0` (number).

**What is undecided.** `getAttr(name: string): unknown` and
`setAttr(name: string, value: unknown | (() => unknown))`
(`src/Element.ts:21-22`) force a cast at every read, and **no coercion contract
is stated anywhere**. The test-handle implementation stores whatever it is given
verbatim (`src/Element.ts:184-196`) while a DOM renderer must stringify. Two
renderers can both be "correct" and disagree — which means a spec passing
against test handles proves nothing about the DOM.

DIN-17 records the recommended shape (key to `View.AttributeName` tokens with
declared value types, state the rule once in the `Handle` doc comment). What is
genuinely undecided is the *semantics*: does `setAttr("hidden", false)` remove
the attribute or set it to `"false"`? Does `getAttr` on an absent attribute
return `undefined`, `null`, or `""`? Those three choices are where renderers
actually diverge, and the token typing does not answer them.

**Why it matters.** Every spec and renderer written before it is settled encodes
an assumption, and the assumptions are currently *different* between the two
handle implementations we have.

**Options.**

1. **Typed tokens with per-token value types, plus an explicit absence rule.**
   Booleans: `false` removes, `true` sets `""`. Numbers stringify. Absent reads
   return `undefined`. *Cost:* the token table must be maintained and covers only
   known attributes — `data-*` needs an escape. *Buys:* renderers are *required*
   to agree; specs become meaningful.
2. **`string | undefined` only; callers coerce.** *Cost:* pushes stringification
   to every call site, which is where it will be done inconsistently.
   *Buys:* one obvious contract, zero table.
3. **Keep `unknown`, state the coercion rule in prose and conform the test
   handle to it.** *Cost:* no type-level help; drift returns the moment a third
   handle appears. *Buys:* cheapest; fixes the actual divergence.

**Recommendation.** Option 1's *semantics* with option 2's *type* as the
starting point: type `getAttr` as `string | undefined` and `setAttr` as
`string | number | boolean | null | undefined` with the boolean/absence rules
above documented on `Handle`, and add the token table later if per-attribute
value types earn their keep. Conform the test handle to the rule immediately —
that is the part that makes existing specs mean something, and it is cheap.

**Related.** DIN-17, findings §4.

---

## DQ-069 — Batch: three closed-union / exhaustiveness tightenings

- **Severity:** cosmetic
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` §4-derived items
- **Raised:** 2026-07-30, batching findings §4's small typing items

**What I was doing.** Triaging the small items so they are not twelve entries.

**What is undecided.** Three independent small choices, each of the same shape
(a stringly/optional surface that should be closed), batched because they should
be decided in one pass:

1. **`platformFloor.covers` needs a closed union.** It is asserted only in
   `future/components/a11y-and-native-floor.spec.ts:158-165` and there is no
   type behind it, so `covers: ["focus-trapp"]` would pass forever. Choice:
   a closed string union of platform-floor concerns, or branded tokens as with
   the `@layer` names.
2. **`RecipeSelection` is all-optional** (`src/Style.ts:1090-1092`:
   `{ readonly [K in keyof D["variants"]]?: … }`), so an axis with a default
   cannot be **explicitly deselected** — `{ size: undefined }` is
   indistinguishable from omission, and `:1103` merges defaults over the
   selection, so the default always wins. Choice: add an explicit `"none"`
   member per axis, accept `null` as "deselect", or declare that axes with
   defaults are always active.
3. **The a11y-gate `widgets` array must tie `exampleProps` to
   `PropsOf<component>`**, or the gate is satisfiable by a mismatched pair —
   a passing a11y gate that tested the wrong props.

**Why it matters.** Each is individually small; (3) is the one that can produce a
*false green*, so it is the one worth doing first even though the batch is
cosmetic.

**Options.** Per item, the choice is stated inline above. The batch-level choice
is only whether to close these with unions (cheap, immediate) or with branded
tokens (consistent with the `@layer` token direction, more machinery).

**Recommendation.** Closed unions for (1) and (3) now — both are additive and
neither has a consumer to break. For (2), accept `null` as explicit deselection
and change the merge at `src/Style.ts:1103` to treat a present-but-`null` key as
overriding the default; adding a `"none"` member per axis pollutes every
variant table. Do (3) first: a gate that can pass on the wrong input is a
correctness problem wearing a cosmetic label.

**Related.** findings §4.

---

## DQ-070 — Does a slot become an addressable named region (slot-as-projection)?

- **Severity:** deferrable
- **Owning plan:** DIN-11 (design direction recorded; sequencing deliberately deferred)
- **Raised:** 2026-07-30, triaging the `unbuilt` in `slots-and-dynamic-attachment.spec.ts`
- **Blocks specs:** `future/components/slots-and-dynamic-attachment.spec.ts:251`
  (`unbuilt("slot-as-projection-element", …)` — currently owned by DIN item 11;
  keep that owner, cite `DQ-070` for the sequencing constraint)

**What I was doing.** Triaging the projection `unbuilt` and checking its stated
prerequisite.

**What is undecided.** Whether `View.Slots` gains an explicit projection element
(`<Slot.render name="…"/>`-shaped) that makes child evaluation lazy at
placement and lets a slot emit a comment-pair region **as itself** — unifying
the compile-time slot contract with runtime resume identity, and giving M11b
typed named mount targets. DIN-11 records the direction and the reasons; the
decision and its timing are open, and it is explicitly sequenced after
M11/M11b.

The constraint worth recording here, and the reason this entry exists rather
than only the DIN item: **it requires per-instance handle identity first**
(DQ-050). "Mount fragment into slot `body`" has no unique referent while
`Slots.define` binds one handle per slot at module scope
(`src/View.ts:603-620`). So DQ-050 is a hard prerequisite, not an adjacent
concern.

**Why it matters.** It is the safe path to lifting the "slots do not identify
DOM nodes" non-goal, and it is the seam M11b and M8c both want. Nothing is
blocked today.

**Options.**

1. **Build it after M11/M11b, on per-instance handles.** *Cost:* a compiler-
   adjacent change; projection semantics may land upstream in
   babel-plugin-jsx-dom-expressions as Solid 2.0 stabilises, so we may build
   then migrate. *Buys:* one identity for compile-time slots and runtime
   regions.
2. **Keep slots compile-time-only; give regions their own naming.** Regions and
   slots stay separate namespaces with an explicit mapping. *Cost:* two naming
   systems for the same anatomy, and the mapping is authored by hand.
   *Buys:* no compiler exposure; the ABI watch-item stops mattering.
3. **Wait for upstream.** Track the babel plugin and adopt projection when it
   ships. *Cost:* indefinite; our resume identity story stays split meanwhile.
   *Buys:* no forced migration.

**Recommendation.** Option 1, but do not start it before DQ-050 lands — and
track the upstream ABI event (pinned by the existing jsx-runtime-abi test) as
DIN-11 already says, because it turns option 1 into either leverage or a forced
migration. Re-point the spec's `unbuilt` owner once DQ-050 is decided.

**Related.** DQ-050 (hard prerequisite), DIN-11, DIN-19, findings §2.14.

---

## Deliberately not entered here

These came up in the sources and are **defects with a decided design**, not open
questions. They are recorded where noted; they must not be re-litigated as
questions.

- **`Element.Handle.on()` cleans up via the reactive owner, not the Scope**
  (findings §1.1, `DESIGN_IMPROVEMENT_NOTES.md` item 12,
  `src/Element.ts:170-176`). Highest-severity defect in the lane; the fix
  (`Effect.acquireRelease` against the ambient Scope) is decided.
- **`press()` / `rovingTabindex()` throw on default or partial config**
  (findings §1.2). Fix decided: defaults in the Schema via
  `withDecodingDefault`, fail-closed *typed* decode.
- **Shared slot handles across instances** (findings §1.3, DIN-19) — the defect
  is recorded; the *sequencing choice* it forces is DQ-050.
- **`whenBinding` is not reactive** (findings §1.4) — defect recorded; the
  granularity/dormancy design is DQ-056.
- **`validateAttachmentBySlots` ignores capability** and **`Behavior.forSlots`
  discards its `slots` argument** (findings §1.5, DIN-21) — fix decided
  (retain the contract; compare with `Element.extendsCapability`,
  `src/Element.ts:146`); the *surface* question is DQ-051.
- **Unexported customization types and the verbatim `SlotContractInput`
  duplication** between `src/Style.ts:16-24` and `src/Behavior.ts:75-84`
  (findings §2.11, DIN-16). DIN-16 records a clear recommended shape (hoist to
  one module, re-export) with no remaining choice; folded into the M9 export
  audit there.
- **`inLayer(name: string, …)` accepts any string**, so `inLayer("compnents", …)`
  is a silent no-op (findings §2.2). The plan **ratified** the CSS layer naming
  and the consumer layer name on 2026-07-30, so what remains is enforcing a
  decided design with branded tokens — a defect, not a question.
- **Behaviour config split** (findings §2.9, `press({opts}, {props})`) — also
  ratified in the plan's pruning on 2026-07-30.
- **`Theme.lookupToken` fails open** (`src/Theme.ts:93`) — independent
  silent-failure bug with an obvious fix; recorded in DIN-18. Noted as a
  constraint inside DQ-061, not entered as a question.
- **`press`'s keyup truth table** and **`rovingTabindex`'s `Effect.runSync`
  inside a plain callback** (findings §4) — the first needs writing down, not
  deciding; the second is subsumed by the callback/Effect seam raised inside
  DQ-066.
- **Coverage gaps** (findings §3: `collection`, `SafeHtml` branding, a11y
  matrix, controlled/uncontrolled `bindable`, `liveAnnounce` mockability,
  `presence`, Clock/Locale determinism, tree-shakeability, marker-preserving
  source) are *unwritten tests*, not undecided design. They belong in `future/`
  or the plan. `bindable`'s controlled/uncontrolled split is the closest to a
  question — it is a `value`/`defaultValue` API choice — but no call site has
  hit it yet; raise it when one does.

---

## DQ-071 — Where does `presence`'s reduced-motion input enter, and what is its catalog contract?

> **RATIFIED 2026-08-12** — option 1 (the provisional pick): `ReducedMotion` Context service + `PresenceOptions` Schema; `isPresent`/`phase` bindings; `root` listener.

- **Severity:** deferrable
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` K0b mandated coverage items 6 and 9
- **Raised:** 2026-08-12, triaging the last red in `future/components/presence.spec.ts`
- **Blocks specs:** `future/components/presence.spec.ts` "catalog packaging"
  (`unbuilt("behaviors/presence as a Schema-option catalog behavior…", "K0b")`)

**What I was doing.** The presence machine's semantics are green (Exiting parks
until animationEnd; reduced motion force-unmounts; dispose aborts). The
remaining red is packaging it as `src/behaviors/presence.ts`, and the spec
itself declares the packaging design undecided.

**What is undecided.**

1. **Where reduced motion enters.** A `PresenceOptions` Schema field, or a
   `ReducedMotion` Context service provided per subtree. The services-not-
   globals house rule and the a11y matrix (reduced motion as a *testable
   dimension*) both point at the service, but no such service exists in `src/`
   and nothing else consumes it yet.
2. **The element contract and published bindings.** Which slot the
   `animationend` listener attaches to (`root`? the exiting content?), and
   whether consumers read `isPresent`, `phase`, or the raw machine handle.

**Why it matters.** The first `ReducedMotion` consumer sets the pattern every
motion-sensitive behavior copies; a Schema-field choice here would make the
a11y matrix untestable without config plumbing at every call site.

**Options.** (1) `ReducedMotion` service with a static default layer +
`PresenceOptions` for the rest of the knobs. (2) Schema field only. (3) Both,
field overriding service.

**Provisional pick.** Option 1 — matches `DismissLayerStack`'s precedent
(service for cross-cutting environment, Schema for per-instance knobs) and
keeps reduced motion a swappable test dimension. Bindings: `isPresent` +
`phase` (machine handle stays internal), listener on the single `root` slot.
Not built pending ratification.

**Related.** DQ-066 (behavior timing source), the a11y matrix row, the
services-not-globals house rule.

**Evidence update (2026-08-12).** The green presence-machine specs already
treat reduced motion as an INJECTED INPUT read at transition time
(`presenceMachine({ reducedMotion })`, `presence.spec.ts:26-29`) — the
machine semantics were deliberately written so either packaging satisfies
them. The service pick therefore costs nothing at the machine layer; the
whole decision is the catalog-surface contract. `DismissLayerStack` (landed)
is the service template: tag + `layer` constructing fresh state per
provision. Ratifying option 1 means: `ReducedMotion` service with a
`Layer.succeed`-able boolean-reader interface and a static default of
`false`, `PresenceOptions` Schema for the remaining knobs.

---

## DQ-072 — What is the `LiveAnnouncer` service interface, and who owns clear-after-timeout?

> **RATIFIED 2026-08-12** — option 1 (the provisional pick): one `announce(message, politeness?)` method; timeout policy on the Layer maker.

- **Severity:** deferrable
- **Owning plan:** `docs/COMPONENT_KIT_PLAN.md` K0b mandated coverage item 5
- **Raised:** 2026-08-12, researching the `unbuilt` in `services-and-determinism.spec.ts`
- **Blocks specs:** `future/components/services-and-determinism.spec.ts`
  (`unbuilt("behaviors/live-announce: the LiveAnnouncer service…", "K0b")`)

**What is undecided.** The research doc (`live-announce.md`) decides the
architecture — `LiveAnnouncer` Context service + Layer, one region per
document, polite/assertive queues, clear message after timeout — but not the
interface: `announce(message, politeness)` as one call, or queue handles with
separate `polite`/`assertive` writers? And whether clear-after-timeout is the
service's policy (a duration knob on the Layer) or the caller's.

**Why it matters.** This is the concrete proof of the services-not-globals
house rule (kit services swap wholesale in tests with no DOM), and the second
service after `DismissLayerStack` — together they set the template.

**Options.** (1) One `announce(message, politeness?)` method, timeout policy
owned by the Layer (`makeLiveAnnouncer({ clearAfterMs })`), mock Layer
captures `[message, politeness]` tuples. (2) Two queue handles
(`polite.write`, `assertive.write`). (3) One method now, handles later if a
consumer needs backpressure.

**Provisional pick.** Option 1 — mirrors `DismissLayerStack` (behavioural
methods on one service object; construction-time policy on the maker), and
the research doc's own test sketch ("Layer mock captures announcements") is
the option-1 shape. Not built pending ratification.

**Related.** DQ-071 (same service-template decision), the services-not-globals
house rule, `live-announce.md`.
