import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as ServerRoute from "../ServerRoute.js";
import * as RouterRuntime from "../RouterRuntime.js";

describe("Server render bridge", () => {
  it("renders a route into a structured request result", () => {
    const App = Route.title("Hello")(
      Route.id("hello")(
        Route.path("/hello")(Component.from<{}>(() => "Hello SSR")),
      ),
    );

    const result = Effect.runSync(Route.renderRequest(App, {
      request: new Request("http://example.com/hello"),
    }));

    expect(result.status).toBe(200);
    expect(result.html).toBe("Hello SSR");
    expect(result.head.title).toBe("Hello");
    expect(result.loaderPayload).toEqual([]);
  });

  it("renders a unified route tree into a structured request result", () => {
    const App = Route.title("Unified Hello")(
      Route.path("/unified-hello")(Component.from<{}>(() => "Hello Unified SSR")),
    );

    const result = Effect.runSync(Route.renderRequest(App, {
      request: new Request("http://example.com/unified-hello"),
    }));

    expect(result.status).toBe(200);
    expect(result.html).toBe("Hello Unified SSR");
    expect(result.head.title).toBe("Unified Hello");
  });

  it("executes a document server route through Route.renderRequest", () => {
    const App = Route.path("/users")(Component.from<{}>(() => "Users Document"));
    const Document = ServerRoute.document(App).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/users"),
    );

    const result = Effect.runSync(ServerRoute.runDocument(
      Document,
      new Request("http://example.com/users"),
    ));

    expect(result.html).toBe("Users Document");
    expect(result.status).toBe(200);
  });

  it("dispatches document and data server routes", async () => {
    const App = Route.loader((_: {}) => Effect.succeed({ list: true as const }))(
      Route.path("/users")(Component.from<{}>(() => "Users Document")),
    );
    const Document = ServerRoute.document(App).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/users"),
    );
    const Data = ServerRoute.json({ key: "health" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/health"),
      ServerRoute.response(Schema.Struct({ ok: Schema.Boolean })),
      ServerRoute.handle(() => Effect.succeed({ ok: true as const })),
    );

    const documentResult = await Effect.runPromise(ServerRoute.dispatch(
      ServerRoute.define(Document, Data),
      new Request("http://example.com/users"),
    ));
    expect(documentResult._tag).toBe("document");
    if (documentResult._tag === "document") {
      expect(documentResult.result.html).toBe("Users Document");
      expect(documentResult.result.loaderPayload.length).toBeGreaterThanOrEqual(1);
    }

    const dataResult = await Effect.runPromise(ServerRoute.dispatch(
      ServerRoute.define(Document, Data),
      new Request("http://example.com/health"),
    ));
    expect(dataResult._tag).toBe("data");
    if (dataResult._tag === "data") {
      expect(dataResult.result.response).toEqual({ ok: true });
    }

    const documentResponse = ServerRoute.toResponse(documentResult);
    expect(documentResponse.html).toBe("Users Document");
    const dataResponse = ServerRoute.toResponse(dataResult);
    expect(dataResponse.body).toEqual({ ok: true });
  });

  it("supports runtime-backed render and dispatch helpers", async () => {
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

    const renderResult = await Effect.runPromise(Route.renderRequestWithRuntime(
      runtime,
      new Request("http://example.com/users"),
    ));
    expect(renderResult.html).toBe("Users Runtime Document");
    const afterRender = Effect.runSync(runtime.snapshot());
    expect(afterRender.location.pathname).toBe("/users");
    expect(afterRender.loaderData.size).toBeGreaterThanOrEqual(1);
    expect(afterRender.requestState.phase).toBe("idle");

    const dispatchResult = await Effect.runPromise(ServerRoute.dispatchWithRuntime(
      runtime,
      new Request("http://example.com/health"),
    ));
    expect(dispatchResult._tag).toBe("data");
    const afterDispatch = Effect.runSync(runtime.snapshot());
    expect(afterDispatch.location.pathname).toBe("/health");
    expect(afterDispatch.requestState.phase).toBe("idle");
  });
});
