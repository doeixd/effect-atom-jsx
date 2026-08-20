/**
 * AN-2 — server-push Reactivity (`src/reactivity-push.ts`), promoted from
 * `future/agent/live-sync.spec.ts` once every spec passed.
 *
 * The claim: when the agent invalidates `["todos"]` server-side, connected
 * browsers hear it, and the *dependent* queries refresh — nothing else. The
 * negative half is the load-bearing one: a push that invalidates everything is
 * indistinguishable from a page reload and defeats the point of keys.
 */
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Agent from "../Agent.js";
import * as Portable from "../Portable.js";
import { Key, ReactivityTag, test as reactivityTest } from "../Reactivity.js";
import {
  applyPushedInvalidation,
  makeReactivityBroadcast,
  ReactivityBroadcast,
} from "../reactivity-push.js";

const BUILD = "build-an2";

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

describe("AN-2 live sync", () => {
  it("an agent-initiated mutation delivers exactly its declared keys to a connected client", async () => {
    const bus = await run(makeReactivityBroadcast());

    // Two independent "browsers" subscribe.
    const clientA: Array<ReadonlyArray<string>> = [];
    const clientB: Array<ReadonlyArray<string>> = [];
    await run(bus.connect((keys) => clientA.push(keys)));
    await run(bus.connect((keys) => clientB.push(keys)));

    const AddTodo = Portable.code({
      id: "todo.add",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_c, text: string) => Effect.succeed({ id: "t1", text }),
    });

    const c = Agent.catalog({
      addTodo: Agent.expose(AddTodo, {
        description: "Add a todo",
        args: Schema.Tuple([Schema.String]),
        success: Schema.Struct({ id: Schema.String, text: Schema.String }),
        reactivityKeys: ["todos"],
        access: { agent: true },
      }),
    });

    const response = await run(
      Agent.dispatch(c)({ tool: "addTodo", args: ["milk"], buildId: BUILD }).pipe(
        Effect.provide(bus.serverLayer),
        Effect.orDie,
      ),
    );
    expect(response.ok).toBe(true);
    await run(bus.flush());

    // Every connected client hears it, once, with exactly the declared keys.
    expect(clientA).toEqual([["todos"]]);
    expect(clientB).toEqual([["todos"]]);
  });

  it("a failed agent mutation broadcasts nothing", async () => {
    class RejectedError extends Schema.TaggedErrorClass<RejectedError>(
      "reactivity-push-test/RejectedError",
    )("RejectedError", { reason: Schema.String }) {}

    const bus = await run(makeReactivityBroadcast());
    const received: Array<ReadonlyArray<string>> = [];
    await run(bus.connect((keys) => received.push(keys)));

    const AddTodo = Portable.code({
      id: "todo.add.fail",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () => Effect.fail(new RejectedError({ reason: "quota" })),
    });

    const c = Agent.catalog({
      addTodo: Agent.expose(AddTodo, {
        description: "Add a todo",
        args: Schema.Tuple([]),
        success: Schema.Struct({ id: Schema.String }),
        error: RejectedError,
        reactivityKeys: ["todos"],
        access: { agent: true },
      }),
    });

    const response = await run(
      Agent.dispatch(c)({ tool: "addTodo", args: [], buildId: BUILD }).pipe(
        Effect.provide(bus.serverLayer),
        Effect.orDie,
      ),
    );
    expect(response.ok).toBe(false);
    await run(bus.flush());
    expect(received).toEqual([]);

    // NEGATIVE CONTROL. "Broadcasts nothing" is also true of a bus that never
    // broadcasts. A *succeeding* action declaring the same keys must publish
    // exactly once. Fresh bus and fresh recorder, so the two phases are
    // isolated.
    const okBus = await run(makeReactivityBroadcast());
    const okReceived: Array<ReadonlyArray<string>> = [];
    await run(okBus.connect((keys) => okReceived.push(keys)));
    const okCatalog = Agent.catalog({
      addTodo: Agent.expose(
        Portable.code({
          id: "todo.add.ok",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: () => Effect.succeed({ id: "t1" }),
        }),
        {
          description: "Add a todo",
          args: Schema.Tuple([]),
          success: Schema.Struct({ id: Schema.String }),
          reactivityKeys: ["todos"],
          access: { agent: true },
        },
      ),
    });
    const ok = await run(
      Agent.dispatch(okCatalog)({ tool: "addTodo", args: [], buildId: BUILD }).pipe(
        Effect.provide(okBus.serverLayer),
        Effect.orDie,
      ),
    );
    expect(ok.ok).toBe(true);
    await run(okBus.flush());
    expect(okReceived).toEqual([["todos"]]);
  });

  it("a received push refreshes exactly the dependent queries and nothing else", async () => {
    const refreshes: Record<string, number> = { todos: 0, users: 0, "todo:1": 0 };
    const clientProgram = Effect.gen(function* () {
      const reactivity = yield* ReactivityTag;
      yield* reactivity.subscribe(["todos"], () => {
        refreshes.todos += 1;
      });
      yield* reactivity.subscribe(["users"], () => {
        refreshes.users += 1;
      });
      yield* reactivity.subscribe(["todo:1"], () => {
        refreshes["todo:1"] += 1;
      });
      // The client half of AN-2 is "invalidate the keys the server sent".
      yield* applyPushedInvalidation(["todos"]);
      yield* reactivity.flush();
    });

    await run(clientProgram.pipe(Effect.provide(reactivityTest)));

    expect(refreshes.todos).toBe(1);
    // The negative guarantee: unrelated queries do not refetch.
    expect(refreshes.users).toBe(0);
    expect(refreshes["todo:1"]).toBe(0);
  });

  it("pushed keys use the one reactivity key vocabulary, including family hierarchy", async () => {
    // Push must not invent a key dialect: a pushed parent key reaches child
    // observers exactly as an in-process invalidation does (Reactivity.Key).
    const todo = Key.family("todo");
    const bus = await run(makeReactivityBroadcast());
    const seen: Array<ReadonlyArray<string>> = [];
    await run(bus.connect((keys) => seen.push(keys)));

    await run(bus.publish([todo(1)]));
    await run(bus.flush());

    // Witnesses are accepted, and travel as their plain key strings.
    expect(seen).toEqual([["todo", "todo:1"]]);

    let childRefreshes = 0;
    let parentRefreshes = 0;
    await run(
      Effect.gen(function* () {
        const reactivity = yield* ReactivityTag;
        yield* reactivity.subscribe(["todo:1"], () => {
          childRefreshes += 1;
        });
        yield* reactivity.subscribe(["todo"], () => {
          parentRefreshes += 1;
        });
        yield* applyPushedInvalidation(seen[0]!);
        yield* reactivity.flush();
      }).pipe(Effect.provide(reactivityTest)),
    );

    expect(childRefreshes).toBe(1);
    expect(parentRefreshes).toBe(1);
  });

  it("a disconnected client stops receiving pushes and leaves no subscription behind", async () => {
    const bus = await run(makeReactivityBroadcast());
    const received: Array<ReadonlyArray<string>> = [];
    const disconnect = await run(bus.connect((keys) => received.push(keys)));

    await run(bus.publish(["todos"]));
    await run(bus.flush());
    expect(received).toHaveLength(1);

    await run(disconnect());
    await run(bus.publish(["todos"]));
    await run(bus.flush());

    // Exactly once, for the one message delivered while connected.
    expect(received).toHaveLength(1);
    expect(await run(bus.connectionCount())).toBe(0);

    // Disconnect is idempotent: a second run does not disturb other clients.
    const other = await run(bus.connect(() => {}));
    await run(disconnect());
    expect(await run(bus.connectionCount())).toBe(1);
    await run(other());
    expect(await run(bus.connectionCount())).toBe(0);
  });

  it("agent and UI mutations produce the same invalidation, so live sync is caller-agnostic", async () => {
    const AddTodo = Portable.code({
      id: "todo.add.shared",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_c, text: string) => Effect.succeed({ id: "t1", text }),
    });
    const c = Agent.catalog({
      addTodo: Agent.expose(AddTodo, {
        description: "Add a todo",
        args: Schema.Tuple([Schema.String]),
        success: Schema.Struct({ id: Schema.String, text: Schema.String }),
        reactivityKeys: ["todos"],
        access: { agent: true, http: true },
      }),
    });

    const observe = async <Provided>(surface: Layer.Layer<Provided>) => {
      const bus = await run(makeReactivityBroadcast());
      const received: Array<ReadonlyArray<string>> = [];
      await run(bus.connect((keys) => received.push(keys)));
      await run(
        Agent.dispatch(c)({ tool: "addTodo", args: ["milk"], buildId: BUILD }).pipe(
          Effect.provide(Layer.mergeAll(bus.serverLayer, surface)),
          Effect.orDie,
        ),
      );
      await run(bus.flush());
      return received;
    };

    expect(await observe(Agent.uiLayer({ caller: "ui" }))).toEqual([["todos"]]);
    expect(await observe(Agent.agentLayer({ caller: "agent" }))).toEqual([["todos"]]);
  });

  // ─── Coverage beyond the promoted specs ────────────────────────────────────

  it("publishes batch and deduplicate until the flush tick", async () => {
    const bus = await run(makeReactivityBroadcast());
    const received: Array<ReadonlyArray<string>> = [];
    await run(bus.connect((keys) => received.push(keys)));

    await run(bus.publish(["todos"]));
    await run(bus.publish(["users", "todos"]));
    await run(bus.flush());

    // One delivery per flush, order-preserving, no duplicate keys.
    expect(received).toEqual([["todos", "users"]]);

    // A flush with nothing pending delivers nothing.
    await run(bus.flush());
    expect(received).toHaveLength(1);
  });

  it("declared witness keys normalize once and stay identical across payload and push", async () => {
    const Todos = Key.make("todos");
    const bus = await run(makeReactivityBroadcast());
    const pushed: Array<ReadonlyArray<string>> = [];
    await run(bus.connect((keys) => pushed.push(keys)));

    const c = Agent.catalog({
      addTodo: Agent.expose(
        Portable.code({
          id: "todo.add.witness",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: () => Effect.succeed({ id: "t1" }),
        }),
        {
          description: "Add a todo",
          args: Schema.Tuple([]),
          success: Schema.Struct({ id: Schema.String }),
          reactivityKeys: [Todos],
          access: { agent: true },
        },
      ),
    });

    const response = await run(
      Agent.dispatch(c)({ tool: "addTodo", args: [], buildId: BUILD }).pipe(
        Effect.provide(bus.serverLayer),
        Effect.orDie,
      ),
    );
    await run(bus.flush());
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.payload.invalidated).toEqual(["todos"]);
    }
    expect(pushed).toEqual([["todos"]]);
  });

  it("publish is an authored seam: the reserved af: namespace is rejected (DQ-089)", async () => {
    const bus = await run(makeReactivityBroadcast());
    await expect(run(bus.publish(["af:binding:sneaky"]))).rejects.toThrow(/reserved/);
  });

  it("connectScoped releases the subscription exactly when the scope closes", async () => {
    const bus = await run(makeReactivityBroadcast());
    const received: Array<ReadonlyArray<string>> = [];

    await run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* bus.connectScoped((keys) => received.push(keys));
          yield* bus.publish(["todos"]);
          yield* bus.flush();
        }),
      ),
    );
    expect(received).toEqual([["todos"]]);
    expect(await run(bus.connectionCount())).toBe(0);

    // After the scope closed, nothing is delivered to the dead subscription.
    await run(bus.publish(["todos"]));
    await run(bus.flush());
    expect(received).toHaveLength(1);
  });

  it("serverLayer provides the same publisher the bus delivers from", async () => {
    const bus = await run(makeReactivityBroadcast());
    const received: Array<ReadonlyArray<string>> = [];
    await run(bus.connect((keys) => received.push(keys)));

    await run(
      Effect.gen(function* () {
        const publisher = yield* ReactivityBroadcast;
        yield* publisher.publish(["todos"]);
      }).pipe(Effect.provide(bus.serverLayer)),
    );
    await run(bus.flush());
    expect(received).toEqual([["todos"]]);
  });

  it("a dispatch with no declared keys publishes nothing even on success", async () => {
    const bus = await run(makeReactivityBroadcast());
    const received: Array<ReadonlyArray<string>> = [];
    await run(bus.connect((keys) => received.push(keys)));

    const c = Agent.catalog({
      ping: Agent.expose(
        Portable.code({
          id: "misc.ping",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: () => Effect.succeed({ ok: true }),
        }),
        {
          description: "Ping",
          args: Schema.Tuple([]),
          success: Schema.Struct({ ok: Schema.Boolean }),
          access: { agent: true },
        },
      ),
    });

    const response = await run(
      Agent.dispatch(c)({ tool: "ping", args: [], buildId: BUILD }).pipe(
        Effect.provide(bus.serverLayer),
        Effect.orDie,
      ),
    );
    expect(response.ok).toBe(true);
    await run(bus.flush());
    expect(received).toEqual([]);
  });
});
