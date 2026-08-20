/**
 * Unified pipe inference — the R3/ADR-006 collapse, specified as the finished
 * design.
 *
 * The documented gap (`src/Route.ts`, "KNOWN INFERENCE GAP"): route enhancers
 * were overload-INTERSECTION types, and TypeScript's contextual inference uses
 * only the LAST call signature of an intersection. Which signature that was
 * depended on the enhancer — so `.pipe(Route.loader(fn))` (single-op) typed a
 * page as a non-callable route node while `.pipe(Route.loader(fn),
 * Route.title(...))` (two-op) kept it callable. Chain SHAPE changed the type.
 *
 * The finished design: every enhancer is ONE generic call signature whose
 * result is target-conditional (node → node, unified sugar → enriched sugar,
 * component → tagged component). Inference is then arity- and
 * order-independent by construction. These specs pin the runtime contract for
 * every chain shape; the type half is pinned in
 * `src/type-tests/route-pipe-collapse.ts` (compile-time, blocking).
 *
 * These specs are cast-free on purpose: needing a cast here is the bug.
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Component from "../Component.js";
import * as Route from "../Route.js";

const sugarPage = (path: string) => Component.from<{}>(() => null).pipe(Component.route(path));

describe("unified pipe inference (R3/ADR-006 collapse)", () => {
  it("[R3] a SINGLE-op loader pipe keeps the sugar callable and stores the loader", () => {
    const page = sugarPage("/solo/:id");

    // The historical failure mode: exactly one enhancer in the pipe.
    const enhanced = page.pipe(
      Route.loader((params: { readonly id: string }) => Effect.succeed({ id: params.id })),
    );

    expect(typeof enhanced).toBe("function");
    expect(enhanced.path).toBe("/solo/:id");
    const internals = enhanced[Route.UnifiedRouteSymbol];
    expect(internals).toBeDefined();
    expect(typeof internals.loaderFn).toBe("function");
  });

  it("[R3] chain SHAPE is irrelevant: one op, two ops, and split pipes all agree", () => {
    const theLoader = Route.loader(() => Effect.succeed(1));
    const theTitle = Route.title("Same");

    const oneThenOne = (sugarPage("/a")).pipe(theLoader).pipe(theTitle);
    const twoAtOnce = (sugarPage("/a")).pipe(theLoader, theTitle);
    const titleFirst = (sugarPage("/a")).pipe(theTitle).pipe(theLoader);

    for (const value of [oneThenOne, twoAtOnce, titleFirst]) {
      expect(typeof value).toBe("function");
      const internals = value[Route.UnifiedRouteSymbol];
      expect(typeof internals.loaderFn).toBe("function");
      expect(internals.title).toBe("Same");
    }
  });

  it("[R3] title/meta/guard/schema enhancers are identity-shaped on every facet", () => {
    const page = sugarPage("/users/:userId");

    const enhanced = page
      .pipe(Route.paramsSchema(Schema.Struct({ userId: Schema.String })))
      .pipe(Route.guard(Effect.void))
      .pipe(Route.title("User"))
      .pipe(Route.meta({ description: "user page" }));

    expect(typeof enhanced).toBe("function");
    expect(enhanced.path).toBe("/users/:userId");
    const internals = enhanced[Route.UnifiedRouteSymbol];
    expect(internals.title).toBe("User");
    expect(internals.guards.length).toBe(1);
    expect(internals.meta).toBeDefined();
  });

  it("[R3] seedLoader accepts the pipe-built sugar without a cast", () => {
    const page = (sugarPage("/users/:userId")).pipe(
      Route.loader((params: { readonly userId: string }) => Effect.succeed({ id: params.userId })),
    );

    // The examples used `Route.seedLoader(UserPage as any)`; the finished
    // design types the loaderified sugar as a LoaderTaggedComponent, so the
    // cast is gone. Runtime half: the setter builds entries against the
    // route's id.
    const setLoaders = Route.seedLoader(page);
    expect(typeof setLoaders).toBe("function");
    const entries = setLoaders(
      { id: "u1" },
      [],
      new URL("http://example.local/users/u1"),
    );
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("[R3] node pipes keep their precise op typing (negative control for the collapse)", () => {

    // The explicit route-node path must be untouched by the collapse: ops
    // still compose via the RouteNodePipeOp brand, and materialization still
    // yields a callable component.
    const node = Route.page("/teams/:teamId", Component.from<{}>(() => null)).pipe(
      Route.paramsSchema(Schema.Struct({ teamId: Schema.String })),
      Route.loader((params: { readonly teamId: string }) => Effect.succeed({ id: params.teamId })),
      Route.title("Team"),
    );
    expect(node.kind).toBe("page");
    expect(node.path).toBe("/teams/:teamId");
    const materialized = Route.componentOf(node);
    expect(typeof materialized).toBe("function");
  });
});
