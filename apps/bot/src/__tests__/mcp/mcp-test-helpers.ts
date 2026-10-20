import mongoose from 'mongoose';
import { McpContext } from 'src/mcp/context';
import { ToolDefinition } from 'src/mcp/tools/types';

// Shared fixtures for the MCP tool tests (not a test file itself: no *.test.ts suffix).

export const oid = () => new mongoose.Types.ObjectId();

export const me = { _id: oid(), telegramUserId: 1, username: 'me', firstName: 'Me' } as any;
export const an = { _id: oid(), telegramUserId: 2, username: 'an', firstName: 'An', lastName: 'Nguyen' } as any;
export const binh = { _id: oid(), telegramUserId: 3, username: null, firstName: 'Bình', lastName: 'Trần' } as any;

export const alpha = { _id: oid(), telegramGroupId: -1001, groupName: 'Team Alpha', timezone: 'UTC' } as any;
export const beta = { _id: oid(), telegramGroupId: -1002, groupName: 'Team Beta', timezone: 'UTC' } as any;

export const ctx = (overrides: Partial<McpContext> = {}): McpContext => ({
  user: me,
  clientLabel: 'Claude Code',
  scopeGroup: null,
  ...overrides,
});

export function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    groupId: alpha._id,
    taskNumber: 12,
    title: 'Fix login',
    description: null,
    type: 'bug',
    status: 'todo',
    priority: 'medium',
    createdBy: me,
    assigneeId: null,
    dueDate: null,
    epicId: null,
    createdAt: new Date('2026-10-20T08:00:00Z'),
    ...overrides,
  } as any;
}

/** Runs a tool's handler with schema parsing, like the SDK does. */
export async function call(tool: ToolDefinition<any>, args: Record<string, unknown>, context = ctx()) {
  const { z } = await import('zod');
  const parsed = z.object(tool.inputSchema).parse(args);
  return tool.handler(parsed as never, context) as Promise<{ text: string; data: any }>;
}

/** Expects the call to fail with an McpToolError whose text matches. */
export async function expectToolError(promise: Promise<unknown>, pattern: RegExp | string) {
  const { McpToolError } = await import('src/mcp/context');
  await expect(promise).rejects.toBeInstanceOf(McpToolError);
  await expect(promise).rejects.toThrow(pattern);
}
