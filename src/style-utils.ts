import * as Style from "./Style.js";
import type { StyleColor, StyleFontSize, StyleFontWeight, StyleRadius, StyleShadow, StyleSpacing } from "./style-types.js";

export const padded = (amount: StyleSpacing) => Style.slot({ padding: amount });

export const rounded = (amount: StyleRadius) => Style.slot({ borderRadius: amount });

export const elevated = (level: StyleShadow extends infer _ ? "sm" | "md" | "lg" | "xl" : never) =>
  Style.slot({ shadow: level as any });

export const bordered = (options?: { readonly width?: number; readonly color?: StyleColor }) =>
  Style.slot({ border: { width: options?.width ?? 1, color: options?.color ?? "border" } });

export const textStyle = (options: {
  readonly size?: StyleFontSize;
  readonly weight?: StyleFontWeight;
  readonly color?: StyleColor;
  readonly align?: "left" | "center" | "right";
}) =>
  Style.slot({
    fontSize: options.size,
    fontWeight: options.weight,
    color: options.color,
    textAlign: options.align,
  });

export const flexRow = (options?: { readonly gap?: StyleSpacing; readonly align?: string; readonly justify?: string }) =>
  Style.slot({ flex: { direction: "row", gap: options?.gap, align: options?.align, justify: options?.justify } });

export const flexCol = (options?: { readonly gap?: StyleSpacing; readonly align?: string; readonly justify?: string }) =>
  Style.slot({ flex: { direction: "column", gap: options?.gap, align: options?.align, justify: options?.justify } });

export const interactive = Style.slot({ cursor: "pointer", transition: "fast" });

export const truncated = Style.slot({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
