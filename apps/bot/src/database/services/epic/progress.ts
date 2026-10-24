import { EpicColor, getStatusCategory, TaskStatus, TaskStatusCategory } from '@tbot/shared';
import mongoose from 'mongoose';
import { Epic, IEpic } from 'src/database/models/epic.model';
import { Task } from 'src/database/models/task.model';
import {
  emptyProgress,
  EpicProgress,
  EpicWithProgress,
  pickLeastUsedColor,
} from 'src/database/services/epic/types';

/**
 * Task counts per epic: `total` excludes cancelled tasks, `done` = done category, `inProgress` = in-progress
 * category, `cancelled` = cancelled tasks still in the epic. Optionally limited to some epics.
 */
export async function aggregateEpicProgress(
  groupId: mongoose.Types.ObjectId,
  epicIds?: mongoose.Types.ObjectId[],
): Promise<Map<string, EpicProgress>> {
  const result = new Map<string, EpicProgress>();
  const rows: { _id: { epicId: mongoose.Types.ObjectId; status: string }; count: number }[] = await Task.aggregate([
    {
      $match: {
        groupId,
        epicId: epicIds ? { $in: epicIds } : { $ne: null },
      },
    },
    { $group: { _id: { epicId: '$epicId', status: '$status' }, count: { $sum: 1 } } },
  ]);

  for (const row of rows) {
    const key = String(row._id.epicId);
    const progress = result.get(key) ?? emptyProgress();
    result.set(key, progress);
    if (row._id.status === TaskStatus.CANCELLED) {
      progress.cancelled += row.count;
      continue;
    }
    progress.total += row.count;
    const category = getStatusCategory(row._id.status);
    if (category === TaskStatusCategory.DONE) progress.done += row.count;
    else if (category === TaskStatusCategory.IN_PROGRESS) progress.inProgress += row.count;
    result.set(key, progress);
  }
  return result;
}

/** The epic as a plain object with its progress (zeroes when it has no tasks). */
export function withProgress(epic: IEpic, progress?: EpicProgress): EpicWithProgress {
  const plain = typeof epic.toObject === 'function' ? epic.toObject() : (epic as unknown as Record<string, unknown>);
  return { ...plain, _id: epic._id as mongoose.Types.ObjectId, progress: progress ?? emptyProgress() };
}

/** The group's least-used epic color (for a new epic without one). */
export async function leastUsedColor(groupId: mongoose.Types.ObjectId): Promise<EpicColor> {
  const rows: { _id: string; count: number }[] = await Epic.aggregate([
    { $match: { groupId } },
    { $group: { _id: '$color', count: { $sum: 1 } } },
  ]);
  return pickLeastUsedColor(Object.fromEntries(rows.map((r) => [r._id, r.count])));
}
