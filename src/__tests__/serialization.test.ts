import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import * as Serialization from "../Serialization.js";
import { Result } from "../effect-ts.js";
import type { Result as CoreResultType } from "../effect-ts.js";

describe("Serialization", () => {
  describe("pure codec", () => {
    it("round-trips a value through its schema", () => {
      const schema = Schema.Struct({ id: Schema.Number, name: Schema.String });
      const wire = Serialization.encodeSync(schema, { id: 1, name: "Ada" });
      expect(Serialization.decodeSync(schema, wire)).toEqual({ id: 1, name: "Ada" });
    });

    it("HTML-escapes script-breaking characters but still round-trips", () => {
      const schema = Schema.Struct({ html: Schema.String });
      const wire = Serialization.encodeSync(schema, { html: "</script><script>alert(1)</script>" });
      expect(wire).not.toContain("<");
      expect(wire).not.toContain(">");
      expect(wire).not.toContain("&");
      expect(wire).toContain("\\u003c");
      expect(Serialization.decodeSync(schema, wire)).toEqual({
        html: "</script><script>alert(1)</script>",
      });
    });

    it("escapes the JS line/paragraph separators", () => {
      const sep = `a b c`;
      const wire = Serialization.encodeSync(Schema.String, sep);
      expect(wire).toContain("\\u2028");
      expect(wire).toContain("\\u2029");
      expect(Serialization.decodeSync(Schema.String, wire)).toBe(sep);
    });

    it("rejects wire that does not match the schema", () => {
      const schema = Schema.Struct({ id: Schema.Number });
      expect(() => Serialization.decodeSync(schema, `{"id":"not-a-number"}`)).toThrow();
    });
  });

  describe("ResultWire schema", () => {
    it("validates and round-trips each result variant", () => {
      const cases: ReadonlyArray<CoreResultType<unknown, unknown>> = [
        Result.loading,
        Result.success({ x: 1 }),
        Result.failure("boom"),
        Result.defect("kaboom"),
        Result.refreshing(Result.success("prev")),
      ];
      for (const value of cases) {
        const wire = Serialization.encodeResult(value);
        expect(Serialization.decodeResult(wire)).toEqual(value);
      }
    });

    it("round-trips a keyed loader-data payload", () => {
      const payload = {
        "/users": Result.success([{ id: 1 }]),
        "/posts": Result.failure("nope"),
      };
      const wire = Serialization.encodeResultRecord(payload);
      expect(Serialization.decodeResultRecord(wire)).toEqual(payload);
    });
  });

  describe("service layer", () => {
    it("serialize/deserialize through the default layer round-trip", () => {
      const schema = Schema.Struct({ n: Schema.Number });
      const program = Effect.gen(function* () {
        const svc = yield* Serialization.Tag;
        const wire = yield* svc.serialize(schema, { n: 3 });
        return yield* svc.deserialize(schema, wire);
      });
      const out = Effect.runSync(program.pipe(Effect.provide(Serialization.layer)));
      expect(out).toEqual({ n: 3 });
    });

    it("surfaces a schema mismatch as a typed failure (not a defect)", () => {
      const schema = Schema.Struct({ n: Schema.Number });
      const program = Effect.gen(function* () {
        const svc = yield* Serialization.Tag;
        return yield* svc.deserialize(schema, `{"n":"x"}`);
      });
      // flip moves the typed E channel into success; a defect would escape and
      // make runSync throw, so reaching this value proves the mismatch is a
      // typed failure, and isSchemaError proves it is the schema error itself.
      const error = Effect.runSync(
        program.pipe(Effect.flip, Effect.provide(Serialization.layer)),
      );
      expect(Schema.isSchemaError(error)).toBe(true);
    });
  });
});
