# Redesign Completed Log (archive)

Extracted from docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md on 2026-07-06 (PR2 plan-doc consolidation). This is the append-only historical record of landed redesign work. New entries: add a short pointer in the status doc and the full detail here.

## Completed So Far

- Added canonical AF-UI contract doc (`docs/AF_UI_CONTRACT.md`) to anchor the inside-out model and implementation gap map.
- Linked README/API/design/runtime docs to the AF-UI contract as the target architecture source of truth.
- Added `docs/GEN2_UI_IMPLEMENTATION_NOTES.md` after inspecting `../gen2` UI primitives and documenting what is portable into this runtime library.
- Added project-level `AGENTS.md` so future agent work starts with the AF-UI contract, current status, gen2 notes, and validation commands.
- Started AF-UI slot convergence:
  - `Component.Component` now carries an explicit fifth `Slots` type axis.
  - Added `Component.SlotsOf<T>` for slot metadata extraction.
  - Behavior/style slot attachment paths now preserve component slot metadata.
  - Type coverage now exercises `SlotsOf` for behavior and style attachment.
- Added static component slot contract metadata:
  - `Component.Component` now carries the authored slot contract metadata.
  - `Component.SlotContractOf<T>` extracts the authored slot contract when available.
  - `Component.withSlots(...)` / `Component.withSlotContract(...)` publish slot
    contract metadata on a component while preserving route metadata.
  - Component wrappers and route metadata plumbing preserve the contract axis.
- Added the slot contract unification plan:
  - `docs/SLOT_CONTRACT_UNIFICATION_PLAN.md` defines `View.Slots` as the single long-term authored slot contract.
  - It introduces `Component.withSlots(...)` and `Component.SlotContractOf<T>` as the correct public API names.
  - Component-level witness-named aliases have been removed from the public API.
- Added `docs/PROPS_BINDINGS_SLOTS.md` to define the ownership split:
  - `Props` are caller-owned configuration.
  - `Bindings` are setup-created implementation state.
  - `Slots` / `SlotContract` are the public structural attachment surface.
- Added `docs/SETUP_VIEW_COMPARISON.md` to explain why separate setup, live
  accessors, typed holes, and slot contracts avoid React stale-closure pitfalls,
  share Solid's fine-grained live-accessor advantage without claiming better
  local signal ergonomics, and require less ceremony than a Foldkit-style
  message/subscription loop for local component state.
- Added `docs/BINDINGS_ASYNC_COMMIT_BOUNDARY.md` to define bindings as the
  component-level async commit boundary:
  - setup collects dependencies and produces a coherent binding snapshot.
  - the normal view renders from committed bindings, not half-real async values.
  - style/behavior effects attach after the view/slot snapshot exists.
- Introduced minimal runtime-native `View<Slots>` foundation:
  - added `src/View.ts` with `View.make`, `View.isView`, `View.node`, and `View.SlotsOf<T>`
  - exported `View` from the root API and package subpath
  - `Component` render paths now unwrap `View.node` while preserving current JSX/unknown return compatibility
  - component runtime/type tests cover view-backed rendering and slot extraction
- Added initial `View` metadata and diagnostics inspired by `../gen2`:
  - slot metadata records with capability, hidden flag, allowed events/attributes, and platform requirements
  - `View.hidden(...)` for hidden/internal slots
  - `View.remap(...)` for typed slot remapping
  - `View.validateSlotTargets(...)` for unknown/hidden slot diagnostics
  - `View.validateRemaps(...)` for unknown and capability-incompatible remap diagnostics
  - runtime and type coverage for hidden slots and remap validation
- Integrated View diagnostics into style/behavior validation APIs:
  - `Style.validateAttachment(...)`
  - `Style.validateAttachmentBySlots(...)`
  - `Behavior.validateAttachmentBySlots(...)`

- Added the first typed-hole/security boundary:
  - `SafeHtml` branded values live in `src/SafeHtml.ts`
  - `View.html(...)` accepts only branded `SafeHtml`, not raw strings
  - `View.text`, `View.className`, `View.style`, `View.event`, and `View.children` establish the initial runtime hole taxonomy

- Added lightweight platform metadata diagnostics:
  - `View.PlatformMetadata` describes supported capabilities, events, attributes, and requirements
  - `View.validatePlatform(...)` reports unsupported slot capabilities, events, attributes, and missing platform requirements
  - `View.platform(...)` / `View.PlatformTag` can install runtime platform metadata, and `Component.renderEffect(...)` reports diagnostics when a component or headless render prop returns a `View`
  - metadata can now use branded witnesses (`Element.Capability.*`, `View.Event.*`, `View.Attribute.*`, `View.Requirement.*`) instead of magic strings, with type helpers for extracting slot/platform capability and event unions
  - runtime coverage for hidden and unknown slot diagnostics before attachment
- Added style property metadata witnesses and diagnostics:
  - `Style.Property.*` and `Style.Property.make(...)` provide branded, literal-preserving style property tokens
  - `Style.validatePlatform(...)` reports unsupported style properties against renderer metadata while preserving string compatibility
  - `Style.Property.NameOf<T>` / `Style.Property.NamesOf<T>` cover tuple-based property union extraction
  - `Style.platform(...)` / `Style.PlatformTag` can install style platform metadata, and `Style.attach(...)` reports diagnostics during setup when that layer is provided
  - `Style.reportPlatformDiagnostics(...)` exposes the same reporting path for renderer/adaptor integration points
- Added behavior event requirement metadata:
  - `Behavior.events(...)` and `Behavior.withMetadata(...)` let behaviors declare required events with `View.Event.*` witnesses or strings
  - `Behavior.validateAttachmentBySlots(...)` now validates required behavior events against mapped `View.slot(...allowedEvents)` metadata
  - type coverage verifies behavior event witness names stay visible through generic metadata extraction
- Added public metadata normalization helpers:
  - `Element.nameOfCapability(...)`
  - `View.nameOfCapability(...)`, `View.nameOfEvent(...)`, `View.nameOfAttribute(...)`, `View.nameOfRequirement(...)`, `View.nameOfMetadata(...)`
  - `Style.nameOfProperty(...)`
  - View remap diagnostics now compare normalized capability names, so strings and branded witnesses compose correctly
- Added component-rendered View validation helpers:
  - `Component.renderViewEffect(...)` runs setup/view and returns `View<Slots> | undefined` without unwrapping to node output
  - `Style.validateComponentAttachment(...)` validates style slot targets against metadata from a rendered component View
  - `Behavior.validateComponentAttachmentBySlots(...)` validates mapped behavior slot targets and event requirements against metadata from a rendered component View
- Confirmed runtime/type preservation of `View<Slots>` metadata through common wrappers:
  - `Behavior.attachBySlots(...)` / `Component.withBehavior(...)`
  - `Style.attachByView(...)`
  - `Style.attach(...)` with `Style.platform(...)` provided through `Component.withLayer(...)`
  - `Component.withLayer(...)`
  - `Component.guard(...)`
  - `Component.renderViewEffect(...)` keeps its exact `View.View<Component.SlotsOf<typeof Wrapped>> | undefined` shape across the audited wrapper chains
- Confirmed route wrapper preservation of `View<Slots>` metadata:
  - legacy `Component.route(...)` preserves runtime View metadata on matched routes and returns no View on unmatched routes
  - route-node materialization through `Route.page(...)` / `Route.componentOf(...)` preserves runtime View metadata
  - Route component/tag aliases now carry the fifth `Component` slot axis instead of widening `Component.SlotsOf<T>`
- Audited public metadata API exports and emitted declarations:
  - root `index.ts` exports the public namespaces that carry the new helpers (`Component`, `View`, `Element`, `Behavior`, `Style`, `Route`)
  - `MetadataToken` remains an internal implementation module; public callers should use `Element.Capability.*`, `View.Event/Attribute/Requirement.*`, and `Style.Property.*`
  - added root-import type coverage for the metadata witness and component validation APIs
  - build output includes `Component.renderViewEffect(...)`, `Style.validateComponentAttachment(...)`, `Behavior.validateComponentAttachmentBySlots(...)`, `View.nameOf*`, `Element.nameOfCapability(...)`, and `Style.nameOfProperty(...)`
- Consolidated metadata witness docs:
  - `docs/METADATA_WITNESS_IMPLEMENTATION_PLAN.md` now records implemented APIs, inference behavior, preservation coverage, export audit, remaining work, and a golden-path example
  - `docs/AF_UI_CONTRACT.md` now treats domain-specific witnesses as the canonical authored metadata form while preserving string compatibility
  - the contract explicitly states that `View<Slots>` metadata is runtime-inspectable today and broader static component metadata extraction is future work
- Added typed View tree implementation plan:
  - `docs/TYPED_VIEW_TREE_PLAN.md` defines the migration from `node: unknown` to optional renderer-neutral `ViewNode<Slots>` metadata
  - the plan preserves current JSX/unknown output and keeps `Component.renderViewEffect(...)` as the inspection boundary
  - the first implementation slice is limited to typed tree data/helpers plus runtime/type coverage, without requiring JSX compiler changes
- Implemented the first typed View tree slice:
  - `View<Slots>` can now carry optional `tree?: View.ViewNode<Slots>` metadata without changing `node` unwrapping
  - `View.element(...)`, `View.fragment(...)`, `View.textNode(...)`, `View.hole(...)`, and `View.tree(...)` provide the initial renderer-neutral tree authoring helpers
  - runtime and type coverage verify `Component.renderEffect(...)` still returns the provided runtime node, while `Component.renderViewEffect(...)` exposes typed tree metadata
- Added typed View tree diagnostics:
  - `View.validateTree(...)` reports unknown slot references, hidden slot references, and tree element capability mismatches
  - tree capability checks reuse the existing hierarchy-aware `View.extendsCapability(...)` semantics
  - runtime coverage verifies dynamic/generated unknown-slot diagnostics and typed authoring compatibility cases
- Added first-class slot witness plan:
  - `docs/SLOT_WITNESS_PLAN.md` defines the migration from separate `{ slots }` / `{ slotMetadata }` records to composable `View.Slot` and `View.Slots` witnesses
  - the plan now treats slot witnesses as the canonical authored model for the breaking redesign track, with plain `slotMetadata` retained as a migration/dynamic escape hatch
  - implementation slices focus on no-cast public authoring, generic inference, derived metadata, component/style/behavior/route integration, typed tree integration, and capability-safe handle binding
- Implemented the first slot witness slice:
  - `View.Slot.make(...)` creates branded slot witnesses carrying name, capability, event, attribute, requirement, and hidden metadata
  - `View.Slot.bind(...)`, `View.Slots.make(...)`, `View.Slots.handles(...)`, and `View.Slots.metadata(...)` derive handle and metadata maps without duplicate authored slot strings
  - `View.fromSlots(...)` constructs `View<Slots>` from bound witnesses while preserving typed tree, platform, hidden-slot, and wrapper diagnostics
  - type coverage verifies generic forwarding, key/name matching, capability-safe handle binding, derived view slot types, and wrapper preservation without public casts
- Unified the Style/Behavior slot-contract API shape:
  - `Style.forSlots(slots)(...)` and `Style.attachToSlots(style, slots)` are now the canonical authored style path.
  - `Behavior.forSlots(slots)(...)` and `Behavior.attachToSlots(behavior, slots)` are now the canonical authored behavior path.
  - `Style.attachBySlotContract(...)` / `Behavior.attachBySlotContract(...)` are the typed remapping helpers.
  - `attachBySlots(...)` remains the dynamic/generated string-map helper.
  - type and runtime coverage verifies slot-contract-first style/behavior attachment and component contract preservation.
- Added conservative type-level View/platform compatibility helpers:
  - `View.MissingPlatformSupport<Slot, Platform>` returns a typed diagnostic union for literal witness-backed metadata gaps
  - `View.IsPlatformCompatible<Slot, Platform>` returns `true` when no literal metadata gap is detectable
  - widened string metadata remains compatible at the type level and defers to runtime diagnostics
- Added lightweight element capability hierarchy:
  - `Element.Capability.make(name, { extends })` records parent capability witnesses while keeping string compatibility
  - built-ins now model `TextInput -> Focusable -> Interactive -> Base`, with `Container` and `Draggable` under `Interactive`, and `Collection` under `Base`
  - `Element.extendsCapability(...)` / `View.extendsCapability(...)` expose runtime hierarchy checks
  - `View.validateRemaps(...)`, `View.validatePlatform(...)`, and literal `View.MissingPlatformSupport<Slot, Platform>` checks now let child capabilities satisfy parent requirements
- Scope/lifecycle foundation is in place (component scope context + supervision wiring).
- `useService(...)` diagnostics improved for missing runtime/service cases.
- ADR set created for major design decisions (`docs/adr/ADR-001`..`ADR-005`).
- Async direction locked (ADR-002): suspension-first default, `Result` as explicit opt-in path.
- `Result.builder(...)` added for explicit rendering flows.
- Legacy `AsyncResult` naming moved out of top-level golden-path exports (now unified under `Result`).
- New v1 primitives introduced:
  - `Atom.runtime(...).action(...)`
  - `Atom.action(...)`
  - `Atom.effect(...)`
- Atom ergonomics redesigned toward callable golden path:
  - atoms are now callable for reads (`count()`)
  - writable atoms now expose sync instance methods (`set`, `update`, `modify`)
- Removed `Atom.batch(...)` from the main Atom namespace; microtask batching remains default and `flush()` is the escape hatch.
- `Atom.family(...)` now exposes explicit cache lifecycle controls (`evict`, `clear`)
- `AtomRef` retained and aligned incrementally:
  - added `get()` and `modify(...)` for closer read/write symmetry with Atom
  - refs/collections are now callable read accessors (`ref()` / `collectionRef()`)
- Reactivity invalidation integrated across action + RPC/HTTP client paths (`reactivityKeys`).
- Batching redesign started and shipped:
  - `flush()` added
  - microtask batching is now always on (sync mode removed)
- Strict API variants removed:
  - `queryEffectStrict`
  - `defineQueryStrict`
  - `mutationEffectStrict`
  - `defineMutationStrict`
- Legacy aliases removed:
  - `use` (kept `useService` only)
  - `refresh` alias (use `invalidate`)
  - `mountWith` alias
- Legacy wrappers removed:
  - `Atom.fn(...)`
  - `runtime.fn(...)`
  - sync scoped wrappers (`scopedRoot`, `scopedQuery`, `scopedMutation`)
- OO facade removed:
  - `signal(...)`
  - `computed(...)`
- Export tiering advanced:
  - top-level no longer re-exports reactive core + DOM runtime helpers
  - new `effect-atom-jsx/internals` subpath added
- Legacy query/mutation constructors removed from Effect surface:
  - `queryEffect(...)`
  - `mutationEffect(...)`
  - internal flow now uses `defineQuery(...)` / `defineMutation(...)`
- Docs alignment pass started for removed APIs:
  - `README.md` examples now use `defineQuery` / `defineMutation`
  - `docs/API.md` and `docs/ACTION_EFFECT_USE_RESOURCE.md` no longer document removed aliases
- Planning/migration docs alignment continued:
  - `docs/V1_API_CONTRACT_DRAFT.md` updated to current removals (`invalidate`, no query/mutation legacy aliases)
  - `docs/EFFECT_NATIVE_ENHANCEMENT_PLAN.md` and `docs/EFFECT_ATOM_ALIGNMENT_PLAN.md` updated to redesign-era API posture
  - `docs/EFFECT_ATOM_EQUIVALENTS.md` now maps function atoms to `Atom.action` / `runtime.action`
  - `docs/TESTING.md` examples now use `defineQuery` / `defineMutation`
  - `docs/DESIGN_OVERHAUL_V1_PLAN.md` now includes a source-of-truth note and uses `invalidate` in core surface draft
  - `CHANGELOG.md` now has an "Unreleased (Redesign Track)" section reflecting removals/consolidation
  - `docs/DESIGN_OVERHAUL_V1_PLAN.md` now explicitly labels pre-removal exploratory sections as historical analysis
  - README quick start now leads with callable atom usage (no `Registry` ceremony)
  - README now includes concrete runtime-bound `Atom.runtime(layer)` usage and `flush()` guidance
  - mutation guidance now leads with linear `Atom.runtime(...).action(...)` flow in docs
  - added concrete stale-while-revalidate examples with `isPending(...)` + `latest(...)`
  - started result-model consolidation workstream with proposal doc: `docs/RESULT_CONSOLIDATION_PROPOSAL.md`
  - consolidation implementation started: unified async model now exposed as `Result` in core exports
  - legacy `AsyncResult` public subpath export removed (advanced now exports `Result`)
  - internal async-state rename sweep started in source (`effect-ts` and downstream call sites now use `Result` naming)
  - plan/alignment docs updated to prefer `Result`/`FetchResult` terminology (`EFFECT_NATIVE_ENHANCEMENT_PLAN`, `EFFECT_ATOM_ALIGNMENT_PLAN`)
  - `docs/new_ideas.md` now includes an explicit status snapshot and historical naming note
  - compatibility conversion API renamed to remove legacy wording: `FetchResult.fromResult(...)` / `FetchResult.toResult(...)`
  - `README.md` and `docs/API.md` no longer contain `AsyncResult` terminology
  - reduced `FetchResult` prominence in top-level guidance; positioned as advanced compatibility in README/plan docs
  - ADR alignment pass started: `ADR-002` now reflects final `Result` primary + `FetchResult` compatibility decision
  - README now documents `Atom.family` eviction + memory guidance for long-running apps
  - README now treats `Registry` as advanced/manual API, not part of primary local-state path
  - fixed nested `AtomRef` property linkage so chained `prop(...).prop(...)` refs remain connected to root updates
  - top-level `Registry` export removed from `effect-atom-jsx`; manual registry usage now deep-imported from `effect-atom-jsx/Registry`
  - added `Atom.family` lifecycle cleanup example in README using `onCleanup(() => family.evict(key))`
  - historical analysis labeling strengthened in `DESIGN_OVERHAUL_V1_PLAN.md` to avoid stale API guidance confusion
  - action-first docs polish continued: practical query+mutation pattern now uses `Atom.runtime(...).action(...)`
  - top-level export-tier tightened further: scoped/layer constructors removed from root export (advanced-only)
  - callable-style docs sweep continued: compatibility/equivalents examples now prefer `atom()`/`atom.set(...)` patterns
  - AtomRef internal path-cache keying hardened to avoid nested key collisions (typed key serialization)
  - query composition ergonomics improved: `defineQuery(...).effect()` added for typed Effect composition from query state
  - mutation/action composition improved: `defineMutation(...).effect(input)` and `actionHandle.effect(input)` now expose typed Effect composition paths
  - added `AtomSchema.struct(...)` for typed multi-field validated form composition
  - `createOptimistic(source)` now explicitly supports callable atoms as sources (not only raw accessors)
  - added `TypedBoundary` for schema/type-guard-based typed error boundaries over `Result` failures/defects
  - query composition propagation hardened: `query.effect()` now snapshots and tracks state in reactive composition; added composed query success/failure coverage
  - `Atom.family` now supports variadic key tuples with typed `evict(...args)` for stronger composition/inference ergonomics
  - `Atom.make` disambiguation improved with explicit constructors: `Atom.value(...)` (function-valued writable atoms) and `Atom.derived(...)`
  - README/API docs narrative pass added in-context terminology map (atom/query/mutation/action/effect/Effect/Result/ref/optimistic/store)
  - README flow sections now explicitly connect query/action/result/pending/latest/composition responsibilities
  - added `Atom.result(atom)` helper to convert result-like atoms into typed `Effect` values for composition pipelines
  - `AtomRef.toAtom(ref)` interop helper added and documented; AtomRef docs now clearly distinguish ref semantics vs Atom semantics
  - composition bridge errors are now tagged (`ResultLoadingError`, `ResultDefectError`, `MutationSupersededError`) instead of untagged object/error unions
  - README/API consistency pass: `createOptimistic` examples use direct callable sources, `How It Works` leads with `Atom.runtime`, and `isPending`/`latest` signatures clarified
  - removed `batch` from `effect-atom-jsx/advanced` exports to match flush-first batching direction
  - added explicit "Type Architecture (A / E / R)" sections to README and API docs for Effect users
  - Phase A type-surface work started: `AtomRuntime` now accepts requirement subsets (`RReq extends R`) for runtime-bound atom/action creation
  - Phase B composition work started: `runtime.atom((get) => Effect...)` added for dependency-aware runtime-bound async composition
  - added typecheck assertions (`src/type-tests/runtime-requirements.ts`) for requirement-subset acceptance and missing-requirement rejection
  - Phase C started: action handles now include `runEffect(input)` for typed Effect composition that preserves success value `A`
  - Phase A acceptance criteria met: explicit type aliases surfaced, runtime requirement-subset checks enforced, and type examples documented
  - Phase B acceptance criteria met: dependency-aware runtime composition (`runtime.atom((get) => Effect...)`) works with composed success/failure propagation + type-level union assertions
  - Phase C acceptance criteria met for action composition: action handles are Effect-first (`runEffect`) and public bridge errors are tagged
  - Phase D acceptance criteria met:
    - `Atom.family` now supports optional custom key equality (`family(..., { equals })`)
    - `AtomSchema.struct` now supports nested structs plus form-level `touch()`
    - added type-inference checks for RPC/HTTP action success typing (`src/type-tests/rpc-httpapi-inference.ts`)
- `AtomRpc` / `AtomHttpApi` queries now emit unified `Result` state directly (no `FetchResult` conversion)
- legacy data-state module moved to `FetchResult` namespace at top-level export (`src/Result.ts` retained)
- Phase E observability wiring corrected: `defineQuery(..., { onTransition })` now forwards transition hooks through query execution; integration tests pass.
- Phase E schedule docs polish: README stream example now imports `Schedule` for `Atom.fromSchedule(...)` snippet correctness.
- Phase E async scheduling expanded: `defineQuery` now supports `retrySchedule` (typed retry) and `pollSchedule` (scheduled invalidation/polling).
- Phase E observability expanded: query/mutation `observe` hooks now emit timing metrics (`startedAt`/`finishedAt`/`durationMs`) with integration coverage.
- Phase E stream recipes started: `Atom.Stream.textInput(...)` added as a first-party UI input stream helper.
- Phase E stream recipes expanded: `Atom.Stream.searchInput(...)` added for search-box normalization + optional de-duplication.
- Phase F kickoff started:
  - observability docs/comments refinement for scheduling/metrics options
  - integration coverage added for `Atom.action` / `runtime.action` transition hooks
  - validation pass includes typecheck + tests
- Phase F release hardening continued across broader surface:
  - added type-level coverage for Phase E scheduling/observability/action options (`src/type-tests/phase-e-scheduling-observability.ts`)
  - added failure-path observability integration tests for query/mutation `observe`
  - fixed OOO async example to current API (`Result` + `FetchResult`, callable atoms, no top-level `Registry` import)
  - stabilized retry-schedule integration timing in test coverage
  - full quality gate currently green: typecheck + full test suite + build
- Phase F composition/pipeability expansion:
  - callable atoms now support `.pipe(...)` for transformer composition
  - added pipeable async policies: `Atom.withRetry`, `Atom.withPolling`, `Atom.withStaleTime`
  - added `Atom.withOptimistic` + optimistic lifecycle `withEffect(...)`
  - added Effect constructor bridges: `Atom.runtimeEffect`, `Hydration.hydrateEffect`, `AtomSchema.validateEffect`
  - added pipeable schema wrappers: `AtomSchema.validated` / `AtomSchema.parsed`
- Phase E scope-hardening test added: component scope closure now explicitly verified to cancel pending `layerContext` startup work.
- Component system implementation landed (`src/Component.ts`) with Effect-native setup contracts (`Component.make`, `Component.headless`, `Component.setupEffect`, `Component.renderEffect`).
- Component setup helpers landed (`Component.signal`, `Component.effect`, `Component.state`, `Component.derived`, `Component.query`, `Component.action`, `Component.ref`, `Component.fromDequeue`, `Component.schedule`, `Component.scheduleEffect`).
- Initial component transform/mount surface landed (`withLayer`, `withErrorBoundary`, `withLoading`, `withSpan`, `memo`, `tapSetup`, `withPreSetup`, `withSetupRetry`, `withSetupTimeout`, `Component.mount`).
- Added component runtime tests (`src/__tests__/component.test.ts`) and initial component type tests (`src/type-tests/component-core.ts`).
- Composables foundation implemented:
  - `src/Behavior.ts` introduced (`Behavior.make`, `Behavior.compose`, `Behavior.decorator`)
  - `src/Element.ts` introduced typed element handles/capabilities (`interactive`, `container`, `focusable`, `textInput`, `draggable`, `collection`)
  - `Component.withBehavior(...)` added to attach behavior Effects and merge bindings
  - slot handle helpers added to `Component` (`slotInteractive`, `slotContainer`, `slotFocusable`, `slotTextInput`, `slotDraggable`, `slotCollection`)
  - first behavior pack added in `src/behaviors.ts` (`disclosure`, `selection`)
  - integration and type coverage added (`src/__tests__/composables.test.ts`, `src/type-tests/composables-behavior.ts`)
- Composables expansion implemented:
  - `Behavior.attach(...)` and `Behavior.attachBySlots(...)` added for pipe-first behavior attachment (selector or slot-map style)
  - behavior pack expanded with `searchFilter`, `keyboardNav`, `pagination`, and `focusTrap`
  - composables integration tests expanded for slot-map attach and multi-behavior composition
  - added stricter slot-compatibility type coverage for `attachBySlots` mappings (`src/type-tests/composables-slot-compat.ts`)
- Collection lifecycle hardening for composables:
  - `Element.collection(...).observeEach(...)` added for dynamic per-item attach/cleanup when collection contents change
  - selection behavior switched from one-time `forEach` to lifecycle-aware `observeEach`
  - added regression coverage for listener rebind/cleanup across collection churn (`src/__tests__/composables.test.ts`)
- First composed headless behavior added:
  - `Behaviors.combobox(...)` composed from disclosure + search + nav + selection + trap wiring
  - integration coverage added for open/search/select flow in `src/__tests__/composables.test.ts`
- Headless composables factory surface added:
  - `src/composables.ts` introduces `Composables.createCombobox(...)`
  - factory returns typed headless bindings (handles + combobox state/actions) with integration test coverage
- Style system implementation landed (broad v1):
  - new modules: `src/Style.ts`, `src/Theme.ts`, `src/style-types.ts`, `src/style-runtime.ts`, `src/style-utils.ts`, `src/styled-composables.ts`
  - style attachment APIs: `Style.attach(...)` and `Style.attachBySlots(...)`
  - composition primitives: `slot`, `compose`, `when`, `states`, `responsive`, `animation`, `keyframes`, `transition`
  - variant/recipe APIs: `Style.variants`, `Style.recipe`, with inferred prop helper types
  - override surface: `Style.override` + `Style.Provider`
  - token/theme support: typed token paths, `Theme` service key, default `ThemeLight` layer
  - tests added for style runtime and type coverage (`src/__tests__/style.test.ts`, `src/type-tests/style-*.ts`)
- Style typing and example polish pass:
  - `Style.attachBySlots` generic contract tightened and new strict helper added: `Style.attachBySlotsFor<Bindings>()`
  - removed `as any` slot-mapping escape hatch from `src/styled-composables.ts`
  - added concrete styled headless example app at `examples/styled-combobox/`
- Style2 advanced implementation pass landed:
  - added advanced style descriptors in `src/Style.ts` (`nest`, selector helpers, `vars`, `media`, `supports`, `container*`, `pseudo`, `grid`, `layers`, `inLayer`, `global`, `globalLayer`, `animate`, `enter/exit`, `enterStagger`, `layoutAnimation`, `extends`)
  - upgraded keyframes signature to support named keyframes (`Style.keyframes(name, frames)`)
  - added Style2 runtime and type coverage (`src/__tests__/style2.test.ts`, `src/type-tests/style2-grid-selectors.ts`)
  - added second concrete styled example (`examples/styled-card/`) using recipe + variants + nested selectors
- Router implementation pass landed:
  - new `src/Route.ts` with Router service + Browser/Hash/Server/Memory layer implementations
  - added `Component.route(...)` and `Component.guard(...)` pipes
  - added route helpers (`matchPattern`, `extractParams`, `resolvePattern`, `Route.link`, `Route.queryAtom`, `Route.Link`)
  - added route runtime/type coverage (`src/__tests__/route.test.ts`, `src/type-tests/route-link.ts`)
- Router hardening/integration pass landed:
  - `Route.link(...)` now infers param/query types from routed component metadata (`RouteParamsOf`, `RouteQueryOf`, `RouteLink`)
  - `Route.Link` integrated with runtime navigation via `ManagedRuntimeContext` and router service fallback behavior
  - `Route.Memory` now tracks history stack with working `back`/`forward`
  - `Route.collect(...)` recursively walks values and `Route.validateLinks(...)` reports duplicate patterns
  - route tests expanded (`src/__tests__/route.test.ts`) for history + metadata validation flows
- Router metadata semantics hardening landed:
  - implemented head metadata merge utilities (`mergeRouteMetaChain`, `resolveRouteHead`, `applyRouteHeadToDocument`)
  - `Component.route(...)` now registers/unregisters route head entries so deepest-title / merged-meta behavior is deterministic
  - route metadata tests expanded for precedence/merge behavior
- Router examples/docs pass landed:
  - added `examples/router-basic/` (component routes + typed links + switch)
  - added `examples/router-typed-links/` (typed query atoms + typed link component usage)
  - API docs updated with router example references
- Router2 loader foundation landed:
  - added loader APIs (`Route.loader`, `Route.loaderData`, `Route.loaderResult`, `Route.loaderError`, `Route.prefetch`, `Route.action`, `Route.reload`)
  - added loader runtime cache/orchestration module (`src/router-runtime.ts`) with stale/cache/revalidate helpers
  - added matched-loader orchestration utility (`Route.runMatchedLoaders`) and route registry (`Route.collectAll`)
  - `Component.route(...)` now integrates route loader execution and passes loader data/result through route context
  - added loader-focused tests (`src/__tests__/route-loader.test.ts`) and type coverage (`src/type-tests/route-loader-types.ts`)
- Router2 continuation landed:
  - improved matched loader orchestration to support deeper parent-dependent chains with batched parallel execution
  - added loader SSR/streaming serialization helpers (`serializeLoaderData`, `deserializeLoaderData`, `streamDeferredLoaderScripts`)
  - added sitemap helper surface (`Route.sitemapParams`, `Route.collectSitemapEntries`, `Route.collectAll`) for SSG/SEO pipelines
- Router2 streaming-priority continuation landed:
  - added `Route.runStreamingNavigation(url)` to produce critical loader batch and deferred stream scripts
  - added loader test coverage for critical/deferred execution path (`src/__tests__/route-loader.test.ts`)
- Router2 async-rendering contract clarified:
  - `Route.loaderResult` documented and tested as the canonical bridge to existing `Result`/`Async` UI control-flow (no separate router loading type)
- Loader-driven route head continuation landed:
  - `Route.title` / `Route.meta` callback forms now receive `(params, loaderData, loaderResult)` snapshots so route head metadata can be derived directly from loader output
  - added `Route.titleFor(component, ...)` / `Route.metaFor(component, ...)` helpers for component/loader-inferred head callbacks without explicit generic annotations
  - added `Route.loaderErrorFor(component, cases)` helper for component-inferred tagged loader error handling
  - route head resolution now re-subscribes reactively to route match/params/loader state updates after setup so metadata can update during in-place navigation
- single-flight groundwork added in Route internals: `Route.actionSingleFlight(...)`, `Route.mutationSingleFlight(...)`, `Route.hydrateSingleFlightPayload(...)`, `Route.createSingleFlightHandler(...)`, and `Route.invokeSingleFlight(...)` provide the lower-level transport/runtime substrate
- loader cache now captures Reactivity keys from atom/query reads during loader execution, so many loaders no longer need explicit `reactivityKeys`
- single-flight loader selection now defaults to Reactivity-driven matching against captured invalidation keys, with matched-loader fallback when no keys were emitted
- existing mutation handles are now the preferred client API for single-flight transport: `Atom.action(...)` / `Atom.runtime(...).action(...)` accept `singleFlight` client options and return the mutation value while auto-hydrating affected route loaders
  - low-level single-flight payload seeding landed via `Route.setLoaderData(...)` / `Route.setLoaderResult(...)`, allowing canonical mutation results to skip some loader reruns entirely
  - added `Route.singleFlight(...)` as the higher-level server helper so direct loader seeding no longer requires manual `actionSingleFlight(...)` + handler composition
  - added `Route.seedLoader(...)` / `Route.seedLoaderResult(...)` helpers for shorter common-case loader seeding from mutation results
  - documented the feature in `docs/SINGLE_FLIGHT.md` and added a full demo in `examples/router-single-flight/`
  - added `Reactivity.tracked(...)` / `Reactivity.invalidating(...)` primitives so service methods can express tracked reads and invalidating writes directly
  - refactored the comprehensive single-flight example toward the service-first model (`yield* UsersService` in loaders, Reactivity helpers in service methods)
  - introduced transport-aware single-flight integration via `Route.SingleFlightTransportTag` and `Route.FetchSingleFlightTransport(...)`
  - `Atom.action(...)` / `Atom.runtime(...).action(...)` now auto-detect installed single-flight transport and can use single-flight transparently, while explicit client options remain available as overrides/fallback
  - added side-by-side transport docs and examples for both custom transport (`examples/router-single-flight/`) and fetch-backed transport (`examples/router-single-flight-fetch/`)
  - added a future-facing routing architecture sketch in `examples/router-architecture-sketch/README.md` covering `Route` + `ServerRoute` + `RouterRuntime`
  - started the route-node architecture implementation with first-class app-route constructors/helpers in `Route` (`page`, `layout`, `index`, `define`, `ref`, `mount`, `children`, `id`, `paramsSchema`, `querySchema`, `hashSchema`, `componentOf`)
  - route-node constructor/pipe flow now supports route-node-aware `loader`, `title`, and `meta` enhancers plus route-node extraction helpers for params/query/hash/loader typing
  - promoted route-node-first routing as the public golden path in README/API docs, refreshed the architecture-sketch wording, and expanded route-node type coverage for schema params/query/hash, loaders, loader errors, head metadata, component materialization, and typed links
  - tightened route-node pipe inference so long `Route.page(...).pipe(Route.id(...), Route.paramsSchema(...), Route.querySchema(...), Route.hashSchema(...))` chains preserve params/query/hash axes without data-first anchoring
  - added the first `ServerRoute` implementation slice with first-class server route nodes, pipeable method/path/schema/handler helpers, generated path support, and extraction helpers for params/form/body/response typing
  - added the first `ServerRoute.execute(...)` slice with Schema-driven params/form/body decoding and basic response encoding/validation through `ServerRoute.response(...)`
  - added first server control-flow/response shaping primitives: `ServerRoute.redirect(...)`, `ServerRoute.notFound()`, and `Route.ServerResponseTag` integration inside executed server handlers
  - `ServerRoute` execution now has explicit service-native entry points (`executeWithServices`, `executeFromServices`), and `RouterRuntime` uses explicit request/response service objects when executing server tasks
  - added the first `RouterRuntime` foundation with a decomposed-state-oriented implementation model, memory history adapter, and snapshot/subscription/navigation/submission/fetch/revalidation API surface
  - `RouterRuntime` now performs initial route-graph matching for app routes and document server routes in snapshots and supports app-route-reference navigation via `navigateApp(...)`
  - `RouterRuntime` now executes matched app-route loaders during initialization/navigation/revalidation and exposes initial loader results through runtime snapshots
  - `RouterRuntime.submit(...)` / `fetch(...)` now integrate with typed `ServerRoute` execution when passed server route nodes, so action/resource handlers can run as real runtime tasks
  - expanded `ServerRoute` request decoding with `query`, `headers`, and `cookies` schemas, all flowing through `ServerRoute.execute(...)` and runtime task execution
  - added the first explicit runtime service-layer bridge via `RouterRuntime.HistoryTag`, `RouterRuntime.NavigationTag`, `RouterRuntime.RouterRuntimeTag`, and `RouterRuntime.toLayer(...)`
  - added the first SSR bridge slice with `Route.renderRequest(...)`, request/response service tags, and `ServerRoute.runDocument(...)` for document-route execution against app route trees
  - added richer document/data dispatch via `ServerRoute.dispatch(...)`, and `Route.renderRequest(...)` now includes concrete loader payload/deferred output in the structured SSR result
  - added runtime-backed request helpers so SSR/document dispatch can route through `RouterRuntime` (`Route.renderRequestWithRuntime(...)`, `ServerRoute.dispatchWithRuntime(...)`)
  - route loader payload hydration now keeps seeded entries fresh for first client mount, with server-render test coverage proving a route-node component can read `Route.loaderData()` on first render without rerunning the loader
  - `RouterRuntime` now owns more request orchestration for render/dispatch helpers by updating request URL state and refreshing matched loaders before SSR/document execution
  - `RouterRuntime` snapshots now track richer request outcomes (`lastActionOutcome`, `lastFetchOutcome`, `lastDocumentResult`, `lastDispatchResult`) for server-task and document-flow observability
  - `RouterRuntime` is starting to unify task state modeling with shared phase-based task objects (`idle` / `loading` / `submitting` / `rendering` / `dispatching`) across navigation, revalidation, fetchers, and request/document flows
  - runtime outcome tracking is also being normalized around shared `kind`-tagged outcome records for actions, fetches, documents, and dispatches
  - action and fetcher state are being pushed onto the same normalized task/outcome model, including cancellation-ready task phases (`cancelled`) in the runtime state foundation
  - added the first explicit runtime cancellation API (`runtime.cancel(...)` / `NavigationTag.cancel(...)`) so interruption is now represented as behavior, not only as a reserved state shape
  - runtime task transitions now use shared supersession semantics, so repeated navigation/fetch work can explicitly pass through `cancelled` state before the next task begins
  - added lightweight in-flight task tracking to runtime snapshots (`inFlight`) as groundwork for deeper Effect-backed supersession and interruption handling later
  - runtime task completion now checks in-flight ids before committing results, preventing stale superseded task completions from overwriting newer state
  - submit and revalidate flows now also use tracked in-flight execution paths, bringing more runtime work under the same guarded execution model as fetch/render/dispatch
  - added adapter-facing response shaping with `ServerRoute.toResponse(...)` so document/data dispatch results can be turned into a generic response structure cleanly
  - added `Route` server convenience helpers (`serverRequest`, `serverUrl`, `setStatus`, `setHeader`, `appendHeader`, `serverRedirect`, `serverNotFound`) for service-native server handlers/SSR flows
  - added first route/server graph introspection + validation helpers (`Route.nodes`, `parentOf`, `ancestorsOf`, `depthOf`, `routeChainOf`, `fullPathOf`, `paramNamesOf`, `validateTree`; `ServerRoute.nodes`, `validate`, `matches`, `find`)
  - expanded server-route observability/validation with `ServerRoute.byKey`, `ServerRoute.identity`, missing-handler checks, and invalid document decode wiring checks; runtime snapshots now expose `matchedServerRoute`
  - route/server validation now also includes conflicting sibling route pattern detection and overlapping document route detection
- Reactivity integration kickoff landed:
  - introduced library-owned `Reactivity` service (`src/Reactivity.ts`) with `live` and `test` layers
  - added runtime adapter bridge (`src/reactivity-runtime.ts`) and connected `Atom.invalidateReactivity/trackReactivity/withReactivity`
  - added mount-time Reactivity service installation for runtime-backed invalidation (`src/effect-ts.ts`)
  - added service-level tests (`src/__tests__/reactivity-service.test.ts`) including live microtask auto-flush and test manual flush behavior
- Reactivity integration hardening landed:
  - service installation now re-subscribes tracked runtime keys and routes service invalidations back into atom key tracking (`src/reactivity-runtime.ts`)
  - router loader cache now subscribes to reactivity keys via the installed service and marks cache entries stale on invalidation (`src/router-runtime.ts`)
  - added `Atom.reactivityKeys(atom)` introspection helper and tests for service-to-atom invalidation bridge + loader cache stale behavior
- Atom type-surface convergence continued:
  - `ReadonlyAtom`, `Atom`, and `WritableAtom` now carry explicit `A`, `E`, and `R` type axes with extraction helpers (`ValueOf`, `ErrorOf`, `RequirementsOf`)
  - async atoms created through `Atom.query`, `Atom.effect`, `Atom.runtime(...).atom(...)`, and async projections preserve their typed error channel as atom metadata
  - `Atom.map` preserves atom error/requirement metadata through read-only derived atoms
  - `Context.result`, `WriteContext.result`, and `Atom.result` now expose async-atom overloads that read the typed `E` axis directly while retaining `FetchResult` compatibility
  - `defineQuery((get) => Effect...)` now supports dependency-aware query factories; `get(atom)` tracks synchronous atom reads and `get.result(asyncAtom)` contributes typed dependency errors plus `BridgeError`
  - action/mutation type extraction helpers now expose input, domain error, full Effect error, and success metadata for `defineMutation`, `Atom.action`, RPC actions, and HTTP API actions
  - `Atom.family(..., { schema })` now supports schema-validated atom family values, returning `Exit<A, SchemaError>` atoms while preserving existing cache/equality behavior
  - `Component.make` / `Component.headless` now union explicit `Component.require(...)` requirements with setup-inferred requirements from helpers like `Component.query`, `Component.action`, and `Component.scheduleEffect`
  - `Component.state()` no longer casts through `as unknown as Atom.WritableAtom`; it now constructs exact component-local writable state directly
  - type coverage added in `src/type-tests/atom-type-axes.ts` and `src/type-tests/component-core.ts`

## Recently Completed Work

### Docs Modernization Pass (2026-07-06)

- Added `docs/COMPONENT_STATE_OWNERSHIP.md`:
  - explains `Component.state()` as a component-instance-local ownership helper,
    not a separate state model or replacement for `Atom`.
  - clarifies when state belongs in props, setup bindings, shared atoms, or
    slots.
  - links the note from `docs/PROPS_BINDINGS_SLOTS.md`.
- Implemented setup-helper ownership boundaries:
  - scoped `Component.state(...)` and `Component.signal(...)` writes now throw
    after the setup `Scope` closes.
  - `Component.effect(...)`, `Component.query(...)`,
    `Component.action(...)`, and `Component.optimistic(...).action(...)` create
    their reactive/mutation owners under the setup scope.
  - component actions and optimistic actions reject mutating operations after
    setup scope close.
  - `Component.ref(...)` clears `.current` on setup scope close.
  - direct unscoped `setupEffect(...)` callers keep explicit caller-owned
    handles for tests, SSR inspection, and low-level tooling.
- Continued README/current guide alignment:
  - Added an AF-UI component quick-start section to README using
    `Component.setup(...)`, `View.Slots`, `View.fromSlots(...)`, and
    `Component.withSlots(...)`.
  - Updated `docs/BINDINGS_ASYNC_COMMIT_BOUNDARY.md` current example to use the
    setup builder.
  - Updated `docs/METADATA_WITNESS_IMPLEMENTATION_PLAN.md` golden path to use
    `View.Slot`, `View.Slots`, `View.fromSlots(...)`,
    `Component.withSlots(...)`, `Style.forSlots(...)`, and
    `Behavior.forSlots(...)` instead of manual `bindings.slots` plus separate
    `slotMetadata`.
  - Marked `docs/BINDINGS_VS_SLOTS_REFACTOR.md` as historical background and
    pointed readers to the current `SlotContract` / `View.Slots` model.
  - Updated the typed-tree API example to derive handles from `View.Slots`
    instead of manually threading `bindings.slots`.
  - Updated `docs/GEN2_UI_IMPLEMENTATION_NOTES.md` so the migration path points
    at `View.fromSlots(...)`, `Component.withSlots(...)`, and the existing
    runtime-native `View` module.
  - Updated `docs/SLOT_WITNESS_PLAN.md` to mark slot contract unification as
    complete for the current contract path and to remove the old
    witness-named component helper guidance.
  - Added current-status notes to older exploratory `docs/composables.md`,
    `docs/renderer.md`, and `docs/platform.md`.
- Updated `AGENTS.md` to reflect the current slot-contract model:
  - `View.Slots` / `Component.withSlots(...)` are current authored APIs.
  - `Component.SlotContractOf<T>` is the authored contract extractor.
  - old `SlotWitnesses` component-axis language is no longer described as
    current.
- Updated `docs/API.md` examples and attachment descriptions:
  - service-backed component example now uses `Component.setup(...)`.
  - `Component.query(...)` examples use the current thunked Effect shape.
  - `Behavior.attachBySlots(...)` and `Style.attachBySlots(...)` are described
    as dynamic/generated string-map APIs.
- Updated `docs/AF_UI_CONTRACT.md` and
  `docs/SLOT_CONTRACT_UNIFICATION_PLAN.md` to describe `View.Slots` as the
  current canonical authored slot contract rather than a future step.
- Updated current examples in `docs/component.md`,
  `docs/SETUP_VIEW_COMPARISON.md`, and
  `docs/OPTIMISTIC_ACTION_DESIGN_PLAN.md` to show setup-builder authoring.
- Added current-status notes to older exploratory `docs/view.md`,
  `docs/router.md`, and `docs/style.md` so historical examples do not compete
  with the current API docs.
- Validation status: typecheck clean, 477 tests pass, build clean.

### Result Atom Alias Cleanup (2026-07-06)

- Added `Atom.ResultAtom<A, E, R>` as the canonical named alias for
  `Atom<Result<A, E>, E, R>`.
- Kept `Atom.AsyncAtom<A, E, R>` as a compatibility alias only.
- Updated result-valued atom helper signatures to use `ResultAtom` instead of
  `AsyncAtom`:
  - `Atom.withRetry(...)`
  - `Atom.withPolling(...)`
  - `Atom.withStaleTime(...)`
  - `Atom.runtime(...).atom(...)`
  - `Atom.projectionAsync(...)`
  - `Atom.query(...)`
  - `Atom.effect(...)`
- Updated type tests to use `Atom.ErrorOf<T>` metadata extraction instead of
  pattern matching against `AsyncAtom`.
- Updated README/API docs to show `ResultAtom` as the visible alias and
  `AsyncAtom` as compatibility.
- Validation status: typecheck clean, 471 tests pass, build clean.

### Atom Result Bridge Metadata Cleanup (2026-07-06)

- Updated `Context.result(...)`, `WriteContext.result(...)`, and
  `Atom.result(...)` signatures to infer the Effect error channel from atom
  `E` metadata when present.
- Kept compatibility with plain result-valued atoms by falling back to the inner
  `Result` / `FetchResult` failure type when the atom metadata error is `never`.
- Tightened result success/error extraction to use tagged `Success` / `Failure`
  members instead of broad `Result<A, E>` inference.
- Added type coverage showing metadata error typing is authoritative even when
  the result value type carries a broad inner error.
- Validation status: typecheck clean, 471 tests pass, build clean.

### Component Setup Builder Dogfood Pass (2026-07-06)

- Migrated `examples/auto-counter/App.tsx` to `Component.setup(...)` with named
  builder bindings for state, commands, and setup-scoped interval behavior.
- Updated `docs/ASYNC_COUNTER_OPTIMISTIC_EXAMPLE.md` so the golden async /
  optimistic counter uses the setup builder while preserving typed service
  requirements and runtime-bound query/action handles.
- Updated `docs/SLOT_CONTRACT_GOLDEN_PATH.md` so the authored slot-contract
  example uses `Component.setup(...).value("slots", ...)` instead of a one-off
  setup Effect.
- Validation status: typecheck clean, 471 tests pass, build clean.

### Component Setup Builder Implementation (2026-07-06)

- Added `docs/COMPONENT_SETUP_BUILDER_PLAN.md`.
- Implemented a small pipeable setup authoring layer over the existing
  setup-as-Effect model:
  - `Component.setup<Props>()`
  - `Component.bind("name", ...)`
  - `Component.use(fragment)`
  - `Component.value("name", ...)`
  - `Component.doEffect(...)`
- Added builder methods for the same operations, so callback inputs can infer
  typed `props` and prior `bindings` directly from the current setup builder.
- Key design decision: setup builder output compiles down to the same
  `(props) => Effect<Bindings, E, R>` contract used by `Component.make(...)`
  today. It should not revive the older imperative `ctx` setup API or introduce
  a second runtime path.
- `Component.make(...)` and `Component.headless(...)` now accept either a raw
  setup function or a `Component.Setup` builder.
- The builder accumulates named bindings, rejects duplicate binding names by
  default, preserves props and earlier-binding access, and keeps requirement /
  error accumulation aligned with existing setup helper semantics.
- Added compile-time coverage in `src/type-tests/component-core.ts` and runtime
  coverage in `src/__tests__/component.test.ts`.
- Updated `docs/API.md` and `docs/COMPONENT_SETUP_BUILDER_PLAN.md`.
- Validation status: typecheck clean, 471 tests pass, build clean.

### Component Action Alignment Follow-Up (2026-07-03)

- Aligned `Component.action(...)` with the current atom action handle shape:
  - callable handle and `run(...)` remain fire-and-forget.
  - `runEffect(...)` remains the typed success-returning Effect path.
  - added `effect(...)` as the typed fire-and-forget Effect path.
  - `result` and `pending` are unchanged.
- Added component action extraction helpers:
  - `Component.ActionArgsOf<T>`
  - `Component.ActionInputOf<T>`
  - `Component.ActionErrorOf<T>`
  - `Component.ActionSuccessOf<T>`
  - `Component.ActionRunErrorOf<T>`
  - `Component.ActionEffectErrorOf<T>`
  - `Component.ActionRunEffectOf<T>`
  - `Component.ActionEffectOf<T>`
- Fixed `ComponentAction.runEffect(...)` so it no longer executes the action
  twice. It now matches the atom action model: one typed execution path.
- `Component.action(...)` now captures the setup `ServiceMap` when the handle is
  created and uses it for later `run(...)`, `effect(...)`, and
  `runEffect(...)` execution.
- `Component.query(...)` now captures the setup `ServiceMap` and passes it to
  `defineQuery(...)`, so async query work can use services supplied by
  `Component.withLayer(...)`.
- `Component.optimistic(...).action(...)` now captures the setup `ServiceMap`
  and uses a runtime-bound optimistic action path, so optimistic action effects
  can also use services supplied by component layers.
- Added runtime coverage proving a component action can use a service supplied by
  `Component.withLayer(...)` after setup has already returned.
- Added runtime coverage proving component queries and component optimistic
  actions use the setup runtime context.
- Added type coverage proving setup helper service requirements bubble to the
  component boundary while returned query/action/optimistic bindings do not
  expose unresolved service requirements after setup-time capture.
- Updated `docs/component.md` setup helper signatures to match the current API:
  service-capturing helpers use their input `R`; only scoped fiber helpers such
  as `fromDequeue`, `schedule`, and `scheduleEffect` require `Scope.Scope`.
- Marked the older `ctx.*` component setup narrative in `docs/component.md` as
  historical design material and added a current setup-as-Effect entry point so
  the implemented API is not confused with pre-implementation sketches.
- Added compile-time coverage in `src/type-tests/component-core.ts` and runtime
  coverage for `ComponentAction.effect(...)`.
- Validation status: focused typecheck clean.

### Action Type Helper Follow-Up (2026-07-03)

- Added canonical extraction helpers for the current action handle contract:
  - `Atom.ActionEffectErrorOf<T>`
  - `Atom.ActionRunEffectOf<T>`
  - `Atom.ActionEffectOf<T>`
- Aligned optimistic action helper aliases with the shared `ActionHandle`
  contract:
  - `Atom.OptimisticActionEffectErrorOf<T>`
  - `Atom.OptimisticActionRunEffectOf<T>`
  - `Atom.OptimisticActionEffectOf<T>`
- Added compile-time coverage showing:
  - callable action handles and `run(...)` remain fire-and-forget (`void`).
  - `runEffect(...)` is the typed success-returning Effect path.
  - `effect(...)` is the typed fire-and-forget Effect path.
  - optimistic action helpers expose the same run/effect surfaces as regular
    actions.
- Validation status: typecheck clean.

### Atom Metadata Preservation Follow-Up (2026-07-03)

- Tightened the `Atom<A, E, R>` type surface through smaller composition helpers:
  - `Atom.query(() => Effect<...>)` now preserves unresolved service
    requirements on the returned async atom.
  - `Atom.projectionAsync(...)` preserves `R` when unbound and eliminates `R`
    when a runtime is supplied.
  - `Atom.withReactivity(...)` preserves `A` / `E` / `R` metadata instead of
    collapsing to a plain atom value axis.
  - `Atom.withFallback(...)` preserves `E` / `R` metadata while narrowing
    `null` / `undefined` out of the value axis.
- Added compile-time coverage in `src/type-tests/atom-type-axes.ts` for unbound
  query requirements, runtime-bound projection requirements, reactivity wrapping,
  fallback wrapping, and `Atom.get(...)` requirement propagation.
- Validation status: typecheck clean.

### Optimistic Action Design Plan (2026-07-01)

- Added `docs/OPTIMISTIC_ACTION_DESIGN_PLAN.md`.
- Added `docs/ASYNC_COUNTER_OPTIMISTIC_EXAMPLE.md` as the target user-facing
  example for optimistic actions, `Async`, `Loading`, rollback, pending, typed
  errors, service requirements, and slot-based styling.
- The plan reframes optimistic UI around an authored atom/action lifecycle:
  - `Atom.optimistic(source).action(...)`
  - `Atom.runtime(layer).optimistic(source).action(...)`
  - `Component.optimistic(source).action(...)`
- It keeps current primitives as lower-level implementation paths:
  - `createOptimistic(source)` remains the overlay primitive.
  - `defineMutation(...)` remains the callback-style mutation API.
  - `Atom.runtime(...).action(...)` remains the primary non-optimistic
    service-backed write API.
- The target handle unifies:
  - visible optimistic value
  - committed value
  - async `Result`
  - pending projection
  - rollback/clear
  - typed `Effect` composition
  - optional reconciliation and reactivity invalidation
- Key design rule: `pending()` remains a projection from `Result`, while
  `hasOptimistic()` answers the separate question of whether the visible value
  is temporary.
- First implementation slice landed:
  - `Atom.optimistic(source).action(...)`
  - `Atom.runtime(layer).optimistic(source).action(...)`
  - `Component.optimistic(source).action(...)`
  - optimistic action handles expose `value`, `committed`, `optimistic`,
    `hasOptimistic`, `rollback`, and `clear`
  - action specs support `update`, `effect`, optional `reconcile`, optional
    `commit`, reactivity keys, single-flight options, and lifecycle hooks
  - focused runtime tests cover success commit, typed failure rollback, and
    component-scoped usage
  - additional lifecycle tests cover defect rollback, server reconciliation,
    custom commit, latest-run-wins behavior, and reactivity key invalidation
  - type tests cover input/value/success/error inference, run-effect error
    shape, runtime-bound actions, and component requirement bubbling

### Slot Witness Metadata And Contract Unification Plan (2026-07-01)

- Added `docs/PROPS_BINDINGS_SLOTS.md`, a focused architecture note explaining
  why props, bindings, and slots are separate ownership surfaces and how their
  type safety differs.
- Added `docs/BINDINGS_ASYNC_COMMIT_BOUNDARY.md`, explaining how bindings
  isolate async work from committed views and effect attachment.
- Added static slot contract metadata to components:
  - `Component.Component<Props, Req, E, Bindings, SlotContract>`
  - `Component.SlotContractOf<T>`
  - `Component.withSlots(...)`
  - `Component.withSlotContract(...)`
- Added the canonical slot contract component API:
  - `Component.withSlots(...)`
  - `Component.withSlotContract(...)`
  - `Component.SlotContractOf<T>`
  - `Component.PublicSlotsOf<T>`
  - `Component.HiddenSlotsOf<T>`
  - focused type/runtime tests now exercise `withSlots(...)`
  - component metadata now exposes `SlotContract` as the primary branded field
  - `withSlots(View.Slots)` now derives `Component.SlotsOf<T>` from
    `View.Slots.HandlesOf<typeof slots>` so authored contracts cannot drift from
    stale binding-slot types.
  - `withSlots(View.Slots)` now injects projected slot handles into setup
    bindings when author setup does not expose `bindings.slots`, so view-backed
    components can use behavior attachment without duplicating the slot map.
- Added `docs/SLOT_CONTRACT_GOLDEN_PATH.md` and linked it from README/API as the
  authored slot-based component starting point.
- Added runtime slot contract inspection and drift diagnostics:
  - `Component.withSlots(slots)` now stores the authored contract in a runtime
    registry.
  - `Component.getSlotContract(component)` exposes the authored contract for
    inspection.
  - `Component.validateSlotContract(component, view, bindings?)` compares a
    rendered `View` with the declared contract.
  - `Component.validateRenderedSlotContract(component, props)` runs setup/view
    and returns diagnostics explicitly.
  - tests cover matching contracts, missing declared slots, undeclared rendered
    slots, capability mismatches, and wrapper preservation.
  - decision: declared-vs-rendered component diagnostics stay explicit-only for
    now; normal render paths do not auto-report them.
- Preserved the slot contract axis through component wrappers and route metadata
  helpers.
- Extended the preservation audit so `Component.SlotsOf<T>` and
  `Component.SlotContractOf<T>` remain precise through mixed style/behavior
  chains, route-node materialization, and loader-decorated route-node pipes.
- Standardized the authored Style/Behavior slot-contract API shape:
  - `Style.forSlots(slots)(...)`
  - `Style.attachToSlots(style, slots)`
  - `Behavior.forSlots(slots)(...)`
  - `Behavior.attachToSlots(behavior, slots)`
- Renamed the typed remapping helper to `attachBySlotContract(...)` and
  documented `attachBySlots(...)` as the dynamic/generated string-map path.
- Added `docs/SLOT_CONTRACT_UNIFICATION_PLAN.md` as the current slot
  unification record:
  - `View.Slots` is the single canonical authored slot contract.
  - `Component.withSlots(...)` is the component contract helper.
  - `Component.SlotContractOf<T>` is the canonical extraction name.
  - The component type surface now uses the single `SlotContract` axis.
- Slot contract unification is closed for now:
  - implementation slices are complete or explicitly decided.
  - declared-vs-rendered component diagnostics are explicit-only.
  - authored view-backed components can use behavior attachment without
    duplicating slot maps in setup.
- Validation status: typecheck clean, 466 tests pass, build clean.

### Slot Witness Typed Tree And Attachment Follow-Up (2026-07-01)

- Made capability-based behavior/style attachment hierarchy-aware:
  - `Behavior.attachToAllWithCapability(...)` now uses `View.extendsCapability(...)`
  - `Style.attachToAllWithCapability(...)` now uses `View.extendsCapability(...)`
  - tests verify parent capability selection such as `Focusable` matching `TextInput`
- Added slot witness typed-tree authoring:
  - `View.element(InputSlot, ...)` derives the element capability and slot name from the witness
  - type coverage verifies witness-authored trees compose with `View.fromSlots(...)`
- Added first slot-contract-targeted style/behavior attachment APIs:
  - `Style.forSlots(...)`
  - `Style.attachToSlots(...)`
  - `Style.attachBySlotContract(...)`
  - `Behavior.attachBySlotContract(...)`
- Runtime coverage verifies slot-contract-targeted style construction/attachment and behavior attachment without duplicated string slot maps.
- Planned the next typed-view ergonomics slice:
  - constructed `View<Slots>` records are now pipeable
  - added pipeable helpers such as `View.withTree(...)`, `View.withChildren(...)`, `View.appendChildren(...)`, and metadata/remap transforms
  - keep `View.children(...)` as the existing dynamic children hole helper
  - multi-step `View.pipe(...)` now accepts only transforms compatible with the view's slot map instead of an arbitrary `any` chain
- Validation status: typecheck clean, 449 tests pass, build clean.

### Capability Filtering Helpers for Behavior/Style (2026-07-01)

- Added capability filtering helpers to support behavior/style selection by capability:
  - `View.Slots.withCapability(slots, capability)` — runtime filtering of slot collections by capability
  - `Behavior.attachToAllWithCapability(behavior, capability)` — attaches behavior to all slots matching a capability
  - `Style.attachToAllWithCapability(style, capability)` — attaches style to all slots matching a capability
- All helpers support both string and witness-based capabilities
- Added runtime tests (`src/__tests__/capability-filtering.test.ts`) verifying:
  - `View.Slots.withCapability` filters slots correctly
  - `Behavior.attachToAllWithCapability` attaches to matching slots and runs with empty elements when no match
  - `Style.attachToAllWithCapability` applies styles to matching slots
- Validation status: typecheck clean, 444 tests pass, build clean.

### Slot Witness Pipeable Composition (2026-07-01)

- Added pipeable metadata composition helpers to `View.Slot` namespace:
  - `View.Slot.capability(cap)` — updates slot capability
  - `View.Slot.events(...events)` — updates slot allowed events
  - `View.Slot.attributes(...attrs)` — updates slot allowed attributes
  - `View.Slot.requires(...reqs)` — updates slot platform requirements
  - `View.Slot.hidden` — marks slot as hidden
- Extended `Pipeable<Self>` interface to support 4-6 argument pipe chains
- All helpers preserve type information through composition
- Added type tests (`src/type-tests/slot-contract-composition.ts`) verifying:
  - name/capability/events/attributes/requirements/hidden metadata extraction
  - hidden slot filtering with `View.Slot.Public<T>` and `View.Slot.Hidden<T>`
  - `View.Slots.make(...)` key matching validation
  - `View.Slots.WithCapability<T, C>` capability filtering
  - `View.Slots.Pick<T, K>` and `View.Slots.Omit<T, K>` slot selection
  - `View.fromSlots(...)` derives correct slots and slotMetadata
- Added runtime tests verifying pipe composition preserves and updates metadata correctly
- Validation status: typecheck clean, 428 tests pass, build clean.

### Typesafety Cleanup & Route Req/E Propagation (2026-07-01)

- Simplified `Context.result` overloads in `Atom.ts` — removed redundant `AsyncAtom` variants, unified on `ReadonlyAtom<Result<A, E> | FetchResult.Result<A, E>, any, any>`.
- Fixed `Component.query` to preserve `E` metadata: return type changed from `Atom.ReadonlyAtom<Result<A, E>>` to `Atom.ReadonlyAtom<Result<A, E>, E>`.
- Simplified `ResultBridge`, `WriteContext.result`, and `QueryGet.result` overloads to remove redundant `AsyncAtom` variants.
- Audited route-node/server-route for requirement metadata preservation.
- Fixed `Route.guard()` unified overload to propagate `Req`/`E` into the component's type axes using `ComponentWithAddedReqE<C, Req, E>` helper.
- Fixed `Route.loader()` unified overload to propagate `R`/`E` into the component's type axes.
- Added type tests (`src/type-tests/route-req-propagation.ts`) verifying guard and loader Req/E propagation.
- Validation status: typecheck clean, 428 tests pass, build clean.

### Route-Node Golden Path Example (2026-07-01)

- Created `examples/router-golden-path/` — a complete end-to-end demonstration of the route-node API.
- Demonstrates: `Route.page`, `Route.layout`, `Route.index`, `Route.define`, `Route.children`, `Route.mount`, `Route.ref`.
- Shows typed params/query/hash with Effect Schema (`Route.paramsSchema`, `Route.querySchema`).
- Shows loaders that use domain services with `Reactivity.tracked(...)` and `Reactivity.invalidating(...)`.
- Shows typed links with `Route.link(...)`.
- Shows error handling with `Async`, `Loading`, `Errored` components.
- Shows head metadata with `Route.title(...)` and `Route.meta(...)`.
- Added example reference to README examples table and Route Nodes section.
- Validation status: typecheck clean, 428 tests pass, build clean.

### Atom A/E/R Type Axes & Component State Cleanup (2026-06-29)

- Added backward-compatible `A` / `E` / `R` type axes to `ReadonlyAtom`, `Atom`, and `WritableAtom`.
- Added `Atom.ValueOf<T>`, `Atom.ErrorOf<T>`, and `Atom.RequirementsOf<T>` extraction helpers.
- Updated async atom constructors and `Atom.map` so typed error metadata is preserved through runtime-bound atoms and derived atoms.
- Added async-atom result bridge overloads for `Context.result`, `WriteContext.result`, and `Atom.result`, with type coverage for data-first, data-last, read context, write context, and legacy `FetchResult` atoms.
- Added `defineQuery((get) => Effect...)` factory overloads, query getter result bridging, runtime dependency tracking coverage, and type tests for dependency error unions.
- Added `MutationInputOf`, `MutationErrorOf`, `MutationEffectErrorOf`, `MutationSuccessOf`, `ActionInputOf`, `ActionErrorOf`, `ActionRunErrorOf`, and `ActionSuccessOf` helper aliases with type coverage across local actions, runtime actions, RPC actions, and HTTP API actions.
- Added `Atom.family(..., { schema })` for schema-validated family member atoms, with runtime/type coverage and README/API documentation.
- Updated `Component.make` and `Component.headless` requirement inference so setup-derived requirements are preserved even when `Component.require<never>()` is used, with type coverage for query/action/schedule helpers and `withLayer` removal.
- Added regression type coverage proving component transforms preserve or add requirement/error metadata across `guard`, `route`, and `withBehavior`.
- Reworked `Component.state()` to avoid the previous `as unknown as Atom.WritableAtom` cast while preserving exact local state typing.
- Validation status: typecheck clean, 405 tests pass, build clean.

### View-Aware Slot Attachment & ReadonlyAtom (2026-06-23)

- Added `Component.withViewTransform` — wraps a component's view function to apply transforms after view execution, preserving all 5 type parameters including `Slots`.
- Added `Component.registerViewSlots` / `Component.getViewSlots` — per-instance slot registry extracted from `View<Slots>` after view runs.
- Modified component wrapper (`toComponent`, `renderEffect`) to auto-register view slots when view returns a `View<Slots>`.
- Added `Style.attachByView` — applies styles to `View<Slots>` slots after view execution, supporting `OverrideContext` and `Collection` handles. No `Bindings extends { readonly slots: Slots }` constraint.
- Added type tests for `Style.attachByView`: positive (matching slots), negative (missing slot), and `Component.SlotsOf<T>` preservation.
- Made `ReadonlyAtom<A>` a structurally distinct branded interface (not just an alias for `Atom<A>`), with `Atom<A>` extending it.
- Updated `Atom.map`, `Atom.derived`, `Atom.get`, `Atom.result`, `Atom.withFallback`, `Atom.subscribe`, `Context.get/refresh/result`, and `WriteContext.get/result` to accept `ReadonlyAtom<A>`.
- Updated `AtomSchema.ValidatedAtom` interface to use `ReadonlyAtom` for derived fields.
- All quality gates: typecheck clean, 402 tests pass, build clean.

### Audit & Fixes (2026-06-23)

- Audited all component transforms (`withLayer`, `withErrorBoundary`, `withLoading`, `withSpan`, `memo`, `tapSetup`, `withPreSetup`, `withSetupRetry`, `withSetupTimeout`, `withBehavior`, `route`, `guard`) for `SlotsOf<C>` preservation.
- Fixed `guard` transform to preserve the `Slots` type parameter through its return type.
- Added negative type tests for `Style.attach` when style slots don't exist in component slots.
- Added `Component.SlotsOf<T>` preservation type test on a component after `Style.attachBySlots` — verifies slot types are preserved through style attachment.

### Style Surface Consolidation (2026-06-23)

- Renamed `src/type-tests/style2-grid-selectors.ts` → `style-grid-selectors.ts` to remove "Style2" naming.
- Renamed `style2.test.ts` describe block from `"Style2 advanced descriptors"` to `"Style advanced descriptors"`.
- Marked `docs/style2.md` and `docs/STYLE2_IMPLEMENTATION_PLAN.md` with historical notes directing readers to the unified `Style` API.
- Confirmed all advanced CSS descriptors (nest, vars, media, supports, container, pseudo, grid, layers, animate, enter/exit) already live directly in `src/Style.ts` — no separate "Style2" system.


### Reactivity Key Witnesses Slice 1 (2026-07-06)

- Added branded key witnesses to the reactivity runtime
  (`src/reactivity-runtime.ts`): `ReactivityKeyTypeId`,
  `ReactivityKeyWitness<Name>`, `makeReactivityKeyWitness(...)`,
  `isReactivityKeyWitness(...)`.
- `ReactivityKeysInput` array form now accepts `string | ReactivityKeyWitness`;
  `normalizeReactivityKeys(...)` expands witnesses to their ancestor chain +
  self and dedupes preserving order.
- Hierarchy semantics deliberately match the existing record-form convention
  (`{ users: ["alice"] }` -> `["users", "users:alice"]`) for both tracking and
  invalidation; sibling over-invalidation through the shared parent key is a
  documented trade-off.
- Public surface in `src/Reactivity.ts`: `Reactivity.Key.make(name)`,
  `Reactivity.Key.family(name)` (callable member derivation + `.key` parent),
  `Reactivity.Key.is(...)`, `KeyFamily<Name>`, `KeyNameOf<T>`, re-exported
  `ReactivityKeyWitness`.
- No signature changes needed in Atom/Component/AtomRpc/AtomHttpApi — they
  already share `ReactivityKeysInput`. `Route.ts` still uses
  `ReadonlyArray<string>` at loader option sites (slice 2).
- Coverage: three new runtime tests (string/witness parity, child expansion,
  family + ancestor dedupe) in `src/__tests__/reactivity-service.test.ts`;
  new type tests in `src/type-tests/reactivity-keys.ts` (literal name
  preservation, `KeyNameOf`, mixed witness/string inputs, rejection cases).
- Validation: typecheck clean, 480 tests pass, build clean.

### Reactivity Key Witnesses Slice 2 — Route Integration + Docs (2026-07-06)

- Widened all `Route`/router-runtime key intake sites from
  `ReadonlyArray<string>` to `ReactivityKeysInput` (witnesses + strings +
  record form): `LoaderOptions.reactivityKeys`,
  `SingleFlightOptions.reactivityKeys`, `Route.action(...)` options,
  `Route.runMatchedLoaders(...)` overload filters, and in router-runtime
  `runCachedLoader` / `executeAndCache` / `setLoaderCacheEntry` /
  `invalidateLoaderReactivity` / `collectLoaderReactivityKeys`.
- Normalization happens once at each boundary; the loader cache and
  `matchesLoaderReactivity` continue to operate on normalized strings.
- New integration test in `src/__tests__/route-loader.test.ts`: witness in
  loader options expands to ancestors + self in the cache entry, a witness
  matcher filter selects the loader via the parent key, and invalidating the
  parent marks the child-keyed entry stale.
- Docs migrated to witnesses as the authored path: `docs/API.md` gained a
  "Key witnesses (authored path)" reference block; `README.md` main
  query/action/optimistic examples now share one `Users` witness;
  `docs/afui.md` and `README.new.md` reactivity/loader examples lead with
  witnesses and note strings as the dynamic escape hatch.
- Validation: typecheck clean, 481 tests pass, build clean.

### Services & Layers Docs + Server Layer Fix (S2/S3/S4/F6) (2026-07-06)

- Added `docs/SERVICES_AND_LAYERS.md`: one-composition-root doctrine (single
  `AppLayer` feeds both `Atom.runtime` and `Component.mount`), four provision
  tiers with a decision table (app root / subtree / per-operation / ambient
  framework tags), sharing semantics (verified: `withLayer` builds the layer
  per component instance via `Effect.provide` around setup — siblings never
  share), failure blast radius, capture-at-setup interaction, requirement
  subsets, server request-scoping rule, services-as-reactive-participants
  with key witnesses, and testing-by-layer-substitution.
- Fixed `ServerRoute.dispatch({ layer })`: the per-dispatch layer was only
  applied to document routes; data-route handlers ran without it. `execute`
  and `executeWithServices` now accept `options.layer` and provide it around
  the handler (built per execution). Added request-isolation coverage in
  `src/__tests__/server-route.test.ts` proving the layer reaches data
  handlers and is constructed fresh per dispatch.
- Added "when not to use this" sections (F6) to `README.md`, `README.new.md`,
  and `docs/afui.md`.
- Validation: typecheck clean, full test suite pass, build clean.

### Test-Typecheck Gate + Library Hardening (2026-07-07)

- Added `npm run typecheck:tests` (`tsconfig.tests.json`) so `src/__tests__`
  is type-checked (the standard `typecheck`/build exclude tests). Not yet
  green — residual tracked below — but the gate now exists and is runnable.
- Library improvements surfaced while burning down test-type errors (all keep
  standard gates green: typecheck, 484 tests, build):
  - `Behavior.make<Elements, Bindings = {}, Req = never, E = never>` — trailing
    generic defaults, so `Behavior.make<Els, Binds>` is valid (was: all four
    required).
  - `View.Attribute.AriaDescribedby` witness added.
  - `View.isElement` / `View.isFragment` / `View.isTextNode` `ViewNode`
    narrowing guards (public; used to fix union-access in tests).
  - `Component.renderEffect` now carries the 5th `SlotContract` type param
    (matching `renderViewEffect`) — components with a published contract via
    `withSlots(...)` now pass to `renderEffect` without a variance error.
- Test-side fixes: `Result` re-read narrowing (`component.test`), `ViewNode`
  guard usage (`view.test`).
- Reduced test-type errors 40 -> 23.
- **Genuine bug surfaced by the gate (recorded, not yet fixed):**
  `Atom.family` overload ordering — when the family function returns an atom
  (the common case, `family((id) => Atom.make(...))`), the schema overload
  greedily matches and demands the (schema) options arg, so
  `Atom.family(fn)` and `Atom.family(fn, { equals })` mis-resolve. Fix needs
  careful overload reordering that preserves the schema-exit return type;
  scoped with the Finding-3/P6 test-migration pass.

### Atom.family Overload Bug Fix (2026-07-07)

- Root cause: `Atom.family` had only ONE visible overload (the schema
  variant); the plain signature was the (hidden) implementation signature, so
  external callers had no plain overload to match. `family(fn)` failed with
  "Expected 2 arguments" and `family(fn, { equals })` failed (missing
  `schema`). Runtime was fine — types only — which is why the standard gate
  (tests excluded) stayed green.
- Fix: added the plain signature as a proper visible overload, ordered first,
  with the schema overload second; a `{ schema }` object literal fails the
  plain overload's excess-property check and falls through. Implementation
  unchanged.
- Verified: main typecheck green (schema type-tests in
  `type-tests/atom-family-schema.ts` still resolve to `Exit`-wrapped members),
  test-gate errors 23 -> 20, 484 tests + build green.

### Finding-5 Result Consolidation, Release-Blocking Core (2026-07-07)

Steps 0-1 of the RESULT_CONSOLIDATION_PROPOSAL migration.

- **Step 0 (characterization):** added the missing end-to-end SSR wire
  round-trip test (`server-render.test.ts`): renderRequest -> serializeLoaderData
  -> deserializeLoaderData -> hydrateSingleFlightPayload -> first client render,
  asserting the settled value survives. Existing tests passed loaderPayload
  straight to hydrate, skipping the JSON wire step entirely. Also pinned the
  current FetchResult wire shape (`route-loader.test.ts`) so step-2's format
  change is an explicit, visible test update rather than a silent break.
- **Step 1 (public surface -> unified Result):**
  - `Route.loaderResult()` now returns unified `Result` (Loading/Refreshing/
    Success/Failure/Defect), converting the internal SWR `FetchResult` cache
    shape via `FetchResult.toResult` at the accessor boundary. Added a
    deprecated `Route.loaderFetchResult()` compat accessor.
  - `Route.title`/`Route.meta` loader callbacks: the 3rd `loaderResult` param
    migrated FetchResult -> unified Result. Added `Route.toUnifiedLoaderResult`
    shared by the tree-render and legacy-component head paths — which had
    diverged: the legacy `Component.route` path passed a raw FetchResult to
    head callbacks while the tree path did not. New test locks in the unified
    shape (Success.value, no `waiting` field).
- **Acceptance met:** grep for `defect: string` across `Route.ts`/`Component.ts`
  public API returns nothing; golden-path loader surfaces emit unified Result.
  FetchResult now survives only in internal machinery (cache, wire payloads,
  orchestration, Atom.pull) = step-2 non-blocking cleanup.
- 487 tests + typecheck + build green.

### Test-Typecheck Gate Burndown, Round 2 (Finding-3/P6) (2026-07-07)

Continued burning down `typecheck:tests` errors. The gate proved its worth
decisively — it surfaced **five real library bugs**, all now fixed (runtime
was unaffected; types only, which is why the tests-excluded standard gate
stayed green throughout):

1. `Atom.family` — plain overload was invisible (schema-only), so
   `family(fn)` / `family(fn, { equals })` never typechecked.
2. `Component.renderEffect` — dropped the 5th `SlotContract` type param, so
   components with a published contract failed to pass.
3. `Component.route` — leaked `RouteContext` into `Req` instead of
   discharging it (the wrapper provides it to the inner setup).
4. `ServerRoute.execute` / `executeWithServices` / `executeFromServices` —
   constrained to `ServerRouteNode<any,any,any,any>` (params 5-7 default to
   `unknown`); the contravariant handler position rejected nodes with
   specific query/header/cookie types. Broadened to `AnyServerRouteNode`.
5. (Round 1) `Behavior.make` required all four generics; added defaults.

Plus test-side fixes (View narrowing guards, Result re-read, `Style.slot`
value vs slot-keyed `Style.make`). Net: 40 -> 16 errors.

The remaining 16 are two tracked categories, neither cheaply forced green now:
- **Coupled to Finding-3/P6 physical deletion**: tests exercising deprecated
  `Style.attachByView` + bindings-as-slots (component.test 528-530) and legacy
  route construction (route.test 135/136/234/239, route-loader 146). These get
  rewritten/removed when the deprecated APIs are physically deleted; fixing
  them now is throwaway work.
- **Deep type-helper drift** (real, non-trivial): `Style/Behavior
  .attachToAllWithCapability` over-constrain SlotContract to a handle-map shape
  (capability-filtering 257/260/345/373); `withRetry` on a hand-built result
  union (effect-atom-api 1018); `validateComponentAttachmentBySlots` strictness
  (composables 125); `Route.componentOf` standalone-render RouteContext
  (server-render 207/276).

Making `typecheck:tests` a required green gate remains coupled to the
physical-deletion pass plus a focused batch of the deep-drift helper fixes.

### Finding-3 Correction: Attach Forms Are a Tier, Not Redundant (2026-07-07)

Set out to do the Finding-3/P6 physical deletion of the "deprecated" attach
forms (`Style.attach`, `Style.attachByView`, `Behavior.attach`). Checking
capability coverage before deleting revealed the deletion premise was wrong:

- `Behavior.attach(behavior, { select, merge? })` — `select` picks the
  behavior's elements from ANY bindings, including derived/computed values
  (`items: () => bindings.filtered()`), not just named slots. The combobox /
  search / nav / selection tests rely on this. The contract-keyed forms
  (`attachToSlots`/`attachBySlotContract`/`attachBySlots`) cannot express it.
- `Style.attach` targets a component's setup `bindings.slots` directly, for
  components that do NOT publish a `View.Slots` contract. `attachToSlots`
  requires a contract; `attachBySlots` requires a string slot map.

So the forms are a legitimate **2-tier model** — general low-level
(`attach`/`attachByView`/`Behavior.attach`) + typed sugar
(`attach*Slots*`) — not redundancy. The original "too many ways to do one
thing" critique conflated general-purpose with redundant.

Action: **un-deprecated** all three (JSDoc reframed from "deprecated, will be
removed" to "low-level/general, intentionally retained"); updated `docs/API.md`
to the 2-tier framing. No deletion. Finding-3 is resolved by clarifying the
tiers rather than removing the general forms. Gates green (typecheck + style/
composables tests).
