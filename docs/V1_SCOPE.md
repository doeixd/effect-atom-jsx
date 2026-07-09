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
- Behavior binding contracts + state-aware styling + out-events (P1/F5):
  **shipped** — `Behavior.provides` / `Behavior.emits`, `Style.whenBinding`,
  typed out-event buses (landed prerelease; no longer deferred)
- Attachment surface consolidated (Finding 3) — 2-tier model (general
  `attach` + typed slot sugar); release-blocking core done
- Inference audit: no explicit generics in authored code (Finding 4) —
  release-blocking core done
- Declared-vs-rendered diagnostics + platform validation; **diagnostics
  pipeline + `af-ui doctor` CLI + opt-in dev auto-report (P3)** shipped
- Test kit on `effect-atom-jsx/testing` (P5): `render`, `behaviorDriver`,
  `resolveQuery`/`resolveAction`, story/scene helpers — shipped

### Routing / server (single canonical generation)

- Unified route model: `Route.path/paramsSchema/querySchema/hashSchema/
  loader/title/meta/children`, loader options (stale/cache/streaming/
  reactivity keys), typed extraction helpers
- Single flight: transport service + `Atom.action({ singleFlight })` client
  path + loader seeding helpers
- Hydration: `dehydrate` / `hydrate` with strict validation
- `ServerRoute` kinds + schema decoding + `dispatch` + document rendering
- Routing consolidation (P6): **RESOLVED 2026-07-07/08** — three permanent
  tiers (history infra / component-first `Component.route` / route-first
  tree), not a legacy-to-delete generation. Survivors: unified route model,
  `RouterRuntime`, `ServerRoute`. Overload seam unified; docs describe the
  tiers (not "transitional"). Physical deletion of deprecated helpers is
  **not** release-blocking — cosmetic follow-up only.

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

**Release-blocking for a true 1.0 stable (updated 2026-07-09):**
- **Effect *beta* dependency only.** `effect ^4.0.0-beta.29` (dep + peer). A
  1.0 cannot be stable on a beta core. Gated on Effect 4 stable.

**Resolved since the 2026-07-07 scrutiny pass:**
- `typecheck:tests` and `typecheck:examples` are green and enforced via
  `npm run typecheck:all` / `npm run check`.
- Example apps migrated to current patterns; example typecheck gate clean.
- Finding-5 wire/internal cleanup landed; primary surfaces emit unified
  `Result`.
- P13 boundary hardening: optional `Atom.action(..., { inputSchema })`
  validates inputs before the effect / single-flight transport (2026-07-09).

**Should-fix (quality, non-blocking for prerelease):**
- Cast density / occasional deep-instantiation warnings in `Route.ts`
  internals; continue reducing as helpers land.
- CHANGELOG Unreleased tracks redesign; cut version notes when tagging.

Verdict: **prerelease / beta-ready** with green gates. A stable Effect 4
core is the only hard external blocker for cutting `1.0.0`.

## Deferred (explicitly not v1)

- **TUI / React Native renderers.** V1 ships platform *validation*
  (capability/event/property metadata, `validatePlatform`), not alternate
  renderers. The claim stays "your components are verified against declared
  platform vocabularies," nothing more.
- **ADR-005 family hydration identity** (validation modes, eviction
  controls). Proposal only today; current `hydrate` strict mode is enough
  for v1.
- **Package split (P7).** **DECIDED 2026-07-06: confirmed** — v1 ships one
  package. Split re-evaluated post-v1 only.
- **Depth beyond shipped MVPs (2026-07-09 backlog close):** full WAI-ARIA
  certification theater, browser Devtools panel chrome, Form+single-flight
  demo apps, and Effect-fiber interruption polish. **Shipped in-tree already:**
  P1/P3/P5 cores, P4 decision + schema, P8 catalog MVP, P9 `Form`, P10
  ownership note, P11 Devtools/MCP session MVP, P12 gated stream +
  `Component.subscription`, P13 inputSchema, D3 `create-af-ui`.
- **`RouterRuntime` cancellation/supersession polish** beyond the current
  guarded in-flight model (deeper fiber interruption) remains optional depth.
- **Schema-validated action inputs (P13)** boundary subset **shipped**;
  further local-only ergonomics optional.

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
| 8 | Routing consolidation (P6) | ✅ **3-tier model resolved** (not deletion); overload seam unified; docs corrected. Cosmetic helper dedupe only — not release-blocking |
| 9 | Docs/archive alignment (PR2) + green gates | ✅ log archived; gates green + enforced (`typecheck:all` + tests + build) |
| 10 | Services/layers S1/S2/S3 | ✅ mount-with-runtime shipped, guide shipped, isolation test green |
| 11 | P13 action inputSchema boundary | ✅ optional schema decode before effect / single-flight (2026-07-09) |

Remaining release-blocking work for **1.0 stable** (updated 2026-07-09):
**`effect` stable release** only (external — pinned to `^4.0.0-beta.29`).
Prerelease is ready when quality gates are green (see
`docs/RELEASE_CHECKLIST.md`). Do not cut by re-adding deferred features.

## Update rule

- Change this doc only by explicit decision, not by drift.
- When a DECIDE item is resolved, replace the marker with the decision and
  date.
- If an item moves between Ships and Deferred, record why in one line.
