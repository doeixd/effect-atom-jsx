import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import * as Atom from "../Atom.js";
import * as AtomRef from "../AtomRef.js";
import * as Hydration from "../Hydration.js";
import * as Result from "../Result.js";
import * as Registry from "../Registry.js";
import { AsyncResult } from "../effect-ts.js";

describe("effect-atom style API", () => {
  it("supports Atom.make writable values", () => {
    const count = Atom.make(0);
    expect(Effect.runSync(Atom.get(count))).toBe(0);
    Effect.runSync(Atom.set(count, 2));
    expect(Effect.runSync(Atom.get(count))).toBe(2);
    Effect.runSync(Atom.update(count, (n) => n + 3));
    expect(Effect.runSync(Atom.get(count))).toBe(5);
  });

  it("supports Atom.make readable values", () => {
    const base = Atom.make(10);
    const doubled = Atom.make((get) => get(base) * 2);
    expect(Effect.runSync(Atom.get(doubled))).toBe(20);
    Effect.runSync(Atom.set(base, 7));
    expect(Effect.runSync(Atom.get(doubled))).toBe(14);
  });

  it("supports Atom.family", () => {
    const byId = Atom.family((id: number) => Atom.make(id * 10));
    expect(byId(1)).toBe(byId(1));
    expect(Effect.runSync(Atom.get(byId(3)))).toBe(30);
  });

  it("supports Atom.map and withFallback", () => {
    const source = Atom.make<number | null>(2);
    const doubled = Atom.map(source, (n) => (n ?? 0) * 2);
    expect(Effect.runSync(Atom.get(doubled))).toBe(4);
    Effect.runSync(Atom.set(source, null));
    const fallback = Atom.withFallback(source, 9);
    expect(Effect.runSync(Atom.get(fallback))).toBe(9);
  });

  it("supports Atom.modify", () => {
    const count = Atom.make(2);
    const ret = Effect.runSync(Atom.modify(count, (n) => [`was-${n}`, n + 5]));
    expect(ret).toBe("was-2");
    expect(Effect.runSync(Atom.get(count))).toBe(7);
  });

  it("supports Registry operations", () => {
    const registry = Registry.make();
    const count = Atom.make(1);
    expect(registry.get(count)).toBe(1);
    registry.set(count, 4);
    expect(registry.get(count)).toBe(4);
    const changed: number[] = [];
    const unsub = registry.subscribe(count, (v) => changed.push(v));
    registry.update(count, (n) => n + 1);
    expect(changed).toEqual([4, 5]);
    unsub();
    registry.dispose();
  });

  it("supports AtomRef prop and updates", () => {
    const ref = AtomRef.make({ title: "a", done: false });
    const titleRef = ref.prop("title");
    expect(titleRef.value).toBe("a");
    titleRef.set("b");
    expect(ref.value.title).toBe("b");
    ref.update((v) => ({ ...v, done: true }));
    expect(ref.value.done).toBe(true);
  });

  it("supports AtomRef collections", () => {
    const todos = AtomRef.collection([{ title: "one" }, { title: "two" }]);
    expect(todos.toArray().length).toBe(2);
    todos.push({ title: "three" });
    expect(todos.toArray().map((t) => t.title)).toEqual(["one", "two", "three"]);
    const first = todos.value[0]!;
    todos.remove(first);
    expect(todos.toArray().map((t) => t.title)).toEqual(["two", "three"]);
  });

  it("supports Hydration dehydrate/hydrate", () => {
    const registry = Registry.make();
    const count = Atom.make(1);
    const title = Atom.make("hello");
    const dump = Hydration.dehydrate(registry, [["count", count], ["title", title]]);

    registry.set(count, 9);
    registry.set(title, "changed");
    Hydration.hydrate(registry, dump, { count, title });

    expect(registry.get(count)).toBe(1);
    expect(registry.get(title)).toBe("hello");
  });

  it("converts AsyncResult <-> Result", () => {
    const fromLoading = Result.fromAsyncResult(AsyncResult.loading);
    expect(Result.isInitial(fromLoading)).toBe(true);
    expect(Result.isWaiting(fromLoading)).toBe(true);

    const fromSuccess = Result.fromAsyncResult(AsyncResult.success(42));
    expect(Result.isSuccess(fromSuccess)).toBe(true);

    const asyncAgain = Result.toAsyncResult(fromSuccess);
    expect(asyncAgain).toEqual(AsyncResult.success(42));

    expect(Result.isWaiting(Result.waiting(fromSuccess))).toBe(true);

    const failure = Result.failure<number, string>("nope");
    expect(Result.isFailure(failure)).toBe(true);
    expect(Result.isNotInitial(failure)).toBe(true);
  });
});
