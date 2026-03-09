# Effect-Atom Alignment Plan

Date: 2026-03-08
Scope: Align `effect-atom-jsx` to feel natural for `@effect-atom/atom` users while keeping Effect v4 + JSX runtime goals.

## What Was Explored

Inspected package artifacts from `@effect-atom/atom@0.5.3` (downloaded and extracted locally):

- `dist/dts/index.d.ts`
- `dist/dts/Atom.d.ts`
- `dist/dts/Result.d.ts`
- `dist/dts/Registry.d.ts`
- `dist/dts/AtomRef.d.ts`
- `dist/dts/AtomRpc.d.ts`
- `dist/dts/AtomHttpApi.d.ts`
- `dist/dts/Hydration.d.ts`

Key discovery:

- `@effect-atom/atom@0.5.3` peers on Effect v3 (`effect ^3.x`), while this library is Effect v4 beta.
- Direct runtime-level dependency swap is not safe today without either:
  - downgrading this library to v3, or
  - waiting for an official framework-agnostic v4 atom core.

## Effect-Atom Surface To Emulate

From `Atom.d.ts` and related modules, the important user-facing semantics are:

- Core atom model: `Atom`, `Writable`, `Context`, `WriteContext`
- Constructors: `readable`, `writable`, `make`
- Runtime/registry model: `runtime`, `context`, `Registry.make/layer`, `AtomRegistry`
- Result model: `Result.Initial | Success | Failure` + waiting semantics and previous-success carry
- Families and combinators: `family`, `map`, `mapResult`, `transform`, `withFallback`, `debounce`, `optimistic`, `batch`
- Effect helpers: `get`, `set`, `update`, `modify`, `getResult`, `refresh`, stream conversions
- Integration helpers: `AtomRef`, hydration, RPC/HttpApi bridges

## Current Library State (Gap Summary)

Already present in `effect-atom-jsx`:

- Atom-like ergonomics: `signal`, `computed`, `createAtom`
- Async effects with cancellation: `atomEffect`, `resource`, `resourceWith`
- Async state model: `Loading/Refreshing/Success/Failure/Defect`
- Mutation helpers: `createOptimistic`, `actionEffect`
- Layer/runtime injection: `mount`, `use`

Missing vs effect-atom expectations:

- No `Atom` namespace/module compatibility layer
- No `Registry` abstraction with mount/subscription lifecycle API
- No `Result.Initial` equivalent and waiting flags on result nodes
- No `family`, `withFallback`, `debounce`, advanced `transform/mapResult` parity
- No `AtomRef` model (`prop`, `collection`, structural refs)
- No hydration (`dehydrate/hydrate`) API
- No first-class RPC/HttpApi atom factories

## Recommended Strategy

Implement a **v4-native compatibility layer** first, not a direct dependency swap:

- Keep existing internals for v4 correctness and JSX performance.
- Add `effect-atom-like` API modules that mirror naming/behavior where feasible.
- Mark strict parity targets and intentionally unsupported areas.
- Keep current API stable; add compatibility as additive surface.

## Detailed Implementation Plan

### Phase 1 - Compatibility Foundations

1. Add `compat/Result` module
- Introduce `Initial | Success | Failure` result union with `waiting` semantics.
- Add constructors/guards similar to effect-atom: `initial`, `success`, `failure`, `isInitial`, `isSuccess`, `isFailure`, `isWaiting`.
- Add conversion helpers between current `AsyncResult` and compat `Result`.

2. Add `compat/Atom` base model
- Define `Atom<A>`, `Writable<R, W>`, and minimal `Context` signatures.
- Add constructors with effect-atom-like names:
  - `readable(read)`
  - `writable(read, write)`
  - `make(...)` overload family mapped to v4 internals.

3. Add migration-safe aliases
- Keep existing exports unchanged.
- Export new compat namespace (`EffectAtomCompat` or `Atom`) from `index.ts`.

Deliverables:
- `src/compat/result.ts`
- `src/compat/atom.ts`
- `docs/API.md` updates with “compat mode” section

### Phase 2 - Registry And Runtime Parity

1. Add registry abstraction
- `Registry.make(...)` with:
  - `get`, `set`, `update`, `modify`
  - `mount`, `refresh`, `subscribe`, `dispose`, `reset`
- Back by existing reactive owner graph + Effect runtime adapters.

2. Add Effect environment wiring
- `layer` / `layerOptions` for registry provisioning.
- tag-like accessor for current registry (v4 `ServiceMap` based).

3. Add effect helpers
- `get(atom)`, `set(atom, value)`, `update(atom, fn)`, `refresh(atom)` returning `Effect`s.

Deliverables:
- `src/compat/registry.ts`
- `src/compat/runtime.ts`
- registry integration tests

### Phase 3 - High-Value Effect-Atom Combinators

1. Family + composition
- `family((arg) => atom)`
- `map`, `transform`, `mapResult`
- `withFallback`

2. Behavior modifiers
- `debounce`
- `keepAlive` / `autoDispose` semantics compatible with current owner model

3. Optimistic parity
- Align current `createOptimistic/actionEffect` with effect-atom-style optimistic patterns and naming.

Deliverables:
- `src/compat/combinators.ts`
- targeted parity tests for each combinator

### Phase 4 - Optional Advanced Modules

1. `AtomRef` parity layer
- `make`, `prop`, `set`, `update`, `collection`.

2. Hydration
- `dehydrate(registry)`, `hydrate(registry, dehydratedState)`.

3. RPC/Http API helpers
- Add v4-native wrappers inspired by `AtomRpc` and `AtomHttpApi`.
- Integrate with existing `TodoApiFromRpc` direction.

Deliverables:
- `src/compat/atom-ref.ts`
- `src/compat/hydration.ts`
- `src/compat/rpc.ts`

### Phase 5 - Docs, Migration, and Hardening

1. “For effect-atom users” guide
- side-by-side mapping table (`@effect-atom/atom` -> `effect-atom-jsx compat`).

2. Compatibility matrix
- Fully compatible / behaviorally compatible / intentionally different / not yet implemented.

3. Test hardening
- Add parity-focused suite (`src/__tests__/compat/*.test.ts`).
- Add smoke tests that use compat surface only.

Deliverables:
- `docs/EFFECT_ATOM_MIGRATION.md`
- `docs/API.md` compatibility matrix

## Proposed API Mapping (Initial)

- `Atom.make` -> `compat.Atom.make` (backed by `atomEffect` / internal computed graph)
- `Atom.family` -> `compat.Atom.family`
- `Atom.batch` -> existing `batch`
- `Atom.optimistic` -> current `createOptimistic` wrapper
- `Atom.get/set/update/refresh` -> effect-returning helpers over compat registry
- `Result.*` -> compat result module (plus converters to/from current `AsyncResult`)

## Risks And Constraints

- Effect version mismatch remains the biggest constraint for direct dependency parity.
- Some effect-atom semantics depend on v3 runtime internals; must be emulated carefully in v4.
- Avoid breaking the existing JSX-first API while adding compat layers.

## Success Criteria

- A user familiar with `@effect-atom/atom` can use the compat surface with minimal relearning.
- Existing `effect-atom-jsx` API remains stable.
- Type inference remains strict in v4 across atom reads/writes/effects.
- Parity tests validate behavior across refresh/waiting/fallback/optimistic flows.
