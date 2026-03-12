/**
 * AtomRef.ts — Mutable object/array references with per-property reactive refs.
 *
 * `AtomRef` provides fine-grained reactivity over structured data. Each property
 * can be accessed as its own ref, enabling granular subscriptions and updates
 * without replacing the entire object.
 */

import { createSignal, createEffect } from "./api.js";
import { Owner, runWithOwner } from "./owner.js";
import * as Atom from "./Atom.js";

const TypeId = "~effect-atom-jsx/AtomRef" as const;

/** A read-only reactive reference with subscribe and map capabilities. */
export interface ReadonlyRef<A> {
  (): A;
  readonly [TypeId]: typeof TypeId;
  /** Debug key identifying this ref in the hierarchy. */
  readonly key: string;
  /** Read current value (method form). */
  readonly get: () => A;
  /** The current reactive value. Reading this inside a computation tracks it. */
  readonly value: A;
  /** Subscribe to value changes. Returns an unsubscribe function. */
  readonly subscribe: (f: (a: A) => void) => () => void;
  /** Derive a new ReadonlyRef by transforming this ref's value. */
  readonly map: <B>(f: (a: A) => B) => ReadonlyRef<B>;
}

/** A mutable reactive reference with property drilling, set, and update. */
export interface AtomRef<A> extends ReadonlyRef<A> {
  /** Access a nested property as its own AtomRef for granular updates. */
  readonly prop: <K extends keyof A>(prop: K) => AtomRef<A[K]>;
  /** Replace the current value. Returns the ref for chaining. */
  readonly set: (value: A) => AtomRef<A>;
  /** Update the value using a function of the current value. Returns the ref for chaining. */
  readonly update: (f: (value: A) => A) => AtomRef<A>;
  /** Read-modify-write and return an additional computed value. */
  readonly modify: <B>(f: (value: A) => [B, A]) => B;
}

/** A reactive list of AtomRefs with array mutation helpers. */
export interface Collection<A> extends ReadonlyRef<ReadonlyArray<AtomRef<A>>> {
  /** Append an item to the end of the collection. */
  readonly push: (item: A) => Collection<A>;
  /** Insert an item at the given index. */
  readonly insertAt: (index: number, item: A) => Collection<A>;
  /** Remove a specific ref from the collection by identity. */
  readonly remove: (ref: AtomRef<A>) => Collection<A>;
  /** Snapshot all ref values into a plain array. */
  readonly toArray: () => Array<A>;
}

/**
 * Convert an `AtomRef` into a standard writable `Atom` for interop with
 * `Atom.map`, `Atom.withFallback`, and other atom combinators.
 */
export const toAtom = <A>(ref: AtomRef<A>): Atom.Writable<A, A> =>
  Atom.writable(
    () => ref(),
    (_ctx, value) => {
      ref.set(value);
    },
  );

function readonlyRef<A>(key: string, read: () => A): ReadonlyRef<A> {
  const self = (() => read()) as ReadonlyRef<A>;
  const out = {
    [TypeId]: TypeId,
    key,
    get() {
      return read();
    },
    subscribe(f) {
      const owner = new Owner();
      runWithOwner(owner, () => {
        createEffect(() => {
          f(read());
        });
      });
      return () => owner.dispose();
    },
    map<B>(f: (a: A) => B) {
      return readonlyRef(`${key}.map`, () => f(read()));
    },
  } as Omit<ReadonlyRef<A>, "value">;
  Object.assign(self, out);
  Object.defineProperty(self, "value", {
    enumerable: true,
    configurable: true,
    get: () => read(),
  });
  return self;
}

/**
 * Create a mutable object/array reference with per-property refs.
 *
 * @example
 * const todo = AtomRef.make({ title: "a", done: false })
 * todo.prop("title").set("b")
 * todo.update((t) => ({ ...t, done: true }))
 */
export const make = <A>(initial: A): AtomRef<A> => {
  const [getValue, setValue] = createSignal(initial);
  const refs = new Map<string, AtomRef<any>>();

  const keyOfPath = (path: ReadonlyArray<PropertyKey>): string =>
    JSON.stringify(path.map((part) => [typeof part, String(part)]));

  const readAtPath = (path: ReadonlyArray<PropertyKey>): unknown => {
    let current: unknown = getValue();
    for (const part of path) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<PropertyKey, unknown>)[part];
    }
    return current;
  };

  const writeAtPath = (target: unknown, path: ReadonlyArray<PropertyKey>, value: unknown): unknown => {
    if (path.length === 0) return value;
    const [head, ...tail] = path;
    if (Array.isArray(target)) {
      const copy = [...target];
      copy[head as number] = writeAtPath(target[head as number], tail, value);
      return copy;
    }
    const record = (target ?? {}) as Record<PropertyKey, unknown>;
    return {
      ...record,
      [head]: writeAtPath(record[head], tail, value),
    };
  };

  const makeAtPath = <T>(path: ReadonlyArray<PropertyKey>): AtomRef<T> => {
    const cacheKey = keyOfPath(path);
    const cached = refs.get(cacheKey);
    if (cached) return cached as AtomRef<T>;

    const read = () => readAtPath(path) as T;
    const label = path.length === 0 ? "root" : `root.${path.map(String).join(".")}`;
    const base = readonlyRef(label, read);
    const ref = (() => read()) as AtomRef<T>;

    Object.assign(ref, {
      prop<K extends keyof T>(prop: K): AtomRef<T[K]> {
        return makeAtPath<T[K]>([...path, prop as PropertyKey]);
      },
      set(value: T) {
        setValue((prev) => writeAtPath(prev, path, value) as A);
        return ref;
      },
      update(f: (value: T) => T) {
        ref.set(f(read()));
        return ref;
      },
      modify<B>(f: (value: T) => [B, T]) {
        const [ret, next] = f(read());
        ref.set(next);
        return ret;
      },
    });

    Object.setPrototypeOf(ref, base);
    refs.set(cacheKey, ref as AtomRef<any>);
    return ref;
  };

  return makeAtPath<A>([]);
};

/**
 * Create a collection reference with list-like mutation helpers.
 *
 * @example
 * const todos = AtomRef.collection([{ title: "one" }])
 * todos.push({ title: "two" })
 * const first = todos.value[0]
 * if (first) todos.remove(first)
 */
export const collection = <A>(items: Iterable<A>): Collection<A> => {
  const [getItems, setItems] = createSignal(Array.from(items).map((item) => make(item)));

  const base = readonlyRef<ReadonlyArray<AtomRef<A>>>("collection", getItems);

  const collectionRef = (() => getItems()) as unknown as Collection<A>;
  Object.assign(collectionRef, {
    push(item: A) {
      setItems((prev) => [...prev, make(item)]);
      return collectionRef as Collection<A>;
    },
    insertAt(index: number, item: A) {
      setItems((prev) => {
        const at = Math.max(0, Math.min(index, prev.length));
        return [...prev.slice(0, at), make(item), ...prev.slice(at)];
      });
      return collectionRef as Collection<A>;
    },
    remove(ref: AtomRef<A>) {
      setItems((prev) => prev.filter((candidate) => candidate !== ref));
      return collectionRef as Collection<A>;
    },
    toArray() {
      return getItems().map((ref) => ref.value);
    },
  });
  Object.setPrototypeOf(collectionRef, base);
  return collectionRef;
};
