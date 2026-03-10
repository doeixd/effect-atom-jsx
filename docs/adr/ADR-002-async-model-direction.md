# ADR-002: Async Model Direction (`AsyncResult` and `Result`)

- Status: Proposed
- Date: 2026-03-10

## Context

The library currently exposes two async/result models:

- `AsyncResult` (Loading/Refreshing/Success/Failure/Defect)
- `Result` (Initial/Success/Failure with waiting semantics)

Design feedback highlights conceptual overlap, lossy conversions, and unclear default guidance.

## Options Considered

1. Keep both models and document strict responsibilities.
2. Rename one model for clarity while keeping both.
3. Converge to one public model.

## Decision

Short-term: option 1 with stronger documentation and explicit conversion caveats.

Mid-term: evaluate option 2 or 3 after async API consolidation prototype.

## Rationale

- Minimizes churn while improving user understanding immediately.
- Gives room to validate whether one model can replace the other without regressions.

## Migration Impact

- No immediate breaking change.
- Docs must include a state-mapping table and where conversion loses fidelity.

## Rollback Plan

- If convergence attempts regress semantics, keep both models and enforce clearer boundaries in docs/API tiers.

## context:
3. Align the async model with Solid 2.0's Loading/isPending split.
Drop AsyncResult as the user-facing type. Instead, adopt Solid 2.0's model where async atoms suspend naturally and boundaries handle the UI:
tsx// Async atom — returns Effect, suspends until resolved
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
For cases where you need explicit pattern matching (error handling, defect handling), keep effect-atom's Result type and builder as an opt-in:
tsx// When you need explicit result access instead of suspension
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
This gives you two clean paths: the Solid 2.0 suspension path (default, simpler) and the effect-atom explicit Result path (opt-in, more control). No AsyncResult hybrid.
The Async, Errored, and Loading components all still work — Loading and Errored are boundary-based (Solid 2.0 style), and if someone wants the explicit component approach, Result.builder covers it.