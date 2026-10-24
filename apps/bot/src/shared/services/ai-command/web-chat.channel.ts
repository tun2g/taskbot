import type { AiChatResponse, AiChatTurn } from '@tbot/shared';
import { IGroup } from 'src/database/models/group.model';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { IUser } from 'src/database/models/user.model';
import { CardEditor } from 'src/shared/services/ai-command.service';

export interface WebChatInput {
  group: IGroup;
  requester: IUser;
  message: string;
  taskId?: string;
  history?: AiChatTurn[];
  /** Refreshes group task cards (bot.telegram in production). */
  editor: CardEditor;
  /**
   * Who is asking when it isn't the web app: the MCP server passes `{ activity: 'mcp', label: 'Claude Code' }`, so
   * the activity log says mcp and group posts say "(via Claude Code)". Omitted = the web chat ("(via app)").
   */
  channel?: ChatChannel;
}

export interface ChatChannel {
  activity: TaskActivityVia;
  label: string;
}

/** Extra "(via …)" argument for the group-post helpers — only when it isn't the default "app". */
export const viaArg = (channel?: ChatChannel): [] | [string] => (channel ? [channel.label] : []);

export type WebChatOutcome =
  | { status: 'ok'; data: AiChatResponse }
  | { status: 'rate_limited'; message: string }
  | { status: 'task_not_found' };
