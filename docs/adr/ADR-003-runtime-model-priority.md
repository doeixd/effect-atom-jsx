# ADR-003: Runtime Model Priority (Ambient vs Explicit)

- Status: Proposed
- Date: 2026-03-10

## Context

Two runtime patterns exist:

- Ambient runtime via `mount/createMount` + `useService`
- Explicit runtime-bound atom/action creation patterns

Feedback requests clearer priority and better composability guidance for multi-runtime applications.

## Options Considered

1. Ambient-first documentation and APIs.
2. Explicit runtime-first documentation and APIs.
3. Dual-mode docs with one declared golden path and the other marked advanced.

## Decision

Choose option 3:

- Keep ambient runtime path as the primary onboarding experience.
- Document explicit runtime-bound usage as advanced/compositional path.

## Rationale

- Preserves simple app ergonomics.
- Supports multi-runtime and library-author scenarios.
- Avoids forcing one style on all users.

## Migration Impact

- No immediate code migration required.
- Docs/examples must include side-by-side runtime patterns.

## Rollback Plan

- If one model proves clearly superior in real apps, consolidate docs and deprecate the weaker path gradually.
