This is the right instinct. Right now components are plain functions, which means their requirements are invisible — you discover missing atoms, services, or props at runtime. A `Component` primitive that makes requirements explicit in the type system, while staying composable and pipeable, would complete the architectural story.

Here's how I'd design it.

**The core type:**

```ts
interface Component<Props, Req, E> {
  (props: Props): JSX.Element;
  pipe: PipeableComponent<Props, Req, E>;

  // Metadata accessible at the type level
  readonly [ComponentTypeId]: {
    readonly Props: Props;
    readonly Req: Req;
    readonly E: E;
  };
}
```

`Props` is the input from the parent. `Req` is the union of everything the component needs from its environment — services, atoms, context values. `E` is the error channel — what typed errors can this component's async dependencies produce. This mirrors `Effect<A, E, R>` where the component's "success value" is always `JSX.Element`.

**Building a component:**

```ts
import { Component, Atom } from "effect-atom-jsx";
import { Effect } from "effect";

const UserCard = Component.make(
  // 1. Declare props schema
  Component.props<{ id: string; highlight?: boolean }>(),

  // 2. Declare requirements
  Component.require(Api, Auth),

  // 3. Setup function — runs once, returns reactive bindings
  (props, ctx) => {
    const api = ctx.service(Api);
    const auth = ctx.service(Auth);

    const user = ctx.query(
      () => api.findUser(props.id),
      { name: `user:${props.id}` },
    );

    const canEdit = ctx.derived(() =>
      auth.currentRole() === "admin" || user().id === auth.currentUserId()
    );

    return { user, canEdit };
  },

  // 4. View function — pure template, receives setup bindings
  (props, { user, canEdit }) => (
    <div class={props.highlight ? "highlighted" : ""}>
      <Async
        result={user()}
        loading={() => <Skeleton />}
        success={(u) => (
          <>
            <h2>{u.name}</h2>
            <Show when={canEdit()}>
              <EditButton userId={u.id} />
            </Show>
          </>
        )}
      />
    </div>
  ),
);
```

The separation between setup and view is deliberate. Setup runs once (like the current component model), creates reactive bindings, and returns them. View is a pure template function that receives props and bindings. This makes the reactive boundary explicit — setup creates the reactive graph, view consumes it.

**The type that falls out:**

```ts
// UserCard is:
Component
  { id: string; highlight?: boolean },   // Props
  Api | Auth,                              // Req (services needed)
  HttpError | AuthError                    // E (errors from async deps)
>
```

TypeScript infers `Req` from the `Component.require(Api, Auth)` call. It infers `E` from the effects used in setup — `api.findUser` returns `Effect<User, HttpError>`, so `HttpError` enters the error channel. The parent component doesn't need to annotate anything — inference handles it.

**Using a component:**

```tsx
// In JSX — looks like a normal component
function App() {
  return <UserCard id="user-1" highlight={true} />;
}
```

The difference is at the type level. If `App` renders `UserCard`, and `UserCard` requires `Api | Auth`, then either `App` itself must satisfy those requirements (via its own runtime binding) or a `WithLayer` boundary must provide them. Missing requirements become type errors:

```tsx
// If ApiLive doesn't include Auth:
const mount = createMount(ApiLive);
mount(() => <App />, root);
//          ^^^^^ Type error: Component requires Auth, but mount layer only provides Api
```

**Pipeability:**

Components should be transformable through pipes, just like atoms:

```tsx
const UserCard = Component.make(
  Component.props<{ id: string }>(),
  Component.require(Api),
  (props, ctx) => {
    const user = ctx.query(() => ctx.service(Api).findUser(props.id));
    return { user };
  },
  (props, { user }) => (
    <Async result={user()} success={(u) => <div>{u.name}</div>} />
  ),
).pipe(
  // Add error boundary behavior
  Component.withErrorBoundary({
    HttpError: (err) => <RetryPanel error={err} />,
  }),

  // Add loading boundary
  Component.withLoading(() => <CardSkeleton />),

  // Wrap with a layer (satisfies Auth requirement for children)
  Component.withLayer(AuthLive),

  // Add tracing span for this component's lifecycle
  Component.withSpan("UserCard"),

  // Memoize — skip re-render if props haven't changed
  Component.memo((prev, next) => prev.id === next.id),
);
```

Each pipe step transforms the component type. `Component.withLayer(AuthLive)` removes `Auth` from `Req`. `Component.withErrorBoundary({ HttpError: ... })` removes `HttpError` from `E` (because it's now handled). The final type reflects exactly what's left unhandled:

```ts
// After piping:
Component
  { id: string },     // Props (unchanged)
  Api,                 // Req (Auth was satisfied by withLayer)
  never                // E (HttpError was handled by withErrorBoundary)
>
```

**`ctx` — the component context:**

The setup function's second argument is a typed context that provides everything the component declared as requirements:

```ts
interface ComponentContext<Req> {
  // Service access — only services declared in Req are available
  service<S extends Req>(tag: Context.Tag<S, S>): S;

  // Create a reactive query scoped to this component
  query<A, E>(
    effect: () => Effect<A, E>,
    options?: QueryOptions,
  ): ReadonlyAtom<Result<A, E>>;

  // Create a derived atom scoped to this component
  derived<A>(fn: () => A): ReadonlyAtom<A>;

  // Create a writable atom scoped to this component
  state<A>(initial: A): WritableAtom<A>;

  // Create an action scoped to this component
  action<Args extends readonly unknown[], A, E>(
    fn: (...args: Args) => Effect<A, E>,
    options?: ActionOptions,
  ): Action<Args, A, E>;

  // Refs for DOM elements
  ref<T extends HTMLElement>(): ComponentRef<T>;

  // Lifecycle
  onMount(fn: () => void | (() => void)): void;
  onCleanup(fn: () => void): void;

  // Access to the component's scope for advanced use
  scope: Scope;
}
```

`ctx.service` is generic but constrained — you can only access services that were declared in `Component.require(...)`. If you try to access a service that wasn't declared, it's a compile error, not a runtime error:

```ts
const Card = Component.make(
  Component.props<{}>(),
  Component.require(Api),  // only Api declared
  (props, ctx) => {
    const api = ctx.service(Api);   // fine
    const db = ctx.service(Db);     // compile error: Db is not in Req
    return {};
  },
  () => <div />,
);
```

**Props with schemas:**

For components that need validated props, integrate with Effect Schema:

```ts
const UserCard = Component.make(
  Component.propsSchema(
    Schema.Struct({
      id: Schema.String.pipe(Schema.nonEmpty()),
      highlight: Schema.optional(Schema.Boolean, { default: () => false }),
    })
  ),
  Component.require(Api),
  (props, ctx) => {
    // props.id is string (guaranteed non-empty)
    // props.highlight is boolean (defaulted to false)
    const user = ctx.query(() => ctx.service(Api).findUser(props.id));
    return { user };
  },
  (props, { user }) => <div>{user().name}</div>,
);
```

`Component.propsSchema` validates at the boundary — if a parent passes invalid props, the error is caught with a clear diagnostic rather than silently propagating bad data.

**Composition — components as requirements:**

A component can declare that it needs other components, not just services. This enables typed slot patterns:

```ts
const Dashboard = Component.make(
  Component.props<{ userId: string }>(),
  Component.require(Api, Auth),
  Component.slots({
    header: Component.slot<{ title: string }>(),
    sidebar: Component.slot<{ collapsed: boolean }>(),
  }),
  (props, ctx) => {
    const user = ctx.query(() => ctx.service(Api).findUser(props.userId));
    return { user };
  },
  (props, { user }, slots) => (
    <div class="dashboard">
      {slots.header({ title: `Welcome, ${user().name}` })}
      <div class="content">
        {slots.sidebar({ collapsed: false })}
        <main>{props.children}</main>
      </div>
    </div>
  ),
);

// Usage — slots are typed
<Dashboard userId="1"
  header={(p) => <h1>{p.title}</h1>}
  sidebar={(p) => <Nav collapsed={p.collapsed} />}
>
  <MainContent />
</Dashboard>
```

Slots are typed render functions. The parent must provide them with the right signature. This is similar to Solid's component children patterns but with typed contracts.

**Component.from — lifting existing components:**

For migration and interop, lift plain function components into the `Component` type:

```ts
// Existing plain component
function LegacyCard(props: { name: string }) {
  return <div>{props.name}</div>;
}

// Lift into Component with explicit requirements
const Card = Component.from(LegacyCard).pipe(
  Component.addRequirement(Api),
  Component.withErrorBoundary({ HttpError: (e) => <p>{e.message}</p> }),
);
```

`Component.from` wraps an existing function component with `Req = never` and `E = never` — no requirements, no errors. Then you can add requirements and error handling through pipes. This makes adoption incremental.

**Component.compose — higher-order composition:**

```ts
// A layout component that provides structure
const WithSidebar = Component.layout(
  Component.props<{ title: string }>(),
  (props, content) => (
    <div class="layout">
      <header><h1>{props.title}</h1></header>
      <aside><Nav /></aside>
      <main>{content}</main>
    </div>
  ),
);

// Compose layout with content component
const UserPage = UserCard.pipe(
  Component.withLayout(WithSidebar, { title: "User Profile" }),
);

// Requirements merge: UserCard needs Api, WithSidebar needs Nav's requirements
// The composed component requires both
```

**Component families (parameterized components):**

Like `Atom.family` for atoms:

```ts
const UserCardFamily = Component.family((id: string) =>
  Component.make(
    Component.props<{ highlight?: boolean }>(),
    Component.require(Api),
    (props, ctx) => {
      const user = ctx.query(() => ctx.service(Api).findUser(id));
      return { user };
    },
    (props, { user }) => <div class={props.highlight ? "hl" : ""}>{user().name}</div>,
  )
);

// Usage — factory returns a component bound to that id
const AliceCard = UserCardFamily("alice");
<AliceCard highlight={true} />

// Eviction
UserCardFamily.evict("alice");
```

**Component.effect — the bridge to Effect pipelines:**

A component's entire lifecycle can be expressed as an Effect when needed:

```ts
// Get a component's requirements as an Effect type
type UserCardReq = Component.Requirements<typeof UserCard>;
// Api | Auth

// Get a component's error type
type UserCardErrors = Component.Errors<typeof UserCard>;
// HttpError | AuthError

// Run a component as an Effect (useful for testing)
const testEffect: Effect<JSX.Element, HttpError | AuthError, Api | Auth> =
  Component.renderEffect(UserCard, { id: "1" });

// Test in pure Effect
Effect.gen(function* () {
  const element = yield* Component.renderEffect(UserCard, { id: "1" });
  // assert on element
}).pipe(
  Effect.provide(TestApiLive),
  Effect.provide(TestAuthLive),
);
```

**How requirements propagate through the component tree:**

This is the key architectural question. When component A renders component B, B's requirements either need to be satisfied by A's environment or explicitly provided. There are three resolution strategies:

```ts
// Strategy 1: Requirements bubble up (default)
// Parent must satisfy child requirements
const Parent = Component.make(
  Component.props<{}>(),
  Component.require(Api, Auth, Db),  // must include UserCard's requirements
  (props, ctx) => ({}),
  () => <UserCard id="1" />,  // UserCard needs Api | Auth — satisfied by Parent's Req
);

// Strategy 2: WithLayer satisfies requirements at a boundary
const Parent = Component.make(
  Component.props<{}>(),
  Component.require(Api),  // only Api needed directly
  (props, ctx) => ({}),
  () => (
    <WithLayer layer={AuthLive}>
      <UserCard id="1" />  {/* Auth is now satisfied by WithLayer */}
    </WithLayer>
  ),
);

// Strategy 3: Component.withLayer bakes the layer into the component
const SelfSufficientCard = UserCard.pipe(
  Component.withLayer(AuthLive),
);
// SelfSufficientCard requires Api only (Auth was satisfied)
```

The type checker enforces that all `Req` are eventually satisfied before the root mount. At the mount point, every requirement in the tree must be covered by the layer:

```ts
// mount checks that the layer covers all requirements in the component tree
const app = Component.mount(App, {
  layer: Layer.mergeAll(ApiLive, AuthLive, DbLive),
  target: document.getElementById("root")!,
});

// If DbLive is missing and some component in the tree requires Db:
// Type error: Db is not provided by the mount layer
```

**The full type architecture with Components:**

```
Component<Props, Req, E>
  Props: input from parent
  Req: services + context needed from environment
  E: typed errors from async dependencies

Component.make(props, require, setup, view) → Component<P, R, E>
Component.from(fn)                          → Component<P, never, never>

Pipes:
  Component.withLayer(layer)          → eliminates services from Req
  Component.withErrorBoundary(...)    → eliminates errors from E
  Component.withLoading(fallback)     → adds loading boundary
  Component.withSpan(name)            → adds tracing
  Component.memo(equals)              → adds memoization
  Component.withLayout(layout, props) → wraps with layout component

Atom<A, E>                → reactive state (read/write)
Component<Props, Req, E>  → reactive UI (props in, JSX out, requirements tracked)
Effect<A, E, R>           → effectful computation (requirements tracked)

All three share:
  - Explicit typed requirements
  - Pipeable transformations
  - Composable error channels
  - Requirements eliminated by providing context/layers
```

The symmetry is: `Effect.provide(layer)` eliminates `R` from an Effect. `Component.withLayer(layer)` eliminates `Req` from a Component. `Atom.runtime(layer)` eliminates `R` from an atom's effect. It's the same concept — providing context to satisfy requirements — expressed consistently across all three primitives.

**What this enables that plain function components can't:**

Static analysis of the full component tree's requirements. A build tool or IDE plugin could analyze which services, atoms, and layers are needed by the entire app, verify they're all provided, and flag missing dependencies before runtime. The type system enforces it, but tooling could surface it as warnings, dependency graphs, or architecture diagrams.

A component becomes a first-class composable value with typed contracts, not just a function that happens to return JSX. You can store components in maps, pass them as arguments, compose them with pipes, test them as Effects, and analyze their requirements — all with full type safety.Exactly. The `Component` primitive naturally splits into setup (behavior/state/logic) and view (rendering). A headless component is just a component where the view is provided by the consumer. The type system enforces the contract between the headless logic and whoever renders it.

**The core primitive: `Component.headless`**

```ts
const Combobox = Component.headless(
  // Props the consumer provides
  Component.props<{
    items: readonly string[];
    onSelect: (item: string) => void;
    filter?: (item: string, query: string) => boolean;
  }>(),

  // Requirements (optional — services this behavior needs)
  Component.require(),

  // Setup — all the behavior, state, accessibility, keyboard handling
  (props, ctx) => {
    const query = ctx.state("");
    const isOpen = ctx.state(false);
    const activeIndex = ctx.state(0);
    const inputRef = ctx.ref<HTMLInputElement>();
    const listRef = ctx.ref<HTMLUListElement>();

    const filtered = ctx.derived(() => {
      const q = query();
      if (!q) return props.items;
      const filterFn = props.filter ?? ((item, query) =>
        item.toLowerCase().includes(query.toLowerCase())
      );
      return props.items.filter((item) => filterFn(item, q));
    });

    const select = (index: number) => {
      const item = filtered()[index];
      if (item) {
        props.onSelect(item);
        isOpen.set(false);
        query.set("");
      }
    };

    const keyboard = ctx.keymap({
      ArrowDown: () => activeIndex.update((i) => Math.min(i + 1, filtered().length - 1)),
      ArrowUp: () => activeIndex.update((i) => Math.max(i - 1, 0)),
      Enter: () => select(activeIndex()),
      Escape: () => isOpen.set(false),
    });

    const aria = {
      input: () => ({
        role: "combobox" as const,
        "aria-expanded": isOpen(),
        "aria-activedescendant": `option-${activeIndex()}`,
        "aria-controls": "listbox",
        "aria-autocomplete": "list" as const,
      }),
      listbox: () => ({
        role: "listbox" as const,
        id: "listbox",
      }),
      option: (index: number) => ({
        role: "option" as const,
        id: `option-${index}`,
        "aria-selected": index === activeIndex(),
      }),
    };

    return {
      // State accessors
      query, isOpen, activeIndex, filtered,
      // Actions
      select, open: () => isOpen.set(true), close: () => isOpen.set(false),
      // Refs the consumer must attach
      inputRef, listRef,
      // Event handlers
      keyboard,
      // ARIA attribute getters
      aria,
    };
  },
);
```

**What falls out of this type:**

```ts
type ComboboxBindings = {
  query: WritableAtom<string>;
  isOpen: WritableAtom<boolean>;
  activeIndex: WritableAtom<number>;
  filtered: ReadonlyAtom<readonly string[]>;
  select: (index: number) => void;
  open: () => void;
  close: () => void;
  inputRef: ComponentRef<HTMLInputElement>;
  listRef: ComponentRef<HTMLUListElement>;
  keyboard: KeymapHandler;
  aria: {
    input: () => AriaAttributes;
    listbox: () => AriaAttributes;
    option: (index: number) => AriaAttributes;
  };
};
```

The consumer gets a fully typed contract. Every binding, every action, every ref, every ARIA attribute getter is typed. The consumer can't forget to attach a ref or misuse an action because the types enforce the contract.

**Consuming a headless component:**

```tsx
function MyCombobox(props: { items: string[]; onSelect: (s: string) => void }) {
  return (
    <Combobox items={props.items} onSelect={props.onSelect}>
      {(bindings) => (
        <div class="combobox-wrapper">
          <input
            ref={bindings.inputRef}
            value={bindings.query()}
            onInput={(e) => bindings.query.set(e.target.value)}
            onFocus={() => bindings.open()}
            onKeyDown={bindings.keyboard}
            {...bindings.aria.input()}
          />
          <Show when={bindings.isOpen()}>
            <ul ref={bindings.listRef} {...bindings.aria.listbox()}>
              <For each={bindings.filtered()}>
                {(item, i) => (
                  <li
                    onClick={() => bindings.select(i())}
                    class={i() === bindings.activeIndex() ? "active" : ""}
                    {...bindings.aria.option(i())}
                  >
                    {item}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      )}
    </Combobox>
  );
}
```

The consumer provides all the rendering. The headless component provides all the behavior. The types enforce that every ref is attached, every ARIA attribute is spread, every action is correctly called.

**Headless components with service requirements:**

This is where it gets interesting. A headless component can require Effect services, and those requirements propagate to the consumer:

```ts
const DataTable = Component.headless(
  Component.props<{
    endpoint: string;
    columns: readonly ColumnDef[];
  }>(),

  Component.require(Api, Auth),

  (props, ctx) => {
    const api = ctx.service(Api);
    const auth = ctx.service(Auth);

    const page = ctx.state(0);
    const pageSize = ctx.state(20);
    const sortColumn = ctx.state<string | null>(null);
    const sortDirection = ctx.state<"asc" | "desc">("asc");
    const selectedRows = ctx.state<Set<string>>(new Set());

    const data = ctx.query(
      () => api.fetchTable({
        endpoint: props.endpoint,
        page: page(),
        pageSize: pageSize(),
        sort: sortColumn() ? { column: sortColumn()!, direction: sortDirection() } : undefined,
      }),
      { name: `table:${props.endpoint}` },
    );

    const canEdit = ctx.derived(() => auth.hasPermission("write"));

    const toggleRow = (id: string) =>
      selectedRows.update((set) => {
        const next = new Set(set);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });

    const toggleAll = () => {
      const rows = Result.getOrElse(data(), () => []);
      const allSelected = rows.every((r) => selectedRows().has(r.id));
      selectedRows.set(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
    };

    const deleteSelected = ctx.action(
      Effect.fn(function* () {
        const ids = Array.from(selectedRows());
        yield* api.deleteRows(props.endpoint, ids);
        selectedRows.set(new Set());
      }),
      { reactivityKeys: [`table:${props.endpoint}`] },
    );

    return {
      // Data
      data, page, pageSize, sortColumn, sortDirection,
      selectedRows, canEdit,
      // Actions
      toggleRow, toggleAll, deleteSelected,
      setPage: page.set, setPageSize: pageSize.set,
      sort: (col: string) => {
        if (sortColumn() === col) {
          sortDirection.update((d) => d === "asc" ? "desc" : "asc");
        } else {
          sortColumn.set(col);
          sortDirection.set("asc");
        }
      },
      // Pagination helpers
      totalPages: ctx.derived(() =>
        Result.match(data(), {
          Success: (d) => Math.ceil(d.total / pageSize()),
          orElse: () => 0,
        })
      ),
      hasNext: ctx.derived(() => page() < totalPages() - 1),
      hasPrev: ctx.derived(() => page() > 0),
    };
  },
);
```

Now any consumer of `DataTable` inherits the `Api | Auth` requirement. The consumer handles rendering — maybe it's a minimal HTML table, maybe it's a complex grid with virtualization — but the data fetching, pagination, sorting, selection, permissions, and mutation logic are all encapsulated with typed contracts:

```tsx
// DataTable requires Api | Auth — satisfied by the runtime
const appRuntime = Atom.runtime(Layer.mergeAll(ApiLive, AuthLive));

function AdminPanel() {
  return (
    <DataTable endpoint="/users" columns={userColumns}>
      {(t) => (
        <div>
          <Show when={isPending(t.data)}>
            <ProgressBar />
          </Show>

          <Async
            result={t.data()}
            loading={() => <TableSkeleton columns={userColumns} />}
            success={(rows) => (
              <table>
                <thead>
                  <tr>
                    <th><input type="checkbox" onChange={t.toggleAll} /></th>
                    <For each={userColumns}>
                      {(col) => (
                        <th onClick={() => t.sort(col.key)}>
                          {col.label}
                          <Show when={t.sortColumn() === col.key}>
                            {t.sortDirection() === "asc" ? " ↑" : " ↓"}
                          </Show>
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={rows.items}>
                    {(row) => (
                      <tr class={t.selectedRows().has(row().id) ? "selected" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            checked={t.selectedRows().has(row().id)}
                            onChange={() => t.toggleRow(row().id)}
                          />
                        </td>
                        <For each={userColumns}>
                          {(col) => <td>{row()[col.key]}</td>}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            )}
          />

          <div class="pagination">
            <button disabled={!t.hasPrev()} onClick={() => t.setPage(t.page() - 1)}>Prev</button>
            <span>Page {t.page() + 1} of {t.totalPages()}</span>
            <button disabled={!t.hasNext()} onClick={() => t.setPage(t.page() + 1)}>Next</button>
          </div>

          <Show when={t.canEdit()}>
            <button
              disabled={t.selectedRows().size === 0}
              onClick={() => t.deleteSelected()}
            >
              Delete {t.selectedRows().size} rows
            </button>
          </Show>
        </div>
      )}
    </DataTable>
  );
}
```

**Composing headless components:**

Headless components should compose with each other. A disclosure wrapping a combobox inside a popover:

```ts
const Popover = Component.headless(
  Component.props<{ placement?: "top" | "bottom" | "left" | "right" }>(),
  Component.require(),
  (props, ctx) => {
    const isOpen = ctx.state(false);
    const triggerRef = ctx.ref<HTMLElement>();
    const contentRef = ctx.ref<HTMLElement>();

    const position = ctx.derived(() => {
      if (!isOpen()) return null;
      return calculatePosition(triggerRef.current, contentRef.current, props.placement ?? "bottom");
    });

    return {
      isOpen, triggerRef, contentRef, position,
      open: () => isOpen.set(true),
      close: () => isOpen.set(false),
      toggle: () => isOpen.update((v) => !v),
      aria: {
        trigger: () => ({
          "aria-expanded": isOpen(),
          "aria-haspopup": "dialog" as const,
        }),
        content: () => ({
          role: "dialog" as const,
          "aria-hidden": !isOpen(),
        }),
      },
    };
  },
);

// Compose headless components
const ComboboxPopover = Component.compose(
  Popover,
  Combobox,
  // Wiring function — connects bindings between the two
  (popover, combobox) => ({
    ...combobox,
    popover,
    // Override combobox open/close to go through popover
    open: () => { popover.open(); combobox.open(); },
    close: () => { popover.close(); combobox.close(); },
  }),
);
```

`Component.compose` merges the requirements of both headless components (`Req` is the union, `E` is the union) and produces a new headless component with the combined bindings. The wiring function lets you connect behaviors between them.

**Headless components with schemas:**

A headless form component powered by `AtomSchema`:

```ts
const Form = Component.headless(
  Component.propsSchema(
    Schema.Struct({
      onSubmit: Schema.declare((u): u is (data: unknown) => void => typeof u === "function"),
    })
  ),
  Component.require(),
  (props, ctx) => {
    // Accept schema as a type parameter, build fields dynamically
    return <Fields>(schema: Schema.Schema<Fields>, initial: Fields) => {
      const form = AtomSchema.struct(schema, initial);

      const submit = ctx.action(
        Effect.fn(function* () {
          form.touch();
          const values = yield* AtomSchema.validateEffect(form);
          props.onSubmit(values);
        }),
      );

      return {
        form,
        submit,
        canSubmit: ctx.derived(() => form.isValid() && !submit.pending()),
      };
    };
  },
);
```

Actually, a better approach — make form schemas part of the headless component's generic contract:

```ts
function createFormComponent<T>(schema: Schema.Schema<T>, initial: T) {
  return Component.headless(
    Component.props<{ onSubmit: (data: T) => void }>(),
    Component.require(),
    (props, ctx) => {
      const form = AtomSchema.structFromSchema(schema, initial);

      const submit = ctx.action(
        Effect.fn(function* () {
          form.touch();
          const values = yield* AtomSchema.validateEffect(form);
          // values is T — fully typed from the schema
          props.onSubmit(values);
        }),
      );

      return {
        fields: form.fields, // typed per-field accessors
        form,                // combined form state
        submit,
        canSubmit: ctx.derived(() => form.isValid() && !submit.pending()),
        reset: () => form.reset(),
      };
    },
  );
}

// Usage
const UserForm = createFormComponent(
  Schema.Struct({
    name: Schema.NonEmpty,
    email: Schema.String.pipe(Schema.pattern(/@/)),
    age: Schema.Int.pipe(Schema.between(0, 150)),
  }),
  { name: "", email: "", age: 25 },
);

// Consumer
<UserForm onSubmit={(data) => {
  // data is { name: string; email: string; age: number } — typed
  addUser(data);
}}>
  {({ fields, canSubmit, submit, reset }) => (
    <div>
      <input
        value={fields.name.input()}
        onInput={(e) => fields.name.input.set(e.target.value)}
      />
      <Show when={fields.name.error()}>
        {(err) => <span class="error">{err().message}</span>}
      </Show>

      <input
        value={fields.email.input()}
        onInput={(e) => fields.email.input.set(e.target.value)}
      />

      <input
        type="number"
        value={fields.age.input()}
        onInput={(e) => fields.age.input.set(e.target.value)}
      />

      <button disabled={!canSubmit()} onClick={() => submit()}>Submit</button>
      <button onClick={reset}>Reset</button>
    </div>
  )}
</UserForm>
```

**Publishing a headless library:**

The real payoff is what a headless component library looks like as a package:

```ts
// @my-org/headless-ui
export {
  Combobox,     // Component.Headless<ComboboxProps, never, never>
  DataTable,    // Component.Headless<TableProps, Api | Auth, HttpError>
  Dialog,       // Component.Headless<DialogProps, never, never>
  Popover,      // Component.Headless<PopoverProps, never, never>
  Select,       // Component.Headless<SelectProps, never, never>
  Tabs,         // Component.Headless<TabsProps, never, never>
  Toast,        // Component.Headless<ToastProps, never, never>
  Tooltip,      // Component.Headless<TooltipProps, never, never>
  Accordion,    // Component.Headless<AccordionProps, never, never>
  Menu,         // Component.Headless<MenuProps, never, never>
} from "@my-org/headless-ui";

// Each export has:
// 1. Fully typed bindings contract
// 2. Explicit service requirements in the type
// 3. Explicit error types
// 4. Composable via Component.compose
// 5. Pipeable (add boundaries, layers, tracing)
// 6. Testable as Effects
```

The consumer organization builds their design system on top:

```ts
// @my-org/design-system
import { Combobox, Select, Dialog } from "@my-org/headless-ui";

// Wrap headless components with your design tokens and rendering
export const StyledCombobox = Combobox.pipe(
  Component.withView((props, bindings) => (
    // Your design system's rendering
    <div class="ds-combobox">
      <div class="ds-input-wrapper">
        <SearchIcon />
        <input
          ref={bindings.inputRef}
          class="ds-input"
          value={bindings.query()}
          onInput={(e) => bindings.query.set(e.target.value)}
          {...bindings.aria.input()}
        />
      </div>
      <Show when={bindings.isOpen()}>
        <div class="ds-dropdown">
          <ul ref={bindings.listRef} {...bindings.aria.listbox()}>
            <For each={bindings.filtered()}>
              {(item, i) => (
                <li
                  class={`ds-option ${i() === bindings.activeIndex() ? "ds-active" : ""}`}
                  onClick={() => bindings.select(i())}
                  {...bindings.aria.option(i())}
                >
                  {item}
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  )),
);
```

`Component.withView` takes a headless component and attaches a view, producing a full `Component`. The bindings type is carried through — the view function receives exactly the bindings the headless component provides, fully typed. The design system team can't accidentally misuse the bindings because the types enforce the contract.

**Testing headless components as pure Effects:**

```ts
import { Component } from "effect-atom-jsx";
import { Effect } from "effect";
import { Combobox } from "@my-org/headless-ui";

// Test the behavior without any DOM
const test = Effect.gen(function* () {
  const bindings = yield* Component.setupEffect(Combobox, {
    items: ["apple", "banana", "cherry"],
    onSelect: () => {},
  });

  // Initial state
  assert.equal(bindings.isOpen(), false);
  assert.equal(bindings.filtered().length, 3);

  // Simulate typing
  bindings.query.set("ba");
  yield* Effect.sync(() => Atom.flush());
  assert.equal(bindings.filtered().length, 1);
  assert.equal(bindings.filtered()[0], "banana");

  // Simulate keyboard
  bindings.open();
  bindings.keyboard.handle("ArrowDown");
  assert.equal(bindings.activeIndex(), 1); // moved to next visible

  // Simulate selection
  bindings.select(0);
  assert.equal(bindings.isOpen(), false);
  assert.equal(bindings.query(), "");
});

Effect.runPromise(test);
```

No DOM, no rendering, no mocking — just pure behavioral testing through typed bindings. Because the headless component's setup is expressible as an Effect, you test it with Effect's testing tools. If the headless component requires services, you provide test layers:

```ts
const test = Component.setupEffect(DataTable, {
  endpoint: "/users",
  columns: userColumns,
}).pipe(
  Effect.provide(TestApiLayer),
  Effect.provide(TestAuthLayer),
);
```

**The architectural payoff:**

Headless component libraries today (Headless UI, Radix, React Aria) work through conventions, documentation, and runtime checks. The contracts between behavior and rendering are implicit — you read the docs, you follow the patterns, and if you forget to spread ARIA attributes or attach a ref, nothing catches it until a user reports an accessibility bug.

With this model, the contract is in the type system. A headless component declares exactly what bindings it provides, what refs must be attached, what ARIA attributes should be spread, what actions are available, and what services it needs. The consumer sees all of this in their IDE. Miss a ref and the type checker tells you. Forget to spread ARIA attributes and the linter can flag it (because the binding type includes them). Try to call an action that doesn't exist and it's a compile error.

This makes headless component libraries genuinely reliable rather than hope-and-pray correct. And because the components are pipeable, composable, testable as Effects, and carry their requirements in the type system, you can build design systems with confidence that the behavioral layer is correct, the accessibility layer is complete, and the integration layer has all its services provided.Let me trace through every Effect subsystem and how it interacts with the Component primitive.

**Scope — the most critical integration.**

Every component instance needs its own `Scope`. The setup function runs inside that scope. Every atom, query, action, ref, and subscription created during setup is attached to that scope. When the component unmounts, `Scope.close` runs, which triggers every finalizer in reverse order.

```ts
Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props, ctx) => {
    // ctx.scope is a child scope of the parent component's scope
    // Everything created through ctx is attached to ctx.scope

    const conn = ctx.query(
      () => Effect.gen(function* () {
        const api = yield* Api;
        const ws = yield* api.connectWebSocket();
        // This finalizer is attached to the component's scope
        yield* Effect.addFinalizer(() => ws.close());
        return ws;
      }),
    );

    return { conn };
  },
  (props, { conn }) => <div>{conn().status}</div>,
);
```

When this component unmounts, the scope closes, which interrupts the query fiber, which runs the finalizer, which closes the WebSocket. No manual cleanup. No `onCleanup(() => ws.close())`. Effect's scope model handles it.

But here's the first edge case: **scope close order when parent and child unmount simultaneously.** If a parent component unmounts, it closes its scope, which should close child scopes first (innermost to outermost). Effect's `Scope` already handles this — child scopes are finalized before parent scopes. But the dom-expressions owner tree also has its own disposal order. These two disposal systems need to agree. If the owner tree disposes children left-to-right but the scope tree finalizes in LIFO order, you can get mismatched cleanup sequencing where a child's DOM is removed before its scope finalizers run, or vice versa.

The solution: make `Scope.close` the single source of truth for cleanup. The owner tree's disposal should trigger `Scope.close`, and scope finalizers handle everything including DOM cleanup. Don't have two parallel cleanup systems.

```ts
// Internally, component creation should look like:
function createComponentInstance(factory, parentScope) {
  const scope = Effect.runSync(Scope.make());
  Effect.runSync(Scope.addFinalizer(parentScope, () => Scope.close(scope)));

  // Owner cleanup delegates to scope
  onCleanup(() => Effect.runSync(Scope.close(scope)));

  // Setup runs within the scope
  const bindings = Effect.runSync(
    factory.setup(props, createContext(scope)).pipe(
      Effect.provideService(Scope, scope),
    )
  );

  return bindings;
}
```

Edge case: **what if a scope finalizer throws?** Effect's `Scope.close` collects all finalizer results into a single `Exit`. If one finalizer fails, the others still run. But if a component's scope close produces a `Failure`, where does that error go? It can't propagate to the parent component's render — the component is already unmounting. Options: log it via Effect's `Logger`, propagate it to a `ComponentErrorHandler` service if one is in the layer, or add it to a `Defect` boundary. The safest default is logging plus an optional error handler:

```ts
const app = Component.mount(App, {
  layer: AppLive,
  target: root,
  onScopeError: (cause) => {
    // Called when a component scope's close produces a failure
    console.error("Component cleanup failed:", Cause.pretty(cause));
  },
});
```

Edge case: **rapid mount/unmount in the same microtask.** A component mounts, its setup starts an async query, then the component unmounts before the query fiber even starts. The scope closes, which should interrupt the fiber. But if the fiber hasn't been forked yet (it's still in the synchronous setup phase), there's nothing to interrupt. The scope finalizer runs, marks the scope as closed, and when the fiber eventually tries to fork, it should fail immediately because the scope is closed. Effect handles this correctly if every fiber fork goes through the scope:

```ts
// ctx.query should fork through the component scope
query(effect) {
  return Scope.fork(this.scope).pipe(
    Effect.flatMap((childScope) =>
      effect.pipe(
        Effect.forkIn(childScope),
      )
    ),
  );
}
```

If the scope is already closed when `Scope.fork` is called, it fails with `Cause.interrupt`, and the query never starts. This is the correct behavior.

**Fibers — structured concurrency within components.**

Every async operation in a component (queries, actions, streams) should be a fiber attached to the component's scope. This creates a supervision tree that mirrors the component tree:

```
Root Scope
├── App Component Scope
│   ├── Header Component Scope
│   │   └── auth query fiber
│   ├── UserList Component Scope
│   │   ├── users query fiber
│   │   ├── polling fiber (Schedule.spaced)
│   │   └── websocket stream fiber
│   └── Footer Component Scope
```

When UserList unmounts, its scope closes, interrupting the users query, the polling fiber, and the websocket fiber. All three are interrupted concurrently and their finalizers run.

But here's a subtle issue: **actions should survive the reactive update cycle.** If a user clicks "Save" and the action starts a mutation fiber, then a reactive update causes the component to reconfigure (not unmount, just re-derive), the action fiber should not be interrupted. Only unmount should interrupt action fibers. Query fibers, on the other hand, should restart on dependency change.

This means you need two categories of fibers within a component scope:

```ts
interface ComponentScope {
  // Fibers that restart on reactive dependency change
  readonly queryScope: Scope;

  // Fibers that persist until component unmount
  readonly actionScope: Scope;
}
```

Query fibers are forked into `queryScope`. When a query's dependencies change, the query scope closes and reopens, interrupting stale fibers. Action fibers are forked into `actionScope`, which only closes on component unmount. This prevents the "user clicked save but the mutation was interrupted because a signal changed" bug.

Edge case: **an action that outlives its component.** A user clicks "Save" on a modal, the modal closes (unmounting the component), but the save should complete. This is the "fire and forget" pattern. The action should be promoted to the parent scope:

```ts
const save = ctx.action(
  Effect.fn(function* (data: FormData) {
    const api = yield* Api;
    yield* api.save(data);
  }),
  {
    // This action's fiber is promoted to parent scope on component unmount
    detached: true,
  },
);
```

When `detached: true`, the action fiber is forked into the parent component's `actionScope` instead of the current component's. This means the modal can unmount but the save continues. The type system should reflect this — a detached action can't access the component's reactive state after unmount because the atoms are disposed.

Edge case: **concurrent actions of the same type.** User clicks "Save" twice rapidly. Should the second click interrupt the first? Queue behind it? Be dropped? This mirrors the query concurrency strategies:

```ts
const save = ctx.action(
  Effect.fn(function* (data: FormData) { /* ... */ }),
  {
    concurrency: "switch",  // interrupt previous (default)
    // or: "queue" — run sequentially
    // or: "drop" — ignore while one is running
    // or: { max: 3 } — bounded parallelism via Semaphore
  },
);
```

Each strategy maps to an Effect primitive. `switch` uses `Fiber.interrupt` on the previous fiber before forking a new one. `queue` uses `Queue.bounded(1)` as a work queue with a single consumer fiber. `drop` checks `Ref<boolean>` for in-flight status before forking. `max: N` uses `Semaphore.withPermits(1)`.

**Error channel — typed errors flowing through the component tree.**

A component's `E` type parameter represents what typed errors its async dependencies can produce. These errors need to flow through the component tree and be catchable at boundaries.

The fundamental question: when a query inside a component fails with `HttpError`, what happens?

Path 1: The `Async` component handles it locally via the `error` callback. The error is consumed. It doesn't propagate.

Path 2: No local handler. The error needs to bubble to the nearest `TypedBoundary` or `Errored` boundary in the ancestor tree.

Path 3: The error is a `Defect` (untyped). It should always propagate to the nearest defect boundary.

The mechanism for propagation should be Effect-native. When a query fiber fails, the failure is captured as a `Result.Failure(exit)` where `exit` carries the full `Cause<E>`. If no local handler exists, the component should rethrow the cause into its parent scope:

```ts
// Internally, when a query settles with a failure:
function handleQueryFailure(cause: Cause<E>, componentScope: Scope) {
  if (hasLocalErrorHandler()) {
    // Render the error locally via Async/Errored component
    setResult(Result.failure(cause));
  } else {
    // Propagate to parent scope as an error
    Effect.runSync(
      Scope.addFinalizer(componentScope, () => Effect.failCause(cause))
    );
  }
}
```

But that's not quite right — you don't want to propagate errors during scope finalization. Instead, use a dedicated error channel:

```ts
interface ComponentScope {
  readonly queryScope: Scope;
  readonly actionScope: Scope;
  readonly errorChannel: PubSub<Cause<unknown>>;
}
```

When a query fails without a local handler, it publishes the cause to `errorChannel`. The nearest boundary ancestor subscribes to descendants' error channels and renders accordingly.

Edge case: **errors during Refreshing.** A query succeeds, then the user changes a dependency, the query re-runs, and the re-run fails. The component has stale data and a new error. What should happen? Options:

```ts
// Option A: Show error, hide stale data
// Result becomes Failure(error)

// Option B: Show stale data with error indicator
// Result becomes Refreshing(previousSuccess) with error on the side

// Option C: Keep showing stale data, log error, retry
// Result stays Success(staleData), error goes to boundary
```

The `Result` type already handles this — `Refreshing` carries the previous value. But the component needs to decide whether a refresh failure should replace the previous success or coexist with it. This should be configurable per query:

```ts
const users = ctx.query(
  () => api.listUsers(),
  {
    name: "users",
    onRefreshFailure: "keep-stale",  // default: keep previous success
    // or: "replace" — show error, discard stale data
    // or: "retry" — automatically retry with schedule
  },
);
```

Edge case: **error types from composed components.** If ComponentA renders ComponentB, and ComponentB can fail with `HttpError`, but ComponentA has a `TypedBoundary` that catches `HttpError`, then ComponentA's effective `E` doesn't include `HttpError` — it's been handled. The type system needs to reflect this:

```ts
const SafeApp = App.pipe(
  Component.withErrorBoundary({
    HttpError: (e) => <RetryPanel error={e} />,
    AuthError: (e) => <LoginRedirect />,
  }),
);
// SafeApp's E is: Exclude<App's E, HttpError | AuthError>
```

Edge case: **defects vs typed errors in boundaries.** A `TypedBoundary` for `HttpError` should not catch defects. And it should not catch `AuthError`. Only the specific tagged error. The implementation should use `Cause.match` or `Cause.find` to discriminate:

```ts
// Internal boundary implementation
function handleBoundaryCause(cause: Cause<unknown>, handlers: Record<string, Handler>) {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    const error = failure.value;
    // Check if any handler matches via _tag or Schema
    for (const [tag, handler] of Object.entries(handlers)) {
      if (error._tag === tag) {
        return handler(error); // render fallback
      }
    }
  }

  // No handler matched — check for defects
  const defect = Cause.dieOption(cause);
  if (Option.isSome(defect)) {
    // Defects always propagate unless a defect handler exists
    throw defect.value;
  }

  // Interruption — not an error, just cleanup
  if (Cause.isInterruptedOnly(cause)) {
    return null; // component was interrupted, render nothing
  }

  // Unhandled typed error — propagate to parent boundary
  rethrowToParent(cause);
}
```

**Interruption — a first-class component lifecycle event.**

Effect distinguishes interruption from failure. A component being unmounted causes interruption, not failure. This distinction matters:

```ts
const data = ctx.query(
  () => Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.fetchLargeDataset().pipe(
      Effect.onInterrupt(() =>
        Effect.log("Query interrupted — component unmounted or deps changed")
      ),
    );
  }),
);
```

`Effect.onInterrupt` lets you distinguish "my data fetch was cancelled because the user navigated away" from "my data fetch failed because the server is down." The component system should preserve this distinction throughout:

```ts
// In Result type:
// Result.Loading — initial, no data
// Result.Refreshing(prev) — has stale data, fetching new
// Result.Success(value) — has data
// Result.Failure(cause) — typed error (not interruption)
// Result.Defect(cause) — untyped error (not interruption)
// Result.Interrupted — fiber was interrupted (component unmounted or deps changed)
```

Whether `Interrupted` should be a visible state in `Result` is debatable. For most UI code, interruption should be invisible — the component is already gone. But for logging and observability, knowing that a query was interrupted rather than failed is valuable. Consider making it accessible through `.exit` but not a first-class render state:

```ts
Result.match(result, {
  Loading: () => ...,
  Success: (value) => ...,
  Failure: (error) => ...,
  Defect: (defect) => ...,
  // No Interrupted case — interruption is transparent in UI
  // But accessible via:
  // Result.isInterrupted(result) — for logging
  // Result.exit(result) — full Exit for inspection
});
```

**FiberRef — component-scoped contextual values.**

Effect's `FiberRef` lets you set values that are visible to all child fibers. This is perfect for component-scoped context that should flow into Effect pipelines:

```ts
const ThemeRef = FiberRef.unsafeMake<"light" | "dark">("light");
const LocaleRef = FiberRef.unsafeMake<string>("en");

const ThemeProvider = Component.make(
  Component.props<{ theme: "light" | "dark" }>(),
  Component.require(),
  (props, ctx) => {
    // Set FiberRef for all Effects run within this component's subtree
    ctx.fiberRef(ThemeRef, () => props.theme);

    return {};
  },
  (props) => <>{props.children}</>,
);
```

When any descendant component runs an Effect (query, action, etc.), that Effect sees the `ThemeRef` value set by the nearest ancestor. This bridges reactive props into Effect's fiber-local context:

```ts
const StyledWidget = Component.make(
  Component.props<{}>(),
  Component.require(),
  (props, ctx) => {
    const theme = ctx.query(
      () => Effect.gen(function* () {
        // Reads the FiberRef set by ThemeProvider ancestor
        const theme = yield* FiberRef.get(ThemeRef);
        return theme;
      }),
    );

    return { theme };
  },
  (props, { theme }) => <div class={theme()}>Styled</div>,
);
```

This replaces the need for a separate context system (`createContext`/`useContext`). FiberRefs are Effect-native, fiber-scoped, and composable. They're also available inside Effects that run in the background (stream processing, scheduled polls), not just during synchronous rendering.

Edge case: **FiberRef changes should trigger reactive updates.** If a parent changes the theme from "light" to "dark," descendant components reading `ThemeRef` should re-render. This means `ctx.fiberRef` should create a reactive binding — when the prop changes, the FiberRef is updated, which invalidates any query that reads it. This requires tracking which FiberRefs a query depends on:

```ts
// Internally, ctx.query wraps the effect to track FiberRef reads
function trackFiberRefReads(effect: Effect<A, E, R>) {
  return Effect.gen(function* () {
    const tracker = yield* FiberRefTracker;
    // Instrument FiberRef.get to record reads
    const result = yield* effect.pipe(
      Effect.provideService(FiberRefTracker, tracker),
    );
    // tracker.reads now contains all FiberRefs this effect depends on
    return result;
  });
}
```

This is complex. A simpler alternative: use reactive atoms for component-level context and reserve FiberRefs for truly fiber-scoped values like tracing context, correlation IDs, and request scoping:

```ts
// Reactive context — use atoms
const theme = Atom.make<"light" | "dark">("light");
// Descendants read theme() reactively

// Fiber context — use FiberRefs (non-reactive, for tracing/correlation)
const CorrelationId = FiberRef.unsafeMake<string>("none");
// Used inside Effects for logging, not for UI
```

**Supervisor — monitoring component fiber trees.**

Effect's `Supervisor` lets you observe fiber lifecycle events. This is powerful for observability:

```ts
const ComponentSupervisor = Supervisor.track;

// Attach supervisor to the mount
const app = Component.mount(App, {
  layer: AppLive,
  target: root,
  supervisor: ComponentSupervisor,
});

// Later — inspect all running fibers in the component tree
const fibers = Effect.runSync(ComponentSupervisor.value);
// fibers is a Set of all active Fiber instances
// Useful for debugging, monitoring, and diagnostics
```

A more targeted supervisor could track fibers by component:

```ts
const diagnostics = Component.diagnostics(App, {
  layer: AppLive,
  target: root,
});

// Get live component tree state
diagnostics.componentTree();
// Returns:
// {
//   name: "App",
//   scope: { status: "open", fibers: 2 },
//   children: [
//     { name: "UserList", scope: { status: "open", fibers: 3 }, children: [...] },
//     { name: "Header", scope: { status: "open", fibers: 1 }, children: [] },
//   ]
// }
```

This would be extraordinary for developer tooling. A devtools panel that shows the component tree with live fiber counts, scope statuses, and error states — all derived from Effect's runtime introspection.

**Layer — dynamic layer provision through components.**

`WithLayer` provides a layer to a subtree. But layers can be expensive to build. The component system needs to handle layer lifecycle carefully:

```ts
<WithLayer layer={DbLive}>
  <DataPanel />
</WithLayer>
```

When `WithLayer` mounts, it builds the `ManagedRuntime` from `DbLive`. When it unmounts, it shuts down the runtime. If `DbLive` has acquisition (connect to database) and release (disconnect) logic, those run on mount and unmount respectively.

Edge case: **layer that depends on reactive values.** What if the database URL comes from an atom?

```tsx
const dbUrl = Atom.make("postgres://localhost:5432/dev");

// The layer depends on a reactive value
const DynamicDbLive = Layer.effect(Db, () =>
  Effect.gen(function* () {
    const url = dbUrl(); // reactive read
    return yield* connectToDb(url);
  })
);

<WithLayer layer={DynamicDbLive}>
  <DataPanel />
</WithLayer>
```

When `dbUrl` changes, should the layer rebuild? If yes, all descendant components need to unmount, the old runtime needs to shut down, the new runtime needs to build, and descendants need to remount. This is expensive. The library should either prevent reactive values in layers (layers are static by design) or handle the rebuild explicitly:

```tsx
<WithLayer
  layer={DynamicDbLive}
  deps={[dbUrl]}  // explicit dependency tracking
  strategy="rebuild"  // or "keep" to ignore changes
  loading={() => <p>Reconnecting...</p>}
>
  <DataPanel />
</WithLayer>
```

Edge case: **layer build failure.** `Layer.effect` can fail. What if the database connection fails when `WithLayer` mounts?

```tsx
<WithLayer
  layer={DbLive}
  onBuildError={(cause) => <ConnectionErrorPanel cause={cause} />}
>
  <DataPanel />
</WithLayer>
```

The `E` from the layer build becomes part of the component's error channel. A `TypedBoundary` above should be able to catch it. This means `WithLayer` needs to surface the layer's error type:

```ts
// WithLayer's type includes the layer's error channel
type WithLayerProps<RIn, ROut, E> = {
  layer: Layer<ROut, E, RIn>;
  children: JSX.Element;
  onBuildError?: (cause: Cause<E>) => JSX.Element;
};
```

**Schedule — component-level scheduling.**

Queries already support `retrySchedule` and `pollSchedule`. But scheduling should also work at the component level:

```ts
const Dashboard = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props, ctx) => {
    // Refresh all queries in this component every 30 seconds
    ctx.schedule(Schedule.spaced("30 seconds"), () => {
      ctx.refreshAll(); // invalidate all queries in this component's scope
    });

    // Or schedule an arbitrary Effect
    ctx.scheduleEffect(
      Schedule.exponential("1 second").pipe(Schedule.compose(Schedule.recurs(10))),
      Effect.gen(function* () {
        const api = yield* Api;
        yield* api.heartbeat();
      }),
    );

    return { /* ... */ };
  },
  () => <div />,
);
```

The scheduled fiber is attached to the component's scope. When the component unmounts, the schedule is cancelled. No manual cleanup.

Edge case: **schedule drift when the component is hidden but mounted.** If the user switches to a different tab, `requestAnimationFrame` and `setTimeout` can be throttled. For a `Schedule.spaced("30 seconds")` poll, this means the poll might not fire for minutes. When the tab becomes active again, should all missed polls fire at once? Probably not — use `Schedule.spaced` (which waits between completions) rather than `Schedule.fixed` (which tries to maintain wall-clock intervals). Document this.

**Stream and PubSub — cross-component communication.**

Headless components often need to communicate. A toast manager needs to receive toast events from anywhere. A global error handler needs to receive errors from all components. `PubSub` is the natural primitive:

```ts
const ToastBus = PubSub.unbounded<ToastEvent>();

const ToastProvider = Component.headless(
  Component.props<{}>(),
  Component.require(),
  (props, ctx) => {
    const toasts = ctx.state<readonly ToastEvent[]>([]);

    // Subscribe to the bus — fiber attached to component scope
    ctx.fromPubSub(ToastBus, (event) => {
      toasts.update((prev) => [...prev, event]);
      // Auto-dismiss after duration
      ctx.scheduleEffect(
        Schedule.once.pipe(Schedule.delayed(event.duration ?? "5 seconds")),
        Effect.sync(() => toasts.update((prev) => prev.filter((t) => t !== event))),
      );
    });

    const dismiss = (event: ToastEvent) =>
      toasts.update((prev) => prev.filter((t) => t !== event));

    return { toasts, dismiss };
  },
);

// Any component can publish a toast
const SaveButton = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props, ctx) => {
    const save = ctx.action(
      Effect.fn(function* () {
        const api = yield* Api;
        yield* api.save();
        // Publish to the toast bus
        yield* PubSub.publish(ToastBus, {
          message: "Saved successfully",
          type: "success",
        });
      }),
    );
    return { save };
  },
  (props, { save }) => <button onClick={() => save()}>Save</button>,
);
```

Edge case: **PubSub backpressure.** If a producer publishes faster than the consumer processes, what happens? `PubSub.unbounded` has no limit. `PubSub.bounded(N)` drops or blocks. For UI events, dropping is usually correct — you don't want a queue of 1000 toast events. Make the default bounded with a sliding window:

```ts
ctx.fromPubSub(ToastBus, handler, {
  strategy: "sliding",  // drop oldest when full
  capacity: 50,
});
```

**Ref and SynchronizedRef — shared mutable state with guarantees.**

Some component state needs atomic read-modify-write. Effect's `Ref` and `SynchronizedRef` provide this. Consider a multi-step wizard where two components might try to update the step simultaneously:

```ts
const WizardState = Component.headless(
  Component.props<{}>(),
  Component.require(),
  (props, ctx) => {
    // SynchronizedRef for atomic updates with effectful validation
    const step = ctx.syncRef(0);

    const nextStep = ctx.action(
      Effect.fn(function* () {
        yield* SynchronizedRef.updateEffect(step.ref, (current) =>
          current >= 3
            ? Effect.fail(new WizardCompleteError())
            : Effect.succeed(current + 1)
        );
      }),
    );

    return { step: step.atom, nextStep };
  },
);
```

`ctx.syncRef(initial)` creates a `SynchronizedRef` attached to the component scope and exposes a reactive `atom` view of its value. Writes go through the `SynchronizedRef` (atomic, effectful), reads go through the atom (reactive, synchronous). This bridges Effect's concurrency-safe state with the reactive rendering layer.

**STM — transactional multi-atom updates.**

For cases where multiple atoms must update atomically:

```ts
const balance = ctx.state(100);
const inventory = ctx.state(10);

const purchase = ctx.action(
  Effect.fn(function* (price: number) {
    // STM transaction — both update atomically or neither does
    yield* STM.commit(
      STM.gen(function* () {
        const bal = yield* Atom.stm.get(balance);
        const inv = yield* Atom.stm.get(inventory);
        if (bal < price || inv <= 0) {
          yield* STM.fail(new InsufficientFundsError());
        }
        yield* Atom.stm.set(balance, bal - price);
        yield* Atom.stm.set(inventory, inv - 1);
      }),
    );
  }),
);
```

This requires atoms to have STM-compatible backing stores (`TRef` instead of plain `Ref`). That's a deeper architectural change. Worth considering for a future phase, but note the implication: if atoms are backed by `TRef`, all atom reads and writes go through STM, which has performance implications. The alternative is an explicit `Atom.transactional(initial)` constructor that creates a `TRef`-backed atom:

```ts
const balance = ctx.transactionalState(100);  // backed by TRef
const inventory = ctx.transactionalState(10); // backed by TRef
const name = ctx.state("Alice");              // backed by plain Ref (faster)
```

**Testing implications for all of this:**

```ts
// Component.setupEffect now carries the full scope/fiber/error story
const test = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const bindings = yield* Component.setupEffect(DataTable, {
    endpoint: "/users",
    columns: cols,
  }).pipe(
    Effect.provideService(Scope, scope),
    Effect.provide(TestApiLayer),
    Effect.provide(TestAuthLayer),
  );

  // Test query behavior
  yield* TestClock.adjust("100 millis"); // let query fiber settle
  assert.deepEqual(bindings.data(), Result.success([...]));

  // Test action behavior
  yield* bindings.deleteSelected.run();
  yield* TestClock.adjust("100 millis");

  // Test scope cleanup
  yield* Scope.close(scope, Exit.unit);
  // All fibers interrupted, all finalizers run
  // Verify via supervisor or mock service
});
```

Effect's `TestClock` controls time. `TestServices` can verify fiber lifecycle. `Supervisor.track` can count active fibers after cleanup. The component's entire lifecycle is testable through Effect's testing primitives.

**Ideas to keep in mind:**

Devtools could visualize the component tree as a scope tree with live fiber status, error states, and performance metrics — all derived from Effect's introspection capabilities.

Hot module replacement needs to close the old component's scope and open a new one, transferring state. The scope's finalizer list gives you a clear inventory of what needs to be cleaned up, and the atom graph gives you a clear inventory of what state to preserve.

Server components could be expressed as `Component<Props, Req, E>` where the setup runs on the server (inside a server-side Effect runtime) and the view serializes to HTML. The `Req` type tells you which services must be available server-side. The `E` type tells you what errors the server render can produce. SSR becomes a typed Effect pipeline:

```ts
const html: Effect<string, HttpError | DbError, Api | Db> =
  Component.renderToStringEffect(App, { url: req.url });
```

Resource preloading could be expressed as "run all queries in the component tree's setup functions, collect their results, serialize to the HTML response." The scope tree gives you the exact set of queries. The typed requirements tell you which layers to provide. The error channel tells you what can go wrong.

The overall point is that making `Component` a typed Effect-aware primitive doesn't just add type safety to the UI layer — it makes the component tree a structured, inspectable, testable Effect program. Every component becomes a scoped Effect with typed inputs, typed errors, typed requirements, and structured concurrency. The UI framework becomes an Effect application framework where rendering is just one of many observable side effects.These are all the right questions and they point toward a deeper redesign of the setup function.

**Setup should be an Effect.**

Right now setup is a plain function that receives `ctx` and returns bindings synchronously. But everything it does — creating atoms, forking query fibers, acquiring services, attaching finalizers — is effectful. Making setup a plain function means all of that effectful work is hidden behind imperative `ctx` methods, which loses tracing, typed errors, and composability. If setup is an Effect, everything follows naturally:

```ts
const UserCard = Component.make(
  Component.props<{ id: string }>(),
  Component.require(Api, Auth),

  // Setup is an Effect — scoped, traced, typed errors, composable
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const auth = yield* Auth;

    const user = yield* Component.query(
      () => api.findUser(props.id),
      { name: `user:${props.id}` },
    );

    const canEdit = yield* Component.derived(() =>
      auth.currentRole() === "admin"
    );

    const save = yield* Component.action(
      Effect.fn(function* (data: UserData) {
        yield* api.updateUser(props.id, data);
      }),
      { reactivityKeys: ["users"] },
    );

    // Finalizer — runs on unmount, managed by scope
    yield* Effect.addFinalizer(() =>
      Effect.log(`UserCard ${props.id} unmounting`)
    );

    return { user, canEdit, save };
  }),

  // View — pure template
  (props, { user, canEdit, save }) => (
    <Async
      result={user()}
      success={(u) => <div>{u.name}</div>}
    />
  ),
);
```

Services come from `yield*` — the standard Effect pattern. No special `ctx.service()` method. `Component.query`, `Component.derived`, `Component.action` are Effects that return reactive primitives. They're scoped to the component automatically because the entire setup runs inside the component's `Scope`.

The type of the setup Effect carries everything:

```ts
// Setup type:
Effect<
  { user: ReadonlyAtom<Result<User, HttpError>>; canEdit: ReadonlyAtom<boolean>; save: Action<...> },
  never,          // E — setup itself doesn't fail (queries fail later, asynchronously)
  Api | Auth      // R — required services
>
```

`R` is inferred from the `yield*` calls. The compiler verifies that `Component.require(Api, Auth)` matches the actual requirements. If you `yield* Db` inside setup without declaring it in `require`, that's a type error.

**Tracing becomes automatic.**

Because setup is an Effect, you can span it:

```ts
const UserCard = Component.make(
  Component.props<{ id: string }>(),
  Component.require(Api),

  (props) => Effect.gen(function* () {
    const api = yield* Api;

    const user = yield* Component.query(
      () => api.findUser(props.id),
      { name: `user:${props.id}` },
    );

    return { user };
  }).pipe(
    // Automatic span for setup
    Effect.withSpan("UserCard.setup", {
      attributes: { "component.props.id": props.id },
    }),
  ),

  (props, { user }) => <div>{user().name}</div>,
);
```

But you shouldn't have to add spans manually to every component. The `Component.make` constructor should add them automatically:

```ts
// Component.make internally wraps setup with a span
function make(propsSpec, requireSpec, setup, view) {
  const wrappedSetup = (props) =>
    setup(props).pipe(
      Effect.withSpan(`Component(${name}).setup`, {
        attributes: propsToAttributes(props),
      }),
    );
  // ...
}
```

Every component setup gets a span. Every query forked during setup gets a child span. Every action invoked later gets a child span of the component's root span. The trace tree mirrors the component tree:

```
Span: Component(App).setup
├── Span: Component(Header).setup
│   └── Span: query:auth
├── Span: Component(UserList).setup
│   ├── Span: query:users
│   └── Span: query:permissions
└── Span: Component(Footer).setup
```

When a user clicks a button and triggers an action:

```
Span: action:addUser
├── Span: Api.addUser (HTTP call)
└── Span: invalidate:users
    └── Span: query:users (refetch)
```

All of this comes for free because setup is an Effect and queries/actions are Effects. The tracing infrastructure is Effect's. No custom instrumentation needed.

For metrics, the same pattern:

```ts
// Component.make internally tracks metrics
function make(propsSpec, requireSpec, setup, view) {
  const setupDuration = Metric.histogram("component.setup.duration", {
    boundaries: [10, 50, 100, 250, 500, 1000],
  });

  const wrappedSetup = (props) =>
    setup(props).pipe(
      Effect.withSpan(`Component(${name}).setup`),
      Metric.trackDuration(setupDuration),
    );
}
```

Setup duration, query latency, action duration, error rates — all automatic via Effect's metrics. If no `Tracer` or `Metric` service is in the layer, these are no-ops. Zero cost unless opted in.

**Pipeability of components becomes much richer.**

When setup is an Effect, component transformations are Effect transformations:

```ts
const UserCard = Component.make(
  Component.props<{ id: string }>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const user = yield* Component.query(() => api.findUser(props.id));
    return { user };
  }),
  (props, { user }) => <div>{user().name}</div>,
);
```

Now pipes can transform the setup Effect directly:

```ts
const EnhancedUserCard = UserCard.pipe(
  // Add a layer — eliminates Auth from requirements
  Component.withLayer(AuthLive),

  // Add error boundary — handles HttpError
  Component.withErrorBoundary({ HttpError: (e) => <RetryPanel error={e} /> }),

  // Add logging to setup
  Component.tapSetup((bindings) =>
    Effect.log(`UserCard setup complete, user loaded: ${bindings.user}`)
  ),

  // Add a pre-setup effect — runs before the component's own setup
  Component.withPreSetup(
    Effect.gen(function* () {
      yield* Effect.log("UserCard mounting");
    })
  ),

  // Retry the entire setup if it fails
  Component.withSetupRetry(Schedule.exponential("100 millis").pipe(
    Schedule.compose(Schedule.recurs(3)),
  )),

  // Timeout the setup
  Component.withSetupTimeout("5 seconds"),

  // Add tracing span with custom attributes
  Component.withSpan("UserCard", { tier: "premium" }),

  // Memoize
  Component.memo((prev, next) => prev.id === next.id),
);
```

Each pipe step transforms the underlying setup Effect. `Component.withSetupRetry` wraps the setup with `Effect.retry`. `Component.withSetupTimeout` wraps with `Effect.timeout`. `Component.tapSetup` adds `Effect.tap` after setup completes. These are all standard Effect combinators — the Component pipe just applies them to the setup Effect.

**Partial application and component factories:**

Because setup is an Effect and components are values, partial application works naturally:

```ts
// A component factory that pre-configures behavior
const withPagination = <P, R, E>(
  component: Component<P & { page: number; pageSize: number }, R, E>,
  defaults: { pageSize?: number } = {},
) => {
  return Component.make(
    Component.props<Omit<P, "page" | "pageSize">>(),
    Component.require<R>(),

    (props) => Effect.gen(function* () {
      const page = yield* Component.state(0);
      const pageSize = yield* Component.state(defaults.pageSize ?? 20);

      const inner = yield* Component.setupChild(component, {
        ...props,
        page: page(),
        pageSize: pageSize(),
      } as any);

      return {
        ...inner,
        page, pageSize,
        nextPage: () => page.update((p) => p + 1),
        prevPage: () => page.update((p) => Math.max(0, p - 1)),
      };
    }),

    (props, bindings) => (
      <div>
        {Component.renderChild(component, bindings)}
        <div class="pagination">
          <button onClick={bindings.prevPage}>Prev</button>
          <span>Page {bindings.page()}</span>
          <button onClick={bindings.nextPage}>Next</button>
        </div>
      </div>
    ),
  );
};

const PaginatedUserList = withPagination(UserList, { pageSize: 10 });
```

Higher-order components are just functions that transform `Component` values. Because the setup is an Effect, the HoC can inject effects before, after, or around the original setup. Because requirements and errors are in the type, the composed component's type is inferred correctly.

**Effect's PubSub integration:**

You're right that I used a bare `PubSub` in the previous examples when it should go through Effect's scoped `PubSub`. Effect's `PubSub` is created as an Effect and subscriptions are scoped:

```ts
// PubSub should be a service, not a bare value
class ToastBus extends Effect.Tag("ToastBus")<
  ToastBus,
  PubSub.PubSub<ToastEvent>
>() {
  static Live = Layer.effect(
    ToastBus,
    PubSub.bounded<ToastEvent>(100),
  );
}
```

Now it's a proper service with a Layer. Components that publish or subscribe declare it as a requirement:

```ts
const ToastProvider = Component.headless(
  Component.props<{}>(),
  Component.require(ToastBus),

  () => Effect.gen(function* () {
    const bus = yield* ToastBus;
    const toasts = yield* Component.state<readonly ToastEvent[]>([]);

    // Subscribe — scoped to this component's Scope automatically
    // When the component unmounts, the subscription is closed
    const subscription = yield* PubSub.subscribe(bus);

    // Consume the subscription as a stream
    yield* Component.fromDequeue(subscription, (event) => {
      toasts.update((prev) => [...prev, event]);
    });

    const dismiss = (id: string) =>
      toasts.update((prev) => prev.filter((t) => t.id !== id));

    return { toasts, dismiss };
  }),
);

const SaveButton = Component.make(
  Component.props<{}>(),
  Component.require(Api, ToastBus),

  () => Effect.gen(function* () {
    const api = yield* Api;
    const bus = yield* ToastBus;

    const save = yield* Component.action(
      Effect.fn(function* () {
        yield* api.save();
        yield* PubSub.publish(bus, {
          id: crypto.randomUUID(),
          message: "Saved",
          type: "success",
        });
      }),
    );

    return { save };
  }),

  (props, { save }) => <button onClick={() => save()}>Save</button>,
);
```

The critical difference from my earlier example: `PubSub.subscribe` returns a scoped `Dequeue`. Because setup is an Effect running inside a `Scope`, the subscription is automatically attached to the component's scope. When the component unmounts, the subscription is closed. No manual cleanup. This is exactly how Effect's resource model is designed to work — the component's setup Effect is the scope, and scoped resources are managed automatically.

`Component.fromDequeue` is a helper that takes a `Dequeue` and a handler, forks a fiber that continuously takes from the dequeue and calls the handler, and attaches that fiber to the component's scope. It's sugar over:

```ts
yield* Stream.fromQueue(subscription).pipe(
  Stream.runForEach((event) => Effect.sync(() => handler(event))),
  Effect.forkScoped,
);
```

**Queue-based communication between sibling components:**

For request/response patterns rather than broadcast:

```ts
class CommandBus extends Effect.Tag("CommandBus")<
  CommandBus,
  Queue.Queue<Command>
>() {
  static Live = Layer.effect(
    CommandBus,
    Queue.bounded<Command>(256),
  );
}

const CommandProcessor = Component.make(
  Component.props<{}>(),
  Component.require(CommandBus, Api),

  () => Effect.gen(function* () {
    const queue = yield* CommandBus;
    const api = yield* Api;
    const lastResult = yield* Component.state<Result<void, CommandError>>(Result.loading());

    // Process commands sequentially from the queue
    yield* Stream.fromQueue(queue).pipe(
      Stream.mapEffect((cmd) =>
        api.executeCommand(cmd).pipe(
          Effect.tapBoth({
            onSuccess: () => Effect.sync(() => lastResult.set(Result.success(undefined))),
            onFailure: (e) => Effect.sync(() => lastResult.set(Result.failure(e))),
          }),
          // Don't let one failure kill the stream
          Effect.catchAll(() => Effect.void),
        )
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );

    return { lastResult };
  }),

  (props, { lastResult }) => (
    <Async result={lastResult()} success={() => <span>OK</span>} />
  ),
);
```

**Full tracing story with setup as Effect:**

When setup is an Effect, the entire component lifecycle is traceable without any special infrastructure:

```ts
// In Component.make internals:
function mountComponent(factory, parentScope, props) {
  return Effect.gen(function* () {
    // Create child scope
    const scope = yield* Scope.fork(parentScope);

    // Run setup in scope — spans, metrics, logging all work
    const bindings = yield* factory.setup(props).pipe(
      Effect.provideService(Scope, scope),

      // Automatic component span
      Effect.withSpan(`Component(${factory.name}).setup`, {
        attributes: {
          "component.name": factory.name,
          "component.props": JSON.stringify(props),
        },
      }),

      // Automatic setup duration metric
      Metric.trackDuration(componentSetupDuration),
    );

    // Track mount event
    yield* Effect.annotateCurrentSpan("component.status", "mounted");

    // Register unmount in scope finalizer
    yield* Scope.addFinalizer(scope, () =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan("component.status", "unmounting");
        yield* Effect.log(`Component ${factory.name} unmounting`);
      }).pipe(
        Effect.withSpan(`Component(${factory.name}).unmount`),
        Metric.trackDuration(componentUnmountDuration),
      )
    );

    return { bindings, scope };
  });
}
```

Every component mount is a span. Every unmount is a span. Every query within a component is a child span. The trace tree is the component tree. And because it's all Effect, you can plug in any Effect-compatible tracing backend — Jaeger, Honeycomb, Datadog, console logging — just by adding the right `Tracer` layer:

```ts
Component.mount(App, {
  layer: Layer.mergeAll(
    AppLive,
    // Add tracing — all component spans go to Honeycomb
    HoneycombTracer.layer({ apiKey: "..." }),
    // Or console tracing for dev
    // ConsoleTracer.layer,
  ),
  target: root,
});
```

No tracing layer? Spans are no-ops. Zero cost in production unless you want it.

**What `Component.query`, `Component.action`, etc. look like as Effects:**

These are the primitives that the setup Effect yields. Each one returns a reactive primitive and registers cleanup with the current scope:

```ts
declare namespace Component {
  // Create a reactive query — returns an atom backed by an Effect fiber
  function query<A, E>(
    effect: () => Effect<A, E>,
    options?: QueryOptions,
  ): Effect<ReadonlyAtom<Result<A, E>>, never, Scope>;

  // Create a reactive derived value
  function derived<A>(
    fn: () => A,
  ): Effect<ReadonlyAtom<A>, never, Scope>;

  // Create writable state
  function state<A>(
    initial: A,
  ): Effect<WritableAtom<A>, never, Scope>;

  // Create an action
  function action<Args extends readonly unknown[], A, E>(
    fn: (...args: Args) => Effect<A, E>,
    options?: ActionOptions,
  ): Effect<Action<Args, A, E>, never, Scope>;

  // Create a ref
  function ref<T extends HTMLElement>(): Effect<ComponentRef<T>, never, Scope>;

  // Subscribe to a Dequeue (from PubSub.subscribe)
  function fromDequeue<A>(
    dequeue: Dequeue<A>,
    handler: (a: A) => void,
  ): Effect<void, never, Scope>;
}
```

Every one of these requires `Scope` in its `R` channel. The component's setup runs inside a `Scope`, so the requirement is satisfied automatically. When the scope closes, all queries are interrupted, all subscriptions are closed, all refs are cleared.

The beautiful part: because these are Effects, you can compose them with standard Effect combinators:

```ts
// Create multiple queries concurrently
const [users, orders, metrics] = yield* Effect.all([
  Component.query(() => api.listUsers()),
  Component.query(() => api.listOrders()),
  Component.query(() => api.getMetrics()),
], { concurrency: "unbounded" });

// Create a query only if a condition is met
const adminPanel = yield* auth.isAdmin()
  ? Component.query(() => api.getAdminData()).pipe(Effect.map(Option.some))
  : Effect.succeed(Option.none());

// Create a family of queries from a list
const userQueries = yield* Effect.forEach(
  userIds,
  (id) => Component.query(() => api.findUser(id), { name: `user:${id}` }),
  { concurrency: 5 },
);
```

`Effect.all` with concurrency, `Effect.forEach`, conditional Effects — all of these work naturally because the primitives are Effects. Try doing this with imperative `ctx` methods and you'll be fighting the framework.

**Partial application at the setup level:**

Because setup is an Effect-returning function, partial application is function composition:

```ts
// A setup fragment that adds authentication state
const withAuth = () => Effect.gen(function* () {
  const auth = yield* Auth;
  const currentUser = yield* Component.query(() => auth.currentUser());
  const isAdmin = yield* Component.derived(() =>
    Result.match(currentUser(), {
      Success: (u) => u.role === "admin",
      orElse: () => false,
    })
  );
  return { currentUser, isAdmin };
});

// A setup fragment that adds data fetching
const withUsers = () => Effect.gen(function* () {
  const api = yield* Api;
  const users = yield* Component.query(
    () => api.listUsers(),
    { name: "users" },
  );
  return { users };
});

// Compose setup fragments
const AdminDashboard = Component.make(
  Component.props<{}>(),
  Component.require(Api, Auth),

  () => Effect.gen(function* () {
    const auth = yield* withAuth();
    const data = yield* withUsers();
    return { ...auth, ...data };
  }),

  (props, { currentUser, isAdmin, users }) => (
    <Show when={isAdmin()}>
      <Async result={users()} success={(xs) => <UserTable users={xs} />} />
    </Show>
  ),
);
```

Setup fragments are just functions that return Effects. They compose via `yield*`. Their requirements (`R`) accumulate automatically. Their error types (`E`) accumulate automatically. No special framework mechanism needed — it's just Effect composition.

This is where the design becomes genuinely powerful. You can build libraries of setup fragments:

```ts
// @my-org/component-mixins
export const withPagination = (options?: PaginationOptions) =>
  Effect.gen(function* () {
    const page = yield* Component.state(0);
    const pageSize = yield* Component.state(options?.pageSize ?? 20);
    return {
      page, pageSize,
      nextPage: () => page.update((p) => p + 1),
      prevPage: () => page.update((p) => Math.max(0, p - 1)),
      setPageSize: pageSize.set,
    };
  });

export const withSelection = <T,>() =>
  Effect.gen(function* () {
    const selected = yield* Component.state<Set<T>>(new Set());
    return {
      selected,
      toggle: (item: T) => selected.update((s) => {
        const next = new Set(s);
        next.has(item) ? next.delete(item) : next.add(item);
        return next;
      }),
      selectAll: (items: T[]) => selected.set(new Set(items)),
      clearSelection: () => selected.set(new Set()),
    };
  });

export const withSorting = <T,>(columns: readonly string[]) =>
  Effect.gen(function* () {
    const sortColumn = yield* Component.state<string | null>(null);
    const sortDirection = yield* Component.state<"asc" | "desc">("asc");
    return {
      sortColumn, sortDirection,
      sort: (col: string) => {
        if (sortColumn() === col) {
          sortDirection.update((d) => d === "asc" ? "desc" : "asc");
        } else {
          sortColumn.set(col);
          sortDirection.set("asc");
        }
      },
    };
  });

// Compose in any component
const DataGrid = Component.make(
  Component.props<{ endpoint: string }>(),
  Component.require(Api),

  (props) => Effect.gen(function* () {
    const pagination = yield* withPagination({ pageSize: 25 });
    const selection = yield* withSelection<string>();
    const sorting = yield* withSorting(["name", "email", "date"]);

    const api = yield* Api;
    const data = yield* Component.query(
      () => api.fetch({
        endpoint: props.endpoint,
        page: pagination.page(),
        pageSize: pagination.pageSize(),
        sort: sorting.sortColumn()
          ? { column: sorting.sortColumn()!, direction: sorting.sortDirection() }
          : undefined,
      }),
      { name: `grid:${props.endpoint}` },
    );

    return { ...pagination, ...selection, ...sorting, data };
  }),

  (props, bindings) => (
    // Full grid rendering with all behaviors composed
    <div>...</div>
  ),
);
```

Three reusable behavior fragments, composed via `yield*`, with requirements and errors inferred automatically. This is React hooks done right — hooks that are actually composable, typed, scoped, and traceable.

**Headless components with setup as Effect:**

The headless pattern becomes cleaner because the setup is already an Effect:

```ts
const Combobox = Component.headless(
  Component.props<{ items: readonly string[]; onSelect: (item: string) => void }>(),
  Component.require(),

  (props) => Effect.gen(function* () {
    const query = yield* Component.state("");
    const isOpen = yield* Component.state(false);
    const activeIndex = yield* Component.state(0);
    const inputRef = yield* Component.ref<HTMLInputElement>();
    const listRef = yield* Component.ref<HTMLUListElement>();

    const filtered = yield* Component.derived(() => {
      const q = query();
      return q
        ? props.items.filter((i) => i.toLowerCase().includes(q.toLowerCase()))
        : props.items;
    });

    // ... rest of behavior

    return { query, isOpen, activeIndex, filtered, inputRef, listRef, /* ... */ };
  }),
);
```

Testing the headless component is testing an Effect:

```ts
const test = Effect.gen(function* () {
  const bindings = yield* Component.setupEffect(Combobox, {
    items: ["apple", "banana", "cherry"],
    onSelect: () => {},
  });

  assert.equal(bindings.filtered().length, 3);
  bindings.query.set("ba");
  yield* Effect.yieldNow(); // flush microtask batch
  assert.equal(bindings.filtered().length, 1);
});

await Effect.runPromise(test.pipe(Effect.scoped));
```

`Effect.scoped` provides the scope. When the test completes, the scope closes, cleaning up everything the headless component created. No manual disposal.

**Edge cases with setup as Effect:**

**Setup that fails.** If the setup Effect fails (not a query inside it — the setup itself), the component can't render. This should be caught by the nearest error boundary:

```ts
(props) => Effect.gen(function* () {
  const api = yield* Api;
  // What if this fails?
  const config = yield* api.getRequiredConfig();
  if (!config.featureEnabled) {
    yield* Effect.fail(new FeatureDisabledError());
  }
  // ...
})
```

`Component.make` should wrap the setup in error handling that routes setup failures to the nearest boundary. The component's `E` type includes setup failures.

**Setup that's slow.** If setup takes time (maybe it's doing a synchronous precomputation, or waiting for a service to initialize), the component should show a loading state. This is where `Component.withLoading` applies:

```ts
const SlowComponent = Component.make(
  // ...
  (props) => Effect.gen(function* () {
    yield* Effect.sleep("2 seconds"); // slow initialization
    return { /* ... */ };
  }),
  // ...
).pipe(
  Component.withLoading(() => <Skeleton />),
);
```

**Setup that needs to re-run.** Normally setup runs once. But if a prop changes in a way that requires a full re-setup (like a route change that needs different services), the component should be re-keyed by the parent:

```tsx
// Parent re-keys when route changes, causing full re-setup
<UserCard key={userId()} id={userId()} />
```

Or the component can handle prop changes internally through reactive queries that depend on props.

**Setup ordering in concurrent component trees.** If a parent has three children that all mount simultaneously, their setup Effects run concurrently. This is usually fine, but if they share resources (like a bounded connection pool), the concurrency needs to be managed. Effect's `Semaphore` handles this if the shared resource is a service:

```ts
class ConnectionPool extends Effect.Tag("ConnectionPool")<
  ConnectionPool,
  Semaphore
>() {
  static Live = Layer.effect(
    ConnectionPool,
    Semaphore.make(5), // max 5 concurrent connections
  );
}
```

Components that need a connection acquire a permit from the semaphore during setup. This is automatic if the service's methods internally use `Semaphore.withPermits`.

**One more implication: the view function could also be an Effect.**

For components that need to do effectful work at render time (rare, but exists for SSR, canvas rendering, etc.):

```ts
const Chart = Component.make(
  Component.props<{ data: number[] }>(),
  Component.require(),

  // Setup
  (props) => Effect.gen(function* () {
    const canvas = yield* Component.ref<HTMLCanvasElement>();
    return { canvas };
  }),

  // View as Effect (optional — most views are pure)
  Component.effectView((props, { canvas }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Rendering chart with ${props.data.length} points`);
      return (
        <canvas ref={canvas} width={800} height={400} />
      );
    })
  ),
);
```

But this should be rare. The default view is a pure function. Only use an Effect view when you have a genuine reason — most tracing should happen in setup and actions, not in the view.

**The final type architecture:**

```
Component<Props, Req, E>
  Props → input type
  Req → service requirements (inferred from yield* in setup)
  E → error channel (inferred from Effects in setup + queries + actions)

Setup: (props: Props) → Effect<Bindings, SetupError, Req | Scope>
View: (props: Props, bindings: Bindings) → JSX.Element

Component.query    → Effect<ReadonlyAtom<Result<A, E>>, never, Scope>
Component.state    → Effect<WritableAtom<A>, never, Scope>
Component.derived  → Effect<ReadonlyAtom<A>, never, Scope>
Component.action   → Effect<Action<Args, A, E>, never, Scope>
Component.ref      → Effect<ComponentRef<T>, never, Scope>

Pipes transform the setup Effect:
  withLayer     → Effect.provide (eliminates from Req)
  withRetry     → Effect.retry
  withTimeout   → Effect.timeout
  withSpan      → Effect.withSpan
  tapSetup      → Effect.tap
  withLoading   → Effect.catchTag for loading state

Setup fragments compose via yield*:
  withPagination()  → Effect<PaginationBindings, never, Scope>
  withSelection()   → Effect<SelectionBindings, never, Scope>
  withSorting()     → Effect<SortingBindings, never, Scope>

Everything is:
  - Scoped (cleanup is automatic via Scope)
  - Traced (spans are automatic via Effect.withSpan)
  - Typed (R, E flow through the entire chain)
  - Composable (yield*, pipe, flow)
  - Testable (Effect.runPromise + Effect.scoped)
```

Making setup an Effect isn't just a cleaner API — it makes the component a first-class Effect program. Every tool in Effect's toolbox (retry, timeout, tracing, metrics, supervision, concurrency, resource management, testing) works on components without any framework-specific abstraction layer. The framework becomes a thin bridge between Effect programs and DOM rendering.Yes. That's the entire point. Effect's service system already is a context system — it's just a better one than what any UI framework has built.

Think about what React's `createContext`/`useContext` actually does: you declare a value somewhere in the tree, and descendants access it by key. The problems are that the value can be undefined if no provider exists, the type system can't enforce that a provider is present, there's no cleanup when the provider unmounts, and nesting/overriding is manual.

Effect's `yield* MyService` does all of that with full type safety. If you `yield*` a service in your setup Effect, it appears in the `R` type parameter. If no layer provides it, the compiler rejects the program. No runtime "context is undefined" errors. No default values as a workaround for missing providers.

```tsx
// React pattern — unsafe
const Theme = createContext<"light" | "dark">("light"); // default hides missing provider
function Card() {
  const theme = useContext(Theme); // always returns string, even if no provider
  return <div class={theme}>...</div>;
}

// Effect pattern — safe
class Theme extends Effect.Tag("Theme")<Theme, { readonly current: "light" | "dark" }>() {}

const Card = Component.make(
  Component.props<{}>(),
  Component.require(Theme),
  () => Effect.gen(function* () {
    const theme = yield* Theme;
    return { theme: theme.current };
  }),
  (props, { theme }) => <div class={theme}>...</div>,
);
// Card requires Theme in R — if nobody provides it, the mount call won't compile
```

Providing context is providing a layer. Nesting is layer composition. Overriding is layer replacement. All type-checked:

```tsx
// Provide theme to a subtree
<WithLayer layer={Layer.succeed(Theme, { current: "dark" })}>
  <Card /> {/* gets dark theme */}
  <WithLayer layer={Layer.succeed(Theme, { current: "light" })}>
    <Card /> {/* gets light theme — inner layer overrides */}
  </WithLayer>
</WithLayer>
```

Or baked into the component via pipe:

```tsx
const DarkCard = Card.pipe(
  Component.withLayer(Layer.succeed(Theme, { current: "dark" })),
);
// DarkCard no longer requires Theme — it's satisfied
// DarkCard's Req is whatever Card's Req was minus Theme
```

**Reactive context values:**

The one thing React context does that plain `Layer.succeed` doesn't is reactivity — when the context value changes, consumers re-render. But this is where atoms and services compose:

```tsx
class Theme extends Effect.Tag("Theme")<Theme, {
  readonly current: ReadonlyAtom<"light" | "dark">;
  readonly toggle: () => void;
}>() {}

const ThemeLive = Layer.sync(Theme, () => {
  const current = Atom.make<"light" | "dark">("light");
  return {
    current,
    toggle: () => current.update((t) => t === "light" ? "dark" : "light"),
  };
});

const Card = Component.make(
  Component.props<{}>(),
  Component.require(Theme),
  () => Effect.gen(function* () {
    const theme = yield* Theme;
    return { theme: theme.current, toggle: theme.toggle };
  }),
  (props, { theme, toggle }) => (
    <div class={theme()}>
      <button onClick={toggle}>Toggle</button>
    </div>
  ),
);
```

The atom inside the service is reactive. When `toggle` is called, every component reading `theme.current()` updates. The service is the provider, the atom is the reactive value, and `yield*` is the subscription. No separate context system needed.

**Scoped services — fresh instances per subtree:**

React context gives you a new value per provider. Effect's `Layer.fresh` gives you the same thing:

```tsx
class FormState extends Effect.Tag("FormState")<FormState, {
  readonly values: WritableAtom<Record<string, string>>;
  readonly errors: ReadonlyAtom<Record<string, string>>;
  readonly reset: () => void;
}>() {}

const FormStateLive = Layer.scoped(FormState,
  Effect.gen(function* () {
    const values = Atom.make<Record<string, string>>({});
    const errors = Atom.make<Record<string, string>>({});

    yield* Effect.addFinalizer(() =>
      Effect.log("FormState disposed")
    );

    return {
      values,
      errors: Atom.derived((get) => validate(get(values))),
      reset: () => values.set({}),
    };
  })
);

// Each form gets its own FormState instance
<WithLayer layer={Layer.fresh(FormStateLive)}>
  <UserForm />   {/* has its own FormState */}
</WithLayer>
<WithLayer layer={Layer.fresh(FormStateLive)}>
  <OrderForm />  {/* has its own FormState */}
</WithLayer>
```

`Layer.fresh` creates a new instance each time it's provided. `Layer.scoped` means the service is disposed when the scope closes — which happens when `WithLayer` unmounts. React context can't do this — there's no built-in cleanup when a provider unmounts.

**Multiple related services compose naturally:**

In React, if a component needs theme, auth, locale, and feature flags, you either nest four providers or create a mega-context. With Effect, services compose via `Layer.mergeAll` and requirements are a union type:

```tsx
const AppPanel = Component.make(
  Component.props<{}>(),
  Component.require(Theme, Auth, Locale, FeatureFlags),

  () => Effect.gen(function* () {
    const theme = yield* Theme;
    const auth = yield* Auth;
    const locale = yield* Locale;
    const flags = yield* FeatureFlags;

    const greeting = yield* Component.derived(() =>
      locale.t(`greeting.${auth.user().role}`)
    );

    return { theme, auth, locale, flags, greeting };
  }),

  (props, ctx) => (
    <Show when={ctx.flags.isEnabled("new-panel")}>
      <div class={ctx.theme.current()}>
        <h1>{ctx.greeting()}</h1>
      </div>
    </Show>
  ),
);

// One layer provides everything — no nesting
const AppLive = Layer.mergeAll(
  ThemeLive,
  AuthLive,
  LocaleLive,
  FeatureFlagsLive,
);

Component.mount(App, { layer: AppLive, target: root });
```

The mount call type-checks that `AppLive` provides everything the component tree needs. Add a new `yield*` for a new service anywhere in the tree, and if the layer doesn't include it, the compiler tells you immediately.

**Service dependencies — layers that depend on other layers:**

This is where Effect's layer system dramatically exceeds what any context system can do. Services can depend on other services, and the dependency graph is resolved at the type level:

```tsx
class Config extends Effect.Tag("Config")<Config, {
  readonly apiUrl: string;
  readonly wsUrl: string;
}>() {}

class Api extends Effect.Tag("Api")<Api, {
  readonly listUsers: () => Effect.Effect<User[]>;
}>() {}

class WebSocket extends Effect.Tag("WebSocket")<WebSocket, {
  readonly messages: ReadonlyAtom<Message[]>;
}>() {}

// Api depends on Config
const ApiLive = Layer.effect(Api,
  Effect.gen(function* () {
    const config = yield* Config;
    return {
      listUsers: () => fetchJson(`${config.apiUrl}/users`),
    };
  })
);

// WebSocket depends on Config
const WebSocketLive = Layer.scoped(WebSocket,
  Effect.gen(function* () {
    const config = yield* Config;
    const ws = yield* connectWebSocket(config.wsUrl);
    yield* Effect.addFinalizer(() => ws.close());
    const messages = Atom.make<Message[]>([]);
    yield* Stream.fromWebSocket(ws).pipe(
      Stream.runForEach((msg) => Effect.sync(() =>
        messages.update((prev) => [...prev, msg])
      )),
      Effect.forkScoped,
    );
    return { messages };
  })
);

// Compose — Config is shared, not duplicated
const AppLive = Layer.mergeAll(ApiLive, WebSocketLive).pipe(
  Layer.provide(ConfigLive),
);
```

`ApiLive` and `WebSocketLive` both depend on `Config`. `Layer.provide(ConfigLive)` satisfies that dependency for both. The `Config` service is built once and shared. Try expressing this dependency graph with React context — you'd need to carefully order your providers and hope the nesting is right. With Effect, the compiler resolves it.

**Testing with swapped context:**

Because context is just services, testing means providing different layers:

```ts
const TestTheme = Layer.succeed(Theme, {
  current: Atom.make<"light" | "dark">("dark"),
  toggle: () => {},
});

const TestAuth = Layer.succeed(Auth, {
  user: Atom.make({ role: "admin", name: "Test" }),
  isAdmin: Atom.make(true),
});

const test = Effect.gen(function* () {
  const bindings = yield* Component.setupEffect(AppPanel, {});
  assert.equal(bindings.theme.current(), "dark");
  assert.equal(bindings.greeting(), "Welcome, admin");
}).pipe(
  Effect.provide(Layer.mergeAll(TestTheme, TestAuth, TestLocale, TestFlags)),
  Effect.scoped,
);
```

No mock framework. No provider wrappers. No render tree. Just provide different layers and test the setup Effect directly.

**What this eliminates from the framework:**

`createContext` — replaced by `Effect.Tag` / `Effect.Service`. `useContext` — replaced by `yield*`. `Context.Provider` / `WithLayer` — `WithLayer` stays but it's just `Layer.provide` applied to a subtree scope. Default values — unnecessary because missing services are compile errors. Context selectors / memoization — unnecessary because atoms inside services are already granularly reactive.

The entire context subsystem collapses into Effect's existing service model. No new primitives, no new APIs, no new concepts to learn. If you know Effect services, you know how component context works. The type safety isn't bolted on — it's the same type safety Effect has always had.

**The one edge case to think about:**

`Layer.scoped` services acquire resources (database connections, WebSocket connections, etc.) when the layer is built. If `WithLayer` mounts and the layer build fails, you need error handling at the boundary. This is the `WithLayer` build error case from earlier:

```tsx
<WithLayer
  layer={DbLive}
  onBuildError={(cause) => <ConnectionError cause={cause} />}
>
  <DataPanel />
</WithLayer>
```

React context never fails to provide because it's just a value. Effect layers can fail because they're effectful. This is more honest — connecting to a database can fail, and the type system should reflect that. But the component tree needs to handle it gracefully. `WithLayer` should show a fallback on build failure, retry with a schedule, or propagate the error to a parent boundary. All expressible through Effect combinators because the layer build is itself an Effect.