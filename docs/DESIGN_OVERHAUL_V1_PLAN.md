# effect-atom-jsx v1 Design Overhaul Plan

Date: 2026-03-10
Status: Proposed (breaking changes allowed)
Owner: Core library redesign

## Intent

Redesign the public API to be smaller, clearer, and more coherent even if it requires major/breaking changes.

Success means:

- one obvious "golden path" for typical apps
- advanced escape hatches are explicit and isolated
- runtime/service behavior is predictable and type-guided
- async story is unified and documented without semantic ambiguity

## What Changes About Strategy

- We are no longer constrained to additive-only API evolution.
- We will prefer correctness and ergonomics over backward compatibility.
- We will still provide migration tooling/docs, but v1 may remove or rename APIs aggressively.

## Design Principles (v1)

1. One concept, one primary API.
2. Top-level exports are for app authors only.
3. Advanced/runtime internals move to explicit subpaths.
4. Async semantics must be explicit and composable.
5. Component/runtime/scope lifecycles are structurally enforced.
6. Observability should be structural and zero-cost when disabled.

## Target v1 Surface (Draft)

### Core app APIs

- `Atom.make` / `Atom.family` / `Atom.map`
- `defineQuery` / `defineMutation`
- `createMount` / `mount`
- `Loading` / `Errored` / `Show` / `For` / `Switch` / `Match`
- `refresh` / `isPending` / `latest`

### Advanced APIs (subpaths)

- `effect-atom-jsx/advanced`:
  - scoped constructors
  - raw `atomEffect`
  - explicit registry creation
- `effect-atom-jsx/internals`:
  - reactive primitives (`createSignal`, `createEffect`, etc.)

### Planned removals / consolidations (draft)

- Consolidate duplicated async entrypoints into tiered aliases then remove legacy names.
- Move low-level reactive exports out of top-level.
- Reclassify `Registry` as advanced unless golden-path prototype proves it should be implicit.
- Keep `AtomRef` as a first-class supported module for effect-atom compatibility.
- Improve `AtomRef` docs and interop guidance instead of deprecating it.

## Major Architecture Decisions to Finalize

1. **Async model**
   - Keep dual `AsyncResult` + `Result` with strict boundaries, or converge to one user-facing model.
2. **Registry model**
   - Ambient/implicit by default vs explicit in userland.
3. **Runtime model**
   - Ambient `mount/useService` primary vs explicit runtime-bound APIs primary.
4. **Export model**
   - Top-level minimal set + subpaths for advanced/internals.
5. **Identity model**
   - `Atom.family` lifecycle/eviction and hydration key strategy must be explicit.
6. **AtomRef interoperability model**
   - Preserve effect-atom familiarity while clarifying how `AtomRef` composes with Atom/query/mutation flows.

## Requested v1 Design Directives (Locked Inputs)

These directives are now explicit inputs to implementation planning.

1. **Linearize mutations with Effect generators**
   - Introduce action-style mutation flow (`apiRuntime.action(...)`) using `Effect.fn` / generator ergonomics.
   - Prefer linear happy-path code with optional `onError` hook.
   - Support two invalidation styles:
     - imperative `refresh(queryAtom)`
     - declarative `reactivityKeys` invalidation
   - Progress: `Atom.runtime(...).action(...)` and `Atom.action(...)` introduced as linear handles.

2. **Collapse async primitives to three primary concepts**
   - `apiRuntime.atom` for reads
   - `apiRuntime.action` for writes
   - `Atom.effect` for standalone non-runtime effects
   - Treat scoped and strict constructor variants as advanced/internal implementation details.
   - Progress: `Atom.effect(...)` added; further consolidation still in progress.

3. **Keep `isPending` and `latest` as first-class async UI tools**
   - Preserve expression-level pending checks (`isPending(() => expr)`).
   - Preserve stale-value peeking (`latest(expr)`).
   - Align behavior/docs with Solid 2.0 expectations.

4. **Adopt `withReactivity`-style declarative invalidation**
   - Keep manual invalidation wiring available.
   - Add/retain key-based reactivity invalidation as a clean alternative.
   - Integrate this path with runtime actions and RPC helpers.
   - Progress: `AtomRpc` / `AtomHttpApi` now support `reactivityKeys` on query/mutation/action paths.

5. **Move toward microtask batching + explicit `flush`**
   - Evaluate replacing user-facing `batch` guidance with microtask-default batching.
   - Add `flush()` escape hatch for imperative DOM sequencing.
   - If full migration is risky, ship behind an opt-in runtime flag first.
   - Progress: `flush()` + `setBatchingMode("sync" | "microtask")` added.

## Breaking Changes Policy

- Allowed in v1 with migration notes.
- Prefer renaming/removal over keeping confusing duplicates.
- Each breaking change requires:
  - rationale
  - before/after examples
  - migration snippet
  - codemod feasibility note

## Execution Plan

### Phase A - API Audit and Freeze

- Inventory all exports and classify into: core, advanced, internals, legacy.
- Freeze new API additions until the classification is complete.
- Publish v1 API contract draft for review.

Deliverables:

- `docs/V1_API_CONTRACT_DRAFT.md`
- export inventory table with recommended disposition

### Phase B - Golden Path Prototype

- Implement a full TodoMVC path using only target core APIs.
- Measure ceremony and conceptual load vs current README flow.
- Identify missing primitives required for real app development.

Deliverables:

- `examples/todomvc-v1/`
- migration comparison doc (old vs v1)

### Phase C - Async and Mutation Consolidation

- Settle query/mutation naming and strict-mode strategy.
- Keep temporary aliases for migration only.
- Add explicit state mapping docs and precedence rules.

Deliverables:

- unified async API section in docs
- deprecation map for legacy async names

### Phase D - Export Tiering

- Move low-level primitives to `/internals`.
- Move advanced APIs to `/advanced`.
- Keep transitional re-exports behind compatibility flag for one cycle (optional).

Deliverables:

- new subpath exports
- updated README import guidance

### Phase E - Identity and Hydration Hardening

- Finalize family eviction strategy.
- Ship hydration validation mode (done baseline) and key guidance.
- Add memory lifecycle docs and tests.

Deliverables:

- family eviction APIs/docs
- hydration mismatch diagnostics docs/tests

### Phase F - Cutover and Migration

- Publish migration guide and changelog with breaking matrix.
- Optionally provide codemods for renamed imports/APIs.
- Cut v1 prerelease and collect feedback.

Deliverables:

- `docs/V1_MIGRATION_GUIDE.md`
- v1 beta release checklist

## Non-Negotiable Acceptance Criteria

- README quick start uses only core APIs.
- Top-level exports are reduced and intentional.
- Async and mutation APIs are symmetric and easily teachable.
- Service/runtime errors are explicit and actionable.
- Tests cover lifecycle, cancellation, and migration aliases.

## Risks

- Breaking too much too quickly without migration aids.
- Losing power-user workflows if advanced APIs are hidden poorly.
- Incomplete async model migration causing conceptual split to persist.

## Mitigations

- Ship v1 beta with migration docs before stable.
- Keep a temporary compatibility layer with warnings.
- Validate with real example apps, not only unit tests.

## Immediate Next Steps

1. Draft `docs/V1_API_CONTRACT_DRAFT.md` with explicit keep/remove/rename decisions. (Started)
2. Build TodoMVC v1 prototype constrained to core APIs.
3. Decide async model direction (single vs dual with strict boundary) and lock it.



context: 
Let me dig into the specific design decisions more carefully.

**The Atom/Registry split is an interesting choice.** Most reactive libraries give you a signal that you read and write directly. Here, atoms are inert values and the Registry is the execution context. That's very Effect-flavored — separation of description from execution. But it creates a question: why do I need a Registry in every component? In the Counter example, `registry.get(count)` inside JSX means every component creates its own Registry instance. If two components share an atom, do they share a Registry? The README doesn't clarify whether Registry is a lightweight subscription handle or a heavier coordination point. If it's lightweight, why not make it implicit? If it's heavyweight, why create one per component? There's a tension between the Effect philosophy of "make the context explicit" and the JSX ergonomics of "just read the value."

Then there's `Effect.runSync(Atom.update(count, ...))` alongside `registry.update(count, ...)`. Two ways to write to the same atom, with different execution semantics. The Effect-based path goes through the Effect runtime, the Registry path is synchronous and direct. What happens if both paths race? Is there a consistency guarantee? The README shows both in the same section without addressing this.

**AtomRef occupies an awkward middle ground.** It gives you per-property reactivity on objects, which is useful, but it has a completely different API from Atom. `todo.prop("title").set(...)` is imperative and self-contained — no Registry, no Effect. Compare that to `registry.set(count, 5)` or `Effect.runSync(Atom.set(count, 5))`. That's three different write patterns in the same library. AtomRef feels like it was designed for a different use case (complex form state, nested objects) and bolted on. The question is whether it shares the same reactive graph as Atom, or whether it's a parallel system. If I put an AtomRef-derived value into a `queryEffect` dependency, does it track? The README doesn't say.

**The `useService` design deserves scrutiny.** It's synchronous, which means the runtime must already be built and available when the component runs. That's fine for the happy path — `createMount(layer)` sets it up. But it's ambient and untyped at the call site. If I call `useService(Api)` in a component that was mounted without `Api` in its layer, what happens? Presumably a runtime error. In Effect proper, that missing service is a type error. The library is trading Effect's strongest guarantee for JSX ergonomics. Phase 2 of the enhancement plan tries to recover this with `Component.require`, but it's worth noting this is a fundamental design tension, not just a missing feature.

**The query/mutation naming is overloaded.** Count the async primitives: `atomEffect`, `queryEffect`, `queryEffectStrict`, `defineQuery`, `defineQueryStrict`, `scopedQuery`, `scopedQueryEffect`, `scopedMutation`, `scopedMutationEffect`, `mutationEffect`, `mutationEffectStrict`. That's eleven entry points for "run an Effect and track its result." Each exists for a reason — scoped vs unscoped, strict vs non-strict, convenience vs Effect-first — but the combinatorial explosion suggests the abstraction boundaries aren't quite right. Compare this to something like TanStack Query, which has `useQuery` and `useMutation`, full stop. The underlying issue might be that the library is trying to serve two audiences: people who want simple reactive data fetching, and people who want full Effect fiber control. Maybe those should be two layers with a clear boundary rather than eleven functions at the same import level.

**`defineQuery` vs `queryEffect` — the naming hides an important difference.** `defineQuery` gives you a key and invalidation wiring. `queryEffect` gives you raw reactive Effect execution. But both return what looks like the same thing (an accessor to an `AsyncResult`). The difference in capability is significant — `defineQuery` participates in the cache/invalidation system, `queryEffect` doesn't (or does it?). If I start with `queryEffect` and later need invalidation, do I rewrite to `defineQuery`? That's a migration cost that better naming or a unified API could avoid.

**The `Async` component is doing a lot of work.** It pattern-matches on `AsyncResult`, which has five states: Loading, Refreshing, Success, Failure, Defect. But the component only exposes three slots: `loading`, `success`, `error`. What happens during Refreshing — does it call `loading` or `success` with stale data? What about Defect — does it go to `error`? The five-state model is richer than the three-slot API, which means some states are being collapsed. That's fine, but the user needs to know which states map where, and the README doesn't tell them.

**The dual Result types are a deeper issue than I initially flagged.** `AsyncResult` has Loading/Refreshing/Success/Failure/Defect. `Result` has Initial/Success/Failure with a waiting flag. These represent fundamentally different state machines. `AsyncResult` is fiber-lifecycle-oriented (what is the fiber doing right now?). `Result` is data-oriented (do I have a value, and am I fetching a new one?). The conversion functions `fromAsyncResult`/`toAsyncResult` imply they're interchangeable, but they're not — the mapping is lossy in both directions. `AsyncResult.Refreshing` with a previous success collapses to... what in `Result`? `Success` with `waiting: true`? And `Result.Initial` maps to `AsyncResult.Loading`? These are semantic mismatches that will bite users doing data layer work where both types appear.

**The SSR story raises questions about atom identity.** `Hydration.dehydrate` takes a list of named atom pairs: `[["count", countAtom]]`. That means atom identity across server/client is string-keyed, manually wired. If you forget to register an atom, it silently loses its server state. If you rename a key, hydration silently breaks. This is the kind of thing that works in examples and breaks in production. Compare to frameworks that derive keys from the component tree position — fragile in a different way, but at least automatic. Is there a validation mode that warns about unhydrated atoms?

**`Atom.family` appears in the API table but never in the examples or narrative.** Family patterns (parameterized atoms keyed by some argument) are critical for real apps — think "atom per todo item" or "atom per user ID." The fact that it exists but isn't explained suggests it might be underbaked, or the API might not be settled. This is one of the hardest things to get right in atom-based systems: cache eviction, key stability, and interaction with the garbage collector.

**The reactive core re-exports (`createSignal`, `createEffect`, etc.) are a leaky abstraction.** Even if they're "under the hood," they're exported publicly. Users will discover them, use them, and then hit confusing interactions with the Atom layer. If signals are purely internal plumbing, don't export them. If they're meant to be used, document how they interop with atoms. The current state — exported but unexplained — is the worst of both worlds.

**`batch` appears in both the reactive core and the Atom namespace.** Are these the same function? Does `Atom.batch` batch atom writes, and `batch` (from reactive core) batch signal notifications? If so, do they compose? If I batch atom writes, does that also batch the downstream signal updates that drive DOM? This is the kind of cross-layer interaction that a README should address explicitly.

**One thing the design gets very right: the component model.** Components as plain functions that run once, with reactivity handled by the atom/registry/JSX layer, is the SolidJS model, and it's fundamentally better than React's re-render-everything approach for this kind of framework. It means Effect fibers spawned inside a component are truly spawned once (unless dependencies change), not respawned on every render. That's a huge simplification for the concurrency story and it's the right foundation for everything else the library is trying to do.

**The overall impression** is of a library designed by someone who deeply understands both Effect and fine-grained reactivity, but hasn't yet ruthlessly edited the API surface. The concepts are sound. The implementation architecture (from what the README reveals) is well-considered. But the public API has too many ways to do similar things, some important interactions are underspecified, and the documentation assumes the reader already shares the author's mental model. The strongest move would be to identify the "golden path" — the one way a typical user should build an app — and make that path obvious, with everything else clearly marked as advanced escape hatches.

Here's how I'd tackle each issue.

**Registry: make it implicit in JSX, explicit elsewhere.**

The per-component Registry creation is ceremony that doesn't earn its keep in the common case. Introduce a component-scoped Registry automatically via the JSX compilation, and let users access it when they need direct control.

```tsx
// Today — explicit everywhere
function Counter() {
  const count = Atom.make(0);
  const registry = Registry.make();
  return <p>{registry.get(count)}</p>;
}

// Proposed — implicit in JSX, atoms are directly readable in templates
function Counter() {
  const count = Atom.make(0);
  return <p>{count()}</p>; // JSX compilation wires up subscription automatically
}

// Escape hatch when you need shared or manual registry
function Advanced() {
  const registry = useRegistry(); // get the ambient component registry
  const count = Atom.make(0);
  registry.subscribe(count, (v) => console.log(v));
  return <p>{count()}</p>;
}
```

The compilation plugin already rewrites JSX expressions into reactive accessors. Have it recognize atom reads and insert the registry subscription implicitly — the same way SolidJS signals are auto-tracked without the user calling `createEffect` manually. Keep `Registry.make()` for non-JSX code paths (tests, server logic, standalone scripts) where there's no component context.

**Unify the write paths.**

Three write patterns is two too many for the default experience. Make atoms callable for reads and provide a single `.set`/`.update` for writes. Move the Effect-based helpers to an explicit namespace.

```tsx
// Golden path — direct, synchronous, no ceremony
const count = Atom.make(0);
count.set(5);
count.update(n => n + 1);
const value = count(); // read

// Effect integration path — explicit opt-in
import { Atom } from "effect-atom-jsx/effect";
// These return Effect values, used inside Effect pipelines
Atom.get(count);    // Effect<number>
Atom.set(count, 5); // Effect<void>
```

This way the simple path has one pattern, and Effect integration is clearly a separate layer you reach for when you're composing atoms into Effect pipelines. The Registry path stays available for advanced coordination but isn't the default.

**AtomRef: align the API or separate the concern.**

AtomRef's imperative style (`todo.prop("title").set(...)`) clashes with everything else. Two options — I'd lean toward the first.

Option A: make AtomRef produce regular Atoms. `todo.prop("title")` returns an `Atom` that participates in the normal reactive graph. You read and write it the same way as any other atom. The "ref" part is just the derivation strategy, not a different API surface.

```tsx
const todo = AtomRef.make({ title: "Write docs", done: false });
const title = todo.prop("title"); // returns Atom<string>

title.set("Ship it");  // same write pattern as any atom
<input value={title()} /> // same read pattern
```

Option B: position AtomRef explicitly as a "mutable store for complex objects" with its own section in docs, clearly marked as a different tool for a different job. But then document exactly how it interacts (or doesn't) with the reactive graph, query dependencies, and Registry subscriptions.

**useService: fail loud and early.**

Since `useService` is synchronous and ambient, the failure mode needs to be unambiguous. Don't wait for Phase 2's typed requirements — add a runtime diagnostic now.

```tsx
// In useService implementation
function useService<S>(tag: ServiceTag<S>): S {
  const runtime = getManagedRuntime();
  if (!runtime) {
    throw new Error(
      `useService(${tag.key}) called outside of mount(). ` +
      `Wrap your app with createMount(layer) or mount(fn, el, layer).`
    );
  }
  const service = runtime.tryGet(tag);
  if (!service) {
    throw new Error(
      `Service ${tag.key} not found in current Layer. ` +
      `Available services: ${runtime.listServices().join(", ")}. ` +
      `Add ${tag.key} to your mount layer.`
    );
  }
  return service;
}
```

List the available services in the error message. That single change turns a frustrating debug session into a five-second fix.

**Collapse the async primitive surface.**

Eleven entry points should become three tiers, clearly documented as such.

Tier 1 — the default, covers 90% of use cases:
```tsx
// Query: reactive data fetching with cache/invalidation
const users = defineQuery("users", () => useService(Api).listUsers());

// Mutation: writes with optimistic UI
const save = defineMutation((user: User) => useService(Api).save(user), {
  invalidates: ["users"],
});
```

Tier 2 — advanced, for custom reactive tracking:
```tsx
// When you need raw fiber control or non-service Effects
const time = atomEffect(() =>
  Effect.succeed(new Date()).pipe(Effect.delay("1 second"))
);
```

Tier 3 — escape hatch, for Effect-first composition:
```tsx
// Full scoped constructors, for library authors and complex orchestration
const query = scopedQueryEffect(scope, () => ...);
```

Then rename or deprecate the intermediary variants. `queryEffect` becomes an alias for `defineQuery` without a key (anonymous query). `queryEffectStrict` and `defineQueryStrict` should just be a `strict: true` option, not separate functions. `scopedQuery` and `scopedMutation` are convenience wrappers — keep them but put them in the Tier 3 docs section, not at the top level of the README.

The key naming change: introduce `defineMutation` as the counterpart to `defineQuery`. Right now `mutationEffect` doesn't rhyme with `defineQuery`, which makes the pairing non-obvious.

**Async component: expose all five states, with sensible collapse defaults.**

```tsx
// Full control — all five states
<Async
  result={data()}
  loading={() => <Spinner />}
  refreshing={(previous) => <><Spinner /><StaleView data={previous} /></>}
  success={(value) => <View data={value} />}
  failure={(error) => <ErrorCard error={error} />}
  defect={(cause) => <CrashReport cause={cause} />}
/>

// Minimal — sensible defaults kick in
<Async
  result={data()}
  loading={() => <Spinner />}
  success={(value) => <View data={value} />}
/>
// Refreshing defaults to: call success with stale data (no loading flash)
// Failure defaults to: call error if provided, otherwise throw to nearest boundary
// Defect defaults to: throw to nearest boundary
```

Document the default collapse rules in a small table. The key insight is that `Refreshing` should default to showing stale data via the `success` slot, not flashing a loading state. That's what users almost always want and it's the biggest source of confusion when it's not explicit.

**Unify the Result types or name them differently.**

Having `AsyncResult` and `Result` is confusing because `Result` is a generic programming term. Rename `Result` to something that reflects its actual purpose.

```ts
// Before
import { AsyncResult } from "effect-atom-jsx"; // fiber lifecycle state
import { Result } from "effect-atom-jsx";      // data fetching state

// After
import { AsyncResult } from "effect-atom-jsx";  // fiber lifecycle state
import { FetchState } from "effect-atom-jsx";    // data fetching state (Initial/Success/Failure + waiting)
```

Or, more aggressively: do you actually need both? `AsyncResult` with a `Refreshing(previous)` state already captures "I have data and I'm fetching more." `FetchState.Initial` maps to `AsyncResult.Loading`. The `waiting` flag maps to `Refreshing`. If the only consumer of `Result` is `AtomRpc` and `AtomHttpApi`, consider making those produce `AsyncResult` directly and eliminating the second type entirely. One result type, one set of patterns to learn.

**SSR hydration: add validation and auto-keying.**

For the manual key problem, add a development-mode validation pass:

```ts
// Development mode — warn about mismatches
Hydration.hydrate(registry, window.__STATE__, atoms, {
  onUnknownKey: (key) => console.warn(`Hydration: server sent "${key}" but no atom registered for it`),
  onMissingKey: (key) => console.warn(`Hydration: atom "${key}" registered but not in server state`),
});
```

For auto-keying, consider deriving keys from `Atom.make` call sites if a label is provided:

```ts
const count = Atom.make(0, { key: "count" }); // explicit, stable key
// Hydration can discover all keyed atoms automatically
const atoms = Atom.getKeyedAtoms(); // returns Map<string, Atom>
```

This doesn't solve the problem fully — you still need stable keys — but it removes the error-prone separate registration step.

**Atom.family: document it or remove it from the public API.**

Since it's in the API table, I'd commit to it and document the hard parts explicitly:

```ts
const todoAtom = Atom.family((id: string) => Atom.make<Todo | null>(null));

// Usage
const todo1 = todoAtom("todo-1"); // creates or retrieves
const todo2 = todoAtom("todo-2");

// Critical: cache eviction
todoAtom.evict("todo-1"); // remove from family cache
todoAtom.clear();          // evict all

// Integration with defineQuery
const todoQuery = defineQuery(
  (id: string) => `todo:${id}`, // key factory
  (id: string) => useService(Api).getTodo(id),
);
```

The eviction API is the part most libraries get wrong. Be explicit about it: family entries are cached indefinitely unless you evict them. Provide both `evict(key)` and `clear()`, and mention in docs that `Atom.family` without eviction is a memory leak in long-running apps.

**Hide or namespace the reactive core re-exports.**

```ts
// Remove from top-level exports
// import { createSignal, createEffect } from "effect-atom-jsx"; // no

// If users genuinely need them, put them behind a clear boundary
import { createSignal, createEffect } from "effect-atom-jsx/internals";
// With a doc comment: "These are low-level primitives used by the JSX runtime.
// You probably want Atom and defineQuery instead."
```

If there are legitimate use cases for direct signal access (maybe a library author building a custom integration), keep the exports but under `/internals` or `/runtime`. The top-level export surface should only contain things a typical user needs.

**Clarify batch semantics.**

Merge `Atom.batch` and the reactive core `batch` into one function, or make `Atom.batch` the only public one:

```ts
import { Atom } from "effect-atom-jsx";

// Single batch function that coordinates both atom writes and DOM updates
Atom.batch(() => {
  count.set(5);
  name.set("hello");
  // DOM updates are deferred until the batch completes
});
```

If there's a genuine reason the two batch mechanisms can't be unified (maybe signal batching and atom batching operate at different layers), then at least document that `Atom.batch` is the one users should reach for, and that it implicitly handles signal-level batching internally.

**The "golden path" documentation structure.**

Restructure the README around one clear path, with everything else as clearly-labeled advanced sections:

```
## Quick Start (golden path)
  - Atom.make, read in JSX, set/update directly
  - defineQuery + defineMutation for async
  - createMount(layer) for services
  - Async component for rendering results

## Advanced
  ### Custom Registry usage
  ### AtomRef for complex objects
  ### atomEffect for non-service Effects
  ### Scoped constructors (scopedQueryEffect, etc.)
  ### Stream and PubSub sources
  ### SSR

## Internals (for library authors)
  ### Reactive core (createSignal, etc.)
  ### Custom integrations
```

The current README is structured as a feature catalog. Restructuring it as a graduated learning path would make the API surface feel smaller even if nothing is actually removed.

This changes my read significantly. Seeing the two source inspirations side by side, I can now evaluate how well effect-atom-jsx synthesizes them — and where it diverges from either in ways that might not be intentional.

**What it gets right from @effect-atom/atom:**

The `Atom.make`, `Atom.family`, `Atom.runtime(layer)`, `Atom.fn`, `Atom.pull`, `Atom.searchParam`, `Atom.kvs`, and the `Result` type with its builder pattern — these all clearly descend from effect-atom. The `AtomRpc.Tag` and `AtomHttpApi.Tag` patterns are lifted almost directly. The core mental model of "atoms are descriptions, runtimes provide execution context" is preserved. This is good — effect-atom's API is well-designed for Effect users.

**What it gets right from Solid 2.0:**

The component-runs-once model, `Show`/`For`/`Switch`/`Match` control flow, `Loading`/`Errored` boundaries (matching Solid 2.0's rename from `Suspense`/`ErrorBoundary`), `createOptimistic`, `refresh`, `mergeProps`/`splitProps`, and the dom-expressions JSX compilation. The `Async` component maps to Solid 2.0's pattern of handling async results at the boundary level.

**Where the synthesis breaks down:**

The biggest issue is that effect-atom-jsx hasn't fully committed to either parent's model in several key areas, and the result is a hybrid that's more complex than either source.

**1. Registry vs Solid 2.0's implicit tracking vs effect-atom's hooks.**

In effect-atom, you never manually create a Registry — React hooks (`useAtomValue`, `useAtomSet`) handle subscription. In Solid 2.0, signals are auto-tracked in JSX expressions with no intermediary. effect-atom-jsx introduces `Registry` as an explicit concept that neither parent requires. This is the ceremony I flagged earlier, and now it's clearer why it feels wrong — it's solving a problem that both inspirations already solved through their respective paradigms. The Solid model says "track automatically in JSX expressions." The effect-atom model says "hooks subscribe for you." Requiring manual Registry creation is a regression from both.

The fix I suggested earlier (implicit Registry via JSX compilation, atoms readable as `count()`) is essentially converging toward how Solid 2.0 signals work, which is the right call given dom-expressions is the rendering layer.

**2. The async model is caught between two paradigms.**

Solid 2.0's async story is elegant: any computation can return a Promise, `Loading` handles initial suspension, `isPending` handles stale-while-revalidate, `refresh` handles invalidation. There's no separate "query" concept — async is just a property of computations.

effect-atom's async story is also clean: `Atom.make(Effect.succeed(0))` gives you `Result<number>`, `Atom.runtime(layer)` provides services, and the `Result` builder pattern handles rendering.

effect-atom-jsx has *neither* model. Instead it has `atomEffect`, `queryEffect`, `defineQuery`, and the `AsyncResult` type, which is a five-state machine that doesn't match Solid 2.0's `Loading`/`isPending` split or effect-atom's `Result` with its `waiting` flag. It's a third async model that borrows vocabulary from both but matches neither.

If I were redesigning this, I'd pick one of two paths:

**Path A — Lean into Solid 2.0's model:** Atoms that return Effects or Promises suspend naturally. `Loading` catches initial suspension. `isPending` catches revalidation. No separate `AsyncResult` type — the atom's value is either available or it suspends. This is simpler but means giving up explicit `AsyncResult` pattern matching.

**Path B — Lean into effect-atom's model:** Keep `Result` with its builder pattern, keep `Atom.runtime(layer).atom(effect)` for service-backed atoms. Drop `queryEffect`/`atomEffect`/`defineQuery` in favor of effect-atom's approach where any atom can be effectful. `Loading`/`Errored` components become sugar over `Result.builder(...).render()`.

The current hybrid — Solid 2.0 control flow components wrapping an AsyncResult type that matches neither Solid's suspension model nor effect-atom's Result — is the most complex option.

**3. The mutation story doesn't follow either parent cleanly.**

Solid 2.0 has `action()` with generators — do optimistic write, yield async work, refresh reads. Clean linear flow.

effect-atom has `Atom.fn` for mutations, `runtimeAtom.fn` for service-backed mutations, with `reactivityKeys` for automatic invalidation.

effect-atom-jsx has `mutationEffect` with separate `optimistic`, `rollback`, and `onSuccess` callbacks. Compare:

```ts
// Solid 2.0
const save = action(function* (todo) {
  setOptimisticTodos(s => s.list.push(todo));
  yield api.addTodo(todo);
  refresh(todos);
});

// effect-atom
const save = runtimeAtom.fn(
  Effect.fnUntraced(function* (todo) {
    const client = yield* Api;
    yield* client.addTodo(todo);
  }),
  { reactivityKeys: ["todos"] }
);

// effect-atom-jsx
const save = mutationEffect(
  (todo) => useService(Api).addTodo(todo),
  {
    optimistic: (todo) => optimistic.set(todo),
    rollback: () => optimistic.clear(),
    onSuccess: (todo) => { optimistic.clear(); registry.set(saved, todo); },
  },
);
```

The effect-atom-jsx version is the most verbose and the most fragmented — optimistic logic, rollback logic, and success logic are separate callbacks rather than a linear flow. Solid 2.0's generator model is more readable. effect-atom's `reactivityKeys` approach is more declarative. The current design takes the worst of both worlds: manual invalidation *and* verbose callback separation.

I'd suggest adopting something closer to Solid 2.0's linear mutation flow but using Effect generators instead of JS generators:

```ts
const save = defineMutation(
  Effect.fn(function* (todo: Todo) {
    optimistic.set(todo);
    yield* useService(Api).addTodo(todo);
    refresh(todosQuery);
  }),
  { rollback: () => optimistic.clear() }
);
```

Rollback stays as an option because Effect's structured error handling makes it natural, but the happy path is linear.

**4. `Atom.runtime` vs `createMount` / `useService`.**

effect-atom's pattern is `Atom.runtime(layer)` which gives you `runtimeAtom.atom(...)`, `runtimeAtom.fn(...)`, `runtimeAtom.pull(...)`. The runtime is scoped to the atoms it creates.

effect-atom-jsx's pattern is `createMount(layer)` which sets up an ambient runtime, and `useService(Tag)` which reads from it. This is the Solid/React context pattern — ambient, implicit.

The problem is that effect-atom's approach is more compositional. You can have multiple runtimes for different service sets. `runtimeAtom.atom(...)` makes it obvious which runtime backs which atom. The ambient `useService` approach loses that — all atoms implicitly share one runtime, and composing multiple service scopes requires `WithLayer` boundaries.

I'd consider bringing back `Atom.runtime(layer)` from effect-atom as the primary pattern and making `createMount`/`useService` sugar for the common "one global runtime" case:

```ts
// Primary: explicit runtime binding (from effect-atom)
const apiRuntime = Atom.runtime(ApiLive);
const users = apiRuntime.query(() => Effect.gen(function* () {
  const api = yield* Api;
  return yield* api.listUsers();
}));

// Sugar: ambient runtime (current approach, for simple apps)
const mount = createMount(ApiLive);
// useService works inside mounted tree
```

**5. Missing from effect-atom-jsx that both parents have:**

From effect-atom: `Atom.make((get) => get(other) * 2)` — the getter-based derived atom where `get` automatically tracks dependencies. This is arguably the most elegant part of effect-atom's API. effect-atom-jsx has `Atom.map` but not the general `get`-based derivation.

From Solid 2.0: `isPending(() => expr)` — expression-level pending detection. effect-atom-jsx has `Loading` but not the fine-grained "is this specific expression pending" check that's separate from boundary suspension.

From Solid 2.0: microtask batching with `flush()`. The plan mentions `batch` but doesn't clarify if it follows Solid 2.0's microtask model or Solid 1.x's synchronous model.

From effect-atom: `Atom.withReactivity` and the `Reactivity` integration from `@effect/experimental`. This is a much cleaner invalidation model than manually wiring `invalidates` arrays.

**6. What effect-atom-jsx adds that neither parent has (and whether it should):**

`AtomRef` with `.prop()` and `.collection()` — neither effect-atom nor Solid 2.0 has this. Solid 2.0 uses stores with draft-first setters for the same use case. effect-atom uses atoms for individual pieces of state. AtomRef is a third approach that doesn't align with either parent. I'd drop it in favor of either Solid 2.0-style stores or nested atoms.

`AtomSchema` for form validation — this is genuinely novel and useful. Neither parent has schema-driven reactive validation. Worth keeping and polishing.

`AtomLogger` — effect-atom has this implicitly through Effect's tracing. Making it explicit as a debugging tool is fine, but it should be a thin wrapper over Effect's own logging/tracing, not a parallel system.

**The synthesis I'd aim for:**

Take effect-atom's atom model (including `Atom.make(get => ...)`, `Atom.runtime(layer)`, `Atom.family`, `Result`, `AtomRpc.Tag`) as the state layer. Take Solid 2.0's rendering model (auto-tracking in JSX, `Loading`/`isPending`/`Errored`, `action`/`refresh`/`createOptimistic`, microtask batching) as the UI layer. The bridge between them should be as thin as possible — atoms are readable in JSX expressions, atom writes trigger reactive updates, Effect-backed atoms participate in `Loading` suspension.

That gives you one state model (effect-atom), one rendering model (Solid 2.0), and a thin integration layer. What you have now is three models — effect-atom's, Solid 2.0's, and a hybrid that doesn't quite match either.

Here's how I'd address each issue, working from the foundation up.

**1. Kill Registry as a user-facing concept.**

The goal is atoms that auto-track in JSX like Solid 2.0 signals, while preserving effect-atom's `get`-based derivation for non-JSX code.

```tsx
// Atom.make returns a callable atom — call it to read, methods to write
const count = Atom.make(0);

// In JSX: auto-tracked, no registry needed
function Counter() {
  return <p>{count()}</p>;
}

// Derived atoms use get-based tracking (from effect-atom)
const doubled = Atom.make((get) => get(count) * 2);

// Writes are methods on the atom
count.set(5);
count.update(n => n + 1);
```

Internally, the JSX compilation already wraps expressions in reactive computations. Make the atom callable — `count()` — and have it register with the nearest reactive scope automatically. This is exactly what Solid 2.0 signals do, and exactly what effect-atom's `useAtomValue` does under the hood in React.

For the cases where you genuinely need a standalone subscription context outside JSX (tests, server logic, standalone scripts), keep Registry but push it to an explicit import:

```ts
import { Registry } from "effect-atom-jsx/Registry";

const reg = Registry.make();
reg.subscribe(count, (v) => console.log(v));
```

The migration: `registry.get(count)` in JSX becomes `count()`. `registry.set(count, x)` becomes `count.set(x)`. `registry.update(count, fn)` becomes `count.update(fn)`. The old pattern keeps working but docs point to the new one.

**2. Adopt effect-atom's `Atom.runtime(layer)` as primary, keep `createMount` as sugar.**

The ambient `useService` pattern loses composability. Bring back explicit runtime binding from effect-atom, where the runtime is associated with the atoms it creates:

```tsx
// Define a runtime from a layer — this is the primary pattern
const apiRuntime = Atom.runtime(ApiLive);

// Create service-backed atoms through the runtime
const users = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  })
);

// Create service-backed mutations through the runtime
const saveUser = apiRuntime.fn(
  Effect.fn(function* (user: User) {
    const api = yield* Api;
    yield* api.save(user);
  })
);

// Atoms are usable in JSX directly — runtime is already bound
function UserList() {
  return (
    <Loading fallback={<Spinner />}>
      <For each={users()}>{(u) => <li>{u().name}</li>}</For>
    </Loading>
  );
}

// Mount still provides the runtime to the component tree for scope/cleanup
const mount = createMount(ApiLive);
mount(() => <App />, document.getElementById("root")!);
```

The key difference: `apiRuntime.atom(...)` makes it explicit which layer backs which atom. You can have multiple runtimes for different service sets without `WithLayer` boundaries:

```tsx
const apiRuntime = Atom.runtime(ApiLive);
const analyticsRuntime = Atom.runtime(AnalyticsLive);

const users = apiRuntime.atom(/* ... */);
const events = analyticsRuntime.atom(/* ... */);
```

Keep `useService` as an escape hatch for the rare case where you need to access a service imperatively inside a component body, but make it clearly secondary in docs.

**3. Align the async model with Solid 2.0's Loading/isPending split.**

Drop `AsyncResult` as the user-facing type. Instead, adopt Solid 2.0's model where async atoms suspend naturally and boundaries handle the UI:

```tsx
// Async atom — returns Effect, suspends until resolved
const users = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  })
);

// Loading handles initial suspension (Solid 2.0 pattern)
<Loading fallback={<Spinner />}>
  <UserList />
</Loading>

// isPending handles stale-while-revalidate (Solid 2.0 pattern)
const refreshing = () => isPending(() => users());

<Show when={refreshing()}>
  <RefreshIndicator />
</Show>
```

For cases where you need explicit pattern matching (error handling, defect handling), keep effect-atom's `Result` type and builder as an opt-in:

```tsx
// When you need explicit result access instead of suspension
const users = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  }),
  { suspend: false } // opt out of suspension, get Result instead
);

// Use effect-atom's Result builder
function UserList() {
  return Result.builder(users())
    .onInitial(() => <Spinner />)
    .onFailure((cause) => <ErrorCard cause={cause} />)
    .onSuccess((data, { waiting }) => (
      <>
        {waiting && <RefreshIndicator />}
        <For each={data}>{(u) => <li>{u().name}</li>}</For>
      </>
    ))
    .render();
}
```

This gives you two clean paths: the Solid 2.0 suspension path (default, simpler) and the effect-atom explicit Result path (opt-in, more control). No `AsyncResult` hybrid.

The `Async`, `Errored`, and `Loading` components all still work — `Loading` and `Errored` are boundary-based (Solid 2.0 style), and if someone wants the explicit component approach, `Result.builder` covers it.

**4. Linearize mutations with Effect generators.**

Replace the fragmented callback API with Solid 2.0's linear flow, using Effect generators instead of JS generators:

```tsx
// Solid 2.0's action model, but with Effect
const addTodo = apiRuntime.action(
  Effect.fn(function* (todo: Todo) {
    // Optimistic update (immediate)
    setOptimisticTodos((s) => { s.list.push(todo); });

    // Async work (fiber-backed, interruptible)
    const api = yield* Api;
    yield* api.addTodo(todo);

    // Refresh derived reads (Solid 2.0 pattern)
    refresh(todos);
  })
);
```

Rollback happens automatically via Effect's error model — if the yield fails, the optimistic write is reverted because the action runs inside a transition (matching Solid 2.0's `action()` semantics):

```tsx
// Explicit rollback for cases where auto-revert isn't enough
const addTodo = apiRuntime.action(
  Effect.fn(function* (todo: Todo) {
    setOptimisticTodos((s) => { s.list.push(todo); });
    yield* api.addTodo(todo);
    refresh(todos);
  }),
  {
    onError: () => {
      // custom error handling beyond auto-revert
      notifications.show("Failed to add todo");
    }
  }
);
```

For effect-atom's `reactivityKeys` pattern (declarative invalidation), support it as an alternative to manual `refresh`:

```tsx
const addTodo = apiRuntime.action(
  Effect.fn(function* (todo: Todo) {
    const api = yield* Api;
    yield* api.addTodo(todo);
  }),
  { reactivityKeys: ["todos"] } // auto-refresh anything tagged with "todos"
);
```

This gives users two invalidation styles: imperative `refresh(atom)` (Solid 2.0) and declarative `reactivityKeys` (effect-atom). Both are clean, both compose.

**5. Collapse the async primitive surface to three things.**

Replace the eleven entry points with three that map to clear use cases:

```tsx
// 1. apiRuntime.atom — read data (replaces queryEffect, defineQuery, etc.)
const users = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  }),
  {
    key: "users",           // enables cache/dedup (optional)
    staleTime: "30 seconds", // serve stale, revalidate in background (optional)
    concurrency: "switch",   // switch/queue/drop (optional, default: switch)
  }
);

// 2. apiRuntime.action — write data (replaces mutationEffect, defineMutation, etc.)
const saveUser = apiRuntime.action(
  Effect.fn(function* (user: User) {
    const api = yield* Api;
    yield* api.save(user);
    refresh(users);
  })
);

// 3. Atom.effect — standalone effect, no runtime needed (replaces atomEffect)
const clock = Atom.effect(() =>
  Effect.succeed(new Date()).pipe(Effect.delay("1 second"))
);
```

That's it. Three primitives, three clear names, three distinct use cases. The `scoped*` variants become internal implementation details. The `*Strict` variants become an option flag: `{ strict: true }`.

For the RPC integration, keep effect-atom's pattern exactly:

```tsx
class CountClient extends AtomRpc.Tag<CountClient>()("CountClient", {
  group: Rpcs,
  protocol: protocolLayer,
}) {}

// CountClient.query and CountClient.mutation already return atoms/actions
// No need for a separate defineQuery/defineMutation layer
const count = CountClient.query("count", void 0, {
  reactivityKeys: ["count"],
});

const increment = CountClient.mutation("increment");
```

This is already clean in effect-atom. Don't reinvent it.

**6. Drop AtomRef, adopt Solid 2.0 stores for complex objects.**

AtomRef doesn't match either parent's model. Solid 2.0's stores with draft-first setters are a better fit for complex object state in a dom-expressions environment:

```tsx
import { createStore, snapshot } from "effect-atom-jsx";

// Complex object state — use a store (Solid 2.0 pattern)
const [todos, setTodos] = createStore({ list: [], filter: "all" });

// Draft-first mutation
setTodos((s) => {
  s.list.push({ id: 3, text: "Deploy", done: false });
});

// Per-property reactivity is automatic (Solid 2.0 store semantics)
<For each={todos.list}>{(todo) => <li>{todo().text}</li>}</For>

// When you need a plain value
const plain = snapshot(todos);
```

For the case where you need a single reactive reference to an object field that also participates in the atom graph, use a derived atom:

```tsx
const settings = createStore({ theme: "dark", lang: "en" });

// Derived atom from store property — bridges store and atom worlds
const theme = Atom.make(() => settings.theme);
```

**7. Bring in Solid 2.0's `isPending` and `latest`.**

These are missing and they complete the async UI story:

```tsx
// isPending — expression-level pending detection
const refreshing = () => isPending(() => users());

// latest — peek at in-flight values during transitions
const latestSearch = () => latest(searchQuery);
```

These should be direct ports of Solid 2.0's implementations, wired into the atom reactivity layer.

**8. Bring in effect-atom's `withReactivity` from @effect/experimental.**

This is a cleaner invalidation model than manual key wiring:

```tsx
const todos = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listAll();
  })
).pipe(
  Atom.withReactivity(["todos"]) // refresh when "todos" key is invalidated
);

const addTodo = apiRuntime.action(
  Effect.fn(function* (todo: Todo) {
    const api = yield* Api;
    yield* api.add(todo);
    yield* Reactivity.invalidate(["todos"]); // triggers refresh on all "todos"-keyed atoms
  })
);
```

This replaces the manual `invalidates: [query.key]` wiring in `mutationEffect` with a decoupled pub/sub invalidation model. Mutations don't need to know which queries to refresh — they invalidate a key, and any atom watching that key refreshes.

**9. Adopt Solid 2.0's microtask batching with `flush`.**

Replace `batch` with Solid 2.0's model:

```tsx
count.set(5);
name.set("hello");
// DOM hasn't updated yet — writes are batched to next microtask

flush(); // force synchronous application when needed
// DOM is now updated
```

`Atom.batch` goes away. Writes are always microtask-batched. `flush()` is the escape hatch for imperative DOM work.

**10. Hide the reactive core, expose Solid 2.0's split effects if needed.**

Stop exporting `createSignal`, `createEffect`, `createMemo` from the top level. If users need Solid 2.0 primitives for advanced DOM work, expose them under a subpath:

```tsx
// Top-level: atoms only
import { Atom, createStore, Loading, isPending } from "effect-atom-jsx";

// Advanced: Solid 2.0 primitives for custom integrations
import { createEffect, createMemo, onSettled } from "effect-atom-jsx/solid";
```

If you expose `createEffect`, adopt Solid 2.0's split form:

```tsx
import { createEffect } from "effect-atom-jsx/solid";

createEffect(
  () => count(),           // compute: track dependencies
  (value) => {             // apply: side effects
    document.title = `Count: ${value}`;
    return () => { /* cleanup */ };
  }
);
```

**11. Keep and polish what's unique: AtomSchema.**

AtomSchema is genuinely novel and doesn't need to change much. The one improvement: make it work with the new callable atom pattern:

```tsx
const ageField = AtomSchema.make(Schema.Int, 25);

// Reads are callable
ageField.value();   // Option<number>
ageField.error();   // Option<SchemaError>
ageField.isValid(); // boolean
ageField.touched(); // boolean
ageField.dirty();   // boolean

// Write through input
ageField.input.set("1.5");
ageField.isValid(); // false

// Reset
ageField.reset();
```

**12. Restructure exports around the golden path.**

```tsx
// Golden path — everything most users need
import {
  Atom,              // state
  createStore,       // complex object state
  Loading,           // initial async boundary
  Errored,           // error boundary
  isPending,         // stale-while-revalidate
  refresh,           // explicit invalidation
  Show, For, Switch, Match, // control flow
} from "effect-atom-jsx";

// Effect integration
import { AtomRpc, AtomHttpApi, AtomSchema } from "effect-atom-jsx";

// Advanced / library authors
import { Registry } from "effect-atom-jsx/Registry";
import { createEffect, createMemo, onSettled } from "effect-atom-jsx/solid";
import { Result } from "effect-atom-jsx/Result";
```

**Summary of what changes:**

The state layer becomes effect-atom's model: `Atom.make`, `Atom.runtime(layer)`, `Atom.family`, `Atom.fn`, `Atom.withReactivity`. The rendering layer becomes Solid 2.0's model: auto-tracking in JSX, `Loading`/`Errored` boundaries, `isPending`/`latest`, `createStore` with draft setters, `flush`, split effects. The bridge is thin: atoms are callable, calls auto-track in JSX, Effect-backed atoms participate in `Loading` suspension.

What gets removed: Registry as a user-facing default, AtomRef, `AsyncResult`, the eleven async primitives (replaced by three), the `batch` function, top-level signal/effect/memo exports. What gets added: callable atoms, `isPending`, `latest`, `flush`, `Atom.withReactivity`, `apiRuntime.action` with linear flow. What stays: `AtomSchema`, `AtomRpc.Tag`, `AtomHttpApi.Tag`, `AtomLogger`, SSR hydration, `Atom.family`, `Atom.fromStream`/`fromQueue`.
