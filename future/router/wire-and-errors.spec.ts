/**
 * R5 — wire and error hygiene.
 *
 * One encoding for loader `Result`s across SSR and single-flight, validated
 * through `Serialization` with declared schemas; tagged error classes instead of
 * untagged literals; malformed input as a typed failure rather than a defect;
 * one transport-resolution order with no process-global transport; one
 * path-matching engine shared by `Route` and `ServerRoute`.
 *
 * Owner: docs/ROUTER_CONSOLIDATION_PLAN.md § R5.
 */
import { describe, expect, it } from "vitest";
import { Cause, Effect, Layer, Schema } from "effect";
import { fromSrc, loadSrc } from "../harness.js";

describe("R5 — wire hygiene", () => {
  it("[R5.1] single-flight loader data uses the same encoding as SSR, so non-JSON values survive", async () => {
    const Route = await fromSrc(
      "Route",
      "path",
      "loader",
      "singleFlight",
      "setLoaderData",
      "invokeSingleFlight",
    );
    const Component: any = await loadSrc("Component");
    const Serialization: any = await loadSrc("Serialization");
    const { clearLoaderCache, getLoaderCacheEntry }: any = await loadSrc("router-runtime");

    const routeId = "/r5-wire/:id";
    const Page = Route.loader((params: { readonly id: string }) => Effect.succeed({ at: new Date(0), id: params.id }))(
      Route.path(routeId)(Component.from(() => null)),
    );

    const handler = Route.singleFlight((id: string) => Effect.succeed({ ok: id }), {
      app: Page,
      revalidate: "none",
      setLoaders: () => [Route.setLoaderData(routeId, { at: new Date(5), id: "alice" })],
      baseUrl: "http://localhost",
    });

    const response = await Effect.runPromise(
      handler({ args: ["alice"], url: "/r5-wire/alice" }) as Effect.Effect<any, never, never>,
    );
    // Cross the boundary the way a real transport does.
    const overTheWire = JSON.parse(JSON.stringify(response));

    // ISOLATION: scoped to this spec's own route id, never a process-wide wipe.
    clearLoaderCache(routeId);
    await Effect.runPromise(
      Route.invokeSingleFlight("/api/r5-wire", { args: ["alice"], url: "/r5-wire/alice" }, {
        app: Page,
        fetch: async () => ({ json: async () => overTheWire }),
      }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<any, any, never>,
    );

    const cached = getLoaderCacheEntry(routeId, { id: "alice" });
    expect(cached).toBeDefined();
    const data = (cached?.result as any).value;
    // A single declared wire projection means a Date arrives as a Date, exactly
    // as it does through the SSR loader payload.
    expect(data.at).toBeInstanceOf(Date);
    expect((data.at as Date).getTime()).toBe(5);
  });

  it("[R5.1] a malformed single-flight response is a typed decode failure and hydrates nothing", async () => {
    const Route = await fromSrc("Route", "path", "loader", "invokeSingleFlight");
    const Component: any = await loadSrc("Component");
    const Serialization: any = await loadSrc("Serialization");
    const { clearLoaderCache, getLoaderCacheEntry }: any = await loadSrc("router-runtime");

    const routeId = "/r5-bad/:id";
    const Page = Route.loader((params: { readonly id: string }) => Effect.succeed({ id: params.id }))(
      Route.path(routeId)(Component.from(() => null)),
    );

    const invoke = (payload: unknown) =>
      Effect.runPromiseExit(
        Route.invokeSingleFlight("/api/r5-bad", { args: ["alice"], url: "/r5-bad/alice" }, {
          app: Page,
          fetch: async () => ({ json: async () => payload }),
        }).pipe(Effect.provide(Serialization.layer)) as Effect.Effect<any, any, never>,
      );

    // ISOLATION: scoped to this spec's own route id, never a process-wide wipe.
    clearLoaderCache(routeId);
    // No `url`, no `loaders`: structurally invalid payload.
    const exit = await invoke({ ok: true, payload: { mutation: 1 } });

    expect(exit._tag).toBe("Failure");
    const cause = (exit as any).cause;
    // Fails closed as a *typed failure*, not a defect from `new URL(undefined)`.
    // The absence of a defect is the load-bearing half: "it threw somewhere" is
    // not the same guarantee as "it was rejected at the trust boundary".
    expect(Cause.hasDies(cause)).toBe(false);
    const failure = Cause.findErrorOption(cause);
    expect(failure._tag).toBe("Some");
    const decodeTag = String((failure as any).value?._tag);
    expect(decodeTag).toMatch(/Decode|Schema|SingleFlight/);
    expect(getLoaderCacheEntry(routeId, { id: "alice" })).toBeUndefined();

    // A malformed *payload* and a failed *transport* are near neighbours from the
    // caller's seat but demand different remedies (deploy skew vs retry), so the
    // codes must differ.
    const transportExit: any = await Effect.runPromiseExit(
      Route.invokeSingleFlight("/api/r5-bad", { args: [], url: "/" }, {
        hydrate: false,
        fetch: async () => {
          throw new Error("network down");
        },
      }) as Effect.Effect<any, any, never>,
    );
    const transportTag = String(
      (Cause.findErrorOption(transportExit.cause) as any).value?._tag,
    );
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
    expect(ok._tag).toBe("Success");
  });

  it("[R5.2] single-flight invocation errors are tagged error classes, not object literals", async () => {
    const Route = await fromSrc("Route", "invokeSingleFlight");

    const exit = await Effect.runPromiseExit(
      Route.invokeSingleFlight("/api/r5-boom", { args: [], url: "/" }, {
        hydrate: false,
        fetch: async () => {
          throw new Error("network down");
        },
      }) as Effect.Effect<any, any, never>,
    );

    expect(exit._tag).toBe("Failure");
    const failure = Cause.findErrorOption((exit as any).cause);
    expect(failure._tag).toBe("Some");
    const error = (failure as any).value;
    expect(error._tag).toBe("SingleFlightInvokeError");
    // A `Schema.TaggedErrorClass` instance, matching the resumability layer's
    // discipline: a real Error with a stack, not a bare literal.
    expect(error).toBeInstanceOf(Error);
    expect(typeof error.stack).toBe("string");
  });

  it("[R5.2] a malformed server-route body is a typed failure, never a defect", async () => {
    const ServerRoute = await fromSrc("ServerRoute", "json", "method", "path", "body", "handle", "execute");

    const route = ServerRoute.json({ key: "r5-body" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path("/r5-body"),
      ServerRoute.body(Schema.Struct({ name: Schema.String })),
      ServerRoute.handle(({ body }: { readonly body: { readonly name: string } }) => Effect.succeed({ ok: body.name })),
    );

    const post = (body: unknown) =>
      Effect.runPromiseExit(
        ServerRoute.execute(route, new Request("http://test.local/r5-body", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })) as Effect.Effect<any, any, never>,
      );

    const exit = await post({ name: 42 });

    expect(exit._tag).toBe("Failure");
    const cause = (exit as any).cause;
    // No defect anywhere in the cause: decoding used `decodeUnknownEffect`.
    expect(Cause.hasDies(cause)).toBe(false);
    const failure = Cause.findErrorOption(cause);
    expect(failure._tag).toBe("Some");
    expect(String((failure as any).value?._tag)).toMatch(/Decode|Schema/);

    // NEGATIVE CONTROL. Without this, a handler that rejects every body — or a
    // `body(...)` combinator that is simply broken — satisfies the above forever.
    // `execute` returns an `ExecuteResult` envelope (`{response, encoded, status,
    // headers}`), so the handler's value lives under `response`.
    const ok: any = await post({ name: "alice" });
    expect(ok._tag).toBe("Success");
    expect(ok.value.response).toMatchObject({ ok: "alice" });
    expect(ok.value.status).toBe(200);
  });

  // `DQ-033`: the process-global transport is deleted outright, so two concurrent
  // calls carrying different layer-provided transports must each hit their own.
  // This is the *fixed* form of the cross-request bleed: a value that lives in a
  // module slot cannot be per-request, and `Atom.action`'s free form previously
  // consulted that slot before context.
  it("[R5.3] concurrent single-flight calls each use their own request-scoped transport", async () => {
    const Atom: any = await loadSrc("Atom");
    const { SingleFlightTransportTag } = await fromSrc("SingleFlightTransport", "SingleFlightTransportTag");

    const calls: Array<string> = [];
    const transport = (label: string) => Layer.succeed(SingleFlightTransportTag, {
      execute: (_request: unknown) => Effect.sync(() => {
        calls.push(label);
        return {
          ok: true as const,
          payload: { mutation: label, url: "http://localhost/", loaders: [] },
        };
      }),
    } as any);

    const handle = Atom.action((input: string) => Effect.succeed(input), {
      name: "r5-transport",
      singleFlight: { url: "/r5-transport" },
    });

    const [a, b] = await Effect.runPromise(Effect.all([
      handle.runEffect("a").pipe(Effect.provide(transport("layer-a"))),
      handle.runEffect("b").pipe(Effect.provide(transport("layer-b"))),
    ], { concurrency: "unbounded" }) as unknown as Effect.Effect<ReadonlyArray<unknown>, never, never>);

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
    const Atom: any = await loadSrc("Atom");
    const { SingleFlightTransportTag } = await fromSrc("SingleFlightTransport", "SingleFlightTransportTag");

    const seen: Array<string> = [];
    const contextTransport = Layer.succeed(SingleFlightTransportTag, {
      execute: (_request: unknown) => Effect.sync(() => {
        seen.push("context");
        return { ok: true as const, payload: { mutation: "context", url: "http://localhost/", loaders: [] } };
      }),
    } as any);
    const endpointFetch = async () => {
      seen.push("endpoint");
      return {
        json: async () => ({
          ok: true,
          payload: { mutation: "endpoint", url: "http://localhost/", loaders: [] },
        }),
      };
    };

    const run = (options: Record<string, unknown>, layer?: Layer.Layer<any>) => {
      const handle = Atom.action((input: string) => Effect.sync(() => {
        seen.push("local");
        return `local:${input}`;
      }), { name: "r5-ladder", singleFlight: options });
      const effect = handle.runEffect("x");
      return Effect.runPromise(
        (layer ? effect.pipe(Effect.provide(layer)) : effect) as Effect.Effect<unknown, never, never>,
      );
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
    // NEGATIVE CONTROL first: prove `loadSrc` can still find a real module, so a
    // broken harness cannot make the deletion assertions pass vacuously.
    const transportModule: any = await loadSrc("SingleFlightTransport");
    expect(transportModule.SingleFlightTransportTag).toBeDefined();

    let deleted = false;
    try {
      await loadSrc("single-flight-runtime");
    } catch {
      deleted = true;
    }
    expect(deleted).toBe(true);

    // And nothing re-exports the escape hatch under another roof: a global that
    // survives anywhere is a global that can bleed.
    for (const name of ["Atom", "Route", "index"]) {
      const mod: any = await loadSrc(name);
      expect(mod.installSingleFlightTransport).toBeUndefined();
      expect(mod.getInstalledSingleFlightTransport).toBeUndefined();
    }
  });

  it("[R5.4] one path-matching engine: Route understands splats", async () => {
    const Route = await fromSrc("Route", "matchPattern", "extractParams");

    expect(Route.matchPattern("/files/*", "/files/a/b/c")).toBe(true);
    expect(Route.matchPattern("/files/*", "/files")).toBe(false);
    expect(Route.extractParams("/files/*", "/files/a/b/c")).toEqual({ "*": "a/b/c" });
    expect(Route.extractParams("/files/*", "/other/a")).toBeNull();
  });

  // `DQ-038` (ratified 2026-07-30): `Route.link` gets segment-model substitution
  // as an explicit R5.4 deliverable, sharing the one matcher rather than
  // string-replacing `:${k}` locally. R1 shipped `:name?` in `matchPattern` /
  // `extractParams` but left `link` behind, so `link` currently emits a URL with
  // a stray `?` — a malformed URL, silently.
  //
  // FALLBACK, if R5.4 slips: `link` must **reject** optional segments with a
  // clear error rather than gaining a third pattern parser. A clear error beats a
  // malformed URL. That fallback is deliberately not the spec below — substitution
  // is the target — but an implementer taking it should replace this spec with its
  // rejection sibling rather than delete it.
  it("[R5.4] Route.link substitutes optional segments through the shared segment model", async () => {
    const Route = await fromSrc("Route", "path", "link", "matchPattern");
    const Component: any = await loadSrc("Component");

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
    const ServerRoute = await fromSrc("ServerRoute", "json", "method", "path", "matches");

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
  // `Cause.TimeoutError`. R1 shipped `Effect.timeout`, which produces a generic
  // failure that names neither the route nor the budget — and a timeout is the
  // single most likely loader failure an author wants distinct UI for. The
  // `routeId` is the part that earns its keep.
  it("[R5.2] a loader timeout is a tagged RouteLoaderTimeoutError naming the route and the budget", async () => {
    const runtime = await fromSrc(
      "router-runtime",
      "runCachedLoader",
      "makeLoaderCacheStore",
      "LoaderCacheTag",
    );

    // Per-spec store: this lane's fixtures must not share the module-global cache.
    const store = runtime.makeLoaderCacheStore();
    const load = (routeId: string, effect: Effect.Effect<unknown, unknown>) =>
      Effect.runPromise(
        runtime.runCachedLoader(routeId, { id: 1 }, effect, { timeout: 20 }).pipe(
          Effect.provideService(runtime.LoaderCacheTag, store),
        ) as Effect.Effect<any, never, never>,
      );

    const timedOut = await load("/r5-timeout", Effect.never);
    expect(timedOut._tag).toBe("Failure");
    const error = timedOut.error;
    expect(error._tag).toBe("RouteLoaderTimeoutError");
    // A `Schema.TaggedErrorClass` instance: a real Error with a stack, matching
    // the discipline R5.2 imposes on the rest of this lane.
    expect(error).toBeInstanceOf(Error);
    expect(typeof error.stack).toBe("string");
    // Attributable: which route, and against which budget.
    expect(error.routeId).toBe("/r5-timeout");
    expect(error.timeoutMs).toBe(20);

    // Near neighbour: an ordinary loader failure under the *same* timeout option
    // must not be mislabelled as a timeout. One generic "loader broke" tag would
    // otherwise satisfy both this spec and the one above.
    const failed = await load("/r5-timeout-failed", Effect.fail({ _tag: "Boom" } as const));
    expect(failed._tag).toBe("Failure");
    expect(failed.error._tag).toBe("Boom");

    // NEGATIVE CONTROL: a loader that finishes inside the budget succeeds and
    // reports no error at all, so an implementation that times out unconditionally
    // — or that never applies the timeout — cannot pass everything above.
    const ok = await load("/r5-timeout-ok", Effect.succeed({ fast: true }));
    expect(ok._tag).toBe("Success");
    expect(ok.value).toEqual({ fast: true });
  });
});
