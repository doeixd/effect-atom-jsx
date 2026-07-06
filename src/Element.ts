import { Effect } from "effect";
import { createEffect, onCleanup } from "./api.js";
import * as MetadataToken from "./MetadataToken.js";

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

export type CapabilityParent = string | MetadataToken.MetadataToken<"element.capability", string>;

export interface Capability<
  Name extends string = string,
  Extends extends readonly CapabilityParent[] = readonly [],
> extends MetadataToken.MetadataToken<"element.capability", Name> {
  readonly extends: Extends;
}

export namespace Capability {
  export type Any = Capability<string, readonly CapabilityParent[]>;
  export type NameOf<T> = MetadataToken.NameOf<T>;
  export type NamesOf<T extends readonly unknown[]> = MetadataToken.NamesOf<T>;
  export type ExtendsOf<T> = T extends Capability<any, infer Extends> ? MetadataToken.NameOf<Extends[number]> : never;
  export type AssignableNamesOf<T> =
    T extends string ? T
      : T extends Capability<any, infer Extends>
        ? MetadataToken.NameOf<T> | AssignableNamesOf<Extends[number]>
        : MetadataToken.NameOf<T>;

  const parentsByName = new Map<string, ReadonlyArray<string>>();

  export function make<const Name extends string, const Extends extends readonly CapabilityParent[] = readonly []>(
    name: Name,
    options?: {
      readonly extends?: Extends;
    },
  ): Capability<Name, Extends> {
    const parents = options?.extends ?? [] as unknown as Extends;
    parentsByName.set(name, parents.map((parent) => MetadataToken.nameOf(parent)));
    return {
      ...MetadataToken.make("element.capability", name),
      extends: parents,
    };
  }

  export const Base = make("Base");
  export const Interactive = make("Interactive", { extends: [Base] });
  export const Container = make("Container", { extends: [Interactive] });
  export const Focusable = make("Focusable", { extends: [Interactive] });
  export const TextInput = make("TextInput", { extends: [Focusable] });
  export const Draggable = make("Draggable", { extends: [Interactive] });
  export const Collection = make("Collection", { extends: [Base] });

  export function extendsCapability(value: string | Any, base: string | Any): boolean {
    const valueName = MetadataToken.nameOf(value);
    const baseName = MetadataToken.nameOf(base);
    if (valueName === baseName) return true;
    const visited = new Set<string>();
    const stack = [...(parentsByName.get(valueName) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === baseName) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      stack.push(...(parentsByName.get(current) ?? []));
    }
    return false;
  }
}

export function nameOfCapability(value: string | Capability.Any): string {
  return MetadataToken.nameOf(value);
}

export function extendsCapability(value: string | Capability.Any, base: string | Capability.Any): boolean {
  return Capability.extendsCapability(value, base);
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
  const h = makeHandle("TextInput") as TextInput;
  h.focus = () => {
    h.emit("focus");
  };
  h.blur = () => {
    h.emit("blur");
  };
  return h;
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
  Capability,
  nameOfCapability,
  extendsCapability,
  interactive,
  container,
  focusable,
  textInput,
  draggable,
  collection,
} as const;
