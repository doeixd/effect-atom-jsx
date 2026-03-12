# ADR-006 Implementation Plan

This document is the execution plan for `docs/adr/ADR-006-unified-route-model.md`.

It assumes the project will move fully to the unified route model:

```ts
const UserRoute = Component.make(...).pipe(
  Route.path("/users/:id"),
  Route.paramsSchema(...),
  Route.loader(...),
  Route.title(...),
  Route.guard(...),
)
```

This plan intentionally does not preserve deprecated APIs, does not include migration docs, and does not include codemods. The goal is to fully implement the new design and remove superseded routing paths.

## Goals

- Make `Component.pipe(Route.path(...), ...)` the only route authoring model.
- Replace the current split between routed components and `AppRouteNode` with a single route representation.
- Make all route configuration accumulate on `Route<C, P, Q, H, LD, LE>`.
- Update runtime, SSR, loader execution, link generation, and route introspection to operate on unified routes.
- Remove deprecated or superseded route constructors/helpers once the new model is in place.
- Deliver best-in-class TypeScript DX: strong inference, minimal required annotations, precise callback context typing, useful error messages, and typed navigation/loaders/guards by default.
- Keep `API.md` fully aligned with the implemented routing surface throughout the refactor.
- Ensure all touched public APIs and non-obvious internal helpers have clear, useful doc comments.
- Avoid unnecessary type assertions, especially `as any`, and prefer type-safe helper design that preserves inference and ergonomics.
- Avoid API shapes that force users to create placeholder `null` components just to define or compose routes.

## Non-Goals

- No backwards-compatibility layer for `Route.page`, constructor-style `Route.layout`, `Route.define`, `Route.componentOf`, `Component.route`, `Route.titleFor`, `Route.metaFor`, or `Route.loaderErrorFor`.
- No migration guide, transition aliases, or staged deprecation period.
- No codemod work.

## Documentation Requirements

Documentation quality is part of the implementation work, not a final cleanup task.

### `API.md` requirements

- Update `API.md` whenever the public routing API changes.
- Do not leave `API.md` reflecting removed APIs such as `Route.page`, `Route.define`, `Component.route`, or other deleted legacy helpers.
- Ensure `API.md` examples use the unified route model and demonstrate the recommended route-authoring style.
- Keep `API.md` signatures, examples, and terminology aligned with the final implementation names and types.
- If public API shape changes during implementation, update `API.md` in the same workstream rather than deferring documentation to the end.

### Doc comment requirements

- Every touched public export in `src/Route.ts`, `src/Component.ts`, and `src/RouterRuntime.ts` should have a useful doc comment.
- Public doc comments should explain what the API does, what it returns, and any important typing/inference behavior.
- Public doc comments should call out important constraints when relevant, such as "layout-only", "index route", "requires no existing loader", or "params inferred from path".
- For inference-sensitive helpers, doc comments should explain the expected happy-path ergonomics so users understand they usually do not need explicit generics.
- Non-obvious internal helpers introduced during the refactor should also get concise doc comments when their purpose is not immediately clear from the code.
- Avoid low-value comments that merely restate the function name; prioritize comments that help users understand usage, typing behavior, and edge cases.

## Plan Maintenance Requirements

This implementation plan is a living execution document and should be updated as work progresses.

- Mark major workstreams or sections as `not started`, `in progress`, or `completed` as implementation advances.
- Add brief progress notes directly in this plan when a workstream is partially complete, blocked, split into sub-work, or adjusted for a discovered constraint.
- Record meaningful design decisions or deviations from the original plan in-place so the document remains a trustworthy picture of the actual implementation.
- When a task is completed in a materially different way than first planned, update the plan text rather than leaving stale instructions behind.
- Keep notes concise and practical; the goal is to preserve execution context, open questions, and completion state, not to turn the plan into a changelog.
- After each meaningful edit to this implementation plan, create a git commit so the plan's evolution and execution history are preserved.

## Current State Summary

The current router is split across two representations:

- Routed components created via `Component.route(...)` in `src/Component.ts`.
- Route trees built from `AppRouteNode` in `src/Route.ts` and consumed by `src/RouterRuntime.ts`.

Important current observations from the codebase:

- `src/Component.ts` already has sufficiently generic `pipe` overloads, so `Route.path` can return a non-component type without changing `Component.pipe`.
- `src/Route.ts` currently stores route metadata in component decorations plus `AppRouteNode` definitions/state.
- `src/RouterRuntime.ts` is built around `AppRouteNode` traversal and calls `Route.componentOf(node)` to materialize components for loader execution.
- Loader infrastructure, cache machinery, SSR helpers, and single-flight support already exist and should be preserved conceptually, but retargeted to unified routes.
- `package.json` already targets TypeScript `^5.4.0`, so `NoInfer` is available.

## Target Architecture

The final routing system should have these properties:

- A route is a first-class value returned by `Route.path(...)` when applied to a component.
- All subsequent `Route.*` helpers accept a route and return a route.
- Layout-ness is represented structurally by `LayoutRoute`, not by a separate constructor model.
- The route object, not the component, is the primary carrier of route metadata.
- Runtime traversal, matching, loader execution, SSR, links, and route validation all operate on route values directly.
- Components access route state via `Route.Context` and route accessor effects (`Route.params`, `Route.query`, `Route.hash`, `Route.loaderData`, `Route.loaderResult`, `Route.prefix`).
- The route API is designed so the common path requires no explicit generics at the callsite. Types should flow from `Route.path`, schemas, loaders, and route values automatically.

## TypeScript DX Requirements

TypeScript ergonomics are a first-class success criterion for this ADR, not a nice-to-have.

### Core DX standards

- `Route.path("/users/:id")` should infer params with no schema and no type annotation.
- `Route.paramsSchema(...)`, `Route.querySchema(...)`, and `Route.hashSchema(...)` should replace raw inferred URL types with decoded schema output types automatically.
- `Route.loader(...)` should infer callback `params` and `query` from the input route without requiring explicit generic arguments.
- `Route.title(...)`, `Route.meta(...)`, `Route.guard(...)`, and any other typed route callbacks should see the current route's inferred `P`, `Q`, `H`, `LD`, and `LE` where relevant.
- `Route.link(route)` and `Route.Link` should infer params/query from the route value directly.
- `RouterRuntime.navigateApp(route, ...)` should infer params from the route value directly.
- `Route.loaderResult()` and related helpers should surface precise `LD` / `LE` types, not `unknown` or widened unions, when used from typed route context.
- The public route API should preserve strong inference and flexibility without relying on assertion-heavy implementation patterns.
- Common route authoring should not require placeholder `Component.from(() => null)` values just to satisfy the route API shape.

### Anti-goals for DX

The implementation should explicitly avoid these outcomes:

- requiring users to write `Route.loader<{ ... }, ...>(...)` in normal usage
- requiring users to manually restate path param shapes that can be inferred from the path or schema
- requiring component/route duplication just to get typed links or typed loader callbacks
- requiring users to define dummy or placeholder `null` components solely to construct, reference, or compose routes
- falling back to `any` in route callbacks where inference can be preserved

### Casting discipline

The implementation should minimize type assertions aggressively.

- Avoid `as any` unless there is a truly unavoidable boundary and the reason is obvious from the surrounding code or documented nearby.
- Avoid broad `as unknown as ...` chains when a cleaner helper type, overload, wrapper, or internal abstraction can preserve the real type information.
- Treat heavy casting as a design smell. If a helper requires repeated assertions, revisit the public type model or the internal representation.
- Temporary migration-era casts are acceptable only if they are local, intentional, and tracked for cleanup in later workstreams.

### Error-message quality

Where inference cannot be perfect, prefer types that fail loudly and usefully over permissive widening.

Examples:

- `Route.children(...)` before `Route.layout()` should produce a direct, local type error.
- invalid loader attachment to a route that already has a loader should fail at the helper callsite.
- if `ExtractParams` cannot resolve a pattern deeply enough, the type system should encourage `Route.paramsSchema(...)` rather than silently degrading to misleading types.
- route navigation helpers should fail on missing required params and invalid query shapes at the callsite.

### Type-test policy

Inference behavior should be protected with dedicated type tests. If a helper's signature becomes more convenient but loses inference quality, that is a regression.

## Implementation Decisions

These choices should be treated as fixed implementation constraints unless there is a compelling blocker.

### 1. Single runtime representation

There should be exactly one route representation used internally after the refactor. Do not preserve `AppRouteNode` as a parallel structure. Remove it and move all logic to the unified route object.

### 2. `Route.path` is the only bridge

`Route.path(pattern)` is the only pipe step that accepts a bare component and returns a route. Every other `Route.*` helper accepts a route.

### 3. `Route.Context` follows the ADR's recommended approach

Use opaque `Component.require(Route.Context)` plus accessor effects. Do not block implementation on circular `typeof UserRoute` inference inside components.

However, within that constraint, the implementation should still maximize useful inference through accessor APIs and route-provided context types at render/runtime boundaries.

### 4. Route metadata lives on routes

Loader, title, meta, guards, children, layout/index markers, schemas, ids, and route-local layer data should be stored on the route object itself. Components may still carry minimal metadata only if it is strictly required by other subsystems, but route-owned metadata is the source of truth.

### 5. Remove deprecated or superseded APIs

Delete the old APIs rather than keeping adapters:

- `AppRouteNodeDef`, `AppRouteNodeState`, `MaterializedAppRoute`
- `Route.page`
- constructor-style `Route.layout`
- constructor-style `Route.index`
- `Route.define`
- `Route.ref`
- `Route.mount`
- `Route.componentOf`
- `Component.route`
- `Component.guard`
- `Route.titleFor`
- `Route.metaFor`
- `Route.loaderErrorFor`
- route-node-prefixed extraction helpers, once direct `Route.ParamsOf` and related helpers are in place

### 6. Wildcard typing stays simple

Support wildcard matching at runtime, but do not force typed wildcard value capture in the first pass. Returning `{}` for wildcard patterns is acceptable unless a schema later replaces it.

### 7. Inference quality beats compatibility shortcuts

If there is a tradeoff between preserving an old internal shape and getting significantly better inference, choose the route-first design that improves inference.

### 8. Avoid null-component-driven APIs

Do not let the unified route model settle into an API that routinely forces users to create placeholder renderless components just to get typed routes, links, layouts, or loaders.

If a route needs to exist before a final renderable component is attached, prefer adding an explicit route-building primitive rather than normalizing `Component.from(() => null)` as the recommended path.

## Major Workstreams

The implementation should be executed in the following workstreams.

## Workstream 1: Introduce the unified route core in `src/Route.ts`

Status: in progress

Progress notes:

- Started the first implementation slice by introducing initial unified route core types and `Route.path(...)` scaffolding in `src/Route.ts`.
- This is intentionally an additive first step; old route-node code still exists and will be removed in later workstreams once the unified route path is wired through more of the runtime.
- Tightened several early migration helpers after the first pass to reduce temporary `any`-based implementation signatures and keep the unified route work aligned with the plan's casting-discipline goals.

### Objectives

- Define the new route types.
- Replace node-centric types with route-centric types.
- Build the new route object factory and pipe helpers.

### Required changes

1. Add the core route types:

```ts
interface Route<C, P, Q, H, LD, LE> {
  readonly component: C
  readonly meta: RouteMeta<P, Q, H, LD, LE>
  pipe<A>(f: (self: this) => A): A
}

interface LayoutRoute<C, P, Q, H, LD, LE>
  extends Route<C, P, Q, H, LD, LE> {
  readonly _tag: "Layout"
  readonly children: ReadonlyArray<AnyRoute>
}
```

2. Define supporting aliases:

- `AnyRoute`
- `AnyLayoutRoute`
- `AnyComponent`
- extraction helpers: `Route.ParamsOf<T>`, `Route.QueryOf<T>`, `Route.HashOf<T>`, `Route.LoaderDataOf<T>`, `Route.LoaderErrorOf<T>`

3. Expand `RouteMeta` to include everything needed by route execution. The final route metadata shape should carry, at minimum:

- `pattern`
- `fullPattern` or enough local data to resolve it later
- `paramsSchema`
- `querySchema`
- `hashSchema`
- `exact`
- `id`
- loader fn
- loader options
- loader error handlers
- title callback or literal
- meta callback or literal
- guards
- route-local layer data
- layout/index markers

4. Implement a route factory used by all route-building helpers. That factory should:

- store the wrapped component
- store route metadata/config
- expose `pipe`
- avoid mutating the component as the primary mechanism

5. Add runtime type guards:

- `isRoute(value)`
- `isLayoutRoute(value)`

6. Define extraction helper types directly against unified routes rather than preserving node-era conditional layers. Keep these helpers simple so editor hover output stays readable.

7. Add or update doc comments for the new core route types and helper types so the generated/public API reference remains understandable.

8. Revisit any migration-era casts introduced during the early unified-route work and remove them where a cleaner type-safe representation is possible.

### Notes

- The route object should be immutable at the public surface. Each pipe step should return a new route object with updated metadata.
- Do not reproduce the current node `definition/state` split.

## Workstream 2: Implement `Route.path` and pattern param inference

Status: in progress

Progress notes:

- Initial `ExtractParams` support and `Route.path(...)` entrypoint have been started.
- Further refinement is still needed for broader helper integration, edge cases, and deeper type-test coverage.

### Objectives

- Create the Component-to-Route bridge.
- Infer params from the pattern string.

### Required changes

1. Add the `ExtractParams<S>` type.

Implementation should support:

- `/users/:id` -> `{ readonly id: string }`
- `/users/:id/posts/:postId` -> `{ readonly id: string; readonly postId: string }`
- `/users/:id?` -> `{ readonly id?: string }`
- `/users` -> `{}`

2. Implement `Route.path<Pattern extends string>(pattern)` with signature equivalent to:

```ts
declare function path<Pattern extends string>(
  pattern: Pattern,
): <C extends AnyComponent>(
  component: C,
) => Route<C, ExtractParams<Pattern>, {}, undefined, void, never>
```

3. Add route metadata initialization in `Route.path`:

- local pattern string
- initial id
- default query/hash types
- no-loader marker (`LD = void`, `LE = never`)

4. Define a stable no-loader convention:

- `LD = void` means no loader exists
- `LE = never` remains the default loader error type

5. Decide how full path resolution works for nested routes.

Recommended implementation:

- store `pattern` as authored, relative or absolute
- compute `fullPattern` during tree traversal, validation, or runtime flattening using parent layouts

This avoids locking the route to a parent too early and keeps route composition clean.

6. If `ExtractParams` hits recursion depth limits, prefer a branded fallback type or other explicit signal instead of quietly producing an overly broad inferred type. The DX goal is to guide the user toward `Route.paramsSchema(...)` when inference cannot safely continue.

### Validation tasks

- Add type tests for all supported pattern inference cases.
- Add runtime tests for relative vs absolute path behavior after nesting is implemented.
- Add doc comments for `Route.path` and param inference behavior, including the recommendation to use `Route.paramsSchema(...)` when decoded types are needed.

## Workstream 3: Rebuild all route pipe steps around unified routes

Status: in progress

Progress notes:

- Initial compatibility work has started for route pipe helpers like `Route.id(...)` and schema helpers so unified routes can begin participating in the existing API surface.
- This work is not complete yet; loader/title/meta/guard/runtime integration still needs to move to route-owned metadata.
- Loader/title/meta/guard metadata now has an initial route-owned path for unified routes, but more cleanup is still needed before the old component-decorated path can be deleted.
- Loader execution now also has an initial tree-based unified-route path, which reduces reliance on the global routed-component registry for newer runtime flows.
- The next cleanup focus is head/title/meta resolution and further removal of registry-first execution assumptions.
- SSR head resolution now has an initial unified-route tree path, so route-owned title/meta callbacks can contribute to server-rendered head output without going through component-attached metadata.
- The next route-execution cleanup target is tree-driven navigation/prefetch/sitemap support so unified routes no longer need to lean on the registry in those paths.
- Tree-based prefetch and sitemap helpers now exist for unified routes, which starts moving navigation-adjacent workflows onto explicit route trees instead of registry lookups.
- The next navigation/runtime cleanup target is teaching more runtime-managed preload and navigation flows to prefer the explicit app tree when unified routes are in use.
- Runtime loader refresh now prefers the tree-based unified-route execution path when the app root is unified, reducing non-legacy dependence on registry-backed execution.
- The next cleanup target is deleting more duplicated node-era execution paths where unified route coverage is now broad enough to support a tree-first default.
- Single-flight cache hydration and route collection now have explicit tree-aware paths as well, which further reduces the need for unified routes to fall back through registry-only lookups.
- The next cleanup target is the remaining public helper surface that still defaults to registry-backed behavior when a tree-aware route path is already available.
- `runMatchedLoaders`, `runStreamingNavigation`, `prefetch`, and `collectSitemapEntries` now accept explicit route trees directly, which shifts more of the public helper surface toward tree-first usage without forcing separate helper names.
- The next cleanup target is internally demoting the legacy-only helper branches now that these public APIs can route through explicit trees directly.
- The next cleanup target is consolidating internal callsites onto those main tree-capable helper overloads so runtime and SSR stop branching between parallel helper entrypoints unnecessarily.
- Runtime and SSR now route more of their helper usage through the main overload-based APIs, which reduces the amount of bespoke `*ForTree` branching in the internal callsites.
- We are not preserving legacy escape hatches as an end state. Once a tree-first helper path fully covers a workflow, the legacy-only branch should be removed rather than retained indefinitely.
- The next cleanup target is aligning the user-facing docs and exported surface with that reality so the public story matches the implementation direction.
- Some duplicate tree-specific helper exports have now been collapsed back into the main overload-based helpers, which is the preferred direction for the final surface.
- The next cleanup target is the remaining node-era tests, examples, and internal callsites that still normalize the old constructors as the default authoring path.

### Objectives

- Make every route helper operate on `Route<C, ...>`.
- Remove current component/node dual overloads.

### Required route pipe helpers

Implement or rewrite the following helpers so they accept a route and return a route:

- `Route.id`
- `Route.paramsSchema`
- `Route.querySchema`
- `Route.hashSchema`
- `Route.loader`
- `Route.loaderError`
- `Route.title`
- `Route.meta`
- `Route.guard`
- `Route.transition`
- `Route.withLayer`
- `Route.layout`
- `Route.children`
- `Route.index`

### Typing requirements

1. `Route.paramsSchema`

- Accept a schema whose input is compatible with the raw path param representation.
- Replace the route's `P` type with the schema output.

2. `Route.querySchema`

- Replace `Q` with the schema output.

3. `Route.hashSchema`

- Replace `H` with the schema output.

4. `Route.loader`

- Only accept a route that currently has `LD = void` and `LE = never`.
- Set `LD` and `LE` based on the loader effect.
- Use `NoInfer` to force callback param typing from the input route.
- Preserve contextual typing in the callback so editor autocomplete shows decoded params/query immediately.

5. `Route.title` and `Route.meta`

- Keep route type unchanged.
- Type callbacks against current route `P` and `LD`.

Prefer callback parameter shapes that are easy for editors to display and autocomplete. If a single context object gives better inference and clearer hover types than multiple positional args, use the clearer shape consistently.

6. `Route.guard`

- Keep route type unchanged.
- Preserve guard effect requirement typing internally, even if enforced later at runtime creation.

7. `Route.layout`

- Convert `Route` to `LayoutRoute`.

8. `Route.children`

- Only accept `LayoutRoute`.
- Calling `Route.children` on a non-layout route must be a compile-time error.

9. `Route.index`

- Mark route as index route.
- It should be valid only in a layout tree context, but the main strictness can happen in tree validation if needed.

10. Audit every route helper signature for unnecessary generic exposure. Most public helpers should infer all generics from input values and previous pipe steps.

11. Add or update doc comments for each public route helper as it is rewritten. Do not batch this at the end.

12. Redesign helpers that only work ergonomically with heavy casting or placeholder null components.

### Runtime design notes

- All these helpers should produce new route objects by copying existing route metadata and changing only the relevant field.
- Do not continue mutating components with `__routeLoader`, `__routeTitle`, `__routeMetaExtra`, `__routeGuards`, etc. Those should move onto the route object.
- Do not leave assertion-heavy internals as the steady-state implementation if the helper signatures can be improved to preserve the same behavior more honestly.

## Workstream 4: Rework `Route.Context` and accessor APIs

### Objectives

- Replace `RouteContextTag` with `Route.Context`.
- Expand route context to include loader state.
- Keep the component ergonomics from the ADR.

### Required changes

1. Replace `RouteContextTag` with `Route.Context`.

2. Update `RouteContext` from `RouteContext<P = unknown, Q = unknown, H = unknown>` to `RouteContext<P = unknown, Q = unknown, H = unknown, LD = unknown, LE = unknown>`.

3. Ensure context contains:

- `prefix`
- `params`
- `query`
- `hash`
- `matched`
- `pattern`
- `routeId`
- `loaderData`
- `loaderResult`

4. Update the exported accessors:

- `Route.params`
- `Route.query`
- `Route.hash`
- `Route.prefix`
- `Route.loaderData`
- `Route.loaderResult`

5. Where possible, accessor APIs should be typed in terms of the active `Route.Context` rather than returning `unknown` and forcing consumers to annotate manually.

5. Keep the recommended component contract:

```ts
Component.require(Route.Context)
```

### Important constraint


That said, any place where the implementation can improve inference without introducing route/component circularity should be treated as worthwhile work, not optional polish.

Update the doc comments on `Route.Context` and all accessor helpers so consumers understand the intended usage model inside components.

## Workstream 5: Remove old node model and old component route model

### Objectives

- Delete the obsolete APIs and types.
- Delete all code paths that assume node-first routing.

### Remove from `src/Route.ts`

- `AppRouteNodeDef`
- `AppRouteNodeState`
- `AppRouteNode`
- `MaterializedAppRoute`
- `RouteNodeSymbol`
- all `WithNode*` helper types
- `page`
- constructor-style `layout`
- constructor-style `index`
- `define`
- `ref`
- `mount`
- `componentOf`
- node-specific `children` implementation
- `RouteNodeParamsOf`
- `RouteNodeQueryOf`
- `RouteNodeHashOf`
- `RouteNodeLoaderDataOf`
- `RouteNodeLoaderErrorOf`

### Remove from `src/Component.ts`

- `Component.route`
- `Component.guard`
- all routed-component-only metadata plumbing that only exists to support the old route system, unless still needed temporarily by the new route internals

### Remove old inference-gap helpers

- `Route.titleFor`
- `Route.metaFor`
- `Route.loaderErrorFor`

### Follow-up cleanup

Once route-owned metadata is working, remove the internal component decoration copying that only existed to preserve route metadata through component wrappers.

## Workstream 6: Rebuild tree structure, nesting, and route introspection

### Objectives

- Support nested routes and layouts in the new route representation.
- Preserve and improve current introspection helpers.

### Required changes

1. Replace node traversal helpers with route traversal helpers:

- `Route.nodes`
- `Route.parentOf`
- `Route.ancestorsOf`
- `Route.depthOf`
- `Route.routeChainOf`
- `Route.fullPathOf`
- `Route.paramNamesOf`

All of these should accept unified routes and layout routes.

2. Implement path resolution for nested routes.

Behavior requirements:

- child route `Route.path("users")` under a root layout `Route.path("/")` resolves to `/users`
- child route `Route.path("users")` under `/admin` resolves to `/admin/users`
- absolute child paths keep their absolute meaning
- index routes resolve to the exact parent path

3. Decide whether the tree helper APIs should work from a root route only or allow root arrays. The cleanest approach is to require a single root route, typically a layout route, for all tree introspection helpers.

4. Rewrite `Route.validateTree(root)` around unified routes.

It should validate:

- duplicate route ids
- duplicate sibling patterns after normalization
- duplicate param names in a route chain
- `Route.children` only on layout routes
- index route misuse
- orphaned children or invalid tree shape

6. Keep route-tree helper types readable. Deep conditional type stacks for parent/ancestor helpers can hurt editor performance and hover quality; prefer practical, understandable types over type-level cleverness here.

5. Replace normalized pattern logic that currently assumes `AppRouteNode.kind` with route-owned flags.

### Internal utility recommendations

Add route-tree helper functions that are not necessarily public:

- `flattenRoutes(root)`
- `resolveFullPattern(parentFullPattern, route)`
- `routeKindOf(route)` or direct flags
- `normalizeRoutePattern(route)`

These should become the shared basis for runtime traversal, tree validation, SSR, and link generation.

## Workstream 7: Rebuild route matching and path extraction utilities

### Objectives

- Keep and improve existing runtime matching support.
- Ensure matching works for relative nested paths, index routes, optional params, and wildcard behavior.

### Required changes

1. Update or replace:

- `resolvePattern`
- `extractParams`
- `matchPattern`

2. Ensure `extractParams` supports:

- static path segments
- named params
- optional named params
- wildcard fallback behavior if supported at runtime

3. Ensure `matchPattern` supports exact vs non-exact semantics in a way that still works for nested routes and layouts.

4. Ensure matching always uses the resolved full path, not the route's authored local segment, once routes are part of a tree.

### Important note

The current implementation in `src/RouterRuntime.ts` matches directly against `node.path`, which will be incorrect once relative child paths are common. The new design must make full-path resolution explicit and central.

## Workstream 8: Rebuild loader execution around unified routes

### Objectives

- Make all loader execution route-based instead of component/node-based.
- Preserve cache, streaming, and dependency-aware loader execution.

### Required changes in `src/Route.ts`

Rewrite these APIs to operate on unified routes:

- `runMatchedLoaders`
- `runStreamingNavigation`
- `runRouteLoader`
- `collectSitemapEntries`
- single-flight loader seeding helpers that infer from routes

### Required design changes

1. Route registry

The current registry stores registered components by pattern/id. Replace this with a route registry or remove the global registry entirely in favor of explicit tree traversal.

Recommended approach:

- prefer explicit traversal from the route tree owned by the runtime and SSR entrypoints
- only keep global registration if there is a subsystem that truly requires route discovery independent of any app tree

2. Decoding inputs before loader execution

Loader execution should not rely only on raw string params if schemas have been provided.

At execution time, decode:

- `P` from raw path params via `paramsSchema` if present
- `Q` from URL query params via `querySchema` if present
- `H` from URL hash via `hashSchema` if present

The same decoded types must be reflected in callback inference, route context, loader result helpers, and navigation helpers so the developer sees one consistent type story end to end.

3. Parent-dependent loaders

Preserve the current `dependsOnParent` model, but drive it from the route tree rather than full-pattern prefix guessing.

Required improvement:

- do not infer parent solely from string prefix comparisons
- use actual parent-child tree relationships

4. Loader options

Preserve support for current loader options:

- `dependsOnParent`
- `streaming`
- `priority`
- `staleTime`
- `cacheTime`
- `staleWhileRevalidate`
- `reactivityKeys`
- `revalidateOnFocus`
- `revalidateOnReconnect`
- `timeout`

5. Loader error typing

Ensure `Route.loaderResult` returns `Result.Result<LD, LE>` based on the route type.

Also ensure JSX/control-flow sites that consume loader results preserve the real loader error type rather than widening it away.

6. Loader error rendering

Retain a route-level error case facility via `Route.loaderError(cases)` so inline error views remain possible without `loaderErrorFor`.

### Requirement handling

Loader effects have an `R` requirement that must be satisfiable by:

- route-local `Route.withLayer(layer)`
- ambient runtime/app layer supplied to router creation or SSR render

The implementation should preserve both forms.

## Workstream 9: Rebuild route rendering in `src/Component.ts`

### Objectives

- Remove component-side route creation.
- Keep the route-aware render behavior needed when a route's component is mounted.

### Required changes

1. Delete `Component.route`.

2. Remove route setup logic from component creation as an authoring primitive.

3. Reintroduce route rendering support in a route-centric way.

There are two possible implementation approaches:

#### Option A: Route wraps component rendering

The route object exposes or internally uses a function that:

- matches the current URL
- decodes params/query/hash
- runs guards
- runs loaders
- provides `Route.Context`
- renders the wrapped component only when matched

This is the cleanest architectural fit with the ADR.

#### Option B: Keep an internal route-aware component wrapper helper

A private helper in `src/Component.ts` can still build the actual rendered component instance used by runtime/SSR, but it must be driven from the route object and not exposed as `Component.route`.

Recommended choice: Option B as an internal implementation detail if it minimizes churn, but the public surface must remain route-first.

4. Ensure route-aware rendering still handles:

- match gating
- parse failures
- guard execution
- loader execution
- loader result atoms for streaming mode
- route head updates
- context provisioning

5. Delete component-side route metadata decorators that are no longer needed once route-owned metadata exists.

6. If a private route-render wrapper remains, make sure it does not erase route generics when threading route data into context.

### Specific code areas to revisit

- `RoutedComponentInternals`
- `setRoutedMeta`
- `copyRouteDecorations`
- `toComponentLike` preservation of route metadata
- the entire `route(...)` implementation in `src/Component.ts`
- the entire `guard(...)` implementation in `src/Component.ts`

## Workstream 10: Rebuild `src/RouterRuntime.ts` around unified routes

Status: in progress

Progress notes:

- The runtime has started accepting unified routes in its config and matching pipeline.
- Loader refresh now has an initial branch for unified routes, while legacy node execution still remains in place for compatibility during the refactor.
- This is still transitional work; request rendering and deeper runtime flows have not been fully converted yet.
- SSR/request rendering now has an initial unified-route branch as well, using tree-based loader streaming for unified route roots.
- The next runtime/SSR step is to carry more route-owned metadata directly through matching and render-time head resolution.
- The next runtime focus is removing more remaining registry and component-materialization dependencies from non-legacy flows.
- Navigation-adjacent helpers are the next likely place to remove registry-first assumptions in favor of explicit unified-route trees.
- The remaining cleanup focus is broader runtime integration and eventual deletion of legacy registry-backed fallbacks once enough public flows prefer the tree-based helpers.
- Runtime-managed preload/navigation behavior is the next likely place to consolidate around the explicit app tree.
- Runtime navigation by route reference now uses `Route.link(...)` for unified routes, which better aligns runtime navigation with the typed unified route surface.
- The next runtime simplification step is to stop routing unified flows back through legacy node/component materialization where an explicit route tree already carries the needed information.
- The next cleanup step is deciding which legacy registry-backed helpers can now be demoted, deprecated internally, or deleted once the explicit-tree variants cover the needed callsites.
- The next likely implementation slice is turning more remaining helper internals into tree-first logic and shrinking the number of codepaths that still need `componentOf(...)` for unified flows.
- The remaining cleanup is increasingly about removing or shrinking the legacy-only fallbacks now that more public helpers can route through explicit unified trees directly.
- The next likely step is separating truly legacy registry-backed code from the default helper flow so unified-route execution stays on the clearer tree-first path by default.
- The next likely implementation slice is consolidating runtime and SSR onto the main overload-based helper surface, then shrinking the duplicate `*ForTree` wiring where it no longer adds independent value.
- The next cleanup step is deciding which remaining legacy helpers should stay as explicit legacy escape hatches versus which ones can now be collapsed further behind the main tree-capable APIs.
- The next cleanup step is identifying which remaining legacy helpers can now be deleted outright, since the target design is the unified route model rather than a long-lived dual API surface.
- The next likely implementation slice is reducing legacy emphasis in `API.md`, pruning safe public exports, and continuing to narrow the remaining node-era surface to the minimum still required during active refactoring.
- The next cleanup step is continuing that pruning on the remaining node-era constructors and metadata helper surface, not keeping them around as a parallel long-term API.
- The next likely implementation slice is migrating more node-era tests/examples to unified route-first authoring so additional legacy exports can be removed safely.
- Type tests and docs are starting to move first; some server-route and route-component tests still depend on node-era APIs and should be migrated or removed before those helpers disappear completely.
- `ServerRoute.document(...)` now accepts unified route roots, so one of the bigger remaining migration blockers has started to move.
- The next cleanup step is continuing that migration in the remaining runtime/server tests and then deleting more node-era helpers once those callsites no longer depend on them.
- The next cleanup target is finishing the leftover route/runtime tests that still exercise node-era helpers directly so those helpers can be removed from the public surface instead of merely de-emphasized.
- More route/runtime/server tests now use unified route roots directly, and `titleFor` / `metaFor` / `loaderErrorFor` have been removed from the implementation entirely.
- Several node-era helpers have now been downgraded to internal-only implementation details, which is the intended direction before full deletion.
- `API.md` now tells a unified route-first story more directly, with less transition-language around the old authoring styles.
- The next cleanup target is `Component.route(...)` / `Component.guard(...)` and the remaining `AppRouteNode` scaffolding that still props up older internal paths.
- Some of the remaining component-route usage has now been migrated in route/runtime/server tests, but `route-loader.test.ts` still contains a substantial amount of old component-route coverage that must be rewritten before `Component.route(...)` can be removed cleanly.
- The immediate next step is finishing that `route-loader.test.ts` migration so `Component.route(...)` / `Component.guard(...)` can be deleted instead of remaining as a temporary compatibility layer.
- More route/runtime/server tests now use unified route roots directly, but `route-loader.test.ts` still intentionally retains several `Component.route(...)`-based cases because parts of the single-flight/registry pipeline still depend on routed-component registration semantics.
- This means `Component.route(...)` and some `AppRouteNode` scaffolding are not yet safe to delete completely; the remaining dependency is now narrower and more explicit.
- The next cleanup target is single-flight and server-route integration, so those systems work natively with unified routes and stop forcing the remaining component-route registration fallback.
- Docs should track that work closely: single-flight, server-route, and API reference material should describe the unified route-first behavior accurately as the implementation changes.
- The immediate implementation priority is moving single-flight loader selection, hydration, and related cache seeding toward explicit route trees so the last substantial `Component.route(...)` dependency can be removed.
- Single-flight and server-route docs now explicitly call out unified-route support where it exists, but the implementation still retains a narrower registration-based dependency in parts of the single-flight pipeline.
- Unified route creation now registers enough route metadata for more single-flight flows to work without separate node-era exports, and single-flight APIs can accept explicit route trees for loader selection/hydration.
- The next cleanup target is the remaining reactivity-heavy single-flight cases that still depend on `Component.route(...)`; once those are migrated or intentionally isolated, we can make a cleaner call on deleting `Component.route(...)` / `Component.guard(...)`.
- Some single-flight-heavy cases have now moved to explicit route-tree hooks, but the remaining reactivity/service-driven cases still rely on routed-component registration semantics. That dependency is now narrower and concentrated mostly in `route-loader.test.ts` coverage.
- The next immediate implementation task is converting those remaining reactivity/service-driven single-flight tests to explicit route trees for initial cache seeding and revalidation, so we can see exactly what truly still depends on routed-component registration after that migration.
- Those reactivity/service-driven single-flight tests now use explicit route trees for selection and revalidation as well, which means the remaining `Component.route(...)` dependency is smaller than before and may now be limited to render/setup-specific routed-component behavior rather than single-flight orchestration itself.
- The next cleanup target is auditing that remaining `Component.route(...)` / `Component.guard(...)` dependency directly and separating true render/setup needs from historical compatibility plumbing.
- The next immediate step is migrating the remaining single-flight-heavy tests and callsites to pass explicit route trees through those new hooks so `Component.route(...)` can finally stop carrying that fallback responsibility.
- The next cleanup target is removing the remaining internal node-era helpers entirely where their only purpose is servicing already-migrated flows.
- `API.md` should now move from "legacy still exists" language toward a fully unified route-first story unless a concrete remaining public dependency still exists.

### Objectives

- Remove `AppRouteNode` from the runtime completely.
- Make runtime traversal and loader refresh route-based.

### Required interface changes

1. Update `RouterRuntimeConfig`:

Current:

```ts
readonly app: AppRouteNode<any, any, any, any, any, any>
```

Target:

```ts
readonly app: Route.AnyRoute
```

2. Update `navigateApp` to accept unified routes.

### Required internal changes

1. Replace `collectAppNodes` with unified route flattening.

2. Replace `matchedAppNodes` with matching against flattened unified routes using resolved full paths.

3. Remove all calls to `Route.componentOf(node)`.

4. When refreshing matched loaders:

- iterate matched unified routes
- use route-owned loader metadata
- use resolved `routeId`
- store loader data/errors keyed by route id or full pattern as before

5. Update snapshot creation so `appMatches` reports the matched route ids or paths from unified routes.

6. Ensure `navigateApp(route, options)` uses `Route.link(route)` and route extraction helpers based on the unified route type.

7. `navigateApp` should infer required params from the route argument. Callers should get immediate type errors if they omit required params or supply invalid query shapes.

8. Update doc comments in `src/RouterRuntime.ts` so `create`, `navigateApp`, snapshots, and related services describe the unified route model rather than node-based routing.

7. Ensure request preparation, revalidation, and runtime rendering use the unified route tree rather than any global node registry.

### High-risk areas in `src/RouterRuntime.ts`

- snapshot derivation currently depends on `node.path`, `node.kind`, and `node.options.exact`
- matched loader refresh currently materializes components from nodes
- all route traversal assumes a node tree, not a route tree

This is the largest implementation hotspot and should be treated as a dedicated refactor phase, not a quick follow-up.

## Workstream 11: Rebuild SSR and request rendering around unified routes

### Objectives

- Keep existing SSR/public behavior while switching internals to unified routes.

### Required changes in `src/Route.ts`

Update:

- `renderRequest`
- `renderRequestWithRuntime`
- route head resolution paths
- any helper that currently takes a materialized node component

### Required behavior

1. SSR render should be driven from the app route tree.

2. It should still:

- compute critical loader payloads
- compute deferred loader payloads/scripts
- provide server request/response services
- render the matched route tree
- accumulate route head data

3. Head callbacks must read from the route's typed loader data and params, not from old component decorations.

4. The public `RenderRequestResult` shape should remain unchanged unless a concrete improvement is required.

## Workstream 12: Rebuild `Route.link` and typed navigation around unified routes

### Objectives

- Preserve typed link generation.
- Remove support for old route node inputs.

### Required changes

1. Change `Route.link` to accept `Route<C, ...>` and `LayoutRoute<C, ...>`.

2. Remove node-specific overloads and `componentOf` fallback paths.

3. Ensure `Route.link(route)` uses:

- the route's resolved full pattern
- `paramsSchema` encoder if present
- `querySchema` encoder if present

4. Ensure `Route.Link` infers params and query from the `to` route.

5. Ensure JSX inference stays ergonomic. The common case should look like:

```tsx
<Route.Link to={UserRoute} params={{ id: "123" }} />
```

with no explicit generic annotations and precise prop errors.

5. Update any runtime navigation helpers that previously accepted route nodes.

### Testing requirements

- type tests for param and query inference
- runtime tests for encoded params
- runtime tests for encoded query values
- nested layout path generation tests

## Workstream 13: Implement `Component.lazy` and remove route-level lazy loading

### Objectives

- Move lazy loading responsibility to components.

### Required changes in `src/Component.ts`

1. Add `Component.lazy(fn)`.

2. `Component.lazy(fn)` should produce a component-like value that satisfies the input requirement for `Route.path`.

3. Ensure the lazy component preserves enough component typing for route extraction helpers and route wrapping.

4. Add clear doc comments for `Component.lazy`, especially around what it guarantees for route composition and any SSR/runtime caveats.

### Required changes in `src/Route.ts`

1. Remove `Route.lazy` as a route concern.

2. Ensure route matching, prefetching, and loader execution do not depend on the component being eagerly resolved.

### Testing requirements

- route with lazy component still matches and loads
- lazy component route still works with `Route.link`
- lazy component route still participates in SSR as intended, or document/decide SSR behavior if different

## Workstream 14: Preserve single-flight, cache, and reactivity behavior

### Objectives

- Keep all existing loader cache and single-flight capabilities while changing route representation.

### Required changes

1. Update `Route.setLoaderData`, `Route.setLoaderResult`, and `Route.seedLoader` to infer `LD` and `LE` from unified routes.

2. Update `Route.actionSingleFlight`, `Route.singleFlight`, `Route.mutationSingleFlight`, `Route.createSingleFlightHandler`, `Route.invokeSingleFlight`, and payload hydration helpers to use route ids from unified routes.

3. Ensure revalidation-by-reactivity still works when loader execution is tree-based.

4. Verify cache keys still use:

- stable route id
- decoded params shape that matches loader execution

### Important check

If params are now schema-decoded before loader execution, decide whether cache keys should use raw params or decoded params. Use one convention consistently everywhere.

Recommended approach:

- use decoded params for execution typing
- use the exact same decoded params for cache key generation so loader identity matches actual loader input

This also improves DX when debugging because runtime behavior matches the types the developer sees in loader callbacks.

## Workstream 15: Rebuild route collection and validation helpers

### Objectives

- Keep introspection utilities useful under the new route model.

### Required changes

1. Rewrite `Route.collect` to walk unified routes and route trees.

2. Rewrite `Route.validateLinks` to detect duplicate full patterns from unified routes.

3. Ensure helpers no longer depend on component-attached metadata or route-node materialization.

4. Ensure route collection can work on:

- a root route
- arrays of routes, if that use case is still intentionally supported
- nested children inside layout routes

## Workstream 16: Update tests comprehensively

### Objectives

- Rewrite type tests and runtime tests around the unified route authoring model.
- Delete tests that only exist to verify removed APIs.

### Type tests to add or rewrite

Files likely affected:

- `src/type-tests/component-route-bridge.ts`
- `src/type-tests/route-node-pipes.ts`
- `src/type-tests/route-loader-types.ts`
- `src/type-tests/route-link.ts`
- `src/type-tests/router-runtime.ts`

Required assertions:

1. `Route.path("/users/:id")` infers `{ readonly id: string }`
2. `Route.path` plus `Route.paramsSchema(...)` replaces params type
3. `Route.querySchema(...)` and `Route.hashSchema(...)` replace query/hash types
4. `Route.loader(...)` callback sees inferred `P` and `Q`
5. `Route.title(...)` callback sees `LD`
6. `Route.meta(...)` callback sees `LD`
7. `Route.LoaderErrorOf<typeof route>` reflects typed loader errors
8. `Route.children(...)` is rejected before `Route.layout()`
9. `Route.link(route)` infers params/query from the route
10. `RouterRuntime.navigateApp(route, ...)` accepts unified routes
11. route helper signatures do not require explicit generics in the normal path
12. JSX `Route.Link` inference remains precise
13. loader result and loader error helpers preserve actual `LD` / `LE` types

### Type-test depth

Add negative type tests as well as positive ones. For example:

- calling `Route.children(...)` before `Route.layout()` fails
- passing a number where an inferred string path param is expected fails
- passing raw string params after `paramsSchema` converted them to numbers fails
- navigating without required params fails
- attaching a second loader fails

### Runtime tests to add or rewrite

Files likely affected:

- `src/__tests__/route.test.ts`
- `src/__tests__/route-loader.test.ts`
- `src/__tests__/router-runtime.test.ts`

Required coverage:

1. Matching and param extraction from unified routes
2. Relative child paths under layouts
3. Index route matching
4. Link generation from unified routes
5. Loader execution and caching
6. Parent-dependent loaders
7. Guard execution and redirect/not-found behavior
8. Route head resolution from loader data
9. Runtime snapshots and matched route reporting
10. SSR rendering with critical/deferred loader payloads
11. Single-flight hydration and route-seeded loader results

### Tests to delete

Delete tests whose only purpose is to validate removed APIs such as:

- `Component.route`
- route-node constructors
- `Route.componentOf`
- `Route.titleFor`
- `Route.metaFor`
- `Route.loaderErrorFor`

## Workstream 17: Cleanup exports and final public surface

### Objectives

- Ensure the exported API matches ADR-006 and contains no removed legacy surface.

### Required changes

1. Audit the `Route` export object at the bottom of `src/Route.ts`.

Remove old exports and ensure it contains the unified surface only.

2. Audit the `Component` export object at the bottom of `src/Component.ts`.

Remove:

- `route`
- `guard`

Add:

- `lazy`

if it is implemented there.

3. Audit any barrel exports or root index files so the removed legacy APIs are not still exported indirectly.

4. Ensure `RouterRuntime` types no longer import or expose `AppRouteNode`.

5. Audit `API.md` after the export cleanup so the documented surface exactly matches the final exported surface.

## Recommended Execution Order

The safest implementation order is:

1. Introduce unified route types and route factory in `src/Route.ts`
2. Implement `Route.path` and extraction helpers
3. Rewrite route pipe helpers around unified routes
4. Rebuild route tree and path resolution helpers
5. Rebuild route matching and param extraction support
6. Rebuild loader execution and route context provisioning
7. Rebuild route-aware rendering internals in `src/Component.ts`
8. Rebuild `src/RouterRuntime.ts`
9. Rebuild SSR and request rendering paths
10. Rebuild `Route.link` and typed navigation
11. Add `Component.lazy` and remove route lazy concerns
12. Update single-flight/cache integrations
13. Rewrite tests
14. Remove leftover legacy code and exports

This order minimizes periods where runtime code and route definitions disagree on the source of truth.

## Detailed File-by-File Plan

### `src/Route.ts`

Primary responsibilities after the refactor:

- unified route types
- route factory and pipe steps
- matching/path utilities
- route tree utilities
- loader execution
- SSR helpers
- link generation
- route validation
- route context exports
- single-flight route helpers

Concrete tasks:

- define `Route<C, P, Q, H, LD, LE>` and `LayoutRoute<C, P, Q, H, LD, LE>`
- remove node types and materialization helpers
- replace component-decoration-based route ownership with route-owned metadata
- add `Route.path`
- rewrite all route pipe helpers
- rewrite collect/validate/tree helpers
- rewrite loader execution helpers
- rewrite SSR helpers
- rewrite link generation and navigation helpers
- update exports
- keep public doc comments current as helpers are rewritten
- reduce temporary casts over time; do not leave `as any`-heavy internals as the long-term route implementation

### `src/Component.ts`

Primary responsibilities after the refactor:

- generic component machinery
- optional private route rendering support used by unified routes
- lazy component creation

Concrete tasks:

- delete `Component.route`
- delete `Component.guard`
- add `Component.lazy`
- remove legacy route metadata preservation paths that are no longer needed
- keep `pipe` unchanged unless an implementation detail unexpectedly requires extra overloads
- add or update doc comments for any touched public component APIs
- avoid normalizing `Component.from(() => null)` as the required entrypoint for route authoring if a more direct route-building API can be introduced cleanly

### `src/RouterRuntime.ts`

Primary responsibilities after the refactor:

- route-tree-based navigation/runtime state
- matched route tracking
- loader refresh and revalidation
- request/render/dispatch runtime integration

Concrete tasks:

- replace all `AppRouteNode` references with unified routes
- replace node flattening and matching logic
- remove route materialization steps
- update `navigateApp` to use unified routes
- keep public runtime API stable where practical
- rewrite outdated runtime doc comments to reflect the unified route model

### `src/router-runtime.ts`

Primary responsibilities after the refactor:

- loader cache machinery only

Concrete tasks:

- verify cache key generation still matches the new loader input convention
- update nothing else unless unified-route execution requires different key material

### `src/__tests__/*` and `src/type-tests/*`

Concrete tasks:

- rewrite all route authoring to `Component.pipe(Route.path(...), ...)`
- remove tests for deleted APIs
- add inference coverage for the new route chain

### `API.md`

Concrete tasks:

- replace legacy routing examples with unified route examples
- remove deleted APIs from the reference surface
- document the recommended route-authoring flow in the same terminology used by the code
- ensure examples reflect the final inference story and avoid unnecessary generic annotations

## Risk Register

### Risk 1: Route metadata split persists accidentally

If some metadata remains on components while some moves onto routes, the project will still have a dual system internally.

Mitigation:

- make route-owned metadata the source of truth immediately
- remove old component mutation helpers rather than forwarding them

### Risk 2: Nested matching breaks with relative child paths

The current runtime heavily assumes a flat `path` field on route nodes.

Mitigation:

- centralize full-path resolution
- use the same resolver in validation, matching, link generation, and runtime traversal

### Risk 3: Loader callback inference regresses

`Route.loader` is the most inference-sensitive step in the chain.

Mitigation:

- implement type tests before finalizing helper signatures
- use `NoInfer`
- do not accept callback generics that re-infer `P` or `Q`

### Risk 4: Parent loader dependency logic remains string-prefix-based

The current `findParentPattern(...)` approach is weaker than the new tree model allows.

Mitigation:

- derive parent relationships from actual route tree structure
- only use resolved full patterns for identification, not for discovering hierarchy

### Risk 5: RouterRuntime becomes partially migrated

If runtime code still expects nodes while route definition code emits unified routes, the system will become unstable quickly.

Mitigation:

- treat `src/RouterRuntime.ts` as a dedicated rewrite phase
- do not leave mixed node/route support in place

## Verification Checklist

Before considering the work complete, verify all of the following:

- `Component.make(...).pipe(Route.path(...), ...)` is the only route authoring path in the codebase
- no `AppRouteNode` types remain
- no `Component.route` or `Route.page` exports remain
- nested layouts and index routes work with relative paths
- `Route.link(route)` works from unified routes
- core route helpers infer types without explicit generic annotations in normal usage
- editor-facing hover types for route values and callbacks remain readable
- `API.md` matches the final public routing/runtime/component API surface
- touched public APIs have useful doc comments, especially for inference-sensitive helpers
- the final routing core avoids unnecessary assertions, especially `as any`
- common route authoring does not depend on placeholder `null` components just to satisfy the API shape
- `RouterRuntime.create({ app, ... })` accepts unified routes and no longer imports node types
- loader execution, SSR, route head, and single-flight functionality still work
- all type tests pass
- all runtime tests pass
- `npm run typecheck` passes
- `npm test` passes
- `npm run build` passes

## Final Definition of Done

ADR-006 is fully implemented when:

- a route is always created by piping `Route.path(...)` onto a component
- all route metadata is accumulated through the route pipe chain
- layout routes and children are first-class in the unified route type system
- route context, loader data, title/meta inference, and typed links all flow from the unified route type
- TypeScript DX is excellent: the common route-authoring path requires little or no manual type annotation, and invalid route usage fails at the local callsite with useful errors
- `API.md` is up to date and public APIs introduced or changed by the refactor are documented clearly
- touched public APIs and non-obvious helpers have helpful doc comments
- the final routing implementation uses assertions sparingly and avoids `as any` except at truly unavoidable boundaries
- common route authoring does not require placeholder `null` components just to define or compose routes
- runtime, SSR, validation, and navigation consume unified routes directly
- old route-node and component-route APIs are deleted
- the test suite has been rewritten to prove the new routing model end to end
