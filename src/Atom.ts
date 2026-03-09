import { Effect, Stream, Queue, Fiber, Layer, ManagedRuntime, Cause, Option } from "effect";
import { createSignal, batch as runBatch, type Accessor, createEffect, onCleanup } from "./api.js";
import { Owner, runWithOwner } from "./owner.js";
import {
  queryEffect,
  queryEffectStrict,
  mutationEffect,
  mutationEffectStrict,
  type AsyncResult,
  type Refreshing,
  type Success,
  type Failure,
  type Defect,
  type MutationEffectHandle,
  type RuntimeLike,
} from "./effect-ts.js";
import * as Result from "./Result.js";

const TypeId = "~effect-atom-jsx/Atom" as const;
const WritableTypeId = "~effect-atom-jsx/Atom/Writable" as const;

type RefreshRef = {
  readonly get: Accessor<number>;
  readonly bump: () => void;
};

const refreshMap = new WeakMap<Atom<any>, RefreshRef>();
const selfWriteMap = new WeakMap<Writable<any, any>, (value: any) => void>();

function ensureRefresh<A>(atom: Atom<A>): RefreshRef {
  const existing = refreshMap.get(atom);
  if (existing) return existing;
  const [get, set] = createSignal(0);
  const next = { get, bump: () => set((n) => n + 1) };
  refreshMap.set(atom, next);
  return next;
}

export interface Atom<A> {
  readonly [TypeId]: typeof TypeId;
  readonly read: (get: Context) => A;
  readonly refresh?: (f: <A>(atom: Atom<A>) => void) => void;
}

export interface Writable<R, W = R> extends Atom<R> {
  readonly [WritableTypeId]: typeof WritableTypeId;
  readonly write: (ctx: WriteContext<R>, value: W) => void;
}

/** Read context passed to atom `read` functions. Callable as a shorthand for `get`. */
export interface Context {
  /** Read an atom's current value (shorthand call signature). */
  <A>(atom: Atom<A>): A;
  /** Read an atom's current value, tracking it as a dependency. */
  get<A>(atom: Atom<A>): A;
  /** Force-refresh an atom and invalidate its dependents. */
  refresh<A>(atom: Atom<A>): void;
  /** Write a value to a writable atom. */
  set<R, W>(atom: Writable<R, W>, value: W): void;
  /** Read an async/result atom as an Effect value. */
  result<A, E>(atom: Atom<AsyncResult<A, E> | Result.Result<A, E>>): Effect.Effect<A, E | { readonly defect: string } | Error>;
  /** Register cleanup for the current owner scope. */
  addFinalizer(finalizer: () => void): void;
}

/** Write context passed to atom `write` functions. */
export interface WriteContext<A> {
  /** Read an atom's current value. */
  get<T>(atom: Atom<T>): T;
  /** Write a value to another writable atom. */
  set<R, W>(atom: Writable<R, W>, value: W): void;
  /** Force-refresh the current atom, re-running its read function. */
  refreshSelf(): void;
  /** Directly set the current atom's underlying signal value. */
  setSelf(value: A): void;
  /** Read an async/result atom as an Effect value. */
  result<T, E>(atom: Atom<AsyncResult<T, E> | Result.Result<T, E>>): Effect.Effect<T, E | { readonly defect: string } | Error>;
  /** Register cleanup for the current owner scope. */
  addFinalizer(finalizer: () => void): void;
}

function toEffectResult<A, E>(
  value: AsyncResult<A, E> | Result.Result<A, E>,
): Effect.Effect<A, E | { readonly defect: string } | Error> {
  const tagged = value as { readonly _tag?: string };
  switch (tagged._tag) {
    case "Loading":
      return Effect.fail(new Error("Atom is Loading"));
    case "Refreshing": {
      const previous = (value as Refreshing<A, E>).previous;
      return toEffectResult(previous as AsyncResult<A, E> | Result.Result<A, E>);
    }
    case "Success":
      return Effect.succeed((value as Success<A>).value);
    case "Failure": {
      const failure = value as Failure<E>;
      if ("error" in failure) {
        return Effect.fail(failure.error);
      }
      return Effect.fail((value as Result.Failure<A, E>).error as E | { readonly defect: string });
    }
    case "Defect":
      return Effect.fail({ defect: (value as Defect).cause });
    case "Initial":
      return Effect.fail(new Error("Result is Initial"));
    default:
      return Effect.fail(new Error("Unsupported atom result value"));
  }
}

/**
 * Type guard for unknown values.
 *
 * Useful at boundaries where atoms are passed dynamically (plugins, devtools,
 * generic helpers) and you need to narrow before calling `Atom.get`.
 */
export const isAtom = (u: unknown): u is Atom<any> =>
  typeof u === "object" && u !== null && TypeId in u;

/**
 * Type guard that narrows a read-only `Atom` to `Writable`.
 *
 * @example
 * if (Atom.isWritable(atom)) {
 *   Effect.runSync(Atom.set(atom, nextValue))
 * }
 */
export const isWritable = <R, W>(atom: Atom<R>): atom is Writable<R, W> =>
  typeof atom === "object" && atom !== null && WritableTypeId in atom;

/**
 * Low-level constructor for a read-only atom.
 *
 * @param read    - Function that computes the atom's value given a read context.
 * @param refresh - Optional callback invoked when the atom is force-refreshed.
 */
export const readable = <A>(
  read: (get: Context) => A,
  refresh?: (f: <A>(atom: Atom<A>) => void) => void,
): Atom<A> => ({
  [TypeId]: TypeId,
  read,
  refresh,
});

/**
 * Low-level constructor for a writable atom with custom read and write logic.
 *
 * @param read    - Function that computes the atom's value given a read context.
 * @param write   - Function that handles writes, receiving a write context and the new value.
 * @param refresh - Optional callback invoked when the atom is force-refreshed.
 */
export const writable = <R, W = R>(
  read: (get: Context) => R,
  write: (ctx: WriteContext<R>, value: W) => void,
  refresh?: (f: <A>(atom: Atom<A>) => void) => void,
): Writable<R, W> => ({
  [TypeId]: TypeId,
  [WritableTypeId]: WritableTypeId,
  read,
  write,
  refresh,
});

function evaluate<A>(atom: Atom<A>, ctx: Context): A {
  ensureRefresh(atom).get();
  return atom.read(ctx);
}

const defaultContext: Context = Object.assign(
  ((atom: Atom<any>) => evaluate(atom, defaultContext)) as Context,
  {
    get<A>(atom: Atom<A>): A {
      return evaluate(atom, defaultContext);
    },
    refresh<A>(atom: Atom<A>): void {
      const ref = ensureRefresh(atom);
      ref.bump();
      atom.refresh?.((a) => defaultContext.refresh(a));
    },
    set<R, W>(atom: Writable<R, W>, value: W): void {
      atom.write(makeWriteContext(atom), value);
    },
    result<A, E>(atom: Atom<AsyncResult<A, E> | Result.Result<A, E>>) {
      return toEffectResult(defaultContext.get(atom));
    },
    addFinalizer(finalizer: () => void): void {
      onCleanup(finalizer);
    },
  },
);

function makeWriteContext<A>(self: Writable<A, any>): WriteContext<A> {
  return {
    get: (atom) => defaultContext.get(atom),
    set: (atom, value) => defaultContext.set(atom, value),
    refreshSelf: () => defaultContext.refresh(self),
    setSelf: (value) => {
      const direct = selfWriteMap.get(self);
      if (direct) {
        direct(value);
        return;
      }
      self.write(makeWriteContext(self), value);
    },
    result: (atom) => defaultContext.result(atom),
    addFinalizer: (finalizer) => defaultContext.addFinalizer(finalizer),
  };
}

export function make<A>(read: (get: Context) => A): Atom<A>;
export function make<A>(initial: A & (A extends (...args: Array<any>) => any ? never : unknown)): Writable<A>;
/**
 * Create an atom.
 *
 * Overloads:
 * - `make(value)` -> writable atom
 * - `make((get) => ...)` -> derived read-only atom
 *
 * Derived atoms track reads performed through `get(...)` and recompute when
 * dependencies change.
 *
 * Note: function values cannot be used as plain initial values with `make`.
 * If you need to store a function, wrap it in an object.
 *
 * @example
 * const count = Atom.make(1)
 * const doubled = Atom.make((get) => get(count) * 2)
 * const fnBox = Atom.make({ fn: () => 1 })
 */
export function make<A>(valueOrRead: A | ((get: Context) => A)): Atom<A> | Writable<A> {
  if (typeof valueOrRead === "function") {
    return readable(valueOrRead as (get: Context) => A);
  }
  const [getValue, setValue] = createSignal(valueOrRead as A);
  const atom = writable(
    () => getValue(),
    (_ctx, value) => setValue(value),
  );
  selfWriteMap.set(atom, (value: A) => setValue(value));
  return atom;
}

/**
 * Create memoized atom families keyed by argument identity.
 *
 * Useful for per-id state (todos, route params, entity caches).
 * Calling the family with the same argument returns the same atom instance.
 *
 * @example
 * const todoById = Atom.family((id: string) => Atom.make({ id, done: false }))
 */
export const family = <Arg, T>(f: (arg: Arg) => T): ((arg: Arg) => T) => {
  const cache = new Map<Arg, T>();
  return (arg) => {
    const existing = cache.get(arg);
    if (existing !== undefined) return existing;
    const next = f(arg);
    cache.set(arg, next);
    return next;
  };
};

/**
 * Compatibility helper with `@effect-atom/atom`.
 *
 * In this package atoms are already retained by the owning reactive graph, so
 * this is currently an identity function.
 */
export const keepAlive = <A>(self: Atom<A>): Atom<A> => self;

export interface AtomRuntime<R, E = unknown> {
  readonly managed: ManagedRuntime.ManagedRuntime<R, E>;
  atom<A, E2>(effect: Effect.Effect<A, E2, R>): Atom<AsyncResult<A, E2>>;
  /**
   * Create a function-style mutation atom bound to this runtime.
   *
   * `set(fnAtom, input)` runs the Effect and updates `fnAtom` with
   * `AsyncResult<void, E2>` state.
   */
  fn<A, E2, Input = void>(
    effect: (input: Input) => Effect.Effect<A, E2, R>,
    options?: { readonly reactivityKeys?: ReactivityKeysInput },
  ): Writable<AsyncResult<void, E2>, Input>;
  dispose(): Promise<void>;
}

function runPromiseWithRuntime<R, A, E>(
  runtime: RuntimeLike<R, unknown> | undefined,
  effect: Effect.Effect<A, E, R>,
): Promise<A> {
  if (ManagedRuntime.isManagedRuntime(runtime)) {
    return runtime.runPromise(effect);
  }
  if (runtime !== undefined) {
    return Effect.runPromiseWith(runtime as any)(effect);
  }
  return Effect.runPromise(effect as Effect.Effect<A, E, never>);
}

let globalRuntimeLayers: ReadonlyArray<Layer.Layer<any, any, never>> = [];

function buildLayerWithGlobals<R, E>(layer: Layer.Layer<R, E, never>): Layer.Layer<any, any, never> {
  if (globalRuntimeLayers.length === 0) {
    return layer as unknown as Layer.Layer<any, any, never>;
  }
  return Layer.mergeAll(
    layer as unknown as Layer.Layer<any, any, never>,
    ...globalRuntimeLayers,
  );
}

const runtimeImpl = <R, E>(layer: Layer.Layer<R, E, never>): AtomRuntime<R, E> => {
  const managed = ManagedRuntime.make(buildLayerWithGlobals(layer)) as ManagedRuntime.ManagedRuntime<R, E>;
  return {
    managed,
    atom<A, E2>(effect: Effect.Effect<A, E2, R>): Atom<AsyncResult<A, E2>> {
      return query(managed as RuntimeLike<R, unknown>, () => effect);
    },
    fn<A, E2, Input = void>(
      effect: (input: Input) => Effect.Effect<A, E2, R>,
      options?: { readonly reactivityKeys?: ReactivityKeysInput },
    ): Writable<AsyncResult<void, E2>, Input> {
      let handle: MutationEffectHandle<Input, E2> | null = null;
      const ensureHandle = (): MutationEffectHandle<Input, E2> => {
        if (handle !== null) return handle;
        handle = mutationEffectStrict(
          managed as RuntimeLike<R, unknown>,
          (input: Input) => effect(input),
          {
            onSuccess: () => {
              if (options?.reactivityKeys !== undefined) {
                invalidateReactivity(options.reactivityKeys);
              }
            },
          },
        );
        return handle;
      };
      return writable(
        () => ensureHandle().result(),
        (_ctx, input) => ensureHandle().run(input),
      );
    },
    dispose(): Promise<void> {
      return managed.dispose();
    },
  };
};

export const runtime: {
  /** Create a ManagedRuntime-backed Atom runtime. */
  <R, E>(layer: Layer.Layer<R, E, never>): AtomRuntime<R, E>;
  /** Add a global Layer merged into all future Atom runtimes. */
  addGlobalLayer<R, E>(layer: Layer.Layer<R, E, never>): void;
  /** Clear previously registered global runtime Layers. */
  clearGlobalLayers(): void;
} = Object.assign(runtimeImpl, {
  addGlobalLayer<R, E>(layer: Layer.Layer<R, E, never>): void {
    globalRuntimeLayers = [...globalRuntimeLayers, layer as unknown as Layer.Layer<any, any, never>];
  },
  clearGlobalLayers(): void {
    globalRuntimeLayers = [];
  },
});

type NormalizedReactivityKey = string;

/**
 * Logical keys used to wire query invalidation to mutation completion.
 *
 * - `string[]` invalidates exact keys
 * - `{ key: [id1, id2] }` invalidates `key`, `key:id1`, `key:id2`
 */
export type ReactivityKeysInput =
  | ReadonlyArray<string>
  | Readonly<Record<string, ReadonlyArray<string | number>>>;

const reactivityVersionMap = new Map<NormalizedReactivityKey, Accessor<number>>();
const reactivityBumpMap = new Map<NormalizedReactivityKey, () => void>();

function normalizeReactivityKeys(input: ReactivityKeysInput): ReadonlyArray<NormalizedReactivityKey> {
  if (Array.isArray(input)) return input;
  const dict = input as Readonly<Record<string, ReadonlyArray<string | number>>>;
  const out: NormalizedReactivityKey[] = [];
  for (const key of Object.keys(dict)) {
    out.push(key);
    for (const sub of dict[key] ?? []) {
      out.push(`${key}:${String(sub)}`);
    }
  }
  return out;
}

function ensureReactivityKey(key: NormalizedReactivityKey): Accessor<number> {
  const existing = reactivityVersionMap.get(key);
  if (existing) return existing;
  const [read, set] = createSignal(0);
  reactivityVersionMap.set(key, read);
  reactivityBumpMap.set(key, () => set((n) => n + 1));
  return read;
}

export function invalidateReactivity(input: ReactivityKeysInput): void {
  for (const key of normalizeReactivityKeys(input)) {
    ensureReactivityKey(key);
    reactivityBumpMap.get(key)?.();
  }
}

/**
 * Make an atom depend on logical reactivity keys.
 *
 * Calling `invalidateReactivity(keys)` will refresh atoms wrapped with the
 * same keys.
 */
export function withReactivity(
  input: ReactivityKeysInput,
): <A>(self: Atom<A>) => Atom<A>;
export function withReactivity<A>(
  self: Atom<A>,
  input: ReactivityKeysInput,
): Atom<A>;
export function withReactivity<A>(
  arg1: Atom<A> | ReactivityKeysInput,
  arg2?: ReactivityKeysInput,
): Atom<A> | ((self: Atom<A>) => Atom<A>) {
  if (arg2 === undefined) {
    const keys = normalizeReactivityKeys(arg1 as ReactivityKeysInput);
    return (self: Atom<A>) => readable((get) => {
      for (const key of keys) ensureReactivityKey(key)();
      return get(self);
    });
  }

  const self = arg1 as Atom<A>;
  const keys = normalizeReactivityKeys(arg2);
  return readable((get) => {
    for (const key of keys) ensureReactivityKey(key)();
    return get(self);
  });
}

export function fn<A, E, Input = void>(
  effect: (input: Input) => Effect.Effect<A, E, never>,
  options?: { readonly reactivityKeys?: ReactivityKeysInput },
): Writable<AsyncResult<void, E>, Input>;
export function fn<A, E, R, Input = void>(
  runtime: RuntimeLike<R, unknown>,
  effect: (input: Input) => Effect.Effect<A, E, R>,
  options?: { readonly reactivityKeys?: ReactivityKeysInput },
): Writable<AsyncResult<void, E>, Input>;
export function fn<A, E, R, Input = void>(
  arg1: RuntimeLike<R, unknown> | ((input: Input) => Effect.Effect<A, E, R>),
  arg2?: ((input: Input) => Effect.Effect<A, E, R>) | { readonly reactivityKeys?: ReactivityKeysInput },
  arg3?: { readonly reactivityKeys?: ReactivityKeysInput },
): Writable<AsyncResult<void, E>, Input> {
  const hasRuntime = typeof arg1 !== "function";
  const runtimeArg = hasRuntime ? arg1 as RuntimeLike<R, unknown> : undefined;
  const effectFn = (hasRuntime ? arg2 : arg1) as (input: Input) => Effect.Effect<A, E, R>;
  const options = (hasRuntime ? arg3 : arg2) as { readonly reactivityKeys?: ReactivityKeysInput } | undefined;

  let handle: MutationEffectHandle<Input, E> | null = null;
  const ensureHandle = (): MutationEffectHandle<Input, E> => {
    if (handle !== null) return handle;
    const baseOptions = {
      onSuccess: () => {
        if (options?.reactivityKeys !== undefined) {
          invalidateReactivity(options.reactivityKeys);
        }
      },
    };
    handle = runtimeArg === undefined
      ? mutationEffect((input: Input) => effectFn(input) as Effect.Effect<unknown, E, never>, baseOptions)
      : mutationEffectStrict(runtimeArg as RuntimeLike<R, unknown>, effectFn, baseOptions);
    return handle;
  };

  return writable(
    () => ensureHandle().result(),
    (_ctx, input) => ensureHandle().run(input),
  );
}

/** Pull atom payload for incremental stream loading. */
export interface PullChunk<A> {
  readonly items: ReadonlyArray<A>;
  readonly done: boolean;
}

export type PullResult<A, E = never> = Result.Result<PullChunk<A>, E>;

/**
 * Build a pull-based stream atom.
 *
 * The writable input is `void`; each write pulls the next chunk into `items`.
 */
export function pull<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  options?: {
    readonly runtime?: RuntimeLike<R, unknown>;
    readonly chunkSize?: number;
  },
): Writable<PullResult<A, E>, void> {
  const chunkSize = Math.max(1, options?.chunkSize ?? 1);
  const [state, setState] = createSignal<PullResult<A, E>>(Result.initial(false));

  let loaded: ReadonlyArray<A> | null = null;
  let cursor = 0;
  let running = false;

  const emitNext = (): void => {
    if (loaded === null) return;
    const nextItems = loaded.slice(cursor, cursor + chunkSize);
    cursor += nextItems.length;
    const previous = state();
    const previousItems = previous._tag === "Success" ? previous.value.items : [];
    const merged = [...previousItems, ...nextItems];
    setState(Result.success({ items: merged, done: cursor >= loaded.length }));
  };

  const startLoad = (): void => {
    if (running) return;
    running = true;
    setState(Result.waiting(state()));
    const collect = Stream.runCollect(stream).pipe(
      Effect.map((chunk) => Array.from(chunk as Iterable<A>)),
    );
    void runPromiseWithRuntime(options?.runtime, collect)
      .then((items) => {
        loaded = items;
        cursor = 0;
        emitNext();
      })
      .catch((error) => {
        if (Cause.isCause(error)) {
          const typed = Cause.findErrorOption(error);
          if (Option.isSome(typed)) {
            setState(Result.failure(typed.value as E));
          } else {
            setState(Result.failure({ defect: Cause.pretty(error) } as unknown as E));
          }
          return;
        }
        setState(Result.failure(error as E));
      })
      .finally(() => {
        running = false;
      });
  };

  return writable(
    () => state(),
    () => {
      if (loaded === null) {
        startLoad();
        return;
      }
      emitNext();
    },
  );
}

type SearchParamCodec<A> = {
  readonly parse?: (raw: string | null) => A;
  readonly serialize?: (value: A) => string | null;
};

/**
 * Create an atom backed by `window.location.search`.
 *
 * Reads track the current query param value, writes update it via
 * `history.replaceState`.
 */
export function searchParam(name: string): Writable<string | null, string | null>;
export function searchParam<A>(name: string, codec: SearchParamCodec<A>): Writable<A, A>;
export function searchParam<A>(
  name: string,
  codec?: SearchParamCodec<A>,
): Writable<A | string | null, A | string | null> {
  const readRaw = (): string | null => {
    if (typeof window === "undefined" || typeof window.location === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  };

  const parse = (raw: string | null): A | string | null => codec?.parse ? codec.parse(raw) : raw;
  const serialize = (value: A | string | null): string | null => {
    if (!codec?.serialize) return value as string | null;
    return codec.serialize(value as A);
  };

  const [value, setValue] = createSignal<A | string | null>(parse(readRaw()));
  let listening = false;

  const onPopState = (): void => {
    setValue(parse(readRaw()));
  };

  return writable(
    () => {
      if (!listening && typeof window !== "undefined" && typeof window.addEventListener === "function") {
        listening = true;
        window.addEventListener("popstate", onPopState);
        onCleanup(() => {
          window.removeEventListener("popstate", onPopState);
          listening = false;
        });
      }
      return value();
    },
    (_ctx, next) => {
      const raw = serialize(next);
      setValue(next);
      if (typeof window === "undefined" || typeof window.location === "undefined") return;
      const url = new URL(window.location.href);
      if (raw === null) {
        url.searchParams.delete(name);
      } else {
        url.searchParams.set(name, raw);
      }
      if (typeof window.history !== "undefined" && typeof window.history.replaceState === "function") {
        window.history.replaceState(window.history.state, "", url.toString());
      }
    },
  );
}

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type KvsCodec<A> = {
  readonly decode?: (raw: unknown) => A;
  readonly encode?: (value: A) => unknown;
};

const memoryKvs = new Map<string, string>();

function getDefaultStorage(): KeyValueStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return {
    getItem(key: string) {
      return memoryKvs.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memoryKvs.set(key, value);
    },
    removeItem(key: string) {
      memoryKvs.delete(key);
    },
  };
}

export function kvs<A>(options: {
  readonly key: string;
  readonly defaultValue: () => A;
  readonly storage?: KeyValueStorage;
  readonly codec?: KvsCodec<A>;
}): Writable<A, A> {
  const storage = options.storage ?? getDefaultStorage();
  const decode = options.codec?.decode ?? ((raw: unknown) => raw as A);
  const encode = options.codec?.encode ?? ((value: A) => value as unknown);

  const readInitial = (): A => {
    const raw = storage.getItem(options.key);
    if (raw === null) return options.defaultValue();
    try {
      return decode(JSON.parse(raw));
    } catch {
      return options.defaultValue();
    }
  };

  const [value, setValue] = createSignal<A>(readInitial());

  return writable(
    () => value(),
    (_ctx, next) => {
      setValue(next);
      storage.setItem(options.key, JSON.stringify(encode(next)));
    },
  );
}

export function map<A, B>(f: (a: A) => B): (self: Atom<A>) => Atom<B>;
export function map<A, B>(self: Atom<A>, f: (a: A) => B): Atom<B>;
/**
 * Map an atom value into a derived atom.
 *
 * Supports both data-first and data-last usage.
 *
 * @example
 * const doubled = Atom.map(count, (n) => n * 2)
 * const toLabel = Atom.map((n: number) => `#${n}`)
 * const labeledCount = toLabel(count)
 *
 * @example
 * const user = Atom.make({ first: "Ada", last: "Lovelace" })
 * const fullName = Atom.map(user, (u) => `${u.first} ${u.last}`)
 */
export function map<A, B>(
  arg1: Atom<A> | ((a: A) => B),
  arg2?: (a: A) => B,
): Atom<B> | ((self: Atom<A>) => Atom<B>) {
  if (typeof arg1 === "function" && arg2 === undefined) {
    const f = arg1 as (a: A) => B;
    return (self: Atom<A>) => readable((get) => f(get(self)));
  }
  const self = arg1 as Atom<A>;
  const f = arg2 as (a: A) => B;
  return readable((get) => f(get(self)));
}

export function withFallback<A>(fallback: A): <E>(self: Atom<A | E>) => Atom<A>;
export function withFallback<A, E>(self: Atom<A | E>, fallback: A): Atom<A>;
/**
 * Provide a fallback when an atom returns `null` or `undefined`.
 *
 * This is handy for optional server data when UI wants a stable value.
 *
 * @example
 * const safeName = Atom.withFallback(nameAtom, "anonymous")
 */
export function withFallback<A, E>(
  arg1: A | Atom<A | E>,
  arg2?: A,
): Atom<A> | ((self: Atom<A | E>) => Atom<A>) {
  if (arg2 === undefined) {
    const fallback = arg1 as A;
    return (self: Atom<A | E>) => readable((get) => {
      const value = get(self);
      return (value ?? fallback) as A;
    });
  }
  const self = arg1 as Atom<A | E>;
  const fallback = arg2;
  return readable((get) => {
    const value = get(self);
    return (value ?? fallback) as A;
  });
}

/**
 * Batch multiple atom writes into a single reactive flush.
 *
 * Updates inside `f` are deferred until the batch completes, preventing
 * intermediate recomputations.
 *
 * @param f - Function containing atom writes to batch together.
 *
 * @example
 * Atom.batch(() => {
 *   Effect.runSync(Atom.set(firstName, "Jane"))
 *   Effect.runSync(Atom.set(lastName, "Doe"))
 * })
 * // Dependents recompute once, not twice
 */
export const batch = (f: () => void): void => {
  runBatch(f);
};

/**
 * Read atom value as an `Effect`.
 *
 * The returned effect is synchronous and can be composed with other Effect
 * operations in pipelines.
 *
 * @example
 * const n = Effect.runSync(Atom.get(count))
 */
export const get = <A>(self: Atom<A>): Effect.Effect<A> =>
  Effect.sync(() => defaultContext.get(self));

export function set<R, W>(value: W): (self: Writable<R, W>) => Effect.Effect<void>;
export function set<R, W>(self: Writable<R, W>, value: W): Effect.Effect<void>;
/**
 * Write atom value as an `Effect`.
 *
 * Supports data-first and data-last forms.
 *
 * @example
 * Effect.runSync(Atom.set(count, 2))
 * const setZero = Atom.set(0)
 * Effect.runSync(setZero(count))
 */
export function set<R, W>(
  arg1: Writable<R, W> | W,
  arg2?: W,
): Effect.Effect<void> | ((self: Writable<R, W>) => Effect.Effect<void>) {
  if (arg2 === undefined) {
    const value = arg1 as W;
    return (self: Writable<R, W>) => Effect.sync(() => defaultContext.set(self, value));
  }
  const self = arg1 as Writable<R, W>;
  const value = arg2;
  return Effect.sync(() => defaultContext.set(self, value));
}

export function update<R>(f: (value: R) => R): (self: Writable<R, R>) => Effect.Effect<void>;
export function update<R>(self: Writable<R, R>, f: (value: R) => R): Effect.Effect<void>;
/**
 * Update atom value from previous value.
 *
 * @example
 * Effect.runSync(Atom.update(count, (n) => n + 1))
 */
export function update<R>(
  arg1: Writable<R, R> | ((value: R) => R),
  arg2?: (value: R) => R,
): Effect.Effect<void> | ((self: Writable<R, R>) => Effect.Effect<void>) {
  if (arg2 === undefined) {
    const f = arg1 as (value: R) => R;
    return (self: Writable<R, R>) => Effect.sync(() => {
      const next = f(defaultContext.get(self));
      defaultContext.set(self, next);
    });
  }
  const self = arg1 as Writable<R, R>;
  const f = arg2;
  return Effect.sync(() => {
    const next = f(defaultContext.get(self));
    defaultContext.set(self, next);
  });
}

export function modify<R, W, A>(
  f: (value: R) => [A, W],
): (self: Writable<R, W>) => Effect.Effect<A>;
export function modify<R, W, A>(
  self: Writable<R, W>,
  f: (value: R) => [A, W],
): Effect.Effect<A>;
/**
 * Atom modification that also returns a computed value.
 *
 * This is useful when a single read/transform/write should produce a return
 * value (for logging, IDs, domain events, etc.).
 *
 * @example
 * const previous = Effect.runSync(Atom.modify(count, (n) => [n, n + 1]))
 */
export function modify<R, W, A>(
  arg1: Writable<R, W> | ((value: R) => [A, W]),
  arg2?: (value: R) => [A, W],
): Effect.Effect<A> | ((self: Writable<R, W>) => Effect.Effect<A>) {
  if (arg2 === undefined) {
    const f = arg1 as (value: R) => [A, W];
    return (self: Writable<R, W>) => Effect.sync(() => {
      const [ret, next] = f(defaultContext.get(self));
      defaultContext.set(self, next);
      return ret;
    });
  }
  const self = arg1 as Writable<R, W>;
  const f = arg2;
  return Effect.sync(() => {
    const [ret, next] = f(defaultContext.get(self));
    defaultContext.set(self, next);
    return ret;
  });
}

/**
 * Force-refresh an atom and invalidate dependents.
 *
 * Useful when the read logic depends on external state that is not captured
 * through atom dependencies.
 *
 * @example
 * const clock = Atom.readable(() => Date.now())
 * Effect.runSync(Atom.refresh(clock))
 */
export const refresh = <A>(self: Atom<A>): Effect.Effect<void> =>
  Effect.sync(() => defaultContext.refresh(self));

/**
 * Subscribe to atom value changes.
 *
 * By default, listener is called immediately with current value, then on each
 * subsequent change.
 *
 * @example
 * const unsub = Atom.subscribe(count, console.log)
 * // later: unsub()
 */
export const subscribe = <A>(
  self: Atom<A>,
  f: (_: A) => void,
  options?: { readonly immediate?: boolean },
): (() => void) => {
  const owner = new Owner();
  runWithOwner(owner, () => {
    let first = true;
    createEffect(() => {
      const next = defaultContext.get(self);
      if (first) {
        first = false;
        if (options?.immediate === false) return;
      }
      f(next);
    });
  });
  return () => owner.dispose();
};

/**
 * Creates an atom whose value is continuously updated from an Effect Stream.
 *
 * Uses the default Runtime to fork the stream subscription. When the atom
 * is first read (or explicitly mounted via a Registry), the stream starts.
 * The stream is interrupted when the registry/owner unmounts.
 *
 * This is ideal for websocket/event-stream style data where you always want
 * the latest value represented as an atom.
 *
 * @example
 * const prices = Atom.fromStream(stream, 0)
 * const stop = registry.mount(prices)
 * // later: stop()
 */
export function fromStream<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  initialValue: A,
  runtime?: any, // V4 runtime
): Atom<A> {
  const [get, set] = createSignal<A>(initialValue);
  let fiber: Fiber.Fiber<void, E> | null = null;
  let active = false;

  const start = () => {
    if (active) return;
    active = true;
    const eff = Stream.runForEach(stream, (a) => Effect.sync(() => set(a))) as Effect.Effect<void, E, R>;
    fiber = (runtime ? Effect.runForkWith(runtime as any)(eff) : Effect.runFork(eff as unknown as Effect.Effect<void, E, never>)) as Fiber.Fiber<void, E>;
  };

  const stop = () => {
    if (!active) return;
    active = false;
    if (fiber) {
      Effect.runFork(Fiber.interrupt(fiber));
      fiber = null;
    }
  };

  return readable((ctx) => {
    // If not active, try to start it and schedule cleanup
    if (!active) {
      const owner = new Owner();
      runWithOwner(owner, () => {
        start();
        onCleanup(() => stop());
      });
    }
    return get();
  });
}

/**
 * Creates an atom that reads from an Effect Queue.
 *
 * Internally converts the queue to a Stream via `Stream.fromQueue` and
 * delegates to `fromStream`.
 *
 * @param queue        - The Effect Dequeue to consume values from.
 * @param initialValue - The atom's value before the first item arrives.
 *
 * @example
 * const queue = yield* Queue.unbounded<number>()
 * const latest = Atom.fromQueue(queue, 0)
 * // latest atom updates each time an item is offered to the queue
 */
export function fromQueue<A>(
  queue: Queue.Dequeue<A>,
  initialValue: A,
): Atom<A> {
  return fromStream(Stream.fromQueue(queue), initialValue);
}

export function query<A, E, R>(
  fn: () => Effect.Effect<A, E, R>,
): Atom<AsyncResult<A, E>>;
export function query<A, E, R>(
  runtime: RuntimeLike<R, unknown>,
  fn: () => Effect.Effect<A, E, R>,
): Atom<AsyncResult<A, E>>;
/**
 * Create an atom backed by `queryEffect(...)` semantics.
 *
 * This is the atom-native equivalent of `queryEffect` / `queryEffectStrict`:
 * - tracks dependencies read inside `fn()`
 * - interrupts stale fibers on dependency changes
 * - exposes `AsyncResult<A, E>` through normal atom reads
 *
 * Without an explicit runtime, it uses ambient runtime behavior from `mount`.
 *
 * @example
 * const user = Atom.query(() => use(Api).getUser(ui.get(userIdAtom)))
 *
 * @example
 * const user = Atom.query(runtime, () => Effect.service(Api).pipe(Effect.flatMap((api) => api.getUser("1"))))
 */
export function query<A, E, R>(
  arg1: RuntimeLike<R, unknown> | (() => Effect.Effect<A, E, R>),
  arg2?: () => Effect.Effect<A, E, R>,
): Atom<AsyncResult<A, E>> {
  let accessor: Accessor<AsyncResult<A, E>> | null = null;

  const getAccessor = (): Accessor<AsyncResult<A, E>> => {
    if (accessor !== null) return accessor;
    if (arg2 === undefined) {
      accessor = queryEffect(arg1 as () => Effect.Effect<A, E, R>);
    } else {
      accessor = queryEffectStrict(arg1 as RuntimeLike<R, unknown>, arg2);
    }
    return accessor;
  };

  return readable(() => getAccessor()());
}
