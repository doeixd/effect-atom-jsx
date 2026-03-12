# Component System Implementation Plan (Deep Pass)

This plan is aligned to the latest `docs/component.md` (including the setup-as-Effect model and Effect subsystem integration details).

## 1. Target Architecture

We are introducing a first-class primitive:

- `Component<Props, Req, E>`

with these invariants:

- setup is an `Effect`
- `Req` models environment requirements (services/layers)
- `E` models typed error channels
- lifecycle is managed by `Scope` and fibers
- composition is pipe-first
- rendering remains synchronous/reactive

The intended layering is:

- setup/config/lifecycle in Effect world
- rendering in reactive JSX world
- explicit bridges both directions (`setupEffect`, `renderEffect`, atom/action effect helpers)

## 2. Canonical Type and Runtime Model

### Core shape

```ts
interface Component<Props, Req, E> {
  (props: Props): JSX.Element;
  pipe: ...;
  readonly [ComponentTypeId]: {
    readonly Props: Props;
    readonly Req: Req;
    readonly E: E;
  };
}
```

### Canonical constructor contract

- `setup: (props: Props) => Effect<Bindings, ESetup, Req | Scope>`
- `view: (props: Props, bindings: Bindings) => JSX.Element` (pure default)

### Inference rules

- `Props` inferred from `props/propsSchema`
- `Req` inferred from setup `R` channel and/or explicit `require`
- `E` inferred from setup + component-level async channels + transform narrowing

## 3. v1 Feature Envelope

### Must ship

- constructors: `make`, `from`, `headless`
- prop contracts: `props`, `propsSchema`
- requirement contracts: `require`, metadata extractors (`Requirements`, `Errors`, `PropsOf`)
- setup-effect primitives:
  - `query`, `state`, `derived`, `action`, `ref`, `fromDequeue`
- bridges:
  - `setupEffect`, `renderEffect`
- transforms:
  - `withLayer`, `withErrorBoundary`, `withLoading`, `withSpan`, `memo`
  - `tapSetup`, `withPreSetup`, `withSetupRetry`, `withSetupTimeout`
- mount:
  - `Component.mount(component, options)`

### Defer (v1.1+)

- slot DSL (`slots`, `slot`)
- higher-order composition (`compose`, `layout`, `withLayout`)
- component families
- design-system wrapper helpers (`withView`)
- transactional state (`transactionalState`, STM helpers)
- diagnostics/devtools tree API (fiber/scope introspection)

## 4. Effect Subsystem Integration Requirements

## 4.1 Scope integration (non-negotiable)

- each component instance has a dedicated scope
- all setup-created resources attach to that scope
- owner cleanup delegates to scope closure
- no dual cleanup authority

Required behavior:

- parent close closes descendants first
- finalizer failures do not block sibling finalizers
- cleanup errors are observable via optional mount callback/service

## 4.2 Fiber topology

Per component instance maintain at least:

- `queryScope`: restartable fibers (dependency-driven)
- `actionScope`: persistent fibers (component lifetime)

Action options (v1):

- `concurrency: "switch" | "queue" | "drop" | { max: number }`
- `detached?: boolean` to promote lifetime beyond current component scope

## 4.3 Error and interruption semantics

- typed failure, defect, interruption must stay distinct
- typed boundary matching must be tag/schema precise
- interruptions are lifecycle events, not user-visible errors by default
- unhandled typed failures bubble to nearest boundary channel

## 4.4 Layer lifecycle

- layer provisioning uses Effect layer semantics (acquire/release)
- layer build failures become typed errors
- `withLayer` narrows `Req`
- optional advanced rebuild strategy for reactive dependency changes is deferred unless minimal safe subset is feasible in v1

## 4.5 Scheduling

- component-scoped scheduling helpers cancel with scope
- query-level schedules remain supported
- document drift/throttling behavior in background tabs (fixed vs spaced semantics)

## 4.6 Communication primitives

- `PubSub.subscribe`/`Queue` integrations are scoped
- `fromDequeue` must fork worker fiber scoped to component
- backpressure defaults for UI event buses should be explicit and documented

## 4.7 Context strategy

- service context is Effect-native (`yield* Tag`) in setup
- no duplicate framework-specific service context abstraction
- reactive context values are modeled by atoms inside services

## 5. Public API Plan (Detailed)

## 5.1 Core namespace

- `Component.make(...)`
- `Component.from(...)`
- `Component.headless(...)`
- `Component.props<P>()`
- `Component.propsSchema(schema)`
- `Component.require(...tags)`
- type helpers: `Component.Requirements<T>`, `Component.Errors<T>`, `Component.PropsOf<T>`

## 5.2 Setup-effect helpers

- `Component.query(effect, options?)`
- `Component.state(initial)`
- `Component.derived(fn)`
- `Component.action(fn, options?)`
- `Component.ref<T>()`
- `Component.fromDequeue(dequeue, handler, options?)`

## 5.3 Transform helpers

- `Component.withLayer(layer)`
- `Component.withErrorBoundary(handlers)`
- `Component.withLoading(fallback)`
- `Component.withSpan(name, attrs?)`
- `Component.memo(eq)`
- `Component.tapSetup(effectfulTap)`
- `Component.withPreSetup(effect)`
- `Component.withSetupRetry(schedule)`
- `Component.withSetupTimeout(duration)`

## 5.4 Bridges and mounting

- `Component.setupEffect(component, props)`
- `Component.renderEffect(component, props)`
- `Component.mount(component, { layer, target, ... })`

## 6. Implementation Roadmap

## Phase A - Type System and Skeleton

Work:

- add `src/Component.ts` with branded type and constructor skeleton
- add metadata extraction types
- implement `.pipe(...)` behavior

Files:

- `src/Component.ts`
- `src/index.ts`
- `src/type-tests/component-core.ts`

Acceptance:

- inference for `Props/Req/E` works in simple and transformed cases

## Phase B - Setup-as-Effect Execution Engine

Work:

- run setup inside component scope
- create setup helper effects (`state/query/derived/action/ref/fromDequeue`)
- ensure setup-run-once semantics per mount instance

Files:

- `src/Component.ts`
- integrate `src/component-scope.ts`, `src/effect-ts.ts`, `src/Atom.ts`
- `src/__tests__/component-setup-runtime.test.ts`
- `src/type-tests/component-setup-effect.ts`

Acceptance:

- automatic cleanup is scope-driven
- helper effects compose with Effect combinators

## Phase C - Fibers, Concurrency, and Detach Semantics

Work:

- split query and action lifetimes
- implement action concurrency options
- implement detached action behavior

Files:

- `src/Component.ts`
- `src/__tests__/component-action-concurrency.test.ts`

Acceptance:

- race scenarios deterministic and documented

## Phase D - Errors, Boundaries, and Interruption

Work:

- implement typed error boundary routing
- preserve defect channel semantics
- formalize interruption observability

Files:

- `src/Component.ts`
- `src/__tests__/component-errors-boundaries.test.ts`
- `src/type-tests/component-error-narrowing.ts`

Acceptance:

- boundary narrowing reflected in `E`
- interruption never incorrectly reported as typed failure

## Phase E - Layer and Mount

Work:

- implement `Component.mount`
- implement `withLayer` narrowing and runtime behavior
- add layer build error handling options (`onBuildError`, retry hook if in-scope)

Files:

- `src/Component.ts`
- mount integration points
- `src/__tests__/component-layer-mount.test.ts`

Acceptance:

- layer acquire/release tied to scope
- build failures are catchable/renderable

## Phase F - Observability and Supervision

Work:

- automatic setup span wrapper in constructor
- setup transform wrappers (`withSpan`, retry, timeout, tap, pre-setup)
- optional supervisor integration in mount options

Files:

- `src/Component.ts`
- `src/__tests__/component-observability.test.ts`

Acceptance:

- no-op when tracer/metrics unavailable
- trace trees align with component/fiber structure

## Phase G - Headless Contracts

Work:

- finalize `Component.headless` contracts and typing
- ensure render-prop binding typing and ergonomics
- stabilize `setupEffect` no-DOM test workflow

Files:

- `src/Component.ts`
- `src/__tests__/component-headless.test.ts`
- `examples/headless-combobox/`

Acceptance:

- headless behavior fully testable in Effect scope without DOM

## Phase H - Communication and Scheduling Helpers

Work:

- add `schedule`/`scheduleEffect` helpers if not already covered by primitives
- finalize `fromDequeue` options and defaults
- publish pubsub/queue reference patterns

Files:

- `src/Component.ts`
- `src/__tests__/component-schedule-bus.test.ts`

Acceptance:

- no leaks under rapid mount/unmount
- clear behavior under backpressure

## Phase I - Docs, Migration, and Release

Work:

- author `docs/COMPONENTS.md`
- update `README.md`, `docs/API.md`, `docs/TESTING.md`, redesign status tracker
- add migration guidance from plain function components
- finalize changelog + release checklist

Acceptance:

- examples compile and reflect shipped signatures
- release gates green

## 7. Compatibility and Migration Strategy

- keep plain function components fully supported during rollout
- `Component.from` enables incremental adoption
- avoid forcing immediate tree-wide migration
- document when to choose:
  - function component
  - full component
  - headless component

## 8. Required Test Matrix

Type tests:

- `Req` propagation and elimination (`withLayer`)
- `E` narrowing (`withErrorBoundary`)
- setup `R/E` inference and transform composition

Runtime tests:

- scope close ordering and finalizer behavior
- setup failure vs query failure behavior
- action concurrency modes
- detached action lifetime
- layer build failure/fallback behavior
- pubsub dequeue cleanup and backpressure
- interruption semantics
- headless setup + render-prop contract

Stress/edge tests:

- rapid mount/unmount in same microtask
- parent/child unmount simultaneously
- setup timeout + retry interactions
- action running during reactive reconfiguration

## 9. Open Design Decisions (Must Resolve)

- how interruption is surfaced (diagnostics-only vs explicit result channel helper)
- exact strategy for bubbling unhandled typed failures (boundary channel implementation)
- whether reactive layer rebuild support is included in v1
- strictness achievable for compile-time mount requirement validation with JSX tree limits
- API shape for supervisor/diagnostics exposure

## 10. Milestones and Exit Criteria

- [ ] A: core types and constructors
- [ ] B: setup-effect execution
- [ ] C: concurrency and lifetimes
- [ ] D: errors and boundaries
- [ ] E: layers and mount
- [ ] F: observability
- [ ] G: headless contracts
- [ ] H: bus/scheduling helpers
- [ ] I: docs + release

Final release criteria:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm pack --dry-run`
- docs and changelog aligned with shipped APIs

## 11. Principles

- Effect-native setup, reactive-native rendering
- scope correctness over shortcuts
- typed requirement/error contracts over conventions
- composable pipe transforms over one-off options
- incremental adoption, no forced rewrite
