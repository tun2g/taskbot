import { askTaskbotTool } from 'src/mcp/tools/ask-taskbot';
import { createTasksTool } from 'src/mcp/tools/create-tasks';
import { deleteTaskTool } from 'src/mcp/tools/delete-task';
import { createEpicTool, listEpicsTool, updateEpicTool } from 'src/mcp/tools/epics';
import { getTaskTool } from 'src/mcp/tools/get-task';
import { listGroupsTool, listMembersTool } from 'src/mcp/tools/groups';
import { listTasksTool } from 'src/mcp/tools/list-tasks';
import { ToolDefinition } from 'src/mcp/tools/types';
import { undoLastTool } from 'src/mcp/tools/undo-last';
import { updateTaskTool } from 'src/mcp/tools/update-task';

/** Every tool, in the order clients list them (natural language first, then the precise tools). */
export const MCP_TOOLS = [
  askTaskbotTool,
  listGroupsTool,
  listMembersTool,
  listTasksTool,
  getTaskTool,
  createTasksTool,
  updateTaskTool,
  deleteTaskTool,
  undoLastTool,
  listEpicsTool,
  createEpicTool,
  updateEpicTool,
] as unknown as ToolDefinition[];
