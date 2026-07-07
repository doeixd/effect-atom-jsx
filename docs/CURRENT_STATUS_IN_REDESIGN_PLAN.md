# Current Status In Redesign Plan

Last updated: 2026-07-06 (design review findings + ergonomics workstream)
Plan reference: `docs/DESIGN_OVERHAUL_V1_PLAN.md`, `docs/V1_API_CONTRACT_DRAFT.md`, `docs/EFFECT_NATIVE_ENHANCEMENT_PLAN.md`, `docs/new_ideas.md`

V1 scope authority (draft, needs ratification): `docs/V1_SCOPE.md`

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

- Redesign is actively in progress.
- We are taking a breaking-change-first approach to reduce API overlap and legacy aliases.
- Core direction is now visible in code (not only docs): smaller top-level exports, stronger action/query primitives, and clearer internal boundaries.
- AF-UI convergence is now the active architecture track. Slot contract
  unification is closed for now; the active follow-up is the
  typesafety/composability track from `docs/new_ideas.md`.

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

## Services & Layers Review (2026-07-06)

Reviewed how services/layers work across the library. The mechanics are
sound: requirement subtraction (`Component.require` + `withLayer`),
setup-inferred requirement bubbling, capture-at-setup ServiceMap semantics,
runtime requirement subsets (`RReq extends R`), and framework services as
ordinary tags (`Reactivity`, `Theme`, platform tags, single-flight
transport). What's missing is the story layer, plus one structural decision.

### S1 — The two-runtimes question (structural, needs a DECIDE)

`Atom.runtime(layer)` and `Component.mount(..., { layer })` create two
service worlds, and real apps will have both: module-level runtime-bound
atoms plus a mounted tree with `withLayer` islands. A component reading an
atom bound to runtime A while executing under mount layer B resolves each
side in its own world — consistent but undocumented, and a "works in app,
breaks in test" trap (e.g. two `Reactivity` instances).

Direction:

- Now: document the one-composition-root golden path — build one
  `AppLayer`, feed it to both `Atom.runtime(...)` and
  `Component.mount(...)`; never construct two separately-configured worlds.
- DECIDE for v1: whether `Component.mount` should accept the `AtomRuntime`
  directly (structurally one world) instead of/in addition to a raw layer.

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
- [ ] Continue typesafety/composability track from `docs/new_ideas.md` (breaking changes allowed when they improve coherence).
- [ ] Golden-path compression (Finding 1): reduce the authored slot-contract Field example to ~15 lines via contract-inferring sugar (`Component.slots(...)` / `Component.viewFromSlots(...)` or equivalent) without losing the published contract.
- [ ] Cheap tier for one-off structure (Finding 1): document and, if needed, add a no-contract authoring tier for private/app-local components with zero slot ceremony.
- [ ] Witness-aware JSX authoring (Finding 2): produce typed `tree` metadata from JSX instead of hand-written `View.element(...)` chains; demote builder calls to the generated/renderer-neutral layer.
- [ ] Attachment API consolidation (Finding 3): **demotion landed 2026-07-06** — `Style.attach`, `Style.attachByView`, and `Behavior.attach` carry `@deprecated` JSDoc with migration notes to the three canonical forms; internal callers repointed at non-deprecated impls so canonical paths emit no deprecation noise; API.md updated. Remaining: physical removal in the v1 consolidation pass after migrating the tests/behavior-pack call sites that still use the legacy forms.
- [ ] Finish the `View.make` + `slotMetadata` demotion sweep (Finding 3): generated/dynamic escape hatch only; decide public fate of `View.slot(...)` / `View.hidden(...)`.
- [ ] Inference audit (Finding 4): **authored path verified 2026-07-06** — `src/type-tests/slots-define.ts` proves the golden path (props/require/setup-inferred bindings + `withSlots` contract + `forSlots` attachments) needs zero explicit generics, including precise `SlotContractOf` extraction and unknown-slot rejection; doc/example generic sites corrected (`PROPS_BINDINGS_SLOTS.md`). Remaining, reclassified: the legacy bindings-as-slots convention (tests using `Component.make<{}, never, never, Bindings>` + string-map validation) genuinely requires annotations — that is one more reason it is the deprecated tier, and those sites migrate as part of the Finding-3 demotion rather than being force-de-generic'd.
- [ ] **NEW (hardening, found during Finding 4):** `src/__tests__` is excluded from the `npm run typecheck` gate, and checking it reveals ~40 pre-existing type errors in test files (see `tsconfig.tests-check.json`, kept in-repo as the checking config). Add a test-typecheck gate and burn the errors down; until then, test-file edits are only validated by vitest's esbuild transform, not by tsc.
- [ ] Complete Result consolidation as release-blocking (Finding 5): **audited 2026-07-06/07** (see `RESULT_CONSOLIDATION_PROPOSAL.md` audit table). Corrected a mis-belief: the **routing/single-flight/SSR layer still emits `FetchResult`, not unified `Result`** — `Route.ts` imported it under a local `Result` alias that disguised the divergence, and `Route.loaderResult().Failure.error` leaks the `E | { defect: string }` union. **Step 1 done:** renamed the misleading alias to `FetchResult` in `Route.ts`/`router-runtime.ts` (pure rename, gates green) so the gap is no longer hidden. Remaining (dedicated pass, ~60 sites): migrate loader/single-flight/SSR/`Atom.pull` off `FetchResult` — **must land with hydration round-trip tests** because the model is on the SSR wire and a mismatch fails silently. Scoped 6-step plan in the proposal.
- [ ] Typed-tree-by-default + claims sweep (Finding 6): authored views always carry `tree` metadata; docs scope type-safety claims to enforced boundaries.
- [ ] Behavior binding contracts + state-aware styling (P1): `Behavior.provides(...)` witness and `Style.whenBinding(...)`-style composition.
- [x] Reactivity key witnesses (P2): **complete 2026-07-06** (see archive log, slices 1-2) — `Reactivity.Key.make/family/is`, `KeyNameOf<T>`, hierarchical `child(...)` with record-form parity; witnesses accepted across `tracked`/`invalidating`, atom/action/component options, and all Route/loader-cache intake sites; README/API/afui docs lead with witnesses, strings remain the dynamic escape hatch; runtime + type + loader integration coverage, gates green.
- [ ] Unified diagnostics pipeline (P3): shared `Diagnostic` type + dev-mode auto-report layer + static CLI/CI check entry point.
- [ ] User-declared token schema (P4): theme taxonomy as user schema with `ThemeLight` as default instance.
- [ ] Test kit (P5): component render driver, DOM-free behavior driver, style data assertions.
- [ ] Routing consolidation (P6): unified route model + `RouterRuntime` canonical; deprecate-and-delete the earlier generations.
- [ ] Package boundary decision (P7): split vs single package before v1; enforce internal layering either way.
- [ ] Review and ratify `docs/V1_SCOPE.md` (PR1): resolve the marked decisions; use it to triage all other backlog items.
- [ ] Plan-doc consolidation sweep (PR2): **partially done 2026-07-06** — completed-work log (~860 lines) extracted to `docs/archive/REDESIGN_COMPLETED_LOG.md` with a high-level summary left in place; `BINDINGS_VS_SLOTS_REFACTOR.md`, `style2.md`, `STYLE2_IMPLEMENTATION_PLAN.md` moved to `docs/archive/` (no live inbound links). Remaining: the "older exploratory" docs (`view.md`, `router.md`, `style.md`, `composables.md`, `renderer.md`, `platform.md`, and similar) still carry historical-note banners but are linked from live docs — move them only with a reference-updating pass.
- [ ] Perf benchmark harness in CI (PR3): js-framework-benchmark subset + style-update microbenchmark with regression threshold.
- [ ] Compile-error engineering (D1): **first slice landed 2026-07-06** — `View.TypeErrorMessage<Message>` branded diagnostic; `View.BindableHandle<S, H>` (now exported) resolves invalid bindings to a readable message (`Handle capability 'Container' does not satisfy slot 'input' capability 'TextInput'`) instead of `never`; compile-time error-text snapshots in `src/type-tests/slots-define.ts` assert the exact message plus hierarchy-aware acceptance. Remaining: apply the same `TypeErrorMessage` treatment to attachment (`attachToSlots` capability/event mismatches) and remap boundaries.
- [x] AI-assistant guidance artifact (D2): **first slice landed 2026-07-07** — `llms.txt` at repo root with the core mental model, correct golden-path snippets, and a renamed/removed "do not emit" table (the type-checked-generation-as-a-feature framing from F4). Remaining: publish/package as an agent skill and keep versioned with the API.
- [ ] Scaffolding (D3): `create-af-ui` starter + slot-contract component generator.
- [ ] A11y pattern contracts (P8): pattern-level slot/behavior contracts validated via the P3 diagnostics pipeline.
- [ ] Forms vertical (P9): `Form` module composing schema fields, actions, optimistic, single-flight, and server validation errors.
- [ ] Exit-animation ownership note (P10): decide who owns deferred unmount before the renderer contract hardens.
- [ ] Devtools + MCP (P11, post-v1 but designed now): registry snapshots, invalidation timeline, action/optimistic lifecycle, slot-contract tree; MCP read/rewind/dispatch; history/keyframe knobs.
- [ ] Gated subscription primitive (P12): `Atom.Stream.gated(...)` / `Component.subscription(...)` with dep-driven scope restart and restart-policy escape hatch.
- [ ] Amend P5 with story/scene test taxonomy and naming conventions (F3).
- [ ] Amend D2 with the AI docs section: type-checked generation as a feature + MCP runtime half (F4).
- [ ] Amend P1 design to include a typed behavior out-event axis alongside published state (F5).
- [x] Add "when not to use this" section to README/afui.md (F6): **done 2026-07-06** — added to `README.md` (Overview), `README.new.md`, and `docs/afui.md`, each claiming the incremental-adoption/SSR ground competitors concede.
- [ ] Amend P8/behavior pack with the two-tier taxonomy and catalog roadmap: Dialog, Tooltip, Popover, Tabs, Slider, Calendar/DatePicker, DragAndDrop (F7).
- [ ] Amend P5 with inline outcome resolution: `resolveAction(...)` / `resolveQuery(...)` driving handle `Result` without mock layers (F8.1).
- [ ] Amend P11 so operation `name` is load-bearing: timeline, `observe` metrics, diagnostics, docs nudge (F8.2).
- [ ] Schema-validated action inputs (P13): optional `Atom.action(fn, { inputSchema })` with typed boundary error; prioritize for single-flight-invokable actions (F8.3).
- [ ] Two-runtimes decision (S1): composition-root doctrine **documented 2026-07-06** in `docs/SERVICES_AND_LAYERS.md`; the DECIDE (should `Component.mount` accept an `AtomRuntime`) remains open for V1_SCOPE ratification.
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
- [ ] Keep status tracker updated after each landed redesign change.

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
- **F6** — "when not to use this" in README/README.new/afui.
- **D2** — `llms.txt` first slice.
- **PR2** — completed-work log + fully-historical docs archived.

### What remains (honest state)

Three **dedicated passes** — each too large/risky to fold into feature work,
all release-blocking:

1. **Finding-5 Result migration** (~60 sites across routing/SSR/single-flight/
   `Atom.pull`). Blocked on: needs hydration round-trip + serialize/deserialize
   tests because the model is on the SSR wire (silent-failure mode). Plan in
   `RESULT_CONSOLIDATION_PROPOSAL.md`.
2. **Finding-3 + P6 physical deprecate-and-delete** (legacy attach forms,
   legacy route service generation). Blocked on: migrating the tests and
   behavior-pack/example call sites that still use them first.
3. **PR2 exploratory-doc archive sweep** with inbound-link updates
   (`view.md`, `router.md`, `style.md`, `composables.md`, `renderer.md`,
   `platform.md`).

Plus the **test-typecheck gate** hardening (add the gate, burn down the ~40
latent errors) — `tsconfig.tests-check.json` is in-repo as the checking config.

### Then: v1.x proposals (not release-blocking)

  - Round-2/3 proposals P1, P3–P5, P8–P13 and Foldkit F1–F7 amendments — see
    their sections above. Suggested first: P2 is done, so P1 (behavior
    binding contracts + state-aware styling, now with F5's out-event axis)
    and P11 (devtools + MCP, design against Registry/Reactivity before the
    runtime surface freezes).
  - Continue typesafety/composability track from `docs/new_ideas.md` (breaking changes allowed when they improve coherence):
    - Continue migrating selected examples/guides to the setup builder where it improves readability.
    - Continue migrating consumers toward the new `Atom<A, E, R>` metadata instead of result-wrapper-only extraction.
    - Continue propagating the new type metadata through remaining downstream consumers and docs.
    - Continue auditing route-node/server-route integration for requirement metadata preservation as new helpers land.
  - Keep `AF_UI_CONTRACT.md`, `GEN2_UI_IMPLEMENTATION_NOTES.md`, `AGENTS.md`, README, and API docs aligned as the public model changes.
  - Release readiness pass: keep changelog/status aligned and require full typecheck/test/build green before release cut.

## Update Rule For This File

Whenever redesign work lands:

1. Add/remove items in **Completed So Far**.
1b. Keep TODOs in **TODO Backlog** updated.
2. Add the new commit hash in **Recently Completed Commits**.
3. Refresh **In Progress / Next** to reflect the next actionable step.
4. Update the `Last updated` date.
