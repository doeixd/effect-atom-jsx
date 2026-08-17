# Ratification brief — the four parked agent-lane DQs (2026-08-17)

Prepared in discovery mode after AN-1–AN-4 and `@affe/agent` (AN-3) landed:
each item restates the open question, what it blocks, and a recommendation
with the code-level premises re-verified today. The entries were written
2026-07-30, **before** the agent lane existed in source; several premises have
materially improved since, and each item notes what changed.

Ratify item by item. Items 2–4 each discharge exactly one `unbuilt(...)`
marker — the last red in its spec file — so each acceptance converts directly
into a file promotion. Item 1 unblocks AN-5, the last large work item.

Status key: ☐ pending · ✅ ratified · ❌ rejected (edit inline when deciding).

---

## ☐ 1. DQ-094 — AN-5's dependency, and the deferred `ViewSpec` module names

- **Blocks:** AN-5 (`future/agent/generative-view-spec.spec.ts`, 9 reds — the
  largest remaining item), plus the `ViewSpec.ts` /
  `view-spec-json-render.ts` naming that DQ-096's ratification explicitly
  deferred "behind DQ-090/DQ-094".
- **Context change since the entry was written:** the two gates it deferred
  behind have both moved. `DQ-090` is **ratified** (the IR has no
  markup-bearing node kind; text carries `value`, never `html`), and the
  generative-view-spec suite now pins a complete repo-native shape:
  `componentCatalog` / `componentEntry` / `slotSpec` / `stateModel`,
  `element` / `text` / `viewTree`, `validate` (five distinct diagnostic
  codes), `decodeSpec` as the trust boundary, `NodeKinds`, typed state refs
  with `writable` / `serverOnly`, an action allowlist, `lower` to the
  json-render target, and `Agent.emitViewSpec`. In other words: the entry's
  option 3 ("a repo-native ViewSpec slice") has effectively been *specified
  already* — the specs are the plan the entry said would be needed.
- **Recommendation (= the entry's own, sharpened):**
  - **Option 1 now:** correct `AGENT_NATIVE_NOTES.md` §7 item 5 to name the
    real dependency — "a repo-native typed catalog + view tree + validator
    covering the state-model/binding/action rules (the content of json-render
    Phases 1–5), specified by `future/agent/generative-view-spec.spec.ts`" —
    and demote `docs/af-ui-json-render/` to *reference input*. Its Phase 1
    alone delivers nothing agent-facing (its own "Minimal First PR Target"
    defers every safety rule), and it is a plan for gen2's static generator
    IR, not this repo's runtime.
  - **Option 3 as the build shape:** AN-5 implements exactly what the spec
    file pins — no attempt to execute the json-render phase structure.
  - **Close the deferred naming:** ratify `src/ViewSpec.ts` (PascalCase
    namespace module — the IR + validator are core, since the §4.2 security
    claim is a library boundary, like `SafeHtml`) and
    `src/view-spec-json-render.ts` (kebab-case internal — a target-format
    projection in core, same precedent as `result-wire.ts`). The lowering
    stays out of `@affe/agent`: it has no adapter dependency and the specs
    import it as a core module.
- **Premise check:** verified today — §7 item 5 still reads "json-render
  Phase 1 (typed catalog + spec validator)"; the json-render plan's Phase 1
  still explicitly excludes state models, actions, and lowering; `DQ-090` is
  marked ratified in `AGENT_NATIVE_NOTES.md` §10.
- **Cost:** one §7 sentence now; the AN-5 milestone itself is unchanged in
  size (this item only makes its prerequisite statement true).

## ☐ 2. DQ-095 — approval durability + the pending-approval queue

- **Blocks:** `future/agent/governance.spec.ts` (1 red — the file's last;
  promotes once this is decided and built).
- **Context change:** AN-1 shipped governance with
  `Approval.require(summary): Effect<void, unknown>` as a plain pluggable
  service, and dispatch consumes it via `Effect.serviceOption` — so the
  recommended shape composes with what exists instead of preceding it.
- **Recommendation (= the entry's own):** **Option 3** — a pluggable
  `ApprovalStore` layer with the in-memory default, and two contract points
  fixed NOW because they are cheap to state and expensive to retrofit:
  1. **restart denies, never drops**: a pending approval that does not
     survive the store resolves as a typed denial (fail-closed), so the
     agent gets an answer rather than a hang;
  2. **the pending queue is a standard query** (ordinary loader/query
     surface), so approval UIs are ordinary app components — no
     adapter-private structure.
  Durable storage (the M11-session-backed implementation) remains a later
  layer swap; ratifying this item fixes the *contract*, not the storage.
- **Premise check:** `src/Agent.ts` `ApprovalService` verified as described;
  no `ApprovalStore` exists yet anywhere; `Component.query` + the query
  snapshot machinery are the obvious carrier for the queue-as-query half.
- **Cost:** moderate (one service + in-memory layer + queue query + the
  governance spec's two halves: failing-store denial and queue rendering).

## ☐ 3. DQ-097 — kit-shipped *suggested* catalog entries

- **Blocks:** `future/agent/result-rendering.spec.ts` (1 red — the file's
  last; promotes once decided and built).
- **Context change:** the 2026-08-16 hardening made `ExposeOptions<Args, A>`
  fully typed against the portable code's own axes (args tuple, success
  codec, `RenderTarget<A>`), which makes the entry's option 2 nearly free:
  a kit "suggestion" is simply the entry options **minus `access`**, and the
  type system already carries everything else.
- **Recommendation (= the entry's own):** **Option 2** — kits ship
  `Agent.suggested(code, optionsSansAccess)` (name illustrative): a
  partial-entry value carrying description, args, success, `error`,
  `render:` and `reactivityKeys`, with **no `access` field representable**.
  The app completes it: `Agent.expose(suggestion, { access })` /
  `exposeMutation(...)` — so exposure (and the DQ-084 mutation declaration)
  is always an app decision, and no kit upgrade can widen the agent surface.
  Option 3's `agent: false` default is rejected for the entry's own reason:
  a default that must never regress across every kit forever is not a
  guarantee, it's a hope.
- **Premise check:** `Agent.expose` / `exposeMutation` verified as the only
  entry constructors; `access` is currently optional on `ExposeOptions`
  (absent = not exposed anywhere), so the completion step is additive.
- **Cost:** small (one partial-entry type + constructor overloads + the
  spec's scenario: a kit suggestion is inert until the app completes it).

## ☐ 4. DQ-098 — A2A / `ask-agent` scope

- **Blocks:** `future/agent/mcp-projection.spec.ts` (1 red — the file's
  last; promotes on this decision alone, since the resolution is a boundary
  statement, not a feature).
- **Context change:** `@affe/agent` now **exists** (AN-3), so the escape
  hatch named by the recommendation has a concrete home rather than a
  hypothetical one.
- **Recommendation (= the entry's own):** **Option 1 with option 2 as the
  named escape hatch** — resolve the §1-vs-§8.5 disagreement in favour of
  §1's already-stated answer: `ask-agent` is out of library scope, an
  app-level action like any other. Delete §8.5 and add one sentence: *if* an
  A2A bridge is ever built, it lives in `@affe/agent`, never in `src/`. The
  spec's `unbuilt` marker is then rewritten as a small boundary pin (e.g.
  asserting the decision is recorded / no `askAgent` export exists in core)
  or simply deleted with the decision cited — either discharges the file.
- **Premise check:** §1's table (line 40) and §8.5 (line 203) verified to
  still disagree by degree exactly as the entry describes.
- **Cost:** zero code; one doc edit + one spec-marker resolution.

---

**Suggested ratification order:** 4 (free), 1 (one sentence + unblocks AN-5),
3 (small), 2 (moderate). Items 2 and 3 can be built in either order after
ratification; item 1's build IS the AN-5 milestone.
