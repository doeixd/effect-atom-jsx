# Component Setup Builder Plan

Status: first implementation landed.

The current component setup model is correct:

```ts
(props) => Effect.gen(function* () {
  const count = yield* Component.state(0);
  const user = yield* Component.query(() => api.loadUser(props.id));
  return { count, user };
})
```

Setup is an Effect. That gives us scoped cleanup, typed service requirements,
typed setup errors, tracing, retries, layers, and normal Effect composition.

The missing layer is ergonomics. Large setup functions become one big
`Effect.gen`, and reusable setup fragments require manual `yield*` plus object
spreads. We can improve that with a pipeable setup builder that is only a typed
authoring layer over the same setup Effect.

## Goal

Add a named, object-accumulating setup builder:

```ts
const setup = Component.setup<Props>().pipe(
  Component.bind("count", () => Component.state(0)),

  Component.bind("user", ({ props }) =>
    Component.query(() => api.loadUser(props.id))
  ),

  Component.bind("save", ({ props, bindings }) =>
    Component.action((input: SaveInput) =>
      api.saveUser(props.id, input).pipe(
        Effect.tap(() => Effect.sync(() => bindings.user.refresh?.())),
      )
    )
  ),
);

const UserCard = Component.make(
  Component.props<Props>(),
  Component.require(Api),
  setup,
  (_props, bindings) => view(bindings),
);
```

This keeps the current runtime shape:

```ts
Setup<Props, Bindings, E, R>
  ~= (props: Props) => Effect<Bindings, E, R>
```

`Component.make(...)` should accept either the current setup function or a
builder-backed setup value.

## Non-Goals

- Do not replace `Effect.gen`. Complex setup logic should still be able to use
  plain Effect code directly.
- Do not introduce an imperative `ctx` setup API again.
- Do not infer anonymous tuple bindings from `Component.state()` calls. Bindings
  should be named, stable, and readable from the view.
- Do not create a second runtime path. The builder must compile down to the same
  setup Effect contract used today.

## Core API

```ts
declare namespace Component {
  interface Setup<Props, Bindings, E, R> {
    readonly pipe: SetupPipe<this>;
    readonly effect: (props: Props) => Effect.Effect<Bindings, E, R>;
  }

  function setup<Props = {}>(): Setup<Props, {}, never, never>;

  function bind<
    const Name extends string,
    Props,
    Bindings,
    A,
    E,
    R,
  >(
    name: Name,
    f: (input: {
      readonly props: Props;
      readonly bindings: Bindings;
    }) => Effect.Effect<A, E, R>,
  ): (
    setup: Setup<Props, Bindings, any, any>,
  ) => Setup<Props, Bindings & { readonly [K in Name]: A }, E, R>;

  function value<
    const Name extends string,
    Props,
    Bindings,
    A,
  >(
    name: Name,
    f: (input: {
      readonly props: Props;
      readonly bindings: Bindings;
    }) => A,
  ): (
    setup: Setup<Props, Bindings, any, any>,
  ) => Setup<Props, Bindings & { readonly [K in Name]: A }, never, never>;

  function doEffect<Props, Bindings, E, R>(
    f: (input: {
      readonly props: Props;
      readonly bindings: Bindings;
    }) => Effect.Effect<void, E, R>,
  ): (
    setup: Setup<Props, Bindings, any, any>,
  ) => Setup<Props, Bindings, E, R>;

  function fragment<Props, Bindings, E, R>(
    setup: Setup<Props, Bindings, E, R>,
  ): typeof setup;
}
```

Names can be adjusted before implementation. In particular, `Component.value`
means "add a pure binding value during setup", while `Component.doEffect` means
"run a setup Effect without adding a binding". `Component.doEffect` avoids
colliding with the existing `Component.effect(...)` reactive setup helper.

## Type Semantics

Each setup step transforms:

```ts
Setup<Props, Bindings, E, R>
```

into:

```ts
Setup<Props, Bindings2, E | E2, R | R2>
```

Rules:

- `Props` is fixed by `Component.setup<Props>()`.
- `Bindings` accumulates by name.
- `E` accumulates setup-step errors.
- `R` accumulates setup-step service requirements.
- Existing helpers preserve their current behavior:
  - `Component.state(...)` contributes no service requirement.
  - `Component.query(...Effect<A, E, R>)` contributes `R` at setup time, but the
    returned query atom is runtime-bound.
  - `Component.action(...Effect<A, E, R>)` contributes `R` at setup time, but
    the returned action handle is runtime-bound.
  - scoped helpers such as `fromDequeue`, `schedule`, and `scheduleEffect`
    retain their `Scope.Scope` requirement.

The builder must not weaken the type axes already established on components:

```ts
Component.Requirements<typeof C>
Component.Errors<typeof C>
Component.BindingsOf<typeof C>
Component.SlotsOf<typeof C>
Component.SlotContractOf<typeof C>
```

## Binding Dependencies

Later bindings can read earlier bindings:

```ts
const setup = Component.setup<Props>().pipe(
  Component.bind("page", () => Component.state(0)),
  Component.bind("pageSize", () => Component.state(25)),
  Component.bind("query", ({ props, bindings }) =>
    Component.query(() =>
      api.listUsers({
        orgId: props.orgId,
        page: bindings.page(),
        pageSize: bindings.pageSize(),
      })
    )
  ),
);
```

This gives setup fragments the same dependency clarity as `Effect.gen`, but
without forcing every reusable fragment to manually return and spread objects.

## Reusable Fragments

Fragments should be normal setup transforms:

```ts
const withPagination = <Props>() =>
  Component.setup<Props>().pipe(
    Component.bind("page", () => Component.state(0)),
    Component.bind("pageSize", () => Component.state(25)),
    Component.bind("nextPage", ({ bindings }) =>
      Effect.succeed(() => bindings.page.update((page) => page + 1))
    ),
  );

const withSelection = <Props, T>() =>
  Component.setup<Props>().pipe(
    Component.bind("selected", () => Component.state<ReadonlySet<T>>(new Set())),
    Component.bind("toggle", ({ bindings }) =>
      Effect.succeed((item: T) =>
        bindings.selected.update((selected) => {
          const next = new Set(selected);
          next.has(item) ? next.delete(item) : next.add(item);
          return next;
        })
      )
    ),
  );

const setup = Component.setup<Props>().pipe(
  Component.use(withPagination<Props>()),
  Component.use(withSelection<Props, User>()),
  Component.bind("users", ({ props }) =>
    Component.query(() => api.listUsers(props.orgId))
  ),
);
```

`Component.use(fragment)` should merge a fragment's bindings into the current
setup when the `Props` type is compatible.

## Collision Policy

Because bindings become the public view input, accidental duplicate names should
be a type error by default.

```ts
Component.setup().pipe(
  Component.bind("count", () => Component.state(0)),
  Component.bind("count", () => Component.state(1)), // type error
);
```

If replacement is useful, add an explicit helper later:

```ts
Component.replace("count", () => Component.state(1))
```

The first implementation should prefer the stricter default.

## Interop With Component.make

`Component.make(...)` should accept:

```ts
(props: Props) => Effect.Effect<Bindings, E, R>
```

and:

```ts
Component.Setup<Props, Bindings, E, R>
```

The internal component still stores:

```ts
setup: (props: Props) => Effect.Effect<Bindings, E, R>
```

This keeps all existing wrapper code valid:

- `Component.withLayer(...)`
- `Component.withErrorBoundary(...)`
- `Component.withLoading(...)`
- `Component.tapSetup(...)`
- `Component.withPreSetup(...)`
- `Component.withSetupRetry(...)`
- `Component.withSetupTimeout(...)`
- route-node integration
- slot-contract preservation

## Relationship To Component Pipe

There are two pipe levels:

```ts
Component.setup<Props>().pipe(...)
```

builds the component's local bindings.

```ts
UserCard.pipe(Component.withLayer(ApiLive), Component.withLoading(...))
```

transforms the finished component.

This split is good. Setup pipe is about creating bindings. Component pipe is
about wrapping component behavior, requirements, errors, layers, diagnostics,
styles, behaviors, and route metadata.

## Example: Async Auto Counter

```ts
const CounterSetup = Component.setup<{}>().pipe(
  Component.bind("count", () => Component.state(0)),
  Component.bind("step", () => Component.state(1)),
  Component.bind("isAutoCounting", () => Component.state(false)),

  Component.bind("increment", ({ bindings }) =>
    Effect.succeed(() =>
      bindings.count.update((count) => count + bindings.step())
    )
  ),

  Component.doEffect(({ bindings }) =>
    Component.effect(() => {
      if (!bindings.isAutoCounting()) return;
      const id = setInterval(() => {
        bindings.count.update((count) => count + bindings.step());
      }, 1000);
      return () => clearInterval(id);
    })
  ),
);
```

The interval reads live typed bindings, so there is no React-style stale closure
or ref synchronization ceremony. The setup builder just makes the binding
surface easier to assemble.

## Example: Service-Backed Query And Action

```ts
const UserSetup = Component.setup<{ readonly id: string }>().pipe(
  Component.bind("user", ({ props }) =>
    Component.query(() => Api.loadUser(props.id))
  ),

  Component.bind("save", ({ props }) =>
    Component.action((input: SaveUserInput) =>
      Api.saveUser(props.id, input)
    )
  ),
);

const UserCard = Component.make(
  Component.props<{ readonly id: string }>(),
  Component.require(Api),
  UserSetup,
  (_props, { user, save }) => /* view */,
);
```

`Api` remains a component requirement. The returned query/action handles are
bound to the setup service map and can run later from refreshes or user events.

## Implementation Plan

1. [x] Add `Component.Setup<Props, Bindings, E, R>` as a lightweight branded object.
2. [x] Implement `Component.setup<Props>()`.
3. [x] Implement `Component.bind(...)` with object accumulation and duplicate-name
   rejection.
4. [x] Implement `Component.use(...)` for fragment composition.
5. [x] Implement `Component.value(...)` or equivalent pure binding helper.
6. [x] Implement `Component.doEffect(...)` for setup effects that do not add a
   binding.
7. [x] Teach `Component.make(...)` and `Component.headless(...)` to accept either a
   setup function or `Component.Setup`.
8. [x] Add type tests for:
   - binding accumulation
   - duplicate-name rejection
   - props access
   - earlier-binding access
   - requirement and error accumulation
   - query/action requirement bubbling with runtime-bound returned handles
   - fragment composition
   - component wrapper preservation
9. [x] Add runtime tests for:
   - step execution order
   - produced bindings
   - setup failure propagation
   - scoped cleanup through existing helpers
10. [x] Update first examples and docs to prefer setup builders where they
    improve readability:
    - `examples/auto-counter/App.tsx`
    - `docs/ASYNC_COUNTER_OPTIMISTIC_EXAMPLE.md`
    - `docs/SLOT_CONTRACT_GOLDEN_PATH.md`
11. [ ] Continue the broader guide cleanup pass across older exploratory docs.

## Design Judgment

This is worth doing if it stays small. The builder should make the common path
more legible:

- named bindings
- reusable setup fragments
- predictable type accumulation
- no manual object spread
- no revived `ctx` object
- no new runtime semantics

If the builder starts competing with Effect itself, it is too large. The right
design is a focused authoring convenience over the setup Effect we already have.
