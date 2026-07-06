import { Component, Element, View } from "effect-atom-jsx";

const TICK_INTERVAL_MS = 1000;

const Root = View.Slot.make("root", {
  capability: Element.Capability.Container,
});

const StepInput = View.Slot.make("step", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input],
});

const Increment = View.Slot.make("increment", {
  capability: Element.Capability.Interactive,
  allowedEvents: [View.Event.Click],
});

const ToggleAutoCount = View.Slot.make("toggleAutoCount", {
  capability: Element.Capability.Interactive,
  allowedEvents: [View.Event.Click],
});

const CounterSlots = View.Slots.make({
  root: View.Slot.bind(Root, Element.container()),
  step: View.Slot.bind(StepInput, Element.textInput()),
  increment: View.Slot.bind(Increment, Element.interactive()),
  toggleAutoCount: View.Slot.bind(ToggleAutoCount, Element.interactive()),
});

export const AutoCounter = Component.make(
  Component.props<{}>(),
  Component.require<never>(),

  Component.setup<{}>()
    .value("slots", () => View.Slots.handles(CounterSlots))
    .bind("count", () => Component.state(0))
    .bind("step", () => Component.state(1))
    .bind("isAutoCounting", () => Component.state(false))
    .value("increment", ({ bindings }) => () => {
      bindings.count.update((count) => count + bindings.step());
    })
    .value("toggleAutoCount", ({ bindings }) => () => {
      bindings.isAutoCounting.update((isAutoCounting) => !isAutoCounting);
    })
    .doEffect(({ bindings }) =>
      Component.effect(() => {
        if (!bindings.isAutoCounting()) return;

        const interval = setInterval(() => {
          bindings.count.update((count) => count + bindings.step());
        }, TICK_INTERVAL_MS);

        return () => clearInterval(interval);
      })
    ),

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
              b.step.set(Number(input.value));
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

export function App() {
  return <AutoCounter />;
}
