import mongoose from 'mongoose';
import { StatsDaily } from 'src/database/models/stats-daily.model';
import { aggregateDay } from 'src/shared/services/stats/daily-stats/aggregate-day';
import { dayRange, NO_GROUP } from 'src/shared/services/stats/daily-stats/days';
import { buildDailyRows, DailyRow } from 'src/shared/services/stats/daily-stats/rows';
import { aggregateTaskCounts } from 'src/shared/services/stats/daily-stats/task-counts';

const toObjectId = (id: string | null) => (id ? new mongoose.Types.ObjectId(id) : null);

/** Recomputes one day (idempotent: re-running overwrites the day's rows). Returns the rows written. */
export async function rollupDay(day: string): Promise<DailyRow[]> {
  const rows = buildDailyRows(day, await aggregateDay(day));
  await StatsDaily.bulkWrite(
    rows.map((r) => ({
      updateOne: {
        filter: { day, groupId: toObjectId(r.groupId) },
        update: { $set: { ...r, groupId: toObjectId(r.groupId) } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return rows;
}

/**
 * One-off history: tasksCreated / tasksCompleted for every past day from tasks + task_activities. Merges only
 * those two fields, so days that already have rows from real tracking keep their other numbers; new rows get
 * zeros elsewhere (schema defaults).
 */
export async function backfillTaskStats(before?: string): Promise<{ days: number; rows: number }> {
  const counts = await aggregateTaskCounts(before ? { end: dayRange(before).start } : {});
  const ops: Parameters<typeof StatsDaily.bulkWrite>[0] = [];
  const days = Object.keys(counts).sort();
  for (const day of days) {
    let created = 0;
    let completed = 0;
    for (const [group, c] of Object.entries(counts[day])) {
      created += c.created;
      completed += c.completed;
      if (group === NO_GROUP) continue;
      ops.push(backfillOp(day, toObjectId(group), c.created, c.completed));
    }
    ops.push(backfillOp(day, null, created, completed));
  }
  for (let i = 0; i < ops.length; i += 500) await StatsDaily.bulkWrite(ops.slice(i, i + 500), { ordered: false });
  return { days: days.length, rows: ops.length };
}

function backfillOp(day: string, groupId: mongoose.Types.ObjectId | null, tasksCreated: number, tasksCompleted: number) {
  return {
    updateOne: {
      filter: { day, groupId },
      update: { $set: { tasksCreated, tasksCompleted } },
      upsert: true,
    },
  };
}
