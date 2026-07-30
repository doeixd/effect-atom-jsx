/**
 * Defects this domain's inventory found, written as the behaviour the finished
 * design guarantees. Each of these is expected RED today.
 *
 * - Risk 3: `Route.loaderSuccess` reads `Success` and `Refreshing(Success)` but
 *   NOT `Stale.data`, so a failed loader refresh with last-good data renders as
 *   *no data*. Keep-stale is advertised; on the router path it does not happen.
 * - Decision 6 fence: single-flight loader results are `JSON.stringify`d raw,
 *   so they bypass the canonical projection entirely and arrive unvalidated.
 * - Risk 4: `Resume.ts` hand-rolls the `Stale → Refreshing(Success(data))`
 *   unwrap that `previousFromResult` already performs inside `effect-ts.ts`.
 *   Two copies of a subtle rule is how the seam keeps costing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc } from "../harness.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

describe("Risk 3 — the router drops Stale data", () => {
  it("[Risk 3] `Route.loaderData()` serves `Stale.data` instead of failing", async () => {
    const Atom = await fromSrc("Atom", "make", "get");
    const { Result } = await fromSrc("effect-ts", "Result");
    const { loaderData, RouteContextTag } = await fromSrc(
      "Route",
      "loaderData",
      "RouteContextTag",
    );

    // A loader that succeeded, then failed on refresh: the canonical Stale
    // shape. `atomEffect` produces exactly this on a failed refresh.
    const loaderResult = Atom.make(Result.stale({ _tag: "Boom" }, { name: "last-good" }));
    const ctx = {
      pattern: "/users/:id",
      routeId: "users",
      loaderResult,
    } as any;

    const value = Effect.runSync(
      loaderData().pipe(
        Effect.flatMap((atom: any) => Atom.get(atom)),
        Effect.provideService(RouteContextTag, ctx),
      ),
    );

    // Today this throws "loader data not available yet." — the keep-stale
    // promise is broken on the router path.
    expect(value).toEqual({ name: "last-good" });
  });

  it("[Risk 3] the same accessor covers every data-bearing variant, i.e. it IS `Result.getData`", async () => {
    const Atom = await fromSrc("Atom", "make", "get");
    const { Result } = await fromSrc("effect-ts", "Result");
    const { loaderData, RouteContextTag } = await fromSrc(
      "Route",
      "loaderData",
      "RouteContextTag",
    );

    // The accessor signals "no data" by throwing, so observe it as an Exit.
    const read = (result: unknown) => {
      try {
        return {
          ok: true as const,
          value: Effect.runSync(
            loaderData().pipe(
              Effect.flatMap((atom: any) => Atom.get(atom)),
              Effect.provideService(RouteContextTag, {
                pattern: "/x",
                loaderResult: Atom.make(result),
              } as any),
            ),
          ),
        };
      } catch {
        return { ok: false as const, value: undefined };
      }
    };

    // The three variants `Result.getData` reports data for must all resolve,
    // and the three it does not must all fail — one rule, not two.
    const dataBearing = [
      Result.success("a"),
      Result.refreshing(Result.success("a")),
      Result.stale("e", "a"),
    ];
    expect(dataBearing.map((r: any) => read(r))).toEqual([
      { ok: true, value: "a" },
      { ok: true, value: "a" },
      { ok: true, value: "a" },
    ]);
    for (const empty of [Result.loading, Result.failure("e"), Result.defect("d")]) {
      expect(read(empty).ok).toBe(false);
    }
  });
});

describe("Decision 6 fence — single-flight is not projected", () => {
  it("[Decision 6] single-flight loader results round-trip through the canonical projection", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    const { toWire } = await fromSrc("result-wire", "toWire");
    const { invokeSingleFlight } = await fromSrc("Route", "invokeSingleFlight");
    // NOTE: the expectations here are derived from the §2.3 mapping table in
    // docs/RESULT_UNIFICATION_PLAN.md, never copied from the immutable Slice 1
    // golden-wire fixtures in src/__tests__/serialization.test.ts.

    // What the server MUST put on the wire: the canonical projection, which
    // carries no `exit`/`rawCause` and is validated on the way in.
    const wire = toWire(Result.stale({ _tag: "Boom" }, { name: "last-good" }));
    expect(JSON.stringify(wire)).not.toContain("exit");
    expect(JSON.stringify(wire)).not.toContain("rawCause");

    const body = JSON.stringify({
      ok: true,
      payload: {
        mutation: { saved: true },
        url: "http://localhost/users/1",
        loaders: [{ routeId: "users", result: wire }],
      },
    });

    const settled = await Effect.runPromise(
      Effect.exit(
        invokeSingleFlight("/__single-flight", { args: [], url: "http://localhost/users/1" }, {
          hydrate: false,
          fetch: async () => ({ json: async () => JSON.parse(body) }),
        }),
      ),
    );

    expect(settled._tag).toBe("Success");
    const loader = (settled as any).value.loaders[0];
    // The client must rehydrate a *core* Result, with its canonical Exit
    // reconstructed by `fromWire` — not hand the caller back the raw DTO.
    expect(loader.result._tag).toBe("Stale");
    expect(loader.result.data).toEqual({ name: "last-good" });
    expect(Exit.isExit(loader.result.exit)).toBe(true);
  });

  it("[Decision 6] an unprojected/garbage loader result fails closed as a typed failure", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    const { toWire } = await fromSrc("result-wire", "toWire");
    const { invokeSingleFlight } = await fromSrc("Route", "invokeSingleFlight");

    const invoke = (loaders: unknown) =>
      Effect.runPromise(
        Effect.exit(
          invokeSingleFlight("/__single-flight", { args: [], url: "http://localhost/" }, {
            hydrate: false,
            fetch: async () => ({
              json: async () => ({
                ok: true,
                payload: { mutation: null, url: "http://localhost/", loaders },
              }),
            }),
          }),
        ),
      );

    // Today the payload is accepted unvalidated and a bogus "Result" reaches the
    // loader cache. A trust boundary must reject it.
    const settled: any = await invoke([
      { routeId: "users", result: { _tag: "Nonsense", oops: 1 } },
    ]);
    expect(settled._tag).toBe("Failure");
    // Fails *closed*, not *hard*: a typed decode failure, never a defect from
    // reading fields off a shape that was never validated.
    expect(Cause.hasDies(settled.cause)).toBe(false);
    const error = Cause.findErrorOption(settled.cause);
    expect(error._tag).toBe("Some");
    expect(typeof (error as any).value?._tag).toBe("string");

    // NEGATIVE CONTROL. Without this, an `invokeSingleFlight` that rejects every
    // response — or one that is simply unimplemented — satisfies the above
    // forever. A payload whose loader result went through the canonical
    // projection must be accepted.
    const ok: any = await invoke([
      { routeId: "users", result: toWire(Result.success({ name: "alice" })) },
    ]);
    expect(ok._tag).toBe("Success");
    expect(ok.value.loaders[0].result._tag).toBe("Success");
  });
});

describe("Risk 4 — one core helper owns the Stale unwrap", () => {
  it("[Risk 4] `Result.toRefreshing` is the single definition of the unwrap", async () => {
    const { Result } = await fromSrc("effect-ts", "Result");
    const toRefreshing = (Result as any).toRefreshing;

    // Stale's last-good data becomes the refreshed-from Success — the rule
    // `Resume.ts` currently re-derives by hand.
    expect(toRefreshing(Result.stale("e", "last"))).toMatchObject({
      _tag: "Refreshing",
      previous: { _tag: "Success", value: "last" },
    });
    // Settled variants wrap as themselves.
    expect(toRefreshing(Result.success(1)).previous).toMatchObject({ _tag: "Success", value: 1 });
    expect(toRefreshing(Result.failure("e")).previous).toMatchObject({ _tag: "Failure", error: "e" });
    expect(toRefreshing(Result.defect("d")).previous).toMatchObject({ _tag: "Defect" });
    // Idempotent on an already-refreshing value…
    const refreshing = Result.refreshing(Result.success(1));
    expect(toRefreshing(refreshing)).toEqual(refreshing);
    // …and Loading has nothing to refresh from, so it passes through.
    expect(toRefreshing(Result.loading)).toEqual(Result.loading);
  });

  it("[Risk 4] no module re-derives the Stale unwrap by hand", async () => {
    // `Stale → success(data) → refreshing(...)` must exist once. Consumers ask
    // the core helper; they do not pattern-match the tag themselves.
    const resume = readFileSync(join(srcDir, "Resume.ts"), "utf8");
    expect(resume).not.toContain(`_tag === "Stale"`);

    // NEGATIVE CONTROL. "Nobody special-cases Stale" is also true of a codebase
    // that deleted the rule entirely, which would silently break keep-stale
    // everywhere. So the rule must still exist — exactly once, in the core model.
    const { Result } = await fromSrc("effect-ts", "Result");
    expect((Result as any).toRefreshing).toBeTypeOf("function");
    expect(
      (Result as any).toRefreshing(Result.stale("e", "last")).previous,
    ).toMatchObject({ _tag: "Success", value: "last" });
  });
});
