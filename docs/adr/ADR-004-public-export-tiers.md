# ADR-004: Public Export Tiers (Core, Advanced, Internals)

- Status: Proposed
- Date: 2026-03-10

## Context

Top-level exports currently mix golden-path APIs with low-level reactive primitives. Feedback indicates this increases accidental misuse and makes the API feel larger than necessary.

## Options Considered

1. Keep all exports at top level.
2. Move low-level primitives to subpaths, keep compatibility aliases.
3. Remove low-level exports entirely.

## Decision

Choose option 2:

- Introduce clear export tiers in docs.
- Keep compatibility top-level exports during migration window.
- Encourage low-level usage through explicit subpaths.

## Rationale

- Improves discoverability of recommended APIs.
- Preserves backward compatibility.
- Supports advanced integrations without crowding the main surface.

## Migration Impact

- Existing imports continue to work initially.
- New docs and examples default to tiered imports.

## Rollback Plan

- If subpath split causes ecosystem issues, maintain dual-export model and reinforce docs warnings.
