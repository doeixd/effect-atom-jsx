---
name: architecture-reference
description: "Deep reference on effect-atom-jsx/Affe typed tags, views, templates, props/components, actions/mutations/queries, and the json-render proposal"
metadata: 
  node_type: memory
  type: reference
  originSessionId: ef257716-cc93-4a2a-968a-f24ffbad2247
  modified: 2026-07-30T11:24:37.839Z
---

# effect-atom-jsx (Affe) architecture reference (as of 2026-07-30)

Verified against source by exploration agents; line anchors approximate (heavy churn on branch agent/resumability-foundation).

## 1. Component model

`Component<Props, Req, E, Bindings, SlotContract>` — callable 5-axis type (src/Component.ts:211). Axes: Props (caller-owned config), Req (Effect service requirements), E (typed errors), Bindings (setup-created private committed state), SlotContract (authored public attachment surface).

**Commit model**: Props → setup Effect (async resolves here) → committed Bindings snapshot → view renders `(props, bindings) => unknown` from snapshot → style/behavior effects attach after. Invariant: view never sees partial async state; explicit async UI uses `Result<A,E>` bindings. (docs/archive/PROPS_BINDINGS_SLOTS.md, BINDINGS_ASYNC_COMMIT_BOUNDARY.md)

**Builders**: `Component.setup<Props>()` then `.bind(name, f)` (async), `.value(name, f)` (sync), `.doEffect(f)`, `.use(fragment)`; steps recorded in an inspectable SetupPlan (drives resume policies). Factories: `Component.make(propSpec, req, setup, view)`, `.headless(...)` (view via props.children), `.from(fn)`. Props typed via `Component.props<P>()` or `Component.propsSchema(schema)`.

**Wrappers**: `withSlots` (publishes View.Slots contract), `withActivation` (resume metadata; must be terminal — `Resume.addressable(...)` last), `withBehavior` (records descriptor w/ codeIds). `SlotsOf<T>` = runtime handle map; `SlotContractOf<T>` = authored contract metadata.

## 2. Typed views / slots / tags

**View<Slots>** (src/View.ts:175): `{ slots, node: unknown, tree?: ViewNode<Slots>, name?, metadata?, slotMetadata?, slotRemaps? }`, pipeable.

**Slot witnesses**: `Slot.Slot<Name, Capability, Events, Attributes, Requirements, Hidden>`; `Slot.make`, `Slot.bind(slot, handle)` with compile-time `BindableHandle` capability checking. `Slots.define({root: {capability: Container}, ...})` creates witnesses + binds default handles by capability (TextInput→Element.TextInput, Container→Element.Container, etc.). `Slots.HandlesOf<S>` projects to handle map.

**Typed tree**: `ViewNode = ViewElement | ViewTextNode | ViewFragment | ViewHoleNode` (holes: text/class/style/html/event/children). Constructors: `View.make` (low-level), `View.fromSlots` (authored, auto minimal fragment tree), `View.fromJsx`, `View.tree`. Pipeable transforms: withTree/withChildren/appendChildren/withName/withMetadata/withSlotMetadata/withRemaps. `View.hidden(name)`, `View.remap(source, target)`.

**Diagnostics**: codes `view:unknown-slot|hidden-slot|remap-capability-mismatch|unsupported-slot-capability|unsupported-slot-event|unsupported-slot-attribute|missing-platform-requirement`; validators `validateSlotTargets/validateRemaps/validateTree/validatePlatform`. `View.platform(metadata)` yields a PlatformService layer with onDiagnostic hook.

**Element handles/capabilities** (src/Element.ts): `Handle` = {id, listen/on/emit, setAttr/getAttr, setStyle/...} all Effect-returning. Capability hierarchy: Base → Interactive → Container/Focusable/Draggable; Focusable → TextInput; Collection. `Capability.make(name, {extends})`, DFS `extendsCapability` check. There is NO per-JSX-tag capability inference — capabilities are author-declared in Slots.define, not derived from tag names.

**MetadataToken** (src/MetadataToken.ts): branded `{kind, name}` tokens used for View.Event (Press/Click/Input/Focus/Blur/Hover), View.Attribute (AriaLabel/Role/Disabled/...), View.Requirement (Keyboard/Pointer/Clipboard), Style.Property, Element.Capability.

## 3. JSX / templates / dom runtime

- `src/jsx-runtime.ts`: types-only `jsx/jsxs/jsxDEV/Fragment`; babel-plugin-jsx-dom-expressions does the real transform. Per-tag typed IntrinsicElements (`ButtonHTMLAttributes` etc.), `Reactive<T> = T | (() => T)`, typed `EventHandler<Target, EventType>`.
- `src/dom.ts` compiler ABI: `template(html)` returns lazy per-document-cached clone factory (SSR: ServerNode virtual DOM with toHTML(); browser: template element cloneNode). `insert(parent, accessor, marker, current)` wraps accessors in Computation, reconciles, and integrates resumable expressions via `observeRenderedExpression`. Setters: setAttribute/setBoolAttribute/setProperty/className/classList/style/setStyleProperty. `createComponent(Comp, props)` = reactive root + untracked run. Event delegation via `$$eventName` props + `delegateEvents`. `render/renderWithHMR`, `renderToString`, `hydrateRoot` — note pinned finding: JSX output is hydratable:false, so hydrateRoot is eager rerender (M8c.0 baseline).
- `src/runtime.ts` is the barrel (template/insert/effect/memo/createSignal/For/Show/Async...).

## 4. Styles / theme

`Style.Property` tokens; StyleValue is a 17-piece union (SlotPiece, ConditionalPiece, BindingConditionalPiece, States/Responsive/Animation/Nest/Vars/Media/Supports/Container/Pseudo/Grid/Layer/Global/Extend...). `ComposedStyle<S, Bindings>` carries a `_bindings` witness so `Style.whenBinding(binding, predicate, piece)` is checked against component bindings. Authored path: `Style.forSlots(Slots)({...})`, attach via `Style.attachToSlots`. Theme: `Theme.define(tokens)` → ThemeService {tokens, mode atom, resolve}; two-level lookup (`color.X`/short names); `Theme.layer(tokens)`.

## 5. Actions / mutations

`Component.action(fnOrBoundCode, options)` → `Effect<ComponentAction<Args, A, E>, never, R>` (src/Component.ts:~1515). ComponentAction is callable + `run/runEffect/effect`, plus `result: Accessor<Result<void,E>>` and `pending`. Options: `reactivityKeys` (invalidated on success via Atom.invalidateReactivity), `concurrency: "switch"|"queue"|"drop"|{max}`, `onTransition`, `detached`. Implementation wraps `defineMutation` (effect-ts.ts) with setup-scope-alive guards. Portable path: `Portable.code({id, buildId, captures: Schema, run})` → `Portable.bind(code, captures)` → BoundCode accepted by action/query; annotated "component-action" for resume manifests.

**Optimistic**: `Component.optimistic(writableAtom).action({update, effect, reconcile})` — apply update immediately, run effect, reconcile on success, rollback on failure; handle has run/runEffect/effect/rollback/clear.

**Single-flight**: SingleFlightTransportService.execute sends mutation + revalidated loaders in one round trip (wire validation is Router R5 work).

**Resumable dispatch**: `Resume.event(...)` = portable zero-arg deferred dispatch; `Resume.activationEvent(...)` = mouse-v1 projection captured pre-activation and replayed exact-once after activation commit. EventAttachment union kinds: "portable"/"activation".

## 6. Queries / reactivity

`Component.query(boundCodeOrThunk, options)` → `QueryAtom<A, E|RetryError> = ReadonlyAtom<Result<A,E>> & InspectableQueryHandle`. Options: name, reactivityKeys, retrySchedule, pollSchedule (retry/poll unsupported for portable snapshot restore → fallback). `Atom.ResultAtom<A,E,R>` is canonical name.

Result model (core, src/effect-ts.ts): Loading | Refreshing{previous} | Success{value, exit} | Failure{error, exit} | Stale{error, data, exit} | Defect{cause, rawCause}. As of 2026-07-30: `src/result-wire.ts` is the single wire projection (toWire/fromWire, injectable now); Result.builder/Result.all live in core; FetchResult deletion is slices 4-5 pending.

Reactivity: `Reactivity.Key.make/family` branded witnesses; `Reactivity.tracked(effect,{keys})` capture; `Reactivity.invalidating` / `Atom.invalidateReactivity` broadcast. Runtime capture stacks + normalizeReactivityKeys in reactivity-runtime.ts. Ratified M8 decision: dependency identity is semantic reactivity keys ONLY; binding hydration keys (`af:binding:id/name`) double as implicit reactivity keys; signal core stays identity-free.

## 7. JSON-render proposal (docs/af-ui-json-render/, future)

Four docs copied from ../gen2 as reference: README, gen-ui.md (motivation + 9 IR primitives), ui-dialect-af-ui-json-render.md (gen2 dialect mapping, 1459 lines), gen-ui-implementation-plan.md (4-phase plan, 1733 lines).

**Core thesis**: don't make JSON Render's JSON schema the core model — build a typed semantic UI IR (catalog entries, view tree nodes, typed state paths, binding/computed/action IR), then *lower* to JSON Render (`$state`/`$bindState`/`$template`/`$computed` + JSON Pointers) as one target among many (React/Solid/RN/TUI/email). AF-UI = authoring/type system; JSON-Render = serialization/target.

**Key IR shapes**: `ComponentCatalogEntry<P,E,S>` (props SemanticType, slots, allowed_events, target_platforms); `UiNode = element|text|fragment|repeat|conditional` with visible_when/enabled_when; `ViewTree{root}`. Bindings via typed refs (never raw string paths in core); actions reference stable ActionFunction/portable IDs, never closures — which makes the tree resumability-friendly by construction.

**Alignment**: complements (not conflicts) archive/TYPED_VIEW_TREE_PLAN.md — that plan's optional `tree?: ViewNode` on View is already implemented; gen-ui plan is the fuller Phase 1-4 roadmap (catalog/tree → state models/values → repeat/actions → JSON Render plugin). Non-negotiables: don't replace existing View/Component/Slot surfaces; no closures/JSX in core IR; typed refs in, target-specific strings out; slots > props for attachment. Gen2 mapping: ViewNode→graph nodes, slot attachment→edges, capabilities→traits, validators→verify passes.

Status: purely a proposal/reference; no implementation started in this repo. Related direction note: slot-as-projection-element (memory #41) would unify slot contracts with resume region identity — pairs with this after M11/M11b.

## Related memories
[[no-fable-subagents]] — subagent model policy. OptMem project memory holds the resumability milestone history.
