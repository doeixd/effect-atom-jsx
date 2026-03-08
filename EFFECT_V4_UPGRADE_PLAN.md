# Effect v4 Beta Upgrade Plan

Date: 2026-03-08
Target: Upgrade `effect-atom-jsx` from Effect v3 to Effect v4 beta

## External Research Notes

Sources reviewed:
- `https://effect.website/blog/releases/effect/40-beta/`
- `https://raw.githubusercontent.com/Effect-TS/effect-smol/main/MIGRATION.md`
- `https://duckduckgo.com/html/?q=effect+v4` (for discoverability and additional references)
- `npm view effect dist-tags --json` (current beta tag)

Key takeaways relevant to this repo:
- Effect v4 beta is currently published as `effect@4.0.0-beta.29`.
- Ecosystem changed to unified versioning across Effect packages.
- Runtime internals changed; migration docs explicitly call out Runtime API changes (notably `Runtime<R>` removal/changes), so code paths using runtime values are high-risk.
- Core programming model remains similar (`Effect`, `Layer`, `Scope`, etc.), but API details and module organization may differ.
- v4 beta can include breaking changes between beta versions, so pinning the beta range and keeping migration notes in-repo is recommended.

## Current Project Impact Scan

Likely affected files:
- `package.json` (dependency/peer dependency versions)
- `src/effect-ts.ts` (heavy usage of `Runtime`, `ManagedRuntime`, `Scope`, `Layer`)
- `src/__tests__/effect.test.ts` (runtime-related tests)

Potentially unaffected:
- Reactive core files (`src/signal.ts`, `src/computation.ts`, `src/owner.ts`, `src/api.ts`)
- DOM runtime (`src/dom.ts`, `src/runtime.ts`), except where effect integration APIs are re-exported

## Detailed Execution Plan

1. Dependency upgrade
- Update `dependencies.effect` to v4 beta.
- Update `peerDependencies.effect` to matching v4 beta range.
- Reinstall dependencies and refresh lockfile.

2. Compile-first migration pass
- Run `npm run typecheck` immediately after dependency update.
- Collect all TypeScript breakages caused by Effect v4 API changes.
- Prioritize fixes in `src/effect-ts.ts` where runtime abstraction is concentrated.

3. Runtime API migration
- Replace v3-specific runtime assumptions with v4-compatible runtime execution paths.
- Rework `atomEffect` runtime-parameter support to continue accepting both runtime-like and managed runtime-like values in a v4-compatible manner.
- Validate `mount`, `resource`, and `use` behavior with new runtime model.

4. Test migration and behavior verification
- Update tests to align with v4 types/signatures where necessary.
- Keep existing behavioral guarantees: cancellation on dependency change, typed failures vs defects, cleanup/disposal semantics.
- Ensure no regressions in newly introduced APIs (`signal`, `computed`, `resource`, `mount`, `use`).

5. Full validation
- Run `npm run typecheck`.
- Run `npm test`.
- If failures remain, iterate until green.

6. Post-upgrade stability guardrails
- Keep an upgrade note in this file for future beta bumps.
- Record any v4-beta-specific shims/assumptions discovered during migration.

## Risks and Mitigations

Risk: Runtime API incompatibility creates broad type/runtime failures.
- Mitigation: Isolate changes to `src/effect-ts.ts` and run compile-first iterative fixes.

Risk: Behavior drift in cancellation / cleanup.
- Mitigation: Preserve tests around interruption and disposal; add targeted tests if gaps are found.

Risk: Beta churn between versions.
- Mitigation: Pin to tested beta range and avoid relying on unstable modules unless required.

## Success Criteria

- Dependency and peer dependency both use Effect v4 beta.
- `npm run typecheck` passes.
- `npm test` passes.
- Public APIs in this library continue to work, including runtime-injection features (`use`, `resource`, `mount`) and atom/effect integration.
