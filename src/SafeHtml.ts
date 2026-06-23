export const SafeHtmlTypeId: unique symbol = Symbol.for("effect-atom-jsx/SafeHtml");

export interface SafeHtml {
  readonly [SafeHtmlTypeId]: true;
  readonly html: string;
}

export function make(html: string): SafeHtml {
  return {
    [SafeHtmlTypeId]: true,
    html,
  };
}

export function isSafeHtml(value: unknown): value is SafeHtml {
  return (typeof value === "object" || typeof value === "function")
    && value !== null
    && SafeHtmlTypeId in value;
}

export function unwrap(value: SafeHtml): string {
  return value.html;
}

export const SafeHtml = {
  TypeId: SafeHtmlTypeId,
  make,
  isSafeHtml,
  unwrap,
} as const;
