# Resumability Implementation Plan

## Where this stands (2026-07-30)

All 12 blocking design questions for this plan are **decided** (see
`docs/design-questions/resumability.md`'s Decided table and the ratified sections
below). What remains is implementation plus 17 deferrable questions that bite
when M9 freezes the surface.

**Benchmark status — corrected.** The heap gates are **green**:
`node benchmarks/resumability/verify.mjs` passes the recorded baseline, and both
the calibrated 200 KB fixed-gap ceiling and the 1.10 relative-slope ceiling hold
(density-24 dormant-vs-eager gap: 183,212 bytes; slope 1.0703). An earlier
summary in this project mistook **277,208 bytes** for a failing gate — that
figure is zero-expression installation measured against a *module-only page*, an
attribution number, not a ceiling. Re-run after 8c.7's widening.

**Updated 2026-07-30 (evening) — what landed today:** both `Element.ts`
reactive-owner leaks (`on`, `observeEach`), M7's ordinal identity churn
(content-hashed; the other two M7 defects were already fixed in-tree), the 8c.3
compiler directive seam, and 8c.4 **plus** 8c.5 and 8c.6. Source suite is
**914 passing**; `future/resumability` is **32/39**.

**Partially done, and quietly incomplete:**

| Milestone | What is actually left |
| --- | --- |
| M8c | **COMPLETE** — 8c.0–8c.8 all landed; 8c.7 returned GO |

**M0, M1 and M2 are now complete too** (2026-07-30). M1 item 4 turned out never
to have been done despite the milestone reading complete, and the gap had already
dropped `__routeTransition` and `__routeSitemapParams` from every wrapper.

**M8d is in progress** (2026-08-11): face 1, the keyed-reconciliation
prerequisite, is done — `dom.reconcileArrays` is exported with
identity-preserving semantics, and exporting it uncovered two real defects that
`DQ-010`'s "just expose it" ratification had hidden. Faces 2 and 3 (region
representation, branch owner) are now specified: **`DQ-030` ratifies
per-instance child `Scope`s, `data-af-key` fenced at compile time, and one
`structural` manifest member at v5.** See §Milestone 8d.

**Not started:** M9 (deferred, blocked by `DQ-099`, with item 2 separately
blocked on M10 item 4); M10 beyond `extract.auto`; M11/M11b.

**Browser tests and the benchmark have both been re-run** (7/7 Chromium; both
heap gates pass), and the recorded baseline is **re-pinned from the post-widening
run**. Note the pre-jitless baseline is gone: cross-run *growth* comparisons
against older numbers are invalid, since jitless-forced-gc strips V8 JIT code
from both arms.

**Remaining known defects** (the two listener leaks and the `installClient`
tamper gap are now fixed):

1. `DQ-099` — the validated-manifest memo is a process-global `WeakSet` keyed on
   caller object identity, safe only because the decoder happens to return a
   copy. Blocking M9.
2. `setAttr`/`setStyle` create bare `createEffect(...)` reactions tied to neither
   an owner nor a `Scope`, so a `Style` attached through a scoped path keeps
   recomputing after disposal (`DESIGN_IMPROVEMENT_NOTES.md` item 22b). Needs a
   Scope-aware reaction primitive that does not exist yet.
3. The expression attribute/style allowlist now exists in **three** copies
   (runtime, schema, compiler); only two are compile-time linked.

**Suggested order:** **finish M8d** — it is underway, `DQ-030` has removed the
design uncertainty, and its remaining work is bounded by a written acceptance
list. Then **M11** (largest remaining, and the only thing that moves
`future/streaming`'s 40 red specs).

One caveat on "small": M8d was called small when it was believed to be an export
plus two targets. Face 1 alone turned up two defects, and faces 2 and 3 touch
the collect path, the compiler's rejector, the client install path, and the
manifest version. Treat it as medium.

Status: Milestones 0–7 and Milestone 8a–8b are implemented — the manual runtime protocol
(Milestones 0–6 plus the exact-once boundary event handoff) and the
Milestone 7 compiler extraction workstream (marker transform, Vite
integration, capture diagnostics, and its own Chromium-proven fixture in
`examples/resumable-extract`). Explicit fine-grained text expressions now
restore and patch lazily. Milestone 8c.0 has locked the ordinary JSX ABI and
proved the current comparison path is eager rerender, not hydration. The 8c.1
Chromium harness now measures payload, cold/warm latency, network, ownership,
and forced-GC heap with deterministic verification, runtime-aligned eager
comparators, and staged density-0/1/24 retention attribution. The retention
review removed repeated manifest schema decoding, reduced the realistic
dormant/eager gap from about 223 KB to 159 KB, and showed dormant
per-expression heap growth is slightly lower than eager. The fixed-cost and
slope gates are now calibrated. M8c.2's manifest v4 target union, compatibility
path, mixed-target scanner, ownership validation, and security fences are
implemented; installation-time patch strategies remain. Milestone 9
hardening/SPI review remains pending.

> **Implementation review (2026-07-29):** a full M0–M8 code review with
> test-verified findings lives at the end of this document — see
> [M0-7 Test Audit Findings](#m0-7-test-audit-findings-2026-07-29) and
> [M8 Test Audit Findings](#m8-test-audit-findings-2026-07-29) (including
> the "Audit pins II results" table). 7 confirmed bugs are pinned as
> `it.fails` tests in `src/__tests__/resume.test.ts` (describes
> "Resume audit pins…" I and II) and
> `src/__tests__/resume-extract-plugin.test.ts` ("M8 audit pins");
> 5 findings were disproven and are pinned as passing tests. The pins flip
> automatically when a bug is fixed — treat them as the fix worklist.

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

- `npm run typecheck:all` (library, tests, examples, browser, and Effect
  diagnostics)
- `npm test`
- `npm run build`
- `npm run test:browser`

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

| Binding kind                       | Default                                              |
| ---------------------------------- | ---------------------------------------------------- |
| Component state                    | `snapshot` when its value has a codec                |
| Settled query result               | `snapshot` when its result has a codec               |
| Query executor                     | `recompute` only when it has a code reference        |
| Derived value                      | `recompute` only when its expression is addressable  |
| Action result/pending state        | snapshot support deferred until reactive UI needs it |
| Action implementation              | portable only with a code reference                  |
| Ref/DOM handle                     | `never`                                              |
| Subscription/schedule/live stream  | `client` or `never`, never implicit                  |
| Arbitrary `Component.use` resource | `never` unless explicitly described                  |

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

Status: **complete (2026-07-30).** Items 3–4 are pinned by
`src/__tests__/ssr-characterization.test.ts` (15 tests), item 5 is recorded in
[`RESUMABILITY_SSR_CONTRACT.md`](RESUMABILITY_SSR_CONTRACT.md), and **item 6 is
satisfied by obsolescence** — its acceptance was "the red test fails because the
resume SPI is *absent*", and the SPI now exists and is proven by 110 resume tests
plus 7/7 Chromium. A test engineered to fail would pin nothing.

Three findings contradict this section's original prose, and the tests pin the
code's actual behaviour:

- **There is no ambient Effect `Scope` during SSR**, so "Scope finalization" is
  not a lifecycle step. A caller-provided scope finalizes *after* the render
  returns, at the caller's discretion.
- **Nested `renderToString` restores the outer *virtual* document**, not the real
  one; each render owns a distinct virtual document, so nesting is safe.
- **`decodeManifest` accepts unknown code IDs** — decode validates *shape*, not
  resolvability. An unknown ID surfaces only at dispatch, as
  `dispatch-resolution-failure`.

One genuine gap is recorded and not fixed: **opaque setup is the only fallback
case that emits no diagnostic at all**, so the component silently contributes no
snapshot while every other opaque path announces itself.

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
- The compiler's lazy template-factory ABI is now implemented directly. JSX
  modules can create templates during module evaluation without touching a
  browser `document`, and the same compiled template can be cloned during SSR.
- The split server/client production-bundle proof now exercises the runtime ABI
  in Chromium. The broader SSR lifecycle/fallback contract remains to be
  ratified.

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

Status: **complete (2026-07-30).** The "direct zero-argument event/action
contract" qualifier is retired — M2's portable actions take arguments, and
M3–M8c have landed since it was written.

Item 4 (centralized decoration copying) was **not** actually done despite this
milestone reading as complete, and the gap had already bitten:
`copyRouteDecorations` copied six `__route*` fields by hand while
`RouteDecoratedComponent` declared eight, so **`__routeTransition` and
`__routeSitemapParams` were silently dropped by every wrapper**. `src/Route.ts`
now has a single declaration site (`RouteDecorationRecord` +
`RouteDecorationFields`) with a compile-time exhaustiveness assertion, so adding
a field without listing it is a type error.

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

Status: **complete (2026-07-30).** Items 1–7 are all closed. The previous status
was stale twice over: state/query descriptors and the SSR event/action collector
landed with M3/M8, and `derived`/`ref`/`action` descriptors landed on 2026-07-30.

Two decisions worth stating here rather than leaving only in code:

- **Opacity is encoded by absence, not by a descriptor kind.** An opaque action
  or query is one whose descriptor has **no `executable`**; `inspectHandle`
  returns `undefined` for non-handles. A separate `"opaque"` kind was rejected
  because it would give opacity two encodings.
- **The conservative default is: no declared resume policy means no snapshot.**
  A `bind` step without a `resume` option omits the key, the collector filters on
  `step.resume !== undefined`, and the binding falls back to client activation.
  This is a load-bearing safety property that previously lived only in code.

Progress:

- `Portable.code(...)` and `Portable.bind(...)` retain typed capture, argument,
  success, error, and Effect requirement axes.
- Portable descriptors contain a version, logical code ID, build ID, and
  schema-encoded JSON-safe captures. Functions and runtime objects are not
  included.
- `Portable.Resolver` loads definitions in a fresh Effect runtime, validates
  identity/build/captures before execution, and memoizes lazy module requests
  within one resolver instance. Loader callbacks are not invoked while the
  resolver is built; throws, typed failures, and defects are normalized at the
  loader boundary.
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

Status: complete for the synchronous SSR contract

Progress:

- `Resume.collect(...)` installs a synchronous, per-render collection session
  with stack discipline and `finally` cleanup. Nested, failed, and consecutive
  collections are isolated and each allocates document-local event IDs from
  `e0`.
- The server virtual DOM observes the compiler's existing `$$event` convention
  only while a collector is active. Portable direct events emit
  `data-af-event-<type>` markers; ordinary SSR takes a cheap no-op branch and
  retains byte-compatible HTML.
- The v1 resume manifest is Schema-validated and encoded through the existing
  `Serialization` service. It carries the build ID and portable descriptor for
  each event, uses HTML-safe JSON, and enforces a configurable byte limit.
- Opaque closures, compiler-bound event data, invalid event names, and reserved
  marker collisions fail closed with explicit diagnostics rather than fake
  portable records.
- Runtime tests cover manifest round trips, marker collection, opaque fallback
  classification, nesting, cleanup after throws, observation deduplication,
  safe script embedding, build skew, marker collisions, and payload limits.
- Component/binding observation now assigns document-local component IDs after
  committed setup. Rendered state-addressable components use paired comment
  regions, including fragments, text-only views, and empty output.
- Diagnostics carry explicit collection phase, warning severity, and
  `fallback-required` disposition. A committed snapshot without a rendered
  region is omitted rather than creating a manifest-only ghost component.
- This milestone is intentionally synchronous. Async/streaming SSR requires an
  explicit request-local renderer context and is not an ambient-session
  extension.

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

Status: complete for the direct zero-argument event/action contract

Progress:

- `Resume.event(...)` defines the first explicit event invocation contract:
  portable zero-argument component actions whose logical inputs are captures.
  The ordinary handler discards the native `Event`, matching deferred client
  execution. Portable handlers without this contract fail closed.
- The v1 event entry records `invocation: "deferred-no-args"`. Compiler-bound
  event data and action options whose concurrency, invalidation, transition, or
  detached semantics are not represented on the wire remain diagnostics.
- `Resume.decodeManifest(...)` validates the payload through the configured
  Serialization service, enforces a client-side byte ceiling, and compares it
  with an independently supplied client build ID.
- `Resume.installClient(...)` validates the marker/manifest bijection, installs
  root-scoped capture listeners (including non-bubbling events), shares one
  memoized portable resolver, rejects duplicate active installation on a root,
  and executes each event in a fresh Effect Scope using a caller-owned
  `ManagedRuntime`.
- The installation owns only its listeners and dispatch fibers. Its idempotent
  disposer removes listeners and interrupts in-flight actions without
  disposing the caller's runtime.
- Integration coverage proves shared lazy loading with distinct event
  execution, typed resolution diagnostics, invalid capture rejection,
  interruption cleanup, closed server Scope/service ownership, fresh client
  service resolution, and zero client setup/view replay.
- A production Vite fixture server-renders the component and emits its resume
  manifest, while the browser bundle contains only the client installer and a
  lazy action chunk. Playwright proves the action/component modules are absent
  from initial requests, two interactions share one in-flight chunk request,
  each interaction executes once, and component setup/view counters remain
  zero before and after dispatch.
- The same browser proof disposes the client installation and caller-owned
  runtime, then verifies later events do not dispatch.
- Native-Event arguments, synchronous default prevention/propagation,
  capture/passive/once options, localized component activation, and restored
  Component.action result/invalidation/concurrency state remain intentionally
  unsupported.

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

Status: complete

Progress:

- Named `Component.bind(...)` steps accept a schema-backed
  `Resume.snapshotState(...)` policy only when their Effect produces a
  `Component.state` handle; public type tests reject applying it to ordinary
  values.
- Component state handles publish a read-only inspection protocol. Collection
  observes named bindings only after the complete setup Effect commits and
  never places live atoms, signals, setters, owners, Scopes, or schemas on the
  wire.
- Manifest v2 adds document-local component IDs and state hydration keys while
  v1 event-only manifests remain decodable and continue to be emitted when no
  component snapshots exist.
- Each emitted v2 component record declares a paired-comment DOM region.
  Collection wraps complete component output rather than assuming one element
  root, and omits snapshots that never acquire a rendered region.
- `Resume.scanComponentBoundaries(...)` validates marker identity,
  uniqueness, completeness, and proper nesting against the manifest. Client
  installations expose the discovered boundary map for the activation layer.
- `Resume.restoreStateBindings(...)` validates the complete authored setup
  plan and all wire values before allocation, then creates fresh client state
  handles under a new Scope and Registry using the existing scalar hydration
  identity.
- Canonical `Component.withSlots(...)` transforms and portable
  `Component.withBehavior(...)` transforms are reconstructed in authored
  order. Missing, extra, invalid, opaque, unannotated, side-effectful, or
  mixed binding plans return explicit typed fallback errors. Closing the
  restoration invalidates the fresh handles and releases behavior resources.
- Runtime and compile-time tests prove schema round trips, zero setup replay,
  client writes, scope disposal, slot reconstruction, inspection failure
  containment, and conservative mixed-binding fallback.
- The terminal `Resume.addressable(...)` combinator defines and publishes a
  portable activation entry with a component-prop capture schema;
  `Resume.activationOf(...)` retrieves the exactly inferred entry for the
  resolver. Wrapper transforms deliberately precede addressability, preventing
  the entry from mounting a pre-wrapper component. The low-level
  `Resume.componentActivation(...)` constructor remains available for
  framework integrations. Collection emits the descriptor only for explicitly
  addressable components.
- Client installation now owns a single-flight boundary activation controller
  with observable dormant/activating/active/failed/disposed states. It mounts
  into the validated comment range under the caller-owned runtime, publishes
  `Active` only after setup and initial view commit, disposes descendants
  before activating an owner, and closes mounts exactly once. Scoped
  installation and restoration variants bind cleanup to caller Scope
  ownership.
- The production browser fixture proves lazy component loading, exact-once
  activation, range replacement, and cleanup while preserving the independent
  portable-action fast path.
- `ClientInstallation.resume(componentId)` now atomically claims a dormant
  boundary, resolves its addressable component, restores and mounts complete
  state/query binding plans without setup replay, and coalesces concurrent
  callers in the same controller as forced activation. Incomplete or invalid
  restoration changes the observable state to `activating`, emits a
  `component-resumption-fallback` diagnostic, and runs normal setup exactly
  once. Restored query invalidation subscriptions are child-Scope owned and
  refresh through the caller runtime plus the shared portable resolver.
- The production Chromium fixture proves that concurrent resume requests for
  an incomplete component share one lazy component load, emit one explicit
  fallback diagnostic, and commit setup/view exactly once.
- Activation-required events use `Resume.activationEvent(...)` with a stable
  boundary-local target key and the predefined schema-backed `mouse-v1`
  projection. The root dispatcher synchronously projects and claims the native
  event, joins the restore-or-activate transition, waits for view/listener
  commit, and replays through the committed listener exactly once. Portable
  `Resume.event(...)` entries still execute without component activation.
- The Chromium fixture proves incomplete snapshot -> dormant click -> one
  component chunk -> one setup/view/listener commit -> one replay -> later
  active listener dispatch -> one disposal.

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

Status: complete

Progress:

- `Component.query(...)` accepts a zero-argument `Portable.BoundCode` executor
  and annotates the returned `Component.QueryAtom` with a `kind: "query"`
  handle inspection plus a `component-query` executable inspection recording
  retry/poll usage.
- `Resume.snapshotQuery(schema)` is the schema-backed query snapshot policy for
  `Component.bind(..., { resume })`; the policy is only assignable to
  `Result`-valued query bindings at compile time.
- Collection snapshots only settled `Success` query results. Unsettled or
  failed queries emit an `unsettled-query-snapshot` fallback diagnostic;
  opaque query closures emit `opaque-query-executor`. The v2 manifest binding
  record is now a `state | query` union; a query snapshot carries the encoded
  success value, `dehydratedAt`, and the executor's portable descriptor with
  the usual capture-encoding and build-ID checks.
- `Resume.restoreStateBindings(...)` seeds a fresh reactive read-only `Result`
  atom from the snapshot without loading the executor, and exposes per-binding
  `RestoredQueryHandle.refresh` Effects on `RestoredStateBindings.queries`.
  Refresh requires `Portable.Resolver`, resolves the descriptor lazily
  (memoized module load), transitions through `Refreshing`, settles via
  `Result.fromExit`, is a no-op while already in flight, and fails with
  `ResumeRestoredQueryDisposedError` after disposal.
- `Component.query(..., { reactivityKeys })` uses the canonical
  `Reactivity.Key`/string-key normalization path. Live queries rerun when one
  of those keys is invalidated; portable query snapshots carry the normalized
  keys so the boundary coordinator can install the same revalidation
  relationship without replaying setup.
- Portable query cache/single-flight identity is derived from the existing
  portable descriptor (`kind`, version, code ID, build ID, and encoded
  captures) plus the sorted, deduplicated canonical reactivity keys through
  the same resource-identity helper used by the route loader cache.
  `Portable.cacheKey(descriptor, reactivityKeys)` and restored query handles
  expose that identity without duplicating it in the manifest. Route data
  continues to use route loader/single-flight hydration rather than being
  copied into a component-query cache.
- Restored refresh handles preserve the component requirement axis:
  `refresh` requires `Portable.Resolver | Component.RequirementsOf<C>` rather
  than erasing the executor environment to `never`.
- Runtime tests prove: settled snapshot collection and manifest round trip,
  fallback diagnostics, restored data rendering with zero executor loads,
  exactly-one load across repeated refreshes, refreshed value visibility, and
  disposal semantics. Type tests cover the portable overload axes and policy
  assignability.
- Retry/poll query semantics are classified as not exactly restorable:
  collection emits an `unsupported-query-semantics` fallback diagnostic and
  omits the snapshot instead of serializing schedule state.
- The portable behavior slice is implemented. `Behavior.portable(boundCode)`
  builds a behavior from an addressable attachment executable and records a
  declarative `BehaviorAttachment`; `Behavior.inspectAttachment(...)` reads it
  (absent metadata reads as opaque). `Behavior.compose(...)` preserves
  portability only when every member is portable, and metadata wrappers keep
  the record. `Component.withBehavior(...)` now appends a
  `component.withBehavior` transform descriptor carrying portability and code
  IDs, so wrappers preserve behavior-attachment metadata for inspection.
  The boundary restoration transaction invokes the runtime-only reattachment
  recipes from the resolved component module in the same child Scope as
  restored handles and rendering. A typed attachment failure rolls that Scope
  back completely before documented fallback activation; defects remain
  terminal. `Behavior.attachScoped(...)` remains the lower-level standalone
  attachment API.
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

Status: in progress (standalone Babel transform slice implemented)

Progress:

- `src/portable-extract.ts` defines the authored `extract(run, {captures,
  bind})` marker. Untransformed calls fail closed with guidance; manual
  `Portable.code` + `Portable.bind` remains the compiler-independent escape
  hatch.
- `src/compiler/resume-extract-plugin.ts` is a companion Babel plugin (Babel
  is a type-only import, so the package gains no runtime Babel dependency). It
  hoists each marker call into an exported `Portable.code(...)` definition
  with a stable `moduleId#constName` identity (`#$ordinal` for unassigned
  calls), stamps the configured `buildId`, and rewrites the call site to
  `Portable.bind(...)`.
- Identity policy: stable across formatting-only rebuilds; renaming the const
  or module changes the identity, made safe by the build-ID check.
- Diagnostics: the extracted function and its captures schema must be
  module-closed — referencing an enclosing function scope is a code-framed
  compile error naming the identifier. `bind` stays at the call site and may
  close over local scope. Non-inline function/options arguments are rejected.
- A build-manifest hook (`onCode`) reports `{id, exportName, moduleId,
  filename}` per generated definition in source order, for resolver-entry
  generation.
- Named and namespace marker imports are supported; unrelated `extract`
  imports are left untouched.
- The review-noted transform defects are fixed: generated definitions now
  mirror original evaluation order (top-level calls get their definition
  immediately before their own statement; calls inside functions defer to the
  end of the module where all module bindings are initialized), and
  `this`/`super`/`arguments` that would resolve outside the extracted
  expression are code-framed compile errors, while nested functions that bind
  their own context remain allowed.
- `src/compiler/resume-extract-vite.ts` adds the Vite integration:
  `resumeExtract({buildId, ...})` runs the Babel transform over application
  modules (lazy `@babel/core` import, so no runtime dependency), aggregates
  per-module build-manifest entries with replace-on-retransform semantics for
  dev, and serves `virtual:af-resume-entries` — a generated module exporting
  lazy `Portable.ResolverEntries` (`Effect.promise` dynamic imports keyed by
  code identity) fed directly to `Resume.installClient`.
  `resolverEntriesModule(entries, importPath?)` is exposed for non-Vite
  build tooling.
- Capture-content diagnostics are implemented: credential-looking capture
  property names are code-framed compile errors by default (downgradable to
  source-located warnings or off, with an overridable name heuristic), and
  bind expressions above an advisory source-length ceiling emit an
  `oversized-bind` warning before the runtime manifest byte ceiling bites.
  Warnings flow through `onDiagnostic` and surface as Vite `this.warn`
  output in the plugin.
- The executed end-to-end fixture is proven: `examples/resumable-extract`
  authors its action with the `extract` marker only (no hand-written code
  ids, exports, or resolver tables), builds through the Vite plugin with the
  virtual resolver-entries module (`sourceModules` forces first-build entry
  discovery for modules reachable only through the virtual module), and a
  Chromium test proves the manifest carries the compiler-generated identity
  `app/note-button.ts#$0`, the generated chunk stays unloaded until first
  interaction, loads once for concurrent clicks, executes with the client
  service while setup/view counters stay zero, and disposal stops dispatch.
  `effect-atom-jsx/portable-extract` and the `compiler/*` modules are now
  published package subpaths. Milestone 7's manual-authoring escape hatch and
  compiled path are both browser-proven.
- `docs/RESUMABILITY_GUIDE.md` (DoD item 10) now documents hydration vs
  partial portability vs resumability plus the security and
  deployment-version rules.

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

Status: M8a identity/collection, M8b text patching, M8c.0 baseline/JSX ABI, and
M8c.1 measurement/retention attribution are implemented. Reusing privately
trusted immutable manifests reduced fixed retention, and calibrated fixed-cost
and per-expression-slope gates are green. M8c.2 now has its manifest v4 target
union, v3 compatibility path, one-pass mixed-target scanner, ownership checks,
and conservative target-name fences; installation patch strategies are next —
see
`RESUMABILITY_M8_FINE_GRAINED_DESIGN.md` and
`RESUMABILITY_M8C_PLAN.md`
(regions-as-identity, compiler-assigned expression ids, reactivity-key-only
restored subscribers, boundary-controller handoff; phased M8a collection →
M8b text-patch slice → M8c measurement/widening)

Implemented M8a surface: the companion transform extracts explicit
text-only `expr(...)` markers into `#expr$...` portable entries; SSR verifies
declared semantic reads, resolves state-handle dependencies to implicit
`af:binding:<component>/<binding>` keys, emits validated `af:expr:x<N>`
comment regions, and now serializes manifest v4 text-target records. Legacy v3
text records remain decodable and installable. Expression
instances are document-local and are never re-derived by the client.
Unsupported output, undeclared/unresolved dependencies, and missing regions
fail closed with collection diagnostics. Client installation now creates
key-indexed lightweight subscribers without loading their modules. A typed
dormant state write accepts the binding codec and its inferred domain value,
updates the existing component snapshot after encoding, coalesces
invalidations, lazily resolves the expression through the shared resolver,
decodes ordered dependency values with the expression-owned codec, and reuses
the SSR text node. Hierarchical witnesses retain their expanded
trigger keys while an optional key-only `inputs` projection preserves codec
order; no dependency values are duplicated on the wire. Resume/activation
claims suppress queued work
and dispose running subscribers before component ownership begins.

Design decision (supersedes the original items 1–2): serialized dependency
identity is **semantic reactivity keys exclusively**. The signal, owner, and
computation core stays identity-free — signals hold live subscriber
references, owners have no paths, and adding wire identities to that hot
path would duplicate what reactivity-key version signals already provide as
authored, string-keyed, wire-safe identity. Atom-backed state joins the
dependency graph through `Atom.withReactivity` rather than through
per-signal identities, and every restored binding's hydration key doubles as
an implicit reactivity key (`af:binding:<componentId>/<bindingName>`), so
the common binding-displaying expression needs no authored key. The
Reactivity system is an Effect service, so this one key vocabulary spans
actions, loaders, single-flight revalidation, restored queries, and (via
custom layers) server-pushed invalidation. Low-level read capture is used
only as an SSR-time *verification* channel for declared `deps` (via the
existing `beginReactivityReadCapture`), never as a wire format. If a future
need for sub-key granularity appears, it should be met by finer authored
keys, not by identifying signals.

Work:

1. Introduce stable identities for dynamic DOM expression boundaries
   (compiler-assigned code identity plus validated per-session instance
   ids); the reactive core itself remains identity-free.
2. Declare expression dependencies as canonical reactivity keys and verify
   the declaration against SSR-captured reads, failing closed on
   undeclared reads.
3. Extract dynamic render expressions into addressable code with explicit
   captures.
4. Serialize dependency-to-expression relationships and restore lightweight
   client subscriber records subscribed to reactivity-key version signals
   only.
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

### Milestone 8d — Structural expression targets (keyed lists, branch replacement)

Status: **in progress** — face 1 (the keyed-reconciliation prerequisite) landed
2026-08-11; faces 2 and 3 are specified and unblocked by `DQ-030`.

Gated on M8c.7's measurement go/no-go, which **returned GO**. `DQ-010` deferred
the region representation to this milestone precisely so it would not be
designed before that gate reported; `DQ-030` now decides it.

**Ratified design (`DQ-030`, 2026-08-11).**

1. **Ownership is a per-instance child `Scope`.** Each row or branch instance
   gets a child `Scope` under the installation's Scope; content subscribers
   register with `Scope.addFinalizer` and removal closes it with `Scope.close`.
   Not a reactive `Owner` — `Resume.ts` is Scope-first throughout, and
   "cleanup on the reactive owner instead of the `Scope`" is the exact
   signature of the leaks fixed in `Element.on`, `collection().observeEach`,
   `setAttr`, and `setStyle`. A region owner *shared by all rows* was the
   provisional lean and is **overruled**: it cannot dispose a single removed
   row, which is the milestone's primary case. Branch replacement is the
   degenerate one-instance case, so there is one mechanism, not two.
2. **Per-row identity is `data-af-key` on a single element root**, fenced at
   **compile time** by the Babel plugin's existing rejector (the one that
   already code-frames `onClick`, spread, `href`/`src`, `prop:*`, `ref`,
   component props, and member elements), with the collect-time diagnostic
   retained only for the dynamic/generated path. Chosen over per-row marker
   comments because markers push directly on the **slope ceiling of 1.10**, the
   gate that scales with row count.
3. **The manifest gains one `{ kind: "structural", mode: "list" | "branch" }`
   member**, extending the existing compile-time exhaustiveness device at
   `Resume.ts:262-275` rather than adding a parallel one. `target` *is* a wire
   field, so this is a real **v4 → v5 bump** — `DQ-002`'s "widening is
   authoring/patch only" does **not** transfer. Low risk: buildId is enforced at
   seven sites, so a stale client fails closed rather than misreading.

Work:

1. **`dom.reconcileArrays` (face 1).** Status: **done** (2026-08-11). Exported
   with identity-preserving semantics. `DQ-010`'s "just expose the existing
   private function" premise was wrong and hid two defects — the reconciler
   dropped surviving nodes on reorder, and `ServerNode.insertBefore` duplicated
   rather than moved. See the correction in `RESUMABILITY_M8C_PLAN.md`.
2. **Region representation.** A structural region delimited by the existing
   `af:expr:<id>:start|end` markers, holding `Map<key, Scope>`. Disposal is
   driven from **the same computation that produces the reconciler's removals**,
   so "dropped from the DOM" and "Scope closed" are derived from one list rather
   than kept in agreement by convention — the structural-vs-guarded move that
   closed `DQ-099` and the M4 install race.
3. **Collect side.** Emit `data-af-key` per row, the `structural` target kind,
   and the v5 manifest entry. Fail closed with a named diagnostic when a row has
   no single element root on the dynamic path.
4. **Compiler side.** Reject a non-single-element-root row in authored JSX with
   a code frame, next to the existing JSX rejections.
5. **Client side.** Resolve the region's portable code on first invalidation,
   reconcile rows by key, close the Scopes of dropped rows, and open child
   Scopes for added ones.
6. **Manifest compatibility.** Extend `manifest-compat.test.ts` with v5
   fixtures and a v4-decodes-on-v5-client case.

Acceptance:

- A keyed update patches **only** the changed rows: surviving rows keep node
  identity, and the assertion is identity, not rendered text.
- A removed row's subscribers are disposed **when the row is removed**, not when
  the component unmounts. Asserted by counting finalizer runs, not by inspecting
  final state — all three lifecycle leaks found in the 2026-07-30 audits left
  correct-looking final state.
- A replaced branch disposes the outgoing branch's Scope exactly once.
- Structural output on a **text/attribute/class/style** target remains rejected
  with `unsupported-expression-output`; the existing fence spec must stay green
  unchanged.
- A row without a single element root fails at build time in authored JSX, and
  falls back with a diagnostic on the dynamic path.
- The 8c payload and slope gates still pass at density 24.

Open, and deliberately not decided here:

- **Whether `data-af-key` or per-row markers win** is settled by measurement,
  not argument: run the density-24 fixture with markers and read the slope. If
  markers come in under 1.10 they are strictly more general and should replace
  `data-af-key`. Until that is run, `data-af-key` is the ratified choice and the
  single-element-root constraint is load-bearing.

### Milestone 9 — Hardening, documentation, and adapter stability

Status: deferred

Work:

1. Document the ordinary, partial, and fully addressable authoring paths.
2. Publish the adapter SPI only after the proof adapter and at least one
   external-style consumer exercise it.
3. Add diagnostics for capture size, unsupported policy, missing codec,
   unknown code identity, build mismatch, stale DOM marker, and duplicate ID.
4. Add compatibility/version tests for manifest decoding.
   (fixture tests landed: manifest-compat.test.ts)
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

### Milestone 10 — Ergonomic and power extensions (auto-capture, universal serialization, Qwik-parity layer)

Status: proposed; sequenced after the Milestone 9 SPI freeze

The strict core made three deliberate trades: explicit captures over inferred
ones, schema-per-capture over a universal serializer, and compile-time
capture errors over runtime serialization errors. This milestone layers the
permissive alternatives **on top of** the frozen core as opt-in modes, so the
strict model subsumes the Qwik-style model rather than competing with it.
The observation enabling this: Qwik never serializes code either — it
serializes extracted-module references plus captured values. We already have
the references (Portable) and the extraction (the resume-extract transform);
what this milestone adds is capture inference and a general value codec.

Work:

1. **`extract.auto` / `expr.auto` transform mode.** Status: implemented
   (transform slice; universal codec pending). `extract.auto(fn)` and
   `expr.auto(render, { dependencies, deps })` exist as fail-closed runtime
   markers in `src/portable-extract.ts` and as an
   auto-capture mode in `src/compiler/resume-extract-plugin.ts`: the
   module-closed check collects the captured outer identifiers instead of
   rejecting them, and the transform synthesizes
   `captures: Schema.Struct({ <name>: Schema.Unknown, ... })` (from a
   generated `Schema` import, `schemaModule` option, default `effect`), a
   call-site `bind: { <name> }`, and a wrapper `run` that destructures the
   captures before invoking the original function. `this`/`super`/`arguments`
   stay hard errors; secret-name and oversize diagnostics apply to inferred
   captures; identity policy and the duplicate-identity guard are shared with
   explicit `extract`; `onCode` entries carry `inferredCaptures`. Inferred
   captures are `Schema.Unknown` today — the universal codec below is what
   upgrades them beyond `Portable.describe`/`jsonValueIssue` JSON validation.
   `expr.auto` shares that whole synthesis path and adds one asymmetry that is
   deliberate and ratified: **dependency identity is never inferred.**
   `dependencies` and `deps` stay required and explicit on `expr.auto`, and
   declaring `captures`/`bind` alongside them is a compile error — a missed or
   spurious dependency edge is a correctness bug no heuristic may introduce, so
   only the capture axis degrades to runtime-validated. The original
   description follows.

   The module-closed check
   already detects every captured identifier in order to reject it; auto
   mode flips detection into synthesis — the transform generates the
   `captures` record and `bind` object from the detected identifiers.
   Secret-name and oversize diagnostics still apply to inferred captures and
   remain fail-closed. The mode is per-call-site (`extract.auto(fn)`) and
   per-project (a plugin option), never the default. Inferred captures use
   the universal codec below, so the typed-wire guarantee explicitly
   degrades to runtime-validated; the transform records which captures were
   inferred so diagnostics can say so.
2. **Universal value codec via seroval (JSON-tree mode only).** A
   `Serialization` layer backed by seroval's `toJSON`/`fromJSON` tree form,
   which handles cycles, Date/Map/Set/RegExp, typed arrays, and custom
   classes through its plugin system. Two hard constraints: seroval's
   eval-string output mode is **prohibited by default** — the manifest must
   remain inert JSON per the security rules (an adapter may opt into
   eval-mode explicitly, outside the default trust story, and the docs must
   say what that costs under CSP); and the manifest must record the
   serializer identity so a client with a different codec configuration
   rejects the payload instead of misdecoding it (same discipline as the
   build-ID gate).
3. **Reference plugins for framework-managed values.** seroval plugins that
   serialize framework values as references, not structure: state
   handles/atoms by hydration key, `Portable.BoundCode` as descriptors,
   reactivity-key witnesses by canonical key, `SafeHtml` under its branding
   rules. This mirrors Qwik's rule that captured state must live in
   framework primitives (`useSignal`/`useStore`) — ours is
   `Component.state`/atoms with hydration identity. Live resources (Scope,
   Fiber, Layer, service instances, DOM nodes) remain non-serializable;
   service access continues to cross the boundary as typed `R` requirements
   resolved from the client Layer — the one capability this model has that
   Qwik's capture model cannot express.
4. **Qwik-parity adapter package** (working name `@affe/permissive`):
   auto-capture + universal codec + reference plugins bundled as one
   configuration, with an optional store-proxy layer that records
   proxy-to-consumer edges for adapter-level dependency graphs (the core
   stays keys-only per the ratified Milestone 8 decision). This package
   doubles as the external-style SPI consumer Milestone 9 requires, proving
   the adapter-enablement claim with the most demanding consumer available.
5. **Capture ergonomics polish**: per-capture size attribution in
   diagnostics; a `deps.auto` assertion mode for expressions once SSR read
   capture is trusted (design doc open question 1); glob-based
   `sourceModules` discovery.
6. **Deferred**: promise/stream captures (seroval's async forms) — blocked
   on the async/streaming SSR question (Open Question 9); no serialization
   of in-flight Effects.

Acceptance:

- An `extract.auto` closure over local values (including a Map and a cyclic
  structure) round-trips without a hand-written schema; a secret-named
  inferred capture is still a compile error; the manifest remains inert,
  HTML-safe JSON within the byte ceiling.
- A serializer-identity mismatch between server payload and client
  configuration fails closed before any value decodes.
- Framework values captured automatically arrive as live references
  (restored handle, resolvable descriptor), never as detached copies.
- The permissive package builds against public `@affe/*` APIs only, and a
  Qwik-style demo (one-liner event handler with inferred captures) resumes
  in Chromium with component counters at zero.
- Strict-mode projects are byte-for-byte unaffected: no seroval in their
  bundle, no behavior change, no new defaults.

### Milestone 11 — Streaming SSR with parallel route data (resolves Open Question 9)

Status: proposed; sequenced after Milestone 9 (touches the renderer, the
resume session, and the manifest contract at once)

**Blocker found 2026-07-30 while writing `future/streaming/` specs — decide
before implementing item 1.** Item 1 makes the *resume session* per-request, but
`renderToString` also installs a **global server `document`/`Node`**, and
nothing in this milestone makes that per-render. Items 2 and 3 require
suspending mid-render, at which point two concurrent renders would share one
mutable document — so de-globalizing the session is necessary but not
sufficient. Note that Effect v4 here has **no `FiberRef`**: context is the
fiber-local mechanism, but `Effect.runSync` inside `renderToString` starts a
fresh fiber, so per-render state needs a service paired with an ambient dynamic
scope (the pattern `src/resume-session.ts` uses, and the one Router R2 adopted
for its per-request head store). The specs sidestep this by suspending
*between* synchronous passes; real streaming cannot.

Today the framework streams **data** but not **HTML**: `renderToString` is a
single synchronous pass, critical route loaders resolve before the response,
and deferred loaders stream in afterward as injection-safe scripts
(`streamDeferredLoaderScripts`, proven out-of-order by the `ooo-async`
example). The resume protocol leans on that synchrony: one module-global
session per render, markers emitted in one pass, manifest finalized before
the response exists. This milestone makes the HTML plane stream too, and
unifies it with the router so all route data fetches in parallel with
rendering. Resumability *reduces* the pressure for streaming (dormant pages
are interactive on arrival), so the target is slow-critical-content TTFB and
loader parallelism — not hydration-latency theater.

Work, in dependency order:

1. **Per-render server render state** — session **and document and SSR mode**.
   *(Renamed and widened 2026-07-30, ratifying `DQ-001`; was "fiber-local
   resume sessions".)* Replace the module-global `activeSession` swap **and the
   module-global server `document`/`Node`** with per-render state, so concurrent
   requests and interleaved async renders cannot cross-contaminate. This is the
   Effect-native answer to the AsyncLocalStorage hacks other frameworks use, is
   valuable for server robustness even without streaming, and is the prerequisite
   for everything below. Ship it first and alone.

   Two corrections to the original text, both load-bearing:

   - **There is no `FiberRef` in this Effect v4 beta.** Context *is* the
     fiber-local mechanism, but `Effect.runSync` inside `renderToString` starts a
     fresh fiber, so a service alone does not survive the render. Per-render state
     needs a service **paired with an ambient dynamic scope** — the pattern
     `src/resume-session.ts` already uses, and the one Router R2 adopted for its
     per-request head store.
   - **De-globalizing the session is necessary but not sufficient.** `dom.ts`
     installs a global server `document`/`Node` (`:1232`/`:1235`, restored in a
     `finally` at `:1245–1262`). Items 2 and 3 require suspending *mid-render*, at
     which point two concurrent renders would share one mutable document. That is
     why the document belongs in this item's scope rather than being discovered
     during item 3.

   The isolation acceptance test must therefore assert **disjoint documents** as
   well as disjoint manifests.
2. **Async setup during SSR.** Component setup is already an Effect; the
   synchronous renderer simply never awaits it. Introduce an async render
   mode in which setup Effects may suspend, scoped per request, with a
   deadline and a fail-closed timeout diagnostic. Ordinary synchronous
   components are unaffected.
3. **`renderToStream`.** Shell-first ordered streaming: synchronous content
   flushes immediately; each async boundary emits a placeholder region
   (comment-pair, same discipline as resume boundaries) and its content
   flushes when its setup settles — in order first, then an out-of-order
   mode using the `ooo-async` swap technique (inline nonce-carrying swap
   scripts; must remain CSP-compatible, documented alongside the manifest
   CSP rules).
4. **Router integration: parallel fetch-and-render.** On a server
   navigation, fork **all** matched route loaders at once (critical and
   deferred) as fibers under the request Scope, and start streaming the
   shell immediately — instead of today's loaders-then-render sequence.
   Regions gated on critical loader data flush as those loaders settle;
   deferred loaders keep their existing script-streaming path unchanged.
   Loader results enter the existing loader cache/single-flight identity so
   client revalidation does not refetch what the stream already delivered.
   No new data wire format: this composes `runStreamingNavigation*`,
   `SingleFlightPayload`, and the loader cache rather than replacing them.
5. **Streaming manifest.** The resume manifest becomes incremental: a
   manifest chunk per flushed region (same schemas, same build-ID and
   serializer gates, byte ceiling enforced cumulatively), with a terminal
   completeness record so `installClient` can distinguish "stream ended"
   from "stream truncated" and fall back closed. Boundaries/expressions
   inside never-flushed regions are never registered — the ghost-snapshot
   rule generalized to streaming.
6. **Client install over a live stream.** `installClient` tolerates
   installing before the stream completes: dormant interactions on flushed
   regions work immediately; interactions targeting unflushed regions queue
   against the same exact-once claim machinery the handoff already ratified.

Acceptance:

- All matched loaders for a navigation start fetching in parallel before
  any component renders, and a slow deferred loader never delays first
  byte.
- A page with one slow critical region streams its shell immediately,
  flushes the region on settle (ordered and out-of-order modes), and every
  existing resumability Chromium proof passes unchanged against streamed
  output.
- Two concurrent server renders cannot observe each other's resume
  sessions (fiber-local isolation test).
- A truncated stream yields a closed failure (activation/hydration
  fallback with a diagnostic), never a partially-trusted manifest.
- Streamed pages remain CSP-compatible under the documented policy, and
  single-flight revalidation after streaming does not duplicate fetches.

Unblocks after landing: Milestone 10's deferred promise/stream captures
(seroval async forms), server-push invalidation demos over the same
streaming transport, and Milestone 11b below.

### Milestone 11b — Server UI fragments (`Resume.mountFragment`)

Status: proposed; a small design delta on Milestone 11 item 6 (incremental
manifest install), sequenced immediately after it

The capability: a typed server function returns **live, dormant UI** — the
answer to TanStack Start's "server functions returning components" and to
"do you have server components?", without a flight protocol. The server
side already composes today: any `ServerRoute.json`/`action` handler can run
`Resume.collect` over a component and return `{html, manifest}`,
schema-validated and build-ID-stamped. What this milestone adds is the
client receiving primitive and the composition rules.

Why this beats the patterns it answers: TanStack's returned JSX is
display-only until client component code hydrates it; an RSC payload needs
the flight runtime and client components for interactivity. An Affe
fragment arrives as HTML plus a manifest chunk — dormant,
interactive-on-first-touch, loading only the action/expression code an
interaction addresses, with zero component code shipped for the fragment
itself.

Work:

1. `Resume.mountFragment(installation, region, {html, manifest})`: inject
   the fragment HTML into a validated boundary region, then install the
   fragment's manifest **scoped to that region** as an incremental install
   into the existing page installation (the same mechanism as M11 item 6's
   streamed-region install — a fetched fragment and a streamed flush are
   one operation arriving over different transports).
2. **Manifest namespacing across installs.** Fragment-local ids (`c0`,
   `e0`, `x0`) must not collide with the page's: ids become
   installation-scoped (instance ids are already document-local per
   session, so this is the natural extension). Build-ID equality between
   the page and every fragment is enforced; mismatch falls back closed
   (render the HTML inert, diagnostic emitted).
3. **Lifecycle**: replacing or removing the region disposes the fragment's
   listeners/subscribers/boundaries exactly once through the existing
   boundary state machine; fragment disposal never touches the parent
   installation.
4. A typed authoring wrapper pairing the server handler with the client
   call (schema'd args in, `{html, manifest}` out), composing with
   single-flight so a mutation can return replacement UI *and* revalidated
   loader data in one round trip.
5. Fixture + Chromium proof: a server function returns a fragment; it
   mounts into a live page; its button resumes on first click with the
   page's counters unaffected; region replacement disposes it exactly
   once.

Non-goals: no server-component re-render loop, no flight protocol, no
streaming of fragment internals in v1 (a fragment is one settled
collection result; streamed fragments compose later with M11 item 5).

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

| Risk                                                  | Mitigation                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| The SPI becomes a second component framework          | Keep definitions small, optional, and read-only; raw setup remains opaque                        |
| `CodeRef.load` is mistaken for serializable data      | Serialize only logical ID and captures; resolve loaders through a build manifest                 |
| Descriptors leak live server objects                  | Separate runtime descriptors from versioned wire records and schema-audit projections            |
| Slot handles are mistaken for DOM identity            | Assign renderer/compiler node IDs; use slots only as semantic enrichment                         |
| Wrapper metadata is lost                              | Centralize all component decoration copying and test every wrapper family                        |
| Collector state leaks across requests                 | Per-render session, stack discipline, `finally` cleanup, nested/back-to-back render tests        |
| First interaction stalls on import                    | Add adapter-level preload/prefetch later; measure before inventing policy                        |
| Browser API requires synchronous event handling       | Diagnose and force eager/fallback attachment for that event/option                               |
| Captures bloat HTML or expose secrets                 | Explicit codecs, size budgets, allow/deny diagnostics, no reachability-wide automatic graph walk |
| Server and client deployments disagree                | Protocol/build IDs and deterministic mismatch fallback                                           |
| Restored handle semantics differ from current handles | Capability-advertised restoration, one handle kind at a time, parity tests                       |
| Hydration and resumability duplicate caches           | Reuse Hydration, Registry, Serialization, Result wire records, and single-flight seeds           |
| Compiler IDs churn                                    | Define and test a stable identity policy; keep manual IDs available                              |
| No-op instrumentation slows normal rendering          | One cheap inactive check and benchmarks before/after                                             |

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
9. ~~When async/streaming SSR arrives, will render instrumentation use
   renderer instances, Effect fiber-local context, or platform-specific
   async-local storage?~~ **Answered by Milestone 11**: Effect fiber-local
   context, shipped first and alone as the prerequisite slice.
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

> Structural, cross-cutting improvement notes (Result unification, identity
> families, M9-before-M8b sequencing, stability policy) live in
> `DESIGN_IMPROVEMENT_NOTES.md`; this section tracks tactical per-milestone
> findings.

## Design Review Notes (2026-07-28)

Observations and suggestions from a review of the implemented protocol
(Milestones 0-6 plus the Milestone 7 transform slice). Each item is scoped so
it can be picked up independently; none blocks the current milestone order.

### Defects to fix in the resume-extract transform

1. **Hoist placement can create a TDZ error.** Generated `Portable.code(...)`
   definitions are inserted after the module's imports. If a `captures`
   schema expression references a module `const` declared later in the file,
   the hoisted definition throws at module load. Fix: insert each generated
   definition immediately before the statement containing its call site
   instead of in the module header.
2. **`this`/`arguments` escape the module-closed check.** The capture
   diagnostic catches identifier references but not `ThisExpression`,
   `arguments`, or `super`. An arrow using `this` inside a method hoists to
   module scope and silently changes meaning. Fix: reject these with the same
   code-framed compile error used for identifier captures.

### Compiler identity policy

- Ordinal identities (`module#$0`) for unassigned `extract` calls are
  internally consistent per build but renumber when an earlier unassigned
  call is added, churning cache/prefetch identity across deploys. When the
  Vite manifest slice lands, consider a content-hash component in the ordinal
  case (or a lint requiring `const` assignment) so identities only change
  when the extracted code changes.
- Marker detection is by import-source suffix (`portable-extract`) and is
  configurable. A same-name application module could false-positive; the
  failure is compile-time and visible, so this is acceptable, but worth
  documenting with the Vite integration.

### Runtime protocol observations

- **Dual `Result` models are a recurring tax.** The core `effect-ts` Result
  (`Loading/Refreshing/Stale/Defect`, carries `Exit`) and the flat
  `Result.ts` fetch model meet at every wire feature (query snapshot/restore
  hit the `Stale` branch and timestampless `Success` explicitly). After the
  resumability program stabilizes, consolidate to one model or one canonical
  projection module so future wire features pay the conversion cost once.
- **Restored query handles sit outside the `QueryKey` system** because
  symbol-keyed `QueryKey`s are not serializable. Canonical string reactivity
  keys on query handles (in progress as part of closing Milestone 6) are the
  right vehicle; once present, `RestoredQueryHandle.refresh` should be
  subscribable through the same invalidation path as live queries rather
  than remaining caller-wired.
- **Manifest byte-ceiling attribution.** The 64 KiB default was sized for
  event-only manifests; per-component state and query snapshots will reach
  it sooner. The failure is loud (hard error at collect), but
  `ResumePayloadTooLargeError` should attribute size per component/binding
  so the first real collision is debuggable without bisection.
- **`Behavior.attachScoped` asserts rather than proves its requirement
  type.** The `Exclude<Req, Scope.Scope>` return type is implemented with a
  cast. Acceptable, but worth revisiting if Effect gains a first-class way
  to discharge a Scope requirement without widening.

### Serialization extension points (documentation follow-up)

Custom wire representations are already supported at two levels: per-value
via `Schema.Codec` transforms on captures/state/query/props schemas (the
encoded side must pass `jsonValueIssue`), and whole-manifest via a custom
`Serialization.Tag` layer (output must remain an HTML-embeddable string and
is measured against the byte ceiling). Closures, live handles, scopes, and
service instances remain address-only by design. `RESUMABILITY_GUIDE.md`
covers the rules; an example of a transform-backed codec (Date/Map) in the
guide would make the per-value path more discoverable.

## M0-7 Test Audit Findings (2026-07-29)

A full-review pass over the M0-7 implementation, cross-checked against the
test suites. Unresolved findings remain pinned by `it.fails` tests in
`resume.test.ts` ("Resume audit pins") that flip green when fixed.

1. **Restored-query refresh drops concurrent invalidations** (pinned):
   `refresh` returns immediately when the state is `Refreshing`/`Loading`
   instead of coalescing-and-rerunning like the expression scheduler does.
   A second invalidation during a slow executor load is lost; the query
   stays stale. Fix: mirror `RestoredExpressionController.dirty`.
2. **Resolved.** `Portable.makeResolver` now shares one in-flight attempt,
   retains only a successful code value, and returns to `Idle` after failure.
   A transient chunk-load failure therefore reaches every current waiter but a
   later interaction can retry. The state transition uses `Ref` plus
   `Deferred`, including interruption-safe completion; it no longer relies on
   `Effect.cached` failure semantics.
3. **`activate` vs `resume` racing on one boundary silently honors the
   first mode**: the second caller's mode is discarded with no diagnostic.
   Needs a mode-conflict diagnostic or a documented first-wins contract.
4. **Event-claim asymmetry**: portable markers keep walking the ancestor
   path after dispatch (ancestor same-type markers also fire) while
   activation markers return after claiming. Ancestor/descendant marker
   combinations behave inconsistently; needs one documented claim policy
   plus tests over two-marker chains.
5. **`closestBoundary` ranks over snapshot-bearing controllers only**, so
   an event inside a snapshot-less inner boundary is claimed by its
   snapshot-bearing ancestor — activating the ancestor and disposing the
   inner region that owned the interaction. Runtime claim and install-time
   ownership validation use different maps and can disagree.
6. **Resume-to-activation fallback can double-mount** when restoration
   fails inside the render callback after DOM writes began: nothing
   restores the region to SSR content before the activation mount inserts
   a second copy. Existing tests fail only pre-mount.

Smaller: interrupted refresh writes into a disposing component (finalizer
LIFO makes `disposed` false during interrupt); public
`restoreStateBindings` silently allows double-restore of one componentId;
a frozen bindings object from a behavior reattach turns the withSlots
defineProperty into a terminal defect instead of a fallback-classified
error.

## M8 Test Audit Findings (2026-07-29)

Ranked scenarios from a full review of the expression implementation. The
hardening pass resolved or pinned the concrete correctness cases below; item 2
remains an explicit lifecycle-policy decision.

1. **Resolved.** Cross-component dependency goes silently stale after partial activation
   (`expressionIsDormant`/`notifyExpressions`/`resolveWritableBinding`):
   expression owned by B depending on `af:binding:A/x` keeps SSR text
   forever once A activates. Ownership should follow the dependency or
   diagnose. Collection now rejects both authored internal keys and typed state
   handles whose owning component is not the expression's closest boundary.
2. **Resolved.** Activation now stages ownership transactionally. Dormant
   expressions (and dormant descendants) are quiesced while code resolution
   and mounting run, then surrendered only after the active mount commits.
   Typed loader/component failures roll back to `dormant`, rearm pending
   expressions, and permit a later retry. Missing/mismatched descriptors,
   capture/build drift, defects, and disposal remain terminal. A staged mount
   is disposed if interruption or failure wins before commit.
3. **Covered.** Dispose during an in-flight resolve/execute
   (`Fiber.interrupt(running)` path + observer dormancy guard).
4. **Covered.** Two expressions sharing one dependency key now prove fan-out
   completeness and last-subscriber key deletion.
5. **Resolved.** A component dropped at collection (`missing-component-boundary`) that
   contains an expression turns a warning into a fatal
   `ResumeExpressionOwnershipError` for the whole install; the expression
   entry should be dropped with its component. Collection now removes the
   expression entry and its reserved HTML sentinels with the missing owner.
6. **Covered.** Empty-string SSR output and ""->x->""->y patch round-trips
   exercise zero-node and replacement paths.
7. **Resolved.** Babel-only intra-module `expr` identity collision: two
   same-named consts in different functions share one portable id; the
   transform now rejects the duplicate at its second source location.
8. **Resolved.** Deep-freeze bypass: `rememberValidatedManifest` skips values with
   non-plain prototypes before freezing, so class-instance captures stay
   mutable inside a memoized-as-validated manifest (`isValidatedManifest`
   then skips re-decode). Freeze arbitrary capture graphs or key the memo
   on more than root identity. Manual manifest values must now pass the same
   plain-JSON graph check as collected/serialized payloads before receiving a
   validated identity proof.

Also noted: duplicate diagnostics on SSR computation re-runs; expressions
bound outside a session produce no ghost diagnostic; capture-based
undeclared-read verification can be bypassed by closures that skip
`trackReactivityRuntime`; `deps:` accepts non-array expressions at compile
time; list/conditional `expr` shapes defer failure to collection.

### Audit pins II results (2026-07-29)

New tests in `resume.test.ts` describe "Resume audit pins II (2026-07-29)":

- M0-7 finding 3 — pinned-failing (`it.fails`): an `activate()` joining an
  in-flight `resume()` is coalesced with zero diagnostics; first-wins holds
  but the conflicting mode is discarded silently.
- M0-7 finding 4 — two pinned-failing, one passing: portable+portable on one
  path fires both owners (`["child", "parent"]`); a portable descendant plus
  activation ancestor fires the portable owner AND activates the ancestor;
  only the activation-descendant/portable-ancestor combination is
  exactly-once (activation claims and stops the walk).
- M0-7 finding 5 — passing (not reproduced): both fixture shapes fail closed
  at install time (`ResumeUnknownComponentBoundaryError` for an untracked
  inner marker; `ResumeActivationEventOwnershipError` for a manifest inner
  boundary without an activation descriptor), so the runtime claim/validation
  disagreement is unreachable through `installClient`.
- M0-7 finding 6 — pinned-failing: a throw inside the restored render
  callback is swallowed and the boundary reports `active` with no fallback
  (setup never reruns), violating the `Active` readiness guarantee; the
  double-mount hazard's precondition is unguarded.
- M8 finding 3 — passing (not reproduced): disposal during an in-flight
  gated resolve interrupts the fiber, leaves the SSR text untouched, and
  reports no diagnostics.
- M8 finding 4 — passing (not reproduced): one dependency key fans out to
  both subscribed expressions and disposal of the last subscriber deletes
  the key.
- M8 finding 6 — passing (not reproduced): a zero-node empty-string SSR
  region round-trips ""->x->""->y through the multi-node patch path.
- M8 finding 8 — passing, documents the bypass: `Portable.describe` rejects
  non-JSON captures, but a hand-built in-memory manifest carries a class
  instance through validation unfrozen (`Object.isFrozen === false`) and a
  post-validation mutation is observable at dispatch.

## Ratified 2026-07-30 — streaming, SPI and serializer decisions (`DQ-005`–`DQ-012`)

Closing the remaining blocking design questions for M9/M10/M11. `DQ-001` is
ratified inline in Milestone 11 item 1 above; `DQ-002`–`DQ-004` are in
`RESUMABILITY_M8C_PLAN.md`.

**`DQ-005` — async collection is a separate entry point, with one request-level
deadline.** `Resume.collectAsync` / `renderComponentAsync` sit beside the
synchronous pair rather than replacing them; the type-level separation is what
makes item 2's "no regression to the synchronous path" promise *checkable*.
The deadline is **request-level only** in the first slice, and an overrun is
classified as a **per-region activation fallback** — reusing the existing
fail-closed path, so a slow region degrades to "interactive after activation"
rather than a 500. Per-boundary deadlines are additive later and should not be
designed before there is evidence that one boundary starving another is real.

**`DQ-006` — async boundaries are explicit, and `renderToStream` stays in `dom`.**
An *implicit* boundary would make page structure a function of timing; this
project's consistent stance elsewhere — declared `deps`, declared captures,
declared slots — is that structure is **authored, not inferred**. Keep the
function beside `renderToString` for the first slice (splitting the module is a
refactor that can follow once the `Stream` surface is stable), and make
ordered/out-of-order **one option on the call**, not two functions, since the
plan already sequences out-of-order as a follow-on mode of the same operation.

**`DQ-007` — a new discriminated manifest version, and completeness is a set.**
Follow M8c Decision 4's precedent: a new version rather than optional fields
bolted onto the old one. The terminal record carries **region ids, not a count**,
so the completeness check is *set equality* rather than arithmetic — robust to a
duplicated or reordered flush in a way a counter is not. The byte ceiling is
cumulative across records, with an error distinct from
`ResumePayloadTooLargeError`'s single-manifest form (or that error extended with
the per-record attribution the M9 review already asked for).

**`DQ-008` — one internal `ingestRecord`, three public doors.**
`installClientStreamed`, `installClientStreaming.ingest`, and
`Resume.mountFragment` all call the same internal primitive. That is what makes
the plan's claim *"a fetched fragment and a streamed flush are one operation"*
true **in code rather than in prose**. Pin the truncation error tag when `DQ-018`
settles the error union.

**`DQ-009` — every marker is scope-qualified, including the page's.**
`"<scopeId>:<eventId>"`, with `:` reserved and rejected inside region and
installation ids at collection time. Sharing one allocator across installations
is impossible for fragments by construction — independent collections cannot
share an allocator — which is decisive. Critically, the **page** installation
gets an explicit scope id too: a special-cased unqualified page marker is exactly
how a fragment id eventually collides with it.

**`DQ-010` — expose the existing reconciler; defer the fence-lifting.** Face 1 is
not a design question once framed correctly: add a narrow
`dom.reconcileChildren(parent, current, next, marker)` mirroring the private
signature at `src/dom.ts:183`, which closes the spec without touching the fence.
Keyed-list and branch-replacement *targets* (faces 2 and 3) are **explicitly
deferred to a named milestone after 8c.7's go/no-go** — do not design them before
the measurement gate. Provisional lean for when they are taken up: the **region**
owns its content's subscribers (a lightweight region owner nested under the
boundary owner), not the boundary — otherwise every branch swap either leaks the
outgoing branch or tears down its siblings.

**`DQ-011` — the adapter SPI is blocked on M10 item 4, and M9 should say so.**
Amend M9 item 2 to read *blocked on the permissive package* rather than merely
"deferred": publishing an SPI before an external consumer has exercised it is how
you freeze the wrong surface. Commit now only to a runtime-readable `spiVersion`,
because that is what lets an adapter **fail closed on mismatch** — the same
discipline as the build-ID gate.

**`DQ-012` — serializer identity is a property of the layer.** Add
`readonly id: string` to `SerializationService`. The client's own id is then
simply the id of the layer it provided, which answers "how does a client discover
its own identity" with **no new mechanism**. Stamp it as `manifest.serializer`
beside `buildId` and gate it in the same place. Name the seroval escape hatch
`serovalUnsafeEval` and document its CSP cost at the export site. Rejected:
deriving identity heuristically — an unreliable identity is *worse* than none,
because it produces false rejections that look like data corruption.

### `DQ-009` corrections resolved (2026-07-30)

Speccing the ratified marker scheme surfaced two things the decision did not say.
Both are now decided.

**1. `DQ-009` is a breaking change to markers shipping today — sequence it with
the manifest version bump.** The decision was written as if scope-qualifying
markers were a streaming *addition*. It is not: `src/Resume.ts` already emits
**unqualified** page markers (`data-af-event-click="e0"`) for every resumable
page today. Adopting `"<scopeId>:<eventId>"` therefore changes the HTML of every
existing resumable page and invalidates the marker/manifest bijection for any
manifest already in flight.

So it **must not be slipped in** alongside unrelated work. Land it in the same
change-set as the manifest version bump that `DQ-007` already requires, so a
client sees either the old pair (old manifest + unqualified markers) or the new
pair, never a mix. A mixed page fails the scanner's bijection check — which is
the correct fail-closed outcome, but a confusing one to debug if it ships by
accident.

**2. The collection option is `installationId`, not `scopeId`.** Speccing the
`:`-rejection needed an input to reject, and `scopeId` was invented on the spot.
Ratified name: **`Resume.collect(render, { buildId, installationId })`**.

`scope` is deliberately avoided: `Scope` is a core Effect concept used throughout
this codebase for lifetimes, and reusing the word for a *namespacing* identity
would be a persistent source of confusion in exactly the modules that manipulate
both. `installationId` also names the thing correctly — the id belongs to the
installation (a page install or a mounted fragment), which is precisely what the
qualification is protecting against collision.

The page installation must supply one explicitly; there is no unqualified
special case, per `DQ-009`.
