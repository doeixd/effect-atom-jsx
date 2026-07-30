/**
 * AN-1 build-drift guard.
 *
 * `docs/AGENT_NATIVE_NOTES.md` §2 makes a specific competitive claim: a
 * convention-based action framework "can silently change shape between
 * deploys; ours fail closed on build mismatch — same mechanism resumability
 * already uses". That claim is only true if a tool call carrying a stale
 * `buildId` is rejected *before* `run` executes, with the *same* typed error
 * resumability raises (`Portable.PortableBuildMismatchError`), and not merely
 * with a bespoke agent-layer 400.
 *
 * RATIFIED (`AGENT_NATIVE_NOTES.md` §10):
 * - `DQ-080` — the response is exactly two arms; drift is a typed tagged error
 *   *inside* the `ok:false` arm, never a third arm.
 * - `DQ-081` — a drifted call **never runs**, and the failure **carries the
 *   fresh manifest**, so the host's recovery is mechanical. The rejected
 *   alternative ("re-describe the tool list and proceed") converted a safety
 *   property into a convenience.
 * - `DQ-086` — guard order is **authorize → drift → approve**. Authorization is
 *   outermost so nothing (not even a schema or a tool description) is disclosed
 *   to an unauthorized caller; drift still precedes the human step.
 *
 * STILL PROVISIONAL, pending `DQ-096`: the module name `src/Agent.ts` and its
 * export names (`AGENT_NATIVE_NOTES.md` §9.10).
 */

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick, unbuilt } from "../harness.js";
import { run, tagOf } from "./support.js";

const CURRENT = "build-current";
const STALE = "build-stale";

const makeCatalog = async () => {
  const { catalog, expose } = await fromSrc("Agent", "catalog", "expose");
  const { code } = await fromSrc("Portable", "code");

  const calls: Array<string> = [];
  const Save = code({
    id: "todo.save",
    buildId: CURRENT,
    captures: Schema.Struct({}),
    run: (_c: any, text: string) =>
      Effect.sync(() => {
        calls.push(text);
        return { id: "t1", text };
      }),
  });

  return {
    calls,
    catalog: catalog({
      saveTodo: expose(Save, {
        description: "Save a todo",
        args: Schema.Tuple([Schema.String]),
        success: Schema.Struct({ id: Schema.String, text: Schema.String }),
        reactivityKeys: ["todos"],
        access: { agent: true, http: true },
      }),
    }),
  };
};

describe("AN-1 build drift", () => {
  it("[AN-1] a stale buildId fails closed with the resumability build-mismatch error and never runs the action", async () => {
    const { dispatch } = await fromSrc("Agent", "dispatch");
    const { PortableBuildMismatchError } = await fromSrc(
      "Portable",
      "PortableBuildMismatchError",
    );
    const stale = await makeCatalog();

    const response = await run(
      dispatch(stale.catalog)({ tool: "saveTodo", args: ["milk"], buildId: STALE }),
    );

    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(response.ok).toBe(false);
    // Not a bespoke agent error: literally the resumability mechanism.
    expect(response.error instanceof PortableBuildMismatchError).toBe(true);
    expect(tagOf(response.error)).toBe("PortableBuildMismatchError");
    expect(response.error.id).toBe("todo.save");
    expect(response.error.expected).toBe(CURRENT);
    expect(response.error.actual).toBe(STALE);

    // The guarantee that matters: the mutation did not happen.
    expect(stale.calls).toEqual([]);
    // ...and nothing was invalidated on a rejected call.
    expect(response.payload).toBeUndefined();

    // NEGATIVE CONTROL. Without this, a dispatch that rejects *every* call —
    // including correct ones — satisfies the assertions above forever. A fresh
    // catalog, so the two phases share no mutable call log.
    const fresh = await makeCatalog();
    const ok = await run(
      dispatch(fresh.catalog)({ tool: "saveTodo", args: ["milk"], buildId: CURRENT }),
    );
    expect(ok.ok).toBe(true);
    expect(fresh.calls).toEqual(["milk"]);
  });

  it("[AN-1] the matching buildId is the one advertised by the tool manifest", async () => {
    // Drift detection is only usable if the host knows which buildId to send,
    // and it learns that from the manifest it was given. Manifest and guard
    // must read the same field off the same portable code value.
    const { dispatch, toolManifest } = await fromSrc(
      "Agent",
      "dispatch",
      "toolManifest",
    );
    const { calls, catalog } = await makeCatalog();

    const manifest = await run(toolManifest(catalog));
    const advertised = manifest.tools[0].buildId;

    const response = await run(
      dispatch(catalog)({ tool: "saveTodo", args: ["milk"], buildId: advertised }),
    );

    expect(response.ok).toBe(true);
    expect(calls).toEqual(["milk"]);
  });

  it("[AN-1] a missing buildId is rejected with its own code, distinct from a mismatch", async () => {
    // A convention framework's failure mode is the silent shape change. If an
    // omitted buildId were treated as "trust me", the guard would be advisory.
    const { dispatch } = await fromSrc("Agent", "dispatch");
    const missing = await makeCatalog();

    const response = await run(
      dispatch(missing.catalog)({ tool: "saveTodo", args: ["milk"] }),
    );

    expect(response.ok).toBe(false);
    expect(missing.calls).toEqual([]);

    // "Absent" and "stale" are near neighbours: a single generic
    // `AgentBadRequest` would satisfy this spec and the mismatch spec at once,
    // and a host could then not tell "upgrade your manifest" from "you forgot a
    // field". So the codes must differ, and both must be typed.
    const stale = await makeCatalog();
    const mismatch = await run(
      dispatch(stale.catalog)({ tool: "saveTodo", args: ["milk"], buildId: STALE }),
    );
    expect(tagOf(mismatch.error)).toBe("PortableBuildMismatchError");
    expect(tagOf(response.error)).not.toBe(tagOf(mismatch.error));
    expect(tagOf(response.error)).toMatch(/^Agent|BuildId/);

    // NEGATIVE CONTROL: supplying the field is accepted.
    const fresh = await makeCatalog();
    const ok = await run(
      dispatch(fresh.catalog)({ tool: "saveTodo", args: ["milk"], buildId: CURRENT }),
    );
    expect(ok.ok).toBe(true);
    expect(fresh.calls).toEqual(["milk"]);
  });

  it("[AN-1/DQ-086] the drift guard runs after authorize and before approve, so no human is asked about a stale call", async () => {
    // Ratified order (§10, DQ-086): authorize → drift → approve. A stale call
    // from an *authorized* caller is refused before the human step, so nobody is
    // asked to approve something that is about to be rejected.
    const { dispatch, Approval, Authorizer } = await fromSrc(
      "Agent",
      "dispatch",
      "Approval",
      "Authorizer",
    );
    const { Layer } = await import("effect");

    // A fresh recorder per phase: a module-scope `consulted` array shared between
    // the drift phase and the control phase would make the ordering claim
    // unfalsifiable.
    const governanceFor = (consulted: Array<string>) =>
      Layer.mergeAll(
        Layer.succeed(Approval, {
          require: (summary: string) =>
            Effect.sync(() => {
              consulted.push(`approval:${summary}`);
            }),
        }),
        Layer.succeed(Authorizer, {
          authorize: (tool: string) =>
            Effect.sync(() => {
              consulted.push(`authorize:${tool}`);
            }),
        }),
      );

    const staleConsulted: Array<string> = [];
    const stale = await makeCatalog();
    const response = await run(
      dispatch(stale.catalog)({ tool: "saveTodo", args: ["milk"], buildId: STALE }).pipe(
        Effect.provide(governanceFor(staleConsulted)),
      ),
    );

    expect(response.ok).toBe(false);
    expect(tagOf(response.error)).toBe("PortableBuildMismatchError");
    // Authorization ran (it is outermost); the human step did not.
    expect(staleConsulted.map((entry) => entry.split(":")[0])).toEqual(["authorize"]);
    expect(staleConsulted.some((entry) => entry.startsWith("approval:"))).toBe(false);
    expect(stale.calls).toEqual([]);

    // NEGATIVE CONTROL. "Approval was not consulted" is also true of a dispatch
    // that never consults governance at all, which would silently void AN-1. So a
    // valid call must consult *both* services, in the ratified order.
    const okConsulted: Array<string> = [];
    const fresh = await makeCatalog();
    const ok = await run(
      dispatch(fresh.catalog)({ tool: "saveTodo", args: ["milk"], buildId: CURRENT }).pipe(
        Effect.provide(governanceFor(okConsulted)),
      ),
    );
    expect(ok.ok).toBe(true);
    // Order, not just membership: authorize strictly precedes approve.
    expect(okConsulted.map((entry) => entry.split(":")[0])).toEqual([
      "authorize",
      "approval",
    ]);
    expect(fresh.calls).toEqual(["milk"]);
  });

  it("[AN-1/DQ-081] a drifted call fails closed but carries the fresh manifest, and adds no third response arm", async () => {
    // Ratified (§10, DQ-081): fail closed — the drifted call never runs — but
    // usefully, so the host's recovery is mechanical rather than a support
    // ticket. The rejected alternative was "re-describe the tool list and
    // proceed"; the recovery data therefore rides *inside* the `ok:false` arm.
    const { dispatch, toolManifest } = await fromSrc(
      "Agent",
      "dispatch",
      "toolManifest",
    );
    const stale = await makeCatalog();

    const response = await run(
      dispatch(stale.catalog)({ tool: "saveTodo", args: ["milk"], buildId: STALE }),
    );

    // Fail closed.
    expect(response.ok).toBe(false);
    expect(stale.calls).toEqual([]);

    // No third arm: exactly the two ratified keys. A `retryWith`/`redescribe`
    // arm would be a type every host must branch on, and DQ-080 rejected it.
    expect(Object.keys(response).sort()).toEqual(["error", "ok"]);
    expect(response.payload).toBeUndefined();

    // …but usefully: the refusal carries the fresh manifest, and it is the same
    // manifest `toolManifest` would hand out, so recovery is "replace your tool
    // list with this and retry" rather than "go ask an operator".
    const fresh = await run(toolManifest(stale.catalog));
    expect(response.error.manifest).toEqual(fresh);
    expect(response.error.manifest.tools[0].buildId).toBe(CURRENT);
    // Recovery data must survive the wire, or it is not mechanical.
    expect(JSON.parse(JSON.stringify(response.error))).toEqual(response.error);

    // NEGATIVE CONTROL: a non-drift refusal does NOT carry a manifest, so
    // "attach the manifest to everything" cannot pass, and the two refusals stay
    // distinguishable by a host deciding whether to re-describe its tools.
    const other = await makeCatalog();
    const notFound = await run(
      dispatch(other.catalog)({ tool: "nope", args: ["milk"], buildId: CURRENT }),
    );
    expect(notFound.ok).toBe(false);
    expect(tagOf(notFound.error)).toBe("AgentToolNotFoundError");
    expect(notFound.error.manifest).toBeUndefined();

    // …and a current call is unaffected: no manifest, no refusal.
    const good = await makeCatalog();
    const ok = await run(
      dispatch(good.catalog)({ tool: "saveTodo", args: ["milk"], buildId: CURRENT }),
    );
    expect(ok.ok).toBe(true);
    expect(good.calls).toEqual(["milk"]);
  });
});
