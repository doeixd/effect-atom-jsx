# `future/` — the finished design, as executable specification

These are **not** regression tests. They describe the library as it should be
when every plan in `docs/` is finished: correct, production-ready, bug-free.

Three jobs in one folder:

- **Specification.** A decided design written as runnable code, which is harder
  to fudge than prose. If a spec cannot be written cleanly, the design is not
  decided yet.
- **QA.** Behaviours we claim to guarantee — exact-once dispatch, fail-closed
  wire validation, per-request isolation — get asserted rather than asserted
  *about*.
- **Red-green TDD at plan scale.** `npm run test:future` prints the remaining
  work as failures. Implementing a milestone means turning specs green.

## Current state (2026-08-20)

**The suite is empty.** Every spec written here has been driven green and
promoted into `src/__tests__/`; only the harness and the two `support.ts`
fixture files remain. `npm run test:future` therefore exits non-zero with
"No test files found" — that is an empty suite, not a broken one.

This folder is still the right place for the next milestone: write the
finished design here first, then implement against it. See the workflow
below.

## The contract

1. **A failure here is a work item, never an emergency.** This suite is
   expected to be partially red. It is excluded from `npm test`
   (`vitest.config.ts` only globs `src/__tests__/**`) and from
   `npm run typecheck:all` (`tsconfig.json` only includes `src/**`). Never wire
   it into `npm run check`.
2. **A missing API fails exactly one spec.** Never import source at module
   scope — that aborts the whole file at collection time and hides every other
   spec in it. Use `loadSrc` / `fromSrc` from `./harness.js` *inside* the spec
   body, so an absent module or export becomes one clearly-labelled
   `NOT IMPLEMENTED` failure.
3. **Specs assert behaviour, not implementation.** No poking at private state,
   no asserting on internal call order. If a spec would break under a legitimate
   refactor, it is testing the wrong thing.
4. **Every spec names its owner.** Prefix the test name with the plan item that
   owns it — `[M8c.4]`, `[R5]`, `[AN-1]`, `[K1]` — so a red run maps directly
   onto `docs/`. A spec with no owning plan item does not belong here yet;
   decide the design first.
5. **When a whole file goes green, promote it.** See "Promotion" below. `future/`
   shrinks over time; it is a debt ledger, not an archive.
6. **Type-level expectations live in `src/type-tests/`.** The harness hands back
   `any`-shaped values on purpose, because there is no type to check against
   until the API exists. Once it exists, the inference guarantees are pinned by
   a type test, not here.

## Running

```bash
npm run test:future          # the worklist
npm run test:future:watch    # while implementing
npm run typecheck:future     # syntax/hygiene of the specs themselves
npm run test:all             # both suites, for a whole-project picture
```

`test:all` exits non-zero while any spec is red, which is normal. It exists for
the combined view only — `npm run check` remains the gate and must never include
`future/`.

`typecheck:future` should stay **green** even while the suite is red: the
harness returns `any`, so specs describing unbuilt APIs still compile. A failure
there means a spec has a genuine mistake in it.

## Layout

| Path | Subject | Owning plan |
| --- | --- | --- |
| `harness.ts` | `loadSrc`/`fromSrc`/`pick`/`unbuilt` | — |
| `components/` | slots, views, styles, behaviors, kit | `COMPONENT_KIT_PLAN.md`, AF-UI contract |
| `agent/` | action catalog, MCP/HTTP surfaces, generative UI | `AGENT_NATIVE_NOTES.md`, `af-ui-json-render/` |
| `security/` | trust boundaries, wire validation, authorization | `docs/design-questions/platform.md` |

(Lane directories are created when a lane opens and removed when its last
spec is promoted; only `agent/` and `security/` survive today, and only for
their `support.ts` fixtures.)

## The four dimensions a spec can cover

A spec here is not only "describe the finished feature". Four distinct jobs, and
they are found by looking for different things:

**1. Behaviour — what it should do.** The default. Assert the outcome of an
action.

**2. Adversarial — how it breaks.** For every guarantee, write the **attack**,
not just the happy path. This is deliberate, not incidental: seven real defects
came out of this suite so far, but each was a *side effect* of describing ideal
behaviour. Writing the attack directly finds them faster. The pattern:

> The guarantee is *X holds*. So: what input, ordering, or concurrency would make
> X fail? Assert that it doesn't.

Concretely — feed a *tampered* manifest, not just a malformed one; dispose
**during** an in-flight operation, not before or after; run two of the thing
concurrently; replay the same event twice; hand it a value from a *different*
build, tenant, or request.

**3. Security — the seams.** See `security/`. Cross-cutting on purpose.

**4. Structural performance — what must not happen.** Deterministic, countable
invariants belong here: *nothing else loaded*, *exactly one chunk per code
identity*, *no duplicate module fetch*, *payload scales linearly*, *counters
return to zero after disposal*.

**Measured performance does NOT belong here.** No timing assertions, no heap
comparisons, no "under N milliseconds". Those are machine-dependent and flaky,
and this project already paid for that lesson during M8c.1 — `JSHeapUsedSize`
counted density-triggered V8 code as expression slope, and retention gates turned
out to need jitless forced-GC while timing needed a normal browser. Numbers live
in `benchmarks/resumability/` where the gates are calibrated and the environment
is pinned. A flaky spec erodes trust in the whole suite, and this suite's value
is entirely that its signal is believed.

## Promotion: graduating a file out of `future/`

The unit of promotion is the **file**, not the individual spec. Once *every*
spec in a file passes, that file has stopped being a specification and become a
test — so move it where tests live and give it the treatment a real test file
deserves:

1. **Move it** to `src/__tests__/<name>.test.ts` and delete it from `future/`.
   It now gates `npm test` and `npm run check`, which is the point: the
   guarantee is only real once it can fail the build.
2. **Refactor it to house style.** Drop the `loadSrc`/`fromSrc` harness calls and
   import the modules directly at module scope — the APIs exist now, so the
   indirection that protected collection-time no longer buys anything and only
   costs type safety. Adopt the surrounding conventions in `src/__tests__/`
   (`Effect.gen`/`yield*` patterns, existing fixture and layer helpers, shared
   setup) instead of leaving spec-shaped scaffolding behind.
3. **Expand it.** The `future/` version proved the happy path and the headline
   guarantee; a promoted test should cover the API surface properly — every
   overload and option, boundary and empty cases, error and interruption paths,
   concurrency, disposal/cleanup, and the inference guarantees as a companion
   type test in `src/type-tests/`. Aim for the coverage you would want if this
   feature broke silently in six months.
4. **Keep the plan-item tag** in at least the top-level `describe`, so the test
   still traces back to the milestone that motivated it.
5. If a promoted test later goes red because the feature regressed, fix the
   feature — do not move the file back.

Partially-green files stay put: a file with eight passing and two failing specs
is still a work item, and splitting it early tends to scatter one coherent
guarantee across two places.

## The quality bar (read this before adding a spec)

The failure mode that makes a suite like this worthless is the **vacuously
green spec**: one that asserts an export exists, passes, and proves nothing.

```ts
// WORTHLESS — green today, guarantees nothing, will never catch a bug
const { collect } = await fromSrc("Resume", "collect");
expect(collect).toBeTypeOf("function");
```

A spec must execute the behaviour and assert the observable outcome, so that it
is **red until the feature genuinely works** and would **go red again if the
feature broke**:

```ts
// USEFUL — red until attribute patching works, and a real regression detector after
const html = await render(...);            // SSR once
const client = await install(html, ...);   // dormant, zero component chunks
await invalidate("count");                 // first invalidation
expect(el.getAttribute("aria-valuenow")).toBe("1");   // patched
expect(loadedChunks).toEqual(["expr:count"]);          // and nothing else loaded
```

Rules of thumb:

- Assert **state after an action**, never the existence of a symbol.
- Prefer one end-to-end spec over five shallow ones.
- Negative guarantees are the most valuable thing here: *nothing else loaded*,
  *exactly once*, *fails closed*, *no cross-request bleed*. Those are the claims
  we actually make and the ones most likely to silently rot.
- If the assertion needs an API whose shape is still undecided, do not invent
  one — write the spec against the decided part and leave the rest to
  `unbuilt(...)` with a pointer to the plan that owes the decision.

### Every diagnostic spec needs a negative control

This is the subtlest way to write a spec that can never fail, and a review of
`future/components/` found **twelve** instances of it. Asserting that a
diagnostic *fires* proves nothing on its own, because an implementation that
emits that diagnostic **unconditionally** passes:

```ts
// INCOMPLETE — `return [capabilityMismatch]` satisfies this forever
const diagnostics = validateAttachment(behavior, badSlots, view);
expect(diagnostics.length).toBeGreaterThan(0);
```

Three things make it a real check:

1. **The clean case is silent.** Assert the valid wiring yields `[]`. Without
   this, "always report" passes.
2. **The code is specific.** Assert the exact diagnostic code, and — when two
   failure modes are near neighbours (unknown slot vs hidden slot) — assert that
   they *differ*. A single generic "something is wrong" code otherwise satisfies
   both specs.
3. **Nothing else fired.** Assert the diagnostic list contains only what you
   expect, so a future over-eager validator is caught.

The same shape applies beyond diagnostics: any spec whose subject is "X is
rejected" owes a sibling asserting "Y is accepted, cleanly".

### Other ways a spec quietly stops working

Each of these was found in a real review; check yours against them.

- **Fixture teardown before assertion.** A harness that calls `Scope.close`
  before returning the value under test reads post-disposal state. It passes
  today only because handles keep their maps, and becomes a false green the day
  teardown actually lands. Return `{ read, close }` and close *after* the
  assertions.
- **Casts that erase the guarantee.** If a spec's prose claims a compile-time
  guarantee (capability checking, slot wiring), an `as any` at the call site
  deletes exactly the thing being specified. A cast is legitimate only when it
  *documents* intent — e.g. deliberately taking the generated/dynamic escape
  hatch to prove the runtime validator catches what types can't. Add a companion
  entry in `src/type-tests/` for the compile-time half.
- **Over-reach on open questions.** If the owning plan lists an API's exact
  signature as open, do not pin it in an executable spec. Assert the *semantics*
  that are decided and `unbuilt(...)` the signature. Pinning invented shape turns
  a spec into an unratified design decision that the implementer then has to
  either honour or fight.
- **Owner tags that don't match what runs.** A spec tagged `[K0b]` that only
  exercises pre-existing primitives falsely implies phase K0b is incomplete. Tag
  the plan item whose acceptance the spec actually gates.
- **Shared mutable fixtures.** Anatomies/handles built at module scope are
  shared across specs (see `View.Slots.define`, which binds one handle per slot
  at define time). Build fixtures inside the `it`, or inside a factory called per
  spec — and if two phases of one spec need isolation, build a fresh fixture for
  each phase.
- **Green specs whose name over-claims.** "All five type axes survive" cannot be
  checked at runtime; "the slot contract survives" can. Name the spec after what
  it asserts, and move the rest to a type test.

## Writing a spec

```ts
import { describe, expect, it } from "vitest";
import { fromSrc } from "../harness.js";

describe("Agent catalog", () => {
  it("[AN-1] derives a JSON Schema tool manifest from the catalog", async () => {
    const { catalog, expose, toolManifest } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "toolManifest",
    );
    // ...assert the behaviour the finished design guarantees
  });
});
```
