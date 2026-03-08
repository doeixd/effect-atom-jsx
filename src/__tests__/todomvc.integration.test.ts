import { describe, it, expect } from "vitest";
import { Effect, Layer, ManagedRuntime, ServiceMap } from "effect";
import {
  actionEffect,
  AsyncResult,
  createOptimistic,
  createSignal,
  createRoot,
  resourceWith,
} from "../index.js";

type Todo = {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
};

type ApiError = { readonly _tag: "ApiError"; readonly message: string };

type TodoApi = {
  readonly list: () => Effect.Effect<ReadonlyArray<Todo>, ApiError>;
  readonly add: (title: string) => Effect.Effect<void, ApiError>;
  readonly toggle: (id: string) => Effect.Effect<void, ApiError>;
};

const TodoApi = ServiceMap.Service<TodoApi>("TodoApi:Integration");
const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function makeApi(initial: ReadonlyArray<Todo>): TodoApi {
  let todos = [...initial];
  let nextId = todos.length + 1;

  return {
    list: () => Effect.succeed(todos).pipe(Effect.delay("10 millis")),
    add: (title) => Effect.gen(function* () {
      if (title.trim() === "boom") {
        return yield* Effect.fail<ApiError>({ _tag: "ApiError", message: "cannot add boom" });
      }
      todos = [{ id: String(nextId++), title, completed: false }, ...todos];
      return yield* Effect.void.pipe(Effect.delay("10 millis"));
    }),
    toggle: (id) => Effect.gen(function* () {
      const idx = todos.findIndex((todo) => todo.id === id);
      if (idx < 0) {
        return yield* Effect.fail<ApiError>({ _tag: "ApiError", message: `missing todo ${id}` });
      }
      const current = todos[idx]!;
      todos = [...todos.slice(0, idx), { ...current, completed: !current.completed }, ...todos.slice(idx + 1)];
      return yield* Effect.void.pipe(Effect.delay("8 millis"));
    }),
  };
}

describe("TodoMVC integration", () => {
  it("supports optimistic add + refresh over resourceWith", async () => {
    const runtime = ManagedRuntime.make(Layer.succeed(TodoApi, makeApi([
      { id: "1", title: "first", completed: false },
    ])));

    let readTodos!: () => AsyncResult<ReadonlyArray<Todo>, ApiError>;
    let optimistic!: ReturnType<typeof createOptimistic<ReadonlyArray<Todo>>>;
    let add!: ReturnType<typeof actionEffect<string, ApiError, TodoApi>>;
    let refresh!: () => void;

    const dispose = createRoot((d) => {
      const [refreshTick, setRefreshTick] = createSignal(0);
      refresh = () => setRefreshTick((n) => n + 1);

      readTodos = resourceWith(runtime, () =>
        Effect.sync(refreshTick).pipe(
          Effect.flatMap(() => Effect.gen(function* () {
            const api = yield* Effect.service(TodoApi);
            return yield* api.list();
          })),
        ));

      optimistic = createOptimistic(() => {
        const r = readTodos();
        if (r._tag === "Success") return r.value;
        if (r._tag === "Refreshing" && r.previous._tag === "Success") return r.previous.value;
        return [];
      });

      add = actionEffect(
        (title) => Effect.gen(function* () {
          const api = yield* Effect.service(TodoApi);
          yield* api.add(title);
        }),
        {
          runtime,
          optimistic: (title) => optimistic.set((list) => [{ id: "temp", title, completed: false }, ...list]),
          rollback: () => optimistic.clear(),
          onSuccess: () => {
            optimistic.clear();
            refresh();
          },
        },
      );

      return d;
    });

    await tick(30);
    const firstLoad = readTodos();
    expect(firstLoad._tag).toBe("Success");
    expect(optimistic.get().length).toBe(1);

    add.run("second");
    expect(optimistic.get()[0]?.title).toBe("second");
    expect(add.pending()).toBe(true);

    await tick(50);
    expect(add.pending()).toBe(false);
    const refreshed = readTodos();
    expect(refreshed._tag).toBe("Success");
    if (refreshed._tag === "Success") {
      expect(refreshed.value.map((todo) => todo.title)).toContain("second");
    }

    dispose();
    await runtime.dispose();
  });

  it("rolls back optimistic state on typed action failure", async () => {
    const runtime = ManagedRuntime.make(Layer.succeed(TodoApi, makeApi([
      { id: "1", title: "stable", completed: false },
    ])));

    let optimistic!: ReturnType<typeof createOptimistic<ReadonlyArray<Todo>>>;
    let add!: ReturnType<typeof actionEffect<string, ApiError, TodoApi>>;

    const dispose = createRoot((d) => {
      const readTodos = resourceWith(runtime, () =>
        Effect.gen(function* () {
          const api = yield* Effect.service(TodoApi);
          return yield* api.list();
        }));

      optimistic = createOptimistic(() => {
        const r = readTodos();
        if (r._tag === "Success") return r.value;
        if (r._tag === "Refreshing" && r.previous._tag === "Success") return r.previous.value;
        return [];
      });

      add = actionEffect(
        (title) => Effect.gen(function* () {
          const api = yield* Effect.service(TodoApi);
          yield* api.add(title);
        }),
        {
          runtime,
          optimistic: (title) => optimistic.set((list) => [{ id: "temp", title, completed: false }, ...list]),
          rollback: () => optimistic.clear(),
        },
      );

      return d;
    });

    await tick(30);
    add.run("boom");
    await tick(40);
    expect(optimistic.get()[0]?.title).toBe("stable");
    expect(add.result()).toEqual(AsyncResult.failure({ _tag: "ApiError", message: "cannot add boom" }));

    dispose();
    await runtime.dispose();
  });
});
