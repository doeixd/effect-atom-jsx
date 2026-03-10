# ADR-002: Async Model Direction (`AsyncResult` and `Result`)

- Status: Proposed
- Date: 2026-03-10

## Context

The library currently exposes two async/result models:

- `AsyncResult` (Loading/Refreshing/Success/Failure/Defect)
- `Result` (Initial/Success/Failure with waiting semantics)

Design feedback highlights conceptual overlap, lossy conversions, and unclear default guidance.

## Options Considered

1. Keep both models and document strict responsibilities.
2. Rename one model for clarity while keeping both.
3. Converge to one public model.

## Decision

Short-term: option 1 with stronger documentation and explicit conversion caveats.

Mid-term: evaluate option 2 or 3 after async API consolidation prototype.

## Rationale

- Minimizes churn while improving user understanding immediately.
- Gives room to validate whether one model can replace the other without regressions.

## Migration Impact

- No immediate breaking change.
- Docs must include a state-mapping table and where conversion loses fidelity.

## Rollback Plan

- If convergence attempts regress semantics, keep both models and enforce clearer boundaries in docs/API tiers.
