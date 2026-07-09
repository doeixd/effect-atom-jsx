# Current Status In Redesign Plan

Last updated: 2026-07-09 (release hardening pass)
Plan reference: `docs/DESIGN_OVERHAUL_V1_PLAN.md`, `docs/V1_API_CONTRACT_DRAFT.md`, `docs/EFFECT_NATIVE_ENHANCEMENT_PLAN.md`, `docs/new_ideas.md`

V1 scope authority (**ratified 2026-07-06**): `docs/V1_SCOPE.md`

Current AF-UI source of truth: `docs/AF_UI_CONTRACT.md`

Current slot-design plan: `docs/SLOT_CONTRACT_UNIFICATION_PLAN.md`

Slot contract golden path: `docs/SLOT_CONTRACT_GOLDEN_PATH.md`

Current optimistic/action design plan: `docs/OPTIMISTIC_ACTION_DESIGN_PLAN.md`

Component ownership model: `docs/PROPS_BINDINGS_SLOTS.md`

Component state ownership: `docs/COMPONENT_STATE_OWNERSHIP.md`

Async binding boundary: `docs/BINDINGS_ASYNC_COMMIT_BOUNDARY.md`

Setup/view comparison: `docs/SETUP_VIEW_COMPARISON.md`

Component setup builder plan: `docs/COMPONENT_SETUP_BUILDER_PLAN.md`

## Overall

- Redesign is actively in progress; breaking-change-first to reduce API
  overlap and legacy aliases.
- **`V1_SCOPE.md` is ratified** and is the triage authority. All 10
  release-blocking items are now **done**: the ergonomics/typesafety set
  (Findings 1/2/4/6, P2, D1, S1–S4, F6), Finding-3 (2-tier attach model),
  Finding-5 release-blocking core (unified `Result` on loader surfaces), and
  **P6 routing consolidation** (the `Route`-vs-`AppRouteNode` overload seam
  landed on `main` via commit `2e53de0`). What remains is non-blocking
  cleanup + v1.x proposals — see "What remains" under **In Progress / Next**.
- **All five quality gates are green** (verified 2026-07-09):
  `npm run typecheck`, `npm test` (**570 passing**, 36 files),
  `npm run build`, `npm run typecheck:tests` (`src/__tests__` /
  `tsconfig.tests.json` — **0 errors**, down from 40→9→0), and
  `npm run typecheck:examples` (`examples/` — **0 errors**, down from ~61→0).
  `npm run typecheck:all` runs all three tsc gates; `npm run check` adds the
  test run. The test and example gates are now enforced (commits `beac192`,
  `dd657bf`).
- The "finish the plan" + readiness passes fixed a genuine SSR XSS, **six**
  real library bugs surfaced by the test gate, and several DX/setup bugs
  (no JSX types shipped; `render` not top-level; wrong babel `moduleName`) —
  all detailed in `docs/archive/REDESIGN_COMPLETED_LOG.md`. The routing
  dual-representation seam (`Route` vs `AppRouteNode`) that previously blocked
  the test/example gates was the last convergence point; it is resolved and
  the branch work is merged.
- **Release hardening follow-up done 2026-07-09:** replaced the remaining
  concrete no-op/stub seams found in the API audit. `Behaviors.focusTrap(...)`
  now performs tab/shift-tab focus cycling against an optional focusable
  collection; `Style.globalLayer(...)` now publishes a `GlobalStyleService`
  with resolved global styles and an optional apply hook; advanced
  renderer-neutral style descriptors (`__media`, `__pseudo`, etc.) are
  preserved on handles instead of silently dropped; router `preload(...)`
  warms matched loaders without navigation; and `Route.lazy(...)` now loads on
  demand, exposes `preload()`, and updates through signals. Focused regression
  tests were added in `behavior.test.ts`, `style.test.ts`, `route.test.ts`, and
  `route-loader.test.ts`.

## Current Goals

1. Make the inside-out model real in code:
   - `Component<Props, Req, E, Bindings, SlotContract> -> View<Slots>`
   - `View.Slots` is the authored structural contract
   - `Component.SlotsOf<T>` is the runtime handle-map projection
   - styles and behaviors attach to slots from outside through slot-contract-first APIs
2. Keep the implementation incremental while still aiming at the right design:
   - keep current JSX returns working while the typed view path becomes primary
   - move authored code away from `bindings.slots`
   - keep string slot maps only as dynamic/generated APIs
   - add view metadata before attempting typed JSX/compiler holes
3. Adapt useful ideas from `../gen2` without transplanting its generator IR:
   - slot metadata
   - hidden slots
   - slot remapping
   - safe HTML brand
   - attachment diagnostics
   - platform/event/attribute metadata
   - capability compatibility diagnostics
4. Keep quality gates green:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`

## Completed So Far

The full landed-work log (2026-03 through 2026-07-06, ~860 lines) moved to
[`docs/archive/REDESIGN_COMPLETED_LOG.md`](archive/REDESIGN_COMPLETED_LOG.md)
as part of the PR2 plan-doc consolidation.

High-level state of what has landed:

- Atom core redesign: callable atoms, `A/E/R` type axes, `Atom.runtime`,
  query/action/optimistic primitives, families, schema validation, pipeable
  policies, legacy alias/wrapper removal, export tiering.
- Unified `Result` promoted as the primary async model (`FetchResult` demoted
  to compatibility; consolidation completion is tracked as Finding 5).
- Reactivity service (`live`/`test`), `tracked`/`invalidating`, atom/loader
  key integration.
- Component system: setup-as-Effect + optional setup builder, state ownership
  helpers, scope/lifecycle boundaries, transforms (`withLayer`, `guard`,
  etc.).
- Slot contracts: `View.Slot`/`View.Slots` witnesses, `View.fromSlots`,
  `Component.withSlots`, capability hierarchy, hidden slots/remaps, typed
  tree slice, platform/style/behavior metadata witnesses and diagnostics.
- Style system (tokens, variants, recipes, advanced descriptors) and behavior
  system (`forSlots`, events metadata, behavior pack, combobox composable).
- Routing: route-node model, loaders with SWR cache, single flight
  (transport-aware), `ServerRoute` + document rendering, `RouterRuntime`
  foundation, SSR/hydration bridge.
- Docs modernization passes aligning README/API/plan docs to current names.

For any "when/how did X land" question, consult the archive log.

## Design Review Findings (2026-07-06)

An external-perspective design review of the current AF-UI model (slot
contracts, setup ownership, attachment APIs, runtime subsystems) confirmed the
architecture direction but identified concentrated risk in authoring
ergonomics and unfinished consolidation. These findings define the next
workstream. Verdict summary: the slot contract as a shared witness, semantic
reactivity keys, platform-support-as-data, and requirement subtraction via
`Component.withLayer(...)` are the strongest parts of the design; the risks
are cost-per-component and API redundancy, not soundness.

### Finding 1 — Golden-path authoring cost is too high (highest priority)

A labeled text field currently takes ~40 lines across `View.Slot.make` x3,
`View.Slots.make`, `Component.make`, `Component.withSlots`, and separate
style/behavior attachments before any real logic. The contract pays for itself
for design-system components, but most app UI is one-off structure that will
never be externally styled or re-behaviored.

Direction:

- Target: the golden-path Field example compresses to roughly 15 lines without
  losing the contract.
- Add contract-inferring sugar so slot witnesses do not require three separate
  declarations plus a bind map plus a `withSlots` pipe (candidates from
  `SLOT_WITNESS_PLAN.md`: `Component.slots(...)` setup allocation,
  `Component.viewFromSlots(...)`, or a combined
  `Component.makeWithSlots(...)`-style entry point).
- Provide an explicitly cheap tier for one-off/private structure: a component
  with no published contract should not pay contract ceremony. Document when
  to use each tier.

### Finding 2 — Typed tree authoring is JSX reinvented as function calls

`View.element(Root, { children: [View.element(Label, { children:
[View.textNode(props.label)] })] })` is the weakest ergonomic point of the
authored path. It will not survive contact with users who have JSX available.

Direction:

- Prioritize witness-aware JSX authoring (slot witnesses usable as/in JSX tags
  or slot attributes) so the typed tree is produced by the JSX transform
  rather than hand-written builder calls.
- Keep `View.element(...)` builders as the renderer-neutral/generated layer
  under the JSX surface, not the authored surface.

### Finding 3 — Attachment API redundancy

`attach` / `attachToSlots` / `attachBySlotContract` / `attachBySlots` on both
`Style` and `Behavior` (plus `attachByView`, `attachToAllWithCapability`) is
too many ways to do one thing. The authored/typed-remap/dynamic tiering is
defensible, but the migration layers are showing.

Direction:

- Before release, converge on: one authored path (`attachToSlots`), one typed
  remap path (`attachBySlotContract`), one dynamic string-map path
  (`attachBySlots`), and remove or demote the rest (`attach`, `attachByView`)
  to internals/advanced with explicit migration notes.
- Same sweep for `View.make` + `slotMetadata` vs `View.Slots`: the low-level
  path stays, but it should be documented only as the generated/dynamic escape
  hatch and removed from all authored examples (mostly done; finish the sweep
  and decide whether `View.slot(...)`/`View.hidden(...)` remain public).

### Finding 4 — Inference must carry the plain-setup path

Test/authored code still needs explicit generics in places
(`Component.make<{}, never, never, { input: Element.TextInput }>` in
`composables.test.ts`). With the setup builder positioned as optional rather
than the face of the framework, inference on the plain
`(props) => Effect<Bindings, E, R>` path has to be strong enough that authored
code never writes explicit type arguments.

Direction:

- Inference audit with acceptance criterion: no explicit generic arguments in
  any authored example, doc snippet, or golden-path test. Explicit generics
  remain acceptable only in library-internal helper definitions.
- Fix the `Component.make` overloads/parameter ordering that force
  annotations today (slot handle bindings in setup returns are the known
  offender).

### Finding 5 — Result/FetchResult divergence is unfinished business

Two async state machines still ship: unified `Result`
(Loading/Refreshing/Success/Failure/Defect) and `FetchResult`
(Initial/Success/Failure + `waiting`, with the awkward
`error: E | { defect: string }` union). Conversion seams
(`FetchResult.fromResult/toResult`) are exactly where users will trip.

Direction:

- Treat `docs/RESULT_CONSOLIDATION_PROPOSAL.md` completion as release-blocking:
  finish the migration so all primary surfaces (loaders, queries, actions,
  route runtime snapshots) emit unified `Result`, and `FetchResult` is
  compat-only with no untagged defect union in any primary signature.

### Finding 6 — Type-safety claims are one step ahead of `node: unknown`

Slot boundaries are typed; the view body between them mostly is not
(`View.node` is `unknown`, `tree` is optional metadata). That is an acceptable
staging decision, but docs must not claim "everything is type-safe" until the
typed tree path is the default output of authoring.

Direction:

- Continue `docs/TYPED_VIEW_TREE_PLAN.md` so authored views (especially once
  witness-aware JSX lands per Finding 2) always carry `tree` metadata.
- Docs sweep: scope type-safety claims to what is enforced today (slot
  contracts, attachments, tokens, capability/platform checks) and state the
  `node: unknown` boundary explicitly. `docs/AF_UI_CONTRACT.md` already notes
  this; README/marketing-style docs (`docs/afui.md`) should match.

## Design Improvement Proposals (2026-07-06, round 2)

A second review pass proposed forward-looking improvements beyond the
ergonomics findings above. These are proposals (new capability/consolidation),
not defects. Suggested starting pair: P2 (small, closes an inconsistency with
the design's own philosophy) and P1 (first real-world need the current design
cannot express).

### P1 — Behavior state contracts + state-aware styling (high value)

Slots have first-class witnesses; the bindings a behavior publishes do not.
`disclosure` produces `isOpen`, `selection` produces selected keys, but that
contract is implicit in the attachment merge — and styles cannot see it. The
most common real styling need is state-dependent (open/closed, selected,
pressed, invalid), and today Style and Behavior are parallel tracks that never
talk.

Direction:

- Add a binding-contract witness to behaviors (e.g.
  `Behavior.provides({ isOpen: ... })`) so what a behavior publishes is a
  typed, inspectable contract like the slot contract.
- Add state-aware style composition (e.g.
  `Style.whenBinding(disclosure.isOpen, {...})`) with the same compile-time
  attachment guarantees as slots.
- Natural next unification after the slot-contract work.

### P2 — Reactivity key witnesses (cheapest high-value item)

Reactivity keys are the last magic strings standing.
`Reactivity.tracked(fx, { keys: ["users"] })` and `reactivityKeys: ["users"]`
have no compile-time connection between tracked and invalidating sites; a typo
silently means "never refreshes."

Direction:

- Key witnesses: `const Users = Reactivity.Key.make("users")`.
- Typed key families for parameterized keys: `Users.item(id)`.
- Key hierarchy: invalidating `users` reaches `users/42`.
- Apply the exact pattern that eliminated slot string drift; keep string keys
  as the dynamic/generated escape hatch, matching the slot tiering.

### P3 — One diagnostics pipeline someone will actually run

A dozen explicit-only validators exist (`View.validateSlotTargets`,
`validateRemaps`, `validatePlatform`, `validateTree`,
`Component.validateSlotContract`, `Behavior.validateAttachmentBySlots`,
`Route.validateLinks`, `ServerRoute.validate`, ...). Individually good;
collectively nobody will call them.

Direction:

- One `Diagnostic` type with severity across View/Style/Behavior/Route/Server.
- A dev-mode layer that auto-runs relevant checks at mount/attach and reports
  once (explicit-only remains the production default).
- A CLI/CI entry point ("af-ui doctor") that runs the static checks over a
  route tree.

### P4 — User-declared token schema

Token paths type-check against a fixed built-in theme taxonomy. A design
system cannot add `brand.tertiary` and keep compile-time safety, which
undercuts the core anti-Tailwind pitch.

Direction:

- Make the theme a user-declared schema (generic parameter or module
  augmentation), with `ThemeLight` as merely the default instance — the same
  way the platform vocabulary is data.

### P5 — Ship a test kit as a named deliverable

The architecture's biggest practical payoff is testability (behaviors are
Effects over abstract element handles, styles are data, `Reactivity.test`
exists), but there is no packaged harness.

Direction:

- Component test driver: `render(Field, { props, layer })` returning typed
  slot handles.
- Behavior driver simulating `press`/`input` against `Element.Interactive`
  with no DOM.
- Style assertion helpers over style data.
- Also the best demo artifact: keyboard-navigation tests for a combobox with
  zero DOM.

### P6 — Consolidate the three routing generations before v1

Legacy `Route` service + `Component.route(...)`, route-node constructors, the
unified route model, and `RouterRuntime` coexist, with helpers spread across
them (`Route.actionSingleFlight` vs `Route.singleFlight` vs
`Atom.action({ singleFlight })`). The atom surface got ruthless consolidation;
routing has not, and it is now the largest module.

Direction:

- Pick the unified route model + `RouterRuntime` as canonical.
- Give the rest the same deprecate-and-delete treatment the atom aliases got.

### P7 — Decide the package boundary question

One package contains the atom core, AF-UI (view/style/behavior), the router,
and the server runtime. The incremental-adoption story argues for a split:
someone who wants atoms + reactivity keys should not take a UI framework.

Direction:

- Decide split vs single package before v1.
- Either way, define and enforce internal layering as if separate packages
  (core → view/style/behavior → router → server) so dependencies stay honest
  and a later split is cheap.

## Design Improvement Proposals (2026-07-06, round 3)

A third review pass covering process, DX, and feature gaps not addressed by
rounds 1-2.

### Process

**PR1 — Define the v1 scope cut (do first).** Every plan doc is additive;
none says what to cut. The largest project risk is non-convergence, not any
design flaw. `docs/V1_SCOPE.md` now holds the draft ships/deferred split —
review it, resolve the marked decisions, and treat it as the authority for
"is this v1 work" when triaging backlog items.

**PR2 — Give the plan docs the consolidation treatment the API got.** This
file is 1,100+ append-only lines; "Completed So Far" is archaeology. Move
completed sections to an archive file (e.g.
`docs/archive/REDESIGN_COMPLETED_LOG.md`), keep this doc to goals + findings
+ proposals + backlog + next. Sweep the ~70 docs in `docs/` and move the
historical-only ones into `docs/archive/` so the live set is legible to
newcomers and agents.

**PR3 — Back the performance claims with a benchmark.** `docs/afui.md`
claims granular no-VDOM updates and lighter-than-CSS-in-JS styling; nothing
measures either. Add a small perf harness (js-framework-benchmark subset plus
a style-update microbenchmark) run in CI with a regression threshold, so the
claims become tracked invariants.

### DX

**D1 — Engineer the compile errors, not just the types.** The "compiler as
tutor" pitch fails if a wrong capability binding produces a 40-line
structural dump of `SlotTypeId` internals. Add error-shaping conditional
types that resolve to readable string literals (e.g. `Capability 'Container'
does not satisfy 'TextInput'`), and extend the `@ts-expect-error` test suite
to snapshot/assert on error *text* for the golden-path failure modes.
Multiplies the value of the Finding-4 inference audit.

**D2 — Ship AI-assistant guidance as a product artifact.** The API is
unusual enough that LLMs will hallucinate React/Tailwind patterns at users.
Publish a consumer-facing `llms.txt` / agent skill containing the golden
path, current API names, and a "these old names are wrong" table (the
routing/attach renames make this doubly necessary). Keep it versioned with
the API like the README.

**D3 — Scaffolding.** `create-af-ui` starter plus a component generator that
emits the slot-contract + style + behavior + test skeleton. Blunts the
Finding-1 ceremony cost immediately and doubles as an executable spec of the
golden path.

### Design / Features

**P8 — Accessibility patterns as checkable contracts (candidate headline
feature).** The pieces exist: slot `allowedAttributes`, behavior-attached
ARIA, `focusTrap`, `keyboardNav`. Add pattern-level contracts (e.g. "combobox
requires trigger + listbox + option slots with these roles and keyboard
interactions") validated through the P3 diagnostics pipeline. "Provably
implements the WAI-ARIA combobox pattern or it doesn't compile" is a stronger
differentiator than platform-agnosticism and is reachable.

**P9 — Forms as a first-class vertical.** `AtomSchema.struct`, optimistic
actions, typed errors, single-flight mutations, and `ServerRoute` form
schemas all exist but are not composed into a story. Add a `Form` module:
schema-driven fields, touched/dirty tracking, submit-as-action with
optimistic + single-flight, and server validation errors flowing back into
typed field state. This is the demo that exercises every subsystem at once.

**P10 — Exit animations need an owner.** `Style.animate`/`enter`/`exit`
exist as descriptors, but exit animations require the runtime to delay
unmount until the animation completes — a lifecycle problem, not a styling
one, and miserable to retrofit. Write a short design note now deciding who
owns deferred removal (renderer vs behavior vs a view transition service)
before the renderer contract hardens.

## Foldkit Comparison Takeaways (2026-07-06)

Reviewed foldkit.dev (Elm Architecture on Effect: single Model, Messages,
pure update, Commands-as-data, model-gated Subscriptions; client-side SPA
only, no SSR, no incremental adoption). Architectural verdict: their
single-Model uniformity is not worth stealing — our Registry + Reactivity
choke points give equivalent inspectability without the update-function
bottleneck, and their renderless `toView`-callback UI model validates our
typed slot contracts by contrast. What they beat us on is productization.
Takeaways F1-F7; several amend existing proposals rather than adding new
ones.

### F1 — Devtools with time travel + MCP (upgrades the post-v1 "devtools" note to a real proposal, P11)

Foldkit's overlay logs every Message, inspects the Model with changed-path
highlighting, time-travels, and lets AI agents connect over MCP to read
state, walk history, rewind, and dispatch. We are better positioned than
they are: `Registry` + `dehydrate()` is already a snapshot mechanism, and
the Reactivity service is a natural keyed, timestamped event log — plus our
data is richer (typed errors, pending states, optimistic vs committed).

Direction (P11):

- Devtools panel: atom snapshots, invalidation timeline, action/optimistic
  lifecycle, slot-contract tree.
- MCP server access as a requirement, not an afterthought (read
  state/history, rewind via hydrate, dispatch actions).
- Copy their knobs verbatim: `excludeFromHistory` for high-frequency
  entries, `keyframeInterval` for replay memory, dev-only/always visibility,
  shadow-DOM isolation.
- Still post-v1, but now a designed deliverable, not a bullet.

### F2 — Model-gated subscription primitive (new proposal, P12)

Their best API idea: a subscription is a stream gated by a state slice —
dependency extraction, structural-change scope restart (finalizers run),
`keepAliveEquivalence` to control which deps restart, and
`readDependencies()` to read latest state without restarting (auto-scroll
during drag). We have stream helpers but no declarative "this stream exists
while this condition holds, restart on these deps only" primitive; today it
is hand-rolled in setup.

Direction (P12):

- Add `Atom.Stream.gated(deps, ({ deps }) => stream, { restartOn })` and/or
  a `Component.subscription(...)` setup helper.
- Deps are atom selections (strictly more general than their model paths);
  scope-per-generation with finalizers; explicit restart-policy escape
  hatch.

### F3 — Story/scene test taxonomy (amends P5)

Name the two test tiers and conventions: *story tests* (drive
bindings/actions directly with a test layer, assert on state) and *scene
tests* (simulate users against slot handles via accessible locators, always
through the root production path); `*.story.test.ts` / `*.scene.test.ts`.
Our DOM-free behavior driver makes "scene tests without a browser" a claim
they cannot match. P5's test kit should ship this vocabulary, not just
drivers.

### F4 — Named AI story (amends D2)

Foldkit has an `/ai/overview` section and leads with "explicit and
predictable, so LLMs generate it well and humans review it easily." The
claim is more true of AF-UI — the compiler rejects hallucinated
slots/tokens/requirements, so wrong generation fails at compile time — but
they say it and we don't. D2 grows from "ship llms.txt" to: llms.txt +
agent skill + a docs section arguing type-checked generation as a feature,
with F1's MCP devtools as the runtime half.

### F5 — Typed out-events for behaviors (amends P1)

Their stateful submodels communicate upward via a typed `OutMessage` the
parent pattern-matches. Our behaviors return bindings (readable state) but
no typed event channel ("selection changed", "dialog dismissed"). When P1's
`Behavior.provides(...)` is designed, include an events axis alongside
state, so parents subscribe to behavior events type-safely.

### F6 — Honest "when not to use this" docs page (docs plan)

Their comparisons page plainly lists what Foldkit is wrong for; it is
disarming and builds trust. Add a short "use something else if..." section
to README/afui.md (small static sites, teams without Effect fluency, need a
mature component ecosystem today) — and honestly claim the
incremental-adoption and SSR rows they concede.

### F7 — Behavior pack roadmap from their catalog (amends P8)

They ship 23+ headless components in two tiers (stateful submodels vs
stateless render helpers); we have ~7 behaviors + combobox. Their catalog is
a market-validated roadmap: Dialog, Tooltip, Popover, Tabs, Slider,
Calendar/DatePicker, DragAndDrop are the gaps users hit first. Adopt the
two-tier taxonomy (behaviors-with-state vs pure attachment helpers), and
pair each pack entry with its WAI-ARIA pattern contract (P8) — the
differentiator they don't have.

### F8 — Async-result takeaways (amends P5, P11; adds P13)

Reviewed Foldkit's async handling (`Command.define(name, Succeeded, Failed)`
with errors returned as data messages). Verdict: they have no async result
*type* — each app hand-rolls `isLoading` fields, which permits impossible
states our tagged `Result<A, E>` makes unrepresentable. Do not trade
`Result` for anything there; likewise skip the declared
success/failure-constructor pair (we already have
`onSuccess`/`onFailure`/`onTransition` without the ceremony). Three edge
ideas are worth taking:

1. **Test-side action/query resolution (amends P5).** Their
   `Story.Command.resolve(FetchCount, SucceededFetchCount({...}))` scripts
   an operation's outcome inline with no mock layers and no async. The test
   kit should include the equivalent: `resolveAction(handle,
   Result.success(...))` / `resolveQuery(atom, ...)` that short-circuits the
   effect and drives the handle's `Result` directly. Stub layers remain the
   integration-test path; this is the cheap unit-test path.
2. **Load-bearing operation names (amends P11).** Their `name` field is what
   makes the devtools message log legible. `Atom.action` /
   `defineMutation` already accept optional `name`; make it load-bearing:
   surfaced in the P11 timeline, `observe` metrics, and diagnostics, and
   nudged in docs/examples so it is actually set.
3. **P13 — Schema-validated action inputs (new, small).** Optional
   `Atom.action(fn, { inputSchema })` validating dispatch inputs at the
   boundary with a typed error. Matters more for us than for them: our
   actions can be invoked from forms, URLs, and over the single-flight
   transport, and every other boundary (routes, server routes) already
   schema-validates. Keep it optional; compile-time typing remains the
   default for purely local actions.

## Typed Intrinsic Elements (2026-07-08)

### P14 — Per-tag typed JSX host elements + attributes (correctness headline)

The "amazing TypeScript / correctness story" has a hole at the most-used
surface: **intrinsic JSX host tags are effectively untyped.** Today
`JSX.IntrinsicElements` is `{ [elemName: string]: HTMLAttributes }` and
`HTMLAttributes` ends in `[attr: string]: unknown`, so `<input value={5}
onBogus={...} />`, `<div href="...">`, and `<xyz>` all type-check. Slot
contracts, tokens, capabilities, and reactivity keys are all witness-typed —
the raw markup between them is not. This is the same "one step ahead of `node:
unknown`" gap as Finding 6, but at the element/attribute layer rather than the
view-body layer, and it is the first thing an LLM or a human hits.

Direction:

- Replace the catch-all `IntrinsicElements` with a **per-tag attribute map**
  (`input` → input attributes, `a` → anchor, `img`, `label`, `form`, `option`,
  `html`/`head`/`body`/`meta`/`link`, …), over a shared typed base of common
  attributes with **real event types** (`onInput`/`onChange`/`onClick` carrying
  the correct `Event`/`InputEvent`) instead of the current permissive
  `EventHandler = (event: any) => unknown`.
- Keep the `[elemName: string]` / `[attr: string]` fallbacks during migration
  so nothing breaks; tighten tag-by-tag behind the `typecheck` gate. Decide at
  the end whether to drop the string fallback (full closed-world safety) or
  keep it as the `data-*`/custom-element escape hatch.
- Pairs with **D1** (readable compile errors — a bad attribute should resolve
  to a legible message, not a structural dump) and complements **Finding 2/6**
  (witness-aware JSX + typed `tree`): P14 types the *host* leaves, Finding 2
  types the *slot* structure between them.

**Naming decision (resolved): do NOT add a runtime `Tag.*` element module.**
Three reasons: (1) "Tag" is already the service-tag vocabulary across the
library (`Serialization.Tag`, `Route.RouterTag`, `ServiceMap.Service`,
Effect `Context.Tag`) — a second meaning would confuse; (2) a runtime
hyperscript builder contradicts the Finding-2 decision that JSX is the authored
surface, and would bypass the `babel-plugin-jsx-dom-expressions` template
optimization (slower than the JSX it replaces); (3) **bundle/tree-shaking** — a
`Tag = { input, div, … }` object of ~110 element closures is the
anti-pattern (namespace objects are not reliably property-shaken, and
`index.ts` re-exports via `export * as`, dragging them all in). The
tree-shakeable programmatic escape hatch already exists as the single generic
`View.element(tag, opts)`. **P14 is types only — erased at build, zero runtime,
zero bundle cost** — which is exactly why it is the right shape for the
correctness win.

## Result State Model (2026-07-08)

### P15 — Richer `Result` states: `Stale` (and `Idle`) — restores a regressed capability

An external six-state result model (axes: *data presence* × *request status*)
surfaced two states our unified core `Result` cannot express, one of which we
**regressed during the Finding-5 migration**:

| Six-state model | core `Result` today | Gap |
| --- | --- | --- |
| Idle (no data, nothing requested) | — (starts at `Loading`) | missing (minor) |
| Loading (no data, first request) | `Loading` | ok |
| Refreshing `{ data }` | `Refreshing<A,E>{ previous }` | ok (more general) |
| Failure `{ error }` | `Failure<E>{ error }` | ok |
| **Stale `{ error, data }`** | `Stale<A,E>{ error, data }` | done 2026-07-08 |
| Success `{ data }` | `Success<A>{ value }` | ok |

**The regression that P15 fixed:** `FetchResult.Failure` carried
`previousSuccess: Success | null`, so a *failed refresh* kept the last-good
data. Core `Result.Failure` is only `{ error, exit }` — **no data field** — so
after the Finding-5 migration a failed refresh blanked to a bare `Failure` and
lost the previous good data. `Stale` is the principled fix — the failed-refresh
mirror of `Refreshing` — making both SWR behaviors compiler-tracked states
rather than per-screen conventions (`getData`/`getError` give a view both for
free).

Direction (v1.x, carefully scoped):

- **Done 2026-07-08:** Added `Stale<A, E>{ error, data }` to core `Result`;
  extended `match`, `settled`, `map`, `toOption`, `getOrElse`,
  `getData`/`getError`, `latest`, `Async`, `Errored`, typed boundaries,
  `Atom.result`, `FetchResult` compat conversion, and the `Serialization`
  wire projection. `atomEffect` failed refreshes now preserve the last success
  as `Stale`; mutation/action `void` results intentionally remain plain
  `Failure` on typed errors. Loader wire compatibility is preserved by
  projecting `Stale` to the existing flat failure DTO with `previousSuccess`.
- Evaluate **`Idle`** (nothing-requested), distinct from `Loading`. Deferred:
  useful but lower value than restoring keep-stale-on-failure, and it would
  require clearer semantics for first-run query lifecycles.
- **Guardrail 1 — keep the typed-error vs `Defect` split.** The six-state model
  has a single `error`; ours separates typed `Failure<E>` from `Defect`
  (bugs/interrupts), and removing the untagged `E | { defect }` union was the
  Finding-5 win. So this is effectively 7 states (their 6 + `Defect`), or
  `error: E` with `Defect` kept separate — do not collapse it back.
- **Guardrail 2 — extend, don't re-fork.** We own this `Result`, but it is the
  substrate for atoms, `<Loading>`/`<Errored>`, reactivity, loaders, and
  `Effect.result`. Add variants by extension; do not swap in a bespoke union
  that reopens the divergence Finding-5 closed.
- Pairs with the P5 test kit (assert stale-on-failure without a DOM) and the
  correctness-story goal — compiler-tracked keep-stale-on-failure is a headline.

## Services & Layers Review (2026-07-06)

Reviewed how services/layers work across the library. The mechanics are
sound: requirement subtraction (`Component.require` + `withLayer`),
setup-inferred requirement bubbling, capture-at-setup ServiceMap semantics,
runtime requirement subsets (`RReq extends R`), and framework services as
ordinary tags (`Reactivity`, `Theme`, platform tags, single-flight
transport). What's missing is the story layer, plus one structural decision.

### S1 — The two-runtimes question (**RESOLVED 2026-07-06**)

`Atom.runtime(layer)` and `Component.mount(..., { layer })` can create two
service worlds. **Decision + implementation:** one composition root — feed
one `AppLayer` to both, or mount with `{ runtime: Atom.AtomRuntime }`
(`MountWithRuntimeOptions`) so the tree reuses the runtime's
`ManagedRuntime`. Caller keeps runtime ownership (mount dispose does not
dispose the shared runtime). Documented in `docs/SERVICES_AND_LAYERS.md`.

### S2 — Provision-tier guidance doc (highest-value unwritten docs page)

We have four provision tiers — app root (mount/`Atom.runtime`), subtree
(`withLayer`), per-operation (`Effect.provide`), ambient framework tags —
and no page saying when to use which. Foldkit's Resources page does this
with four decision criteria (construction cost, instance identity, failure
blast radius, implementation variety); ours needs to cover more ground:

- Write `docs/SERVICES_AND_LAYERS.md` with a decision table over the four
  tiers.
- Answer the sharp questions explicitly: do two sibling `withLayer(ApiLive)`
  components share one instance or get two (per-build memoization → two —
  sometimes exactly wrong for a pool); what happens when a layer fails to
  build at mount vs in a subtree; how capture-at-setup interacts with
  wrappers.

### S3 — Server request-scoping rule

`ServerRoute.dispatch({ layer })` takes a per-dispatch layer, which is
correct, but nothing states the invariant: stateful/request-bound services
(auth context, request info) must be request-scoped; expensive services (DB
pools, RPC clients) are built once at app lifetime and merged in. Getting
this wrong leaks one request's context into another. Document the pattern
(app-lifetime layer + per-request layer built from the `Request`) in
`SERVICES_AND_LAYERS.md` and the server docs, with a test proving isolation.

### S4 — Promote services-as-reactive-participants to doctrine

`Reactivity.tracked(...)` / `invalidating(...)` inside service methods is
the answer to "how does a service drive the UI": service stays UI-agnostic,
components stay service-agnostic, keys are the contract. Today it is
discovered in the single-flight example; it should be presented as the
canonical pattern in the services doc, README, and `afui.md`. (Gains
compile-time teeth when P2 key witnesses land.)

## TODO Backlog (Redesign)

- [x] Add explicit `Slots` parameter to `Component.Component` metadata and start migrating slot attachment typing away from binding-shape conventions.
- [x] Introduce a minimal `View<Slots>` type and helpers that preserve current JSX authoring while exposing structural metadata.
- [x] Make `Component.make` / component helpers view-aware while preserving current `unknown`/JSX return compatibility.
- [x] Add type tests for valid/invalid behavior and style attachment through component slots.
- [x] Add initial runtime diagnostics inspired by `../gen2` for dynamic/generated slot targets, remaps, and style/behavior attachment validation.
- [x] Add initial slot metadata support for hidden slots and slot remapping.
- [x] Add static slot contract metadata to components.
- [x] Standardize Style/Behavior authored APIs around `forSlots(...)` and `attachToSlots(...)`.
- [x] Add a slot contract unification plan that makes `View.Slots` the single canonical authored contract.
- [x] Add `SafeHtml` brand and define the first typed-hole/security boundary.
- [x] Add lightweight platform metadata and renderer-boundary diagnostics inspired by `../gen2` (`event_model`, `attribute_model`, supported capabilities).
- [x] Extend platform metadata diagnostics from View-level helpers to component render-time runtime integration.
- [x] Consolidate `Style`/advanced style docs into one stable public style guide.
- [x] Promote one route-node golden path and update router examples around it.
- [x] Add SSR hydration example proving seeded loader data is available on first client render.
- [x] Final export-tier cleanup: verify top-level stays app-first and move any remaining advanced overlap behind `advanced`/subpaths.
- [x] Deep-import guidance sweep: ensure docs consistently show `effect-atom-jsx/Registry` for manual registry usage.
- [x] Historical-doc hygiene pass: label remaining pre-redesign analysis blocks as historical where they can be mistaken for current API guidance.
- [x] Action-first docs polish: keep linear `Atom.runtime(...).action(...)` as primary mutation narrative across all guides.
- [x] Finish API examples pass: ensure callable `Atom`/`AtomRef` style is used consistently in docs/snippets.
- [x] Family lifecycle follow-up: add at least one end-to-end example showing `Atom.family(...).evict/clear` in component lifetime cleanup.
- [x] Continue typesafety/composability track from `docs/new_ideas.md`: **closed 2026-07-09** — historical items in archive log are complete; remaining ideas are post-v1 product (see deferred V1_SCOPE), not open redesign blockers.
- [x] Golden-path compression (Finding 1): **done** — `View.Slots.define` + `View.fromSlots` + `Component.withSlots`; golden path ~15 lines (see `SLOT_CONTRACT_GOLDEN_PATH.md`).
- [x] Cheap tier for one-off structure (Finding 1): **done** — no-contract components with plain JSX; documented in golden-path tiers.
- [x] Witness-aware JSX authoring (Finding 2): **done 2026-07-09 residual** — `View.fromJsx` / `View.fromSlots` authored surface; optional `tree` metadata; `View.element` remains generated layer (compiler extraction stays v1.x stretch).
- [x] Attachment API consolidation (Finding 3): **resolved 2026-07-07 — with a correction.** Attempting the planned physical deletion revealed the premise was wrong: `Style.attach`/`attachByView` and `Behavior.attach` are **not** redundant legacy forms. They are the **general low-level tier** — `Behavior.attach`'s `select` picks elements from *any* bindings (including derived values like `() => bindings.filtered()`), and `Style.attach` targets setup `bindings.slots` for components with **no published contract** — capabilities the three contract-keyed forms cannot express. So instead of deleting, **un-deprecated and reclassified** them as the general escape hatch the slot-contract forms are typed sugar over (JSDoc + API.md corrected). The real consolidation outcome: a clear 2-tier model (general `attach`/`attachByView`/`Behavior.attach` ← low-level; `attachToSlots`/`attachBySlotContract`/`attachBySlots` ← typed sugar), not a deletion. The "too many ways" critique conflated general-purpose with redundant.
- [x] Finish the `View.make` + `slotMetadata` demotion sweep (Finding 3): **done 2026-07-09** — `View.make` JSDoc marks generated/dynamic only; `View.slot`/`View.hidden` stay public low-level; authored path is `fromSlots`/`fromJsx`.
- [x] Inference audit (Finding 4): **done** — golden path generic-free (`slots-define.ts`); legacy bindings-as-slots remains deprecated annotated tier by design (not force-migrated).
- [x] Test-typecheck gate (hardening): **40 → 9 → 0, closed 2026-07-08.** `npm run typecheck:tests` (`tsconfig.tests.json`) is **green and enforced** (part of `typecheck:all` / `check`). En route the gate **surfaced and fixed SIX real library bugs** (`Atom.family` invisible plain overload, `Component.renderEffect` missing `SlotContract` axis, `Component.route` leaking `RouteContext` into `Req`, `ServerRoute.execute*` over-constrained node type, `Behavior.make` requiring all generics, `Component.setupEffect` missing `SlotContract` axis) plus the `SlotContract` witness-vs-handles normalization (`View.NormalizeSlots` at `renderViewEffect`). The residual 9 closed in two batches: the ~5 P6-coupled route-construction errors (route.test `UnifiedRouteSymbol`/overloads, route-loader `RouteChildrenEnhancer`) resolved with the routing overload unification (commit `2e53de0`), and the deep type-helper drift (`attachToAllWithCapability` SlotContract over-constraint, `SlotMetadataMap` over witness collections, `withRetry` union source, `componentOf` standalone RouteContext) resolved in the deep-helper batch. (Note: after the Finding-3 correction the deprecated-attach tests stay valid — those forms are no longer being deleted.)
- [x] Result consolidation, release-blocking core (Finding 5): **done 2026-07-07** (steps 0-1). Step 0: characterization tests for the SSR wire round-trip (render→serialize→deserialize→hydrate→first render) + a pinned wire-shape test — none existed, silent-failure surface. Step 1: `Route.loaderResult()` and `Route.title`/`meta` loader callbacks now emit unified `Result` (converted at the loader-cache boundary via `FetchResult.toResult`; found + fixed a real divergence where the legacy component path passed raw FetchResult to head callbacks while the tree path didn't). **Acceptance met:** no `E | { defect: string }` union in any `Route.ts`/`Component.ts` public signature; golden-path loader surfaces emit unified `Result`. 487 tests + gates green.
- [x] Result consolidation, internal cleanup (Finding 5 step 2): **DONE 2026-07-08.** Removed remaining `FetchResult` from internal machinery — loader cache, `SingleFlightPayload`/`loaderPayload` wire types, loader orchestration, `Atom.pull`. **Foundation landed 2026-07-08: `Serialization` service (`src/Serialization.ts`).** A design realization scoped this pass: core `Result` carries `Cause`/`Exit` and is **not JSON-safe**, so `FetchResult` cannot simply be deleted from the wire — the wire boundary always needs a flat, serializable DTO. Rather than hand-roll that DTO, introduced an injectable `Serialization` service (schema-driven; `Tag` + default Effect-`Schema` layer + pure `encodeSync`/`decodeSync`) with `ResultWire`/`ResultWireRecord` as the canonical flat loader-result wire schema. `Route.serializeLoaderData`/`deserializeLoaderData`/`streamDeferredLoaderScripts` now route through it (byte-compatible; validates on decode). Default codec is Effect Schema (zero new deps); `seroval` can slot in as an alternate layer later without touching call sites. **`Atom.pull` migrated 2026-07-08** (isolated, no wire impact): `PullResult` is now core `Result<PullChunk<A>, E>`; test + ooo-async example updated. **Loader cache + orchestration + wire types now hold core `Result`** (landed via the codex `codex/result-wire-migration` branch, merged `3c1d14e`; wire kept backward-compatible — flat DTO unchanged, no version bump). Post-merge cleanup (`7fb31d0`) replaced the merged reference-equality codec dispatch with dedicated `Serialization` functions (`resultToWire`/`resultFromWire` + `encodeResult`/`decodeResult`/`encodeResultRecord`/`decodeResultRecord`), made `ResultWire`/`ResultWireRecord` honest flat-DTO schemas (dropped a lying cast), and restored typed-`SchemaError` failures on the service (strengthened test via `Effect.flip`). **Acceptance met:** `FetchResult` in `router-runtime.ts` = zero; in `Route.ts` = only the deprecated `loaderFetchResult()` compat accessor + JSDoc (zero primary signatures). `FetchResult` is compat-only. All five gates green (496 tests). **Regression later fixed by P15:** core `Result.Failure` had no data field, so **keep-stale-on-failure was lost** — `FetchResult.Failure` carried `previousSuccess`, core `Result` did not until the `Stale{error,data}` slice landed. See the Result State Model section.
- [x] Typed-tree-by-default + claims sweep (Finding 6): **done 2026-07-09** — `View.fromSlots` always attaches `tree` (default empty fragment); docs/llms claim type-safety at slot/token/capability boundaries; `node` remains host payload.
- [x] Richer `Result` states (P15): **Stale slice done 2026-07-08.** Added `Stale<A,E>{ error, data }` to the owned core `Result` without reintroducing an untagged defect union; extended constructors/guards, `match`, `settled`, `map`, `toOption`, `getOrElse`, `getData`, `getError`, `latest`, `Async`, `Errored`, typed boundaries, `Atom.result`, compat `FetchResult.fromResult`, and `Serialization.resultToWire/resultFromWire`. `atomEffect` failed refreshes now preserve the last success as `Stale`; mutation/action `void` results stay plain `Failure`. Wire remains backward-compatible by encoding `Stale` as the existing `Failure` DTO with `previousSuccess`. Coverage added in `phase3.test.ts` and `serialization.test.ts`. `Idle` evaluated and deferred.
- [x] Typed intrinsic elements (P14): **first slice done 2026-07-08.** Replaced the catch-all `JSX.IntrinsicElements` / open `HTMLAttributes` bag with web per-tag attribute maps in `src/jsx-runtime.ts`, typed common/global/data/ARIA attributes, tag-specific forms/inputs/buttons/anchors/media/head/table attributes, and real event handler payloads with typed `currentTarget`. The migration escape hatch is now custom-element-shaped names (`${string}-${string}`) via `LooseHTMLAttributes`, not a global string tag fallback that weakens known tags. Added `src/type-tests/jsx-intrinsics.tsx` coverage for valid JSX, bad known-tag attributes, bad input/button values, bad event names, typed event targets, and custom-element fallback. Types only — zero bundle. **Decided: no runtime `Tag.*` module** (naming clash with service tags + contradicts Finding 2 + bundle anti-pattern; `View.element` stays the generic escape hatch). Follow-up: broaden/refine long-tail tag attributes as real users/examples hit gaps and pair with D1 for better attribute error shaping.
- [x] Behavior binding contracts + state-aware styling (P1): **implementation slice done 2026-07-08.** Added `Behavior.binding(name)` and `Behavior.provides(contract)(behavior)` so behavior-created state is typed and inspectable through `Behavior.BindingContractOf<T>`; `Behavior.compose(...)` preserves published slot-event, provided-binding, and emitted logical-event metadata. Added `Style.whenBinding(binding, predicateOrValue, style)` and runtime style resolution against setup/behavior bindings for setup and view attachment paths. `Style.make(...)` now carries binding metadata through `whenBinding` / `when` / `compose`, and authored setup attachment rejects components that do not expose the referenced binding; dynamic remap helpers remain the intentional escape hatch. Added `Behavior.outEvent(name)`, `Behavior.eventBus(contract)`, `Behavior.emits(contract)(behavior)`, and `Behavior.OutEventsOf<T>` so behaviors can publish typed logical events and parents can subscribe with payload inference. Coverage added in `src/type-tests/slots-define.ts`, `src/__tests__/style.test.ts`, and `src/__tests__/behavior.test.ts`.
- [x] Reactivity key witnesses (P2): **complete 2026-07-06** (see archive log, slices 1-2) — `Reactivity.Key.make/family/is`, `KeyNameOf<T>`, hierarchical `child(...)` with record-form parity; witnesses accepted across `tracked`/`invalidating`, atom/action/component options, and all Route/loader-cache intake sites; README/API/afui docs lead with witnesses, strings remain the dynamic escape hatch; runtime + type + loader integration coverage, gates green.
- [x] Unified diagnostics pipeline (P3): **done 2026-07-08.** Shared `Diagnostic` model, collectors, reporter layer, `doctor`/`formatReport`, `af-ui doctor` CLI (earlier). **Auto-report slice:** `Diagnostics.devLayer()` + Component mount/render wires slot-contract + view validators when a reporter service is present (production remains explicit-only when the layer is omitted). Coverage in `src/__tests__/diagnostics.test.ts`.
- [x] User-declared token schema (P4): **done 2026-07-09** — first slice kept; **decision:** default-theme-typed style helpers + user schema via `Theme.define`/`defineTokens` escape hatches (documented in `Theme.ts`).
- [x] Test kit (P5): **expanded slice done 2026-07-08** (resolve/driver/taxonomy). `render` + `behaviorDriver` + style/attr helpers + `step`/`scenario` (earlier). **This pass:** `resolveQuery`/`resolveAction` (short-circuit Result via test controllers on query/mutation accessors), keyboard (`keydown`/`focus`/`blur`) + collection (`item`/`pressItem`/`keydownItem`/`collectionSize`) driver methods, `story`/`scene` taxonomy wrappers with kind tags, `Result` re-export from testing. Docs in `TESTING.md`. Coverage in `src/__tests__/testing.test.ts`. Remaining optional: combobox zero-DOM demo tests as a showcase.
- [x] Routing consolidation (P6): **resolved 2026-07-07/08.** Verdict was "3 legitimate tiers, not a legacy-to-delete generation" (history infra / component-first `Component.route` / route-first tree). The `Route`-vs-`AppRouteNode` overload seam that blocked the test/example gates was unified (commit `2e53de0`); stale "transitional/refactor-in-progress" JSDoc corrected to describe permanent tiers. `typecheck:tests` + `typecheck:examples` now green.
- [x] Package boundary decision (P7): **done 2026-07-06 (decision) / reaffirmed 2026-07-09** — v1 ships **one package**; internal layering core → view/style/behavior → router → server; split re-evaluated post-v1 only.
- [x] Review and ratify `docs/V1_SCOPE.md` (PR1): **done 2026-07-06** — doc ratified; ships/deferred/triage authority for backlog.
- [x] Plan-doc consolidation sweep (PR2): **done 2026-07-07** — completed-work log (~860 lines) extracted to `docs/archive/REDESIGN_COMPLETED_LOG.md` with a high-level summary left in place; the full exploratory/plan/proposal/audit set (47 files) archived into `docs/archive/` with inbound-link rewrites in the stay-put files (`AGENTS.md`, `docs/API.md`, `docs/view.md`, `docs/router.md`). Live set is now 13 reference docs (`afui.md`, `API.md`, `component.md`, `view.md`, `style.md`, `reactivity.md`, `router.md`, `SERVICES_AND_LAYERS.md`, `TESTING.md`, `RELEASE_CHECKLIST.md`, `V1_SCOPE.md`, `SLOT_CONTRACT_GOLDEN_PATH.md`, this doc) + `adr/` + `af-ui-json-render/`. Broken-link check across all live docs + root files: zero. `npm run check` green.
- [x] Perf benchmark harness in CI (PR3): **landed 2026-07-07/08.** `npm run bench` (vitest bench) with `src/__bench__/reactive-hot-paths.bench.ts` (atom read/write, 3-level derived propagation, family trie vs equals-scan lookup, reactivity key normalization/derivation) **+ `ui-hot-paths.bench.ts`** (style construction/resolution + per-mount component setup, backing the "styles are data / no CSS-in-JS runtime" and granular-component claims). `__bench__` excluded from typecheck/build/dist (but included in `typecheck:tests`, so bench files stay type-safe). **CI wired 2026-07-08** (`.github/workflows/ci.yml`): a `gates` job runs `typecheck:all` + `test` + `build` on push/PR; a **non-blocking `bench` job** runs `bench:ci` and uploads `bench-results.json` as an artifact. **Deliberate call:** perf thresholds on shared CI runners are noise-prone, so benchmarks are tracked-visible (artifact + log) rather than a hard gate — promote to a threshold gate once a stable runner + committed baseline exist.
- [x] Compile-error engineering (D1): **done 2026-07-09** — attach path uses `View.TypeErrorMessage` for missing style bindings + slot contract mismatch on `attachToSlots` (first slice for handles already shipped).
- [x] AI-assistant guidance artifact (D2): **first slice landed 2026-07-07** — `llms.txt` at repo root with the core mental model, correct golden-path snippets, and a renamed/removed "do not emit" table (the type-checked-generation-as-a-feature framing from F4). Remaining: publish/package as an agent skill and keep versioned with the API.
- [x] Scaffolding (D3): **done 2026-07-09** — `scripts/create-af-ui.mjs` + package bin `create-af-ui`; project + component golden-path scaffold; test in `scaffold.test.ts`.
- [x] A11y pattern contracts (P8): **done 2026-07-09** — catalog Dialog/Tooltip/Popover/Tabs/Slider/Calendar/DragAndDrop + two-tier taxonomy; tests in `a11y-catalog.test.ts`.
- [x] Forms vertical (P9): **done 2026-07-09** — `src/Form.ts` fields, schema validate, submit mutation, `applyServerErrors`; tests in `form.test.ts`.
- [x] Exit-animation ownership note (P10): **done 2026-07-09** — `docs/EXIT_ANIMATION_OWNERSHIP.md` (renderer owns deferred unmount).
- [x] Devtools + MCP (P11): **MVP done 2026-07-09** — `src/Devtools.ts` timeline, snapshots, slot-contract tree, MCP read/rewind/dispatch, exclude/keyframe knobs; tests in `devtools.test.ts`.
- [x] Gated subscription primitive (P12): **done 2026-07-09** — `Atom.Stream.gated` + `Component.subscription`; tests in `atom-gated-stream.test.ts`.
- [x] Amend P5 with story/scene test taxonomy and naming conventions (F3): **done 2026-07-08** — `story`/`scene` helpers + docs in `TESTING.md` (`*.story.test.ts` / `*.scene.test.ts` convention).
- [x] Amend D2 with the AI docs section (F4): **done 2026-07-09** — `llms.txt` type-checked generation feature + Devtools/MCP companion + name nudge.
- [x] Amend P1 design to include a typed behavior out-event axis alongside published state (F5): **DONE 2026-07-08.** Added logical event witnesses, event buses, `Behavior.emits(...)` metadata, `Behavior.OutEventsOf<T>`, compose metadata preservation, and type/runtime coverage.
- [x] Add "when not to use this" section to README/afui.md (F6): **done 2026-07-06** — added to `README.md` (Overview) and `docs/afui.md` (README.new.md later consolidated into README.md), each claiming the incremental-adoption/SSR ground competitors concede.
- [x] Amend P8/behavior pack with two-tier taxonomy and catalog roadmap (F7): **done 2026-07-09** — `A11y.catalog` stateful/stateless entries for Dialog…DragAndDrop.
- [x] Amend P5 with inline outcome resolution: `resolveAction(...)` / `resolveQuery(...)` driving handle `Result` without mock layers (F8.1): **done 2026-07-08.**
- [x] Amend P11 so operation `name` is load-bearing (F8.2): **done 2026-07-09** — `Devtools.observeToTimeline` records named vs `<unnamed>`; llms/docs nudge to set `name`.
- [x] Schema-validated action inputs (P13): **done 2026-07-09** — optional `Atom.action` / `runtime.action` `{ inputSchema }` decodes before effect / single-flight; typed `ActionInputSchemaError`; tests in `effect-atom-api.test.ts`.
- [x] Two-runtimes decision (S1): **done 2026-07-06** — composition-root doctrine in `docs/SERVICES_AND_LAYERS.md`; `Component.mount` accepts `{ runtime: Atom.AtomRuntime }` (`MountWithRuntimeOptions`) so mount reuses the atom runtime world (caller retains runtime ownership).
- [x] Write `docs/SERVICES_AND_LAYERS.md` (S2): **done 2026-07-06** — four-tier decision table, per-instance `withLayer` sharing semantics, failure blast radius, capture-at-setup, requirement subsets.
- [x] Server request-scoping rule (S3): **done 2026-07-06** — documented app-lifetime + per-request layer pattern; **fixed a real gap found during implementation**: `ServerRoute.dispatch({ layer })` silently dropped the layer for data-route handlers (only document routes received it); layer now threads through `execute`/`executeWithServices` and is built per dispatch; request-isolation test added in `server-route.test.ts`.
- [x] Promote services-as-reactive-participants pattern (S4): **done 2026-07-06** — canonical section in `SERVICES_AND_LAYERS.md` using key witnesses; README/afui reactivity examples already lead with the pattern after P2 slice 2.
- [x] Add `Component.withSlots(...)` as the canonical component slot contract helper.
- [x] Add `Component.withSlotContract(...)` and primary `SlotContract` metadata.
- [x] Add `Component.SlotContractOf<T>` as the canonical slot contract extraction helper.
- [x] Add `Component.PublicSlotsOf<T>` / `Component.HiddenSlotsOf<T>` projections.
- [x] Verify slot contract preservation through mixed style/behavior wrappers and route-node materialization.
- [x] Add declared-vs-rendered slot diagnostics comparing component contract, rendered `View`, and setup/runtime slots.
- [x] Collapse the component slot type surface toward one `SlotContract` axis before release.
- [x] Remove component-level witness-named aliases from the public API.
- [x] Add a slot-contract golden-path doc and link it from README/API.
- [x] Migrate active direct `slotMetadata` examples toward `View.Slots` + `Component.withSlots(...)`.
- [x] Allow view-backed components to use behavior attachment without authored `bindings.slots` duplication.
- [x] Keep status tracker updated after each landed redesign change: **done 2026-07-09** — backlog closed empty-open.

## Completed Slice Acceptance Evidence

This section records the same success/test shape for work already marked done
or partially done in this redesign pass. A completed item should stay marked
complete only while the named source, type tests, runtime tests, and gates
continue to support the claim.

### P1/F5 — Behavior Bindings, Out-Events, And State-Aware Styles

Shipped features:

- `Behavior.binding(...)`, `Behavior.provides(...)`, and
  `Behavior.BindingContractOf<T>` publish behavior-owned state as metadata.
- `Behavior.outEvent(...)`, `Behavior.eventBus(...)`,
  `Behavior.emits(...)`, `Behavior.OutEventsOf<T>`, and compose metadata
  preservation publish logical behavior events.
- `Style.whenBinding(...)` resolves styles against setup-created and
  behavior-provided bindings.
- Authored setup attachment rejects styles that reference bindings the
  component does not expose; dynamic remaps remain the escape hatch.

Success criteria met:

- Behavior metadata survives composition and remains inspectable by types.
- Parents can subscribe to typed logical behavior events without stringly
  payload casts.
- State-aware styles resolve correctly in direct and responsive style paths.
- Type coverage rejects styles attached to components without the referenced
  binding.

Evidence:

- Source: `src/Behavior.ts`, `src/Style.ts`.
- Runtime tests: `src/__tests__/behavior.test.ts`,
  `src/__tests__/style.test.ts`.
- Type tests: `src/type-tests/slots-define.ts`.

Bugs already covered / must keep covered:

- Lost metadata after `Behavior.compose(...)`.
- Responsive styles dropping binding context.
- Event buses emitting to the wrong logical event key.
- Dynamic attachment paths accidentally becoming over-constrained.

### P14 — Typed JSX Intrinsic Elements

Shipped features:

- Known intrinsic tags use per-tag attribute interfaces instead of one
  catch-all string index.
- Common global, ARIA, event, form, input, button, anchor, media, head, and
  table attributes are typed.
- Event handlers expose typed `currentTarget`.
- Custom-element fallback is limited to custom-element-shaped tag names
  (`${string}-${string}`), preserving an escape hatch without weakening known
  tags.

Success criteria met:

- Invalid attributes on known tags fail in type tests.
- Invalid enum-like values such as button/input/form/image options fail in
  type tests.
- Event names and event target types are checked.
- The change is type-only and does not introduce a runtime `Tag.*` module.

Evidence:

- Source: `src/jsx-runtime.ts`.
- Type tests: `src/type-tests/jsx-intrinsics.tsx`.
- Gate: `npm run typecheck:all`.

Bugs already covered / must keep covered:

- Reintroducing `[elemName: string]` or `[attr: string]: unknown` for known
  HTML tags.
- Untyped event handlers losing `currentTarget`.
- Custom-element fallback accepting arbitrary typo tags such as `buton`.
- Runtime bundle growth from host-tag helper objects.

### P15 — `Result.Stale`

Shipped features:

- Core `Result` includes `Stale<A, E>{ error, data }`.
- Constructors, guards, `match`, `settled`, `map`, `toOption`,
  `getOrElse`, `getData`, `getError`, `latest`, `Async`, `Errored`,
  typed boundaries, and `Atom.result` understand `Stale`.
- `atomEffect` failed refreshes preserve previous success as `Stale`.
- Serialization projects `Stale` to the existing flat failure wire shape with
  `previousSuccess`, keeping wire compatibility.

Success criteria met:

- Failed refresh after a prior success keeps last-good data and exposes the
  refresh error.
- A later successful refresh recovers from `Stale` to `Success`.
- Legacy waiting failure with `previousSuccess` still decodes as
  `Refreshing`, not `Stale`.
- Defect failures do not decode as typed stale failures.

Evidence:

- Source: `src/effect-ts.ts`, `src/Result.ts`, `src/Atom.ts`,
  `src/Serialization.ts`.
- Runtime tests: `src/__tests__/phase3.test.ts`,
  `src/__tests__/serialization.test.ts`.

Bugs already covered / must keep covered:

- Losing stale data during failed refreshes.
- Treating defects as typed failures.
- Breaking old loader wire payloads.
- Mapping or extracting data/error inconsistently across `Refreshing`,
  `Stale`, and `Failure`.

### P3 — Diagnostics CLI + Auto-Report Slice

Shipped features:

- Shared diagnostic model, normalization, `hasErrors`, and formatting.
- Collectors for View, Component, Style platform, Style attachment, Behavior
  attachment, Route tree, and ServerRoute validators.
- Effect-native reporter layer with optional dedupe.
- `report(...)`, `doctor(...)`, and `formatReport(...)` share one summary
  model for tests, dev-mode integrations, and CLI output.
- `collectDoctorTargets(...)` discovers diagnostics arrays, route trees,
  server route arrays, and `{ diagnostics }` objects from module exports.
- `af-ui doctor` / `af-ui-doctor` imports a module, runs target discovery,
  prints text or JSON output, and exits non-zero on errors.
- `Diagnostics.devLayer()` for console-friendly opt-in reporting.
- Component mount/render auto-runs slot-contract + view validators when a
  reporter service is present (string-id shared service; no Component→
  Diagnostics import cycle).

Success criteria met for this slice:

- Validators that used to return strings or throw-like messages can be
  normalized into the shared `Diagnostic` shape.
- Reporter dedupe suppresses duplicate side effects without mutating the
  returned diagnostics.
- Doctor summaries count severity buckets and format stable output.
- CLI output can be scoped with `--export`, emitted as JSON with `--json`, and
  made warning-strict with `--fail-on-warnings`.
- Without a reporter layer, render stays silent (production default).
- With a reporter layer, declared-vs-rendered slot drift is reported once.

Evidence:

- Source: `src/Diagnostics.ts`, `src/cli.ts`, `src/Component.ts` (auto-report).
- Runtime tests: `src/__tests__/diagnostics.test.ts`.
- Exports: `src/index.ts`, `package.json` subpath and package `bin` entries.

Bugs already covered / must keep covered:

- Duplicate reporter spam.
- Losing string-validator output during normalization.
- Doctor summary mismatch between returned diagnostics and emitted side
  effects.
- Attachment collectors changing the wrapped component/style/behavior types.
- CLI import/target selection silently ignoring requested exports.
- Server-route arrays and route trees being misclassified as plain objects.
- Auto-report firing without an opt-in layer.
- Component↔Diagnostics circular import regressions.

Still not complete:

- Optional: auto-report at style/behavior attach and route/server boundaries
  (mount/render path is wired).

### P4 — User-Declared Theme Token Schema First Slice

Shipped features:

- Generic `ThemeTokenSchema`, bounded `TokenPathOf<Tokens, Category>`, and
  `TokenCategoryOf<Tokens>`.
- `Theme.defineTokens(...)`, `Theme.define(...)`, `Theme.layer(...)`, and
  `ThemeDefault`.
- Runtime token lookup and style resolution are schema-agnostic.
- `Style.Style.defineTheme`, `defineThemeTokens`, and `themeLayer` expose the
  same path from the Style namespace.

Success criteria met for this slice:

- Custom token schemas infer literal paths without casts.
- Invalid custom token paths fail in type tests.
- Runtime style resolution can read user-declared token values.
- Theme layers accept custom token schemas.

Evidence:

- Source: `src/style-types.ts`, `src/Theme.ts`, `src/style-runtime.ts`,
  `src/Style.ts`.
- Runtime tests: `src/__tests__/style.test.ts`.
- Type tests: `src/type-tests/style-tokens.ts`.

Bugs already covered / must keep covered:

- Deep recursive token types causing TS2589.
- Losing literal path inference through `Theme.define(...)`.
- Runtime resolution assuming only the built-in theme taxonomy.

Still not complete:

- Decision on whether style property token helpers become user-theme
  parametric or stay default-theme typed plus escape hatches.

### P5 — Test Kit Expanded Slice

Shipped features:

- `render(component, { props, layer })` returns `{ view, slots, driver }`.
- `behaviorDriver(slots)` provides DOM-free `press`, `input`, generic
  `emit`, `keydown`/`focus`/`blur`, collection `item`/`pressItem`/
  `keydownItem`/`collectionSize`, attribute reads, and style reads.
- `styleOf`, `attrOf`, `expectStyle`, and `expectAttr` assert handle data.
- `step`, `scenario`, `story`, `scene`, and `expectScenarioOk` provide a
  named scenario core (story/scene taxonomy) that stops on first failure.
- `resolveQuery` / `resolveAction` short-circuit handle `Result` values
  without mock layers (via internal result controllers on query/mutation
  accessors).

Success criteria met for this slice:

- Component render tests can access typed slots and drive behavior events
  without DOM.
- Style and attribute assertions work directly against element handles.
- Scenario failures preserve scenario name, step name, and thrown error.
- Successful scenarios produce explicit pass records.
- Queries and actions can be scripted to Success/Failure/Loading in unit
  tests without running Effects.
- Collection slots can be driven by index for multi-option UIs.

Evidence:

- Source: `src/testing.ts`, `src/effect-ts.ts` (`setResultForTest`).
- Runtime tests: `src/__tests__/testing.test.ts`.
- Docs: `docs/TESTING.md`.

Bugs already covered / must keep covered:

- Scenario runners continuing after a failed step.
- Scenario failures losing the original error.
- Drivers failing on direct handle maps outside component render.
- Style/attribute helpers silently passing incorrect values.
- resolve* throwing on non-controllable accessors.
- Collection index out of range silent failures.

Still not complete:

- Optional combobox zero-DOM showcase tests; accessibility locators beyond
  slot-name drivers.
- Inline `resolveAction(...)` / `resolveQuery(...)`.
- Zero-DOM combobox/dialog scene tests.

### P8 — A11y Pattern Contracts First Slice

Shipped features:

- `PatternContract`, `pattern(...)`, and `validate(...)`.
- Built-in `DialogSlots` and `Dialog` pattern.
- Diagnostics for missing pattern slots, slot capability mismatches, and
  missing required slot events.
- A11y diagnostics use the shared P3 `Diagnostic` source/model.

Success criteria met for this slice:

- A rendered View that misses Dialog requirements returns actionable a11y
  diagnostics.
- A View built directly from `DialogSlots` validates cleanly.
- Diagnostics identify the source as `a11y`.

Evidence:

- Source: `src/A11y.ts`.
- Runtime tests: `src/__tests__/a11y.test.ts`.
- Exports: `src/index.ts`, `package.json` subpath.

Bugs already covered / must keep covered:

- Missing slots passing silently.
- Wrong slot capabilities passing as valid pattern implementations.
- Required events drifting from slot metadata.

Still not complete:

- Role/attribute/focus/keyboard requirements.
- Dialog/Tooltip/Popover/Tabs/Slider/Calendar/DragAndDrop/Combobox catalog.
- Behavior-pack integration.

## Near-Term Implementation Acceptance Matrix

These are the concrete "done means done" checks for the remaining plan. Each
item should land with runtime tests where behavior changes, type tests where
public inference or compatibility changes, and docs/examples where the
authoring story changes.

### P3 — Diagnostics Pipeline

Full feature set:

- Shared `Diagnostic` model for View, Component, Style, Behavior, Route,
  ServerRoute, A11y, and test-kit diagnostics.
- Collector APIs that accept both authored/static values and rendered/runtime
  values, returning normalized diagnostics without throwing.
- Effect-native reporter layer for dev mode, with dedupe, source filtering,
  and an injectable sink for console, test capture, or devtools.
- Automatic dev-mode call sites at the high-risk boundaries: component render,
  style/behavior attachment, route tree materialization, server route
  dispatch, and a11y pattern validation when a pattern is declared.
- Static `af-ui doctor` CLI that can import a route tree/module, run the
  collectors, print a stable report, and exit non-zero on errors.
- Machine-readable doctor output (`json`) for CI and devtools.

Success criteria:

- A user can run one command in CI and catch invalid links, slot drift,
  platform-incompatible attributes/events, invalid style/behavior attachments,
  server-route schema issues, and a11y pattern violations.
- Dev-mode reporting emits each distinct diagnostic once per relevant boundary
  by default, without changing production behavior.
- Existing explicit validators remain available and are internally represented
  through the shared diagnostics shape.
- Formatted reports are stable enough for snapshot tests and readable enough
  to point to the owning route/component/slot.

Bugs to avoid and test:

- Duplicate spam from repeated renders or repeated attachments.
- Diagnostics that throw instead of returning structured errors.
- False positives for hidden/remapped slots or dynamic/generated string maps.
- Losing requirement/error type metadata when wrapping values just to diagnose
  them.
- CLI importing modules with side effects more than once.
- Dev-mode checks running in production builds or changing runtime semantics.

### P5 — Test Kit, Stories, And Scenes

Full feature set:

- `render(component, { props, layer })` for typed slot access and setup-layer
  injection.
- DOM-free behavior driver for `press`, `input`, arbitrary event emission,
  focus/keyboard paths, collection navigation, and logical out-events.
- Style/attribute assertion helpers over style data and element handles.
- Named scenario runner with `story` and `scene` taxonomy:
  `*.story.test.ts` drives bindings/actions directly; `*.scene.test.ts`
  simulates user behavior through slot handles and accessible locators.
- Inline async outcome resolution:
  `resolveAction(...)`, `resolveQuery(...)`, and stale/failure/success helpers
  for cheap unit tests without mock service layers.
- Golden zero-DOM tests for combobox keyboard navigation, dialog close/focus
  behavior, and loader stale-on-failure.

Success criteria:

- A design-system component can be tested without a browser, without rendering
  real DOM, and without losing slot/behavior/style type inference.
- Scene tests can locate handles by slot name and accessibility metadata,
  drive the public behavior path, and assert resulting bindings/out-events.
- Story tests can deterministically script async transitions through
  `Loading`, `Refreshing`, `Success`, `Failure`, `Stale`, and `Defect`.
- Failing scenarios identify the scenario name, step name, and original error.

Bugs to avoid and test:

- Drivers accepting events a slot did not publish.
- Keyboard/collection drivers assuming DOM order instead of declared slot
  metadata.
- Inline result resolution bypassing cleanup/finalizers or reactivity
  invalidation hooks.
- Test layers leaking across renders or scenarios.
- Scenario runners swallowing failures, continuing after a failed invariant,
  or losing the original thrown value.
- Stale-on-failure regressions, especially after a prior success followed by
  a failed refresh.

### P8/F7 — A11y Pattern Contracts And Behavior Packs

Full feature set:

- Pattern contracts for Dialog, Tooltip, Popover, Tabs, Slider,
  Calendar/DatePicker, DragAndDrop, and Combobox.
- Two-tier behavior catalog: stateful behavior packs and stateless attachment
  helpers.
- Pattern requirements covering slots, capabilities, required events,
  required/forbidden roles, ARIA relationships, focus behavior, keyboard
  behavior, and hidden/disabled state semantics.
- Integration with P3 diagnostics and P5 scene tests.

Success criteria:

- A component can declare a pattern contract and receive actionable diagnostics
  when rendered slots or attached behaviors do not satisfy it.
- Behavior packs publish their slots, provided bindings, out-events, and a11y
  obligations as inspectable metadata.
- At least Dialog, Tabs, and Combobox have end-to-end examples with a11y
  diagnostics plus zero-DOM scene tests.

Bugs to avoid and test:

- Treating role/attribute presence as sufficient when keyboard/focus behavior
  is missing.
- Requiring DOM-only concepts in renderer-neutral contracts.
- False failures for hidden slots that are intentionally not public.
- Pattern contracts drifting away from behavior-pack metadata.
- Event-name mismatches between declared required events and behavior outputs.

### P11 — Devtools And MCP

Full feature set:

- Registry snapshot inspection with atom values, pending state, errors,
  stale data, and dependency keys.
- Reactivity timeline for tracked/invalidating keys, loader refreshes,
  actions, optimistic updates, and diagnostics.
- Slot-contract tree inspection showing component contracts, rendered slots,
  attached styles/behaviors, a11y contracts, and diagnostics.
- Operation names are load-bearing: surfaced in timelines, metrics,
  diagnostics, and test-kit failure output.
- MCP surface for read state/history, inspect diagnostics, dispatch actions,
  rewind via hydrate/keyframes, and export minimal reproduction snapshots.
- History controls: `excludeFromHistory`, keyframe interval, redaction hooks,
  and dev-only/always-on visibility.

Success criteria:

- A user can answer "why did this refresh?", "what invalidated this atom?",
  "which action produced this stale result?", and "which slot failed the
  contract?" from one timeline.
- Rewind/replay is deterministic for serializable registry state and clearly
  reports non-serializable boundaries.
- MCP reads are safe by default and mutating operations require explicit
  opt-in.

Bugs to avoid and test:

- Memory leaks from unbounded history or unreleased keyframes.
- Sensitive data leaking into devtools/MCP snapshots without redaction hooks.
- Devtools observers changing scheduling, invalidation order, or action
  results.
- Operation-name collisions hiding distinct actions.
- Rehydrate/rewind corrupting pending async operations.

### P13 — Schema-Validated Action Inputs

Full feature set:

- Optional `inputSchema` for `Atom.action(...)` and route/server invokable
  action boundaries.
- Typed validation error channel that composes with existing action error
  types and `Result` states.
- Shared codec path with route/server schema validation where possible.
- Docs that keep compile-time typing as the local default and explain schema
  validation as a boundary feature.

Success criteria:

- Invalid dispatch input fails before user action code runs, with typed and
  serializable validation detail.
- Validated actions still infer input/output/error/requirements without
  explicit generics.
- Single-flight and server-invoked actions validate the exact same shape as
  local dispatch.

Bugs to avoid and test:

- Widening action error types to `unknown` or hiding validation errors in
  defects.
- Running validation after optimistic state has already been committed.
- Divergent local/server decode behavior.
- Schema transforms changing the action input type without matching runtime
  behavior.

### P4 — Theme Token Schema Follow-Up

Full feature set:

- Decide whether style property token helpers become user-theme-parametric or
  keep default-theme typing plus explicit escape hatches.
- Preserve `ThemeLight` as the default instance while allowing design systems
  to publish typed custom token schemas.
- Runtime lookup remains schema-agnostic and fails predictably for missing
  token paths.

Success criteria:

- Custom tokens like `brand.tertiary` and `surface.elevated.focusRing`
  type-check without module-wide casts.
- Invalid token paths fail at compile time on typed APIs and at runtime on
  dynamic APIs with a clear diagnostic.

Bugs to avoid and test:

- Recursive token types causing TS2589/deep-instantiation errors.
- Losing literal path inference through `Theme.define(...)`.
- Runtime token lookup silently returning the original token string for a
  missing path where a diagnostic is expected.

## Detailed Remaining Plan (from `docs/new_ideas.md`)

### Phase A — Core Type Surface (A / E / R) [high impact]

1. Introduce explicit public type model for modern atoms:
   - `ReadonlyAtom<A, E = never, R = never>` (or equivalent aliases)
   - `WritableAtom<A, E = never, R = never>`
   - ensure `Atom.map`/derived constructors return read-only variants
2. Ensure runtime binding eliminates `R` at construction sites:
   - `Atom.runtime(layer).atom(effect)` and `.action(effect)` preserve `A/E`, eliminate `R`
3. Acceptance criteria:
   - compile-time checks fail when effect requirements are not provided by runtime layer
   - README/API type examples show exact inferred `A/E/R` behavior

### Phase B — Composition Semantics [high impact]

1. Add runtime atom factory overload with dependency getter:
   - `apiRuntime.atom((get) => Effect<...>)`
   - `get.result(...)` contributes dependency error `E` into enclosing effect error union
2. Extend composition tests:
   - success + failure + defect propagation through 2-3 nested query/atom chains
   - assert inferred unions in type tests where practical
3. Acceptance criteria:
   - dependent async atoms can be composed without manual state unwrapping
   - error unions flow automatically through composed generators

### Phase C — Action API Completion [medium/high]

1. Evolve action handle to full typed form:
   - keep fire-and-forget call signature
   - add/align `run(...args): Effect<A, E>` semantics (or clearly documented equivalent)
   - retain reactive `result` + `pending`
2. Ensure tagged bridge errors stay explicit and documented.
3. Acceptance criteria:
   - actions are first-class in Effect composition pipelines
   - no untagged bridge errors in public signatures

### Phase D — Family / Schema / RPC Type Depth [medium]

1. `Atom.family` advanced options:
   - add optional `equals` policy for complex key stability
   - evaluate optional schema-validated family output path
2. `AtomSchema.struct` follow-up:
   - add nested struct examples and missing lifecycle helpers (`touch`/form-level aggregate operations) if needed
3. RPC/HTTP typing pass:
   - verify endpoint `E` types propagate to query/action handles end-to-end
4. Acceptance criteria:
   - realistic app-level examples infer cleanly without manual type annotations

### Phase E — Effect-Deep Integrations (long horizon)

1. Scope-first lifetime model hardening:
   - tighten owner/scope integration so scope is authoritative for cleanup
2. Scheduling and stream ergonomics:
   - retry/polling schedule options on async atoms
   - first-party stream operator recipes / helpers for UI input patterns
3. Observability:
   - optional tracing/metrics hooks around query/action execution
4. Acceptance criteria:
   - each feature ships behind clear docs and focused integration tests; no surface bloat in top-level API

### Phase F - Polish and Finalize
1. Make sure everything is correct. bug free. edgecases handled.
2. make sure types are correct, type checks, good inference / saftey.
3. everything has helpful and detailed doc comments
4. eveerything is properly tested, and tests pass.
5. readme is accurate and up to date.
6. core concepts are documented and easy to understand.
7. examples / guides are clear, and up to date, and correct, and educational.
8. the package builds correctly.

## In Progress / Next

- Slot contract unification is closed for now — `View.Slots` is the authored
  contract path, component slot axes are collapsed to `SlotContract`, typed
  style/behavior attachment is standardized, and declared-vs-rendered
  diagnostics are explicit-only.
### "Finish the plan" execution pass (2026-07-06/07)

Under an explicit directive to finish the plan (complete/documented/tested/
hardened), the following landed in one push (commits `c013264`..`64cf627`+):

- **All V1_SCOPE DECIDE markers resolved and the doc ratified** (Finding 2
  JSX-as-node, P6 routing survivors, P1 deferral, P7 single-package, S1
  mount-accepts-runtime, P12 v1.x, P13 boundary subset). See `V1_SCOPE.md`.
- **Finding 1** — `View.Slots.define` compression + cheap no-contract tier;
  golden path down to ~15 lines; docs/README/afui migrated. **Done.**
- **Finding 2** — decided (JSX is the authored surface; builders demoted);
  golden-path docs corrected. **Done for v1.**
- **Finding 4** — authored path proven to need zero explicit generics
  (`type-tests/slots-define.ts`); doc/example generic sites fixed. **Done.**
  Also surfaced: `src/__tests__` is outside the typecheck gate (~40 latent
  errors) — logged as a hardening TODO.
- **D1** — `View.TypeErrorMessage` + exported `BindableHandle` give readable
  branded compile errors for bad slot bindings, with error-text snapshots.
  **First slice done.**
- **Finding 3** — legacy `attach`/`attachByView` deprecated with migration
  JSDoc; canonical paths emit no deprecation noise. **Demotion done;**
  physical removal deferred to a consolidation pass.
- **Finding 5** — audited; **corrected a mis-belief** (routing/SSR still on
  `FetchResult`, disguised by a local `Result` alias, leaking the defect
  union); de-disguised the alias. **Migration scoped as a dedicated pass**
  (must ship with hydration round-trip tests — wire-format risk).
- **P2** — reactivity key witnesses shipped end-to-end (both slices).
- **S1/S2/S3/S4** — mount-with-runtime, `SERVICES_AND_LAYERS.md`, server
  request-scoping fix + isolation test, reactive-participant doctrine. Found
  and fixed a real bug: `ServerRoute.dispatch({ layer })` dropped the layer
  for data routes.
- **F6** — "when not to use this" in README/afui.
- **D2** — `llms.txt` first slice.
- **PR2** — completed-work log + fully-historical docs archived.

### What remains (honest state, updated 2026-07-09)

**All release-blocking items are done.** Finding-1/2/4/6, P2, D1, S1-S4, F6
(done earlier); Finding-3 resolved (2-tier attach model, no deletion);
Finding-5 release-blocking core done (loaderResult + title/meta emit unified
Result, defect union gone from public API); **P6 routing consolidation
resolved** (overload seam unified, commit `2e53de0`); **the deep type-helper
batch and both the test and example typecheck gates are closed** — all five
gates green and enforced. Along the way the test gate surfaced and fixed six
real library bugs (see the hardening item in the backlog).

The 2026-07-09 release-hardening audit found remaining concrete no-op seams
after the backlog closure; those are now fixed and covered:

- `Behaviors.focusTrap(...)`: tab-loop focus movement, activation focus, and
  shift-tab reversal over optional `focusables`.
- `Style.globalLayer(...)`: real Effect service publication plus resolved
  global stylesheet data and optional renderer apply hook.
- Advanced style descriptors: retained on handles for renderers/diagnostics
  instead of being discarded during attachment.
- `RouterService.preload(...)`: Browser/Hash/Server/Memory routers warm matched
  loaders via `runMatchedLoaders(...)` without changing location.
- `Route.lazy(...)`: demand-loaded, signal-backed, and explicitly preloadable.

The release-blocking work is done. The three tracked cleanups below are
complete; what is left is the v1.x proposals.

1. **Finding-5 step 2 — DONE 2026-07-08.** Introduced the `Serialization`
   service (schema-driven, injectable, `seroval`-swappable), migrated `Atom.pull`
   and then the loader cache + orchestration + wire types to core `Result`
   (codex branch, merged `3c1d14e`; post-merge cleanup `7fb31d0` to dedicated
   codec functions + typed-failure service). Wire kept backward-compatible.
   `FetchResult` is now compat-only (only the deprecated `loaderFetchResult()`
   accessor). Design note that shaped it: core `Result` carries `Cause`/`Exit`
   and is not JSON-safe, so the wire keeps a flat DTO — `FetchResult` the *type*
   is gone, its *shape* survives as the private `ResultWire` schema.
2. **PR3 — CI perf harness. Done 2026-07-08.** `.github/workflows/ci.yml` runs
   the gates on push/PR plus a non-blocking bench job (artifact upload);
   `ui-hot-paths.bench.ts` adds the style + component-mount benchmarks.
   Threshold-based hard gating deferred until a stable runner/baseline exists.
3. **PR2 residual doc sweep — DONE 2026-07-08.** Live reference docs carry no
   broken markdown links to archived docs; fixed remaining bare-path pointers
   in `API.md` (SINGLE_FLIGHT* guides) and `AGENTS.md` (AF_UI_CONTRACT) to
   point into `docs/archive/`.

### Then: v1.x proposals (not release-blocking)

  - **Open redesign TODO backlog is empty (2026-07-09).** Residual product depth
    (full WAI-ARIA certification, richer Form single-flight wiring, full MCP
    panel UI, Effect 4 stable for 1.0) is outside the checkbox list.
  - Release readiness: gates green; Effect beta remains only external 1.0 hard gate.

## Update Rule For This File

Whenever redesign work lands:

1. Add/remove items in **Completed So Far**.
1b. Keep TODOs in **TODO Backlog** updated.
2. Add the new commit hash in **Recently Completed Commits**.
3. Refresh **In Progress / Next** to reflect the next actionable step.
4. Update the `Last updated` date.
