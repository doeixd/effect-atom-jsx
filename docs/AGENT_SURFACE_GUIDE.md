# Agent Surface Guide

How an app exposes its actions to AI agents — and why the agent is **just
another caller**, not a second system. This guide covers `src/Agent.ts`,
`src/reactivity-push.ts`, `src/ViewSpec.ts` + `src/view-spec-json-render.ts`,
and the `@affe/agent` adapter package. Design rationale lives in
[`AGENT_NATIVE_NOTES.md`](./AGENT_NATIVE_NOTES.md); ratified decisions are
cited by their `DQ-xxx` ids.

Completeness of the diagnostic-code and error tables below is **enforced by
tests** (`src/__tests__/agent-guide-docs.test.ts`), derived from the source
unions — the same anti-drift discipline as
[`RESUMABILITY_GUIDE.md`](./RESUMABILITY_GUIDE.md).

## 1. The one concept: the catalog

A catalog entry is a **projection of an existing `Portable.code` value**.
There is no second identity family: tool ids ARE portable code ids,
invalidation ids ARE reactivity keys, render targets ARE addressable
activation ids.

```ts
import * as Agent from "effect-atom-jsx/Agent";
import * as Portable from "effect-atom-jsx/Portable";

const AddTodo = Portable.code({
  id: "todo.add",
  buildId: BUILD,
  captures: Schema.Struct({}),
  run: (_captures, text: string) => Effect.succeed({ id: "t1", text }),
});

const catalog = Agent.catalog({
  addTodo: Agent.exposeMutation(AddTodo, {
    description: "Add a todo",
    args: Schema.Tuple([Schema.String]),
    success: Schema.Struct({ id: Schema.String, text: Schema.String }),
    reactivityKeys: ["todos"],          // strings or Reactivity.Key witnesses
    access: { agent: true, http: true },
  }),
});
```

- **`expose` vs `exposeMutation` (`DQ-084`)**: mutation is declared by the
  CONSTRUCTOR, never inferred from `reactivityKeys` — a read-only cache warm
  may legitimately declare keys.
- **Typed against the code's own axes**: `args` must decode the tuple `run`
  accepts, `success` must encode what `run` returns, and `render:` must be
  an addressable component whose props ARE the success value. Mismatches
  fail at the `expose` call (pinned in `src/type-tests/agent-catalog.ts`).
- **`Agent.secret(schema)` (`DQ-085`)**: redaction is STRUCTURAL — a
  declared-secret arg field never appears in audit records. The
  suspicious-NAME heuristic (`Agent.catalogDiagnostics`) only *suggests* the
  structural fix (`agent:secret-name-suggests-redaction`, warning); names
  never enforce.
- **Kit suggestions (`DQ-097`)**: a kit ships `Agent.suggested(code,
  optionsSansAccess)` — a partial entry with **no `access` representable**.
  The app completes it: `Agent.expose(suggestion, { access })`. A raw
  suggestion in `catalog(...)` throws; exposure is always an app decision.

## 2. Dispatch: one pipeline, every surface

`Agent.dispatch(catalog)` is THE implementation — HTTP
(`singleFlightHandler`), MCP (`@affe/agent`), and any future surface run the
same pipeline, in this ratified order (`DQ-086`):

> **authorize → tool lookup → drift → args decode → approve → audit
> write-ahead → run → encode**

- **Authorization outermost**: an unauthorized caller learns *nothing* — not
  the schema, not the description, not whether the build drifted (a drifted
  and undrifted unauthorized call produce byte-identical denials).
- **Drift fails closed (`DQ-081`)**: a stale `buildId` never runs; the
  refusal is a `PortableBuildMismatchError` carrying the fresh tool manifest
  as plain wire data, so host recovery is mechanical.
- **Args decode before `run` observes them (`DQ-088`)**: core args are a
  `Schema.Tuple`; the HTTP/MCP object projection is derived from the
  authored `argNames` via `Agent.structArgs`.
- **The response envelope has exactly two arms (`DQ-080`)**:
  `{ok: true, payload: {mutation, loaders, invalidated, url}}` or
  `{ok: false, error}`. Recovery data rides INSIDE the error, never a third
  arm.
- **Undeclared failures fail closed**: an error the entry never declared is
  replaced by `AgentErrorEncodeError` — raw errors are never forwarded.

### Agent error family

Every refusal is a typed tagged error. The full set (audited against
`src/Agent.ts`):

| Tag | Meaning |
| --- | --- |
| `AgentToolNotFoundError` | No catalog entry under that name. |
| `AgentArgsDecodeError` | The arg list failed the declared tuple; the handler never ran. |
| `AgentErrorEncodeError` | The tool failed with an undeclared error (never forwarded raw), or produced a result its success schema rejects. |
| `AgentBuildIdMissingError` | The request carried no `buildId`, so drift cannot be checked. |
| `GovernanceUnsatisfiedError` | `makeDispatcher` found a declared approval requirement the supplied layer cannot satisfy (`DQ-082` — at CONSTRUCTION, never a call-time defect). |
| `ApprovalDeniedError` | The human (or the approval store) declined, or a pending approval was denied on store close. |
| `AuthorizationDeniedError` | The authorizer refused the caller. |
| `ApprovalNotFoundError` | `ApprovalStore.resolve` named an unknown pending id. |
| `AgentRenderTargetMissingError` | `renderResult` on an entry with no `render:`. |
| `AgentRenderPropsError` | The success value failed the render target's activation props descriptor; nothing mounted. |
| `AgentRenderError` | The render target itself failed while rendering. |

## 3. Governance services

Provided per surface as ordinary Layers:

- **`CallerContext`** — who is calling (surface kind, user, lineage);
  readable by the action itself, which is what makes row-level scoping and
  audit lineage possible without a second path.
- **`Authorizer`** — runs outermost (`DQ-086`).
- **`Approval`** — human/policy sign-off. `Agent.uiLayer` auto-approves (the
  human already clicked); `Agent.agentLayer` supplies identity only, so the
  app must provide `Approval`.
- **`AuditLog`** — durable sink for mutating dispatches on `audited(catalog)`
  catalogs. **Write-ahead, refuse by default (`DQ-083`)**: the sink is asked
  BEFORE the action runs; if it fails under the default policy the action
  never runs and the refusal record is itself written. `audited(catalog,
  { onFailure: "proceed" })` is the explicit opt-out. Denials are audited
  too, with `outcome: "denied"`.
- **`Agent.makeDispatcher(catalog, layer)` (`DQ-082`)** — checks governance
  at construction: an entry declaring `access.approval` over a stack with no
  `Approval` fails with the typed `GovernanceUnsatisfiedError`.

### ApprovalStore (`DQ-095`)

`Agent.makeApprovalStore()` backs `Approval` with a queue whose contract has
two fixed points:

1. **Restart denies, never drops**: a pending approval that does not survive
   the store resolves as a typed `ApprovalDeniedError` — the agent always
   gets an answer, never a hang. `close()` is the in-memory expression of
   the restart.
2. **The pending queue is a standard query surface**: `pending()` yields
   plain serializable `{id, summary}` records, so approval UIs are ordinary
   components. `resolve(id, "approved" | "denied")` settles one entry.

Durable storage is a later implementation of the same interface — a layer
swap, not a contract change.

## 4. Live sync (`src/reactivity-push.ts`)

When an agent-initiated mutation succeeds, connected browsers hear about
exactly the declared keys — a push that invalidates everything would be
indistinguishable from a page reload.

```ts
const bus = yield* makeReactivityBroadcast();
// server: dispatch publishes `invalidated` on the ok arm only
dispatch(catalog)(request).pipe(Effect.provide(bus.serverLayer));
// client: invalidate exactly what the server sent
yield* applyPushedInvalidation(pushedKeys);
```

There is ONE reactivity key vocabulary: witnesses expand (ancestors + self)
at `publish`, travel as plain strings, and land in the client's
`ReactivityService` unchanged. A failed mutation broadcasts nothing by
construction (the publish sits on the `ok: true` arm). Prefer
`bus.connectScoped(listener)` — the subscription dies with the ambient
`Scope`. Transport (SSE/WebSocket) is a host binding; `flush()` is the
delivery tick.

## 5. Result rendering (AN-4)

A catalog entry's `render:` names an **addressable** component
(`Resume.addressable`); `DQ-087` refuses a non-addressable target at catalog
construction (and at compile time via `RenderTarget<A>`).

- `Agent.renderResult(catalog, tool, value)` validates the value against the
  activation props descriptor BEFORE anything mounts (a chat host hands over
  an unvalidated blob — `AgentRenderPropsError` on refusal), then returns
  `{html, activationId, buildId}`.
- `Agent.renderResultFragment(...)` renders through a real `Resume.collect`
  → dormant `{html, manifest}`.
- `Resume.installFragment(html, manifest)` installs it standalone: zero
  component code loads at install, `activate()` is lazy and exact-once,
  `dispose()` exact-once. The resolver is captured at install time; absent
  one, the process-local registry of `addressable(...)` declarations
  answers, failing closed on unknown ids.

## 6. MCP (`@affe/agent`)

The MCP server is a pure projection over the catalog — no parallel registry
(`packages/agent`; per `DQ-096` the adapter is a package, never a `src/`
module). Transport-neutral: bind `callTool`/`listTools` to stdio/HTTP
yourself; no MCP SDK dependency.

- `mcpTools(catalog)` — one tool per `access.agent: true` entry; object
  `inputSchema` derived from the declared schemas.
- `mcpServer(catalog, {buildId?})` — `callTool` runs the SAME dispatch
  pipeline (drift, errors, envelope inherited). Exposure is ENFORCEMENT, not
  hiding: a UI-only tool invoked by exact name refuses with
  `McpToolNotExposedError`, distinct from `McpUnknownToolError` (a probe
  must not read as a typo).
- `McpAuth` — pluggable authenticator, run BEFORE tool-name validation; the
  authenticated identity supplies `CallerContext`, so audit lineage on MCP
  calls comes from the host's authenticator, never fabricated.
- Tool errors are typed discriminated values in `structuredContent`, never
  stringified messages.
- A2A / `ask-agent` is **userland** (`DQ-098`); if a bridge is ever built it
  lives in `@affe/agent`, never in core.

## 7. Generative UI (`src/ViewSpec.ts`)

The agent emits a **typed view spec**, never markup. The security claim is
structural (`DQ-090`): the IR has NO markup-bearing node kind — `NodeKinds`
is exactly `ui.element` and `ui.text`, and text carries `value`, never
`html`. Raw HTML is rejected because it is *unrepresentable*, not because a
validator caught it.

Two boundaries, in order:

1. **`decodeSpec(unknown)`** — the trust boundary for agent output. Unknown
   node kinds and undeclared fields (a smuggled `html` field on a text node
   included) are REJECTED, not stripped; refusals name the kind and path but
   never echo field contents (`ViewSpecDecodeError`).
2. **`validate(tree, {catalog, state, actions})`** — checks the decoded tree
   against the app's component catalog, state model, and action allowlist.
   Verdicts come from the OPTIONS, never from claims a ref carries — a
   forged `writable: true` changes nothing.

### ViewSpec diagnostic codes

Derived-audited against the `ViewSpecDiagnosticCode` union; every code is an
`error`:

| Code | Meaning |
| --- | --- |
| `ui:unknown-node-kind` | A node bypassed `decodeSpec` with a kind the IR does not have (defense in depth; the decode refusal is the load-bearing check). |
| `ui:unknown-catalog-component` | The element names a component the catalog does not declare. |
| `ui:component-unknown-slot` | A slot name the component's entry does not declare. |
| `ui:two-way-binding-readonly` | `bindState` on a field the state model declares read-only. |
| `ui:server-only-field-bound-to-client` | A `serverOnly` field referenced in a client spec — the secret-leak failure mode, unexpressible past validation. |
| `ui:unknown-state-path` | A state path the model never declared (distinct from server-only, so a secret field does not read as a typo). |
| `ui:action-not-registered` | The action name is absent from the positive allowlist. |

### Authoring, lowering, and the emit action

- Constructors (`element`/`text`/`viewTree`/`on`/`action`, `stateModel`/
  `state`/`bindState`, `componentCatalog`/`componentEntry`/`slotSpec`) build
  the same closure-free, JSON-round-trippable tree agent JSON decodes into.
- **`lower(tree)`** (`src/view-spec-json-render.ts`) projects to the
  json-render **v0.20** dialect: named slots verbatim (never flattened),
  `children: []` on every leaf, whole `{action, params}` bindings,
  `$state`/`$bindState` JSON Pointers only in this module. See
  [`af-ui-json-render/JSON_RENDER_V0.20_UPSTREAM.md`](./af-ui-json-render/JSON_RENDER_V0.20_UPSTREAM.md).
- **`Agent.emitViewSpec({catalog, state?, allowedActions?})`** exposes
  "render this spec" as an ordinary catalog entry (buildId:
  `Agent.viewSpecBuildId`). A refusal is a typed `ViewSpecInvalidError`
  carrying diagnostic CODES only — the refusal never becomes the echo
  channel for a rejected spec.

## 8. Security posture, in one place

- Authorization outermost; unauthorized callers learn nothing (`DQ-086`).
- Drift never runs; recovery manifest only for authorized callers (`DQ-081`).
- Args validate before handlers; undeclared errors never forwarded.
- Audit is write-ahead and refuse-by-default; denials are audited;
  declared secrets are structurally scrubbed from every record (`DQ-083`,
  `DQ-085`).
- Pending approvals deny on restart — no silent drops, no hangs (`DQ-095`).
- Exposure is per-surface enforcement (`access:` flags; MCP refuses hidden
  tools by name); kit suggestions cannot carry exposure (`DQ-097`).
- Markup is unrepresentable in agent-emitted UI (`DQ-090`); `SafeHtml` is
  the only markup channel anywhere, and it fails closed unbranded.
- The single-flight envelope is versioned (`singleFlightWireVersion`) and
  refuses internally inconsistent both-arms bodies (`DQ-080`, `DQ-091`).
