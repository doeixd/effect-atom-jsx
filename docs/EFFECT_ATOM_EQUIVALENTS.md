# Effect-Atom Equivalents

This guide maps common `@effect-atom/atom` patterns to `effect-atom-jsx`.

Use this when migrating code or when you want effect-atom-like ergonomics on
top of the JSX runtime + Effect v4 integration.

## Quick Mapping

| `@effect-atom/atom` | `effect-atom-jsx` |
|---|---|
| `Atom.make(...)` | `Atom.make(...)` |
| `Atom.family(...)` | `Atom.family(...)` |
| `Atom.map(...)` | `Atom.map(...)` |
| `Atom.keepAlive` | `Atom.keepAlive` (compat identity helper) |
| `Atom.runtime(layer)` | `Atom.runtime(layer)` |
| `runtime.atom(effect)` | `runtime.atom(effect)` |
| `Atom.fn(...)` / `runtime.fn(...)` | `Atom.fn(...)` / `runtime.fn(...)` |
| reactivity keys (`withReactivity`, invalidation) | `Atom.withReactivity(...)`, `Atom.invalidateReactivity(...)` |
| stream pull atom (`Atom.pull`) | `Atom.pull(stream, { chunkSize? })` |
| URL param atom | `Atom.searchParam(name, codec?)` |
| key-value atom (`kvs`) | `Atom.kvs({ key, defaultValue, ... })` |

## Runtime-Bound Service Atom

```ts
import { Atom } from "effect-atom-jsx";
import { Effect, Layer, ServiceMap } from "effect";

const Users = ServiceMap.Service<{ readonly all: Effect.Effect<ReadonlyArray<string>> }>("Users");

const runtime = Atom.runtime(
  Layer.succeed(Users, { all: Effect.succeed(["alice", "bob"]) }),
);

const usersAtom = runtime.atom(
  Effect.service(Users).pipe(Effect.flatMap((svc) => svc.all)),
);
```

## Function Atoms

```ts
import { Atom } from "effect-atom-jsx";
import { Effect } from "effect";

const saveAtom = Atom.fn((payload: { id: string }) =>
  Effect.sync(() => {
    // write side effect
    void payload.id;
  }),
);

// run
Effect.runSync(Atom.set(saveAtom, { id: "1" }));
```

## Reactivity Keys

```ts
import { Atom } from "effect-atom-jsx";

const count = Atom.withReactivity(
  Atom.make(() => Date.now()),
  ["counter"],
);

Atom.invalidateReactivity(["counter"]);
```

Structured keys are also supported:

```ts
Atom.withReactivity(atom, { counter: [1, 2] });
// invalidates: "counter", "counter:1", "counter:2"
```

## Pulling From Streams

```ts
import { Atom, Result } from "effect-atom-jsx";
import { Effect, Stream } from "effect";

const feed = Atom.pull(Stream.make(1, 2, 3), { chunkSize: 2 });

Effect.runSync(Atom.set(feed, undefined)); // first pull
const first = Effect.runSync(Atom.get(feed));

if (Result.isSuccess(first)) {
  console.log(first.value.items); // [1, 2]
}
```

## URL Search Params

```ts
import { Atom } from "effect-atom-jsx";
import { Effect } from "effect";

const page = Atom.searchParam("page");
Effect.runSync(Atom.set(page, "2"));
```

With custom parse/serialize:

```ts
const pageNumber = Atom.searchParam("page", {
  parse: (raw) => (raw ? Number(raw) : 1),
  serialize: (n) => String(n),
});
```

## Key-Value Storage

```ts
import { Atom } from "effect-atom-jsx";
import { Effect } from "effect";

const darkMode = Atom.kvs({
  key: "dark-mode",
  defaultValue: () => false,
});

Effect.runSync(Atom.set(darkMode, true));
```

## Notes

- `Atom.keepAlive` is a compatibility alias in this package and currently returns the same atom.
- `Atom.searchParam` is browser-only (SSR-safe reads return `null` / codec default behavior).
- `Atom.pull` currently materializes the stream once and exposes incremental chunks via repeated writes.
