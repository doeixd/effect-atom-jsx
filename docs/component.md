# Component System

Components are typed Effect programs with a pure view function. Props are owned
by the caller, setup creates scoped bindings, and the view renders from the
committed setup snapshot.

The current component shape is:

```ts
Component<Props, Req, E, Bindings, SlotContract> -> View<Slots> | JSX-like node
```

- `Props` are caller-provided inputs.
- `Req` is the union of Effect services required by setup and helpers.
- `E` is the typed setup error channel.
- `Bindings` are setup-created state, resources, atoms, actions, and handles.
- `SlotContract` is the authored `View.Slots` metadata published by
  `Component.withSlots(...)`.

Superseded component design sketches live in `docs/archive/`. Use the APIs
below for current authoring.

## Golden Path

```ts
import { Component, Element, Result, View } from "effect-atom-jsx";
import { Effect } from "effect";

const UserSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  name: { capability: Element.Capability.Container },
});

const UserCard = Component.make(
  Component.props<{ readonly id: string }>(),
  Component.require(Api),
  (props) =>
    Effect.gen(function* () {
      const api = yield* Api;
      const user = yield* Component.query(
        () => api.getUser(props.id),
        { name: `user:${props.id}` },
      );
      return { user };
    }),
  (_props, bindings) =>
    View.fromSlots(UserSlots, (
      <article>
        {Result.builder(bindings.user())
          .onInitial(() => "Loading")
          .onSuccess((user) => <h2>{user.name}</h2>)
          .onFailure(() => "Could not load user")
          .render()}
      </article>
    )),
).pipe(Component.withSlots(UserSlots));
```

## Setup As Effect

Setup is an `Effect`. That keeps service requirements, typed errors, cleanup,
spans, and resource ownership in one model.

Common helpers:

- `Component.state(initial)` creates a writable atom scoped to the component.
- `Component.derived(fn)` creates a derived atom.
- `Component.query(effectOrThunk, options?)` creates a result-valued async atom.
- `Component.action(fn, options?)` creates an action handle.
- `Component.optimistic(source).action(...)` creates an optimistic action.
- `Component.use(effect)` runs an arbitrary Effect in setup.
- `Effect.addFinalizer(...)` registers cleanup on unmount.

```ts
const SaveButton = Component.make(
  Component.props<{ readonly userId: string }>(),
  Component.require(Api),
  (props) =>
    Effect.gen(function* () {
      const api = yield* Api;
      const pending = yield* Component.state(false);
      const save = yield* Component.action((input: UserPatch) =>
        api.saveUser(props.userId, input),
      );
      return { pending, save };
    }),
  (_props, bindings) => (
    <button disabled={bindings.save.pending()}>Save</button>
  ),
);
```

## Setup Builder

For larger setup blocks, use the pipeable builder. It keeps names visible and
avoids one large generator.

```ts
const setup = Component.setup<{ readonly id: string }>()
  .bind("count", () => Component.state(0))
  .bind("user", ({ props }) =>
    Component.query(() =>
      Api.pipe(Effect.flatMap((api) => api.getUser(props.id))),
    )
  )
  .bind("save", ({ props }) =>
    Component.action((patch: UserPatch) =>
      Api.pipe(Effect.flatMap((api) => api.saveUser(props.id, patch))),
    )
  );

const UserEditor = Component.make(
  Component.props<{ readonly id: string }>(),
  Component.require(Api),
  setup,
  (_props, bindings) => <div>{bindings.count()}</div>,
);
```

Requirements from builder helpers bubble to
`Component.Requirements<typeof UserEditor>`.

## Slot Contracts

Authored slot-bearing components should publish a `View.Slots` contract.

```ts
const FieldSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  input: {
    capability: Element.Capability.TextInput,
    allowedEvents: [View.Event.Input, View.Event.Focus],
  },
});

const Field = Component.make(/* ... */).pipe(
  Component.withSlots(FieldSlots),
);
```

Useful helpers:

- `Component.withSlots(slots)` publishes the authored contract.
- `Component.SlotContractOf<T>` extracts the authored contract.
- `Component.SlotsOf<T>` extracts the runtime handle map projection.
- `Component.PublicSlotsOf<T>` and `Component.HiddenSlotsOf<T>` extract public
  and hidden slot names.

## Slot Handles In Setup

For low-level or generated components, setup can create handles directly:

```ts
const LowLevel = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  () =>
    Effect.gen(function* () {
      const root = yield* Component.slotContainer();
      const input = yield* Component.slotTextInput();
      return { slots: { root, input } };
    }),
  () => null,
);
```

This no-contract tier is useful, but published `View.Slots` are preferred for
design-system components because style and behavior attachment can be checked
against the authored contract.

## Layers And Requirements

`Component.require(...)` documents requirements, while setup usage through
`yield* ServiceTag` proves them. Providing a layer subtracts requirements:

```ts
const WithApi = UserCard.pipe(
  Component.withLayer(ApiLive),
);
```

Mount with either a layer or an existing `Atom.runtime(...)`:

```ts
Component.mount(App, {
  props: {},
  target,
  layer: Layer.mergeAll(ApiLive, Reactivity.live),
});

const runtime = Atom.runtime(Layer.mergeAll(ApiLive, Reactivity.live));
Component.mount(App, { props: {}, target, runtime });
```

Use one composition root for the app. See `docs/SERVICES_AND_LAYERS.md`.

## Component Transforms

Common transforms preserve slot and route metadata where applicable:

- `Component.withLayer(layer)`
- `Component.withLoading(render)`
- `Component.withErrorBoundary(render)`
- `Component.withRetry(policy)`
- `Component.withSpan(name)`
- `Component.tapSetup(effect)`
- `Component.withViewTransform(transform)`
- `Component.withBehavior(behavior, select, merge?)`

Style and behavior modules provide the preferred authored attachment helpers:
`Style.attachToSlots(...)` and `Behavior.attachToSlots(...)`.

## Rendering And Mounting

- `Component.setupEffect(component, props)` runs setup and returns bindings.
- `Component.renderEffect(component, props)` renders to JSX-like output.
- `Component.renderViewEffect(component, props)` renders a `View` when the
  component returns one.
- `Component.mount(component, options)` mounts and returns a disposer.

Server helpers live in `ServerRoute` and the DOM runtime:
`renderToString`, `hydrateRoot`, and document routes.

## Type Helpers

- `Component.PropsOf<T>`
- `Component.Requirements<T>`
- `Component.ErrorOf<T>`
- `Component.BindingsOf<T>`
- `Component.SlotsOf<T>`
- `Component.SlotContractOf<T>`

These helpers make wrappers, route pipes, style attachments, and tests recover
component metadata without repeating generic parameters.

## Testing

Most component behavior can be tested without a DOM:

```ts
const bindings = Effect.runSync(Component.setupEffect(UserCard, { id: "1" }));
expect(bindings.user()).toBeDefined();
```

For behavior, style, and interaction tests use `effect-atom-jsx/testing`; see
`docs/TESTING.md`.

## Related Docs

- `docs/SLOT_CONTRACT_GOLDEN_PATH.md`
- `docs/view.md`
- `docs/style.md`
- `docs/SERVICES_AND_LAYERS.md`
