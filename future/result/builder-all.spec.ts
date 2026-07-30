/**
 * `Result.builder` fallbacks and `Result.all` priority order — the two
 * ergonomics ported to the core model by Slice 3 so that deleting `FetchResult`
 * (Slice 5) removes no capability.
 *
 * Both have *documented* degradation rules, which is exactly the kind of thing
 * that rots silently: a refactor that makes `Refreshing` fall through to
 * `undefined`, or that promotes `Loading` above `Stale`, changes rendered output
 * in every app while every shallow "handler was called" test stays green. So
 * these specs assert the full decision table, not samples.
 */

import { describe, expect, it } from "vitest";
import { fromSrc } from "../harness.js";

describe("Result.builder — total-by-fallback matching", () => {
  it("[Slice 3] Refreshing falls back to the wrapped variant's handler", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");

    // A builder with no `onRefreshing` must still render, using the handler of
    // the variant being refreshed. This is what keeps "show last-good data while
    // revalidating" working without every call site handling Refreshing.
    const render = (r: any) =>
      Result.builder(r)
        .onLoading(() => "loading")
        .onSuccess((v: unknown) => `ok:${String(v)}`)
        .onFailure((e: unknown) => `err:${JSON.stringify(e)}`)
        .render();

    expect(render(Result.refreshing(Result.success(1)))).toBe("ok:1");
    expect(render(Result.refreshing(Result.failure("boom")))).toBe(`err:"boom"`);
    // Refreshing(Defect) → onDefect absent → onFailure with the defect envelope.
    expect(render(Result.refreshing(Result.defect("kaboom")))).toBe(
      `err:${JSON.stringify({ _tag: "ResultDefectError", defect: "kaboom" })}`,
    );
    // …and an explicit onRefreshing wins over the fallback.
    expect(
      Result.builder(Result.refreshing(Result.success(1)))
        .onSuccess(() => "ok")
        .onRefreshing((p: any) => `refreshing:${p._tag}`)
        .render(),
    ).toBe("refreshing:Success");
  });

  it("[Slice 3] Stale and Defect fall back to onFailure, Stale with its typed error", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");

    const short = (r: any) => Result.builder(r).onFailure((e: unknown) => e).render();
    // Stale degrades with the *typed* error, mirroring how <Async> degrades
    // `stale` → `error`; the last-good data is dropped by the fallback, which is
    // why onStale exists.
    expect(short(Result.stale({ _tag: "Boom" }, "last"))).toEqual({ _tag: "Boom" });
    // Defect degrades to a tagged envelope so onFailure never sees a bare string.
    expect(short(Result.defect("kaboom"))).toEqual({
      _tag: "ResultDefectError",
      defect: "kaboom",
    });

    // Own handlers take precedence and receive the full information.
    expect(
      Result.builder(Result.stale("e", "last"))
        .onFailure(() => "fallback")
        .onStale((e: unknown, d: unknown) => `stale:${String(e)}:${String(d)}`)
        .render(),
    ).toBe("stale:e:last");
    const defectRender = Result.builder(Result.defect("kaboom"))
      .onFailure(() => "fallback")
      .onDefect((cause: string, raw: unknown) => ({ cause, hasRawCause: raw !== undefined }))
      .render();
    expect(defectRender).toEqual({ cause: "kaboom", hasRawCause: true });
  });

  it("[Slice 3] an unhandled variant renders `undefined` rather than throwing", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    // Partiality is the point: adding a state later must not break existing
    // builders. Nothing here may throw.
    const onlySuccess = (r: any) => Result.builder(r).onSuccess(() => "ok").render();
    expect([
      onlySuccess(Result.loading),
      onlySuccess(Result.failure("e")),
      onlySuccess(Result.stale("e", 1)),
      onlySuccess(Result.defect("d")),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("Result.all — combination priority", () => {
  it("[Slice 3] short-circuits Defect > Failure > Stale > Loading > Refreshing > Success", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    const tag = (rs: ReadonlyArray<unknown>) => Result.all(rs as never)._tag;

    const S = Result.success(1);
    const L = Result.loading;
    const R = Result.refreshing(Result.success(2));
    const St = Result.stale("e", 3);
    const F = Result.failure("f");
    const D = Result.defect("d");

    // Each row: the winner must be the leftmost in the priority order,
    // regardless of positional order in the tuple.
    expect(tag([S, R, L, St, F, D])).toBe("Defect");
    expect(tag([D, S])).toBe("Defect");
    expect(tag([S, R, L, St, F])).toBe("Failure");
    expect(tag([F, D])).toBe("Defect"); // Defect still beats an earlier Failure
    // Stale outranks Loading/Refreshing/Success. With `L` in the tuple no data
    // is available, so the *degrade* rule turns the win into a Failure — but it
    // must still be Stale's error, never Loading.
    expect(Result.all([S, R, L, St] as never)).toMatchObject({ _tag: "Failure", error: "e" });
    expect(tag([S, R, St])).toBe("Stale");
    expect(tag([S, R, L])).toBe("Loading");
    expect(tag([S, R])).toBe("Refreshing");
    expect(tag([S, S])).toBe("Success");
    expect(Result.all([]as never)).toMatchObject({ _tag: "Success", value: [] });
  });

  it("[Slice 3] Success collects a positional tuple of values", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    expect(Result.all([Result.success("a"), Result.success(2)] as never)).toMatchObject({
      _tag: "Success",
      value: ["a", 2],
    });
  });

  it("[Slice 3] Stale/Refreshing keep data only when EVERY input still has data", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");

    // Every input has data → keep-stale composes and the tuple survives.
    const staleComplete = Result.all([
      Result.success("a"),
      Result.stale("e", "b"),
      Result.refreshing(Result.success("c")),
    ] as never);
    expect(staleComplete).toMatchObject({ _tag: "Stale", error: "e", data: ["a", "b", "c"] });

    // One input has no data (Refreshing(Failure) carries none) → Stale degrades
    // to Failure rather than fabricating a partial tuple.
    const staleIncomplete = Result.all([
      Result.stale("e", "b"),
      Result.refreshing(Result.failure("x")),
    ] as never);
    expect(staleIncomplete).toMatchObject({ _tag: "Failure", error: "e" });
    expect(staleIncomplete).not.toHaveProperty("data");

    // Same rule for Refreshing: complete → Refreshing(Success(tuple)).
    const refreshComplete = Result.all([
      Result.success("a"),
      Result.refreshing(Result.success("b")),
    ] as never);
    expect(refreshComplete._tag).toBe("Refreshing");
    expect(refreshComplete.previous).toMatchObject({ _tag: "Success", value: ["a", "b"] });

    // Incomplete → Loading, never a partial tuple.
    const refreshIncomplete = Result.all([
      Result.refreshing(Result.failure("x")),
      Result.success("a"),
    ] as never);
    expect(refreshIncomplete._tag).toBe("Loading");
  });

  it("[Slice 3] every combined variant still carries a canonical Exit", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    // The whole argument for keeping the core model is Exit fidelity; a
    // combinator that drops it reintroduces the fetch model's weakness.
    for (const combined of [
      Result.all([Result.success(1), Result.success(2)] as never),
      Result.all([Result.stale("e", 1), Result.success(2)] as never),
      Result.all([Result.failure("f"), Result.success(2)] as never),
      Result.all([Result.defect("d"), Result.success(2)] as never),
    ]) {
      expect(Result.toExit(combined)._tag).toBe("Some");
    }
    // Loading has no Exit, by definition.
    expect(Result.toExit(Result.all([Result.loading] as never))._tag).toBe("None");
  });
});
