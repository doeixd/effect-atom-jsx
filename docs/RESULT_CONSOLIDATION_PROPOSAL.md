# Result Consolidation Proposal

Date: 2026-03-10
Status: In progress (redesign track) — **release-blocking** as of the
2026-07-06 design review (see `CURRENT_STATUS_IN_REDESIGN_PLAN.md`, Finding 5).
The two-model seam is exactly where users trip; consolidation must finish
before v1. In particular, `FetchResult.Failure` carries
`error: E | { readonly defect: string }` — that untagged union is awkward to
pattern-match and must not appear in any primary public signature.

## Problem

The library exposes two async result state machines:

- `Result<A, E>` (Loading / Refreshing / Success / Failure / Defect)
- `FetchResult<A, E>` (Initial / Success / Failure + waiting)

This adds conceptual overlap and conversion ambiguity for users.

## Current Consumers

- `Result`: `defineQuery`, `atomEffect`, `Atom.runtime(...).atom(...)`, `AtomRpc`, `AtomHttpApi`, UI `Async`
- `FetchResult`: compatibility helpers and explicit `FetchResult.builder(...)`

## Decision

Use unified `Result` for primary async state and keep `FetchResult` as compatibility model.

## Recommended Direction

Unify on `Result` as the public async state model.

Concretely:

- former `AsyncResult` naming is removed from public API
- former `Result` (Initial/Success/Failure+waiting) is exposed as `FetchResult`

Rationale:

- aligns with existing query/runtime atom APIs
- removes conversion surprises
- reduces docs and API burden

## State Mapping (for migration)

| Legacy `FetchResult` | Target `Result` |
|---|---|
| `Initial` | `Loading` |
| `Success(value, waiting: false)` | `Success(value)` |
| `Success(value, waiting: true)` | `Refreshing(Success(value))` |
| `Failure(error, waiting: false)` | `Failure(error)` |
| `Failure(error, waiting: true)` | `Refreshing(Failure(error))` |

Defects remain explicit in unified `Result` (`Defect`).

## Proposed Rollout

1. Promote `Result` in core exports.
2. Update `AtomRpc` / `AtomHttpApi` to emit unified `Result` directly.
3. Re-export former `Result` module as `FetchResult` for transition.
4. Rewrite docs to teach unified `Result` in primary flows.
5. Complete source/doc rename sweep to remove stale `AsyncResult` terminology.
6. Finish the remaining migration (release-blocking):
   - audit all primary surfaces (loaders, `Route.loaderResult`, queries,
     actions, runtime snapshots, hydration payloads) so they emit unified
     `Result` only
   - confine `FetchResult` to the compatibility subpath; no primary API accepts
     or returns it
   - remove the `E | { defect: string }` union from any signature reachable
     from the golden path (defects stay explicit via unified `Result.Defect`)

## Open Questions

- Keep `FetchResult.builder(...)` permanently as advanced ergonomic renderer, or add equivalent API on unified `Result`?
- Timeline for reducing `FetchResult` public emphasis after migration settles.
