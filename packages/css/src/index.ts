/**
 * `@affe/css` — rung zero of the capability ladder: the pure-CSS styling
 * floor, absorbed from CSS-Tags per ratified `DQ-063` (token namespace,
 * `@layer` order, and Theme's typed references version as ONE surface).
 *
 * The ladder: **pure CSS → platform-native → dormant/resumable →
 * activated** — each rung additive, none rewriting markup. This package is
 * the first rung: a stylesheet a page can ship with zero JavaScript, whose
 * custom-property names ARE the one token namespace the kit's recipes and
 * `Theme` resolve against, and whose `@layer` declaration IS the recipe
 * merge contract (`Style.cssLayerOrder`, ratified).
 *
 * Built against **public `effect-atom-jsx` subpaths only** — the same
 * external-consumer constraint the other `@affe/*` packages pin.
 */
import { cssLayerOrder } from "effect-atom-jsx/Style";
import { defaultThemeTokens, type ThemeTokenSchema } from "effect-atom-jsx/Theme";

/** The one token namespace: `color.text.primary` → `--af-color-text-primary`. */
export function tokenVariableName(path: string): string {
  return `--af-${path.replace(/\./g, "-")}`;
}

function flattenTokens(
  record: Readonly<Record<string, unknown>>,
  prefix: string,
  out: Array<readonly [string, string]>,
): void {
  for (const [key, value] of Object.entries(record)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "object" && value !== null) {
      flattenTokens(value as Record<string, unknown>, path, out);
    } else if (value !== undefined) {
      out.push([path, String(value)] as const);
    }
  }
}

export interface FoundationOptions {
  /** Token schema to emit; defaults to the core default theme tokens. */
  readonly tokens?: ThemeTokenSchema;
  /** Selector carrying the token custom properties. Default `:root`. */
  readonly selector?: string;
}

/**
 * Render the foundation stylesheet:
 *
 * 1. the `@layer` order declaration — stating it FIRST is what makes the
 *    ratified precedence (`defaults` → `components` → `variants` →
 *    `utilities` → `app`) hold regardless of import order;
 * 2. every token as a CSS custom property under the one namespace;
 * 3. `color-scheme: light dark`, so `Theme.lightDark(...)` token values
 *    switch with the OS with no framework code (the zero-JS theming rung).
 */
export function foundationStylesheet(options?: FoundationOptions): string {
  const tokens = options?.tokens ?? defaultThemeTokens;
  const selector = options?.selector ?? ":root";
  const flat: Array<readonly [string, string]> = [];
  flattenTokens(tokens as Readonly<Record<string, unknown>>, "", flat);
  const lines = flat.map(([path, value]) => `  ${tokenVariableName(path)}: ${value};`);
  return [
    `@layer ${cssLayerOrder.join(", ")};`,
    `@layer defaults {`,
    `${selector} {`,
    `  color-scheme: light dark;`,
    ...lines,
    `}`,
    `}`,
  ].join("\n");
}

/** The ratified layer order, re-exported so a host never restates it. */
export { cssLayerOrder } from "effect-atom-jsx/Style";
