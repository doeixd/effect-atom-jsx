# Result Unification Plan (Milestone 9, first slice)

Date: 2026-07-29 (progress updated 2026-07-30)
Status: in progress — Slices 1–3 implemented 2026-07-30; Slices 4–5 pending
(blocked only on concurrent router/resume work settling); Slice 6 optional.

Progress log (2026-07-30):

- **Slice 1 done.** Frozen wire pin lives in
  `src/__tests__/serialization.test.ts` under
  `describe("frozen wire pin (§2.3 field mapping)")`: 8 encode-side golden
  byte fixtures (clock pinned to `1700000000000`) each with a decode
  assertion, a 4-row legacy-acceptance decode table, timestamp regex /
  `toMatchObject` pins, and exact `serializeLoaderData` record bytes. The
  fixtures are immutable per Decision 7.
  - One deviation: the loader-*script* fixture pins the embedded projected
    result JSON (plus a `<script>`-safety check) rather than the whole
    template, because Router R2 replaced the `window.__LOADER_DATA__`
    envelope with `window.__afuiLoaderHandoff` concurrently. The result
    bytes themselves are pinned exactly; the envelope belongs to the router
    lane.
- **Slice 2 done.** `src/result-wire.ts` is the single canonical projection
  (`ResultWire`/`ResultWireRecord`/`ResultWireValue`/`SuccessWireValue`,
  `toWire(result, now = Date.now)`, `fromWire`). The Stale seam predicate is
  written clause-per-frozen-row with a "do not simplify" note; the module doc
  records the Decision 6 single-flight fence. `Serialization.ts` re-exports
  and keeps only the string/service layer; `FetchResult` imports there = 0.
- **Slice 3 done.** `Result.builder` and `Result.all` ported to core
  (`src/effect-ts.ts`) with `src/type-tests/result-builder-all.ts` and 20
  runtime cases in `src/__tests__/phase3.test.ts`. `README.md` and
  `docs/API.md` updated; the `FetchResult` API section is marked deprecated.
- **Table correction.** §2.3 row 5 originally predicted
  `Failure{waiting:true, previousSuccess:null}` decodes to
  `Refreshing(Failure)`. The actual decoder ignores `waiting` when
  `previousSuccess` is null and yields settled `Failure(error)`; the Slice 1
  fixture pins that real behaviour. The table row below is corrected —
  `Refreshing(Failure)` is a lossy encode-side projection, like row 10.
- Named follow-ups unchanged: single-flight projection (Decision 6 fence),
  `loaderSuccess` not reading `Stale.data` (Risk 3, router lane), and
  `Resume.ts`'s hand-rolled `Stale → refreshing` unwrap which should call a
  core helper after Slice 3.
Owner item: `DESIGN_IMPROVEMENT_NOTES.md` item 1 ("Consolidate the two
`Result` models"), folding in the residual of plan entry P15 ("Richer
`Result` states").

Scope: unify the two coexisting result models into **one core model plus one
canonical wire projection module**, without changing a single byte of any
existing wire format. Every section below ends in an explicit decision.

---

## 0. Why this is the first Milestone 9 slice

The conversion seam between the two models is paid by every wire feature.
Milestone 8 hit it twice (the `Stale` branch of `FetchResult.toResult`, and
the timestampless `Success` projection), the router pays it in
`resultToWire`, and Milestone 9's own deliverables (export audit, manifest
compatibility fixtures, stability policy) all describe surfaces that this
seam is part of. Doing the export audit before the unification would audit a
surface we are about to delete.

**Decision 0:** Result unification lands first in Milestone 9, before the
export/diagnostics audit and before any new wire feature.

---

## 1. Inventory

### 1.1 Core model — `src/effect-ts.ts`

Definition, lines ~76–330:

- Variants: `Loading`, `Refreshing<A,E>{ previous }`, `Success<A>{ value, exit }`,
  `Failure<E>{ error, exit }`, `Stale<A,E>{ error, data, exit }`,
  `Defect{ cause, rawCause, exit }`.
- Union: `Result<A, E>` (line 119).
- Namespace object `Result` (line 139): `loading`, `refreshing`, `success`,
  `failure`, `stale`, `defect`, `settled`, `fromExit`, `toExit`, `toOption`,
  `getData`, `getError`, `rawCause`, `isLoading`/`isRefreshing`/`isSuccess`/
  `isFailure`/`isStale`/`isDefect`, `match`, `map`, `getOrElse`, `getOrThrow`.
- Every variant carries a canonical Effect `Exit`; `Defect` also carries the
  structured `Cause`. **Not JSON-safe.**

Consumers (core model), by file/symbol:

| File | Symbols / sites |
| --- | --- |
| `src/effect-ts.ts` | `atomEffect` (line ~548, failed-refresh → `Stale`), `defineQuery`/`QueryRef`/`QueryGet` (~618–920), `isPending` (925), `latest` (941, `Stale` → `data`), `MutationEffectHandle` (~1016–1240) and its `Stale` branch at 1201, result bridge at 679, `<Async>` (1614, `stale` prop), `<Errored>` (1686), boundary at 1710, `setResultForTest` (531) |
| `src/Atom.ts` | `ResultAtom`/`AsyncAtom` (130–133), `ResultLikeValue` (137), `toEffectResult` (187–214, has both models' tags in one switch), `Atom.result` bridge (2201), single-flight hydration (1184) |
| `src/Route.ts` | `UnknownRouteResult` throughout; `loaderSuccess` (510) — reads `Success` and `Refreshing(Success)` **only**; call sites 1488, 1567, 1640, 2010; `RenderRequestResult.loaderPayload` (171); `SingleFlightPayload.loaders` (318–330); `SingleFlightLoaderEntry`; `serializeLoaderData`/`deserializeLoaderData`/`streamDeferredLoaderScripts` (2995–3015); `hydrateSingleFlightPayload` (2561–2575); `invokeSingleFlight` (2696) |
| `src/Resume.ts` | query-snapshot restoration `readResult`/`writeResult` + `refresh` (2031–2075) — explicitly special-cases `Stale` → `success(data)` before `refreshing(...)`; snapshot emission gate ("only settled `Success` is snapshotted"); diagnostics at 1505, 1966, 1993, 4526 |
| `src/resume-handle.ts` | `QueryHandleInspection.read(): Result<A, E>` (~88); `BindingResumePolicy` discriminating `ReadonlyAtom<Result<A,any>>` → `QuerySnapshotPolicy` (~51) |
| `src/Serialization.ts` | `resultToWire` (102), `resultFromWire` (130), `encodeResult`/`decodeResult`/`encodeResultRecord`/`decodeResultRecord` (171–197) |

### 1.2 Fetch model — `src/Result.ts` (exported as `FetchResult`)

- Variants: `Initial{ waiting }`, `Success{ value, waiting, timestamp }`,
  `Failure{ error: E | { defect: string }, waiting, previousSuccess }`.
- API: `initial`, `success`, `failure`, `isResult`, `isInitial`,
  `isNotInitial`, `isSuccess`, `isFailure`, `isWaiting`, `waiting`,
  `waitingFrom`, `fromResult`, `toResult`, `fromExit`,
  `fromExitWithPrevious`, `value`, `getOrElse`, `getOrThrow`, `map`,
  `flatMap`, `match`, `builder` (+ `Builder`/`BuilderHandlers`), `all`,
  `fromDefect`.

Complete consumer list (this is the whole surface — it is already small):

| File | Site | Nature |
| --- | --- | --- |
| `src/index.ts:44` | `export * as FetchResult from "./Result.js"` | public export |
| `src/Atom.ts:27,137,187–206` | `ResultLikeValue` union + `toEffectResult` `Initial`/`Failure` branches | compat bridge |
| `src/Serialization.ts:29,102–146` | `FetchResult.initial/success/failure` used as *DTO constructors*, `FetchResult.toResult` used as the decoder | wire projection |
| `src/type-tests/atom-type-axes.ts:3,56–60` | `fetchResultAtom` inference assertions | type test |
| `src/__tests__/effect-atom-api.test.ts:10,523–560` | `converts Result <-> FetchResult`, `round-trips core Stale through FetchResult` | runtime test |
| `examples/router-golden-path/App.tsx:1` | imported, **never used** | dead import |
| `docs/API.md:1616–1657` | full `FetchResult` reference section | docs |
| `README.md:130–147` | `Result.builder(...).onInitial/.onSuccess/.onFailure` showcase — this is the **fetch** model's builder; core `Result` has no `builder` | docs (mis-sells the compat model as the headline API) |

Zero consumers in `Route.ts`, `router-runtime.ts`, `Resume.ts`,
`resume-*.ts`, `wire-json.ts`, or any example source. `loaderFetchResult`
(the last router compat accessor) is already slated for deletion by
`ROUTER_R1_TASK_BRIEF.md`.

### 1.3 Conversion sites (the seam, exhaustively)

1. `FetchResult.fromResult` (`src/Result.ts:139`) — core → fetch. Handles
   `Loading`, `Refreshing`×3, `Success`, `Failure`, `Stale`, `Defect`
   (with `rawCause` pretty-printing).
2. `FetchResult.toResult` (`src/Result.ts:228`) — fetch → core. Contains the
   keep-stale reconstruction (settled failure + `previousSuccess` +
   non-defect error → `Result.stale`).
3. `Serialization.resultToWire` (`src/Serialization.ts:102`) — core → wire
   DTO. A *second, independent* copy of (1)'s mapping, written directly
   against `FetchResult` constructors.
4. `Serialization.resultFromWire` (`src/Serialization.ts:130`) — wire DTO →
   core. Duplicates (2)'s stale-detection predicate inline, then delegates
   the rest to `FetchResult.toResult`.
5. `Atom.toEffectResult` (`src/Atom.ts:187`) — one switch spanning both
   models' tags (`Initial` and `Loading`; two shapes of `Failure`).
6. `FetchResult.fromExit` / `fromExitWithPrevious` — `Exit` → fetch model,
   parallel to core `Result.fromExit`.
7. `FetchResult.fromDefect` — core `Defect` → fetch failure.

So the same mapping exists **three** times (1/2, 3/4, and the `Exit` pair),
and (3)/(4) are the ones the wire actually depends on.

### 1.4 Wire formats that must not change

- **Loader data** — `ResultWire` / `ResultWireRecord`, emitted by
  `Route.serializeLoaderData` and `streamDeferredLoaderScripts`, consumed by
  `deserializeLoaderData` + the `__LOADER_DATA__` bootstrap script.
- **Single-flight** — `SingleFlightPayload.loaders[].result` is typed
  `UnknownRouteResult` (core `Result`) and crosses the network via plain
  `JSON.stringify` on the server and `response.json()` in
  `invokeSingleFlight` (`src/Route.ts:2712–2715`). **Finding:** this path is
  *not* projected through `resultToWire` at all — `exit`/`rawCause` are
  silently dropped by `JSON.stringify`, and the client rehydrates a core
  `Result` that is missing its canonical `Exit`. It is the strongest argument
  for a single projection module, and the change is *not* byte-neutral, so it
  is explicitly out of scope here (see Decision 6).
- **Resume manifest query snapshots** — `snapshotQuery` encodes only the
  settled success *value* through the binding's own `Schema.Codec`; the
  manifest never carries a `Result` envelope. Unaffected by this work, but
  the snapshot-emission gate reads core `Result` tags and must keep reading
  the same set.

**Decision 1:** The seam is three duplicated mappings over a two-model
inventory whose compat side has 6 real consumers, 2 of which are tests and 2
of which are docs. The unification is small and mechanical; the risk is
entirely in the wire and in the type-inference tail, not in volume.

---

## 2. Target design

### 2.1 Which model survives

**Core `Result` from `effect-ts.ts`.** Argument:

- **Fidelity.** It carries `Exit` on every variant and `Cause` on `Defect`.
  The fetch model's `E | { defect: string }` untagged union was exactly the
  defect that the Finding-5 migration removed from internals; adopting it
  back would reopen it.
- **Gravity.** Atoms, queries, mutations, loaders, the resume query
  handles/snapshots, `<Async>`/`<Errored>`/`<Loading>`, and `Effect.result`
  interop all speak the core model. The fetch model's consumers are 2 tests,
  2 docs, 1 dead import, 1 compat union, and the wire projection.
- **Expressiveness.** Post-P15 the core model is a strict superset:
  `Refreshing{previous}` is more general than `waiting: boolean` (it
  distinguishes *what* is being refreshed), and `Stale{error,data}` covers
  `Failure.previousSuccess`. The one field with no core counterpart is
  `timestamp`, which has **no in-repo consumer** (see 2.3).
- **Prerelease policy.** "Prefer the coherent final API over backwards
  compatibility" — the fetch model exists only as a compatibility shim, and
  the repo status doc has already labelled it "compat-only" since 2026-07-08.

**Decision 2:** Core `Result` (`Loading | Refreshing | Success | Failure |
Stale | Defect`) is the single model. `FetchResult` is not a second model to
be maintained; its *shape* survives only as the wire DTO.

### 2.2 One canonical projection module

New file **`src/result-wire.ts`** — the only place in the repo that knows the
flat DTO:

```
src/result-wire.ts
  ResultWire, ResultWireRecord        (Schema, moved verbatim)
  ResultWireValue                     (type)
  toWire(core)   : ResultWireValue    (was Serialization.resultToWire)
  fromWire(wire) : Result<unknown,unknown>  (was Serialization.resultFromWire)
```

Properties this module must have:

- **No import of `Result.ts`.** The DTO constructors are inlined as plain
  object literals (they are three-field records; the indirection through
  `FetchResult.success` is what made this look like a model conversion
  instead of a serializer).
- **No import of `Serialization.ts`.** `Serialization` keeps the *string*
  layer (`escapeJsonForHtml`, `encodeSync`/`decodeSync`, the service `Tag`
  and `layer`, `encodeResult`/`decodeResult`/`encodeResultRecord`/
  `decodeResultRecord`) and re-exports the schemas/functions so `docs/API.md`
  and any external import path keep working.
- **Total and exhaustive** in both directions, with the decode side
  documented as *lenient*: it must accept every historical wire value,
  including ones `toWire` can no longer produce.

**Decision 3:** `src/result-wire.ts` is the single canonical projection. Any
future module that needs a serializable result must import it; hand-rolled
mappings are a review-blocking defect.

### 2.3 Field-by-field mapping (frozen)

| Wire DTO | Produced from core | Decoded to core |
| --- | --- | --- |
| `Initial{ waiting: true }` | `Loading` | `Loading` |
| `Initial{ waiting: false }` | *(unreachable today)* | `Loading` — the free slot reserved for `Idle`, see 2.5 |
| `Success{ value, waiting: false, timestamp }` | `Success` | `Success(value)` |
| `Success{ value, waiting: true, timestamp }` | `Refreshing(Success)` | `Refreshing(Success(value))` |
| `Failure{ error, waiting: true, previousSuccess: null }` | `Refreshing(Failure)` | `Failure(error)` — corrected 2026-07-30: the decoder ignores `waiting` when `previousSuccess` is null, so this is a lossy projection like row 10; pinned by a Slice 1 fixture |
| `Failure{ error, waiting: true, previousSuccess: S }` | *(unreachable today)* | `Refreshing(Success(S.value))` — legacy acceptance, pinned by an existing test |
| `Failure{ error, waiting: false, previousSuccess: null }` | `Failure` | `Failure(error)` |
| `Failure{ error, waiting: false, previousSuccess: S }` | `Stale(error, S.value)` | `Stale(error, S.value)` |
| `Failure{ error: { defect }, waiting: false, … }` | `Defect` | `Defect(defect)` — takes precedence over the stale rule |
| `Failure{ error: { defect }, waiting: true }` | `Refreshing(Defect)` | `Defect(defect)` (lossy today; frozen) |

So the three fetch-only fields map as:

- `waiting` → **`Refreshing`**. It is not state, it is the boolean shadow of
  the `Refreshing` wrapper. On the wire it stays a boolean because that is
  the frozen format.
- `previousSuccess` → **`Stale.data`** when settled, `Refreshing.previous`
  when in flight. This is the P15 correspondence, already implemented.
- `timestamp` → **nothing.** It is write-only: `resultToWire` fills it from
  `Date.now()` (via `FetchResult.success`'s default) and every decoder
  ignores it. It must remain in the schema (frozen format, `Schema.Number`,
  required) but it is a serializer field, not a model field.

**Decision 4:** `timestamp` is not promoted onto core `Result`. Rationale:
zero consumers; adding it would force every `Result.success` construction
site to source a clock, and would break the structural-equality assertions
that tests and `toEqual` round-trips rely on. `result-wire.ts` emits it from
an injectable `now = () => Date.now()` parameter (default preserves current
bytes; tests can pin it). If a real consumer appears, the honest design is a
separate `Meta`/`freshness` sidecar, not a field on the algebra. Revisit only
with a named consumer.

`Exit` and `rawCause` are **intentionally not** on the wire: `Defect` carries
`cause: string` only, and decode reconstructs via `Result.defect(cause)`
(which synthesizes `Cause.die`). This is the existing behaviour; freezing it.

### 2.4 What happens to `FetchResult`

Options considered:

- (a) keep `src/Result.ts` as a deprecated alias module;
- (b) delete it, porting the parts authors actually consumed;
- (c) delete the module but keep `Initial|Success|Failure` types re-exported
  as the wire DTO's public type names.

(a) fails the point of the exercise: an alias that still exports
`fromResult`/`toResult` keeps the second model alive and keeps the third copy
of the mapping. (c) confuses a DTO with a model.

Only two things in `FetchResult` are worth carrying over, and neither is the
model:

1. **`builder(...)`** — the fluent exhaustive matcher. It is the API the
   README leads with, and core `Result` has no equivalent (only positional
   `match`). It must be ported to the core model with handlers
   `onLoading`/`onRefreshing`/`onSuccess`/`onStale`/`onFailure`/`onDefect`,
   with `onFailure` used as the fallback for `onStale`/`onDefect` when they
   are absent (mirroring how `<Async>` already degrades `stale` → `error`).
2. **`all(...)`** — tuple combination. Useful, model-independent; port to
   core with short-circuit order `Defect > Failure > Stale > Loading >
   Refreshing > Success`.

Everything else has a core counterpart already (`map`, `flatMap`→ none needed,
`value`→`toOption`, `getOrElse`, `getOrThrow`, guards, `fromExit`,
`fromDefect`, `isWaiting`→`isRefreshing`).

**Decision 5:** `src/Result.ts` is **deleted**, not deprecated (prerelease
rules; it has been documented as compat-only for three weeks and has zero
non-test consumers). `Result.builder` and `Result.all` are ported to the core
namespace first, so the deletion removes no capability. The freed filename
`src/Result.ts` is reclaimed for the core model in an optional final slice.

### 2.5 Folding in P15's residual (`Idle`)

P15 shipped `Stale` and deferred `Idle`. The inventory surfaces a fact that
changes the calculus: the wire already has an unreachable
`Initial{ waiting: false }` value. `Idle` therefore costs **zero wire
version bumps** — it is the existing tag with the existing boolean.

**Correction (2026-07-30, found while triaging `DQ-092`): the slot is not
actually free — this section and the §2.3 table disagree.** §2.3 row 2 decodes
`Initial{ waiting: false }` to **`Loading`**, and Slice 1 has now pinned that
row as frozen behaviour. So the encode side is unreachable (nothing produces it)
while the decode side is already *claimed*. Introducing `Idle` therefore is not
free after all: it means changing what an existing wire value decodes to, which
is a behaviour change to a pinned row, not the no-op this section describes.

Consequences to settle before `Idle` is attempted (tracked as `DQ-092`):

- Either accept that a legacy payload carrying `Initial{waiting:false}` starts
  decoding as `Idle` instead of `Loading` — and decide whether any producer ever
  emitted it, which determines whether this is theoretical or real; or
- give `Idle` its own wire representation and drop the "byte-free" claim.

Until that is decided, treat §2.3 row 2 as authoritative and this paragraph's
"zero wire version bumps" as **unproven**. The acceptance-criteria reference to
`Idle` being "byte-free" inherits the same caveat.

**Decision 6 (scope fence):** `Idle` is *not* added in this work, and neither
is the single-flight projection fix from 1.4. Both are recorded here as the
two follow-ups this plan unblocks, in that order, each as its own change with
its own gates. Adding either inside the unification would mean a slice that
both moves code and changes behaviour — precisely the combination that makes
a wire regression hard to bisect.

---

## 3. Migration sequence

Ordering principle: **every slice before the last is byte-neutral by
construction**, and the byte pin is established before anything moves.

Gates per slice, unless stated otherwise:
`npm run typecheck` → `npm test` → `npm run build`.

### Slice 1 — Pin the wire (test-only, no source change)

- Add golden-**string** fixtures to `src/__tests__/serialization.test.ts`:
  for each of the 10 rows in the 2.3 table, assert the exact
  `Serialization.encodeResult(...)` output string (with `timestamp`
  normalized by a fixed fake clock, or matched by a stable regex where the
  clock is not yet injectable) and the exact decoded core tag.
- Add a fixture asserting the `streamDeferredLoaderScripts` output string
  shape (the `<script>window.__LOADER_DATA__…` template) for one success and
  one stale result.
- Add a decode-only fixture table for the **legacy-acceptance** rows
  (`Failure{waiting:true, previousSuccess}` → `Refreshing`;
  `Failure{error:{defect}, previousSuccess}` → `Defect`) — these already
  exist as three tests at `serialization.test.ts:76–110`; consolidate them
  into the table so it is visibly exhaustive.
- Gate: `npm test` only.
- **Exit condition: the 10-row table plus the script-template fixture are
  green against unmodified source.** Nothing after this slice may edit these
  fixtures; a required edit is the signal that a wire change is happening.

### Slice 2 — Extract `src/result-wire.ts`

- Move `ResultWire`, `SuccessWire`, `ResultWireRecord`, `ResultWireValue`,
  `resultToWire`→`toWire`, `resultFromWire`→`fromWire` into the new module.
- Inline the DTO construction (object literals) so the module no longer
  imports `./Result.js`; inline the decode logic currently delegated to
  `FetchResult.toResult`, using the 2.3 table as the specification.
- Add the `now` parameter with a `Date.now()` default.
- `Serialization.ts` re-exports `ResultWire`, `ResultWireRecord`,
  `ResultWireValue`, `resultToWire`, `resultFromWire` from the new module and
  keeps the string/service layer unchanged. `Route.ts` is untouched.
- Slice 2 exit: `FetchResult` imports in `Serialization.ts` = 0; Slice 1
  fixtures untouched and green.

### Slice 3 — Port the ergonomics to core `Result`

- Add `Result.builder` (six handlers, `onFailure` fallback for
  `onStale`/`onDefect`) and `Result.all` to the namespace in `effect-ts.ts`.
- Add type tests in `src/type-tests/` for builder return-type accumulation
  and `all` tuple inference (mirroring the existing fetch-model assertions
  so coverage does not dip when those are deleted).
- Update `README.md:139–147` and the `docs/API.md` result section to the core
  builder (`onLoading` instead of `onInitial`). This is the slice that stops
  the README from advertising the compat model.
- Slice 3 exit: core namespace is a superset of the fetch API for every
  capability listed in 2.4.

### Slice 4 — Drop `FetchResult` from remaining source

- `src/Atom.ts`: `ResultLikeValue` → `Result<any, any>`; delete the
  `Initial` case and the second `Failure` shape from `toEffectResult`; remove
  the import. Re-examine `ResultErrorOf`'s `Exclude<E, { defect: string }>`
  (see Risk 5) — remove it only if the type tests confirm no inference
  change for core-only atoms; otherwise leave it with a comment.
- `src/type-tests/atom-type-axes.ts`: rewrite the two `fetchResultAtom`
  assertions against a core `Result` atom.
- `examples/router-golden-path/App.tsx`: drop the unused import.
- Delete `loaderFetchResult` from `Route.ts` if R1 has not already (coordinate
  with `ROUTER_R1_TASK_BRIEF.md` so it is deleted exactly once).
- Slice 4 exit: `grep -rn FetchResult src/ examples/` matches only
  `src/index.ts`, `src/Result.ts`, and `effect-atom-api.test.ts`.

### Slice 5 — Delete `src/Result.ts`

- Remove the file and the `src/index.ts:44` export.
- Rewrite the two `effect-atom-api.test.ts` cases: the `Result <-> FetchResult`
  conversion test becomes a `toWire`/`fromWire` round-trip; the "round-trips
  core `Stale`" test moves to `serialization.test.ts` next to the Slice 1
  table (it is testing the wire, not a model bridge).
- Delete the `docs/API.md` `FetchResult` section; add a `result-wire.ts`
  subsection under Serialization.
- Update `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md` (Finding-5 / P15 entries)
  and `DESIGN_IMPROVEMENT_NOTES.md` item 1 to point at this document.
- Slice 5 exit: `FetchResult` matches 0 files under `src/`; package export
  surface test (`src/__tests__/package.test.ts`) updated and green.

### Slice 6 — Optional: reclaim the filename

- Move the core `Result` types, namespace, `builder`, and `all` out of
  `effect-ts.ts` (1991 lines) into a fresh `src/Result.ts`, re-exported from
  `effect-ts.ts` so no import path changes.
- Purely mechanical; do it only if Slices 1–5 land clean, and never in the
  same commit as any of them.

**Decision 7:** Six slices, five mandatory. Slice 1 is a pure test slice and
is a hard prerequisite: no source moves until the byte pin is green. The only
slice permitted to touch the Slice 1 fixtures is a future, explicitly
wire-versioned change (`Idle`, single-flight projection) — never this
migration.

---

## 4. Risks

1. **The `Stale` seam (already hit twice).** `Stale` was retrofitted after
   the wire shape was frozen, so it encodes as a *`Failure` with
   `previousSuccess`* and is recovered by a three-clause predicate
   (`waiting === false && previousSuccess !== null && error is not a
   defect`). Slice 2 rewrites that predicate in a new file. Mitigation: the
   predicate's three negative cases (waiting-true, null-previous,
   defect-error) are each a row in the Slice 1 table; two of them already
   have dedicated tests. Do not "simplify" the predicate.
2. **Timestampless `Success`.** `toWire` fabricates `timestamp` from
   `Date.now()`, so encoder output is nondeterministic and cannot be pinned
   as a literal string without the injectable clock. Mitigation: introduce
   the clock parameter in Slice 2, but write the Slice 1 fixtures with a
   regex/`toMatchObject` on `timestamp` so the pin exists *before* the
   refactor. Risk if skipped: a silently dropped or renamed field passes
   `toEqual` round-trip tests, because decode ignores the field entirely.
3. **Router `loaderSuccess` (`Route.ts:510`).** It reads only `Success` and
   `Refreshing(Success)` — it does **not** read `Stale.data`, so a failed
   loader refresh with last-good data currently renders as *no data* on four
   call sites (1488, 1567, 1640, 2010). This is a live keep-stale gap on the
   router path, discovered by this inventory. It is a behaviour fix, not a
   unification step: record it as a router finding (`R1`/`R5` territory) and
   do **not** fold it into a slice above, or the byte-neutrality claim stops
   being checkable.

   **Fixed 2026-08-11, with a correction to this finding's severity.**
   `loaderSuccess` now reads `Stale.data`. But "currently renders as *no data*"
   is **wrong**: a grep for `Result.stale(` / `_tag === "Stale"` across
   `Route.ts`, `router-runtime.ts`, and `RouterRuntime.ts` shows **nothing on
   the router path constructs a `Stale`** — loaders settle through
   `CoreResult.fromExit`, which only produces `Success`/`Failure`. The gap was
   therefore **latent, not live**: unreachable until unification introduces
   `Stale` on this path.

   Consequently the fix ships **without a test**, deliberately. An end-to-end
   test would have to fabricate a `Stale` the system cannot produce — seeding
   the loader cache does not work either, because `renderRequest` re-runs
   loaders rather than reading the cache. Writing one anyway would be a test
   that proves the fixture, not the behaviour. When unification lands `Stale`
   on the router path, that is the moment to add the covering test.

   Note also that `Refreshing.previous` is *typed* to exclude `Stale`, so
   `Refreshing(Stale)` is not representable and needs no branch — the compiler
   rejected the one that was written first.
4. **Resume query refresh (`Resume.ts:2055–2064`).** Hand-rolls
   `Stale → success(data) → refreshing(...)`. It survives unification
   untouched, but it is the second hand-rolled `Stale` unwrap in the repo;
   after Slice 3 it should call a core helper (`Result.toRefreshing` or
   `getData`-based) rather than re-deriving it. Track, do not block.
5. **`Atom.result` inference tail.** `ResultErrorOf` applies
   `Exclude<E, { defect: string }>` purely to strip the fetch model's untagged
   defect arm. Removing it changes inference for any core atom whose `E`
   legitimately has a `defect: string` member; keeping it leaves a dead
   `Exclude` that will confuse the next reader. Mitigation: decide with a
   type test in Slice 4, and write the outcome into the JSDoc either way.
6. **UI matchers / docs drift.** `README.md` and `docs/API.md` present
   `Result.builder(...).onInitial(...)` — fetch-model API — as the headline
   rendering pattern. Deleting the module before Slice 3 ports `builder`
   would break the documented golden path. Ordering is the mitigation:
   builder lands before deletion, and `onInitial` → `onLoading` is a
   documented rename, not a silent one.
7. **Single-flight is not projected at all.** `SingleFlightPayload.loaders[]`
   `JSON.stringify`s core `Result` directly, dropping `exit`/`rawCause`, and
   the client accepts it unvalidated. Fixing it *is* a byte change. Risk to
   this plan: a reviewer notices the inconsistency mid-migration and "fixes"
   it inside a slice. Mitigation: Decision 6 fences it out explicitly, and
   Slice 2's module doc states that single-flight is a known unprojected
   path with a named follow-up.
8. **Concurrent router consolidation.** `ROUTER_CONSOLIDATION_PLAN.md` R1
   also deletes `loaderFetchResult`. Double-deletion conflict is trivial;
   the real risk is both workstreams editing `Route.ts` result plumbing at
   once. Mitigation: this plan touches `Route.ts` in at most one line
   (Slice 4, and only if R1 has not landed).

**Decision 8:** Risks 3, 4, and 7 are real defects found by this inventory
and are recorded as *separate* work items, not absorbed. The unification's
value depends on it being provably byte-neutral, and each absorption would
cost that property.

---

## 5. Acceptance criteria

1. `grep -rn "FetchResult" src/` → 0 matches. `src/Result.ts` either absent
   or containing the core model only (Slice 6).
2. Exactly one module in the repo constructs or interprets the flat result
   DTO: `src/result-wire.ts`. No other file imports `ResultWire` except
   `Serialization.ts` (re-export) and tests.
3. The Slice 1 golden-string fixtures pass **unmodified** at every slice
   boundary from 1 through 6.
4. Legacy decode acceptance is unchanged and exhaustively tested: all 10 rows
   of the 2.3 table, including the two rows `toWire` cannot produce.
5. Core `Result` is a capability superset of the deleted model:
   `builder`, `all`, and equivalents for every listed fetch API, with type
   tests covering builder accumulation and `all` inference.
6. `Resume` manifest bytes and query-snapshot emission gates are unchanged;
   the resumability suite and browser tests pass with no fixture edits.
7. Docs are consistent: `README.md` and `docs/API.md` show only the core
   model; `docs/API.md` documents `result-wire.ts` as the single wire
   projection; `CURRENT_STATUS_IN_REDESIGN_PLAN.md` P15 and Finding-5 entries
   and `DESIGN_IMPROVEMENT_NOTES.md` item 1 reference this plan and record
   item 1 as closed.
8. All five standard gates green at each slice: `typecheck`, `test`, `build`
   (plus lint and browser tests where the repo runs them).
9. The three fenced follow-ups exist as written items with owners:
   `Idle` (byte-free, via `Initial{waiting:false}`), single-flight
   projection + validation (byte change, needs a version story per
   `DESIGN_IMPROVEMENT_NOTES.md` item 6), and `loaderSuccess` reading
   `Stale.data`.

**Decision 9:** Acceptance is criterion 3 above all others. If the golden
fixtures ever need editing during Slices 2–6, the slice is wrong — revert it
rather than adjusting the pin.
