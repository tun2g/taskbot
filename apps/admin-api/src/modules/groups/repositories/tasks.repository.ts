import { Epic, Task, TaskActivity } from '@tbot/db';
import type { AdminTaskVia } from '@tbot/shared';
import { Types } from 'mongoose';
import type { Pagination } from 'src/shared/http';
import { CLOSED_STATUSES } from 'src/stats/queries';

/** The only task fields the admin API reads: never descriptions or source message text. */
export const TASK_FIELDS = 'taskNumber title status assigneeId dueDate createdAt completedAt parentTaskId epicId';

export interface LeanTaskRow {
  _id: Types.ObjectId;
  taskNumber: number;
  title: string;
  status: string;
  assigneeId?: Types.ObjectId | null;
  dueDate?: Date | null;
  createdAt: Date;
  completedAt?: Date | null;
  parentTaskId?: Types.ObjectId | null;
  epicId?: Types.ObjectId | null;
}

export interface LeanEpicRow {
  _id: Types.ObjectId;
  title: string;
  status: string;
  createdAt: Date;
}

export function findTasks(
  match: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
  p: Pagination,
): Promise<LeanTaskRow[]> {
  return Task.find(match).select(TASK_FIELDS).sort(sort).skip(p.skip).limit(p.limit).lean<LeanTaskRow[]>();
}

export function countTasks(match: Record<string, unknown>): Promise<number> {
  return Task.countDocuments(match);
}

export async function findTaskNumbers(ids: Types.ObjectId[]): Promise<{ _id: Types.ObjectId; taskNumber: number }[]> {
  return ids.length
    ? Task.find({ _id: { $in: ids } })
        .select('taskNumber')
        .lean<{ _id: Types.ObjectId; taskNumber: number }[]>()
    : [];
}

export async function findEpicTitles(ids: Types.ObjectId[]): Promise<{ _id: Types.ObjectId; title: string }[]> {
  return ids.length
    ? Epic.find({ _id: { $in: ids } })
        .select('title')
        .lean<{ _id: Types.ObjectId; title: string }[]>()
    : [];
}

/** Where each task was created (from its "created" activity). */
export async function findCreatedVia(
  taskIds: Types.ObjectId[],
): Promise<{ taskId: Types.ObjectId; via: AdminTaskVia }[]> {
  return taskIds.length
    ? TaskActivity.find({ taskId: { $in: taskIds }, action: 'created' })
        .select('taskId via')
        .lean<{ taskId: Types.ObjectId; via: AdminTaskVia }[]>()
    : [];
}

export function countEpics(groupId: Types.ObjectId): Promise<number> {
  return Epic.countDocuments({ groupId });
}

/** One page of the group's epics, open first. */
export function findEpics(groupId: Types.ObjectId, p: Pagination): Promise<LeanEpicRow[]> {
  return (
    Epic.find({ groupId })
      .select('title status createdAt')
      // 'open' sorts after 'done' alphabetically: descending puts open epics first.
      .sort({ status: -1, createdAt: -1, _id: -1 })
      .skip(p.skip)
      .limit(p.limit)
      .lean<LeanEpicRow[]>()
  );
}

/** Tasks / open tasks per epic. */
export async function epicTaskCounts(
  groupId: Types.ObjectId,
  epicIds: Types.ObjectId[],
): Promise<Map<string, { tasks: number; open: number }>> {
  const counts = epicIds.length
    ? await Task.aggregate([
        { $match: { groupId, epicId: { $in: epicIds } } },
        {
          $group: {
            _id: '$epicId',
            tasks: { $sum: 1 },
            open: { $sum: { $cond: [{ $in: ['$status', CLOSED_STATUSES] }, 0, 1] } },
          },
        },
      ])
    : [];
  return new Map(counts.map((c) => [String(c._id), c as { tasks: number; open: number }]));
}
