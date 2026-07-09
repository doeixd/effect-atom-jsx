import { describe, expect, it } from "vitest";
import { Deferred, Effect, Layer, PubSub, ServiceMap, Stream } from "effect";
import * as Component from "../Component.js";
import * as Reactivity from "../Reactivity.js";

type FileDrop = {
  readonly id: string;
  readonly files: ReadonlyArray<string>;
};

// Phase-0 baseline: this is deliberately direct Effect PubSub wiring. The
// eventual Event contract must remove meaningful boilerplate from this shape
// without changing its delivery or scope semantics.
const FileDropped = ServiceMap.Service<PubSub.PubSub<FileDrop>>("event-spike/FileDropped");
const FileDroppedLive = Layer.effect(FileDropped, PubSub.sliding<FileDrop>(16));
const Files = Reactivity.Key.family("files");

describe("direct PubSub event vertical slice", () => {
  it("delivers through Component.subscription, invalidates a typed key, and finalizes with scope", async () => {
    const seen: FileDrop[] = [];
    const lifecycle = { finalized: 0 };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pubsub = yield* Effect.service(FileDropped);
          const reactivity = yield* Effect.service(Reactivity.ReactivityTag);
          const received = yield* Deferred.make<void>();
          // Subscribe before publishing so this test has no timing/sleep race.
          const subscription = yield* PubSub.subscribe(pubsub);

          const stream = Stream.fromSubscription(subscription).pipe(
            Stream.tap((drop) =>
              Effect.gen(function* () {
                seen.push(drop);
                yield* reactivity.invalidate(Files(drop.id).keys);
                yield* Deferred.succeed(received, undefined);
              }),
            ),
            Stream.ensuring(Effect.sync(() => {
              lifecycle.finalized += 1;
            })),
          );

          yield* Effect.forkChild(Component.subscription(stream));

          const accepted = yield* PubSub.publish(pubsub, {
            id: "upload-1",
            files: ["report.pdf"],
          });
          expect(accepted).toBe(true);

          yield* Deferred.await(received);
          yield* reactivity.flush();
          const invalidated = reactivity.lastInvalidated === undefined
            ? []
            : yield* reactivity.lastInvalidated();

          expect(seen).toEqual([{ id: "upload-1", files: ["report.pdf"] }]);
          expect(invalidated).toEqual(["files", "files:upload-1"]);
        }),
      ).pipe(Effect.provide(Layer.mergeAll(FileDroppedLive, Reactivity.test))),
    );

    expect(lifecycle.finalized).toBe(1);
  });
});
