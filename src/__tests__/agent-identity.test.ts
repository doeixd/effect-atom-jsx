/**
 * Identity unification (`AGENT_NATIVE_NOTES.md` §6 "No second identity
 * family"), promoted from `future/agent/identity-unification.spec.ts` once
 * every spec passed.
 *
 * "Tool ids ARE portable code ids; invalidation ids ARE reactivity keys;
 * render targets ARE addressable component/activation ids." These tests
 * assert the strong reading of that sentence: the *same values*, not
 * parallel values kept in sync by discipline.
 */
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Agent from "../Agent.js";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import { Key } from "../Reactivity.js";
import { makeReactivityBroadcast } from "../reactivity-push.js";
import * as Resume from "../Resume.js";

const BUILD = "build-identity";

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

describe("agent identity unification", () => {
  it("a tool id is the portable code id, and the manifest mints no second identifier", async () => {
    const Save = Portable.code({
      id: "todo.save",
      buildId: BUILD,
      captures: Schema.Struct({ listId: Schema.String }),
      run: (_c, text: string) => Effect.succeed({ id: "t1", text }),
    });

    const c = Agent.catalog({
      saveTodo: Agent.expose(Save, {
        description: "Save a todo",
        args: Schema.Tuple([Schema.String]),
        success: Schema.Struct({ id: Schema.String, text: Schema.String }),
        access: { agent: true },
      }),
    });

    const manifest = await run(Agent.toolManifest(c));
    const descriptor = await run(
      Portable.describe(Portable.bind(Save, { listId: "inbox" })).pipe(Effect.orDie),
    );

    const tool = manifest.tools[0]!;
    // Literally the same values as the portable descriptor carries.
    expect(tool.id).toBe(descriptor.id);
    expect(tool.buildId).toBe(descriptor.buildId);
    expect(tool.id).toBe(Save.id);

    // `name` is the catalog key (a human-facing label), and is the only
    // additional string. No `toolId`, `uuid`, `handle`, `slug`, or `ref`.
    const idish = Object.keys(tool).filter((key) =>
      /(^|[a-z])(id|uuid|handle|slug|ref|key)$/i.test(key),
    );
    expect(idish.sort()).toEqual(["buildId", "id"]);
  });

  it("invalidation ids are reactivity keys, identical across catalog, audit and push", async () => {
    // The action declares its keys with the *same witness values* a query uses.
    const Todos = Key.make("todos");

    const c = Agent.audited(
      Agent.catalog({
        addTodo: Agent.exposeMutation(
          Portable.code({
            id: "todo.add",
            buildId: BUILD,
            captures: Schema.Struct({}),
            run: (_c, text: string) => Effect.succeed({ id: "t1", text }),
          }),
          {
            description: "Add a todo",
            args: Schema.Tuple([Schema.String]),
            success: Schema.Struct({ id: Schema.String, text: Schema.String }),
            reactivityKeys: [Todos],
            access: { agent: true },
          },
        ),
      }),
    );

    const bus = await run(makeReactivityBroadcast());
    const pushed: Array<ReadonlyArray<string>> = [];
    await run(bus.connect((keys) => pushed.push(keys)));
    const records: Array<Agent.AuditRecord> = [];

    const response = await run(
      Agent.dispatch(c)({ tool: "addTodo", args: ["milk"], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.mergeAll(
            bus.serverLayer,
            Layer.succeed(Agent.AuditLog, {
              record: (entry) => Effect.sync(() => void records.push(entry)),
            }),
            Layer.succeed(Agent.CallerContext, {
              caller: "agent",
              user: { _tag: "None" },
              lineage: { _tag: "None" },
            }),
          ),
        ),
        Effect.orDie,
      ),
    );
    await run(bus.flush());

    // One vocabulary, three surfaces, byte-identical.
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.payload.invalidated).toEqual(["todos"]);
    }
    expect(pushed).toEqual([["todos"]]);
    expect(records[0]!.reactivityKeys).toEqual(["todos"]);
    expect(String(Todos)).toContain("todos");
  });

  it("a render target is the addressable activation id, which is a portable code id", async () => {
    const Props = Schema.Struct({ id: Schema.String, text: Schema.String });
    const TodoCard = Resume.addressable({
      id: "widget.todoCard.identity",
      buildId: BUILD,
      props: Props,
    })(
      Component.make(
        Component.setup(),
        (props: { readonly id: string; readonly text: string }) =>
          `<article>${props.text}</article>`,
      ),
    );

    const c = Agent.catalog({
      saveTodo: Agent.expose(
        Portable.code({
          id: "todo.save.render-identity",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: () => Effect.succeed({ id: "t1", text: "milk" }),
        }),
        {
          description: "Save a todo",
          args: Schema.Tuple([]),
          success: Props,
          render: TodoCard,
          access: { agent: true },
        },
      ),
    });

    const activation = Resume.activationOf(TodoCard);
    // The render target is a portable code value, not a registry string.
    expect(activation.id).toBe("widget.todoCard.identity");
    expect(activation.buildId).toBe(BUILD);
    expect(Portable.isBoundCode(activation)).toBe(false);

    const rendered = await run(
      Agent.renderResult(c, "saveTodo", { id: "t1", text: "milk" }).pipe(Effect.orDie),
    );
    expect(rendered.activationId).toBe(activation.id);
    expect(rendered.html).toContain("milk");

    // A host discovers the render target from the manifest, by the same id.
    const manifest = await run(Agent.toolManifest(c));
    expect(manifest.tools[0]!.render?.activationId).toBe(activation.id);
    expect(manifest.tools[0]!.render?.buildId).toBe(activation.buildId);
  });

  it("the agent surface introduces no cache identity of its own", async () => {
    // `Portable.cacheKey(descriptor, reactivityKeys)` is the existing derived
    // cache identity. An agent dispatch must reuse it rather than key its own
    // dedupe/idempotency table on a new string.
    const Load = Portable.code({
      id: "todo.list",
      buildId: BUILD,
      captures: Schema.Struct({ listId: Schema.String }),
      run: () => Effect.succeed([]),
    });

    const c = Agent.catalog({
      listTodos: Agent.expose(Load, {
        description: "List todos",
        args: Schema.Tuple([]),
        success: Schema.Array(Schema.String),
        reactivityKeys: ["todos"],
        access: { agent: true },
      }),
    });

    const descriptor = await run(
      Portable.describe(Portable.bind(Load, { listId: "inbox" })).pipe(Effect.orDie),
    );
    const expected = Portable.cacheKey(descriptor, ["todos"]);

    expect(
      await run(
        Agent.dispatchCacheKey(c, "listTodos", {
          captures: { listId: "inbox" },
        }).pipe(Effect.orDie),
      ),
    ).toBe(expected);
  });
});
