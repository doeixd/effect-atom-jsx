/**
 * AN-3 — MCP projection (`AGENT_NATIVE_NOTES.md` §1 "MCP server", §7 item 3).
 *
 * The claim: mounting the catalog as an MCP server is a *pure projection* over
 * AN-1 — tools come from schemas, descriptions from catalog entries, auth is
 * pluggable, and exposure flags are honoured so a UI-only action is simply
 * absent from the tool list. No parallel registry, no hand-written manifest.
 *
 * RATIFIED (`AGENT_NATIVE_NOTES.md` §10):
 * - `DQ-080` — the two-arm dispatch envelope; the "PROVISIONAL ENVELOPE"
 *   markers are retired.
 * - `DQ-088` — args are a `Schema.Tuple` in core plus an authored `argNames`;
 *   the MCP struct projection is *derived from `argNames`*, so this adapter
 *   declares nothing of its own.
 *
 * STILL PROVISIONAL, pending `DQ-096`: the module names `src/agent-mcp.ts` and
 * `src/Agent.ts`. The MCP-side `{isError, structuredContent}` shape is MCP's
 * own, not ours.
 */

import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick, unbuilt } from "../harness.js";
import { run, tagOf } from "./support.js";

const BUILD = "build-an3";

const makeMixedCatalog = async () => {
  const { catalog, expose } = await fromSrc("Agent", "catalog", "expose");
  const { code } = await fromSrc("Portable", "code");

  const calls: Array<string> = [];
  const mk = (id: string) =>
    code({
      id,
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_c: any, text: string) =>
        Effect.sync(() => {
          calls.push(`${id}:${text}`);
          return { echoed: text };
        }),
    });

  const shared = {
    args: Schema.Tuple([Schema.String]),
    success: Schema.Struct({ echoed: Schema.String }),
  };

  return {
    calls,
    catalog: catalog({
      addTodo: expose(mk("todo.add"), {
        ...shared,
        description: "Add a todo item",
        access: { agent: true, http: true },
      }),
      // UI-only: the agent must not see this at all.
      focusInput: expose(mk("ui.focusInput"), {
        ...shared,
        description: "Focus the todo input",
        access: { agent: false, ui: true },
      }),
    }),
  };
};

describe("AN-3 MCP projection", () => {
  it("[AN-3] projects one MCP tool per agent-exposed entry, with derived descriptions and input schemas", async () => {
    const { mcpTools } = await fromSrc("agent-mcp", "mcpTools");
    const { catalog } = await makeMixedCatalog();

    const tools = await run(mcpTools(catalog));

    // Exposure flags respected: the UI-only action is absent.
    expect(tools.map((tool: any) => tool.name)).toEqual(["addTodo"]);

    const [tool] = tools;
    expect(tool.description).toBe("Add a todo item");
    // MCP's `inputSchema` is JSON Schema derived from the declared args schema.
    expect(tool.inputSchema.type).toBe("object");
    expect(JSON.parse(JSON.stringify(tool))).toEqual(tool);
    // No closures on the wire-facing projection.
    expect(typeof tool.inputSchema).toBe("object");
  });

  it("[AN-3] calling a projected tool runs the same code path as HTTP dispatch", async () => {
    const { mcpServer } = await fromSrc("agent-mcp", "mcpServer");
    const { dispatch } = await fromSrc("Agent", "dispatch");
    const { calls, catalog } = await makeMixedCatalog();

    const server = await run(mcpServer(catalog));

    const viaMcp = await run(
      server.callTool({ name: "addTodo", arguments: { text: "milk" } }),
    );
    expect(viaMcp.isError).toBe(false);
    expect(calls).toEqual(["todo.add:milk"]);

    calls.length = 0;
    const viaHttp = await run(
      dispatch(catalog)({ tool: "addTodo", args: ["milk"], buildId: BUILD }),
    );
    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(viaHttp.ok).toBe(true);
    expect(calls).toEqual(["todo.add:milk"]);

    // Same success value, projected once through the declared success schema.
    expect(viaMcp.structuredContent).toEqual(viaHttp.payload.mutation);
  });

  it("[AN-3] a UI-only action cannot be invoked through MCP even by exact name", async () => {
    // Absence from the listing is not enough: hiding must be enforcement.
    const { mcpServer } = await fromSrc("agent-mcp", "mcpServer");
    const { calls, catalog } = await makeMixedCatalog();

    const server = await run(mcpServer(catalog));
    const result = await run(
      server.callTool({ name: "focusInput", arguments: { text: "x" } }),
    );

    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);

    // "Hidden by exposure flags" and "does not exist" must be distinguishable
    // codes: otherwise a probe cannot be told apart from a typo, and a single
    // catch-all satisfies both specs.
    const missing = await run(
      server.callTool({ name: "noSuchTool", arguments: { text: "x" } }),
    );
    expect(missing.isError).toBe(true);
    expect(tagOf(result.structuredContent)).not.toBe(tagOf(missing.structuredContent));

    // NEGATIVE CONTROL: the agent-exposed sibling on the same server IS
    // invocable, so "refuse every callTool" cannot pass.
    const allowed = await run(
      server.callTool({ name: "addTodo", arguments: { text: "milk" } }),
    );
    expect(allowed.isError).toBe(false);
    expect(calls).toEqual(["todo.add:milk"]);
  });

  it("[AN-3] auth is pluggable: an unauthenticated MCP call is refused before the action runs", async () => {
    const { mcpServer, McpAuth } = await fromSrc("agent-mcp", "mcpServer", "McpAuth");
    const { CallerContext } = await fromSrc("Agent", "CallerContext");
    const { calls, catalog } = await makeMixedCatalog();

    const server = await run(mcpServer(catalog));
    const denying = Layer.succeed(McpAuth, {
      authenticate: () =>
        Effect.fail({ _tag: "McpUnauthenticatedError", reason: "no token" } as any),
    });

    const refused = await run(
      server
        .callTool({ name: "addTodo", arguments: { text: "milk" } })
        .pipe(Effect.provide(denying)),
    );
    expect(refused.isError).toBe(true);
    expect(tagOf(refused.structuredContent)).toBe("McpUnauthenticatedError");
    expect(calls).toEqual([]);

    // A pluggable authenticator also supplies the CallerContext identity, so
    // audit lineage on an MCP call is not fabricated by the adapter.
    const accepting = Layer.succeed(McpAuth, {
      authenticate: () =>
        Effect.succeed({
          caller: "mcp",
          user: { _tag: "Some", value: "u-42" },
          lineage: { _tag: "None" },
        }),
    });
    const allowed = await run(
      server
        .callTool({ name: "addTodo", arguments: { text: "milk" } })
        .pipe(Effect.provide(accepting)),
    );
    expect(allowed.isError).toBe(false);
    expect(calls).toEqual(["todo.add:milk"]);
    // The authenticated identity is what the audit trail sees, not "mcp" hardcoded
    // by the adapter: the caller reported for this call is the one authenticate
    // returned.
    expect(allowed.caller).toBe("mcp");
    expect(JSON.stringify(allowed)).toContain("u-42");
  });

  it("[AN-3] an MCP tool error is a typed discriminated value, not a stringified message", async () => {
    const { mcpServer } = await fromSrc("agent-mcp", "mcpServer");
    const { catalog, expose } = await fromSrc("Agent", "catalog", "expose");
    const { code } = await fromSrc("Portable", "code");

    class QuotaError extends Schema.TaggedErrorClass<QuotaError>(
      "future/agent/QuotaError",
    )("QuotaError", { limit: Schema.Number }) {}

    const c = catalog({
      addTodo: expose(
        code({
          id: "todo.add.quota",
          buildId: BUILD,
          captures: Schema.Struct({}),
          run: () => Effect.fail(new QuotaError({ limit: 50 })),
        }),
        {
          description: "Add a todo",
          args: Schema.Tuple([]),
          success: Schema.Struct({ id: Schema.String }),
          error: QuotaError,
          access: { agent: true },
        },
      ),
    });

    const server = await run(mcpServer(c));
    const result = await run(server.callTool({ name: "addTodo", arguments: {} }));

    expect(result.isError).toBe(true);
    expect(tagOf(result.structuredContent)).toBe("QuotaError");
    expect(result.structuredContent.limit).toBe(50);
  });

  it("[AN-3] a stale buildId is still refused through the MCP surface", async () => {
    // The drift guard is a property of dispatch, so every surface inherits it.
    const { mcpServer } = await fromSrc("agent-mcp", "mcpServer");

    const stale = await makeMixedCatalog();
    const staleServer = await run(mcpServer(stale.catalog, { buildId: "build-stale" }));
    const result = await run(
      staleServer.callTool({ name: "addTodo", arguments: { text: "milk" } }),
    );

    expect(result.isError).toBe(true);
    expect(tagOf(result.structuredContent)).toBe("PortableBuildMismatchError");
    expect(stale.calls).toEqual([]);

    // NEGATIVE CONTROL, on a fresh catalog so the two phases share no call log:
    // the current buildId is accepted through the same surface. Without this, an
    // MCP adapter that rejects every call passes.
    const current = await makeMixedCatalog();
    const currentServer = await run(mcpServer(current.catalog, { buildId: BUILD }));
    const ok = await run(
      currentServer.callTool({ name: "addTodo", arguments: { text: "milk" } }),
    );
    expect(ok.isError).toBe(false);
    expect(current.calls).toEqual(["todo.add:milk"]);
  });

  it("[AN-3] A2A / ask-agent bridge scope", async () => {
    // Open design question DQ-098: library, adapter, or userland.
    const mod = await loadSrc("agent-mcp");
    pick(mod, "agent-mcp", "mcpTools");
    unbuilt(
      "A2A / ask-agent bridge surface (in @affe/agent or out of scope)",
      "DQ-098",
    );
  });
});
