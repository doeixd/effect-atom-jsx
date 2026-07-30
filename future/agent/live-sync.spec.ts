/**
 * AN-2 — server-push Reactivity, closing the live-sync loop for
 * agent-initiated mutations (`AGENT_NATIVE_NOTES.md` §3, sequencing item AN-2).
 *
 * The claim: when the agent invalidates `["todos"]` server-side, connected
 * browsers hear it, and the *dependent* queries refresh — nothing else. The
 * negative half is the load-bearing one: a push that invalidates everything is
 * indistinguishable from a page reload and defeats the point of keys.
 *
 * Transport is deliberately abstracted here (the notes say "can start as SSE").
 * These specs pin the behaviour, not the framing.
 *
 * RATIFIED (`AGENT_NATIVE_NOTES.md` §10, `DQ-080`): the two-arm dispatch
 * envelope, whose `payload.invalidated` is the key list AN-2 consumes — that is
 * why `invalidated` was made additive on `SingleFlightPayload` rather than left
 * to a side channel. The "PROVISIONAL ENVELOPE" markers are retired.
 *
 * STILL PROVISIONAL, pending `DQ-096`: the module names `src/reactivity-push.ts`
 * and `src/Agent.ts` (`AGENT_NATIVE_NOTES.md` §9.10).
 */

import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc } from "../harness.js";
import { run } from "./support.js";

const BUILD = "build-an2";

describe("AN-2 live sync", () => {
  it("[AN-2] an agent-initiated mutation delivers exactly its declared keys to a connected client", async () => {
    const { makeReactivityBroadcast } = await fromSrc(
      "reactivity-push",
      "makeReactivityBroadcast",
    );
    const { catalog, expose, dispatch } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatch",
    );
    const { code } = await fromSrc("Portable", "code");

    const bus = await run(makeReactivityBroadcast());

    // Two independent "browsers" subscribe.
    const clientA: Array<ReadonlyArray<string>> = [];
    const clientB: Array<ReadonlyArray<string>> = [];
    await run(bus.connect((keys: ReadonlyArray<string>) => clientA.push(keys)));
    await run(bus.connect((keys: ReadonlyArray<string>) => clientB.push(keys)));

    const AddTodo = code({
      id: "todo.add",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_c: any, text: string) => Effect.succeed({ id: "t1", text }),
    });

    const c = catalog({
      addTodo: expose(AddTodo, {
        description: "Add a todo",
        args: Schema.Tuple([Schema.String]),
        success: Schema.Struct({ id: Schema.String, text: Schema.String }),
        reactivityKeys: ["todos"],
        access: { agent: true },
      }),
    });

    const response = await run(
      dispatch(c)({ tool: "addTodo", args: ["milk"], buildId: BUILD }).pipe(
        Effect.provide(bus.serverLayer),
      ),
    );
    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(response.ok).toBe(true);
    await run(bus.flush());

    // Every connected client hears it, once, with exactly the declared keys.
    expect(clientA).toEqual([["todos"]]);
    expect(clientB).toEqual([["todos"]]);
  });

  it("[AN-2] a failed agent mutation broadcasts nothing", async () => {
    const { makeReactivityBroadcast } = await fromSrc(
      "reactivity-push",
      "makeReactivityBroadcast",
    );
    const { catalog, expose, dispatch } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatch",
    );
    const { code } = await fromSrc("Portable", "code");

    class RejectedError extends Schema.TaggedErrorClass<RejectedError>(
      "future/agent/RejectedError",
    )("RejectedError", { reason: Schema.String }) {}

    const bus = await run(makeReactivityBroadcast());
    const received: Array<ReadonlyArray<string>> = [];
    await run(bus.connect((keys: ReadonlyArray<string>) => received.push(keys)));

    const AddTodo = code({
      id: "todo.add.fail",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () => Effect.fail(new RejectedError({ reason: "quota" })),
    });

    const c = catalog({
      addTodo: expose(AddTodo, {
        description: "Add a todo",
        args: Schema.Tuple([]),
        success: Schema.Struct({ id: Schema.String }),
        error: RejectedError,
        reactivityKeys: ["todos"],
        access: { agent: true },
      }),
    });

    const response = await run(
      dispatch(c)({ tool: "addTodo", args: [], buildId: BUILD }).pipe(
        Effect.provide(bus.serverLayer),
      ),
    );

    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(response.ok).toBe(false);
    await run(bus.flush());
    expect(received).toEqual([]);

    // NEGATIVE CONTROL. "Broadcasts nothing" is also true of a bus that never
    // broadcasts, which would make live sync a no-op while this spec stayed
    // green. A *succeeding* action declaring the same keys must publish exactly
    // once. Fresh bus and fresh recorder, so the two phases are isolated.
    const okBus = await run(makeReactivityBroadcast());
    const okReceived: Array<ReadonlyArray<string>> = [];
    await run(okBus.connect((keys: ReadonlyArray<string>) => okReceived.push(keys)));
    const okCatalog = catalog({
      addTodo: expose(
        code({
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
      dispatch(okCatalog)({ tool: "addTodo", args: [], buildId: BUILD }).pipe(
        Effect.provide(okBus.serverLayer),
      ),
    );
    expect(ok.ok).toBe(true);
    await run(okBus.flush());
    expect(okReceived).toEqual([["todos"]]);
  });

  it("[AN-2] a received push refreshes exactly the dependent queries and nothing else", async () => {
    const { makeReactivityBroadcast, applyPushedInvalidation } = await fromSrc(
      "reactivity-push",
      "makeReactivityBroadcast",
      "applyPushedInvalidation",
    );
    const { ReactivityTag } = await fromSrc("Reactivity", "ReactivityTag");
    const { test: reactivityTest } = await fromSrc("Reactivity", "test");

    const bus = await run(makeReactivityBroadcast());

    // Client-side reactivity: one observer per key family.
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

  it("[AN-2] pushed keys use the one reactivity key vocabulary, including family hierarchy", async () => {
    // Push must not invent a key dialect: a pushed parent key reaches child
    // observers exactly as an in-process invalidation does (Reactivity.Key).
    const { makeReactivityBroadcast, applyPushedInvalidation } = await fromSrc(
      "reactivity-push",
      "makeReactivityBroadcast",
      "applyPushedInvalidation",
    );
    const { Key, ReactivityTag, test: reactivityTest } = await fromSrc(
      "Reactivity",
      "Key",
      "ReactivityTag",
      "test",
    );

    const todo = Key.family("todo");
    const bus = await run(makeReactivityBroadcast());
    const seen: Array<ReadonlyArray<string>> = [];
    await run(bus.connect((keys: ReadonlyArray<string>) => seen.push(keys)));

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
        yield* applyPushedInvalidation(seen[0]);
        yield* reactivity.flush();
      }).pipe(Effect.provide(reactivityTest)),
    );

    expect(childRefreshes).toBe(1);
    expect(parentRefreshes).toBe(1);
  });

  it("[AN-2] a disconnected client stops receiving pushes and leaves no subscription behind", async () => {
    const { makeReactivityBroadcast } = await fromSrc(
      "reactivity-push",
      "makeReactivityBroadcast",
    );

    const bus = await run(makeReactivityBroadcast());
    const received: Array<ReadonlyArray<string>> = [];
    const disconnect = await run(
      bus.connect((keys: ReadonlyArray<string>) => received.push(keys)),
    );

    await run(bus.publish(["todos"]));
    await run(bus.flush());
    expect(received).toHaveLength(1);

    await run(disconnect());
    await run(bus.publish(["todos"]));
    await run(bus.flush());

    // Exactly once, for the one message delivered while connected.
    expect(received).toHaveLength(1);
    expect(await run(bus.connectionCount())).toBe(0);
  });

  it("[AN-2] agent and UI mutations produce the same invalidation, so live sync is caller-agnostic", async () => {
    const { makeReactivityBroadcast } = await fromSrc(
      "reactivity-push",
      "makeReactivityBroadcast",
    );
    const { catalog, expose, dispatch, uiLayer, agentLayer } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatch",
      "uiLayer",
      "agentLayer",
    );
    const { code } = await fromSrc("Portable", "code");

    const AddTodo = code({
      id: "todo.add.shared",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_c: any, text: string) => Effect.succeed({ id: "t1", text }),
    });
    const c = catalog({
      addTodo: expose(AddTodo, {
        description: "Add a todo",
        args: Schema.Tuple([Schema.String]),
        success: Schema.Struct({ id: Schema.String, text: Schema.String }),
        reactivityKeys: ["todos"],
        access: { agent: true, http: true },
      }),
    });

    const observe = async (surface: any) => {
      const bus = await run(makeReactivityBroadcast());
      const received: Array<ReadonlyArray<string>> = [];
      await run(bus.connect((keys: ReadonlyArray<string>) => received.push(keys)));
      await run(
        dispatch(c)({ tool: "addTodo", args: ["milk"], buildId: BUILD }).pipe(
          Effect.provide(Layer.mergeAll(bus.serverLayer, surface)),
        ),
      );
      await run(bus.flush());
      return received;
    };

    expect(await observe(uiLayer({ caller: "ui" }))).toEqual([["todos"]]);
    expect(await observe(agentLayer({ caller: "agent" }))).toEqual([["todos"]]);
  });
});
