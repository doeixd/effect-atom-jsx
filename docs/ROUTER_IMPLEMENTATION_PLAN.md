# Router Implementation Plan

This plan implements the routing architecture described in `docs/router.md` with the simplified model as the default: routes are components, matching is conditional mount/unmount, and the component tree is the route tree.

## 1) Product Goals

- Add routing as a first-class **pipeable component capability** (`Component.route(...)`).
- Keep routing Effect-native and Layer-native:
  - navigation is an `Effect`
  - URL state is an atom in a router service
  - implementations are provided via `Layer`.
- Provide **schema-typed params/query/hash** and **type-safe link factories**.
- Preserve existing component scope semantics (mount/unmount, cleanup, fiber interruption).
- Avoid over-engineered route trees/outlets by default; support optional ergonomics (`Route.Switch`) only where needed.

## 2) Core Design Decisions

- **Route attachment model:** `Component.route(pattern, options?)` wraps component setup/view with reactive URL-match gating.
- **Relative pattern model:** child route patterns resolve relative to nearest matched parent route prefix.
- **Type binding model:** routed components carry route metadata type parameters (`P`, `Q`, `H`) inferred from Schema.
- **Router service model:** `Router` service provides `url`, `navigate`, `back`, `forward`, optional `preload`.
- **Link model:** `Route.link(routedComponent)` derives a typed URL builder from route metadata.
- **Metadata/guard model:** additional route features are composable pipes (`Route.guard`, `Route.title`, `Route.meta`, `Route.transition`, `Route.lazy`).

## 3) API Surface (target)

### Component pipe

- `Component.route(pattern, options?)`
  - `options.params?: Schema.Schema<P, any, any>`
  - `options.query?: Schema.Schema<Q, any, any>`
  - `options.hash?: Schema.Schema<H, any, any>`
  - `options.exact?: boolean`
  - `options.onParseError?: "not-found" | "error" | ((error) => Effect.Effect<void>)`

### Route namespace

- `Route.params` / `Route.query` / `Route.hash` accessors (typed within routed setup context)
- `Route.link(routed)` -> typed URL factory
- `Route.Link` component
- `Route.queryAtom(key, schema, options)`
- `Route.matches(pattern)` helper atom accessor
- Optional ergonomics:
  - `Route.Switch` (first-match rendering)
  - `Route.collect(component)` route metadata extraction
  - `Route.validateLinks(...)` static/runtime validation helper

### Route pipes

- `Route.guard(effectFactory)`
- `Route.title(titleOrFactory)`
- `Route.meta(metaOrFactory)`
- `Route.transition({ enter?, exit? })`
- `Route.lazy(importer, routePipeOrOptions, options?)`

### Router service + layers

- `Router.Browser`
- `Router.Hash`
- `Router.Server(request)`
- `Router.Memory(initial?)`

## 4) Types and Metadata Model

- Introduce `RoutedComponent<Props, Req, E, P, Q, H>` brand extension over `Component`.
- Route metadata payload stored on component internals:
  - `pattern`, `exact`, schemas, parse behavior, guard chain, transition/meta/title/lazy config.
- Route context services (scoped per match):
  - `RoutePrefix` (string)
  - `RouteParams<P>`
  - `RouteQuery<Q>`
  - `RouteHash<H>`
- Accessor narrowing strategy:
  - inside routed setup, accessors resolve to schema output types.

## 5) Implementation Phases

## Phase A — Foundations: Router Service and Matching Engine

Files:
- `src/Route.ts` (new)
- `src/router-runtime.ts` (new)
- `src/index.ts` exports
- `package.json` subpath exports (`./Route`)

Work:
- Define `Router` service contract.
- Implement `Browser`, `Hash`, `Server`, `Memory` layers.
- Add URL matching utilities:
  - compile pattern
  - match pathname
  - extract params
  - consume prefix for nested relative matching.

Acceptance:
- Router layers compile and expose reactive URL atom + navigation functions.

## Phase B — `Component.route` Pipe and Scoped Route Context

Files:
- `src/Component.ts` (route pipe integration)
- `src/Route.ts`
- `src/component-scope.ts` (if scope hooks needed)

Work:
- Add `Component.route(pattern, options?)`.
- Wrap setup and view with match-checking logic:
  - unmatched => no inner setup; view renders null
  - matched => parse params/query/hash; provide scoped route context; run inner setup.
- Ensure parse errors respect `onParseError` behavior.

Acceptance:
- Routed components mount/unmount on URL changes and cleanup is preserved.

## Phase C — Schema-Typed Params/Query/Hash

Files:
- `src/Route.ts`
- `src/type-tests/route-typing.ts` (new)
- `src/__tests__/route-parse.test.ts` (new)

Work:
- Use Effect Schema decoders/encoders for params/query/hash.
- Type `Route.params/query/hash` by route schema output.
- Support coercions (`NumberFromString`, `BooleanFromString`, etc.).

Acceptance:
- Correct type inference in setup.
- Invalid URL payload behavior covered by tests.

## Phase D — Type-Safe Link Factories and Link Component

Files:
- `src/Route.ts`
- `src/__tests__/route-link.test.ts` (new)
- `src/type-tests/route-link.ts` (new)

Work:
- Implement `Route.link(routed)`.
- Implement typed URL encoding for params/query/hash.
- Implement `Route.Link` component:
  - typed props from link factory
  - client-side navigation via router service
  - active-state callback/class support.

Acceptance:
- Invalid link params/query fail type-tests.
- Link runtime output/behavior validated.

## Phase E — Relative Routing and Parent Prefix Propagation

Files:
- `src/Route.ts`
- `src/__tests__/route-nested.test.ts` (new)

Work:
- Propagate matched prefix to routed descendants.
- Resolve child patterns relative to parent prefix.
- Optional `Route.Switch` implementation for first-match ergonomics.

Acceptance:
- Nested relative route behavior matches spec examples.

## Phase F — Query Atom Two-Way Binding

Files:
- `src/Route.ts`
- `src/__tests__/route-query-atom.test.ts` (new)
- `src/type-tests/route-query-atom.ts` (new)

Work:
- Implement `Route.queryAtom(key, schema, { default })`:
  - read: URL -> schema decode -> atom value
  - write: value -> schema encode -> URL update
  - remove key when equals encoded default.

Acceptance:
- URL and atom stay in sync across navigate/back/forward and atom writes.

## Phase G — Guards, Titles, Metadata, Transitions

Files:
- `src/Route.ts`
- `src/__tests__/route-guards-meta.test.ts` (new)

Work:
- Add route pipes:
  - `Route.guard`
  - `Route.title`
  - `Route.meta`
  - `Route.transition`
- Ensure guard requirements/errors merge into component types.

Acceptance:
- Guards block/redirect mount as expected.
- Title/meta side effects and transition descriptors are wired.

## Phase H — Lazy Route Components and Preload Hooks

Files:
- `src/Route.ts`
- `src/__tests__/route-lazy-preload.test.ts` (new)

Work:
- Implement `Route.lazy(...)` wrapper with loading fallback.
- Add optional `preload` integration for `Route.Link` hover behavior.

Acceptance:
- Lazy route matches by metadata and loads implementation on demand.

## Phase I — Route Collection and Tooling Hooks

Files:
- `src/Route.ts`
- `src/__tests__/route-collect.test.ts` (new)

Work:
- Implement `Route.collect(component)` extraction utility.
- Implement optional `Route.validateLinks(...)` helper.

Acceptance:
- Route metadata can be inspected for docs/sitemap/tooling.

## Phase J — Docs, Examples, and Release Hardening

Files:
- `docs/API.md`
- `README.md`
- `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md`
- `CHANGELOG.md`
- `examples/router-basic/*` (new)
- `examples/router-typed-links/*` (new)

Work:
- Add end-to-end examples for:
  - basic routed components
  - nested relative routes
  - typed links/query schemas
  - guards and query atom usage.

Acceptance:
- Full route docs and examples aligned with implementation.

## 6) Test Matrix

Type tests:
- `Component.route` inference for params/query/hash.
- `Route.link` param/query argument checking.
- Guard requirement/error union behavior.
- Query atom schema decode/encode typing.

Runtime tests:
- Browser/Hash/Memory router navigation behavior.
- Match/unmount cleanup correctness.
- Nested prefix resolution.
- Parse error modes (`not-found`/`error`/custom).
- Link navigation + active state.
- Query atom URL synchronization.

## 7) Non-Goals / Defer

- Central route tree as mandatory configuration.
- Mandatory outlet pattern.
- Full SSR head manager integration beyond metadata collection hook.

## 8) Risks and Mitigation

- **Type complexity for routed context narrowing**
  - Mitigate with explicit branded routed component type + focused type-tests.
- **URL parsing edge cases**
  - Mitigate with deterministic parser utilities and schema-only transform path.
- **Lifecycle race conditions during rapid navigation**
  - Mitigate by binding setup to component scope and interrupting stale fibers on unmatch.

## 9) Execution Order (Practical)

1. Phase A-B-C (core service + route pipe + schema parse)
2. Phase D-E (links + nested relative behavior)
3. Phase F-G (query atom + guards/meta/title/transition)
4. Phase H-I (lazy/preload + collection)
5. Phase J (docs/examples/hardening)

## 10) Definition of Done

- `npm run typecheck` green.
- Full test suite green with added router tests/type-tests.
- `npm run build` and `npm pack --dry-run` green.
- Docs/changelog/status updated and examples runnable.
