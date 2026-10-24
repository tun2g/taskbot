import mongoose from 'mongoose';
import { ITaskActivity, TaskActivity, TaskActivityVia } from 'src/database/models/task-activity.model';
import logger from 'src/shared/logger/logger';

export interface RecordActivityInput {
  taskId: mongoose.Types.ObjectId | string;
  groupId: mongoose.Types.ObjectId | string;
  actor?: mongoose.Types.ObjectId | string | null;
  /** created | status | assignee | priority | type | title | description | due_date | epic | deleted */
  action: string;
  from?: string | null;
  to?: string | null;
  via: TaskActivityVia;
}

export class TaskActivityService {
  /** Never throws — a failed audit write must not break the user's action. */
  async record(input: RecordActivityInput): Promise<void> {
    try {
      await TaskActivity.create(input);
    } catch (error) {
      logger.error(`Error recording task activity (${input.action}) for ${input.taskId}: ${error}`);
    }
  }

  /** Several entries in one write (e.g. every task of an undone batch). Never throws, like `record`. */
  async recordMany(inputs: RecordActivityInput[]): Promise<void> {
    if (!inputs.length) return;
    try {
      await TaskActivity.insertMany(inputs, { ordered: false });
    } catch (error) {
      logger.error(`Error recording ${inputs.length} task activities (${inputs[0].action}): ${error}`);
    }
  }

  async getForTask(taskId: mongoose.Types.ObjectId | string): Promise<ITaskActivity[]> {
    try {
      return await TaskActivity.find({ taskId }).populate('actor').sort({ createdAt: 1 });
    } catch (error) {
      logger.error(`Error getting activity for task ${taskId}: ${error}`);
      return [];
    }
  }
}

export const taskActivityService = new TaskActivityService();
