# Test suite audit — 2026-07-30

Adversarial audit of `src/__tests__/`, run in three disjoint lanes after the
M3–M7 milestone audits found several acceptance criteria "proven" by tests that
could not fail.

The organizing question, applied to every candidate:

> **What implementation change would still let this test pass?**

If the answer is "deleting the feature", the test is broken regardless of how
reasonable it reads.

**Method.** Every strengthened test was verified by *temporarily breaking the
relevant source* and confirming the test fails. Assertions that a test "now
covers X" without that step were not accepted. All source breaks were reverted;
`src/**` outside `__tests__` is unmodified by this audit.

**Result.** 972 → 987 tests, all gates green (`typecheck`, `typecheck:tests`,
`npm test`, `npm run build`, 7/7 Playwright).

---

## The recurring failure shapes

Five shapes account for nearly every broken test found. They are worth knowing
by sight, because each one reads as a normal test.

1. **The tautological assertion.** `expect(Array.isArray(x) ? x.length > 0 :
   true).toBe(true)`, or `r === "loading" || r === "ok" || r === null` — an
   assertion satisfied by every possible value, including the value a no-op
   returns.
2. **The unfalsifiable fixture.** `composables.test.ts` searched for `"a"`,
   which **every** row contained, so an implementation that never called
   `filter` passed. The fixture, not the assertion, was doing the hiding.
3. **The undisturbed final state.** Asserting the end value where only a *count*
   is falsifiable. All three lifecycle leaks found earlier today left correct
   final state; that is why no test caught them.
4. **The unexecuted artifact.** The compiler's deferred-definition test asserted
   `definitionIndex > schemaIndex` and never ran the module — so it could not
   observe the `ReferenceError` that ordering actually produces.
5. **The accidental match.** `jsx-runtime-abi.test.ts` asserted
   `toContain("className")` against emitted output, which matched the *author's
   own prop name*; the compiler imports no `className` helper for that fixture.
   `toContain("effect")` matched the module specifier. The test would have
   passed against output containing no runtime helpers at all.

A sixth, milder shape: **the name that over-claims**. `resume.test.ts`'s
"interrupts pending dispatches *and removes listeners*" proved only
`pending() === 0`, which the `if (disposed) return` guard satisfies whether or
not `removeEventListener` ever ran. Where a name and a body disagree, fix
whichever is wrong — but never leave the name asserting more than the body.

## Notable individual results

- **The M7 deferred-definition TDZ crash is now confirmed by execution**, not by
  reading the plugin. A harness transforms, lowers to CJS, and runs the module
  against the real `Portable` runtime; the `ReferenceError` reproduces. Both
  order tests now assert the captures schema *decodes*, which proves the
  definition closed over an initialized binding rather than merely appearing
  later in the file. Unfixed at `src/compiler/resume-extract-plugin.ts:1423-1425`.
- **Build mismatch at the `installClient` boundary now has a test.** The M4
  audit flagged that the only `ResumeClientBuildMismatchError` assertion was
  against `decodeManifest`.
- **`Serialization.layer`'s HTML escaping was never asserted**, because
  encode/decode are inverses with the escaping deleted. The round-trip test
  passed either way.
- **A renamed test.** A new install test was first named "…without claiming the
  root"; breaking that ordering did not fail it, because a failed install
  releases its claim anyway. Renamed to what the body proves. See shape 6.

## The eight unaudited `createEffect` sites — resolved

None has the unowned-and-unscoped shape that caused the `setAttr`/`setStyle`
leak. All eight construct an explicit `Owner` and dispose it via a returned
unsubscribe or an `Effect.addFinalizer`.

`Component.effect` (`Component.ts:1309`) and the atom `subscribe` paths
(`effect-ts.ts:1464`, `:1480`) are covered by tests that count invocations and
assert exact arrays after unsubscribe — they would notice a leak, and now also
catch a double-run on re-close.

`Registry.ts:65`, `AtomRef.ts:78`, `Atom.ts:1793`/`:2360`, and
`effect-ts.ts:1365` remain uncovered. The residual risk is uniform and is a
**caller contract rather than a defect**: the effect is owned by a *detached*
`Owner`, so a caller who never invokes the returned disposer leaks silently. No
test anywhere asserts the disposer is actually wired.

## Source findings — reported, not fixed

1. **`Style.whenBinding` piece selection is not reactive.** `resolveSlot` runs
   once inside `Component.tapSetup` / `withViewTransform`, outside any reaction
   (`Style.ts:751`, `:790`). A signal-valued binding is *read* (`bindingValue`
   calls functions, `Style.ts:596`) but never re-read, so
   `Style.whenBinding("isOpen", true, …)` snapshots at attach time and never
   updates. The two existing tests compared *separately constructed* components,
   which structurally cannot detect this. A characterization pair now pins the
   actual contract: piece selection is static, function-valued style
   *properties* stay reactive via `handle.setStyle`. **Whether that is the
   intended contract is a design call** — if binding-conditional styles are
   meant to track state, this is a real gap.
2. **`View.EventHole` carries its payload as `handler`; every other hole uses
   `value`** (`View.ts:883` vs `:939`/`:946`/`:953`/`:976`). Harmless
   asymmetry, pinned with a comment rather than papered over.
3. **`decodeManifest`'s `ResumePayloadTooLargeError` carries no
   `largestEntry*` attribution**, unlike `collect` (`Resume.ts:1920-1924`).
   Defensible — the client rejects on byte length before decoding, so it has
   nothing to attribute against. Recorded as a deliberate limitation.
4. **`sourceModules` silently no-ops without `this.load`**
   (`resume-extract-vite.ts:147-162`), shipping a virtual module with zero
   loaders. Pinned by an explicitly labelled **known-defect** test.

## Conventions established

- **A defect we choose not to fix gets a labelled known-defect test**, carrying a
  comment saying it records rather than endorses the behaviour, so any fix is
  forced to touch it. Leaving such a test green after a fix is itself the bug.
- **Where a test cannot be given teeth, say so rather than fake them.** The Vite
  HMR propagation defect cannot be exhibited by any fake module graph; it needs a
  real dev-server harness. That is recorded as uncovered, not asserted around.
- **A strengthened existing test beats three new shallow ones.** The goal is
  falsifiability, not count.

## Known-weak, deliberately left alone

`reactive.test.ts` and `effect.test.ts` both monkey-patch
`globalThis.queueMicrotask` to run synchronously in a module-level `beforeAll`.
Consequently `reactive.test.ts:354` "uses microtask batching with explicit
flush" does not exercise microtask batching, and its assertions would pass under
fully synchronous notification. Changing this is a scheduling change with blast
radius well beyond a test edit, and it is a judgement call about what the suite
intends to pin.
