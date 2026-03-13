import { Component } from "../Component.js";
import { Schema } from "effect";
import * as Route from "../Route.js";
import * as ServerRoute from "../ServerRoute.js";

const App = Route.path("/hello")(Component.from<{}>(() => "Hello SSR"));

const Document = ServerRoute.document(App).pipe(
  ServerRoute.method("GET"),
  ServerRoute.path("/hello"),
);

const Data = ServerRoute.json({ key: "health" }).pipe(
  ServerRoute.method("GET"),
  ServerRoute.path("/health"),
  ServerRoute.response(Schema.Struct({ ok: Schema.Boolean })),
  ServerRoute.handle(() => ServerRoute.redirect("/hello") as any),
);

void App;
void Document;
void Data;
