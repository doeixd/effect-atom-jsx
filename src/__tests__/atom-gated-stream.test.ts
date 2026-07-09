import { describe, expect, it } from "vitest";
import { Effect, Fiber, Stream } from "effect";
import { createRoot, createSignal, flush } from "../api.js";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";

describe("Atom.Stream.gated + Component.subscription", () => {
  it("gated stream emits while active", async () => {
    const dispose = createRoot((d) => {
      const [open] = createSignal(true);
      void open;
      return d;
    });
    // Re-create signals inside root for tracking
    let items: number[] = [];
    await new Promise<void>((resolve, reject) => {
      createRoot((d) => {
        const [open] = createSignal(true);
        const stream = Atom.Stream.gated(
          open,
          () => Stream.make(1, 2, 3),
          { isActive: (v) => v === true },
        );
        Effect.runPromise(
          Effect.scoped(Stream.runCollect(stream.pipe(Stream.take(3)))),
        )
          .then((chunk) => {
            items = [...chunk];
            d();
            resolve();
          })
          .catch((error) => {
            d();
            reject(error);
          });
      });
    });
    expect(items).toEqual([1, 2, 3]);
    dispose();
  });

  it("gated stream yields no items when inactive", async () => {
    let timedOutEmpty = false;
    await new Promise<void>((resolve, reject) => {
      createRoot((d) => {
        const [open] = createSignal(false);
        const stream = Atom.Stream.gated(
          open,
          () => Stream.make(9),
          { isActive: (v) => v === true },
        );
        Effect.runPromise(
          Effect.scoped(
            Stream.runCollect(stream.pipe(Stream.take(1))).pipe(
              Effect.timeout("80 millis"),
              Effect.map(() => false),
              Effect.catch(() => Effect.succeed(true)),
            ),
          ),
        )
          .then((empty) => {
            timedOutEmpty = empty;
            d();
            resolve();
          })
          .catch((error) => {
            d();
            reject(error);
          });
      });
    });
    expect(timedOutEmpty).toBe(true);
  });

  it("restarts inner stream when deps change (finalizers run)", async () => {
    const starts: number[] = [];
    const finals: number[] = [];

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const [key, setKey] = createSignal(1);
        const stream = Atom.Stream.gated(
          key,
          ({ deps }) => {
            starts.push(deps);
            return Stream.make(`v${deps}`).pipe(
              Stream.ensuring(Effect.sync(() => {
                finals.push(deps);
              })),
              Stream.concat(Stream.never),
            );
          },
          { restartOnDepsChange: true },
        );

        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fiber = yield* Effect.forkChild(
                Stream.runForEach(stream, () => Effect.void),
              );
              yield* Effect.sleep("40 millis");
              setKey(2);
              flush();
              yield* Effect.sleep("50 millis");
              yield* Fiber.interrupt(fiber);
            }),
          ),
        )
          .then(() => {
            dispose();
            resolve();
          })
          .catch((error) => {
            dispose();
            reject(error);
          });
      });
    });

    expect(starts).toContain(1);
    expect(starts).toContain(2);
    expect(finals).toContain(1);
  });

  it("keepAliveEquivalence suppresses restart when deps are equivalent", async () => {
    const starts: number[] = [];

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const [dep, setDep] = createSignal({ id: 1, noise: 0 });
        const stream = Atom.Stream.gated(
          dep,
          ({ deps }) => {
            starts.push(deps.id);
            return Stream.make(deps.id).pipe(Stream.concat(Stream.never));
          },
          {
            restartOnDepsChange: true,
            keepAliveEquivalence: (a, b) => a.id === b.id,
          },
        );

        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fiber = yield* Effect.forkChild(
                Stream.runForEach(stream, () => Effect.void),
              );
              yield* Effect.sleep("30 millis");
              setDep({ id: 1, noise: 99 });
              flush();
              yield* Effect.sleep("30 millis");
              setDep({ id: 2, noise: 0 });
              flush();
              yield* Effect.sleep("40 millis");
              yield* Fiber.interrupt(fiber);
            }),
          ),
        )
          .then(() => {
            dispose();
            resolve();
          })
          .catch((error) => {
            dispose();
            reject(error);
          });
      });
    });

    expect(starts.filter((s) => s === 1).length).toBe(1);
    expect(starts).toContain(2);
  });

  it("restartOnDepsChange:false still starts when inactive→active", async () => {
    const starts: number[] = [];
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const [open, setOpen] = createSignal(false);
        const stream = Atom.Stream.gated(
          open,
          () => {
            starts.push(1);
            return Stream.make(42);
          },
          {
            isActive: (v) => v === true,
            restartOnDepsChange: false,
          },
        );

        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fiber = yield* Effect.forkChild(
                Stream.runForEach(stream, () => Effect.void),
              );
              yield* Effect.sleep("20 millis");
              // still inactive — no start
              expect(starts.length).toBe(0);
              setOpen(true);
              flush();
              yield* Effect.sleep("40 millis");
              yield* Fiber.interrupt(fiber);
            }),
          ),
        )
          .then(() => {
            dispose();
            resolve();
          })
          .catch((error) => {
            dispose();
            reject(error);
          });
      });
    });
    expect(starts.length).toBe(1);
  });

  it("restartOnDepsChange:false resumes after active→idle→active", async () => {
    const starts: number[] = [];
    const finals: number[] = [];
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const [open, setOpen] = createSignal(true);
        let gen = 0;
        const stream = Atom.Stream.gated(
          open,
          () => {
            const id = ++gen;
            starts.push(id);
            return Stream.make(id).pipe(
              Stream.ensuring(Effect.sync(() => {
                finals.push(id);
              })),
              Stream.concat(Stream.never),
            );
          },
          {
            isActive: (v) => v === true,
            restartOnDepsChange: false,
          },
        );

        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fiber = yield* Effect.forkChild(
                Stream.runForEach(stream, () => Effect.void),
              );
              yield* Effect.sleep("30 millis");
              setOpen(false); // idle
              flush();
              yield* Effect.sleep("30 millis");
              setOpen(true); // resume — must start again even with restart false
              flush();
              yield* Effect.sleep("40 millis");
              yield* Fiber.interrupt(fiber);
            }),
          ),
        )
          .then(() => {
            dispose();
            resolve();
          })
          .catch((error) => {
            dispose();
            reject(error);
          });
      });
    });
    expect(starts.length).toBe(2);
    expect(finals).toContain(1); // first generation finalized on idle
  });

  it("Component.subscription restarts when deps change and runs finalizers", async () => {
    const seen: number[] = [];
    const finals: number[] = [];

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const [n, setN] = createSignal(0);
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fiber = yield* Effect.forkChild(
                Component.subscription(
                  n,
                  ({ deps }) =>
                    Stream.make(deps).pipe(
                      Stream.ensuring(Effect.sync(() => {
                        finals.push(deps);
                      })),
                      Stream.concat(Stream.never),
                    ),
                  {
                    onEvent: (v) => {
                      seen.push(v);
                    },
                    restartOnDepsChange: true,
                  },
                ),
              );
              yield* Effect.sleep("30 millis");
              setN(1);
              flush();
              yield* Effect.sleep("50 millis");
              yield* Fiber.interrupt(fiber);
            }),
          ),
        )
          .then(() => {
            dispose();
            resolve();
          })
          .catch((error) => {
            dispose();
            reject(error);
          });
      });
    });

    expect(seen).toContain(0);
    expect(seen).toContain(1);
    expect(finals).toContain(0);
  });
});
