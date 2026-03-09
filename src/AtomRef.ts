/**
 * AtomRef.ts — Mutable object/array references with per-property reactive refs.
 *
 * `AtomRef` provides fine-grained reactivity over structured data. Each property
 * can be accessed as its own ref, enabling granular subscriptions and updates
 * without replacing the entire object.
 */

import { createSignal, createEffect } from "./api.js";
import { Owner, runWithOwner } from "./owner.js";

const TypeId = "~effect-atom-jsx/AtomRef" as const;

/** A read-only reactive reference with subscribe and map capabilities. */
export interface ReadonlyRef<A> {
  readonly [TypeId]: typeof TypeId;
  /** Debug key identifying this ref in the hierarchy. */
  readonly key: string;
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

function readonlyRef<A>(key: string, read: () => A): ReadonlyRef<A> {
  return {
    [TypeId]: TypeId,
    key,
    get value() {
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
  };
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
  const children = new Map<PropertyKey, AtomRef<any>>();

  const base = readonlyRef("root", getValue);
  const self = {
    prop<K extends keyof A>(prop: K): AtomRef<A[K]> {
      const cached = children.get(prop);
      if (cached) return cached as AtomRef<A[K]>;

      const childBase = readonlyRef(`root.${String(prop)}`, () => getValue()[prop]);
      const child = {
        prop<P extends keyof A[K]>(nextProp: P): AtomRef<A[K][P]> {
          return make(getValue()[prop]).prop(nextProp);
        },
        set(value: A[K]) {
          setValue((prev) => {
            if (prev[prop] === value) return prev;
            if (Array.isArray(prev)) {
              const copy = [...(prev as unknown as Array<unknown>)];
              copy[prop as number] = value;
              return copy as unknown as A;
            }
            return { ...(prev as Record<string, unknown>), [prop as string]: value } as A;
          });
          return child as AtomRef<A[K]>;
        },
        update(f: (value: A[K]) => A[K]) {
          (child as AtomRef<A[K]>).set(f(getValue()[prop]));
          return child as AtomRef<A[K]>;
        },
      } as AtomRef<A[K]>;
      Object.setPrototypeOf(child, childBase);

      children.set(prop, child as AtomRef<any>);
      return child as AtomRef<A[K]>;
    },
    set(value: A) {
      setValue(value);
      return self as AtomRef<A>;
    },
    update(f: (value: A) => A) {
      setValue((prev) => f(prev));
      return self as AtomRef<A>;
    },
  } as AtomRef<A>;
  Object.setPrototypeOf(self, base);

  return self;
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

  const collectionRef = {
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
  } as Collection<A>;
  Object.setPrototypeOf(collectionRef, base);
  return collectionRef;
};
