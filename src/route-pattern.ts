/**
 * route-pattern.ts — the one path-segment engine (R5.4).
 *
 * `Route` and `ServerRoute` used to carry separate matchers whose grammars
 * drifted (`Route` had `:name?` but no `*`; `ServerRoute` had `*` but no
 * `:name?`; `Route.link` had a third, string-replace parser that emitted
 * malformed URLs for optional segments). This module owns the grammar —
 * `static`, `:param`, `:param?`, `*` — and matching, extraction, and
 * substitution all read the same parse, so the engines cannot disagree about
 * what a pattern means.
 *
 * Semantics, frozen here:
 * - `:param?` may appear anywhere, but a segment may only be *absent* when
 *   every following segment is also optional (in practice: trailing).
 * - `*` consumes the rest of the path and requires **at least one** segment;
 *   its captured value keys as `"*"`, slash-joined.
 * - Non-exact matching is prefix matching: extra path segments are allowed.
 */

export interface PatternSegment {
  readonly kind: "static" | "param" | "splat";
  /** Param name; `"*"` for splat; the raw text for static segments. */
  readonly name: string;
  readonly optional: boolean;
  readonly raw: string;
}

export function parsePattern(pattern: string): ReadonlyArray<PatternSegment> {
  return pattern
    .split("/")
    .filter((part) => part.length > 0)
    .map((raw) => {
      if (raw === "*") {
        return { kind: "splat" as const, name: "*", optional: false, raw };
      }
      if (raw.startsWith(":")) {
        const optional = raw.endsWith("?");
        return {
          kind: "param" as const,
          name: raw.slice(1, optional ? -1 : undefined),
          optional,
          raw,
        };
      }
      return { kind: "static" as const, name: raw, optional: false, raw };
    });
}

function splitPath(pathname: string): ReadonlyArray<string> {
  return pathname.split("/").filter((part) => part.length > 0);
}

function remainingAreOptional(
  segments: ReadonlyArray<PatternSegment>,
  from: number,
): boolean {
  for (let index = from; index < segments.length; index += 1) {
    if (!(segments[index]!.kind === "param" && segments[index]!.optional)) {
      return false;
    }
  }
  return true;
}

export function matchPatternSegments(
  pattern: string,
  pathname: string,
  exact: boolean,
): boolean {
  return extractPatternParams(pattern, pathname, exact) !== null;
}

/**
 * Extract params for a matching pattern, or `null` when it does not match.
 * Matching and extraction are the same walk, so they cannot disagree.
 */
export function extractPatternParams(
  pattern: string,
  pathname: string,
  exact: boolean,
): Record<string, string> | null {
  const segments = parsePattern(pattern);
  const parts = splitPath(pathname);
  const out: Record<string, string> = {};
  let partIndex = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment.kind === "splat") {
      const rest = parts.slice(partIndex);
      if (rest.length === 0) return null;
      out["*"] = rest.map((part) => decodeURIComponent(part)).join("/");
      return out;
    }
    const part = parts[partIndex];
    if (part === undefined) {
      return remainingAreOptional(segments, index) ? out : null;
    }
    if (segment.kind === "param") {
      out[segment.name] = decodeURIComponent(part);
      partIndex += 1;
      continue;
    }
    if (segment.raw !== part) return null;
    partIndex += 1;
  }
  if (exact && partIndex !== parts.length) return null;
  return out;
}

/**
 * Build a concrete path from a pattern and encoded param values.
 *
 * An absent optional segment disappears entirely (`DQ-038`: never a stray `?`
 * in an emitted URL). An absent *required* param keeps its raw `:name` text,
 * preserving the historical `Route.link` behaviour for partial substitution.
 */
export function substitutePattern(
  pattern: string,
  params: Readonly<Record<string, unknown>>,
  encode: (value: string) => string = encodeURIComponent,
): string {
  const parts: string[] = [];
  for (const segment of parsePattern(pattern)) {
    if (segment.kind === "static") {
      parts.push(segment.raw);
      continue;
    }
    const value = params[segment.name];
    if (segment.kind === "splat") {
      if (value !== undefined && value !== null && String(value).length > 0) {
        parts.push(String(value));
      }
      continue;
    }
    if (value === undefined || value === null) {
      if (!segment.optional) parts.push(segment.raw);
      continue;
    }
    parts.push(encode(String(value)));
  }
  return `/${parts.join("/")}`;
}
