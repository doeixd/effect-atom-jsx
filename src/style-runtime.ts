import { defaultThemeTokens, type SlotStyle, type ThemeTokens } from "./style-types.js";
import { lookupToken } from "./Theme.js";

export function mergeStyle(a: SlotStyle, b: SlotStyle): SlotStyle {
  return { ...a, ...b };
}

export function mergeMany(styles: ReadonlyArray<SlotStyle>): SlotStyle {
  let out: SlotStyle = {};
  for (const style of styles) {
    out = mergeStyle(out, style);
  }
  return out;
}

export function resolveTokenValue(value: unknown, tokens: ThemeTokens = defaultThemeTokens): unknown {
  if (typeof value === "string") {
    const resolved = lookupToken(tokens, value);
    return resolved;
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTokenValue(v, tokens);
    }
    return out;
  }
  return value;
}
