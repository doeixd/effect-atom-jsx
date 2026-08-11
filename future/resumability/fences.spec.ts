/**
 * Lifting the M8 structural fences: keyed lists and branch replacement.
 *
 * Owning plans: `docs/RESUMABILITY_IMPLEMENTATION_PLAN.md` Milestone 8 work
 * item 6 ("define structural fallback for lists, conditional branches,
 * portals, suspense/async boundaries, nested ownership, and removed component
 * regions") and `RESUMABILITY_M8C_PLAN.md` decision 8 / "Explicitly Out of
 * Scope" (lists and structural replacement stay fenced through 8c).
 *
 * Two things must be true while the fence is up, and both are testable today:
 *  1. an authored expression in a list or branch position **fails closed** with
 *     a named diagnostic and no manifest entry — it must never ship a payload
 *     whose region can be structurally invalidated;
 *  2. the renderer's keyed `reconcileArrays` is the prerequisite for lifting
 *     the fence, so the patch path must be able to reuse existing nodes by key
 *     rather than replacing the whole region.
 *
 * The fence-lifting specs themselves are `unbuilt`: the design owes the region
 * representation for a keyed list before there is an API to assert on.
 */

import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, unbuilt } from "../harness.js";

/**
 * The harness hands back `any`-shaped values on purpose, so `Effect.runSync`
 * cannot infer a success type from them. These thin wrappers keep the specs
 * readable without sprinkling casts through every assertion.
 */
const runSync = (effect: any): any => Effect.runSync(effect);
const runSyncExit = (effect: any): Exit.Exit<any, any> =>
  Effect.runSyncExit(effect) as Exit.Exit<any, any>;
const runPromise = (effect: any): Promise<any> => Effect.runPromise(effect);
const runFork = (effect: any): any => Effect.runFork(effect);
const decode = (schema: any) => (input: unknown): any =>
  Schema.decodeUnknownSync(schema)(input);


const BuildId = "future-resume-build";

describe("M8 structural fences", () => {
  it("[M8.6] refuses to ship a resumable expression whose output is a structural value", async () => {
    const Resume = await fromSrc("Resume", "collect");
    const dom = await fromSrc("dom", "renderToString", "template", "insert");
    const Serialization = await fromSrc("Serialization", "layer");
    const { expressionCode, bindExpression } = await fromSrc(
      "portable-extract",
      "expressionCode",
      "bindExpression",
    );

    // A list-shaped expression: the output is not a text/attribute value, so
    // there is no durable region the protocol can own. The `as unknown as
    // string` below is deliberate — it takes the dynamic/generated escape
    // hatch so the *runtime* fence is what gets exercised. The compile-time
    // half (that `ExpressionOutput` refuses an array) belongs in
    // `src/type-tests/`, not here.
    const ListExpression = expressionCode({
      id: "future.resume.fence.list",
      buildId: BuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Unknown]),
      render: () => ["a", "b", "c"] as unknown as string,
    });
    const collected = runSync(
      Resume.collect(
        () =>
          dom.renderToString(() => {
            const span = dom.template("<span>")();
            dom.insert(span, bindExpression(ListExpression, {}, ["items"]));
            return span;
          }),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );

    // Fail closed: a named collect diagnostic with a fallback disposition, and
    // *no* manifest entry and no durable marker in the HTML.
    expect(
      collected.diagnostics.map((diagnostic: any) => diagnostic.code),
    ).toContain("unsupported-expression-output");
    expect(collected.diagnostics[0]).toMatchObject({
      phase: "collect",
      severity: "warning",
      disposition: "fallback-required",
    });
    expect(Object.keys(collected.manifest.expressions ?? {})).toEqual([]);
    expect(collected.html).not.toContain("af:expr:");

    // NEGATIVE CONTROL. An otherwise identical expression whose output *is* a
    // supported scalar ships its entry and its durable region, with no
    // diagnostic. Without this, a collector that fenced every expression would
    // satisfy the assertions above forever.
    const TextExpression = expressionCode({
      id: "future.resume.fence.text",
      buildId: BuildId,
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Unknown]),
      render: () => "abc",
    });
    const ok = runSync(
      Resume.collect(
        () =>
          dom.renderToString(() => {
            const span = dom.template("<span>")();
            dom.insert(span, bindExpression(TextExpression, {}, ["items"]));
            return span;
          }),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
    expect(
      ok.diagnostics.map((diagnostic: any) => diagnostic.code),
    ).not.toContain("unsupported-expression-output");
    expect(Object.keys(ok.manifest.expressions ?? {})).toEqual(["x0"]);
    expect(ok.html).toContain("af:expr:");
  });

  it("[M8.6] keeps the keyed reconciliation prerequisite: an ordinary keyed update reuses nodes", async () => {
    // Ratified 2026-07-30 (`RESUMABILITY_IMPLEMENTATION_PLAN.md` §Ratified
    // DQ-005–DQ-012, DQ-010): face 1 was never a design question. `dom.ts`
    // already reconciles keyed children privately (`reconcileArrays`,
    // `src/dom.ts:183`); the decision is simply to expose a narrow
    // `dom.reconcileArrays(parent, current, next, marker)` mirroring that
    // signature, which closes this spec without touching the fence.
    //
    // Why this is the prerequisite: if a keyed update *replaced* nodes, a
    // resumed list region could never preserve the DOM identity its
    // subscribers hold, so no structural target could ever be fine-grained.
    const dom = await fromSrc(
      "dom",
      "reconcileArrays",
      "template",
      "renderToString",
    );

    // The node environment has no global `document`; `renderToString` installs
    // the server one, so the whole exercise runs inside a render pass and the
    // observations are asserted afterwards.
    const seen: Array<ReadonlyArray<unknown>> = [];
    let nodes: Record<string, unknown> = {};
    dom.renderToString(() => {
      const parent = dom.template("<ul>")();
      const row = (label: string) => {
        const item = dom.template("<li>")();
        item.textContent = label;
        return item;
      };
      const a = row("a");
      const b = row("b");
      const c = row("c");
      const d = row("d");
      nodes = { a, b, c, d };

      // First render: three rows appended before the end marker (`null`).
      dom.reconcileArrays(parent, [], [a, b, c], null);
      seen.push([...parent.childNodes]);
      // A keyed update that reorders and drops one row must REUSE the
      // surviving nodes. Identity, not text, is the assertion: comparing
      // rendered text would pass for a renderer that rebuilt every node.
      dom.reconcileArrays(parent, [a, b, c], [c, a], null);
      seen.push([...parent.childNodes]);
      // An insertion creates only the new node and keeps every existing one.
      dom.reconcileArrays(parent, [c, a], [c, d, a], null);
      seen.push([...parent.childNodes]);
      // …and an identical update is a no-op, not a rebuild.
      dom.reconcileArrays(parent, [c, d, a], [c, d, a], null);
      seen.push([...parent.childNodes]);
      return parent;
    });

    const { a, b, c, d } = nodes as Record<string, any>;
    expect(seen[0]).toEqual([a, b, c]);
    expect(seen[1]).toEqual([c, a]);
    // The dropped node is detached, not merely reordered — a retained `b` is a
    // leak, and leaks are what the region-ownership question (faces 2 and 3)
    // exists to settle.
    expect(seen[1]).not.toContain(b);
    // NEGATIVE CONTROLS. "Reuse nothing" fails the identity assertions above;
    // "reuse everything" fails the removal; and a reconciler that cleared the
    // parent whenever it was called fails the no-op step.
    expect(seen[2]).toEqual([c, d, a]);
    expect(seen[3]).toEqual([c, d, a]);
  });

  it("[M8.6] resumes a keyed list region by patching only the changed rows", async () => {
    // DESIGN DECIDED, NOT YET BUILT. DQ-030 (ratified 2026-08-11) settles what
    // DQ-010 deferred until 8c.7's gate reported GO:
    //
    //   - each row gets a per-instance child `Scope`, closed when the
    //     reconciler drops the row, driven off the *same* removal list so DOM
    //     removal and Scope closure cannot drift apart;
    //   - per-row identity is a marker comment pair per row, chosen by
    //     measurement (0.6840 against the 1.10 slope ceiling; 37.2 B raw,
    //     6.2 B gzipped, 35 B retained per row). An earlier `data-af-key`
    //     ratification was overturned by its own escape clause, which also
    //     deleted the single-element-root authoring constraint;
    //   - the manifest gains one `{ kind: "structural", mode }` member at v5.
    //
    // The earlier provisional lean -- a single region owner shared by all rows
    // -- is OVERRULED: it cannot dispose one removed row, which is this
    // milestone's primary case. Do not reinstate it from an older doc.
    //
    // When this is built, the assertion must count finalizer runs at the
    // moment of removal. Asserting final state would pass for an
    // implementation that deferred every row's cleanup to unmount, which is
    // precisely the leak.
    unbuilt(
      "the keyed-list expression target: region representation, per-row Scope lifecycle, and the structural manifest kind",
      "Milestone 8d (design ratified in DQ-030)",
    );
  });

  it("[M8.6] resumes a conditional branch by replacing the region's content under one owner", async () => {
    // Per DQ-030, branch replacement is the degenerate single-instance case of
    // the keyed-list mechanism, not a second one: the outgoing branch's child
    // `Scope` is closed exactly once. The spec name says "one owner" -- read
    // that as one `Scope`, not a reactive owner.
    unbuilt(
      "the branch-replacement expression target: closing the outgoing branch's child Scope exactly once",
      "Milestone 8d (design ratified in DQ-030)",
    );
  });
});
