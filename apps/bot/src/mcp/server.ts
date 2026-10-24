import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpContext, McpToolError } from 'src/mcp/context';
import { serverInstructions } from 'src/mcp/instructions';
import { MCP_TOOLS } from 'src/mcp/tools';
import { ToolDefinition } from 'src/mcp/tools/types';
import { UsageKind } from '@tbot/shared';
import logger from 'src/shared/logger/logger';
import { withContext } from 'src/shared/services/telemetry/request-context';
import { recordUsage, touchLastSeen } from 'src/shared/services/telemetry/usage-tracker';

export const MCP_SERVER_NAME = 'taskbot';
export const MCP_SERVER_VERSION = '1.0.0';

const UNEXPECTED_ERROR = 'Something went wrong on the TaskBot side. Please try again in a moment.';

/** Runs a tool for this caller and turns its output / McpToolError into an MCP result. */
export async function runTool(tool: ToolDefinition, args: unknown, ctx: McpContext): Promise<CallToolResult> {
  const started = Date.now();
  const resolved: { groupId?: string | null } = { groupId: ctx.scopeGroup ? String(ctx.scopeGroup._id) : null };
  const result = await withContext(
    { channel: 'mcp', userId: ctx.user._id, groupId: resolved.groupId, telegramUserId: ctx.user.telegramUserId, resolved },
    () => callTool(tool, args, ctx),
  );
  recordUsage({
    kind: UsageKind.MCP_TOOL,
    name: tool.name,
    channel: 'mcp',
    client: ctx.clientLabel,
    userId: ctx.user._id,
    groupId: resolved.groupId ?? null,
    ok: !result.isError,
    latencyMs: Date.now() - started,
  });
  touchLastSeen({ userId: ctx.user._id, groupId: resolved.groupId });
  return result;
}

async function callTool(tool: ToolDefinition, args: unknown, ctx: McpContext): Promise<CallToolResult> {
  try {
    const { text, data } = await tool.handler(args as never, ctx);
    return { content: [{ type: 'text', text }], structuredContent: data };
  } catch (error) {
    if (error instanceof McpToolError) return { isError: true, content: [{ type: 'text', text: error.message }] };
    logger.error(`MCP tool ${tool.name} failed: ${error instanceof Error ? error.stack : error}`);
    return { isError: true, content: [{ type: 'text', text: UNEXPECTED_ERROR }] };
  }
}

/** One server per HTTP request (stateless), bound to the token's user, scope and client label. */
export function buildMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: serverInstructions(ctx.scopeGroup) },
  );
  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (args: unknown) => runTool(tool, args, ctx),
    );
  }
  return server;
}
