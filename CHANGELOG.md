# Changelog

## 0.2.0 (2026-03-09)

Initial stable release.

### Core

- **Atom** — reactive state primitives with `make`, `readable`, `writable`, `family`, `map`, `withFallback`, `batch`, and `fromStream`/`fromQueue`/`fromResource`
- **Registry** — centralized read/write/subscribe context for atoms
- **AtomRef** — per-property reactive access to objects and arrays via `make` and `collection`
- **Result** — three-state data-fetching result type (`Initial` / `Success` / `Failure`) with waiting semantics

### Effect Integration

- **queryEffect / defineQuery** — reactive async queries with fiber cancellation, `AsyncResult` state, and key-based invalidation
- **atomEffect** — standalone reactive Effect computations (no ambient runtime required)
- **mutationEffect** — write actions with optimistic UI, rollback, and automatic refresh
- **createOptimistic** — optimistic overlay for immediate UI feedback
- **useService / useServices** — synchronous service lookup from ambient `ManagedRuntime`
- **createMount / mount** — bootstrap a `ManagedRuntime` from a `Layer` and render
- **scopedQuery / scopedMutation / scopedRoot** — Effect `Scope`-tied lifecycle primitives
- **signal / computed** — OO-style reactive refs

### AsyncResult

- Exit-first state model: `Loading` / `Refreshing` / `Success` / `Failure` / `Defect`
- Combinators: `match`, `map`, `flatMap`, `getOrElse`, `getOrThrow`
- Lossless round-trip via `.exit` field on settled states

### JSX Components

- `Async`, `Show`, `For`, `Switch`/`Match`, `MatchTag`, `Optional`, `MatchOption`, `Dynamic`, `Loading`, `Errored`, `WithLayer`, `Frame`

### Modules

- **AtomSchema** — Schema-driven reactive form validation with touched/dirty tracking
- **AtomLogger** — structured debug logging for atom reads/writes
- **AtomRpc** — RPC client factory for flat endpoint maps
- **AtomHttpApi** — HTTP API client factory for grouped endpoints
- **Hydration** — SSR state transfer (`dehydrate`/`hydrate`)

### Testing

- `renderWithLayer`, `withTestLayer`, `mockService` — DOM-free test harness via `effect-atom-jsx/testing`

### SSR

- `renderToString`, `hydrateRoot`, `isServer`, `getRequestEvent`/`setRequestEvent`

### Compatibility

- Peers on `effect@^4.0.0-beta.29`
- JSX via `babel-plugin-jsx-dom-expressions` pointing to `effect-atom-jsx/runtime`
