# Agent-Native Capabilities From Existing Affe Primitives

Date: 2026-07-30
Status: design exploration / gap analysis. No implementation scheduled.
Reference: https://www.agent-native.com/docs (actions, generative-ui, mcp-protocol pages reviewed 2026-07-30).

## 0. Thesis

Agent-Native's core promise — *the AI agent and the UI share the same actions,
data, and application state* — is something Affe is already structurally built
for, and in several places built **better** for. Their framework achieves it by
convention (an `actions/` directory auto-mounted on six surfaces); we achieve
it by construction: `Portable.code` already makes every action an addressable,
schema-described, build-versioned, typed value, and reactivity keys already
make every data dependency a semantic, serializable identity. The gap is not
new primitives — it is one thin **surface layer** that projects what we already
have onto agent-facing protocols, plus a handful of Effect services for caller
context and governance.

The design rule for everything below: **the agent is just another caller.**
No parallel action system, no untyped registry, no second data path. Every
agent capability is a projection of an existing typed value, and every
agent-facing behavior difference is a `Layer` swap, not a code fork.

## 1. Feature-by-feature mapping

| Agent-Native feature | Their mechanism | Our existing primitive | Gap |
| --- | --- | --- | --- |
| One action, many surfaces (agent/UI/HTTP/CLI/MCP/A2A) | `defineAction` + directory auto-discovery | `Portable.code({id, buildId, captures: Schema, run})` + `Portable.bind`; `Component.action(boundCode)`; ServerRoute pure-data dispatch | A catalog value + one dispatch endpoint |
| Typed input validation before run | Zod/Standard Schema | Effect `Schema` on captures and args; decode is already the wire boundary | None — stronger (codecs, branded types, typed errors) |
| Output validation w/ strategies | `outputSchema` + warn/strict/fallback | Success/error schemas on portable descriptors; TaggedError classes | Declare success schema on the catalog entry |
| Caller identity ctx (`userEmail`, `caller`, `orgId`, abort, audit lineage) | 2nd arg to `run` | The `R` channel. A `CallerContext` service provided per-request as a Layer; interruption is native | Define the service + per-surface layers |
| `authorize` guard on every dispatch path | option on defineAction | Requirements: an action that needs authorization *requires* an `Authorizer` service; dispatch layers provide it | Define service + middleware combinator |
| `needsApproval` human sign-off | pauses agent loop | An `Approval` service in `R`: agent-surface layer implements it as a Deferred the human resolves; UI-surface layer auto-approves. The type system *forces* the decision per surface | Define service + layers |
| Audit log w/ scrubbed inputs | automatic for mutating actions | A middleware Layer around dispatch; captures/args are already schema-encoded so scrubbing is schema-driven (redact annotations) | Middleware + `Schema` redaction annotation |
| Live sync (mutation → query refresh) | `source:"action"` change events | Reactivity keys. `Component.action({reactivityKeys})` already invalidates `Component.query` atoms; single-flight already merges mutation + revalidated loaders in one round trip | Server-push Reactivity layer so *agent-initiated* invalidations reach connected clients (already contemplated: Reactivity is a service with swappable layers) |
| Chat rendering of results (`chatUI.renderer`) | named renderer registry + widget schemas | `Resume.addressable` components + (M11b) `Resume.mountFragment` server fragments; json-render catalog proposal | Associate a component/portable id with an action's success schema |
| Generative UI (agent-written HTML in sandboxed iframe, Alpine+Tailwind) | runtime HTML + bridge allowlist | Strictly dominated by our model: json-render spec validated against a **typed catalog**, rendered dormant (zero JS) with typed activation; `SafeHtml` branding; no iframe needed for the common case | json-render Phase 1 (catalog + tree) + a validator |
| MCP server (`/mcp`, actions as tools, OAuth) | auto-mounted | Catalog → MCP tools is a pure projection: Effect Schema emits JSON Schema; descriptions live on catalog entries | Small `@affe/agent` adapter package |
| `ask-agent` meta-tool | delegates to agent loop | Out of scope for the UI library; an app-level action like any other | None (app concern) |
| SQL as shared state | built-in SQLite/Postgres | Deliberately out of scope; loaders/queries are the data boundary and are already typed + revalidated | None (app concern) |

## 2. The one new concept: `Agent.catalog`

Everything funnels through a single new value — a typed catalog of exposed
operations. Sketch (names provisional):

```ts
const SaveTodo = Portable.code({
  id: "todo.save", buildId,
  captures: Schema.Struct({ listId: Schema.String }),
  run: (captures, todo: TodoInput) => Effect.gen(function* () { ... }),
})

const catalog = Agent.catalog({
  saveTodo: Agent.expose(SaveTodo, {
    description: "Save a todo item to the given list",
    args: Schema.Tuple([TodoInput]),         // wire schema for args (Tuple takes an array)
    success: Todo,                           // output schema (their outputSchema)
    reactivityKeys: ["todos"],               // invalidation on success
    render: TodoCard,                        // optional: addressable component for result rendering
    access: { agent: true, http: true, approval: "mutate" },  // exposure flags
  }),
  // ...
})
```

Properties this buys, all statically:

- **Tool manifest for free.** `Schema` → JSON Schema gives the MCP/HTTP tool
  description. `Portable`'s `id`/`buildId` give stable tool identity and a
  deployment-drift guard no convention-based framework has (their actions can
  silently change shape between deploys; ours fail closed on build mismatch —
  same mechanism resumability already uses).
- **Requirements surface in the type.** `Agent.CatalogRequirements<typeof catalog>`
  is the union of every entry's `R`. A dispatch endpoint cannot be constructed
  without providing `CallerContext`, `Authorizer`, `Approval`, `Reactivity`,
  etc. Their `authorize`/`needsApproval` are runtime flags; ours are unmet
  requirements — a compile error, not a 3am incident.
- **Errors are typed on the wire.** TaggedError schemas serialize through the
  existing Serialization/result-wire layer, so an agent tool call failing
  returns a discriminated error, not a string.
- **Same executable everywhere.** `Component.action(Portable.bind(SaveTodo, {...}))`
  in the UI, `catalog` dispatch for the agent — literally the same `run`, the
  same reactivity keys, the same audit middleware. The "shared actions" promise
  is an identity, not a discipline.

## 3. Dispatch: reuse the single-flight spine

The HTTP/MCP endpoint is a thin server route:

```
POST /_affe/actions/:id   →  decode args via catalog schema
                          →  provide per-request Layer (CallerContext, scoped LoaderCache — R2 gave us this)
                          →  Effect.provide(entry.run)
                          →  encode success/error via catalog schemas
                          →  broadcast reactivity invalidations
```

This is the same shape as the existing single-flight mutation path; Router R5's
"validate single-flight wire through Serialization with declared schemas" and
this endpoint should be **one** dispatch implementation. The response can even
reuse the single-flight payload shape (`{mutation, loaders}`) so an agent
mutation returns revalidated loader data exactly like a UI mutation does.

**Live sync across callers** is the only genuinely new runtime behavior: when
the agent invalidates `["todos"]` server-side, connected browsers must hear it.
That is precisely the "server-push invalidation layer" already planned for the
Reactivity service (one key vocabulary across actions/loaders/queries — ratified
in M8). Transport can start as SSE; the client side is just
`Atom.invalidateReactivity(keys)` on message receipt. No component changes.

## 4. Result rendering: dominate, don't imitate

Their two rendering tiers map to things we do more safely:

1. **`chatUI.renderer` (typed widgets)** → an action's catalog entry names an
   addressable component (`render: TodoCard`). A chat host renders the result by
   either (a) client-side: mounting the component with the decoded success value
   as props — schema-validated by `withActivation`'s props descriptors, which
   exist today — or (b) server-side: `Resume.mountFragment` (M11b) returning
   `{html, manifest}` for a **dormant, zero-JS** widget that activates lazily.
   Dormancy is a genuinely better chat-widget story than their iframe: no
   sandbox bridge, no Alpine runtime, typed events, exact-once activation.
2. **Generative UI (agent-authored)** → this is the json-render proposal's
   exact use case: the agent emits a *spec* validated against a typed catalog
   (components, slots, allowed actions, state paths), never raw HTML/JS.
   Their own docs warn about secrets in generated HTML; a validated spec cannot
   express that failure mode. json-render Phase 1 (catalog entries + view tree
   + validator) is the enabling slice; the sandbox-iframe tier remains available
   as an escape hatch but stops being the foundation.

## 5. Governance as Layers (their flags, our services)

```ts
class CallerContext extends Context.Key<CallerContext, {
  readonly caller: "ui" | "agent" | "http" | "cli" | "mcp" | "automation"
  readonly user: Option<UserId>
  readonly lineage: Option<{ threadId: string; runId: string }>
}>()("affe/agent/CallerContext") {}

class Approval extends Context.Key<Approval, {
  readonly require: (summary: string) => Effect<void, ApprovalDeniedError>
}>()("affe/agent/Approval") {}
```

- UI dispatch layer: `Approval.autoApprove` (the human already clicked).
- Agent dispatch layer: `Approval.human` (Deferred resolved by an approval UI —
  which is itself just a component reading a query).
- Audit: `Agent.audited(catalog)` wraps every entry's Effect with a middleware
  that logs `CallerContext` + schema-scrubbed args (a `Redacted`/annotation-driven
  scrub, reusing the M7 capture-diagnostic pattern of flagging secret-prone names).
- Row-level scoping (`accessFilter`): app concern, but composes naturally —
  the action's `run` requires an app-defined `AccessPolicy` service.

Nothing here is a framework feature; it is all "requirements + layers," which
is why the extensibility story is automatic: an app adds surfaces (Slack, cron,
voice) by writing a new layer stack around the same catalog, and third parties
extend governance by wrapping catalog entries — the same wrap/replace/compose
grammar the kit uses for behaviors.

## 6. What NOT to build

- No SQL layer, no auth provider, no chat UI, no agent loop — app/adapter
  territory (`@affe/agent` adapter package, or userland). The library boundary
  is: catalog, dispatch, governance services, reactivity push, render mapping.
- No directory auto-discovery magic. Explicit catalog values are the point —
  they are inspectable, tree-shakeable, and type-checked. (The M7 Vite plugin's
  `onCode` hook can *assist* by aggregating extracted portable code into a
  suggested catalog, but the exported value stays authored.)
- No second identity family. Tool ids ARE portable code ids; invalidation ids
  ARE reactivity keys; render targets ARE addressable component/activation ids.
  (This extends DESIGN_IMPROVEMENT_NOTES item 2's identity-unification rule.)

## 7. Sequencing (all post-current-work; smallest first)

1. **AN-1 Catalog + HTTP dispatch** — `Agent.catalog`/`Agent.expose`, JSON
   Schema projection, one endpoint reusing single-flight dispatch + per-request
   layers. Depends on: Router R2 (landed) and R5 wire hygiene (natural pairing).
2. **AN-2 Server-push Reactivity layer** — SSE broadcast + client subscription;
   closes the live-sync loop for agent-initiated mutations. Independent of AN-1.
3. **AN-3 MCP projection** — `@affe/agent` mounts the catalog as an MCP server
   (tools from schemas; auth pluggable). Pure adapter over AN-1.
4. **AN-4 Result rendering** — `render:` on catalog entries; client mount path
   first (props descriptors exist), `mountFragment` path after M11b.
5. **AN-5 Generative UI** — json-render Phase 1 (typed catalog + spec validator)
   consumed by an agent emit-spec action. The largest piece; already has its own
   plan in docs/af-ui-json-render/.
6. Governance services (CallerContext/Approval/audit middleware) land inside
   AN-1 as its requirement set.

## 8. Open questions

1. Args wire shape: single Schema.Struct payload (their style) vs Schema.Tuple
   matching `Portable` arg tuples. Leaning tuple-in-core, struct-in-HTTP-adapter.
2. Does the catalog live per-app only, or do kit widgets ship *suggested*
   catalog entries (e.g. a form widget exposing its submit action)?
3. Approval UX contract: is the pending-approval queue itself a standard
   loader/query (so any app can render it), and does an approval survive a
   server restart (needs durable Deferred — pairs with M11 streaming sessions?).
4. Should `buildId` mismatch on an agent tool call hard-fail (resume policy) or
   degrade to a re-described tool list push to the host?
5. A2A/`ask-agent`: explicitly out of library scope, or does `@affe/agent`
   ship an optional bridge once someone needs it?

## 9. Specification feedback (2026-07-30)

Writing the `future/agent/` specs against this design surfaced gaps. Recorded
here because they are decisions the design owes, not implementation details.
Several must be settled **before** AN-1 rather than during it.

1. **The dispatch response type is undecided, and open question 4 is not a
   toggle.** §3 says reuse single-flight's `{mutation, loaders}` envelope, but
   that shape has no slot for *which reactivity keys were invalidated* (AN-2
   needs it) and no arm for the "re-describe the tool list" answer to Q4. So Q4
   changes the response *union* every host must branch on. Provisional shape used
   by the specs: `{ok: true, payload: {mutation, loaders, invalidated}} | {ok: false, error}`.
2. **"Governance is a compile error, not a runtime flag" is only half true.** A
   missing `Approval` layer is a type error, so at runtime it manifests as an
   unmet-service *defect* — meaning a dynamically assembled Layer (HTTP adapter,
   plugin) fails as a defect rather than a typed refusal. If fail-closed must
   survive dynamic assembly, add a runtime governance-unsatisfied error beside
   the type guarantee.
3. **Audit-sink failure is unspecified, and that is a security hole.** If the
   sink is down, is the mutation refused or does it proceed unaudited? The specs
   assume fail-closed; if best-effort is intended, then "every mutating dispatch
   is audited" is false precisely when it matters.
4. **There is no mutation declaration.** §5 audits "mutating actions", but the
   only current signal is the presence of `reactivityKeys` — a coincidence, not a
   declaration. Add an explicit `mutate` flag to `access:`.
5. **Redaction has no named mechanism.** §1 says "redact annotations", §5 says
   "`Redacted`/annotation-driven" — those are different designs (wrapper codec vs
   field annotation). Specs assume `Agent.secret(schema)`. The M7 secret-name
   heuristic cannot be both a diagnostic and an enforcement point without a
   decision.
6. **Drift-guard vs governance ordering is observable and undecided.** Specs
   assume drift check first, so a human is never asked to approve a call that is
   about to be rejected for build mismatch.
7. **`render:` needs an authoring-time refusal.** If the named component is not
   addressable there is no props descriptor to validate against, and the failure
   would only surface when a chat host renders. `Agent.catalog` should throw at
   construction.
8. **AN-5's dependency on "json-render Phase 1" is mis-scoped.** Those docs
   describe gen2's static generator IR, and their Phase 1 explicitly defers state
   models, bindings, actions, and pointer lowering to Phases 2–5 — i.e. all four
   rules that make agent output *safe*. A Phase 1 without them enables nothing
   agent-facing. Either resequence the json-render phases or restate AN-5's
   dependency as "catalog + tree + the validation rules from Phases 2–5".
9. **Adopt IR-expressiveness over a diagnostic for the security claim.** Rather
   than a `ui:raw-html-unsupported` diagnostic, the spec IR should have **no
   `ui.html` node kind at all**, so raw HTML/script is rejected at the schema
   boundary and text nodes carry `value`, never `html`. Strictly stronger than a
   check, and it is what makes "a validated spec cannot express the secret-leak
   failure mode" true by construction.
10. **Module/name choices awaiting ratification** (used by the specs):
    `src/Agent.ts` (`catalog`, `expose`, `dispatch`, `singleFlightHandler`,
    `toolManifest`, `audited`, `secret`, `renderResult`, `renderResultFragment`,
    `emitViewSpec`, `dispatchCacheKey`, `uiLayer`/`agentLayer`, plus
    `CallerContext`/`Approval`/`Authorizer`/`AuditLog`), `src/reactivity-push.ts`
    (`makeReactivityBroadcast`, `applyPushedInvalidation`), `src/agent-mcp.ts`
    (`mcpTools`, `mcpServer`, `McpAuth`), `src/ViewSpec.ts` +
    `src/view-spec-json-render.ts`. Note M11b's fragment handle needs
    `activate`/`dispose`/`disposeCount`/`isActive` exposed, which its plan may
    not currently include.

## 10. Ratified decisions (2026-07-30) — AN-1 is unblocked

Closing `DQ-080`–`DQ-090`. These settle §8's open questions and §9's owed
decisions; the entries are retired from `docs/design-questions/platform.md`.

**Dispatch envelope (`DQ-080`).** Two arms:

```ts
{ ok: true;  payload: { mutation, loaders, invalidated } }
| { ok: false; error }
```

`invalidated` is **additive** on the existing `SingleFlightPayload` (which
already exists at `src/Route.ts:323–351`), so §3's "one dispatch implementation"
survives, and AN-2 gets the key list it needs. Drift is carried as a *typed
tagged error inside the `ok: false` arm*, not as a third arm — which is what
keeps `DQ-081` a payload choice rather than a change every host must branch on.
Adding `invalidated` is a wire change: sequence it with
`RESULT_UNIFICATION_PLAN.md`'s byte pin.

**Build drift fails closed, but usefully (`DQ-081`).** A drifted call **never
runs**, and the failure carries the fresh manifest so the host's recovery is
mechanical. Rejected: degrading to "re-describe the tool list and proceed" —
that converts a safety property into a convenience.

**Governance is checked at construction, with a typed error (`DQ-082`).** My §9.2
correction stands but resolves cleanly: a missing `Approval` layer is a *type*
error, so under a dynamically assembled Layer it would otherwise surface as an
unmet-service **defect**. Decision: check at dispatcher construction and fail with
a typed `GovernanceUnsatisfiedError`. The requirement is already declarative on
the entry (`access: { approval: … }`), so the runtime witness is nearly free, and
construction-time failure is what "fail closed" actually means. Share the error
type so a per-call runtime check can be added later without inventing a second one.

**Audit-sink failure is a policy with a safe default (`DQ-083`).** A layer-level
`onFailure` policy defaulting to **`refuse`**, with the record of the refusal
itself durable (write-ahead, then run). Deliberately *not* a hard-coded refusal:
a single default that cannot be overridden just gets bypassed by apps wrapping
the middleware, which is strictly worse than an explicit knob.

**Mutation is declared by the constructor (`DQ-084`).** `Agent.exposeMutation`
alongside `Agent.expose`, so the **type** carries the distinction — matching this
design's governance-as-requirements pattern rather than a boolean the middleware
must trust. Today the only signal is the presence of `reactivityKeys`, which is a
coincidence, not a declaration.

**Redaction is structural (`DQ-085`).** `Agent.secret(schema)` as a wrapper
codec. The M7 secret-name heuristic stays **strictly a diagnostic** that
*suggests* `Agent.secret(...)` — never an enforcement point. Enforcement by name
is the one combination §9.5 correctly flagged as needing a decision; it is hereby
decided as "diagnostic, never enforcement".

**Guard order: authorize → drift → approve (`DQ-086`).** This refines the specs'
drift-first assumption rather than contradicting it — the assumption's real
content was *drift before the human step*, which this preserves. Authorization
moves outermost for a reason worth stating: **nothing, including a schema or a
tool description, should be disclosed to an unauthorized caller.**

**`render:` is validated at catalog construction (`DQ-087`).** Naming a
non-addressable component throws when the catalog is built. Otherwise there is no
props descriptor to validate against and the failure surfaces only when a chat
host tries to render. Tighten to a type-level constraint once addressability
metadata propagates reliably through wrappers.

**Args are a tuple in core, a struct at the edge (`DQ-088`).** `Schema.Tuple` in
core (matching `Portable`'s arg tuples) plus an authored `argNames` on the entry,
so the HTTP/MCP struct projection is **declared and checkable** rather than
positional-only. Revisit if authored arg names prove noisy in practice.

**The `af:` reservation is broad and enforced at normalization (`DQ-089`).**
Export `ReservedIdentityPrefix` and `isReservedIdentityKey`; `Key.make("af:…")`
throws, and `normalizeReactivityKeys` rejects reserved input. Normalization is
provably the shared seam, so enforcing there covers every family
(`af:binding:`/`af:expr:`/`af:component:`) rather than today's single check.
Keep the expression-path diagnostic so *that* failure message stays specific.
Unchanged and deliberate: **derivation is exempt** — `cacheKey` legitimately
consumes `af:binding:*` keys.

**The spec IR has no markup-bearing node kind (`DQ-090`).** Adopted as an
explicit written IR design rule: *there is no `ui.html` node kind; text nodes
carry `value`, never `html`.* This makes "a validated spec cannot express the
secret-leak failure mode" true **by construction** rather than by validation —
raw HTML is rejected at the schema boundary because it is unrepresentable, not
because a check caught it. Write the rule into whatever document owns `ViewSpec`
so a later contributor cannot add the kind without contradicting it. The
sandboxed-iframe tier remains available as an escape hatch *outside* the IR.

### §10 corrections (2026-07-30, found while making the specs assert these decisions)

Writing the ratified decisions out as executable specs surfaced four problems
with §10 itself. Recorded here rather than silently edited above, because the
reasoning matters.

**1. `DQ-086` contradicts a shipped spec — my "refines rather than contradicts"
was half wrong.** `build-drift.spec.ts` asserted that a drifted call consults
*neither* authorizer nor approver (`staleConsulted === []`). Under
authorize → drift → approve the authorizer **does** run first. So the claim holds
for the *approval* half (drift still precedes the human step) but the
**authorization half was genuinely inverted**, not refined. The spec now asserts
`["authorize"]` with no approval.

**2. `DQ-081` and `DQ-086` are in tension, and only ordering makes it safe.**
The fresh manifest attached to a drift refusal — tool ids, descriptions,
buildIds — *is exactly the disclosure* `DQ-086` forbids to an unauthorized
caller. It is safe **only because authorization is outermost**.

This has a consequence `DQ-082` must honour: when the per-call runtime governance
check is added later, **it must run before the drift check**. Otherwise a caller
that the construction-time check could not classify receives the manifest. Treat
"authorize outermost" as a security invariant of the dispatch pipeline, not as an
ordering preference.

**3. `DQ-084` left a second mutation signal in place.** §2's sketch has
`access: { approval: "mutate" }` — a flag whose *value* names mutation — sitting
beside a constructor that now carries the same fact in the type. Two signals,
one of which the middleware "must trust", is precisely what `DQ-084` set out to
remove. Fix: rename the flag's values (`approval: "always" | "required"`) or
derive it from the constructor. Do this when AN-1 is implemented.

**4. "`invalidated` is purely additive" is not quite true.**
`SingleFlightPayload` (`src/Route.ts:323–351`) carries a **required**
`url: string` naming the route branch to revalidate — and an agent or MCP
dispatch has no URL. So reusing the envelope means either agent dispatch
synthesizes a `url`, or `url` becomes optional, which is a wire change on the
**single-flight** side rather than a purely additive one. `DQ-080`'s "sequence
this with the byte pin" note must cover `url`, not just `invalidated`.
