import { Effect } from "effect";
import { createEffect, onCleanup } from "./api.js";

type EventHandler = (event: unknown) => void;

type Cleanup = () => void;

export interface Handle {
  readonly id: string;
  listen(event: string, handler: EventHandler): Effect.Effect<Cleanup>;
  on(event: string, handler: EventHandler): Effect.Effect<void>;
  emit(event: string, eventData?: unknown): void;
  setAttr(name: string, value: unknown | (() => unknown)): Effect.Effect<void>;
  getAttr(name: string): unknown;
  setStyle(prop: string, value: () => unknown): Effect.Effect<void>;
  setStyleOnce(prop: string, value: unknown): Effect.Effect<void>;
  getStyle(prop: string): unknown;
}

export interface Interactive extends Handle {
  readonly kind: string;
}

export interface Container extends Interactive {
  readonly kind: "Container";
}

export interface Focusable extends Interactive {
  readonly kind: string;
  focus(): void;
  blur(): void;
}

export interface TextInput extends Focusable {
  readonly kind: "TextInput";
}

export interface Draggable extends Interactive {
  readonly kind: "Draggable";
}

export interface Collection<E extends Handle> {
  readonly _tag: "Collection";
  readonly items: () => ReadonlyArray<E>;
  set(items: ReadonlyArray<E>): void;
  forEach(f: (item: E, index: number) => Effect.Effect<void>): Effect.Effect<void>;
  observeEach(f: (item: E, index: number) => Effect.Effect<Cleanup | void>): Effect.Effect<void>;
}

type ListenerMap = Map<string, Set<EventHandler>>;

function makeHandle<T extends string>(tag: T): Handle & { readonly kind: T } {
  const attrs = new Map<string, unknown>();
  const styles = new Map<string, unknown>();
  const listeners: ListenerMap = new Map();

  const base: Handle & { readonly kind: T } = {
    kind: tag,
    id: `el-${Math.random().toString(36).slice(2, 10)}`,
    listen(event, handler) {
      return Effect.sync(() => {
        const set = listeners.get(event) ?? new Set<EventHandler>();
        set.add(handler);
        listeners.set(event, set);
        return () => {
          set.delete(handler);
        };
      });
    },
    on(event, handler) {
      return base.listen(event, handler).pipe(Effect.tap((cleanup) => Effect.sync(() => {
        onCleanup(() => {
          cleanup();
        });
      })), Effect.asVoid);
    },
    emit(event, eventData) {
      const set = listeners.get(event);
      if (!set) return;
      for (const handler of set) {
        handler(eventData);
      }
    },
    setAttr(name, value) {
      return Effect.sync(() => {
        if (typeof value === "function") {
          createEffect(() => {
            attrs.set(name, (value as () => unknown)());
          });
        } else {
          attrs.set(name, value);
        }
      });
    },
    getAttr(name) {
      return attrs.get(name);
    },
    setStyle(prop, value) {
      return Effect.sync(() => {
        createEffect(() => {
          styles.set(prop, value());
        });
      });
    },
    setStyleOnce(prop, value) {
      return Effect.sync(() => {
        styles.set(prop, value);
      });
    },
    getStyle(prop) {
      return styles.get(prop);
    },
  };

  return base;
}

export function interactive(): Interactive {
  return makeHandle("Interactive") as Interactive;
}

export function container(): Container {
  return makeHandle("Container") as Container;
}

export function focusable(): Focusable {
  const h = makeHandle("Focusable") as Focusable;
  h.focus = () => {
    h.emit("focus");
  };
  h.blur = () => {
    h.emit("blur");
  };
  return h;
}

export function textInput(): TextInput {
  return makeHandle("TextInput") as TextInput;
}

export function draggable(): Draggable {
  return makeHandle("Draggable") as Draggable;
}

export function collection<E extends Handle>(initial: ReadonlyArray<E> = []): Collection<E> {
  let current = initial;
  const observers = new Set<{
    run: (item: E, index: number) => Effect.Effect<Cleanup | void>;
    cleanups: Set<Cleanup>;
  }>();

  const runObserver = (observer: {
    run: (item: E, index: number) => Effect.Effect<Cleanup | void>;
    cleanups: Set<Cleanup>;
  }): void => {
    for (const cleanup of observer.cleanups) {
      cleanup();
    }
    observer.cleanups.clear();

    for (let index = 0; index < current.length; index += 1) {
      const item = current[index];
      if (item === undefined) continue;
      const out = Effect.runSync(observer.run(item, index));
      if (typeof out === "function") {
        observer.cleanups.add(out);
      }
    }
  };

  return {
    _tag: "Collection",
    items: () => current,
    set(items) {
      current = items;
      for (const observer of observers) {
        runObserver(observer);
      }
    },
    forEach(f) {
      return Effect.forEach(current, (item, index) => f(item, index)).pipe(Effect.asVoid);
    },
    observeEach(f) {
      return Effect.sync(() => {
        const observer = {
          run: f,
          cleanups: new Set<Cleanup>(),
        };
        observers.add(observer);
        runObserver(observer);

        onCleanup(() => {
          observers.delete(observer);
          for (const cleanup of observer.cleanups) {
            cleanup();
          }
          observer.cleanups.clear();
        });
      });
    },
  };
}

export const Element = {
  interactive,
  container,
  focusable,
  textInput,
  draggable,
  collection,
} as const;
