import { describe, it, expect } from "vitest";
import { Effect, Logger } from "effect";
import * as Atom from "../Atom.js";
import * as AtomLogger from "../AtomLogger.js";

// Suppress log output during tests
const silentLogger = Logger.make(() => {});

describe("AtomLogger", () => {
  describe("traced", () => {
    it("returns the same value as the original atom", () => {
      const count = Atom.make(42);
      const traced = AtomLogger.traced(count, "count");
      const val = Effect.runSync(Atom.get(traced));
      expect(val).toBe(42);
    });

    it("tracks dependency changes", () => {
      const count = Atom.make(1);
      const traced = AtomLogger.traced(count, "count");

      Effect.runSync(Atom.set(count, 10));
      expect(Effect.runSync(Atom.get(traced))).toBe(10);
    });
  });

  describe("tracedWritable", () => {
    it("reads and writes correctly", () => {
      const count = Atom.make(0);
      const traced = AtomLogger.tracedWritable(count, "count");

      Effect.runSync(Atom.set(traced, 5));
      expect(Effect.runSync(Atom.get(traced))).toBe(5);
      expect(Effect.runSync(Atom.get(count))).toBe(5);
    });
  });

  describe("logGet", () => {
    it("returns the atom value", () => {
      const count = Atom.make(99);
      const val = Effect.runSync(
        AtomLogger.logGet(count, "count").pipe(
          Effect.provide(Logger.layer([silentLogger])),
        ),
      );
      expect(val).toBe(99);
    });
  });

  describe("logSet", () => {
    it("sets the atom value", () => {
      const count = Atom.make(0);
      Effect.runSync(
        AtomLogger.logSet(count, 42, "count").pipe(
          Effect.provide(Logger.layer([silentLogger])),
        ),
      );
      expect(Effect.runSync(Atom.get(count))).toBe(42);
    });
  });

  describe("snapshot", () => {
    it("captures all atom values", () => {
      const a = Atom.make(1);
      const b = Atom.make("hello");
      const c = Atom.make(true);

      const snap = Effect.runSync(
        AtomLogger.snapshot([
          ["a", a],
          ["b", b],
          ["c", c],
        ]),
      );

      expect(snap).toEqual({ a: 1, b: "hello", c: true });
    });

    it("reflects current values after mutation", () => {
      const count = Atom.make(0);
      Effect.runSync(Atom.set(count, 5));

      const snap = Effect.runSync(
        AtomLogger.snapshot([["count", count]]),
      );
      expect(snap).toEqual({ count: 5 });
    });
  });
});
