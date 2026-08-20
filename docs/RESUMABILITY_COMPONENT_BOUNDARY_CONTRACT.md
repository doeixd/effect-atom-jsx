# Resumability Component Boundary Contract

Status: unified restoration/activation controller and manual exact-once event
handoff implemented

This contract defines the ownership boundary required for partial component
activation. It builds on the state-only restoration kernel without treating
slot contracts, element roots, or server runtime objects as component
identity.

## Boundary identity

A component enters this protocol only when collection creates a document-local
`ComponentId`. The server render surrounds its complete output with paired
comment sentinels:

```html
<!--af:component:c0:start-->
...component output...
<!--af:component:c0:end-->
```

The corresponding manifest component record declares:

```ts
{
  region: {
    kind: "comment-pair";
  }
}
```

Paired comments are required because a component may render one element,
multiple sibling nodes, text, or no content. An element attribute cannot
represent all four cases.

Component IDs are document-local traversal identities. They are never build
identities and must not be supplied by application code. Portable component
and executable identities are separate build-stable addresses.

## Collection invariants

- Setup is observed only after its complete Effect commits.
- A snapshot is emitted only after the matching view acquires a rendered
  boundary.
- A committed snapshot without a rendered boundary is omitted and produces a
  `fallback-required` diagnostic.
- Start and end sentinels belong to exactly one component record.
- Regions must be properly nested; crossing regions are invalid.
- Slot contracts may enrich a region but never define its ownership.
- Server atoms, owners, Scopes, setters, listeners, and finalizers never cross
  the wire.

## Client boundary states

Each discovered region follows this state machine:

```text
Dormant -> Resuming -> Active
       \-> Activating -> Active

Dormant | Resuming | Activating | Active -> Disposed
```

The client adapter implements both active paths, a terminal `Failed` outcome,
and disposal from every live state. `ClientInstallation.resume(...)` prefers
`Dormant -> Resuming -> Active`; incomplete restoration moves the already
claimed controller to `Activating` and runs normal setup once.

- `Dormant`: markers and manifest record are validated; no component module or
  setup has run.
- `Resuming`: the adapter is allocating supported bindings in a fresh child
  Scope.
- `Activating`: restoration was incomplete or unsupported, so the addressable
  component module is loading and normal setup will run.
- `Active`: the component runtime owns the region and its event/resource
  lifecycle.
- `Disposed`: child work is interrupted and the boundary cannot dispatch.

Only one transition may claim a dormant boundary. Resumption and activation
are mutually exclusive after the claim.

## Event ownership and exact-once handoff

The root resumability installation remains the only dormant-region dispatcher.
Activated components do not install a second resumability dispatcher.

For an interaction within a dormant region:

1. Resolve the closest owning component boundary.
2. Atomically claim its transition.
3. If the event entry is independently portable, execute it without activating
   the component.
4. If the event requires activation, synchronously snapshot only the declared
   event projection, then load and activate the component.
5. Commit the component's listeners/resources before releasing the triggering
   event projection.
6. Mark the event as consumed by exactly one owner.

The native `Event` object is never retained across an asynchronous boundary.
Future event inputs must use predefined, schema-backed projections such as an
input value or checked state.

When a boundary becomes active, dormant markers remain inert metadata or are
removed atomically. Root dispatch consults boundary state before launching
work, preventing a resumed event and an activated handler from both executing
the same interaction.

## Failure policy

- Invalid, missing, duplicate, unknown, or crossing markers fail closed.
- Schema/build mismatches never attempt state restoration.
- Incomplete state may activate only when the manifest contains an explicit
  addressable activation entry.
- An arbitrary opaque component is not activatable merely because collection
  diagnosed it.
- Failed activation is terminal `Failed` for that installation and remains
  observable through `boundaryState`; it never silently reports `Active`.
- Disposal wins over in-flight resolution, restoration, or activation.

## Ownership

- The root client installation owns root listeners and dormant dispatch
  fibers.
- Each resumed or activated component owns one child Scope.
- The caller owns the `ManagedRuntime`.
- Closing a child Scope disposes component state/resources but not the root
  installation or caller runtime.
- Closing the root installation interrupts all child transitions it created
  and prevents later dispatch.

## Implemented activation slice

- `Resume.addressable(...)` is the terminal component combinator. It creates
  and publishes a portable activation entry whose captures are schema-encoded
  component props.
- `Resume.activationOf(...)` retrieves that entry with the final component's
  exact props, requirement, error, and binding axes. Wrapping afterward
  intentionally loses addressability, preventing SSR/client component drift.
- `Resume.componentActivation(...)` remains the low-level constructor for
  generated or framework-owned integrations.
- Manifest v2 records the activation descriptor beside the paired region.
- `ClientInstallation.activate(componentId)` is single-flight and
  `boundaryState(componentId)` exposes its state.
- `Active` is a readiness guarantee: component setup has completed and the
  initial view has synchronously mounted inside the validated range.
- Activation mounts only inside the validated marker pair under the
  caller-owned `ManagedRuntime`; installation disposal closes every activated
  component scope without disposing that runtime.
- Activating an owner disposes active or in-flight descendant regions before
  replacing their DOM.
- Unit and production-browser tests prove lazy loading, concurrent activation
  coalescing, readiness after delayed setup, exact-once mount/disposal, and
  terminal composition ordering.

## Implemented event handoff slice

- `Resume.event(...)` is independently portable and never activates its owning
  component merely to dispatch.
- `Resume.activationEvent(targetKey, Resume.MouseEventProjection, handler)`
  declares activation ownership explicitly. Installation validates that its
  marker belongs to the closest component boundary, that the boundary has an
  activation descriptor, and that replay targets are unique.
- The capture listener claims the native event synchronously, prevents its
  original propagation/default, stores only the Schema-decoded `mouse-v1`
  projection, and joins the boundary's single transition.
- Replay resolves the newly committed target/listener by its stable
  boundary-local key and invokes it once. Later events bypass the dormant
  marker path and use ordinary active listeners.
- Chromium proves incomplete restoration fallback, one module load, one setup
  and view, one triggering replay, later active dispatch, and one disposal.
