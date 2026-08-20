/**
 * Authorization — an unauthorized caller learns **nothing**. Promoted from
 * `future/security/authorization.spec.ts` once every spec passed.
 *
 * Route guards gate the SERVER doors upstream of the loader (R3's server
 * half): a denied request runs no loader, serializes no payload, streams no
 * deferred script, and reports a non-200 status. Agent dispatch keeps the
 * `DQ-086` ordering (authorize → drift → approve, authorization outermost)
 * and the `DQ-083` audit write-ahead policy.
 */
import { Cause, Effect, Exit, Layer, Option, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import * as Agent from "../Agent.js";
import * as Component from "../Component.js";
import { template } from "../dom.js";
import * as Portable from "../Portable.js";
import * as Route from "../Route.js";

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

/** Typed-failure classifier: a boundary rejection is never a defect. */
function classifiedTag(exit: Exit.Exit<unknown, unknown>): string {
  if (!Exit.isFailure(exit)) return "success";
  expect(
    Cause.hasDies(exit.cause),
    "a boundary rejection must be a typed error, not a defect",
  ).toBe(false);
  return Cause.findErrorOption(exit.cause).pipe(
    Option.map((error) => (error as { readonly _tag?: string })._tag ?? "untagged"),
    Option.getOrElse(() => "none"),
  );
}

describe("[SEC/R3] route guards gate the server doors", () => {
  /** A guard that fails, and a counter proving whether the loader ever ran. */
  function fixture() {
    const loaderRuns: Array<string> = [];
    const guardRuns: Array<string> = [];
    return {
      loaderRuns,
      guardRuns,
      denied: Effect.suspend(() => {
        guardRuns.push("denied");
        return Effect.fail({ _tag: "Unauthorized" as const });
      }),
      allowed: Effect.suspend(() => {
        guardRuns.push("allowed");
        return Effect.succeed("session");
      }),
      loader: (label: string) =>
        Effect.sync(() => {
          loaderRuns.push(label);
          return { secret: "tenant-data" };
        }),
    };
  }

  const Admin = Component.make(
    Component.props<{}>(),
    Component.require<never>(),
    Component.setup<{}>(),
    () => template("<span>")(),
  );

  it("blocks the loader from running at all when a guard fails, and runs it exactly once when the guard passes", async () => {
    // The assertion is deliberately *not* "navigation was blocked". A guard
    // that only gates rendering still lets the loader run, which means the
    // query executed, the row was read, and — with a deferred loader — the
    // payload was serialized into the page before anyone checked whether the
    // caller was allowed to see it. Blocking happens upstream of the loader,
    // so `loaderRuns` is the observable.
    const deniedFixture = fixture();
    const deniedApp = Route.define(
      Route.page("/admin", Admin).pipe(
        Route.id("admin"),
        Route.loader(() => deniedFixture.loader("admin")),
        Route.guard(deniedFixture.denied),
      ),
    );

    const denied = await run(
      Route.renderRequest(deniedApp, {
        request: new Request("https://example.test/admin"),
      }),
    );
    // The guard was consulted exactly once, and the loader never ran.
    expect(deniedFixture.guardRuns).toEqual(["denied"]);
    expect(deniedFixture.loaderRuns).toEqual([]);
    // The denial is visible to the host as a status, not only as an absence.
    expect(denied.status).toBe(403);

    // NEGATIVE CONTROL. The identical route with a passing guard runs the
    // loader exactly once — so an implementation that simply never runs
    // loaders, or never runs guarded routes at all, cannot satisfy this.
    const allowedFixture = fixture();
    const allowedApp = Route.define(
      Route.page("/admin", Admin).pipe(
        Route.id("admin"),
        Route.loader(() => allowedFixture.loader("admin")),
        Route.guard(allowedFixture.allowed),
      ),
    );
    const allowed = await run(
      Route.renderRequest(allowedApp, {
        request: new Request("https://example.test/admin"),
      }),
    );
    expect(allowedFixture.guardRuns).toEqual(["allowed"]);
    expect(allowedFixture.loaderRuns).toEqual(["admin"]);
    expect(allowed.status).toBe(200);
  });

  it("does not leak the protected route's loader payload into the rendered response", async () => {
    // The second half of "learns nothing": even a correctly-blocked route must
    // not ship its serialized loader payload to the client. A guard that runs
    // but leaves `loaderPayload` populated has denied the render and disclosed
    // the data anyway.
    const app = Route.define(
      Route.page("/admin", Admin).pipe(
        Route.id("admin"),
        Route.loader(() => Effect.succeed({ ssn: "000-00-0000" })),
        Route.guard(Effect.fail({ _tag: "Unauthorized" as const })),
      ),
    );
    const response = await run(
      Route.renderRequest(app, { request: new Request("https://example.test/admin") }),
    );
    const serialized = JSON.stringify(response.loaderPayload) + response.html;
    expect(serialized).not.toContain("000-00-0000");
    expect(response.status).not.toBe(200);
  });

  it("keeps a denied loader out of the streamed deferred payload", async () => {
    // Deferred loaders serialize into `<script>` tags appended after the shell
    // has already been flushed, which means an authorization failure that
    // arrives late still has a channel to the client. The guarantee: a loader
    // that failed authorization contributes no deferred script.
    const denied = Route.define(
      Route.page("/admin", Admin).pipe(
        Route.id("admin"),
        Route.loader(() => Effect.succeed({ ssn: "111-11-1111" }), {
          priority: "deferred",
        }),
        Route.guard(Effect.fail({ _tag: "Unauthorized" as const })),
      ),
    );
    const deniedResult = await run(
      Route.runStreamingNavigation(denied, new URL("https://example.test/admin")),
    );
    expect(deniedResult.deferredScripts.join("")).not.toContain("111-11-1111");

    // NEGATIVE CONTROL: the same route with a passing guard *does* stream its
    // deferred payload, so this is not satisfied by disabling streaming.
    const allowed = Route.define(
      Route.page("/admin", Admin).pipe(
        Route.id("admin"),
        Route.loader(() => Effect.succeed({ ssn: "111-11-1111" }), {
          priority: "deferred",
        }),
        Route.guard(Effect.succeed("session")),
      ),
    );
    const allowedResult = await run(
      Route.runStreamingNavigation(allowed, new URL("https://example.test/admin")),
    );
    expect(allowedResult.deferredScripts.join("")).toContain("111-11-1111");
  });
});

describe("[SEC/R3] the guard contract holds on every tier and door", () => {
  // The defect family this describe block exists to catch: an authorization
  // API that is honoured on one authoring tier or one door and silently inert
  // on another ("true on one path only"). Every test pairs a denial with a
  // passing negative control, so "refuses everything" cannot pass either.
  function fixture() {
    const loaderRuns: Array<string> = [];
    return {
      loaderRuns,
      denied: Effect.fail({ _tag: "Unauthorized" as const }),
      loader: (label: string) =>
        Effect.sync(() => {
          loaderRuns.push(label);
          return { secret: `${label}-data` };
        }),
    };
  }

  const Page = () =>
    Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>(),
      () => template("<span>")(),
    );

  it("a guard stamped on the COMPONENT (legacy tier) gates the server render", async () => {
    // `Route.guard(check)(component)` writes `__routeGuards` on the component
    // itself — the third authoring tier beside unified routes and node pipes.
    const denied = fixture();
    const DeniedComponent = Route.guard(denied.denied)(Page());
    const deniedApp = Route.define(
      Route.page("/admin", DeniedComponent).pipe(
        Route.id("admin"),
        Route.loader(() => denied.loader("admin")),
      ),
    );
    const deniedResponse = await run(
      Route.renderRequest(deniedApp, {
        request: new Request("https://example.test/admin"),
      }),
    );
    expect(denied.loaderRuns).toEqual([]);
    expect(deniedResponse.status).toBe(403);

    const allowed = fixture();
    const AllowedComponent = Route.guard(Effect.succeed("session"))(Page());
    const allowedApp = Route.define(
      Route.page("/admin", AllowedComponent).pipe(
        Route.id("admin"),
        Route.loader(() => allowed.loader("admin")),
      ),
    );
    const allowedResponse = await run(
      Route.renderRequest(allowedApp, {
        request: new Request("https://example.test/admin"),
      }),
    );
    expect(allowed.loaderRuns).toEqual(["admin"]);
    expect(allowedResponse.status).toBe(200);
  });

  it("guard position in the pipe does not matter", async () => {
    // Guard-before-loader and guard-after-loader must behave identically —
    // an implementation that reads decorations positionally would pass one
    // ordering and silently drop the other.
    for (const guardFirst of [true, false]) {
      const denied = fixture();
      const decorations = guardFirst
        ? [Route.guard(denied.denied), Route.loader(() => denied.loader("admin"))]
        : [Route.loader(() => denied.loader("admin")), Route.guard(denied.denied)];
      const app = Route.define(
        (Route.page("/admin", Page()) as Route.AppRouteNode<any, any, any, any, any, any>)
          .pipe(...(decorations as [never, never])),
      );
      const response = await run(
        Route.renderRequest(app, {
          request: new Request("https://example.test/admin"),
        }),
      );
      expect(denied.loaderRuns, `guardFirst=${String(guardFirst)}`).toEqual([]);
      expect(response.status, `guardFirst=${String(guardFirst)}`).toBe(403);
    }
  });

  it("a parent layout's guard gates the CHILD route's loader (parents-first)", async () => {
    // A guard belongs to its route AND its subtree: protecting the layout
    // must protect every child page, or "wrap the admin section in a guard"
    // silently protects only the layout's own (usually loader-less) route.
    const denied = fixture();
    const deniedApp = Route.define(
      Route.mount(
        Route.layout(Page()).pipe(Route.guard(denied.denied)),
        [
          Route.page("/admin", Page()).pipe(
            Route.id("admin"),
            Route.loader(() => denied.loader("admin")),
          ),
        ],
      ),
    );
    const deniedResponse = await run(
      Route.renderRequest(deniedApp, {
        request: new Request("https://example.test/admin"),
      }),
    );
    expect(denied.loaderRuns).toEqual([]);
    expect(deniedResponse.status).toBe(403);

    const allowed = fixture();
    const allowedApp = Route.define(
      Route.mount(
        Route.layout(Page()).pipe(Route.guard(Effect.succeed("session"))),
        [
          Route.page("/admin", Page()).pipe(
            Route.id("admin"),
            Route.loader(() => allowed.loader("admin")),
          ),
        ],
      ),
    );
    await run(
      Route.renderRequest(allowedApp, {
        request: new Request("https://example.test/admin"),
      }),
    );
    expect(allowed.loaderRuns).toEqual(["admin"]);
  });

  it("the streaming render door is gated too, and ships no denied handoff data", async () => {
    // `renderRequestStream` flushes the shell before loaders settle — the
    // exact shape where a late authorization failure still has a channel to
    // the client (the loader-handoff chunk).
    const denied = fixture();
    const deniedApp = Route.define(
      Route.page("/admin", Page()).pipe(
        Route.id("admin"),
        Route.loader(() => denied.loader("admin")),
        Route.guard(denied.denied),
      ),
    );
    const deniedChunks = await run(
      Stream.runCollect(
        Route.renderRequestStream(deniedApp, {
          request: new Request("https://example.test/admin"),
        }),
      ),
    );
    const deniedHtml = [...deniedChunks].join("");
    expect(denied.loaderRuns).toEqual([]);
    expect(deniedHtml).not.toContain("admin-data");

    // NEGATIVE CONTROL: the allowed stream runs the loader and hands it off.
    const allowed = fixture();
    const allowedApp = Route.define(
      Route.page("/admin", Page()).pipe(
        Route.id("admin"),
        Route.loader(() => allowed.loader("admin")),
        Route.guard(Effect.succeed("session")),
      ),
    );
    const allowedChunks = await run(
      Stream.runCollect(
        Route.renderRequestStream(allowedApp, {
          request: new Request("https://example.test/admin"),
        }),
      ),
    );
    expect(allowed.loaderRuns).toEqual(["admin"]);
    expect([...allowedChunks].join("")).toContain("admin-data");
  });

  it("a single-flight mutation payload carries no revalidated loader data past a failing guard", async () => {
    // The mutation response is a server door like any other: `revalidate:
    // "matched"` re-runs the target URL's loaders and ships them back in the
    // payload — which must not become a side channel around route guards.
    const routerStub = (url: string) => Route.Server({ url });

    const denied = fixture();
    const deniedApp = Route.define(
      Route.page("/admin", Page()).pipe(
        Route.id("admin"),
        Route.loader(() => denied.loader("admin")),
        Route.guard(denied.denied),
      ),
    );
    const deniedAction = await run(
      Route.actionSingleFlight(() => Effect.succeed({ saved: true }), {
        revalidate: "matched",
        app: deniedApp,
      }),
    );
    const deniedPayload = await run(
      deniedAction().pipe(
        Effect.provide(routerStub("https://example.test/admin")),
        Effect.orDie,
      ),
    );
    expect(deniedPayload.mutation).toEqual({ saved: true });
    expect(deniedPayload.loaders).toEqual([]);
    expect(denied.loaderRuns).toEqual([]);

    // NEGATIVE CONTROL: with a passing guard the same mutation revalidates
    // and ships the matched loader snapshot.
    const allowed = fixture();
    const allowedApp = Route.define(
      Route.page("/admin", Page()).pipe(
        Route.id("admin"),
        Route.loader(() => allowed.loader("admin")),
        Route.guard(Effect.succeed("session")),
      ),
    );
    const allowedAction = await run(
      Route.actionSingleFlight(() => Effect.succeed({ saved: true }), {
        revalidate: "matched",
        app: allowedApp,
      }),
    );
    const allowedPayload = await run(
      allowedAction().pipe(
        Effect.provide(routerStub("https://example.test/admin")),
        Effect.orDie,
      ),
    );
    expect(allowed.loaderRuns).toEqual(["admin"]);
    expect(allowedPayload.loaders.map((entry) => entry.routeId)).toEqual(["admin"]);
  });
});

describe("[SEC/DQ-086] dispatch ordering and disclosure", () => {
  const BUILD = "sec-dq086-build";

  const makeAuditedCatalog = () => {
    const runs: Array<string> = [];
    const catalog = Agent.audited(
      Agent.catalog({
        deleteEverything: Agent.exposeMutation(
          Portable.code({
            id: "danger.deleteEverything",
            buildId: BUILD,
            captures: Schema.Struct({}),
            run: () =>
              Effect.sync(() => {
                runs.push("deleteEverything");
                return { deleted: true };
              }),
          }),
          {
            description: "SECRET-DESCRIPTION delete every tenant row",
            args: Schema.Tuple([]),
            success: Schema.Struct({ deleted: Schema.Boolean }),
            access: { agent: true },
          },
        ),
      }),
    );
    return { catalog, runs };
  };

  it("authorizes before anything is disclosed, and audits every denial", async () => {
    // `DQ-086`: authorize → drift → approve, authorization outermost. The
    // observable form: the denial carries no action name, schema, or drift
    // manifest; a drifted call from an unauthorized caller produces the
    // identical denial as an undrifted one (otherwise drift is an oracle);
    // and every denial is audited exactly once.
    const { catalog, runs } = makeAuditedCatalog();

    const records: Array<Agent.AuditRecord> = [];
    const denyEveryone = Layer.mergeAll(
      Layer.succeed(Agent.Authorizer, {
        authorize: () => Effect.fail({ _tag: "Denied" as const }),
      }),
      Layer.succeed(Agent.AuditLog, {
        record: (entry) => Effect.sync(() => void records.push(entry)),
      }),
      Layer.succeed(Agent.CallerContext, {
        caller: "agent",
        user: { _tag: "None" },
        lineage: { _tag: "None" },
      }),
    );

    const dispatchWith = (buildId: string) =>
      run(
        Agent.dispatch(catalog)({
          tool: "deleteEverything",
          args: [],
          buildId,
        }).pipe(Effect.provide(denyEveryone), Effect.orDie),
      );

    const undrifted = await dispatchWith(BUILD);
    const drifted = await dispatchWith("some-stale-build");

    expect(undrifted.ok).toBe(false);
    expect(drifted.ok).toBe(false);
    for (const denial of [undrifted, drifted]) {
      const serialized = JSON.stringify(denial);
      expect(serialized).not.toContain("SECRET-DESCRIPTION");
      expect(serialized).not.toContain("danger.deleteEverything");
      expect(serialized).not.toContain("manifest");
      expect(serialized).not.toContain("inputSchema");
    }
    // Drift is not an oracle: the two denials are byte-identical.
    expect(JSON.stringify(drifted)).toBe(JSON.stringify(undrifted));

    // The action never ran, and each denial was audited exactly once.
    expect(runs).toEqual([]);
    expect(records).toHaveLength(2);
    expect(records.every((entry) => entry.outcome === "denied")).toBe(true);

    // NEGATIVE CONTROL: an authorized, undrifted call runs and succeeds.
    const allowed = await run(
      Agent.dispatch(catalog)({
        tool: "deleteEverything",
        args: [],
        buildId: BUILD,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Agent.Authorizer, { authorize: () => Effect.void }),
            Layer.succeed(Agent.AuditLog, { record: () => Effect.void }),
          ),
        ),
        Effect.orDie,
      ),
    );
    expect(allowed.ok).toBe(true);
    expect(runs).toEqual(["deleteEverything"]);
  });

  it("refuses the call when the audit sink fails, and proceeds only on explicit policy", async () => {
    // `DQ-083`: audit `onFailure` defaults to REFUSE — write-ahead, then run,
    // and the refusal record is itself written. With the default policy and a
    // failing sink the mutation body must NOT have executed; with an explicit
    // `"proceed"` policy it must.
    const makeCatalog = (onFailure?: "refuse" | "proceed") => {
      const runs: Array<string> = [];
      const catalog = Agent.audited(
        Agent.catalog({
          save: Agent.exposeMutation(
            Portable.code({
              id: "sec.save",
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
              access: { agent: true },
            },
          ),
        }),
        onFailure === undefined ? undefined : { onFailure },
      );
      return { catalog, runs };
    };

    const attempts: Array<Agent.AuditRecord> = [];
    const failingSink = Layer.succeed(Agent.AuditLog, {
      record: (entry) =>
        Effect.suspend(() => {
          attempts.push(entry);
          return Effect.fail({ _tag: "SinkDown" as const });
        }),
    });

    const refused = makeCatalog();
    const refusedExit = await Effect.runPromiseExit(
      Agent.dispatch(refused.catalog)({
        tool: "save",
        args: [],
        buildId: BUILD,
      }).pipe(Effect.provide(failingSink)),
    );
    expect(classifiedTag(refusedExit)).toBe("SinkDown");
    expect(refused.runs).toEqual([]);
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts.some((entry) => entry.outcome === "audit-refused")).toBe(true);

    const proceeding = makeCatalog("proceed");
    const proceeded = await run(
      Agent.dispatch(proceeding.catalog)({
        tool: "save",
        args: [],
        buildId: BUILD,
      }).pipe(Effect.provide(failingSink), Effect.orDie),
    );
    expect(proceeded.ok).toBe(true);
    expect(proceeding.runs).toEqual(["save"]);
  });
});
