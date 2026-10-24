import { PipelineStage } from 'mongoose';
import { AiCall } from 'src/database/models/ai-call.model';
import { UsageEvent } from 'src/database/models/usage-event.model';
import { dayRange, keyOf } from 'src/shared/services/stats/daily-stats/days';
import { AiTotals, DayAggregates } from 'src/shared/services/stats/daily-stats/rows';
import { aggregateTaskCounts } from 'src/shared/services/stats/daily-stats/task-counts';

type Id = { _id: unknown };

/** Everything `buildDailyRows` needs for one UTC day. */
export async function aggregateDay(day: string): Promise<DayAggregates> {
  const { start, end } = dayRange(day);
  const inDay = { createdAt: { $gte: start, $lt: end } };

  const usagePipeline: PipelineStage[] = [
    { $match: inDay },
    { $group: { _id: { g: '$groupId', k: '$kind', c: '$channel' }, n: { $sum: 1 } } },
  ];
  const activePerGroup: PipelineStage[] = [
    { $match: { ...inDay, userId: { $ne: null } } },
    { $group: { _id: { g: '$groupId', u: '$userId' } } },
    { $group: { _id: '$_id.g', n: { $sum: 1 } } },
  ];
  const activeTotal: PipelineStage[] = [
    { $match: { ...inDay, userId: { $ne: null } } },
    { $group: { _id: '$userId' } },
    { $count: 'n' },
  ];
  // 'quota' / 'disabled' rows are refusals (daily cap / AI turned off), not provider calls (they show up as rate_limited events).
  const aiPipeline: PipelineStage[] = [
    { $match: { ...inDay, status: { $nin: ['quota', 'disabled'] } } },
    {
      $group: {
        _id: '$groupId',
        calls: { $sum: 1 },
        failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'invalid']] }, 1, 0] } },
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
        costUsd: { $sum: '$costUsd' },
        unpriced: { $sum: { $cond: ['$priced', 0, 1] } },
      },
    },
  ];

  const [usage, perGroup, total, ai, tasks] = await Promise.all([
    UsageEvent.aggregate<{ _id: { g: unknown; k: string; c: string }; n: number }>(usagePipeline),
    UsageEvent.aggregate<Id & { n: number }>(activePerGroup),
    UsageEvent.aggregate<{ n: number }>(activeTotal),
    AiCall.aggregate<Id & Omit<AiTotals, 'group'>>(aiPipeline),
    aggregateTaskCounts({ start, end }),
  ]);

  const taskCells = tasks[day] ?? {};
  return {
    usage: usage.map((u) => ({ group: keyOf(u._id.g), kind: u._id.k, channel: u._id.c, count: u.n })),
    activeUsersByGroup: Object.fromEntries(perGroup.map((p) => [keyOf(p._id), p.n])),
    activeUsersTotal: total[0]?.n ?? 0,
    ai: ai.map(({ _id, ...a }) => ({ group: keyOf(_id), ...a })),
    tasksCreated: Object.fromEntries(Object.entries(taskCells).map(([g, c]) => [g, c.created])),
    tasksCompleted: Object.fromEntries(Object.entries(taskCells).map(([g, c]) => [g, c.completed])),
  };
}
