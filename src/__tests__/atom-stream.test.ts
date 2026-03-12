import { describe, it, expect } from "vitest";
import { Effect, Stream as FxStream, Queue, Schedule } from "effect";
import * as Atom from "../Atom.js";
import { createRoot } from "../api.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("Atom.fromStream", () => {
  it("receives values from a finite stream", async () => {
    const stream = FxStream.make(10, 20, 30);
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
    const stream = FxStream.fromIterable([1, 2, 3]).pipe(
      FxStream.tap(() => Effect.sleep("10 millis")),
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

describe("Atom.fromSchedule", () => {
  it("receives values emitted by schedule-backed stream", async () => {
    const atom = Atom.fromSchedule(Schedule.recurs(2) as any, -1 as any);

    let latest: any = -1;
    const dispose = createRoot((d) => {
      Atom.subscribe(atom, (v) => { latest = v; });
      return d;
    });

    await tick(50);
    expect(latest).not.toBe(-1);
    dispose();
  });
});

describe("Atom.Stream.textInput", () => {
  it("trims and filters short values for UI input streams", async () => {
    const source = FxStream.make("  hello  ", " ", "x", " world ");
    const cooked = Atom.Stream.textInput(source, { minLength: 2 });
    const values = await Effect.runPromise(FxStream.runCollect(cooked).pipe(Effect.map((chunk) => Array.from(chunk))));
    expect(values).toEqual(["hello", "world"]);
  });
});

describe("Atom.Stream.searchInput", () => {
  it("normalizes and de-duplicates search-box values", async () => {
    const source = FxStream.make(" Foo ", "foo", "FOO", "  bar  ", "bar");
    const cooked = Atom.Stream.searchInput(source, { minLength: 1, lowercase: true });
    const values = await Effect.runPromise(FxStream.runCollect(cooked).pipe(Effect.map((chunk) => Array.from(chunk))));
    expect(values).toEqual(["foo", "bar"]);
  });

  it("can keep duplicates when distinct is disabled", async () => {
    const source = FxStream.make("a", "a", "A");
    const cooked = Atom.Stream.searchInput(source, { lowercase: true, distinct: false });
    const values = await Effect.runPromise(FxStream.runCollect(cooked).pipe(Effect.map((chunk) => Array.from(chunk))));
    expect(values).toEqual(["a", "a", "a"]);
  });
});
