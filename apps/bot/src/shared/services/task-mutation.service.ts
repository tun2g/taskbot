import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { MutationChannel } from 'src/shared/services/task-mutation/common';
import { createTask } from 'src/shared/services/task-mutation/create';
import { deleteTask } from 'src/shared/services/task-mutation/delete';
import { CreateTaskFields, CreateTaskOptions, UpdateTaskFields } from 'src/shared/services/task-mutation/fields';
import { updateTask } from 'src/shared/services/task-mutation/update';
import type { TaskChange } from 'src/shared/services/task-sync.service';

// The one place where a task is created / changed / deleted on behalf of a person from outside the chat
// (the REST API for the Mini App, the MCP server). Every caller gets the same validation, activity log,
// DMs to assignees and group card / change line. The steps live in ./task-mutation/ (create, update,
// delete); subtask rules in ./task-mutation/subtasks.

export {
  APP_CHANNEL,
  ASSIGNEE_NOT_MEMBER_MESSAGE,
  DELETE_FORBIDDEN_MESSAGE,
  EPIC_NOT_IN_GROUP_MESSAGE,
  refId,
  TASK_GONE_MESSAGE,
  TaskMutationError,
} from 'src/shared/services/task-mutation/common';
export type { MutationChannel, TaskMutationErrorCode } from 'src/shared/services/task-mutation/common';
export type { CreateTaskFields, CreateTaskOptions, UpdateTaskFields } from 'src/shared/services/task-mutation/fields';

export class TaskMutationService {
  /**
   * Creates a task in the group: validates assignee / epic, records "created", DMs the assignee and (by default)
   * posts the card to the group.
   */
  createTask(
    group: IGroup,
    actor: IUser,
    data: CreateTaskFields,
    options: CreateTaskOptions = {},
  ): Promise<{ task: ITask; assignee: IUser | null }> {
    return createTask(group, actor, data, options);
  }

  /**
   * Applies only the fields that actually changed (activity log, DMs, card, change line). Returns `before`
   * untouched (and `changes` empty) when nothing changed.
   */
  updateTask(
    before: ITask,
    actor: IUser,
    data: UpdateTaskFields,
    channel?: MutationChannel,
  ): Promise<{ task: ITask; changes: TaskChange[] }> {
    return updateTask(before, actor, data, channel);
  }

  /** Deletes a task — its creator or a Telegram admin of the group only. Detached subtasks are returned. */
  deleteTask(
    task: ITask,
    actor: IUser,
    options: { group?: IGroup | null; channel?: MutationChannel } = {},
  ): Promise<{ detached: ITask[] }> {
    return deleteTask(task, actor, options);
  }
}

export const taskMutationService = new TaskMutationService();
