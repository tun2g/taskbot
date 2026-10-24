import mongoose from 'mongoose';
import { ITask, Task } from 'src/database/models/task.model';
import { TASK_POPULATE } from 'src/database/services/task-populate';
import { buildTaskQuery, emptyStatusCounts } from 'src/database/services/task/query';
import * as reads from 'src/database/services/task/reads';
import { findSorted } from 'src/database/services/task/sorted';
import {
  CreateTaskData,
  DEFAULT_TASK_PAGE_SIZE,
  TASK_LIST_SORT,
  TaskFilters,
  TaskSortKey,
} from 'src/database/services/task/types';
import * as writes from 'src/database/services/task/writes';
import logger from 'src/shared/logger/logger';

export {
  DEFAULT_TASK_PAGE_SIZE,
  TASK_LIST_SORT,
  TASK_SORT_KEYS,
  type CreateTaskData,
  type TaskFilters,
  type TaskSortKey,
} from 'src/database/services/task/types';

type TaskId = string | mongoose.Types.ObjectId;

export class TaskService {
  createTask(data: CreateTaskData): Promise<ITask> {
    return writes.createTask(data);
  }

  getTaskById(taskId: TaskId): Promise<ITask | null> {
    return reads.getTaskById(taskId);
  }

  /** The Mongo match for a group's task filters (shared by the list and the per-status counts). */
  buildTaskQuery(groupId: mongoose.Types.ObjectId, filters: TaskFilters = {}): Record<string, unknown> {
    return buildTaskQuery(groupId, filters);
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

  /**
   * How many tasks match `filters`: per status (every status key present), per assignee id (`"none"` =
   * unassigned) and in total.
   */
  async countTasksByStatus(
    groupId: mongoose.Types.ObjectId,
    filters: TaskFilters = {},
  ): Promise<{ byStatus: Record<string, number>; byAssignee: Record<string, number>; total: number }> {
    const byStatus = emptyStatusCounts();
    const byAssignee: Record<string, number> = {};
    let total = 0;
    try {
      const rows: { _id: { status: string; assigneeId: mongoose.Types.ObjectId | null }; count: number }[] =
        await Task.aggregate([
          { $match: this.buildTaskQuery(groupId, filters) },
          { $group: { _id: { status: '$status', assigneeId: '$assigneeId' }, count: { $sum: 1 } } },
        ]);
      for (const row of rows) {
        byStatus[row._id.status] = (byStatus[row._id.status] ?? 0) + row.count;
        const who = row._id.assigneeId ? String(row._id.assigneeId) : 'none';
        byAssignee[who] = (byAssignee[who] ?? 0) + row.count;
        total += row.count;
      }
    } catch (error) {
      logger.error(`Error counting tasks for group ${groupId}: ${error}`);
    }
    return { byStatus, byAssignee, total };
  }

  private findSorted(
    query: Record<string, unknown>,
    sort: TaskSortKey,
    dir: 'asc' | 'desc',
    skip: number,
    limit: number,
  ): Promise<ITask[]> {
    return findSorted(query, sort, dir, skip, limit);
  }

  updateTaskStatus(taskId: TaskId, status: string, changedBy?: mongoose.Types.ObjectId): Promise<ITask | null> {
    return writes.updateTaskStatus(taskId, status, changedBy);
  }

  updateTask(taskId: TaskId, updates: Record<string, unknown>): Promise<ITask | null> {
    return writes.updateTask(taskId, updates);
  }

  assignTask(taskId: TaskId, assigneeId: mongoose.Types.ObjectId | null): Promise<ITask | null> {
    return writes.assignTask(taskId, assigneeId);
  }

  deleteTask(taskId: TaskId): Promise<boolean> {
    return writes.deleteTask(taskId);
  }

  getTasksByBatch(batchId: string): Promise<ITask[]> {
    return reads.getTasksByBatch(batchId);
  }

  deleteTasks(taskIds: TaskId[]): Promise<number> {
    return writes.deleteTasks(taskIds);
  }

  getTaskStats(groupId: mongoose.Types.ObjectId): Promise<Record<string, number>> {
    return reads.getTaskStats(groupId);
  }

  getTaskByNumber(groupId: mongoose.Types.ObjectId, taskNumber: number): Promise<ITask | null> {
    return reads.getTaskByNumber(groupId, taskNumber);
  }

  getTaskByCardMessage(taskCardChatId: number, taskCardMessageId: number): Promise<ITask | null> {
    return reads.getTaskByCardMessage(taskCardChatId, taskCardMessageId);
  }
}

export const taskService = new TaskService();
