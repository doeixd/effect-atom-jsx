# The permissive package (`@affe/permissive`) — milestone plan

Status: planned 2026-08-12. S0 done (binding-level oversized-payload
attribution: `largestBindingName`). S1 done (`Resume.spiVersion`, the
`effect-atom-jsx/adapter-spi` subpath with a pinned member list;
`adapter-spi.spec.ts` went 6/6 and was promoted to
`src/__tests__/adapter-spi.test.ts`, emptying `future/resumability/`).
S2 done (npm workspaces; `packages/permissive` with its own
tsconfig/vitest wired into root scripts — root `npm test` runs both suites;
the core resolves via `"effect-atom-jsx": "file:../.."` because a bare `*`
made npm fetch the published registry copy instead of linking the repo
root; `spi-consumer.test.ts` enforces public-subpath-only imports against
the core's live `exports` map and pins the fail-closed
`SpiVersionMismatchError`). S3 done (`permissive({buildId, vite?})` →
`{vitePlugins, serverLayer, clientLayer, spiVersion}`; both layers are
deliberately the SAME `serovalAsyncLayer` — the DQ-012 serializer stamp
makes split codecs a fail-closed footgun, and async is the default because
Promise captures are the point of permissive mode; `assertSpiCompatible()`
runs at construction; reference codec ids/layers re-exported).
S4 done (`Serialization.SerovalOptions.stateHandles?: StateHandleResolver`
with `keyOf`/`resolve` and fall-back-to-reference-registry semantics —
unknown keys still fail closed; `@affe/permissive` ships
`createHandleRegistry()` and `permissive({stateHandles})`; keys are
deliberately opaque to the codec because handles carry no intrinsic
cross-process identity — the app registering the same stable keys on both
sides IS the mechanism). S5 done (`examples/permissive-demo` + `browser-tests/permissive-demo.spec.ts`,
Chromium 11th test: zero setup/view/loader on load, first click lazy-loads
the handler and the inferred Map capture arrives live, serializer stamp is
`af.seroval-async-json.v1`, dispose clean. The build surfaced the package's
missing client boundary — importing `permissive()` from client code pulled
babel into a 1.3 MB chunk — fixed by the new `@affe/permissive/client`
entry (`permissiveClient()`), with chunk-size pins in the spec).
Next: S6 (acceptance sweep).

Ratified basis: TRIAGE-2026-08-12.md item 6 (build it as the next major
milestone), `DQ-011` (the M9 adapter SPI is **blocked on** this package —
publishing an SPI before an external consumer has exercised it freezes the
wrong surface), `DQ-096` (this package family is the home of the MCP adapter;
no `src/agent-mcp.ts`). Owning upstream sections:
`RESUMABILITY_IMPLEMENTATION_PLAN.md` M10 item 4 + M9 item 2, and
`AGENT_NATIVE_NOTES.md` §6 (library boundary).

## What this package is

Qwik-parity as a **configuration, not a fork**: auto-capture + the universal
codec + the reference plugins bundled so an app opts into inferred captures
and rich values with one preset — while doubling as the external-style SPI
consumer M9 requires. It must build against **public `@affe/*` API only**;
that constraint IS the SPI test.

## Premise inventory (verified against code, 2026-08-12)

Exists in core, ready to consume:

- `extract.auto` / `expr.auto` transform with `inferredCaptures` reporting,
  secret-name and `this` rejection (`compiler/resume-extract-plugin.ts`,
  pinned by `auto-capture.test.ts`).
- `Serialization.serovalLayer` / `serovalAsyncLayer` / `serovalUnsafeEval`
  with `DQ-012` identity gating; lazy seroval (strict-mode bundles ship none).
- Reference plugins (state handles by hydration key, `BoundCode` descriptor,
  `SafeHtml` branding, live-resource guard) — with the **known gap** that the
  state-handle registry is process-local (`serialization-seroval.ts`:
  "cross-process restore resolves the key against the client hydration
  registry once M10 item 4's adapter wires it").
- The `$afCapturesCodec` capture envelope in `Portable.describe`/`resolve`,
  and the pinned operational rule: **client runtimes must include the codec
  layer** for envelope captures (`universal-serialization.test.ts`).
- Wire-stability fixtures v1–v4 install, CSP-safe embedding, encoded-write
  validation (`adapter-spi.spec.ts`, 3 of 6 green).

Missing / red (verified by running `adapter-spi.spec.ts`):

- `Resume.spiVersion` (runtime-readable, ratified by `DQ-011`) — red.
- A published SPI surface (subpath + frozen member list) — red, explicitly
  "blocked on M10 item 4", i.e. on this plan.
- A pre-existing core bug: `ResumePayloadTooLargeError` does not attribute
  an oversized payload to its largest **component binding**
  (`largestEntryId`/`largestEntryBytes` undefined for component-dominated
  manifests) — red, independent of the package.

## Provisional decisions (declare-then-build; none are DQ-blocking)

- **P1 — workspace layout:** npm workspaces; the package lives at
  `packages/permissive`, package name `@affe/permissive` as the working name.
  The publishable scope is NOT settled (core is `effect-atom-jsx`, unscoped);
  recorded as a naming question to revisit at first publish, not before.
- **P2 — SPI surface shape:** a dedicated `effect-atom-jsx/adapter-spi`
  subpath module re-exporting the frozen member list, plus
  `Resume.spiVersion` (the spec's premise names `Resume.{spiVersion}`).
  The member list starts from what `adapter-spi.spec.ts` already exercises:
  manifest schemas + decode, install, encoded binding writes, event/binding
  snapshot schemas, the error union, `spiVersion`.
- **P3 — the preset's shape:** `permissive()` returns the pieces an app
  wires, not magic: `{ vitePlugins, serverLayer, clientLayer, spiVersion }`
  — extract.auto-enabled compiler plugin config, `serovalLayer` for the
  server, and the client layer that merges the codec (the pinned
  requirement) with a `spiVersion` fail-closed check at construction.
- **P4 — store-proxy layer:** deferred, per the ratified scope ("v1: what
  exists today").

## Work breakdown

- **S0 — fix the attribution bug** (core, independent): make
  `largestManifestEntry` weigh component bindings, un-gating the first
  `adapter-spi` red. Small; do first so the SPI slice inherits a 4/6 file.
- **S1 — SPI surface + `spiVersion`**: `Resume.spiVersion` +
  `src/adapter-spi.ts` subpath with the frozen member list and a surface
  test (member-list snapshot, like `package.test.ts`). Un-gates the last two
  `adapter-spi` reds → promote the file; M9 item 2's "commit to a
  runtime-readable spiVersion" lands.
- **S2 — workspace scaffold**: npm workspaces, `packages/permissive` with
  its own tsconfig/vitest wired into root scripts; the package imports ONLY
  public subpaths (enforced by a lint/test that greps its sources for
  `src/` deep imports).
- **S3 — the preset**: `permissive()` per P3, including the
  `spiVersion` check (mismatched core fails layer construction with a typed
  error) and re-exports for the reference plugins.
- **S4 — cross-process state-handle restore**: replace the process-local
  hydration-key registry with a pluggable resolver (default: current
  registry; permissive client layer wires the hydration registry), closing
  the noted M10 item-4 gap.
- **S5 — Chromium Qwik-parity demo**: an example app using one-liner
  `extract.auto` handlers with a Map capture; Playwright proof that it
  resumes with component counters at zero (M10 acceptance).
- **S6 — acceptance sweep**: strict-mode byte-unaffected proof (default
  build contains no seroval chunk unless the layer is referenced), docs
  (API.md section, plan status updates, M9 item 2 wording), and the
  `adapter-spi` promotion if not already done in S1.

Each slice ships with the standing gates (typecheck, full unit suite, build;
Chromium where the slice touches served output) and sabotage-verified tests.

## Non-goals (v1)

Store-proxy dependency graphs; publishing to a registry; the MCP adapter
itself (that is the `@affe/agent` package, AN-3 — this milestone only
establishes the workspace pattern it will reuse); any `future/agent/*`
implementation.
