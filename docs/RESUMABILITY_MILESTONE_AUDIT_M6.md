# Milestone audit — M6 (2026-07-30)

Adversarial audit of Milestone 6 (portable queries and behaviors), marked
**complete** and never previously audited. 120/120 resume tests green.

**Verdict: M6 is substantially real** — every Work item has code behind it and the
fail-closed paths are genuinely fail-closed. This is *not* the M1/M4 pattern of a
milestone containing work items that were never done. But **two acceptance claims
are broader than the implementation**, and there are three real defects.

---

## D1 — A restored query loses stale data on typed failure — **FIXED 2026-08-11**

`src/Resume.ts:2258` writes `ResultState.fromExit(exit)`, which maps a typed error
to `Result.failure` (`src/effect-ts.ts:218-226`). The **live** query path produces
`Result.stale(error, previousData)` when previous success exists
(`src/effect-ts.ts:782`).

Scenario: a restored query is showing data; the user invalidates; the executor
fails. A live component keeps showing the data as `Stale`; the **restored one
blanks to `Failure`**.

This directly contradicts acceptance criterion 2 (*"preserves `Result`, error …
semantics"*), and it is the same keep-stale-on-failure family as the recorded
Finding-5 and the router's `loaderSuccess` defect.

**Fix.** A shared `ResultState.fromExitWithPrevious(exit, previous)` now settles
a *typed* failure with prior data to `Stale(error, data)`; the restored query
passes its pre-refresh state. Defects and interrupts are deliberately not
preserved as `Stale` — they are not "the query failed with a value", and the
live path publishes `Defect` for them regardless of prior data.

Verified by reverting to `fromExit`: the new test settles to `Failure` and
fails. A negative-control test pins that `Stale` requires data to keep, so an
implementation returning `Stale(error, undefined)` unconditionally cannot pass.

The router's `loaderSuccess` sibling was fixed in the same family, but it was
**latent rather than live** — nothing on the router path constructs a `Stale`.
See `RESULT_UNIFICATION_PLAN.md` finding 3.

## D2 — Behavior reattachment can only select elements from *snapshot* bindings

`src/Component.ts:2512-2521`: `reattach` calls `selectElements(bindings, props)`
where `bindings` is `restoredBindings` — built **exclusively** from decoded
snapshot entries (`src/Resume.ts:2196-2333`).

Any binding without a `resume` policy is therefore simply **absent**. So a
`Component.value("root", …)` holding the element handle a behavior selects does
not exist at reattach time, and `selectElements` receives `undefined` — the
behavior attaches to nothing, or dies.

**Every test dodges this.** `resume.test.ts:6235-6241` uses a *constant*
`select: () => ({root: …})`; the others select `bindings.count`, which *is* a
snapshot binding. This is the unwritten-assumption signature, and it makes the
portable-behavior story materially narrower than the plan states.

## D3 — Single-flight is per-handle only; `cacheKey` is published but read by nothing

`cacheKey` is correctly *derived* (`src/Portable.ts:356-366`, sharing
`makeResourceCacheIdentity` with the route loader at `src/router-runtime.ts:179`)
and exposed at `src/Resume.ts:2310` — but a grep shows **nothing consumes it**
outside its own equality assertion.

Two restored components sharing one descriptor and keys therefore refresh
independently, producing duplicate fetches, and the manifest-side loader cache is
never consulted. The plan's prose is honest here ("expose that identity"); the
**acceptance criterion is not**.

## D4 — Residual coalescing window on the `inFlight` guard

`src/Resume.ts:2274-2300`. The pinned M0-7 finding #1 is **genuinely fixed** — the
dirty/requeue loop works and `resume.test.ts:4984-5064` is now a real passing `it`
asserting `runs === 2`.

The remaining hole is the *exit*: the `do…while(dirty && !disposed)` completes with
`dirty === false`, then `Effect.ensuring` clears `inFlight` — **separate fiber
steps**. A refresh landing in that gap sets `dirty = true`, returns, and is never
consumed, because the next refresh resets `dirty = false` before running. Narrow,
but the same check-then-act class as the defect that was fixed.

*Note: the plan still labels that finding "(pinned)" at
`RESUMABILITY_IMPLEMENTATION_PLAN.md:1651` — stale, since it is fixed.*

---

## A test that proves nothing

Acceptance criterion 3 (*"portable behavior attachment does not require rerunning
base component setup"*) is **true**, but the test named for it —
`resume.test.ts:3202-3277`, "reattaches a portable behavior in a fresh Scope
without rerunning setup" — **attaches no behavior to the component at all**. It
calls `Behavior.attachScoped` on a standalone behavior and asserts
`setupRuns === 1`, which holds trivially because `restoreStateBindings` never runs
setup. **It would pass if `reattach` were deleted entirely.**

The criterion is actually proven incidentally elsewhere, by
`resume.test.ts:2371-2418` (`setupRuns: 1`, `behaviorRuns: 2`).

## Unwritten assumptions (lower severity)

- **Resolution failure is invisible in the `Result`.** A `Portable.resolve` failure
  rolls the handle back to `current` and fails the refresh Effect, surfacing only
  as a `component-query-refresh-failure` diagnostic. A permanently broken chunk
  leaves the query showing **stale success indefinitely** with no user-visible
  error state. Deliberate-looking, but undocumented and untested.
- **`refresh` completing ≠ data refreshed.** When coalesced, `refresh` returns as
  soon as `dirty = true` is set, so a caller awaiting it then reading the atom sees
  the old value.
- **`cacheKey`'s resourceId is colon-delimited over unconstrained ids**
  (`src/Portable.ts:361` builds `kind:version:buildId:id`, and `CodeId`/`BuildId`
  are only `isNonEmpty()`). The Babel transform mints ids from module paths, and
  **Windows drive letters contain `:`** — an ambiguous split, so a theoretical
  collision. Captures are correctly inside the parameters object, so
  structurally-identical-different-capture queries do **not** collide.
- **`af:binding:*` keys as query `reactivityKeys`** are neither validated nor
  rejected on `Component.query`, and the write side does bump them — so they work,
  but only by exact-key matching, undocumented and untested for queries.
- The duplicate-restore guard is sound (no yield between `has` and `add`), but the
  failure path **leaks the freshly-made `Scope`** when `ownsScope` is true.

## Confirmed correct on probing

- `snapshotQuery` settledness is a **whitelist** (`_tag === "Success"`), so
  `Failure`/`Stale`/`Defect`/`Refreshing`/`Loading` fall to
  `unsettled-query-snapshot` **by construction, not by accident**. Only `Loading`
  is tested, but the structure makes the rest deliberate.
- `unsupported-query-semantics` is driven by option **presence**
  (`hasRetry: options?.retrySchedule !== undefined`), as specified.
- `Behavior.compose` negative portability (*portable iff all members are*) is
  **enforced and tested**, not assumed.
- **Behavior descriptors survive `withSlots`/`withDefinition`/`withBehavior`** —
  no metadata drop here, unlike M1 and M5.
- Lazy executor loading verified by counting: `loads === 0` after render, `1` after
  two refreshes, with a Ref+Deferred shared in-flight attempt retaining only
  success.
- Restoration disposal is exact-once and unsubscribes the invalidation listener
  and interrupts refresh fibers in correct LIFO order.
- **No reactive-owner-vs-`Scope` leak in the M6 paths** — reattach runs under an
  explicit ambient `Scope`, and all M6 cleanup uses `Scope.addFinalizer`. Notable,
  given three such leaks were found elsewhere today.
