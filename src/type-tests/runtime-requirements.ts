import { Effect, Layer, ServiceMap } from "effect";
import * as Atom from "../Atom.js";

const Api = ServiceMap.Service<{ readonly load: () => Effect.Effect<number> }>("Api");
const Db = ServiceMap.Service<{ readonly read: () => Effect.Effect<string> }>("Db");

const runtime = Atom.runtime(Layer.succeed(Api, { load: () => Effect.succeed(1) }));

// Requirement subset accepted (Api is provided by runtime layer)
runtime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.load();
  }),
);

runtime.action(
  (_: void) =>
    Effect.gen(function* () {
      const api = yield* Api;
      yield* api.load();
      return undefined;
    }),
);

// Missing requirement rejected at compile time
runtime.atom(
  // @ts-expect-error Db is not part of runtime layer
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.read();
  }),
);

runtime.action(
  // @ts-expect-error Db is not part of runtime layer
  (_: void) =>
    Effect.gen(function* () {
      const db = yield* Db;
      yield* db.read();
      return undefined;
    }),
);
