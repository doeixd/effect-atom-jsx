# Router2 Implementation Plan (Loader-Driven Routing)

This plan implements the advanced routing model from `docs/router2.md`: route loaders as pipes, parallel loader execution, dependency-aware batching, prefetch/caching/revalidation, streaming SSR, SEO metadata from loader data, and SSG/ISR utilities.

## 1) Goals

- Keep the component-first route model while adding first-class loader orchestration.
- Preserve end-to-end type safety for params/query, loader data, loader errors, and route metadata.
- Maximize parallelism by default (no waterfalls), with explicit dependency controls.
- Unify client navigation, SSR, prefetch, and static generation around one loader pipeline.

## 2) Core API Targets

### Route loader APIs

- `Route.loader(fn, options?)`
- `Route.loaderData<A>()`
- `Route.loaderResult<A, E>()` (for streaming mode)
- `Route.loaderError(cases)`
- `Route.reload()`

### Loader options

- `dependsOnParent?: boolean`
- `streaming?: boolean`
- `priority?: "critical" | "deferred"`
- `staleTime?: DurationInput`
- `cacheTime?: DurationInput`
- `staleWhileRevalidate?: boolean`
- `reactivityKeys?: ReactivityKeysInput`
- `revalidateOnFocus?: boolean`
- `revalidateOnReconnect?: boolean`
- `timeout?: DurationInput`

### Link/prefetch APIs

- Extend `Route.Link`:
  - `prefetch?: "hover" | "focus" | "visible" | "idle" | "intent" | "none"`
  - `prefetchScope?: "loader" | "component" | "full"`
- `Route.prefetch(link, params, options?)`
- `Route.prefetchOnVisible(options?)` (behavior/pipe)

### Route actions and invalidation

- `Route.action(effectFn, options?)`
  - auto-invalidates current route loader
  - optional cross-route `reactivityKeys`

### Route SEO/SSG APIs

- `Route.meta(fnFromLoaderData)` typed by loader output
- `Route.sitemapParams(effect)`
- `Route.collectAll(root)`

## 3) Architecture Additions

- New internal runtime module: `src/router-runtime.ts`.
- Add route metadata fields for loader/loader options/error handlers/sitemap params.
- Introduce `LoaderStore` keyed by `(routeId, serializedParams)`:
  - value/result state
  - timestamps and stale markers
  - in-flight promise/fiber dedupe
- Add dependency graph builder for matched routes:
  - independent loaders (parallel batch)
  - parent-dependent loaders (batched by dependency depth)
- Add SSR serialization contract:
  - `__LOADER_DATA__`
  - route-id keyed hydration reattachment.

## 4) Phase Plan

## Phase A — Typed Loader Pipe + Loader Data Access

Files:
- `src/Route.ts`
- `src/Component.ts`
- `src/type-tests/route-loader-types.ts` (new)
- `src/__tests__/route-loader-basic.test.ts` (new)

Work:
- Implement `Route.loader(...)` pipe attaching typed loader metadata.
- Implement `Route.loaderData<A>()` accessor in routed setup.
- Ensure loader Effect requirements/errors are merged into component `R`/`E`.

Acceptance:
- Loader output type is available in setup without manual casting.

## Phase B — Navigation Loader Orchestration (Parallel by Default)

Files:
- `src/router-runtime.ts` (new)
- `src/Route.ts`
- `src/__tests__/route-loader-parallel.test.ts` (new)

Work:
- On navigation: match branch, parse params, collect loaders, run via `Effect.all` unbounded.
- Store results by route id and params key.

Acceptance:
- Sibling/ancestor loaders run concurrently; tests prove no waterfall.

## Phase C — Dependency-Aware Loader Graph

Files:
- `src/router-runtime.ts`
- `src/__tests__/route-loader-dependency.test.ts` (new)

Work:
- Support `dependsOnParent: true`.
- Build and execute two-level+ dependency batches with max parallelism.

Acceptance:
- Parent-dependent child waits; unrelated siblings still parallel.

## Phase D — Caching, Staleness, and Revalidation

Files:
- `src/router-runtime.ts`
- `src/Route.ts`
- `src/__tests__/route-loader-cache.test.ts` (new)

Work:
- Implement stale/cache clocks and stale-while-revalidate.
- Revalidate on focus/reconnect when enabled.
- Integrate with existing `Reactivity.invalidate` keys.

Acceptance:
- Cache hit/miss/stale behavior deterministic and tested.

## Phase E — Prefetch and Link Trigger Strategies

Files:
- `src/Route.ts`
- `src/__tests__/route-prefetch.test.ts` (new)

Work:
- Extend `Route.Link` prefetch trigger and scope.
- Add `Route.prefetch(...)` helper.
- Add `intent` delay and dedupe/cancel rules.

Acceptance:
- Prefetch warms loader cache and (for lazy routes) component chunk path.

## Phase F — Streaming Route Data

Files:
- `src/Route.ts`
- `src/router-runtime.ts`
- `src/__tests__/route-streaming.test.ts` (new)

Work:
- Support `streaming: true` where loader data is surfaced as `Result`.
- Components render loading/success/failure reactively as loaders settle.

Acceptance:
- Streaming routes render shell first and update on completion.

## Phase G — Loader Errors and Route-Level Recovery

Files:
- `src/Route.ts`
- `src/__tests__/route-loader-error.test.ts` (new)

Work:
- Add `Route.loaderError(...)` pattern matching by tagged error.
- Support generic fallback and retry/reload entrypoints.

Acceptance:
- Loader failure can be handled at route level before global boundary.

## Phase H — Route Actions and Auto-Revalidation

Files:
- `src/Route.ts`
- `src/__tests__/route-action.test.ts` (new)

Work:
- Implement `Route.action(...)` mutation helper tied to current route.
- Auto-invalidate current loader, optional extra `reactivityKeys`.

Acceptance:
- Post-mutation route data refresh is automatic and typed.

## Phase I — Metadata from Loader Data + Merge Semantics

Files:
- `src/Route.ts`
- `src/router-runtime.ts`
- `src/__tests__/route-meta-loader.test.ts` (new)

Work:
- Extend `Route.meta(...)` to accept `(loaderData) => meta` where loader exists.
- Preserve current precedence behavior (deepest title wins, meta merges root->leaf).

Acceptance:
- Loader-driven metadata updates correctly on client and SSR path.

## Phase J — SSR Streaming + Hydration Contracts

Files:
- `src/Route.ts`
- `src/runtime.ts` / SSR integration points
- `src/__tests__/route-ssr-streaming.test.ts` (new)

Work:
- Serialize loader results by route id for hydration.
- Add deferred stream script payload contract and client hydration hook.

Acceptance:
- SSR shell + streamed loader hydration works with typed route ids.

## Phase K — SSG/ISR Tooling

Files:
- `src/Route.ts`
- `src/router-runtime.ts`
- `src/__tests__/route-ssg-isr.test.ts` (new)

Work:
- Implement `Route.sitemapParams(...)` metadata.
- Implement `Route.collectAll(...)` for route enumeration.
- Add utilities for sitemap inputs and static page expansion.

Acceptance:
- Dynamic routes can enumerate params for sitemap/SSG pipelines.

## Phase L — Examples + Docs + Hardening

Files:
- `examples/router-basic/*` (update)
- `examples/router-typed-links/*` (update)
- `examples/router-loaders/*` (new)
- `examples/router-streaming/*` (new)
- `docs/API.md`
- `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md`
- `CHANGELOG.md`

Work:
- Demonstrate parallel loaders, dependent loaders, prefetch, and loader error recovery.
- Document recommended defaults and performance patterns.

Acceptance:
- Examples and docs align with shipped APIs.

## 5) Test Matrix

- Type tests:
  - loader data inference
  - loader error union inference
  - `Route.meta` loader-data typing
  - `Route.action` requirements/errors
- Runtime tests:
  - parallel vs dependency-batched execution
  - cache/stale/revalidate behavior
  - prefetch hit path
  - streaming update behavior
  - SSR serialization/hydration contracts

## 6) Risks and Mitigation

- Loader orchestration complexity:
  - keep graph builder pure + unit-tested.
- Cache correctness and stale races:
  - key by route+params, dedupe in-flight loads.
- SSR/client divergence:
  - single serialization contract + hydration integration tests.

## 7) Practical Delivery Order

1. A-B-C (typed loader + parallel/dependency orchestration)
2. D-E (cache/revalidate/prefetch)
3. F-G-H (streaming/errors/actions)
4. I-J-K (meta+SSR+SSG)
5. L (examples/docs/release hardening)

## 8) Definition of Done

- `npm run typecheck` passes.
- Full test suite passes with loader-router additions.
- `npm run build` and `npm pack --dry-run` pass.
- API docs/examples/changelog/status fully updated.
