/**
 * AN-1 — `Agent.catalog` / `Agent.expose`, the JSON Schema tool manifest, and
 * the single dispatch path shared with single-flight mutations.
 *
 * Owning doc: `docs/AGENT_NATIVE_NOTES.md` §2, §3, sequencing item AN-1.
 *
 * The design claim being specified: an exposed catalog entry is a *projection*
 * of an existing `Portable.code` value. There is no second action registry, no
 * second identity family, and no untyped wire hop — args are decoded through
 * the declared schema before `run` is reached, and success/errors are encoded
 * through declared schemas on the way out.
 *
 * RATIFIED (`AGENT_NATIVE_NOTES.md` §10, `DQ-080`): the dispatch response
 * envelope is exactly two arms —
 * `{ok:true, payload:{mutation, loaders, invalidated}} | {ok:false, error}` —
 * where `invalidated` is *additive* on the existing `SingleFlightPayload`
 * (`src/Route.ts:323–351`), and build drift rides as a typed tagged error
 * *inside* the `ok:false` arm rather than as a third arm. These specs assert
 * that shape; the earlier "PROVISIONAL ENVELOPE" markers are retired.
 *
 * STILL PROVISIONAL, pending `DQ-096`: the module name `src/Agent.ts` and the
 * export names below are this suite's proposal; `AGENT_NATIVE_NOTES.md` §9.10
 * lists them as awaiting ratification.
 */

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick, unbuilt } from "../harness.js";
import { run, tagOf } from "./support.js";

const BUILD = "build-an1";

describe("AN-1 agent catalog", () => {
  it("[AN-1] derives a JSON Schema tool manifest from the declared Effect Schemas", async () => {
    const { catalog, expose, toolManifest } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "toolManifest",
    );
    const { code } = await fromSrc("Portable", "code");

    const SaveTodo = code({
      id: "todo.save",
      buildId: BUILD,
      captures: Schema.Struct({ listId: Schema.String }),
      run: (_captures: any, input: { readonly text: string }) =>
        Effect.succeed({ id: "t1", text: input.text }),
    });

    const c = catalog({
      saveTodo: expose(SaveTodo, {
        description: "Save a todo item to the given list",
        args: Schema.Tuple([Schema.Struct({ text: Schema.String })]),
        success: Schema.Struct({ id: Schema.String, text: Schema.String }),
        reactivityKeys: ["todos"],
        access: { agent: true, http: true },
      }),
    });

    const manifest = await run(toolManifest(c));

    // One manifest entry per exposed catalog entry, keyed by catalog name.
    expect(manifest.tools.map((tool: any) => tool.name)).toEqual(["saveTodo"]);

    const [tool] = manifest.tools;
    expect(tool.description).toBe("Save a todo item to the given list");

    // Tool identity IS portable code identity — not a fourth identity family.
    expect(tool.id).toBe("todo.save");
    expect(tool.buildId).toBe(BUILD);

    // The input schema is real JSON Schema derived from the args schema, not a
    // hand-written blob: object, one required property, typed.
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties.text.type).toBe("string");
    expect(tool.inputSchema.required).toEqual(["text"]);

    // The success schema is projected too, so a host can validate results.
    expect(tool.outputSchema.type).toBe("object");
    expect(Object.keys(tool.outputSchema.properties).sort()).toEqual(["id", "text"]);

    // Manifests are wire values: fully JSON-serializable, no closures.
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it("[AN-1] decodes args through the declared schema before `run` observes them", async () => {
    const { catalog, expose, dispatch } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatch",
    );
    const { code } = await fromSrc("Portable", "code");

    const seen: Array<unknown> = [];

    // `Count` is a *codec*: the wire carries a string, `run` must see a number.
    const Bump = code({
      id: "counter.bump",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_c: any, by: number) =>
        Effect.sync(() => {
          seen.push(by);
          return by + 1;
        }),
    });

    const c = catalog({
      bump: expose(Bump, {
        description: "Bump the counter",
        args: Schema.Tuple([Schema.FiniteFromString]),
        success: Schema.Number,
        access: { agent: true },
      }),
    });

    const ok = await run(
      dispatch(c)({ tool: "bump", args: ["41"], buildId: BUILD }),
    );

    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(ok.ok).toBe(true);
    // Decoded, not passed through as a string.
    expect(seen).toEqual([42]);
    expect(ok.payload.mutation).toBe(43);

    // An arg that fails the declared schema never reaches `run`.
    seen.length = 0;
    const bad = await run(
      dispatch(c)({ tool: "bump", args: ["not-a-number"], buildId: BUILD }),
    );
    expect(bad.ok).toBe(false);
    expect(seen).toEqual([]);
    expect(tagOf(bad.error)).toBe("AgentArgsDecodeError");
    // "Bad args" and "no such tool" are near neighbours: one generic
    // `AgentBadRequestError` covering both would let a host report the wrong
    // remedy. Assert they are distinguishable.
    const unknown = await run(
      dispatch(c)({ tool: "does-not-exist", args: ["41"], buildId: BUILD }),
    );
    expect(tagOf(unknown.error)).toBe("AgentToolNotFoundError");
    expect(tagOf(unknown.error)).not.toBe(tagOf(bad.error));
  });

  it("[AN-1] a typed TaggedError crosses the wire as a discriminated value, not a string", async () => {
    const { catalog, expose, dispatch } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatch",
    );
    const { code } = await fromSrc("Portable", "code");

    class ListFullError extends Schema.TaggedErrorClass<ListFullError>(
      "future/agent/ListFullError",
    )("ListFullError", { listId: Schema.String, limit: Schema.Number }) {}

    const SaveTodo = code({
      id: "todo.save.full",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () => Effect.fail(new ListFullError({ listId: "inbox", limit: 50 })),
    });

    const c = catalog({
      saveTodo: expose(SaveTodo, {
        description: "Save a todo",
        args: Schema.Tuple([]),
        success: Schema.Struct({ id: Schema.String }),
        error: ListFullError,
        access: { agent: true },
      }),
    });

    const response = await run(
      dispatch(c)({ tool: "saveTodo", args: [], buildId: BUILD }),
    );

    expect(response.ok).toBe(false);
    // Discriminated on the wire: an agent host can branch on `_tag` and read
    // the typed fields. This is the whole point of declaring `error`.
    expect(response.error._tag).toBe("ListFullError");
    expect(response.error.listId).toBe("inbox");
    expect(response.error.limit).toBe(50);
    // And it is JSON, not a stringified Error.
    expect(typeof response.error).toBe("object");
    expect(JSON.parse(JSON.stringify(response.error))).toEqual(response.error);
  });

  it("[AN-1] an undeclared error is reported as an encode failure and is never forwarded", async () => {
    const { catalog, expose, dispatch } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatch",
    );
    const { code } = await fromSrc("Portable", "code");

    const Boom = code({
      id: "todo.boom",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () => Effect.fail({ _tag: "UndeclaredError" } as any),
    });

    const c = catalog({
      boom: expose(Boom, {
        description: "Fails with something it never declared",
        args: Schema.Tuple([]),
        success: Schema.Null,
        access: { agent: true },
      }),
    });

    const response = await run(
      dispatch(c)({ tool: "boom", args: [], buildId: BUILD }),
    );

    // Fails closed: the undeclared shape is reported as an encode failure, and
    // the raw error object is *not* forwarded to the caller.
    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(response.ok).toBe(false);
    expect(tagOf(response.error)).toBe("AgentErrorEncodeError");
    expect(response.error.tool).toBe("boom");
    expect(JSON.stringify(response)).not.toContain("UndeclaredError");

    // NEGATIVE CONTROL: an action that fails with the error it *did* declare is
    // forwarded verbatim, so "rewrite every failure into AgentErrorEncodeError"
    // cannot pass. Also pins the two codes as distinguishable.
    class DeclaredError extends Schema.TaggedErrorClass<DeclaredError>(
      "future/agent/DeclaredError",
    )("DeclaredError", { why: Schema.String }) {}
    const declared = catalog({
      boom: expose(
        code({
          id: "todo.boom.declared",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: () => Effect.fail(new DeclaredError({ why: "quota" })),
        }),
        {
          description: "Fails with something it declared",
          args: Schema.Tuple([]),
          success: Schema.Null,
          error: DeclaredError,
          access: { agent: true },
        },
      ),
    });
    const forwarded = await run(
      dispatch(declared)({ tool: "boom", args: [], buildId: BUILD }),
    );
    expect(forwarded.ok).toBe(false);
    expect(tagOf(forwarded.error)).toBe("DeclaredError");
    expect(forwarded.error.why).toBe("quota");
    expect(tagOf(forwarded.error)).not.toBe(tagOf(response.error));
  });

  it("[AN-1] dispatch is one implementation shared with the single-flight mutation path", async () => {
    // §3: "Router R5's single-flight wire validation and this endpoint should be
    // *one* dispatch implementation." The observable consequence: an agent
    // mutation returns the single-flight payload shape, including revalidated
    // loader data, so a UI caller and an agent caller consume the same envelope.
    const { catalog, expose, dispatch, singleFlightHandler } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatch",
      "singleFlightHandler",
    );
    const { code } = await fromSrc("Portable", "code");

    const Save = code({
      id: "todo.save.sf",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_c: any, text: string) => Effect.succeed({ id: "t9", text }),
    });

    const c = catalog({
      saveTodo: expose(Save, {
        description: "Save a todo",
        args: Schema.Tuple([Schema.String]),
        success: Schema.Struct({ id: Schema.String, text: Schema.String }),
        reactivityKeys: ["todos"],
        access: { agent: true, http: true },
      }),
    });

    const request = { tool: "saveTodo", args: ["milk"], buildId: BUILD };
    const viaAgent = await run(dispatch(c)(request));
    const viaSingleFlight = await run(singleFlightHandler(c)(request));

    // Ratified two-arm envelope (DQ-080): both entry points share one shape,
    // and the fields are now decided, not provisional.
    expect(Object.keys(viaAgent).sort()).toEqual(Object.keys(viaSingleFlight).sort());
    expect(viaAgent.payload.mutation).toEqual(viaSingleFlight.payload.mutation);
    expect(Array.isArray(viaAgent.payload.loaders)).toBe(true);
    // Invalidations are reported as reactivity keys, verbatim.
    expect(viaAgent.payload.invalidated).toEqual(["todos"]);
  });

  it("[AN-1] an unknown tool name fails closed without side effects", async () => {
    const { catalog, expose, dispatch } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatch",
    );
    const { code } = await fromSrc("Portable", "code");

    let ran = 0;
    const Only = code({
      id: "only.one",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () => Effect.sync(() => ++ran),
    });
    const c = catalog({
      only: expose(Only, {
        description: "the only tool",
        args: Schema.Tuple([]),
        success: Schema.Number,
        access: { agent: true },
      }),
    });

    const response = await run(
      dispatch(c)({ tool: "nope", args: [], buildId: BUILD }),
    );
    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(response.ok).toBe(false);
    expect(tagOf(response.error)).toBe("AgentToolNotFoundError");
    expect(ran).toBe(0);
    // The refusal is about the *name*, and mentions it, so a host can list what
    // it should have called instead.
    expect(JSON.stringify(response.error)).toContain("nope");

    // NEGATIVE CONTROL: the one real name resolves and runs exactly once.
    const ok = await run(dispatch(c)({ tool: "only", args: [], buildId: BUILD }));
    expect(ok.ok).toBe(true);
    expect(ran).toBe(1);
  });

  it("[AN-1/DQ-088] args are a tuple in core and a struct at the edge, keyed by the authored `argNames`", async () => {
    // Ratified (§10, DQ-088): `Schema.Tuple` in core, matching `Portable`'s arg
    // tuples, plus an authored `argNames` on the entry. The HTTP/MCP struct
    // projection is *derived from `argNames`*, so it is declared and checkable
    // rather than positional-only.
    const { catalog, expose, dispatch, toolManifest, structArgs } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatch",
      "toolManifest",
      "structArgs",
    );
    const { code } = await fromSrc("Portable", "code");

    const seen: Array<unknown> = [];
    const Move = code({
      id: "todo.move",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_c: any, todoId: string, toList: string) =>
        Effect.sync(() => {
          seen.push([todoId, toList]);
          return { moved: todoId };
        }),
    });

    const c = catalog({
      moveTodo: expose(Move, {
        description: "Move a todo to another list",
        args: Schema.Tuple([Schema.String, Schema.String]),
        argNames: ["todoId", "toList"],
        success: Schema.Struct({ moved: Schema.String }),
        access: { agent: true, http: true },
      }),
    });

    // Core: positional. Order is the tuple's order, not the struct's.
    const positional = await run(
      dispatch(c)({ tool: "moveTodo", args: ["t1", "done"], buildId: BUILD }),
    );
    expect(positional.ok).toBe(true);
    expect(seen).toEqual([["t1", "done"]]);

    // Edge: the struct projection is derived from `argNames`, and the JSON
    // Schema a host reads names the same properties in the same order.
    const manifest = await run(toolManifest(c));
    const [tool] = manifest.tools;
    expect(tool.inputSchema.type).toBe("object");
    expect(Object.keys(tool.inputSchema.properties)).toEqual(["todoId", "toList"]);
    expect(tool.inputSchema.required).toEqual(["todoId", "toList"]);

    // `structArgs` is the declared projection both directions share: a named
    // payload lowers to exactly the positional tuple.
    expect(await run(structArgs(c, "moveTodo", { toList: "done", todoId: "t1" }))).toEqual([
      "t1",
      "done",
    ]);

    // A named payload dispatches identically to the positional one — that is
    // what "declared and checkable, not positional-only" buys.
    seen.length = 0;
    const named = await run(
      dispatch(c)({
        tool: "moveTodo",
        args: await run(structArgs(c, "moveTodo", { todoId: "t1", toList: "done" })),
        buildId: BUILD,
      }),
    );
    expect(named.ok).toBe(true);
    expect(seen).toEqual([["t1", "done"]]);

    // NEGATIVE CONTROL: a payload naming a property the entry never declared is
    // refused, with its own code, distinct from a value that fails the arg
    // schema. Without this, `structArgs = () => []` satisfies everything above.
    const unknownName = await run(
      dispatch(c)({
        tool: "moveTodo",
        args: [{ todoId: "t1", destination: "done" }],
        buildId: BUILD,
      }),
    );
    expect(unknownName.ok).toBe(false);
    expect(tagOf(unknownName.error)).toBe("AgentArgsDecodeError");
    expect(seen).toEqual([["t1", "done"]]);
  });

  it("[AN-1/DQ-080] the response is exactly two arms, and `invalidated` is additive on SingleFlightPayload", async () => {
    // Ratified (§10, DQ-080). The property a host depends on: there is no third
    // arm to branch on. Drift, decode failures and declared errors all ride
    // inside `ok: false`, and a success carries the *existing* single-flight
    // payload fields plus `invalidated`.
    const { catalog, expose, dispatch } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatch",
    );
    const { code } = await fromSrc("Portable", "code");

    const c = catalog({
      saveTodo: expose(
        code({
          id: "todo.save.envelope",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: (_c: any, text: string) => Effect.succeed({ id: "t1", text }),
        }),
        {
          description: "Save a todo",
          args: Schema.Tuple([Schema.String]),
          success: Schema.Struct({ id: Schema.String, text: Schema.String }),
          reactivityKeys: ["todos"],
          access: { agent: true, http: true },
        },
      ),
    });

    const ok = await run(
      dispatch(c)({ tool: "saveTodo", args: ["milk"], buildId: BUILD }),
    );
    // Success arm: `ok` + `payload`, and nothing else. A `retryWith`/`redescribe`
    // arm sneaking in would show up here.
    expect(Object.keys(ok).sort()).toEqual(["ok", "payload"]);
    expect(ok.ok).toBe(true);
    // Additive on `SingleFlightPayload` (`src/Route.ts:323–351`): the existing
    // fields survive verbatim, and `invalidated` joins them.
    expect(Object.keys(ok.payload).sort()).toEqual([
      "invalidated",
      "loaders",
      "mutation",
      "url",
    ]);
    expect(ok.payload.invalidated).toEqual(["todos"]);

    // Failure arm: `ok` + `error`, and no `payload`. Every failure mode uses it,
    // including drift, so a host branches once.
    for (const request of [
      { tool: "saveTodo", args: ["milk"], buildId: "build-stale" },
      { tool: "nope", args: ["milk"], buildId: BUILD },
      { tool: "saveTodo", args: [42], buildId: BUILD },
    ]) {
      const bad = await run(dispatch(c)(request));
      expect(bad.ok).toBe(false);
      expect(Object.keys(bad).sort()).toEqual(["error", "ok"]);
      expect(bad.payload).toBeUndefined();
      expect(typeof bad.error?._tag).toBe("string");
    }
  });
});
