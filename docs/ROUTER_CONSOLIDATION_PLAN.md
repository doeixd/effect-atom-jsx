# Router & Data Layer Consolidation Plan

Date: 2026-07-29
Status: proposed — findings from a full audit of `Route.ts`,
`RouterRuntime.ts`, `router-runtime.ts`, `single-flight-runtime.ts`,
`SingleFlightTransport.ts`, and `ServerRoute.ts`
Relationship to the roadmap: this is Milestone 9's consolidation spirit
applied to the data layer, and it is a **prerequisite for Milestone 11**
(streaming SSR + parallel loaders must not build on a global-registry,
double-matcher foundation). Workstreams are sequenced; line references are to
the tree as of this writing and will drift — symbol names are the stable
pointers.

## What must be preserved (the layer's real strengths)

- Reactivity-driven revalidation: loaders auto-capture read keys
  (`executeAndCache` / `captureReactivityReads`), mutations capture emitted
  invalidations, single-flight revalidates the intersection. This is the
  strongest idea in the data layer and shares one key vocabulary with M8
  expressions.
- Single-flight as a concept (mutation + targeted revalidation in one round
  trip, `setLoaders` seeding escape hatch, transport behind
  `SingleFlightTransportService`).
- `RouterRuntime`'s task supersession (monotonic task ids, real
  `Fiber.interrupt`, late-loser commit guard) and its tests.
- `ServerRoute`'s pure-data design and static `validate`.
- The unified loader `Result` model and the SSR wire-format pinning test.

## Findings inventory (evidence)

### F1 — Correctness bug: nested tier-2 routes have two path identities

`materializeNode` (Route.ts) wraps the child with `ComponentRuntime.route`
using the node's **local** path, while tree matching/loader identity uses the
**joined** path (`routePathOfTarget`). A `Route.page("settings", …)` mounted
under `/users/:userId` has loader identity `/users/:userId/settings` but
render identity `/settings`. `RouterRuntime.nodePath` compounds this with a
vestigial ternary whose branches are identical (`fullPathOf(node, node)` on
both sides). The documented golden path in `docs/router.md` is exactly the
nested shape that hits this. Related: `extractParams` treats optional
segments (`:name?`) literally while `validateTree` strips the `?` — a live
inconsistency; and route ranking is by string length, not specificity, so
`/users/:id` vs `/users/new` ordering is accidental.

### F2 — Process-global mutable state is load-bearing (9 slots)

- `routeRegistry`, `routeRegistryById`, `routeIdSeq` (Route.ts) — populated
  as a **side effect of constructing a route** (`makeUnifiedRoute`,
  `Component.route`, and even `copyRouteDecorations` on every wrap), never
  cleared, keyed partly by auto-generated `route-N` ids, and the sole input
  to the registry variants of the loader runners. Tests cannot reset it and
  uniquify URL patterns per test as a workaround.
- `routeHeadEntries` + `routeHeadSeq` — shared by client head updates and
  SSR; `renderRequest` calls `routeHeadEntries.clear()`, so an SSR render
  nukes client head state and concurrent SSR renders race.
- `cache` / `reactivityToCache` / `reactivitySubscriptions`
  (router-runtime.ts) — unbounded (invalidation marks stale but never
  evicts; only `cacheTime` bounds memory).
- `installedTransport` (single-flight-runtime.ts) and the implicit browser
  globals `window.__LOADER_DATA__` / `window.__HYDRATE_ROUTE__` (the latter
  is emitted into HTML and **defined nowhere in src/**).

### F3 — Three authoring tiers; tier 3 partially inert; everything ×2–3

Component-decorated routes (`Component.route`), node builders
(`Route.page/layout/index/...`), and unified routes (`Route.path`, ADR-006 —
still marked *Proposed* while shipped). Consequences:

- Nearly every helper (`loader`, `title`, `meta`, `guard`, `id`,
  `paramsSchema`, …) is a three-way runtime dispatcher.
- `runMatchedLoaders`, `runStreamingNavigation`, `prefetch`,
  `collectSitemapEntries` each have two ~70-line near-identical bodies
  (registry vs tree), with the code commenting the registry path as
  "legacy" in one place and "by design" in another.
- **Silently inert tier-3 features**: unified routes store `guards`,
  `transition`, and `loaderErrorCases` that nothing ever reads (only the
  component-decorated `__route*` fields are consumed). The tagged-loader-
  error test asserts the callback was *stored* and invokes it by hand — it
  exercises no runtime path.
- The `__route*` field list is declared in both `Route.ts` and
  `Component.ts` and has drifted; `copyRouteDecorations` copies only six
  fields, silently dropping `__routeTransition` and `__routeSitemapParams`
  through any wrapper.

### F4 — Two navigation stacks that never meet

`RouterService`/`RouterTag` (drives `Route.Link`, `queryAtom`, `reload`,
`prefetch`) vs `HistoryAdapter`/`NavigationService` (drives everything in
`RouterRuntime`: pending states, supersession, fetchers). A `Link` click
updates the RouterService atom and never notifies the runtime — no pending
state, no supersession, no revalidation. `Route.Link` reads
`window.location.pathname` directly for active state (wrong under Hash,
Memory, and SSR layers) and falls back to raw `pushState` + synthetic
`PopStateEvent` when no runtime is present. `queryAtom`'s setter runs
`Effect.runSync(navigate)` inside a signal write.

### F5 — Advertised-but-unimplemented / fail-open surface

- `restoreScrollPosition` / `preventScrollReset` in the public snapshot
  type; only ever `null`/`false`. No scroll code exists.
- View transitions: absent; `Route.transition` inert (F3).
- `LoaderOptions.revalidateOnFocus` / `revalidateOnReconnect` / `timeout`:
  declared, never read.
- `revalidate: "matched"`: accepted by the type, not handled — and the
  `"reactivity"` mode re-runs the full matched loader set when the
  invalidation set is empty (a duplicate full pass on the common path).
- `hydrateSingleFlightPayload`: silent `continue` on unknown routeId (a
  typo hydrates nothing, diagnoses nothing) and a magic
  `staleTime ?? 30_000` that differs from the 0 default everywhere else.
- Single-flight request/response are `await response.json() as ...` with a
  shape sniff — **not** round-tripped through `Serialization`, so
  single-flight loaders and SSR loaders use different encodings for the
  same values.
- Error values are largely untagged object literals
  (`SingleFlightTransportError`, `SingleFlightInvokeError`,
  `ResultDefectError`, `RouteParseError`) detected by hand-rolled
  duck-typing; the whole `ServerRoute.execute`/`dispatch` error channel is
  `unknown`; several paths `throw exit`, converting typed failures into
  defects. `Schema.decodeUnknownSync` turns malformed request bodies into
  defects rather than typed failures.
- Two path-matching engines with different semantics (`Route.matchPattern`
  — no splats; `ServerRoute.matchPath` — splats supported).
- Cast density: ~143 assertions in `Route.ts`, with comments admitting the
  enhancer type encoding hits TS instantiation limits. (`ServerRoute`,
  `RouterRuntime`, `router-runtime` are clean.)
- Dual export surfaces disagree: `export * as Route` **and** an inner
  `export const Route = {...}` (so `Route.Route.path` type-checks) with
  different member sets; same for `Router` and `ServerRoute`.

### F6 — Dead/vestigial code (delete list)

`toUnifiedLoaderResult` (identity), `Route.ref` (identity),
`loaderFetchResult` (deprecated beyond its stated shelf life),
`Route.Switch` (unrelated first-truthy-child picker), unused imports of
`clearLoaderCache`/`getLoaderCacheEntry` in Route.ts, `nodePath` identical
ternary, orphaned/duplicated JSDoc blocks, `renderRequestWithRuntime` /
`dispatchWithRuntime` test-only delegations.

### F7 — No resumability integration

`Resume.ts` and `Route.ts` do not reference each other. Loader data hydrates
via `window.__LOADER_DATA__`, a channel parallel to the resume manifest.
Milestone 11 item 4 is where these meet; this plan clears the ground for it.

## Workstreams (sequenced)

### R1 — Correctness and dead-surface triage (small, immediate)

1. Fix the nested-path identity bug: materialization must bind components to
   the **joined** path; add the missing nested-route rendering test that
   would have caught it. Fix `nodePath`'s vestigial ternary as part of it.
2. Reconcile optional-segment handling between `extractParams` and
   `validateTree`; add specificity-based (not length-based) match ranking,
   or document and test length ranking as intended.
3. Delete F6 outright. For every F5 declared-but-dead option: implement it
   or remove it from the type this release — the type surface must stop
   overstating. (`revalidateOnFocus`/`revalidateOnReconnect` are real
   features worth implementing against the reactivity runtime;
   `timeout` should wrap the loader Effect; scroll/view-transitions either
   get a milestone or leave the snapshot type.)
4. Handle `revalidate: "matched"` and remove the duplicate full loader pass
   on the empty-invalidation path.
5. Emit a diagnostic (not a silent `continue`) from
   `hydrateSingleFlightPayload` on unknown route ids; make the hydrated
   `staleTime` default explicit and documented.

Acceptance: nested tier-2 fixture renders and loads under the same routeId;
no public option is a no-op; `typecheck:all`/tests/browser gates green.

### R2 — De-globalize (prerequisite for M11)

1. Routes stop self-registering. The route tree (or an explicitly
   constructed registry value) becomes the only source of truth, passed
   where needed. Delete `routeRegistry`/`routeRegistryById`/`routeIdSeq`
   and the registry variants of `runMatchedLoaders`/`runStreamingNavigation`
   /`prefetch`/`collectSitemapEntries` — the tree bodies remain, halving
   that code.
2. Head state becomes per-request/per-root (fiber-local on the server, the
   same mechanism as M11's fiber-local resume sessions; owner-scoped on the
   client). No cross-render `clear()`.
3. Loader cache becomes an injectable service (default layer preserves
   today's module-level behavior for the client; server gets per-request
   instances). Give the supervision gap a fix on the way: SWR refreshes run
   forked but tracked, so they participate in supersession/interruption.
4. Replace `window.__LOADER_DATA__`/`__HYDRATE_ROUTE__` with a defined,
   versioned handoff (and actually define the hydrate hook or stop emitting
   it).

Acceptance: two concurrent server renders share no route/head/cache state
(test); constructing a route has no side effects; loader-cache tests stop
uniquifying patterns as a reset workaround.

### R3 — One authoring tier (execute or reject ADR-006)

Recommendation: **finish tier 3** — the unified `Route` value becomes
canonical; `Component.route` and the node builders become thin sugar that
construct unified routes; the three-way dispatchers collapse; the `__route*`
property-stamping becomes an internal projection with a single field list
defined once. Wire the inert features (`guards`, `transition`,
`loaderErrorCases`) into the actual render/navigation paths with real
runtime tests, or delete them from tier 3. Update ADR-006 from Proposed to
Accepted (or Rejected) — someone must own the decision.

**Ratified 2026-07-30 — split the three inert features (closes `DQ-030`).**
Triage confirmed all three are **write-only in the source**: `guards`
(`Route.ts:114`/`:1128`/`:470`/`:2772`), `transition` (`:113`/`:469`/`:2855`),
and `loaderErrorCases` (`:110`/`:2295`/`:466`) are declared, copied and appended
but have **no read site anywhere in `src/`**. Decision:

- **`guard` — wire it.** `Route.guard(requireSession)(AdminRoute)` currently
  type-checks, composes, returns a route, and **gates nothing, with no
  diagnostic**. That is an auth bypass shipped as a working API, and it is the
  only item in this workstream where doing nothing is *actively unsafe* rather
  than merely incomplete. Guards run in the navigation path before loaders and
  can fail the navigation.
- **`loaderErrorCases` — wire it.** Consulted at render when the loader `Result`
  is a failure. It has no equivalent elsewhere, so deleting it removes a
  capability rather than redirecting authors.
- **`transition` — delete it now.** It is the only one of the three that needs a
  view-transition model we do not have, and open decision 3 already defers view
  transitions past R4. Deleting it is not a loss; keeping it is a silent no-op
  behind a plausible name.

**Sequencing rule (the safety-critical part): no inert authorization API
ships.** `guard` must be wired **in the same change-set** that keeps it, or be
removed. It must never exist in a released build in its current form. Because
guards have to run inside the runtime's supersession-ordered navigation, wiring
them properly is gated on `DQ-031` — so if R4 slips, `Route.guard` is deleted and
authors use `Component.guard`, which actually runs. A compile error is an
acceptable outcome; a quiet one is not.

Acceptance: one implementation per helper; unified-route guards demonstrably
block navigation in a test **and a failing guard prevents the loader from
running at all**; `loaderErrorCases` renders in a real render test rather than
being invoked by hand; `transition` is absent from the type; wrapper preservation
covers the full field list via one shared definition.

### R4 — One navigation stack

Merge or bridge `RouterService` and `RouterRuntime`: `Link`, `queryAtom`,
`reload`, and `prefetch` must drive the runtime's supersession path and
read the runtime's URL state (never `window.location` directly).
Recommendation: `RouterService` becomes the public facade *implemented by*
`RouterRuntime`, with the existing layers (Browser/Hash/Server/Memory)
providing the history adapter underneath. Remove the synthetic
`PopStateEvent` fallback. `queryAtom` navigation stops using
`Effect.runSync` inside a signal write.

**Ratified 2026-07-30 — the facade shape and the signal-write contract
(closes `DQ-031`).** Two independent decisions:

**(a) `RouterService` becomes a narrow read/command interface** that
`RouterRuntime` implements *and* the standalone Browser/Hash/Memory/Server
layers also implement (without loaders). Today `RouterRuntime.toLayer`
(`RouterRuntime.ts:1035`) provides `RouterRuntimeTag`/`HistoryTag`/`NavigationTag`
and **no `Route.RouterTag`**, so no runtime-backed `RouterService` can be
obtained at all — the facade is not merely unmerged, it is disconnected.

Chosen over "`toLayer` also provides `RouterTag`" because a narrow interface both
implementations honour is the only shape that makes *one navigation stack* true
**as a type** rather than as a convention, and it keeps `Link` unit-testable
without constructing a runtime. Chosen over a hard merge (delete `RouterService`,
runtime everywhere) because that breaks every call site and forces a loader-bearing
runtime into component tests.

The constraint this imposes: the interface must stay narrow enough that a
loader-less layer can honour it, so it **cannot expose pending state or
supersession**. If R4 finds that `Link` genuinely needs pending state on the
interface, fall back to projecting `RouterTag` from the runtime and keeping the
standalone layers for tests — but take that fallback deliberately, not by
widening the interface until it only the runtime can satisfy.

**(b) A signal write navigates optimistically, then reconciles.**
`queryAtom`'s setter (`Route.ts:2239`) currently runs
`Effect.runSync(router.navigate(...))` inside an `Atom.writable` setter — a
synchronous, `void`-returning write driving an asynchronous navigation. Decision:
the atom updates **immediately** from the encoded value, the navigation is
**forked**, and a failed navigation **rolls the atom back** and surfaces on the
runtime's navigation error channel — never swallowed.

Chosen over fire-and-forget (no error story at all) and over returning a
read-only atom with an `Effect` setter (which breaks `page.set(7)`, the entire
point of the API). Accepted cost: a visible window where the atom and the URL
disagree, which is the same tradeoff every optimistic update makes and which the
rollback rule bounds.

Both decisions require the same `Route.Link` fix: active state must read the
service's URL rather than `window.location.pathname` (`Route.ts:2177`), which is
simply wrong under Hash, Memory, and Server layers.

Acceptance: a `Link` click produces pending state, supersession, and
revalidation in a test; `Link` active state is correct under Memory and
Hash layers; a superseded navigation's loader result is discarded rather than
applied; `page.set(7)` against a slow router updates the atom immediately, and a
failing navigation rolls it back with the error observable.

### R5 — Wire and error hygiene

1. Single-flight request/response validated through the `Serialization`
   service with declared schemas — one encoding for loader `Result`s across
   SSR and single-flight (this also positions the payload for M10's
   serializer-identity gate).
2. Replace untagged error literals with `Schema.TaggedErrorClass` (matching
   the resumability layer's discipline); type the `ServerRoute`
   execute/dispatch error channel; decode request bodies with
   `decodeUnknownEffect` so malformed input is a typed failure, not a
   defect; stop `throw exit`.
3. Unify the four transport-resolution ladders (layer tag / installed
   global / endpoint fetch / local) into one documented resolution order
   used by both `Atom.action` forms; remove the call-time
   `await import("./Route.js")` cycle dodge.
4. One path-matching engine shared by `Route` and `ServerRoute` (adopt the
   `ServerRoute` matcher's splat support; add the missing features —
   optional segments done properly — once, with property tests).
5. Resolve the dual `Route`/`Router`/`ServerRoute` export surfaces to a
   single namespace each.

### R6 — Then Milestone 11

With R1–R5 landed, M11's parallel fetch-and-render composes with a
side-effect-free tree, an injectable cache, one navigation stack, and a
schema-validated data wire — and the loader-data channel can merge into the
streaming resume manifest rather than surviving as a parallel window-global
system (closing F7).

### Ratified 2026-07-30 — remaining router design questions (`DQ-032`–`DQ-038`)

With R3/R4 settled above, these close the lane. Each is recorded with the option
rejected, so none of them comes back.

**`DQ-032` — a background SWR refresh has two owners, by role.** The
**cache-store scope bounds the write**; the **navigation scope may interrupt**.
Staged: take the cache-store half **first** — the server-side write-after-response
leak is a live safety issue, and after R2 the loader cache is already an
injectable value with a scope, so it is a small independent change. Add the
navigation-scope interrupt only once `DQ-031` has decided what a navigation scope
*is*. Committing to navigation-scope-only would mean inventing a fake navigation
scope for SSR, which is the wrong shape. Independently: **at most one in-flight
refresh per cache key** — a second request joins the running one rather than
starting a second, which removes a last-write-wins race and matches how
`Refreshing` already reads as a single state.

**`DQ-033` — one ladder, context-first, and the global is deleted.** Resolution
order is **context transport → explicit `endpoint` → local runner**. Context-first
is right because the injected transport is the *request-scoped* value while the
endpoint is a static authoring hint — **letting a static hint outrank request
scope is exactly how the cross-request bleed happened.** `Atom.action`'s free form
resolves `SingleFlightTransportTag` via `Effect.serviceOption` just as the
runtime-bound form already does; the asymmetry is history, not design. Delete
`installSingleFlightTransport` / `getInstalledSingleFlightTransport` and
`src/single-flight-runtime.ts` with them, then write the order into
`docs/router.md` — which is what R5.3 asked for and never got.

**`DQ-034` — loader data folds into the resume manifest (one transport).** Two
streamed channels into the same document during the same phase is coupling that
only gets more expensive, and R2 already proved the hard part (one `Serialization`
wire projection for loader `Result`s). **The cross-reference is bidirectional and
binding:** if M11.5's manifest lands without incremental per-entry delivery, this
is not implementable and reverts to keeping the loader channel as a fallback. The
router-side requirements — notably `(routeId, params)` identity and incremental
per-entry delivery — are constraints on M11.5's manifest design, not router
implementation details.

**`DQ-035` — a stale parent feeds its dependent child, and the child says so.**
The invariant, statable in one sentence: *a dependent loader is never fresher
than its parent, and its `Result` says so.* `Result.all` already encodes exactly
this composition rule, so this is consistency rather than invention. Rejected:
failing the child with `ParentUnavailable`, which discards data that is in hand —
the precise thing the `Stale` variant exists to avoid. (The current behaviour,
where the child silently never runs, is a defect either way.)

**`DQ-036` — a loader timeout is a schema-tagged
`RouteLoaderTimeoutError({ routeId, timeoutMs })`.** R5.2's whole point is that
this lane's errors are tagged, attributable and matchable, and a timeout is the
single most likely loader failure an author wants distinct UI for. The `routeId`
is the part that earns its keep.

**`DQ-037` — do not fix the materialization cache rule; let R3 delete it.**
`node.state.materialized` is mutable state on a route node, and ADR-006's thesis
is that a route is an immutable value whose full pattern resolves during
traversal. Fixing a rule we are about to remove is wasted motion. If R3 is
rejected, fall back to making tree context **mandatory** with a real diagnostic —
not to keeping today's rule, which has now been deferred twice.

**`DQ-038` — `Route.link` gets segment-model substitution as an explicit R5.4
deliverable**, not a fourth carried-forward note. If R5.4 slips, **reject
optional segments in `link` with a clear error** rather than patching
substitution locally: a clear error beats a malformed URL, and the patch would
add a third pattern parser to a codebase whose stated goal is one.

## Test additions this plan requires

Nested-route render/loader identity; unified-route guard execution;
`revalidate: "matched"`; `Route.Link` under Memory/Hash layers and through
the runtime; concurrent-SSR isolation for head/registry/cache; single-flight
wire-format compatibility (mirroring the SSR pinning test); malformed
server-route input as typed failure; property tests for the unified matcher.

## Open decisions

1. ADR-006: accept (recommended) or reject — but decide.
2. `RouterService`-as-facade vs. hard merge of the two stacks (R4
   recommends facade to preserve the layer-based testing story).
3. Whether scroll restoration and view transitions get implemented in R1 or
   get their own small milestone after R4 (they need the single navigation
   stack to be implementable correctly — recommendation: after R4).
4. Loader-cache eviction policy once it is a service (size-bounded LRU vs.
   today's time-only bounds).

## R1 Handoff notes (2026-07-29)

R1 is implemented. Gates: `typecheck:all` 0 errors, full suite 736 green,
build green. R2 was not started (out of scope per the brief).

### Task 1 — dead code (with one deviation)

- Deleted `toUnifiedLoaderResult` (identity) and its only call site
  indirection in `Component.ts` (`applyHead` now uses the value directly).
- Deleted `loaderFetchResult` (deprecated; zero call sites in src/examples/
  tests) and the now-unused `FetchResult` import in `Route.ts`.
- Removed the unused `clearLoaderCache`/`getLoaderCacheEntry` imports in
  `Route.ts`.
- **Deviation (user-directed): `Route.ref` and `Route.Switch` were kept.**
  They are not dead: `Route.ref` is used in `examples/router-golden-path`,
  `src/type-tests/route-node-pipes.ts`, and `route.test.ts`; `Route.Switch`
  is used in five examples. Both remain exported. `docs/API.md` and
  `docs/router.md` references to them remain accurate.
- ~~Not done (in the F6 list but not in the R1 brief):
  `renderRequestWithRuntime`/`dispatchWithRuntime` test-only delegations and
  orphaned JSDoc duplicates remain.~~ **Done in the R1 finish pass
  (2026-07-29)**: both delegations deleted (test calls runtime methods
  directly), duplicate JSDoc blocks merged, orphaned doc comments above
  `resolveSingleFlightRouteId`/`validateLinks` removed. `Route.ref` and
  `Route.Switch` are kept permanently (user decision; both are used).
  The Task-3 deferred cache hole is also closed: materialization caches the
  path it was produced under; tree context is authoritative and standalone
  calls (`componentOf`/`link`, parent `""`) defer to any existing cache, so
  standalone-before-`define` is replaced by the joined identity and never
  replaces it back (regression test added). F6 is fully resolved.

### Task 2 — hydrate diagnostics + explicit staleTime

- `hydrateSingleFlightPayload` gains a trailing
  `options?: HydrateSingleFlightOptions` parameter (new exported interface)
  with `onMissingRoute?: (routeId: string) => void`, called for each payload
  entry that matches no route. Existing call sites compile unchanged.
- The `30_000` magic constant is now the module constant
  `defaultHydratedLoaderStaleTimeMs` (not exported) with a doc comment.
- Test added: unknown routeId invokes `onMissingRoute` and hydrates nothing
  under that id while known entries still hydrate.

### Task 3 — nested-route path identity bug (the important one)

- `materializeNode` now takes `parentFullPath` (default `""`) and wraps the
  component with `ComponentRuntime.route(joinRoutePath(parentFullPath,
  node.path, node.kind), ...)`; `materializeTree` threads the joined path
  down the recursion. **`joinRoutePath` was used instead of the brief's
  suggested `resolvePattern`**: `routePathOfTarget` joins via
  `joinRoutePath`, and `resolvePattern` is not byte-identical for
  empty-path layout/index nodes (it appends a trailing slash). Using the
  same function keeps render identity and tree/loader identity byte-identical
  by construction.
- `RouterRuntime.nodePath` now computes `Route.fullPathOf(root, node)` from
  the tree root (threaded via `createSnapshot`'s new `appRoot` state field;
  `nodeId`/`matchedAppNodes` take root too). The identical-branch ternary is
  gone; a new union overload on `Route.fullPathOf` (root/target may each be
  `AppRouteNode | AnyRoute`) made that possible without casts. The
  implementation already accepted the union.
- Tests added: route-node materialization binds the joined path and matches
  `/users/1/settings` but not `/settings` (`route.test.ts`); RouterRuntime
  snapshot `appMatches` for a nested tree uses joined paths
  (`router-runtime.test.ts`). No existing test had pinned the buggy
  local-path identity; full suite stayed green.
- Known remaining limitation (deferred): `componentOf`/`link`/`collect`
  materialize standalone nodes with `""` parent when the tree was never
  passed through `Route.define`, and `node.state.materialized` caching is
  first-wins, so a standalone `componentOf` before `define` caches the
  local-path wrap. Question for R2/R3: should materialization always require
  tree context?

### Task 4 — optional segments: implemented (not fenced)

- `extractParams`/`matchPattern` treat a trailing `:name?` as optional
  (matches presence or absence; absence only when final) and strip the `?`
  from param keys; non-final `:name?` must match a present segment. Shared
  helpers `isOptionalParamPart`/`paramNameOf`; `validateTree` (node branch)
  and `paramNamesOf` now use the same normalization, so type-level
  `ExtractParams`, `paramNamesOf`, `validateTree`, and the runtime matcher
  agree.
- Tests added for match/extract semantics and duplicate-param detection of
  `:id` vs `:id?` in both unified-route and route-node trees.
- Deferred: `Route.link` URL building does not understand `:name?` (the
  `:${k}` replacement would leave a stray `?` or fail to substitute). Worth
  handling when R5 unifies the matcher.

### Task 5 — revalidate semantics (BEHAVIOR CHANGE)

- `revalidate: "matched"` is now explicitly handled: the full matched loader
  set is returned.
- **`revalidate: "reactivity"` with zero captured invalidations now returns
  an EMPTY loader list** instead of discarding the first pass and re-running
  the full matched set. Loaders execute exactly once (the single matched
  pass; the empty-key filter matches all loaders, so the run still warms the
  cache) instead of twice.
- Tests updated (all pinned the old rerun behavior with invalidation-free
  mutations; each now passes `revalidate: "matched"` to preserve its
  loader-data-in-payload intent): "builds single-flight payload with mutation
  plus revalidated loaders", "hydrates loader cache from a single-flight
  payload", "creates server single-flight handler bound to request url",
  "exposes mutation-style single-flight handle with pending/result
  ergonomics".
- Tests added: `"matched"` returns all matched loader results;
  `"reactivity"` with no invalidations returns zero entries and runs the
  loader exactly once.

### Task 6 — LoaderOptions: timeout implemented, two options removed

- `timeout` is implemented in `executeAndCache` (`router-runtime.ts`):
  `durationToMillis(options?.timeout, 0) > 0` wraps the loader with
  `Effect.timeout`, so a slow loader becomes the existing `Result.failure`
  path with a `Cause.TimeoutError` (`_tag: "TimeoutError"`). **Substitution:**
  the brief's `Effect.timeoutFail` does not exist in the installed Effect v4
  beta; `Effect.timeout` is the equivalent typed-failure API. Covers all
  loader paths via `runCachedLoader`. Test added: `Effect.never` loader with
  `timeout: 20` fails with `TimeoutError`.
- `revalidateOnFocus`/`revalidateOnReconnect` removed from `LoaderOptions`
  (read nowhere). `docs/afui.md` stopped advertising them (and now lists
  `timeout`); `docs/router.md` never mentioned them. Archive/ADR docs left
  as history. They can return via the reactivity runtime later (recorded in
  F5).

### Deferred questions for R2+

- Standalone vs tree-context materialization ordering (Task 3 above).
- `Route.link` and `:name?` segments (Task 4 above).
- Should the timeout error surface as a schema-tagged error type instead of
  `Cause.TimeoutError`? (Fits R5 error hygiene.)

## R2 Handoff notes (2026-07-30)

R2 is implemented. Gates: `typecheck:all` 0 errors (3 pre-existing R5-scope
`unknownInEffectCatch` warnings remain), full suite 889 green, build green.

### Task 1 — the route tree/registry is the only source of truth

- Deleted `routeRegistry`, `routeRegistryById`, `routeIdSeq`, `makeRouteId`,
  `createRouteId`, `registerRoute`, `findRegisteredRoute`,
  `getRegisteredRouteById`. `makeUnifiedRoute` and `copyRouteDecorations` no
  longer register anything, so **constructing or wrapping a route is
  side-effect free**.
- New explicit sources: `Route.RouteSource = AnyAppRouteNode | AnyRoute |
  RouteRegistry`, built with `Route.registry([...components])`
  (`Route.isRouteRegistry`, `Route.RouteRegistrySymbol`). `Route.collectAll` now
  takes a source. `Route.RegisteredRoute` is exported.
- `Route.RouteSourceTag` + `Route.routeSourceLayer(source)` carry the app's
  routes to layer-driven paths. `Route.resolveRouteSource(explicit?)` resolves
  explicit → injected → `undefined` (no global fallback).
  `RouterService.preload` uses it and is a **no-op without it** rather than
  silently consulting a global.
- **The registry-vs-tree duplication is gone**, replaced by one normalized
  `RouteEntry` projection (`routeEntriesOf(source)`). `runMatchedLoaders`,
  `runStreamingNavigation`, `prefetch`, `collectSitemapEntries`, head
  resolution, and single-flight hydration now each have exactly one body.
  Parent resolution is the one place the two sources still differ, isolated
  behind `RouteEntry.parentPattern(candidates)` (tree answers from the tree;
  registry keeps longest-prefix derivation).
- **BREAKING (intentional):** the sourceless overloads are deleted —
  `runMatchedLoaders(url)`, `runStreamingNavigation(url)`,
  `prefetch(to, params)`, `collectSitemapEntries(baseUrl)`,
  `hydrateSingleFlightPayload(payload)`. All take a source first.
- **BREAKING (intentional):** no generated `route-N` ids. A route's identity is
  its resolved pattern unless `Route.id(...)` assigns a stable one — a
  module-eval counter cannot be trusted to agree between server and client.
  `Atom.action(..., { singleFlight: { app } })` and
  `Route.invokeSingleFlight(..., { app })` accept a source for hydration.
- R1's path-keyed materialize cache with the tree-context-authoritative rule is
  unchanged, and its regression test still passes.

### Task 2 — head state per request / per owner

- `Route.RouteHeadStore` (`entries`, `applyToDocument`, `seq`) +
  `Route.makeRouteHeadStore`, `Route.RouteHeadTag`,
  `Route.clientRouteHeadStore`, `Route.currentRouteHeadStore`,
  `Route.runInRouteHeadStore`, `Route.resolveRouteHeadOf`.
  `setRouteHead` / `removeRouteHead` / `createRouteHeadId` take the store.
- `renderRequest` makes one store per request, provides it as `RouteHeadTag`
  **and** installs it ambiently for the synchronous render. `Component.route`
  resolves the store once in setup and closes over it, which scopes every later
  head write (including atom-subscription callbacks) to that owner.
  `routeHeadEntries.clear()` is gone.
- Note on mechanism: Effect v4 in this repo exposes no `FiberRef`; Effect
  *context* is the fiber-local mechanism, and `Effect.runSync` inside
  `renderToString` starts a fresh fiber, so the ambient dynamic scope
  (the same pattern `resume-session.ts` uses) covers the synchronous render
  while the service covers Effect-based access.

### Task 3 — loader cache as a service

- `router-runtime.ts` gained `LoaderCacheStore`, `makeLoaderCacheStore`,
  `defaultLoaderCacheStore`, `LoaderCacheTag`, `loaderCacheLayer(store?)`,
  `runInLoaderCacheStore`, `resolveLoaderCacheStore`,
  `currentLoaderCacheStore`. Every exported cache function takes an optional
  trailing store; `runCachedLoader` resolves it from context, so all loader
  signatures keep `R = never`.
- Default = the process-wide store (today's client behavior). `renderRequest`
  creates one store per request, so **SSR no longer warms or reads the client
  cache**. Reactivity invalidation reaches every live store through a
  `WeakRef` set, so per-request stores are not leaked.
- SWR supervision: the refresh is now an Effect-level fork
  (`Effect.forkDetach`) instead of `Effect.runFork`. It is **not** yet tracked
  for supersession: `Effect.forkChild` ties the refresh to the requesting
  loader fiber, which completes immediately with the stale value and therefore
  cancels every refresh (verified). Making SWR participate in supersession
  needs the navigation scope threaded down to loaders — **left for R3/R4**,
  once there is one navigation stack.

### Task 4 — versioned hydration handoff

- `window.__LOADER_DATA__` / `window.__HYDRATE_ROUTE__` are gone. The channel is
  now `window[Route.loaderHandoffGlobalKey]` (`__afuiLoaderHandoff`) holding
  `{ version, entries: [{ routeId, params, result }] }`, declared as
  `Route.LoaderHandoff` / `Route.LoaderHandoffEntry` over
  `Serialization.ResultWire` — so streamed loader data and the SSR payload use
  one encoding.
- `entries[].params` was added so the client caches under the same identity the
  server used; `runStreamingNavigation` fills it from the matched pattern.
- The hook is now defined: emitted scripts call
  `window[Route.loaderHandoffNotifyKey]`, and `Route.onLoaderHandoffEntry(cb)`
  installs it, replays entries that already arrived, and returns an
  unsubscribe. `Route.readLoaderHandoff` / `Route.hydrateLoaderHandoff(source)`
  decode through the injectable `Serialization` service, so a malformed or
  version-mismatched payload is a typed `SchemaError`.

### Tests

- New `src/__tests__/router-deglobalize.test.ts` (10 tests): side-effect-free
  construction; injected source resolution; **two concurrent server renders
  with isolated head + loader state**; per-request loader re-execution (a shared
  cache would collapse it to one load); server render not clobbering client head
  state; store-scoped loader cache; handoff emit/hydrate round trip; version
  mismatch as typed failure; unknown-route-id reporting; notify subscription.
- New `src/type-tests/route-source-r2.ts`: source-first signatures (with
  `@ts-expect-error` on the deleted `URL`-first and `baseUrl`-only forms), head
  store typing, `R = never` preservation for the cache resolution, and the
  handoff's `SerializationService` requirement.
- Updated tests that existed only to pin the deleted globals: the
  `findRegisteredRoute` registration test (now asserts an explicit registry),
  the `route-N` id assertion, the `__LOADER_DATA__` script assertion, the
  `preload` test (now provides `routeSourceLayer`), and the single-flight
  hydration tests (now pass `app`).

### Deferred / carried forward

- R1's two deferred questions stay deferred: standalone vs tree-context
  materialization ordering, and `Route.link` with `:name?`. Timeout error typing
  stays an R5 question.
- SWR fork supervision (above) → R3/R4.
- `installedTransport` (single-flight-runtime.ts) is still a module global; it is
  R5 item 3's transport-resolution unification, deliberately untouched.
- Loader-cache eviction policy (open decision 4) is unchanged: time-only bounds.
  The cache being a value now makes an LRU a local change.
