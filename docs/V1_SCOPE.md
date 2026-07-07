# V1 Scope

Status: **ratified 2026-07-06** (created from the design-review round-3 PR1
item in `CURRENT_STATUS_IN_REDESIGN_PLAN.md`; all DECIDE markers resolved
2026-07-06 under the "finish the plan" directive — each resolution is
recorded inline with its rationale).

Every other plan doc is additive. This one exists to say what v1 does **not**
include, so the release can converge. When triaging any backlog item, the
question is "is it in the Ships list?" — if not, it waits, no matter how good
it is.

Decisions marked `DECIDE:` need an explicit owner call before this doc is
authoritative.

## Ships in v1

Everything here is implemented today or is tracked release-blocking work.

### Atom core

- Callable atoms, `WritableAtom` sync methods, `Atom.map`/`derived`/`value`
- `A / E / R` type axes with extraction helpers
- `Atom.runtime(layer)` binding (atoms/actions/optimistic)
- `defineQuery` / `defineMutation`, `Atom.query` / `Atom.effect` /
  `Atom.action`
- Optimistic: `Atom.withOptimistic` + `withEffect`, `Atom.optimistic(...)
  .action(...)`, `Component.optimistic(...).action(...)`
- `Atom.family` (eviction, key equality, schema), `AtomSchema.struct`,
  `AtomRef`
- Scheduling/observability options (`retrySchedule`, `pollSchedule`,
  `observe`, `onTransition`)
- Unified `Result` as the only primary async model (release-blocking Finding
  5; `FetchResult` compat subpath only)

### Reactivity

- `Reactivity` service (`live`/`test`), `tracked` / `invalidating`,
  atom/loader/action key integration
- Reactivity key witnesses (P2) — small, closes the last magic-string
  surface; **in scope**

### AF-UI component model (web platform only)

- `Component.make` + plain setup Effect (builder available, not required),
  state ownership helpers (`state`/`query`/`action`/`optimistic`)
- Slot contracts: `View.Slot` / `View.Slots` / `View.fromSlots` /
  `Component.withSlots`, capability hierarchy, hidden slots, remaps
- Golden-path compression + cheap no-contract tier (Finding 1) —
  release-blocking for DX credibility
- Witness-aware JSX authoring (Finding 2) — **DECIDED 2026-07-06:** JSX is
  *already* the authored markup surface — `View.fromSlots(slots, <jsx/>)`
  accepts a JSX node directly (see the README Counter quick start). V1 ships
  that as the golden path and demotes `View.element(...)` builder chains to
  the typed-tree/generated layer. Typed-tree extraction *from* JSX (compiler
  integration) is v1.x. Finding 2 is satisfied for v1 by correcting the
  golden-path docs, not by a JSX transform.
- Style system: slot pieces, compose, variants, recipes, states, responsive,
  nest, vars, tokens/Theme, platform property diagnostics
- Behavior system: `forSlots`, event requirements, compose, behavior pack
  (disclosure/selection/search/nav/pagination/focusTrap/combobox)
- Attachment surface consolidated to three forms each (Finding 3) —
  release-blocking
- Inference audit: no explicit generics in authored code (Finding 4) —
  release-blocking
- Declared-vs-rendered diagnostics (explicit-only) + platform validation

### Routing / server (single canonical generation)

- Unified route model: `Route.path/paramsSchema/querySchema/hashSchema/
  loader/title/meta/children`, loader options (stale/cache/streaming/
  reactivity keys), typed extraction helpers
- Single flight: transport service + `Atom.action({ singleFlight })` client
  path + loader seeding helpers
- Hydration: `dehydrate` / `hydrate` with strict validation
- `ServerRoute` kinds + schema decoding + `dispatch` + document rendering
- Routing consolidation (P6): **DECIDED 2026-07-06** — survivors are the
  unified route model (route nodes, `Route.path/paramsSchema/loader/...`),
  `RouterRuntime`, and `ServerRoute`. The legacy service-first generation
  (`Component.route(...)` as the authored entry, direct `RouterService`
  golden-path usage) is deprecated in v1 docs; physical deletion happens in
  a dedicated consolidation pass (examples must migrate first) and remains
  release-blocking work.

### Services / layers

- One-composition-root doctrine documented (S1): one `AppLayer` feeds both
  `Atom.runtime(...)` and `Component.mount(...)`. **DECIDED + IMPLEMENTED
  2026-07-06:** `Component.mount` now also accepts
  `{ runtime: Atom.AtomRuntime }` (`MountWithRuntimeOptions`), reusing the
  runtime's `ManagedRuntime` so the two worlds are structurally one; the
  caller keeps runtime ownership (mount dispose does not dispose the shared
  runtime).
- `docs/SERVICES_AND_LAYERS.md` (S2): provision-tier decision table,
  memoization/sharing semantics, layer failure behavior — ships with v1
  docs.
- Server request-scoping rule + isolation test (S3) — ships; leaking
  request context is a correctness/security issue, not a docs nicety.

### Docs / release

- README + API docs + golden path aligned to shipped names only
- `docs/afui.md` as the narrative overview
- Honest "when not to use this" section in README/afui.md (F6) — cheap,
  builds trust, and claims the incremental-adoption/SSR ground competitors
  concede
- Historical docs moved to `docs/archive/` (PR2)
- Full typecheck/test/build green (existing gates)

## Pre-Release Readiness Findings (2026-07-07 scrutiny pass)

A skeptical readiness review surfaced concrete blockers beyond the redesign
findings. Status:

**Fixed:**
- **SSR script-injection XSS** (was a live stored-XSS in `serializeLoaderData`
  / `streamDeferredLoaderScripts` — unescaped JSON in `<script>`). Fixed +
  regression test.
- **No JSX types** — the library shipped zero JSX type infrastructure
  (`jsxImportSource: effect-atom-jsx` resolved to nothing). Added
  `src/jsx-runtime.ts` + `./jsx-runtime`/`./jsx-dev-runtime` exports.
- **`render` not top-level** — README quick start imported it top-level but it
  lived only in `/runtime`. Now re-exported (with SSR entry points).
- **No example typecheck gate** — added `typecheck:examples`.

**Release-blocking, still open:**
- **Effect *beta* dependency.** `effect ^4.0.0-beta.29` (dep + peer). A 1.0
  cannot be stable on a beta core. Gated on Effect 4 stable.
- **`typecheck:tests` not green** (9 left) and **`typecheck:examples` not
  green** (115 left, real per-example drift). Until both are required green
  gates, "tests pass" overstates correctness — the tests gate alone already
  found 6 real bugs.
- **Examples drifted badly** — 16 apps, 115 type errors, several still on
  deprecated patterns (Registry-first, `AsyncResult`, `mutationEffect`). Needs
  a per-app migration to *current* patterns **and** runtime verification, not
  mechanical import swaps.

**Should-fix (quality):**
- Two coexisting Result models (Finding-5 step 2); routing overload seam +
  "type instantiation excessively deep" warnings in `Route.ts`; cast density
  (`as any`/`as unknown as`); CHANGELOG/versioning for breaking changes.
- **Done 2026-07-07:** README consolidated to one file — kept the concise,
  current rewrite (former `README.new.md`) as `README.md`, folding in the
  essential setup section (babel + tsconfig) the old comprehensive README had;
  deep reference stays in `docs/` (API, testing, services, golden path). Two
  real README setup bugs fixed — the `render` import (now top-level) and the
  babel `moduleName` (was `effect-atom-jsx`, corrected to
  `effect-atom-jsx/runtime`, which would otherwise break the JSX transform).
  Dist import smoke-test passed (59 exports incl. `render`; `jsx-runtime`
  resolves).

Verdict: architecturally strong, **not release-ready** — solid beta. A stable
core dep, two green type gates (with the example migration), and a security-
minded review of the remaining SSR/`innerHTML` paths stand between it and 1.0.

## Deferred (explicitly not v1)

- **TUI / React Native renderers.** V1 ships platform *validation*
  (capability/event/property metadata, `validatePlatform`), not alternate
  renderers. The claim stays "your components are verified against declared
  platform vocabularies," nothing more.
- **ADR-005 family hydration identity** (validation modes, eviction
  controls). Proposal only today; current `hydrate` strict mode is enough
  for v1.
- **Behavior binding contracts + state-aware styling (P1).** High value, but
  it is new API surface with real design risk; better designed calmly in
  v1.x than rushed. **DECIDED 2026-07-06: deferral confirmed** — first
  design item of v1.x.
- **Unified diagnostics pipeline / "af-ui doctor" CLI (P3).** V1 keeps
  explicit validators; the dev-mode auto-report layer and CLI come after.
- **User-declared token schema (P4).** V1 ships the built-in taxonomy;
  module-augmentation/generic theme schema is v1.x.
- **Test kit package (P5).** `Reactivity.test` and existing harness patterns
  ship; the packaged driver API is v1.x.
- **Package split (P7).** **DECIDED 2026-07-06: confirmed** — v1 ships one
  package. The layering (core → view/style/behavior → router → server) is
  enforced internally so a later split is cheap; split re-evaluated post-v1.
- **A11y pattern contracts (P8), Forms vertical (P9).** Both are flagship
  v1.x features; v1 ships the primitives they compose.
- **Exit-animation deferred unmount (P10).** V1 needs only the design note
  deciding ownership; implementation follows.
- **Devtools + MCP (P11)** (registry snapshots, invalidation timeline,
  action/optimistic lifecycle, slot-contract tree; MCP read/rewind/dispatch).
  Post-v1 implementation, but the design should be validated against the
  Registry/Reactivity data model before the runtime surface freezes.
- **Schema-validated action inputs (P13)** (optional
  `Atom.action(fn, { inputSchema })`). **DECIDED 2026-07-06:** the
  boundary-hardening subset is pulled into v1 — remotely-invokable actions
  accepting unvalidated input is a correctness/security question. Local-only
  ergonomic extensions stay v1.x.
- **Gated subscription primitive (P12)** (`Atom.Stream.gated(...)` /
  `Component.subscription(...)`). **DECIDED 2026-07-06: v1.x confirmed** —
  the dependency-driven scope-restart semantics are real new runtime
  machinery, not a cheap composition of existing helpers.
- **`RouterRuntime` cancellation/supersession polish** beyond what exists.
  Current guarded in-flight model ships; deeper Effect-fiber interruption
  integration is v1.x.
- **Scaffolding (D3)** (`create-af-ui`, generators). Can trail the release;
  does not gate it.

## Release-blocking summary

Status as of 2026-07-07 (details in `CURRENT_STATUS_IN_REDESIGN_PLAN.md`
backlog + archive log):

| # | Item | Status |
|---|---|---|
| 1 | Golden-path compression + cheap tier (Finding 1) | ✅ `View.Slots.define` + cheap tier shipped, golden path ~15 lines |
| 2 | JSX-as-node golden path; builders demoted (Finding 2) | ✅ decided + docs corrected |
| 3 | Attachment API consolidation (Finding 3) | ✅ resolved as a 2-tier model (general `attach`/`attachByView`/`Behavior.attach` + typed-sugar `attach*Slots*`); deletion was the wrong call — the general forms cover cases the contract forms can't |
| 4 | Inference audit (Finding 4) | ✅ authored path proven generic-free |
| 5 | Result consolidation (Finding 5) | ✅ release-blocking core done (loaderResult + title/meta emit unified Result; no defect union on golden path); step-2 internal cache/wire cleanup is a non-blocking follow-up pass |
| 6 | Typed-tree/claims sweep (Finding 6) | ✅ claims scoped in docs; typed-tree-by-default is v1.x per #2 |
| 7 | Reactivity key witnesses (P2) | ✅ shipped end-to-end |
| 8 | Routing consolidation (P6) | ◑ audited → **3-tier model, not a deletion** (history infra / component-first `Component.route` / route-first tree); reclassified the misleading "transitional" JSDoc. `RouteChildrenEnhancer`/pipe-overload type seam fixed (Codex, type-only). Remaining: dedupe constructor-vs-piped forms (cosmetic) |
| 9 | Docs/archive alignment (PR2) + green gates | ◑ log + fully-historical docs archived; exploratory-doc sweep remains; **all gates green + enforced** (`npm run check` = typecheck main/tests/examples + 488 tests) |
| 10 | Services/layers S1/S2/S3 | ✅ mount-with-runtime shipped, guide shipped, isolation test green |

Remaining release-blocking work (updated 2026-07-07): **`effect` stable
release** (external — currently pinned to `^4.0.0-beta.29`) is the only
hard blocker left. Resolved since last update: tests/examples typecheck gates
green and wired into `npm run check`; all 13 example apps migrated + typecheck
clean; `MaterializedAppRoute` discharges `RouteContext` in its type; **P6
constructor-vs-piped dedupe closed** (verified non-redundant — both forms
load-bearing — stale "transitional" JSDoc corrected); **PR2 doc archive sweep
done** (47 exploratory/plan docs moved to `docs/archive/`, live set = 13
reference docs, zero broken links). Non-blocking follow-ups: Finding-5 step 2
(internal FetchResult cleanup), Finding-5 wire format, dead type-alias sweep in
`Route.ts`. Do not cut by re-adding deferred features.

## Update rule

- Change this doc only by explicit decision, not by drift.
- When a DECIDE item is resolved, replace the marker with the decision and
  date.
- If an item moves between Ships and Deferred, record why in one line.
