import { TaskActivity } from 'src/database/models/task-activity.model';
import { Task } from 'src/database/models/task.model';
import { DONE_ACTIVITY_VALUES, keyOf } from 'src/shared/services/stats/daily-stats/days';

/** Tasks created / completed per group (and per day when `byDay`), from tasks + the activity log. */
export async function aggregateTaskCounts(range: { start?: Date; end?: Date } = {}) {
  const createdAt: Record<string, Date> = {};
  if (range.start) createdAt.$gte = range.start;
  if (range.end) createdAt.$lt = range.end;
  const when = Object.keys(createdAt).length ? { createdAt } : {};
  const byDayGroup = { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, g: '$groupId' };

  const [tasks, createdActs, doneActs] = await Promise.all([
    Task.aggregate<{ _id: { day: string; g: unknown }; n: number }>([
      { $match: when },
      { $group: { _id: byDayGroup, n: { $sum: 1 } } },
    ]),
    TaskActivity.aggregate<{ _id: { day: string; g: unknown }; n: number }>([
      { $match: { ...when, action: 'created' } },
      { $group: { _id: byDayGroup, n: { $sum: 1 } } },
    ]),
    TaskActivity.aggregate<{ _id: { day: string; g: unknown }; n: number }>([
      { $match: { ...when, action: 'status', to: { $in: DONE_ACTIVITY_VALUES } } },
      { $group: { _id: byDayGroup, n: { $sum: 1 } } },
    ]),
  ]);
  return mergeTaskCounts(tasks, createdActs, doneActs);
}

type DayGroupCount = { _id: { day: string; g: unknown }; n: number };

/**
 * Pure: day → group → { created, completed }. "Created" is the larger of the tasks that still exist and the
 * "created" log entries (deleted tasks only survive in the log; tasks older than the log only in `tasks`).
 */
export function mergeTaskCounts(tasks: DayGroupCount[], createdActs: DayGroupCount[], doneActs: DayGroupCount[]) {
  const out: Record<string, Record<string, { created: number; completed: number }>> = {};
  const cell = (day: string, g: unknown) => {
    const byGroup = (out[day] ??= {});
    return (byGroup[keyOf(g)] ??= { created: 0, completed: 0 });
  };
  for (const t of tasks) cell(t._id.day, t._id.g).created = t.n;
  for (const a of createdActs) {
    const c = cell(a._id.day, a._id.g);
    c.created = Math.max(c.created, a.n);
  }
  for (const d of doneActs) cell(d._id.day, d._id.g).completed = d.n;
  return out;
}
