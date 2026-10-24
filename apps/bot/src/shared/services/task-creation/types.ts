import { BotContext } from 'src/bot/interface/context';
import { IGroup } from 'src/database/models/group.model';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { BufferedMessage } from 'src/shared/services/message-buffer.service';

export interface CreateTasksInput {
  /** Oldest first. For free text, pass one message whose text is the request. */
  messages: BufferedMessage[];
  /** Extra instruction from the requester (title hint, "assign to @an", …). */
  note?: string;
  requester: IUser;
  group: IGroup;
  /** Notes shown under the result (e.g. privacy-mode hints). */
  warnings?: string[];
  /**
   * True for "/task N" / "/task all": zero action items → "nothing found" reply, and when the
   * AI rate limit is hit → ask to wait. False (default): always creates at least a basic task.
   */
  multiMessage?: boolean;
  /** True when the caller already counted this request against the person's AI limits (/ai, web chat). */
  userAiLimitChecked?: boolean;
}

export type SendExtra = Parameters<BotContext['reply']>[1];

export type CreationOrigin = 'telegram' | 'app';

export interface CreateTasksCoreInput extends CreateTasksInput {
  /** 'app' = the web chat: no Telegram source message, activity via 'app' for fallbacks. */
  origin: CreationOrigin;
  /** Telegram chat of the group (defaults to group.telegramGroupId). */
  chatId?: number;
  /** Activity-log channel for every row written here (default: 'ai' / 'app' / 'bot' by origin and source). */
  activityVia?: TaskActivityVia;
}

export interface CreatedTask {
  task: ITask;
  assignee: IUser | null;
}

export type CreateTasksResult =
  | {
      status: 'created';
      created: CreatedTask[];
      /** Same tasks as `created`, in order. */
      tasks: ITask[];
      /** Plain text (not escaped). */
      warnings: string[];
      batchId: string;
      source: 'ai' | 'fallback';
    }
  /** multiMessage only: the group AI limit was hit (`message` says how long to wait). */
  | { status: 'rate_limited'; message: string }
  /** multiMessage only: the AI found no action items. */
  | { status: 'no_items' }
  | { status: 'save_failed' };
