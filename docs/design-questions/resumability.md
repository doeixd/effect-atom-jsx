# Resumability + streaming — triaged design questions (`DQ-001`–`DQ-029`)

Triage pass 2026-07-30 over the `unbuilt(...)` markers in
`future/resumability/*.spec.ts` and `future/streaming/*.spec.ts`, plus the
"Open Questions" sections of `RESUMABILITY_IMPLEMENTATION_PLAN.md`,
`RESUMABILITY_M8C_PLAN.md`, and `RESUMABILITY_M8_FINE_GRAINED_DESIGN.md`.

Duplicated `unbuilt` markers were collapsed: the ~30 markers across the two
lanes reduce to 12 distinct questions.

| ID | Question | Severity | Owning plan |
| --- | --- | --- | --- |
| DQ-013 | What is the fragment handle's observable shape? | deferrable | Plan M11b item 1 |
| DQ-014 | What is `Resume.fragmentAction`'s signature? | deferrable | Plan M11b item 4 |
| DQ-015 | How are manifest ids namespaced across installs? | deferrable | Plan M11b item 2 |
| DQ-016 | Should a per-binding codec be retained client-side? | deferrable | Plan M9 item 3 |
| DQ-017 | What is the streaming navigation entry point on `Route`? | deferrable | Plan M11 item 4 |
| DQ-018 | What is the exact typed error union for the resume failure modes? | deferrable | Plan OQ 2 |
| DQ-019 | Is build mismatch always hard, or may an adapter request fallback? | deferrable | Plan OQ 3 |
| DQ-020 | What services/options does render-from-bindings accept? | deferrable | Plan OQ 4 |
| DQ-021 | Can `deps` become an optional assertion? | deferrable | M8 design OQ 1 |
| DQ-022 | Does `SafeHtml` output need an on-wire sanitizer contract? | deferrable | M8 design OQ 4 |
| DQ-023 | `activate` vs `resume` racing one boundary: first-wins or diagnostic? | deferrable | Plan M0-7 finding 3 |
| DQ-024 | What is the one event-claim policy for marker chains? | deferrable | Plan M0-7 finding 4 |
| DQ-025 | What is the no-instrumentation performance budget? | deferrable | Plan OQ 8 |
| DQ-026 | Which handle kind justifies a public restoration constructor? | deferrable | Plan OQ 10 |
| DQ-027 | Do advanced APIs also export from the root package? | cosmetic | Plan OQ 1 |
| DQ-028 | Should repeated descriptors be dictionary-compressed? | cosmetic | M8 design §8 |
| DQ-029 | **Closeable:** three plan Open Questions the shipped code already answers. | cosmetic | Plan OQ 5, 6, 7 |

---

# Blocking

## Decided — promoted into the owning plan

Closed entries stay listed here (never renumbered) so a `DQ-nnn` cited anywhere
still resolves. The decision and its rejected alternatives live in the plan.

| ID | Decision | Ratified in |
| --- | --- | --- |
| DQ-002 | `ExpressionOutput` widens to `string \| number \| null \| undefined`; absence is an **omitted** wire field decoding to `undefined`, so `null` never appears on the wire. Must land before 8c.4 or it costs a second manifest version. | `RESUMABILITY_M8C_PLAN.md` §8c.5 |
| DQ-003 | One `use:`-style directive **per host element**, taking an array of `[boundExpression, target]` pairs. Per-element grouping matches the v4 marker, which already lists several instance ids. | `RESUMABILITY_M8C_PLAN.md` §8c.3 |
| DQ-004 | Three compiler-facing helpers (`exprAttribute`/`exprClass`/`exprStyleProperty`) in `dom.ts`, each calling the **ordinary** helper then delegating to one `observeRenderedExpressionTarget` registrar in `resume-session.ts`. Satisfies Decision 7 structurally. | `RESUMABILITY_M8C_PLAN.md` §8c.4 |
| DQ-001 | Folded into M11 item 1, renamed **per-render server render state (session + document + SSR mode)**. No `FiberRef` exists here, so it needs a service + ambient dynamic scope. Isolation test asserts disjoint **documents**. | `RESUMABILITY_IMPLEMENTATION_PLAN.md` M11 item 1 |
| DQ-005 | `collectAsync`/`renderComponentAsync` as separate entry points; **request-level deadline only**, overrun classified as a per-region activation fallback (slow region degrades to interactive-after-activation, not a 500). | plan §Ratified `DQ-005`–`DQ-012` |
| DQ-006 | **Explicit** async boundaries (structure is authored, not inferred); `renderToStream` stays in `dom` for slice 1; ordered/out-of-order is one option, not two functions. | plan §Ratified `DQ-005`–`DQ-012` |
| DQ-007 | New discriminated manifest version; terminal record carries **region ids, not a count**, so completeness is set equality; cumulative byte ceiling with its own error. | plan §Ratified `DQ-005`–`DQ-012` |
| DQ-008 | One internal `ingestRecord` behind `installClientStreamed`, `installClientStreaming.ingest`, and `mountFragment` — making "a fragment and a flush are one operation" true in code. | plan §Ratified `DQ-005`–`DQ-012` |
| DQ-009 | `"<scopeId>:<eventId>"` with `:` reserved; **the page installation gets an explicit scope id too** — an unqualified page marker is how a fragment id eventually collides with it. | plan §Ratified `DQ-005`–`DQ-012` |
| DQ-010 | Expose `dom.reconcileChildren(...)` (face 1 is not a design question); keyed-list and branch targets **deferred to a named milestone after 8c.7's go/no-go**. Lean: the region owns its subscribers. | plan §Ratified `DQ-005`–`DQ-012` |
| DQ-011 | M9 item 2 is **blocked on** M10 item 4, not merely deferred. Commit now only to a runtime-readable `spiVersion` so adapters fail closed on mismatch. | plan §Ratified `DQ-005`–`DQ-012` |
| DQ-012 | `readonly id` on `SerializationService` — the client's own id is the id of the layer it provided. Stamp `manifest.serializer` beside `buildId`. Eval mode is `serovalUnsafeEval`. | plan §Ratified `DQ-005`–`DQ-012` |











## DQ-013 — What is the fragment handle's observable shape?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Milestone 11b item 1
- **Raised:** 2026-07-30, while writing `future/streaming/server-fragments.spec.ts`
- **Blocks specs:** `future/streaming/server-fragments.spec.ts` (4 markers, lines
  78, 155, 222, 300) — **4 duplicate `Resume.mountFragment` markers, one question**

**What I was doing.** Specifying M11b item 3: "replacing or removing the region
disposes the fragment's listeners/subscribers/boundaries exactly once".

**What is undecided.** Item 1 names `Resume.mountFragment(installation, region,
{html, manifest})` and says nothing about its **return value**. The exactly-once
disposal claim is unobservable without one: the spec needs `fragment.dispose`
*and* a way to observe disposal state, and settled on `fragment.disposed?.()`
(`server-fragments.spec.ts:352,362,367`) — the `?.` is the spec admitting the
member may not exist. Undecided: `disposed()` predicate vs `isActive()`; whether
a `disposeCount` is exposed (idempotence is currently asserted indirectly, by
calling `dispose` twice and checking the *parent* installation at `:359-361`);
and whether a fragment can be re-activated (`activate`) or is single-shot.

**Why it matters.** Nothing blocks: item 1's core operation is decided, and the
handle is its observability surface. But it is the difference between M11b item 3
being *testable* and being *asserted*, and once M11b ships, the handle is public.

**Options.**

1. **`{ dispose: Effect<void>, disposed: () => boolean }`** — minimal, mirroring
   `ClientInstallation` (`src/Resume.ts:1137`, `dispose`; plus `inspect()`
   returning `disposed`). *Cost:* idempotence provable only indirectly. *Buys:*
   consistency with the existing installation handle; smallest surface.
2. **Add `disposeCount: () => number`.** *Cost:* a counter that exists only for
   tests, which tends to rot. *Buys:* "exactly once" becomes a direct assertion
   rather than an inference from parent-installation counters.
3. **`inspect()` returning a record**, exactly like `ClientInstallation.inspect()`
   (used at `server-fragments.spec.ts:100,143-144,305`). *Cost:* more to
   maintain and keep detached/inert. *Buys:* one idiom for both handles; carries
   `disposed`, subscriber counts, and any future field without changing the
   handle type.

**Recommendation.** Option 3 — reuse `inspect()`, because the fragment and the
installation are the same kind of thing at different scopes, and the specs
already reach for `installation.inspect()` to prove the parent is unaffected.
Include `disposed` in the record; skip a dedicated `disposeCount` (option 2)
unless the exactly-once proof turns out genuinely inexpressible without it. No
`activate` in v1: a fragment is "one settled collection result" per M11b's
non-goals, so re-activation has no defined meaning yet.

**What I did in the meantime.** Four `unbuilt("Resume.mountFragment", ...)`
markers. The spec uses optional chaining (`first.disposed?.()`) rather than
asserting the member exists — a softened assertion; it does not prove the member
is present, only that if present it reads `true`.

**Related.** DQ-008, DQ-014, DQ-015.

---

## DQ-014 — What is `Resume.fragmentAction`'s signature?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Milestone 11b item 4
- **Raised:** 2026-07-30, while writing `future/streaming/server-fragments.spec.ts`
- **Blocks specs:** `future/streaming/server-fragments.spec.ts:382`

**What I was doing.** Specifying "a typed authoring wrapper pairing the server
handler with the client call (schema'd args in, `{html, manifest}` out),
composing with single-flight".

**What is undecided.** No name, no signature. The spec invented
`Resume.fragmentAction` and pinned only the *property* it must have: one call
returns both the fragment and the revalidated loader snapshots, riding the
existing `SingleFlightPayload` rather than a new wire format
(`server-fragments.spec.ts:388-390`). Undecided: whether this is a `Resume` member
or a `ServerRoute`/`Component.action` combinator (the server side is "just
`ServerRoute.json`/`action` + `Resume.collect`" per `:1269-1272`, which argues it
belongs on the route side); how the loader-revalidation set is declared; and how
the client call site pairs with `mountFragment`.

**Why it matters.** Nothing blocks — item 4 is the last item in M11b and items
1–3 deliver the capability. It freezes into a public authoring surface, and its
*home* (Resume vs ServerRoute) is a real architectural call given DQ-011's
observation that `Resume` already mixes three audiences.

**Options.**

1. **`ServerRoute.fragment(...)` + a client caller** — lives with the other
   server handler constructors, since the server half genuinely is a
   `ServerRoute` handler. *Cost:* splits the fragment story across two modules
   (`ServerRoute` to define, `Resume` to mount). *Buys:* does not grow `Resume`;
   composes with existing single-flight/loader machinery in its own module.
2. **`Resume.fragmentAction(...)`** — one module owns fragments end to end.
   *Cost:* worsens exactly the mixing DQ-011 flags. *Buys:* discoverable; the
   define/mount pair is one import.
3. **No wrapper** — document the composition (`ServerRoute.json` +
   `Resume.collect` + `mountFragment`) instead. *Cost:* the typed args and the
   single-flight pairing become the author's problem, and getting the
   single-flight pairing wrong is a duplicate-fetch bug. *Buys:* zero new
   surface; the composition already works today.

**Recommendation.** Defer until DQ-011 resolves the `Resume` audience split —
that decision determines the answer, and taking this one first would prejudge it.
My lean is option 1. Note that option 3 is the honest status quo and should be
documented as such in the interim, since the server half already composes.

**What I did in the meantime.**
`unbuilt("Resume.fragmentAction — the typed server/client fragment pairing (schema'd args in, {html, manifest} + single-flight loaders out)", "M11b item 4")`.

**Related.** DQ-011, DQ-013.

---

## DQ-015 — How are manifest ids namespaced across installs?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Milestone 11b item 2
- **Raised:** 2026-07-30, while writing `future/streaming/server-fragments.spec.ts`
- **Blocks specs:** covered by the DQ-013 markers (`server-fragments.spec.ts:155`,
  `:222`)

**What I was doing.** Specifying "fragment-local ids (`c0`, `e0`, `x0`) must not
collide with the page's".

**What is undecided.** Item 2 states the requirement — "ids become
installation-scoped" — and not the representation. This is DQ-009's sibling: that
entry covers the **DOM marker** spelling, this one covers the **manifest key**
space. Undecided: are manifest keys rewritten at ingest (`c0` → `f1:c0`), or kept
verbatim with the installation scope held out-of-band in the install's data
structures? And is the scope id server-assigned (in the record) or client-assigned
(at mount/ingest)?

**Why it matters.** Not blocking: it is settled *by* DQ-009 in practice, since
markers and manifest keys must agree. Recording separately because a plausible
answer is "markers are qualified, manifest keys are not" — keys are looked up
inside a per-install map, so they need no global uniqueness — and that asymmetry
should be a deliberate choice rather than an accident.

**Options.**

1. **Client-assigned scope, manifest keys verbatim, markers qualified.** Each
   install/mount gets a scope id at ingest; keys stay `c0`/`e0`/`x0` inside a
   per-scope map; only the DOM marker carries the scope. *Cost:* the scope must
   be attached to every DOM-facing lookup path. *Buys:* no manifest rewriting, so
   no risk of a partial rewrite; server records stay independent of where they
   land — which is required for a fragment collected by a different request.
2. **Rewrite keys at ingest** (`c0` → `f1:c0`). *Cost:* every key in every
   sub-record must be rewritten consistently, including cross-references between
   components/expressions/events; a missed reference is a silent mis-binding.
   *Buys:* one flat global key space; existing lookups unchanged.
3. **Server-assigned globally unique ids.** *Cost:* impossible across independent
   collections, same as DQ-009 option 2. *Buys:* nothing achievable.

**Recommendation.** Option 1 — client-assigned scope, verbatim keys, qualified
markers. It keeps the server's output position-independent (a fragment does not
need to know it will be mounted into a page that already used `c0`), and confines
the scoping to the DOM boundary where DQ-009 already puts it. Ratify with DQ-009,
as one decision with two halves.

**What I did in the meantime.** Nothing assumed beyond DQ-009's provisional
marker spelling; the fragment namespacing specs sit behind
`unbuilt("Resume.mountFragment", ...)`.

**Related.** DQ-009, DQ-007, DQ-013.

---

## DQ-016 — Should a per-binding codec be retained client-side, or is "classified diagnostic + last-good DOM + recovery" the contract?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Milestone 9 item 3
- **Raised:** 2026-07-30, while writing `future/resumability/adapter-spi.spec.ts`
- **Blocks specs:** none — the spec proceeded on a provisional contract
  (`future/resumability/adapter-spi.spec.ts:141-158`)

**What I was doing.** Specifying the `writeBindingEncoded` adapter escape hatch.

**What is undecided.** `writeBindingEncoded(componentId, binding, encodedValue:
unknown)` (`src/Resume.ts:1132-1136`) resolves the binding then commits the value
with **no validation** — `commitBindingWrite` stores `encodedValue` and notifies
(`src/Resume.ts:4854-4855`, called at `:4862-4865`). Contrast `writeBinding`
(`:4867-4892`), which takes a schema and encodes. There is no retained per-binding
codec client-side — which is *why* `writeBinding` takes one — so
`writeBindingEncoded` structurally cannot validate. The undecided part: is that
the intended contract, or should the install retain the binding's snapshot codec?

**Why it matters.** With no retained codec, a bad encoded value is caught only
downstream, when a dependent expression's dependency codec rejects it. The spec
settled for asserting that downstream behavior: a classified
`expression-execution-failure` diagnostic, no defect, the last good DOM value
left standing, and recovery on a later valid write
(`adapter-spi.spec.ts:144-158`). That is a *good* failure mode — but it is
currently emergent rather than specified, and it has a hole: a binding with **no
dependent expression** accepts a garbage encoded value silently, and the next
component to activate decodes it.

**Options.**

1. **Ratify the current contract** — `writeBindingEncoded` trusts the adapter's
   encoding; validation is the dependent expression's job; document the
   diagnostic/last-good/recovery guarantee, and document the no-dependent-
   expression hole. *Cost:* the hole stays; adapters can corrupt a binding no
   expression reads. *Buys:* zero cost; the escape hatch stays a genuine escape
   hatch, and `writeBinding` remains the safe default.
2. **Retain the per-binding snapshot codec at install** and validate in
   `writeBindingEncoded`. *Cost:* retained memory per binding — directly against
   the calibrated 8c.1 heap gates, where "resolver state is about 15 KB" is
   already a noted term; codecs are not serializable, so they would have to come
   from the resolver entries, not the manifest. *Buys:* one uniform validation
   point; the hole closes.
3. **Validate only the plain-JSON graph shape** (reuse the
   `jsonValueIssue`/plain-graph check the manifest path already applies per
   `RESUMABILITY_IMPLEMENTATION_PLAN.md:1597-1603`). *Cost:* catches
   structural garbage, not type mismatches — `"not-a-number"` still passes.
   *Buys:* cheap; prevents non-JSON values from entering a validated manifest
   graph, which is a real invariant, not a type check.

**Recommendation.** Option 1 **plus** option 3: ratify the trust-the-adapter
contract and document the downstream guarantee as a *promise* rather than an
accident, but add the cheap plain-JSON graph check so `writeBindingEncoded`
cannot inject a class instance into a frozen-validated manifest (M8 finding 8's
bypass, `:1597-1603`, is the same hazard through a different door). Reject option
2 on the retention budget. Record the no-dependent-expression hole explicitly in
M9's audit checklist.

**What I did in the meantime.** **Picked provisionally** in
`future/resumability/adapter-spi.spec.ts:141-158`: the spec asserts the
diagnostic/last-good/recovery contract as if ratified, with the reasoning in a
comment at `:144-148`. If option 2 is chosen, that assertion changes from
"downstream diagnostic" to "immediate typed failure".

**Related.** DQ-011, DQ-018.

---

## DQ-017 — What is the streaming navigation entry point on `Route`?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Milestone 11 item 4
- **Raised:** 2026-07-30, while writing `future/streaming/parallel-loaders.spec.ts`
- **Blocks specs:** `future/streaming/parallel-loaders.spec.ts` (3 markers, lines
  27, 104, 156) — **3 duplicate markers, one question**

**What I was doing.** Specifying "fork all matched loaders at once as fibers
under the request scope and start streaming the shell immediately", against
today's `renderRequest`, which runs `runStreamingNavigationInternal` to
completion first and itself runs matched loaders **twice in sequence** (critical,
then critical+deferred).

**What is undecided.** Item 4 names no API. The spec invented
`Route.renderRequestStream` (`parallel-loaders.spec.ts:25-27`). Undecided:
whether this is a new function, an option on `renderRequest`, or a change to
`renderRequest`'s behavior with the same signature; and whether the
double-sequential-loader-run in `runStreamingNavigationInternal` is fixed
in place (benefiting non-streaming callers too) or only on the new path.

**Cross-lane note.** The `unbuilt` marker lives in `future/streaming/` so it is
triaged here, but the surface is `Route`. If `router.md` has a competing entry,
this one should defer to it.

**Why it matters.** Not blocking M11 items 1–3, which do not touch the router.
It is blocking for item 4. The interesting sub-question is the second one: the
duplicate sequential loader run is a defect *independent* of streaming, and
fixing it under `renderRequest` would benefit today's callers — which argues for
"fix in place" rather than "new path only".

**Options.**

1. **New `Route.renderRequestStream`, returning a `Stream`; `renderRequest`
   unchanged.** *Cost:* two navigation paths to keep semantically aligned, which
   is where routers accumulate divergence bugs. *Buys:* zero risk to the
   existing path; opt-in.
2. **Option on `renderRequest`** (`{ stream: true }`) with a conditional return.
   *Cost:* conditional return type on the main server entry point. *Buys:* one
   path, one matcher, one loader-forking implementation.
3. **Make `renderRequest` fork-all internally and add streaming separately.**
   *Cost:* changes existing behavior (loader concurrency) for current callers —
   which is arguably a fix, but is observable. *Buys:* the duplicate sequential
   run dies for everyone; streaming then reduces to "expose the shell early".

**Recommendation.** Option 3 first, then option 1 on top: land fork-all-loaders
inside the existing `renderRequest` as a correctness/perf fix with its own tests
(every loader started before any finishes; each runs exactly once), then add the
streaming entry point over it. That way the two paths share one loader-forking
implementation, and option 1's divergence risk is confined to flushing. Defer the
naming until the router lane weighs in.

**What I did in the meantime.** Three
`unbuilt("Route.renderRequestStream (fork-all-loaders navigation)", "M11 item 4")`
markers.

**Related.** DQ-006.

---

## DQ-018 — What is the exact typed error union for code loading, manifest lookup, capture decode, and build mismatch?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Open Questions 2
- **Raised:** carried forward from the plan; still genuinely open as of 2026-07-30

**What is undecided.** The plan's Open Question 2, verbatim, is still open. The
concrete errors exist and are named (`ResumeBindingSnapshotNotFoundError`,
`ResumeBindingSnapshotWriteEncodeError`, `ResumeExpressionOwnershipError`,
`ResumeUnknownComponentBoundaryError`, `ResumeActivationEventOwnershipError`,
`ResumePayloadTooLargeError`, …), but there is no ratified *union* an adapter can
exhaustively handle, and M11 adds more (the truncation error DQ-008 needs, whose
tag the spec had to match with a regex).

**Why it matters.** Nothing blocks; the errors are individually typed and
individually caught. It freezes at M9 — an adapter cannot write an exhaustive
handler against an unenumerated union, and "unsupported cases fail closed" is
unverifiable without one.

**Options.**

1. **A named exported union type per boundary** (`Resume.CollectError`,
   `Resume.InstallError`, `Resume.WriteError`). *Cost:* every new error must be
   added to its union or it silently widens the inferred type. *Buys:* adapters
   get exhaustiveness; the union is documentable and testable.
2. **A common tagged supertype** (all resume errors share a discriminant field,
   e.g. `resumePhase`). *Cost:* a second discriminant alongside `_tag`. *Buys:*
   adapters can branch coarsely without enumerating; new errors do not break
   handlers.
3. **Leave inferred.** *Cost:* what we have; the union is whatever the
   implementation happens to throw, and it changes without notice. *Buys:*
   nothing.

**Recommendation.** Option 1, sequenced with DQ-011 (the SPI freeze is the
natural moment to enumerate), and add a type test that the union is closed —
otherwise option 1 degrades to option 3 on the first new error.

**What I did in the meantime.** `future/streaming/streaming-manifest.spec.ts:177`
softened its truncation assertion to a tag regex `/Truncated|Incomplete/` rather
than inventing a tag.

**Related.** DQ-008, DQ-011, DQ-019.

---

## DQ-019 — Is build mismatch always a hard failure, or may an adapter request hydration fallback?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Open Questions 3
- **Raised:** carried forward; still open

**What is undecided.** The plan's Open Question 3. Current behavior is hard
failure (the build-ID gate), and M11b item 2 extends it: "Build-ID equality
between the page and every fragment is enforced; mismatch falls back closed
(render the HTML inert, diagnostic emitted)" (`:1295-1297`). Note that this is
already an *answer for fragments* — "fall back closed, HTML inert" — so the open
question is now narrower than the plan states: does the **page-level** install
get the same treatment, or may an adapter request full hydration instead of inert
HTML?

**Why it matters.** Deferrable. It becomes a published policy at M9, and it is
the difference between "a stale deploy shows a dead page" and "a stale deploy
shows a working, fully-hydrated page at a bundle-size cost".

**Options.**

1. **Always hard/inert.** *Cost:* a mid-deploy client sees non-interactive
   content. *Buys:* one rule; nothing can accidentally run stale code against
   fresh markers.
2. **Adapter-requested hydration fallback** at the page level, inert for
   fragments. *Cost:* the adapter must ship component code it hoped not to; two
   policies to test; the fallback path is the least-exercised code in the system
   and would run precisely during a deploy.
3. **Always hydration fallback when component code is available.** *Cost:*
   silently masks build-identity bugs, which is how a mismatch goes unnoticed
   for a release cycle. *Buys:* best user experience during deploys.

**Recommendation.** Option 1, and **amend Open Question 3 to record that
fragments are already decided** (inert + diagnostic, M11b item 2) so the
remaining scope is page-level only. Option 2 is defensible but should wait for
evidence that mid-deploy inertness is a real product problem; masking build
mismatch (option 3) contradicts Architectural Decision 13.

**Related.** DQ-018.

---

## DQ-020 — What explicit render services/options should render-from-bindings accept?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Open Questions 4
- **Raised:** carried forward; still open

**What is undecided.** Open Question 4 verbatim: which services/options
render-from-bindings takes "so platform and diagnostics behavior matches current
render helpers". Architectural Decision 9 says rendering from bindings uses one
shared implementation, which constrains but does not answer it.

**Why it matters.** Deferrable — the shared implementation means behavior already
matches by construction for the paths that exist. It matters when an adapter
needs to render with a *different* platform or diagnostics sink than the page,
which is DQ-011's consumer.

**Options.** (1) Accept the same options record as the current render helpers,
whatever it is, and let it stay coupled. (2) A narrow explicit record naming only
platform + diagnostics. (3) Take an Effect `Layer` and resolve services from it.

**Recommendation.** Not enough information — this should be answered by the M10
item 4 permissive package, which is the first consumer that will actually need a
divergent configuration. What would settle it: the list of services that package
has to override. Revisit with DQ-011.

**Related.** DQ-011.

---

## DQ-021 — Can `deps` become an optional assertion once SSR read-capture is trusted?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_M8_FINE_GRAINED_DESIGN.md` §Open questions 1
  (with `RESUMABILITY_IMPLEMENTATION_PLAN.md` M10 item 5, `deps.auto`)
- **Raised:** carried forward; still open

**What is undecided.** Whether `deps` can be inferred capture-only, with the
declaration becoming an optional assertion. v1 requires declaration because
capture during a single SSR pass can under-observe conditional reads.

**Why it matters.** Deferrable and correctly so. Note the strong constraint
already ratified next door: M10 item 1 states that on `expr.auto`, "**dependency
identity is never inferred**" — `dependencies`/`deps` stay required, and
declaring `captures`/`bind` alongside them is a compile error, because "a missed
or spurious dependency edge is a correctness bug no heuristic may introduce"
(`RESUMABILITY_IMPLEMENTATION_PLAN.md:1099-1105`). So the *inference* half of this
question is effectively closed; what remains open is only whether declared `deps`
can additionally be **verified** against SSR capture (`deps.auto` as an assertion
mode, M10 item 5).

**Options.** (1) Assertion mode only — `deps.auto` verifies the declaration
against observed reads and fails on a *spurious* edge, staying silent about
possibly-unobserved ones. (2) Full inference — contradicts the M10 item 1
ratification. (3) Leave as is.

**Recommendation.** Option 1, and **narrow the question in the design doc**:
inference is closed by M10 item 1's ratification; only assertion is open. Note
the existing caveat that capture-based verification "can be bypassed by closures
that skip `trackReactivityRuntime`" (`:1605-1608`), so an assertion mode must be
documented as detecting spurious edges, never proving completeness.

**Related.** DQ-002.

---

## DQ-022 — Does `SafeHtml` output need an on-wire sanitizer contract?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_M8_FINE_GRAINED_DESIGN.md` §Open questions 4
- **Raised:** carried forward; still open

**What is undecided.** Whether `SafeHtml` expression output (design-doc Phase 3)
needs a sanitizer contract on the wire, or can rely on existing `SafeHtml`
branding rules.

**Why it matters.** Fully deferrable: `SafeHtml`/`innerHTML` are explicitly out of
scope for M8c (`RESUMABILITY_M8C_PLAN.md:478-480`), so nothing can emit such an
output today. It matters the moment a `SafeHtml` target kind is proposed.

**Options.** (1) Branding only — the type is the contract, as elsewhere in the
codebase. (2) Branding plus a wire-side sanitizer applied at decode. (3) No
`SafeHtml` target kind ever, so the question cannot arise.

**Recommendation.** Option 3 is worth taking seriously and is the strongest
answer available. The precedent is the generated-UI IR decision that there be
*no raw-HTML node kind at all*, which makes a security property true by
construction rather than by validation. A branded `SafeHtml` value is trustworthy
in-process because the brand was earned in-process; after a wire round trip the
brand is just a JSON field an attacker can write, so option 1 is a trust
laundering step and option 2 admits the brand is insufficient. Recommend
recording "no `SafeHtml` expression targets; use structural targets" and closing
this unless a concrete use case forces it.

**Related.** DQ-010.

---

## DQ-023 — `activate` vs `resume` racing one boundary: documented first-wins, or a mode-conflict diagnostic?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §M0-7 Test Audit
  Findings item 3 (`:1539-1541`), pin result at `:1615-1617`
- **Raised:** carried forward; still open

**What is undecided.** When `activate()` joins an in-flight `resume()` on one
boundary, the second caller's mode is silently discarded. The audit pin
(`it.fails` in `resume.test.ts`, "Resume audit pins II") confirms first-wins
holds and **zero diagnostics** are emitted. The plan says this "needs a
mode-conflict diagnostic or a documented first-wins contract" — i.e. the design
choice itself is open, which is why this is a design question and not a defect.

**Why it matters.** Deferrable: behavior is deterministic (first wins) and safe.
But an adapter that asks for `activate` and gets `resume` has no way to know,
and M9's acceptance ("unsupported cases fail closed or activate through an
explicit, tested fallback") arguably requires the caller to be told.

**Options.**

1. **Documented first-wins, no diagnostic.** *Cost:* a caller's explicit mode
   request can be silently ignored. *Buys:* zero code change; flips the pin by
   changing the test's expectation to the documented contract.
2. **First-wins plus a diagnostic** when the joined mode differs. *Cost:* one
   diagnostic code and its classification; noisy if mixed-mode joins are
   routine. *Buys:* observable; the caller learns its request was coalesced.
3. **Second caller fails** with a mode-conflict error. *Cost:* turns a benign
   race into an error in application code that did nothing wrong; the loser is
   determined by timing. *Buys:* impossible to ignore.

**Recommendation.** Option 2. First-wins is the right *behavior* — the region is
already being brought up and tearing that down to honor a different mode is
strictly worse — but silence makes it indistinguishable from a bug, and this
question exists precisely because someone could not tell. Reject option 3:
failing the loser of a timing race punishes correct code.

**Related.** DQ-024.

---

## DQ-024 — What is the one event-claim policy for marker chains?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §M0-7 Test Audit
  Findings item 4 (`:1542-1546`), pin results at `:1618-1622`
- **Raised:** carried forward; still open

**What is undecided.** Portable markers keep walking the ancestor path after
dispatch (so ancestor same-type markers also fire) while activation markers
return after claiming (`src/Resume.ts:5273-5290` is the walk). The pins record
three measured combinations: portable+portable fires **both** owners
(`["child", "parent"]`); portable descendant + activation ancestor fires the
portable owner **and** activates the ancestor; only activation-descendant +
portable-ancestor is exactly-once. The plan asks for "one documented claim policy
plus tests over two-marker chains" — the policy is the open decision.

**Why it matters.** Deferrable — no shipped fixture hits a two-marker chain — but
this is the most substantive item carried forward, because "exactly once" is the
protocol's headline guarantee and it currently holds in one of three
configurations. It must be settled before M9 can claim fail-closed behavior, and
DQ-009's region-qualified markers add a *third* axis (same type, different
scope) that the policy has to cover.

**Options.**

1. **First claim wins, always; the walk stops** — unify portable markers with
   activation semantics. *Cost:* an ancestor that legitimately wants to observe a
   descendant's event no longer can (there is no bubbling equivalent); may break
   a currently-working pattern. *Buys:* "exactly once" becomes unconditional and
   trivially explainable; one code path.
2. **Explicit bubbling semantics** — a marker declares whether it stops
   propagation, mirroring DOM `stopPropagation`. *Cost:* new wire field; authors
   must reason about propagation, and the failure mode (two handlers ran) is the
   silent one. *Buys:* both patterns expressible; matches DOM intuition.
3. **Innermost-claims + a diagnostic when an outer marker was skipped.** *Cost:*
   diagnostic volume on legitimately nested UIs. *Buys:* exactly-once plus
   observability of what was suppressed.

**Recommendation.** Option 1. The guarantee this protocol sells is exactly-once
dormant interaction; a configuration-dependent guarantee is not one, and the
current asymmetry looks far more like an oversight than a design (activation
already stops the walk). Authors who need ancestor observation have ordinary DOM
listeners. Land it with the two-marker chain tests the plan asks for, and flip
the two `it.fails` pins. If option 1 breaks a real pattern, option 2 is the
principled fallback — but it should be adopted deliberately, not inherited.

**Related.** DQ-023, DQ-009.

---

## DQ-025 — What is the no-instrumentation performance budget?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Open Questions 8
- **Raised:** carried forward; **partially answered**, remainder open

**What is undecided.** Open Question 8 asks for "the first acceptable
payload-size and no-instrumentation performance budget". The **payload and heap**
halves are now answered and calibrated by 8c.1: linear payload growth, a
density-24 dormant/eager fixed gap ≤ 200 KB, and a density-1→24 dormant heap
slope ≤ 110% of eager (`RESUMABILITY_M8C_PLAN.md:285-291,454-470`), measured on
pinned Chromium 151 / Windows x64 with a `--jitless` heap lane. What remains open
is the **no-instrumentation** half: the budget for a render with resumability
*off*, which M9 item 6 ("no-instrumentation and collection benchmarks") owes and
which no checked-in number covers.

**Why it matters.** Deferrable. It matters as a regression gate: without it,
"normal runtime performance remains within the ratified regression budget" (M9
acceptance) has no referent.

**Options.** (1) Express it as a relative ceiling — instrumentation-off render
time/allocations within N% of the pre-resumability baseline. (2) Absolute
per-render numbers on the pinned environment. (3) Structural only — assert zero
instrumentation objects allocated when off, and no timing gate.

**Recommendation.** Option 3 as the hard gate plus option 1 as a report-only
tolerance, following 8c.1's own successful pattern ("Make structural invariants
hard failures. Keep wall-clock thresholds report-only until a baseline is
calibrated", `RESUMABILITY_M8C_PLAN.md:222`). "Zero instrumentation allocations
when off" is the property that actually matters and it is environment-independent.
**Amend Open Question 8 to record the payload/heap halves as answered by 8c.1**
so the remaining scope is unambiguous.

**Related.** DQ-028.

---

## DQ-026 — Which handle kind after state justifies a public restoration constructor?

- **Severity:** deferrable
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Open Questions 10
- **Raised:** carried forward; still open

**What is undecided.** Open Question 10 verbatim. State and query handles have
restoration; which *next* handle kind earns a public constructor is unanswered.

**Why it matters.** Deferrable by construction — this is a prioritization
question with no forcing function, and answering it early risks building a
constructor nobody uses.

**Options.** (1) None until an external consumer asks. (2) Pick by descriptor
capability data — instrument which handle kinds actually appear in real
components and let that decide. (3) Restore all classified handle kinds for
uniformity.

**Recommendation.** Option 1, with option 2 as the tiebreaker if one is needed:
the handle descriptors already advertise capabilities (Architectural Decision 7),
so the data is obtainable rather than guessable. Reject option 3 — every
restoration constructor is public surface and retained client-side weight, and
the 8c.1 retention gates make speculative surface expensive.

---

# Cosmetic

## DQ-027 — Do advanced APIs also export from the root package after stabilization?

- **Severity:** cosmetic
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Open Questions 1

**What is undecided.** Whether the advanced API is exported only from `Resume`
and `advanced`, or also from the root package after stabilization.

**Why it matters.** Naming/discoverability only — but it is the same decision as
DQ-011's subpath allocation, seen from the other end.

**Recommendation.** Answer it *as part of* DQ-011 and delete this entry: keep the
root package the golden path only (which is what `src/advanced.ts:5-6` already
documents as the intent), and do not re-export adapter surface from the root.
Deciding it separately is how the two answers end up disagreeing.

**Related.** DQ-011.

---

## DQ-028 — Should repeated descriptors for one code id be dictionary-compressed?

- **Severity:** cosmetic
- **Owning plan:** `docs/RESUMABILITY_M8_FINE_GRAINED_DESIGN.md` §8 (noted as an
  open question alongside size attribution and the list fence)

**What is undecided.** Whether the manifest should dictionary-compress repeated
descriptors for the same code id.

**Why it matters.** Now largely answered by measurement, which is why this is
cosmetic: the checked-in baseline shows the 24-expression v4 payload at 8,186 raw
/ **766 gzip** bytes (`RESUMABILITY_M8C_PLAN.md:240-243`). Transport gzip already
collapses repeated descriptors ~10.7×, so a bespoke dictionary would trade
schema complexity for a fraction of an already-small number. The one axis gzip
does *not* help is retained decoded-object count, which the 110% slope gate
covers separately.

**Options.** (1) Don't — rely on gzip; revisit only if the slope gate fails for
descriptor reasons. (2) Dictionary-compress descriptors in the schema. (3) Intern
descriptors post-decode (share one object per code id) without changing the wire.

**Recommendation.** Option 1 for the wire, with option 3 noted as the actual
lever if the retained-object slope ever becomes the binding constraint — that is
a decode-side change with no schema cost. Recommend closing this question with
the measurement as its answer.

**Related.** DQ-025.

---

## DQ-029 — Closeable: three plan Open Questions the shipped code already answers

- **Severity:** cosmetic (bookkeeping; no design work outstanding)
- **Owning plan:** `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` §Open Questions 5, 6, 7

These are listed as open but are decided elsewhere. Recorded as one closeable
entry so a ratification pass can strike them the way Open Question 9 was struck.

- **OQ 5 — "Which direct JSX event shape is the supported compiler-free action
  proof, and how are event arguments represented?"** Answered by the shipped M4
  path: `dom.addEventListener(el, "click", Resume.event(action), true)` producing
  `data-af-event-click="e0"` (`src/resume-session.ts:865`;
  `src/__tests__/resume.test.ts:415,431`), with arguments carried as the
  invocation kind on the manifest event record (`deferred-no-args` in the
  streaming fixtures). *Reason to close:* the shape exists, is tested, and is
  what `future/resumability/adapter-spi.spec.ts:336` exercises as the
  compiler-free proof.
- **OQ 6 — "Which event/options require eager synchronous attachment on the web
  platform?"** Answered in practice by the eager flag on that same call
  (`addEventListener(..., true)`), which the M4 proof and the SPI spec both use.
  *Reason to close:* the mechanism and its use are settled; if a *list* of
  event types requiring eager attachment is still wanted, that is a
  documentation task for M9 item 3, not an open design question.
- **OQ 7 — "What manifest embedding strategy best supports CSP: inert JSON
  script, external payload, streaming records, or an adapter choice?"** Answered:
  **inert JSON script**, and it is proven, not merely chosen —
  `future/resumability/adapter-spi.spec.ts:315-368` asserts
  `type="application/json"`, no non-JSON script tag, no `</script>` break-out, no
  `<!--`, no U+2028/2029, and byte-identical readback. M11 item 5's streaming
  records are an *additive transport* for the same inert payload, not a competing
  strategy. *Reason to close:* recommend recording "inert JSON script; streaming
  records are the incremental transport of the same form; no external-payload or
  adapter-choice mode in v1".

Also noted, requiring no entry: **Open Question 9** (async/streaming SSR
instrumentation mechanism) is already struck through in the plan at
`RESUMABILITY_IMPLEMENTATION_PLAN.md:1423-1426`, answered by Milestone 11 —
though its stated answer, "Effect fiber-local context", needs the correction
DQ-001 describes, because this Effect v4 beta has no `FiberRef` and
`Effect.runSync` starts a fresh fiber. Likewise the **M8 keys-only** decision
(design-doc OQ 3) and the **M8a expression-identity** decision (design-doc OQ 2)
are already marked decided and ratified in place; no entry resurrects them.

---

## DQ-030 — Who owns a structural region's content subscribers, and how is per-row identity carried?

> **RATIFIED 2026-08-11.** All three recommendations accepted, as revised in
> the Project-fit section below: **per-instance child `Scope`s** (not reactive
> `Owner`s), **`data-af-key` fenced at compile time** by the Babel plugin's
> existing rejector, and **one `{ kind: "structural", mode }` manifest member**
> at v5. The decisions now live in
> `RESUMABILITY_IMPLEMENTATION_PLAN.md` §Milestone 8d, which is the
> authoritative statement; this entry is retained as the reasoning record.
>
> **Superseded in part, 2026-08-11:** the open measurement was run, and
> **per-row markers won** — see the Measurement result section at the end of
> this entry. Per-row identity is now marker comments, not `data-af-key`, which
> deletes the single-element-root authoring constraint and M8d's compiler work
> item. Recommendations (1) and (3) are unchanged.

- **Severity:** blocking (M8d cannot start without it) — **resolved**
- **Owning plan:** `docs/RESUMABILITY_M8C_PLAN.md` §DQ-010 → Milestone 8d
- **Raised:** 2026-08-11, after closing the M8.6 keyed-reconciliation
  prerequisite and finding the two remaining structural specs still `unbuilt`
- **Blocks specs:** `future/resumability/fences.spec.ts` — "[M8.6] resumes a
  keyed list region by patching only the changed rows" and "[M8.6] resumes a
  conditional branch by replacing the region's content under one owner"

**What I was doing.** Implementing M8d. Face 1 (`dom.reconcileArrays`) is done
and green. Faces 2 and 3 need a region representation, and DQ-010 deliberately
deferred that rather than pre-empting 8c.7's gate. The gate returned GO, so the
decision is now due.

**What is undecided.** Three coupled sub-questions. They are coupled because the
answer to (1) determines what (2) must carry and what (3) must fence.

### 1. Which owner disposes a removed row's or an outgoing branch's subscribers?

Today there is **no per-expression reactive owner at all**. An expression is
dormant; on invalidation its controller resolves the portable code, runs it,
receives a scalar `ExpressionOutput`, and patches (`Resume.ts:4257`,
`patchExpressionTarget`). Nothing subscribes, so nothing needs disposing. A
structural target breaks that: its output is *content*, and content can contain
nested expressions, event handlers, and behaviors.

Ownership today is **positional, not lexical** — `componentBoundaryContains`
(`Resume.ts:3285`) walks the DOM between the component's start/end markers. That
answers "is this element still mine". It does **not** answer "whose finalizers
run when this row leaves".

### 2. How does the client map SSR nodes to keys?

`reconcileArrays` takes `Node[]` and preserves identity, but the resume path
receives markers and HTML, not a node array. Something must let the client
recover "the row with key `k` is these nodes" from the server's output.

### 3. What is the manifest target kind, and does it bump the version?

`target: ExpressionTargetSchema` **is** a wire field (`ExpressionEntryFields`,
`Resume.ts:313`), unlike `ExpressionOutput` — which is why DQ-002's correction
("widening is authoring/patch only, no manifest bump") does *not* transfer here.
Adding structural members is a real v4 → v5 bump.

**Why it matters.** Without (1), a long-lived list leaks every removed row's
subscribers until the whole component disposes — the exact failure the
prerequisite spec's `expect(seen[1]).not.toContain(b)` anticipates ("leaks are
what the region-ownership question exists to settle"). Without (2), a resumed
list can only be replaced wholesale, which defeats the milestone. Without (3),
the fence cannot distinguish "structural output on a text target" (must stay
rejected) from "structural output on a structural target" (must be accepted).

---

**Options for (1) — ownership.**

1. **Boundary owns everything** (status quo, extended). The component boundary
   owns all subscribers; a removed row's subscribers live until the component
   disposes. *Cost:* an unbounded leak proportional to list churn — a feed
   replacing 50 rows a minute accumulates forever. *Buys:* zero new machinery.
2. **Region owner** — one lightweight owner per region, nested under the
   boundary owner. This is the provisional lean recorded in the spec. *Cost:*
   correct for **branch replacement** (all content swaps at once) but **not for
   keyed lists**: removing one row cannot dispose only that row's subscribers,
   because they share the region's owner. *Buys:* one owner per region; cheap.
3. **Per-instance owner under a region owner** — the region holds
   `Map<key, Owner>`; each row or branch instance gets its own child owner,
   disposed exactly when `reconcileArrays` drops that node. *Cost:* one owner
   per row (an object plus a finalizer array), and a disposal path that must
   stay in lockstep with the reconciler. *Buys:* precise disposal, and branch
   replacement becomes the degenerate single-instance case rather than a second
   mechanism.

**Options for (2) — per-row identity.**

1. **Per-row marker comments** (`<!--af:row:x0:k1:start-->` / `:end`). *Cost:*
   two comments per row of payload. This lands directly on the 8c gates — the
   fixed-gap ceiling of 204,800 B and the **slope ceiling of 1.10** — and slope
   is the one that scales with row count, so it is the gate most at risk.
   *Buys:* works for rows that are text, fragments, or several top-level nodes.
2. **`data-af-key` on the row's root element.** *Cost:* requires each row to
   have exactly one *element* root; text-only or multi-node rows cannot carry it
   and need a collect-time diagnostic and fallback. *Buys:* far cheaper on the
   wire, and it reuses the existing element-target ownership check instead of
   adding a second marker-scanning path.
3. **Positional / index-only.** *Cost:* breaks under reorder, which is the
   entire point of keyed reconciliation. *Buys:* nothing here; listed so it is
   rejected explicitly rather than by omission.

**Options for (3) — manifest shape.**

1. **Two new union members**, `{ kind: "list" }` and `{ kind: "branch" }`.
   *Buys:* each carries only its own fields.
2. **One member**, `{ kind: "structural", mode: "list" | "branch" }`. *Buys:* a
   single fence predicate (`kind === "structural"`) rather than two that can
   drift apart.

---

**Recommendation.**

**(1) Option 3 — per-instance owners under a region owner.** Option 1 is a known
leak. Option 2 is *insufficient for the primary use case*: the milestone is
named for keyed lists, and a region-level owner cannot dispose a single removed
row. Option 3 subsumes branch replacement as the one-instance case, so we build
one mechanism instead of two. **This overrules the provisional lean recorded in
the spec**, which should be updated on ratification — that lean predates face 1
and reads as though branch replacement were the shaping case.

Concretely: disposal is driven from the same computation that produces the
reconciler's removals, so "dropped from the DOM" and "owner disposed" are
derived from one list rather than kept in agreement by convention. That is the
structural-vs-guarded distinction that closed `DQ-099` and the M4 install race —
the two prior cases where an invariant maintained by convention turned out to be
violable.

**(2) Option 2 — `data-af-key`, with a fail-closed diagnostic.** The slope gate
is the binding constraint and Option 1 pushes directly on it. A row whose root is
not a single element gets a named collect diagnostic and the list ships
non-resumable, consistent with every other fence in this subsystem.

The residual risk, stated plainly: this makes a single element root a
**load-bearing authoring constraint**, and I do not know how often real lists
violate it. **What would settle it:** run the 8c density-24 fixture with per-row
markers and read the measured slope. If markers come in under 1.10, Option 1 is
strictly more general and I would switch to it.

**(3) Option 2 — one `structural` member with a `mode` field**, so the fence
predicate stays single-sited. The v4 → v5 bump is real but low-risk: buildId is
enforced at seven sites, so a stale client cannot silently misread a v5
manifest — it fails closed and falls back, which is the M7 audit's headline
negative result.

**What I did in the meantime.** Nothing was assumed. Face 1 shipped on its own
merits — `dom.reconcileArrays` is correct and useful independently of this
question — and both structural specs remain `unbuilt(...)`. No region
representation, target kind, or owner type has been added to the source.

---

## Project fit — revision to the recommendation (2026-08-11)

Re-reading the recommendation against this repo's own conventions rather than
against the problem in the abstract changes one answer materially and sharpens
another. Recorded as a revision rather than an edit, because the first version
was already committed.

### The region owner must be a `Scope`, not a reactive `Owner`

The wording above ("per-instance owner", `Map<key, Owner>`) is **off-style, and
in a way this codebase has already been burned by**. `Resume.ts` is Scope-first
throughout — `Scope.addFinalizer` at `:2197`, `:2204`, `:2218`, `:3634` and
`Scope.close` at `:2429`, `:3767`, `:3840` — and the M6 audit's most notable
clean finding was precisely that *"no reactive-owner-vs-`Scope` leak exists in
the M6 paths"*, at a point when three such leaks had been found elsewhere the
same day. The recurring defect signature this session was **cleanup attached to
the reactive owner instead of the `Scope`**, which is what made
`Element.on`, `collection().observeEach`, `setAttr`, and `setStyle` leak.

So: **each row/branch instance gets a child `Scope`**, created under the
installation's Scope, with content subscribers registering via
`Scope.addFinalizer` and removal closing it with `Scope.close`. This is not a
cosmetic renaming — it is what makes requirement and error types bubble through
the region the way they already bubble through components, behaviors, routes,
and local layers, and it is what lets a region's cleanup participate in the
same interruption and exit semantics as everything else in the subsystem.

The reactive owner still has a job (tracking reads), but it is not the
disposal authority. That separation is the project's existing position; the
first draft of this recommendation quietly departed from it.

### The single-element-root constraint should be a compile error, not just a
### runtime fallback

The repo's stated diagnostics rule is that **compile-time safety is preferred
for library-authored code, with runtime diagnostics for generated/dynamic
attachments**. The Babel plugin already enforces exactly this class of
constraint and does it well: the M7 audit found its rejector "not naive",
issuing **code frames** for `onClick`, `on:click`, whole `style`, `classList`,
spread, `href`/`src`, `prop:*`, `ref`, component props, and member elements.

`data-af-key`'s requirement — every row has exactly one element root — belongs
in that same rejector for authored JSX, with the collect-time diagnostic
retained only for the dynamic/generated path. That materially reduces the
residual risk flagged above: the load-bearing authoring constraint stops being
a silent fallback discovered in production and becomes a build failure with a
code frame pointing at the row.

It does not remove the need for the slope measurement, which is still what
decides between `data-af-key` and per-row markers.

### The manifest recommendation is unchanged, and plugs into existing machinery

One `structural` member with a `mode` field remains right, and it fits better
than the first draft argued: `Resume.ts:262-275` already carries a
**compile-time exhaustiveness device** for expression-target names
(`_AttributeNamesCoverSchema` / `_StyleNamesCoverSchema`, asserted through a
`void`-ed const). A new union member should extend that device rather than
introduce a parallel one — the same pattern as `RouteDecorationFields`'
exhaustiveness assert. Two separate `list`/`branch` members would need the
coverage check duplicated, which is how the attribute allowlist ended up in
three copies with only two compile-time linked.

### Net

Recommendation (1) changes from *per-instance `Owner`* to **per-instance child
`Scope`**, driven off the reconciler's removal list. Recommendations (2) and (3)
stand, with (2) strengthened by moving its constraint into the compiler's
existing rejector and (3) grounded in the existing exhaustiveness device.

**Related.** `DQ-010` (deferred this milestone, and mis-ratified face 1 as "just
expose it" — see the correction in `RESUMABILITY_M8C_PLAN.md`), `DQ-002`
(`ExpressionOutput` widening is *not* a wire change; this is), `DQ-099` and the
M4 install race (both structural-vs-guarded precedents), and M8c.7's payload
gates.

---

## Measurement result — per-row markers win (2026-08-11)

DQ-030 recommendation (2) was ratified with an explicit escape clause: *"run the
density-24 fixture with per-row markers and read the measured slope. If markers
come in under 1.10, Option 1 is strictly more general and I would switch."*

**Measured. They come in far under. Switching to per-row markers.**

### Method

An env-gated lane (`AF_BENCH_ROW_MARKERS=1`) wraps every resumable row in a
comment pair shaped like the proposed markers (`<!--af:row:x<n>:s-->` / `:e`).
Two arms, same session, same machine, 3 runs each, compared as a **paired
delta** rather than as a re-pin of the recorded baseline — the absolute heap
figures here do not reproduce the checked-in 5-run baseline, so only the
difference between the two arms is claimed.

`data-af-key` needs no lane: these rows already carry a
`data-expression-index` attribute, so its cost is already inside the baseline.

### Result

| metric | baseline | + row markers | delta |
| --- | ---: | ---: | ---: |
| **slope** (ceiling **1.10**) | 0.6648 | **0.6840** | +0.0192 |
| fixed gap (ceiling 204,800) | 49,636 | 50,404 | +768 |
| dormant heap growth 1→24 | 26,184 | 26,940 | +756 |
| eager heap growth 1→24 | 39,384 | 39,384 | 0 |
| attribution net growth | 26,044 | 26,848 | +804 |
| document raw bytes @24 | 12,019 | 12,911 | +892 |
| document gzip bytes @24 | 1,616 | 1,766 | +150 |

**Per row: 37.2 B raw, 6.2 B gzipped, 35 B retained heap.**

Slope headroom remaining after markers: **0.4160**. Markers consume about
**4.7%** of the available headroom — dormant per-row cost would have to rise by
roughly 745 B/row to reach the ceiling, and markers cost 35 B. The same
direction and magnitude appeared in an earlier single-run pass (0.6665 →
0.6843), so this is not one noisy sample.

Gzip is where the intuition was most wrong: repeated comment markers compress
to **6.2 bytes per row**, because they are near-identical strings.

### Consequence — the ratified design changes

**Per-row identity is now marker comments, not `data-af-key`.**

This *removes* work rather than adding it. The `data-af-key` option required
every row to have exactly one element root, which was going to be enforced by a
new rejection in the Babel plugin plus a collect-time diagnostic and a
non-resumable fallback for the dynamic path. Markers work for rows that are
text, fragments, or several top-level nodes, so:

- the **single-element-root constraint disappears entirely** — it was the one
  load-bearing authoring constraint in the design, and the risk flagged when it
  was ratified ("I do not know how often real lists violate it") is now moot;
- **Milestone 8d loses its compiler work item**;
- the "no single element root" collect diagnostic and fallback are no longer
  needed.

Recommendations (1) per-instance child `Scope`s and (3) one `structural`
manifest member at v5 are **unchanged**.

### What this measurement does not cover

- **The per-row `Scope` is not measured.** Both options need it equally, so it
  cancels in the delta — but it means the 35 B/row figure is the *marker* cost,
  not the total per-row cost of a structural region. The real per-row cost will
  be higher, and the slope should be re-read once faces 2 and 3 are built.
- **24 rows is a small list.** Slope is a ratio of growths measured between
  densities 1 and 24; a 10,000-row table is outside the fixture's range. The
  linear extrapolation (35 B/row) is the honest thing to quote, not the ratio.
- **Correction: the 1.10 slope gate was always automated.** An earlier note here
  claimed it was not. That was wrong. `verify.mjs` has always enforced
  `resumedGrowth <= eagerGrowth * 1.1`, and `run.mjs` calls it on every run, so
  a violation has always failed the benchmark. The claim came from grepping for
  `slope`, `1.10`, and `204800` and finding nothing — the code used the literals
  `1.1` and `200_000` and the phrase "110% of eager growth". **A search that
  misses is evidence about the search, not about the code.**

  What *was* genuinely wrong is now fixed: the thresholds are named
  (`SLOPE_CEILING`, `FIXED_GAP_CEILING_BYTES`) so they are greppable; the gate
  reports its computed value on success instead of only throwing on failure, so
  a decision like DQ-030's reads the number instead of recomputing it by hand;
  the numbers are persisted to `result.gates` in the artifact and declared in
  `result.schema.json`; and the two silent skips — no heap measurement, and the
  fixed-gap budget off its calibrated environment — now print `SKIPPED` with a
  reason. A run with no heap data used to pass as cleanly as one that met every
  budget.

The measurement lane stays in the fixture, env-gated and off by default, so this
comparison is repeatable rather than a one-off number in a document.
