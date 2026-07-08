import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import * as Serialization from "../Serialization.js";
import * as Result from "../Result.js";

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
      const cases: ReadonlyArray<Result.Result<unknown, unknown>> = [
        Result.initial(true),
        Result.success({ x: 1 }, { timestamp: 42 }),
        Result.failure("boom"),
        Result.failure({ defect: "kaboom" }, {
          previousSuccess: Result.success("prev", { timestamp: 7 }),
        }),
      ];
      for (const value of cases) {
        const wire = Serialization.encodeSync(Serialization.ResultWire, value);
        expect(Serialization.decodeSync(Serialization.ResultWire, wire)).toEqual(value);
      }
    });

    it("round-trips a keyed loader-data payload", () => {
      const payload = {
        "/users": Result.success([{ id: 1 }], { timestamp: 1 }),
        "/posts": Result.failure("nope"),
      };
      const wire = Serialization.encodeSync(Serialization.ResultWireRecord, payload);
      expect(Serialization.decodeSync(Serialization.ResultWireRecord, wire)).toEqual(payload);
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
      const exit = Effect.runSyncExit(program.pipe(Effect.provide(Serialization.layer)));
      expect(exit._tag).toBe("Failure");
    });
  });
});
