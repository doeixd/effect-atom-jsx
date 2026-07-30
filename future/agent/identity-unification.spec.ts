/**
 * Identity unification (`AGENT_NATIVE_NOTES.md` §6 "No second identity family",
 * extending `DESIGN_IMPROVEMENT_NOTES` item 2).
 *
 * "Tool ids ARE portable code ids; invalidation ids ARE reactivity keys; render
 * targets ARE addressable component/activation ids." These specs assert the
 * strong reading of that sentence: the *same values*, not parallel values kept
 * in sync by discipline. A framework that mints a `toolId` alongside a code id
 * has already lost the property, even if the two happen to match today.
 */

import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick } from "../harness.js";
import { run } from "./support.js";

const BUILD = "build-identity";

describe("identity unification", () => {
  it("[AN-1] a tool id is the portable code id, and the manifest mints no second identifier", async () => {
    const { catalog, expose, toolManifest } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "toolManifest",
    );
    const { code, bind, describe: describeCode } = await fromSrc(
      "Portable",
      "code",
      "bind",
      "describe",
    );

    const Save = code({
      id: "todo.save",
      buildId: BUILD,
      captures: Schema.Struct({ listId: Schema.String }),
      run: (_c: any, text: string) => Effect.succeed({ id: "t1", text }),
    });

    const c = catalog({
      saveTodo: expose(Save, {
        description: "Save a todo",
        args: Schema.Tuple([Schema.String]),
        success: Schema.Struct({ id: Schema.String, text: Schema.String }),
        access: { agent: true },
      }),
    });

    const manifest = await run(toolManifest(c));
    const descriptor = await run(describeCode(bind(Save, { listId: "inbox" })));

    const [tool] = manifest.tools;
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

  it("[AN-2] invalidation ids are reactivity keys, identical across catalog, audit and push", async () => {
    const { catalog, exposeMutation, dispatch, audited, AuditLog, CallerContext } = await fromSrc(
      "Agent",
      "catalog",
      "exposeMutation",
      "dispatch",
      "audited",
      "AuditLog",
      "CallerContext",
    );
    const { Key } = await fromSrc("Reactivity", "Key");
    const { makeReactivityBroadcast } = await fromSrc(
      "reactivity-push",
      "makeReactivityBroadcast",
    );
    const { code } = await fromSrc("Portable", "code");

    // The action declares its keys with the *same witness values* a query uses.
    const Todos = Key.make("todos");

    const c = audited(
      catalog({
        addTodo: exposeMutation(
          code({
            id: "todo.add",
            buildId: BUILD,
            captures: Schema.Struct({}),
            run: (_c: any, text: string) => Effect.succeed({ id: "t1", text }),
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
    await run(bus.connect((keys: ReadonlyArray<string>) => pushed.push(keys)));
    const records: Array<any> = [];

    const response = await run(
      dispatch(c)({ tool: "addTodo", args: ["milk"], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.mergeAll(
            bus.serverLayer,
            Layer.succeed(AuditLog, {
              record: (entry: any) => Effect.sync(() => void records.push(entry)),
            }),
            Layer.succeed(CallerContext, {
              caller: "agent",
              user: { _tag: "None" },
              lineage: { _tag: "None" },
            }),
          ),
        ),
      ),
    );
    await run(bus.flush());

    // One vocabulary, three surfaces, byte-identical.
    expect(response.payload.invalidated).toEqual(["todos"]);
    expect(pushed).toEqual([["todos"]]);
    expect(records[0].reactivityKeys).toEqual(["todos"]);
    expect(String(Todos)).toContain("todos");
  });

  it("[AN-4] a render target is the addressable activation id, which is a portable code id", async () => {
    const { catalog, expose, renderResult, toolManifest } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "renderResult",
      "toolManifest",
    );
    const { addressable, activationOf } = await fromSrc(
      "Resume",
      "addressable",
      "activationOf",
    );
    const { code, isBoundCode } = await fromSrc("Portable", "code", "isBoundCode");
    const Component = await loadSrc("Component");
    const { make, setup } = pick(Component, "Component", "make", "setup");

    const Props = Schema.Struct({ id: Schema.String, text: Schema.String });
    const TodoCard = addressable({ id: "widget.todoCard", buildId: BUILD, props: Props })(
      make(setup(), (props: any) =>
        `<article>${props.text}</article>`,
      ),
    );

    const c = catalog({
      saveTodo: expose(
        code({
          id: "todo.save",
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

    const activation = activationOf(TodoCard);
    // The render target is a portable code value, not a registry string.
    expect(activation.id).toBe("widget.todoCard");
    expect(activation.buildId).toBe(BUILD);
    expect(isBoundCode(activation)).toBe(false); // unbound `Code`, addressable by id

    const rendered = await run(renderResult(c, "saveTodo", { id: "t1", text: "milk" }));
    expect(rendered.activationId).toBe(activation.id);

    // A host discovers the render target from the manifest, by the same id.
    const manifest = await run(toolManifest(c));
    expect(manifest.tools[0].render.activationId).toBe(activation.id);
    expect(manifest.tools[0].render.buildId).toBe(activation.buildId);
  });

  it("[AN-1] the agent surface introduces no cache identity of its own", async () => {
    // `Portable.cacheKey(descriptor, reactivityKeys)` is the existing derived
    // cache identity. An agent dispatch must reuse it rather than key its own
    // dedupe/idempotency table on a new string.
    const { catalog, expose, dispatchCacheKey } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatchCacheKey",
    );
    const { code, bind, describe: describeCode, cacheKey } = await fromSrc(
      "Portable",
      "code",
      "bind",
      "describe",
      "cacheKey",
    );

    const Load = code({
      id: "todo.list",
      buildId: BUILD,
      captures: Schema.Struct({ listId: Schema.String }),
      run: () => Effect.succeed([]),
    });

    const c = catalog({
      listTodos: expose(Load, {
        description: "List todos",
        args: Schema.Tuple([]),
        success: Schema.Array(Schema.String),
        reactivityKeys: ["todos"],
        access: { agent: true },
      }),
    });

    const descriptor = await run(describeCode(bind(Load, { listId: "inbox" })));
    const expected = cacheKey(descriptor, ["todos"]);

    expect(
      await run(dispatchCacheKey(c, "listTodos", { captures: { listId: "inbox" } })),
    ).toBe(expected);
  });
});
