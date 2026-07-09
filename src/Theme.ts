/**
 * Theme tokens.
 *
 * **P4 decision (2026-07-09):** slot style property helpers stay typed against
 * the default theme taxonomy (`ThemeLight` / built-in paths) plus escape
 * hatches (`Theme.defineTokens` / `Theme.define` for user schemas at
 * lookup/layer sites). Full user-theme-parametric `Style.slot` property types
 * are not required for v1 — keep `Style.tokenColor(...)` default-typed.
 */
import { Layer, ServiceMap } from "effect";
import * as Atom from "./Atom.js";
import { defaultThemeTokens, type ThemeTokenSchema, type ThemeTokens, type TokenPathOf } from "./style-types.js";

/** Theme service consumed by style token resolution. */
export interface ThemeService {
  readonly tokens: ThemeTokenSchema;
  readonly mode: Atom.ReadonlyAtom<"light" | "dark">;
  readonly resolve: (token: string) => string;
}

export const Theme = ServiceMap.Service<ThemeService>("Theme");

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
  return token;
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
    resolve: (token: string) => String(lookupToken(tokens, token)),
  });
}

/** Default light theme layer. */
export const ThemeLight: Layer.Layer<ThemeService> = layer(defaultThemeTokens);

/** Default theme definition for path helpers and lookups. */
export const ThemeDefault = define(defaultThemeTokens);
