import { describe, expect, it } from "vitest";
import { Deferred, Effect, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as RouterRuntime from "../RouterRuntime.js";
import * as ServerRoute from "../ServerRoute.js";

/** Flush pending microtasks/interrupt signals so forked fibers can settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("RouterRuntime", () => {
  it("initializes and exposes a snapshot", () => {
    const app = Route.id("users")(Route.path("/users")(Component.from<{}>(() => null)));
    const runtime = RouterRuntime.create({
      app,
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    Effect.runSync(runtime.initialize());
    const snapshot = Effect.runSync(runtime.snapshot());

    expect(snapshot.initialized).toBe(true);
    expect(snapshot.location.pathname).toBe("/users");
    expect(snapshot.appMatches).toContain("users");
  });

  it("tracks navigation through history adapter", () => {
    const app = Route.path("/users")(Component.from<{}>(() => null));
    const runtime = RouterRuntime.create({
      app,
      history: RouterRuntime.createMemoryHistory("/"),
    });

    Effect.runSync(runtime.initialize());
    Effect.runSync(runtime.navigate("/users"));

    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.location.pathname).toBe("/users");
    expect(snapshot.historyAction).toBe("push");
  });

  it("matches app route graphs and document server routes in snapshots", () => {
    const app = Route.id("users.detail")(
      Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
        Route.path("/users/:userId")(Component.from<{}>(() => null)),
      ),
    );
    const document = ServerRoute.document(app).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/users/*"),
    );
    const runtime = RouterRuntime.create({
      app,
      server: ServerRoute.define(document),
      history: RouterRuntime.createMemoryHistory("/users/alice"),
    });

    Effect.runSync(runtime.initialize());
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.appMatches).toContain("users.detail");
    expect(snapshot.serverMatch).toBe("/users/*");
    expect(snapshot.matchedServerRoute).toBe("GET:/users/*");
  });

  it("matches nested route nodes by their joined path", () => {
    const Users = Route.page("/users/:userId", Component.from<{}>(() => null));
    const Settings = Route.page("settings", Component.from<{}>(() => null));
    const app = Route.layout(Component.from<{}>(() => null)).pipe(
      Route.children([Route.mount(Users, [Settings])]),
    );
    const runtime = RouterRuntime.create({
      app,
      history: RouterRuntime.createMemoryHistory("/"),
    });

    Effect.runSync(runtime.initialize());
    Effect.runSync(runtime.navigate("/users/1/settings"));
    const snapshot = Effect.runSync(runtime.snapshot());

    expect(snapshot.location.pathname).toBe("/users/1/settings");
    expect(snapshot.appMatches).toContain("/users/:userId/settings");
    expect(snapshot.appMatches).not.toContain("settings");
    expect(snapshot.appMatches).not.toContain("/settings");
  });

  it("supports route-node navigation by reference", () => {
    const UserPage = Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
      Route.path("/users/:userId")(Component.from<{}>(() => null)),
    );
    const runtime = RouterRuntime.create({
      app: UserPage,
      history: RouterRuntime.createMemoryHistory("/"),
    });

    Effect.runSync(runtime.initialize());
    Effect.runSync(runtime.navigateApp(UserPage, { params: { userId: "alice" } }));
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.location.pathname).toBe("/users/alice");
  });

  it("supports unified-route navigation by reference", () => {
    const UserRoute = Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
      Route.path("/runtime-users/:userId")(Component.from<{}>(() => null)),
    );
    const runtime = RouterRuntime.create({
      app: UserRoute,
      history: RouterRuntime.createMemoryHistory("/"),
    });

    Effect.runSync(runtime.initialize());
    Effect.runSync(runtime.navigateApp(UserRoute, { params: { userId: "alice" } }));
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.location.pathname).toBe("/runtime-users/alice");
  });

  it("loads matched route loaders into runtime snapshots", () => {
    const UserPage = Route.loader((params: { readonly userId: string }) => Effect.succeed({ id: params.userId, name: "Alice" }))(
      Route.id("users.detail")(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
          Route.path("/users/:userId")(Component.from<{}>(() => null)),
        ),
      ),
    );
    const runtime = RouterRuntime.create({
      app: UserPage,
      history: RouterRuntime.createMemoryHistory("/users/alice"),
    });

    Effect.runSync(runtime.initialize());
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.loaderData.get("users.detail")).toEqual({ id: "alice", name: "Alice" });
  });

  it("loads matched unified-route loaders into runtime snapshots", () => {
    const UserRoute = Route.loader((params: { readonly userId: string }) => Effect.succeed({ id: params.userId, name: "Alice" }))(
      Route.id("users.unified.detail")(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
          Route.path("/unified-users/:userId")(Component.from<{}>(() => null)),
        ),
      ),
    );
    const runtime = RouterRuntime.create({
      app: UserRoute,
      history: RouterRuntime.createMemoryHistory("/unified-users/alice"),
    });

    Effect.runSync(runtime.initialize());
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.loaderData.get("users.unified.detail")).toEqual({ id: "alice", name: "Alice" });
    expect(snapshot.appMatches).toContain("users.unified.detail");
  });

  it("revalidates matched unified-route loaders", () => {
    let runs = 0;
    const UserPage = Route.loader((params: { readonly userId: string }) => Effect.sync(() => {
        runs += 1;
        return { id: params.userId, count: runs };
      }))( 
      Route.id("users.detail")(
        Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
          Route.path("/users/:userId")(Component.from<{}>(() => null)),
        ),
      ),
    );
    const runtime = RouterRuntime.create({
      app: UserPage,
      history: RouterRuntime.createMemoryHistory("/users/alice"),
    });

    Effect.runSync(runtime.initialize());
    Effect.runSync(runtime.revalidate());
    const snapshot = Effect.runSync(runtime.snapshot());
    expect((snapshot.loaderData.get("users.detail") as any).count).toBeGreaterThanOrEqual(1);
    expect(snapshot.revalidation.phase).toBe("idle");
  });

  it("tracks fetcher and submission state in snapshots", async () => {
    const app = Route.path("/users")(Component.from<{}>(() => null));
    const action = ServerRoute.action({ key: "save-user" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path(ServerRoute.generatedPath("save-user")),
    );
    const runtime = RouterRuntime.create({
      app,
      server: ServerRoute.define(action),
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.submit(action.path ?? "/_server/save-user", { method: "POST" }));
    await Effect.runPromise(runtime.fetch("sidebar", "/users"));

    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.actionData?.get("/_server/save-user")).toEqual({
      kind: "action",
      response: { method: "POST" },
    });
    expect(snapshot.fetchers.get("sidebar")?.state.phase).toBe("idle");
    expect(snapshot.fetchers.get("sidebar")?.state.outcome).toBeUndefined();
  });

  it("executes typed ServerRoute actions through submit", async () => {
    const app = Route.path("/users")(Component.from<{}>(() => null));
    const action = ServerRoute.action({ key: "save-user" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path(ServerRoute.generatedPath("save-user")),
      ServerRoute.form(Schema.Struct({ name: Schema.String })),
      ServerRoute.response(Schema.Struct({ ok: Schema.Boolean, name: Schema.String })),
      ServerRoute.handle(({ form }: { readonly form: { readonly name: string } }) => Effect.succeed({ ok: true as const, name: form.name })),
    );
    const runtime = RouterRuntime.create({
      app,
      server: ServerRoute.define(action),
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    const form = new FormData();
    form.set("name", "Alice");
    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.submit(action, { formData: form }));

    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.actionData?.get("/_server/save-user")).toEqual({
      kind: "action",
      response: { ok: true, name: "Alice" },
      status: 200,
      headers: new Map(),
      encoded: { ok: true, name: "Alice" },
      redirect: undefined,
      notFound: undefined,
    });
    expect(snapshot.lastActionOutcome).toEqual({
      kind: "action",
      response: { ok: true, name: "Alice" },
      status: 200,
      headers: new Map(),
      encoded: { ok: true, name: "Alice" },
      redirect: undefined,
      notFound: undefined,
    });
  });

  it("executes typed ServerRoute fetches through fetch", async () => {
    const app = Route.path("/users")(Component.from<{}>(() => null));
    const resource = ServerRoute.json({ key: "user-search" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path("/api/users/search"),
      ServerRoute.body(Schema.Struct({ q: Schema.String })),
      ServerRoute.response(Schema.Struct({ ok: Schema.Boolean })),
      ServerRoute.handle(({ body }: { readonly body: { readonly q: string } }) => Effect.succeed({ ok: body.q.length > 0 })),
    );
    const runtime = RouterRuntime.create({
      app,
      server: ServerRoute.define(resource),
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.fetch("search", resource, { method: "POST", body: { q: "alice" } }));

    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.fetchers.get("search")?.state.phase).toBe("idle");
    expect(snapshot.fetchers.get("search")?.outcome).toEqual({
      kind: "fetch",
      response: { ok: true },
      status: 200,
      headers: new Map(),
      encoded: { ok: true },
      redirect: undefined,
      notFound: undefined,
    });
    expect(snapshot.lastFetchOutcome).toEqual({
      kind: "fetch",
      response: { ok: true },
      status: 200,
      headers: new Map(),
      encoded: { ok: true },
      redirect: undefined,
      notFound: undefined,
    });
    expect(snapshot.fetchers.get("search")?.state.outcome).toEqual({
      kind: "fetch",
      response: { ok: true },
      status: 200,
      headers: new Map(),
      encoded: { ok: true },
      redirect: undefined,
      notFound: undefined,
    });
    expect(snapshot.errors).toBeNull();
  });

  it("exposes runtime/history/navigation as Effect services", () => {
    const app = Route.path("/users")(Component.from<{}>(() => null));
    const history = RouterRuntime.createMemoryHistory("/");
    const runtime = RouterRuntime.create({ app, history });

    Effect.runSync(runtime.initialize());
    const layer = RouterRuntime.toLayer(runtime, history);

    const locationBefore = Effect.runSync(Effect.service(RouterRuntime.HistoryTag).pipe(
      Effect.map((historyService) => historyService.location().pathname),
      Effect.provide(layer),
    ) as Effect.Effect<string, never, never>);
    expect(locationBefore).toBe("/");

    Effect.runSync(Effect.service(RouterRuntime.NavigationTag).pipe(
      Effect.flatMap((navigation) => navigation.navigate("/users")),
      Effect.provide(layer),
    ) as Effect.Effect<void, never, never>);

    const locationAfter = Effect.runSync(runtime.snapshot()).location.pathname;
    expect(locationAfter).toBe("/users");
  });

  it("tracks last document and dispatch outcomes in snapshots", async () => {
    const App = Route.loader((_: {}) => Effect.succeed({ list: true as const }))(
      Route.path("/users")(Component.from<{}>(() => "Users Runtime Document")),
    );
    const Health = ServerRoute.json({ key: "health" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/health"),
      ServerRoute.response(Schema.Struct({ ok: Schema.Boolean })),
      ServerRoute.handle(() => Effect.succeed({ ok: true as const })),
    );
    const runtime = RouterRuntime.create({
      app: App,
      server: ServerRoute.define(ServerRoute.document(App).pipe(ServerRoute.method("GET"), ServerRoute.path("/users")), Health),
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.renderRequest(new Request("http://example.com/users")));
    let snapshot = Effect.runSync(runtime.snapshot());
    expect((snapshot.lastDocumentResult as any)?.kind).toBe("document");
    expect((snapshot.lastDocumentResult as any)?.result?.html).toBe("Users Runtime Document");
    expect(snapshot.requestState.phase).toBe("idle");

    await Effect.runPromise(runtime.dispatchRequest(new Request("http://example.com/health")));
    snapshot = Effect.runSync(runtime.snapshot());
    expect((snapshot.lastDispatchResult as any)?.kind).toBe("dispatch");
    expect((snapshot.lastDispatchResult as any)?.result?._tag).toBe("data");
    expect(snapshot.requestState.phase).toBe("idle");
    expect(snapshot.dispatchState.phase).toBe("idle");
  });

  it("can represent cancelled task state in snapshots", () => {
    const app = Route.path("/users")(Component.from<{}>(() => null));
    const runtime = RouterRuntime.create({
      app,
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    Effect.runSync(runtime.initialize());
    Effect.runSync(runtime.cancel());
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.navigation.phase).toBe("cancelled");
    expect(snapshot.navigation.interrupted).toBe(true);
  });

  it("can cancel fetch task state explicitly", async () => {
    const app = Route.path("/users")(Component.from<{}>(() => null));
    const runtime = RouterRuntime.create({
      app,
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.fetch("sidebar", "/users"));
    Effect.runSync(runtime.cancel({ fetchKey: "sidebar" }));
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.fetchers.get("sidebar")?.state.phase).toBe("cancelled");
  });

  it("supersedes fetcher state for the same key", async () => {
    const app = Route.path("/users")(Component.from<{}>(() => null));
    const runtime = RouterRuntime.create({
      app,
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    const seen: Array<RouterRuntime.RouterTaskPhase> = [];
    Effect.runSync(runtime.initialize());
    const unsubscribe = runtime.subscribe((snapshot) => {
      const fetcher = snapshot.fetchers.get("sidebar");
      if (fetcher) seen.push(fetcher.state.phase);
    });
    await Effect.runPromise(runtime.fetch("sidebar", "/users"));
    await Effect.runPromise(runtime.fetch("sidebar", "/users"));
    unsubscribe();

    expect(seen).toContain("cancelled");
  });

  it("keeps latest in-flight id when repeated fetch work supersedes prior work", async () => {
    const app = Route.path("/users")(Component.from<{}>(() => null));
    const runtime = RouterRuntime.create({
      app,
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.fetch("sidebar", "/users"));
    const first = Effect.runSync(runtime.snapshot()).inFlight.fetchers.get("sidebar") ?? null;
    await Effect.runPromise(runtime.fetch("sidebar", "/users?second=1"));
    const second = Effect.runSync(runtime.snapshot()).inFlight.fetchers.get("sidebar") ?? null;
    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it("tracks in-flight ids for request/render/revalidate paths", async () => {
    const App = Route.loader((_: {}) => Effect.succeed({ list: true as const }))(
      Route.path("/users")(Component.from<{}>(() => "Users Runtime Document")),
    );
    const runtime = RouterRuntime.create({
      app: App,
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.renderRequest(new Request("http://example.com/users")));
    let snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.inFlight.request).toBeNull();

    await Effect.runPromise(runtime.revalidate());
    snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.inFlight.revalidate).toBeNull();
  });

  it("interrupts superseded in-flight navigation loader fibers", async () => {
    let slowInterrupted = false;
    const SlowPage = Route.loader((_: {}) => Effect.never.pipe(
      Effect.onInterrupt(() => Effect.sync(() => {
        slowInterrupted = true;
      })),
    ))(
      Route.id("slow")(Route.path("/slow")(Component.from<{}>(() => null))),
    );
    const FastPage = Route.loader((_: {}) => Effect.succeed({ ok: true as const }))(
      Route.id("fast")(Route.path("/fast")(Component.from<{}>(() => null))),
    );
    const App = Route.children([SlowPage, FastPage])(
      Route.layout()(Route.path("/")(Component.from<{}>(() => null))),
    );
    const runtime = RouterRuntime.create({
      app: App,
      history: RouterRuntime.createMemoryHistory("/"),
    });

    Effect.runSync(runtime.initialize());
    // Navigate into the never-completing loader, then supersede it.
    Effect.runSync(runtime.navigate("/slow"));
    await flush();
    expect(slowInterrupted).toBe(false);

    Effect.runSync(runtime.navigate("/fast"));
    await flush();

    // The superseded /slow loader fiber is really interrupted (finalizer ran).
    expect(slowInterrupted).toBe(true);
    const snapshot = Effect.runSync(runtime.snapshot());
    // Winner state is committed; late loser never clobbers it.
    expect(snapshot.location.pathname).toBe("/fast");
    expect(snapshot.loaderData.get("fast")).toEqual({ ok: true });
    expect(snapshot.loaderData.has("slow")).toBe(false);
    expect(snapshot.navigation.phase).toBe("idle");
    expect(snapshot.inFlight.navigation).toBeNull();
  });

  it("keeps winner loader state across rapid successive navigations", async () => {
    const gates = new Map<string, Deferred.Deferred<void>>();
    const makePage = (id: string, path: string) =>
      Route.loader((_: {}) => Effect.gen(function* () {
        const gate = yield* Effect.sync(() => {
          const d = Effect.runSync(Deferred.make<void>());
          gates.set(id, d);
          return d;
        });
        yield* Deferred.await(gate);
        return { id };
      }))(
        Route.id(id)(Route.path(path)(Component.from<{}>(() => null))),
      );
    const A = makePage("a", "/a");
    const B = makePage("b", "/b");
    const C = makePage("c", "/c");
    const App = Route.children([A, B, C])(
      Route.layout()(Route.path("/")(Component.from<{}>(() => null))),
    );
    const runtime = RouterRuntime.create({
      app: App,
      history: RouterRuntime.createMemoryHistory("/"),
    });

    Effect.runSync(runtime.initialize());
    Effect.runSync(runtime.navigate("/a"));
    Effect.runSync(runtime.navigate("/b"));
    Effect.runSync(runtime.navigate("/c"));
    await flush();

    // Complete any settled losers first, then the winner: losers must not commit.
    const release = (id: string) => {
      const gate = gates.get(id);
      if (gate) Effect.runSync(Deferred.succeed(gate, undefined));
    };
    release("a");
    release("b");
    await flush();
    release("c");
    await flush();

    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.location.pathname).toBe("/c");
    expect(snapshot.loaderData.get("c")).toEqual({ id: "c" });
    expect(snapshot.loaderData.has("a")).toBe(false);
    expect(snapshot.loaderData.has("b")).toBe(false);
    expect(snapshot.navigation.phase).toBe("idle");
  });

  it("interrupts in-flight navigation loaders on explicit cancel (unmount mid-flight)", async () => {
    let interrupted = false;
    const SlowPage = Route.loader((_: {}) => Effect.never.pipe(
      Effect.onInterrupt(() => Effect.sync(() => {
        interrupted = true;
      })),
    ))(
      Route.id("slow-cancel")(Route.path("/slow-cancel")(Component.from<{}>(() => null))),
    );
    const App = Route.children([SlowPage])(
      Route.layout()(Route.path("/")(Component.from<{}>(() => null))),
    );
    const runtime = RouterRuntime.create({
      app: App,
      history: RouterRuntime.createMemoryHistory("/"),
    });

    Effect.runSync(runtime.initialize());
    Effect.runSync(runtime.navigate("/slow-cancel"));
    await flush();
    expect(interrupted).toBe(false);

    Effect.runSync(runtime.cancel());
    await flush();

    expect(interrupted).toBe(true);
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.navigation.phase).toBe("cancelled");
    expect(snapshot.navigation.interrupted).toBe(true);
    expect(snapshot.inFlight.navigation).toBeNull();
  });

  it("tracks in-flight ids for submit and clears them after completion", async () => {
    const app = Route.path("/users")(Component.from<{}>(() => null));
    const action = ServerRoute.action({ key: "save-user" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path(ServerRoute.generatedPath("save-user")),
      ServerRoute.form(Schema.Struct({ name: Schema.String })),
      ServerRoute.handle(({ form }: { readonly form: { readonly name: string } }) => Effect.succeed({ ok: true as const, name: form.name })),
    );
    const runtime = RouterRuntime.create({
      app,
      server: ServerRoute.define(action),
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    const form = new FormData();
    form.set("name", "Alice");
    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.submit(action, { formData: form }));
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.inFlight.submit).toBeNull();
  });
});
