# Design questions — the inbox for undecided design

This directory is where an **undecided design question gets written down instead
of being invented, guessed at, or lost in an agent's report.**

It exists because the loss channel is real: every genuinely valuable design
insight from the `future/` specification round arrived inside an agent's final
report, which is ephemeral. Some of it survived only because it was transcribed
by hand. This directory makes writing it down the cheap, sanctioned option.

## What belongs here

Anything that blocked or bent your work because **the design itself isn't
settled**:

- an API whose shape you had to invent to write a spec or a call site
- a plan claim that contradicts the code (or another plan)
- a guarantee we assert that you discovered does not hold
- semantics nobody has pinned down (what does *absence* mean? what happens when
  the sink is down? which of two paths wins?)
- a decision the plan explicitly defers, where you now have new information or a
  concrete proposal

## What does NOT belong here

- **Not-yet-implemented work whose target is already decided.** That is
  `future/` — a red spec is the record. Use this directory only when the
  *target itself* is unknown.
- **Bugs where the design is clear and the code is wrong.** Those go to the
  owning plan or `DESIGN_IMPROVEMENT_NOTES.md` as defects.
- **Anything you can answer by reading the source for five minutes.** Read it.

The distinction that matters: `future/` = *known target, not built*. This
directory = *target not known*.

## The two agent modes

**Discovery mode** — the default for any agent doing implementation, spec
writing, or research.

- You may **always** append to this directory.
- You may **never** edit a plan document's decisions.
- Write to `inbox-<YYYY-MM-DD>-<lane>.md` — a file named for your own run, so
  concurrent agents never conflict.
- If you had to proceed anyway, say exactly how: `unbuilt(...)`, a softened
  assertion, or a provisional pick. **A provisional pick that isn't declared is
  the worst outcome in this whole workflow** — it launders a guess into
  apparent consensus.

**Ratification mode** — only when explicitly delegated.

- You are given one named document to own, and findings that have already been
  reviewed.
- You may edit that document's decisions. Nobody else edits it during your run.

The line is **proposing vs ratifying.** An agent that can silently edit a plan
can silently ratify its own invention, which is precisely how an invented option
name becomes canon. Keeping ratification a separate, deliberately-invoked step is
what makes it safe to let agents edit plans at all.

## Layout

| File | Contents |
| --- | --- |
| `_TEMPLATE.md` | Copy this for a new entry. |
| `resumability.md` | Triaged questions: expressions, manifests, SPI, streaming (`DQ-001`–`DQ-029`) |
| `router.md` | Triaged: routing, loaders, navigation, wire (`DQ-030`–`DQ-049`) |
| `components.md` | Triaged: slots, views, styles, behaviors, kit (`DQ-050`–`DQ-079`) |
| `platform.md` | Triaged: agent catalog, result/serialization, identity, cross-cutting (`DQ-080`–`DQ-099`) |
| `inbox-*.md` | Raw, untriaged submissions from discovery-mode runs. |

Two tiers on purpose: **inbox** is append-only and conflict-free so writing is
frictionless; the **lane files** are the triaged, deduplicated, ID-assigned
queue you actually work through. Triage moves entries from the first to the
second and assigns the ID.

ID ranges are pre-partitioned per lane so parallel agents can assign IDs without
colliding. Never renumber an existing entry — its ID may be referenced from a
spec.

## Linking a question to the specs it blocks

`future/harness.ts`'s `unbuilt(what, owner)` takes a `DQ-nnn` id as its `owner`
whenever the question lives here rather than in a plan:

```ts
unbuilt("dom.renderToStream", "DQ-014");
```

The harness recognises the `DQ-nnn` form and renders the failure as *blocked on
open design question DQ-014*, so a red spec traces to a written argument instead
of a bare string. Pass a plan item instead (`"M8c.4"`) when the plan genuinely
owns the decision.

This is also the deduplication mechanism. Seven `unbuilt("dom.renderToStream")`
calls are **one** question; they should all cite the same id, and the argument
lives in one place.

## Triage: the part that makes this work

An inbox nobody triages is a graveyard, and this one will fill faster than
`future/` did. The rule with teeth:

**Triage before starting a phase, and a `blocking` entry blocks that phase.**

That is the whole point. The M11 global-document blocker and the 8c.5
`ExpressionOutput` hole were both found *while writing specs* — had they been
found while implementing, they would have detonated mid-slice. Triage is where
that gets to happen on purpose.

A triage pass:

1. Reads the `inbox-*.md` files.
2. Merges duplicates, assigns IDs from the lane's range, files them into the
   lane file.
3. For each entry, either **decides it** (promote the decision into the owning
   plan, then delete the entry from here), **keeps it** with a severity and a
   recommendation, or **closes it** as not-a-question with a one-line reason.
4. Deletes the consumed `inbox-*.md` files.

Entries leave this directory when they are decided. Like `future/`, this
directory should shrink under maintenance — a growing lane file is a signal, not
an archive.

## Severity

- **blocking** — an implementer cannot start the owning slice without this. It
  blocks the phase.
- **deferrable** — work can proceed; the question must be settled before the
  surface is published or frozen.
- **cosmetic** — naming, ergonomics, consistency. Batch these.

## Writing a good entry

The failure mode is "this is unclear", which nobody can act on. A good entry is
one a reader can **decide** without redoing your investigation, so it needs the
concrete task that hit the wall, the precise unknown, what breaks without it, and
**real options with a recommendation**.

If you have a good answer, propose it. Some of the strongest design work in this
project came from an agent that hit a wall and argued for a way through — for
example, that the generated-UI IR should have *no raw-HTML node kind at all*,
which makes a security property true by construction rather than by validation.
That belongs in a document, not in a chat message.
