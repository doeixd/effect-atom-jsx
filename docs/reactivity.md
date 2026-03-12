clarify if it follows Solid 2.0's microtask model or Solid 1.x's synchronous model.
From effect-atom: Atom.withReactivity and the Reactivity integration from @effect/experimental. This is a much cleaner invalidation model than manually wiring invalidates arrays.

Could we use the Effect Reactivity Atom layer  for the reactivity glue instead? from @effect/experimental
Reactivity is an Effect service that allows you make queries reactive when mutations happen.

You can use an Atom.runtime to hook into the Reactivity service and trigger Atom refreshes when mutations happen.

import { Atom } from "@effect-atom/atom-react"
import { Effect, Layer } from "effect"
import { Reactivity } from "@effect/experimental"

const runtimeAtom = Atom.runtime(Layer.empty)

let i = 0

//      ┌─── Atom.Atom<number>
//      ▼
const count = Atom.make(() => i++).pipe(
  // Refresh when the "counter" key changes
  Atom.withReactivity(["counter"]),
  // Or refresh when "counter" or "counter:1" or "counter:2" changes
  Atom.withReactivity({
    counter: [1, 2],
  }),
)

const someMutation = runtimeAtom.fn(
  Effect.fn(function* () {
    yield* Effect.log("Mutating the counter")
  }),
  // Invalidate the "counter" key when the Effect is finished
  { reactivityKeys: ["counter"] },
)

const someMutationManual = runtimeAtom.fn(
  Effect.fn(function* () {
    yield* Effect.log("Mutating the counter again")
    // You can also manually invalidate the "counter" key
    yield* Reactivity.invalidate(["counter"])
  }),
)Yes. This is the right move. `Reactivity` from `@effect/experimental` is already an Effect service with key-based invalidation. Instead of building our own subscription system, our own atom notification system, and then bridging that to each framework's reactivity — we make `Reactivity` the single source of truth for "something changed, consumers need to update." Every framework bridge just subscribes to `Reactivity` invalidations and does whatever its framework needs to re-render.

**The insight:**

Right now we have multiple reactive notification paths:

- Atoms have `.subscribe()` for direct listeners
- `Atom.withReactivity(keys)` hooks into the `Reactivity` service
- `reactivityKeys` on actions/mutations triggers invalidation
- Each framework bridge needs its own subscription mechanism

Collapse all of these into `Reactivity`. Every atom gets reactivity keys. Every atom read registers interest in those keys. Every atom write invalidates those keys. `Reactivity` is the universal event bus for "data changed." Framework bridges subscribe to `Reactivity` invalidations and trigger their framework's re-render mechanism.

**Atom backed by Reactivity:**

```ts
// Every atom gets a reactivity key — derived from identity or explicit
const count = Atom.make(0);
// Internally: count has reactivity key "atom:<unique-id>"

// Derived atoms track their source keys
const doubled = Atom.make((get) => get(count) * 2);
// Internally: doubled depends on count's key

// When count is written, Reactivity.invalidate(["atom:<count-id>"]) fires
// doubled sees the invalidation because it depends on count's key
// Any framework subscriber watching doubled's key gets notified
```

But you don't have to think about this. The atom API stays the same. Under the hood, every `atom.set(...)` calls `Reactivity.invalidate` with the atom's keys. Every `atom()` read registers interest in the atom's keys via the current `Reactivity` subscription context.

**Explicit reactivity keys are the power feature:**

The `@effect/experimental` `Reactivity` pattern shines because keys are semantic, not identity-based. You don't invalidate "this specific atom" — you invalidate a concept like "users" or "user:alice". Multiple atoms can watch the same key. One mutation can invalidate a key that refreshes ten different atoms across ten different components.

```ts
const userList = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listUsers();
  }),
).pipe(Atom.withReactivity(["users"]));

const userCount = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.countUsers();
  }),
).pipe(Atom.withReactivity(["users"]));

const activeUsers = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.listActiveUsers();
  }),
).pipe(Atom.withReactivity(["users"]));

// One mutation invalidates all three
const addUser = apiRuntime.action(
  Effect.fn(function* (name: string) {
    const api = yield* Api;
    yield* api.addUser(name);
  }),
  { reactivityKeys: ["users"] },
);
```

When `addUser` runs, `Reactivity.invalidate(["users"])` fires. All three atoms refresh. No manual wiring. No "which queries does this mutation invalidate" lists. Just semantic keys.

**Reactivity as the universal bridge layer:**

Instead of each framework bridge implementing its own atom subscription:

```ts
// OLD: each bridge implements atom subscription differently
// React: useSyncExternalStore(atom.subscribe, atom.read)
// Vue: watch(() => atom(), (v) => vueRef.value = v)
// Svelte: atom.subscribe((v) => svelteState = v)
```

Each framework bridge subscribes to `Reactivity` invalidation events and batch-triggers its own update mechanism:

```ts
class FrameworkReactivityBridge extends Effect.Tag("FrameworkReactivityBridge")
  FrameworkReactivityBridge,
  {
    // Connect Reactivity invalidations to the host framework's update cycle
    readonly connect: (
      keys: readonly string[],
      onInvalidate: () => void,
    ) => Effect.Effect<void, never, Scope>;
  }
>() {}
```

**React bridge via Reactivity:**

```ts
const ReactReactivityBridge = Layer.succeed(FrameworkReactivityBridge, {
  connect: (keys, onInvalidate) =>
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;

      // Subscribe to invalidation events for these keys
      yield* reactivity.subscribe(keys, () => {
        // When any watched key is invalidated,
        // trigger React's re-render mechanism
        // This works with useSyncExternalStore or setState
        onInvalidate();
      });

      // Subscription is scoped — cleaned up when component unmounts
    }),
});

// In a React component wrapper:
function useReactivityAtom<A>(atom: ReadonlyAtom<A>): A {
  const bridge = useFrameworkBridge();
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  React.useEffect(() => {
    const cleanup = Effect.runSync(
      bridge.connect(atom.reactivityKeys, () => forceUpdate()).pipe(
        Effect.scoped,
      )
    );
    return cleanup;
  }, [atom]);

  return atom();
}
```

**Vue bridge via Reactivity:**

```ts
const VueReactivityBridge = Layer.succeed(FrameworkReactivityBridge, {
  connect: (keys, onInvalidate) =>
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;

      yield* reactivity.subscribe(keys, () => {
        // Trigger Vue's reactivity system
        // Vue will re-render any component reading the affected refs
        onInvalidate();
      });
    }),
});

// In a Vue composable:
function useReactivityAtom<A>(atom: ReadonlyAtom<A>): Ref<A> {
  const vueRef = shallowRef(atom());
  const bridge = inject("reactivity-bridge");

  onMounted(() => {
    Effect.runSync(
      bridge.connect(atom.reactivityKeys, () => {
        vueRef.value = atom();
      }).pipe(Effect.scoped)
    );
  });

  return vueRef;
}
```

**Svelte bridge via Reactivity:**

```ts
const SvelteReactivityBridge = Layer.succeed(FrameworkReactivityBridge, {
  connect: (keys, onInvalidate) =>
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;

      yield* reactivity.subscribe(keys, () => {
        onInvalidate();
      });
    }),
});

// In Svelte 5 with runes:
function useReactivityAtom<A>(atom: ReadonlyAtom<A>) {
  let value = $state(atom());
  const bridge = getContext("reactivity-bridge");

  $effect(() => {
    return Effect.runSync(
      bridge.connect(atom.reactivityKeys, () => {
        value = atom();
      }).pipe(Effect.scoped)
    );
  });

  return { get value() { return value; } };
}
```

**The deeper point: Reactivity replaces our internal atom subscription system entirely.**

Instead of atoms having their own `.subscribe()` mechanism with their own notification graph, atoms are thin wrappers around `Ref` (for storage) + `Reactivity` (for change notification):

```ts
// Atom internal implementation backed by Reactivity
function makeAtom<A>(initial: A, options?: { key?: string }): WritableAtom<A> {
  const key = options?.key ?? `atom:${generateId()}`;
  const ref = Effect.runSync(Ref.make(initial));

  const atom = Object.assign(
    // Read — just read the ref
    () => Effect.runSync(Ref.get(ref)),
    {
      // Write — update ref, then invalidate via Reactivity
      set: (value: A) => {
        Effect.runSync(Ref.set(ref, value));
        Effect.runSync(
          Effect.gen(function* () {
            const reactivity = yield* Reactivity;
            yield* reactivity.invalidate([key]);
          }).pipe(
            // If no Reactivity service is available (standalone usage),
            // fall back to direct notification
            Effect.catchAll(() => Effect.void),
          )
        );
      },

      update: (fn: (a: A) => A) => {
        Effect.runSync(Ref.update(ref, fn));
        Effect.runSync(
          Reactivity.invalidate([key]).pipe(
            Effect.catchAll(() => Effect.void),
          )
        );
      },

      // Reactivity metadata
      reactivityKeys: [key],
    },
  );

  return atom;
}
```

Derived atoms subscribe to their sources' reactivity keys:

```ts
function makeDerived<A>(fn: (get: AtomGetter) => A): ReadonlyAtom<A> {
  const key = `derived:${generateId()}`;
  const trackedKeys: string[] = [];

  // The getter tracks which keys are read
  const get: AtomGetter = (source) => {
    trackedKeys.push(...source.reactivityKeys);
    return source();
  };

  const compute = () => fn(get);
  let cached = compute();

  const atom = Object.assign(
    () => cached,
    {
      reactivityKeys: [key, ...trackedKeys],
      recompute: () => {
        cached = compute();
        // Derived atom invalidates its own key when it recomputes
        // so downstream derived atoms and framework bridges get notified
      },
    },
  );

  // Subscribe to source keys via Reactivity
  // When sources change, recompute and invalidate own key
  Effect.runSync(
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;
      yield* reactivity.subscribe(trackedKeys, () => {
        atom.recompute();
        yield* reactivity.invalidate([key]);
      });
    }).pipe(
      Effect.catchAll(() => Effect.void),
    )
  );

  return atom;
}
```

**Async atoms (queries) are just atoms with Reactivity-triggered refresh:**

```ts
function makeQueryAtom<A, E>(
  effect: () => Effect.Effect<A, E>,
  options?: { reactivityKeys?: string[] },
): ReadonlyAtom<Result<A, E>> {
  const key = `query:${generateId()}`;
  const resultRef = Effect.runSync(Ref.make<Result<A, E>>(Result.loading()));

  // Run the effect, store result
  const execute = Effect.gen(function* () {
    yield* Ref.set(resultRef, Result.loading());
    const exit = yield* Effect.exit(effect());
    const result = Exit.match(exit, {
      onSuccess: (a) => Result.success(a),
      onFailure: (cause) => Result.failure(cause),
    });
    yield* Ref.set(resultRef, result);
    // Invalidate our own key so subscribers know the result changed
    yield* Reactivity.invalidate([key]);
  });

  // Subscribe to reactivity keys — when they're invalidated, re-execute
  if (options?.reactivityKeys) {
    Effect.runSync(
      Effect.gen(function* () {
        const reactivity = yield* Reactivity;
        yield* reactivity.subscribe(options.reactivityKeys!, () => {
          // Re-run the query
          Effect.runFork(execute);
        });
      })
    );
  }

  return Object.assign(
    () => Effect.runSync(Ref.get(resultRef)),
    {
      reactivityKeys: [key, ...(options?.reactivityKeys ?? [])],
    },
  );
}
```

**Actions invalidate via Reactivity — which is already how effect-atom works:**

```ts
const addUser = apiRuntime.action(
  Effect.fn(function* (name: string) {
    const api = yield* Api;
    yield* api.addUser(name);
    // This invalidation is the ONLY mechanism needed
    // No "refresh(userList)" — Reactivity handles the fan-out
  }),
  { reactivityKeys: ["users"] },
);

// Or manually inside the Effect
const addUserManual = apiRuntime.action(
  Effect.fn(function* (name: string) {
    const api = yield* Api;
    yield* api.addUser(name);
    yield* Reactivity.invalidate(["users"]);
  }),
);
```

When `Reactivity.invalidate(["users"])` fires:
- `userList` atom refreshes (it subscribed via `Atom.withReactivity(["users"])`)
- `userCount` atom refreshes (same key)
- `activeUsers` atom refreshes (same key)
- React components reading any of these atoms re-render (React bridge subscribed to those keys)
- Vue components reading any of these atoms update (Vue bridge subscribed)
- Svelte components update
- Any framework, any number of consumers

One invalidation call. `Reactivity` fans it out to every subscriber. No framework-specific notification code needed.

**Hierarchical keys for fine-grained invalidation:**

The `@effect/experimental` `Reactivity` already supports structured keys:

```ts
const userProfile = apiRuntime.atom(
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.findUser(userId);
  }),
).pipe(
  // Refreshes on "users" (all users changed) or "user:alice" (this user changed)
  Atom.withReactivity({ users: [userId] }),
);

// Invalidate all user-related atoms
yield* Reactivity.invalidate(["users"]);

// Invalidate only alice's profile
yield* Reactivity.invalidate({ users: ["alice"] });
```

This is exactly what `@effect-atom/atom` already does. The structure `{ users: ["alice"] }` means "invalidate the 'users' key with sub-key 'alice'". Atoms subscribed to `{ users: [userId] }` where `userId === "alice"` get refreshed. Atoms subscribed to just `["users"]` (all users) also get refreshed.

This granularity means a mutation that updates one user doesn't refresh the entire user list — only atoms watching that specific user's sub-key. But a mutation that creates a new user invalidates `["users"]` which refreshes everything.

**Framework bridge becomes extremely simple:**

Since `Reactivity` handles all the notification routing, each framework bridge is just "subscribe to keys, call framework update":

```ts
// The ENTIRE React bridge for reactivity
function useAtom<A>(atom: ReadonlyAtom<A>): A {
  return React.useSyncExternalStore(
    (onStoreChange) => {
      // Subscribe to this atom's reactivity keys
      const unsubscribe = Effect.runSync(
        Effect.gen(function* () {
          const reactivity = yield* Reactivity;
          return yield* reactivity.subscribe(
            atom.reactivityKeys,
            onStoreChange,
          );
        }).pipe(Effect.scoped)
      );
      return unsubscribe;
    },
    // Read current value
    () => atom(),
  );
}
```

That's the entire React reactivity bridge. One hook. `useSyncExternalStore` + `Reactivity.subscribe`. Everything else — invalidation routing, dependency tracking, cache management, stale-while-revalidate — is handled by `Reactivity` and the atom layer.

Vue:

```ts
function useAtom<A>(atom: ReadonlyAtom<A>): Ref<A> {
  const value = shallowRef(atom());

  onMounted(() => {
    Effect.runSync(
      Effect.gen(function* () {
        const reactivity = yield* Reactivity;
        yield* reactivity.subscribe(atom.reactivityKeys, () => {
          value.value = atom();
        });
      }).pipe(Effect.scoped)
    );
  });

  return readonly(value);
}
```

Svelte:

```ts
function useAtom<A>(atom: ReadonlyAtom<A>) {
  let value = $state(atom());

  $effect(() => {
    return Effect.runSync(
      Effect.gen(function* () {
        const reactivity = yield* Reactivity;
        yield* reactivity.subscribe(atom.reactivityKeys, () => {
          value = atom();
        });
      }).pipe(Effect.scoped)
    );
  });

  return { get value() { return value; } };
}
```

Angular:

```ts
function useAtom<A>(atom: ReadonlyAtom<A>): Signal<A> {
  const sig = signal(atom());

  Effect.runSync(
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;
      yield* reactivity.subscribe(atom.reactivityKeys, () => {
        sig.set(atom());
      });
    }).pipe(Effect.scoped)
  );

  return sig.asReadonly();
}
```

Every bridge is the same pattern: subscribe to reactivity keys, update framework-native reactive primitive. Five lines of framework-specific code.

**Our own dom-expressions renderer also uses Reactivity:**

For the standalone renderer (no host framework), the dom-expressions reactive system subscribes to `Reactivity` the same way:

```ts
// dom-expressions integration
function createReactiveExpression<A>(fn: () => A): () => A {
  let cached = fn();
  const trackedKeys = trackReactivityKeys(fn);

  Effect.runSync(
    Effect.gen(function* () {
      const reactivity = yield* Reactivity;
      yield* reactivity.subscribe(trackedKeys, () => {
        const next = fn();
        if (next !== cached) {
          cached = next;
          // Update the specific DOM node
          updateDOMBinding(cached);
        }
      });
    }).pipe(Effect.scoped)
  );

  return () => cached;
}
```

This means dom-expressions' internal `createSignal`/`createEffect`/`createMemo` can be backed by `Reactivity` instead of their own notification system. The reactive core becomes a thin wrapper over Effect's `Reactivity` service.

**Batching through Reactivity:**

Multiple atom writes in the same synchronous block should produce one invalidation, not N:

```ts
count.set(5);
name.set("hello");
flag.set(true);
// Should produce ONE batch of invalidations, not three separate ones
```

`Reactivity` can batch invalidations. The service collects invalidated keys during a synchronous block and flushes them as a batch on the next microtask (matching our existing microtask batching model):

```ts
// Internally, Reactivity batches invalidations
Reactivity.invalidate(["count-key"]);   // queued
Reactivity.invalidate(["name-key"]);    // queued
Reactivity.invalidate(["flag-key"]);    // queued
// Microtask fires → all subscribers notified once with the full set of invalidated keys
```

Framework bridges receive the batched notification and trigger one re-render, not three.

**`Reactivity` as a layer — provided or not:**

The beauty of making `Reactivity` a service: it's optional. In tests, you can provide a test `Reactivity` that gives you manual control:

```ts
const test = Effect.gen(function* () {
  const reactivity = yield* Reactivity;

  // Create atoms and queries
  const count = Atom.make(0);
  const doubled = Atom.make((get) => get(count) * 2);

  // Write
  count.set(5);

  // Manually flush reactivity (in tests, don't wait for microtask)
  yield* reactivity.flush();

  // Now doubled has recomputed
  assert.equal(doubled(), 10);

  // Inspect what was invalidated
  const invalidated = yield* reactivity.lastInvalidated();
  assert.deepEqual(invalidated, ["atom:<count-id>", "derived:<doubled-id>"]);
}).pipe(
  Effect.provide(Reactivity.test), // test implementation with manual flush
);
```

In production, provide the standard `Reactivity` layer:

```ts
Component.mount(App, {
  layer: Layer.mergeAll(
    AppLive,
    Reactivity.live, // standard implementation with microtask batching
    WebPlatformLive,
  ),
  target: root,
});
```

In standalone scripts without any framework, atoms still work — they just won't have `Reactivity` and writes are synchronous. The `Effect.catchAll(() => Effect.void)` fallback in the atom implementation means atoms gracefully degrade when no `Reactivity` service is present.

**Cross-component communication via Reactivity keys:**

`Reactivity` is already a pub/sub system. You don't need a separate `PubSub` for most cross-component communication:

```ts
// Toast notifications via reactivity keys
const toasts = Atom.make<Toast[]>([]).pipe(
  Atom.withReactivity(["toasts"]),
);

// Any component can trigger a toast by invalidating the key
// after updating the atom
function showToast(toast: Toast) {
  toasts.update((prev) => [...prev, toast]);
  // The atom write already invalidates ["toasts"] via Reactivity
  // All subscribers (the toast display component) re-render
}

// Or from an Effect
const saveAction = apiRuntime.action(
  Effect.fn(function* () {
    yield* api.save();
    toasts.update((prev) => [...prev, { message: "Saved!", type: "success" }]);
    // No need for separate PubSub — Reactivity keys handle the notification
  }),
);
```

For cases where you genuinely need event-style communication (not state-based), `Effect.PubSub` is still there. But for most UI reactive communication patterns, `Reactivity` keys are sufficient and simpler.

**The `Reactivity` service replaces:**

Our internal atom `.subscribe()` mechanism — atoms subscribe to reactivity keys instead.

Our internal dependency tracking graph — derived atoms subscribe to source keys via `Reactivity`.

Our internal batch notification system — `Reactivity` batches invalidations.

The `refresh()` function — becomes `Reactivity.invalidate(keys)`.

The `invalidates` option on mutations — becomes `reactivityKeys` (already exists in effect-atom).

The `FrameworkReactivityBridge` service — each framework bridge just subscribes to `Reactivity`.

Cross-component events for most cases — invalidation keys are the pub/sub mechanism.

**What the dependency graph looks like:**

```
Reactivity (from @effect/experimental)
  │
  ├── Atom.make(value)
  │     writes → Reactivity.invalidate([atomKey])
  │
  ├── Atom.make((get) => derived)
  │     subscribes → Reactivity.subscribe(sourceKeys)
  │     recompute → Reactivity.invalidate([derivedKey])
  │
  ├── apiRuntime.atom(effect)
  │     subscribes → Reactivity.subscribe(reactivityKeys)
  │     result change → Reactivity.invalidate([queryKey])
  │
  ├── apiRuntime.action(effect, { reactivityKeys })
  │     on success → Reactivity.invalidate(reactivityKeys)
  │
  ├── React bridge
  │     useSyncExternalStore → Reactivity.subscribe(atomKeys)
  │
  ├── Vue bridge
  │     watch → Reactivity.subscribe(atomKeys)
  │
  ├── Svelte bridge
  │     $effect → Reactivity.subscribe(atomKeys)
  │
  ├── Angular bridge
  │     signal → Reactivity.subscribe(atomKeys)
  │
  └── dom-expressions bridge
        createEffect → Reactivity.subscribe(atomKeys)
```

One service. One notification mechanism. Every atom, every query, every mutation, every framework bridge, every derived computation — all routing through `Reactivity`. The service is Effect-native, scoped, testable, and already exists in the ecosystem.

**The final layer stack for any app:**

```ts
// Core (always present)
const CoreLayer = Layer.mergeAll(
  Reactivity.live,      // THE reactivity engine — from @effect/experimental
  AppServicesLive,      // your business logic services
);

// Standalone (our own renderer)
Component.mount(App, {
  layer: Layer.mergeAll(CoreLayer, DomPlatformLive),
  target: root,
});

// React host
const reactBridge = createReactBridge(CoreLayer);
ReactDOM.createRoot(root).render(<reactBridge.Root component={App} />);

// Vue host
const vueBridge = createVueBridge(CoreLayer);
createApp(vueBridge.root(App)).mount("#root");

// TUI
Component.mount(App, {
  layer: Layer.mergeAll(CoreLayer, TuiPlatformLive),
  target: process.stdout,
});

// Test (no framework, no rendering)
Effect.gen(function* () {
  const bindings = yield* Component.setupEffect(App, {});
  // test bindings directly
}).pipe(
  Effect.provide(Layer.mergeAll(CoreLayer, Reactivity.test)),
);
```

`Reactivity` from `@effect/experimental` is the single piece that makes the entire multi-framework story work. It's the universal reactive glue. Everything subscribes to it, everything invalidates through it, and every framework bridge is just five lines of "subscribe to keys, update my framework's reactive primitive."