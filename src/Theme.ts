/**
 * Theme tokens.
 *
 * **P4 decision (2026-07-09):** slot style property helpers stay typed against
 * the default theme taxonomy (`ThemeLight` / built-in paths) plus escape
 * hatches (`Theme.defineTokens` / `Theme.define` for user schemas at
 * lookup/layer sites). Full user-theme-parametric `Style.slot` property types
 * are not required for v1 — keep `Style.tokenColor(...)` default-typed.
 */
import { Layer, Context } from "effect";
import * as Atom from "./Atom.js";
import { defaultThemeTokens, type ThemeTokenSchema, type ThemeTokens, type TokenPathOf } from "./style-types.js";

/** Theme service consumed by style token resolution. */
export interface ThemeService {
  readonly tokens: ThemeTokenSchema;
  readonly mode: Atom.ReadonlyAtom<"light" | "dark">;
  readonly resolve: (token: string) => string;
}

export const Theme = Context.Service<ThemeService>("Theme");

/**
 * User-defined theme contract.
 *
 * Keeps token lookup, typed path creation, and layer construction together for
 * app-specific token schemas.
 */
export interface ThemeDefinition<Tokens extends ThemeTokenSchema> {
  readonly tokens: Tokens;
  path<const Category extends keyof Tokens & string>(
    category: Category,
    path: TokenPathOf<Tokens, Category>,
  ): TokenPathOf<Tokens, Category>;
  lookup(token: string): unknown;
  layer(options?: {
    readonly mode?: "light" | "dark";
  }): Layer.Layer<ThemeService>;
}

/** Preserve literal token schema types for a theme token object. */
export function defineTokens<const Tokens extends ThemeTokenSchema>(tokens: Tokens): Tokens {
  return tokens;
}

/**
 * Define a theme and get helpers for paths, lookup, and Effect layers.
 *
 * @example
 * const Brand = Theme.define({
 *   color: { accent: "#6b5cff" },
 *   spacing: { sm: "0.5rem" },
 * })
 */
export function define<const Tokens extends ThemeTokenSchema>(tokens: Tokens): ThemeDefinition<Tokens> {
  return {
    tokens,
    path: (_category, path) => path,
    lookup: (token) => lookupToken(tokens, token),
    layer: (options) => layer(tokens, options),
  };
}

/** Resolve a token path or short token name against a token schema. */
export function lookupToken(tokens: ThemeTokenSchema, token: string): unknown {
  const candidates = [
    token,
    `color.${token}`,
    `spacing.${token}`,
    `fontSize.${token}`,
    `fontWeight.${token}`,
    `radius.${token}`,
    `shadow.${token}`,
    `transition.${token}`,
    `breakpoint.${token}`,
  ];

  for (const candidate of candidates) {
    const parts = candidate.split(".");
    let current: unknown = tokens;
    let ok = true;
    for (const part of parts) {
      if (typeof current !== "object" || current === null || !(part in current)) {
        ok = false;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (ok) {
      return current;
    }
  }
  // Literal-key fallback: several categories use dotted LITERAL keys
  // ("body.sm" under fontSize), which the path walk above cannot reach —
  // without this, no fontSize token ever resolved.
  for (const category of Object.values(tokens)) {
    if (
      typeof category === "object" && category !== null
      && token in (category as Record<string, unknown>)
    ) {
      return (category as Record<string, unknown>)[token];
    }
  }
  return token;
}

/**
 * Resolve a token, following SEMANTIC INDIRECTION (`DQ-061`, ratified): a
 * token whose value is itself a token path ("brand" -> "color.blue500")
 * resolves through the palette level. Bounded and cycle-guarded; a miss
 * still fails open to the input string (recorded separately in DIN-18).
 */
export function resolveToken(tokens: ThemeTokenSchema, token: string): unknown {
  let current: unknown = token;
  const seen = new Set<string>();
  while (typeof current === "string" && !seen.has(current)) {
    seen.add(current);
    const next = lookupToken(tokens, current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/** Create a Theme service layer from a token schema. */
export function layer<Tokens extends ThemeTokenSchema>(
  tokens: Tokens,
  options?: {
    readonly mode?: "light" | "dark";
  },
): Layer.Layer<ThemeService> {
  return Layer.succeed(Theme, {
    tokens,
    mode: Atom.value(options?.mode ?? "light") as Atom.ReadonlyAtom<"light" | "dark">,
    resolve: (token: string) => String(resolveToken(tokens, token)),
  });
}

/**
 * Compose independently-defined themes into ONE definition (`DQ-061`,
 * ratified option 1): composition is a DEFINITION-time operation producing a
 * complete Layer — never merge-aware `Layer.merge` semantics for the Theme
 * service, which would make one Context service behave against Effect's
 * grain. "Zinc color + compact spacing" is category composition: categories
 * merge by key, later definitions winning per token.
 */
export function compose<
  const Definitions extends readonly [
    ThemeDefinition<any>,
    ...ReadonlyArray<ThemeDefinition<any>>,
  ],
>(
  ...definitions: Definitions
): ThemeDefinition<MergedTokensOf<Definitions>> {
  const merged: Record<string, Record<string, unknown>> = {};
  for (const definition of definitions) {
    for (const [category, tokens] of Object.entries(definition.tokens)) {
      merged[category] = {
        ...(merged[category] ?? {}),
        ...(tokens as Record<string, unknown>),
      };
    }
  }
  return define(merged as MergedTokensOf<Definitions>);
}

type UnionToIntersection<U> =
  (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I
    : never;
type MergedTokensOf<Definitions extends readonly ThemeDefinition<any>[]> =
  UnionToIntersection<Definitions[number]["tokens"]> extends
    infer Merged extends ThemeTokenSchema ? Merged : ThemeTokenSchema;

/** Default light theme layer. */
export const ThemeLight: Layer.Layer<ThemeService> = layer(defaultThemeTokens);

/** Default theme definition for path helpers and lookups. */
export const ThemeDefault = define(defaultThemeTokens);
