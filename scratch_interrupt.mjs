import { Effect, Exit, Fiber, Deferred } from "effect";

const program = Effect.gen(function* () {
  const started = yield* Deferred.make();
  let onInterruptFired = false;
  let exitSeenInterrupted = null;

  const loader = Effect.never.pipe(
    Effect.onInterrupt(() => Effect.sync(() => { onInterruptFired = true; })),
  );

  const body = Effect.gen(function* () {
    yield* Deferred.succeed(started, true);
    const exit = yield* Effect.exit(loader);
    exitSeenInterrupted = Exit.isInterrupted(exit);
    return exit;
  });

  const fiber = Effect.runFork(body);
  yield* Deferred.await(started);
  yield* Effect.sleep(10);
  yield* Fiber.interrupt(fiber);
  yield* Effect.sleep(10);
  console.log("onInterruptFired:", onInterruptFired);
  console.log("exitSeenInterrupted (did Effect.exit catch external interrupt?):", exitSeenInterrupted);
});

Effect.runPromise(program);
