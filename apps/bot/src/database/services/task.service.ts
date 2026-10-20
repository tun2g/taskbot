import { TASK_PRIORITY_ORDER, TASK_STATUS_ORDER, TASK_TYPE_ORDER } from '@tbot/shared';
import mongoose from 'mongoose';
import { ISourceMessage, ITask, Task } from 'src/database/models/task.model';
import { User } from 'src/database/models/user.model';
import { groupService } from 'src/database/services/group.service';
import { TASK_POPULATE, TASK_POPULATE_FULL } from 'src/database/services/task-populate';
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
  epicId?: mongoose.Types.ObjectId | null;
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
  /** An epic id, or `null` for tasks without an epic. */
  epicId?: mongoose.Types.ObjectId | null;
  /** Due date on or after this instant (inclusive). */
  dueFrom?: Date;
  /** Due date strictly before this instant (exclusive). */
  dueTo?: Date;
  /** Only tasks without a due date (ignores dueFrom / dueTo). */
  dueNone?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  /** Order by this field (empty values last); default is newest first. Ties: newest task first. */
  sort?: TaskSortKey;
  dir?: 'asc' | 'desc';
}

export const TASK_SORT_KEYS = ['type', 'key', 'summary', 'status', 'priority', 'assignee', 'due'] as const;
export type TaskSortKey = (typeof TASK_SORT_KEYS)[number];

/** Page size when the caller doesn't pass one. */
export const DEFAULT_TASK_PAGE_SIZE = 50;

/**
 * Default list order. `_id` breaks createdAt ties (bulk-created tasks share a timestamp),
 * so skip/limit pages never skip or repeat a task.
 */
export const TASK_LIST_SORT = { createdAt: -1, _id: -1 } as const;

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
      return await Task.findById(taskId).populate(TASK_POPULATE_FULL);
    } catch (error) {
      logger.error(`Error getting task ${taskId}: ${error}`);
      return null;
    }
  }

  /** The Mongo match for a group's task filters (shared by the list and the per-status counts). */
  buildTaskQuery(groupId: mongoose.Types.ObjectId, filters: TaskFilters = {}): Record<string, unknown> {
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
    if (filters.epicId !== undefined) query.epicId = filters.epicId;
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
    return query;
  }

  /**
   * One page of a group's tasks. Ordered newest first (createdAt, then _id) unless `sort` is set;
   * `hasMore` is true when later pages exist.
   */
  async getTasksByGroup(
    groupId: mongoose.Types.ObjectId,
    filters: TaskFilters = {},
  ): Promise<{ tasks: ITask[]; total: number; hasMore: boolean }> {
    try {
      const query = this.buildTaskQuery(groupId, filters);

      const page = filters.page || 1;
      const limit = filters.limit || DEFAULT_TASK_PAGE_SIZE;
      const skip = (page - 1) * limit;

      const [tasks, total] = await Promise.all([
        filters.sort
          ? this.findSorted(query, filters.sort, filters.dir ?? 'asc', skip, limit)
          : Task.find(query).populate(TASK_POPULATE).sort(TASK_LIST_SORT).skip(skip).limit(limit),
        Task.countDocuments(query),
      ]);

      return { tasks, total, hasMore: skip + tasks.length < total };
    } catch (error) {
      logger.error(`Error getting tasks for group ${groupId}: ${error}`);
      return { tasks: [], total: 0, hasMore: false };
    }
  }

  /** How many tasks match `filters`, per status (every status key present) and in total. */
  async countTasksByStatus(
    groupId: mongoose.Types.ObjectId,
    filters: TaskFilters = {},
  ): Promise<{ byStatus: Record<string, number>; total: number }> {
    const byStatus = emptyStatusCounts();
    let total = 0;
    try {
      const rows: { _id: string; count: number }[] = await Task.aggregate([
        { $match: this.buildTaskQuery(groupId, filters) },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
      for (const row of rows) {
        byStatus[row._id] = row.count;
        total += row.count;
      }
    } catch (error) {
      logger.error(`Error counting tasks for group ${groupId}: ${error}`);
    }
    return { byStatus, total };
  }

  /**
   * A page ordered by a list column, like the Mini App's list view: enum fields by their display
   * order (not alphabetically), empty values last in either direction, newest task first on ties.
   */
  private async findSorted(
    query: Record<string, unknown>,
    sort: TaskSortKey,
    dir: 'asc' | 'desc',
    skip: number,
    limit: number,
  ): Promise<ITask[]> {
    const order = dir === 'desc' ? -1 : 1;
    const rank = (field: string, values: readonly string[]) => ({ $indexOfArray: [[...values], `$${field}`] });
    const lookup: mongoose.PipelineStage[] = [];
    let key: unknown;
    let isEmpty: unknown = false;
    switch (sort) {
      case 'type':
        key = rank('type', TASK_TYPE_ORDER);
        break;
      case 'status':
        key = rank('status', TASK_STATUS_ORDER);
        break;
      case 'priority':
        key = rank('priority', TASK_PRIORITY_ORDER);
        break;
      case 'key':
        key = '$taskNumber';
        break;
      case 'summary':
        key = { $toLower: '$title' };
        break;
      case 'due':
        key = '$dueDate';
        isEmpty = { $eq: [{ $ifNull: ['$dueDate', null] }, null] };
        break;
      case 'assignee':
        // Same name the app shows: @username, else "First Last".
        lookup.push(
          {
            $lookup: {
              from: User.collection.name,
              localField: 'assigneeId',
              foreignField: '_id',
              as: '_assignee',
              pipeline: [{ $project: { username: 1, firstName: 1, lastName: 1 } }],
            },
          },
          { $set: { _assignee: { $first: '$_assignee' } } },
        );
        key = {
          $toLower: {
            $ifNull: [
              '$_assignee.username',
              {
                $trim: {
                  input: {
                    $concat: [{ $ifNull: ['$_assignee.firstName', ''] }, ' ', { $ifNull: ['$_assignee.lastName', ''] }],
                  },
                },
              },
            ],
          },
        };
        isEmpty = { $eq: [{ $ifNull: ['$_assignee', null] }, null] };
        break;
    }

    const pipeline: mongoose.PipelineStage[] = [
      { $match: query },
      ...lookup,
      { $set: { _sortEmpty: { $cond: [isEmpty, 1, 0] }, _sortKey: key } } as mongoose.PipelineStage.Set,
      { $sort: { _sortEmpty: 1, _sortKey: order, taskNumber: -1, _id: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $unset: ['_sortEmpty', '_sortKey', '_assignee'] },
    ];
    const rows = await Task.aggregate(pipeline);
    const docs = rows.map((row) => Task.hydrate(row));
    return Task.populate(docs, TASK_POPULATE);
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
        TASK_POPULATE,
      );
    } catch (error) {
      logger.error(`Error updating task status ${taskId}: ${error}`);
      return null;
    }
  }

  async updateTask(taskId: string | mongoose.Types.ObjectId, updates: Record<string, unknown>): Promise<ITask | null> {
    try {
      return await Task.findByIdAndUpdate(taskId, { $set: updates }, { new: true, runValidators: true }).populate(
        TASK_POPULATE,
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
      ).populate(TASK_POPULATE);
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
      return await Task.findOne({ groupId, taskNumber }).populate(TASK_POPULATE);
    } catch (error) {
      logger.error(`Error getting task #${taskNumber} in group ${groupId}: ${error}`);
      return null;
    }
  }

  async getTaskByCardMessage(taskCardChatId: number, taskCardMessageId: number): Promise<ITask | null> {
    try {
      return await Task.findOne({ taskCardChatId, taskCardMessageId }).populate(TASK_POPULATE);
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
