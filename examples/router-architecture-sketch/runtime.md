# Router Runtime Sketch

```ts
import { RouterRuntime } from "effect-atom-jsx/router-runtime";
import { appRoutes } from "./app-routes.js";
import { serverRoutes } from "./server-routes.js";

const runtime = RouterRuntime.create({
  app: appRoutes,
  server: serverRoutes,
  history: BrowserHistoryLive,
});

yield* runtime.initialize();

const snapshot = yield* runtime.snapshot();

snapshot.initialized;
snapshot.historyAction;
snapshot.location;
snapshot.appMatches;
snapshot.serverMatch;
snapshot.navigation;
snapshot.revalidation;
snapshot.loaderData;
snapshot.actionData;
snapshot.errors;
snapshot.fetchers;
snapshot.restoreScrollPosition;
snapshot.preventScrollReset;

yield* runtime.navigate(UserPage, {
  params: { userId: "alice" },
});

yield* runtime.submit(saveUserAction, {
  form: { id: "alice", name: "Alice Updated" },
});

yield* runtime.fetch("sidebar-user", usersDocument, {
  path: "/users/bob",
});
```

Important note:

- the snapshot is for adapters/tooling/debugging
- the internal runtime should likely be decomposed into smaller refs/services/subscriptions
- Reactivity owns freshness; runtime owns orchestration
- route/task behavior should remain extensible by services and pipeable route metadata, not by special-case runtime branches everywhere
