# Router & data lane — triaged design questions (`DQ-030`–`DQ-049`)

Triage pass 2026-07-30 over `future/router/*.spec.ts`, `docs/ROUTER_CONSOLIDATION_PLAN.md`
(including the R1 and R2 handoff notes), and `docs/adr/ADR-006-implementation-plan.md`.
R1 and R2 are **done**.

**This lane is fully decided as of 2026-07-30** — all nine entries were ratified
into `ROUTER_CONSOLIDATION_PLAN.md` (§ R3, § R4, and the `DQ-032`–`DQ-038`
section). Nothing here blocks R3–R6 any more; what remains is implementation.
New router design questions go in a fresh `inbox-<date>-router.md`.



## Decided — promoted into the owning plan

Closed entries stay listed here (never renumbered) so a `DQ-nnn` cited anywhere
still resolves. The decision and its rejected alternatives live in the plan.

| ID | Decision | Ratified in |
| --- | --- | --- |
| DQ-030 | Split the three inert features: **wire** `guard` and `loaderErrorCases`, **delete** `transition`. Safety rule: no inert authorization API ships — `guard` is wired in the same change-set that keeps it, or removed. | `ROUTER_CONSOLIDATION_PLAN.md` § R3 |
| DQ-032 | Two owners by role: cache-store scope bounds the write (take first — fixes a server write-after-response leak), navigation scope may interrupt (after DQ-031). At most one in-flight refresh per key. | `ROUTER_CONSOLIDATION_PLAN.md` |
| DQ-033 | One ladder: **context → endpoint → local runner**, and `single-flight-runtime.ts` is deleted. A static hint must not outrank request scope — that is how the bleed happened. | `ROUTER_CONSOLIDATION_PLAN.md` |
| DQ-034 | Loader data **folds into** the resume manifest. Binding condition: reverts to a separate channel if M11.5 lands without incremental per-entry delivery. | `ROUTER_CONSOLIDATION_PLAN.md` |
| DQ-035 | A stale parent **feeds** its dependent child and the child's `Result` is marked stale — *a dependent loader is never fresher than its parent*. Mirrors `Result.all`. | `ROUTER_CONSOLIDATION_PLAN.md` |
| DQ-036 | Schema-tagged `RouteLoaderTimeoutError({ routeId, timeoutMs })`. | `ROUTER_CONSOLIDATION_PLAN.md` |
| DQ-037 | Do **not** fix the materialization cache rule — R3 deletes the cache. Fallback if R3 is rejected: mandatory tree context with a diagnostic. | `ROUTER_CONSOLIDATION_PLAN.md` |
| DQ-038 | Segment-model substitution as an explicit R5.4 deliverable; if it slips, **reject** optional segments in `link` with a clear error rather than adding a third parser. | `ROUTER_CONSOLIDATION_PLAN.md` |
| DQ-031 | (a) `RouterService` becomes a **narrow** read/command interface that both the runtime and the loader-less layers implement, so "one navigation stack" is true as a type. (b) A `queryAtom` signal write updates optimistically, forks the navigation, and **rolls back** on failure with the error observable. | `ROUTER_CONSOLIDATION_PLAN.md` § R4 |








