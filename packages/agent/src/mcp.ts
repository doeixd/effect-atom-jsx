/**
 * AN-3 — the MCP projection (`AGENT_NATIVE_NOTES.md` §1 "MCP server",
 * §7 item 3), packaged as `@affe/agent` per ratified `DQ-096` (the adapter
 * lives OUTSIDE core — no `src/agent-mcp.ts` module).
 *
 * Mounting the catalog as an MCP server is a *pure projection* over AN-1:
 * tools come from the declared Effect Schemas, descriptions from catalog
 * entries, auth is pluggable, and exposure flags are honoured — a UI-only
 * action is absent from the listing AND refused by name. There is no
 * parallel registry and no hand-written manifest; `callTool` runs the SAME
 * `Agent.dispatch` pipeline every other surface runs (`DQ-080` envelope,
 * `DQ-081` drift, `DQ-086` ordering), so every dispatch guarantee is
 * inherited rather than re-implemented.
 *
 * The `{ isError, structuredContent }
 * ` result shape is MCP's own, not ours. This module is transport-neutral on
 * purpose: a host binds `McpServer.callTool` / `mcpTools` to its transport
 * (stdio, HTTP, an SDK server) without this package taking an SDK
 * dependency.
 */
import { Cause, Context, Effect, Layer, Option, Schema } from "effect";
import * as Agent from "effect-atom-jsx/Agent";

// ─── Errors ──────────────────────────────────────────────────────────────────

export class McpUnknownToolError extends Schema.TaggedErrorClass<McpUnknownToolError>(
  "@affe/agent/McpUnknownToolError",
)("McpUnknownToolError", {
  tool: Schema.String,
  message: Schema.String,
}) {}

/**
 * Distinct from {@link McpUnknownToolError} on purpose: "hidden by exposure
 * flags" and "does not exist" must be distinguishable codes, or a probe
 * cannot be told apart from a typo and a single catch-all satisfies both.
 */
export class McpToolNotExposedError extends Schema.TaggedErrorClass<McpToolNotExposedError>(
  "@affe/agent/McpToolNotExposedError",
)("McpToolNotExposedError", {
  tool: Schema.String,
  message: Schema.String,
}) {}

// ─── Pluggable auth ──────────────────────────────────────────────────────────

/**
 * The pluggable MCP authenticator. `authenticate` yields the caller identity
 * the dispatch pipeline (and therefore the audit trail) sees — lineage on an
 * MCP call is supplied by the host's authenticator, never fabricated by this
 * adapter. Failure refuses the call BEFORE the tool name is even validated,
 * so an unauthenticated caller learns nothing (the `DQ-086` posture applied
 * to this surface).
 *
 * Absent service = an open adapter: dispatch runs without an adapter-provided
 * `CallerContext`. Production hosts provide `McpAuth`.
 */
export interface McpAuthService {
  readonly authenticate: () => Effect.Effect<Agent.CallerContextService, unknown>;
}

export const McpAuth = Context.Service<McpAuthService>("affe/agent/McpAuth");

// ─── Tool listing ────────────────────────────────────────────────────────────

/** One MCP tool entry: plain wire data, no closures. */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

function jsonSchemaOf(schema: unknown): unknown {
  return (Schema.toJsonSchemaDocument(schema as Schema.Top) as {
    readonly schema: unknown;
  }).schema;
}

function tupleElementsOf(args: unknown): ReadonlyArray<unknown> {
  const elements = (args as { readonly elements?: ReadonlyArray<unknown> })
    ?.elements;
  return elements ?? [];
}

function structFieldCount(schema: unknown): number {
  const fields = (schema as { readonly fields?: Record<string, unknown> })
    ?.fields;
  return fields === undefined ? 0 : Object.keys(fields).length;
}

/**
 * The MCP `inputSchema` is an OBJECT projection of the core's positional
 * tuple (`DQ-088`): authored `argNames` name the properties; a single-struct
 * tuple projects the struct itself; otherwise positional `argN` names are
 * synthesized (author `argNames` for real names).
 */
function inputSchemaOf(entry: Agent.CatalogEntry): unknown {
  const elements = tupleElementsOf(entry.args);
  if (entry.argNames !== undefined) {
    const properties: Record<string, unknown> = {};
    entry.argNames.forEach((name, index) => {
      const element = elements[index];
      properties[name] = element === undefined ? {} : jsonSchemaOf(element);
    });
    return {
      type: "object",
      properties,
      required: [...entry.argNames],
      additionalProperties: false,
    };
  }
  if (elements.length === 1 && structFieldCount(elements[0]) > 0) {
    return jsonSchemaOf(elements[0]);
  }
  const properties: Record<string, unknown> = {};
  elements.forEach((element, index) => {
    properties[`arg${index}`] = jsonSchemaOf(element);
  });
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
  };
}

function isAgentExposed(entry: Agent.CatalogEntry): boolean {
  return entry.access?.agent === true;
}

/**
 * Project one MCP tool per agent-exposed catalog entry. Exposure is the
 * declared `access.agent` flag — a UI-only action is simply absent, and the
 * same flag is ENFORCED by `callTool`, so hiding is never listing-only.
 */
export function mcpTools(
  base: Agent.Catalog,
): Effect.Effect<ReadonlyArray<McpTool>> {
  return Effect.sync(() =>
    Object.entries(base.entries)
      .filter(([, entry]) => isAgentExposed(entry))
      .map(([name, entry]) => ({
        name,
        description: entry.description,
        inputSchema: inputSchemaOf(entry),
      }))
  );
}

// ─── The server ──────────────────────────────────────────────────────────────

export interface McpCallToolRequest {
  readonly name: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}

/** MCP's own result shape: `{isError, structuredContent}` plus, when the
 * host authenticated the call, the identity the audit trail saw. */
export interface McpToolResult {
  readonly isError: boolean;
  readonly structuredContent: unknown;
  readonly caller?: string;
  readonly user?: unknown;
}

export interface McpServer {
  readonly callTool: (
    request: McpCallToolRequest,
  ) => Effect.Effect<McpToolResult>;
  readonly listTools: () => Effect.Effect<ReadonlyArray<McpTool>>;
}

export interface McpServerOptions {
  /**
   * The caller-visible build identity forwarded to dispatch's drift check
   * (`DQ-081`). Defaults to each entry's own build — the server IS the
   * current build; a host proxying stale clients passes their id through.
   */
  readonly buildId?: string;
}

/** Lower MCP's named `arguments` object to the core's positional tuple. */
function lowerArguments(
  base: Agent.Catalog,
  tool: string,
  entry: Agent.CatalogEntry,
  named: Readonly<Record<string, unknown>>,
): Effect.Effect<ReadonlyArray<unknown>, unknown> {
  if (entry.argNames !== undefined) {
    // DQ-088: the authored names ARE the projection, shared with HTTP.
    return Agent.structArgs(base, tool, named);
  }
  const elements = tupleElementsOf(entry.args);
  if (elements.length === 1 && structFieldCount(elements[0]) > 0) {
    return Effect.succeed([named]);
  }
  // Positional fallback: property insertion order. Author `argNames` on the
  // catalog entry for a named contract.
  return Effect.succeed(Object.values(named));
}

function errorValueOf(exit: {
  readonly _tag: "Failure";
  readonly cause: Cause.Cause<unknown>;
}): unknown {
  return Cause.findErrorOption(exit.cause).pipe(
    Option.getOrElse(() => exit.cause as unknown),
  );
}

function refusal(error: unknown, identity?: Agent.CallerContextService): McpToolResult {
  return {
    isError: true,
    structuredContent: error,
    ...(identity === undefined ? {} : { caller: identity.caller, user: identity.user }),
  };
}

/**
 * Mount a catalog as a transport-neutral MCP server. `callTool` is the SAME
 * dispatch path as HTTP — this function adds only the MCP projections:
 * pluggable authentication, exposure enforcement, and the named-arguments
 * lowering. Auth runs before tool-name validation, drift and errors ride the
 * usual dispatch envelope, and every refusal is a typed discriminated value
 * in `structuredContent`, never a stringified message.
 */
export function mcpServer(
  base: Agent.Catalog,
  options?: McpServerOptions,
): Effect.Effect<McpServer> {
  return Effect.sync(() => {
    const dispatcher = Agent.dispatch(base);

    const callTool = (
      request: McpCallToolRequest,
    ): Effect.Effect<McpToolResult> =>
      Effect.gen(function* () {
        // 1. Authenticate FIRST: an unauthenticated caller learns nothing —
        //    not even whether the tool name was valid.
        const auth = yield* Effect.serviceOption(McpAuth);
        let identity: Agent.CallerContextService | undefined;
        if (auth._tag === "Some") {
          const authenticated = yield* Effect.exit(auth.value.authenticate());
          if (authenticated._tag === "Failure") {
            return refusal(errorValueOf(authenticated));
          }
          identity = authenticated.value;
        }

        // 2. Exposure is enforcement, not hiding: a UI-only entry is refused
        //    by exact name with a code distinct from "no such tool".
        const entry = base.entries[request.name];
        if (entry === undefined) {
          return refusal(
            new McpUnknownToolError({
              tool: request.name,
              message: `No MCP tool named "${request.name}".`,
            }),
            identity,
          );
        }
        if (!isAgentExposed(entry)) {
          return refusal(
            new McpToolNotExposedError({
              tool: request.name,
              message: `Tool "${request.name}" is not exposed to agents.`,
            }),
            identity,
          );
        }

        // 3. Lower named arguments to the positional tuple, then run the ONE
        //    dispatch pipeline. The declared args schema still validates the
        //    values inside dispatch — lowering is shape, not trust.
        const lowered = yield* Effect.exit(
          lowerArguments(base, request.name, entry, request.arguments ?? {}),
        );
        if (lowered._tag === "Failure") {
          return refusal(errorValueOf(lowered), identity);
        }

        let dispatchEffect = dispatcher({
          tool: request.name,
          args: lowered.value,
          buildId: options?.buildId ?? entry.code.buildId,
        });
        if (identity !== undefined) {
          dispatchEffect = dispatchEffect.pipe(
            Effect.provideService(Agent.CallerContext, identity),
          );
        }
        const outcome = yield* Effect.exit(dispatchEffect);
        if (outcome._tag === "Failure") {
          // DQ-083: an audit-sink refusal rides the Effect error channel; on
          // this surface it becomes a typed MCP refusal like any other.
          return refusal(errorValueOf(outcome), identity);
        }
        const response = outcome.value;
        if (!response.ok) {
          return refusal(response.error, identity);
        }
        return {
          isError: false,
          structuredContent: response.payload.mutation,
          ...(identity === undefined
            ? {}
            : { caller: identity.caller, user: identity.user }),
        };
      });

    return {
      callTool,
      listTools: () => mcpTools(base),
    } satisfies McpServer;
  });
}

/** Convenience layer for a static authenticator. */
export function mcpAuthLayer(
  service: McpAuthService,
): Layer.Layer<McpAuthService> {
  return Layer.succeed(McpAuth, service);
}
