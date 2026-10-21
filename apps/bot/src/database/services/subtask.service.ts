import { TaskStatus } from '@tbot/shared';
import mongoose from 'mongoose';
import { ITask, Task } from 'src/database/models/task.model';
import { TASK_POPULATE } from 'src/database/services/task-populate';
import logger from 'src/shared/logger/logger';

type Id = string | mongoose.Types.ObjectId;

/** Cancelled subtasks are left out of `total` / `done` ("2/4 done") and counted on their own. */
export interface SubtaskProgress {
  /** Every subtask except cancelled ones. */
  total: number;
  done: number;
  cancelled: number;
}

/** Reads and bulk writes on a parent's subtasks (one level: a subtask never has subtasks). */
export class SubtaskService {
  /** A parent's subtasks, oldest first (the order they were added). */
  async list(parentTaskId: Id): Promise<ITask[]> {
    try {
      return await Task.find({ parentTaskId }).populate(TASK_POPULATE).sort({ taskNumber: 1 });
    } catch (error) {
      logger.error(`Error getting subtasks of ${parentTaskId}: ${error}`);
      return [];
    }
  }

  async count(parentTaskId: Id): Promise<number> {
    try {
      return await Task.countDocuments({ parentTaskId });
    } catch (error) {
      logger.error(`Error counting subtasks of ${parentTaskId}: ${error}`);
      return 0;
    }
  }

  /** `{ total, done, cancelled }` per parent id, in one aggregate for a whole page. Parents without subtasks are absent. */
  async progress(parentTaskIds: Id[]): Promise<Map<string, SubtaskProgress>> {
    const result = new Map<string, SubtaskProgress>();
    if (parentTaskIds.length === 0) return result;
    try {
      const ids = parentTaskIds.map((id) => new mongoose.Types.ObjectId(String(id)));
      const isStatus = (status: TaskStatus) => ({ $cond: [{ $eq: ['$status', status] }, 1, 0] });
      const rows: { _id: mongoose.Types.ObjectId; all: number; done: number; cancelled: number }[] =
        await Task.aggregate([
          { $match: { parentTaskId: { $in: ids } } },
          {
            $group: {
              _id: '$parentTaskId',
              all: { $sum: 1 },
              done: { $sum: isStatus(TaskStatus.DONE) },
              cancelled: { $sum: isStatus(TaskStatus.CANCELLED) },
            },
          },
        ]);
      for (const row of rows) {
        result.set(String(row._id), { total: row.all - row.cancelled, done: row.done, cancelled: row.cancelled });
      }
    } catch (error) {
      logger.error(`Error getting subtask progress: ${error}`);
    }
    return result;
  }

  /** Turns every subtask of the parent back into a regular task; returns the ones that were detached. */
  async detachAll(parentTaskId: Id): Promise<ITask[]> {
    try {
      const children = await Task.find({ parentTaskId }).sort({ taskNumber: 1 });
      if (children.length > 0) await Task.updateMany({ parentTaskId }, { $set: { parentTaskId: null } });
      return children;
    } catch (error) {
      logger.error(`Error detaching subtasks of ${parentTaskId}: ${error}`);
      return [];
    }
  }

  /** Moves every subtask of the parent into `epicId`; returns how many moved. */
  async setEpic(parentTaskId: Id, epicId: mongoose.Types.ObjectId | null): Promise<number> {
    try {
      const result = await Task.updateMany({ parentTaskId }, { $set: { epicId } });
      return result.modifiedCount ?? 0;
    } catch (error) {
      logger.error(`Error moving subtasks of ${parentTaskId} to epic ${epicId}: ${error}`);
      return 0;
    }
  }
}

export const subtaskService = new SubtaskService();
