/**
 * Mixin — declarative catalog modules (`DQ-065` ratified; plan K0c).
 *
 * Declaration sugar + typed merge, NOT a runtime framework: a Mixin module is
 * an ordered list of fragments, `create(...)` left-folds them into one
 * immutable definition, and `toBehavior(def)` materializes a factory that is
 * observationally equivalent to a hand-written Schema factory — same
 * attach-time `Behavior.decodeOptions` fail-closed decode, same bindings,
 * same `provides`/`emits`/`events` metadata, same composition rules.
 *
 * Hard non-goals (plan): no hooks/middleware, no second runtime, no
 * `Mixin.compose` that runs effects (horizontal stacking stays
 * `Behavior.compose`), no `run` inside Schema. Fragment merge is last-wins,
 * exactly like `Behavior.compose`'s ratified `DQ-057` semantics.
 */
import { Effect, Schema } from "effect";
import * as Behavior from "./Behavior.js";

// ─── Definition ──────────────────────────────────────────────────────────────

export interface EffectContext<Options, Props, Elements, Deps> {
  /** Decoded options (Schema defaults applied). */
  readonly options: Options;
  /** Raw call-site props (functions etc.) — never decoded, never on-wire. */
  readonly props: Props;
  readonly elements: Elements;
  /** Per-instance dependency channel (`DQ-052`). */
  readonly deps: Deps;
}

export interface Definition<
  OptionsSchema extends Schema.Top = Schema.Struct<{}>,
  Props = {},
  Elements = {},
  Bindings = {},
  Req = never,
  E = never,
  Deps = {},
> {
  readonly tag: string;
  readonly kind: "behavior" | "recipe";
  readonly options: OptionsSchema;
  readonly provides?: Behavior.BindingContract;
  readonly emits?: Behavior.OutEventContract;
  readonly events?: Behavior.BehaviorEventMap<Elements>;
  readonly effect?: (
    ctx: EffectContext<OptionsSchema["Type"], Props, Elements, Deps>,
  ) => Effect.Effect<Bindings, E, Req>;
  readonly recipe?: unknown;
  /** Phantom carrier for `Props`/`Elements`; never read at runtime. */
  readonly "~types"?: {
    readonly Props: Props;
    readonly Elements: Elements;
    readonly Bindings: Bindings;
    readonly Req: Req;
    readonly E: E;
    readonly Deps: Deps;
  };
}

export type AnyDefinition = Definition<any, any, any, any, any, any, any>;

export type OptionsOf<M extends AnyDefinition> = M["options"];
export type PropsOf<M extends AnyDefinition> = NonNullable<M["~types"]>["Props"];
export type ElementsOf<M extends AnyDefinition> = NonNullable<M["~types"]>["Elements"];
/** The call-site config: encoded (optional) Schema knobs + optional props. */
export type ConfigOf<M extends AnyDefinition> =
  & OptionsOf<M>["Encoded"]
  & Partial<PropsOf<M>>;
export type BehaviorOf<M extends AnyDefinition> = Behavior.Behavior<
  ElementsOf<M>,
  NonNullable<M["~types"]>["Bindings"],
  NonNullable<M["~types"]>["Req"],
  NonNullable<M["~types"]>["E"] | Behavior.BehaviorOptionsError,
  NonNullable<M["~types"]>["Deps"]
>;

// ─── Fragments ───────────────────────────────────────────────────────────────

/**
 * A fragment is a definition-time transform. Each fragment kind carries a
 * typed PATCH phantom, so `create`'s fold can compute the resulting
 * definition type precisely (generic functions cannot be applied at the
 * type level; data patches can).
 */
export interface Fragment {
  readonly _tag: "MixinFragment";
  readonly apply: (definition: AnyDefinition) => AnyDefinition;
}
export interface OptionsFragment<S extends Schema.Top> extends Fragment {
  readonly "~patch"?: { readonly options: S };
}
export interface PropsFragment<P> extends Fragment {
  readonly "~patch"?: { readonly props: P };
}
export interface ElementsFragment<El> extends Fragment {
  readonly "~patch"?: { readonly elements: El };
}
export interface EffectFragment<Props, Elements, Bindings, Req, E, Deps>
  extends Fragment
{
  readonly "~patch"?: {
    readonly effect: [Props, Elements, Bindings, Req, E, Deps];
  };
}

function fragment(
  apply: (definition: AnyDefinition) => AnyDefinition,
): Fragment {
  return { _tag: "MixinFragment", apply };
}

/** Stable name for devtools/diagnostics; last wins. */
export function tag(name: string): Fragment {
  return fragment((definition) => ({ ...definition, tag: name }));
}

/** `"behavior"` (default) or `"recipe"`; last wins. */
export function kind(value: "behavior" | "recipe"): Fragment {
  return fragment((definition) => ({ ...definition, kind: value }));
}

/** Data knobs — MUST be Schema. A later `options` REPLACES a prior one. */
export function options<S extends Schema.Top>(schema: S): OptionsFragment<S> {
  return fragment((definition) => ({ ...definition, options: schema }));
}

/** Merge two option Structs field-wise (explicit, preferred over spread). */
export function mergeSchemas<
  A extends Schema.Struct<any>,
  B extends Schema.Struct<any>,
>(base: A, extension: B) {
  return Schema.Struct({ ...base.fields, ...extension.fields });
}

/** Non-Schema call-site props (functions etc.); types intersect. */
export function props<P>(): PropsFragment<P> {
  return fragment((definition) => definition);
}

/** The behavior's element contract; last wins. */
export function elements<El>(): ElementsFragment<El> {
  return fragment((definition) => definition);
}

/** Published bindings contract; shallow key merge, same key last wins. */
export function provides(contract: Behavior.BindingContract): Fragment {
  return fragment((definition) => ({
    ...definition,
    provides: { ...definition.provides, ...contract },
  }));
}

/** Out-event contract; shallow key merge, same key last wins. */
export function emits(contract: Behavior.OutEventContract): Fragment {
  return fragment((definition) => ({
    ...definition,
    emits: { ...definition.emits, ...contract },
  }));
}

/** Element event requirements; shallow key merge, same key last wins. */
export function events(eventMap: Behavior.BehaviorEventMap<any>): Fragment {
  return fragment((definition) => ({
    ...definition,
    events: { ...definition.events, ...eventMap },
  }));
}

/**
 * The behavior body. A later `effect` REPLACES a prior one (full replace —
 * wrap by calling a shared function, or `Behavior.compose` after
 * `toBehavior`; there is deliberately no `super.effect()`).
 */
export function effect<
  Options,
  Props,
  Elements,
  Bindings,
  Req = never,
  E = never,
  Deps = {},
>(
  run: (
    ctx: EffectContext<Options, Props, Elements, Deps>,
  ) => Effect.Effect<Bindings, E, Req>,
): EffectFragment<Props, Elements, Bindings, Req, E, Deps> {
  return fragment((definition) => ({ ...definition, effect: run as never }));
}

// ─── create ──────────────────────────────────────────────────────────────────

const emptyDefinition: Definition = {
  tag: "anonymous",
  kind: "behavior",
  options: Schema.Struct({}),
};

type Carry<M extends AnyDefinition> = NonNullable<M["~types"]>;
type ApplyOne<M extends AnyDefinition, F> =
  F extends EffectFragment<infer Pr, infer El, infer B, infer R, infer Err, infer D>
    ? Definition<OptionsOf<M>, Pr, El, B, R, Err, D>
    : F extends OptionsFragment<infer S> ? Definition<
        S,
        PropsOf<M>,
        ElementsOf<M>,
        Carry<M>["Bindings"],
        Carry<M>["Req"],
        Carry<M>["E"],
        Carry<M>["Deps"]
      >
    : F extends PropsFragment<infer P> ? Definition<
        OptionsOf<M>,
        PropsOf<M> & P,
        ElementsOf<M>,
        Carry<M>["Bindings"],
        Carry<M>["Req"],
        Carry<M>["E"],
        Carry<M>["Deps"]
      >
    : F extends ElementsFragment<infer El> ? Definition<
        OptionsOf<M>,
        PropsOf<M>,
        El,
        Carry<M>["Bindings"],
        Carry<M>["Req"],
        Carry<M>["E"],
        Carry<M>["Deps"]
      >
    : F extends Fragment ? M
      : never;
type FoldFragments<M extends AnyDefinition, Fs extends readonly unknown[]> =
  Fs extends readonly [] ? M
    : Fs extends readonly [infer Head, ...infer Rest]
      ? ApplyOne<M, Head> extends infer Next extends AnyDefinition
        ? FoldFragments<Next, Rest>
        : never
      : never;

/**
 * Left-fold fragments into one immutable definition. Pass a prior
 * `Definition` as the first argument to specialize it (inherit tag,
 * elements, provides, effect unless overridden).
 */
export function create<
  const Fs extends readonly [Fragment | AnyDefinition, ...Fragment[]],
>(
  ...fragments: Fs
): Fs extends readonly [infer Head, ...infer Rest]
  ? Head extends AnyDefinition ? FoldFragments<Head, Rest>
    : FoldFragments<typeof emptyDefinition, Fs>
  : never {
  const [head, ...rest] = fragments;
  const isDefinition = typeof head === "object" && head !== null && "tag" in head
    && !("_tag" in head);
  let definition: AnyDefinition = isDefinition
    ? (head as AnyDefinition)
    : emptyDefinition;
  const toApply = isDefinition ? rest : fragments;
  for (const entry of toApply) {
    definition = (entry as Fragment).apply(definition);
  }
  return Object.freeze({ ...definition }) as never;
}

// ─── Materializers ───────────────────────────────────────────────────────────

/**
 * Materialize a behavior factory observationally equivalent to a
 * hand-written catalog factory: the call splits config into Schema fields
 * vs prop keys by the Schema's OWN field names, options decode at ATTACH
 * time through `Behavior.decodeOptions` (fail-closed typed — the factory
 * never throws), and metadata attaches exactly as `Behavior.provides` /
 * `emits` / `events` would.
 */
export function toBehavior<M extends AnyDefinition>(
  definition: M,
): (config?: ConfigOf<M>) => BehaviorOf<M> {
  if (definition.kind !== "behavior") {
    throw new Error(
      `[Mixin] Definition "${definition.tag}" has kind "${definition.kind}"; only kind "behavior" can materialize via toBehavior.`,
    );
  }
  const run = definition.effect;
  if (run === undefined) {
    throw new Error(
      `[Mixin] Definition "${definition.tag}" has no effect fragment; a behavior definition must declare one.`,
    );
  }
  const schemaFields = new Set(
    Object.keys(
      (definition.options as unknown as { readonly fields?: object }).fields ?? {},
    ),
  );
  return (config = {} as ConfigOf<M>) => {
    const schemaPart: Record<string, unknown> = {};
    const propPart: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config as object)) {
      if (schemaFields.has(key)) schemaPart[key] = value;
      else propPart[key] = value;
    }
    let behavior = Behavior.make((elements: ElementsOf<M>, deps: unknown) =>
      Effect.gen(function* () {
        const decoded = yield* Behavior.decodeOptions(
          definition.tag,
          definition.options,
          schemaPart,
        );
        return yield* run({
          options: decoded,
          props: propPart,
          elements,
          deps,
        });
      })
    ) as Behavior.Behavior<any, any, any, any, any>;
    const metadata = {
      ...(definition.events === undefined ? {} : { events: definition.events }),
      ...(definition.provides === undefined ? {} : { provides: definition.provides }),
      ...(definition.emits === undefined ? {} : { emits: definition.emits }),
    };
    if (Object.keys(metadata).length > 0) {
      behavior = Behavior.withMetadata(behavior, metadata);
    }
    return behavior as BehaviorOf<M>;
  };
}
