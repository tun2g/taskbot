import { mcpChannel, McpToolError } from 'src/mcp/context';
import { requireGroup } from 'src/mcp/resolve/group';
import { defineTool, groupArg } from 'src/mcp/tools/types';
import { undoAppBatch } from 'src/shared/services/ai-command/web-chat';
import { z } from 'zod';

export const undoLastTool = defineTool({
  name: 'undo_last',
  title: 'Undo created tasks',
  description:
    'Removes the tasks created by one create_tasks or ask_taskbot call, using the undoToken it returned. ' +
    'Works for 10 minutes, for the person who created them (or a group admin).',
  inputSchema: {
    group: groupArg,
    undoToken: z.string().trim().min(1).describe('The undoToken returned by create_tasks / ask_taskbot.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ group: groupRef, undoToken }, ctx) => {
    const group = await requireGroup(ctx, groupRef);
    const result = await undoAppBatch({
      user: ctx.user,
      batchId: undoToken,
      groupId: String(group._id),
      channel: mcpChannel(ctx),
    });
    if (result.status !== 'ok') throw new McpToolError(result.message);
    return {
      text: result.removed
        ? `Undone: removed ${result.removed} task${result.removed === 1 ? '' : 's'}.`
        : 'Nothing to remove — those tasks were already deleted.',
      data: { removed: result.removed },
    };
  },
});
