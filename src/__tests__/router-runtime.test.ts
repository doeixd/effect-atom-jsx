import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as RouterRuntime from "../RouterRuntime.js";
import * as ServerRoute from "../ServerRoute.js";

describe("RouterRuntime", () => {
  it("initializes and exposes a snapshot", () => {
    const app = Route.define(Route.page("/users", Component.from<{}>(() => null)));
    const runtime = RouterRuntime.create({
      app,
      history: RouterRuntime.createMemoryHistory("/users"),
    });

    Effect.runSync(runtime.initialize());
    const snapshot = Effect.runSync(runtime.snapshot());

    expect(snapshot.initialized).toBe(true);
    expect(snapshot.location.pathname).toBe("/users");
    expect(snapshot.appMatches).toContain("/users");
  });

  it("tracks navigation through history adapter", () => {
    const app = Route.define(Route.page("/users", Component.from<{}>(() => null)));
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
    const UserPage = Route.page("/users/:userId", Component.from<{}>(() => null)).pipe(
      Route.id("users.detail"),
      Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
    );
    const app = Route.define(UserPage);
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

  it("supports route-node navigation by reference", () => {
    const UserPage = Route.page("/users/:userId", Component.from<{}>(() => null)).pipe(
      Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
    );
    const runtime = RouterRuntime.create({
      app: Route.define(UserPage),
      history: RouterRuntime.createMemoryHistory("/"),
    });

    Effect.runSync(runtime.initialize());
    Effect.runSync(runtime.navigateApp(UserPage, { params: { userId: "alice" } }));
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.location.pathname).toBe("/users/alice");
  });

  it("loads matched route-node loaders into runtime snapshots", () => {
    const UserPage = Route.page("/users/:userId", Component.from<{}>(() => null)).pipe(
      Route.id("users.detail"),
      Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
      Route.loader((params: { readonly userId: string }) => Effect.succeed({ id: params.userId, name: "Alice" })),
    );
    const runtime = RouterRuntime.create({
      app: Route.define(UserPage),
      history: RouterRuntime.createMemoryHistory("/users/alice"),
    });

    Effect.runSync(runtime.initialize());
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(snapshot.loaderData.get("users.detail")).toEqual({ id: "alice", name: "Alice" });
  });

  it("revalidates matched loaders", () => {
    let runs = 0;
    const UserPage = Route.page("/users/:userId", Component.from<{}>(() => null)).pipe(
      Route.id("users.detail"),
      Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
      Route.loader((params: { readonly userId: string }) => Effect.sync(() => {
        runs += 1;
        return { id: params.userId, count: runs };
      })),
    );
    const runtime = RouterRuntime.create({
      app: Route.define(UserPage),
      history: RouterRuntime.createMemoryHistory("/users/alice"),
    });

    Effect.runSync(runtime.initialize());
    Effect.runSync(runtime.revalidate());
    const snapshot = Effect.runSync(runtime.snapshot());
    expect((snapshot.loaderData.get("users.detail") as any).count).toBeGreaterThanOrEqual(1);
    expect(snapshot.revalidation.phase).toBe("idle");
  });

  it("tracks fetcher and submission state in snapshots", async () => {
    const app = Route.define(Route.page("/users", Component.from<{}>(() => null)));
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
    const app = Route.define(Route.page("/users", Component.from<{}>(() => null)));
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
    const app = Route.define(Route.page("/users", Component.from<{}>(() => null)));
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
    const app = Route.define(Route.page("/users", Component.from<{}>(() => null)));
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
    const App = Route.define(
      Route.page("/users", Component.from<{}>(() => "Users Runtime Document")).pipe(
        Route.loader(() => Effect.succeed({ list: true })),
      ),
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
    const app = Route.define(Route.page("/users", Component.from<{}>(() => null)));
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
    const app = Route.define(Route.page("/users", Component.from<{}>(() => null)));
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
    const app = Route.define(Route.page("/users", Component.from<{}>(() => null)));
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
    const app = Route.define(Route.page("/users", Component.from<{}>(() => null)));
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
    const App = Route.define(
      Route.page("/users", Component.from<{}>(() => "Users Runtime Document")).pipe(
        Route.loader(() => Effect.succeed({ list: true })),
      ),
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

  it("tracks in-flight ids for submit and clears them after completion", async () => {
    const app = Route.define(Route.page("/users", Component.from<{}>(() => null)));
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
