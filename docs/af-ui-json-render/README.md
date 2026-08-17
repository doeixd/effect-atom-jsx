# AF-UI / JSON-Render Notes

These notes were copied from `C:\Users\Patrick\gen2` as reference material for the AF-UI-style API work in `effect-atom-jsx`.

- `gen-ui.md`: high-level typed UI IR and JSON Render target notes.
- `gen-ui-implementation-plan.md`: detailed implementation plan for typed component catalogs, slots, views, and JSON Render lowering.
- `ui-dialect-af-ui-json-render.md`: broader AF-UI authoring and JSON-Render serialization proposal from the Gen2 UI dialect notes.
- `JSON_RENDER_V0.20_UPSTREAM.md`: upstream `vercel-labs/json-render`
  v0.20.0 review (named slots, action bindings, nested repeats) and its
  implications for the `src/view-spec-json-render.ts` lowering target.

Status (`DQ-094`, ratified 2026-08-17): these notes are **reference input**
for AN-5, not its plan — the plan is
`future/agent/generative-view-spec.spec.ts`. The copied gen2 documents
describe a static generator IR and predate json-render v0.20; where they
conflict with the upstream notes above (e.g. slot flattening), v0.20
semantics win.

