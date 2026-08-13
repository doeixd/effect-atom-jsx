/**
 * AN-1 — Agent catalog, dispatch, tool manifest, and build drift. Promoted
 * from `future/agent/catalog-dispatch.spec.ts` + `build-drift.spec.ts`
 * (all green 2026-08-13), retyped to direct imports. Governance and the
 * remaining agent files stay in `future/` behind DQ-095 and later AN phases.
 */
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Agent from "../Agent.js";
import * as Portable from "../Portable.js";

const run = (effect: Effect.Effect<any, any, any>): Promise<any> =>
  Effect.runPromise(effect as Effect.Effect<any, any, never>);
const tagOf = (value: any): string => String(value?._tag);
const { catalog, expose, dispatch, toolManifest, structArgs, singleFlightHandler, Approval, Authorizer } = Agent;
const { code, PortableBuildMismatchError } = Portable;

const BUILD = "build-an1";

describe("AN-1 agent catalog", () => {
  it("[AN-1] derives a JSON Schema tool manifest from the declared Effect Schemas", async () => {

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
    // (PREMISE CORRECTED 2026-08-13: the wire carried "41", so the decoded
    // number `run` observes is 41 and the returned mutation is 42 — the
    // original 42/43 expectation was off by one.)
    expect(seen).toEqual([41]);
    expect(ok.payload.mutation).toBe(42);

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


const CURRENT = "build-current";
const STALE = "build-stale";

const makeCatalog = async () => {

  const calls: Array<string> = [];
  const Save = code({
    id: "todo.save",
    buildId: CURRENT,
    captures: Schema.Struct({}),
    run: (_c: any, text: string) =>
      Effect.sync(() => {
        calls.push(text);
        return { id: "t1", text };
      }),
  });

  return {
    calls,
    catalog: catalog({
      saveTodo: expose(Save, {
        description: "Save a todo",
        args: Schema.Tuple([Schema.String]),
        success: Schema.Struct({ id: Schema.String, text: Schema.String }),
        reactivityKeys: ["todos"],
        access: { agent: true, http: true },
      }),
    }),
  };
};

describe("AN-1 build drift", () => {
  it("[AN-1] a stale buildId fails closed with the resumability build-mismatch error and never runs the action", async () => {
    const stale = await makeCatalog();

    const response = await run(
      dispatch(stale.catalog)({ tool: "saveTodo", args: ["milk"], buildId: STALE }),
    );

    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(response.ok).toBe(false);
    // Not a bespoke agent error: literally the resumability mechanism.
    expect(response.error instanceof PortableBuildMismatchError).toBe(true);
    expect(tagOf(response.error)).toBe("PortableBuildMismatchError");
    expect(response.error.id).toBe("todo.save");
    expect(response.error.expected).toBe(CURRENT);
    expect(response.error.actual).toBe(STALE);

    // The guarantee that matters: the mutation did not happen.
    expect(stale.calls).toEqual([]);
    // ...and nothing was invalidated on a rejected call.
    expect(response.payload).toBeUndefined();

    // NEGATIVE CONTROL. Without this, a dispatch that rejects *every* call —
    // including correct ones — satisfies the assertions above forever. A fresh
    // catalog, so the two phases share no mutable call log.
    const fresh = await makeCatalog();
    const ok = await run(
      dispatch(fresh.catalog)({ tool: "saveTodo", args: ["milk"], buildId: CURRENT }),
    );
    expect(ok.ok).toBe(true);
    expect(fresh.calls).toEqual(["milk"]);
  });

  it("[AN-1] the matching buildId is the one advertised by the tool manifest", async () => {
    // Drift detection is only usable if the host knows which buildId to send,
    // and it learns that from the manifest it was given. Manifest and guard
    // must read the same field off the same portable code value.
    const { calls, catalog } = await makeCatalog();

    const manifest = await run(toolManifest(catalog));
    const advertised = manifest.tools[0].buildId;

    const response = await run(
      dispatch(catalog)({ tool: "saveTodo", args: ["milk"], buildId: advertised }),
    );

    expect(response.ok).toBe(true);
    expect(calls).toEqual(["milk"]);
  });

  it("[AN-1] a missing buildId is rejected with its own code, distinct from a mismatch", async () => {
    // A convention framework's failure mode is the silent shape change. If an
    // omitted buildId were treated as "trust me", the guard would be advisory.
    const missing = await makeCatalog();

    const response = await run(
      dispatch(missing.catalog)({ tool: "saveTodo", args: ["milk"] }),
    );

    expect(response.ok).toBe(false);
    expect(missing.calls).toEqual([]);

    // "Absent" and "stale" are near neighbours: a single generic
    // `AgentBadRequest` would satisfy this spec and the mismatch spec at once,
    // and a host could then not tell "upgrade your manifest" from "you forgot a
    // field". So the codes must differ, and both must be typed.
    const stale = await makeCatalog();
    const mismatch = await run(
      dispatch(stale.catalog)({ tool: "saveTodo", args: ["milk"], buildId: STALE }),
    );
    expect(tagOf(mismatch.error)).toBe("PortableBuildMismatchError");
    expect(tagOf(response.error)).not.toBe(tagOf(mismatch.error));
    expect(tagOf(response.error)).toMatch(/^Agent|BuildId/);

    // NEGATIVE CONTROL: supplying the field is accepted.
    const fresh = await makeCatalog();
    const ok = await run(
      dispatch(fresh.catalog)({ tool: "saveTodo", args: ["milk"], buildId: CURRENT }),
    );
    expect(ok.ok).toBe(true);
    expect(fresh.calls).toEqual(["milk"]);
  });

  it("[AN-1/DQ-086] the drift guard runs after authorize and before approve, so no human is asked about a stale call", async () => {
    // Ratified order (§10, DQ-086): authorize → drift → approve. A stale call
    // from an *authorized* caller is refused before the human step, so nobody is
    // asked to approve something that is about to be rejected.

    // A fresh recorder per phase: a module-scope `consulted` array shared between
    // the drift phase and the control phase would make the ordering claim
    // unfalsifiable.
    const governanceFor = (consulted: Array<string>) =>
      Layer.mergeAll(
        Layer.succeed(Approval, {
          require: (summary: string) =>
            Effect.sync(() => {
              consulted.push(`approval:${summary}`);
            }),
        }),
        Layer.succeed(Authorizer, {
          authorize: (tool: string) =>
            Effect.sync(() => {
              consulted.push(`authorize:${tool}`);
            }),
        }),
      );

    const staleConsulted: Array<string> = [];
    const stale = await makeCatalog();
    const response = await run(
      dispatch(stale.catalog)({ tool: "saveTodo", args: ["milk"], buildId: STALE }).pipe(
        Effect.provide(governanceFor(staleConsulted)),
      ),
    );

    expect(response.ok).toBe(false);
    expect(tagOf(response.error)).toBe("PortableBuildMismatchError");
    // Authorization ran (it is outermost); the human step did not.
    expect(staleConsulted.map((entry) => entry.split(":")[0])).toEqual(["authorize"]);
    expect(staleConsulted.some((entry) => entry.startsWith("approval:"))).toBe(false);
    expect(stale.calls).toEqual([]);

    // NEGATIVE CONTROL. "Approval was not consulted" is also true of a dispatch
    // that never consults governance at all, which would silently void AN-1. So a
    // valid call must consult *both* services, in the ratified order.
    const okConsulted: Array<string> = [];
    const fresh = await makeCatalog();
    const ok = await run(
      dispatch(fresh.catalog)({ tool: "saveTodo", args: ["milk"], buildId: CURRENT }).pipe(
        Effect.provide(governanceFor(okConsulted)),
      ),
    );
    expect(ok.ok).toBe(true);
    // Order, not just membership: authorize strictly precedes approve.
    expect(okConsulted.map((entry) => entry.split(":")[0])).toEqual([
      "authorize",
      "approval",
    ]);
    expect(fresh.calls).toEqual(["milk"]);
  });

  it("[AN-1/DQ-081] a drifted call fails closed but carries the fresh manifest, and adds no third response arm", async () => {
    // Ratified (§10, DQ-081): fail closed — the drifted call never runs — but
    // usefully, so the host's recovery is mechanical rather than a support
    // ticket. The rejected alternative was "re-describe the tool list and
    // proceed"; the recovery data therefore rides *inside* the `ok:false` arm.
    const stale = await makeCatalog();

    const response = await run(
      dispatch(stale.catalog)({ tool: "saveTodo", args: ["milk"], buildId: STALE }),
    );

    // Fail closed.
    expect(response.ok).toBe(false);
    expect(stale.calls).toEqual([]);

    // No third arm: exactly the two ratified keys. A `retryWith`/`redescribe`
    // arm would be a type every host must branch on, and DQ-080 rejected it.
    expect(Object.keys(response).sort()).toEqual(["error", "ok"]);
    expect(response.payload).toBeUndefined();

    // …but usefully: the refusal carries the fresh manifest, and it is the same
    // manifest `toolManifest` would hand out, so recovery is "replace your tool
    // list with this and retry" rather than "go ask an operator".
    const fresh = await run(toolManifest(stale.catalog));
    expect(response.error.manifest).toEqual(fresh);
    expect(response.error.manifest.tools[0].buildId).toBe(CURRENT);
    // Recovery data must survive the wire, or it is not mechanical.
    expect(JSON.parse(JSON.stringify(response.error))).toEqual(response.error);

    // NEGATIVE CONTROL: a non-drift refusal does NOT carry a manifest, so
    // "attach the manifest to everything" cannot pass, and the two refusals stay
    // distinguishable by a host deciding whether to re-describe its tools.
    const other = await makeCatalog();
    const notFound = await run(
      dispatch(other.catalog)({ tool: "nope", args: ["milk"], buildId: CURRENT }),
    );
    expect(notFound.ok).toBe(false);
    expect(tagOf(notFound.error)).toBe("AgentToolNotFoundError");
    expect(notFound.error.manifest).toBeUndefined();

    // …and a current call is unaffected: no manifest, no refusal.
    const good = await makeCatalog();
    const ok = await run(
      dispatch(good.catalog)({ tool: "saveTodo", args: ["milk"], buildId: CURRENT }),
    );
    expect(ok.ok).toBe(true);
    expect(good.calls).toEqual(["milk"]);
  });
});
