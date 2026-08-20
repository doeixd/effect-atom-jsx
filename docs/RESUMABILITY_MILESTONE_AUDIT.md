# Milestone audit — M3, M4, M5 (2026-07-30)

Independent adversarial audits of the milestones marked complete, verifying each
**Work** item and **Acceptance** criterion against the source rather than against
the plan's own prose. Prompted by M1 item 4, which read as complete while
silently dropping two route fields from every wrapper.

Findings are recorded here; fixes are tracked separately.

---

## Milestone 4 — Resumable event/action proof

Status claim: *"complete for the direct zero-argument event/action contract"*.
110/110 resume tests green. The headline mechanics are real and well-tested;
two acceptance criteria are weaker than "complete" implies, and there are three
genuine unwritten assumptions.

### Defects, ranked

**1. The duplicate-installation check is not atomic — and it defeats M4's own
exactly-once guarantee. (medium)**

`activeClientInstallations.has(root)` is read at `Resume.ts:3820`; the token is
written at `Resume.ts:4928`. Between them sit `scanComponentBoundaries`,
`validateMarkers`, `scanExpressionTargetsWithComponentBoundaries`, and
`Portable.makeResolver` — **all yielding Effects**.

Two `installClient` fibers on the same root therefore both pass the guard and
both install capture listeners, so **every interaction dispatches twice**. The
second install also wins the token, so the first installation's `dispose` skips
the registry delete (`:5092-5095`).

The unwritten assumption is *"nobody calls `installClient` for one root
concurrently"*. Breaks under: an app racing hydration against a route
transition, or literally `Effect.all([installClient(a), installClient(a)])`.

> This is **the same shape as `DQ-099`** — check-then-act with yields in the gap.
> Two independent instances in one subsystem makes it a pattern, not an
> accident: *any* guard in this codebase that reads a registry and writes it
> later should be assumed racy until proven otherwise.

**2. Interrupting one dispatch poisons a co-awaiting dispatch. (medium-low)**

`Portable.ts:557-566` wraps the attempt in `Effect.exit(restore(attempt))`, which
captures **interruption** as a failure exit, resets state to `Idle`, and then
`Deferred.done(deferred, exit)`. A second, *uninterrupted* fiber awaiting the
same chunk is completed with the **first fiber's interrupt cause** and never runs
its action.

Scenario: two rapid clicks share one in-flight chunk, and anything interrupts
only the first fiber (boundary disposal or rollback interrupting
`controller.fiber`) — the second interaction dies with it. It surfaces as
`dispatch-resolution-failure` rather than silently, and the cache is correctly
*not* poisoned.

The earlier resolver failure-cache fix (`Idle` on failure) **does hold** —
confirmed at `resume.test.ts:4858` and `:4901`.

**3. The portable claim does not stop native DOM handlers, and a comment says
otherwise. (low — documentation)**

`Resume.ts:4838-4845` adds to `claimedInteractions` and returns, but never calls
`stopPropagation`/`preventDefault` — unlike the **activation** path six lines
earlier (`:4816-4822`), which calls both. The comment at `:4778-4782` claims the
behaviour is "exactly as a real DOM handler calling stopPropagation would",
which is true only *within the resume walk*. Any ordinary listener below the root
still fires, and a `<button type=submit>` still submits.

The asymmetry between the two paths is itself undocumented.

### Work items that were never done

**Item 4 — false.** "Explicitly classify browser APIs requiring same-turn
synchronous execution as eager-only or fallback" was never done. A grep for
`same-turn` / `eager-only` hits only the plan line itself; no document mentions
clipboard, fullscreen, popups, or any user-activation-gated API. This is the
**M1 item 4 shape** again: an unstarted item inside a milestone marked complete.

**Item 3 — partially true.** Only handler failure, capture-phase listening, and
the claim policy are *defined*. Propagation, `preventDefault`, passive, `once`,
and multiple handlers are **declared unsupported in prose**, not defined.

### Acceptance criteria

- **#1 is vacuous.** "The focused red test from Milestone 0 is green" cannot be
  checked: M0 item 6 was closed as satisfied-by-obsolescence and that test was
  never written. An acceptance criterion pointing at a non-existent artifact.
- **#2 verified by counting** (`resume.test.ts:1170-1259` plus browser fixture
  asserting `setupRuns: 0, viewRuns: 0`) — not DOM-observational.
- **#3 verified**: server Scope/service are asserted closed before dispatch, and
  the server impl is `Effect.die`.
- **#4 partially true.** Typed fail-closed errors exist and are tested, but
  **build mismatch at the `installClient` boundary has no test at all** — the
  only `ResumeClientBuildMismatchError` assertion is against `decodeManifest`.
  Ordering *is* correct by inspection: `Resume.ts:3784-3798` rejects before the
  duplicate check, before any scan, before `makeResolver`, and before the block
  that ever calls `addEventListener`.

### Zero-argument enforcement is compile-time only

`Resume.event`'s parameter type makes a 1-arg portable a type error
(`resume-event.ts:140-142`), but there is **no runtime arity check**:
`inspectExecutable` never inspects arity, and the client calls `resolved.run()`
with no arguments. A cast-in 1-arg portable would record
`invocation: "deferred-no-args"` and silently receive `undefined`.
Non-portable/opaque handlers *do* fail closed correctly.

### Lower-severity

- **Test names overclaim.** `resume.test.ts:1123` — "interrupts pending
  dispatches **and removes listeners** on disposal" — proves only `pending() === 0`
  after a post-dispose dispatch, which the `if (disposed) return` guard satisfies
  whether or not `removeEventListener` ever ran. Removal *is* genuinely tested
  elsewhere (`:913`, `:939`), so this is coverage attribution, not a bug.
- **Dead dedup state.** The per-event `processed` marker set
  (`Resume.ts:4834-4841`) is unreachable as dedup, because the unconditional
  `claimedInteractions.add(event); return` immediately after means no second
  marker is ever consulted for the same event. Harmless, but it reads as a safety
  net that is not one.

### Checked and clean

`activeClientInstallations` is a `WeakMap`, so roots are not retained;
two-marker ancestor/descendant chains have four dedicated tests;
`installClientScoped` ties disposal to the caller's Scope and is asserted;
`dispose` is idempotent and does not touch the caller's runtime; module dedup
under concurrency is a real Ref+Deferred state machine under
`uninterruptibleMask`, proven both in unit tests and in Chromium.

---

## Resolution (2026-07-30) — all three findings fixed

| Finding | Outcome |
| --- | --- |
| **M3 F1** non-delegated events silently uncollected | **Fixed by collecting them.** A session-level `directEventHandlers` WeakMap plus `observeDirectEventHandler`, called *after* the `if (delegate) { … return }` block so the delegated fast path and the compiler ABI are untouched. No new diagnostic code was needed — the existing `opaque-event-handler` / `event-data-unsupported` / `invalid-event-type` codes now fire on a path where they previously could not. |
| **M4** non-atomic install claim | **Fixed structurally.** The claim is minted outside the yielding work and check-and-set now happen with no yield between them, so the invariant is structural rather than guarded — the same move that closed `DQ-099`. `Effect.onExit` releases the claim on failure or interrupt, idempotently and only if the map still holds *this* token. |
| **M5 #1** `addressable` terminality unenforced | **Fixed by preservation.** `registerComponentMetadataCopier` in `Component.ts` is drained by `copyComponentMetadata`, the single choke point every wrapper already funnels through; `Resume.ts` registers a copier that re-stamps both the symbol and the WeakMap entry. Ordering no longer matters. |

### Two things learned that generalise

**The M5 finding was confirmed, not contested.** The existing test
`"does not carry addressability through a later component wrapper"` **encoded the
defect as intended behaviour** — it asserted the loss by name. It is replaced by
`"carries addressability through wrappers applied after addressable"`, plus a
negative control that a component which never had an activation still does not
get one. Both fail with the copier disabled.

**A plain concurrency assertion does not catch a claim race here.**
`Effect.all([install, install], { concurrency: "unbounded" })` passes against the
*old* buggy code, because `installClient` has no true async boundary with a fake
root, so the fibers never interleave. What has teeth is forcing the interleave: a
`RacingRoot` whose `querySelectorAll` runs the second install from inside the
first one's scan — precisely the old check/claim gap. Both fixes were verified by
reverting them and confirming the new tests fail.

This also calibrates the M4 finding: the defect is real, but the audit's
"literally `Effect.all([installClient(a), installClient(a)])`" repro is only
exploitable when something in the install path genuinely suspends (a real DOM or
async resolver). Harder to hit than stated, not less real.

### Still open from these audits

- **`Element.on` handlers remain invisible to collection**, and that is *narrower
  and separate* from M3 F1: `Element.Handle` is a **virtual** handle with its own
  map and manual `emit`, backed by no DOM or server element, so there is no node
  to mark. Making it collectable is a design decision about how a virtual handle
  maps to an SSR target, not a patch.
- **The type-level half of the M5 fix is not done.** Runtime addressability now
  survives wrappers, but `AddressableComponent`'s brand is not carried through the
  wrapper's return type, so `Resume.activationOf(Wrapped)` still needs a cast.
  Carrying it would mean extending `PreserveRouteMetadata`.
- M3 F2–F5 and M5 #2–#7 are unaddressed; see the sections above.
