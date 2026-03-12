import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as ServerRoute from "../ServerRoute.js";

describe("ServerRoute", () => {
  it("builds a typed action route node", () => {
    const SaveUser = ServerRoute.action({ key: "save-user" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path(ServerRoute.generatedPath("save-user")),
      ServerRoute.form(Schema.Struct({ id: Schema.String, name: Schema.String })),
      ServerRoute.handle(({ form }) => Effect.succeed({ ok: true as const, id: form.id, name: form.name })),
    );

    expect(SaveUser.kind).toBe("action");
    expect(SaveUser.method).toBe("POST");
    expect(SaveUser.path).toBe("/_server/save-user");
    expect(typeof SaveUser.handler).toBe("function");
  });

  it("supports document routes that reference app route nodes", () => {
    const App = Route.define(Route.page("/users", Component.from<{}>(() => null)));
    const Document = ServerRoute.document(App).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/users/*"),
      ServerRoute.documentRenderer({ shell: "html" }),
    );

    expect(Document.kind).toBe("document");
    expect(Document.app).toBe(App);
    expect(Document.path).toBe("/users/*");
  });

  it("groups server route nodes into a route graph", () => {
    const health = ServerRoute.json({ key: "health" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/health"),
      ServerRoute.response(Schema.Struct({ ok: Schema.Boolean })),
      ServerRoute.handle(() => Effect.succeed({ ok: true })),
    );

    const routes = ServerRoute.define(health);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toBe(health);
  });

  it("provides server-route graph helpers", () => {
    const health = ServerRoute.json({ key: "health" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/health"),
    );
    const duplicate = ServerRoute.json({ key: "health" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/health"),
    );
    const routes = ServerRoute.define(health, duplicate);

    expect(ServerRoute.nodes(routes)).toBe(routes);
    expect(ServerRoute.byKey(routes, "health")).toBe(health);
    expect(ServerRoute.identity(health)).toBe("health");
    const errors = ServerRoute.validate(routes);
    expect(errors.some((e) => e.includes("Duplicate server route key 'health'"))).toBe(true);
    expect(errors.some((e) => e.includes("Duplicate server route method/path 'GET:/health'"))).toBe(true);
  });

  it("validates missing handlers and invalid document decode wiring", () => {
    const App = Route.define(Route.page("/users", Component.from<{}>(() => null)));
    const badAction = ServerRoute.action({ key: "bad-action" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path("/bad-action"),
    );
    const badDocument = ServerRoute.document(App).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/users"),
      ServerRoute.form(Schema.Struct({ name: Schema.String })),
    );

    const errors = ServerRoute.validate(ServerRoute.define(badAction, badDocument));
    expect(errors.some((e) => e.includes("Missing handler for server route 'bad-action'"))).toBe(true);
    expect(errors.some((e) => e.includes("cannot declare form/body decoding"))).toBe(true);
  });

  it("detects overlapping document route patterns", () => {
    const App = Route.define(Route.page("/users", Component.from<{}>(() => null)));
    const A = ServerRoute.document(App).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/users/:id"),
    );
    const B = ServerRoute.document(App).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/users/:userId"),
    );

    const errors = ServerRoute.validate(ServerRoute.define(A, B));
    expect(errors.some((e) => e.includes("Overlapping document route"))).toBe(true);
  });

  it("executes typed form-decoded handlers", async () => {
    const SaveUser = ServerRoute.action({ key: "save-user" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path("/users/:userId"),
      ServerRoute.params(Schema.Struct({ userId: Schema.String })),
      ServerRoute.form(Schema.Struct({ name: Schema.String })),
      ServerRoute.response(Schema.Struct({ id: Schema.String, name: Schema.String })),
      ServerRoute.handle(({ params, form }) => Effect.succeed({ id: params.userId, name: form.name })),
    );

    const form = new FormData();
    form.set("name", "Alice");
    const result = await Effect.runPromise(ServerRoute.execute(
      SaveUser,
      new Request("http://example.com/users/alice", {
        method: "POST",
        body: form,
      }),
    ));

    expect(result.response).toEqual({ id: "alice", name: "Alice" });
    expect(result.encoded).toEqual({ id: "alice", name: "Alice" });
  });

  it("executes typed JSON body-decoded handlers", async () => {
    const UpdateUser = ServerRoute.json({ key: "update-user" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path("/api/users"),
      ServerRoute.body(Schema.Struct({ id: Schema.String, name: Schema.String })),
      ServerRoute.response(Schema.Struct({ ok: Schema.Boolean, id: Schema.String })),
      ServerRoute.handle(({ body }) => Effect.succeed({ ok: true as const, id: body.id })),
    );

    const result = await Effect.runPromise(ServerRoute.execute(
      UpdateUser,
      new Request("http://example.com/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "alice", name: "Alice" }),
      }),
    ));

    expect(result.response).toEqual({ ok: true, id: "alice" });
  });

  it("supports redirect control flow and response shaping", async () => {
    const Redirecting = ServerRoute.action({ key: "redirect-user" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path("/redirect-user"),
      ServerRoute.handle(() => Effect.gen(function* () {
        const response = yield* Route.ServerResponseTag;
        response.setHeader("x-test", "1");
        return yield* ServerRoute.redirect("/users/alice", 303);
      })),
    );

    const result = await Effect.runPromise(ServerRoute.execute(
      Redirecting,
      new Request("http://example.com/redirect-user", { method: "POST" }),
    ));

    expect(result.redirect).toEqual({ location: "/users/alice", status: 303 });
    expect(result.status).toBe(303);
    expect(result.headers.get("x-test")).toEqual(["1"]);
  });

  it("supports notFound control flow", async () => {
    const Missing = ServerRoute.json({ key: "missing" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/missing"),
      ServerRoute.handle(() => ServerRoute.notFound()),
    );

    const result = await Effect.runPromise(ServerRoute.execute(
      Missing,
      new Request("http://example.com/missing"),
    ));

    expect(result.notFound).toBe(true);
    expect(result.status).toBe(404);
  });

  it("decodes query, headers, and cookies with schemas", async () => {
    const Search = ServerRoute.json({ key: "search" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/search"),
      ServerRoute.query(Schema.Struct({ q: Schema.String })),
      ServerRoute.headers(Schema.Struct({ "x-request-id": Schema.String })),
      ServerRoute.cookies(Schema.Struct({ session: Schema.String })),
      ServerRoute.response(Schema.Struct({ ok: Schema.Boolean, q: Schema.String, requestId: Schema.String, session: Schema.String })),
      ServerRoute.handle(({ query, headers, cookies }) => Effect.succeed({
        ok: true as const,
        q: query.q,
        requestId: headers["x-request-id"],
        session: cookies.session,
      })),
    );

    const result = await Effect.runPromise(ServerRoute.execute(
      Search,
      new Request("http://example.com/search?q=alice", {
        headers: {
          "x-request-id": "req-1",
          cookie: "session=s123",
        },
      }),
    ));

    expect(result.response).toEqual({ ok: true, q: "alice", requestId: "req-1", session: "s123" });
  });

  it("executes from provided request/response services", async () => {
    const Search = ServerRoute.json({ key: "search" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/search"),
      ServerRoute.query(Schema.Struct({ q: Schema.String })),
      ServerRoute.response(Schema.Struct({ ok: Schema.Boolean, q: Schema.String })),
      ServerRoute.handle(({ query }) => Effect.gen(function* () {
        const response = yield* Route.ServerResponseTag;
        response.setStatus(202);
        return { ok: true as const, q: query.q };
      })),
    );

    const responseService = {
      status: 200,
      headers: new Map<string, Array<string>>(),
      setStatus(status: number) {
        this.status = status;
      },
      setHeader(name: string, value: string) {
        this.headers.set(name.toLowerCase(), [value]);
      },
      appendHeader(name: string, value: string) {
        const key = name.toLowerCase();
        this.headers.set(key, [...(this.headers.get(key) ?? []), value]);
      },
      redirect(location: string, status = 302) {
        this.status = status;
        this.headers.set("location", [location]);
      },
      notFound() {
        this.status = 404;
      },
      snapshot() {
        return { status: this.status, headers: this.headers as ReadonlyMap<string, ReadonlyArray<string>> };
      },
    };

    const result = await Effect.runPromise(ServerRoute.executeFromServices(Search).pipe(
      Effect.provideService(Route.ServerRequestTag, {
        request: new Request("http://example.com/search?q=alice"),
        url: new URL("http://example.com/search?q=alice"),
      }),
      Effect.provideService(Route.ServerResponseTag, responseService),
    ) as Effect.Effect<ServerRoute.ExecuteResult<{ readonly ok: true; readonly q: string }>, never, never>);

    expect(result.response).toEqual({ ok: true, q: "alice" });
    expect(result.status).toBe(202);
  });

  it("supports Route server convenience helpers", async () => {
    const HelperRoute = ServerRoute.json({ key: "helper" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/helper"),
      ServerRoute.response(Schema.Struct({ ok: Schema.Boolean })),
      ServerRoute.handle(() => Effect.gen(function* () {
        const request = yield* Route.serverRequest;
        expect(request.url.pathname).toBe("/helper");
        yield* Route.setHeader("x-helper", "1");
        return { ok: true as const };
      })),
    );

    const result = await Effect.runPromise(ServerRoute.execute(
      HelperRoute,
      new Request("http://example.com/helper"),
    ));

    expect(result.response).toEqual({ ok: true });
    expect(result.headers.get("x-helper")).toEqual(["1"]);
  });
});
