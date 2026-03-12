import { describe, it, expect } from "vitest";
import { Schema, Option, Effect, Exit } from "effect";
import * as Atom from "../Atom.js";
import * as AtomSchema from "../AtomSchema.js";
import { createRoot, flush } from "../api.js";

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
    flush();
    expect(Option.isSome(currentVal) && currentVal.value === 42).toBe(true);

    dispose();
  });

  it("isValid reflects parse result", () => {
    const input = Atom.make(123);
    const field = AtomSchema.make(Schema.Int, input);

    expect(Effect.runSync(Atom.get(field.isValid))).toBe(true);

    Effect.runSync(Atom.set(input, 1.5));
    flush();
    expect(Effect.runSync(Atom.get(field.isValid))).toBe(false);
  });

  it("tracks touched state", () => {
    const input = Atom.make(0);
    const field = AtomSchema.make(Schema.Int, input, { initial: 0 });

    expect(Effect.runSync(Atom.get(field.touched))).toBe(false);

    Effect.runSync(Atom.set(field.input, 42));
    flush();
    expect(Effect.runSync(Atom.get(field.touched))).toBe(true);
  });

  it("tracks dirty state with initial value", () => {
    const input = Atom.make(0);
    const field = AtomSchema.make(Schema.Int, input, { initial: 0 });

    expect(Effect.runSync(Atom.get(field.dirty))).toBe(false);

    Effect.runSync(Atom.set(field.input, 42));
    flush();
    expect(Effect.runSync(Atom.get(field.dirty))).toBe(true);

    // Reset back to initial
    Effect.runSync(Atom.set(field.input, 0));
    flush();
    expect(Effect.runSync(Atom.get(field.dirty))).toBe(false);
  });

  it("reset restores initial value and clears touched", () => {
    const input = Atom.make(10);
    const field = AtomSchema.make(Schema.Int, input, { initial: 10 });

    Effect.runSync(Atom.set(field.input, 42));
    flush();
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
    flush();
    expect(Effect.runSync(Atom.get(field.isValid))).toBe(false);

    field.reset();
    expect(Effect.runSync(Atom.get(field.isValid))).toBe(true);
  });

  it("supports pipeable AtomSchema.validated", () => {
    const input = Atom.value("25");
    const field = input.pipe(AtomSchema.validated(Schema.NumberFromString));
    const value = field.value();
    expect(Option.isSome(value)).toBe(true);
    if (Option.isSome(value)) {
      expect(value.value).toBe(25);
    }
  });

  it("supports validateEffect for fields and structs", async () => {
    const age = AtomSchema.makeInitial(Schema.Int, 20);
    const score = AtomSchema.makeInitial(Schema.Int, 10);
    const form = AtomSchema.struct({ age, score });

    const ok = await Effect.runPromise(AtomSchema.validateEffect(form));
    expect(ok).toEqual({ age: 20, score: 10 });

    score.input.set(1.5);
    flush();
    await expect(Effect.runPromise(AtomSchema.validateEffect(form))).rejects.toBeDefined();
  });

  it("path focuses nested writable form state", () => {
    const form = Atom.make<{ user: { name: string }; age: string }>({ user: { name: "Ada" }, age: "42" });
    const nameField = AtomSchema.path<{ user: { name: string }; age: string }, string>(
      form,
      "user",
      "name",
    );

    expect(Effect.runSync(Atom.get(nameField))).toBe("Ada");
    Effect.runSync(Atom.set(nameField, "Grace"));
    flush();
    expect(Effect.runSync(Atom.get(form))).toEqual({ user: { name: "Grace" }, age: "42" });
  });

  it("HtmlInput optional helpers map empty string to null", () => {
    expect(AtomSchema.HtmlInput.optionalString.input("")).toBeNull();
    expect(AtomSchema.HtmlInput.optionalString.input("x")).toBe("x");
    expect(AtomSchema.HtmlInput.optionalNumber.input(" ")).toBeNull();
    expect(AtomSchema.HtmlInput.optionalNumber.input("12")).toBe("12");
  });

  it("struct composes multiple validated fields", () => {
    const age = AtomSchema.makeInitial(Schema.Int, 20);
    const score = AtomSchema.makeInitial(Schema.Int, 10);
    const form = AtomSchema.struct({ age, score });

    expect(form.isValid()).toBe(true);
    expect(form.touched()).toBe(false);
    expect(form.dirty()).toBe(false);

    form.input.set({ age: 30, score: 11 });
    flush();
    expect(form.isValid()).toBe(true);
    expect(form.touched()).toBe(true);
    expect(form.dirty()).toBe(true);
    const value = form.value();
    expect(Option.isSome(value)).toBe(true);
    if (Option.isSome(value)) {
      expect(value.value).toEqual({ age: 30, score: 11 });
    }

    score.input.set(1.5);
    flush();
    expect(form.isValid()).toBe(false);
    const err = form.error();
    expect(Option.isSome(err)).toBe(true);
    if (Option.isSome(err)) {
      expect(err.value.score).toBeDefined();
    }

    form.reset();
    flush();
    expect(form.isValid()).toBe(true);
    expect(form.touched()).toBe(false);
    expect(form.dirty()).toBe(false);
    expect(form.input()).toEqual({ age: 20, score: 10 });
  });

  it("struct supports touch() and nested structs", () => {
    const name = AtomSchema.makeInitial(Schema.String, "");
    const age = AtomSchema.makeInitial(Schema.Int, 10);
    const address = AtomSchema.struct({
      city: AtomSchema.makeInitial(Schema.String, ""),
      zip: AtomSchema.makeInitial(Schema.Int, 12345),
    });
    const form = AtomSchema.struct({ name, age, address });

    expect(form.touched()).toBe(false);
    form.touch();
    flush();
    expect(form.touched()).toBe(true);

    form.input.set({
      name: "Alice",
      age: 11,
      address: { city: "Paris", zip: 75001 },
    });
    flush();
    const value = form.value();
    expect(Option.isSome(value)).toBe(true);
    if (Option.isSome(value)) {
      expect(value.value).toEqual({
        name: "Alice",
        age: 11,
        address: { city: "Paris", zip: 75001 },
      });
    }

    form.reset();
    flush();
    expect(form.input()).toEqual({
      name: "",
      age: 10,
      address: { city: "", zip: 12345 },
    });
  });
});
