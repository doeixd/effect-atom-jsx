# Platform lane — triaged design questions (`DQ-080`–`DQ-099`)

Scope: the agent-facing catalog (`AGENT_NATIVE_NOTES.md`), result/serialization
unification, identity families, and genuinely cross-cutting decisions.

Triaged 2026-07-30 from `docs/AGENT_NATIVE_NOTES.md` §8/§9,
`docs/RESULT_UNIFICATION_PLAN.md`, `docs/DESIGN_IMPROVEMENT_NOTES.md` item 2,
`docs/af-ui-json-render/`, and the `unbuilt(...)` calls in `future/agent/*` and
`future/result/*`.

## Summary

| ID | Question | Severity | Owning plan |
| --- | --- | --- | --- |
| `DQ-091` | What validates the single-flight boundary, and is the projection shared with loaders? | deferrable | `RESULT_UNIFICATION_PLAN.md` Decision 6 |
| `DQ-092` | What must `Idle` mean if the free wire slot is consumed? | deferrable | `RESULT_UNIFICATION_PLAN.md` §2.5 |
| `DQ-093` | Is `ResultErrorOf`'s `Exclude` dead after the fetch model is deleted? | deferrable | `RESULT_UNIFICATION_PLAN.md` Risk 5 |
| `DQ-094` | Resequence json-render phases, or restate AN-5's dependency? | deferrable | `AGENT_NATIVE_NOTES.md` §9.8 |
| `DQ-095` | Do approvals survive restart, and is the pending queue a standard query? | deferrable | `AGENT_NATIVE_NOTES.md` §8.3 |
| `DQ-096` | Ratify the provisional module and export names. | deferrable | `AGENT_NATIVE_NOTES.md` §9.10 |
| `DQ-097` | Do kit widgets ship *suggested* catalog entries? | deferrable | `AGENT_NATIVE_NOTES.md` §8.2 |
| `DQ-098` | Is A2A / `ask-agent` library, adapter, or userland? | deferrable | `AGENT_NATIVE_NOTES.md` §8.5 |

## Settled context (do not re-open)

Recorded here so triage does not re-litigate two decisions already reached
while reading `DESIGN_IMPROVEMENT_NOTES.md` item 2:

- **Query `cacheKey` is an alias of portable identity, not a fourth identity
  family.** Verified in source: `Portable.cacheKey(descriptor, reactivityKeys)`
  (`src/Portable.ts:356–367`) is a pure function of the descriptor's
  `kind/version/buildId/id` plus encoded captures plus the canonicalized
  (deduped, sorted) reactivity keys. It mints nothing. `Resume.ts:2018–2034`
  derives the query snapshot's `cacheKey` this way rather than carrying an
  independent id on the wire.
- **The `af:` reservation guards *authoring* seams and deliberately does NOT
  block *derivation*.** `cacheKey` legitimately consumes `af:binding:*` keys as
  inputs (see `src/__tests__/resume.test.ts:2457`), so a blanket "no `af:`
  anywhere" rule would break a correct derivation. The reservation is a
  constraint on what an author may *name*, not on what the library may
  *compute*. `DQ-089` is only about breadth and enforcement points.

---












## Decided — promoted into the owning plan

Closed entries stay listed here (never renumbered) so a `DQ-nnn` cited anywhere
still resolves. The decision and its rejected alternatives live in
`AGENT_NATIVE_NOTES.md` §10.

| ID | Decision | Ratified in |
| --- | --- | --- |
| DQ-080 | Two arms: `{ok:true, payload:{mutation, loaders, invalidated}} | {ok:false, error}`. `invalidated` is additive on the existing `SingleFlightPayload`; drift rides **inside** the error arm, not as a third arm. | `AGENT_NATIVE_NOTES.md` §10 |
| DQ-081 | Fail closed — a drifted call never runs — but attach the fresh manifest so host recovery is mechanical. Rejected: degrade-and-proceed, which trades a safety property for convenience. | `AGENT_NATIVE_NOTES.md` §10 |
| DQ-082 | Check at dispatcher **construction**, fail with a typed `GovernanceUnsatisfiedError` (shared, so a per-call check can be added later). Fixes the unmet-service-defect hole under dynamically assembled Layers. | `AGENT_NATIVE_NOTES.md` §10 |
| DQ-083 | Layer-level `onFailure` policy defaulting to **refuse**, with the refusal record itself durable (write-ahead). Not hard-coded: an unoverridable default just gets wrapped around. | `AGENT_NATIVE_NOTES.md` §10 |
| DQ-084 | `Agent.exposeMutation` as a second constructor, so the **type** carries it. Today's only signal — the presence of `reactivityKeys` — is a coincidence, not a declaration. | `AGENT_NATIVE_NOTES.md` §10 |
| DQ-085 | `Agent.secret(schema)` wrapper codec. The M7 secret-name heuristic is **a diagnostic that suggests it, never enforcement**. | `AGENT_NATIVE_NOTES.md` §10 |
| DQ-086 | Order is **authorize → drift → approve**. Authorization outermost so nothing (not even a schema or tool description) is disclosed to an unauthorized caller; drift still precedes the human step. | `AGENT_NATIVE_NOTES.md` §10 |
| DQ-087 | `Agent.catalog` throws at construction when `render:` names a non-addressable component; type-level constraint later once addressability propagates through wrappers. | `AGENT_NATIVE_NOTES.md` §10 |
| DQ-088 | `Schema.Tuple` in core plus an authored `argNames`, so the HTTP/MCP struct projection is declared and checkable rather than positional-only. | `AGENT_NATIVE_NOTES.md` §10 |
| DQ-089 | Export `ReservedIdentityPrefix`/`isReservedIdentityKey`; enforce at **normalization** (the shared seam) so every `af:` family is covered. Derivation stays exempt — `cacheKey` legitimately consumes `af:binding:*`. | `AGENT_NATIVE_NOTES.md` §10 |
| DQ-090 | **No markup-bearing node kind exists** in the spec IR; text carries `value`, never `html`. Makes the security property true by construction rather than by validation. | `AGENT_NATIVE_NOTES.md` §10 |
| DQ-099 | Memo membership is granted **last**, after the graph is deeply frozen, so "validated" implies "immutable" and the decoder-copy dependence is gone. The type is branded; the runtime witness stays a private `WeakSet`. **The literal recommendation — an own `Symbol` brand — was rejected as strictly weaker**, since `Object.getOwnPropertySymbols` makes it forgeable. Per-installation scoping not adopted: three public entry points have no installation, and freeze-before-admit makes the global lifetime inert. | `Resume.ts`; rationale in `future/security/trust-boundary.spec.ts` |



## DQ-091 — What validates the single-flight boundary, and do the loader and mutation channels share one projection?

- **Severity:** deferrable (blocking for the Decision 6 follow-up slice)
- **Owning plan:** `docs/RESULT_UNIFICATION_PLAN.md` Decision 6, Risk 7
- **Raised:** 2026-07-30, triage

**What I was doing.** Separating the proven defect from the design question
behind it.

**What is undecided.** The *defect* is settled and recorded:
`SingleFlightPayload.loaders[].result` is typed `UnknownRouteResult` and crosses
the network via plain `JSON.stringify` / `response.json()`
(`src/Route.ts:2712–2715`), so it is "not projected through `resultToWire` at
all — `exit`/`rawCause` are silently dropped… and the client rehydrates a core
`Result` that is missing its canonical `Exit`" (plan §1.4). Decision 6 fences
the fix out of the unification work, correctly.

What is *not* decided is the target: (a) what validates the boundary on receipt
— schema decode of the declared result wire, or a looser structural check — and
(b) whether the **loader** channel and the **mutation** channel share a single
projection module, or whether `mutation: A` is projected by the entry's own
declared success schema while `loaders[]` goes through `resultToWire`.

**Why it matters.** Router R5 ("validate single-flight wire through
Serialization with declared schemas") and `AGENT_NATIVE_NOTES.md` §3 both assume
one dispatch implementation. If the two channels need different projections,
"one dispatch" is a shared *route*, not a shared *codec* — and the agent
endpoint (`DQ-080`) inherits whichever answer is chosen.

**Options.**

1. **One projection module, both channels** — `resultToWire`/`wireToResult` for
   loaders and a `Result`-wrapped mutation. *Cost:* forces mutations into a
   `Result` envelope they do not currently have; wire change. *Buys:* one codec,
   one validator, one place `exit` can be dropped.
2. **Two projections, one validated boundary** — mutation via the declared
   success/error schemas, loaders via `resultToWire`; both decoded (not
   `JSON.parse`d raw) on receipt. *Cost:* two codecs to keep aligned. *Buys:*
   mutation payloads keep their natural shape, which is what the agent catalog's
   `success:` schema already describes.
3. **Structural check only** — assert tags, don't decode. *Cost:* leaves the
   `exit` fidelity loss the plan already calls a defect. *Buys:* cheapest.

**Recommendation.** Option 2. The catalog already declares per-entry
success/error schemas (§2), so the mutation channel has a better validator
available than a generic `Result` projection; the loader channel genuinely wants
`resultToWire`. Requiring *both* to decode rather than `JSON.parse` is the part
that actually fixes Risk 7.

**What I did in the meantime.** Nothing; Decision 6 holds and this entry records
the target the follow-up slice needs.

**Related.** `DQ-080`, `DQ-092`, Router R5.

---

## DQ-092 — What must `Idle` mean, so the free `Initial{waiting:false}` slot is not accidentally consumed?

- **Severity:** deferrable
- **Owning plan:** `docs/RESULT_UNIFICATION_PLAN.md` §2.5
- **Raised:** 2026-07-30, triage
- **Blocks specs:** `future/result/wire-mapping.spec.ts:259`
  (`unbuilt("Result.idle / Result.isIdle …")`)

**What I was doing.** Triaging the P15 residual.

**What is undecided.** §2.5 establishes that `Initial{ waiting: false }` is
currently unreachable and that `Idle` therefore "costs zero wire version bumps
— it is the existing tag with the existing boolean". Decision 6 fences the
addition. What is undecided is the *semantics*: what `Idle` asserts, and how it
differs from `Loading`. The plan's own mapping table (§2.3, row
`Initial{waiting:false}`) currently decodes that value to `Loading`, which means
the free slot is *already* being consumed by a lossy default.

**Why it matters.** A byte-free slot is a one-time resource. If `Idle` is added
without a written meaning, the first consumer's interpretation becomes the
definition — and the current decode-to-`Loading` mapping actively works against
whatever that meaning turns out to be. `future/result/wire-mapping.spec.ts`
already asserts the distinction it expects: `Idle` is not in-flight, so it must
not be reported as settled *and* must not be confused with `Loading`.

**Options.**

1. **`Idle` = "not started, and not going to start unless asked"** — the state
   of a manual/deferred query before its first trigger. Decode of
   `Initial{waiting:false}` becomes `Idle`, not `Loading`. *Cost:* changes an
   existing decode mapping, so it is a behaviour change (correctly fenced out of
   the unification). *Buys:* the natural meaning, and it makes a real state
   representable that today has to be faked.
2. **`Idle` = "settled with no value"** — a terminal empty. *Cost:* collides
   conceptually with `Success(Option.none)` and with `Stale`; invites
   `isSettled` confusion. *Buys:* little.
3. **Leave the slot unused and document it as reserved.** *Cost:* the manual-query state stays
   unrepresentable. *Buys:* zero risk; the slot stays free
   for a better use.

**Recommendation.** Option 1, and — separately and sooner — write the
"`Initial{waiting:false}` is reserved for `Idle`; do not repurpose" note into
§2.5 so option 3's protection applies until option 1 lands. The current
decode-to-`Loading` row should be flagged as provisional in the plan for the
same reason.

**What I did in the meantime.** `unbuilt(...)` retained; re-point at `DQ-092`.

**Related.** `DQ-091`, `DQ-093`.

**RATIFIED 2026-08-12** (user-approved via TRIAGE-2026-08-12.md): option 1 — `Idle` means "not
started, and not going to start unless asked" (a manual/deferred query before
its first trigger); the decode of `Initial{waiting:false}` becomes `Idle`, as
the wire-versioned change Decision 7 explicitly sanctions. §2.5's
"slot reserved for Idle" note lands with the implementation.

---

## DQ-093 — Is `ResultErrorOf`'s `Exclude<E, { defect: string }>` dead once the fetch model is deleted?

- **Severity:** deferrable
- **Owning plan:** `docs/RESULT_UNIFICATION_PLAN.md` Risk 5
- **Raised:** 2026-07-30, triage

**What I was doing.** Triaging the plan's own named risks for questions rather
than tasks.

**What is undecided.** Per Risk 5, `ResultErrorOf` applies
`Exclude<E, { defect: string }>` "purely to strip the fetch model's untagged
defect arm". After Decision 5 deletes `src/Result.ts`, either reading is
defensible: removing the `Exclude` changes inference for any core atom whose `E`
legitimately contains a `defect: string` member, and keeping it leaves a dead
type operation the next reader must reverse-engineer.

**Why it matters.** It is a public inference surface (`Atom.result`), so getting
it wrong is a silently-changed error type rather than a compile failure at the
library boundary. The plan already prescribes the *method* (decide with a type
test in Slice 4, document the outcome either way) but not the *answer*.

**Options.**

1. **Remove the `Exclude`.** *Cost:* an app whose error type has a
   `defect: string` field now sees that arm in `ResultErrorOf` — arguably
   correct, but a change. *Buys:* no dead type machinery; `E` means `E`.
2. **Keep it, documented as a deliberate exclusion.** *Cost:* a structural
   exclusion that silently eats a legitimate user error shape, forever, for a
   reason that no longer exists. *Buys:* bit-identical inference.
3. **Keep it, narrowed to the branded fetch-defect type.** *Cost:* requires the
   fetch defect to have been branded, which it was not. *Buys:* n/a.

**Recommendation.** Option 1 — remove it, gated on the Slice 4 type test showing
no inference regression in the repo's own type tests. A structural `Exclude`
against an untagged shape is exactly the sort of thing that should not outlive
the model it was written for. This is a small decision; it is here only because
the plan explicitly defers it.

**What I did in the meantime.** Nothing.

**Related.** `DQ-091`, `DQ-092`.

**RATIFIED 2026-08-12** (user-approved via TRIAGE-2026-08-12.md): option 1 — executed 2026-08-12 in
RESULT_UNIFICATION Slice 4: the `Exclude` was removed and the resulting
inference (including a defect-carrying core error type) is pinned in
`type-tests/atom-type-axes.ts`. CLOSED.

---

## DQ-094 — Resequence the json-render phases, or restate AN-5's dependency?

- **Severity:** deferrable
- **Owning plan:** `docs/AGENT_NATIVE_NOTES.md` §9 item 8 /
  `docs/af-ui-json-render/gen-ui-implementation-plan.md`
- **Raised:** 2026-07-30, triage

**What I was doing.** Checking AN-5's stated dependency against the json-render
plan.

**What is undecided.** §7 item 5 makes AN-5 depend on "json-render Phase 1
(typed catalog + spec validator)". Verified in the plan: Phase 1 is
*"Structured Component And Element IR"* — catalog entries, `UiNode`/`UiTextNode`/
`UiFragmentNode`, `ViewTree`, and prop/slot diagnostics — and its "Minimal First
PR Target" says explicitly: *"Do not include state models, actions, resources,
repeats, JSON Render lowering, or AI catalogs in the first PR."* State models,
bindings, conditions and repeats are Phase 2; actions and pointer lowering come
later still. Those are the rules that make agent-emitted output *safe*, so
Phase 1 as written enables nothing agent-facing. It is also a plan for
`../gen2`'s static generator IR (`src/ui/ui.ts`, `src/gen/*`), not for this
repo's runtime modules.

**Why it matters.** AN-5 is the largest piece in the sequence and its stated
dependency is satisfiable without delivering anything AN-5 can use — which is
the kind of mis-scoping that shows up as a surprise mid-milestone.

**Options.**

1. **Restate AN-5's dependency** as "catalog + view tree + the validation rules
   from Phases 2–5 (state model, bindings, actions, pointer lowering)". *Cost:*
   AN-5's prerequisite grows honestly larger. *Buys:* no change to a plan this
   lane does not own; the dependency becomes true.
2. **Resequence json-render** into an agent-facing Phase 1 that pulls the
   safety-relevant rules forward. *Cost:* edits a plan document owned
   elsewhere; the reordered phase is much larger than the current Phase 1, so
   the "small checkable slice" property of that plan degrades. *Buys:* one
   milestone to point at.
3. **Fork a repo-native `ViewSpec` slice** that takes the *ideas* from
   json-render (typed catalog, tree, validator, no markup node — `DQ-090`) but
   is scoped to this repo's runtime primitives from the start. *Cost:* a second
   plan covering overlapping ground. *Buys:* avoids inheriting a static
   generator IR's phase structure for a runtime problem, which is the deeper
   mismatch here.

**Recommendation.** Option 1 immediately (it is a one-line correction to
`AGENT_NATIVE_NOTES.md` §7 and costs nothing), then option 3 when AN-5 is
actually scheduled. The json-render docs are the best available design input but
they are a plan for a different codebase; treating them as a *reference* rather
than as AN-5's literal dependency is the accurate framing.

**What I did in the meantime.** Nothing; recorded as a correction to make.

**Related.** `DQ-090`, `DQ-096`.

**RATIFIED 2026-08-17** (user-delegated via TRIAGE-2026-08-17-ratification.md):
option 1 executed (§7 item 5 restated; `docs/af-ui-json-render/` demoted to
reference input) with option 3 as AN-5's build shape — the repo-native slice
`future/agent/generative-view-spec.spec.ts` pins. The naming DQ-096 deferred
is closed by the same decision: `src/ViewSpec.ts` (core namespace module) and
`src/view-spec-json-render.ts` (core internal projection).

---

## DQ-095 — Do pending approvals survive a server restart, and is the pending-approval queue itself a standard loader/query?

- **Severity:** deferrable
- **Owning plan:** `docs/AGENT_NATIVE_NOTES.md` §8 open question 3
- **Raised:** 2026-07-30, triage
- **Blocks specs:** `future/agent/governance.spec.ts:417`
  (`unbuilt("pending-approval queue as a standard query + approval durability across restart")`)

**What I was doing.** Triaging the approval UX contract.

**What is undecided.** Two coupled sub-questions. (a) §5 implements agent-surface
approval as "a Deferred resolved by an approval UI"; an in-memory `Deferred` dies
with the process, so a pending approval is silently lost on restart — which
§8.3 notes needs a *durable* Deferred and pairs with M11 streaming sessions.
(b) Whether the pending-approval queue is exposed as a normal loader/query, so
any app renders it with ordinary components, or whether it is an adapter-private
structure.

**Why it matters.** (a) is a correctness question with a security flavour: on
restart, does a pending mutation resolve as denied (fail-closed) or simply
vanish, leaving the agent hanging? (b) determines whether approval UIs are
userland components or framework surface — and (b) is cheap to get right and
expensive to retrofit.

**Options.**

1. **In-memory `Deferred`; restart denies all pending approvals; queue is a
   standard query.** *Cost:* an agent mid-approval gets a denial it must retry.
   *Buys:* no durability infrastructure; fail-closed is preserved; the queue is
   renderable by any app with existing primitives.
2. **Durable approvals backed by the M11 session store.** *Cost:* requires M11
   streaming sessions, i.e. AN-1 governance now depends on a later milestone.
   *Buys:* long-lived human approvals (hours, not seconds) actually work.
3. **Pluggable `ApprovalStore` layer**, in-memory default, durable
   implementation later. *Cost:* one more service. *Buys:* AN-1 ships without
   M11, and durability arrives as a layer swap — the same grammar the rest of
   governance uses.

**Recommendation.** Option 3, with the in-memory default specified to **deny**
pending approvals on restart (never silently drop), and the pending queue
exposed as a standard query so approval UIs are ordinary components. That
answers (b) now and defers only the storage of (a).

**What I did in the meantime.** `unbuilt(...)` retained; re-point at `DQ-095`.

**Related.** `DQ-082`, `DQ-083`, `DQ-096`.

**RATIFIED 2026-08-17** (user-delegated via TRIAGE-2026-08-17-ratification.md):
option 3 — pluggable `ApprovalStore` layer, in-memory default, with the two
contract points fixed: restart resolves pending approvals as a typed denial
(fail-closed, never a silent drop), and the pending queue is a standard query
so approval UIs are ordinary components. Durable storage is a later layer
swap.

---

## DQ-096 — Ratify (or replace) the provisional module and export names invented while spec-writing

- **Severity:** deferrable
- **Owning plan:** `docs/AGENT_NATIVE_NOTES.md` §9 item 10
- **Raised:** 2026-07-30, triage
- **Blocks specs:** all of `future/agent/*.spec.ts` and
  `future/result/identity-families.spec.ts` import from these paths

**What I was doing.** Collecting every declared-provisional naming pick into one
entry rather than fifteen, per the README's "a provisional pick that isn't
declared is the worst outcome" rule.

**What is undecided.** None of these exist in source — verified: `src/Agent.ts`,
`src/ViewSpec.ts`, `src/reactivity-push.ts`, `src/agent-mcp.ts`,
`src/view-spec-json-render.ts` are all absent. The specs nonetheless import
from them, so the names are load-bearing for the red specs and will become canon
by inertia if not ratified. The full provisional set:

- `src/Agent.ts` — `catalog`, `expose`, `dispatch`, `singleFlightHandler`,
  `toolManifest`, `audited`, `secret`, `renderResult`, `renderResultFragment`,
  `emitViewSpec`, `dispatchCacheKey`, `uiLayer` / `agentLayer`, and the services
  `CallerContext`, `Approval`, `Authorizer`, `AuditLog`.
- `src/reactivity-push.ts` — `makeReactivityBroadcast`,
  `applyPushedInvalidation`.
- `src/agent-mcp.ts` — `mcpTools`, `mcpServer`, `McpAuth`.
- `src/ViewSpec.ts` + `src/view-spec-json-render.ts`.
- `src/resume-handle.ts` (existing file) — `ReservedIdentityPrefix`,
  `isReservedIdentityKey` (see `DQ-089`).

Also noted by §9.10: M11b's fragment handle needs `activate` / `dispose` /
`disposeCount` / `isActive` exposed, which its own plan may not currently
include — that part belongs to the resumability lane, flagged here only because
`renderResultFragment` depends on it.

**Why it matters.** Nothing breaks today, but these freeze into the public
surface the moment AN-1 lands, and several are cross-cutting (`uiLayer` /
`agentLayer` are layer names every app writes; `Agent.secret` is the redaction
API from `DQ-085`).

**Options.**

1. **Ratify as-is.** *Cost:* accepts a naming set chosen for spec convenience.
   *Buys:* specs compile against the intended target with no churn; the names
   are consistent with existing conventions (`PascalCase.ts` namespace modules,
   `kebab-case.ts` internals — which these already follow).
2. **Rename during AN-1 implementation.** *Cost:* touches every spec. *Buys:* a
   naming review with implementation knowledge.
3. **Consolidate** — e.g. fold `agent-mcp.ts` into an `@affe/agent` adapter
   package per §6, and fold `view-spec-json-render.ts` into `ViewSpec.ts`.
   *Cost:* package boundary decision pulled earlier. *Buys:* fewer top-level
   modules; matches §6's stated library boundary.

**Recommendation.** Ratify option 1 for `src/Agent.ts` and
`src/reactivity-push.ts` (they are inside §6's stated library boundary and
follow existing file conventions), and apply option 3 to `src/agent-mcp.ts` —
§6 already says MCP is a "small `@affe/agent` adapter package", so a `src/`
module contradicts the plan. Defer `ViewSpec.ts` naming until `DQ-090` and
`DQ-094` settle the IR.

**What I did in the meantime.** This entry *is* the declaration; the picks are
recorded as provisional, not adopted.

**Related.** `DQ-085`, `DQ-089`, `DQ-090`, `DQ-094`.

**RATIFIED 2026-08-12** (user-approved via TRIAGE-2026-08-12.md): as recommended — `src/Agent.ts`
and `src/reactivity-push.ts` adopted as-is with their listed exports;
`agent-mcp` folds into the `@affe/agent` adapter package (no `src/` module);
`ViewSpec.ts`/`view-spec-json-render.ts` naming stays deferred behind
`DQ-090`/`DQ-094`.

---

## DQ-097 — Do kit widgets ship *suggested* catalog entries, and who owns their exposure defaults?

- **Severity:** deferrable
- **Owning plan:** `docs/AGENT_NATIVE_NOTES.md` §8 open question 2
- **Raised:** 2026-07-30, triage
- **Blocks specs:** `future/agent/result-rendering.spec.ts:203`
  (`unbuilt("kit-shipped suggested catalog entries and who owns their exposure defaults")`)

**What I was doing.** Triaging the catalog-ownership question.

**What is undecided.** Whether the catalog is strictly per-app, or whether kit
widgets ship suggested entries (a form widget exposing its submit action). The
harder half is the one the spec names: if a kit ships an entry, **who owns its
`access:` defaults** — the kit author, who does not know the app's threat model,
or the app, in which case the "suggestion" is only a schema fragment.

**Why it matters.** A kit-shipped entry with `agent: true` by default is a
library that opens attack surface on upgrade. §6 already rules out directory
auto-discovery for exactly this reason ("explicit catalog values are the point").

**Options.**

1. **App-only catalogs.** Kits ship portable code; the app exposes it. *Cost:*
   boilerplate per widget. *Buys:* exposure is always an app decision; no
   library upgrade can widen the agent surface.
2. **Kits ship entries with exposure omitted** — description, args, success,
   `render:` and `reactivityKeys` provided; `access:` mandatory at the app.
   *Cost:* a partial-entry type distinct from a complete one. *Buys:* removes
   the boilerplate that is genuinely mechanical while keeping the decision with
   the app.
3. **Kits ship complete entries with safe defaults** (`agent: false`). *Cost:*
   a default that must never regress, across every kit, forever. *Buys:*
   zero-config exposure for the impatient.

**Recommendation.** Option 2. It matches §6's explicit-catalog rule while
admitting that description/args/success schemas are the tedious part and are
genuinely kit knowledge. Consistent with `DQ-084`'s reasoning: exposure and
mutation are declarations, not defaults.

**What I did in the meantime.** `unbuilt(...)` retained; re-point at `DQ-097`.

**Related.** `DQ-084`, `DQ-087`.

**RATIFIED 2026-08-17** (user-delegated via TRIAGE-2026-08-17-ratification.md):
option 2 — kits ship suggestions with no `access` field representable; the
app completes them via `expose`/`exposeMutation({ access })`. Exposure and
the `DQ-084` mutation declaration remain app decisions; option 3's safe
default was rejected as a hope, not a guarantee.

---

## DQ-098 — Is A2A / `ask-agent` library scope, adapter scope, or userland?

- **Severity:** deferrable
- **Owning plan:** `docs/AGENT_NATIVE_NOTES.md` §8 open question 5
- **Raised:** 2026-07-30, triage
- **Blocks specs:** `future/agent/mcp-projection.spec.ts:214`
  (`unbuilt("A2A / ask-agent bridge surface (in @affe/agent or out of scope)")`)

**What I was doing.** Triaging the remaining §8 question.

**What is undecided.** §1's table already says `ask-agent` is "out of scope for
the UI library; an app-level action like any other", while §8.5 re-opens it as
"explicitly out of library scope, or does `@affe/agent` ship an optional bridge
once someone needs it?". So the two sections disagree by degree, not substance.

**Why it matters.** Very little today — this genuinely does not block anything.
It matters only as a boundary statement, because an unanswered "maybe later"
invites a bridge to land in `src/` rather than in an adapter.

**Options.**

1. **Userland, permanently.** *Cost:* every app that wants agent delegation
   writes it. *Buys:* the library boundary in §6 stays exactly as stated.
2. **Optional `@affe/agent` bridge, when demanded.** *Cost:* an adapter package
   grows a feature with no current user. *Buys:* a sanctioned home if the demand
   arrives, keeping it out of `src/`.
3. **Library scope.** *Cost:* an agent loop in a UI library — explicitly listed
   under §6 "what NOT to build". *Buys:* nothing.

**Recommendation.** Option 1 with option 2 named as the escape hatch: resolve
§8.5 by deleting it in favour of §1's already-stated answer, adding one sentence
that if a bridge is ever built it belongs in `@affe/agent`, never in `src/`.
This is close to already-decided; it is here only because two sections disagree.

**What I did in the meantime.** `unbuilt(...)` retained; re-point at `DQ-098`.

**Related.** `DQ-096`.

**RATIFIED 2026-08-17** (user-delegated via TRIAGE-2026-08-17-ratification.md):
option 1 with option 2 as the named escape hatch — §8.5 resolved in favour of
§1's answer (userland; an app-level action like any other), with the boundary
sentence recorded: an A2A bridge, if ever built, lives in `@affe/agent`,
never in `src/`.
</content>
</invoke>
