# Release Checklist

## Quality Gates

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] No failing CI checks

## API and Docs

- [ ] Public API exports match intended surface in `src/index.ts`
- [ ] `README.md` reflects current API (`createMount`, `useService`, `defineQuery` / `queryEffect`, `mutationEffect`, `createOptimistic`)
- [ ] Breaking changes called out (if any)
- [ ] Effect version compatibility documented

## Runtime and Behavior

- [ ] `queryEffect(...)` behavior without ambient runtime is intentional and documented
- [ ] `atomEffect(...)` cancellation/revalidation behavior validated
- [ ] `AsyncResult` state model validated (`Loading` / `Refreshing` / settled states)

## Packaging

- [ ] `package.json` version bumped
- [ ] `main` / `types` / `exports` verified
- [ ] Build outputs generated under `dist/`
- [ ] Lockfile committed

## Final Verification

- [ ] Changelog / release notes prepared
- [ ] Example app smoke tested
- [ ] `examples/todomvc/` smoke tested (add/toggle/remove/filter)
- [ ] Integration suite `src/__tests__/todomvc.integration.test.ts` passing
- [ ] Tag and publish plan confirmed
