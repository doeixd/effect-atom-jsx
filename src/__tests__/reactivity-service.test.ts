import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as Reactivity from "../Reactivity.js";
import * as Atom from "../Atom.js";
import { installReactivityService } from "../reactivity-runtime.js";

describe("Reactivity service", () => {
  it("supports subscribe/invalidate with manual flush in test layer", () => {
    const eff = Effect.gen(function* () {
      const service = yield* Reactivity.ReactivityTag;
      let count = 0;
      const unsubscribe = yield* service.subscribe(["users"], () => {
        count += 1;
      });

      yield* service.invalidate(["users"]);
      expect(count).toBe(0);

      yield* service.flush();
      expect(count).toBe(1);

      unsubscribe();
      yield* service.invalidate(["users"]);
      yield* service.flush();
      expect(count).toBe(1);
    }).pipe(Effect.provide(Reactivity.test));

    Effect.runSync(eff);
  });

  it("captures last invalidated keys in test layer", () => {
    const eff = Effect.gen(function* () {
      const service = yield* Reactivity.ReactivityTag;
      yield* service.invalidate(["users", "user:alice"]);
      yield* service.flush();
      const keys = service.lastInvalidated ? yield* service.lastInvalidated() : [];
      expect(keys).toEqual(["users", "user:alice"]);
    }).pipe(Effect.provide(Reactivity.test));

    Effect.runSync(eff);
  });

  it("auto-flushes in live layer on microtask", async () => {
    const eff = Effect.gen(function* () {
      const service = yield* Reactivity.ReactivityTag;
      let count = 0;
      const unsubscribe = yield* service.subscribe(["users"], () => {
        count += 1;
      });

      yield* service.invalidate(["users"]);
      return { getCount: () => count, unsubscribe };
    }).pipe(Effect.provide(Reactivity.live));

    const state = Effect.runSync(eff);
    expect(state.getCount()).toBe(0);
    await Promise.resolve();
    expect(state.getCount()).toBe(1);
    state.unsubscribe();
  });

  it("bridges service invalidation into Atom.withReactivity tracking", () => {
    const service = Effect.runSync(
      Effect.service(Reactivity.ReactivityTag).pipe(Effect.provide(Reactivity.test)) as Effect.Effect<Reactivity.ReactivityService, never, never>,
    );

    const restore = installReactivityService(service);
    try {
      let reads = 0;
      const base = Atom.readable(() => {
        reads += 1;
        return reads;
      }).pipe(Atom.withReactivity(["users"]));

      expect(base()).toBe(1);
      Effect.runSync(service.invalidate(["users"]));
      Effect.runSync(service.flush());
      expect(base()).toBe(2);
    } finally {
      restore();
    }
  });

  it("tracks explicit keys through Reactivity.tracked", () => {
    const service = Effect.runSync(
      Effect.service(Reactivity.ReactivityTag).pipe(Effect.provide(Reactivity.test)) as Effect.Effect<Reactivity.ReactivityService, never, never>,
    );

    const restore = installReactivityService(service);
    try {
      let runs = 0;
      const atom = Atom.readable(() => {
        runs += 1;
        return Effect.runSync(Reactivity.tracked(Effect.sync(() => runs), { keys: ["users"] }));
      });

      expect(atom()).toBe(1);
      Effect.runSync(service.invalidate(["users"]));
      Effect.runSync(service.flush());
      expect(atom()).toBe(2);
    } finally {
      restore();
    }
  });

  it("accepts key witnesses in tracked/invalidating with string parity", () => {
    const service = Effect.runSync(
      Effect.service(Reactivity.ReactivityTag).pipe(Effect.provide(Reactivity.test)) as Effect.Effect<Reactivity.ReactivityService, never, never>,
    );

    const Users = Reactivity.Key.make("users");

    const restore = installReactivityService(service);
    try {
      let runs = 0;
      const atom = Atom.readable(() => {
        runs += 1;
        return Effect.runSync(Reactivity.tracked(Effect.sync(() => runs), { keys: [Users] }));
      });

      expect(atom()).toBe(1);
      // invalidate by plain string: witness-tracked reads must still refresh
      Effect.runSync(Reactivity.invalidating(Effect.void, ["users"]));
      Effect.runSync(service.flush());
      expect(atom()).toBe(2);
      // invalidate by witness
      Effect.runSync(Reactivity.invalidating(Effect.void, [Users]));
      Effect.runSync(service.flush());
      expect(atom()).toBe(3);
    } finally {
      restore();
    }
  });

  it("expands child witnesses to ancestors plus self, matching record-form semantics", () => {
    const service = Effect.runSync(
      Effect.service(Reactivity.ReactivityTag).pipe(Effect.provide(Reactivity.test)) as Effect.Effect<Reactivity.ReactivityService, never, never>,
    );

    const Users = Reactivity.Key.make("users");
    const alice = Users.child("alice");
    expect(alice.name).toBe("users:alice");
    expect(alice.keys).toEqual(["users", "users:alice"]);

    const restore = installReactivityService(service);
    try {
      // invalidating a child must notify a parent-key observer
      Effect.runSync(Reactivity.invalidating(Effect.void, [alice]));
      Effect.runSync(service.flush());
      const keys = service.lastInvalidated ? Effect.runSync(service.lastInvalidated()) : [];
      expect(keys).toEqual(["users", "users:alice"]);
    } finally {
      restore();
    }
  });

  it("derives family members and dedupes shared ancestors", () => {
    const service = Effect.runSync(
      Effect.service(Reactivity.ReactivityTag).pipe(Effect.provide(Reactivity.test)) as Effect.Effect<Reactivity.ReactivityService, never, never>,
    );

    const todo = Reactivity.Key.family("todo");
    expect(todo(42).name).toBe("todo:42");
    expect(todo.key.name).toBe("todo");
    expect(Reactivity.Key.is(todo.key)).toBe(true);
    expect(Reactivity.Key.is("todo")).toBe(false);

    const restore = installReactivityService(service);
    try {
      // two members share the "todo" ancestor; it must appear once
      Effect.runSync(Reactivity.invalidating(Effect.void, [todo(1), todo(2)]));
      Effect.runSync(service.flush());
      const keys = service.lastInvalidated ? Effect.runSync(service.lastInvalidated()) : [];
      expect(keys).toEqual(["todo", "todo:1", "todo:2"]);
    } finally {
      restore();
    }
  });

  it("invalidates keys on successful Reactivity.invalidating mutations", () => {
    const service = Effect.runSync(
      Effect.service(Reactivity.ReactivityTag).pipe(Effect.provide(Reactivity.test)) as Effect.Effect<Reactivity.ReactivityService, never, never>,
    );

    const restore = installReactivityService(service);
    try {
      Effect.runSync(Reactivity.invalidating(Effect.succeed({ id: "alice" }), (user) => ["users", `user:${user.id}`]));
      Effect.runSync(service.flush());
      const keys = service.lastInvalidated ? Effect.runSync(service.lastInvalidated()) : [];
      expect(keys).toEqual(["users", "user:alice"]);
    } finally {
      restore();
    }
  });
});
