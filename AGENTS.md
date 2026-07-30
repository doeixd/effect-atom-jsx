<!-- OPTMEM:START -->
## Memory

Your memory is OptMem:
- The tool is `& "C:\Users\Patrick\.optmem\memo.cmd"`
- Each automatically detected project has its own memory
- One global memory, `~\.optmem\memory`, follows you into all of them

OptMem outlives every session, compaction, model and vendor change.
Without it you do not know who you are, or what was decided and tried.

### Mental model

Each scope is an append-first log. `note` adds one raw memory with a stable
`#ID`; raw memories remain the source of truth. Later memories may cite earlier
`#IDs` when that makes a durable fact or decision unambiguous. `amend` appends a
corrected replacement; `retract` appends that an earlier memory is no longer
authoritative. The earlier record remains useful history. Only explicit,
user-directed `redact --force` rewrites a raw payload, to erase sensitive text.
Adjacent memories are also represented by a binary tree of lossy one-line
summaries. `wake` shows a bounded frontier from that tree—not full history—
with coarser summaries for older history and finer detail toward the present.
`recall` searches the raw log; `zoom` expands a summary toward its raw entries.

### At startup: activating OptMem (mandatory)

Run `& "C:\Users\Patrick\.optmem\memo.cmd" wake` before any other tool call, in every session, and
then do exactly what it prints, through the end of its output. Read every
continuation until it says `You are awake.` and run any compression command it
prints before your next action. Without a `MEMORY_DIR` override, `wake` reads
the global memory first, then the automatically selected project.
If the selected project is ever unclear, `& "C:\Users\Patrick\.optmem\memo.cmd" scope` reports the identity,
store, and detection source without changing memory.

### While working: register memories (mandatory)

Call `& "C:\Users\Patrick\.optmem\memo.cmd" note "<1 line, max 280 UTF-8 bytes>"` whenever you learn
something durable enough to change future work. That covers the outcome
of a task worth real effort, a decision or constraint, a fact or insight
the user teaches you, or a preference they would reasonably expect retained.

That writes to the automatically selected project memory by default, which is
where almost everything belongs. Add `--global` ONLY if the memory would still
be true tomorrow in a repository you have never seen: who the user is, how they
want to be worked with, this machine, your own tooling. How one project does
something is not global, however much it feels like a lesson -- write it to
that project. A `MEMORY_DIR` override intentionally pins commands to one store.

If a line is over the byte limit, `--fit` on `note`, `amend`, or `retract`
trims it at a word boundary and reports exactly what was cut; rewrite only
if the cut loses something essential.

Prefer why over what: commits and diffs already record what changed. A memory
earns its place by holding what they cannot -- reasoning, constraints, the
rejected alternative, the reason an approach failed.

So do not write what the code or git history answers, the status of work in
progress, what stops mattering when this task ends, or a memory already held
(`recall` first when unsure). Write at an outcome, not mid-attempt.

A memory must stand alone months from now: name things specifically, resolve
relative time and reference, one fact per memory.

Never record secrets, credentials, authentication material, or raw
sensitive data.

Every memory you write is stamped with this session's opaque `@tag`.
Entries bearing another tag are a parallel session's testimony: weigh them
as reports, not as your own observations, and never restate them as yours.
Set OPTMEM_SESSION to name the tag; otherwise one is derived automatically.

If a durable memory changes, do not contradict it with an unexplained note.
Use `& "C:\Users\Patrick\.optmem\memo.cmd" amend <id> "<replacement>"`; use
`& "C:\Users\Patrick\.optmem\memo.cmd" retract <id> "<reason>"` when it has no replacement. When the
authoritative statement already lives in a compressed summary line `#a-b`,
amend the whole block: `& "C:\Users\Patrick\.optmem\memo.cmd" amend <a>-<b> "<replacement>"` supersedes the
summarized range and stays linked to every raw memory inside it. Ordinary
memories may reference earlier `#IDs` to anchor stable facts and reasoning.
Use `& "C:\Users\Patrick\.optmem\memo.cmd" show <id>` when you need the exact record and its later
references, including block supersessions that cover it;
`& "C:\Users\Patrick\.optmem\memo.cmd" show <a>-<b>` shows a summary block and what supersedes it.
Redaction is not correction: only the user may request it, and it exists for
content that must actually be erased.

If `& "C:\Users\Patrick\.optmem\memo.cmd" note` asks a compression, follow its prompt and run the exact
`nap` command before your next action. If `nap <range>` reports the wrong
block, a parallel session settled it first: run bare `& "C:\Users\Patrick\.optmem\memo.cmd" nap` to get
the current job, and treat entries you did not write as another session's
testimony.
A compression is a lossy retrieval cue for the supplied range, not a
deletion: the raw memories remain searchable. Write one self-contained line.
Preserve durable decisions, outcomes, constraints, causal links, preferences,
and useful failure reasons. Drop transient status, incidental chronology, and
repetition. Use specific names; invent nothing and never imply a link between
unrelated facts. Later amendments, corrections, and retractions override the
records they reference. Preserve the final outcome; retain the earlier account
only when its history or failure reason remains useful.

Never edit or delete a memory directory: the tool manages it.

### When you need an old memory: search, or navigate

`& "C:\Users\Patrick\.optmem\memo.cmd" recall <regex>` searches the complete raw log with a case-insensitive
regular expression and, when `fff-search` is installed, retries a zero-result
search fuzzily. Use
`& "C:\Users\Patrick\.optmem\memo.cmd" recall --fuzzy "<text>"` to request typo-tolerant FFF recall
directly. Add `--limit N` to cap returned matches and `--context N` to
include neighboring raw memories; these control output without reducing the
history searched. Recall and `zoom` target project memory by default; put
`--global` before the command for global memory.
If QMD was explicitly enabled for this scope, use
`& "C:\Users\Patrick\.optmem\memo.cmd" recall --semantic "<meaning>"` for meaning-based raw-memory recall;
add `--fast` to skip reranking for repeated related searches. QMD can also be
configured as the last fallback after exact and fuzzy recall both miss.

A `#a-b` line from `wake` is one summary node covering raw memory IDs
`a` through `b`. `& "C:\Users\Patrick\.optmem\memo.cmd" zoom <a-b>` opens one level; add `--depth N`
to open up to six levels in one bounded call. Repeat until the relevant
raw memories appear.

### If you're a subagent: skip everything above

Parallel sessions on this machine are all you, and may all write memories.
A subagent is not: it must never run `memo`, because it cannot judge what
is already known, and its notes would arrive duplicated and incorrectly.
When you spawn one, write: `You are a subagent. Don't run memo.`
The parent agent remains responsible for recording the durable outcome.
<!-- OPTMEM:END -->

# Agent Notes

This repository is `effect-atom-jsx`, a runtime JSX and Effect-based reactive UI library. Current work is converging it toward the AF-UI vision: an inside-out UI framework where components expose typed structural slots, and styles, behaviors, routing, reactivity, hydration, and server routes compose around those slots.

## Source Of Truth

Use these documents first:

- [`docs/AF_UI_CONTRACT.md`](docs/archive/AF_UI_CONTRACT.md) — canonical AF-UI architecture contract.
- [`docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md`](docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md) — current implementation status and backlog.
- [`future/README.md`](future/README.md) — the finished design as executable specs; `npm run test:future` is the remaining-work list.
- [`docs/ARCHITECTURE_REFERENCE.md`](docs/ARCHITECTURE_REFERENCE.md) — cross-cutting reference for typed views/slots, templates, components, actions/queries.
- [`docs/AGENT_NATIVE_NOTES.md`](docs/AGENT_NATIVE_NOTES.md) — agent-facing action catalog / MCP / generative-UI design from existing primitives.
- [`docs/SLOT_CONTRACT_UNIFICATION_PLAN.md`](docs/archive/SLOT_CONTRACT_UNIFICATION_PLAN.md) — current slot unification record; `View.Slots` is the canonical authored slot contract.
- [`docs/PROPS_BINDINGS_SLOTS.md`](docs/archive/PROPS_BINDINGS_SLOTS.md) — ownership model for caller props, setup bindings, and public slots.
- [`docs/BINDINGS_ASYNC_COMMIT_BOUNDARY.md`](docs/archive/BINDINGS_ASYNC_COMMIT_BOUNDARY.md) — bindings as the component-level async commit boundary.
- [`docs/SLOT_WITNESS_PLAN.md`](docs/archive/SLOT_WITNESS_PLAN.md) — historical slot witness plan; useful background, but `View.Slots` / slot contracts are the current authored API.
- [`docs/TYPED_VIEW_TREE_PLAN.md`](docs/archive/TYPED_VIEW_TREE_PLAN.md) — typed renderer-neutral tree plan.
- [`docs/GEN2_UI_IMPLEMENTATION_NOTES.md`](docs/archive/GEN2_UI_IMPLEMENTATION_NOTES.md) — notes from `../gen2` UI IR implementation and what can be adapted here.
- [`docs/ROUTER_ARCHITECTURE_IMPLEMENTATION_PLAN.md`](docs/archive/ROUTER_ARCHITECTURE_IMPLEMENTATION_PLAN.md) — route-node, server-route, and runtime architecture notes.
- [`docs/DESIGN_STYLING_BEHAVIOR_SYSTEM.md`](docs/archive/DESIGN_STYLING_BEHAVIOR_SYSTEM.md) — broader design narrative.
- [`docs/RUNTIME_ROUTING_REACTIVITY_SYSTEM.md`](docs/archive/RUNTIME_ROUTING_REACTIVITY_SYSTEM.md) — runtime, routing, reactivity, single-flight, hydration vision.

When older exploratory docs conflict with `docs/archive/AF_UI_CONTRACT.md`, the contract wins.

## Current Architecture Direction

The target core shape is:

```ts
Component<Props, Req, E, Bindings, SlotContract> -> View<Slots>
```

Important boundaries:

- `Bindings` are logical state created during setup.
- `Props` are caller-owned configuration.
- `Bindings` are setup-created implementation state.
- Bindings should be treated as the committed setup snapshot: setup collects
  dependencies/resources, then the view renders from committed bindings, then
  style/behavior effects attach.
- `View.Slots` is the canonical authored slot contract.
- `Component.SlotsOf<T>` is the runtime handle-map projection.
- `Component.SlotContractOf<T>` is the authored slot contract metadata axis.
- `Component.withSlots(...)` publishes a `View.Slots` contract on a component.
- Styles and behaviors attach from outside the component.
- Slot-contract APIs are the authored path: `Style.forSlots(...)`, `Style.attachToSlots(...)`, `Behavior.forSlots(...)`, `Behavior.attachToSlots(...)`.
- String slot maps are dynamic/generated APIs.
- Requirement and error types should bubble through components, behaviors, routes, and local layers.
- Web is the concrete runtime today, but component/style/behavior types should avoid DOM-only coupling.

## Current Implementation State

Current AF-UI implementation state:

- `Component.Component` has an explicit fifth `SlotContract` type axis.
- `Component.SlotContractOf<T>` extracts authored slot contract metadata.
- `Component.SlotsOf<T>` extracts the runtime handle-map projection.
- `Component.withSlots(...)` publishes `View.Slots` metadata on a component.
- Behavior/style slot attachment paths preserve component slot contract metadata.
- Runtime views can return JSX-like `unknown` or explicit `View<Slots>`.
- `View.Slot`, `View.Slots`, `View.fromSlots(...)`, typed tree helpers, hidden slots, remaps, diagnostics, and pipeable `View<Slots>` transforms are implemented.
- `Component.setup<Props>()`, `Component.bind(...)`, `Component.value(...)`,
  `Component.doEffect(...)`, and `Component.use(...)` provide the preferred
  named setup-builder authoring path when it improves readability.
- `Atom.ResultAtom<A, E, R>` is the canonical named alias for result-valued
  atoms. `Atom.AsyncAtom` remains only as a compatibility alias.
- Existing slots may still appear in `bindings.slots`; new authored APIs should
  prefer explicit `View.Slots` contracts and `Component.withSlots(...)`.

The current implementation follow-up is documentation/example modernization and
remaining type metadata propagation. Slot contract unification is closed for
now; declared-vs-rendered slot diagnostics are explicit-only.

## Gen2 Notes

`../gen2` has useful UI IR implementation in [`../gen2/src/ui/ui.ts`](../gen2/src/ui/ui.ts) and [`../gen2/src/gen/ui-backends.ts`](../gen2/src/gen/ui-backends.ts), plus the related UI docs and tests:

- [`../gen2/gen-ui-implementation-plan.md`](../gen2/gen-ui-implementation-plan.md)
- [`../gen2/docs/spec.md`](../gen2/docs/spec.md)
- [`../gen2/tests/ui.test.ts`](../gen2/tests/ui.test.ts)
- [`../gen2/tests/ui-generic.test.ts`](../gen2/tests/ui-generic.test.ts)
- [`../gen2/tests/ui-attachment.test.ts`](../gen2/tests/ui-attachment.test.ts)

The useful UI pieces are:

- `ElementCapability`
- `Slot`
- `View`
- `Component`
- `Style`
- `Behavior`
- style/behavior attachment validation
- hidden slots
- slot remapping
- platform/renderer metadata
- `SafeHtml`
- `checkUi` diagnostics

Do not copy it wholesale. It is a static/generator IR. This repo needs runtime-native primitives that work with Effect, atoms, scopes, JSX runtime output, and existing `Element.Handle` values.

Portable ideas from gen2:

- slot metadata records
- hidden slots
- slot remapping
- safe HTML branding
- platform/event/style diagnostics
- runtime validation for dynamic/generated attachments

For the route side, see the routing references in `../gen2/tests/router.test.ts`, `../gen2/tests/router-pass.test.ts`, `../gen2/atom_plan.md`, and `../gen2/atom_plan_continuation.md`.

Avoid porting directly:

- `View.structure: string`
- `Component.props_type: string`
- `Component.bindings: readonly string[]`
- `Behavior.body: string`
- generator namespace APIs as runtime APIs

## Development Commands

Use the existing npm scripts:

```bash
npm run typecheck
npm test
npm run build
```

Before finishing implementation changes, run:

1. `npm run typecheck`
2. `npm test`
3. `npm run build`

For narrow doc-only changes, typecheck/build are usually unnecessary unless source files changed.

## Undecided Design: `docs/design-questions/`

When the design itself is not settled — an API shape you'd have to invent, a plan
claim that contradicts the code, a guarantee that turns out not to hold,
semantics nobody pinned down — **write it down there instead of guessing.** Read
[`docs/design-questions/README.md`](docs/design-questions/README.md) for the
entry shape.

Two modes govern who may change what:

- **Discovery mode** (the default for implementation, spec-writing, and research
  work): you may **always** append to `docs/design-questions/`, and you may
  **never** edit a plan document's decisions. Write to
  `inbox-<YYYY-MM-DD>-<lane>.md`, named for your own run so concurrent agents
  cannot conflict.
- **Ratification mode** (only when explicitly delegated): you are given one named
  document to own plus already-reviewed findings, and may edit that document's
  decisions. Nobody else edits it during your run.

The line is **proposing vs ratifying**. An agent that can silently edit a plan can
silently ratify its own invention.

Non-negotiables:

- **Declare a provisional pick.** If you proceeded by choosing a shape, say so
  explicitly and say where it now appears. An undeclared provisional pick
  launders a guess into apparent consensus and is the worst outcome in this
  workflow.
- **If you have a good answer, propose it** — options with tradeoffs and a
  recommendation. A recommendation is not a decision; it is what a reviewer
  ratifies or overrules. Design reasoning belongs in a document, not in a final
  report that nobody can grep.
- `unbuilt(what, "DQ-nnn")` in a spec links it to the written question. About to
  write `unbuilt(...)` with neither a `DQ-nnn` nor a plan item? Write the inbox
  entry first.
- Triage happens **before starting a phase**, and a `blocking` entry blocks that
  phase.

Distinction to keep straight: `future/` is *known target, not built*;
`docs/design-questions/` is *target not known*.

## The `future/` Specification Suite

`future/` holds executable specifications of the **finished** design — spec, QA,
and red-green TDD in one folder. Read [`future/README.md`](future/README.md)
before touching it; it is the authority on the contract.

```bash
npm run test:future          # the remaining-work list, as failing specs
npm run test:future:watch    # while implementing a milestone
npm run typecheck:future     # hygiene of the specs themselves (must stay green)
```

The rules that matter most:

- **A red spec is a work item, not a regression.** This suite is expected to be
  partially red. It is deliberately excluded from `npm test` (which only globs
  `src/__tests__/**`) and from `npm run typecheck:all` (which only includes
  `src/**`). **Never wire `future/` into `npm run check`, `npm test`, or CI's
  blocking gates** — the moment it can fail the build, it stops being usable as
  a forward specification.
- **Implementing a milestone means turning its specs green.** Start work by
  reading the red specs for the plan item you are about to build; they are the
  acceptance criteria.
- **When every spec in a file goes green, promote that file** (the unit is the
  file, not the spec): move it to `src/__tests__/<name>.test.ts`, refactor it to
  house style — drop the `loadSrc`/`fromSrc` harness in favour of direct
  module-scope imports now that the APIs exist, and adopt the surrounding
  fixture/layer conventions — then **expand it** to cover the API surface
  properly (every overload and option, boundary and error and interruption
  paths, concurrency, disposal, plus a companion type test in
  `src/type-tests/`). Keep the plan-item tag on the top-level `describe`. The
  folder is a debt ledger that should shrink, not an archive. Partially-green
  files stay in `future/`.
- **Never import `src/` at module scope in a spec.** Use `loadSrc`/`fromSrc`
  from `future/harness.js` inside the spec body, so a missing API fails one spec
  instead of aborting the whole file at collection time.
- **No vacuously green specs.** Asserting that an export exists proves nothing.
  Specs execute behaviour and assert outcomes, favouring negative guarantees
  (exactly once, nothing else loaded, fails closed, no cross-request bleed).
- Every spec name is prefixed with the plan item that owns it (`[M8c.4]`,
  `[R5]`, `[AN-1]`, `[K1]`), so a red run maps straight onto `docs/`.

Folder layout mirrors the plans: `resumability/`, `streaming/`, `router/`,
`result/`, `components/`, `agent/`. Note that `future/` intentionally does **not**
live inside `src/__tests__/` and must not be symlinked into it — co-locating it
would pull it into the main suite and destroy the green-gate guarantee.

## Coding Rules For This Repo

- Prefer existing patterns in `src/Component.ts`, `src/Behavior.ts`, `src/Style.ts`, `src/Element.ts`, and route/reactivity modules.
- This is prerelease redesign work. Prefer the coherent final API over backwards
  compatibility when the two conflict.
- Preserve callable atom and Effect-native APIs.
- Add type tests when changing public type behavior.
- Use compile-time tests for slot compatibility, requirement bubbling, and inference regressions.
- Keep runtime tests focused on actual behavior: cleanup, invalidation, loader refresh, hydration, and attachment lifecycle.
- Do not revert unrelated user changes.

## UI/Slot Migration Guidance

When working with `View<Slots>`:

- Keep current JSX authoring valid.
- Prefer `View.Slots` plus `View.fromSlots(...)` for authored slot-bearing
  views; keep `View.make(slots, node)` as the lower-level/dynamic constructor.
- Do not require a JSX compiler rewrite in the first slice.
- Preserve `Component.SlotsOf<T>`.
- Move authored APIs away from `bindings.slots` conventions while introducing
  explicit view metadata.
- Add type coverage showing style/behavior attachments can target `Component.SlotsOf<T>`.

When working on slot contract APIs:

- Prefer `View.Slots` as the single authored slot contract object.
- Use `Component.withSlots(...)` as the canonical public helper.
- Use `Component.SlotContractOf<T>` as the canonical extraction helper.
- Preserve both `Component.SlotsOf<T>` and slot contract metadata across
  wrappers.
- Add diagnostics for declared-vs-rendered slot drift.

When adding diagnostics:

- Compile-time safety is preferred for library-authored code.
- Runtime diagnostics are still useful for generated/dynamic attachments.
- Gen2 `checkUi` is a good checklist for diagnostics, but this repo should expose runtime-native helpers.

## Git/Workspace Notes

There may be unrelated or pre-existing changes in the worktree. Do not reset or revert them unless explicitly asked.

Known recent untracked path observed during AF-UI work:

- `docs/af-ui-json-render/`
