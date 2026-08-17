/**
 * AN-1 governance — "their flags, our services" (`AGENT_NATIVE_NOTES.md` §5).
 * Promoted from `future/agent/governance.spec.ts` once every spec passed
 * (DQ-095's ratification discharged the file's last marker).
 *
 * Authorization, human approval, caller identity and audit are not dispatch
 * options but *requirements*, satisfied by per-surface Layers. Ratified
 * decisions covered here: DQ-082 (construction-time governance check),
 * DQ-083 (audit write-ahead, refuse default), DQ-084 (mutation declared by
 * constructor), DQ-085 (structural redaction; name heuristic diagnoses
 * only), DQ-086 (authorize outermost), DQ-095 (ApprovalStore: restart
 * denies; the queue is renderable data).
 */
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Agent from "../Agent.js";
import * as Portable from "../Portable.js";

const BUILD = "build-gov";

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);
const runFail = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const flipped = await Effect.runPromiseExit(effect.pipe(Effect.flip));
  if (flipped._tag !== "Success") {
    throw new Error("expected a typed failure, but the effect succeeded");
  }
  return flipped.value;
};

/** The `_tag` of a value, for discriminated-union assertions without casts. */
function tagOf(value: unknown): string {
  return typeof value === "object" && value !== null && "_tag" in value
    ? String(value._tag)
    : "none";
}

/** Collect every string in a value, for leak assertions. */
function allStrings(value: unknown): ReadonlyArray<string> {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => [key, ...allStrings(item)]);
  }
  return [];
}

function refusalOf(response: Agent.DispatchResponse): unknown {
  expect(response.ok).toBe(false);
  return response.ok ? undefined : response.error;
}

function payloadOf(response: Agent.DispatchResponse) {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error("expected a success envelope");
  return response.payload;
}

/** A mutating catalog with one entry that requires approval, plus a call log. */
function makeMutatingCatalog() {
  const calls: Array<unknown> = [];
  const DeleteList = Portable.code({
    id: "list.delete",
    buildId: BUILD,
    captures: Schema.Struct({}),
    run: (_c, listId: string) =>
      Effect.sync(() => {
        calls.push(listId);
        return { deleted: listId };
      }),
  });

  return {
    calls,
    catalog: Agent.catalog({
      deleteList: Agent.expose(DeleteList, {
        description: "Delete a list and everything in it",
        args: Schema.Tuple([Schema.String]),
        success: Schema.Struct({ deleted: Schema.String }),
        reactivityKeys: ["lists"],
        access: { agent: true, http: true, approval: "mutate" },
      }),
    }),
  };
}

describe("AN-1 governance", () => {
  it("DQ-082: a dispatcher whose governance requirements are unmet fails at CONSTRUCTION with a typed error, never a defect", async () => {
    // The hole this closes: under a dynamically assembled Layer the missing
    // `Approval` requirement is erased, so it used to surface as an
    // unmet-service *defect* at call time. Now the dispatcher refuses to be
    // built, with one shared typed error.
    const missing = makeMutatingCatalog();
    const error = await runFail(Agent.makeDispatcher(missing.catalog, Layer.empty));

    expect(tagOf(error)).toBe("GovernanceUnsatisfiedError");
    expect(error instanceof Agent.GovernanceUnsatisfiedError).toBe(true);
    if (error instanceof Agent.GovernanceUnsatisfiedError) {
      // It names what is missing and for which entry, or "fail closed" is
      // not actionable.
      expect(error.tool).toBe("deleteList");
      expect(allStrings(error)).toContain("Approval");
    }
    // Construction-time means exactly that: nothing dispatched, nothing ran.
    expect(missing.calls).toEqual([]);

    // NEGATIVE CONTROL: with the requirement satisfied, construction
    // succeeds and the dispatcher works.
    const approved = makeMutatingCatalog();
    const dispatcher = await run(
      Agent.makeDispatcher(
        approved.catalog,
        Layer.succeed(Agent.Approval, { require: () => Effect.void }),
      ).pipe(Effect.orDie),
    );
    const response = await run(
      dispatcher({ tool: "deleteList", args: ["inbox"], buildId: BUILD }).pipe(
        Effect.orDie,
      ),
    );
    expect(response.ok).toBe(true);
    expect(approved.calls).toEqual(["inbox"]);

    // …and a catalog with no governance requirement constructs cleanly over
    // the same empty layer — the check is specific, not "refuse empty".
    const ungoverned = Agent.catalog({
      ping: Agent.expose(
        Portable.code({
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
    const plain = await run(Agent.makeDispatcher(ungoverned, Layer.empty).pipe(Effect.orDie));
    expect(
      (await run(plain({ tool: "ping", args: [], buildId: BUILD }).pipe(Effect.orDie))).ok,
    ).toBe(true);
  });

  it("the UI layer auto-approves while the agent layer requires human sign-off", async () => {
    const ui = makeMutatingCatalog();
    const uiResponse = await run(
      Agent.dispatch(ui.catalog)({
        tool: "deleteList",
        args: ["inbox"],
        buildId: BUILD,
      }).pipe(Effect.provide(Agent.uiLayer({ caller: "ui" })), Effect.orDie),
    );
    expect(uiResponse.ok).toBe(true);
    expect(ui.calls).toEqual(["inbox"]);

    // Agent surface: the same catalog entry now blocks on a human decision.
    const agent = makeMutatingCatalog();
    const prompts: Array<string> = [];
    let signOff: (() => void) | undefined;
    const humanDecision = new Promise<void>((resolve) => {
      signOff = resolve;
    });

    const pending = run(
      Agent.dispatch(agent.catalog)({
        tool: "deleteList",
        args: ["inbox"],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Agent.agentLayer({ caller: "agent" }),
            Layer.succeed(Agent.Approval, {
              require: (summary) =>
                Effect.sync(() => {
                  prompts.push(summary);
                }).pipe(Effect.flatMap(() => Effect.promise(() => humanDecision))),
            }),
          ),
        ),
        Effect.orDie,
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

  it("a denied approval leaves no mutation and reports a typed denial, distinct from unauthorized", async () => {
    const denied = makeMutatingCatalog();
    const response = await run(
      Agent.dispatch(denied.catalog)({
        tool: "deleteList",
        args: ["inbox"],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.succeed(Agent.Approval, {
            require: (summary) =>
              Effect.fail(
                new Agent.ApprovalDeniedError({ summary, reason: "user declined" }),
              ),
          }),
        ),
        Effect.orDie,
      ),
    );
    expect(tagOf(refusalOf(response))).toBe("ApprovalDeniedError");
    expect(denied.calls).toEqual([]);

    // "Unapproved" and "unauthorized" are near neighbours; a single generic
    // code would leave a UI unable to tell "ask again" from "never".
    const unauthorized = makeMutatingCatalog();
    const authResponse = await run(
      Agent.dispatch(unauthorized.catalog)({
        tool: "deleteList",
        args: ["inbox"],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Agent.Approval, { require: () => Effect.void }),
            Layer.succeed(Agent.Authorizer, {
              authorize: (tool) =>
                Effect.fail(
                  new Agent.AuthorizationDeniedError({ tool, reason: "not a member" }),
                ),
            }),
          ),
        ),
        Effect.orDie,
      ),
    );
    expect(tagOf(refusalOf(authResponse))).toBe("AuthorizationDeniedError");
    expect(unauthorized.calls).toEqual([]);

    // NEGATIVE CONTROL: a granting Approval layer lets the same call through.
    const granted = makeMutatingCatalog();
    const ok = await run(
      Agent.dispatch(granted.catalog)({
        tool: "deleteList",
        args: ["inbox"],
        buildId: BUILD,
      }).pipe(
        Effect.provide(Layer.succeed(Agent.Approval, { require: () => Effect.void })),
        Effect.orDie,
      ),
    );
    expect(ok.ok).toBe(true);
    expect(granted.calls).toEqual(["inbox"]);
  });

  it("CallerContext carries caller kind, user and lineage into the action", async () => {
    const observed: Array<unknown> = [];
    const WhoAmI = Portable.code({
      id: "debug.whoami",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () =>
        Effect.gen(function* () {
          const ctx = yield* Agent.CallerContext;
          observed.push({ caller: ctx.caller, user: ctx.user, lineage: ctx.lineage });
          return "ok";
        }),
    });

    const c = Agent.catalog({
      whoami: Agent.expose(WhoAmI, {
        description: "Report the caller",
        args: Schema.Tuple([]),
        success: Schema.String,
        access: { agent: true },
      }),
    });

    const response = await run(
      Agent.dispatch(c)({ tool: "whoami", args: [], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.succeed(Agent.CallerContext, {
            caller: "agent",
            user: { _tag: "Some", value: "u-1" },
            lineage: { _tag: "Some", value: { threadId: "th-1", runId: "run-1" } },
          }),
        ),
        Effect.orDie,
      ),
    );

    expect(response.ok).toBe(true);
    expect(observed).toHaveLength(1);
    // Identity and lineage are readable by the action itself — that is what
    // makes row-level scoping and audit lineage possible without a second path.
    expect(JSON.stringify(observed[0])).toContain("agent");
    expect(JSON.stringify(observed[0])).toContain("u-1");
    expect(JSON.stringify(observed[0])).toContain("th-1");
  });

  it("audit middleware records every mutating dispatch with schema-driven scrubbing", async () => {
    const Connect = Portable.code({
      id: "integration.connect",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_c, input: { readonly host: string; readonly apiToken: string }) =>
        Effect.succeed({ connected: input.host }),
    });

    const c = Agent.audited(
      Agent.catalog({
        connect: Agent.exposeMutation(Connect, {
          description: "Connect an integration",
          args: Schema.Tuple([
            Schema.Struct({
              host: Schema.String,
              // Declared secret: the audit record must not contain its value.
              apiToken: Agent.secret(Schema.String),
            }),
          ]),
          success: Schema.Struct({ connected: Schema.String }),
          reactivityKeys: ["integrations"],
          access: { agent: true },
        }),
      }),
    );

    const records: Array<Agent.AuditRecord> = [];
    const response = await run(
      Agent.dispatch(c)({
        tool: "connect",
        args: [{ host: "api.example.com", apiToken: "sk-live-DO-NOT-LOG" }],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Agent.AuditLog, {
              record: (entry) => Effect.sync(() => void records.push(entry)),
            }),
            Layer.succeed(Agent.CallerContext, {
              caller: "agent",
              user: { _tag: "Some", value: "u-7" },
              lineage: { _tag: "None" },
            }),
          ),
        ),
        Effect.orDie,
      ),
    );

    expect(response.ok).toBe(true);
    // Exactly one record: a double-audit is as much a bug as a missing one.
    expect(records).toHaveLength(1);
    const entry = records[0]!;
    expect(entry.tool).toBe("connect");
    expect(entry.id).toBe("integration.connect");
    expect(entry.buildId).toBe(BUILD);
    expect(entry.caller).toBe("agent");
    expect(entry.outcome).toBe("success");
    // Non-secret args survive so the record is useful…
    expect(allStrings(entry.args)).toContain("api.example.com");
    // …and the declared secret does not appear anywhere in the record.
    expect(JSON.stringify(entry)).not.toContain("sk-live-DO-NOT-LOG");
    // An audit record is a wire value.
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
  });

  it("a denied authorization is still audited, with a distinguishable outcome", async () => {
    const makeAudited = () => {
      let ran = 0;
      const c = Agent.audited(
        Agent.catalog({
          deleteList: Agent.exposeMutation(
            Portable.code({
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
      );
      return { catalog: c, ran: () => ran };
    };
    const caller = Layer.succeed(Agent.CallerContext, {
      caller: "agent",
      user: { _tag: "Some", value: "u-9" },
      lineage: { _tag: "None" },
    });

    const deniedCatalog = makeAudited();
    const records: Array<Agent.AuditRecord> = [];
    const response = await run(
      Agent.dispatch(deniedCatalog.catalog)({
        tool: "deleteList",
        args: [],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Agent.AuditLog, {
              record: (entry) => Effect.sync(() => void records.push(entry)),
            }),
            Layer.succeed(Agent.Authorizer, {
              authorize: (tool) =>
                Effect.fail(
                  new Agent.AuthorizationDeniedError({
                    tool,
                    reason: "not a member of the list",
                  }),
                ),
            }),
            caller,
          ),
        ),
        Effect.orDie,
      ),
    );
    expect(tagOf(refusalOf(response))).toBe("AuthorizationDeniedError");
    expect(deniedCatalog.ran()).toBe(0);
    // The most valuable audit record is the one for the refused call.
    expect(records).toHaveLength(1);
    expect(records[0]!.outcome).toBe("denied");
    expect(records[0]!.tool).toBe("deleteList");
    expect(records[0]!.caller).toBe("agent");
    expect(tagOf(records[0]!.error)).toBe("AuthorizationDeniedError");

    // NEGATIVE CONTROL: a permitting Authorizer runs, and is audited with
    // the OTHER outcome — fresh recorder, fresh counter.
    const allowedCatalog = makeAudited();
    const allowRecords: Array<Agent.AuditRecord> = [];
    const permitted = await run(
      Agent.dispatch(allowedCatalog.catalog)({
        tool: "deleteList",
        args: [],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Agent.AuditLog, {
              record: (entry) => Effect.sync(() => void allowRecords.push(entry)),
            }),
            Layer.succeed(Agent.Authorizer, { authorize: () => Effect.void }),
            caller,
          ),
        ),
        Effect.orDie,
      ),
    );
    expect(permitted.ok).toBe(true);
    expect(allowedCatalog.ran()).toBe(1);
    expect(allowRecords).toHaveLength(1);
    expect(allowRecords[0]!.outcome).toBe("success");
    expect(allowRecords[0]!.outcome).not.toBe(records[0]!.outcome);
  });

  it("DQ-083: audit-sink failure defaults to refuse (write-ahead, durable refusal), proceed is honoured", async () => {
    const makeAudited = (options?: { readonly onFailure: "refuse" | "proceed" }) => {
      let ran = 0;
      const c = Agent.audited(
        Agent.catalog({
          deleteList: Agent.exposeMutation(
            Portable.code({
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
        options,
      );
      return { catalog: c, ran: () => ran };
    };

    // DEFAULT: refuse. The sink rejects the write-ahead record, so the
    // action never runs and the caller gets a typed refusal.
    const refusing = makeAudited();
    const attempted: Array<Agent.AuditRecord> = [];
    const error = await runFail(
      Agent.dispatch(refusing.catalog)({
        tool: "deleteList",
        args: [],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.succeed(Agent.AuditLog, {
            record: (entry) =>
              Effect.sync(() => void attempted.push(entry)).pipe(
                Effect.flatMap(() => Effect.fail({ _tag: "AuditSinkUnavailable" })),
              ),
          }),
        ),
      ),
    );
    expect(tagOf(error)).toBe("AuditSinkUnavailable");
    expect(refusing.ran()).toBe(0);
    // Write-ahead, then the durable refusal record: the sink is asked twice.
    expect(attempted).toHaveLength(2);
    expect(attempted[0]!.tool).toBe("deleteList");
    expect(attempted[1]!.outcome).toBe("audit-refused");

    // …and the refusal itself is durable: a sink that accepts only the
    // refusal record receives it.
    const durable = makeAudited();
    const durableRecords: Array<Agent.AuditRecord> = [];
    await Effect.runPromiseExit(
      Agent.dispatch(durable.catalog)({
        tool: "deleteList",
        args: [],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.succeed(Agent.AuditLog, {
            record: (entry) =>
              entry.outcome === "audit-refused"
                ? Effect.sync(() => void durableRecords.push(entry))
                : Effect.fail({ _tag: "AuditSinkUnavailable" }),
          }),
        ),
      ),
    );
    expect(durableRecords).toHaveLength(1);
    expect(durable.ran()).toBe(0);

    // EXPLICIT proceed: honoured — an unoverridable default just gets
    // wrapped around by apps, which is strictly worse than a knob.
    const proceeding = makeAudited({ onFailure: "proceed" });
    const proceeded = await run(
      Agent.dispatch(proceeding.catalog)({
        tool: "deleteList",
        args: [],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.succeed(Agent.AuditLog, {
            record: () => Effect.fail({ _tag: "AuditSinkUnavailable" }),
          }),
        ),
        Effect.orDie,
      ),
    );
    expect(proceeded.ok).toBe(true);
    expect(proceeding.ran()).toBe(1);

    // NEGATIVE CONTROL: a healthy sink lets the same dispatch through and
    // records it exactly once with the success outcome.
    const healthy = makeAudited();
    const healthyRecords: Array<Agent.AuditRecord> = [];
    const ok = await run(
      Agent.dispatch(healthy.catalog)({
        tool: "deleteList",
        args: [],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.succeed(Agent.AuditLog, {
            record: (entry) => Effect.sync(() => void healthyRecords.push(entry)),
          }),
        ),
        Effect.orDie,
      ),
    );
    expect(ok.ok).toBe(true);
    expect(healthy.ran()).toBe(1);
    expect(healthyRecords).toHaveLength(1);
    expect(healthyRecords[0]!.outcome).toBe("success");

    // …and a non-mutating entry is unaffected by the audit-sink policy.
    const readOnly = Agent.audited(
      Agent.catalog({
        listLists: Agent.expose(
          Portable.code({
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
      Agent.dispatch(readOnly)({ tool: "listLists", args: [], buildId: BUILD }).pipe(
        Effect.provide(
          Layer.succeed(Agent.AuditLog, {
            record: () => Effect.fail({ _tag: "AuditSinkUnavailable" }),
          }),
        ),
        Effect.orDie,
      ),
    );
    expect(readResponse.ok).toBe(true);
  });

  it("DQ-084: mutation is declared by the constructor, not inferred from reactivityKeys", async () => {
    const mk = (id: string) =>
      Portable.code({
        id,
        buildId: BUILD,
        captures: Schema.Struct({}),
        run: () => Effect.succeed(1),
      });
    const shared = {
      args: Schema.Tuple([]),
      success: Schema.Number,
      // Both entries declare the SAME reactivity keys: if keys were the
      // signal, these two would be indistinguishable.
      reactivityKeys: ["lists"],
      access: { agent: true },
    };

    const c = Agent.audited(
      Agent.catalog({
        deleteList: Agent.exposeMutation(mk("list.delete"), {
          ...shared,
          description: "Delete a list",
        }),
        warmLists: Agent.expose(mk("list.warm"), {
          ...shared,
          description: "Warm the list cache",
        }),
      }),
    );

    // The declaration is inspectable, and it tracks the constructor.
    expect(Agent.isMutation(c, "deleteList")).toBe(true);
    expect(Agent.isMutation(c, "warmLists")).toBe(false);

    const records: Array<Agent.AuditRecord> = [];
    const sink = Layer.succeed(Agent.AuditLog, {
      record: (entry) => Effect.sync(() => void records.push(entry)),
    });

    const mutated = await run(
      Agent.dispatch(c)({ tool: "deleteList", args: [], buildId: BUILD }).pipe(
        Effect.provide(sink),
        Effect.orDie,
      ),
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.tool).toBe("deleteList");
    expect(records[0]!.mutation).toBe(true);

    // NEGATIVE CONTROL, the load-bearing half: the read-only sibling with
    // identical reactivityKeys is NOT audited as a mutation.
    records.length = 0;
    const read = await run(
      Agent.dispatch(c)({ tool: "warmLists", args: [], buildId: BUILD }).pipe(
        Effect.provide(sink),
        Effect.orDie,
      ),
    );
    expect(records.filter((entry) => entry.mutation)).toEqual([]);
    // …while both still invalidate: invalidation and mutation-ness are
    // orthogonal declarations.
    expect(payloadOf(read).invalidated).toEqual(["lists"]);
    expect(payloadOf(mutated).invalidated).toEqual(["lists"]);
  });

  it("DQ-085: a declared Agent.secret field is scrubbed; a suspiciously-named field is only diagnosed", async () => {
    const ran: Array<{ readonly host: string; readonly apiToken: string; readonly password: string }> = [];
    const Connect = Portable.code({
      id: "integration.connect",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (
        _c,
        input: { readonly host: string; readonly apiToken: string; readonly password: string },
      ) =>
        Effect.sync(() => {
          ran.push(input);
          return { connected: input.host };
        }),
    });

    const c = Agent.audited(
      Agent.catalog({
        // `apiToken` is DECLARED secret; `password` merely looks like one.
        connect: Agent.exposeMutation(Connect, {
          description: "Connect an integration",
          args: Schema.Tuple([
            Schema.Struct({
              host: Schema.String,
              apiToken: Agent.secret(Schema.String),
              password: Schema.String,
            }),
          ]),
          success: Schema.Struct({ connected: Schema.String }),
          access: { agent: true },
        }),
      }),
    );

    // The heuristic fires as a *diagnostic*, naming the undeclared field and
    // suggesting the structural fix — never for the declared one.
    const diagnostics = Agent.catalogDiagnostics(c);
    expect(diagnostics.map((d) => d.code)).toEqual(["agent:secret-name-suggests-redaction"]);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(JSON.stringify(diagnostics)).toContain("password");
    expect(JSON.stringify(diagnostics)).not.toContain("apiToken");

    const records: Array<Agent.AuditRecord> = [];
    const response = await run(
      Agent.dispatch(c)({
        tool: "connect",
        args: [
          { host: "api.example.com", apiToken: "sk-live-DECLARED", password: "hunter2" },
        ],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.succeed(Agent.AuditLog, {
            record: (entry) => Effect.sync(() => void records.push(entry)),
          }),
        ),
        Effect.orDie,
      ),
    );

    // Diagnostic, never enforcement: the call still dispatches, and `run`
    // sees both values.
    expect(response.ok).toBe(true);
    expect(ran).toHaveLength(1);
    expect(ran[0]!.password).toBe("hunter2");
    expect(ran[0]!.apiToken).toBe("sk-live-DECLARED");

    // Structural redaction is what actually scrubs the audit record…
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records[0])).not.toContain("sk-live-DECLARED");
    // …and the merely-suspicious field is NOT scrubbed, because names do not
    // enforce — this fails if someone "hardens" the heuristic into redaction.
    expect(allStrings(records[0]!.args)).toContain("hunter2");
    expect(allStrings(records[0]!.args)).toContain("api.example.com");

    // NEGATIVE CONTROL: a clean catalog produces no diagnostics. (The
    // original future-spec fixture declared an args tuple its code never
    // accepted — invisible under `any`, a compile error under the typed
    // expose; the code now honestly takes the struct.)
    const clean = Agent.catalog({
      ping: Agent.expose(
        Portable.code({
          id: "debug.ping",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: (_c, _input: { readonly host: string }) => Effect.succeed("pong"),
        }),
        {
          description: "Ping",
          args: Schema.Tuple([Schema.Struct({ host: Schema.String })]),
          success: Schema.String,
          access: { agent: true },
        },
      ),
    });
    expect(Agent.catalogDiagnostics(clean)).toEqual([]);
  });

  it("DQ-086: an unauthorized caller learns nothing — no schema, no description, no drift detail", async () => {
    let ran = 0;
    const c = Agent.catalog({
      readSalaries: Agent.expose(
        Portable.code({
          id: "hr.readSalaries",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: (_c, _department: string) => Effect.sync(() => ++ran),
        }),
        {
          description: "Read the confidential salary table for a department",
          args: Schema.Tuple([Schema.String]),
          success: Schema.Number,
          access: { agent: true },
        },
      ),
    });

    const denying = Layer.succeed(Agent.Authorizer, {
      authorize: (tool) =>
        Effect.fail(new Agent.AuthorizationDeniedError({ tool, reason: "not a member" })),
    });

    // Stale buildId AND unauthorized: authorization wins — it is outermost.
    const response = await run(
      Agent.dispatch(c)({
        tool: "readSalaries",
        args: ["eng"],
        buildId: "build-stale",
      }).pipe(Effect.provide(denying), Effect.orDie),
    );
    const refusal = refusalOf(response);
    expect(tagOf(refusal)).toBe("AuthorizationDeniedError");
    expect(ran).toBe(0);

    // Nothing disclosed: each string is one a later refusal stage would
    // legitimately have included.
    const leaked = JSON.stringify(response);
    expect(leaked).not.toContain("confidential salary table");
    expect(leaked).not.toContain("hr.readSalaries");
    expect(leaked).not.toContain(BUILD);
    expect(allStrings(refusal)).not.toContain("manifest");

    // NEGATIVE CONTROL: with authorization granted, exactly those
    // disclosures ARE available through the normal surfaces.
    const permitting = Layer.succeed(Agent.Authorizer, { authorize: () => Effect.void });
    const manifest = await run(Agent.toolManifest(c));
    expect(JSON.stringify(manifest)).toContain("confidential salary table");
    expect(manifest.tools[0]!.id).toBe("hr.readSalaries");

    const drift = await run(
      Agent.dispatch(c)({
        tool: "readSalaries",
        args: ["eng"],
        buildId: "build-stale",
      }).pipe(Effect.provide(permitting), Effect.orDie),
    );
    expect(tagOf(refusalOf(drift))).toBe("PortableBuildMismatchError");
    expect(ran).toBe(0);

    const ok = await run(
      Agent.dispatch(c)({ tool: "readSalaries", args: ["eng"], buildId: BUILD }).pipe(
        Effect.provide(permitting),
        Effect.orDie,
      ),
    );
    expect(ok.ok).toBe(true);
    expect(ran).toBe(1);
  });

  it("DQ-095: the approval store queues, resolves, and DENIES pending approvals on close — never drops", async () => {
    const runs: Array<string> = [];
    const c = Agent.catalog({
      save: Agent.exposeMutation(
        Portable.code({
          id: "gov.approval.save",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: () =>
            Effect.sync(() => {
              runs.push("save");
              return { ok: true };
            }),
        }),
        {
          description: "Save",
          args: Schema.Tuple([]),
          success: Schema.Struct({ ok: Schema.Boolean }),
          access: { agent: true, approval: "human" },
        },
      ),
    });

    // Phase 1: approve. Dispatch suspends on the queued approval; the queue
    // shows plain serializable data (the standard-query read); resolution
    // releases the mutation.
    const store = await run(Agent.makeApprovalStore());
    const dispatched = run(
      Agent.dispatch(c)({ tool: "save", args: [], buildId: BUILD }).pipe(
        Effect.provide(store.approvalLayer),
        Effect.orDie,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const queued = await run(store.pending());
    expect(queued).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(queued))).toEqual(queued);
    expect(queued[0]!.summary).toContain("save");
    expect(runs).toEqual([]);

    await run(store.resolve(queued[0]!.id, "approved").pipe(Effect.orDie));
    expect((await dispatched).ok).toBe(true);
    expect(runs).toEqual(["save"]);
    expect(await run(store.pending())).toEqual([]);

    // Phase 2: deny — a typed denial in the envelope, mutation never ran.
    const denyStore = await run(Agent.makeApprovalStore());
    const denied = run(
      Agent.dispatch(c)({ tool: "save", args: [], buildId: BUILD }).pipe(
        Effect.provide(denyStore.approvalLayer),
        Effect.orDie,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const denyQueue = await run(denyStore.pending());
    await run(denyStore.resolve(denyQueue[0]!.id, "denied").pipe(Effect.orDie));
    expect(tagOf(refusalOf(await denied))).toBe("ApprovalDeniedError");
    expect(runs).toEqual(["save"]);

    // Phase 3: THE RESTART CONTRACT. Closing the store (its lifetime ending
    // is the restart, observably) resolves every pending approval as a typed
    // denial — the agent gets an answer, never a hang, and nothing runs.
    const dyingStore = await run(Agent.makeApprovalStore());
    const orphaned = run(
      Agent.dispatch(c)({ tool: "save", args: [], buildId: BUILD }).pipe(
        Effect.provide(dyingStore.approvalLayer),
        Effect.orDie,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await run(dyingStore.pending())).toHaveLength(1);
    await run(dyingStore.close());
    expect(tagOf(refusalOf(await orphaned))).toBe("ApprovalDeniedError");
    expect(runs).toEqual(["save"]);
    expect(await run(dyingStore.pending())).toEqual([]);

    // A closed store fails NEW requests closed too.
    const late = await run(
      Agent.dispatch(c)({ tool: "save", args: [], buildId: BUILD }).pipe(
        Effect.provide(dyingStore.approvalLayer),
        Effect.orDie,
      ),
    );
    expect(tagOf(refusalOf(late))).toBe("ApprovalDeniedError");
    expect(runs).toEqual(["save"]);

    // Unknown-id resolution is a typed failure, not a silent no-op.
    const missing = await runFail(store.resolve("a999", "approved"));
    expect(tagOf(missing)).toBe("ApprovalNotFoundError");
  });
});
