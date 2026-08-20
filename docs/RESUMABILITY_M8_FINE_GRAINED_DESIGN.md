# Milestone 8 Design — Fine-Grained Expressions and Serialized Subscriptions

Status: M8a identity/collection, M8b client text patching, and M8c.0–8c.1
measurement are implemented; M8c.2 non-text protocol/scanner foundation is
implemented and target-specific installation patch strategies are next

This document designs Milestone 8 of `RESUMABILITY_IMPLEMENTATION_PLAN.md`:
restoring a state write so it loads only the expression code that depends on
it and patches that expression's existing SSR DOM — without executing the
component that originally rendered it. It is grounded in the current runtime
internals (file references below are to the tree as of this writing) and in
the protocols Milestones 0–7 established.

## Acceptance criteria (from the plan)

1. A restored state write loads only the required expression code and patches
   its existing DOM boundary.
2. Parent and sibling components do not execute merely to rediscover the
   dependency.
3. Cleanup removes restored subscribers and client resources exactly once.

Plus the plan's measurement mandate: manifest size, first-interaction
latency, update latency, and retained memory versus current hydration.

## What exists today (current-state audit)

The reactive core has **no serializable identity at any level**:

- `Signal` stores subscribers as live `Computation` references
  (`src/signal.ts:22`); `SignalOptions.name` is discarded by `createSignal`.
- `Owner` has no id, path, or child index (`src/owner.ts`). Context lookup,
  registry lookup, and Effect-scope bridging all walk the live owner chain.
- An `insert()` hole's identity is a closure variable plus the compiler's
  `marker` node (`src/dom.ts:77-91`). Two sibling holes in one element are
  indistinguishable from outside. Attribute/class/style expressions have no
  runtime boundary at all — the compiler emits bare `effect(() => attr(...))`.
- `insertExpression` replaces text nodes instead of assigning `.data`
  (`src/dom.ts:99-144`) and `reconcileArrays` is an unkeyed identity walk, so
  node references into a hole go stale on the first update.
- SSR (`renderToString`) runs the tree once with reactivity live, then
  disposes the root; subscriptions are created and discarded. Nothing about
  the dependency graph reaches the HTML.

What *does* exist, and what this design builds on:

- Comment-pair regions with scan/validate/patch machinery:
  `af:component:<id>` markers, `scanComponentBoundaries`, and
  `componentBoundaryTarget` — a synthetic `Element` scoped to a comment pair
  that `insert()` can already render into.
- Semantic Reactivity keys: authored, string-keyed, already wire-safe, each
  backed by a version signal, with an existing read-capture channel
  (`beginReactivityReadCapture` in `src/reactivity-runtime.ts`).
- Portable code identity (`Portable.code`/`bind`/`Resolver`) and the
  Milestone 7 compiler, which already extracts module-closed closures with
  stable `moduleId#name` identities and enforces capture rules.
- Atom hydration identity (scalar keys and family+args) for value
  continuity.

## Design principles

Unchanged from the program: fail-closed with named diagnostics; addresses,
never code, on the wire; schema-validated captures; explicit per-expression
opt-in (ordinary JSX keeps ordinary behavior); build-ID gating makes identity
churn safe.

**Why semantic keys, not low-level signal identity** (ratified in the main
plan): the Reactivity system is an Effect *service* — keys compose through
layers (test determinism, batching/logging, server-push invalidation
bridges) and share one vocabulary with actions, route loaders, single-flight
revalidation, and restored queries, so a resumed action → key bump →
expression patch spans even the server boundary with no new protocol.
Signal identities are process-local heap facts with no service seam; putting
them on the wire would weld the manifest to the reactive core's internals
(which this repo has already replaced once) and would require compiler
identity for every signal site rather than every opted-in expression, at
scale reintroducing the traversal-order desynchronization problem. SSR's
single render pass under-observes conditional reads identically for both
models, so low-level capture buys no correctness. Precision under keys is an
authoring dial (hierarchical keys; the implicit binding keys below), not an
architectural ceiling.

Two new principles specific to M8:

- **Regions, not nodes, are the durable DOM identity.** Node references
  cannot survive the current update strategy; comment-pair regions already
  can, and the machinery to scan and patch them exists.
- **Compiler-assigned identity, not render-order counters.** The session
  already runs three counter disciplines assigned at three different
  traversal moments (component ids at setup commit, event ids at
  serialization, and any expression counter would be a third at insert
  time). Conditionals, deferral, or reconciliation would silently
  desynchronize them. Expression identity must come from the Milestone 7
  transform (source position → stable id), with runtime counters used only
  for *instance* discrimination inside one SSR session.

## Authoring model

A resumable expression is an explicit marker, mirroring `extract`:

```ts
import { expr } from "effect-atom-jsx/portable-extract"

// In a view:
<span>
  {expr((_captures, [count]) => `Count: ${count}`, {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([Schema.Number]),
    deps: [bindings.count],
  })}
</span>
```

- The transform hoists the render function into an exported `Portable.code`
  with identity `moduleId#expr$<constName|ordinal>` (same policy, same
  module-closed / secret / oversize diagnostics as `extract`).
- `deps` declares the semantic reactivity keys the expression re-renders on.
  During SSR the runtime *verifies* the declaration against captured reads
  (`beginReactivityReadCapture`) and emits a fail-closed diagnostic on
  undeclared reads (`undeclared-expression-dependency`) rather than widening
  silently.
- The expression's *data* comes from captures plus an ordered,
  expression-owned dependency codec. During SSR, handle dependencies supply
  live values; on the client the same codec decodes values from existing
  component snapshot records. The manifest still stores keys only and reuses
  the existing binding wire value—there is no parallel expression-value DTO.
  Pure notification dependencies may use a codec that accepts `undefined`.
- v1 restricts expression output to **text** (string/number). HTML-producing
  expressions come later behind `SafeHtml`; attribute/class/style expressions
  are Phase 3 (below).

Ordinary interpolations (`{count()}`) are untouched: they remain
hydration-level and simply mean "this region needs activation to become
live" — exactly the existing progressive-capability story.

## SSR collection

Extend the resume session with an expression channel:

1. `insert()` gains a session hook (same pattern as
   `observeRenderedComponentBoundary`): when the accessor is a marked
   expression, the session allocates a document-local **instance id**
   `x<N>`, wraps the rendered output in `af:expr:<id>:start/end` comments
   (the server document's `createComment` already serializes these), and
   records `{ instanceId, code: Portable.describe(bound), deps,
   ownerComponentId }`.
2. The boundary scanner generalizes from the hardcoded component prefix to a
   marker-prefix parameter, so `scanComponentBoundaries` and a new
   `scanExpressionBoundaries` share validation (uniqueness, nesting,
   completeness) and the region-target primitive.
3. Manifest v3 adds:

```
expressions: Record<ExpressionId /* x<N> */, {
  region: { kind: "comment-pair" },
  code: Portable.Descriptor,          // compiler-assigned identity inside
  deps: ReadonlyArray<string>,        // canonical reactivity keys
  inputs?: ReadonlyArray<string>,     // codec order when key expansion differs
  component?: ComponentId,            // owning boundary, for handoff
}>
```

`inputs` is omitted for the common one-key-per-input case. It is emitted when
hierarchical witnesses expand one authored dependency into multiple trigger
keys (or when deduplication changes cardinality), preserving both correct
parent/child invalidation and the dependency codec's positional inference.

v1/v2 manifests remain decodable; v3 is emitted only when expressions were
collected. Byte-ceiling pressure is real here (one record per expression
instance): collection must attribute size per component/expression in
`ResumePayloadTooLargeError`, and list rendering multiplies instances — see
structural fallbacks.

## Client restoration

A restored expression is a **lightweight subscriber record**, not a revived
`Computation` graph:

```
installClient(...) → for each manifest expression:
  - locate its comment-pair region (scan)
  - register a lightweight key-indexed subscriber record
  - retain an allocation-free region patcher description
```

On first dependency invalidation (not before): resolve `code` through the
shared memoized `Portable.Resolver`, run it with decoded captures under the
caller's `ManagedRuntime` in a fresh Scope, and patch the region's content
(v1: set the region's text). Until a dependency fires, an expression costs
one comment scan and one map entry — no module load, no computation, no
owner.

Deliberate consequences:

- **No owner/context reconstruction.** Expressions cannot use `useContext`,
  owner-scoped registries, or component scope — they are module-closed
  portable code with explicit captures, so there is nothing to reconstruct.
  This dissolves the hardest restoration problem (a `Computation` is
  meaningless without its `Owner` chain) by construction rather than by
  simulation. Expressions that need context are opaque → activation
  fallback, with a diagnostic.
- **Restored subscribers live outside the signal graph.** They subscribe to
  the existing reactivity invalidation channel and are indexed by key. This
  sidesteps the propagation-phase
  asymmetry between `Signal._notify` (microtask-batched) and `Memo._execute`
  (synchronous) — restored expressions are always microtask-phase, and the
  ordering contract is documented rather than accidental.
- Write path for restored state: **every restored binding's hydration key
  doubles as an implicit reactivity key** in a reserved namespace
  (`af:binding:<componentId>/<bindingName>`). A client write to a restored
  `Component.state` handle bumps that key automatically; no authored key is
  needed for the most common case ("this expression shows this binding").
  `deps` may reference a binding directly (the collector resolves it to the
  namespaced key), and authored reactivity keys remain the vehicle for
  cross-cutting dependencies (shared caches, server-pushed domains).
  Bindings may additionally declare explicit reactivity keys, mirroring
  query snapshots. This unification keeps the dependency vocabulary
  string-keyed end to end while removing most of the authoring burden that
  is the keys-only model's main cost.

### Exact-once handoff with activation

Expressions inside a component boundary belong to the boundary controller's
existing state machine. Rules:

- While a boundary is dormant, its restored expressions may patch freely.
- `Activating` first disposes the boundary's restored expression subscribers
  (before setup runs), so the activated component's own computations are the
  sole owners of the region afterward — never two subscriber sets over the
  same DOM.
- Disposal is terminal for both kinds, and the installation's disposer
  removes expression subscriptions with the same idempotence the event
  listeners already have.

This reuses the ratified `Dormant → Resuming/Activating → Active` contract
instead of inventing a parallel lifecycle.

## Runtime changes required (small, ordered)

1. `insert()` session hook + expression comment markers (SSR only; zero cost
   without an active session — one branch, same as event observation).
2. Marker-prefix generalization of the boundary scanner and region target.
3. Text-node reuse in `insertExpression` (`.data` assignment instead of
   `replaceChild`) — independent correctness/perf win, and required so a
   patched region doesn't orphan its own nodes.
4. `RestoredStateBindings` binding-level reactivity keys.

Explicitly *not* changed: signal/owner/computation classes (no ids added to
the hot path), the JSX compiler contract, `Memo` propagation semantics.

## Structural fallbacks (v1 scope fence)

All fail closed with named diagnostics, falling back to activation:

- Expressions inside arrays/list reconciliation
  (`unsupported-expression-context: list`) — unkeyed `reconcileArrays`
  makes region identity unstable; revisit only with keyed rendering.
- Conditional branches that unmount the region — the *region* survives as a
  comment pair, but a branch switch requires activation (`branch`).
- Portals, suspense/async boundaries, nested expression-in-expression,
  expressions whose region never renders (`missing-expression-boundary`,
  mirroring ghost-snapshot handling).
- Non-text output in v1 (`unsupported-expression-output`).

## Phasing

- **M8a — identity and collection** (implemented; no client behavior): `expr` marker in
  the transform; insert hook + markers; dep capture/verification; manifest
  v3; scanner generalization; size attribution. Proof: unit tests assert
  manifest expression records and diagnostics.
- **M8b — text-patch vertical slice**: subscriber records, lazy code load on
  first invalidation, region text patch, boundary-controller handoff,
  disposal. **Implemented.** The adapter-facing
  `ClientInstallation.writeBinding(...)` accepts a snapshot codec and its
  inferred domain value, encodes it, updates the same snapshot later consumed
  by restoration, coalesces writes, and notifies only indexed subscribers.
  `writeBindingEncoded(...)` is reserved for adapters already operating on
  wire values. Unit tests cover stale/decode/disposal paths; Chromium proves
  one `<span>` patches while parent/sibling setup and view counters stay zero
  and the expression chunk loads only on first invalidation.
- **M8c — measurement and widening**: the plan's four metrics measured
  against hydration on the example fixtures; then attribute/class/style
  expressions via new compiler-emitted helpers (`attrExpr(el, name, id,
  fn)`) — these need transform support because today's compiled output has
  no runtime seam to hook.

M8a was the pure collection slice. M8b installs subscribers without eagerly
loading expression code. Ownership remains with those subscribers only while
their component is Dormant; a resume/activation claim suppresses queued work,
interrupts running work, and disposes the subscriber before component setup
or mounting proceeds.

## Risks and mitigations

1. **Region/node identity churn** — mitigated by regions-as-identity, text
   node reuse, and the list fallback fence. The first restored write must
   not invalidate other restored subscribers' anchors; comment pairs
   guarantee that.
2. **Identity desynchronization across traversal orders** — mitigated by
   compiler-assigned code identity plus per-session instance ids that are
   *validated* (scan checks uniqueness/nesting/completeness against the
   manifest) rather than trusted; any mismatch is a scan error → fallback.
3. **Double ownership with activation** — mitigated by folding expressions
   into the existing boundary state machine with dispose-before-setup, and
   by making restored subscribers reactivity-key-only so activated
   computations and restored subscribers never share a signal.
4. **Manifest growth** — one record per instance; mitigated by size
   attribution, the list fence, and (open question) dictionary-compressing
   repeated descriptors for the same code id.

## Open questions for review

1. Should `deps` be inferrable (capture-only, no declaration) once SSR
   read-capture is trusted, with the declaration becoming an optional
   assertion? v1 requires declaration because capture during a single SSR
   pass can under-observe conditional reads.
2. ~~How should the same authored expression rendered more than once be
   discriminated?~~ **Decided in M8a**: compiler identity addresses the code;
   each `insert()` site receives an opaque document-local `x<N>` instance.
   The client never re-derives that instance ID—it validates the manifest
   against the paired HTML comments—so cross-render ordinal stability is
   unnecessary. One accessor reused at two insertion sites receives two IDs;
   one insertion re-evaluated during SSR retains its original ID.
3. ~~Does M8b's write path route through `Registry`/`Atom` invalidation or
   only through reactivity keys?~~ **Decided and ratified in the main plan's
   Milestone 8 section**: keys only, with `Atom.withReactivity` as the
   bridge for atom-backed state. The reactive core stays identity-free;
   low-level read capture is an SSR verification channel, never a wire
   format. Sub-key granularity needs are met with finer authored keys.
4. Whether `SafeHtml` output (Phase 3) needs a sanitizer contract on the
   wire or can rely on the existing `SafeHtml` branding rules.
