import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Schema } from "effect";
import * as Serialization from "../Serialization.js";
import * as Route from "../Route.js";
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
        Result.stale("stale-boom", { x: 2 }),
        Result.defect("kaboom"),
        Result.refreshing(Result.success("prev")),
      ];
      for (const value of cases) {
        const wire = Serialization.encodeResult(value);
        expect(Serialization.decodeResult(wire)).toEqual(value);
      }
    });

    it("projects Stale to the flat failure wire shape with previousSuccess", () => {
      const wire = Serialization.resultToWire(Result.stale("boom", { id: 1 }));
      expect(wire).toMatchObject({
        _tag: "Failure",
        error: "boom",
        waiting: false,
        previousSuccess: {
          _tag: "Success",
          value: { id: 1 },
        },
      });
      const decoded = Serialization.resultFromWire(wire);
      expect(decoded._tag).toBe("Stale");
      if (decoded._tag === "Stale") {
        expect(decoded.error).toBe("boom");
        expect(decoded.data).toEqual({ id: 1 });
      }
    });

    it("decodes legacy waiting failure with previousSuccess as Refreshing(previous success), not Stale", () => {
      const decoded = Serialization.resultFromWire({
        _tag: "Failure",
        error: "still-loading",
        waiting: true,
        previousSuccess: {
          _tag: "Success",
          value: { id: 1 },
          waiting: false,
          timestamp: 123,
        },
      });

      expect(decoded._tag).toBe("Refreshing");
      if (decoded._tag === "Refreshing") {
        expect(decoded.previous._tag).toBe("Success");
        if (decoded.previous._tag === "Success") {
          expect(decoded.previous.value).toEqual({ id: 1 });
        }
      }
    });

    it("does not decode defect failures with previousSuccess as Stale", () => {
      const decoded = Serialization.resultFromWire({
        _tag: "Failure",
        error: { defect: "boom" },
        waiting: false,
        previousSuccess: {
          _tag: "Success",
          value: { id: 1 },
          waiting: false,
          timestamp: 123,
        },
      });

      expect(decoded._tag).toBe("Defect");
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

  // ─── Frozen wire pin (RESULT_UNIFICATION_PLAN.md slice 1) ─────────────────
  //
  // These fixtures pin the *bytes* of the loader-result wire format for every
  // row of the frozen field mapping in RESULT_UNIFICATION_PLAN.md §2.3. They
  // were written from unmodified source output and are immutable for the
  // duration of the Result unification (plan Decision 9): if a slice makes one
  // of them fail, the slice is wrong. Only an explicitly wire-versioned change
  // (`Idle`, the single-flight projection) may ever edit them.
  describe("frozen wire pin (§2.3 field mapping)", () => {
    /** Fixed epoch ms so `timestamp` (a serializer-side field) is byte-stable. */
    const T = 1_700_000_000_000;

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const withFixedClock = <A>(f: () => A): A => {
      const spy = vi.spyOn(Date, "now").mockReturnValue(T);
      try {
        return f();
      } finally {
        spy.mockRestore();
      }
    };

    /** The 8 rows of §2.3 that `toWire` can actually produce, as exact bytes. */
    const encodeRows: ReadonlyArray<{
      readonly row: string;
      readonly core: CoreResultType<unknown, unknown>;
      readonly wire: string;
      readonly decodedTag: CoreResultType<unknown, unknown>["_tag"];
    }> = [
      {
        row: "1. Loading -> Initial{waiting:true}",
        core: Result.loading,
        wire: `{"_tag":"Initial","waiting":true}`,
        decodedTag: "Loading",
      },
      {
        row: "3. Success -> Success{waiting:false}",
        core: Result.success({ x: 1 }),
        wire: `{"_tag":"Success","value":{"x":1},"waiting":false,"timestamp":${T}}`,
        decodedTag: "Success",
      },
      {
        row: "4. Refreshing(Success) -> Success{waiting:true}",
        core: Result.refreshing(Result.success("prev")),
        wire: `{"_tag":"Success","value":"prev","waiting":true,"timestamp":${T}}`,
        decodedTag: "Refreshing",
      },
      {
        row: "5. Refreshing(Failure) -> Failure{waiting:true,previousSuccess:null}",
        core: Result.refreshing(Result.failure("boom")),
        wire: `{"_tag":"Failure","error":"boom","waiting":true,"previousSuccess":null}`,
        // NOTE: the plan's §2.3 table predicts `Refreshing(Failure(error))`
        // here, but today's decoder ignores `waiting` when `previousSuccess`
        // is null and yields a settled `Failure` — i.e. `Refreshing(Failure)`
        // is a *lossy* projection, exactly like row 10. This pin records the
        // real bytes/behaviour; the table row is aspirational, and changing it
        // would be a behaviour change outside this migration.
        decodedTag: "Failure",
      },
      {
        row: "7. Failure -> Failure{waiting:false,previousSuccess:null}",
        core: Result.failure("boom"),
        wire: `{"_tag":"Failure","error":"boom","waiting":false,"previousSuccess":null}`,
        decodedTag: "Failure",
      },
      {
        row: "8. Stale -> Failure{waiting:false,previousSuccess:S}",
        core: Result.stale("boom", { x: 2 }),
        wire: `{"_tag":"Failure","error":"boom","waiting":false,"previousSuccess":{"_tag":"Success","value":{"x":2},"waiting":false,"timestamp":${T}}}`,
        decodedTag: "Stale",
      },
      {
        row: "9. Defect -> Failure{error:{defect},waiting:false}",
        core: Result.defect("kaboom"),
        wire: `{"_tag":"Failure","error":{"defect":"kaboom"},"waiting":false,"previousSuccess":null}`,
        decodedTag: "Defect",
      },
      {
        row: "10. Refreshing(Defect) -> Failure{error:{defect},waiting:true}",
        core: Result.refreshing(Result.defect("kaboom")),
        wire: `{"_tag":"Failure","error":{"defect":"kaboom"},"waiting":true,"previousSuccess":null}`,
        decodedTag: "Defect",
      },
    ];

    for (const { row, core, wire, decodedTag } of encodeRows) {
      it(`encodes row ${row} to exact bytes`, () => {
        expect(withFixedClock(() => Serialization.encodeResult(core))).toBe(wire);
      });

      it(`decodes row ${row} back to ${decodedTag}`, () => {
        expect(Serialization.decodeResult(wire)._tag).toBe(decodedTag);
      });
    }

    // Risk 2 of the plan: `timestamp` is fabricated from a clock, and every
    // decoder ignores it — so a dropped or renamed field would still pass a
    // `toEqual` round-trip. Pin its presence and type without the fake clock,
    // so the pin holds independently of how the clock is injected.
    it("emits a numeric timestamp on Success rows under the real clock", () => {
      const before = Date.now();
      const wire = Serialization.resultToWire(Result.success({ x: 1 }));
      const after = Date.now();
      expect(wire).toMatchObject({ _tag: "Success", value: { x: 1 }, waiting: false });
      expect(typeof (wire as { timestamp: unknown }).timestamp).toBe("number");
      expect((wire as { timestamp: number }).timestamp).toBeGreaterThanOrEqual(before);
      expect((wire as { timestamp: number }).timestamp).toBeLessThanOrEqual(after);
      expect(Serialization.encodeResult(Result.success({ x: 1 })))
        .toMatch(/^\{"_tag":"Success","value":\{"x":1\},"waiting":false,"timestamp":\d+\}$/);
    });

    it("emits a numeric timestamp on the previousSuccess of a Stale row", () => {
      const wire = Serialization.resultToWire(Result.stale("boom", { x: 2 }));
      expect(wire).toMatchObject({
        _tag: "Failure",
        error: "boom",
        waiting: false,
        previousSuccess: { _tag: "Success", value: { x: 2 }, waiting: false },
      });
      const previous = (wire as { previousSuccess: { timestamp: unknown } }).previousSuccess;
      expect(typeof previous.timestamp).toBe("number");
    });

    // The two rows `toWire` cannot produce. Decode must keep accepting them.
    describe("legacy decode acceptance (decode-only rows)", () => {
      const decodeOnlyRows: ReadonlyArray<{
        readonly row: string;
        readonly wire: Serialization.ResultWireValue;
        readonly assert: (decoded: CoreResultType<unknown, unknown>) => void;
      }> = [
        {
          // DQ-092 (ratified 2026-08-12): the reserved slot is claimed. This
          // row is the ONE sanctioned edit to the frozen Slice-1 table
          // (Decision 7's explicitly wire-versioned `Idle` change).
          row: "2. Initial{waiting:false} -> Idle (DQ-092)",
          wire: { _tag: "Initial", waiting: false },
          assert: (decoded) => {
            expect(decoded._tag).toBe("Idle");
          },
        },
        {
          row: "6. Failure{waiting:true,previousSuccess:S} -> Refreshing(Success(S.value))",
          wire: {
            _tag: "Failure",
            error: "still-loading",
            waiting: true,
            previousSuccess: { _tag: "Success", value: { id: 1 }, waiting: false, timestamp: 123 },
          },
          assert: (decoded) => {
            expect(decoded._tag).toBe("Refreshing");
            if (decoded._tag !== "Refreshing") return;
            expect(decoded.previous._tag).toBe("Success");
            if (decoded.previous._tag !== "Success") return;
            expect(decoded.previous.value).toEqual({ id: 1 });
          },
        },
        {
          row: "9b. Failure{error:{defect},previousSuccess:S} -> Defect (defect wins over stale)",
          wire: {
            _tag: "Failure",
            error: { defect: "boom" },
            waiting: false,
            previousSuccess: { _tag: "Success", value: { id: 1 }, waiting: false, timestamp: 123 },
          },
          assert: (decoded) => {
            expect(decoded._tag).toBe("Defect");
          },
        },
        {
          row: "10b. Failure{error:{defect},waiting:true,previousSuccess:S} -> Refreshing (lossy, frozen)",
          wire: {
            _tag: "Failure",
            error: { defect: "boom" },
            waiting: true,
            previousSuccess: { _tag: "Success", value: { id: 1 }, waiting: false, timestamp: 123 },
          },
          assert: (decoded) => {
            expect(decoded._tag).toBe("Refreshing");
          },
        },
      ];

      for (const { row, wire, assert } of decodeOnlyRows) {
        it(`accepts legacy row ${row}`, () => {
          assert(Serialization.resultFromWire(wire));
          // and through the string layer too
          assert(Serialization.decodeResult(Serialization.encodeSync(Serialization.ResultWire, wire)));
        });
      }
    });

    // The *script envelope* around the payload belongs to the router lane and
    // changes independently (it has already moved from `__LOADER_DATA__` to
    // `__afuiLoaderHandoff`). What this pin owns is the part the unification
    // must not disturb: the streamed script embeds exactly the bytes `toWire`
    // produces, for a success and for a stale result.
    it("embeds the exact projected result bytes in the streamed loader scripts", () => {
      const scripts = withFixedClock(() =>
        Route.streamDeferredLoaderScripts([
          { routeId: "/users", result: Result.success([{ id: 1 }]) },
          { routeId: "/posts", result: Result.stale("boom", [{ id: 2 }]) },
        ]),
      );

      expect(scripts).toHaveLength(2);
      expect(scripts[0]).toContain(
        `{"_tag":"Success","value":[{"id":1}],"waiting":false,"timestamp":${T}}`,
      );
      expect(scripts[1]).toContain(
        `{"_tag":"Failure","error":"boom","waiting":false,"previousSuccess":{"_tag":"Success","value":[{"id":2}],"waiting":false,"timestamp":${T}}}`,
      );
      // The payload must stay `<script>`-safe: no raw angle brackets or
      // ampersands may survive escaping inside the embedded JSON.
      for (const script of scripts) {
        expect(script.slice("<script>".length, -"</script>".length)).not.toContain("</");
      }
    });

    it("pins the serializeLoaderData record bytes", () => {
      const wire = withFixedClock(() =>
        Route.serializeLoaderData([
          { routeId: "/users", result: Result.success([{ id: 1 }]) },
          { routeId: "/posts", result: Result.failure("nope") },
        ]),
      );
      expect(wire).toBe(
        `{"/users":{"_tag":"Success","value":[{"id":1}],"waiting":false,"timestamp":${T}},`
        + `"/posts":{"_tag":"Failure","error":"nope","waiting":false,"previousSuccess":null}}`,
      );
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

    it("applies the same `<script>` escaping as the pure codec", () => {
      // The round-trip above passes with escaping removed entirely: encode and
      // decode are inverses either way. `</script>`-safety is a property of
      // the injected layer, so assert it *on the layer*, not only on
      // `encodeSync` — the two are separate code paths.
      const schema = Schema.Struct({ html: Schema.String });
      const value = { html: "</script><script>alert(1)</script>&amp;" };
      const program = Effect.gen(function* () {
        const svc = yield* Serialization.Tag;
        return yield* svc.serialize(schema, value);
      });
      const wire = Effect.runSync(program.pipe(Effect.provide(Serialization.layer)));

      expect(wire).not.toContain("<");
      expect(wire).not.toContain(">");
      expect(wire).not.toContain("&");
      expect(wire).toContain("\\u003c");
      expect(wire).toContain("\\u003e");
      expect(wire).toContain("\\u0026");
      // Byte-identical to the pure codec: one escaping implementation, not two.
      expect(wire).toBe(Serialization.encodeSync(schema, value));
      expect(Serialization.decodeSync(schema, wire)).toEqual(value);
    });

    it("escapes the JS line/paragraph separators through the layer too", () => {
      const value = `a b c`;
      const program = Effect.gen(function* () {
        const svc = yield* Serialization.Tag;
        return yield* svc.serialize(Schema.String, value);
      });
      const wire = Effect.runSync(program.pipe(Effect.provide(Serialization.layer)));
      expect(wire).toContain("\\u2028");
      expect(wire).toContain("\\u2029");
      expect(wire).not.toContain(" ");
      expect(wire).not.toContain(" ");
      expect(Serialization.decodeSync(Schema.String, wire)).toBe(value);
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

    it("surfaces malformed JSON as a typed SchemaError (not a defect)", () => {
      const schema = Schema.Struct({ n: Schema.Number });
      const program = Effect.gen(function* () {
        const svc = yield* Serialization.Tag;
        return yield* svc.deserialize(schema, `{"n":`);
      });
      const error = Effect.runSync(
        program.pipe(Effect.flip, Effect.provide(Serialization.layer)),
      );
      expect(Schema.isSchemaError(error)).toBe(true);
      expect(error.message).toContain("Malformed JSON wire payload");
    });

    it("does not treat a defect-free schema mismatch as malformed JSON", () => {
      const schema = Schema.Struct({ n: Schema.Number });
      const program = Effect.gen(function* () {
        const svc = yield* Serialization.Tag;
        return yield* svc.deserialize(schema, `{"n":"x"}`);
      });
      const error = Effect.runSync(
        program.pipe(Effect.flip, Effect.provide(Serialization.layer)),
      );
      expect(error.message).not.toContain("Malformed JSON wire payload");
    });
  });
});
