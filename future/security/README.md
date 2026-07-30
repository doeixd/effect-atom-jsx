# `future/security/` — the threat model, as executable specification

This lane covers five subjects:

| File | Subject | The one-sentence rule |
| --- | --- | --- |
| `trust-boundary.spec.ts` | Values crossing into the process | Untrusted until a schema says otherwise; a rejection is a **typed** error, never a defect, never a silent accept. |
| `isolation.spec.ts` | Cross-request / cross-tenant / cross-installation state | Two of anything, run concurrently, share nothing — asserted with **counts and identity**, not final values. |
| `authorization.spec.ts` | Who may do what | An unauthorized caller learns **nothing**, and the block happens upstream of the loader. |
| `injection.spec.ts` | Strings becoming markup | Only branded `SafeHtml` renders as markup; everything else is text, everywhere. |
| `secrets.spec.ts` | Credentials | Redaction is structural; the name heuristic diagnoses and never blocks. |

## The rule that makes this a lane rather than a folder

**This lane attacks the seams between lanes, not the features inside them.**

Every other folder under `future/` is organised by module and owned by a plan.
That is the right organisation for describing a design — and it is exactly the
organisation an attacker does not respect. A defect that lives entirely inside
one module gets found by that module's specs. A defect that lives in the *gap*
between two modules is nobody's acceptance criterion, so it survives review,
ships, and is eventually found by accident.

So the specs here are organised by **threat**, and each one deliberately crosses
a boundary: a resume manifest meeting a DOM, a transport meeting a request
scope, a guard meeting a loader, a string meeting a `<script>` tag.

## The motivating evidence

Every security-relevant defect found in this project so far was found *by
accident*, while someone was looking at something else — and each one lived in
the gap between two lanes:

1. **Single-flight cross-request transport bleed.** Two concurrent calls with
   different layer-provided transports both reached a process-global installed
   transport. It sat between R2's and R5's scope, which is why R2 deferred it as
   a "tidy-up" rather than as an isolation failure. Now `isolation.spec.ts`
   `[SEC/DQ-033]`.
2. **Route guards are inert.** `Route.guard(requireSession)(AdminRoute)`
   type-checks, composes, and gates nothing — the guard array is written and
   never read — with no diagnostic. It was filed as an authoring-tier question,
   because from inside the router lane that is what it looks like. Now
   `authorization.spec.ts` `[SEC/R3]`.
3. **`installClient` silently accepted a tampered manifest** whose instance
   carried a contradicting element marker. A *green* spec had masked it by
   accepting either error code — the green was the bug. Now the reason every
   spec in this folder asserts an exact tag and asserts that near-neighbour
   codes differ.
4. **The single-flight boundary has no validation.** `{_tag:"Nonsense"}` is
   accepted and cached as a `Result`. Now `trust-boundary.spec.ts`
   `[SEC/DQ-091]`.

The pattern in all four: the *feature* worked. The *seam* did not.

## What already holds (green on first run)

Worth recording, because a security property nobody has asserted is a property
nobody knows they have:

- **SSR escaping holds** in both text and attribute position, including a quote
  breakout, and no inline `on*` handler is ever emitted.
- **`Serialization` is `</script>`-safe**, including U+2028/U+2029, and the
  escaped output still parses as JSON. The streamed deferred loader scripts
  inherit this.
- **`renderRequest` is genuinely per-request**: its own head store and loader
  cache, and it does not write into the process-wide `clientRouteHeadStore`.
  `renderToString` also restores `globalThis.document` when a render throws.
- **Two `Resume` installations are isolated** even though they share the same
  derived `af:binding:c0/count` key strings, and a second install on the same
  root is a typed refusal rather than last-writer-wins.
- **Portable captures publish only what the codec declares.**
- **The manifest WeakSet memo does not currently open a TOCTOU hole** — but only
  because `Schema.decodeUnknownEffect` copies. See the spec comment; this one is
  green by accident, not by design.

## House rules (on top of `future/README.md`)

- **Every spec has a negative control.** "X is rejected" is worthless without
  "the legitimate X is accepted, cleanly" — otherwise an implementation that
  rejects everything passes forever. Where the control cannot be a sibling
  spec, it is an inline assertion in the same test, marked `NEGATIVE CONTROL`.
- **Classify, don't just fail.** `classifiedTag` in `support.ts` asserts the
  cause has no defects before returning the tag, so "it threw" can never be
  mistaken for "it failed closed".
- **Five shapes per boundary**, because each catches a different bug:
  malformed, structurally-valid-but-wrong-type, **tampered** (internally
  inconsistent — the shape that found the real hole), truncated, and a
  version/build mismatch.
- **Counts and identity for isolation.** "Request A got A's data" is satisfied
  by a shared store written in a lucky order. "Transport A was called exactly
  once and B never saw it" is not.
- **No timing or heap assertions.** Structural invariants only. Numbers live in
  `benchmarks/`.
- `support.ts` deliberately duplicates a small fake DOM rather than importing
  `../resumability/fake-dom.js`: a security spec that goes red because another
  lane refactored a fixture is noise.
