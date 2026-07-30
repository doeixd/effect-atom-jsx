/**
 * Harness for the `future/` specification suite.
 *
 * These specs describe the **finished** design. Most of them fail today, and
 * that is the point: a failure here is a work item, not a regression.
 *
 * The one hard rule this harness exists to enforce: **a missing API must fail
 * exactly one spec, never a whole file.** A top-level
 * `import { Agent } from "../src/Agent.js"` of a module that does not exist yet
 * would abort the entire file at collection time and hide every other spec in
 * it. So specs never import source at module scope — they call `loadSrc(...)`
 * inside the spec body, and an absent module or export becomes a single,
 * clearly-labelled failure.
 */

/** Thrown when a spec depends on something that does not exist yet. */
export class NotImplemented extends Error {
  override readonly name = "NotImplemented";
  constructor(what: string, detail?: string) {
    super(`NOT IMPLEMENTED: ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Import a module from `src/` by path *without* an extension, e.g.
 * `loadSrc("Agent")` or `loadSrc("compiler/resume-extract-plugin")`.
 *
 * Resolution is relative to this file, so callers may sit at any depth under
 * `future/`. A module that does not exist yet fails the calling spec with
 * `NOT IMPLEMENTED` rather than exploding at collection time.
 */
export async function loadSrc(path: string): Promise<Record<string, unknown>> {
  const specifier = `../src/${path}.js`;
  try {
    return (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
  } catch (cause) {
    throw new NotImplemented(
      `module src/${path}.ts`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/**
 * Pull named exports off a loaded module, failing with a precise
 * `NOT IMPLEMENTED` message naming every export that is missing.
 *
 * Deliberately returns `any`-shaped values: these specs describe an API that
 * does not exist yet, so there is no type to check them against. Type-level
 * expectations belong in `src/type-tests/` once the runtime shape lands.
 */
export function pick<K extends string>(
  mod: Record<string, unknown>,
  moduleName: string,
  ...names: readonly K[]
): Record<K, any> {
  const missing = names.filter((name) => mod[name] === undefined);
  if (missing.length > 0) {
    throw new NotImplemented(
      `${moduleName}.{${missing.join(", ")}}`,
      `present exports: ${Object.keys(mod).slice(0, 24).join(", ") || "(none)"}`,
    );
  }
  return Object.fromEntries(names.map((name) => [name, mod[name]])) as Record<K, any>;
}

/** Convenience: load a module and pick exports in one step. */
export async function fromSrc<K extends string>(
  path: string,
  ...names: readonly K[]
): Promise<Record<K, any>> {
  const mod = await loadSrc(path);
  return pick(mod, path, ...names);
}

/**
 * Declare that a spec's subject is deliberately unbuilt. Use this when even
 * *describing* the API in code would be guesswork — prefer a real executable
 * spec whenever the shape is decided.
 *
 * `owner` is either:
 *
 * - a plan item (`"M8c.4"`, `"R5"`, `"K1"`) when the plan genuinely owns the
 *   decision and the shape is settled but unimplemented; or
 * - a design-question id (`"DQ-014"`) when the design itself is undecided. The
 *   argument then lives in `docs/design-questions/`, and every spec blocked by
 *   the same question cites the same id — which is how N scattered markers
 *   collapse into one question with one written rationale.
 *
 * If you are about to write `unbuilt(...)` for something with no `DQ-nnn` and no
 * plan item, that is the signal to write an inbox entry first: an undecided
 * design with no record is exactly what `docs/design-questions/` exists to stop.
 */
export function unbuilt(what: string, owner: string): never {
  const isQuestion = /^DQ-\d{3}$/.test(owner);
  throw new NotImplemented(
    what,
    isQuestion
      ? `blocked on open design question ${owner} (docs/design-questions/)`
      : `owned by ${owner}`,
  );
}
