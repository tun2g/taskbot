import { TASK_STATUS_ORDER } from '@tbot/shared';
import mongoose from 'mongoose';
import { ISourceMessage, ITask, Task } from 'src/database/models/task.model';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';

export interface CreateTaskData {
  groupId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  createdBy: mongoose.Types.ObjectId;
  assigneeId?: mongoose.Types.ObjectId;
  dueDate?: Date;
  sourceMessage?: ISourceMessage;
  sourceMessages?: ISourceMessage[];
  batchId?: string;
  taskCardChatId?: number;
}

export interface TaskFilters {
  status?: string;
  /** Match any of these statuses (category / open filters); combined with `status` if both are set. */
  statuses?: string[];
  type?: string;
  /** `null` matches unassigned tasks. */
  assigneeId?: mongoose.Types.ObjectId | null;
  priority?: string;
  /** Due date on or after this instant (inclusive). */
  dueFrom?: Date;
  /** Due date strictly before this instant (exclusive). */
  dueTo?: Date;
  /** Only tasks without a due date (ignores dueFrom / dueTo). */
  dueNone?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export class TaskService {
  async createTask(data: CreateTaskData): Promise<ITask> {
    const taskNumber = await groupService.incrementTaskCounter(data.groupId);

    const task = await Task.create({
      ...data,
      taskNumber,
      status: 'todo',
      type: data.type || 'task',
      priority: data.priority || 'medium',
    });

    logger.info(`Task #${taskNumber} created in group ${data.groupId}`);
    return task;
  }

  async getTaskById(taskId: string | mongoose.Types.ObjectId): Promise<ITask | null> {
    try {
      return await Task.findById(taskId).populate('createdBy assigneeId completedBy');
    } catch (error) {
      logger.error(`Error getting task ${taskId}: ${error}`);
      return null;
    }
  }

  async getTasksByGroup(
    groupId: mongoose.Types.ObjectId,
    filters: TaskFilters = {},
  ): Promise<{ tasks: ITask[]; total: number }> {
    try {
      const query: Record<string, unknown> = { groupId };

      if (filters.status && filters.statuses) {
        query.status = filters.statuses.includes(filters.status) ? filters.status : { $in: [] };
      } else if (filters.status) {
        query.status = filters.status;
      } else if (filters.statuses) {
        query.status = { $in: filters.statuses };
      }
      if (filters.type) query.type = filters.type;
      if (filters.assigneeId !== undefined) query.assigneeId = filters.assigneeId;
      if (filters.priority) query.priority = filters.priority;
      if (filters.dueNone) {
        query.dueDate = null;
      } else if (filters.dueFrom || filters.dueTo) {
        const range: Record<string, Date | null> = { $ne: null };
        if (filters.dueFrom) range.$gte = filters.dueFrom;
        if (filters.dueTo) range.$lt = filters.dueTo;
        query.dueDate = range;
      }
      if (filters.search) {
        const search = filters.search.trim();
        const numberMatch = search.match(/^#?(\d+)$/);
        const pattern = { $regex: escapeRegex(search), $options: 'i' };
        query.$or = [
          { title: pattern },
          { description: pattern },
          ...(numberMatch ? [{ taskNumber: parseInt(numberMatch[1], 10) }] : []),
        ];
      }

      const page = filters.page || 1;
      const limit = filters.limit || 50;
      const skip = (page - 1) * limit;

      const [tasks, total] = await Promise.all([
        Task.find(query).populate('createdBy assigneeId').sort({ createdAt: -1 }).skip(skip).limit(limit),
        Task.countDocuments(query),
      ]);

      return { tasks, total };
    } catch (error) {
      logger.error(`Error getting tasks for group ${groupId}: ${error}`);
      return { tasks: [], total: 0 };
    }
  }

  async updateTaskStatus(
    taskId: string | mongoose.Types.ObjectId,
    status: string,
    changedBy?: mongoose.Types.ObjectId,
  ): Promise<ITask | null> {
    try {
      const updateData: Record<string, unknown> = { status };

      if (status === 'done') {
        updateData.completedAt = new Date();
        updateData.completedBy = changedBy ?? null;
      } else {
        updateData.completedAt = null;
        updateData.completedBy = null;
      }

      return await Task.findByIdAndUpdate(taskId, { $set: updateData }, { new: true, runValidators: true }).populate(
        'createdBy assigneeId',
      );
    } catch (error) {
      logger.error(`Error updating task status ${taskId}: ${error}`);
      return null;
    }
  }

  async updateTask(taskId: string | mongoose.Types.ObjectId, updates: Record<string, unknown>): Promise<ITask | null> {
    try {
      return await Task.findByIdAndUpdate(taskId, { $set: updates }, { new: true, runValidators: true }).populate(
        'createdBy assigneeId',
      );
    } catch (error) {
      logger.error(`Error updating task ${taskId}: ${error}`);
      return null;
    }
  }

  async assignTask(
    taskId: string | mongoose.Types.ObjectId,
    assigneeId: mongoose.Types.ObjectId | null,
  ): Promise<ITask | null> {
    try {
      return await Task.findByIdAndUpdate(
        taskId,
        { $set: { assigneeId } },
        { new: true, runValidators: true },
      ).populate('createdBy assigneeId');
    } catch (error) {
      logger.error(`Error assigning task ${taskId}: ${error}`);
      return null;
    }
  }

  async deleteTask(taskId: string | mongoose.Types.ObjectId): Promise<boolean> {
    try {
      const result = await Task.findByIdAndDelete(taskId);
      return !!result;
    } catch (error) {
      logger.error(`Error deleting task ${taskId}: ${error}`);
      return false;
    }
  }

  async getTasksByBatch(batchId: string): Promise<ITask[]> {
    try {
      return await Task.find({ batchId }).sort({ taskNumber: 1 });
    } catch (error) {
      logger.error(`Error getting tasks for batch ${batchId}: ${error}`);
      return [];
    }
  }

  async deleteTasks(taskIds: (string | mongoose.Types.ObjectId)[]): Promise<number> {
    try {
      const result = await Task.deleteMany({ _id: { $in: taskIds } });
      return result.deletedCount ?? 0;
    } catch (error) {
      logger.error(`Error deleting tasks ${taskIds.join(',')}: ${error}`);
      return 0;
    }
  }

  async getTaskStats(groupId: mongoose.Types.ObjectId): Promise<Record<string, number>> {
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

  async getTaskByNumber(groupId: mongoose.Types.ObjectId, taskNumber: number): Promise<ITask | null> {
    try {
      return await Task.findOne({ groupId, taskNumber }).populate('createdBy assigneeId');
    } catch (error) {
      logger.error(`Error getting task #${taskNumber} in group ${groupId}: ${error}`);
      return null;
    }
  }

  async getTaskByCardMessage(taskCardChatId: number, taskCardMessageId: number): Promise<ITask | null> {
    try {
      return await Task.findOne({ taskCardChatId, taskCardMessageId }).populate('createdBy assigneeId');
    } catch (error) {
      logger.error(`Error getting task by card message ${taskCardMessageId}: ${error}`);
      return null;
    }
  }
}

export const taskService = new TaskService();

function emptyStatusCounts(): Record<string, number> {
  return Object.fromEntries(TASK_STATUS_ORDER.map((status) => [status, 0]));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
