/**
 * AN-1 governance — "their flags, our services" (`AGENT_NATIVE_NOTES.md` §5).
 *
 * The design claim: authorization, human approval, caller identity and audit
 * are not dispatch options but *requirements*, satisfied by per-surface Layers.
 *
 * "Governance is a compile error" was only HALF TRUE, and §10 closes the hole.
 * A missing `Approval` layer is a *type* error, so the compile-time half belongs
 * in `src/type-tests/` — but under a dynamically assembled Layer (HTTP adapter,
 * plugin) the requirement is erased and it used to surface as an unmet-service
 * DEFECT rather than a typed refusal.
 *
 * RATIFIED (`AGENT_NATIVE_NOTES.md` §10):
 * - `DQ-080` — the two-arm response envelope; the earlier "PROVISIONAL
 *   ENVELOPE" markers are retired.
 * - `DQ-082` — governance is checked at **dispatcher construction** and fails
 *   with a typed `GovernanceUnsatisfiedError` (one shared error type, so a
 *   per-call runtime check can be added later without inventing a second one).
 *   Construction-time failure is what "fail closed" actually means, and it must
 *   be a typed failure, never a defect.
 * - `DQ-083` — audit-sink failure is a layer-level `onFailure` policy defaulting
 *   to **`refuse`**, with the refusal record itself durable (write-ahead, then
 *   run). An explicit `proceed` policy is honoured, because an unoverridable
 *   default just gets wrapped around.
 * - `DQ-084` — mutation is declared by the **constructor**: `Agent.exposeMutation`
 *   alongside `Agent.expose`, so the *type* carries it. The presence of
 *   `reactivityKeys` is a coincidence, not a declaration.
 * - `DQ-085` — redaction is structural via `Agent.secret(schema)`. The M7
 *   secret-name heuristic is a **diagnostic that suggests it, never
 *   enforcement**.
 * - `DQ-086` — order is **authorize → drift → approve**, authorization outermost
 *   so an unauthorized caller learns nothing: no schema, no tool description, no
 *   drift detail.
 *
 * STILL PROVISIONAL, pending `DQ-096`: the module name `src/Agent.ts` and its
 * export names (`AGENT_NATIVE_NOTES.md` §9.10).
 */

import { Deferred, Effect, Exit, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { allStrings, run, runFail, tagOf } from "./support.js";
import { fromSrc, loadSrc, pick, unbuilt } from "../harness.js";

const BUILD = "build-gov";

/** A mutating catalog with one entry that requires approval, plus a call log. */
const makeMutatingCatalog = async () => {
  const { catalog, expose } = await fromSrc("Agent", "catalog", "expose");
  const { code } = await fromSrc("Portable", "code");

  const calls: Array<unknown> = [];
  const DeleteList = code({
    id: "list.delete",
    buildId: BUILD,
    captures: Schema.Struct({}),
    run: (_c: any, listId: string) =>
      Effect.sync(() => {
        calls.push(listId);
        return { deleted: listId };
      }),
  });

  return {
    calls,
    catalog: catalog({
      deleteList: expose(DeleteList, {
        description: "Delete a list and everything in it",
        args: Schema.Tuple([Schema.String]),
        success: Schema.Struct({ deleted: Schema.String }),
        reactivityKeys: ["lists"],
        access: { agent: true, http: true, approval: "mutate" },
      }),
    }),
  };
};

describe("AN-1 governance", () => {
  it("[AN-1/DQ-082] a dispatcher whose governance requirements are unmet fails at CONSTRUCTION with a typed error, never a defect", async () => {
    // Ratified (§10, DQ-082). The hole this closes: under a dynamically
    // assembled Layer the missing `Approval` requirement is erased, so it used
    // to surface as an unmet-service *defect* at call time. Now the dispatcher
    // refuses to be built, with one shared typed error.
    const { makeDispatcher, GovernanceUnsatisfiedError, Approval } = await fromSrc(
      "Agent",
      "makeDispatcher",
      "GovernanceUnsatisfiedError",
      "Approval",
    );
    const missing = await makeMutatingCatalog();

    // Deliberately dynamic: `Layer.empty` stands in for a plugin-assembled stack
    // whose requirements the compiler could not check.
    const error = await runFail(makeDispatcher(missing.catalog, Layer.empty));

    // Typed, not a defect (`runFail` fails the spec on a defect) and not a
    // string.
    expect(tagOf(error)).toBe("GovernanceUnsatisfiedError");
    expect(error instanceof GovernanceUnsatisfiedError).toBe(true);
    // It names what is missing and for which entry, or "fail closed" is not
    // actionable.
    expect(error.tool).toBe("deleteList");
    expect(allStrings(error)).toContain("Approval");

    // Construction-time means exactly that: nothing was dispatched, so nothing
    // could have mutated.
    expect(missing.calls).toEqual([]);

    // NEGATIVE CONTROL. Without this, `makeDispatcher = () => Effect.fail(...)`
    // passes forever. With the requirement satisfied, construction succeeds and
    // the dispatcher works. Fresh catalog so the two phases share no call log.
    const approved = await makeMutatingCatalog();
    const dispatcher = await run(
      makeDispatcher(
        approved.catalog,
        Layer.succeed(Approval, { require: () => Effect.void }),
      ),
    );
    const response = await run(
      dispatcher({ tool: "deleteList", args: ["inbox"], buildId: BUILD }),
    );
    // Ratified two-arm envelope (DQ-080).
    expect(response.ok).toBe(true);
    expect(approved.calls).toEqual(["inbox"]);

    // …and a catalog with no governance requirement at all constructs cleanly
    // over the same empty layer, so the check is specific rather than "always
    // refuse an empty stack".
    const { catalog, expose } = await fromSrc("Agent", "catalog", "expose");
    const { code } = await fromSrc("Portable", "code");
    const ungoverned = catalog({
      ping: expose(
        code({
          id: "debug.ping",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: () => Effect.succeed("pong"),
        }),
        {
          description: "Ping",
          args: Schema.Tuple([]),
          success: Schema.String,
          access: { agent: true },
        },
      ),
    });
    const plain = await run(makeDispatcher(ungoverned, Layer.empty));
    expect((await run(plain({ tool: "ping", args: [], buildId: BUILD }))).ok).toBe(true);
  });

  it("[AN-1] the UI layer auto-approves while the agent layer requires human sign-off", async () => {
    const { dispatch, Approval, uiLayer, agentLayer } = await fromSrc(
      "Agent",
      "dispatch",
      "Approval",
      "uiLayer",
      "agentLayer",
    );
    const ui = await makeMutatingCatalog();

    // UI surface: the human already clicked, so dispatch completes unattended.
    const uiResponse = await run(
      dispatch(ui.catalog)({ tool: "deleteList", args: ["inbox"], buildId: BUILD }).pipe(
        Effect.provide(uiLayer({ caller: "ui" })),
      ),
    );
    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(uiResponse.ok).toBe(true);
    expect(ui.calls).toEqual(["inbox"]);

    // Agent surface: the same catalog entry now blocks on a human decision.
    const agent = await makeMutatingCatalog();
    const prompts: Array<string> = [];
    let signOff: (() => void) | undefined;
    const humanDecision = new Promise<void>((resolve) => {
      signOff = resolve;
    });

    const pending = run(
      dispatch(agent.catalog)({
        tool: "deleteList",
        args: ["inbox"],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            agentLayer({ caller: "agent" }),
            Layer.succeed(Approval, {
              require: (summary: string) =>
                Effect.sync(() => {
                  prompts.push(summary);
                }).pipe(Effect.flatMap(() => Effect.promise(() => humanDecision))),
            }),
          ),
        ),
      ),
    );

    // Still pending: nothing was deleted while awaiting sign-off.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(agent.calls).toEqual([]);
    // The human is told what they are approving, by tool identity.
    expect(prompts.join(" ")).toContain("deleteList");

    signOff?.();
    const agentResponse = await pending;
    expect(agentResponse.ok).toBe(true);
    expect(agent.calls).toEqual(["inbox"]);
  });

  it("[AN-1] a denied approval leaves no mutation and reports a typed denial", async () => {
    const { dispatch, Approval, ApprovalDeniedError, Authorizer, AuthorizationDeniedError } =
      await fromSrc(
        "Agent",
        "dispatch",
        "Approval",
        "ApprovalDeniedError",
        "Authorizer",
        "AuthorizationDeniedError",
      );
    const denied = await makeMutatingCatalog();

    const response = await run(
      dispatch(denied.catalog)({ tool: "deleteList", args: ["inbox"], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.succeed(Approval, {
            require: (summary: string) =>
              Effect.fail(new ApprovalDeniedError({ summary, reason: "user declined" })),
          }),
        ),
      ),
    );

    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(response.ok).toBe(false);
    expect(tagOf(response.error)).toBe("ApprovalDeniedError");
    expect(denied.calls).toEqual([]);

    // "Unapproved" and "unauthorized" are near neighbours. A single generic
    // `GovernanceDeniedError` would satisfy this spec and the authorization spec
    // below simultaneously, and a UI could then not tell "ask the user again"
    // from "you may never do this". The codes must differ.
    const unauthorized = await makeMutatingCatalog();
    const authResponse = await run(
      dispatch(unauthorized.catalog)({
        tool: "deleteList",
        args: ["inbox"],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Approval, { require: () => Effect.void }),
            Layer.succeed(Authorizer, {
              authorize: (tool: string) =>
                Effect.fail(new AuthorizationDeniedError({ tool, reason: "not a member" })),
            }),
          ),
        ),
      ),
    );
    expect(tagOf(authResponse.error)).toBe("AuthorizationDeniedError");
    expect(tagOf(authResponse.error)).not.toBe(tagOf(response.error));
    expect(unauthorized.calls).toEqual([]);

    // NEGATIVE CONTROL: a granting Approval layer lets the same call through, so
    // "always deny" cannot pass.
    const granted = await makeMutatingCatalog();
    const ok = await run(
      dispatch(granted.catalog)({
        tool: "deleteList",
        args: ["inbox"],
        buildId: BUILD,
      }).pipe(Effect.provide(Layer.succeed(Approval, { require: () => Effect.void }))),
    );
    expect(ok.ok).toBe(true);
    expect(granted.calls).toEqual(["inbox"]);
  });

  it("[AN-1] CallerContext carries caller kind, user and lineage into the action", async () => {
    const { catalog, expose, dispatch, CallerContext } = await fromSrc(
      "Agent",
      "catalog",
      "expose",
      "dispatch",
      "CallerContext",
    );
    const { code } = await fromSrc("Portable", "code");

    const observed: Array<unknown> = [];
    const WhoAmI = code({
      id: "debug.whoami",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () =>
        Effect.gen(function* () {
          const ctx = yield* CallerContext;
          observed.push({
            caller: ctx.caller,
            user: ctx.user,
            lineage: ctx.lineage,
          });
          return "ok";
        }),
    });

    const c = catalog({
      whoami: expose(WhoAmI, {
        description: "Report the caller",
        args: Schema.Tuple([]),
        success: Schema.String,
        access: { agent: true },
      }),
    });

    const response = await run(
      dispatch(c)({ tool: "whoami", args: [], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.succeed(CallerContext, {
            caller: "agent",
            user: { _tag: "Some", value: "u-1" },
            lineage: {
              _tag: "Some",
              value: { threadId: "th-1", runId: "run-1" },
            },
          }),
        ),
      ),
    );

    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(response.ok).toBe(true);
    expect(observed).toHaveLength(1);
    const ctx: any = observed[0];
    expect(ctx.caller).toBe("agent");
    // Identity and lineage are readable by the action itself — that is what
    // makes row-level scoping and audit lineage possible without a second path.
    expect(JSON.stringify(ctx)).toContain("u-1");
    expect(JSON.stringify(ctx)).toContain("th-1");
  });

  it("[AN-1] audit middleware records every mutating dispatch with schema-driven scrubbing", async () => {
    const { catalog, exposeMutation, dispatch, audited, AuditLog, secret } = await fromSrc(
      "Agent",
      "catalog",
      "exposeMutation",
      "dispatch",
      "audited",
      "AuditLog",
      "secret",
    );
    const { code } = await fromSrc("Portable", "code");
    const { CallerContext } = await fromSrc("Agent", "CallerContext");

    const Connect = code({
      id: "integration.connect",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_c: any, input: { readonly host: string; readonly apiToken: string }) =>
        Effect.succeed({ connected: input.host }),
    });

    const c = audited(
      catalog({
        connect: exposeMutation(Connect, {
          description: "Connect an integration",
          args: Schema.Tuple([
            Schema.Struct({
              host: Schema.String,
              // Declared secret: the audit record must not contain its value.
              apiToken: secret(Schema.String),
            }),
          ]),
          success: Schema.Struct({ connected: Schema.String }),
          reactivityKeys: ["integrations"],
          access: { agent: true },
        }),
      }),
    );

    const records: Array<any> = [];
    const layers = Layer.mergeAll(
      Layer.succeed(AuditLog, {
        record: (entry: any) =>
          Effect.sync(() => {
            records.push(entry);
          }),
      }),
      Layer.succeed(CallerContext, {
        caller: "agent",
        user: { _tag: "Some", value: "u-7" },
        lineage: { _tag: "None" },
      }),
    );

    const response = await run(
      dispatch(c)({
        tool: "connect",
        args: [{ host: "api.example.com", apiToken: "sk-live-DO-NOT-LOG" }],
        buildId: BUILD,
      }).pipe(Effect.provide(layers)),
    );

    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(response.ok).toBe(true);
    // Exactly one record, not "at least one": a double-audit is as much a bug as
    // a missing one.
    expect(records).toHaveLength(1);

    const [entry] = records;
    expect(entry.tool).toBe("connect");
    expect(entry.id).toBe("integration.connect");
    expect(entry.buildId).toBe(BUILD);
    expect(entry.caller).toBe("agent");
    expect(entry.outcome).toBe("success");

    // Non-secret args survive so the record is useful...
    expect(allStrings(entry.args)).toContain("api.example.com");
    // ...and the declared secret does not appear anywhere in the record.
    expect(JSON.stringify(entry)).not.toContain("sk-live-DO-NOT-LOG");
    expect(allStrings(entry.args)).not.toContain("sk-live-DO-NOT-LOG");
    // An audit record is a wire value.
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
  });

  it("[AN-1] a denied authorization is still audited", async () => {
    const { catalog, exposeMutation, dispatch, audited, AuditLog, Authorizer, AuthorizationDeniedError } =
      await fromSrc(
        "Agent",
        "catalog",
        "exposeMutation",
        "dispatch",
        "audited",
        "AuditLog",
        "Authorizer",
        "AuthorizationDeniedError",
      );
    const { code } = await fromSrc("Portable", "code");
    const { CallerContext } = await fromSrc("Agent", "CallerContext");

    let ran = 0;
    const Delete = code({
      id: "list.delete",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () => Effect.sync(() => ++ran),
    });

    const c = audited(
      catalog({
        deleteList: exposeMutation(Delete, {
          description: "Delete a list",
          args: Schema.Tuple([]),
          success: Schema.Number,
          access: { agent: true },
        }),
      }),
    );

    const records: Array<any> = [];
    const layers = Layer.mergeAll(
      Layer.succeed(AuditLog, {
        record: (entry: any) => Effect.sync(() => void records.push(entry)),
      }),
      Layer.succeed(Authorizer, {
        authorize: (tool: string) =>
          Effect.fail(
            new AuthorizationDeniedError({ tool, reason: "not a member of the list" }),
          ),
      }),
      Layer.succeed(CallerContext, {
        caller: "agent",
        user: { _tag: "Some", value: "u-9" },
        lineage: { _tag: "None" },
      }),
    );

    const response = await run(
      dispatch(c)({ tool: "deleteList", args: [], buildId: BUILD }).pipe(
        Effect.provide(layers),
      ),
    );

    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(response.ok).toBe(false);
    expect(tagOf(response.error)).toBe("AuthorizationDeniedError");
    expect(ran).toBe(0);

    // The most valuable audit record is the one for the call that was refused.
    expect(records).toHaveLength(1);
    expect(records[0].outcome).toBe("denied");
    expect(records[0].tool).toBe("deleteList");
    expect(records[0].caller).toBe("agent");
    expect(records[0].error._tag).toBe("AuthorizationDeniedError");

    // NEGATIVE CONTROL. An audit layer that records `outcome: "denied"`
    // unconditionally, or an Authorizer wired to always fail, satisfies
    // everything above. So the same catalog with a permitting Authorizer must
    // run, and be audited with the *other* outcome. Fresh recorders and a fresh
    // run counter: the phases must not share mutable state.
    const allowRecords: Array<any> = [];
    let allowRan = 0;
    const AllowedDelete = code({
      id: "list.delete",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () => Effect.sync(() => ++allowRan),
    });
    const allowed = audited(
      catalog({
        deleteList: exposeMutation(AllowedDelete, {
          description: "Delete a list",
          args: Schema.Tuple([]),
          success: Schema.Number,
          access: { agent: true },
        }),
      }),
    );
    const permitted = await run(
      dispatch(allowed)({ tool: "deleteList", args: [], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(AuditLog, {
              record: (entry: any) => Effect.sync(() => void allowRecords.push(entry)),
            }),
            Layer.succeed(Authorizer, { authorize: () => Effect.void }),
            Layer.succeed(CallerContext, {
              caller: "agent",
              user: { _tag: "Some", value: "u-9" },
              lineage: { _tag: "None" },
            }),
          ),
        ),
      ),
    );
    expect(permitted.ok).toBe(true);
    expect(allowRan).toBe(1);
    // Exactly one record, and the outcomes are distinguishable.
    expect(allowRecords).toHaveLength(1);
    expect(allowRecords[0].outcome).toBe("success");
    expect(allowRecords[0].outcome).not.toBe(records[0].outcome);
  });

  it("[AN-1/DQ-083] audit-sink failure defaults to `refuse`, and the refusal is itself recorded", async () => {
    // Ratified (§10, DQ-083): a layer-level `onFailure` policy whose default is
    // `refuse`, with the refusal record durable — write-ahead, then run. The
    // write-ahead ordering is what makes "every mutating dispatch is audited"
    // true at exactly the moment it matters.
    const { dispatch, audited, AuditLog, catalog, expose, exposeMutation } = await fromSrc(
      "Agent",
      "dispatch",
      "audited",
      "AuditLog",
      "catalog",
      "expose",
      "exposeMutation",
    );
    const { code } = await fromSrc("Portable", "code");

    const makeAudited = (options?: unknown) => {
      let ran = 0;
      const c = audited(
        catalog({
          deleteList: exposeMutation(
            code({
              id: "list.delete",
              buildId: BUILD,
              captures: Schema.Struct({}),
              run: () => Effect.sync(() => ++ran),
            }),
            {
              description: "Delete a list",
              args: Schema.Tuple([]),
              success: Schema.Number,
              access: { agent: true },
            },
          ),
        }),
        options as any,
      );
      return { catalog: c, ran: () => ran };
    };

    // DEFAULT: refuse. The sink rejects the write-ahead record, so the action
    // never runs, and the caller gets a typed refusal.
    const refusing = makeAudited(undefined);
    const attempted: Array<any> = [];
    const error = await runFail(
      dispatch(refusing.catalog)({ tool: "deleteList", args: [], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.succeed(AuditLog, {
            record: (entry: any) =>
              Effect.sync(() => void attempted.push(entry)).pipe(
                Effect.flatMap(() => Effect.fail({ _tag: "AuditSinkUnavailable" } as any)),
              ),
          }),
        ),
      ),
    );
    expect(tagOf(error)).toBe("AuditSinkUnavailable");
    expect(refusing.ran()).toBe(0);
    // Write-ahead: the sink was asked BEFORE the action would have run, which is
    // the only ordering under which refusing is meaningful.
    // (PREMISE CORRECTED 2026-08-13: DQ-083's own ratified text makes the
    // refusal record ITSELF durable, so the sink is asked twice on refusal —
    // the write-ahead attempt and the audit-refused record. The original
    // single-attempt expectation contradicted the durable-refusal phase of
    // this very test.)
    expect(attempted).toHaveLength(2);
    expect(attempted[0].tool).toBe("deleteList");
    expect(attempted[1].outcome).toBe("audit-refused");

    // …and the refusal itself is durable: a sink that accepts the refusal record
    // (while rejecting the ordinary one) receives it.
    const durable = makeAudited(undefined);
    const durableRecords: Array<any> = [];
    await Effect.runPromiseExit(
      dispatch(durable.catalog)({ tool: "deleteList", args: [], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.succeed(AuditLog, {
            record: (entry: any) =>
              entry.outcome === "audit-refused"
                ? Effect.sync(() => void durableRecords.push(entry))
                : Effect.fail({ _tag: "AuditSinkUnavailable" } as any),
          }),
        ),
      ) as any,
    );
    expect(durableRecords).toHaveLength(1);
    expect(durableRecords[0].outcome).toBe("audit-refused");
    expect(durable.ran()).toBe(0);

    // EXPLICIT `proceed`: honoured, because an unoverridable default just gets
    // wrapped around by apps, which is strictly worse than a knob.
    const proceeding = makeAudited({ onFailure: "proceed" });
    const proceeded = await run(
      dispatch(proceeding.catalog)({ tool: "deleteList", args: [], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.succeed(AuditLog, {
            record: () => Effect.fail({ _tag: "AuditSinkUnavailable" } as any),
          }),
        ),
      ),
    );
    expect(proceeded.ok).toBe(true);
    expect(proceeding.ran()).toBe(1);
    // The two policies must be distinguishable at the call site, or the knob is
    // decorative.
    expect(proceeding.ran()).not.toBe(refusing.ran());

    // NEGATIVE CONTROL. "Never runs when the sink is down" is also satisfied by
    // "never runs". A healthy sink must let exactly the same dispatch through and
    // record it exactly once, with an outcome distinct from the refusal.
    const healthy = makeAudited(undefined);
    const healthyRecords: Array<any> = [];
    const ok = await run(
      dispatch(healthy.catalog)({ tool: "deleteList", args: [], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.succeed(AuditLog, {
            record: (entry: any) => Effect.sync(() => void healthyRecords.push(entry)),
          }),
        ),
      ),
    );
    expect(ok.ok).toBe(true);
    expect(healthy.ran()).toBe(1);
    expect(healthyRecords).toHaveLength(1);
    expect(healthyRecords[0].outcome).toBe("success");

    // …and `expose` (non-mutating) is unaffected by the audit-sink policy, which
    // pins DQ-084's other half from this side.
    const readOnly = audited(
      catalog({
        listLists: expose(
          code({
            id: "list.list",
            buildId: BUILD,
            captures: Schema.Struct({}),
            run: () => Effect.succeed(0),
          }),
          {
            description: "List lists",
            args: Schema.Tuple([]),
            success: Schema.Number,
            access: { agent: true },
          },
        ),
      }),
    );
    const readResponse = await run(
      dispatch(readOnly)({ tool: "listLists", args: [], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.succeed(AuditLog, {
            record: () => Effect.fail({ _tag: "AuditSinkUnavailable" } as any),
          }),
        ),
      ),
    );
    expect(readResponse.ok).toBe(true);
  });

  it("[AN-1/DQ-084] mutation is declared by the constructor, not inferred from `reactivityKeys`", async () => {
    // Ratified (§10, DQ-084): `Agent.exposeMutation` alongside `Agent.expose`, so
    // the *type* carries the distinction. The presence of `reactivityKeys` is a
    // coincidence, not a declaration — a read-only action may legitimately
    // declare keys (a cache warm, a projection refresh) without being audited as
    // a mutation.
    const { catalog, expose, exposeMutation, dispatch, audited, AuditLog, isMutation } =
      await fromSrc(
        "Agent",
        "catalog",
        "expose",
        "exposeMutation",
        "dispatch",
        "audited",
        "AuditLog",
        "isMutation",
      );
    const { code } = await fromSrc("Portable", "code");

    const mk = (id: string) =>
      code({
        id,
        buildId: BUILD,
        captures: Schema.Struct({}),
        run: () => Effect.succeed(1),
      });
    const shared = {
      args: Schema.Tuple([]),
      success: Schema.Number,
      // Both entries declare the SAME reactivity keys. If keys were the signal,
      // these two would be indistinguishable.
      reactivityKeys: ["lists"],
      access: { agent: true },
    };

    const c = audited(
      catalog({
        deleteList: exposeMutation(mk("list.delete"), {
          ...shared,
          description: "Delete a list",
        }),
        warmLists: expose(mk("list.warm"), {
          ...shared,
          description: "Warm the list cache",
        }),
      }),
    );

    // The declaration is inspectable, and it tracks the constructor.
    expect(isMutation(c, "deleteList")).toBe(true);
    expect(isMutation(c, "warmLists")).toBe(false);

    const records: Array<any> = [];
    const sink = Layer.succeed(AuditLog, {
      record: (entry: any) => Effect.sync(() => void records.push(entry)),
    });

    const mutated = await run(
      dispatch(c)({ tool: "deleteList", args: [], buildId: BUILD }).pipe(
        Effect.provide(sink),
      ),
    );
    expect(mutated.ok).toBe(true);
    // Audit applies to `exposeMutation` entries: exactly one record, not "at
    // least one" — a double-audit is as much a bug as a missing one.
    expect(records).toHaveLength(1);
    expect(records[0].tool).toBe("deleteList");
    expect(records[0].mutation).toBe(true);

    // NEGATIVE CONTROL, and the load-bearing half: the read-only sibling
    // declaring identical `reactivityKeys` is NOT audited as a mutation. An
    // implementation that audits on `reactivityKeys.length > 0` fails here.
    records.length = 0;
    const read = await run(
      dispatch(c)({ tool: "warmLists", args: [], buildId: BUILD }).pipe(
        Effect.provide(sink),
      ),
    );
    expect(read.ok).toBe(true);
    expect(records.filter((entry) => entry.mutation === true)).toEqual([]);
    // …while both still invalidate, because invalidation and mutation-ness are
    // orthogonal declarations.
    expect(read.payload.invalidated).toEqual(["lists"]);
    expect(mutated.payload.invalidated).toEqual(["lists"]);
  });

  it("[AN-1/DQ-085] a declared `Agent.secret` field is scrubbed, while a suspiciously-named field is only diagnosed", async () => {
    // Ratified (§10, DQ-085): redaction is *structural* — `Agent.secret(schema)`.
    // The M7 secret-name heuristic is a diagnostic that SUGGESTS `Agent.secret`,
    // never an enforcement point. Enforcement by name is precisely the
    // combination §9.5 flagged, and it is decided as "diagnostic, never
    // enforcement": a field called `password` that was not declared secret still
    // dispatches.
    const { catalog, expose, exposeMutation, dispatch, audited, AuditLog, secret, catalogDiagnostics } =
      await fromSrc(
        "Agent",
        "catalog",
        "expose",
        "exposeMutation",
        "dispatch",
        "audited",
        "AuditLog",
        "secret",
        "catalogDiagnostics",
      );
    const { code } = await fromSrc("Portable", "code");

    const ran: Array<unknown> = [];
    const Connect = code({
      id: "integration.connect",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_c: any, input: any) =>
        Effect.sync(() => {
          ran.push(input);
          return { connected: input.host };
        }),
    });

    const c = audited(
      catalog({
        // `apiToken` is DECLARED secret; `password` merely looks like one.
        connect: exposeMutation(Connect, {
          description: "Connect an integration",
          args: Schema.Tuple([
            Schema.Struct({
              host: Schema.String,
              apiToken: secret(Schema.String),
              password: Schema.String,
            }),
          ]),
          success: Schema.Struct({ connected: Schema.String }),
          access: { agent: true },
        }),
      }),
    );

    // The heuristic fires as a *diagnostic*, naming the undeclared field and
    // suggesting the structural fix.
    const diagnostics = catalogDiagnostics(c);
    expect(diagnostics.map((d: any) => d.code)).toEqual(["agent:secret-name-suggests-redaction"]);
    expect(diagnostics[0].severity).toBe("warning");
    expect(JSON.stringify(diagnostics)).toContain("password");
    // It does NOT fire for the field that already took the structural route —
    // otherwise the suggestion would be unactionable noise.
    expect(JSON.stringify(diagnostics)).not.toContain("apiToken");

    const records: Array<any> = [];
    const response = await run(
      dispatch(c)({
        tool: "connect",
        args: [
          { host: "api.example.com", apiToken: "sk-live-DECLARED", password: "hunter2" },
        ],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.succeed(AuditLog, {
            record: (entry: any) => Effect.sync(() => void records.push(entry)),
          }),
        ),
      ),
    );

    // Diagnostic, never enforcement: the call still dispatches, and `run` sees
    // both values.
    expect(response.ok).toBe(true);
    expect(ran).toHaveLength(1);
    expect((ran[0] as any).password).toBe("hunter2");
    expect((ran[0] as any).apiToken).toBe("sk-live-DECLARED");

    // Structural redaction is what actually scrubs the audit record…
    expect(records).toHaveLength(1);
    const [entry] = records;
    expect(JSON.stringify(entry)).not.toContain("sk-live-DECLARED");
    // …and the merely-suspicious field is NOT scrubbed, because names do not
    // enforce. This is the assertion that fails if someone "hardens" the
    // heuristic into redaction.
    expect(allStrings(entry.args)).toContain("hunter2");
    // Non-secret args survive so the record stays useful.
    expect(allStrings(entry.args)).toContain("api.example.com");

    // NEGATIVE CONTROL: a catalog with no suspiciously-named field produces no
    // diagnostics, so "always suggest" cannot pass.
    const clean = catalog({
      ping: expose(
        code({
          id: "debug.ping",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: () => Effect.succeed("pong"),
        }),
        {
          description: "Ping",
          args: Schema.Tuple([Schema.Struct({ host: Schema.String })]),
          success: Schema.String,
          access: { agent: true },
        },
      ),
    });
    expect(catalogDiagnostics(clean)).toEqual([]);
  });

  it("[AN-1/DQ-086] an unauthorized caller learns nothing: no schema, no description, no drift detail", async () => {
    // Ratified (§10, DQ-086): authorization is outermost for a reason worth
    // stating — *nothing*, including a schema or a tool description, should be
    // disclosed to an unauthorized caller. So an unauthorized call carrying a
    // stale buildId must not leak the fresh manifest DQ-081 attaches to a drift
    // refusal, and must not leak whether the tool even exists in a useful way.
    const { catalog, expose, dispatch, Authorizer, AuthorizationDeniedError, toolManifest } =
      await fromSrc(
        "Agent",
        "catalog",
        "expose",
        "dispatch",
        "Authorizer",
        "AuthorizationDeniedError",
        "toolManifest",
      );
    const { code } = await fromSrc("Portable", "code");

    let ran = 0;
    const c = catalog({
      readSalaries: expose(
        code({
          id: "hr.readSalaries",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: () => Effect.sync(() => ++ran),
        }),
        {
          description: "Read the confidential salary table for a department",
          args: Schema.Tuple([Schema.String]),
          success: Schema.Number,
          access: { agent: true },
        },
      ),
    });

    const denying = Layer.succeed(Authorizer, {
      authorize: (tool: string) =>
        Effect.fail(new AuthorizationDeniedError({ tool, reason: "not a member" })),
    });

    // Stale buildId AND unauthorized: authorization wins, because it is
    // outermost.
    const response = await run(
      dispatch(c)({ tool: "readSalaries", args: ["eng"], buildId: "build-stale" }).pipe(
        Effect.provide(denying),
      ),
    );

    expect(response.ok).toBe(false);
    expect(tagOf(response.error)).toBe("AuthorizationDeniedError");
    expect(tagOf(response.error)).not.toBe("PortableBuildMismatchError");
    expect(ran).toBe(0);

    // Nothing disclosed. Each of these strings is something a later refusal
    // stage would legitimately have included.
    const leaked = JSON.stringify(response);
    expect(leaked).not.toContain("confidential salary table");
    expect(leaked).not.toContain("hr.readSalaries");
    expect(leaked).not.toContain(BUILD);
    expect(response.error.manifest).toBeUndefined();
    expect(response.error.inputSchema).toBeUndefined();
    expect(response.error.expected).toBeUndefined();

    // NEGATIVE CONTROL: with authorization granted, exactly those disclosures
    // ARE available through the normal surfaces — so "disclose nothing to
    // anybody" cannot pass, and the drift detail reappears for a caller entitled
    // to it.
    const permitting = Layer.succeed(Authorizer, { authorize: () => Effect.void });
    const manifest = await run(toolManifest(c).pipe(Effect.provide(permitting)));
    expect(JSON.stringify(manifest)).toContain("confidential salary table");
    expect(manifest.tools[0].id).toBe("hr.readSalaries");

    const drift = await run(
      dispatch(c)({ tool: "readSalaries", args: ["eng"], buildId: "build-stale" }).pipe(
        Effect.provide(permitting),
      ),
    );
    expect(tagOf(drift.error)).toBe("PortableBuildMismatchError");
    expect(drift.error.expected).toBe(BUILD);
    expect(ran).toBe(0);

    const ok = await run(
      dispatch(c)({ tool: "readSalaries", args: ["eng"], buildId: BUILD }).pipe(
        Effect.provide(permitting),
      ),
    );
    expect(ok.ok).toBe(true);
    expect(ran).toBe(1);
  });

  it("[AN-1] durable approvals and the pending-approval queue contract", async () => {
    // Open design question DQ-095: whether a pending approval survives a
    // restart, and whether the queue is itself a standard query.
    const mod = await loadSrc("Agent");
    pick(mod, "Agent", "Approval");
    unbuilt(
      "pending-approval queue as a standard query + approval durability across restart",
      "DQ-095",
    );
  });
});
