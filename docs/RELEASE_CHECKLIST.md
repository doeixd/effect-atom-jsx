# Release Checklist

Status: **prerelease / beta-ready** as of 2026-07-09.
Hard external gate for a true **1.0 stable**: Effect 4 stable (currently
`effect ^4.0.0-beta.29` dep + peer). Until then ship prerelease tags only.

Authority: `docs/V1_SCOPE.md` (ships vs deferred).

## Quality Gates

- [x] `npm run typecheck:all` passes (main + tests + examples)
- [x] `npm test` passes (full suite, including TodoMVC integration)
- [x] `npm run build` passes
- [x] `npm run check` equivalent: typecheck:all + test green
- [x] Package entry smoke: main / jsx-runtime / runtime / testing / CLI

## API and Docs

- [x] Public API exports match intended surface in `src/index.ts` + `package.json` `exports` / `bin`
- [x] `README.md` reflects current API (callable atoms, `defineQuery` /
  `defineMutation`, `Component`, slots golden path, `render` top-level)
- [x] Live docs index and focused guides (`docs/README.md`, `component.md`,
  `view.md`, `style.md`, `router.md`) describe the current API rather than
  historical notes
- [x] Breaking redesign track recorded in `CHANGELOG.md` Unreleased section
- [x] Effect version compatibility documented (beta peer; prerelease class)

## Runtime and Behavior

- [x] `defineQuery` / `defineMutation` / `Atom.action` behavior validated by tests
- [x] Unified `Result` (`Loading` / `Refreshing` / `Success` / `Failure` /
  `Stale` / `Defect`) is the primary async model
- [x] P13 boundary: optional `Atom.action(..., { inputSchema })` validates
  inputs before effect / single-flight transport
- [x] Optimistic + refresh settlement covered by `todomvc.integration.test.ts`
  with poll-until-settled (not fixed-tick only)

## Packaging

- [x] `package.json` version on prerelease line (`0.5.0`)
- [x] `main` / `types` / `exports` / `bin` verified
- [x] Build outputs under `dist/` (clean build)
- [x] Lockfile committed
- [x] `npm pack --dry-run` includes `dist/` + intended docs (not src-only)

## Final Verification

- [x] Changelog / unreleased notes prepared for redesign track
- [x] Example typecheck gate green (`typecheck:examples`)
- [x] Integration suite `src/__tests__/todomvc.integration.test.ts` passing
- [ ] Tag and publish plan confirmed (operator action — not automated)
- [ ] Wait for Effect 4 stable before cutting `1.0.0` (not `0.x` prerelease)

## Latest Validation Snapshot (2026-07-09)

Re-run and capture under the release evidence scratch before cutting a tag:

| Gate | Expected |
| --- | --- |
| `npm run typecheck:all` | exit 0 |
| `npm test -- --run` (×2) | exit 0 both; TodoMVC not flaky |
| `npm run build` | exit 0; `dist/index.js`, `jsx-runtime.js`, `runtime.js`, `testing.js`, `cli.js` present |
| Import smoke (built main) | non-empty exports incl. `Result` / `Atom` / `render` |
| `node dist/cli.js --help` | doctor usage text |
| `npm pack --dry-run` | tarball includes `dist/` + docs |

### Effect compatibility

- Dependency / peer: `effect ^4.0.0-beta.29`
- Release class while Effect remains beta: **0.x prerelease / beta**
- `1.0.0` stable requires Effect 4 stable pin + this checklist re-run

### TypeScript toolchain

- `devDependencies.typescript`: **^7.0.2** (TypeScript 7)
- Gates: `npm run typecheck:all` / `build` use that `tsc`
- TS7 config notes: no `baseUrl` (use relative `paths`); `types: ["node"]`
  for CLI; Route title/meta attach impl avoids deep instantiation

### Intentionally deferred (not release blockers for prerelease)

Shipped in-tree (backlog closed 2026-07-09): P9 `Form`, P11 Devtools/MCP
session MVP, P12 gated streams + `Component.subscription`, D3 `create-af-ui`.

Still deferred depth: multi-renderer (TUI/RN), package split execution (P7
stays single package), full browser Devtools panel chrome, WAI-ARIA
certification theater. See `docs/V1_SCOPE.md` Deferred.
