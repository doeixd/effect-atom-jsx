import * as Component from "../Component.js";
import { Schema } from "effect";
import * as Route from "../Route.js";
import * as RouterRuntime from "../RouterRuntime.js";
import * as ServerRoute from "../ServerRoute.js";

const App = Route.define(
  Route.page("/users/:userId", Component.from<{}>(() => null)).pipe(
    Route.id("users.detail"),
    Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
  ),
);

const SaveUser = ServerRoute.action({ key: "save-user" }).pipe(
  ServerRoute.method("POST"),
  ServerRoute.path(ServerRoute.generatedPath("save-user")),
  ServerRoute.form(Schema.Struct({ name: Schema.String })),
);

const runtime = RouterRuntime.create({
  app: App,
  server: ServerRoute.define(SaveUser),
  history: RouterRuntime.createMemoryHistory("/users/alice"),
});

const runtimeLayer = RouterRuntime.toLayer(runtime, RouterRuntime.createMemoryHistory("/users/alice"));

void runtime;
void runtime.navigateApp(App, { params: { userId: "alice" } });
void runtime.submit(SaveUser, { formData: new FormData() });
void runtimeLayer;
