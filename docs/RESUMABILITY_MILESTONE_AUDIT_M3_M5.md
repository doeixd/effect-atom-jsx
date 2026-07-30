# Milestone audit — M3 and M5 (2026-07-30)

Companion to [`RESUMABILITY_MILESTONE_AUDIT.md`](RESUMABILITY_MILESTONE_AUDIT.md),
which covers M4. Independent adversarial audits verifying each **Work** item and
**Acceptance** criterion against the source rather than the plan's prose.

**The recurring theme across all three milestones**: guards and conventions that
are *unenforced or path-limited*, and tests that force the happy path by hand.

---

## Milestone 3 — Per-render instrumentation and SSR manifest collection

Status claim: *"complete for the synchronous SSR contract"*. All eight Work items
are genuinely implemented. **The acceptance criteria are not all true as stated** —
two hold only on a subset of execution paths.

### F1 — A portable handler on a NON-DELEGATED event is silently uncollected (highest)

This is acceptance criterion 2 (*"a portable direct event emits one stable marker
and one validated manifest entry"*), and it holds **only for delegated events**.

`dom.ts:694,704`: `addEventListener(node, name, handler, delegate = false)` writes
`$$name` **only** in the `delegate === true` branch — and `$$name` is the *sole*
input to `observeServerEventTarget` (`resume-session.ts:993`).
`ServerElement.addEventListener` is a no-op (`dom.ts:1104`), so the non-delegated
branch leaves **zero trace** on the server element.

Scenario: an `onblur` handler wrapped in `Resume.event(...)`, or any event outside
the Babel plugin's delegated list — blur, focus, mouseenter, custom events. SSR
emits clean HTML, the manifest omits the event entirely, `diagnostics` is
**empty**, and the client falls back with **no signal that anything was dropped**.
Handlers registered via `Element.on` use a separate listener registry and are
likewise invisible.

**The backing test cannot catch this**: `makeButton` passes `delegate: true`
explicitly (`resume.test.ts:89`) or hand-assigns `record.$$click` (`:92`). No test
exercises the default. This is the "test forces the happy path by hand" shape.

### F2 — Opaque setup is a second silent classification

`resume-session.ts:749-757`: a non-`named` setup plan yields `resumableSteps = []`
and, with no activation, returns **with no diagnostic**. Now pinned as intentional
by `ssr-characterization.test.ts:387-411`, but the M3 progress text still claims
opaque closures *"fail closed with explicit diagnostics"*, which is false here.

### F3 — Component identity is keyed by bindings-object identity; aliasing collides

`resume-session.ts:771` does `session.componentIds.set(bindings, componentId)` — a
strong `Map` keyed by the setup result. The same file explicitly anticipates
**non-object** bindings at `:772-774`, so primitives are a supported shape.

Scenario: two instances of an addressable component whose setup returns the same
primitive or a shared constant object. The second `set` overwrites the first; both
instances resolve to the **second** id, and the `markers === undefined` guard
reuses the **same two Comment node objects** for both regions. `c0` gets a
spurious `missing-component-boundary` diagnostic and `c1`'s marker pair is
serialized twice. It fails loudly on the client as a *reattach* error, not as a
collection diagnostic. `renderedComponentIds` is a `Set`, so a second boundary for
one id is accepted silently.

Unwritten assumption: *"bindings objects are per-instance and unique."*

### F4 — script-safety is a property of a swappable dependency, not of `collect`

`Resume.ts:1799` interpolates `serializedManifest` into a script tag **verbatim**.
Escaping happens only inside `Serialization.schemaCodec`, which `collect` receives
from **context**. Any alternate `Serialization` layer — a faster codec, a test
double, a compression wrapper — silently yields an injectable `script` field.
`collect` neither re-escapes nor asserts the invariant, and the escaping test
provides `Serialization.layer`, so it validates *the layer*, not `collect`.

### F5 — Weak tests

Build-mismatch and payload-limit assertions check only `_tag`; `maxPayloadBytes: 1`
makes the limit unmissable and exercises no boundary, and the
`largestEntryKind/Id/Bytes` attribution fields go unasserted. The
nested-collection test asserts only that each session starts at `e0` — it never
checks that the outer render's own post-nesting content still lands in the outer
manifest.

### Verified and clean

Session enter/leave with `finally` restore; the no-collector no-op returning a
shared frozen `noMarkers` (byte-compatible HTML confirmed); document-local ID
counters genuinely reset per `collect`; slot contracts enrichment-only; nested
`onExpressionCreated` unsubscribe is set-based, so no nesting leak; collection
state does not survive the session.

---

## Milestone 5 — Snapshot restoration and partial component activation

Status claim: **"complete"**, unqualified. Work items 2–6 and all three acceptance
criteria verify. **No double-mount hazard was found** — the
`captureBoundaryRegion`/`restoreBoundaryRegion` fix is real, and the exactly-once
disposal latches hold on every traced path. Defects 1–3 sit *just outside* the
acceptance criteria as literally written.

### 1 — `Resume.addressable` terminality is convention only, and violating it is SILENT (medium-high)

`addressable` stamps the activation onto the component object and into a WeakMap.
But `Component.withSlots`/`withBehavior` go through `toComponentLike`
(`Component.ts:2140-2171`), which builds a **new object** and copies only route
decorations — so both the non-enumerable activation symbol **and** the WeakMap
entry are lost.

Collection then emits a v2 snapshot with resumable bindings, **no `activation`**,
and **no diagnostic**. Applying `withSlots` *after* `addressable` therefore SSRs
fine, ships a dormant boundary, and fails on the first click with
`ResumeComponentNotAddressableError`, leaving the boundary permanently `failed`.

Nothing in the type system or at collection time catches the ordering. This is the
documented "wrappers go before `addressable`" rule, entirely unenforced.

### 2 — A non-addressable resumable boundary nested inside an addressable one swallows the interaction (medium)

Controllers are created for **every** snapshot regardless of `activation`.
`claimingBoundary` picks the innermost containing boundary and `isTransitionable`
accepts `dormant`, so the inner boundary claims the event and `startTransition`
immediately fails it as not-addressable — the addressable **ancestor that could
have served it never runs**.

Refusing to promote to an ancestor is correct for *failed/disposed* ancestors, but
the precondition it relies on — *"every resumable boundary containing an
activation event is itself addressable"* — is nowhere written or checked.

### 3 — A restored render that fails on a LATER reactive rerun silently blanks the region (medium)

The `renderFailure` guard is inspected **once**, right after mount. The reactive
callback keeps running: a throw on a subsequent rerun sets `renderFailure`,
returns `null` (emptying the boundary), and thereafter every rerun short-circuits
to `null` — with the controller still `active`, **no diagnostic, and no fallback**.
The activate path has no such swallow, so the two mount paths diverge in
post-commit failure behaviour.

### 4–7 — Unwritten assumptions and lower severity

- **The duplicate-restoration guard is keyed on manifest object identity, which
  the controller path forks.** `mountRestoredComponent` receives
  `manifestWithBindingOverrides(...)`, a **fresh object** whenever a dormant write
  exists, so the claim lands in a throwaway set and the fail-closed guard is a
  no-op there. Unreachable today thanks to the controller's own single-flight, so
  it is defeated defence-in-depth — but the test proving the guard exercises only
  the *no-override* path, i.e. **not the path the runtime actually takes**.
- **The forked manifest bypasses whole-manifest validation** yet is passed with
  `manifestIsValidated = true`. Safe *only* because overrides touch just
  `snapshot.value` and every value is re-decoded through its binding schema —
  reasoning written down nowhere near the `true`.
- **A leaked claim is permanent**: a caller that drops the result without running
  `dispose` makes that `(manifest, componentId)` pair permanently unrestorable.
- **A synchronous mount throw leaves the region half-written** — correctly no
  fallback (so no double mount), but also no `restoreBoundaryRegion` rollback.

### Work item 1 is only partially true

Hydration keys are reused and validated, but `Component.state(entry.value)` seeds
the signal with the decoded value **before** `Hydration.hydrateEffect` runs, and
`mountRestoredComponent` never passes `restored.registry` to the mount — the view
renders under `options.runtime`'s registry. So the `Registry.make()` is
**write-only scratch**, and the hydrate step is in practice a key-set *validator*
rather than the value transport the item describes.
