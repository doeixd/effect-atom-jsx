# Single-Flight Transport

Single-flight is designed as a runtime capability.

That means:

- loaders, services, and mutations should not depend on one transport mechanism
- Reactivity still decides what data is stale
- transport only moves mutation + loader payloads across the boundary

## Recommended model

- write normal service-first loaders and mutations
- install a `SingleFlightTransport` implementation in the runtime
- let `Atom.action(...)` use it automatically

## Installed transport behavior

When a transport is installed:

- `Atom.action(...)` and `Atom.runtime(...).action(...)` can use single-flight without explicit per-mutation transport config
- if no transport is installed, mutations still work normally
- explicit `singleFlight` options remain as overrides / fallback adapter config

Per-action override modes:

- `singleFlight: false` disables single-flight for that mutation
- `singleFlight: { mode: "force", ... }` requires single-flight and fails if no transport/fallback is available
- `singleFlight: { endpoint, ... }` can provide fetch fallback config even when no transport service is installed

## Built-in fetch adapter

Use `Route.FetchSingleFlightTransport(...)` when you want a fetch-backed adapter.

```ts
const SingleFlightLive = Route.FetchSingleFlightTransport({
  endpoint: (request) => request.name ? `/_single-flight/${request.name}` : undefined,
});
```

Then install it in your app layer.

See `examples/router-single-flight-fetch/` for a complete in-memory fetch-style demo.

## Custom transport

You can also install your own transport by providing `Route.SingleFlightTransportTag`.

```ts
const SingleFlightLive = Layer.succeed(Route.SingleFlightTransportTag, {
  execute: (request) => {
    if (request.name === "save-user") {
      return saveUserHandler(request);
    }
    return Effect.succeed({ ok: false, error: { message: "Unknown mutation" } });
  },
});
```

This is useful for:

- tests
- in-memory demos
- RPC systems
- worker/message-channel bridges
- framework-specific routing layers

See `examples/router-single-flight/` for a complete custom-transport demo.

## Side-by-side guidance

- use `Route.SingleFlightTransportTag` directly when your host runtime already has its own transport or RPC layer
- use `Route.FetchSingleFlightTransport(...)` when fetch/HTTP is the natural integration boundary
- both approaches keep `Atom.action(...)` transparent once the transport is installed

## Public API roles

- `Atom.action(...)` is the main client mutation API
- `Route.singleFlight(...)` is the main server orchestration API
- `Route.SingleFlightTransportTag` is the runtime integration point
- `Route.FetchSingleFlightTransport(...)` is one transport adapter

## Why this is better

- app code stays transport-agnostic
- single-flight can be mostly transparent to end users
- transport can be swapped without changing domain logic
- Reactivity remains the source of truth for refresh behavior
