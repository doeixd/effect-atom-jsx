# Server Routes Sketch

```ts
import { Effect, Schema } from "effect";
import { ServerRoute } from "effect-atom-jsx/server";
import { SaveUserInput, UsersService } from "./domain-services.js";
import { appRoutes } from "./app-routes.js";

const HealthResponse = Schema.Struct({ ok: Schema.Boolean });

export const saveUserAction = ServerRoute.action({ key: "save-user" }).pipe(
  ServerRoute.method("POST"),
  ServerRoute.path(ServerRoute.generatedPath("save-user")),
  ServerRoute.form(SaveUserInput),
  ServerRoute.handle(({ form }) => Effect.gen(function* () {
    const users = yield* UsersService;
    return yield* users.save(form);
  })),
);

export const usersDocument = ServerRoute.document(appRoutes).pipe(
  ServerRoute.method("GET"),
  ServerRoute.path("/users/*"),
  ServerRoute.documentRenderer(HtmlDocument),
);

export const apiHealth = ServerRoute.json({ key: "health-check" }).pipe(
  ServerRoute.method("GET"),
  ServerRoute.path("/api/health"),
  ServerRoute.response(HealthResponse),
  ServerRoute.handle(() => Effect.succeed({ ok: true as const })),
);

export const serverRoutes = ServerRoute.define(
  usersDocument,
  saveUserAction,
  apiHealth,
);

type SaveUserForm = ServerRoute.FormOf<typeof saveUserAction>;
type HealthResponse = ServerRoute.ResponseOf<typeof apiHealth>;
```

Notes:

- app routes and server routes stay separate concepts
- document routes can target app route trees by reference
- constructors establish route kind/identity; pipes attach request parsing and handlers
- handler input inference follows the accumulated route metadata (`form`, `params`, `query`, etc.)
- action/resource/document path shapes can be explicit or generated/adapter-owned
