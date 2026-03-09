/**
 * AtomLogger.ts — Debug tracing utilities for atom reads and writes.
 *
 * Provides wrapper atoms and Effect-based helpers that log every read/write
 * operation via `Effect.logDebug`. Useful during development to trace reactive
 * data flow without modifying application logic.
 */

import { Effect } from "effect";
import type { Atom, Writable, Context, WriteContext } from "./Atom.js";
import { readable, writable, get, set } from "./Atom.js";

/**
 * Wrap a read-only atom to log each read via `Effect.logDebug`.
 *
 * Logging is performed synchronously with `Effect.runSync` since the atom
 * read path is synchronous.
 *
 * @param atom  - The atom to trace.
 * @param label - A human-readable label included in log annotations.
 *
 * @example
 * const debugCount = AtomLogger.traced(count, "count")
 */
export const traced = <A>(atom: Atom<A>, label: string): Atom<A> =>
  readable(
    (ctx: Context) => {
      const value = ctx(atom);
      Effect.runSync(
        Effect.logDebug("atom:read").pipe(
          Effect.annotateLogs({ atom: label, op: "read", value: String(value) }),
        ),
      );
      return value;
    },
    atom.refresh,
  );

/**
 * Wrap a writable atom to log both reads and writes via `Effect.logDebug`.
 *
 * @param atom  - The writable atom to trace.
 * @param label - A human-readable label included in log annotations.
 *
 * @example
 * const debugCount = AtomLogger.tracedWritable(count, "count")
 */
export const tracedWritable = <R, W>(
  atom: Writable<R, W>,
  label: string,
): Writable<R, W> =>
  writable(
    (ctx: Context) => {
      const value = ctx(atom);
      Effect.runSync(
        Effect.logDebug("atom:read").pipe(
          Effect.annotateLogs({ atom: label, op: "read", value: String(value) }),
        ),
      );
      return value;
    },
    (ctx: WriteContext<R>, value: W) => {
      Effect.runSync(
        Effect.logDebug("atom:write").pipe(
          Effect.annotateLogs({ atom: label, op: "write", value: String(value) }),
        ),
      );
      atom.write(ctx, value);
    },
    atom.refresh,
  );

/**
 * Read an atom value as an Effect, logging the read operation.
 *
 * @param atom  - The atom to read.
 * @param label - Optional label for log annotations (defaults to "unknown").
 *
 * @example
 * const n = yield* AtomLogger.logGet(count, "count")
 */
export const logGet = <A>(atom: Atom<A>, label?: string): Effect.Effect<A> =>
  Effect.flatMap(get(atom), (value) =>
    Effect.as(
      Effect.logDebug("atom:read").pipe(
        Effect.annotateLogs({
          atom: label ?? "unknown",
          op: "read",
          value: String(value),
        }),
      ),
      value,
    ),
  );

/**
 * Write an atom value as an Effect, logging the write operation.
 *
 * @param atom  - The writable atom to update.
 * @param value - The value to write.
 * @param label - Optional label for log annotations (defaults to "unknown").
 *
 * @example
 * yield* AtomLogger.logSet(count, 42, "count")
 */
export const logSet = <R, W>(
  atom: Writable<R, W>,
  value: W,
  label?: string,
): Effect.Effect<void> =>
  Effect.flatMap(
    Effect.logDebug("atom:write").pipe(
      Effect.annotateLogs({
        atom: label ?? "unknown",
        op: "write",
        value: String(value),
      }),
    ),
    () => set(atom, value),
  );

/**
 * Read all provided atoms and return a labeled snapshot record.
 *
 * Useful for debugging or serializing the current state of multiple atoms.
 *
 * @param atoms - Array of `[label, atom]` pairs to snapshot.
 * @returns An Effect producing a `Record<string, unknown>` of label-to-value entries.
 *
 * @example
 * const snap = yield* AtomLogger.snapshot([
 *   ["count", count],
 *   ["name", name],
 * ])
 * // => { count: 1, name: "Alice" }
 */
export const snapshot = (
  atoms: Array<[string, Atom<any>]>,
): Effect.Effect<Record<string, unknown>> =>
  Effect.map(
    Effect.all(
      atoms.map(([label, atom]) =>
        Effect.map(get(atom), (value) => [label, value] as const),
      ),
    ),
    (entries) => Object.fromEntries(entries),
  );
