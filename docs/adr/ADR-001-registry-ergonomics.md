# ADR-001: Registry Ergonomics and Ambient Behavior

- Status: Proposed
- Date: 2026-03-10

## Context

The current API requires explicit `Registry.make()` usage in many examples, including JSX-centric paths. Design feedback indicates this adds ceremony and creates ambiguity about whether registry should be implicit (UI ergonomics) or explicit (advanced control).

## Options Considered

1. Keep registry explicit everywhere.
2. Make registry implicit in JSX and explicit for advanced/non-JSX scenarios.
3. Remove registry from public API entirely.

## Decision

Tentatively choose option 2, pending prototype validation:

- Golden-path JSX usage should not require manual registry construction.
- Advanced workflows keep explicit registry access (`Registry.make`, subscriptions, manual lifecycle).

## Rationale

- Preserves explicit execution-context power where needed.
- Reduces onboarding friction and aligns with fine-grained JSX ergonomics.
- Avoids breaking advanced users relying on explicit registry behavior.

## Migration Impact

- Existing explicit registry code remains supported.
- Docs/examples shift toward implicit-by-default usage patterns.

## Rollback Plan

- Keep explicit registry APIs stable.
- If implicit model causes regressions, revert docs guidance and keep registry-first approach.
