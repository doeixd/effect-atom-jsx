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

## Audit — Precise Remaining Gaps (2026-07-07)

Measured state of primary-surface Result emission:

| Surface | Emits | Status |
|---|---|---|
| `Atom.query` / `Atom.effect` / `Atom.runtime().atom()` / `ResultAtom` | unified `Result` (5-state) | ✅ done |
| `AtomRpc` / `AtomHttpApi` queries/actions | unified `Result` | ✅ done |
| `Component.query` / `Component.action` / optimistic | unified `Result` | ✅ done |
| **Route loaders** (`Route.loaderResult`, `loaderError`, `title`/`meta` callbacks) | **`FetchResult`** (3-state), imported in `Route.ts` under the local alias `Result` | ❌ **not migrated** |
| **`router-runtime` loader cache** (`runCachedLoader`, `setLoaderCacheEntry`) | **`FetchResult`** | ❌ not migrated |
| **`SingleFlightPayload.loaders[].result`** | **`FetchResult`** | ❌ not migrated (on the SSR/single-flight wire) |
| **`Atom.pull` / OOO stream** (`PullResult`) | **`FetchResult`** | ❌ not migrated |
| Result bridge (`Context.result` etc.) | accepts both (`ResultLikeValue`) | ✅ intentional compat acceptance |

Key correction to earlier notes: the routing layer is **not** on unified
`Result`. `Route.ts` does `import * as Result from "./Result.js"` — that
local `Result` is `FetchResult`. So `Route.loaderResult()` returns a
`FetchResult`, and its `Failure.error` carries the `E | { defect: string }`
union — a real golden-path signature leak. The local aliasing actively
disguises the divergence in the source.

### Why this is a dedicated pass, not a quick edit

~60 `Result.`/`FetchResult.` call sites across `Route.ts` (49),
`router-runtime.ts` (10), single-flight serialization, SSR render, and
hydration. Two hazards make a hasty migration dangerous:

1. **SWR shape is load-bearing.** Loaders rely on `FetchResult`'s
   `waiting` + `previousSuccess` for stale-while-revalidate. Unified
   `Result` models this via `Refreshing<A,E>` / `Success` — semantically
   equivalent but not field-identical, so every read site must be rewritten,
   not retyped.
2. **Serialization is on the wire.** `SingleFlightPayload` and the SSR
   loader payload serialize `FetchResult` values. Changing the model changes
   the hydration wire format; a mismatch fails **silently** (client renders
   stale/wrong state, no error). This must land with round-trip
   serialize/deserialize + hydration tests, not by retyping signatures.

### Scoped migration plan (release-blocking, own pass)

1. Rename the misleading `import * as Result` → `import * as FetchResult` in
   `Route.ts`/`router-runtime.ts` (pure rename, zero behavior change) so the
   divergence stops being disguised. **Safe to do anytime.**
2. Introduce a loader-facing unified-`Result` surface with an explicit
   `FetchResult -> Result` adapter at the loader-cache boundary; keep the
   cache internal representation until step 4.
3. Migrate `Route.loaderResult`/`loaderError`/`title`/`meta` public
   signatures to unified `Result`; add a compat shim for one release.
4. Migrate the single-flight/SSR serialization to a versioned unified-Result
   wire format, gated behind round-trip + hydration tests.
5. Migrate `Atom.pull`/OOO stream (isolated; no wire impact).
6. Delete the loader-side `FetchResult` usage; `FetchResult` becomes
   compat-subpath-only.

Acceptance: no `E | { defect: string }` union reachable from any exported
signature; grep for `FetchResult` in `Route.ts`/`router-runtime.ts` returns
zero; hydration round-trip tests green.

## Open Questions

- Keep `FetchResult.builder(...)` permanently as advanced ergonomic renderer, or add equivalent API on unified `Result`?
- Timeline for reducing `FetchResult` public emphasis after migration settles.
- Step 4 wire-format versioning: additive field or version tag? (affects
  back-comfort with already-served HTML during a deploy.)
