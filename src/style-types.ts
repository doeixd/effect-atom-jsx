export type Primitive = string | number | boolean;

export interface ShadowDef {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly color: string;
}

export interface ThemeTokens {
  readonly color: {
    readonly surface: string;
    readonly background: string;
    readonly border: string;
    readonly shadow: string;
    readonly text: {
      readonly primary: string;
      readonly secondary: string;
      readonly muted: string;
      readonly inverse: string;
      readonly link: string;
      readonly error: string;
      readonly success: string;
    };
    readonly accent: {
      readonly default: string;
      readonly hover: string;
      readonly active: string;
      readonly subtle: string;
    };
    readonly danger: {
      readonly default: string;
      readonly hover: string;
      readonly active: string;
      readonly subtle: string;
    };
  };
  readonly spacing: {
    readonly xs: number;
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly xl: number;
    readonly "2xl": number;
  };
  readonly fontSize: {
    readonly "body.xs": number;
    readonly "body.sm": number;
    readonly "body.md": number;
    readonly "body.lg": number;
    readonly "heading.sm": number;
    readonly "heading.md": number;
    readonly "heading.lg": number;
    readonly "heading.xl": number;
    readonly "display.sm": number;
    readonly "display.lg": number;
  };
  readonly fontWeight: {
    readonly normal: number;
    readonly medium: number;
    readonly semibold: number;
    readonly bold: number;
  };
  readonly radius: {
    readonly none: number;
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly full: number;
  };
  readonly shadow: {
    readonly sm: ShadowDef;
    readonly md: ShadowDef;
    readonly lg: ShadowDef;
    readonly xl: ShadowDef;
  };
  readonly transition: {
    readonly fast: string;
    readonly normal: string;
    readonly slow: string;
  };
  readonly breakpoint: {
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly xl: number;
  };
}

type Join<K extends string, P extends string> = P extends "" ? K : `${K}.${P}`;

type LeafPaths<T> = T extends Primitive
  ? ""
  : {
      [K in keyof T & string]: T[K] extends Primitive ? K : Join<K, LeafPaths<T[K]>>;
    }[keyof T & string];

export type TokenPath<K extends keyof ThemeTokens> = LeafPaths<ThemeTokens[K]>;

export type Reactive<T> = T | (() => T);

export type StyleColor = TokenPath<"color"> | string;
export type StyleSpacing = TokenPath<"spacing"> | number | readonly [number | string, number | string] | readonly [number | string, number | string, number | string, number | string];
export type StyleFontSize = TokenPath<"fontSize"> | number;
export type StyleFontWeight = TokenPath<"fontWeight"> | number;
export type StyleRadius = TokenPath<"radius"> | number;
export type StyleShadow = TokenPath<"shadow"> | ShadowDef;

export type SlotStyle = {
  readonly padding?: Reactive<StyleSpacing>;
  readonly borderRadius?: Reactive<StyleRadius>;
  readonly backgroundColor?: Reactive<StyleColor>;
  readonly color?: Reactive<StyleColor>;
  readonly fontSize?: Reactive<StyleFontSize>;
  readonly fontWeight?: Reactive<StyleFontWeight>;
  readonly lineHeight?: Reactive<number>;
  readonly opacity?: Reactive<number>;
  readonly cursor?: Reactive<string>;
  readonly transition?: Reactive<TokenPath<"transition"> | string>;
  readonly transform?: Reactive<string>;
  readonly width?: Reactive<number | string>;
  readonly overflow?: Reactive<string>;
  readonly textOverflow?: Reactive<string>;
  readonly whiteSpace?: Reactive<string>;
  readonly pointerEvents?: Reactive<string>;
  readonly textAlign?: Reactive<"left" | "center" | "right">;
  readonly border?: Reactive<unknown>;
  readonly borderTop?: Reactive<unknown>;
  readonly borderBottom?: Reactive<unknown>;
  readonly shadow?: Reactive<StyleShadow>;
  readonly flex?: Reactive<unknown>;
  readonly outline?: Reactive<unknown>;
  readonly animation?: Reactive<string | { readonly name?: string }>;
  readonly [key: string]: unknown;
};

export const defaultThemeTokens: ThemeTokens = {
  color: {
    surface: "#ffffff",
    background: "#f6f8fb",
    border: "#d7dde5",
    shadow: "rgba(0,0,0,0.12)",
    text: {
      primary: "#111827",
      secondary: "#374151",
      muted: "#6b7280",
      inverse: "#ffffff",
      link: "#2563eb",
      error: "#b91c1c",
      success: "#15803d",
    },
    accent: {
      default: "#0f766e",
      hover: "#115e59",
      active: "#134e4a",
      subtle: "#ccfbf1",
    },
    danger: {
      default: "#dc2626",
      hover: "#b91c1c",
      active: "#991b1b",
      subtle: "#fee2e2",
    },
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, "2xl": 48 },
  fontSize: {
    "body.xs": 12,
    "body.sm": 14,
    "body.md": 16,
    "body.lg": 18,
    "heading.sm": 20,
    "heading.md": 24,
    "heading.lg": 28,
    "heading.xl": 32,
    "display.sm": 40,
    "display.lg": 56,
  },
  fontWeight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
  radius: { none: 0, sm: 4, md: 8, lg: 12, full: 9999 },
  shadow: {
    sm: { x: 0, y: 1, blur: 2, color: "rgba(0,0,0,0.12)" },
    md: { x: 0, y: 4, blur: 8, color: "rgba(0,0,0,0.14)" },
    lg: { x: 0, y: 10, blur: 20, color: "rgba(0,0,0,0.16)" },
    xl: { x: 0, y: 16, blur: 32, color: "rgba(0,0,0,0.18)" },
  },
  transition: { fast: "120ms", normal: "200ms", slow: "320ms" },
  breakpoint: { sm: 640, md: 768, lg: 1024, xl: 1280 },
};
