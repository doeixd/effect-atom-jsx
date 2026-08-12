# Component Kit Plan (working name: @affe/kit)

Date: 2026-07-29 (revised 2026-07-30)
Status: active — K0 adapter landed (machine *resume binding* shape still
owed); K0b in progress — the two Known defects (Schema defaults + typed
decode; pipeable `Behavior`) are FIXED 2026-08-12 and the first six
`behavior-catalog.spec.ts` specs are green; the deps channel landed
2026-08-12 (`DQ-052` both halves: `Behavior<…, Deps>` axis with
`make((elements, deps) => …)`, `attachScoped(behavior, elements, { deps })`,
`compose` intersecting member deps, and `Behavior.attachTo(behavior, remap)`
per `DQ-051` resolving deps from the component's own bindings — 8/13 specs
green); `dismissableLayer` + `anchorPosition` landed 2026-08-12 — the
load-bearing five all exist as Schema-option factories, and
`behavior-catalog.spec.ts` is 12/13 with only the deliberate K0c Mixin
placeholder red. `DismissLayerStack` is a Context service (fresh stack per
Layer provision, never a module global); `anchorPosition` takes injected
`measure`/`autoUpdate` seams (handles carry no geometry — the DOM adapter
supplies floating-ui; attaching with no seam fails closed as
`AnchorPositionMeasureError`). Next: Mixin module (K0c, designed), recipe
merge (K1). API decisions previously left open were ratified 2026-07-30 in
the two foundation sections.

A first-party component library with the combined power of Radix/Base
UI/shadcn (headless accessible primitives + distribution), Zag.js (typed
widget state machines), and StyleX/Panda/Tailwind (token-driven, statically
extractable styling) — built **entirely from the framework's native
primitives**, because the inside-out architecture was designed for exactly
this: components as compositions of slot contracts, behaviors, styles, and
a11y patterns attached from outside.

## Foundations (read first)

Two layers must be **typesafe, composable, and extensible from outside**,
or the no-fork guarantee fails and people vendor source:

1. **Behaviors** — interaction wiring (catalog is the real product).
2. **Styles / recipes** — appearance (same story; more already exists).

Widgets are published default stacks of anatomy + machine + behaviors +
recipes. Customization is **re-pipe / Schema options / compose / merge /
replace** — never edit kit files.

**Design decision (2026-07-29): Effect-native extension, not a bespoke
`.define` / `.extend` / hooks framework.** Affe already has the vocabulary:

| Concern | Mechanism |
| --- | --- |
| Options, recipe data, tokens, wire | **`Schema`** (decode, field merge, defaults) |
| Behavior body | **`Effect`** via `Behavior.make` / `run` |
| Horizontal stack | **`Behavior.compose`**, **`Style.compose`** |
| Attach outside | **`attachToSlots`**, `withBehavior`, pipe |
| DI / services | **`Context` + `Layer`** (already kit policy) |
| Machines | **Schema states/events** + `@typeonce/effect-machine` |

Do **not** invent a parallel plugin surface (`hooks`, `around`,
`Behavior.extend`, `recipe.extend` as a second object model). “Extend”
is English: extend the **Schema**, wrap or **compose** the **Effect**,
**merge** the recipe **data**.

**`Mixin`** (designed below) is **optional sugar** for packaging
`tag + options Schema + props + effect/recipe` into a reusable module. It
**desugars** to the Schema + `Behavior` / recipe patterns — it is not a
second runtime. Hand-written `function typeahead(config?)` remains always
valid.

The foundation sections + Mixin design are **priority constraints** for
the plan.

---

## Foundation: behaviors (Schema options + compose)

The kit’s real product is the **behavior catalog**. Catalog items must not
be closed opaque blobs, but they also must not grow a mini-framework.
They ship as **functions** that take **Schema-validated options** (plus
ordinary TS callables where needed) and return `Behavior<…>`.

### What we already have

| Capability | Today (`src/Behavior.ts`) |
| --- | --- |
| Create | `Behavior.make` / `forSlots` |
| Horizontal stack | `Behavior.compose` — order, merge bindings; union `R`/`E`; merge `provides`/`events`/`emits`; portable iff all members are |
| Attach | `attachToSlots` / `attachBySlotContract` / `Component.withBehavior` |
| Contracts | Capability-typed elements; `provides` / `emits` / `events` witnesses |
| Resume | `portable` + `attachScoped` |

Axes: `Behavior<Elements, Bindings, Req, E>` — keep these; don’t replace
them with a factory class hierarchy.

### Split: data vs effect

```
┌──────────────────────────────────────────┐
│  Options / config     → Schema           │  ← “extend” with Schema tools
├──────────────────────────────────────────┤
│  run / attach         → Effect           │  ← wrap, compose, replace
├──────────────────────────────────────────┤
│  provides / emits     → witnesses        │  ← metadata on Behavior
└──────────────────────────────────────────┘
```

Putting `run` inside Schema is wrong. Putting options *outside* Schema
is wrong. Function props (`match`, `getLabel`) are ordinary TypeScript
fields beside the decoded options struct — **not** a hooks registry.

### Customization levels (Effect-native)

| Level | Intent | How |
| --- | --- | --- |
| **1. Options** | Same algorithm, different knobs | `Schema.Struct` + `Schema.decode*` at the factory boundary |
| **2. Compose** | Horizontal stack | `Behavior.compose(a, b)` (existing) |
| **3. Specialize** | Wider options / custom steps / extra bindings | New Schema fields; pass function props; wrap or compose a sibling |
| **4. Replace** | Different algorithm | Don’t call kit factory; compose your own `Behavior.make` |

No OOP subclass. No `typeahead.extend({ hooks })`.

### Target shape (kit catalog)

```ts
import { Effect, Schema } from "effect"
import * as Behavior from "effect-atom-jsx/Behavior"

// --- options are Schema (extend with normal Schema composition) ---
export const TypeaheadOptions = Schema.Struct({
  timeoutMs: Schema.Number.pipe(Schema.withDecodingDefault(() => 500)),
  wrap: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  matchMode: Schema.Literals(["startsWith", "includes"]).pipe(
    Schema.withDecodingDefault(() => "startsWith" as const),
  ),
})
export type TypeaheadOptions = typeof TypeaheadOptions.Type

/**
 * Function props are a SECOND argument, not fields in the options bag
 * (ratified 2026-07-30 — see decision 1 below).
 */
export type TypeaheadProps = {
  readonly match?: (query: string, item: { readonly label: string }) => boolean
  readonly getLabel?: (item: unknown) => string
}

export const typeahead = (
  options_?: Partial<TypeaheadOptions>,
  props: TypeaheadProps = {},
) => {
  const options = Schema.decodeUnknownSync(TypeaheadOptions)(options_ ?? {})
  const match = props.match ?? defaultMatch(options.matchMode)
  const getLabel = props.getLabel ?? defaultGetLabel

  return Behavior.make(/* Elements */, (elements) =>
    Effect.gen(function* () {
      // … buffer, keydown, jump focus using match/getLabel/options
      return { buffer: /* … */ }
    }),
  ).pipe(
    Behavior.provides({ buffer: Behavior.binding<"buffer", string>("buffer") }),
  )
}

// --- app: “extend” without .extend ---
export const FuzzyTypeaheadOptions = Schema.Struct({
  ...TypeaheadOptions.fields, // field merge / fieldsAssign per Effect Schema idioms
  minScore: Schema.Number.pipe(Schema.withDecodingDefault(() => 0.6)),
})

export const fuzzyTypeahead = (
  options_?: Partial<typeof FuzzyTypeaheadOptions.Type>,
  props: { readonly search?: (q: string, item: { label: string }) => number } = {},
) => {
  const opts = Schema.decodeUnknownSync(FuzzyTypeaheadOptions)(options_ ?? {})
  return typeahead(
    { timeoutMs: opts.timeoutMs, wrap: opts.wrap },
    {
      match: (q, item) =>
        (props.search?.(q, item) ?? fuse(q, item.label)) >= opts.minScore,
    },
  )
}

// --- stack (existing Affe) ---
Behavior.compose(
  collection(),
  rovingTabindex({ orientation: "vertical" }),
  fuzzyTypeahead({ timeoutMs: 700, minScore: 0.5 }),
  selectionModel({ mode: "single" }),
)

// extra bindings = compose sibling, not extend surface object
Behavior.compose(
  typeahead(),
  Behavior.make(() => Effect.succeed({ lastQuery: "" })),
)
```

### Ratified API decisions (2026-07-30, found while writing `future/components/` specs)

1. **Config is two arguments: wire-serializable options, then function
   props.** Today's catalog factories take one flat bag (`PressConfig =
   PressOptions & { onPress?… }`, `src/behaviors/press.ts`), so the
   portability boundary runs invisibly through the middle of one object
   literal and `Schema.encodeUnknownSync(PressOptions)(config)` silently
   discards the handlers. Ratified syntactic split:

   ```ts
   press({ trackPressed: false }, { onPress: … })
   // or, where the arity reads badly: press({ options: {…}, on: { press: … } })
   ```

   "Which half crosses the wire" becomes a *type* rather than a convention,
   and `Behavior.portable` has an obvious thing to capture. Rule of thumb 5
   (portability) is now enforced by shape, not by discipline.

2. **A behavior's non-element dependencies get their own channel.**
   `Behavior<Elements, Bindings, Req, E>` has exactly one input channel and
   both typed attachment forms fill it *only from slots* — so `formControl`
   has to smuggle a `Component.state` atom through the `Elements` record,
   and a consumer attaching it must abandon `attachToSlots` for the general
   `Behavior.attach({ select })` escape hatch. That is precisely the
   "forced into an escape hatch" failure the no-fork guarantee exists to
   prevent, and it is the **most common behavior shape** (anything with a
   value / collection / config atom). Ratified: split the channels.

   ```ts
   Behavior.make<Elements, Deps, Bindings, Req, E>((elements, deps) => …)

   Behavior.attachToSlots(formControl(), remap, {
     deps: (bindings) => ({ value: bindings.color }),
   })
   ```

   Slot wiring stays capability-checked; dependencies stay bindings-typed.
   *Alternative considered and rejected*: express dependencies as Effect
   requirements bubbling on `Req` and provide them per attachment — loses
   because requirements are resolved per *layer scope*, not per instance, so
   two sibling attachments of the same behavior cannot take different
   atoms.

3. **`Behavior.compose` is variadic-tuple typed with last-wins binding
   merge.** It is variadic-only with hand-written overloads capped at three
   members, and it types bindings as `B1 & B2`. So the REPLACE story in the
   customization table (last attachment wins on a shared binding name)
   currently types as `{ index: () => number } & { index: () => number }`
   with `kind: "kit" & "consumer"` — which is *not* what the runtime does
   (`Object.assign`; last wins). Ratified: a variadic-tuple signature whose
   binding merge is `Simplify<Override<B1, B2>>`, matching the runtime.
   `Behavior.replaceBinding(name)` may be added later as the explicit,
   self-documenting form; the intersection typing is simply wrong and goes.

4. **Namespacing an attachment is `{ as }`, not an untyped merge
   callback.** `attachToSlots`'s binding-collision merge callback is typed
   `(bindings: any, added: AddedBindings) => any`, so the component's
   `Bindings` axis after a namespaced attach is a lie (it claims
   `Bindings & AddedBindings`). Ratified:
   `attachToSlots(behavior, remap, { as: "header_nav" })` for the
   namespacing case, which is typeable as a prefixed key map; `merge` is
   reserved for genuinely custom folds and must have a properly inferred
   return type.

5. **`DismissLayerStack` is provided once, at the root, and the
   requirement bubbles.** The plan already says layer-stack / liveAnnounce
   are Effect services rather than globals; the *provisioning* was left
   implicit, and that is where it goes wrong. Two independent
   `Effect.provide(DismissLayerStack.layer)` calls build two independent
   stacks, so "Escape dismisses the topmost across two separately-attached
   layers" can only pass if the stack is module-global mutable state — which
   bleeds across concurrent SSR requests. Ratified: the requirement appears
   in `Behavior.RequirementsOf<typeof dismissableLayer>` and thence in the
   assembled component's `Req` axis, and is satisfied by exactly one root
   provision. That bubbling *is* the difference between this and Radix's
   global stack, so it must be visible in the types, not arranged by
   convention.

### Ratified 2026-07-30 — the attachment knot (closes `DQ-050` and `DQ-051`)

These two are **one decision** and must be executed together. They are also the
largest breaking change in the kit: every `Style` and `Behavior` attachment site
moves.

**The rendered `View` is the single source of truth for slots (`DQ-050`).**
`Slots.define` returns a contract/**factory**; handles materialise **once per
instance** (per setup/render `Scope`), not once per module at define time.
`bindings.slots` becomes a *projection of* the rendered view rather than an
independent record, and `Behavior.attachToSlots` switches to view resolution —
matching `Style`, which already resolves through the view.

Chosen because the rendered `View` is the only candidate with a referent that
actually exists in the DOM, and because `DQ-070` (a slot as an addressable
region) is **unreachable** from a setup-owned record. Rejected: making the
setup-owned `bindings.slots` canonical — a smaller diff, but it keeps the
silent-no-op class alive for anything the view renders that setup did not
declare, and puts slot identity in the wrong home.

**The capability contract comes from the component, not the caller (`DQ-051`).**
`Behavior.attachTo(behavior, { container: "root" })`, where the keys are
`keyof Behavior.ElementsOf<typeof behavior>` and the permitted values are the
component's slot names whose capability satisfies the required one. Identity
attachment takes no argument at all. `Behavior.forSlots` must **retain** its
contract (it currently discards it).

This is what makes the headline guarantee — *attaching a text-input behaviour to
a slot lacking that capability is a type error* — true **by construction**.
Today it is unenforced in both directions: the compile-time check is against a
contract the **caller** supplies (and `Element.Handle` is the top of the lattice,
so a Container slot satisfies a TextInput requirement), and the runtime check
never looks at capability at all. Rejected: keeping the caller's contract and
adding a component-side check, because the caller's contract is still what the
behaviour is checked against, so a caller can still widen.

**Sequencing — the backstops land first, and this is not optional.** Both
migrations are hazardous in the same way: `Style` and `Behavior` agree today
*only because* `Slots.define` shares handles module-wide, so fixing per-instance
identity **exposes** the divergence, and styling breaks **silently, with no
diagnostic**. So, in order:

1. Add the `component:slot-target-drift` diagnostic (view slot set vs
   `bindings.slots`), and add capability checking to
   `validateAttachmentBySlots` using the existing `Element.extendsCapability`
   lattice walk. Both are cheap and change no signatures.
2. Only then migrate to per-instance handles and the component-derived contract.

That order converts the hazard from "styling silently stops working" into a
failing check during migration, and it leaves the runtime backstop permanently in
place for the generated/dynamic path where types cannot help.

**Two things to publish while doing it.** The behaviour-key → slot-name **remap**
gets its own exported record type with a documented `{ as: "header_nav" }`
namespacing form — the record branch of `SlotContractInput` already models a
remap but is undocumented, capability-unchecked, and structurally
indistinguishable from the contract branch, which is why spec authors reached for
`as any` at essentially every attachment site (99 across the suite). And the
diagnostic code consolidates on `component:slot-capability-mismatch`; there are
currently three spellings of the same idea.

### Ratified 2026-07-30 — dependencies, state ownership, style builder, machine resume (`DQ-052`–`DQ-055`)

**`DQ-052` — a behaviour gets a real dependency channel, and it has two halves.**
`Behavior.make<Elements, Deps, …>((elements, deps) => …)` with
`attachToSlots(behavior, remap, { deps })` for the **caller-supplied** case ("the
call site knows this value"), *plus* resolution from the component's existing
bindings for the **behaviour-to-behaviour** case ("the component already has this
binding"). These answer different questions and we take both.

Rejected: expressing dependencies as Effect requirements on `Req`. That loses
per-instance identity, which is the **same class of mistake as the shared handles
in `DQ-050`** — a behaviour attached twice to two elements would share one
dependency. If a sixth type parameter proves too costly, collapse `Elements` and
`Deps` into one **tagged** record (`{ elements, deps }`) rather than dropping the
distinction; the distinction is the point, since a dependency smuggled through
the Elements record defeats `DQ-051`'s capability checking.

**`DQ-053` — behaviours declare state via `provides`; the component hoists it.**
Today `Component.state` called inside a behaviour's `run` binds to that
**behaviour's** scope, so swapping a behaviour out — the sanctioned no-fork
move — silently discards the state it owned. That is a hole in the no-fork
guarantee *itself*: the guarantee is only true for stateless behaviours, and the
failure surfaces as "the widget forgot", filed against the customizer.

Decision: a behaviour keeps authoring state locally but declares it in
`metadata.provides`; the attach machinery materialises the atom in the
**component's** scope and hands it in through `DQ-052`'s channel. Replacing a
behaviour whose `provides` shape matches reuses the existing atom; a **mismatch
is a diagnostic, not a silent reset**. Rejected: moving all state onto the
component (inverts the outside-in architecture and makes behaviours unattachable
to components that did not anticipate them), and declaring replacement lossy
(acceptable only as an interim, and then it must be written into the no-fork
section rather than left implied).

This depends on `DQ-057`: `provides` currently merges **last-wins with no
conflict diagnostic**, which is precisely the wrong default once it carries state
identity.

**`DQ-054` — delete `Style.forSlots`; one contract-aware `make`.** Two builders
where the *recommended* one is strictly weaker is not a shape worth preserving —
`forSlots` erases `Bindings` to `never`, making `StyleBindingCompatible` vacuous
exactly on the golden path while the "low-level" `make` keeps the check. Fold the
contract awareness into `make`, carry `DQ-052`'s typed binding witness so
`whenBinding`'s predicate relates to the binding's value type, and make full slot
coverage **opt-in exhaustive** (`{ exhaustive: true }` or a distinct
`forAllSlots`) rather than default-required — partial recipes are legitimate for
patches.

**`DQ-055` — `Resume.snapshotVia` is the primitive; `Machine.resumable` is sugar
on it.** `BindingResumePolicy` resolving to `never` for anything that is not an
atom is not a machine problem — it is a **general limitation that recurs for
every handle-shaped binding**, including the state `DQ-053` hoists. So the
mechanism is:

```ts
Resume.snapshotVia({ schema, read, restore })   // snapshot a binding *through* a projection
Machine.resumable(definition)                    // one call to the above
```

Until it lands, the documented interim is to bind `machine.state` (the atom)
directly — and the plan must **say so**, because today that guidance is enforced
by a type error only by accident rather than by design.

### Known defects blocking K0b acceptance (2026-07-30, found while writing `future/components/` specs)

These are proven, not suspected, and they are what the `TODO(kit)` comments
in `src/behaviors/` owe:

1. **FIXED (2026-08-12).** Defaults now live in the Schema
   (`Schema.withDecodingDefault`) for `press`, `rovingTabindex`, AND
   `collection`; decode happens inside the behavior's `run` and fails closed
   as the typed `Behavior.BehaviorOptionsError` (via the new
   `Behavior.decodeOptions`), so the factory never throws. Config types are
   the Schema's `Encoded` side (every knob optional) plus function props.
   Pinned by `future/components/behavior-catalog.spec.ts` tests 1-4 (green).
   Original record: **`press()` and `rovingTabindex()` throw `SchemaError`
   on default or partial config.** `decodeOptions` forwards explicit `undefined` into
   `Schema.optionalKey` fields, so `press()` — the documented call — fails.
   Two of the load-bearing five are unusable as documented, and **no test
   in `src/__tests__` exercises either factory**. Fix direction: defaults
   belong in the Schema (`Schema.withDecodingDefault`), and decode must be
   fail-closed **typed** (a tagged error), never a thrown `ParseError` —
   the same rule as Mixin acceptance item 4.
2. **FIXED (2026-08-12).** `Behavior` is pipeable: every construction site
   (`make`, `portable`, `withMetadata`, `compose`) attaches a
   non-enumerable `pipe` bound to the constructed value (non-enumerable so
   an object spread drops it instead of copying a stale-self closure). All
   three catalog factories now use the documented
   `Behavior.make(...).pipe(Behavior.provides({…}))` form and the
   `TODO(kit)` comments are gone. Original record: **`Behavior` has no
   `pipe`**, which the documented authoring form requires.
3. **Binding-conditional styles are resolved once at view-transform time**,
   so a machine transition does not restyle. This directly contradicts
   "styles subscribe to machine tags" (advantage 6) — the reactive
   substrate claim fails at the CSS end today.

### Rules of thumb

1. **Every configurable knob** that is data → field on an options
   `Schema` (defaults via Schema helpers).
2. **Every overridable algorithm step** that is a function → optional
   function prop on the config type (typed in TS).
3. **Extra bindings / side effects** → `Behavior.compose` or a small wrap
   that returns `Behavior.compose(base, extra)`.
4. **Missing knob/prop that forces a fork** → kit API bug; add Schema
   field or function prop — do not add a hooks middleware bus.
5. **Portability** — same as today: `Behavior.portable` / compose
   portability rules; options must remain serializable if they appear on
   resume paths (functions never go on the wire).

### How this maps to “alter typeahead”

| Want | Path |
| --- | --- |
| Longer buffer / no wrap | Schema options |
| Fuzzy / custom match | function prop `match` / app factory reusing kit |
| Wider options (`minScore`) | new Schema (`…fields` merge) + thin wrapper factory |
| Announce on match | `compose(typeahead(), announceBehavior)` |
| Totally different | replace in `compose` |
| Edit kit source | **Forbidden** |

### Implementation sequencing (behaviors)

1. **Catalog convention**: each behavior exports `*Options` Schema +
   `function name(config?) => Behavior`; document options + function props
   in `docs/kit-research/behaviors/`.
2. **Pilot load-bearing five** that way (no closed `make` without options
   when knobs exist).
3. **Type tests**: options decode; compose binding merge; attach to slot
   contracts.
4. **Mixin** (see dedicated section) once 2–3 hand-written factories show
   shared boilerplate — not before.
5. Hostile tests: **replace or wrap one behavior** in a default stack
   without forking source.

### Relationship to machines and no-fork

- **Machines** — Schema states/events (already); snapshot-safe data only.
- **Behaviors** — DOM wiring + Schema options; refs never in machine state.
- Swapping a machine and swapping/wrapping a behavior are both external
  composition.

---

## Foundation: styles and recipes (Schema data + merge)

Same no-fork goal; **Style is already mostly data**. Do not clone a
behavior-style `.extend` method. Specialize recipes by **merging data**
and validating with Schema where useful; stack pieces with
`Style.compose`; attach outside with `attachToSlots`.

### What we already have

| Capability | Today (`src/Style.ts`, `Theme`) |
| --- | --- |
| Pieces | slots, conditionals, binding-conditionals, states, responsive, media/supports/container, vars, animation, nesting |
| Horizontal stack | `Style.compose` — pieces as data across modules |
| Recipes | `Style.recipe({ base, variants, defaults })` → selection → slot→style map |
| Attach | `Style.forSlots` / `attachToSlots` |
| Tokens | `Theme.define` / `defineTokens` as Effect layers |

### Customization levels

| Level | Intent | How |
| --- | --- | --- |
| **1. Selection** | Pick variants | `button({ intent: "danger", size: "lg" })` |
| **2. Compose** | Piece merge | `Style.compose(a, b)` |
| **3. Specialize** | Brand / patch kit recipe | **`Style.mergeRecipes(base, patch)`** (pure data merge) + optional Schema decode |
| **4. Replace** | Different look, same anatomy | Attach another recipe/map to the same slots |

No `button.extend({…})` as a required API. “Extend” = merge recipe
structs the way you merge any Affe/Effect data.

### Target shape

```ts
import { Schema } from "effect"
import * as Style from "effect-atom-jsx/Style"

// Kit: recipe is data (+ thin Style.recipe helper that resolves selection)
const buttonRecipe = {
  slots: ["root", "label"] as const,
  base: {
    root: Style.slot({ padding: "md" }),
    label: Style.slot({ fontSize: "body.md" }),
  },
  variants: {
    intent: {
      primary: { root: Style.slot({ /* tokens */ }) },
      danger: { root: Style.slot({ /* … */ }) },
    },
    size: {
      sm: { root: Style.slot({ padding: "sm" }) },
      lg: { root: Style.slot({ padding: "lg" }) },
    },
  },
  // ratified shape (2026-07-30): `when` is typed against the declared axes
  compound: [
    { when: { intent: "danger", size: "lg" }, style: { root: Style.slot({ /* … */ }) } },
  ],
  defaults: { intent: "primary", size: "sm" },
} as const

const button = Style.recipe(buttonRecipe) // existing helper spirit

// App: specialize by merging data (precedence documented + tested)
const brandRecipe = Style.mergeRecipes(buttonRecipe, {
  variants: {
    intent: { brand: { root: Style.slot({ /* brand tokens */ }) } },
  },
  defaults: { intent: "brand" },
})
const brandButton = Style.recipe(brandRecipe)

brandButton({ size: "lg" })

// one-off slot patch
Style.attachToSlots(
  {
    root: Style.compose(
      brandButton({ size: "sm" }).root,
      Style.slot({ letterSpacing: "0.02em" }),
    ),
  },
  ButtonAnatomy,
)
```

Optional: `ButtonRecipeSchema` as Schema for validating merged recipe
objects at boundaries (generated kits, JSON theme packs). Selection
literals stay TS-typed via `RecipeProps` / `as const` defs.

Tailwind-as-syntax and raw pieces are **front-ends into the same piece
model** — one merge policy only.

### Ratified API decisions (2026-07-30, found while writing `future/components/` specs)

These were listed as "open — decide by doing the smaller thing"; the specs
could not be written without inventing them, so they are decided here.

1. **`compound` is the one spelling, and `when` is typed.**
   Three shapes existed for one concept: this plan said
   `compound: [{ ...axes, style }]`; `Style.variants` (`src/Style.ts:1037`)
   implements `compounds?: ReadonlyArray<{ when: Record<string, string |
   boolean>; style }>`; `Style.recipe` (`src/Style.ts:1083`) implements
   **neither** — `RecipeDef` has no compound field at all and `resolve`
   ignores it. Ratified for both:

   ```ts
   compound: ReadonlyArray<{
     readonly when: RecipeSelection<D>          // typed against declared axes
     readonly style: Partial<Record<Slots, StyleValue>>
   }>
   ```

   `when` typed against the axes makes `{ intnet: "danger" }` a compile
   error. The flat-axis-keys form this plan previously showed is the worst
   of the three: indistinguishable from `style`/reserved keys, and
   untypeable against the axes without contortions. Singular `compound`
   wins on read; `Style.variants`'s `compounds` renames to match (prerelease
   — coherence beats compatibility).

2. **`mergeRecipes(base, patch)` stays two-arg; unknown slots are a *type*
   error.** The spec invented a third `{ allowNewSlots: true }` argument;
   rejected, because a boolean flag cannot re-type the result and therefore
   forces `as any` at every call site. Patch slot keys are constrained to
   the base's slot names. Widening slots is an explicit, name-carrying
   call:

   ```ts
   const widened = Style.extendRecipeSlots(buttonRecipe, ["footer"] as const)
   // RecipeDef<"root" | "label" | "footer">
   const themed = Style.mergeRecipes(widened, { base: { footer: … } })
   ```

   Implementation owes a **type test** proving the merged def deep-unions
   axes *and* axis keys (`size: "sm" | "lg" | "xl"` plus a brand-new
   `intent` axis) and validates `defaults` against that union. Written
   naively the merge degrades to `RecipeDef<string>` and silently loses key
   checking for every downstream selection — that regression is the point
   of the test.

3. **Failure-model house rule: malformed config is a type error or a
   diagnostic — never a synchronous throw.** An earlier sketch had
   `mergeRecipes` throwing on unknown slots, which contradicts the kit's
   own error hygiene (house rule 1) and the behavior half's
   `Style.validateAttachment*` / `Behavior.validateAttachmentBySlots`
   convention. Recipes are pure data, so: unknown slots = **type error**;
   generated/dynamic patches that cannot be typed return
   `readonly StyleDiagnostic[]` from a `Style.validateRecipeMerge(...)`
   companion. This rule applies to both halves of the kit so they stop
   disagreeing.

4. **CSS layer order is a closed, branded token list.** Today
   `Style.inLayer(name: string, piece)` (`src/Style.ts:542`) takes a bare
   string, so `Style.inLayer("compnents", …)` silently misbehaves forever.
   Ratified: `Style.CssLayer` (branded) plus `Style.cssLayerOrder` as a
   closed tuple, and `inLayer(layer: CssLayer.Any, piece)`. Naming is
   constrained on both sides: `Style.layers(names)` (`src/Style.ts:538`)
   already exists and means *declaration emission*, and a bare `Layer`
   collides with Effect's `Layer` — hence `CssLayer` / `cssLayerOrder`.
   The consumer rung is **one named layer, `"app"`**, last in the tuple
   (the plan previously said only "consumer layers after ours", and the
   spec had to invent the name):

   ```ts
   Style.cssLayerOrder // ["defaults", "components", "variants", "utilities", "app"]
   ```

5. **A selection may be explicitly unset.** `RecipeSelection` is
   all-optional, so there is no way to deselect an axis that has a
   default — the spec resorted to `intent: undefined as never`. Ratified:
   `null` is an allowed selection value meaning "unset this axis", with
   `recipe.without("intent")` as the readable sugar over it.

### Merge / precedence (must specify + property-test)

**Authoring (JS resolution), in order:**

1. Recipe `base`
2. Selected `variants` (document axis order)
3. `compound` matches
4. Kit default per-slot attachment
5. Consumer `mergeRecipes` patches + `Style.attachToSlots` (last per rule)

**Platform (CSS):** public `@layer` order (CSS-Tags / rung zero) —
defaults → components → variants → utilities → **`app` (the consumer
layer, always last)** — as the branded `Style.cssLayerOrder` tuple, not a
`readonly string[]` (ratified above).

Cross-module `Style.compose` is a **stability guarantee** (no extraction
pass may break it).

### Contract rules

1. **Anatomy-bound** kit recipes — slots checked against `View.Slots`.
2. **Merge** only known slots — a patch key outside the base's slot names
   is a type error; app recipes widen deliberately via
   `Style.extendRecipeSlots(base, [...] as const)`.
3. **Tokens** via Theme layers — not hard-coded closed palettes.
4. **No free-form runtime class strings** in core; Tailwind is compile-time.

### How this maps to “restyle the kit button”

| Want | Path |
| --- | --- |
| Size/intent | selection `button({ … })` |
| Brand variant | `mergeRecipes` + new variant data |
| One-off slot | `Style.compose` / consumer `attachToSlots` |
| Totally different | replace recipe on headless export |
| Edit kit source | **Forbidden** |

### Implementation sequencing

1. Document + property-test **mergeRecipes** / resolution order + `@layer`.
2. Promote kit recipes to **exported data + `Style.recipe`**, anatomy-typed
   (Gap 2); optional Schema for recipe validation.
3. Theme token layers as today.
4. Static extraction later; fail-open to runtime CSS; preserve compose.
5. Hostile tests: **mergeRecipes or replace recipe** on assembled default
   (with behavior wrap/replace).

### Relationship to behaviors and no-fork

| Layer | Customize via | Not for |
| --- | --- | --- |
| Behavior | Schema options, function props, `compose`, replace | visual tokens |
| Style | selection, `compose`, **mergeRecipes**, tokens, replace | pointer/keyboard |
| Machine | different machine definition | either |

Hostile widget test: **restyle (merge/replace) + reslot + behavior
wrap/replace** without forking source.

---

## Mixin — declarative catalog modules (design)

**Status:** designed; implement after 2–3 hand-written Schema factories
prove boilerplate (phase **K0c**). Not required to ship the first
load-bearing behaviors.

### Purpose

`Mixin` packages a **catalog module** so authors don’t retype the same
pattern:

```ts
export const FooOptions = Schema.Struct({ … })
export type FooConfig = FooOptions & { match?: … }
export const foo = (config: FooConfig = {}) => {
  const options = Schema.decodeSync(FooOptions)(config)
  return Behavior.make(…).pipe(Behavior.provides(…))
}
```

It is **declaration sugar + typed merge**, not a runtime framework.
Calling a mixin always ends in today’s `Behavior` or recipe **data**.

### Non-goals (hard)

| Forbidden | Why |
| --- | --- |
| Hooks registry / middleware / `around` stacks | Rejected earlier; use function props + `compose` |
| Second type axis replacing `Behavior<E,B,R,E>` | Mixin materializes *to* Behavior |
| Inheritance of private impl | Override by **re-`create` with new effect** or wrap after `toBehavior` |
| Putting `run` inside Schema | Effect stays Effect |
| Replacing `Behavior.compose` | Horizontal stack stays compose |
| Opaque magic precedence | Options merge = Schema field merge; documented |

### Mental model

A **Mixin module** is an ordered list of **fragments**. `Mixin.create(…)`
left-folds fragments into one immutable **definition**:

```
Definition = {
  tag: string
  kind: "behavior" | "recipe"
  options: Schema          // data knobs (serializable)
  props: PropSpec          // non-Schema call args (functions, etc.)
  elements?: contract      // behavior: slot/capability map
  provides?: BindingContract
  emits?: OutEventContract
  events?: BehaviorEventMap
  effect?: (ctx) => Effect  // behavior body
  recipe?: RecipeData       // style body (data)
}
```

Materializers:

| API | Result |
| --- | --- |
| `Mixin.toBehavior(def)` or `def(config?)` | `Behavior<Elements, Bindings, Req, E>` |
| `Mixin.toRecipe(def)` / `def` as recipe data | recipe object for `Style.recipe` / `mergeRecipes` |
| `def.options` | the options Schema (for app Schema merge) |
| `def.tag` | stable name (devtools, diagnostics) |

### Fragment API

```ts
import { Schema } from "effect"
import * as Mixin from "effect-atom-jsx/Mixin" // or Behavior.Mixin / kit-local
import * as Behavior from "effect-atom-jsx/Behavior"

// Identity
Mixin.tag("Typeahead")           // string tag; last wins if repeated
Mixin.kind("behavior")           // default "behavior"; or "recipe"

// Data options — MUST be Schema
Mixin.options(TypeaheadOptions)  // replaces or Schema-merges with prior options
// Prefer explicit merge helper when combining:
Mixin.options(Mixin.mergeSchemas(BaseOptions, Schema.Struct({ minScore: Schema.Number })))

// Non-Schema call-site props (functions, complex callbacks)
// These are TypeScript-only; never Schema.decode'd; never on the wire.
Mixin.props<{
  readonly match?: (q: string, item: { label: string }) => boolean
  readonly getLabel?: (item: unknown) => string
}>()

// Behavior contracts (witnesses — existing Behavior APIs)
Mixin.elements<{ readonly items: Element.Collection<Element.Focusable> }>()
// or Mixin.slots(MenuAnatomy) when binding to View.Slots
Mixin.provides({ buffer: Behavior.binding<"buffer", string>("buffer") })
Mixin.emits({ matched: Behavior.outEvent<"matched", { index: number }>("matched") })
Mixin.events({ items: ["keydown"] as const })

// Implementation — Effect for behaviors
Mixin.effect((ctx) =>
  Effect.gen(function* () {
    // ctx.options  : decoded TypeaheadOptions
    // ctx.props    : { match?, getLabel? } (raw, not decoded)
    // ctx.elements : capability-typed handles when run via toBehavior
    const match = ctx.props.match ?? defaultMatch(ctx.options.matchMode)
    // …
    return { buffer: /* … */ }
  }),
)

// Implementation — data for recipes (no Effect required)
Mixin.recipe({
  base: { root: Style.slot({ /* … */ }) },
  variants: { /* … */ },
  defaults: { /* … */ },
})
// Later fragments may Mixin.recipe(patch) → Style.mergeRecipes under the hood
```

Naming note: **`options` = Schema data**; **`props` = non-Schema
call-site extras** (especially functions). Avoid “properties” as a third
ambiguous word — use `provides` / `emits` for public binding/event
contracts.

### `Mixin.create` and specialization

```ts
export const Typeahead = Mixin.create(
  Mixin.tag("Typeahead"),
  Mixin.kind("behavior"),
  Mixin.options(TypeaheadOptions),
  Mixin.props<{
    readonly match?: (q: string, item: { label: string }) => boolean
    readonly getLabel?: (item: unknown) => string
  }>(),
  Mixin.elements<{ readonly items: Element.Collection<Element.Focusable> }>(),
  Mixin.provides({ buffer: Behavior.binding<"buffer", string>("buffer") }),
  Mixin.effect((ctx) => runTypeahead(ctx)),
)

// App / kit variant: pass prior definition as first fragment
export const FuzzyTypeahead = Mixin.create(
  Typeahead, // inherit tag, elements, provides, base effect unless overridden
  Mixin.options(
    Schema.Struct({
      ...TypeaheadOptions.fields,
      minScore: Schema.Number.pipe(Schema.withDecodingDefault(() => 0.6)),
    }),
  ),
  Mixin.props<{
    readonly match?: Typeahead["props"] extends infer P ? P extends { match?: infer M } ? M : never : never
    readonly search?: (q: string, item: { label: string }) => number
  }>(),
  Mixin.effect((ctx) =>
    // full replace of effect, or call shared helper; do NOT invent super.effect()
    runTypeahead({
      ...ctx,
      props: {
        ...ctx.props,
        match: (q, item) =>
          (ctx.props.search?.(q, item) ?? fuse(q, item.label)) >= ctx.options.minScore,
      },
    }),
  ),
)

// Materialize — same as hand-written factory
export const typeahead = Mixin.toBehavior(Typeahead)
// typeahead({ timeoutMs: 800, match: fuzzy })
export const fuzzyTypeahead = Mixin.toBehavior(FuzzyTypeahead)
```

**Fragment merge rules (left → right):**

| Fragment | Merge |
| --- | --- |
| `tag` / `kind` | Last wins |
| `options` | Last Schema **replaces** unless author uses `mergeSchemas` / field spread explicitly (prefer explicit) |
| `props` | TypeScript intersection of prop types; runtime: shallow merge of provided prop objects at call time |
| `elements` | Last wins (or intersection if we can type it — start with last wins + type tests) |
| `provides` / `emits` / `events` | Shallow key merge; same key → last wins (document; prefer no silent conflict) |
| `effect` | Last wins (full replace). Wrapping = write a new effect that calls a shared function or `compose` after `toBehavior` |
| `recipe` | `Style.mergeRecipes(prev, next)` |

### Call signature after materialize

```ts
type ConfigOf<M> =
  & Schema.Schema.Type<M["options"]>
  & Partial<M["props"]>   // function props optional at call site

function toBehavior<M extends Mixin.Definition>(
  def: M,
): (config?: ConfigOf<M>) => Behavior<
  M["elements"],
  /* bindings from effect return + provides witnesses */,
  /* R from effect */,
  /* E from effect */
>
```

At call time:

1. Split `config` into schema fields vs prop keys (by schema field names).
2. `options = Schema.decodeUnknownSync(def.options)(schemaPart)`.
3. `props = propPart` (no decode).
4. Return `Behavior.make(def.elements, (elements) => def.effect({ options, props, elements })).pipe(provides, emits, events metadata)`.

### Style / recipe modules

```ts
export const ButtonRecipe = Mixin.create(
  Mixin.tag("ButtonRecipe"),
  Mixin.kind("recipe"),
  Mixin.options(Schema.Struct({ /* rare: recipe-level knobs */ })),
  Mixin.recipe({
    slots: ["root", "label"] as const,
    base: { /* … */ },
    variants: { /* … */ },
    defaults: { intent: "primary", size: "sm" },
  }),
)

export const BrandButtonRecipe = Mixin.create(
  ButtonRecipe,
  Mixin.recipe({
    variants: { intent: { brand: { root: Style.slot({ /* … */ }) } } },
    defaults: { intent: "brand" },
  }),
)

const brandButton = Style.recipe(Mixin.toRecipe(BrandButtonRecipe))
```

Most recipes can stay plain objects + `mergeRecipes` without Mixin.
Mixin helps when a recipe family wants a **tag**, shared **options
Schema**, and layered recipe patches in one place.

### Composition with the rest of Affe

```ts
// Horizontal behavior stack — always Behavior.compose, never Mixin.compose for run order
Behavior.compose(
  Mixin.toBehavior(Collection)(),
  Mixin.toBehavior(RovingTabindex)({ orientation: "vertical" }),
  Mixin.toBehavior(FuzzyTypeahead)({ minScore: 0.5 }),
)

// After materialize, portable / attach unchanged
Behavior.portable(code)(…)
Behavior.attachToSlots(Mixin.toBehavior(Typeahead)(), anatomy)
```

There is **no** `Mixin.compose` that runs effects in sequence — that would
duplicate `Behavior.compose`. Mixin composition is **definition-time
fragment merge** only.

### Types & diagnostics

- Export `Mixin.Definition`, `Mixin.OptionsOf<M>`, `Mixin.PropsOf<M>`,
  `Mixin.ConfigOf<M>`, `Mixin.BehaviorOf<M>`.
- `Mixin.create` should fail typechecking if `kind: "behavior"` lacks
  `effect`, or `kind: "recipe"` lacks `recipe`.
- Devtools: `tag` on definition for doctor / inspect.
- Runtime: invalid options → Schema error (typed); missing effect →
  `Schema.TaggedErrorClass` or define-time throw in `toBehavior`.

### Desugaring checklist (implementation acceptance)

Hand-written factory and Mixin materialization must be **observationally
equivalent**:

1. Same options Schema decode defaults.
2. Same bindings keys from `run`.
3. Same `provides` / `emits` metadata.
4. Same element capability requirements for attach.
5. `Behavior.compose` portability rules unchanged.

Property test: for a golden Typeahead definition, `toBehavior(def)(cfg)`
matches reference `typeahead(cfg)` on a fixed element fixture.

### Where it lives

| Phase | Location |
| --- | --- |
| First implementation | `src/Mixin.ts` (core) — used by kit catalog; useful beyond kit |
| Export | `effect-atom-jsx/Mixin` + root namespace |
| Catalog | `src/behaviors/*.ts` may use Mixin or plain functions interchangeably |

### Sequencing

| When | What |
| --- | --- |
| **K0b** | Hand-written Schema factories (no Mixin required) |
| **K0c** | `Mixin.create` + fragments + `toBehavior`; golden parity test with Typeahead/press |
| **K1+** | Optional `kind: "recipe"` + `toRecipe`; catalog may migrate to Mixin opportunistically |

### Anti-patterns

```ts
// BAD — hooks middleware
Mixin.hooks({ match: … })
Mixin.around((next) => …)

// BAD — effect inheritance magic
Mixin.effect(function* () { yield* super.effect() })

// GOOD — shared helper
function runTypeahead(ctx) { /* … */ }
Mixin.effect((ctx) => runTypeahead(ctx))

// GOOD — horizontal extras
Behavior.compose(Mixin.toBehavior(Typeahead)(), analyticsBehavior)
```

---

## What already exists (audit)

The kit is closer to assembly than greenfield:

| Capability | Existing primitive |
| --- | --- |
| Widget anatomy (Zag "anatomy", Radix "parts") | `View.Slots.define` — named, typed, capability-carrying slot contracts |
| Headless interaction logic | `Behavior.make/forSlots/compose` + the `behaviors.ts` catalog: disclosure, selection, searchFilter, keyboardNav, pagination, focusTrap, combobox |
| ARIA pattern conformance | `A11y.pattern` contracts + `A11y.validate` diagnostics, with slot anatomies already defined for Dialog, Tooltip, Popover, Tabs, Slider, Calendar, DragAndDrop |
| Styling system | `Style` pieces: slots, conditionals, binding-conditionals, states, responsive, media/supports/container queries, vars, animation, nesting — Panda-class expressiveness, attached via `Style.forSlots/attachToSlots` |
| Design tokens | `Theme.define/defineTokens` typed token schemas provided as Effect layers (`ThemeLight`, swappable per subtree) |
| Composition | `Component.withSlots` + behavior/style attachment preserving all five type axes |
| Interactivity without JS payload | `Behavior.portable` + `Resume.*` — kit widgets can ship dormant |
| CLI | the `af-ui` bin — the vehicle for shadcn-style vendoring |

## The three real gaps

### Gap 1 — Typed state machines (`src/Machine.ts` / core)

Zag's core insight: complex widgets (combobox, menu, date picker) are state
machines, and machines are portable across frameworks. Ours goes further:
**machines are data, and data is resumable.**

**Decision (2026-07-29): depend on `@typeonce/effect-machine`, own a thin
Affe adapter.** Do not invent a second statechart runtime. The package is
the schema-first engine incubating for Effect PR #6429; Affe owns the
integration seams only.

| Layer | Owner |
| --- | --- |
| Definition (`defineStates` / `make` / `handle`) | `@typeonce/effect-machine` |
| Execution (`start` / `send` / encode-decode snapshot) | `@typeonce/effect-machine` |
| Affe spawn bridge (`Component.state`, Scope dispose, resume policy) | `src/Machine.ts` |
| DOM wiring | `Behavior` (never machine state) |
| Their `AtomMachine` / `effect/unstable/reactivity` | **not used** |

```ts
import { Effect, Schema } from "effect"
import * as Machine from "effect-atom-jsx/Machine"

class Idle extends Schema.TaggedClass()("Idle", {}) {}
class Open extends Schema.TaggedClass()("Open", {
  highlighted: Schema.NullOr(Schema.Number),
}) {}
class OpenEvent extends Schema.TaggedClass()("OpenEvent", {}) {}
class CloseEvent extends Schema.TaggedClass()("CloseEvent", {}) {}

const states = Machine.defineStates({ Idle, Open })

const ComboboxMachine = Machine.make({
  id: "combobox",
  states: states.states,
  events: [OpenEvent, CloseEvent],
  // initial is a function (effect-machine API; not a bare snapshot value)
  initial: () => states.initial.Idle(new Idle({})),
}).handle({
  Idle: {
    on: {
      OpenEvent: ({ target }) =>
        Effect.succeed(target.full.Open(new Open({ highlighted: null }))),
    },
  },
  Open: {
    on: {
      CloseEvent: ({ target }) =>
        Effect.succeed(target.full.Idle(new Idle({}))),
    },
  },
})

// In setup / behavior:
const machine = yield* Machine.spawn(ComboboxMachine)
machine.send(new OpenEvent({}))
// machine.state is Component.state-backed EncodedSnapshot (JSON-safe, resumable)
// resume: Resume.snapshotState(Machine.EncodedSnapshotSchema)
```

- Runtime: `Machine.spawn(machine)` inside a behavior/setup yields
  `{ state, send, sendEffect, matches, stop }` — `state` is a
  `Component.state` atom of the **encoded** snapshot so views/styles/resume
  subscribe without class instances on the wire;
  `Style.bindingConditional` / `matches(path)` key off active paths
  (`data-state="Open"`, Radix-style).
- Actions run inside effect-machine under the Affe Scope; dispose calls
  `ref.stop` exactly once (double-dispose is a no-op).
- **Resumability is the differentiator**: encoded snapshots round-trip
  through `Resume.snapshotState(Machine.EncodedSnapshotSchema)`;
  `Machine.spawn(def, { snapshot })` rebinds `initial` so a dormant
  combobox restores open/highlighted without replaying setup. DOM refs
  stay in Behavior scope — never in machine state.
- Peer: `effect@4.0.0-beta.102` (exact). When Effect ships Machine in-core,
  the adapter swaps the import; the Affe spawn surface stays stable.

**Correction (2026-07-30, found while writing `future/components/` specs):
the K0 differentiator has no typed authoring form yet.** The snippet above
is honest about the *runtime*, but the resume policy cannot currently be
written on a machine binding. `Component.bind`'s `resume?:
BindingResumePolicy<A>` resolves to `never` unless the binding *is* a
`WritableAtom` or a `Result` atom — and `spawn()` returns a
`SpawnedMachine`, so `{ resume: Machine.snapshotPolicy() }` on a machine
binding is a **type error, not a cast**. Worse, `Machine.snapshotPolicy()`
takes zero arguments, so nothing proves its encode schema matches the
machine definition, and `restoreStateBindings` has no way to
re-`spawn(definition, { snapshot })`.

Ratify one of these shapes as part of K0's completion (both are
compatible):

```ts
// (a) one resumable binding source folding spawn + schema + restore
setup().bind("machine", Machine.resumable(ComboboxMachine))

// (b) generalise the policy so projections are expressible
Resume.snapshotVia({
  schema: Machine.EncodedSnapshotSchema,
  read: (m) => m.state(),
  restore: (snap) => Machine.spawn(ComboboxMachine, { snapshot: snap }),
})
```

Until then, the **correct interim authoring is to bind `machine.state`**
(the atom) and let `Resume.snapshotState` handle it; the *respawn* leg — the
part that makes a dormant machine send events again — needs the design piece
above. K0 is "done (initial)" precisely to this extent.

### Gap 2 — Recipes and variants (the cva/Panda layer)

**Canonical design constraints:** see **Foundation: styles and recipes**
(Schema/data + `mergeRecipes` + `Style.compose` + merge precedence). This
gap implements that foundation — not a parallel styling story and **not**
a `.extend` class API.

`Style` has pieces and a thin `Style.recipe` today; finish:

- exported **recipe data** + selection helper
- **`Style.mergeRecipes(base, patch)`** (pure, tested)
- anatomy-bound slots; Theme token resolution
- optional Schema validation of recipe objects

```ts
const button = Style.recipe({
  base: { ...style pieces... },
  variants: {
    intent: { primary: {...}, danger: {...} },
    size: { sm: {...}, lg: {...} },
  },
  compound: [{ when: { intent: "danger", size: "lg" }, style: {...} }],
  defaults: { intent: "primary", size: "sm" },
})
// button({ intent: "danger" })
// brand = Style.recipe(Style.mergeRecipes(buttonDef, { variants, defaults }))
```

Two-phase styling story:

1. **Runtime first** (v1): resolve via `Style`/`Theme`; **merge precedence
   property-tested before API is “done.”**
2. **Static extraction later** (resume-extract chain); fail-open to runtime
   CSS; must not break cross-module `Style.compose`.

**Syntax front-ends (StyleXtras-inspired):** Tailwind-as-syntax compile
front-end; one semantic core; merge/`@layer` as in the foundation section.

### Gap 3 — Distribution: one package, and the no-fork guarantee

**Decision: no shadcn-style vendoring.** shadcn's copy-the-source model is a
workaround for React's closed components — there is no external axis to
change a React component's structure, interaction wiring, or styling, so
customization requires owning the source, and owned copies rot. The
inside-out architecture is precisely the removal of that constraint, so the
kit ships as an ordinary dependency:

- `@affe/kit` is a normal package; `sideEffects: false` + per-widget module
  boundaries mean consumers import only what they use and tree-shaking
  drops the rest. No CLI, no registry, no generated app code.
- Every customization shadcn users fork for must be expressible **from
  outside**, over imports:
  - restyle → recipe **selection** / **`mergeRecipes`** /
    `Style.attachToSlots` (or attach a different recipe to headless);
  - restructure → slot remapping, hidden slots, `View` transforms;
  - change interaction → Schema options / function props /
    `Behavior.compose` / wrap / replace / `withBehavior`, or a different
    `Machine` on the headless base;
  - change internals wholesale → every widget exports its layers
    (anatomy, machine, behavior, recipe, assembled default), so
    "customize" means re-composing published layers, never editing copies.
- **The no-fork guarantee is the kit's acceptance gate**: if a reasonable
  customization can only be achieved by forking widget source, that is a
  missing external axis — a kit API bug to fix, not a documentation
  gap to paper over. Each widget's test suite includes at least one
  "hostile customization" test (restyle + reslot + behavior override on
  the assembled default) proving the guarantee mechanically.

This is also the honest marketing position: vendoring is what component
libraries do when their architecture cannot support external composition.
Ours can; shipping source snippets would be conceding otherwise.

## Architecture: one widget, six layers

```
Tokens (Theme layer)                          — design decisions as data
  └─ Recipe (variants over Style pieces)      — appearance
Anatomy (View.Slots + A11y.pattern)           — structure + ARIA contract
  └─ Machine (typed FSM, Schema state)        — interaction logic
       └─ Behavior (attaches machine to slots)— DOM wiring, listeners
            └─ Component (assembled, themed)  — the shipped artifact
```

Every layer is independently exported: use our combobox, or our machine
with your DOM, or our anatomy with your machine — the Zag/Radix use cases
fall out of the layering instead of being products.

## A11y as a gate, not a feature

Each widget passes `A11y.validate` against its pattern contract in unit
tests, plus a keyboard-interaction Chromium test per widget (the existing
a11y-catalog tests are the seed). A widget without a passing pattern
contract does not ship — same fail-closed culture as the resume layer.

**Ratified (2026-07-30, found while writing `future/components/` specs): the
gate's own data structures must be typed, or the gate passes vacuously.**

1. **`A11y.PlatformFloor` is a real type**, with `covers` drawn from a
   closed union of capability names (`"focus-trap" | "light-dismiss" |
   "page-inert" | "anchor-position" | "form-submission" | …`). The spec
   currently asserts a loose object literal, which means
   `covers: ["focus-trapp"]` would pass forever — a typo silently claiming
   the platform handles focus trapping.
2. **The widget catalog needs a constructor tying its parts together**:
   `Kit.widget(component, { pattern, exampleProps })`, where `exampleProps`
   is `Component.PropsOf<typeof component>` and the pattern's slots are
   checked against `Component.SlotContractOf<typeof component>`. As a bare
   array of `{ component, pattern, exampleProps }` the gate can be
   satisfied by a mismatched pair — validating Dialog's pattern against
   Tooltip's component and reporting green.

## Effect and typed-view foundations: notes for kit authors

How each Effect concept concretely shows up in kit code, and the typed-view
vocabulary widgets should speak. These are the working rules, not a
tutorial.

**Errors (`E`).** Widget failures are values: define them with
`Schema.TaggedErrorClass` (the resume layer's discipline — never untagged
`{_tag: ...}` literals, never `throw`). Distinguish three kinds: *typed
failures* (a date parse fails → `E`, catchable at a boundary with types
intact), *defects* (impossible states — let them die loudly), and
*diagnostics* (recoverable degradation — a11y contract drift, unsupported
customization — reported through validate/diagnostic channels, never
swallowed). Component error boundaries receive `E` typed; kit widgets
document their error unions as part of their public contract.

**Services & layers (`R`).** Anything two widgets share, and anything a
test must control, is a `Context.Service` provided by a `Layer` — never
a module global (the router audit shows where that road ends). Kit-owned
services: `DismissLayerStack`, `LiveAnnouncer`, `Theme` (exists), and a
`Clock`/`Locale` service for date/time widgets. Provision is per-subtree
(`Component.withLayer`), so two themed regions or two isolated layer
stacks coexist; tests provide deterministic layers wholesale. A widget's
`R` is its honest dependency list — if the type says `never`, it runs
anywhere, including a test with no DOM services.

**Fibers & concurrency.** Machine actions, poll loops, and observers run as
fibers *supervised by a Scope* — never bare `Effect.runFork` (the router's
untracked SWR refresh is the cautionary counterexample). Disposal
interrupts; interruption is not an error. Reuse the action concurrency
vocabulary (`switch`/`queue`/`drop`) for widget-triggered async, and
`Effect.race`/`Effect.timeout` for interaction timing (typeahead buffers,
long-press thresholds, tooltip delays) instead of hand-rolled setTimeout
bookkeeping — timing built from Effects is interruptible and testable for
free.

**Shared state.** Reactive state is atoms; cross-widget coordination is a
*service that owns atoms* (the layer stack is a service holding a stack
atom — subscribable, swappable, testable), not a shared mutable map.
Cross-widget invalidation that must survive process/wire boundaries uses
semantic reactivity keys (hierarchical, the same vocabulary as
loaders/queries/M8 expressions). Machine state is an atom of Schema data —
that single decision is what makes it styleable (`bindingConditional` on
tags), observable, and resumable.

**Scope.** Scope is the lifecycle currency of the whole kit. Setup runs in
the component scope; behaviors acquire listeners with
`Effect.acquireRelease` (release is the removal — cleanup cannot be
forgotten, only written); `Behavior.attachScoped` gives reattachment its
own fresh scope; machines own a scope that interrupts their fibers on
dispose. The invariant every widget test asserts: **exactly-once
disposal** — nothing leaks when a widget unmounts mid-interaction, and
double-dispose is a no-op. Note (2026-07-30) that `Element.Handle.on()`
does **not** yet honour this — it registers removal on the reactive owner,
not the ambient Scope, so listeners leak under `attachScoped` and
`setupEffect`; see the correction in advantage 3 below and
[`docs/DESIGN_IMPROVEMENT_NOTES.md`](DESIGN_IMPROVEMENT_NOTES.md).

**`pipe()` as the assembly language.** Components are pipeable; a kit
widget's definition *is* its layer diagram, readable top to bottom:

```ts
const Select = Component.make(props, requires, setup, view).pipe(
  Component.withSlots(SelectAnatomy),
  Behavior.attachToSlots(selectBehavior, SelectAnatomy),
  Style.attachToSlots(selectRecipe.defaults, SelectAnatomy),
  Component.withDefinition({ name: "Select" }),
)
```

Because every stage preserves all five type axes, consumers re-pipe the
same stages with different arguments to customize — piping is the no-fork
mechanism in syntax form.

**Typed views, tags, and "renderable".** A view may return plain compiled
JSX (`unknown`) — always valid — but kit widgets return explicit
`View.fromSlots(anatomy, node)` so the contract travels with the render:
slot metadata (including `allowedEvents`) is what behavior attachment
validation and `A11y.validate` check against, and declared-vs-rendered
drift becomes a diagnostic instead of a silent gap. The typed hole
vocabulary (`View.text/className/style/on/children` holes) is optional
authoring metadata — use it where a widget wants analyzable dynamic points
(it is also the on-ramp for M8 `expr` boundaries and the slot-projection
direction in the improvement notes). Element handles are capability-tagged
(`Element.Capability`: TextInput/Focusable/Container/Interactive/
Draggable/Collection) — anatomies should declare the *narrowest* capability
each slot needs, because that is what makes behavior mis-wiring a compile
error. Any widget that emits raw markup (rich tooltip content, markdown
rendering) must do so through `SafeHtml`'s branding — unbranded strings
render as text, never as HTML, by construction. (Claimed "by
construction" but **not exercised anywhere** as of 2026-07-30 — see
mandated coverage under Phasing.)

## Why the inside-out architecture is the kit's unfair advantage

Every competitor's pain point maps to a structural property we already have.
These are the specific mechanisms, not vibes:

1. **Slots make anatomy compile-time checked.** Radix wires parts through
   `asChild` and data attributes; Zag hands you prop-getters you must
   spread onto the right elements yourself — both are runtime discipline,
   and mis-wiring surfaces as broken ARIA in production. Our anatomies are
   `View.Slots` contracts with **capability-typed handles**
   (TextInput/Focusable/Container/...): attaching the combobox behavior to
   a slot that lacks text-input capability is a *type error*. Slot
   remapping and hidden slots make structural customization
   (`Component.SlotsOf` preserved through every wrapper) an external,
   typed operation — the mechanism behind the no-fork guarantee.
2. **Five type axes survive composition.** `Component<Props, Req, E,
   Bindings, SlotContract>` is preserved through `withSlots` →
   `withBehavior` → style attachment — a tested invariant (the wrapper
   type tests), not a convention. React HOC/render-prop stacks destroy
   inference; here the consumer of an assembled widget sees exactly which
   bindings each behavior contributed (`Behavior.provides` contracts),
   which typed errors setup can fail with, and which services it needs.
   The kit's layering strategy is only viable because stacking layers
   loses nothing.
3. **Setup is an Effect; bindings are the committed snapshot.** Machine
   spawning, listener acquisition, and service resolution happen in a
   typed, scoped setup phase; views render from committed bindings; no
   render-time side effects by construction. Zag's hardest bug class —
   manual activity cleanup — becomes structural: every listener/fiber a
   widget acquires is Scope-tied with exact-once disposal.
   **Correction (2026-07-30, found while writing `future/components/`
   specs): "already proven" was false.** `Element.Handle.on()` registers
   removal via `onCleanup` (the *reactive owner*), not the ambient Effect
   `Scope` — so under `Behavior.attachScoped` (the resume/reattach path) and
   under `Component.setupEffect` there is no owner, and listeners survive
   both `dispose` and `Scope.close`. This is a **requirement with a known
   defect**, not a proven invariant; the library-level fix direction is
   being recorded in [`docs/DESIGN_IMPROVEMENT_NOTES.md`](DESIGN_IMPROVEMENT_NOTES.md)
   and is not duplicated here. The reassuring half is verified sound:
   `Effect.acquireRelease` releases, `forkScoped` fibers are interrupted on
   scope close, double-dispose is a no-op, and `attachScoped`'s
   `Exclude<Req, Scope>` cast is honest. Named setup steps also give widgets
   inspectability for free — which is what resume policies hang off.
4. **Effect requirements are widget-level DI.** Widgets declare services in
   `R` — the dismissable-layer stack, the live-announce region, Theme,
   and (for date/time widgets) an injected clock/locale service — provided
   per subtree via layers, swapped wholesale in tests. A date picker with
   an injected clock is deterministic under test; a missing service is a
   compile error, not a silently-undefined context. No provider pyramid.
5. **Typed failure.** Widget setup failures are values in `E`, bubbling to
   error boundaries with their types intact — not thrown-and-caught
   unknowns.
6. **Machine state is atom state.** Styles subscribe to machine tags via
   binding-conditional pieces (typed `data-state` styling), views and M8
   expressions subscribe reactively, and Schema-serializable state makes
   widget snapshots resumable. One reactive substrate from FSM to CSS.
7. **Controlled/uncontrolled collapses to one mechanism.** A widget input
   is either an external atom (controlled) or setup-created state
   (uncontrolled) — same type, no dual code paths, no `value`/
   `defaultValue` API split.
8. **Dormancy is a kit feature, not a framework aspiration.** Portable
   behaviors + machine snapshots + `formControl`'s native projection mean
   kit widgets ship interactive-on-first-touch with zero component JS — a
   product capability no Radix/Zag/Base UI consumer can access at any
   price.

The synthesis: competitors choose between *typed but closed* (styled
component libraries) and *open but untyped-at-the-seams* (headless
prop-getter libraries). The inside-out model is the third position — open
at every seam, with every seam typed — and the kit is the proof.

## The platform-native floor (inspired by @stylextras/ui)

Naman Goel's `@stylextras/ui` demonstrates a discipline the kit adopts:
**use the platform before adding JavaScript** — native `<dialog>`, the
Popover API (`popover="auto"`), invoker commands, CSS anchor positioning,
focusgroup, native `<select>`/`<input type="date">` — with JS as explicit
enhancement above that floor. For this kit the idea is not just taste; it
**compounds with resumability**:

- **The native floor works on a dormant page with zero JS.** A dialog
  opened by an invoker command, a `popover="auto"` light-dismiss, a native
  select submitting in a form — all function before any framework code
  loads. Platform-native + dormant-resume is a strictly stronger story
  than either alone: the platform covers the first interaction instantly,
  and resumption upgrades the widget on demand.
- **Behavior tiers become progressive, not always-on.** Where the platform
  provides the behavior, our T2/T3 behaviors are fallbacks/extensions:
  `<dialog>` already traps focus and inerts the page; `popover="auto"`
  already handles dismissal and stacking; CSS anchor positioning covers
  placement where supported (floating-ui remains the fallback). Each
  behavior in the catalog gains a "platform floor" note: what the native
  primitive covers, what the behavior adds, and the feature-detection
  seam between them.
- **Native-first form controls are the default, custom is the
  enhancement**: styled native `<select>`/date input first (submission,
  validation, autofill, mobile pickers intact — `appearance: base-select`
  where supported); the custom-rendered variant is an explicit opt-in,
  exactly inverse to Radix-style libraries.

**Token architecture (from their `src/tokens`).** Eight independent token
axes (color, spacing, radius, stroke, typography, elevation, blur, motion),
each separately themeable and composed per-subtree — adopt the same axis
independence in `Theme` (per-axis layers merged, so `zinc color +
compact spacing + rounded radius` compose freely rather than forking
monolithic themes). Three structural rules worth copying exactly:

- **Two-level tokens**: a raw primitive palette (no dependencies) plus
  semantic tokens *derived* from primitives (`surface → bgSubtle`,
  `primary → brand`), with state-suffix conventions (`primaryHover`,
  `dangerActive`) that line up naturally with machine-tag styling.
- **`light-dark()` as the theming floor**: token values use the CSS
  `light-dark()` function (and `color-mix`/oklch derivations), so
  light/dark switching requires **zero JavaScript and zero re-render** —
  a dormant page honors OS theme changes with no framework code. The
  Theme service governs *which* tokens apply; the platform handles mode.
  Same compounding logic as the native floor: platform-first theming is
  dormancy-compatible by construction.
- Dark surfaces via translucency (alpha over tone) rather than parallel
  opaque palettes — halves the palette maintenance surface.

Further adoptions from the same package:

- **One typed override channel, composed last**: their `sx`-composed-last
  with `className`/`style` intentionally omitted validates our
  no-untyped-strings stance; the kit's equivalent is recipe/style-piece
  overrides with a specified last-position in the merge chain.
- **No barrel export**: per-widget subpath imports only —
  tree-shaking as structure, not as hope.
- **Ship marker-preserving source, compiled by the consumer's build.**
  They ship uncompiled source so the app's StyleX build processes it. For
  us this is not optional: kit widgets authored with `extract`/`expr`
  markers must be compiled by the **consuming app's** build so portable
  code identities are stamped with the app's buildId — precompiled kit
  code would carry a foreign buildId and fail the resume gates by design.
  Kit publishing therefore ships transform-ready source (or
  marker-preserving output) as the primary artifact.
- **Stateless-by-default, `/client` opt-in, lazy trigger-only entries**:
  their server-renderable defaults with lazy content loaded on
  focus/hover converge on our dormant/addressable-activation model — and
  their lazy entries are the M11b fragment pattern by another name.
- **A11y hard lines and test matrix as gates**: real `href`s, explicit
  labels on regions, `role="status"`/`"alert"` for dynamic announcements;
  test matrix includes reduced motion, forced colors, RTL, zoom, and
  narrow layouts — adopted into the kit's per-widget gates (this also
  fills the RTL/visual-matrix gap in the risks review).

## Rung zero: CSS-Tags as the styling floor

`CSS-Tags` (doeixd/CSS-Tags — same author as this framework) supplies the
layer *below* the platform-native floor: components as pure **CSS styling
contracts** with three equivalent hosts (`<card>` unregistered custom
element, `[data-card]`, `.card`), a strict `@layer` cascade contract
(base → reset → tokens → engine → theme → palette → defaults → components
→ utilities → layouts → app-theme), relative-color-syntax theming,
zero-JS layout primitives (`<layout-stack>`, `<layout-cluster>`), and
ambient TypeScript/JSX declarations typing the tags with no runtime.

Adoptions:

1. **The kit's capability ladder gains rung zero.** Unchanged markup
   upgrades through four rungs: pure CSS contract (no framework) →
   platform-native behavior (`<dialog>`, popover) → dormant/resumable →
   activated. Each rung is additive; none rewrites markup. This continuum
   is the kit's positioning statement — competitors each live on exactly
   one rung.
2. **`@layer` order is the Recipe merge contract.** Recipe/extraction
   output emits into a declared public layer order, so precedence
   (defaults → components → variants → utilities → consumer layers) is
   enforced by the platform cascade rather than specificity or atomic
   ordering. Consumer override policy is one sentence: "your layers come
   after ours."
3. **CSS-Tags is the kit's foundation stylesheet** (depend or absorb —
   open question below): its defaults/layouts/tokens are the styled floor;
   `Theme.define` schemas map onto its custom-property names so
   Effect-layer theming and CSS-Tags theming are one token namespace;
   its layout primitives are the kit's layout components as-is.
4. **Three host forms** (element / data-attribute / class) as the
   integration story where markup cannot change (CMS/third-party DOM).
5. **Ambient typed tags** (`/// <reference types>` + JSX namespace
   adapters) as the pattern for typing every kit host with zero runtime.

Open question: absorb CSS-Tags into the `@affe/*` workspace as
`@affe/css` versus depend on it as an external package — same author, so
alignment is governance, not negotiation; absorption gives the token
namespace one owner.

## Core behavior catalog

The behavior layer is the real product; widgets are compositions of it. The
canonical set (converged on independently by Zag, react-aria, and Radix
internals), by tier — ✅ marks an existing `behaviors.ts` seed:

- **T1 Interaction**: `press` (normalized pointer/keyboard/touch/virtual
  activation — the deceptively hard one), `hover` (touch rejection, delay
  policies), `focusVisible` (input-modality tracking), `longPress`,
  `move` (pointer-capture drag math).
- **T2 Focus**: `focusTrap` ✅, `focusScope` (initial focus + restore on
  close), `rovingTabindex` (one tab stop; foundation under menus/toolbars/
  radio groups/tabs/grids).
- **T3 Dismissal/layering**: `dismissableLayer` (global stack; Escape and
  outside-press route to topmost; nested overlays), `interactOutside`,
  `hideOutside` (aria-hidden/inert), `scrollLock`, `anchorPosition`
  (floating-ui integration).
- **T4 Collections**: `collection` (items self-register in DOM order — the
  most load-bearing invisible piece; pairs with `Element.Collection`),
  `listNavigation` ✅ (`keyboardNav`; generalize), `typeahead`,
  `selectionModel` ✅ (`selection`; add multi/range/anchor modes),
  `gridNavigation` (2D).
- **T5 Value editing**: `spinValue` (step/clamp/wheel/repeat),
  `rangeControl` (multi-thumb math), `toggleState`.
- **T6 Form/platform**: `formControl` (hidden-native-input projection so
  custom widgets submit in real forms; validation → aria-invalid),
  `fieldAssociation` (label/description/error id wiring),
  controlled/uncontrolled bridging (external atom vs internal state — one
  canonical helper, no dual code paths).
- **T7 Lifecycle/announcement**: `liveAnnounce` (as an Effect *service* —
  one aria-live region per document, injected via layer), `presence`
  (exit-animation machine; first non-widget `Machine` customer),
  `observeResize`/`observeRect` (scoped Effects).

**Load-bearing five** (build first, in this order): `collection`,
`rovingTabindex`, `press`, `dismissableLayer`, `anchorPosition` — with the
existing seeds these make the whole Radix-class catalog composition work.

Affe-specific notes: layer-stack and live-region state become Effect
services (testable layers), not the module-global singletons the source
libraries use internally. `formControl`'s hidden-input projection is
SSR-relevant: a dormant custom select must submit its value in a native
form post before any JS loads — a capability none of the source libraries
express; test it from day one.

## Porting strategy (bootstrapping from Zag.js and Base UI)

Both are MIT; port with per-file provenance headers and license notices.
The value lives in different places per source:

- **Zag.js — port machines and select utilities.** Zag's machine
  definitions and `connect` prop-getters map directly onto our
  Machine/Behavior split, and Zag's "anatomy" maps 1:1 onto `View.Slots`.
  Translation table: states/events → tagged-union Schema states/events;
  guards → guards; actions → Effect actions; activities → scoped Effects
  with finalizers; `connect` getters → behavior slot attachments. The real
  asset is encoded edge cases (typeahead timing, pointer-vs-keyboard
  paths, dismissable stacking, focus restoration order).
  **Hard porting rule**: Zag contexts mix serializable state with DOM
  refs/ephemera — ported machines MUST split these (Schema state in the
  machine; refs in the behavior's runtime scope). This split is what makes
  widgets resumable; a wholesale context port would poison snapshots.
  Utilities worth porting as behavior-shaped modules: dismissable-layer
  stack, interact-outside, aria-hidden; reconcile Zag's focus trap with
  the existing `behaviors.focusTrap`.
- **Base UI — port specs and tests, not code.** Its logic is entangled
  with React hooks; the portable value is ARIA decisions, keyboard maps,
  and behavioral test suites. Porting their test cases against our widgets
  encodes the edge cases without the framework coupling.
- **Positioning: depend, don't port.** Use `@floating-ui/dom` directly
  (framework-agnostic, MIT, industry standard) rather than porting Zag's
  wrapper around it.
- **Runtime deps beyond `effect`:** `@typeonce/effect-machine` (machines)
  and later `@floating-ui/dom` (positioning). No other kit runtime deps
  without a plan amendment.
- Ported machines get the same gates as native ones: type tests for
  state/event axes, Schema round-trip of machine state, the a11y pattern
  contract, and the hostile-customization test.

## Phasing

- **K0 — Machine adapter** (`src/Machine.ts`): wrap
  `@typeonce/effect-machine` — re-export `defineStates`/`make`/`handle`
  authoring, implement Affe `spawn` (`Component.state` encoded snapshot,
  Scope-exact dispose, `send`/`sendEffect`, optional restore snapshot),
  `EncodedSnapshotSchema` + resume helper, type tests, and one
  resumability test (dormant machine state restores). **Done (initial).**
- **K0b — Behavior catalog convention**: each behavior exports `*Options`
  Schema + `function name(config?) => Behavior` (function props where
  needed); pilot load-bearing five; type tests for decode + compose.
  See behavior foundation.
- **K0c — Mixin module** (`src/Mixin.ts`): implement the Mixin design
  section — `create`, fragments (`tag`, `kind`, `options`, `props`,
  `elements`/`slots`, `provides`, `emits`, `events`, `effect`, `recipe`),
  `toBehavior` / `toRecipe`, fragment merge rules, golden parity test
  vs hand-written factory. Not a hooks framework.
- **K1 — Recipe data + merge** (`src/Style.ts`): `mergeRecipes`, compound,
  anatomy-bound slots, Theme resolution; **merge precedence property
  tests** before API freeze. Optional recipe-kind Mixin. See style
  foundation.
- **KR — Research matrix** (runs parallel with K0/K1). Two tracks under
  `docs/kit-research/` (see that README):

  1. **Behaviors / machines** — `docs/kit-research/behaviors/<name>.md`
     using `behaviors/_TEMPLATE.md`. **Required before implementing a
     catalog behavior.** Initial pass (2026-07-29) covers the full T1–T7
     catalog + seeds; load-bearing five are fully decided.
  2. **Widgets** — `docs/kit-research/widgets/<component>.md` for **every
     component** in the target catalog. Research across Zag.js, Ark UI,
     Radix, Base UI, shadcn/ui, react-aria, @stylextras/ui, CSS-Tags using
     this template:

  1. **Anatomy**: every part/slot each library defines; the union and the
     chosen minimal anatomy for us, with the narrowest
     `Element.Capability` per slot.
  2. **State & machine**: states, events, guards each library models
     (Zag's machine is the primary source); which need a `Machine` vs a
     plain behavior; the Schema state shape and what is snapshot-safe vs
     runtime-ref (the context-split applied concretely).
  3. **Interaction spec**: full keyboard map, pointer/touch behaviors,
     typeahead/dismissal/focus rules — with per-library differences noted
     and a decision for each divergence (cite the WAI-ARIA APG pattern as
     the tiebreaker).
  4. **ARIA contract**: roles/attributes/live-region behavior; what
     `A11y.pattern` must validate.
  5. **Platform-native floor**: which native element/API covers part of
     the widget (`<dialog>`, popover, invokers, anchor positioning,
     native select/date), what remains for JS, and the feature-detection
     seam.
  6. **Tokens & variants**: which token axes it consumes; the variant/API
     surface each library exposes (props, sizes, intents); the chosen
     Recipe surface; the CSS-Tags rung-zero contract for it, if any.
  7. **API surface comparison**: props/events/callbacks across libraries;
     controlled/uncontrolled handling; composition points; what we adopt,
     rename, or reject (with reasons).
  8. **Resumability & dormancy notes**: what state snapshots, what the
     dormant experience is (native floor + formControl projection), and
     whether the widget is addressable/activatable.
  9. **Port sources**: exactly which Zag machine/utilities and which test
     suites (Base UI/react-aria) to port, with license/provenance notes.

  Research docs are decision records, not surveys — every section ends in
  a choice. This work parallelizes well (one component per agent/session);
  the Combobox research doc is the K2 entry gate and the template's proof.
  **Gate satisfied (2026-07-29)**: [`docs/kit-research/widgets/combobox.md`](kit-research/widgets/combobox.md)
  is researched, so K2 is unblocked and the widget template is proven.
  purpose — it exercises machine + anatomy + keyboard nav + recipes +
  a11y). Headless export + styled default + Chromium keyboard test +
  dormant-resume proof. This widget is the template all others copy.
- **K3 — Catalog build-out** in dependency order: Dialog, Popover/Tooltip,
  Tabs, Menu, Select, Slider, Toast, DatePicker (anatomies for most
  already exist in `A11y`). Each widget's KR research doc is its entry
  gate; building without one is out of process.
- **K4 — Polish + extraction**: per-widget module boundaries verified
  tree-shakeable; the hostile-customization test suite (no-fork guarantee)
  across the catalog; static CSS extraction plugin; docs site with two
  headline demos — the dormant widget, and "customize without forking"
  (restyle + reslot + machine swap over plain imports).

### Mandated coverage per phase (2026-07-30, found while writing `future/components/` specs)

A review of the specs against the source found that several of this plan's
headline guarantees are **claimed but exercised nowhere**. They are hereby
acceptance criteria for the phase named, drawn from the research docs' own
"tests day one" lists — a phase does not close with an item outstanding.

**K0b (load-bearing five):**

1. **`collection` — currently zero coverage anywhere**, despite this plan
   calling it "the most load-bearing invisible piece". Per
   [`docs/kit-research/behaviors/collection.md`](kit-research/behaviors/collection.md) §9:
   register three items → order matches DOM order; dispose the middle one →
   indices recompact; nested collections stay isolated; unregister runs
   **exact-once** on Scope close; plus an integration test feeding
   `rovingTabindex` / `listNavigation`. This is the single biggest gap in
   the kit today.
2. **RTL horizontal navigation.** Per
   [`docs/kit-research/behaviors/roving-tabindex.md`](kit-research/behaviors/roving-tabindex.md) §9:
   under `dir="rtl"` with `orientation: "horizontal"`, ArrowLeft/ArrowRight
   reverse. (This is also the first cell of the a11y matrix below.)
3. **Regression tests for the two broken factories** — `press()` and
   `rovingTabindex()` called with no config and with partial config (see
   Known defects above); today neither factory is touched by any test in
   `src/__tests__`.
4. **Controlled/uncontrolled collapse.** `bindable(propAtom | initial)` is
   the "one mechanism, no `value`/`defaultValue` split" claim (advantage 7)
   and nothing tests it. Require: a passed-in external atom is **not**
   overwritten on spawn; with no external atom, setup creates an internal
   `Component.state` that resume can snapshot.
5. **`liveAnnounce` swaps as a service** — a mock `LiveAnnouncer` layer that
   captures polite/assertive messages, proving kit services swap wholesale
   in tests with **no DOM**. This is the concrete proof of the
   services-not-globals house rule.
6. **`presence` as the first non-widget `Machine` customer** — `close`
   keeps content mounted in `Exiting` until `animationEnd`, then
   `Unmounted`; under reduced motion it force-unmounts immediately,
   skipping `Exiting` entirely.
7. **Per-subtree `Component.withLayer` isolation** — two sibling subtrees
   given *different* layers (two independent `DismissLayerStack`s, or two
   Theme regions) with no cross-contamination. The current dismiss nesting
   test exercises one shared stack, which is a different claim.

**K1 / typed-view foundations:**

8. **`SafeHtml` branding** — a raw unbranded string in an HTML hole escapes
   to text/entities; only a value that passed through `SafeHtml.make(...)`
   renders as markup. The plan says "by construction"; nothing checks it.

**K3 (per-widget gates):**

9. **The a11y matrix** — reduced motion, forced colors, RTL, and zoom, which
   the platform-native-floor section claims is "adopted into the kit's
   per-widget gates" but which exists nowhere. One row per widget gate.
10. **Injected `Clock` / `Locale` determinism** — the plan promises "a date
    picker with an injected clock is deterministic under test; a missing
    service is a compile error", and no clock-consuming behavior or spec
    exists. Either mandate the DatePicker spec here or mark the claim
    explicitly unbuilt; silence is what let it drift.

**K4 (polish + extraction) — mechanically checkable, currently unspecified:**

11. **No-barrel / tree-shakeability gate** — per-widget subpath imports
    only, no `index.ts` re-exporting the catalog. The plan calls this
    "structure, not hope"; make it an assertion over the built package.
12. **Marker-preserving source, consumer-stamped buildId** — assert the
    published kit source retains `extract` / `expr` markers rather than
    precompiled output, and that a **foreign buildId is rejected** by the
    resume gates. A review confirmed none of this is exercised anywhere,
    which is unusual for a guarantee whose failure mode is silent.

## Implementation onboarding (read this before writing any code)

This section is for the agent starting kit implementation. It is the
operational companion to the design above.

### What is decided vs. still open

**Decided — do not re-litigate**: no shadcn vendoring (no-fork guarantee is
the acceptance gate); dependency identity via semantic reactivity keys;
**Machine engine = `@typeonce/effect-machine`**, Affe owns only
`src/Machine.ts` spawn/resume/atom bridge (never their AtomMachine);
Effect pinned to exact `4.0.0-beta.102`; public Affe surface is stable
across a future in-core Effect Machine swap; Zag ports must split Schema
state vs DOM refs; KR research doc is each widget's entry gate;
`Route.ref`/`Route.Switch` style decisions elsewhere are settled — stay
out of them. Prefer atomic/flat state trees in early widgets; compound/
parallel/invoke are available via effect-machine when a port needs them.
**Decided (foundations):** Effect-native extension — **Schema** for
options/recipe data, **compose/merge/wrap/replace** for stacking; **no**
bespoke `Behavior.define`/`.extend`/hooks registry or required
`recipe.extend` class API; merge precedence + `@layer` are the style
contract. **Mixin** is designed (see Mixin section): definition-time
fragment merge → `toBehavior`/`toRecipe`; options=Schema, props=functions;
implement as **K0c** after hand-written factories.
**Decided (2026-07-30, ratified API decisions in both foundation
sections):** `mergeRecipes(base, patch)` is two-arg with slot widening via
`Style.extendRecipeSlots`; `compound` (singular) with an axis-typed `when`;
malformed config is a type error or a diagnostic, never a throw;
`Style.CssLayer` + `cssLayerOrder` with `"app"` as the consumer layer;
`null` selections unset an axis; behavior config splits options from
function props; behaviors gain a `Deps` channel; `compose` merges bindings
last-wins; `attachToSlots(..., { as })` for namespacing;
`DismissLayerStack` is root-provided with a bubbling requirement;
`A11y.PlatformFloor` and `Kit.widget(...)` are typed constructors.
**Open — decide by doing the smaller thing**: `elements` merge last-wins vs
intersection; the machine resume binding shape (Gap 1 correction — pick (a)
or (b)); anything marked "open question" below.

### Where code goes (for now)

The kit's eventual home is the post-rename `@affe/*` workspace, but K0 and
the load-bearing behaviors start **in this repo** so they can be tested
against the live primitives:

- `src/Machine.ts` — the K0 module (core, not kit: it is generally useful).
- `src/Mixin.ts` — K0c Mixin module (core); export `./Mixin`.
- `src/behaviors.ts` (and later `src/behaviors/*`) — catalog:
  `*Options` Schema + factories or Mixin defs; load-bearing five first.
- `src/Style.ts` — K1 `mergeRecipes` + anatomy-bound recipes + merge tests.
- `src/__tests__/machine.test.ts`, `src/__tests__/behaviors-*.test.ts`,
  recipe/merge tests — runtime; `src/type-tests/*` for options decode and
  recipe merge types (copy `Equal`/`Expect` from
  `src/type-tests/resume-query.ts`).
- `docs/kit-research/` — behavior + widget research docs (list Schema
  options + function props per behavior, not “hooks surfaces”).
- Do NOT add package.json export entries without checking the existing
  exports map style, and never edit the `test:browser` script line.

### The primitives map (read these files first)

- `src/Behavior.ts` — `make`/`forSlots`/`compose`/`withMetadata`/
  `attachToSlots`/`attachScoped`/`portable` + `BehaviorAttachment`;
  `src/behaviors.ts` — existing catalog (disclosure, selection,
  searchFilter, keyboardNav, pagination, focusTrap, combobox seeds).
- `src/Component.ts` — `make`, `setup()` builder (`bind`/`value`/
  `doEffect`/`use`), `state` (returns `StateAtom` = writable atom +
  `annotateHandle` inspection), `query`, `action`, `withSlots`,
  `withBehavior`, `renderEffect`; `setupLifetime` is the internal
  disposal-guard pattern to copy.
- `src/View.ts` — `Slots.define`, `fromSlots`, slot metadata,
  hole constructors; `src/Element.ts` — capability handles
  (`Element.Capability`, `textInput`/`container`/`focusable`/...).
- `src/Style.ts` — the piece system; `src/Theme.ts` — `define`/
  `defineTokens` + `layer()`; `src/A11y.ts` — `pattern`/`validate` + the
  existing anatomies (Dialog, Tabs, Popover, Slider, Calendar...).
- `src/resume-handle.ts` — `annotateHandle`/`HandleInspection`: how state
  handles publish read/isDisposed for resumability. **K0's machine state
  should be backed by `Component.state` holding `EncodedSnapshot`** so
  `Resume.snapshotState(Machine.EncodedSnapshotSchema)` works with zero
  new resume kernel code — that is the whole resumable-widget trick.
- `src/__tests__/behavior.test.ts` and `resume.test.ts` — the test-style
  reference (Effect.runSync + Scope.makeUnsafe patterns, counters for
  exact-once assertions).

### House rules (violations will fail review)

1. Errors: `Schema.TaggedErrorClass` with a `message` getter (copy the
   pattern from `src/Resume.ts` error classes). Never untagged `{_tag}`
   literals, never `throw` in Effect code.
2. Services: `Context.Service<T>("name")` + `Layer.succeed`/
   `Layer.effect`. Never module-level mutable state (the router audit,
   F2, is the cautionary document).
3. Fibers: always Scope-supervised. No bare `Effect.runFork`.
4. Cleanup: `Effect.acquireRelease`/`Scope.addFinalizer`; every widget/
   machine test asserts exact-once disposal and no-op double-dispose.
5. All five component type axes must survive any wrapper you add — add a
   type test proving it (see `src/type-tests/component-core.ts`).
6. Effect v4 beta gotchas learned the hard way: `Effect.timeoutFail` does
   not exist — use `Effect.timeout` (fails with `Cause.TimeoutError`);
   `Schema.TaggedStruct` for tagged unions; check an API exists in
   `node_modules/effect` before writing to it, the beta moves.
7. Gates after every task: `npm run typecheck` + targeted vitest; before
   finishing: `npm run typecheck:all`, `npm test`, `npm run build` (run
   `test:browser` only if you touched examples/browser fixtures).
8. Multi-agent repo: other agents are active in `src/Resume.ts`,
   `src/resume-*.ts`, `src/compiler/`, benchmark examples, and the Route/
   Router lane. Do not edit those files. If a gate fails inside them,
   wait and retry — never "fix" another lane. Re-read any file modified
   on disk before editing it.
9. OptMem: run `wake` at session start; ONE `note` at session end
   (≤280 bytes — it will reject long notes; compress when prompted).
   Never run memo from a subagent.
10. Docs: update this plan's phase status lines as you complete work;
    decisions go in the doc, not just in code comments.

### K0 concrete acceptance (the first deliverable)

`Machine.make(...).handle(...)` (effect-machine authoring) +
`Machine.spawn(machine, options?)` (Affe bridge) where:

- States/events are `Schema.TaggedClass` (or tagged schemas) via
  `Machine.defineStates` / `events: [...]`; `initial` is a **function**
  returning a path-safe snapshot from `states.initial.*`.
- Handlers use effect-machine transition Effects (`target.full.*`); Affe
  does not reimplement the planner.
- `spawn` (inside setup/behavior, requires `Scope`) returns
  `{ state /* Component.state EncodedSnapshot */, send, sendEffect,
  matches, stop }`; Scope close stops the machine exactly once.
- Optional `options.snapshot` (encoded or decoded) rebinds initial for
  resume restore; `Resume.snapshotState(Machine.EncodedSnapshotSchema)`
  round-trips the state atom.
- Tests: transition purity/totality (property-style over event
  sequences); action supervision + interruption; exact-once disposal;
  **the resumability proof** — snapshot machine state via
  `Resume.snapshotState`, restore it, and assert the restored atom holds
  the same tagged state without setup replay (copy the shape of the state
  restoration tests in `resume.test.ts`).
- Type tests: state/event/R/E inference through define→spawn; rejecting
  events not in the schema; guard/action key exhaustiveness.
- One demo: rewrite `behaviors.disclosure` on a two-state machine as the
  smallest end-to-end proof (keep the old export working).

Then the load-bearing five in order (`collection`, `rovingTabindex`,
`press`, `dismissableLayer` as a service + behavior, `anchorPosition`),
each with its platform-floor note, then KR docs / K1 per the phasing.

## Open questions

1. Package naming: `@affe/kit` vs a mascot-adjacent name for the styled
   tier (headless tier should stay descriptive regardless).
2. Machine module location: **decided — core** (`src/Machine.ts` now;
   `@affe/core` after rename); kit consumes.
3. Does K2 target the current repo or start in the post-rename `@affe/*`
   workspace? (The kit is the natural first tenant of the new packaging.)
4. How much of `behaviors.ts` migrates into machines vs stays as plain
   behaviors? (Simple ones — disclosure — do not need a machine; policy:
   machine only when states × events > trivial.)
5. effect-machine relationship: **decided — runtime dependency**
   (`@typeonce/effect-machine@0.1.0` on `effect@4.0.0-beta.102`). Affe
   adapter only; their AtomMachine unused. When Effect ships Machine
   in-core, swap the import behind `src/Machine.ts`.
6. Mixin: **designed** (see Mixin section); implement as K0c after K0b
   hand-written factories. Open only: `elements` last-wins vs
   intersection; exact `mergeSchemas` helper name; whether
   `def(config)` call sugar is required vs `toBehavior(def)(config)` only.

Pruned 2026-07-30 (decided in the foundation sections' ratified-decisions
blocks): `mergeRecipes` signature, compound variant syntax, CSS layer
naming and the consumer layer name, behavior config split, recipe merge
failure model.

Still open, surfaced by the same review:

7. **K0c Mixin timing** — the trigger was "after 2–3 hand-written factories
   prove boilerplate", but the three that exist (`collection`, `press`,
   `roving-tabindex`) are partly broken and none uses the ratified
   two-argument config split. Do they get fixed first (and so re-prove the
   boilerplate honestly), or does the fix land *as* the Mixin migration?
8. **CSS-Tags: absorb as `@affe/css` vs depend externally** (carried
   forward from rung zero; unchanged).
9. **Static CSS extraction preserving cross-module `Style.compose`** — the
   stability guarantee is stated but no extraction design shows how a
   compose chain spanning two packages survives the pass.
10. **Double-attach detection policy.** Attaching one behavior twice to the
    same slot duplicates its listeners with **no diagnostic today**. Is
    that a type error (attachment identity in the slot contract), a runtime
    diagnostic via the `validateAttachment*` channel, or legal-and-
    documented (some behaviors may legitimately stack)? Needed before K3,
    since re-piping an assembled default is the sanctioned customization
    path and therefore the likeliest way to do it by accident.
11. **The machine resume binding shape** — see the Gap 1 correction; listed
    here so it is not lost between phases.

## Mixin/K0c acceptance additions (review, 2026-07-29)

Fold these into the Desugaring checklist as hard acceptance criteria:

1. **Precedence is property-tested, not documented-only.** The fragment
   left-fold is a mini-cascade: last-wins tags, Schema-merged options,
   recipe patches via mergeRecipes. Property tests must cover fragment
   reordering, options field collisions in `mergeSchemas` (define: error?
   last-wins? — pick and pin), and repeated `Mixin.recipe` patch stacking,
   the same way the style merge contract is tested.
2. **tsc-time budget gates K0c.** Variadic `create` accumulating generics
   is the Route-enhancer instantiation-depth territory. Measure typecheck
   time with 30 synthetic catalog modules before shipping; if it blows the
   budget, simplify the fragment typing rather than annotating around it.
3. **Definition never gains render concerns.** `{options, props, elements,
   provides, emits, effect|recipe}` is the complete, closed shape. Adding
   `view`/render/slot-rendering to Definition violates the second-type-axis
   non-goal in spirit; anatomy stays in `View.Slots`, rendering stays in
   components. Add this as a row in the Non-goals table.
4. **Config decode is fail-closed and typed.** Factories use
   `Schema.decodeUnknownSync` (or a decodeUnknownEffect wrapper yielding a
   tagged error), never bare `decodeSync` — a malformed config must be a
   typed failure, not a thrown ParseError defect (matches the repo-wide
   error-hygiene rule).
5. **One canonical materialization path in docs.** `def(config?)` callable
   and `Mixin.toBehavior(def)` both exist; documentation and examples use
   the callable form exclusively, with `toBehavior`/`toRecipe` positioned
   as the explicit/tooling form — avoid teaching two spellings.
6. **Schema-options factories are the portability on-ramp** (record as
   rationale): because options are Schema data decoded at the boundary,
   behavior configurations are wire-serializable by construction — the
   same captures/bind split as Portable. Keep `props` (functions) out of
   any serialized surface permanently.

### Corrections found while making the specs assert the attachment knot (2026-07-30)

Writing `DQ-050`–`DQ-055` out as executable specs exposed four gaps. Each is a
decision still owed; none invalidates the ratification, but the migration cannot
start without them.

**1. `Slots.handles(contract)` has no defined meaning once `define` returns a
factory — and it is load-bearing.** `src/View.ts:614` reads `bound.handle` off
the contract, and `fromSlots` (`:1096`) calls it internally. After `DQ-050`, does
`handles()` **mint fresh** handles or **read stored** ones? If it mints, then
calling `fromSlots(A, …)` twice in one render yields two disjoint sets, and any
call to `Slots.handles` *outside* the render — e.g.
`Behavior.attachScoped(behavior(), Slots.handles(Anatomy))`, which the kit's own
layer-separation spec does legitimately — becomes drift **by construction**. This
is the single biggest unspecified piece of the migration. Settle it before step 2.

**2. `component:slot-target-drift` becomes unfalsifiable at step 2.** It compares
the view's slot set to `bindings.slots` — but `DQ-050` makes `bindings.slots` a
*projection of* the view, after which the two cannot differ. It is correct and
valuable as **migration scaffolding**; the plan must say it is retired (or
re-aimed at the generated/dynamic attachment path) once the migration completes,
or it ships as dead code advertising a check it can no longer perform.

**3. `{ as: "header_nav" }` collides with the namespace it lives in.** The remap
record's keys are `keyof Behavior.ElementsOf<behavior>`, and `as` occupies that
same key space — so a behaviour with an element named `as` is unrepresentable,
and worse, silently reinterpreted as a namespacing directive. Nest it
(`{ elements: {…}, as: "x" }`) or take a third options argument.

**4. The `Style` side is left half-migrated.** `Style.attachToSlots(style,
Anatomy)` now passes the contract **twice** — once into `Style.make` (`DQ-054`)
and again at attach. And by `DQ-051`'s own logic (the capability contract comes
from the *component*), attach should take no contract at all. `DQ-050`–`DQ-055`
covered the `Behavior` side of the attachment knot; the `Style` side needs the
same treatment.

**Also worth a deliberate answer:** `Style.forSlots` is deleted while
`Behavior.forSlots` is kept and strengthened. Defensible — they do different
jobs — but it will read as an inconsistency to anyone learning both, so the
naming should be revisited or the difference documented at both call sites.
