Yes. shadcn's model is "copy this React component into your project and modify it." That exists because React can't cleanly separate behavior from rendering, so you need the full component to customize it. With our system, behavior is an Effect, rendering is a view function, and they compose independently. You don't copy components — you compose behaviors and attach your own rendering.

**The behavioral building blocks:**

Instead of a component library, you have a behavior library. Each behavior is an Effect that produces typed bindings. Behaviors compose via `yield*`. Think of them as state machines that don't know what they look like.

```ts
// @myorg/behaviors — no rendering, no styles, no JSX

// Disclosure behavior — open/close state machine
export const disclosure = (options?: { defaultOpen?: boolean }) =>
  Effect.gen(function* () {
    const isOpen = yield* Component.state(options?.defaultOpen ?? false);

    return {
      isOpen,
      open: () => isOpen.set(true),
      close: () => isOpen.set(false),
      toggle: () => isOpen.update((v) => !v),
      aria: {
        trigger: () => ({
          "aria-expanded": isOpen(),
        }),
        content: () => ({
          role: "region" as const,
          "aria-hidden": !isOpen(),
        }),
      },
    };
  });

// Selection behavior — single or multi select state machine
export const selection = <T>(options?: {
  multiple?: boolean;
  initial?: readonly T[];
  equals?: (a: T, b: T) => boolean;
}) =>
  Effect.gen(function* () {
    const eq = options?.equals ?? ((a, b) => a === b);
    const selected = yield* Component.state<readonly T[]>(options?.initial ?? []);

    const isSelected = (item: T) => selected().some((s) => eq(s, item));

    const toggle = (item: T) => {
      if (isSelected(item)) {
        selected.update((prev) => prev.filter((s) => !eq(s, item)));
      } else if (options?.multiple) {
        selected.update((prev) => [...prev, item]);
      } else {
        selected.set([item]);
      }
    };

    const clear = () => selected.set([]);

    const selectAll = (items: readonly T[]) =>
      options?.multiple ? selected.set(items) : undefined;

    return {
      selected,
      isSelected,
      toggle,
      clear,
      selectAll,
      count: yield* Component.derived(() => selected().length),
      isEmpty: yield* Component.derived(() => selected().length === 0),
      aria: {
        option: (item: T) => ({
          "aria-selected": isSelected(item),
          role: "option" as const,
        }),
      },
    };
  });

// Search/filter behavior
export const searchFilter = <T>(options: {
  items: () => readonly T[];
  filterFn: (item: T, query: string) => boolean;
  debounce?: DurationInput;
}) =>
  Effect.gen(function* () {
    const query = yield* Component.state("");

    const filtered = yield* Component.derived(() => {
      const q = query();
      if (!q) return options.items();
      return options.items().filter((item) => options.filterFn(item, q));
    });

    return {
      query,
      filtered,
      hasResults: yield* Component.derived(() => filtered().length > 0),
      resultCount: yield* Component.derived(() => filtered().length),
      clear: () => query.set(""),
    };
  });

// Keyboard navigation behavior
export const keyboardNav = <T>(options: {
  items: () => readonly T[];
  orientation?: "vertical" | "horizontal";
  wrap?: boolean;
  onSelect?: (item: T) => void;
}) =>
  Effect.gen(function* () {
    const activeIndex = yield* Component.state(0);

    const clamp = (index: number) => {
      const len = options.items().length;
      if (len === 0) return 0;
      if (options.wrap) return ((index % len) + len) % len;
      return Math.max(0, Math.min(index, len - 1));
    };

    const next = () => activeIndex.update((i) => clamp(i + 1));
    const prev = () => activeIndex.update((i) => clamp(i - 1));
    const first = () => activeIndex.set(0);
    const last = () => activeIndex.set(options.items().length - 1);
    const select = () => {
      const item = options.items()[activeIndex()];
      if (item && options.onSelect) options.onSelect(item);
    };

    const isVertical = options.orientation !== "horizontal";

    const handleKeyDown = (e: UniversalKeyboardEvent) => {
      switch (e.key) {
        case isVertical ? "ArrowDown" : "ArrowRight": next(); break;
        case isVertical ? "ArrowUp" : "ArrowLeft": prev(); break;
        case "Home": first(); break;
        case "End": last(); break;
        case "Enter":
        case " ": select(); break;
      }
    };

    return {
      activeIndex,
      activeItem: yield* Component.derived(() => options.items()[activeIndex()]),
      next, prev, first, last, select,
      handleKeyDown,
      isActive: (index: number) => activeIndex() === index,
      aria: {
        container: () => ({
          role: "listbox" as const,
          "aria-activedescendant": `item-${activeIndex()}`,
          tabIndex: 0,
        }),
        item: (index: number) => ({
          id: `item-${index}`,
          role: "option" as const,
          "aria-selected": activeIndex() === index,
        }),
      },
    };
  });

// Pagination behavior
export const pagination = (options?: {
  initialPage?: number;
  pageSize?: number;
  total?: () => number;
}) =>
  Effect.gen(function* () {
    const page = yield* Component.state(options?.initialPage ?? 0);
    const pageSize = yield* Component.state(options?.pageSize ?? 20);

    const totalPages = yield* Component.derived(() => {
      const t = options?.total?.();
      if (t === undefined) return Infinity;
      return Math.ceil(t / pageSize());
    });

    return {
      page, pageSize, totalPages,
      hasNext: yield* Component.derived(() => page() < totalPages() - 1),
      hasPrev: yield* Component.derived(() => page() > 0),
      next: () => page.update((p) => Math.min(p + 1, totalPages() - 1)),
      prev: () => page.update((p) => Math.max(0, p - 1)),
      goTo: (p: number) => page.set(Math.max(0, Math.min(p, totalPages() - 1))),
      first: () => page.set(0),
      last: () => page.set(totalPages() - 1),
      range: yield* Component.derived(() => ({
        start: page() * pageSize(),
        end: Math.min((page() + 1) * pageSize(), options?.total?.() ?? Infinity),
      })),
    };
  });

// Focustrap behavior
export const focusTrap = (options?: { initialFocus?: string }) =>
  Effect.gen(function* () {
    const containerRef = yield* Component.ref<HTMLElement>();
    const active = yield* Component.state(false);

    // When active, trap Tab key within the container
    const handleKeyDown = (e: UniversalKeyboardEvent) => {
      if (!active() || e.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    return {
      containerRef,
      active,
      activate: () => active.set(true),
      deactivate: () => active.set(false),
      handleKeyDown,
    };
  });

// Drag and drop behavior
export const draggable = <T>(options: {
  items: () => readonly T[];
  onReorder: (from: number, to: number) => void;
}) =>
  Effect.gen(function* () {
    const dragIndex = yield* Component.state<number | null>(null);
    const overIndex = yield* Component.state<number | null>(null);
    const isDragging = yield* Component.derived(() => dragIndex() !== null);

    return {
      dragIndex, overIndex, isDragging,
      dragStart: (index: number) => dragIndex.set(index),
      dragOver: (index: number) => overIndex.set(index),
      dragEnd: () => {
        const from = dragIndex();
        const to = overIndex();
        if (from !== null && to !== null && from !== to) {
          options.onReorder(from, to);
        }
        dragIndex.set(null);
        overIndex.set(null);
      },
      dragCancel: () => {
        dragIndex.set(null);
        overIndex.set(null);
      },
      itemProps: (index: number) => ({
        draggable: true,
        "aria-grabbed": dragIndex() === index,
        "data-dragging": dragIndex() === index,
        "data-dragover": overIndex() === index,
      }),
    };
  });

// Form field behavior (uses AtomSchema)
export const formField = <A>(schema: Schema.Schema<A>, initial: A) =>
  Effect.gen(function* () {
    const field = AtomSchema.makeInitial(schema, initial);

    return {
      ...field,
      // Convenience: bind to an input element in one spread
      inputProps: () => ({
        value: field.input(),
        onInput: (value: string) => field.input.set(value),
        "aria-invalid": !field.isValid() && field.touched(),
        "aria-errormessage": field.error()
          ? Option.getOrUndefined(field.error())?.message
          : undefined,
      }),
    };
  });
```

**Composing behaviors into complex widgets:**

A combobox is just: search + keyboard nav + selection + disclosure + focus trap. Compose them:

```ts
export const combobox = <T>(options: {
  items: () => readonly T[];
  labelFn: (item: T) => string;
  onSelect: (item: T) => void;
  multiple?: boolean;
}) =>
  Effect.gen(function* () {
    const disc = yield* disclosure();

    const search = yield* searchFilter({
      items: options.items,
      filterFn: (item, query) =>
        options.labelFn(item).toLowerCase().includes(query.toLowerCase()),
    });

    const nav = yield* keyboardNav({
      items: search.filtered,
      onSelect: (item) => {
        sel.toggle(item);
        options.onSelect(item);
        if (!options.multiple) disc.close();
      },
    });

    const sel = yield* selection<T>({
      multiple: options.multiple,
    });

    const trap = yield* focusTrap();
    const inputRef = yield* Component.ref<HTMLInputElement>();

    // Wire behaviors together
    const open = () => {
      disc.open();
      trap.activate();
      inputRef.current?.focus();
    };

    const close = () => {
      disc.close();
      trap.deactivate();
      search.clear();
      nav.activeIndex.set(0);
    };

    const handleInputKeyDown = (e: UniversalKeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      } else if (e.key === "ArrowDown" && !disc.isOpen()) {
        open();
      } else {
        nav.handleKeyDown(e);
      }
    };

    return {
      // Composed state
      isOpen: disc.isOpen,
      query: search.query,
      filtered: search.filtered,
      activeIndex: nav.activeIndex,
      selected: sel.selected,
      isSelected: sel.isSelected,

      // Composed actions
      open, close,
      toggle: () => disc.isOpen() ? close() : open(),
      select: nav.select,
      clearSelection: sel.clear,

      // Refs
      inputRef,
      containerRef: trap.containerRef,

      // Composed handlers
      handleInputKeyDown,

      // Composed ARIA
      aria: {
        root: () => ({
          role: "combobox" as const,
          "aria-expanded": disc.isOpen(),
          "aria-haspopup": "listbox" as const,
        }),
        input: () => ({
          role: "searchbox" as const,
          "aria-autocomplete": "list" as const,
          "aria-controls": "listbox",
          ...disc.aria.trigger(),
        }),
        listbox: () => ({
          ...nav.aria.container(),
          ...disc.aria.content(),
          id: "listbox",
        }),
        option: (item: T, index: number) => ({
          ...nav.aria.item(index),
          ...sel.aria.option(item),
        }),
      },
    };
  });
```

The combobox didn't define any of those behaviors. It composed five existing behaviors and wired them together. Each behavior is independently tested, independently typed, independently reusable. The composition is just Effect `yield*` calls.

**State machines as behaviors:**

For more complex interaction patterns, behaviors can be explicit state machines:

```ts
import { Schema } from "effect";

// State machine states as a tagged union
type DialogState =
  | { readonly _tag: "Closed" }
  | { readonly _tag: "Opening"; readonly trigger: HTMLElement }
  | { readonly _tag: "Open"; readonly trigger: HTMLElement }
  | { readonly _tag: "Confirming"; readonly trigger: HTMLElement; readonly data: unknown }
  | { readonly _tag: "Closing"; readonly result: "confirmed" | "cancelled" };

export const dialogMachine = (options?: {
  onConfirm?: (data: unknown) => Effect.Effect<void, any, any>;
  onCancel?: () => void;
  closeOnOverlay?: boolean;
  closeOnEscape?: boolean;
}) =>
  Effect.gen(function* () {
    const state = yield* Component.state<DialogState>({ _tag: "Closed" });
    const trap = yield* focusTrap();

    const transition = (next: DialogState) => {
      const current = state();
      // Validate transitions
      switch (next._tag) {
        case "Opening":
          if (current._tag !== "Closed") return;
          break;
        case "Open":
          if (current._tag !== "Opening") return;
          break;
        case "Confirming":
          if (current._tag !== "Open") return;
          break;
        case "Closing":
          if (current._tag !== "Open" && current._tag !== "Confirming") return;
          break;
        case "Closed":
          if (current._tag !== "Closing") return;
          break;
      }
      state.set(next);
    };

    const open = (trigger: HTMLElement) => {
      transition({ _tag: "Opening", trigger });
      // After animation frame, transition to Open
      requestAnimationFrame(() => {
        transition({ _tag: "Open", trigger });
        trap.activate();
      });
    };

    const confirm = (data: unknown) => {
      transition({ _tag: "Confirming", trigger: (state() as any).trigger, data });
      if (options?.onConfirm) {
        Effect.runFork(
          options.onConfirm(data).pipe(
            Effect.tap(() => Effect.sync(() => close("confirmed"))),
            Effect.catchAll(() => Effect.sync(() => {
              // Confirmation failed — go back to Open
              transition({ _tag: "Open", trigger: (state() as any).trigger });
            })),
          )
        );
      } else {
        close("confirmed");
      }
    };

    const close = (result: "confirmed" | "cancelled") => {
      trap.deactivate();
      transition({ _tag: "Closing", result });
      // After animation, transition to Closed
      requestAnimationFrame(() => {
        transition({ _tag: "Closed" });
        if (result === "cancelled") options?.onCancel?.();
        // Restore focus to trigger element
        const s = state();
        if ("trigger" in (s as any)) (s as any).trigger.focus();
      });
    };

    const cancel = () => close("cancelled");

    const handleKeyDown = (e: UniversalKeyboardEvent) => {
      if (e.key === "Escape" && options?.closeOnEscape !== false) {
        cancel();
      }
      trap.handleKeyDown(e);
    };

    const handleOverlayClick = () => {
      if (options?.closeOnOverlay !== false) cancel();
    };

    return {
      state,
      isOpen: yield* Component.derived(() =>
        state()._tag === "Open" || state()._tag === "Confirming"
      ),
      isConfirming: yield* Component.derived(() => state()._tag === "Confirming"),
      open, confirm, cancel, close,
      handleKeyDown, handleOverlayClick,
      containerRef: trap.containerRef,
      aria: {
        overlay: () => ({
          role: "presentation" as const,
          "aria-hidden": state()._tag === "Closed",
        }),
        dialog: () => ({
          role: "dialog" as const,
          "aria-modal": true,
          "aria-hidden": state()._tag === "Closed",
        }),
      },
    };
  });
```

The dialog state machine is explicit. States are tagged. Transitions are validated. The confirmation step can be async (it runs an Effect). Animation states are distinct from logical states. Focus management is wired in via the `focusTrap` behavior. All of this is tested without any rendering.

**Factories — parameterized component generators:**

Instead of shadcn's "copy and edit," you have factories that produce components with your configuration baked in:

```ts
// A factory that produces data table components
export const createDataTable = <T>(config: {
  columns: readonly ColumnDef<T>[];
  keyFn: (item: T) => string;
  fetchFn: (params: TableParams) => Effect.Effect<TableResult<T>, any, any>;
  features?: {
    selection?: boolean | "single" | "multi";
    sorting?: boolean;
    pagination?: boolean;
    search?: boolean;
    reorder?: boolean;
  };
}) => {
  return Component.make(
    Component.props<{
      onRowClick?: (item: T) => void;
      onSelectionChange?: (items: readonly T[]) => void;
      emptyState?: () => ViewNode;
    }>(),

    Component.require(/* inferred from fetchFn */),

    (props) => Effect.gen(function* () {
      // Conditionally compose behaviors based on config
      const pag = config.features?.pagination !== false
        ? yield* pagination()
        : null;

      const search = config.features?.search !== false
        ? yield* searchFilter({
            items: () => data().items ?? [],
            filterFn: (item, q) =>
              config.columns.some((col) =>
                String(col.accessor(item)).toLowerCase().includes(q.toLowerCase())
              ),
          })
        : null;

      const sort = config.features?.sorting !== false
        ? yield* sorting<T>(config.columns)
        : null;

      const sel = config.features?.selection
        ? yield* selection<T>({
            multiple: config.features.selection === "multi",
            equals: (a, b) => config.keyFn(a) === config.keyFn(b),
          })
        : null;

      const reorder = config.features?.reorder
        ? yield* draggable({
            items: () => data().items ?? [],
            onReorder: (from, to) => {
              // Handle reorder
            },
          })
        : null;

      // Fetch data with composed parameters
      const data = yield* Component.query(
        () => config.fetchFn({
          page: pag?.page() ?? 0,
          pageSize: pag?.pageSize() ?? 50,
          sort: sort ? { column: sort.sortColumn(), direction: sort.sortDirection() } : undefined,
          search: search?.query() ?? "",
        }),
      );

      // Wire selection changes to callback
      if (sel && props.onSelectionChange) {
        yield* Component.effect(
          () => sel.selected(),
          (items) => props.onSelectionChange?.(items),
        );
      }

      return {
        data,
        columns: config.columns,
        keyFn: config.keyFn,
        pagination: pag,
        search,
        sorting: sort,
        selection: sel,
        reorder,
      };
    }),

    // The view is built from the composed behaviors
    (props, bindings) => (
      <Box flex={{ direction: "column", gap: 8 }}>
        {bindings.search && (
          <Input
            value={bindings.search.query()}
            onInput={(v) => bindings.search!.query.set(v)}
            placeholder="Search..."
          />
        )}

        <Async
          result={bindings.data()}
          loading={() => <TableSkeleton columns={config.columns} />}
          success={(result) => (
            <Box>
              {/* Table rendering using composed behaviors */}
            </Box>
          )}
        />

        {bindings.pagination && (
          <PaginationControls pagination={bindings.pagination} />
        )}
      </Box>
    ),
  );
};
```

Usage:

```ts
// Create a typed data table for users
const UserTable = createDataTable({
  columns: [
    { key: "name", label: "Name", accessor: (u: User) => u.name, sortable: true },
    { key: "email", label: "Email", accessor: (u: User) => u.email, sortable: true },
    { key: "role", label: "Role", accessor: (u: User) => u.role },
  ],
  keyFn: (u) => u.id,
  fetchFn: (params) => Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers(params);
  }),
  features: {
    selection: "multi",
    sorting: true,
    pagination: true,
    search: true,
  },
});

// Use it — fully typed, all behaviors composed
<UserTable
  onRowClick={(user) => navigate(userProfileLink({ userId: user.id }))}
  onSelectionChange={(users) => console.log("selected:", users)}
  emptyState={() => <Text>No users found</Text>}
/>
```

The factory generated a complete data table component with multi-select, sorting, pagination, search, and async data fetching — all from composing independent behaviors. No copy-pasting. No 500-line component file. No "edit the shadcn component to add sorting."

**Headless factories — behaviors without views:**

For maximum flexibility, factories can produce headless components — all behavior, no rendering:

```ts
export const createCombobox = <T>(config: {
  labelFn: (item: T) => string;
  valueFn?: (item: T) => string;
  multiple?: boolean;
  creatable?: boolean;
  async?: (query: string) => Effect.Effect<readonly T[], any, any>;
}) =>
  Component.headless(
    Component.props<{
      items?: readonly T[];
      onSelect: (items: readonly T[]) => void;
      placeholder?: string;
    }>(),
    Component.require(),
    (props) => Effect.gen(function* () {
      const disc = yield* disclosure();

      const items = config.async
        ? yield* Component.query(
            () => config.async!(search.query()),
            { debounce: "300 millis" },
          )
        : null;

      const effectiveItems = () => {
        if (items) return Result.getOrElse(items(), () => []);
        return props.items ?? [];
      };

      const search = yield* searchFilter({
        items: effectiveItems,
        filterFn: (item, q) =>
          config.labelFn(item).toLowerCase().includes(q.toLowerCase()),
      });

      const nav = yield* keyboardNav({
        items: search.filtered,
        onSelect: (item) => {
          sel.toggle(item);
          props.onSelect(sel.selected());
          if (!config.multiple) disc.close();
        },
      });

      const sel = yield* selection<T>({ multiple: config.multiple });
      const trap = yield* focusTrap();
      const inputRef = yield* Component.ref<HTMLInputElement>();

      // Creatable: allow adding new items
      const create = config.creatable
        ? yield* Component.action(
            Effect.fn(function* () {
              const q = search.query();
              if (!q) return;
              const newItem = { [config.labelFn.toString()]: q } as unknown as T;
              sel.toggle(newItem);
              props.onSelect(sel.selected());
              search.clear();
            }),
          )
        : null;

      return {
        // All composed state
        isOpen: disc.isOpen,
        query: search.query,
        filtered: search.filtered,
        activeIndex: nav.activeIndex,
        selected: sel.selected,
        isSelected: sel.isSelected,
        isLoading: items
          ? yield* Component.derived(() => Result.isLoading(items!()))
          : yield* Component.derived(() => false),

        // All composed actions
        open: () => { disc.open(); trap.activate(); inputRef.current?.focus(); },
        close: () => { disc.close(); trap.deactivate(); search.clear(); },
        select: nav.select,
        remove: (item: T) => { sel.toggle(item); props.onSelect(sel.selected()); },
        clearAll: () => { sel.clear(); props.onSelect([]); },
        create,

        // Refs
        inputRef,
        containerRef: trap.containerRef,

        // Label helper
        getLabel: config.labelFn,
        getValue: config.valueFn ?? config.labelFn,

        // Composed ARIA
        aria: {
          root: disc.aria.trigger,
          input: () => ({
            role: "combobox" as const,
            "aria-expanded": disc.isOpen(),
            "aria-autocomplete": "list" as const,
          }),
          listbox: () => ({
            ...nav.aria.container(),
            ...disc.aria.content(),
          }),
          option: (item: T, index: number) => ({
            ...nav.aria.item(index),
            ...sel.aria.option(item),
          }),
        },
      };
    }),
  );
```

Now create specialized comboboxes by calling the factory:

```ts
// User picker
const UserPicker = createCombobox<User>({
  labelFn: (u) => u.name,
  valueFn: (u) => u.id,
  multiple: true,
  async: (query) => Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.searchUsers(query);
  }),
});

// Country selector
const CountrySelect = createCombobox<Country>({
  labelFn: (c) => c.name,
  valueFn: (c) => c.code,
  multiple: false,
});

// Tag input with creation
const TagInput = createCombobox<Tag>({
  labelFn: (t) => t.label,
  multiple: true,
  creatable: true,
});
```

Each is a headless component. The consumer provides rendering:

```tsx
<UserPicker
  onSelect={(users) => setSelectedUsers(users)}
>
  {(cb) => (
    <Box ref={cb.containerRef}>
      {/* Selected tags */}
      <Box flex={{ direction: "row", wrap: true, gap: 4 }}>
        <For each={cb.selected()}>
          {(user) => (
            <Tag onRemove={() => cb.remove(user())}>
              {cb.getLabel(user())}
            </Tag>
          )}
        </For>
        <Input
          ref={cb.inputRef}
          value={cb.query()}
          onInput={(v) => cb.query.set(v)}
          onKeyDown={cb.handleKeyDown}
          placeholder="Search users..."
          {...cb.aria.input()}
        />
      </Box>

      {/* Dropdown */}
      <Show when={cb.isOpen()}>
        <Box {...cb.aria.listbox()}>
          <Show when={cb.isLoading()}>
            <Spinner />
          </Show>
          <For each={cb.filtered()}>
            {(user, i) => (
              <Box
                onClick={() => cb.select()}
                {...cb.aria.option(user(), i())}
                style={{
                  backgroundColor: cb.isSelected(user()) ? "highlight" : "surface",
                }}
              >
                <Avatar src={user().avatar} />
                <Text>{cb.getLabel(user())}</Text>
              </Box>
            )}
          </For>
        </Box>
      </Show>
    </Box>
  )}
</UserPicker>
```

**Piping behaviors onto components:**

Behaviors can be added to existing components via pipe, just like layers and error boundaries:

```ts
// Start with a basic component
const ItemList = Component.make(
  Component.props<{ items: readonly Item[] }>(),
  Component.require(),
  (props) => Effect.succeed({ items: props.items }),
  (props, { items }) => (
    <Box>
      <For each={items}>{(item) => <ItemRow item={item()} />}</For>
    </Box>
  ),
);

// Pipe behaviors onto it
const EnhancedItemList = ItemList.pipe(
  // Add selection
  Component.withBehavior(selection<Item>({ multiple: true }), (bindings, sel) => ({
    ...bindings,
    selection: sel,
  })),

  // Add keyboard navigation
  Component.withBehavior(
    (bindings) => keyboardNav({
      items: () => bindings.items,
      onSelect: (item) => bindings.selection.toggle(item),
    }),
    (bindings, nav) => ({ ...bindings, nav }),
  ),

  // Add search
  Component.withBehavior(
    (bindings) => searchFilter({
      items: () => bindings.items,
      filterFn: (item, q) => item.name.includes(q),
    }),
    (bindings, search) => ({
      ...bindings,
      displayItems: search.filtered, // override what gets rendered
    }),
  ),
);
```

`Component.withBehavior` takes a behavior (an Effect that produces bindings) and a merge function that combines the new bindings with the existing ones. The component's view function receives the merged bindings.

**Higher-order behavior composers:**

```ts
// A composer that adds async data fetching to any behavior
export const withAsyncData = <T, E, R>(
  fetchFn: () => Effect.Effect<readonly T[], E, R>,
  options?: { reactivityKeys?: string[] },
) =>
  <B>(behavior: (items: () => readonly T[]) => Effect.Effect<B, never, Scope>) =>
    Effect.gen(function* () {
      const data = yield* Component.query(fetchFn, {
        reactivityKeys: options?.reactivityKeys,
      });

      const items = yield* Component.derived(() =>
        Result.getOrElse(data(), () => [] as readonly T[])
      );

      const behaviorBindings = yield* behavior(items);

      return {
        ...behaviorBindings,
        data, // expose the raw Result for loading/error states
        isLoading: yield* Component.derived(() => Result.isLoading(data())),
        error: yield* Component.derived(() => Result.getError(data())),
        refresh: () => Reactivity.invalidate(options?.reactivityKeys ?? []),
      };
    });

// Usage: async user list with selection and search
const asyncUserBehavior = withAsyncData<User, HttpError, Api>(
  () => Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  }),
  { reactivityKeys: ["users"] },
)((items) =>
  Effect.gen(function* () {
    const sel = yield* selection<User>({ multiple: true });
    const search = yield* searchFilter({
      items,
      filterFn: (u, q) => u.name.toLowerCase().includes(q.toLowerCase()),
    });
    return { ...sel, ...search };
  })
);
```

**Partial application for pre-configured behaviors:**

```ts
// Pre-configure a behavior for your domain
const userSelection = selection<User>({
  multiple: true,
  equals: (a, b) => a.id === b.id,
});

const userSearch = (items: () => readonly User[]) => searchFilter({
  items,
  filterFn: (user, q) => {
    const query = q.toLowerCase();
    return (
      user.name.toLowerCase().includes(query) ||
      user.email.toLowerCase().includes(query) ||
      user.role.toLowerCase().includes(query)
    );
  },
});

const userSort = sorting<User>([
  { key: "name", compare: (a, b) => a.name.localeCompare(b.name) },
  { key: "email", compare: (a, b) => a.email.localeCompare(b.email) },
  { key: "role", compare: (a, b) => a.role.localeCompare(b.role) },
]);

// Compose them in any component
const UserManager = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const api = yield* Api;
    const data = yield* Component.query(() => api.listUsers());
    const items = yield* Component.derived(() =>
      Result.getOrElse(data(), () => [])
    );

    // Just yield the pre-configured behaviors
    const sel = yield* userSelection;
    const search = yield* userSearch(items);
    const sort = yield* userSort;

    return { data, sel, search, sort };
  }),
  (props, { data, sel, search, sort }) => (
    // Your rendering
  ),
);
```

**Behavior schemas — constrained configurations:**

Using Effect Schema to validate behavior configuration at compile time and runtime:

```ts
const DataTableConfig = <T>() => Schema.Struct({
  columns: Schema.Array(Schema.Struct({
    key: Schema.String,
    label: Schema.String,
    sortable: Schema.optional(Schema.Boolean, { default: () => false }),
    width: Schema.optional(Schema.Number),
  })),
  features: Schema.optional(Schema.Struct({
    selection: Schema.optional(Schema.Literal("single", "multi", false)),
    sorting: Schema.optional(Schema.Boolean),
    pagination: Schema.optional(Schema.Boolean),
    search: Schema.optional(Schema.Boolean),
  })),
});

// Factory validates config via Schema
const createValidatedTable = <T>(
  config: Schema.Schema.Type<ReturnType<typeof DataTableConfig<T>>>,
) => {
  // Schema validates at construction time
  const validated = Schema.decodeUnknownSync(DataTableConfig<T>())(config);
  return createDataTable(validated);
};
```

**Design system as a behavior layer:**

A design system isn't a component library — it's a set of pre-configured behavior factories plus a theme:

```ts
// @myorg/design-system

// Theme as a service
class DesignTheme extends Effect.Tag("DesignTheme")<DesignTheme, {
  readonly tokens: ThemeTokens;
  readonly components: ComponentStyles;
}>() {
  static Default = Layer.succeed(DesignTheme, {
    tokens: defaultTokens,
    components: defaultComponentStyles,
  });
}

// Pre-configured behavior factories
export const DSCombobox = createCombobox;
export const DSDataTable = createDataTable;
export const DSDialog = dialogMachine;

// Pre-styled wrappers using the theme
export const ComboboxStyled = <T>(config: ComboboxConfig<T>) => {
  const headless = createCombobox(config);
  return headless.pipe(
    Component.withView((props, bindings) => {
      // Uses DesignTheme for styling
      const theme = yield* DesignTheme;
      return (
        <Box style={theme.components.combobox.root}>
          {/* Styled rendering using theme tokens */}
        </Box>
      );
    }),
    Component.require(DesignTheme),
  );
};

// Usage
const UserPicker = ComboboxStyled<User>({
  labelFn: (u) => u.name,
  multiple: true,
  async: (q) => searchUsers(q),
});

// Mount with your theme
Component.mount(App, {
  layer: Layer.mergeAll(AppLive, DesignTheme.Default),
  target: root,
});

// Or a different theme
Component.mount(App, {
  layer: Layer.mergeAll(AppLive, DesignTheme.Dark),
  target: root,
});
```

**What this replaces vs shadcn:**

shadcn: copy `dialog.tsx` into your project, edit 200 lines of React + Radix + Tailwind.

This system: `yield* dialogMachine({ onConfirm, closeOnEscape: true })` in your component's setup, render however you want. The dialog behavior is 50 lines of pure logic. Your rendering is your rendering. Need to change the animation? Change your view. Need to change the confirmation flow? Pipe a different `onConfirm`. Need to add a state? Compose another behavior. Nothing to copy, nothing to fork, nothing to keep in sync with upstream.

shadcn: need a data table? Copy `data-table.tsx`, `data-table-column-header.tsx`, `data-table-pagination.tsx`, `data-table-row-actions.tsx`, `data-table-toolbar.tsx`, `data-table-view-options.tsx`. Six files. 800+ lines.

This system: `const Table = createDataTable({ columns, fetchFn, features: { selection: "multi", sorting: true, pagination: true } })`. One line. All behaviors are composed from tested, typed building blocks. Rendering is yours.

shadcn: every component is React-only. Want to use it in Vue? Rebuild everything.

This system: behaviors are Effects. They work on any framework. The rendering layer is the only framework-specific part, and headless factories eliminate even that if you accept the abstract element vocabulary.

shadcn: updating means manually diffing your copy against the latest version.

This system: behaviors are versioned packages. `npm update @myorg/behaviors`. Your rendering doesn't change. Behavior improvements flow through automatically.

**The complete picture:**

```
@myorg/behaviors (no framework, no rendering)
├── disclosure()           — open/close state machine
├── selection()            — single/multi select
├── searchFilter()         — text filtering
├── keyboardNav()          — arrow key navigation
├── pagination()           — page state
├── focusTrap()            — tab trapping
├── draggable()            — drag and drop
├── formField()            — schema-validated field
├── dialogMachine()        — dialog state machine
├── toastManager()         — toast queue
├── tooltipBehavior()      — delay/hover tracking
└── ... any behavior you need

@myorg/headless (composed behaviors, no rendering)
├── createCombobox()       — search + nav + selection + disclosure
├── createDataTable()      — fetch + sort + filter + paginate + select
├── createDialog()         — dialog machine + focus trap
├── createDropdown()       — disclosure + nav + selection
├── createTabs()           — selection + nav + panels
├── createAccordion()      — disclosure per item + nav
├── createTooltip()        — delay + positioning
└── ... composed from behaviors

@myorg/design-system (theme + styled views)
├── DesignTheme service    — tokens, spacing, colors
├── StyledCombobox         — headless + themed view
├── StyledDataTable        — headless + themed view
├── StyledDialog           — headless + themed view
└── ... headless + your design

Your app
├── yield* behaviors directly
├── Use headless factories with custom rendering
├── Use styled design system components
├── Or mix and match all three
└── Everything is typed, composable, testable, framework-agnostic
```

No copying. No forking. No keeping copies in sync. Behaviors are packages. Rendering is yours. Composition is `yield*`. Configuration is factories. Customization is pipes. Testing is pure Effects. Framework support is a layer swap.I don't quite like the design. Components should expose element refs from views, that outside things can operate on. That way we don't have to spread props on elements? Idk? Maybe not? Will we lose type safety or composability? Think about it what's the best design here. I like the idea of little behaviors that compose together. But don't have to be in the setup function? Like the take the component or vee as args if it meets the requirements?You're right to push back. The "spread props onto elements" pattern is the headless UI status quo and it's fundamentally fragile. You have to remember to spread ARIA, handlers, refs — miss one and things break silently. Behaviors producing bags of props that the view must manually wire is just another form of implicit coupling.

Let me rethink from first principles.

**The core insight: behaviors should attach to elements, not produce props for elements.**

A behavior declares what elements it needs. A view exposes named element slots. The framework connects them. No spreading. No manual wiring. The behavior directly operates on the refs it receives.

```ts
// A behavior declares its element requirements
const disclosure = Behavior.make(
  // What elements this behavior needs from the view
  Behavior.elements({
    trigger: Element.interactive(),  // something clickable/pressable
    content: Element.container(),    // something that shows/hides
  }),

  // The behavior logic — receives typed refs to those elements
  (els) => Effect.gen(function* () {
    const isOpen = yield* Component.state(false);

    // Attach directly to the trigger element
    yield* els.trigger.on("press", () => isOpen.update((v) => !v));
    yield* els.trigger.setAttr("aria-expanded", () => isOpen());
    yield* els.trigger.setAttr("aria-controls", els.content.id);

    // Attach directly to the content element
    yield* els.content.setAttr("role", "region");
    yield* els.content.setAttr("aria-hidden", () => !isOpen());
    yield* els.content.setVisible(() => isOpen());

    return { isOpen, open: () => isOpen.set(true), close: () => isOpen.set(false), toggle: () => isOpen.update((v) => !v) };
  }),
);
```

The behavior doesn't produce `{ aria: { trigger: () => ({...}), content: () => ({...}) } }` that the view must spread. It directly attaches attributes, event listeners, and visibility to the elements it receives. The element refs are typed — `trigger` must be interactive (can receive press events), `content` must be a container (can have children shown/hidden).

**The view exposes named slots:**

```tsx
const Accordion = Component.make(
  Component.props<{ title: string; children: ViewNode }>(),
  Component.require(),

  (props) => Effect.gen(function* () {
    // Attach behavior to view slots — not in the view, not spreading
    const disc = yield* disclosure;
    return { disc };
  }),

  // View declares slots that behaviors can attach to
  (props, { disc }) => (
    <Box>
      <Button ref={disc.trigger}>{props.title}</Button>
      <Box ref={disc.content}>{props.children}</Box>
    </Box>
  ),
);
```

`ref={disc.trigger}` connects the button to the disclosure behavior's `trigger` slot. The behavior has already configured what happens on press, what ARIA attributes to set, everything. The view just says "this element is the trigger." No spreading. No forgetting attributes.

**But this means behaviors produce refs, not bindings.**

The behavior's return value includes typed refs that the view must attach. The type system verifies that every required ref is attached:

```ts
// Behavior.make returns typed refs alongside state/actions
const disc = yield* disclosure;

// disc.trigger is a TypedRef<InteractiveElement>
// disc.content is a TypedRef<ContainerElement>
// disc.isOpen is ReadonlyAtom<boolean>
// disc.toggle is () => void

// If the view doesn't attach disc.trigger to anything:
// Warning or error: "disclosure.trigger ref was not attached to any element"
```

**Element type constraints:**

Different behaviors need different element capabilities. A keyboard navigation behavior needs an element that can receive focus. A drag behavior needs an element that supports pointer events. The type system should express these constraints:

```ts
declare namespace Element {
  // Element that can receive press/click events
  interface Interactive {
    on(event: "press", handler: () => void): Effect.Effect<void, never, Scope>;
    on(event: "keydown", handler: (e: KeyboardEvent) => void): Effect.Effect<void, never, Scope>;
    setAttr(name: string, value: unknown | (() => unknown)): Effect.Effect<void, never, Scope>;
    readonly id: string;
  }

  // Element that can show/hide children
  interface Container extends Interactive {
    setVisible(condition: () => boolean): Effect.Effect<void, never, Scope>;
    readonly children: ReadonlyAtom<readonly Element.Any[]>;
  }

  // Element that can receive focus
  interface Focusable extends Interactive {
    focus(): void;
    blur(): void;
    readonly hasFocus: ReadonlyAtom<boolean>;
    setAttr(name: "tabindex", value: number): Effect.Effect<void, never, Scope>;
  }

  // Element that can receive text input
  interface TextInput extends Focusable {
    readonly value: WritableAtom<string>;
    on(event: "input", handler: (value: string) => void): Effect.Effect<void, never, Scope>;
    setAttr(name: "placeholder", value: string): Effect.Effect<void, never, Scope>;
  }

  // Element that can be scrolled
  interface Scrollable extends Container {
    scrollTo(position: { top?: number; left?: number }): void;
    readonly scrollPosition: ReadonlyAtom<{ top: number; left: number }>;
    on(event: "scroll", handler: () => void): Effect.Effect<void, never, Scope>;
  }

  // Element that can be dragged
  interface Draggable extends Interactive {
    on(event: "dragstart", handler: () => void): Effect.Effect<void, never, Scope>;
    on(event: "dragend", handler: () => void): Effect.Effect<void, never, Scope>;
    on(event: "dragover", handler: () => void): Effect.Effect<void, never, Scope>;
    setAttr(name: "draggable", value: boolean): Effect.Effect<void, never, Scope>;
  }

  // Any element
  type Any = Interactive | Container | Focusable | TextInput | Scrollable | Draggable;
}
```

These aren't DOM-specific. `Element.Interactive` works on web (button/div with click), TUI (box with keypress), mobile (view with press). The platform renderer implements these interfaces for its native elements.

**Behavior composition via element requirement merging:**

When you compose behaviors, their element requirements merge. If two behaviors need the same slot, the slot must satisfy both constraints:

```ts
const combobox = Behavior.compose(
  // Search needs a text input
  Behavior.elements({ input: Element.TextInput }),
  searchFilter,

  // Navigation needs a focusable container for the list
  Behavior.elements({ list: Element.Focusable }),
  keyboardNav,

  // Selection needs interactive items
  Behavior.elements({ list: Element.Container }),
  selection,

  // Disclosure needs trigger + content
  Behavior.elements({ input: Element.Interactive, dropdown: Element.Container }),
  disclosure,
);

// Merged element requirements:
// {
//   input: Element.TextInput & Element.Interactive (= TextInput, since TextInput extends Interactive)
//   list: Element.Focusable & Element.Container (= both capabilities required)
//   dropdown: Element.Container
// }
```

The type system computes the intersection. `input` needs to be `TextInput` (from search) AND `Interactive` (from disclosure). Since `TextInput extends Interactive`, `TextInput` satisfies both. If two behaviors required incompatible element types for the same slot, it would be a compile error.

**Behaviors as external decorators — not inside setup:**

This is the second shift. Behaviors shouldn't have to live inside the component's setup function. They should be applicable from outside, like pipes:

```tsx
// A basic component with named element slots
const SimpleList = Component.make(
  Component.props<{ items: readonly string[] }>(),
  Component.require(),
  (props) => Effect.succeed({ items: props.items }),
  (props, { items }) => (
    <Box slot="container">
      <For each={items}>
        {(item, i) => (
          <Box slot="item" data-index={i()}>
            <Text>{item}</Text>
          </Box>
        )}
      </For>
    </Box>
  ),
);

// Attach behaviors from OUTSIDE
const SelectableList = SimpleList.pipe(
  Behavior.attach(selection({
    // Behavior maps its element needs to the component's slots
    elements: { container: "container", items: "item" },
  })),
);

const NavigableList = SelectableList.pipe(
  Behavior.attach(keyboardNav({
    elements: { container: "container", items: "item" },
  })),
);

const SearchableNavigableSelectableList = NavigableList.pipe(
  Behavior.attach(searchFilter({
    elements: { input: "searchInput" },
    // Wait — SimpleList doesn't have a "searchInput" slot
    // This is a compile error!
  })),
);
```

`Behavior.attach` takes a behavior and maps its element requirements to the component's named slots. If the component doesn't have a slot that the behavior needs, it's a type error. If the slot's element type doesn't satisfy the behavior's constraint, it's a type error.

To add the search input, you need to modify the view to include the slot:

```tsx
const SearchableList = Component.make(
  Component.props<{ items: readonly string[] }>(),
  Component.require(),
  (props) => Effect.succeed({ items: props.items }),
  (props, { items }) => (
    <Box>
      <Input slot="searchInput" placeholder="Search..." />
      <Box slot="container">
        <For each={items}>
          {(item, i) => (
            <Box slot="item" data-index={i()}>
              <Text>{item}</Text>
            </Box>
          )}
        </For>
      </Box>
    </Box>
  ),
).pipe(
  Behavior.attach(searchFilter({ elements: { input: "searchInput" } })),
  Behavior.attach(keyboardNav({ elements: { container: "container", items: "item" } })),
  Behavior.attach(selection({ elements: { container: "container", items: "item" } })),
);
```

**But how does the behavior know about the component's slots?**

The `slot` attribute on view elements registers them as named refs. The component's type includes its slot map:

```ts
// Component type now includes its slot signature
type SimpleList = Component
  { items: readonly string[] },       // Props
  never,                               // Req
  never,                               // E
  {                                    // Slots
    container: Element.Container;
    item: Element.Interactive;         // inferred from element type
    searchInput: Element.TextInput;    // inferred from Input element
  }
>;
```

`Behavior.attach` checks that the behavior's element requirements are a subset of the component's slots, with compatible element types.

**Slot type inference from view elements:**

The compiler infers slot types from the elements they're attached to:

```tsx
<Button slot="trigger">Click me</Button>
// slot "trigger" inferred as Element.Interactive (Button is interactive)

<Input slot="search" placeholder="..." />
// slot "search" inferred as Element.TextInput (Input is text input)

<Box slot="content">...</Box>
// slot "content" inferred as Element.Container (Box is container)

<Box slot="draggableItem" draggable>...</Box>
// slot "draggableItem" inferred as Element.Draggable (has draggable attribute)

<ScrollView slot="scrollArea">...</ScrollView>
// slot "scrollArea" inferred as Element.Scrollable
```

**Repeated slots — for list items:**

When a slot appears inside `For`, it represents multiple elements. The behavior needs to handle collections:

```tsx
<For each={items}>
  {(item, i) => (
    <Box slot="item" data-key={item().id}>
      <Text>{item().name}</Text>
    </Box>
  )}
</For>
```

The `item` slot is a collection slot — it produces N element refs, one per list item. Behaviors that target collection slots receive `Element.Collection` instead of a single element:

```ts
declare namespace Element {
  interface Collection<E extends Any> {
    readonly count: ReadonlyAtom<number>;
    readonly items: ReadonlyAtom<readonly E[]>;
    at(index: number): E | undefined;
    byKey(key: string): E | undefined;
    forEach(fn: (el: E, index: number) => Effect.Effect<void, never, Scope>): Effect.Effect<void, never, Scope>;
  }
}

// Selection behavior works with collections
const selection = <T>() => Behavior.make(
  Behavior.elements({
    items: Element.Collection(Element.Interactive),
  }),
  (els) => Effect.gen(function* () {
    const selected = yield* Component.state<Set<string>>(new Set());

    // Attach to each item in the collection
    yield* els.items.forEach((el, index) =>
      Effect.gen(function* () {
        yield* el.on("press", () => {
          const key = el.getAttr("data-key") as string;
          selected.update((s) => {
            const next = new Set(s);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
          });
        });
        yield* el.setAttr("aria-selected", () =>
          selected().has(el.getAttr("data-key") as string)
        );
      })
    );

    return { selected };
  }),
);
```

When items are added or removed from the list, the behavior's `forEach` re-runs for new items and cleanup runs for removed items (via scope).

**Behaviors as standalone transformers — taking any component that meets requirements:**

Behaviors don't have to be piped onto a specific component. They can be standalone functions that accept any component meeting their slot requirements:

```ts
// A behavior function that works on ANY component with the right slots
const makeSelectable = Behavior.decorator(
  // Required slots
  { items: Element.Collection(Element.Interactive) },

  // What the behavior adds
  (els) => Effect.gen(function* () {
    const selected = yield* Component.state<Set<string>>(new Set());

    yield* els.items.forEach((el) =>
      Effect.gen(function* () {
        yield* el.on("press", () => {
          const key = el.getAttr("data-key") as string;
          selected.update((s) => {
            const next = new Set(s);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
          });
        });
        yield* el.setAttr("aria-selected", () =>
          selected().has(el.getAttr("data-key") as string)
        );
      })
    );

    return { selected };
  }),
);

// Apply to ANY component that has an "items" collection slot
const SelectableUserList = makeSelectable(UserList);
const SelectableTodoList = makeSelectable(TodoList);
const SelectableFileList = makeSelectable(FileList);

// Type error: PhotoGrid doesn't have an "items" slot
const SelectablePhotoGrid = makeSelectable(PhotoGrid);
// Error: Component 'PhotoGrid' does not have slot 'items' of type Collection<Interactive>
```

`Behavior.decorator` produces a function that accepts any component whose slot signature satisfies the behavior's requirements. The compiler checks this at each call site.

**Composing decorators:**

```ts
const makeInteractiveList = flow(
  makeSelectable,
  makeKeyboardNavigable,
  makeSortable,
);

// Apply the composed decorator
const InteractiveUserList = makeInteractiveList(UserList);
// UserList must have slots: items (Collection<Interactive>), container (Focusable)
// If it does, all three behaviors are attached
// If it doesn't, compile error tells you which slot is missing
```

`flow` composes the decorators. Each one adds its requirements to the accumulated slot constraints. If the original component satisfies all of them, the composition succeeds.

**The decorated component exposes the composed bindings:**

```ts
const InteractiveUserList = makeInteractiveList(UserList);

// InteractiveUserList has:
// - All of UserList's original bindings
// - selection.selected, selection.toggle, etc (from makeSelectable)
// - nav.activeIndex, nav.next, nav.prev, etc (from makeKeyboardNavigable)
// - sort.sortColumn, sort.sortDirection, etc (from makeSortable)

// Access in a parent component:
function Dashboard() {
  return (
    <InteractiveUserList
      items={users}
      onSelectionChange={(sel) => console.log("selected:", sel)}
    />
  );
}
```

But wait — how does the parent access the behavior's bindings? The behavior adds state and actions that the parent might need (e.g., reading the selection, programmatically sorting). The decorated component should expose these as part of its public interface.

**Behaviors expose bindings through the component's output type:**

```ts
// Before decoration:
type UserList = Component
  { items: User[] },          // Props
  Api,                         // Req
  HttpError,                   // E
  { items: Collection<Interactive>, container: Container }  // Slots
>;

// After makeSelectable:
type SelectableUserList = Component
  { items: User[] } & SelectableProps,   // Props extended with behavior props
  Api,                                    // Req unchanged
  HttpError,                              // E unchanged
  { items: Collection<Interactive>, container: Container },  // Slots unchanged
  { selected: ReadonlyAtom<Set<string>> } // Exposed bindings added
>;

// SelectableProps might include callbacks
interface SelectableProps {
  onSelectionChange?: (selected: Set<string>) => void;
  initialSelection?: Set<string>;
}
```

The behavior extends the component's props (to accept configuration) and adds exposed bindings (to allow parent access).

**Accessing exposed bindings from parent:**

```tsx
function Dashboard() {
  const listRef = Component.ref<typeof SelectableUserList>();

  return (
    <Box>
      <SelectableUserList ref={listRef} items={users} />
      <Button onPress={() => {
        const selected = listRef.current.bindings.selected();
        deleteUsers(Array.from(selected));
      }}>
        Delete Selected ({listRef.current.bindings.selected().size})
      </Button>
    </Box>
  );
}
```

`Component.ref` gives typed access to the child's exposed bindings. The parent doesn't reach into the child's internals — it accesses what the child (and its behaviors) explicitly expose.

**The element operation model — renderer agnostic:**

When a behavior calls `els.trigger.on("press", handler)` or `els.trigger.setAttr("aria-expanded", value)`, these operations go through the Renderer service. The behavior doesn't know if it's DOM, TUI, or mobile:

```ts
// Inside Element.Interactive implementation:
class ElementHandle implements Element.Interactive {
  constructor(
    private node: RenderNode,
    private renderer: Renderer,
  ) {}

  on(event: string, handler: Function) {
    return Effect.gen(function* () {
      // Renderer maps universal event to platform event
      yield* this.renderer.addEventListener(this.node, event, handler);
      // Scoped — cleanup on scope close
    });
  }

  setAttr(name: string, value: unknown | (() => unknown)) {
    return Effect.gen(function* () {
      if (typeof value === "function") {
        // Reactive — subscribe via Reactivity
        yield* Component.effect(
          value as () => unknown,
          (v) => this.renderer.setProperty(this.node, name, v),
        );
      } else {
        // Static — set once
        yield* this.renderer.setProperty(this.node, name, value);
      }
    });
  }

  get id() {
    return this.renderer.getNodeId(this.node);
  }
}
```

On web, `setAttr("aria-expanded", true)` calls `element.setAttribute("aria-expanded", "true")`. On TUI, it might be a no-op or mapped to a different property. On mobile, it calls the native accessibility API. The behavior doesn't know or care.

**Behaviors that read element state:**

Some behaviors need to read from elements, not just write to them. For example, a resize observer behavior needs to read element dimensions:

```ts
const resizeObserver = Behavior.make(
  Behavior.elements({
    target: Element.Measurable,
  }),
  (els) => Effect.gen(function* () {
    const size = yield* Component.state({ width: 0, height: 0 });

    yield* els.target.onResize((rect) => {
      size.set({ width: rect.width, height: rect.height });
    });

    return {
      width: yield* Component.derived(() => size().width),
      height: yield* Component.derived(() => size().height),
      isNarrow: yield* Component.derived(() => size().width < 640),
    };
  }),
);

declare namespace Element {
  interface Measurable extends Any {
    readonly rect: ReadonlyAtom<{ width: number; height: number; x: number; y: number }>;
    onResize(handler: (rect: DOMRect) => void): Effect.Effect<void, never, Scope>;
  }
}
```

On web, this uses `ResizeObserver`. On mobile, this uses `onLayout`. On TUI, this uses terminal resize events. The behavior works everywhere because it operates on `Element.Measurable`, not DOM-specific APIs.

**Positioning behavior — for popover/tooltip/dropdown:**

```ts
const positioned = Behavior.make(
  Behavior.elements({
    anchor: Element.Measurable,
    floating: Element.Positionable,
  }),
  (els, options: {
    placement?: "top" | "bottom" | "left" | "right";
    offset?: number;
    flip?: boolean;
  }) => Effect.gen(function* () {
    const placement = yield* Component.state(options?.placement ?? "bottom");

    // Compute position reactively based on anchor rect
    yield* Component.effect(
      () => els.anchor.rect(),
      (anchorRect) => {
        const pos = computePosition(anchorRect, placement(), options?.offset ?? 8);
        els.floating.setPosition(pos);
      },
    );

    return {
      placement,
      reposition: () => {
        // Force recalculation
      },
    };
  }),
);

declare namespace Element {
  interface Positionable extends Container {
    setPosition(pos: { top: number; left: number }): void;
  }
}
```

**Full combobox via behavior composition — no prop spreading:**

```tsx
// The view — just elements with slots
const ComboboxView = Component.make(
  Component.props<{ placeholder?: string }>(),
  Component.require(),
  (props) => Effect.succeed({}),
  (props) => (
    <Box slot="root">
      <Box slot="inputWrapper" flex={{ direction: "row" }}>
        <Box slot="tags" flex={{ direction: "row", wrap: true, gap: 4 }} />
        <Input slot="input" placeholder={props.placeholder ?? "Search..."} />
      </Box>
      <Box slot="dropdown">
        <Box slot="listbox">
          {/* Items rendered by the list behavior */}
        </Box>
      </Box>
    </Box>
  ),
);

// Compose behaviors onto the view
const Combobox = ComboboxView.pipe(
  Behavior.attach(disclosure({
    elements: { trigger: "input", content: "dropdown" },
  })),
  Behavior.attach(searchFilter({
    elements: { input: "input" },
  })),
  Behavior.attach(keyboardNav({
    elements: { container: "listbox", items: "option" },
    orientation: "vertical",
  })),
  Behavior.attach(selection({
    elements: { items: "option" },
  })),
  Behavior.attach(focusTrap({
    elements: { container: "root" },
  })),
  Behavior.attach(positioned({
    elements: { anchor: "inputWrapper", floating: "dropdown" },
    placement: "bottom",
  })),
);
```

No prop spreading anywhere. Each behavior attaches its own handlers, ARIA, and state to the elements it needs. The view just declares slots. The pipe chain connects behaviors to slots.

**But what about the list items? They don't exist yet at behavior-attach time.**

The `listbox` slot's items are dynamic — they come from the search filter's `filtered` results. The behavior needs to render items into the listbox. This is where behaviors can inject view content:

```ts
const keyboardNav = Behavior.make(
  Behavior.elements({
    container: Element.Focusable,
    items: Element.Collection(Element.Interactive),
  }),

  // Behavior can provide content for collection slots
  Behavior.renders({
    items: (data, index) => (
      <Box slot="option" data-index={index}>
        {data.label}
      </Box>
    ),
  }),

  (els) => Effect.gen(function* () {
    // ...navigation logic
  }),
);
```

Actually, that couples rendering into the behavior, which we wanted to avoid. Better: the behavior declares it needs a collection slot, and the view provides a render function for that slot:

```tsx
const ComboboxView = Component.make(
  Component.props<{
    items: readonly { label: string; value: string }[];
    renderItem?: (item: { label: string; value: string }, index: number) => ViewNode;
  }>(),
  Component.require(),
  (props) => Effect.succeed({}),
  (props) => (
    <Box slot="root">
      <Input slot="input" placeholder="Search..." />
      <Box slot="dropdown">
        <Box slot="listbox">
          <For each={props.items}>
            {(item, i) => (
              <Box slot="option" data-key={item().value}>
                {props.renderItem
                  ? props.renderItem(item(), i())
                  : <Text>{item().label}</Text>
                }
              </Box>
            )}
          </For>
        </Box>
      </Box>
    </Box>
  ),
);
```

The view renders items. The behavior attaches to the `option` collection slot. Items come through props. Rendering comes through the view. Behavior comes through the pipe. Clean separation.

**What about the anti-pattern: losing type safety?**

The slot-based approach maintains type safety because:

Slot names are in the component's type. `Behavior.attach` checks at compile time that the component has the required slots. Element type constraints are checked — if a behavior needs `Element.TextInput` but the slot is just an `Element.Container`, compile error. Collection vs single element is checked — if a behavior expects `Collection<Interactive>` but the slot is a single `Interactive`, compile error.

```ts
// This fails at compile time:
Behavior.attach(searchFilter({
  elements: { input: "listbox" },  // listbox is Container, not TextInput
}));
// Error: Slot 'listbox' is Element.Container, but searchFilter requires Element.TextInput

Behavior.attach(keyboardNav({
  elements: { container: "input" },  // input is TextInput, not a collection container
}));
// Error: Slot 'input' is Element.TextInput, but keyboardNav.container requires Element.Focusable with Collection
```

**What about composability?**

Behaviors compose because they're independent Effect generators that operate on element refs. They don't need to know about each other. The disclosure behavior sets `aria-expanded` on the trigger. The keyboard nav behavior sets `aria-activedescendant` on the container. Both operate on the same element through different attributes. They don't conflict because ARIA attributes are orthogonal.

When behaviors do need to coordinate (disclosure opening when nav selects, search filtering what nav navigates), the coordination happens through shared atoms:

```ts
// Coordinated combobox behavior
const comboboxBehavior = Behavior.compose(
  disclosure,
  searchFilter,
  keyboardNav,
  selection,
  // Wiring function — connects behaviors through shared state
  (disc, search, nav, sel) => ({
    // When search query changes and dropdown isn't open, open it
    onSearchInput: () => { if (!disc.isOpen()) disc.open(); },
    // When nav selects, update selection and close if single-select
    onNavSelect: (item) => { sel.toggle(item); if (!sel.multiple) disc.close(); },
    // When disclosure closes, clear search
    onClose: () => { search.clear(); nav.reset(); },
  }),
);
```

`Behavior.compose` takes multiple behaviors and a wiring function. The wiring function receives each behavior's returned bindings and can connect them. The composed behavior exposes all constituent bindings plus the wiring.

**The final behavior model:**

```
Behavior.make(elements, logic)
  — declares element requirements (typed)
  — receives element refs (attached by framework)
  — returns bindings (state + actions)
  — scoped (cleanup automatic)

Behavior.decorator(elements, logic)
  — returns a function that takes any component with matching slots
  — compile-time slot checking
  — adds bindings to component's exposed interface

Behavior.compose(b1, b2, ..., wiring)
  — merges element requirements (intersection)
  — runs all behaviors
  — wiring function connects them via shared state
  — returns merged bindings

Behavior.attach(behavior, { elementMap })
  — pipe: attaches behavior to component
  — maps behavior's element names to component's slot names
  — compile-time verification

Component.make(props, require, setup, view)
  — view uses slot="name" to expose elements
  — setup uses yield* for services and queries
  — behaviors attached via pipe

Element types (from platform)
  — Interactive: press, keydown, setAttr
  — Container: visible, children
  — Focusable: focus, blur, hasFocus
  — TextInput: value, input event
  — Scrollable: scrollTo, scrollPosition
  — Measurable: rect, onResize
  — Positionable: setPosition
  — Draggable: drag events
  — Collection<E>: forEach, at, byKey

No prop spreading.
Behaviors attach directly to elements via refs.
Slot types are inferred from view elements.
Element capabilities are platform-agnostic.
Everything is typed, scoped, composable.
```

This is cleaner than the prop-spreading model. The view declares structure and slots. Behaviors declare element requirements and attach directly. The framework connects them and verifies the types. No manual wiring. No forgotten ARIA attributes. No bags of props to spread. The behavior operates on the element, not through the element's consumer.