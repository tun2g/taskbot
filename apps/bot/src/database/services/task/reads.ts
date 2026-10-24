import mongoose from 'mongoose';
import { ITask, Task } from 'src/database/models/task.model';
import { TASK_POPULATE, TASK_POPULATE_FULL } from 'src/database/services/task-populate';
import { emptyStatusCounts } from 'src/database/services/task/query';
import logger from 'src/shared/logger/logger';

export async function getTaskById(taskId: string | mongoose.Types.ObjectId): Promise<ITask | null> {
  try {
    return await Task.findById(taskId).populate(TASK_POPULATE_FULL);
  } catch (error) {
    logger.error(`Error getting task ${taskId}: ${error}`);
    return null;
  }
}

export async function getTasksByBatch(batchId: string): Promise<ITask[]> {
  try {
    return await Task.find({ batchId }).sort({ taskNumber: 1 });
  } catch (error) {
    logger.error(`Error getting tasks for batch ${batchId}: ${error}`);
    return [];
  }
}

export async function getTaskStats(groupId: mongoose.Types.ObjectId): Promise<Record<string, number>> {
  try {
    const stats = await Task.aggregate([{ $match: { groupId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);

    // Every status key is present (0 when empty) so callers can sum/display without guards
    const result: Record<string, number> = emptyStatusCounts();
    for (const stat of stats) {
      result[stat._id] = stat.count;
    }
    return result;
  } catch (error) {
    logger.error(`Error getting task stats for group ${groupId}: ${error}`);
    return emptyStatusCounts();
  }
}

export async function getTaskByNumber(groupId: mongoose.Types.ObjectId, taskNumber: number): Promise<ITask | null> {
  try {
    return await Task.findOne({ groupId, taskNumber }).populate(TASK_POPULATE);
  } catch (error) {
    logger.error(`Error getting task #${taskNumber} in group ${groupId}: ${error}`);
    return null;
  }
}

export async function getTaskByCardMessage(taskCardChatId: number, taskCardMessageId: number): Promise<ITask | null> {
  try {
    return await Task.findOne({ taskCardChatId, taskCardMessageId }).populate(TASK_POPULATE);
  } catch (error) {
    logger.error(`Error getting task by card message ${taskCardMessageId}: ${error}`);
    return null;
  }
}
