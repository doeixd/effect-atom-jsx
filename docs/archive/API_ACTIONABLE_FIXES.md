# API.md - Actionable Fixes with Exact Changes

This document provides exact line numbers and code changes needed to fix all identified issues.

---

## 🔴 CRITICAL FIX #1: Remove Non-Existent `Atom.fromResource`

**Issue:** Lines 409-411 document an API that doesn't exist

**Current code (lines 409-411):**
```markdown
- **`Atom.fromResource(fn)`** — Create an atom backed by `defineQuery` semantics using ambient runtime from `mount()`.
- **`Atom.fromResource(runtime, fn)`** — Explicit-runtime variant for non-mounted usage.
- **`Atom.fromResource(...)`** — Alias of `Atom.query(...)`.
```

**Action:** DELETE lines 409-411 entirely

**Reason:**
- `Atom.fromResource` doesn't exist as an export in src/Atom.ts
- The functionality is already documented as `Atom.query()` on lines 2027-2043 of src/Atom.ts
- The query function already appears on line 335 of API.md

**Verification:**
```bash
$ grep -r "fromResource" src/
# (no output - doesn't exist)

$ grep "export.*query" src/Atom.ts | head -5
export function query<A, E, R>(
export function query<A, E, R>(
export function query<A, E, R>(
# (exists with 3 overloads)
```

**Impact:** Eliminates a broken API documentation that causes TypeError at runtime

---

## 🔴 CRITICAL FIX #2: Add Async API Comparison Table

**Issue:** Three async APIs (`atomEffect`, `Atom.effect`, `Atom.query`) are confusing

**Location:** Add after line 690 in the "Async Data" section

**Current state:**
```markdown
- **`atomEffect(fn, runtime?)`** — Create a reactive async computation. Tracks signal dependencies, interrupts previous fiber on re-run.
- **`defineQuery(fn, options?)`** — Ergonomic keyed query bundle returning `{ key, result, pending, latest, effect, invalidate, refresh }`.
```

**Add this comparison table after line 690:**

```markdown
### Async Primitives Comparison

| API | Returns | Runtime | Dependencies | Import | Use Case |
|-----|---------|---------|--------------|--------|----------|
| **`atomEffect(fn, runtime?)`** | `Signal<Result<A, E>>` | Optional | Signal reads | main | Low-level reactive effect |
| **`Atom.effect(fn)`** | `Atom<Result<A, E>>` | No | None | main | Simple async atoms |
| **`Atom.query(fn, runtime?)`** | `Atom<Result<A, E>>` | Optional | Effect services | main | Service-based queries |
| **`defineQuery(fn, options?)`** | `QueryRef<A, E>` | Optional | High-level | main | Keyed queries with control |

**Choose based on:**
- Use `Atom.effect()` for pure async functions with no external dependencies
- Use `Atom.query()` or `defineQuery()` for Effects that require services from a Layer
- Use `atomEffect()` only when you need direct Signal access in a Computation context
- Use `defineQuery()` when you need invalidation keys and observability hooks

**Example:**
```typescript
// Simple function: use Atom.effect
const posts = Atom.effect(() => fetch('/posts').then(r => r.json()));

// Needs a service: use Atom.query
const user = Atom.query((get) => Effect.service(UserApi).pipe(
  Effect.flatMap((api) => api.getUser("123"))
));

// Keyed, with observability: use defineQuery
const posts = defineQuery(() => fetch('/posts').then(r => r.json()), {
  name: "fetchPosts",
  onTransition: ({ phase }) => console.log("Phase:", phase),
});
```
```

**Verification:** Check that all three APIs exist and are exported:
```bash
$ grep "export.*atomEffect\|export.*Atom.effect\|export.*Atom.query" src/*.ts | head -10
# Should show all three are exported
```

---

## 🟠 HIGH FIX #1: Document Missing Reactivity APIs

**Issue:** `Reactivity.tracked()` and `Reactivity.invalidating()` are exported but not documented

**Location:** API.md lines 287-303 (Reactivity section)

**Current state:**
```markdown
## Reactivity (`src/Reactivity.ts`)

Library-owned reactivity service for key-based invalidation and subscription.

- `Reactivity.Tag`
- `Reactivity.live` (microtask auto-flush)
- `Reactivity.test` (manual flush + `lastInvalidated`)
```

**Replace with:**
```markdown
## Reactivity (`src/Reactivity.ts`)

Library-owned reactivity service for key-based invalidation and subscription.

- `Reactivity.Tag` — Service tag for reactivity provider
- `Reactivity.live` — Default provider with microtask batching auto-flush
- `Reactivity.test` — Testing provider with manual flush control and `lastInvalidated` tracking
- **`Reactivity.tracked(effect, options?)`** — Execute an Effect while tracking which reactivity keys it reads. Returns Effect that accumulates accessed keys internally.
  - `options.initial` — Initial set of tracked keys
- **`Reactivity.invalidating(effect, keys)`** — Execute an Effect that invalidates specified keys upon completion.

Atom helpers:

- `Atom.invalidateReactivity(keys)` — Invalidate keys (same as `Reactivity.invalidate`)
- `Atom.trackReactivity(keys)` — Track which keys are accessed during atom read
- `Atom.withReactivity(atom, keys)` — Register reactivity keys for an atom
- `Atom.reactivityKeys(atom)` — Retrieve registered keys for an atom
- `Atom.flushReactivity()` — Force-flush reactivity invalidations
```

**Verification:**
```bash
$ grep "export.*tracked\|export.*invalidating" src/Reactivity.ts
export function tracked<A, E, R>(effect: Effect<A, E, R>, options?: ...): Effect<A, E, R>;
export function invalidating<E, R>(effect: Effect<void, E, R>, keys: ...): Effect<void, E, R>;
# Should show both exist
```

---

## 🟠 HIGH FIX #2: Document Stream State Functions

**Issue:** `Atom.Stream.emptyState()`, `Atom.Stream.applyChunk()`, `Atom.Stream.hydrateState()` are exported but not documented

**Location:** API.md lines 402-418 (Stream Integration section)

**Current state:**
```markdown
### Stream Integration

- **`Atom.fromStream(stream, initialValue, runtime?)`** — Create an atom whose value updates from an Effect Stream. Starts a fiber on first read.
- **`Atom.fromQueue(queue, initialValue)`** — Create an atom that reads from an Effect Queue. Shorthand for `fromStream(Stream.fromQueue(queue), initial)`.
- **`Atom.fromSchedule(schedule, initialValue, runtime?)`** — Create an atom from an Effect `Schedule` via `Stream.fromSchedule`.
- **`Atom.Stream.textInput(stream, options?)`** — First-party stream recipe for UI text input normalization (`trim`, `minLength`).
- **`Atom.Stream.searchInput(stream, options?)`** — Search-box recipe (`trim`/`minLength` + optional `lowercase` + `distinct` de-duplication).
```

**Add before line 419:**
```markdown
- **`Atom.Stream.emptyState<T>()`** — Create an empty stream state for out-of-order stream assembly. Used with `applyChunk` for handling chunks that arrive out of order.
- **`Atom.Stream.applyChunk<T>(state: StreamState<T>, chunk: T)`** — Apply a chunk to stream state, properly handling out-of-order updates and sequence validation.
- **`Atom.Stream.hydrateState<T>(value: T)`** — Create a stream state initialized with a hydrated value. Useful for SSR where initial state comes from server.

Advanced example:
```typescript
// Server sends initial list + streaming updates
const initialState = Atom.Stream.hydrateState(serverInitialList);
const updatedState = Atom.Stream.applyChunk(initialState, newItem);
```
```

**Verification:**
```bash
$ grep "export.*emptyState\|export.*applyChunk\|export.*hydrateState" src/Atom.ts
export namespace Stream {
  export function emptyState<T>(): StreamState<T>;
  export function applyChunk<T>(state: StreamState<T>, chunk: T): StreamState<T>;
  export function hydrateState<T>(value: T): StreamState<T>;
}
# Should show all three in Stream namespace
```

---

## 🟠 HIGH FIX #3: Make Scoped Constructor Imports Prominent

**Issue:** Functions like `scopedQueryEffect` are documented but only exported from `effect-atom-jsx/advanced`

**Affected lines:** 685, 710, and anywhere scoped functions are first mentioned

**Location:** Line 685 in "Async Data" section

**Current state:**
```markdown
- **`scopedQueryEffect(scope, fn, options?)`** — Effect constructor variant that creates a scope-bound query accessor.
```

**Change to:**
```markdown
- **`scopedQueryEffect(scope, fn, options?)`** — Effect constructor variant that creates a scope-bound query accessor.
  > **Import from:** `effect-atom-jsx/advanced`
```

**Apply same change to:**
- Line 710: `scopedMutationEffect`
- Find and update: `scopedRootEffect`, `layerContext`

**Search command:**
```bash
$ grep -n "scopedQueryEffect\|scopedMutationEffect\|scopedRootEffect\|layerContext" docs/API.md
```

**For each result, add after the function description:**
```
  > **Import from:** `effect-atom-jsx/advanced`
```

---

## 🟡 MEDIUM FIX #1: Clarify Reactive Core Import Path

**Issue:** Lines 752-768 document `batch`, `flush` but don't indicate they're not in main exports

**Location:** Lines 752-754

**Current state:**
```markdown
## Reactive Core (`src/api.ts`)

Solid.js-compatible reactive primitives:

- `createSignal<T>(initial, options?)` → `[Accessor<T>, Setter<T>]`
```

**Change to:**
```markdown
## Reactive Core (`src/api.ts`)

> **Import from:** `effect-atom-jsx/internals`

Solid.js-compatible reactive primitives:

- `createSignal<T>(initial, options?)` → `[Accessor<T>, Setter<T>]`
```

**Why:** Users need to know these aren't in main exports:
```typescript
// Doesn't work:
import { batch, flush } from "effect-atom-jsx";

// Correct:
import { batch, flush } from "effect-atom-jsx/internals";
```

---

## 🟡 MEDIUM FIX #2: Highlight Registry Import Path

**Issue:** Registry is documented but import path buried in text

**Location:** Line 503

**Current state:**
```markdown
## Registry (`src/Registry.ts`)

Provides a centralized read/write/subscribe context for atoms. Useful for managing atom state outside of reactive computations.

Import from `effect-atom-jsx/Registry` (advanced/manual API).
```

**Change to:**
```markdown
## Registry (`src/Registry.ts`)

> **Import:** `effect-atom-jsx/Registry`

Provides a centralized read/write/subscribe context for atoms. Useful for managing atom state outside of reactive computations.

This is an advanced/manual API. In most cases, use `mount()` for automatic registry management.
```

---

## 🟡 MEDIUM FIX #3: Document Testing Subpath

**Issue:** `effect-atom-jsx/testing` is exported but not documented

**Location:** Add new section after "DOM Runtime" section (after line 799)

**Add:**
```markdown
<br />

## Testing (`effect-atom-jsx/testing`)

Testing utilities for reactive code without requiring DOM or jsdom.

- **`TestHarness<R>`** — Test environment combining Effect runtime and reactive ownership
  - Type: Generic over Effect requirement `R`
  - Properties:
    - `runtime` — The underlying Effect `ManagedRuntime<R>`
    - `owner` — The reactive `Owner` scope
  - Methods:
    - `cleanup()` — Dispose runtime and reactive scope
    - `run<A>(fn: () => A)` — Execute function in test context
    - `effect<A, E>(eff: Effect<A, E, R>)` — Run Effect in test runtime

Example:
```typescript
import { TestHarness } from "effect-atom-jsx/testing";

const harness = new TestHarness(MyLayer);
try {
  harness.run(() => {
    const count = Atom.make(0);
    count.set(5);
    expect(count()).toBe(5);
  });
} finally {
  harness.cleanup();
}
```

For full testing patterns, see `docs/TESTING.md`.
```

---

## 🟡 MEDIUM FIX #4: Document Runtime Subpath

**Issue:** `effect-atom-jsx/runtime` is exported but not documented

**Location:** Add new section after Testing section (new)

**Add:**
```markdown
<br />

## JSX Runtime (`effect-atom-jsx/runtime`)

Babel JSX plugin integration. This module is imported by `babel-plugin-jsx-dom-expressions` during compilation.

**Configure Babel:**
```json
{
  "plugins": [
    ["babel-plugin-jsx-dom-expressions", {
      "moduleName": "effect-atom-jsx/runtime",
      "generate": "dom"
    }]
  ]
}
```

**For users:** This export is handled automatically by the Babel plugin. You typically don't need to import from it directly.

**For framework authors:** See `babel-plugin-jsx-dom-expressions` documentation for custom runtime implementation requirements.
```

---

## 🟡 MEDIUM FIX #5: Document Internals Subpath

**Issue:** `effect-atom-jsx/internals` is exported but not clearly documented

**Location:** Update the "Reactive Core" section (around line 752)

**Current organization:**
- Reactive Core section exists but doesn't mention it's under `./internals`

**Add new section before "DOM Runtime":**
```markdown
<br />

## Internal Reactive Primitives (`effect-atom-jsx/internals`)

Low-level Solid.js-compatible reactive primitives. These are re-exported from `effect-atom-jsx/advanced` but also available from this path.

**When to use:** Only in advanced scenarios where you need direct access to the reactive graph.

**For most applications:** Use the Atom API instead, which builds on these primitives.

Exports:
- `createSignal`, `createEffect`, `createMemo`, `createRoot`
- `createContext`, `useContext`, `onCleanup`, `onMount`
- `untrack`, `sample`, `batch`, `flush`
- `mergeProps`, `splitProps`, `getOwner`, `runWithOwner`

These are 100% compatible with Solid.js signal/effect patterns.
```

---

## 📊 Summary of Changes

| Fix # | Type | Lines | Changes | Time |
|-------|------|-------|---------|------|
| 1 | DELETE | 409-411 | Remove 3 lines (Atom.fromResource) | 2 min |
| 2 | ADD | After 690 | Add comparison table + examples | 20 min |
| 3 | ADD/MODIFY | 685, 710, etc | Add import callouts to 4 functions | 10 min |
| 4 | ADD | After 768 | Add Reactivity.tracked/invalidating | 15 min |
| 5 | ADD | After 418 | Add Stream state functions | 15 min |
| 6 | MODIFY | 752-754 | Add import callout to Reactive Core | 5 min |
| 7 | MODIFY | 503-505 | Make Registry import prominent | 5 min |
| 8 | ADD | After 799 | Add Testing subpath section | 15 min |
| 9 | ADD | After 8 | Add Runtime subpath section | 10 min |
| 10 | ADD | After 7 | Add Internals subpath section | 10 min |

**Total time:** ~107 minutes (1h 47 min)

---

## Verification Checklist

After making all changes, verify:

### Critical Fixes
- [ ] `Atom.fromResource` removed from API.md
- [ ] Can grep for "fromResource" and find no results
- [ ] Async API comparison table is clear and accurate

### High-Priority Fixes
- [ ] Reactivity section mentions `tracked` and `invalidating`
- [ ] Stream section mentions state functions
- [ ] All scoped functions have `effect-atom-jsx/advanced` callout

### Medium-Priority Fixes
- [ ] Reactive Core section has import callout
- [ ] Registry section clearly shows import path
- [ ] Testing subpath is documented
- [ ] Runtime subpath is documented
- [ ] Internals subpath is documented

### Overall
- [ ] No broken code examples remain
- [ ] All imports in examples use correct paths
- [ ] No dangling references to non-existent APIs
- [ ] All documented APIs are actually exported

---

## Testing the Fixes

After changes, run these checks:

```bash
# 1. Verify no reference to non-existent APIs
grep "fromResource" docs/API.md
# Should return: No output

# 2. Verify exports match documentation
npm run typecheck
npm run build

# 3. Compile examples (if available)
# Verify all code snippets in API.md compile without errors
```

---

## Rollout Plan

1. **Immediate (Today):** Critical fixes #1-2 (22 minutes)
2. **This week:** High-priority fixes #3-5 (40 minutes)
3. **This sprint:** Medium-priority fixes #6-10 (45 minutes)

Total: ~1h 47 minutes of work across 3 phases.
