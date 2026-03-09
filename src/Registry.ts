/**
 * Registry.ts — Centralized store for reading, writing, and subscribing to atoms.
 *
 * A Registry manages atom lifecycle (mount/dispose) and provides an imperative
 * API for use outside reactive contexts (tests, server handlers, etc.).
 */

import { Effect } from "effect";
import { Owner, runWithOwner } from "./owner.js";
import { createEffect } from "./api.js";
import * as Atom from "./Atom.js";

const TypeId = "~effect-atom-jsx/Registry" as const;

export interface Registry {
  readonly [TypeId]: typeof TypeId;
  /** Read the current value of an atom. */
  readonly get: <A>(atom: Atom.Atom<A>) => A;
  /** Mount an atom so its derivation stays active. Returns an unmount function. */
  readonly mount: <A>(atom: Atom.Atom<A>) => () => void;
  /** Force-refresh an atom and invalidate its dependents. */
  readonly refresh: <A>(atom: Atom.Atom<A>) => void;
  /** Write a new value to a writable atom. */
  readonly set: <R, W>(atom: Atom.Writable<R, W>, value: W) => void;
  /** Read, transform, write in one step; returns the computed side-value. */
  readonly modify: <R, W, A>(atom: Atom.Writable<R, W>, f: (_: R) => [A, W]) => A;
  /** Update a writable atom using a function of its current value. */
  readonly update: <R>(atom: Atom.Writable<R, R>, f: (_: R) => R) => void;
  /** Subscribe to value changes. Returns an unsubscribe function. */
  readonly subscribe: <A>(atom: Atom.Atom<A>, f: (_: A) => void, options?: { readonly immediate?: boolean }) => () => void;
  /** Dispose all mounted atoms and clear internal state. */
  readonly reset: () => void;
  /** Alias for `reset`. Disposes the registry and all mounted owners. */
  readonly dispose: () => void;
}

export const isRegistry = (u: unknown): u is Registry =>
  typeof u === "object" && u !== null && TypeId in u;

/**
 * Create a registry for reading/writing/subscribing atoms.
 *
 * @example
 * const registry = Registry.make()
 * registry.set(count, 1)
 * const stop = registry.subscribe(count, console.log)
 */
export const make = (): Registry => {
  const roots = new Set<Owner>();

  const registry: Registry = {
    [TypeId]: TypeId,
    get: (atom) => Effect.runSync(Atom.get(atom)),
    mount: (atom) => {
      const owner = new Owner();
      roots.add(owner);
      runWithOwner(owner, () => {
        createEffect(() => {
          registry.get(atom);
        });
      });
      return () => {
        roots.delete(owner);
        owner.dispose();
      };
    },
    refresh: (atom) => {
      Effect.runSync(Atom.refresh(atom));
    },
    set: (atom, value) => {
      Effect.runSync(Atom.set(atom, value));
    },
    modify: (atom, f) => {
      const current = registry.get(atom);
      const [ret, next] = f(current);
      registry.set(atom, next);
      return ret;
    },
    update: (atom, f) => {
      Effect.runSync(Atom.update(atom, f));
    },
    subscribe: (atom, f, options) => Atom.subscribe(atom, f, options),
    reset: () => {
      for (const root of roots) {
        root.dispose();
      }
      roots.clear();
    },
    dispose: () => {
      registry.reset();
    },
  };

  return registry;
};

/**
 * Read an atom value from a Registry as an `Effect`.
 *
 * @param self - The Registry instance.
 * @param atom - The atom to read.
 * @returns A synchronous Effect producing the atom's current value.
 */
export const getResult = <A>(
  self: Registry,
  atom: Atom.Atom<A>,
): Effect.Effect<A> => Effect.sync(() => self.get(atom));
