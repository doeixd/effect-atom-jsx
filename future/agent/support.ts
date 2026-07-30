/**
 * Local helpers for the `future/agent/` specs.
 *
 * Deliberately not a `*.spec.ts` file, so vitest never collects it. It imports
 * only `effect` (a real dependency) — never `src/`, per the `future/` contract.
 *
 * Every helper takes/returns `any`, because the APIs these specs describe do
 * not exist yet and `harness.pick` hands back `any`. Type-level expectations
 * belong in `src/type-tests/`.
 */

import { Cause, Effect, Exit, Option } from "effect";

/** Run an Effect that must succeed, returning its success value. */
export const run = (effect: any): Promise<any> => Effect.runPromise(effect);

/**
 * Run an Effect that must fail with a *typed* error (never a defect), and
 * return that error value. Used pervasively here: "fails closed" means a
 * classified error, not a crash.
 */
export const runFail = async (effect: any): Promise<any> => {
  const exit: any = await Effect.runPromiseExit(effect);
  if (!Exit.isFailure(exit)) {
    throw new Error(
      `expected a typed failure, but the effect succeeded with ${JSON.stringify(exit.value)}`,
    );
  }
  if (Cause.hasDies(exit.cause)) {
    throw new Error(`expected a typed failure, got a defect: ${String(exit.cause)}`);
  }
  return Option.getOrThrowWith(
    Cause.findErrorOption(exit.cause),
    () => new Error(`failure carried no typed error: ${String(exit.cause)}`),
  );
};

/** The `_tag` of a typed error, for discriminated-union assertions. */
export const tagOf = (value: any): string => String(value?._tag);

/** Deep-freeze check: a serializable IR must survive a JSON round trip intact. */
export const jsonRoundTrips = (value: unknown): boolean => {
  try {
    return JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value);
  } catch {
    return false;
  }
};

/** Recursively collect every function found in a value (must be empty for IR). */
export const findFunctions = (value: unknown, path = "$"): ReadonlyArray<string> => {
  if (typeof value === "function") return [path];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findFunctions(item, `${path}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      findFunctions(item, `${path}.${key}`),
    );
  }
  return [];
};

/** Collect every string in a value, for leak assertions. */
export const allStrings = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => [key, ...allStrings(item)]);
  }
  return [];
};
