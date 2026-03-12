import { Layer, ServiceMap } from "effect";
import * as Atom from "./Atom.js";
import { defaultThemeTokens, type ThemeTokens } from "./style-types.js";

export interface ThemeService {
  readonly tokens: ThemeTokens;
  readonly mode: Atom.ReadonlyAtom<"light" | "dark">;
  readonly resolve: (token: string) => string;
}

export const Theme = ServiceMap.Service<ThemeService>("Theme");

export function lookupToken(tokens: ThemeTokens, token: string): unknown {
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

export const ThemeLight: Layer.Layer<ThemeService> = Layer.succeed(Theme, {
  tokens: defaultThemeTokens,
  mode: Atom.value("light") as Atom.ReadonlyAtom<"light" | "dark">,
  resolve: (token: string) => String(lookupToken(defaultThemeTokens, token)),
});
