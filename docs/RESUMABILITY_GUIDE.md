# Resumability Guide

This guide explains what resumability means in AF-UI, how it differs from
hydration, which APIs opt a component into it, and the security and deployment
rules every adapter must follow. It documents the runtime protocol as of
Milestones 0–6 of `RESUMABILITY_IMPLEMENTATION_PLAN.md`.

## The three capability levels

AF-UI deliberately distinguishes three things that are often conflated:

### 1. Hydration

Hydration restores **values** and then reconstructs the client application by
running setup and view code again. The scalar and family hydration identity
system (`Hydration.dehydrate` / `Hydration.hydrate`, keyed atoms, ADR-005)
seeds client atoms with server values, but every component's setup Effect and
view still execute on the client.

Hydration is the default and remains fully supported. Nothing in this guide is
required for an ordinary AF-UI application.

### 2. Partial portability

A value is **portable** when it carries enough supported metadata to be
represented across runtimes: a stable code identity, schema-validated
captures, or a schema-backed state/query snapshot. Portability is opt-in and
per-value. A component can mix portable bindings with opaque ones; collection
emits explicit fallback diagnostics for whatever cannot cross the boundary,
and the component then relies on **activation fallback** (running its real
setup/view on the client) instead of silently mis-serializing.

### 3. Resumability

Resumption restores a specific **executable relationship** — an event handler,
an action, a settled query, a behavior attachment — without replaying the
component tree that originally discovered it. The client renders server HTML,
reads a manifest, and lazily loads only the code a user interaction actually
needs. Client setup and view execution counters stay at zero until (and
unless) a component genuinely needs activation.

AF-UI today provides resumability for:

- **Events/actions** — zero-argument portable component actions attached via
  `Resume.event(...)` (Milestone 4, browser-proven).
- **Component state** — schema-backed `Resume.snapshotState(...)` bindings
  restored by `Resume.restoreStateBindings(...)` without setup replay
  (Milestone 5).
- **Component activation** — explicitly addressable components via
  `Resume.addressable(...)` with schema-backed props, mounted lazily into
  validated comment-pair DOM regions (Milestone 5).
- **Queries** — settled portable query results rendered from the manifest,
  with the executor loaded only on refresh (Milestone 6).
- **Behaviors** — portable behavior attachments reattached in a fresh Scope
  without rerunning base component setup (Milestone 6).

Fine-grained text resumability is implemented for explicit compiler-extracted
`expr(...)` regions. New collections use manifest v4 discriminated text
targets; `{ kind: "text" }` implies the existing durable comment pair rather
than repeating an identical region object per expression. Legacy manifest v3
text records remain decodable and installable. The records carry semantic
dependency keys, and the client installs lightweight
dormant subscribers without importing their modules, then lazily resolves and
patches only the affected SSR text region on the first invalidation. Lists,
branch replacement, portals, suspense, nested expressions, and HTML still fail
closed or require activation. Manifest v4 also ratifies
attribute/class/style-property target metadata and its validated element-marker
scanner, but client patch strategies and compiler lowering remain fenced until
the next Milestone 8c slices.

## Core protocol pieces

### Code identity: `Portable.code`

```ts
const SaveCode = Portable.code({
  id: "app.todo.save",            // stable logical identity — never a URL
  buildId: BUILD_ID,               // deployment identity
  captures: Schema.Struct({ label: Schema.String }),
  run: (captures) => Effect.gen(function* () { /* ... */ }),
})

const bound = Portable.bind(SaveCode, { label: "Save" })
```

A `Code` is runtime code exported by an independently loadable module. Its
wire form is a `Descriptor` (`{version, kind: "portable.code", id, buildId,
captures}`) produced by `Portable.describe(...)`: captures are encoded through
their schema and checked for JSON safety. The client resolves descriptors
through `Portable.Resolver` (`makeResolver(entries)`), which memoizes module
loads and normalizes loader failures.

### Portable component APIs

- `Component.action(Portable.bind(code, captures), options?)` — portable
  action; `Resume.event(action)` publishes the zero-argument deferred
  invocation contract for SSR event collection.
- `Resume.activationEvent(targetKey, Resume.MouseEventProjection, handler)` —
  activation-required event. The native event is synchronously reduced to the
  predefined Schema-backed projection, then replayed through the committed
  listener after restore-or-activate. `targetKey` must be unique for that event
  type inside the owning component boundary. The mouse projection is accepted
  only for mouse-, pointer-, drag-, and wheel-family event types; attaching it
  to an incompatible event such as `keydown` fails closed instead of replaying
  fabricated zero-valued coordinates.
- `Component.query(Portable.bind(code, captures), options?)` — portable query
  returning a `Component.QueryAtom`; pair with
  `resume: Resume.snapshotQuery(schema)` on the named binding. Its
  `reactivityKeys` option is normalized through the same semantic-key system
  as actions and route loaders. Retry-schedule errors and retry/poll service
  requirements remain visible in the inferred query/setup types. Queries with
  retry or poll schedules still require activation because resumability does
  not claim to restore schedule progress.
- `Component.state(initial)` with `resume: Resume.snapshotState(schema)` —
  snapshot-capable state binding.
- `Resume.addressable({ id, buildId, props })` — terminal wrapper that makes a
  component activatable by identity with schema-backed props. Apply other
  wrappers first; `addressable` last.
- `Behavior.portable(Portable.bind(code, captures))` — behavior whose
  attachment is addressable; `Behavior.attachScoped(behavior, elements)`
  reattaches it on a client in a fresh Scope.

### Server collection

`Resume.collect(render, { buildId })` runs a synchronous SSR render inside a
resume session and returns HTML, a versioned manifest, its serialized form,
and an inert `<script type="application/json" data-af-resume>` tag. The
  manifest is v1 (events only), v2 (events + component snapshots), or v4 when
  fine-grained expression targets are present. Legacy v3 text manifests remain
  decodable and installable.

Whatever cannot be represented emits a **collect diagnostic** with
`disposition: "fallback-required"` — for example `opaque-event-handler`,
`unsettled-query-snapshot`, `opaque-query-executor`,
`unsupported-query-semantics` (retry/poll schedules), or
`missing-component-boundary`. Diagnostics are the contract: nothing opaque is
ever silently serialized.

### Client installation and restoration

- `Resume.decodeManifest(serialized, expectedBuildId)` — validates the payload
  size, schema, and build identity.
- `Resume.installClient({ root, manifest, expectedBuildId, resolverEntries,
  runtime })` — validates the marker/manifest bijection, installs root-scoped
  capture listeners, shares one memoized resolver, and executes each event in
  a fresh Effect Scope on the caller's `ManagedRuntime`. Its disposer removes
  listeners and interrupts in-flight work without touching the caller's
  runtime. The returned installation exposes `resume(componentId)` for
  restore-first boundary activation and `activate(componentId)` for explicit
  normal setup. Resume falls back once, with a client diagnostic, only for a
  documented restoration error and only with an explicit activation
  descriptor. The restoration Scope is fully closed first. During either
  activation path, dormant expressions are quiesced but retained until the
  active mount commits. A typed loader or component failure rolls back to
  dormant ownership and a later interaction may retry; missing/mismatched
  descriptors, capture/build drift, defects, and disposal remain terminal.
- `Resume.restoreStateBindings(component, manifest, componentId, props?)` —
  validates the complete snapshot before allocating, then creates fresh state
  handles and seeded query atoms under a new Scope and Registry. Required
  component props are required by the call signature and are available to
  portable behavior reattachment; `{}` and fully optional props may be
  omitted. Query bindings expose `restored.queries[name]` with `refresh`,
  canonical `reactivityKeys`, and a deterministic `cacheKey` derived from its
  descriptor and canonical
  reactivity keys. Refresh loads the executor only when run and
  preserves the component's service requirements in its Effect environment.
  The boundary coordinator consumes the restored invalidation metadata; until
  that coordinator is installed, direct low-level restoration callers invoke
  `refresh` themselves.
- `Resume.scanComponentBoundaries(root, manifest)` — validates comment-pair
  regions for the activation layer.

## What is never serialized

The wire format carries **addresses and schema-validated data, not code or
live resources**. The following are never placed on the wire:

- JavaScript closures, function source, or `eval`-able payloads.
- Effect `Layer`, `Scope`, `Fiber`, `Context`/service instances, streams,
  subscriptions, or resource handles.
- Live atoms, signals, setters, reactive owners, or schemas.
- DOM nodes or renderer handles.
- Retry/poll schedule state (queries using them fall back instead).

Server-side finalizers always run: the server Scope is closed before client
execution, and tests prove no server service instance survives the boundary.

## Security rules

1. **Code identities are addresses, not URLs.** The resolver maps an id to a
   module the *client build* already trusts. A manifest cannot cause the
   client to load arbitrary code: unknown ids fail with
   `PortableCodeNotFoundError`.
2. **The expected build ID comes from the client deployment, never from the
   payload.** `decodeManifest` and `installClient` take `expectedBuildId` as
   an independent argument; a mismatched manifest is rejected
   (`ResumeClientBuildMismatchError`) before any code resolution.
3. **Captures are schema-validated on both sides.** Encoding happens through
   the authored schema plus a JSON-safety check (`jsonValueIssue`) at collect
   time; decoding re-validates through the loaded definition's schema at
   resolve time. Do not put secrets in captures — they are embedded in HTML.
4. **Payload ceilings are enforced on both sides.** Collection and decoding
   both reject manifests above `maxPayloadBytes` (default 64 KiB).
5. **The manifest script is inert JSON**, HTML-escaped via
   `Serialization.escapeJsonForHtml`, so it cannot break out of its
   `<script>` element.
6. **Duplicate installation is rejected.** One active client installation per
   root; installers own only their listeners and dispatch fibers.

## Deployment-version rules

- Every `Portable.code` carries the `buildId` of the deployment that produced
  it. Collection fails hard if any descriptor's build differs from the
  session's build.
- A client only resumes manifests whose build matches its own
  `expectedBuildId`. On mismatch (e.g. an old HTML page served after a
  deploy), the correct response is full hydration/activation fallback, not a
  best-effort resume.
- Code ids must be stable *within* a build and may change across builds; the
  build check is what makes id reuse safe.

## Choosing a level per component

| You need | Use |
| --- | --- |
| Ordinary SPA/SSR behavior | Nothing extra — hydration is the default |
| A button that works before any component JS loads | `Portable.code` + `Component.action` + `Resume.event` |
| A dormant interaction that must run the component's listener | `Resume.activationEvent` + `Resume.addressable` |
| Server-computed state without setup replay | `Component.state` + `Resume.snapshotState` |
| Server-fetched data shown instantly, refetch on demand | portable `Component.query` + `Resume.snapshotQuery` |
| Lazy full component mount on interaction | `Resume.addressable` |
| Reattachable listeners/widgets on restored DOM | `Behavior.portable` + `Behavior.attachScoped` |

Mixing levels in one component is expected. Anything not explicitly portable
falls back to activation with a diagnostic explaining why.

## Compiled authoring: the resume-extract transform

Manual `Portable.code` + `Portable.bind` is always available, but the
companion compiler removes the ceremony. Author with the `extract` marker:

```ts
import { extract } from "effect-atom-jsx/portable-extract"

const save = yield* Component.action(
  extract(
    (captures: { readonly label: string }) =>
      Effect.gen(function* () {
        const api = yield* SaveService
        yield* api.save(captures.label)
      }),
    {
      captures: Schema.Struct({ label: Schema.String }),
      bind: { label },   // evaluated here — may close over local scope
    },
  ),
)
```

and enable the Vite plugin:

```ts
// vite.config.ts
import { resumeExtract } from "effect-atom-jsx/compiler/resume-extract-vite"

export default defineConfig({
  plugins: [
    resumeExtract({
      buildId: BUILD_ID,
      root: import.meta.dirname,
      importPath: (entry) => `/${entry.moduleId}`,
      // Modules reachable only through the virtual entries module:
      sourceModules: ["/app/note-button.ts"],
    }),
  ],
})
```

The transform hoists each marker call into an exported `Portable.code(...)`
with a stable `moduleId#constName` identity (ordinal for unassigned calls),
stamps the build ID, and rewrites the call site to `Portable.bind(...)`. The
client consumes the generated resolver table directly:

```ts
import { resolverEntries } from "virtual:af-resume-entries"
Resume.installClient({ resolverEntries, ... })
```

Milestone 8a also recognizes an explicit text-only `expr(...)` marker:

```ts
import { expr } from "effect-atom-jsx/portable-extract"

const countText = expr(
  (_captures, [count]) => `Count: ${count}`,
  {
    captures: Schema.Struct({}),
    bind: {},
    dependencies: Schema.Tuple([Schema.Number]),
    // A restorable state handle resolves to its implicit binding key.
    deps: [bindings.count],
  },
)
```

The transform assigns `moduleId#expr$constName` code identity. During SSR,
direct `insert()` sites receive document-local `x<N>` instances, dependency
reads are verified, and supported text is enclosed by `af:expr` comments in
manifest v4's `text` target. The dependency codec stays with the portable code
module; values
reuse existing component snapshot wire records rather than adding an
expression-value DTO. Hierarchical key witnesses may add an optional
key-only `inputs` projection when their expanded trigger keys differ from
codec order. The active accessor reads state handles when the surrounding
reactive computation runs, so activation continues from current state rather
than a value captured when `expr(...)` was bound. Collection also decodes the
actual encoded snapshot through the expression dependency codec: matching
domain types are not enough when two codecs use different wire forms, and a
mismatch fails as `ResumeExpressionInputDecodeError` before HTML is published.

Internal `af:binding:` keys are installation-owned. Authored expressions must
pass a typed `Component.state` handle instead of spelling those keys directly;
this preserves component ownership and prevents cross-boundary snapshot reads.

`ClientInstallation.writeBinding(componentId, name, schema,
value)` is the typed adapter hook for changing a dormant state snapshot. The
schema infers the domain value type and performs the wire encoding; no cast is
needed:

```ts
yield* installation.writeBinding("c0", "count", Schema.Number, nextCount)
```

Framework adapters that already hold the exact encoded value may instead use
the explicit `writeBindingEncoded(...)` escape hatch. A successful write
updates the snapshot later used by restoration, coalesces same-turn expression
work, and lazily loads affected expression code. Once the owning boundary
starts resuming or activating, writes fail and restored expression ownership
is terminally released. Query handles are invalidation dependencies, not
expression value dependencies: their synchronous value is a `Result`, so a
query-derived text expression currently requires an explicit serializable
projection rather than pretending the query produces its success type.

Rules the compiler enforces (all as source-located compile errors):

- The extracted function and its `captures` schema must be **module-closed**
  — no references to enclosing function scope, `this`, `super`, or
  `arguments`. Pass values through `captures`/`bind` instead. The `bind`
  expression stays at the call site and may close over anything.
- Credential-looking capture names (`token`, `password`, `apiKey`, ...) are
  errors by default — captures are embedded in server HTML. Downgrade with
  `secretCaptureSeverity: "warning"` or override `secretNamePattern` for
  false positives.
- Bind expressions above an advisory source-length ceiling warn through
  `onDiagnostic` (and Vite `this.warn`) before the runtime manifest byte
  ceiling rejects the render.

Calling `extract` without the transform fails closed at runtime with
guidance. The `examples/resumable-extract` fixture plus its Chromium test is
the executed reference for this path.

## Custom wire representations

Every schema the resume system accepts is a full `Schema.Codec`, so domain
values can have a different plain-JSON wire representation without a
serializer plug-in. Built-in transformed codecs work directly:

```ts
Component.setup<{}>().bind(
  "quantity",
  () => Component.state(3),
  // Domain type: number. Wire type: string.
  { resume: Resume.snapshotState(Schema.NumberFromString) },
)
```

For custom mappings, use Effect 4's `Schema.decodeTo(...)` with
`SchemaGetter.transform(...)` or `SchemaGetter.transformOrFail(...)`.
Dates, maps, branded types, class instances, and discriminated unions can all
follow that pattern. The single hard rule is that the **encoded** side must be
plain JSON — a codec such as `Schema.Date` or `Schema.ReadonlyMap` validates a
runtime object but does not by itself define a JSON wire representation. The
wire check rejects functions, symbols, cycles, non-finite numbers, sparse
arrays, and accessor-backed properties after the codec runs.

To customize the **whole manifest** encoding (compression, envelopes,
signing), provide your own `Serialization.Tag` layer in place of
`Serialization.layer`; the output must remain an HTML-embeddable string and
is measured against the manifest byte ceiling. Exotic **behavior** never
gets a codec — it gets a code identity.

## The double-data problem

SSR frameworks classically send data twice: once rendered into the HTML, and
again as a JSON payload for hydration. Affe addresses this **by
construction** rather than by pruning:

- **Serialization is whitelist-only.** Nothing reaches the wire without an
  explicit, schema-backed declaration (`snapshotState`, `snapshotQuery`,
  `expr` captures, activation props). Static content, derived values, and
  opaque bindings have no serialization path at all — a dormant region
  ships **zero** backing data. Where pruning frameworks infer what to drop,
  here undeclared data cannot be sent.
- **Fine-grained expressions send recompute instructions, not values.** An
  `expr(...)` region''s current value lives *only* in the HTML; the manifest
  carries its code address, captures, and dependency keys. On invalidation
  the client recomputes rather than restores — for expressions, the
  double-data count is literally zero.
- **Queries serialize the settled value once, plus an address.** The
  executor is a code identity resolved lazily on refresh; the data renders
  from HTML and seeds reactivity from one schema-encoded value.
- **Behavior/action/event wiring is addresses only** — code identities and
  captures, never rendered-content duplicates.

What genuinely remains, and is measured rather than hidden:

- **Declared state seeds** duplicate their rendered projection (`count: 41`
  in the manifest, `"41"` in the HTML). This is the irreducible core for
  writable state — HTML holds a lossy projection, and seeds are required to
  resume reactivity exactly. Seeds are opt-in, schema-minimal, and bounded
  by the manifest byte ceiling; the resumability benchmark harness tracks
  payload size as a first-class metric.
- **Route loader data** currently flows through a separate script channel
  (`window.__LOADER_DATA__`) that does duplicate rendered content — this is
  scheduled to merge into the streaming resume manifest (Milestone 11 /
  router consolidation R6), after which route data follows the same
  whitelist rules as everything else.

One-line comparison: pruning frameworks make a smart serializer send less;
Affe makes serialization impossible without a declaration, sends addresses
instead of code, and sends recompute instructions instead of values where it
can.

## Diagnostics reference

Every diagnostic the protocol can hand an application, in one place. An operator
who meets one of these in production should be able to find it here — that is
the 8c.8 exit criterion, and `future/resumability/diagnostics.spec.ts` enforces
it by reading this file.

There are **two families**, and the distinction matters when you are debugging:

- **Collect diagnostics** are emitted on the **server**, during
  `Resume.collect(...)`. They mean *this thing could not be made resumable, so it
  was left out of the manifest.* The page still renders and still works; it just
  falls back to ordinary client behaviour for that piece. They are the contract
  that nothing opaque is silently serialized.
- **Client diagnostics** are emitted in the **browser**, during or after
  `Resume.installClient(...)`. They mean *something that was supposed to resume
  did not.* The runtime always fails toward a working page — falling back to
  activation, or leaving SSR content in place — rather than toward a broken one.

### Collect diagnostics (server, during `Resume.collect`)

| Code | Meaning | Usual cause |
| --- | --- | --- |
| `opaque-event-handler` | A handler could not be addressed, so the event is not resumable. | An inline closure instead of `Resume.event(...)` over portable code. |
| `opaque-query-executor` | A query's executor could not be addressed. | `Component.query(() => …)` with a plain thunk rather than `Portable.BoundCode`. |
| `unsupported-event-semantics` | The event shape is outside the supported contract. | Handlers taking arguments; only the zero-argument contract is portable. |
| `unsupported-query-semantics` | The query declares semantics the snapshot cannot express. | `retrySchedule` / `pollSchedule` — the query falls back to client-side execution. |
| `unsupported-expression-output` | An expression produced a value the target cannot represent. | A structural value where a scalar is required; or `null`/`undefined` on a **text** target, which has no representation for absence (see `DQ-002`). |
| `unsupported-expression-target` | The expression's target kind or name is not on the allowlist. | A fenced attribute (`href`, `onclick`), an unlisted style property, or a target kind with no patch strategy. Added by 8c.4; the served HTML omits the write entirely rather than emitting an unvalidated attribute. |
| `missing-component-boundary` | An expression's owning component was dropped from the manifest. | The owner itself failed to serialize, so the expression is removed with it. |
| `missing-expression-boundary` | An expression's SSR region could not be paired. | A text expression whose comment-pair region was not emitted. |
| `missing-snapshot-binding` | A declared state binding produced no snapshot. | The binding's codec rejected the value, so the component stays dormant-incapable. |
| `opaque-component-setup` | A component's setup could not be described for resumption. | Setup state without resume policies; the component activates instead of resuming. |
| `event-data-unsupported` | An event carries data the portable contract cannot express. | A handler expecting a payload outside the supported projections. |
| `invalid-event-type` | An event type failed validation. | An empty or malformed DOM event type string. |
| `marker-collision` | Two SSR events (or regions) produced the same marker id. | Duplicate ids across nested renders; the later entry is dropped rather than aliased. |
| `event-contract-missing` | An event was recorded without its declared contract metadata. | Framework-integration code bypassing `Resume.event(...)`. |
| `snapshot-handle-mismatch` | A binding's resume policy disagrees with the handle it was given. | A state policy on a query handle, or vice versa. |
| `snapshot-inspection-failure` | Reading a handle's inspection metadata threw. | A custom handle whose inspection accessor fails. |
| `snapshot-read-failure` | Reading a binding's current value for the snapshot threw. | A getter that throws during SSR teardown. |
| `duplicate-snapshot-binding` | Two bindings in one component claim the same snapshot name. | Name reuse across `bind(...)` calls; the later one is dropped. |
| `event-inspection-failure` | Inspecting a handler for portability threw. | An exotic handler object whose properties throw on access. |
| `undeclared-expression-dependency` | An expression read a reactive source it did not declare. | A `deps` list narrower than what the render actually reads. |
| `reserved-expression-dependency` | An expression declared a dependency in the reserved `af:` namespace it does not own. | Hand-written keys colliding with framework identity (`DIN-2`). |
| `expression-dependency-ownership` | An expression depends on a binding owned by a different component. | Cross-component dependency without an addressable owner. |
| `unresolved-expression-dependency` | A declared dependency could not be mapped to a manifest identity. | A dependency on a handle that is not itself snapshot-addressable. |
| `unsettled-query-snapshot` | A query was still in flight when its snapshot was taken. | Collect ran before the query settled; the query re-executes client-side. |
| `async-setup-timeout` | An async component setup exceeded the collect deadline. | A slow or hung Effect in setup; the component is left activation-only (M11.2). |

### Client diagnostics (browser, during/after `Resume.installClient`)

| Code | Meaning | Usual cause |
| --- | --- | --- |
| `unknown-event-marker` | A DOM marker names an event the manifest does not contain. | Stale HTML against a newer manifest, or a tampered marker. Fails closed. |
| `event-type-mismatch` | A marker's event type disagrees with the manifest entry. | Build skew, or tampering. |
| `dispatch-resolution-failure` | The portable code for an event could not be loaded. | A missing or failed resolver entry; the chunk 404s or throws on import. |
| `dispatch-execution-failure` | The loaded code ran and failed. | An application-level error inside the action itself. |
| `event-handoff-failure` | An interaction could not be handed to its claiming owner. | The closest marker's boundary was disposed or failed mid-claim. |
| `component-resumption-fallback` | Restoration failed, so the component was activated instead. | A snapshot that no longer decodes, or a failure inside the render callback — the region is rolled back to SSR content first, then mounted exactly once. |
| `component-transition-mode-conflict` | An `activate()` joined an in-flight `resume()` (or vice versa) with a different mode. | Two callers racing one boundary. First-wins holds; the losing mode is reported rather than silently discarded. |
| `component-query-refresh-failure` | A restored query's refresh failed. | The executor chunk failed to load, or the query itself errored. |
| `expression-resolution-failure` | An expression's portable code could not be loaded. | Same causes as `dispatch-resolution-failure`, on the expression path. |
| `expression-execution-failure` | An expression ran and failed, or produced an undecodable value. | An application error, or an encoded value the codec rejects. The last good DOM is kept and the next valid write recovers. |
| `expression-patch-failure` | The value was computed but could not be written to the DOM. | The target element was removed, or ownership was lost between computation and write. |
| `client-runtime-failure` | An unclassified failure inside the resume runtime. | Should be rare; treat an occurrence as a bug report rather than an expected condition. |
| `stream-truncated` | A streaming install's record stream ended before its terminal record. | The connection dropped mid-stream; regions already installed keep working, missing ones fall back. |
| `fragment-build-mismatch` | An out-of-band fragment was built by a different deployment than the page. | A deploy landed between page load and fragment fetch. The fragment is refused, the page untouched. |

Failure diagnostics also carry an optional **`errorTag`** field: the `_tag` of
the typed error behind the failure, when one is recoverable from the cause.
`reason` stays the human-readable rendering; `errorTag` is the
machine-readable classification an adapter can switch on. The ones worth
alerting on:

| `errorTag` | Meaning |
| --- | --- |
| `PortableCodeNotFoundError` | Unknown code identity — no resolver entry for the manifest's code id. |
| `PortableCodeLoadError` | The resolver entry exists but its chunk failed to load. |
| `PortableCodeIdentityMismatchError` | The loaded module exported code with a different identity. |
| `PortableBuildMismatchError` | The loaded code was built by a different deployment. |
| `PortableCaptureDecodeError` | Captures could not be decoded — typically the client runtime is missing the serialization codec layer the server used (permissive mode requires the codec on both sides). |
