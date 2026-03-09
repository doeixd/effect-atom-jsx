import { Effect } from "effect";
import { Owner, runWithOwner } from "./owner.js";
import { createEffect } from "./api.js";
import * as Atom from "./Atom.js";

const TypeId = "~effect-atom-jsx/Registry" as const;

export interface Registry {
  readonly [TypeId]: typeof TypeId;
  readonly get: <A>(atom: Atom.Atom<A>) => A;
  readonly mount: <A>(atom: Atom.Atom<A>) => () => void;
  readonly refresh: <A>(atom: Atom.Atom<A>) => void;
  readonly set: <R, W>(atom: Atom.Writable<R, W>, value: W) => void;
  readonly modify: <R, W, A>(atom: Atom.Writable<R, W>, f: (_: R) => [A, W]) => A;
  readonly update: <R>(atom: Atom.Writable<R, R>, f: (_: R) => R) => void;
  readonly subscribe: <A>(atom: Atom.Atom<A>, f: (_: A) => void, options?: { readonly immediate?: boolean }) => () => void;
  readonly reset: () => void;
  readonly dispose: () => void;
}

export const isRegistry = (u: unknown): u is Registry =>
  typeof u === "object" && u !== null && TypeId in u;

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

export const getResult = <A>(
  self: Registry,
  atom: Atom.Atom<A>,
): Effect.Effect<A> => Effect.sync(() => self.get(atom));
