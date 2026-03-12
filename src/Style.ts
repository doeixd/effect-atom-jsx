import { Effect, Layer } from "effect";
import * as Component from "./Component.js";
import * as Element from "./Element.js";
import { createContext, useContext } from "./api.js";
import { mergeMany, resolveTokenValue } from "./style-runtime.js";
import type { SlotStyle } from "./style-types.js";
import type { TokenPath } from "./style-types.js";

type AnySlot = Record<string, unknown>;

export interface SlotPiece {
  readonly _tag: "SlotPiece";
  readonly style: SlotStyle;
}

export interface ConditionalPiece {
  readonly _tag: "ConditionalPiece";
  readonly condition: () => boolean;
  readonly piece: StyleValue;
}

export interface StatesPiece {
  readonly _tag: "StatesPiece";
  readonly states: Record<string, SlotStyle>;
}

export interface ResponsivePiece {
  readonly _tag: "ResponsivePiece";
  readonly map: Record<string, StyleValue>;
}

export interface AnimationPiece {
  readonly _tag: "AnimationPiece";
  readonly value: Record<string, unknown>;
}

export interface NestPiece {
  readonly _tag: "NestPiece";
  readonly selectors: Record<string, SlotStyle>;
}

export interface VarsPiece {
  readonly _tag: "VarsPiece";
  readonly vars: Record<`--${string}`, unknown | (() => unknown)>;
}

export interface MediaPiece {
  readonly _tag: "MediaPiece";
  readonly media: Record<string, StyleValue | SlotStyle>;
}

export interface SupportsPiece {
  readonly _tag: "SupportsPiece";
  readonly supports: Record<string, StyleValue | SlotStyle>;
}

export interface ContainerPiece {
  readonly _tag: "ContainerPiece";
  readonly name?: string;
  readonly queries: Record<string, StyleValue | SlotStyle>;
}

export interface ContainerTypePiece {
  readonly _tag: "ContainerTypePiece";
  readonly name: string;
  readonly containerType: "inline-size" | "size";
}

export interface PseudoPiece {
  readonly _tag: "PseudoPiece";
  readonly pseudo: Record<string, SlotStyle>;
}

export interface AnimatePiece {
  readonly _tag: "AnimatePiece";
  readonly animationName: string;
  readonly options?: Record<string, unknown>;
}

export interface EnterPiece {
  readonly _tag: "EnterPiece";
  readonly piece: StyleValue;
}

export interface ExitPiece {
  readonly _tag: "ExitPiece";
  readonly piece: StyleValue;
}

export interface EnterStaggerPiece {
  readonly _tag: "EnterStaggerPiece";
  readonly delay: (index: number) => number;
  readonly animation: StyleValue;
}

export interface LayoutAnimationPiece {
  readonly _tag: "LayoutAnimationPiece";
  readonly options: Record<string, unknown>;
}

export interface GridPiece<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly _tag: "GridPiece";
  readonly grid: T;
}

export interface LayerPiece {
  readonly _tag: "LayerPiece";
  readonly layer: string;
  readonly piece: StyleValue;
}

export interface GlobalPiece {
  readonly _tag: "GlobalPiece";
  readonly global: Record<string, SlotStyle | StyleValue>;
}

export interface ExtendPiece {
  readonly _tag: "ExtendPiece";
  readonly slot: string;
}

export type StyleValue =
  | SlotPiece
  | ConditionalPiece
  | StatesPiece
  | ResponsivePiece
  | AnimationPiece
  | NestPiece
  | VarsPiece
  | MediaPiece
  | SupportsPiece
  | ContainerPiece
  | ContainerTypePiece
  | PseudoPiece
  | AnimatePiece
  | EnterPiece
  | ExitPiece
  | EnterStaggerPiece
  | LayoutAnimationPiece
  | GridPiece
  | LayerPiece
  | GlobalPiece
  | ExtendPiece
  | ReadonlyArray<StyleValue>;

export type SlotStyles<S extends string = string> = Record<S, StyleValue>;

export interface ComposedStyle<S extends string = string> {
  readonly slots: SlotStyles<S>;
}

export function slot(style: SlotStyle): SlotPiece {
  return { _tag: "SlotPiece", style };
}

export function compose(...pieces: ReadonlyArray<StyleValue>): ReadonlyArray<StyleValue> {
  return pieces;
}

export function when(condition: () => boolean, piece: StyleValue): ConditionalPiece {
  return { _tag: "ConditionalPiece", condition, piece };
}

export function states(map: Record<string, SlotStyle>): StatesPiece {
  return { _tag: "StatesPiece", states: map };
}

export function responsive(map: Record<string, StyleValue>): ResponsivePiece {
  return { _tag: "ResponsivePiece", map };
}

export function animation(value: Record<string, unknown>): AnimationPiece {
  return { _tag: "AnimationPiece", value };
}

export function keyframes(name: string, frames: Record<string, SlotStyle>): AnimationPiece;
export function keyframes(frames: Record<string, SlotStyle>, options?: Record<string, unknown>): AnimationPiece;
export function keyframes(
  nameOrFrames: string | Record<string, SlotStyle>,
  framesOrOptions?: Record<string, SlotStyle> | Record<string, unknown>,
): AnimationPiece {
  if (typeof nameOrFrames === "string") {
    return animation({ kind: "keyframes", name: nameOrFrames, frames: framesOrOptions as Record<string, SlotStyle> });
  }
  return animation({ kind: "keyframes", frames: nameOrFrames, options: framesOrOptions as Record<string, unknown> | undefined });
}

export function transition(value: Record<string, unknown>): AnimationPiece {
  return animation({ kind: "transition", ...value });
}

export function make<S extends string>(slots: SlotStyles<S>): ComposedStyle<S> {
  return { slots };
}

export type PseudoClass =
  | "hover" | "focus" | "focus-visible" | "focus-within"
  | "active" | "visited" | "disabled" | "enabled"
  | "checked" | "indeterminate"
  | "first-child" | "last-child" | "only-child"
  | "first-of-type" | "last-of-type"
  | "nth-child" | "nth-last-child" | "nth-of-type"
  | "empty" | "placeholder-shown" | "required" | "optional" | "valid" | "invalid"
  | "read-only" | "read-write";

export function nest(selectors: Record<string, SlotStyle>): NestPiece {
  return { _tag: "NestPiece", selectors };
}

export function child(tag: string, pseudo?: PseudoClass, arg?: string): string {
  if (!pseudo) return `> ${tag}`;
  if (arg) return `> ${tag}:${pseudo}(${arg})`;
  return `> ${tag}:${pseudo}`;
}

export function descendant(tag: string, pseudo?: PseudoClass): string {
  return pseudo ? `${tag}:${pseudo}` : tag;
}

export function sibling(selector: string): string {
  return selector;
}

export function attr(name: string, value?: string): string {
  return value === undefined ? `&[${name}]` : `&[${name}="${value}"]`;
}

export function not(selector: string): string {
  return `&:not(${selector})`;
}

export function is(...selectors: ReadonlyArray<string>): string {
  return `&:is(${selectors.join(",")})`;
}

export function vars(values: Record<`--${string}`, unknown | (() => unknown)>): VarsPiece {
  return { _tag: "VarsPiece", vars: values };
}

export function animate(keyframe: AnimationPiece, options?: Record<string, unknown>): AnimatePiece {
  const value = keyframe.value;
  const name = String(value.name ?? "anonymous");
  return { _tag: "AnimatePiece", animationName: name, options };
}

export function enter(piece: StyleValue): EnterPiece {
  return { _tag: "EnterPiece", piece };
}

export function exit(piece: StyleValue): ExitPiece {
  return { _tag: "ExitPiece", piece };
}

export function enterStagger(options: { readonly delay: (index: number) => number; readonly animation: StyleValue }): EnterStaggerPiece {
  return { _tag: "EnterStaggerPiece", delay: options.delay, animation: options.animation };
}

export function layoutAnimation(options: Record<string, unknown>): LayoutAnimationPiece {
  return { _tag: "LayoutAnimationPiece", options };
}

export function media(defs: Record<string, StyleValue | SlotStyle>): MediaPiece {
  return { _tag: "MediaPiece", media: defs };
}

export function supports(defs: Record<string, StyleValue | SlotStyle>): SupportsPiece {
  return { _tag: "SupportsPiece", supports: defs };
}

export function container(name: string, defs: Record<string, StyleValue | SlotStyle>): ContainerPiece;
export function container(defs: Record<string, StyleValue | SlotStyle>): ContainerPiece;
export function container(
  nameOrDefs: string | Record<string, StyleValue | SlotStyle>,
  defs?: Record<string, StyleValue | SlotStyle>,
): ContainerPiece {
  if (typeof nameOrDefs === "string") {
    return { _tag: "ContainerPiece", name: nameOrDefs, queries: defs ?? {} };
  }
  return { _tag: "ContainerPiece", queries: nameOrDefs };
}

export function containerQuery(name: string, defs: Record<string, StyleValue | SlotStyle>): ContainerPiece {
  return container(name, defs);
}

export function containerType(name: string, type: "inline-size" | "size"): ContainerTypePiece {
  return { _tag: "ContainerTypePiece", name, containerType: type };
}

export function pseudo(defs: Record<string, SlotStyle>): PseudoPiece {
  return { _tag: "PseudoPiece", pseudo: defs };
}

export function grid<T extends Record<string, unknown>>(def: T): GridPiece<T> {
  return { _tag: "GridPiece", grid: def };
}

export type GridAreas<T> = T extends GridPiece
  ? T["grid"] extends { readonly template: { readonly areas: readonly (readonly string[])[] } }
    ? T["grid"]["template"]["areas"][number][number]
    : never
  : never;

export function layers(names: ReadonlyArray<string>): readonly string[] {
  return names;
}

export function inLayer(name: string, piece: StyleValue): LayerPiece {
  return { _tag: "LayerPiece", layer: name, piece };
}

export function global(defs: Record<string, SlotStyle | StyleValue>): GlobalPiece {
  return { _tag: "GlobalPiece", global: defs };
}

export function globalLayer(_globalStyles: GlobalPiece): Layer.Layer<never> {
  return Layer.empty;
}

export function extendsSlot(slot: string): ExtendPiece {
  return { _tag: "ExtendPiece", slot };
}

export function tokenColor(path: TokenPath<"color">): TokenPath<"color"> {
  return path;
}

export function tokenSpacing(path: TokenPath<"spacing">): TokenPath<"spacing"> {
  return path;
}

export function tokenFontSize(path: TokenPath<"fontSize">): TokenPath<"fontSize"> {
  return path;
}

function flattenPiece(piece: StyleValue): ReadonlyArray<SlotStyle> {
  if (Array.isArray(piece)) {
    const all: Array<SlotStyle> = [];
    for (const p of piece) {
      all.push(...flattenPiece(p));
    }
    return all;
  }
  const node = piece as Exclude<StyleValue, ReadonlyArray<StyleValue>>;
  switch (node._tag) {
    case "SlotPiece":
      return [node.style];
    case "ConditionalPiece":
      return node.condition() ? flattenPiece(node.piece) : [];
    case "StatesPiece":
      return [Object.assign({}, node.states.default ?? {}, { _states: node.states }) as SlotStyle];
    case "ResponsivePiece": {
      const base = node.map.base;
      return base === undefined ? [] : flattenPiece(base);
    }
    case "AnimationPiece":
      return [{ animation: node.value }];
    case "NestPiece":
      return [{ __nest: node.selectors } as SlotStyle];
    case "VarsPiece":
      return [node.vars as unknown as SlotStyle];
    case "MediaPiece":
      return [{ __media: node.media } as SlotStyle];
    case "SupportsPiece":
      return [{ __supports: node.supports } as SlotStyle];
    case "ContainerPiece":
      return [{ __container: { name: node.name, queries: node.queries } } as SlotStyle];
    case "ContainerTypePiece":
      return [{ __containerType: { name: node.name, type: node.containerType } } as SlotStyle];
    case "PseudoPiece":
      return [{ __pseudo: node.pseudo } as SlotStyle];
    case "AnimatePiece":
      return [{ animation: { name: node.animationName, ...(node.options ?? {}) } } as SlotStyle];
    case "EnterPiece":
      return [{ __enter: node.piece } as SlotStyle];
    case "ExitPiece":
      return [{ __exit: node.piece } as SlotStyle];
    case "EnterStaggerPiece":
      return [{ __enterStagger: { delay: node.delay, animation: node.animation } } as SlotStyle];
    case "LayoutAnimationPiece":
      return [{ __layoutAnimation: node.options } as SlotStyle];
    case "GridPiece":
      return [{ __grid: node.grid } as SlotStyle];
    case "LayerPiece":
      return [{ __layer: node.layer, __layerStyle: node.piece } as SlotStyle];
    case "GlobalPiece":
      return [{ __global: node.global } as SlotStyle];
    case "ExtendPiece":
      return [{ __extends: node.slot } as SlotStyle];
    default:
      return [];
  }
}

function resolveSlot(piece: StyleValue): SlotStyle {
  return mergeMany(flattenPiece(piece));
}

function applyResolvedStyleToHandle(handle: Element.Handle, styleDef: SlotStyle): Effect.Effect<void> {
  return Effect.forEach(Object.entries(styleDef), ([prop, value]) => {
    if (prop === "_states") return Effect.void;
    if (prop.startsWith("__")) return Effect.void;
    if (typeof value === "function") {
      return handle.setStyle(prop, () => resolveTokenValue((value as () => unknown)()));
    }
    return handle.setStyleOnce(prop, resolveTokenValue(value));
  }).pipe(Effect.asVoid) as Effect.Effect<void>;
}

type Overrides = Record<string, StyleValue>;
const OverrideContext = createContext<Overrides>({});

export const Provider = (props: { readonly overrides: Overrides; readonly children: unknown }) =>
  OverrideContext.Provider({ value: props.overrides, children: props.children });

export function override<T extends Overrides>(overrides: T): T {
  return overrides;
}

export function attach<S extends string>(
  style: ComposedStyle<S>,
): <Props, Req, E, Bindings extends { readonly slots: { readonly [K in S]: Element.Handle | Element.Collection<Element.Handle> } }>(
  component: Component.Component<Props, Req, E, Bindings>,
) => Component.Component<Props, Req, E, Bindings> {
  return Component.tapSetup((bindings) =>
    Effect.gen(function* () {
      const overrides = useContext(OverrideContext);
      for (const [slotName, slotPiece] of Object.entries(style.slots as Record<string, StyleValue>)) {
        const overridePiece = overrides[slotName];
        const resolved = resolveSlot(overridePiece ?? slotPiece);
        const target = (bindings as any).slots?.[slotName] as Element.Handle | Element.Collection<Element.Handle> | undefined;
        if (!target) continue;

        if ((target as Element.Collection<Element.Handle>)._tag === "Collection") {
          const collection = target as Element.Collection<Element.Handle>;
          yield* collection.observeEach((item) => applyResolvedStyleToHandle(item, resolved).pipe(Effect.as(() => {})));
        } else {
          yield* applyResolvedStyleToHandle(target as Element.Handle, resolved);
        }
      }
    })) as any;
}

export function attachBySlots<
  S extends string,
  M extends { readonly [K in S]: string },
  Props,
  Req,
  E,
  Bindings extends {
    readonly slots: Record<M[keyof M] & string, Element.Handle | Element.Collection<Element.Handle>>;
  },
>(
  style: ComposedStyle<S>,
  map: M,
): (
  component: Component.Component<Props, Req, E, Bindings>,
) => Component.Component<Props, Req, E, Bindings> {
  const mappedSlots: Record<string, StyleValue> = {};
  for (const styleSlot of Object.keys(map) as Array<keyof M>) {
    const componentSlot = map[styleSlot];
    mappedSlots[String(componentSlot)] = style.slots[String(styleSlot) as S];
  }
  return attach(make(mappedSlots));
}

export function attachBySlotsFor<
  Bindings extends { readonly slots: Record<string, Element.Handle | Element.Collection<Element.Handle>> },
>() {
  return <
    S extends string,
    M extends { readonly [K in S]: keyof Bindings["slots"] },
    Props,
    Req,
    E,
  >(
    style: ComposedStyle<S>,
    map: M,
  ): ((component: Component.Component<Props, Req, E, Bindings>) => Component.Component<Props, Req, E, Bindings>) => {
    return attachBySlots(style, map as unknown as { readonly [K in S]: string }) as any;
  };
}

type VariantDef = {
  readonly base?: StyleValue;
  readonly variants: Record<string, Record<string, StyleValue>>;
  readonly compounds?: ReadonlyArray<{ readonly when: Record<string, string | boolean>; readonly style: StyleValue }>;
  readonly defaults?: Record<string, string | boolean>;
};

type VariantSelection<D extends VariantDef> = {
  readonly [K in keyof D["variants"]]?: keyof D["variants"][K] & string;
};

export function variants<D extends VariantDef>(def: D) {
  const fn = (selection?: VariantSelection<D>): StyleValue => {
    const picks = { ...(def.defaults ?? {}), ...(selection ?? {}) } as Record<string, string | boolean>;
    const pieces: Array<StyleValue> = [];
    if (def.base) pieces.push(def.base);
    for (const [axis, options] of Object.entries(def.variants)) {
      const pick = picks[axis];
      if (pick !== undefined) {
        const piece = options[String(pick)];
        if (piece) pieces.push(piece);
      }
    }
    for (const compound of def.compounds ?? []) {
      const ok = Object.entries(compound.when).every(([k, v]) => picks[k] === v);
      if (ok) pieces.push(compound.style);
    }
    return compose(...pieces);
  };
  return Object.assign(fn, { __variantDef: def });
}

export type VariantProps<T> = T extends { __variantDef: infer D }
  ? D extends VariantDef
    ? VariantSelection<D>
    : never
  : never;

type RecipeDef<Slots extends string> = {
  readonly slots: ReadonlyArray<Slots>;
  readonly base: Record<Slots, StyleValue>;
  readonly variants?: Record<string, Record<string, Partial<Record<Slots, StyleValue>>>>;
  readonly defaults?: Record<string, string | boolean>;
};

type RecipeSelection<D extends RecipeDef<any>> = D["variants"] extends Record<string, any>
  ? { readonly [K in keyof D["variants"]]?: keyof D["variants"][K] & string }
  : {};

export function recipe<Slots extends string, D extends RecipeDef<Slots>>(def: D) {
  const fn = (selection?: RecipeSelection<D>): Record<Slots, StyleValue> => {
    const out = { ...def.base } as Record<Slots, StyleValue>;
    const picks = { ...(def.defaults ?? {}), ...(selection ?? {}) } as Record<string, string | boolean>;
      if (def.variants) {
      for (const [axis, axisVariants] of Object.entries(def.variants)) {
        const pick = picks[axis];
        if (pick === undefined) continue;
        const stylePatch = axisVariants[String(pick)];
        if (!stylePatch) continue;
        for (const [slotName, piece] of Object.entries(stylePatch as Record<string, StyleValue>)) {
          if (typeof piece === "object" && piece !== null && !Array.isArray(piece) && (piece as any)._tag === "ExtendPiece") {
            const extended = out[(piece as ExtendPiece).slot as Slots];
            out[slotName as Slots] = compose(out[slotName as Slots], extended);
          } else {
            out[slotName as Slots] = compose(out[slotName as Slots], piece);
          }
        }
      }
    }
    return out;
  };
  return Object.assign(fn, { __recipeDef: def });
}

export type RecipeProps<T> = T extends { __recipeDef: infer D }
  ? D extends RecipeDef<any>
    ? RecipeSelection<D>
    : never
  : never;

export const Style = {
  slot,
  compose,
  when,
  states,
  responsive,
  animation,
  keyframes,
  transition,
  make,
  nest,
  child,
  descendant,
  sibling,
  attr,
  not,
  is,
  vars,
  animate,
  enter,
  exit,
  enterStagger,
  layoutAnimation,
  media,
  supports,
  container,
  containerQuery,
  containerType,
  pseudo,
  grid,
  layers,
  inLayer,
  global,
  globalLayer,
  extends: extendsSlot,
  tokenColor,
  tokenSpacing,
  tokenFontSize,
  attach,
  attachBySlots,
  attachBySlotsFor,
  variants,
  recipe,
  override,
  Provider,
} as const;
