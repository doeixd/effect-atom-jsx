# Rename: effect-atom-jsx → Affe

Date: 2026-07-29
Status: decided (name + identity); migration not yet scheduled

## Decision

The project is renamed **Affe** (German: monkey/ape — pronounced "AH-fuh"),
with a monkey mascot owned deliberately. Package publishing moves to the
scoped org **`@affe/*`**.

Why the old names failed:

- `effect-atom-jsx` reads as a bindings shim between three other things; it
  undersells a full framework and buries the actual differentiators.
- `AF-UI` sounds like a component catalog, which the project is not.
- `Affect`/`Aff` were considered and rejected: the affect/effect homophone
  makes spoken conversation ambiguous with the library's own dependency, and
  `Aff` collides with PureScript's well-known async effect monad for exactly
  the FP-literate audience this project targets.

Why Affe works:

- **The metaphor is the architecture.** A monkey doesn't climb the whole
  tree — it swings straight to the branch it needs. That is the resumability
  model: no component-tree replay, load only what the interaction touches.
  Tagline: *"Affe doesn't climb the whole tree."* Instant reaction when
  poked = first interaction without hydration.
- **Lineage stays visible.** Affe/Effect share the sound and the `af`
  prefix — and the wire format already says it: `data-af-event-*`,
  `data-af-replay-*`, `af:component:*`/`af:expr:*` markers, `data-af-resume`,
  and the ratified `af:binding:*` reactivity namespace all read as "Affe"
  retroactively. No wire-format rename is needed, ever.
- **Deliberate beats accidental.** As a stumbled-into German word, "Affe"
  would invite giggles; as a mascot-first identity (Go's gopher, Docker's
  whale, PHP's elephant), the joke lands as intended for German-speaking
  users — a significant slice of the Effect community.
- Unique, short, pronounceable (one README cue), and image search becomes
  ours the moment a logo exists. Monkey emoji (🐒, 🙈🙉🙊) are unowned in
  the framework space.

## Names and namespaces

| Thing | Name |
| --- | --- |
| Project/brand | Affe |
| npm packages | `@affe/core` (runtime), `@affe/compiler` (Babel/Vite transform), future splits as needed (`@affe/router`?) — bare `affe` is squatted by a dormant 0.0.4 package; a name dispute can be attempted but is not load-bearing |
| JSX import source | `@affe/core/jsx-runtime` |
| Wire prefixes | unchanged (`af:*`, `data-af-*`) — already correct |
| Vite virtual module | `virtual:af-resume-entries` — unchanged |
| Plugin names | `af-ui-resume-extract` → `affe-resume-extract` (cosmetic, rename during migration) |
| Docs identity | "AF-UI" wording in docs migrates to "Affe"; the AF-UI architecture contract keeps its filename with a rename note |
| Domains | `affe.dev` / `affe.js.org` have DNS records (verify ownership options); `affejs.dev` and `affe.build` appeared unregistered at decision time — `affe.build` preferred |

## Migration outline (when scheduled — deliberately not now)

The rename should land as one dedicated change-set, not interleaved with
milestone work:

1. Reserve the npm org and packages (`@affe/core`, `@affe/compiler`) and the
   chosen domain immediately — reservation is cheap and independent of
   migration.
2. Package rename with `effect-atom-jsx` kept publishing as a deprecation
   alias re-exporting `@affe/core` for a transition window (prerelease
   audience, so the window can be short).
3. Internal identifiers: symbol keys (`Symbol.for("effect-atom-jsx/...")`)
   and Schema brand strings (`@effect-atom-jsx/...`) are observable
   behavior. Rename them to `affe/...` in the same change-set as the package
   rename — prerelease rules apply, but it must be one atomic break, and
   resume manifests' build-ID gating makes it deploy-safe by construction.
4. Docs/README/examples sweep; add the pronunciation cue and mascot.
5. Repo rename with GitHub redirect.

Explicitly deferred: nothing in the current milestone work (M8a, M9) blocks
on or waits for the rename. Wire formats and the `af` prefix are already
final.

## Open items

- Commission/design the monkey logo (swing/branch motif preferred over a
  face; it should read at 16×16 favicon size).
- Verify `affe.dev` ownership status vs. buying `affe.build`.
- Attempt the npm dispute for bare `affe` (non-blocking).
- Decide the transition window for the `effect-atom-jsx` alias.
