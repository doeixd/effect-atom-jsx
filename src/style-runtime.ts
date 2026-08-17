import { defaultThemeTokens, type SlotStyle, type ThemeTokenSchema } from "./style-types.js";
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

/**
 * Map a CSS property to the token category its BARE token names resolve in.
 *
 * Property-aware resolution is what keeps token sugar from hijacking CSS
 * keywords: without it, `display: "none"` resolves through `radius.none` and
 * `color: "sm"`-style collisions are one token schema away. A bare name only
 * resolves in its property's own category; a DOTTED path (`"color.accent.hover"`,
 * `"text.primary"`) resolves anywhere, because writing a dot is an explicit
 * request for a token.
 */
export function tokenCategoryOfProperty(property: string): string | undefined {
  const normalized = property.toLowerCase();
  if (/color|background$|^fill$|^stroke$|caret|accent-?color/.test(normalized)) return "color";
  if (
    /^(gap|row-?gap|column-?gap|top|right|bottom|left)$|margin|padding|inset|^translate/.test(
      normalized,
    )
  ) {
    return "spacing";
  }
  if (/font-?size/.test(normalized)) return "fontSize";
  if (/font-?weight/.test(normalized)) return "fontWeight";
  if (/radius/.test(normalized)) return "radius";
  if (/shadow/.test(normalized)) return "shadow";
  if (/^transition/.test(normalized)) return "transition";
  return undefined;
}

function lookupPath(tokens: unknown, path: string): unknown {
  if (typeof tokens !== "object" || tokens === null) return undefined;
  const record = tokens as Record<string, unknown>;
  // Literal dotted keys first: several categories key tokens as "body.sm".
  if (path in record) return record[path];
  const dot = path.indexOf(".");
  if (dot === -1) return undefined;
  return lookupPath(record[path.slice(0, dot)], path.slice(dot + 1));
}

/**
 * The one property-aware token resolution: returns the full token PATH a
 * string value resolves through for `property`, or `undefined` when the
 * value is not a token. Shared by the runtime (which then reads the value)
 * and static extraction (which emits `var(--af-<path>)`).
 */
export function tokenPathForProperty(
  tokens: ThemeTokenSchema,
  property: string | undefined,
  value: string,
): string | undefined {
  const isLeaf = (candidate: unknown): boolean =>
    typeof candidate === "string" || typeof candidate === "number";
  if (value.includes(".")) {
    // A dotted path is an explicit token request: try it verbatim, then under
    // each category prefix (`"text.primary"` → `color.text.primary`).
    const prefixes = ["", "color.", "spacing.", "fontSize.", "fontWeight.", "radius.", "shadow.", "transition.", "breakpoint."];
    for (const prefix of prefixes) {
      const path = `${prefix}${value}`;
      if (isLeaf(lookupPath(tokens, path))) return path;
    }
    return undefined;
  }
  // A bare name resolves ONLY in its property's category.
  const category = property === undefined ? undefined : tokenCategoryOfProperty(property);
  if (category === undefined) return undefined;
  const path = `${category}.${value}`;
  return isLeaf(lookupPath(tokens, path)) ? path : undefined;
}

/**
 * Resolve a style value's token references to concrete values.
 *
 * With a `property`, resolution is property-aware (see
 * `tokenPathForProperty`); without one, it falls back to the historical
 * category-scanning `lookupToken` — kept for non-property contexts such as
 * theme lookups.
 */
export function resolveTokenValue(
  value: unknown,
  tokens: ThemeTokenSchema = defaultThemeTokens,
  property?: string,
): unknown {
  if (typeof value === "string") {
    if (property !== undefined) {
      const path = tokenPathForProperty(tokens, property, value);
      return path === undefined ? value : lookupPath(tokens, path);
    }
    return lookupToken(tokens, value);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTokenValue(v, tokens, property);
    }
    return out;
  }
  return value;
}
