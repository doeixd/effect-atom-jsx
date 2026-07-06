# Async Counter With Optimistic Actions

This document shows the golden-path experience for async UI, optimistic
updates, pending indicators, rollback, `Result`, `Async`, `Loading`, and
slot-based styling.

It uses the optimistic action API from
[`OPTIMISTIC_ACTION_DESIGN_PLAN.md`](OPTIMISTIC_ACTION_DESIGN_PLAN.md):

```ts
Component.optimistic(source).action(...)
```

## What This Example Shows

The counter has:

- committed local count
- optimistic visible count
- async save action
- rollback
- pending button state
- full action result rendering
- async derived double value
- server count query
- typed Effect service requirement
- typed domain errors
- public slots for external style/behavior attachment

The key split is:

```text
saveCount.value()         visible value, optimistic when present
saveCount.committed()     durable confirmed value
saveCount.hasOptimistic() whether visible value is temporary
saveCount.pending()       pending projection from Result
saveCount.result()        full async lifecycle
```

`Loading` is used for small local pending affordances. `Async` is used for full
`Result` rendering.

## Domain Service

```tsx
import { Context, Effect } from "effect";
import {
  Async,
  Component,
  Element,
  Loading,
  Style,
  View,
} from "effect-atom-jsx";

type CounterError = {
  readonly _tag: "CounterError";
  readonly message: string;
};

class CounterApi extends Context.Tag("CounterApi")<
  CounterApi,
  {
    readonly load: () => Effect.Effect<number, CounterError>;
    readonly save: (next: number) => Effect.Effect<number, CounterError>;
    readonly double: (count: number) => Effect.Effect<number, CounterError>;
  }
>() {}
```

`CounterApi` is a normal Effect service. The component's requirement type should
include `CounterApi` until a layer provides it.

## Slots

```tsx
const Root = View.Slot.make("root", {
  capability: Element.Capability.Container,
});

const Decrement = View.Slot.make("decrement", {
  capability: Element.Capability.Interactive,
  allowedEvents: [View.Event.Click],
});

const Increment = View.Slot.make("increment", {
  capability: Element.Capability.Interactive,
  allowedEvents: [View.Event.Click],
});

const Rollback = View.Slot.make("rollback", {
  capability: Element.Capability.Interactive,
  allowedEvents: [View.Event.Click],
});

const CounterSlots = View.Slots.make({
  root: View.Slot.bind(Root, Element.container()),
  decrement: View.Slot.bind(Decrement, Element.interactive()),
  increment: View.Slot.bind(Increment, Element.interactive()),
  rollback: View.Slot.bind(Rollback, Element.interactive()),
});
```

The component defines its structural attachment surface once. Styles and
behaviors target this contract from outside the component.

## Component

```tsx
export const AsyncCounter = Component.make(
  Component.props<{ readonly initial?: number }>(),
  Component.require<CounterApi>(CounterApi),

  Component.setup<{ readonly initial?: number }>()
    .value("slots", () => View.Slots.handles(CounterSlots))
    .bind("count", ({ props }) => Component.state(props.initial ?? 0))
    .bind("serverCount", () =>
      Component.query(
        () => CounterApi.pipe(Effect.flatMap((api) => api.load())),
        { name: "counter.load" },
      )
    )
    .bind("saveCount", ({ bindings }) =>
      Component.optimistic(bindings.count).action({
        name: "counter.save",

        update: (current, delta: number) => current + delta,

        effect: (next) =>
          CounterApi.pipe(Effect.flatMap((api) => api.save(next))),

        reconcile: (_optimistic, confirmed) =>
          confirmed,

        commit: (confirmed) =>
          bindings.count.set(confirmed),

        reactivityKeys: ["counter"],
      })
    )
    .bind("double", ({ bindings }) =>
      Component.query(
        () => CounterApi.pipe(Effect.flatMap((api) => api.double(bindings.saveCount.value()))),
        { name: "counter.double" },
      )
    ),

  (_props, b) =>
    View.fromSlots(
      CounterSlots,
      <section>
        <h2>Async Counter</h2>

        <div>
          Count: {b.saveCount.value()}
          {b.saveCount.hasOptimistic() ? " (optimistic)" : ""}
        </div>

        <div>
          Confirmed: {b.saveCount.committed()}
        </div>

        <div>
          <Async
            result={b.double()}
            loading={() => "Calculating double..."}
            refreshing={(previous) =>
              previous._tag === "Success"
                ? `Double: ${previous.value} (refreshing...)`
                : "Refreshing double..."
            }
            success={(value) => `Double: ${value}`}
            error={(error) => `Double failed: ${error.message}`}
            defect={(cause) => `Double defect: ${cause}`}
          />
        </div>

        <button
          disabled={b.saveCount.pending()}
          onClick={() => b.saveCount.run(-1)}
        >
          <Loading when={b.saveCount.pending} fallback={() => "Saving..."}>
            -
          </Loading>
        </button>

        <button
          disabled={b.saveCount.pending()}
          onClick={() => b.saveCount.run(1)}
        >
          <Loading when={b.saveCount.pending} fallback={() => "Saving..."}>
            +
          </Loading>
        </button>

        <button
          disabled={!b.saveCount.hasOptimistic() || b.saveCount.pending()}
          onClick={() => b.saveCount.rollback()}
        >
          Roll back
        </button>

        <div>
          <Async
            result={b.saveCount.result()}
            loading={() => "Saving..."}
            refreshing={() => "Saving latest change..."}
            success={() => "Saved"}
            error={(error) => `Save failed: ${error.message}`}
            defect={(cause) => `Unexpected save failure: ${cause}`}
          />
        </div>

        <div>
          <Async
            result={b.serverCount()}
            loading={() => "Loading server count..."}
            refreshing={(previous) =>
              previous._tag === "Success"
                ? `Server count: ${previous.value} (refreshing...)`
                : "Refreshing server count..."
            }
            success={(value) => `Server count: ${value}`}
            error={(error) => `Load failed: ${error.message}`}
            defect={(cause) => `Load defect: ${cause}`}
          />
        </div>
      </section>,
      { name: "AsyncCounter" },
    ),
).pipe(
  Component.withSlots(CounterSlots),
);
```

## External Style

```ts
const CounterStyle = Style.forSlots(CounterSlots)({
  root: Style.slot({
    display: "grid",
    gap: "0.75rem",
  }),

  decrement: Style.slot({
    color: "crimson",
  }),

  increment: Style.slot({
    color: "seagreen",
  }),

  rollback: Style.slot({
    opacity: 0.8,
  }),
});

export const StyledAsyncCounter = AsyncCounter.pipe(
  Style.attachToSlots(CounterStyle, CounterSlots),
);
```

The component owns logic and state. The style owns presentation and attaches
through the component's public slot contract.

## Lifecycle

When the user clicks increment:

1. `saveCount.run(1)` starts an optimistic action.
2. `update(current, 1)` computes the optimistic next count.
3. `saveCount.value()` immediately reads the optimistic count.
4. `saveCount.pending()` becomes `true`.
5. `Loading` renders the small pending affordance in the clicked button.
6. `saveCount.result()` enters `Loading` or `Refreshing`.
7. `Async` renders the save lifecycle.
8. `api.save(next)` runs as an Effect.

On success:

1. `reconcile(...)` chooses the confirmed value.
2. `commit(confirmed)` updates the durable count.
3. the optimistic overlay clears.
4. `saveCount.result()` becomes `Success`.
5. reactivity keys invalidate dependent reads.

On typed failure:

1. the optimistic overlay rolls back.
2. the visible count returns to the committed value.
3. `saveCount.result()` becomes `Failure<CounterError>`.
4. `Async` renders the typed failure.

On defect:

1. the optimistic overlay rolls back.
2. `saveCount.result()` becomes `Defect`.
3. `Async` renders the defect branch.

## Why This Is The Preferred Experience

This API keeps the important boundaries explicit:

- `count` is committed state.
- `saveCount.value()` is the visible state.
- `saveCount.result()` is async lifecycle state.
- `saveCount.pending()` is derived from the lifecycle.
- `saveCount.hasOptimistic()` is derived from the overlay.
- `Async` renders full result states.
- `Loading` renders localized pending affordances.
- `CounterSlots` is the structural styling/behavior contract.
- `CounterApi` and `CounterError` preserve Effect requirement/error typing.

The user does not manually coordinate `createOptimistic`, mutation callbacks,
commit, rollback, pending, and rendering. The authored action spec owns that
lifecycle.

## Lower-Level APIs

The same behavior can still be assembled manually with:

- `createOptimistic(source)`
- `Component.action(...)` or `defineMutation(...)`
- `Async`
- `Loading`
- explicit success/rollback hooks

That lower-level path remains useful for dynamic or specialized cases, but it
should not be the long-term golden path for common optimistic UI.
