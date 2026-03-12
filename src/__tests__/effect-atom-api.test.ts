import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Effect } from "effect";
import { Exit, Option } from "effect";
import { Layer, ServiceMap } from "effect";
import { Stream } from "effect";
import { Schedule } from "effect";
import * as Atom from "../Atom.js";
import * as AtomRef from "../AtomRef.js";
import * as Hydration from "../Hydration.js";
import * as Result from "../Result.js";
import * as Registry from "../Registry.js";
import { Result as AsyncResult } from "../effect-ts.js";
import { createRoot, flush } from "../api.js";

const originalQueueMicrotask = globalThis.queueMicrotask;

beforeAll(() => {
  globalThis.queueMicrotask = ((cb: VoidFunction) => cb()) as typeof queueMicrotask;
});

afterAll(() => {
  globalThis.queueMicrotask = originalQueueMicrotask;
});

describe("effect-atom style API", () => {
  it("supports Atom.make writable values", () => {
    const count = Atom.make(0);
    expect(Effect.runSync(Atom.get(count))).toBe(0);
    expect(count()).toBe(0);
    Effect.runSync(Atom.set(count, 2));
    expect(Effect.runSync(Atom.get(count))).toBe(2);
    expect(count()).toBe(2);
    Effect.runSync(Atom.update(count, (n) => n + 3));
    expect(Effect.runSync(Atom.get(count))).toBe(5);

    count.set(8);
    expect(count()).toBe(8);
    count.update((n) => n + 1);
    expect(count()).toBe(9);
    const previous = count.modify((n) => [n, n + 2]);
    expect(previous).toBe(9);
    expect(count()).toBe(11);

    const readViaEffect = Effect.runSync(count.effect());
    expect(readViaEffect).toBe(11);

    Effect.runSync(count.setEffect(20));
    expect(count()).toBe(20);

    Effect.runSync(count.updateEffect((n) => n + 2));
    expect(count()).toBe(22);

    const before = Effect.runSync(count.modifyEffect((n) => [n, n + 1]));
    expect(before).toBe(22);
    expect(count()).toBe(23);
  });

  it("supports Atom.value for function-valued writable atoms", () => {
    const callback = Atom.value((n: number) => n + 1);
    expect(callback()(1)).toBe(2);

    callback.set((n: number) => n + 2);
    expect(callback()(1)).toBe(3);

    callback.update((fn) => (n: number) => fn(n) + 1);
    expect(callback()(1)).toBe(4);
  });

  it("supports Atom.derived as explicit derived constructor", () => {
    const count = Atom.make(2);
    const doubled = Atom.derived((get) => get(count) * 2);
    expect(doubled()).toBe(4);
    count.set(3);
    expect(doubled()).toBe(6);
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

    const first = byId(7);
    byId.evict(7);
    const second = byId(7);
    expect(second).not.toBe(first);

    byId.clear();
    const third = byId(7);
    expect(third).not.toBe(second);
  });

  it("supports variadic Atom.family keys", () => {
    const byPair = Atom.family((group: string, id: number) => Atom.make(`${group}:${id}`));

    const a1 = byPair("users", 1);
    const a2 = byPair("users", 1);
    const b = byPair("users", 2);

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);

    byPair.evict("users", 1);
    const a3 = byPair("users", 1);
    expect(a3).not.toBe(a1);
    expect(a3()).toBe("users:1");
  });

  it("supports Atom.family custom equals", () => {
    const byKey = Atom.family(
      (key: { id: string; version: number }) => Atom.make(`${key.id}:${key.version}`),
      {
        equals: (a, b) => a[0].id === b[0].id && a[0].version === b[0].version,
      },
    );

    const a1 = byKey({ id: "u1", version: 1 });
    const a2 = byKey({ id: "u1", version: 1 });
    expect(a1).toBe(a2);

    byKey.evict({ id: "u1", version: 1 });
    const a3 = byKey({ id: "u1", version: 1 });
    expect(a3).not.toBe(a1);
  });

  it("supports Atom.keepAlive compatibility helper", () => {
    const count = Atom.make(1);
    const kept = Atom.keepAlive(count);
    expect(kept).toBe(count);
  });

  it("supports Atom.map and withFallback", () => {
    const source = Atom.make<number | null>(2);
    const doubled = Atom.map(source, (n) => (n ?? 0) * 2);
    expect(Effect.runSync(Atom.get(doubled))).toBe(4);
    Effect.runSync(Atom.set(source, null));
    const fallback = Atom.withFallback(source, 9);
    expect(Effect.runSync(Atom.get(fallback))).toBe(9);
  });

  it("supports Atom.projection with mutable draft updates", () => {
    const base = Atom.make(1);
    const projected = Atom.projection(
      (draft: { value: number; seen: number[] }, get) => {
        const n = get(base);
        draft.value = n * 2;
        draft.seen.push(n);
      },
      { value: 0, seen: [] },
    );

    expect(Effect.runSync(Atom.get(projected))).toEqual({ value: 2, seen: [1] });
    Effect.runSync(Atom.set(base, 2));
    expect(Effect.runSync(Atom.get(projected))).toEqual({ value: 4, seen: [1, 2] });
  });

  it("supports Atom.projection return-value reconciliation for arrays", () => {
    const users = Atom.make([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ]);

    const projected = Atom.projection(
      (_draft, get) =>
        get(users).map((u) => ({ ...u, label: `${u.id}:${u.name}` })),
      [] as Array<{ id: number; name: string; label: string }>,
      { key: "id" },
    );

    const first = Effect.runSync(Atom.get(projected));
    Effect.runSync(Atom.set(users, [
      { id: 1, name: "A" },
      { id: 2, name: "Bee" },
    ]));
    const second = Effect.runSync(Atom.get(projected));

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1]?.label).toBe("2:Bee");
  });

  it("keeps previous identity when projection equals() returns true", () => {
    const source = Atom.make<number>(1);
    const projected = Atom.projection(
      (draft: { value: number }, get) => {
        draft.value = get(source) * 2;
      },
      { value: 2 },
      {
        equals: (a, b) => a.value === b.value,
      },
    );

    const first = Effect.runSync(Atom.get(projected));
    Effect.runSync(Atom.set(source, 1));
    const second = Effect.runSync(Atom.get(projected));

    expect(second).toBe(first);
  });

  it("does not mutate prior projection snapshots", () => {
    const source = Atom.make<number>(1);
    const projected = Atom.projection(
      (draft: { nested: { value: number } }, get) => {
        draft.nested.value = get(source);
      },
      { nested: { value: 0 } },
    );

    const first = Effect.runSync(Atom.get(projected));
    expect(first.nested.value).toBe(1);

    Effect.runSync(Atom.set(source, 2));
    const second = Effect.runSync(Atom.get(projected));
    expect(second.nested.value).toBe(2);
    expect(first.nested.value).toBe(1);
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

  it("supports owner-scoped ambient registry access", () => {
    let a!: Registry.Registry;
    let b!: Registry.Registry;
    const dispose = createRoot((d) => {
      a = Registry.useRegistry();
      b = Registry.useRegistry();
      return d;
    });

    expect(a).toBe(b);
    dispose();
  });

  it("creates separate ambient registries across roots", () => {
    let a!: Registry.Registry;
    let b!: Registry.Registry;

    const disposeA = createRoot((d) => {
      a = Registry.useRegistry();
      return d;
    });
    const disposeB = createRoot((d) => {
      b = Registry.useRegistry();
      return d;
    });

    expect(a).not.toBe(b);
    disposeA();
    disposeB();
  });

  it("reuses detached ambient registry outside roots", () => {
    const a = Registry.useRegistry();
    const b = Registry.useRegistry();
    expect(a).toBe(b);
  });

  it("supports AtomRef prop and updates", () => {
    const ref = AtomRef.make({ title: "a", done: false });
    expect(ref()).toEqual({ title: "a", done: false });
    const titleRef = ref.prop("title");
    expect(titleRef()).toBe("a");
    expect(titleRef.value).toBe("a");
    expect(titleRef.get()).toBe("a");
    titleRef.set("b");
    expect(ref.value.title).toBe("b");
    const previous = titleRef.modify((value) => [value, `${value}!`]);
    expect(previous).toBe("b");
    expect(ref.value.title).toBe("b!");
    ref.update((v) => ({ ...v, done: true }));
    expect(ref.value.done).toBe(true);
  });

  it("keeps nested AtomRef props linked to root state", () => {
    const ref = AtomRef.make({ meta: { title: "a", count: 1 } });
    const title = ref.prop("meta").prop("title");
    const count = ref.prop("meta").prop("count");

    title.set("b");
    expect(ref().meta.title).toBe("b");

    count.update((n) => n + 2);
    expect(ref().meta.count).toBe(3);

    ref.prop("meta").set({ title: "c", count: 10 });
    expect(title()).toBe("c");
    expect(count()).toBe(10);
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

  it("supports AtomRef.toAtom interop", () => {
    const todo = AtomRef.make({ title: "a", done: false });
    const titleRef = todo.prop("title");
    const titleAtom = AtomRef.toAtom(titleRef);
    const upper = Atom.map(titleAtom, (s) => s.toUpperCase());

    expect(upper()).toBe("A");
    titleRef.set("b");
    expect(upper()).toBe("B");
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

  it("supports hydration validation callbacks", () => {
    const registry = Registry.make();
    const count = Atom.make(1);
    const title = Atom.make("hello");

    const unknown: string[] = [];
    const missing: string[] = [];

    const validState: Array<Hydration.DehydratedAtomValue> = [
      { "~@effect-atom-jsx/DehydratedAtom": true, key: "count", value: 5, dehydratedAt: Date.now() },
    ];

    Hydration.hydrate(
      registry,
      validState,
      { count, title },
      {
        onUnknownKey: (key) => unknown.push(key),
        onMissingKey: (key) => missing.push(key),
      },
    );

    expect(unknown).toEqual([]);
    expect(missing).toEqual(["title"]);
    expect(registry.get(count)).toBe(5);

    const unknownState: Array<Hydration.DehydratedAtomValue> = [
      { "~@effect-atom-jsx/DehydratedAtom": true, key: "missing", value: 1, dehydratedAt: Date.now() },
    ];

    Hydration.hydrate(
      registry,
      unknownState,
      { count },
      {
        onUnknownKey: (key) => unknown.push(key),
      },
    );

    expect(unknown).toEqual(["missing"]);
  });

  it("supports Hydration.hydrateEffect with strict typed errors", async () => {
    const registry = Registry.make();
    const count = Atom.make(1);
    const state: Array<Hydration.DehydratedAtomValue> = [
      { "~@effect-atom-jsx/DehydratedAtom": true, key: "missing", value: 1, dehydratedAt: Date.now() },
    ];

    await expect(
      Effect.runPromise(Hydration.hydrateEffect(registry, state, { count }, { strict: true })),
    ).rejects.toMatchObject({ _tag: "HydrationUnknownKeys" });
  });

  it("converts Result <-> FetchResult", () => {
    const fromLoading = Result.fromResult(AsyncResult.loading);
    expect(Result.isInitial(fromLoading)).toBe(true);
    expect(Result.isWaiting(fromLoading)).toBe(true);

    const fromSuccess = Result.fromResult(AsyncResult.success(42));
    expect(Result.isSuccess(fromSuccess)).toBe(true);

    const asyncAgain = Result.toResult(fromSuccess);
    expect(asyncAgain).toEqual(AsyncResult.success(42));

    expect(Result.isWaiting(Result.waiting(fromSuccess))).toBe(true);

    const failure = Result.failure<number, string>("nope");
    expect(Result.isFailure(failure)).toBe(true);
    expect(Result.isNotInitial(failure)).toBe(true);
  });

  it("supports Result fromExit/map/match/all helpers", () => {
    const ok = Result.fromExit(Exit.succeed(3));
    expect(Result.isSuccess(ok)).toBe(true);

    const mapped = Result.map(ok, (n) => n * 2);
    expect(Result.isSuccess(mapped) && mapped.value === 6).toBe(true);

    const text = Result.match(mapped, {
      onInitial: () => "i",
      onSuccess: (v) => `s:${v}`,
      onFailure: () => "f",
    });
    expect(text).toBe("s:6");

    const collected = Result.all([Result.success(1), Result.success(2)] as const);
    expect(Result.isSuccess(collected) && collected.value[1] === 2).toBe(true);

    const waiting = Result.waitingFrom(Option.some(Result.success("x")));
    expect(Result.isWaiting(waiting)).toBe(true);
  });

  it("supports Result.builder fluent rendering", () => {
    const initialView = Result.builder(Result.initial<number, string>(true))
      .onInitial(() => "loading")
      .onSuccess((n) => `ok:${n}`)
      .onFailure((e) => `err:${String(e)}`)
      .render();
    expect(initialView).toBe("loading");

    const successView = Result.builder(Result.success(42, { waiting: true }))
      .onSuccess((n, meta) => `${n}/${meta.waiting}`)
      .render();
    expect(successView).toBe("42/true");

    const failureView = Result.builder(Result.failure<number, string>("boom"))
      .onFailure((e) => `err:${e}`)
      .render();
    expect(failureView).toBe("err:boom");
  });

  it("supports Atom.runtime(...).atom for Layer-backed services", async () => {
    const Greeting = ServiceMap.Service<{ readonly value: string }>("Greeting");
    const rt = Atom.runtime(Layer.succeed(Greeting, { value: "hello" }));

    const greetingAtom = rt.atom(
      Effect.service(Greeting).pipe(Effect.map((svc) => svc.value)),
    );

    await Effect.runPromise(Effect.sleep("5 millis"));
    const value = Effect.runSync(Atom.get(greetingAtom));
    expect(value._tag).toBe("Success");
    if (value._tag === "Success") {
      expect(value.value).toBe("hello");
    }

    await rt.dispose();
  });

  it("supports Atom.runtime(...).atom factory with get/result composition", async () => {
    const Greeting = ServiceMap.Service<{ readonly value: string }>("Greeting");
    const rt = Atom.runtime(Layer.succeed(Greeting, { value: "hello" }));

    const suffix = Atom.make("!");
    const greeting = rt.atom(
      Effect.service(Greeting).pipe(Effect.map((svc) => svc.value)),
    );
    const combined = rt.atom((get) => Effect.gen(function* () {
      const base = yield* get.result(greeting);
      const s = get(suffix);
      return `${base}${s}`;
    }));

    await Effect.runPromise(Effect.sleep("5 millis"));
    const first = Effect.runSync(Atom.get(combined));
    expect(first._tag).toBe("Success");
    if (first._tag === "Success") {
      expect(first.value).toBe("hello!");
    }

    suffix.set("?");
    await Effect.runPromise(Effect.sleep("5 millis"));
    const second = Effect.runSync(Atom.get(combined));
    expect(second._tag).toBe("Success");
    if (second._tag === "Success") {
      expect(second.value).toBe("hello?");
    }

    await rt.dispose();
  });

  it("propagates dependency failures through runtime.atom(get => Effect)", async () => {
    const rt = Atom.runtime(Layer.empty);
    const failing = rt.atom(Effect.fail("boom" as const));
    const composed = rt.atom((get) => Effect.gen(function* () {
      const value = yield* get.result(failing);
      return `${value}!`;
    }));

    await Effect.runPromise(Effect.sleep("5 millis"));
    const settled = Effect.runSync(Atom.get(composed));
    expect(settled._tag).toBe("Failure");
    if (settled._tag === "Failure") {
      expect(settled.error).toBe("boom");
    }

    await rt.dispose();
  });

  it("supports Atom.runtime(...).action for effectful actions", async () => {
    const values: number[] = [];
    const rt = Atom.runtime(Layer.empty);
    const fnAtom = rt.action((n: number) => Effect.sync(() => { values.push(n); }));

    fnAtom(42);
    await Effect.runPromise(Effect.sleep("5 millis"));

    expect(values).toEqual([42]);
    const state = fnAtom.result();
    expect(state._tag === "Success" || state._tag === "Refreshing").toBe(true);

    await rt.dispose();
  });

  it("supports action.runEffect for typed composition", async () => {
    const rt = Atom.runtime(Layer.empty);
    const add = rt.action((n: number) => Effect.succeed(n + 1));

    const value = await Effect.runPromise(add.runEffect(1));
    expect(value).toBe(2);

    await rt.dispose();
  });

  it("supports Atom.runtime(...).action linear mutation flow", async () => {
    const values: number[] = [];
    const rt = Atom.runtime(Layer.empty);
    const act = rt.action((n: number) => Effect.sync(() => { values.push(n); }));

    act(7);
    await Effect.runPromise(Effect.sleep("5 millis"));

    expect(values).toEqual([7]);
    expect(act.pending()).toBe(false);
    await rt.dispose();
  });

  it("supports Atom.effect standalone async atoms", async () => {
    const source = Atom.effect(() => Effect.promise(() => Promise.resolve(42)));

    Effect.runSync(Atom.get(source));
    await Effect.runPromise(Effect.sleep("5 millis"));
    const settled = Effect.runSync(Atom.get(source));
    expect(settled._tag).toBe("Success");
    if (settled._tag === "Success") {
      expect(settled.value).toBe(42);
    }
  });

  it("supports Atom.projectionAsync for async derived projection state", async () => {
    const source = Atom.make(1);
    const rt = Atom.runtime(Layer.empty);
    const projected = Atom.projectionAsync(
      (draft: { value: number }, get) =>
        Effect.sync(() => {
          draft.value = get(source) * 10;
        }),
      { value: 0 },
      { runtime: rt.managed },
    );

    await Effect.runPromise(Effect.sleep("10 millis"));
    const first = Effect.runSync(Atom.get(projected));
    expect(first._tag).toBe("Success");
    if (first._tag === "Success") {
      expect(first.value.value).toBe(10);
    }

    Effect.runSync(Atom.set(source, 2));
    await Effect.runPromise(Effect.sleep("10 millis"));
    const second = Effect.runSync(Atom.get(projected));
    expect(second._tag).toBe("Success");
    if (second._tag === "Success") {
      expect(second.value.value).toBe(20);
    }

    await rt.dispose();
  });

  it("supports Atom.projectionAsync failure channel", async () => {
    const rt = Atom.runtime(Layer.empty);
    const projected = Atom.projectionAsync<{ value: number }, string>(
      () => Effect.fail("boom"),
      { value: 0 },
      { runtime: rt.managed },
    );

    await Effect.runPromise(Effect.sleep("10 millis"));
    const state = Effect.runSync(Atom.get(projected));
    expect(state._tag).toBe("Failure");
    if (state._tag === "Failure") {
      expect(state.error).toBe("boom");
    }

    await rt.dispose();
  });

  it("reconciles async projection arrays by key", async () => {
    const rt = Atom.runtime(Layer.empty);
    const source = Atom.make<number>(0);
    const projected = Atom.projectionAsync<Array<{ id: string; value: number }>, never>(
      (_draft, get) =>
        Effect.sync(() => {
          const n = get(source);
          return [
            { id: "a", value: 1 },
            { id: "b", value: n + 1 },
          ];
        }),
      [],
      { key: "id", runtime: rt.managed },
    );

    await Effect.runPromise(Effect.sleep("10 millis"));
    const first = Effect.runSync(Atom.get(projected));
    expect(first._tag).toBe("Success");

    Effect.runSync(Atom.set(source, 1));
    await Effect.runPromise(Effect.sleep("10 millis"));
    const second = Effect.runSync(Atom.get(projected));
    expect(second._tag).toBe("Success");

    if (first._tag === "Success" && second._tag === "Success") {
      expect(second.value[0]).toBe(first.value[0]);
      expect(second.value[1]).not.toBe(first.value[1]);
      expect(second.value[1]?.value).toBe(2);
    }

    await rt.dispose();
  });

  it("supports Context.result and addFinalizer", () => {
    let finalized = false;
    const asyncAtom = Atom.make((get) => {
      get.addFinalizer(() => {
        finalized = true;
      });
      return AsyncResult.success(1);
    });

    const value = Effect.runSync(Atom.get(asyncAtom));
    expect(value._tag).toBe("Success");

    const unwrapAtom = Atom.make((get) =>
      Effect.runSync(get.result(asyncAtom))
    );
    expect(Effect.runSync(Atom.get(unwrapAtom))).toBe(1);

    const stop = Atom.subscribe(asyncAtom, () => {});
    stop();
    expect(finalized).toBe(true);
  });

  it("supports Atom.result helper", () => {
    const ok = Atom.readable(() => AsyncResult.success(123));
    expect(Effect.runSync(Atom.result(ok))).toBe(123);

    const fail = Atom.readable(() => AsyncResult.failure("boom" as const));
    expect(() => Effect.runSync(Atom.result(fail))).toThrow();
  });

  it("supports Atom.pull for incremental stream pagination", async () => {
    const pullAtom = Atom.pull(Stream.make(1, 2, 3), { chunkSize: 2 });

    expect(Result.isInitial(Effect.runSync(Atom.get(pullAtom)))).toBe(true);
    Effect.runSync(Atom.set(undefined)(pullAtom));
    await Effect.runPromise(Effect.sleep("10 millis"));

    const first = Effect.runSync(Atom.get(pullAtom));
    expect(Result.isSuccess(first)).toBe(true);
    if (Result.isSuccess(first)) {
      expect(first.value.items).toEqual([1, 2]);
      expect(first.value.done).toBe(false);
    }

    Effect.runSync(Atom.set(undefined)(pullAtom));
    const second = Effect.runSync(Atom.get(pullAtom));
    expect(Result.isSuccess(second)).toBe(true);
    if (Result.isSuccess(second)) {
      expect(second.value.items).toEqual([1, 2, 3]);
      expect(second.value.done).toBe(true);
    }
  });

  it("supports Atom.kvs with custom storage", () => {
    const storage = new Map<string, string>();
    const kvsAtom = Atom.kvs({
      key: "flag",
      defaultValue: () => false,
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
        removeItem: (key) => {
          storage.delete(key);
        },
      },
    });

    expect(Effect.runSync(Atom.get(kvsAtom))).toBe(false);
    Effect.runSync(Atom.set(kvsAtom, true));
    expect(Effect.runSync(Atom.get(kvsAtom))).toBe(true);
    expect(storage.get("flag")).toBe("true");
  });

  it("supports Atom.searchParam read/write", () => {
    const prevWindow = (globalThis as any).window;
    let popstateHandler: ((event: unknown) => void) | undefined;

    (globalThis as any).window = {
      location: {
        href: "https://example.com/?page=1",
        search: "?page=1",
      },
      history: {
        state: null,
        replaceState: (_state: unknown, _title: string, next: string) => {
          const url = new URL(next);
          (globalThis as any).window.location.href = url.toString();
          (globalThis as any).window.location.search = url.search;
        },
      },
      addEventListener: (name: string, handler: (event: unknown) => void) => {
        if (name === "popstate") popstateHandler = handler;
      },
      removeEventListener: (name: string) => {
        if (name === "popstate") popstateHandler = undefined;
      },
    };

    try {
      const page = Atom.searchParam("page");
      expect(Effect.runSync(Atom.get(page))).toBe("1");

      Effect.runSync(Atom.set(page, "2"));
      expect((globalThis as any).window.location.search).toBe("?page=2");

      (globalThis as any).window.location.search = "?page=3";
      if (popstateHandler !== undefined) {
        popstateHandler({});
      }
      expect(Effect.runSync(Atom.get(page))).toBe("3");
    } finally {
      (globalThis as any).window = prevWindow;
    }
  });

  it("supports withReactivity and invalidateReactivity", () => {
    let count = 0;
    const base = Atom.make(() => {
      count += 1;
      return count;
    });
    const reactive = Atom.withReactivity(base, ["counter"]);

    expect(Effect.runSync(Atom.get(reactive))).toBe(1);
    Atom.invalidateReactivity(["counter"]);
    expect(Effect.runSync(Atom.get(reactive))).toBe(2);
  });

  it("supports atom.pipe for composable transforms", () => {
    const value = Atom.make<string | null>("  hello  ").pipe(
      Atom.map((s) => s?.trim() ?? null),
      Atom.withFallback(""),
    );
    expect(value()).toBe("hello");
  });

  it("supports Atom.withOptimistic as a pipeable wrapper", () => {
    const count = Atom.make(1);
    const optimistic = count.pipe(Atom.withOptimistic());

    expect(optimistic()).toBe(1);
    optimistic.set(5);
    expect(optimistic()).toBe(5);
    optimistic.clear();
    expect(optimistic()).toBe(1);
  });

  it("supports optimistic.withEffect lifecycle composition", async () => {
    const count = Atom.make(1);
    const optimistic = count.pipe(Atom.withOptimistic());
    const program = optimistic.withEffect(
      (prev) => prev + 10,
      Effect.succeed("ok").pipe(Effect.delay("10 millis")),
    );

    expect(optimistic()).toBe(11);
    const out = await Effect.runPromise(program);
    expect(out).toBe("ok");
    expect(optimistic()).toBe(1);
  });

  it("supports Atom.runtimeEffect for effectful bootstrap", async () => {
    const runtime = await Effect.runPromise(Atom.runtimeEffect(Layer.empty));
    const value = runtime.atom(Effect.succeed(42));
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(value()._tag).toBe("Success");
    await runtime.dispose();
  });

  it("supports withRetry / withPolling / withStaleTime pipeables", async () => {
    let attempts = 0;
    const source = Atom.readable(
      () => {
        attempts += 1;
        return attempts < 2
          ? AsyncResult.failure("retry" as const)
          : AsyncResult.success(attempts);
      },
      (refresh) => {
        refresh(source);
      },
    );

    const retried = source.pipe(Atom.withRetry(Schedule.recurs(2)));
    void retried();
    await Effect.runPromise(Effect.sleep("20 millis"));
    void retried();
    await Effect.runPromise(Effect.sleep("40 millis"));
    expect(attempts).toBeGreaterThan(1);
    expect(retried()._tag === "Success" || retried()._tag === "Failure").toBe(true);

    let ticks = 0;
    const polledSource = Atom.readable(
      () => {
        ticks += 1;
        return AsyncResult.success(ticks);
      },
      (refresh) => {
        refresh(polledSource);
      },
    );
    const polled = polledSource.pipe(Atom.withPolling(Schedule.recurs(2)));
    void polled();
    await Effect.runPromise(Effect.sleep("40 millis"));
    expect(polled()._tag).toBe("Success");

    let staleRuns = 0;
    const staleSource = Atom.readable(
      () => {
        staleRuns += 1;
        return AsyncResult.success(staleRuns);
      },
      (refresh) => {
        refresh(staleSource);
      },
    );
    const stale = staleSource.pipe(Atom.withStaleTime(10));
    void stale();
    await Effect.runPromise(Effect.sleep("40 millis"));
    expect(stale()._tag).toBe("Success");

  });

  it("supports Atom.action with reactivity key invalidation", async () => {
    let runCount = 0;
    const counter = Atom.withReactivity(Atom.make(() => ++runCount), ["counter"]);
    const increment = Atom.action(
      (_: void) => Effect.void,
      { reactivityKeys: ["counter"] },
    );

    expect(Effect.runSync(Atom.get(counter))).toBe(1);
    increment(undefined);
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(Effect.runSync(Atom.get(counter))).toBe(2);
  });

  it("supports Atom.action onTransition hooks", async () => {
    const phases: string[] = [];
    const save = Atom.action(
      (n: number) => n > 0 ? Effect.void : Effect.fail("bad" as const),
      {
        name: "save-count",
        onTransition: (event) => phases.push(event.phase),
      },
    );

    save(1);
    await Effect.runPromise(Effect.sleep("10 millis"));
    save(0);
    await Effect.runPromise(Effect.sleep("10 millis"));

    expect(phases.includes("start")).toBe(true);
    expect(phases.includes("success")).toBe(true);
    expect(phases.includes("failure") || phases.includes("defect")).toBe(true);
  });

  it("supports runtime.action onTransition hooks", async () => {
    const runtime = Atom.runtime(Layer.empty);
    const phases: string[] = [];
    const run = runtime.action(
      (n: number) => n > 0 ? Effect.succeed(n) : Effect.fail("bad" as const),
      {
        name: "runtime-save",
        onTransition: (event) => phases.push(event.phase),
      },
    );

    run(1);
    await Effect.runPromise(Effect.sleep("10 millis"));
    run(0);
    await Effect.runPromise(Effect.sleep("10 millis"));

    expect(phases.includes("start")).toBe(true);
    expect(phases.includes("success")).toBe(true);
    expect(phases.includes("failure") || phases.includes("defect")).toBe(true);
    await runtime.dispose();
  });

  it("supports out-of-order stream chunk merge and hydration", () => {
    let state = Atom.Stream.emptyState<number>();

    state = Atom.Stream.applyChunk(state, { sequence: 1, items: [20, 21] });
    expect(state.items).toEqual([]);
    expect(state.nextSequence).toBe(0);

    state = Atom.Stream.applyChunk(state, { sequence: 0, items: [10] });
    expect(state.items).toEqual([10, 20, 21]);
    expect(state.nextSequence).toBe(2);

    state = Atom.Stream.applyChunk(state, { sequence: 2, items: [30], done: true });
    expect(state.items).toEqual([10, 20, 21, 30]);
    expect(state.complete).toBe(true);

    const hydrated = Atom.Stream.hydrateState<number>(JSON.parse(JSON.stringify(state)));
    expect(hydrated.items).toEqual([10, 20, 21, 30]);
    expect(hydrated.complete).toBe(true);
  });

  it("treats duplicate OOO chunks as idempotent", () => {
    let state = Atom.Stream.emptyState<number>();

    state = Atom.Stream.applyChunk(state, { sequence: 0, items: [1] });
    const once = state;

    state = Atom.Stream.applyChunk(state, { sequence: 0, items: [1] });
    expect(state).toBe(once);
    expect(state.items).toEqual([1]);

    state = Atom.Stream.applyChunk(state, { sequence: 1, items: [2], done: true });
    expect(state.items).toEqual([1, 2]);
    expect(state.complete).toBe(true);
  });
});
