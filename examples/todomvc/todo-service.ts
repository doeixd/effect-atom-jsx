import { Effect, Layer, ServiceMap } from "effect";

export interface Todo {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
  readonly createdAt: number;
}

export type TodoError =
  | { readonly _tag: "ValidationError"; readonly message: string }
  | { readonly _tag: "NotFound"; readonly message: string }
  | { readonly _tag: "RpcError"; readonly message: string };

export interface TodoApi {
  readonly list: () => Effect.Effect<ReadonlyArray<Todo>, TodoError>;
  readonly add: (title: string) => Effect.Effect<Todo, TodoError>;
  readonly toggle: (id: string) => Effect.Effect<void, TodoError>;
  readonly remove: (id: string) => Effect.Effect<void, TodoError>;
  readonly rename: (id: string, title: string) => Effect.Effect<void, TodoError>;
  readonly clearCompleted: () => Effect.Effect<number, TodoError>;
}

export const TodoApi = ServiceMap.Service<TodoApi>("TodoApi");

export function createInMemoryTodoApi(initial: ReadonlyArray<Todo> = []): TodoApi {
  let todos = [...initial];
  let nextId = initial.length + 1;

  const normalize = (title: string): string => title.trim();

  return {
    list: () => Effect.succeed(todos).pipe(Effect.delay("80 millis")),
    add: (title) => Effect.gen(function* () {
      const normalized = normalize(title);
      if (normalized.length === 0) {
        return yield* Effect.fail<TodoError>({ _tag: "ValidationError", message: "Todo title cannot be empty" });
      }
      const todo: Todo = {
        id: String(nextId++),
        title: normalized,
        completed: false,
        createdAt: Date.now(),
      };
      todos = [todo, ...todos];
      return yield* Effect.succeed(todo).pipe(Effect.delay("100 millis"));
    }),
    toggle: (id) => Effect.gen(function* () {
      const idx = todos.findIndex((t) => t.id === id);
      if (idx < 0) {
        return yield* Effect.fail<TodoError>({ _tag: "NotFound", message: `Todo ${id} was not found` });
      }
      const current = todos[idx]!;
      const updated: Todo = { ...current, completed: !current.completed };
      todos = [...todos.slice(0, idx), updated, ...todos.slice(idx + 1)];
      return yield* Effect.void.pipe(Effect.delay("60 millis"));
    }),
    remove: (id) => Effect.gen(function* () {
      const before = todos.length;
      todos = todos.filter((t) => t.id !== id);
      if (todos.length === before) {
        return yield* Effect.fail<TodoError>({ _tag: "NotFound", message: `Todo ${id} was not found` });
      }
      return yield* Effect.void.pipe(Effect.delay("40 millis"));
    }),
    rename: (id, title) => Effect.gen(function* () {
      const normalized = normalize(title);
      if (normalized.length === 0) {
        return yield* Effect.fail<TodoError>({ _tag: "ValidationError", message: "Todo title cannot be empty" });
      }
      const idx = todos.findIndex((t) => t.id === id);
      if (idx < 0) {
        return yield* Effect.fail<TodoError>({ _tag: "NotFound", message: `Todo ${id} was not found` });
      }
      const current = todos[idx]!;
      const updated: Todo = { ...current, title: normalized };
      todos = [...todos.slice(0, idx), updated, ...todos.slice(idx + 1)];
      return yield* Effect.void.pipe(Effect.delay("40 millis"));
    }),
    clearCompleted: () => Effect.gen(function* () {
      const before = todos.length;
      todos = todos.filter((t) => !t.completed);
      return yield* Effect.succeed(before - todos.length).pipe(Effect.delay("80 millis"));
    }),
  };
}

export const TodoApiLive = Layer.succeed(
  TodoApi,
  createInMemoryTodoApi([
    { id: "1", title: "Try effect-atom-jsx", completed: false, createdAt: Date.now() - 60000 },
    { id: "2", title: "Ship TodoMVC", completed: true, createdAt: Date.now() - 30000 },
  ]),
);

/**
 * Adapter layer for Effect RPC clients.
 *
 * Any generated RPC client that implements the `TodoApi` contract can be
 * mounted with this layer.
 */
export const TodoApiFromRpc = (client: TodoApi): Layer.Layer<TodoApi> =>
  Layer.succeed(TodoApi, client);
