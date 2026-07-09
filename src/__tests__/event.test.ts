import { describe, expect, it } from "vitest";
import { Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect";
import * as Component from "../Component.js";
import * as Event from "../Event.js";

const FileDropped = Event.channel("file.dropped").pipe(
  Event.schema(Schema.Struct({ id: Schema.String })),
);

describe("Event contracts", () => {
  it("ingests schema-validated values and delivers them through a scoped stream", async () => {
    const seen: string[] = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const received = yield* Deferred.make<void>();
          yield* Effect.forkChild(
            Component.subscription(
              Event.stream(FileDropped).pipe(
              Stream.tap((drop) => Effect.gen(function* () {
                  seen.push(drop.id);
                  yield* Deferred.succeed(received, undefined);
                })),
              ),
            ),
          );
          yield* Effect.yieldNow;
          expect(yield* Event.ingest(FileDropped, { id: "upload-1" })).toBe(true);
          yield* Deferred.await(received);
        }),
      ).pipe(Effect.provide(Event.layer(FileDropped, { strategy: "sliding", capacity: 4 }))) as Effect.Effect<void, Schema.SchemaError, never>,
    );

    expect(seen).toEqual(["upload-1"]);
  });

  it("rejects invalid ingress before publishing", async () => {
    const exit = await Effect.runPromiseExit(
      Event.ingest(FileDropped, { id: 42 }).pipe(
        Effect.provide(Event.layer(FileDropped, { strategy: "bounded", capacity: 1 })),
      ),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("keeps independently provided channels isolated", async () => {
    const Other = Event.channel("other").pipe(Event.schema(Schema.String));
    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const collected = yield* Effect.forkChild(Stream.runCollect(Event.stream(Other).pipe(Stream.take(1))));
          yield* Effect.yieldNow;
          yield* Event.publish(FileDropped, { id: "not-other" });
          yield* Event.publish(Other, "other");
          return yield* Fiber.join(collected);
        }),
      ).pipe(Effect.provide(Layer.mergeAll(
        Event.layer(FileDropped, { strategy: "sliding", capacity: 2 }),
        Event.layer(Other, { strategy: "sliding", capacity: 2 }),
      ))),
    );
    expect([...values]).toEqual(["other"]);
  });
});
