# SSR Sketch

```ts
import { Effect, Layer } from "effect";
import { Route } from "effect-atom-jsx";
import { UsersLive } from "./domain-services.js";
import { appRoutes } from "./app-routes.js";

const renderResult = yield* Route.renderRequest(appRoutes, {
  request: new Request("http://example.com/users/alice"),
  layer: Layer.mergeAll(
    UsersLive,
    HistoryServerLive,
    DocumentRendererLive,
  ),
});

renderResult.status;
renderResult.headers;
renderResult.head;
renderResult.html;
renderResult.loaderPayload;
renderResult.deferred;
```

Then bridge it through a server route:

```ts
const server = ServerRoute.define(
  ServerRoute.document(
    { method: "GET", path: "*" },
    appRoutes,
    { document: HtmlDocument },
  ),
);
```

This keeps:

- `Route` responsible for structured app rendering
- `ServerRoute` responsible for request dispatch
- adapters responsible for turning structured results into host responses
