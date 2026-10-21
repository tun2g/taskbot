import { isClosedStatus } from '@tbot/shared';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';

// Keeps parent cards and subtask links right when the bot changes a task directly
// (card buttons, DM quick actions, /done) instead of going through the task mutation service.
// task-sync / task-mutation are loaded lazily: they import the bot, which imports the commands that use this file.

function refId(ref: unknown): string | null {
  if (!ref) return null;
  const value = ref as { _id?: { toString(): string }; toString(): string };
  return value._id ? value._id.toString() : value.toString();
}

/** A subtask moved between open and closed → re-render its parent's card ("🧩 Subtasks: 2/5 done"). Best effort. */
export async function refreshParentAfterStatus(task: Pick<ITask, 'parentTaskId'>, fromStatus: string, toStatus: string) {
  const parentId = refId(task.parentTaskId);
  if (!parentId || isClosedStatus(fromStatus) === isClosedStatus(toStatus)) return;
  try {
    const parent = await taskService.getTaskById(parentId);
    if (!parent) return;
    const { taskSyncService } = await import('src/shared/services/task-sync.service');
    await taskSyncService.syncTaskCard(parent);
  } catch (error) {
    logger.warn(`Could not refresh parent card ${parentId}: ${error}`);
  }
}

/** After a delete from the bot: log it on the parent and keep a parent's subtasks as regular tasks. Best effort. */
export async function cleanUpSubtasksAfterDelete(task: ITask, actor: IUser): Promise<number> {
  try {
    const { afterTaskDeleted } = await import('src/shared/services/task-mutation/subtasks');
    const detached = await afterTaskDeleted(task, actor, { activity: 'bot' });
    return detached.length;
  } catch (error) {
    logger.warn(`Subtask cleanup after deleting #${task.taskNumber} failed: ${error}`);
    return 0;
  }
}
