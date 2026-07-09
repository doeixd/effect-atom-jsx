# Event Contracts Plan

**Status:** proposed design; not part of the ratified prerelease scope until
explicitly accepted.
**Supersedes:** the runtime-wrapper proposal recorded in commit `2426e60`.
**Decision:** Event contracts use Effect `PubSub` and `Stream` as their
execution engine. This library will not reimplement an event bus, delivery
policy, buffering, subscription, shutdown, or stream-composition subsystem.

## Thesis

Effect already has the hard primitive. `PubSub` provides bounded, dropping,
sliding, and unbounded strategies; publishing; scoped subscriptions; shutdown;
and `Stream.fromPubSub` integration. A generic `Event.Runtime` that
wraps these operations would be a worse version of Effect: more API, less
control, and another set of delivery semantics to learn.

There is still a narrow framework value: a named, typed application contract
that maps to a specific Effect service. It can remove repeated wiring when a
logical event is shared across components, services, tests, and reactivity,
without hiding `PubSub` or `Stream`.

```ts
const FileDropped = Event.channel("file.dropped").pipe(
  Event.schema(FileDropSchema),
);

const AppLayer = Layer.mergeAll(
  Event.layer(FileDropped, { capacity: 64, strategy: "sliding" }),
  Reactivity.live,
  ApiLive,
);

yield* Event.publish(FileDropped, fileDrop);

const files = Event.stream(FileDropped).pipe(
  Stream.map((drop) => drop.files),
);
```

`FileDropped` is pure declaration data. Its Layer owns a single
`PubSub` in the normal Effect scope. `Event.publish` and
`Event.stream` are thin typed adapters. `Stream` remains the
composition surface.

## Scope

### In Scope

1. Named, typed event-channel contracts.
2. A Layer that provides one scoped `PubSub` per contract.
3. Data-first publish, untyped ingress, and stream accessors.
4. Component subscription and explicit Reactivity integration.
5. Testing and documentation that compare the abstraction to direct `PubSub`.

### Explicitly Out Of Scope

- A shared `Event.Runtime`, event registry, or module-global event bus.
- Custom fan-out, capacity, overflow, queueing, shutdown, scheduling, retry,
  or stream composition.
- A generic `Event.on` handler framework in the first slice. Use
  `Stream.runForEach` or `Component.subscription`.
- Request/reply, replay/history, durable work, cross-tab transport,
  serialization, hydration, or distributed events.
- An Atom adapter in the first slice.
- Automatic Atom-change publication, invalidation, or behavior forwarding.
- Topic wildcards and string-based routing.

## Model And Boundaries

An Event is a logical fact channel, not state or a workflow primitive.

| Need | Use |
| --- | --- |
| A fact independently observed by multiple consumers | `Event` / `PubSub` |
| Current state, derived UI state, and writes | `Atom` |
| A command with one result and errors | `Atom.action` / single flight |
| One-consumer work, retries, acknowledgements, durability | `Effect.Queue` or workflow infrastructure |
| Browser/renderer input | `View.Event` / `Element.on` |

Use direct `PubSub` when the channel is private to one service or does not
need a public name, schema ingress, or framework-facing integration. Do not add
an Event declaration merely to avoid importing `effect/PubSub`.

## Design

### Contracts Are Data; Channels Are Services

`Event.channel` creates an immutable branded contract. It allocates no
`PubSub`, starts no fiber, and is safe at module scope. Its name is
diagnostic/tooling metadata. Its symbol identity is the actual service key.

Each contract derives an opaque `ServiceMap.Key` for
`PubSub.PubSub<A>`. `Event.layer(channel, options)` creates the
backing PubSub with `Layer.scoped` and provides exactly that key.

```ts
const FileDropped = Event.channel("file.dropped").pipe(Event.schema(FileDropSchema));
const UserSignedIn = Event.channel("user.signed-in").pipe(Event.schema(UserSchema));

// This effect requires FileDropped's channel service only.
const publishDrop = (drop: FileDrop) => Event.publish(FileDropped, drop);
```

This is more precise than a generic runtime service. A Layer containing
`UserSignedIn` alone cannot satisfy `publishDrop`.

### Transport Is Effect PubSub, Without Translation

The Layer selects an Effect PubSub strategy. The Event module documents the
exact Effect semantics and returns the same publish acceptance result:

```ts
const accepted: boolean = yield* Event.publish(FileDropped, drop);
```

`accepted` means Effect accepted the item into the PubSub. It does not mean
a subscriber handled it successfully. There is no replay for later subscribers.
Failure, retry, buffering, concurrency, and supervision belong to each stream
consumer and use normal Effect APIs.

A small configuration object is acceptable only if it maps one-to-one to Effect:

```ts
Event.layer(FileDropped, { capacity: 64, strategy: "sliding" });
```

It must not add different strategy names, defaults, or failure behavior. If the
mapping becomes unstable against the pinned Effect beta, expose a low-level
Layer constructor that accepts the underlying PubSub effect instead.

No default unbounded channel is allowed. The author chooses a bounded
strategy/capacity or deliberately opts into `unbounded`.

### Schema Is Explicit Ingress

Schemas validate untyped boundaries such as request bodies, browser messages,
or WebSocket payloads. They are not a transport feature and must not make
`publish` an encode/decode round trip.

```ts
// Canonical decoded domain value A.
yield* Event.publish(FileDropped, fileDrop);

// Unknown or encoded input, decoded to A before publishing.
yield* Event.ingest(FileDropped, incomingMessage);
```

`Event.schema(schema)` infers decoded payload `A`. `ingest`
carries schema error and requirement axes. `publish` accepts `A`
without reencoding/redecoding it, which keeps transform schemas correct.

A development guard is optional and not a security boundary. Its availability
must be verified against the pinned Effect 4 beta before entering the API.

## Public API Target

The first public surface stays small:

```ts
const FileDropped = Event.channel("file.dropped").pipe(
  Event.schema(FileDropSchema),
);

const FileDroppedLive = Event.layer(FileDropped, {
  capacity: 64,
  strategy: "sliding",
});

yield* Event.publish(FileDropped, fileDrop);
yield* Event.ingest(FileDropped, unknownPayload);

const drops = Event.stream(FileDropped);
```

Member methods such as `FileDropped.publish(value)` are not first-slice
requirements. Documentation leads with data-first forms.

The type surface needs literal names, payload inference, and exact requirements:

```ts
interface EventChannel<Name extends string, A, DecodeE = never, DecodeR = never> {
  readonly name: Name;
  readonly [EventChannelTypeId]: typeof EventChannelTypeId;
}

type PayloadOf<T> = T extends EventChannel<any, infer A, any, any> ? A : never;
type NameOf<T> = T extends EventChannel<infer Name, any, any, any> ? Name : never;
type DecodeErrorOf<T> = T extends EventChannel<any, any, infer E, any> ? E : never;
type DecodeRequirementsOf<T> =
  T extends EventChannel<any, any, any, infer R> ? R : never;
```

`Event.publish(channel, payload)` and `Event.stream(channel)` require
that channel's service. `Event.ingest` adds only the schema's error and
requirement axes. Public declarations must not expose mutable implementation
state or generic registry types.

## Framework Integration

### Components

Use the existing `Component.subscription` in the first slice:

```ts
Component.make(() =>
  Effect.gen(function* () {
    const latest = yield* Component.state<Option.Option<FileDrop>>(Option.none());

    yield* Component.subscription(
      Event.stream(FileDropped),
      (drop) => latest.set(Option.some(drop)),
    );

    return View.make({}, null);
  }),
);
```

The channel service must bubble through the component `Req` type. The
component scope stops the stream at unmount. View/JSX construction never starts
a listener.

Use one Layer instance at the application composition root. A subtree can
intentionally provide a private channel Layer. Request-derived event data must
be provided per `ServerRoute.dispatch` Layer, never at process lifetime.

### Behaviors

`Behavior.eventBus` stays attachment-local. Event does not replace it or
automatically forward behavior out-events. If real applications repeat that
wiring, add a later opt-in adapter scoped with the attachment and explicit about
the logical contract it publishes.

### Reactivity, Routes, And Atoms

Events never invalidate queries by magic. Connect a domain fact to typed
Reactivity keys explicitly:

```ts
const refreshOnDrop = Stream.runForEach(
  Event.stream(FileDropped),
  (drop) => Reactivity.invalidate(Files.item(drop.id)),
);
```

This remains plain Effect in the first slice. A future
`Event.invalidates(channel, keyMapper)` needs a real repeated-use example
and must preserve key-mapper inference.

Do not add `Atom.fromEvent` initially. The immediate supported paths are:

1. Event stream -> `Component.subscription` -> component state/atoms.
2. Event stream -> explicit `Atom.action(...).runEffect(payload)`.
3. Event stream -> explicit reactivity invalidation.

The current `Atom.fromStream` ownership model needs its own audit before
a runtime-bound reducer becomes public. An eventual adapter must have a clear
background-stream owner and dispose with its runtime. There is no automatic
`Atom.onChange -> Event` bridge: internal writes are not necessarily
public facts, and automatic bridges create feedback loops.

Events are not loader state and are never serialized, hydrated, or replayed by
the router.

### Testing And Devtools

Tests use a real `Event.layer` with real Effect PubSub behavior through
`withTestLayer` or component render layers. Subscribe before publishing and
use Effect synchronization rather than arbitrary sleeps.

Devtools is deferred. A contract name may become useful metadata later, but the
Event module must not depend on `Devtools`, record payloads by default, or
create a core-to-devtools cycle.

## DX And Test Requirements

### DX

1. `Event.channel("file.dropped").pipe(Event.schema(...))` infers payloads
   without consumer generic annotations.
2. Missing Layers appear as readable ordinary Effect requirements.
3. A wrong payload fails at `Event.publish`, ideally naming the channel.
4. Docs show direct `PubSub` beside Event and explain when each is right.
5. Event adds no event-specific composition DSL over `Stream`.
6. Imports, declarations, and renders are side-effect free.
7. Avoid the word "runtime" in the public API; Effect already has the runtime.

### Required Tests

| Case | Required coverage |
| --- | --- |
| Contract declaration | Allocates neither PubSub nor subscriber. |
| Missing Layer | Fails in type tests, not through ambient undefined state. |
| Multiple contracts | Have distinct requirements and cannot cross-deliver. |
| Same Layer instance | Publisher/subscriber share exactly one channel. |
| Different Layer instances | Stay isolated; docs explain why. |
| Delivery strategies | Map exactly to Effect behavior. |
| Publish result | Preserves Effect's boolean acceptance result. |
| Schema transform | Ingest decodes unknown; publish accepts decoded A unchanged. |
| Component unmount | Subscription finalizes once and receives no later data. |
| Subscriber failure | Uses standard Stream supervision; Event does not swallow it. |
| Request scope | Request data cannot cross-deliver to another request. |
| Atom boundary | No hidden default-runtime fiber or automatic event/Atom loop. |

## Delivery Plan

### Phase 0: Prove The Pattern Outside The Library

**Status:** complete 2026-07-09. Evidence:
`src/__tests__/event-pubsub-spike.test.ts` is a direct Effect `PubSub` vertical
slice. It provides a typed service key through `Layer.effect`, subscribes before
publication, runs the stream through `Component.subscription`, invalidates a
parameterized Reactivity key, and proves stream finalization at scope exit.

Build one direct `Effect.PubSub` vertical slice:

1. a `FileDropped` payload;
2. a `PubSub.sliding<FileDrop>(64)` Layer;
3. a `Component.subscription(Stream.fromPubSub(...))` consumer;
4. a handler that invalidates `Files.item(drop.id)`;
5. tests for delivery and scope cleanup.

Record the boilerplate. If it does not reveal a stable contract/service pattern,
stop: this should remain a documented application pattern.

**Exit criterion:** Event removes demonstrated repeated wiring without hiding
PubSub or Stream semantics.

### Phase 1: Minimal Contract And Layer

**Status:** complete 2026-07-09. Implemented in `src/Event.ts` with runtime
coverage in `src/__tests__/event.test.ts` and type coverage in
`src/type-tests/event.ts`.

1. Add `src/Event.ts` with branded `EventChannel`, `channel`,
   `schema`, `layer`, `publish`, `ingest`, and `stream`
   only.
2. Implement Layer creation with Effect PubSub and normal Layer finalization.
3. Add the namespace export and `./Event` package subpath.
4. Add package smoke coverage and type tests for payload/schema/service
   requirements.

**Exit criterion:** no registry, custom buffering, handler DSL, or mutable
runtime state.

### Phase 2: Prove Integration And Document It

**Status:** complete 2026-07-09. Component-subscription coverage is included in
`src/__tests__/event.test.ts`; API, README, services/layers, testing, and LLM
guidance document the direct-`PubSub` boundary. Full typecheck, test, and build
gates are green.

1. Add focused tests using real Event Layers.
2. Add a component-scope cleanup test.
3. Add an explicit Reactivity invalidation test/example.
4. Document direct PubSub versus Event in README, API, services/layers, testing,
   and `llms.txt`.

**Exit criterion:** Event examples are shorter and clearer than direct PubSub
while retaining identical observable delivery behavior.

### Phase 3: Consider Only Proven Extensions

These are deliberately independent extensions. None is implied by declaring an
Event channel, and none should be added until at least two real application
sites demonstrate the same missing pattern. Each extension needs its own API
review, type tests, runtime lifecycle tests, and documentation.

#### Handler Descriptors And Handler Layers

**Problem to prove:** several application services repeatedly write the same
`Stream.runForEach(Event.stream(channel), handler)` setup in an app Layer, with
the same supervisor/error policy and lifecycle rules.

**Possible shape:** `Event.handler(channel, handler)` creates inert descriptor
data; `Event.handlers(...descriptors)` materializes subscriptions in the Layer
scope. A descriptor must preserve the payload, handler `E`, and handler `R`
types. It must not run while imported or constructed.

**Non-negotiable semantics:** a handler Layer starts once per Layer instance,
stops with that Layer's scope, and never converts a handler failure or defect
into a silent success. The base behavior should be fail-fast for the affected
subscription; retry, logging, isolation, and restart are explicit ordinary
Effect/Stream policies around the handler.

**Acceptance evidence:** two independent handler sites become materially
shorter; a test proves requirement/error unions across a handler set; runtime
tests prove exactly-once acquire/release, failure visibility, interruption, and
that one failed subscriber does not change unrelated PubSub subscribers.

#### Atom Reducers

**Problem to prove:** application code repeatedly reduces an Event stream into
long-lived readable state and needs that state outside one component instance.
Transient UI reactions continue to use `Component.subscription` directly.

**Precondition:** audit and settle the ownership contract of `Atom.fromStream`.
The current Event module must not create a background fiber through a hidden
default runtime or leave a stream alive after its owning runtime is disposed.

**Possible shape:** `Atom.runtime(appLayer).fromEvent(channel, { initial,
reduce })` returns a normal callable Atom. The runtime that bound the Atom owns
the stream consumer. Reducers run in publish order for that subscription; the
API must state whether a reducer defect terminates the consumer, is surfaced as
`Result`, or requires an explicit supervisor.

**Non-goals:** no implicit Atom creation for every Event, no `Event -> Atom`
cache keyed by channel name, and no automatic `Atom.onChange -> Event` bridge.
Those designs hide ownership and make feedback loops easy.

**Acceptance evidence:** a real app-level reducer replaces repeated code;
tests cover derived Atom updates, runtime disposal, no post-disposal writes,
reducer failure policy, and requirement subtraction through `Atom.runtime`.

#### Behavior Out-Event Forwarding

**Problem to prove:** multiple components need to expose the same
`Behavior.emits(...)` out-event as a named application event, and each currently
implements identical adapter code.

**Possible shape:** an explicit adapter such as
`Behavior.forwardEvent(localEvent, applicationChannel)`. It subscribes to one
behavior attachment-local bus and publishes to one named Event channel. The
mapping may transform payloads but must preserve payload types and the target
channel requirement.

**Boundary rule:** `Behavior.emits(...)` remains private/local by default.
Merely declaring an out-event must never publish to an application channel.
The adapter's lifetime is the behavior attachment scope, not the entire app;
unmounting the component removes the bridge.

**Acceptance evidence:** attachment/remount tests show no duplicate forwarding,
unmount prevents later publishes, target payload mismatches fail at compile
time, and a consumer cannot observe an undeclared behavior out-event.

#### Devtools Observation

**Problem to prove:** named Event publications materially improve debugging in
an existing Devtools workflow. A timeline should never be added just because
the channel has a name.

**Possible shape:** an opt-in observer Layer or adapter from Event channel
metadata to `Devtools` timeline entries. The Event core must not import
`Devtools`; the dependency remains one-way so the core stays usable without
developer tooling.

**Privacy rule:** record channel name, timestamp, delivery strategy, and
optional redacted summary by default. Do not record payloads unless the caller
provides an explicit serializer/redactor. Event payloads may include request,
auth, or file data.

**Acceptance evidence:** observer setup causes no additional subscription or
backpressure behavior, redaction is tested, disabled observation is allocation
free, and devtools failures cannot make publishing fail.

#### Automatic And Convenience Invalidation

Automatic invalidation is intentionally **not** a feature: publishing a fact
does not reveal which query, loader, or Atom should refresh. Hidden global
rules would make delivery order and refresh causes difficult to reason about.

The only candidate convenience is explicit declaration:

```ts
Event.invalidates(FileDropped, (drop) => [Files.item(drop.id)])
```

This is syntactic sugar for a scoped Event stream consumer that calls
`Reactivity.invalidating` or the Reactivity service. It must require a typed
key witness or key mapper, remain visible in the app Layer, and retain normal
handler supervision. It must not subscribe at channel declaration time and it
must not refresh unrelated loaders.

**Acceptance evidence:** at least two repeated explicit stream-to-key bridges;
type tests for static and payload-derived key witnesses; runtime tests for
parent/child key expansion, scoped cleanup, and no invalidation when no event
is published.

Do not add a central registry, Event-specific composition operators, a custom
transport abstraction, or any extension merely for apparent completeness.

## Success Criteria

The module is successful only if:

- it removes meaningful repeated wiring beyond importing PubSub;
- each logical channel is a typed scoped service, with no global bus;
- all transport behavior is inherited from and documented against Effect PubSub;
- schema ingress is explicit and transform-safe;
- component subscriptions are scope-safe and requirements bubble correctly;
- Atom/Reactivity integration is explicit, with no hidden fibers or cycles;
- direct PubSub remains an endorsed alternative; and
- type tests, runtime tests, package smoke tests, and the full quality gates pass.

## Decisions Required Before Implementation

1. Does the Phase 0 example demonstrate enough recurring boilerplate to justify
   a public module?
2. Which PubSub constructors can `Event.layer` expose one-to-one without
   drifting from Effect beta semantics?
3. Is schema ingress needed in the first slice, or should it wait for a real
   untyped producer?
4. Must a Layer always name capacity/strategy, or is one bounded default
   defensible?
5. Is `Event` the right public name given the DOM `Event` type, or is
   `Channel` clearer?
