# Resumable extract example

Executed proof for Milestone 7 compiled authoring and Milestone 8b dormant
text restoration: the server component in
[`app/note-button.ts`](app/note-button.ts) declares its portable action with
the `extract(...)` marker and its count text with `expr(...)` — no hand-written
code identity, build stamp, resolver table, or generated export.

The pieces:

- [`vite.config.ts`](vite.config.ts) enables
  `resumeExtract` from `effect-atom-jsx/compiler/resume-extract-vite`. The
  transform hoists the marker into an exported `Portable.code` with the
  generated identity `app/note-button.ts#$0` and serves
  `virtual:af-resume-entries` with a lazy loader per generated definition.
  `sourceModules` lists modules reachable only through the virtual module so
  their entries exist on a fresh build.
- [`build.mjs`](build.mjs) server-renders through `Resume.collect` (the SSR
  module is transformed by the same plugin, so server descriptor and client
  resolver agree on the identity) and injects the HTML + manifest into
  [`index.html`](index.html).
- [`client/bootstrap.ts`](client/bootstrap.ts) decodes the manifest and calls
  `Resume.installClient` with the virtual resolver entries. It exposes the
  low-level dormant-state write hook used by the browser proof and counts
  actual resolver loader calls.
- [`../../browser-tests/resumable-extract.spec.ts`](../../browser-tests/resumable-extract.spec.ts)
  proves in Chromium: generated action/expression identities survive the
  build, the chunk stays unloaded until the first click or state invalidation,
  concurrent clicks share one request, a dormant write patches only the
  existing count text node, component/parent/sibling setup and views remain
  unexecuted, and disposal stops dispatch and patching.

Run it via the repository gate:

```bash
npm run test:browser
```

or serve it directly after `npm run build && npm run build:extract-example`
with `npm run preview:extract-example` (port 4178).
