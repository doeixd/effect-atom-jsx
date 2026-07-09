# Event Runtime Plan

**Status:** proposed design; not part of the ratified prerelease scope until
explicitly accepted.
**Owner:** core runtime / services layer
**Primary goal:** introduce typed, Effect-native logical events without adding
a process-global event bus or a second reactivity system.

## Problem

The library has three adjacent mechanisms, but none is a general logical-event
runtime:

- DOM events are renderer metadata (`View.Event`) and element-handle callbacks.
- `Behavior.eventBus(...)` is a small attachment-local callback bus for behavior
  out-events.
- `Effect.Stream` and `Component.subscription(...)` provide execution and
  lifecycle primitives, but no named, typed, layer-provided event source.

Applications need to publish domain facts such as `file.dropped`,
`cart.checkedOut`, or `notification.received`, then consume those facts from
components, services, and route-adjacent code with normal Effect requirements,
scopes, and error types. The source must be explicit, scoped, testable, and
observable. It must not become an ambient global `EventEmitter`.

## Product Position

An Event is a **typed logical fact channel**. It is neither current state nor
a command/reply protocol.

| Use this | For |
| --- | --- |
| `Event` | Broadcast a fact that happened to zero or more independent consumers. |
| `Atom` | Hold current, readable/writable state and derive UI values. |
| `Atom.action` / single flight | Run a command and observe one typed result. |
| `Effect.Queue` / workflow infrastructure | One-consumer, durable, retried, or acknowledged work. |
| `View.Event` / `Element.on` | Renderer input such as a press, input, or focus event. |

The initial module is in-process only. It deliberately makes no delivery,
durability, cross-tab, network, or SSR-replay guarantees.

## Goals

1. Define events as pure, named, typed values; declaration allocates no
   listeners, queues, fibers, or global state.
2. Make publish, stream consumption, and handler installation lazy
   `Effect`/`Stream` programs with requirements visible on their `R` axis.
3. Provide a Layer-backed runtime with app, subtree, and request lifetimes.
4. Use Effect's scoped resource model so subscriptions disappear on component
   unmount, request completion, or runtime disposal.
5. Support optional Effect Schema validation at explicitly named untyped
   ingress points.
6. Preserve `A`, `E`, and `R` through event handlers and component setup.
7. Make event-to-Atom and event-to-Reactivity bridges explicit and testable;
   do not create hidden bidirectional coupling.
8. Offer a deterministic test runtime and a low-overhead observation hook for
   devtools.

## Non-Goals

- Replacing Effect `Stream`, `PubSub`, `Queue`, `Schedule`, or `Hub` APIs.
- A global singleton that works without a provided runtime.
- A durable event log, replay, transaction log, distributed bus, or RPC.
- Request/reply or collecting subscriber results from `emit`.
- Automatically emitting an event for every Atom write or every behavior
  out-event.
- DOM event normalization, event delegation, or serializing/hydrating events.
- Topic wildcards, stringly typed routing, or cross-package discovery in the
  first slice.

## Architectural Decisions

### 1. Split the contract from execution

`Event.make(...)` creates an immutable contract. `Event.Runtime` is the
Effect service that maps a contract identity to its live channel. This is the
data-first boundary:

```ts
const Dropped = Event.make("file.dropped").pipe(
  Event.schema(FileDropSchema),
  Event.delivery({ capacity: 64, strategy: "sliding" }),
);

// No runtime allocation or subscription happened above.

const AppLayer = Layer.mergeAll(
  Event.Runtime.live(),
  Reactivity.live,
  ApiLive,
);

yield* Event.emit(Dropped, drop); // Builds and then runs only when yielded.
```

The contract holds stable metadata used for types, diagnostics, and tooling:

- `name`: a human-readable, namespaced identifier (`"file.dropped"`),
- an opaque identity token that is the real runtime key,
- payload type and optional schema metadata,
- optional delivery policy metadata, and
- future-safe descriptive metadata such as `description` or `visibility`.

Two declarations with the same name are not silently treated as the same
contract. Identity prevents accidental type aliasing. Development diagnostics
should warn when one runtime observes duplicate names with incompatible
payload/schema/delivery descriptions.

### 2. Runtime is a service, not a module singleton

The public service is exposed as `Event.Runtime` / `Event.RuntimeTag` and
provided by `Event.Runtime.live(options)`. The exact internal primitive can be
Effect `PubSub`, a hub, or a small adapter over the beta API; callers depend
only on the Event runtime interface.

The live runtime must lazily allocate a channel only once it is first published
to or subscribed to. It owns all channels and closes them when its Layer scope
closes. This makes the provision tier meaningful:

| Provision site | Event runtime lifetime | Appropriate use |
| --- | --- | --- |
| App root | one shared application bus | application services and independent feature trees |
| Common subtree | one feature-local bus | a modal/workspace that should not leak events outward |
| Server dispatch | one request bus | request-derived events only; never share auth/request payloads across requests |
| Test layer | one deterministic bus per test | assertions and isolated stories/scenes |

The Event runtime belongs in the same `AppLayer` instance passed to both
`Atom.runtime(AppLayer)` and `Component.mount(..., { layer: AppLayer })`.
Using separately built layers would create separate buses, exactly like the
existing Reactivity sharing pitfall.

### 3. Broadcast semantics are explicit

The first live runtime is a hot in-process broadcast channel:

- A publish with no active subscriber succeeds and the event is dropped.
- Active subscribers each receive the published value once, in publication
  order for that contract.
- A subscription begins at subscription time; there is no replay.
- Subscribers do not share handler failures. A failed handler terminates its
  own stream/subscription according to its chosen supervision policy.
- `emit` reports schema/ingress and delivery errors only. It never waits for,
  aggregates, or returns subscriber results.
- Reentrant publishing is permitted but must preserve documented per-contract
  ordering and never deadlock under a backpressure policy.

Delivery pressure is a runtime concern, so the contract can request a policy
while the runtime supplies validated defaults. The initial vocabulary is:

- `backPressure`: publish waits for available capacity;
- `dropping`: discard an incoming item when capacity is exhausted;
- `sliding`: retain the newest items and discard the oldest;
- `unbounded`: opt-in only, with a development warning because it can leak
  memory.

The implementation must confirm which of these strategies Effect 4 beta
supports directly and write adapter tests rather than leaking beta-specific
types from the public API.

### 4. Schema distinguishes trusted publish from untyped ingress

Schema transformations make a single ambiguous `emit` input type dangerous.
The API therefore has two explicit paths:

```ts
// Publish an already-decoded domain payload. The TypeScript contract is A.
yield* Event.emit(Dropped, drop);

// Decode untyped/encoded input at a boundary, then publish its A payload.
yield* Event.ingest(Dropped, requestBody);
```

`Event.schema(schema)` sets the decoded event payload type. `ingest` accepts
`unknown`, runs the schema decoder, and carries the schema's requirements and
typed decode error. `emit` may run a compatible runtime guard in development,
but it must not encode then decode a typed payload merely to validate it. That
would be wrong for transform schemas (for example, wire string -> `Date`).

The final API must document whether a validation guard on `emit` is enabled by
default, development-only, or an explicit `Event.validatePublished` policy.
It must never claim that TypeScript alone validates hostile input.

## Proposed Public Surface

Names below are design targets, not a mandate to ship every convenience in the
first pull request.

```ts
import { Event } from "effect-atom-jsx";
import { Effect, Layer, Schema, Stream } from "effect";

const Dropped = Event.make("file.dropped").pipe(
  Event.schema(FileDropSchema),
);

const AppEventsLive = Event.Runtime.live();

// Data-first forms. The member forms are thin discoverability conveniences.
yield* Event.emit(Dropped, drop);
yield* Dropped.emit(drop);
yield* Event.ingest(Dropped, unknownPayload);

const drops: Stream.Stream<FileDrop, never, Event.Runtime> = Event.stream(Dropped);

yield* Event.on(Dropped, (drop) =>
  Effect.log(`received ${drop.id}`),
);
```

### Contract and extraction types

The exported contract should have a small, stable generic shape:

```ts
interface EventContract<Name extends string, A, DecodeE = never, DecodeR = never> {
  readonly name: Name;
  readonly [EventTypeId]: typeof EventTypeId;
  // Phantom fields extract Name/A/DecodeE/DecodeR without exposing internals.
}

type EventPayloadOf<T> = T extends EventContract<any, infer A, any, any> ? A : never;
type EventNameOf<T> = T extends EventContract<infer Name, any, any, any> ? Name : never;
type EventDecodeErrorOf<T> = T extends EventContract<any, any, infer E, any> ? E : never;
type EventDecodeRequirementsOf<T> = T extends EventContract<any, any, any, infer R> ? R : never;
```

Use a unique symbol brand and conditional extraction helpers, matching the
library's `View` slot and reactivity-key witness patterns. Do not export the
runtime's map, queue, subscriber set, or Effect beta primitive types.

The exact Effect Schema generic names must be validated against the pinned
Effect 4 beta version during implementation. Public types should expose the
schema's decoded payload and decode requirement/error axes, not `any`.

### Execution APIs and error behavior

| API | Result | Requirement / scope behavior |
| --- | --- | --- |
| `Event.emit(event, payload)` | `Effect<void, EventPublishError, Event.Runtime>` | Lazy publish of a typed value. |
| `Event.ingest(event, input)` | `Effect<void, SchemaError \| EventPublishError, Event.Runtime \| DecodeR>` | Decode unknown input then publish. |
| `Event.stream(event)` | `Stream<A, never, Event.Runtime>` | Subscribes only while its consumer runs. |
| `Event.on(event, handler)` | `Effect<void, E, Event.Runtime \| Scope.Scope \| R>` | Starts a scoped handler; preserve handler `E`/`R`. |
| `Event.handle(event, handler)` | pure `EventHandler<A, E, R>` data | Describes an application handler without starting it. |
| `Event.handlers(...handlers)` | `Layer<never, E, Event.Runtime \| R>` | Materializes handler descriptors in the layer scope. |

`Event.on` needs a documented supervision choice. The recommended first API is
fail-fast for that subscription: a handler failure closes only that subscriber
and propagates through the fiber that installed it. Add isolation/retry only
as an explicit wrapper, such as `Event.catchAll(handler, recovery)` or normal
`Stream` operators. Silent `catchCause(() => Effect.void)` is forbidden.

For maximum transparency, `Event.stream(event)` is the fundamental primitive;
`on` and `handlers` are ergonomic adapters built with `Stream.runForEach` and
scoped fibers.

## Integration Plan

### Components and views

Components consume event streams through the existing scoped subscription
mechanism rather than acquiring listeners during render:

```ts
Component.make(() =>
  Effect.gen(function* () {
    const latest = yield* Component.state<Option.Option<FileDrop>>(Option.none());
    yield* Component.subscription(
      Event.stream(Dropped),
      (drop) => latest.set(Option.some(drop)),
    );
    return View.make({}, null);
  }),
);
```

The implementation must verify that `Component.subscription` preserves the
`Event.Runtime` requirement through `Component.Requirements` and cancels its
stream when the component scope is disposed. A small `Component.events(...)`
convenience may be considered only after this direct path is ergonomic in real
examples.

Events are logical and renderer-neutral. They do not appear in `View.Slots`
or `View.Event` capability metadata. A behavior may publish a logical event,
but event wiring remains outside the component unless the component explicitly
publishes that contract.

### Behaviors

Keep `Behavior.eventBus` attachment-local in the first slice. It is useful for
parent coordination and should not begin writing to a global application bus
implicitly.

After the runtime is proven, add an explicit bridge:

```ts
const publishDismissed = Behavior.forwardEvent(Dismissed, AppDismissed);
// or Event.forward(behaviorBus, Dismissed, AppDismissed)
```

The bridge must be opt-in, scoped with the attachment, and preserve behavior
event payload types. Do not make a `Behavior.emits(...)` declaration itself a
global publish side effect.

### Atoms

Events are an input to state, not a replacement for it. The integration should
arrive in stages.

**Stage A: direct stream-to-component state.** Use `Event.stream(...)` with
`Component.subscription(...)`. This is already enough for transient UI
responses and proves requirement/lifecycle behavior without new Atom API.

**Stage B: runtime-bound reducer adapter.** Add an Atom-runtime method only
after Stage A is covered:

```ts
const app = Atom.runtime(AppLayer);

const recentDrops = app.fromEvent(Dropped, {
  initial: [] as ReadonlyArray<FileDrop>,
  reduce: (current, drop) => [...current, drop].slice(-20),
});
```

`fromEvent` must be owned by the same runtime/layer that owns the subscription.
It must dispose its background consumer with that runtime and must not use a
hidden default runtime. It should return a normal callable Atom, so regular
derived atoms and UI reads work unchanged.

Do **not** implement Stage B by directly reusing the current `Atom.fromStream`
without an ownership audit: that API forks a stream under a runtime and is not
yet a proof that `Event.Runtime` requirements and shutdown follow the desired
scope. The new adapter should establish the correct lifecycle first; any
subsequent `Atom.fromStream` improvement can share that machinery.

**Stage C: explicit reactivity bridge.** Event publication does not invalidate
queries by magic. Provide a handler descriptor that maps a fact to semantic
keys:

```ts
const refreshFile = Event.invalidates(Dropped, (drop) => [Files.item(drop.id)]);
const AppHandlers = Event.handlers(refreshFile);
```

Internally this uses `Reactivity.invalidating`, retaining the existing rule
that services and domain facts couple through typed key witnesses. The mapper
is required for payload-specific keys; static key arrays are a convenience.

**Stage D: actions are explicit consumers.** A handler may invoke
`Atom.action(...).runEffect(payload)`, with its normal `Result` and
single-flight policy. Do not invent `Event<Result<A, E>>` as a default
protocol or turn a broadcast fact into a command/reply channel.

Likewise, no global `Atom.onChange -> Event` bridge ships in this module.
Applications can emit a named domain fact from the action/service method that
caused a state change. This avoids feedback loops, accidental duplicate facts,
and treating internal state writes as public domain behavior.

### Routes, SSR, and server routes

- Client application events may use the app-root runtime.
- Events derived from a request, authenticated identity, or request-local
  loader state must use a runtime built in that request's `ServerRoute.dispatch`
  layer. Never provide such a bus at process lifetime.
- Events are not hydrated, replayed, serialized into loader payloads, or used
  as a substitute for route loader state.
- A route/service can publish a domain fact and an explicit event handler can
  invalidate reactivity keys, allowing the existing loader refresh mechanism
  to remain the source of truth.

### Testing and devtools

`Event.Runtime.test()` should be a real service implementation, not a fake
global. It must expose only test helpers required to make timing deterministic:

- a way to observe accepted publishes by contract,
- a way to flush scheduled delivery if delivery is asynchronous,
- subscriber/channel counts for leak assertions, and
- configurable capacity/overflow behavior for boundary tests.

Keep these helpers in `effect-atom-jsx/testing` or clearly marked test-only
exports. Production code should not couple to runtime internals.

The live runtime exposes optional observation events, for example
`published`, `dropped`, `subscribed`, `unsubscribed`, and `handlerFailed`.
`Devtools` can adapt them into its timeline without `Event` importing
`Devtools`; that one-way dependency prevents a core/runtime cycle. Payload
recording must be opt-in or redacted by default because logical events can
carry secrets.

## DX Requirements

1. `Event.make("file.dropped").pipe(Event.schema(...))` infers the payload
   without explicit generic arguments in normal application code.
2. Both data-first and member forms are available, but documentation leads
   with data-first APIs: `Event.emit(event, value)`, `Event.stream(event)`,
   `Event.on(event, handler)`.
3. Missing `Event.Runtime` appears as an ordinary, readable Effect requirement
   in component, handler, and route types. It must not fail later with a
   module-global undefined error.
4. Incompatible schemas, duplicate contract names, and unsupported delivery
   settings produce focused diagnostics. Do not expose a 40-line structural
   dump involving branded internals or Effect `PubSub` generics.
5. The error message for `Event.emit(Dropped, wrongPayload)` names the event
   and expected payload shape where TypeScript allows it.
6. Documentation includes one app-root service example, one scoped component
   subscription, one schema ingress example, one Atom reducer, and one test
   layer example. It also contains a clear "when not to use Event" table.
7. No method starts work merely because a module was imported or a component
   rendered; only a running Effect/Stream or acquired Layer does so.

## Edge Cases and Failure Modes

| Risk | Required behavior / test |
| --- | --- |
| No subscriber | `emit` succeeds; event is not retained or replayed. |
| Slow subscriber | Capacity strategy has deterministic documented behavior; no unbounded default queue. |
| Subscriber failure | It affects only that subscription unless an explicit supervisor says otherwise. |
| Handler throws defect | Record/observe it and terminate or supervise the affected handler; never silently swallow it. |
| Publish after runtime shutdown | Fail with a dedicated closed-runtime error, not a null dereference. |
| Subscription after shutdown | Fail/terminate predictably and release all resources. |
| Component unmount | Its event subscription finalizes exactly once and cannot receive later events. |
| Reentrant emit | Does not deadlock; ordering is specified and regression-tested. |
| Duplicate contract names | Identity remains separate; development diagnostics report incompatible declarations. |
| Schema transform | `ingest` decodes encoded input; `emit` accepts canonical decoded `A` without accidental round-trip. |
| Multiple app layers | Events do not cross runtimes; docs warn to use the one composition root. |
| SSR request data | Per-request event runtime is released after dispatch; no cross-request listener or payload leakage. |
| Devtools payloads | Observation defaults to metadata/redaction, never secret payload capture by accident. |
| Atom bridge cleanup | Runtime/component disposal stops its consumer and prevents post-disposal Atom writes. |
| Event/Atom cycle | No automatic Atom-change publishing; explicit bridges document cycle risks. |

## Implementation Sequence

### Phase 0: ratify semantics and spike Effect primitives

1. Decide the initial default capacity and overflow strategy.
2. Confirm Effect 4 beta `PubSub`/stream shutdown, interruption, and strategy
   behavior with a focused spike. Keep it private.
3. Decide whether publish uses development runtime guards, and name the schema
   error type surfaced by `ingest`.
4. Write an ADR if the app-vs-request runtime lifetime decision differs from
   this plan.

**Exit criteria:** a written decision table for delivery, failures, shutdown,
schema ingress, identity/name collisions, and handler supervision.

### Phase 1: contracts and type surface

1. Add `src/Event.ts` with `EventContract`, symbol brand, constructors,
   `schema`, delivery metadata, extraction helpers, and compile-time error
   shaping.
2. Add `Event` to `src/index.ts`, `package.json` `exports`, and build/package
   tests.
3. Add `src/type-tests/event.ts` covering literal name preservation, schema
   inference, invalid payload rejection, schema error/requirement propagation,
   and no explicit generic arguments in the golden path.

**Exit criteria:** declaration code is allocation-free; emitted `.d.ts` has no
leaked internal mutable/runtime types; package entry test imports `./Event`.

### Phase 2: runtime and fundamental execution

1. Define the service tag and internal runtime interface.
2. Implement `Runtime.live`, channel registry, lazy creation, scoped close,
   and explicit closed-runtime errors.
3. Implement `emit`, `ingest`, and `stream`; build `on` from stream execution
   rather than separate listener machinery.
4. Implement a deterministic `Runtime.test` layer and test utilities.

**Exit criteria:** fan-out, ordering, no-replay, capacity behavior, shutdown,
schema ingress, and subscriber finalization are covered by runtime tests.

### Phase 3: handler descriptors and composition

1. Add pure `Event.handle` descriptors and `Event.handlers` Layer materializer.
2. Preserve the union of handler requirement/error types across a handler set.
3. Add explicit supervision wrappers, if needed, only after a fail-fast base
   path is proven.
4. Add `Event.invalidates` as a handler descriptor, using existing typed
   `Reactivity.Key` witnesses.

**Exit criteria:** handler layers start once, stop with their Layer scope,
surface errors correctly, and do not interfere with sibling subscribers.

### Phase 4: framework integration and documentation

1. Demonstrate `Event.stream` with `Component.subscription` and verify
   `Component.Requirements` includes `Event.Runtime`.
2. Add service/layer guidance to `SERVICES_AND_LAYERS.md`, including the
   one-composition-root and server request-scoping rules.
3. Add focused `API.md`, README, `TESTING.md`, and `llms.txt` documentation.
4. Add Devtools adapter hooks without creating a core-to-devtools import.
5. Add an explicit behavior bridge only if a component/behavior example proves
   it is necessary.

**Exit criteria:** a new user can implement an event producer and scoped
consumer without reading internal runtime code; docs do not describe events
as state, RPC, or a DOM abstraction.

### Phase 5: Atom adapter, only after lifecycle proof

1. Design `Atom.runtime(layer).fromEvent(...)` against the finalized runtime
   ownership model.
2. Implement reducer/update semantics, initial state, error observation policy,
   disposal, and test-runtime support.
3. Test derived Atom reactions, mount/unmount cleanup, no post-disposal writes,
   and explicit event-to-Reactivity invalidation.
4. Decide separately whether a generalized scoped `Atom.fromStream` should be
   introduced or refactored to share the lifecycle engine.

**Exit criteria:** the adapter is not a hidden default-runtime fiber; its
lifetime, error policy, and requirement subtraction are clear in types/docs.

## Test Matrix

Add focused runtime tests (`src/__tests__/event.test.ts`), type tests, and only
then integration tests:

1. Typed payload publish/stream and literal name inference.
2. Schema `ingest` success, typed decode failure, and transform-schema
   canonical payload behavior.
3. Publish before subscribe does not replay.
4. Two subscribers receive the same ordered sequence.
5. Capacity behavior for each supported strategy.
6. Handler failure and defect behavior do not poison unrelated subscribers.
7. Cancelled subscription receives no later values; cleanup runs once.
8. Runtime shutdown closes all channels and rejects later operations
   predictably.
9. Duplicate names trigger diagnostics without merging contracts.
10. `Event.handlers` preserves requirements/errors and acquires/releases once.
11. `Event.invalidates` reaches a static key and a payload-derived key family.
12. `Component.subscription(Event.stream(...))` bubbles requirements and
    disposes with component scope.
13. Request-scoped server runtimes do not cross-deliver payloads.
14. Test layer observes deliveries without sleeps or production internals.
15. The eventual Atom adapter updates/derives correctly and shuts down cleanly.

## Success Criteria

The module is ready to be called complete when all of the following are true:

- Event declarations are pure data and execution is lazy/effectful.
- The public API preserves payload, decode error, and service requirements
  without consumer generic annotations in the documented path.
- Runtime identity and scope are explicit; no event state is process-global.
- Broadcast, ordering, buffering, failure, shutdown, and schema semantics are
  documented and proven by tests.
- Components and handlers use normal scoped Effects; unmount and request
  teardown do not leak listeners or fibers.
- Atoms consume events only through explicit, owned bridges; Atom changes do
  not automatically become global events.
- Reactivity invalidation is explicit and uses key witnesses.
- Test and devtools support do not compromise production encapsulation or
  expose event payloads by default.
- `npm run typecheck:all`, `npm test`, and `npm run build` pass, including
  package-subpath smoke coverage.

## Decisions Still Required

1. Is `backPressure`, `sliding`, or another strategy the default? The answer
   controls whether ordinary `emit` can block under a slow subscriber.
2. Does the initial release include all delivery strategies or only the ones
   Effect's beta primitive can prove safely?
3. Is a production `emit` runtime guard enabled by default for schema events,
   or is `ingest` the only validating boundary?
4. What is the exact public failure policy for `Event.on` and Layer-installed
   handlers: fail the installation fiber, report-and-stop, or require explicit
   supervision wrappers?
5. Do duplicate names always diagnose, or only when schema/delivery metadata
   conflicts? How is the diagnostic surfaced in a runtime without Devtools?
6. Is the Atom reducer adapter important enough for the first release, or
   should the first module ship only the composable Stream + component path?
7. Should application-wide event publication be an optional Devtools timeline
   source, and what redaction contract protects sensitive payloads?

Until these are answered, Phase 1 and Phase 2 can proceed only as a design
spike, not as a public API commitment.
