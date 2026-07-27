# Resumability Implementation Plan

Status: implementation started (Milestones 0–1)

This plan turns the exploration in `resummeability.txt` into an implementation
sequence for AF-UI. The source document correctly identifies the library's
setup-to-bindings-to-view boundary as a strong foundation, but the target is not
to copy Qwik or to declare the existing hydration path resumable.

The first target is narrower and testable:

> Make `effect-atom-jsx` a supported host for an independently implemented
> resumability adapter, and prove that support with one resumable event/action
> vertical slice.

Full component-free startup, resumable queries, serialized reactive
subscriptions, and independently loadable view expressions are later capability
levels. They should build on the same protocols without changing ordinary
component authoring.

## Goal

- Preserve the current AF-UI component model:
  `Component<Props, Req, E, Bindings, SlotContract> -> View<Slots>`.
- Add a small advanced protocol for portable code identities, serializable
  captures, component/setup inspection, handle inspection, and render
  instrumentation.
- Let an adapter collect SSR metadata and restore supported behavior in a fresh
  client runtime without importing private internals.
- Keep hydration as the existing state-seeding mechanism; define resumability
  as restoring executable relationships without replaying the component tree.
- Support progressive capability instead of making all components resumable or
  rejecting ordinary closures.

## Definition of Done

The adapter-enablement work is complete when all of the following are true:

1. A test adapter uses only public advanced APIs and the normal runtime/compiler
   ABI. It does not import private component, atom, owner, signal, or DOM state.
2. The server renders a component whose event targets a portable action,
   serializes the action identity and schema-validated captures through a JSON
   round trip, and emits a stable event marker.
3. A fresh client runtime installs the resume manifest and delegated event
   loader without running the component's setup or view.
4. Dispatching the event loads the addressed action, restores its captures,
   resolves its Effect requirements from a new client Layer/Scope, and executes
   it exactly once.
5. The server setup scope is closed before client execution, proving that no
   server service instance, closure, Scope, Fiber, DOM handle, or finalizer was
   transferred.
6. An equivalent component using an opaque closure is classified as requiring
   fallback activation; it is never silently serialized as portable behavior.
7. Component wrappers preserve slot-contract, route, definition, setup-plan,
   and behavior-attachment metadata.
8. Portable action/query/behavior overloads preserve their argument, success,
   typed error, and Effect requirement axes in compile-time tests.
9. The existing ordinary runtime, hydration, SSR, JSX, component, style,
   behavior, route, and single-flight tests remain green.
10. Documentation clearly distinguishes hydration, partial portability, and
    full resumability and states the security and deployment-version rules.

The repository release gates remain:

- `npm run typecheck`
- `npm run typecheck:tests`
- `npm run typecheck:examples`
- `npm test`
- `npm run build`

A focused end-to-end resume test must also be part of `npm test`; compilation
alone is not an adequate completion signal.

## Non-Goals For The First Deliverable

- No promise of Qwik-equivalent fine-grained resumability.
- No eager redesign of `Component.make`, `Component.setup`, `Component.bind`,
  `Component.state`, `Component.query`, `Component.action`,
  `Component.withBehavior`, `Component.withSlots`, or `Component.mount`.
- No requirement that application authors use `$`-suffixed APIs.
- No module URLs or bundler chunk names in core public types or wire payloads.
- No serialization of arbitrary JavaScript closures, Effect Contexts, Layers,
  Scopes, Fibers, live service objects, DOM nodes, streams, subscriptions, or
  resource handles.
- No automatic serialization of every value reachable from setup.
- No claim that `View.Slots` identifies physical DOM nodes. Slot contracts are
  structural metadata; DOM expression and event identities still belong to the
  renderer/compiler boundary.
- No compiler extraction in the metadata-only foundation.
- No serialization or replay of logical `Event`/PubSub traffic.

## Terminology And Capability Levels

Use these terms consistently:

- **Hydration** restores selected values and then reconstructs the client
  application by running setup/view code.
- **Portable** means a value has enough supported metadata to be represented
  across runtimes. Portability alone does not mean it will be resumed lazily.
- **Resumption** restores a specific relationship or executable entry point
  without replaying the component tree that originally discovered it.
- **Activation fallback** runs an opaque component/setup/handler when the
  requested relationship was not portable.
- **Code identity** is a stable logical symbol. It is not a chunk URL.
- **Render identity** is document-local identity assigned during one SSR
  collection session.

Capability levels:

1. **Ordinary runtime** — current behavior; no resume metadata required.
2. **Partially portable** — supported snapshots and descriptors cross the
   boundary; opaque portions activate through an explicit fallback.
3. **Addressable behavior** — actions, queries, or behaviors use stable code
   identities and serializable captures.
4. **Fine-grained resumability** — reactive subscriptions and view expressions
   are addressable, so updates patch existing SSR DOM without reconstructing a
   component.

The first Definition of Done reaches level 3 for a direct event/action path.

## Current-State Findings

The implementation should build on these existing seams:

- Component setup and view are already separate, and bindings are the committed
  setup snapshot.
- Named setup-builder steps exist, but they are currently reduced to executable
  closures and their names/kinds are not retained as inspectable data.
- Internal components retain setup and view functions but have no stable
  definition record.
- Component wrappers create new component values. Route and slot decorations
  are copied selectively, so new definition metadata needs one canonical
  preservation path.
- `Component.setupEffect`, `Component.renderEffect`, and
  `Component.renderViewEffect` already expose useful high-level seams, but there
  is no supported way to render from already restored bindings.
- Component state, query, and action helpers return callable live handles tied
  to reactive owners, Effect Contexts, and setup lifetimes. Their public shapes
  can remain callable, but the handles need optional inspection protocols.
- Scalar and family hydration identities already exist. They should be reused
  for value continuity rather than replaced by a second snapshot system.
- The schema-backed `Serialization` service is the correct codec boundary.
  Resume manifests need their own versioned schemas and must not widen the
  loader-result wire format.
- Semantic Reactivity already supports read/invalidation capture. Low-level
  signal-to-computation subscriptions are still heap relationships and do not
  yet have stable serializable identities.
- Typed view trees and event holes are useful optional metadata, but ordinary
  compiled JSX is still the production render path.
- The JSX compiler currently emits calls for templates, inserts, component
  creation, prop spreading, delegated-event registration, and an
  `addEventListener` helper. The runtime/compiler ABI must be characterized and
  tested before adding source metadata parameters.
- The current SSR virtual DOM ignores host listeners. A collector therefore
  cannot discover SSR events until the compiler-facing event helper reports
  them and writes markers.
- SSR and hydration use ambient module state. Instrumentation must be installed
  per render with strict enter/leave cleanup and must not introduce a
  request-shared collector.

## Architectural Decisions

### 1. Portable description is optional

Normal execution continues to use executable values. A portable value adds a
read-only description that adapters may consume. An ordinary function remains
valid and is explicitly classified as opaque.

### 2. Runtime descriptors and wire records are different types

A runtime descriptor may contain callbacks, Schema values, diagnostic
information, and live inspection functions. A wire record contains only
versioned, encoded data and stable identities.

No descriptor object should be passed directly to `JSON.stringify`.

### 3. Code references use logical IDs

The advanced `Resume` module should introduce:

- a branded `CodeRef` carrying a stable logical ID and a runtime loader;
- a branded `BoundCodeRef` carrying a code reference, captures, and an optional
  capture codec;
- constructors and type guards;
- one internal/exposed `Executable` union used by existing APIs.

The runtime loader is not serialized. The wire payload stores the logical ID,
and a build-generated or adapter-provided manifest maps that ID to an import.
Every payload also carries a build/protocol identity. Unknown code IDs and
build mismatches fail closed or enter an explicitly configured fallback.

Dynamic import and manifest resolution failures must have a deliberate typed
error model for portable overloads; they must not become unlabelled defects.

### 4. Capture schemas define full portability

Manual bound captures may omit a schema for ordinary in-memory execution, but
the SSR collector must classify them as nonportable unless a registered codec
can encode and validate them. Compiler-generated primitive codecs may satisfy
the same rule later.

Services are never captures. Loaded Effects resolve requirements from the
current client runtime.

### 5. Setup plans preserve authorship without becoming an AST

Named setup builders should retain immutable step descriptors containing:

- optional binding name;
- step kind (`binding`, `value`, `effect`, or `fragment`);
- executable step used by the ordinary runtime;
- optional resume policy/metadata.

Raw setup functions remain supported and receive an `opaque` plan. The core
does not attempt to parse Effect programs or arbitrary closures.

### 6. Binding policies are explicit and conservative

Use one policy vocabulary:

- `snapshot` — encode supported current data and restore a new runtime handle;
- `recompute` — omit current data and recreate from portable code on demand;
- `client` — acquire a new client-owned resource in a new client Scope;
- `never` — do not transfer or automatically recreate the binding.

Initial defaults:

| Binding kind | Default |
| --- | --- |
| Component state | `snapshot` when its value has a codec |
| Settled query result | `snapshot` when its result has a codec |
| Query executor | `recompute` only when it has a code reference |
| Derived value | `recompute` only when its expression is addressable |
| Action result/pending state | snapshot support deferred until reactive UI needs it |
| Action implementation | portable only with a code reference |
| Ref/DOM handle | `never` |
| Subscription/schedule/live stream | `client` or `never`, never implicit |
| Arbitrary `Component.use` resource | `never` unless explicitly described |

The primary authoring point for an override should be the named setup step,
because it works for primitives and is statically inspectable. A value-level
policy helper should be deferred until it has defined behavior for primitives;
a WeakMap-only helper is not a complete public policy API.

### 7. Handle descriptors advertise capabilities

Keep callable handle shapes unchanged and attach a public symbol-based
inspection protocol. Descriptors identify the handle kind, policy, portable
executable if any, relevant options, and supported operations such as snapshot
or restore.

Descriptors must not imply that every handle can be restored. The capability
matrix grows one vertical slice at a time. Unsupported restoration triggers a
diagnostic/fallback instead of reconstructing a subtly different handle.

### 8. Component inspection is read-only

Expose an advanced `Component.inspect` result rather than exporting the mutable
internal component representation. It should provide:

- the immutable component definition;
- prop parsing;
- setup execution;
- rendering from committed bindings;
- authored slot-contract metadata.

`Component.withDefinition` may add/merge supported definition metadata, but
callers cannot mutate the component's internal record.

### 9. Rendering from bindings uses one shared implementation

Add supported render-from-bindings functions for plain nodes and explicit
views. They must share the same internal view invocation, slot registration,
View unwrapping, and explicit diagnostics path as existing render helpers.
They must not run setup.

Platform/diagnostic services should not be silently read from a dead server
Context. If the sync API accepts explicit render services/options, an Effect
variant may source those services from the active client Layer. The milestone
must settle one behavior and test parity with the existing render paths.

### 10. Instrumentation is a per-render observation SPI

The renderer reports facts; the resumability adapter decides policy and wire
shape. The observation SPI needs events for:

- component enter/leave;
- named binding production and handle descriptor;
- component and expression DOM boundaries;
- event attachment;
- optional behavior attachment;
- source/compiler metadata.

The collector is supplied per render/session and restored in `finally`.
Callbacks receive document-local tokens assigned by that collector. No global
registry may retain request data after the render.

The first implementation may use a synchronous context stack because the
current DOM serializer is synchronous. Nested renders and cleanup after throws
must be tested. Async/concurrent SSR requires an explicit renderer instance or
request-local async context before it can be claimed safe.

### 11. The actual JSX runtime ABI is authoritative

Before changing helper signatures, compile representative JSX fixtures and pin
the emitted calls. Instrument at least:

- event attachment through the compiler-required event helper;
- reactive child insertion;
- component creation;
- prop spreading;
- static template cloning;
- delegated-event registration.

Optional source metadata parameters are added only where a companion transform
can reliably emit them. The existing JSX plugin remains usable without the
companion transform.

### 12. Scope transfer is forbidden

The server render Scope closes normally. A resumer creates a new client Scope,
resolves a client Layer/Context, reacquires explicitly client-owned resources,
and installs fresh finalizers. Only serializable ownership metadata crosses the
wire.

### 13. Security and deployment identity are part of the protocol

- Never serialize secrets, credentials, request-only services, database
  objects, authorization decisions, Causes/Exits without a codec, or live
  resource handles.
- Validate all captures and snapshots at restore.
- Escape embedded JSON using the existing HTML-safe serialization rule.
- Use no `eval` or function-source reconstruction.
- Bound manifest and capture sizes and surface useful diagnostics for oversized
  captures.
- Include protocol and build IDs and reject stale manifests deterministically.
- Treat client-provided action input as untrusted; server authorization remains
  mandatory.

## Proposed Public Surface

The stable first public surface should stay small and live outside the root
golden-path exports until proven:

### Resume module

- `CodeRef`
- `BoundCodeRef`
- `code`
- `bind`
- `isCodeRef`
- `isBoundCodeRef`
- `inspectHandle`
- portable-load and restore error types

The binding strategy and descriptor types may be public for adapter authors,
but constructors that cannot yet restore a handle should remain internal.

### Component integration

- `Component.inspect`
- `Component.renderWithBindings`
- `Component.renderViewWithBindings`
- `Component.withDefinition`
- optional resume metadata on named setup-builder steps

### Existing executable APIs

Add portable executable overloads to existing APIs rather than parallel
`resumable*` APIs:

- `Component.action`
- `Component.query`
- `Behavior.make`

Setup/view code references are deferred until the action/query/behavior model is
proven. Ordinary function overloads remain unchanged.

### Internal/advanced SPI

Keep the render instrumentation/session types and most setup/handle descriptor
constructors advanced until at least one independent adapter consumes them.
The test adapter must nevertheless consume the same exported read-only SPI that
an external package would use.

## Milestones

### Milestone 0 — Ratify invariants and pin the current ABI

Status: in progress

Progress:

- Representative compiler output is pinned for templates, inserts, component
  creation, spreads, delegated registration, direct `$$event` handlers, and
  dynamic event attachment.
- The compiler/runtime event ABI mismatch found during characterization is
  fixed: the runtime now exports the compiler-required event helper, uses the
  emitted `$$event` convention, supports delegated handler data, and installs
  delegated listeners once per document.
- Compiler-emitted delegation setup is safe when a module is imported without
  a browser `document`. Delegated dispatch follows composed paths, preserves
  `currentTarget`, and has an explicit document-level cleanup API.
- SSR roots, global `document`/`Node`, and request context are restored through
  `finally` paths when rendering throws.
- The SSR lifecycle/fallback contract and failing end-to-end resume proof remain
  to be added.

Work:

1. Add characterization fixtures for representative JSX output, including
   direct events, wrapped events, reactive text, spreads, nested components,
   and control-flow helpers.
2. Verify the compiler-required runtime exports. Close any existing
   compiler/runtime ABI mismatch before adding resume metadata.
3. Characterize SSR order: component setup, committed bindings, view execution,
   event attachment, virtual DOM serialization, root disposal, and Scope
   finalization.
4. Characterize nested renders, exceptions, and request context cleanup.
5. Record the exact fallback contract for opaque setup, opaque event handlers,
   unknown code IDs, capture decode failures, and build mismatch.
6. Add an intentionally failing end-to-end resume test that proves the desired
   client behavior and becomes the red baseline.

Acceptance:

- The runtime helper ABI is pinned by tests rather than assumptions from the
  source document.
- The red test fails because the resume SPI is absent, not because the ordinary
  SSR/event runtime is already broken.
- The plan's vocabulary and fallback behavior are reflected in an ADR or the
  canonical AF-UI contract before public APIs land.

### Milestone 1 — Metadata-only component and setup foundation

Status: in progress

Progress:

- Named setup builders retain immutable step plans for bindings, values,
  effects, and nested fragments; raw setup functions inspect as opaque.
- Components retain immutable definitions, authored name/metadata, and
  conservative opaque setup/view transform records across wrappers.
- Read-only component inspection and render-from-committed-bindings functions
  are implemented with runtime and compile-time coverage.
- Inspection decodes props exactly once before setup/render; committed rendering
  covers explicit Views, headless render props, slot registration, and public
  prop-schema validation.
- The canonical slot wrapper is recorded as portable, while unknown setup/view
  wrappers remain opaque. Re-routing an already routed component no longer
  replaces its existing registry entry.
- Broader wrapper-family and platform-diagnostic parity coverage remains before
  this milestone is complete.

Work:

1. Add an immutable component definition record with an opaque/default
   identity state and setup-plan field.
2. Retain named setup step descriptors while executing the same combined Effect
   as today.
3. Classify raw setup functions as opaque.
4. Centralize component-decoration copying so every wrapper preserves slot,
   route, definition, setup-plan, and future transform metadata.
5. Add read-only component inspection.
6. Add render-from-bindings helpers and refactor existing render paths through
   the same committed-binding renderer.
7. Add type and runtime tests for headless components, `View` results, slot
   registration, prop schema failures, platform diagnostics, and wrapper
   preservation.

Acceptance:

- No ordinary component behavior changes.
- Inspection shows named steps for setup builders and `opaque` for raw setup.
- Rendering restored bindings never runs setup.
- All component wrappers preserve both authored slot contracts and definition
  metadata.

### Milestone 2 — Portable code and handle inspection protocols

Status: in progress

Progress:

- `Portable.code(...)` and `Portable.bind(...)` retain typed capture, argument,
  success, error, and Effect requirement axes.
- Portable descriptors contain a version, logical code ID, build ID, and
  schema-encoded JSON-safe captures. Functions and runtime objects are not
  included.
- `Portable.Resolver` loads definitions in a fresh Effect runtime, validates
  identity/build/captures before execution, and memoizes lazy module requests
  within one resolver instance.
- Missing code, loader failure, identity drift, build drift, and capture
  encode/decode failures have explicit tagged errors.
- `Component.action(...)` accepts bound portable code without changing its
  callable handle semantics. Portable actions expose inspection metadata;
  ordinary closures explicitly inspect as opaque.
- Runtime and compile-time tests cover JSON round trips, fresh client service
  resolution, opaque fallback classification, stale builds, invalid captures,
  missing code, loader deduplication, and public type axes.
- State/query/derived/ref handle descriptors and the SSR event/action collector
  remain to be implemented.

Work:

1. Introduce branded code and bound-code references with logical IDs.
2. Define runtime resolution, manifest resolution, build identity, and typed
   load/decode errors.
3. Introduce the symbol-based handle inspection protocol.
4. Add descriptors first for component state, query, action, derived state,
   ref, and opaque values. Only advertise capabilities actually implemented.
5. Add setup-step resume policies and conservative defaults.
6. Make `Component.action` accept portable executables while preserving its
   callable public handle.
7. Prove ordinary runtime execution of unbound and bound portable actions,
   including lazy loading, captures, requirements, concurrency options,
   invalidation keys, errors, interruption, and scope disposal.

Acceptance:

- Plain functions behave exactly as before and inspect as opaque.
- Bound captures are validated before portable execution.
- Action requirement/error/argument inference remains precise.
- A portable action resolves services from the runtime executing it, not from
  the runtime that created its descriptor.

### Milestone 3 — Per-render instrumentation and SSR manifest collection

Status: not started

Work:

1. Add a render-session/instrumentation context with strict enter/leave cleanup.
2. Instrument component boundaries and named committed bindings.
3. Instrument the actual compiler event helper and virtual DOM so supported
   events produce HTML markers and event records during SSR.
4. Add document-local ID allocation for component instances, bindings, and
   event targets. Keep code IDs build-stable and render IDs document-local.
5. Define a versioned resume manifest schema using the existing Serialization
   service.
6. Add capture validation, payload size limits, HTML-safe embedding, protocol
   version, and build ID.
7. Keep slot contracts and typed trees as enrichment metadata; do not use them
   as a substitute for renderer node identity.
8. Test nested rendering, thrown setup/view errors, collection failure, and
   back-to-back renders for collector leakage.

Acceptance:

- With no collector installed, hot paths take a cheap no-op branch and existing
  HTML is byte-compatible unless an intentional ABI fix was required.
- With a collector installed, a portable direct event emits one stable marker
  and one validated manifest entry.
- Opaque events produce a diagnostic/fallback record and never a fake code
  reference.
- Collection state does not survive the render session.

### Milestone 4 — Resumable event/action proof

Status: not started

Work:

1. Implement a small client loader that reads the manifest and installs
   delegated handlers without importing the component module.
2. Resolve code IDs through an adapter/build manifest, decode captures, and run
   the loaded Effect in a fresh client Layer and Scope.
3. Define event semantics for propagation, default prevention, capture/passive
   options, multiple handlers, once, and handler failure.
4. Explicitly classify browser APIs that require same-turn synchronous
   execution as eager-only/fallback behavior.
5. Build the public-surface-only test adapter and an example using a direct
   portable action event.
6. Prove module request deduplication and exactly-once dispatch for concurrent
   events targeting the same unloaded code.
7. Prove unmount/removal closes any client-owned Scope and prevents later
   dispatch.

Acceptance:

- The focused red test from Milestone 0 is green.
- Client setup/view execution counters remain zero before and during the first
  portable action dispatch.
- The action uses a client service implementation after the server service and
  Scope have been finalized.
- Missing/stale/invalid manifests follow the ratified fallback policy with a
  useful diagnostic.

This milestone satisfies the initial Definition of Done.

### Milestone 5 — Snapshot restoration and partial component activation

Status: deferred until the action proof is stable

Work:

1. Reuse scalar/family hydration identity and the Registry rather than creating
   a parallel atom snapshot store.
2. Add supported snapshot/restore records for component state, with Schema
   validation and new client-owned callable handles.
3. Restore committed binding objects from supported records.
4. Render with restored bindings without setup when every required binding is
   available.
5. Define component-level fallback activation when a binding is opaque,
   `client`, `never`, missing, invalid, or from an incompatible build.
6. Prove that fallback does not duplicate already resumed event execution or
   install duplicate listeners/subscriptions.

Acceptance:

- A snapshot-capable component renders from restored bindings without setup.
- A mixed component activates only at the documented fallback boundary.
- Server handles and finalizers are never reused.

### Milestone 6 — Portable queries and behaviors

Status: deferred

Work:

1. Add portable query executors to the existing query API.
2. Snapshot settled `Result` data, timestamp/cache identity, invalidation keys,
   and retry/poll metadata only where semantics can be restored exactly.
3. Reuse current loader/single-flight hydration formats rather than duplicating
   route data.
4. Lazy-load a query executor only on refresh/revalidation.
5. Let behavior definitions carry optional code references and preserve
   declarative attachment descriptors through composition/wrapping.
6. Reacquire behavior listeners/resources in a fresh attachment Scope.

Acceptance:

- A settled query displays existing data without loading its executor.
- Refresh loads the executor once and preserves `Result`, error, requirement,
  invalidation, and single-flight semantics.
- Portable behavior attachment does not require rerunning base component setup.

### Milestone 7 — Compiler-generated identities and closure extraction

Status: deferred

Work:

1. Add a companion Babel/Vite transform rather than forking the generic JSX
   runtime contract prematurely.
2. Generate stable logical source identities and a build manifest.
3. Extract selected event/action/query/behavior closures into addressable
   exports.
4. Convert captures into explicit bound-code records and emit codecs or
   diagnostics for unsupported captures.
5. Pass optional source metadata through the characterized helper ABI.
6. Preserve manual code references as the compiler-independent escape hatch.
7. Add source-map-aware diagnostics for non-const, oversized, secret-prone, or
   nonserializable captures.

Acceptance:

- Normal JSX without the companion transform still works.
- Transformed code produces the same runtime behavior and the same portable
  records as manual references.
- Logical IDs remain stable across non-semantic rebuild changes where the
  chosen identity policy promises stability.

### Milestone 8 — Fine-grained expressions and serialized subscriptions

Status: future research/implementation

Work:

1. Introduce stable identities for supported atoms/signals and dynamic DOM
   expression boundaries.
2. Capture low-level reactive reads in addition to semantic Reactivity keys.
3. Extract dynamic render expressions into addressable code with explicit
   captures.
4. Serialize dependency-to-expression relationships and restore lightweight
   client subscriber records.
5. Patch existing SSR DOM when restored state changes without rendering from
   the application root.
6. Define structural fallback for lists, conditional branches, portals,
   suspense/async boundaries, nested ownership, and removed component regions.
7. Measure manifest size, first-interaction latency, update latency, and
   retained-memory costs against current hydration.

Acceptance:

- A restored state write loads only the required expression code and patches
  its existing DOM boundary.
- Parent and sibling components do not execute merely to rediscover the
  dependency.
- Cleanup removes restored subscribers and client resources exactly once.

This is the point at which AF-UI can accurately claim fine-grained
resumability, rather than only portable event handlers or partial activation.

### Milestone 9 — Hardening, documentation, and adapter stability

Status: deferred

Work:

1. Document the ordinary, partial, and fully addressable authoring paths.
2. Publish the adapter SPI only after the proof adapter and at least one
   external-style consumer exercise it.
3. Add diagnostics for capture size, unsupported policy, missing codec,
   unknown code identity, build mismatch, stale DOM marker, and duplicate ID.
4. Add compatibility/version tests for manifest decoding.
5. Add CSP tests and an audit checklist for secret leakage and untrusted action
   input.
6. Add no-instrumentation and collection benchmarks.
7. Update the AF-UI contract and current-status document as each capability
   lands; archive the exploratory source document once its decisions are
   represented canonically.

Acceptance:

- Public docs never call ordinary state hydration resumability.
- The adapter SPI has a versioning policy.
- Unsupported cases fail closed or activate through an explicit, tested
  fallback.
- Normal runtime performance remains within the ratified regression budget.

## Test Strategy

### Compile-time tests

- CodeRef and BoundCodeRef function/capture inference.
- Action/query/behavior argument, result, error, and requirement propagation.
- Setup policy names and binding-name inference.
- Component inspection preserving Props, Req, E, Bindings, and SlotContract.
- Wrapper preservation across slots, behaviors, layers, routes, and view
  transforms.
- Negative cases for mismatched captures, codecs, executable signatures, and
  restore records.

### Runtime unit tests

- Code-ref load caching, rejection, retry policy, and build mismatch.
- Capture encode/decode validation and HTML escaping.
- Setup plan ordering and opaque raw setup.
- Handle descriptor classification and policy defaults.
- Render-with-bindings parity and no-setup guarantee.
- Instrumentation enter/leave ordering and cleanup on errors.
- Manifest duplicate/unknown/stale identity diagnostics.
- Scope finalization and no use-after-close.

### Integration tests

- SSR to JSON to fresh-client event/action resumption.
- Server and client use different service implementations.
- No component setup/view execution on the portable client path.
- Opaque event activation fallback.
- Multiple components with the same definition but distinct document-local
  instance/event IDs.
- Multiple events sharing a code reference and module request.
- Nested component/event propagation and removal cleanup.
- Existing hydration and route-loader wire round trips remain unchanged.

### Later fine-grained tests

- State snapshot to restored callable handle.
- Query result restoration and lazy refresh.
- Dependency-to-expression restoration.
- Conditional/list boundary replacement.
- Hydration/resumption mixing without duplicate effects or listeners.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| The SPI becomes a second component framework | Keep definitions small, optional, and read-only; raw setup remains opaque |
| `CodeRef.load` is mistaken for serializable data | Serialize only logical ID and captures; resolve loaders through a build manifest |
| Descriptors leak live server objects | Separate runtime descriptors from versioned wire records and schema-audit projections |
| Slot handles are mistaken for DOM identity | Assign renderer/compiler node IDs; use slots only as semantic enrichment |
| Wrapper metadata is lost | Centralize all component decoration copying and test every wrapper family |
| Collector state leaks across requests | Per-render session, stack discipline, `finally` cleanup, nested/back-to-back render tests |
| First interaction stalls on import | Add adapter-level preload/prefetch later; measure before inventing policy |
| Browser API requires synchronous event handling | Diagnose and force eager/fallback attachment for that event/option |
| Captures bloat HTML or expose secrets | Explicit codecs, size budgets, allow/deny diagnostics, no reachability-wide automatic graph walk |
| Server and client deployments disagree | Protocol/build IDs and deterministic mismatch fallback |
| Restored handle semantics differ from current handles | Capability-advertised restoration, one handle kind at a time, parity tests |
| Hydration and resumability duplicate caches | Reuse Hydration, Registry, Serialization, Result wire records, and single-flight seeds |
| Compiler IDs churn | Define and test a stable identity policy; keep manual IDs available |
| No-op instrumentation slows normal rendering | One cheap inactive check and benchmarks before/after |

## Assumptions

Confirmed from the current repository:

- The first product goal is adapter enablement, not an immediate full Qwik
  clone.
- The component setup/view boundary and named bindings remain canonical.
- Current JSX authoring must remain valid.
- Effect requirements and errors must continue to bubble through public types.
- Hydration, Registry, Serialization, Reactivity, slots, and typed view trees
  are existing primitives to reuse.
- Web is the concrete first runtime, but portable component/handle types should
  not contain DOM-only contracts.

Load-bearing assumptions to validate in Milestone 0:

- The current compiler's event/runtime ABI can be extended without replacing
  the generic JSX plugin.
- A direct portable action can be attached in a way the SSR event collector can
  identify without compiler closure extraction.
- The current synchronous SSR session can provide adequate request isolation
  for the first proof.
- A fresh-client test can prove module non-import/setup non-execution with the
  repository's current test environment or one small test-only DOM harness.

## Open Questions

These must be settled before their owning milestone lands:

1. Should the advanced API be exported only from `Resume` and `advanced`, or
   also from the root package after stabilization?
2. What is the exact typed error union for code loading, manifest lookup,
   capture decode, and build mismatch?
3. Is build mismatch always a hard failure, or may an adapter request full
   hydration fallback?
4. What explicit render services/options should render-from-bindings accept so
   platform and diagnostics behavior matches current render helpers?
5. Which direct JSX event shape is the supported compiler-free action proof,
   and how are event arguments represented?
6. Which event/options require eager synchronous attachment on the web
   platform?
7. What manifest embedding strategy best supports CSP: inert JSON script,
   external payload, streaming records, or an adapter choice?
8. What is the first acceptable payload-size and no-instrumentation performance
   budget?
9. When async/streaming SSR arrives, will render instrumentation use renderer
   instances, Effect fiber-local context, or platform-specific async-local
   storage?
10. Which handle kind after state is valuable enough to justify a public
    restoration constructor?

## Execution Order

Implement Milestones 0 through 4 as one coherent adapter-enablement program.
Do not begin compiler extraction or fine-grained subscription serialization
until the manual event/action proof validates the protocols.

Recommended sequence:

1. Pin the JSX/SSR ABI and fallback contract.
2. Land metadata-only component/setup inspection and render-from-bindings.
3. Land code references, policies, and handle descriptors.
4. Land per-render SSR observation and manifest collection.
5. Land the public-surface-only event/action resumer proof.
6. Review the SPI and promote only what the proof adapter actually required.
7. Choose the next product slice: state/component fallback, queries/behaviors,
   or compiler ergonomics.
8. Attempt fine-grained expressions only after stable identity, scope, and
   cleanup semantics exist.
