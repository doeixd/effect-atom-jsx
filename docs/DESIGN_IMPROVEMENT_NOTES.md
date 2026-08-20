# Design Improvement Notes

Date: 2026-07-29
Scope: consolidation-level observations across the whole library, written
after Milestones 0–7 of the resumability program landed and Milestone 8 was
designed. This complements the per-milestone "Design Review Notes" section in
`RESUMABILITY_IMPLEMENTATION_PLAN.md` (which tracks tactical defects); this
document tracks structural improvements and the reasoning behind their
priority. Items are ordered by leverage, not effort.

## 1. Consolidate the two `Result` models (high leverage)

There are two result types with different shapes and guarantees:

- Core `effect-ts` `Result`: `Loading | Refreshing | Success | Failure |
  Stale | Defect`, carries `Exit`/`Cause`, not JSON-safe. Used by queries,
  atoms, mutation handles.
- `Result.ts` fetch model: `Initial | Success | Failure` with
  `waiting`/`previousSuccess`/`timestamp`, JSON-safe-adjacent. Used by
  loader wire formats via `Serialization.ResultWire`.

Every wire feature pays a conversion tax at this seam (query resume hit the
`Stale` branch and timestampless `Success` explicitly; the router pays it in
`resultToWire`). Proposed end state: **one core model plus one canonical
wire projection module** — the core keeps `Exit`/`Cause` richness, the
projection is the single settled/serializable DTO, and no other module
hand-rolls the mapping. The P15 plan entry (richer Result states) should be
folded into this rather than executed against the fetch model separately.
Best sequenced at the start of Milestone 9, before any new wire feature
multiplies the seam again.

## 2. Unify the identity families (high leverage, partially done)

Three string identity families grew up independently:

- **Hydration keys** (`c0/count`, family+args) — value continuity.
- **Reactivity keys** (`users:42`, hierarchical) — invalidation.
- **Portable code ids** (`app/save.ts#save` + build ID) — executable
  addressing.

The M8 design ratified the first unification: binding hydration keys double
as implicit reactivity keys (`af:binding:<id>/<name>`). Remaining work:

- Document the three families and their namespaces in one place (the guide)
  so authors stop inventing overlapping keys.
- Reserve the `af:` prefix formally (collection should diagnose authored
  keys that enter reserved namespaces).
- Decide whether query `cacheKey` (descriptor-derived) is a fourth family or
  an alias of portable identity — it should be documented as the latter.

## 3. Milestone 9 before Milestone 8b (historical sequencing recommendation)

M8a (collection-only) is cheap and safe to do now. But the SPI freeze,
diagnostics audit, and manifest compatibility tests of Milestone 9 should
land **before** M8b grows the client surface again:

M8b subsequently landed as a deliberately narrow adapter-facing vertical
slice. It reused the shared resolver, component snapshot values, boundary
state machine, and diagnostics channel; it did not publish a second cache,
wire DTO, or general renderer SPI. M8a also added expression size attribution.
The broader export audit, explicit cross-version fixtures, and stability
policy below remain Milestone 9 work.

- Audit which advanced APIs the two proof fixtures actually required and
  demote everything else from public exports (`advanced`/`internals`
  boundaries have drifted during the program).
- `ResumePayloadTooLargeError` needs per-component/per-binding size
  attribution before real applications hit the 64 KiB ceiling.
  (**Done 2026-08-12**: entry, binding, AND capture attribution —
  `largestEntryKind/Id/Bytes`, `largestBindingName`, `largestCaptureName`.)
- Manifest v1/v2(/v3) decoding needs explicit cross-version fixture tests,
  not just union schemas.
- ~~The `Behavior.attachScoped` `Exclude<Req, Scope>` cast should either gain
  a principled implementation or a documented justification; it is the one
  type assertion in the resumability surface.~~ **Resolved 2026-07-30 —
  proven, not merely plausible.** A `future/` spec confirmed the *provided*
  Scope is the one that closes (not just that some Scope exists): finalizers
  registered inside the attached behavior run on `Scope.close` of the caller's
  scope. The cast is therefore sound and needs only a doc comment recording
  the proof, not a reimplementation. Note the adjacent machinery verified
  sound in the same pass: `acquireRelease`, `forkScoped` interruption, and
  double-dispose no-op. The one *unsound* path found is `Element.Handle.on()`
  — see item 12.

## 4. Compiler identity hardening (medium)

- Ordinal identities (`module#$0`) renumber when an earlier unassigned
  `extract`/`expr` call is added. Safe within a build, but churns
  cache/prefetch identity across deploys. With the Vite manifest now in
  place, add a content-hash discriminator for the ordinal case, or a lint
  requiring `const` assignment.
- The M7 marker detection is import-source-suffix based and configurable;
  document the false-positive story alongside the Vite plugin rather than
  in code comments only.
- `sourceModules` (first-build virtual-entry discovery) is a manual list;
  a glob option would remove the "forgot to register the module" failure
  mode, at the cost of a startup scan. Worth it once more than a handful of
  extracted modules exist. (**Done 2026-08-12**: glob specifiers expand
  against the project root, M10 item 5.)

## 5. Renderer seams for M8c (medium, blocking attribute expressions)

Attribute/class/style expressions have no runtime boundary — the compiler
emits bare `effect(() => attr(...))`. M8c needs compiler-emitted helpers
(`attrExpr(el, name, id, fn)`), which is also the opportunity to fix two
adjacent runtime issues:

- `insertExpression` replaces text nodes instead of assigning `.data`; node
  reuse is both a patch-in-place prerequisite and an ordinary-runtime win.
- `reconcileArrays` is unkeyed; keyed rendering is the precondition for
  ever lifting the M8 list fence, and independently valuable.

## 6. Surface-area and stability management (project-level)

- The library spans reactive core, JSX runtime, atoms, router, SSR,
  hydration, forms, a11y, theming, devtools, resumability, and a compiler,
  on top of `effect@4.0.0-beta`. Expansion has outpaced consolidation;
  items 1–3 above are the concrete consolidation backlog.
- "Prefer the coherent final API" has served the design well, but the
  resumability program introduced deployment-facing contracts (manifest
  versions, build IDs, code identities) that now need a stated stability
  policy distinct from the prerelease API policy: wire formats should
  version explicitly even while TypeScript APIs stay fluid.
- Positioning: the natural audience is Effect-committed teams; the Effect
  requirement is the filter *and* the differentiator. Feature decisions
  that dilute Effect-nativeness to widen appeal would spend the project's
  main asset. The M8 server-push-invalidation capability (a Reactivity
  layer bumping keys over a socket patching dormant pages) is the kind of
  headline feature no competing model can express — worth a dedicated
  example when M8b lands.

## 7. Measurement accountability for the M8 bet (carry into M8c)

The M8 design bets that a small number of declared expressions captures most
perceived-liveness value, with everything else activating on interaction. The
bet is falsifiable and should be tested, not assumed:

- Fixture apps should include a "realistic density" page (10–30 live
  expressions) alongside the minimal proofs.
- If M8c metrics show the fences too tight (manifest growth, authoring tax),
  the planned response is keyed lists and compiler-inferred deps — not
  signal serialization. Recording this here so the fallback direction is a
  decision, not a debate.

## 8. Smaller items (tracked, low urgency)

- Guide: add a worked custom-codec example for class instances (Date/Map
  already covered) and a section documenting the reserved key namespaces
  from item 2.
- `Resume.ts` has two `globalErrorInEffectFailure` lint warnings (untagged
  `Error` in failure channels) — tagged errors would restore channel
  precision.
- The OptMem note limit (280 bytes) plus PowerShell regex quoting quirks
  are operational friction for multi-agent coordination; not a library
  concern, but recorded since this repo's workflow depends on it.

## 9. Router & data layer consolidation (high leverage — added 2026-07-29)

A full audit of the routing/data layer found it a tier below the
resumability program in design discipline: a load-bearing process-global
route registry populated by construction side effects, three coexisting
authoring tiers (unified-route guards/transitions/error-cases stored but
never executed), a nested-route path-identity bug on the documented golden
path, two navigation stacks that never meet (`Route.Link` never drives
`RouterRuntime` supersession), fail-open surface (declared-but-unread
options, unvalidated single-flight wire, untagged errors, `unknown` server
error channels), and two path-matching engines with different semantics.
Its genuinely strong ideas — reactivity-captured loader revalidation,
single-flight, RouterRuntime supersession, pure-data ServerRoute — deserve
the consolidation. Full findings, sequenced workstreams (R1 correctness →
R2 de-globalize → R3 one tier → R4 one nav stack → R5 wire/error hygiene →
R6 = Milestone 11), acceptance criteria, and open decisions live in
`ROUTER_CONSOLIDATION_PLAN.md`. R2 is a hard prerequisite for Milestone 11.

## 10. Research note: DOM-as-source seed readback (low priority, added 2026-07-29)

The one remaining irreducible double-data residue is declared state seeds
duplicating their rendered projection (manifest `count: 41` vs HTML `"41"`).
For seeds whose codec round-trips losslessly through their rendered text, the
manifest could carry a *region reference* instead of the encoded value, and
restoration would parse the seed back out of the SSR DOM (Marko''s
"HTML as the database" direction). This is schema-compatible with the
existing design — a codec whose encoded form is "read region x<N>" — but is
fragile against formatting, locale/i18n rendering, and any projection that
is not injective. Rank: research note, not a milestone. Preconditions if
ever pursued: per-seed opt-in, a compile-time proof (or runtime SSR check)
that render(encode(x)) is invertible, and a fail-closed fallback to the
inline seed when the parse disagrees with a checksum. Payload-size wins
should be demonstrated by the 8c.1 harness before any implementation.

## 11. Slot-as-projection-element: unify View.Slots with resume regions (design direction, added 2026-07-29)

Solid 2.0 makes `<props.children/>` an explicit projection element — children
evaluate at placement, not at passing — so server/client content interleaves
without forcing cross-boundary evaluation or payload wrappers. Implications:

- Validation: that is the anonymous special case of `View.Slots`; the
  interleaving *outcome* we already achieve via nested comment-pair regions
  (M8b proves dormant parent + live child with zero parent evaluation).
- The actionable idea: an explicit slot projection element
  (`<Slot.render name="..."/>`-shaped) would (a) make child evaluation lazy
  at boundaries (today composition passes eagerly rendered elements), and
  (b) give slots renderer-visible placement — the safe path to lifting the
  "slots do not identify DOM nodes" non-goal by letting a slot emit a
  comment-pair region *as itself*: **slot = named region**. That unifies
  the compile-time slot contract with runtime resume identity, gives
  Milestone 11b typed named mount targets ("mount fragment into slot
  `body`"), and offers M8c a cleaner boundary-metadata seam.
- Watch-item: projection semantics may land upstream in
  babel-plugin-jsx-dom-expressions (our compiler lineage) as Solid 2.0
  stabilizes — an ABI event (pinned by the jsx-runtime-abi test) that could
  be leverage or forced migration; track it.
- Sequencing: design after M11/M11b (regions and incremental install must be
  settled first); pairs naturally with the R3 authoring-tier consolidation.

---

Items 12–21 were found on **2026-07-30** by writing the `future/` specification
suite (executable specs for the component kit, resumability hardening, and
streaming). They are library-wide; kit-specific phase decisions live in
`COMPONENT_KIT_PLAN.md`. Every claim below was checked against source and
carries a file:line anchor.

## 12. `Element.Handle.on()` cleans up via the reactive owner, not the Scope (proven defect, highest priority — added 2026-07-30)

`on()` (`src/Element.ts:170-176`) obtains the removal function from `listen()`
and then registers it with `onCleanup`, tying teardown to the **reactive
owner**. Under `Behavior.attachScoped` — the resume/reattach path — and under
`Component.setupEffect` there is no reactive owner, so `onCleanup` has nothing
to attach to and **the listener survives both `dispose` and `Scope.close`**. A
spec proved it: a press handler acquired via `on()` fires twice after disposal.

Why it matters: this is a listener leak on precisely the path resumability
depends on, and it falsifies the component kit's headline invariant ("closing
the scope removes every listener the behavior installed"). It is also invisible
to callers, because `on()` is the ergonomic form and returns `Effect<void>`
while the leak-free form (`listen()`, which returns the cleanup) is the one
authors are steered away from.

Recommended shape: register removal on the ambient `Scope` (acquireRelease
style), falling back to the reactive owner only when no `Scope` is present in
context. Add a regression test asserting a listener acquired via `on()` is dead
after `Scope.close` **with no reactive owner in play** — the existing tests all
happen to run under an owner, which is why this survived.

Priority: highest. It is a correctness defect, not a consolidation item, and it
blocks any honest statement of the scope invariant.

## 13. `attachToSlots` takes the slot contract from the caller, so "mis-wiring is a type error" is unenforceable (high leverage — added 2026-07-30)

`Behavior.attachToSlots` (`src/Behavior.ts:595-616`) and `Style.attachToSlots`
(`src/Style.ts:884-891`) both take the slot contract as an argument the
**caller** chooses. Capability is only ever checked between the behavior and
that argument. The check against the *component* is

```ts
Component.SlotsOf<C> extends Record<SlotContractTargetNames<S>, Element.Handle | Element.Collection<Element.Handle>>
```

(`src/Behavior.ts:607`) — a **name-only** check. Since `Element.Handle` is the
top of the capability lattice (`src/Element.ts:16`, with `Interactive`,
`Container`, `Focusable`, `TextInput` all extending it), a Container-capability
slot happily satisfies a TextInput-needing behavior as long as the caller passes
a contract claiming otherwise.

Why it matters: this is the AF-UI headline guarantee — "attaching the combobox
behavior to a slot lacking text-input capability is a type error" — and it does
not hold. That guarantee is documented as a principal reason the framework is
worth its Effect-shaped cost.

Recommended shape: derive the contract from the **component**, never the
caller, and make the remap the only argument:

```ts
Behavior.attachTo(behavior, { container: "root" })
```

where keys are `keyof Behavior.ElementsOf<typeof behavior>` and the permitted
values are the component's slot names whose capability satisfies the required
one. Identity attachment then needs no map at all. Note the record branch of
`SlotContractInput` (`src/Behavior.ts:75-84`) already models a remap, but it is
undocumented, capability-unchecked, and structurally indistinguishable from the
contract branch — which is why spec authors reached for `as any` at essentially
every attachment site (99 `as any` occurrences across the suite).

Priority: high. Pairs with item 14 (one target source) and item 21 (runtime
capability validation); together they are the "attachment means something"
workstream.

## 14. Style and Behavior attach through different target sources, and a mismatch silently no-ops (high — added 2026-07-30)

`Style.attachToSlots` delegates to `attachByViewImpl` (`src/Style.ts:777`,
returned at :890) — the **rendered `View`** — while `Behavior.attachToSlots`
delegates through `attachBySlotContract` to `attachBySlots`
(`src/Behavior.ts:586`, :529) — **`bindings.slots`**. A component must
therefore satisfy both surfaces; if it publishes one and not the other,
styling silently does nothing and **no diagnostic is emitted**.

Recommended shape: pick one target source of truth (the rendered `View` is the
better candidate, being what actually exists in the DOM), or require both and
emit a drift diagnostic when they disagree. Either way, record the decision —
the current state is an unstated invariant that authors discover by seeing no
styles.

Priority: high, low effort. This is a decision plus a diagnostic, not a
redesign.

## 15. `Style.forSlots` — the *recommended* authored path — throws away binding inference the "low-level" `Style.make` keeps (high — added 2026-07-30)

Compare `src/Style.ts:401-405`:

```ts
export function make<const Styles extends Record<string, StyleValue>>(
  slots: Styles,
): ComposedStyle<keyof Styles & string, BindingNamesOfStyleMap<Styles>>
```

with `src/Style.ts:416-428`, where `forSlots` returns
`ComposedStyle<SlotContractNames<W>>` — the `Bindings` parameter defaulted
away, i.e. **erased to `never`**.

Consequence: the `StyleBindingCompatible<typeof style, C>` check in
`Style.attachToSlots` (`src/Style.ts:888`) becomes **vacuous on the golden
path**. The compile-time guarantee documented on `whenBinding`
(`src/Style.ts:343-348`: "Attaching the style to a component that does not
expose that binding produces a compile-time error") is silently lost exactly
where the docstring at :398 steers authors ("Prefer `Style.forSlots(...)` for
authored component APIs"), while surviving on the path labelled lower-level.
Separately, `forSlots`'s styles map is fully optional
(`{ readonly [K in SlotContractNames<W>]?: StyleValue }`), so it cannot express
"this recipe must cover every slot".

Recommended shape: thread `BindingNamesOfStyleMap` through `forSlots` so the
authored path keeps what the raw path has. Consider going further and making
the binding a **witness carrying its value type** (reusing the existing
`Behavior.binding<Name, A>` shape) so `whenBinding`'s `predicate` can be
`A | ((value: A) => boolean)` rather than an untyped probe. Add an option (or a
second entry point) for exhaustive slot coverage.

Priority: high. A documented compile-time guarantee that does not fire on the
recommended path is worse than no guarantee.

## 16. The published customization surface has no nameable types, and the slot-contract types are duplicated (medium-high — added 2026-07-30)

The following are all bare, **unexported** module-level declarations:

- `RecipeDef` (`src/Style.ts:1083`), `VariantDef` (`src/Style.ts:1034`)
- `SlotContractInput` / `SlotContractNames` / `SlotContractTargetNames`
  (`src/Style.ts:16-24` **and** `src/Behavior.ts:75-84` — duplicated verbatim)
- `ElementsForSlotContract`, `HandleForCapability` (`src/Behavior.ts:85-98`)

Why it matters: the no-fork story is "the kit publishes recipe data and
consumers patch it", yet a consumer cannot write
`const patch: Style.RecipePatch<typeof kitRecipe> = …`, nor a helper generic
over `S extends Style.SlotContractInput`. The customization surface is
expressible only by inference at the call site, which means it cannot be
stored, passed, or wrapped. The verbatim duplication additionally guarantees
the two modules' notions of a slot contract will drift.

Recommended shape: hoist the slot-contract types into one module
(`src/slot-contract.ts`) and re-export from both `Style` and `Behavior`; export
the recipe/variant types (`RecipeDef`, `RecipeSelection`, `VariantDef`,
`VariantSelection`) under the namespaces that consume them. This is a concrete
instance of the advanced/internals boundary drift item 3 flagged for the M9
export audit — fold it in there rather than tracking it separately.

Priority: medium-high; cheap, and it is a precondition for the no-fork
customization story being demonstrable in a spec without casts.

## 17. `getAttr`/`setAttr` are `unknown`-typed and attribute value coercion is unspecified (medium — added 2026-07-30)

`getAttr(name: string): unknown` and
`setAttr(name: string, value: unknown | (() => unknown))`
(`src/Element.ts:21-22`) force a cast at every read. Worse, no coercion
contract is stated anywhere: the test-handle implementation stores whatever it
is given verbatim (`src/Element.ts:184-196`), so specs legitimately assert
`aria-invalid === true` (boolean) next to `tabIndex === 0` (number) — while a
DOM renderer must stringify. Two renderers can both be "correct" and disagree.

Recommended shape: key `getAttr`/`setAttr` to the existing
`View.AttributeName` metadata tokens with declared value types per token, and
state the coercion rule **once** (in the `Handle` doc comment) so test handles
and DOM handles are required to agree.

Priority: medium. Not a defect today, but every spec and renderer written before
it is settled encodes an assumption.

## 18. Theme cannot express the two-level palette the kit's token architecture requires (medium-high — added 2026-07-30)

`ThemeService` is a single `Context` service holding a single tokens schema
(`src/Theme.ts:15-21`), and `define(...).layer()` builds a **complete** service
(`src/Theme.ts:97-108`). So `Layer.merge` of a "palette" layer and a "semantic"
layer does not merge their token schemas — one wins outright. The
"raw palette → semantic derivation" architecture is therefore unreachable as
two layers, which is how token systems are normally authored.

Compounding it:

- Token references are untyped strings and `lookupToken` **fails open**,
  returning its own input on a miss (`src/Theme.ts:93`). A typo like
  `"color.blu500"` resolves to the literal string `"color.blu500"` and lands in
  the emitted CSS, where it is inert and silent.
- `resolve: (token: string) => string` (`src/Theme.ts:18`) is stringly-typed in
  both directions.
- `ThemeDefinition.lookup(token: string): unknown` (`src/Theme.ts:35`) forces
  `String()` at call sites — which is exactly what `layer` itself does
  (`src/Theme.ts:106`).

Recommended shape:

```ts
Theme.extend(palette, (p) => ({ color: { brand: p.path("color", "blue500") } }))
```

producing **one** layer with a merged schema and typed references.
`ThemeDefinition.path(...)` (`src/Theme.ts:31-34`) already exists and is
exactly the right primitive — authors should never write a raw reference
string. Make `resolve` path-keyed and return the declared value type; make an
unresolvable token a **diagnostic, not a pass-through**; and brand token values
per category (`Theme.TokenValue<"color">`) so a color cannot be dropped into a
spacing slot.

Caveat on scope: the fail-open and stringly-typed findings are verified against
current source. The `Theme.lightDark(...)` category-confusion concern is about
an API that **does not exist yet** — it appears only as a proposed helper in
`future/components/a11y-and-native-floor.spec.ts:190,196`. Treat it as a design
constraint on that helper if it is built (it should return a branded
`TokenValue<Category>`, not a plain string), not as a defect.

Priority: medium-high — it gates the kit's token architecture, and the fail-open
lookup is an independent silent-failure bug worth fixing on its own.

## 19. `View.Slots.define` binds one handle per slot at define time, so two instances of one widget share slot handles (design fix for a proven defect — added 2026-07-30)

`View.Slots.define` (`src/View.ts:603-612`) calls
`Element.handleFor(slot.metadata.capability)` once per slot **at definition
time** and stores the result in `bound[name].handle`; `Slots.handles()`
(:614-620) hands back those same objects. A slot contract is module-level, so
every mount of the widget shares one handle per slot.

The defect itself is already recorded elsewhere (mounted widgets overwrite each
other's attributes, styles, and listeners; resume identity cannot distinguish
the regions). What belongs *here* is the **design fix**: handles must be created
per component instance — per mount, i.e. per `Scope` — with `Slots.define`
producing a *contract/factory* and the handle materialising at setup/render
time.

Why it matters beyond the immediate bug: this is load-bearing for slot identity
generally. It interacts directly with the slot-as-projection-element direction
in item 11 — a slot that is to become a named, addressable DOM region must have
per-instance identity first, or "mount fragment into slot `body`" has no unique
referent when two widgets are on the page.

Priority: high as a defect (tracked elsewhere); the factory redesign is a
prerequisite for item 11 and should be sequenced ahead of it.

## 20. Six overlapping component entry points with no naming guidance (medium — added 2026-07-30)

Writing the spec suite required all of `setupEffect` (`src/Component.ts:1065`),
`renderEffect` (:1074), `renderViewEffect` (:1102), `renderWithBindings`
(:1124), `renderViewWithBindings` (:1141), and `validateRenderedSlotContract`
(:914) — plus hand-rolled `Scope.makeUnsafe()` +
`Effect.provideService(…, Scope.Scope, scope)` in **13** separate spec files
(`future/components/*.spec.ts`, `future/resumability/*.spec.ts`,
`future/streaming/universal-serialization.spec.ts`). Nothing in the naming tells
a consumer when `renderEffect` applies versus `renderViewEffect`.

Recommended shape: collapse to
`Component.setup(component, props): Effect<Bindings, E, Req | Scope>` plus
`Component.render(component, props, bindings?)`, distinguishing View-typed
results by the component's `SlotContract` axis rather than by method name. Ship
a scoped test helper so consumers stop hand-rolling Scope plumbing (the
hand-rolling is itself a correctness hazard — it is how item 12's
missing-reactive-owner case goes unnoticed).

Adjacent docs-vs-practice gap worth deciding: `AGENTS.md` names
`Component.setup<Props>()` + `bind`/`value`/`doEffect`/`use` as the preferred
authoring path, yet **every** spec used the four-positional-argument
`make(props(), require(), setup(), view)` form — including `Component.require`
(`src/Component.ts:627`), which shadows a well-known global. Decide which form
the finished library ships, then make docs and examples agree; today they
disagree and both work.

Priority: medium. Pure consolidation, but it is the surface every consumer
touches first.

## 21. `Behavior.forSlots(slots)` discards its `slots` argument, so dynamic capability validation is impossible (medium-high — added 2026-07-30)

`forSlots` (`src/Behavior.ts:349-356`) types `elements` from the contract and
then returns `make(run, metadata)` — the `slots` parameter is never read. No
capability information is retained on the resulting behavior, so **no runtime
capability diagnostic can be derived from a behavior at all**.

That closes off the only escape hatch for item 13: with compile-time capability
checking unenforceable and the contract discarded at construction, the
generated/dynamic path fails **open**. Confirmed in
`validateAttachmentBySlots` (`src/Behavior.ts:672-710`): it checks slot
existence and hidden slots (via `View.validateSlotTargets`) and declared
events, but **not capability**. A TextInput-needing behavior attached to a
Container slot yields zero diagnostics.

Recommended shape: retain the contract in `forSlots` (on the behavior value,
alongside `metadata`), and add capability checking to
`validateAttachmentBySlots` by comparing the retained required capability
against the view's `slotMetadata[slot].capability` using
`Element.extendsCapability` (`src/Element.ts:146`), which already implements the
lattice walk.

Identity/namespace note: reuse the existing
`component:slot-capability-mismatch` code (`src/Component.ts:788,865`) rather
than minting a `view:`-prefixed variant. Spec authors invented the latter,
which is a small instance of the identity-namespace consistency concern item 2
tracks — diagnostic codes are effectively a fourth string identity family and
deserve the same "reserve and document the prefixes" treatment as `af:`. Note
there is already a third spelling in `src/A11y.ts:8,92`
(`a11y:slot-capability-mismatch`), so the drift has begun.

Priority: medium-high. Cheap given `extendsCapability` exists, and it is the
runtime backstop that makes item 13's type-level fix safe to land
incrementally.

## 22. Two more reactive-owner-vs-`Scope` leaks in `Element.ts` (2026-07-30)

Found while fixing item 12 (`Element.Handle.on`). The fix there — resolve the
ambient `Scope` via `Effect.serviceOption` and register with
`Scope.addFinalizer`, keeping the reactive-owner `onCleanup` only as a fallback —
is now a proven pattern in the same file. Two siblings share the defect:

**(a) `collection().observeEach` registers its observer teardown with `onCleanup`
only.** A collection observed under `Behavior.attachScoped` therefore leaks its
observer *and* its per-item cleanups on scope close — the identical failure mode,
on the identical path. Mechanical: apply the item-12 pattern. Worth re-checking
`future/components/collection.spec.ts`'s remaining red against this first, since
`collection` is the plan's "most load-bearing invisible piece".

**(b) `setAttr(name, fn)` and `setStyle` create bare `createEffect(...)`
reactions tied to neither an owner nor a `Scope`.** Outside a render owner these
reactions are **permanent**: a `Style` attached through a scoped path keeps
recomputing after disposal. This is worse than a listener leak — it is a live
reactive computation surviving its scope — and it is *not* mechanical, because it
needs a Scope-aware reaction primitive that does not exist yet (likely in
`api.ts`, i.e. outside `Element.ts`).

**The pattern to internalise.** This is now the fifth instance of one shape:
state or cleanup that is correct **only when a reactive owner happens to exist**,
or **only under an unwritten assumption** — `installedTransport`, the pre-R2 head
store, `Slots.define`'s shared handles, `Element.on`, and now these two (plus
`DQ-099`'s validated-manifest memo as the non-reactive cousin). When adding any
API that acquires a resource, the question to ask first is *"what closes this
when there is no render owner?"* — because the resume/reattach path never has one.

### 22 — update (2026-07-30): both halves fixed, and the pattern now has a primitive

(a) `collection().observeEach` and (b) `setAttr`/`setStyle` are both fixed.

The fix for (b) introduced **`api.ts`'s `createDisposableEffect(fn, initial)`** —
it parents a dedicated `Owner` to the ambient reactive owner, runs `createEffect`
under it, and returns a disposer. `Element.ts` wraps that with a `reaction`
helper that additionally registers `Scope.addFinalizer` when an ambient `Scope`
exists. Exactly-once disposal needed no extra bookkeeping: `Owner.dispose()`
already guards on its own flag and detaches from its parent, so whichever of the
Scope finalizer or the parent-owner teardown fires first does the work and the
second is a structural no-op.

**Eight bare `createEffect` calls remain elsewhere and have not been audited:**
`src/Registry.ts:65`, `src/AtomRef.ts:78`, `src/Atom.ts:1793` and `:2360`,
`src/Component.ts:1309`, and `src/effect-ts.ts:1365`, `:1464`, `:1480`.

`effect-ts.ts:1464`/`:1480` are the most likely to share the defect — they are the
signal/memo `listener` subscriptions, i.e. the Effect-facing bridge, and so are
the ones most plausibly invoked from a scoped path rather than from a render
owner. Each needs the same question asked of it: *what disposes this when there
is no render owner?* `createDisposableEffect` now exists to fix any of them the
same way.
