/**
 * Defects the Result-unification inventory found, written as the behaviour
 * the finished design guarantees. Promoted from `future/result/bugs.spec.ts`
 * (all green 2026-08-12 — the last red, Risk 4, was fixed by introducing the
 * canonical `Result.toRefreshing`), retyped.
 *
 * - Risk 3: `Route.loaderData()` must serve `Stale.data` — keep-stale on the
 *   router path.
 * - Decision 6 fence: single-flight loader results go through the canonical
 *   wire projection and are validated on the way in; garbage fails closed.
 * - Risk 4: exactly one definition of the `Stale → Refreshing(Success)`
 *   unwrap — `Result.toRefreshing` — and no module re-derives it by hand.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import * as Atom from "../Atom.js";
import * as Route from "../Route.js";
import { Result, type Result as ResultType } from "../effect-ts.js";
import { toWire } from "../result-wire.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A minimal live RouteContext carrying one loader result. */
function routeContext(
  loaderResult: Atom.ReadonlyAtom<ResultType<unknown, unknown>>,
): Route.RouteContext {
  return {
    prefix: Atom.make(""),
    params: Atom.make({}),
    query: Atom.make({}),
    hash: Atom.make<undefined>(undefined),
    matched: Atom.make(true),
    pattern: "/users/:id",
    routeId: "users",
    loaderResult,
  };
}

describe("Risk 3 — the router keeps Stale data", () => {
  it("`Route.loaderData()` serves `Stale.data` instead of failing", () => {
    // A loader that succeeded, then failed on refresh: the canonical Stale
    // shape. `atomEffect` produces exactly this on a failed refresh.
    // The reader overload of `Atom.make` — `loaderResult` is a ReadonlyAtom
    // on RouteContext, and the value overload's DeepWiden mangles Cause
    // internals structurally (a known inference edge; see
    // src/type-tests/inference-no-cast.ts).
    const stale: ResultType<unknown, unknown> = Result.stale(
      { _tag: "Boom" },
      { name: "last-good" },
    );
    const loaderResult = Atom.make(() => stale);

    const value = Effect.runSync(
      Route.loaderData().pipe(
        Effect.flatMap((atom) => Atom.get(atom)),
        Effect.provideService(Route.RouteContextTag, routeContext(loaderResult)),
      ),
    );

    expect(value).toEqual({ name: "last-good" });
  });

  it("the same accessor covers every data-bearing variant, i.e. it IS `Result.getData`", () => {
    // The accessor signals "no data" by throwing, so observe it as a
    // try/catch.
    const read = (result: ResultType<unknown, unknown>) => {
      try {
        return {
          ok: true as const,
          value: Effect.runSync(
            Route.loaderData().pipe(
              Effect.flatMap((atom) => Atom.get(atom)),
              Effect.provideService(
                Route.RouteContextTag,
                routeContext(Atom.make(() => result)),
              ),
            ),
          ),
        };
      } catch {
        return { ok: false as const, value: undefined };
      }
    };

    // The three variants `Result.getData` reports data for must all resolve,
    // and the three it does not must all fail — one rule, not two.
    const dataBearing: Array<ResultType<unknown, unknown>> = [
      Result.success("a"),
      Result.refreshing(Result.success("a")),
      Result.stale("e", "a"),
    ];
    expect(dataBearing.map(read)).toEqual([
      { ok: true, value: "a" },
      { ok: true, value: "a" },
      { ok: true, value: "a" },
    ]);
    for (const empty of [Result.loading, Result.failure("e"), Result.defect("d")]) {
      expect(read(empty).ok).toBe(false);
    }
  });
});

describe("Decision 6 fence — single-flight goes through the projection", () => {
  it("single-flight loader results round-trip through the canonical projection", async () => {
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
        Route.invokeSingleFlight(
          "/__single-flight",
          { args: [], url: "http://localhost/users/1" },
          {
            hydrate: false,
            fetch: async () => ({ json: async () => JSON.parse(body) as unknown }),
          },
        ),
      ),
    );

    expect(Exit.isSuccess(settled)).toBe(true);
    if (!Exit.isSuccess(settled)) return;
    const loader = settled.value.loaders[0]!;
    // The client rehydrates a CORE Result, its canonical Exit reconstructed
    // by `fromWire` — not the raw DTO.
    expect(loader.result._tag).toBe("Stale");
    if (loader.result._tag === "Stale") {
      expect(loader.result.data).toEqual({ name: "last-good" });
      expect(Exit.isExit(loader.result.exit)).toBe(true);
    }
  });

  it("an unprojected/garbage loader result fails closed as a typed failure", async () => {
    const invoke = (loaders: unknown) =>
      Effect.runPromise(
        Effect.exit(
          Route.invokeSingleFlight(
            "/__single-flight",
            { args: [], url: "http://localhost/" },
            {
              hydrate: false,
              fetch: async () => ({
                json: async () =>
                  ({
                    ok: true,
                    payload: { mutation: null, url: "http://localhost/", loaders },
                  }) as unknown,
              }),
            },
          ),
        ),
      );

    // A bogus "Result" must never reach the loader cache.
    const settled = await invoke([
      { routeId: "users", result: { _tag: "Nonsense", oops: 1 } },
    ]);
    expect(Exit.isFailure(settled)).toBe(true);
    if (Exit.isFailure(settled)) {
      // Fails CLOSED, not HARD: a typed decode failure, never a defect from
      // reading fields off a shape that was never validated.
      expect(Cause.hasDies(settled.cause)).toBe(false);
      const error = Cause.findErrorOption(settled.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        expect(typeof (error.value as { readonly _tag: string })._tag).toBe(
          "string",
        );
      }
    }

    // NEGATIVE CONTROL: a payload whose loader result went through the
    // canonical projection is accepted.
    const ok = await invoke([
      { routeId: "users", result: toWire(Result.success({ name: "alice" })) },
    ]);
    expect(Exit.isSuccess(ok)).toBe(true);
    if (Exit.isSuccess(ok)) {
      expect(ok.value.loaders[0]!.result._tag).toBe("Success");
    }
  });
});

describe("Risk 4 — one core helper owns the Stale unwrap", () => {
  it("`Result.toRefreshing` is the single definition of the unwrap", () => {
    // Stale's last-good data becomes the refreshed-from Success.
    expect(Result.toRefreshing(Result.stale("e", "last"))).toMatchObject({
      _tag: "Refreshing",
      previous: { _tag: "Success", value: "last" },
    });
    // Settled variants wrap as themselves.
    expect(Result.toRefreshing(Result.success(1))).toMatchObject({
      _tag: "Refreshing",
      previous: { _tag: "Success", value: 1 },
    });
    expect(Result.toRefreshing(Result.failure("e"))).toMatchObject({
      _tag: "Refreshing",
      previous: { _tag: "Failure", error: "e" },
    });
    expect(Result.toRefreshing(Result.defect("d"))).toMatchObject({
      _tag: "Refreshing",
      previous: { _tag: "Defect" },
    });
    // Idempotent on an already-refreshing value…
    const refreshing = Result.refreshing(Result.success(1));
    expect(Result.toRefreshing(refreshing)).toEqual(refreshing);
    // …and Loading has nothing to refresh from, so it passes through.
    expect(Result.toRefreshing(Result.loading)).toEqual(Result.loading);
  });

  it("no module re-derives the Stale unwrap by hand", () => {
    // `Stale → success(data) → refreshing(...)` must exist once. Consumers
    // ask the core helper; they do not pattern-match the tag themselves.
    const resume = readFileSync(join(srcDir, "Resume.ts"), "utf8");
    expect(resume).not.toContain(`_tag === "Stale"`);

    // NEGATIVE CONTROL: "nobody special-cases Stale" is also true of a
    // codebase that deleted the rule entirely — so the rule must still
    // exist, exactly once, in the core model.
    expect(Result.toRefreshing).toBeTypeOf("function");
    expect(
      Result.toRefreshing(Result.stale("e", "last")),
    ).toMatchObject({ previous: { _tag: "Success", value: "last" } });
  });
});
