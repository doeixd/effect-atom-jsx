# Task Brief: Router Workstream R1 (correctness + dead surface)

You are implementing Workstream R1 from `docs/ROUTER_CONSOLIDATION_PLAN.md`.
Read that plan's "Findings inventory" section first, then follow this brief
exactly. Do the tasks **in order**. Do not expand scope.

## Ground rules (read twice)

1. **Two other agents are working in this repository right now.** They are
   active in `src/Resume.ts`, `src/resume-*.ts`, `src/compiler/`,
   `src/portable-extract.ts`, `examples/resumability-benchmark/`, and the
   docs. **Do not edit those files.** Your lane is: `src/Route.ts`,
   `src/RouterRuntime.ts`, `src/router-runtime.ts`, `src/ServerRoute.ts`,
   `src/__tests__/route*.test.ts`, `src/__tests__/router-runtime.test.ts`,
   and new test files you create.
2. If a file you must touch was modified on disk since you read it, re-read
   it before editing. Never revert changes you did not make. Never reformat
   whole files — make minimal, surgical edits.
3. After **every numbered task**, run: `npm run typecheck` and
   `npx vitest run src/__tests__/route.test.ts src/__tests__/route-loader.test.ts src/__tests__/router-runtime.test.ts`.
   Do not start the next task with a red gate. If a failure is in a file
   outside your lane, wait and retry (another agent may be mid-edit); do
   not "fix" their files.
4. Before finishing: `npm run typecheck:all`, `npm test`, `npm run build`
   must all pass. Do not run `npm run test:browser` unless it was passing
   before you started (check first; it is slow).
5. Write tests BEFORE fixes for Task 3 (the bug). For deletions, tests come
   after (they prove nothing broke).
6. When in doubt about a design decision, do the smaller/safer thing and
   write the question into the "Handoff notes" section you will append to
   `docs/ROUTER_CONSOLIDATION_PLAN.md` at the end. Do not invent new APIs.
7. This project has an OptMem memory (see CLAUDE.md). Run its `wake` at
   session start. Write ONE `note` at the end summarizing what you
   completed. Do not write notes per-task.
8. Line numbers in this brief are approximate (the tree moves). Search for
   the symbol names given; they are the stable pointers.

## Task 1 — Delete dead code (pure removals)

In `src/Route.ts`:
- Delete `toUnifiedLoaderResult` (an identity function). Update its one call
  site in `src/Component.ts` (inside `applyHead`/loader handling near
  `Component.route`) to use the value directly. This is the ONLY
  `Component.ts` edit you are allowed; keep it to that call site.
- Delete `Route.ref` (identity function) and remove it from the `Route`
  const export object at the bottom of the file.
- Delete `loaderFetchResult` (marked `@deprecated`) and its export.
- Delete `Route.Switch` (a first-truthy-child picker unrelated to routing)
  and its export.
- Remove the unused imports of `clearLoaderCache` and `getLoaderCacheEntry`
  at the top of `Route.ts` (they are imported but never used in that file —
  verify with a search before removing).

In `src/RouterRuntime.ts`:
- Find `nodePath`. It contains a ternary whose two branches are identical
  (`Route.fullPathOf(node, node)` both sides). Do NOT just simplify the
  ternary — this function is part of the Task 3 bug. Leave it until Task 3.

Check for usages of every deleted symbol across `src/`, `examples/`, and
tests before deleting; if a test uses one (e.g. a deprecated-API test),
delete that test case too and say so in the handoff notes.

## Task 2 — hydrateSingleFlightPayload: diagnostics + explicit staleTime

In `src/Route.ts`, find `hydrateSingleFlightPayload`:
- Today, when a payload entry's `routeId` matches nothing (tree, registry
  by id, registry by pattern all miss), the loop does a silent `continue`.
  Change it to also call a new optional callback:
  `options?.onMissingRoute?.(routeId)`. Add an options parameter
  `{ onMissingRoute?: (routeId: string) => void }` as the LAST parameter
  with a default of `{}` so all existing call sites keep compiling.
- The `staleTime: loaderOptions?.staleTime ?? 30_000` magic constant: hoist
  `30_000` to a named module constant
  `defaultHydratedLoaderStaleTimeMs = 30_000` with a doc comment explaining
  it: hydrated single-flight entries default to 30s freshness so the client
  does not immediately refetch data the server just computed; routes can
  override via their own `staleTime`.
- Add a test in `src/__tests__/route-loader.test.ts`: hydrating a payload
  with an unknown routeId invokes `onMissingRoute` with that id and
  hydrates nothing else incorrectly.

## Task 3 — Fix the nested-route path identity bug (the important one)

**The bug**: `materializeNode` in `src/Route.ts` wraps a node's component
via `ComponentRuntime.route(node.path, ...)` using the node's LOCAL path
(e.g. `"settings"`), but tree matching and loader identity use the JOINED
path from `routePathOfTarget` (e.g. `"/users/:userId/settings"`). So a
nested `Route.page("settings", SettingsPage)` under `/users/:userId`
renders/matches under `/settings` while its loader runs under
`/users/:userId/settings`.

Steps, in order:
1. Write a FAILING test first, in `src/__tests__/route.test.ts`: build a
   tree `Route.layout("/users/:userId", Layout).pipe(Route.children(Route.page("settings", SettingsPage)))`
   (copy the tree-construction style already used in that test file), then
   assert that the materialized settings component's route pattern
   (`RouteMetaSymbol` metadata / whatever the existing tests read for
   pattern assertions) equals `/users/:userId/settings`, and that matching
   `/users/1/settings` selects it while `/settings` does NOT. Run it;
   confirm it fails for the reason described.
2. Fix: `materializeNode` must compute the joined path before wrapping. The
   joining logic already exists — `routePathOfTarget(root, node)` — but
   `materializeNode` may not have the root in scope. Thread the parent's
   full path down: the materialization/traversal that calls
   `materializeNode` knows the parent path; pass it in and use
   `resolvePattern(parentFullPath, node.path)` as the pattern given to
   `ComponentRuntime.route`. Follow how `routePathOfTarget` joins segments
   so both code paths produce byte-identical patterns.
3. In `src/RouterRuntime.ts`, fix `nodePath`: both ternary branches call
   `Route.fullPathOf(node, node)` (the node's own path). Change it to
   compute the full joined path from the tree root (there is a
   root/app reference in scope in that function's caller — look at how
   `appMatches` obtains nodes). If `Route.fullPathOf(root, node)` is the
   correct call, use that; verify against the test in step 4.
4. Add a `RouterRuntime` test (copy the setup style of existing
   `router-runtime.test.ts` cases): a nested tree where navigating to
   `/users/1/settings` yields a snapshot whose matched route ids use the
   joined path.
5. Re-run the FULL test suite. This fix can change route ids, which other
   tests may have pinned. If an existing test asserted the buggy local-path
   identity, update that test and record it in the handoff notes. If
   something outside the router breaks, STOP and record it instead of
   force-fixing.

## Task 4 — Optional-segment consistency

`validateTree` in `src/Route.ts` strips a trailing `?` from `:name?`
segments, but `extractParams` treats `":name?"` literally (produces a param
key `name?`). Do the MINIMAL honest fix:
- In `extractParams` (and `matchPattern` if needed), treat a pattern
  segment `:name?` as: matches a segment (param `name` set) OR matches the
  absence of a segment ONLY when it is the final segment; strip the `?`
  from the param key.
- If implementing optional-match semantics in `matchPattern` turns out to
  require restructuring the matcher (more than ~30 lines of change), do the
  fallback instead: make `validateTree` REJECT `:name?` segments with a
  clear error ("optional segments are not supported yet"), delete the `?`
  stripping, and record in handoff notes that optional segments were
  fenced rather than implemented. Either outcome is acceptable; silent
  inconsistency is not.
- Tests for whichever behavior you shipped.

## Task 5 — `revalidate: "matched"` and the duplicate loader pass

In `src/Route.ts`, find `actionSingleFlight`. Current defects:
- `revalidate: "matched"` is accepted by the type but not handled: the
  filtering only special-cases arrays and `"reactivity"`.
- When `revalidate: "reactivity"` captured ZERO invalidated keys, the code
  re-runs `runMatchedLoaders` a second time, discarding the already-computed
  `allLoaders` result.

Fix:
- `"matched"` → use `allLoaders` (the full matched set) as the result.
- `"reactivity"` with an empty invalidation set → return an EMPTY loader
  list (nothing was invalidated, nothing needs revalidation). Do NOT rerun
  loaders. This is a behavior change: check the single-flight tests in
  `route-loader.test.ts` (~17 cases) for one pinning the old rerun
  behavior; if one exists, update it and note the change prominently in
  handoff notes — empty-invalidation now means "no loader data returned".
- Add two tests: `"matched"` returns all matched loader results;
  `"reactivity"` with a mutation that invalidates nothing returns zero
  loader entries and runs loaders exactly once (count executions with a
  counter in the loader).

## Task 6 — Dead LoaderOptions: implement `timeout`, remove the other two

In `src/Route.ts` (`LoaderOptions`) and `src/router-runtime.ts`:
- Implement `timeout`: in the place loaders actually execute
  (`executeAndCache` in `router-runtime.ts`), when
  `options.timeout` is a positive number, wrap the loader Effect with
  `Effect.timeoutFail` producing a failure result (the loader `Result`
  failure path that already exists — look at how loader errors become
  `Result.failure`). Add a test with a never-resolving loader and a small
  timeout.
- Remove `revalidateOnFocus` and `revalidateOnReconnect` from the
  `LoaderOptions` type entirely (they are read nowhere; keeping them is
  false advertising). Search all of `src/`, `examples/`, `docs/` for usages
  first; update `docs/router.md` if it mentions them, and note the removal
  in handoff notes (they can return via the reactivity runtime later —
  that idea is recorded in the consolidation plan).

## Finish checklist

1. `npm run typecheck:all` — 0 errors.
2. `npm test` — all green.
3. `npm run build` — green.
4. Append a `## R1 Handoff notes (<date>)` section to
   `docs/ROUTER_CONSOLIDATION_PLAN.md` listing: tasks completed, tests
   added/changed (and why), behavior changes (Task 5 especially), anything
   fenced instead of implemented (Task 4), and any question you deferred.
5. One OptMem note summarizing the outcome.
6. Do NOT start R2 (de-globalization) — it is explicitly out of scope for
   this brief.
