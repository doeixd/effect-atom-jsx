import {
  type Accessor,
  type AsyncResult as AsyncResultType,
  Atom,
  AtomRef,
  Registry,
  createMemo,
  createSignal,
  onCleanup,
  resource,
  createOptimistic,
  actionEffect,
  isPending,
  AsyncResult,
  use,
} from "effect-atom-jsx";
import { Effect } from "effect";
import { TodoApi, type Todo, type TodoError } from "./todo-service.js";

type Filter = "all" | "active" | "completed";

const ui = Registry.make();
const filterAtom = Atom.make<Filter>("all");
const refreshTickAtom = Atom.make(0);
const formRef = AtomRef.make({
  draft: "",
  editingId: null as string | null,
  editingTitle: "",
  errorText: null as string | null,
});

const toErrorText = (error: TodoError | { readonly defect: string }): string =>
  "defect" in error ? error.defect : error.message;

function settledTodos(result: Accessor<AsyncResultType<ReadonlyArray<Todo>, TodoError>>): ReadonlyArray<Todo> {
  const r = result();
  if (r._tag === "Success") return r.value;
  if (r._tag === "Refreshing" && r.previous._tag === "Success") return r.previous.value;
  return [];
}

export function TodoMvcApp() {
  const draftRef = formRef.prop("draft");
  const editingIdRef = formRef.prop("editingId");
  const editingTitleRef = formRef.prop("editingTitle");
  const errorTextRef = formRef.prop("errorText");

  const [draft, setDraftView] = createSignal(draftRef.value);
  const [editingId, setEditingIdView] = createSignal(editingIdRef.value);
  const [editingTitle, setEditingTitleView] = createSignal(editingTitleRef.value);
  const [errorText, setErrorTextView] = createSignal(errorTextRef.value);
  const [filter, setFilterView] = createSignal(ui.get(filterAtom));

  const unsubDraft = draftRef.subscribe(setDraftView);
  const unsubEditingId = editingIdRef.subscribe(setEditingIdView);
  const unsubEditingTitle = editingTitleRef.subscribe(setEditingTitleView);
  const unsubErrorText = errorTextRef.subscribe(setErrorTextView);
  const unsubFilter = ui.subscribe(filterAtom, setFilterView);

  onCleanup(() => {
    unsubDraft();
    unsubEditingId();
    unsubEditingTitle();
    unsubErrorText();
    unsubFilter();
  });

  const todosResult = resource(() =>
    Effect.sync(() => ui.get(refreshTickAtom)).pipe(Effect.flatMap(() => use(TodoApi).list()))
  );

  const optimistic = createOptimistic(() => settledTodos(todosResult));
  const todos = Atom.make((_get) => optimistic.get());
  const refreshing = isPending(todosResult);

  const refresh = () => ui.update(refreshTickAtom, (n) => n + 1);
  const clearOptimistic = () => optimistic.clear();

  const addTodo = actionEffect(
    (title: string) => use(TodoApi).add(title).pipe(Effect.asVoid),
    {
      optimistic: (title) => {
        const normalized = title.trim();
        if (normalized.length === 0) return;
        optimistic.set((list) => [
          {
            id: `optimistic-${Date.now()}`,
            title: normalized,
            completed: false,
            createdAt: Date.now(),
          },
          ...list,
        ]);
      },
      rollback: clearOptimistic,
      onSuccess: () => {
        clearOptimistic();
        draftRef.set("");
        errorTextRef.set(null);
        refresh();
      },
      onFailure: (e) => {
        clearOptimistic();
        errorTextRef.set(toErrorText(e));
      },
    },
  );

  const toggleTodo = actionEffect(
    (id: string) => use(TodoApi).toggle(id),
    {
      optimistic: (id) => {
        optimistic.set((list) => list.map((todo) =>
          todo.id === id ? { ...todo, completed: !todo.completed } : todo
        ));
      },
      rollback: clearOptimistic,
      onSuccess: () => {
        clearOptimistic();
        errorTextRef.set(null);
        refresh();
      },
      onFailure: (e) => {
        clearOptimistic();
        errorTextRef.set(toErrorText(e));
      },
    },
  );

  const removeTodo = actionEffect(
    (id: string) => use(TodoApi).remove(id),
    {
      optimistic: (id) => optimistic.set((list) => list.filter((todo) => todo.id !== id)),
      rollback: clearOptimistic,
      onSuccess: () => {
        clearOptimistic();
        errorTextRef.set(null);
        refresh();
      },
      onFailure: (e) => {
        clearOptimistic();
        errorTextRef.set(toErrorText(e));
      },
    },
  );

  const renameTodo = actionEffect(
    ({ id, title }: { id: string; title: string }) => use(TodoApi).rename(id, title),
    {
      optimistic: ({ id, title }) => {
        const normalized = title.trim();
        if (normalized.length === 0) return;
        optimistic.set((list) => list.map((todo) =>
          todo.id === id ? { ...todo, title: normalized } : todo
        ));
      },
      rollback: clearOptimistic,
      onSuccess: () => {
        clearOptimistic();
        editingIdRef.set(null);
        editingTitleRef.set("");
        errorTextRef.set(null);
        refresh();
      },
      onFailure: (e) => {
        clearOptimistic();
        errorTextRef.set(toErrorText(e));
      },
    },
  );

  const clearCompleted = actionEffect(
    () => use(TodoApi).clearCompleted().pipe(Effect.asVoid),
    {
      optimistic: () => optimistic.set((list) => list.filter((todo) => !todo.completed)),
      rollback: clearOptimistic,
      onSuccess: () => {
        clearOptimistic();
        errorTextRef.set(null);
        refresh();
      },
      onFailure: (e) => {
        clearOptimistic();
        errorTextRef.set(toErrorText(e));
      },
    },
  );

  const visibleTodos = createMemo(() => {
    const list = ui.get(todos);
    const mode = filter();
    if (mode === "active") return list.filter((todo) => !todo.completed);
    if (mode === "completed") return list.filter((todo) => todo.completed);
    return list;
  });

  const activeCount = createMemo(() => ui.get(todos).filter((todo) => !todo.completed).length);
  const completedCount = createMemo(() => ui.get(todos).length - activeCount());

  const submitDraft = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addTodo.run(draft());
  };

  const beginEdit = (todo: Todo) => {
    editingIdRef.set(todo.id);
    editingTitleRef.set(todo.title);
  };

  const submitEdit = (event: KeyboardEvent, id: string) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    renameTodo.run({ id, title: editingTitle() });
  };

  return (
    <section class="shell">
      <header class="hero">
        <h1>TodoMVC</h1>
        <p>effect-atom-jsx + Effect services + optimistic actions</p>
      </header>

      <section class="card">
        <input
          class="new-todo"
          placeholder="What needs to be done?"
          value={draft()}
          onInput={(e) => draftRef.set((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={submitDraft}
        />

        {refreshing() && <p class="hint">Refreshing...</p>}
        {errorText() && <p class="error">{errorText()}</p>}

        <ul class="todo-list">
          {visibleTodos().map((todo) => {
            const editing = editingId() === todo.id;
            return (
              <li class={`todo-item ${todo.completed ? "done" : ""}`}>
                <label class="row">
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() => toggleTodo.run(todo.id)}
                  />
                  {editing ? (
                    <input
                      class="edit"
                      value={editingTitle()}
                      onInput={(e) => editingTitleRef.set((e.currentTarget as HTMLInputElement).value)}
                      onBlur={() => renameTodo.run({ id: todo.id, title: editingTitle() })}
                      onKeyDown={(e) => submitEdit(e as KeyboardEvent, todo.id)}
                    />
                  ) : (
                    <span onDblClick={() => beginEdit(todo)}>{todo.title}</span>
                  )}
                </label>
                <button class="destroy" onClick={() => removeTodo.run(todo.id)}>x</button>
              </li>
            );
          })}
        </ul>

        <footer class="footer">
          <span>{activeCount()} active</span>
          <nav class="filters">
            <button class={filter() === "all" ? "selected" : ""} onClick={() => ui.set(filterAtom, "all")}>All</button>
            <button class={filter() === "active" ? "selected" : ""} onClick={() => ui.set(filterAtom, "active")}>Active</button>
            <button class={filter() === "completed" ? "selected" : ""} onClick={() => ui.set(filterAtom, "completed")}>Completed</button>
          </nav>
          <button
            class="clear"
            disabled={completedCount() === 0}
            onClick={() => clearCompleted.run(undefined)}
          >
            Clear completed ({completedCount()})
          </button>
        </footer>
      </section>

      <section class="status">
        <p>Load state: {todosResult()._tag}</p>
        <p>Add pending: {String(addTodo.pending())}</p>
        <p>Mutation state: {removeTodo.result()._tag}</p>
      </section>
    </section>
  );
}
