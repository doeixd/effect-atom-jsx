import { describe, it, expect } from "vitest";
import { Effect, Stream, Queue } from "effect";
import * as Atom from "../Atom.js";
import { createRoot } from "../api.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("Atom.fromStream", () => {
  it("receives values from a finite stream", async () => {
    const stream = Stream.make(10, 20, 30);
    const atom = Atom.fromStream(stream, 0);

    let latest: number = 0;
    const dispose = createRoot((d) => {
      Atom.subscribe(atom, (v) => { latest = v; });
      return d;
    });

    // Allow microtasks to flush
    await tick(50);
    expect(latest).toBe(30);
    dispose();
  });

  it("receives values from a delayed stream", async () => {
    const stream = Stream.fromIterable([1, 2, 3]).pipe(
      Stream.tap(() => Effect.sleep("10 millis")),
    );
    const atom = Atom.fromStream(stream, 0);

    const values: number[] = [];
    const dispose = createRoot((d) => {
      Atom.subscribe(atom, (v) => values.push(v));
      return d;
    });

    await tick(100);
    expect(values).toContain(1);
    expect(values).toContain(2);
    expect(values).toContain(3);
    dispose();
  });
});

describe("Atom.fromQueue", () => {
  it("starts with initial value", async () => {
    const queue = await Effect.runPromise(Queue.unbounded<number>());
    const atom = Atom.fromQueue(queue, 99);
    const val = Effect.runSync(Atom.get(atom));
    expect(val).toBe(99);
  });

  it("receives values offered to the queue", async () => {
    const queue = await Effect.runPromise(Queue.unbounded<number>());
    const atom = Atom.fromQueue(queue, 0);

    let latest = 0;
    const dispose = createRoot((d) => {
      Atom.subscribe(atom, (v) => { latest = v; });
      return d;
    });

    await Effect.runPromise(Queue.offer(queue, 42));
    await tick(50);
    expect(latest).toBe(42);

    await Effect.runPromise(Queue.offer(queue, 100));
    await tick(50);
    expect(latest).toBe(100);

    dispose();
  });
});
