import { getStatusCategory, TaskStatus, TaskStatusCategory } from '@tbot/shared';
import mongoose from 'mongoose';
import { IEpic } from 'src/database/models/epic.model';
import { Task } from 'src/database/models/task.model';
import logger from 'src/shared/logger/logger';

/**
 * Ids of the tasks in an epic (e.g. to refresh their cards after a rename) — open tasks first, so a capped card
 * refresh reaches the cards people still look at.
 */
export async function epicTaskIds(epic: IEpic): Promise<mongoose.Types.ObjectId[]> {
  const tasks: { _id: mongoose.Types.ObjectId; status?: string }[] = await Task.find(
    { groupId: epic.groupId, epicId: epic._id },
    { _id: 1, status: 1 },
  );
  const isClosed = (status?: string) =>
    status === TaskStatus.CANCELLED || getStatusCategory(status ?? '') === TaskStatusCategory.DONE;
  return [...tasks]
    .sort((a, b) => Number(isClosed(a.status)) - Number(isClosed(b.status)))
    .map((t) => t._id as mongoose.Types.ObjectId);
}

/**
 * Put tasks (back) into an epic — only tasks of the epic's group that are in no epic now, so an undo never steals
 * a task someone has since moved elsewhere. Returns the ids actually linked.
 */
export async function linkEpicTasks(epic: IEpic, taskIds: string[]): Promise<mongoose.Types.ObjectId[]> {
  const ids = [...new Set(taskIds)].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (ids.length === 0) return [];
  const filter = { _id: { $in: ids }, groupId: epic.groupId, epicId: null };
  const tasks = await Task.find(filter, { _id: 1 });
  const linked = tasks.map((t) => t._id as mongoose.Types.ObjectId);
  if (linked.length === 0) return [];
  await Task.updateMany({ ...filter, _id: { $in: linked } }, { $set: { epicId: epic._id } });
  logger.info(`Epic "${epic.title}": ${linked.length} task(s) linked back in group ${epic.groupId}`);
  return linked;
}
