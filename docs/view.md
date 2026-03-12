You're onto something important. The view function is where type safety currently breaks. The setup is an Effect with full `R` and `E` tracking. But the view is a plain function that returns JSX, and the moment you render a child component inside that JSX, the child's requirements and errors become invisible.

**The problem concretely:**

```tsx
// Setup correctly tracks R and E
(props) => Effect.gen(function* () {
  const api = yield* Api;
  const users = yield* Component.query(() => api.listUsers());
  return { users };
}),

// View is a plain function — type safety ends here
(props, { users }) => (
  <div>
    {/* UserCard requires Auth — but nothing tracks this */}
    <UserCard id="1" />
    {/* ErrorPanel requires Logger — invisible */}
    <ErrorPanel />
    {/* This expression reads users() — what if it's a Result with errors? */}
    <Async result={users()} success={(xs) => (
      {/* For each user, render a child that requires Permissions — invisible */}
      <For each={xs}>{(u) => <UserRow user={u()} />}</For>
    )} />
  </div>
),
```

Every child component rendered in the view might have requirements and errors. The view function's return type is `JSX.Element` — a black box that erases everything.

**The view should be an Effect that yields its template structure.**

Instead of a function that returns JSX directly, the view is an Effect that yields template nodes. Each child component rendered is a `yield*` that composes its requirements and errors into the parent:

```tsx
const UserList = Component.make(
  Component.props<{}>(),
  Component.require(Api),

  // Setup — same as before
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const users = yield* Component.query(() => api.listUsers());
    return { users };
  }),

  // View is an Effect
  (props, { users }) => View.gen(function* () {
    // yield* a child component — its Req and E compose into this view's type
    const header = yield* View.child(Header, { title: "Users" });

    // yield* an async boundary — tracks the Result's error type
    const list = yield* View.async(users(), {
      loading: () => View.text("Loading..."),
      success: (xs) => View.gen(function* () {
        // yield* each child in a loop — requirements accumulate
        const rows = yield* View.each(xs, (user) =>
          View.child(UserRow, { user })
        );
        return View.el("ul", {}, rows);
      }),
      error: (e) => View.gen(function* () {
        // e is HttpError — typed from the query
        return View.el("p", { class: "error" }, [View.text(e.message)]);
      }),
    });

    return View.el("div", { class: "user-list" }, [header, list]);
  }),
);
```

The type of the view Effect accumulates requirements and errors from every yielded child:

```ts
// View type:
View.Effect
  ViewNode,
  HttpError,              // E from users() Result + children
  Api | Auth | Permissions // R from this component + Header + UserRow
>
```

But this is verbose. Nobody wants to write `View.el("div", {}, [...])` instead of JSX. The key insight is that JSX compilation should produce `yield*` calls.

**JSX compiles to yields:**

```tsx
// What you write (JSX)
(props, { users }) => (
  <div class="user-list">
    <Header title="Users" />
    <Async
      result={users()}
      loading={() => <p>Loading...</p>}
      success={(xs) => (
        <ul>
          <For each={xs}>{(u) => <UserRow user={u()} />}</For>
        </ul>
      )}
    />
  </div>
)

// What the compiler produces
(props, { users }) => View.gen(function* () {
  const _header = yield* View.child(Header, { title: "Users" });

  const _async = yield* View.async(users(), {
    loading: () => View.gen(function* () {
      return yield* View.intrinsic("p", {}, [View.text("Loading...")]);
    }),
    success: (xs) => View.gen(function* () {
      const _list = yield* View.each(xs, (u) => View.gen(function* () {
        return yield* View.child(UserRow, { user: u() });
      }));
      return yield* View.intrinsic("ul", {}, _list);
    }),
  });

  return yield* View.intrinsic("div", { class: "user-list" }, [_header, _async]);
})
```

The Babel plugin transforms JSX into `View.gen` + `yield*` calls. Every component child is `yield* View.child(...)`. Every intrinsic element is `yield* View.intrinsic(...)`. Every template hole with a reactive expression is `yield* View.reactive(...)`.

The critical part: `View.child(Header, { title: "Users" })` returns a `View.Effect` whose `R` includes Header's requirements and whose `E` includes Header's errors. Because it's yielded, those types flow into the parent view's `R` and `E`.

**The View Effect type:**

```ts
declare namespace View {
  // The view effect — like Effect<A, E, R> but for template nodes
  interface ViewEffect<Node, E, R> extends Effect.Effect<Node, E, R | Renderer | Scope> {
    readonly [ViewEffectTypeId]: unique symbol;
  }

  // Create an intrinsic element (div, p, span, etc.)
  function intrinsic(
    tag: string,
    props: Record<string, unknown>,
    children: ViewNode[],
  ): ViewEffect<ViewNode, never, Renderer>;

  // Render a child component — requirements and errors flow through
  function child<P, R, E>(
    component: Component<P, R, E>,
    props: P,
  ): ViewEffect<ViewNode, E, R | Renderer>;

  // Reactive text hole — tracks the expression
  function reactive<A>(
    expr: () => A,
  ): ViewEffect<ViewNode, never, Renderer>;

  // Iterate over a list — each item's view requirements accumulate
  function each<A, E, R>(
    items: readonly A[],
    render: (item: A) => ViewEffect<ViewNode, E, R>,
  ): ViewEffect<ViewNode[], E, R>;

  // Async boundary — tracks Result error type
  function async<A, E>(
    result: Result<A, E>,
    handlers: {
      loading: () => ViewEffect<ViewNode, never, Renderer>;
      success: (value: A) => ViewEffect<ViewNode, any, any>;
      error?: (error: E) => ViewEffect<ViewNode, never, Renderer>;
      defect?: (cause: Cause<never>) => ViewEffect<ViewNode, never, Renderer>;
    },
  ): ViewEffect<ViewNode, E, Renderer>;  // E is consumed if error handler provided

  // Conditional rendering
  function when<A, E, R>(
    condition: () => A | false | null | undefined,
    render: (value: A) => ViewEffect<ViewNode, E, R>,
    fallback?: () => ViewEffect<ViewNode, any, any>,
  ): ViewEffect<ViewNode, E, R>;

  // View generator (like Effect.gen for views)
  function gen<Eff extends ViewEffect<any, any, any>>(
    body: () => Generator<Eff, ViewNode, any>,
  ): ViewEffect<ViewNode, Effect.Error<Eff>, Effect.Context<Eff>>;

  // Plain text
  function text(content: string): ViewEffect<ViewNode, never, Renderer>;

  // Empty node
  const empty: ViewEffect<ViewNode, never, Renderer>;
}
```

**How R accumulates through the view tree:**

```tsx
// Header requires nothing extra
const Header = Component.make(
  Component.props<{ title: string }>(),
  Component.require(),
  (props) => Effect.succeed({ title: props.title }),
  (props, { title }) => <h1>{title}</h1>,
);
// Header's view: ViewEffect<ViewNode, never, Renderer>

// UserRow requires Permissions
const UserRow = Component.make(
  Component.props<{ user: User }>(),
  Component.require(Permissions),
  (props) => Effect.gen(function* () {
    const perms = yield* Permissions;
    const canDelete = yield* Component.derived(() => perms.canDelete(props.user.id));
    return { canDelete };
  }),
  (props, { canDelete }) => (
    <li>
      {props.user.name}
      <Show when={canDelete()}>
        <button>Delete</button>
      </Show>
    </li>
  ),
);
// UserRow's view: ViewEffect<ViewNode, never, Renderer | Permissions>

// UserList renders both
const UserList = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const users = yield* Component.query(() => api.listUsers());
    return { users };
  }),
  // View: the compiler sees Header (Req: nothing) and UserRow (Req: Permissions)
  // The view's R becomes Renderer | Permissions
  (props, { users }) => (
    <div>
      <Header title="Users" />
      <Async result={users()} success={(xs) => (
        <For each={xs}>{(u) => <UserRow user={u()} />}</For>
      )} />
    </div>
  ),
);

// UserList's total requirements:
// Setup Req: Api
// View Req: Permissions (from UserRow)
// Combined Req: Api | Permissions
// If you mount without Permissions, compiler error
```

The compiler traces the requirement chain: `UserList` renders `UserRow`, `UserRow` requires `Permissions`, so `UserList` requires `Permissions`. This is exactly how `yield*` composition works in Effect — requirements accumulate through the generator.

**How E accumulates through the view tree:**

```tsx
// DeleteButton can fail with PermissionDenied
const DeleteButton = Component.make(
  Component.props<{ userId: string }>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const del = yield* Component.action(
      Effect.fn(function* () {
        yield* api.deleteUser(props.userId);
        // This can fail with PermissionDenied
      }),
    );
    return { del };
  }),
  (props, { del }) => <button onClick={() => del()}>Delete</button>,
);
// DeleteButton's E: PermissionDenied

// UserRow renders DeleteButton
const UserRow = Component.make(
  Component.props<{ user: User }>(),
  Component.require(),
  (props) => Effect.succeed({}),
  (props) => (
    <li>
      {props.user.name}
      {/* DeleteButton's E (PermissionDenied) flows into UserRow's E */}
      <DeleteButton userId={props.user.id} />
    </li>
  ),
);
// UserRow's E: PermissionDenied (from DeleteButton)

// UserList renders UserRow
const UserList = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const users = yield* Component.query(() => api.listUsers());
    // Query can fail with HttpError
    return { users };
  }),
  (props, { users }) => (
    <div>
      <Async result={users()} success={(xs) => (
        <For each={xs}>{(u) => <UserRow user={u()} />}</For>
      )} />
    </div>
  ),
);
// UserList's E: HttpError (from query) | PermissionDenied (from UserRow -> DeleteButton)
```

Errors bubble up through the component tree the same way they do in Effect pipelines. If UserList adds an error boundary that handles `PermissionDenied`, it's removed from the type:

```tsx
const SafeUserList = UserList.pipe(
  Component.withErrorBoundary({
    PermissionDenied: (e) => <p>Not allowed: {e.message}</p>,
  }),
);
// SafeUserList's E: HttpError (PermissionDenied was handled)
```

**Reactive holes — template expressions as yields:**

The holes in a template where reactive expressions go should also be yields. This ensures the reactive tracking is explicit and the types flow through:

```tsx
// JSX with reactive expressions
<p>Count: {count()} (doubled: {doubled()})</p>

// Compiles to
View.gen(function* () {
  const _text1 = View.text("Count: ");
  const _expr1 = yield* View.reactive(() => count());
  const _text2 = View.text(" (doubled: ");
  const _expr2 = yield* View.reactive(() => doubled());
  const _text3 = View.text(")");
  return yield* View.intrinsic("p", {}, [_text1, _expr1, _text2, _expr2, _text3]);
})
```

`View.reactive(() => count())` creates a tracked reactive binding. The Renderer service subscribes to changes and updates the node. Because it's yielded, the scope tracks it and cleanup is automatic.

But more importantly, if the reactive expression reads an atom that carries an error type, that error flows through:

```tsx
// users() returns Result<User[], HttpError>
// Reading it in a template hole means HttpError is in the view's E
<p>Total: {Result.getOrElse(users(), () => []).length}</p>

// Compiles to
const _expr = yield* View.reactive(() =>
  Result.getOrElse(users(), () => []).length
);
// View.reactive infers: if the expression can produce errors, E includes them
```

**Props as yields — typed prop validation:**

When passing props to a child component, the prop types should be checked at the yield point:

```tsx
// UserRow expects { user: User }
<UserRow user={someValue} />

// Compiles to
yield* View.child(UserRow, { user: someValue });
// TypeScript checks: is someValue assignable to User?
// If not, compile error right here in the parent's view
```

This already works with plain JSX + TypeScript, but making it a `yield*` means the check happens in the context of an Effect generator, which means the error location is precise and the types compose.

**Children as yields — slot type safety:**

Children passed to a component are also yields. This ensures the parent's template knows what requirements the children bring:

```tsx
// Layout expects children
const Layout = Component.make(
  Component.props<{ children: View.Children }>(),
  Component.require(),
  (props) => Effect.succeed({}),
  (props) => (
    <div class="layout">
      <header>Header</header>
      <main>{props.children}</main>
    </div>
  ),
);

// Parent passes children — children's Req flows into Layout's usage site
<Layout>
  <UserList />  {/* Req: Api | Permissions */}
  <Sidebar />   {/* Req: Auth */}
</Layout>

// Compiles to
yield* View.child(Layout, {
  children: yield* View.fragment([
    yield* View.child(UserList, {}),   // Req: Api | Permissions
    yield* View.child(Sidebar, {}),    // Req: Auth
  ]),
});
// Total Req at this point: Api | Permissions | Auth
```

The children's requirements bubble up through the `yield*` chain. The parent that renders `<Layout>` needs to provide (or propagate) `Api | Permissions | Auth`.

**Headless component render functions as yields:**

This is where it gets powerful for headless components. The render function that the consumer provides is a `View.Effect`:

```tsx
const Combobox = Component.headless(
  Component.props<{ items: string[]; onSelect: (item: string) => void }>(),
  Component.require(),
  (props) => Effect.gen(function* () {
    const query = yield* Component.state("");
    const isOpen = yield* Component.state(false);
    const filtered = yield* Component.derived(() =>
      props.items.filter((i) => i.includes(query()))
    );
    return { query, isOpen, filtered };
  }),
);

// Consumer provides a render function — it's a ViewEffect
<Combobox items={["a", "b", "c"]} onSelect={console.log}>
  {(bindings) => (
    <div>
      <SearchInput value={bindings.query()} />  {/* Req: SearchService */}
      <ResultsList items={bindings.filtered()} /> {/* Req: Renderer */}
    </div>
  )}
</Combobox>

// The render function's type:
// (bindings: ComboboxBindings) => ViewEffect<ViewNode, SearchError, SearchService | Renderer>

// Compiles to
yield* View.headless(Combobox, { items: ["a", "b", "c"], onSelect: console.log },
  (bindings) => View.gen(function* () {
    const _search = yield* View.child(SearchInput, { value: bindings.query() });
    const _results = yield* View.child(ResultsList, { items: bindings.filtered() });
    return yield* View.intrinsic("div", {}, [_search, _results]);
  })
);
// Requirements from the render function flow up: SearchService
// Errors from the render function flow up: SearchError
```

The headless component's behavior is requirement-free (or has its own requirements). The consumer's render function brings its own requirements and errors. Both compose at the `yield*` point. The parent knows the total requirements of the headless component usage site.

**The complete type chain:**

```
Component<Props, Req, E>
  │
  ├── Setup: Effect<Bindings, SetupE, SetupR | Scope>
  │     R accumulates from: yield* services
  │     E accumulates from: query/action effects
  │
  └── View: ViewEffect<ViewNode, ViewE, ViewR | Renderer>
        R accumulates from: yield* View.child(ChildComponent)
        E accumulates from: yield* View.child(ChildComponent)
                            yield* View.async(result)
                            yield* View.reactive(expression)

  Total R = SetupR | ViewR
  Total E = SetupE | ViewE

  Component.withLayer(layer)         → eliminates from R
  Component.withErrorBoundary(...)   → eliminates from E
```

Everything composes. Requirements from setup and view merge. Errors from setup and view merge. Layers eliminate requirements. Boundaries eliminate errors. The types tell you exactly what's needed and what can go wrong at every point in the tree.

**Event handlers as yields:**

Event handlers in templates also need attention. An `onClick` handler might trigger an action that can fail:

```tsx
<button onClick={() => deleteUser(userId)}>Delete</button>
```

If `deleteUser` is an action with error type `PermissionDenied`, does that error flow into the view's E? It should, because the action's failure needs to be handled somewhere.

```tsx
// Compiles to
yield* View.intrinsic("button", {
  onClick: yield* View.handler(() => deleteUser(userId)),
  // View.handler captures the action's error type
}, [View.text("Delete")]);
```

`View.handler` wraps the callback and captures its error type. If the handler calls an action that can fail with `PermissionDenied`, the view's `E` includes `PermissionDenied`. The error either gets handled by a local boundary or propagates to the parent.

But there's a subtlety: event handlers run asynchronously, after the view has already rendered. The error doesn't prevent rendering — it occurs later when the user interacts. So event handler errors should flow into E (so boundaries can catch them) but shouldn't block the view's initial render.

The mechanism: event handlers yield their error types into the view's E channel, but the errors are routed through the component's error PubSub at runtime rather than thrown during rendering:

```ts
function handler<E>(
  fn: () => Effect.Effect<void, E>,
): ViewEffect<EventHandler, E, Renderer> {
  return View.effect(Effect.gen(function* () {
    const errorChannel = yield* ComponentErrorChannel;
    return (...args: any[]) => {
      fn().pipe(
        Effect.catchAllCause((cause) =>
          PubSub.publish(errorChannel, cause)
        ),
        Effect.runFork,
      );
    };
  }));
}
```

**Ref attachments as yields:**

DOM refs also need to flow through the yield system to ensure they're scoped:

```tsx
(props, { canvasRef }) => View.gen(function* () {
  // Yielding the ref attachment ensures it's tracked in the scope
  return yield* View.intrinsic("canvas", {
    ref: yield* View.ref(canvasRef),
    width: 800,
    height: 600,
  }, []);
})
```

`View.ref(canvasRef)` attaches the ref to the rendered node and registers cleanup in the component's scope. When the component unmounts, the ref is cleared. Because it's yielded, the scope tracks it.

**Conditional branches as yields:**

```tsx
// Show/when is a yield that may or may not render its children
<Show when={isAdmin()}>
  <AdminPanel />  {/* Req: AdminService */}
</Show>

// Compiles to
yield* View.when(
  () => isAdmin(),
  () => View.gen(function* () {
    return yield* View.child(AdminPanel, {});
  }),
);
```

This raises a type question: if `AdminPanel` requires `AdminService`, but it's conditionally rendered, does the parent always need `AdminService`? Yes — because the component might render it. The requirements are static (compile-time), not dynamic (runtime). Even if `isAdmin()` is false, the component tree's type must include `AdminService` because the branch exists in the code.

This matches Effect's model — if you have `Effect.if(condition, { onTrue: needsDb, onFalse: needsCache })`, the resulting Effect requires both `Db` and `Cache` regardless of the runtime condition.

**The compiler plugin:**

The JSX compiler would need to be redesigned. Instead of producing direct DOM calls (dom-expressions) or createElement calls (React), it produces `View.gen` + `yield*` calls:

```tsx
// Input
function MyView(props, bindings) {
  return (
    <div class="card">
      <h1>{bindings.title()}</h1>
      <UserAvatar user={bindings.user} />
      <Show when={bindings.canEdit()}>
        <EditForm user={bindings.user} />
      </Show>
      <button onClick={() => bindings.save()}>Save</button>
    </div>
  );
}

// Output
function MyView(props, bindings) {
  return View.gen(function* () {
    const _title = yield* View.reactive(() => bindings.title());
    const _h1 = yield* View.intrinsic("h1", {}, [_title]);

    const _avatar = yield* View.child(UserAvatar, { user: bindings.user });

    const _edit = yield* View.when(
      () => bindings.canEdit(),
      () => View.child(EditForm, { user: bindings.user }),
    );

    const _saveHandler = yield* View.handler(() => bindings.save());
    const _button = yield* View.intrinsic("button", { onClick: _saveHandler }, [
      View.text("Save"),
    ]);

    return yield* View.intrinsic("div", { class: "card" }, [
      _h1, _avatar, _edit, _button,
    ]);
  });
}
```

The type of this view:

```ts
ViewEffect
  ViewNode,
  UserAvatarE | EditFormE | SaveActionE,  // errors from children + handlers
  UserAvatarR | EditFormR | Renderer       // requirements from children
>
```

Every child, every handler, every conditional branch contributes to the view's requirements and error types. The compiler ensures nothing is lost.

**The performance question:**

Yielding every template node sounds expensive. Effect generators have overhead. For a list of 1000 items, yielding each row's view would be slow.

The solution: the `View.gen` output is compiled ahead of time, not interpreted at runtime. The Babel plugin produces the generator code, but the framework's reconciler can optimize it. Intrinsic elements (`div`, `p`, `span`) don't actually need to go through the full Effect runtime — they can be fast-pathed:

```ts
// Fast path for intrinsic elements — direct renderer calls, no Effect overhead
View.intrinsic = (tag, props, children) => {
  // At compile time, this is known to be Renderer-only with no errors
  // The framework can skip the Effect machinery and call renderer directly
  return View.fastIntrinsic(tag, props, children);
};

// Full Effect path only for component children and handlers
View.child = (component, props) => {
  // This needs full Effect resolution — component has Req and E
  return View.effectChild(component, props);
};
```

The framework can distinguish between "nodes that need full Effect resolution" (component children, error boundaries, async boundaries) and "nodes that are just DOM" (intrinsic elements, text). The latter go through a fast path that's comparable to dom-expressions' current performance.

For lists, `View.each` can batch the yields:

```ts
View.each = (items, render) => {
  // Don't yield each item individually in the Effect runtime
  // Instead, create a reactive list binding that the renderer manages
  return View.reactiveList(items, render);
};
```

The renderer handles list reconciliation internally (keyed diffing, etc.) without yielding each item through the Effect generator. The type system still captures the list item's requirements and errors from the `render` function's signature, but the runtime doesn't pay per-item Effect overhead.

**What the developer actually writes vs what the compiler produces:**

The developer writes normal JSX. They never see `View.gen` or `yield*`. The Babel plugin handles the transformation:

```tsx
// What you write — looks exactly like current JSX
const UserList = Component.make(
  Component.props<{}>(),
  Component.require(Api),

  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const users = yield* Component.query(() => api.listUsers());
    return { users };
  }),

  // This looks like a normal view function
  (props, { users }) => (
    <div class="user-list">
      <Header title="Users" />
      <Async
        result={users()}
        loading={() => <p>Loading...</p>}
        success={(xs) => (
          <ul>
            <For each={xs}>{(u) => <UserRow user={u()} />}</For>
          </ul>
        )}
      />
    </div>
  ),
);
```

The Babel plugin compiles the view function into `View.gen` + `yield*` calls. TypeScript's type checker sees the compiled output and infers the full `R` and `E` from the yields. The developer gets full type safety from normal-looking JSX.

The developer's only indication that this is happening is the compiler errors they get when requirements are missing:

```
Error: Type 'Component<{}, Api, HttpError>' is not assignable to
  mount parameter. Requirements 'Api | Permissions' not satisfied
  by layer providing 'Api'.
  Missing: 'Permissions' (required by UserRow, rendered in UserList view)
```

The error message traces through the component tree: `Permissions` is required by `UserRow`, which is rendered in `UserList`'s view, and the mount layer doesn't provide it.

**The full picture:**

```
Developer writes:
  JSX that looks normal

Compiler produces:
  View.gen with yield* for each child, handler, expression, ref, conditional

Type checker sees:
  ViewEffect<ViewNode, E₁ | E₂ | ..., R₁ | R₂ | ... | Renderer>
  where each Eᵢ and Rᵢ comes from a yielded child/handler

At mount time:
  Component.mount(App, { layer, target })
  TypeScript verifies: layer output ⊇ App's total R (setup R ∪ view R)
  If not: compile error listing exactly which services are missing

At runtime:
  Intrinsic elements → fast path (direct renderer calls)
  Component children → full Effect resolution (scope, services, errors)
  Event handlers → fire-and-forget fibers with error routing
  Reactive expressions → tracked subscriptions with scope cleanup
```

The view function stays ergonomic — you write JSX. The compiler makes it type-safe — every child, handler, and expression is tracked. The runtime stays fast — intrinsic elements skip the Effect machinery. And the entire component tree's requirements and errors are visible in the type system, from leaf components all the way up to the mount call.Yes. Right now every template hole is just "expression that returns something" and the renderer figures out what to do with it at runtime. But the compiler knows where each hole is — it knows if an expression is in attribute position, class position, style position, text content, event handler, child position, etc. If each position compiles to a differently-typed yield, the type system can enforce constraints per-position.

**The hole taxonomy:**

Every expression in a JSX template occupies a specific syntactic position. The compiler can classify each one:

```tsx
<div
  class={/* ClassHole */}
  style={/* StyleHole */}
  id={/* AttributeHole<string> */}
  data-count={/* AttributeHole<string | number> */}
  aria-label={/* AriaHole */}
  onClick={/* HandlerHole<MouseEvent> */}
  ref={/* RefHole<HTMLDivElement> */}
>
  {/* ChildHole */}
  <p title={/* AttributeHole<string> */}>
    {/* TextHole */}
  </p>
</div>
```

Each hole type has distinct constraints. A `ClassHole` accepts strings, arrays, objects, or reactive accessors thereof. A `HandlerHole<MouseEvent>` only accepts functions with the right event type. A `TextHole` accepts strings and numbers but not objects or JSX elements. A `ChildHole` accepts JSX elements, strings, numbers, arrays, and null.

**The View.Hole types:**

```ts
declare namespace View {
  // Text content — only string/number/boolean, rendered as text node
  interface TextHole {
    readonly _tag: "TextHole";
    accept: string | number | boolean | (() => string | number | boolean);
  }

  // Child position — elements, text, fragments, null, arrays
  interface ChildHole {
    readonly _tag: "ChildHole";
    accept:
      | ViewNode
      | string
      | number
      | boolean
      | null
      | undefined
      | readonly ChildHole["accept"][]
      | (() => ChildHole["accept"]);
  }

  // Class attribute — string, array, object with boolean values, or combinations
  interface ClassHole {
    readonly _tag: "ClassHole";
    accept:
      | string
      | readonly string[]
      | Record<string, boolean | (() => boolean)>
      | readonly (string | Record<string, boolean | (() => boolean)>)[]
      | (() => ClassHole["accept"]);
  }

  // Style attribute — typed CSS properties
  interface StyleHole {
    readonly _tag: "StyleHole";
    accept:
      | Partial<CSSStyleDeclaration>
      | string
      | (() => Partial<CSSStyleDeclaration> | string);
  }

  // Event handler — typed by event name
  interface HandlerHole<E extends Event> {
    readonly _tag: "HandlerHole";
    accept: ((event: E) => void) | ((event: E) => Effect.Effect<void, any, any>);
  }

  // Ref — typed by element type
  interface RefHole<T extends HTMLElement> {
    readonly _tag: "RefHole";
    accept: ComponentRef<T> | ((el: T) => void);
  }

  // HTML attribute — typed by attribute name and element
  interface AttributeHole<T> {
    readonly _tag: "AttributeHole";
    accept: T | (() => T);
  }

  // ARIA attribute — constrained to valid ARIA values
  interface AriaHole<K extends keyof ARIAMixin> {
    readonly _tag: "AriaHole";
    accept: ARIAMixin[K] | (() => ARIAMixin[K]);
  }

  // Raw HTML — must be explicitly marked safe
  interface HtmlHole {
    readonly _tag: "HtmlHole";
    accept: SafeHtml; // branded type — can't pass raw strings
  }
}
```

**How the compiler produces typed holes:**

```tsx
// What you write
<div
  class={isActive() ? "active" : "inactive"}
  style={{ color: theme() }}
  onClick={(e) => handleClick(e)}
  aria-label={label()}
>
  <p>{message()}</p>
  {items.map(item => <li>{item.name}</li>)}
</div>

// What the compiler produces
View.gen(function* () {
  const _class = yield* View.classHole(() =>
    isActive() ? "active" : "inactive"
  );
  // TypeScript checks: does the expression satisfy ClassHole["accept"]?
  // string ✓

  const _style = yield* View.styleHole(() =>
    ({ color: theme() })
  );
  // TypeScript checks: does { color: string } satisfy Partial<CSSStyleDeclaration>?
  // ✓ (color is a valid CSS property)

  const _onClick = yield* View.handlerHole<MouseEvent>((e) =>
    handleClick(e)
  );
  // TypeScript checks: does the callback accept MouseEvent?
  // ✓

  const _ariaLabel = yield* View.ariaHole("aria-label", () =>
    label()
  );
  // TypeScript checks: does string satisfy ARIAMixin["aria-label"]?
  // ✓

  const _text = yield* View.textHole(() => message());
  // TypeScript checks: does the expression return string | number | boolean?
  // ✓

  const _children = yield* View.each(items, (item) =>
    View.gen(function* () {
      const _itemText = yield* View.textHole(() => item.name);
      return yield* View.intrinsic("li", {}, [_itemText]);
    })
  );

  const _p = yield* View.intrinsic("p", {}, [_text]);

  return yield* View.intrinsic("div", {
    class: _class,
    style: _style,
    onClick: _onClick,
    "aria-label": _ariaLabel,
  }, [_p, ..._children]);
})
```

**Type errors become meaningful:**

```tsx
// Passing an object where text is expected
<p>{userData}</p>
// Error: Type '{ name: string; age: number }' is not assignable to TextHole.
// Text content only accepts string | number | boolean.
// Did you mean: {userData.name}?

// Passing wrong event type
<input onClick={(e: KeyboardEvent) => handleKey(e)} />
// Error: Type '(e: KeyboardEvent) => void' is not assignable to HandlerHole<MouseEvent>.
// onClick handlers receive MouseEvent.

// Invalid CSS property
<div style={{ colour: "red" }} />
// Error: 'colour' does not exist in CSSStyleDeclaration.
// Did you mean 'color'?

// Invalid ARIA value
<div aria-expanded="yes" />
// Error: Type '"yes"' is not assignable to AriaHole<"aria-expanded">.
// aria-expanded accepts "true" | "false" | boolean.

// Raw string in HTML hole
<div innerHTML="<script>alert('xss')</script>" />
// Error: Type 'string' is not assignable to HtmlHole.
// Use View.safeHtml() or View.sanitize() to create SafeHtml.

// Invalid class value
<div class={42} />
// Error: Type 'number' is not assignable to ClassHole.
// class accepts string | string[] | Record<string, boolean>.
```

**Element-specific attribute typing:**

Different HTML elements accept different attributes. An `<input>` has `type`, `value`, `checked`. A `<video>` has `autoplay`, `controls`. The compiler should know which element it's compiling and constrain attributes accordingly:

```ts
// Element-to-attribute type map
type ElementAttributes = {
  div: GlobalAttributes;
  input: GlobalAttributes & InputAttributes;
  button: GlobalAttributes & ButtonAttributes;
  video: GlobalAttributes & VideoAttributes;
  a: GlobalAttributes & AnchorAttributes;
  img: GlobalAttributes & ImageAttributes;
  canvas: GlobalAttributes & CanvasAttributes;
  // ...
};

interface InputAttributes {
  type: "text" | "number" | "email" | "password" | "checkbox" | "radio" | /* ... */;
  value: string | number;
  checked: boolean;
  placeholder: string;
  disabled: boolean;
  readonly: boolean;
  min: string | number;
  max: string | number;
  pattern: string;
  required: boolean;
  autocomplete: AutocompleteToken;
  // ...
}

interface AnchorAttributes {
  href: string;
  target: "_blank" | "_self" | "_parent" | "_top";
  rel: string;
  download: string | boolean;
  // ...
}
```

The compiler maps element tags to their attribute types:

```tsx
// Input-specific attributes are typed
<input
  type="email"           // ✓ — valid input type
  value={email()}        // ✓ — string
  placeholder="Enter"   // ✓ — string
  checked={true}         // ✓ — boolean
  href="..."             // Error: 'href' does not exist on InputAttributes
/>

// Anchor-specific attributes are typed

  href={url()}           // ✓ — string
  target="_blank"        // ✓ — valid target
  target="_new"          // Error: '_new' is not assignable to "_blank" | "_self" | ...
  download={true}        // ✓ — boolean
  checked={true}         // Error: 'checked' does not exist on AnchorAttributes
/>

// Video-specific
<video
  autoplay={true}        // ✓
  controls={true}        // ✓
  src={videoUrl()}       // ✓
  checked={true}         // Error: 'checked' does not exist on VideoAttributes
/>
```

**The compiler intrinsic call carries the element type:**

```ts
// View.intrinsic is generic over the element tag
declare function intrinsic<Tag extends keyof ElementAttributes>(
  tag: Tag,
  props: TypedProps<Tag>,
  children: ViewNode[],
): ViewEffect<ViewNode, never, Renderer>;

// TypedProps maps each attribute to its hole type
type TypedProps<Tag extends keyof ElementAttributes> = {
  [K in keyof ElementAttributes[Tag]]?:
    K extends `on${string}` ? HandlerHole<EventMap[K]>["accept"]
    : K extends "class" ? ClassHole["accept"]
    : K extends "style" ? StyleHole["accept"]
    : K extends "ref" ? RefHole<ElementTypeMap[Tag]>["accept"]
    : K extends `aria-${string}` ? AriaHole<K>["accept"]
    : K extends "innerHTML" ? HtmlHole["accept"]
    : AttributeHole<ElementAttributes[Tag][K]>["accept"]
    | (() => ElementAttributes[Tag][K]);
};
```

**Event handler typing per element and event name:**

Different events carry different event objects. The compiler knows the event name from the attribute:

```ts
type EventMap = {
  onClick: MouseEvent;
  onMouseDown: MouseEvent;
  onMouseUp: MouseEvent;
  onMouseMove: MouseEvent;
  onKeyDown: KeyboardEvent;
  onKeyUp: KeyboardEvent;
  onKeyPress: KeyboardEvent;
  onInput: InputEvent;
  onChange: Event;
  onSubmit: SubmitEvent;
  onFocus: FocusEvent;
  onBlur: FocusEvent;
  onScroll: Event;
  onDragStart: DragEvent;
  onDrop: DragEvent;
  onTouchStart: TouchEvent;
  onTouchEnd: TouchEvent;
  onPointerDown: PointerEvent;
  onPointerUp: PointerEvent;
  onAnimationStart: AnimationEvent;
  onAnimationEnd: AnimationEvent;
  onTransitionEnd: TransitionEvent;
  onWheel: WheelEvent;
  onContextMenu: MouseEvent;
  onResize: UIEvent;
  // ...
};
```

```tsx
<button onClick={(e) => {
  // e is MouseEvent — typed
  console.log(e.clientX, e.clientY);
}}>Click</button>

<input onKeyDown={(e) => {
  // e is KeyboardEvent — typed
  if (e.key === "Enter") submit();
}}>

<form onSubmit={(e) => {
  // e is SubmitEvent — typed
  e.preventDefault();
  const data = new FormData(e.currentTarget);
}}>
```

But more interestingly, event handlers that return Effects should have their error types flow into the view:

```tsx
<button onClick={(e) => Effect.gen(function* () {
  yield* api.deleteUser(userId);
  // This Effect can fail with PermissionDenied
})}>Delete</button>

// The compiler sees the Effect return type and extracts E:
yield* View.handlerHole<MouseEvent>((e) =>
  Effect.gen(function* () {
    yield* api.deleteUser(userId);
  })
);
// HandlerHole detects Effect return → E includes PermissionDenied
// This flows into the view's E type
```

**Reactive vs static holes:**

The compiler should distinguish between static values and reactive expressions. Static values don't need tracking. Reactive expressions need subscriptions:

```tsx
<div
  class="static-class"           // static — no tracking needed
  id={dynamicId()}               // reactive — needs subscription
  data-version="1.0"             // static
  title={computedTitle()}        // reactive
>
  Hello                          // static text
  {dynamicContent()}             // reactive text
</div>

// Compiler output
View.gen(function* () {
  // Static values are passed directly — no yield needed
  // Reactive values are yielded as reactive holes
  const _id = yield* View.reactiveAttribute("id", () => dynamicId());
  const _title = yield* View.reactiveAttribute("title", () => computedTitle());
  const _content = yield* View.reactiveText(() => dynamicContent());

  return yield* View.intrinsic("div", {
    class: "static-class",        // static — passed as literal
    id: _id,                      // reactive — tracked binding
    "data-version": "1.0",        // static
    title: _title,                // reactive
  }, [
    View.text("Hello "),          // static — no yield
    _content,                     // reactive — yielded
  ]);
})
```

The renderer only sets up subscriptions for reactive holes. Static values are set once. This is what dom-expressions already does — the compiler marks which expressions are static and which need tracking. The typed hole system preserves this optimization.

**SafeHtml — preventing XSS at the type level:**

Raw HTML injection is one of the biggest security risks in any template system. Typed holes can prevent it:

```ts
// SafeHtml is a branded type — can't be created from raw strings
interface SafeHtml {
  readonly [SafeHtmlBrand]: unique symbol;
  readonly html: string;
}

declare namespace View {
  // Only way to create SafeHtml
  function safeHtml(html: string): SafeHtml;   // developer asserts it's safe
  function sanitize(html: string): SafeHtml;    // runs DOMPurify or equivalent
  function markdown(md: string): SafeHtml;      // renders markdown safely

  // Template literal tag for safe interpolation
  function html(
    strings: TemplateStringsArray,
    ...values: (string | number | SafeHtml)[]
  ): SafeHtml;
}
```

```tsx
// Raw string — blocked
<div innerHTML={"<b>bold</b>"} />
// Error: Type 'string' is not assignable to SafeHtml

// Explicit safe assertion
<div innerHTML={View.safeHtml("<b>bold</b>")} />
// ✓ — developer takes responsibility

// Sanitized
<div innerHTML={View.sanitize(userProvidedHtml)} />
// ✓ — stripped of scripts, event handlers, etc.

// Template literal with safe interpolation
<div innerHTML={View.html`<b>${userName}</b>`} />
// ✓ — values are escaped, structure is safe

// Markdown
<div innerHTML={View.markdown(articleContent)} />
// ✓ — rendered to safe HTML
```

The compiler enforces that `innerHTML` only accepts `SafeHtml`. There's no way to accidentally inject raw user input. You have to go through one of the safe creation paths, each of which either sanitizes or requires an explicit assertion.

**Custom element attributes:**

For web components and custom elements, the attribute types aren't known at compile time. The framework should support type declarations for custom elements:

```ts
// Declare custom element attributes
declare module "effect-atom-jsx" {
  interface CustomElements {
    "my-slider": {
      min: number;
      max: number;
      value: number;
      step: number;
      onChange: (e: CustomEvent<{ value: number }>) => void;
    };
    "my-dialog": {
      open: boolean;
      modal: boolean;
      onClose: (e: CustomEvent<{ reason: string }>) => void;
    };
  }
}

// Now typed
<my-slider
  min={0}
  max={100}
  value={sliderValue()}
  step={1}
  onChange={(e) => {
    // e is CustomEvent<{ value: number }> — typed
    setSliderValue(e.detail.value);
  }}
/>

<my-slider min="zero" />
// Error: Type 'string' is not assignable to 'number'
```

**Renderer-agnostic typed holes:**

When using the abstract element vocabulary for cross-platform rendering, the hole types change to be renderer-agnostic:

```ts
// Abstract style type — not CSS-specific
interface AbstractStyle {
  padding?: number | [number, number] | [number, number, number, number];
  margin?: number | [number, number] | [number, number, number, number];
  background?: string;  // color token or value
  color?: string;
  fontSize?: number | "small" | "body" | "heading" | "title";
  fontWeight?: "normal" | "bold" | number;
  flex?: {
    direction?: "row" | "column";
    justify?: "start" | "center" | "end" | "between" | "around";
    align?: "start" | "center" | "end" | "stretch";
    gap?: number;
    grow?: number;
    shrink?: number;
  };
  border?: {
    width?: number;
    color?: string;
    radius?: number;
  };
  width?: number | string;
  height?: number | string;
  opacity?: number;
  visible?: boolean;
}
```

Each renderer translates abstract styles to platform-specific styles:

```ts
// DOM renderer translates to CSS
AbstractStyle { padding: [8, 16], flex: { direction: "row", gap: 8 } }
→ "padding: 8px 16px; display: flex; flex-direction: row; gap: 8px;"

// TUI renderer translates to blessed styles
→ { padding: { top: 8, right: 16, bottom: 8, left: 16 }, ... }

// Mobile renderer translates to native layout props
→ { paddingVertical: 8, paddingHorizontal: 16, flexDirection: "row", gap: 8 }
```

The typed hole for abstract styles:

```tsx
import { Box, Text } from "effect-atom-jsx/elements";

<Box
  style={{
    padding: [8, 16],
    flex: { direction: "row", gap: 8 },
    background: "surface",
  }}
>
  <Text
    style={{
      fontSize: "heading",
      fontWeight: "bold",
      color: "primary",
    }}
  >
    {title()}
  </Text>
</Box>

// Compiler produces typed holes for abstract elements
yield* View.abstractStyle({
  padding: [8, 16],               // ✓ — valid abstract padding
  flex: { direction: "row" },     // ✓ — valid flex
  background: "surface",          // ✓ — string color token
  display: "flex",                // Error: 'display' does not exist in AbstractStyle
                                  // (use flex: { ... } instead)
});
```

**Attribute spreads with type safety:**

Spreads are common but dangerous — they can introduce unknown attributes. Typed holes should constrain spreads:

```tsx
// Typed spread — only valid attributes for the element
function MyButton(props: ButtonProps & { extra?: Record<string, unknown> }) {
  return <button {...props.extra}>Click</button>;
  // Error: Record<string, unknown> is not assignable to
  // Spreadable<ButtonAttributes>
}

// Fix: constrain the spread type
function MyButton(props: ButtonProps & {
  extra?: Partial<ButtonAttributes>
}) {
  return <button {...props.extra}>Click</button>;
  // ✓ — spread is constrained to valid button attributes
}
```

The compiler wraps spreads in a type check:

```ts
yield* View.spread<"button">(props.extra);
// Checks: is Partial<ButtonAttributes> assignable to Spreadable<ElementAttributes["button"]>?
```

For forwarding all props to a child:

```tsx
function Wrapper(props: ComponentProps<typeof UserCard>) {
  return <UserCard {...props} />;
  // Compiler checks: props matches UserCard's prop type exactly
}
```

**Conditional attribute types:**

Some attributes change the type constraints of other attributes. For example, `<input type="checkbox">` should accept `checked` but not `min`/`max`, while `<input type="number">` should accept `min`/`max` but `checked` is meaningless:

```ts
// Discriminated input attributes based on type
type InputAttributesByType = {
  text: { value: string; placeholder?: string; maxLength?: number; pattern?: string };
  number: { value: number; min?: number; max?: number; step?: number };
  checkbox: { checked: boolean; indeterminate?: boolean };
  radio: { checked: boolean; name: string };
  email: { value: string; placeholder?: string; multiple?: boolean };
  file: { accept?: string; multiple?: boolean; capture?: string };
  range: { value: number; min: number; max: number; step?: number };
  date: { value: string; min?: string; max?: string };
  color: { value: string };
};
```

This is harder to enforce because the `type` attribute might be dynamic. For static type values, the compiler can narrow:

```tsx
// Static type — compiler narrows attribute types
<input type="checkbox" checked={isActive()} />
// ✓ — checkbox accepts checked

<input type="checkbox" min={0} />
// Error: 'min' does not exist on InputAttributes when type is "checkbox"

<input type="number" min={0} max={100} step={5} />
// ✓ — number accepts min/max/step

<input type="number" checked={true} />
// Error: 'checked' does not exist on InputAttributes when type is "number"
```

For dynamic type values, fall back to the union of all input attributes with a warning:

```tsx
const inputType = () => condition ? "checkbox" : "number";
<input type={inputType()} checked={isActive()} min={0} />
// Warning: dynamic type — can't narrow attribute types.
// All InputAttributes accepted but type safety is reduced.
```

**The view type with full hole typing:**

```ts
// The compiler produces a view with hole types embedded
type UserListView = View.TypedView<{
  // Holes in this template
  holes: {
    "div.class": View.ClassHole;
    "div.onClick": View.HandlerHole<MouseEvent>;
    "p.textContent": View.TextHole;
    "input.value": View.AttributeHole<string>;
    "input.onInput": View.HandlerHole<InputEvent>;
    "ul.children": View.ChildHole;
  };
  // Elements in this template
  elements: {
    div: HTMLDivElement;
    p: HTMLParagraphElement;
    input: HTMLInputElement;
    ul: HTMLUListElement;
  };
  // Child components
  children: {
    Header: Component<{ title: string }, never, never>;
    UserRow: Component<{ user: User }, Permissions, PermissionError>;
  };
  // Accumulated from children and handlers
  requirements: Api | Permissions | Renderer;
  errors: HttpError | PermissionError;
}>;
```

This type is inferred by the compiler — the developer never writes it. But it's available for tooling:

```ts
// Extract hole types for testing or documentation
type Holes = View.HolesOf<typeof UserListView>;
// { "div.class": ClassHole; "input.value": AttributeHole<string>; ... }

// Extract child components for dependency analysis
type Children = View.ChildrenOf<typeof UserListView>;
// { Header: Component<...>; UserRow: Component<...>; }

// Extract requirements for layer verification
type Req = View.RequirementsOf<typeof UserListView>;
// Api | Permissions | Renderer
```

**Putting it all together — what the developer sees:**

```tsx
const UserList = Component.make(
  Component.props<{ filter?: string }>(),
  Component.require(Api, Permissions),

  // Setup — Effect with typed R and E
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const perms = yield* Permissions;

    const users = yield* Component.query(
      () => api.listUsers({ filter: props.filter }),
      { name: "users" },
    );

    const canCreate = yield* Component.derived(() => perms.check("user:create"));

    const deleteUser = yield* Component.action(
      Effect.fn(function* (id: string) {
        yield* api.deleteUser(id);
      }),
      { reactivityKeys: ["users"] },
    );

    return { users, canCreate, deleteUser };
  }),

  // View — normal JSX, but every hole is typed
  (props, { users, canCreate, deleteUser }) => (
    <div class="user-list">
      {/* Header: no extra requirements */}
      <Header title="User Management" />

      {/* Async: error callback receives HttpError (typed from query) */}
      <Async
        result={users()}
        loading={() => <p class="loading">Loading users...</p>}
        error={(e) => <p class="error">{e.message}</p>}
        success={(xs) => (
          <ul class="user-grid">
            <For each={xs}>
              {(user) => (
                <li class={{ active: user().active, admin: user().role === "admin" }}>
                  {/* TextHole: user().name must be string | number */}
                  <span>{user().name}</span>

                  {/* HandlerHole<MouseEvent>: onClick handler typed */}
                  <button
                    onClick={() => deleteUser(user().id)}
                    disabled={!canCreate()}
                    aria-label={`Delete ${user().name}`}
                  >
                    Delete
                  </button>
                </li>
              )}
            </For>
          </ul>
        )}
      />

      {/* Conditional: canCreate is ReadonlyAtom<boolean> */}
      <Show when={canCreate()}>
        <CreateUserForm />
        {/* CreateUserForm may have its own Req and E — flows into UserList */}
      </Show>
    </div>
  ),
);
```

The developer writes normal JSX. They never think about `View.gen` or `View.textHole` or `View.handlerHole`. The Babel plugin handles everything. But under the hood:

Every `{user().name}` in text position is checked to return `string | number | boolean`. Every `onClick` handler is checked to accept `MouseEvent`. Every `class` value is checked against `ClassHole` constraints. Every `aria-label` is checked against ARIA attribute types. Every child component contributes its `Req` and `E` to the parent. Every event handler that returns an Effect contributes its `E` to the parent. The `innerHTML` attribute only accepts `SafeHtml`. Invalid attributes for the element type are rejected.

All of this happens at compile time. Zero runtime cost. The developer just gets red squiggles when something doesn't match, with error messages that explain exactly what's wrong and where.

The framework becomes a thin typed bridge between Effect programs and whatever rendering target you choose, where every seam — every hole in every template in every component — is typed, tracked, and safe.