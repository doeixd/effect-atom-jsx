# Current Status In Redesign Plan

Last updated: 2026-03-10
Plan reference: `docs/DESIGN_OVERHAUL_V1_PLAN.md`, `docs/V1_API_CONTRACT_DRAFT.md`, `docs/EFFECT_NATIVE_ENHANCEMENT_PLAN.md`, `docs/new_ideas.md`

## Overall

- Redesign is actively in progress.
- We are taking a breaking-change-first approach to reduce API overlap and legacy aliases.
- Core direction is now visible in code (not only docs): smaller top-level exports, stronger action/query primitives, and clearer internal boundaries.

## Completed So Far

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
- Component setup helpers landed (`Component.state`, `Component.derived`, `Component.query`, `Component.action`, `Component.ref`, `Component.fromDequeue`, `Component.schedule`, `Component.scheduleEffect`).
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

## Recently Completed Commits (most recent first)

- `063cad2` refactor: remove sync batching mode and make microtask-only
- `b4f0bf4` refactor: move reactive core exports to internals subpath
- `dd41a61` refactor: remove signal/computed OO facade
- `9d82b43` refactor: remove sync scoped wrapper APIs
- `aa48c37` refactor: remove Atom.fn and runtime.fn mutation wrappers
- `294a75b` refactor: remove remaining service and mount aliases
- `ba20529` refactor: remove legacy top-level query/mutation exports
- `ac003d9` refactor: remove strict query and mutation API variants
- `ac843e5` feat: default to microtask batching with flush escape hatch

## TODO Backlog (Redesign)

- [x] Final export-tier cleanup: verify top-level stays app-first and move any remaining advanced overlap behind `advanced`/subpaths.
- [x] Deep-import guidance sweep: ensure docs consistently show `effect-atom-jsx/Registry` for manual registry usage.
- [x] Historical-doc hygiene pass: label remaining pre-redesign analysis blocks as historical where they can be mistaken for current API guidance.
- [x] Action-first docs polish: keep linear `Atom.runtime(...).action(...)` as primary mutation narrative across all guides.
- [x] Finish API examples pass: ensure callable `Atom`/`AtomRef` style is used consistently in docs/snippets.
- [x] Family lifecycle follow-up: add at least one end-to-end example showing `Atom.family(...).evict/clear` in component lifetime cleanup.
- [ ] Continue typesafety/composability track from `docs/new_ideas.md` (breaking changes allowed when they improve coherence).
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

- Component Phase hardening pass: deepen action concurrency/detach semantics and tighten requirement/error narrowing inference in type tests.
- Composables phase continuation: tighten slot/capability compile-time guarantees and add richer collection-slot lifecycle semantics.
- Component docs pass: align README/API with shipped `Component` + `Behavior` + `Element` signatures and examples.
- Release readiness pass: keep changelog/status aligned and require full typecheck/test/build green before release cut.

## Update Rule For This File

Whenever redesign work lands:

1. Add/remove items in **Completed So Far**.
1b. Keep TODOs in **TODO Backlog** updated.
2. Add the new commit hash in **Recently Completed Commits**.
3. Refresh **In Progress / Next** to reflect the next actionable step.
4. Update the `Last updated` date.
