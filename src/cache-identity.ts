import { jsonValueIssue } from "./wire-json.js";

/**
 * Canonically encode JSON-like cache parameters.
 *
 * Portable descriptors validate their captures before this boundary. Route
 * params are expected to be plain data as well. Sorting object keys makes the
 * resulting identity stable across server/client object construction order.
 */
export function canonicalCacheParameters(value: unknown): string {
  const issue = jsonValueIssue(value, "Cache parameters");
  if (issue !== undefined) {
    throw new TypeError(issue);
  }
  const encode = (current: unknown): string => {
    if (current === null || typeof current !== "object") {
      return JSON.stringify(current);
    }
    if (Array.isArray(current)) {
      return `[${current.map(encode).join(",")}]`;
    }
    const entries = Object.entries(
      current as Record<string, unknown>,
    ).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${encode(entry)}`)
      .join(",")}}`;
  };
  return encode(value);
}

export interface ResourceCacheIdentity {
  readonly key: string;
  readonly parametersKey: string;
}

/**
 * Build the shared resource/cache identity used by loaders and portable
 * queries. `resourceId` supplies the semantic namespace; `parameters` supplies
 * the canonical server/client input identity.
 */
export function makeResourceCacheIdentity(
  resourceId: string,
  parameters: unknown,
): ResourceCacheIdentity {
  const parametersKey = canonicalCacheParameters(parameters);
  return {
    key: `${resourceId}::${parametersKey}`,
    parametersKey,
  };
}
