# Gen UI Implementation Plan

This plan grounds `gen-ui.md` in the current `gen2` codebase. The proposal's useful direction is correct: implement a typed, semantic UI IR first, then lower to JSON Render, JSX, Solid, React Native, email, PDF, or admin targets. The important correction is that this repository already has a UI layer. We should evolve `src/ui/ui.ts`, `src/forms/forms.ts`, `src/list/list.ts`, `src/editor/editor.ts`, `src/admin/admin.ts`, and `src/gen/ui-backends.ts` instead of creating a parallel UI subsystem.

## Current State

Existing modules already cover these surfaces:

- `src/ui/ui.ts`: platform-agnostic UI primitives: `ElementCapability`, `Widget`, `Theme`, `Platform`, `Renderer`, `Slot`, `View`, `Component`, `Style`, `Behavior`, `Form`, `FormField`, `checkUi`, and `createUiNamespace`.
- `src/forms/forms.ts`: form derivation from `ActionFunction.input_fields`, semantic-type-to-widget inference, trait-derived validation, and `InferFormValues` / `InferFormResult` helpers.
- `src/list/list.ts`: entity-backed list/table IR with columns, filters, sorting, pagination, row actions, bulk actions, and CRUD auto-derivation.
- `src/editor/editor.ts`: editor surfaces that compose queries, actions, forms, preview components, nested editors, commands, sections, hooks, and visibility predicates.
- `src/admin/admin.ts`: admin shells that compose lists and editors into pages and routes.
- `src/gen/ui-backends.ts`: backend-aware UI namespace extension for `jsx` and `tui`.
- `src/gen/types.ts`: `UiBackendRegistry`, `UiNamespaceRuntimeOptions`, `BaseUiNamespace`, backend-specific handles, and `Gen<C>["ui"]` typing.
- `src/lifecycle/lifecycle.ts`: built-in checks already call `checkUi`, `checkEditors`, and `checkList`; `checkAdmin` exists in `src/admin/admin.ts` and should be registered if admin surfaces become first-class lifecycle inputs.

Existing integration points:

- Entities expose typed `Field<Ts>` values with stable `FieldRef`s.
- Semantic types carry phantom `_ts`, traits, validation, serializer flags, `server_only`, enum values, and storage/wire representations.
- Rules are typed AST values with `Rule<Name, Vars>`, `RuleExpr`, dependencies, SQL translation, placement analysis, and lifecycle checks.
- Expressions are typed AST values with refs, semantic type, requirements, effects, and opaque-JS detection.
- Functions distinguish `StaticFunction`, `ExprFunction`, `PredicateFunction`, `QueryFunction`, `ActionFunction`, `PatchFunction`, and `PlanFunction`; they already carry typed refs, input/output semantic types, requirements, effects, target runtimes, call plans, and traits.
- `QueryFunction` already has key-based reactivity through `reactivity.key` and `ActionFunction` already has invalidation through `reactivity.invalidates`, legacy `invalidates`, and optional optimistic `PatchFunction`.
- `ReactiveResource`, `ReactiveMutation`, `ResourceAll`, `ResourceChain`, `OptimisticPlan`, `SingleFlightPlan`, and `ReactiveGraph` already model query/mutation state, invalidation, optimistic patches, refresh planning, route/form/resource impacts, and key-family graphs.
- Reactions already model automatic effectful follow-up work with `Reaction<Name, Event, In, Out>`, `when: Rule`, optional `select: ExprFunction`, `run: ActionFunction`, idempotency, delivery, and modes like `on_transition_true` and `maintain`.
- Computed values already exist as `ExprFunction` and typed expression builders. UI computed values should reference these rather than inventing another computed function catalog.
- Authz has typed access surfaces and UI hint surfaces via `gen.authz.surface.uiHint`.
- Rule-derived reactivity already derives invalidation plans from rule dependencies and action write sets, including precision/confidence and UI editability helpers.
- Plugins and targets are already first-class in core/lifecycle.

## Seamless Integration Principles

The UI extension should feel like a natural continuation of `gen2`, not a feature bolted onto it.

- Do not add UI-specific action, query, computed, reaction, cache, or invalidation concepts where existing IR already exists.
- `gen.ui.action(action, input)` should be a UI event binding around `ActionFunction`; if a `ReactiveMutation` exists for that action, targets should prefer it.
- `gen.ui.resource(resource)` should bind to `ReactiveResource`; if only a `QueryFunction` is supplied, UI helpers may derive or wrap a resource using existing key metadata.
- `gen.ui.computed(fn, args)` should wrap `ExprFunction` first, `StaticFunction` only when target capabilities allow runtime calls.
- `gen.ui.reaction(reaction)` should expose reaction state or controls only when a UI target needs it; reaction execution remains in `src/reaction`.
- View state should not duplicate `ResourceState`; a view binding to a resource should expose `status`, `value`, `error`, and `stale` using the existing `ResourceState<Value, Err>` shape.
- UI refresh/invalidation should use `deriveReactiveGraph`, `affectedResourcesForMutation`, `affectedRoutesForMutation`, `affectedFormsForMutation`, `deriveSingleFlightPlan`, and `deriveRuleInvalidationPlans`.
- UI editability should reuse `FormField.editableWhen`, `deriveEditableFieldsForRule`, and `deriveEditabilityRulesForField` where possible.
- Target lowerers should consume existing `traits` such as `readable`, `writable`, `callable`, `reactive`, `effectful`, and `target_interpretable` before adding new UI-specific flags.
- Keep constructors small and composable. The high-level API should read like `gen.ui.element(Button, { on: { press: gen.ui.action(savePost, input) } })`, but internally that should cite the same `ActionFunction`, `ReactiveMutation`, keys, auth policies, and reactivity graph used everywhere else.

## Design Direction

Do not make JSON Render's JSON schema the core model. Make `gen2`'s UI model the core and add target lowerers.

JSON Render support should be implemented as a plugin/target. The core library should provide the portable primitives that make JSON Render-style lowering possible, while the plugin owns JSON Render vocabulary, JSON Pointer output, catalog/spec artifact shape, registry artifacts, and JSON Render-specific diagnostics.

The core model should be:

- Typed domain refs in, target-specific paths out.
- `Field`, `Entity`, `SemanticType`, `Rule`, `Expr`, `ActionFunction`, `QueryFunction`, `ReactiveResource`, and `AppRoute` are canonical references.
- JSON Pointer strings, component names, action names, JSX props, and framework-specific handlers are lowering artifacts only.
- Client-side auth visibility is a hint, never authoritative authorization.
- Static IR values remain inspectable and checkable. Avoid opaque runtime code by default.

The implementation should extend existing `View`/`Component` primitives into a real view tree IR. Today `View.structure` is a `string`, `Component.props_type` is a `string`, and `Component.bindings` are `readonly string[]`. Those are placeholders. The next version should preserve those concepts but add typed structured alternatives.

## Core And Plugin Boundary

Core should include target-agnostic primitives that can support JSON Render, JSX, Solid, admin, email, PDF, or future renderers. Core should not expose `$state`, `$computed`, `$bindState`, JSON Pointer strings, JSON Render catalog JSON, or JSON Render registry concepts as primary authoring APIs.

Core owns:

- Typed component catalog entries with semantic prop schemas, slots, event names, descriptions, target platform constraints, and optional backing `Component`.
- Structured view tree nodes: element, text, fragment, repeat, conditional.
- Typed UI value IR: literal, field value, state path value, resource value, query value, item value, index value, expression value, rule/condition value, computed value, template value.
- Typed state model and path IR with static path segments, source identity, semantic value type, and path metadata.
- Two-way binding IR for state, item, and form bindings, plus read-only/server-only safety checks.
- Event binding IR that references existing `ActionFunction`, `ReactiveMutation`, `AppRoute`, built-in commands, or target-safe static handlers.
- Computed binding IR that references existing `ExprFunction`, `PredicateFunction`, and target-gated `StaticFunction`.
- Target capability descriptions and target-independent lowerability checks.
- Safety policy primitives for allowed components, actions/mutations, resources, computed functions, state paths, and auth hint behavior.
- Diagnostics that are independent of any one renderer: prop mismatch, slot mismatch, binding type mismatch, repeat source type, server-only exposure, unsafe auth hint, missing query keys, unregistered resources/actions/mutations/reactions.

Plugins own:

- Target-specific artifact formats.
- Target-specific path serialization, such as JSON Pointer.
- Target-specific expression syntax, such as JSON Render `$state`, `$item`, `$index`, `$bindState`, `$bindItem`, `$computed`, `$template`, and visibility objects.
- Target-specific component registry/runtime glue.
- Target-specific capability decisions and diagnostics.
- Target-specific AI catalog/prompt format.

JSON Render plugin owns:

- `UiStatePath` -> JSON Pointer lowering.
- `UiStateValue` -> JSON Render `$state`.
- `UiItemValue` -> JSON Render `$item`.
- `UiIndexValue` -> JSON Render `$index`.
- `UiTwoWayBinding` -> JSON Render `$bindState` / `$bindItem`.
- `UiRepeatNode` -> JSON Render repeat block.
- `UiComputedValue` -> JSON Render `$computed` plus function catalog entry.
- `UiTemplateValue` -> JSON Render `$template`.
- `UiCondition` / lowerable `Rule` / lowerable `Expr<boolean>` -> JSON Render visibility/enabled condition syntax.
- `ComponentCatalogEntry` -> JSON Render catalog component schema.
- `UiActionBinding` / `ReactiveMutation` -> JSON Render catalog action and action invocation spec.
- Registry artifacts mapping component/action/function names to runtime implementations.

This split keeps JSON Render useful immediately without turning its JSON shape into the source of truth.

## Proposed Core Additions

Add the following to `src/ui/ui.ts` in small, staged changes.

The core additions are intentionally the primitives a JSON Render plugin needs, but they should remain renderer-neutral. If an API name would only make sense for JSON Render, it belongs in the plugin rather than `gen.ui`.

### 1. Typed Component Catalog

Introduce a typed component definition that can coexist with current `Component<P, E>`.

```ts
export interface ComponentPropSchema<P = unknown> {
  readonly semantic_type: SemanticType<P>;
}

export interface ComponentSlotSpec<C extends ElementCapability = ElementCapability> {
  readonly capability: C;
  readonly many: boolean;
  readonly required: boolean;
}

export interface ComponentCatalogEntry<
  P = unknown,
  E = unknown,
  S extends Record<string, ComponentSlotSpec> = Record<string, ComponentSlotSpec>,
> {
  readonly kind: "ui.componentCatalogEntry";
  readonly name: string;
  readonly description?: string;
  readonly props: SemanticType<P>;
  readonly slots: S;
  readonly component?: Component<P, E>;
  readonly requirements: readonly string[];
  readonly allowed_events: readonly UiEventName[];
  readonly target_platforms: readonly Platform<E>[];
  readonly _props?: P;
  readonly _element?: E;
  readonly _slots?: S;
}
```

Notes:

- Keep `Component<P, E>` for existing tests/API. Add `ComponentCatalogEntry` rather than replacing it immediately.
- Use `SemanticType<P>` for props, not `props_type: string`.
- Slot specs should be type-level records so element construction gets autocomplete for slot names.
- Preserve narrow return types from constructors.
- Do not use plain string event kinds long-term. Define a literal union and allow backend augmentation later.
- Include enough metadata for plugin catalogs: descriptions, allowed events, requirements, target platforms, slot cardinality, and required props.
- Do not include JSON Render component names, registry paths, or JSON schema fragments in core. Those are lowerer outputs.

Candidate API:

```ts
const Card = gen.ui.catalog.component({
  name: "Card",
  props: gen.types.object({
    title: gen.types.string(),
    padding: gen.types.enumOf("Padding", ["sm", "md", "lg"]),
  }),
  slots: {
    default: gen.ui.slotSpec(gen.ui.container(gen.ui.cap("Base")), { many: true }),
  },
});
```

### 2. View Tree IR

Add structured tree nodes while keeping current `View.structure` for compatibility.

```ts
export type UiNode<E = unknown> =
  | UiElementNode<unknown, E, Record<string, ComponentSlotSpec>>
  | UiTextNode
  | UiFragmentNode<E>
  | UiRepeatNode<unknown, E>
  | UiConditionalNode<E>;

export interface UiElementNode<
  P = unknown,
  E = unknown,
  S extends Record<string, ComponentSlotSpec> = Record<string, ComponentSlotSpec>,
> {
  readonly kind: "ui.element";
  readonly component: ComponentCatalogEntry<P, E, S> | Component<P, E>;
  readonly props: UiProps<P>;
  readonly slots: UiSlotChildren<S, E>;
  readonly events: readonly UiEventBinding[];
  readonly visible_when?: Rule | UiValue<boolean> | Expr<boolean>;
  readonly enabled_when?: Rule | UiValue<boolean> | Expr<boolean>;
  readonly _props?: P;
  readonly _element?: E;
}

export interface ViewTree<E = unknown> {
  readonly kind: "ui.viewTree";
  readonly root: UiNode<E>;
}
```

Then extend `View`:

```ts
export interface View<
  E = unknown,
  S extends Record<string, ElementCapability> = Record<string, ElementCapability>,
> {
  // existing fields
  readonly tree?: ViewTree<E>;
}
```

Candidate API:

```ts
const ProjectCard = gen.ui.viewTree({
  name: "ProjectCard",
  root: gen.ui.element(Card, {
    props: {
      title: gen.ui.value(Project.fields.name),
      padding: "md",
    },
    slots: {
      default: [gen.ui.element(Badge, { props: { label: gen.ui.value(Project.fields.status) } })],
    },
  }),
});
```

This should register as a normal `View` in `ctx.views` via a binder, not a separate root collection unless we later need one.

### 3. Typed UI Values And Bindings

Add a UI value layer that can represent literals, field reads, state paths, repeat item reads, index reads, expressions, rules, computed function calls, templates, and two-way bindings.

This is the key portability layer. JSON Render can lower these values to `$state`, `$item`, `$index`, `$computed`, and `$template`; JSX/Solid can lower the same values to component expressions and resource reads.

```ts
export type UiValue<T = unknown> =
  | UiLiteral<T>
  | UiFieldValue<T>
  | UiStateValue<T>
  | UiItemValue<T>
  | UiIndexValue
  | UiExprValue<T>
  | UiComputedValue<T>
  | UiTemplateValue;

export interface UiFieldValue<T = unknown> {
  readonly kind: "ui.fieldValue";
  readonly field: Field<T>;
  readonly _ts?: T;
}

export interface UiStateValue<T = unknown> {
  readonly kind: "ui.stateValue";
  readonly path: UiStatePath<T>;
  readonly _ts?: T;
}

export interface UiTwoWayBinding<T = unknown> {
  readonly kind: "ui.twoWayBinding";
  readonly target: UiStatePath<T> | UiItemPath<T> | FormField<T>;
  readonly mode: "state" | "item" | "form";
  readonly _ts?: T;
}
```

Important distinction:

- `gen.ui.value(field)` reads a domain field from the current bound entity/item context.
- `gen.ui.state(path)` reads from a state model.
- `gen.ui.resource(resource)` reads a `ReactiveResource` as `ResourceState<Value, Err>`.
- `gen.ui.query(query, input)` is convenience sugar only if a query has `reactivity.key` or can be wrapped into a `ReactiveResource`; it should not become a parallel resource model.
- `gen.ui.bindState(path)` is two-way binding and must require a writable path.
- `gen.ui.expr(expr)` wraps expression ASTs.
- `gen.ui.rule(rule)` wraps rule predicates for visibility or enabled state.

Avoid raw string paths in public constructors. If we support strings, keep them as target/backend escape hatches with diagnostics and lower type quality.

Core path/value data must include:

- `segments`: static path segments for deterministic target serialization.
- `source`: the state model, resource, item context, form, or entity context that owns the path.
- `value_type`: the semantic type or entity/form/resource type reached by the path.
- `writable`: whether two-way binding is allowed.
- `server_only`: whether client targets must reject or redact the value.

### 4. State Model IR

JSON Render has state paths. `gen2` should have typed state models that can lower to JSON Pointer.

Use `SemanticType`, `Entity`, `QueryFunction`, `ReactiveResource`, and `Form` as legal state sources.

```ts
export type UiStateSource<T = unknown> =
  | SemanticType<T>
  | Entity
  | QueryFunction<unknown, T>
  | ReactiveResource<unknown, T, unknown>
  | Form<T>;

export interface UiStateModel<Shape = unknown> {
  readonly kind: "ui.stateModel";
  readonly name: string;
  readonly fields: UiStateFields<Shape>;
  readonly _ts?: Shape;
}
```

Candidate API:

```ts
const ProjectPageState = gen.ui.stateModel("ProjectPageState", {
  project: Project,
  canEdit: gen.types.boolean(),
  editForm: ProjectEditForm,
  projects: projectCrud.list,
});

gen.ui.state(ProjectPageState.fields.project.fields.name);
```

Implementation details:

- Add path segment types that preserve `T` through nested structs, objects, arrays, entities, and forms.
- For entity state, expose `fields` with the same keys and `Field<T>` phantom types.
- For array state, expose `.item` path helpers or make repeat bind item context explicitly.
- Keep paths as static data: `readonly segments: readonly string[]`, `readonly source: UiStateModel`, `readonly value_type: SemanticType<T> | Entity | Form | QueryFunction`.
- For `ReactiveResource`, expose a `ResourceState<Value, Err>` path with `status`, `value`, `error`, and `stale`, matching `src/reactivity/reactivity.ts`.
- For `ResourceAll`, expose branch names and infer branch values through `InferResourceAllValues`.
- For `ResourceChain`, expose source and next resource states; do not create new chained loader semantics.
- Keep JSON Pointer serialization out of core. Core should expose a generic path record; JSON Render plugin serializes `segments` to `/project/name`.
- Include stable source identity where possible so plugin outputs are deterministic across process runs.

### 5. Repeat And Item Context

Introduce a typed repeat node. The render callback should be a builder macro that immediately produces static IR; do not store closures.

```ts
export interface UiRepeatNode<Item = unknown, E = unknown> {
  readonly kind: "ui.repeat";
  readonly items: UiValue<readonly Item[]> | UiStatePath<readonly Item[]>;
  readonly item: UiRepeatItem<Item>;
  readonly key?: Field | UiValue<string | number>;
  readonly children: readonly UiNode<E>[];
  readonly empty?: UiNode<E>;
  readonly _item?: Item;
  readonly _element?: E;
}
```

Candidate API:

```ts
gen.ui.repeat(
  ProjectPageState.fields.projects.items,
  (project) =>
    gen.ui.element(ProjectRow, {
      props: {
        title: gen.ui.item(project.fields.name),
      },
    }),
  { key: Project.fields.id },
);
```

Diagnostics should reject non-array item sources and missing keys when the target requires stable keys.

### 6. Events And Action Bindings

UI events should bind to typed `ActionFunction`, `AppRoute`, built-in commands, or static functions.

```ts
export type UiEventName =
  | "click"
  | "press"
  | "input"
  | "change"
  | "submit"
  | "keypress"
  | (string & { readonly _uiEvent?: never });

export interface UiActionBinding<In = unknown, Out = unknown> {
  readonly kind: "ui.action";
  readonly action: ActionFunction<In, Out>;
  readonly input: UiActionInput<In>;
  readonly mutation?: ReactiveMutation<In, Out>;
  readonly _input?: In;
  readonly _output?: Out;
}

export type UiEventBinding = {
  readonly event: UiEventName;
  readonly handler:
    | UiActionBinding
    | UiNavigationBinding
    | UiStaticBinding
    | UiBuiltInCommandBinding;
};
```

Action input inference is important:

- If `ActionFunction<In, Out>` input type is an object semantic type, the `input` object should be keyed by `keyof In`.
- Values should accept `UiValue<In[K]>`, `Field<In[K]>`, literals of `In[K]`, or compatible expressions.
- End-user code should not need explicit type parameters.

Integration with existing reactivity:

- If a `ReactiveMutation<In, Out>` is supplied, the binding should use `mutation.action` and `mutation.invalidates`.
- If only an `ActionFunction<In, Out>` is supplied, the binding should read `action.reactivity?.invalidates`, `action.invalidates`, and `action.optimistic`.
- If neither a mutation nor invalidation metadata exists, targets may still generate a handler, but diagnostics should explain that refresh behavior cannot be derived.
- If `bindReactiveMutation` has already derived a default optimistic plan, UI should reuse it; do not derive a separate UI-only optimistic patch.
- Core event bindings should include enough metadata for targets to choose runtime strategy: direct action call, mutation wrapper, form submit, route action, server action, or registry action.
- JSON Render action names should be generated by the plugin from stable function refs/names, not authored in core.

Candidate API:

```ts
gen.ui.on(
  "press",
  gen.ui.action(archiveProject, {
    projectId: gen.ui.state(ProjectPageState.fields.project.fields.id),
  }),
);
```

Preferred ergonomic overload:

```ts
gen.ui.on(
  "press",
  gen.ui.mutation(archiveProjectMutation, {
    projectId: gen.ui.state(ProjectPageState.fields.project.fields.id),
  }),
);
```

`gen.ui.mutation` should return the same `UiActionBinding` shape with `mutation` populated.

### 7. Computed Values And Templates

Computed values should reuse `ExprFunction` where the function body is inspectable and target-lowerable.

```ts
export interface UiComputedValue<T = unknown> {
  readonly kind: "ui.computed";
  readonly fn: ExprFunction<unknown, T> | PredicateFunction<unknown> | StaticFunction<unknown, T>;
  readonly args: ReadonlyMap<string, UiValue>;
  readonly _ts?: T;
}
```

Rules:

- Prefer `ExprFunction` for target lowering.
- Allow `PredicateFunction` as boolean computed values for conditions and props.
- Allow `StaticFunction` only for targets that can call runtime functions.
- Emit diagnostics when a computed function is not registered in `ctx.expr_functions` / `ctx.static_functions`.
- Emit diagnostics when `ExprAstNode` contains opaque JS for a target that forbids opaque client code.
- Reuse `InferFunctionInput` and `InferFunctionOutput` from `src/function/function.ts` instead of creating UI-specific function inference helpers where possible.

Template strings should be a thin `UiTemplateValue` over static parts and `UiValue` substitutions. Lower to JSON Render `$template` or framework string interpolation.

## Integration With Existing Systems

### Entities And Fields

Use `Field<Ts>` as the primary data binding handle. Do not invent string field paths.

Implementation notes:

- `UiFieldValue<T>` wraps `Field<T>` and keeps `_ts?: T`.
- Field ownership checks should mirror `entity:wrong-entity-field` and editor's visible-when scope checks.
- When a view declares a target entity or state model, field values should be checked against that scope.
- Use `Field.ref` in diagnostics so messages cite the exact field.

New diagnostics:

- `ui:field-not-in-view-entity`
- `ui:field-scope-ambiguous`
- `ui:server-only-field-bound-to-client`
- `ui:readonly-field-two-way-bound`

### Semantic Types And Schemas

Semantic types should drive props, state, validation, widgets, and target schemas.

Implementation notes:

- `ComponentCatalogEntry.props` should be `SemanticType<P>`, usually from `gen.types.object`.
- Prop checking should compare `SemanticType.kind` / `name` at runtime and `_ts` at compile time.
- Use `SemanticType.server_only` to reject client-exposed state or props.
- Use serializers when lowering to JSON/wire targets.
- Use `enum_values` for select widgets, prop enum validation, JSON Render catalog enum schemas, and AI generation prompts.
- Preserve `deriveValidation(field)` behavior: field traits become UI validation rules.

New diagnostics:

- `ui:component-prop-mismatch`
- `ui:component-required-prop-missing`
- `ui:component-unknown-prop`
- `ui:component-slot-missing`
- `ui:component-unknown-slot`
- `ui:server-only-prop`
- `ui:serializer-required-for-target`

### Traits

Traits already carry validation/storage/privacy/UI-ish behavior. Use traits as the extension point for domain-to-UI hints without hardcoding every semantic type.

Implementation notes:

- Keep `deriveValidation` as the first trait integration: `validate_expression` and `error_message` become `ValidationRule`.
- Add optional trait metadata in `ctx.trait_metadata` for UI hints instead of adding many fields to `Trait` immediately.
- Suggested metadata shape: `{ ui?: { widget?: WidgetKindTag; display?: "badge" | "avatar" | "money" | "date"; redact?: boolean; sort?: boolean; filter?: boolean } }`.
- Let plugins register trait metadata through `PluginContributions.trait_metadata`, already supported by `createGen`.
- Do not make end-user tests cast trait metadata. Add a typed helper if needed.

New diagnostics:

- `ui:trait-widget-incompatible`
- `ui:trait-display-unsupported-by-target`
- `ui:redacted-field-bound-to-public-view`

### Rules

Rules should be the canonical source for visibility, enablement, editability, auth hints, and potentially route guards.

Implementation notes:

- Accept `Rule`, `RuleExpr<boolean>`, `Expr<boolean>`, and `UiValue<boolean>` in visibility APIs, but normalize to one `UiCondition` union.
- For UI hints, use `Rule` as client-side conditional rendering only.
- Use `extractRuleDependencies` to understand state requirements for a view.
- Use `analyzeRulePlacement` / `classifyRulePlacement` to diagnose whether a rule can be evaluated on client, server, SQL, or only as degraded fallback.
- Existing `FormField.editableWhen?: Rule` should be integrated with the new `enabled_when` / `readonly_when` model rather than replaced.
- Existing `EditorFieldOverride.visible_when?: Predicate` should either remain expression-level or be migrated to a union that also accepts `Rule`.

New diagnostics:

- `ui:visibility-not-boolean`
- `ui:condition-rule-unregistered`
- `ui:condition-uses-unavailable-state`
- `ui:auth-rule-used-as-authoritative-client-check`
- `ui:rule-not-client-placeable`
- `ui:rule-degraded-to-server-hint`

### Expressions

Expressions should power computed props, default values, validation, and target-specific compiled expressions.

Implementation notes:

- `UiExprValue<T>` wraps `Expr<T>` and exposes refs for lifecycle checks.
- Use `containsOpaqueJs` to reject or warn for JSON Render/catalog targets that cannot safely evaluate opaque code.
- Use `Expr.value_type` and `SemanticType<T>` to validate prop and action input compatibility.
- Avoid adding separate UI predicate builders if existing `gen.expr` and `gen.rule` are sufficient.

New diagnostics:

- `ui:expr-type-mismatch`
- `ui:expr-opaque-js-unsupported`
- `ui:expr-ref-not-in-state-model`

### Functions And Actions

UI actions should be typed wrappers around `ActionFunction`, not string action names.

Implementation notes:

- `UiActionBinding` should preserve `<In, Out>` from `ActionFunction<In, Out>`.
- Check action registration against `ctx.action_functions`.
- Check action input values against `input_type` / `input_fields`.
- Use `deriveMutationAccessPlan(action, ctx.policies)` for warnings about missing access coverage.
- Use `deriveDefaultOptimisticPlan` / `ReactiveMutation` for optimistic UI plans.
- Lower action bindings to JSON Render actions, JSX handlers, route actions, or server actions depending on target.

New diagnostics:

- `ui:action-input-mismatch`
- `ui:action-not-registered`
- `ui:action-not-client-callable`
- `ui:unsafe-ai-action-exposed`
- `ui:action-missing-access-policy`
- `ui:action-optimistic-plan-missing`

### Authz

Authz integration must be explicit about authority.

Implementation notes:

- `gen.authz.surface.uiHint` already exists. Use it for policies that intentionally expose UI hints.
- Do not infer server authorization from UI visibility.
- Add safety policy options for AI/catalog export: allowed actions should be filtered by access surfaces and/or explicit allowlist.
- For forms, `fieldWrite` policies and `FormField.editableWhen` should influence disabled/read-only state but never replace server checks.

New diagnostics:

- `ui:auth-hint-without-server-policy`
- `ui:client-visible-deny-behavior-authoritative`
- `ui:form-field-write-policy-missing`

### Reactivity

Views should declare state dependencies through bindings; those dependencies can derive reactive resources and invalidation behavior.

Implementation notes:

- State model entries can point to `ReactiveResource`, `QueryFunction`, or `Form`.
- `UiActionBinding` can point to `ReactiveMutation` or derive one from the action.
- Use existing `affectedResourcesForMutation`, `affectedRoutesForMutation`, `affectedFormsForMutation`, and `deriveRuleInvalidationPlans` to generate target refresh behavior.
- For JSON Render, lower state reads to JSON Pointers and actions to catalog actions; actual refresh runtime is target registry code.
- UI should add graph nodes for views only if we need view-level stale analysis. The existing graph already covers query functions, action functions, resources, mutations, routes, forms, events, and subscriptions.
- A view bound to `ReactiveResource` should be considered bound to `resource.query` for stale planning.
- A view bound to `ResourceAll` should be considered bound to every branch resource.
- A view event bound to `ReactiveMutation` should participate in `deriveSingleFlightPlan` without any target-specific refresh heuristics.
- Rule-derived reactivity can explain why a mutation invalidates a visibility/editability rule; UI diagnostics should surface that as a hint rather than creating another invalidation engine.

New diagnostics:

- `ui:state-resource-unregistered`
- `ui:binding-stale-after-action`
- `ui:mutation-does-not-invalidate-bound-resource`
- `ui:resource-query-missing-key`
- `ui:mutation-refresh-plan-unresolved`

### Reactions

Reactions are already the auto-reaction primitive. UI should not implement a separate watcher or automation system.

Implementation notes:

- A UI view can display reaction configuration, status, or controls, but execution remains in `src/reaction/reaction.ts`.
- If a UI event needs to trigger effectful work, prefer an `ActionFunction` or `ReactiveMutation`. Use `Reaction` only for rule-driven automatic effects.
- If a generated UI exposes reaction controls, it should respect `Reaction.delivery`, `Reaction.idempotency`, and `Reaction.mode` diagnostics.
- `Reaction.select` should be treated like any other `ExprFunction`: check registration, input/output semantic compatibility, and target capability.
- `maintain` reactions may become future materialized UI state, but MVP should only cite them as dependencies.

New diagnostics:

- `ui:reaction-not-registered`
- `ui:reaction-inline-effect-exposed`
- `ui:reaction-select-target-unsupported`

### Forms, Lists, Editors, And Admin

Do not duplicate these surfaces inside the new view tree. They should become producers and consumers of the shared UI primitives.

Implementation notes:

- Forms should produce a view tree from `Form.fields` and `Form.slots` for targets that need complete rendering specs.
- Lists should lower to view tree nodes with table components, columns, row actions, empty/loading/error states, and reactive query state.
- Editors should lower to composed view trees with forms, preview components, sections, commands, and nested editor nodes.
- Admin should lower to a top-level shell view tree plus `AppRoute` or admin route artifacts.
- Keep high-level modules because they encode domain intent better than raw trees.

Potential helpers:

- `gen.ui.fromForm(form)` returns `ViewTree` or `UiNode`.
- `gen.ui.fromList(list)` returns `ViewTree` or `UiNode`.
- `gen.ui.fromEditor(editor)` returns `ViewTree` or `UiNode`.
- `gen.ui.fromAdmin(admin)` returns a shell `ViewTree` and route plan.

## Target Architecture

Use the existing plugin/target system rather than a separate UI target registry.

Recommended shape:

- Add `UiRenderableInput` static node kind or plugin target input kind for `View`, `ComponentCatalogEntry`, `Form`, `List`, `Editor`, and `Admin`.
- JSON Render target accepts `View`/catalog/state/action inputs and emits catalog/spec/registry artifacts.
- JSX/Solid targets accept the same IR and emit component source.
- Admin target can remain high-level and lower through lists/editors/forms.

Potential target helpers:

```ts
export interface UiTargetCapabilities {
  readonly supports_slots: boolean;
  readonly supports_two_way_binding: boolean;
  readonly supports_repeat: boolean;
  readonly supports_runtime_computed: boolean;
  readonly supports_rule_conditions: boolean;
  readonly supports_opaque_js: boolean;
  readonly event_model: readonly UiEventName[];
}

export interface UiLoweringResult {
  readonly artifacts: readonly Artifact[];
  readonly diagnostics: readonly Diagnostic[];
}
```

But keep actual generation as plugin `TargetContribution.generate` to match `lifecycle.generate`.

Plugin shape sketch:

```ts
const jsonRenderPlugin = gen.definePlugin({
  id: "json-render",
  namespace: "jsonRender",
  contributions: {
    targets: [
      {
        name: "json-render",
        accepts_inputs: ["ui.view", "ui.catalog", "ui.app"],
        check(input) {
          return checkJsonRenderLowerability(input);
        },
        generate(input) {
          return generateJsonRenderArtifacts(input);
        },
      },
    ],
    helpers: [
      // Optional gen.jsonRender.* helpers for target-specific policy and preview.
    ],
  },
});
```

Potential plugin helpers:

- `gen.jsonRender.catalog(viewOrCatalog, options)` for direct catalog artifact derivation.
- `gen.jsonRender.spec(view, options)` for direct spec artifact derivation.
- `gen.jsonRender.safetyPolicy(input)` for target-specific safety configuration.
- `gen.jsonRender.registry(input)` for runtime registry artifact hints.
- `gen.jsonRender.path(path)` for debugging path lowering only, not primary app authoring.

These helpers should be optional conveniences. The main path should be normal lifecycle target generation.

## JSON Render Target

JSON Render should be a target package or plugin, not the core UI representation.

The JSON Render target should be considered successful if it can consume only core UI IR plus target options and emit valid JSON Render artifacts. It should not require users to write JSON Render-specific object shapes in app code.

Lowering map:

- `ComponentCatalogEntry` -> JSON Render catalog component with prop schema, slots, descriptions, allowed events.
- `UiStateModel` -> JSON Render state schema and JSON Pointer path table.
- `UiStateValue` -> `{ "$state": "/path" }`.
- `UiItemValue` -> `{ "$item": "/path" }`.
- `UiIndexValue` -> `{ "$index": true }` or target-specific equivalent.
- `UiTwoWayBinding` state -> `{ "$bindState": "/path" }`.
- `UiTwoWayBinding` item -> `{ "$bindItem": "/path" }`.
- `UiRepeatNode` -> JSON Render repeat block.
- `UiTemplateValue` -> JSON Render `$template`.
- `UiComputedValue` -> JSON Render `$computed` plus catalog function registration.
- `Rule` / `RuleExpr` -> JSON Render visibility condition when translatable.
- `UiActionBinding` -> catalog action reference plus args.

Limitations to diagnose:

- Opaque `StaticFunction` may not be portable.
- Some `RuleExistsExpr` or relation-dependent rules may not be expressible client-side.
- Two-way binding to read-only fields or server-only semantic types must be rejected.
- Components unsupported by the target registry should be rejected.

Target-specific diagnostics should use `ui:json-render-*` codes when the problem is specifically JSON Render lowerability, and generic `ui:*` codes when the problem is target-independent.

## Namespace Changes

Extend `BaseUiNamespace` in `src/gen/types.ts` and the `createBaseUiNamespace` helper in `src/gen/ui-backends.ts` with new constructors while preserving current API.

Suggested additions:

```ts
gen.ui.catalog.component(...)
gen.ui.slotSpec(...)
gen.ui.element(...)
gen.ui.text(...)
gen.ui.fragment(...)
gen.ui.repeat(...)
gen.ui.when(...)
gen.ui.stateModel(...)
gen.ui.state(...)
gen.ui.resource(...)
gen.ui.query(...)
gen.ui.item(...)
gen.ui.index(...)
gen.ui.value(...)
gen.ui.bindState(...)
gen.ui.bindItem(...)
gen.ui.expr(...)
gen.ui.rule(...)
gen.ui.computed(...)
gen.ui.template(...)
gen.ui.action(...)
gen.ui.mutation(...)
gen.ui.navigate(...)
gen.ui.on(...)
gen.ui.fromForm(...)
gen.ui.fromList(...)
gen.ui.fromEditor(...)
```

Binder considerations:

- Constructors that define top-level objects should register into `ctx`: component catalog entries, state models if we add a collection, views.
- Leaf builders like `element`, `state`, `resource`, `item`, `computed`, `action`, `mutation`, and `on` should stay pure and not mutate context.
- If adding new root collections to `GenContext`, update `createGen`, `lifecycle.registerBuiltInModuleCheckers`, and namespace binders together.
- `gen.ui.query(query, input)` should not auto-register a `ReactiveResource` unless it is explicitly a context-bound constructor. Prefer returning a binding node and letting diagnostics require keys/resources for generated refresh behavior.

## Diagnostics Plan

Add a dedicated `checkUiTree` or extend `checkUi` once tree primitives exist. Keep diagnostics in `ui:*` with literal-union code types if the set grows.

High-value diagnostics:

- `ui:component-prop-mismatch`: prop value type is incompatible with component prop semantic type.
- `ui:component-required-prop-missing`: required prop absent.
- `ui:component-unknown-prop`: prop not in component schema.
- `ui:component-unknown-slot`: slot name not declared by component.
- `ui:component-slot-missing`: required slot absent.
- `ui:slot-not-supported`: target cannot render a slot/capability.
- `ui:state-path-not-found`: binding path cannot resolve in state model.
- `ui:binding-type-mismatch`: binding value type incompatible with prop/action/form target.
- `ui:two-way-binding-readonly`: two-way binding targets read-only field/path.
- `ui:repeat-source-not-array`: repeat source is not array typed.
- `ui:repeat-key-missing`: repeat lacks stable key for target requiring keys.
- `ui:visibility-not-boolean`: condition is not boolean typed.
- `ui:action-input-mismatch`: event action input does not match action input type.
- `ui:action-not-client-callable`: action has server-only requirements/effects for a client target.
- `ui:computed-function-not-registered`: computed function missing from context.
- `ui:target-cannot-render-component`: target registry lacks component.
- `ui:json-render-expression-unsupported`: lowering to JSON Render cannot express a node/expression/rule.
- `ui:unsafe-ai-action-exposed`: AI catalog exposes action without explicit allowlist/access surface.
- `ui:auth-rule-used-as-authoritative-client-check`: UI visibility used as if it were enforcement.
- `ui:query-binding-without-key`: query binding cannot derive refresh behavior because `query.reactivity.key` is missing.
- `ui:resource-not-registered`: resource binding references a `ReactiveResource` not present in `ctx.reactive_resources`.
- `ui:mutation-not-registered`: mutation binding references a `ReactiveMutation` not present in `ctx.reactive_mutations`.
- `ui:mutation-without-invalidations`: mutation/action binding has no key invalidation metadata.
- `ui:reaction-not-registered`: reaction UI references a `Reaction` not present in `ctx.reactions`.
- `ui:computed-server-effect`: computed expression/function has server-only effects for a client target.

Use `refs` on diagnostics whenever a field/entity/function ref exists.

## TypeScript Inference Notes

Our preferences from `AGENTS.md` apply strongly here.

Rules:

- Every typed IR concept gets a phantom type: `_ts?`, `_props?`, `_item?`, `_state?`, `_element?`, `_slots?`, `_input?`, `_output?`.
- Constructors infer from runtime references; users should not write explicit type args.
- Constructors return narrow types, not broad unions.
- Namespace objects must expose `typeof constructor` signatures to preserve generics.
- Avoid `unknown` defaults where a more specific default is available.
- Tests and examples must not use `as`, `as unknown`, `as any`, or `as import(...)`.
- Internal casts are allowed only to preserve inference through builders or namespace binders, with a short comment.

Key inference helpers:

```ts
type InferUiValue<T> = T extends UiValue<infer V> ? V : never;
type InferComponentProps<C> =
  C extends ComponentCatalogEntry<infer P, unknown, infer S>
    ? S extends Record<string, ComponentSlotSpec>
      ? P
      : never
    : never;
type InferComponentSlots<C> =
  C extends ComponentCatalogEntry<unknown, unknown, infer S> ? S : never;
type InferStateShape<S> = S extends UiStateModel<infer Shape> ? Shape : never;
```

For functions and reactivity, prefer existing helpers instead of duplicating them:

- `InferFunctionInput<F>` / `InferFunctionOutput<F>` from `src/function/function.ts`.
- `InferActionInput<A>` / `InferActionOutput<A>` from `src/function/function.ts`.
- `InferQueryInput<Q>` / `InferQueryOutput<Q>` from `src/function/function.ts`.
- `InferResourceInput<R>` / `InferResourceValue<R>` / `InferResourceState<R>` from `src/reactivity/reactivity.ts`.
- `InferMutationInput<M>` / `InferMutationOutput<M>` / `InferMutationErrors<M>` from `src/reactivity/reactivity.ts`.
- `InferResourceAllValues<R>` and `InferResourceChainOutput<R>` from `src/reactivity/reactivity.ts`.

Component prop typing should allow literals where the prop's TS type matches and `UiValue<T>` where the value computes to the prop type:

```ts
type UiPropValue<T> = T | UiValue<T> | UiTwoWayBinding<T>;
type UiProps<P> = { readonly [K in keyof P]?: UiPropValue<P[K]> };
```

Slot typing should preserve declared slot names:

```ts
type UiSlotChildren<S extends Record<string, ComponentSlotSpec>, E> = {
  readonly [K in keyof S]?: S[K]["many"] extends true ? readonly UiNode<E>[] : UiNode<E>;
};
```

State path typing is the hardest part. Start minimal:

- Entity paths expose `.fields` from the entity.
- Object semantic type paths expose object keys from `SemanticType<{...}>` only through helper types.
- Array paths expose `.items` or a repeat item handle.
- Forms expose form fields by `FormField.name` if known.

Do not overbuild recursive path types in the first PR if they degrade compiler performance. Use entities/forms/resources first because they are the common path.

## Type Safety Strategy

Type safety is not a follow-up task. Every primitive added for generative UI should include compile-time inference tests and should be designed so end users do not write explicit type arguments.

### Inference Rules

- Infer from runtime values: `Field<T>`, `SemanticType<T>`, `ActionFunction<In, Out>`, `ReactiveResource<In, Value, Err>`, `ComponentCatalogEntry<P, E, S>`, and `Rule<Name, Vars>`.
- Preserve phantom types on every new IR value: `_ts?`, `_props?`, `_item?`, `_state?`, `_element?`, `_slots?`, `_input?`, `_output?`, `_error?`.
- Return narrow node types from constructors: `UiFieldValue<T>`, `UiElementNode<P, E, S>`, `UiActionBinding<In, Out>`, not `UiValue` or broad unions unless the function genuinely accepts multiple branches.
- Namespace objects must expose real constructor signatures with `typeof constructor`; do not hand-write wrappers that erase generics.
- Do not accept `string` where a typed ref/path can be provided. String escape hatches should be target/plugin-level or explicitly degraded.
- Use existing inference helpers from `src/function/function.ts` and `src/reactivity/reactivity.ts`; do not duplicate them unless a UI-specific helper is truly different.

### Core Type Patterns

Field values should infer directly from `Field<T>`:

```ts
export interface UiFieldValue<T = never> {
  readonly kind: "ui.fieldValue";
  readonly field: Field<T>;
  readonly _ts?: T;
}

export const uiValue = <T>(field: Field<T>): UiFieldValue<T> => ({
  kind: "ui.fieldValue",
  field,
});
```

Expected user experience:

```ts
const title = gen.ui.value(Post.fields.title);
// UiFieldValue<string>
```

Component props should infer from the component catalog entry:

```ts
type InferComponentProps<C> =
  C extends ComponentCatalogEntry<infer P, unknown, infer S>
    ? S extends Record<string, ComponentSlotSpec>
      ? P
      : never
    : never;
type InferComponentElement<C> =
  C extends ComponentCatalogEntry<unknown, infer E, infer S>
    ? S extends Record<string, ComponentSlotSpec>
      ? E
      : never
    : never;
type InferComponentSlots<C> =
  C extends ComponentCatalogEntry<unknown, unknown, infer S> ? S : never;

type UiPropValue<T> = T | UiValue<T> | UiTwoWayBinding<T>;

type UiProps<P> = {
  readonly [K in keyof P]?: UiPropValue<P[K]>;
};

type UiSlotChildren<S extends Record<string, ComponentSlotSpec>, E> = {
  readonly [K in keyof S]?: S[K]["many"] extends true ? readonly UiNode<E>[] : UiNode<E>;
};

export const uiElement = <
  C extends ComponentCatalogEntry<unknown, unknown, Record<string, ComponentSlotSpec>>,
>(
  component: C,
  input: {
    readonly props?: UiProps<InferComponentProps<C>>;
    readonly slots?: UiSlotChildren<InferComponentSlots<C>, InferComponentElement<C>>;
  },
): UiElementNode<InferComponentProps<C>, InferComponentElement<C>, InferComponentSlots<C>> => {
  // implementation
};
```

Expected user experience:

```ts
gen.ui.element(Card, {
  props: {
    title: gen.ui.value(Project.fields.name),
    padding: "md",
  },
});

gen.ui.element(Card, {
  props: {
    // @ts-expect-error title must be string-compatible
    title: 123,
    // @ts-expect-error padding only accepts declared enum values
    padding: "xl",
  },
});
```

Action bindings should infer from existing function helpers:

```ts
type UiActionInputFor<A extends ActionFunction> = {
  readonly [K in keyof InferActionInput<A>]?: UiPropValue<InferActionInput<A>[K]>;
};

export const uiAction = <A extends ActionFunction>(
  action: A,
  input: UiActionInputFor<A>,
): UiActionBinding<InferActionInput<A>, InferActionOutput<A>> => {
  // implementation
};
```

Mutation bindings should infer from existing reactivity helpers:

```ts
type UiMutationInputFor<M extends ReactiveMutation> = {
  readonly [K in keyof InferMutationInput<M>]?: UiPropValue<InferMutationInput<M>[K]>;
};

export const uiMutation = <M extends ReactiveMutation>(
  mutation: M,
  input: UiMutationInputFor<M>,
): UiActionBinding<InferMutationInput<M>, InferMutationOutput<M>> => {
  // implementation
};
```

Resources should expose existing `ResourceState`:

```ts
export const uiResource = <R extends ReactiveResource>(
  resource: R,
): UiResourceValue<InferResourceState<R>> => {
  // implementation
};
```

Computed values should infer input and output from existing function helpers:

```ts
type UiFunctionArgs<Input> =
  Input extends Record<string, unknown>
    ? { readonly [K in keyof Input]: UiPropValue<Input[K]> }
    : UiPropValue<Input>;

export const uiComputed = <F extends ExprFunction | PredicateFunction | StaticFunction>(
  fn: F,
  args: UiFunctionArgs<InferFunctionInput<F>>,
): UiComputedValue<InferFunctionOutput<F>> => {
  // implementation
};
```

### Type Tests

Add dedicated type tests as features land:

- `tests/ui-component-infer.test-d.ts`
- `tests/ui-state-infer.test-d.ts`
- `tests/ui-action-infer.test-d.ts`
- `tests/ui-resource-infer.test-d.ts`
- `tests/ui-computed-infer.test-d.ts`
- `tests/json-render-plugin-infer.test-d.ts` once plugin helpers exist.

Type tests should verify:

- Prop names autocomplete and unknown props fail with `@ts-expect-error`.
- Prop values accept compatible literals, fields, UI values, bindings, and computed values.
- Slot names autocomplete and unknown slots fail.
- Repeat item type flows into `gen.ui.item(...)`.
- `gen.ui.action(action, input)` rejects invalid input keys and incompatible value types.
- `gen.ui.mutation(mutation, input)` preserves `InferMutationInput` and `InferMutationOutput`.
- `gen.ui.resource(resource)` exposes `InferResourceState`.
- `gen.ui.computed(fn, args)` preserves `InferFunctionOutput`.
- JSON Render plugin helpers preserve types when wrapping core UI IR.

Type tests must not use `as`, `as unknown`, `as any`, or `as import(...)`. If a type test needs a cast, change the public API.

## Implementation Guidance For Future Agents

This section is intentionally explicit. Follow it when implementing the plan so the result extends the existing UI system instead of creating a second UI framework inside the repo.

### Non-Negotiable Rules

- Do not replace `View`, `Component`, `Slot`, `Style`, `Behavior`, `Form`, `List`, `Editor`, or `Admin` in the MVP.
- Do not make JSON Render's schema the core IR.
- Do not expose JSON Render `$state`, `$item`, `$index`, `$bindState`, `$computed`, `$template`, JSON Pointer strings, catalog JSON, or registry names as primary `gen.ui` authoring APIs.
- Do not create UI-specific copies of actions, queries, resources, mutations, computed functions, reactions, auth policies, or invalidation graphs.
- Do not store render callbacks, closures, JSX elements, or runtime component functions in the core UI IR.
- Do not use raw string field paths where `Field<T>`, `UiStatePath<T>`, `ReactiveResource`, `QueryFunction`, or `FormField<T>` can be referenced.
- Do not add target/plugin code to `src/ui/ui.ts` unless it is target-neutral capability/checking metadata.
- Do not add package-manager dependencies directly. Use Vite+ workflows and target/plugin boundaries.
- Do not use casts in tests or examples. If a test needs a cast, the public API is not typed well enough.
- Do not introduce recursive type machinery that noticeably slows `vp check` before the simpler entity/form/resource path types are proven useful.

### Recommended File Responsibilities

Keep each module's job narrow:

- `src/ui/ui.ts`: target-neutral UI IR, pure constructors, and basic UI diagnostics.
- `src/ui/index.ts`: public UI exports only.
- `src/gen/types.ts`: namespace typing, backend extension typing, and new UI constructor signatures using `typeof`.
- `src/gen/namespaces.ts`: namespace assembly. Wire pure builders directly and use binders only for top-level registered values.
- `src/gen/binders.ts`: context-bound registration for top-level views/components/state models only when a context collection exists.
- `src/gen/ui-backends.ts`: existing JSX/TUI backend-specific helpers. Do not put JSON Render core lowering here unless the target is intentionally modeled as a backend extension.
- `src/forms/forms.ts`: form-to-view-tree lowering and form-specific validation/editability preservation.
- `src/list/list.ts`: list/table-to-view-tree lowering, preserving query, columns, pagination, row actions, and bulk actions.
- `src/editor/editor.ts`: editor-to-view-tree lowering, preserving load/create/update/delete actions, field overrides, sections, nested editors, commands, hooks, and `version_field`.
- `src/admin/admin.ts`: admin shell/page/route lowering only; keep high-level admin invariants where they are.
- JSON Render target/plugin module: JSON Pointer serialization, `$state`/`$computed` syntax, catalog/spec/registry artifacts, target-specific diagnostics, and AI catalog output.
- `src/lifecycle/lifecycle.ts`: register checks only after the checker is context-safe and does not create noisy warnings for unused optional UI features.

If implementation appears to require changing many unrelated modules at once, split the work. A correct first PR should be mostly additive.

### Minimal First PR Target

The smallest useful implementation PR is Phase 1 only:

- Add `ComponentCatalogEntry`, `ComponentSlotSpec`, `UiNode`, `UiElementNode`, `UiTextNode`, `UiFragmentNode`, and `ViewTree` to `src/ui/ui.ts`.
- Add pure constructors for catalog entries, slot specs, elements, text, fragments, and view trees.
- Add optional `tree?: ViewTree<E>` to `View` without removing or deprecating `structure`.
- Extend `BaseUiNamespace` in `src/gen/types.ts` and `createBaseUiNamespace` in `src/gen/ui-backends.ts` with the new pure builders.
- Add type tests for component prop inference and slot inference.
- Keep existing UI/backend tests passing.

Do not include state models, actions, resources, repeats, JSON Render lowering, or AI catalogs in the first PR. Those are separate complexity layers.

### Registration Rules

Only top-level authoring objects should mutate `GenContext`:

- Context-bound: `view`, existing `component`, maybe future `catalog.component` if we add a collection, maybe future `stateModel` if registered globally.
- Pure leaf builders: `element`, `text`, `fragment`, `repeat`, `state`, `value`, `item`, `index`, `resource`, `query`, `bindState`, `expr`, `rule`, `computed`, `template`, `action`, `mutation`, `navigate`, `on`.

Do not register leaf nodes. They are part of a view tree and should be stored only by being reachable from a registered `View` or returned value.

If adding a new `GenContext` collection, update all of these together:

- context type and initializer,
- relevant binder,
- namespace type,
- namespace factory,
- lifecycle checker registration if needed,
- tests proving registration and duplicate-name behavior if names must be unique.

### Constructor Shape Rules

Public constructors should return narrow types:

- `uiValue(field)` returns `UiFieldValue<T>`, not `UiValue<T>`.
- `uiElement(component, input)` returns `UiElementNode<P, E, S>`, not `UiNode`.
- `uiAction(action, input)` returns `UiActionBinding<In, Out>`, not a broad event handler union.
- `uiMutation(mutation, input)` returns `UiActionBinding<In, Out>` with `mutation` populated.
- `uiResource(resource)` returns a resource value typed as `ResourceState<Value, Err>`.
- `uiText(value)` returns `UiTextNode`, not `UiNode`.

Accept broad unions in input positions, but preserve narrow types in output positions. This keeps autocomplete and downstream inference usable.

### Prop And Slot Typing Rules

Component props must infer from `SemanticType<P>` and component catalog entries. Avoid `Record<string, unknown>` in public prop inputs.

Good pattern:

```ts
type UiPropValue<T> = T | UiValue<T> | UiTwoWayBinding<T>;

type UiProps<P> = {
  readonly [K in keyof P]?: UiPropValue<P[K]>;
};

type UiSlotChildren<S extends Record<string, ComponentSlotSpec>, E> = {
  readonly [K in keyof S]?: S[K]["many"] extends true ? readonly UiNode<E>[] : UiNode<E>;
};
```

Bad pattern:

```ts
// Bad: loses autocomplete and accepts unknown props.
props?: Record<string, unknown>;

// Bad: loses slot-name checking.
slots?: Record<string, UiNode[]>;
```

Runtime diagnostics still matter. TypeScript can catch authoring mistakes in typed code, but lifecycle checks must still diagnose generated/dynamic IR with missing required props, unknown props, invalid slot names, and wrong slot cardinality.

### State Path Scope Rules

State paths are the easiest place to accidentally build stringly-typed UI. Keep these rules:

- `UiStatePath<T>` stores static `segments`, a `source`, `value_type`, `writable`, and `server_only` metadata.
- Public `gen.ui.state(path)` accepts a typed path, not a JSON Pointer string.
- Public `gen.ui.bindState(path)` requires a writable path.
- JSON Pointer serialization belongs only in a target/plugin lowerer.
- Entity state paths should expose `.fields` keyed by the entity's fields.
- Resource state paths should expose existing `ResourceState<Value, Err>` shape: `status`, `value`, `error`, and `stale`.
- Array/list paths should use a repeat item context or an `.items` helper; do not invent arbitrary `"0"` path segments in public APIs.

Start with simple path sources: `Entity`, `Form`, `ReactiveResource`, `QueryFunction`, and object `SemanticType`. Defer deep recursive object/array path typing if it harms compiler performance.

### Repeat Builder Rules

The repeat callback is a builder macro only. It should be executed immediately to produce static IR and should not be stored.

Recommended approach:

- Create a typed `UiRepeatItem<Item>` placeholder.
- Call the user callback synchronously with that placeholder.
- Store only the returned `UiNode` children and the item metadata.
- Add diagnostics if the item source is not array-like.
- Add target diagnostics if a stable key is required but missing.

Do not store the callback in `UiRepeatNode`. A stored callback is opaque runtime code and cannot be inspected by targets.

### Action And Mutation Binding Rules

UI events are references to existing callable IR:

- `gen.ui.action(action, input)` wraps an `ActionFunction`.
- `gen.ui.mutation(mutation, input)` wraps a `ReactiveMutation` and uses `mutation.action`.
- `gen.ui.navigate(route, params)` references `AppRoute` or route/link IR.
- Static handlers are allowed only as target-gated escape hatches.

Do not represent actions as strings. Target plugins can derive stable action names from `FunctionRef`, `ActionFunction.name`, or target-specific registry options.

Input typing should use `InferActionInput<A>` / `InferMutationInput<M>`. Do not duplicate function inference helpers.

If an action lacks invalidation metadata, core can still create a binding. The target/lifecycle diagnostic should say refresh behavior cannot be derived. Do not silently invent invalidation rules.

### Computed And Condition Rules

Computed values should prefer inspectable expression functions:

- Prefer `ExprFunction<In, Out>`.
- Allow `PredicateFunction<In>` for boolean conditions.
- Allow `StaticFunction<In, Out>` only when target capabilities allow runtime functions.
- Reject or diagnose opaque JS for targets that require static lowering.

Visibility and enabled conditions should normalize to one target-neutral `UiCondition` union. Do not treat UI conditions as authorization.

Use existing rule/expression placement analysis to diagnose whether a condition is client-placeable or only a server hint.

### Diagnostics Severity Defaults

Use conservative severity defaults:

- Prop/slot schema mismatch in registered view tree: error.
- Missing target-required key for repeat: target-specific warning or error depending on target.
- Client binding to `server_only` semantic type: error for client targets.
- Two-way binding to read-only path/field: error.
- Query binding without key metadata: warning in core, target-specific error if target requires refresh derivation.
- Action without access policy: warning unless safety policy requires explicit authorization coverage.
- UI visibility used as authoritative auth: error or high-priority warning.
- Opaque computed function in JSON Render target: target-specific error.

Keep core checks target-neutral. Target checks decide what is fatal for that renderer.

### Runtime Checks Versus Type Checks

TypeScript should catch authoring mistakes in normal code:

- invalid prop names,
- incompatible prop values,
- invalid slot names,
- action input key/value mismatch,
- mutation input key/value mismatch,
- resource state value typing,
- computed function argument mismatch.

Diagnostics should catch graph-level and target-level facts:

- component or function not registered in `ctx`,
- field belongs to the wrong entity scope,
- condition references unavailable state,
- target cannot evaluate a rule/expression,
- server-only values are exposed to client target,
- action is unsafe for AI catalog export,
- target registry lacks a component implementation,
- JSON Pointer path cannot be serialized deterministically.

Do not rely exclusively on type tests. Generated or plugin-created IR can still be structurally invalid at runtime.

### Namespace Preservation

Expose actual constructor types in namespace interfaces:

```ts
export type BaseUiNamespace = {
  element: typeof uiMod.uiElement;
  text: typeof uiMod.uiText;
  fragment: typeof uiMod.uiFragment;
};
```

Avoid wrapper signatures that erase generics:

```ts
// Bad
element: (component: ComponentCatalogEntry, input: object) => UiNode;
```

If a wrapper is required to register into context, cast it back to `typeof constructor` and add a comment explaining that the cast preserves public generic inference through the namespace binder.

### Import And Cycle Guidance

Avoid cycles while adding UI dependencies:

- `src/ui/ui.ts` may import type-only references from entity, semantic types, rules, expressions, functions, reactivity, router, and forms where needed.
- Avoid importing high-level modules like `forms`, `list`, `editor`, or `admin` into `src/ui/ui.ts` for lowering. Put lowering helpers either in those modules or in small adapter modules.
- JSON Render target code may import UI core, but UI core must not import JSON Render target code.
- If a type-only import becomes a runtime cycle, split shared helper types into a smaller module or keep the helper near the consumer.

Do not solve cycles by widening public types to `unknown`, using dynamic import, or storing string IDs instead of typed references.

### Validation Commands

After TypeScript implementation changes, run:

- `vp check`
- `vp test`

For UI type inference changes, `vp check` is mandatory because `*.test-d.ts` files are the main guard against generic erasure.

For Markdown-only changes, tests are optional.

### Examples That Should Work Eventually

These are implementation targets, not necessarily Phase 1 tests:

```ts
const Card = gen.ui.catalog.component({
  name: "Card",
  props: gen.types.object({
    title: gen.types.string(),
    tone: gen.types.enumOf("Tone", ["neutral", "success", "danger"]),
  }),
  slots: {
    default: gen.ui.slotSpec(gen.ui.container(gen.ui.cap("Base")), { many: true }),
  },
});

const view = gen.ui.viewTree({
  name: "ProjectCard",
  root: gen.ui.element(Card, {
    props: {
      title: gen.ui.value(Project.fields.name),
      tone: "success",
    },
    slots: {
      default: [gen.ui.text("Active")],
    },
  }),
});
```

Examples that should fail type checking:

```ts
gen.ui.element(Card, {
  props: {
    // @ts-expect-error title is string-compatible only
    title: 123,
    // @ts-expect-error unknown prop
    missing: "value",
  },
  slots: {
    // @ts-expect-error unknown slot
    footer: gen.ui.text("Footer"),
  },
});
```

### Documentation Comments

Public constructors should have short JSDoc comments that explain:

- what IR node they create,
- whether they mutate context or are pure,
- what type parameter they preserve,
- which existing `gen2` primitive they wrap,
- which diagnostics may apply later.

Keep comments concise. Put architecture rationale in this plan, not in source comments.

## Implementation Sequence

Each milestone should land as a small, checkable slice. The acceptance criteria below are intentionally concrete so progress is measurable and so implementation stays aligned with existing `gen2` primitives.

### Phase 1: Structured Component And Element IR

Goal:

- Replace `View.structure: string` as the only structured representation by adding typed tree nodes, without breaking existing `View`, `Component`, `Slot`, `Style`, `Behavior`, and `Form` APIs.

Files:

- `src/ui/ui.ts`
- `src/ui/index.ts`
- `src/gen/types.ts`
- `src/gen/ui-backends.ts`
- `src/gen/binders.ts`

Work:

- Add `ComponentCatalogEntry`, `ComponentSlotSpec`, `UiNode`, `UiElementNode`, `UiTextNode`, `UiFragmentNode`, `ViewTree`.
- Add pure constructors: `defineComponentCatalogEntry`, `defineSlotSpec`, `uiElement`, `uiText`, `uiFragment`, `defineViewTree`.
- Extend `BaseUiNamespace` in `src/gen/types.ts` and `createBaseUiNamespace` in `src/gen/ui-backends.ts`.
- Add binder for top-level catalog entries only if we add `ctx.ui_component_catalog`; otherwise attach entries through existing `ctx.components` or only via views.
- Extend `checkUi` with prop/slot diagnostics.

Considerations:

- Keep existing tests green by making `tree` optional on `View`.
- Prefer adding `catalog.component` over overloading `gen.ui.component` in the first milestone; overloading can be revisited after usage is clear.
- Do not add target-specific rendering logic here.
- Avoid recursive type helpers that slow the compiler before core ergonomics are proven.

Tests:

- Component prop autocomplete and type rejection.
- Slot name autocomplete and unknown slot rejection.
- No casts in tests.
- Existing UI tests still pass.

Acceptance criteria:

- A user can define a typed component catalog entry with `SemanticType<P>` props and typed slots.
- A user can create `gen.ui.element(Component, { props, slots })` with prop names and slot names inferred from the component.
- Type tests prove incompatible prop literals, incompatible `UiValue<T>`, unknown prop keys, and unknown slot keys fail at compile time.
- `checkUi` emits diagnostics for unknown props, missing required props, unknown slots, and missing required slots.
- The resulting IR contains enough target-neutral metadata for a plugin to generate a component catalog without inspecting arbitrary user code.
- Current `gen.ui.view`, `gen.ui.component`, style attachment, behavior attachment, form tests, and backend namespace tests continue to pass.
- No public examples or tests require casts.

### Phase 2: State, Bindings, Repeat, Conditions

Goal:

- Add typed UI data bindings while reusing `Field`, `SemanticType`, `Rule`, `Expr`, `ReactiveResource`, and `ResourceState`.

Files:

- `src/ui/ui.ts`
- `src/rules/rules.ts` only if helper types are needed; avoid changes if possible.
- `src/expression/*` only if expression wrappers require exports.

Work:

- Add `UiStateModel`, `UiStatePath`, `UiValue`, `UiTwoWayBinding`, `UiCondition`, `UiRepeatNode`.
- Add constructors: `stateModel`, `state`, `resource`, `query`, `value`, `item`, `index`, `bindState`, `bindItem`, `expr`, `rule`, `when`, `repeat`.
- Extend `checkUi` or add `checkUiTree`.
- Normalize rule/expr/value conditions.

Considerations:

- A `ReactiveResource` binding should expose existing `ResourceState<Value, Err>` fields instead of a UI-specific loading model.
- `query` binding should be a convenience layer; if the query lacks `reactivity.key`, emit diagnostics for generated targets that need refresh behavior.
- `Rule` conditions should be client hints unless paired with server-side auth/policy enforcement.
- Repeats should keep callback execution at definition time and store only static children, not closures.

Tests:

- Field binding keeps TS type through props.
- Repeat rejects non-array source diagnostically.
- Visibility condition rejects non-boolean values.
- Server-only semantic type cannot be bound to client target.

Acceptance criteria:

- `gen.ui.value(User.fields.name)` preserves `string` through prop assignment.
- `gen.ui.resource(UserResource)` exposes `ResourceState<InferResourceValue<typeof UserResource>, ...>` paths for `status`, `value`, `error`, and `stale`.
- `gen.ui.query(query, input)` works as a binding but warns when refresh behavior cannot be derived from a key.
- `gen.ui.repeat(...)` infers item type and emits `ui:repeat-source-not-array` for invalid sources.
- Type tests prove repeat item values, resource state paths, and state model paths preserve their value types through props and computed values.
- Visibility and enablement conditions accept `Rule`, `Expr<boolean>`, and `UiValue<boolean>` and reject non-boolean values.
- Two-way bindings reject read-only fields and server-only values.
- Core paths expose deterministic `segments` and source identity, but no JSON Pointer strings appear in core public authoring APIs.

### Phase 3: Events, Actions, Computed Values

Goal:

- Bind UI events to existing `ActionFunction` / `ReactiveMutation` and computed props to existing `ExprFunction` / `PredicateFunction` / target-allowed `StaticFunction`.

Files:

- `src/ui/ui.ts`
- `src/function/function.ts` only if function type exports are insufficient.
- `src/reactivity/reactivity.ts` only if helper integration is needed.

Work:

- Add `UiEventBinding`, `UiActionBinding`, `UiNavigationBinding`, `UiComputedValue`, `UiTemplateValue`.
- Add constructors: `on`, `action`, `mutation`, `navigate`, `computed`, `template`.
- Check action registration, action input shape, computed function registration, target callability, and opaque JS.
- Integrate reactivity invalidation diagnostics for bound resources.

Considerations:

- `gen.ui.action(action, input)` should read `action.reactivity`, `action.invalidates`, and `action.optimistic`.
- `gen.ui.mutation(mutation, input)` should prefer `mutation.invalidates` and `mutation.optimistic`.
- `gen.ui.computed` should use `ExprFunction` as the portable path. `StaticFunction` support is target-capability gated.
- Client targets should reuse expression checks such as client/server effects and opaque-JS restrictions.

Tests:

- Action input autocomplete and invalid key rejection.
- Computed output type flows into prop type.
- Unregistered computed/action diagnostics.

Acceptance criteria:

- Event bindings infer action/mutation input shape without explicit generics.
- Invalid action input keys fail in type tests and also produce diagnostics if represented dynamically.
- Type tests prove `gen.ui.action` uses `InferActionInput` / `InferActionOutput` and `gen.ui.mutation` uses `InferMutationInput` / `InferMutationOutput`.
- A mutation-bound event participates in existing invalidation metadata rather than a new UI refresh model.
- Missing invalidation metadata emits `ui:mutation-without-invalidations` or `ui:query-binding-without-key` where appropriate.
- `ExprFunction` computed values lower as typed computed values; unsupported `StaticFunction` usage emits target diagnostics.
- Generated UI can distinguish loading/error/success state from `ResourceState` without custom UI state machinery.
- Action/mutation bindings carry stable function/mutation identity so a plugin can generate registry action names deterministically.

### Phase 4: Reactions And Rule-Derived UI Behavior

Goal:

- Surface automatic behavior and rule-derived editability through existing `Reaction` and rule reactivity APIs, without adding UI watchers.

Files:

- `src/ui/ui.ts`
- `src/reaction/reaction.ts` only if public helper exports are missing; avoid changes if possible.
- `src/reactivity/rule-derived.ts` only if UI-specific derivation helpers are missing.

Work:

- Add optional UI references to `Reaction` where views need to display or configure automatic behavior.
- Add UI checks that cite `checkReactions`, `deriveRuleInvalidationPlans`, `deriveEditableFieldsForRule`, and `deriveEditabilityRulesForField` outputs.
- Add helpers only if they make existing reaction/rule-derived data easier to consume from UI targets.

Considerations:

- Reaction execution remains server/runtime behavior, not UI behavior.
- UI should treat `Reaction.delivery.kind === "inline"` warnings as visibility/management concerns, not as blockers unless target safety policy says so.
- Rule-derived invalidation diagnostics should be surfaced as explanations for why UI resources refresh broadly or conservatively.
- `maintain` reactions may eventually feed materialized UI state but should not be required for MVP.

Tests:

- UI references a registered reaction without duplicating reaction execution semantics.
- Unregistered reaction reference emits `ui:reaction-not-registered`.
- Reaction `select` incompatibility is reported through existing reaction/function checks or UI target diagnostics.
- Editable fields derived from rules can be associated with form fields.

Acceptance criteria:

- UI plan can explain form editability from `FormField.editableWhen` and rule dependencies.
- UI plan can report that a mutation affects visibility/editability rules using `deriveRuleInvalidationPlans`.
- No new UI-specific reaction runner, watcher, or scheduler is introduced.
- Existing reaction tests continue to pass.

### Phase 5: Lowerers And Targets

Goal:

- Add target lowering over the unified UI IR while preserving plugin/target lifecycle architecture.

Files:

- New target/plugin module, likely `src/ui/targets/json-render.ts` or plugin package later.
- `src/core/plugin.ts` only if target input kind support needs widening.
- `src/core/node.ts` if using custom static nodes for UI target inputs.

Work:

- Implement JSON Render catalog/spec/state lowerer.
- Implement path lowering from `UiStatePath` to JSON Pointer.
- Implement rule/condition lowering with diagnostics for unsupported forms.
- Implement action and computed catalog exports.
- Add artifact generation through plugin `TargetContribution.generate`.
- Add a JSON Render plugin that contributes a `json-render` target and optional `gen.jsonRender.*` helpers.

Considerations:

- JSON Render is the first spec target, not the core model.
- JSX/Solid targets should use the same tree/value/action/resource primitives, not separate code paths.
- Target capabilities should determine whether `StaticFunction`, opaque JS, two-way binding, repeat keys, and runtime computed values are allowed.
- JSON Render state paths must be produced from `UiStatePath` / `ReactiveResource` paths, not authored as public strings.

Tests:

- JSON Render artifact shape snapshots.
- Unsupported expression/rule diagnostics.
- Stable JSON Pointer path generation.
- AI catalog allowlist safety diagnostics.

Acceptance criteria:

- JSON Render catalog/spec artifacts can be generated from a view tree with component catalog entries, state/resource bindings, repeat, action/mutation events, and computed values.
- Unsupported rules/expressions/functions emit target-specific diagnostics, not crashes.
- JSON Pointer output is deterministic and derived from typed paths.
- Target generation uses existing plugin `TargetContribution.generate` and lifecycle diagnostics.
- A generated catalog does not expose unsafe actions unless explicitly allowed.
- Users can generate JSON Render artifacts without writing JSON Render-specific `$state`, `$computed`, `$bindState`, or JSON Pointer strings in app IR.
- JSON Render-specific helpers are exposed through plugin namespace, not base `gen.ui`.
- Type tests prove JSON Render plugin helpers do not erase core UI IR generics.

### Phase 6: Forms, Lists, Editors, Admin Lower To View Trees

Goal:

- Make existing high-level UI surfaces produce the shared tree/value/action/resource IR for targets that need full render specs.

Files:

- `src/forms/forms.ts`
- `src/list/list.ts`
- `src/editor/editor.ts`
- `src/admin/admin.ts`
- `src/ui/ui.ts`

Work:

- Add `fromForm`, `fromList`, `fromEditor`, `fromAdmin` helpers.
- Reuse `controlFor`, `widgetCapability`, `ListColumn`, `EditorSection`, and `AdminRoute`.
- Avoid replacing high-level IR; lower it for render targets.

Considerations:

- Forms already bind to `ActionFunction`; lower submits through `gen.ui.action` / `gen.ui.mutation` semantics.
- Lists already bind to `QueryFunction` and row/bulk `ActionFunction`s; lower query state through resource/query bindings and row actions through action/mutation bindings.
- Editors already compose load/create/update/delete actions, forms, preview components, sections, hooks, and nested editors; lower these concepts rather than reconstructing from raw entity fields.
- Admin already composes lists/editors/routes; lower it to shell tree and app/admin route artifacts.

Tests:

- Auto form emits equivalent fields and a view tree.
- Auto list emits table/repeat/action nodes.
- Editor visible predicates flow to UI conditions.
- Admin emits shell/routes without duplicating page names.

Acceptance criteria:

- `gen.ui.fromForm(form)` preserves form fields, widgets, validation, error mappings, submit action, and editability rules.
- `gen.ui.fromList(list)` preserves query binding, columns, sorting/filtering metadata, row actions, bulk actions, loading/empty/error states, and pagination.
- `gen.ui.fromEditor(editor)` preserves load/create/update/delete actions, sections, commands, nested editors, preview components, hooks, default values, version field, and visible predicates.
- `gen.ui.fromAdmin(admin)` preserves page/routes/navigation structure and does not duplicate high-level admin invariants.
- Existing form/list/editor/admin tests continue to pass.

### Phase 7: AI-Safe Catalog Generation

Goal:

- Generate AI-safe component/action/data/function catalogs from actual registered capabilities.

Files:

- JSON Render target/plugin module.
- Possibly `src/ui/ui.ts` for `UiSafetyPolicy` and `UiGenerationPolicy`.

Work:

- Add optional `UiSafetyPolicy` that controls allowed components, actions/mutations, resources, computed functions, and state paths.
- Generate prompt/catalog metadata from `ComponentCatalogEntry`, `ReactiveResource`, `ActionFunction`, `ReactiveMutation`, `ExprFunction`, `Rule`, and target capabilities.
- Filter actions through authz surfaces and explicit allowlists.

Considerations:

- Default should be conservative: do not expose all actions to AI-generated specs automatically.
- Catalog entries should include semantic descriptions, prop schemas, slot schemas, event names, state/resource paths, and safe computed functions.
- If a catalog references `StaticFunction`, target/runtime capabilities must say it is safe.

Tests:

- Unsafe actions are excluded by default or diagnosed.
- Allowlisted actions appear with typed input schemas.
- Server-only fields/state paths are excluded or diagnosed.
- Catalog prompt/spec output is deterministic.

Acceptance criteria:

- A generated AI catalog includes only registered, allowed, target-renderable components and safe callable capabilities.
- `ui:unsafe-ai-action-exposed` fires when an action would be exposed without explicit safety policy or suitable auth surface.
- Generated catalog can be consumed by the JSON Render target without manual string IDs.
- Safety policy is target-neutral in core and can be refined by the JSON Render plugin for JSON Render-specific catalog/prompt output.

## Open Questions

- Should component catalog entries be stored in a new `ctx.ui_components` collection, or should they be represented as enhanced `Component` values in existing `ctx.components`?
- Should `View.structure: string` be deprecated immediately after `View.tree` lands, or kept indefinitely as a target-specific escape hatch?
- Should `EditorFieldOverride.visible_when` migrate from `Predicate` to `Predicate | Rule | UiCondition`, or should editor keep expression predicates and only lower them into UI conditions?
- Should `UiStateModel` be a root registered object in `GenContext`, or only owned by `ViewTree`?
- Should `ReactiveResource` bindings require resources to be pre-registered, or should context-bound `gen.ui.resource(query)` derive and register a resource from a keyed query?
- Should UI view nodes be added to `ReactiveGraphNodeKind`, or is binding analysis enough without graph nodes for views?
- Should `gen.ui.action` automatically find a registered `ReactiveMutation` for the action, or should `gen.ui.mutation` be explicit to avoid surprising behavior?
- Should query/resource loading state be directly `ResourceState<Value, Err>` in generated component props, or should targets adapt it to idiomatic framework primitives at lower time?
- Should reactions be visible in AI catalogs at all, or only through explicit management/admin surfaces?
- How strict should prop semantic type compatibility be: exact `SemanticType.name`, compatible `SemanticKind`, or TypeScript `_ts` plus optional runtime warning?
- Should the JSON Render plugin live in `src/ui/targets/json-render.ts` initially as an in-repo plugin, or in a package-style plugin folder once plugin packaging is more mature?
- What target input kind names should plugin targets accept: `ui.view`, `ui.catalog`, `ui.app`, `admin`, or existing node kinds?
- Should JSON Render plugin helpers be under `gen.jsonRender.*`, `gen.ui.jsonRender.*`, or purely target/lifecycle based with no helpers?
- What is the preferred public name: `gen.ui.catalog.component`, `gen.ui.componentSpec`, or extending existing `gen.ui.component` with an overload?
- Do we want AI catalog generation in MVP, or after JSON Render lowering is working?

## Non-Goals For MVP

- Do not support arbitrary runtime JavaScript in specs as a default path.
- Do not make UI visibility enforce authorization.
- Do not replace existing forms/lists/editors/admin modules.
- Do not build a full recursive TypeScript path DSL before validating compiler performance.
- Do not add package-manager or framework dependencies directly; use Vite+ and plugin/target boundaries.
- Do not put JSON Render `$state`, `$computed`, `$bindState`, or JSON Pointer strings into core `gen.ui` authoring APIs.
- Do not require app authors to write JSON Render catalog/spec objects by hand to use the JSON Render target.

## Validation Commands

After implementation changes, use Vite+ wrappers:

- `vp check`
- `vp test`

Avoid direct `npm`, `pnpm`, `yarn`, `vitest`, or `vite` invocations.
