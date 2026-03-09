import {
  type Accessor,
  type AsyncResult as AsyncResultType,
  Atom,
  Registry,
  defineQuery,
  createOptimistic,
  mutationEffect,
  useService,
} from "effect-atom-jsx";
import { Effect } from "effect";
import { TodoApi, type Todo, type TodoError } from "./todo-service.js";

type Filter = "all" | "active" | "completed";

const ui = Registry.make();
const filterAtom = Atom.make<Filter>("all");
const draftAtom = Atom.make<string>("");
const editingIdAtom = Atom.make<string | null>(null);
const editingTitleAtom = Atom.make<string>("");
const errorTextAtom = Atom.make<string | null>(null);

const toErrorText = (error: TodoError | { readonly defect: string }): string =>
  "defect" in error ? error.defect : error.message;

function settledTodos(result: Accessor<AsyncResultType<ReadonlyArray<Todo>, TodoError>>): ReadonlyArray<Todo> {
  const r = result();
  if (r._tag === "Success") return r.value;
  if (r._tag === "Refreshing" && r.previous._tag === "Success") return r.previous.value;
  return [];
}

export function TodoMvcApp() {
  const todosQuery = defineQuery(
    () => useService(TodoApi).list(),
    { name: "todos" },
  );
  const todosResult = todosQuery.result;

  const optimistic = createOptimistic(() => settledTodos(todosResult));
  const todos = Atom.make((_get) => optimistic.get());
  const refreshing = todosQuery.pending;

  const clearOptimistic = () => optimistic.clear();

  const addTodo = mutationEffect(
    (title: string) => useService(TodoApi).add(title).pipe(Effect.asVoid),
    {
      invalidates: todosQuery.key,
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
        ui.set(draftAtom, "");
        ui.set(errorTextAtom, null);
      },
      onFailure: (e) => {
        clearOptimistic();
        ui.set(errorTextAtom, toErrorText(e));
      },
    },
  );

  const toggleTodo = mutationEffect(
    (id: string) => useService(TodoApi).toggle(id),
    {
      invalidates: todosQuery.key,
      optimistic: (id) => {
        optimistic.set((list) => list.map((todo) =>
          todo.id === id ? { ...todo, completed: !todo.completed } : todo
        ));
      },
      rollback: clearOptimistic,
      onSuccess: () => {
        clearOptimistic();
        ui.set(errorTextAtom, null);
      },
      onFailure: (e) => {
        clearOptimistic();
        ui.set(errorTextAtom, toErrorText(e));
      },
    },
  );

  const removeTodo = mutationEffect(
    (id: string) => useService(TodoApi).remove(id),
    {
      invalidates: todosQuery.key,
      optimistic: (id) => optimistic.set((list) => list.filter((todo) => todo.id !== id)),
      rollback: clearOptimistic,
      onSuccess: () => {
        clearOptimistic();
        ui.set(errorTextAtom, null);
      },
      onFailure: (e) => {
        clearOptimistic();
        ui.set(errorTextAtom, toErrorText(e));
      },
    },
  );

  const renameTodo = mutationEffect(
    ({ id, title }: { id: string; title: string }) => useService(TodoApi).rename(id, title),
    {
      invalidates: todosQuery.key,
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
        ui.set(editingIdAtom, null);
        ui.set(editingTitleAtom, "");
        ui.set(errorTextAtom, null);
      },
      onFailure: (e) => {
        clearOptimistic();
        ui.set(errorTextAtom, toErrorText(e));
      },
    },
  );

  const clearCompleted = mutationEffect(
    (_: void) => useService(TodoApi).clearCompleted().pipe(Effect.asVoid),
    {
      invalidates: todosQuery.key,
      optimistic: () => optimistic.set((list) => list.filter((todo) => !todo.completed)),
      rollback: clearOptimistic,
      onSuccess: () => {
        clearOptimistic();
        ui.set(errorTextAtom, null);
      },
      onFailure: (e) => {
        clearOptimistic();
        ui.set(errorTextAtom, toErrorText(e));
      },
    },
  );

  const visibleTodos = Atom.make((get) => {
    const list = get(todos);
    const mode = get(filterAtom);
    if (mode === "active") return list.filter((todo) => !todo.completed);
    if (mode === "completed") return list.filter((todo) => todo.completed);
    return list;
  });

  const activeCount = Atom.make((get) => get(todos).filter((todo) => !todo.completed).length);
  const completedCount = Atom.make((get) => get(todos).length - get(activeCount));

  const submitDraft = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addTodo.run(ui.get(draftAtom));
  };

  const beginEdit = (todo: Todo) => {
    ui.set(editingIdAtom, todo.id);
    ui.set(editingTitleAtom, todo.title);
  };

  const submitEdit = (event: KeyboardEvent, id: string) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    renameTodo.run({ id, title: ui.get(editingTitleAtom) });
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
          value={ui.get(draftAtom)}
          onInput={(e) => ui.set(draftAtom, (e.currentTarget as HTMLInputElement).value)}
          onKeyDown={submitDraft}
        />

        {refreshing() && <p class="hint">Refreshing...</p>}
        {ui.get(errorTextAtom) && <p class="error">{ui.get(errorTextAtom)}</p>}

        <ul class="todo-list">
          {ui.get(visibleTodos).map((todo) => {
            const editing = ui.get(editingIdAtom) === todo.id;
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
                      value={ui.get(editingTitleAtom)}
                      onInput={(e) => ui.set(editingTitleAtom, (e.currentTarget as HTMLInputElement).value)}
                      onBlur={() => renameTodo.run({ id: todo.id, title: ui.get(editingTitleAtom) })}
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
          <span>{ui.get(activeCount)} active</span>
          <nav class="filters">
            <button class={ui.get(filterAtom) === "all" ? "selected" : ""} onClick={() => ui.set(filterAtom, "all")}>All</button>
            <button class={ui.get(filterAtom) === "active" ? "selected" : ""} onClick={() => ui.set(filterAtom, "active")}>Active</button>
            <button class={ui.get(filterAtom) === "completed" ? "selected" : ""} onClick={() => ui.set(filterAtom, "completed")}>Completed</button>
          </nav>
          <button
            class="clear"
            disabled={ui.get(completedCount) === 0}
            onClick={() => clearCompleted.run(void 0)}
          >
            Clear completed ({ui.get(completedCount)})
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
