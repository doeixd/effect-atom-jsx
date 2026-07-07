# Design Improvement Suggestions

Date: 2026-03-12
Status: Draft — open for discussion

This document collects design-level feedback and concrete improvement proposals. It is not a roadmap; it is a record of observed friction points and their proposed resolutions, ordered roughly by impact on day-to-day developer experience.

Already-tracked work is excluded: `FetchResult`→`Result` consolidation (ADR-002, accepted), export tier split (ADR-004, proposed).

---

## 1. Eliminate the `Atom.make(fn)` Overload Ambiguity

**Problem.** `Atom.make` has two completely different behaviors depending on argument type:

```ts
Atom.make(0)           // writable atom, initial value 0
Atom.make(() => 0)     // derived atom — the function IS the getter
Atom.value(() => 0)    // writable atom storing the function as data
```

A developer who wants to store a callback in an atom writes `Atom.make(myFn)` and silently gets a derived atom instead. The derived atom calls `myFn` on every read and tracks its dependencies. The error is invisible until behavior is wrong.

The overload is justified by ergonomics — you don't need a separate call for simple derived atoms. But the cost is a silent, type-correct footgun that affects every new user.

**Proposal.** Split the single overloaded constructor into unambiguous forms and keep `Atom.make` only for the non-function case:

```ts
Atom.make(0)           // writable — value is never a function
Atom.make({ ... })     // writable — objects fine too
Atom.derived(get => get(other) * 2)  // explicitly derived
Atom.value(myFn)       // explicitly stores a function as data (unchanged)
```

`Atom.make(fn)` as a derived shorthand would be deprecated. `Atom.derived` already exists as the unambiguous form — it just needs to be the primary teaching path.

**Tradeoff.** Breaking change for anyone using `Atom.make(fn)` as a derived getter, which is common. The migration is mechanical (`Atom.make(fn)` → `Atom.derived(fn)`) but requires a codemod. The payoff is that new users are never surprised.

---

## 2. Commit to One Routing Authoring Style

**Problem.** Two routing styles exist — component-first and node-first — with overlapping but unequal behavior:

- Node-first provides stronger TypeScript inference for loader data, params, and route head callbacks.
- Component-first works for most cases but has documented inference limits (title/meta callbacks, some transform chains).
- The same helper names mean different things in each style (`Route.title` on a node vs `Route.titleFor` for a component).
- Wrapper transforms like `Component.withLoading` needed explicit work to preserve route metadata; future transforms will need the same treatment ongoing.

The result is that every routing question has two possible answers, and the "which style should I use" decision is unclear. The docs acknowledge the tension but don't resolve it.

**Proposal: Unified `Route(component)` model — see ADR-006.**

The right solution is deeper than picking one of the two existing styles. Both styles are awkward because they treat "the component" and "the route node" as separate things that reference each other. The cleaner model is: a route *is* a component with routing context provided.

```ts
// One way to define a route, regardless of complexity
const UserRoute = Route(UserPage)
  .pipe(Route.path("/users/:id"))
  .pipe(Route.paramsSchema(ParamsSchema))
  .pipe(Route.loader(({ id }) => api.getUser(id)))
  .pipe(Route.title(({ loaderData }) => loaderData.name))
```

`Route(component)` is a typed wrapper that accumulates params/query/loaderData types through the pipe chain, then provides `Route.Context` to the component as an Effect service. The component declares `Component.require(Route.Context)` if it needs params or loader data; if it doesn't, it's routing-agnostic.

This eliminates the dual-system entirely — no `Route.componentOf`, no `Component.route` vs `Route.page` split, no inference asymmetry. Type inference is strong everywhere because it's one code path.

Full design: `docs/adr/ADR-006-unified-route-model.md`

**Tradeoff.** Non-trivial implementation change. Migration from current node-first and component-first styles is mechanical and aliasable, but the internal route representation changes significantly. Depends on ADR-002 (Result consolidation) settling first since loader data types flow through Result.

---

## 3. Warn on Silent Single-Flight Fallback

**Problem.** When a single-flight mutation fires and the mutation emits no reactivity invalidation keys, the system silently falls back to running *all* matched loaders. This is the safe default, but "did I accidentally run all loaders?" is invisible in production.

It can happen for legitimate reasons (mutation uses a direct API call that doesn't touch any tracked atoms) or by mistake (forgot to emit invalidation keys, or emitting them at the wrong scope).

**Proposal.** In development mode, emit a console warning when the fallback triggers:

```
[effect-atom-jsx] Single-flight action "saveUser" emitted no reactivity keys.
Falling back to revalidating all matched loaders at "/users/123".
To suppress: add `reactivityKeys` to the action or emit keys inside the mutation Effect.
To silence this warning: set `revalidate: "all"` on the singleFlight options explicitly.
```

The `revalidate: "all"` explicit option already exists to opt into "run all loaders" intentionally. Making the fallback visible in dev disambiguates intent from accident.

**Tradeoff.** Adds a development-mode side effect. The warning could be noisy during early wiring when keys aren't set up yet — a `revalidate: "all"` escape hatch would silence it while you iterate.

---

## 4. Test Isolation for `Atom.runtime.addGlobalLayer`

**Problem.** `Atom.runtime.addGlobalLayer(layer)` mutates a module-level array. Any `Atom.runtime(layer)` call made after it — in the same process, including in tests — picks up the global layers. If a module calls `addGlobalLayer` as a side effect at import time, test isolation breaks silently.

`Atom.runtime.clearGlobalLayers()` exists but requires callers to know they need it. Test suites that don't know about a module's bootstrap side effects will see contaminated runtimes.

**Proposal A (API-level): Scoped factory.**

Add `Atom.runtime.factory(globalLayer)` that returns a `makeRuntime` function with its own isolated global layer list:

```ts
// app/runtime.ts
export const makeRuntime = Atom.runtime.factory(
  Layer.mergeAll(OtelTracingLive, StructuredLogLive)
);

// everywhere else
const rt = makeRuntime(ApiLive);  // picks up the factory's globals, not the module global
```

The module-level global remains for convenience but isn't the only path.

**Proposal B (documentation-level): Enforce isolation in test setup.**

Document that any test file using `Atom.runtime` must call `afterEach(() => Atom.runtime.clearGlobalLayers())` and explain why. Add a note in `docs/TESTING.md`.

**Tradeoff.** Proposal A is a larger API change but eliminates the problem structurally. Proposal B is a documentation fix that relies on all test authors knowing the rule. B is the right thing to do regardless of A.

---

## 5. Make `AtomRef` First-Class or Consolidate It

**Problem.** `AtomRef` provides per-property reactive subscriptions on a shared object. The API works, but it's not an `Atom` type directly — `AtomRef.toAtom(ref)` is required to use it with atom combinators (`Atom.map`, `Atom.withFallback`, derived atoms, etc.). This is friction every time you need to bridge the two systems.

Meanwhile, `Atom.projection` handles object mutation, and `Atom.family` handles keyed atom instances. The incremental value of `AtomRef` over these is ergonomic (`ref.prop("name")` vs `todoById("name")`), not structural.

**Proposal A: Make `AtomRef` implement the `Atom` interface.**

An `AtomRef<A>` becomes an `Atom.Writable<A, A>` directly. `ref.prop(key)` returns a `Writable<A[K], A[K]>`. No `toAtom` conversion needed. All atom combinators just work.

**Proposal B: Consolidate into `Atom.projection`.**

If `AtomRef` is primarily about ergonomic object mutation, `Atom.projection` can absorb it with a `prop(key)` accessor:

```ts
const user = Atom.projection<User>((draft) => { draft.name = "Alice" }, initialUser);
const name = user.prop("name");  // derived writable focused on one property
```

**Proposal C: Keep as-is but document the boundary clearly.**

If `AtomRef` has a distinct runtime implementation (property-level subscriptions without whole-object diffing), document that performance characteristic explicitly so users know when to reach for it.

**Tradeoff.** The right answer depends on whether `AtomRef` has a meaningfully different runtime behavior from projection + derived atoms. If it does, Proposal C (document the boundary) is the right path. If it doesn't, consolidation reduces the conceptual surface.

---

## 6. Clarify `Atom.projection`'s Dual Mutation API

**Problem.** `Atom.projection(derive, initial)` accepts two completely different usage patterns in the same `derive` callback:

```ts
// Pattern A: mutate the draft (Immer-style)
const selected = Atom.projection((draft: Record<string, boolean>) => {
  draft["a"] = true;
}, {});

// Pattern B: return a new value (functional)
const selected = Atom.projection((_draft: Record<string, boolean>) => {
  return { a: true };
}, {});
```

Both work, but the behavior is implicit — if you return `undefined` (e.g., because you forgot to return), you get the draft-mutated result. If you return a value, mutation is ignored. This is the classic Immer pattern, but in an Effect context where side effects are usually explicit, it's surprising.

New users don't know which pattern to use and may accidentally mix them.

**Proposal.** Split into two explicit constructors:

```ts
Atom.projection(initial, deriveFn)    // functional: derive callback returns new value
Atom.draftProjection(initial, mutateFn)  // immer-style: callback mutates draft
```

Or accept both but document the detection rule prominently:
> "If the callback returns a non-undefined value, that value is used as the next state and draft mutations are ignored. If the callback returns `undefined`, the mutated draft is used."

**Tradeoff.** A split API is a breaking change if existing code uses the implicit detection. Documentation is the minimal fix but leaves the dual behavior undocumented at the call site.

---

## 7. Ergonomic Escape Hatch for `BridgeError`

**Problem.** When you compose a `QueryRef` or `Atom<Result<A, E>>` into an Effect pipeline using `.effect()`, you get `Effect<A, E | BridgeError>`. `BridgeError` is `ResultLoadingError | ResultDefectError` — you have to handle both or the error type stays in the channel.

The common case is: "if the query is still loading or has a defect, I want a fallback value." There's no single-call way to express this:

```ts
// Current: verbose handling to extract a value with fallback
const value = yield* query.effect().pipe(
  Effect.catchTag("ResultLoadingError", () => Effect.succeed(fallback)),
  Effect.catchTag("ResultDefectError", () => Effect.succeed(fallback)),
);
```

**Proposal.** Add `query.effectOrElse(fallback)` that handles both `BridgeError` variants with a single fallback:

```ts
const value = yield* query.effectOrElse(fallback);
// Effect<A, E> — BridgeErrors are handled, typed errors remain
```

And at the atom level, `Atom.resultOrElse(atom, fallback)` → `Effect<A, E>`.

This covers ~80% of practical use without losing typed error handling — `E` still flows through.

**Tradeoff.** Small API addition. The footprint is minimal: two overloads, one on `QueryRef`, one as a static `Atom` helper. The risk is encouraging users to ignore `BridgeError` when they should handle it — mitigate with docs that explain when `effectOrElse` is appropriate vs explicit handling.

---

## 8. Promote `Component.from` as the Entry Point for Simple Components

**Problem.** New users encounter `Component.make` first, which requires four arguments and 10+ lines for a trivial counter. The full form is the right API for components that need services, queries, or scoped cleanup — but it's excessive for simple components.

`Component.from(fn)` exists as a lighter shorthand. It takes a plain function component. But it's listed last in the Component section and has no explicit "start here" positioning.

**Proposal.** Reorder the Component docs section to lead with `Component.from` for the simple case, then introduce `Component.make` when you need the setup phase:

```ts
// Start here for most components
const Counter = Component.from<{ start: number }>(({ start }) => {
  const count = Atom.make(start);
  return <button onClick={() => count.update(n => n + 1)}>{count()}</button>;
});

// Upgrade to Component.make when you need services, queries, or async setup
const UserCard = Component.make(
  Component.props<{ id: string }>(),
  Component.require(UserApi),
  ({ id }) => Effect.gen(function* () {
    const api = yield* UserApi;
    const user = yield* Component.query(api.getUser(id));
    return { user };
  }),
  (_, { user }) => <div>{...}</div>,
);
```

This is a docs change, not an API change. The progression "simple function → full Effect component" matches how developers actually build things.

**Tradeoff.** None. Pure documentation reorganization.

---

## 9. Expand `TestHarness` for Async Testing

**Problem.** `TestHarness` wraps a runtime and reactive scope, but provides no help for the most common testing challenge: waiting for async atoms to settle and asserting on reactive state changes.

```ts
harness.run(() => {
  const user = runtime.atom(fetchUser("1"));
  // user() is Loading — how do I wait for it to settle?
  // No built-in way
});
```

**Proposal.** Expand `TestHarness` with:

```ts
// Wait for a Result atom to leave Loading state
await harness.waitForSettled(user);
expect(user()).toMatchObject(Result.success({ id: "1" }));

// When using Reactivity.test: what was invalidated?
harness.flushReactivity();
expect(harness.lastInvalidated).toContain("user:1");

// Step through time for polling/retry tests
await harness.advanceTime(Duration.seconds(30));
```

These three capabilities cover: async data loading tests, cache invalidation tests, and schedule/retry tests. All three currently require manual Effect runtime manipulation.

**Tradeoff.** Adds API surface to the testing module. The `waitForSettled` and `lastInvalidated` helpers are straightforward; `advanceTime` requires TestClock integration and is more involved. Could be added incrementally.

---

## Summary Table

| # | Suggestion | Impact | Effort | Breaking? |
|---|-----------|--------|--------|-----------|
| 1 | `Atom.make(fn)` ambiguity | High | Medium | Yes — codemod needed |
| 2 | Commit to one routing style | High | High | Depends on option |
| 3 | Single-flight silent fallback warning | Medium | Low | No |
| 4 | `addGlobalLayer` test isolation | Medium | Low (docs) / Medium (API) | No |
| 5 | `AtomRef` first-class or consolidate | Medium | Medium | Depends on option |
| 6 | `Atom.projection` dual API | Low | Low (docs) / Medium (split) | Depends on option |
| 7 | `BridgeError` ergonomic escape | Medium | Low | No |
| 8 | `Component.from` docs promotion | High | Low | No |
| 9 | `TestHarness` async expansion | Medium | Medium | No |
