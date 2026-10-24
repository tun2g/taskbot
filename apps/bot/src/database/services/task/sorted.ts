import { TASK_PRIORITY_ORDER, TASK_STATUS_ORDER, TASK_TYPE_ORDER } from '@tbot/shared';
import mongoose from 'mongoose';
import { ITask, Task } from 'src/database/models/task.model';
import { User } from 'src/database/models/user.model';
import { TASK_POPULATE } from 'src/database/services/task-populate';
import { TaskSortKey } from 'src/database/services/task/types';

const rank = (field: string, values: readonly string[]) => ({ $indexOfArray: [[...values], `$${field}`] });

/** Same name the app shows: @username, else "First Last". */
function assigneeSort(): { lookup: mongoose.PipelineStage[]; key: unknown; isEmpty: unknown } {
  const lookup: mongoose.PipelineStage[] = [
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
  ];
  const key = {
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
  return { lookup, key, isEmpty: { $eq: [{ $ifNull: ['$_assignee', null] }, null] } };
}

/** The sort key (and "is empty" test, sorted last) of a list column. */
function sortSpec(sort: TaskSortKey): { lookup: mongoose.PipelineStage[]; key: unknown; isEmpty: unknown } {
  switch (sort) {
    case 'type':
      return { lookup: [], key: rank('type', TASK_TYPE_ORDER), isEmpty: false };
    case 'status':
      return { lookup: [], key: rank('status', TASK_STATUS_ORDER), isEmpty: false };
    case 'priority':
      return { lookup: [], key: rank('priority', TASK_PRIORITY_ORDER), isEmpty: false };
    case 'key':
      return { lookup: [], key: '$taskNumber', isEmpty: false };
    case 'summary':
      return { lookup: [], key: { $toLower: '$title' }, isEmpty: false };
    case 'due':
      return { lookup: [], key: '$dueDate', isEmpty: { $eq: [{ $ifNull: ['$dueDate', null] }, null] } };
    case 'assignee':
      return assigneeSort();
  }
  return { lookup: [], key: undefined, isEmpty: false };
}

/**
 * A page ordered by a list column, like the Mini App's list view: enum fields by their display
 * order (not alphabetically), empty values last in either direction, newest task first on ties.
 */
export async function findSorted(
  query: Record<string, unknown>,
  sort: TaskSortKey,
  dir: 'asc' | 'desc',
  skip: number,
  limit: number,
): Promise<ITask[]> {
  const order = dir === 'desc' ? -1 : 1;
  const { lookup, key, isEmpty } = sortSpec(sort);

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
