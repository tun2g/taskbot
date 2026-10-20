import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { McpContext, ToolOutput } from 'src/mcp/context';
import { z } from 'zod';

/** One MCP tool: schema + hints for the client, and a handler that is easy to call directly in tests. */
export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  annotations: ToolAnnotations;
  handler: (args: z.infer<z.ZodObject<Shape>>, ctx: McpContext) => Promise<ToolOutput>;
}

export function defineTool<Shape extends z.ZodRawShape>(definition: ToolDefinition<Shape>): ToolDefinition<Shape> {
  return definition;
}

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** Writes that only add (or change what was asked) — calling twice creates twice. */
export const ADDITIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
/** Writes where the same call twice ends in the same state. */
export const IDEMPOTENT_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Shared argument schemas. */
export const groupArg = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe(
    'The group (workspace): its id or exact title from list_groups. Optional when this connection is limited to one group or you are in only one group.',
  );
export const taskNumberArg = z.number().int().positive().describe('The task number within the group — "#12" is 12.');
