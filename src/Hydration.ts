import type * as Atom from "./Atom.js";
import type * as Registry from "./Registry.js";

export interface DehydratedAtom {
  readonly "~@effect-atom-jsx/DehydratedAtom": true;
}

export interface DehydratedAtomValue extends DehydratedAtom {
  readonly key: string;
  readonly value: unknown;
  readonly dehydratedAt: number;
}

export const dehydrate = (
  registry: Registry.Registry,
  entries: Iterable<readonly [key: string, atom: Atom.Atom<any>]>,
): Array<DehydratedAtomValue> => {
  const out: Array<DehydratedAtomValue> = [];
  const ts = Date.now();
  for (const [key, atom] of entries) {
    out.push({
      "~@effect-atom-jsx/DehydratedAtom": true,
      key,
      value: registry.get(atom),
      dehydratedAt: ts,
    });
  }
  return out;
};

export const toValues = (state: ReadonlyArray<DehydratedAtom>): Array<DehydratedAtomValue> =>
  state.filter((item): item is DehydratedAtomValue =>
    typeof item === "object" && item !== null && "key" in item && "value" in item,
  );

export const hydrate = (
  registry: Registry.Registry,
  dehydratedState: Iterable<DehydratedAtom>,
  resolvers: Readonly<Record<string, Atom.Writable<any, any>>>,
): void => {
  for (const value of toValues(Array.from(dehydratedState))) {
    const atom = resolvers[value.key];
    if (!atom) continue;
    registry.set(atom, value.value);
  }
};
