# Bindings As The Async Commit Boundary

This document explains why `Bindings` are more than a convenient setup return
value. In AF-UI, bindings should become the component-level boundary between
async work and committed UI.

Related docs:

- [`PROPS_BINDINGS_SLOTS.md`](PROPS_BINDINGS_SLOTS.md)
- [`AF_UI_CONTRACT.md`](AF_UI_CONTRACT.md)
- [`RUNTIME_ROUTING_REACTIVITY_SYSTEM.md`](RUNTIME_ROUTING_REACTIVITY_SYSTEM.md)

## Problem

UI wants to be a consistent snapshot:

```text
same inputs -> same view
```

Async work makes this hard. A value may be loading, stale, failed, superseded,
or available. If those states leak into every downstream computation, the graph
stops being deterministic. Every consumer has to branch:

```ts
const firstInitial = user.loading ? "" : user.name[0];
```

That branching is not just annoying. It means derived computations and side
effects may observe values from different moments in time.

The invariant AF-UI should honor is:

```text
Async work must not leak speculative values into a committed view/effect graph.
```

## Two Async Invariants

### 1. Async Must Be Isolated From Commits

If a derived value is still waiting on async work, any UI that depends on it is
not ready to commit.

For example:

```ts
count = 2;
doubleCount = await computeDouble(count);
```

If the UI still shows `1 * 2 = 2` while event handlers already read `count = 2`,
the visible UI and the interactive data model have drifted. The user interacts
with one snapshot while code observes another.

The safe rule is:

```text
Commit the new snapshot only after the async dependencies needed for that
snapshot are ready.
```

### 2. Effects Need Dependencies Before They Run

Side effects cannot safely discover async dependencies while executing the
effect body. If the body suspends, retries, or is interrupted, it becomes
unclear how many times the effect ran and what values it observed.

Unsafe shape:

```ts
effect(() => {
  console.log(a());
  console.log(b());
  console.log(c());
});
```

If `a`, `b`, or `c` can suspend or update independently, the effect body may run
against partial or speculative state.

Safe shape:

```ts
effect(
  () => [a(), b(), c()],
  ([a, b, c]) => {
    console.log(a);
    console.log(b);
    console.log(c);
  },
);
```

The dependency collection phase is separate from the side-effect phase.

AF-UI should apply the same idea at the component level:

```text
collect/resolve setup dependencies -> produce bindings -> render/attach effects
```

## Where Bindings Fit

The component shape is:

```ts
Component<Props, Req, E, Bindings, SlotContract>
```

Conceptually:

```text
Props -> setup Effect -> committed Bindings -> View -> Style/Behavior effects
```

`setup` is the phase where the component gathers services, creates atoms,
starts or reads async work, constructs actions, and prepares the values the view
needs.

`Bindings` are the result of that phase.

The view renders from `Props + Bindings`:

```ts
setup: (props) => Effect.Effect<Bindings, E, Req>
view: (props, bindings) => View<Slots>
```

That gives AF-UI a natural commit boundary:

```text
No bindings, no committed view.
```

If setup is waiting, the component can suspend, render a fallback, or expose an
explicit `Result` model. But the normal committed view should not be asked to
render from half-real async state.

## Bindings Are A Snapshot

Bindings should be treated as the stable snapshot produced by setup.

```ts
type UserBindings = {
  readonly user: User;
  readonly permissions: Permissions;
  readonly save: ActionHandle<[Patch], User, SaveError>;
};
```

The view can now render without branching over loading wrappers:

```ts
const UserPanel = Component.make(
  Component.props<{ readonly id: string }>(),
  Component.require<Api>(),
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const user = yield* api.user(props.id);
    const permissions = yield* api.permissions(props.id);
    return { user, permissions };
  }),
  (_props, bindings) =>
    View.fromSlots(UserPanelSlots, null, {
      tree: View.element(Root, {
        children: [
          View.textNode(bindings.user.name),
        ],
      }),
    }),
);
```

The component either has a coherent `{ user, permissions }` binding snapshot or
it does not commit that normal view.

## Explicit Async UI Is Still Allowed

Not every component should suspend until all data is available. Loading states,
skeletons, stale-while-revalidate displays, optimistic UI, and error recovery
are real product needs.

The distinction is where that async state lives.

If async state is part of the UI contract, model it explicitly:

```ts
type UserBindings = {
  readonly user: Atom.ReadonlyAtom<Result<User, UserError>, UserError>;
};
```

Then the view intentionally renders a `Result`:

```ts
Result.match(bindings.user(), {
  initial: () => Loading(...),
  success: (user) => UserView(user),
  failure: (error) => ErrorView(error),
});
```

This is different from accidentally leaking loading wrappers through every
derived computation. Explicit async UI is a presentation choice. Speculative
values leaking into the graph are a correctness problem.

## Why This Is Better Than Render-Time Async Reads

Avoid this shape as the primary model:

```ts
view: () => {
  const user = userQuery(); // may be loading/suspended/stale
  return View.textNode(user.name);
}
```

When async reads happen during render, the framework may discover dependencies
too late:

- the render may already have performed reads with partial state
- side effects may have already been scheduled
- retries may run different code paths
- downstream consumers may need to branch on loading wrappers

The setup/bindings split gives the runtime a place to collect and resolve the
component's async dependencies before the view commit.

## Requirement And Error Types

Bindings also make dependencies visible in the type system:

```ts
Effect.Effect<Bindings, E, Req>
```

The component carries that metadata:

```ts
Component<Props, Req, E, Bindings, SlotContract>
```

This means:

- required services bubble into `Req`
- setup failures bubble into `E`
- wrappers can provide layers and remove requirements
- route loaders, behaviors, and styles can add requirements/errors explicitly

The async dependency graph is not hidden inside arbitrary render-time reads. It
is expressed as an Effect program.

## Effect Splitting

Bindings help separate pure view construction from side effects.

Recommended phase order:

```text
1. setup Effect runs and produces bindings
2. view builds a View from props + bindings
3. style attachments apply to declared slots
4. behavior effects attach after the view/slot snapshot exists
5. cleanup is scoped to the component lifetime
```

Behaviors are explicitly effectful:

```ts
Behavior.forSlots(FieldSlots)((elements) =>
  Effect.gen(function* () {
    yield* elements.input.on("input", ...);
    return {};
  }),
);
```

They should attach after the slot snapshot is known, not while dependency
collection is still speculative.

## Benefits

### Consistent UI Snapshots

The normal view renders from committed bindings, not from arbitrary in-flight
values. That keeps the visible UI and event handlers aligned around the same
state.

### Fewer Loading Branches

Async does not have to infect every derived computation. Components can choose
where loading/error presentation belongs instead of forcing every consumer to
handle wrapper states.

### Typed Dependency Boundaries

Setup dependencies are expressed through `Effect.Effect<Bindings, E, Req>`.
The component type records those requirements and errors.

### Cleaner Effects

Effects attach after dependency collection and view construction. This matches
the invariant that effect dependencies must be known before effect execution.

### Better Composition

Styles and behaviors operate over slots after the component has a coherent
view/slot snapshot. They do not need to know private setup details or render-time
async branches.

### Easier Runtime Diagnostics

The runtime can compare:

- declared slot contract
- produced bindings
- rendered view
- attached styles/behaviors

That is much harder when all state is discovered ad hoc from props or render
reads.

## What Bindings Do Not Solve Alone

Bindings are the right boundary, but they are not the entire async model.

AF-UI still needs runtime policies for:

- suspension vs explicit `Result` rendering
- stale-while-revalidate
- optimistic updates
- supersession and cancellation
- loader hydration
- behavior cleanup
- effect scheduling
- declared-vs-rendered diagnostics

Bindings provide the place where those policies become coherent for a
component.

## Design Rules

- Treat `setup` as dependency collection and resource creation.
- Treat `Bindings` as the committed setup snapshot.
- Do not let normal views depend on accidental half-real async values.
- Use explicit `Result` bindings when loading/error UI is part of the product
  experience.
- Run behavior/style effects after the view and slot snapshot exists.
- Bubble setup requirements and errors through `Req` and `E`.
- Keep props as caller configuration, not async dependency plumbing.
- Keep slots as structural attachment points, not setup state.
