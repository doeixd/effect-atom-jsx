# Milestone 8c — Measurement and Non-Text Expression Widening

Status: **COMPLETE (2026-07-30).** All slices 8c.0–8c.8 have landed. The v4
schema, scanner, fences, compiler directive seam, SSR registration seam, client
attribute/class/style patch strategies, hardening, the Chromium proof, the
post-widening measurement, and the diagnostics documentation are all done.

914 source tests and 7/7 Chromium tests pass; `future/resumability` is **33/39**,
with the remaining six being three M9 SPI specs and three M8d structural-target
specs, both correctly deferred.

**8c.7 returned GO**, so **M8d (structural expression targets) is unblocked**
whenever it is scheduled.

## Goal

Prove whether fine-grained resumability is paying for itself, then extend the
working text-expression protocol to a deliberately small set of attribute,
class, and style-property expressions without weakening its ownership,
portability, type-safety, or fail-closed guarantees.

Milestone 8c is two ordered workstreams:

1. **8c.1 — measure the existing text slice against an honest eager-client
   baseline;**
2. **8c.2 — widen the same protocol to non-text targets only after the
   measurement harness and compiler seam are sound.**

Measurement comes first because widening before measuring would make it
impossible to tell whether the basic M8 bet was good or whether extra surface
area merely hid a weak result.

## Domain Terms

- **Text target** — the existing durable comment-pair expression region.
- **Element target** — an SSR element carrying a temporary, validated marker
  that identifies one or more non-text expression instances.
- **Patch strategy** — the target-specific DOM operation applied after an
  expression evaluates: text, ordinary attribute, class string, or one style
  property.
- **Cold interaction** — the first invalidation while the expression module is
  still unloaded.
- **Warm update** — an invalidation after that module has been resolved and
  memoized.
- **Eager baseline** — the same fixture and data rendered through normal client
  activation at startup. Do not call this hydration unless an early probe
  proves the runtime is attaching to SSR DOM rather than rerendering it.

## Decisions and Rationale

1. **Measure before widening.** The design assumes a small number of declared
   expressions captures most perceived-liveness value. That assumption must be
   falsifiable.
2. **Keep semantic reactivity keys as the only serialized dependency
   identity.** Signal and owner identity remain process-local implementation
   details.
3. **Use the existing branded expression as the sole code identity.** A
   non-text helper must not receive a second authored/compiler id; duplicated
   identities can drift.
4. **Add a discriminated patch target to a new manifest version.** Do not
   overload the v3 comment-pair record with ambiguous optional fields. Older
   manifests remain decodable.
5. **Use an element marker only for installation-time lookup.** After the
   marker/manifest bijection and ownership are validated, retain the direct
   element reference and remove the marker. This reduces dormant DOM noise
   without trusting traversal order.
6. **Lower contextual `expr(...)` uses through a compiler-generated directive
   seam before the general JSX transform.** The JSX compiler currently groups
   attributes into implementation-specific effects and emits direct style
   writes. A pre-JSX directive preserves the authored expression and gives the
   runtime the element plus target metadata without post-processing brittle
   generated code.
7. **Share ordinary and resumed mutation semantics.** Attribute, class, and
   style-property patches must call the same runtime helpers. Parallel DOM
   mutation logic would eventually disagree on null removal, coercion, SVG,
   or style behavior.
8. **Keep lists and structural replacement fenced.** Keyed reconciliation is
   valuable, but it is not required for non-text element targets and should
   not silently expand 8c into a renderer rewrite.
9. **Let `target.kind: "text"` imply the durable comment-pair representation.**
   An earlier v4 draft nested a redundant
   `region: { kind: "comment-pair" }` object under every text target. The
   density benchmark caught the extra retained-object slope above the 110%
   gate. Flattening the record restored the expected slope while remaining
   unambiguous: a different text-region representation requires a new target
   kind or manifest version, not another always-identical object.

## Assumptions to Verify First

- Confirmed: the fair current comparator is eager boundary activation/full
  client rerender, not true DOM hydration. The pinned compiler uses
  `hydratable: false`, and Chromium proves `hydrateRoot(...)` replaces the SSR
  host node while setup and view each run once.
- A generated JSX directive can coexist with authored refs, directives,
  spreads, and multiple resumable properties on one host element.
- Confirmed for the 8c.0 matrix: the JSX runtime executes the pinned compiler's
  attribute, class, style, ref, directive, spread, SVG, boolean-attribute, and
  property output without casts in authored code.
- Confirmed on the pinned Chromium 151 / Windows x64 environment: CDP heap
  measurement after explicit garbage collection is stable enough for
  calibrated fixed-cost and relative-slope budgets. Deterministic
  allocation/controller counts remain environment-independent hard assertions.
- Existing text-node reuse and boundary-controller disposal are sufficient for
  non-text ownership handoff; no new lifecycle state is needed.

If any of these probes fails, stop that workstream and revise the design before
building the wire/runtime surface.

## 8c.0 Result

The baseline/ABI slice closed the following ordinary-runtime gaps before any
resumable target protocol depended on them:

- exported the compiler-required `setAttribute`, `setAttributeNS`,
  `setBoolAttribute`, `setProperty`, `className`, and `use` helpers;
- made class-list and style helpers null-safe and state-returning so compiler
  effects can diff removals correctly;
- made function-valued `mergeProps(...)` sources retain reactive values and
  changing key sets with intersection inference across heterogeneous sources;
- made spreads reactive for object/proxy sources, remove stale attributes,
  styles, classes, and listeners, and preserve one diff state per property;
- added the `firstChild`/`lastChild` traversal ABI required by nested compiled
  templates in the server virtual DOM;
- widened the low-level compiler-facing `insert(...)` input to the renderer's
  actual `unknown` view boundary, eliminating an end-user cast from composed
  component output;
- added compile-and-execute, runtime diff, compile-time inference, and Chromium
  node-identity coverage.

This evidence resolves the benchmark vocabulary: 8c.1 compares dormant text
resumption with **eager rerender**, not hydration.

## Invariants

- No expression module loads during installation or merely because a page has
  dormant expressions.
- No component setup or view runs to rediscover a non-text dependency.
- The manifest carries addresses, target metadata, and schema-validated data;
  never closures, native nodes, signals, owners, scopes, or executable source.
- Every manifest/DOM target has a validated one-to-one instance identity and a
  validated closest component owner.
- A boundary has only one expression owner at a time. Resumption or activation
  disposes dormant subscribers before component setup, mounting, or listener
  commit.
- Work that began while dormant must recheck ownership after every effectful
  boundary before patching.
- Disposal is terminal and idempotent; queued, resolving, and executing work
  cannot patch afterward.
- Expression code, capture, dependency, output, typed error, and Effect service
  axes remain inferred. Authored code needs no casts or explicit callback tuple
  annotations.
- Unsupported targets fail at compile time when statically knowable and with a
  named collection/install diagnostic otherwise.
- Manifest v1–v3 decoding and text-installation behavior remains supported;
  new expression collections use manifest v4.
- Retry/poll schedule state remains unsupported.

## Definition of Done

Milestone 8c is complete when:

1. A repeatable Chromium harness measures raw and compressed payload size,
   cold interaction latency, warm update latency, and retained memory for both
   resumable and eager modes.
2. Measurements cover a minimal fixture and a realistic-density fixture with
   10–30 live expressions, and store machine-readable results plus methodology.
3. The baseline explicitly says whether it is hydration or eager rerender and
   proves that claim with setup/view/DOM-reuse counters.
4. Ordinary compiled JSX attribute, class, style, ref, and directive behavior
   has compile-and-execute ABI coverage.
5. The same authored `expr(...)` marker works, with inference and no casts, in
   text, supported ordinary-attribute, class-string, and individual
   style-property positions.
6. SSR emits correct initial values and validated element markers; client
   installation loads no expression code.
7. First invalidation loads only the required memoized chunk and patches only
   its target. Later invalidations use the warm path.
8. Activation/resumption handoff, stale async completion, missing/duplicate
   markers, wrong ownership, invalid output, and disposal are race-tested.
9. Chromium proves a page containing text, attribute, class, and style
   expressions remains dormant, patches each target correctly, later activates
   exactly once, and releases every subscriber/resource exactly once.
10. Calibrated performance budgets are written down after the baseline run.
    M8c must not be declared complete with placeholder thresholds.
11. All existing typecheck, unit, build, package, and Chromium gates remain
    green.

## Milestones

### 8c.0 — Lock the Baseline and Ordinary JSX ABI

Status: complete

- Add compile snapshots for dynamic ordinary attributes, class strings, whole
  style values, individual style properties, refs, directives, spreads, SVG,
  boolean attributes, and DOM properties.
- Add execution tests for the emitted helpers, not only string-presence tests.
- Close missing runtime exports or semantic mismatches before resumability uses
  those helpers.
- Build a tiny eager-client fixture and prove whether it reuses or replaces SSR
  nodes. Name the comparator from that evidence.
- Confirm that text updates retain their existing text node.

Exit: the ordinary compiler/runtime contract is executable and the comparator
is no longer ambiguous.

### 8c.1 — Build the Measurement Harness

Status: complete, including retention attribution and gate calibration

- Add two equivalent modes over the same UI/data:
  - eager startup activation;
  - dormant text-expression resumption.
- Add a minimal fixture and a realistic-density fixture, initially 24
  expressions with shared and independent dependency keys.
- Record:
  - UTF-8 manifest bytes;
  - HTML marker bytes;
  - combined raw and gzip payload bytes;
  - chunks requested and transferred before/at first interaction;
  - navigation-to-ready and interaction-to-patch timings;
  - warm update median and p95 over repeated writes;
  - subscriber/controller counts before use and after disposal;
  - retained JS heap after forced GC when available.
- Separate cold module resolution from warm expression execution in marks.
- Disable cache for cold runs and use a warmed module for warm runs.
- Store results as machine-readable artifacts with build id, browser version,
  fixture density, run count, and measurement mode.
- Make structural invariants hard failures. Keep wall-clock thresholds
  report-only until a baseline is calibrated.

Checkpoint: review the evidence before widening. If retained memory is not
lower at realistic density, payload growth is superlinear, or authoring cost is
clearly dominant, fix the text protocol first.

#### Baseline and retention evidence (2026-07-29)

The checked-in Chromium 151 / Windows x64 v2 baseline contains five
cache-disabled cold runs and 30 warm writes per applicable dependency kind:
`../benchmarks/resumability/results/baseline-windows-chromium.json`.
The method and deterministic verifier live in
`../benchmarks/resumability/README.md`.

- Dormant installation requested no application/expression chunk. The first
  shared write requested exactly one 4,409-byte transferred chunk, invoked one
  loader, left setup/view at zero, and patched all 12 shared subscribers in the
  realistic fixture. Warm writes requested no JavaScript.
- The refreshed v4 24-expression resumability payload was 8,186 raw bytes /
  766 gzip bytes (7,102 manifest + 1,084 markers). The one-expression payload
  was 511 raw / 303 gzip bytes. Growth stayed inside the linear structural
  envelope.
- Realistic dormant cold interaction-to-patch was 10.8 ms median / 11.5 ms
  p95, of which module resolution was 9.0 / 9.8 ms. Warm shared fan-out was
  0.3 / 0.6 ms; warm independent writes were 0.1 / 0.2 ms. These remain
  report-only observations, not calibrated budgets.
- All boundary/expression controllers, dependency-key subscriptions, pending
  fibers, and component resources returned to zero after disposal. No
  diagnostics, setup/view rediscovery, duplicate loads, or warm network
  requests occurred.
- The original forced-GC checkpoint was 2,487,560 bytes dormant versus
  2,264,684 bytes eager, a 222,876-byte (9.8%) gap.
- The v2 harness adds a runtime-aligned eager comparator and an 11-stage
  retained-heap matrix at densities 0, 1, and 24. A `ManagedRuntime` accounts
  for only 3,856 bytes in isolation and 3,468 bytes in the aligned density-24
  comparator. Schema/manifest decode and fixed boundary installation dominate;
  resolver state is about 15 KB and expression bookkeeping is not the dominant
  term.
- A decoded manifest is deeply immutable and remembered by private object
  identity. Scans, restoration, and installation reuse that proof instead of
  reconstructing the complete schema value repeatedly. Manually supplied
  manifests still validate in full. The refreshed v4 checkpoint retains
  2,507,440 bytes dormant versus 2,324,228 bytes eager: a 183,212-byte (7.9%)
  fixed gap that remains inside the calibrated 200 KB ceiling.
- From density 1 to 24, dormant heap grew by 99,156 bytes (about 4,311 bytes
  per added expression), versus 92,644 bytes (about 4,028 bytes per expression)
  for eager rerender. The 1.0703 ratio remains inside the 1.10 slope ceiling.
- After the project-wide Effect runtime upgrade, ordinary
  `JSHeapUsedSize` crossed a V8 baseline/JIT compilation threshold only on the
  density-24 manifest/scan path. Comparative heap snapshots attributed about
  30 KB of the apparent slope regression to generated
  `InstructionStream`/code nodes; an interpreter-only control measured a 0.69
  dormant/eager retained-object slope. The harness now keeps ordinary Chromium
  authoritative for timing/network/lifecycle and uses a separate
  `--jitless`, forced-GC lane for heap gates. Thresholds remain unchanged.
- Browser scanning uses `TreeWalker`; the renderer-neutral `childNodes`
  fallback remains for tests/adapters without a complete DOM. This avoids
  materializing live `NodeList` wrappers that Chromium retains with every
  visited node.
- A type-side `Schema.is` control saved only 6–13 KB versus schema decode and
  is not a correct replacement: it bypasses injectable serialization
  transformations and structured decode errors.

Decision: close the retention review and proceed to 8c.2. The original
“dormant must be absolutely lower at density 24” gate conflated fixed protocol
cost with expression scaling in a deliberately tiny application chunk. Keep
the unfavorable absolute result visible, but calibrate the text checkpoint on
both axes: the pinned density-24 fixed gap must remain at or below 200 KB, and
the density-1-to-24 dormant heap slope must remain no worse than 110% of eager.
No-load, exact-once, disposal, and linear-payload invariants remain hard gates.

### 8c.2 — Ratify the Non-Text Target Protocol

Status: complete (2026-07-30) — wire format, scanner, fences, and the client
attribute/class/style patch strategies all landed.

- Introduce a new manifest version whose expression entry has a discriminated
  target: text region, ordinary attribute, class string, or style property.
- Preserve the existing descriptor, dependency keys, optional input ordering,
  and component ownership fields.
- Define a schema-validated element marker carrying expression instance tokens.
  Multiple expressions may target one element.
- Scan all targets in one DOM pass, validate identity/uniqueness/ownership
  before subscriber allocation, then remove installation-only markers.
- Add target-name schemas and a conservative first-slice allowlist. Reject
  event attributes, HTML injection sinks, dynamic attribute names, namespace
  ambiguity, DOM properties, whole style objects, class-list objects, spreads,
  and URL-bearing attributes until each has an explicit semantic/security
  contract.
- Construct a target-specific patch strategy once during installation instead
  of re-discovering target kind on every invalidation.

Implemented protocol foundation:

- manifest v4 stores a discriminated `target` for text, ordinary attribute,
  class string, or one style property; v3 text entries remain decodable and
  installable;
- `target: { kind: "text" }` implies the existing durable comment pair; the
  flat shape avoids a redundant per-expression region object and remains
  guarded by the calibrated heap-slope benchmark;
- new text collections emit v4 without changing their durable comment markers
  or dependency records;
- `data-af-expr="x0 x1"` is the installation-only element marker: it carries
  document-local instance IDs only, while kind/name metadata stays in the
  schema-validated manifest;
- `scanExpressionTargets(...)` discovers comment and element targets in one
  expression traversal, validates the complete bijection and closest component
  owner, and removes element markers only after success;
- the first allowlist accepts `title`, selected `aria-*`/`data-*` attributes,
  safe visual style properties, and custom properties. Events, URLs,
  properties, HTML sinks, `cssText`, and URL-capable style properties remain
  fenced;
- malformed, missing, duplicate, unknown, wrong-kind, wrong-owner, and unsafe
  target metadata have named typed failures. `installClient(...)` currently
  rejects schema-valid non-text targets explicitly rather than silently
  installing incomplete behavior;
- the foundation hardening pass locks inference to the authored codecs, reads
  active state dependencies inside the reactive accessor, and validates the
  exact encoded snapshot against the expression dependency codec during
  collection. Authored keys cannot impersonate the reserved `af:binding:`
  namespace, and typed handles cannot cross component ownership boundaries;
- compiler extraction preserves same-statement initialization order, frozen
  stateful regular expressions are deterministic, duplicate identities fail
  closed, and Vite hot updates remove resolver entries when their final marker
  disappears. Manual manifest objects must satisfy the same plain-JSON graph
  contract as serialized manifests before validation can be memoized.

Exit: protocol schemas, backwards compatibility, scanner behavior, diagnostics,
and size attribution are fully tested before compiler lowering uses them.

### 8c.3 — Establish the Compiler Directive Seam

Status: complete (2026-07-30). See the `DQ-003` correction below — the ratified
`use:` form proved unemittable and the seam is `ref`.

- Teach the extraction transform to recognize `expr(...)` by JSX context.
- Keep text lowering unchanged.
- For supported non-text contexts, generate one internal directive attachment
  per host element containing the already-bound branded expressions and their
  literal target metadata.
- Do not fork or patch the third-party JSX compiler and do not post-process its
  private temporary-variable layout.
- Prove coexistence with authored refs/directives, ordinary reactive
  attributes, static attributes, spreads, and multiple resumable targets.
- Emit source-located compile errors for unsupported target kinds, computed
  names, events, properties, object-style/class-list forms, and structural
  contexts.
- Add transform snapshots, Vite aggregation tests, first-build virtual-entry
  tests, HMR invalidation tests, and compile-time inference tests.

**Ratified 2026-07-30 — the directive ABI (closes `DQ-003`).** One
`use:`-style directive attachment **per host element**, taking an array of
`[boundExpression, target]` pairs, where `target` is the discriminated v4 target
value:

```ts
use(el, resumeExprDirective, [
  [expr0, { kind: "attribute", name: "title" }],
  [expr1, { kind: "style-property", name: "--x" }],
])
```

Rejected alternatives and why:

- *One direct runtime call per expression.* Would force the runtime to group
  calls itself in order to emit a single `data-af-expr` marker, and costs N
  statements per element. Per-element grouping matches what the manifest already
  assumes — the v4 marker lists several instance ids (`data-af-expr="x0 x1"`) —
  so grouping at the directive makes the generated code and the wire agree by
  construction.
- *A synthetic attribute the JSX runtime parses.* **Violates a ratified 8c.2
  rule**: kind/name metadata stays in the schema-validated manifest, never in the
  HTML, which carries opaque instance ids only. It also re-derives structured
  data from strings for no benefit.

Chosen because it rides an ABI the 8c.0 audit already exercised (authored refs,
directives and spreads were proven to coexist), so the coexistence proof this
slice requires is an extension of existing evidence rather than new ground.

**CORRECTED 2026-07-30 — the `use:` form is not emittable; the seam is `ref`.**
Implementing the directive proved the ratified shape above impossible, and the
spec's own arithmetic is the proof.

`use:NAME` in `babel-plugin-jsx-dom-expressions` compiles to `_$use(NAME, el, …)`
and requires `NAME` as a **bare identifier in author scope**. That forces a
module-level `import { resumeExprDirective }`, which (a) injects a bare binding
that can collide with an authored one and cannot be uid-aliased without losing
the ABI name, and (b) makes the token appear once **per module** in addition to
once per element — so the ratified assertion *"one element with two targets ⇒
exactly one attachment; two elements ⇒ two"* can never hold, because
`import + N usages ≠ N`.

The corrected seam, keeping every property the original decision wanted:

- The token is **namespace-qualified**: `_afExprDirectives.resumeExprDirective`,
  from a generated `import * as _afExprDirectives from "effect-atom-jsx/dom"`
  (module configurable, `directiveModule`, default `effect-atom-jsx/dom`).
- The host element arrives through **`ref`** — the only channel that hands the
  plugin the element *before* the JSX transform — with any authored callback ref
  composed after:

```js
ref={_afExprHost => {
  _afExprDirectives.resumeExprDirective(_afExprHost, [
    [_afBindExpression(_afExpr$anon, { label }, ["k0"]), { kind: "attribute", name: "title" }],
    [_afBindExpression(_afExpr$anon2, { label }, ["k1"]), { kind: "class" }],
  ]);
  const _afAuthoredRef = authoredRef;
  if (typeof _afAuthoredRef === "function") _afAuthoredRef(_afExprHost);
}}
```

**Runtime consequence:** `resumeExprDirective(element, pairs)` is called
**eagerly with the element and a plain array**. It is *not* a dom-expressions
directive receiving an accessor. Per-element grouping — the property that made
the generated code and the v4 marker agree by construction — is preserved.

Two further facts this surfaced:

- The compiler's attribute and style-property allowlists **deliberately duplicate**
  the ones in `src/Resume.ts`, as a build-time check. They must be changed
  together or the two will disagree silently.
- **Custom style properties are allowlisted by the schema but unauthorable in
  JSX**: `style:--progress` is a JSX parse error, because JSX identifiers cannot
  begin with `-`. They remain reachable only through `dom.exprStyleProperty`
  directly, which must therefore accept a name the compiler can never emit.

Exit: generated code uses only the public runtime ABI and no target identity is
authored or duplicated.

### 8c.4 — Ordinary Attribute Vertical Slice

Status: complete (2026-07-30).

- Add the compiler-facing attribute-expression helper.
- During SSR, evaluate once, apply the normal attribute helper, register the
  expression target, and attach the element marker.
- During ordinary active rendering, install the normal reactive computation.
- During dormant installation, retain only the lightweight subscriber and
  element patch strategy.
- Match existing stringification and null/undefined removal semantics exactly.
- Cover same-value writes, multiple dependencies, shared code identities,
  loader failure/retry, stale completions, node removal, and disposal.

**Ratified 2026-07-30 — the SSR registration seam (closes `DQ-004`).** Two
layers, designed jointly with `DQ-003`:

1. Three thin **compiler-facing** helpers in `dom.ts` — `exprAttribute`,
   `exprClass`, `exprStyleProperty` — so generated code names its target kind and
   an unsupported kind is a **missing symbol at compile time** rather than a
   runtime string check.
2. Each delegates to **one** registrar,
   `observeRenderedExpressionTarget(element, expressionId, target)`, in
   `resume-session.ts`, which owns marker accumulation and target validation.

Each helper calls the **ordinary** attribute/class/style helper internally and
then registers. This satisfies Decision 7 (*share ordinary and resumed mutation
semantics*) **structurally**: the ordinary mutation call sits inside the
resumable one, so there is no second mutation implementation that can drift on
removal or coercion — which is the exact failure Decision 7 exists to prevent.

A single registrar is load-bearing, not stylistic: it is what makes two
expressions on one element produce **one** `data-af-expr` marker rather than two,
and it keeps discriminated-union validation in exactly one place, matching the
three existing observers in `resume-session.ts`.

Rejected: folding registration into the directive itself, which would put SSR and
client behaviour in one function branching on `_ssrMode` and make it hard to test
without a document.

Exit: a dormant attribute changes without setup/view execution and activation
cannot double-own it.

### 8c.5 — Class and Style-Property Widening

Status: complete (2026-07-30) — shipped with 8c.4 rather than after it: the
registrar is kind-agnostic and the ordinary helpers already existed, so fencing
class/style off would have cost more code than including them.

- Add class-string support using the ordinary class helper.
- Add one-style-property support using a shared style-property helper.
- Define and test null/undefined removal, number/string coercion, custom
  properties, hyphenated names, and repeated writes.
  - **Ratified 2026-07-30 — `ExpressionOutput` widens (closes `DQ-002`).**
    Found blocked while writing `future/resumability/` specs: the type was
    `string | number`, so *absence was not expressible* and this bullet was
    unauthorable. Decision:

    ```ts
    export type ExpressionOutput = string | number | null | undefined;
    ```

    `null` and `undefined` both mean **remove**. On the wire, absence is encoded
    by **omitting the output field**, and a missing field decodes to `undefined`
    — so `null` never appears on the wire at all, one authored concept has one
    wire form, and the byte cost of removal is negative. The manifest's initial
    value and a patched value must use this same representation, or SSR and the
    client disagree about what "absent" looks like.

    Do this **before** 8c.4 ships: it widens the v4 expression-output codec, and
    deciding it afterwards costs a second manifest version.

    Rejected alternatives:

    - *`string | number | null` only, `undefined` a type error.* Rejects
      `cond ? value : undefined`, which is the shape authors actually write, and
      a compile error there reads as a framework defect. It also diverges from
      the ordinary path at the type level while agreeing at runtime.
    - *Move removal out of 8c.5 entirely.* Would make the resumable path
      **strictly less capable** than the ordinary path it is required to match
      (the 8c.0 helpers are explicitly null-safe so compiler effects diff
      removals correctly), violating Decision 7. It also has real accessibility
      consequences: `aria-*` is in the first allowlist, and an absent
      `aria-hidden` does not mean the same thing as `aria-hidden="false"`.
- Keep whole style objects, `classList`, CSS text, dynamic property names, and
  mixed structural expressions out of scope.
- Verify multiple target kinds on one element and one dependency invalidating
  several targets without duplicate module loads.

Exit: attribute, class, and style-property patches share the text subscriber
and lifecycle machinery; only patch strategy differs.

### 8c.6 — Race, Security, and Ownership Hardening

Status: complete (2026-07-30) — all seven `hardening.spec.ts` specs went green
the moment non-text installation worked, exactly as triage predicted (they shared
one masking cause). Includes the tamper check that `installClient` previously
missed.

- Test malformed, missing, duplicate, unknown, and wrong-owner element markers.
- Test target metadata tampering and forbidden names.
- Test invalid expression output and schema decoding failures with recovery on
  a later valid write where recovery is defined.
- Race invalidation against module resolution, activation, resumption,
  disposal, and element removal.
- Recheck dormant ownership immediately before every DOM write.
- Ensure marker cleanup and all subscriber/fiber disposal are idempotent.
- Confirm separate installations cannot observe each other's reserved binding
  keys.

Exit: every failure is either a typed install error, a named diagnostic, or a
documented activation fallback—never a silent patch to the wrong element.

### 8c.7 — Chromium Proof and Post-Widening Measurement

Status: **complete (2026-07-30) — the gate returns GO.**

**Chromium proof: 7/7 passing.** One browser test had to be corrected first — it
asserted the literal ordinal identity `app/note-button.ts#$0`, which the M7
content-hash change replaced. Browser tests are not in `npm test`, which is why
the compiler slice updated five unit tests and missed this one. It now asserts
the *shape* (`/^app\/note-button\.ts#\$[0-9a-z]+$/`) rather than the digest,
so editing a marker's body no longer breaks a browser test.

**Post-widening measurement (5 cold runs, 30 warm writes per kind, Chromium
151.0.7922.34, Windows x64):**

| Gate | Ceiling | Result | |
| --- | --- | --- | --- |
| density-24 dormant-vs-eager retained-heap gap | 204,800 B | **49,368 B** | PASS |
| density-1→24 dormant growth vs eager growth | 1.10× | **0.6659×** | PASS |

Dormant now grows **more slowly per expression than eager** (1,138 B/expr vs
1,710 B/expr), which is the outcome the whole M8 bet was arguing for.

**Payload cost of the widening**, which is the number this slice actually owed:

| | raw | gzip |
| --- | --- | --- |
| density 1 | 511 → 523 B (+2.3%) | 303 → 314 B (+3.6%) |
| density 24 | 8,186 → 8,474 B (+3.5%) | 766 → 777 B (+1.4%) |

So attribute, class, and style-property targets cost **288 raw / 11 gzip bytes
at density 24**. That is the honest price of 8c.

**Do NOT read the heap numbers as a 73% improvement over the recorded baseline.**
The baseline (`benchmarks/resumability/results/baseline-windows-chromium.json`)
records **no measurement mode**; this run records
`heapMeasurementMode: "jitless-forced-gc"`. Jitless removes the density-triggered
V8 JIT code that M8c.1 found was being miscounted as expression slope — and it
removes it from **both** arms, which is why eager's growth fell by a similar
proportion. The gap and slope figures above are **within-run** comparisons and are
therefore valid; the cross-run growth deltas are not. **Re-pin the recorded
baseline from this run** so the next comparison is like-for-like.

**Consequence: M8d is unblocked.** The gate said go, so keyed-list and
branch-replacement targets may proceed when scheduled.

- Extend the realistic fixture with text, attribute, class, and style-property
  expressions.
- Prove:
  - zero expression chunks before use;
  - zero parent/sibling setup and view runs while dormant;
  - one chunk load for shared code;
  - exact target changes and untouched siblings;
  - warm later updates;
  - exact-once activation handoff;
  - terminal disposal.
- Rerun the four metrics and compare with the pre-widening text baseline and
  eager mode.
- Calibrate checked-in budgets from repeated CI-like runs. Use deterministic
  structural counters as hard gates; use timing/heap tolerances wide enough to
  detect regressions rather than scheduler noise.
- Record a go/no-go decision:
  - continue toward keyed lists/compiler-inferred dependency ergonomics; or
  - tighten payload/runtime cost before expanding the fence.

### 8c.8 — Documentation and Status Closure

Status: **complete (2026-07-30).**

`RESUMABILITY_GUIDE.md` gained a **Diagnostics reference** covering both
families — all 9 collect codes and all 12 client codes — with the split stated
explicitly, because knowing *which side* emitted a diagnostic is the first thing
an operator needs: a collect diagnostic means *this was left out of the manifest
and the page still works*; a client diagnostic means *something that should have
resumed did not*.

The audit gap that let `unsupported-expression-target` ship undocumented is also
closed: `diagnostics.spec.ts` previously checked only client codes, so a
server-side code could never fail it. It now audits collect codes as well, and
asserts the two families are documented as distinct. Both new specs carry the
same control as the original — a code that does not exist must **not** be found,
or the check would pass against any non-empty document.

With this, **Milestone 8c is complete.**

- Update the resumability guide with supported target/value tables, examples,
  diagnostics, security fences, and the exact eager baseline definition.
- Publish the measurement method and results, including unfavorable results.
- Update the main implementation plan and current-status document.
- Record durable lessons: why the chosen compiler seam survived ABI testing,
  which targets remain fenced, calibrated costs per expression, and any failed
  approaches future work should not repeat.

## Performance Gate

The first measurement run establishes numeric budgets; the following are
non-negotiable before calibration:

- manifest and marker growth is linear in expression instances;
- no dormant expression module loads before invalidation;
- one code identity produces at most one in-flight module load;
- warm writes coalesce per microtask and never apply stale results;
- subscriber/controller counts return to zero after disposal;
- on the pinned Chromium/Windows benchmark, the density-24 dormant/eager ready
  heap gap stays at or below the calibrated 200 KB fixed-cost budget;
- dormant density-1-to-24 heap growth stays at or below 110% of eager growth,
  separating per-expression scaling from the fixed protocol floor;
- warm update p95 must remain within one animation-frame budget on the
  calibrated Chromium environment and must not regress grossly against eager
  updates.

## Explicitly Out of Scope

- Signal, owner, or computation serialization.
- Compiler-inferred dependencies replacing declared `deps`.
- Lists, keyed reconciliation, branch replacement, portals, suspense, or
  nested expression ownership.
- `SafeHtml`, `innerHTML`, CSS text, whole style objects, class-list objects,
  DOM property expressions, namespaced attributes, dynamic target names, and
  URL-bearing attributes.
- Retry/poll schedule restoration.
- A public stable adapter SPI; that remains Milestone 9.

## Verification Contract

The eventual completion command must run:

- all typecheck targets, including Effect diagnostics;
- the full unit suite;
- the package build;
- all Chromium correctness scenarios;
- a deterministic resumability benchmark verifier checking structural metrics
  and calibrated budgets.

The v2 benchmark verifier enforces lifecycle, ownership, network, payload,
attribution-matrix, calibrated fixed-cost, and relative-slope invariants.

## Open Questions Resolved by Early Probes

1. Is the current comparator hydration or eager rerender?
2. Does the generated directive preserve authored ref/directive ordering?
3. Which ordinary JSX helper semantics are currently incomplete?
4. Is CDP heap usage stable enough to gate, or only to report?
5. What numeric payload, latency, and memory budgets does the baseline justify?

These are intentionally not guessed. Each has an early, cheap experiment and
must be resolved in the plan document before later milestones depend on it.

## Corrections resolved after speccing these decisions (2026-07-30)

Writing `DQ-002`/`DQ-003`/`DQ-004` out as executable specs exposed gaps in the
ratifications above. All are now **decided**.

**1. `DQ-002` — corrected: there is no wire representation, and none is needed.**
The original ratification said absence is "an omitted output field" and that the
manifest's initial value and a patched value share one representation. That
premise was **wrong**. Verified against source: the v4 entry is
`{target, code, deps, inputs?, component?}` (`src/Resume.ts:261–277`) and
`ExpressionOutput` appears in **no Schema at all** — only in
`src/resume-expression.ts` and `src/portable-extract.ts`, which are authoring and
type surfaces. **An expression's output never crosses the wire**: the client
loads the expression's code and computes the value locally.

Corrected decision:

- `ExpressionOutput` widens to `string | number | null | undefined`. This stands
  — it is the **authored return type**, and it is what makes removal expressible.
- The "initial and patched share a wire representation" clause is **struck**. No
  manifest field is added and **no manifest version bump is required** for
  `DQ-002`.
- What actually needs specifying is the two ends, not the middle:
  - **SSR**: an expression evaluating to `null`/`undefined` writes **nothing** —
    the attribute/class/style-property is absent from the served HTML, exactly as
    the ordinary null-safe helper already behaves.
  - **Patch**: `null`/`undefined` **removes** the attribute/class/style-property;
    every other value writes. `""` is a **value, not an absence** — a "remove on
    falsy" implementation is wrong and the spec pins this.

This is strictly simpler than the original ratification: it deletes a wire change
rather than adding one.

**2. `DQ-007` — the terminal record carries ids; a counter is wrong.** Flagged
because the specs had originally been written against
`terminalRecord(regions: number)`, so anyone who started implementing from them
may have built the counting version. The ratified shape is **`regionIds` set
equality** against the flushed regions — which detects a duplicated or reordered
flush, and a counter cannot.

**3. `DQ-010` — the deferred milestone is named `M8d`.** Keyed-list and
branch-replacement targets are deferred to **Milestone 8d — structural expression
targets**, gated on 8c.7's go/no-go. It is a separate milestone rather than an
8c.9 slice precisely because it must not start if the measurement gate says stop.

**4. `DQ-010` — the public reconciler is named for what it is.** The private
function is `reconcileArrays(parent, oldNodes: Node[], newNodes: Node[], marker)`
(`src/dom.ts:183`), and there is a **separate single-node path above it**
(`:150–173`). The public export is therefore
**`dom.reconcileArrays(parent, oldNodes, newNodes, marker)`** — same name, same
array signature. Deliberately **not** `reconcileChildren`, which would claim to
be the general child reconciler it is not. If the single-node path is ever needed
publicly it gets its own honest name.

> **Correction (2026-08-11): "simply expose it" was wrong — it did not work.**
> The ratification assumed `dom.ts` already reconciled keyed children correctly
> and only needed a public export. Exporting the function unchanged and running
> the spec's own reorder case failed immediately. **Two real defects:**
>
> 1. **The reconciler dropped a surviving node.** Its single forward pass
>    advanced `n` on a mismatch but never `o`, so the trailing
>    `while (o < oldNodes.length) removeChild(oldNodes[o++])` removed nodes that
>    were present in `newNodes`. `[a,b,c] → [c,a]` produced `[a]`. Replaced with
>    a survivor set for removals plus a **backwards** placement pass, so each
>    node is positioned against an already-final successor and an unchanged list
>    is a true no-op instead of a sequence of self-cancelling moves.
> 2. **The server DOM's `insertBefore`/`appendChild` did not detach.** Per DOM
>    semantics, inserting an attached node *moves* it; `ServerNode` spliced it in
>    while leaving the original in place, so any reorder **duplicated** the node.
>    Latent until something reordered during SSR — which is exactly what a
>    structural target will do.
>
> The lesson generalises: **a ratification that says "just expose the existing
> thing" is asserting the existing thing is correct**, which is a claim about
> untested code. Both defects were found by running the spec's assertions, not
> by reading either implementation.
