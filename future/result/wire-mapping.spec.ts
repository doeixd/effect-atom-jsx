/**
 * The frozen §2.3 field mapping of `docs/RESULT_UNIFICATION_PLAN.md`, as
 * executable round-trip specs.
 *
 * These expectations are **derived from the table in the plan**, not copied from
 * the Slice 1 fixtures in `src/__tests__/serialization.test.ts`. That is
 * deliberate: two independent derivations of the same frozen bytes is the only
 * way a fixture edit can be caught by something other than the fixture itself.
 *
 * Two rows are *lossy encode-side projections* (5 and 10): `toWire` can emit
 * them, but `fromWire` cannot recover the `Refreshing` wrapper. Those are pinned
 * as lossy on purpose — a future refactor that "fixes" them is a wire change and
 * must be versioned, not slipped in.
 */

import { describe, expect, it, vi } from "vitest";
import { fromSrc, loadSrc, pick, unbuilt } from "../harness.js";

/** Fixed epoch ms, independently chosen, so `timestamp` bytes are stable. */
const T = 1_600_000_000_000;

const withClock = async <A>(f: () => Promise<A> | A): Promise<A> => {
  const spy = vi.spyOn(Date, "now").mockReturnValue(T);
  try {
    return await f();
  } finally {
    spy.mockRestore();
  }
};

describe("result-wire: the frozen §2.3 mapping", () => {
  it("[Slice 2/§2.3] encodes all 8 producible rows to the exact frozen bytes", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    const { toWire } = await fromSrc("result-wire", "toWire");

    const rows: ReadonlyArray<readonly [string, unknown, string]> = [
      // row 1
      ["Loading", Result.loading, `{"_tag":"Initial","waiting":true}`],
      // row 3
      [
        "Success",
        Result.success({ x: 1 }),
        `{"_tag":"Success","value":{"x":1},"waiting":false,"timestamp":${T}}`,
      ],
      // row 4
      [
        "Refreshing(Success)",
        Result.refreshing(Result.success("prev")),
        `{"_tag":"Success","value":"prev","waiting":true,"timestamp":${T}}`,
      ],
      // row 5 (lossy on decode)
      [
        "Refreshing(Failure)",
        Result.refreshing(Result.failure({ _tag: "Boom" })),
        `{"_tag":"Failure","error":{"_tag":"Boom"},"waiting":true,"previousSuccess":null}`,
      ],
      // row 7
      [
        "Failure",
        Result.failure({ _tag: "Boom" }),
        `{"_tag":"Failure","error":{"_tag":"Boom"},"waiting":false,"previousSuccess":null}`,
      ],
      // row 8
      [
        "Stale",
        Result.stale({ _tag: "Boom" }, { x: 2 }),
        `{"_tag":"Failure","error":{"_tag":"Boom"},"waiting":false,"previousSuccess":{"_tag":"Success","value":{"x":2},"waiting":false,"timestamp":${T}}}`,
      ],
      // row 9
      [
        "Defect",
        Result.defect("kaboom"),
        `{"_tag":"Failure","error":{"defect":"kaboom"},"waiting":false,"previousSuccess":null}`,
      ],
      // row 10 (lossy on decode)
      [
        "Refreshing(Defect)",
        Result.refreshing(Result.defect("kaboom")),
        `{"_tag":"Failure","error":{"defect":"kaboom"},"waiting":true,"previousSuccess":null}`,
      ],
    ];

    const actual = await withClock(() =>
      rows.map(([name, core]) => [name, JSON.stringify(toWire(core as never))] as const),
    );
    expect(actual).toEqual(rows.map(([name, , bytes]) => [name, bytes] as const));
  });

  it("[Slice 2/§2.3] decodes every row, including the two toWire cannot produce", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    const { fromWire } = await fromSrc("result-wire", "fromWire");

    const success = (value: unknown) => ({
      _tag: "Success" as const,
      value,
      waiting: false,
      timestamp: T,
    });
    const tagOf = (w: unknown) => {
      const r = fromWire(w as never);
      return r._tag === "Refreshing" ? `Refreshing(${r.previous._tag})` : r._tag;
    };

    expect({
      row1: tagOf({ _tag: "Initial", waiting: true }),
      // row 2: the unreachable free slot reserved for `Idle` — decodes to Loading today.
      row2: tagOf({ _tag: "Initial", waiting: false }),
      row3: tagOf(success(1)),
      row4: tagOf({ ...success(1), waiting: true }),
      // row 5: CORRECTED 2026-07-30 — `waiting` is ignored when there is no
      // previousSuccess, so this settles to `Failure`, NOT `Refreshing(Failure)`.
      row5: tagOf({ _tag: "Failure", error: "e", waiting: true, previousSuccess: null }),
      // row 6: legacy acceptance — `toWire` never emits a waiting failure with data.
      row6: tagOf({ _tag: "Failure", error: "e", waiting: true, previousSuccess: success("last") }),
      row7: tagOf({ _tag: "Failure", error: "e", waiting: false, previousSuccess: null }),
      row8: tagOf({ _tag: "Failure", error: "e", waiting: false, previousSuccess: success("last") }),
      // row 9: defect wins over the stale reconstruction even with data present.
      row9: tagOf({
        _tag: "Failure",
        error: { defect: "kaboom" },
        waiting: false,
        previousSuccess: success("last"),
      }),
      row10: tagOf({ _tag: "Failure", error: { defect: "kaboom" }, waiting: true, previousSuccess: null }),
    }).toEqual({
      row1: "Loading",
      row2: "Idle" /* DQ-092 landed: the reserved row decodes to Idle */,
      row3: "Success",
      row4: "Refreshing(Success)",
      row5: "Failure",
      row6: "Refreshing(Success)",
      row7: "Failure",
      row8: "Stale",
      row9: "Defect",
      row10: "Defect",
    });

    // Row 8 recovers the data, not just the tag.
    const stale = fromWire({
      _tag: "Failure",
      error: "e",
      waiting: false,
      previousSuccess: success("last"),
    } as never);
    expect(Result.getData(stale)).toMatchObject({ value: "last" });
  });

  it("[Slice 2/§2.3 rows 5+10] pins rows 5 and 10 as LOSSY, so a silent fix is impossible", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    const { toWire, fromWire } = await fromSrc("result-wire", "toWire", "fromWire");

    // The Refreshing wrapper is unrecoverable: encode → decode is not identity.
    const row5 = Result.refreshing(Result.failure("e"));
    const row5Back = fromWire(toWire(row5));
    expect(row5Back._tag).toBe("Failure");
    expect(row5Back._tag).not.toBe("Refreshing");

    const row10 = Result.refreshing(Result.defect("kaboom"));
    const row10Back = fromWire(toWire(row10));
    expect(row10Back._tag).toBe("Defect");
    expect(row10Back._tag).not.toBe("Refreshing");

    // …while every non-lossy row IS round-trip stable in tag terms.
    const stable = [
      Result.loading,
      Result.success(1),
      Result.refreshing(Result.success(1)),
      Result.failure("e"),
      Result.stale("e", 1),
      Result.defect("kaboom"),
    ];
    expect(stable.map((r: any) => fromWire(toWire(r))._tag)).toEqual([
      "Loading",
      "Success",
      "Refreshing",
      "Failure",
      "Stale",
      "Defect",
    ]);
  });

  it("[Decision 4] `timestamp` is write-only: clock-injected on encode, ignored on decode", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    const { toWire, fromWire } = await fromSrc("result-wire", "toWire", "fromWire");

    // Injectable clock, so the field never makes encoding nondeterministic.
    expect(toWire(Result.success(1), () => 42)).toMatchObject({ timestamp: 42 });

    // …and it is not promoted onto the core model: two decodes of the same value
    // with different timestamps are structurally equal.
    const a = fromWire({ _tag: "Success", value: 1, waiting: false, timestamp: 1 } as never);
    const b = fromWire({ _tag: "Success", value: 1, waiting: false, timestamp: 999 } as never);
    expect(a).toEqual(b);
    expect(a).not.toHaveProperty("timestamp");
  });

  it("[Slice 1] the HTML-escaped string codec is script-safe and byte-stable", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    const { encodeResult, decodeResult, encodeResultRecord } = await fromSrc(
      "Serialization",
      "encodeResult",
      "decodeResult",
      "encodeResultRecord",
    );

    const encoded = await withClock(() => encodeResult(Result.success("</script>")));
    expect(encoded).toBe(
      `{"_tag":"Success","value":"\\u003c/script\\u003e","waiting":false,"timestamp":${T}}`,
    );
    expect(encoded).not.toContain("</script>");
    expect(decodeResult(encoded)).toMatchObject({ _tag: "Success", value: "</script>" });

    const record = await withClock(() =>
      encodeResultRecord({ home: Result.loading, user: Result.stale("e", 7) }),
    );
    expect(record).toBe(
      `{"home":{"_tag":"Initial","waiting":true},` +
        `"user":{"_tag":"Failure","error":"e","waiting":false,` +
        `"previousSuccess":{"_tag":"Success","value":7,"waiting":false,"timestamp":${T}}}}`,
    );
  });

  it("[Slice 2] decode fails closed on a structurally invalid wire value, and accepts a valid one", async () => {
    const { decodeResult } = await fromSrc("Serialization", "decodeResult");
    // Unknown tag, missing fields, and non-JSON must all be rejected at the
    // trust boundary rather than producing a half-built core Result.
    expect(() => decodeResult(`{"_tag":"Nonsense"}`)).toThrow();
    expect(() => decodeResult(`{"_tag":"Success","value":1}`)).toThrow();
    expect(() => decodeResult(`not json`)).toThrow();

    // NEGATIVE CONTROL. Without this, `decodeResult = () => { throw ... }`
    // satisfies the three assertions above forever. Each valid row is derived
    // from the §2.3 table, not from the Slice 1 fixtures.
    expect(decodeResult(`{"_tag":"Initial","waiting":true}`)._tag).toBe("Loading");
    expect(
      decodeResult(`{"_tag":"Success","value":1,"waiting":false,"timestamp":${T}}`),
    ).toMatchObject({ _tag: "Success", value: 1 });
    expect(
      decodeResult(`{"_tag":"Failure","error":"e","waiting":false,"previousSuccess":null}`)._tag,
    ).toBe("Failure");
  });

  it("[P15/§2.5] `Initial{waiting:false}` is UNREACHABLE on encode but already CLAIMED on decode — the slot is not free", async () => {
    // CORRECTION (`RESULT_UNIFICATION_PLAN.md` §2.5, 2026-07-30). §2.5 claimed
    // `Idle` costs "zero wire version bumps" because `Initial{waiting:false}` is
    // an unreachable free slot. That is only half the picture, and this spec
    // exists so the other half cannot be forgotten:
    //
    //   - ENCODE side: genuinely unreachable — nothing in the current algebra
    //     produces those bytes. Asserted below, and worth protecting.
    //   - DECODE side: already CLAIMED — §2.3 row 2 maps `Initial{waiting:false}`
    //     to `Loading`, and Slice 1 pinned that row as frozen behaviour.
    //
    // So introducing `Idle` is NOT byte-free: it changes what an existing wire
    // value decodes to, which is a behaviour change to a pinned row rather than
    // filling a gap. `DQ-092` owns the choice — accept the decode change (and
    // establish whether any producer ever emitted those bytes), or give `Idle`
    // its own representation and drop the "byte-free" claim.
    const { Result } = await fromSrc("effect-ts", "Result");
    const wire = await loadSrc("result-wire");
    const { toWire, fromWire } = pick(wire, "result-wire", "toWire", "fromWire");

    // (a) The encode-side invariant that keeps the slot *producible* by `Idle`
    // later: no current variant may encode to it. If one starts to, the upgrade
    // path is gone entirely rather than merely costly.
    const everyVariant = [
      Result.loading,
      Result.success(1),
      Result.refreshing(Result.success(1)),
      Result.refreshing(Result.failure("e")),
      Result.refreshing(Result.defect("d")),
      Result.failure("e"),
      Result.stale("e", 1),
      Result.defect("d"),
    ];
    for (const r of everyVariant) {
      expect(toWire(r as never)).not.toEqual({ _tag: "Initial", waiting: false });
    }

    // (b) The decode-side claim, asserted directly, so "the slot is free" cannot
    // be re-asserted without this spec going red. Today those bytes ARE
    // `Loading`, indistinguishably from `Initial{waiting:true}`.
    // DQ-092 landed (2026-08-12): this pin is DELIBERATELY edited — the
    // reserved bytes now decode to `Idle`, exactly the cost part (c) makes
    // explicit. `waiting: true` is untouched.
    expect(fromWire({ _tag: "Initial", waiting: false } as never)._tag).toBe("Idle");
    expect(fromWire({ _tag: "Initial", waiting: true } as never)._tag).toBe("Loading");

    // (c) What `Idle` would have to mean, and — the load-bearing part — what
    // introducing it *costs*: the row-2 decode above must change from `Loading`
    // to `Idle`. Both are asserted together so nobody can land `Idle` while
    // leaving the pinned row untouched, or "fix" the pinned row without `Idle`.
    const { idle, isIdle, settled } = Result as any;
    if (idle === undefined || isIdle === undefined) {
      unbuilt(
        "Result.idle / Result.isIdle — and note the `Initial{waiting:false}` slot is NOT free: §2.3 row 2 already decodes it to `Loading` and Slice 1 pinned that row, so introducing `Idle` changes a frozen decode rather than filling a gap",
        "DQ-092",
      );
    }
    // `Idle` is neither in-flight nor settled — that is the whole distinction
    // from `Loading`, and the reason it needs a variant rather than a flag.
    expect(idle._tag).toBe("Idle");
    expect(settled(idle)._tag).toBe("None");
    expect(isIdle(idle)).toBe(true);
    expect(isIdle(Result.loading)).toBe(false);
    // Encode: `Idle` claims the previously-unreachable bytes, and `Loading`
    // keeps `waiting: true` so the two stay distinguishable on the wire.
    expect(toWire(idle)).toEqual({ _tag: "Initial", waiting: false });
    expect(toWire(Result.loading)).toEqual({ _tag: "Initial", waiting: true });
    // Decode: THE FROZEN ROW HAS CHANGED. Row 2 no longer yields `Loading`.
    // This assertion is the cost, made explicit; it contradicts the row-2
    // expectation pinned in the decode spec above, and that contradiction is
    // the point — landing `Idle` means editing that pin deliberately.
    expect(isIdle(fromWire({ _tag: "Initial", waiting: false } as never))).toBe(true);
    expect(fromWire({ _tag: "Initial", waiting: false } as never)._tag).not.toBe("Loading");
    // …while row 1 is untouched, so the change is scoped to exactly one row.
    expect(fromWire({ _tag: "Initial", waiting: true } as never)._tag).toBe("Loading");
  });
});
