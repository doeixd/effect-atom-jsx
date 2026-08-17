/**
 * AN-3 — `@affe/agent` MCP projection, gating coverage. The authoritative
 * scenario suite lives in `future/agent/mcp-projection.spec.ts` (kept there
 * until `DQ-098` settles the A2A scope); these tests keep the adapter's
 * load-bearing behavior under `npm test`, plus the package-surface lint the
 * permissive package pins for itself: adapters consume PUBLIC core subpaths
 * only, never `src/` or `dist/` deep imports (`DQ-096`).
 */
import { McpAuth, mcpServer, mcpTools } from "@affe/agent";
import { Effect, Layer, Schema } from "effect";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as Agent from "../Agent.js";
import * as Portable from "../Portable.js";

const BUILD = "agent-mcp-test-build";

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const packageRoot = path.join(repoRoot, "packages", "agent");

function makeMixedCatalog() {
  const calls: Array<string> = [];
  const mk = (id: string) =>
    Portable.code({
      id,
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: (_captures, text: string) =>
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
    catalog: Agent.catalog({
      addTodo: Agent.expose(mk("todo.add"), {
        ...shared,
        description: "Add a todo item",
        access: { agent: true, http: true },
      }),
      // UI-only: the agent must not see this at all.
      focusInput: Agent.expose(mk("ui.focusInput"), {
        ...shared,
        description: "Focus the todo input",
        access: { agent: false },
      }),
    }),
  };
}

describe("@affe/agent MCP projection", () => {
  it("projects one MCP tool per agent-exposed entry and callTool runs the one dispatch path", async () => {
    const { calls, catalog } = makeMixedCatalog();

    const tools = await run(mcpTools(catalog));
    // Exposure flags respected: the UI-only action is absent.
    expect(tools.map((tool) => tool.name)).toEqual(["addTodo"]);
    expect(tools[0]!.description).toBe("Add a todo item");
    expect((tools[0]!.inputSchema as { readonly type: string }).type).toBe("object");
    expect(JSON.parse(JSON.stringify(tools[0]))).toEqual(tools[0]);

    const server = await run(mcpServer(catalog));
    const viaMcp = await run(
      server.callTool({ name: "addTodo", arguments: { text: "milk" } }),
    );
    expect(viaMcp.isError).toBe(false);
    expect(calls).toEqual(["todo.add:milk"]);

    // Same code path, same projected success value as HTTP dispatch.
    calls.length = 0;
    const viaHttp = await run(
      Agent.dispatch(catalog)({
        tool: "addTodo",
        args: ["milk"],
        buildId: BUILD,
      }).pipe(Effect.orDie),
    );
    expect(viaHttp.ok).toBe(true);
    if (viaHttp.ok) {
      expect(viaMcp.structuredContent).toEqual(viaHttp.payload.mutation);
    }
    expect(calls).toEqual(["todo.add:milk"]);
  });

  it("hiding is enforcement: a UI-only tool is refused by exact name, distinctly from a typo", async () => {
    const { calls, catalog } = makeMixedCatalog();
    const server = await run(mcpServer(catalog));

    const hidden = await run(
      server.callTool({ name: "focusInput", arguments: { text: "x" } }),
    );
    const missing = await run(
      server.callTool({ name: "noSuchTool", arguments: { text: "x" } }),
    );
    expect(hidden.isError).toBe(true);
    expect(missing.isError).toBe(true);
    expect(calls).toEqual([]);
    // "Hidden by exposure flags" and "does not exist" are distinct codes.
    const tagOf = (value: unknown): string =>
      String((value as { readonly _tag?: unknown })?._tag);
    expect(tagOf(hidden.structuredContent)).toBe("McpToolNotExposedError");
    expect(tagOf(missing.structuredContent)).toBe("McpUnknownToolError");
  });

  it("auth is pluggable and refuses before anything runs; the authenticated identity reaches the result", async () => {
    const { calls, catalog } = makeMixedCatalog();
    const server = await run(mcpServer(catalog));

    const denying = Layer.succeed(McpAuth, {
      authenticate: () =>
        Effect.fail({ _tag: "McpUnauthenticatedError", reason: "no token" }),
    });
    const refused = await run(
      server
        .callTool({ name: "addTodo", arguments: { text: "milk" } })
        .pipe(Effect.provide(denying)),
    );
    expect(refused.isError).toBe(true);
    expect(
      (refused.structuredContent as { readonly _tag: string })._tag,
    ).toBe("McpUnauthenticatedError");
    expect(calls).toEqual([]);

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
    expect(allowed.caller).toBe("mcp");
    expect(JSON.stringify(allowed)).toContain("u-42");
    expect(calls).toEqual(["todo.add:milk"]);
  });

  it("drift is inherited from dispatch: a stale buildId is refused through the MCP surface", async () => {
    const stale = makeMixedCatalog();
    const staleServer = await run(
      mcpServer(stale.catalog, { buildId: "build-stale" }),
    );
    const refused = await run(
      staleServer.callTool({ name: "addTodo", arguments: { text: "milk" } }),
    );
    expect(refused.isError).toBe(true);
    expect(
      (refused.structuredContent as { readonly _tag: string })._tag,
    ).toBe("PortableBuildMismatchError");
    expect(stale.calls).toEqual([]);

    const current = makeMixedCatalog();
    const currentServer = await run(mcpServer(current.catalog, { buildId: BUILD }));
    const ok = await run(
      currentServer.callTool({ name: "addTodo", arguments: { text: "milk" } }),
    );
    expect(ok.isError).toBe(false);
    expect(current.calls).toEqual(["todo.add:milk"]);
  });

  it("an MCP tool error is a typed discriminated value, not a stringified message", async () => {
    class QuotaError extends Schema.TaggedErrorClass<QuotaError>(
      "agent-mcp-test/QuotaError",
    )("QuotaError", { limit: Schema.Number }) {}

    const c = Agent.catalog({
      addTodo: Agent.expose(
        Portable.code({
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
    const content = result.structuredContent as { readonly _tag: string; readonly limit: number };
    expect(content._tag).toBe("QuotaError");
    expect(content.limit).toBe(50);
  });

  it("ships no A2A / ask-agent surface (DQ-098: userland; a bridge, if ever, lives in @affe/agent)", async () => {
    // The boundary pin: neither the core Agent module nor the adapter exports
    // an agent-delegation surface. §1's answer stands — `ask-agent` is an
    // app-level action like any other.
    const adapter = await import("@affe/agent");
    for (const mod of [Agent as Record<string, unknown>, adapter as Record<string, unknown>]) {
      const delegating = Object.keys(mod).filter((name) => /askagent|a2a/i.test(name));
      expect(delegating).toEqual([]);
    }
  });

  it("imports only public effect-atom-jsx subpaths — never src/ or dist/ deep imports", () => {
    const corePkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { readonly name: string; readonly exports: Record<string, unknown> };
    expect(corePkg.name).toBe("effect-atom-jsx");
    const publishedSubpaths = new Set(
      Object.keys(corePkg.exports).map((key) =>
        key === "." ? "effect-atom-jsx" : `effect-atom-jsx/${key.slice(2)}`,
      ),
    );

    const sourceFiles: Array<string> = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(full);
      }
    };
    walk(path.join(packageRoot, "src"));
    expect(sourceFiles.length).toBeGreaterThan(0);

    const violations: Array<string> = [];
    const importPattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
    for (const file of sourceFiles) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1]!;
        const where = `${path.relative(repoRoot, file)}: "${specifier}"`;
        if (specifier.startsWith(".")) {
          const resolved = path.resolve(path.dirname(file), specifier);
          if (!resolved.startsWith(packageRoot)) violations.push(where);
          continue;
        }
        if (
          specifier === "effect-atom-jsx" ||
          specifier.startsWith("effect-atom-jsx/")
        ) {
          if (!publishedSubpaths.has(specifier)) violations.push(where);
          continue;
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
