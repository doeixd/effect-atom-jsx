# Style2 Implementation Plan (Advanced CSS Expressiveness)

This plan implements the advanced styling surface described in `docs/style2.md` on top of the existing v1 `Style` system.

## 1) Goals

- Extend `Style` with advanced CSS expressiveness while preserving typed tokens and slot-targeted composition.
- Keep style definitions as typed data; renderers compile data to platform-native styling.
- Maintain behavior/style symmetry (`Behavior.attach` and `Style.attach` both target slots).
- Add strict typing where feasible (tokens, variant axes, slot maps, known helper enums), with escape hatches for raw selector strings.

## 2) Current Baseline (already shipped)

- Typed tokens + `Theme` service + token lookup.
- Slot-based style definitions and `Style.attach` / `Style.attachBySlots`.
- Style composition primitives (`slot`, `compose`, `when`, `states`, `responsive`, variants, recipe).
- Basic style overrides and provider context.
- Styled composable example (`styled-combobox`).

## 3) Scope for Style2

### In scope

- `Style.nest(...)` selector maps.
- Selector helper APIs (`child`, `descendant`, `sibling`, `attr`, `not`, `is`).
- CSS variable APIs (`Style.vars`).
- Keyframes/animation improvements (`Style.keyframes(name, frames)`, `Style.animate(...)`).
- Rich transition DSL (`Style.transition(...)` property map).
- Lifecycle animations (`Style.enter`, `Style.exit`, `Style.enterStagger`).
- Layout animation descriptor (`Style.layoutAnimation`).
- At-rule composition APIs:
  - `Style.media(...)`
  - `Style.supports(...)`
  - `Style.container(...)` / `Style.containerQuery(...)`
  - `Style.containerType(...)`
- Grid DSL + typed grid area extraction:
  - `Style.grid(...)`
  - `Style.GridAreas<typeof grid>`
- Cascade layering + globals:
  - `Style.layers(...)`, `Style.inLayer(...)`, `Style.global(...)`, `Style.globalLayer(...)`
- Pseudo helpers (`Style.pseudo(...)`) and recipe inheritance helper (`Style.extends(...)` for recipe slot reuse semantics).

### Deferred (post-Style2)

- Full static CSS extraction/JIT optimizer.
- View-transition/Web Animations runtime execution details beyond descriptor fidelity.
- Non-web full renderer parity (define adapter contracts now, full impl later).

## 4) Architecture Enhancements

- Evolve `StyleValue` AST with node kinds:
  - `Nest`, `Vars`, `Media`, `Supports`, `Container`, `Pseudo`, `Grid`, `Layer`, `Global`, `Animate`, `Enter`, `Exit`, `EnterStagger`, `LayoutAnimation`, `Extend`.
- Introduce style normalization pass:
  - flatten composition
  - resolve `extends`
  - apply conditional nodes
  - preserve unresolved dynamic functions for reactive binding.
- Add web compilation pipeline for advanced nodes:
  - selectors and at-rules -> CSS rule graph
  - keyframes registry with stable naming
  - custom properties emission and updates
  - transition map -> CSS transition serialization.
- Keep renderer abstraction explicit so these descriptors can map to TUI/mobile equivalents later.

## 5) Phased Implementation

## Phase A — AST and Type Foundations

Files:
- `src/style-types.ts`
- `src/Style.ts`
- `src/style-runtime.ts`

Work:
- Extend style node types for nesting, variables, at-rules, pseudo, animation descriptors, grid descriptors, layering/global nodes.
- Add shared typed enums/unions:
  - `PseudoClass`
  - lifecycle animation options
  - transition option types
  - container/media/support condition types (string passthrough + helper forms).
- Add transform object typing (`translateX`, `rotate`, etc.) and serializer contract.

Acceptance:
- Typecheck passes with new node types and no regressions in existing API.

## Phase B — Selector and Nesting APIs

Files:
- `src/Style.ts`
- `src/__tests__/style-selectors.test.ts` (new)
- `src/type-tests/style-selectors.ts` (new)

Work:
- Implement `Style.nest(record)` node and merge behavior.
- Add selector helpers:
  - `Style.child`, `Style.descendant`, `Style.sibling`, `Style.attr`, `Style.not`, `Style.is`.
- Keep raw selector string support.

Acceptance:
- Nested selector definitions merge correctly.
- Helper-generated selectors are stable and test-covered.

## Phase C — CSS Variables and Reactive Vars

Files:
- `src/Style.ts`
- `src/style-runtime.ts`
- `src/__tests__/style-vars.test.ts` (new)

Work:
- Implement `Style.vars(...)` node.
- Resolve token refs inside var values.
- Bind reactive var values as property-level updates.
- Ensure override/provider path can target vars reliably.

Acceptance:
- Vars cascade within style graph semantics.
- Reactive vars update without full re-render in tests.

## Phase D — Animation and Transition DSL

Files:
- `src/Style.ts`
- `src/style-runtime.ts`
- `src/__tests__/style-animation.test.ts` (new)
- `src/type-tests/style-animation.ts` (new)

Work:
- Implement named keyframes:
  - `Style.keyframes(name, frames)`
  - `Style.animate(keyframes, options)`
- Implement typed transition map (`Style.transition({ prop: {duration,timing,...} })`).
- Implement typed transform serialization.

Acceptance:
- Keyframes/animate/transition descriptors resolve predictably.
- Tokenized durations resolve via Theme service.

## Phase E — Lifecycle and Layout Animation Nodes

Files:
- `src/Style.ts`
- `src/style-runtime.ts`
- `src/__tests__/style-lifecycle-animation.test.ts` (new)

Work:
- Add `Style.enter`, `Style.exit`, `Style.enterStagger`, `Style.layoutAnimation` descriptors.
- Wire descriptors into element metadata channel for renderer consumption.

Acceptance:
- Node descriptors preserved through attach pipeline and available to renderer adapter.

## Phase F — At-Rules and Container Query APIs

Files:
- `src/Style.ts`
- `src/style-runtime.ts`
- `src/__tests__/style-atrules.test.ts` (new)

Work:
- Add:
  - `Style.media(...)`
  - `Style.supports(...)`
  - `Style.container(name?, map)` / `Style.containerQuery(name, map)`
  - `Style.containerType(name, type)`
- Ensure nested style values inside at-rules are token-resolved + typed.

Acceptance:
- At-rule nodes compose with base slot styles and nesting nodes without ordering ambiguity.

## Phase G — Grid DSL and Typed Areas

Files:
- `src/Style.ts`
- `src/style-types.ts`
- `src/type-tests/style-grid.ts` (new)
- `src/__tests__/style-grid.test.ts` (new)

Work:
- Implement `Style.grid(...)` descriptor.
- Implement `Style.GridAreas<typeof grid>` utility type.
- Add helpers for area placement typing.

Acceptance:
- Invalid area references fail type-tests when area unions are known.

## Phase H — Layers, Globals, and Reset Support

Files:
- `src/Style.ts`
- `src/Theme.ts`
- `src/style-runtime.ts`
- `src/__tests__/style-global-layer.test.ts` (new)

Work:
- Implement:
  - `Style.layers(names)`
  - `Style.inLayer(name, style)`
  - `Style.global(record)`
  - `Style.globalLayer(globalStyles)` (Layer provider artifact)
- Ensure global styles still resolve tokens via Theme.

Acceptance:
- Global layer can be provided at mount and updates on theme changes.

## Phase I — Recipe Extensions and Pseudo APIs

Files:
- `src/Style.ts`
- `src/__tests__/style-recipe-advanced.test.ts` (new)
- `src/type-tests/style-recipe-advanced.ts` (new)

Work:
- Add `Style.pseudo(...)` convenience.
- Add `Style.extends(slotName)` recipe reuse reference semantics.
- Validate `extends` references existing recipe slots.

Acceptance:
- Advanced recipe examples from `style2.md` become expressible with typed APIs.

## Phase J — Web Compiler Path and Example Suite

Files:
- `src/style-runtime.ts`
- `src/styled-composables.ts`
- `examples/styled-card/*` (new)
- `examples/styled-dashboard/*` (new)

Work:
- Add a deterministic web-target compilation output for:
  - nested selectors
  - keyframes
  - at-rules
  - layer/group ordering.
- Add at least two examples:
  - styled card recipe with variants + pseudo + nested selectors
  - dashboard grid + media/container queries.

Acceptance:
- Example code demonstrates Style2 surface from docs with minimal casts.

## 6) Testing Strategy

Type tests:
- token helper correctness
- selector helper argument unions
- attach slot mapping strictness
- variant/recipe/recipe-extends typing
- grid area extraction typing.

Runtime tests:
- merge order and override precedence
- nested selector node retention/serialization
- var resolution/reactive updates
- keyframe/animate descriptor wiring
- at-rule composition order
- global/layer integration.

## 7) Compatibility and Migration

- Preserve all existing `Style` v1 APIs.
- Introduce Style2 APIs additively.
- Keep older style pieces interoperable with new AST nodes.

## 8) Documentation Deliverables

- Update `docs/API.md` with full Style2 API index.
- Add `docs/STYLING_ADVANCED.md` with focused examples from `style2.md`.
- Update `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md` after each phase.
- Keep `CHANGELOG.md` aligned with shipped phases.

## 9) Risks and Mitigations

- **Risk:** type-level complexity explosion.
  - **Mitigation:** isolate helper types, rely on explicit type-tests per feature.
- **Risk:** runtime style attach overhead.
  - **Mitigation:** compile/normalize once per style definition; incremental reactive updates per property.
- **Risk:** renderer divergence.
  - **Mitigation:** preserve a renderer-agnostic intermediate representation with adapter contracts.

## 10) Practical Execution Order

1. Phase A-B-C (AST + selectors + vars)
2. Phase D-E (animations/lifecycle)
3. Phase F-G (at-rules + grid)
4. Phase H-I (layers/globals + recipe extensions)
5. Phase J (web compiler stabilization + examples)

## 11) Definition of Done

- `npm run typecheck` passes with new type-tests.
- Full test suite passes with Style2 runtime coverage.
- `npm run build`, `npm pack --dry-run` pass.
- `docs/API.md`, `CHANGELOG.md`, and `docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md` reflect shipped Style2 APIs.
