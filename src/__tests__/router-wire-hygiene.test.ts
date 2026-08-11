/**
 * R5 — wire and error hygiene. Promoted from
 * `future/router/wire-and-errors.spec.ts` (all green 2026-08-11) and retyped:
 * no `any`, no assertion casts — where the original spec needed one, either
 * the API was fixed to infer (de-genericized transport service, tagged error
 * classes, `runCachedLoader`'s timeout error in its type) or the assertion
 * narrows through type guards.
 *
 * One encoding for loader `Result`s across SSR and single-flight, validated
 * through `Serialization` with declared schemas; tagged error classes instead
 * of untagged literals; malformed input as a typed failure rather than a
 * defect; one transport-resolution order with no process-global transport; one
 * path-matching engine shared by `Route` and `ServerRoute`.
 *
 * Owner: docs/ROUTER_CONSOLIDATION_PLAN.md § R5.
 */
import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as AtomModule from "../Atom.js";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as RouteModule from "../Route.js";
import * as Serialization from "../Serialization.js";
import * as ServerRoute from "../ServerRoute.js";
import {
  LoaderCacheTag,
  RouteLoaderTimeoutError,
  clearLoaderCache,
  getLoaderCacheEntry,
  makeLoaderCacheStore,
  runCachedLoader,
} from "../router-runtime.js";
import { SingleFlightTransportTag } from "../SingleFlightTransport.js";
import { type Result as CoreResultType } from "../effect-ts.js";

/** The settled success value of a cached loader result, if any. */
function successValue(
  result: CoreResultType<unknown, unknown> | undefined,
): unknown {
  return result !== undefined && result._tag === "Success"
    ? result.value
    : undefined;
}

/** Read one field off an unknown object without a cast. */
function fieldOf(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

/** The `_tag` of an unknown tagged value, if it carries one. */
function tagOf(value: unknown): string | undefined {
  const tag = fieldOf(value, "_tag");
  return tag === undefined ? undefined : String(tag);
}

/** The failure value of an exit, or `undefined`. */
function failureOf<A, E>(exit: Exit.Exit<A, E>): E | undefined {
  if (!Exit.isFailure(exit)) return undefined;
  return Option.getOrUndefined(Cause.findErrorOption(exit.cause));
}

describe("R5 — wire hygiene", () => {
  it("[R5.1] single-flight loader data uses the same encoding as SSR, so non-JSON values survive", async () => {
    const routeId = "/r5-wire/:id";
    const Page = Route.loader((params: { readonly id: string }) =>
      Effect.succeed({ at: new Date(0), id: params.id })
    )(
      Route.path(routeId)(Component.from(() => null)),
    );

    const handler = Route.singleFlight((id: string) => Effect.succeed({ ok: id }), {
      app: Page,
      revalidate: "none",
      setLoaders: () => [Route.setLoaderData(routeId, { at: new Date(5), id: "alice" })],
      baseUrl: "http://localhost",
    });

    const response = await Effect.runPromise(
      handler({ args: ["alice"], url: "/r5-wire/alice" }),
    );
    // Cross the boundary the way a real transport does.
    const overTheWire: unknown = JSON.parse(JSON.stringify(response));

    // ISOLATION: scoped to this spec's own route id, never a process-wide wipe.
    clearLoaderCache(routeId);
    await Effect.runPromise(
      Route.invokeSingleFlight("/api/r5-wire", { args: ["alice"], url: "/r5-wire/alice" }, {
        app: Page,
        fetch: async () => ({ json: async () => overTheWire }),
      }).pipe(Effect.provide(Serialization.layer)),
    );

    const cached = getLoaderCacheEntry(routeId, { id: "alice" });
    expect(cached).toBeDefined();
    const data = successValue(cached?.result);
    // A single declared wire projection means a Date arrives as a Date, exactly
    // as it does through the SSR loader payload.
    const at = fieldOf(data, "at");
    expect(at).toBeInstanceOf(Date);
    if (at instanceof Date) expect(at.getTime()).toBe(5);
  });

  it("[R5.1] a malformed single-flight response is a typed decode failure and hydrates nothing", async () => {
    const routeId = "/r5-bad/:id";
    const Page = Route.loader((params: { readonly id: string }) =>
      Effect.succeed({ id: params.id })
    )(
      Route.path(routeId)(Component.from(() => null)),
    );

    const invoke = (payload: unknown) =>
      Effect.runPromiseExit(
        Route.invokeSingleFlight("/api/r5-bad", { args: ["alice"], url: "/r5-bad/alice" }, {
          app: Page,
          fetch: async () => ({ json: async () => payload }),
        }).pipe(Effect.provide(Serialization.layer)),
      );

    // ISOLATION: scoped to this spec's own route id, never a process-wide wipe.
    clearLoaderCache(routeId);
    // No `url`, no `loaders`: structurally invalid payload.
    const exit = await invoke({ ok: true, payload: { mutation: 1 } });

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    // Fails closed as a *typed failure*, not a defect from `new URL(undefined)`.
    // The absence of a defect is the load-bearing half: "it threw somewhere" is
    // not the same guarantee as "it was rejected at the trust boundary".
    expect(Cause.hasDies(exit.cause)).toBe(false);
    const failure = failureOf(exit);
    expect(failure).toBeDefined();
    const decodeTag = failure?._tag;
    expect(decodeTag).toBe("SingleFlightDecodeError");
    expect(getLoaderCacheEntry(routeId, { id: "alice" })).toBeUndefined();

    // A malformed *payload* and a failed *transport* are near neighbours from the
    // caller's seat but demand different remedies (deploy skew vs retry), so the
    // codes must differ.
    const transportExit = await Effect.runPromiseExit(
      Route.invokeSingleFlight("/api/r5-bad", { args: [], url: "/" }, {
        hydrate: false,
        fetch: async () => {
          throw new Error("network down");
        },
      }),
    );
    const transportTag = failureOf(transportExit)?._tag;
    expect(transportTag).toBe("SingleFlightInvokeError");
    expect(decodeTag).not.toBe(transportTag);

    // NEGATIVE CONTROL. Without this, an `invokeSingleFlight` that rejects every
    // response — or is unimplemented — satisfies everything above forever. A
    // structurally *complete* envelope must be accepted. Only the envelope is
    // pinned here (`url` + `loaders` present); the loader-entry wire shape is
    // covered by the R5.1 spec above, so this control does not re-pin it.
    // ISOLATION: scoped to this spec's own route id, never a process-wide wipe.
    clearLoaderCache(routeId);
    const ok = await invoke({
      ok: true,
      payload: { mutation: 1, url: "http://localhost/r5-bad/alice", loaders: [] },
    });
    expect(Exit.isSuccess(ok)).toBe(true);
  });

  it("[R5.2] single-flight invocation errors are tagged error classes, not object literals", async () => {
    const exit = await Effect.runPromiseExit(
      Route.invokeSingleFlight("/api/r5-boom", { args: [], url: "/" }, {
        hydrate: false,
        fetch: async () => {
          throw new Error("network down");
        },
      }),
    );

    const error = failureOf(exit);
    expect(error).toBeDefined();
    expect(error?._tag).toBe("SingleFlightInvokeError");
    // A `Schema.TaggedErrorClass` instance, matching the resumability layer's
    // discipline: a real Error with a stack, not a bare literal.
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? typeof error.stack : undefined).toBe("string");
  });

  it("[R5.2] a malformed server-route body is a typed failure, never a defect", async () => {
    const route = ServerRoute.json({ key: "r5-body" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path("/r5-body"),
      ServerRoute.body(Schema.Struct({ name: Schema.String })),
      ServerRoute.handle(({ body }) => Effect.succeed({ ok: body.name })),
    );

    const post = (body: unknown) =>
      Effect.runPromiseExit(
        ServerRoute.execute(route, new Request("http://test.local/r5-body", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })),
      );

    const exit = await post({ name: 42 });

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    // No defect anywhere in the cause: decoding is a typed boundary failure.
    expect(Cause.hasDies(exit.cause)).toBe(false);
    const failure = failureOf(exit);
    expect(failure).toBeDefined();
    expect(String(tagOf(failure))).toMatch(/Decode|Schema/);

    // NEGATIVE CONTROL. Without this, a handler that rejects every body — or a
    // `body(...)` combinator that is simply broken — satisfies the above forever.
    // `execute` returns an `ExecuteResult` envelope (`{response, encoded, status,
    // headers}`), so the handler's value lives under `response`.
    const ok = await post({ name: "alice" });
    expect(Exit.isSuccess(ok)).toBe(true);
    if (!Exit.isSuccess(ok)) return;
    expect(ok.value.response).toMatchObject({ ok: "alice" });
    expect(ok.value.status).toBe(200);
  });

  // `DQ-033`: the process-global transport is deleted outright, so two concurrent
  // calls carrying different layer-provided transports must each hit their own.
  // This is the *fixed* form of the cross-request bleed: a value that lives in a
  // module slot cannot be per-request, and `Atom.action`'s free form previously
  // consulted that slot before context.
  it("[R5.3] concurrent single-flight calls each use their own request-scoped transport", async () => {
    const calls: Array<string> = [];
    // The transport service is deliberately implementable without casts: its
    // result is `unknown` because the envelope is schema-validated downstream.
    const transport = (label: string) => Layer.succeed(SingleFlightTransportTag, {
      execute: () => Effect.sync(() => {
        calls.push(label);
        return {
          ok: true,
          payload: { mutation: label, url: "http://localhost/", loaders: [] },
        };
      }),
    });

    const handle = Atom.action((input: string) => Effect.succeed(input), {
      name: "r5-transport",
      singleFlight: { url: "/r5-transport" },
    });

    const [a, b] = await Effect.runPromise(Effect.all([
      handle.runEffect("a").pipe(Effect.provide(transport("layer-a"))),
      handle.runEffect("b").pipe(Effect.provide(transport("layer-b"))),
    ], { concurrency: "unbounded" }));

    // No bleed in either direction, and exactly two executions.
    expect([a, b]).toEqual(["layer-a", "layer-b"]);
    expect(calls.sort()).toEqual(["layer-a", "layer-b"]);
  });

  // `DQ-033` (ratified 2026-07-30). One ladder, in one order:
  //   context transport → explicit `endpoint` → local runner.
  // Context first is the load-bearing part: the injected transport is the
  // *request-scoped* value while `endpoint` is a static authoring hint, and
  // letting a static hint outrank request scope is exactly how the bleed
  // happened.
  it("[R5.3] transport resolution is context → endpoint → local runner, in that order", async () => {
    const seen: Array<string> = [];
    const contextTransport = Layer.succeed(SingleFlightTransportTag, {
      execute: () => Effect.sync(() => {
        seen.push("context");
        return { ok: true, payload: { mutation: "context", url: "http://localhost/", loaders: [] } };
      }),
    });
    const endpointFetch = async () => {
      seen.push("endpoint");
      return {
        json: async () => ({
          ok: true,
          payload: { mutation: "endpoint", url: "http://localhost/", loaders: [] },
        }),
      };
    };

    const run = (
      options: Atom.SingleFlightClientOptions<string>,
      layer?: Layer.Layer<never>,
    ) => {
      const handle = Atom.action((input: string) => Effect.sync(() => {
        seen.push("local");
        return `local:${input}`;
      }), { name: "r5-ladder", singleFlight: options });
      const effect = handle.runEffect("x");
      return Effect.runPromise(layer ? effect.pipe(Effect.provide(layer)) : effect);
    };

    // Rung 1: a context transport wins even though an endpoint is also declared.
    seen.length = 0;
    const withContext = await run(
      { url: "/r5-ladder", endpoint: "/api/r5-ladder", fetch: endpointFetch },
      contextTransport,
    );
    expect(withContext).toBe("context");
    expect(seen).toEqual(["context"]);

    // Rung 2: no context transport, so the declared endpoint is used.
    seen.length = 0;
    const withEndpoint = await run({ url: "/r5-ladder", endpoint: "/api/r5-ladder", fetch: endpointFetch });
    expect(withEndpoint).toBe("endpoint");
    expect(seen).toEqual(["endpoint"]);

    // Rung 3: neither, so the action runs locally — the ladder falls through
    // rather than failing.
    seen.length = 0;
    const local = await run({ url: "/r5-ladder" });
    expect(local).toBe("local:x");
    expect(seen).toEqual(["local"]);
  });

  it("[R5.3] the process-global transport install is deleted, not merely bypassed", async () => {
    // NEGATIVE CONTROL first: prove dynamic import can still find a real
    // module, so a broken resolution cannot make the deletion assertions pass
    // vacuously.
    const transportModule = await import("../SingleFlightTransport.js");
    expect(transportModule.SingleFlightTransportTag).toBeDefined();

    let deleted = false;
    try {
      await import(/* @vite-ignore */ "../single-flight" + "-runtime.js");
    } catch {
      deleted = true;
    }
    expect(deleted).toBe(true);

    // And nothing re-exports the escape hatch under another roof: a global that
    // survives anywhere is a global that can bleed. `in` checks, because the
    // absence of an export is inherently untypeable.
    const surfaces: ReadonlyArray<object> = [AtomModule, RouteModule, await import("../index.js")];
    for (const mod of surfaces) {
      expect("installSingleFlightTransport" in mod).toBe(false);
      expect("getInstalledSingleFlightTransport" in mod).toBe(false);
    }
  });

  it("[R5.4] one path-matching engine: Route understands splats", async () => {
    expect(Route.matchPattern("/files/*", "/files/a/b/c")).toBe(true);
    expect(Route.matchPattern("/files/*", "/files")).toBe(false);
    expect(Route.extractParams("/files/*", "/files/a/b/c")).toEqual({ "*": "a/b/c" });
    expect(Route.extractParams("/files/*", "/other/a")).toBeNull();
  });

  // `DQ-038` (ratified 2026-07-30): `Route.link` gets segment-model substitution
  // as an explicit R5.4 deliverable, sharing the one matcher rather than
  // string-replacing `:${k}` locally.
  it("[R5.4] Route.link substitutes optional segments through the shared segment model", async () => {
    const Page = Route.path("/r5-link/:userId/:tab?")(Component.from(() => null));
    const href = Route.link(Page);

    // Present: substituted like any other param, with no stray `?` anywhere.
    const withTab = href({ userId: "alice", tab: "settings" });
    expect(withTab).toBe("/r5-link/alice/settings");
    // Absent: the whole segment disappears rather than leaving `/:tab?` or `/`.
    const withoutTab = href({ userId: "alice" });
    expect(withoutTab).toBe("/r5-link/alice");
    expect(withTab).not.toContain("?");
    expect(withoutTab).not.toContain("?");

    // The two engines agree: whatever `link` builds, the matcher accepts. This is
    // the actual R5.4 claim — one segment model, not two that happen to line up.
    expect(Route.matchPattern("/r5-link/:userId/:tab?", withTab, true)).toBe(true);
    expect(Route.matchPattern("/r5-link/:userId/:tab?", withoutTab, true)).toBe(true);

    // NEGATIVE CONTROL: a `link` that dropped every unmatched `:name` — or that
    // returned the raw pattern — would still satisfy a lone "no `?` present"
    // assertion. A required param must still round-trip, and query/hash options
    // must still compose on top.
    expect(href({ userId: "bob", tab: "billing" }, { query: { page: "2" }, hash: "top" }))
      .toBe("/r5-link/bob/billing?page=2#top");
  });

  it("[R5.4] one path-matching engine: ServerRoute understands optional segments", async () => {
    const route = ServerRoute.json({ key: "r5-opt" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/r5-opt/:id?"),
    );

    expect(ServerRoute.matches(route, "GET", "/r5-opt/alice")).toBe(true);
    expect(ServerRoute.matches(route, "GET", "/r5-opt")).toBe(true);
    expect(ServerRoute.matches(route, "GET", "/r5-opt/alice/extra")).toBe(false);
  });

  // `DQ-036` (ratified 2026-07-30): a loader timeout is a schema-tagged
  // `RouteLoaderTimeoutError({ routeId, timeoutMs })`, not a bare
  // `Cause.TimeoutError`. The `routeId` is the part that earns its keep.
  it("[R5.2] a loader timeout is a tagged RouteLoaderTimeoutError naming the route and the budget", async () => {
    // Per-spec store: this lane's fixtures must not share the module-global cache.
    const store = makeLoaderCacheStore();
    const load = <E>(routeId: string, effect: Effect.Effect<unknown, E>) =>
      Effect.runPromise(
        runCachedLoader(routeId, { id: 1 }, effect, { timeout: 20 }).pipe(
          Effect.provideService(LoaderCacheTag, store),
        ),
      );

    const timedOut = await load("/r5-timeout", Effect.never);
    expect(timedOut._tag).toBe("Failure");
    if (timedOut._tag !== "Failure") return;
    const error = timedOut.error;
    expect(error).toBeInstanceOf(RouteLoaderTimeoutError);
    if (!(error instanceof RouteLoaderTimeoutError)) return;
    // A `Schema.TaggedErrorClass` instance: a real Error with a stack, matching
    // the discipline R5.2 imposes on the rest of this lane.
    expect(error._tag).toBe("RouteLoaderTimeoutError");
    expect(typeof error.stack).toBe("string");
    // Attributable: which route, and against which budget.
    expect(error.routeId).toBe("/r5-timeout");
    expect(error.timeoutMs).toBe(20);

    // Near neighbour: an ordinary loader failure under the *same* timeout option
    // must not be mislabelled as a timeout. One generic "loader broke" tag would
    // otherwise satisfy both this spec and the one above.
    const failed = await load("/r5-timeout-failed", Effect.fail({ _tag: "Boom" } as const));
    expect(failed._tag).toBe("Failure");
    if (failed._tag !== "Failure") return;
    expect(tagOf(failed.error)).toBe("Boom");

    // NEGATIVE CONTROL: a loader that finishes inside the budget succeeds and
    // reports no error at all, so an implementation that times out unconditionally
    // — or that never applies the timeout — cannot pass everything above.
    const okResult = await load("/r5-timeout-ok", Effect.succeed("fast"));
    expect(successValue(okResult)).toBe("fast");
  });
});
