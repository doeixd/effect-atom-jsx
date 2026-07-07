# V1 Scope

Status: **draft — needs review/ratification** (created 2026-07-06 from the
design-review round-3 PR1 item in `CURRENT_STATUS_IN_REDESIGN_PLAN.md`).

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
- Witness-aware JSX tree authoring (Finding 2) — DECIDE: v1-blocking or
  v1.x? Recommendation: v1-blocking; it is the authored surface users judge
  first, and shipping `View.element(...)` chains as the public face will set
  the framework's reputation.
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
- Routing consolidation (P6): the legacy `Route` service generation and
  superseded route-node helpers get deprecate-and-delete before v1 —
  release-blocking. DECIDE: exact survivor list (unified model +
  `RouterRuntime` recommended).

### Services / layers

- One-composition-root doctrine documented (S1): one `AppLayer` feeds both
  `Atom.runtime(...)` and `Component.mount(...)`. DECIDE: should
  `Component.mount` accept an `AtomRuntime` directly so the two worlds are
  structurally one? Resolve with this doc's ratification — it is an API
  shape question that gets harder after v1.
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
  v1.x than rushed. DECIDE: confirm deferral — this is the one deferred item
  users will ask for first.
- **Unified diagnostics pipeline / "af-ui doctor" CLI (P3).** V1 keeps
  explicit validators; the dev-mode auto-report layer and CLI come after.
- **User-declared token schema (P4).** V1 ships the built-in taxonomy;
  module-augmentation/generic theme schema is v1.x.
- **Test kit package (P5).** `Reactivity.test` and existing harness patterns
  ship; the packaged driver API is v1.x.
- **Package split (P7).** V1 ships one package. The layering (core →
  view/style/behavior → router → server) is enforced internally now so a
  later split is cheap. DECIDE: confirm.
- **A11y pattern contracts (P8), Forms vertical (P9).** Both are flagship
  v1.x features; v1 ships the primitives they compose.
- **Exit-animation deferred unmount (P10).** V1 needs only the design note
  deciding ownership; implementation follows.
- **Devtools + MCP (P11)** (registry snapshots, invalidation timeline,
  action/optimistic lifecycle, slot-contract tree; MCP read/rewind/dispatch).
  Post-v1 implementation, but the design should be validated against the
  Registry/Reactivity data model before the runtime surface freezes.
- **Schema-validated action inputs (P13)** (optional
  `Atom.action(fn, { inputSchema })`). v1.x by default. DECIDE: pull the
  single-flight-invokable subset into v1 — remotely-invokable actions
  accepting unvalidated input is a boundary-hardening question, not a
  feature question.
- **Gated subscription primitive (P12)** (`Atom.Stream.gated(...)` /
  `Component.subscription(...)`). Small standalone win; v1.x unless it falls
  out cheaply of existing stream helpers. DECIDE: pull into v1 if the setup
  helper form needs no new runtime machinery.
- **`RouterRuntime` cancellation/supersession polish** beyond what exists.
  Current guarded in-flight model ships; deeper Effect-fiber interruption
  integration is v1.x.
- **Scaffolding (D3)** (`create-af-ui`, generators). Can trail the release;
  does not gate it.

## Release-blocking summary

From findings/proposals, exactly these gate v1:

1. Golden-path compression + cheap tier (Finding 1)
2. Witness-aware JSX authoring (Finding 2 — pending DECIDE above)
3. Attachment API consolidation (Finding 3)
4. Inference audit (Finding 4)
5. Result consolidation (Finding 5)
6. Typed-tree/claims sweep (Finding 6)
7. Reactivity key witnesses (P2)
8. Routing consolidation (P6)
9. Docs/archive alignment (PR2) + green quality gates
10. Services/layers: S1 composition-root decision resolved,
    `SERVICES_AND_LAYERS.md` shipped, request-isolation test green (S2/S3)

Everything else is v1.x or later. If the list above proves too large, cut
from the bottom of this list, not by re-adding deferred features.

## Update rule

- Change this doc only by explicit decision, not by drift.
- When a DECIDE item is resolved, replace the marker with the decision and
  date.
- If an item moves between Ships and Deferred, record why in one line.
