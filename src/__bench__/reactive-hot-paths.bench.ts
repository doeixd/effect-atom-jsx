import { bench, describe } from "vitest";
import * as Atom from "../Atom.js";
import * as Reactivity from "../Reactivity.js";
import { normalizeReactivityKeys } from "../reactivity-runtime.js";

/**
 * Microbenchmarks for the core reactive hot paths that back the perf claims in
 * README/afui.md ("granular updates, no VDOM diff, direct mutation, microtask
 * batching"). These are characterization benchmarks — run with
 * `npx vitest bench` — not asserted thresholds; they exist so regressions in
 * the hot paths are visible. See docs/CURRENT_STATUS_IN_REDESIGN_PLAN.md (PR3).
 */

describe("atom read/write", () => {
  const count = Atom.make(0);

  bench("callable read", () => {
    count();
  });

  bench("set", () => {
    count.set(count() + 1);
  });

  bench("update", () => {
    count.update((n) => n + 1);
  });
});

describe("derived propagation", () => {
  const base = Atom.make(1);
  const d1 = Atom.map(base, (n) => n + 1);
  const d2 = Atom.map(d1, (n) => n * 2);
  const d3 = Atom.map(d2, (n) => n - 1);

  bench("write through a 3-level derived chain", () => {
    base.update((n) => n + 1);
    d3();
  });
});

describe("family lookup", () => {
  const trieFamily = Atom.family((id: number) => Atom.make(id));
  const equalsFamily = Atom.family((id: number) => Atom.make(id), {
    equals: (a, b) => a[0] === b[0],
  });

  bench("trie lookup (reference equality)", () => {
    trieFamily(42);
  });

  bench("equals lookup (linear scan)", () => {
    equalsFamily(42);
  });
});

describe("reactivity keys", () => {
  const Users = Reactivity.Key.make("users");
  const user = Reactivity.Key.family("user");
  const stringKeys = ["users", "user:1", "user:2"];
  const witnessKeys = [Users, user(1), user(2)];

  bench("normalize string keys", () => {
    normalizeReactivityKeys(stringKeys);
  });

  bench("normalize witness keys (hierarchy expansion + dedupe)", () => {
    normalizeReactivityKeys(witnessKeys);
  });

  bench("derive a family child witness", () => {
    user(Math.floor(Math.random() * 4));
  });
});
