/**
 * `@affe/agent` — agent-surface adapters over the effect-atom-jsx Agent
 * catalog (`DQ-096`: adapters live here, never as core `src/` modules).
 *
 * This package builds against **public `effect-atom-jsx` subpaths only** —
 * the same external-consumer constraint `@affe/permissive` pins.
 */
export {
  McpAuth,
  mcpAuthLayer,
  mcpServer,
  mcpTools,
  McpToolNotExposedError,
  McpUnknownToolError,
  type McpAuthService,
  type McpCallToolRequest,
  type McpServer,
  type McpServerOptions,
  type McpTool,
  type McpToolResult,
} from "./mcp.js";
