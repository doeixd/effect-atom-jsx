/**
 * Authorization — an unauthorized caller learns **nothing**.
 *
 * Not "is denied": *learns nothing*. Not a schema, not a tool description, not
 * the name of a mutation, not whether a build drift occurred, not whether an
 * approval would have been required. `DQ-086` moved authorization outermost for
 * exactly this reason: the ratified order is **authorize → drift → approve**.
 *
 * The motivating accident: `Route.guard(requireSession)(AdminRoute)`
 * type-checks, composes, and gates nothing. The guard array is written by
 * `Route.guard` and read by nobody on the unified-route path — an auth bypass
 * that was filed as an authoring-tier question because it lived between lanes.
 *
 * Owning plans: `AGENT_NATIVE_NOTES.md` §10 (`DQ-083`, `DQ-086`),
 * `ROUTER_CONSOLIDATION_PLAN.md` R3 (authoring tiers).
 */

import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, unbuilt } from "../harness.js";
import { classifiedTag, runPromise, runPromiseExit } from "./support.js";

describe("[SEC/R3] Route guards", () => {
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

  it("blocks the loader from running at all when a guard fails, and runs it when the guard passes", async () => {
    // CURRENTLY RED. `Route.guard` stores the check on
    // `component[UnifiedRouteSymbol].guards` (and `__routeGuards` on the legacy
    // path), and `src/router-runtime.ts` never reads either. So the guard is
    // inert for unified routes.
    //
    // The assertion is deliberately *not* "navigation was blocked". A guard
    // that only gates rendering still lets the loader run, which means the
    // query executed, the row was read, and — with a deferred/streamed loader —
    // the payload was serialized into the page before anyone checked whether
    // the caller was allowed to see it. Blocking must happen upstream of the
    // loader, so `loaderRuns` is the observable.
    const Route = await fromSrc(
      "Route",
      "page",
      "define",
      "id",
      "loader",
      "guard",
      "renderRequest",
    );
    const Component = await fromSrc("Component", "make", "props", "require", "setup");
    const dom = await fromSrc("dom", "template");

    const Admin = Component.make(
      Component.props(),
      Component.require(),
      Component.setup(),
      () => dom.template("<span>")(),
    );

    const deniedFixture = fixture();
    const deniedApp = Route.define(
      Route.page("/admin", Admin).pipe(
        Route.id("admin"),
        Route.loader(() => deniedFixture.loader("admin")),
        Route.guard(deniedFixture.denied),
      ),
    );

    await runPromise(
      Route.renderRequest(deniedApp, {
        request: new Request("https://example.test/admin"),
      }),
    );
    // The guard must have been consulted…
    expect(deniedFixture.guardRuns).toEqual(["denied"]);
    // …and the protected loader must never have run.
    expect(deniedFixture.loaderRuns).toEqual([]);

    // NEGATIVE CONTROL. The identical route with a passing guard runs the
    // loader exactly once — so an implementation that simply never runs
    // loaders, or never runs guarded routes at all, cannot satisfy this spec.
    const allowedFixture = fixture();
    const allowedApp = Route.define(
      Route.page("/admin", Admin).pipe(
        Route.id("admin"),
        Route.loader(() => allowedFixture.loader("admin")),
        Route.guard(allowedFixture.allowed),
      ),
    );
    await runPromise(
      Route.renderRequest(allowedApp, {
        request: new Request("https://example.test/admin"),
      }),
    );
    expect(allowedFixture.guardRuns).toEqual(["allowed"]);
    expect(allowedFixture.loaderRuns).toEqual(["admin"]);
  });

  it("does not leak the protected route's loader payload into the rendered response", async () => {
    // The second half of "learns nothing": even a correctly-blocked route must
    // not ship its serialized loader payload to the client. A guard that runs
    // but leaves `loaderPayload` populated has denied the render and disclosed
    // the data anyway.
    const Route = await fromSrc(
      "Route",
      "page",
      "define",
      "id",
      "loader",
      "guard",
      "renderRequest",
    );
    const Component = await fromSrc("Component", "make", "props", "require", "setup");
    const dom = await fromSrc("dom", "template");
    const Admin = Component.make(
      Component.props(),
      Component.require(),
      Component.setup(),
      () => dom.template("<span>")(),
    );
    const app = Route.define(
      Route.page("/admin", Admin).pipe(
        Route.id("admin"),
        Route.loader(() => Effect.succeed({ ssn: "000-00-0000" })),
        Route.guard(Effect.fail({ _tag: "Unauthorized" as const })),
      ),
    );
    const response = await runPromise(
      Route.renderRequest(app, { request: new Request("https://example.test/admin") }),
    );
    const serialized = JSON.stringify(response.loaderPayload) + response.html;
    expect(serialized).not.toContain("000-00-0000");
    // And the denial is visible to the host as a status, not only as an absence.
    expect(response.status).not.toBe(200);
  });

});

describe("[SEC/DQ-086] Dispatch ordering and disclosure", () => {
  it("authorizes before anything is disclosed, and audits every denial", async () => {
    // `DQ-086`: authorize → drift → approve, with authorization outermost so
    // that an unauthorized caller cannot learn a schema, a tool description, or
    // whether a build drift occurred. The observable form of that guarantee:
    //
    //   - the denial error carries no action name, schema, or drift manifest;
    //   - a *drifted* call from an unauthorized caller produces the identical
    //     denial as an undrifted one (otherwise drift is an oracle);
    //   - the audit record exists for the denial, exactly once.
    //
    // The catalog and dispatcher do not exist in `src/` yet and their export
    // names are provisional under `DQ-096`, so pinning a call shape here would
    // be an unratified design decision.
    unbuilt("Agent dispatcher authorize→drift→approve ordering", "DQ-096");
  });

  it("refuses the call when the audit sink fails", async () => {
    // `DQ-083`: layer-level `onFailure` policy defaulting to **refuse**, with
    // the refusal record itself durable (write-ahead, then run). The two halves
    // that make this a real check rather than a slogan: with a failing sink and
    // the default policy the mutation body must *not* have executed (a counter,
    // not a return value), and with an explicit `"proceed"` policy it must —
    // otherwise "always refuse" satisfies the spec forever.
    unbuilt("Agent audit-sink onFailure policy", "DQ-096");
  });
});

describe("[SEC/R5] Server-side authorization surface", () => {
  it("keeps a denied loader out of the streamed deferred payload", async () => {
    // Deferred loaders serialize into `<script>` tags appended after the shell
    // has already been flushed, which means an authorization failure that
    // arrives late still has a channel to the client. The guarantee: a loader
    // that failed authorization contributes no deferred script.
    const Route = await fromSrc(
      "Route",
      "runStreamingNavigation",
      "page",
      "define",
      "id",
      "loader",
      "guard",
    );
    const Component = await fromSrc("Component", "make", "props", "require", "setup");
    const dom = await fromSrc("dom", "template");
    const Page = Component.make(
      Component.props(),
      Component.require(),
      Component.setup(),
      () => dom.template("<span>")(),
    );

    const denied = Route.define(
      Route.page("/admin", Page).pipe(
        Route.id("admin"),
        Route.loader(() => Effect.succeed({ ssn: "111-11-1111" }), { priority: "deferred" }),
        Route.guard(Effect.fail({ _tag: "Unauthorized" as const })),
      ),
    );
    const deniedExit = await runPromiseExit(
      Route.runStreamingNavigation(denied, new URL("https://example.test/admin")),
    );
    expect(classifiedTag(deniedExit)).toBe("success");
    const deniedScripts = Exit.isSuccess(deniedExit)
      ? deniedExit.value.deferredScripts.join("")
      : "";
    expect(deniedScripts).not.toContain("111-11-1111");

    // NEGATIVE CONTROL: the same route with a passing guard *does* stream its
    // deferred payload, so this is not satisfied by disabling streaming.
    const allowed = Route.define(
      Route.page("/admin", Page).pipe(
        Route.id("admin"),
        Route.loader(() => Effect.succeed({ ssn: "111-11-1111" }), { priority: "deferred" }),
        Route.guard(Effect.succeed("session")),
      ),
    );
    const allowedExit = await runPromiseExit(
      Route.runStreamingNavigation(allowed, new URL("https://example.test/admin")),
    );
    expect(classifiedTag(allowedExit)).toBe("success");
    const allowedScripts = Exit.isSuccess(allowedExit)
      ? allowedExit.value.deferredScripts.join("")
      : "";
    expect(allowedScripts).toContain("111-11-1111");
  });
});
