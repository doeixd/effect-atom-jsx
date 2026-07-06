# Setup/View Comparison

This note compares the current AF-UI component shape against two familiar
models and one close peer:

- React function components with hooks.
- Solid-style fine-grained components.
- Foldkit-style model/message/update/subscription programs.

The point is not that either model is wrong. The point is that AF-UI has a
different ownership split:

```ts
Component<Props, Req, E, Bindings, SlotContract>
```

```ts
Component.make(props, requirements, setup, view)
```

`setup` creates durable instance state once. `view` reads that state through
live accessors and typed holes. That gives us local state and subscriptions
without coupling state creation to rerender, and without forcing every local
interaction through an external message loop.

## The Counter Example

The feature:

- show a count
- allow manual increment
- toggle auto-counting every second
- allow the user to change the step size while auto-counting is already running

The stale-closure bug in React comes from the interval callback capturing a
render-time value of `step`. React state values are snapshots from a render.
If the interval is only recreated when `isAutoCounting` changes, then changing
`step` does not update the interval callback. The usual fix is a ref that is
kept in sync by another effect.

AF-UI does not have that shape. `setup` creates a stable accessor:

```ts
const [step, setStep] = yield* Component.signal(1);
```

Callbacks close over the accessor, not a render snapshot:

```ts
const increment = () => {
  setCount((count) => count + step());
};
```

The interval also reads the current value at tick time:

```ts
const interval = setInterval(() => {
  setCount((count) => count + step());
}, 1000);
```

There is no ref workaround because there is no stale render snapshot of
`step`. The callback holds `step`, and `step()` returns the current value.

## Current Library Shape

A compact current-version example:

```tsx
import { Effect } from "effect";
import { Component, Element, View } from "effect-atom-jsx";

const TICK_INTERVAL_MS = 1000;

const Root = View.Slot.make("root", {
  capability: Element.Capability.Container,
});

const CounterSlots = View.Slots.make({
  root: View.Slot.bind(Root, Element.container()),
});

export const Counter = Component.make(
  Component.props<{}>(),
  Component.require<never>(),

  () =>
    Effect.gen(function* () {
      const [count, setCount] = yield* Component.signal(0);
      const [step, setStep] = yield* Component.signal(1);
      const [isAutoCounting, setIsAutoCounting] = yield* Component.signal(false);

      const increment = () => {
        setCount((count) => count + step());
      };

      const toggleAutoCount = () => {
        setIsAutoCounting((isAutoCounting) => !isAutoCounting);
      };

      yield* Component.effect(() => {
        if (!isAutoCounting()) return;

        const interval = setInterval(() => {
          setCount((count) => count + step());
        }, TICK_INTERVAL_MS);

        return () => clearInterval(interval);
      });

      return {
        slots: View.Slots.handles(CounterSlots),
        count,
        step,
        setStep,
        isAutoCounting,
        increment,
        toggleAutoCount,
      };
    }),

  (_props, b) =>
    View.fromSlots(
      CounterSlots,
      <main>
        <p>
          Count: <strong>{b.count()}</strong>
        </p>

        <label>
          Step:{" "}
          <input
            type="number"
            value={b.step()}
            onInput={(event) => {
              const input = event.currentTarget as HTMLInputElement;
              b.setStep(Number(input.value));
            }}
          />
        </label>

        <button type="button" onClick={b.increment}>
          Increment
        </button>

        <button type="button" onClick={b.toggleAutoCount}>
          {b.isAutoCounting() ? "Stop" : "Auto-Count"}
        </button>
      </main>,
    ),
).pipe(Component.withSlots(CounterSlots));
```

The full example lives at [`../examples/auto-counter/App.tsx`](../examples/auto-counter/App.tsx).

## What Setup Owns

`setup` is the component instance's private construction phase. It can create:

- local signals and atoms
- derived values
- queries and actions
- services from Effect requirements
- subscriptions and scoped resources
- element handles and slot bindings
- stable callbacks used by the view

Those values become `Bindings`. Bindings are not props. They are not recreated
because a text hole changes. They are the private implementation state for one
component instance.

That means this is stable:

```ts
const increment = () => {
  setCount((count) => count + step());
};
```

`increment` is created once, but it is not stale because it reads live state.

## What View Owns

`view` owns the rendered shape. It consumes props and bindings:

```ts
(_props, bindings) => View.fromSlots(slots, jsx)
```

Reactive JSX expressions are typed holes. A hole can read `bindings.count()`
and update that local DOM/text region when the signal changes. The component
setup does not rerun to update the count.

That gives a useful split:

- setup creates durable state and effects
- view declares structure and reactive holes
- slots publish the external structural attachment surface

## Compared To React

React function components combine state reads, state creation, and rendering in
one re-executed function. Hooks recover identity across rerenders, but the code
still sees render snapshots. That is why stale closures are common:

```ts
useEffect(() => {
  const id = setInterval(() => {
    setCount((count) => count + step);
  }, 1000);

  return () => clearInterval(id);
}, [isAutoCounting]);
```

The callback captured the `step` from the render that created the interval.
Fixing that generally requires either adding `step` to the dependency array,
which restarts the interval, or introducing a ref that is synchronized by a
separate effect.

AF-UI avoids that specific class of bug because callback code reads live
accessors:

```ts
setCount((count) => count + step());
```

There is still lifecycle code for the interval, but not a ref just to keep a
callback current.

## Compared To Solid

Short answer: AF-UI should not claim to be categorically better than Solid.
For simple local UI, Solid is usually more concise. The AF-UI advantage is not
"better signals"; it is a more explicit, typed architecture around Solid-like
fine-grained reactivity.

Solid is the closest comparison. It already has the important reactive property
that React lacks:

```tsx
const [step, setStep] = createSignal(1);

setInterval(() => {
  setCount((count) => count + step());
}, 1000);
```

That callback reads a live accessor, so it does not have the React stale-closure
problem. Solid components also run once for setup, and JSX expressions are
fine-grained reactive holes. On local reactivity alone, AF-UI should not claim
to be fundamentally different from Solid. The counter example is safe for the
same core reason.

The difference is architectural. Solid uses one function for setup and view:

```tsx
function Counter() {
  const [count, setCount] = createSignal(0);

  return <p>{count()}</p>;
}
```

That is concise, but it leaves several concepts implicit in the component
closure:

- setup-created state
- rendered structure
- effect/service requirements
- error channels
- public structural attachment points
- external styling and behavior contracts

AF-UI separates those axes:

```ts
Component<Props, Req, E, Bindings, SlotContract>
```

```text
setup        creates durable bindings
view         consumes bindings through typed holes
slots        publish the structural attachment contract
Req / E      describe Effect services and failures
```

So the claim is not "AF-UI has better signals than Solid." The stronger claim is
that AF-UI takes Solid-like fine-grained reactivity and puts an Effect-native,
inside-out component contract around it.

That gives AF-UI room for:

- typed `Bindings` as a first-class component axis
- typed Effect requirements and errors across setup, actions, routes, and
  behaviors
- public `View.Slots` contracts for external style and behavior attachment
- inspectable `View<Slots>` metadata for diagnostics, renderers, hidden slots,
  remaps, and future typed holes
- a clearer distinction between local implementation state and public component
  API

That tradeoff is intentional:

| Case | Likely Better Fit | Why |
| --- | --- | --- |
| Small local UI | Solid | Fewer concepts and less boilerplate |
| App/component library architecture | AF-UI | Explicit setup/view, typed bindings, slots, requirements, and errors |
| Renderer/platform diagnostics | AF-UI | `View<Slots>` can carry inspectable metadata |
| External style/behavior composition | AF-UI | Attach through typed `View.Slots` contracts |
| Effect service integration | AF-UI | `Req` / `E` are part of the component type |

Solid is still more concise for simple UI. AF-UI is aiming at a more explicit
library/application architecture where composition, diagnostics, services,
typed failures, slot contracts, and renderer metadata matter as much as local
DOM updates.

## Compared To Foldkit

Foldkit's model/message/update/subscription style is explicit and deterministic:

- the model is plain data
- messages describe events
- update is exhaustive
- subscriptions are declared from model dependencies

That is excellent for app-level programs and event-sourced architecture. But it
adds ceremony for small instance-local UI state. A local counter needs model
schema, message constructors, message union, update function, subscription
definition, and a view that emits messages.

AF-UI can keep the same safety property that matters for this example without
requiring the whole message loop:

- state is instance-local in setup
- effects are scoped and cleaned up
- callbacks read current accessors
- reactive holes update themselves
- external style/behavior attachment still goes through typed slots

So the local counter can stay local. If an application wants a message/update
architecture, it can still build that on top of bindings and actions. It is not
required for every component.

## The Main Advantage

The core advantage is the separation of creation, rendering, and attachment:

```text
setup     creates durable instance state and scoped effects
view      declares structure and typed reactive holes
slots     publish the structural attachment contract
props     configure the instance from the outside
```

That split gives AF-UI a middle ground:

- less stale-closure surface than React
- the same live-accessor advantage that makes Solid safe for this example
- less ceremony than Foldkit for local component state
- typed structural slots for styling and behavior
- Effect requirements and errors that can still bubble through components
- scoped cleanup for subscriptions and resources

The design goal is not "React with different hooks" or "Foldkit inside JSX".
It is an inside-out component model where state lives in setup, DOM updates live
in typed holes, and external composition happens through slot contracts.
