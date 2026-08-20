<!--
Copy one of these blocks per question.

In discovery mode: write to `inbox-<YYYY-MM-DD>-<lane>.md` and leave the ID as
`DQ-???` — triage assigns it. In a triage pass: assign the next free ID from
your lane's range (see README) and file the entry into the lane file.

Keep entries decidable by a reader who has not repeated your investigation.
-->

## DQ-??? — <one-line question, phrased as the decision to be made>

- **Severity:** blocking | deferrable | cosmetic
- **Owning plan:** `docs/<PLAN>.md` §<section> (or "none yet — needs a home")
- **Raised:** <YYYY-MM-DD>, while <the concrete task that hit this>
- **Blocks specs:** `future/<lane>/<file>.spec.ts` (`unbuilt(..., "DQ-???")`) —
  omit if no spec references it yet

**What I was doing.** The concrete task, in one or two sentences. A reader
should be able to tell whether they'd hit the same wall.

**What is undecided.** Be precise. Name the function, type, field, or semantic
rule. Quote the current source or plan text if they disagree — with `file:line`
anchors, because "somewhere in Style.ts" costs the next reader an hour.

**Why it matters.** What breaks, is unsafe, is unauthorable, or is silently
wrong without a decision. If the honest answer is "nothing yet, but it freezes
into a public surface at M9", say that — it is the difference between blocking
and deferrable.

**Options.**

1. **<Name>** — what it is. *Cost:* … *Buys:* …
2. **<Name>** — what it is. *Cost:* … *Buys:* …
3. **<Name>** — what it is. *Cost:* … *Buys:* …

**Recommendation.** Pick one and say why, or state plainly that you don't have
enough information and name what would settle it. A recommendation is not a
decision — it is the thing a reviewer ratifies or overrules.

**What I did in the meantime.** Exactly one of:

- `unbuilt("<subject>", "DQ-???")` — nothing was assumed.
- Softened an assertion to the decided part only — say which part, and what the
  spec no longer proves.
- **Picked provisionally** — say what you picked and where it now appears in
  code or specs, so ratification can confirm or unwind it. An undeclared
  provisional pick is the worst outcome in this workflow.

**Related.** `DQ-nnn`, plan items, `DESIGN_IMPROVEMENT_NOTES.md` item n.
