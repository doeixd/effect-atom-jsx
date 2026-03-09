import { describe, it, expect } from "vitest";
import { Schema, Option, Effect, Exit } from "effect";
import * as Atom from "../Atom.js";
import * as AtomSchema from "../AtomSchema.js";
import { createRoot } from "../api.js";

// Schema.Int properly rejects non-integers (including NaN, strings, etc.)
// Schema.NumberFromString in v4 permissively converts via Number() and doesn't throw on NaN

describe("AtomSchema", () => {
  it("validates valid input", () => {
    const input = Atom.make(123);
    const field = AtomSchema.make(Schema.Int, input);

    const val = Effect.runSync(Atom.get(field.value));
    const err = Effect.runSync(Atom.get(field.error));

    expect(Option.isSome(val) && val.value === 123).toBe(true);
    expect(Option.isNone(err)).toBe(true);
  });

  it("validates invalid input", () => {
    const input = Atom.make(1.5);
    const field = AtomSchema.make(Schema.Int, input);

    const val = Effect.runSync(Atom.get(field.value));
    const err = Effect.runSync(Atom.get(field.error));

    expect(Option.isNone(val)).toBe(true);
    expect(Option.isSome(err)).toBe(true);
  });

  it("updates reactively", () => {
    const input = Atom.make(1.5);
    const field = AtomSchema.make(Schema.Int, input, { initial: 1.5 });

    let currentVal: any;
    const dispose = createRoot((d) => {
      Atom.subscribe(field.value, (v) => currentVal = v);
      return d;
    });

    expect(Option.isNone(currentVal)).toBe(true);

    Effect.runSync(Atom.set(field.input, 42));
    expect(Option.isSome(currentVal) && currentVal.value === 42).toBe(true);

    dispose();
  });

  it("isValid reflects parse result", () => {
    const input = Atom.make(123);
    const field = AtomSchema.make(Schema.Int, input);

    expect(Effect.runSync(Atom.get(field.isValid))).toBe(true);

    Effect.runSync(Atom.set(input, 1.5));
    expect(Effect.runSync(Atom.get(field.isValid))).toBe(false);
  });

  it("tracks touched state", () => {
    const input = Atom.make(0);
    const field = AtomSchema.make(Schema.Int, input, { initial: 0 });

    expect(Effect.runSync(Atom.get(field.touched))).toBe(false);

    Effect.runSync(Atom.set(field.input, 42));
    expect(Effect.runSync(Atom.get(field.touched))).toBe(true);
  });

  it("tracks dirty state with initial value", () => {
    const input = Atom.make(0);
    const field = AtomSchema.make(Schema.Int, input, { initial: 0 });

    expect(Effect.runSync(Atom.get(field.dirty))).toBe(false);

    Effect.runSync(Atom.set(field.input, 42));
    expect(Effect.runSync(Atom.get(field.dirty))).toBe(true);

    // Reset back to initial
    Effect.runSync(Atom.set(field.input, 0));
    expect(Effect.runSync(Atom.get(field.dirty))).toBe(false);
  });

  it("reset restores initial value and clears touched", () => {
    const input = Atom.make(10);
    const field = AtomSchema.make(Schema.Int, input, { initial: 10 });

    Effect.runSync(Atom.set(field.input, 42));
    expect(Effect.runSync(Atom.get(field.touched))).toBe(true);
    expect(Effect.runSync(Atom.get(field.dirty))).toBe(true);

    field.reset();
    expect(Effect.runSync(Atom.get(field.input as Atom.Atom<number>))).toBe(10);
    expect(Effect.runSync(Atom.get(field.touched))).toBe(false);
    expect(Effect.runSync(Atom.get(field.dirty))).toBe(false);
  });

  it("error extracts SchemaError correctly", () => {
    const input = Atom.make(1.5);
    const field = AtomSchema.make(Schema.Int, input);

    const err = Effect.runSync(Atom.get(field.error));
    expect(Option.isSome(err)).toBe(true);
    if (Option.isSome(err)) {
      expect(err.value).toBeDefined();
    }
  });

  it("makeInitial creates a standalone validated atom", () => {
    const field = AtomSchema.makeInitial(Schema.Int, 42);

    expect(Effect.runSync(Atom.get(field.isValid))).toBe(true);
    expect(Option.isSome(Effect.runSync(Atom.get(field.value)))).toBe(true);

    Effect.runSync(Atom.set(field.input, 1.5));
    expect(Effect.runSync(Atom.get(field.isValid))).toBe(false);

    field.reset();
    expect(Effect.runSync(Atom.get(field.isValid))).toBe(true);
  });
});
