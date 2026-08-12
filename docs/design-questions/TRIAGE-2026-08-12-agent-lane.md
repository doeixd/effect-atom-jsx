# Agent-lane triage — 2026-08-12

Scope: the 71 red specs across `future/agent/` (57) and `future/security/`
(14), graded before construction begins. Sources: `AGENT_NATIVE_NOTES.md`
(§10 ratified DQ-080–090 and declares **"AN-1 is unblocked"**), the
`DQ-091–098` entries in `platform.md`, the ratified `DQ-096` naming set, the
`docs/af-ui-json-render/` reference plan, and a per-test inventory of every
`fromSrc` requirement in the specs.

## Verdict in one line

The lane's design core is **fully ratified** (DQ-080–090 + DQ-096 naming);
roughly 50 of the 71 reds are buildable now with zero design decisions, and
the four genuinely open questions (DQ-094/095/097/098) all carry recorded
recommendations and block only 4 placeholder specs.

## Grade A — ratified, buildable now

1. **AN-1: `src/Agent.ts`** (name ratified as-is by DQ-096). The full export
   set the specs pin: `catalog`, `expose`, `exposeMutation`, `dispatch`,
   `toolManifest`, `structArgs`, `singleFlightHandler`, `makeDispatcher`,
   `dispatchCacheKey`, `audited`, `secret`, `isMutation`,
   `catalogDiagnostics`, `renderResult`, `renderResultFragment`,
   `emitViewSpec` (last three are AN-4/AN-5), `uiLayer`, `agentLayer`,
   services `CallerContext`/`Approval`/`Authorizer`/`AuditLog`, errors
   `GovernanceUnsatisfiedError`/`ApprovalDeniedError`/
   `AuthorizationDeniedError`/`AgentArgsDecodeError`/
   `AgentToolNotFoundError`/`AgentErrorEncodeError`/`AgentRenderPropsError`/
   `AuditSinkUnavailable`. Semantics are all decided: two-arm envelope with
   additive `invalidated` (DQ-080), fail-closed drift carrying the fresh
   manifest (DQ-081), construction-time governance check (DQ-082),
   audit-sink refuse-by-default with write-ahead refusal records (DQ-083),
   constructor-declared mutation (DQ-084), `Agent.secret` structural
   redaction with name-heuristic-as-diagnostic-only (DQ-085),
   authorize → drift → approve as a **security invariant** (DQ-086),
   construction-throw on non-addressable `render:` (DQ-087), tuple args +
   `argNames` struct projection (DQ-088), `af:` reservation at
   normalization (DQ-089, partially landed — verify `Key.make` throws).
   Unblocks: `catalog-dispatch` (8), `governance` (10), `build-drift` (5),
   `identity-unification` (2 of 4), security `authorization` (2 unbuilts),
   `secrets` DQ-085 unbuilt, `trust-boundary` AN-1 unbuilt. **≈29 reds.**
   Two deferred-to-implementation items land WITH it: the DQ-084
   double-signal fix (`access.approval` vs constructor — §10 correction 3)
   and the `SingleFlightPayload.url` question (§10 correction 4: dispatch
   synthesizes a url OR url becomes optional — pick during AN-1; the
   catalog-dispatch spec expects `url` present in the payload key list).
2. **AN-2: `src/reactivity-push.ts`** (name ratified) —
   `makeReactivityBroadcast`, `applyPushedInvalidation`; behavior fully
   specified by `live-sync` (6) + `identity-unification` (1). Depends on
   AN-1 only because the specs drive it through `Agent.dispatch`.
3. **AN-4: result rendering** — `renderResult`/`renderResultFragment` +
   `Resume.installFragment` and a fragment handle exposing
   `activate`/`dispose`/`disposeCount`/`isActive`. DQ-087 ratified. One
   cross-lane check: whether M11b's fragment handle already exposes that
   surface (flagged in DQ-096's entry as owed by the resumability lane).
   Unblocks `result-rendering` (6) + `identity-unification` (1).
4. **Small independents** (no Agent dependency):
   - `dom.ts` renderer branch for `View.html`/SafeHtml holes (injection
     partial red; owner `COMPONENT_KIT_PLAN.md`; fail-closed today).
   - M7 secret-name **capture** diagnostic in Portable/extract (secrets
     red; "diagnostic, never enforcement" per DQ-085).
   - Versioned single-flight wire envelope (trust-boundary red, DQ-091 —
     check DQ-091's entry before building; it is the one Grade-A item
     whose DQ is not fully closed).

## Grade B — packaging decision already made, build later

5. **AN-3: MCP projection** — ratified to live in the **`@affe/agent`
   adapter package**, NOT `src/agent-mcp.ts`. The specs load
   `fromSrc("agent-mcp")` — a premise that contradicts the ratified
   packaging and needs the documented-correction treatment when AN-3 is
   built (harness reads only `src/`; the workspace-package pattern from
   `@affe/permissive` is the template). Unblocks `mcp-projection` (6).

## Grade C — open DQs, each with a recorded recommendation

6. **DQ-094** (json-render scoping): rec = restate AN-5's dependency now,
   fork a repo-native `ViewSpec` slice when AN-5 is scheduled. The
   json-render docs are gen2 reference material, not this repo's plan.
   `ViewSpec.ts` naming stays deferred (per DQ-096 ratification) until
   this settles. Blocks `generative-view-spec` (9) — the largest block.
7. **DQ-095** (approval durability): rec = pluggable `ApprovalStore`
   layer, in-memory default that DENIES pending approvals on restart,
   queue exposed as a standard query. Blocks 1 governance placeholder.
8. **DQ-097** (kit catalog entries): rec = kits ship partial entries with
   `access:` mandatory at the app. Blocks 1 placeholder.
9. **DQ-098** (A2A/ask-agent): rec = userland, with `@affe/agent` named
   as the escape hatch. Blocks 1 placeholder.

## Grade D — not agent-lane work

- `authorization.spec.ts` [SEC/R3] ×2 + [SEC/R5]: router-lane defect
  (`Route.guard` stored but never read by `router-runtime`). Real bug,
  router lane owns it.

## Build order

AN-1 → AN-2 → AN-4 (with the M11b handle-surface check) → AN-3 as
`@affe/agent` → ratify DQ-094/095/097/098 → AN-5 (`ViewSpec`). The small
independents can interleave anywhere.
